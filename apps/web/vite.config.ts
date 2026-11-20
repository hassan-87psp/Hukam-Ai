import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const relay = process.env.RELAY_URL ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: relay, changeOrigin: false },
      '/ws': { target: relay.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'] } },
    },
  },
});
