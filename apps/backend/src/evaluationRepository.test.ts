/** Evaluation-specific repository behaviour on real PostgreSQL: list filters/search/sorting, duplicate lookup, partner detach. */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legalio-evaluation-repo-'));
Object.assign(process.env, { APP_TEST_MODE: '1', APP_DATA_DIR: dir, BETTER_AUTH_ENABLE_INFRA: 'false', LOG_LEVEL: 'silent' });
const { sql } = await import('./db');
const { createTestDatabase } = await import('./testDatabase');
const { ensureSchema } = await import('./schema');
const { evaluationRepository } = await import('./repositories/evaluationRepository');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); await ensureSchema(); });
after(async () => { await database?.drop(); fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(async () => {
  await sql.exec(`TRUNCATE organization, search_records CASCADE`);
  await sql.exec(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ('org-a', 'A', 'a', now()), ('org-b', 'B', 'b', now())`);
  await sql.exec(`INSERT INTO partners (partner_id, organization_id, record_position) VALUES ('p1', 'org-a', 0), ('p2', 'org-b', 0)`);
});
const evaluation = (id: string, org = 'org-a', extra: Record<string, unknown> = {}) => ({ id, organizationId: org, partner_id: org === 'org-a' ? 'p1' : 'p2', supplier_name: `Supplier ${id}`, review_date: '2026-01-01', calculated_score: 50, final_evaluation: 'Recommended', ...extra });

test('list: newest first, filters, text search, sorting by date/score, paging with the total, no leaks across organizations', async () => {
  await evaluationRepository.insert(evaluation('E1', 'org-a', { review_date: '2026-03-01', calculated_score: 90, notes: 'orchard delivery' }));
  await evaluationRepository.insert(evaluation('E2', 'org-a', { review_date: '2026-01-01', calculated_score: 10, final_evaluation: 'Not recommended', partner_id: null }));
  await evaluationRepository.insert(evaluation('E3', 'org-a', { review_date: '2026-02-01', calculated_score: 60 }));
  await evaluationRepository.insert(evaluation('E4', 'org-b', { notes: 'orchard other tenant' }));
  assert.deepEqual((await evaluationRepository.list('org-a')).rows.map((r) => r.id), ['E3', 'E2', 'E1']);
  assert.deepEqual((await evaluationRepository.list('org-a', { finalEvaluation: ['Not recommended'] })).rows.map((r) => r.id), ['E2']);
  assert.deepEqual((await evaluationRepository.list('org-a', { partnerId: ['p1'] })).rows.map((r) => r.id).sort(), ['E1', 'E3']);
  assert.deepEqual((await evaluationRepository.list('org-a', { q: 'orchard' })).rows.map((r) => r.id), ['E1']);
  assert.equal((await evaluationRepository.list('org-a', { q: 'other tenant' })).total, 0);
  assert.deepEqual((await evaluationRepository.list('org-a', { sort: 'total_score', dir: 'desc' })).rows.map((r) => r.id), ['E1', 'E3', 'E2']);
  const page = await evaluationRepository.list('org-a', { sort: 'review_date', limit: 2, offset: 1 });
  assert.deepEqual(page.rows.map((r) => r.id), ['E3', 'E1']);
  assert.equal(page.total, 3);
});

test('duplicate lookup and partner detach (the link answers null, version moves)', async () => {
  await evaluationRepository.insert(evaluation('E1', 'org-a', { supplier_name: ' Acme Ltd ', review_date: '2026-05-05' }));
  assert.equal((await evaluationRepository.findDuplicate('org-a', 'acme ltd', '2026-05-05'))?.id, 'E1');
  assert.equal(await evaluationRepository.findDuplicate('org-a', 'acme ltd', '2026-05-06'), undefined);
  assert.equal(await evaluationRepository.findDuplicate('org-b', 'acme ltd', '2026-05-05'), undefined);
  assert.equal(await evaluationRepository.detachPartner('org-a', 'p1'), 1);
  const detached = (await evaluationRepository.get('org-a', 'E1'))!;
  assert.equal(detached.partner_id, null);
  assert.equal(detached.version, 2);
});
