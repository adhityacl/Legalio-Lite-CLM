import { drive, drive_v3, auth as googleAuth } from 'googleapis/build/src/apis/drive';
import { sheets, sheets_v4 } from 'googleapis/build/src/apis/sheets';
import fs from 'fs';
import path from 'path';
import { APP_DATA_DIR } from '../runtimePaths';

export interface ServiceAccountCredentials {
  type?: string;
  project_id?: string;
  private_key_id?: string;
  private_key?: string;
  client_email?: string;
  client_id?: string;
  auth_uri?: string;
  token_uri?: string;
  auth_provider_x509_cert_url?: string;
  client_x509_cert_url?: string;
  universe_domain?: string;
}

export const DEFAULT_SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive',
];

/**
 * Helper to safely parse a Service Account JSON string, base64 string, unescaped JSON, or file path.
 */
export function parseServiceAccountString(rawInput: string): ServiceAccountCredentials | null {
  if (!rawInput || typeof rawInput !== 'string') return null;
  let str = rawInput.trim();
  if (!str) return null;

  // 1. Check if it's a valid file path on disk
  if ((str.startsWith('/') || str.startsWith('./') || str.endsWith('.json')) && fs.existsSync(str)) {
    try {
      const content = fs.readFileSync(str, 'utf-8');
      const parsedFromFile = parseServiceAccountString(content);
      if (parsedFromFile) return parsedFromFile;
    } catch (_) {}
  }

  // 2. Remove surrounding outer quotes if wrapped in single quotes, double quotes, or backticks
  if (
    (str.startsWith("'") && str.endsWith("'")) ||
    (str.startsWith('"') && str.endsWith('"')) ||
    (str.startsWith('`') && str.endsWith('`'))
  ) {
    str = str.slice(1, -1).trim();
  }

  const validateObj = (obj: any): ServiceAccountCredentials | null => {
    if (!obj) return null;
    if (typeof obj === 'string') {
      return parseServiceAccountString(obj);
    }
    if (typeof obj === 'object' && !Array.isArray(obj)) {
      if (obj.client_email || obj.private_key || obj.project_id || obj.type === 'service_account') {
        return {
          ...obj,
          private_key: typeof obj.private_key === 'string' ? obj.private_key.replace(/\\n/g, '\n') : obj.private_key,
        };
      }
    }
    return null;
  };

  // Attempt A: Direct JSON parse
  try {
    const parsed = JSON.parse(str);
    const valid = validateObj(parsed);
    if (valid) return valid;
  } catch (_) {}

  // Attempt B: Base64 decode
  try {
    const decoded = Buffer.from(str, 'base64').toString('utf-8').trim();
    if (decoded && decoded !== str) {
      try {
        const parsed = JSON.parse(decoded);
        const valid = validateObj(parsed);
        if (valid) return valid;
      } catch (_) {}
    }
  } catch (_) {}

  // Attempt C: Replace escaped quotes and backslashes (e.g. \" to " or \\n to \n)
  try {
    const unescaped = str.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const parsed = JSON.parse(unescaped);
    const valid = validateObj(parsed);
    if (valid) return valid;
  } catch (_) {}

  // Attempt D: Extract object between first { and last }
  const firstBrace = str.indexOf('{');
  const lastBrace = str.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const subStr = str.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(subStr);
      const valid = validateObj(parsed);
      if (valid) return valid;
    } catch (_) {}
  }

  return null;
}

/**
 * Load and parse Google Service Account credentials.
 * Priority order:
 * 1. Provided parameter (Object, JSON string, or file path)
 * 2. JSON key uploaded in the app (see setStoredServiceAccountProvider)
 * 3. GOOGLE_APPLICATION_CREDENTIALS environment variable or credentials.json file
 * 4. GOOGLE_SERVICE_ACCOUNT_KEY environment variable (JSON or base64 string)
 * 5. Individual env vars (GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_PROJECT_ID)
 */
