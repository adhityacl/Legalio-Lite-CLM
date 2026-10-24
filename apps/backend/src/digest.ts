/**
 * Scheduled digest e-mails (Phase 3 / item 5).
 *
 * A member receives a daily or weekly digest when they opted in (or the organization's default says so and they did not opt out):
 * notice deadlines coming up, contracts and orders about to expire, approvals waiting for them or submitted by them, and what is
 * overdue. The content is built from the repositories and SQL with the member's own role and department scope, exactly like their
 * lists. A pass writes one ledger row per (member, frequency, period): the unique key makes the send once per period whatever the
 * number of instances or passes. Every mail carries a signed one-click unsubscribe link.
 */
import crypto from 'node:crypto';
import type { Sql } from './db';
import { componentLog } from './logger';
import { departmentIdsOf } from './identity';
import { readOrganizationSettings } from './organizationSettingsStore';
import { membershipContext, type OrgContext, type TenantRole, isTenantRole } from './rbac';
import { createOrganizationScope, recordVisible, teamsOf } from './recordScope';
import { MAX_ATTEMPTS, backoffMs } from './reminders';
import { contractRepository } from './repositories/contractRepository';
import { ioRepository } from './repositories/ioRepository';
import { scopeCollectionsFor } from './repositories/scopeDirectory';

const log = componentLog('digest');

export const DIGEST_LOCK_KEY = 0x4c474447; // "LGDG"
export const WINDOW_DAYS = 30;
export const MAX_ITEMS_PER_SECTION = 10;
export type Frequency = 'daily' | 'weekly';
export type Preference = 'inherit' | 'off' | Frequency;
export type Language = 'EN' | 'ID' | 'ZH';

export class DigestInputError extends Error { readonly status = 400; readonly code = 'INVALID_INPUT'; }

/* ------------------------------ time zones and periods ------------------------------ */

const MS_DAY = 86_400_000;
function zoneParts(instant: number, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(instant)).map((p) => [p.type, Number(p.value)]));
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour % 24, minute: parts.minute, second: parts.second };
}
const offsetMs = (instant: number, timeZone: string) => {
  const p = zoneParts(instant, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
};
/** The UTC instant at which the wall clock of `timeZone` shows this date and hour. */
export function zonedInstant(date: string, hour: number, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour);
  const first = guess - offsetMs(guess, timeZone);
  const second = guess - offsetMs(first, timeZone);
  return second;
}
export const localDate = (instant: number, timeZone: string) => {
  const p = zoneParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_DAY).toISOString().slice(0, 10);
const isoWeekday = (date: string) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1; // 1 = Monday

export interface Period { frequency: Frequency; key: string; scheduledAt: number; endsAt: number }
/** The digest period that `now` falls in, its send time and the instant it ends (catching up is allowed only inside the period). */
export function periodOf(frequency: Frequency, now: number, timeZone: string, weekday: number, hour: number): Period {
  const today = localDate(now, timeZone);
  if (frequency === 'daily') {
    return { frequency, key: today, scheduledAt: zonedInstant(today, hour, timeZone), endsAt: zonedInstant(addDays(today, 1), 0, timeZone) };
  }
  const monday = addDays(today, 1 - isoWeekday(today));
  return { frequency, key: `week-${monday}`, scheduledAt: zonedInstant(addDays(monday, weekday - 1), hour, timeZone), endsAt: zonedInstant(addDays(monday, 7), 0, timeZone) };
}

/* ------------------------------ settings ------------------------------ */

