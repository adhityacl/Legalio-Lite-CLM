/**
 * Retrieval for the AI chat. Instead of loading the workspace and truncating it, the question is turned into a full-text query and each
 * kind of record is searched in SQL (GIN full-text indexes, see migration 0025) inside the caller's organization; the best few records
 * come back with their ids so the answer can cite them.
 *
 * Authorization is applied to every candidate before it can be returned or counted: records of other tenants are never selected (every
 * query names the organization), and for department roles each candidate is checked against the caller's departments (`visible`), with
 * further pages of candidates read until enough visible records were found, so rows of other departments neither reach the model nor
 * crowd out the caller's own records.
 */
import type { Sql } from './db';
import { RETRIEVAL_CONFIG, RETRIEVAL_TEXT, type RetrievalTable } from './retrievalText';
import { readBusinessRows } from './normalizedCoreStore';
import { contractRepository } from './repositories/contractRepository';
import { obligationRepository } from './repositories/obligationRepository';
import { clauseRepository, presentClause } from './repositories/clauseRepository';
import { partnerRepository } from './repositories/partnerRepository';
import { addDays } from '@legalio/shared/obligations';
import {
  clauseContext, contractContext, documentContext, evaluationContext, keyTermContext, obligationContext, orderContext, partnerContext, spendingContext,
} from './chatContext';

