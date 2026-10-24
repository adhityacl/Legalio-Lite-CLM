import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { bootApp, type Harness } from './testHarness';

let h: Harness;
const ids: Record<string, string> = {};
const prompts: string[] = [];
let seenContents: any[] = [];
let answer: (prompt: string) => string = () => 'OK';

const ORG_A = 'org-a';
before(async () => {
  h = await bootApp({
    tag: 'retrieval', orgs: [{ id: 'org-a', name: 'Org A' }, { id: 'org-b', name: 'Org B' }],
    users: [['adminA', 'org-a', 'admin'], ['legalA', 'org-a', 'editor', 'Legal'], ['financeA', 'org-a', 'editor', 'Finance'], ['adminB', 'org-b', 'admin']],
    env: { AI_ORG_DAILY_CALLS: '1000', AI_ORG_CALLS_PER_MINUTE: '1000', AI_CHAT_HISTORY_MESSAGES: '6' },
  });
  const { setAiGenerator } = await import('./aiClient');
  // The fake model records what it is sent and answers with whatever the test configured: no network, no key.
  setAiGenerator(async ({ params }) => {
    // What the model is told about the workspace (the system instruction); the conversation itself is in `seenContents`.
    const prompt = String(params.config?.systemInstruction ?? '');
    prompts.push(prompt);
    seenContents = params.contents;
    return { text: answer(prompt), usageMetadata: { totalTokenCount: 10 } };
  });

  const seed = async (key: string, user: string, org: string, dept: string, extra: { note?: string } = {}) => {
    const partner = await h.api(user, 'POST', '/api/partners', { org, body: { partner_name: `${key} Partner Orchard`, internal_pic: dept, country: 'ID', pic_name: 'Contact Person', pic_email: `secret-${key}@example.com`, pic_phone: '+6281234567890', notes: extra.note ?? '' } });
    assert.ok(partner.status < 300, partner.raw);
    ids[`partner-${key}`] = partner.body.partner.partner_id;
    const contract = await h.api(user, 'POST', '/api/contracts', { org, body: { partner_id: ids[`partner-${key}`], contract_number: `${key.toUpperCase()}-1`, contract_title: `${key} Orchard master agreement`, start_date: '2026-01-01', end_date: '2099-12-31', currency: 'USD', contract_value: 100, internal_notes: extra.note ?? '' } });
    assert.ok(contract.status < 300, contract.raw);
    ids[`contract-${key}`] = contract.body.contract.contract_id;
  };
  await seed('legal', 'adminA', 'org-a', 'Legal', { note: 'legal-only-keyword quokka' });
  await seed('finance', 'adminA', 'org-a', 'Finance', { note: 'finance-only-keyword narwhal' });
  await seed('b', 'adminB', 'org-b', 'Legal', { note: 'tenant-b-keyword pangolin' });
});
after(async () => { (await import('./aiClient')).setAiGenerator(null); await h?.close(); });

const chat = (user: string, query: string, history: Array<{ role: string; text: string }> = []) =>
  h.api(user, 'POST', '/api/chat', { org: user.endsWith('B') ? 'org-b' : ORG_A, body: { query, history } });
const lastPrompt = () => prompts[prompts.length - 1] ?? '';

test('pure: terms, the tsquery and citations', async () => {
  const { searchTerms, toTsQuery, citedRefs } = await import('./retrieval');
  assert.deepEqual(searchTerms('What is the Orchard agreement with Acme?').words, ['orchard', 'acme'], '"agreement" matches every record, so it is dropped');
  assert.deepEqual(searchTerms('Show me the contract and the agreement').words, ['contract', 'agreement'], 'but a question made only of common words keeps them');
  assert.deepEqual(searchTerms('the contract').words, ['contract']);
  assert.deepEqual(searchTerms('Perjanjian kontrak dengan Orchard').words, ['orchard']);
  assert.deepEqual(searchTerms('合同 contract').words, [], 'a CJK term counts as something specific');
  assert.deepEqual(searchTerms('the of and').words, [], 'stop words alone give nothing');
  assert.deepEqual(searchTerms('Q3 report of s1').words, ['q3', 'report', 's1']);
  assert.deepEqual(searchTerms('and its notes?', ['Tell me about the zebrafish contract']).words, ['notes', 'zebrafish']);
  assert.deepEqual(searchTerms('合同到期').cjk, ['合同', '同到', '到期']);
  assert.equal(toTsQuery(['a1', 'b2']), 'a1:* | b2:*');
  assert.deepEqual(searchTerms("x'); DROP TABLE users; --").words, ['drop', 'table', 'users'], 'only letters and digits survive: nothing can reach the tsquery syntax');
  assert.equal(searchTerms('word '.repeat(100)).words.length, 1);
  const known = new Set(['S1', 'S2', 'S3']);
  assert.deepEqual([...citedRefs('Yes [S1] and [S2, S3]. Also [S9] and [S1][S3].', known)].sort(), ['S1', 'S2', 'S3']);
  assert.equal(citedRefs('No brackets S1 here', known).size, 0);
});

