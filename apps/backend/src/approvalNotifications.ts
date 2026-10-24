/**
 * Approval e-mails, personal in-app notifications and SLA escalation (Phase 3 / item 4).
 *
 * Every e-mail is a row of `approval_notices`, unique per (request, step, kind, recipient): the request flow and the SLA pass can
 * enqueue as often as they like, each notice exists once. The row and the recipient's in-app entry are written in one transaction.
 * Delivery claims rows like the reminder ledger (attempts bump), retries with backoff and finally dead-letters. An advisory-locked
 * pass computes the 80% reminders and the breaches; a breach goes to the organization admins (or the next approver, per setting)
 * and to the delayed approver. Notices never change who may decide.
 */
import crypto from 'node:crypto';
import type { Sql } from './db';
import { componentLog } from './logger';
import { readOrganizationSettings } from './organizationSettingsStore';
import { MAX_ATTEMPTS, backoffMs } from './reminders';

const log = componentLog('approvalNotices');

export const APPROVAL_SLA_LOCK_KEY = 0x4c475341; // "LGSA"
export const DEFAULT_SLA_HOURS = 48;
export const REMINDER_FRACTION = 0.8;
export type NoticeKind = 'requested' | 'decided' | 'sla_reminder' | 'sla_breach';
export type Escalation = 'admins' | 'next_approver';

/* ------------------------------ settings ------------------------------ */

export interface ApprovalSettings { slaHours: number; escalation: Escalation; updatedAt: string | null }
export class ApprovalSettingsError extends Error { readonly status = 400; readonly code = 'INVALID_INPUT'; }

export async function getApprovalSettings(db: Sql, organizationId: string): Promise<ApprovalSettings> {
  const row = await db.get(`SELECT sla_hours, escalation, updated_at FROM approval_settings WHERE organization_id = ?`, organizationId);
  return row ? { slaHours: row.sla_hours, escalation: row.escalation, updatedAt: row.updated_at } : { slaHours: DEFAULT_SLA_HOURS, escalation: 'admins', updatedAt: null };
}

export async function saveApprovalSettings(db: Sql, organizationId: string, body: unknown, actorId: string | null): Promise<ApprovalSettings> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApprovalSettingsError('Request body must be an object.');
  const input = body as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!['slaHours', 'escalation'].includes(key)) throw new ApprovalSettingsError(`Unknown field: ${key}`);
  const current = await getApprovalSettings(db, organizationId);
  const slaHours = input.slaHours === undefined ? current.slaHours : Number(input.slaHours);
  if (!Number.isInteger(slaHours) || slaHours < 1 || slaHours > 720) throw new ApprovalSettingsError('slaHours must be a whole number from 1 to 720.');
  const escalation = input.escalation === undefined ? current.escalation : input.escalation;
  if (escalation !== 'admins' && escalation !== 'next_approver') throw new ApprovalSettingsError('escalation must be "admins" or "next_approver".');
  await db.run(`INSERT INTO approval_settings (organization_id, sla_hours, escalation, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (organization_id) DO UPDATE SET sla_hours = excluded.sla_hours, escalation = excluded.escalation, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    organizationId, slaHours, escalation, actorId, new Date().toISOString());
  return getApprovalSettings(db, organizationId);
}

/* ------------------------------ enqueueing ------------------------------ */

let queuedListener: (() => void) | null = null;
export const onApprovalNoticeQueued = (listener: (() => void) | null) => { queuedListener = listener; };
export const announceApprovalNotices = () => { setImmediate(() => queuedListener?.()); };

export interface NoticeEntry {
  organizationId: string; requestId: string; stepNo: number; kind: NoticeKind; recipientId: string;
  /** What the e-mail and the in-app entry say (code, title, decision, ...), fixed at the time of the event. */
  payload: Record<string, unknown>;
}

/** Writes the ledger row and the recipient's in-app entry together. False when this notice already exists. */
export async function enqueueNotice(db: Sql, entry: NoticeEntry): Promise<boolean> {
  return db.tx(async () => {
    const now = new Date().toISOString();
    const inserted = await db.run(`INSERT INTO approval_notices (id, organization_id, request_id, step_no, kind, recipient_id, payload, status, next_attempt_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?) ON CONFLICT (request_id, step_no, kind, recipient_id) DO NOTHING`,
      `apn_${crypto.randomUUID()}`, entry.organizationId, entry.requestId, entry.stepNo, entry.kind, entry.recipientId, JSON.stringify(entry.payload), now, now, now);
    if (!inserted.changes) return false;
    await db.run(`INSERT INTO user_notifications (id, organization_id, user_id, kind, params, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      `unt_${crypto.randomUUID()}`, entry.organizationId, entry.recipientId, `approval.${entry.kind}`, JSON.stringify({ requestId: entry.requestId, stepNo: entry.stepNo, ...entry.payload }), `?tab=document-approval`, now);
    return true;
  });
}

