import express from 'express';
import { db } from './memoryDb';
import { PublicError } from './apiErrors';
import { GoogleGenAI, Type } from '@google/genai';
import { runModelChain, recordAiTokens, currentAiOrganization, aiLimitsFromEnv, AiRateLimiter, reserveAiCall, AiLimitError } from './aiLimits';
import { sql } from './db';
import { getTenantSettings } from './tenantPolicy';
import { getRequestTenantId } from './recordAccess';
import { setCachedTranscript } from './lib/cheapOcrPipeline';
import { componentLog } from './logger';
const log = componentLog('aiClient');

/** The Gemini client wrapper: key and model selection, retry/fallback chain with curated errors, per-organization budgets. */

export function getEffectiveGeminiApiKey() {
  return (
    db.googleConfig?.geminiApiKey ||
    process.env.GEMINI_API_KEY ||
    ""
  ).trim();
}
export function getGenAIClient(apiKey?: string) {
  const effectiveKey = (apiKey || getEffectiveGeminiApiKey()).trim();
  if (!effectiveKey) {
    throw new PublicError(
      "Missing GEMINI_API_KEY. Silakan masukkan Gemini API Key di menu Pengaturan (Settings) > Model AI & Parser.",
      500,
      "AI_NOT_CONFIGURED",
    );
  }
  return new GoogleGenAI({
    apiKey: effectiveKey,
    httpOptions: { headers: { "User-Agent": "aistudio-build" } },
  });
}
export function getValidAiModel(requestedModel) {
  const allowed = [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.1-pro-preview",
    "gemini-2.5-flash",
  ];
  if (requestedModel === "gemini-2.0-flash" || requestedModel === "gemini-1.5-flash") return "gemini-3.8-flash";
  if (requestedModel === "gemini-3.5-flash-lite") return "gemini-3.5-flash";
  if (requestedModel && allowed.includes(requestedModel)) {
    return requestedModel;
  }
  if (db.googleConfig?.aiModel && allowed.includes(db.googleConfig.aiModel)) {
    return db.googleConfig.aiModel;
  }
  return "gemini-3.8-flash";
}
/**
 * Turns a raw Gemini SDK error into one concise, actionable sentence with a
 * troubleshooting step — never the raw error object, whose `.message` is
 * frequently the entire HTTP error body as a JSON string (e.g.
 * `{"error":{"code":400,"message":"API key not valid...","status":"INVALID_ARGUMENT",...}}`)
 * and would otherwise leak straight through to the UI as-is.
 */
export function formatGeminiError(err: any): string {
  const raw = String(err?.message || err?.toString?.() || "");
  let apiMessage = raw;
  const jsonStart = raw.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart));
      apiMessage = parsed?.error?.message || parsed?.message || apiMessage;
    } catch {
      /* not JSON — use the raw message as-is */
    }
  }
  const lower = `${raw} ${apiMessage}`.toLowerCase();

  if (lower.includes("api key not valid") || lower.includes("api_key_invalid") || lower.includes("invalid api key")) {
    return "API Key Gemini tidak valid. Periksa kembali di Settings > Model AI & Parser — pastikan tersalin utuh tanpa spasi, dan key tersebut masih aktif di Google AI Studio.";
  }
  if (lower.includes("resource_exhausted") || lower.includes("quota") || lower.includes("429")) {
    return "Batas kuota Gemini API Key telah terlampaui (Quota Exceeded / Rate Limit). Periksa akun Google AI Studio atau perbarui API Key di Settings > Model AI & Parser.";
  }
  if (lower.includes("permission_denied") || lower.includes("403")) {
    return "Akses ke Gemini API ditolak. Pastikan API Key memiliki izin Generative Language API dan billing/kuota project aktif di Google AI Studio.";
  }
  if (lower.includes("not_found") || lower.includes("404")) {
    return "Model AI tidak ditemukan atau tidak didukung oleh API Key ini. Coba pilih model lain di Settings > Model AI & Parser.";
  }
  if (lower.includes("unavailable") || lower.includes("503") || lower.includes("timeout") || lower.includes("deadline")) {
    return "Google Gemini API sedang tidak merespons. Periksa koneksi internet Anda, lalu coba lagi beberapa saat lagi.";
  }
  const short = apiMessage.split("\n")[0].slice(0, 160);
  return `Google Gemini API mengembalikan error: ${short}. Periksa koneksi internet dan status API Key di Settings > Model AI & Parser, lalu coba lagi.`;
}
export async function generateContentWithRetryAndFallback(params: any) {
  const apiKey = getEffectiveGeminiApiKey();
  if (!apiKey) {
    throw new PublicError(
      "Missing GEMINI_API_KEY. Silakan masukkan Gemini API Key di menu Pengaturan (Settings) > Model AI & Parser.",
      500,
      "AI_NOT_CONFIGURED",
    );
  }
  const aiClient = getGenAIClient(apiKey);
  const primaryModel = getValidAiModel(params.model);
  const candidateFallbacks = [
    "gemini-3.1-flash-lite",
    "gemini-3.7-flash",
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
  ];
  // At most aiLimits.maxAttempts (3) models are tried: the primary and the first fallbacks.
  const models = [primaryModel, ...candidateFallbacks.filter((m) => m !== primaryModel)];
  try {
    const response = await runModelChain({
      models,
      limits: aiLimits,
      call: (model, signal) => {
        log.info(`[Gemini API] Processing request with model=${model}...`);
        // abortSignal cancels the HTTP request itself when the attempt times out.
        return aiClient.models.generateContent({ ...params, model, config: { ...(params.config || {}), abortSignal: signal } });
      },
      onAttemptFailed: (model, err, attempt) =>
        log.warn(`[Gemini API] Model ${model} failed on attempt ${attempt}/${Math.min(aiLimits.maxAttempts, models.length)} (${String((err as any)?.message || err).toLowerCase().slice(0, 120)})`),
    });
    log.info("[Gemini API] Success");
    await recordAiTokens(sql, currentAiOrganization(), Number((response as any)?.usageMetadata?.totalTokenCount) || 0)
      .catch((err) => log.warn("Could not record AI token usage:", err));
    return response;
  } catch (lastError) {
    throw new PublicError(formatGeminiError(lastError), 500, "AI_PROVIDER_ERROR");
  }
}
/**
 * AI is an optional, per-tenant capability (PRD §4.1, §5.1): it needs a
 * configured provider key AND the tenant's `aiAssistant` module switched on.
 */
