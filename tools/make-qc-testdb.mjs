import { DatabaseSync } from 'node:sqlite';
import { rmSync } from 'node:fs';

const path = process.argv[2] ?? 'qc-output/_qc-live-test/auth.db';
rmSync(path, { force: true });
const db = new DatabaseSync(path);
db.exec(`
CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT, role TEXT, banned INTEGER DEFAULT 0);
CREATE TABLE session (id TEXT PRIMARY KEY, token TEXT, userId TEXT, expiresAt TEXT);
`);
const users = [
  ['U-SUPER', 'super@example.test', 'superuser', 0],
  ['U-ADMIN', 'admin@example.test', 'admin', 0],
  ['U-MANAGER', 'manager@example.test', 'manager', 0],
  ['U-EDITOR', 'editor@example.test', 'editor', 0],
  ['U-VIEWER', 'viewer@example.test', 'viewer', 0],
  ['U-BANNED', 'banned@example.test', 'viewer', 1],
];
const iu = db.prepare('INSERT INTO user (id,email,role,banned) VALUES (?,?,?,?)');
for (const u of users) iu.run(...u);
db.prepare('INSERT INTO session (id,token,userId,expiresAt) VALUES (?,?,?,?)')
  .run('S1', 'SUPER-TOKEN', 'U-SUPER', '2030-01-01T00:00:00.000Z');
db.close();
console.log('DB uji dibuat:', path);
