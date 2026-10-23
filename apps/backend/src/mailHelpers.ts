import nodemailer from 'nodemailer';
import { createMailTemplateStore } from './mailTemplateStore';
import { sql } from './db';
import { db, DEFAULT_BRANDING } from './memoryDb';
import { smtpTlsOptions } from './smtpTls';
import { IS_TEST_MODE } from './runtimePaths';
import { setVerificationMailer } from './lib/auth';
import { computeLifecycle, getTenantSettings, findTenant, tenantDisplayName } from './tenantPolicy';
import { getCountryPack, getIndustryPack } from '@legalio/shared/policy';
import { normalizeCurrencyCode } from '@legalio/shared/currencyUtils';
import { componentLog } from './logger';
const log = componentLog('mailHelpers');

/** Platform e-mail: SMTP relay delivery, tenant-language formatting, the reminder e-mail and the verification mailer hook. */

export const mailTemplates = createMailTemplateStore(sql);
export async function sendSmtpEmail({
  to,
  subject,
  html,
  text,
}: {
  to: any;
  subject: any;
  html?: any;
  text?: any;
}) {
  const config = db.googleConfig;
  if (!config.smtpEnabled || !config.smtpHost || !config.smtpUser) {
    return {
      success: false,
      error: "SMTP Relay belum diaktifkan atau belum dikonfigurasi.",
    };
  }
  try {
    const port = Number(config.smtpPort) || (config.smtpSecure ? 465 : 587);
    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port,
      secure: config.smtpSecure ?? port === 465,
      auth: { user: config.smtpUser, pass: config.smtpPassword || "" },
      tls: smtpTlsOptions(config),
    });
    const fromAddress = config.smtpFromEmail || config.smtpUser;
    const fromName = config.smtpFromName || "Sistem Notifikasi Kontrak & IO";
    const from = `"${fromName}" <${fromAddress}>`;
    const recipients = Array.isArray(to) ? to.join(", ") : to;
    const info = await transporter.sendMail({
      from,
      to: recipients,
      subject,
      text: text || html.replace(/<[^>]*>/g, ""),
      html,
    });
    log.info(
      `[SMTP Relay] Email successfully sent to ${recipients} (MessageId: ${info.messageId})`,
    );
    return { success: true, messageId: info.messageId };
  } catch (err) {
    log.error("[SMTP Relay Error]", err);
    return { success: false, error: err.message || String(err) };
  }
}
/** Platform mail delivery used after commit; false when not delivered (never throws). */
export async function sendPlatformMail(input: { to: string; subject: string; html: string }): Promise<boolean> {
  if (IS_TEST_MODE) return false;
  const result = await sendSmtpEmail(input);
  return Boolean(result?.success);
}
setVerificationMailer(async ({ email, name, url }) => {
  const sent = await sendPlatformMail({ to: email, ...await mailTemplates.render('verification', { email, name, url }) });
  if (!sent) throw new Error("Verification email delivery is unavailable.");
});
export function daysUntilForTenant(tenantId: string | null | undefined, date: string): number | null {
  return computeLifecycle(tenantId, date, "Active").daysRemaining;
}
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
/** Formatting locale for a tenant's e-mail/document language. */
export function localeForTenantLanguage(settings: ReturnType<typeof getTenantSettings>): string {
  if (settings.language === "ID") return "id-ID";
  if (settings.language === "ZH") return "zh-CN";
  return getCountryPack(settings.countryCode).formattingLocale;
}
export function formatAmountForTenant(amount: unknown, currency: string, tenantId?: string | null): string {
  const settings = getTenantSettings(tenantId);
  const locale = localeForTenantLanguage(settings);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: normalizeCurrencyCode(currency, settings.defaultCurrency) }).format(Number(amount) || 0);
  } catch {
    return `${currency} ${Number(amount) || 0}`;
  }
}
/** Reminder e-mail in the tenant's language, with its own name and colour. */
export async function buildReminderEmail(params: {
  tenantId: string;
  kind: "contract" | "commercial";
  reference: string;
  title: string;
  endDate: string;
  daysRemaining: number;
  rows: Array<[string, string]>;
  variant?: "offset" | "notice";
}): Promise<{ subject: string; html: string }> {
  const settings = getTenantSettings(params.tenantId);
  const tenant = findTenant(params.tenantId);
  const brandColor = /^#[0-9a-f]{6}$/i.test(tenant?.primaryColor || "") ? tenant.primaryColor : DEFAULT_BRANDING.primaryColor;
  const orgName = tenantDisplayName(params.tenantId);
  // en/id/zh in that order, matching settings.language.
  const pick = <T,>(en: T, id: T, zh: T): T => (settings.language === "ID" ? id : settings.language === "ZH" ? zh : en);
  const docLabel = params.kind === "contract"
    ? pick("Contract", "Kontrak", "合同")
    : getIndustryPack(settings.industry).commercialDocument.label;
  const notice = params.variant === "notice";
  const subject = notice ? pick(
    `[Notice deadline] ${docLabel} ${params.reference} — ${params.title}`,
    `[Batas pemberitahuan] ${docLabel} ${params.reference} — ${params.title}`,
    `【通知期限】${docLabel} ${params.reference} — ${params.title}`,
  ) : pick(
    `[${params.daysRemaining}-day reminder] ${docLabel} ${params.reference} — ${params.title}`,
    `[Pengingat ${params.daysRemaining} hari] ${docLabel} ${params.reference} — ${params.title}`,
    `【提醒：还剩 ${params.daysRemaining} 天】${docLabel} ${params.reference} — ${params.title}`,
  );
  const heading = notice
    ? pick(`${docLabel} notice deadline reached`, `Batas pemberitahuan ${docLabel} tiba`, `${docLabel}通知期限已到`)
    : pick(`${docLabel} approaching expiry`, `${docLabel} akan berakhir`, `${docLabel}即将到期`);
  const intro = notice ? pick(
    `The notice deadline for the following ${docLabel.toLowerCase()} has arrived (${params.daysRemaining} days until expiry). Send any required renewal or termination notice now.`,
    `Batas pemberitahuan untuk ${docLabel} berikut telah tiba (sisa ${params.daysRemaining} hari hingga berakhir). Kirim pemberitahuan perpanjangan atau pengakhiran yang diperlukan sekarang.`,
    `以下${docLabel}的通知期限已到（距到期还有 ${params.daysRemaining} 天），请立即发出所需的续约或终止通知。`,
  ) : pick(
    `The following ${docLabel.toLowerCase()} expires in ${params.daysRemaining} days. Please review any notice, renewal or termination action required.`,
    `${docLabel} berikut akan berakhir dalam ${params.daysRemaining} hari. Mohon tinjau kebutuhan pemberitahuan, perpanjangan, atau pengakhiran.`,
    `以下${docLabel}将在 ${params.daysRemaining} 天后到期，请审阅所需的通知、续约或终止事项。`,
  );
  const tableRows = [
    [pick("Reference", "Nomor", "编号"), params.reference],
    [pick("Title", "Judul", "名称"), params.title],
    [pick("End date", "Tanggal berakhir", "结束日期"), params.endDate],
    ...params.rows,
  ]
    .map(([k, v]) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #F1F5F9;color:#475569;width:35%;">${escapeHtml(k)}</td><td style="padding:6px 8px;border-bottom:1px solid #F1F5F9;font-weight:600;">${escapeHtml(v)}</td></tr>`)
    .join("");
  const footer = pick(
    `Automated e-mail from Legalio for ${orgName}.`,
    `E-mail otomatis dari Legalio untuk ${orgName}.`,
    `此邮件由 Legalio 为 ${orgName} 自动发送。`,
  );
  return await mailTemplates.render(params.kind === 'contract' ? 'contract-reminder' : 'commercial-reminder', {
    subject, heading, intro, brandColor, details: tableRows, footer, organizationName: orgName,
    reference: params.reference, title: params.title, endDate: params.endDate, daysRemaining: String(params.daysRemaining),
  }, ['details']);
}
