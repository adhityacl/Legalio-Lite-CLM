import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Split the console bundle so no chunk passes Vite's 500 kB warning.
 * Only leaf groups get their own chunk: node_modules, packages/shared and
 * packages/ui-components never import app code, and the i18n dictionaries are
 * plain data, so none of these chunks can import back into the entry (a cycle there is what once left React undefined).
 */
function manualChunks(id: string) {
  if (id.includes('node_modules')) {
    if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
    if (/node_modules\/(@ark-ui|@zag-js|@floating-ui|@internationalized)\//.test(id)) return 'ark';
    return 'vendor';
  }
  if (id.includes('/platform-console/src/i18n/') || id.includes('/shared/src/i18n/')) return 'i18n';
  // Shared domain data and the design system never import the console app either.
  if (id.includes('/packages/shared/src/')) return 'shared';
  if (id.includes('/packages/ui-components/src/')) return 'ui';
  return undefined;
}

export default defineConfig({
  root: 'console',
  base: '/sys/',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist/console', emptyOutDir: true, sourcemap: false, manifest: true, rollupOptions: { output: { manualChunks } } },
});
