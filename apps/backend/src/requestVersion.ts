import type express from 'express';

/** `version` from the body or an `If-Match` header (`"3"`, `W/"3"` or `3`); undefined when the client sent none. */
export function requestedVersion(req: express.Request, bodyVersion: unknown): number | undefined {
  const raw = bodyVersion ?? String(req.headers['if-match'] ?? '').replace(/^W\//, '').replace(/"/g, '');
  const version = Number(raw);
  return raw !== '' && raw != null && Number.isInteger(version) && version > 0 ? version : undefined;
}
