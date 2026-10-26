/**
 * Non-Gemini AI providers (OpenAI, Anthropic, any OpenAI-compatible endpoint). Every AI feature builds Gemini-shaped requests
 * (`contents`, `config.responseSchema`, `config.systemInstruction`); this adapter translates one of those into a provider call and
 * returns the same `{ text, usageMetadata }` shape, so no feature code changes when the provider does. Plain fetch, no extra SDK.
 */
export const AI_PROVIDERS = ['gemini', 'openai', 'anthropic', 'custom'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export const isAiProvider = (value: unknown): value is AiProvider => typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value);

export const DEFAULT_AI_MODELS: Record<AiProvider, string> = { gemini: 'gemini-3.8-flash', openai: 'gpt-4o-mini', anthropic: 'claude-sonnet-4-5', custom: '' };
const OPENAI_BASE = 'https://api.openai.com/v1';
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_MAX_TOKENS = 8192;

export interface AiRuntimeConfig { provider: AiProvider; model: string; apiKey: string; baseUrl: string }

/** Upstream failure with the HTTP status, so retry and rate-limit handling (aiLimits.ts) can read it. The message never carries the key. */
export class AiHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'AiHttpError'; }
}

/* ------------------------------- validation ------------------------------- */

/** A model id as providers write them (`gpt-4o`, `claude-sonnet-4-5`, `llama-3.3-70b:free`, `org/model`). */
export function validateModelId(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!/^[A-Za-z0-9][\w.:/@+-]{0,119}$/.test(value)) throw new Error('Model ID must be 1 to 120 letters, digits or . _ : / @ + - characters.');
  return value;
}

/**
 * Base URL of an OpenAI-compatible service. Only a superuser sets it, and local services (Ollama, vLLM, LM Studio) are the point, so private
 * addresses are allowed; credentials, queries and fragments in the URL are not.
 */
export function validateBaseUrl(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Base URL must look like https://api.groq.com/openai/v1 or http://localhost:11434/v1.'); }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) throw new Error('Base URL must be an http(s) address without credentials, query or fragment.');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/* ---------------------------- request translation ---------------------------- */

type Part = { text: string } | { inlineData: { data: string; mimeType: string } };
interface Message { role: 'user' | 'assistant'; parts: Part[] }

const textOf = (value: unknown) => (typeof value === 'string' ? value : '');

/** Gemini `contents` (a string, a list of parts, or a list of `{ role, parts }`) as alternating user/assistant messages. */
export function toMessages(contents: unknown): Message[] {
  const messages: Message[] = [];
  const push = (role: Message['role'], parts: Part[]) => {
    if (!parts.length) return;
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.parts.push(...parts); else messages.push({ role, parts: [...parts] });
  };
  const partOf = (item: any): Part | null => {
    if (typeof item === 'string') return item ? { text: item } : null;
    if (item?.inlineData?.data) return { inlineData: { data: String(item.inlineData.data), mimeType: String(item.inlineData.mimeType || 'application/octet-stream') } };
    return typeof item?.text === 'string' && item.text ? { text: item.text } : null;
  };
  const list = Array.isArray(contents) ? contents : [contents];
  if (list.every((item) => item && typeof item === 'object' && Array.isArray((item as any).parts))) {
    for (const item of list as any[]) push(item.role === 'model' || item.role === 'assistant' ? 'assistant' : 'user', item.parts.map(partOf).filter(Boolean) as Part[]);
  } else {
    push('user', list.map(partOf).filter(Boolean) as Part[]);
  }
  return messages;
}

/** System prompt of a Gemini `config`. */
export function systemTextOf(config: any): string {
  const instruction = config?.systemInstruction;
  if (typeof instruction === 'string') return instruction;
  if (Array.isArray(instruction?.parts)) return instruction.parts.map((part: any) => textOf(part?.text)).join('\n');
  return textOf(instruction?.text);
}

/** A Gemini response schema (`Type.OBJECT` = 'OBJECT', `nullable`, `propertyOrdering`) as JSON Schema. */
export function toJsonSchema(schema: any): any {
  if (Array.isArray(schema)) return schema.map(toJsonSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'propertyOrdering' || key === 'nullable') continue;
    if (key === 'type' && typeof value === 'string') out.type = value.toLowerCase();
    else if (key === 'properties' && value && typeof value === 'object') out.properties = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, toJsonSchema(child)]));
    else out[key] = key === 'items' ? toJsonSchema(value) : value;
  }
  if (schema.nullable && out.type) out.type = [out.type, 'null'];
  return out;
}

const wantsJson = (config: any) => config?.responseMimeType === 'application/json';

/* ------------------------------ provider calls ------------------------------ */

async function post(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  const raw = await res.text();
  let json: any = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { /* not JSON */ }
  if (!res.ok) throw new AiHttpError(res.status, String(json?.error?.message || json?.message || raw || res.statusText).replace(/\s+/g, ' ').slice(0, 300));
  return json;
}