export function loadServiceAccountCredentials(
  param?: string | ServiceAccountCredentials | boolean,
  throwOnError: boolean = true
): ServiceAccountCredentials | null {
  let actualParam: string | ServiceAccountCredentials | undefined;
  let shouldThrow = throwOnError;

  if (typeof param === 'boolean') {
    shouldThrow = param;
    actualParam = undefined;
  } else {
    actualParam = param;
  }

  // Case 1: Parameter is an object
  if (typeof actualParam === 'object' && actualParam !== null) {
    if (actualParam.client_email && actualParam.private_key) {
      return {
        ...actualParam,
        private_key: actualParam.private_key.replace(/\\n/g, '\n'),
      };
    }
  }

  // Case 2: Parameter is a string (file path, raw JSON, base64)
  if (typeof actualParam === 'string' && actualParam.trim()) {
    const parsed = parseServiceAccountString(actualParam);
    if (parsed) return parsed;
  }

  const stored = storedServiceAccountProvider?.();
  if (stored?.client_email && stored.private_key) return stored;

  // Case 3: GOOGLE_APPLICATION_CREDENTIALS or default credentials.json in root
  const defaultCredentialsPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(APP_DATA_DIR, 'credentials.json');

  if (fs.existsSync(defaultCredentialsPath)) {
    try {
      const raw = fs.readFileSync(defaultCredentialsPath, 'utf-8');
      const parsed = parseServiceAccountString(raw);
      if (parsed) return parsed;
    } catch (_) {}
  }

  // Case 4: GOOGLE_SERVICE_ACCOUNT_KEY env var containing full JSON / base64 string
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    const parsed = parseServiceAccountString(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    if (parsed) return parsed;
  }

  // Case 5: Individual Environment Variables
  if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return {
      type: 'service_account',
      project_id: process.env.GOOGLE_PROJECT_ID || 'default-project',
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }

  if (shouldThrow) {
    throw new Error(
      'Konfigurasi Service Account tidak ditemukan! Harap sediakan credentials.json atau set environment variables (GOOGLE_SERVICE_ACCOUNT_KEY / GOOGLE_CLIENT_EMAIL & GOOGLE_PRIVATE_KEY).'
    );
  }

  return null;
}

let storedServiceAccountProvider: (() => ServiceAccountCredentials | null) | null = null;

/** Registers the source of a service-account key uploaded in the app; it takes priority over env/files. */
export function setStoredServiceAccountProvider(provider: () => ServiceAccountCredentials | null) {
  storedServiceAccountProvider = provider;
}

export function hasServiceAccountCredentials(): boolean {
  return loadServiceAccountCredentials(undefined, false) !== null;
}

/**
 * Creates an authenticated JWT client for Google APIs using Service Account credentials.
 */
export function getGoogleAuthClient(
  credentialsInput?: string | ServiceAccountCredentials,
  scopes: string[] = DEFAULT_SHEETS_SCOPES
) {
  const creds = loadServiceAccountCredentials(credentialsInput);

  if (!creds.client_email || !creds.private_key) {
    throw new Error('Konfigurasi Service Account tidak memiliki client_email atau private_key yang valid.');
  }

  const jwtClient = new googleAuth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes,
  });

  return jwtClient;
}

/**
 * Get an authenticated Google Sheets API client (sheets_v4.Sheets).
 */
export function getGoogleSheetsClient(
  credentialsInput?: string | ServiceAccountCredentials,
  scopes: string[] = DEFAULT_SHEETS_SCOPES
): sheets_v4.Sheets {
  const auth = getGoogleAuthClient(credentialsInput, scopes);
  return sheets({ version: 'v4', auth });
}

/**
 * Get an authenticated Google Drive API client (drive_v3.Drive).
 */
export function getGoogleDriveClient(
  credentialsInput?: string | ServiceAccountCredentials,
  scopes: string[] = DEFAULT_SHEETS_SCOPES
): drive_v3.Drive {
  const auth = getGoogleAuthClient(credentialsInput, scopes);
  return drive({ version: 'v3', auth });
}

/**
 * Helper: Read values from a Google Sheet range
 */
export async function readSheetValues(
  spreadsheetId: string,
  range: string,
  credentialsInput?: string | ServiceAccountCredentials
): Promise<any[][]> {
  const sheets = getGoogleSheetsClient(credentialsInput);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });
  return response.data.values || [];
}

/**
 * Helper: Write / Update values in a Google Sheet range
 */
export async function updateSheetValues(
  spreadsheetId: string,
  range: string,
  values: any[][],
  credentialsInput?: string | ServiceAccountCredentials
) {
  const sheets = getGoogleSheetsClient(credentialsInput);
  const response = await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
  return response.data;
}

/**
 * Helper: Append rows to a Google Sheet
 */
export async function appendSheetValues(
  spreadsheetId: string,
  range: string,
  values: any[][],
  credentialsInput?: string | ServiceAccountCredentials
) {
  const sheets = getGoogleSheetsClient(credentialsInput);
  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
  return response.data;
}

/**
 * Helper: Get Spreadsheet details (sheet titles, grid size)
 */
export async function getSpreadsheetDetails(
  spreadsheetId: string,
  credentialsInput?: string | ServiceAccountCredentials
) {
  const sheets = getGoogleSheetsClient(credentialsInput);
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
  });
  return response.data;
}
