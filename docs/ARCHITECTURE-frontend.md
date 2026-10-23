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
* Raw `fetch(` calls left: 0 in `apps/frontend/src` besides the client; about 55 (in 20 files) remain in `packages/platform-console` (auth context,
  sign-in, tenant contexts, platform configuration, Google sign-in) and `packages/shared` (exchange rates). They are shared with the System Console
  build; moving the client into `packages/platform-console` and re-exporting it from `apps/frontend/src/api` is the next step.

## Workspace data and mutations (`features/workspace`)

* `useWorkspaceData` reads `/api/init-data` into the query cache (key `['init-data', identity, organization]`).
* `workspaceCache.ts` + `useWorkspaceMutations.ts`: contract/order/partner create, edit and delete are `useMutation`s with optimistic cache updates,
  rollback that never undoes a newer value, and invalidation of the snapshot afterwards. A contract edit sends the `version` it was based on; a 409
  `VERSION_CONFLICT` is shown as "changed by someone else" and the refresh loads the current version.
* `useWorkspaceActions.ts` adds confirmations, toasts and translated messages; `WorkspaceContext.tsx` provides data, actions and the open editor.
* The list views still receive the whole snapshot (`init-data`) and filter, sort and page on the client: the dashboard, search palette, hierarchy
  and the cross-references between lists need all records. The paged endpoints and `contractsApi.page(...)` exist for the next step (a views-by-view
  move to server-side lists), not used by the screens yet.

## Pages and routing (`routes`, `shell`)

* URLs are unchanged: `/app?tab=<page>`. `?tab=contracts&id=C0001` additionally opens that record (contracts, orders, spending, evaluation; partners
  open their editor); the id leaves the URL once the record is open, search results write it, and a link opened while signed out is restored after
  sign-in.
* `routes/registry.tsx` maps every tab to a lazily loaded page component (one chunk each) and its tenant module switch. `routes/useRouteGate.ts` is the
  pure decision (organization, capabilities, permission, module) taken before a page mounts. `routes/RouteBoundary.tsx` isolates a page that throws or
  whose chunk fails to load.
* `shell/AuthenticatedApp.tsx` is the signed-in shell; `App.tsx` only composes providers and sign-in routing.
* To add a page: add the tab to `lib/appRoutes.ts` (permission), a `routes/XRoute.tsx` that reads `useWorkspace()`, and an entry in `ROUTES`.

## Bundle sizes (production build, raw bytes)

| Chunk | Before | After |
| --- | ---: | ---: |
| entry `index` | 1,306,682 (brotli 310,819) | 1,314,487 (brotli 313,709) |
| `ContractDocumentEditor` (Tiptap, lazy) | 1,099,051 | 1,097,969 |
| Dashboard (recharts, lazy) | 423,477 | 423,730 |
| Hierarchy / Settings / Partners pages | 87,798 / 77,978 / 66,974 | 88,476 / 77,847 / 66,215 |

The editor and dashboard were already lazy and stay out of the entry. The entry is dominated by react-dom (620 KB source), the UI kit and
`@ark-ui` (about 500 KB), and the policy packs in `packages/shared` (industry packs 113 KB, `zh` 77 KB), which load synchronously with the tenant
settings: lazy-loading those is the largest remaining entry-size win.
