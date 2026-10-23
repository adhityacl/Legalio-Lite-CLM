import { getRequestTenantId, isMatchingOrg, orgContextOf } from '../recordAccess';
import { db, saveDb } from '../memoryDb';
import { sendRouteError } from '../apiErrors';
import { ensureAiAvailable, getValidAiModel, generateContentWithRetryAndFallback } from '../aiClient';
import { aiPolicyContext } from '../tenantPolicy';
import { Type } from '@google/genai';
import express from 'express';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { componentLog } from '../logger';
const log = componentLog('templates');

export function createTemplatesRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);


// Custom Template & Translation Endpoints
// Contract templates are tenant-scoped (PRD §3.3.3, §3.4.1).
app.get("/api/templates", (req, res) => {
  const tenantId = getRequestTenantId(req);
  res.json((db.templates || []).filter((t: any) => isMatchingOrg(t.organizationId, tenantId)));
});

app.post("/api/templates", async (req, res) => {
  try {
    const { id, name, contentId, customFields } = req.body;
    if (!name || !contentId) {
      return res.status(400).json({ error: "Name and content are required." });
    }
    const tenantId = getRequestTenantId(req);
    const templateId = id || `tpl-${Date.now()}`;
    const nowIso = new Date().toISOString();

    if (!db.templates) {
      db.templates = [];
    }

    const existingIndex = db.templates.findIndex((t: any) => t.id === templateId);
    if (existingIndex >= 0 && !isMatchingOrg(db.templates[existingIndex].organizationId, tenantId)) {
      return res.status(404).json({ error: "Template not found." });
    }
    const previous = existingIndex >= 0 ? db.templates[existingIndex] : null;
    const templateData = {
      id: templateId,
      organizationId: previous?.organizationId || tenantId,
      name: String(name).slice(0, 200),
      contentId,
      customFields: Array.isArray(customFields) ? customFields : [],
      version: (Number(previous?.version) || 0) + 1,
      createdAt: previous?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    if (existingIndex >= 0) {
      db.templates[existingIndex] = templateData;
    } else {
      db.templates.push(templateData);
    }

    await saveDb();
    res.json({ success: true, template: templateData });
  } catch (err: any) {
    sendRouteError(req, res, err, "request failed", "Could not save the template.", { status: 500 });
  }
});

app.delete("/api/templates/:id", async (req, res) => {
  const tenantId = getRequestTenantId(req);
  const index = (db.templates || []).findIndex(
    (t: any) => t.id === req.params.id && isMatchingOrg(t.organizationId, tenantId),
  );
  if (index < 0) {
    return res.status(404).json({ error: "Template not found." });
  }
  db.templates.splice(index, 1);
  await saveDb();
  res.json({ success: true });
});

// Drafts a reusable document TEMPLATE (structured sections + {{fieldKey}} tokens, not
// a filled contract) from a free-text brief. Restricted to Superuser/Admin/Manager —
// same tier as other bulk/org-shaping AI actions — because a generated template
// becomes a reusable starting point for every future document of that type.
const AI_TEMPLATE_DOC_TYPES: Record<string, string> = {
  contract: "Kontrak (general commercial contract)",
  agreement: "Perjanjian / Agreement (e.g. cooperation, NDA-style)",
  so: "Surat Pesanan / Service Order (SO)",
};
app.post("/api/templates/ai-generate", async (req: express.Request, res: express.Response) => {
  const templateCtx = orgContextOf(req);
  if (!(templateCtx.accessMode === "platform" || templateCtx.tenantRole === "admin" || templateCtx.tenantRole === "manager")) {
    return res.status(403).json({ error: "INSUFFICIENT_PERMISSION", message: "Only administrators and managers can generate templates with AI." });
  }
  if (!(await ensureAiAvailable(req, res))) return;

  const docType = String(req.body?.docType || "");
  const docTypeLabel = AI_TEMPLATE_DOC_TYPES[docType];
  if (!docTypeLabel) {
    return res.status(400).json({ error: "docType must be one of: contract, agreement, so." });
  }
  const brief = String(req.body?.prompt || "").trim().slice(0, 2000);
  if (!brief) {
    return res.status(400).json({ error: "A prompt describing the template is required." });
  }

  try {
    const selectedModel = getValidAiModel(req.body.model);
    const ctx = aiPolicyContext(getRequestTenantId(req));
    const prompt = `You are a senior corporate legal counsel drafting a reusable document TEMPLATE (not a specific filled document) for ${ctx.organizationName}, a ${ctx.industryName} organization whose primary jurisdiction is ${ctx.countryName} (governing law: ${ctx.governingLaw}).

Draft a ${docTypeLabel} template based on this brief: "${brief}"

Rules:
- This is a TEMPLATE. Any value that varies per signed instance (party names, addresses, dates, amounts, durations, etc.) must be defined as a field and referenced in the body text as {{fieldKey}} — never as literal placeholder text like "[Party Name]".
- Every {{fieldKey}} used in a paragraph must have a matching entry in "fields", with a unique camelCase key, a short Indonesian label, and the closest matching type.
- Write standard, balanced clauses appropriate for ${ctx.countryName} commercial practice. Do not invent statute or regulation numbers.
- Write all body text in ${ctx.responseLanguage}.
- Return between 4 and 12 sections, each with 1-4 paragraphs.`;

    const response = await generateContentWithRetryAndFallback({
      model: selectedModel,
      contents: [{ text: prompt }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            fields: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  key: { type: Type.STRING },
                  label: { type: Type.STRING },
                  type: { type: Type.STRING, enum: ["text", "date", "currency", "entity", "person", "location", "number"] },
                },
                required: ["key", "label", "type"],
              },
            },
            sections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  heading: { type: Type.STRING },
                  paragraphs: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ["heading", "paragraphs"],
              },
            },
          },
          required: ["title", "fields", "sections"],
        },
      },
    });

    const parsed = JSON.parse((response as any).text);
    const seenKeys = new Set<string>();
    const fields = (Array.isArray(parsed?.fields) ? parsed.fields : [])
      .map((f: any) => {
        const key = String(f?.key || "").replace(/[^a-zA-Z0-9_]/g, "");
        const type = ["text", "date", "currency", "entity", "person", "location", "number"].includes(f?.type) ? f.type : "text";
        return key ? { key, label: String(f?.label || key).slice(0, 200), type } : null;
      })
      .filter((f: any) => {
        if (!f || seenKeys.has(f.key)) return false;
        seenKeys.add(f.key);
        return true;
      });
    const sections = (Array.isArray(parsed?.sections) ? parsed.sections : []).slice(0, 12).map((s: any) => ({
      heading: String(s?.heading || "").slice(0, 300),
      paragraphs: (Array.isArray(s?.paragraphs) ? s.paragraphs : []).slice(0, 4).map((p: any) => String(p || "")),
    }));

    res.json({ success: true, title: String(parsed?.title || "").slice(0, 300), fields, sections });
  } catch (error: any) {
    log.error("Error generating AI template:", error);
    sendRouteError(req, res, error, "request failed", "Gagal membuat template. Coba lagi.", { status: 500 });
  }
});
  return app;
}
