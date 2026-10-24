/**
 * The one HTTP client of the application. Every call to the backend goes through `apiRequest` / `apiRequestWithMeta`:
 *
 * - same-origin `/api/...` with cookies (`credentials: 'include'`); the session token and the tab's organization selector are added by
 *   the global fetch interceptor (lib/apiFetch.ts), or passed explicitly with `organizationId` when a call must stay bound to the
 *   workspace that started it;
 * - JSON in and out (`FormData`, strings and Blobs are sent as they are);
 * - one error shape, `ApiError { error, code, message, status, requestId }`, whatever failed (HTTP error, network, timeout, bad body);
 * - a request id is sent in `X-Request-Id`, echoed by the server, and returned with every result and error so a failure can be found in the logs;
 * - a 401 on an authenticated call tells the session layer (`auth-session-invalid`) so the user is returned to sign-in;
 * - `signal` aborts the request (the AbortError is passed through untouched so TanStack Query can ignore it).
 */

export interface ApiErrorShape {
  error: string;
  code: string;
  message: string;
  status: number;
  requestId: string | null;
}

export class ApiError extends Error implements ApiErrorShape {
  readonly error: string;
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  /** Anything else the server put in the error body (validation `issues`, conflict `details`, ...). */
  readonly body: Record<string, unknown>;
  constructor(shape: { message: string; status: number; code?: string; error?: string; requestId?: string | null; body?: Record<string, unknown> }) {
    super(shape.message);
    this.name = 'ApiError';
    this.message = shape.message;
    this.error = shape.error ?? shape.message;
    this.code = shape.code ?? (shape.status === 0 ? 'NETWORK_ERROR' : 'REQUEST_FAILED');
    this.status = shape.status;
    this.requestId = shape.requestId ?? null;
    this.body = shape.body ?? {};
  }
  toJSON(): ApiErrorShape {
    return { error: this.error, code: this.code, message: this.message, status: this.status, requestId: this.requestId };
  }
}

export const isApiError = (value: unknown): value is ApiError => value instanceof ApiError;
export const isAbortError = (value: unknown): boolean => (value as { name?: unknown } | null)?.name === 'AbortError';

type QueryValue = string | number | boolean | null | undefined;
export type ApiQuery = Record<string, QueryValue>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: ApiQuery;
  /** Plain objects and arrays are JSON-encoded; FormData, Blob, ArrayBuffer and strings are sent unchanged. */
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Pins the call to one organization (header), instead of the tab's current selection at send time. */
  organizationId?: string | null;
  /** Fails with `ApiError { code: 'TIMEOUT' }` after this many milliseconds. */
  timeoutMs?: number;
  keepalive?: boolean;
  cache?: RequestCache;
  requestId?: string;
  /** A 401 normally signals the session layer; disable for calls where it is an expected answer. */
  notifyUnauthorized?: boolean;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Headers;
  requestId: string | null;
  /** `X-Total-Count` of paged lists, when present. */
  total: number | null;
}

const newRequestId = (): string => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/** Paths where a 401 is part of normal operation (signing in, probing the session). */
const UNAUTHORIZED_IS_EXPECTED = [/^\/api\/auth(\/|$)/, /^\/api\/me(\/|$)/, /^\/api\/system\/(public-status|setup)/];

const listeners = new Set<(info: { path: string; requestId: string | null }) => void>();
/** For code that must react to a rejected session (tests, non-React callers). The window event below serves the React tree. */
export function onUnauthorized(listener: (info: { path: string; requestId: string | null }) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function notifyUnauthorized(path: string, requestId: string | null) {
  for (const listener of listeners) listener({ path, requestId });
  const target = globalThis as { dispatchEvent?: (event: Event) => boolean; CustomEvent?: typeof CustomEvent };
  if (typeof target.dispatchEvent === 'function' && typeof target.CustomEvent === 'function') {
    target.dispatchEvent(new target.CustomEvent('auth-session-invalid', { detail: { path, requestId } }));
  }
}

const apiPath = (path: string) =>
  path.startsWith('/api/') || path === '/api' || path.startsWith('/uploads/') ? path : `/api${path.startsWith('/') ? path : `/${path}`}`;

export function withQuery(path: string, query?: ApiQuery): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  const text = params.toString();
  return text ? `${path}${path.includes('?') ? '&' : '?'}${text}` : path;
}

const isPlainBody = (body: unknown) =>
  body !== null && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !(body instanceof URLSearchParams);

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  if ((response.headers.get('content-type') || '').includes('json')) {
    try { return JSON.parse(text); } catch { return { __unparsed: text }; }
  }
  return text;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

