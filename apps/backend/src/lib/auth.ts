import { normalizedCoreReady, readBusinessRows } from '../normalizedCoreStore';
import { migratePartnerContact } from '../partnerContact';
import { synchronizeCoreData } from '../coreDataStore';
import { ensureTenantBoundarySchema } from '../organizationSettingsStore';
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { APIError } from "better-auth/api";
import { hasApprovalInvitation } from "../organizationAdminRoutes";
import { admin, organization } from "better-auth/plugins";
import { dash, sentinel } from "@better-auth/infra";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, memberAc } from "better-auth/plugins/organization/access";
import Database from "better-sqlite3";
import { applyPendingRestore, migrateLegacyDatabaseFilename } from '../sqliteBackups';
import { AUTH_DB_PATH, APP_DATA_DIR } from "../runtimePaths";
import { getPublicBaseUrl, loadInstallationSettings } from '../installationSettings';
import { renameLegacyKeys } from '@legalio/shared/fieldNames';

const googleClientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
const googleClientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();

/*
 * First-run onboarding stores the public URL in the installation database.
 * BETTER_AUTH_URL overrides that URL for automated deployments.
 * Deployment URL configuration (PRD §5.4). BETTER_AUTH_URL / TRUSTED_ORIGINS
 * are optional overrides for pinning or widening the allowed origins (e.g. a
 * separate front-end domain). Without either URL, `trustedOrigins` below trusts
 * whatever host/scheme the request actually arrived on instead — `server.ts`'s
 * toNodeHandler call builds every `/api/auth/*` request's URL from its real
 * `Host`/`X-Forwarded-Proto` headers (see better-call's node adapter), and the
 * documented nginx config forwards those unchanged. This is exactly the
 * origin the browser is talking to, so it's as safe as a fixed allowlist — a
 * cross-site page's forged request still carries *its own* Origin, which
 * never matches — and it means there's nothing to "capture" at build/deploy
 * time: a fresh clone logs in correctly on whatever domain it's reached at.
 */
const isProduction = process.env.NODE_ENV === "production";
const extraOrigins = (process.env.TRUSTED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);
/**
 * Trusts the request's own Origin header, but only once it's confirmed to
 * actually be this request's origin: its host must match the host this
 * request arrived on. Comparing hosts (not reconstructing a URL and guessing
 * the scheme from `X-Forwarded-Proto`/`NODE_ENV`) sidesteps a real failure
 * seen behind tunnels that terminate TLS without forwarding that header
 * (e.g. GitHub Codespaces' port forwarding): guessing "http" there caused a
 * same-origin `https://` request to be rejected as a scheme mismatch. A
 * cross-site request still carries the attacker's own Origin, whose host
 * never matches, so this stays exactly as safe as a fixed allowlist.
 *
 * A request can arrive under two names, and either may be the one the
 * browser used: `Host`, and `X-Forwarded-Host` set by a proxy in front.
 * Cloud Run hands the container an internal `Host` and the public URL in
 * `X-Forwarded-Host`; VS Code's port forwarding for a Codespace is the
 * reverse — the page is `http://localhost:3000` (matches `Host`) while the
 * tunnel sets `X-Forwarded-Host` to the `*.app.github.dev` name. Checking
 * only one of them rejected every login in the other setup. A cross-site
 * page's Origin matches neither, and a browser can't add
 * `X-Forwarded-Host` to a cross-origin request without a CORS preflight
 * this server never grants.
 */
function selfOrigin(request?: Request): string[] {
  const origin = request?.headers.get("origin");
  if (!request || !origin) return [];
  const hosts = [request.headers.get("x-forwarded-host")?.split(",")[0]?.trim(), request.headers.get("host")];
  try {
    return hosts.includes(new URL(origin).host) ? [origin] : [];
  } catch {
    return [];
  }
}
const authSecret = process.env.BETTER_AUTH_SECRET || "";
if (!authSecret && isProduction) {
  throw new Error("BETTER_AUTH_SECRET must be set in production (use a long random value).");
}
if (!authSecret) {
  console.warn("[auth] BETTER_AUTH_SECRET is not set — using an insecure development secret.");
}

