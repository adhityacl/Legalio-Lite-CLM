/**
 * Generates the role/permission matrices straight from `server/rbac.ts`, so
 * the docs cannot drift from the policy source. Platform roles and tenant
 * membership roles are separate tables (tenant-boundaries PRD §9.3).
 *
 * Run: npx tsx tools/gen-rbac-matrix.ts <outputDir>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLATFORM_PERMISSIONS, PLATFORM_ROLES, TENANT_PERMISSIONS, TENANT_ROLES, platformPermissionsFor, tenantPermissionsFor } from '../apps/backend/src/rbac';

const outDir = process.argv[2] ?? 'docs/rbac/generated';
mkdirSync(outDir, { recursive: true });

const table = (title: string, roles: readonly string[], permissions: readonly string[], grants: (role: any) => string[]) => {
  const sets = Object.fromEntries(roles.map((r) => [r, new Set(grants(r))]));
  return [
    `## ${title}`,
    '',
    `| Permission | ${roles.join(' | ')} |`,
    `|---|${roles.map(() => ':---:').join('|')}|`,
    ...permissions.map((p) => `| \`${p}\` | ${roles.map((r) => (sets[r].has(p) ? '✅' : '—')).join(' | ')} |`),
    '',
  ];
};

const md = [
  '# Role × permission matrices (generated from `server/rbac.ts`)',
  '',
  'Platform roles (`user.role`) and organization membership roles (`member.role`) are independent.',
  'Scope limits (lower-role targets, manager department scope, last-admin rules) are enforced by the check functions, not by this table.',
  '',
  ...table('Platform roles', PLATFORM_ROLES, PLATFORM_PERMISSIONS, platformPermissionsFor),
  ...table('Organization membership roles', TENANT_ROLES, TENANT_PERMISSIONS, tenantPermissionsFor),
];
writeFileSync(join(outDir, 'RBAC-Role-Permission-Matrix.md'), md.join('\n'));
console.log(`Wrote ${join(outDir, 'RBAC-Role-Permission-Matrix.md')}`);
