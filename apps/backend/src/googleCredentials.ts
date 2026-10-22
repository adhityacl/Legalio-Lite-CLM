import express from "express";
import crypto from "crypto";
import type { Sql } from "./db";
import { forwardAsyncRouteErrors } from "./asyncRoutes";
import type { Identity } from "./identity";
import { loadServiceAccountCredentials, type ServiceAccountCredentials } from "./lib/googleServiceAccountAuth";
import {
  parseOAuthClientFile,
  parseServiceAccountFile,
  type GoogleCredentialKind,
  type GoogleCredentialStatus,
  type OAuthClientFile,
  type ServiceAccountFile,
} from "@legalio/shared/googleCredentialFiles";

const ROW_ID: Record<GoogleCredentialKind, string> = {
  "service-account": "google_service_account",
  "oauth-client": "google_oauth_client",
};

interface StoredRow<T> {
  value: T;
  updated_at: string;
}

/**
 * Google credentials uploaded by a superuser, stored in kaelyn.db and preferred over .env.
 * ponytail: stored unencrypted, same exposure as the .env file they replace; encrypt the payload
 * (e.g. KMS or a BETTER_AUTH_SECRET-derived key) if copies of kaelyn.db ever leave the server.
 */
export function createGoogleCredentialStore(db: Sql) {
  // Rows mirrored in memory so token callbacks and status reads stay synchronous; only save/remove write them.
  const rows = new Map<string, StoredRow<unknown>>();
  const init = async () => {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS integration_credentials (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_by TEXT,
        updated_at TEXT NOT NULL
      );
    `);
    const stored = await db.all<{ id: string; payload: string; updated_at: string }>(`SELECT id, payload, updated_at FROM integration_credentials`);
    rows.clear();
    for (const row of stored) rows.set(row.id, { value: JSON.parse(row.payload), updated_at: row.updated_at });
  };

  const read = <T>(kind: GoogleCredentialKind): StoredRow<T> | null => (rows.get(ROW_ID[kind]) as StoredRow<T> | undefined) ?? null;

  const getServiceAccount = (): ServiceAccountCredentials | null => read<ServiceAccountFile>("service-account")?.value ?? null;

  /** Uploaded OAuth client first, then GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. */
  const getOAuthClient = () => {
    const stored = read<OAuthClientFile>("oauth-client")?.value;
    if (stored) return { clientId: stored.client_id, clientSecret: stored.client_secret };
    return {
      clientId: (process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || "").trim(),
      clientSecret: (process.env.GOOGLE_CLIENT_SECRET || "").trim(),
    };
  };

  const save = async (kind: GoogleCredentialKind, value: ServiceAccountFile | OAuthClientFile, actorId: string) => {
    const updated_at = new Date().toISOString();
    await db.run(`
      INSERT INTO integration_credentials (id, payload, updated_by, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET payload = excluded.payload, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    `, ROW_ID[kind], JSON.stringify(value), actorId, updated_at);
    rows.set(ROW_ID[kind], { value, updated_at });
  };

  const remove = async (kind: GoogleCredentialKind) => {
    await db.run(`DELETE FROM integration_credentials WHERE id = ?`, ROW_ID[kind]);
    rows.delete(ROW_ID[kind]);
  };

  const status = (): GoogleCredentialStatus => {
    const sa = read<ServiceAccountFile>("service-account");
    // With nothing uploaded, whatever loadServiceAccountCredentials still finds came from env/credentials.json.
    const envSa = sa ? null : loadServiceAccountCredentials(undefined, false);
    const oauth = read<OAuthClientFile>("oauth-client");
    const envOAuthId = oauth ? "" : getOAuthClient().clientId;
    return {
      serviceAccount: {
        source: sa ? "upload" : envSa ? "env" : null,
        client_email: sa?.value.client_email ?? envSa?.client_email ?? null,
        project_id: sa?.value.project_id ?? envSa?.project_id ?? null,
        updated_at: sa?.updated_at ?? null,
      },
      oauthClient: {
        source: oauth ? "upload" : envOAuthId ? "env" : null,
        client_id: oauth?.value.client_id ?? (envOAuthId || null),
        project_id: oauth?.value.project_id ?? null,
        javascript_origins: oauth?.value.javascript_origins ?? [],
        redirect_uris: oauth?.value.redirect_uris ?? [],
        updated_at: oauth?.updated_at ?? null,
      },
    };
  };

  return { init, getServiceAccount, getOAuthClient, save, remove, status };
}

export type GoogleCredentialStore = ReturnType<typeof createGoogleCredentialStore>;

const KINDS: GoogleCredentialKind[] = ["service-account", "oauth-client"];

const MESSAGES: Record<string, string> = {
  invalid_json: "The file is not a JSON object.",
  looks_like_oauth_client: "This is an OAuth client file; upload it in the OAuth client slot.",
  looks_like_service_account: "This is a service account key; upload it in the service account slot.",
  not_service_account: 'Not a service account key (expected "type": "service_account").',
  not_oauth_client: 'Not an OAuth client file (expected a "web" or "installed" section).',
  missing_fields: "The file is missing required fields.",
  invalid_client_id: "The client_id does not look like a Google OAuth client ID.",
  invalid_private_key: "The private_key in this file cannot be read.",
};

export function createGoogleCredentialsRouter(store: GoogleCredentialStore) {
  const router = express.Router();
  forwardAsyncRouteErrors(router);
  const base = "/integrations/google/credentials";

  router.use(base, (req, res, next) => {
    const identity = (req as unknown as { identity?: Identity }).identity;
    if (identity?.platformRole === "superuser") return next();
    res.status(403).json({ error: "INSUFFICIENT_PERMISSION", message: "Only a superuser can manage Google credentials." });
  });

  router.get(base, (_req, res) => res.json(store.status()));

  router.put(`${base}/:kind`, async (req, res) => {
    const kind = req.params.kind as GoogleCredentialKind;
    if (!KINDS.includes(kind)) return res.status(404).json({ error: "Unknown credential kind." });
    const parsed = kind === "service-account" ? parseServiceAccountFile(req.body?.file) : parseOAuthClientFile(req.body?.file);
    if (parsed.ok === false) return res.status(400).json({ error: parsed.code, message: MESSAGES[parsed.code] });
    if (kind === "service-account") {
      try {
        crypto.createPrivateKey((parsed.value as ServiceAccountFile).private_key);
      } catch {
        return res.status(400).json({ error: "invalid_private_key", message: MESSAGES.invalid_private_key });
      }
    }
    const identity = (req as unknown as { identity: Identity }).identity;
    await store.save(kind, parsed.value, identity.userId);
    res.json(store.status());
  });

  router.delete(`${base}/:kind`, async (req, res) => {
    const kind = req.params.kind as GoogleCredentialKind;
    if (!KINDS.includes(kind)) return res.status(404).json({ error: "Unknown credential kind." });
    await store.remove(kind);
    res.json(store.status());
  });

  return router;
}
