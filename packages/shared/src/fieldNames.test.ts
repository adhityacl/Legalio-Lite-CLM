import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEGACY_FIELD_NAMES, renameLegacyKeys, renameLegacyKeyTokens } from './fieldNames';

test('renameLegacyKeys maps Indonesian keys at any depth and keeps everything else', () => {
  const result = renameLegacyKeys({
    nama_partner: 'PT Maju', catatan: 'n', extra: 1,
    daftar_dokumen_dd: [{ nama: 'NIB', wajib: true, nomorDokumen: '1', files: [{ tanggalKadaluarsa: '2030-01-01' }] }],
  });
  assert.deepEqual(result, {
    partner_name: 'PT Maju', notes: 'n', extra: 1,
    dd_documents: [{ name: 'NIB', required: true, documentNumber: '1', files: [{ expiryDate: '2030-01-01' }] }],
  });
});

test('renameLegacyKeys prefers the new key, ignores non-plain values and never maps a name onto itself', () => {
  assert.deepEqual(renameLegacyKeys({ nomor_kontrak: 'old', contract_number: 'new' }), { contract_number: 'new' });
  assert.equal(renameLegacyKeys('nomor_kontrak'), 'nomor_kontrak');
  const date = new Date(0);
  assert.equal(renameLegacyKeys(date), date);
  assert.equal(renameLegacyKeys(null), null);
  for (const [oldName, newName] of Object.entries(LEGACY_FIELD_NAMES)) assert.notEqual(oldName, newName);
});

test('renameLegacyKeyTokens updates UI-text keys that embed a field name and leaves other keys alone', () => {
  assert.equal(renameLegacyKeyTokens('form.contract.nomor_kontrak'), 'form.contract.contract_number');
  assert.equal(renameLegacyKeyTokens('io.tanggal_mulai'), 'io.start_date');
  assert.equal(renameLegacyKeyTokens('settings.email_penerima_alert'), 'settings.email_penerima_alert');
  assert.equal(renameLegacyKeyTokens('login.title'), 'login.title');
});
