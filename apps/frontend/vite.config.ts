import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import viteCompression from 'vite-plugin-compression';

export default defineConfig(() => {
  return {
    // Audit workspaces may symlink node_modules. Keep optimizer output local so
    // another Vite server cannot replace an active editor's dependency chunks.
    cacheDir: path.resolve(__dirname, '.vite'),
    plugins: [
      react({ exclude: /(?:^|[/\\])(?:node_modules|\.vite)(?:[/\\]|$)/ }),
      tailwindcss(),
      viteCompression({ algorithm: 'gzip', ext: '.gz' }),
      viteCompression({ algorithm: 'brotliCompress', ext: '.br' })
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    optimizeDeps: {
      // These lazy editor entries must share the same CellSelection registry.
      include: ['@tiptap/extension-table', '@tiptap/pm/tables', '@tiptap/react/menus'],
    },
    // No manualChunks: splitting vendors by substring ("react" in the path →
    // react-vendor, everything else → vendor) put react-dom's `scheduler` dependency
    // in the other chunk, making the two import each other; in production one side
    // then saw React as undefined and the page rendered blank. Vite's own chunking
    // plus the React.lazy route splits already keep heavy libraries out of the entry.
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 800,
    },

    server: {
      allowedHosts: true as true,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        // Containers and WSL bind mounts often drop file-change events, which leaves
        // the dev server serving stale modules; polling keeps edits visible.
        usePolling: true,
        interval: 300,
        // Runtime files the backend writes into APP_DATA_DIR (the repository in dev) are not source code.
        ignored: ['**/database.json', '**/drive-backup.json'],
      },
      // Only used when Vite runs as its own dev server (`npm run
      // dev:frontend`, backend on its own process via `npm run
      // dev:backend`). When `npm run dev` runs the combined single-process
      // setup instead, Express already handles /api and /uploads itself
      // before a request ever reaches Vite's middleware, so this proxy is
      // simply never consulted — safe to always define.
      proxy: {
        '/sys': `http://localhost:${process.env.PORT || 3000}`,
        '/api': `http://localhost:${process.env.PORT || 3000}`,
        '/uploads': `http://localhost:${process.env.PORT || 3000}`,
      },
    },
  };
});
