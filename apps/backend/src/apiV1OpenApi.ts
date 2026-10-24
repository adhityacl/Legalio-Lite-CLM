/** OpenAPI 3.1 document of the public API, generated from the operation table and the existing zod request schemas. */
import { z } from 'zod';
import * as bodySchemas from './schemas';
import { API_SCOPES } from './apiKeys';
import { V1_OPERATIONS, V1_RESOURCES, type V1Operation, type V1Resource } from './apiV1Operations';

const DENIED = ['fileData', 'fileName', 'accessToken', 'termination_document_file', 'invoice_file', 'billing_file', 'redline_analysis', 'redline_analyzed_at', 'dd_documents'];

const BODIES: Record<Exclude<V1Resource, 'obligations' | 'clauses'>, { create: z.ZodType; update: z.ZodType }> = {
  contracts: { create: bodySchemas.contractCreateBody, update: bodySchemas.contractUpdateBody },
  partners: { create: bodySchemas.partnerCreateBody, update: bodySchemas.partnerUpdateBody },
  orders: { create: bodySchemas.ioCreateBody, update: bodySchemas.ioUpdateBody },
  spendings: { create: bodySchemas.spendingCreateBody, update: bodySchemas.spendingUpdateBody },
};

function bodySchema(schema: z.ZodType) {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, any>;
  delete json.$schema;
  for (const key of DENIED) {
    delete json.properties?.[key];
    if (Array.isArray(json.required)) json.required = json.required.filter((name: string) => name !== key);
  }
  if (Array.isArray(json.required) && !json.required.length) delete json.required;
  return json;
}

const errorResponses = (extra: Record<string, string> = {}) => Object.fromEntries(Object.entries({
  '400': 'The request is invalid (VALIDATION_FAILED or INVALID_REQUEST).', '401': 'Missing, unknown, revoked or expired API key.',
  '403': 'The key lacks the required scope (INSUFFICIENT_SCOPE).', '429': 'Rate limit exceeded; see Retry-After.', ...extra,
}).map(([status, description]) => [status, { description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }]));

function operationObject(op: V1Operation) {
  const spec = op.spec;
  const tags = [spec?.resource ?? 'session'];
  const security = [{ ApiKey: [] }];
  if (op.kind === 'whoami') {
    return { operationId: 'whoami', summary: op.summary, tags, security, responses: {
      '200': { description: 'The calling key.', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'object', properties: {
        organizationId: { type: 'string' }, keyId: { type: 'string' }, keyName: { type: 'string' }, keyPrefix: { type: 'string' }, scopes: { type: 'array', items: { type: 'string' } } } } } } } } },
      ...errorResponses() } };
  }
  const resource = spec!.resource;
  const recordRef = { $ref: `#/components/schemas/${resource}Record` };
  const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: `The ${spec!.singular}'s ${spec!.idField}.` };
  const common = { tags, security, 'x-required-scope': op.scope };
  if (op.kind === 'list') {
    return { ...common, operationId: `list_${resource}`, summary: op.summary, parameters: [
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
      { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
      { name: 'q', in: 'query', schema: { type: 'string', maxLength: 200 }, description: 'Search text.' },
      { name: 'sort', in: 'query', schema: { type: 'string', enum: [...spec!.sorts] } },
      { name: 'dir', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
      ...spec!.filters.map((filter) => ({ name: filter.name, in: 'query', description: filter.description, schema: filter.enum ? { type: 'string', enum: [...filter.enum] } : { type: 'string' } })),
    ], responses: {
      '200': { description: 'A page of records.', headers: { 'X-RateLimit-Remaining': { schema: { type: 'integer' } } }, content: { 'application/json': { schema: {
        type: 'object', required: ['data', 'total', 'limit', 'offset'], properties: { data: { type: 'array', items: recordRef }, total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' } } } } } },
      ...errorResponses() } };
  }
  if (op.kind === 'get') {
    return { ...common, operationId: `get_${spec!.singular}`, summary: op.summary, parameters: [idParam], responses: {
      '200': { description: 'The record.', content: { 'application/json': { schema: { type: 'object', required: ['data'], properties: { data: recordRef } } } } }, ...errorResponses({ '404': 'No such record in the key\'s organization.' }) } };
  }
  if (op.kind === 'create') {
    return { ...common, operationId: `create_${spec!.singular}`, summary: op.summary, requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${resource}Create` } } } }, responses: {
      '201': { description: 'The created record.', content: { 'application/json': { schema: { type: 'object', required: ['data'], properties: { data: recordRef } } } } },
      ...errorResponses({ '409': 'A record with this number already exists, or another conflict (DUPLICATE_VALUE).' }) } };
  }
  return { ...common, operationId: `update_${spec!.singular}`, summary: op.summary, parameters: [idParam, { name: 'If-Match', in: 'header', required: false, schema: { type: 'string' }, description: 'The record version (alternative to the "version" body field). One of the two is required.' }],
    requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${resource}Update` } } } }, responses: {
      '200': { description: 'The updated record (version incremented).', content: { 'application/json': { schema: { type: 'object', required: ['data'], properties: { data: recordRef } } } } },
      ...errorResponses({ '404': 'No such record in the key\'s organization.', '409': 'VERSION_CONFLICT: the record changed since the version sent; read it again.', '428': 'VERSION_REQUIRED: no version was sent.' }) } };
}

export function buildOpenApiDocument(serverBase = 'http://localhost:3000') {
  const schemas: Record<string, unknown> = {
    Error: { type: 'object', required: ['error', 'code', 'message', 'status', 'requestId'], properties: {
      error: { type: 'string' }, code: { type: 'string', description: 'Stable machine-readable code.' }, message: { type: 'string' }, status: { type: 'integer' }, requestId: { type: 'string' },
      issues: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, message: { type: 'string' } } } } } },
  };
  for (const spec of V1_RESOURCES) {
    schemas[`${spec.resource}Record`] = { type: 'object', description: `A stored ${spec.singular}. Lists add display fields (for example partner names and USD values).`,
      required: [spec.idField, 'version'], additionalProperties: true, properties: { [spec.idField]: { type: 'string' }, version: { type: 'integer', description: 'Send this back on update.' } } };
    if (spec.readOnly) continue;
    schemas[`${spec.resource}Create`] = bodySchema(BODIES[spec.resource as keyof typeof BODIES].create);
    schemas[`${spec.resource}Update`] = bodySchema(BODIES[spec.resource as keyof typeof BODIES].update);
  }
  const paths: Record<string, Record<string, unknown>> = {
    '/openapi.json': { get: { operationId: 'openapi', summary: 'This document', tags: ['session'], security: [], responses: { '200': { description: 'The OpenAPI 3.1 document.' } } } },
  };
  for (const op of V1_OPERATIONS) (paths[op.openapi] ??= {})[op.method.toLowerCase()] = operationObject(op);
  return {
    openapi: '3.1.0',
    info: { title: 'Legalio public API', version: '1.0.0', description: 'Organization-scoped access to contracts, partners, orders and spendings (read and write) and obligations and the clause library (read) with API keys. See docs/API.md.' },
    servers: [{ url: `${serverBase}/api/v1` }],
    security: [{ ApiKey: [] }],
    tags: [{ name: 'session' }, ...V1_RESOURCES.map((spec) => ({ name: spec.resource }))],
    paths,
    components: {
      securitySchemes: { ApiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'lgk_<prefix>_<secret>', description: `Organization API key. Scopes: ${API_SCOPES.join(', ')}.` } },
      schemas,
    },
  };
}
