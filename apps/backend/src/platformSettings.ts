import { ApiError, appendAudit } from './organizationSettingsStore';
import { db, DEFAULT_BRANDING, coreSaver, normalizeStoredPartners, refreshTenantProjection, saveDb } from './memoryDb';
import { withCurrentUiTextKeys } from './uiTextKeys';
import { UITextOverrides } from '@legalio/types/uiTexts';
import { getEffectiveGeminiApiKey, getValidAiModel } from './aiClient';
import { auditActorFor } from './organizationAdminRoutes';
import { sql } from './db';
import { recalculateStatuses } from './reminderJobs';
/** Platform configuration (SMTP, AI) read/written through strict sections, provider-secret masking, and organization-change projections. */

/*
 * Provider secrets never leave the server (PRD §5.1). Clients receive a
 * masked hint; a masked value posted back means "keep the stored secret".
 */
export const SECRET_MASK_CHAR = "•";
export function maskSecret(value: unknown): string {
  const text = String(value ?? "");
  if (!text) return "";
  return `${SECRET_MASK_CHAR.repeat(8)}${text.length > 8 ? text.slice(-4) : ""}`;
}
export function isMaskedSecret(value: unknown): boolean {
  const text = String(value ?? "");
  return text.includes(SECRET_MASK_CHAR) || /^\*{4,}$/.test(text);
}
export function redactProviderConfig(config: any) {
  const { accessToken, refreshToken, smtpPassword, geminiApiKey, ...rest } = config || {};
  return {
    ...rest,
    geminiApiKey: maskSecret(geminiApiKey),
    hasGeminiApiKey: Boolean(geminiApiKey),
    smtpPassword: maskSecret(smtpPassword),
    hasSmtpPassword: Boolean(smtpPassword),
  };
}
/*
 * Platform configuration (PRD §7.1, §7.5, §9.4): deployment branding, the
 * AI provider/model and SMTP relay. Platform-only;
 * tenant settings never read this. Secrets are write-only: omitted keeps the
 * stored value, a non-empty string replaces it, explicit null clears it.
 */
