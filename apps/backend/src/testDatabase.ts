/** Tests only: a throwaway `legalio_test_*` database on the server named by TEST_DATABASE_URL. */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { connect, end } from './db';

const ADMIN_URL = process.env.TEST_DATABASE_URL || 'postgres://legalio:legalio@127.0.0.1:5432/legalio';

async function admin(statement: string) {
  const client = new pg.Client(ADMIN_URL);
  await client.connect();
  try { await client.query(statement); } finally { await client.end(); }
}

/** Creates the database and connects the app pool to it; `drop()` disconnects and removes it. */
export async function createTestDatabase() {
  const name = `legalio_test_${randomBytes(6).toString('hex')}`;
  await admin(`CREATE DATABASE ${name}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  connect({ connectionString: url.href });
  return {
    name,
    url: url.href,
    drop: async () => { await end(); await admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); },
  };
}
