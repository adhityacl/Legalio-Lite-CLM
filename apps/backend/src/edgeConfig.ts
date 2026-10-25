import type express from 'express';
import { rateLimit } from 'express-rate-limit';

/*
 * Edge-facing configuration: which proxy hops are trusted for X-Forwarded-*, and the request limits for
 * unauthenticated, abuse-prone endpoints. Everything is overridable by environment variable.
 */

/**
 * Value for Express's `trust proxy`. TRUST_PROXY accepts a hop count ("1"), "true"/"false", or a comma separated list of
 * addresses/ranges/keywords ("loopback, uniquelocal, 10.0.0.0/8"). The default trusts only loopback and private ranges, which is
 * where a bundled nginx / Docker network / local reverse proxy connects from, so a client on the public internet cannot choose
 * its own address with a forged X-Forwarded-For header.
 */
export function trustProxySetting(env: NodeJS.ProcessEnv = process.env): boolean | number | string {
  const raw = (env.TRUST_PROXY ?? '').trim();
  if (!raw) return 'loopback, linklocal, uniquelocal';
  if (/^(true|false)$/i.test(raw)) return raw.toLowerCase() === 'true';
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

const positiveInt = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export interface RateLimitOptions { windowMs: number; max: number; disabled: boolean }

/** RATE_LIMIT_WINDOW_MS (default 60000), RATE_LIMIT_AUTH_MAX (default 30 per window per client), RATE_LIMIT_DISABLED=true. */
export function rateLimitOptions(env: NodeJS.ProcessEnv = process.env): RateLimitOptions {
  return {
    windowMs: positiveInt(env.RATE_LIMIT_WINDOW_MS, 60_000),
    max: positiveInt(env.RATE_LIMIT_AUTH_MAX, 30),
    // Test runs share one client address and hammer the endpoints on purpose.
    disabled: env.RATE_LIMIT_DISABLED === 'true' || env.APP_TEST_MODE === '1',
  };
}

/** Sensitive public write endpoints: sign-in/sign-up (Better Auth), first-run setup/database step, cron trigger. */
export const RATE_LIMITED_PATHS = [
  /^\/api\/auth(\/|$)/,
  /^\/api\/system\/(setup|database)\/?$/,
  /^\/api\/cron(\/|$)/,
];

export function createSensitiveRateLimiter(options: RateLimitOptions = rateLimitOptions()): express.RequestHandler {
  if (options.disabled) return (_req, _res, next) => next();
  const limiter = rateLimit({
    windowMs: options.windowMs,
    limit: options.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' },
  });
  return (req, res, next) => {
    // Reads (session lookups, client ids) are cheap and frequent; the limit protects the credential and setup writes.
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    if (!RATE_LIMITED_PATHS.some((re) => re.test(req.path))) return next();
    return limiter(req, res, next);
  };
}
