import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

/**
 * A lightweight "pricing table" for itemized contract pricing: Item / Qty / Unit Price / Total,
 * with a Grand Total footer row. Deliberately not a live reactive formula engine — the user
 * inserts the shape, edits Qty/Unit Price, then clicks "Recalculate Totals" to fill in the Total
 * column and the grand total. That one on-demand pass is far simpler and safer inside a rich-text
 * editor than recomputing on every keystroke (no risk of fighting the user's cursor position or
 * undo history), while still saving the manual multiplication/summing.
 *
 * No custom table-node schema is needed: every row has exactly four plain `<td>`/`<th>` cells
 * (no colspan anywhere, including the footer row), so cells can be read back in document order
 * without needing prosemirror-tables' TableMap to resolve merged cells.
 */

const PLACEHOLDER_ROWS = 1;

/** HTML for a fresh pricing table, parsed into real table nodes by TipTap on insert. */
export function pricingTableHtml(labels: { item: string; qty: string; unitPrice: string; total: string; grandTotal: string }): string {
  const dataRows = Array.from({ length: PLACEHOLDER_ROWS }, () => '<tr><td></td><td>1</td><td>0</td><td>0</td></tr>').join('');
  return `<table><tbody>` +
    `<tr><th>${labels.item}</th><th>${labels.qty}</th><th>${labels.unitPrice}</th><th>${labels.total}</th></tr>` +
    dataRows +
    `<tr><td></td><td></td><td>${labels.grandTotal}</td><td>0</td></tr>` +
    `</tbody></table>`;
}

export function insertPricingTable(editor: Editor, labels: Parameters<typeof pricingTableHtml>[0]): void {
  editor.chain().focus().insertContent(pricingTableHtml(labels)).run();
}

const toNumber = (text: string): number => {
  // Strips everything but digits/minus/decimal point, so "$1,250.50" or "Rp 1.250" still parse.
  const cleaned = text.replace(/[^\d.-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
};

const formatNumber = (n: number): string => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export type CellEdit = { from: number; to: number; text: string };

/**
 * Pure ProseMirror-position math, kept separate from the live-editor glue below so it's testable
 * without a DOM (constructing a `Node` tree directly, the way tests/pricingTable.test.ts does,
 * needs no `EditorView`/jsdom). Returns the text edits to make Total = Qty × Unit Price hold for
 * every data row plus the grand-total footer cell, or null if `tablePos` isn't a 4-column table
 * shaped like `pricingTableHtml` above (header + at least one data row + footer).
 */
export function computePricingTableEdits(doc: PMNode, tablePos: number): { edits: CellEdit[]; grandTotal: number } | null {
  const tableNode = doc.nodeAt(tablePos);
  if (!tableNode || tableNode.type.name !== 'table') return null;

  // Absolute positions of each cell's own text range. A cell's content is a block (normally one
  // paragraph), so the text itself starts one level deeper than the cell node — `nodesBetween`
  // gives correct absolute positions for that nesting without manual offset arithmetic.
  type Cell = { from: number; to: number; text: string };
  const rows: Cell[][] = [];
  let currentRow: Cell[] | null = null;
  doc.nodesBetween(tablePos, tablePos + tableNode.nodeSize, (node, pos) => {
    if (node.type.name === 'tableRow') {
      currentRow = [];
      rows.push(currentRow);
      return true;
    }
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      // Every cell should have a paragraph child (TipTap fills empty cells with one on parse);
      // `para` stays null only for a cell shape this function doesn't know how to touch safely.
      const para = node.firstChild?.isTextblock ? node.firstChild : null;
      const from = para ? pos + 2 : -1;
      const to = para ? from + para.content.size : -1;
      currentRow?.push({ from, to, text: node.textContent });
      return false; // don't recurse into the cell — we already have what we need
    }
    return node.type.name === 'table';
  });

  // Fewer than 3 rows (header + at least one item + footer) — nothing meaningful to total.
  if (rows.length < 3 || rows.some((r) => r.length < 4 || r.some((c) => c.from === -1))) return null;

  const dataRows = rows.slice(1, -1);
  const footerRow = rows[rows.length - 1];

  const edits: CellEdit[] = [];
  let grandTotal = 0;
  for (const row of dataRows) {
    const qty = toNumber(row[1].text);
    const unitPrice = toNumber(row[2].text);
    const total = qty * unitPrice;
    grandTotal += total;
    edits.push({ from: row[3].from, to: row[3].to, text: formatNumber(total) });
  }
  edits.push({ from: footerRow[3].from, to: footerRow[3].to, text: formatNumber(grandTotal) });

  return { edits, grandTotal };
}

/**
 * Recomputes Total = Qty × Unit Price for every data row of the pricing table the cursor is
 * currently inside, and sums those totals into the last row's last cell. Returns false (and
 * changes nothing) if the cursor isn't inside a 4-column table.
 */
export function recalculatePricingTable(editor: Editor): boolean {
  const { state, view } = editor;
  const { $from } = state.selection;

  let tablePos = -1;
  for (let depth = $from.depth; depth >= 0; depth--) {
    if ($from.node(depth).type.name === 'table') {
      tablePos = $from.before(depth);
      break;
    }
  }
  if (tablePos === -1) return false;

  const result = computePricingTableEdits(state.doc, tablePos);
  if (!result) return false;

  let tr = state.tr;
  for (const edit of result.edits) {
    tr = tr.insertText(edit.text, tr.mapping.map(edit.from), tr.mapping.map(edit.to));
  }
  view.dispatch(tr);
  return true;
}
