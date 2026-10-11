# Legalio UI Standard: pure golden ratio (φ)

**Status:** binding for every developer and AI agent (Claude, OpenAI/Codex, Gemini, Cursor, Copilot).
This file is the **single source of truth** for every size in the UI: type, line height, spacing,
control height, icon, radius, shadow, layout width and motion. When another document disagrees,
this one wins. `tokens.md` (colour) and `components.md` (catalog) only add detail.

Components come from `@legalio/ui-components/<name>` (the copy-owned Moduix source, see `AGENTS.md`).
Moduix supplies the component anatomy and behaviour. **Every size it uses is re-tuned to this standard.**

---

## 0. The golden ladder (the only allowed sizes)

φ = 1.618. Every size is a member of one of two interleaved golden sequences, rounded to whole
pixels:

| Sequence | Values (px) |
| --- | --- |
| **A = 8 · φⁿ** | 2 · 3 · 5 · **8** · 13 · 21 · 34 · 55 · 89 · 144 · 233 · 377 · 610 · 987 · 1597 |
| **B = 16 · φⁿ** | 10 · **16** · 26 · 42 · 68 · 110 |

Merged, these give **the golden ladder**. Neighbouring values differ by about √φ (1.27), so every
"half step" is still a golden number:

```
2 · 3 · 5 · 8 · 13 · 16 · 21 · 26 · 34 · 42 · 55 · 68 · 89 · 110 · 144 · 233 · 377 · 610 · 987 · 1597
```

Each value is a Tailwind token named after its pixel value: **`g2` `g3` `g5` `g8` `g13` `g16` `g21`
`g26` `g34` `g42` `g55` `g68` `g89` `g110` `g144` `g233` `g377` `g610` `g987` `g1597`**. They work with every
sizing and spacing utility: `p-g13`, `gap-g21`, `h-g42`, `size-g16`, `w-g233`, `max-w-g610`,
`top-g8`, `-mt-g5`.

### Rules

1. **Use a ladder token or a component `size`, never a number.** These are forbidden in product code:
   - Tailwind's 4 px numeric scale (`p-4`, `h-10`, `gap-3`, `w-72`).
   - Tailwind container sizes (`max-w-md`).
   - Arbitrary values (`w-[437px]`).
   - Inline pixel styles.

   Allowed non-ladder values: `0`, `px` (1 px hairline), `full`, `screen`, `dvh`, `auto`, fractions
   (`w-1/2`) and runtime geometry (an overlay that follows a DOM rect).
2. **Controls are sized by `size` only** (§3). Never add `h-*`, `py-*`, `px-*` or `text-*` to a control to resize it.
3. **Not covered?** Take the nearest ladder value that keeps the φ relationships in §1–§4, and add it
   to this file in the same change.
4. **Verify:** `npx tsx --test tests/designTokens.test.ts`. It fails on any non-ladder size utility.

---

## 1. Typography

### 1.1 Type scale

Sizes come from the ladder. The floor is **13 px** (8·φ). The golden 10 px step stays excluded
because it is below WCAG and repository legibility rules.

| Utility | Size | Line height = next golden step | Use |
| --- | --- | --- | --- |
| `text-xs` | **13** | **21** | Captions, helper and error text, badges, tags, timestamps, table meta, text in `sm` and `xs` controls |
| `text-sm` | **13** | **21** | **Dense UI text**: all control text (input, select, button, tab, menu row), table cells, labels, helper text |
| `text-md` / `text-base` | **16** | **26** | Reading text: paragraphs, dialog copy, document body, card titles |
| `text-lg` | **21** | **34** | Section titles (H2/H3), dialog and drawer titles, `lg` control text |
| `text-xl` | **26** | **42** | Dialog hero titles, `xl` control text (the app page title is `text-lg`, §1.2) |
| `text-2xl` | **34** | **55** | KPI values and large hero numbers |
| `text-3xl` | **42** | **68** | Display (sign-in and onboarding hero, at most one per screen) |
| `text-4xl` | **68** | **110** | Marketing and legal landing only, never inside the app shell |

- The UI is dense, so interface text is **13 px**. Reading text and card titles are **16 px**. Golden has no 14.
- **Line height:**
  - Reading text uses font × φ, which is exactly the next ladder value: 13→21, 16→26, 21→34, 26→42.
  - Single-line controls are vertically centred by their height, so their line height does not matter.
  - Headings at 34 px and above may tighten to one step (×√φ): 34→42 and 42→55, using `leading-snug`.

### 1.2 Headings in the application

