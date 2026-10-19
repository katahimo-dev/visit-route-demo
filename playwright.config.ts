// e2e のランナー（@playwright/test。ADR-0029）。scripts/e2e-*.cjs を e2e/legacy.spec.ts から1本ずつ子のプロセスで走らせる。
// サイトは BASE があればそこを使い、無ければ webServer がビルドして vite preview で出す
import { defineConfig } from '@playwright/test';

const CI = !!process.env.CI;
const JST = 9 * 3600 * 1000;
/** 次の水曜（今日が水曜なら今日）の日本時間 12:00（scripts/lib/env.cjs と同じ） */
function nextWednesdayNoonJst(now: Date): Date {
  const j = new Date(now.getTime() + JST);
  const add = (3 - j.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() + add, 12) - JST);
}
// 「今日」をここで1回だけ決め、どの worker・スクリプトも同じ日にする（日付をまたいで走っても揃う）。空の文字も未設定と同じ
process.env.FAKE_NOW ||= nextWednesdayNoonJst(new Date()).toISOString();

const BASE = process.env.BASE || 'http://localhost:4183/';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: CI ? 3 : 4,
  retries: CI ? 1 : 0,
  forbidOnly: CI,
  // スクリプト1本が長い（1本で数十〜数百の確かめ）
  timeout: 10 * 60 * 1000,
  reporter: CI
    ? [['github'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: { baseURL: BASE },
  webServer: process.env.BASE
    ? undefined
    : {
        command: 'npm run build && npx vite preview --port 4183 --strictPort',
        url: 'http://localhost:4183/',
        reuseExistingServer: !CI,
        timeout: 180 * 1000,
      },
  projects: [
    { name: 'e2e', grepInvert: /@perf/ },
    // 速さの上限を見るものは1本ずつ（ほかと同時に走らせると遅れる）
    { name: 'perf', grep: /@perf/, workers: 1 },
  ],
});
