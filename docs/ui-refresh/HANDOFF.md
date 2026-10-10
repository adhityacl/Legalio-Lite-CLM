# Handoff — UI refresh (shadcn standard) + live QC

**Repo:** `adhityacl/NEW-CLM`
**Branch:** `feat/shadcn-ui-refresh` → **PR #2** https://github.com/adhityacl/NEW-CLM/pull/2
**Base:** `main` @ `6be4b64`
**QC target:** https://automatic-umbrella-pw96gr5vjgp36j49-3000.app.github.dev/ (serves `main`)

> ⚠️ **Two different codebases.** The QC describes the deployed preview (`main`, `6be4b64`).
> The UI changes live on the branch. The branch **was built and rendered locally** (§3) but is
> **not deployed** — the Codespaces dev server serves its own working tree, so the live preview
> does not show these changes.

---

## 1. What changed (branch `feat/shadcn-ui-refresh`)

| Area | Change |
|---|---|
| Token layer | New `src/styles/shadcn-tokens.css` — shadcn token contract, light + dark (`--background`, `--foreground`, `--card`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--sidebar-*`, `--chart-*`). Brand accent **#06C755** → `--primary`. Only `--radius` is added, plus a **non-colliding** `--shadcn-radius-*` scale, so Tailwind’s global `--radius-sm/-md/-lg/-xl` namespace is never overridden. |
| Loading | `src/main.tsx` imports the token layer after `index.css` (additive; `index.css` untouched). |
| Primitives | Added `input`, `label`, `alert`, `tabs`, `table`, `select`, `skeleton` (token-driven). |
| Button | `ui/button.tsx` migrated from hard-coded hex/slate/rose to tokens; variant/size API unchanged. |
| CLI config | `components.json` uses the **React** shadcn schema (`ui.shadcn.com`) — this is a React + Vite app, so the *shadcn-svelte design standard* is applied, not the Svelte runtime. |
| Sign-in | `SignInForm.tsx` refactored onto `Button/Input/Label/Alert` + tokens; behaviour unchanged. |
| Cleanup | `docs/ui-refresh/REMOVAL-INVENTORY.md`. |

## 2. Run locally

```bash
git fetch origin && git checkout feat/shadcn-ui-refresh
npm install
cp .env.example .env      # GEMINI_API_KEY, BETTER_AUTH_SECRET, BETTER_AUTH_URL, GOOGLE_*
npm run dev               # http://localhost:3000
npm run lint              # tsc --noEmit
npm run build
```

## 3. Verification status (honest)

> How the build was verified without a git token: the GitHub connector exposes a local MCP endpoint
> (`127.0.0.1:19681/github/mcp`); a script mirrored all 147 text files of the branch, then the build
> was run locally. Commands: `npm install --ignore-scripts` → `npx tsc --noEmit` → `npx vite build`
> → serve `dist/` → headless-Chrome screenshot.

| Item | Status |
|---|---|
| Source consistency (single token source; no one-off colors in touched files) | ✅ done |
| **Build / `tsc`** | ✅ **VERIFIED** — repo mirrored via the GitHub MCP endpoint, then `npx tsc --noEmit` → **exit 0** and `npx vite build` → **exit 0** (20.4 s; `dist/index.html` + `assets/index-*.css` 154 kB + `assets/index-*.js` 2.15 MB). |
| **Visual render of the branch** | ✅ **DONE** — built `dist/` served locally and screenshotted (`after-login-desktop.png` light, `after-login-desktop-dark.png`, `after-login-mobile.png`). Computed styles confirm the tokens are applied (light bg `#f7f8fa`, input `#cbd5e1`, primary `#06C755`; dark bg `#0b0f19`, input `#374151`); **0 page errors**. |
| Live QC with the provided account | ✅ done (login, navigation, create→persist→retrieve→delete, 4xx capture) |
| Backend / API / DB | ✅ untouched |

## 4. Revert

Revert PR #2 / `git checkout main` — additive; no DB migration, no data change.

## 5. Independent review — outcomes

| Item | Verdict | Action |
|---|---|---|
| D1 | Real 401 defect; count/timing **over-claimed** | Corrected (8/12, not 9; timing unproven) |
| D2 | Confirmed | kept |
| D3 | **Half-confirmed** | 2 of 4 items log-confirmed; the rest explicitly sourced to the side-panel snapshot |
| D4 / D7 | No JSON-log evidence | Now explicitly sourced to the side-panel capture |
| P2 | “11 distinct screens” over-claimed | Corrected to **10 of 11** |
| Branch | `--radius-*` clash; svelte-schema `components.json`; hard-coded `Button` | **All three fixed** |

## 6. Recommended follow-ups (priority)

1. **D1 (High)** — fix `401` on `/api/tenants`, `/api/branding`, `/api/user/my-role` (server-side).
2. Deploy the branch (or run `npm run dev`) and capture the full set of after-screenshots per screen.
3. Remove the `index.css` “Focus Mode” positional `display:none` selectors (removal **B1**).
4. Complete the EN dictionary; pick one default locale (**D2**).
5. Migrate `Sidebar`, `Header`, Contracts/IO/Partners tables to the primitives.
6. **Security:** stop committing `credentials.json`, `cookies.txt`, `auth.db*`, `data_store.json` — git-ignore and rotate.

## 7. Deliverables map

| File | Purpose |
|---|---|
| `UI-Refresh-Prototype.html` | Design reference — tokens, component gallery, before/after (light/dark) |
| `QC-Report-LMS.html` / `.md` | QC report + defect table + evidence |
| `Laporan-QC-LMS.docx` | QC report (Word) |
| `HANDOFF-UI-REFRESH.md` | Handoff document |
| `assets/*.png` | Before (live preview) + after (branch build) screenshots |
