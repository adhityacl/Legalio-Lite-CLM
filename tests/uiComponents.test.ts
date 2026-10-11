/**
 * Guards for the Moduix migration: Alert indicators render a status icon by
 * default, and FileUpload hidden inputs keep zag's own id so the trigger can
 * open the native file picker.
 * Run: npx tsx --test tests/uiComponents.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Alert, AlertIndicator } from '@legalio/ui-components/alert';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const FILES = ['apps/frontend/src', 'packages/platform-console/src', 'apps/backend/console/src', 'packages/ui-components/src']
  .flatMap(sourceFiles)
  .map((path) => ({ path, text: readFileSync(path, 'utf8') }));

const iconFor = (status: 'info' | 'success' | 'warning' | 'error') =>
  renderToStaticMarkup(h(Alert, { status }, h(AlertIndicator)));

test('AlertIndicator renders a status icon when no children are given', () => {
  assert.match(iconFor('error'), /lucide-circle-alert/);
  assert.match(iconFor('warning'), /lucide-triangle-alert/);
  assert.match(iconFor('success'), /lucide-circle-check/);
  assert.match(iconFor('info'), /lucide-info/);
  assert.match(renderToStaticMarkup(h(Alert, null, h(AlertIndicator))), /lucide-info/);
});

test('AlertIndicator keeps explicit children instead of the default icon', () => {
  const html = renderToStaticMarkup(h(Alert, { status: 'error' }, h(AlertIndicator, null, h('i', { id: 'custom' }))));
  assert.match(html, /id="custom"/);
  assert.doesNotMatch(html, /lucide-circle-alert/);
});

test('FileUploadHiddenInput never overrides the zag-managed id', () => {
  const offenders = FILES.flatMap(({ path, text }) =>
    [...text.matchAll(/<FileUploadHiddenInput\b[^>]*\bid=/g)].map((m) => `${path}: ${m[0]}`));
  assert.deepEqual(offenders, []);
});

// zag lets a FileUploadTrigger sit inside the dropzone (it stops the click), but
// any other button or link nested in the role="button" dropzone is unreachable.
test('FileUploadDropzone holds no buttons or links other than its trigger', () => {
  const offenders = FILES.flatMap(({ path, text }) =>
    [...text.matchAll(/<FileUploadDropzone\b[^]*?<\/FileUploadDropzone>/g)]
      .map((m) => m[0].replace(/<FileUploadTrigger\b[^]*?<\/FileUploadTrigger>/g, ''))
      .filter((zone) => /<(Button|a)\b/.test(zone))
      .map(() => path));
  assert.deepEqual(offenders, []);
});
