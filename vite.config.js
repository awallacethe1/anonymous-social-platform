import { defineConfig } from 'vite';

// In development Vite serves the interface on :5173 and forwards API calls to the Node server on :8787.
const api = `http://localhost:${process.env.PORT || 8787}`;

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  server: {
    host: true,
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/uploads': { target: api, changeOrigin: false },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
