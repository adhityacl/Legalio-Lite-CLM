# Frontend structure

## API layer (`apps/frontend/src/api`)

* `client.ts` is the only code that calls `fetch` for the backend: same-origin `/api/...` with cookies, JSON in/out, an `X-Request-Id` per call,
  `AbortSignal` and `timeoutMs`, blob downloads (`apiBlob`), and one error type, `ApiError { error, code, message, status, requestId }`
  (network failures are `code: 'NETWORK_ERROR'`, timeouts `'TIMEOUT'`). A 401 on an authenticated call dispatches `auth-session-invalid`, which the
  auth provider answers by re-checking the session. The session token and the tab's organization header are still added by the global fetch
  interceptor (`lib/apiFetch.ts`); a call that must stay bound to one organization passes `organizationId`.
* Endpoint modules (`contracts.ts`, `partners.ts`, `orders.ts`, `spendings.ts`, `evaluations.ts`, `notifications.ts`, `templates.ts`, `account.ts`,
  `assistant.ts`, `workspace.ts`, `bulkImport.ts`) give typed functions, including `page(...)` for the paged list endpoints.
* `userEmail` / `userName` / `userRole` are never sent: the server takes the actor from the session.
* The client itself lives in `packages/shared/src/apiClient.ts` (`@legalio/shared/apiClient`); `apps/frontend/src/api/client.ts` re-exports it. The
  platform console and `packages/shared` use the same client (shared is the lowest layer both depend on, so there is no cycle). Raw `fetch(` is
  an ESLint error (`no-restricted-globals`) in browser code; the only remaining uses are third parties: the Google Drive/Sheets calls in
  `platform-console/src/lib/googleAuthService.ts` and the exchange-rate provider in `shared/src/currencyRates.ts` (server side).
* `api/aggregates.ts` and `api/search.ts` type the SQL aggregate endpoints and `/api/search`.

## Workspace data and mutations (`features/workspace`)

* `useWorkspaceData` reads `/api/init-data` into the query cache (key `['init-data', identity, organization]`), but only **on demand**: the provider
  enables it while an editor or the amendment dialog is open, or while a view asks for it with `useSnapshotDemand()` (hierarchy, bulk import,
  contract creator, partner evaluation, the spending form). Contracts, partners, orders, spending, dashboard, notifications, the navigation badges
  and the search palette do not call it.
* `workspaceCache.ts` + `useWorkspaceMutations.ts`: contract/order/partner create, edit and delete are `useMutation`s with optimistic cache updates,
  rollback that never undoes a newer value, and invalidation of the snapshot afterwards. A contract edit sends the `version` it was based on; a 409
  `VERSION_CONFLICT` is shown as "changed by someone else" and the refresh loads the current version.
* `useWorkspaceActions.ts` adds confirmations, toasts and translated messages; `WorkspaceContext.tsx` provides data, actions and the open editor.
* **Server-side lists** (`lib/useServerList.ts`, `lib/listState.ts`): contracts, partners, orders and spending request
  `GET <collection>?limit&offset&q&sort&dir&<filters>` and read `X-Total-Count`. Page, search, sort and filters live in the URL
  (`?tab=contracts&l.page=2&l.q=acme&l.sort=end&l.dir=desc&l.f.status=Active`); the navigation drops `l.*` when the page changes. Typing is debounced
  (300 ms); TanStack Query keeps the previous page on screen (`keepPreviousData`) while the next one loads. `lib/useRecordLookup.ts` resolves a
  deep-linked record (`&id=`) and a record's related rows (addenda, orders of a contract) through the same endpoints.
  Mutations invalidate the `lists`, `aggregates` and `notifications` query roots together with the snapshot.
* **Aggregates** (`features/aggregates`): the dashboard reads `GET /api/aggregates/dashboard` (counts by status, active value per currency, the five
  nearest expiring and the five newest documents, the monthly spending roll-up with categories); the navigation badges read
  `/api/aggregates/badges`; filter option lists read `/api/aggregates/facets`; `/api/aggregates/partners` gives per-partner roll-ups (not used by a
  screen yet). All are scoped to the caller's organization and departments in SQL.
* **Search palette**: `features/aggregates/useWorkspaceSearch.ts` calls `GET /api/search` (debounced 250 ms); `AppShell` reports the typed text
  through `onSearchQueryChange`.
* Not virtualized: the tables render one page (at most 50 rows), so there is no list over 200 rows to virtualize.

## Pages and routing (`routes`, `shell`)

* URLs are unchanged: `/app?tab=<page>`. `?tab=contracts&id=C0001` additionally opens that record (contracts, orders, spending, evaluation; partners
  open their editor); the id leaves the URL once the record is open, search results write it, and a link opened while signed out is restored after
  sign-in.
* `routes/registry.tsx` maps every tab to a lazily loaded page component (one chunk each) and its tenant module switch. `routes/useRouteGate.ts` is the
  pure decision (organization, capabilities, permission, module) taken before a page mounts. `routes/RouteBoundary.tsx` isolates a page that throws or
  whose chunk fails to load.
* `shell/AuthenticatedApp.tsx` is the signed-in shell; `App.tsx` only composes providers and sign-in routing.
* To add a page: add the tab to `lib/appRoutes.ts` (permission), a `routes/XRoute.tsx` that reads `useWorkspace()`, and an entry in `ROUTES`.

## Bundle sizes (production build)

Entry chunk = the module script of `index.html` plus the chunks it preloads (measured by `scripts/check-bundle-size.mjs`; brotli at quality 11):

| | Before | After |
| --- | ---: | ---: |
| entry raw | 1,316,880 B | 638,860 B (-51 %) |
| entry brotli | 314,292 B | 168,897 B (-46 %) |

What moved out: the industry packs and the zh/id pack texts (`@legalio/shared/policy` resolves to `policy/lazy.ts` in browsers through the
`browser` export condition; `loadPolicyPacks()` fetches the two chunks once someone is signed in and `subscribePolicyPacks` re-renders the tenant
settings consumers; the server and tests keep the eager `policy/index.ts`), and the whole signed-in shell (`App.tsx` loads `shell/AuthenticatedApp`
as its own chunk, prefetched when the browser is idle). The sign-in page therefore ships react-dom, the UI kit, the query client and the API client only.
The editor (Tiptap) and the dashboard (recharts) were already lazy. The remaining entry is dominated by react-dom, the UI kit and `@ark-ui`.

`npm run check:bundle` (run by CI after the build) fails when the entry grows past `apps/frontend/bundle-budget.json` (measured size + 10 %: raw
702,746 B, brotli 185,787 B). After a deliberate change run `node scripts/check-bundle-size.mjs --write-budget`.
