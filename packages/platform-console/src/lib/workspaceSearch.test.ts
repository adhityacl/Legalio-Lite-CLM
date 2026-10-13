import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Contract, InsertionOrder, Partner, PartnerEvaluation, PartnerSpending, UserSession } from '@legalio/types';
import { buildWorkspaceSearchResults, matchesWorkspaceSearch } from './workspaceSearch';

test('vendor search links all record types, respects workspace and viewer visibility, and keeps aliases', () => {
  const partner = { partner_id: 'p1', organizationId: 'org1', nama_partner: 'PT Ácme Digital' } as Partner;
  const contract = { contract_id: 'c1', organizationId: 'org1', partner_id: 'p1', partner_nama: 'Legacy Acme', nomor_kontrak: 'CTR-1', judul_kontrak: 'Services', status_approval: 'Signed' } as Contract;
  const data: Parameters<typeof buildWorkspaceSearchResults>[0] = {
    organizationId: 'org1',
    partners: [partner, { ...partner, organizationId: 'org2', nama_partner: 'Private Vendor' }],
    contracts: [contract, { ...contract, contract_id: 'draft', status_approval: 'Draft' }, { ...contract, contract_id: 'foreign', organizationId: 'org2' }],
    ios: [{ io_id: 'io1', organizationId: 'org1', contract_id: 'c1', nomor_io: 'SO-1', judul_io: 'Delivery' } as InsertionOrder],
    spendings: [{ id: 's1', organizationId: 'org1', vendor_id: 'p1', vendor_name: 'Legacy Acme', invoice_number: 'INV-1', invoice_date: '2026-01-01' } as PartnerSpending],
    evaluations: [{ id: 'e1', organizationId: 'org1', partner_id: 'p1', supplier_name: 'Legacy Acme', type_of_work: 'Annual review', review_date: '2025-01-01' } as PartnerEvaluation],
  };
  const user = { email: 'viewer@example.com', role: 'viewer' } as UserSession;
  const results = buildWorkspaceSearchResults(data, user);
  assert.deepEqual(results.map(item => item.kind), ['contract', 'io', 'spending', 'evaluation']);
  assert(results.every(item => matchesWorkspaceSearch(`${item.label} ${item.description} ${item.keywords}`, 'ACME digital')));
  assert(results.every(item => !item.description.includes('Private Vendor')));
  assert(results.some(item => matchesWorkspaceSearch(`${item.description} ${item.keywords}`, 'legacy acme')));
  assert.equal(buildWorkspaceSearchResults(data, { ...user, role: 'admin' }).filter(item => item.kind === 'contract').length, 2);
  assert.deepEqual(buildWorkspaceSearchResults(data, null), []);
  assert.deepEqual(buildWorkspaceSearchResults({ ...data, organizationId: '' }, user), []);
  assert(matchesWorkspaceSearch('Crème Contract 123', 'contract creme'));
  assert(matchesWorkspaceSearch('Contract 123', 'ＣＯＮＴＲＡＣＴ'));
  assert(matchesWorkspaceSearch('供应商合同', '供应商'));
  assert(!matchesWorkspaceSearch('Acme invoice', 'Acme contract'));
});
