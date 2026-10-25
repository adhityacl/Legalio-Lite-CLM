import express from "express";
import type { Sql } from "./db";
import { forwardAsyncRouteErrors } from "./asyncRoutes";
import type { Identity } from "./identity";
import { cosStore, parseCosConfig, probe, type CosConfig } from "./objectStore";
import { open, seal } from "./secretBox";

const COS_ROW = "tencent_cos";

interface StoredRow<T> {
  value: T;
  updated_at: string;
}

/**
 * The Tencent COS credentials a superuser sets for uploaded files, sealed with a BETTER_AUTH_SECRET-derived key (secretBox.ts).
 */
export function createStorageCredentialStore(db: Sql, onChange?: () => void) {
  // Rows mirrored in memory so storage reads stay synchronous; only save writes them.
  const rows = new Map<string, StoredRow<unknown>>();
  const init = async () => {
    const stored = await db.all<{ id: string; payload: string; updated_at: string }>(`SELECT id, payload, updated_at FROM integration_credentials`);
    rows.clear();
    for (const row of stored) {
      try {
        // Rows written before encryption are plain JSON; they are sealed on their next save.
        rows.set(row.id, { value: JSON.parse(row.payload.startsWith("v1:") ? open(row.payload) : row.payload), updated_at: row.updated_at });
      } catch (err) {
        // Most likely BETTER_AUTH_SECRET changed: the row counts as not configured until it is saved again.
        console.error(`[credentials] Cannot read stored ${row.id}:`, (err as Error).message);
      }
    }
  };

  const write = async (id: string, value: unknown, actorId: string) => {
    const updated_at = new Date().toISOString();
    await db.run(`
      INSERT INTO integration_credentials (id, payload, updated_by, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET payload = excluded.payload, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    `, id, seal(JSON.stringify(value)), actorId, updated_at);
    rows.set(id, { value, updated_at });
    onChange?.();
  };

  /** A new object after every save, so callers can cache a client per returned config. */
  const getCos = (): CosConfig | null => (rows.get(COS_ROW)?.value as CosConfig | undefined) ?? null;
  const saveCos = (value: CosConfig, actorId: string) => write(COS_ROW, value, actorId);

  /** Never includes the secret key; the SecretId only by its last 4 characters. */
  const storageStatus = () => {
    const row = rows.get(COS_ROW) as StoredRow<CosConfig> | undefined;
    if (!row) return { configured: false as const };
    const { bucket, region, prefix, secretId } = row.value;
    return { configured: true as const, bucket, region, prefix, secretIdLast4: secretId.slice(-4), updated_at: row.updated_at };
  };

  return { init, getCos, saveCos, storageStatus };
}

export type StorageCredentialStore = ReturnType<typeof createStorageCredentialStore>;

/** Validates COS input, then proves it against the bucket (network: never call inside sql.tx). Used here and by first-run setup. */
export async function checkCosInput(input: unknown): Promise<CosConfig | { error: string; message: string }> {
  let config: CosConfig;
  try {
    config = parseCosConfig(input);
  } catch (err) {
    return { error: "invalid_storage_config", message: (err as Error).message };
  }
  try {
    await probe(cosStore(config));
  } catch (err: any) {
    return { error: "storage_probe_failed", message: `Tencent COS test failed: ${err?.code || "unknown error"}` };
  }
  return config;
}

export function createStorageCredentialsRouter(store: StorageCredentialStore) {
  const router = express.Router();
  forwardAsyncRouteErrors(router);

  const storage = "/integrations/storage/cos";
  router.use(storage, (req, res, next) => {
    const identity = (req as unknown as { identity?: Identity }).identity;
    if (identity?.platformRole === "superuser") return next();
    res.status(403).json({ error: "INSUFFICIENT_PERMISSION", message: "Only a superuser can manage file storage." });
  });

  router.get(storage, (_req, res) => res.json(store.storageStatus()));

  // Saving replaces the credentials (key rotation); there is deliberately no DELETE, uploads need storage.
  router.put(storage, async (req, res) => {
    const config = await checkCosInput(req.body);
    if ("error" in config) return res.status(400).json(config);
    const identity = (req as unknown as { identity: Identity }).identity;
    await store.saveCos(config, identity.userId);
    res.json(store.storageStatus());
  });

  return router;
}
