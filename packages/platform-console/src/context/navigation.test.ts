import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

// The URL helpers read window.location; a stand-in is enough for them.
type Fake = { location: { pathname: string; search: string; hash: string } };
const setUrl = (pathname: string, search: string, hash = '') => { (globalThis as unknown as { window: Fake }).window = { location: { pathname, search, hash } }; };
beforeEach(() => setUrl('/app', ''));
afterEach(() => { delete (globalThis as { window?: unknown }).window; });

const nav = await import('./NavigationContext');

test('?tab= keeps working exactly as before: lower-cased, validated, bookmarkable', () => {
  setUrl('/app', '?tab=Contracts');
  assert.equal(nav.readTabFromUrl(), 'contracts');
  setUrl('/', '?tab=ios');
  assert.equal(nav.readTabFromUrl(), 'ios');
  setUrl('/app', '?tab=<script>');
  assert.equal(nav.readTabFromUrl(), null);
  setUrl('/other', '?tab=contracts');
  assert.equal(nav.readTabFromUrl(), null);
});

test('a record deep link is read from ?id=, validated, and never outlives its page', () => {
  setUrl('/app', '?tab=contracts&id=C0001');
  assert.equal(nav.readTabFromUrl(), 'contracts');
  assert.equal(nav.readRecordFromUrl(), 'C0001');
  setUrl('/app', '?tab=partner-evaluation&id=EVAL-2026-004');
  assert.equal(nav.readRecordFromUrl(), 'EVAL-2026-004');
  setUrl('/app', '?tab=contracts&id=%3Cscript%3E');
  assert.equal(nav.readRecordFromUrl(), null);
  setUrl('/app', '?tab=contracts&id=C0001&accept_invite=abc');
  assert.equal(nav.buildAppUrl('ios'), '/app?tab=ios&accept_invite=abc', 'moving to another page drops the record, keeps unrelated parameters');
  assert.equal(nav.buildAppUrl('contracts', '/app', 'C0002'), '/app?tab=contracts&id=C0002&accept_invite=abc');
  assert.equal(nav.buildAppUrl('contracts', '/app', 'bad id'), '/app?tab=contracts&accept_invite=abc');
});
