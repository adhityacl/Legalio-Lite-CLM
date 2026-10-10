# Tenant Boundaries and Unified Settings — Implementation PRD

- **Version:** 1.1
- **Date:** 2026-10-05
- **Status:** Proposed implementation specification; application changes have not been authorized by the request to write this document.
- **Repository:** `NEW-CLM`
- **Audience:** AI implementation agents and human reviewers.
- **Language:** English. Application labels must continue to support English, Indonesian, and Simplified Chinese.

## 1. Document contract and execution rules

This document specifies a repository change. It does not assert that the change already exists or that the current application has passed its acceptance tests.

The requested user experience is one tenant Settings sidebar item and one Settings screen with exactly three tabs: **Organization**, **Members & Access**, and **Integrations**. Do not recreate separate Organization Administration and Organization Settings parents.

`MUST`, `MUST NOT`, and `REQUIRED` are acceptance requirements. Choices explicitly marked **deferred** are outside this implementation. A technical implementation may vary internally only if its externally observable behavior, data ownership, and test results satisfy every requirement below.

### 1.1 Authority and conflict resolution

1. Follow the user's instructions and applicable repository instructions before this document.
2. For this feature, this document replaces earlier proposals that introduced multiple tenant settings pages and a single five-role global hierarchy.
3. Historical files under `docs/rbac/` describe previous implementations and audit snapshots. Their old test counts, line numbers, `owner -> superuser` mapping, or restrictions on ordinary member switching are not requirements for this change.
4. Preserve unrelated requirements in `docs/PRODUCT-REQUIREMENTS-GLOBAL-OSS.md` and existing business features. Do not implement its future holding/subsidiary hierarchy as part of this work.
5. Inspect the current working tree before implementation. Existing uncommitted edits are user work. Do not reset, overwrite, or revert them. Make targeted edits against their current content.
6. No implementation agent may silently invent data ownership, broaden permissions, add navigation pages, downgrade a required acceptance criterion, or mark an unexecuted test as passed.
7. If the repository changes after this inspection, relocate functions by symbol name rather than trusting line numbers. Record a material contradiction before changing the specified behavior.
8. Writing this PRD is documentation work only. A later request to implement it authorizes development and fixture validation, not production migration, destructive live tests, deployment, or external Google/SMTP operations.

### 1.2 Known facts versus product decisions

Section 3 describes technical facts observed in source code. Sections 4 onward define target product and implementation decisions for this proposed change. These target decisions are not claims about the application's current behavior or business obligations.

No pricing, data retention SLA, billing entitlement, or compliance obligation has been supplied for this change. Do not infer one or add a subscription/entitlement system.

Data that cannot be mapped deterministically is handled by the migration conflict procedure in Section 14. An agent must not resolve such conflicts by choosing the first organization.

## 2. Outcome, scope, and exclusions

### 2.1 Outcome

A person can administer an organization only through an active membership with the required organization permission. Organization membership and role do not grant platform administration. A person's organization role may differ between organizations. Tenant administrators never receive platform configuration through UI loaders, API responses, cache entries, or direct plugin endpoints.

### 2.2 Required scope

- Separate platform identity roles from organization membership roles.
- Consolidate tenant administration and settings into the three-tab screen.
- Keep the existing System Admin entry and console for platform administration.
- Separate platform settings from organization policy, notification recipients, and Google resource mappings.
- Enforce current membership, tenant ownership, department scope, and permission at server boundaries.
- Apply the same policy to custom Express routes and Better Auth routes.
- Replace global-account mutations in tenant administration with membership mutations.
- Fix tenant switching, stale responses, permission failure handling, and tenant-specific DTOs.
- Migrate legacy roles/settings without guessing ownership or deleting business records.
- Make tests and migration verification use isolated databases and storage paths.
- Preserve operational features, UI design tokens, available languages, and existing document permission grants unless this PRD explicitly changes a boundary.

### 2.3 Explicit exclusions

- No new router library, authentication provider, ORM, or database engine.
- No dependency upgrade or design-system replacement.
- No separate workspace database entity.
- No hierarchical organization inheritance, custom tenant roles, pricing plans, or module entitlements.
- No per-tenant AI API key, SMTP relay, Google OAuth client, or service-account credential.
- No per-tenant model selector; the selected AI model remains platform configuration.
- No new automatic or scheduled Google Sheets synchronization engine.
- No tenant reset feature; the existing destructive reset remains application-wide.
- No new retention/deletion automation or physical movement of existing upload files.
- No new tenant translation dictionary service or cross-device preference synchronization.
- No impersonation feature. If an existing impersonation route is found, keep it platform-only and audited; do not invent one from old reports.

## 3. Verified current implementation and before/after inventory

The application uses TypeScript, React, Express, Better Auth, `better-sqlite3`, and TanStack Query. `server/auth.ts` re-exports the real auth implementation in `src/lib/auth.ts`.

| Current location | Observed current behavior | Required target action |
| --- | --- | --- |
| `server.ts`: `resolveMembershipActor()` | Reads `member.role` for a chosen membership; session selection can override client selection; has a global superuser branch | Preserve membership lookup, replace context selection and role representation with Sections 4–5 |
| `server.ts`: `rbacAuthMiddleware` | Verifies raw session existence in one branch without expiry; maps write methods to document permissions using global roles | Replace this authorization floor with identity verification and explicit route policies |
| `server.ts`: `/api/user/my-role` | Reads `user.role`, can create an allowlist row on GET, returns one role and an ambiguous global-department label | Replace with identity DTO; GET must not create access or membership |
| `src/context/AuthContext.tsx` | Reads the one-role profile and derives `isAdmin` from it | Retain session/login/logout; remove tenant privilege decisions from global identity |
| `src/lib/auth.ts`: Admin plugin | `defaultRole: viewer`; `adminRoles` includes `admin` and `superuser`; custom `admin` has global user-list permission | Use platform roles only; ordinary users have no Admin-plugin permissions |
| `src/lib/auth.ts`: Organization plugin | Allows user organization creation; default plugin roles differ from application roles | Disable ordinary creation; register the fixed membership role policy |
| `src/lib/auth.ts`: registration hooks | Copies `allowed_users.role` into global role and globally bans unapproved registrations | Never assign tenant role to global identity; implement Section 8.4 |
| `src/lib/permissions.ts` | Uses bootstrap privileges when `/api/rbac/me` fails or returns an empty list; generic mapping maps `owner` to superuser | Fail closed for capabilities; split context-specific role normalization |
| `src/lib/rbacScoping.ts` | Uses a single global-role model and fuzzy department/PIC text comparisons | Replace access decisions with canonical IDs and server capability context |
| `src/components/Sidebar.tsx` | Has System Admin, Organization Admin, Settings, and several Settings subitems | Retain System Admin; remove Organization Admin parent and tenant Settings subitems |
| `src/components/SettingsView.tsx` | Six settings sections mix organization policy, global AI/SMTP/storage, SQLite, and maintenance | Refactor into the specified three-tab tenant screen; move platform controls into existing System Admin |
| `src/components/AdminUsersView.tsx` and `admin/*` | Shared console has system/organization modes; some loading is already separated | Reuse tables/dialogs; separate account and membership DTOs and mutations |
| `src/components/TenantDashboard.tsx` | Calls plugin create/invite/setActive through another path | Remove alternate policy path; reuse canonical services if this component remains mounted |
| `src/server/authConsoleRoutes.ts` | User ban/delete affect global identity; role/team updates can use only user/resource ID; invitations lack full hierarchy checks | Split platform operations from organization membership operations and validate all targets |
| `server.ts`: `/api/init-data` | Filters business data by tenant but includes every tenant and redacted global provider config | Return only scoped operational DTO and non-sensitive service availability |
| `server.ts`: `/api/tenants` | Filters visible tenants but can update global active tenant and provision resources on GET | Make a side-effect-free membership listing |
| `server.ts`: `/api/departments` | Reads client tenant selectors and can fall back to the first organization | Use verified context; no foreign-organization fallback |
| `server.ts`: `/api/branding` | Uses one global branding object; writes have no dedicated platform permission in handler | Split public/platform branding from tenant branding |
| `server.ts`: Google integration routes | Shared `db.googleConfig` combines provider secrets, SMTP, notification recipients, and resource IDs | Partition platform configuration and tenant integration/settings storage |
| `/api/tenants/:id/setup-google` | UI submits `spreadsheetId`; examined handler updates the folder mapping without equivalent Sheet persistence | Validate and persist both mapping fields through the new integration service |
| `/api/google-integration/sync`, `sync-status`, `sync-flush` | SQLite persistence/status placeholders; no actual Google sync queue; `triggerAutoPushToGoogleSheet()` is a no-op | Do not claim Google synchronization or introduce a scheduler |
| `src/server/googleCredentials.ts` | Google credential management already requires superuser | Retain credential validation/store and platform-only restriction |
| `server.ts`: `/api/admin/reset-database` | Reset already requires superuser and explicit confirmation | Retain restriction and scope; relocate UI to System Admin |
| `src/context/LanguageContext.tsx` | UI language and custom translations use browser localStorage | Keep built-in translations; namespace personal/browser overrides, do not treat them as tenant-shared settings |
| `src/server/coreDataStore.ts` | Synchronizes snapshots, deleting table records omitted from incoming arrays | Exclude canonical membership/settings/audit tables from generic snapshot replacement |
| `server.ts`: `/uploads` | Uses tenant display-name folders; tenant admin can access root files | Validate ownership through owning records; remove name-only and admin-root fallback |
| `playwright.config.ts`, `tests/e2e/seed.ts` | Default E2E starts real server and seeds repository `auth.db` | Isolate all live test database/storage paths before running these tests |
| `playwright.fixtures.config.ts` | Frontend tests use mocked APIs and Vite preview | Preserve this safe fixture workflow and extend it |

These findings are source inspection, not a live exploit report. Do not quote historical audit results as new runtime evidence.

## 4. Domain model and fixed role policy

### 4.1 Terminology

- **Identity:** one global user account in `user`.
- **Platform role:** authority over this application installation.
- **Organization:** the canonical Better Auth organization. Its `id` is the tenant boundary.
- **Tenant:** another name for that organization boundary, not a second authoritative entity.
- **Workspace:** the currently selected organization presented in the UI.
- **Membership:** one `member` row linking an identity to one organization with a tenant role and status.
- **Department:** a `team` owned by one organization. Team assignment never grants organization membership by itself.

Use `organizationId` as the canonical identifier in new DTOs, storage, and services. Existing `tenantId` callers may use an explicitly validated compatibility alias. Do not create workspace tables or independently generated tenant IDs.

### 4.2 Platform roles

```ts
type PlatformRole = 'user' | 'superuser';
type TenantRole = 'admin' | 'manager' | 'editor' | 'viewer';
type MembershipStatus = 'active' | 'suspended';
```

Store the platform role in existing `user.role`; expose it as `platformRole` in application DTOs. Do not add a competing `user.platformRole` column. `member.role` stores only `TenantRole` after migration.

`user` grants session access, self-service account access, and access through valid memberships. `superuser` grants the explicit known platform permission catalog. Never authorize an unknown permission, even for superuser; do not use a frontend or backend `'*'` shortcut.

There is no numeric ranking that makes a tenant admin a weaker platform superuser. Tenant-role ranking exists only inside a selected organization.

### 4.3 Fixed administration matrix

All non-superuser entries require an active membership in the target organization. Department-scoped entries also require valid assigned department IDs.

| Ability | Tenant admin | Manager | Editor | Viewer | Superuser in explicit organization context |
| --- | --- | --- | --- | --- | --- |
| See Settings entry | Yes | Yes, Members & Access only | No | No | Yes |
| Read/update Organization tab | Yes | No | No | No | Yes |
| Read/update Integrations tab | Yes | No | No | No | Yes |
| List members | All in this organization | Self plus members intersecting assigned departments | No admin list | No admin list | All in selected organization |
| Invite | Manager/editor/viewer | Editor/viewer within own departments | No | No | Admin/manager/editor/viewer |
| Change another membership role | Current and target roles must both be below admin | Current and target roles must both be below manager; target's departments must be fully inside actor scope | No | No | Any tenant role |
| Suspend/reactivate membership | Lower-role members in this organization | Lower-role members fully inside department scope | No | No | Yes |
| Remove membership | Lower-role members in this organization | No | No | No | Yes |
| Create/rename/delete department | Yes | No | No | No | Yes |
| Change department assignments | Lower-role members in this organization | No | No | No | Yes |
| Resend/cancel invitation | Allowed lower roles in this organization | Editor/viewer invitations wholly in own departments | No | No | Yes |
| View tenant settings audit | Yes | No | No | No | Yes |
| Modify platform role or configuration | No | No | No | No | Yes, through platform endpoints only |
| Ban/delete global account or reset another account password | No | No | No | No | Yes, through platform endpoints only |

