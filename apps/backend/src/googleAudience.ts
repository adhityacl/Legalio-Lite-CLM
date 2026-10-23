import { OAuth2Client } from 'google-auth-library';

/** What Google's tokeninfo endpoint says about an access token (a subset of google-auth-library's TokenInfo). */
export interface GoogleTokenInfo { aud?: string; azp?: string; email?: string; email_verified?: boolean | string; expiry_date?: number }
export interface GoogleUserInfo { email?: string; email_verified?: boolean | string }

export interface GoogleVerifierDeps {
  tokenInfo: (accessToken: string) => Promise<GoogleTokenInfo>;
  userInfo: (accessToken: string) => Promise<GoogleUserInfo | null>;
}

const isTrue = (value: unknown) => value === true || value === 'true';

export const googleDeps: GoogleVerifierDeps = {
  tokenInfo: (accessToken) => new OAuth2Client().getTokenInfo(accessToken) as Promise<GoogleTokenInfo>,
  async userInfo(accessToken) {
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
    return response.ok ? ((await response.json()) as GoogleUserInfo) : null;
  },
};

/**
 * Resolves the verified e-mail behind a Google access token, or null. Any access token Google issued to *any* app
 * would otherwise prove an identity here, so the token must have been issued to this installation's OAuth client
 * (`aud` of tokeninfo equals the configured client id) and Google must report the e-mail as verified.
 */
export async function verifyGoogleAccessToken(accessToken: unknown, expectedClientId: string | null | undefined, deps: GoogleVerifierDeps = googleDeps): Promise<string | null> {
  if (!accessToken || typeof accessToken !== 'string' || !expectedClientId) return null;
  try {
    const token = await deps.tokenInfo(accessToken);
    if (!token || token.aud !== expectedClientId) return null;
    if (token.expiry_date && token.expiry_date < Date.now()) return null;
    const info = await deps.userInfo(accessToken);
    if (!info?.email || !isTrue(info.email_verified)) return null;
    const email = String(info.email).toLowerCase().trim();
    if (token.email && String(token.email).toLowerCase().trim() !== email) return null;
    if (token.email_verified !== undefined && !isTrue(token.email_verified)) return null;
    return email;
  } catch {
    return null;
  }
}
