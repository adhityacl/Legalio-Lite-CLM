/**
 * Small client for the canonical organization API. Errors keep the server's
 * stable code (`VERSION_CONFLICT`, `LAST_ADMIN_REQUIRED`, …) so views can react.
 */
export class OrgApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function orgApi<T = any>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method || 'GET',
    headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
    signal: init.signal,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 404 && (init.method || 'GET') === 'GET' && /^\/api\/organizations\/[^/]+\/[a-z-]+(\/google)?(\?|$)/.test(path)) {
      // Membership revoked/suspended while the page was open: drop this organization's context.
      const organizationId = decodeURIComponent(path.split('/')[3] || '');
      window.dispatchEvent(new CustomEvent('organization-access-lost', { detail: organizationId }));
    }
    throw new OrgApiError(res.status, data?.error || 'REQUEST_FAILED', data?.message || data?.error || `HTTP ${res.status}`);
  }
  return data as T;
}

export const orgPath = (organizationId: string, suffix: string) => `/api/organizations/${encodeURIComponent(organizationId)}${suffix}`;