Additional fixed rules:

1. Tenant admin cannot appoint or demote a peer tenant admin. Use System Admin to appoint/replace tenant administrators.
2. Never permit self-role changes through member administration. Personal name/password changes use self-service endpoints.
3. Never remove, suspend, or demote the last usable admin in an organization. A usable admin has an active admin membership and an existing, non-banned identity. Global account ban/deletion must enforce this rule in every affected organization as well. Check inside the same transaction as the mutation; platform authority without membership does not count as an organization admin.
4. Never ban, delete, or demote the last active, non-banned platform superuser. Check inside the mutation transaction.
5. Changing role to admin removes department assignments only for that organization; other-organization assignments remain untouched.
6. Assigning manager/editor/viewer requires at least one department ID owned by that organization on new/changed assignments. Legacy memberships with no departments remain visible to administrators but do not gain tenant-wide operational access.
7. A manager may see a multi-department target that intersects its scope, but may not change the target's role/status when any target department falls outside its scope. Visibility does not imply mutation authority.
8. Invalid or comma-separated role values are rejected on new writes. Fixed roles are not combined or dynamically defined.

### 4.4 Operational permissions retained

Preserve these explicit existing grants while replacing tenant/department selection. These are role grants, not permission to operate on another tenant's resources.

| Role | Operational permissions |
| --- | --- |
| Admin | `document.view`, `document.create`, `document.edit`, `document.delete`, `document.export`, `document.download`, `export.csv`, `export.document` |
| Manager | Same operational document/export grants as admin, constrained to department scope |
| Editor | `document.view`, `document.create`, `document.edit`, `document.delete`, `document.download` |
| Viewer | `document.view` |

Do not change editor deletion or viewer download policy incidentally. Preserve other domain-specific operation behavior and apply its required permission/resource boundary. For operations whose policy cannot be found, record the missing route policy; do not infer that every editor can invoke every POST.

For department-scoped resources, resolve canonical department IDs from the resource or its owning parent. A resource with no verifiable department is admin/superuser-visible only. Do not authorize from substring matches, display names, or the absence of a department.

### 4.5 Dashboard, menu, and content visibility matrices

These matrices specify the target UI and response boundaries. They supplement the action matrix in Section 4.3: seeing a menu, card, or record never grants permission to mutate it. Implement these rules in navigation guards, component loaders, API queries, and aggregates, not only in JSX.

#### 4.5.1 Platform role visibility

The platform role answers which installation-wide surfaces an identity can access. It does not describe an ordinary user's role in any organization.

| Surface or content | Platform `user` | Platform `superuser` | Data scope and condition |
| --- | --- | --- | --- |
| System Admin entry and platform dashboard | Hidden and denied | Visible | Installation-wide administrative metadata; no organization selection required |
| Platform dashboard account, session, organization, and API-key summaries | Hidden and denied | Visible | Platform administrative counts only; do not merge tenant contract/partner/spending totals into this dashboard |
| Global account directory and lifecycle controls | Hidden and denied | Visible | Platform identities; never exposed through the tenant member table |
| Global sessions and authentication account information | Own sessions through Account Security only | Global management in System Admin; own sessions also available | Global session management is platform-only |
| Platform organization directory and create/update/delete controls | Hidden and denied | Visible | Canonical organization directory, not fabricated memberships |
| Platform API-key management and full permission matrix | Hidden and denied | Visible | Existing System Admin console |
| Deployment branding, Google credentials/master resources, AI provider/model, SMTP | Hidden and denied | Visible | System Admin Configuration only |
| Database browser/optimization and application-wide reset | Hidden and denied | Visible | Platform endpoints and existing confirmation rules |
| Platform audit | Hidden and denied | Visible | Sanitized platform audit endpoint |
| Organization switcher | Own active memberships only | Platform organization directory plus own memberships, deduplicated by organization ID | Selecting an organization does not create membership or persist global active-tenant state |
| Organization operational dashboard and menus | Conditional on active membership; use Section 4.5.2 | Available after an explicit organization selection in platform-management mode | One selected organization per request; no implicit all-organization operational dashboard |
| Organization Settings | Use selected membership role; use Section 4.5.2 | Three tabs in explicit organization-management context | Platform authority does not place global configuration cards inside tenant Settings |
| Avatar Preferences and Account Security | Visible | Visible | Current identity only; no active organization required |

Default landing behavior: a superuser opens `admin-system-dashboard`; an ordinary user with a validated organization selection opens `dashboard`. An ordinary user with multiple accessible organizations and no validated selection sees the existing organization chooser. An ordinary user with no active membership sees an access-status state and personal account actions, with no tenant dashboard/data requests. Preserve the validated-selection procedure in Section 11.2; never choose the first organization to resolve an ambiguous selection.

#### 4.5.2 Organization role visibility

This table applies to platform `user` identities with an active membership in the selected organization. A suspended/missing membership does not receive any entry in this table. `Organization scope` means all authorized records in this organization. `Department scope` means only records with verifiable ownership in the membership's assigned departments, including parent-derived scope. It never includes another organization's records.

| Menu, tab, dialog, or operational surface | Tenant `admin` | Tenant `manager` | Tenant `editor` | Tenant `viewer` | Additional rule |
| --- | --- | --- | --- | --- | --- |
| Dashboard (`dashboard`) | Visible; organization scope | Visible; department scope | Visible; department scope | Visible; department scope | Apply Section 4.5.3 to every card and chart |
| Document Structure (`hierarchy`) | Visible; organization scope | Visible; department scope | Visible; department scope | Visible; department scope | Parent nodes must not reveal hidden child names/counts |
| Contracts (`contracts`) and permitted detail views | Visible; organization scope | Visible; department scope | Visible; department scope | Visible; department scope | Action buttons follow Section 4.4 |
| Partners (`partners`) | Visible; organization scope | Visible; department scope | Visible; department scope | Visible; department scope | Derive scope from canonical partner ownership or authorized owning records; no full partner directory fallback |
| Commercial documents (`ios`, existing `io` alias) | Visible; organization scope | Visible; department scope | Visible; department scope | Visible; department scope | Requires `modules.commercialDocuments` |
| Partner Evaluation (`partner-evaluation`) | Visible; organization scope | Visible; department scope | Visible; department scope | Visible; department scope | Requires `modules.evaluation`; viewing does not grant evaluation mutation authority |
| Partner Spending (`partner-spending`) | Visible; organization scope | Visible; department scope | Visible; department scope | Visible; department scope | Requires `modules.spending`; viewing does not grant spending mutation authority |
| Notifications (`notifikasi`) and notification badges | Visible; organization scope | Visible; department scope | Visible; department scope | Visible; department scope | Only notifications attached to permitted records; no global unread/expiry counts |
| My Documents / creation workspace (`create-contract`) | Visible | Visible | Visible | Hidden and denied | Requires `document.create`; viewer reads documents through permitted record/detail views |
| Import Data (`bulk-import`) | Visible; organization scope | Hidden and denied | Hidden and denied | Hidden and denied | Requires `tenant.data.import`; validate every imported reference in the selected organization |
| Settings sidebar entry | Visible | Visible | Hidden and denied | Hidden and denied | Exactly one parent; manager opens Members & Access |
| Settings: Organization | Visible; editable | Hidden and denied | Hidden and denied | Hidden and denied | `tenant.settings.read/update` |
| Settings: Members & Access | Visible; organization scope | Visible; role/departments constrained | Hidden and denied | Hidden and denied | Member/invitation actions follow Section 4.3 |
| Settings: Integrations | Visible; editable mappings | Hidden and denied | Hidden and denied | Hidden and denied | No platform credentials or provider forms |
| Invite Member dialog / Pending Invitations filter | Visible; lower-role targets | Visible; editor/viewer targets within scope | Hidden and denied | Hidden and denied | No separate invitation page |
| Departments dialog | Visible; organization management | Visible; assigned departments, read-only | Hidden and denied | Hidden and denied | No separate department page |
| History drawer: administrative and operational events | Visible; organization scope | Hidden and denied | Hidden and denied | Hidden and denied | No standalone audit/activity-log page |
| System Admin and all platform configuration controls | Hidden and denied | Hidden and denied | Hidden and denied | Hidden and denied | Tenant admin remains platform `user` |
| Avatar Preferences and Account Security | Visible; own identity | Visible; own identity | Visible; own identity | Visible; own identity | Personal actions never become tenant/global account administration |

For all four tenant roles, AI Assistant visibility also requires `modules.aiAssistant`; actual use additionally requires a configured platform provider and access to each referenced record. Provider-unavailable feedback follows Section 6.5/11.3 and does not expose the API key or model configuration. News ticker visibility requires `modules.newsTicker`; public/reference news does not grant access to tenant business data. Disabling a module hides its menu and related dashboard widgets and prevents their feature-specific loaders from mounting. Do not add subscription entitlements.

An explicit superuser organization-management context receives the admin-column visibility and known tenant capabilities, plus the tenant-administrator appointment actions specified in Section 4.3. Keep System Admin available for returning to platform management. Do not fabricate `tenantRole: 'admin'`: display the platform-management label from Section 6.6 and keep the capability DTO's tenantRole null.

#### 4.5.3 Organization dashboard content

Reuse `DashboardView`; this section does not add dashboard pages or new widgets. The dashboard's record set and all derived values follow the same scope as its clickable destination.

| Existing content or class of content | Tenant `admin` | Tenant `manager` | Tenant `editor` | Tenant `viewer` | Required rendering/data behavior |
| --- | --- | --- | --- | --- | --- |
| Active partner count and total | Selected organization | Assigned departments | Assigned departments | Assigned departments | Count only permitted partners; click opens the identically scoped Partners view |
| Active contract count, total, and contract value | Selected organization | Assigned departments | Assigned departments | Assigned departments | Do not calculate tenant-wide totals and filter only the displayed rows |
| Commercial-document/IO count and total | Selected organization | Assigned departments | Assigned departments | Assigned departments | Hide the widget when commercialDocuments is disabled |
| Contract status, type, expiry, renewal, and due-diligence summaries | Selected organization | Assigned departments | Assigned departments | Assigned departments | Every chart bucket, tooltip, calendar item, and drill-down uses permitted records |
| Spending trends, category/period totals, and currencies | Selected organization | Assigned departments | Assigned departments | Assigned departments | Requires spending module; scope before allocation, conversion, grouping, and aggregation |
| Notifications and expiring-contract badges | Selected organization | Assigned departments | Assigned departments | Assigned departments | Never show another department's or organization's unresolved count |
| Operational create/edit/delete/export/download shortcuts | Only granted actions | Only granted actions | Only granted actions | Read navigation only | Use exact Section 4.4 grants, module availability, and target resource checks |
| Platform user/session counts, global organization directory, credentials, database/reset cards | Hidden | Hidden | Hidden | Hidden | These belong only in System Admin, including when superuser views this tenant dashboard |

Non-admin legacy memberships with no valid department assignments see the scoped dashboard shell and an explicit no-department-access state. Do not request/return unscoped business records or display organization-wide totals. Valid scopes containing no matching records display an empty state and scoped zero totals. These two states must not be confused with network/authorization failure.

#### 4.5.4 Combined role examples and exceptional states

| Identity state and selected context | Visible dashboard/menu outcome | Prohibited inference |
| --- | --- | --- |
| Platform user; admin in A; viewer in B; A selected | A operational dashboard and all three A Settings tabs; no System Admin | A membership admin does not grant platform authority |
| Same identity; B selected | B department-scoped dashboard; no tenant Settings or creation workspace | Do not carry A's settings visibility, counts, or cached capabilities into B |
| Platform user; manager in A only | A department-scoped dashboard and Members & Access only | Cannot select/read B or open Organization/Integrations/platform configuration |
| Platform user; editor or viewer in A | A department-scoped operational reads; editor has its existing write grants; neither sees Settings | Hiding Settings must also deny deep links/API requests |
| Platform user; no active membership | Personal preferences/security and access-status state only | No default/first organization, business dashboard, or platform directory |
| Platform user; suspended A membership; active B membership | B remains available; A business data/settings unavailable | Tenant suspension does not globally ban the account or revoke B access |
| Superuser; no memberships; no organization selected | System Admin dashboard, platform controls, organization directory, personal account actions | Do not invent membership or load a default tenant dashboard |
| Same superuser; explicitly manages A | A operational dashboard and three-tab Settings with platform-management label; System Admin remains available | Do not merge B records or expose platform configuration through A settings APIs |
| Any role; capability request pending/failed | Loading/retry or denied state; no privileged component/data load | No bootstrap/global-role fallback |
| Any identity; expired/revoked session or global ban | Session/access-denied state; no protected dashboard or menu loaders | Membership or cached superuser role does not bypass identity validation |

