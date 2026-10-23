import assert from 'node:assert/strict';
import { test } from 'node:test';
import { smtpTlsOptions } from './smtpTls';

test('certificates are verified by default', () => {
  assert.deepEqual(smtpTlsOptions({}, {}), { rejectUnauthorized: true });
  assert.deepEqual(smtpTlsOptions(null, {}), { rejectUnauthorized: true });
  assert.deepEqual(smtpTlsOptions({ smtpAllowSelfSigned: false }, { SMTP_ALLOW_SELF_SIGNED: 'false' }), { rejectUnauthorized: true });
});

test('self-signed relays need an explicit env or setting', () => {
  assert.deepEqual(smtpTlsOptions({}, { SMTP_ALLOW_SELF_SIGNED: 'true' }), { rejectUnauthorized: false });
  assert.deepEqual(smtpTlsOptions({ smtpAllowSelfSigned: true }, {}), { rejectUnauthorized: false });
});