// --- Access Control ---
// Admin plugin = platform authority only (tenant-boundaries PRD §10.2): an
// ordinary identity is `user` with no Admin-plugin permissions, and only
// `superuser` is an admin role. Tenant roles live in `member.role`.
export const statement = {
  user: ["create", "list", "set-role", "ban", "delete", "set-password", "set-email", "get", "update", "impersonate"],
  session: ["list", "revoke", "delete"],
} as const;

export const ac = createAccessControl(statement);

export const roles = {
  superuser: ac.newRole({
    user: ["create", "list", "set-role", "ban", "delete", "set-password", "set-email", "get", "update"],
    session: ["list", "revoke", "delete"],
  }),
  user: ac.newRole({ user: [], session: [] }),
};

// Organization plugin: the fixed tenant role catalog. Its HTTP routes are
// denied at the server boundary (server/routePolicies.ts); canonical
// services enforce membership status, ownership and hierarchy instead.
const orgAc = createAccessControl(defaultStatements);
const orgRoles = {
  admin: orgAc.newRole(adminAc.statements),
  manager: orgAc.newRole(memberAc.statements),
  editor: orgAc.newRole(memberAc.statements),
  viewer: orgAc.newRole(memberAc.statements),
};

// --- Database & Schema Initialization ---
migrateLegacyDatabaseFilename(AUTH_DB_PATH, APP_DATA_DIR);
applyPendingRestore(AUTH_DB_PATH, APP_DATA_DIR);
export const sqliteDb = new Database(AUTH_DB_PATH);
sqliteDb.pragma("journal_mode = WAL");
sqliteDb.pragma("foreign_keys = ON");
sqliteDb.pragma("synchronous = NORMAL");
sqliteDb.pragma("busy_timeout = 5000");

// Initialize Better Auth & Organization / Console tables if not exist.
// The core Better Auth tables (user/session/account/verification) are created
// here too, so a fresh clone boots without running `npm run auth:migrate`
// first — Better Auth refuses to start on a schema mismatch.
sqliteDb.exec(`
CREATE TABLE IF NOT EXISTS "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null, "role" text, "banned" integer, "banReason" text, "banExpires" date);
CREATE TABLE IF NOT EXISTS "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade, "impersonatedBy" text, "activeOrganizationId" text, "activeTeamId" text);
CREATE TABLE IF NOT EXISTS "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null, "issuer" text);
CREATE TABLE IF NOT EXISTS "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);
CREATE INDEX IF NOT EXISTS "session_userId_idx" on "session" ("userId");
CREATE INDEX IF NOT EXISTS "account_userId_idx" on "account" ("userId");
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" on "verification" ("identifier");
CREATE TABLE IF NOT EXISTS organization (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  logo TEXT,
  createdAt date,
  metadata TEXT
);
CREATE TABLE IF NOT EXISTS team (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  memberCount INTEGER DEFAULT 0,
  organizationId TEXT NOT NULL,
  createdAt date,
  updatedAt date
);
CREATE TABLE IF NOT EXISTS teamMember (
  id TEXT PRIMARY KEY,
  teamId TEXT NOT NULL,
  userId TEXT NOT NULL,
  membershipKey TEXT,
  createdAt date
);
CREATE TABLE IF NOT EXISTS member (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  userId TEXT NOT NULL,
  role TEXT NOT NULL,
  createdAt date
);
CREATE TABLE IF NOT EXISTS invitation (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT,
  teamId TEXT,
  status TEXT NOT NULL,
  expiresAt date,
  createdAt date,
  inviterId TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS apikey (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  keyPreview TEXT NOT NULL,
  keyHash TEXT NOT NULL,
  scopes TEXT NOT NULL,
  createdAt date,
  expiresAt date,
  status TEXT DEFAULT 'active'
);
`);

