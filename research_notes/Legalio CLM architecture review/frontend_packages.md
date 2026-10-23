# Legalio CLM Frontend Architecture Review (apps/frontend, packages/ui-components, platform-console, shared, types)

Scope: branch `PostgreSQL`, current checkout. All "sources" are local files (paths relative to /home/user/Legalio-Lite-CLM). Measurements made by me: `vite build` and `tsc --noEmit` run on apps/frontend; key-count script over the i18n catalogs; grep counts over apps/frontend/src, packages/{platform-console,ui-components,shared}/src.

## 1. App structure: routing, state, data fetching, API layer, type sharing

### Takeaway
A single-page React 19 + Vite 6 + Tailwind 4 app with a hand-rolled, query-string "router" (`/app?tab=...`), React Context for cross-cutting state and TanStack Query used for only a thin slice of data (one bulk `/api/init-data` load plus documents and approvals). Most CRUD still lives as hand-written optimistic-update handlers in a 1,112-line `App.tsx`. Shared types are a single workspace package consumed by both frontend and backend, which is a strength; runtime validation is absent.

### Cited Findings
- Monorepo: npm workspaces `apps/*`, `packages/*`; Turbo with `build`, `lint`, `dev` tasks only; packages are source-exported (no build step): `"./*": "./src/*.tsx"` etc. — `package.json`, `turbo.json`, `packages/ui-components/package.json`
- Size (TS/TSX files): apps/frontend 167, ui-components 269, platform-console 64, shared 25, types 8 — `find` count
- Entry: `apps/frontend/src/main.tsx` wraps `<App/>` in StrictMode + one top-level `ErrorBoundary`; calls `installApiFetchInterceptor()` which monkey-patches `window.fetch` to add `Authorization: Bearer <localStorage auth_session_token>` and `x-organization-id` for same-origin `/api/*`/`/uploads/*`, stripping the org header for ~18 regex-listed identity/platform routes — `apps/frontend/src/main.tsx`, `packages/platform-console/src/lib/apiFetch.ts`
- Routing: no react-router. `NavigationContext` keeps `activeTab` from `?tab=` on `/app`, with history push/replace, `selectedItem: any`, and one-shot `intent`. `App.tsx` renders views with a long chain of `activeTab === '...' &&` conditions (lines ~708-901). A route "gate" (pending/no-org/caps-error/denied/allow/redirect) runs before lazy views mount and respects module toggles (`commercialDocuments`, `spending`, `evaluation`) — `packages/platform-console/src/context/NavigationContext.tsx`, `apps/frontend/src/App.tsx` L110-165, `apps/frontend/src/lib/appRoutes.ts`
- Code splitting: 13 route views and 4 modals are `React.lazy` in App.tsx (20 `lazy(` uses in frontend src) — `apps/frontend/src/App.tsx` L19-36
- Context providers (8): Auth, Language, Tenant, TenantSettings, Theme, Navigation, AlertToast, ConfirmDialog. They live in `packages/platform-console/src/context/*`; `apps/frontend/src/context/*.tsx` are one-line `export *` shims — e.g. `apps/frontend/src/context/AuthContext.tsx`
- Data fetching: `useWorkspaceData` is a `useQuery` on `/api/init-data` returning ALL contracts, IOs, partners, notifications, evaluations, spendings in one payload (`staleTime: 10_000`), with org-switch safety (queryKey includes identity+tenant, rejects stale-org response) — `apps/frontend/src/features/workspace/useWorkspaceData.ts`
- Mutations: not `useMutation`. `App.tsx` hand-writes optimistic `updateData()` + raw `fetch` + rollback + `loadAllData()` refetch for contracts, IOs, partners, amendments, bulk delete (`handleSaveContract`, `handleDeleteContract`, `handleSaveIO`, …) — `apps/frontend/src/App.tsx` L196-330+
- `useQuery`/`useMutation` appear in only 6 files (approvals x3, `useDocumentList`, Sidebar, LanguageContext); raw `fetch(` appears 107 times across 44 files (hot spots: PlatformConfigurationPanel 12, googleAuthService 10, App.tsx 9, TenantSettingsContext 5, TenantContext 5, PartnerSpendingView 5, ContractDocumentEditor 4) — grep counts
- API client layer is fragmented: identical private `request<T>()` helpers duplicated in `features/approvals/approvalsApi.ts` and `lib/documentsApi.ts` (same JSON headers, same error mapping); `components/settings/orgApi.ts`; everything else calls `fetch` inline. `ContractRedliningPanel` calls `fetch` directly with its own headers — `approvalsApi.ts`, `documentsApi.ts`, `ContractRedliningPanel.tsx` L40
- Client still sends identity fields (`userEmail`, `userName`, `userRole`) in bodies and DELETE query strings (10 occurrences in App.tsx), although `apiFetch.ts` comments say identity assertions are never sent (PRD §5.1). Server must ignore them; the client should drop them — `apps/frontend/src/App.tsx` L215-245
- Type sharing: `@legalio/types` (8 files, `index.ts` ~403 lines, 29 exported types/interfaces + `approvals`, `documents`, `lifecycle`, `policy`, `organizationSettings`, `uiTexts`, `domainStatus`) is imported by 5 backend files and frontend; `@legalio/shared` is imported by 11 backend files. No zod/valibot/yup anywhere, so types are compile-time only and `fetch` results are cast (`body as T`) — `packages/types/src/*`, grep of apps/backend/src, package.json files
- `@legalio/shared` holds business logic and data: policy packs (`industryPacks.ts` 2,274 lines; `countryPacks.ts`), contract templates (3 agreement templates, `cooperationAgreementTemplate.ts` 1,208 lines), demo dataset, bulk CSV parse, spending allocations, page layout, mail templates, Google credential file parsing, system-console constants. Mixed isomorphic and server-ish content (e.g. `googleCredentialFiles.ts`, `mailTemplates.ts`) in a package imported by the browser — `packages/shared/src/*`
- `apps/frontend/src/App.tsx` hook-order bug: `MainApp` does `if (!user) return null;` and THEN calls `usePermissions()`, `useTenant()`, `useNavigation()`, `useState`, etc. (rules-of-hooks violation; works only because `user` never flips null→non-null on the same mounted instance) — `apps/frontend/src/App.tsx` L96-110
- Dev proxy for `/sys`, `/api`, `/uploads`; nginx template proxies the same paths and falls back to `index.html` — `apps/frontend/vite.config.ts`, `apps/frontend/nginx.conf.template`
- Security-adjacent: session token stored in `localStorage` (`auth_session_token`) and sent as Bearer; also `credentials: 'include'` — `packages/platform-console/src/lib/apiFetch.ts`. Google Identity script loaded from `accounts.google.com` in `index.html`.

