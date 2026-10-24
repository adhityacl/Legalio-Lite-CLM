/**
 * Contract templates: explicit SQL for every read and write, scoped by organization. They are not part of the in-memory snapshot
 * (see normalizedSchema.ts `repository: true`). A template's own `version` (it grows by one with every save) is the optimistic-concurrency
 * token: a save based on an older version is rejected with a 409 conflict.
 */
import { sql, type Sql } from '../db';
import { createEntityRepository, type Row } from './entityRepository';

export type Template = Row;

export function createTemplateRepository(db: Sql) {
  const base = createEntityRepository(db, 'templates');
  return {
    ...base,
    /** The organization's templates in the order they were created (oldest first). */
    async list(organizationId: string): Promise<Template[]> {
      return base.hydrate(await db.all<Row>('SELECT * FROM templates WHERE organization_id = ? ORDER BY record_position, id', organizationId));
    },
    /** Template by id without knowing its organization (route handlers check ownership afterwards, answering 404 for strangers). */
    async getAnyOrganization(id: string): Promise<Template | undefined> {
      const record = await db.get<Row>('SELECT * FROM templates WHERE id = ?', id);
      return record ? (await base.hydrate([record]))[0] : undefined;
    },
    async anyAtAll(): Promise<boolean> {
      return Boolean(await db.get('SELECT 1 FROM templates LIMIT 1'));
    },
  };
}

/** The application's template repository (the shared SQL facade; its transactions are ambient). */
export const templateRepository = createTemplateRepository(sql);
export type TemplateRepository = ReturnType<typeof createTemplateRepository>;
