/** Writing a whole dataset (first-run demo workspace, application reset, test fixtures) into the repository-backed tables. */
import type { Sql } from '../db';
import { ENTITIES } from '../normalizedSchema';
import { createEntityRepository } from './entityRepository';

type Prepare = Partial<Record<string, (row: any) => any>>;

/**
 * Inserts the dataset's rows of every repository-backed entity. Each insert goes to the front, so the rows are written in reverse
 * to keep the dataset's order. Run inside the same transaction as the snapshot sync: foreign keys are checked at commit.
 * `prepare` may normalize the rows of a table first (keyed by table name).
 */
export async function insertRepositoryRows(db: Sql, dataset: object, prepare: Prepare = {}) {
  for (const entity of ENTITIES) {
    if (!entity.repository) continue;
    const repository = createEntityRepository(db, entity.table);
    for (const row of [...((dataset as Record<string, any[]>)[entity.collection] ?? [])].reverse()) await repository.insert(prepare[entity.table]?.(row) ?? row);
  }
}

/** Removes every row of every repository-backed entity (all organizations): the application reset. */
export async function clearRepositoryRows(db: Sql) {
  for (const entity of ENTITIES) if (entity.repository) await createEntityRepository(db, entity.table).removeAll();
}
