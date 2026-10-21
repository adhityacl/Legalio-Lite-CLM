import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindSelectionToUser, getSelectionRevision, setSelectedOrganizationId } from './organizationSelection';

test('re-selecting the same organization keeps the revision; a change bumps it', () => {
  bindSelectionToUser(null);
  setSelectedOrganizationId('org1');
  const revision = getSelectionRevision();
  setSelectedOrganizationId('org1');
  assert.equal(getSelectionRevision(), revision);
  setSelectedOrganizationId('org2');
  assert.equal(getSelectionRevision(), revision + 1);
});
