import express from 'express';
import path from 'path';
import { CosConfig, ObjectStore, cosStore, memoryStore, keyFromLink } from './objectStore';
import { googleCredentials } from './googleCredentialStore';
import { IS_TEST_MODE } from './runtimePaths';
import { ApiError } from './organizationSettingsStore';
import { RecordKind, createOrganizationScope, teamsOf, recordVisible } from './recordScope';
import { contractRepository } from './repositories/contractRepository';
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
/** Collections of the in-memory projection that can own an upload (contracts are looked up in their repository on demand). */
export const UPLOAD_KINDS: Array<[RecordKind, string]> = [
  ["partner", "partners"], ["io", "ios"], ["spending", "spendings"], ["evaluation", "evaluations"],
];
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
/** Contracts whose stored JSON links this upload; found by the file name first (cheap filter), then confirmed exactly. */
async function contractOwners(urlPath: string) {
  const name = urlPath.split("/").pop() || "";
  if (!name) return [];
  const variants = [...new Set([name, encodeURI(name), encodeURIComponent(name)])].map((v) => `%${likeEscape(v)}%`);
  const records = await contractRepository.hydrate(await sql.all(
    `SELECT * FROM contracts WHERE contract_file_link LIKE ANY(?) OR termination_document LIKE ANY(?) OR extra_json LIKE ANY(?)`, variants, variants, variants));
  return records
    .filter((record: any) => (JSON.stringify(record).match(/\/uploads\/[^"\\]+/g) || []).some((url) => normalizeUploadPath(url) === urlPath))
    .map((record: any) => ({ kind: "contract" as RecordKind, record }));
}
export async function uploadOwners(urlPath: string) {
  if (!uploadIndex) {
    uploadIndex = new Map();
    for (const [kind, collection] of UPLOAD_KINDS) {
      for (const record of db[collection] || []) {
        const urls = JSON.stringify(record).match(/\/uploads\/[^"\\]+/g) || [];
        for (const url of urls) {
          const key = normalizeUploadPath(url);
          if (!key) continue;
          const owners = uploadIndex.get(key) || [];
          owners.push({ kind, record });
          uploadIndex.set(key, owners);
        }
      }
    }
  }
  return [...(uploadIndex.get(urlPath) || []), ...(await contractOwners(urlPath))];
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
