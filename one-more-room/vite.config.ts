import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` lets the built game run from any sub-path, including
// /The_Town/one-more-room/ on GitHub Pages.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1600 },
  test: { include: ['tests/**/*.test.ts'] },
} as never);
