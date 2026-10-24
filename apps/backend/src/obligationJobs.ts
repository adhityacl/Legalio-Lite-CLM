/**
 * Obligation reminders (Phase 3B / item 1): an advisory-locked pass raises, once per due date, a `due_soon` event when an open obligation
 * comes within its lead time and an `overdue` event once its date has passed. An event is claimed by writing the due date into the
 * obligation's `last_due_soon_cycle` / `last_overdue_cycle` marker (an UPDATE that only one instance can win), and in the same
 * transaction the webhook is queued and one ledger row (`obligation_notices`, unique per obligation, due date, kind and recipient) plus the
 * recipient's in-app entry are written. Delivery uses the reminder ledger's rules: claim by bumping attempts, back off, dead-letter.
 * Recipients: the responsible person, or the organization admins and managers when nobody is assigned.
 */
import crypto from 'node:crypto';
import type { Sql } from './db';
import { componentLog } from './logger';
import { readOrganizationSettings } from './organizationSettingsStore';
import { MAX_ATTEMPTS, backoffMs } from './reminders';
import { getTenantSettings } from './tenantPolicy';
import { todayInTimezone } from '@legalio/shared/policy';
import { DEFAULT_LEAD_DAYS, addDays, daysBetween } from '@legalio/shared/obligations';
import { emitWebhookEvent } from './webhooks';
import { obligationSummary } from './webhookEvents';

const log = componentLog('obligations');

export const OBLIGATION_LOCK_KEY = 0x4c474f42; // "LGOB"
export type ObligationNoticeKind = 'due_soon' | 'overdue';

let queuedListener: (() => void) | null = null;
export const onObligationNoticeQueued = (listener: (() => void) | null) => { queuedListener = listener; };

export interface ObligationPassResult { dueSoon: number; overdue: number; notices: number }

/** Lead time: the obligation's own, else the organization's setting, else OBLIGATION_LEAD_DAYS, else 7. */
const envLeadDays = () => { const v = Number(process.env.OBLIGATION_LEAD_DAYS); return Number.isInteger(v) && v >= 0 && v <= 365 ? v : DEFAULT_LEAD_DAYS; };

async function recipientsFor(db: Sql, organizationId: string, responsibleUserId: string | null): Promise<string[]> {
  if (responsibleUserId) {
    const person = await db.get(`SELECT u.id FROM member m JOIN "user" u ON u.id = m."userId" WHERE m."organizationId" = ? AND u.id = ? AND m.status = 'active' AND u.banned IS NOT TRUE`, organizationId, responsibleUserId);
    if (person) return [responsibleUserId];
  }
  return (await db.all<{ id: string }>(`SELECT u.id FROM member m JOIN "user" u ON u.id = m."userId" WHERE m."organizationId" = ? AND m.role IN ('admin', 'manager') AND m.status = 'active' AND u.banned IS NOT TRUE ORDER BY u.id`, organizationId)).map((r) => r.id);
}

