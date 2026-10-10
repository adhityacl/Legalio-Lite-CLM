import { translateStatic as t } from '../context/LanguageContext';

/*
 * Google sign-in and Drive/Sheets access both go through Google Identity
 * Services with the OAuth client a Superuser uploads in "Connect Google" (or
 * GOOGLE_CLIENT_ID). No Firebase: nothing has to be configured in .env.
 */

export interface GoogleUserProfile {
  email: string;
  name: string;
  photoURL?: string;
}

// Global declaration for Google Identity Services (GIS)
declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initCodeClient: (config: {
            client_id: string;
            scope: string;
            ux_mode?: 'popup' | 'redirect';
            access_type?: 'offline' | 'online';
            prompt?: string;
            redirect_uri?: string;
            callback: (response: { code?: string; error?: string; error_description?: string }) => void;
            error_callback?: (error: any) => void;
          }) => {
            requestCode: () => void;
          };
          initTokenClient?: (config: any) => any;
        };
      };
    };
  }
}

let cachedAccessToken: string | null = typeof window !== 'undefined' ? localStorage.getItem('google_access_token') : null;
let fetchedClientId: string | null = null;

export const loadGoogleIdentityScript = (): Promise<void> => {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve();
    if (window.google?.accounts?.oauth2?.initCodeClient) {
      return resolve();
    }
    const existing = document.getElementById('google-gsi-script');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => resolve());
      return;
    }
    const script = document.createElement('script');
    script.id = 'google-gsi-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
};

export const getGoogleClientId = async (): Promise<string | null> => {
  if (fetchedClientId) return fetchedClientId;
  try {
    const res = await fetch('/api/auth/google/client-id');
    if (res.ok) {
      const data = await res.json();
      if (data.clientId) {
        fetchedClientId = data.clientId;
        return data.clientId;
      }
    }
  } catch (err) {
    console.warn('Could not fetch client-id from backend:', err);
  }
  const envId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || '';
  if (envId) {
    fetchedClientId = envId;
    return envId;
  }
  return null;
};

export const signInWithGoogleCodeFlow = async (): Promise<{ accessToken: string; profile: GoogleUserProfile }> => {
  await loadGoogleIdentityScript();
  const clientId = await getGoogleClientId();
  if (!clientId || !window.google?.accounts?.oauth2?.initCodeClient) {
    throw new Error(t('google_auth.gis_unavailable', 'Google Identity Services client is not available'));
  }

  return new Promise((resolve, reject) => {
    try {
      const client = window.google!.accounts!.oauth2!.initCodeClient({
        client_id: clientId,
        // openid/email/profile let the server read the user's e-mail from this token
        // (exchange-code profile, sync-session identity check) when it's also the login path.
        scope: 'openid email profile https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly',
        ux_mode: 'popup',
        access_type: 'offline', // Wajib offline agar Google menerbitkan Refresh Token
        prompt: 'consent',       // Wajib consent agar Refresh Token selalu diterbitkan
        callback: async (response) => {
          if (response.error) {
            reject(new Error(response.error_description || response.error));
            return;
          }
          if (!response.code) {
            reject(new Error(t('google_auth.no_auth_code', 'Tidak ada Authorization Code yang diterima dari Google.')));
            return;
          }

          try {
            const exchangeRes = await fetch('/api/auth/google/exchange-code', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: response.code, redirect_uri: 'postmessage' }),
            });
            const data = await exchangeRes.json();
            if (!exchangeRes.ok) {
              throw new Error(data.error || t('google_auth.exchange_failed', 'Gagal menukarkan Authorization Code.'));
            }

            cachedAccessToken = data.accessToken;
            const profile: GoogleUserProfile = data.profile || {
              email: 'Google User',
              name: 'Pengguna Google',
            };

            if (typeof window !== 'undefined') {
              const expiresAt = data.expiresAt || (Date.now() + 3500 * 1000);
              localStorage.setItem('google_access_token', cachedAccessToken!);
              if (data.refreshToken) {
                localStorage.setItem('google_refresh_token', data.refreshToken);
              }
              localStorage.setItem('google_token_expires_at', expiresAt.toString());
              localStorage.setItem('google_user_profile', JSON.stringify(profile));
            }

            // Signing in never connects the platform Google account; System Admin does that explicitly.
            resolve({ accessToken: cachedAccessToken!, profile });
          } catch (err: any) {
            reject(err);
          }
        },
        error_callback: (err) => {
          if (err?.type === 'popup_closed') {
            reject(new Error('Jendela login Google ditutup sebelum otorisasi selesai. Silakan coba lagi.'));
          } else if (err?.type === 'popup_failed_to_open') {
            reject(new Error('Jendela popup login diblokir oleh browser. Harap izinkan pop-up untuk situs ini.'));
          } else {
            reject(new Error(err?.message || t('google_auth.oauth_failed', 'Gagal melakukan otorisasi Google OAuth')));
          }
        },
      });

      client.requestCode();
    } catch (err: any) {
      reject(err);
    }
  });
};

