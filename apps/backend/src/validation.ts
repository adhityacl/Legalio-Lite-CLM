/** Request-body validation: parse with a zod schema, replace `req.body` with the parsed (whitelisted) value, or answer 400. */
import type express from 'express';
import type { z } from 'zod';
import { sendApiError } from './apiErrors';

const MAX_ISSUES = 20;

const valueAt = (root: unknown, path: ReadonlyArray<PropertyKey>): unknown => {
  let current: any = root;
  for (const key of path) current = current == null ? undefined : current[key as any];
  return current;
};
const isBlank = (value: unknown) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

export interface ValidateOptions {
  /** Message for the case where the only problems are missing/blank fields: keeps each route's long-standing sentence. */
  requiredMessage?: string;
}

/**
 * Zod objects drop keys they do not declare, so the schema is also the field whitelist: handlers see only declared fields.
 * Failure body: the unified error with code VALIDATION_FAILED and `issues: [{ path, message }]`.
 */
export function validateBody<T extends z.ZodType>(schema: T, options: ValidateOptions = {}): express.RequestHandler {
  return (req, res, next) => {
    const input = req.body ?? {};
    const result = schema.safeParse(input);
    if (result.success) {
      req.body = result.data;
      return next();
    }
    const issues = result.error.issues.slice(0, MAX_ISSUES).map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }));
    const onlyMissing = result.error.issues.every((issue) => isBlank(valueAt(input, issue.path)));
    const message = onlyMissing && options.requiredMessage
      ? options.requiredMessage
      : `Invalid request: ${issues[0] ? `${issues[0].path || 'body'} ${issues[0].message}` : 'body'}`;
    return sendApiError(req, res, 400, 'VALIDATION_FAILED', message, { issues });
  };
}
