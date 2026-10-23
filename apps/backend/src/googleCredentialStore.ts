import { createGoogleCredentialStore } from './googleCredentials';
import { sql } from './db';
import { setStoredServiceAccountProvider } from './lib/googleServiceAccountAuth';
/** The process-wide store of Google/COS credentials saved in the app (they win over the GOOGLE_* env vars). */

// Google JSON credentials uploaded in the app win over the GOOGLE_* env vars.
export const googleCredentials = createGoogleCredentialStore(sql);
setStoredServiceAccountProvider(googleCredentials.getServiceAccount);