### Inferences
- The `init-data` full-payload model will not scale past a few thousand records per tenant (all lists are shipped, searched and sorted client-side; `buildWorkspaceSearchResults` runs over everything in a `useMemo`). Server-side pagination/search is the likely next scaling wall.
- Because mutation logic is concentrated in App.tsx (props drilled to views), App.tsx is a coupling hot spot; moving to per-entity `useMutation` hooks with `invalidateQueries` would remove most of the 1,112 lines and the manual rollback closures.
- Query-string tab routing is simple and bookmarkable, but forces a growing `&&` ladder and an `any`-typed `selectedItem`; there are no deep links to a record (e.g. `/contracts/:id`).

### Gaps
- Did not run the app or inspect backend route contracts to verify the server ignores client-sent `userEmail/userRole`.
- Did not inventory every `fetch` call for error handling consistency.

## 2. Component library (ui-components, Moduix/Ark UI), duplication, size, dead code

### Takeaway
`@legalio/ui-components` is a large in-tree, copy-owned design system (~18.8k lines) built on Ark UI with CVA + tailwind-merge, exposed through a thin two-layer facade (`src/<name>.tsx` re-exporting `src/moduix/ui/<name>/*`). It is well-organized, but about a third of the facade modules have no consumers, and its README points to docs that do not exist. Duplication between `apps/frontend/src/components` and `platform-console` is mostly one-line re-export shims, not copied code.