| Element | Utility | Weight |
| --- | --- | --- |
| Page title `<h1>` / `Heading size="md"` (one per view) | `text-lg` 21/34 | 600 |
| Section `<h2>`, card / panel title `<h3>` | `text-md` 16/26 | 600 |
| Group legend | `text-xs` 13/21 | 600 |
| Table column header | `text-xs` 13/21 | 600, muted, on a `bg-muted` band |
| Overline | `text-xs` 13 | 500, uppercase, tracking 0.05em |

Use `Heading` and `Text` from `@legalio/ui-components`.

### 1.3 Weight, tracking and measure

- **Weights:**
  - 400 body.
  - 500 labels and controls.
  - 600 headings.
  - 700 only for display and KPI numbers.
- **Tracking:** −0.02em at 26 px and above; 0 otherwise.
- **Measure:** reading columns are at most **610 px** (`max-w-g610`, about 65 characters at 16 px).
- **Fonts:** Plus Jakarta Sans for UI; JetBrains Mono plus `tabular-nums` for IDs and amounts.

---

## 2. Spacing

The spacing tokens are the same ladder. Choose the step by relationship:

| Relationship | Token |
| --- | --- |
| Hairline offsets, focus-ring offset | `g2` / `g3` |
| Icon ↔ label inside a control; badge internals | `g5` |
| Label → control; title → description; tight inline groups; **minimum gap between touch targets** | `g8` |
| Field → field; toolbar items; list items; table cell padding-x | `g13` |
| Card, panel and dialog padding; card grid gap; form section → section | `g21` |
| Page padding (≥ md); page sections; header → content | `g34` |
| Page padding (< md) | `g13` |
| Hero / empty-state rhythm, landing sections | `g55` / `g89` |

**Proximity rule:** spacing inside a group is at least one ladder step smaller than spacing between groups.

---

## 3. Controls

**Height ladder:** `xs` 21, `sm` 26, `md` 34, `lg` 42, `xl` 55. Compact on purpose, and every value is a golden number.

The golden control formula ties every dimension to the height *h*:

- **font = icon = padding-x ≈ h ÷ φ²**
- **min-width (text buttons) = h × φ**
- **icon ↔ label gap = `g5`**

| `size` | Height | Font | Icon | Padding-x | Min-width (text) | Radius | Use |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `xs` | **21** | 13 | 13 | 5 | 34 | `rounded-sm` 5 | Inline chips. Never the only target on touch screens. |
| `sm` | **26** | 13 | 13 | 8 | 42 | `rounded-md` 8 | Table row actions, card actions, toolbars, popover footers, editor toolbar |
| `md` (default) | **34** | 13 | 16 | 13 | 55 | `rounded-md` 8 | **Every field, every form or page action**, anything in a row with a field |
| `lg` | **42** | 16 | 16 | 16 | 68 | `rounded-lg` 13 | Primary call to action on sign-in, onboarding and empty states |
| `xl` | **55** | 21 | 21 | 21 | 89 | `rounded-lg` 13 | One hero call to action (landing only) |

1. **Icon-only buttons are squares** of the height: 26, 34 or 42. Each needs an `aria-label` and a `Tooltip`.
2. **Controls in one row share one size.**
3. **Segment group** is 34 tall (`sm` 26 items inside `g3` padding and a 1 px border), so it lines up with `md` fields.
4. **Popup rows** (menu, listbox, combobox and command-palette items) are **26**. Tooltips 21 minimum. Badges 21, tags 26.
5. **Checkbox and radio box: 16.** Switch track **34 × 21** (a golden pair). Hit area at least 26.
6. **Touch:** every target is at least 26 (WCAG 2.2 target size of 24 or more), with at least `g8` between targets.
   Below `md`, primary actions use `md` (34) or larger.
7. **Focus ring:** 2 px ring with a 2 px offset (`g2`), in the `ring` colour. Never removed.

---

## 4. Layout

### 4.1 Widths (all ladder values)

| Element | Width |
| --- | --- |
| Navigation sidebar | **233** default, resizable 144–377 (`minSize`/`maxSize` in `Sidebar.tsx`) |
| Navigation rail (collapsed) | **55** |
| App header height | **42** |
| Mobile navigation drawer | min(**233**, 85vw) |
| Side panel / inspector | **377** (wide: **610**). The editor assistant is 377 including a 55 icon rail (`TabsList`). |
| Popover / menu min-width | **233** |
| Tooltip max-width | **233** |
| Toast width | **377** |
| Reading column / single-column form | **610** |
| Two-column form | **987** |
| App content max width | **1597** (effectively full width on common screens) |

