/**
 * Pricing table recalculation: the ProseMirror position math in computePricingTableEdits is the
 * one non-trivial part of tiptapPricingTable.ts, so it gets its own check against a hand-built
 * document — no DOM/editor instance needed, since prosemirror-model itself has none.
 * Run: npx tsx --test tests/pricingTable.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { computePricingTableEdits } from '../apps/frontend/src/lib/tiptapPricingTable';

// Minimal schema covering just the node shapes pricingTableHtml() produces — real cell/header
// content is 'block+' (normally one paragraph), which is the part the position math depends on.
const schema = new Schema({
  nodes: {
    doc: { content: 'table' },
    text: { group: 'inline' },
    paragraph: { content: 'text*', group: 'block', toDOM: () => ['p', 0] },
    tableCell: { content: 'block+', toDOM: () => ['td', 0] },
    tableHeader: { content: 'block+', toDOM: () => ['th', 0] },
    tableRow: { content: '(tableCell | tableHeader)+', toDOM: () => ['tr', 0] },
    table: { content: 'tableRow+', toDOM: () => ['table', 0] },
  },
});

const cell = (type: 'tableCell' | 'tableHeader', text: string) =>
  schema.nodes[type].create(null, text ? schema.nodes.paragraph.create(null, schema.text(text)) : schema.nodes.paragraph.create());
const row = (type: 'tableCell' | 'tableHeader', cells: string[]) => schema.nodes.tableRow.create(null, cells.map((c) => cell(type, c)));

function buildDoc(dataRows: Array<[string, string, string]>) {
  const header = row('tableHeader', ['Item', 'Qty', 'Unit Price', 'Total']);
  const body = dataRows.map(([item, qty, price]) => row('tableCell', [item, qty, price, '0']));
  const footer = row('tableCell', ['', '', 'Grand Total', '0']);
  const table = schema.nodes.table.create(null, [header, ...body, footer]);
  return schema.nodes.doc.create(null, table);
}

/** Reads back the text at an edit's [from, to) range in the original doc — proves the computed
 * positions actually point at the Total cells' own text (and not, say, the paragraph next to it
 * or an off-by-one neighbor), the way a passing-but-wrong position would slip through otherwise. */
function textAt(doc: ReturnType<typeof buildDoc>, from: number, to: number): string {
  return doc.textBetween(from, to);
}

test('computes Qty × Unit Price per row and sums into the grand total', () => {
  const doc = buildDoc([
    ['Hosting', '12', '50'],
    ['Support', '1', '5000'],
  ]);
  const result = computePricingTableEdits(doc, 0);
  assert.ok(result);
  assert.equal(result!.edits.length, 3); // 2 data-row totals + 1 grand total
  assert.equal(result!.grandTotal, 12 * 50 + 1 * 5000);

  // Each edit's range must currently hold the row's own (placeholder) Total cell text, "0".
  for (const edit of result!.edits) {
    assert.equal(textAt(doc, edit.from, edit.to), '0');
  }
  assert.deepEqual(result!.edits.map((e) => e.text), ['600', '5,000', '5,600']);
});

test('parses currency-formatted quantities/prices (strips everything but digits/./-)', () => {
  const doc = buildDoc([['Widget', '2', '$1,250.50']]);
  const result = computePricingTableEdits(doc, 0);
  assert.equal(result!.grandTotal, 2 * 1250.5);
});

test('returns null for a table with fewer than 4 columns', () => {
  const header = schema.nodes.tableRow.create(null, [cell('tableHeader', 'Item'), cell('tableHeader', 'Qty')]);
  const body = schema.nodes.tableRow.create(null, [cell('tableCell', 'x'), cell('tableCell', '1')]);
  const table = schema.nodes.table.create(null, [header, body]);
  const doc = schema.nodes.doc.create(null, table);
  assert.equal(computePricingTableEdits(doc, 0), null);
});

test('returns null when position is not a table node', () => {
  const doc = buildDoc([['Item', '1', '1']]);
  assert.equal(computePricingTableEdits(doc, 5), null);
});
