import crypto from 'crypto';
import { googleCredentials } from '../googleCredentialStore';
import { OAuth2Client } from 'google-auth-library';
import { sendRouteError } from '../apiErrors';
import { getFreshGoogleAccessToken } from '../googleDrive';
import { db, saveDb } from '../memoryDb';
import { verifyGoogleAccessTokenEmail } from '../googleTokenVerifier';
import { hasApprovalInvitation } from '../organizationAdminRoutes';
import { SSO_REQUIRED_MESSAGE, ssoBlocksPasswordSignIn } from '../ssoPolicy';
import { sql, isUniqueViolation } from '../db';
import { isIdentityBanned, sendError } from '../identity';
import { checkIsAdmin } from '../adminCheck';
import { backupLocalFilesToGoogleDrive } from '../driveBackup';
import { redactProviderConfig } from '../platformSettings';
import express from 'express';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
import { componentLog } from '../logger';
const log = componentLog('googleAuth');

export function createGoogleAuthRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);

app.get(
  ["/api/auth/google/client-id", "/api/google-auth/client-id"],
  (req: express.Request, res: express.Response) => {
    res.json({ clientId: googleCredentials.getOAuthClient().clientId });
  },
);
app.post(
  ["/api/auth/google/exchange-code", "/api/google-auth/exchange-code"],
  async (req: express.Request, res: express.Response) => {
    try {
      const { code, redirect_uri } = req.body;
      if (!code) {
        return res
          .status(400)
          .json({ error: "Authorization code is required" });
      }
      const { clientId, clientSecret } = googleCredentials.getOAuthClient();
      if (!clientId) {
        return res
          .status(500)
          .json({
            error:
              "OAuth client Google belum dikonfigurasi. Unggah file JSON OAuth client di Settings → Google, atau isi GOOGLE_CLIENT_ID.",
          });
      }
      const oauth2Client = new OAuth2Client(
        clientId,
        clientSecret,
        redirect_uri || "postmessage",
      );
      const { tokens } = await oauth2Client.getToken(code);
      if (!tokens || !tokens.access_token) {
        return res
          .status(400)
          .json({
            error: "Gagal mendapatkan Access Token dari Google OAuth server.",
          });
      }
      // The caller's own tokens are returned to the caller only. Connecting the
      // platform Google account is a separate, platform-only action (/connect).
      let profile: any = { email: "Google User", name: "Pengguna Google" };
      try {
        const userInfoRes = await fetch(
          "https://www.googleapis.com/oauth2/v3/userinfo",
          { headers: { Authorization: `Bearer ${tokens.access_token}` } },
        );
        if (userInfoRes.ok) {
          const userInfo = await userInfoRes.json() as { email?: string; name?: string; picture?: string };
          profile = {
            email: userInfo.email || "Google User",
            name: userInfo.name || userInfo.email || "Pengguna Google",
            photoURL: userInfo.picture || void 0,
          };
        }
      } catch (profileErr) {
        log.warn(
          "Gagal memuat profil pengguna di exchange-code:",
          profileErr,
        );
      }
      res.json({
        success: true,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        expiresAt: tokens.expiry_date,
        profile,
      });
    } catch (err) {
      log.error("Error exchanging Google OAuth code:", err);
      sendRouteError(req, res, err, "request failed", "Gagal menukarkan Google Authorization Code.", { status: 500 });
    }
  },
);
app.get(
  ["/api/auth/google/token", "/api/google-auth/token"],
  async (req: express.Request, res: express.Response) => {
    try {
      const freshToken = await getFreshGoogleAccessToken();
      const activeToken = freshToken || db.googleConfig?.accessToken || null;
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.json({
        success: true,
        accessToken: activeToken,
        isConnected: Boolean(
          db.googleConfig?.isConnected &&
          (activeToken || db.googleConfig?.refreshToken),
        ),
        lastSyncTime: db.googleConfig?.lastSyncTime || null,
      });
    } catch (err) {
      sendRouteError(req, res, err, "request failed", "Gagal memeriksa token Google.", { status: 500, extra: { success: false } });
    }
  },
);
app.post(
  ["/api/auth/google/refresh-token", "/api/google-auth/refresh-token"],
  async (req: express.Request, res: express.Response) => {
    try {
      const freshToken = await getFreshGoogleAccessToken();
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.json({ success: true, accessToken: freshToken });
    } catch (err) {
      sendRouteError(req, res, err, "request failed", "Gagal me-refresh token Google.", { status: 500, extra: { success: false } });
    }
  },
);
app.post(
  ["/api/auth/google/sync-session", "/api/google-auth/sync-session"],
  async (req: express.Request, res: express.Response) => {
    try {
      const { email, name, photoURL, idToken, accessToken, refreshToken } = req.body || {};
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ success: false, error: "Email diperlukan untuk sinkronisasi akun." });
      }

      const cleanEmail = email.toLowerCase().trim();
      const userName = name || cleanEmail.split("@")[0];
      const now = new Date().toISOString();

      // The e-mail in the request body is untrusted: prove it with Google.
      const verifiedEmail = await verifyGoogleAccessTokenEmail(accessToken);
      if (!verifiedEmail || verifiedEmail !== cleanEmail) {
        return res.status(401).json({
          success: false,
          error: "GOOGLE_IDENTITY_NOT_VERIFIED",
          message: "The Google sign-in could not be verified. Please sign in again.",
        });
      }

      // Google proved the email above; invitations satisfy account approval,
      // while membership is still granted only by explicit invitation acceptance.
      const invited = await hasApprovalInvitation(sql, cleanEmail, req.get('x-invitation-token'));
      let existingUser: any = await sql.get(`SELECT id, name, role, banned, "banReason", "banExpires" FROM "user" WHERE LOWER(email) = ?`, cleanEmail);
      if (!existingUser) {
        try {
          await sql.run(`
            INSERT INTO "user" (id, name, email, "emailVerified", image, role, banned, "banReason", "createdAt", "updatedAt")
            VALUES (?, ?, ?, true, ?, 'user', ?, ?, ?, ?)
          `, `usr_${crypto.randomUUID()}`, userName, cleanEmail, photoURL || null, !invited, invited ? null : 'PENDING_APPROVAL', now, now);
        } catch (err) {
          if (!isUniqueViolation(err)) throw err; // a concurrent sign-in of the same address created it first
        }
        existingUser = await sql.get(`SELECT id, name, role, banned, "banReason", "banExpires" FROM "user" WHERE LOWER(email) = ?`, cleanEmail);
      }
      if (existingUser.banReason === 'PENDING_APPROVAL' && invited) {
        await sql.run('UPDATE "user" SET banned = false, "banReason" = NULL, "banExpires" = NULL, "updatedAt" = ? WHERE id = ?', now, existingUser.id);
        existingUser.banned = false;
        existingUser.banReason = null;
        existingUser.banExpires = null;
      }
      if (isIdentityBanned(existingUser)) {
        const pending = existingUser.banReason === 'PENDING_APPROVAL';
        return res.status(403).json({ success: false, error: pending ? "ACCOUNT_PENDING_APPROVAL" : "ACCOUNT_DISABLED",
          message: pending ? "Your account is waiting for manual superuser approval." : "This account is disabled." });
      }
      if ((await ssoBlocksPasswordSignIn(sql, existingUser.id)).blocked) {
        return res.status(403).json({ success: false, error: "SSO_REQUIRED", message: SSO_REQUIRED_MESSAGE });
      }
      // Google verified this address, so the identity's email is verified.
      await sql.run(`UPDATE "user" SET image = COALESCE(?, image), "emailVerified" = true, "updatedAt" = ? WHERE id = ?`, photoURL || null, now, existingUser.id);
      const userId = existingUser.id;
      const existingAcc: any = await sql.get(`SELECT id FROM account WHERE "userId" = ? AND "providerId" = 'google'`, userId);
      if (!existingAcc) {
        await sql.run(`
          INSERT INTO account (id, "accountId", "providerId", "userId", "idToken", "createdAt", "updatedAt")
          VALUES (?, ?, 'google', ?, ?, ?, ?)
        `, `acc_${crypto.randomUUID()}`, cleanEmail, userId, idToken || null, now, now);
      }
      const sessionToken = crypto.randomBytes(32).toString("hex");
      const sessionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await sql.run(`
        INSERT INTO session (id, "expiresAt", token, "createdAt", "updatedAt", "ipAddress", "userAgent", "userId", "activeOrganizationId")
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `, `sess_${crypto.randomUUID()}`, sessionExpiry, sessionToken, now, now, req.ip || "", String(req.headers["user-agent"] || ""), userId);

      // 5. Set session cookie
      res.cookie("better-auth.session_token", sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      return res.json({
        success: true,
        sessionToken,
        user: { id: userId, email: cleanEmail, name: existingUser.name || userName, photoURL: photoURL || null },
      });
    } catch (err: any) {
      log.error("Error in /api/auth/google/sync-session:", err);
      sendRouteError(req, res, err, "request failed", "Gagal menyinkronkan sesi Google ke Better Auth.", { status: 500, extra: { success: false } });
    }
  }
);
app.post(
  ["/api/google-integration/connect", "/api/auth/google/connect"],
  async (req: express.Request, res: express.Response) => {
    if (!(await checkIsAdmin(req)).isAdmin) {
      return res.status(403).json({ error: "Forbidden: only administrators can change the Google integration." });
    }
    try {
      const { accessToken, refreshToken } = req.body || {};
      const token = accessToken || req.headers["x-google-access-token"];
      if (!token && !refreshToken) {
        return res
          .status(400)
          .json({
            success: false,
            error: "Access token atau Refresh token Google diperlukan.",
          });
      }
      if (token) db.googleConfig.accessToken = token;
      if (refreshToken) db.googleConfig.refreshToken = refreshToken;
      db.googleConfig.isConnected = true;
      db.googleConfig.lastSyncTime = new Date().toISOString();
      await saveDb();
      if (token) {
        backupLocalFilesToGoogleDrive(token).catch((e) => {
          log.warn(
            "[Google Auth] Background backup error on connect:",
            e?.message,
          );
        });
      }
      res.json({
        success: true,
        isConnected: true,
        lastSyncTime: db.googleConfig.lastSyncTime,
        config: redactProviderConfig(db.googleConfig),
      });
    } catch (err) {
      sendRouteError(req, res, err, "request failed", "Gagal menyinkronkan status koneksi Google.", { status: 500, extra: { success: false } });
    }
  },
);
app.post(
  ["/api/google-integration/disconnect", "/api/auth/google/disconnect"],
  async (req: express.Request, res: express.Response) => {
    if (!(await checkIsAdmin(req)).isAdmin) {
      return res.status(403).json({ error: "Forbidden: only administrators can change the Google integration." });
    }
    try {
      db.googleConfig.accessToken = "";
      db.googleConfig.refreshToken = "";
      db.googleConfig.isConnected = false;
      db.googleConfig.lastSyncTime = new Date().toISOString();
      await saveDb();
      res.json({
        success: true,
        isConnected: false,
        message: "Akun Google berhasil diputuskan dari konfigurasi server.",
      });
    } catch (err) {
      sendRouteError(req, res, err, "request failed", "Gagal memutuskan akun Google di server.", { status: 500, extra: { success: false } });
    }
  },
);
/* Google synchronization is a placeholder in this release (PRD §6.5): honest, scoped, no fake success. */
app.post(["/api/google-integration/sync", "/api/google-integration/sync-flush"], (req: express.Request, res: express.Response) =>
  sendError(req, res, 409, "SYNC_UNAVAILABLE", "Google synchronization is not available in this release."));
  return app;
}
