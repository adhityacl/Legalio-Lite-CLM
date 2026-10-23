import { verifyGoogleAccessToken } from './googleAudience';
import { googleCredentials } from './googleCredentialStore';
/** Verifies Google OAuth access tokens against this installation's client (swappable so tests need no network). */

/**
 * Resolve the verified e-mail behind a Google OAuth access token: the token must have been issued to this
 * installation's OAuth client (tokeninfo audience) and Google must report the e-mail as verified.
 * `verifyGoogleToken` is swappable so tests can run without contacting Google.
 */
let verifyGoogleToken: (accessToken: unknown, clientId: string | null | undefined) => Promise<string | null> = verifyGoogleAccessToken;
export function verifyGoogleAccessTokenEmail(accessToken: unknown): Promise<string | null> {
  return verifyGoogleToken(accessToken, googleCredentials.getOAuthClient().clientId);
}
/** Tests only: replaces the Google token verifier. */
export function setGoogleTokenVerifier(verifier: typeof verifyGoogleToken) { verifyGoogleToken = verifier; }
