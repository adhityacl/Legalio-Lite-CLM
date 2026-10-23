import type { Sql } from '../db';

export interface Migration {
  /** `NNNN_snake_case`; applied in ascending id order and recorded in schema_migrations. Never rename or reorder. */
  id: string;
  name: string;
  /** Runs once, outside the transaction, before `up` (for tools that use their own connection). Must be idempotent. */
  before?: () => Promise<void>;
  /** Runs inside one transaction together with the schema_migrations row, so a failure leaves nothing half-applied. */
  up: (sql: Sql) => Promise<void>;
}
