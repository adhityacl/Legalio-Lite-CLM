/** File-storage providers the app can write uploads to; shared so the setup forms and the server agree. */
export const STORAGE_PROVIDERS = ['tencent', 'aws', 'cloudflare', 'backblaze', 'gcs', 'minio'] as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<StorageProvider, string> = {
  tencent: 'Tencent COS', aws: 'Amazon S3', cloudflare: 'Cloudflare R2', backblaze: 'Backblaze B2', gcs: 'Google Cloud Storage (HMAC)', minio: 'MinIO / S3-compatible',
};

/** Which optional fields a provider's form shows (every provider has access key, secret key, bucket and prefix). */
export const PROVIDER_FIELDS: Record<StorageProvider, { region: boolean; accountId: boolean; endpoint: boolean }> = {
  tencent: { region: true, accountId: false, endpoint: false },
  aws: { region: true, accountId: false, endpoint: false },
  cloudflare: { region: false, accountId: true, endpoint: false },
  backblaze: { region: true, accountId: false, endpoint: false },
  gcs: { region: false, accountId: false, endpoint: false },
  minio: { region: false, accountId: false, endpoint: true },
};

/** Example values for the form placeholders. */
export const PROVIDER_HINTS: Record<StorageProvider, { bucket: string; region: string }> = {
  tencent: { bucket: 'legalio-1250000000', region: 'ap-jakarta' },
  aws: { bucket: 'legalio-files', region: 'ap-southeast-1' },
  cloudflare: { bucket: 'legalio-files', region: '' },
  backblaze: { bucket: 'legalio-files', region: 'us-west-004' },
  gcs: { bucket: 'legalio-files', region: '' },
  minio: { bucket: 'legalio-files', region: '' },
};

/** Access-key and secret-key labels as the provider's console names them. */
export const PROVIDER_KEY_LABELS: Record<StorageProvider, { access: string; secret: string }> = {
  tencent: { access: 'SecretId', secret: 'SecretKey' },
  aws: { access: 'Access key ID', secret: 'Secret access key' },
  cloudflare: { access: 'Access key ID', secret: 'Secret access key' },
  backblaze: { access: 'Key ID', secret: 'Application key' },
  gcs: { access: 'HMAC access key', secret: 'HMAC secret' },
  minio: { access: 'Access key', secret: 'Secret key' },
};