### Cited Findings
- Structure: 108 top-level facade files (`accordion.tsx` … `typeset.tsx`, `utils.ts`) over `src/moduix/ui/<component>/{Component.tsx,index.ts}`, plus `moduix/lib` (cn, icons, overlay portal), `styles/{theme.css,foundation.css}`. 269 TS/TSX files; ~87 files import `@ark-ui/react`. Deps: `@ark-ui/react ^5.39.3`, `@unpic/react`, `class-variance-authority`, `clsx`, `tailwind-merge ^3.6`, `lucide-react`. — `packages/ui-components/package.json`, `ls packages/ui-components/src`
- Largest ui-components files: DatePicker 771, CommandPalette 669, Sidebar 664, ColorPicker 605, Menu 502, Select 438, Lightbox 415, Combobox 401, Drawer 386, TreeView 382, FloatingPanel 379 lines — `wc -l packages/ui-components/src/moduix/ui/*`
- README says "Accessible by Default… `@ark-ui/react`, `@radix-ui`" and links `docs/design-system/README.md`; the `docs/` directory does not exist in the repo, and no `@radix-ui` component package is used (only `@radix-ui/colors` in frontend/platform-console) — `packages/ui-components/README.md`, `ls docs` (missing)
- Usage (distinct files outside ui-components importing `@legalio/ui-components/<name>`): most-used button 77, text 55, card 52, tooltip 42, heading 38, alert 36, badge 32, field 30, input 29, dialog 24, table 21. Zero external importers for 34 facade modules: angle-slider, aspect-ratio, bleed, carousel, color-picker, container, date-input, floating-panel, highlight, hover-card, image-cropper, json-tree-view, kbd, lightbox, listbox, navigation-menu, pin-input, progress-circular, progress-linear, qr-code, rating-group, scroll-area, select, signature-pad, simple-grid, slider, split-button, splitter, stack, steps, swap, timer, tour, tree-view — grep over apps/ and packages/ (excludes imports via relative paths inside the library itself, so some may be used internally, e.g. select/listbox by combobox; treat as "candidates")
- Dead-code/size implication: the library is source-exported and tree-shaken by Vite, so unused modules do not hit the bundle; cost is maintenance and typecheck time, not runtime.
- Duplication vs apps/frontend: `apps/frontend/src/{context,lib,i18n,hooks}/*` and `components/{Header,Sidebar,SignInForm,ErrorBoundary,…,admin/*,account/*}` are one-line `export * from '@legalio/platform-console/...'` shims (e.g. `components/Header.tsx`, `context/LanguageContext.tsx`, `lib/permissions.ts`, `i18n/zh.ts`). Real duplication risk is in parallel trees: `apps/frontend/src/lib/{apiFetch,appRoutes,auth-client,googleAuthService,notificationText,organizationColors,organizationSelection,permissions,rbacScoping,unsavedChanges,userPreferences}.ts` vs same names in platform-console (mostly shims); `apps/frontend/src/components/ui/*` has small wrappers (several are 1-line shims) — diff of `ls` and `head` of files
- App-level components that arguably belong in a shared layer but live in apps/frontend: `components/DateInput.tsx`/`MonthInput.tsx` (while ui-components also ships `date-input` and `date-picker`; the library `date-input` has zero external importers, so the app has its own 95 kB `DateInput` chunk) — build output `DateInput-*.js` 97,991 B; import counts above
- Largest app components: `features/documents/ContractDocumentEditor.tsx` 2,516 lines (31 `useState`, 18 `useEffect`, 3 `useRef`, 0 `useCallback`/`useMemo`), `PartnerEvaluationView` 1,360, `PartnerSpendingView` 1,296, `App.tsx` 1,112, `PartnersView` 942, `ContractsView` 905, `ContractEditorToolbar` 843, `HierarchyTreemapView` 799, `ContractModal` 791, `IOView` 732, `IOModal` 718, `BulkImportView` 595. In platform-console: `LanguageContext.tsx` 2,773, `AdminModals.tsx` 1,967, `PlatformConfigurationPanel.tsx` 1,804 — `wc -l`
- Frontend duplicates entity UIs: `ContractModal`/`IOModal`/`PartnerModal` plus `ContractCreatorView` (comment in App.tsx says forms "are pages now" yet modals remain mounted with `showContractModal` state) — `apps/frontend/src/App.tsx` L176-183
- Component memoization: `React.memo` 0 uses; `useMemo` 43, `useCallback` 29 across all frontend+platform+ui src.

### Inferences
- The facade-over-moduix two-layer indirection doubles file count (every component is 3 files: facade, component, index). Collapsing to one layer or generating the facade would cut ~200 files.
- Pruning the 34 apparently-unused modules (after verifying internal use) would shrink the library by an estimated 25-35% of lines; Moduix appears to be a vendored snapshot of a full catalog.
- The legacy "modal AND page" pairs (ContractModal vs ContractCreatorView, IOModal, PartnerModal) are likely partly dead; confirm which `show*Modal` setters are still reachable.

### Gaps
- Did not verify internal (relative-path) usage inside ui-components, so the "unused" list is an upper bound.
- No storybook/visual test or component docs located; design-system docs referenced by README are missing.

## 3. Feature surface and gaps vs typical CLM

