import { getTenantSettings, aiPolicyContext, computeLifecycle } from '../tenantPolicy';
import { getIndustryPack } from '@legalio/shared/policy';
import { generateContentWithRetryAndFallback, getEffectiveGeminiApiKey, getValidAiModel, formatGeminiError, ensureAiAvailable, aiLimits } from '../aiClient';
import { getRequestTenantId, scopeOf, orgContextOf } from '../recordAccess';
import { db, saveDb } from '../memoryDb';
import { sendRouteError } from '../apiErrors';
import { isMaskedSecret } from '../platformSettings';
import { GoogleGenAI } from '@google/genai';
import { RecordKind, recordVisible } from '../recordScope';
import { readBusinessRows } from '../normalizedCoreStore';
import { contractRepository } from '../repositories/contractRepository';
import { sql } from '../db';
import { boundChatHistory, boundWorkspaceContext } from '../aiLimits';
import express from 'express';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { componentLog } from '../logger';
const log = componentLog('ai');

export function createAiRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);

// Dashboard news ticker (optional module, off by default): 5 short
// regulatory headlines for the tenant's industry and country, written in the
// tenant's configured language (Settings > Organization & region). Refreshed
// via the AI provider at most once every 7 days, cached per tenant, and
// regenerated immediately if the tenant's language or industry pack changes.
const NEWS_TICKER_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
function newsTickerPrompt(tenantId: string, grounded: boolean): string {
  const settings = getTenantSettings(tenantId);
  const ctx = aiPolicyContext(tenantId);
  const topic = getIndustryPack(settings.industry).newsTopic;
  const regulators = ctx.regulators.length > 0 ? ` Prioritise updates from: ${ctx.regulators.join(", ")}.` : "";
  return `You are a regulatory research assistant. ${grounded ? "Use Google Search to find" : "From your knowledge, describe"} RECENT developments (last few months) in ${topic} relevant to organizations operating in ${ctx.countryName}.${regulators}

Write EXACTLY 5 short news-ticker headlines (at most about 20 words each) in ${ctx.responseLanguage}.

Output format: ONLY the 5 headlines separated by " | " (space-pipe-space), no numbering, no markdown, no introduction or closing.

${grounded ? "Every headline must be supported by the search results." : "Speak in general terms."} Never invent regulation numbers or dates you are not certain of.`;
}

async function generateNewsTickerText(tenantId: string): Promise<string> {
  try {
    const response = await generateContentWithRetryAndFallback({
      contents: newsTickerPrompt(tenantId, true),
      config: { tools: [{ googleSearch: {} }] },
    });
    return String((response as any).text || "").trim();
  } catch (groundedErr: any) {
    // The search-grounding tool has a much stricter quota than plain
    // generation; fall back to an un-grounded call rather than failing.
    log.warn(
      `[News Ticker] Grounded generation failed (${(groundedErr?.message || "").slice(0, 160)}), falling back to plain generation...`,
    );
    const response = await generateContentWithRetryAndFallback({
      contents: newsTickerPrompt(tenantId, false),
    });
    return String((response as any).text || "").trim();
  }
}

