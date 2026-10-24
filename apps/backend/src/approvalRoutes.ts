import express from "express";
import crypto from "crypto";
import type { Sql } from "./db";
import { forwardAsyncRouteErrors } from "./asyncRoutes";
import {
  APPROVAL_CATEGORIES,
  APPROVAL_FILE_TYPES,
  APPROVAL_MAX_FILE_BYTES,
  type ApprovalStats,
} from "@legalio/types/approvals";
import type { OrgContext } from "./rbac";
import { requestIdOf } from "./identity";
import { appendAudit } from "./organizationSettingsStore";
import { emitWebhookEvent } from "./webhooks";
import { announceApprovalNotices, enqueueNotice, getApprovalSettings } from "./approvalNotifications";

// The SLA is a per-organization setting (approval_settings, default 48 h); a request keeps the deadline it was created with.
const NEAR_SLA_MS = 6 * 60 * 60 * 1000;
const MAX_APPROVERS = 10;
const MAX_TEXT = 2000;

/**
 * My Approval owns `pending_review` and `approved`: returns why a manual document status change
 * (or a delete, when `next` is null) is refused, or null when it is allowed.
 */
export async function approvalStatusLock(db: Sql, documentId: string, current: string, next: string | null): Promise<string | null> {
  const pending = await db.get(`SELECT 1 FROM approval_requests WHERE document_id = ? AND status = 'pending'`, documentId);
  if (pending) return "This document is in an approval flow; it changes only through My Approval.";
  if (next === null || next === current) return null;
  if (next === "pending_review" || next === "approved") return "Submit the document in My Approval to change it to this status.";
  if (current === "approved" && next === "draft") return "An approved document can only be archived.";
  return null;
}

export interface ApprovalRouterOptions {
  db: Sql;
  /** Organization of the verified request context; never widened by client input. */
  tenantOf: (req: express.Request) => string;
}

interface RequestRow {
  id: string;
  organization_id: string;
  status: string;
  current_step: number;
  created_by: string;
  document_id: string | null;
}

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const nameOf = (column: string) => `(SELECT u.name FROM "user" u WHERE u.id = ${column})`;

/** A My Documents attachment stays live: its type and name always come from the document, never a copy. */
const FROM_REQUESTS = `approval_requests r LEFT JOIN contract_documents d ON d.id = r.document_id`;
const CATEGORY = `COALESCE(d.type, r.category)`;
const FILE_NAME = `COALESCE(d.name, r.file_name)`;

const SUMMARY_COLUMNS = `
  r.id, r.code, r.title, ${CATEGORY} AS category, r.status, r.current_step, ${FILE_NAME} AS file_name, r.created_by, r.created_at, r.due_at, r.decided_at,
  ${nameOf("r.created_by")} AS created_by_name,
  (SELECT COUNT(*) FROM approval_steps s WHERE s.request_id = r.id) AS step_count`;

const bad = (res: express.Response, message: string) => res.status(400).json({ error: "INVALID_INPUT", message });