export const isGoogleTokenValid = (): boolean => {
  if (typeof window === 'undefined') return false;
  const token = localStorage.getItem('google_access_token');
  if (!token) return false;
  const expiresAt = localStorage.getItem('google_token_expires_at');
  if (expiresAt) {
    const isExpired = Date.now() > parseInt(expiresAt, 10);
    if (isExpired) {
      cachedAccessToken = null;
      return false;
    }
  }
  return true;
};

export const invalidateGoogleToken = () => {
  cachedAccessToken = null;
  if (typeof window !== 'undefined') {
    localStorage.removeItem('google_access_token');
    localStorage.removeItem('google_token_expires_at');
  }
};

export const getSavedGoogleUser = (): GoogleUserProfile | null => {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem('google_user_profile');
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
};

/** Reports the Google account remembered from the last sign-in; returns an unsubscribe no-op. */
export const onGoogleAuthStateChange = (
  callback: (userProfile: GoogleUserProfile | null, token: string | null) => void
) => {
  callback(getSavedGoogleUser(), isGoogleTokenValid() ? cachedAccessToken : null);
  return () => {};
};

export const syncTokenToServer = async (
  token: string,
  refreshToken?: string | null,
  profile?: GoogleUserProfile
): Promise<void> => {
  try {
    const res = await fetch('/api/google-integration/connect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-google-access-token': token,
      },
      credentials: 'include',
      body: JSON.stringify({
        accessToken: token,
        refreshToken: refreshToken || undefined,
        googleUser: profile,
      }),
    });
    if (!res.ok) {
      console.warn('[GoogleAuth] Server sync returned non-OK status:', res.status);
    }
  } catch (err) {
    console.warn('[GoogleAuth] Failed to sync token to backend server:', err);
  }
};

/** Exchanges a verified Google access token for an app (Better Auth) session; '' if the server refused. */
const createAppSession = async (profile: GoogleUserProfile, accessToken: string): Promise<string> => {
  try {
    const syncRes = await fetch('/api/auth/google/sync-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: profile.email, name: profile.name, photoURL: profile.photoURL, accessToken }),
    });
    if (!syncRes.ok) return '';
    const syncData = await syncRes.json();
    if (syncData.sessionToken && typeof window !== 'undefined') {
      localStorage.setItem('auth_session_token', syncData.sessionToken);
    }
    return syncData.sessionToken || '';
  } catch (syncErr) {
    console.warn('Syncing Google session to backend Better Auth failed:', syncErr);
    return '';
  }
};

export const signInWithGoogle = async (): Promise<{ accessToken: string; profile: GoogleUserProfile; sessionToken?: string }> => {
  const result = await signInWithGoogleCodeFlow();
  return { ...result, sessionToken: await createAppSession(result.profile, result.accessToken) };
};

export const getGoogleTokenRemainingMinutes = (): number => {
  if (typeof window === 'undefined') return 0;
  const expiresAt = localStorage.getItem('google_token_expires_at');
  if (!expiresAt) return 0;
  const remainingMs = parseInt(expiresAt, 10) - Date.now();
  if (remainingMs <= 0) return 0;
  return Math.floor(remainingMs / (1000 * 60));
};

export const silentRefreshGoogleToken = signInWithGoogleCodeFlow;

export const logoutGoogle = async () => {
  // Beritahu backend untuk memutus koneksi Google secara bersih
  try {
    await fetch('/api/google-integration/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
  } catch (discErr) {
    console.warn('[GoogleAuth] Gagal mengirim disconnect ke server:', discErr);
  }

  cachedAccessToken = null;
  if (typeof window !== 'undefined') {
    localStorage.removeItem('google_access_token');
    localStorage.removeItem('google_refresh_token');
    localStorage.removeItem('google_user_profile');
    localStorage.removeItem('google_token_expires_at');
  }
};

export const requestGoogleAccessToken = async (forceRefresh: boolean = false): Promise<string | null> => {
  if (typeof window === 'undefined') return null;

  // If token is valid and has more than 5 minutes remaining, and not forcing refresh, return it
  if (!forceRefresh && isGoogleTokenValid()) {
    const remaining = getGoogleTokenRemainingMinutes();
    if (remaining > 5) {
      const stored = localStorage.getItem('google_access_token');
      if (stored) return stored;
    }
  }

  // Request fresh token from server backend (which uses refresh_token)
  try {
    const res = await fetch('/api/auth/google/token', {
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.accessToken) {
        cachedAccessToken = data.accessToken;
        const expiresAt = Date.now() + 3500 * 1000;
        localStorage.setItem('google_access_token', data.accessToken);
        localStorage.setItem('google_token_expires_at', expiresAt.toString());
        return data.accessToken;
      }
    }
  } catch (err) {
    console.warn('[GoogleAuth] Could not fetch fresh token from backend:', err);
  }

  return localStorage.getItem('google_access_token') || cachedAccessToken;
};

export const getCachedAccessToken = (): string | null => {
  if (typeof window !== 'undefined') {
    if (!isGoogleTokenValid()) {
      // Trigger background silent refresh from backend without blocking
      requestGoogleAccessToken(true).catch(() => {});
      return null;
    }
    const token = localStorage.getItem('google_access_token');
    if (token) return token;
  }
  return cachedAccessToken;
};

// Google Sheets & Drive REST Helpers using accessToken
export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
}