#### 4.5.5 Implementation precedence

Resolve identity and platform authority first, then the explicit selected organization, current membership or permitted platform-management context, known capabilities, resource/department scope, and module visibility. A platform role check alone is insufficient for organization UI. A tenant role check alone is insufficient for platform UI. Use the matrices as mandatory UI/API acceptance requirements; preserve the action restrictions in Sections 4.3 and 4.4.

## 5. Server identity, tenant context, and authorization

### 5.1 Identity resolution

Use one shared identity resolver across custom endpoints and the plugin boundary. It must validate token/session expiry, revocation, user existence, and ban status. An expired or malformed expiry is invalid. A raw session-row fallback must enforce the same checks as Better Auth.

Never establish identity or privilege from `x-user-email`, `x-google-user-email`, `x-user-role`, `x-role`, query email, or request-body actor fields. Stop sending role/identity assertion headers from `getAuthHeaders()`. Retain the current supported cookie/Bearer transport for compatibility; cookie-based mutations must receive equivalent same-origin/CSRF protection through verified configured origins. Do not implement this task as an unrelated token-storage redesign.

### 5.2 Organization selector rules

All new tenant endpoints use `/api/organizations/:organizationId/...`. The path is mandatory and must identify an existing canonical organization ID, not a display name or slug.

Legacy endpoints select from explicit headers/query only under their documented adapters. Rules:

1. Collect every explicit organization selector: canonical path, `x-organization-id`, `x-tenant-id`, relevant legacy query, and legacy body organization field.
2. If explicit selectors disagree, return `400 ORGANIZATION_SELECTOR_CONFLICT` without mutation. New body schemas forbid redundant organization fields.
3. An explicit selector takes precedence over a session's default active organization. A session default must never override an explicit permitted selection.
4. For ordinary identities, verify current membership and status in SQLite for every protected request. Do not authorize from a client membership list or cached membership status.
5. On a legacy request with no explicit selector, use a session default only if still accessible. Otherwise return `409 ORGANIZATION_REQUIRED`; do not silently choose the first organization.
6. GET/list/profiling operations must not persist an active organization, provision resources, or create memberships.
7. Never use `db.activeTenantId`, default tenant aliases, or `__no_tenant__` as authorization fallback.
8. Resource IDs, organization IDs, and slugs are selectors, not access proof.

### 5.3 Superuser context

A superuser may access a known tenant endpoint without membership when the endpoint's explicit platform organization-management policy allows it. Such context has `accessMode: 'platform'`, no manufactured membership, the selected organization ID, and an explicit effective tenant permission list.

Do not use `actor.role === 'superuser'` as an unconditional resource bypass inside a tenant endpoint: the resource must still belong to the selected organization. Global operations use platform routes. A global account-list endpoint is not a tenant-list endpoint with the organization filter removed.

### 5.4 Resource boundary

Authorize the persisted resource's actual ownership. `requirePermission()` must not synthesize a resource using the actor's tenant and then treat that as proof of target ownership.

- List/count/search/export queries include verified organization scope before pagination and aggregation.
- Resource reads/updates/deletes match both organization ID and resource ID.
- Creates set organization ID from trusted context and reject ownership-changing input.
- Parent/child references, team assignments, documents, and integration resources are validated inside the same organization.
- Membership updates target membership ID plus organization ID, never every row with the same user ID.
- Batch mutations validate all targets before writing and fail atomically; no partial cross-scope success.
- Async work captures validated organization context; workers never consult global active tenant. Revalidate current user membership for user-initiated queued work before execution. System jobs must carry explicit service authority and organization scope.
- Settings/membership changes and audit insertion commit in one SQLite transaction. Google/email operations happen after commit and must report external failure honestly.

### 5.5 Route coverage and public exceptions

Create `docs/rbac/tenant-boundaries-endpoint-inventory.md` during implementation with every Express and Better Auth endpoint family, method, public/self/platform/tenant classification, permission, resource loader, and verification reference. Inspect paths under `/api/auth/google/*` and `/uploads/*` as well as ordinary `/api/*`.

The existence of a global session middleware is not a route permission. Replace the method-to-document permission fallback. Every protected operation requires its own declared policy; an unclassified operation is denied until its policy is recorded.

Retain only necessary public paths: login/signup/auth verification flows, minimal health/public setup status, atomic one-time first-run setup, existing public exchange-rate reference endpoints, public presentation branding, and the minimal invitation-token preview described in Section 8. Public branding contains only the existing `TenantBranding` fields `appName`, `logoUrl`, `primaryColor`, `footerText`, and `loginHeadline`. Everything exposing business data, provider configuration, membership, account information, or Google tokens is protected. Auth-plugin public paths are enumerated, not accepted by a broad `/api/auth/*` exemption.

### 5.6 Errors and disclosure

Use `{ error: string, message: string, requestId: string }` for new error responses. Existing localizer may translate `message`; error codes remain stable.

| Condition | Status/code |
| --- | --- |
| Missing/expired/revoked session | `401 UNAUTHENTICATED` |
| Globally banned account | `403 ACCOUNT_DISABLED` |
| No permitted organization, wrong-tenant resource, or suspended membership | `404 RESOURCE_NOT_FOUND` on tenant access paths |
| Valid membership/context but missing action permission | `403 INSUFFICIENT_PERMISSION` |
| Explicit selector disagreement | `400 ORGANIZATION_SELECTOR_CONFLICT` |
| Unknown role/permission or invalid input fields | `400 INVALID_INPUT` |
| No valid selection for a legacy tenant operation | `409 ORGANIZATION_REQUIRED` |
| Stale settings version | `409 VERSION_CONFLICT` |
| Last-admin/superuser invariant | `409 LAST_ADMIN_REQUIRED` / `409 LAST_SUPERUSER_REQUIRED` |
| Existing membership on invitation acceptance | `409 MEMBERSHIP_EXISTS` |
| Duplicate pending invitation | `409 INVITATION_EXISTS` |
| Unsupported Google sync | `409 SYNC_UNAVAILABLE` |

For the same foreign resource ID, do not return tenant name, existence details, counts, stack traces, or provider identifiers. A denied action has zero business mutations and zero Google/email calls. Server-side security denial logging is allowed, with redaction and verified identity.

## 6. Unified Settings UX and navigation contracts

### 6.1 Tenant sidebar and screen

Keep all existing operational navigation and module visibility rules. This PRD does not remove dashboard, contract, partner, document, commercial-document, or other operational routes. Change only administration/settings entry points.

The tenant sidebar has exactly one settings-related parent entry, **Settings**. Remove the Organization Admin parent and tenant settings submenus. The Settings content renders:

```text
Settings — Example Organization
Role in this organization: Admin

[ Organization ] [ Members & Access ] [ Integrations ]
```

An admin sees three tabs. A manager sees only Members & Access. Editors/viewers see no Settings entry and cannot mount its content through deep links. Personal preferences and account security are under the existing avatar menu.

Do not add Organization Administration, Organization Settings, separate Invitations/Departments/Audit pages, or an Account sidebar parent. Do not render inaccessible cards with disabled controls for tenant users. Do not mount or fetch a hidden platform component.

### 6.2 Canonical navigation IDs

Keep `NavigationContext` and `/app?tab=...`. Do not introduce React Router or parallel navigation state.

| ID | Meaning |
| --- | --- |
| `settings-organization` | Organization tab |
| `settings-access` | Members & Access tab |
| `settings-integrations` | Integrations tab |
| `admin-system-dashboard` and existing system console IDs | Existing System Admin console |
| `admin-system-settings` | Global configuration content within the same System Admin console |

Default Settings destination is `settings-organization` for tenant admin/superuser management and `settings-access` for manager. Avatar Preferences and Account Security open dialogs; they do not become sidebar routes.

Map old URLs with `replaceState`, preserving unrelated query parameters and hash:

| Old ID | Destination |
| --- | --- |
| `settings`, `settings-region`, `settings-notifications` | `settings-organization` |
| `settings-google` | `settings-integrations` |
| `admin-organization-dashboard`, `admin-organization-users`, `admin-organization-teams`, `admin-organization-invitations` | `settings-access`; optional open/filter state may expose the requested existing dialog |
| `admin-users` / `admin-users-*` | System console for superuser; `settings-access` for authorized tenant admin/manager |
| `settings-ai`, `settings-security`, `settings-language` | `admin-system-settings` for superuser; access-denied state for ordinary tenant users |
| `activity-logs` | `settings-access` with History drawer open for tenant admin or explicit superuser organization management; access-denied state otherwise |

Reject unrecognized `settings-*` or `admin-*` suffixes. Replace broad prefix-based tab allowlisting with exact route/alias definitions. Run guards before lazy component mount or data fetching. Unauthorized deep links show a generic access-denied state with a permitted destination button; they must not briefly render privileged content.

### 6.3 Organization tab — existing fields retained

Use sections within this tab, not new pages. Retain the current field widgets and country/industry-pack logic:

1. **Profile:** organization name, legal entity, brand name, tagline, logo, primary color.
2. **Region and formatting:** country, industry, default/reporting currency, timezone, generated-content language.
3. **Contract and due diligence rules:** warning window, governing law, dispute venue, DD overrides/custom checklist.
4. **Notifications and modules:** reminder offsets, three recipient fields, current five module toggles.

Use collapsible sections with visible labels; each section has a separate Save action and updates only its fields. A save in Notifications cannot resubmit AI, SMTP, storage, profile, or other stale form state.

The current `TenantSettings.modules` booleans remain tenant-configurable by admin. Do not add platform entitlements, subscription gating, or a new licensing screen. Platform provider availability may make AI unavailable operationally without rewriting the tenant's module preference.

### 6.4 Members & Access tab

- Reuse existing user/invitation tables, pagination, table filters, and dialogs where compatible.
- Default table shows active memberships; filters are Active, Suspended, and Pending Invitations.
- `Invite member` opens a dialog; there is no separate invitation page.
- `Departments` opens a dialog/drawer; admin can manage departments, manager can view only assigned departments.
- `History` opens a scoped audit drawer for admin/superuser. It is not a sidebar route. Default to administrative events from the canonical audit endpoint. A dataset selector may show the existing operational activity table in the same drawer, using the scoped legacy endpoint; preserve its existing filters and details without adding a fourth Settings tab or standalone page.
- Table columns: name, email, tenant role, departments, membership status, actions.
- Do not include global session counts, authentication provider details, global ban state/reason, password information, other memberships, or platform role in tenant member DTOs.
- Rename tenant actions to **Suspend membership**, **Reactivate membership**, and **Remove membership**. Remove global Ban/Delete Account/Set Password/Change Email controls from tenant forms.
- A role dropdown contains only server-provided assignable roles. The server rechecks the selection.
- No tenant picker in tenant invite/edit dialogs. The screen's selected organization is the target.
- Manager mutations follow the full-target-department rule in Section 4.3.

### 6.5 Integrations tab

Show organization Drive folder mapping, organization Sheet mapping, provider availability, and a **Refresh status** action. Separate the labels **Provider configured** and **Resource mapping configured**; a configured service account does not prove that a folder exists or is accessible.

The existing Google synchronization routes are placeholders. Required behavior in this release:

- SQLite remains the authoritative persistence layer.
- No automatic sync toggle is enabled, no scheduled Google job is created, and no successful Google-sync claim is made.
- Preserve migrated legacy `autoSync` preference in storage for compatibility, but return `syncSupported: false` and `effectiveAutoSync: false`.
- Hide the tenant **Sync now** action while `syncSupported` is false. Display a short explanation that Google synchronization is unavailable in this release.
- Legacy sync calls return `409 SYNC_UNAVAILABLE` for authorized callers and do not fake `lastSyncTime` or connection success. Unauthorized callers are denied before receiving capability details.
- Existing implemented upload/file/provisioning services remain usable only through their explicit scoped/platform operations. This PRD does not replace them with a new sync engine.

There is no credential upload, Google account global disconnect, master root, SQLite card, or provider-secret form on this tab.

### 6.6 System Admin reuse

Keep one System Admin sidebar entry and reuse `AdminUsersView` in system mode. Add a **Configuration** tab inside that console for cards moved from Settings:

- Deployment branding.
- Google OAuth/service-account credentials and master resource provisioning.
- AI API key, test action, and platform model selection.
- SMTP relay and test action.
- SQLite browser/status/optimization.
- Application-wide reset.
- Shared UI translation dictionary, edited only by System Admin, persisted on the server and refreshed on active pages every five seconds.

Use grouped cards or collapsible sections within this console. Do not add a new sidebar entry for each category. Existing global user/session/API-key/RBAC management remains in System Admin with platform DTOs and platform permission.

An organization row offers **Manage organization**: select the organization's explicit context and open the same tenant Settings screen. The header shows `Platform administrator managing <organization>`. The operation does not create membership or impersonation. Provide a Back to System Admin action.

