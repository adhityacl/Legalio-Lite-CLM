# Matriks Peran × Permission (dihasilkan otomatis dari `server/rbac.ts`)

Dihasilkan: 2026-09-20T20:15:13.804Z

Hierarki: superuser(1) > admin(2) > manager(3) > editor(4) > viewer(5)

| Permission | Resource | SUPERUSER | ADMIN | MANAGER | EDITOR | VIEWER |
|---|---|---:|---:|---:|---:|---:|
| `user.view` | user | ✅ | ✅ | ✅ | — | — |
| `user.create` | user | ✅ | ✅ | ✅ | — | — |
| `user.edit` | user | ✅ | ✅ | ✅ | — | — |
| `user.delete` | user | ✅ | ✅ | — | — | — |
| `user.invite` | user | ✅ | ✅ | ✅ | — | — |
| `user.role.assign` | user | ✅ | ✅ | ✅ | — | — |
| `user.status.update` | user | ✅ | ✅ | ✅ | — | — |
| `document.view` | document | ✅ | ✅ | ✅ | ✅ | ✅ |
| `document.create` | document | ✅ | ✅ | ✅ | ✅ | — |
| `document.edit` | document | ✅ | ✅ | ✅ | ✅ | — |
| `document.delete` | document | ✅ | ✅ | ✅ | ✅ | — |
| `document.export` | document | ✅ | ✅ | ✅ | — | — |
| `document.download` | document | ✅ | ✅ | ✅ | ✅ | — |
| `tenant.view` | tenant | ✅ | ✅ | — | — | — |
| `tenant.create` | tenant | ✅ | — | — | — | — |
| `tenant.edit` | tenant | ✅ | — | — | — | — |
| `tenant.delete` | tenant | ✅ | — | — | — | — |
| `department.view` | department | ✅ | ✅ | ✅ | — | — |
| `department.create` | department | ✅ | ✅ | — | — | — |
| `department.edit` | department | ✅ | ✅ | — | — | — |
| `department.delete` | department | ✅ | — | — | — | — |
| `workspace.view` | workspace | ✅ | — | — | — | — |
| `workspace.switch` | workspace | ✅ | — | — | — | — |
| `export.csv` | export | ✅ | ✅ | ✅ | — | — |
| `export.document` | export | ✅ | ✅ | ✅ | — | — |
| `admin.access` | admin | ✅ | ✅ | ✅ | — | — |
| `admin.user.manage` | admin | ✅ | ✅ | ✅ | — | — |
| `admin.role.manage` | admin | ✅ | — | — | — | — |
| `admin.tenant.manage` | admin | ✅ | — | — | — | — |
| `admin.department.manage` | admin | ✅ | ✅ | — | — | — |
| `admin.configuration.manage` | admin | ✅ | — | — | — | — |
| `audit.view` | audit | ✅ | — | — | — | — |

## Ringkasan jumlah permission per peran

| Peran | Level | Scope | Jumlah permission |
|---|---:|---|---:|
| superuser | 1 | Global | 32 |
| admin | 2 | Tenant | 22 |
| manager | 3 | Tenant + Department | 17 |
| editor | 4 | Tenant + Department | 5 |
| viewer | 5 | Tenant + Department | 1 |