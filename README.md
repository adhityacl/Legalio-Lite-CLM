<div align="center">

# Legalio

**Multi-tenant contract lifecycle management (CLM)** for partners, contracts, service orders and spending, with a document editor, redlining, role-based access control and AI-assisted parsing.

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520.19-339933?logo=node.js&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](apps/frontend/package.json)
[![Turborepo](https://img.shields.io/badge/Turborepo-2-EF4444?logo=turborepo&logoColor=white)](turbo.json)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white)](https://github.com/WiseLibs/better-sqlite3)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](#license)

</div>

---

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Project layout](#project-layout)
- [Getting started](#getting-started)
- [Commands](#commands)
- [Design system](#design-system)
- [Configuration](#configuration)
- [Google integration](#google-integration)
- [Deployment](#deployment)
- [Backups and updates](#backups-and-updates)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Features

### Workspace (`/app`)

- **Dashboard**: workspace overview with a live sky background (day, sunset and night), KPI cards, and tables for expiring documents, latest documents and documents pending review.
- **Partners**: partner list with due diligence, partner evaluation (scored criteria and a recommendation) and partner spending (invoices split across spending months, with USD conversion).
- **Contracts and service orders**: full CRUD scoped per organization and department, notice periods, renewal and termination tracking, and amendments.
- **Document structure**: tree view, table view (Complete Audit View with CSV export) and a yearly document calendar that shows contract start, cancellation notice, end, renewal and termination dates.
- **Contract creator (My Documents)**:
  - Document explorer with search, filters, sorting and paging.
  - New documents start blank or from a template. The built-in Master Service Agreement and any saved organization template are available.
  - A TipTap editor with fillable fields, a parties panel with partner auto-fill, a template library, AI-generated templates, preview and Word (`.doc`) export.
  - Autosaved drafts with version history, compare and restore.
  - Document metadata with organization-defined fields.
  - Redlining: comments and suggested changes, accept or reject, and export with redlines.
- **Bulk import** of partners, contracts, service orders, spending and evaluations from CSV templates that follow the organization's country and industry.
- **Notifications** and an activity log.
- **Settings**:
  - **Organization**: profile, logo, colour theme, country and industry packs.
  - **Members & Access**: members, invitations, departments and history.
  - Tabs are shown according to the user's capabilities.
- **Languages**: English, Bahasa Indonesia and Simplified Chinese.

### System console (`/sys`)

A standalone superuser console for accounts, sessions, organizations, API keys, Google credentials, AI model and parser, SMTP relay, shared UI texts, the database browser, and backup and restore. Express serves the built console even when the workspace frontend is stopped.

### Access control

- **Roles**:
  - Platform roles: `user` and `superuser`.
  - Organization membership roles: `admin`, `manager`, `editor` and `viewer`.
- **Enforcement**: permissions are enforced on the server for the selected organization and department; see [apps/backend/src/rbac.ts](apps/backend/src/rbac.ts).
- **Account approval**: new accounts need manual superuser approval. Approved users join an organization with a 24-hour invite code, or create one.

### AI and integrations

- **Google Gemini** (`@google/genai`): parses contracts, partners, service orders and invoices, drafts due diligence notes, runs redline analysis and generates templates. OCR results are cached in SQLite.
- **Google sign-in, Drive and Sheets**: configured from uploaded service account and OAuth client JSON files.
- **SMTP**: sends invitations and notifications.

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, TipTap, Recharts, TanStack Query |
| UI components | [Moduix](https://moduix.dev) components on Ark UI, copied into `packages/ui-components` (no runtime dependency on the upstream package) |
| Backend | Express and TypeScript (`apps/backend/src/server.ts`), which also serves the built `/sys` console |
| Auth | Better Auth (sessions, organizations, teams) plus a custom RBAC engine |
| Data | SQLite through `better-sqlite3`, in a single `auth.db` file |
| Integrations | `@google/genai`, `googleapis`, Google Identity Services, `nodemailer`, `docx`, `pdf-lib`, `pdf-parse` |
| Monorepo | npm workspaces and Turborepo 2 |

---

## Project layout

```text
NEW-CLM/
├── apps/
│   ├── backend/             # Express API, plus the /sys console in console/
│   └── frontend/            # Organization workspace (React + Vite)
├── packages/
│   ├── ui-components/       # Design system: Moduix components, blocks and theme tokens
│   ├── platform-console/    # Shared app shell, contexts, i18n and admin UI
│   ├── shared/              # Policy, currency, lifecycle, templates and demo data
│   ├── types/               # Domain and API contracts
│   └── ts-config/           # Shared TypeScript configuration
├── scripts/                 # setup-env (runs on npm install) and clean-build
└── compose.yaml  turbo.json  package.json
```

Backend environment variables live in `apps/backend/.env`, and frontend public variables in `apps/frontend/.env`. Neither file is committed. Runtime data (`auth.db`, `uploads/`, `backups/`) stays at the repository root unless `AUTH_DB_PATH` and `APP_DATA_DIR` point elsewhere.

---

## Getting started

Requirements: **Node.js 20.19 or newer** (22 LTS recommended, see `.nvmrc`) and npm.

```bash
git clone https://github.com/adhityacl/NEW-CLM.git
cd NEW-CLM
npm install      # also creates apps/backend/.env with a random BETTER_AUTH_SECRET
npm run dev      # builds /sys, then serves API + Vite on http://localhost:3000
```

- **Workspace**: http://localhost:3000. On the first visit, create the superuser account. There are no default credentials.
- **System console**: http://localhost:3000/sys
- **Demo data**: the *Bank Mindiri* demo workspace is loaded on first start. It can be reloaded or cleared in **System Console → Database & reset**.

To run the frontend and backend as separate processes:

```bash
npm run dev:backend    # API and /sys on :3000
npm run dev:frontend   # Vite dev server; proxies /api, /uploads and /sys to :3000
```

After changing anything under `packages/` that the console uses, rebuild it with `npm run build:sys`.

---

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Combined Express + Vite development server on port 3000 |
| `npm run dev:sys` | Rebuild the `/sys` console on change |
| `npm run build` | Turborepo build of both apps (`apps/*/dist`) |
| `npm run build:frontend` / `build:backend` / `build:sys` | Build one app or the console |
| `npm start` | Run the built backend |
| `npm run lint` | Workspace type checks plus a root TypeScript check |
| `npm run setup` | Recreate `apps/backend/.env` without touching an existing secret |
| `npm run clean` | Remove build output |

---

## Design system

All UI follows one standard: the golden-ratio design system in `packages/ui-components`.

- **Components**: import them from `@legalio/ui-components/<component>`, for example `import { Button } from '@legalio/ui-components/button'`. Do not import third-party UI libraries in application code.
- **Golden ratio sizes**: every size comes from the golden ratio scale.
  - Spacing tokens: `g2 g3 g5 g8 g13 g16 g21 g26 g34 g42 g55 g68 g89 g110 g144 g233 g377 g610 g987 g1597`.
  - Control heights: `xs` 21, `sm` 26, `md` 34 (default), `lg` 42 and `xl` 55 px, set through the `size` prop.
  - Type scale: 13, 16, 21, 26, 34 and 42 px. 13 px is the minimum.
- **Colours**: only semantic tokens (`text-foreground`, `bg-card`, `border-border`, `text-status-*`, …). Raw hex values and palette classes are not allowed.
- **Dialogs**: forms use the 720 px `form` width and are built from numbered `FormSection` cards.

---

## Configuration

Backend variables are read from `apps/backend/.env`. Never put secrets in `VITE_*` variables.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | — | `production` enables secure cookies and requires `BETTER_AUTH_SECRET` |
| `PORT` | `3000` | HTTP port |
| `AUTH_DB_PATH` | `./auth.db` | Absolute path to the SQLite database |
| `APP_DATA_DIR` | repository root | Directory for `uploads/` and `backups/` |
| `BETTER_AUTH_SECRET` | generated | Required in production. Changing it signs everyone out |
| `BETTER_AUTH_URL` / `TRUSTED_ORIGINS` | — | Optional. Pin the public URL or add extra trusted origins. When unset, each request's host is trusted |
| `DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD` | — | Optional. Pre-create the first superuser for automated deploys |
| `SEED_DEMO_ADMIN` | `true` | Set to `false` to stop re-applying the `DEMO_ADMIN_*` values on start |
| `GEMINI_API_KEY` | — | Fallback. Normally set in **System Console → AI Model & Parser** |
| `GOOGLE_*` | — | Fallback. Normally the JSON files are uploaded in the console |
| `ALLOW_GOOGLE_SELF_SIGNUP` | `false` | When `true`, any Google account can sign in without an invitation |

---

## Google integration

Two JSON files from [Google Cloud Console](https://console.cloud.google.com/) configure Google access:

1. **Service account key**: IAM & Admin → Service Accounts → Keys → Add key → JSON. Share the Drive folder and spreadsheet with the account's `client_email` as **Editor**.
2. **OAuth client**: APIs & Services → Credentials → OAuth 2.0 Client IDs → Download JSON. Its **Authorized JavaScript origins** must contain the exact app URL, including scheme and port.

Upload both files from the **Connect Google** banner or **System Console → Google & storage**. The files are validated and stored in `auth.db` (`integration_credentials`). They apply immediately and take priority over `.env` values. Secrets are never sent back to the browser. Google accounts must be invited unless `ALLOW_GOOGLE_SELF_SIGNUP=true`.

---

## Deployment

The frontend is a static build (`apps/frontend/dist/`) served by nginx. The backend is a Node process (`apps/backend/dist/server.cjs`) behind nginx for `/api/`, `/uploads/` and `/sys`.

### Docker

```bash
npm run setup
docker compose up --build    # frontend on http://localhost:8080, data in a named volume
```

### Linux server (systemd + nginx)

```bash
sudo apt install -y git nginx build-essential python3
sudo useradd --system --create-home --home-dir /opt/legalio legalio
sudo -u legalio git clone https://github.com/adhityacl/NEW-CLM.git /opt/legalio/app
cd /opt/legalio/app
sudo -u legalio npm ci
sudo -u legalio npm run build
sudo -u legalio chmod 600 apps/backend/.env
```

`/etc/systemd/system/legalio.service`:

```ini
[Unit]
Description=Legalio CLM
After=network.target

[Service]
User=legalio
WorkingDirectory=/opt/legalio/app/apps/backend
ExecStart=/usr/bin/env node dist/server.cjs
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

nginx site (add HTTPS with `certbot --nginx`):

```nginx
server {
    server_name clm.example.com;
    client_max_body_size 30m;

    location ~ ^/(api|uploads|sys)(/|$) {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ~* \.cjs(\.map)?$ { deny all; }

    location / {
        root /opt/legalio/app/apps/frontend/dist;
        try_files $uri /index.html;
    }
}
```

Keep port 3000 closed to the internet. After the first deploy:

1. Create the admin account in the browser.
2. Clear the demo data in **System Console → Database & reset**.
3. Upload the Google files.
4. Set the Gemini key and SMTP.

**Moving to a new server**: copy `auth.db` with SQLite's online backup, `uploads/` and `apps/backend/.env`. Keep the same `BETTER_AUTH_SECRET`. New tables and columns are created automatically on start.

---

## Backups and updates

**System Console → Backup & Restore** (`/sys?tab=admin-system-backups`) creates consistent snapshots of `auth.db` and `uploads/` with a SHA-256 manifest.

- **Download**: backups can be downloaded as `.tar.gz`. Keep a copy off the server, because backups contain password hashes and uploaded keys.
- **Restore**: requires typing `RESTORE`. It replaces the whole platform and then stops the backend, so run it under a supervisor that restarts it (`Restart=always`).

Manual backup while the app is running:

```bash
node -e "require('better-sqlite3')('auth.db').backup('backups/auth-' + new Date().toISOString().slice(0,10) + '.db').then(() => console.log('ok'))"
tar czf backups/uploads-$(date +%F).tgz uploads
```

Update to a new version:

```bash
git pull && npm ci && npm run build && sudo systemctl restart legalio
```

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `BETTER_AUTH_SECRET must be set in production` | Run `npm run setup`, or check that `WorkingDirectory` is `apps/backend` |
| Blank page or 404 at the site root in production | nginx must serve `apps/frontend/dist/` and proxy `/api`, `/uploads` and `/sys` to Node |
| `/sys` shows an old UI after a shared-component change | Run `npm run build:sys`, then hard-refresh the browser |
| `NODE_MODULE_VERSION` error from `better-sqlite3` | Node was upgraded after installing. Run `npm rebuild better-sqlite3` |
| Crash mentioning `process.getBuiltinModule` | Node is older than 20.19. Upgrade to Node 22 |
| Google `origin_mismatch` | Add the app URL to the OAuth client's Authorized JavaScript origins and re-upload the JSON |
| Everyone is signed out after a restart | `BETTER_AUTH_SECRET` changed. Keep it stable |
| Upload fails with 413 | Raise `client_max_body_size` in nginx (the app accepts up to 30 MB) |

---

## License

MIT
