import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_PAGE_LAYOUT, parsePageLayout, sanitizePageLayout } from './pageLayout';

test('a layout stored with the old three-slot text becomes aligned paragraphs with page-number fields', () => {
  const layout = parsePageLayout(JSON.stringify({ header: { left: 'PT <A> & B', center: '', right: 'Rahasia' }, footer: { left: '', right: 'Hal {page}/{total}' } }));
  assert.equal(layout.header, '<p>PT &lt;A&gt; &amp; B</p><p style="text-align: right">Rahasia</p>');
  assert.equal(layout.footer, '<p style="text-align: right">Hal <span data-page-number="page"></span>/<span data-page-number="total"></span></p>');
  assert.equal(parsePageLayout(JSON.stringify({ header: { left: '', center: '', right: '' } })).header, '');
});

test('header and footer HTML is kept as given, bounded in size, and falls back for anything else', () => {
  assert.equal(sanitizePageLayout({ header: '<p>Two</p><p>lines</p>' }).header, '<p>Two</p><p>lines</p>');
  assert.equal(sanitizePageLayout({ header: 'x'.repeat(2_000_001) }).header, DEFAULT_PAGE_LAYOUT.header);
  assert.equal(sanitizePageLayout({ footer: 42 }).footer, DEFAULT_PAGE_LAYOUT.footer);
});