### Takeaway
Breadth is good: contract documents editor (Tiptap) with draft versions, comments/suggestions, DOCX export; partners with due diligence and evaluation; spending allocations; service orders (IO); hierarchy/treemap; calendar; notifications; bulk import; AI chat; approvals; multi-tenant admin; 3 languages. Missing or thin vs CLM norms: e-signature, obligation/milestone tracking, rich reporting/export, integration surface beyond Google and email.

### Cited Findings
- Tab routes in App.tsx: dashboard, hierarchy (treemap), contracts, create-contract, document-approval, ios/io, partners, partner-evaluation, partner-spending, notifikasi, bulk-import, settings-* tabs, privacy, terms, admin-system-* (redirect to `/sys` for platform admins) — `apps/frontend/src/App.tsx` L708-901, `apps/frontend/src/lib/appRoutes.ts`
- Contracts editor: `ContractDocumentEditor.tsx` (2,516 lines) with Tiptap 3 (`starter-kit`, table, highlight, image, color, text-align, sub/superscript, `tiptap-pagination-plus`), custom extensions (comment mark, fillable slot, pricing table, table cell background, page format), header/footer layer, ruler, table selection overlay, DOCX import/export (`docx` lib), print — `apps/frontend/package.json`, `apps/frontend/src/lib/tiptap*.ts`, `components/editor/*`, `lib/{docxGenerator,editorDocx,printDocument}.ts`
- Versions: `DraftHistoryPanel` lists saved versions (kinds `auto|manual|restore`), view, compare, restore, label; compare uses `diffParagraphs` — an O(n·m) paragraph-level LCS (author comment: switch to Myers for thousands of blocks); paragraph-level only, not word-level — `components/documents/DraftHistoryPanel.tsx`, `lib/paragraphDiff.ts`, `packages/types/src/documents.ts`
- "Redlining": two meanings. (a) AI risk review: `ContractRedliningPanel` POSTs the form to an AI endpoint, shows risk level, clause severities, original vs recommended text (132 lines) — not tracked changes. (b) Comment type `suggestion` with statuses `open|resolved|accepted|rejected` and actions accept/reject/resolve/reopen, rendered via `renderRedlineHtml` in the editor — `ContractRedliningPanel.tsx`, `packages/types/src/documents.ts` L17-20, `ContractDocumentEditor.tsx` L69. No real-time collaboration/presence found (no Yjs/websocket grep hits in deps).
- Partners: `PartnersView` 942 lines, `PartnerModal`, `PartnerJurisdictionFields`, `UploadDDModal` (due diligence upload), `DueDiligenceChecklistEditor`, `PartnerEvaluationView` (1,360 lines), `evaluationSnapshot` — `apps/frontend/src/components/*`
- Spending/invoices: `PartnerSpendingView` 1,296 lines, `spendingChecks.ts`, `spendingAllocations.ts`, `currencyRates.ts`, `currencyUtils.ts`; module toggled by tenant policy `modules.spending`. No invoice-document model (invoice upload/OCR/match) found in types — `PartnerSpendingView.tsx`, `packages/shared/src/*`, `App.tsx` L150-152
- Calendar: `features/calendar/*` (~430 lines total: month/year views, event filter, legend, `calendarModel`) — `WorkspaceDocumentCalendar.tsx`, `DocumentCalendar.tsx`. Only 2 call sites reference it (HierarchyTreemapView, workspace).
- Search: `buildWorkspaceSearchResults` (client-side over init-data) feeding a command palette/search in Header/Sidebar; has a unit test — `packages/platform-console/src/lib/workspaceSearch.ts` and `.test.ts`
- Bulk import: `BulkImportView` (595 lines) with CSV parsing in `@legalio/shared/bulkParse` (unit tested) and `lib/csv.ts`; admin permission `tenant.data.import` — `App.tsx` L881
- AI chat: `AIChatLauncher` + `AIChatWidget` (300 lines, react-markdown, session persisted in `sessionStorage` key `silegal_ai_chat_session_v1`; welcome message is hard-coded Indonesian default with `t()` override). Widget chunk is 127 kB raw (35 kB br) — `components/AIChatWidget.tsx`, build output
- Approvals: dedicated feature `features/approvals/*` (inbox, detail, form, API; categories, approvers, decision approve/reject with comment, file attach as base64 in JSON) — `approvalsApi.ts` (base64 upload in JSON body is a size/memory concern)
- Notifications: `NotificationsView` (542 lines) is a log of server-generated notification records with filter/sort/pagination; no in-app bell/real-time push, no websocket/SSE found — `NotificationsView.tsx`, `lib/notificationText.ts`
- Admin: platform console (`/sys`) in platform-console: Dashboard, Organizations, Users, Sessions, API keys, Platform configuration panel (1,804 lines), admin modals (1,967 lines); in-app Settings: Organization, Members & Access, Activity logs, UI Text Manager (edit translations, import/export CSV) — `packages/platform-console/src/components/admin/*`, `apps/frontend/src/components/settings/*`, `ActivityLogsView.tsx`
- Not found in frontend or shared types (grep for e-sign/obligation/milestone): e-signature flows (only `signature-pad` UI component with zero consumers), obligation/milestone tracker, renewal workflow beyond "ending" fields (`features/contracts/ContractEnding*`), clause library/playbooks (AI review only), report builder, scheduled reports, webhooks/integrations UI beyond Google Drive/Sheets, SMTP, AI — grep of `apps/frontend/src packages/types/src`
- Policy packs (industry/country) drive terminology (`applyTerminology` rewrites "Insertion Order" → tenant-specific doc term at runtime via regex on translated strings) — `packages/platform-console/src/context/LanguageContext.tsx` L28-60

