import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { AiHttpError, discoverModels, formatProviderError, generateWithProvider, systemTextOf, toJsonSchema, toMessages, validateBaseUrl, validateModelId, type AiRuntimeConfig } from './aiProviders';
import { isFatalForAllModels, isRateLimited } from './aiLimits';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

interface Seen { url: string; headers: Record<string, string>; body: any }
function mockFetch(reply: (seen: Seen) => { status?: number; json: unknown }) {
  const seen: Seen[] = [];
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const entry = { url: String(url), headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined };
    seen.push(entry);
    const { status = 200, json } = reply(entry);
    return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return seen;
}

const signal = () => new AbortController().signal;
const cfg = (patch: Partial<AiRuntimeConfig>): AiRuntimeConfig => ({ provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test', baseUrl: '', ...patch });

test('validateModelId accepts real model ids and rejects anything that could break out of a URL or header', () => {
  for (const ok of ['gpt-4o', 'claude-sonnet-4-5', 'llama-3.3-70b:free', 'meta/llama-3', 'gemini-2.0-flash-exp']) assert.equal(validateModelId(` ${ok} `), ok);
  for (const bad of ['', '-x', 'a b', 'a\nb', 'x'.repeat(121), '../x?y=1', 'm"x']) assert.throws(() => validateModelId(bad), Error, bad);
});

test('validateBaseUrl keeps an http(s) origin and path, drops trailing slashes, refuses credentials, query and other schemes', () => {
  assert.equal(validateBaseUrl(' https://api.groq.com/openai/v1/ '), 'https://api.groq.com/openai/v1');
  assert.equal(validateBaseUrl('http://localhost:11434/v1'), 'http://localhost:11434/v1');
  for (const bad of ['', 'ftp://host/v1', 'http://u:p@host/v1', 'http://host/v1?key=1', 'http://host/v1#x', 'localhost:11434']) assert.throws(() => validateBaseUrl(bad), Error, bad);
});

test('toMessages reads strings, part lists and role/parts lists, and merges neighbours of the same role', () => {
  assert.deepEqual(toMessages('hi'), [{ role: 'user', parts: [{ text: 'hi' }] }]);
  assert.deepEqual(toMessages([{ inlineData: { data: 'AAA', mimeType: 'application/pdf' } }, { text: 'read it' }]),
    [{ role: 'user', parts: [{ inlineData: { data: 'AAA', mimeType: 'application/pdf' } }, { text: 'read it' }] }]);
  assert.deepEqual(toMessages([{ role: 'user', parts: [{ text: 'a' }] }, { role: 'user', parts: [{ text: 'b' }] }, { role: 'model', parts: [{ text: 'c' }] }]),
    [{ role: 'user', parts: [{ text: 'a' }, { text: 'b' }] }, { role: 'assistant', parts: [{ text: 'c' }] }]);
});

test('systemTextOf and toJsonSchema translate the Gemini shapes', () => {
  assert.equal(systemTextOf({ systemInstruction: 'be brief' }), 'be brief');
  assert.equal(systemTextOf({ systemInstruction: { parts: [{ text: 'a' }, { text: 'b' }] } }), 'a\nb');
  assert.equal(systemTextOf({}), '');
  assert.deepEqual(toJsonSchema({ type: 'OBJECT', propertyOrdering: ['a'], required: ['a'], properties: { a: { type: 'STRING', nullable: true }, b: { type: 'ARRAY', items: { type: 'NUMBER' } } } }),
    { type: 'object', required: ['a'], properties: { a: { type: ['string', 'null'] }, b: { type: 'array', items: { type: 'number' } } } });
});

const SCHEMA = { type: 'OBJECT', properties: { title: { type: 'STRING' } }, required: ['title'] };

test('OpenAI: system prompt, messages, json_schema response format, bearer key; returns text and token usage', async () => {
  const seen = mockFetch(() => ({ json: { choices: [{ message: { content: '{"title":"NDA"}' } }], usage: { prompt_tokens: 40, completion_tokens: 2 } } }));
  const result = await generateWithProvider(cfg({}), { model: 'gpt-4o', signal: signal(), params: { contents: [{ text: 'Extract' }], config: { systemInstruction: 'sys', responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 } } });
  assert.deepEqual(result, { text: '{"title":"NDA"}', usageMetadata: { totalTokenCount: 42 } });
  assert.equal(seen[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal((seen[0].headers as any).Authorization, 'Bearer sk-test');
  assert.equal(seen[0].body.messages[0].role, 'system');
  assert.equal(seen[0].body.temperature, 0);
  assert.equal(seen[0].body.response_format.type, 'json_schema');
  assert.equal(seen[0].body.response_format.json_schema.schema.type, 'object');
});

test('OpenAI: reasoning models get no temperature, PDFs travel as files and images as image_url', async () => {
  const seen = mockFetch(() => ({ json: { choices: [{ message: { content: 'ok' } }] } }));
  await generateWithProvider(cfg({ model: 'o3-mini' }), { model: 'o3-mini', signal: signal(), params: { contents: [{ inlineData: { data: 'UERG', mimeType: 'application/pdf' } }, { inlineData: { data: 'SU1H', mimeType: 'image/png' } }, { text: 'q' }], config: { temperature: 0.2 } } });
  assert.equal('temperature' in seen[0].body, false);
  const content = seen[0].body.messages[0].content;
  assert.equal(content[0].type, 'file');
  assert.match(content[0].file.file_data, /^data:application\/pdf;base64,UERG$/);
  assert.equal(content[1].image_url.url, 'data:image/png;base64,SU1H');
});

test('custom endpoint: uses its base URL, needs no key, puts the schema in the prompt and refuses PDFs with a clear message', async () => {
  const seen = mockFetch(() => ({ json: { choices: [{ message: { content: '{}' } }] } }));
  const custom = cfg({ provider: 'custom', model: 'llama3', apiKey: '', baseUrl: 'http://localhost:11434/v1' });
  await generateWithProvider(custom, { model: 'llama3', signal: signal(), params: { contents: 'x', config: { responseMimeType: 'application/json', responseSchema: SCHEMA } } });
  assert.equal(seen[0].url, 'http://localhost:11434/v1/chat/completions');
  assert.equal('Authorization' in (seen[0].headers as any), false);
  assert.equal(seen[0].body.response_format.type, 'json_schema');
  assert.equal(seen[0].body.response_format.json_schema.schema.type, 'object');
  assert.match(seen[0].body.messages[0].content, /JSON Schema/, 'the schema is also in the prompt, for servers that ignore response_format');
  await assert.rejects(generateWithProvider(custom, { model: 'llama3', signal: signal(), params: { contents: [{ inlineData: { data: 'x', mimeType: 'application/pdf' } }] } }), (err: any) => err instanceof AiHttpError && err.status === 422 && /PDF/.test(err.message));
});

test('custom endpoint retries without response_format when the server does not know it', async () => {
  let calls = 0;
  const seen = mockFetch((s) => (++calls === 1 ? { status: 400, json: { error: { message: 'Unknown parameter: response_format' } } } : { json: { choices: [{ message: { content: '{}' } }] } }));
  await generateWithProvider(cfg({ provider: 'custom', baseUrl: 'http://x/v1', apiKey: '' }), { model: 'm', signal: signal(), params: { contents: 'x', config: { responseMimeType: 'application/json' } } });
  assert.equal(seen.length, 2);
  assert.equal('response_format' in seen[1].body, false);
});

test('custom endpoint steps down from json_schema to json_object to none when the server refuses each', async () => {
  let calls = 0;
  const seen = mockFetch(() => (++calls < 3 ? { status: 400, json: { error: { message: `Unsupported response_format type` } } } : { json: { choices: [{ message: { content: '{}' } }] } }));
  await generateWithProvider(cfg({ provider: 'custom', baseUrl: 'http://x/v1', apiKey: '' }), { model: 'm', signal: signal(), params: { contents: 'x', config: { responseMimeType: 'application/json', responseSchema: SCHEMA } } });
  assert.deepEqual(seen.map((s) => s.body.response_format?.type ?? 'none'), ['json_schema', 'json_object', 'none']);
});

test('the official OpenAI endpoint does not step down: a 400 is the answer', async () => {
  const seen = mockFetch(() => ({ status: 400, json: { error: { message: 'Invalid response_format' } } }));
  await assert.rejects(generateWithProvider(cfg({}), { model: 'gpt-4o', signal: signal(), params: { contents: 'x', config: { responseMimeType: 'application/json', responseSchema: SCHEMA } } }), (err: any) => err.status === 400);
  assert.equal(seen.length, 1);
});

test('Anthropic: headers, system, PDF as document, schema as a forced tool whose input is returned as JSON text', async () => {
  const seen = mockFetch(() => ({ json: { content: [{ type: 'tool_use', name: 'return_result', input: { title: 'NDA' } }], usage: { input_tokens: 100, output_tokens: 10 } } }));
  const result = await generateWithProvider(cfg({ provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: 'sk-ant' }), {
    model: 'claude-sonnet-4-5', signal: signal(),
    params: { contents: [{ inlineData: { data: 'UERG', mimeType: 'application/pdf' } }, { text: 'Extract' }], config: { systemInstruction: 'sys', responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 } },
  });
  assert.deepEqual(result, { text: '{"title":"NDA"}', usageMetadata: { totalTokenCount: 110 } });
  const [{ url, headers, body }] = seen;
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal((headers as any)['x-api-key'], 'sk-ant');
  assert.equal((headers as any)['anthropic-version'], '2023-06-01');
  assert.equal(body.system, 'sys');
  assert.equal(body.messages[0].content[0].type, 'document');
  assert.deepEqual(body.tool_choice, { type: 'tool', name: 'return_result' });
  assert.equal(body.tools[0].input_schema.type, 'object');
});

test('Anthropic plain text answers join the text blocks and chat history maps model to assistant', async () => {
  const seen = mockFetch(() => ({ json: { content: [{ type: 'text', text: 'Hel' }, { type: 'text', text: 'lo' }], usage: { input_tokens: 5, output_tokens: 1 } } }));
  const result = await generateWithProvider(cfg({ provider: 'anthropic', model: 'm', apiKey: 'k' }), { model: 'm', signal: signal(), params: { contents: [{ role: 'user', parts: [{ text: 'q' }] }, { role: 'model', parts: [{ text: 'a' }] }, { role: 'user', parts: [{ text: 'q2' }] }] } });
  assert.equal(result.text, 'Hello');
  assert.deepEqual(seen[0].body.messages.map((m: any) => m.role), ['user', 'assistant', 'user']);
});

test('HTTP failures become AiHttpError with the status the retry logic reads, and never echo the key', async () => {
  mockFetch(() => ({ status: 429, json: { error: { message: 'Rate limit reached' } } }));
  const err: any = await generateWithProvider(cfg({ apiKey: 'sk-secret-123' }), { model: 'm', signal: signal(), params: { contents: 'x' } }).catch((e) => e);
  assert.ok(err instanceof AiHttpError);
  assert.equal(err.status, 429);
  assert.equal(isRateLimited(err), true);
  assert.equal(JSON.stringify(err.message).includes('sk-secret'), false);
  mockFetch(() => ({ status: 401, json: { error: { message: 'bad key' } } }));
  const unauthorized = await generateWithProvider(cfg({}), { model: 'm', signal: signal(), params: { contents: 'x' } }).catch((e) => e);
  assert.equal(isFatalForAllModels(unauthorized), true);
});

test('formatProviderError gives one actionable sentence per failure and no raw body', () => {
  assert.match(formatProviderError(new AiHttpError(401, 'x'), 'openai'), /API key for OpenAI was rejected/);
  assert.match(formatProviderError(new AiHttpError(404, 'x'), 'anthropic'), /does not know this model/);
  assert.match(formatProviderError(new AiHttpError(429, 'x'), 'custom'), /rate limit or quota/);
  assert.match(formatProviderError(new AiHttpError(503, 'x'), 'openai'), /unavailable/);
  assert.match(formatProviderError(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }), 'custom'), /Could not reach/);
  assert.equal(formatProviderError(new AiHttpError(422, 'This AI provider cannot read PDF files.'), 'custom'), 'This AI provider cannot read PDF files.');
});

test('discoverModels lists usable models per provider, sends the key as a header and filters non-chat models', async () => {
  let seen = mockFetch(() => ({ json: { models: [{ name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] }] } }));
  assert.deepEqual(await discoverModels({ provider: 'gemini', apiKey: 'g-key', baseUrl: '' }), [{ id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }]);
  assert.equal(seen[0].url.includes('g-key'), false);
  assert.equal((seen[0].headers as any)['x-goog-api-key'], 'g-key');

  seen = mockFetch(() => ({ json: { data: [{ id: 'gpt-4o' }, { id: 'text-embedding-3-small' }, { id: 'o3-mini' }, { id: 'whisper-1' }, { id: 'gpt-4o-audio-preview' }] } }));
  assert.deepEqual((await discoverModels({ provider: 'openai', apiKey: 'k', baseUrl: '' })).map((m) => m.id), ['gpt-4o', 'o3-mini']);

  seen = mockFetch(() => ({ json: { data: [{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' }] } }));
  assert.deepEqual(await discoverModels({ provider: 'anthropic', apiKey: 'k', baseUrl: '' }), [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }]);
  assert.equal((seen[0].headers as any)['anthropic-version'], '2023-06-01');

  seen = mockFetch(() => ({ json: { data: [{ id: 'llama3' }, { id: 'qwen2' }] } }));
  assert.deepEqual((await discoverModels({ provider: 'custom', apiKey: '', baseUrl: 'http://localhost:11434/v1' })).map((m) => m.id), ['llama3', 'qwen2']);
  assert.equal(seen[0].url, 'http://localhost:11434/v1/models');
});
