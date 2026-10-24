/**
 * E-mail to the person who requested a signature, when the request completed, was declined or expired (`signature_notices`).
 * Same ledger pattern as the approval and obligation notices: one row per (request, kind, recipient), claimed by bumping `attempts`,
 * retried with backoff, dead-lettered after the last attempt. The notice never changes the request.
 */
import type { Sql } from './db';
import { componentLog } from './logger';
import { readOrganizationSettings } from './organizationSettingsStore';
import { MAX_ATTEMPTS, backoffMs } from './reminders';

const log = componentLog('signatureNotices');
type Language = 'EN' | 'ID' | 'ZH';
export type SignatureNoticeKind = 'completed' | 'declined' | 'expired';

export interface SignatureNoticeDeps {
  smtpAvailable: () => boolean;
  send: (input: { to: string; subject: string; html: string }) => Promise<{ success: boolean; error?: string }>;
  render: (templateId: 'signature-update', values: Record<string, string>, trustedHtmlKeys: string[]) => Promise<{ subject: string; html: string }>;
  publicUrl: () => string;
  now?: () => Date;
}

const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Subject, heading, intro and detail rows of one notice in the organization's language. */
export function signatureNoticeContent(kind: SignatureNoticeKind, p: Record<string, any>, language: Language) {
  const pick = <T,>(en: T, id: T, zh: T): T => (language === 'ID' ? id : language === 'ZH' ? zh : en);
  const tag = `${p.contractNumber ? `${p.contractNumber} — ` : ''}${p.title}`;
  const rows: Array<[string, string]> = [
    [pick('Contract', 'Kontrak', '合同'), String(p.contractNumber ?? '—')],
    [pick('Request', 'Permintaan', '请求'), String(p.title ?? '')],
  ];
  const open = pick('Open the contract', 'Buka kontrak', '打开合同');
  switch (kind) {
    case 'completed':
      return {
        subject: pick(`[Signed] ${tag}`, `[Ditandatangani] ${tag}`, `【已签署】${tag}`),
        heading: pick('Your signature request is complete', 'Permintaan tanda tangan Anda selesai', '您的签署请求已完成'),
        intro: pick('Everyone has signed. The contract was updated and the signed copy is on its record.', 'Semua pihak telah menandatangani. Kontrak diperbarui dan salinan bertanda tangan ada pada catatannya.', '所有人均已签署。合同已更新，已签署副本已保存在合同记录中。'),
        rows: [...rows, [pick('Signed copy', 'Salinan bertanda tangan', '已签署副本'), p.signedCopy ? pick('Attached', 'Terlampir', '已附上') : pick('Not attached yet', 'Belum terlampir', '尚未附上')] as [string, string]], actionLabel: open,
      };
    case 'declined':
      return {
        subject: pick(`[Declined] ${tag}`, `[Ditolak] ${tag}`, `【已拒绝】${tag}`),
        heading: pick('A signer declined', 'Seorang penandatangan menolak', '有签署人拒绝签署'),
        intro: pick(`${p.signerName || p.signerEmail || 'A signer'} declined to sign. The request is closed.`, `${p.signerName || p.signerEmail || 'Seorang penandatangan'} menolak menandatangani. Permintaan ditutup.`, `${p.signerName || p.signerEmail || '一位签署人'}拒绝签署。该请求已关闭。`),
        rows: [...rows, ...(p.reason ? [[pick('Reason', 'Alasan', '原因'), String(p.reason)] as [string, string]] : [])], actionLabel: open,
      };
    default:
      return {
        subject: pick(`[Expired] ${tag}`, `[Kedaluwarsa] ${tag}`, `【已过期】${tag}`),
        heading: pick('Your signature request expired', 'Permintaan tanda tangan Anda kedaluwarsa', '您的签署请求已过期'),
        intro: pick('Not everyone signed in time. Create a new request if the contract still needs signatures.', 'Tidak semua pihak menandatangani tepat waktu. Buat permintaan baru jika kontrak masih memerlukan tanda tangan.', '并非所有人都按时签署。如合同仍需签署，请创建新的请求。'),
        rows: [...rows, [pick('Expired on', 'Kedaluwarsa pada', '过期时间'), String(p.expiresAt ?? '').slice(0, 10)] as [string, string]], actionLabel: open,
      };
  }
}

