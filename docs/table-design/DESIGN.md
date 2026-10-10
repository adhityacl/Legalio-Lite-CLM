> The shared Moduix design system supersedes the former Dashboard/Hierarchy exclusions. Every application page now uses the standard table token contract. See `design-system/legalio/MASTER.md`.

# Application table design

The supplied Partners table is the visual reference. Its white card, pale header,
thin horizontal dividers, calm typography, outlined status pills, and integrated
pagination are shared across application data tables.

## Source and scope

`src/styles/data-tables.css` is the canonical token and presentation source.
`design-tokens.json` documents the values, and `design-preview.html` is a standalone
interactive example. No external styles, fonts, or scripts are required by the preview.

The workspace and portaled dialogs receive `data-table-design` from
`tableDesignForTab`. Dashboard and Hierarchy use `legacy`;
all other pages use `standard`. Presentation rules only target explicitly marked
tables inside a standard scope. Authored agreement tables in the document editor
remain document content rather than application controls.

## Components

- `ds-table-surface`: a 20 px rounded card with one border, white background, and
  subtle shadow. Nesting a shared table primitive in a card does not add a second border.
- `ds-table`: shared 14 px text, 58 px minimum row rhythm, muted header, horizontal
  dividers, and hover/selection states. Existing column widths, numeric alignment,
  sorting, selection, action menus, empty states, and overflow behavior remain functional.
- `Table` primitives: opt into the same presentation automatically.
- `TablePagination` / `ds-table-pagination`: white footer, outlined rounded controls,
  page indicator, and existing page-size behavior. Static tables do not acquire
  unnecessary pagination.
- Status pills: rounded outlined badges with consistent padding and typography.
  Existing status colors retain their semantic meanings.

## Responsive and accessible behavior

Wide tables scroll within their cards. Mobile cells reduce outer padding and retain
20 px checkboxes and the existing 44 px action targets. Headers retain their semantic
markup and sort controls; keyboard focus and accessible labels remain intact.
Dark mode changes the same semantic tokens without changing table structure.
Reduced-motion preferences disable row transitions.

## Adoption

Use `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, and `TableCell` for
new tables. For native markup, add `ds-table` to the table and `ds-table-surface` to
its surrounding card. Put `TablePagination` inside that card when pagination is
already part of the feature. Apply the page scope to any custom portal that does
not use `ModalFrame`.
