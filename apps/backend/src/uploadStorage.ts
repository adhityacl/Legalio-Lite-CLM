import express from 'express';
import path from 'path';
import { CosConfig, ObjectStore, cosStore, memoryStore, keyFromLink } from './objectStore';
import { googleCredentials } from './googleCredentialStore';
import { IS_TEST_MODE } from './runtimePaths';
import { ApiError } from './organizationSettingsStore';
import { RecordKind, createOrganizationScope, teamsOf, recordVisible } from './recordScope';
import { createEntityRepository } from './repositories/entityRepository';
import { entityFor } from './normalizedSchema';
import { scopeCollections } from './recordAccess';
import { onDbSaved, db } from './memoryDb';
import { resolveIdentity, RequestDenied, sendError, resolveOrganizationContext } from './identity';
import { sql } from './db';
import { eligibleOwners, newUploadKey, recordUploadOwner } from './uploadOwnership';
import { OrgContext, can } from './rbac';
import { addActivityLog } from './recordAccess';
import { componentLog } from './logger';
const log = componentLog('uploadStorage');

/** Upload storage (Tencent COS, in-memory under APP_TEST_MODE), server-written ownership, and the private /uploads authorization. */

/** Called with the storage key after every stored upload (the optional Google Drive backup subscribes). */
const uploadStoredListeners: Array<(key: string) => void> = [];
export function onUploadStored(listener: (key: string) => void) { uploadStoredListeners.push(listener); }
let storageCache: { config: CosConfig | null; store: ObjectStore } | null = null;
/** Upload storage: Tencent COS from the saved credentials (rebuilt after every save); in-memory only for APP_TEST_MODE. */
export function getStore(): ObjectStore {
  const config = googleCredentials.getCos();
  if (!storageCache || storageCache.config !== config) {
    if (!config && !IS_TEST_MODE) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "File storage (Tencent COS) is not configured.");
    storageCache = { config, store: config ? cosStore(config) : memoryStore() };
  }
  return storageCache.store;
}
/*
 * Uploaded evidence is private (PRD §11.5). A file is served only when it
 * resolves to persisted records that own it, and the caller can see at least
 * one of those records in that record's organization and department scope.
 * Folder names are never proof of ownership (two organizations can sanitize
 * to the same name), and unowned root files are denied, not deleted.
 */
/**
 * Kinds of record that can own an upload, and where their links are stored. Repository-backed kinds are looked up in PostgreSQL on demand
 * (the file name is a cheap pre-filter on these columns and child tables, the exact link is confirmed on the hydrated record); the
 * rest are scanned in the in-memory projection.
 */
