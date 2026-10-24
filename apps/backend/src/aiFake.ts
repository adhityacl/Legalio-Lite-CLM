/**
 * A deterministic stand-in for the AI provider, for tests and the end-to-end suites (never used in production: it is only reachable
 * with APP_TEST_MODE=1, and only when AI_FAKE_PROVIDER=true or a test installs it). It answers the tasks the product sends in the shape
 * the real model is asked for, derived from the text it is given, so the whole path (prompt -> JSON -> validation -> review queue) can be
 * exercised without network access or a key.
 */
import type { AiGenerator } from './aiClient';

export const fakeProviderEnabled = (testMode: boolean, env: NodeJS.ProcessEnv = process.env) => testMode && /^(1|true|yes)$/i.test(String(env.AI_FAKE_PROVIDER || '').trim());

const promptText = (params: any): string => {
  const contents = params?.contents;
  const system = typeof params?.config?.systemInstruction === 'string' ? `${params.config.systemInstruction}\n` : '';
  if (typeof contents === 'string') return system + contents;
  if (!Array.isArray(contents)) return system;
  return system + contents.map((c: any) => (typeof c === 'string' ? c : c?.text ?? (c?.parts ?? []).map((p: any) => p?.text ?? '').join('\n'))).join('\n');
};

/** The chat task: answers from the retrieved records in the workspace JSON and cites the first one, like a well-behaved model would. */
function chatAnswer(prompt: string): string {
  const block = /BEGIN-WORKSPACE-JSON\n([\s\S]*?)\nEND-WORKSPACE-JSON/.exec(prompt);
  let records: Array<{ ref: string; record: Record<string, unknown> }> = [];
  try { records = JSON.parse(block?.[1] ?? '{}').records ?? []; } catch { /* no context */ }
  const first = records[0];
  if (!first) return 'I could not find a matching record in your workspace.';
  const label = ['title', 'name', 'reference', 'vendor_name', 'supplier_name', 'term'].map((k) => first.record[k]).find((v) => typeof v === 'string' && v) as string | undefined;
  return `Best match: ${label ?? first.ref} [${first.ref}]`;
}

const DATE = /\b(\d{4}-\d{2}-\d{2})\b/;
const TYPE_HINTS: Array<[RegExp, string]> = [[/\bpay|invoice|fee\b/i, 'payment'], [/\bdeliver|hand over\b/i, 'delivery'], [/\breport\b/i, 'reporting'], [/\bnotice|renew/i, 'renewal_notice'], [/\bcompl|audit|certif/i, 'compliance']];

function extractionAnswer(prompt: string) {
  const block = /<<<BEGIN-UNTRUSTED-DOCUMENT (\w+)>>>([\s\S]*?)<<<END-UNTRUSTED-DOCUMENT \1>>>/.exec(prompt);
  const text = block ? block[2] : '';
  const obligations: unknown[] = [];
  const key_terms: unknown[] = [];
  let page = 1;
  for (const segment of text.split(/\n(?=\[Page \d+\]\n)/)) {
    const marker = /^\s*\[Page (\d+)\]\n/.exec(segment);
    if (marker) page = Number(marker[1]);
    for (const sentence of segment.replace(/^\s*\[Page \d+\]\n/, '').split(/(?<=[.!?])\s+/)) {
      const trimmed = sentence.trim();
      if (!trimmed) continue;
      const date = DATE.exec(trimmed);
      if (date && /\b(shall|must|will)\b/i.test(trimmed)) {
        const type = TYPE_HINTS.find(([re]) => re.test(trimmed))?.[1] ?? 'other';
        const recurrence = /\bmonthly\b/i.test(trimmed) ? 'monthly' : /\bquarterly\b/i.test(trimmed) ? 'quarterly' : /\b(yearly|annually)\b/i.test(trimmed) ? 'yearly' : 'once';
        obligations.push({ title: trimmed.split(/\s+/).slice(0, 8).join(' '), description: trimmed, type, due_date: date[1], recurrence, recurrence_interval: null, party: 'counterparty', source_quote: trimmed, page, confidence: 0.82 });
      }
      const law = /governed by (?:the )?laws? of ([A-Za-z ]+?)(?:[.,;]|$)/i.exec(trimmed);
      if (law) key_terms.push({ term_key: 'governing_law', label: 'Governing law', value: law[1].trim(), summary: trimmed.slice(0, 280), source_quote: trimmed, page, confidence: 0.9 });
      const notice = /(\d+)\s*(?:\(\d+\)\s*)?days'?\s+(?:prior\s+)?(?:written\s+)?notice/i.exec(trimmed);
      if (notice) key_terms.push({ term_key: 'termination_notice', label: 'Notice period', value: `${notice[1]} days`, summary: trimmed.slice(0, 280), source_quote: trimmed, page, confidence: 0.85 });
    }
  }
  return { obligations, key_terms };
}

export const fakeAiGenerator: AiGenerator = async ({ params }) => {
  const prompt = promptText(params);
  let body: unknown;
  if (/Task: CONTRACT_EXTRACTION/.test(prompt)) body = extractionAnswer(prompt);
  else if (/Task: PLAYBOOK_SEMANTIC_CHECK/.test(prompt)) body = { findings: [] };
  else if (/Task: WORKSPACE_CHAT/.test(prompt)) return { text: chatAnswer(prompt), usageMetadata: { totalTokenCount: Math.ceil(prompt.length / 4) } };
  else body = null;
  const text = body === null ? 'The assistant is running on the built-in test model, which only knows the structured tasks.' : JSON.stringify(body);
  return { text, usageMetadata: { totalTokenCount: Math.ceil(prompt.length / 4) } };
};