app.get("/api/dashboard/news-ticker", async (req: express.Request, res: express.Response) => {
  const tenantId = getRequestTenantId(req);
  const settings = getTenantSettings(tenantId);
  if (!settings.modules.newsTicker || !settings.modules.aiAssistant) {
    return res.json({ items: [], disabled: true });
  }
  if (!db.newsTicker || typeof db.newsTicker !== "object" || !db.newsTicker.byTenant) {
    db.newsTicker = { byTenant: {} };
  }
  const ticker = db.newsTicker.byTenant[tenantId] || { items: [], lastGeneratedAt: null };
  // Regenerate right away if the org's language or industry pack changed since the cached
  // headlines were written — otherwise a settings change would keep showing old-language or
  // wrong-industry news for up to 7 days.
  const settingsChanged = ticker.language !== settings.language || ticker.industry !== settings.industry;
  const isStale =
    !ticker.lastGeneratedAt ||
    !Array.isArray(ticker.items) ||
    ticker.items.length === 0 ||
    settingsChanged ||
    Date.now() - new Date(ticker.lastGeneratedAt).getTime() > NEWS_TICKER_REFRESH_MS;

  if (!isStale) {
    return res.json({ items: ticker.items, lastGeneratedAt: ticker.lastGeneratedAt, cached: true });
  }
  if (!getEffectiveGeminiApiKey()) {
    return res.json({ items: [], disabled: true });
  }

  try {
    const rawText = await generateNewsTickerText(tenantId);
    const items = rawText
      .split("|")
      .map((s: string) => s.trim())
      .filter(Boolean)
      .slice(0, 5);
    if (items.length === 0) {
      throw new Error("The AI provider returned no headlines.");
    }

    const entry = { items, lastGeneratedAt: new Date().toISOString(), language: settings.language, industry: settings.industry };
    db.newsTicker.byTenant[tenantId] = entry;
    await saveDb();
    res.json({ items: entry.items, lastGeneratedAt: entry.lastGeneratedAt, cached: false });
  } catch (err: any) {
    log.error("Error generating news ticker:", err);
    // A stale cache in the previous language/industry beats nothing, unless the
    // settings just changed and no fresh headlines exist yet for the new choice.
    if (Array.isArray(ticker.items) && ticker.items.length > 0 && !settingsChanged) {
      return res.json({ items: ticker.items, lastGeneratedAt: ticker.lastGeneratedAt, cached: true, stale: true });
    }
    sendRouteError(req, res, err, "request failed", "Failed to load the news ticker.", { status: 500 });
  }
});
app.post("/api/ai/test-key", async (req: express.Request, res: express.Response) => {
  const { apiKey, model } = req.body;
  const keyToTest = (apiKey && !isMaskedSecret(apiKey) ? String(apiKey) : getEffectiveGeminiApiKey()).trim();
  if (!keyToTest) {
    return res
      .status(400)
      .json({
        error: "API Key belum diisi. Masukkan Gemini API Key terlebih dahulu.",
      });
  }
  try {
    const testClient = new GoogleGenAI({
      apiKey: keyToTest,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } },
    });
    const modelsToTry = [
      model ? getValidAiModel(model) : "gemini-3.8-flash",
      "gemini-3.8-flash",
      "gemini-3.1-flash-lite",
    ];
    const uniqueModels = [...new Set(modelsToTry)];
    let lastErr = null;
    for (const targetModel of uniqueModels) {
      try {
        const response = await testClient.models.generateContent({
          model: targetModel,
          contents: "Say OK",
        });
        if (response && (response as any).text) {
          return res.json({
            success: true,
            message: `Koneksi ke Google Gemini API berhasil! (Model aktif: ${targetModel})`,
            model: targetModel,
          });
        }
      } catch (err) {
        lastErr = err;
        log.warn(
          `[Test API Key] Model ${targetModel} attempt failed:`,
          err?.message || err,
        );
      }
    }
    throw lastErr || new Error("Tidak ada respon dari Gemini API.");
  } catch (err) {
    log.error("Test API Key error:", err);
    return res.status(400).json({ error: formatGeminiError(err) });
  }
});
/** Mask all but the last `keep` characters, e.g. bank account numbers. */
function maskTail(value: unknown, keep = 4): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.length <= keep ? "•".repeat(text.length) : `${"•".repeat(Math.min(6, text.length - keep))}${text.slice(-keep)}`;
}
app.post("/api/chat", async (req: express.Request, res: express.Response) => {
  if (!(await ensureAiAvailable(req, res))) return;
  try {
    const { query, history } = req.body;
    if (!query && (!history || history.length === 0)) {
      return res.status(400).json({ error: "Query is required" });
    }
    const tenantId = getRequestTenantId(req);
    const settings = getTenantSettings(tenantId);
    const ctx = aiPolicyContext(tenantId);
    const chatScope = scopeOf(req);
    const ctxForChat = orgContextOf(req);
    const visibleTo = (kind: RecordKind) => (row: any) => recordVisible(ctxForChat, chatScope, kind, row);
    const partnerNameOf = (id: string) => db.partners.find((p) => p.partner_id === id && p.organizationId === tenantId)?.partner_name || "";
    /*
     * Privacy by design (PRD §3.4.1, §5.1): only the active tenant's records
     * are sent, and direct identifiers — phone numbers, e-mail addresses,
     * postal addresses, identity/tax numbers and bank account numbers — are
     * stripped or masked before anything leaves this server.
     */
    const dbContext = {
      organization: { name: ctx.organizationName, country: ctx.countryName, industry: ctx.industryName },
      partners: (await readBusinessRows(sql, 'partners', tenantId)).filter(visibleTo("partner")).map((p: any) => ({
        partner_id: p.partner_id || p.id,
        name: p.partner_name,
        codename: p.codename || p.partner_channel || "",
        type: p.partner_type || "Vendor",
        country: p.country || "",
        entity_type: p.entity_type || "",
        dd_status: p.status_dd,
        dd_verified_at: p.dd_verified_date || "",
        internal_owner: p.internal_pic || "",
        contact_name: p.pic_name || "",
        categories: p.tags || [],
        internal_notes: p.notes || p.internal_notes || p.notes || "",
        dd_documents: Array.isArray(p.dd_documents)
          ? p.dd_documents.map((d: any) => ({
              name: d.name,
              status: d.status,
              required: d.required,
              expires_at: d.expiryDate || "",
            }))
          : [],
      })),
      contracts: (await contractRepository.list(tenantId)).rows.filter(visibleTo("contract")).map((c: any) => ({
        contract_id: c.contract_id || c.id,
        reference: c.contract_number,
        title: c.contract_title,
        counterparty: partnerNameOf(c.partner_id),
        partner_id: c.partner_id || "",
        document_type: c.document_type || "Master Agreement",
        parent_reference: c.parent_contract_number || c.parent_number || "",
        categories: c.cooperation_categories || [],
        start_date: c.start_date,
        end_date: c.end_date,
        currency: c.currency,
        value: c.contract_value || 0,
        value_usd: c.contract_value_usd || 0,
        auto_renewal: Boolean(c.auto_renewal),
        notice_period_days: c.notice_period_days || 30,
        notice_type: c.notice_type_required || "Termination",
        status: c.status,
        approval_status: c.status_approval,
        internal_owner: c.internal_pic || "",
        internal_notes: c.internal_notes || c.notes || "",
        change_summary: c.change_summary || "",
        changed_fields: c.changed_fields || [],
        days_remaining: c.days_remaining,
      })),
      commercial_documents: (await readBusinessRows(sql, 'insertion_orders', tenantId)).filter(visibleTo("io")).map((i: any) => {
        const endDateStr = i.end_date || i.completion_date || i.period_end || "";
        const lifecycle = computeLifecycle(i.organizationId, endDateStr, i.status);
        return {
          id: i.io_id || i.id,
          reference: i.io_number,
          title: i.io_title,
          counterparty: partnerNameOf(i.partner_id),
          partner_id: i.partner_id || "",
          contract_reference: i.contract_number || "",
          scope: i.media_channel || i.channel || "",
          start_date: i.start_date || i.period_start || "",
          end_date: endDateStr,
          pricing_model: i.pricing_model || "",
          charging_type: i.charging_type || "",
          payment_scheme: i.payment_scheme || i.pricing_model || "",
          currency: i.currency,
          value: i.io_value || i.total_nominal || 0,
          value_usd: i.io_value_usd || 0,
          deliverables: i.deliverables || "",
          notice_period_days: i.notice_period_days || 14,
          status: lifecycle.status,
          internal_notes: i.internal_notes || i.notes || "",
          days_remaining: lifecycle.daysRemaining,
        };
      }),
      spendings_and_invoices: (await readBusinessRows(sql, 'spendings', tenantId)).filter(visibleTo("spending")).map((s: any) => ({
        spending_id: s.id,
        vendor_name: s.vendor_name || s.partner_name || "",
        vendor_id: s.vendor_id || s.partner_id || "",
        invoice_number: s.invoice_number || "",
        invoice_date: s.invoice_date || "",
        invoice_month: s.invoice_month || s.month || "",
        currency: s.currency,
        total_amount: s.total_amount || s.amount || 0,
        total_amount_usd: s.total_amount_usd || s.amount_usd || 0,
        description: s.invoice_description || s.description || "",
        payment_status: s.payment_status || "",
        bank: [s.bank_name, maskTail(s.bank_account_number)].filter(Boolean).join(" "),
      })),
      evaluations: (await readBusinessRows(sql, 'evaluations', tenantId)).filter(visibleTo("evaluation")).map((e: any) => ({
        evaluation_id: e.id,
        supplier_name: e.supplier_name,
        review_date: e.review_date,
        type_of_work: e.type_of_work,
        sla_score: e.sla_score,
        obligation_target: e.obligation_target,
        communication: e.communication,
        pricing: e.pricing,
        calculated_score: e.calculated_score,
        final_evaluation: e.final_evaluation,
        internal_notes: e.notes || "",
      })),
    };
    // Bounded inputs: the last few messages and only the workspace rows relevant to the question, never the whole workspace.
    const boundedHistory = boundChatHistory<{ role?: string; text: string }>(history, aiLimits);
    const questionText = typeof query === "string" ? query.trim().slice(0, 4000) : "";
    const boundedContext = boundWorkspaceContext(dbContext, questionText, boundedHistory.map((m) => m.text), aiLimits);
    const moduleNote = settings.modules.commercialDocuments
      ? `"commercial_documents" are ${ctx.commercialDocumentLabel}s issued under master agreements.`
      : "";
    const systemInstruction = `You are a context-aware legal, commercial and business assistant embedded in the Legalio contract lifecycle management workspace of ${ctx.organizationName}.
Answer strictly from the workspace JSON below and the ongoing conversation. ${moduleNote}
Contact details, identity/tax numbers and full bank account numbers are intentionally withheld for privacy; if asked for them, say they are not available to the assistant.

Workspace JSON (record_counts has the full totals; when context_note is present only the rows most relevant to the question are listed):
${JSON.stringify(boundedContext)}

Guidelines:
1. When asked about notes, remarks or summaries, check every "internal_notes" field.
2. Keep conversational context; resolve follow-up references ("that contract", "its notes") to previously discussed items.
3. Be concise, direct, professional and accurate. Compute sums, counts and currency breakdowns strictly from the JSON and state the currency of every amount.
4. If a record or note is missing, say so clearly.
5. Never answer with Markdown tables (the chat widget is narrow). Use bullet lists with bold entity names and indented sub-bullets instead.
6. Answer in ${ctx.responseLanguage} unless the user writes in, or asks for, another language.`;
    const contents = [];
    for (const msg of boundedHistory) {
      const role = msg.role === "ai" || msg.role === "model" ? "model" : "user";
      if (!contents.length && role === "model") continue; // trimming may leave a reply without its question
      contents.push({ role, parts: [{ text: msg.text }] });
    }
    if (questionText) {
      const lastMsg = contents[contents.length - 1];
      if (!lastMsg || lastMsg.role !== "user" || lastMsg.parts[0]?.text !== questionText) {
        contents.push({ role: "user", parts: [{ text: questionText }] });
      }
    }
    const modelToUse = getValidAiModel(db.googleConfig?.aiModel || "gemini-3.8-flash");
    const response = await generateContentWithRetryAndFallback({
      model: modelToUse,
      contents,
      config: { systemInstruction, temperature: 0.2 },
    });
    res.json({ success: true, reply: (response as any).text });
  } catch (error: any) {
    log.error("AI Chat Error:", error);
    sendRouteError(req, res, error, "request failed", "Failed to process AI request", { status: 500 });
  }
});
  return app;
}
