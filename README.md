# 📦 Legalio CLM

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520.19-339933?logo=node.js&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](apps/frontend/package.json)
[![Turborepo](https://img.shields.io/badge/Turborepo-2-EF4444?logo=turborepo&logoColor=white)](turbo.json)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white)](https://github.com/WiseLibs/better-sqlite3)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](#-feedback-and-contributing)

![Legalio dashboard](assets/screenshots/dashboard.png)


## 🌟 Highlights

- **One workspace for partners, contracts and spending**: partners with due diligence, evaluations and invoices; contracts and service orders with notice periods, renewal and termination tracking.
- **Contract editor**: start from a blank page or a template, fill fields from a side panel, and keep autosaved versions with compare, restore and redlining.
- **Document calendar**: contract starts, cancellation notices, ends, renewals and terminations on a yearly calendar.
- **Workspace search**: search a vendor name to find related contracts, service orders/IOs, spending invoices and partner evaluations within your access. Select a result to open its details or the matching spending list.
- **Multi-tenant with role-based access**: organizations, departments and roles (admin, manager, editor, viewer), enforced on the server.
- **AI assistance**: Google Gemini reads contracts, partner documents and invoices, drafts due diligence notes and generates templates.
- **Standalone system console** (`/sys`) for superusers: accounts, organizations, Google credentials, AI model, SMTP, UI texts, database browser, backup and restore.
- **English, Bahasa Indonesia and Simplified Chinese** out of the box.


## ℹ️ Overview

Legalio is a contract lifecycle management (CLM) application for legal, procurement and finance teams who track many partners at once. It keeps every partner, contract, service order, invoice and evaluation in one place. It reminds you before notice periods run out and gives each organization its own workspace, branding and access rules.

The app runs as a single Node.js server with an SQLite database file, so it can be self-hosted on one machine without extra infrastructure. The interface is built with React 19 and a design system based on [Moduix](https://moduix.dev) (Ark UI) components, sized on a golden-ratio scale.


### ✍️ Authors

Built and maintained by [adhityacl](https://github.com/adhityacl).


## 🚀 Usage

Start the app and open **http://localhost:3000**:

```bash
npm run dev
```

On the first visit, confirm the website's public URL and create the superuser
account. The URL starts with the address you opened; include `http://` or
`https://` and the public port if needed. Setup saves it in the installation
database and applies it to authentication immediately, without a restart. If you
enter a different URL, setup sends you there to sign in. A demo workspace
(*Bank Mindiri*, with five partners and their contracts) is loaded so you can
explore right away.

| Sign in | Contracts |
| --- | --- |
| ![Sign-in page](assets/screenshots/login.png) | ![Contract list](assets/screenshots/contracts.png) |

| Contract editor | New partner form |
| --- | --- |
| ![Contract editor with the Fields panel](assets/screenshots/editor.png) | ![New partner form](assets/screenshots/partner-form.png) |

| Document calendar |
| --- |
| ![Yearly document calendar](assets/screenshots/calendar.png) |

The system console for superusers is at **http://localhost:3000/sys**.


## ⬇️ Installation

Requirements: **Node.js 20.19 or newer** (22 LTS recommended) and npm. It runs on Linux, macOS and Windows (WSL).

```bash
git clone https://github.com/adhityacl/NEW-CLM.git
cd NEW-CLM
npm install
npm run dev
```

`npm install` also creates `apps/backend/.env` with a random `BETTER_AUTH_SECRET`, so no configuration is needed to start. The Gemini key, SMTP and Google credentials are set later from the system console.

For production, the quickest route is Docker. The workspace is served on **http://localhost:8080**, and data lives in a named volume:

```bash
npm run setup
docker compose up --build
```

First-run onboarding stores the website URL in the database, including for
Docker installations. `BETTER_AUTH_URL` is an optional deployment override and
takes priority over the onboarding value. Existing installations without a
stored URL continue to detect the request's origin.

To set the override manually, pin authentication to the URL users open by adding
`BETTER_AUTH_URL` to `apps/backend/.env`. Use the exact URL users open, including
the scheme and public port if applicable. From the repository root, ensure the
environment file exists and open it in a text editor:

```bash
npm run setup
nano apps/backend/.env
```

Find `# BETTER_AUTH_URL=`, remove the leading `#`, and fill in the URL. If an
active `BETTER_AUTH_URL=` line already exists, edit that line instead of adding
a duplicate. If neither line exists, add one. Replace `<YOUR_PUBLIC_URL>` below
with your installation's actual public URL; do not keep the angle brackets:

```dotenv
BETTER_AUTH_URL=<YOUR_PUBLIC_URL>
```

Leave the other settings, including `BETTER_AUTH_SECRET`, unchanged. In nano,
save with **Ctrl+O**, press **Enter**, then exit with **Ctrl+X**. You can use
another text editor if nano is not installed.

After changing `.env`, recreate the backend container so it receives the updated
environment (a container restart alone does not reload `env_file`):

```bash
docker compose up -d --force-recreate backend
```

If login reports `Invalid origin` when using a public port, ensure nginx forwards
`Host $http_host`, which includes that port. The bundled nginx template does this
for `/api`, `/uploads`, and `/sys`. Rebuild the frontend image to apply template
changes with `docker compose up -d --build frontend`. When using your own nginx
configuration, preserve the public host and port there too.

Without Docker, run `npm run build`, then start the API with `NODE_ENV=production npm start`. Serve `apps/frontend/dist` from a web server such as nginx, and proxy `/api`, `/uploads` and `/sys` to port 3000.


## 💭 Feedback and Contributing

Found a bug or have an idea? Open an [issue](https://github.com/adhityacl/NEW-CLM/issues) or start a conversation in [Discussions](https://github.com/adhityacl/NEW-CLM/discussions).

Contributions are welcome: fork the repository, create a branch, and open a pull request against `main`. Please keep changes focused and describe what you tested.

Legalio is released under the MIT license.