### Inferences
- Gap vs typical CLM (Ironclad/Icertis-style): e-signature (High), obligation tracking with reminders (High), reporting/export + saved views (Med), real tracked-change redlining and clause library (Med), integrations (CRM/ERP/Slack/webhooks; Med), in-app notifications with push (Med). Approvals and AI review give a base to build on.
- The "AI Redlining" label may mislead users expecting tracked changes; naming/UX should differentiate.

### Gaps
- Did not inspect backend endpoints to confirm whether e-sign or obligation features exist server-side without UI.
- Spending/invoice workflows were read only at structure level, not line by line.

## 4. Performance

### Takeaway
Route-level lazy loading is in place, but the main entry chunk is large (1.87 MB raw, 560 kB gzip, 419 kB brotli) — mostly because three i18n catalogs (~700 kB of source) and the auth/query/UI stack are bundled eagerly. The editor chunk is 1.06 MB raw (266 kB br) and the dashboard 413 kB. Lists use client-side pagination, no virtualization, no memoization of rows.

### Cited Findings
- Measured `vite build` (apps/frontend): `index-*.js` 1,917,370 B (gzip 560 kB, brotli 419 kB); `ContractDocumentEditor` 1,089,954 B (gzip 315 kB, br 266 kB); `DashboardView` 423,477 B (gzip 123 kB, br 103 kB — recharts); `index-*.css` 343,305 B (gzip 47 kB, br 37 kB); `AIChatWidget` 127 kB (br 35 kB); `DateInput` 98 kB (br 22 kB); `HierarchyTreemapView` 88 kB; `SettingsView` 78 kB; 78 JS files in `dist/assets` — local build output
- `chunkSizeWarningLimit: 800` raises Vite's default 500 kB warning, masking the 1.9 MB entry; `manualChunks` deliberately removed after a circular `scheduler` chunk caused a blank page — `apps/frontend/vite.config.ts` comment
- Static pre-compression: both gzip and brotli via `vite-plugin-compression`; nginx template contains no `gzip_static`/`brotli_static`/cache-control directives, so pre-compressed files may not be served and hashed assets lack long-cache headers — `apps/frontend/nginx.conf.template`
- i18n source size (bytes): `extraTranslations.ts` 233,836; `zh.ts` 169,551; `LanguageContext.tsx` 148,145 (holds inline ID/EN base dictionary of ~2,400 lines); `tenantBoundaries.ts` 57,488; `uiRefinements.ts` 40,070; plus `approvals.ts`, `mailer.ts`, etc. All imported statically at top of `LanguageContext.tsx` (loaded for every language, including ZH for ID/EN users) — `packages/platform-console/src/context/LanguageContext.tsx` L1-12, `wc -c`
- Fonts: Google Fonts CSS (Plus Jakarta Sans 400-800) loaded render-blocking from `fonts.googleapis.com`; Google GSI script `async defer` on every page — `apps/frontend/index.html`
- Lists: client-side `TablePagination` + `useRowsPerPage` preference; zero virtualization libs; `React.memo` 0 uses; row components inline in views — `components/ui/TablePagination.tsx`, `lib/tablePreferences.ts`, grep
- Re-render risk: `ContractDocumentEditor` has 31 `useState` in one component and 0 `useCallback`/`useMemo`; App.tsx holds modal state, data and all handlers at root, passed as props (handlers re-created each render, no memo) — grep counts, `App.tsx`
- Data fetching: `staleTime: 10_000` on init-data; `useDocumentList` `staleTime: 0` with placeholderData guarded by user/tenant; `loadAllData()` invalidates the full init-data payload after every mutation (refetching all six collections) — `useWorkspaceData.ts`, `useDocumentList.ts`
- Dev server uses polling file watch (300 ms) unless `DISABLE_HMR=true` — `vite.config.ts` (dev only)