/** Per-organization AI limits; read from AI_* env once (see aiLimits.ts). */
export const aiLimits = aiLimitsFromEnv();
export const aiRateLimiter = new AiRateLimiter();
export async function ensureAiAvailable(req: express.Request, res: express.Response): Promise<boolean> {
  const settings = getTenantSettings(getRequestTenantId(req));
  if (!settings.modules.aiAssistant) {
    res.status(403).json({ error: "AI_DISABLED", message: "AI features are disabled for this organization." });
    return false;
  }
  if (!getEffectiveGeminiApiKey()) {
    res.status(400).json({ error: "AI_NOT_CONFIGURED", message: "The AI assistant is not available. Ask your platform administrator to configure a provider." });
    return false;
  }
  try {
    // One AI request counts against the organization's per-minute rate and daily budget (cached results included).
    await reserveAiCall(sql, getRequestTenantId(req), aiLimits, aiRateLimiter);
  } catch (err) {
    if (!(err instanceof AiLimitError)) throw err;
    log.warn(`AI request refused for ${getRequestTenantId(req)}: ${err.code}`);
    res.set("Retry-After", String(err.retryAfterSeconds)).status(429).json({ error: err.code, message: err.message, retryAfterSeconds: err.retryAfterSeconds });
    return false;
  }
  return true;
}
/**
 * Adds an optional `document_text` field to a parse route's response schema,
 * but only when OCR ran in vision mode (a scanned/image document, the
 * expensive path). Vision mode already has Gemini "read" the whole document
 * to extract task-specific fields, so asking it to also return the plain
 * transcript is a free byproduct of a call that's happening anyway — that
 * transcript then gets cached (see `extractAndCacheDocumentTranscript`
 * below), so the NEXT analysis of the same file (any feature, not just this
 * one) skips OCR/vision entirely via `getCachedTranscript`. Digital-text PDFs
 * don't need this: `buildCheapOcrContents` already caches their transcript
 * for free, since local PDF text extraction cost nothing extra to begin with.
 */
export function withDocumentTranscriptField(schema: any, ocrMode: "text" | "vision"): any {
  if (ocrMode !== "vision") return schema;
  return {
    ...schema,
    properties: {
      ...schema.properties,
      document_text: {
        type: Type.STRING,
        description:
          "The full plain-text transcript of the entire document, verbatim, all pages — used to cache this document's content so future analyses of the same file don't need to re-read it.",
      },
    },
  };
}
/** Pulls `document_text` out of a parsed AI response, caches it by file hash, and
 * strips it from the object so it never leaks into the API response or the
 * per-task result cache (which would otherwise duplicate the whole transcript). */
export async function extractAndCacheDocumentTranscript(parsedData: any, fileHash: string): Promise<void> {
  const text = parsedData?.document_text;
  if (typeof text === "string" && text.trim()) {
    await setCachedTranscript(fileHash, text);
  }
  delete parsedData?.document_text;
}
