import { getGoogleDriveClient, loadServiceAccountCredentials } from './googleServiceAccountAuth';
import { drive as createDriveClient, drive_v3, auth as googleAuth } from 'googleapis/build/src/apis/drive';
import { Readable } from 'stream';

let onInvalidTokenCb: ((token: string) => void) | null = null;
export function setInvalidTokenCallback(cb: (token: string) => void) {
  onInvalidTokenCb = cb;
}

let refreshTokenGetter: (() => Promise<string | null>) | null = null;
export function setRefreshTokenGetter(getter: () => Promise<string | null>) {
  refreshTokenGetter = getter;
}

function handleTokenAuthError(token: string, err: any) {
  const msg = (err?.message || '').toLowerCase();
  const status = err?.status || err?.code || 0;
  if (
    status === 401 ||
    msg.includes('invalid authentication credentials') ||
    msg.includes('invalid_token') ||
    msg.includes('auth error') ||
    msg.includes('login cookie')
  ) {
    console.warn('[GoogleDrive] Token Google OAuth kedaluwarsa / tidak valid. Meminta sistem membersihkan token mati.');
    if (onInvalidTokenCb) {
      try {
        onInvalidTokenCb(token);
      } catch (cbErr) {
        console.warn('Error in invalid token callback:', cbErr);
      }
    }
  }
}

export function sanitizeParentFolderId(id?: string): string | undefined {
  if (!id) return undefined;
  const trimmed = id.trim();
  if (
    !trimmed ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed === '-' ||
    trimmed === 'undefined' ||
    trimmed === 'null' ||
    trimmed.startsWith('Folder_') ||
    trimmed.startsWith('org-') ||
    trimmed.startsWith('org_') ||
    trimmed.startsWith('tenant-')
  ) {
    return undefined;
  }
  if (
    trimmed === 'root' ||
    (/^[a-zA-Z0-9_-]{15,}$/.test(trimmed) &&
      !trimmed.startsWith('org-') &&
      !trimmed.startsWith('tenant-'))
  ) {
    return trimmed;
  }
  return undefined;
}

export function extractFolderIdFromLink(link?: string): string | undefined {
  if (!link) return undefined;
  if (link.includes('/folders/')) {
    const parts = link.split('/folders/');
    const folderId = parts[1]?.split('?')[0]?.trim();
    return sanitizeParentFolderId(folderId);
  }
  return undefined;
}

/**
 * Returns an authenticated Google Drive client:
 * 1. Using user OAuth accessToken (if provided)
 * 2. Or using Service Account credentials
 */
function getDriveClient(token?: string): drive_v3.Drive | null {
  if (token && token.trim() !== '') {
    try {
      const oauth2Client = new googleAuth.OAuth2();
      oauth2Client.setCredentials({ access_token: token.trim() });
      return createDriveClient({ version: 'v3', auth: oauth2Client });
    } catch (err) {
      console.warn('Failed initializing OAuth Drive client:', err);
    }
  }

  try {
    return getGoogleDriveClient();
  } catch (err) {
    console.warn('Failed initializing Service Account Drive client:', err);
    return null;
  }
}

export async function createDriveFolder(
  folderName: string,
  parentFolderId: string | undefined,
  token?: string
): Promise<string> {
  const result = await getOrCreateDriveFolder(folderName, parentFolderId, token);
  return result.webViewLink;
}

/**
 * Explicitly creates a new folder inside parentFolderId (bypassing name search if a fresh folder is requested)
 */