### Inferences
- Lazy-loading the non-active language catalogs and moving the ZH/extras dictionaries to dynamic `import()` could cut the entry chunk by an estimated several hundred kB raw; verify with `rollup-plugin-visualizer` (not present).
- Whole-payload refetch after each mutation plus in-memory sorting will degrade as record counts grow; first fix is granular cache updates/invalidation, then server-side pagination.
- Editor chunk size is acceptable only because it is lazy; consider splitting `docx`, `tiptap-pagination-plus` and DOCX import/export behind user actions.

### Gaps
- No runtime profiling (React DevTools/Lighthouse); the entry chunk composition was not analyzed with a bundle visualizer, so the i18n share is an inference from source sizes.

## 5. Accessibility, i18n completeness, error/loading states, tests

### Takeaway
Accessibility foundations are decent (Ark UI primitives, 1,048 `aria-` attributes, 176 `role=` uses, a11y-aware loading/state screens, dark theme tokens), but gaps remain: no skip link, only 8 `alt=` attributes, a single top-level error boundary, and no automated a11y tests. i18n is data-complete for ID/EN (3,589 keys each) with ZH 33 keys short, but the runtime design (Indonesian fallback text inline in `t()` calls, regex term rewriting) is fragile. Frontend tests cover pure logic only (14 test files, no component/E2E tests for the UI).

### Cited Findings
- A11y positives: `StateScreen`/`LoadingState` use `role="status"`, `aria-busy`, decorative elements `aria-hidden`; `<html lang>` updated per language (`id`/`en`/`zh-CN`); focus-visible and reduced-motion handling present in `theme.css` and `platform-console/src/index.css` — `App.tsx` L40-85, `LanguageContext.tsx` L2628, grep
- A11y gaps: grep for "skip to content"/skip-link: none found; only 8 `alt=` across ~500 TS/TSX source files (icons mostly lucide, but images like logos/lightbox/uploads should be checked); `aria-live` regions found only in a few files; `index.html` static `lang="id"` and `<title>LMS - Legal Management System</title>` mismatch the "Legalio" brand — grep, `apps/frontend/index.html`
- No axe/jest-axe/Playwright a11y tests; `@playwright/test` is a root devDependency but `playwright*.config.ts` is only included in tsconfig and no UI e2e specs exist (`find -name '*.spec.ts'` returned none) — root `package.json`, `tsconfig.json`
- i18n: languages ID/EN/ZH (switcher label "CN" for ZH). Measured keys: ID 3,589, EN 3,589, ZH 3,556, union 3,589; missing ZH 33; missing EN/ID 0 — script run importing `translations` from `LanguageContext.tsx`
- i18n pattern: `t('app.some_key', 'Default text')` with the default being Indonesian in many call sites (e.g. `t('io.action_delete','Hapus')`, `t('app.gagal_menyimpan_kontrak','Gagal Menyimpan Kontrak')`); AI chat and some strings use inline Indonesian defaults; keys are often derived from the Indonesian sentence (e.g. `redline.gagal_memproses_analisis_redlining`), hard to maintain — `App.tsx`, `ContractRedliningPanel.tsx`, `AIChatWidget.tsx`
- i18n admin tooling: UI Text Manager with tenant overrides, CSV import/export of ID/EN/ZH columns — `UITextManagerModal.tsx`, `LanguageContext.tsx` L2519, L2700-2715. Dates/currency use `date-fns`; `lib/displayDate.ts`. Legal documents (privacy/terms) are separate content files (`privacyContent.ts` 485 lines, `termsContent.ts` 377).
- Loading states: central `LoadingState` with 800 ms delay option; `Skeleton` used in 8 files; `Suspense` fallbacks for lazy routes; `workspaceLoading`/`workspaceError` flags from `useWorkspaceData` — `App.tsx`, grep
- Error handling: single `ErrorBoundary` at root (`main.tsx`); no per-route boundaries, so a render error in any lazy view blanks the whole app; toast errors on mutations; `catch (err: any)` pattern widespread — `main.tsx`, `App.tsx`
- Type safety: `tsc --noEmit` on apps/frontend passes in ~21 s, BUT no `"strict": true` in `packages/ts-config/{base,frontend}.json` or root tsconfig (grep for "strict" returned nothing); `: any|as any|<any>` appears 142 times; no `@ts-ignore`; 40 `console.*` calls — `packages/ts-config/base.json`, grep
- Tests: root `npm test` runs `node --test` over an explicit file list: 14 frontend-side test files (apps/frontend/src/lib: documentsApi, evaluationSnapshot, partnerChecks, serviceOrderChecks, serviceOrderSort, spendingChecks, tablePreferences; platform-console: appRoutes, organizationSelection, workspaceSearch, i18n/mailer; shared: bulkParse, fieldNames, pageLayout), all pure TS; no React Testing Library, no jsdom, no Playwright specs. `workspaceSearch.test.ts` and `mailer.test.ts` exist but are NOT in the root test script list (script lists 7 frontend lib tests + appRoutes/organizationSelection/bulkParse/fieldNames/pageLayout) — `package.json` test script vs `find`
- `scripts/check-invitation-ui.mjs` is the only UI-ish check script — `ls scripts`

