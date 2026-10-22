import express from "express";
import crypto from "crypto";
import type { Sql } from "./db";
import { forwardAsyncRouteErrors } from "./asyncRoutes";
import {
  DOCUMENT_SORT_KEYS,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  METADATA_FIELD_TYPES,
  PAGE_SIZES,
  isOneOf,
  type CommentAction,
  type DocumentSortKey,
} from "@legalio/types/documents";
import { approvalStatusLock } from "./approvalRoutes";
import { sanitizePageLayout } from "@legalio/shared/pageLayout";

// ponytail: unnamed, unlabeled versions beyond this are pruned; named/labeled ones are kept forever.
const MAX_UNNAMED_VERSIONS = 50;
// Autosaves by the same user within this window update the latest autosave version in place,
// so a long editing session yields a readable history instead of one version per 30s tick.
const AUTOSAVE_COALESCE_MS = 10 * 60 * 1000;
const MAX_TEXT = 5000;

/**
 * Document tables live beside (not inside) the core `contracts` table: that one holds
 * repository records and is rewritten wholesale by syncDbToSqlite on every save.
 * Foreign keys are not enforced by this database, so deletes cascade by hand below.
 */
/** Stored page setup: validated, null when the request carries none. */
const pageLayoutJson = (value: unknown) => (value === undefined || value === null ? null : JSON.stringify(sanitizePageLayout(value)));