### 6.7 Avatar and browser preferences

Reuse theme/language controls. Preferences are local to the authenticated user, using keys `user:<userId>:language` and `user:<userId>:theme`. Cross-device persistence is deferred; no `user_preferences` table or preference API is required here.

Do not automatically import origin-wide `app_language` or `app_custom_translations` into another user's identity. Ignore those legacy keys when no namespaced preference exists and apply the existing product defaults; leave their stored values intact. Do not add an import workflow. UI text overrides are platform-wide: System Admin saves them through `PATCH /api/platform/configuration` (`uiTexts`), and all browsers read the non-sensitive dictionary through `GET /api/system/ui-texts`. Language/theme preferences remain personal. Existing local overrides are not automatically published. Tenant users receive the shared dictionary and have no runtime dictionary editor.

Account Security opens a dialog for the current user's password change and own sessions, using Better Auth self-service endpoints. It must not use Admin-plugin reset/set-password for an ordinary user. OAuth-only accounts show their sign-in method and own sessions; do not require a password that does not exist.

### 6.8 Accessibility and feedback

Retain existing design tokens and UI components. Tabs must have tab/tablist/tabpanel semantics, arrow-key navigation, visible focus, and associated panels. Dialogs return focus to their trigger. Validate fields near their labels and expose save errors through an accessible alert.

During context/capability loading, show skeletons with no stale administrative controls. A capability failure shows Retry, not inferred role privileges. No hidden tab is fetched. Unsaved settings block tab/organization departure with **Stay** and **Discard changes**; do not silently auto-save. On a completed switch, close tenant-bound dialogs and clear drafts.

## 7. Settings ownership, exact fields, and storage

### 7.1 Field ownership table

| Existing field/control | Target owner and storage | Target location |
| --- | --- | --- |
| `Tenant.name`, `domainSlug` | `organization.name`, `organization.slug` | Organization/Profile; slug read-only for tenant admin |
| `legalEntity`, `brandName`, `tagline`, `logoUrl`, `primaryColor` | `organization_settings.profile`; organization logo mirrored from canonical profile on writes | Organization/Profile |
| All existing `TenantSettings` fields | `organization_settings.policy` | Organization tab |
| `notificationEmails`, `legalNotificationEmail`, `financeNotificationEmail` | `organization_settings.notifications` | Organization/Notifications |
| Tenant `driveFolderId`, `spreadsheetId`, `autoSync` preference | `organization_integrations` | Integrations |
| Master `driveFolderId`, `spreadsheetId`, `masterSpreadsheetId`, `masterSpreadsheetUrl` | Existing platform `app_settings.google_config` payload | System Admin/Configuration |
| `geminiApiKey`, `aiModel` | Platform `google_config` payload | System Admin/Configuration |
| All `smtp*` fields | Platform `google_config` payload | System Admin/Configuration |
| Platform Google `accessToken`, `refreshToken` | Platform credential/config store; never exposed in configuration GET | Platform connection actions only |
| Service-account/OAuth JSON | Existing `integration_credentials` | System Admin/Configuration |
| `TenantBranding` deployment fields | Existing singleton `branding` row, `organizationId = NULL` | System Admin/Configuration |
| `isLocked` / edit-unlock controls | UI interaction only; legacy value retained as inactive migration data | Optional local form edit confirmation; no access authority |
| SQLite browser/optimization | Platform service only | System Admin/Configuration |
| Application reset | Platform service only | System Admin/Configuration |
| UI language/theme | User-namespaced localStorage | Avatar Preferences |

Do not rename the existing `app_settings` table or extend its restricted ID CHECK to many category IDs just to partition platform configuration. Keeping the `google_config` row as an internal platform-only payload avoids an unnecessary schema rebuild. Remove active tenant recipient/resource mappings from that payload after migration; archive original values in migration backup.

### 7.2 Canonical new storage

Add `organization_settings`:

```text
organizationId TEXT PRIMARY KEY REFERENCES organization(id)
payload TEXT NOT NULL
version INTEGER NOT NULL DEFAULT 1
updatedAt TEXT NOT NULL
updatedBy TEXT REFERENCES user(id)
```

Its validated JSON payload is exactly:

```ts
interface OrganizationSettingsPayload {
  profile: {
    legalEntity: string;
    brandName: string;
    tagline: string;
    logoUrl: string;
    primaryColor: string;
  };
  policy: TenantSettings;
  notifications: {
    notificationEmails: string[];
    legalNotificationEmail: string | null;
    financeNotificationEmail: string | null;
  };
}
```

The canonical organization name/slug live only in `organization`. Do not duplicate them as separately editable settings fields. A profile update changes organization name and the profile payload atomically.

Add `organization_integrations`:

```text
organizationId TEXT PRIMARY KEY REFERENCES organization(id)
driveFolderId TEXT NULL
spreadsheetId TEXT NULL
legacyAutoSync INTEGER NOT NULL DEFAULT 0 CHECK (legacyAutoSync IN (0,1))
version INTEGER NOT NULL DEFAULT 1
updatedAt TEXT NOT NULL
updatedBy TEXT REFERENCES user(id)
```

Enforce unique non-empty Drive folder mapping and unique non-empty Sheet mapping across organizations. An organization cannot claim another organization's mapped resource. URL fields are derived from validated IDs and are not independent write fields. Non-empty Drive/Sheet IDs must match `^[A-Za-z0-9_-]{10,200}$`; reject legacy placeholder `Folder_` values for new writes.

Enable foreign keys on every opened SQLite connection. Add unique indexes for `member(organizationId,userId)` and `teamMember(teamId,userId)` after conflict-free migration. Team assignment additionally requires membership in the team's organization through the service/transaction validator; a simple team foreign key alone does not establish membership.

Add `member.status` with active/suspended values, default active; register the additional field with Better Auth so plugin routes cannot ignore it. Account `user.banned` remains a platform/global state. Organization lifecycle may continue using its existing lifecycle behavior; a new organization-suspension feature is deferred rather than invented.

### 7.3 Authoritative state and projection rules

- SQLite canonical organization/member/team/settings/integration rows are authoritative for administration.
- `db.tenants`, `tenant.settings`, display currency, and compatibility metadata are read projections, reconstructed from canonical storage.
- Stop bidirectional hydration that writes old tenant payload or whitelist roles back into canonical membership/settings.
- Generic `synchronizeCoreData()` may continue existing business-table persistence but must not snapshot-replace the new canonical tables or the append-only audit table.
- Persistence errors must propagate to the API; do not return success after `saveDb()` catches and swallows a settings/membership failure.
- Metadata updates through plugin routes cannot overwrite canonical settings/integrations or inject an organization role/platform role.
- Validate JSON payloads on read. Invalid stored configuration produces a controlled configuration error, not default-tenant fallback.

### 7.4 Validation and update semantics

New write schemas reject unknown fields. Do not spread arbitrary `req.body` into persisted config. Use existing validation facilities where practical; no new schema dependency is required.

- Name: trimmed string, 1–200 characters. Slug: preserve existing format and uniqueness; only platform organization-management changes it.
- Legal entity/brand name: trimmed strings, at most 200 characters. Tagline: at most 500.
- Logo: empty or a same-origin safe asset/upload URL or HTTPS URL, at most 2,048 characters; reject `javascript:`/HTML/data payloads. Tenant logos do not grant access to an upload.
- Primary color: six-digit hex color or the existing default value.
- Country/industry/currency/language: values present in the existing pack/currency/language catalogs. Preserve the existing neutral `INTL` pack.
- Timezone: valid IANA timezone accepted by `Intl.DateTimeFormat`.
- Warning days: integer 1–730. Reminders: non-empty array of unique integers 1–730, stored descending.
- Governing law/venue: strings at most 2,000 characters. Preserve existing optional/default behavior.
- DD overrides/custom checklist: validate against the existing `TenantSettings` structures, reject unknown override booleans, duplicate custom keys, and invalid types. Keep existing checklist normalization and evidence retention.
- Modules: exactly the existing five boolean keys.
- Recipient list: at most 100 distinct normalized email strings, at most 254 characters each; legal/finance values are one email or null. Legacy comma/semicolon lists are converted during migration; malformed tokens become conflicts, not silently discarded recipients.
- Integration mapping: nullable validated IDs, never arbitrary metadata, tokens, SMTP fields, or organization reassignment.

Settings and integration writes include `expectedVersion`. A mismatch returns 409 without mutation. Section-specific PATCH merges only provided permitted fields; nested module/DD updates must not erase unrelated keys. Return the committed version and DTO. Forms refresh after successful save and show a reload option on conflict.

### 7.5 Provider secrets and public/runtime DTOs

Tenant DTOs must not include secret values, secret suffixes, provider account email, master resource IDs, SMTP infrastructure, or SQLite details. Platform configuration GET returns non-secret settings plus `hasGeminiApiKey`, `hasSmtpPassword`, and provider status; secret input fields are blank on load. Secret PATCH semantics: omitted means retain; a non-empty value means replace; explicit `null` means clear with the existing confirmation flow. Do not use masked strings as write protocol.

Retain existing Google credentials status validation/store and environment fallback. This PRD does not claim the current credential payload is encrypted or mandate a new KMS integration.

Public deployment branding exposes only intended presentation fields. An authenticated tenant runtime policy endpoint may return the existing non-secret policy/country/industry/checklist information needed to render operational forms. It does not grant administrative Settings UI access. Generated-content language remains tenant policy; UI display language remains personal preference.

## 8. Member, department, invitation, and onboarding behavior

### 8.1 Membership mutations

Organization member DTOs join the membership in the selected organization, not the user's first membership. They show only that organization's role/departments/status.

Role/status updates, removals, and assignments validate target membership ownership and the hierarchy matrix. Removing a membership deletes only that organization's team assignments and member row, or marks it removed through an equivalent canonical implementation; it must not remove identity, accounts, global sessions, documents, or other organization memberships. This release's canonical API uses removal of the member row after invariant checks; audit preserves the event.

Suspend changes `member.status` only. The next request into that organization is denied even if the global session remains valid. Reactivate cannot override a global ban. Do not globally revoke sessions for tenant suspension/removal.

Tenant user creation becomes invitation. Platform account creation remains platform-only and does not grant any membership automatically. Password reset, email changes, global bans, and global account deletion are platform or self-service operations, never tenant member actions.

### 8.2 Departments

Use canonical team IDs and `team.organizationId`. Duplicate department names are rejected case-insensitively within the same organization; identical names in different organizations are permitted.

- Create/rename: admin/superuser policy, scoped SQL and projection update.
- Add/remove assignment: target has membership in this organization; every department belongs to it; no changes to another organization's assignments.
- Delete: return `409 DEPARTMENT_IN_USE` if members or persisted resources reference it. Do not orphan users/resources or auto-move them to an invented department.
- GET/list never creates a default department or hydrates legacy departments as an access side effect.
- A manager sees only assigned departments and cannot create/delete/rename or change membership assignments.

### 8.3 Invitations

Use cryptographically random opaque invitation IDs with at least 128 bits of entropy. They may serve as invitation tokens compatible with Better Auth. IDs are not authorization for administration endpoints.

- Invite body is `{ email, tenantRole, departmentIds }`; organization comes from path.
- Ordinary admin may invite manager/editor/viewer; manager may invite editor/viewer into a non-empty subset of their own departments; superuser may invite admin in explicit organization context.
- Non-admin role invitations require at least one department; admin invitations must have no department assignments.
- Persist multiple department IDs in a validated additional invitation field; keep `teamId` as a compatibility projection of the first ID, not the authoritative set.
- `inviterId` is the verified identity. Never hardcode `admin`.
- A pending invitation expires seven days after creation or an authorized resend.
- Existing active/suspended membership returns `409 MEMBERSHIP_EXISTS`; invitations must not silently upgrade/reactivate it.
- Duplicate non-expired pending email/organization invitation returns `409 INVITATION_EXISTS`.
- Cancel sets status `canceled`; it does not delete the audit evidence. Resend is allowed only for pending/expired invitations after hierarchy/scope validation, never accepted/canceled invitations.
- Email is sent after commit using platform mail delivery. If sending fails or SMTP is absent, retain pending invitation and show **Invitation created; email not sent** with a copy-link action for authorized administrators. Do not report successful delivery or expose full SMTP errors to tenant callers.
- Preview requires token possession and returns only organization display name, intended tenant role, expiry, and invitation status; it never returns a user directory, raw provider information, or credential data. No mutation on preview.
- Acceptance requires authenticated, non-banned identity with verified email matching the normalized invited email, pending status, unexpired invitation, valid departments, and still-valid invitation role authority. Recheck that the inviter remains authorized or is currently a non-banned superuser; revoked/demoted inviters cannot leave privileged outstanding invitations usable.
- Acceptance transaction adds exactly one membership and requested valid team assignments, marks accepted, and appends audit. It never creates a user directly, sets emailVerified from a display-name/body value, changes platform role, or modifies another membership.
- Repeated/concurrent acceptance produces at most one membership. Return a documented conflict on the second acceptance.

