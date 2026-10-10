# Legalio design system

Status: shared foundation, semantic color utilities across application pages, common table recipes and Backup & Restore pilot implemented. Migration of bespoke block composition is incremental.

## Ownership

`packages/ui-components/src/styles/tokens.css` is the source of truth. It owns the light/dark palette, spacing, typography, radius, control sizes, shadows, motion and layers. `foundation.css` maps the scale into Tailwind/Moduix; `components.css` owns shared recipes. Frontend and `/sys` load the same files through the compatibility stylesheet. No second palette belongs in either application.

Moduix React Tailwind supplies styled primitives, backed by Ark UI. Product code imports from `@legalio/ui-components`, never directly from Moduix or Ark. Add an Ark-only primitive there when Moduix does not cover the interaction, and apply the same recipes and tokens.

The skill's design-system search did not return a verified dashboard-specific visual direction after a narrower retry. The direction below uses the skill's built-in accessibility/interaction guidance, the existing Legalio brand, and Moduix's documented token architecture.

## Visual contract

- Calm operational dashboard: opaque neutral surfaces, restrained blue actions, readable typography, subtle shadows.
- Every button and single-line field is 40px (`--ds-control-md`); compact actions are 32px (`--ds-control-sm`). The scale is identical on all viewports and pointer types.
- 4px spacing base; use the common scale instead of arbitrary values. Page gap and card padding default to 24px; mobile card padding is 16px.
- Controls use 8px radius, cards and dialogs 12px, badges the full radius.
- Semantic status colors are success, warning, danger, info, special and finance. Foreground, soft background and border form a family.
- Motion uses 150/200ms and respects reduced motion. Layout dimensions may remain responsive expressions.
- Theme attributes live on `html` so portalled overlays inherit the same theme. Organization brand overrides remain runtime inputs to primary/action tokens.

## Components and blocks

Shared Moduix adapters: Button, Input, Card, Badge, Alert, Tabs, Table, Skeleton, ModalFrame. Legacy Calendar/Popover/AlertDialog contracts remain available with token styling during the behavior migration.

Shared blocks: PageHeader (heading, description, actions), FormField (label, control, help), TableFrame, form body and action row recipes. Do not rebuild their padding, typography or colors in product pages.

Live catalog: `/sys?tab=admin-system-design-system`. It shows variants, sizes, fields, feedback, loading, tab interaction, tables, empty states and portalled dialogs. The catalog is available behind the existing superuser console access check and makes no mutation calls.

## Verification and enforcement

`tests/designTokens.test.ts` checks the shared primitive/pilot color contract. Browser coverage in `system-console.live.spec.ts` checks light/dark surfaces, file validation, confirmation gating, Escape, restored focus, mobile overflow and catalog tabs. Keep business-logic tests separate.

New component/blocks must show disabled, focus, error and loading states where applicable. Test keyboard and touch, 375/768/1024/1440px, light/dark and actual organization branding. User-authored document colors and data-driven visualizations are content values, not UI theme overrides.

## Remaining migration

- Replace bespoke blocks on all workspace/admin pages with the shared recipes, family by family.
- Migrate remaining Radix interactions only with focused behavior tests (select collections, date parsing, nested overlays and confirmation semantics).
- Fold legacy CSS illustrations and chart-specific styling into named component tokens; do not silently alter authored document formatting.
- Extend the catalog as each component family migrates. No page-specific themes or direct palette utilities in new UI code.