export async function createNewDriveFolderInParent(
  folderName: string,
  parentFolderId: string | undefined,
  token?: string
): Promise<{ id: string; webViewLink: string }> {
  let activeToken = token && token.trim() !== '' ? token.trim() : undefined;
  if (!activeToken && refreshTokenGetter) {
    try {
      const fresh = await refreshTokenGetter();
      if (fresh) activeToken = fresh.trim();
    } catch (_) {}
  }
  const cleanParentId = sanitizeParentFolderId(parentFolderId);

  if (activeToken) {
    try {
      const oauth2Client = new googleAuth.OAuth2();
      oauth2Client.setCredentials({ access_token: activeToken });
      const drive = createDriveClient({ version: 'v3', auth: oauth2Client });

      try {
        const createRes = await drive.files.create({
          requestBody: {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: cleanParentId ? [cleanParentId] : undefined,
          },
          supportsAllDrives: true,
          fields: 'id,webViewLink',
        });

        if (createRes.data.id) {
          return {
            id: createRes.data.id,
            webViewLink: createRes.data.webViewLink || `https://drive.google.com/drive/folders/${createRes.data.id}`,
          };
        }
      } catch (err: any) {
        handleTokenAuthError(activeToken, err);
        if (cleanParentId && (err?.message?.includes('File not found') || err?.status === 404 || err?.code === 404)) {
          const rootCreate = await drive.files.create({
            requestBody: {
              name: folderName,
              mimeType: 'application/vnd.google-apps.folder',
            },
            supportsAllDrives: true,
            fields: 'id,webViewLink',
          });
          if (rootCreate.data.id) {
            return {
              id: rootCreate.data.id,
              webViewLink: rootCreate.data.webViewLink || `https://drive.google.com/drive/folders/${rootCreate.data.id}`,
            };
          }
        } else {
          console.warn('createNewDriveFolderInParent OAuth failed:', err?.message);
        }
      }
    } catch (oauthErr: any) {
      console.warn('createNewDriveFolderInParent OAuth client error:', oauthErr?.message);
    }
  }

  // Try Service Account
  try {
    const drive = getGoogleDriveClient();
    if (drive) {
      try {
        const createRes = await drive.files.create({
          requestBody: {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: cleanParentId ? [cleanParentId] : undefined,
          },
          supportsAllDrives: true,
          fields: 'id,webViewLink',
        });

        if (createRes.data.id) {
          return {
            id: createRes.data.id,
            webViewLink: createRes.data.webViewLink || `https://drive.google.com/drive/folders/${createRes.data.id}`,
          };
        }
      } catch (saErr: any) {
        if (cleanParentId && (saErr?.message?.includes('File not found') || saErr?.status === 404 || saErr?.code === 404)) {
          const rootCreate = await drive.files.create({
            requestBody: {
              name: folderName,
              mimeType: 'application/vnd.google-apps.folder',
            },
            supportsAllDrives: true,
            fields: 'id,webViewLink',
          });
          if (rootCreate.data.id) {
            return {
              id: rootCreate.data.id,
              webViewLink: rootCreate.data.webViewLink || `https://drive.google.com/drive/folders/${rootCreate.data.id}`,
            };
          }
        } else {
          console.warn('createNewDriveFolderInParent Service Account failed:', saErr?.message);
        }
      }
    }
  } catch (saErr: any) {
    console.warn('createNewDriveFolderInParent SA error:', saErr?.message);
  }

  return getOrCreateDriveFolder(folderName, parentFolderId, token);
}

