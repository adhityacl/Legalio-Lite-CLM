import { PublicError } from './apiErrors';

/**
 * Reading a model's JSON answer. Providers that get the schema only as prompt text (custom OpenAI-compatible endpoints)
 * sometimes wrap the object in a ```json fence or add a sentence around it; both are tolerated. Returns undefined when no
 * JSON value can be recovered.
 */
export function extractAiJson(text: unknown): unknown {
  let source = typeof text === 'string' ? text.trim() : ''; // trim() also drops a byte-order mark
  if (!source) return undefined;
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(source);
  if (fenced) source = fenced[1].trim();
  try { return JSON.parse(source); } catch { /* try the outermost object or array below */ }
  const start = source.search(/[[{]/);
  if (start < 0) return undefined;
  const close = source[start] === '{' ? '}' : ']';
  const end = source.lastIndexOf(close);
  if (end <= start) return undefined;
  try { return JSON.parse(source.slice(start, end + 1)); } catch { return undefined; }
}

/** `extractAiJson` for a JSON object answer; a missing or non-object answer becomes a 502 the routes show as is. */
export function parseAiJsonObject<T = Record<string, any>>(text: unknown, message = 'The AI answer was not valid JSON. Try again.'): T {
  const parsed = extractAiJson(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new PublicError(message, 502, 'AI_INVALID_OUTPUT');
  return parsed as T;
}
