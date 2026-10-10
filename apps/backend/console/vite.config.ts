import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'console',
  base: '/sys/',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist/console', emptyOutDir: true, sourcemap: false, manifest: true },
});
