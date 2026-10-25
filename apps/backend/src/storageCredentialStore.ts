import { createStorageCredentialStore } from './storageCredentials';
import { sql } from './db';
import { notifySharedState, registerSharedState } from './sharedState';
/** The process-wide store of the Tencent COS credentials saved in the app. */
export const storageCredentials = createStorageCredentialStore(sql, () => void notifySharedState('credentials'));
registerSharedState('credentials', () => storageCredentials.init());