export async function getOrCreateDriveFolder(
  folderName: string,
  parentFolderId: string | undefined,
  token?: string
): Promise<{ id: string; webViewLink: string }> {
  const cleanParentId = sanitizeParentFolderId(parentFolderId);
  const escapedName = folderName.replace(/'/g, "\\'");

  const executeFolderOperation = async (driveClient: any, parentId?: string) => {
    const q = parentId
      ? `name = '${escapedName}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
      : `name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

    const listRes = await driveClient.files.list({
      q,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      fields: 'files(id,webViewLink)',
    });

    if (listRes.data.files && listRes.data.files.length > 0) {
      const file = listRes.data.files[0];
      return {
        id: file.id!,
        webViewLink: file.webViewLink || `https://drive.google.com/drive/folders/${file.id}`,
      };
    }

    const createRes = await driveClient.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentId ? [parentId] : undefined,
      },
      supportsAllDrives: true,
      fields: 'id,webViewLink',
    });

    if (createRes.data.id) {
      return {
        id: createRes.data.id,
        webViewLink: createRes.data.webViewLink || `https://drive.google.com/drive/folders/${createRes.data.id}`,
      };
    }
    return null;
  };

  // 1. Try with OAuth user token if available
  let activeToken = token && token.trim() !== '' ? token.trim() : undefined;
  if (!activeToken && refreshTokenGetter) {
    try {
      const fresh = await refreshTokenGetter();
      if (fresh) activeToken = fresh.trim();
    } catch (_) {}
  }

  if (activeToken && activeToken !== '') {
    try {
      const oauth2Client = new googleAuth.OAuth2();
      oauth2Client.setCredentials({ access_token: activeToken });
      const drive = createDriveClient({ version: 'v3', auth: oauth2Client });

      try {
        const res = await executeFolderOperation(drive, cleanParentId);
        if (res) return res;
      } catch (err: any) {
        handleTokenAuthError(activeToken, err);

        // If parent folder caused 404 / "File not found", retry without parent
        if (cleanParentId && (err?.message?.includes('File not found') || err?.status === 404 || err?.code === 404)) {
          try {
            const rootRes = await executeFolderOperation(drive, undefined);
            if (rootRes) return rootRes;
          } catch (_) {}
        } else {
          console.warn('OAuth Drive Folder creation/search warning:', err?.message);
        }

        // Self-healing retry if token was refreshed
        if (refreshTokenGetter) {
          try {
            const fresh = await refreshTokenGetter();
            if (fresh && fresh.trim() !== '' && fresh.trim() !== activeToken) {
              activeToken = fresh.trim();
              const retryOauth = new googleAuth.OAuth2();
              retryOauth.setCredentials({ access_token: activeToken });
              const retryDrive = createDriveClient({ version: 'v3', auth: retryOauth });
              const retryRes = (await executeFolderOperation(retryDrive, cleanParentId)) ||
                               (await executeFolderOperation(retryDrive, undefined));
              if (retryRes) return retryRes;
            }
          } catch (retryErr: any) {
            console.warn('[GoogleDrive] Folder retry with refreshed token failed:', retryErr?.message);
          }
        }
      }
    } catch (clientErr: any) {
      console.warn('OAuth drive client setup failed:', clientErr?.message);
    }
  }

  // 2. Try Service Account
  try {
    const drive = getGoogleDriveClient();
    if (drive) {
      try {
        const saRes = await executeFolderOperation(drive, cleanParentId);
        if (saRes) return saRes;
      } catch (err: any) {
        if (cleanParentId && (err?.message?.includes('File not found') || err?.status === 404 || err?.code === 404)) {
          try {
            const saRootRes = await executeFolderOperation(drive, undefined);
            if (saRootRes) return saRootRes;
          } catch (_) {}
        } else {
          console.warn('Service Account Drive Folder creation/search warning:', err?.message);
        }
      }
    }
  } catch (saErr: any) {
    console.warn('Service Account execution error:', saErr?.message);
  }

  return {
    id: `Folder_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    webViewLink: `https://drive.google.com/`,
  };
}

