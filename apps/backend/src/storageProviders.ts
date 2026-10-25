/**
 * Upload storage providers. Tencent COS keeps its own SDK (cosStore); every other provider speaks the S3 protocol through
 * @aws-sdk/client-s3, so adding one is a row in PROVIDER_RULES. Credentials are entered in the app, never read from the environment.
 */
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { CosConfig, ObjectStore, cosStore, parseCosConfig } from './objectStore';

import { STORAGE_PROVIDERS, PROVIDER_LABELS, PROVIDER_FIELDS, type StorageProvider } from '@legalio/shared/storageProviders';
export { STORAGE_PROVIDERS, PROVIDER_LABELS, PROVIDER_FIELDS, type StorageProvider };
export const isStorageProvider = (value: unknown): value is StorageProvider => typeof value === 'string' && (STORAGE_PROVIDERS as readonly string[]).includes(value);

/** Settings of every S3-protocol provider. Tencent COS keeps its historical shape (CosConfig). */
export interface S3Config { provider: Exclude<StorageProvider, 'tencent'>; accessKeyId: string; secretAccessKey: string; bucket: string; region: string; prefix: string; endpoint?: string; accountId?: string }
export type StorageConfig = CosConfig | S3Config;

interface Rule { region: 'required' | 'fixed'; fixedRegion?: string; needs?: 'accountId' | 'endpoint'; pathStyle?: boolean }
const PROVIDER_RULES: Record<Exclude<StorageProvider, 'tencent'>, Rule> = {
  aws: { region: 'required' },
  cloudflare: { region: 'fixed', fixedRegion: 'auto', needs: 'accountId' },
  backblaze: { region: 'required' },
  gcs: { region: 'fixed', fixedRegion: 'auto' },
  minio: { region: 'fixed', fixedRegion: 'us-east-1', needs: 'endpoint', pathStyle: true },
};

const text = (input: any, name: string) => (typeof input?.[name] === 'string' ? input[name].trim() : '');

function cleanPrefix(prefix: string) {
  if (prefix.startsWith('/') || prefix.includes('\\') || prefix.includes('\0') || prefix.split('/').includes('..')) throw new Error('Prefix must be a relative folder without "..".');
  return prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix;
}

/**
 * Validated, trimmed settings. Bucket, region and account id end up in host names, so they must not be able to point the SDK elsewhere;
 * a custom endpoint (MinIO) must be a plain http(s) origin without credentials.
 */
export function parseStorageConfig(provider: StorageProvider, input: any): StorageConfig {
  if (provider === 'tencent') {
    // The form sends the generic names for every provider; COS keeps its own.
    return parseCosConfig({ ...input, secretId: text(input, 'secretId') || text(input, 'accessKeyId'), secretKey: text(input, 'secretKey') || text(input, 'secretAccessKey') });
  }
  const rule = PROVIDER_RULES[provider];
  const config: S3Config = {
    provider, accessKeyId: text(input, 'accessKeyId'), secretAccessKey: text(input, 'secretAccessKey'), bucket: text(input, 'bucket'),
    region: rule.region === 'fixed' ? rule.fixedRegion! : text(input, 'region'), prefix: cleanPrefix(text(input, 'prefix')),
  };
  if (!config.accessKeyId || !config.secretAccessKey) throw new Error('Access key and secret key are required.');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket)) throw new Error('Bucket must be 3 to 63 lowercase letters, digits, dots or hyphens.');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(config.region)) throw new Error('Region must look like us-east-1.');
  if (rule.needs === 'accountId') {
    config.accountId = text(input, 'accountId');
    if (!/^[a-f0-9]{32}$/i.test(config.accountId)) throw new Error('Account ID must be the 32-character Cloudflare account id.');
  }
  if (rule.needs === 'endpoint') {
    let url: URL;
    try { url = new URL(text(input, 'endpoint')); } catch { throw new Error('Endpoint must be a URL such as https://minio.example.com:9000.'); }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Endpoint must be an http(s) address without a path or credentials.');
    config.endpoint = url.origin;
  }
  return config;
}

/** Client settings of an S3-protocol provider (the factory table of the storage design). */
export function s3Settings(config: S3Config): { region: string; endpoint?: string; forcePathStyle: boolean } {
  const rule = PROVIDER_RULES[config.provider];
  const forcePathStyle = Boolean(rule.pathStyle);
  switch (config.provider) {
    case 'cloudflare': return { region: 'auto', endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`, forcePathStyle };
    case 'backblaze': return { region: config.region, endpoint: `https://s3.${config.region}.backblazeb2.com`, forcePathStyle };
    case 'gcs': return { region: 'auto', endpoint: 'https://storage.googleapis.com', forcePathStyle };
    case 'minio': return { region: config.region, endpoint: config.endpoint, forcePathStyle };
    default: return { region: config.region, forcePathStyle };
  }
}

/** Just the part of the SDK client the store uses; tests pass a fake. */
export interface S3Like { send(command: any): Promise<any> }

/** Every key is stored under `prefix`; `list` returns keys without it. `client` is for tests. */
export function s3Store(config: S3Config, client?: S3Like): ObjectStore {
  const { bucket: Bucket, prefix } = config;
  const settings = s3Settings(config);
  const s3: S3Like = client ?? new S3Client({
    region: settings.region, endpoint: settings.endpoint, forcePathStyle: settings.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    requestHandler: { requestTimeout: 60_000 },
    // Several S3-compatible services reject the SDK's default CRC32 trailer checksums.
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return {
    async put(key, body, contentType) { await s3.send(new PutObjectCommand({ Bucket, Key: prefix + key, Body: body, ContentType: contentType })); },
    async get(key) {
      try {
        const data = await s3.send(new GetObjectCommand({ Bucket, Key: prefix + key }));
        return { body: Buffer.from(await data.Body.transformToByteArray()), contentType: data.ContentType };
      } catch (err: any) {
        if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },
    async delete(key) { await s3.send(new DeleteObjectCommand({ Bucket, Key: prefix + key })); },
    async list(sub) {
      const found: Awaited<ReturnType<ObjectStore['list']>> = [];
      let ContinuationToken: string | undefined;
      for (;;) {
        const page = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix + sub, ContinuationToken, MaxKeys: 1000 }));
        for (const o of page.Contents || []) found.push({ key: String(o.Key).slice(prefix.length), size: Number(o.Size), etag: String(o.ETag), lastModified: o.LastModified ? new Date(o.LastModified).toISOString() : '' });
        if (!page.IsTruncated || !page.NextContinuationToken) return found;
        ContinuationToken = page.NextContinuationToken;
      }
    },
  };
}

/** The store for a saved configuration of any provider. */
export function buildStore(config: StorageConfig): ObjectStore {
  return 'provider' in config ? s3Store(config) : cosStore(config);
}

/** The provider a saved configuration belongs to. */
export const providerOf = (config: StorageConfig): StorageProvider => ('provider' in config ? config.provider : 'tencent');