export const fetchUserSpreadsheets = async (token: string): Promise<DriveFileItem[]> => {
  if (!token) {
    throw new Error(t('google_auth.not_connected', 'Sesi Google belum terhubung. Silakan klik "Hubungkan Akun Google" terlebih dahulu.'));
  }
  const query = encodeURIComponent("mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false");
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType,modifiedTime)&pageSize=30&orderBy=modifiedTime desc`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const errorJson = await res.json().catch(() => ({}));
    console.error('Google Drive API Error (Spreadsheets):', res.status, errorJson);
    if (res.status === 401 || res.status === 403) {
      invalidateGoogleToken();
      throw Object.assign(new Error(t('google_auth.session_expired', 'Sesi otorisasi Google telah berakhir atau izin Google Drive belum diaktifkan. Silakan hubungkan ulang akun Google Anda.')), { status: res.status });
    }
    throw new Error(errorJson?.error?.message || t('google_auth.list_sheets_failed', 'Gagal mengambil daftar Google Spreadsheet dari Google Drive. Pastikan akun Google Anda terhubung dan memiliki izin Google Drive.'));
  }
  const data = await res.json();
  return data.files || [];
};

export const fetchUserFolders = async (token: string): Promise<DriveFileItem[]> => {
  if (!token) {
    throw new Error(t('google_auth.not_connected', 'Sesi Google belum terhubung. Silakan klik "Hubungkan Akun Google" terlebih dahulu.'));
  }
  const query = encodeURIComponent("mimeType = 'application/vnd.google-apps.folder' and trashed = false");
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType,modifiedTime)&pageSize=30&orderBy=modifiedTime desc`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const errorJson = await res.json().catch(() => ({}));
    console.error('Google Drive API Error (Folders):', res.status, errorJson);
    if (res.status === 401 || res.status === 403) {
      invalidateGoogleToken();
      throw Object.assign(new Error(t('google_auth.session_expired', 'Sesi otorisasi Google telah berakhir atau izin Google Drive belum diaktifkan. Silakan hubungkan ulang akun Google Anda.')), { status: res.status });
    }
    throw new Error(errorJson?.error?.message || t('google_auth.list_folders_failed', 'Gagal mengambil daftar folder dari Google Drive. Pastikan akun Google Anda terhubung dan memiliki izin Google Drive.'));
  }
  const data = await res.json();
  return data.files || [];
};

export const createNewSpreadsheet = async (token: string, title: string = 'Database Kontrak & IO (Auto Created)'): Promise<string> => {
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
      sheets: [
        { properties: { title: 'Partner' } },
        { properties: { title: 'Contract' } },
        { properties: { title: 'Insertion_Order' } },
        { properties: { title: 'Amendment' } },
        { properties: { title: 'Notification_Log' } },
      ],
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || t('google_auth.create_sheet_failed', 'Gagal membuat Google Spreadsheet baru.'));
  }

  const data = await res.json();
  return data.spreadsheetId;
};

export const createNewDriveFolder = async (token: string, folderName: string = 'Storage Kontrak & IO 2026'): Promise<string> => {
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || t('google_auth.create_folder_failed', 'Gagal membuat Folder Google Drive baru.'));
  }

  const data = await res.json();
  return data.id;
};

// Background Token & Auth Session Auto-Refresh Worker
let isAutoRefreshInitialized = false;

export const initBackgroundGoogleTokenRefresh = () => {
  if (typeof window === 'undefined' || isAutoRefreshInitialized) return;
  isAutoRefreshInitialized = true;

  const checkAndRefreshToken = async () => {
    try {
      // Proactively refresh the Google OAuth token before it expires
      const hasToken = Boolean(localStorage.getItem('google_access_token'));
      const hasProfile = Boolean(localStorage.getItem('google_user_profile'));
      const remainingMinutes = getGoogleTokenRemainingMinutes();

      if (hasToken || hasProfile) {
        // If token will expire within 8 minutes, or is already expired/missing while profile exists
        if (remainingMinutes <= 8 || !isGoogleTokenValid()) {
          console.log('[GoogleAuth] Token Google hampir/sudah kedaluwarsa. Melakukan silent refresh otomatis...');
          await requestGoogleAccessToken(true);
        }
      }
    } catch (err) {
      console.warn('Background Auth session check warning:', err);
    }
  };

  // Run periodically every 45 seconds
  setInterval(checkAndRefreshToken, 45000);

  // Run when user returns to window/tab
  window.addEventListener('focus', checkAndRefreshToken);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkAndRefreshToken();
    }
  });

  // Run initial check
  checkAndRefreshToken();
};

// Automatically initialize background refresh
if (typeof window !== 'undefined') {
  initBackgroundGoogleTokenRefresh();
}
