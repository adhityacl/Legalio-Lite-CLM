#!/usr/bin/env node
/**
 * Creates `.env` from `.env.example` on first run and fills in a random `BETTER_AUTH_SECRET`,
 * so a fresh clone never boots with the example's placeholder value. Runs automatically after
 * `npm install` (see the `postinstall` script) and is safe to re-run: it never touches `.env`
 * once a real secret is set, so it won't clobber a value carried over from an old server during
 * a migration (see README → "Moving an existing installation to a new server").
 *
 * Hex, not base64 (openssl's usual suggestion): no `+`, `/` or `=` characters means the value
 * never needs quoting in `.env`, sidestepping the exact "quotes/commas break dotenv" class of
 * bug this project hit with a pasted service-account key.
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const ENV_PATH = new URL('../apps/backend/.env', import.meta.url);
const EXAMPLE_PATH = new URL('../apps/backend/.env.example', import.meta.url);
const PLACEHOLDER = 'replace-with-a-long-random-secret';

if (!existsSync(ENV_PATH)) {
  if (!existsSync(EXAMPLE_PATH)) {
    console.warn(`[setup-env] ${EXAMPLE_PATH} not found — skipping (nothing to copy from).`);
    process.exit(0);
  }
  copyFileSync(EXAMPLE_PATH, ENV_PATH);
  console.log(`[setup-env] Created ${ENV_PATH} from ${EXAMPLE_PATH}.`);
}

const content = readFileSync(ENV_PATH, 'utf8');
const match = content.match(/^BETTER_AUTH_SECRET=(.*)$/m);
const current = (match?.[1] ?? '').trim();

if (current && current !== PLACEHOLDER) {
  console.log('[setup-env] BETTER_AUTH_SECRET is already set — left unchanged.');
} else {
  const secret = randomBytes(32).toString('hex');
  const line = `BETTER_AUTH_SECRET=${secret}`;
  const next = match ? content.replace(/^BETTER_AUTH_SECRET=.*$/m, line) : `${content}\n${line}\n`;
  writeFileSync(ENV_PATH, next);
  console.log('[setup-env] Generated a random BETTER_AUTH_SECRET.');
}