export async function uploadFileToDrive(
  fileName: string,
  base64Data: string,
  mimeType: string = 'application/pdf',
  parentFolderId: string | undefined,
  token?: string
): Promise<string | null> {
  const cleanBase64 = base64Data.includes('base64,') ? base64Data.split('base64,')[1] : base64Data;
  const buffer = Buffer.from(cleanBase64, 'base64');
  const cleanParentId = sanitizeParentFolderId(parentFolderId);

  // 1. Try with OAuth Token FIRST (uses user's Google Drive storage quota)
  let activeToken = token && token.trim() !== '' ? token.trim() : undefined;
  if (!activeToken && refreshTokenGetter) {
    try {
      const fresh = await refreshTokenGetter();
      if (fresh) activeToken = fresh.trim();
    } catch (_) {}
  }

  if (activeToken && activeToken !== '') {
    try {
      const oauth2Client = new googleAuth.OAuth2();
      oauth2Client.setCredentials({ access_token: activeToken });
      const drive = createDriveClient({ version: 'v3', auth: oauth2Client });

      const res = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: cleanParentId ? [cleanParentId] : undefined,
        },
        media: {
          mimeType: mimeType || 'application/pdf',
          body: Readable.from(buffer),
        },
        supportsAllDrives: true,
        fields: 'id,webViewLink',
      });

      if (res.data.id) {
        console.log(`[GoogleDrive] File '${fileName}' successfully uploaded via OAuth token. ID: ${res.data.id}`);
        return res.data.webViewLink || `https://drive.google.com/file/d/${res.data.id}/view`;
      }
    } catch (tokenErr: any) {
      handleTokenAuthError(activeToken, tokenErr);
      console.warn('[GoogleDrive] OAuth token upload error:', tokenErr.message);

      // Self-healing: if token expired / unauthorized and we have refreshTokenGetter, refresh and retry once
      if (refreshTokenGetter) {
        try {
          const refreshedToken = await refreshTokenGetter();
          if (refreshedToken && refreshedToken.trim() !== '' && refreshedToken.trim() !== activeToken) {
            console.log('[GoogleDrive] Auto-retrying upload with refreshed OAuth access token...');
            activeToken = refreshedToken.trim();
            const retryOauth = new googleAuth.OAuth2();
            retryOauth.setCredentials({ access_token: activeToken });
            const retryDrive = createDriveClient({ version: 'v3', auth: retryOauth });
            const retryRes = await retryDrive.files.create({
              requestBody: {
                name: fileName,
                parents: cleanParentId ? [cleanParentId] : undefined,
              },
              media: {
                mimeType: mimeType || 'application/pdf',
                body: Readable.from(buffer),
              },
              supportsAllDrives: true,
              fields: 'id,webViewLink',
            });
            if (retryRes.data.id) {
              console.log(`[GoogleDrive] File '${fileName}' successfully uploaded via refreshed OAuth token. ID: ${retryRes.data.id}`);
              return retryRes.data.webViewLink || `https://drive.google.com/file/d/${retryRes.data.id}/view`;
            }
          }
        } catch (retryErr: any) {
          console.warn('[GoogleDrive] Retry with refreshed token failed:', retryErr?.message);
        }
      }

      // If parents caused 404, retry upload without parent or in root
      if (cleanParentId && (tokenErr.message?.includes('File not found') || tokenErr.status === 404)) {
        try {
          const oauth2Client = new googleAuth.OAuth2();
          oauth2Client.setCredentials({ access_token: activeToken });
          const drive = createDriveClient({ version: 'v3', auth: oauth2Client });
          const fallbackRes = await drive.files.create({
            requestBody: { name: fileName },
            media: { mimeType: mimeType || 'application/pdf', body: Readable.from(buffer) },
            supportsAllDrives: true,
            fields: 'id,webViewLink',
          });
          if (fallbackRes.data.id) {
            return fallbackRes.data.webViewLink || `https://drive.google.com/file/d/${fallbackRes.data.id}/view`;
          }
        } catch (_) {}
      }
    }
  }

  // 2. Try Service Account (works on Shared Drives / Workspace Drives)
  try {
    const drive = getGoogleDriveClient();
    const res = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: cleanParentId ? [cleanParentId] : undefined,
      },
      media: {
        mimeType: mimeType || 'application/pdf',
        body: Readable.from(buffer),
      },
      supportsAllDrives: true,
      fields: 'id,webViewLink',
    });

    if (res.data.id) {
      console.log(`[GoogleDrive] File '${fileName}' successfully uploaded via Service Account. ID: ${res.data.id}`);
      return res.data.webViewLink || `https://drive.google.com/file/d/${res.data.id}/view`;
    }
  } catch (saErr: any) {
    if (cleanParentId && (saErr.message?.includes('File not found') || saErr.status === 404)) {
      try {
        const drive = getGoogleDriveClient();
        const fallbackRes = await drive.files.create({
          requestBody: {
            name: fileName,
          },
          media: {
            mimeType: mimeType || 'application/pdf',
            body: Readable.from(buffer),
          },
          supportsAllDrives: true,
          fields: 'id,webViewLink',
        });
        if (fallbackRes.data.id) {
          console.log(`[GoogleDrive] File '${fileName}' uploaded via Service Account (root fallback). ID: ${fallbackRes.data.id}`);
          return fallbackRes.data.webViewLink || `https://drive.google.com/file/d/${fallbackRes.data.id}/view`;
        }
      } catch (_) {}
    } else {
      console.warn('[GoogleDrive] Service Account upload warning:', saErr.message);
    }
  }

  return null;
}

