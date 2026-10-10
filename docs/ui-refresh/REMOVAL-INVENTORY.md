# Removal Inventory (non-functional text & sections)

Scope: request #2 — *remove unimportant text or sections that have no function, make the design look neat*.
Branch: `feat/shadcn-ui-refresh`

## A. Applied in this branch

| # | Location | Removed / condensed | Reason | Evidence |
|---|----------|---------------------|--------|----------|
| A1 | `src/components/SignInForm.tsx` | Repeated inline focus/ring color one-offs (`focus:ring-blue-500`, `border-slate-200`, `bg-white dark:bg-slate-900`) replaced by the shared token contract | Duplicate styling per element; unify to one system | file diff |
| A2 | `src/components/SignInForm.tsx` | Verbose per-element wrapper `div`s for the error banner replaced with the `Alert` component | Redundant markup, no semantic value | file diff |
| A3 | `src/components/SignInForm.tsx` | Duplicated Privacy/TOS + copyright footer block extracted to one `LegalFooter` component | The block was written twice (success screen + form screen) | file diff |

## B. Recommended (staged — needs a build/runtime pass, not applied blind)

| # | Location | Item | Why it is non-functional / risky | Suggested action |
|---|----------|------|----------------------------------|------------------|
| B1 | `src/index.css` (end of file) | Two `/* Added by Focus Mode */` rules that hide elements via brittle `div#root:nth-of-type(1) > ... > span:nth-of-type(1)` selectors | Positionally hard-coded selectors that silently hide unrelated elements; a maintenance hazard | Delete both blocks; implement focus mode with a class on the target element |
| B2 | `src/components/PartnersView.tsx` | Per-row helper text `Klik untuk Audit Checklist Due Diligence` (title attribute on every row button) | Repeated 10× per page; redundant since the column header already says “Audit Status DD” | Keep a single explanatory line, drop the per-row text |
| B3 | `src/components/PartnerModal.tsx` | Helper strings `Generate AI Notes`, `Auto-fill dari Dokumen Kontrak (AI Parse)`, `(AI Parse)` | Developer-facing wording; clarify or move behind a tooltip | Reword to user language |
| B4 | `src/components/Sidebar.tsx` | Nav label `Explore` | Ambiguous item name; does not describe a destination | Rename to its real purpose (e.g. “Struktur & Hirarki”) or remove if duplicate |
| B5 | i18n dictionaries | Mixed ID/EN keys (default session shows `Dashboard Utama` + `Partners` + `Notifications` + `Settings` together) | Missing translations cause language mixing | Complete the EN dictionary; default to one locale |
| B6 | `src/components/PartnersView.tsx` | Desktop table **and** mobile card list are both mounted (duplicated content in the accessibility tree) | Doubles DOM/text for screen readers | Render one, switch layout with CSS/`useMediaQuery` |

## C. Explicitly preserved (do NOT remove)

- `Privacy Policy` / `Terms of Service` links — legally required.
- `2026 ACL. All rights reserved.` — keep (brand/legal footer).
- Empty / loading / error states — they carry meaning for the user.
