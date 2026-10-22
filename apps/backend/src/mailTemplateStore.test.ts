import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { MAIL_CATALOG, renderMailTemplate, validateMailTemplate, type MailTemplateId } from '@legalio/shared/mailTemplates';
import { createMailTemplateStore } from './mailTemplateStore';
import { sql } from './db';
import { ensureSchema } from './schema';
import { createTestDatabase } from './testDatabase';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
before(async () => { database = await createTestDatabase(); await ensureSchema(); });
after(() => database?.drop());

test('every outgoing template renders, validates variables and persists versioned edits', async () => {
  {
    const store = createMailTemplateStore(sql);
    assert.equal((await store.list()).length, 5);
    for (const id of Object.keys(MAIL_CATALOG) as MailTemplateId[]) {
      const entry = MAIL_CATALOG[id];
      validateMailTemplate(id, entry.defaults);
      const rendered = await store.render(id, entry.sample, ['details']);
      assert.ok(rendered.subject); assert.ok(rendered.html);
      assert.doesNotMatch(rendered.subject + rendered.html, /{{/);
    }
    await assert.rejects(store.save('missing', {}, 0), /ditemukan/);
    await assert.rejects(store.save('verification', { subject: 'Missing link', html: '<p>Hi</p>' }, 0), /url/);
    await assert.rejects(store.save('verification', { subject: 'Bad\r\nheader', html: '{{url}}' }, 0), /Subjek/);
    await assert.rejects(store.save('verification', { subject: '{{unknown}}', html: '{{url}}' }, 0), /tidak dikenal/);
    await assert.rejects(store.save('verification', { subject: '{{name', html: '{{url}}' }, 0), /Format/);
    const draft = { subject: 'Welcome {{name}}', html: '<p>{{name}}</p><a href="{{url}}">Verify</a>' };
    const saved = await store.save('verification', draft, 0);
    assert.equal(saved.version, 1);
    assert.equal((await createMailTemplateStore(sql).get('verification')).subject, draft.subject);
    assert.equal((await store.render('verification', { name: '<script>"&', url: 'https://example.com/?x=1&y=2' })).html, '<p>&lt;script&gt;&quot;&amp;</p><a href="https://example.com/?x=1&amp;y=2">Verify</a>');
    await assert.rejects(store.save('verification', draft, 0), /admin lain/);
    assert.equal((await store.get('verification')).version, 1);
    assert.equal((await store.save('verification', MAIL_CATALOG.verification.defaults, 1)).version, 2);
    assert.throws(() => renderMailTemplate({ subject: '{{absent}}', html: '' }, {}), /tidak tersedia/);
  }
});

test('concurrent first saves of a template: one wins, the other gets a version conflict', async () => {
  const store = createMailTemplateStore(sql);
  const draft = MAIL_CATALOG.invitation.defaults;
  const results = await Promise.allSettled([store.save('invitation', draft, 0), store.save('invitation', draft, 0)]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal((await store.get('invitation')).version, 1);
});
