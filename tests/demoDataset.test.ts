import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoDataset } from '@legalio/shared/data/demoDataset';

test('demo dataset is one Indonesian banking organization with 5 unique partners', () => {
  const data = buildDemoDataset();
  assert.equal(data.tenants.length, 1);
  assert.equal(data.tenants[0].settings.countryCode, 'ID');
  assert.equal(data.tenants[0].settings.industry, 'banking_investment');
  assert.equal(data.partners.length, 5);
  assert.equal(data.contracts.length, 5);
  assert.equal(data.ios.length, 5);
  assert.equal(data.allowedUsers.length, 1);
  assert.equal(data.allowedUsers[0].role, 'Admin');

  // Seeded partners are department-owned: each internal PIC is an exact department of the organization.
  const departmentNames = new Set(data.departments.map((d) => d.name));
  for (const partner of data.partners) assert.ok(departmentNames.has(partner.pic_internal), partner.pic_internal);
  assert.equal(new Set(data.departments.map((d) => d.id)).size, data.departments.length);

  const partnerIds = new Set(data.partners.map((p) => p.partner_id));
  for (const partner of data.partners) {
    assert.equal(data.contracts.filter((c) => c.partner_id === partner.partner_id).length, 1);
    assert.equal(data.ios.filter((io) => io.partner_id === partner.partner_id).length, 1);
    assert.ok(data.spendings.filter((s) => s.vendor_id === partner.partner_id).length >= 3);
  }
  for (const s of data.spendings) {
    assert.ok(partnerIds.has(s.vendor_id));
    assert.equal(s.month_allocations.reduce((sum: number, a: any) => sum + a.amount, 0), s.total_amount);
  }
  for (const key of ['nomor_kontrak', 'judul_kontrak']) assert.equal(new Set(data.contracts.map((c) => c[key])).size, 5);
  assert.equal(new Set(data.spendings.map((s) => s.invoice_number)).size, data.spendings.length);
  assert.ok(!JSON.stringify(data).match(/demo partner|synthetic|contract ?\d|invoice ?\d/i));
});
