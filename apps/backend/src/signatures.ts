/**
 * E-signature requests: creation, the state machine, signers, files, the inbound webhook and what completion does to the contract.
 *
 * Every state change goes through `moveTo()`: one guarded UPDATE (`WHERE status = <the status we read>`), the audit event, and the
 * side effects (`signature.*` webhook rows, the requester's e-mail ledger entry, the contract update on completion, the activity log)
 * all in the caller's transaction, so a request is never "completed" without its consequences. Providers only carry requests and report
 * back (signatureProviders.ts); nothing here is specific to a vendor.
 */
import crypto from 'node:crypto';
import type { Sql } from './db';
import { open, seal } from './secretBox';
import { componentLog } from './logger';
import { saveUpload, getStore } from './uploadStorage';
import { keyFromLink } from './objectStore';
import { addActivityLog } from './recordAccess';
import { contractRepository } from './repositories/contractRepository';
import { emitContractEvents } from './webhookEvents';
import { emitWebhookEvent, verifySignature } from './webhooks';
import { getTenantSettings } from './tenantPolicy';
import { normalizeApprovalStatus } from '@legalio/types/domainStatus';
import { todayInTimezone } from '@legalio/shared/policy';
import { getSignatureProvider, type SignatureRequestView } from './signatureProviders';
import {
  SIGNATURE_MODES, SIGNATURE_STATUSES, approvalStatusAfterSignature, canTransition, currentSigners, isFinal, isOpen, mayNowSign, statusAfterSigning,
  type SignatureMode, type SignatureStatus, type SignerStatus,
} from './signatureStates';

const log = componentLog('signatures');

export const SIGNATURE_LOCK_KEY = 0x4c475347; // "LGSG"
export const MAX_SIGNERS = 20;
export const MAX_EVIDENCE_PER_UPLOAD = 5;
export const DEFAULT_TTL_DAYS = 30;
export const MAX_TTL_DAYS = 365;
const maxFileBytes = () => {
  const configured = Number(process.env.SIGNATURE_MAX_FILE_BYTES);
  return Number.isInteger(configured) && configured >= 1024 && configured <= 25 * 1024 * 1024 ? configured : 15 * 1024 * 1024;
};
export const MAX_FILE_BYTES = () => maxFileBytes();

