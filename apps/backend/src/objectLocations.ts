import type { Sql } from './db';
import type { ObjectStore } from './objectStore';
import { ApiError } from './organizationSettingsStore';
import { componentLog } from './logger';
import { PROVIDER_LABELS, isStorageProvider, type StorageConfig, type StorageProvider } from './storageProviders';

const log = componentLog('objectLocations');

/** What the routing store needs from the saved credentials. */
export interface StorageSettingsSource {
  getActive(): StorageProvider | null;
  getConfig(provider: StorageProvider): StorageConfig | null;
  configuredProviders(): StorageProvider[];
}

/**
 * One ObjectStore over every configured provider. New objects go to the active provider and their location is recorded in
 * `object_locations`; reads and deletes follow the recorded location, so changing the active provider never strands old files.
 * An object without a record predates multi-provider storage, when Tencent COS was the only one.
 */
export function createRoutingStore(db: Sql, settings: StorageSettingsSource, build: (config: StorageConfig) => ObjectStore): ObjectStore {
  // One client per saved configuration; a save creates a new config object and so a new client.
  const built = new Map<StorageProvider, { config: StorageConfig; store: ObjectStore }>();
  const storeFor = (provider: StorageProvider): ObjectStore => {
    const config = settings.getConfig(provider);
    if (!config) throw new ApiError(503, 'STORAGE_NOT_CONFIGURED', `File storage (${PROVIDER_LABELS[provider]}) is not configured.`);
    const cached = built.get(provider);
    if (cached?.config === config) return cached.store;
    const store = build(config);
    built.set(provider, { config, store });
    return store;
  };

  const recorded = async (key: string): Promise<StorageProvider | null> => {
    const row = await db.get<{ provider: string }>('SELECT provider FROM object_locations WHERE storage_key = ?', key);
    return row && isStorageProvider(row.provider) ? row.provider : null;
  };
  /** Where an object lives: its record, else Tencent COS if configured (older objects), else the active provider. */
  const locate = async (key: string): Promise<StorageProvider> => {
    const provider = (await recorded(key)) ?? (settings.getConfig('tencent') ? 'tencent' : settings.getActive());
    if (!provider) throw new ApiError(503, 'STORAGE_NOT_CONFIGURED', 'File storage is not configured.');
    return provider;
  };

  return {
    async put(key, body, contentType) {
      const provider = settings.getActive();
      if (!provider) throw new ApiError(503, 'STORAGE_NOT_CONFIGURED', 'File storage is not configured.');
      const previous = await recorded(key);
      await storeFor(provider).put(key, body, contentType);
      await db.run(`INSERT INTO object_locations (storage_key, provider, created_at) VALUES (?, ?, ?)
        ON CONFLICT (storage_key) DO UPDATE SET provider = excluded.provider`, key, provider, new Date().toISOString());
      // A key rewritten while another provider is active moves; the superseded copy is removed, best effort.
      if (previous && previous !== provider && settings.getConfig(previous)) await storeFor(previous).delete(key).catch((err) => log.warn(`Could not remove the superseded copy of ${key} from ${previous}:`, err));
    },
    async get(key) {
      return storeFor(await locate(key)).get(key);
    },
    async delete(key) {
      await storeFor(await locate(key)).delete(key);
      await db.run('DELETE FROM object_locations WHERE storage_key = ?', key);
    },
    async list(prefix) {
      const seen = new Map<string, Awaited<ReturnType<ObjectStore['list']>>[number]>();
      for (const provider of settings.configuredProviders()) for (const object of await storeFor(provider).list(prefix)) if (!seen.has(object.key)) seen.set(object.key, object);
      return [...seen.values()];
    },
  };
}
