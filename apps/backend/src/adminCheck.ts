import express from 'express';
import { identityOf } from './identity';
/** Legacy admin gate used by platform-only routes (verified identity, never request-supplied roles). */

/**
 * Admin check based ONLY on the verified session identity. Earlier versions
 * also trusted e-mail addresses supplied in headers, body or query string;
 * the unused `_fallback*` parameters are kept for call-site compatibility.
 */
/**
 * Platform-administrator check from the verified identity only. Routes that
 * call this are already gated by a platform policy; this is defence in depth.
 * A tenant admin membership never makes this true.
 */
export async function checkIsAdmin(req: express.Request, _fallbackEmail?: string, _fallbackName?: string) {
  try {
    const identity = identityOf(req);
    return { isAdmin: identity.platformRole === "superuser", adminEmail: identity.email, adminName: identity.name || "Admin" };
  } catch {
    return { isAdmin: false, adminEmail: "", adminName: "" };
  }
}
