import type { Sql } from './db';
import { MAIL_CATALOG, isMailTemplateId, renderMailTemplate, validateMailTemplate, type MailTemplate, type MailTemplateId } from '@legalio/shared/mailTemplates';

export function createMailTemplateStore(db: Sql) {
  const get = async (id: MailTemplateId) => {
    const row = await db.get('SELECT subject, html, version, updated_at AS updatedAt FROM mail_templates WHERE id = ?', id) as (MailTemplate & { version: number; updatedAt: string }) | undefined;
    return row || { ...MAIL_CATALOG[id].defaults, version: 0, updatedAt: null };
  };
  return {
    init: () => db.exec(`CREATE TABLE IF NOT EXISTS mail_templates (id TEXT PRIMARY KEY, subject TEXT NOT NULL, html TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL)`),
    get,
    list: async () => {
      const templates = [];
      for (const id of Object.keys(MAIL_CATALOG)) templates.push({ id, ...await get(id as MailTemplateId) });
      return templates;
    },
    async save(id: string, template: unknown, expectedVersion: unknown) {
      if (!isMailTemplateId(id)) throw Object.assign(new Error('Template tidak ditemukan.'), { status: 404 });
      try { validateMailTemplate(id, template); } catch (error) { throw Object.assign(error as Error, { status: 400 }); }
      if (!Number.isInteger(expectedVersion) || (expectedVersion as number) < 0) throw Object.assign(new Error('Versi template tidak valid.'), { status: 400 });
      return db.tx(async () => {
        if ((await get(id)).version !== expectedVersion) throw Object.assign(new Error('Template telah diubah admin lain. Muat ulang sebelum menyimpan.'), { status: 409 });
        await db.run(`INSERT INTO mail_templates (id, subject, html, version, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET subject=excluded.subject, html=excluded.html, version=excluded.version, updated_at=excluded.updated_at`, id, template.subject, template.html, (expectedVersion as number) + 1, new Date().toISOString());
        return get(id);
      });
    },
    render: async (id: MailTemplateId, values: Record<string, string>, trustedHtmlKeys: string[] = []) => renderMailTemplate(await get(id), values, trustedHtmlKeys),
  };
}