export function platformConfigError(message: string): never {
  throw new ApiError(400, "INVALID_INPUT", message);
}
export function readPlatformConfiguration() {
  const g = db.googleConfig || {};
  const b = { ...DEFAULT_BRANDING, ...(db.branding || {}) };
  return {
    uiTexts: { overrides: withCurrentUiTextKeys(g.uiTextOverrides || { ID: {}, EN: {}, ZH: {} }) as UITextOverrides },
    branding: { appName: b.appName, logoUrl: b.logoUrl, primaryColor: b.primaryColor, footerText: b.footerText, loginHeadline: b.loginHeadline },
    ai: { aiModel: g.aiModel || "gemini-3.8-flash", hasGeminiApiKey: Boolean(getEffectiveGeminiApiKey()) },
    smtp: {
      smtpEnabled: Boolean(g.smtpEnabled), smtpHost: g.smtpHost || "", smtpPort: g.smtpPort ?? null,
      smtpSecure: Boolean(g.smtpSecure), smtpAllowSelfSigned: Boolean(g.smtpAllowSelfSigned), smtpUser: g.smtpUser || "", smtpFromEmail: g.smtpFromEmail || "",
      smtpFromName: g.smtpFromName || "", hasSmtpPassword: Boolean(g.smtpPassword),
    },
  };
}
export const PLATFORM_SECTIONS: Record<string, string[]> = {
  uiTexts: ['overrides', 'reset'],
  branding: ["appName", "logoUrl", "primaryColor", "footerText", "loginHeadline"],
  ai: ["aiModel", "geminiApiKey"],
  smtp: ["smtpEnabled", "smtpHost", "smtpPort", "smtpSecure", "smtpAllowSelfSigned", "smtpUser", "smtpPassword", "smtpFromEmail", "smtpFromName"],
};
export function validatePlatformValue(section: string, key: string, value: unknown): unknown {
  const str = (max: number) => {
    if (typeof value !== "string" || value.trim().length > max) platformConfigError(`${key} must be text up to ${max} characters.`);
    return (value as string).trim();
  };
  switch (`${section}.${key}`) {
    case 'uiTexts.reset':
      if (value !== true) platformConfigError('reset must be true.');
      return true;
    case 'uiTexts.overrides': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) platformConfigError('overrides must be a language dictionary.');
      const result: Partial<UITextOverrides> = {};
      for (const [language, catalog] of Object.entries(value)) {
        if (!['ID', 'EN', 'ZH'].includes(language) || !catalog || typeof catalog !== 'object' || Array.isArray(catalog)) platformConfigError('Supported UI languages are ID, EN and ZH.');
        const entries = Object.entries(catalog);
        if (entries.length > 10_000) platformConfigError('A dictionary can contain up to 10000 texts per language.');
        for (const [textKey, text] of entries) {
          if (!/^[\w.-]{1,160}$/.test(textKey) || ['__proto__', 'prototype', 'constructor'].includes(textKey) || typeof text !== 'string' || text.length > 10_000) platformConfigError('Each UI text needs a valid key and text up to 10000 characters.');
        }
        result[language as keyof UITextOverrides] = Object.fromEntries(entries) as Record<string, string>;
      }
      return result;
    }
    case "branding.appName": case "branding.loginHeadline": return str(200);
    case "branding.footerText": return str(500);
    case "branding.primaryColor": {
      const v = str(7);
      if (!/^#[0-9a-fA-F]{6}$/.test(v)) platformConfigError("primaryColor must be a six-digit hex color.");
      return v;
    }
    case "branding.logoUrl": {
      const v = str(2048);
      if (v && !(v.startsWith("/") && !v.startsWith("//")) && !/^https:\/\//i.test(v)) platformConfigError("logoUrl must be an HTTPS URL or a path on this site.");
      if (/[<>"'\s]/.test(v)) platformConfigError("logoUrl is invalid.");
      return v;
    }
    case "ai.aiModel": return getValidAiModel(str(100));
    case "smtp.smtpEnabled": case "smtp.smtpSecure": case "smtp.smtpAllowSelfSigned":
      if (typeof value !== "boolean") platformConfigError(`${key} must be true or false.`);
      return value;
    case "smtp.smtpPort":
      if (value === null) return null;
      if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 65535) platformConfigError("smtpPort must be 1–65535.");
      return value;
    case "smtp.smtpHost": case "smtp.smtpUser": case "smtp.smtpFromName": return str(254);
    case "smtp.smtpFromEmail": {
      const v = str(254);
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) platformConfigError("smtpFromEmail is not a valid email address.");
      return v;
    }
  }
  platformConfigError(`Unknown field: ${section}.${key}`);
}
export async function applyPlatformConfiguration(section: unknown, values: unknown, actor: ReturnType<typeof auditActorFor>) {
  if (typeof section !== "string" || !Object.hasOwn(PLATFORM_SECTIONS, section)) platformConfigError("section must be branding, ai, smtp or uiTexts.");
  if (!values || typeof values !== "object" || Array.isArray(values)) platformConfigError("values must be an object.");
  const allowed = PLATFORM_SECTIONS[section as string];
  const input = values as Record<string, unknown>;
  if (section === 'uiTexts' && input.reset !== undefined && input.overrides !== undefined) platformConfigError('Choose overrides or reset.');
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.includes(key)) platformConfigError(`Unknown field: ${section}.${key}`);
    if (key === "geminiApiKey" || key === "smtpPassword") {
      if (value === undefined) continue;
      if (value === null) { next[key] = ""; continue; }
      if (typeof value !== "string" || !value.trim() || value.length > 512) platformConfigError(`${key} must be a non-empty string or null.`);
      next[key] = value.trim();
      continue;
    }
    next[key] = validatePlatformValue(section as string, key, value);
  }
  const before = JSON.stringify({ branding: db.branding, googleConfig: db.googleConfig });
  if (section === 'uiTexts') {
    const overrides: UITextOverrides = { ID: {}, EN: {}, ZH: {} };
    if (!next.reset) {
      const current = readPlatformConfiguration().uiTexts.overrides;
      for (const language of ['ID', 'EN', 'ZH'] as const) {
        const merged = { ...current[language], ...(next.overrides as Partial<UITextOverrides>)?.[language] };
        overrides[language] = Object.fromEntries(Object.entries(merged).filter(([, text]) => text !== ''));
        if (Object.keys(overrides[language]).length > 10_000) platformConfigError('A dictionary can contain up to 10000 texts per language.');
      }
    }
    db.googleConfig = { ...(db.googleConfig || {}), uiTextOverrides: overrides };
  }
  else if (section === "branding") db.branding = { ...DEFAULT_BRANDING, ...(db.branding || {}), ...next };
  else db.googleConfig = { ...(db.googleConfig || {}), ...next };
  if (section === "ai" && next.geminiApiKey !== undefined) process.env.GEMINI_API_KEY = String(next.geminiApiKey);
  try {
    await coreSaver.save(() => appendAudit(sql, actor, {
      organizationId: null, action: "platform.configuration.update", targetType: "installation", targetId: "installation",
      outcome: "success", changedFields: Object.keys(next).map((k) => `${section}.${k}`),
    }));
  } catch (err) {
    const restored = JSON.parse(before);
    db.branding = restored.branding;
    db.googleConfig = restored.googleConfig;
    throw err;
  }
  return (readPlatformConfiguration() as any)[section as string];
}
/** Committed organization change: rebuild projections and re-derive policy-dependent state. */
export async function onOrganizationChanged(organizationId: string) {
  await refreshTenantProjection();
  // The due-diligence checklist follows the organization's policy packs.
  await normalizeStoredPartners(organizationId);
  await recalculateStatuses();
  await saveDb();
}
