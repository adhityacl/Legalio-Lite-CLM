#!/usr/bin/env node
/**
 * Menerapkan integrasi RBAC ke `server.ts` secara IDEMPOTEN dan dapat direview.
 *
 * Dua tingkat:
 *   --tier=additive  (DEFAULT) Hanya memasang router /api/rbac/* — NOL perubahan perilaku.
 *   --tier=secure    Selain itu: menutup whitelist berbahaya (C4) dan memberi guard
 *                    izin pada endpoint admin-inti. Jalankan hanya setelah smoke test.
 *
 * Jalankan:
 *   node tools/apply-rbac-integration.mjs server.ts --tier=additive
 *   node tools/apply-rbac-integration.mjs server.ts --tier=secure --dry-run
 *
 * Sifat: idempoten — dijalankan ulang tidak mengubah apa pun (dideteksi lewat penanda).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2] ?? 'apps/backend/src/server.ts';
const tierArg = process.argv.find((a) => a.startsWith('--tier='));
const tier = (tierArg ? tierArg.split('=')[1] : 'additive');
const dryRun = process.argv.includes('--dry-run');
const TIERS = ['additive', 'secure', 'strict', 'strict2', 'strict3'];
const tierIdx = TIERS.indexOf(tier);
const atLeast = (t) => tierIdx >= TIERS.indexOf(t);
const doSecure = atLeast('secure');
const doStrict = atLeast('strict');
const doStrict2 = atLeast('strict2');
const doStrict3 = atLeast('strict3');

if (tierIdx < 0) {
  console.error(`tier tidak dikenal: ${tier} (pakai ${TIERS.join('|')})`);
  process.exit(2);
}

const MARK = '/* RBAC-INTEGRATION-V1 */';
const MARK_SECURE = '/* RBAC-INTEGRATION-V1-SECURE */';
const MARK_STRICT = '/* RBAC-INTEGRATION-V1-STRICT */';
const MARK_STRICT2 = '/* RBAC-INTEGRATION-V1-STRICT2 */';
const MARK_STRICT3 = '/* RBAC-INTEGRATION-V1-STRICT3 */';

let src = readFileSync(file, 'utf8');
const before = src;
const changes = [];

function replaceOnce(anchor, replacement, label) {
  const i = src.indexOf(anchor);
  if (i < 0) throw new Error(`anchor tidak ditemukan: ${label}`);
  if (src.indexOf(anchor, i + 1) >= 0) throw new Error(`anchor tidak unik: ${label}`);
  src = src.slice(0, i) + replacement + src.slice(i + anchor.length);
  changes.push(label);
}

function removeOnce(anchor, label) {
  const i = src.indexOf(anchor);
  if (i < 0) { changes.push(`${label} (sudah tidak ada)`); return; }
  src = src.slice(0, i) + src.slice(i + anchor.length);
  changes.push(label);
}

/* ---------- Tier additive ---------- */

if (!src.includes(MARK)) {
  const IMPORT_ANCHOR = 'import { createServer as createViteServer } from "vite";';
  replaceOnce(
    IMPORT_ANCHOR,
    IMPORT_ANCHOR + '\n' + MARK + '\nimport { createRbacRouter, requirePermission } from "./server/rbacRoutes";',
    'import router RBAC',
  );

  const MOUNT_ANCHOR = 'app.use(rbacAuthMiddleware);';
  const mountCode = [
    MOUNT_ANCHOR,
    '',
    MARK,
    '// Actor RBAC diambil dari sesi terverifikasi (better-auth / token sesi), bukan header yang bisa dipalsukan.',
    'const resolveRbacActor = async (req: any) => {',
    '  try {',
    '    const session = await betterAuthInstance.api.getSession({ headers: req.headers as any });',
    '    if (session?.user?.id) {',
    '      const u: any = sqliteDb.prepare("SELECT role FROM user WHERE id = ?").get(session.user.id);',
    '      const m: any = sqliteDb.prepare("SELECT organizationId, role FROM member WHERE userId = ? LIMIT 1").get(session.user.id);',
    '      const raw = (m?.role === "owner" ? "superuser" : (u?.role || m?.role || "viewer"));',
    '      return { id: session.user.id, role: String(raw).toLowerCase(), tenantId: m?.organizationId ?? null, departmentId: null };',
    '    }',
    '  } catch { /* lanjut ke fallback */ }',
    '  try {',
    '    const authHeader = req.headers["authorization"] || req.headers["x-session-token"];',
    '    if (authHeader && sqliteDb) {',
    '      const token = typeof authHeader === "string" && authHeader.startsWith("Bearer ") ? authHeader.substring(7).trim() : String(authHeader).trim();',
    '      const s: any = sqliteDb.prepare("SELECT userId FROM session WHERE token = ?").get(token);',
    '      if (s?.userId) {',
    '        const u: any = sqliteDb.prepare("SELECT role FROM user WHERE id = ?").get(s.userId);',
    '        return { id: s.userId, role: String(u?.role || "viewer").toLowerCase(), tenantId: null, departmentId: null };',
    '      }',
    '    }',
    '  } catch { /* tanpa actor */ }',
    '  return null;',
    '};',
    'const attachRbacActor = async (req: any, _res: any, next: any) => {',
    '  req.actor = await resolveRbacActor(req);',
    '  next();',
    '};',
    'app.use(attachRbacActor);',
    'app.use("/api/rbac", createRbacRouter({ resolveActor: (req: any) => req.actor ?? null }));',
  ].join('\n');
  replaceOnce(MOUNT_ANCHOR, mountCode, 'pasang /api/rbac + attach actor');
}