/**
 * Traverses or creates nested folders level by level:
 * e.g., pathSegments = ['Acme Holdings', 'Example Supplier Ltd', 'Folder Contract']
 * starting inside `rootFolderId`.
 */
export async function getOrCreateHierarchicalFolder(
  pathSegments: string[],
  rootFolderId: string | undefined,
  token?: string
): Promise<{ id: string; webViewLink: string }> {
  let currentParentId = rootFolderId;
  let currentLink = '';

  for (const segment of pathSegments) {
    if (!segment || segment.trim() === '') continue;
    const cleanSegment = segment.trim();
    const folder = await getOrCreateDriveFolder(cleanSegment, currentParentId, token);
    currentParentId = folder.id;
    currentLink = folder.webViewLink;
  }

  return {
    id: currentParentId || rootFolderId || '',
    webViewLink: currentLink,
  };
}

/**
 * Creates a new Google Sheet file inside a specified Google Drive folder
 */
export async function createSpreadsheetInFolder(
  title: string,
  folderId: string | undefined,
  token?: string
): Promise<{ id: string; spreadsheetUrl: string }> {
  let activeToken = token && token.trim() !== '' ? token.trim() : undefined;
  if (!activeToken && refreshTokenGetter) {
    try {
      const fresh = await refreshTokenGetter();
      if (fresh) activeToken = fresh.trim();
    } catch (_) {}
  }

  const cleanParentId = sanitizeParentFolderId(folderId);

  // 1. Try with OAuth token
  if (activeToken) {
    try {
      const oauth2Client = new googleAuth.OAuth2();
      oauth2Client.setCredentials({ access_token: activeToken });
      const drive = createDriveClient({ version: 'v3', auth: oauth2Client });

      const createRes = await drive.files.create({
        requestBody: {
          name: title,
          mimeType: 'application/vnd.google-apps.spreadsheet',
          parents: cleanParentId ? [cleanParentId] : undefined,
        },
        supportsAllDrives: true,
        fields: 'id,webViewLink',
      });

      if (createRes.data.id) {
        return {
          id: createRes.data.id,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${createRes.data.id}/edit`,
        };
      }
    } catch (err: any) {
      if (cleanParentId && (err?.message?.includes('File not found') || err?.status === 404 || err?.code === 404)) {
        try {
          const oauth2Client = new googleAuth.OAuth2();
          oauth2Client.setCredentials({ access_token: activeToken });
          const drive = createDriveClient({ version: 'v3', auth: oauth2Client });
          const fallbackRes = await drive.files.create({
            requestBody: {
              name: title,
              mimeType: 'application/vnd.google-apps.spreadsheet',
            },
            supportsAllDrives: true,
            fields: 'id,webViewLink',
          });
          if (fallbackRes.data.id) {
            return {
              id: fallbackRes.data.id,
              spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${fallbackRes.data.id}/edit`,
            };
          }
        } catch (_) {}
      } else {
        console.warn('OAuth createSpreadsheetInFolder failed:', err.message);
      }
    }
  }

  // 2. Try Service Account
  try {
    const drive = getGoogleDriveClient();
    const createRes = await drive.files.create({
      requestBody: {
        name: title,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: cleanParentId ? [cleanParentId] : undefined,
      },
      supportsAllDrives: true,
      fields: 'id,webViewLink',
    });

    if (createRes.data.id) {
      return {
        id: createRes.data.id,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${createRes.data.id}/edit`,
      };
    }
  } catch (saErr: any) {
    if (cleanParentId && (saErr.message?.includes('File not found') || saErr.status === 404)) {
      try {
        const drive = getGoogleDriveClient();
        const fallbackRes = await drive.files.create({
          requestBody: {
            name: title,
            mimeType: 'application/vnd.google-apps.spreadsheet',
          },
          supportsAllDrives: true,
          fields: 'id,webViewLink',
        });
        if (fallbackRes.data.id) {
          return {
            id: fallbackRes.data.id,
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${fallbackRes.data.id}/edit`,
          };
        }
      } catch (_) {}
    } else {
      console.warn('Service Account createSpreadsheetInFolder failed:', saErr.message);
    }
  }

  throw new Error(`Failed to create spreadsheet '${title}' in folder ${folderId}`);
}

