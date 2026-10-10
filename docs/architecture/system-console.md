# System Console in the Backend Workspace

The superuser console is a React UI at `/sys`, included in the backend workspace at `apps/backend/console`. Its Vite build remains separate from the Node server build. Express serves its static build on the backend port even with `API_ONLY=true` or `NODE_ENV=production`. No workspace frontend process, Vite middleware, or frontend nginx container is required to open it.

```mermaid
flowchart LR
  Browser -->|/sys and /sys/assets| Backend
  Backend --> Console[apps/backend/dist/console]
  Browser -->|/api/me and admin APIs| Backend
  Workspace[Main frontend /app] -->|API| Backend
  Backend --> Database
```

## Source and runtime boundaries

- `apps/backend/console`: console entry, login/setup screen, shell and its own Vite build with `/sys/` asset paths.
- `packages/platform-console`: existing admin views, approved frontend header/sidebar, shared identity/navigation/permission contexts, translations and styles. Existing frontend module paths re-export this package to preserve callers. Both applications use the same implementations.
- `apps/frontend`: organization workspace and onboarding; platform navigation transfers to `/sys`.
- `apps/backend/src/systemConsoleHosting.ts`: serves only the console directory. Missing resources return 404; a missing console build returns 503 with the required build command. It never exposes backend source or mutable data.
- `packages/shared/src/systemConsole.ts`: exact canonical system tab IDs shared by both applications and legacy-link handling.

The console entry does not import the workspace App, document editor or operational views. Platform permissions come from `/api/me`; console access does not require an active organization or membership. Catalog forms load `/api/policy-packs` independently of organization policy.

Backend and frontend are the only deployable npm app workspaces. Console dependencies belong to the backend package; Node and browser TypeScript configurations remain separate. Shared UI changes invalidate both app builds in Turbo and CI. No API, authentication or database changes are required.

## Commands

```sh
npm ci
npm run dev:backend
```

This builds the console, then starts the backend alone on port 3000. Open `http://127.0.0.1:3000/sys?tab=admin-system-dashboard`.

`npm run dev` builds the console and starts the combined development backend/workspace. To continuously rebuild console changes while either backend mode runs, use `npm run dev:sys` in another terminal; it watches builds and does not start another HTTP server. Refresh `/sys` after a rebuild.

Production/manual deployment:

```sh
npm run build:backend
NODE_ENV=production npm start
```

Copy `apps/backend/dist` into the release: it contains `server.cjs` and the static `console/` directory. The backend Dockerfile builds and carries both, without building the main frontend. An optional absolute `SYSTEM_CONSOLE_DIR` selects another console build location.

Docker Compose exposes the backend on host loopback `127.0.0.1:3000`, so stopping its frontend container does not remove direct console access. The main frontend nginx and Vite proxy `/sys` to the backend, so links work from the workspace's origin too. Direct access to backend `/sys` remains available when that frontend service is stopped.

## Routing and authentication

The console reuses the workspace header, collapsible sidebar and grouped System Admin navigation. Its branding-only `TenantProvider` mode loads platform presentation branding without fetching organizations, selecting one or loading tenant capabilities. The existing admin content stays unchanged.

- `/sys` defaults to `admin-system-dashboard`; exact supported `?tab=admin-system-*` IDs support refresh, bookmarks and browser history. Unsupported console tab IDs return to its dashboard.
- Canonical legacy `/app?tab=admin-system-*` requests redirect to `/sys`. Client navigation also transfers to `/sys`; existing workspace alias resolution remains in place.
- The console reuses existing password and Google authentication, session handling and `/api/me`. Its login does not offer self-registration; a fresh installation supports the existing atomic first-superuser setup endpoint.
- Ordinary users are denied before admin views mount. Existing server permissions independently protect every admin API.
- New accounts still require manual superuser approval. Email verification is not required.
- `Manage organization` validates access, saves the identity-bound selection in a new tab, then opens `/app?tab=settings-organization`. Organization operations require the main frontend to be available.

## SQLite backup and restore

`/sys?tab=admin-system-backups` reuses the console's cards, tables, buttons and confirmation modal. Platform database permissions protect listing/download and backup creation; restore requires `platform.application.reset`. All endpoints additionally resolve the actual superuser identity, and cookie mutations use the existing same-origin checks.

`SQLiteBackups` drains active API/upload requests and pauses new requests during backup. SQLite's online backup captures the database; the uploads directory and checksum manifest are packaged using `tar`. Backup and restore operations are serialized in this single-backend deployment. Backups are private directories under `APP_DATA_DIR/backups`, outside the uploads static route.

Restore validates a successful local backup and matching schema, creates a safety backup, persists a pending marker and stops the server. `lib/auth.ts` applies the pending restore before opening SQLite, removes old WAL sidecars and clears sessions. The marker is removed only after both database and uploads have been installed; a failed/interrupted restore fails closed and is retried at startup. Docker/systemd must restart the backend, or the operator must start it manually. The safety backup and original snapshots remain outside the restored directories.

Archives are not encrypted; download and store them securely off-server. This first version has no scheduler, retention or external archive import. Remote Drive documents are outside the local uploads snapshot.

## Verification and limits

`npm run test:system-console` checks hosting, missing resources, build availability and legacy redirects. `npm run test:e2e:sys` builds the real console and tests it against an isolated API-only backend, without starting any workspace frontend server. All fixtures use a temporary database.

Browser coverage includes real login/logout, account denial, first-superuser setup, manual approval, all system tabs, history, language/theme, mobile navigation and organization handoff. Existing build isolation tests cover the frontend, server and nested console outputs and shared package cache invalidation.

The console remains dependent on the backend and database. Stopping the backend also stops `/sys`. API contracts and the database schema remain shared; no database migration is introduced by this separation. Rollback requires restoring the matching code and build artifacts, with no data rollback.