/* ---------- Tier secure ---------- */

if (doSecure && !src.includes(MARK_SECURE)) {
  removeOnce('    req.path === "/api/tenants/switch" ||\n', 'tutup whitelist /api/tenants/switch (C4)');
  removeOnce('    req.path.startsWith("/api/auth-console/organizations/") ||\n', 'tutup whitelist /api/auth-console/organizations/* (C4)');

  const MOUNT_ANCHOR2 = 'app.use("/api/rbac", createRbacRouter({ resolveActor: (req: any) => req.actor ?? null }));';
  replaceOnce(
    MOUNT_ANCHOR2,
    MOUNT_ANCHOR2 + '\n\n' + MARK_SECURE +
      '\n// Guard izin bertarget (jangan blanket — endpoint publik seperti invitations/accept harus tetap jalan).' +
      '\napp.use("/api/auth-console/users", requirePermission("admin.user.manage", "tenant"));' +
      '\napp.post("/api/tenants/switch", requirePermission("workspace.switch", "global"));' +
      '\napp.use("/api/tenants/switch", requirePermission("workspace.switch", "global"));',
    'guard endpoint admin-inti + workspace switch',
  );
}

/* ---------- Tier strict (menutup kebocoran anonim, C5) ---------- */

if (doStrict && !src.includes(MARK_STRICT)) {
  const ROLE_ANCHOR = '  // Determine role based on verified DB/Session role';
  const strictGuard = [
    '  ' + MARK_STRICT,
    '  // Identitas WAJIB berasal dari sesi terverifikasi (token di tabel session).',
    '  // Menutup kebocoran: request anonim sebelumnya diperlakukan sebagai Viewer.',
    '  {',
    '    let strictSessionOk = false;',
    '    if (authHeader && sqliteDb) {',
    '      try {',
    '        const t = typeof authHeader === "string" && authHeader.startsWith("Bearer ") ? authHeader.substring(7).trim() : String(authHeader).trim();',
    '        strictSessionOk = !!sqliteDb.prepare("SELECT userId FROM session WHERE token = ?").get(t);',
    '      } catch { strictSessionOk = false; }',
    '    }',
    '    if (!strictSessionOk) {',
    '      return res.status(401).json({ error: "UNAUTHENTICATED", message: "Authentication is required." });',
    '    }',
    '  }',
    '',
    ROLE_ANCHOR,
  ].join('\n');
  replaceOnce(ROLE_ANCHOR, strictGuard, 'STRICT: wajib sesi terverifikasi (401 untuk anonim)');

  const FALLBACK = [
    '  } else {',
    '    if (userEmail === "adhitcl@gmail.com") {',
    '      role = "Admin";',
    '    } else {',
    '      role = "Viewer";',
    '    }',
    '  }',
  ].join('\n');
  const FALLBACK_NEW = ['  } else {', '    role = "Viewer";', '  }'].join('\n');
  replaceOnce(FALLBACK, FALLBACK_NEW, 'STRICT: hapus fallback email superadmin yang di-hardcode');
}

/* ---------- Tier strict2 (persempit whitelist /api/auth) ---------- */

if (doStrict2 && !src.includes(MARK_STRICT2)) {
  // `/api/auth-console/*` ikut lolos karena prefix "/api/auth" ikut cocok.
  replaceOnce(
    '    req.path.startsWith("/api/auth") ||',
    '    ' + MARK_STRICT2 + '\n' +
      '    (req.path === "/api/auth" || req.path.startsWith("/api/auth/")) ||',
    'STRICT2: persempit whitelist /api/auth (auth-console ikut dijaga)',
  );
}

/* ---------- Tier strict3 (gerbangi sisa endpoint area admin) ---------- */

if (doStrict3 && !src.includes(MARK_STRICT3)) {
  const ANCHOR = 'app.use("/api/auth-console/users", requirePermission("admin.user.manage", "tenant"));';
  const guards = [
    ANCHOR,
    MARK_STRICT3,
    '// Area admin: sisa endpoint console yang sebelumnya hanya butuh login.',
    'app.use("/api/auth-console/sessions", requirePermission("admin.access", "tenant"));',
    'app.use("/api/auth-console/teams", requirePermission("admin.access", "tenant"));',
    'app.use("/api/auth-console/invitations", requirePermission("admin.access", "tenant"));',
    'app.use("/api/auth-console/api-keys", requirePermission("admin.access", "tenant"));',
    'app.use("/api/auth-console/organizations", requirePermission("admin.access", "tenant"));',
    'app.use("/api/auth-console/rbac-matrix", requirePermission("admin.access", "tenant"));',
    'app.use("/api/activity-logs", requirePermission("admin.access", "tenant"));',
  ].join('\n');
  replaceOnce(ANCHOR, guards, 'STRICT3: gerbangi sessions/teams/invitations/api-keys/organizations/rbac-matrix + activity-logs');
}

/* ---------- Simpan ---------- */

if (src === before) {
  console.log(`TIDAK ADA PERUBAHAN (tier=${tier}) — sudah diterapkan / idempoten.`);
  process.exit(0);
}

const summary = changes.map((c) => ` - ${c}`).join('\n');
if (dryRun) {
  console.log(`DRY-RUN tier=${tier}: ${changes.length} perubahan\n${summary}\n(before=${before.length}B after=${src.length}B)`);
  process.exit(0);
}

writeFileSync(file, src);
console.log(`DITERAPKAN tier=${tier}: ${changes.length} perubahan\n${summary}\n(before=${before.length}B after=${src.length}B)`);
