/** The catalog covers every outgoing mail path. HTML variables are escaped by default. */
export interface MailTemplate { subject: string; html: string }
const frame = (body: string) => `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;color:#1e293b;line-height:1.6">${body}</div>`;
const reminder = {
  subject: '{{subject}}',
  html: frame('<h2 style="background:{{brandColor}};color:#fff;padding:20px;border-radius:8px">{{heading}}</h2><p>{{intro}}</p><table style="width:100%;border-collapse:collapse">{{details}}</table><p style="font-size:12px;color:#64748b">{{footer}}</p>'),
};
export const MAIL_CATALOG = {
  verification: {
    name: 'Verifikasi akun', description: 'Dikirim saat pendaftaran atau permintaan ulang verifikasi email.', recipient: 'Pemilik akun',
    defaults: { subject: 'Verify your email address', html: frame('<h2>Verify your email</h2><p>Hello {{name}},</p><p>Confirm your email address to finish setting up your Legalio account.</p><p><a href="{{url}}">Verify email</a></p>') },
    sample: { name: 'Andi', email: 'andi@example.com', url: 'https://example.com/verify?token=contoh' }, required: ['url'],
  },
  invitation: {
    name: 'Undangan organisasi', description: 'Dikirim ketika anggota diundang atau undangan dikirim ulang.', recipient: 'Alamat email yang diundang',
    defaults: { subject: 'Invitation to join {{organizationName}} on Legalio', html: frame('<p>{{inviterName}} invited you to join <strong>{{organizationName}}</strong> as <strong>{{tenantRole}}</strong>.</p><p><a href="{{inviteUrl}}">Accept invitation</a> (valid until {{expiresAt}}).</p>') },
    sample: { organizationName: 'PT Contoh Indonesia', inviterName: 'Admin Legal', tenantRole: 'editor', inviteUrl: 'https://example.com/app?accept_invite=contoh', expiresAt: '2026-10-17' }, required: ['inviteUrl'],
  },
  'contract-reminder': {
    name: 'Pengingat kontrak', description: 'Dikirim pada jadwal pengingat sebelum kontrak berakhir, sesuai pengaturan organisasi.', recipient: 'PIC, email notifikasi legal, serta admin/manager organisasi',
    defaults: reminder,
    sample: { subject: '[Pengingat 30 hari] Kontrak CTR-001 — Perjanjian layanan', heading: 'Kontrak akan berakhir', intro: 'Kontrak berikut akan berakhir dalam 30 hari. Mohon tinjau kebutuhan perpanjangan atau pengakhiran.', details: '<tr><td>Nomor</td><td>CTR-001</td></tr><tr><td>Nilai</td><td>Rp 150.000.000</td></tr>', footer: 'E-mail otomatis dari Legalio untuk PT Contoh Indonesia.', brandColor: '#2563eb', organizationName: 'PT Contoh Indonesia', reference: 'CTR-001', title: 'Perjanjian layanan', endDate: '2026-11-15', daysRemaining: '30' }, required: [],
  },
  'commercial-reminder': {
    name: 'Pengingat dokumen komersial / IO', description: 'Dikirim pada jadwal pengingat sebelum dokumen komersial berakhir.', recipient: 'PIC, email notifikasi finance, serta admin/manager organisasi',
    defaults: reminder,
    sample: { subject: '[Pengingat 14 hari] IO IO-001 — Kampanye Oktober', heading: 'IO akan berakhir', intro: 'Dokumen berikut akan berakhir dalam 14 hari.', details: '<tr><td>Nomor</td><td>IO-001</td></tr><tr><td>Model harga</td><td>CPM</td></tr>', footer: 'E-mail otomatis dari Legalio untuk PT Contoh Indonesia.', brandColor: '#2563eb', organizationName: 'PT Contoh Indonesia', reference: 'IO-001', title: 'Kampanye Oktober', endDate: '2026-10-30', daysRemaining: '14' }, required: [],
  },
  'smtp-test': {
    name: 'Tes koneksi SMTP', description: 'Dikirim secara manual melalui tombol tes pada pengaturan SMTP.', recipient: 'Alamat penerima tes yang diisi admin',
    defaults: { subject: '[TEST] Konfigurasi SMTP Relay Berhasil Terhubung!', html: frame('<h2>Koneksi SMTP Relay Berhasil!</h2><p>Email ini membuktikan bahwa konfigurasi SMTP Relay pada Legalio dapat mengirimkan email.</p><p>SMTP Server: {{host}}:{{port}}<br>Email Pengirim: {{fromAddress}}<br>Waktu Pengujian: {{testedAt}}</p>') },
    sample: { host: 'smtp.example.com', port: '587', fromAddress: 'noreply@example.com', testedAt: '2026-10-16T09:00:00.000Z' }, required: [],
  },
} as const;
export type MailTemplateId = keyof typeof MAIL_CATALOG;
export const isMailTemplateId = (id: string): id is MailTemplateId => Object.hasOwn(MAIL_CATALOG, id);
export class MailTemplateError extends Error {
  constructor(public key: string, message: string, public variables: Record<string, string> = {}) { super(message); }
}
export function validateMailTemplate(id: MailTemplateId, value: unknown): asserts value is MailTemplate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MailTemplateError('mailer.error.invalid', 'Template tidak valid.');
  const t = value as MailTemplate;
  if (Object.keys(value).some(k => !['subject', 'html'].includes(k))) throw new MailTemplateError('mailer.error.fields', 'Field template tidak dikenal.');
  if (typeof t.subject !== 'string' || !t.subject.trim() || t.subject.length > 500 || /[\r\n]/.test(t.subject)) throw new MailTemplateError('mailer.error.subject', 'Subjek wajib diisi, satu baris, maksimal 500 karakter.');
  if (typeof t.html !== 'string' || !t.html.trim() || t.html.length > 100_000) throw new MailTemplateError('mailer.error.html', 'Isi HTML wajib diisi, maksimal 100.000 karakter.');
  const allowed = Object.keys(MAIL_CATALOG[id].sample);
  for (const match of (t.subject + t.html).matchAll(/{{\s*([^{}]+?)\s*}}/g)) {
    if (!allowed.includes(match[1])) throw new MailTemplateError('mailer.error.unknown_variable', `Variabel tidak dikenal: ${match[1]}`, { variable: match[1] });
  }
  const unmatched = (t.subject + t.html).replace(/{{\s*[^{}]+?\s*}}/g, '');
  if (/{{|}}/.test(unmatched)) throw new MailTemplateError('mailer.error.variable_format', 'Format variabel harus {{namaVariabel}}.');
  for (const key of MAIL_CATALOG[id].required) {
    if (!new RegExp(`{{\\s*${key}\\s*}}`).test(t.html)) throw new MailTemplateError('mailer.error.required_variable', `Isi email wajib menyertakan {{${key}}}.`, { variable: `{{${key}}}` });
  }
}
export function renderMailTemplate(template: MailTemplate, values: Record<string, string>, trustedHtmlKeys: string[] = []): MailTemplate {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const replace = (source: string, html: boolean) => source.replace(/{{\s*([^{}]+?)\s*}}/g, (_, key: string) => {
    if (!Object.hasOwn(values, key)) throw new MailTemplateError('mailer.error.missing_variable', `Variabel tidak tersedia: ${key}`, { variable: key });
    return html && !trustedHtmlKeys.includes(key) ? escape(values[key]) : values[key];
  });
  return { subject: replace(template.subject, false).replace(/[\r\n]/g, ' '), html: replace(template.html, true) };
}
