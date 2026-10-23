/**
 * Record id allocation. Public ids keep their familiar shapes (P0001, C0001, IO0001, SP0001, EVAL-2026-001) but the number
 * comes from a PostgreSQL sequence, so two requests (or two processes) never draw the same one and a deleted record's
 * number is never reused. Ids written explicitly (demo data, restores, imports) are respected: a drawn id that already
 * exists is skipped, and `syncIdSequences` fast-forwards each sequence past what is stored.
 */
import { sql } from './db';
import { db } from './memoryDb';

export type IdKind = 'partner' | 'contract' | 'io' | 'spending' | 'evaluation';

const pad = (n: number, width: number) => String(n).padStart(width, '0');

interface Spec {
  sequence: string;
  collection: 'partners' | 'contracts' | 'ios' | 'spendings' | 'evaluations';
  key: string;
  table: string;
  column: string;
  /** SQL regular expression for the number inside an existing id: the first digit group (as before) or, for evaluations, the last. */
  digits: string;
  format: (n: number, year: string) => string;
}
const SPECS: Record<IdKind, Spec> = {
  partner: { sequence: 'legalio_partner_id_seq', collection: 'partners', key: 'partner_id', table: 'partners', column: 'partner_id', digits: '\\d+', format: (n) => `P${pad(n, 4)}` },
  contract: { sequence: 'legalio_contract_id_seq', collection: 'contracts', key: 'contract_id', table: 'contracts', column: 'contract_id', digits: '\\d+', format: (n) => `C${pad(n, 4)}` },
  io: { sequence: 'legalio_io_id_seq', collection: 'ios', key: 'io_id', table: 'insertion_orders', column: 'io_id', digits: '\\d+', format: (n) => `IO${pad(n, 4)}` },
  spending: { sequence: 'legalio_spending_id_seq', collection: 'spendings', key: 'id', table: 'spendings', column: 'id', digits: '\\d+', format: (n) => `SP${pad(n, 4)}` },
  evaluation: { sequence: 'legalio_evaluation_id_seq', collection: 'evaluations', key: 'id', table: 'evaluations', column: 'id', digits: '\\d+$', format: (n, year) => `EVAL-${year}-${pad(n, 3)}` },
};

/** The next free id of `kind`. `year` only matters for evaluations (defaults to the current year). */
export async function nextEntityId(kind: IdKind, year = String(new Date().getFullYear())): Promise<string> {
  const spec = SPECS[kind];
  for (let attempt = 0; attempt < 1000; attempt++) {
    const row = await sql.get<{ n: number }>(`SELECT nextval('${spec.sequence}') AS n`);
    const id = spec.format(Number(row!.n), year);
    if (!(db[spec.collection] || []).some((record: any) => record?.[spec.key] === id)) return id;
  }
  throw new Error(`Could not allocate a ${kind} id.`);
}

/** Moves every sequence past the highest number stored in its table (never backwards). Safe to run at every start. */
export async function syncIdSequences(): Promise<void> {
  for (const spec of Object.values(SPECS)) {
    // Numbers of six digits or more are not sequence numbers (imported references); they were ignored by the previous scheme too.
    const stored = await sql.get<{ highest: number }>(`
      SELECT COALESCE(MAX(n), 0) AS highest FROM (
        SELECT substring("${spec.column}" from '${spec.digits}') AS d FROM "${spec.table}"
      ) ids, LATERAL (SELECT CASE WHEN length(ids.d) BETWEEN 1 AND 6 THEN ids.d::bigint END AS n) parsed`);
    const highest = Number(stored?.highest) || 0;
    if (highest < 1) continue;
    const state = await sql.get<{ last_value: number; is_called: boolean }>(`SELECT last_value, is_called FROM ${spec.sequence}`);
    const current = state?.is_called ? Number(state.last_value) : 0;
    if (highest > current) await sql.get(`SELECT setval('${spec.sequence}', ?, true)`, highest);
  }
}
