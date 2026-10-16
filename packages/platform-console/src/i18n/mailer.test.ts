import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAILER_TRANSLATIONS } from './mailer';
import { MAIL_CATALOG, MailTemplateError, validateMailTemplate } from '@legalio/shared/mailTemplates';

test('Mailer translations cover every catalog, toolbar and validation key in all three languages', () => {
  const keys = Object.keys(MAILER_TRANSLATIONS.ID);
  for (const language of ['ID', 'EN', 'ZH'] as const) {
    const dictionary = MAILER_TRANSLATIONS[language] as Record<string, string>;
    assert.deepEqual(Object.keys(dictionary).sort(), [...keys].sort());
    assert.ok(Object.values(dictionary).every(value => value.trim().length > 0));
    for (const id of Object.keys(MAIL_CATALOG)) for (const field of ['name', 'description', 'recipient', 'trigger']) {
      assert.ok(dictionary[`mailer.catalog.${id}.${field}`]);
    }
    for (const command of ['bold','italic','underline','insertUnorderedList','insertOrderedList','justifyLeft','justifyCenter','justifyRight','undo','redo']) assert.ok(dictionary[`mailer.toolbar.${command}`]);
    assert.ok(dictionary['mailer.toolbar.url_hint'].includes('{{url}}'));
    for (const key of ['unknown_variable','required_variable','missing_variable']) assert.ok(dictionary[`mailer.error.${key}`].includes('{variable}'));
  }
  for (const value of [{subject:'',html:'{{url}}'},{subject:'Hello',html:'Hi'},{subject:'{{unknown}}',html:'{{url}}'}]) {
    assert.throws(() => validateMailTemplate('verification', value), (error: unknown) => {
      assert.ok(error instanceof MailTemplateError);
      for (const language of ['ID','EN','ZH'] as const) assert.ok((MAILER_TRANSLATIONS[language] as Record<string,string>)[error.key]);
      return true;
    });
  }
});