### 4.2 Golden splits (38.2% / 61.8%)

Use these for **two related panes**: `grid-cols-[1fr_1.618fr]` (minor first) or `[1.618fr_1fr]` (major first).

| Pattern | Minor (38.2%) | Major (61.8%) |
| --- | --- | --- |
| Master–detail | list | detail |
| Editor + assistant / comments | panel (`w-g377`, from lg up) | document |
| Settings: section nav + form | nav | form |
| Dashboard: chart + summary | summary | chart (major first) |
| Legal page: TOC + article | TOC | article |

Below `lg` the panes stack, major first unless the minor pane is navigation.
Breakpoints stay at the Tailwind/device defaults (640 / 768 / 1024 / 1280 / 1536). They describe
screens, not UI sizes.

### 4.3 Box proportions

- **Media, preview and stat tiles:** width ÷ height = φ (`aspect-golden`). Example: KPI card 233 × 144.
- **Content cards:** height comes from the content.
- **Dialogs** (`ModalFrame size`):

  | Size | Width | Use |
  | --- | --- | --- |
  | `sm` | **377** | Confirm, alert |
  | `md` | **610** | Forms (default) |
  | `form` | **720** | Data-entry forms (contract, partner, service order, spending, evaluation, amendment, due diligence upload). A decided width, not a ladder step; token `--spacing-form-wide`. |
  | `lg` | **987** | Details, comparisons |
  | `xl` | **1597** (capped by the viewport) | Full review |

  Height comes from the content, up to the viewport.
- **Compact by default.** A data-entry form dialog (contract, partner, service order, spending, evaluation, amendment, due diligence upload) is `form` (720) with at most two columns; every other dialog is `md` (610, the `ModalFrame` default) or smaller, and lets its body scroll. `lg` is only for tables, comparisons or side by side panels; `xl` only for full review. Never widen a form to fill the screen: wide forms read worse and cost more scrolling sideways in the eye.

---

## 5. Component scenarios