### Inferences
- With no component tests, regression risk is concentrated in the 2,500-line editor and App.tsx handlers (data loss risk on save/rollback paths).
- Enabling `strict` will surface many latent issues (the 142 `any`s are likely only part); adopt incrementally via `strictNullChecks` first.
- Missing skip link, alt policy and axe CI mean WCAG 2.1 AA conformance is unverified despite strong ARIA counts.

### Gaps
- Did not run an automated accessibility scan or keyboard-walk; color contrast of the theme tokens was not measured.
- Did not count hardcoded user-visible strings outside `t()`.

## 6. Monorepo hygiene

### Takeaway
Simple and workable (npm workspaces + Turbo, source-exported packages, shared tsconfig), but lacks linting/formatting, CI beyond deploy, and test orchestration through Turbo.

### Cited Findings
- No ESLint, Prettier, or EditorConfig config at repo root (`ls -a`), and no `eslint`/`prettier` in any package.json; "lint" is `tsc --noEmit` per package plus root `tsc --noEmit` — `package.json`, `apps/frontend/package.json`
- `turbo.json` defines only `build`, `lint`, `dev`; no `test`, `typecheck`, `lint` inputs; `lint` has `dependsOn ^lint` and root script forces `--concurrency=1`; `build.env: ["VITE_*"]` — `turbo.json`, root `package.json`
- Root `test` script is a hard-coded list of file paths run with `node --import tsx --test`, not wired to Turbo; new tests must be manually added (two existing frontend-side tests are missing from the list) — `package.json`
- CI: only `.github/workflows/deploy.yml` (SSH deploy to Tencent Lighthouse on push to `main`); no PR workflow for typecheck/test/build — `.github/workflows/deploy.yml`
- tsconfig: shared `packages/ts-config/{base,frontend,backend}.json`; no `strict`; `experimentalDecorators` and `useDefineForClassFields:false` in base (legacy flags, irrelevant to React); `allowImportingTsExtensions`; root tsconfig includes all apps/packages — `packages/ts-config/base.json`, `tsconfig.json`
- Dependency health (declared ranges): React 19.0.1, Vite ^6.2.3, Tailwind ^4.1.14, TanStack Query ^5.103.1, Tiptap ^3.31.3, better-auth ^1.7.1, recharts ^3.10.1, lucide-react ^0.546.0, TypeScript ~5.8.2, @playwright/test ^1.63.0; `cn` ^0.3.2 is a tiny third-party package alongside `clsx`/`tailwind-merge` (redundant); `autoprefixer` is a dev dependency though Tailwind 4 via Vite plugin does not need it; `motion` and `@radix-ui/colors` present; `lucide-react` duplicated in 3 package.json (apps/frontend, ui-components, platform-console) — package.json files. No `npm audit`/`npm outdated` run (not part of this pass).
- `packageManager` npm@10.9.8, Node >=20.19.0, `.nvmrc` present; `postinstall` runs `scripts/setup-env.mjs` (side-effectful install step) — root `package.json`
- Peer deps: ui-components lists react as peerDependency, platform-console as dependency (`react ^19.0.1`) — potential duplicate React if hoisting breaks; platform-console imports `@tanstack/react-query`, `better-auth` as its own deps while frontend also lists them (versions aligned) — package.json files
- Frontend package lacks `test` and `typecheck` scripts (only dev/build/preview/lint) — `apps/frontend/package.json`
- Docs: root has `README.md`, `HANDOVER_POSTGRESQL_COS.md`, `POSTGRES_STORAGE.md`; ui-components README (Indonesian) refers to nonexistent docs; STANDARD.md referenced in `dialog.tsx` comment (not verified) — files listed

