/**
 * Unified API error body: { error, code, message, status, requestId }.
 *
 * - `code` is the stable machine identifier (what clients branch on).
 * - `message` is the human-readable text (localized by the localizeApiMessages middleware when it is a known sentence).
 * - `error` is kept for older clients that display it: the same text as `message`, except for the code-first responses of
 *   identity.sendError, where `error` has always been the code and still is.
 * Detail of an unexpected failure goes to the pino log with the request id, never into the body.
 */
import type express from 'express';
import { requestIdOf } from './identity';
import { childLogger } from './logger';

const log = childLogger('api');

export interface ApiErrorBody {
  error: string;
  code: string;
  message: string;
  status: number;
  requestId: string;
  [extra: string]: unknown;
}

export function apiErrorBody(req: express.Request, status: number, code: string, message: string, extra: Record<string, unknown> = {}): ApiErrorBody {
  return { error: message, code, message, status, requestId: requestIdOf(req), ...extra };
}

export function sendApiError(req: express.Request, res: express.Response, status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return res.status(status).json(apiErrorBody(req, status, code, message, extra));
}

/** An error whose message was written for end users (curated AI/limit/validation sentences) and may be shown as is. */
export class PublicError extends Error {
  readonly expose = true;
  constructor(message: string, public readonly status = 500, public readonly code = 'REQUEST_FAILED') {
    super(message);
  }
}

export const isPublicError = (err: unknown): err is Error & { expose: true } => (err as { expose?: unknown } | null)?.expose === true;

/**
 * Catch-block responder: logs the cause with the request id and answers with `fallback` (or the error's own message only
 * when it is a PublicError). Raw driver, filesystem and SDK messages never reach the client.
 */
export function sendRouteError(
  req: express.Request, res: express.Response, err: unknown, what: string, fallback: string,
  options: { status?: number; code?: string; extra?: Record<string, unknown> } = {},
) {
  const { status = 500, code = 'INTERNAL_ERROR', extra } = options;
  log.error({ err, requestId: requestIdOf(req), route: `${req.method} ${req.path}` }, what);
  if (isPublicError(err)) {
    const pub = err as PublicError & { apiCode?: string; details?: Record<string, unknown> };
    // Repository errors (409 VERSION_CONFLICT, 404, ...) carry their code as `apiCode`.
    return sendApiError(req, res, pub.status ?? status, pub.code ?? pub.apiCode ?? code, pub.message, { ...(pub.details ? { details: pub.details } : {}), ...extra });
  }
  return sendApiError(req, res, status, code, fallback, extra);
}
