/**
 * Tests only: writes business rows exactly the way releases before the repositories did (the full in-memory snapshot, rows positioned
 * by array index, no version column), so the migrations' adoption of such databases can be verified. Nothing in the application uses it.
 */
import type { Sql } from './db';
import { ENTITIES } from './normalizedSchema';
import { arrayMarkers, canonicalize, childMarkerKeys, encodeFields, upsert, writeChildren, writeSearchRecord } from './normalizedCoreStore';

export async function writeLegacySnapshot(db: Sql, data: Record<string, any[]>) {
  await db.tx(async () => {
    for (const entity of ENTITIES) {
      if (entity.appendOnly) continue;
      for (const [position, input] of (data[entity.collection] ?? []).entries()) {
        const row = canonicalize(entity, input);
        const id = String(row[entity.key]);
        const values = { [entity.key]: id, organization_id: row.organizationId ?? null, record_position: position, ...encodeFields(arrayMarkers(row, childMarkerKeys(entity.table)), entity.fields, [entity.key, 'organizationId']) };
        await upsert(db, entity.table, [entity.key], values);
        await writeChildren(db, entity, row);
        await writeSearchRecord(db, entity, row, id);
      }
    }
  });
}