export interface SignatureNoticeResult { attempted: number; sent: number; failed: number; dead: number; skipped: number }

export async function deliverSignatureNotices(db: Sql, deps: SignatureNoticeDeps, options: { limit?: number; maxAttempts?: number } = {}): Promise<SignatureNoticeResult> {
  const now = deps.now?.() ?? new Date();
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const rows = await db.all(`SELECT * FROM signature_notices WHERE status IN ('pending', 'failed') AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at LIMIT ?`, now.toISOString(), options.limit ?? 100);
  const result: SignatureNoticeResult = { attempted: 0, sent: 0, failed: 0, dead: 0, skipped: 0 };
  const settle = (id: string, status: string, error: string | null, next: string | null, sent = false) =>
    db.run(`UPDATE signature_notices SET status = ?, last_error = ?, next_attempt_at = ?, updated_at = ?, sent_at = ? WHERE id = ?`, status, error, next, new Date().toISOString(), sent ? new Date().toISOString() : null, id);
  for (const row of rows) {
    const claimed = await db.run(`UPDATE signature_notices SET attempts = attempts + 1, updated_at = ? WHERE id = ? AND attempts = ? AND status IN ('pending', 'failed')`, new Date().toISOString(), row.id, row.attempts);
    if (!claimed.changes) continue;
    result.attempted++;
    const attempts = row.attempts + 1;
    try {
      if (!deps.smtpAvailable()) { await settle(row.id, 'skipped', 'SMTP relay disabled', null); result.skipped++; continue; }
      const user = await db.get(`SELECT id, name, email, banned FROM "user" WHERE id = ?`, row.recipient_id);
      const request = await db.get<{ contract_id: string }>(`SELECT contract_id FROM signature_requests WHERE id = ?`, row.request_id);
      if (!request) { await settle(row.id, 'skipped', 'The request no longer exists', null); result.skipped++; continue; }
      if (!user?.email || user.banned === true) { await settle(row.id, 'skipped', 'The recipient has no deliverable address', null); result.skipped++; continue; }
      const settings = await readOrganizationSettings(db, row.organization_id);
      const language = (settings.policy.language as Language) || 'EN';
      const content = signatureNoticeContent(row.kind, JSON.parse(row.payload || '{}'), language);
      const base = deps.publicUrl().replace(/\/$/, '');
      const brand = /^#[0-9a-f]{6}$/i.test(settings.profile.primaryColor || '') ? settings.profile.primaryColor : '#2563eb';
      const orgName = settings.profile.brandName || settings.name;
      const pick = <T,>(en: T, id: T, zh: T): T => (language === 'ID' ? id : language === 'ZH' ? zh : en);
      const details = content.rows.map(([k, v]) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #F1F5F9;color:#475569;width:35%;">${escapeHtml(k)}</td><td style="padding:6px 8px;border-bottom:1px solid #F1F5F9;font-weight:600;">${escapeHtml(v)}</td></tr>`).join('');
      const mail = await deps.render('signature-update', {
        subject: content.subject, heading: content.heading, intro: content.intro, details, brandColor: brand, organizationName: orgName,
        actionLabel: content.actionLabel, actionUrl: `${base}/app?tab=contracts&id=${encodeURIComponent(request.contract_id)}`,
        footer: pick(`Automated e-mail from Legalio for ${orgName}.`, `E-mail otomatis dari Legalio untuk ${orgName}.`, `此邮件由 Legalio 为 ${orgName} 自动发送。`),
      }, ['details']);
      const sent = await deps.send({ to: user.email, subject: mail.subject, html: mail.html });
      if (sent.success) { await settle(row.id, 'sent', null, null, true); result.sent++; continue; }
      throw new Error(sent.error || 'The mail relay refused the message.');
    } catch (err) {
      const message = ((err as Error)?.message || String(err)).slice(0, 500);
      if (attempts >= maxAttempts) { await settle(row.id, 'dead', message, null); result.dead++; log.error(`Signature notice abandoned after ${attempts} attempts (${row.kind} ${row.request_id}): ${message}`); }
      else { await settle(row.id, 'failed', message, new Date(now.getTime() + backoffMs(attempts)).toISOString()); result.failed++; }
    }
  }
  return result;
}