### 8.4 Signup and first-run setup

Preserve the existing requirement that unapproved registrations do not automatically gain access. Ordinary account creation always writes platform role `user`.

- Active allowlist status or a valid pending invitation may allow registration/login for onboarding. Neither source grants platform role or active membership by itself.
- Unapproved registrations keep the current pending-approval account behavior. Platform approval changes only account approval, not a membership inferred from the first organization.
- An invitation permits its intended identity to complete verification. Configure Better Auth's supported email-verification callback with the existing platform mailer for email/password accounts; verification state comes from Better Auth's token verification or a verified identity provider.
- The sign-in/signup screen preserves an invitation token through login and shows an inline verification/acceptance action or dialog. Do not add an admin-navigation page for onboarding.
- If verification delivery is unavailable, show the unavailable status; do not mark the account verified or accept the invitation as a workaround. A verified Google identity may use the existing Google login flow.
- Signup, allowlist synchronization, profile GET, and ordinary organization creation must never elevate an identity to superuser.
- Preserve `/api/system/setup` for a fresh install, but creation of the first superuser must be atomic and allowed only while none exists. A second/concurrent attempt cannot create another bootstrap account through the public endpoint.
- Demo setup/reset may assign explicit fixture memberships only through the trusted setup service. Existing global demo roles must be converted to platform user plus membership roles; do not reintroduce legacy global admin on every boot.

## 9. API contracts

New administrative endpoints use the following contracts. Application code must use these canonical endpoints after implementation. Compatibility endpoints in Section 10 call the same services or reject deprecated unsafe writes; they do not retain parallel business logic.

### 9.1 Identity/context DTOs

`GET /api/me`:

```ts
interface IdentityResponse {
  identity: {
    id: string;
    email: string;
    name: string;
    image: string | null;
    emailVerified: boolean;
    platformRole: PlatformRole;
  };
  memberships: Array<{
    id: string;
    organizationId: string;
    organizationName: string;
    tenantRole: TenantRole;
    status: MembershipStatus;
    departmentIds: string[];
  }>;
  platformPermissions: string[];
  defaultOrganizationId: string | null;
}
```

Memberships are this identity's memberships only, including suspended entries so the UI can explain loss of access. The switcher uses only active memberships. A superuser's platform organization directory comes from its platform API, not fabricated memberships.

`GET /api/organizations/:organizationId/capabilities`:

```ts
interface OrganizationCapabilities {
  organizationId: string;
  accessMode: 'membership' | 'platform';
  membershipId: string | null;
  tenantRole: TenantRole | null;
  departmentIds: string[];
  permissions: string[];
  assignableTenantRoles: TenantRole[];
}
```

For platform management, tenantRole/membershipId are null and effective permissions are explicit. Ordinary identities cannot set `accessMode` through input.

`POST /api/me/active-organization` accepts `{ organizationId }`, validates access, and updates that session's default selection only. It returns the selected canonical ID. Request headers must not contain the previous organization's selector for this identity-scoped selection operation; conflicting explicit selectors are rejected.

### 9.2 Tenant endpoints

| Method/path | Required policy | Body/response contract |
| --- | --- | --- |
| `GET /api/organizations/:organizationId/capabilities` | Valid membership or permitted platform-management context | Capability DTO above |
| `GET /api/organizations/:organizationId/policy` | Valid organization access | Existing non-secret `TenantPolicyView`; tenantId equals canonical organizationId |
| `GET /api/organizations/:organizationId/settings` | `tenant.settings.read` | `{ organizationId, name, slug, profile, policy, notifications, version }` |
| `PATCH /api/organizations/:organizationId/settings` | `tenant.settings.update` | `{ expectedVersion, name?, profile?, policy?, notifications? }`; at least one update field |
| `GET /api/organizations/:organizationId/members` | `tenant.member.read` with role scope | `{ members: OrganizationMember[], total }`; scoped filters/search/pagination |
| `PATCH /api/organizations/:organizationId/members/:membershipId` | Exact changed-field permission plus target hierarchy | `{ tenantRole?, status?, departmentIds? }`; at least one field; atomic |
| `DELETE /api/organizations/:organizationId/members/:membershipId` | `tenant.member.remove` | `204`; only target membership/own-tenant assignments removed |
| `GET /api/organizations/:organizationId/departments` | `department.view` | Scoped department DTOs |
| `POST /api/organizations/:organizationId/departments` | `department.create` | `{ name }`; `201` department DTO |
| `PATCH /api/organizations/:organizationId/departments/:departmentId` | `department.edit` | `{ name }` |
| `DELETE /api/organizations/:organizationId/departments/:departmentId` | `department.delete` | `204` or `DEPARTMENT_IN_USE` |
| `GET /api/organizations/:organizationId/invitations` | `tenant.invitation.read` with role scope | Scoped invitation DTOs; no raw secret/provider fields |
| `POST /api/organizations/:organizationId/invitations` | `tenant.member.invite` plus hierarchy/scope | Invite body in Section 8; `201`, invitation, inviteUrl, delivery status |
| `POST /api/organizations/:organizationId/invitations/:invitationId/resend` | `tenant.invitation.resend` plus target scope | Invite DTO and delivery status |
| `DELETE /api/organizations/:organizationId/invitations/:invitationId` | `tenant.invitation.cancel` plus target scope | `204`; marks canceled |
| `GET /api/invitations/:token/preview` | Minimal token preview policy | Minimal preview only |
| `POST /api/invitations/:token/accept` | Verified matching identity; no prior membership required | `201` own membership DTO |
| `GET /api/organizations/:organizationId/integrations/google` | `tenant.integration.read` | Scoped mapping/status DTO below |
| `PATCH /api/organizations/:organizationId/integrations/google` | `tenant.integration.update` | `{ expectedVersion, driveFolderId?, spreadsheetId? }` |
| `GET /api/organizations/:organizationId/audit` | `tenant.audit.read` | Scoped sanitized audit events, total, pagination |

Use `limit` 1–100 and non-negative `offset` on new list endpoints. Apply scope before counts and pagination. Tenant member DTO is `{ id, userId, name, email, tenantRole, status, departmentIds, createdAt }`; `id` is membership ID, not identity ID. No global-account controls consume it as a ConsoleUser.

List defaults are `limit=25`, `offset=0`, ordered by `createdAt` descending then ID ascending. Member filters are `status=active|suspended` (default active), optional `departmentId`, and optional `search` (trimmed, maximum 200 characters, case-insensitive name/email substring). Apply actor scope before every filter and total. The Pending Invitations UI filter uses the invitation endpoint with `status=pending`, not a fabricated member status. Invitation list also accepts `status=accepted|canceled|expired`; omitted status means pending. Expired is derived from timestamp and is not a GET-triggered database update.

Department DTO is `{ id, organizationId, name, createdAt }`; department list returns `{ departments, total }` and accepts the same limit/offset/search bounds, with name search only. Invitation DTO is `{ id, organizationId, email, tenantRole, departmentIds, status, expiresAt, createdAt }`. Invitation list returns `{ invitations, total }`; raw tokens and invite URLs are absent from lists. Create/resend returns `{ invitation, inviteUrl, delivery: 'sent' | 'not_sent' }` to the authorized caller only. Preview returns `{ organizationName, tenantRole, expiresAt, status }`. A missing/unknown token returns `404 RESOURCE_NOT_FOUND`; invalid/canceled/expired/previously accepted tokens return `409 INVITATION_NOT_ACCEPTABLE` on acceptance. An email mismatch/unverified identity returns `403 INVITATION_IDENTITY_MISMATCH` / `403 EMAIL_VERIFICATION_REQUIRED`. None of these errors exposes the invited email to an unmatched identity.

Integration GET DTO is `{ organizationId, driveFolderId, spreadsheetId, providerConfigured, mappingConfigured, syncSupported: false, effectiveAutoSync: false, version }`. Status refresh is a GET refetch with no provisioning or mutation. Do not include credential hints or global master IDs.

### 9.3 Fixed administrative permission catalog

| Permission | Admin | Manager | Editor/viewer |
| --- | --- | --- | --- |
| `tenant.settings.read`, `tenant.settings.update` | Yes | No | No |
| `tenant.member.read`, `tenant.member.invite` | Yes | Department scope | No |
| `tenant.member.role.update`, `tenant.member.status.update` | Lower-role scope | Full target-department scope | No |
| `tenant.member.departments.update`, `tenant.member.remove` | Lower-role scope | No | No |
| `tenant.invitation.read`, `tenant.invitation.resend`, `tenant.invitation.cancel` | Allowed target roles | Allowed roles and own departments | No |
| `department.view` | All organization departments | Assigned departments | No admin list |
| `department.create`, `department.edit`, `department.delete` | Yes, with ownership/in-use checks | No | No |
| `tenant.integration.read`, `tenant.integration.update`, `tenant.audit.read` | Yes | No | No |
| `tenant.data.import` | Organization scope | No | No |
| `workspace.view`, `workspace.switch` | Own accessible membership(s) | Own accessible membership(s) | Own accessible membership(s) |

Keep this catalog and Section 4.4 in the server policy source. Client visibility and plugin adapters derive from it. Do not independently hardcode a second role matrix in JSX.

The exact platform permission identifiers are:

```ts
const platformPermissions = [
  'platform.access',
  'platform.user.read', 'platform.user.create', 'platform.user.update',
  'platform.user.role.update', 'platform.user.ban', 'platform.user.delete',
  'platform.user.password.reset',
  'platform.session.read', 'platform.session.revoke',
  'platform.organization.read', 'platform.organization.create',
  'platform.organization.update', 'platform.organization.delete',
  'platform.organization.manage',
  'platform.apikey.read', 'platform.apikey.create',
  'platform.apikey.revoke', 'platform.apikey.delete',
  'platform.policy.read',
  'platform.configuration.read', 'platform.configuration.update',
  'platform.database.read', 'platform.database.optimize',
  'platform.application.reset', 'platform.audit.read',
] as const;
```

Only superuser receives these known permissions. Platform organization management resolves tenant permissions under Section 5.3. Unban/reactivation uses `platform.user.ban`; changing another identity's email/name uses `platform.user.update`. Neither permits a platform-role update without `platform.user.role.update`.

### 9.4 Platform endpoints and configuration protocol

Keep existing system console endpoints where they already represent platform operations, but apply platform policy from Section 9.3. They are not accessible through tenant permissions.

Add `GET/PATCH /api/platform/configuration`. PATCH is `{ section, values }`, where section is exactly `branding`, `google`, `ai`, or `smtp`, and values are strictly allowlisted for that section using Section 7.1. Existing provider test, credentials, database, reset, account, session, and API-key action routes remain platform-only rather than gaining many new UI pages.

GET configuration returns `{ branding, google, ai, smtp }` with section-specific non-secret fields and configured flags. Tenant loaders never call this endpoint.

System organization list returns canonical organization summaries; **Manage organization** uses explicit context. Existing creation/deletion behavior must preserve account/resource integrity and last-admin invariants. Do not add automatic cascades that delete business data merely because membership is removed.

## 10. Compatibility adapters and direct Better Auth routes

### 10.1 Legacy application endpoints

