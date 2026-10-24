/**
 * The clause library: explicit SQL for every read and write, scoped by organization, with optimistic concurrency on `version` (same
 * contract as the other repositories: a stale write is a 409 VERSION_CONFLICT). JSON columns (fallbacks, tags, rules) are parsed on the way out.
 */
import crypto from 'node:crypto';
import { sql, type Sql } from '../db';
import { searchPatterns } from '../normalizedCoreStore';
import { normalizeRules, type ClauseRules, type PlaybookClause, type RiskLevel } from '@legalio/shared/playbook';
import type { StarterClause } from '@legalio/shared/clauseStarter';
import { RecordNotFoundError, VersionConflictError } from './errors';

export interface ClauseRow {
  id: string;
  organization_id: string;
  title: string;
  category: string;
  risk_level: RiskLevel;
  approved_text: string;
  fallback_texts: string;
  guidance: string;
  language: string;
  jurisdiction: string;
  tags: string;
  rules: string;
  status: 'active' | 'archived';
  starter_key: string | null;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
/** A clause as the API presents it. */
export interface Clause {
  id: string;
  organizationId: string;
  title: string;
  category: string;
  risk_level: RiskLevel;
  approved_text: string;
  fallback_texts: string[];
  guidance: string;
  language: string;
  jurisdiction: string;
  tags: string[];
  rules: ClauseRules;
  status: 'active' | 'archived';
  starter_key: string | null;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const CLAUSE_SORTS = ['title', 'category', 'risk_level', 'created_at', 'updated_at'] as const;
export type ClauseSort = (typeof CLAUSE_SORTS)[number];
const MAX_PAGE_SIZE = 500;

export interface ClauseQuery {
  q?: string;
  category?: string;
  risk?: RiskLevel[];
  language?: string;
  jurisdiction?: string;
  tag?: string;
  status?: 'active' | 'archived';
  sort?: ClauseSort;
  dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}
export interface ClausePage { rows: ClauseRow[]; total: number }

const SORT_SQL: Record<ClauseSort, string[]> = {
  title: ['lower(title)', 'id'],
  category: ['lower(category)', 'lower(title)', 'id'],
  risk_level: [`CASE risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`, 'lower(title)', 'id'],
  created_at: ['created_at', 'id'],
  updated_at: ['updated_at', 'id'],
};

const parseList = (raw: string): string[] => {
  try { const value = JSON.parse(raw); return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []; } catch { return []; }
};
const parseObject = (raw: string): unknown => { try { return JSON.parse(raw); } catch { return {}; } };

export function presentClause(row: ClauseRow): Clause {
  const { organization_id, fallback_texts, tags, rules, ...rest } = row;
  return { ...rest, organizationId: organization_id, fallback_texts: parseList(fallback_texts), tags: parseList(tags), rules: normalizeRules(parseObject(rules)), version: Number(row.version) };
}
/** What the playbook engine reads. */
export const toPlaybookClause = (row: ClauseRow): PlaybookClause => {
  const clause = presentClause(row);
  return { id: clause.id, title: clause.title, category: clause.category, risk_level: clause.risk_level, approved_text: clause.approved_text, fallback_texts: clause.fallback_texts, guidance: clause.guidance, rules: clause.rules };
};

/** Fields a client may write; JSON columns are given as values and stored as JSON text. */
const WRITABLE = ['title', 'category', 'risk_level', 'approved_text', 'fallback_texts', 'guidance', 'language', 'jurisdiction', 'tags', 'rules', 'status'] as const;
const JSON_FIELDS = new Set(['fallback_texts', 'tags', 'rules']);
const clean = (values: Record<string, any>) => {
  const out: Record<string, any> = {};
  for (const key of WRITABLE) {
    if (values[key] === undefined) continue;
    const value = values[key];
    out[key] = JSON_FIELDS.has(key) ? JSON.stringify(key === 'rules' ? value ?? {} : (value ?? []).filter((v: string) => String(v).trim()).map((v: string) => String(v).trim())) : key === 'title' ? String(value).trim() : value ?? '';
  }
  return out;
};

export function createClauseRepository(db: Sql) {
  function where(organizationId: string, query: ClauseQuery) {
    const clauses = ['organization_id = ?'];
    const params: unknown[] = [organizationId];
    const add = (clause: string, ...values: unknown[]) => { clauses.push(clause); params.push(...values); };
    for (const pattern of query.q ? searchPatterns(query.q) : []) {
      add(`(title ILIKE ? OR category ILIKE ? OR approved_text ILIKE ? OR guidance ILIKE ? OR tags ILIKE ?)`, pattern, pattern, pattern, pattern, pattern);
    }
    if (query.category) add('lower(category) = ?', query.category.trim().toLowerCase());
    if (query.risk?.length) add('risk_level = ANY(?)', query.risk);
    if (query.language !== undefined && query.language !== '') add('language = ?', query.language);
    if (query.jurisdiction) add('lower(jurisdiction) = ?', query.jurisdiction.trim().toLowerCase());
    if (query.tag) add('tags::jsonb @> ?::jsonb', JSON.stringify([query.tag]));
    if (query.status) add('status = ?', query.status);
    return { sql: clauses.join(' AND '), params };
  }

  async function get(organizationId: string, id: string): Promise<ClauseRow | undefined> {
    return db.get<ClauseRow>('SELECT * FROM clauses WHERE organization_id = ? AND id = ?', organizationId, id);
  }

  async function list(organizationId: string, query: ClauseQuery = {}): Promise<ClausePage> {
    const filter = where(organizationId, query);
    const total = Number((await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM clauses WHERE ${filter.sql}`, ...filter.params))?.n ?? 0);
    const order = SORT_SQL[query.sort && query.sort in SORT_SQL ? query.sort : 'title'];
    const orderBy = order.map((part) => (query.dir === 'desc' ? part + ' DESC' : part)).join(', ');
    const paged = query.limit !== undefined;
    const limit = paged ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(query.limit)) || 50)) : undefined;
    const offset = Math.max(0, Math.trunc(Number(query.offset)) || 0);
    const rows = await db.all<ClauseRow>(`SELECT * FROM clauses WHERE ${filter.sql} ORDER BY ${orderBy}${paged ? ' LIMIT ? OFFSET ?' : ''}`, ...filter.params, ...(paged ? [limit, offset] : []));
    return { rows, total };
  }

  async function insert(organizationId: string, input: Record<string, any>, actorId: string | null, starterKey: string | null = null): Promise<ClauseRow> {
    const id = `cl-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const values: Record<string, any> = { id, organization_id: organizationId, starter_key: starterKey, created_by: actorId, created_at: now, updated_at: now, ...clean(input) };
    const names = Object.keys(values);
    await db.run(`INSERT INTO clauses (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map((n) => '@' + n).join(', ')})`, values);
    return (await get(organizationId, id))!;
  }

  async function update(organizationId: string, id: string, patch: Record<string, any>, expectedVersion: number): Promise<ClauseRow> {
    const values = clean(patch);
    const set = [...Object.keys(values).map((n) => `"${n}" = @${n}`), 'updated_at = @updated_at', 'version = version + 1'].join(', ');
    const result = await db.run(`UPDATE clauses SET ${set} WHERE organization_id = @row_org AND id = @row_id AND version = @row_expected`,
      { ...values, updated_at: new Date().toISOString(), row_org: organizationId, row_id: id, row_expected: expectedVersion });
    if (!result.changes) {
      const current = await db.get('SELECT version FROM clauses WHERE organization_id = ? AND id = ?', organizationId, id);
      throw current ? new VersionConflictError('clauses', id, expectedVersion) : new RecordNotFoundError('clauses', id);
    }
    return (await get(organizationId, id))!;
  }

  return {
    get, list, insert, update,
    async remove(organizationId: string, id: string): Promise<boolean> {
      return (await db.run('DELETE FROM clauses WHERE organization_id = ? AND id = ?', organizationId, id)).changes > 0;
    },
    async count(organizationId: string): Promise<number> {
      return Number((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM clauses WHERE organization_id = ?', organizationId))?.n ?? 0);
    },
    /** Active clauses for the playbook (all of them, bounded), optionally limited to some ids. */
    async listActive(organizationId: string, ids?: string[]): Promise<ClauseRow[]> {
      return db.all<ClauseRow>(`SELECT * FROM clauses WHERE organization_id = ? AND status = 'active'${ids?.length ? ' AND id = ANY(?)' : ''} ORDER BY lower(title), id LIMIT 500`, organizationId, ...(ids?.length ? [ids] : []));
    },
    /** Distinct categories and tags of the organization's library (filters). */
    async facets(organizationId: string): Promise<{ categories: string[]; tags: string[]; languages: string[]; jurisdictions: string[] }> {
      const rows = await db.all<{ category: string; language: string; jurisdiction: string; tags: string }>('SELECT category, language, jurisdiction, tags FROM clauses WHERE organization_id = ?', organizationId);
      const uniq = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
      return { categories: uniq(rows.map((r) => r.category)), languages: uniq(rows.map((r) => r.language)), jurisdictions: uniq(rows.map((r) => r.jurisdiction)), tags: uniq(rows.flatMap((r) => parseList(r.tags))) };
    },
    /** The starter keys the organization already has (imported or later edited: the key stays). */
    async starterKeys(organizationId: string): Promise<Set<string>> {
      return new Set((await db.all<{ starter_key: string }>('SELECT starter_key FROM clauses WHERE organization_id = ? AND starter_key IS NOT NULL', organizationId)).map((r) => r.starter_key));
    },
    /** Non-destructive import: a starter clause whose key exists (even if edited, even if archived) is skipped; nothing existing is touched. */
    async importStarters(organizationId: string, starters: StarterClause[], actorId: string | null): Promise<{ created: ClauseRow[]; skipped: number }> {
      return db.tx(async () => {
        const created: ClauseRow[] = [];
        let skipped = 0;
        for (const starter of starters) {
          const id = `cl-${crypto.randomUUID()}`;
          const now = new Date().toISOString();
          const values = { id, organization_id: organizationId, starter_key: starter.starter_key, created_by: actorId, created_at: now, updated_at: now,
            ...clean({ title: starter.title, category: starter.category, risk_level: starter.risk_level, approved_text: starter.approved_text, fallback_texts: starter.fallback_texts,
              guidance: starter.guidance, language: starter.language, jurisdiction: starter.jurisdiction, tags: starter.tags, rules: starter.rules, status: 'active' }) };
          const names = Object.keys(values);
          const result = await db.run(`INSERT INTO clauses (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map((n) => '@' + n).join(', ')}) ON CONFLICT DO NOTHING`, values);
          if (result.changes) created.push((await get(organizationId, id))!); else skipped++;
        }
        return { created, skipped };
      });
    },
  };
}

/** The application's clause repository (the shared SQL facade; its transactions are ambient). */
export const clauseRepository = createClauseRepository(sql);
export type ClauseRepository = ReturnType<typeof createClauseRepository>;