/* ------------------------------ SLA pass ------------------------------ */

export interface SlaPassResult { reminders: number; breaches: number }

/** Reminder at 80% of the SLA and the breach notices for every pending approval. Idempotent: running it again enqueues nothing new. */
export async function runApprovalSlaPass(db: Sql, now = new Date()): Promise<SlaPassResult> {
  const result: SlaPassResult = { reminders: 0, breaches: 0 };
  const pending = await db.all(`
    SELECT r.id, r.organization_id, r.code, r.title, r.created_by, r.created_at, r.due_at, r.current_step, s.approver_id,
      (SELECT COUNT(*)::int FROM approval_steps x WHERE x.request_id = r.id) AS step_count
    FROM approval_requests r JOIN approval_steps s ON s.request_id = r.id AND s.step_no = r.current_step
    WHERE r.status = 'pending'`);
  const adminCache = new Map<string, string[]>();
  const settingsCache = new Map<string, ApprovalSettings>();
  for (const request of pending) {
    const created = new Date(request.created_at).getTime();
    const due = new Date(request.due_at).getTime();
    if (!Number.isFinite(created) || !Number.isFinite(due) || due <= created) continue;
    const base = { organizationId: request.organization_id, requestId: request.id, stepNo: request.current_step };
    const payload = { code: request.code, title: request.title, dueAt: request.due_at, requesterId: request.created_by, pendingApproverId: request.approver_id, stepNo: request.current_step, stepCount: request.step_count };
    if (now.getTime() >= due) {
      let settings = settingsCache.get(request.organization_id);
      if (!settings) settingsCache.set(request.organization_id, settings = await getApprovalSettings(db, request.organization_id));
      let admins = adminCache.get(request.organization_id);
      if (!admins) {
        admins = (await db.all<{ id: string }>(`SELECT u.id FROM member m JOIN "user" u ON u.id = m."userId" WHERE m."organizationId" = ? AND m.role = 'admin' AND m.status = 'active' AND u.banned IS NOT TRUE ORDER BY u.id`, request.organization_id)).map((row) => row.id);
        adminCache.set(request.organization_id, admins);
      }
      let targets: string[] = admins;
      if (settings.escalation === 'next_approver') {
        const next = await db.get<{ approver_id: string }>(`SELECT approver_id FROM approval_steps WHERE request_id = ? AND step_no = ?`, request.id, request.current_step + 1);
        if (next) targets = [next.approver_id];
      }
      // The delayed approver is told as well; nobody is told twice.
      for (const recipientId of new Set([request.approver_id, ...targets])) {
        if (await enqueueNotice(db, { ...base, kind: 'sla_breach', recipientId, payload: { ...payload, overdueMinutes: Math.floor((now.getTime() - due) / 60_000), audience: recipientId === request.approver_id ? 'approver' : 'escalation' } })) result.breaches++;
      }
    } else if (now.getTime() >= created + REMINDER_FRACTION * (due - created)) {
      if (await enqueueNotice(db, { ...base, kind: 'sla_reminder', recipientId: request.approver_id, payload: { ...payload, remainingMinutes: Math.max(0, Math.floor((due - now.getTime()) / 60_000)) } })) result.reminders++;
    }
  }
  return result;
}

/* ------------------------------ e-mail content ------------------------------ */

