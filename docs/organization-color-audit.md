# Organization palette audit

The audit covers the organization palettes Iris (`#5B5BD6`) and Grass
(`#46A758`), and the shared rules used by all 31 Radix families.
The UI UX Pro Max skill supplied guidance on semantic color tokens, independent
light/dark verification, and a minimum normal-text contrast ratio of 4.5:1.

## Findings and changes

- Several administrative creation buttons, dialog icons, links, and focus rings
  still used fixed emerald classes. Primary actions now use `theme-action` and
  the shared primary tokens. Navigation and decorative organization marks use
  the selected palette; semantic success, warning, and destructive states retain
  their status colors.
- Opacity reduced the contrast of disabled buttons and their icons. Disabled
  primary actions now use explicit background and foreground tokens with no
  blanket opacity. The disabled attribute and non-interactive behavior remain.
- The previous foreground algorithm switched Grass to black. Radix recommends
  light labels for this family. White labels now remain consistent across solid
  normal and hover actions. The action background is darkened when necessary
  to meet WCAG contrast; the saved palette and preview swatch remain unchanged.
- Native radios and checkboxes, active membership filters, workspace monograms,
  navigation selections, and nested action icons now share the palette tokens.
- Dark emerald overrides on semantic accent classes were removed so dark mode
  uses the selected family rather than a second, unrelated green palette.

## Foreground policy

| Surface | Foreground |
| --- | --- |
| Solid Amber, Yellow, Lime, Mint, Sky actions | Dark `#111111` |
| Solid actions in the other 26 Radix families, including Iris and Grass | White `#FFFFFF` |
| Soft backgrounds and selected surfaces | Contrast-adjusted family text shade |
| Disabled primary actions | Family text shade on a muted family background |
| Existing custom colors | A contrast-checked dark or white label |

Solid backgrounds retain their hue and are adjusted only when the intended
foreground would fall below 4.5:1. Hover states target at least 5:1.

In light mode, Iris actions use `#5B5BD6` with white labels (about 5.37:1).
Grass actions use `#388646` with white labels (at least 4.5:1), while the stored
palette remains `#46A758`. Grass hover actions use `#327E40`.

## Implementation and validation

- `src/lib/organizationColors.ts` provides paired normal, hover, disabled,
  soft-surface, focus, and navigation tokens for both themes.
- `src/styles/organization-theme.css` applies those pairs to shared and native
  actions, including nested icons and native controls.
- Unit checks cover all 31 families in both modes and guard against fixed-green
  primary buttons being reintroduced.
- Browser checks cover Iris and Grass across organization sections, membership
  filters, integration mapping, activity history, partner and service-order
  actions, document structure, and administrative creation actions. Existing
  desktop/mobile palette persistence checks also remain in place.

Validation passed: the frontend build, seven unit tests, and seven browser
tests. The full TypeScript check could not complete within the available
memory; narrowing its inputs to the application and tests did not resolve
that limitation.

References: [Radix scale usage](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale),
[WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
