// e2e の共通：Playwright の読み込み・環境変数・ページの時計・結果の数え方・終わり方。
// scripts/e2e-*.cjs が require する。単独で `node scripts/e2e-xxx.cjs` でも、
// @playwright/test の包み（e2e/legacy.spec.ts）から子のプロセスで呼んでも同じに動く。
//
// 環境変数：
//   PLAYWRIGHT … Playwright のモジュールの場所（既定：require('playwright')、無ければ /opt/node22/lib/node_modules/playwright）
//   CHROMIUM   … Chromium の実行ファイル（既定：Playwright の既定の場所）
//   BASE       … 開くサイト（既定：http://localhost:4183/）
//   OUT_DIR    … スクリーンショットの置き場所（既定：OS の一時フォルダの e2e-<名前>）
//   FAKE_NOW   … ページの時計をこの時刻に止める（ISO 8601。例 2026-10-21T12:00:00+09:00）。既定は、実行した日から見て
//                次の水曜（今日が水曜なら今日）の日本時間 12:00。アプリは「今日」を日本時間で決め、今日より前の訪問は動かせないので、
//                週の途中に止めて今週に今日より後の日を残す（日曜に実行すると今週に動かし先が無くなるため）
//   PERF_MS_<名前> … 速さの上限（ミリ秒）。スクリプトごとに既定が違う。無ければ PERF_MS を使う（前からの名前）
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { skipTour } = require('./tourSeen.cjs');

/** 走らせたスクリプトの名前（e2e-home など） */
const SCRIPT = path.basename(require.main?.filename ?? 'e2e', '.cjs');
/** 失敗のスクリーンショットの頭に付ける短い名前（home など） */
const NAME = SCRIPT.replace(/^e2e-/, '');

function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean);
  for (const p of tries) {
    try {
      return require(p);
    } catch {
      // 次の候補へ
    }
  }
  throw new Error(`Playwright が見つかりません（試した場所：${tries.join('、')}）。PLAYWRIGHT で場所を渡してください`);
}

const { chromium } = loadPlaywright();
/** Chromium を開く（CHROMIUM があればその実行ファイル） */
const launch = () => chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});

const BASE = process.env.BASE || 'http://localhost:4183/';
const OUT_DIR = process.env.OUT_DIR || path.join(os.tmpdir(), SCRIPT);
fs.mkdirSync(OUT_DIR, { recursive: true });

const JST = 9 * 3600 * 1000;
/** 次の水曜（今日が水曜なら今日）の日本時間 12:00（playwright.config.ts にも同じものを置く） */
function nextWednesdayNoonJst(now) {
  const j = new Date(now.getTime() + JST);
  const add = (3 - j.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() + add, 12) - JST);
}
const NOW = process.env.FAKE_NOW ? new Date(process.env.FAKE_NOW) : nextWednesdayNoonJst(new Date());
if (Number.isNaN(NOW.getTime())) throw new Error(`FAKE_NOW が日時として読めません：${process.env.FAKE_NOW}`);
/** テストの「今日」（アプリと同じく日本時間で決める。YYYY-MM-DD） */
const TODAY = new Date(NOW.getTime() + JST).toISOString().slice(0, 10);

/** 速さの上限（ミリ秒）。PERF_MS_<名前> → PERF_MS → 既定 の順 */
const perfMs = (name, def) => Number(process.env[name] || process.env.PERF_MS || def);

const STORAGE_KEY = 'vrdemo:data:v1';

let fails = 0;
/** 1つの確かめの結果を `OK  ` か `NG  ` の行で出す（包みはこの頭で通らないものを数える） */
function check(ok, name, info = '') {
  if (!ok) fails++;
  console.log(
    `${ok ? 'OK  ' : 'NG  '} ${name}${info === '' ? '' : `  ${typeof info === 'string' ? info : JSON.stringify(info)}`}`,
  );
}

const withTimeout = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`固まった：${what}`)), ms))]);
/** 押したあとの描き直しを待つ */
const settle = (page, ms = 250) => page.waitForTimeout(ms);
const hashOf = (page) => decodeURIComponent(new URL(page.url()).hash);
const urlOf = (page) => decodeURIComponent(page.url());
const isFocused = (loc) => loc.evaluate((el) => document.activeElement === el);
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), STORAGE_KEY);

/**
 * 速さを測る文脈（ページの時計を止めない）で fn(page) を走らせ、終わったら閉じる。
 * page.clock.setFixedTime は Date だけでなく requestAnimationFrame・performance.now も差し替えるので、
 * 「押してから描き終わるまで」を rAF で待つ測り方では本物の描画を待たなくなる。ページのエラーは errors に入れる
 */
async function withRealClock(browser, errors, fn, viewport = { width: 1400, height: 1000 }) {
  const ctx = await browser.newContext({ viewport });
  await skipTour(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    return await fn(page);
  } finally {
    await ctx.close();
  }
}

/** 止まったときのスクリーンショット（<名前>-fail-<段階>.png。OUT_DIR を共有してもぶつからない） */
const failShot = (page, step) =>
  page.screenshot({ path: path.join(OUT_DIR, `${NAME}-fail-${step}.png`) }).catch(() => {});

/** 結果をまとめて終える。通らないものかページのエラー（errors）があれば終了コード 1 */
function finish(errors = []) {
  console.log(`スクリーンショット：${OUT_DIR}`);
  const ng = fails + errors.length;
  console.log(ng === 0 ? '全部通った' : `${fails} 件が通らない・ページのエラー ${errors.length} 件`);
  process.exit(ng === 0 ? 0 : 1);
}

/** main を走らせて finish する。main はページのエラーの配列を返せる（check で数えた分は返さない）。投げたら 1 で終える */
function run(main) {
  main().then(
    (errors) => finish(errors),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}

module.exports = {
  SCRIPT,
  NAME,
  loadPlaywright,
  chromium,
  launch,
  BASE,
  OUT_DIR,
  JST,
  nextWednesdayNoonJst,
  NOW,
  TODAY,
  perfMs,
  STORAGE_KEY,
  check,
  withTimeout,
  settle,
  hashOf,
  urlOf,
  isFocused,
  stored,
  withRealClock,
  failShot,
  finish,
  run,
};
