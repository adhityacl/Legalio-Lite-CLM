import { TableCell, TableHeader } from '@tiptap/extension-table';

/**
 * Adds a `backgroundColor` attribute (rendered as inline `background-color` CSS)
 * to table cells/headers, so the toolbar's cell-color swatches have somewhere to
 * persist their value. Not part of the default table cell/header node schema.
 */
const backgroundColorAttribute = {
  addAttributes() {
    return {
      // Keep the base node's own attributes (colspan, rowspan, colwidth, align) —
      // prosemirror-tables' column-width/resize logic reads `colspan` unconditionally,
      // so dropping it here (by not merging `this.parent()`) silently zeroes out
      // every table's rendered width, making it invisible.
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: (el: HTMLElement) => el.style.backgroundColor || null,
        renderHTML: (attrs: { backgroundColor?: string | null }) => {
          if (!attrs.backgroundColor) return {};
          return { style: `background-color: ${attrs.backgroundColor}` };
        },
      },
    };
  },
};

export const CustomTableCell = TableCell.extend(backgroundColorAttribute);
export const CustomTableHeader = TableHeader.extend(backgroundColorAttribute);