/** Writes one ledger row and the recipient's in-app entry together; false when this notice already exists. */
export async function enqueueObligationNotice(db: Sql, entry: {
  organizationId: string; obligationId: string; cycleDueDate: string; kind: ObligationNoticeKind; recipientId: string; payload: Record<string, unknown>;
}): Promise<boolean> {
  return db.tx(async () => {
    const now = new Date().toISOString();
    const inserted = await db.run(`INSERT INTO obligation_notices (id, organization_id, obligation_id, cycle_due_date, kind, recipient_id, payload, status, next_attempt_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?) ON CONFLICT (obligation_id, cycle_due_date, kind, recipient_id) DO NOTHING`,
      `obn_${crypto.randomUUID()}`, entry.organizationId, entry.obligationId, entry.cycleDueDate, entry.kind, entry.recipientId, JSON.stringify(entry.payload), now, now, now);
    if (!inserted.changes) return false;
    await db.run(`INSERT INTO user_notifications (id, organization_id, user_id, kind, params, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      `unt_${crypto.randomUUID()}`, entry.organizationId, entry.recipientId, `obligation.${entry.kind}`, JSON.stringify({ obligationId: entry.obligationId, ...entry.payload }),
      `?tab=obligations&id=${encodeURIComponent(entry.obligationId)}`, now);
    return true;
  });
}

/** Raises the due-soon and overdue events that have come due. Idempotent: a second pass (or another instance) raises nothing new. */
export async function runObligationPass(db: Sql, now = new Date()): Promise<ObligationPassResult> {
  const result: ObligationPassResult = { dueSoon: 0, overdue: 0, notices: 0 };
  const horizon = addDays(now.toISOString().slice(0, 10), 367);
  const todayByOrg = new Map<string, string>();
  const leadByOrg = new Map<string, number>();
  let after = '';
  for (;;) {
    const rows = await db.all<any>(`
      SELECT o.*, c.contract_number, p.partner_name FROM obligations o
      LEFT JOIN contracts c ON c.contract_id = o.contract_id LEFT JOIN partners p ON p.partner_id = o.partner_id
      WHERE o.status IN ('open', 'in_progress') AND o.due_date IS NOT NULL AND o.due_date <= ? AND o.id > ? ORDER BY o.id LIMIT 500`, horizon, after);
    if (!rows.length) break;
    for (const row of rows) {
      const org = row.organization_id as string;
      if (!todayByOrg.has(org)) todayByOrg.set(org, todayInTimezone(getTenantSettings(org).timezone, now));
      if (!leadByOrg.has(org)) {
        const stored = await db.get<{ lead_days: number }>('SELECT lead_days FROM obligation_settings WHERE organization_id = ?', org);
        leadByOrg.set(org, stored ? Number(stored.lead_days) : envLeadDays());
      }
      const today = todayByOrg.get(org)!;
      const days = daysBetween(today, row.due_date)!;
      const lead = row.lead_days ?? leadByOrg.get(org)!;
      const kind: ObligationNoticeKind | null = days < 0 ? 'overdue' : days <= lead ? 'due_soon' : null;
      if (!kind) continue;
      const marker = kind === 'overdue' ? 'last_overdue_cycle' : 'last_due_soon_cycle';
      await db.tx(async () => {
        const claimed = await db.run(
          `UPDATE obligations SET ${marker} = ? WHERE id = ? AND organization_id = ? AND status IN ('open', 'in_progress') AND due_date = ? AND ${marker} IS DISTINCT FROM ?`,
          row.due_date, row.id, org, row.due_date, row.due_date);
        if (!claimed.changes) return;
        if (kind === 'overdue') result.overdue++; else result.dueSoon++;
        await emitWebhookEvent(db, org, kind === 'overdue' ? 'obligation.overdue' : 'obligation.due_soon', { obligation: obligationSummary(row), daysUntilDue: days, leadDays: lead });
        const payload = {
          title: row.title, type: row.type, dueDate: row.due_date, daysUntilDue: days, contractNumber: row.contract_number ?? null, partnerName: row.partner_name ?? null,
          responsibleDepartment: row.responsible_department || null,
        };
        for (const recipientId of await recipientsFor(db, org, row.responsible_user_id)) {
          if (await enqueueObligationNotice(db, { organizationId: org, obligationId: row.id, cycleDueDate: row.due_date, kind, recipientId, payload })) result.notices++;
        }
      });
    }
    after = rows[rows.length - 1].id;
    if (rows.length < 500) break;
  }
  if (result.notices) queuedListener && setImmediate(queuedListener);
  return result;
}

/* ------------------------------ e-mail ------------------------------ */

export interface ObligationNoticeDeps {
  smtpAvailable: () => boolean;
  send: (input: { to: string; subject: string; html: string }) => Promise<{ success: boolean; error?: string }>;
  render: (templateId: 'obligation-reminder', values: Record<string, string>, trustedHtmlKeys: string[]) => Promise<{ subject: string; html: string }>;
  publicUrl: () => string;
  now?: () => Date;
}

const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
type Language = 'EN' | 'ID' | 'ZH';
const TYPE_LABEL: Record<string, [string, string, string]> = {
  payment: ['Payment', 'Pembayaran', '付款'], delivery: ['Delivery', 'Penyerahan', '交付'], renewal_notice: ['Renewal / notice', 'Perpanjangan / pemberitahuan', '续约 / 通知'],
  reporting: ['Reporting', 'Pelaporan', '报告'], compliance: ['Compliance', 'Kepatuhan', '合规'], other: ['Other', 'Lainnya', '其他'],
};

/** Subject, heading, intro, detail rows and button of one notice in the organization's language. */
export function obligationNoticeContent(kind: ObligationNoticeKind, p: Record<string, any>, language: Language) {
  const pick = <T,>(en: T, id: T, zh: T): T => (language === 'ID' ? id : language === 'ZH' ? zh : en);
  const days = Math.abs(Number(p.daysUntilDue ?? 0));
  const label = TYPE_LABEL[p.type] ?? TYPE_LABEL.other;
  const rows: Array<[string, string]> = [
    [pick('Obligation', 'Kewajiban', '义务'), String(p.title ?? '')], [pick('Type', 'Jenis', '类型'), pick(label[0], label[1], label[2])], [pick('Due date', 'Tenggat', '到期日'), String(p.dueDate ?? '')],
    ...(p.contractNumber ? [[pick('Contract', 'Kontrak', '合同'), String(p.contractNumber)] as [string, string]] : []),
    ...(p.partnerName ? [[pick('Counterparty', 'Pihak lawan', '合作方'), String(p.partnerName)] as [string, string]] : []),
  ];
  const tag = String(p.title ?? '');
  if (kind === 'overdue') {
    return {
      subject: pick(`[Overdue] ${tag}`, `[Terlambat] ${tag}`, `【已逾期】${tag}`), heading: pick('An obligation is overdue', 'Kewajiban terlambat', '义务已逾期'),
      intro: pick(`This obligation was due ${days} day(s) ago and is not marked done.`, `Kewajiban ini jatuh tempo ${days} hari lalu dan belum ditandai selesai.`, `此义务已逾期 ${days} 天，尚未标记完成。`),
      rows, actionLabel: pick('Open the obligation', 'Buka kewajiban', '打开义务'),
    };
  }
  return {
    subject: pick(`[Due soon] ${tag}`, `[Segera jatuh tempo] ${tag}`, `【即将到期】${tag}`), heading: pick('An obligation is about to fall due', 'Kewajiban segera jatuh tempo', '义务即将到期'),
    intro: days === 0 ? pick('This obligation is due today.', 'Kewajiban ini jatuh tempo hari ini.', '此义务今天到期。')
      : pick(`This obligation is due in ${days} day(s).`, `Kewajiban ini jatuh tempo dalam ${days} hari.`, `此义务将在 ${days} 天后到期。`),
    rows, actionLabel: pick('Open the obligation', 'Buka kewajiban', '打开义务'),
  };
}

export interface DeliveryResult { attempted: number; sent: number; failed: number; dead: number; skipped: number }

export async function deliverObligationNotices(db: Sql, deps: ObligationNoticeDeps, options: { limit?: number; maxAttempts?: number } = {}): Promise<DeliveryResult> {
  const now = deps.now?.() ?? new Date();
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const rows = await db.all(`SELECT * FROM obligation_notices WHERE status IN ('pending', 'failed') AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at LIMIT ?`, now.toISOString(), options.limit ?? 100);
  const result: DeliveryResult = { attempted: 0, sent: 0, failed: 0, dead: 0, skipped: 0 };
  const settle = (id: string, status: string, error: string | null, next: string | null, sent = false) =>
    db.run(`UPDATE obligation_notices SET status = ?, last_error = ?, next_attempt_at = ?, updated_at = ?, sent_at = ? WHERE id = ?`, status, error, next, new Date().toISOString(), sent ? new Date().toISOString() : null, id);
  for (const row of rows) {
    const claimed = await db.run(`UPDATE obligation_notices SET attempts = attempts + 1, updated_at = ? WHERE id = ? AND attempts = ? AND status IN ('pending', 'failed')`, new Date().toISOString(), row.id, row.attempts);
    if (!claimed.changes) continue;
    result.attempted++;
    const attempts = row.attempts + 1;
    try {
      if (!deps.smtpAvailable()) { await settle(row.id, 'skipped', 'SMTP relay disabled', null); result.skipped++; continue; }
      const obligation = await db.get(`SELECT id, status, due_date FROM obligations WHERE id = ?`, row.obligation_id);
      const user = await db.get(`SELECT id, email, banned FROM "user" WHERE id = ?`, row.recipient_id);
      if (!obligation) { await settle(row.id, 'skipped', 'The obligation no longer exists', null); result.skipped++; continue; }
      if (!user?.email || user.banned === true) { await settle(row.id, 'skipped', 'The recipient has no deliverable address', null); result.skipped++; continue; }
      // Completed, waived or rescheduled before the e-mail went out: the reminder would be wrong.
      if (!['open', 'in_progress'].includes(obligation.status) || obligation.due_date !== row.cycle_due_date) { await settle(row.id, 'skipped', 'The obligation changed before the notice went out', null); result.skipped++; continue; }
      const payload = JSON.parse(row.payload || '{}');
      const settings = await readOrganizationSettings(db, row.organization_id);
      const language = (settings.policy.language as Language) || 'EN';
      const content = obligationNoticeContent(row.kind, payload, language);
      const base = deps.publicUrl().replace(/\/$/, '');
      const brand = /^#[0-9a-f]{6}$/i.test(settings.profile.primaryColor || '') ? settings.profile.primaryColor : '#2563eb';
      const orgName = settings.profile.brandName || settings.name;
      const pick = <T,>(en: T, id: T, zh: T): T => (language === 'ID' ? id : language === 'ZH' ? zh : en);
      const details = content.rows.map(([k, v]) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #F1F5F9;color:#475569;width:35%;">${escapeHtml(k)}</td><td style="padding:6px 8px;border-bottom:1px solid #F1F5F9;font-weight:600;">${escapeHtml(v)}</td></tr>`).join('');
      const mail = await deps.render('obligation-reminder', {
        subject: content.subject, heading: content.heading, intro: content.intro, details, brandColor: brand, organizationName: orgName,
        actionLabel: content.actionLabel, actionUrl: `${base}/app?tab=obligations&id=${encodeURIComponent(row.obligation_id)}`,
        footer: pick(`Automated e-mail from Legalio for ${orgName}.`, `E-mail otomatis dari Legalio untuk ${orgName}.`, `此邮件由 Legalio 为 ${orgName} 自动发送。`),
      }, ['details']);
      const sent = await deps.send({ to: user.email, subject: mail.subject, html: mail.html });
      if (sent.success) { await settle(row.id, 'sent', null, null, true); result.sent++; continue; }
      throw new Error(sent.error || 'The mail relay refused the message.');
    } catch (err) {
      const message = ((err as Error)?.message || String(err)).slice(0, 500);
      if (attempts >= maxAttempts) { await settle(row.id, 'dead', message, null); result.dead++; log.error(`Obligation notice abandoned after ${attempts} attempts (${row.kind} ${row.obligation_id}): ${message}`); }
      else { await settle(row.id, 'failed', message, new Date(now.getTime() + backoffMs(attempts)).toISOString()); result.failed++; }
    }
  }
  return result;
}