const usageOf = (input: unknown, output: unknown) => ({ totalTokenCount: (Number(input) || 0) + (Number(output) || 0) });

/** Models that reject a custom temperature (OpenAI reasoning families). */
const fixedTemperature = (model: string) => /^(o\d|gpt-5)/i.test(model);

export interface ProviderRequest { model: string; params: { contents?: unknown; config?: any }; signal: AbortSignal }
export interface ProviderResult { text: string; usageMetadata: { totalTokenCount: number } }

async function openAiCompatible(cfg: AiRuntimeConfig, { model, params, signal }: ProviderRequest): Promise<ProviderResult> {
  const official = cfg.provider === 'openai';
  const base = official ? OPENAI_BASE : cfg.baseUrl;
  const config = params.config || {};
  const system = [systemTextOf(config)];
  const json = wantsJson(config);
  const schema = json && config.responseSchema ? toJsonSchema(config.responseSchema) : null;
  if (json && schema && !official) system.push(`Reply with only a JSON object that matches this JSON Schema:\n${JSON.stringify(schema)}`);
  const messages: any[] = system.filter(Boolean).length ? [{ role: 'system', content: system.filter(Boolean).join('\n\n') }] : [];
  for (const message of toMessages(params.contents)) {
    const content = message.parts.map((part) => {
      if ('text' in part) return { type: 'text', text: part.text };
      if (part.inlineData.mimeType === 'application/pdf') {
        // OpenAI reads PDFs as files; a generic OpenAI-compatible service cannot be assumed to.
        if (!official) throw new AiHttpError(422, 'This AI provider cannot read PDF files. Use OpenAI, Anthropic or Gemini for scanned documents, or upload a text-based document.');
        return { type: 'file', file: { filename: 'document.pdf', file_data: `data:application/pdf;base64,${part.inlineData.data}` } };
      }
      if (!part.inlineData.mimeType.startsWith('image/')) throw new AiHttpError(422, `This AI provider cannot read ${part.inlineData.mimeType} files.`);
      return { type: 'image_url', image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` } };
    });
    messages.push({ role: message.role, content: message.role === 'assistant' ? content.map((c: any) => c.text ?? '').join('') : content });
  }
  const body: Record<string, any> = { model, messages };
  if (typeof config.temperature === 'number' && !(official && fixedTemperature(model))) body.temperature = config.temperature;
  // A schema is sent as json_schema to compatible servers too: with it the model answers valid JSON far more reliably than with
  // the schema only in the prompt (a router's model once returned several bare strings for one field under json_object).
  if (json) body.response_format = schema ? { type: 'json_schema', json_schema: { name: 'result', schema, strict: false } } : { type: 'json_object' };
  const headers: Record<string, string> = cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {};
  let data: any;
  for (;;) {
    try {
      data = await post(`${base}/chat/completions`, headers, body, signal);
      break;
    } catch (err: any) {
      // A compatible server that does not know a response format gets the next simpler one; the schema stays in the prompt.
      const refused = !official && body.response_format && err?.status === 400 && /response_format|json_object|json_schema/i.test(err.message);
      if (!refused) throw err;
      if (body.response_format.type === 'json_schema') body.response_format = { type: 'json_object' };
      else delete body.response_format;
    }
  }
  const message = data?.choices?.[0]?.message;
  if (message?.refusal) throw new AiHttpError(422, `The model declined the request: ${String(message.refusal).slice(0, 160)}`);
  return { text: textOf(message?.content), usageMetadata: usageOf(data?.usage?.prompt_tokens, data?.usage?.completion_tokens) };
}

async function anthropic(cfg: AiRuntimeConfig, { model, params, signal }: ProviderRequest): Promise<ProviderResult> {
  const config = params.config || {};
  const messages = toMessages(params.contents).map((message) => ({
    role: message.role,
    content: message.parts.map((part) => {
      if ('text' in part) return { type: 'text', text: part.text };
      const { data, mimeType } = part.inlineData;
      if (mimeType === 'application/pdf') return { type: 'document', source: { type: 'base64', media_type: mimeType, data } };
      if (!mimeType.startsWith('image/')) throw new AiHttpError(422, `This AI provider cannot read ${mimeType} files.`);
      return { type: 'image', source: { type: 'base64', media_type: mimeType, data } };
    }),
  }));
  const body: Record<string, any> = { model, max_tokens: ANTHROPIC_MAX_TOKENS, messages };
  const system = systemTextOf(config);
  if (system) body.system = system;
  if (typeof config.temperature === 'number') body.temperature = Math.min(1, Math.max(0, config.temperature));
  const schema = wantsJson(config) && config.responseSchema ? toJsonSchema(config.responseSchema) : null;
  // A forced tool call is how Claude returns schema-shaped JSON.
  if (schema) { body.tools = [{ name: 'return_result', description: 'Return the result in this structure.', input_schema: schema }]; body.tool_choice = { type: 'tool', name: 'return_result' }; }
  else if (wantsJson(config)) body.system = `${body.system ? `${body.system}\n\n` : ''}Reply with only a valid JSON object.`;
  const data = await post(`${ANTHROPIC_BASE}/messages`, { 'x-api-key': cfg.apiKey, 'anthropic-version': ANTHROPIC_VERSION }, body, signal);
  const blocks: any[] = Array.isArray(data?.content) ? data.content : [];
  const tool = blocks.find((block) => block?.type === 'tool_use');
  const text = tool ? JSON.stringify(tool.input ?? {}) : blocks.filter((block) => block?.type === 'text').map((block) => textOf(block.text)).join('');
  return { text, usageMetadata: usageOf(data?.usage?.input_tokens, data?.usage?.output_tokens) };
}

/** One generation on a non-Gemini provider, in the Gemini response shape. */
export function generateWithProvider(cfg: AiRuntimeConfig, request: ProviderRequest): Promise<ProviderResult> {
  if (cfg.provider === 'anthropic') return anthropic(cfg, request);
  if (cfg.provider === 'openai' || cfg.provider === 'custom') return openAiCompatible(cfg, request);
  throw new Error(`Provider ${cfg.provider} is not handled here.`);
}

/* -------------------------------- discovery -------------------------------- */

export interface DiscoveredModel { id: string; name: string }

async function getJson(url: string, headers: Record<string, string>) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  const raw = await res.text();
  let json: any = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { /* not JSON */ }
  if (!res.ok) throw new AiHttpError(res.status, String(json?.error?.message || json?.message || res.statusText).replace(/\s+/g, ' ').slice(0, 200));
  return json;
}

/** The models an API key can use, from the provider itself (key sent as a header, never in the URL). */
export async function discoverModels(cfg: Pick<AiRuntimeConfig, 'provider' | 'apiKey' | 'baseUrl'>): Promise<DiscoveredModel[]> {
  const byId = (a: DiscoveredModel, b: DiscoveredModel) => a.id.localeCompare(b.id);
  switch (cfg.provider) {
    case 'gemini': {
      const data = await getJson('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': cfg.apiKey });
      return (data?.models || []).filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: any) => ({ id: String(m.name).replace(/^models\//, ''), name: String(m.displayName || m.name).replace(/^models\//, '') })).sort(byId);
    }
    case 'openai': {
      const data = await getJson(`${OPENAI_BASE}/models`, { Authorization: `Bearer ${cfg.apiKey}` });
      return (data?.data || []).filter((m: any) => /^(gpt-|o\d|chatgpt-)/i.test(m.id) && !/(embedding|audio|realtime|transcribe|tts|image|moderation|search)/i.test(m.id))
        .map((m: any) => ({ id: m.id, name: m.id })).sort(byId);
    }
    case 'anthropic': {
      const data = await getJson(`${ANTHROPIC_BASE}/models?limit=100`, { 'x-api-key': cfg.apiKey, 'anthropic-version': ANTHROPIC_VERSION });
      return (data?.data || []).map((m: any) => ({ id: m.id, name: m.display_name || m.id })).sort(byId);
    }
    case 'custom': {
      const data = await getJson(`${cfg.baseUrl}/models`, cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {});
      return (data?.data || []).map((m: any) => ({ id: String(m.id), name: String(m.id) })).sort(byId);
    }
  }
}

/* --------------------------------- errors --------------------------------- */

const PROVIDER_NAMES: Record<AiProvider, string> = { gemini: 'Google Gemini', openai: 'OpenAI', anthropic: 'Anthropic', custom: 'the custom AI endpoint' };

/** One actionable sentence for an upstream failure; never the raw response. */
export function formatProviderError(err: any, provider: AiProvider): string {
  const name = PROVIDER_NAMES[provider];
  const status = Number(err?.status);
  const where = 'Settings > AI Model';
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || /timeout|timed out|abort/i.test(String(err?.message))) return `${name} did not respond in time. Try again in a moment.`;
  if (err instanceof AiHttpError && status === 422) return err.message;
  if (status === 401) return `The API key for ${name} was rejected. Check it in ${where}.`;
  if (status === 403) return `${name} refused access. Check that the API key has permission for this model and that billing is active.`;
  if (status === 404) return `${name} does not know this model. Choose another model in ${where}.`;
  if (status === 429) return `${name} rate limit or quota reached. Check the account's usage and limits, then try again.`;
  if (status >= 500) return `${name} is unavailable right now. Try again in a moment.`;
  if (status === 400) return `${name} rejected the request: ${String(err?.message || '').slice(0, 140)}. Check the model in ${where}.`;
  if (err?.cause?.code === 'ECONNREFUSED' || err?.cause?.code === 'ENOTFOUND' || /fetch failed/i.test(String(err?.message))) return `Could not reach ${name}. Check the address and your network connection.`;
  return `${name} returned an error: ${String(err?.message || 'unknown').split('\n')[0].slice(0, 160)}.`;
}