export async function ensureDocumentSchema(db: Sql) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS contract_documents (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'contract',
      status TEXT NOT NULL DEFAULT 'draft',
      content TEXT NOT NULL DEFAULT '',
      current_version INTEGER NOT NULL DEFAULT 1,
      file_size INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      modified_by TEXT,
      modified_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_contract_documents_org_status ON contract_documents (organization_id, status);
    CREATE INDEX IF NOT EXISTS idx_contract_documents_org_modified ON contract_documents (organization_id, modified_at DESC);
    CREATE INDEX IF NOT EXISTS idx_contract_documents_org_created ON contract_documents (organization_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_contract_documents_org_creator ON contract_documents (organization_id, created_by);

    CREATE TABLE IF NOT EXISTS contract_drafts (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      save_kind TEXT NOT NULL DEFAULT 'manual',
      restored_from INTEGER,
      draft_name TEXT,
      labels TEXT NOT NULL DEFAULT '[]',
      saved_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      saved_at TEXT NOT NULL,
      UNIQUE (contract_id, version_number)
    );

    CREATE TABLE IF NOT EXISTS metadata_fields (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      field_type TEXT NOT NULL,
      options TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_metadata_fields_org ON metadata_fields (organization_id);

    CREATE TABLE IF NOT EXISTS document_metadata (
      contract_id TEXT NOT NULL,
      field_id TEXT NOT NULL,
      field_value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (contract_id, field_id)
    );
    CREATE INDEX IF NOT EXISTS idx_document_metadata_field ON document_metadata (field_id);

    CREATE TABLE IF NOT EXISTS contract_comments (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL,
      parent_id TEXT,
      comment_type TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      quote TEXT NOT NULL DEFAULT '',
      new_text TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      author_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_by TEXT,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_contract_comments_contract ON contract_comments (contract_id, status);
  `);
  // Page setup (paper, margins, header, footer) as JSON; null means the defaults.
  if (!(await db.all('PRAGMA table_info(contract_documents)') as { name: string }[]).some((column) => column.name === 'page_layout')) {
    await db.exec('ALTER TABLE contract_documents ADD COLUMN page_layout TEXT');
  }
}

interface Actor {
  id: string;
  role: string;
  /** Effective permissions of the verified organization context. */
  permissions: string[];
}

interface DocumentRow {
  id: string;
  organization_id: string;
  name: string;
  status: string;
}

interface DraftRow {
  version_number: number;
  content: string;
  content_hash: string;
  save_kind: string;
  saved_by: string;
  draft_name: string | null;
  labels: string;
  created_at: string;
}

interface CommentRow {
  id: string;
  parent_id: string | null;
  comment_type: string;
  status: string;
}

export interface DocumentRouterOptions {
  db: Sql;
  /** Organization of the verified request context; never widened by client input. */
  tenantOf: (req: express.Request) => string;
}

const SORT_SQL: Record<DocumentSortKey, string> = {
  name: "d.name COLLATE NOCASE",
  type: "d.type",
  status: "d.status",
  created_at: "d.created_at",
  modified_at: "d.modified_at",
  created_by: "created_by_name COLLATE NOCASE",
  file_size: "d.file_size",
};

const nameOf = (column: string) => `(SELECT u.name FROM "user" u WHERE u.id = ${column})`;
const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const byteSize = (text: string) => Buffer.byteLength(text, "utf8");
const sha256 = (text: string) => crypto.createHash("sha256").update(text).digest("hex");
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const cleanName = (value: unknown) => str(value).slice(0, 200);

export function createDocumentRouter({ db, tenantOf }: DocumentRouterOptions) {
  const router = express.Router();
  forwardAsyncRouteErrors(router);
  const actorOf = (req: express.Request) => (req as unknown as { actor?: Actor | null }).actor ?? null;

  router.use(["/documents", "/metadata-fields"], (req, res, next) => {
    if (!actorOf(req)) return res.status(401).json({ error: "UNAUTHENTICATED", message: "Authentication is required." });
    next();
  });

  const documentDetail = async (id: string) =>
    await db.get(`
      SELECT d.*, ${nameOf("d.created_by")} AS created_by_name, ${nameOf("d.modified_by")} AS modified_by_name,
        (SELECT COUNT(*) FROM contract_drafts v WHERE v.contract_id = d.id) AS draft_count
      FROM contract_documents d WHERE d.id = ?
    `, id);

  /** Looks the document up inside the caller's tenant; other tenants' documents answer 404. */
  const withDocument =
    (handler: (req: express.Request, res: express.Response, doc: DocumentRow, actor: Actor) => unknown) =>
    async (req: express.Request, res: express.Response) => {
      const doc = await db.get(`SELECT id, organization_id, name, status FROM contract_documents WHERE id = ? AND organization_id = ?`, req.params.id, tenantOf(req)) as DocumentRow | undefined;
      if (!doc) return res.status(404).json({ error: "Document not found." });
      return handler(req, res, doc, actorOf(req)!);
    };

  const latestDraft = async (contractId: string) =>
    await db.get(`SELECT * FROM contract_drafts WHERE contract_id = ? ORDER BY version_number DESC LIMIT 1`, contractId) as
      | DraftRow
      | undefined;

  const insertDraft = async (
    contractId: string,
    version: number,
    content: string,
    actorId: string,
    kind: string,
    at: string,
    restoredFrom: number | null = null,
  ) => {
    await db.run(`
      INSERT INTO contract_drafts (id, contract_id, version_number, content, content_hash, file_size, save_kind, restored_from, saved_by, created_at, saved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, newId("ver"), contractId, version, content, sha256(content), byteSize(content), kind, restoredFrom, actorId, at, at);
  };

  const setCurrentContent = async (contractId: string, content: string, version: number, actorId: string, at: string) => {
    await db.run(`
      UPDATE contract_documents SET content = ?, file_size = ?, current_version = ?, modified_by = ?, modified_at = ? WHERE id = ?
    `, content, byteSize(content), version, actorId, at, contractId);
  };

  const pruneDrafts = async (contractId: string) => {
    await db.run(`
      DELETE FROM contract_drafts
      WHERE contract_id = @id AND draft_name IS NULL AND labels = '[]'
        AND version_number NOT IN (
          SELECT version_number FROM contract_drafts
          WHERE contract_id = @id AND draft_name IS NULL AND labels = '[]'
          ORDER BY version_number DESC LIMIT @keep
        )
    `, { id: contractId, keep: MAX_UNNAMED_VERSIONS });
  };

  /* ----------------------------- documents ----------------------------- */

  router.get("/documents", async (req, res) => {
    const org = tenantOf(req);
    const where = ["d.organization_id = @org"];
    const params: Record<string, string | number> = { org };

    const search = str(req.query.search);
    if (search) {
      where.push(`(d.name LIKE @search OR EXISTS (
        SELECT 1 FROM document_metadata m WHERE m.contract_id = d.id AND m.field_value LIKE @search))`);
      params.search = `%${search}%`;
    }
    const status = str(req.query.status);
    if (status === "") where.push(`d.status != 'archived'`);
    else if (status !== "all") {
      where.push("d.status = @status");
      params.status = status;
    }
    const type = str(req.query.type);
    if (type) {
      where.push("d.type = @type");
      params.type = type;
    }
    const createdBy = str(req.query.created_by);
    if (createdBy) {
      where.push("d.created_by = @createdBy");
      params.createdBy = createdBy;
    }
    const from = str(req.query.from);
    if (from) {
      where.push("substr(d.created_at, 1, 10) >= @from");
      params.from = from;
    }
    const to = str(req.query.to);
    if (to) {
      where.push("substr(d.created_at, 1, 10) <= @to");
      params.to = to;
    }
    const metaField = str(req.query.meta_field);
    const metaValue = str(req.query.meta_value);
    if (metaField && metaValue) {
      where.push(`EXISTS (SELECT 1 FROM document_metadata m
        WHERE m.contract_id = d.id AND m.field_id = @metaField AND m.field_value LIKE @metaValue)`);
      params.metaField = metaField;
      params.metaValue = `%${metaValue}%`;
    }

    const sortKey = isOneOf(DOCUMENT_SORT_KEYS, req.query.sort_by) ? req.query.sort_by : "modified_at";
    const direction = req.query.sort_dir === "asc" ? "ASC" : "DESC";
    const limit = isOneOf(PAGE_SIZES.map(String), String(req.query.limit)) ? Number(req.query.limit) : PAGE_SIZES[0];
    const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);
    const whereSql = where.join(" AND ");

    const { total } = await db.get(`SELECT COUNT(*) AS total FROM contract_documents d WHERE ${whereSql}`, params) as {
      total: number;
    };
    const documents = await db.all(`
      SELECT d.id, d.name, d.type, d.status, d.file_size, d.current_version, d.created_by, d.created_at,
        d.modified_by, d.modified_at, ${nameOf("d.created_by")} AS created_by_name, ${nameOf("d.modified_by")} AS modified_by_name
      FROM contract_documents d WHERE ${whereSql}
      ORDER BY ${SORT_SQL[sortKey]} ${direction}, d.id
      LIMIT @limit OFFSET @offset
    `, { ...params, limit, offset: (page - 1) * limit });
    const creators = await db.all(`SELECT DISTINCT d.created_by AS id, ${nameOf("d.created_by")} AS name FROM contract_documents d WHERE d.organization_id = ?`, org);

    res.json({ total, page, limit, documents, creators });
  });

  router.post("/documents", async (req, res) => {
    const actor = actorOf(req)!;
    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).json({ error: "Document name is required." });
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    const type = isOneOf(DOCUMENT_TYPES, req.body?.type) ? req.body.type : "contract";
    const id = newId("doc");
    const at = new Date().toISOString();
    await db.tx(async () => {
      await db.run(`
        INSERT INTO contract_documents (id, organization_id, name, type, status, content, current_version, file_size, created_by, created_at, modified_by, modified_at, page_layout)
        VALUES (?, ?, ?, ?, 'draft', ?, 1, ?, ?, ?, ?, ?, ?)
      `, id, tenantOf(req), name, type, content, byteSize(content), actor.id, at, actor.id, at, pageLayoutJson(req.body?.page_layout));
      await insertDraft(id, 1, content, actor.id, "manual", at);
    });
    res.status(201).json(await documentDetail(id));
  });

  router.get("/documents/:id", withDocument(async (_req, res, doc) => res.json(await documentDetail(doc.id))));

  router.patch(
    "/documents/:id",
    withDocument(async (req, res, doc, actor) => {
      const name = req.body?.name === undefined ? doc.name : cleanName(req.body.name);
      if (!name) return res.status(400).json({ error: "Document name is required." });
      const { status, type } = req.body ?? {};
      if (status !== undefined && !isOneOf(DOCUMENT_STATUSES, status)) return res.status(400).json({ error: "Invalid status." });
      if (type !== undefined && !isOneOf(DOCUMENT_TYPES, type)) return res.status(400).json({ error: "Invalid type." });
      const locked = status === undefined ? null : await approvalStatusLock(db, doc.id, doc.status, status);
      if (locked) return res.status(409).json({ error: "APPROVAL_OWNS_STATUS", message: locked });
      await db.run(`
        UPDATE contract_documents SET name = ?, status = COALESCE(?, status), type = COALESCE(?, type), page_layout = COALESCE(?, page_layout), modified_by = ?, modified_at = ?
        WHERE id = ?
      `, name, status ?? null, type ?? null, pageLayoutJson(req.body?.page_layout), actor.id, new Date().toISOString(), doc.id);
      res.json(await documentDetail(doc.id));
    }),
  );

  router.delete(
    "/documents/:id",
    withDocument(async (_req, res, doc) => {
      const locked = await approvalStatusLock(db, doc.id, doc.status, null);
      if (locked) return res.status(409).json({ error: "APPROVAL_OWNS_STATUS", message: locked });
      await db.tx(async () => {
        for (const table of ["contract_comments", "document_metadata", "contract_drafts"]) {
          await db.run(`DELETE FROM ${table} WHERE contract_id = ?`, doc.id);
        }
        await db.run(`DELETE FROM contract_documents WHERE id = ?`, doc.id);
      });
      res.json({ success: true });
    }),
  );

  /* ------------------------------- drafts ------------------------------ */

  router.get(
    "/documents/:id/drafts",
    withDocument(async (_req, res, doc) => {
      const rows = await db.all(`
        SELECT version_number, draft_name, labels, file_size, save_kind, restored_from, saved_by, saved_at,
          ${nameOf("saved_by")} AS saved_by_name
        FROM contract_drafts WHERE contract_id = ? ORDER BY version_number DESC
      `, doc.id) as Array<{ labels: string }>;
      res.json(rows.map((row) => ({ ...row, labels: JSON.parse(row.labels) })));
    }),
  );

  router.get(
    "/documents/:id/drafts/:version",
    withDocument(async (req, res, doc) => {
      const row = await db.get(`
        SELECT version_number, content, draft_name, labels, saved_by, saved_at, ${nameOf("saved_by")} AS saved_by_name
        FROM contract_drafts WHERE contract_id = ? AND version_number = ?
      `, doc.id, Number(req.params.version)) as { labels: string } | undefined;
      if (!row) return res.status(404).json({ error: "Version not found." });
      res.json({ ...row, labels: JSON.parse(row.labels) });
    }),
  );

  router.post(
    "/documents/:id/drafts",
    withDocument(async (req, res, doc, actor) => {
      const content = req.body?.content;
      if (typeof content !== "string") return res.status(400).json({ error: "Content is required." });
      const kind = req.body?.kind === "auto" ? "auto" : "manual";
      const name = cleanName(req.body?.name) || doc.name;
      const at = new Date().toISOString();
      const latest = await latestDraft(doc.id);
      const version = latest?.version_number ?? 0;

      if (latest && latest.content_hash === sha256(content)) {
        if (name !== doc.name) {
          await db.run(`UPDATE contract_documents SET name = ?, modified_by = ?, modified_at = ? WHERE id = ?`, name, actor.id, at, doc.id);
        }
        return res.json({ document: await documentDetail(doc.id), version, created: false });
      }

      const coalesce =
        latest &&
        kind === "auto" &&
        latest.save_kind === "auto" &&
        latest.saved_by === actor.id &&
        latest.draft_name === null &&
        latest.labels === "[]" &&
        Date.now() - Date.parse(latest.created_at) < AUTOSAVE_COALESCE_MS;
      const nextVersion = coalesce ? version : version + 1;

      await db.tx(async () => {
        if (coalesce) {
          await db.run(`
            UPDATE contract_drafts SET content = ?, content_hash = ?, file_size = ?, saved_at = ?
            WHERE contract_id = ? AND version_number = ?
          `, content, sha256(content), byteSize(content), at, doc.id, version);
        } else {
          await insertDraft(doc.id, nextVersion, content, actor.id, kind, at);
        }
        await setCurrentContent(doc.id, content, nextVersion, actor.id, at);
        await db.run(`UPDATE contract_documents SET name = ? WHERE id = ?`, name, doc.id);
        await pruneDrafts(doc.id);
      });
      res.json({ document: await documentDetail(doc.id), version: nextVersion, created: !coalesce });
    }),
  );

  router.patch(
    "/documents/:id/drafts/:version",
    withDocument(async (req, res, doc) => {
      const version = Number(req.params.version);
      const exists = await db.get(`SELECT 1 FROM contract_drafts WHERE contract_id = ? AND version_number = ?`, doc.id, version);
      if (!exists) return res.status(404).json({ error: "Version not found." });
      const draftName = str(req.body?.draft_name).slice(0, 100) || null;
      const rawLabels: unknown[] = Array.isArray(req.body?.labels) ? req.body.labels : [];
      const labels = Array.from(new Set(rawLabels.map((l) => str(l).slice(0, 40)).filter(Boolean))).slice(0, 10);
      await db.run(`UPDATE contract_drafts SET draft_name = ?, labels = ? WHERE contract_id = ? AND version_number = ?`, draftName, JSON.stringify(labels), doc.id, version);
      res.json({ success: true });
    }),
  );

  router.post(
    "/documents/:id/drafts/:version/restore",
    withDocument(async (req, res, doc, actor) => {
      const source = await db.get(`SELECT version_number, content, content_hash FROM contract_drafts WHERE contract_id = ? AND version_number = ?`, doc.id, Number(req.params.version)) as Pick<DraftRow, "version_number" | "content" | "content_hash"> | undefined;
      if (!source) return res.status(404).json({ error: "Version not found." });
      const latest = (await latestDraft(doc.id))!;
      if (latest.content_hash === source.content_hash) {
        return res.json({ document: await documentDetail(doc.id), version: latest.version_number, created: false });
      }
      const at = new Date().toISOString();
      const nextVersion = latest.version_number + 1;
      await db.tx(async () => {
        await insertDraft(doc.id, nextVersion, source.content, actor.id, "restore", at, source.version_number);
        await setCurrentContent(doc.id, source.content, nextVersion, actor.id, at);
        await pruneDrafts(doc.id);
      });
      res.json({ document: await documentDetail(doc.id), version: nextVersion, created: true });
    }),
  );

  /* ------------------------------ metadata ----------------------------- */

  const listFields = async (org: string) =>
    (await db.all(`SELECT id, name, field_type, options FROM metadata_fields WHERE organization_id = ? ORDER BY created_at, id`, org) as Array<{
      id: string;
      name: string;
      field_type: string;
      options: string;
    }>).map((f) => ({ ...f, options: JSON.parse(f.options) as string[] }));

  const requireFieldAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (actorOf(req)?.permissions?.includes("tenant.settings.update")) return next();
    res.status(403).json({ error: "INSUFFICIENT_PERMISSION", message: "Only administrators can manage metadata fields." });
  };

  router.get("/metadata-fields", async (req, res) => res.json(await listFields(tenantOf(req))));

  router.post("/metadata-fields", requireFieldAdmin, async (req, res) => {
    const name = str(req.body?.name).slice(0, 80);
    const fieldType = req.body?.field_type;
    if (!name) return res.status(400).json({ error: "Field name is required." });
    if (!isOneOf(METADATA_FIELD_TYPES, fieldType)) return res.status(400).json({ error: "Invalid field type." });
    const rawOptions: unknown[] = Array.isArray(req.body?.options) ? req.body.options : [];
    const options = Array.from(new Set(rawOptions.map((o) => str(o).slice(0, 80)).filter(Boolean))).slice(0, 50);
    const needsOptions = fieldType === "select" || fieldType === "multi_select";
    if (needsOptions && options.length === 0) return res.status(400).json({ error: "Select fields need at least one option." });
    const id = newId("fld");
    await db.run(`INSERT INTO metadata_fields (id, organization_id, name, field_type, options, created_at) VALUES (?, ?, ?, ?, ?, ?)`, id, tenantOf(req), name, fieldType, JSON.stringify(needsOptions ? options : []), new Date().toISOString());
    res.status(201).json((await listFields(tenantOf(req))).find((f) => f.id === id));
  });

  router.delete("/metadata-fields/:fieldId", requireFieldAdmin, async (req, res) => {
    const found = await db.get(`SELECT 1 FROM metadata_fields WHERE id = ? AND organization_id = ?`, req.params.fieldId, tenantOf(req));
    if (!found) return res.status(404).json({ error: "Field not found." });
    await db.tx(async () => {
      await db.run(`DELETE FROM document_metadata WHERE field_id = ?`, req.params.fieldId);
      await db.run(`DELETE FROM metadata_fields WHERE id = ?`, req.params.fieldId);
    });
    res.json({ success: true });
  });

  router.get(
    "/documents/:id/metadata",
    withDocument(async (_req, res, doc) => {
      const rows = await db.all(`SELECT field_id, field_value FROM document_metadata WHERE contract_id = ?`, doc.id) as Array<{
        field_id: string;
        field_value: string;
      }>;
      const fields = new Map((await listFields(doc.organization_id)).map((f) => [f.id, f]));
      const values: Record<string, string | string[]> = {};
      for (const row of rows) {
        values[row.field_id] = fields.get(row.field_id)?.field_type === "multi_select" ? JSON.parse(row.field_value) : row.field_value;
      }
      res.json(values);
    }),
  );

  router.put(
    "/documents/:id/metadata",
    withDocument(async (req, res, doc, actor) => {
      const input = req.body?.values;
      if (!input || typeof input !== "object" || Array.isArray(input)) return res.status(400).json({ error: "Values are required." });
      const fields = new Map((await listFields(doc.organization_id)).map((f) => [f.id, f]));
      const rows: Array<[string, string | null]> = [];
      for (const [fieldId, raw] of Object.entries(input as Record<string, unknown>)) {
        const field = fields.get(fieldId);
        if (!field) return res.status(400).json({ error: `Unknown field: ${fieldId}` });
        if (field.field_type === "multi_select") {
          const picked = (Array.isArray(raw) ? raw : []).map(str).filter((v) => field.options.includes(v));
          rows.push([fieldId, picked.length ? JSON.stringify(picked) : null]);
          continue;
        }
        const value = str(raw).slice(0, 500);
        if (field.field_type === "select" && value && !field.options.includes(value)) {
          return res.status(400).json({ error: `Invalid option for ${field.name}.` });
        }
        if (field.field_type === "date" && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          return res.status(400).json({ error: `Invalid date for ${field.name}.` });
        }
        rows.push([fieldId, value || null]);
      }
      const at = new Date().toISOString();
      await db.tx(async () => {
        for (const [fieldId, value] of rows) {
          if (value === null) {
            await db.run(`DELETE FROM document_metadata WHERE contract_id = ? AND field_id = ?`, doc.id, fieldId);
          } else {
            await db.run(`
              INSERT INTO document_metadata (contract_id, field_id, field_value, updated_at) VALUES (?, ?, ?, ?)
              ON CONFLICT (contract_id, field_id) DO UPDATE SET field_value = excluded.field_value, updated_at = excluded.updated_at
            `, doc.id, fieldId, value, at);
          }
        }
        await db.run(`UPDATE contract_documents SET modified_by = ?, modified_at = ? WHERE id = ?`, actor.id, at, doc.id);
      });
      res.json({ success: true });
    }),
  );

  /* ------------------------ comments & redlines ------------------------ */

  const commentSelect = `
    SELECT c.*, ${nameOf("c.author_id")} AS author_name, ${nameOf("c.resolved_by")} AS resolved_by_name
    FROM contract_comments c`;

  router.get(
    "/documents/:id/comments",
    withDocument(async (_req, res, doc) => {
      res.json(await db.all(`${commentSelect} WHERE c.contract_id = ? ORDER BY c.created_at, c.id`, doc.id));
    }),
  );

  router.post(
    "/documents/:id/comments",
    withDocument(async (req, res, doc, actor) => {
      const body = str(req.body?.body).slice(0, MAX_TEXT);
      const parentId = str(req.body?.parent_id) || null;
      const type = req.body?.comment_type === "suggestion" && !parentId ? "suggestion" : "comment";
      const quote = str(req.body?.quote).slice(0, MAX_TEXT);
      const newText = type === "suggestion" ? String(req.body?.new_text ?? "").slice(0, MAX_TEXT) : null;

      if (parentId) {
        const parent = await db.get(`SELECT parent_id FROM contract_comments WHERE id = ? AND contract_id = ?`, parentId, doc.id) as
          | Pick<CommentRow, "parent_id">
          | undefined;
        if (!parent || parent.parent_id) return res.status(400).json({ error: "Replies must target a top-level comment." });
      }
      if (type === "comment" && !body) return res.status(400).json({ error: "Comment text is required." });
      if (type === "suggestion" && !quote) return res.status(400).json({ error: "A suggestion needs selected text." });

      const id = newId("cmt");
      await db.run(`
        INSERT INTO contract_comments (id, contract_id, parent_id, comment_type, body, quote, new_text, status, author_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
      `, id, doc.id, parentId, type, body, quote, newText, actor.id, new Date().toISOString());
      res.status(201).json(await db.get(`${commentSelect} WHERE c.id = ?`, id));
    }),
  );

  const TRANSITIONS: Record<CommentAction, { type: string; from: string; to: string }> = {
    accept: { type: "suggestion", from: "open", to: "accepted" },
    reject: { type: "suggestion", from: "open", to: "rejected" },
    resolve: { type: "comment", from: "open", to: "resolved" },
    reopen: { type: "comment", from: "resolved", to: "open" },
  };

  router.post(
    "/documents/:id/comments/:commentId/:action",
    withDocument(async (req, res, doc, actor) => {
      const transition = TRANSITIONS[req.params.action as CommentAction];
      if (!transition) return res.status(404).json({ error: "Unknown action." });
      const comment = await db.get(`SELECT id, parent_id, comment_type, status FROM contract_comments WHERE id = ? AND contract_id = ?`, req.params.commentId, doc.id) as CommentRow | undefined;
      if (!comment || comment.parent_id) return res.status(404).json({ error: "Comment not found." });
      if (comment.comment_type !== transition.type || comment.status !== transition.from) {
        return res.status(409).json({ error: `Cannot ${req.params.action} a ${comment.status} ${comment.comment_type}.` });
      }
      const reopening = transition.to === "open";
      await db.run(`UPDATE contract_comments SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`, transition.to, reopening ? null : actor.id, reopening ? null : new Date().toISOString(), comment.id);
      res.json(await db.get(`${commentSelect} WHERE c.id = ?`, comment.id));
    }),
  );

  return router;
}
