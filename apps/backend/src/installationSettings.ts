import type Database from 'better-sqlite3';

let storedPublicUrl = '';

/** A website origin, including its scheme and optional public port. */
export function normalizePublicUrl(value: unknown): string {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) throw new Error('Enter the website URL, including http:// or https://.');
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a valid website URL, including http:// or https://.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use an http:// or https:// website URL without a path, query, or credentials.');
  }
  return url.origin;
}

export function getPublicBaseUrl(): string {
  const override = process.env.BETTER_AUTH_URL?.trim();
  return override ? normalizePublicUrl(override) : storedPublicUrl;
}

export function loadInstallationSettings(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS installation_settings (
    id TEXT PRIMARY KEY CHECK(id = 'installation'),
    publicUrl TEXT NOT NULL
  )`);
  const row = db.prepare("SELECT publicUrl FROM installation_settings WHERE id = 'installation'").get() as { publicUrl: string } | undefined;
  storedPublicUrl = row ? normalizePublicUrl(row.publicUrl) : '';
}

/** Called inside the first-superuser transaction; loading happens after commit. */
export function saveInstallationPublicUrl(db: Database.Database, publicUrl: string): void {
  db.prepare("INSERT INTO installation_settings (id, publicUrl) VALUES ('installation', ?)").run(normalizePublicUrl(publicUrl));
}