| Scenario | Standard |
| --- | --- |
| **Page header** | **Plain row, never inside a Card.** H1 21/34 (`Heading as="h2" size="md"`) with the actions at the end, `md`, gap `g8`. Description 13 muted, `g8` gap. Page sections are separated by `g21`. A header that carries tabs (`ContextHeader`) is the one allowed Card. |
| **Toolbar / filter bar** | One compact Card (`<Card className="p-g13">`, never `g21`) holding one wrapping row (`flex flex-wrap items-center gap-g13`). Every control is `md` 34, so the row is one height. Order: segment filter, search (`flex-1`, min `g233`), selects, then actions or the column menu at the end. Same shape on every page (tables, members, activity, import type selector, Document Structure), so every filter bar is **62 tall** (13 + 34 + 13 + borders). A view switcher in a toolbar is the same 34-tall pill group (see Tabs). |
| **Data table** | **No frame of its own** (`TableScrollArea` has no border, radius or fill): the Card around it is the one frame, so there is never a rounded box inside a box. A table inside a chat bubble is the only exception and adds its own border. Hierarchy: the header row is a `bg-muted` band with 13 px **600** muted text, the body is 13 px 400 `foreground`, so the column titles read as a different layer from the data. Header row **42** (`py-g8` above and below the 26 sort button or label, so header and body rows share one height). Sortable headers are `ghost` `sm` buttons, muted, offset `-ms-g13` so the label lines up with the cell text. Body row **42**, dense **34**. Cell padding-x `g13`, except the first and last cell of a row, which use `g21` (the Card padding) so the table edge lines up with the card header. Numbers right-aligned with `tabular-nums`. Row actions `icon-sm` (26) with a Tooltip. Pagination `md`, `g13` below. |
| **Dialog form sections** | Use `FormSection` (`@legalio/ui-components/blocks`): a numbered Card (`p-g13`, 26 neutral step tile, 16/600 title) per group of fields; fields sit in two columns (`sm:grid-cols-2`, gap `g13`), Section titles have no "Section N:" prefix. A file upload is one row: text on the start side, a `md` "Browse files" button on the end side. |
| **Single-choice answers (evaluation form)** | A numbered section Card (`p-g13`, 26 step tile, 16/600 title). Each criterion is one row: label on the minor side, its 2-4 answers as a row of **34 tall pills** (`rounded-full`, `bg-muted`; selected = `bg-primary text-primary-foreground`, following the tenant theme) on the right, after a `g233` label column; below `sm` the label stacks above. The Total tile uses the same selected look. Section titles have no "Section N:" prefix, and labels are short ("1. Obligation", "Poor", "Notes"). The answer points live in the live score tiles, not on the pill. Long answers wrap to two lines inside the same 34. |
| **Sign-in page** | One full-page scene in both themes: the `auth-backdrop` dark gradient with two soft glows (`auth-glow-blue`, `auth-glow-violet`), colours only from the `auth-*` tokens in `theme.css`. On `lg` the language pill sits above the card, flush with its right edge. Product pitch on the major side (light logo `h-g42`, headline `text-3xl` extrabold `leading-snug`, description `text-md` `text-auth-muted`); the sign-in Card on the minor side (`w-g377`, `rounded-xl`, `p-g34`, title `text-2xl` extrabold). Fields and buttons stay `md`. Below `lg` everything stacks: logo + language pill in one row, headline `text-2xl`, then the card. "Forgot password?" shows a hint to ask the workspace admin (there is no self-service reset). Every Alert on this page uses `text-sm` (13) to match the card text. |
| **Date / month picker popup** | **233 wide** (the popover width), `p-g8`, 26 cells in a 7-column grid (month and year grids use 4 columns); about 255 tall for a month of days. Never wider than the field it belongs to plus a little. |
| **Date / month field** | Always the moduix DatePicker: `DateInput` (dd/mm/yyyy) or `MonthInput` (mm/yyyy), both in `apps/frontend/src/components/`. Never `<input type="date">`, `"month"`, `"time"` or `"datetime-local"`: the browser's own picker ignores the design system (a test enforces this). |
| **Form** | `FieldLabel` 16/500. Label → control `g8`. Control `md` 34. Helper and error text 13/21. Field → field `g13`. Section → section `g34`. `Fieldset` legend 16/600. Actions right-aligned `md`, gap `g8`. |
| **Card** | Padding `g21` (compact `g13`). Title 16/600. Header → body `g13`. `rounded-lg` 13. Border only; `elevated` only when floating. |
| **Dashboard hero** | Two equal columns from `xl` up (stacked below): the Workspace overview card fills the left column (badge top, greeting bottom), and the four KPI cards form a 2×2 grid on the right (KPI cards are `h-g144`, so the hero is 2 × 144 + 13 = 301 tall; no progress bar and no border: the soft tint is the edge). The Workspace overview card sits on an animated `SkyGradient` (`@legalio/ui-components/sky-gradient`) chosen by the hour, with the same bands as the greeting: 05-15 `day` (blue), 15-18 `sunset` (orange), otherwise `night`. Text is `primary-foreground` on `day` and `night`, `foreground` on `sunset`; the badge is `bg-background/80`. The sky stops animating when hidden, off screen or under reduced motion. |
| **Stat / KPI card** | Ratio φ. Value 26 (or 34) 700 `tabular-nums`. Label 13/500 muted. |
| **Dialog / drawer** | Header, body and footer padding `g21`. Title 21/34. Body copy 16/26. Footer `md` buttons, gap `g8`. |
| **Popover / menu / combobox** | Padding `g5`. Rows 26, row padding-x `g8`. Group label 13. Max height `g377`. |
| **Tooltip** | 13/21, padding `g5`×`g8`, max width `g233`. |
| **Badge / tag** | Badge 21 tall, tag 26. Text 13/500, padding-x `g8`. Colour through `tone`. |
| **Alert** | Padding `g13`. Icon 16. Title 16/600. Body 16/26. Actions in `AlertActions`. |
| **Table card header** | Use `TableCardHeader` (`@legalio/ui-components/blocks`): a 34 tinted icon tile (`danger`, `warning` or `info`) and a 16/600 title, `px-g21 pt-g21 pb-g13`, `border-b` below. The table under it is edge to edge. |
| **Empty / loading / error** | Unframed (no border or fill), because it sits inside a card or table. Icon tile 55, glyph 26. Title 16/600, body muted, max width `g610`. Action `md`. Padding `g34` (`g55` when it is the whole page). Skeletons match real sizes. Spinner 16 in buttons, 34 on a page. |
| **Tabs / segmented switch** | **One look everywhere**: a pill group (`TabsList` or `SegmentGroup`) that is **34 tall** and as wide as its items (`w-fit`, never stretched across the card): `bg-muted`, `p-g3`, 26 triggers, active trigger a `background` tile. Radius is a control radius: group `rounded-md` 8, triggers and the active tile `rounded-sm` 5 (outer radius minus padding). Icons inherit the text colour; never a coloured icon per tab. Never the underline (`line`) variant. Inside a Card header (Settings, System Admin) it sits under the title with `mx-g21 mb-g21`. List → panel `g13`. **`TabsContent` is unframed** (no border, fill or padding); the surrounding Card is the frame. |
| **Avatar** | 21 / 26 / 34 / 42 / 55, matching the control ladder. |
| **Navigation item** | Height 34, icon 16, gap `g13`, padding-x `g13`. Sub-items 26. Count badges 21. The active item is a solid `primary` pill (`bg-primary text-primary-foreground`, also while hovered); hover on other items is `accent`. Section labels are sentence case 13/500 muted (never uppercase). Sidebar layout: header 42 with `border-b` aligned to the app header, first section `pt-g34`, other sections `p-g13`, items gap `g5`, footer `p-g13` with the status dot. The sidebar panel and the app header share one surface (`bg-muted`); the main area is `background`. The collapse button is a 26 circle (`background`, border, `shadow-sm`) centred on the divider exactly at the header's bottom border (y 42). |
| **Editor paper** | Body 16/26. H1 26/42, H2 21/34, H3 16/26. Paragraph gap `g13`. Padding `g55`. Max width `g987`. |
| **Charts (recharts)** | Only non-Moduix UI. Axis text 13, chart tokens `--moduix-chart-*`, grid `border` colour, φ aspect ratio. |
| **Editor document header** | Back, document icon, title input, status icon, then actions. The title input is as wide as its text (measured with a hidden mirror span), max 80 characters. Save status is a 16 px icon (`CloudCheck` saved, `CloudOff` unsaved, `CloudAlert` failed, spinner saving); the full sentence is its Tooltip. |
| **App header user menu** | Avatar and name only on one line (header is 42). |
| **Toast** | Width 377, padding `g13`, title 16/600, body 16/26. |