/**
 * Creates a new Google Docs document inside a specified Google Drive folder from HTML/Bilingual content
 */
export async function createGoogleDocInFolder(
  title: string,
  htmlContent: string,
  folderId: string | undefined,
  token?: string
): Promise<{ id: string; webViewLink: string; documentUrl: string }> {
  let activeToken = token && token.trim() !== '' ? token.trim() : undefined;
  if (!activeToken && refreshTokenGetter) {
    try {
      const fresh = await refreshTokenGetter();
      if (fresh) activeToken = fresh.trim();
    } catch (_) {}
  }

  const cleanParentId = sanitizeParentFolderId(folderId);

  // 1. Try with active OAuth token
  if (activeToken) {
    try {
      const oauth2Client = new googleAuth.OAuth2();
      oauth2Client.setCredentials({ access_token: activeToken });
      const drive = createDriveClient({ version: 'v3', auth: oauth2Client });

      const mediaStream = new Readable();
      mediaStream.push(htmlContent);
      mediaStream.push(null);

      const createRes = await drive.files.create({
        requestBody: {
          name: title,
          mimeType: 'application/vnd.google-apps.document',
          parents: cleanParentId ? [cleanParentId] : undefined,
        },
        media: {
          mimeType: 'text/html',
          body: mediaStream,
        },
        supportsAllDrives: true,
        fields: 'id,webViewLink',
      });

      if (createRes.data.id) {
        return {
          id: createRes.data.id,
          webViewLink: createRes.data.webViewLink || `https://docs.google.com/document/d/${createRes.data.id}/edit`,
          documentUrl: `https://docs.google.com/document/d/${createRes.data.id}/edit`,
        };
      }
    } catch (err: any) {
      console.warn('[createGoogleDocInFolder] OAuth error, trying fallback:', err?.message);
    }
  }

  // 2. Try with Service Account
  try {
    const drive = getGoogleDriveClient();
    const mediaStream = new Readable();
    mediaStream.push(htmlContent);
    mediaStream.push(null);

    const createRes = await drive.files.create({
      requestBody: {
        name: title,
        mimeType: 'application/vnd.google-apps.document',
        parents: cleanParentId ? [cleanParentId] : undefined,
      },
      media: {
        mimeType: 'text/html',
        body: mediaStream,
      },
      supportsAllDrives: true,
      fields: 'id,webViewLink',
    });

    if (createRes.data.id) {
      return {
        id: createRes.data.id,
        webViewLink: createRes.data.webViewLink || `https://docs.google.com/document/d/${createRes.data.id}/edit`,
        documentUrl: `https://docs.google.com/document/d/${createRes.data.id}/edit`,
      };
    }
  } catch (saErr: any) {
    console.warn('[createGoogleDocInFolder] Service account error:', saErr?.message);
  }

  throw new Error(`Gagal membuat dokumen Google Docs '${title}'`);
}