| Existing route family | Required final behavior |
| --- | --- |
| `/api/user/my-role` | Identity-scoped adapter to `/api/me`; return explicit platformRole/memberships. Remove role ambiguity and GET grants. Internal callers migrate; do not keep an unsafe global admin fallback |
| `/api/rbac/me` | Scoped capability adapter plus explicit platform context; no wildcard or inferred bootstrap privileges |
| `/api/rbac/matrix`, `/roles`, auth-console RBAC matrix | Platform-only full matrix. Ordinary tenant callers receive only their own capability catalog, not platform-management configuration |
| `/api/rbac/check`, simulations | Server-resolved actor; never accept another identity or wider tenant scope from body. Unknown codes denied; platform simulations remain platform-only |
| `GET /api/tenants` | Own active membership summaries for ordinary user; platform directory for superuser. Side-effect-free |
| `POST /api/tenants/switch` and organization `set-active` | Identity selection adapter; own membership access allowed for every role; session-only default |
| `/api/tenant-settings` GET | Runtime policy adapter with explicit validated selector |
| `/api/tenant-settings` PUT | Admin/platform settings service adapter; strict policy/legalEntity fields and expectedVersion. Reject provider fields |
| `/api/auth-console/users` account CRUD/role/ban/password/bulk families | Platform-only global account operations. Tenant callers migrate to member routes; never reinterpret a global delete as a tenant delete silently |
| `/api/auth-console/accounts`, `/sessions`, `/api-keys`, `/sqlite`, `/overview` | Platform-only |
| `/api/auth-console/teams` and `/invitations` | Scoped adapters to canonical services; explicit selector, per-action policy, actual target ownership |
| `/api/auth-console/invitations/verify`, `/accept` | Minimal preview and verified-identity acceptance adapters; accept excluded from admin-area guard |
| `/api/auth-console/organizations` GET | Tenant callers receive only their accessible organization summaries; superuser uses directory. Writes are platform-only |
| `/api/tenants` lifecycle writes | Platform-only canonical organization service |
| `/api/tenants/:id/setup-google` | Scoped integration update; valid folder and Sheet mapping; no client actor claims |
| `/api/tenants/:id/sync-google` | Authorized scope check, then `SYNC_UNAVAILABLE`; no fake success |
| `/api/google-integration` configuration/connect/disconnect, `/api/smtp/test`, AI-key test, master/all-folder provisioning | Platform-only; strict field sections, no tenant data leaks |
| `/api/google-integration/sync`, `/sync-flush` | Verified explicit/session organization context and `tenant.integration.update`, then `409 SYNC_UNAVAILABLE`; no mutation/provider call |
| `/api/google-integration/sync-status` | Verified organization context and `tenant.integration.read`; return only `{ organizationId, active: false, queueLength: 0, status: 'unavailable', syncSupported: false }` |
| `/api/branding` GET | Intended public presentation DTO only; tenant branding comes from tenant settings/runtime projection |
| `/api/branding` POST | Platform-only branding service |
| `/api/user/allowed-users` family | Platform onboarding allowlist only; never tenant directory or authority for role |
| `/api/departments` | Scoped canonical department service; no first-organization fallback |
| `/api/activity-logs` | Scoped existing operational `ActivityLog[]` for `tenant.audit.read` in selected organization; no unowned/foreign events; canonical administrative audit uses its new endpoint |
| `/api/init-data` | Scoped operational payload described in Section 11 |
| `/api/admin/reset-database` | Existing confirmation and platform-only policy retained |

Adapters keep legacy success wrappers where needed for existing callers, but their body ownership and authorization must match canonical services. Remove obsolete internal callers; do not preserve insecure compatibility for hypothetical external clients. Document changed legacy payloads in the implementation handoff.

### 10.2 Better Auth integration

Configure Admin plugin `defaultRole: 'user'`, with only `superuser` as admin role and a known platform permission set. No `admin` tenant role is registered as a globally privileged identity role.

Configure Organization plugin fixed tenant roles and equivalent action checks; disable ordinary user organization creation. Backend platform creation uses a verified service operation and assigns the selected first tenant admin explicitly. Do not create an organization owner whose global identity becomes superuser.

Direct plugin mutation paths must either invoke equivalent shared validators/hooks or be explicitly denied in favor of canonical application services. There is no requirement to expose every plugin mutation. Document the choice per endpoint in the inventory and prove that raw plugin requests cannot bypass the rules. If a library hook cannot enforce target ownership/status/hierarchy, deny that direct path rather than allowing a weaker policy.

Plugin read/list/get-active-member/set-active paths must enforce membership status, organization selectors, and response scope. Default plugin `owner` semantics do not override this application's fixed roles. Register compatibility handling only for legacy membership data, not for new role writes.

Do not upgrade Better Auth to match current website examples. Inspect the installed version's API/types and use supported hooks or a boundary wrapper.

## 11. Frontend state, operational data, and storage boundaries

### 11.1 Provider responsibilities

- `AuthContext`: verified identity, platformRole/platformPermissions, session lifecycle, login/logout.
- `TenantContext`: own membership list, accessible organization summaries, per-tab selection, validated session-default update.
- `PermissionProvider`: current organization capability DTO; may remain in `src/lib/permissions.ts` with an explicit tenant dependency.
- `TenantSettingsContext`: non-secret runtime policy and admin settings services; do not overload policy read permission with admin access.

Provider order must allow identity, then organization selection, then tenant capability/policy. A permission provider outside tenant context must not obtain tenant context by reading unrelated localStorage on its own. Resolve current circular ownership before rendering MainApp. Retain QueryClient, theme, language, dialog, toast, and navigation providers.

Remove tenant privilege usage of `AuthContext.isAdmin`, `UserSession.role`, `isGlobalAdmin`, and global department labels. If temporary adapters are needed for operational forms, their role/departments must derive from the verified current capability context; a platform role is never assigned to tenantRole. Audit every `useAuth()` role check and every `rbacScoping` caller.

### 11.2 Per-tab selection and switching

Use `sessionStorage['activeOrganizationId:<userId>']` for tab selection. Stop using origin-global `localStorage.activeOrganizationId` as an authoritative selector. A session default is only the initial preference.

Initial selection:

1. Validate a saved tab selection against current accessible organizations.
2. Otherwise use a valid server session default.
3. If exactly one accessible organization exists, select it through the validated selection endpoint.
4. If several exist with no valid selection, show a simple organization chooser; do not auto-select the first.
5. No memberships: show no-access state, with personal account/logout controls. Superuser with no selection can open System Admin.

On switching, confirm unsaved changes, block tenant mutations, cancel previous loads, validate selection on the server, and load new capabilities/policy/data under a selection revision. Commit the visible selected organization only when identity/context is validated. Never call three separate set-active endpoints for one switch.

Ignore responses whose organizationId/selection revision no longer matches. On failure, retain the old valid selection. Switching between tabs with one shared session does not change the other tab's explicit request selector.

Use `organization-updated` only as a refetch notification after a successful validated operation, not as an authority. Logout clears identity-bound query caches and active tab selection. Handle external logout/session invalidation without displaying cached privileged content.

### 11.3 Capability failure

Permissions have explicit loading/ready/error states. Before ready, effective sensitive permissions are empty. An empty response stays empty. A failed request does not restore role-based bootstrap admin privileges. Do not render admin tabs while continuing a stale previous-tenant permission list.

Server membership/status is rechecked for every request regardless of client state. A revoked member may have a stale tab open, but its next protected request is denied. On denial, clear that organization's cache/context and refresh own memberships.

### 11.4 Operational init DTO

Retain current operational arrays and timestamp in `/api/init-data`, but filter tenant/department scope consistently and remove `tenants` and mixed `googleConfig`:

```ts
interface WorkspaceInitResponse {
  organizationId: string;
  contracts: Contract[];
  ios: InsertionOrder[];
  partners: Partner[];
  notifications: NotificationLog[];
  evaluations: PartnerEvaluation[];
  spendings: PartnerSpending[];
  services: {
    aiAvailable: boolean;
    googleUploadsAvailable: boolean;
  };
  timestamp: number;
}
```

Use stable identity ID plus organization ID in query keys. Preserve the existing per-user/per-tenant TanStack Query approach and extend the same scoping to admin loaders, forms, document lists, drawers, and integration requests. Remove hardcoded Drive/Sheet IDs and connected defaults from `EMPTY_DATA`; absence is empty/unavailable, not another deployment's resource.

Every tenant-mutating request captures the intended organization ID when constructed. Never read a new global selection midway through an autosave/keepalive operation.

### 11.5 Uploads, exports, AI, and background work

Fix existing scope escape paths without reorganizing physical storage:

- Resolve an existing local file URL to its owning persisted partner/contract/document/evidence record(s), then verify selected organization and applicable resource permission. Display-name folder equality is insufficient; two organizations may sanitize to the same folder name.
- Remove ordinary admin access to unowned root upload files. If ownership is ambiguous/unresolved, deny until explicitly mapped; do not delete/move the file.
- Keep security headers for file serving and reject traversal/invalid encoding.
- Search/export/download APIs, counts, AI prompts, OCR caches, and notification jobs must include canonical organization context. OCR/cache keys include organization ID when inputs/results can differ by tenant.
- AI uses platform credentials/model but only selected-organization/authorized-resource data. Its module preference remains organization policy.
- Reminder recipients and language are loaded from the record's owning organization, not global config or whichever workspace is open.
- Global/system jobs enumerate organizations under explicit service authority. Tenant user requests cannot invoke an all-organization job.

## 12. Audit requirements

Use the existing `audit_log` schema from `server/migrations/001_rbac_alignment.sql` as the canonical append-only administrative audit store; ensure it is initialized for deployments that have never run that SQL. Preserve its columns `id`, `actor_id`, `action`, `target_type`, `target_id`, `tenant_id`, `department_id`, `impersonated_by`, `metadata`, and `created_at`. Do not create a second admin audit table.

Each event contains event ID, UTC timestamp, request ID, actor identity ID, actor platformRole, accessMode, target organization ID or null for platform operations, action, target type/ID, outcome, and sanitized changed-field names. Include impersonatedBy only when an actual existing feature requires it.

Map canonical organization ID to existing `tenant_id`; keep `department_id` null for organization-wide changes. Store `created_at` as an ISO 8601 UTC string. Store `metadata` as validated JSON `{ schemaVersion: 1, requestId, actorPlatformRole, accessMode, outcome, changedFields }`, where accessMode is `membership` or `platform`, outcome is `success` or `denied`, and changedFields is an array of field-path strings. Preserve the original metadata for historical events and return a sanitized compatible read projection. Platform application-wide operations use target type `installation` and target ID `installation`. Preserve actor IDs when a global account is deleted; do not cascade-delete its audit records.

Required events: invitation create/resend/cancel/accept; membership role/status/department update/remove; department create/update/delete; organization profile/policy/recipient/integration changes; platform role/configuration/account lifecycle; database maintenance/reset. Authorization denials may be logged as redacted security events without business mutation.

Do not log passwords, credentials, auth tokens, invitation tokens/URLs, raw SMTP payloads, full document contents, or recipient lists as before/after values. Log changed field names and safe resource identifiers instead.

Tenant audit GET filters by organization, exposes permitted administrative events only, and excludes platform secrets/foreign identity metadata. Manager/editor/viewer do not receive this drawer. Existing operational `activity_logs` may remain for activity views; generic snapshot deletion or its 500-event trimming must not truncate canonical administrative audit.

Tenant audit response is `{ events, total }`; each event is `{ id, createdAt, actorId, actorName, action, targetType, targetId, organizationId, outcome, changedFields, accessMode }`. Do not expose raw metadata, actor email, IP address, platform-role details, or impersonation/session details in this projection. Use an empty actorName if the deleted identity cannot be resolved. Apply Section 9 list bounds and allow optional action and targetType exact-match filters. Platform audit is `GET /api/platform/audit`, requires `platform.audit.read`, and may filter by explicit `organizationId`; it still returns sanitized events rather than secret-bearing metadata.

## 13. Required repository change map

Paths below are implementation targets, not files already created by this PRD. New modules may be consolidated when that reduces duplication, but their listed responsibilities and tests remain mandatory.