export const SOURCE_TYPES = ['contract', 'partner', 'order', 'spending', 'evaluation', 'obligation', 'clause', 'key_term', 'document'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Where a source opens in the application: `?tab=<tab>&<param>=<id>`. */
const LINKS: Record<SourceType, { tab: string; param: 'id' | 'document' }> = {
  contract: { tab: 'contracts', param: 'id' }, partner: { tab: 'partners', param: 'id' }, order: { tab: 'ios', param: 'id' },
  spending: { tab: 'partner-spending', param: 'id' }, evaluation: { tab: 'partner-evaluation', param: 'id' }, obligation: { tab: 'obligations', param: 'id' },
  clause: { tab: 'clauses', param: 'id' }, key_term: { tab: 'contracts', param: 'id' }, document: { tab: 'create-contract', param: 'document' },
};

export interface Source {
  ref: string;
  type: SourceType;
  id: string;
  title: string;
  subtitle: string;
  tab: string;
  param: 'id' | 'document';
  /** `match` came out of the full-text search; `upcoming` is the short list of expiring contracts and due obligations every answer may use. */
  origin: 'match' | 'upcoming';
  score: number;
  cited?: boolean;
}
export interface ContextRecord { source: Source; context: Record<string, unknown> }

/** The caller's department scope, one predicate per kind of record (organization-wide roles accept everything). */
export interface Visibility {
  contract: (row: any) => boolean;
  partner: (row: any) => boolean;
  order: (row: any) => boolean;
  spending: (row: any) => boolean;
  evaluation: (row: any) => boolean;
  obligation: (row: any) => boolean;
}

/* ------------------------------ the question as a query ------------------------------ */

const STOP_WORDS = new Set(`the and for are was were with that this from have has had not but you your our their its what which who whom whose when where how why can could should
would will shall may might any all some many much more most about into over under than then also please tell show list give find does did been being there these those
yang dan untuk dengan dari pada apa siapa berapa bagaimana mana adalah ini itu atau ada saja semua para kami kita saya anda tolong bisa dapat akan sudah telah
的 是 和 在 了 请 吗 什么 我们 你们`.split(/\s+/));
const CJK = /[㐀-鿿豈-﫿]/u;
export const MAX_TERMS = 12;

export interface SearchTerms { words: string[]; cjk: string[] }

/** Words of the question and of the recent user messages (so a follow-up like "and its notes?" still finds the record talked about). */
export function searchTerms(question: string, recentTexts: string[] = []): SearchTerms {
  const words: string[] = [];
  const cjk: string[] = [];
  const add = (text: string) => {
    for (const raw of text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
      if (CJK.test(raw)) {
        // A run of Chinese characters is one token for the text search parser: match substrings (pairs of characters) instead.
        const chars = [...raw];
        if (chars.length < 2) { if (!cjk.includes(raw) && !STOP_WORDS.has(raw)) cjk.push(raw); continue; }
        for (let i = 0; i + 1 < chars.length; i++) { const pair = chars[i] + chars[i + 1]; if (!cjk.includes(pair)) cjk.push(pair); }
        continue;
      }
      // Very short words are noise unless they carry a digit ("q3", "s1").
      if ((raw.length < 3 && !/\d/.test(raw)) || STOP_WORDS.has(raw) || words.includes(raw)) continue;
      words.push(raw);
    }
  };
  add(question);
  for (const text of recentTexts.slice(-2)) add(text);
  return { words: words.slice(0, MAX_TERMS), cjk: cjk.slice(0, MAX_TERMS) };
}

/** `a:* | b:*` (prefix match, any word). The words contain letters and digits only, so nothing can inject tsquery syntax. */
export const toTsQuery = (words: string[]) => words.map((w) => `${w}:*`).join(' | ');
const likePatterns = (cjk: string[]) => cjk.map((c) => `%${c.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`);

/* ------------------------------ candidates ------------------------------ */

interface Candidate { id: string; score: number }
const PAGE = 25;
const MAX_PAGES = 3;

/**
 * One page of the best matches in `table` for the organization, ranked by `ts_rank_cd` (length-normalized). `constraint` adds
 * table-specific conditions (record type, active status); `idColumn` names the row id.
 */
async function candidates(db: Sql, table: RetrievalTable, organizationId: string, terms: SearchTerms, offset: number, extra: { sql: string; params: unknown[] } = { sql: '', params: [] }, idColumn = 'id'): Promise<Candidate[]> {
  const text = RETRIEVAL_TEXT[table];
  const vector = `to_tsvector('${RETRIEVAL_CONFIG}', ${text})`;
  const selectParts: string[] = [];
  const selectParams: unknown[] = [];
  const matchParts: string[] = [];
  const matchParams: unknown[] = [];
  if (terms.words.length) {
    selectParts.push(`ts_rank_cd(${vector}, to_tsquery('${RETRIEVAL_CONFIG}', ?), 32)`);
    selectParams.push(toTsQuery(terms.words));
    matchParts.push(`${vector} @@ to_tsquery('${RETRIEVAL_CONFIG}', ?)`);
    matchParams.push(toTsQuery(terms.words));
  }
  if (terms.cjk.length) {
    const patterns = likePatterns(terms.cjk);
    selectParts.push(`CASE WHEN ${text} ILIKE ANY(?) THEN 0.25 ELSE 0 END`);
    selectParams.push(patterns);
    matchParts.push(`${text} ILIKE ANY(?)`);
    matchParams.push(patterns);
  }
  if (!matchParts.length) return [];
  const rows = await db.all<{ id: string; score: number }>(
    `SELECT ${idColumn} AS id, (${selectParts.join(' + ')}) AS score FROM ${table}
     WHERE organization_id = ?${extra.sql} AND (${matchParts.join(' OR ')})
     ORDER BY score DESC, ${idColumn} LIMIT ? OFFSET ?`,
    ...selectParams, organizationId, ...extra.params, ...matchParams, PAGE, offset);
  return rows.map((r) => ({ id: r.id, score: Number(r.score) }));
}

type Loaded = { id: string; score: number; source: Omit<Source, 'ref' | 'origin' | 'score'>; context: Record<string, unknown> };
type Loader = (ids: string[]) => Promise<Map<string, Omit<Loaded, 'id' | 'score'>>>;

const joinTitle = (...parts: unknown[]) => parts.map((p) => String(p ?? '').trim()).filter(Boolean).join(' · ');

export interface RetrievalInput {
  db: Sql;
  organizationId: string;
  question: string;
  recentTexts: string[];
  visible: Visibility;
  /** The caller sees the whole organization (no department filtering): one page of candidates is enough. */
  orgWide: boolean;
  /** Organization-local date (YYYY-MM-DD). */
  today: string;
  topK?: number;
  perType?: number;
  /** Upper bound of the serialized context records. */
  contextChars: number;
}
export interface RetrievalResult { records: ContextRecord[]; matched: number }

export const DEFAULT_TOP_K = 10;
export const DEFAULT_PER_TYPE = 4;

export async function retrieveForChat(input: RetrievalInput): Promise<RetrievalResult> {
  const { db, organizationId, today } = input;
  const topK = input.topK ?? DEFAULT_TOP_K;
  const perType = input.perType ?? DEFAULT_PER_TYPE;
  const terms = searchTerms(input.question, input.recentTexts);
  const link = (type: SourceType) => LINKS[type];

  const partnerNames = new Map<string, string>();
  const namesFor = async (partnerIds: string[]) => {
    const missing = partnerIds.filter((id) => id && !partnerNames.has(id));
    if (missing.length) for (const [id, name] of await partnerRepository.names(organizationId, missing)) partnerNames.set(id, name);
    return (id: string) => partnerNames.get(id) || '';
  };

  const loaders: Record<SourceType, Loader> = {
    contract: async (ids) => {
      const rows = (await contractRepository.list(organizationId, { ids })).rows.filter(input.visible.contract);
      const names = await namesFor(rows.map((c: any) => c.partner_id));
      return new Map(rows.map((c: any) => [c.contract_id, { source: { type: 'contract', id: c.contract_id, title: joinTitle(c.contract_number, c.contract_title), subtitle: names(c.partner_id), ...link('contract') }, context: contractContext(c, names) }]));
    },
    partner: async (ids) => {
      const rows = (await readBusinessRows(db, 'partners', organizationId, ids)).filter(input.visible.partner);
      return new Map(rows.map((p: any) => [p.partner_id, { source: { type: 'partner', id: p.partner_id, title: String(p.partner_name ?? ''), subtitle: joinTitle(p.partner_type, p.country), ...link('partner') }, context: partnerContext(p) }]));
    },
    order: async (ids) => {
      const rows = (await readBusinessRows(db, 'insertion_orders', organizationId, ids)).filter(input.visible.order);
      const names = await namesFor(rows.map((i: any) => i.partner_id));
      return new Map(rows.map((i: any) => [i.io_id, { source: { type: 'order', id: i.io_id, title: joinTitle(i.io_number, i.io_title), subtitle: names(i.partner_id), ...link('order') }, context: orderContext(i, names) }]));
    },
    spending: async (ids) => {
      const rows = (await readBusinessRows(db, 'spendings', organizationId, ids)).filter(input.visible.spending);
      return new Map(rows.map((s: any) => [s.id, { source: { type: 'spending', id: s.id, title: joinTitle(s.invoice_number, s.vendor_name || s.partner_name), subtitle: joinTitle(s.currency, s.total_amount), ...link('spending') }, context: spendingContext(s) }]));
    },
    evaluation: async (ids) => {
      const rows = (await readBusinessRows(db, 'evaluations', organizationId, ids)).filter(input.visible.evaluation);
      return new Map(rows.map((e: any) => [e.id, { source: { type: 'evaluation', id: e.id, title: joinTitle(e.supplier_name, e.review_date), subtitle: String(e.type_of_work ?? ''), ...link('evaluation') }, context: evaluationContext(e) }]));
    },
    obligation: async (ids) => {
      const rows = (await obligationRepository.getMany(organizationId, ids)).filter((o) => input.visible.obligation(o));
      return new Map(rows.map((o: any) => [o.id, { source: { type: 'obligation', id: o.id, title: String(o.title ?? ''), subtitle: joinTitle(o.due_date, o.contract_number || o.io_number || o.partner_name), ...link('obligation') }, context: obligationContext(o) }]));
    },
    clause: async (ids) => {
      const rows = (await clauseRepository.listActive(organizationId, ids)).map(presentClause);
      return new Map(rows.map((c) => [c.id, { source: { type: 'clause', id: c.id, title: c.title, subtitle: joinTitle(c.category, c.jurisdiction), ...link('clause') }, context: clauseContext(c) }]));
    },
    key_term: async (ids) => {
      const terms_ = await db.all<any>(`SELECT k.id, k.contract_id, k.label, k.value, k.summary, k.source_quote, k.source_page, c.contract_number
        FROM contract_key_terms k JOIN contracts c ON c.contract_id = k.contract_id WHERE k.organization_id = ? AND k.id = ANY(?)`, organizationId, ids);
      const contracts = new Map((await contractRepository.list(organizationId, { ids: [...new Set(terms_.map((k) => k.contract_id))] })).rows.filter(input.visible.contract).map((c: any) => [c.contract_id, c]));
      return new Map(terms_.filter((k) => contracts.has(k.contract_id)).map((k) => [k.id, { source: { type: 'key_term', id: k.contract_id, title: joinTitle(k.label, k.value), subtitle: String(k.contract_number ?? ''), ...link('key_term') }, context: keyTermContext(k) }]));
    },
    document: async (ids) => {
      const text = RETRIEVAL_TEXT.contract_documents;
      const query = terms.words.length ? toTsQuery(terms.words) : null;
      const rows = await db.all<any>(
        `SELECT id, name, type, status, ${query ? `ts_headline('${RETRIEVAL_CONFIG}', ${text}, to_tsquery('${RETRIEVAL_CONFIG}', ?), 'MaxFragments=2, MaxWords=40, MinWords=12, FragmentDelimiter= … , StartSel=«, StopSel=»')` : `left(${text}, 600)`} AS snippet
         FROM contract_documents WHERE organization_id = ? AND id = ANY(?)`, ...(query ? [query] : []), organizationId, ids);
      return new Map(rows.map((d) => [d.id, { source: { type: 'document', id: d.id, title: String(d.name ?? ''), subtitle: joinTitle(d.type, d.status), ...link('document') }, context: documentContext(d, String(d.snippet ?? '')) }]));
    },
  };

  // What to search per type: the table, the id column, extra conditions, and how the candidate id maps to the loader's id.
  const plans: Array<{ type: SourceType; table: RetrievalTable; idColumn?: string; extra?: { sql: string; params: unknown[] } }> = [
    { type: 'contract', table: 'search_records', idColumn: 'entity_id', extra: { sql: ` AND entity_type = ?`, params: ['contracts'] } },
    { type: 'partner', table: 'search_records', idColumn: 'entity_id', extra: { sql: ` AND entity_type = ?`, params: ['partners'] } },
    { type: 'order', table: 'search_records', idColumn: 'entity_id', extra: { sql: ` AND entity_type = ?`, params: ['insertion_orders'] } },
    { type: 'spending', table: 'search_records', idColumn: 'entity_id', extra: { sql: ` AND entity_type = ?`, params: ['spendings'] } },
    { type: 'evaluation', table: 'search_records', idColumn: 'entity_id', extra: { sql: ` AND entity_type = ?`, params: ['evaluations'] } },
    { type: 'obligation', table: 'obligations' },
    { type: 'clause', table: 'clauses', extra: { sql: ` AND status = 'active'`, params: [] } },
    { type: 'key_term', table: 'contract_key_terms' },
    { type: 'document', table: 'contract_documents' },
  ];

  const found: Array<Loaded & { type: SourceType }> = [];
  for (const plan of plans) {
    const kept: Array<Loaded & { type: SourceType }> = [];
    for (let page = 0; page < (input.orgWide ? 1 : MAX_PAGES) && kept.length < perType; page++) {
      const batch = await candidates(db, plan.table, organizationId, terms, page * PAGE, plan.extra, plan.idColumn);
      if (!batch.length) break;
      const loaded = await loaders[plan.type](batch.map((c) => c.id));
      for (const candidate of batch) {
        const record = loaded.get(candidate.id);
        if (record && kept.length < perType) kept.push({ ...record, id: candidate.id, score: candidate.score, type: plan.type });
      }
      if (batch.length < PAGE) break;
    }
    found.push(...kept);
  }
  found.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const top: ContextRecord[] = [];
  for (const record of found) {
    const key = `${record.source.type}:${record.source.id}`;
    if (seen.has(key) || top.length >= topK) continue;
    seen.add(key);
    top.push({ source: { ...record.source, ref: '', origin: 'match', score: Math.round(record.score * 1000) / 1000 }, context: record.context });
  }

  // The short list every answer may use: contracts ending within 60 days and open obligations due within 30 days (or overdue).
  const upcoming: ContextRecord[] = [];
  const known = (type: string, id: string) => seen.has(`${type}:${id}`);
  const soonContracts = (await contractRepository.list(organizationId, { endFrom: today, endTo: addDays(today, 60), sort: 'end_date', dir: 'asc', limit: 50 })).rows.filter(input.visible.contract);
  const upcomingNames = await namesFor(soonContracts.map((c: any) => c.partner_id));
  for (const c of soonContracts.filter((c: any) => !known('contract', c.contract_id)).slice(0, 5)) {
    upcoming.push({ source: { type: 'contract', id: c.contract_id, title: joinTitle(c.contract_number, c.contract_title), subtitle: upcomingNames(c.partner_id), ...link('contract'), ref: '', origin: 'upcoming', score: 0 }, context: contractContext(c, upcomingNames) });
  }
  const dueObligations = (await obligationRepository.list(organizationId, { status: ['open', 'in_progress', 'overdue'], dueTo: addDays(today, 30), sort: 'due_date', dir: 'asc', limit: 50, today })).rows.filter((o) => input.visible.obligation(o));
  for (const o of dueObligations.filter((o: any) => !known('obligation', o.id)).slice(0, 5)) {
    upcoming.push({ source: { type: 'obligation', id: o.id, title: String(o.title ?? ''), subtitle: joinTitle(o.due_date, o.contract_number || o.io_number || o.partner_name), ...link('obligation'), ref: '', origin: 'upcoming', score: 0 }, context: obligationContext(o) });
  }

  // Fit the character budget (best matches first), then number the records: S1, S2, ...
  const records: ContextRecord[] = [];
  let used = 0;
  for (const record of [...top, ...upcoming]) {
    const size = JSON.stringify(record.context).length + 40;
    if (records.length > 0 && used + size > input.contextChars) continue;
    used += size;
    records.push(record);
  }
  records.forEach((record, index) => { record.source.ref = `S${index + 1}`; });
  return { records, matched: records.filter((r) => r.source.origin === 'match').length };
}

/** Totals for the "how many" questions: one SQL statement for the whole organization (department roles get counts from the caller). */
export async function organizationCounts(db: Sql, organizationId: string): Promise<Record<string, number>> {
  const row = await db.get<Record<string, number>>(`SELECT
    (SELECT COUNT(*) FROM contracts WHERE organization_id = ?) AS contracts,
    (SELECT COUNT(*) FROM partners WHERE organization_id = ?) AS partners,
    (SELECT COUNT(*) FROM insertion_orders WHERE organization_id = ?) AS commercial_documents,
    (SELECT COUNT(*) FROM spendings WHERE organization_id = ?) AS spendings_and_invoices,
    (SELECT COUNT(*) FROM evaluations WHERE organization_id = ?) AS evaluations,
    (SELECT COUNT(*) FROM obligations WHERE organization_id = ? AND status IN ('open', 'in_progress')) AS open_obligations,
    (SELECT COUNT(*) FROM clauses WHERE organization_id = ? AND status = 'active') AS clauses`,
    organizationId, organizationId, organizationId, organizationId, organizationId, organizationId, organizationId);
  return Object.fromEntries(Object.entries(row ?? {}).map(([k, v]) => [k, Number(v)]));
}

/** `[S1]`, `[S2, S5]` and `[S3][S4]` in an answer name the records it relies on. */
export function citedRefs(reply: string, known: Set<string>): Set<string> {
  const refs = new Set<string>();
  for (const group of String(reply ?? '').matchAll(/\[\s*(S\d{1,3}(?:\s*[,;]\s*S\d{1,3})*)\s*\]/g)) {
    for (const ref of group[1].split(/\s*[,;]\s*/)) if (known.has(ref)) refs.add(ref);
  }
  return refs;
}