---

## 6. Shape, elevation, z-index and motion

- **Radius:** `xs` 3 · `sm` 5 · `md` 8 · `lg` 13 · `xl` 21 · `full`. Controls use `md`; cards, dialogs and popovers `lg`.
  A nested radius is the outer radius minus the padding, never larger.
- **Borders:** 1 px (`border`), and 2 px for focus or selection. 1, 2 and 3 are Fibonacci.
- **Shadows** (offset and blur on the ladder):
  - `sm` = 0 2 5
  - `md` = 0 3 8
  - `lg` = 0 8 21

  Used only for floating layers.
- **z-index:** Moduix layers only, with names, never raw numbers.
- **Motion** (Fibonacci milliseconds):
  - Hover and press: **144**.
  - Popover, menu and tooltip: **233**.
  - Dialog and drawer: **377**.
  - Moduix easing.
  - `prefers-reduced-motion` reduces durations to about 0.

---

## 7. Colour and contrast (detail in `tokens.md`)

- Semantic tokens only. No hex values or palette classes in product code.
- Contrast 4.5 : 1, or 3 : 1 for large text (21 px and up) and UI boundaries. Use `readableTextOn()` on tenant colours.
- Colour budget 61.8 / 38.2:
  - Neutral surfaces dominate.
  - Supporting tints next.
  - Primary and status colours accent only, with one primary action per view.

---

## 8. Token implementation (`packages/ui-components/src/styles/theme.css`)

- `--moduix-size-{xs,sm,md,lg,xl}`: `21 26 34 42 55`.
- `--moduix-text-*` / `--moduix-line-height-text-*`: `xs 13/21`, `sm 13/21`, `md 16/26`, `lg 21/34`,
  `xl 26/42`, `2xl 34/55`, `3xl 42/68`, `4xl 68/110`.
- `--moduix-radius-*`: `xs 3`, `sm 5`, `md 8`, `lg 13`, `xl 21`.
- `--moduix-shadow-{sm,md,lg}`: on the ladder (§6).
- `--moduix-duration-{fast,normal,slow,slower}`: `144 233 377 377`.
- `--spacing-g{2…1597}`: the golden ladder, which powers all spacing and sizing utilities.

---

## 9. Checklist before finishing any UI change

- [ ] Components only from `@legalio/ui-components/*`.
- [ ] Every size, spacing, width and height is a `g*` token or a component `size`.
- [ ] Type uses §1 (13 px or larger). Controls follow §3. Panes use the golden split.
- [ ] Semantic colours, AA contrast and visible focus.
- [ ] A Tooltip wrapped around a `MenuTrigger` / `PopoverTrigger` shares one `ids={{ trigger }}` with that overlay, otherwise the popup renders at the top-left corner.
- [ ] Looked at it in a real browser (Playwright screenshot) and measured control heights against §3.
- [ ] `npx tsx --test tests/designTokens.test.ts` passes.