| File/area | Required work |
| --- | --- |
| `server/rbac.ts` | Split PlatformRole/TenantRole policy; explicit known catalogs; strict hierarchy/resource checks; no ambiguous owner normalization or wildcard |
| `server/rbacRoutes.ts` | Scoped capabilities/adapter routes; platform-only full matrix; authorization against actual resource ownership |
| `server.ts` | Replace global-role/method floor, selector/global-active logic, relevant routes, init DTO, legacy resource fallback, jobs/provider readers, uploads ownership, setup/reset integration |
| `src/lib/auth.ts` and `server/auth.ts` | Platform-only Admin plugin; membership policy; signup/verification/approval hooks; configurable DB path; canonical settings load/migration guard |
| `src/server/authConsoleRoutes.ts` | Global operations platform-only; scoped adapters; remove hydration that overwrites memberships/settings; separate DTOs; no first-org default |
| `src/server/coreDataStore.ts` | Preserve business persistence; stop canonical snapshot replacement; persistence/error tests |
| `server/tenantPolicy.ts` | Read canonical organization settings; reject unresolved organization IDs; keep country/industry/business policy helpers |
| New `src/server/organizationSettingsStore.ts` | Canonical settings/integration schema, validators, read/write, optimistic version checks |
| New `src/server/organizationAdminRoutes.ts` | Canonical tenant endpoints/services and member/department/invitation ownership checks |
| New shared identity/context module under `server/` | Session identity verification, selectors, membership/platform context, reusable route policies |
| `src/server/googleCredentials.ts` | Keep credential parsing/store; evaluate platform authority independently of tenant role |
| `src/server/documentRoutes.ts` | Consume verified context; preserve known document behavior and enforce actual resource scope |
| `src/types.ts`, `src/components/admin/types.ts` | Explicit identity/capability/member/config/runtime DTOs; eliminate unrestricted role strings on new write contracts |
| `src/context/AuthContext.tsx` | Identity DTO and session lifecycle only; no role-based tenant admin fallback |
| `src/context/TenantContext.tsx` | Accessible memberships and per-tab selection; single switching service |
| `src/lib/permissions.ts` | Scoped capability loading and fail-closed visibility; platform capability helpers separate |
| `src/context/TenantSettingsContext.tsx` | Runtime policy versus administrative settings; explicit organization and stale-response protection |
| `src/lib/apiFetch.ts` | Remove client identity/role assertions; explicit selection headers; do not inject old tenant selectors into self/platform operations |
| `src/lib/rbacScoping.ts` | Remove fuzzy/global role access decisions; use current capability context and canonical IDs |
| `src/features/workspace/useWorkspaceData.ts`, related API hooks | New init DTO, no provider config, no foreign hardcoded resource fallback, identity/organization cache keys |
| `src/App.tsx`, `NavigationContext.tsx`, `Sidebar.tsx`, `Header.tsx` | Exact Settings IDs/aliases, one sidebar parent, pre-mount guards, context labels, avatar dialogs, correct provider order |
| `src/components/SettingsView.tsx` | One tenant screen with three tabs; remove global config and old six-section orchestration |
| `src/components/DashboardView.tsx`, dashboard loaders and aggregate helpers | Apply Section 4.5 visibility and scope before all counts/charts/drill-downs; module-aware widgets; no platform cards or global totals |
| `src/components/settings/OrganizationRegionSettings.tsx` | Retain existing fields/pack behavior; exact permissions, canonical service, section saves |
| `src/components/AdminUsersView.tsx`, `src/components/admin/*` | Reuse UI; separate identity/member forms/loaders; integrate access tab and System Admin Configuration |
| `src/components/ActivityLogsView.tsx` | Reuse operational table inside the History drawer with scoped loader; canonical audit uses its explicit DTO; remove standalone tenant audit navigation |
| New `src/components/admin/PlatformConfigurationPanel.tsx` | Reuse global cards/forms within existing System Admin; no new sidebar parents |
| `WorkspaceSwitcher.tsx`, `TenantDashboard.tsx` | Membership switching, accessible summary only, no alternate plugin policy |
| `LanguageContext.tsx`, `ThemeContext.tsx`, `UITextManagerModal.tsx` | User/browser scope; preserve dictionaries/design; platform-only editor |
| `GoogleCredentialsDialog.tsx`, `SQLiteDatabaseCard.tsx`, `ResetWorkspaceDialog.tsx` | Reuse inside System Admin; rename reset copy to application-wide scope |
| `SignInForm.tsx` | Preserve invitation token through auth; verification/acceptance inline state; no tenant admin page |
| `server/migrations/002_tenant_boundaries.ts` (new) | Introspected, transactional, idempotent role/settings/constraint migration and redacted reports |
| `tools/migrate-tenant-boundaries.ts` (new) | Explicit-path dry-run/apply CLI; no implicit live DB target |
| `tools/gen-rbac-matrix.ts`, `tools/gen-rbac-migration.ts`, RBAC tools/scripts | Update split role catalogs/generators; do not regenerate a destructive history or retain contradictory owner/switch rules |
| Tests/Playwright/environment path helpers | Isolated fixtures, new acceptance suites, updated existing assertions |

Do not apply old generated patcher tools to the current source as a shortcut. Their base/assumptions may predate current uncommitted work.

## 14. Migration, preservation, and deterministic conflict handling

### 14.1 Migration execution contract

Implement a standalone migration with explicit absolute database path. Default CLI mode is dry-run. `--apply` is required for mutation. Do not run an irreversible migration automatically as a side effect of importing auth or starting an old production instance.

Existing deployments must run the migration before the new administrative code is enabled. If legacy data is present without the completed migration marker, startup returns a controlled migration-required state and does not hydrate/save legacy administrative projections. Fresh empty test/install databases may initialize the new schema directly.

Add a migration ledger with ID `002_tenant_boundaries`; applying twice makes no second semantic data change. Backup with SQLite's consistent backup API so WAL content is included; copying `auth.db` alone while active is insufficient.

Dry-run/report contents: schema/version, role counts, canonical organization mappings, rows needing migration, duplicate/orphan counts, setting ownership mappings, unresolved record IDs, and planned session invalidation count. Do not print real emails, secret values, payload dumps, or tokens. Report secret presence as booleans.

The CLI accepts only the following migration flags: `--db <absolute-path>`, `--report <absolute-path>`, optional `--mapping <absolute-path>`, optional `--dry-run`, and optional `--apply --backup <absolute-path>`. Require `--db` and `--report`. Reject relative paths, an absent source database, unknown flags, both execution modes together, and a backup path equal to the source. Apply requires an unused backup path; an existing backup must not be overwritten. Omitting both execution modes means dry-run. Dry-run opens the source read-only and must not import modules that initialize authentication/schema or startup jobs.

Synthetic usage after implementation:

```bash
npm run tenant-boundaries:migrate -- --db /tmp/clm-migration-case/auth.db --report /tmp/clm-migration-case/report.json
npm run tenant-boundaries:migrate -- --db /tmp/clm-migration-case/auth.db --report /tmp/clm-migration-case/apply-report.json --mapping /tmp/clm-migration-case/mapping.json --apply --backup /tmp/clm-migration-case/before.db
```

The JSON report includes `formatVersion: 1`, `migrationId`, `sourceDigest`, `conflicts`, `plannedChanges`, and `applied`. Each conflict has a stable `conflictId`, a `kind`, redacted record references, and the permitted resolution kinds. Compute `sourceDigest` from a deterministic snapshot of the source schema and relevant records. Apply rechecks this digest inside the write transaction; a source change invalidates the mapping and requires a new dry-run. A digest is not permission to expose its source values.

The mapping file contract is:

```ts
interface MigrationMapping {
  formatVersion: 1;
  migrationId: '002_tenant_boundaries';
  sourceDigest: string;
  resolutions: Array<
    | { conflictId: string; decision: 'map-organization'; organizationId: string }
    | { conflictId: string; decision: 'set-platform-role'; userId: string; platformRole: PlatformRole }
    | { conflictId: string; decision: 'set-membership'; userId: string; organizationId: string;
        tenantRole: TenantRole; status: MembershipStatus; departmentIds: string[];
        survivingMembershipId: string | null }
    | { conflictId: string; decision: 'choose-source'; sourceRef: string }
    | { conflictId: string; decision: 'set-settings-field'; organizationId: string;
        fieldPath: string; value: unknown }
    | { conflictId: string; decision: 'quarantine-resource' }
  >;
}
```

Resolution meanings are fixed. `map-organization` maps only the conflict's referenced legacy records to an already existing canonical organization. `set-platform-role` resolves the referenced identity's ambiguous global role. `set-membership` resolves missing/conflicting memberships for that exact identity/organization and retains the specified existing survivor; null is permitted only when the report explicitly identifies a missing membership to create. `choose-source` selects a source reference enumerated by that conflict, read internally from SQLite. `set-settings-field` supplies one non-secret profile/policy/notification/integration field, validated against Section 7; it cannot modify platform credentials. `quarantine-resource` preserves a business record/file without tenant access and records its reference in the migration report; it cannot quarantine an identity, membership, team, or settings conflict.

Reject unknown fields, duplicate/unknown conflict IDs, mismatched referenced identities/organizations, unsupported resolution kinds, invalid role/department combinations, foreign target departments, and unresolved blocking conflicts. Never let a generic mapping object execute SQL or overwrite arbitrary table fields. A reviewed mapping is operator-supplied data, not automatically generated approval of suggested ownership.

### 14.2 Role migration precedence

1. Existing valid membership role is authoritative for that organization. Never overwrite all memberships using global `user.role`.
2. Canonicalize membership role `owner -> admin`, `legal -> manager`, `finance -> editor`, `staff/member -> viewer` after verifying parent organization/user. Case/spacing normalization is permitted for these documented values.
3. Canonical global `superuser` remains platform superuser. Documented global `super_admin`/`super admin` can map to it; a bare global `owner` is ambiguous and blocks apply pending an explicit reviewed mapping.
4. Canonical global `user` remains platform user. Global `admin/manager/editor/viewer/legal/finance/staff/member` becomes platform user. Its existing valid memberships retain their individually normalized roles. Unknown or missing global roles are conflicts requiring explicit `set-platform-role` resolution; they do not inherit a role from signup order.
5. A legacy role can seed a missing membership only through an explicit record-owned organization ID and a reviewed migration mapping. No first/default organization or email-name heuristic.
6. Ordinary identity with no membership remains platform user with no organization access. Do not grant access to keep its old UI working.
7. Unknown membership roles, comma-separated combined roles, conflicting duplicates, orphaned user/org/team links, and unresolved ownership block apply until valid explicit resolutions are supplied. Business resources may instead receive an explicit quarantine resolution as described above. Do not silently downgrade or combine roles.
8. Exact duplicate membership rows with identical normalized role/status/ownership may be deduplicated using earliest createdAt then lexicographic ID; audit/report removed duplicate IDs. Differing duplicate roles/statuses require a reviewed mapping.
9. Preserve all valid multi-organization memberships and other-organization department assignments.
10. Invalidate existing sessions once at successful migration cutover, after backup, to remove stale cached global roles. Users must sign in again; credentials remain intact.

### 14.3 Organization, department, and resource ownership

Canonical organization mapping uses verified matching IDs or an explicit reviewed mapping file. Slug/display-name similarity alone is not an ownership mapping.

Map department/PIC legacy strings only when an exact normalized department-name match is unique inside an already verified organization. Normalize by trimming, collapsing repeated whitespace, and case folding; do not use substring/fuzzy matches. An unknown or ambiguous assignment is a reported conflict. Resolve it explicitly before apply; missing legacy assignments may remain empty with a report warning and no operational department grants. They remain administrator-visible for reconciliation.

Resources without organization ID or with legacy default aliases require an explicit reviewed mapping or quarantine resolution before apply. Keep quarantined records/files intact but inaccessible to ordinary tenant operations. Do not move them to the first/default organization or delete them. Unresolved resource conflicts block cutover; explicitly quarantined resources do not. Report every quarantined reference for later operator reconciliation.

### 14.4 Settings migration precedence

- Copy existing per-organization policy/profile/resource mappings to their canonical rows.
- If canonical and projection/metadata sources disagree, report conflict and require mapping; do not choose whichever was loaded last.
- Keep provider/SMTP/master resource configuration platform-owned. Do not replicate credentials across tenants.
- Global notification recipients do not have verifiable tenant ownership. Map them only through an explicit migration mapping; copying to every tenant is forbidden. Empty global values need no mapping.
- Global business/resource IDs may seed a tenant mapping only where an explicit reviewed mapping identifies that organization's resource. Resource-sharing conflicts block apply.
- Preserve legacy autoSync value as `legacyAutoSync`; effective sync remains unavailable.
- Preserve built-in dictionaries. Browser preferences are not migrated through SQL into tenant settings.
- Legacy settings/archive data stays in the backup and optional migration archive; active runtime reads only canonical ownership.

### 14.5 Reset/setup and projection coexistence

Update trusted setup/demo/reset services to initialize canonical rows and explicit membership roles. Preserve application-wide reset confirmation and provider credentials behavior; make labels accurate. Do not let startup hydration recreate deleted membership or reassign suspended members to the default organization.

Legacy tenant/department projection tables may remain as derived compatibility data. Writes to those projections cannot overwrite canonical settings/member/team ownership.

### 14.6 Recovery

A failed migration rolls back its transaction and does not set the completion marker. Validation failure has no schema/data mutation in dry-run mode. Keep the backup and report for operator review.

Production rollback must not be an automatic downgrade to the old authorization implementation. Prefer a fixed forward release or an offline restore of the complete compatible application/database pair under operator control. Never restart insecure legacy handlers against partially migrated data.

No production migration or destructive reset is executed while implementing or testing this PRD unless separately authorized for a named environment.

## 15. Isolated verification environment

The current default E2E fixture seeds repository `auth.db`; it is unsuitable for this change until isolation is implemented.

Add one shared runtime-path resolver with:

- `AUTH_DB_PATH`: explicit absolute SQLite path; normal development default remains current repository `auth.db`.
- `APP_DATA_DIR`: explicit absolute directory for uploads, legacy data_store JSON, and other mutable runtime files; normal development default remains current working directory.
- `APP_TEST_MODE=1`: requires explicit paths inside a newly created test temporary directory, disables demo reseeding, startup Google provisioning, SMTP/Google/AI calls and unrelated periodic work, and rejects live fallback paths.

Replace every hardcoded additional `new Database(path.join(process.cwd(),'auth.db'))` and storage path with the shared resolver. Unit-test service functions accept an injected database/transport where practical.

Create an isolated runner, e.g. `tools/run-tenant-boundaries-tests.mjs`, which uses `mkdtemp`, creates synthetic fixtures, spawns the application with the configured paths, and cleans up after closing processes/connections. It must never reuse a server already running against an unknown database.

