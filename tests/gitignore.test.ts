import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('Git excludes local AI rules, secrets, waste and dumps while retaining source and examples', () => {
  const ignored = [
    '.agents/skills/ponytail/SKILL.md', '.codex/config.toml', '.mcp.json', 'GEMINI.md',
    'apps/frontend/AGENTS.md', '.github/instructions/frontend.instructions.md', '.cursorrules',
    '.aws/credentials', '.ssh/id_ed25519', 'apps/backend/.env', 'apps/frontend/.env.local',
    'secrets/api-token.txt', 'client.p12', 'id_rsa', 'google-service-account.json',
    '.npmrc', '.netrc', '.kube/config', 'terraform.tfstate.backup', 'google_service_account.json',
    'client_secret_google.json', 'apps/backend/oauth-client.json', 'token.json', 'api.secret',
    '.cache/trace.json', 'tmp/prompt.txt', 'apps/backend/tsconfig.tsbuildinfo', '.aider.chat.history.md',
    'docs/rbac/qc/live-qa-evidence.json', 'docs/rbac/generated/matrix.md',
    'dumps/customers.json', 'database.dump.sql', 'snapshot.sql.gz', 'auth.sqlite3-wal',
    '.migration/pre-monorepo/server.ts',
  ];
  const retained = [
    'apps/backend/.env.example', 'apps/frontend/.env.example', 'package.json', 'package-lock.json',
    'apps/backend/src/migrations/001_rbac_alignment.sql', 'packages/types/src/index.ts',
    '.github/workflows/ci.yml', 'docs/rbac/RBAC-Role-Permission-Matrix.csv',
    'scripts/get-superuser-token.mjs',
  ];
  const result = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    input: [...ignored, ...retained].join('\n') + '\n', encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(new Set(result.stdout.trim().split('\n')), new Set(ignored));
});