interface Sent { response: Response; requestId: string; echoed: string | null; target: string }

async function send(path: string, options: RequestOptions, accept: string): Promise<Sent> {
  const target = withQuery(apiPath(path), options.query);
  const method = options.method ?? (options.body !== undefined ? 'POST' : 'GET');
  const requestId = options.requestId ?? newRequestId();
  const headers: Record<string, string> = { Accept: accept, 'X-Request-Id': requestId, ...options.headers };
  let body: BodyInit | undefined;
  if (options.body !== undefined && options.body !== null) {
    if (isPlainBody(options.body)) {
      headers['Content-Type'] ??= 'application/json';
      body = JSON.stringify(options.body);
    } else body = options.body as BodyInit;
  }
  if (options.organizationId) headers['x-organization-id'] = options.organizationId;

  let signal = options.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  if (options.timeoutMs) {
    const controller = new AbortController();
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs);
    options.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    if (options.signal?.aborted) controller.abort();
    signal = controller.signal;
  }

  let response: Response;
  try {
    response = await fetch(target, { method, headers, body, signal, credentials: 'include', keepalive: options.keepalive, cache: options.cache });
  } catch (error) {
    if (timedOut) throw new ApiError({ message: 'The request timed out.', status: 0, code: 'TIMEOUT', requestId });
    if (isAbortError(error)) throw error;
    throw new ApiError({ message: 'The server could not be reached.', status: 0, code: 'NETWORK_ERROR', requestId });
  } finally {
    if (timer) clearTimeout(timer);
  }

  return { response, requestId, echoed: response.headers.get('x-request-id'), target };
}

/** Turns a non-2xx response into the thrown ApiError (and tells the session layer about a 401). */
function failure(path: string, options: RequestOptions, response: Response, parsed: unknown, requestId: string, echoed: string | null): ApiError {
  const record = asRecord(parsed);
  const message = String(record.message || record.error || (typeof parsed === 'string' && parsed.length < 300 ? parsed : '') || `HTTP ${response.status}`);
  const known = new Set(['error', 'code', 'message', 'status', 'requestId']);
  const error = new ApiError({
    message,
    error: String(record.error || message),
    code: typeof record.code === 'string' ? record.code : undefined,
    status: response.status,
    requestId: typeof record.requestId === 'string' ? record.requestId : echoed ?? requestId,
    body: Object.fromEntries(Object.entries(record).filter(([key]) => !known.has(key))),
  });
  if (response.status === 401 && options.notifyUnauthorized !== false && !UNAUTHORIZED_IS_EXPECTED.some((pattern) => pattern.test(apiPath(path).split('?')[0]))) {
    notifyUnauthorized(apiPath(path), error.requestId);
  }
  return error;
}

export async function apiRequestWithMeta<T = unknown>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  const { response, requestId, echoed } = await send(path, options, 'application/json');
  const parsed = await readBody(response).catch(() => undefined);
  if (!response.ok) throw failure(path, options, response, parsed, requestId, echoed);
  if (asRecord(parsed).__unparsed !== undefined) {
    throw new ApiError({ message: 'The server answered with an unreadable response.', status: response.status, code: 'INVALID_RESPONSE', requestId: echoed ?? requestId });
  }
  const total = Number(response.headers.get('x-total-count'));
  return { data: parsed as T, status: response.status, headers: response.headers, requestId: echoed ?? requestId, total: response.headers.has('x-total-count') && Number.isFinite(total) ? total : null };
}

/** A binary download (an uploaded file, an approval attachment) with the same transport and error handling. */
export async function apiBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const { response, requestId, echoed } = await send(path, options, '*/*');
  if (!response.ok) throw failure(path, options, response, await readBody(response).catch(() => undefined), requestId, echoed);
  return response.blob();
}

export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  return (await apiRequestWithMeta<T>(path, options)).data;
}

/** Convenience verbs. */
export const api = {
  get: <T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}) => apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) => apiRequest<T>(path, { ...options, method: 'POST', body: body ?? {} }),
  put: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) => apiRequest<T>(path, { ...options, method: 'PUT', body: body ?? {} }),
  patch: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) => apiRequest<T>(path, { ...options, method: 'PATCH', body: body ?? {} }),
  delete: <T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}) => apiRequest<T>(path, { ...options, method: 'DELETE' }),
};

/** Text for the user: the server's own message when it sent one, otherwise the caller's fallback. */
export function errorMessage(error: unknown, fallback: string): string {
  if (isApiError(error) && error.status > 0 && error.message && !/^HTTP \d+$/.test(error.message)) return error.message;
  if (error instanceof Error && error.message && !isApiError(error)) return error.message;
  return fallback;
}
