/**
 * Per-tab organization selection (tenant-boundaries PRD §11.2).
 *
 * The selected organization lives in sessionStorage under
 * `activeOrganizationId:<userId>`, so two tabs of the same browser can work in
 * different organizations. It is only a request selector — the server
 * re-validates membership on every call. Origin-wide localStorage is never
 * used as an authoritative selector.
 */
type Listener = (organizationId: string | null) => void;

let currentUserId: string | null = null;
let currentOrganizationId: string | null = null;
let revision = 0;
const listeners = new Set<Listener>();

const keyFor = (userId: string) => `activeOrganizationId:${userId}`;

function readStored(userId: string): string | null {
  try {
    return sessionStorage.getItem(keyFor(userId)) || null;
  } catch {
    return null;
  }
}

/** Binds selection to the signed-in identity; returns the tab's saved (unvalidated) choice. */
export function bindSelectionToUser(userId: string | null): string | null {
  currentUserId = userId;
  currentOrganizationId = null;
  revision++;
  return userId ? readStored(userId) : null;
}

/** The tab's saved choice for the bound identity (unvalidated; the server decides). */
export function getSavedSelection(): string | null {
  return currentUserId ? readStored(currentUserId) : null;
}

export function getSelectedOrganizationId(): string | null {
  return currentOrganizationId;
}

/** Monotonic counter; responses captured under an older revision must be ignored (AC-026). */
export function getSelectionRevision(): number {
  return revision;
}

export function setSelectedOrganizationId(organizationId: string | null): void {
  currentOrganizationId = organizationId;
  revision++;
  if (currentUserId) {
    try {
      if (organizationId) sessionStorage.setItem(keyFor(currentUserId), organizationId);
      else sessionStorage.removeItem(keyFor(currentUserId));
    } catch {
      /* storage unavailable: selection stays in memory for this tab */
    }
  }
  listeners.forEach((listener) => listener(organizationId));
}

export function subscribeSelection(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Clears this tab's selection for the current identity (logout, revoked access). */
export function clearSelection(): void {
  setSelectedOrganizationId(null);
}
