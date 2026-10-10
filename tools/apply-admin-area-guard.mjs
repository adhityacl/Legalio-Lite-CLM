#!/usr/bin/env node
/**
 * Menambahkan guard area-admin pada src/server/authConsoleRoutes.ts
 * SECARA LANGSUNG (dikirim via repo, tidak perlu patcher manual).
 *
 * Guard membatasi route area admin (sessions, organizations, teams,
 * invitations, api-keys, rbac-matrix) untuk peran admin ke atas
 * (superuser/admin/manager), membaca identitas dari token sesi.
 *
 * Sifat: idempoten (dilewati bila penanda sudah ada).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const file = process.argv[2] ?? 'apps/backend/src/authConsoleRoutes.ts';
const MARK = '/* RBAC-ADMIN-AREA-GUARD-V1 */';

if (!existsSync(file)) {
  console.error(`Tidak menemukan ${file}. Jalankan dari akar repo.`);
  process.exit(1);
}
let src = readFileSync(file, 'utf8');

if (src.includes(MARK)) {
  console.log('ALREADY PATCHED — guard area admin sudah ada. Tidak ada perubahan.');
  process.exit(0);
}

/* 1) Middleware guard (disisipkan setelah deklarasi router) */
const ROUTER_ANCHOR = "export const authConsoleRouter = Router();";
const GUARD_CODE = [
  ROUTER_ANCHOR,
  '',
  MARK,
  '// Guard area admin: hanya peran admin ke atas (identitas dari token sesi, bukan header email).',
  'const _adminAreaRoles = new Set(["superuser", "admin", "manager"]);',
  'authConsoleRouter.use(["/sessions", "/organizations", "/teams", "/invitations", "/api-keys", "/rbac-matrix"], (req: Request, res: Response, next: any) => {',
  '  try {',
  '    const token = ((req.headers["authorization"] || "").toString().replace(/^Bearer\\s+/i, "")',
  '      || (req.headers["x-session-token"] || "").toString()).trim();',
  '    if (!token || !sqliteDb) {',
  '      return res.status(401).json({ error: "UNAUTHENTICATED", message: "Authentication is required." });',
  '    }',
  '    const session = sqliteDb.prepare("SELECT userId FROM session WHERE token = ?").get(token) as any;',
  '    if (!session?.userId) {',
  '      return res.status(401).json({ error: "UNAUTHENTICATED", message: "Authentication is required." });',
  '    }',
  '    const user = sqliteDb.prepare("SELECT role, banned FROM user WHERE id = ?").get(session.userId) as any;',
  '    if (!user || user.banned === 1) {',
  '      return res.status(403).json({ error: "INSUFFICIENT_PERMISSION", message: "You do not have permission to access this area." });',
  '    }',
  '    const role = String(user.role || "").toLowerCase().trim();',
  '    if (!_adminAreaRoles.has(role)) {',
  '      return res.status(403).json({ error: "INSUFFICIENT_PERMISSION", message: "You do not have permission to access this area." });',
  '    }',
  '    next();',
  '  } catch {',
  '    return res.status(401).json({ error: "UNAUTHENTICATED", message: "Authentication is required." });',
  '  }',
  '});',
].join('\n');

function count(h, n) { return h.split(n).length - 1; }

if (count(src, ROUTER_ANCHOR) !== 1) {
  console.error(`Anchor router ditemukan ${count(src, ROUTER_ANCHOR)}x — tidak unik.`);
  process.exit(1);
}

src = src.replace(ROUTER_ANCHOR, GUARD_CODE);
writeFileSync(file, src);
console.log('PATCHED — guard area admin ditambahkan pada authConsoleRouter.');
console.log('Route yang dijaga: /sessions, /organizations, /teams, /invitations, /api-keys, /rbac-matrix');
console.log('Peran yang diizinkan: superuser, admin, manager');
