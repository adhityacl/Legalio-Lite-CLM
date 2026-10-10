<div align="center">

# 🏛️ Legalio
### Contract & Insertion Order Management

**A multi-tenant Contract Lifecycle Management (CLM) platform** — contracts, partners, Insertion Orders and Due Diligence, role-based access control, a WYSIWYG contract creator with drafts and redlining, and AI-assisted document workflows.

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520.19-339933?logo=node.js&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](apps/frontend/package.json)
[![Turborepo](https://img.shields.io/badge/Turborepo-2-EF4444?logo=turborepo&logoColor=white)](turbo.json)
[![Express](https://img.shields.io/badge/Express-black?logo=express&logoColor=white)](apps/backend/src/server.ts)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white)](https://github.com/WiseLibs/better-sqlite3)
[![Better Auth](https://img.shields.io/badge/Auth-Better%20Auth-6E56CF)](https://www.better-auth.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](#license)

</div>

---

### 📚 Table of contents

- ✨ [Features](#features)
- 🖥️ [Standalone superuser console](#standalone-superuser-console)
- 🆕 [What's new](#whats-new)
- 🧱 [Tech stack](#tech-stack)
- 📁 [Project layout](#project-layout)
- 🔧 [Workspace and build commands](#workspace-and-build-commands)
- 🚀 [Local development](#local-development)
- ⚙️ [Configuration reference](#configuration-reference)
- 🔗 [Google integration](#google-integration)
- 🧪 [Testing](#testing)
- 🌐 [Deploying to a new server](#deploying-to-a-new-server)
- 🔄 [Moving an existing installation to a new server](#moving-an-existing-installation-to-a-new-server)
- 💾 [Backups and updates](#backups-and-updates)
- 🩺 [Troubleshooting](#troubleshooting)

---

## Features

**📄 Contracts, partners and IOs**

- Full CRUD for contracts, partners, Insertion Orders, spendings and partner evaluations, scoped per organization (tenant) and department.
- Notice-period tracking, expiry/renewal status, notifications and an activity log.
- Bulk CSV import, Due Diligence checklists driven by per-country policy packs, and a dashboard with charts.
- CSV exports open cleanly in Excel (every cell quoted, UTF-8 BOM, `sep=,` for semicolon locales) and can be re-imported as-is.

**✍️ Contract Creator** (sidebar → *Create Contract*)

- **Document explorer**: the page opens on *My Documents*. You can search by name or metadata value, filter by status, type, creator, created date or a metadata field, sort by any column, and page through results 25/50/100 at a time. Each row has quick actions for open, rename, archive and delete.
- **New document**: *New Document* opens a picker with a *Blank document* card and every available template — the built-in *Master Service Agreement* plus any template your organization saved — with a search box.
- **Editor**: a [TipTap](https://tiptap.dev/) editor with fillable-slot fields (listed in the *Fields* panel in the order they appear in the document), partner auto-fill, a template library, a preview and Word (`.doc`) export.
- **Drafts and versions**: documents autosave every 30 seconds. They also save on Ctrl/Cmd+S, when you go back to the explorer, when you navigate elsewhere in the app, and when you close the tab. The header shows *Draft vN · Last saved X ago by Y* and an unsaved-changes marker. The *History* tab lists every version, and you can view, compare (paragraph diff), restore, or name and label any of them.
- **Metadata**: the creator, last modifier and their timestamps are recorded automatically. Organization admins define custom fields (text, select, date, multi-select), which you fill in from the *Info* tab and can search and filter in the explorer.
- **Redlining**: select text, then add a comment or suggest a change. A suggested change shows the original text struck through and the proposed text underlined. You can reply in threads, accept, reject or resolve items one at a time or in bulk, and see a change summary and redline history. *Download with Redlines* exports a `.doc` file with the markup and a comments appendix.

**🛡️ Access control**

- Platform roles (`user`, `superuser`) are separate from organization membership roles (`admin`, `manager`, `editor`, `viewer`). Permissions are enforced server-side for the selected organization and department; see [apps/backend/src/rbac.ts](apps/backend/src/rbac.ts).
- **System Admin** manages global accounts, organizations, sessions, API keys and platform configuration at `/sys`. Its sidebar menu is available only in the standalone console. Organization **Settings** has capability-filtered **Organization**, **Members & Access** and **Integrations** tabs.

- New accounts require manual superuser approval; email verification is not required. Once approved, users without an organization can join with an invite code or create an organization in two steps: **Organization name / Legal entity / Brand name**, then **Country / Industry / Language**.
- Organization admins can generate a single-use invite code valid for **24 hours** in **Settings → Members & Access**. The generated-code dialog includes a copy button inside the code field; the invitation filter is labeled **Pending**.

**🎨 Organization settings and shared UI texts**

- Organization profile (name, legal entity and brand), logo, color theme, country/industry packs and region formatting use shared settings contracts. Tagline is no longer a configurable field in the workspace or console. The System Admin organization directory displays the same default currency saved in organization settings.
- Organization logos use circular avatar styling throughout the sidebar, upload preview and organization cards; the sidebar logo is **44 × 44 px**.
- System Admin can edit, import/export CSV and reset the EN/ID/ZH UI dictionary in **System Admin → UI texts**. Saved overrides apply to all users and organizations; active pages refresh every five seconds and when focused. Language and theme preferences remain personal.
- The dictionary is persisted server-side in SQLite. Existing browser-local overrides are not automatically published; re-save them through the editor to share them. Failed saves show an error and retain the edit for retry.
- The hierarchy tabs are **Tree View**, **Table View** and **Calendar View**.

**🤖 AI and integrations**

- Google Gemini (`@google/genai`) for contract, partner and IO parsing, Due Diligence notes, redline analysis, AI-generated document templates (Contract, Agreement, SO — from a text prompt; Superuser/Admin/Manager only) and a search-grounded news ticker.
- Google credential uploads and organization-specific Drive/Sheets resource mappings. Google synchronization is marked unavailable in this release; saving a mapping does not enable sync. Credentials can be uploaded as JSON files instead of being placed in `apps/backend/.env` (see [Google integration](#google-integration)).
- SMTP e-mail for invitations and notifications, configured in **System Admin → SMTP relay**.
- English, Bahasa Indonesia and Simplified Chinese UI, with the shared text dictionary described above.

---

## Standalone superuser console

Open **http://127.0.0.1:3000/sys?tab=admin-system-dashboard** to manage the platform. Express serves the built console even with `API_ONLY=true` or in production, so stopping the main frontend does not remove console access. The backend must remain running. `npm run dev` and `npm run dev:backend` build the console before startup; `npm run dev:sys` watches its source during development. Production builds and the backend Docker image include `apps/backend/dist/console/`.

- `/app` is the organization workspace; `/sys` is the superuser console. Legacy `/app?tab=admin-system-*` links redirect to `/sys`.
- Both applications reuse the approved login, header, sidebar components and styles. The console uses the app favicon, and its Users and Sessions tables share the same presentation.
- **Manage organization** validates access and opens `/app?tab=settings-organization` in a new tab with the selected organization. The console stays open; organization settings require the main frontend to be available.
- Console sign-in supports password and Google authentication. First-time installations can create the initial superuser; the console does not offer public registration.

See [architecture and operating instructions](docs/architecture/system-console.md) for deployment, routing and access details.

---

## What's new

**Latest updates**

- **Monorepo**: `apps/frontend` and `apps/backend` (including the `/sys` console), reusable `packages/*`, npm workspaces and Turborepo build/type-check caching. Frontend and backend have separate Dockerfiles; the backend image includes the console; GitHub Actions selects verification jobs from changed paths.
- **Tenant boundaries**: platform authority and organization membership are separate; tenant settings and administration use organization-scoped capabilities and shared API contracts.
- **Shared UI dictionary**: System Admin text edits, CSV imports and resets now reach other users without reloading their page, with server persistence and retryable save errors.
- **Organization UI**: synchronized default currency, compact logo upload layout, circular logos, a 44 × 44 px sidebar avatar, and simplified Tree View / Table View labels.
- **Repository hygiene**: AI instruction files, credentials, runtime databases, dumps, caches and generated reports are excluded by `.gitignore`; these files remain local. Ignore rules do not hide files that are already tracked.

**Early October 2026**

- **Independent System Console**: `/sys` remains available with the workspace frontend stopped, reuses the existing UI, and opens organization management in a new tab. System Admin is no longer listed in the `/app` sidebar.
- **Organization onboarding**: manually approved users can join with a 24-hour invite code or create an organization through the two-stage profile and region form. Email verification is not required.
- **Organization profile cleanup**: removed the Tagline setting from workspace profiles, console create/edit dialogs and organization cards.

- **New document picker** (Contract Creator): *New Document* now asks how to start — *Blank document* or a template. Ships a built-in **Master Service Agreement** (`packages/shared/src/data/masterServiceAgreementTemplate.ts`) whose blanks are real fillable slots mapped to the editor's party/date/scope fields (organization = Customer, partner = Supplier), plus custom fields for agreement number, registration numbers, term, survival period and place of signing; governing law and court come from the organization's jurisdiction pack. Templates saved by users appear in the picker automatically.
- **Fields panel**: built-in and custom fields are listed together in document order; the "Optional" badge and the footer "template active" label were removed, and field cards are more compact (touch devices keep 44px targets).
- **Demo dataset**: one organization, *Bank Mindiri* (jurisdiction pack Indonesia, industry pack Banking & Investment), with five fictional partners — cloud/colocation, credit bureau, e-KYC, corporate travel and a media agency — each with its own contract, service order and invoices (amounts incl. 11% VAT). Reload it from *System Admin → Database & reset → Reload the demo data*.
- **Pricing models** standardized to CPM, CPC, CPA, Fixed, Retainer, Hourly, Milestone, Commission and Subscription (`PRICING_MODELS` in `packages/types/src/index.ts`); custom values are still allowed and stay filterable.
- **CSV import/export** (`apps/frontend/src/lib/csv.ts`): one shared exporter for Partner Spending, Partner Evaluation and the Complete Audit View fixes columns splitting on commas (e.g. `Apr 1, 2025`), broken encoding and truncated files, and neutralises formula-looking cells. The importer now reads BOM/`sep=` files, `;`-delimited Excel files and multi-line cells.
- **Bulk import**: templates follow the organization's country and industry (e.g. PT, IDR, NPWP/NIB for Indonesia) and list allowed values; new columns for partner identifiers, contract `auto_renewal`/`status_approval`/`parent_contract_nomor` and spending `invoice_title`/`payment_status`; enum values are validated per row. Fixes: non-USD invoices were imported with a USD amount of 0, evaluations had no organization and no score, and IO/evaluation duplicate checks crossed organizations.
- **UI**: the regulatory news ticker is a continuous marquee (pauses on hover, static under reduced motion); AI chat answers have a *Copy* button; Privacy Policy and Terms of Service were rewritten as numbered legal documents in EN/ID/ZH (`apps/frontend/src/components/legal/`).

**Late September 2026**

- **Persistent, cross-feature OCR/AI cache**: the document-parsing pipeline (`apps/backend/src/lib/cheapOcrPipeline.ts`, used by the Partner/Spending/Contract/IO "Parse with AI" actions) now caches results in SQLite (table `ai_ocr_cache`) instead of an in-memory map, so cached results survive a server restart. A scanned document's plain-text transcript is also cached independently of which feature first read it — for a scanned file, that costs one Gemini vision call for its lifetime instead of one per feature per call; a digital-text PDF's local extraction is cached the same way at no extra cost.
- **Generate Template with AI** (Contract Creator → Templates tab, Superuser/Admin/Manager only): drafts a reusable Contract, Agreement or SO template from a short text prompt via Gemini, inserted into the editor as real fillable-slot fields — reuses the existing "Save Template" flow, so the result is reviewed in the editor before it's persisted to the template library.
- **Contract Creator fullscreen mode**: a toolbar button (between *Download* and the field panel toggle) expands the editor to fill the browser viewport, hiding the app's sidebar and header. `Esc`, the toggle itself, or navigating back to the document list all exit it.
- **Dashboard**: a new *Documents Pending Review* table lists documents awaiting review (name, type, modified by, created and last-modified dates) next to the existing expiring-contracts table, with a shortcut into the Contract Creator.
- **Department-scoped Organization Admin**: Managers, Editors and Viewers opening *Organization Admin → Users* or *→ Departments* now only see themselves and their own department's members/teams, instead of every user and department in the tenant. Enforced server-side in `apps/backend/src/authConsoleRoutes.ts`, not just hidden in the UI. These controls now live in *Settings → Members & Access*.
- **Fix — admin console breadcrumb**: the header no longer falls back to "Main Dashboard" while inside a System Admin or Organization Admin screen; it was checking a stale `admin-users-*` tab prefix that no longer matched the actual `admin-system-*`/`admin-organization-*` routes.
- **Fix — stale locale after switching language**: number and date formatting (e.g. the Structure Audit table) no longer lags one render behind right after switching UI language. The active formatting locale used to be set inside a `useEffect`, one tick after the language actually changed; it's now set synchronously in `TenantSettingsProvider`'s render, ahead of every screen that reads it.
- **RBAC Access Matrix relabeled**: scope badges now read *Global* (Superuser, cross-organization), *Organization* (Admin, every department in one tenant) and *Department* (Manager/Editor, their own department only) — previously Superuser and Admin shared the same ambiguous "Global" badge.
- Console cleanup: removed the unused "Better Auth Infrastructure" banner, its quick-actions block, and the `instances.config.ts` viewer from the admin dashboard and console header; the Users and Sessions tables now share one visual style, and bulk user selection (which had no remaining trigger) was removed along with it.

**September 2026**

- **Contract Creator**: added the document explorer, autosaved drafts with version history, diff and restore, document metadata with organization custom fields, and redlining (comments, suggested changes, accept/reject, redline export). The data is stored in new SQLite tables that are created automatically on start.
- **Google credentials without `apps/backend/.env`**: a Superuser can upload the service account and OAuth client JSON files from the first-login banner (*Connect Google*) or from Settings. Uploaded files take priority over the `GOOGLE_*` variables and apply without a restart.
- **Fix**: `apps/backend/.env` is now loaded before any module reads it. Previously `BETTER_AUTH_SECRET` and the Google OAuth values were read before `apps/backend/.env` was loaded, so development silently used an insecure secret and production crashed at startup even with a correct `apps/backend/.env`.
- **Fix**: the bootstrap Superuser's login now works on any host without editing `apps/backend/.env`. `BETTER_AUTH_URL`/`TRUSTED_ORIGINS` were previously required to match the exact deploy domain or login would fail; they're now optional overrides, since the app trusts whatever host/scheme each request actually arrives on. The bootstrap account's password is also now kept in sync with `DEMO_ADMIN_PASSWORD` on every restart (while `SEED_DEMO_ADMIN` isn't `false`), instead of only on first creation.
- **Fix**: login no longer fails with "Invalid origin" on Cloud Run (or similar managed proxies) that present the container with an internal `Host` different from the public `*.run.app` URL. The origin check now also accepts the real host from `X-Forwarded-Host`, and Express trusts proxy headers (`app.set("trust proxy", true)`) so `req.ip`/`req.protocol` are correct behind one too.
- **Fix**: `npm install` no longer force-rebuilds `better-sqlite3` from source. That `postinstall` step needed a full native build toolchain (Python, a C/C++ compiler); minimal environments without one — e.g. Google Cloud's build images — failed to install at all, even though `better-sqlite3`'s own prebuilt binary already installs correctly on its own. Run `npm rebuild better-sqlite3` by hand only if you see a `NODE_MODULE_VERSION` error after upgrading Node (see Troubleshooting).
- **Security**: demo-workspace logins (`*@example.com`, which share `DEMO_ADMIN_PASSWORD`) are no longer created with `NODE_ENV=production`, are removed on start from production servers that already have them, and are deleted by an empty-workspace reset.
- **Security**: the SQLite browser in System Admin masks uploaded credentials. Its search no longer matches masked columns, which previously allowed their contents to be guessed from the number of results.
- **Plug-and-play install, no default credentials**: nothing in `apps/backend/.env` has to be filled in. The first visit to a new install shows a *Create admin account* page, the Google credentials are uploaded as JSON files, and the Gemini key and SMTP are set in Settings. The old shipped login (`admin@legalio.com` / `123456789`) no longer exists; installs upgraded from it keep working and still get a banner asking to change it.
- **Security**: users without a password are no longer given a shared default one on start (previously every such user, including invited colleagues, got `123456789`), and the first account registered on an empty install is no longer made an admin automatically.
- **Firebase removed**: "Sign in with Google" uses the OAuth Client JSON you upload in *Connect Google*, so there is no Firebase project or `firebase-applet-config.json` to configure. This also fixes a fresh install crashing on load with `auth/invalid-api-key`.
- **Fix**: production builds (`npm run build` / `npm start`) no longer render a blank page. A hand-written vendor chunk split made two bundles import each other, leaving React undefined; Vite's default chunking is used instead and first-load JavaScript is ~20% smaller.

**Earlier**

- Tenant policy packs, i18n and admin settings; hardened session authentication.
- SQLite became the single source of truth (`data_store.json` is only a one-time import source).

---

## Tech stack

| Layer | Technology |
| --- | --- |
| 🎨 Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, Radix UI primitives (`packages/ui-components/src/`), TipTap, Recharts, TanStack Query |
| 🖥️ Backend | Express and TypeScript (`apps/backend/src/server.ts`), serving API endpoints and the built `/sys` console. In development Vite still runs inside Express as middleware for convenience (one server, one port); in production the frontend build is served separately (see [Deploying to a new server](#deploying-to-a-new-server)). |
| 🔐 Auth | Better Auth (sessions, organizations, teams) plus a custom RBAC engine (`apps/backend/src/rbac.ts`) |
| 🧱 Monorepo | npm workspaces (`apps/*`, `packages/*`) and Turborepo 2 for build and type-check tasks |
| 💾 Data | SQLite via `better-sqlite3`, stored in one file: `auth.db` |
| 🔌 Integrations | `@google/genai`, `googleapis`, Google Identity Services (Google Sign-In), `nodemailer`, `docx`, `pdf-lib`, `pdf-parse` |
| 🧪 Tests | Node's built-in test runner (`node:test`) and Playwright |

---

## Project layout

```text
NEW-CLM/
├── .github/workflows/ci.yml
├── apps/
│   ├── backend/                 # Express API + System Console
│   │   ├── src/                  # API/server
│   │   ├── console/              # React + Vite UI served at /sys
│   │   ├── .env.example
│   │   ├── package.json
│   │   └── Dockerfile
│   └── frontend/                # React + Vite
│       ├── src/
│       ├── public/
│       ├── .env.example
│       ├── package.json
│       └── Dockerfile
├── packages/
│   ├── platform-console/        # Shared admin UI, contexts and styles
│   ├── ui-components/           # Reusable UI primitives
│   ├── ts-config/               # Shared TypeScript configuration
│   ├── types/                   # Domain and API contracts
│   └── shared/                  # Shared policy, currency, lifecycle and templates
├── tests/
├── scripts/
├── tools/
├── docs/
├── compose.yaml
├── turbo.json
├── package.json                 # npm workspaces and root commands
└── package-lock.json
```

Backend environment lives in `apps/backend/.env`; frontend public variables belong in `apps/frontend/.env`. Environment and runtime files are **not** tracked by Git. SQLite/uploads retain their repository-root locations by default: `auth.db` (plus `auth.db-wal` and `auth.db-shm`), `uploads/`, and the legacy `data_store.json`. Set absolute `AUTH_DB_PATH` and `APP_DATA_DIR` values to use a dedicated data directory.

---

## Workspace and build commands

Install dependencies once at the repository root. The root lockfile covers both apps and all shared packages.

| Command | Behavior |
| --- | --- |
| `npm run build` | `turbo run build`; builds the app dependency graph and caches each app's `dist/**` output. |
| `npm run lint` | `turbo run lint --concurrency=1`, followed by a root TypeScript check. |
| `npm run build:sys` | Builds the standalone superuser console in `apps/backend/dist/console/`. |
| `npm run dev:sys` | Watches and rebuilds the console served by the backend at `/sys`. |
| `npm run test:system-console` | Checks standalone hosting and legacy route redirects. |
| `npm run test:e2e:sys` | Tests the console against an isolated API-only backend without the workspace frontend. |
| `npm run build:frontend` | Builds only `apps/frontend/dist/` directly through its workspace script. |
| `npm run build:backend` | Builds `apps/backend/dist/server.cjs` and `apps/backend/dist/console/` together. |
| `npm run dev` | Combined Express + Vite development server on port 3000. |
| `npm test` | Root `node:test` suites through `tsx`; run separately from Turbo. |

Turbo reuses local cached results when inputs are unchanged. Shared TypeScript configuration is a global cache dependency, and `VITE_*` variables participate in the build cache key. `dev` is configured as persistent with caching disabled, but the root development commands currently invoke workspace scripts directly. To run an app through Turbo, use `npx turbo run build --filter=@legalio/frontend` or `--filter=@legalio/backend`.

CI uses [scripts/affected-apps.mjs](scripts/affected-apps.mjs) to select applications by changed paths, then uses Turbo filters for each selected app. Shared contracts/configuration trigger both apps; `packages/platform-console/` and `packages/ui-components/` trigger both apps. Documentation-only changes skip application verification. CI currently verifies code and builds; deployment is configured separately.

---

## Local development

Requirements: **Node.js 20.19 or newer** (22 LTS recommended; see `.nvmrc`) and npm. Older Node versions crash at startup because the PDF parser needs `process.getBuiltinModule`.

```bash
git clone <repository-url>
cd NEW-CLM
npm install
npm run dev
```

`npm install` creates `apps/backend/.env` from `apps/backend/.env.example` and generates a random `BETTER_AUTH_SECRET` automatically (via its `postinstall` script), so there's no `apps/backend/.env` to hand-edit for local development. Re-run it any time with `npm run setup` — it never touches `apps/backend/.env` once `BETTER_AUTH_SECRET` has a real value, so it's safe on an `apps/backend/.env` carried over from another server (see [Moving an existing installation to a new server](#moving-an-existing-installation-to-a-new-server)).

Open **http://localhost:3000**. On the very first visit you'll see *Create admin account*: enter your name, email and a password (8+ characters) and you're signed in as the Superuser. There are no default credentials.

On first start the server creates `auth.db` with all tables and loads the Bank Mindiri demo workspace (Indonesia, Banking & Investment). Until the Google credential files are uploaded, a banner offers **Connect Google**. The Gemini key (AI features) and SMTP are set in **System Admin → AI Model & Parser** and **SMTP relay**; backend environment variables are optional fallbacks for those integrations.

### Running frontend and backend as separate processes

`npm run dev` runs both together in one process (Vite mounted as Express middleware) and is the default for day-to-day work. To run them separately — closer to how production is deployed, see [Deploying to a new server](#deploying-to-a-new-server) — use two terminals instead:

```bash
npm run dev:backend    # Backend plus built /sys console, on :3000
npm run dev:frontend   # Vite dev server, proxies /api, /uploads and /sys to :3000
```

Open the URL `dev:frontend` prints (not `:3000`). No code changes needed either way: components call `fetch('/api/...')` the same way in both modes.

---

## Configuration reference

Backend variables are read from `apps/backend/.env`; frontend public variables belong in `apps/frontend/.env`. Never put secrets in `VITE_*` variables.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | — | Set to `production` on API servers. Enables secure cookies and requires `BETTER_AUTH_SECRET`; nginx serves the frontend separately. |
| `PORT` | `3000` | HTTP port. |
| `AUTH_DB_PATH` | Repository-root `auth.db` | Absolute path to the SQLite database. |
| `APP_DATA_DIR` | Repository root | Absolute directory containing `uploads/` and the legacy `data_store.json` import source. |
| `BETTER_AUTH_SECRET` | auto-generated | **Required in production.** `npm install`/`npm run setup` fills in a random value if it's still unset or the `apps/backend/.env.example` placeholder. Changing it signs everyone out. |
| `BETTER_AUTH_URL` | — | Optional: pins the app to one exact public URL, e.g. `https://clm.example.com`. Left unset, the app trusts whatever host/scheme each request actually arrives on (nginx's documented config forwards the real `Host` and `X-Forwarded-Proto`), so login works out of the box on localhost, a Codespace, or any deployed domain — nothing to update when the domain changes or the app moves to a new server. |
| `TRUSTED_ORIGINS` | — | Optional: additional trusted origins, comma separated — only needed for a genuinely separate origin, such as a standalone front-end domain. |
| `DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD` | — | Optional, for automated deploys: pre-creates the first Superuser instead of using the *Create admin account* page. Outside production the six demo-workspace users (`*@example.com`) get the same password. |
| `SEED_DEMO_ADMIN` | `true` | Only matters when `DEMO_ADMIN_*` are set: `false` stops re-applying them on start once your own admin exists. |
| `GEMINI_API_KEY` | — | Optional fallback; normally set in System Admin → AI Model & Parser. |
| `GOOGLE_*` | — | Optional fallback; normally the JSON files are uploaded in *Connect Google*. |
| `ALLOW_GOOGLE_SELF_SIGNUP` | `false` | When `true`, any Google account can sign in and gets a user created automatically. Otherwise an administrator must invite the user first. |
| `BETTER_AUTH_ENABLE_INFRA` / `BETTER_AUTH_API_KEY` | — | Optional Better Auth Infra dashboard and Sentinel. |

---

## Google integration

Two JSON files from [Google Cloud Console](https://console.cloud.google.com/) configure Google access and sign-in:

1. **Service account key**: IAM & Admin → Service Accounts → *account* → Keys → Add key → JSON. After uploading, share the Drive folder and the spreadsheet with the account's `client_email` as **Editor**.
2. **OAuth client**: APIs & Services → Credentials → OAuth 2.0 Client IDs → Download JSON. Its **Authorized JavaScript origins** must contain the exact URL the app runs on, including `http` vs `https` and the port (e.g. `https://clm.example.com`). The upload dialog warns you when it doesn't.

A Superuser uploads the files from **Connect Google** in the first-login banner, or from **System Admin → Google & storage → Manage credential files**. Organization resource mappings are managed separately in **Settings → Integrations**; Google synchronization is currently unavailable.

- Files are validated when uploaded: a file in the wrong slot or an unreadable private key is rejected.
- They are stored in `auth.db` (table `integration_credentials`) and take effect immediately.
- They take priority over `apps/backend/.env`. Removing an upload falls back to `apps/backend/.env`.
- Secret values are never sent back to the browser.

"Sign in with Google" on the login page uses the same uploaded OAuth client, so it works as soon as that file is uploaded and the domain is in its **Authorized JavaScript origins**. Google accounts must be invited first unless `ALLOW_GOOGLE_SELF_SIGNUP=true`.

---

## Testing

```bash
npm run lint              # workspace and root TypeScript checks
npm test                  # root tests/*.test.ts suites
npm run test:frontend     # frontend CI selection
npm run test:backend      # backend CI selection
npm run test:rbac         # RBAC permission matrix
npm run test:documents    # Contract Creator API: drafts, explorer, metadata, comments (in-memory SQLite)
npm run test:credentials  # Google credential upload and priority over apps/backend/.env
npm run test:tenant-boundaries  # isolated API, migration, profile and settings checks
npx playwright install chromium  # one-time browser installation
npm run test:system-console # console hosting and legacy redirects
npm run test:e2e:sys      # console browser tests with an API-only backend
npm run test:e2e          # isolated live browser suite, including shared UI texts
npm run test:e2e:fixtures  # mocked-API UI regressions
npm run test:e2e:tenant-boundaries  # live browser suite plus workspace runtime checksums
```

GitHub Actions selects frontend/backend jobs from changed paths. Shared contracts/configuration trigger both; shared UI-package changes trigger both apps. Each job checks its dependency graph, runs the relevant tests and builds only its application; see [.github/workflows/ci.yml](.github/workflows/ci.yml). Browser tests remain available through the commands above.

Live tenant-boundaries tests use temporary databases/storage and synthetic fixtures instead of the workspace database. `test:tenant-boundaries` and `test:e2e:tenant-boundaries` also compare workspace runtime checksums before and after running. Mocked-API browser tests serve the frontend without opening the application database.

The settings API contract lives in [packages/types/src/organizationSettings.ts](packages/types/src/organizationSettings.ts) and is used by both the backend store and the frontend settings page. `npm run lint` checks this contract, including the negative type assertion in `tests/organizationSettingsContract.test.ts`. The shared UI dictionary contract lives in [packages/types/src/uiTexts.ts](packages/types/src/uiTexts.ts); validation/persistence and cross-browser editing, CSV import and reset are covered by the tenant-boundaries API and live browser suites.

For containers, run `npm run setup` followed by `docker compose up --build`; frontend is available at `http://localhost:8080`. Backend data uses a named Docker volume. Existing host data is not automatically imported into that volume. Each Dockerfile builds its own application from the repository-root context.

---

## Deploying to a new server

The guide below assumes a Linux server (Ubuntu or Debian), a domain pointing at it, systemd, and nginx for HTTPS. The frontend is a static build (`apps/frontend/dist/`) served directly by nginx; the backend is a Node API process (`apps/backend/dist/server.cjs`) that nginx reverse-proxies `/api/` and `/uploads/` to. They can live on the same server (as below) or be deployed and scaled independently.

### 1. Install the prerequisites

```bash
# Node.js 22 (e.g. via nvm or NodeSource), then:
node -v   # must be v20.19+ (v22 recommended)
sudo apt install -y git nginx build-essential python3   # build tools compile better-sqlite3 if no prebuilt binary matches
sudo useradd --system --create-home --home-dir /opt/legalio legalio
```

### 2. Get the code and build it

```bash
sudo -u legalio git clone <repository-url> /opt/legalio/app
cd /opt/legalio/app
sudo -u legalio npm ci
sudo -u legalio npm run build   # apps/frontend/dist/ (static files) + apps/backend/dist/server.cjs (API)
```

`npm run build:frontend` and `npm run build:backend` also run independently, in either order, without deleting each other's output. Vite preview uses `apps/frontend/dist/` automatically. When upgrading an existing installation, update the systemd `ExecStart` and nginx static root to the paths below, then reload nginx and restart the service.

### 3. Create `apps/backend/.env`

There is nothing to fill in: `npm ci` already created `apps/backend/.env` with a random `BETTER_AUTH_SECRET` (its `postinstall` script). Just restrict its permissions:

```bash
sudo -u legalio chmod 600 apps/backend/.env
```

`NODE_ENV=production` comes from the service file in step 4, the admin account is created in the browser in step 6, and the Google credentials are uploaded there too.

### 4. Run it as a service

Create `/etc/systemd/system/legalio.service`:

```ini
[Unit]
Description=Legalio CLM
After=network.target

[Service]
User=legalio
WorkingDirectory=/opt/legalio/app/apps/backend
ExecStart=/usr/bin/env node dist/server.cjs
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

`WorkingDirectory` points to `apps/backend` so dotenv reads the backend environment. SQLite and uploads retain their repository-root defaults; set absolute `AUTH_DB_PATH` and `APP_DATA_DIR` for a dedicated data directory.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now legalio
journalctl -u legalio -f        # wait for "Pengelola Kontrak & IO Server running on http://0.0.0.0:3000"
```

### 5. Put nginx and HTTPS in front

`/etc/nginx/sites-available/legalio`:

```nginx
server {
    server_name clm.example.com;
    client_max_body_size 30m;   # document uploads are limited to 30 MB by the app

    location = /sys {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /sys/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Defense in depth: never serve backend bundles or their source maps.
    location ~* \.cjs(\.map)?$ {
        deny all;
    }

    # Everything else is the frontend's static build — nginx serves it
    # directly, the Node process is never involved.
    location / {
        root /opt/legalio/app/apps/frontend/dist;
        try_files $uri /index.html;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/legalio /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d clm.example.com
```

Keep port 3000 closed to the internet; only nginx should reach it.

### 6. First-run checklist (in the browser)

1. Open `https://clm.example.com` and fill in **Create admin account** (it only appears while no admin exists — do this right after the site goes live).
2. **Remove the demo data**: System Admin → Database & reset → *Reset System Database* → *Start empty with my organization*. The reset signs you out; sign in again. (The demo login accounts are never created in production, and an empty-workspace reset also deletes them.)
3. **Connect Google** (banner or System Admin → Google & storage): upload the two JSON files (see [Google integration](#google-integration)), and add `https://clm.example.com` to the OAuth client's **Authorized JavaScript origins**.
4. Optional: set the Gemini key and SMTP in **System Admin → AI Model & Parser** and **SMTP relay**, then manage an organization and invite users from **Settings → Members & Access**.

---

## Moving an existing installation to a new server

All application data lives in `auth.db`, including users, organizations, contracts, Contract Creator documents and uploaded Google credentials. Attachments live in `uploads/`.

1. Prepare the new server with steps 1–2 above.
2. On the **old** server, stop the app and take a consistent copy of the database:
   ```bash
   sudo systemctl stop legalio
   cd /opt/legalio/app
   node -e "require('better-sqlite3')('auth.db').backup('auth-migrate.db').then(() => console.log('ok'))"
   tar czf legalio-data.tgz auth-migrate.db uploads apps/backend/.env
   ```
3. Copy `legalio-data.tgz` to the new server and unpack it into `/opt/legalio/app`. Rename `auth-migrate.db` to `auth.db`, then run `chown -R legalio: .` and `chmod 600 apps/backend/.env`.
4. If the old `apps/backend/.env` pinned `BETTER_AUTH_URL`/`TRUSTED_ORIGINS` to the old domain, remove or update them (unset, the app just follows the new host). Keep the same `BETTER_AUTH_SECRET` so existing sessions stay valid; a new secret only signs everyone out. Users and credentials come with `auth.db`, so no setup page appears.
5. Continue with steps 4–5 above (service and nginx). New tables and columns are created automatically on start.
6. If the domain changed, add it to the Google OAuth client's **Authorized JavaScript origins**.

---

## Backups and updates

Superusers can open **System Admin → Backup & Restore** at `/sys?tab=admin-system-backups`.

- **Back up now** creates an online SQLite snapshot plus local `uploads/`, pauses new application requests and waits for existing requests to finish. History shows creation time, archive size, status and safety backups.
- **Download** streams a `.tar.gz` archive containing `auth.db`, `uploads/` and a SHA-256 manifest. Local backups are stored under `APP_DATA_DIR/backups/` (repository-root `backups/` by default); they are not publicly served or encrypted. Keep a downloaded copy securely off the server. Remote Google Drive files are not downloaded into these backups.
- **Restore** selects an existing successful local backup, requires typing `RESTORE`, checks checksums, SQLite integrity and matching schema, then creates a safety backup. It replaces the whole platform database and uploaded files, including all organizations. Restoration runs before the database opens on the next backend start; all sessions are invalidated.
- The backend stops after accepting restore. Docker's restart policy or a service supervisor must restart it. If running manually (including a development watcher), start it again. For systemd, use `Restart=always` if automatic restart after restore is required. Sign in using an account from the restored backup.
- This implementation requires one backend process with exclusive ownership of its SQLite database and uploads, and the standard `tar` command (included in the backend image). Scheduling, automatic retention, external archive import and remote storage are not included. Failed staged restores prevent startup until corrected; the pending marker and safety backup remain available for recovery.

The commands below remain available for manual backup:

**Backup** (safe while the app is running, because it uses SQLite's online backup):

```bash
cd /opt/legalio/app
mkdir -p backups
node -e "require('better-sqlite3')('auth.db').backup('backups/auth-' + new Date().toISOString().slice(0,10) + '.db').then(() => console.log('ok'))"
tar czf backups/uploads-$(date +%F).tgz uploads
```

Do not copy `auth.db` with `cp` while the server runs: recent writes may still be in `auth.db-wal`. Store backups off the server. They contain password hashes and the uploaded Google keys.

**Update to a new version:**

```bash
cd /opt/legalio/app
sudo -u legalio git pull
sudo -u legalio npm ci
sudo -u legalio npm run build
sudo systemctl restart legalio
```

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `BETTER_AUTH_SECRET must be set in production` at startup | `apps/backend/.env` is missing, empty, or not in `WorkingDirectory`. Run `npm run setup` from the repository root (it won't touch a real secret if one is already set), or set a long random value by hand. |
| `Cannot find module 'vite'` when running `npm run dev` / `dev:backend` | Dependencies were installed with `--omit=dev` on a dev machine. Run `npm ci` without it. Production (`node apps/backend/dist/server.cjs`) never needs `vite`, so this doesn't affect a deployed server. |
| Blank page or 404 at the site root in production | The Node process no longer serves the frontend build — nginx must serve `apps/frontend/dist/` directly and proxy `/api/`, `/uploads/` and `/sys` to Node. Check the `location` blocks in step 5 of [Deploying to a new server](#deploying-to-a-new-server). |
| 404 at `http://localhost:3000` during development | `npm run dev:backend` serves the API and `/sys`, but not the workspace root. Use `npm run dev` for the combined app, or also run `npm run dev:frontend` and open the Vite URL it prints. |
| Other users still see old customized UI text | Save the edit in System Admin → UI texts and check for a save error. Active pages refresh every five seconds/on focus; browser-local overrides from older versions must be re-saved to publish them. |
| `better-sqlite3` / `NODE_MODULE_VERSION` error | Node was upgraded after installing. Run `npm rebuild better-sqlite3`. |
| Crash mentioning `process.getBuiltinModule` | Node is older than 20.19. Upgrade to Node 22. |
| Repeated `DECODER routines::unsupported` in the log | The service account private key in `apps/backend/.env` is malformed. Upload the service account JSON in the app, or fix/clear `GOOGLE_PRIVATE_KEY`. |
| Google popup fails with `origin_mismatch` / `redirect_uri_mismatch` | The app URL is not in the OAuth client's Authorized JavaScript origins. Add it, then download and upload the JSON again. |
| Users are signed out after a restart | `BETTER_AUTH_SECRET` changed. Keep it stable across deployments. |
| Upload fails with 413 | Raise `client_max_body_size` in nginx (the app accepts up to 30 MB). |

---

## License

MIT
