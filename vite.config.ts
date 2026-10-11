/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// GitHub Pages のサブパス（/visit-route-demo/）でも動くよう相対パス。画面の移動は HashRouter
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  test: { include: ['src/**/*.test.ts'] },
});
