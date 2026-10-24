/**
 * The public API's operation table. Router registration, the route policies' `apiKey` entries (checked by test), and the OpenAPI document
 * (apiV1OpenApi.ts) all come from this one list, so the three cannot drift apart silently.
 */
import { CONTRACT_SORTS } from './repositories/contractRepository';
import { IO_SORTS } from './repositories/ioRepository';
import { PARTNER_SORTS } from './repositories/partnerRepository';
import { SPENDING_SORTS } from './repositories/spendingRepository';
import { OBLIGATION_SORTS } from './repositories/obligationRepository';
import { CLAUSE_SORTS } from './repositories/clauseRepository';
import { OBLIGATION_SOURCES, OBLIGATION_STATUSES, OBLIGATION_TYPES } from '@legalio/shared/obligations';

export type V1Resource = 'contracts' | 'partners' | 'orders' | 'spendings' | 'obligations' | 'clauses';
export interface V1Filter { name: string; description: string; enum?: readonly string[] }
export interface V1ResourceSpec {
  resource: V1Resource;
  singular: string;
  /** The existing (cookie-session) route the operations are served by. */
  legacy: string;
  /** Key of the stored record in the legacy response. */
  responseKey: string;
  idField: string;
  sorts: readonly string[];
  filters: V1Filter[];
  /** Only list and get exist (no create/update operations, no write scope). */
  readOnly?: boolean;
}

const date = (name: string, description: string): V1Filter => ({ name, description });
export const V1_RESOURCES: V1ResourceSpec[] = [
  { resource: 'contracts', singular: 'contract', legacy: '/api/contracts', responseKey: 'contract', idField: 'contract_id', sorts: CONTRACT_SORTS, filters: [
    { name: 'status', description: 'Comma-separated lifecycle statuses.' }, { name: 'status_approval', description: 'Comma-separated approval statuses.' },
    { name: 'document_type', description: 'Master Agreement or Agreement Addendum.' }, { name: 'partner_id', description: 'One partner id, or a comma-separated list.' },
    { name: 'parent_contract_id', description: 'Addenda of this contract.' }, { name: 'internal_pic', description: 'Internal person in charge.' },
    date('end_from', 'End date on or after (YYYY-MM-DD).'), date('end_to', 'End date on or before (YYYY-MM-DD).'),
  ] },
  { resource: 'partners', singular: 'partner', legacy: '/api/partners', responseKey: 'partner', idField: 'partner_id', sorts: PARTNER_SORTS, filters: [
    { name: 'internal_pic', description: 'Comma-separated internal persons in charge.' }, { name: 'partner_type', description: 'Comma-separated partner types.' },
    { name: 'status_dd', description: 'Comma-separated due-diligence statuses.' }, { name: 'country', description: 'Comma-separated country codes.' },
    { name: 'partner_status', description: 'Active or Inactive.', enum: ['Active', 'Inactive'] },
  ] },
  { resource: 'orders', singular: 'order', legacy: '/api/ios', responseKey: 'io', idField: 'io_id', sorts: IO_SORTS, filters: [
    { name: 'status', description: 'Comma-separated lifecycle statuses.' }, { name: 'partner_id', description: 'Comma-separated partner ids.' },
    { name: 'contract_id', description: 'Comma-separated contract ids.' }, { name: 'pricing_model', description: 'Comma-separated pricing models.' },
    { name: 'charging_type', description: 'Comma-separated charging types.' },
  ] },
  { resource: 'spendings', singular: 'spending', legacy: '/api/partner-spendings', responseKey: 'spending', idField: 'id', sorts: SPENDING_SORTS, filters: [
    { name: 'payment_status', description: 'Comma-separated payment statuses.' }, { name: 'vendor_id', description: 'Comma-separated vendor (partner) ids.' },
    { name: 'vendor_name', description: 'Exact vendor name.' }, { name: 'currency', description: 'Comma-separated currency codes.' },
    { name: 'year', description: 'Invoice year (YYYY).' }, { name: 'month', description: 'Invoice month (MM).' },
  ] },
  { resource: 'obligations', singular: 'obligation', legacy: '/api/obligations', responseKey: 'obligation', idField: 'id', sorts: OBLIGATION_SORTS, readOnly: true, filters: [
    { name: 'status', description: `Comma-separated statuses (${OBLIGATION_STATUSES.join(', ')}); overdue is derived from open work whose due date has passed.` },
    { name: 'type', description: `Comma-separated types (${OBLIGATION_TYPES.join(', ')}).` },
    { name: 'contract_id', description: 'Obligations of one contract.' }, { name: 'io_id', description: 'Obligations of one order.' }, { name: 'partner_id', description: 'Obligations of one partner.' },
    { name: 'responsible', description: 'Responsible user id.' }, { name: 'department', description: 'Responsible department name.' },
    { name: 'source', description: 'manual or ai_extracted.', enum: OBLIGATION_SOURCES },
    date('due_from', 'Due on or after (YYYY-MM-DD).'), date('due_to', 'Due on or before (YYYY-MM-DD).'),
  ] },
  { resource: 'clauses', singular: 'clause', legacy: '/api/clauses', responseKey: 'clause', idField: 'id', sorts: CLAUSE_SORTS, readOnly: true, filters: [
    { name: 'q', description: 'Words to find in the title, category, wording, guidance or tags.' },
    { name: 'category', description: 'Exact category.' }, { name: 'risk', description: 'Comma-separated risk levels (low, medium, high).' },
    { name: 'language', description: 'Clause language (en, id, zh).' }, { name: 'jurisdiction', description: 'Exact jurisdiction.' }, { name: 'tag', description: 'One tag.' },
    { name: 'status', description: 'active (default), archived or all.' },
  ] },
];

export type V1Kind = 'whoami' | 'list' | 'get' | 'create' | 'update';
export interface V1Operation {
  method: 'GET' | 'POST' | 'PATCH';
  /** Express path. */
  path: string;
  /** OpenAPI path under the server base `/api/v1`. */
  openapi: string;
  scope: string | null;
  kind: V1Kind;
  spec?: V1ResourceSpec;
  summary: string;
}

export const V1_OPERATIONS: V1Operation[] = [
  { method: 'GET', path: '/api/v1/whoami', openapi: '/whoami', scope: null, kind: 'whoami', summary: 'The organization, name and scopes of the calling API key' },
  ...V1_RESOURCES.flatMap((spec): V1Operation[] => [
    { method: 'GET', path: `/api/v1/${spec.resource}`, openapi: `/${spec.resource}`, scope: `${spec.resource}:read`, kind: 'list', spec, summary: `List ${spec.resource} (paged, filtered, sorted)` },
    { method: 'GET', path: `/api/v1/${spec.resource}/:id`, openapi: `/${spec.resource}/{id}`, scope: `${spec.resource}:read`, kind: 'get', spec, summary: `Get one ${spec.singular}` },
    ...(spec.readOnly ? [] : [
      { method: 'POST', path: `/api/v1/${spec.resource}`, openapi: `/${spec.resource}`, scope: `${spec.resource}:write`, kind: 'create', spec, summary: `Create a ${spec.singular}` } as V1Operation,
      { method: 'PATCH', path: `/api/v1/${spec.resource}/:id`, openapi: `/${spec.resource}/{id}`, scope: `${spec.resource}:write`, kind: 'update', spec, summary: `Update a ${spec.singular} (partial; the current version is required)` } as V1Operation,
    ]),
  ]),
];
