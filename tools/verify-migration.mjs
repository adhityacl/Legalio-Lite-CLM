#!/usr/bin/env node
/**
 * Memverifikasi migrasi RBAC secara NYATA: membuat DB SQLite sementara,
 * menjalankan migrasi DUA KALI (uji idempotensi), lalu memeriksa tabel,
 * jumlah baris, integritas FK, dan kesesuaian dengan engine.
 *
 * Jalankan: node tools/verify-migration.mjs [fileSql]
 * Output:   qc-output/migration-verification.json
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const sqlFile = process.argv[2] ?? 'apps/backend/src/migrations/001_rbac_alignment.sql';
const sql = readFileSync(sqlFile, 'utf8');

const tmp = 'qc-output/_migration_test.db';
rmSync(tmp, { force: true });
mkdirSync('qc-output', { recursive: true });

const db = new DatabaseSync(tmp);
db.exec('PRAGMA foreign_keys = ON;');

const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
const tables = () => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rbac_%' OR name='audit_log' ORDER BY name").all().map((r) => r.name);

/* --- run 1 --- */
db.exec(sql);
const after1 = {
  tables: tables(),
  roles: count('rbac_roles'),
  permissions: count('rbac_permissions'),
  role_permissions: count('rbac_role_permissions'),
  audit_log: count('audit_log'),
};

/* --- run 2 (idempotensi) --- */
db.exec(sql);
const after2 = {
  tables: tables(),
  roles: count('rbac_roles'),
  permissions: count('rbac_permissions'),
  role_permissions: count('rbac_role_permissions'),
  audit_log: count('audit_log'),
};

/* --- integritas FK & isi --- */
const fkErrors = db.prepare('PRAGMA foreign_key_check;').all();
const superuserPerms = db.prepare("SELECT COUNT(*) AS n FROM rbac_role_permissions WHERE role_code='superuser'").get().n;
const adminPerms = db.prepare("SELECT COUNT(*) AS n FROM rbac_role_permissions WHERE role_code='admin'").get().n;
const auditForAdmin = db.prepare("SELECT COUNT(*) AS n FROM rbac_role_permissions WHERE role_code='admin' AND permission_code='audit.view'").get().n;

/* --- integritas insert audit_log nyata --- */
const ins = db.prepare(`INSERT INTO audit_log (id, actor_id, action, target_type, target_id, tenant_id, department_id, impersonated_by, metadata)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
ins.run('ev-1', 'u-super', 'user.role.assign', 'USER', 'u-x', 't1', 'd1', 'u-super', JSON.stringify({ previousRole: 'viewer', newRole: 'editor' }));
const auditRow = db.prepare('SELECT * FROM audit_log WHERE id = ?').get('ev-1');

db.close();

const idempotent = JSON.stringify(after1) === JSON.stringify(after2);
const report = {
  sqlFile,
  generatedAt: new Date().toISOString(),
  run1: after1,
  run2: after2,
  idempotent,
  foreignKeyViolations: fkErrors.length,
  checks: {
    superuserGetsAllPermissions: superuserPerms === 32,
    adminPermissionCount: adminPerms,
    adminHasNoAuditView: auditForAdmin === 0,
    auditRowWritesAndReadsBack: auditRow?.action === 'user.role.assign' && auditRow?.impersonated_by === 'u-super',
  },
  auditSample: auditRow ?? null,
};

writeFileSync('qc-output/migration-verification.json', JSON.stringify(report, null, 2));

const pass = idempotent && fkErrors.length === 0
  && report.checks.superuserGetsAllPermissions
  && report.checks.adminHasNoAuditView
  && report.checks.auditRowWritesAndReadsBack;

console.log(JSON.stringify(report, null, 2));
console.log(pass ? '\nVERDICT: LULUS' : '\nVERDICT: GAGAL');
process.exit(pass ? 0 : 1);
