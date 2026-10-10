/**
 * Generates docs/rbac/tenant-boundaries-endpoint-inventory.md (tenant-boundaries PRD §5.5).
 *
 * Sources, all read at generation time:
 *   - server/routePolicies.ts      ROUTE_POLICIES (every /api operation) and BETTER_AUTH_ALLOWED
 *   - src/server/organizationAdminRoutes.ts   the canonical router's concrete routes
 *   - node_modules/better-auth (+ @better-auth/infra)   every Better Auth HTTP endpoint of the
 *     installed version, so new plugin routes show up as denied rows automatically
 *   - tests/**                     literal path references, as the "verified by" column
 *
 *   npx tsx tools/gen-endpoint-inventory.ts           write the document
 *   npx tsx tools/gen-endpoint-inventory.ts --check   fail if the document is out of date
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BETTER_AUTH_ALLOWED, ROUTE_POLICIES, isBetterAuthPathAllowed, type RoutePolicy } from '../apps/backend/src/routePolicies';

const ROOT = process.cwd();
const OUT = join(ROOT, 'docs/rbac/tenant-boundaries-endpoint-inventory.md');

function files(dir: string, test: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full, test) : test(name) ? [full] : [];
  });
}

/* ------------------------------------------------------------------ */
/* Better Auth endpoints of the installed version                      */
/* ------------------------------------------------------------------ */

export type AuthFamily = 'core' | 'admin plugin' | 'organization plugin' | 'infra plugin (dash/sentinel)';