export interface ApprovalNoticeDeps {
  smtpAvailable: () => boolean;
  send: (input: { to: string; subject: string; html: string }) => Promise<{ success: boolean; error?: string }>;
  render: (templateId: 'approval-requested' | 'approval-decided' | 'approval-reminder' | 'approval-escalation', values: Record<string, string>, trustedHtmlKeys: string[]) => Promise<{ subject: string; html: string }>;
  publicUrl: () => string;
  now?: () => Date;
}

const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
type Language = 'EN' | 'ID' | 'ZH';
const when = (iso: string) => `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const duration = (minutes: number, pick: <T>(en: T, id: T, zh: T) => T) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return pick(`${h} h ${m} min`, `${h} j ${m} mnt`, `${h} 小时 ${m} 分钟`);
};

/** Subject, heading, intro, detail rows and button of one notice in the organization's language (en/id/zh). */
export function noticeContent(kind: NoticeKind, p: Record<string, any>, language: Language, names: { requester: string; approver: string; recipient: string }) {
  const pick = <T,>(en: T, id: T, zh: T): T => (language === 'ID' ? id : language === 'ZH' ? zh : en);
  const row = (k: string, v: string) => [k, v] as [string, string];
  const base: Array<[string, string]> = [
    row(pick('Reference', 'Nomor', '编号'), String(p.code ?? '')), row(pick('Title', 'Judul', '名称'), String(p.title ?? '')),
    row(pick('Requested by', 'Diajukan oleh', '提交人'), names.requester),
  ];
  const due = p.dueAt ? [row(pick('SLA deadline', 'Batas SLA', 'SLA 截止时间'), when(p.dueAt))] : [];
  const step = p.stepCount > 1 ? [row(pick('Step', 'Langkah', '步骤'), `${p.stepNo} / ${p.stepCount}`)] : [];
  const open = pick('Open My Approval', 'Buka Persetujuan Saya', '打开我的审批');
  const tag = `${p.code} — ${p.title}`;
  switch (kind) {
    case 'requested':
      return {
        template: 'approval-requested' as const, subject: pick(`[Approval needed] ${tag}`, `[Perlu persetujuan] ${tag}`, `【待审批】${tag}`),
        heading: pick('A document is waiting for your approval', 'Dokumen menunggu persetujuan Anda', '有文档等待您审批'),
        intro: pick(`${names.requester} asked for your decision. Please approve or reject it before the SLA deadline.`, `${names.requester} meminta keputusan Anda. Mohon setujui atau tolak sebelum batas SLA.`, `${names.requester} 请求您做出决定。请在 SLA 截止前批准或拒绝。`),
        rows: [...base, ...step, ...due], actionLabel: open,
      };
    case 'decided': {
      const approved = p.decision === 'approved';
      const finished = Boolean(p.finished);
      return {
        template: 'approval-decided' as const,
        subject: approved ? pick(`[${finished ? 'Approved' : 'Step approved'}] ${tag}`, `[${finished ? 'Disetujui' : 'Langkah disetujui'}] ${tag}`, `【${finished ? '已批准' : '步骤已批准'}】${tag}`) : pick(`[Rejected] ${tag}`, `[Ditolak] ${tag}`, `【已拒绝】${tag}`),
        heading: approved ? (finished ? pick('Your request was approved', 'Pengajuan Anda disetujui', '您的申请已获批准') : pick('A step of your request was approved', 'Satu langkah pengajuan Anda disetujui', '您申请的一个步骤已获批准')) : pick('Your request was rejected', 'Pengajuan Anda ditolak', '您的申请已被拒绝'),
        intro: pick(`${names.approver} ${approved ? 'approved' : 'rejected'} step ${p.stepNo} of ${p.stepCount}.${!finished && approved ? ' It now moves to the next approver.' : ''}`,
          `${names.approver} ${approved ? 'menyetujui' : 'menolak'} langkah ${p.stepNo} dari ${p.stepCount}.${!finished && approved ? ' Pengajuan kini diteruskan ke pemberi persetujuan berikutnya.' : ''}`,
          `${names.approver}${approved ? '批准了' : '拒绝了'}第 ${p.stepNo} / ${p.stepCount} 步。${!finished && approved ? '申请现已转交下一位审批人。' : ''}`),
        rows: [...base, row(pick('Decision', 'Keputusan', '决定'), approved ? pick('Approved', 'Disetujui', '已批准') : pick('Rejected', 'Ditolak', '已拒绝')), row(pick('Approver', 'Pemberi persetujuan', '审批人'), names.approver), ...(p.comment ? [row(pick('Comment', 'Komentar', '备注'), String(p.comment))] : [])],
        actionLabel: pick('View the request', 'Lihat pengajuan', '查看申请'),
      };
    }
    case 'sla_reminder':
      return {
        template: 'approval-reminder' as const, subject: pick(`[SLA reminder] ${tag}`, `[Pengingat SLA] ${tag}`, `【SLA 提醒】${tag}`),
        heading: pick('The approval SLA is almost up', 'SLA persetujuan hampir habis', '审批 SLA 即将到期'),
        intro: pick(`About ${duration(p.remainingMinutes ?? 0, pick)} remain before this approval breaches its SLA.`, `Sekitar ${duration(p.remainingMinutes ?? 0, pick)} tersisa sebelum persetujuan ini melewati SLA.`, `距离此审批超出 SLA 约还有 ${duration(p.remainingMinutes ?? 0, pick)}。`),
        rows: [...base, ...step, ...due], actionLabel: open,
      };
    default: {
      const own = p.audience === 'approver';
      return {
        template: 'approval-escalation' as const, subject: pick(`[Overdue] ${tag}`, `[Terlambat] ${tag}`, `【已逾期】${tag}`),
        heading: pick('The approval SLA was breached', 'SLA persetujuan terlewati', '审批已超出 SLA'),
        intro: own
          ? pick('This approval is past its SLA deadline and is waiting for your decision.', 'Persetujuan ini melewati batas SLA dan menunggu keputusan Anda.', '此审批已超过 SLA 截止时间，正等待您的决定。')
          : pick(`This approval is overdue by ${duration(p.overdueMinutes ?? 0, pick)}; ${names.approver} has not decided yet. You are receiving this as an escalation.`, `Persetujuan ini terlambat ${duration(p.overdueMinutes ?? 0, pick)}; ${names.approver} belum memutuskan. Anda menerima ini sebagai eskalasi.`, `此审批已逾期 ${duration(p.overdueMinutes ?? 0, pick)}；${names.approver} 尚未决定。您收到的是升级通知。`),
        rows: [...base, row(pick('Waiting for', 'Menunggu', '等待'), names.approver), ...step, ...due], actionLabel: open,
      };
    }
  }
}

/* ------------------------------ delivery ------------------------------ */

export interface DeliveryResult { attempted: number; sent: number; failed: number; dead: number; skipped: number }

export async function deliverApprovalNotices(db: Sql, deps: ApprovalNoticeDeps, options: { limit?: number; maxAttempts?: number } = {}): Promise<DeliveryResult> {
  const now = deps.now?.() ?? new Date();
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const rows = await db.all(`SELECT * FROM approval_notices WHERE status IN ('pending', 'failed') AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at LIMIT ?`, now.toISOString(), options.limit ?? 100);
  const result: DeliveryResult = { attempted: 0, sent: 0, failed: 0, dead: 0, skipped: 0 };
  const settle = (id: string, status: string, error: string | null, next: string | null, sent = false) =>
    db.run(`UPDATE approval_notices SET status = ?, last_error = ?, next_attempt_at = ?, updated_at = ?, sent_at = ? WHERE id = ?`, status, error, next, new Date().toISOString(), sent ? new Date().toISOString() : null, id);
  for (const row of rows) {
    const claimed = await db.run(`UPDATE approval_notices SET attempts = attempts + 1, updated_at = ? WHERE id = ? AND attempts = ? AND status IN ('pending', 'failed')`, new Date().toISOString(), row.id, row.attempts);
    if (!claimed.changes) continue;
    result.attempted++;
    const attempts = row.attempts + 1;
    try {
      if (!deps.smtpAvailable()) { await settle(row.id, 'skipped', 'SMTP relay disabled', null); result.skipped++; continue; }
      const request = await db.get(`SELECT id, status FROM approval_requests WHERE id = ?`, row.request_id);
      const user = await db.get(`SELECT id, name, email, banned FROM "user" WHERE id = ?`, row.recipient_id);
      if (!request) { await settle(row.id, 'skipped', 'The approval no longer exists', null); result.skipped++; continue; }
      if (!user?.email || user.banned === true) { await settle(row.id, 'skipped', 'The recipient has no deliverable address', null); result.skipped++; continue; }
      const payload = JSON.parse(row.payload || '{}');
      // A reminder or breach for an approval that was decided in the meantime is pointless.
      if ((row.kind === 'sla_reminder' || row.kind === 'sla_breach') && request.status !== 'pending') { await settle(row.id, 'skipped', 'The approval was decided before the notice went out', null); result.skipped++; continue; }
      const names = {
        requester: (await db.get<{ name: string }>(`SELECT name FROM "user" WHERE id = ?`, payload.requesterId))?.name || '',
        approver: (await db.get<{ name: string }>(`SELECT name FROM "user" WHERE id = ?`, payload.approverId ?? payload.pendingApproverId))?.name || '',
        recipient: user.name || '',
      };
      const settings = await readOrganizationSettings(db, row.organization_id);
      const language = (settings.policy.language as Language) || 'EN';
      const content = noticeContent(row.kind, payload, language, names);
      const base = deps.publicUrl().replace(/\/$/, '');
      const brand = /^#[0-9a-f]{6}$/i.test(settings.profile.primaryColor || '') ? settings.profile.primaryColor : '#2563eb';
      const orgName = settings.profile.brandName || settings.name;
      const pick = <T,>(en: T, id: T, zh: T): T => (language === 'ID' ? id : language === 'ZH' ? zh : en);
      const details = content.rows.map(([k, v]) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #F1F5F9;color:#475569;width:35%;">${escapeHtml(k)}</td><td style="padding:6px 8px;border-bottom:1px solid #F1F5F9;font-weight:600;">${escapeHtml(v)}</td></tr>`).join('');
      const mail = await deps.render(content.template, {
        subject: content.subject, heading: content.heading, intro: content.intro, details, brandColor: brand, organizationName: orgName,
        actionLabel: content.actionLabel, actionUrl: `${base}/app?tab=document-approval`,
        footer: pick(`Automated e-mail from Legalio for ${orgName}.`, `E-mail otomatis dari Legalio untuk ${orgName}.`, `此邮件由 Legalio 为 ${orgName} 自动发送。`),
      }, ['details']);
      const sent = await deps.send({ to: user.email, subject: mail.subject, html: mail.html });
      if (sent.success) { await settle(row.id, 'sent', null, null, true); result.sent++; continue; }
      throw new Error(sent.error || 'The mail relay refused the message.');
    } catch (err) {
      const message = ((err as Error)?.message || String(err)).slice(0, 500);
      if (attempts >= maxAttempts) { await settle(row.id, 'dead', message, null); result.dead++; log.error(`Approval notice abandoned after ${attempts} attempts (${row.kind} ${row.request_id}): ${message}`); }
      else { await settle(row.id, 'failed', message, new Date(now.getTime() + backoffMs(attempts)).toISOString()); result.failed++; }
    }
  }
  return result;
}

/* ------------------------------ in-app inbox ------------------------------ */

export interface InboxEntry { id: string; kind: string; params: Record<string, unknown>; link: string | null; isRead: boolean; createdAt: string }
export async function listInbox(db: Sql, organizationId: string, userId: string, limit = 50) {
  const rows = await db.all(`SELECT * FROM user_notifications WHERE organization_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`, organizationId, userId, limit);
  const unread = (await db.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM user_notifications WHERE organization_id = ? AND user_id = ? AND NOT is_read`, organizationId, userId))!.n;
  return { notifications: rows.map((row): InboxEntry => ({ id: row.id, kind: row.kind, params: JSON.parse(row.params), link: row.link, isRead: row.is_read, createdAt: row.created_at })), unread };
}
export async function markInboxRead(db: Sql, organizationId: string, userId: string, ids?: string[]): Promise<number> {
  return (await db.run(`UPDATE user_notifications SET is_read = true, read_at = ? WHERE organization_id = ? AND user_id = ? AND NOT is_read ${ids ? 'AND id = ANY(?)' : ''}`,
    new Date().toISOString(), organizationId, userId, ...(ids ? [ids] : []))).changes;
}