test('the migration created the full-text indexes the queries rely on', async () => {
  const rows = await h.sql.all<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE indexname LIKE 'idx_retrieval_fts_%' ORDER BY 1`);
  assert.deepEqual(rows.map((r) => r.indexname), ['idx_retrieval_fts_clauses', 'idx_retrieval_fts_contract_documents', 'idx_retrieval_fts_contract_key_terms', 'idx_retrieval_fts_obligations', 'idx_retrieval_fts_search_records']);
});

test('the retrieval query is index-assisted: the planner can use the GIN full-text index of the search records', async () => {
  const { RETRIEVAL_TEXT } = await import('./retrievalText');
  // A table big enough for the planner to prefer the index over a scan.
  await h.sql.exec(`INSERT INTO search_records (organization_id, entity_type, entity_id, title, body)
    SELECT 'perf-org', 'contracts', 'PERF-' || n, 'Agreement number ' || n, 'standard notes ' || n || ' filler words for the index' FROM generate_series(1, 4000) AS n`);
  await h.sql.exec('ANALYZE search_records');
  const plan = await h.sql.all<Record<string, string>>(`EXPLAIN SELECT entity_id FROM search_records WHERE to_tsvector('simple', ${RETRIEVAL_TEXT.search_records}) @@ to_tsquery('simple', 'zebrafish:*')`);
  await h.sql.run(`DELETE FROM search_records WHERE organization_id = 'perf-org'`);
  assert.ok(plan.map((r) => Object.values(r)[0]).join('\n').includes('idx_retrieval_fts_search_records'), JSON.stringify(plan));
});

test('answers carry sources: id, type, title and deep link of every record the model was given, and the ones it cited', async () => {
  answer = () => 'The agreement is the first one [S1].';
  const reply = await chat('adminA', 'Tell me about the Orchard master agreement');
  assert.equal(reply.status, 200, reply.raw);
  assert.equal(reply.body.success, true);
  const sources = reply.body.sources as any[];
  assert.ok(sources.length >= 2);
  for (const source of sources) {
    assert.deepEqual(Object.keys(source).sort(), ['cited', 'id', 'origin', 'param', 'ref', 'score', 'subtitle', 'tab', 'title', 'type']);
    assert.match(source.ref, /^S\d+$/);
  }
  const contracts = sources.filter((s) => s.type === 'contract');
  assert.deepEqual(contracts.map((s) => s.id).sort(), [ids['contract-finance'], ids['contract-legal']].sort());
  const legal = contracts.find((s) => s.id === ids['contract-legal']);
  assert.equal(legal.tab, 'contracts');
  assert.equal(legal.param, 'id');
  assert.match(legal.title, /LEGAL-1 · legal Orchard master agreement/);
  assert.equal(legal.subtitle, 'legal Partner Orchard');
  assert.equal(sources.find((s) => s.ref === 'S1').cited, true);
  assert.equal(sources.filter((s) => s.cited).length, 1);
  // The model was given the ref next to each record.
  assert.match(lastPrompt(), /"ref":"S1"/);
  assert.match(lastPrompt(), /BEGIN-WORKSPACE-JSON/);
  assert.ok(!/tenant-b-keyword|Orchard B/.test(lastPrompt()));
});

test('records come from a search, not a dump: unrelated records are not sent and a precise question finds its record', async () => {
  answer = () => 'ok';
  const reply = await chat('adminA', 'quokka');
  const matches = (reply.body.sources as any[]).filter((s) => s.origin === 'match');
  assert.deepEqual(matches.map((s) => s.id).sort(), [ids['contract-legal'], ids['partner-legal']].sort(), 'only the records whose notes mention the word match');
  assert.ok(/quokka/.test(lastPrompt()));
  assert.ok(!/narwhal/.test(lastPrompt()), 'a record that does not match is not in the prompt');
  const none = await chat('adminA', 'xylophone');
  assert.equal((none.body.sources as any[]).filter((s) => s.origin === 'match').length, 0);
  assert.match(lastPrompt(), /No record matched the words of the question/);
});

test('department scope: a restricted user never receives records of other departments, in sources or in the prompt', async () => {
  answer = () => 'ok';
  const legal = await chat('legalA', 'Orchard master agreement');
  assert.equal(legal.status, 200, legal.raw);
  const legalIds = (legal.body.sources as any[]).map((s) => s.id);
  assert.ok(legalIds.includes(ids['contract-legal']));
  assert.ok(!legalIds.includes(ids['contract-finance']) && !legalIds.includes(ids['partner-finance']), JSON.stringify(legal.body.sources));
  assert.ok(!/narwhal|finance Orchard|Finance Partner|FINANCE-1/.test(lastPrompt()), 'nothing of the Finance department in the prompt');
  assert.ok(!/tenant-b-keyword|pangolin/.test(lastPrompt()));

  // A word that exists only in another department's record finds nothing, and does not leak through the counts either.
  await chat('legalA', 'narwhal');
  assert.ok(!/narwhal|FINANCE-1/.test(lastPrompt()));
  assert.match(lastPrompt(), /No record matched/);
  const counts = JSON.parse(/"record_counts":(\{[^}]*\})/.exec(lastPrompt())![1]);
  assert.deepEqual(counts, { contracts: 1, partners: 1, commercial_documents: 0 }, 'counts cover what this user may see only');

  const finance = await chat('financeA', 'Orchard master agreement');
  const financeIds = (finance.body.sources as any[]).map((s) => s.id);
  assert.ok(financeIds.includes(ids['contract-finance']) && !financeIds.includes(ids['contract-legal']));
  assert.ok(!/quokka|LEGAL-1/.test(lastPrompt()));

  // Past candidates of other departments: with many matching Finance records the Legal user still gets the own record.
  for (let i = 0; i < 30; i++) {
    await h.api('adminA', 'POST', '/api/contracts', { org: ORG_A, body: { partner_id: ids['partner-finance'], contract_number: `FIN-BULK-${i}`, contract_title: `Orchard orchard orchard bulk ${i}`, start_date: '2026-01-01', end_date: '2099-12-31', currency: 'USD', contract_value: 1, internal_notes: 'orchard orchard orchard orchard' } });
  }
  const crowded = await chat('legalA', 'orchard orchard orchard');
  const crowdedIds = (crowded.body.sources as any[]).map((s) => s.id);
  assert.ok(crowdedIds.includes(ids['contract-legal']), 'own records are not crowded out by other departments');
  assert.ok(!/FIN-BULK/.test(lastPrompt()), 'and none of the other department leaks');
  // The organization admin sees both departments.
  const admin = await chat('adminA', 'orchard');
  assert.ok((admin.body.sources as any[]).some((s) => /FIN-BULK|FINANCE-1/.test(s.title)));
});

test('tenants: another organization never appears, whoever asks', async () => {
  answer = () => 'ok';
  const b = await chat('adminB', 'Orchard pangolin');
  assert.deepEqual((b.body.sources as any[]).filter((s) => s.origin === 'match').map((s) => s.id).sort(), [ids['contract-b']].filter(Boolean).concat(ids['partner-b']).filter(Boolean).sort().filter((id) => id !== undefined && [ids['contract-b'], ids['partner-b']].includes(id)).sort());
  assert.ok(!/quokka|narwhal|LEGAL-1|FINANCE-1/.test(lastPrompt()));
  const all = (b.body.sources as any[]).map((s) => s.id);
  assert.ok(![ids['contract-legal'], ids['contract-finance'], ids['partner-legal'], ids['partner-finance']].some((id) => all.includes(id)));
  // The other way round: org A asking for org B's keyword.
  await chat('adminA', 'pangolin tenant-b-keyword');
  assert.ok(!/pangolin|tenant-b-keyword|ORG B|b Orchard/i.test(lastPrompt().replace(/Org A/g, '')), 'org B text is not in org A prompts');
  const stray = await chat('adminA', `${ids['contract-b']}`);
  assert.ok(!(stray.body.sources as any[]).some((s) => s.id === ids['contract-b']));
});

test('every kind of record can be retrieved with its own deep link: obligations, clauses, key terms and editor documents', async () => {
  answer = () => 'ok';
  const legalContract = ids['contract-legal'];
  const obligation = await h.api('adminA', 'POST', '/api/obligations', { org: ORG_A, body: { title: 'Deliver the zebrafish report', contract_id: legalContract, due_date: '2099-01-01', description: 'Contact legal@example.com or +62 812 3456 7890' } });
  assert.equal(obligation.status, 201, obligation.raw);
  const clause = await h.api('adminA', 'POST', '/api/clauses', { org: ORG_A, body: { title: 'Zebrafish indemnity', category: 'Liability', approved_text: 'The supplier indemnifies.' } });
  const document = await h.api('adminA', 'POST', '/api/documents', { org: ORG_A, body: { name: 'Zebrafish service draft', type: 'contract', content: '<h1>Services</h1><p>The zebrafish services are provided by ops@example.com within <b>30 days</b>.</p>' } });
  assert.ok(document.status < 300, document.raw);
  await h.sql.run(`INSERT INTO contract_key_terms (id, organization_id, contract_id, term_key, label, value, summary, source_quote, source_page, created_at, updated_at) VALUES ('kt-1', 'org-a', ?, 'governing_law', 'Zebrafish law', 'Singapore', 'Laws of Singapore', 'governed by the laws of Singapore', 2, now()::text, now()::text)`, legalContract);

  const reply = await chat('adminA', 'zebrafish');
  const sources = reply.body.sources as any[];
  const byType = Object.fromEntries(sources.map((s) => [s.type, s]));
  assert.equal(byType.obligation.id, obligation.body.obligation.id);
  assert.deepEqual([byType.obligation.tab, byType.obligation.param], ['obligations', 'id']);
  assert.deepEqual([byType.clause.id, byType.clause.tab], [clause.body.clause.id, 'clauses']);
  assert.deepEqual([byType.document.id, byType.document.tab, byType.document.param], [document.body.id, 'create-contract', 'document']);
  assert.deepEqual([byType.key_term.id, byType.key_term.tab], [legalContract, 'contracts'], 'a key term opens its contract');
  // Identifiers are scrubbed from free text; HTML tags are not shown to the model.
  const prompt = lastPrompt();
  assert.ok(!/legal@example\.com|ops@example\.com|3456 7890/.test(prompt), 'e-mail addresses and phone numbers in free text are removed');
  assert.match(prompt, /\[email\]/);
  assert.ok(!/<h1>|<\/b>/.test(prompt));
  assert.match(prompt, /«zebrafish» services are provided/i, 'the matching words are marked, the rest is plain text');

  // The Finance department has no right to the Legal contract's obligation, key term or documents of... the organization's documents are organization-wide.
  await chat('financeA', 'zebrafish');
  const financePrompt = lastPrompt();
  assert.ok(!/Deliver the zebrafish report|Zebrafish law/.test(financePrompt), 'obligation and key term belong to a Legal contract');
  assert.match(financePrompt, /Zebrafish indemnity/, 'the clause library is organization reference data');
  // The person responsible may see their own obligation whatever the department.
  const mine = await h.api('adminA', 'POST', '/api/obligations', { org: ORG_A, body: { title: 'Quasar review for finance', contract_id: legalContract, due_date: '2099-02-02', responsible_user_id: 'financeA' } });
  assert.equal(mine.status, 201, mine.raw);
  await chat('financeA', 'quasar');
  assert.match(lastPrompt(), /Quasar review for finance/);
  await chat('legalA', 'quasar');
  assert.match(lastPrompt(), /Quasar review for finance/, 'and the Legal department owns the contract it hangs on');
});

test('privacy: contacts and full bank numbers never reach the model; bank accounts are masked', async () => {
  answer = () => 'ok';
  const spending = await h.api('adminA', 'POST', '/api/partner-spendings', { org: ORG_A, body: { vendor_id: ids['partner-legal'], vendor_name: 'legal Partner Orchard', invoice_number: 'INV-777', invoice_date: '2026-10-01', invoice_month: ['2026-10-31'], currency: 'USD', total_amount: 250, bank_name: 'BCA', bank_account_number: '1234567890123456' } });
  assert.ok(spending.status < 300, spending.raw);
  const reply = await chat('adminA', 'INV-777 invoice');
  assert.ok((reply.body.sources as any[]).some((s) => s.type === 'spending' && /INV-777/.test(s.title)));
  const prompt = lastPrompt();
  assert.ok(!/1234567890123456/.test(prompt) && /3456/.test(prompt), 'only the last digits of the account number');
  assert.ok(!/secret-legal@example\.com|6281234567890|Contact Person@/.test(prompt), 'partner contact e-mail and phone are withheld');
  assert.match(prompt, /intentionally withheld for privacy/);
});

test('history is capped, a follow-up keeps its subject, and each question uses one call of the organization budget', async () => {
  answer = () => 'ok';
  const used = async () => Number((await h.sql.get<{ calls: number }>(`SELECT COALESCE(SUM(calls), 0) AS calls FROM ai_usage WHERE organization_id = 'org-a'`))?.calls ?? 0);
  const before = await used();
  const history = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'ai' : 'user', text: i === 18 ? 'Tell me about quokka please' : `message ${i}` }));
  const reply = await chat('adminA', 'and what do its notes say?', history);
  assert.equal(reply.status, 200);
  assert.ok(seenContents.length <= 7, `history capped at AI_CHAT_HISTORY_MESSAGES plus the question (${seenContents.length})`);
  assert.equal(await used(), before + 1);
  assert.ok((reply.body.sources as any[]).some((s) => s.id === ids['contract-legal']), 'the follow-up searched with the words of the previous question');
});

test('chat is off when the AI module is disabled, and a missing question is refused', async () => {
  assert.equal((await chat('adminA', '')).status, 400);
});