/** Every `createAuthEndpoint("/…")` path shipped by the installed Better Auth packages, as /api/auth/… */
export function betterAuthEndpoints(): Array<{ family: AuthFamily; path: string }> {
  const sources: Array<[AuthFamily, string]> = [
    ['core', 'node_modules/better-auth/dist/api'],
    ['admin plugin', 'node_modules/better-auth/dist/plugins/admin'],
    ['organization plugin', 'node_modules/better-auth/dist/plugins/organization'],
    ['infra plugin (dash/sentinel)', 'node_modules/@better-auth/infra/dist'],
  ];
  const seen = new Set<string>();
  const out: Array<{ family: AuthFamily; path: string }> = [];
  for (const [family, dir] of sources) {
    for (const file of files(join(ROOT, dir), (n) => /\.(mjs|js|cjs)$/.test(n))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/createAuthEndpoint\(\s*["'`](\/[^"'`]+)["'`]/g)) {
        const path = `/api/auth${m[1]}`;
        if (!seen.has(path)) { seen.add(path); out.push({ family, path }); }
      }
    }
  }
  return out.sort((a, b) => a.family.localeCompare(b.family) || a.path.localeCompare(b.path));
}

/* ------------------------------------------------------------------ */
/* Canonical router                                                     */
/* ------------------------------------------------------------------ */

/** PRD §9.2 / §9.4 policy per canonical route (the router enforces it; see organizationAdminRoutes.ts). */
const CANONICAL_POLICY: Record<string, [string, string]> = {
  'POST /api/me/organization': ['approved identity without active membership', 'explicit onboarding; creator becomes tenant admin; atomic settings, membership and audit'],
  'GET /api/me': ['identity', 'own identity, memberships (incl. suspended), platform permissions'],
  'POST /api/me/active-organization': ['identity', 'validated session default only'],
  'GET /api/me/sessions': ['identity', 'own sessions'],
  'DELETE /api/me/sessions/:sessionId': ['identity', 'own sessions'],
  'POST /api/organizations/:organizationId/invite-codes': ['tenant admin or platform context', 'single-use code; expires after 24 hours; no recipient email required'],
  'GET /api/organizations/:organizationId/capabilities': ['membership or platform context', 'capability DTO'],
  'GET /api/organizations/:organizationId/policy': ['membership or platform context', 'non-secret runtime policy'],
  'GET /api/organizations/:organizationId/settings': ['tenant.settings.read', ''],
  'PATCH /api/organizations/:organizationId/settings': ['tenant.settings.update', 'expectedVersion; section merge; audit in same transaction'],
  'GET /api/organizations/:organizationId/members': ['tenant.member.read', 'manager: self + intersecting departments'],
  'PATCH /api/organizations/:organizationId/members/:membershipId': ['tenant.member.role.update / status.update / departments.update', 'per changed field + hierarchy (§4.3)'],
  'DELETE /api/organizations/:organizationId/members/:membershipId': ['tenant.member.remove', 'this organization only; last-admin invariant'],
  'GET /api/organizations/:organizationId/departments': ['department.view', 'manager: assigned only'],
  'POST /api/organizations/:organizationId/departments': ['department.create', ''],
  'PATCH /api/organizations/:organizationId/departments/:departmentId': ['department.edit', 'rename blocked while referenced'],
  'DELETE /api/organizations/:organizationId/departments/:departmentId': ['department.delete', 'DEPARTMENT_IN_USE'],
  'GET /api/organizations/:organizationId/invitations': ['tenant.invitation.read', 'role/department scope'],
  'POST /api/organizations/:organizationId/invitations': ['tenant.member.invite', 'hierarchy + department scope'],
  'POST /api/organizations/:organizationId/invitations/:invitationId/resend': ['tenant.invitation.resend', 'target scope'],
  'DELETE /api/organizations/:organizationId/invitations/:invitationId': ['tenant.invitation.cancel', 'marks canceled'],
  'GET /api/invitations/:token/preview': ['public (token possession)', 'minimal preview'],
  'POST /api/invitations/:token/accept': ['identity', 'verified matching email'],
  'GET /api/organizations/:organizationId/integrations/google': ['tenant.integration.read', 'syncSupported: false'],
  'PATCH /api/organizations/:organizationId/integrations/google': ['tenant.integration.update', 'unique validated IDs; expectedVersion'],
  'GET /api/organizations/:organizationId/audit': ['tenant.audit.read', 'sanitized projection'],
  'GET /api/platform/configuration': ['platform.configuration.read', 'secrets as has* flags'],
  'PATCH /api/platform/configuration': ['platform.configuration.update', 'section allowlist'],
  'GET /api/platform/audit': ['platform.audit.read', 'sanitized'],
};

function canonicalRoutes(): Array<{ method: string; path: string }> {
  const source = readFileSync(join(ROOT, 'apps/backend/src/organizationAdminRoutes.ts'), 'utf8');
  return [...source.matchAll(/router\.(get|post|put|patch|delete)\(\s*[`'"]([^`'"]+)[`'"]/g)].map((m) => ({
    method: m[1].toUpperCase(),
    path: `/api${m[2].replace('${org}', '/organizations/:organizationId')}`,
  }));
}

/* ------------------------------------------------------------------ */
/* Verifying tests: literal path references in live/unit tests          */
/* ------------------------------------------------------------------ */

/** Mocked fixture specs are excluded: they prove UI behavior, not server policy. */
const TEST_FILES = [
  ...files(join(ROOT, 'tests/tenant-boundaries'), (n) => n.endsWith('.ts')),
  ...files(join(ROOT, 'tests'), (n) => n.endsWith('.test.ts')).filter((f) => !f.includes('tenant-boundaries')),
  ...['tenant-boundaries.live.spec.ts', 'admin-nav-rbac.spec.ts', 'spa-query-routing.spec.ts'].map((n) => join(ROOT, 'tests/e2e', n)),
].filter((f, i, all) => existsSync(f) && all.indexOf(f) === i);

const TEST_SOURCES = TEST_FILES.map((file) => ({ file: relative(ROOT, file), lines: readFileSync(file, 'utf8').split('\n') }));

function patternRegex(path: string): RegExp {
  const body = path.split('/').map((segment) => {
    if (segment === '*') return '[^\'"`\\s]+';
    if (segment.startsWith(':')) return '(?:\\$\\{[^}]+\\}|[^/\'"`\\s?$]+)';
    return segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return new RegExp(`[\`'"]${body}(?=[\`'"?])`);
}

/** A line counts for `method` when it names that method, or names none and the method is GET. */
function lineMatchesMethod(line: string, method: string): boolean {
  if (method === '*') return true;
  const named = [...line.matchAll(/['"`](GET|POST|PUT|PATCH|DELETE)['"`]/g)].map((m) => m[1]);
  return named.length ? named.includes(method) : method === 'GET';
}

function testRefs(method: string, path: string, max = 2): string[] {
  const regex = patternRegex(path);
  const refs: string[] = [];
  for (const { file, lines } of TEST_SOURCES) {
    lines.forEach((line, index) => {
      if (refs.length >= max * 4 || !regex.test(line) || !lineMatchesMethod(line, method)) return;
      for (let i = index; i >= 0; i--) {
        const title = lines[i].match(/\b(?:it|test)\(\s*[`'"](.+?)[`'"]\s*,/);
        if (title) { refs.push(`${file} › ${title[1]}`); return; }
      }
      refs.push(file);
    });
  }
  return [...new Set(refs)].slice(0, max);
}

/* ------------------------------------------------------------------ */
/* Document                                                             */
/* ------------------------------------------------------------------ */

const esc = (s: string) => s.replace(/\|/g, '\\|');
const CLASS: Record<RoutePolicy['kind'], string> = {
  public: 'public', identity: 'self (identity)', router: 'canonical router', platform: 'platform', tenant: 'tenant (legacy selector)', orgParam: 'tenant (path :id)',
};
const permissionOf = (p: RoutePolicy) =>
  p.kind === 'platform' ? p.permission : p.kind === 'tenant' || p.kind === 'orgParam' ? p.permissions.join(' + ') : '—';

function row(cells: string[]) { return `| ${cells.map((c) => esc(c || '—')).join(' | ')} |`; }
function verified(method: string, path: string, fallback: string) {
  const refs = testRefs(method, path);
  return refs.length ? refs.join('<br>') : fallback;
}

export function render(): string {
  const out: string[] = [];
  out.push('# Tenant boundaries — endpoint inventory', '');
  out.push('Generated by `npx tsx tools/gen-endpoint-inventory.ts` from `server/routePolicies.ts` (`ROUTE_POLICIES`, `BETTER_AUTH_ALLOWED`),');
  out.push('`src/server/organizationAdminRoutes.ts` and the installed Better Auth packages. Do not edit by hand; `--check` fails when it is stale.', '');
  out.push('How a request is decided (PRD §5.5):', '');
  out.push('1. `/api/auth/*` (except the app\'s own `/api/auth/google/*`) passes only if the path is in `BETTER_AUTH_ALLOWED` or is an OAuth `/api/auth/callback/*`; everything else returns `404 RESOURCE_NOT_FOUND` before Better Auth runs.');
  out.push('2. Every other `/api/*` request needs a matching `ROUTE_POLICIES` entry (first match wins). Unlisted operations return `404 RESOURCE_NOT_FOUND`.');
  out.push('3. Non-public policies resolve the verified identity (expiry, revocation, ban); cookie-authenticated mutations must be same-origin.');
  out.push('4. `platform` requires the named platform permission (superuser only). `tenant` resolves the explicit organization selector and requires every listed permission in that membership or platform-management context; handlers then scope records by organization and department. `canonical router` routes resolve the path organization and check the permission in the handler.');
  out.push('5. `/uploads/*` requires a verified identity and an owning persisted record in the selected organization that the caller may read.', '');
  out.push('"Verified by" lists live/unit tests that call the path literally (mocked fixture specs excluded). "policy table only" means no test calls that exact path; the declared policy above still applies.', '');

  out.push('## Express `/api` routes (`ROUTE_POLICIES`)', '');
  out.push(row(['Method', 'Path', 'Classification', 'Permission', 'Note', 'Verified by']));
  out.push(row(['---', '---', '---', '---', '---', '---']));
  for (const [method, path, policy] of ROUTE_POLICIES) {
    if (path === '/api/organizations/:organizationId/*') continue; // expanded below
    out.push(row([method, `\`${path}\``, CLASS[policy.kind], permissionOf(policy), policy.note || '', verified(method, path, 'policy table only')]));
  }
  out.push('');

  out.push('## Canonical router (`src/server/organizationAdminRoutes.ts`)', '');
  out.push('Covered by the `* /api/organizations/:organizationId/*` and `/api/me`, `/api/invitations`, `/api/platform` policy entries; the permission is enforced in the handler.', '');
  out.push(row(['Method', 'Path', 'Permission', 'Note', 'Verified by']));
  out.push(row(['---', '---', '---', '---', '---']));
  for (const { method, path } of canonicalRoutes()) {
    const [permission, note] = CANONICAL_POLICY[`${method} ${path}`] || ['UNDECLARED', 'add to CANONICAL_POLICY'];
    out.push(row([method, `\`${path}\``, permission, note, verified(method, path, 'policy table only')]));
  }
  out.push('');

  out.push('## Static files', '');
  out.push(row(['Method', 'Path', 'Classification', 'Rule', 'Verified by']));
  out.push(row(['---', '---', '---', '---', '---']));
  out.push(row(['GET', '`/uploads/*`', 'tenant (owning record)', 'verified identity; file must belong to a permitted record in the selected organization; traversal and unowned root files denied', verified('GET', '/uploads/*', 'policy table only')]));
  out.push('');

  out.push('## Better Auth HTTP endpoints', '');
  out.push('Allowed endpoints run Better Auth with the app\'s hooks (`self` endpoints additionally require a verified identity first). Admin- and Organization-plugin routes are **denied**: tenant and platform administration use the canonical services, which enforce membership status, ownership and hierarchy that the plugins cannot (PRD §10.2). The `dash`/`sentinel` infra plugins are only mounted with `BETTER_AUTH_ENABLE_INFRA=true` and are denied at the boundary either way.', '');
  out.push(row(['Family', 'Path', 'Decision', 'Verified by']));
  out.push(row(['---', '---', '---', '---']));
  const allowedCount = Object.keys(BETTER_AUTH_ALLOWED).length;
  for (const { family, path } of betterAuthEndpoints()) {
    const allowed = isBetterAuthPathAllowed(path.replace(/\/:[^/]+$/, '/x'));
    const decision = allowed ? `allowed (${BETTER_AUTH_ALLOWED[path] ?? 'OAuth callback'})` : 'denied — 404 RESOURCE_NOT_FOUND';
    const fallback = allowed ? 'policy table only' : 'tests/tenant-boundaries/api.test.ts › every installed Better Auth route outside the allowlist is denied';
    out.push(row([family, `\`${path}\``, decision, verified('*', path, fallback)]));
  }
  out.push('');
  out.push(`Allowlist size: ${allowedCount} paths plus \`/api/auth/callback/*\`.`, '');
  return out.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const doc = render();
  if (process.argv.includes('--check')) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (current !== doc) {
      console.error(`${relative(ROOT, OUT)} is out of date; run npx tsx tools/gen-endpoint-inventory.ts`);
      process.exit(1);
    }
    console.log(`${relative(ROOT, OUT)} is up to date.`);
  } else {
    writeFileSync(OUT, doc);
    console.log(`Wrote ${relative(ROOT, OUT)}`);
  }
}