export interface DigestDefaults { frequency: 'off' | Frequency; weekday: number; hour: number; effectiveFrom: string | null }
export async function getDigestDefaults(db: Sql, organizationId: string): Promise<DigestDefaults> {
  const row = await db.get(`SELECT frequency, weekday, hour, effective_from FROM digest_defaults WHERE organization_id = ?`, organizationId);
  return row ? { frequency: row.frequency, weekday: row.weekday, hour: row.hour, effectiveFrom: row.effective_from } : { frequency: 'off', weekday: 1, hour: 8, effectiveFrom: null };
}
export async function saveDigestDefaults(db: Sql, organizationId: string, body: unknown, actorId: string | null): Promise<DigestDefaults> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DigestInputError('Request body must be an object.');
  const input = body as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!['frequency', 'weekday', 'hour'].includes(key)) throw new DigestInputError(`Unknown field: ${key}`);
  const current = await getDigestDefaults(db, organizationId);
  const frequency = input.frequency === undefined ? current.frequency : input.frequency;
  if (frequency !== 'off' && frequency !== 'daily' && frequency !== 'weekly') throw new DigestInputError('frequency must be off, daily or weekly.');
  const weekday = input.weekday === undefined ? current.weekday : Number(input.weekday);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new DigestInputError('weekday must be 1 (Monday) to 7 (Sunday).');
  const hour = input.hour === undefined ? current.hour : Number(input.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new DigestInputError('hour must be 0 to 23.');
  const now = new Date().toISOString();
  const changed = frequency !== current.frequency || weekday !== current.weekday || hour !== current.hour;
  await db.run(`INSERT INTO digest_defaults (organization_id, frequency, weekday, hour, effective_from, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (organization_id) DO UPDATE SET frequency = excluded.frequency, weekday = excluded.weekday, hour = excluded.hour, effective_from = ?, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    organizationId, frequency, weekday, hour, now, actorId, now, changed ? now : current.effectiveFrom ?? now);
  return getDigestDefaults(db, organizationId);
}

export interface DigestPreference { frequency: Preference; effective: 'off' | Frequency; defaults: DigestDefaults }
export async function getPreference(db: Sql, organizationId: string, userId: string): Promise<DigestPreference> {
  const defaults = await getDigestDefaults(db, organizationId);
  const row = await db.get(`SELECT frequency FROM digest_preferences WHERE organization_id = ? AND user_id = ?`, organizationId, userId);
  const frequency: Preference = row?.frequency ?? 'inherit';
  return { frequency, effective: frequency === 'inherit' ? defaults.frequency : frequency, defaults };
}
export async function savePreference(db: Sql, organizationId: string, userId: string, value: unknown): Promise<DigestPreference> {
  if (value !== 'inherit' && value !== 'off' && value !== 'daily' && value !== 'weekly') throw new DigestInputError('frequency must be inherit, off, daily or weekly.');
  const now = new Date().toISOString();
  await db.run(`INSERT INTO digest_preferences (organization_id, user_id, frequency, effective_from, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (organization_id, user_id) DO UPDATE SET frequency = excluded.frequency, effective_from = excluded.effective_from, updated_at = excluded.updated_at`, organizationId, userId, value, now, now);
  return getPreference(db, organizationId, userId);
}

/* ------------------------------ unsubscribe token ------------------------------ */

const tokenKey = () => Buffer.from(crypto.hkdfSync('sha256', process.env.BETTER_AUTH_SECRET || 'insecure-development-secret-change-me', 'legalio', 'digest-unsubscribe', 32));
/** `<payload>.<mac>`: organization and member, signed; it has no expiry so old e-mails keep working. */
export function signUnsubscribeToken(organizationId: string, userId: string): string {
  const payload = Buffer.from(JSON.stringify({ o: organizationId, u: userId, k: 'digest' })).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256', tokenKey()).update(payload).digest('base64url')}`;
}
export function verifyUnsubscribeToken(token: unknown): { organizationId: string; userId: string } | null {
  if (typeof token !== 'string' || token.length > 600) return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = crypto.createHmac('sha256', tokenKey()).update(payload).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data?.k === 'digest' && typeof data.o === 'string' && typeof data.u === 'string' ? { organizationId: data.o, userId: data.u } : null;
  } catch { return null; }
}
/** Turns the digest off for the member of the token. Idempotent. */
export async function unsubscribe(db: Sql, token: unknown): Promise<{ organizationId: string; userId: string } | null> {
  const verified = verifyUnsubscribeToken(token);
  if (!verified) return null;
  const member = await db.get(`SELECT 1 FROM member WHERE "organizationId" = ? AND "userId" = ?`, verified.organizationId, verified.userId);
  if (!member) return null;
  await savePreference(db, verified.organizationId, verified.userId, 'off');
  return verified;
}

/* ------------------------------ content ------------------------------ */

export interface DigestItem { kind: 'contract' | 'order' | 'approval'; id: string; reference: string; title: string; date: string | null; days: number | null }
export interface DigestContent {
  organizationId: string; userId: string; generatedAt: string; today: string; windowDays: number; language: Language; timeZone: string;
  sections: { noticeDeadlines: DigestItem[]; expiring: DigestItem[]; pendingApprovals: DigestItem[]; overdue: DigestItem[] };
  counts: { noticeDeadlines: number; expiring: number; pendingApprovals: number; overdue: number };
  empty: boolean;
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_DAY);
const day = (value: unknown) => String(value ?? '').slice(0, 10);
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** The member's organization context, or null when they are not an active member (or are banned). */
export async function memberContext(db: Sql, organizationId: string, userId: string): Promise<OrgContext | null> {
  const row = await db.get(`SELECT m.id, m.role, m.status, u.banned FROM member m JOIN "user" u ON u.id = m."userId" WHERE m."organizationId" = ? AND m."userId" = ?`, organizationId, userId);
  if (!row || row.status !== 'active' || row.banned === true || !isTenantRole(row.role)) return null;
  return membershipContext({ organizationId, userId, platformRole: 'user', membershipId: row.id, tenantRole: row.role as TenantRole, departmentIds: await departmentIdsOf(db, userId, organizationId) });
}

/** Builds the member's digest as of `now`. Everything is limited to what the member may see in the application. */
export async function buildDigest(db: Sql, organizationId: string, userId: string, now = new Date()): Promise<DigestContent | null> {
  const ctx = await memberContext(db, organizationId, userId);
  if (!ctx) return null;
  const settings = await readOrganizationSettings(db, organizationId);
  const timeZone = settings.policy.timezone || 'UTC';
  const today = localDate(now.getTime(), timeZone);
  const horizon = addDays(today, WINDOW_DAYS);
  const scope = createOrganizationScope(await teamsOf(db, organizationId), organizationId, await scopeCollectionsFor(db, ctx));
  const sections: DigestContent['sections'] = { noticeDeadlines: [], expiring: [], pendingApprovals: [], overdue: [] };

  // Contracts that have not ended: the end date, and the notice deadline (end date minus the notice period).
  for (const contract of (await contractRepository.list(organizationId, { endFrom: today, sort: 'end_date' })).rows) {
    if (contract.status === 'Terminated' || !recordVisible(ctx, scope, 'contract', contract)) continue;
    const end = day(contract.end_date);
    if (!validDate(end)) continue;
    const item = (date: string): DigestItem => ({ kind: 'contract', id: contract.contract_id, reference: contract.contract_number, title: contract.contract_title, date, days: daysBetween(today, date) });
    const noticeDays = Number(contract.notice_period_days);
    if (noticeDays > 0) {
      const deadline = addDays(end, -noticeDays);
      if (deadline >= today && deadline <= horizon) sections.noticeDeadlines.push(item(deadline));
      else if (deadline < today) sections.overdue.push(item(deadline));
    }
    if (end <= horizon) sections.expiring.push(item(end));
  }
  for (const order of (await ioRepository.list(organizationId, { window: { from: today, to: horizon }, sort: 'end_date' })).rows) {
    if (order.status === 'Terminated' || !recordVisible(ctx, scope, 'io', order)) continue;
    const end = day(order.end_date);
    if (validDate(end) && end >= today && end <= horizon) sections.expiring.push({ kind: 'order', id: order.io_id, reference: order.io_number, title: order.io_title, date: end, days: daysBetween(today, end) });
  }

  // Approvals waiting for the member, and the ones they submitted that are still open; overdue ones are listed under "overdue" as well.
  const approvals = await db.all(`
    SELECT r.id, r.code, r.title, r.due_at, r.created_by, s.approver_id FROM approval_requests r
    JOIN approval_steps s ON s.request_id = r.id AND s.step_no = r.current_step
    WHERE r.organization_id = ? AND r.status = 'pending' AND (s.approver_id = ? OR r.created_by = ?) ORDER BY r.due_at`, organizationId, userId, userId);
  for (const approval of approvals) {
    const dueDay = localDate(new Date(approval.due_at).getTime(), timeZone);
    const item: DigestItem = { kind: 'approval', id: approval.id, reference: approval.code, title: approval.title, date: dueDay, days: daysBetween(today, dueDay) };
    sections.pendingApprovals.push(item);
    if (new Date(approval.due_at).getTime() < now.getTime()) sections.overdue.push(item);
  }
  sections.noticeDeadlines.sort((a, b) => a.date!.localeCompare(b.date!));
  sections.expiring.sort((a, b) => a.date!.localeCompare(b.date!));
  sections.overdue.sort((a, b) => a.date!.localeCompare(b.date!));
  const counts = { noticeDeadlines: sections.noticeDeadlines.length, expiring: sections.expiring.length, pendingApprovals: sections.pendingApprovals.length, overdue: sections.overdue.length };
  return {
    organizationId, userId, generatedAt: now.toISOString(), today, windowDays: WINDOW_DAYS, language: (settings.policy.language as Language) || 'EN', timeZone,
    sections, counts, empty: Object.values(counts).every((n) => n === 0),
  };
}

/* ------------------------------ mail ------------------------------ */

const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function digestMailValues(content: DigestContent, frequency: Frequency, orgName: string, brandColor: string, base: string, unsubscribeUrl: string) {
  const language = content.language;
  const pick = <T,>(en: T, id: T, zh: T): T => (language === 'ID' ? id : language === 'ZH' ? zh : en);
  const titles: Record<keyof DigestContent['sections'], string> = {
    noticeDeadlines: pick('Notice deadlines coming up', 'Tenggat pemberitahuan mendatang', '即将到来的通知期限'),
    expiring: pick('Expiring contracts and orders', 'Kontrak dan order yang segera berakhir', '即将到期的合同和订单'),
    pendingApprovals: pick('Pending approvals', 'Persetujuan menunggu', '待处理的审批'),
    overdue: pick('Overdue', 'Terlambat', '已逾期'),
  };
  const when = (item: DigestItem) => item.days === null ? '' : item.days < 0 ? pick(`${item.date} (${-item.days} days ago)`, `${item.date} (${-item.days} hari lalu)`, `${item.date}（${-item.days} 天前）`)
    : item.days === 0 ? pick(`${item.date} (today)`, `${item.date} (hari ini)`, `${item.date}（今天）`) : pick(`${item.date} (in ${item.days} days)`, `${item.date} (${item.days} hari lagi)`, `${item.date}（${item.days} 天后）`);
  let details = '';
  for (const key of ['overdue', 'noticeDeadlines', 'expiring', 'pendingApprovals'] as const) {
    const items = content.sections[key];
    if (!items.length) continue;
    details += `<tr><td colspan="2" style="padding:12px 8px 6px 8px;font-weight:bold;color:#0f172a;">${escapeHtml(titles[key])} (${items.length})</td></tr>`;
    for (const item of items.slice(0, MAX_ITEMS_PER_SECTION)) {
      details += `<tr><td style="padding:6px 8px;border-bottom:1px solid #F1F5F9;color:#475569;">${escapeHtml(item.reference)} — ${escapeHtml(item.title)}</td><td style="padding:6px 8px;border-bottom:1px solid #F1F5F9;font-weight:600;">${escapeHtml(when(item))}</td></tr>`;
    }
    if (items.length > MAX_ITEMS_PER_SECTION) details += `<tr><td colspan="2" style="padding:6px 8px;color:#64748b;">${escapeHtml(pick(`+ ${items.length - MAX_ITEMS_PER_SECTION} more`, `+ ${items.length - MAX_ITEMS_PER_SECTION} lainnya`, `另有 ${items.length - MAX_ITEMS_PER_SECTION} 项`))}</td></tr>`;
  }
  const label = frequency === 'daily' ? pick('daily', 'harian', '每日') : pick('weekly', 'mingguan', '每周');
  return {
    subject: pick(`[${frequency === 'daily' ? 'Daily' : 'Weekly'} digest] ${orgName}`, `[Ringkasan ${label}] ${orgName}`, `【${label}摘要】${orgName}`),
    heading: pick(`Your ${label} digest`, `Ringkasan ${label} Anda`, `您的${label}摘要`),
    intro: pick(`What needs your attention in ${orgName} (next ${content.windowDays} days).`, `Hal yang perlu perhatian Anda di ${orgName} (${content.windowDays} hari ke depan).`, `${orgName} 中需要您关注的事项（未来 ${content.windowDays} 天）。`),
    details, brandColor, organizationName: orgName,
    actionLabel: pick('Open Legalio', 'Buka Legalio', '打开 Legalio'), actionUrl: `${base}/app`,
    footer: pick(`Automated e-mail from Legalio for ${orgName}.`, `E-mail otomatis dari Legalio untuk ${orgName}.`, `此邮件由 Legalio 为 ${orgName} 自动发送。`),
    unsubscribeUrl, unsubscribeLabel: pick('Unsubscribe from this digest', 'Berhenti berlangganan ringkasan ini', '退订此摘要'),
  };
}

/* ------------------------------ scheduling and delivery ------------------------------ */

export interface DigestDeps {
  smtpAvailable: () => boolean;
  send: (input: { to: string; subject: string; html: string; headers?: Record<string, string> }) => Promise<{ success: boolean; error?: string }>;
  render: (values: Record<string, string>) => Promise<{ subject: string; html: string }>;
  publicUrl: () => string;
  now?: () => Date;
}

export const unsubscribeUrl = (base: string, token: string) => `${base.replace(/\/$/, '')}/api/digest/unsubscribe?token=${encodeURIComponent(token)}`;

/** Writes the ledger rows that are due: one per member, frequency and period whose send time has come (and not before their opt-in). */
export async function enqueueDueDigests(db: Sql, now = new Date()): Promise<number> {
  let queued = 0;
  const orgs = await db.all<{ organization_id: string }>(`SELECT organization_id FROM digest_defaults WHERE frequency <> 'off' UNION SELECT organization_id FROM digest_preferences WHERE frequency IN ('daily', 'weekly')`);
  for (const { organization_id: organizationId } of orgs) {
    const defaults = await getDigestDefaults(db, organizationId);
    const timeZone = (await readOrganizationSettings(db, organizationId)).policy.timezone || 'UTC';
    const members = await db.all(`
      SELECT m."userId" AS user_id, p.frequency AS preference, p.effective_from AS preference_from FROM member m JOIN "user" u ON u.id = m."userId"
      LEFT JOIN digest_preferences p ON p.organization_id = m."organizationId" AND p.user_id = m."userId"
      WHERE m."organizationId" = ? AND m.status = 'active' AND u.banned IS NOT TRUE AND u.email IS NOT NULL`, organizationId);
    for (const member of members) {
      const own = member.preference && member.preference !== 'inherit';
      const frequency = own ? member.preference : defaults.frequency;
      if (frequency !== 'daily' && frequency !== 'weekly') continue;
      const effectiveFrom = Date.parse((own ? member.preference_from : defaults.effectiveFrom) ?? '') || 0;
      const period = periodOf(frequency, now.getTime(), timeZone, defaults.weekday, defaults.hour);
      if (now.getTime() < period.scheduledAt || now.getTime() >= period.endsAt) continue;
      // A choice made after this period's send time starts with the next period.
      if (effectiveFrom > period.scheduledAt) continue;
      const iso = now.toISOString();
      const inserted = await db.run(`INSERT INTO digest_ledger (id, organization_id, user_id, frequency, period_key, status, next_attempt_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?) ON CONFLICT (organization_id, user_id, frequency, period_key) DO NOTHING`,
        `dgl_${crypto.randomUUID()}`, organizationId, member.user_id, frequency, period.key, iso, iso, iso);
      queued += inserted.changes;
    }
  }
  return queued;
}

export interface DigestDelivery { attempted: number; sent: number; failed: number; dead: number; skipped: number }

export async function deliverDigests(db: Sql, deps: DigestDeps, options: { limit?: number; maxAttempts?: number } = {}): Promise<DigestDelivery> {
  const now = deps.now?.() ?? new Date();
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const rows = await db.all(`SELECT * FROM digest_ledger WHERE status IN ('pending', 'failed') AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at LIMIT ?`, now.toISOString(), options.limit ?? 200);
  const result: DigestDelivery = { attempted: 0, sent: 0, failed: 0, dead: 0, skipped: 0 };
  const settle = (id: string, status: string, error: string | null, next: string | null) =>
    db.run(`UPDATE digest_ledger SET status = ?, last_error = ?, next_attempt_at = ?, updated_at = ?, sent_at = ? WHERE id = ?`, status, error, next, new Date().toISOString(), status === 'sent' ? new Date().toISOString() : null, id);
  for (const row of rows) {
    const claimed = await db.run(`UPDATE digest_ledger SET attempts = attempts + 1, updated_at = ? WHERE id = ? AND attempts = ? AND status IN ('pending', 'failed')`, new Date().toISOString(), row.id, row.attempts);
    if (!claimed.changes) continue;
    result.attempted++;
    const attempts = row.attempts + 1;
    try {
      if (!deps.smtpAvailable()) { await settle(row.id, 'skipped', 'SMTP relay disabled', null); result.skipped++; continue; }
      // The member may have opted out since the row was written.
      const preference = await getPreference(db, row.organization_id, row.user_id);
      if (preference.effective !== row.frequency) { await settle(row.id, 'skipped', 'The member no longer receives this digest', null); result.skipped++; continue; }
      const user = await db.get(`SELECT email, banned FROM "user" WHERE id = ?`, row.user_id);
      const content = await buildDigest(db, row.organization_id, row.user_id, now);
      if (!content || !user?.email || user.banned === true) { await settle(row.id, 'skipped', 'The member cannot receive e-mail here any more', null); result.skipped++; continue; }
      if (content.empty) { await settle(row.id, 'skipped', 'Nothing to report', null); result.skipped++; continue; }
      const settings = await readOrganizationSettings(db, row.organization_id);
      const base = deps.publicUrl().replace(/\/$/, '');
      const link = unsubscribeUrl(base, signUnsubscribeToken(row.organization_id, row.user_id));
      const brand = /^#[0-9a-f]{6}$/i.test(settings.profile.primaryColor || '') ? settings.profile.primaryColor : '#2563eb';
      const values = digestMailValues(content, row.frequency, settings.profile.brandName || settings.name, brand, base, link);
      const mail = await deps.render(values);
      const sent = await deps.send({ to: user.email, subject: mail.subject, html: mail.html, headers: { 'List-Unsubscribe': `<${link}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
      if (sent.success) { await settle(row.id, 'sent', null, null); result.sent++; continue; }
      throw new Error(sent.error || 'The mail relay refused the message.');
    } catch (err) {
      const message = ((err as Error)?.message || String(err)).slice(0, 500);
      if (attempts >= maxAttempts) { await settle(row.id, 'dead', message, null); result.dead++; log.error(`Digest abandoned after ${attempts} attempts: ${message}`); }
      else { await settle(row.id, 'failed', message, new Date(now.getTime() + backoffMs(attempts)).toISOString()); result.failed++; }
    }
  }
  return result;
}

export async function runDigestPass(db: Sql, deps: DigestDeps) {
  const queued = await enqueueDueDigests(db, deps.now?.() ?? new Date());
  const delivery = await deliverDigests(db, deps);
  return { queued, delivery };
}
