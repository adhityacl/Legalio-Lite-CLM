import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contractLifecycle, validateContractTermination } from '@legalio/shared/contractLifecycle';
import { parseTerminationFile } from '../apps/backend/src/contractTermination';

const settings = { timezone: 'Asia/Bangkok', expiryWarningDays: 30 };
const now = new Date('2026-10-04T12:00:00Z');

test('normal lifecycle follows expiry dates; scheduled termination becomes effective on its business date', () => {
  assert.equal(contractLifecycle({ lifecycle_mode: 'normal', tanggal_berakhir: '2026-12-31' }, settings, now).status, 'Active');
  assert.equal(contractLifecycle({ lifecycle_mode: 'normal', tanggal_berakhir: '2026-10-20' }, settings, now).status, 'Expiring');
  assert.equal(contractLifecycle({ lifecycle_mode: 'normal', tanggal_berakhir: '2026-09-30' }, settings, now).status, 'Expired');
  const record = { lifecycle_mode: 'terminated' as const, termination_date: '2026-10-10', tanggal_berakhir: '2026-12-31', auto_renewal: true };
  assert.equal(contractLifecycle(record, settings, now).status, 'Active');
  assert.equal(contractLifecycle(record, settings, now).scheduled, true);
  assert.equal(contractLifecycle(record, settings, new Date('2026-10-09T17:00:00Z')).status, 'Terminated');
  assert.equal(contractLifecycle(record, settings, new Date('2027-01-01')).status, 'Terminated');
  assert.equal(contractLifecycle({ status: 'Terminated' }, settings, now).status, 'Terminated');
  assert.equal(contractLifecycle({ status: 'Terminated', lifecycle_mode: 'normal', tanggal_berakhir: '2026-12-31' }, settings, now).status, 'Active');
});

test('date validation rejects missing, impossible and out-of-period termination dates', () => {
  const record = { lifecycle_mode: 'terminated' as const, tanggal_mulai: '2026-01-01', tanggal_berakhir: '2026-12-31' };
  for (const termination_date of ['', '2026-02-30', '04/10/2026']) assert.equal(validateContractTermination({ ...record, termination_date }), 'termination.date_required');
  assert.equal(validateContractTermination({ ...record, termination_date: '2025-12-31' }), 'termination.before_start');
  assert.equal(validateContractTermination({ ...record, termination_date: '2027-01-01' }), 'termination.after_end');
  assert.equal(validateContractTermination({ ...record, termination_date: '2026-10-04' }), null);
});

test('uploaded evidence has allowed extensions, real document headers and bounded size', () => {
  const file = { fileName: 'notice.pdf', fileData: 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\nnotice').toString('base64') };
  assert.equal(parseTerminationFile(file)?.mimeType, 'application/pdf');
  assert.equal(parseTerminationFile(undefined), undefined);
  assert.throws(() => parseTerminationFile({ ...file, fileName: 'notice.html' }));
  assert.throws(() => parseTerminationFile({ ...file, fileData: 'data:application/pdf;base64,aHRtbA==' }));
  assert.throws(() => parseTerminationFile({ ...file, fileData: 'data:application/pdf;base64,' + Buffer.alloc(11 * 1024 * 1024).toString('base64') }));
});