### Inferences
- The absence of lint rules (react-hooks/exhaustive-deps, jsx-a11y) is directly linked to the observed hooks-order bug in `MainApp` and the 122 `useEffect` calls with no automated dependency check.
- Adding a PR workflow (typecheck + test + build) is the cheapest guard before every deploy; currently main-branch pushes deploy without gates.

### Gaps
- `npm audit` / outdated check and lockfile review not performed.
- Whether `docs/`/`STANDARD.md` exist on other branches was not checked (current checkout only).

## 7. Prioritized recommendations (effort in engineer-days, rough)

### Takeaway
Highest return: stop the entry bundle bloat, formalize data layer, add CI + lint + strict typing, then break up giant components and fill CLM feature gaps.

### Cited Findings
(see sections above for evidence)

### Inferences
**High**
1. Add PR CI: typecheck, `npm test`, `vite build`, bundle-size budget; gate deploy on it (`.github/workflows`). Effort 1 d.
2. Fix `MainApp` hook-order (move `if (!user)` after hooks or split component) and add ESLint with `react-hooks` + `jsx-a11y` + `@typescript-eslint/no-explicit-any` (warn). Effort 1-2 d (+2-4 d to burn down warnings).
3. Lazy-load i18n catalogs per language and split `extraTranslations`/`zh`/`LanguageContext` dictionaries out of the entry; add `rollup-plugin-visualizer`; lower `chunkSizeWarningLimit` back to 500. Expected entry reduction of several hundred kB. Effort 2-3 d.
4. Centralize API client (one `request<T>()` with error typing, auth/org handling, abort, 401 handling) and migrate the 44 files with raw `fetch`; adopt `useMutation` + targeted `invalidateQueries`/`setQueryData`, remove handler logic from App.tsx; drop client-sent `userEmail/userRole`. Effort 5-8 d.
5. Enable TS `strict` incrementally (`strictNullChecks` first) and add runtime validation (zod) for API payloads at the client boundary; share schemas via `@legalio/types`. Effort 5-10 d.
6. Product gaps: e-signature integration and obligation/renewal tracking with reminders are the top CLM gaps. Effort 15-30 d each (needs backend).

**Medium**
7. Break up `ContractDocumentEditor` (2,516 lines) into hooks (`useDraftSave`, `useComments`, `useVersioning`) and subcomponents; add `useMemo/useCallback` where props cross; add component tests for save/restore. Effort 5-8 d.
8. Component/E2E tests: add Vitest + React Testing Library + jsdom for forms and gate logic; add 3-5 Playwright smoke specs (login, create contract, org switch); add axe checks. Effort 4-6 d. Wire tests into Turbo (`test` task) and fix the hard-coded file list (include `workspaceSearch.test.ts`, `mailer.test.ts`).
9. Per-route error boundaries around lazy views, `Suspense` fallbacks with skeletons per view. Effort 1 d.
10. Server-side pagination/search for contracts/partners/spend lists, replacing the monolithic `/api/init-data`; consider virtualization (TanStack Virtual) for large tables. Effort 8-12 d (backend+frontend).
11. Accessibility pass: skip link, focus management on route change, `alt` policy, live regions for toasts/async status, contrast audit; fix `index.html` title/lang. Effort 3-4 d.
12. Real redlining: word-level diff (replace `diffParagraphs` LCS with Myers/diff-match-patch), tracked-change marks, and rename the AI feature to "AI risk review". Effort 5-10 d.
13. Introduce a real router (react-router/TanStack Router) with deep links to records (`/contracts/:id`) and typed route params replacing `selectedItem: any`. Effort 4-6 d.

**Low**
14. Prune or archive ~34 unused ui-components modules (after internal-usage check); flatten the facade/moduix two-layer structure; write the missing design-system docs or fix the README. Effort 2-3 d.
15. Remove redundant deps (`cn`, `autoprefixer`), dedupe `lucide-react`, run `npm audit`/`outdated`; update nginx for long-cache hashed assets, `gzip_static`/`brotli_static`; self-host the font with `font-display: swap`. Effort 1-2 d.
16. Add Prettier/EditorConfig; remove 40 `console.*` calls or route through a logger. Effort 0.5-1 d.
17. Notifications: add in-app bell/unread badge and optional SSE/websocket. Effort 3-5 d (backend).

### Gaps
- Effort estimates are my judgment, not measured; backend work for items 6, 10, 17 was not scoped.
