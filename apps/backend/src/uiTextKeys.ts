import { renameLegacyKeyTokens } from '@legalio/shared/fieldNames';
/** Admin UI-text overrides saved before the field rename carry old keys; they follow their texts to the new keys. */


// Aggregation Endpoint for Fast Initial Data Load (replaces multi-endpoint polling)
/**
 * Operational workspace payload (PRD §11.4): one verified organization,
 * department-scoped before any client aggregation, no tenant directory and
 * no provider configuration — only non-sensitive service availability.
 */
/** Admin UI-text overrides saved before the field rename carry old keys; they follow their texts to the new keys. */
export function withCurrentUiTextKeys(overrides: Record<string, Record<string, string>>) {
  return Object.fromEntries(Object.entries(overrides).map(([language, texts]) => [
    language,
    Object.fromEntries(Object.entries(texts || {})
      .filter(([key]) => renameLegacyKeyTokens(key) === key || !(renameLegacyKeyTokens(key) in texts))
      .map(([key, text]) => [renameLegacyKeyTokens(key), text])),
  ]));
}
