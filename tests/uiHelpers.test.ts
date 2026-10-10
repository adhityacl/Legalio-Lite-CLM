/**
 * Helpers introduced by the UI/UX audit fixes: readable text on tenant brand
 * colors, unambiguous timestamps, and reminder text in the viewer's language.
 * Run: npx tsx --test tests/uiHelpers.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readableTextOn } from '@legalio/ui-components/utils';
import { formatDateTime } from '../apps/frontend/src/lib/displayDate';
import { notificationMessage } from '../apps/frontend/src/lib/notificationText';
import type { NotificationLog } from '@legalio/types';

test('readableTextOn picks dark text on the bright brand green and white on dark colors', () => {
  assert.equal(readableTextOn('#06C755'), '#111111'); // white would be 2.26:1
  assert.equal(readableTextOn('#04803D'), '#FFFFFF');
  assert.equal(readableTextOn('#1E3A8A'), '#FFFFFF');
  assert.equal(readableTextOn('#FFF3DB'), '#111111');
  assert.equal(readableTextOn('not-a-color'), '#FFFFFF');
});

test('formatDateTime uses a month name, never an ambiguous numeric date', () => {
  const text = formatDateTime('2026-10-02T03:55:57Z', 'en-US');
  assert.match(text, /Oct/);
  assert.doesNotMatch(text, /\d{2}\/\d{2}\/\d{4}/);
  assert.equal(formatDateTime(''), '—');
  assert.equal(formatDateTime('garbage'), '—');
});

const t = (_key: string, fallback?: string, vars?: Record<string, string | number>) => {
  let text = fallback ?? '';
  for (const [k, v] of Object.entries(vars ?? {})) text = text.split(`{${k}}`).join(String(v));
  return text;
};

const base: NotificationLog = {
  notif_id: 'n1',
  parent_type: 'Contract',
  parent_id: 'c1',
  parent_nomor: 'ID/MSA/2026/01',
  parent_judul: 'MSA',
  jenis_notifikasi: 'Reminder 90d',
  tanggal_terkirim: '2026-10-02T00:00:00Z',
  status_terkirim: true,
  penerima: '',
  pesan: 'ID/MSA/2026/01 (MSA) berakhir dalam 90 hari. Pemberitahuan Termination diperlukan 30 hari sebelumnya.',
};

test('notificationMessage rebuilds reminders from structured params', () => {
  const text = notificationMessage(
    { ...base, pesan_params: { kind: 'contract', daysRemaining: 60, noticeType: 'Renewal', noticeDays: 45 } },
    t,
  );
  assert.equal(text, 'ID/MSA/2026/01 (MSA) berakhir dalam 60 hari. Pemberitahuan Renewal diperlukan 45 hari sebelumnya.');
});

test('notificationMessage keeps stored text for legacy contract reminders and manual notes', () => {
  assert.equal(notificationMessage(base, t), base.pesan);
  assert.equal(notificationMessage({ ...base, jenis_notifikasi: 'Manual', pesan: 'Catatan' }, t), 'Catatan');
});

test('notificationMessage localizes legacy commercial-document reminders from their type', () => {
  const text = notificationMessage({ ...base, parent_type: 'IO', jenis_notifikasi: 'Reminder H-30', pesan: 'x' }, t);
  assert.equal(text, 'ID/MSA/2026/01 (MSA) berakhir dalam 30 hari.');
});
