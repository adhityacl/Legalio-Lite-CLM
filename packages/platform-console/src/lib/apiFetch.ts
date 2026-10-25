import { getSelectedOrganizationId } from './organizationSelection';

const readSessionToken = (): string | null => {
  try {
    return typeof window !== 'undefined' ? localStorage.getItem('auth_session_token') : null;
  } catch {
    return null;
  }
};

/**
 * Identity-scoped, platform and path-scoped routes never receive the tab's
 * organization selector (PRD §5.2, §9.1): the organization is in the path, the
 * call is about the caller's own identity, or it is platform-wide.
 */
const NO_SELECTOR = [
  /^\/api\/me(\/|$)/,
  /^\/api\/organizations\//,
  /^\/api\/invitations\//,
  /^\/api\/platform\//,
  /^\/api\/auth(\/|$)/,
  /^\/api\/auth-console\//,
  /^\/api\/system\//,
  /^\/api\/user\//,
  /^\/api\/tenants(\/switch)?\/?$/,
  /^\/api\/branding$/,
  /^\/api\/policy-packs$/,
  /^\/api\/platform-settings$/,
  /^\/api\/integrations\/storage\//,
  /^\/api\/(smtp|ai|mailer)\//,
  /^\/api\/admin\//,
  /^\/api\/rbac\/(matrix|roles)$/,
  /^\/api\/cron\//,
];

export const needsOrganizationSelector = (pathname: string): boolean =>
  (pathname.startsWith('/api/') || pathname.startsWith('/uploads/')) &&
  !pathname.startsWith('/uploads/') &&
  !NO_SELECTOR.some((pattern) => pattern.test(pathname));

/**
 * Headers for explicit API calls. Only the verified session token and, for
 * legacy tenant routes, the tab's selected organization — never identity or
 * role assertions (PRD §5.1).
 */
export const getAuthHeaders = (organizationId: string | null = getSelectedOrganizationId()) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const sessionToken = readSessionToken();
  if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;
  if (organizationId) headers['x-organization-id'] = organizationId;
  return headers;
};

/**
 * Adds the session token (and, for legacy tenant routes, the tab's selected
 * organization) to every same-origin `/api/*` and `/uploads/*` request that
 * does not set them explicitly.
 */
let installed = false;

function sameOriginPath(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    return parsed.pathname.startsWith('/api/') || parsed.pathname.startsWith('/uploads/') ? parsed.pathname : null;
  } catch {
    return null;
  }
}

export function installApiFetchInterceptor(): void {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  const originalFetch = window.fetch.bind(window);

  const interceptedFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const pathname = sameOriginPath(url);
    if (!pathname) return originalFetch(input, init);

    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    const token = readSessionToken();
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
    const organizationId = getSelectedOrganizationId();
    if (organizationId && needsOrganizationSelector(pathname) && !headers.has('x-organization-id')) {
      headers.set('x-organization-id', organizationId);
    }
    if (!needsOrganizationSelector(pathname)) {
      headers.delete('x-organization-id');
      headers.delete('x-tenant-id');
    }
    return originalFetch(input, { ...init, headers, credentials: init?.credentials ?? 'include' });
  };

  try {
    window.fetch = interceptedFetch;
  } catch {
    try {
      Object.defineProperty(window, 'fetch', { configurable: true, enumerable: true, value: interceptedFetch, writable: true });
    } catch {
      return;
    }
  }
  installed = true;
}
