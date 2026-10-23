import { open, seal } from './secretBox';
import { componentLog } from './logger';

const log = componentLog('secrets');

/** Fields of the provider configuration (app_settings 'google_config') that are encrypted at rest. */
export const SEALED_PROVIDER_FIELDS = ['smtpPassword', 'geminiApiKey', 'accessToken', 'refreshToken'] as const;

const isSealed = (value: unknown): value is string => typeof value === 'string' && value.startsWith('v1:');

// Sealing is randomized, so the same secret would produce a different payload on every save and defeat the
// "write only when changed" check. Remember the sealed form of each plaintext seen in this process.
const sealedFor = new Map<string, string>();

/** Copy of the configuration with every non-empty secret field sealed (already-sealed values are kept). */
export function sealProviderSecrets<T extends Record<string, any>>(config: T): T {
  const copy: Record<string, any> = { ...config };
  for (const field of SEALED_PROVIDER_FIELDS) {
    const value = copy[field];
    if (typeof value !== 'string' || !value || isSealed(value)) continue;
    let sealed = sealedFor.get(value);
    if (!sealed) sealedFor.set(value, sealed = seal(value));
    copy[field] = sealed;
  }
  return copy as T;
}

/**
 * Copy with secrets decrypted. Legacy plaintext values pass through unchanged (they are sealed by the next save).
 * A sealed value that cannot be opened (BETTER_AUTH_SECRET changed, or tampering) becomes empty and is logged:
 * the operator has to enter that secret again.
 */
export function openProviderSecrets<T extends Record<string, any>>(config: T): T {
  const copy: Record<string, any> = { ...config };
  for (const field of SEALED_PROVIDER_FIELDS) {
    const value = copy[field];
    if (!isSealed(value)) continue;
    try {
      const plain = open(value);
      sealedFor.set(plain, value);
      copy[field] = plain;
    } catch {
      log.error(`Stored ${field} cannot be decrypted (was BETTER_AUTH_SECRET changed?); enter it again in Settings.`);
      copy[field] = '';
    }
  }
  return copy as T;
}

/** True when any secret field still holds a plaintext value (diagnostics and tests). */
export const hasPlaintextSecrets = (config: Record<string, any> | null | undefined) =>
  SEALED_PROVIDER_FIELDS.some(field => typeof config?.[field] === 'string' && config[field] && !isSealed(config[field]));
