import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Partner } from '@legalio/types';
import { partnerChecks } from './partnerChecks';

const existing = [{ partner_id: 'P1', partner_name: 'Acme Supplies Pte. Ltd.', identifiers: [{ scheme: 'sg_uen', value: '201912345A', country: 'SG' }] }] as Partner[];
const draft = { partner_name: 'Beta Media', country: 'ID', pic_email: 'ops@beta.co.id', identifiers: [{ scheme: 'id_nib', value: '123', country: 'ID' }] };
const keys = (checks: ReturnType<typeof partnerChecks>) => checks.map((c) => c.key);

test('a clean new partner has no findings', () => {
  assert.deepEqual(partnerChecks(draft, existing, '2026-10-20'), []);
});

test('flags a duplicate name or identifier (ignoring case and punctuation), a foreign identifier and a bad e-mail', () => {
  const dup = { partner_name: 'ACME supplies pte ltd', country: 'ID', pic_email: 'not-an-email',
    identifiers: [{ scheme: 'sg_uen', value: '2019-12345a', country: 'SG' }] };
  assert.deepEqual(keys(partnerChecks(dup, existing, '2026-10-20')), ['name', 'identifier', 'identifier_country', 'email']);
});

test('editing a partner does not match itself', () => {
  assert.deepEqual(partnerChecks({ ...draft, partner_id: 'P1', partner_name: 'Acme Supplies Pte. Ltd.' }, existing, '2026-10-20'), []);
});

test('counts DD documents expired or expiring within 30 days, not missing ones', () => {
  const dd_documents = [
    { name: 'NIB', required: true, status: 'Missing' as const },
    { name: 'NPWP', required: false, status: 'Missing' as const },
    { name: 'Deed', required: true, status: 'Expired' as const },
    { name: 'License', required: true, status: 'Available' as const, expiryDate: '2026-11-10' },
    { name: 'Permit', required: true, status: 'Available' as const, expiryDate: '2027-06-01' },
  ];
  assert.deepEqual(partnerChecks({ ...draft, dd_documents }, existing, '2026-10-20'),
    [{ key: 'dd_expiring', status: 'warn', count: 2 }]);
});
