/// <reference types="vitest/config" />

import { execSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const version = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
})();

// GitHub Pages のサブパス（/visit-route-demo/）でも動くよう相対パス。画面の移動は HashRouter
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  // 公開リポジトリなのでソースマップも出す（エラーの場所を元のコードで追うため）
  build: { sourcemap: true },
  define: { __APP_VERSION__: JSON.stringify(version) },
  test: { include: ['src/**/*.test.ts'] },
});
