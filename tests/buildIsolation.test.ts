import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

// Exercise the real build scripts/config with tiny inputs, never the workspace dist/.
test('independent builds preserve each other and keep backend source outside the static root', { timeout: 60_000 }, () => {
  const root = resolve('.');
  const dir = mkdtempSync(join(tmpdir(), 'legalio-build-'));
  try {
    copyFileSync(join(root, 'package.json'), join(dir, 'package.json'));
    for (const app of ['backend', 'frontend']) {
      mkdirSync(join(dir, `apps/${app}/src`), { recursive: true });
      copyFileSync(join(root, `apps/${app}/package.json`), join(dir, `apps/${app}/package.json`));
    }
    copyFileSync(join(root, 'apps/frontend/vite.config.ts'), join(dir, 'apps/frontend/vite.config.ts'));
    mkdirSync(join(dir, 'apps/backend/console'), { recursive: true });
    copyFileSync(join(root, 'apps/backend/console/vite.config.ts'), join(dir, 'apps/backend/console/vite.config.ts'));
    writeFileSync(join(dir, 'apps/backend/console/index.html'), '<h1>System Console fixture</h1>');
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
    writeFileSync(join(dir, 'apps/backend/src/server.ts'), 'console.log("backend fixture");\n');
    writeFileSync(join(dir, 'apps/frontend/index.html'), '<h1>Frontend fixture</h1>');
    const run = (script: string) => execFileSync('npm', ['run', script], { cwd: dir, timeout: 25_000, stdio: 'pipe' });
    run('build:backend');
    const consoleHtml = readFileSync(join(dir, 'apps/backend/dist/console/index.html'));
    const backend = join(dir, 'apps/backend/dist/server.cjs');
    assert.ok(existsSync(backend), 'backend must have its own output directory');
    const bundle = readFileSync(backend);
    const map = readFileSync(`${backend}.map`);
    const stale = join(dir, 'apps/backend/dist/console/stale.js');
    writeFileSync(stale, 'old console asset');
    run('build:sys');
    assert.ok(!existsSync(stale), 'console rebuilds remove obsolete assets');
    assert.deepEqual(readFileSync(backend), bundle, 'console builds preserve the server');
    assert.deepEqual(readFileSync(`${backend}.map`), map);
    run('build:frontend');
    assert.deepEqual(readFileSync(backend), bundle);
    assert.deepEqual(readFileSync(`${backend}.map`), map);
    const frontend = join(dir, 'apps/frontend/dist/index.html');
    const html = readFileSync(frontend);
    run('build:backend');
    assert.deepEqual(readFileSync(frontend), html);
    run('build:frontend');
    assert.deepEqual(readFileSync(backend), bundle);
    assert.ok(!readdirSync(join(dir, 'apps/frontend/dist'), { recursive: true }).some((name) => /\.cjs(?:\.map)?$/.test(String(name))));
    assert.deepEqual(readFileSync(join(dir, 'apps/backend/dist/console/index.html')), consoleHtml);
    assert.ok(!readdirSync(join(dir, 'apps/backend/dist/console'), { recursive: true }).some((name) => /\.cjs(?:\.map)?$/.test(String(name))), 'console static root must not expose the server bundle');
    assert.match(execFileSync('npm', ['start'], { cwd: dir, timeout: 10_000, encoding: 'utf8' }), /backend fixture/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Turborepo invalidates dependent app builds for shared source changes', () => {
  const root = resolve('.');
  const dir = mkdtempSync(join(tmpdir(), 'legalio-cache-'));
  try {
    for (const name of ['package.json', 'package-lock.json', 'turbo.json']) copyFileSync(join(root, name), join(dir, name));
    for (const workspace of ['apps/backend', 'apps/frontend', 'packages/platform-console', 'packages/types', 'packages/shared', 'packages/ui-components', 'packages/ts-config']) {
      mkdirSync(join(dir, workspace, 'src'), { recursive: true });
      copyFileSync(join(root, workspace, 'package.json'), join(dir, workspace, 'package.json'));
      writeFileSync(join(dir, workspace, 'src/index.ts'), 'export const fixture = 1;\n');
    }
    const hashes = () => {
      const dry = JSON.parse(execFileSync(join(root, 'node_modules/.bin/turbo'), ['run', 'build', '--dry=json'], { cwd: dir, timeout: 15_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
      return Object.fromEntries(dry.tasks.filter((task: any) => task.package === '@legalio/frontend' || task.package === '@legalio/backend').map((task: any) => [task.package, task.hash]));
    };
    const before = hashes();
    writeFileSync(join(dir, 'packages/ui-components/src/index.ts'), 'export const fixture = 2;\n');
    const ui = hashes();
    assert.notEqual(ui['@legalio/frontend'], before['@legalio/frontend'], 'UI changes invalidate the frontend');
    assert.notEqual(ui['@legalio/backend'], before['@legalio/backend'], 'UI changes invalidate the backend console');
    writeFileSync(join(dir, 'packages/types/src/index.ts'), 'export const fixture = 3;\n');
    const types = hashes();
    for (const app of ['@legalio/frontend', '@legalio/backend']) assert.notEqual(types[app], ui[app], 'contract changes invalidate both apps');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
