/**
 * Remembers the page a signed-out visitor asked for (including a record deep link) across the sign-in screen, in this tab's
 * sessionStorage only. Nothing here is trusted: the target goes through the normal route gate after sign-in.
 */
const KEY = 'legalio:return-to';
const TAB = /^[a-z0-9-]+$/;
const RECORD = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

export interface ReturnTo { tab: string; recordId: string | null }

export function rememberReturnTo(tab: string, recordId: string | null, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  if (!tab || tab === 'login' || !TAB.test(tab)) return;
  try { storage?.setItem(KEY, JSON.stringify({ tab, recordId: recordId && RECORD.test(recordId) ? recordId : null })); } catch { /* storage unavailable */ }
}

/** The remembered page, once: it is removed as it is read. */
export function takeReturnTo(storage: Pick<Storage, 'getItem' | 'removeItem'> | undefined = safeStorage()): ReturnTo | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    storage?.removeItem(KEY);
    const value = JSON.parse(raw) as Partial<ReturnTo>;
    if (typeof value.tab !== 'string' || !TAB.test(value.tab) || value.tab === 'login') return null;
    return { tab: value.tab, recordId: typeof value.recordId === 'string' && RECORD.test(value.recordId) ? value.recordId : null };
  } catch {
    return null;
  }
}

function safeStorage(): Storage | undefined {
  try { return typeof sessionStorage === 'undefined' ? undefined : sessionStorage; } catch { return undefined; }
}
