import express from "express";
import type { Sql } from "./db";
import { forwardAsyncRouteErrors } from "./asyncRoutes";
import type { Identity } from "./identity";
import type { CosConfig } from "./objectStore";
import { probe } from "./objectStore";
import { open, seal } from "./secretBox";
import { PROVIDER_FIELDS, PROVIDER_LABELS, STORAGE_PROVIDERS, buildStore, isStorageProvider, parseStorageConfig, providerOf, type S3Config, type StorageConfig, type StorageProvider } from "./storageProviders";

/** Tencent COS keeps the row id it has always had, so installs made before multi-provider storage keep working untouched. */
const rowId = (provider: StorageProvider) => (provider === "tencent" ? "tencent_cos" : `storage_${provider}`);
const ACTIVE_ROW = "storage_active";

interface StoredRow<T> {
  value: T;
  updated_at: string;
}

const last4 = (value: string) => value.slice(-4);

/**
 * The object-storage credentials a superuser sets for uploaded files, one row per provider plus the provider that receives new
 * uploads. Rows are sealed with a BETTER_AUTH_SECRET-derived key (secretBox.ts). Several providers can stay configured at once:
 * files remember where they were written (objectLocations.ts), so switching the active provider never strands old files.
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
  const getConfig = (provider: StorageProvider): StorageConfig | null => (rows.get(rowId(provider))?.value as StorageConfig | undefined) ?? null;
  const configuredProviders = () => STORAGE_PROVIDERS.filter((provider) => getConfig(provider));

  /** The provider that receives new uploads: the saved choice if it is still configured, else Tencent COS (installs that predate the choice), else the first configured. */
  const getActive = (): StorageProvider | null => {
    const chosen = (rows.get(ACTIVE_ROW)?.value as { provider?: unknown } | undefined)?.provider;
    if (isStorageProvider(chosen) && getConfig(chosen)) return chosen;
    if (getConfig("tencent")) return "tencent";
    return configuredProviders()[0] ?? null;
  };

  const setActive = (provider: StorageProvider, actorId: string) => write(ACTIVE_ROW, { provider }, actorId);

  /** `activate`: also make it the provider for new uploads. The first provider saved is always activated. */
  const saveConfig = async (config: StorageConfig, actorId: string, activate = false) => {
    const provider = providerOf(config);
    const first = getActive() === null;
    await write(rowId(provider), config, actorId);
    if (activate || first) await setActive(provider, actorId);
  };

  /** Never includes a secret; the access key only by its last 4 characters. */
  const providerStatus = (provider: StorageProvider) => {
    const row = rows.get(rowId(provider)) as StoredRow<StorageConfig> | undefined;
    if (!row) return { configured: false as const };
    const value = row.value;
    const access = "provider" in value ? (value as S3Config).accessKeyId : (value as CosConfig).secretId;
    const extra = "provider" in value ? { endpoint: (value as S3Config).endpoint, accountIdLast4: (value as S3Config).accountId ? last4((value as S3Config).accountId!) : undefined } : {};
    return { configured: true as const, bucket: value.bucket, region: value.region, prefix: value.prefix, secretIdLast4: last4(access), accessKeyLast4: last4(access), ...extra, updated_at: row.updated_at };
  };

  /** Overall state: whether uploads can be stored, which provider is active, and every provider's status. */
  const storageStatus = () => {
    const active = getActive();
    return { configured: active !== null, active, providers: Object.fromEntries(STORAGE_PROVIDERS.map((provider) => [provider, providerStatus(provider)])) as Record<StorageProvider, ReturnType<typeof providerStatus>> };
  };

  return {
    init, getConfig, getActive, setActive, saveConfig, configuredProviders, providerStatus, storageStatus,
    // Historical names, for the Tencent-only callers and tests.
    getCos: () => getConfig("tencent") as CosConfig | null,
    saveCos: (value: CosConfig, actorId: string) => saveConfig(value, actorId),
  };
}

export type StorageCredentialStore = ReturnType<typeof createStorageCredentialStore>;

/** Validates provider input, then proves it against the bucket (network: never call inside sql.tx). Used here and by first-run setup. */
export async function checkStorageInput(provider: unknown, input: unknown): Promise<StorageConfig | { error: string; message: string }> {
  const chosen = provider === undefined || provider === null || provider === "" ? "tencent" : provider;
  if (!isStorageProvider(chosen)) return { error: "invalid_storage_config", message: "Unknown storage provider." };
  let config: StorageConfig;
  try {
    config = parseStorageConfig(chosen, input);
  } catch (err) {
    return { error: "invalid_storage_config", message: (err as Error).message };
  }
  try {
    await probe(buildStore(config));
  } catch (err: any) {
    return { error: "storage_probe_failed", message: `${PROVIDER_LABELS[chosen]} test failed: ${err?.code || err?.name || "unknown error"}` };
  }
  return config;
}

/** Tencent-only form of the check (first-run setup before provider choice existed). */
export const checkCosInput = (input: unknown) => checkStorageInput("tencent", input);

export function createStorageCredentialsRouter(store: StorageCredentialStore) {
  const router = express.Router();
  forwardAsyncRouteErrors(router);

  const storage = "/integrations/storage";
  router.use(storage, (req, res, next) => {
    const identity = (req as unknown as { identity?: Identity }).identity;
    if (identity?.platformRole === "superuser") return next();
    res.status(403).json({ error: "INSUFFICIENT_PERMISSION", message: "Only a superuser can manage file storage." });
  });
  const actor = (req: express.Request) => (req as unknown as { identity: Identity }).identity.userId;

  router.get(storage, (_req, res) => res.json({ ...store.storageStatus(), fields: PROVIDER_FIELDS, labels: PROVIDER_LABELS }));

  // Which configured provider receives new uploads. Existing files stay readable from wherever they were written.
  router.put(`${storage}/active`, async (req, res) => {
    const provider = req.body?.provider;
    if (!isStorageProvider(provider)) return res.status(400).json({ error: "invalid_storage_config", message: "Unknown storage provider." });
    if (!store.getConfig(provider)) return res.status(400).json({ error: "storage_not_configured", message: `${PROVIDER_LABELS[provider]} is not configured yet.` });
    await store.setActive(provider, actor(req));
    res.json(store.storageStatus());
  });

  // Saving replaces that provider's credentials (key rotation); there is deliberately no DELETE: files may still live there.
  router.put(`${storage}/providers/:provider`, async (req, res) => {
    const config = await checkStorageInput(req.params.provider, req.body);
    if ("error" in config) return res.status(400).json(config);
    await store.saveConfig(config, actor(req), req.body?.activate === true);
    res.json(store.storageStatus());
  });

  // Tencent-only routes of earlier versions.
  router.get(`${storage}/cos`, (_req, res) => res.json(store.providerStatus("tencent")));
  router.put(`${storage}/cos`, async (req, res) => {
    const config = await checkStorageInput("tencent", req.body);
    if ("error" in config) return res.status(400).json(config);
    await store.saveConfig(config, actor(req));
    res.json(store.providerStatus("tencent"));
  });

  return router;
}