/** `expose` lets the API error responder show this message and code as they are (they are written for the user). */
export class SignatureError extends Error {
  readonly expose = true;
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const invalid = (message: string) => new SignatureError(400, 'INVALID_INPUT', message);
const conflict = (code: string, message: string) => new SignatureError(409, code, message);
const notFound = () => new SignatureError(404, 'RESOURCE_NOT_FOUND', 'Resource not found.');

/* ------------------------------ rows and DTOs ------------------------------ */

export interface SignerDto { id: string; name: string; email: string; order: number; status: SignerStatus; externalId: string | null; signedAt: string | null; declineReason: string | null; canSignNow: boolean }
export interface FileDto { id: string; kind: 'signed' | 'evidence'; fileName: string; contentType: string; sizeBytes: number; sha256: string; uploadedBy: string; createdAt: string; downloadUrl: string }
export interface EventDto { id: string; type: string; actor: string; signerId: string | null; detail: Record<string, unknown>; createdAt: string }
export interface SignatureRequestDto {
  id: string; contractId: string; contractNumber?: string | null; contractTitle?: string | null; documentId: string | null; title: string; message: string; mode: SignatureMode; status: SignatureStatus;
  provider: string; providerRef: string | null; sourceFileName: string | null; expiresAt: string | null; requestedBy: string; requestedByName?: string | null;
  sentAt: string | null; completedAt: string | null; closedReason: string | null; version: number; createdAt: string; updatedAt: string;
  signers: SignerDto[]; signedFile: FileDto | null;
  files?: FileDto[]; events?: EventDto[];
}

const fileDto = (row: any): FileDto => ({
  id: row.id, kind: row.kind, fileName: row.file_name, contentType: row.content_type, sizeBytes: row.size_bytes, sha256: row.sha256, uploadedBy: row.uploaded_by,
  createdAt: row.created_at, downloadUrl: `/api/signatures/${row.request_id}/files/${row.id}`,
});

async function signersOf(db: Sql, requestId: string, mode: SignatureMode, requestOpen: boolean): Promise<SignerDto[]> {
  const rows = await db.all(`SELECT * FROM signature_signers WHERE request_id = ? ORDER BY signing_order, created_at, id`, requestId);
  const likes = rows.map((row: any) => ({ id: row.id, signing_order: row.signing_order, status: row.status as SignerStatus }));
  return rows.map((row: any, index: number): SignerDto => ({
    id: row.id, name: row.name, email: row.email, order: row.signing_order, status: row.status, externalId: row.external_id, signedAt: row.signed_at, declineReason: row.decline_reason,
    canSignNow: requestOpen && mayNowSign(mode, likes[index], likes),
  }));
}

export async function toDto(db: Sql, row: any, options: { detail?: boolean } = {}): Promise<SignatureRequestDto> {
  const mode = row.mode as SignatureMode;
  const files = options.detail || row.signed_file_id ? (await db.all(`SELECT * FROM signature_files WHERE request_id = ? ORDER BY created_at, id`, row.id)).map(fileDto) : [];
  const dto: SignatureRequestDto = {
    id: row.id, contractId: row.contract_id, contractNumber: row.contract_number, contractTitle: row.contract_title, documentId: row.document_id, title: row.title, message: row.message, mode,
    status: row.status, provider: row.provider, providerRef: row.provider_ref, sourceFileName: row.source_file_name, expiresAt: row.expires_at, requestedBy: row.requested_by,
    requestedByName: row.requested_by_name, sentAt: row.sent_at, completedAt: row.completed_at, closedReason: row.closed_reason, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
    signers: await signersOf(db, row.id, mode, isOpen(row.status)),
    signedFile: files.find((file) => file.id === row.signed_file_id) ?? null,
  };
  if (options.detail) {
    dto.files = files;
    dto.events = (await db.all(`SELECT * FROM signature_events WHERE request_id = ? ORDER BY created_at, id`, row.id)).map((event: any) => ({
      id: event.id, type: event.type, actor: event.actor, signerId: event.signer_id, detail: JSON.parse(event.detail || '{}'), createdAt: event.created_at,
    }));
  }
  return dto;
}

const SELECT = `SELECT r.*, c.contract_number, c.contract_title, u.name AS requested_by_name FROM signature_requests r
  LEFT JOIN contracts c ON c.organization_id = r.organization_id AND c.contract_id = r.contract_id LEFT JOIN "user" u ON u.id = r.requested_by`;

export async function getRequestRow(db: Sql, organizationId: string, id: string): Promise<any | undefined> {
  return db.get(`${SELECT} WHERE r.organization_id = ? AND r.id = ?`, organizationId, id);
}
export async function getRequest(db: Sql, organizationId: string, id: string, detail = true): Promise<SignatureRequestDto | undefined> {
  const row = await getRequestRow(db, organizationId, id);
  return row ? toDto(db, row, { detail }) : undefined;
}

export interface ListQuery { contractId?: string; status?: SignatureStatus[]; limit?: number; offset?: number; contractIds?: string[] }
export async function listRequests(db: Sql, organizationId: string, query: ListQuery = {}): Promise<{ rows: any[]; total: number }> {
  const where = ['r.organization_id = ?'];
  const params: unknown[] = [organizationId];
  if (query.contractId) { where.push('r.contract_id = ?'); params.push(query.contractId); }
  if (query.contractIds) { where.push('r.contract_id = ANY(?)'); params.push(query.contractIds); }
  if (query.status?.length) { where.push('r.status = ANY(?)'); params.push(query.status); }
  const total = Number((await db.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM signature_requests r WHERE ${where.join(' AND ')}`, ...params))?.n ?? 0);
  const limit = Math.min(200, Math.max(1, Math.trunc(Number(query.limit)) || 50));
  const offset = Math.max(0, Math.trunc(Number(query.offset)) || 0);
  const rows = await db.all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  return { rows, total };
}

/* ------------------------------ files ------------------------------ */

export interface ParsedFile { bytes: Buffer; contentType: 'application/pdf' | 'image/png' | 'image/jpeg'; extension: 'pdf' | 'png' | 'jpg' }

/** The type of the bytes by their magic number, never by the file name or a client-supplied content type. */
export function detectFileType(bytes: Buffer): Pick<ParsedFile, 'contentType' | 'extension'> | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') return { contentType: 'application/pdf', extension: 'pdf' };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { contentType: 'image/png', extension: 'png' };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { contentType: 'image/jpeg', extension: 'jpg' };
  return null;
}

/** A base64 string or `data:` URL to validated bytes: size checked before decoding, magic bytes after. A signed copy must be a PDF. */
export function parseFileInput(input: unknown, kind: 'signed' | 'evidence'): ParsedFile {
  if (typeof input !== 'string' || !input) throw new SignatureError(422, 'INVALID_FILE', 'The file is missing.');
  const encoded = input.includes('base64,') ? input.slice(input.indexOf('base64,') + 7) : input;
  const limit = maxFileBytes();
  // Reject by encoded size first, so an oversize payload is never decoded.
  if (encoded.length > Math.ceil(limit / 3) * 4 + 4) throw new SignatureError(413, 'FILE_TOO_LARGE', `The file is larger than ${Math.floor(limit / 1024 / 1024)} MB.`);
  if (!/^[A-Za-z0-9+/=\s_-]+$/.test(encoded)) throw new SignatureError(422, 'INVALID_FILE', 'The file is not valid base64.');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length) throw new SignatureError(422, 'INVALID_FILE', 'The file is empty.');
  if (bytes.length > limit) throw new SignatureError(413, 'FILE_TOO_LARGE', `The file is larger than ${Math.floor(limit / 1024 / 1024)} MB.`);
  const type = detectFileType(bytes);
  if (!type || (kind === 'signed' && type.contentType !== 'application/pdf')) {
    throw new SignatureError(422, 'INVALID_FILE', kind === 'signed' ? 'The signed copy must be a PDF file.' : 'Evidence must be a PDF, PNG or JPEG file.');
  }
  return { bytes, ...type };
}

const safeName = (value: unknown, extension: string): string => {
  const base = String(typeof value === 'string' ? value : '').replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[^\p{L}\p{N} ._()-]+/gu, '_').replace(/^[._ ]+/, '').trim().slice(0, 100);
  return `${base || 'document'}.${extension}`;
};

/** Stores the file (ownership is registered in upload_owners by saveUpload) and records it on the request. */
async function attachFile(db: Sql, request: any, kind: 'signed' | 'evidence', file: ParsedFile, fileName: unknown, uploadedBy: string): Promise<FileDto & { link: string }> {
  const name = safeName(fileName, file.extension);
  const link = await saveUpload(null, kind === 'signed' ? 'Folder Signed' : 'Folder Signature Evidence', name, file.bytes.toString('base64'), request.organization_id);
  const key = keyFromLink(link);
  if (!key) throw new SignatureError(400, 'INVALID_FILE', 'This file name cannot be stored.');
  const id = `sgf_${crypto.randomUUID()}`;
  await db.run(`INSERT INTO signature_files (id, request_id, organization_id, kind, file_name, storage_key, link, content_type, size_bytes, sha256, uploaded_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, request.id, request.organization_id, kind, name, key, link, file.contentType, file.bytes.length,
  crypto.createHash('sha256').update(file.bytes).digest('hex'), uploadedBy, new Date().toISOString());
  return { ...fileDto((await db.get(`SELECT * FROM signature_files WHERE id = ?`, id))!), link };
}

export async function readFile(db: Sql, organizationId: string, requestId: string, fileId: string) {
  const row = await db.get(`SELECT * FROM signature_files WHERE organization_id = ? AND request_id = ? AND id = ?`, organizationId, requestId, fileId);
  if (!row) return null;
  const object = await getStore().get(row.storage_key);
  return object ? { row, body: object.body } : null;
}

/* ------------------------------ events and side effects ------------------------------ */

export interface Actor { id: string; label: string; email?: string; name?: string; role?: string; req?: any }

async function recordEvent(db: Sql, request: any, type: string, actor: Actor, detail: Record<string, unknown> = {}, signerId: string | null = null) {
  await db.run(`INSERT INTO signature_events (id, request_id, organization_id, type, actor, signer_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    `sge_${crypto.randomUUID()}`, request.id, request.organization_id, type, actor.label, signerId, JSON.stringify(detail), new Date().toISOString());
}

const activity = (actor: Actor, request: any, actionType: string, description: string) =>
  addActivityLog(actor.email ?? 'system', actor.name ?? 'System', actor.role ?? 'System', actionType, 'SIGNATURES', description, actor.req, request.organization_id, { requestId: request.id, contractId: request.contract_id })
    .catch((err) => log.warn('Could not write the signature activity entry:', err));

async function enqueueNotice(db: Sql, request: any, kind: 'completed' | 'declined' | 'expired', payload: Record<string, unknown>) {
  const now = new Date().toISOString();
  await db.run(`INSERT INTO signature_notices (id, organization_id, request_id, kind, recipient_id, payload, status, next_attempt_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?) ON CONFLICT (request_id, kind, recipient_id) DO NOTHING`,
  `sgn_${crypto.randomUUID()}`, request.organization_id, request.id, kind, request.requested_by, JSON.stringify(payload), now, now, now);
}
let noticeListener: (() => void) | null = null;
export const onSignatureNoticeQueued = (listener: (() => void) | null) => { noticeListener = listener; };

const summary = (request: any, extra: Record<string, unknown> = {}) => ({
  signatureRequestId: request.id, contractId: request.contract_id, contractNumber: request.contract_number ?? null, title: request.title, mode: request.mode, status: request.status,
  provider: request.provider, ...extra,
});

/** Contract update on completion. Runs under the contract row lock, reuses the repository's version check and raises the contract events. */
async function applyCompletionToContract(db: Sql, request: any, signedFile: (FileDto & { link: string }) | null, completedAt: string) {
  const timezone = getTenantSettings(request.organization_id).timezone;
  const today = todayInTimezone(timezone);
  let before: any;
  const row = await contractRepository.mutate(request.organization_id, request.contract_id, (contract) => {
    before = structuredClone(contract);
    const next = approvalStatusAfterSignature(contract, today);
    if (next) contract.status_approval = normalizeApprovalStatus(next);
    contract.signature_request_id = request.id;
    contract.signed_at = completedAt;
    if (signedFile) {
      contract.signed_file_link = signedFile.link;
      contract.signed_file_name = signedFile.fileName;
    }
    contract.updated_at = new Date().toISOString();
  });
  if (row && before) await emitContractEvents(db, before, row);
  return row;
}

/** Transition + audit event + side effects, all in one transaction. */
async function moveTo(db: Sql, request: any, to: SignatureStatus, actor: Actor, eventType: string, detail: Record<string, unknown> = {}, patch: Record<string, unknown> = {}): Promise<any> {
  if (!canTransition(request.status, to)) throw conflict('INVALID_TRANSITION', `A request that is ${request.status} cannot become ${to}.`);
  const now = new Date().toISOString();
  const columns: Record<string, unknown> = { status: to, updated_at: now, ...patch };
  if (to === 'sent') columns.sent_at = now;
  if (to === 'completed') columns.completed_at = now;
  const names = Object.keys(columns);
  const changed = await db.get(`UPDATE signature_requests SET ${names.map((name) => `${name} = @${name}`).join(', ')}, version = version + 1
    WHERE id = @row_id AND organization_id = @row_org AND status = @row_from RETURNING *`, { ...columns, row_id: request.id, row_org: request.organization_id, row_from: request.status });
  if (!changed) throw conflict('STATE_CHANGED', 'The request changed meanwhile. Reload and try again.');
  const next = { ...request, ...changed };
  await recordEvent(db, next, eventType, actor, { from: request.status, to, ...detail });
  return next;
}

/* ------------------------------ create ------------------------------ */

const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;
export interface CreateInput {
  contractId: string; title?: unknown; message?: unknown; mode?: unknown; signers?: unknown; expiresAt?: unknown; expiresInDays?: unknown; provider?: unknown;
  documentId?: unknown; send?: unknown;
}

function parseSigners(input: unknown, mode: SignatureMode): Array<{ name: string; email: string; order: number }> {
  if (!Array.isArray(input) || input.length === 0) throw invalid('Add at least one signer.');
  if (input.length > MAX_SIGNERS) throw invalid(`A request can have at most ${MAX_SIGNERS} signers.`);
  const seen = new Set<string>();
  return input.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid(`Signer ${index + 1} must be an object.`);
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';
    if (!name || name.length > 200) throw invalid(`Signer ${index + 1}: enter a name of at most 200 characters.`);
    if (!EMAIL.test(email) || email.length > 320) throw invalid(`Signer ${index + 1}: enter a valid e-mail address.`);
    if (seen.has(email)) throw invalid(`${email} is listed twice.`);
    seen.add(email);
    let order = 1;
    if (mode === 'sequential') {
      order = raw.order === undefined || raw.order === null || raw.order === '' ? index + 1 : Number(raw.order);
      if (!Number.isInteger(order) || order < 1 || order > 99) throw invalid(`Signer ${index + 1}: the order must be a whole number from 1 to 99.`);
    }
    return { name, email, order };
  });
}

export async function createRequest(db: Sql, organizationId: string, contract: any, input: CreateInput, actor: Actor): Promise<SignatureRequestDto> {
  const mode = input.mode === undefined || input.mode === null ? 'sequential' : input.mode;
  if (!(SIGNATURE_MODES as readonly unknown[]).includes(mode)) throw invalid('The mode must be "sequential" or "parallel".');
  const signers = parseSigners(input.signers, mode as SignatureMode);
  const provider = input.provider === undefined || input.provider === null || input.provider === '' ? 'manual' : String(input.provider);
  if (!getSignatureProvider(provider)) throw invalid('Unknown signature provider.');
  const title = (typeof input.title === 'string' && input.title.trim() ? input.title.trim() : String(contract.contract_title || contract.contract_number || 'Contract')).slice(0, 300);
  const message = typeof input.message === 'string' ? input.message.trim().slice(0, 2000) : '';
  const now = Date.now();
  let expiresAt: string | null;
  if (input.expiresAt !== undefined && input.expiresAt !== null && input.expiresAt !== '') {
    const time = typeof input.expiresAt === 'string' ? Date.parse(input.expiresAt) : NaN;
    if (Number.isNaN(time) || time <= now) throw invalid('The expiry must be a date in the future.');
    if (time > now + MAX_TTL_DAYS * 86_400_000) throw invalid(`The expiry can be at most ${MAX_TTL_DAYS} days away.`);
    expiresAt = new Date(time).toISOString();
  } else {
    const days = input.expiresInDays === undefined || input.expiresInDays === null || input.expiresInDays === '' ? DEFAULT_TTL_DAYS : Number(input.expiresInDays);
    if (!Number.isInteger(days) || days < 1 || days > MAX_TTL_DAYS) throw invalid(`expiresInDays must be a whole number from 1 to ${MAX_TTL_DAYS}.`);
    expiresAt = new Date(now + days * 86_400_000).toISOString();
  }
  let documentId: string | null = null;
  if (input.documentId !== undefined && input.documentId !== null && input.documentId !== '') {
    documentId = String(input.documentId);
    if (!await db.get(`SELECT 1 FROM contract_documents WHERE organization_id = ? AND id = ?`, organizationId, documentId)) throw invalid('The document was not found.');
  }
  const id = `sig_${crypto.randomUUID()}`;
  const created = await db.tx(async () => {
    // Serialized per contract so two people cannot open two requests at once.
    await db.get('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', `signature:${organizationId}:${contract.contract_id}`);
    if (await db.get(`SELECT 1 FROM signature_requests WHERE organization_id = ? AND contract_id = ? AND status IN ('draft', 'sent', 'partially_signed')`, organizationId, contract.contract_id)) {
      throw conflict('OPEN_REQUEST_EXISTS', 'This contract already has an open signature request. Cancel it or wait for it to finish.');
    }
    const at = new Date().toISOString();
    await db.run(`INSERT INTO signature_requests (id, organization_id, contract_id, document_id, title, message, mode, status, provider, source_file_link, source_file_name, expires_at, requested_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`, id, organizationId, contract.contract_id, documentId, title, message, mode, provider,
    contract.contract_file_link || null, contract.fileName || null, expiresAt, actor.id, at, at);
    for (const signer of signers) {
      await db.run(`INSERT INTO signature_signers (id, request_id, organization_id, name, email, signing_order, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
        `sgs_${crypto.randomUUID()}`, id, organizationId, signer.name, signer.email, signer.order, at);
    }
    const row = (await getRequestRow(db, organizationId, id))!;
    await recordEvent(db, row, 'created', actor, { signers: signers.length, mode, provider, expiresAt });
    return row;
  });
  await activity(actor, created, 'SIGNATURE_REQUEST', `Created a signature request for contract '${contract.contract_number}'`);
  const wantsSend = input.send === true;
  return wantsSend ? sendRequest(db, organizationId, id, actor) : (await getRequest(db, organizationId, id))!;
}

const viewOf = async (db: Sql, row: any): Promise<SignatureRequestView> => {
  const dto = await toDto(db, row);
  return { id: row.id, organizationId: row.organization_id, contractId: row.contract_id, title: row.title, message: row.message, mode: row.mode, status: row.status, provider: row.provider,
    providerRef: row.provider_ref, expiresAt: row.expires_at, signers: dto.signers.map((s) => ({ id: s.id, name: s.name, email: s.email, order: s.order, status: s.status })) };
};

async function load(db: Sql, organizationId: string, id: string, lock = false): Promise<any> {
  const row = await db.get(`${SELECT} WHERE r.organization_id = ? AND r.id = ?${lock ? ' FOR UPDATE OF r' : ''}`, organizationId, id);
  if (!row) throw notFound();
  return row;
}

/* ------------------------------ send / resend / cancel ------------------------------ */

export async function sendRequest(db: Sql, organizationId: string, id: string, actor: Actor): Promise<SignatureRequestDto> {
  const result = await db.tx(async () => {
    const row = await load(db, organizationId, id, true);
    if (row.status !== 'draft') throw conflict('INVALID_TRANSITION', 'Only a draft request can be sent.');
    const provider = getSignatureProvider(row.provider);
    if (!provider) throw conflict('PROVIDER_UNAVAILABLE', 'The signature provider of this request is not available.');
    let sent;
    try { sent = await provider.send(await viewOf(db, row), { actor: actor.label }); } catch (err) {
      throw new SignatureError(502, 'PROVIDER_FAILED', `The provider could not send the request: ${(err as Error).message}`);
    }
    const next = await moveTo(db, row, 'sent', actor, 'sent', { provider: provider.id, note: sent.note ?? null }, sent.providerRef ? { provider_ref: sent.providerRef } : {});
    await emitWebhookEvent(db, organizationId, 'signature.sent', summary(next, { providerRef: sent.providerRef ?? next.provider_ref ?? null, signers: (await signersOf(db, id, next.mode, true)).map((s) => ({ name: s.name, email: s.email, order: s.order })) }));
    return next;
  });
  await activity(actor, result, 'SIGNATURE_SENT', `Sent signature request '${result.title}' for signing`);
  return (await getRequest(db, organizationId, id))!;
}

export async function resendRequest(db: Sql, organizationId: string, id: string, actor: Actor): Promise<SignatureRequestDto> {
  await db.tx(async () => {
    const row = await load(db, organizationId, id, true);
    if (!isOpen(row.status)) throw conflict('INVALID_TRANSITION', 'Only a request that is out for signature can be sent again.');
    const last = await db.get<{ created_at: string }>(`SELECT created_at FROM signature_events WHERE request_id = ? AND type = 'resent' ORDER BY created_at DESC LIMIT 1`, id);
    if (last && Date.now() - Date.parse(last.created_at) < 60_000) throw new SignatureError(429, 'TOO_SOON', 'A reminder was recorded less than a minute ago.');
    const provider = getSignatureProvider(row.provider);
    if (!provider) throw conflict('PROVIDER_UNAVAILABLE', 'The signature provider of this request is not available.');
    let outcome;
    try { outcome = await provider.resend(await viewOf(db, row), { actor: actor.label }); } catch (err) {
      throw new SignatureError(502, 'PROVIDER_FAILED', `The provider could not send the reminder: ${(err as Error).message}`);
    }
    await recordEvent(db, row, 'resent', actor, { note: outcome.note ?? null });
    await db.run(`UPDATE signature_requests SET updated_at = ?, version = version + 1 WHERE id = ?`, new Date().toISOString(), id);
  });
  return (await getRequest(db, organizationId, id))!;
}

export async function cancelRequest(db: Sql, organizationId: string, id: string, actor: Actor, reason?: unknown): Promise<SignatureRequestDto> {
  const text = typeof reason === 'string' ? reason.trim().slice(0, 1000) : '';
  const cancelled = await db.tx(async () => {
    const row = await load(db, organizationId, id, true);
    if (isFinal(row.status)) throw conflict('INVALID_TRANSITION', `A request that is ${row.status} cannot be cancelled.`);
    let providerNote: string | null = null;
    const provider = getSignatureProvider(row.provider);
    if (provider && row.status !== 'draft') {
      try { await provider.cancel(await viewOf(db, row), { actor: actor.label }); } catch (err) { providerNote = `The provider could not withdraw the request: ${(err as Error).message}`; }
    }
    return moveTo(db, row, 'cancelled', actor, 'cancelled', { reason: text || null, providerNote }, { closed_reason: text || 'cancelled' });
  });
  await activity(actor, cancelled, 'SIGNATURE_CANCELLED', `Cancelled signature request '${cancelled.title}'`);
  return (await getRequest(db, organizationId, id))!;
}

/* ------------------------------ signing progress ------------------------------ */

interface CompletionInput { signedFile?: ParsedFile; signedFileName?: unknown; evidence?: Array<{ file: ParsedFile; name: unknown }>; occurredAt?: string }

async function finishCompletion(db: Sql, row: any, actor: Actor, input: CompletionInput, eventDetail: Record<string, unknown>): Promise<any> {
  const uploadedBy = actor.label;
  let signedFile: (FileDto & { link: string }) | null = null;
  if (input.signedFile) signedFile = await attachFile(db, row, 'signed', input.signedFile, input.signedFileName, uploadedBy);
  for (const item of input.evidence ?? []) await attachFile(db, row, 'evidence', item.file, item.name, uploadedBy);
  const next = await moveTo(db, row, 'completed', actor, 'completed', { signedCopy: Boolean(signedFile), ...eventDetail }, { signed_file_id: signedFile?.id ?? null, closed_reason: 'completed' });
  await applyCompletionToContract(db, next, signedFile, next.completed_at);
  await enqueueNotice(db, next, 'completed', { title: next.title, contractNumber: row.contract_number ?? null, signedCopy: Boolean(signedFile) });
  await emitWebhookEvent(db, row.organization_id, 'signature.completed', summary(next, {
    completedAt: next.completed_at, signedFile: signedFile ? { name: signedFile.fileName, sha256: signedFile.sha256, sizeBytes: signedFile.sizeBytes } : null,
    signers: (await signersOf(db, row.id, row.mode, false)).map((s) => ({ name: s.name, email: s.email, signedAt: s.signedAt })),
  }));
  setImmediate(() => noticeListener?.());
  return next;
}

async function markSigned(db: Sql, row: any, signer: any, actor: Actor, occurredAt: string | null, detail: Record<string, unknown> = {}) {
  const signedAt = occurredAt ?? new Date().toISOString();
  await db.run(`UPDATE signature_signers SET status = 'signed', signed_at = ? WHERE id = ? AND status = 'pending'`, signedAt, signer.id);
  await recordEvent(db, row, 'signer_signed', actor, { name: signer.name, email: signer.email, ...detail }, signer.id);
}

async function loadSigners(db: Sql, requestId: string) {
  return db.all(`SELECT * FROM signature_signers WHERE request_id = ? ORDER BY signing_order, created_at, id`, requestId);
}
const findSigner = (signers: any[], ref: { signerId?: string; email?: string; externalId?: string }) =>
  signers.find((signer) => (ref.signerId && signer.id === ref.signerId) || (ref.externalId && signer.external_id === ref.externalId) || (ref.email && signer.email === ref.email.trim().toLowerCase()));

export interface SignerRef { signerId?: string; email?: string; externalId?: string }

/** One signer signed (by hand or reported by a provider). The last one completes the request. Returns the new row, or null when it was already recorded. */
export async function signerSigned(db: Sql, organizationId: string, id: string, ref: SignerRef, actor: Actor, options: CompletionInput & { enforceOrder?: boolean } = {}): Promise<{ request: SignatureRequestDto; duplicate: boolean }> {
  const outcome = await db.tx(async () => {
    const row = await load(db, organizationId, id, true);
    const signers = await loadSigners(db, id);
    const signer = findSigner(signers, ref);
    if (!signer) throw new SignatureError(404, 'SIGNER_NOT_FOUND', 'No such signer on this request.');
    if (signer.status === 'signed') return { duplicate: true, row };
    if (signer.status === 'declined') throw conflict('INVALID_TRANSITION', 'This signer declined.');
    if (!isOpen(row.status)) throw conflict('INVALID_TRANSITION', row.status === 'draft' ? 'Send the request before recording signatures.' : `A request that is ${row.status} cannot be signed.`);
    const likes = signers.map((s: any) => ({ id: s.id, signing_order: s.signing_order, status: s.status }));
    if (options.enforceOrder !== false && !mayNowSign(row.mode, likes.find((s: any) => s.id === signer.id)!, likes)) {
      throw conflict('NOT_THEIR_TURN', 'This request is sequential: earlier signers have to sign first.');
    }
    await markSigned(db, row, signer, actor, options.occurredAt ?? null);
    const after = (await loadSigners(db, id)).map((s: any) => ({ id: s.id, signing_order: s.signing_order, status: s.status as SignerStatus }));
    const target = statusAfterSigning(after);
    const files: CompletionInput = { signedFile: options.signedFile, signedFileName: options.signedFileName, evidence: options.evidence };
    if (target === 'completed') return { duplicate: false, row: await finishCompletion(db, row, actor, files, { lastSigner: signer.email }) };
    // Files that came with a partial signature are kept as evidence.
    for (const item of [...(options.signedFile ? [{ file: options.signedFile, name: options.signedFileName }] : []), ...(options.evidence ?? [])]) {
      await attachFile(db, row, 'evidence', item.file, item.name, actor.label);
    }
    return { duplicate: false, row: await moveTo(db, row, 'partially_signed', actor, 'progress', { signed: after.filter((s) => s.status === 'signed').length, of: after.length }) };
  });
  if (!outcome.duplicate && outcome.row.status === 'completed') await activity(actor, outcome.row, 'SIGNATURE_COMPLETED', `Signature request '${outcome.row.title}' is fully signed`);
  return { request: (await getRequest(db, organizationId, id))!, duplicate: outcome.duplicate };
}

export async function signerDeclined(db: Sql, organizationId: string, id: string, ref: SignerRef, actor: Actor, reason: unknown): Promise<SignatureRequestDto> {
  const text = typeof reason === 'string' ? reason.trim().slice(0, 1000) : '';
  const declined = await db.tx(async () => {
    const row = await load(db, organizationId, id, true);
    const signer = findSigner(await loadSigners(db, id), ref);
    if (!signer) throw new SignatureError(404, 'SIGNER_NOT_FOUND', 'No such signer on this request.');
    if (!isOpen(row.status)) throw conflict('INVALID_TRANSITION', `A request that is ${row.status} cannot be declined.`);
    if (signer.status !== 'pending') throw conflict('INVALID_TRANSITION', `This signer already ${signer.status === 'signed' ? 'signed' : 'declined'}.`);
    await db.run(`UPDATE signature_signers SET status = 'declined', decline_reason = ? WHERE id = ?`, text || null, signer.id);
    await recordEvent(db, row, 'signer_declined', actor, { name: signer.name, email: signer.email, reason: text || null }, signer.id);
    const next = await moveTo(db, row, 'declined', actor, 'declined', { by: signer.email, reason: text || null }, { closed_reason: text || 'declined' });
    await enqueueNotice(db, next, 'declined', { title: next.title, contractNumber: row.contract_number ?? null, signerName: signer.name, signerEmail: signer.email, reason: text || null });
    await emitWebhookEvent(db, organizationId, 'signature.declined', summary(next, { declinedBy: { name: signer.name, email: signer.email }, reason: text || null }));
    setImmediate(() => noticeListener?.());
    return next;
  });
  await activity(actor, declined, 'SIGNATURE_DECLINED', `Signature request '${declined.title}' was declined`);
  return (await getRequest(db, organizationId, id))!;
}

/** The manual "mark as signed" path: every pending signer is recorded as signed (in order), the signed copy is attached and the request completes. */
export async function completeWithSignedCopy(db: Sql, organizationId: string, id: string, actor: Actor, input: { file: ParsedFile; fileName?: unknown; evidence?: CompletionInput['evidence']; occurredAt?: string }): Promise<SignatureRequestDto> {
  const done = await db.tx(async () => {
    const row = await load(db, organizationId, id, true);
    if (!isOpen(row.status)) throw conflict('INVALID_TRANSITION', row.status === 'draft' ? 'Send the request before marking it as signed.' : `A request that is ${row.status} cannot be completed.`);
    for (const signer of await loadSigners(db, id)) {
      if (signer.status === 'pending') await markSigned(db, row, signer, actor, input.occurredAt ?? null, { via: 'signed copy' });
      else if (signer.status === 'declined') throw conflict('INVALID_TRANSITION', 'A signer declined this request.');
    }
    return finishCompletion(db, row, actor, { signedFile: input.file, signedFileName: input.fileName, evidence: input.evidence }, { via: 'signed_copy' });
  });
  await activity(actor, done, 'SIGNATURE_COMPLETED', `Marked signature request '${done.title}' as signed with an uploaded copy`);
  return (await getRequest(db, organizationId, id))!;
}

/** Evidence or a (late) signed copy. A signed copy on a completed request becomes the contract's signed link. */
export async function addFiles(db: Sql, organizationId: string, id: string, actor: Actor, items: Array<{ kind: 'signed' | 'evidence'; file: ParsedFile; name: unknown }>): Promise<SignatureRequestDto> {
  if (!items.length || items.length > MAX_EVIDENCE_PER_UPLOAD) throw invalid(`Send between 1 and ${MAX_EVIDENCE_PER_UPLOAD} files.`);
  const row = await db.tx(async () => {
    const request = await load(db, organizationId, id, true);
    if (request.status === 'draft' || request.status === 'cancelled') throw conflict('INVALID_TRANSITION', `Files cannot be added to a request that is ${request.status}.`);
    let latestSigned: (FileDto & { link: string }) | null = null;
    for (const item of items) {
      if (item.kind === 'signed' && request.status !== 'completed') throw conflict('INVALID_TRANSITION', 'A signed copy can be added once the request is completed; until then upload evidence or use "mark as signed".');
      const stored = await attachFile(db, request, item.kind, item.file, item.name, actor.label);
      await recordEvent(db, request, item.kind === 'signed' ? 'signed_copy_attached' : 'evidence_added', actor, { fileName: stored.fileName, sha256: stored.sha256, sizeBytes: stored.sizeBytes });
      if (item.kind === 'signed') latestSigned = stored;
    }
    if (latestSigned) {
      await db.run(`UPDATE signature_requests SET signed_file_id = ?, updated_at = ?, version = version + 1 WHERE id = ?`, latestSigned.id, new Date().toISOString(), id);
      await applyCompletionToContract(db, request, latestSigned, request.completed_at ?? new Date().toISOString());
    } else {
      await db.run(`UPDATE signature_requests SET updated_at = ?, version = version + 1 WHERE id = ?`, new Date().toISOString(), id);
    }
    return request;
  });
  await activity(actor, row, 'SIGNATURE_FILES', `Added ${items.length} file(s) to signature request '${row.title}'`);
  return (await getRequest(db, organizationId, id))!;
}

/* ------------------------------ expiry ------------------------------ */

/** Expires every open request whose date has passed. Idempotent: the guarded UPDATE claims each request once. Run under SIGNATURE_LOCK_KEY. */
export async function expireDueRequests(db: Sql, now = new Date(), limit = 200): Promise<number> {
  const system: Actor = { id: 'system', label: 'system', role: 'System' };
  let count = 0;
  const due = await db.all(`SELECT id, organization_id FROM signature_requests WHERE status IN ('sent', 'partially_signed') AND expires_at IS NOT NULL AND expires_at <= ? ORDER BY expires_at LIMIT ?`, now.toISOString(), limit);
  for (const candidate of due) {
    const expired = await db.tx(async () => {
      const row = await db.get(`${SELECT} WHERE r.id = ? AND r.status IN ('sent', 'partially_signed') AND r.expires_at <= ? FOR UPDATE OF r`, candidate.id, now.toISOString());
      if (!row) return null;
      const next = await moveTo(db, row, 'expired', system, 'expired', { expiresAt: row.expires_at }, { closed_reason: 'expired' });
      await enqueueNotice(db, next, 'expired', { title: next.title, contractNumber: row.contract_number ?? null, expiresAt: row.expires_at });
      await emitWebhookEvent(db, row.organization_id, 'signature.expired', summary(next, { expiresAt: row.expires_at }));
      return next;
    });
    if (expired) {
      count++;
      await activity(system, expired, 'SIGNATURE_EXPIRED', `Signature request '${expired.title}' expired`);
    }
  }
  if (count) setImmediate(() => noticeListener?.());
  return count;
}

/* ------------------------------ inbound endpoints ------------------------------ */

export const newEndpointSecret = () => `sigsec_${crypto.randomBytes(32).toString('base64url')}`;
export const MAX_ENDPOINTS = 10;
export interface EndpointDto { id: string; name: string; enabled: boolean; createdAt: string; rotatedAt: string | null; lastReceivedAt: string | null }
const endpointDto = (row: any): EndpointDto => ({ id: row.id, name: row.name, enabled: row.enabled, createdAt: row.created_at, rotatedAt: row.rotated_at, lastReceivedAt: row.last_received_at });

export async function listEndpoints(db: Sql, organizationId: string): Promise<EndpointDto[]> {
  return (await db.all(`SELECT * FROM signature_endpoints WHERE organization_id = ? ORDER BY created_at, id`, organizationId)).map(endpointDto);
}
export async function createEndpoint(db: Sql, organizationId: string, createdBy: string, body: unknown): Promise<{ endpoint: EndpointDto; secret: string }> {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 100) throw invalid('Enter a name of at most 100 characters.');
  if ((await listEndpoints(db, organizationId)).length >= MAX_ENDPOINTS) throw conflict('LIMIT_REACHED', `At most ${MAX_ENDPOINTS} endpoints per organization.`);
  const id = `sgw_${crypto.randomBytes(16).toString('hex')}`;
  const secret = newEndpointSecret();
  const now = new Date().toISOString();
  await db.run(`INSERT INTO signature_endpoints (id, organization_id, name, secret_sealed, enabled, created_by, created_at) VALUES (?, ?, ?, ?, true, ?, ?)`, id, organizationId, name, seal(secret), createdBy, now);
  return { endpoint: endpointDto((await db.get(`SELECT * FROM signature_endpoints WHERE id = ?`, id))!), secret };
}
export async function rotateEndpointSecret(db: Sql, organizationId: string, id: string): Promise<string | null> {
  const secret = newEndpointSecret();
  const result = await db.run(`UPDATE signature_endpoints SET secret_sealed = ?, rotated_at = ? WHERE organization_id = ? AND id = ?`, seal(secret), new Date().toISOString(), organizationId, id);
  return result.changes ? secret : null;
}
export async function updateEndpoint(db: Sql, organizationId: string, id: string, body: unknown): Promise<EndpointDto | null> {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  for (const key of Object.keys(input)) if (!['name', 'enabled'].includes(key)) throw invalid(`Unknown field: ${key}`);
  const current = await db.get(`SELECT * FROM signature_endpoints WHERE organization_id = ? AND id = ?`, organizationId, id);
  if (!current) return null;
  const name = input.name === undefined ? current.name : typeof input.name === 'string' && input.name.trim() && input.name.trim().length <= 100 ? input.name.trim() : (() => { throw invalid('Enter a name of at most 100 characters.'); })();
  const enabled = input.enabled === undefined ? current.enabled : input.enabled === true;
  await db.run(`UPDATE signature_endpoints SET name = ?, enabled = ? WHERE id = ?`, name, enabled, id);
  return endpointDto((await db.get(`SELECT * FROM signature_endpoints WHERE id = ?`, id))!);
}
export async function deleteEndpoint(db: Sql, organizationId: string, id: string): Promise<boolean> {
  return (await db.run(`DELETE FROM signature_endpoints WHERE organization_id = ? AND id = ?`, organizationId, id)).changes > 0;
}

/* ------------------------------ inbound webhook ------------------------------ */

export const INBOUND_EVENT_TYPES = ['request.sent', 'signer.signed', 'signer.declined', 'request.completed', 'request.declined', 'request.expired', 'request.cancelled', 'request.document'] as const;
type InboundType = (typeof INBOUND_EVENT_TYPES)[number];
export const SIGNATURE_TIMESTAMP_TOLERANCE_SECONDS = 300;
const KEY = /^[A-Za-z0-9._:\-]{1,128}$/;

export interface InboundResult { status: number; body: Record<string, unknown> }
const reject = (status: number, code: string, message: string): InboundResult => ({ status, body: { error: code, code, message } });
const REJECTED = reject(401, 'INVALID_SIGNATURE', 'The signature could not be verified.');

function parseDocument(raw: unknown, kind: 'signed' | 'evidence') {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new SignatureError(422, 'INVALID_FILE', 'document must be an object.');
  const doc = raw as Record<string, unknown>;
  return { file: parseFileInput(doc.contentBase64 ?? doc.content_base64 ?? doc.data, kind), name: doc.fileName ?? doc.file_name };
}

/**
 * Verifies and applies one signed inbound delivery. Authenticity: HMAC-SHA256 over `<timestamp>.<raw body>` with the endpoint's sealed secret
 * (header `Legalio-Signature: t=<unix seconds>,v1=<hex>`), timestamp within 5 minutes. Replays: the `Idempotency-Key` header (or body `eventId`)
 * is recorded with the delivery; the same key again answers 200 `duplicate` and changes nothing. Unknown, disabled and badly signed
 * endpoints all answer the same 401, so endpoint ids cannot be probed.
 */
export async function receiveInbound(db: Sql, endpointId: string, rawBody: Buffer, headers: Record<string, string | string[] | undefined>, now = Date.now()): Promise<InboundResult> {
  const endpoint = typeof endpointId === 'string' && /^sgw_[0-9a-f]{32}$/.test(endpointId) ? await db.get(`SELECT * FROM signature_endpoints WHERE id = ?`, endpointId) : undefined;
  const signatureHeader = String(headers['legalio-signature'] ?? '');
  let secret = '';
  if (endpoint?.enabled) { try { secret = open(endpoint.secret_sealed); } catch { secret = ''; } }
  // A dummy secret keeps the work comparable when the endpoint is unknown.
  const verified = verifySignature(secret || 'x'.repeat(32), signatureHeader, rawBody.toString('utf8'), SIGNATURE_TIMESTAMP_TOLERANCE_SECONDS, Math.floor(now / 1000));
  if (!endpoint || !endpoint.enabled || !secret || !verified) return REJECTED;

  let body: any;
  try { body = JSON.parse(rawBody.toString('utf8')); } catch { return reject(400, 'INVALID_INPUT', 'The body must be JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reject(400, 'INVALID_INPUT', 'The body must be a JSON object.');
  const key = String(headers['idempotency-key'] ?? body.eventId ?? '');
  if (!KEY.test(key)) return reject(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header (or "eventId") of 1-128 letters, digits or . _ : -');
  if (!(INBOUND_EVENT_TYPES as readonly string[]).includes(body.type)) return reject(400, 'INVALID_INPUT', `type must be one of ${INBOUND_EVENT_TYPES.join(', ')}.`);

  try {
    return await db.tx(async () => {
      const receipt = await db.run(`INSERT INTO signature_receipts (endpoint_id, idempotency_key, outcome, received_at) VALUES (?, ?, 'processing', ?) ON CONFLICT DO NOTHING`, endpoint.id, key, new Date().toISOString());
      if (!receipt.changes) return { status: 200, body: { status: 'duplicate' } };
      const outcome = await applyInboundEvent(db, endpoint, body);
      await db.run(`UPDATE signature_receipts SET outcome = ?, request_id = ? WHERE endpoint_id = ? AND idempotency_key = ?`, outcome.outcome, outcome.requestId, endpoint.id, key);
      await db.run(`UPDATE signature_endpoints SET last_received_at = ? WHERE id = ?`, new Date().toISOString(), endpoint.id);
      return { status: 200, body: { status: outcome.outcome, requestId: outcome.requestId, requestStatus: outcome.requestStatus } };
    });
  } catch (err) {
    if (err instanceof SignatureError) return reject(err.status, err.code, err.message);
    throw err;
  }
}

/** The canonical event, applied through the same operations as the manual path (actor `webhook:<endpoint>`). */
export async function applyInboundEvent(db: Sql, endpoint: { id: string; organization_id: string; name?: string }, body: Record<string, any>): Promise<{ outcome: string; requestId: string; requestStatus: string }> {
  const organizationId = endpoint.organization_id;
  const type = body.type as InboundType;
  const actor: Actor = { id: `webhook:${endpoint.id}`, label: `webhook:${endpoint.id}`, name: endpoint.name ? `Signing webhook (${endpoint.name})` : 'Signing webhook', role: 'Integration' };
  let row: any;
  if (typeof body.requestId === 'string' && body.requestId) row = await db.get(`${SELECT} WHERE r.organization_id = ? AND r.id = ?`, organizationId, body.requestId);
  else if (typeof body.providerRef === 'string' && body.providerRef) {
    row = await db.get(`${SELECT} WHERE r.organization_id = ? AND r.provider_ref = ? ORDER BY r.created_at DESC LIMIT 1`, organizationId, body.providerRef);
  } else throw invalid('Name the request with "requestId" or "providerRef".');
  if (!row) throw notFound();
  const id = row.id;
  const occurredAt = typeof body.occurredAt === 'string' && !Number.isNaN(Date.parse(body.occurredAt)) ? new Date(body.occurredAt).toISOString() : undefined;
  const signerRef: SignerRef = {
    email: typeof body.signer?.email === 'string' ? body.signer.email : undefined,
    externalId: typeof body.signer?.id === 'string' ? body.signer.id : undefined,
  };
  const signed = parseDocument(body.document, 'signed');
  const evidence = (Array.isArray(body.evidence) ? body.evidence.slice(0, MAX_EVIDENCE_PER_UPLOAD) : []).map((item: unknown) => parseDocument(item, 'evidence')!).filter(Boolean);
  const result = (outcome: string, request: SignatureRequestDto) => ({ outcome, requestId: id, requestStatus: request.status });

  switch (type) {
    case 'request.sent': {
      if (row.status !== 'draft') return result('duplicate', (await getRequest(db, organizationId, id, false))!);
      if (typeof body.providerRef === 'string' && body.providerRef && !row.provider_ref) await db.run(`UPDATE signature_requests SET provider_ref = ? WHERE id = ?`, body.providerRef.slice(0, 200), id);
      return result('applied', await sendRequest(db, organizationId, id, actor));
    }
    case 'signer.signed': {
      if (!signerRef.email && !signerRef.externalId) throw invalid('Name the signer with signer.email or signer.id.');
      // The provider is the authority on who signed when; the sequence is enforced only for manual entries.
      const outcome = await signerSigned(db, organizationId, id, signerRef, actor, { signedFile: signed?.file, signedFileName: signed?.name, evidence, occurredAt, enforceOrder: false });
      return result(outcome.duplicate ? 'duplicate' : 'applied', outcome.request);
    }
    case 'request.completed': {
      if (row.status === 'completed') {
        if (signed) return result('applied', await addFiles(db, organizationId, id, actor, [{ kind: 'signed', file: signed.file, name: signed.name }, ...evidence.map((e: any) => ({ kind: 'evidence' as const, file: e.file, name: e.name }))]));
        return result('duplicate', (await getRequest(db, organizationId, id, false))!);
      }
      if (signed) return result('applied', await completeWithSignedCopy(db, organizationId, id, actor, { file: signed.file, fileName: signed.name, evidence, occurredAt }));
      // Completed without a document: every pending signer is recorded as signed, the copy can follow as `request.document`.
      const pending = (await loadSigners(db, id)).filter((signer: any) => signer.status === 'pending');
      if (!pending.length) throw conflict('INVALID_TRANSITION', 'Nothing is left to sign.');
      let last;
      for (const signer of pending) last = await signerSigned(db, organizationId, id, { signerId: signer.id }, actor, { occurredAt, enforceOrder: false, evidence: signer === pending[pending.length - 1] ? evidence : undefined });
      return result('applied', last!.request);
    }
    case 'request.document': {
      if (!signed && !evidence.length) throw invalid('Send "document" (the signed copy) or "evidence".');
      const items = [...(signed ? [{ kind: 'signed' as const, file: signed.file, name: signed.name }] : []), ...evidence.map((e: any) => ({ kind: 'evidence' as const, file: e.file, name: e.name }))];
      return result('applied', await addFiles(db, organizationId, id, actor, items));
    }
    case 'signer.declined':
    case 'request.declined': {
      if (row.status === 'declined') return result('duplicate', (await getRequest(db, organizationId, id, false))!);
      const pending = (await loadSigners(db, id)).find((signer: any) => signer.status === 'pending');
      const ref: SignerRef = signerRef.email || signerRef.externalId ? signerRef : { signerId: pending?.id };
      return result('applied', await signerDeclined(db, organizationId, id, ref, actor, body.reason));
    }
    case 'request.expired': {
      if (row.status === 'expired') return result('duplicate', (await getRequest(db, organizationId, id, false))!);
      return result('applied', await externalClose(db, organizationId, id, 'expired', actor, body.reason));
    }
    case 'request.cancelled': {
      if (row.status === 'cancelled') return result('duplicate', (await getRequest(db, organizationId, id, false))!);
      return result('applied', await cancelRequest(db, organizationId, id, actor, body.reason));
    }
  }
}

/** The provider reports the request expired on its side. */
async function externalClose(db: Sql, organizationId: string, id: string, to: 'expired', actor: Actor, reason: unknown): Promise<SignatureRequestDto> {
  const closed = await db.tx(async () => {
    const row = await load(db, organizationId, id, true);
    const next = await moveTo(db, row, to, actor, 'expired', { reportedBy: actor.label, reason: typeof reason === 'string' ? reason.slice(0, 500) : null }, { closed_reason: 'expired' });
    await enqueueNotice(db, next, 'expired', { title: next.title, contractNumber: row.contract_number ?? null, expiresAt: row.expires_at });
    await emitWebhookEvent(db, organizationId, 'signature.expired', summary(next, { expiresAt: row.expires_at, reportedByProvider: true }));
    setImmediate(() => noticeListener?.());
    return next;
  });
  await activity(actor, closed, 'SIGNATURE_EXPIRED', `Signature request '${closed.title}' expired`);
  return (await getRequest(db, organizationId, id))!;
}

/** Idempotency keys are only needed for the replay window plus margin. */
export async function pruneReceipts(db: Sql, now = new Date()): Promise<number> {
  return (await db.run(`DELETE FROM signature_receipts WHERE received_at < ?`, new Date(now.getTime() - 7 * 86_400_000).toISOString())).changes;
}

export { SIGNATURE_STATUSES, currentSigners };
