import { apiRequest, isApiError } from '../../api/client';

/**
 * Small client for the canonical organization API. Errors keep the server's
 * stable code (`VERSION_CONFLICT`, `LAST_ADMIN_REQUIRED`, …) so views can react.
 * Transport and error parsing are the central client's (src/api/client.ts).
 */
export class OrgApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function orgApi<T = any>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = (init.method || 'GET') as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  try {
    return await apiRequest<T>(path, { method, body: init.body, signal: init.signal, cache: 'no-store' });
  } catch (error) {
    if (!isApiError(error)) throw error;
    if (error.status === 404 && method === 'GET' && /^\/api\/organizations\/[^/]+\/[a-z-]+(\?|$)/.test(path)) {
      // Membership revoked/suspended while the page was open: drop this organization's context.
      const organizationId = decodeURIComponent(path.split('/')[3] || '');
      window.dispatchEvent(new CustomEvent('organization-access-lost', { detail: organizationId }));
    }
    // Code-first bodies carry the stable code in `error`; unified bodies carry it in `code`.
    throw new OrgApiError(error.status, error.code && error.code !== 'REQUEST_FAILED' ? error.code : error.error || 'REQUEST_FAILED', error.message);
  }
}

export const orgPath = (organizationId: string, suffix: string) => `/api/organizations/${encodeURIComponent(organizationId)}${suffix}`;