export function initializeCoreDataSchema() {
  if (normalizedCoreReady(sqliteDb)) return;
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS allowed_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      role TEXT,
      status TEXT,
      organizationId TEXT,
      payload TEXT,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS partners (
      id TEXT PRIMARY KEY,
      partner_id TEXT,
      organizationId TEXT,
      payload TEXT NOT NULL,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY,
      contract_id TEXT,
      organizationId TEXT,
      payload TEXT NOT NULL,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS insertion_orders (
      id TEXT PRIMARY KEY,
      io_id TEXT,
      organizationId TEXT,
      payload TEXT NOT NULL,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      organizationId TEXT,
      payload TEXT NOT NULL,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      organizationId TEXT,
      payload TEXT NOT NULL,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY,
      organizationId TEXT,
      payload TEXT NOT NULL,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS spendings (
      id TEXT PRIMARY KEY,
      organizationId TEXT,
      payload TEXT NOT NULL,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      organizationId TEXT,
      payload TEXT NOT NULL,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      organizationId TEXT,
      payload TEXT NOT NULL,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      organizationId TEXT,
      payload TEXT NOT NULL,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS branding (
      id TEXT PRIMARY KEY CHECK(id = 'branding'),
      organizationId TEXT,
      payload TEXT NOT NULL,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id TEXT PRIMARY KEY CHECK(id IN ('app_settings', 'google_config')),
      organizationId TEXT,
      payload TEXT NOT NULL,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS news_ticker (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS ai_ocr_cache (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_allowed_users_org ON allowed_users (organizationId);
    CREATE INDEX IF NOT EXISTS idx_partners_org ON partners (organizationId);
    CREATE INDEX IF NOT EXISTS idx_contracts_org ON contracts (organizationId);
    CREATE INDEX IF NOT EXISTS idx_ios_org ON insertion_orders (organizationId);
    CREATE INDEX IF NOT EXISTS idx_notifications_org ON notifications (organizationId);
    CREATE INDEX IF NOT EXISTS idx_activity_logs_org ON activity_logs (organizationId);
    CREATE INDEX IF NOT EXISTS idx_evaluations_org ON evaluations (organizationId);
    CREATE INDEX IF NOT EXISTS idx_spendings_org ON spendings (organizationId);
    CREATE INDEX IF NOT EXISTS idx_tenants_org ON tenants (organizationId);
    CREATE INDEX IF NOT EXISTS idx_departments_org ON departments (organizationId);
    CREATE INDEX IF NOT EXISTS idx_templates_org ON templates (organizationId);
    CREATE INDEX IF NOT EXISTS idx_partners_partner_id ON partners (partner_id);
    CREATE INDEX IF NOT EXISTS idx_contracts_contract_id ON contracts (contract_id);
    CREATE INDEX IF NOT EXISTS idx_ios_io_id ON insertion_orders (io_id);
  `);
}

export function hydrateCoreDataFromJson(data: any) {
  synchronizeCoreData(sqliteDb, renameLegacyKeys(data));
}

export function loadCoreDataFromSqlite() {
  const normalized = normalizedCoreReady(sqliteDb);
  const business = (table: string) => normalized ? readBusinessRows(sqliteDb, table) : sqliteDb.prepare(`SELECT payload FROM ${table}`).all().map((r: any) => JSON.parse(r.payload));
  const rows = {
    allowedUsers: sqliteDb.prepare(`SELECT payload FROM allowed_users`).all().map((r: any) => JSON.parse(r.payload)),
    partners: business('partners').map(migratePartnerContact),
    contracts: business('contracts'),
    ios: business('insertion_orders'),
    notifications: business('notifications'),
    activityLogs: business('activity_logs'),
    evaluations: business('evaluations'),
    spendings: business('spendings'),
    tenants: sqliteDb.prepare(`SELECT payload FROM tenants`).all().map((r: any) => JSON.parse(r.payload)),
    departments: sqliteDb.prepare(`SELECT payload FROM departments`).all().map((r: any) => JSON.parse(r.payload)),
    templates: business('templates'),
    branding: (() => {
      const row = sqliteDb.prepare(`SELECT payload FROM branding WHERE id = 'branding'`).get() as any;
      return row ? JSON.parse(row.payload) : null;
    })(),
    googleConfig: (() => {
      const row = sqliteDb.prepare(`SELECT payload FROM app_settings WHERE id = 'google_config'`).get() as any;
      return row ? JSON.parse(row.payload) : null;
    })(),
    newsTicker: (() => {
      const row = sqliteDb.prepare(`SELECT payload FROM news_ticker WHERE id = 'default'`).get() as any;
      return row ? JSON.parse(row.payload) : null;
    })(),
  };
  return rows;
}

export function syncDbToSqlite(data: any) {
  synchronizeCoreData(sqliteDb, data);
}

// Ensure session table has activeOrganizationId and activeTeamId columns
try {
  const sessionCols = sqliteDb.prepare("PRAGMA table_info(session)").all().map((c: any) => c.name);
  if (!sessionCols.includes('activeOrganizationId')) {
    sqliteDb.exec("ALTER TABLE session ADD COLUMN activeOrganizationId TEXT");
  }
  if (!sessionCols.includes('activeTeamId')) {
    sqliteDb.exec("ALTER TABLE session ADD COLUMN activeTeamId TEXT");
  }
} catch (err) {
  // Session table may not exist yet if fresh
}

initializeCoreDataSchema();
// Canonical tenant-boundary tables + member.status / invitation.departmentIds
// must exist before Better Auth reads the plugin schema.
ensureTenantBoundarySchema(sqliteDb);

// Better Auth 1.7.3 no longer writes account.issuer for every provider.
// Keep older databases compatible by making the legacy column nullable.
try {
  const accountColumns = sqliteDb.prepare("PRAGMA table_info(account)").all() as Array<{
    name: string;
    notnull: number;
  }>;
  const issuerColumn = accountColumns.find((column) => column.name === "issuer");

  // `npm run auth:migrate` on Better Auth 1.7.x creates account without issuer,
  // but ensureUserAccountsExist() still writes it — add it back as nullable.
  if (!issuerColumn) {
    sqliteDb.exec("ALTER TABLE account ADD COLUMN issuer TEXT");
  } else if (issuerColumn.notnull === 1) {
    sqliteDb.transaction(() => {
      sqliteDb.exec(`
        ALTER TABLE account RENAME TO account_legacy_schema;
        CREATE TABLE account (
          id TEXT NOT NULL PRIMARY KEY,
          accountId TEXT NOT NULL,
          providerId TEXT NOT NULL,
          userId TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
          accessToken TEXT,
          refreshToken TEXT,
          idToken TEXT,
          accessTokenExpiresAt date,
          refreshTokenExpiresAt date,
          scope TEXT,
          password TEXT,
          createdAt date NOT NULL,
          updatedAt date NOT NULL,
          issuer TEXT
        );
        INSERT INTO account (
          id, accountId, providerId, userId, accessToken, refreshToken, idToken,
          accessTokenExpiresAt, refreshTokenExpiresAt, scope, password,
          createdAt, updatedAt, issuer
        )
        SELECT
          id, accountId, providerId, userId, accessToken, refreshToken, idToken,
          accessTokenExpiresAt, refreshTokenExpiresAt, scope, password,
          createdAt, updatedAt, issuer
        FROM account_legacy_schema;
        DROP TABLE account_legacy_schema;
        CREATE INDEX account_userId_idx ON account (userId);
        CREATE UNIQUE INDEX account_issuer_accountId_uidx
          ON account (issuer, accountId);
      `);
    })();
  }
} catch (err) {
  console.error("Could not migrate the Better Auth account schema:", err);
  throw err;
}

// Organizations are not seeded here: server startup hydrates them from the
// tenant list (the demo dataset on first run, or the admin's own setup).

type VerificationMailer = (input: { email: string; name: string; url: string }) => Promise<void>;
let verificationMailer: VerificationMailer | null = null;
/** server.ts installs the platform mailer; tests leave it unset (no delivery). */
export function setVerificationMailer(mailer: VerificationMailer | null) {
  verificationMailer = mailer;
}

// --- Better Auth Instance ---
// Existing databases gain the optional personal bio without changing account data.
if (!(sqliteDb.prepare('PRAGMA table_info("user")').all() as Array<{ name: string }>).some(column => column.name === 'bio')) {
  sqliteDb.exec('ALTER TABLE "user" ADD COLUMN bio TEXT');
}

loadInstallationSettings(sqliteDb);

// Run after credentials/OAuth are verified, before the admin plugin checks bans.
// This also unblocks accounts registered before invitation-based approval existed.
const invitationApprovalPlugin = {
  id: 'invitation-approval',
  init: () => ({ options: { databaseHooks: {
    session: { create: { before: async (session, ctx) => {
      const user = sqliteDb.prepare('SELECT email, banned, banReason FROM "user" WHERE id = ?').get(session.userId) as
        { email: string; banned: number | null; banReason: string | null } | undefined;
      if (user?.banned && user.banReason === 'PENDING_APPROVAL' &&
          hasApprovalInvitation(sqliteDb, user.email, ctx?.headers?.get('x-invitation-token'))) {
        await ctx?.context.internalAdapter.updateUser(session.userId, { banned: false, banReason: null, banExpires: null });
      }
    } } },
  } } }),
} satisfies BetterAuthPlugin;

const createAuth = () => betterAuth({
  // Unset: Better Auth derives the base URL per request from its real
  // Host/X-Forwarded-Proto headers (see the comment above) instead of a
  // fixed host baked in at startup.
  baseURL: getPublicBaseUrl() || undefined,
  database: sqliteDb,
  user: {
    additionalFields: {
      bio: { type: 'string', required: false, input: true },
    },
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
  },
  // Google sign-in is optional and only enabled when credentials exist.
  socialProviders: googleClientId && googleClientSecret
    ? { google: { clientId: googleClientId, clientSecret: googleClientSecret } }
    : {},
  emailVerification: {
    // Delivery uses the platform mailer (set by server.ts). Failure never
    // marks an account verified; the user can request another email.
    sendOnSignUp: false,
    sendVerificationEmail: async ({ user, url }) => {
      try {
        await verificationMailer?.({ email: user.email, name: user.name, url });
      } catch (err) {
        console.warn("[auth] verification email not sent:", (err as Error)?.message);
      }
    },
  },
  plugins: [
    invitationApprovalPlugin,
    admin({
      ac,
      roles,
      defaultRole: "user",
      adminRoles: ["superuser"],
    }),
    organization({
      allowUserToCreateOrganization: false,
      creatorRole: "admin",
      roles: orgRoles,
      teams: { enabled: true },
      schema: {
        member: { additionalFields: { status: { type: "string", required: false, defaultValue: "active", input: false } } },
        invitation: { additionalFields: { departmentIds: { type: "string", required: false, input: false } } },
      },
    }),
    ...(process.env.BETTER_AUTH_ENABLE_INFRA === 'true' && process.env.BETTER_AUTH_API_KEY && true
      ? [
          dash({
            apiKey: process.env.BETTER_AUTH_API_KEY,
          }),
          sentinel({
            apiKey: process.env.BETTER_AUTH_API_KEY,
          }),
        ]
      : []),
  ],
  databaseHooks: {
    user: {
      create: {
        before: async (user, ctx) => {
          const token = ctx?.headers?.get('x-invitation-token');
          const invited = hasApprovalInvitation(sqliteDb, user.email, token);
          if (token && !invited) throw APIError.from('BAD_REQUEST', {
            code: 'INVALID_INVITATION', message: 'This invitation is invalid, expired, or belongs to a different account.',
          });
          return { data: { ...user, role: "user", banned: !invited, banReason: invited ? null : "PENDING_APPROVAL", banExpires: null } };
        },
      },
    },
  },
  // A function, not a static array, so Better Auth re-evaluates it per
  // request instead of once at startup — see selfOrigin() above.
  trustedOrigins: async (request?: Request) => [...extraOrigins, ...(getPublicBaseUrl() ? [getPublicBaseUrl()] : []), ...selfOrigin(request)],
  secret: authSecret || "insecure-development-secret-change-me",
});

export let auth = createAuth();

/** Apply first-run URL configuration before the new administrator signs in. */
export function reloadAuthConfiguration(): void {
  loadInstallationSettings(sqliteDb);
  auth = createAuth();
}
