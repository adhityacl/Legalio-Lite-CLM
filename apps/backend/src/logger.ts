import crypto from 'node:crypto';
import pino from 'pino';
import type express from 'express';

/** Structured JSON logs. LOG_LEVEL: trace|debug|info|warn|error|fatal|silent (default info; error under tests). */
export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.APP_TEST_MODE ? 'error' : 'info'),
  base: { service: 'legalio-backend' },
  redact: { paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.smtpPassword', '*.geminiApiKey'], censor: '[redacted]' },
});

export const childLogger = (component: string) => logger.child({ component });

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Assigns `req.requestId` (a safe caller-supplied x-request-id, else a UUID), echoes it, and logs one line per finished request. */
export function requestLogging(): express.RequestHandler {
  const log = childLogger('http');
  return (req, res, next) => {
    if ((req as any).requestId) return next(); // already handled by the outer app
    const supplied = req.headers['x-request-id'];
    const requestId = typeof supplied === 'string' && SAFE_REQUEST_ID.test(supplied) ? supplied : crypto.randomUUID();
    (req as any).requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      // Static assets and health probes are noise at info level.
      if (level === 'info' && !req.originalUrl.startsWith('/api/')) return;
      log[level]({ requestId, method: req.method, url: req.originalUrl.split('?')[0], status: res.statusCode, ms: Math.round(ms) }, 'request');
    });
    next();
  };
}

/** Generic client body for an unhandled error; the detail only goes to the log. */
export function errorResponder(): express.ErrorRequestHandler {
  const log = childLogger('http');
  const TEXT: Record<number, string> = {
    400: 'The request could not be processed.', 401: 'Authentication is required.', 403: 'You do not have permission to perform this action.',
    404: 'Resource not found.', 409: 'The request conflicts with the current state.', 413: 'The request is too large.', 429: 'Too many requests.',
  };
  return (err, req, res, next) => {
    const requestId = (req as any).requestId || crypto.randomUUID();
    const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    log.error({ err, requestId, method: req.method, url: req.originalUrl?.split('?')[0], status }, 'unhandled error');
    if (res.headersSent) return next(err);
    if (!req.path.startsWith('/api/')) return next(err);
    const message = TEXT[status] || (status >= 500 ? 'An internal error occurred.' : 'The request could not be processed.');
    // `error` stays human-readable because existing clients display it; `code` is the stable identifier.
    res.status(status).json({ error: message, code: status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED', message, status, requestId });
  };
}

type Level = 'debug' | 'info' | 'warn' | 'error';
/** console-style call (`log.error('what failed:', err)`) routed to pino: strings form the message, Errors become `err`, the rest `details`. */
function compat(base: pino.Logger, level: Level) {
  return (...args: unknown[]) => {
    const text: string[] = [];
    const details: unknown[] = [];
    let err: unknown;
    for (const arg of args) {
      if (arg instanceof Error) err ??= arg;
      else if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') text.push(String(arg));
      else details.push(arg);
    }
    const bindings: Record<string, unknown> = {};
    if (err) bindings.err = err;
    if (details.length) bindings.details = details.length === 1 ? details[0] : details;
    base[level](bindings, text.join(' ') || (err as Error | undefined)?.message || 'event');
  };
}
export function componentLog(component: string) {
  const base = childLogger(component);
  return { info: compat(base, 'info'), warn: compat(base, 'warn'), error: compat(base, 'error'), debug: compat(base, 'debug') };
}
