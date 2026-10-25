import { synchronizeCoreData } from '../coreDataStore';
import { openProviderSecrets } from '../providerSecrets';
import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from "better-auth";
import { APIError } from "better-auth/api";
import { hasApprovalInvitation } from "../organizationAdminRoutes";
import { SSO_REQUIRED_MESSAGE, ssoBlocksPasswordSignIn } from "../ssoPolicy";
import { admin, organization } from "better-auth/plugins";
import { dash, sentinel } from "@better-auth/infra";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, memberAc } from "better-auth/plugins/organization/access";
import { getPublicBaseUrl, loadInstallationSettings } from '../installationSettings';
import { pool, sql } from '../db';


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

export async function loadCoreData() {
  const single = async (text: string) => { const row = await sql.get(text); return row ? JSON.parse(row.payload) : null; };
  const rows = {
    // Business records and the allowlist are repository-backed (src/repositories): the projection holds the installation configuration only.
    branding: await single(`SELECT payload FROM branding WHERE id = 'branding'`),
    googleConfig: await single(`SELECT payload FROM app_settings WHERE id = 'google_config'`).then(config => config && openProviderSecrets(config)),
    newsTicker: await single(`SELECT payload FROM news_ticker WHERE id = 'default'`),
  };
  return rows;
}

export function saveCoreData(data: any) {
  return synchronizeCoreData(sql, data);
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
// Run after credentials/OAuth are verified, before the admin plugin checks bans.
// This also unblocks accounts registered before invitation-based approval existed.
const invitationApprovalPlugin = {
  id: 'invitation-approval',
  init: () => ({ options: { databaseHooks: {
    session: { create: { before: async (session, ctx) => {
      // Sessions started through Better Auth's own endpoints (password, social) are refused for members of organizations that require SSO.
      // SSO sessions are created by sso.ts outside an endpoint, so they carry no endpoint context and pass.
      if (ctx && (await ssoBlocksPasswordSignIn(sql, session.userId)).blocked) {
        throw APIError.from('FORBIDDEN', { code: 'SSO_REQUIRED', message: SSO_REQUIRED_MESSAGE });
      }
      const user = await sql.get<{ email: string; banned: boolean | null; banReason: string | null }>('SELECT email, banned, "banReason" FROM "user" WHERE id = ?', session.userId);
      if (user?.banned && user.banReason === 'PENDING_APPROVAL' &&
          await hasApprovalInvitation(sql, user.email, ctx?.headers?.get('x-invitation-token'))) {
        await ctx?.context.internalAdapter.updateUser(session.userId, { banned: false, banReason: null, banExpires: null });
      }
    } } },
  } } }),
} satisfies BetterAuthPlugin;

// Also handed to getMigrations by schema.ts, so the created tables match this plugin and field setup.
export const authOptions = (database: BetterAuthOptions["database"]) => ({
  // Unset: Better Auth derives the base URL per request from its real
  // Host/X-Forwarded-Proto headers (see the comment above) instead of a
  // fixed host baked in at startup.
  baseURL: getPublicBaseUrl() || undefined,
  database,
  user: {
    additionalFields: {
      bio: { type: 'string', required: false, input: true },
    },
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
  },
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
          const invited = await hasApprovalInvitation(sql, user.email, token);
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
  // Explicit (Better Auth only enables its limiter by default in production): in-memory per process, keyed on the client IP from
  // X-Forwarded-For, which nginx sets from the real peer address. Stricter rules for credential endpoints.
  rateLimit: {
    enabled: process.env.RATE_LIMIT_DISABLED !== "true" && process.env.APP_TEST_MODE !== "1",
    window: 60,
    max: 100,
    storage: "memory",
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
      "/forget-password": { window: 60, max: 5 },
      "/request-password-reset": { window: 60, max: 5 },
      "/reset-password": { window: 60, max: 5 },
      "/send-verification-email": { window: 60, max: 5 },
    },
  },
}) satisfies BetterAuthOptions;

const createAuth = () => betterAuth(authOptions(pool()));

// Built by reloadAuthConfiguration() in server init(), once the pool is connected.
export let auth: ReturnType<typeof createAuth>;

/** Apply first-run URL configuration before the new administrator signs in. */
export async function reloadAuthConfiguration(): Promise<void> {
  await loadInstallationSettings(sql);
  auth = createAuth();
}
