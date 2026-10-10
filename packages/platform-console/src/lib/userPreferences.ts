/**
 * Browser-local personal preferences namespaced by identity (PRD §6.7):
 * `user:<userId>:language`, `user:<userId>:theme`,
 * `user:<userId>:customTranslations`. Origin-wide legacy keys
 * (`app_language`, `app_theme`, `app_custom_translations`) are ignored and
 * left untouched; signed-out pages use product defaults.
 */
let preferenceUserId: string | null = null;

export const setPreferenceUser = (userId: string | null) => {
  preferenceUserId = userId;
};

export const getPreferenceUser = () => preferenceUserId;

export function readPreference(name: 'language' | 'theme' | 'customTranslations', userId = preferenceUserId): string | null {
  if (!userId) return null;
  try {
    return localStorage.getItem(`user:${userId}:${name}`);
  } catch {
    return null;
  }
}

export function writePreference(name: 'language' | 'theme' | 'customTranslations', value: string | null, userId = preferenceUserId): void {
  if (!userId) return;
  try {
    if (value === null) localStorage.removeItem(`user:${userId}:${name}`);
    else localStorage.setItem(`user:${userId}:${name}`, value);
  } catch {
    /* storage unavailable: the preference lasts for this page only */
  }
}
