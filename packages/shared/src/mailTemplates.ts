/** The catalog covers every outgoing mail path. HTML variables are escaped by default. */
export interface MailTemplate { subject: string; html: string }
const reminder = {
  subject: '{{subject}}',
  html: `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{heading}}</title><style>.details td{border-bottom:1px solid #e2e8f0;vertical-align:top;}.details tr:last-child td{border-bottom:0;}.details td:first-child{width:40%;font-size:13px;color:#64748b;}.details td:last-child{font-weight:bold;color:#0f172a;}</style></head><body style="margin:0;padding:0;background-color:#f1f5f9;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f1f5f9;">{{intro}}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;border:1px solid #e2e8f0;"><tr><td style="padding:28px 40px 0 40px;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;color:#0f172a;letter-spacing:-0.3px;">Legalio</td></tr><tr><td style="padding:16px 40px 0 40px;"><div style="height:3px;width:40px;background-color:{{brandColor}};border-radius:2px;line-height:3px;font-size:0;">&nbsp;</div></td></tr><tr><td style="padding:28px 40px 0 40px;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:1.3;font-weight:bold;color:#0f172a;">{{heading}}</td></tr><tr><td style="padding:16px 40px 24px 40px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.65;color:#334155;">{{intro}}</td></tr><tr><td style="padding:0 40px 32px 40px;"><table class="details" role="presentation" width="100%" cellpadding="12" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;background-color:#f8fafc;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#0f172a;">{{details}}</table></td></tr><tr><td style="padding:0 40px;"><div style="height:1px;background-color:#e2e8f0;line-height:1px;font-size:0;">&nbsp;</div></td></tr><tr><td style="padding:20px 40px 32px 40px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#94a3b8;">{{footer}}</td></tr></table></td></tr></table></body></html>`,
};
/** Same layout as the reminder, plus a button. Used by the approval, escalation and digest mails (their text comes from the organization language). */
const notice = {
  subject: '{{subject}}',
  html: reminder.html.replace('{{details}}</table></td></tr>', '{{details}}</table></td></tr><tr><td style="padding:0 40px 32px 40px;"><a href="{{actionUrl}}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;background-color:{{brandColor}};">{{actionLabel}}</a></td></tr>'),
};
const noticeSample = (subject: string, heading: string, intro: string, actionLabel: string) => ({
  subject, heading, intro, brandColor: '#2563eb', actionUrl: 'https://example.com/app?tab=document-approval', actionLabel, organizationName: 'PT Contoh Indonesia',
  details: '<tr><td>Nomor</td><td>OA-2026-00001</td></tr><tr><td>Judul</td><td>Persetujuan kontrak vendor</td></tr>',
  footer: 'E-mail otomatis dari Legalio untuk PT Contoh Indonesia.',
});
export const MAIL_CATALOG = {
  verification: {
    name: 'Verifikasi akun', description: 'Dikirim saat pendaftaran atau permintaan ulang verifikasi email.', recipient: 'Pemilik akun',
    defaults: { subject: 'Verifikasi email Legalio', html: `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verifikasi email Legalio</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
  <!-- Preheader -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f1f5f9;">
    Konfirmasi email Anda untuk mengaktifkan akun Legalio.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">

          <!-- Header -->
          <tr>
            <td style="padding:28px 40px 0 40px;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;color:#0f172a;letter-spacing:-0.3px;">
              Legalio
            </td>
          </tr>

          <!-- Accent line -->
          <tr>
            <td style="padding:16px 40px 0 40px;">
              <div style="height:3px;width:40px;background-color:#2563eb;border-radius:2px;line-height:3px;font-size:0;">&nbsp;</div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:28px 40px 8px 40px;font-family:Arial,Helvetica,sans-serif;color:#334155;font-size:16px;line-height:1.65;">
              <h1 style="margin:0 0 20px 0;font-size:24px;line-height:1.3;color:#0f172a;font-weight:bold;">
                Verifikasi alamat email Anda
              </h1>
              <p style="margin:0 0 16px 0;">Halo {{name}},</p>
              <p style="margin:0 0 28px 0;">
                Terima kasih telah mendaftar di Legalio. Konfirmasi alamat email Anda untuk menyelesaikan pengaturan akun.
              </p>
            </td>
          </tr>

          <!-- Button -->
          <tr>
            <td align="left" style="padding:0 40px 28px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="#2563eb" style="border-radius:8px;">
                    <a href="{{url}}" target="_blank"
                       style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;background-color:#2563eb;">
                      Verifikasi Email
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Fallback link -->
          <tr>
            <td style="padding:0 40px 28px 40px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#64748b;">
              Tombol tidak berfungsi? Salin dan tempel tautan berikut ke browser Anda:<br>
              <a href="{{url}}" target="_blank" style="color:#2563eb;word-break:break-all;">{{url}}</a>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 40px;">
              <div style="height:1px;background-color:#e2e8f0;line-height:1px;font-size:0;">&nbsp;</div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 32px 40px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#94a3b8;">
              Jika Anda tidak merasa mendaftar di Legalio, abaikan email ini. Tidak ada tindakan yang diperlukan.<br><br>
              &copy; Legalio. Seluruh hak dilindungi.
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>` },
    sample: { name: 'Andi', email: 'andi@example.com', url: 'https://example.com/verify?token=contoh' }, required: ['url'],
  },
  invitation: {
    name: 'Undangan organisasi', description: 'Dikirim ketika anggota diundang atau undangan dikirim ulang.', recipient: 'Alamat email yang diundang',
    defaults: { subject: 'Undangan bergabung ke {{organizationName}}', html: `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Undangan bergabung ke {{organizationName}}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
  <!-- Preheader -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f1f5f9;">
    {{inviterName}} mengundang Anda bergabung ke {{organizationName}} di Legalio.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">

          <!-- Header -->
          <tr>
            <td style="padding:28px 40px 0 40px;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;color:#0f172a;letter-spacing:-0.3px;">
              Legalio
            </td>
          </tr>

          <!-- Accent line -->
          <tr>
            <td style="padding:16px 40px 0 40px;">
              <div style="height:3px;width:40px;background-color:#2563eb;border-radius:2px;line-height:3px;font-size:0;">&nbsp;</div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:28px 40px 8px 40px;font-family:Arial,Helvetica,sans-serif;color:#334155;font-size:16px;line-height:1.65;">
              <h1 style="margin:0 0 20px 0;font-size:24px;line-height:1.3;color:#0f172a;font-weight:bold;">
                Anda diundang bergabung
              </h1>
              <p style="margin:0 0 24px 0;">
                <strong style="color:#0f172a;">{{inviterName}}</strong> mengundang Anda untuk bergabung ke organisasi di Legalio.
              </p>
            </td>
          </tr>

          <!-- Details card -->
          <tr>
            <td style="padding:0 40px 28px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
                <tr>
                  <td style="padding:16px 20px 4px 20px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">
                    Organisasi
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 20px 12px 20px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#0f172a;">
                    {{organizationName}}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 20px;">
                    <div style="height:1px;background-color:#e2e8f0;line-height:1px;font-size:0;">&nbsp;</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 20px 4px 20px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">
                    Peran
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 20px 16px 20px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#0f172a;">
                    {{tenantRole}}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Button -->
          <tr>
            <td align="left" style="padding:0 40px 16px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="#2563eb" style="border-radius:8px;">
                    <a href="{{inviteUrl}}" target="_blank"
                       style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;background-color:#2563eb;">
                      Terima Undangan
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Expiry -->
          <tr>
            <td style="padding:0 40px 24px 40px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#64748b;">
              Undangan berlaku hingga <strong style="color:#334155;">{{expiresAt}}</strong>.
            </td>
          </tr>

          <!-- Fallback link -->
          <tr>
            <td style="padding:0 40px 28px 40px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#64748b;">
              Tombol tidak berfungsi? Salin dan tempel tautan berikut ke browser Anda:<br>
              <a href="{{inviteUrl}}" target="_blank" style="color:#2563eb;word-break:break-all;">{{inviteUrl}}</a>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 40px;">
              <div style="height:1px;background-color:#e2e8f0;line-height:1px;font-size:0;">&nbsp;</div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 32px 40px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#94a3b8;">
              Tidak mengenal pengundang atau tidak ingin bergabung? Abaikan email ini. Undangan akan kedaluwarsa otomatis.<br><br>
              &copy; Legalio. Seluruh hak dilindungi.
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>` },
    sample: { organizationName: 'PT Contoh Indonesia', inviterName: 'Admin Legal', tenantRole: 'editor', inviteUrl: 'https://example.com/app?accept_invite=contoh', expiresAt: '2026-10-17' }, required: ['inviteUrl'],
  },
  'contract-reminder': {
    name: 'Pengingat kontrak', description: 'Dikirim pada jadwal pengingat sebelum kontrak berakhir, sesuai pengaturan organisasi.', recipient: 'PIC, email notifikasi legal, serta admin/manager organisasi',
    defaults: reminder,
    sample: { subject: '[Pengingat 30 hari] Kontrak CTR-001 — Perjanjian layanan', heading: 'Kontrak akan berakhir', intro: 'Kontrak berikut akan berakhir dalam 30 hari. Mohon tinjau kebutuhan perpanjangan atau pengakhiran.', details: '<tr><td>Nomor</td><td>CTR-001</td></tr><tr><td>Nilai</td><td>Rp 150.000.000</td></tr>', footer: 'E-mail otomatis dari Legalio untuk PT Contoh Indonesia.', brandColor: '#2563eb', organizationName: 'PT Contoh Indonesia', reference: 'CTR-001', title: 'Perjanjian layanan', endDate: '2026-11-15', daysRemaining: '30' }, required: [],
  },
  'commercial-reminder': {
    name: 'Pengingat Dokumen IO', description: 'Dikirim pada jadwal pengingat sebelum dokumen komersial berakhir.', recipient: 'PIC, email notifikasi finance, serta admin/manager organisasi',
    defaults: reminder,
    sample: { subject: '[Pengingat 14 hari] IO IO-001 — Kampanye Oktober', heading: 'IO akan berakhir', intro: 'Dokumen berikut akan berakhir dalam 14 hari.', details: '<tr><td>Nomor</td><td>IO-001</td></tr><tr><td>Model harga</td><td>CPM</td></tr>', footer: 'E-mail otomatis dari Legalio untuk PT Contoh Indonesia.', brandColor: '#2563eb', organizationName: 'PT Contoh Indonesia', reference: 'IO-001', title: 'Kampanye Oktober', endDate: '2026-10-30', daysRemaining: '14' }, required: [],
  },
  'approval-requested': {
    name: 'Permintaan persetujuan', description: 'Dikirim ke pemberi persetujuan saat gilirannya tiba pada alur persetujuan dokumen.', recipient: 'Pemberi persetujuan saat ini',
    defaults: notice,
    sample: noticeSample('[Persetujuan] Persetujuan kontrak vendor', 'Dokumen menunggu persetujuan Anda', 'Dokumen berikut menunggu keputusan Anda.', 'Buka Persetujuan'), required: [],
  },
  'approval-decided': {
    name: 'Keputusan persetujuan', description: 'Dikirim ke pengaju saat pemberi persetujuan menyetujui atau menolak.', recipient: 'Pengaju persetujuan',
    defaults: notice,
    sample: noticeSample('[Disetujui] Persetujuan kontrak vendor', 'Keputusan persetujuan', 'Ada keputusan untuk dokumen yang Anda ajukan.', 'Lihat keputusan'), required: [],
  },
  'approval-reminder': {
    name: 'Pengingat SLA persetujuan', description: 'Dikirim ke pemberi persetujuan saat 80% waktu SLA telah berlalu dan dokumen belum diputuskan.', recipient: 'Pemberi persetujuan saat ini',
    defaults: notice,
    sample: noticeSample('[Pengingat SLA] Persetujuan kontrak vendor', 'SLA persetujuan hampir habis', 'Dokumen berikut hampir melewati batas SLA.', 'Buka Persetujuan'), required: [],
  },
  'approval-escalation': {
    name: 'Eskalasi SLA persetujuan', description: 'Dikirim saat SLA persetujuan terlewati: ke admin organisasi atau pemberi persetujuan berikutnya, dan ke pemberi persetujuan yang tertunda.', recipient: 'Admin organisasi / pemberi persetujuan berikutnya / pemberi persetujuan saat ini',
    defaults: notice,
    sample: noticeSample('[Terlambat] Persetujuan kontrak vendor', 'SLA persetujuan terlewati', 'Persetujuan berikut melewati batas SLA.', 'Buka Persetujuan'), required: [],
  },
  'obligation-reminder': {
    name: 'Pengingat kewajiban', description: 'Dikirim ke penanggung jawab saat tenggat kewajiban kontrak sudah dekat atau terlewati.', recipient: 'Penanggung jawab kewajiban (atau admin organisasi bila belum ditentukan)',
    defaults: notice,
    sample: { ...noticeSample('[Kewajiban jatuh tempo] Pembayaran termin 2', 'Kewajiban segera jatuh tempo', 'Kewajiban berikut mendekati tenggat.', 'Buka kewajiban'), actionUrl: 'https://example.com/app?tab=obligations' }, required: [],
  },
  'signature-update': {
    name: 'Pembaruan tanda tangan', description: 'Dikirim ke pengaju saat permintaan tanda tangan selesai, ditolak, atau kedaluwarsa.', recipient: 'Pengaju permintaan tanda tangan',
    defaults: notice,
    sample: { ...noticeSample('[Ditandatangani] CTR-001 — Perjanjian layanan', 'Permintaan tanda tangan Anda selesai', 'Semua pihak telah menandatangani.', 'Buka kontrak'), actionUrl: 'https://example.com/app?tab=contracts' }, required: [],
  },
  digest: {
    name: 'Ringkasan berkala', description: 'Ringkasan harian atau mingguan: tenggat pemberitahuan, kontrak berakhir, persetujuan menunggu, dan item terlambat.', recipient: 'Pengguna yang berlangganan ringkasan',
    defaults: { subject: notice.subject, html: notice.html.replace('{{footer}}', '{{footer}}<br><a href="{{unsubscribeUrl}}" style="color:#64748b;">{{unsubscribeLabel}}</a>') },
    sample: { ...noticeSample('[Ringkasan mingguan] PT Contoh Indonesia', 'Ringkasan mingguan Anda', 'Berikut hal-hal yang perlu perhatian Anda.', 'Buka Legalio'), actionUrl: 'https://example.com/app',
      unsubscribeUrl: 'https://example.com/api/digest/unsubscribe?token=contoh', unsubscribeLabel: 'Berhenti berlangganan ringkasan ini' }, required: ['unsubscribeUrl'],
  },
  'smtp-test': {
    name: 'Tes koneksi SMTP', description: 'Dikirim secara manual melalui tombol tes pada pengaturan SMTP.', recipient: 'Alamat penerima tes yang diisi admin',
    defaults: { subject: '[TEST] Konfigurasi SMTP Relay Berhasil Terhubung!', html: `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Koneksi SMTP Relay Berhasil</title></head><body style="margin:0;padding:0;background-color:#f1f5f9;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f1f5f9;">Konfigurasi SMTP Relay pada Legalio dapat mengirimkan email.</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;border:1px solid #e2e8f0;"><tr><td style="padding:28px 40px 0 40px;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;color:#0f172a;letter-spacing:-0.3px;">Legalio</td></tr><tr><td style="padding:16px 40px 0 40px;"><div style="height:3px;width:40px;background-color:#16a34a;border-radius:2px;line-height:3px;font-size:0;">&nbsp;</div></td></tr><tr><td style="padding:28px 40px 0 40px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background-color:#dcfce7;color:#15803d;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;letter-spacing:0.5px;text-transform:uppercase;padding:6px 12px;border-radius:999px;">&#10003; Berhasil</td></tr></table></td></tr><tr><td style="padding:16px 40px 0 40px;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:1.3;font-weight:bold;color:#0f172a;">Koneksi SMTP Relay Berhasil!</td></tr><tr><td style="padding:16px 40px 24px 40px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.65;color:#334155;">Email ini membuktikan bahwa konfigurasi SMTP Relay pada Legalio dapat mengirimkan email.</td></tr><tr><td style="padding:0 40px 32px 40px;"><table role="presentation" width="100%" cellpadding="12" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;background-color:#f8fafc;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;"><tr><td style="border-bottom:1px solid #e2e8f0;vertical-align:top;width:40%;font-size:13px;color:#64748b;">SMTP Server</td><td style="border-bottom:1px solid #e2e8f0;vertical-align:top;font-weight:bold;color:#0f172a;">{{host}}:{{port}}</td></tr><tr><td style="border-bottom:1px solid #e2e8f0;vertical-align:top;width:40%;font-size:13px;color:#64748b;">Email Pengirim</td><td style="border-bottom:1px solid #e2e8f0;vertical-align:top;font-weight:bold;color:#0f172a;word-break:break-all;">{{fromAddress}}</td></tr><tr><td style="vertical-align:top;width:40%;font-size:13px;color:#64748b;">Waktu Pengujian</td><td style="vertical-align:top;font-weight:bold;color:#0f172a;">{{testedAt}}</td></tr></table></td></tr><tr><td style="padding:0 40px;"><div style="height:1px;background-color:#e2e8f0;line-height:1px;font-size:0;">&nbsp;</div></td></tr><tr><td style="padding:20px 40px 32px 40px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#94a3b8;">Email pengujian otomatis dari Legalio. Tidak ada tindakan yang diperlukan.</td></tr></table></td></tr></table></body></html>` },
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
