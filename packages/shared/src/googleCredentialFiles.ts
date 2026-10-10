/**
 * Validates the two JSON files exported from Google Cloud Console. Shared by the upload
 * dialog (instant feedback) and the server (trust boundary).
 */

export type GoogleCredentialKind = 'service-account' | 'oauth-client';

export interface ServiceAccountFile {
  type: 'service_account';
  project_id: string;
  private_key_id?: string;
  private_key: string;
  client_email: string;
  client_id?: string;
  token_uri?: string;
}

export interface OAuthClientFile {
  client_id: string;
  client_secret: string;
  project_id?: string;
  redirect_uris: string[];
  javascript_origins: string[];
}

export type ParseErrorCode =
  | 'invalid_json'
  | 'looks_like_oauth_client'
  | 'looks_like_service_account'
  | 'not_service_account'
  | 'not_oauth_client'
  | 'missing_fields'
  | 'invalid_client_id';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; code: ParseErrorCode };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strList = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

export function parseServiceAccountFile(raw: unknown): ParseResult<ServiceAccountFile> {
  if (!isObject(raw)) return { ok: false, code: 'invalid_json' };
  if (isObject(raw.web) || isObject(raw.installed)) return { ok: false, code: 'looks_like_oauth_client' };
  if (raw.type !== 'service_account') return { ok: false, code: 'not_service_account' };
  const privateKey = str(raw.private_key).replace(/\\n/g, '\n');
  const clientEmail = str(raw.client_email);
  if (!clientEmail || !privateKey.includes('PRIVATE KEY')) return { ok: false, code: 'missing_fields' };
  return {
    ok: true,
    value: {
      type: 'service_account',
      project_id: str(raw.project_id),
      private_key_id: str(raw.private_key_id) || undefined,
      private_key: privateKey.endsWith('\n') ? privateKey : `${privateKey}\n`,
      client_email: clientEmail,
      client_id: str(raw.client_id) || undefined,
      token_uri: str(raw.token_uri) || undefined,
    },
  };
}

/** Accepts both "Web application" ({web}) and "Desktop" ({installed}) client downloads. */
export function parseOAuthClientFile(raw: unknown): ParseResult<OAuthClientFile> {
  if (!isObject(raw)) return { ok: false, code: 'invalid_json' };
  if (raw.type === 'service_account') return { ok: false, code: 'looks_like_service_account' };
  const client = isObject(raw.web) ? raw.web : isObject(raw.installed) ? raw.installed : null;
  if (!client) return { ok: false, code: 'not_oauth_client' };
  const clientId = str(client.client_id);
  const clientSecret = str(client.client_secret);
  if (!clientId || !clientSecret) return { ok: false, code: 'missing_fields' };
  if (!clientId.endsWith('.apps.googleusercontent.com')) return { ok: false, code: 'invalid_client_id' };
  return {
    ok: true,
    value: {
      client_id: clientId,
      client_secret: clientSecret,
      project_id: str(client.project_id) || undefined,
      redirect_uris: strList(client.redirect_uris),
      javascript_origins: strList(client.javascript_origins),
    },
  };
}

/** What the server reports back — never the private key or client secret. */
export interface GoogleCredentialStatus {
  serviceAccount: {
    source: 'upload' | 'env' | null;
    client_email: string | null;
    project_id: string | null;
    updated_at: string | null;
  };
  oauthClient: {
    source: 'upload' | 'env' | null;
    client_id: string | null;
    project_id: string | null;
    javascript_origins: string[];
    redirect_uris: string[];
    updated_at: string | null;
  };
}
