-- ============================================================================
-- 001_rbac_alignment.sql
-- DIHASILKAN OTOMATIS oleh tools/gen-rbac-migration.ts dari server/rbac.ts.
-- JANGAN diedit manual — ubah engine lalu regenerasi.
-- Dihasilkan: 2026-09-20T20:16:33.044Z
--
-- Sifat: ADITIF dan IDEMPOTEN (aman dijalankan berulang).
-- Tidak menyentuh tabel better-auth yang sudah ada (user/session/member/...).
-- ============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS rbac_roles (
  id          TEXT PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  level       INTEGER NOT NULL,
  scope       TEXT NOT NULL,
  description TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO rbac_roles (id, code, name, level, scope, description) VALUES ('role-superuser', 'superuser', 'Superuser', 1, 'Global', 'Global owner with access to all tenants');
INSERT OR IGNORE INTO rbac_roles (id, code, name, level, scope, description) VALUES ('role-admin', 'admin', 'Admin', 2, 'Tenant', 'Tenant administrator');
INSERT OR IGNORE INTO rbac_roles (id, code, name, level, scope, description) VALUES ('role-manager', 'manager', 'Manager', 3, 'Tenant + Department', 'Department-level supervisor');
INSERT OR IGNORE INTO rbac_roles (id, code, name, level, scope, description) VALUES ('role-editor', 'editor', 'Editor', 4, 'Tenant + Department', 'Operational user with write access');
INSERT OR IGNORE INTO rbac_roles (id, code, name, level, scope, description) VALUES ('role-viewer', 'viewer', 'Viewer', 5, 'Tenant + Department', 'Read-only user');

CREATE TABLE IF NOT EXISTS rbac_permissions (
  id         TEXT PRIMARY KEY,
  code       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  resource   TEXT NOT NULL,
  action     TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-user.view', 'user.view', 'user.view', 'user', 'view', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-user.create', 'user.create', 'user.create', 'user', 'create', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-user.edit', 'user.edit', 'user.edit', 'user', 'edit', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-user.delete', 'user.delete', 'user.delete', 'user', 'delete', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-user.invite', 'user.invite', 'user.invite', 'user', 'invite', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-user.role.assign', 'user.role.assign', 'user.role.assign', 'user', 'role', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-user.status.update', 'user.status.update', 'user.status.update', 'user', 'status', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-document.view', 'document.view', 'document.view', 'document', 'view', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-document.create', 'document.create', 'document.create', 'document', 'create', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-document.edit', 'document.edit', 'document.edit', 'document', 'edit', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-document.delete', 'document.delete', 'document.delete', 'document', 'delete', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-document.export', 'document.export', 'document.export', 'document', 'export', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-document.download', 'document.download', 'document.download', 'document', 'download', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-tenant.view', 'tenant.view', 'tenant.view', 'tenant', 'view', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-tenant.create', 'tenant.create', 'tenant.create', 'tenant', 'create', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-tenant.edit', 'tenant.edit', 'tenant.edit', 'tenant', 'edit', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-tenant.delete', 'tenant.delete', 'tenant.delete', 'tenant', 'delete', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-department.view', 'department.view', 'department.view', 'department', 'view', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-department.create', 'department.create', 'department.create', 'department', 'create', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-department.edit', 'department.edit', 'department.edit', 'department', 'edit', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-department.delete', 'department.delete', 'department.delete', 'department', 'delete', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-workspace.view', 'workspace.view', 'workspace.view', 'workspace', 'view', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-workspace.switch', 'workspace.switch', 'workspace.switch', 'workspace', 'switch', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-export.csv', 'export.csv', 'export.csv', 'export', 'csv', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-export.document', 'export.document', 'export.document', 'export', 'document', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-admin.access', 'admin.access', 'admin.access', 'admin', 'access', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-admin.user.manage', 'admin.user.manage', 'admin.user.manage', 'admin', 'user', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-admin.role.manage', 'admin.role.manage', 'admin.role.manage', 'admin', 'role', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-admin.tenant.manage', 'admin.tenant.manage', 'admin.tenant.manage', 'admin', 'tenant', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-admin.department.manage', 'admin.department.manage', 'admin.department.manage', 'admin', 'department', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-admin.configuration.manage', 'admin.configuration.manage', 'admin.configuration.manage', 'admin', 'configuration', '');
INSERT OR IGNORE INTO rbac_permissions (id, code, name, resource, action, description) VALUES ('perm-audit.view', 'audit.view', 'audit.view', 'audit', 'view', '');

CREATE TABLE IF NOT EXISTS rbac_role_permissions (
  role_code       TEXT NOT NULL,
  permission_code TEXT NOT NULL,
  PRIMARY KEY (role_code, permission_code),
  FOREIGN KEY (role_code) REFERENCES rbac_roles(code),
  FOREIGN KEY (permission_code) REFERENCES rbac_permissions(code)
);

INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'admin.access');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'admin.configuration.manage');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'admin.department.manage');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'admin.role.manage');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'admin.tenant.manage');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'admin.user.manage');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'audit.view');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'department.create');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'department.delete');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'department.edit');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'department.view');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'document.create');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'document.delete');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'document.download');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'document.edit');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'document.export');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'document.view');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'export.csv');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'export.document');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'tenant.create');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'tenant.delete');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'tenant.edit');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'tenant.view');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'user.create');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'user.delete');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'user.edit');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'user.invite');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'user.role.assign');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'user.status.update');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'user.view');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'workspace.switch');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('superuser', 'workspace.view');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('admin', 'admin.access');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('admin', 'admin.department.manage');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('admin', 'admin.user.manage');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('admin', 'department.create');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('admin', 'department.edit');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('admin', 'department.view');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('admin', 'document.create');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('admin', 'document.delete');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('admin', 'document.download');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('admin', 'document.edit');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('admin', 'document.export');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('admin', 'document.view');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('admin', 'export.csv');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('admin', 'export.document');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('admin', 'tenant.view');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('admin', 'user.create');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('admin', 'user.delete');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('admin', 'user.edit');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('admin', 'user.invite');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('admin', 'user.role.assign');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('admin', 'user.status.update');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('admin', 'user.view');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('manager', 'admin.access');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('manager', 'admin.user.manage');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('manager', 'department.view');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('manager', 'document.create');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('manager', 'document.delete');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('manager', 'document.download');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('manager', 'document.edit');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('manager', 'document.export');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('manager', 'document.view');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('manager', 'export.csv');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('manager', 'export.document');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('manager', 'user.create');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('manager', 'user.edit');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('manager', 'user.invite');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('manager', 'user.role.assign');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('manager', 'user.status.update');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('manager', 'user.view');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('editor', 'document.create');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('editor', 'document.delete');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('editor', 'document.download');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('editor', 'document.edit');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('editor', 'document.view');
INSERT OR IGNORE INTO rbac_role_permissions (role_code, permission_code) VALUES ('viewer', 'document.view');

CREATE TABLE IF NOT EXISTS rbac_departments (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_rbac_departments_tenant ON rbac_departments(tenant_id);

CREATE TABLE IF NOT EXISTS rbac_user_roles (
  user_id       TEXT PRIMARY KEY,
  role_code     TEXT NOT NULL,
  tenant_id     TEXT,
  department_id TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (role_code) REFERENCES rbac_roles(code)
);

CREATE INDEX IF NOT EXISTS idx_rbac_user_roles_tenant ON rbac_user_roles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rbac_user_roles_department ON rbac_user_roles(department_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id            TEXT PRIMARY KEY,
  actor_id      TEXT NOT NULL,
  action        TEXT NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  tenant_id     TEXT,
  department_id TEXT,
  impersonated_by TEXT,
  metadata      TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor  ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_type, target_id);
