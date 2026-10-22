import crypto from 'node:crypto';

// Same fallback as lib/auth.ts. Changing BETTER_AUTH_SECRET makes sealed values unreadable.
const key = () => Buffer.from(crypto.hkdfSync('sha256', process.env.BETTER_AUTH_SECRET || 'insecure-development-secret-change-me', 'legalio', 'integration-credentials', 32));

/** AES-256-GCM: 'v1:' + base64(iv | tag | ciphertext). */
export function seal(text: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return 'v1:' + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

/** Throws when the value was tampered with or sealed under another secret. */
export function open(sealed: string): string {
  if (!sealed.startsWith('v1:')) throw new Error('Unknown sealed value format.');
  const raw = Buffer.from(sealed.slice(3), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12), { authTagLength: 16 });
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