export function createApprovalRouter({ db, tenantOf }: ApprovalRouterOptions) {
  const router = express.Router();
  forwardAsyncRouteErrors(router);
  const ctxOf = (req: express.Request) => (req as unknown as { orgContext?: OrgContext }).orgContext ?? null;

  router.use("/approvals", (req, res, next) => {
    if (!ctxOf(req)) return res.status(401).json({ error: "UNAUTHENTICATED", message: "Authentication is required." });
    next();
  });

  const audit = (req: express.Request, ctx: OrgContext, action: string, targetId: string) =>
    appendAudit(
      db,
      { actorId: ctx.userId, actorPlatformRole: ctx.platformRole, accessMode: ctx.accessMode, requestId: requestIdOf(req) },
      { organizationId: ctx.organizationId, action, targetType: "approval", targetId, outcome: "success" },
    );

  // Viewers cannot open My Approval, so they cannot be approvers either.
  const activeMembers = async (org: string) =>
    await db.all(`
      SELECT u.id, u.name, m.role FROM member m JOIN "user" u ON u.id = m."userId"
      WHERE m."organizationId" = ? AND m.status = 'active' AND m.role <> 'viewer' ORDER BY lower(u.name)
    `, org) as Array<{ id: string; name: string; role: string }>;

  const isApprover = async (requestId: string, userId: string) =>
    Boolean(await db.get(`SELECT 1 FROM approval_steps WHERE request_id = ? AND approver_id = ?`, requestId, userId));

  /** Requester, any approver in the chain, or a tenant auditor; everyone else gets 404. */
  const withRequest =
    (handler: (req: express.Request, res: express.Response, row: RequestRow, ctx: OrgContext) => unknown) =>
    async (req: express.Request, res: express.Response) => {
      const ctx = ctxOf(req)!;
      const row = await db.get(`SELECT id, organization_id, status, current_step, created_by, document_id FROM approval_requests WHERE id = ? AND organization_id = ?`, req.params.id, tenantOf(req)) as RequestRow | undefined;
      const visible =
        row && (row.created_by === ctx.userId || ctx.permissions.includes("tenant.audit.read") || await isApprover(row.id, ctx.userId));
      if (!row || !visible) return res.status(404).json({ error: "Approval not found." });
      return handler(req, res, row, ctx);
    };

  router.get("/approvals/approvers", async (req, res) => {
    res.json({ approvers: await activeMembers(tenantOf(req)) });
  });

  router.get("/approvals", async (req, res) => {
    const ctx = ctxOf(req)!;
    const params: Record<string, string> = { org: tenantOf(req), me: ctx.userId };
    const where = ["r.organization_id = @org"];
    const inbox = `r.status = 'pending' AND EXISTS (
      SELECT 1 FROM approval_steps s WHERE s.request_id = r.id AND s.step_no = r.current_step AND s.approver_id = @me)`;
    const involved = `(r.created_by = @me OR EXISTS (SELECT 1 FROM approval_steps s WHERE s.request_id = r.id AND s.approver_id = @me))`;

    const box = str(req.query.box) || "all";
    if (box === "inbox") where.push(inbox);
    else if (box === "mine") where.push("r.created_by = @me");
    // "all" = everything I submitted or sit in the chain of, received and sent together.
    else where.push(involved);

    const search = str(req.query.search);
    if (search) {
      where.push(`(r.title ILIKE @search OR r.code ILIKE @search OR ${FILE_NAME} ILIKE @search OR ${nameOf("r.created_by")} ILIKE @search)`);
      params.search = `%${search}%`;
    }
    const category = str(req.query.category);
    if (category && category !== "all") {
      where.push(`${CATEGORY} = @category`);
      params.category = category;
    }
    const items = await db.all(`SELECT ${SUMMARY_COLUMNS} FROM ${FROM_REQUESTS} WHERE ${where.join(" AND ")} ORDER BY r.status = 'pending' DESC, r.due_at ASC LIMIT 200`, params);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const counts = await db.get(`SELECT COUNT(*) AS waiting, COUNT(*) FILTER (WHERE r.due_at <= @soon) AS near FROM approval_requests r WHERE r.organization_id = @org AND ${inbox}`, { org: params.org, me: params.me, soon: new Date(now.getTime() + NEAR_SLA_MS).toISOString() }) as { waiting: number; near: number };
    const done = await db.get(`
        SELECT COUNT(*) AS n FROM approval_steps s JOIN approval_requests r ON r.id = s.request_id
        WHERE r.organization_id = ? AND s.approver_id = ? AND s.decided_at >= ?
      `, params.org, params.me, monthStart) as { n: number };
    const stats: ApprovalStats = { waiting: counts.waiting, near_sla: counts.near, done_this_month: done.n };
    res.json({ items, stats });
  });

  router.post("/approvals", async (req, res) => {
    const ctx = ctxOf(req)!;
    const org = tenantOf(req);
    const body = req.body || {};
    const title = str(body.title).slice(0, 200);
    let category = str(body.category);
    const note = str(body.note).slice(0, MAX_TEXT);
    if (!title) return bad(res, "Title is required.");

    const approverIds: string[] = Array.isArray(body.approverIds) ? body.approverIds.map(str) : [];
    const members = new Set((await activeMembers(org)).map((m) => m.id));
    if (approverIds.length === 0 || approverIds.length > MAX_APPROVERS) return bad(res, `Choose 1 to ${MAX_APPROVERS} approvers.`);
    if (new Set(approverIds).size !== approverIds.length) return bad(res, "An approver can appear only once.");
    if (approverIds.includes(ctx.userId)) return bad(res, "You cannot approve your own request.");
    if (!approverIds.every((id) => members.has(id))) return bad(res, "Every approver must be an active member of this organization with editor access or higher.");

    const documentId = str(body.documentId);
    const file = body.file && typeof body.file === "object" ? body.file : null;
    if (Boolean(documentId) === Boolean(file)) return bad(res, "Attach exactly one document or file.");
    if (!documentId && !(APPROVAL_CATEGORIES as readonly string[]).includes(category)) return bad(res, "Unknown document type.");

    let source: "document" | "upload";
    let fileName: string;
    let fileMime = "";
    let fileSize = 0;
    let fileData: Buffer | null = null;
    if (documentId) {
      const doc = await db.get(`SELECT name, type, file_size, status FROM contract_documents WHERE id = ? AND organization_id = ?`, documentId, org) as { name: string; type: string; file_size: number; status: string } | undefined;
      if (!doc || doc.status === "archived") return bad(res, "Document not found.");
      source = "document";
      category = doc.type;
      fileName = doc.name;
      fileSize = doc.file_size;
    } else {
      fileName = str(file.name).replace(/[/\\\0]/g, "_").slice(0, 200);
      fileMime = APPROVAL_FILE_TYPES[fileName.split(".").pop()?.toLowerCase() || ""] || "";
      if (!fileName || !fileMime) return bad(res, "Only PDF, DOCX or XLSX files are allowed.");
      const base64 = str(file.base64).replace(/^data:[^,]*,/, "");
      fileData = Buffer.from(base64, "base64");
      if (fileData.length === 0) return bad(res, "The file is empty.");
      if (fileData.length > APPROVAL_MAX_FILE_BYTES) return bad(res, "The file is larger than 10 MB.");
      source = "upload";
      fileSize = fileData.length;
    }

    const id = newId("apr");
    const now = new Date();
    const at = now.toISOString();
    const refused = await db.tx(async () => {
      if (documentId) {
        // Row lock first: a concurrent submit or delete of this document waits, then the checks below see its commit.
        await db.run(`UPDATE contract_documents SET id = id WHERE id = ?`, documentId);
        const doc = await db.get(`SELECT status FROM contract_documents WHERE id = ? AND organization_id = ?`, documentId, org) as { status: string } | undefined;
        if (!doc || doc.status === "archived") return "DOCUMENT_NOT_FOUND";
        if (await db.get(`SELECT 1 FROM approval_requests WHERE document_id = ? AND status = 'pending'`, documentId)) return "APPROVAL_PENDING";
      }
      // Serializes code allocation per organization; without it two submits read the same MAX.
      await db.get(`SELECT pg_advisory_xact_lock(hashtext('approval:' || ?))`, org);
      const year = now.getFullYear();
      // MAX, not COUNT: deleting an earlier request must not make the next code repeat.
      const { n } = await db.get(`SELECT COALESCE(MAX(CAST(substr(code, 9) AS INTEGER)), 0) AS n FROM approval_requests WHERE organization_id = ? AND code LIKE ?`, org, `OA-${year}-%`) as { n: number };
      const code = `OA-${year}-${String(n + 1).padStart(5, "0")}`;
      const slaMs = (await getApprovalSettings(db, org)).slaHours * 60 * 60 * 1000;
      await db.run(`
        INSERT INTO approval_requests (id, organization_id, code, title, category, note, source, document_id, file_name, file_mime, file_size, file_data, created_by, created_at, due_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, id, org, code, title, category, note, source, documentId || null, fileName, fileMime, fileSize, fileData, ctx.userId, at, new Date(now.getTime() + slaMs).toISOString());
      for (const [i, approverId] of approverIds.entries()) await db.run(`INSERT INTO approval_steps (id, request_id, step_no, approver_id) VALUES (?, ?, ?, ?)`, newId("aps"), id, i + 1, approverId);
      await db.run(`INSERT INTO approval_events (id, request_id, actor_id, kind, message, created_at) VALUES (?, ?, ?, 'submitted', ?, ?)`, newId("ape"), id, ctx.userId, note, at);
      if (documentId) await db.run(`UPDATE contract_documents SET status = 'pending_review' WHERE id = ?`, documentId);
      await audit(req, ctx, "approval.submit", id);
      await emitWebhookEvent(db, org, "approval.requested", {
        approvalId: id, code, title, category, requesterId: ctx.userId, approverIds, currentStep: 1, dueAt: new Date(now.getTime() + slaMs).toISOString(), documentId: documentId || null,
      });
      await enqueueNotice(db, { organizationId: org, requestId: id, stepNo: 1, kind: "requested", recipientId: approverIds[0], payload: { code, title, category, requesterId: ctx.userId, dueAt: new Date(now.getTime() + slaMs).toISOString(), stepNo: 1, stepCount: approverIds.length } });
      return null;
    });
    if (refused === "DOCUMENT_NOT_FOUND") return bad(res, "Document not found.");
    if (refused) return res.status(409).json({ error: refused, message: "This document is already in an approval flow." });
    announceApprovalNotices();
    res.status(201).json({ id });
  });

  router.get("/approvals/:id", withRequest(async (_req, res, row) => {
    const detail = await db.get(`SELECT ${SUMMARY_COLUMNS}, r.note, r.source, r.document_id, r.file_mime, COALESCE(d.file_size, r.file_size) AS file_size FROM ${FROM_REQUESTS} WHERE r.id = ?`, row.id);
    const steps = await db.all(`
      SELECT s.step_no, s.approver_id, s.status, s.comment, s.decided_at, ${nameOf("s.approver_id")} AS approver_name,
        (SELECT m.role FROM member m WHERE m."userId" = s.approver_id AND m."organizationId" = @org) AS approver_role
      FROM approval_steps s WHERE s.request_id = @id ORDER BY s.step_no
    `, { id: row.id, org: row.organization_id });
    const events = await db.all(`
      SELECT e.id, e.actor_id, e.kind, e.message, e.created_at, ${nameOf("e.actor_id")} AS actor_name
      FROM approval_events e WHERE e.request_id = ? ORDER BY e.created_at, e.seq
    `, row.id);
    res.json({ ...(detail as object), steps, events });
  }));

  router.get("/approvals/:id/file", withRequest(async (_req, res, row) => {
    const file = await db.get(`SELECT file_name, file_mime, file_data FROM approval_requests WHERE id = ?`, row.id) as
      | { file_name: string; file_mime: string; file_data: Buffer | null }
      | undefined;
    if (!file?.file_data) return res.status(404).json({ error: "This approval has no uploaded file." });
    res.setHeader("Content-Type", file.file_mime);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox");
    res.setHeader("Cache-Control", "private, no-store");
    res.end(file.file_data);
  }));

  router.post("/approvals/:id/decision", withRequest(async (req, res, row, ctx) => {
    const decision = str(req.body?.decision);
    const comment = str(req.body?.comment).slice(0, MAX_TEXT);
    if (decision !== "approve" && decision !== "reject") return bad(res, "Decision must be approve or reject.");
    if (decision === "reject" && !comment) return bad(res, "Add a comment explaining the rejection.");
    const step = await db.get(`SELECT id, approver_id FROM approval_steps WHERE request_id = ? AND step_no = ?`, row.id, row.current_step) as { id: string; approver_id: string } | undefined;
    if (row.status !== "pending" || step?.approver_id !== ctx.userId) {
      return res.status(403).json({ error: "NOT_CURRENT_APPROVER", message: "This approval is not waiting for you." });
    }

    const at = new Date().toISOString();
    const stepStatus = decision === "approve" ? "approved" : "rejected";
    const decided = await db.tx(async () => {
      const { total } = await db.get(`SELECT COUNT(*) AS total FROM approval_steps WHERE request_id = ?`, row.id) as { total: number };
      const finished = decision === "reject" || row.current_step >= total;
      // Guarded on the step checked above: a concurrent decision that already moved the request on matches nothing.
      const { changes } = finished
        ? await db.run(`UPDATE approval_requests SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending' AND current_step = ?`, stepStatus, at, row.id, row.current_step)
        : await db.run(`UPDATE approval_requests SET current_step = current_step + 1 WHERE id = ? AND status = 'pending' AND current_step = ?`, row.id, row.current_step);
      if (changes !== 1) return false;
      await db.run(`UPDATE approval_steps SET status = ?, comment = ?, decided_at = ? WHERE id = ?`, stepStatus, comment, at, step.id);
      await db.run(`INSERT INTO approval_events (id, request_id, actor_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?, ?)`, newId("ape"), row.id, ctx.userId, stepStatus, comment, at);
      if (finished && row.document_id) {
        await db.run(`UPDATE contract_documents SET status = ? WHERE id = ?`, decision === "approve" ? "approved" : "draft", row.document_id);
      }
      await audit(req, ctx, `approval.${decision}`, row.id);
      const summary = await db.get(`SELECT code, title FROM approval_requests WHERE id = ?`, row.id) as { code: string; title: string };
      const next = finished ? null : await db.get(`SELECT approver_id FROM approval_steps WHERE request_id = ? AND step_no = ?`, row.id, row.current_step + 1) as { approver_id: string } | undefined;
      await emitWebhookEvent(db, row.organization_id, "approval.decided", {
        approvalId: row.id, code: summary.code, title: summary.title, decision: stepStatus, stepNo: row.current_step, approverId: ctx.userId, comment: comment.slice(0, 500),
        requestStatus: finished ? stepStatus : "pending", finished, nextApproverId: next?.approver_id ?? null, documentId: row.document_id,
      });
      const detail = await db.get(`SELECT due_at FROM approval_requests WHERE id = ?`, row.id) as { due_at: string };
      const notice = { code: summary.code, title: summary.title, requesterId: row.created_by, approverId: ctx.userId, dueAt: detail.due_at, stepNo: row.current_step, stepCount: total };
      // The requester hears every decision; the next approver is asked when the chain moves on.
      await enqueueNotice(db, { organizationId: row.organization_id, requestId: row.id, stepNo: row.current_step, kind: "decided", recipientId: row.created_by, payload: { ...notice, decision: stepStatus, comment: comment.slice(0, 500), finished } });
      if (next) await enqueueNotice(db, { organizationId: row.organization_id, requestId: row.id, stepNo: row.current_step + 1, kind: "requested", recipientId: next.approver_id, payload: { ...notice, stepNo: row.current_step + 1 } });
      return true;
    });
    if (!decided) return res.status(409).json({ error: "NOT_CURRENT_APPROVER", message: "This approval is no longer waiting for you." });
    announceApprovalNotices();
    res.json({ ok: true });
  }));

  router.delete("/approvals/:id", withRequest(async (req, res, row, ctx) => {
    if (row.created_by !== ctx.userId) {
      return res.status(403).json({ error: "NOT_REQUESTER", message: "Only the requester can delete this approval." });
    }
    const deleted = await db.tx(async () => {
      // Parent first and guarded: a decision committed since the check above keeps the request. No FKs, so order is free.
      if ((await db.run(`DELETE FROM approval_requests WHERE id = ? AND status = 'pending'`, row.id)).changes !== 1) return false;
      for (const table of ["approval_steps", "approval_events"]) await db.run(`DELETE FROM ${table} WHERE request_id = ?`, row.id);
      // A withdrawn review must not leave the document stuck in pending_review.
      if (row.document_id) {
        await db.run(`UPDATE contract_documents SET status = 'draft' WHERE id = ? AND status = 'pending_review'`, row.document_id);
      }
      await audit(req, ctx, "approval.delete", row.id);
      return true;
    });
    if (!deleted) return res.status(409).json({ error: "APPROVAL_FINISHED", message: "A decided approval is part of the record and cannot be deleted." });
    res.json({ ok: true });
  }));

  return router;
}