Required package scripts after implementation:

```text
test:tenant-boundaries       isolated live API/migration/integration suite
test:e2e:tenant-boundaries   isolated live browser suite
tenant-boundaries:migrate    explicit-path migration CLI
```

Add Settings mocked-browser tests to `playwright.fixtures.config.ts`. Update default Playwright/seed behavior so future ordinary `npm run test:e2e` does not seed the workspace database. Keep fixture-only browser tests separate from live authorization evidence.

Use synthetic `example.test` users and fake local provider transports. No actual email, Google provisioning, paid AI calls, production security probes, or real credential fixtures. Record before/after checksums of non-test runtime files to demonstrate they were not touched by verification.

## 16. Acceptance criteria and evidence

Every criterion below is **Required**. API/migration verification runs only in the isolated environment in Section 15. Browser fixture tests prove UI behavior; isolated real-server tests prove server behavior. They are not substitutes for each other.

### 16.1 Synthetic fixture matrix

- Organizations A and B.
- Departments A-Legal, A-Finance, B-Legal, including identical display names across organizations.
- A platform superuser with no membership.
- Separate admin/manager/editor/viewer identities in A.
- A multi-organization identity with admin in A and viewer in B.
- A target editor assigned to both A-Legal and A-Finance for partial-scope manager tests.
- Suspended membership, no-membership identity, globally banned identity, expired/revoked sessions.
- A and B operational records, mapped uploads/resources, unresolved root upload, and legacy migration fixtures.

### 16.2 Criteria

| ID | Starting condition and trigger | Expected behavior and prohibited side effects | Verification |
| --- | --- | --- | --- |
| AC-001 | Admin A opens Settings | Exactly one tenant Settings parent and three tabs; no Organization Admin parent or platform controls | Mocked and live browser desktop/mobile |
| AC-002 | Manager A opens Settings | Only Members & Access; own department scope; no organization/integration/audit fetch | Browser request assertions + API scope checks |
| AC-003 | Editor/viewer opens Settings URL | No privileged component/request; access-denied state; API rejects admin operation | Browser deep-link and direct API tests |
| AC-004 | Same identity admin A/viewer B switches A to B | B viewer capabilities replace A admin; old settings/data disappear; global identity unchanged | Browser plus DB assertions |
| AC-005 | User edits header/query/path/body to B without B membership | 404 or selector-conflict 400 as specified; no B metadata/data/mutations | Live API parameter matrix |
| AC-006 | Explicit permitted B selector while session default is A | B membership role governs; server does not silently serve A | Live API + simultaneous tab test |
| AC-007 | Two users/tabs select different organizations | Neither modifies other's explicit context; no global activeTenant mutation | Concurrent API/browser test |
| AC-008 | Repeated GET me/tenants/departments/capabilities/status | No new membership/allowlist/team/default selection/provisioning; no external calls | DB snapshot diff + transport spies |
| AC-009 | Admin requests tenant init/settings/member/integration DTOs | No foreign tenants/memberships or platform secrets/config; scoped totals | Live response schema assertions |
| AC-010 | Tenant admin invokes raw Better Auth Admin routes | Denied global list/get/role/ban/session/password actions | Live plugin-route tests |
| AC-011 | Raw Organization plugin operations attempt forbidden create/admin invitation/status bypass | Same policy as canonical API or explicit denial; no membership/role escalation | Live plugin-route tests |
| AC-012 | Admin A changes/removes member who also belongs to B | Only A membership and A assignments change; identity/credentials/sessions/B membership stay intact | Transactional DB assertions |
| AC-013 | Tenant admin attempts peer-admin or platform role changes | Denied, including direct/bulk/plugin paths | API + policy unit tests |
| AC-014 | Manager with partial overlap changes multi-department target | Denied mutation while permitted scoped visibility remains; no other dept changed | Policy and API tests |
| AC-015 | Inviter submits superuser/foreign team/foreign tenant/unknown role | Rejected before record/email creation | API + transport spies |
| AC-016 | Correct verified invitee accepts pending unexpired invitation | One membership/assignments, accepted status, audit; platform role stays user | API/DB test |
| AC-017 | Wrong/unverified identity, canceled/expired invite, revoked inviter, or replay accepts | Denied/conflict; no membership/identity creation or auto-verification | API cases + concurrent acceptance |
| AC-018 | New invited email/password user signs up | Platform user only; verification required; membership added only through valid acceptance | Isolated auth/onboarding test |
| AC-019 | Membership suspended/removed after capability load | Next tenant request denied; other memberships and global session remain usable | Live API + browser cache clearing |
| AC-020 | Session expired/revoked or identity banned | Denied consistently on new, legacy, plugin, and upload paths | Live API/session matrix |
| AC-021 | Settings section saves with current version | Only specified org fields change; other sections/orgs/platform unchanged; audit committed | DB before/after + API |
| AC-022 | Two saves use same expectedVersion | One commits; stale save conflicts with no lost update | Concurrent API test |
| AC-023 | Tenant integration mapping uses B's mapped resource | Denied; no ownership change/provider call; folder and Sheet updates persist for valid A mapping | API + DB restart test |
| AC-024 | Authorized user invokes placeholder sync | SYNC_UNAVAILABLE; no false timestamp/connection/success; no Google call | API + browser test |
| AC-025 | Provider missing, config request fails, or capability response is empty | Honest unavailable/retry state; no default/hardcoded connected resource/admin fallback | Mocked browser failure tests |
| AC-026 | Slow A response arrives after switch to B | A response ignored; B cache/UI not overwritten | Controlled browser request ordering |
| AC-027 | User leaves dirty form/tab/org | Stay/Discard dialog; no silent save/discard; cancel preserves draft | Browser interaction test |
| AC-028 | Duplicate display-name folders or unowned root upload requested | Ownership verified by persisted resource; foreign/ambiguous files denied | Live upload/download tests |
| AC-029 | Search/export/AI/OCR/reminder executes in A | Only permitted A context, recipient config, cache key and records used | Injected transport/service + API tests |
| AC-030 | Superuser without membership opens System Admin/manages A | Platform available; explicit A context; no synthetic membership; correct audit actor | Live browser/API/DB |
| AC-031 | Last tenant admin/superuser is removed, suspended/banned, or demoted | 409; invariant holds under concurrent attempts | DB transaction/concurrency test |
| AC-032 | Department deletion would orphan members/resources | DEPARTMENT_IN_USE; no orphan/reassignment | API/DB test |
| AC-033 | Platform config/reset/credential/database action attempted as tenant admin | Hidden in UI and denied by every direct route; existing platform actions work for superuser | Browser/API matrix |
| AC-034 | Personal language/theme and shared UI dictionary | Language/theme remain namespaced; System Admin text edits reach all users and organizations | Browser storage/user-switch and shared-text tests |
| AC-035 | Successful admin mutation and persistence/audit failure injection | Either mutation+audit commit together or neither; no success on swallowed DB failure | Transaction/fault-injection tests |
| AC-036 | Dry-run/apply/reapply legacy migration | Dry-run no mutation; apply preserves valid multi-membership data/config ownership; second apply no semantic change | Isolated migration fixtures |
| AC-037 | Ambiguous role/ownership/conflicting duplicates in migration | Apply refused with redacted report; no guessed first/default tenant or partial marker | Migration failure fixtures |
| AC-038 | New server restarts after canonical write | Canonical changes survive and old hydration does not overwrite/recreate membership/settings | Isolated process restart |
| AC-039 | Old URL aliases and browser Back/Forward used | Defined canonical destination/denial; no old duplicate screen or transient privilege | Browser routing tests |
| AC-040 | Full test suite executes | Workspace auth.db/uploads/runtime files unchanged; test server only uses temporary paths | Runner safety assertions |
| AC-041 | Fresh concurrent setup attempts | At most one initial superuser; later public setup denied; no signup elevation | Isolated setup concurrency test |
| AC-042 | Keyboard user navigates tabs/dialogs on desktop/mobile | Tab semantics, focus restoration, visible focus, accessible loading/error state | Playwright accessibility/keyboard checks |
| AC-043 | Each platform role opens every Section 4.5.1 surface, with and without organization selection | Exact platform visibility/denial; superuser default is platform dashboard; user with no membership loads no tenant business data | Live browser route/request matrix + API tests |
| AC-044 | Each tenant role opens Section 4.5.2 surfaces with enabled/disabled modules | Exact menu/tab/dialog visibility and pre-mount guards; only admin has Import Data; platform controls absent; direct API checks still enforced | Parameterized browser and live API role matrix |
| AC-045 | A/B and same-organization foreign-department fixtures have different counts/values | Every Section 4.5.3 dashboard card/chart/badge/drill-down reflects only permitted records; module-disabled widgets absent; no-department state has no unscoped data | Live dashboard fixture tests + aggregate/response assertions |

### 16.3 Validation commands after implementation

```bash
npm run lint
npm test
npm run test:tenant-boundaries
npm run test:e2e:fixtures
npm run test:e2e:tenant-boundaries
npm run build
```

The three new script contracts do not exist yet. Implement them before claiming their commands ran. Do not run current live E2E or a migration against repository `auth.db` while preparing this document.

Update conflicting existing tests to this PRD's explicit rules, particularly owner mapping, workspace switching, role representation, UI parent visibility, and missing-department behavior. Preserve unrelated assertions. Do not delete failing acceptance tests to obtain a green result.

If baseline unrelated tests fail, record the unchanged failure with evidence and compare against baseline; do not hide it or expand the feature into unrelated repair. Tests, build, and type checks must be reported individually as passed/failed/not run with their actual environment.

## 17. Implementation work packages and completion gates

Execute in dependency order. These packages are work sequencing, not a requirement to create multiple PRs or delegate agents.

| Package | Required deliverables | Gate before next dependent package |
| --- | --- | --- |
| WP-01 Baseline and safe harness | Preserve dirty work; endpoint inventory; isolated DB/storage/transport runner; baseline validation | No test path can fall back to workspace/live data |
| WP-02 Policy and context | Split role types/catalog, strict identity resolver, selector semantics, resource checks, policy tests | Role/selector/session/hierarchy tests pass |
| WP-03 Canonical persistence and migration | Settings/integration storage, member status/constraints, migration CLI/reports, hydration changes | Dry-run/apply/idempotency/conflict/restart tests pass |
| WP-04 API and plugin boundaries | Canonical routes, legacy adapters, registration/invitation verification, upload/job/DTO scope | Live API/plugin negative tests pass |
| WP-05 Single Settings UX | Three tabs, integrated member tools, moved platform cards, avatar dialogs, exact routes, switch/cache behavior | Mocked and live browser/accessibility tests pass |
| WP-06 Regression and handoff | Full validation, generated policy docs, before/after screenshots with synthetic data, migration operator instructions | All required criteria have evidence or explicitly unresolved status |

During backend/frontend transition, use a private development branch/fixture environment, not a production feature flag that can re-enable old insecure handlers. Do not deploy a partially migrated frontend/backend combination.

### 17.1 Required handoff artifacts

- Updated endpoint inventory with every operation classified and linked to policy/tests.
- Generated role/permission matrices separating platform from membership roles.
- Migration dry-run/apply examples using explicit synthetic paths, conflict mapping format, backup/recovery instructions.
- Acceptance evidence table with all AC IDs, actual tests, result, environment, and remaining limitations.
- UI screenshots of admin, manager, viewer, and superuser contexts using synthetic data.
- Description of changed compatibility payloads and removed tenant global-account actions.
- Concise changed-file summary and confirmation that unrelated dirty work was preserved.

### 17.2 Definition of Done

The feature is complete only when the three-tab Settings UX exists, platform and membership authority are distinct throughout the application, no tested direct/legacy/plugin path crosses the defined boundaries, canonical data survives restart/migration, every required acceptance criterion has passing evidence, and type/unit/integration/browser/build validation is reported truthfully.

An attractive sidebar, a passing standalone RBAC engine, or a mocked browser test alone does not establish completion.

## 18. Reference basis

The detailed field ownership, navigation, and role rules above are this application's proposed specification. External sources support the general boundary principles, not an instruction to adopt their complete architecture.

- [OWASP Multi-Tenant Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html): verify tenant context server-side and carry scope through data access, cache, storage, and asynchronous work.
- [Better Auth Admin plugin](https://better-auth.com/docs/plugins/admin): account/session administration is a global capability and must not be treated as tenant membership administration.
- [Better Auth Organization plugin](https://better-auth.com/docs/plugins/organization): organizations have their own member/team role controls, creation restrictions, and hooks. Validate installed-version behavior before selecting a hook.

Prepared using the ECC Intent-Driven Development workflow and repository inspection. No application implementation, live migration, deployment, or external service operation was performed to create this PRD.