interface UploadKind { kind: RecordKind; table: string; collection: string; columns: string[]; children?: Array<{ table: string; parent: string; columns: string[] }> }
export const UPLOAD_KINDS: UploadKind[] = [
  { kind: "partner", table: "partners", collection: "partners", columns: ["dd_folder_link", "extra_json"], children: [
    { table: "partner_dd_requirements", parent: "partner_id", columns: ["link_drive", "extra_json"] },
    { table: "partner_dd_files", parent: "partner_id", columns: ["link_drive", "extra_json"] },
  ] },
  { kind: "io", table: "insertion_orders", collection: "ios", columns: ["io_file_link", "extra_json"] },
  { kind: "spending", table: "spendings", collection: "spendings", columns: ["invoice_file_url", "billing_file_url", "folder_link", "extra_json"] },
  { kind: "evaluation", table: "evaluations", collection: "evaluations", columns: ["extra_json"] },
  { kind: "contract", table: "contracts", collection: "contracts", columns: ["contract_file_link", "termination_document", "extra_json"] },
];
const isRepositoryBacked = (spec: UploadKind) => Boolean(entityFor(spec.table).repository);
let uploadIndex: Map<string, Array<{ kind: RecordKind; record: any }>> | null = null;
onDbSaved(() => { uploadIndex = null; });
export function normalizeUploadPath(value: string): string | null {
  try {
    const raw = value.split(/[?#]/)[0];
    const at = raw.indexOf("/uploads/");
    if (at < 0) return null;
    const decoded = decodeURIComponent(raw.slice(at));
    if (decoded.includes("\0") || decoded.slice("/uploads/".length).split("/").some((seg) => seg.startsWith("."))) return null;
    return decoded;
  } catch {
    return null;
  }
}
const likeEscape = (value: string) => value.replace(/[\\%_]/g, (c) => "\\" + c);
/** Records of a repository-backed kind whose stored JSON links this upload; found by the file name first (cheap filter), then confirmed exactly. */
async function repositoryOwners(spec: UploadKind, urlPath: string) {
  const name = urlPath.split("/").pop() || "";
  if (!name) return [];
  const variants = [...new Set([name, encodeURI(name), encodeURIComponent(name)])].map((v) => `%${likeEscape(v)}%`);
  const entity = entityFor(spec.table);
  const own = spec.columns.map((column) => `${column} LIKE ANY(?)`);
  const viaChildren = (spec.children ?? []).map((child) => `${entity.key} IN (SELECT ${child.parent} FROM ${child.table} WHERE ${child.columns.map((column) => `${column} LIKE ANY(?)`).join(" OR ")})`);
  const records = await createEntityRepository(sql, spec.table).hydrate(await sql.all(
    `SELECT * FROM ${spec.table} WHERE ${[...own, ...viaChildren].join(" OR ")}`,
    ...own.map(() => variants), ...(spec.children ?? []).flatMap((child) => child.columns.map(() => variants))));
  return records
    .filter((record: any) => (JSON.stringify(record).match(/\/uploads\/[^"\\]+/g) || []).some((url) => normalizeUploadPath(url) === urlPath))
    .map((record: any) => ({ kind: spec.kind, record }));
}
export async function uploadOwners(urlPath: string) {
  if (!uploadIndex) {
    uploadIndex = new Map();
    for (const spec of UPLOAD_KINDS) {
      if (isRepositoryBacked(spec)) continue;
      for (const record of db[spec.collection] || []) {
        const urls = JSON.stringify(record).match(/\/uploads\/[^"\\]+/g) || [];
        for (const url of urls) {
          const key = normalizeUploadPath(url);
          if (!key) continue;
          const owners = uploadIndex.get(key) || [];
          owners.push({ kind: spec.kind, record });
          uploadIndex.set(key, owners);
        }
      }
    }
  }
  const found = [...(uploadIndex.get(urlPath) || [])];
  for (const spec of UPLOAD_KINDS) if (isRepositoryBacked(spec)) found.push(...await repositoryOwners(spec, urlPath));
  return found;
}
/** Every record that may link an upload (organization + record), for the one-time ownership backfill. */
export async function* uploadBackfillRecords(): AsyncGenerator<{ organizationId: string; record: any }> {
  for (const spec of UPLOAD_KINDS) {
    if (isRepositoryBacked(spec)) {
      for await (const batch of createEntityRepository(sql, spec.table).batches()) for (const record of batch) yield { organizationId: record.organizationId, record };
    } else {
      for (const record of db[spec.collection] || []) yield { organizationId: record.organizationId, record };
    }
  }
}
export async function authorizeUpload(req: express.Request, res: express.Response, next: express.NextFunction) {
  let identity;
  try {
    identity = await resolveIdentity(sql, req);
  } catch (err: any) {
    if (err instanceof RequestDenied) return sendError(req, res, err.status, err.error);
    throw err;
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox");
  res.setHeader("Cache-Control", "private, no-store");
  const key = normalizeUploadPath(`/uploads${req.path}`);
  if (!key) return res.status(400).end();
  // The object served is the one whose key passed the checks below, never re-derived from the request.
  res.locals.uploadKey = key.slice("/uploads/".length);
  const scopes = new Map<string, any>();
  for (const { kind, record } of await eligibleOwners(sql, key.slice("/uploads/".length), await uploadOwners(key))) {
    if (!record?.organizationId) continue;
    let ctx: OrgContext;
    try {
      ctx = await resolveOrganizationContext(sql, identity, record.organizationId);
    } catch {
      continue;
    }
    if (!can(ctx, "document.view")) continue;
    if (!scopes.has(ctx.organizationId)) scopes.set(ctx.organizationId, createOrganizationScope(await teamsOf(sql, ctx.organizationId), ctx.organizationId, await scopeCollections(ctx)));
    if (recordVisible(ctx, scopes.get(ctx.organizationId), kind, record)) {
      if (req.method === "GET") {
        await addActivityLog(identity.email, identity.name, ctx.tenantRole || "User", "FILE_DOWNLOAD", "UPLOADS", `Opened file '${path.basename(key)}'`, undefined, ctx.organizationId, { key: key.slice("/uploads/".length), kind })
          .catch((err) => log.warn("Could not record file access:", err));
      }
      return next();
    }
  }
  return res.status(404).end();
}
export async function serveUpload(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const key: string = res.locals.uploadKey;
  const object = await getStore().get(key);
  if (!object) return res.status(404).end();
  // By extension, like the static file server this replaces; a stored content type is client-supplied.
  res.type(path.extname(key) || "application/octet-stream").send(object.body);
}
/** Stores an upload and returns its `/uploads/...` link. Throws rather than return a link to a file that was not stored. */
export async function saveUpload(
  _partnerName: any,
  category: string,
  safeFileName: string,
  base64Data: string,
  organizationId: string | null | undefined,
) {
  // Keys carry the organization id and a random segment, never organization or vendor names (names can collide across tenants).
  if (!organizationId) throw new ApiError(400, "ORGANIZATION_REQUIRED", "An upload needs an owning organization.");
  const link = `/uploads/${newUploadKey(organizationId, category, safeFileName).split("/").map(encodeURIComponent).join("/")}`;
  // The key is derived from the link so /uploads can always find what was stored.
  const key = keyFromLink(link);
  if (!key) throw new ApiError(400, "INVALID_FILE_NAME", "This file name cannot be stored.");
  const cleanContent = base64Data.includes("base64,")
    ? base64Data.split("base64,")[1]
    : base64Data;
  await getStore().put(key, Buffer.from(cleanContent, "base64"));
  await recordUploadOwner(sql, key, organizationId);
  for (const listener of uploadStoredListeners) listener(key);
  return link;
}
export function getMimeType(fileName) {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "docx")
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === "xlsx")
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === "csv") return "text/csv";
  return "application/pdf";
}
