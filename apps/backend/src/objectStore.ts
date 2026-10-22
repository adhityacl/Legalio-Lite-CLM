import { createHash, randomUUID } from 'node:crypto';
import COS from 'cos-nodejs-sdk-v5';

/** Upload storage. Buffers, not streams: uploads are capped at 30 MB and the Drive backup needs the bytes anyway. */
export interface ObjectStore {
  put(key: string, body: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<{ body: Buffer; contentType?: string } | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<Array<{ key: string; size: number; etag: string; lastModified: string }>>;
}

export interface CosConfig { secretId: string; secretKey: string; bucket: string; region: string; prefix: string }

/** Tests and APP_TEST_MODE only: contents live and die with the process. */
export function memoryStore(): ObjectStore {
  const objects = new Map<string, { body: Buffer; contentType?: string; lastModified: string }>();
  return {
    async put(key, body, contentType) { objects.set(key, { body: Buffer.from(body), contentType, lastModified: new Date().toISOString() }); },
    async get(key) {
      const found = objects.get(key);
      return found ? { body: Buffer.from(found.body), contentType: found.contentType } : null;
    },
    async delete(key) { objects.delete(key); },
    async list(prefix) {
      return [...objects].filter(([key]) => key.startsWith(prefix))
        .map(([key, o]) => ({ key, size: o.body.length, etag: createHash('md5').update(o.body).digest('hex'), lastModified: o.lastModified }));
    },
  };
}

/** Validated, trimmed COS settings. Bucket and region end up in the SDK's host name, so they must not be able to point it elsewhere. */
export function parseCosConfig(input: any): CosConfig {
  const text = (name: string) => (typeof input?.[name] === 'string' ? input[name].trim() : '');
  const config = { secretId: text('secretId'), secretKey: text('secretKey'), bucket: text('bucket'), region: text('region'), prefix: text('prefix') };
  if (!config.secretId || !config.secretKey) throw new Error('SecretId and SecretKey are required.');
  if (!/^[a-z0-9-]+-\d+$/.test(config.bucket)) throw new Error('Bucket must look like name-1250000000.');
  if (!/^[a-z]+(-[a-z0-9]+)+$/.test(config.region)) throw new Error('Region must look like ap-jakarta.');
  if (config.prefix.startsWith('/') || config.prefix.includes('\\') || config.prefix.includes('\0') || config.prefix.split('/').includes('..')) throw new Error('Prefix must be a relative folder without "..".');
  if (config.prefix && !config.prefix.endsWith('/')) config.prefix += '/';
  return config;
}

type CosClient = Pick<COS, 'putObject' | 'getObject' | 'deleteObject' | 'getBucket'>;

/** Every key is stored under `prefix`; `list` returns keys without it. `client` is for tests. */
export function cosStore(input: CosConfig, client?: CosClient): ObjectStore {
  const { secretId, secretKey, bucket: Bucket, region: Region, prefix } = parseCosConfig(input);
  const cos = client ?? new COS({ SecretId: secretId, SecretKey: secretKey, Timeout: 60000 });
  return {
    async put(key, body, contentType) { await cos.putObject({ Bucket, Region, Key: prefix + key, Body: body, ContentType: contentType }); },
    async get(key) {
      try {
        const data = await cos.getObject({ Bucket, Region, Key: prefix + key });
        return { body: data.Body, contentType: data.headers?.['content-type'] };
      } catch (err: any) {
        if (err?.statusCode === 404) return null;
        throw err;
      }
    },
    async delete(key) { await cos.deleteObject({ Bucket, Region, Key: prefix + key }); },
    async list(sub) {
      const found: Awaited<ReturnType<ObjectStore['list']>> = [];
      let Marker: string | undefined;
      // COS returns at most 1000 keys per call.
      for (;;) {
        const page = await cos.getBucket({ Bucket, Region, Prefix: prefix + sub, Marker, MaxKeys: 1000 });
        for (const o of page.Contents || []) found.push({ key: o.Key.slice(prefix.length), size: Number(o.Size), etag: o.ETag, lastModified: o.LastModified });
        const next = page.NextMarker || page.Contents?.at(-1)?.Key;
        if (String(page.IsTruncated) !== 'true' || !next || next === Marker) return found;
        Marker = next;
      }
    },
  };
}

/** Write, read back and delete a throwaway object, so bad credentials fail before they are saved. */
export async function probe(store: ObjectStore) {
  const key = `.legalio-probe-${randomUUID()}`;
  const body = Buffer.from(key);
  await store.put(key, body, 'text/plain');
  try {
    if (!(await store.get(key))?.body.equals(body)) throw new Error('The test object could not be read back.');
  } finally {
    await store.delete(key);
  }
}

/** Storage key of a `/uploads/...` link, or null for anything that could escape or name a hidden object. */
export function keyFromLink(link: string): string | null {
  if (typeof link !== 'string' || !link.startsWith('/uploads/')) return null;
  let key: string;
  try {
    key = decodeURIComponent(link.slice('/uploads/'.length));
  } catch {
    return null;
  }
  if (!key || key.includes('\0') || key.includes('\\') || key.split('/').some(segment => segment.startsWith('.'))) return null;
  return key;
}
