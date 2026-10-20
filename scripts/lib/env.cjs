// e2e の共通：Playwright の読み込み・環境変数・ページの時計・結果の数え方・終わり方。
// scripts/e2e-*.cjs が require する。単独で `node scripts/e2e-xxx.cjs` でも、
// @playwright/test の包み（e2e/legacy.spec.ts）から同じプロセスで段（steps）を呼んでも同じに動く（ADR-0041）。
// 包みからは hooks で、確かめの写し先（expect.soft）・動画の置き場所を差し込む。
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
//   E2E_SCRIPT … スクリプトの名前（e2e-home など）。包みが同じプロセスで読むときに渡す（既定：走らせたファイルの名前）
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { skipTour } = require('./tourSeen.cjs');

/** 走らせたスクリプトの名前（e2e-home など） */
const SCRIPT = process.env.E2E_SCRIPT || path.basename(require.main?.filename ?? 'e2e', '.cjs');
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

/**
 * 包み（e2e/legacy.spec.ts）が差し込むもの。単独の実行では使わない
 *   onCheck(ok, name, info) … 確かめを1つずつ受ける（expect.soft に写す）
 *   videoDir … 文脈の動画の置き場所（あれば newContext・newPage に recordVideo を足す）
 */
const hooks = { onCheck: null, videoDir: '' };

/** 開いたブラウザ（終わりに closeBrowsers でまとめて閉じる。途中で止まっても残さない） */
const browsers = new Set();
/**
 * ページの中のタイマー（setTimeout）を期限つきで数える。settle が「描き直し・遅らせた処理（入力の間引き・保存・
 * 吹き出しの出し入れ）が終わった」を待つのに使う。page.clock はあとから window.setTimeout を差し替えるので、
 * 差し替えを受け取る形（getter・setter）にして、アプリが呼ぶ setTimeout をいつもこの包みに通す
 */
function trackTimers() {
  /** id → 期限（performance.now） */
  const due = new Map();
  window.__e2eTimers = due;
  const wrap = (name, make) => {
    let inner = window[name];
    let outer = make(inner);
    Object.defineProperty(window, name, {
      configurable: true,
      get: () => outer,
      set: (f) => {
        inner = f;
        outer = make(f);
      },
    });
  };
  wrap(
    'setTimeout',
    (st) =>
      function (fn, ms, ...args) {
        const id = st.call(
          this,
          (...a) => {
            due.delete(id);
            if (typeof fn === 'function') fn(...a);
          },
          ms,
          ...args,
        );
        due.set(id, performance.now() + (Number(ms) || 0));
        return id;
      },
  );
  wrap(
    'clearTimeout',
    (ct) =>
      function (id) {
        due.delete(id);
        return ct.call(this, id);
      },
  );
}

/**
 * 文脈を開くときに、タイマーの数え（trackTimers）と、動画の置き場所があれば recordVideo を足す
 */
function instrument(b) {
  const add = (o = {}) => (hooks.videoDir && !o.recordVideo ? { ...o, recordVideo: { dir: hooks.videoDir } } : o);
  const newContext = b.newContext.bind(b);
  const newPage = b.newPage.bind(b);
  b.newContext = async (o) => {
    const ctx = await newContext(add(o));
    await ctx.addInitScript(trackTimers);
    return ctx;
  };
  b.newPage = async (o) => {
    const page = await newPage(add(o));
    await page.context().addInitScript(trackTimers);
    return page;
  };
  return b;
}
/** Chromium を開く（CHROMIUM があればその実行ファイル） */
async function launch() {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  browsers.add(b);
  b.on('disconnected', () => browsers.delete(b));
  return instrument(b);
}
/** 開いたままのブラウザを全部閉じる */
async function closeBrowsers() {
  await Promise.all([...browsers].map((b) => b.close().catch(() => {})));
  browsers.clear();
}

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
/** 1つの確かめの結果を `OK  ` か `NG  ` の行で出す。包みからは hooks.onCheck にも渡す（expect.soft） */
function check(ok, name, info = '') {
  if (!ok) fails++;
  const text = info === '' ? '' : typeof info === 'string' ? info : JSON.stringify(info);
  console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${text === '' ? '' : `  ${text}`}`);
  hooks.onCheck?.(!!ok, name, text);
}

/** ページのエラー（pageerror）。watchErrors で集め、終わりに失敗に数える */
const pageErrors = [];
/** ページのエラーを pageErrors に集める（log なら `ERR` の行も出す） */
function watchErrors(page, { log = true } = {}) {
  page.on('pageerror', (e) => {
    pageErrors.push(String(e));
    if (log) console.log('ERR', String(e));
  });
  return pageErrors;
}

/**
 * fn() が真になるまで待って、最後の値を返す（web-first の待ち。固定の waitForTimeout の代わり）。
 * ms を過ぎたら最後の値をそのまま返す（偽のまま。check で NG になる）。投げたら偽として待ち続ける
 */
async function until(fn, ms = 5000, every = 50) {
  const end = Date.now() + ms;
  for (;;) {
    let v;
    try {
      v = await fn();
    } catch {
      v = undefined;
    }
    if (v || Date.now() >= end) return v;
    await new Promise((r) => setTimeout(r, every));
  }
}

/** settle が待つタイマーの期限の先（これより先に来るタイマー＝知らせを消す・先読みなどは待たない） */
const SETTLE_HORIZON_MS = 1000;
/** DOM が変わらないまま続けば落ち着いたとみる長さ */
const SETTLE_QUIET_MS = 50;

/** ページの中で、落ち着くまで待つ（最長 maxMs）。待てたら true */
function waitQuiet([maxMs, quietMs, horizonMs]) {
  return new Promise((resolve) => {
    const start = performance.now();
    let last = start;
    const mo = new MutationObserver(() => {
      last = performance.now();
    });
    mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    const busy = (now) => {
      const due = window.__e2eTimers;
      if (!due) return false;
      for (const t of due.values()) if (t - now <= horizonMs) return true;
      return false;
    };
    const tick = () => {
      const now = performance.now();
      const quiet = now - last >= quietMs && !busy(now);
      if (quiet || now - start >= maxMs) {
        mo.disconnect();
        resolve(quiet);
      } else setTimeout(tick, 20);
    };
    // 2回の描画を待つ。裏のタブ（別のタブを開いたあと）では描画が来ないので 100ms で先へ進む
    let started = false;
    const go = () => {
      if (started) return;
      started = true;
      setTimeout(tick, 0);
    };
    requestAnimationFrame(() => requestAnimationFrame(go));
    setTimeout(go, 100);
  });
}

/**
 * 押したあとの描き直しを待つ（web-first の待ち。ADR-0041）：2回の描画のあと、DOM の変化が続けて SETTLE_QUIET_MS 無く、
 * 期限の近いタイマー（入力の間引き・保存・吹き出しの出し入れ・作り直しの帯の数え直し）が残っていないこと。
 * ms は前の固定の待ちの長さ：最長は max(3×ms, 1500ms)。ページが移っている最中なら読み込みを待ってもう1回。
 * Worker の計算（AI案を作る）は待たないので、その所は目印（locator.waitFor・until）で待つ。
 * E2E_SETTLE_LOG=1 なら最長まで待った所を出す（固定の待ちのままがよい所を探す）
 */
async function settle(page, ms = 250) {
  const maxMs = Math.max(3 * ms, 1500);
  const t0 = Date.now();
  for (let i = 0; i < 2; i++) {
    try {
      // ページの中のタイマーが止められていても（ダイアログ・裏のタブ）、こちらの時計で最長＋2秒で先へ進む
      const ok = await withTimeout(
        page.evaluate(waitQuiet, [maxMs, SETTLE_QUIET_MS, SETTLE_HORIZON_MS]),
        maxMs + 2000,
        'settle',
      ).catch((e) => {
        if (String(e).includes('固まった：settle')) return false;
        throw e;
      });
      if (!ok && process.env.E2E_SETTLE_LOG) console.log(`（settle ${ms}ms：${maxMs}ms 待っても落ち着かない）`);
      if (process.env.E2E_SETTLE_LOG === '2') console.log(`（settle ${ms}ms → ${Date.now() - t0}ms）`);
      return;
    } catch {
      // 移っている最中（文脈が消えた）：読み込みを待ってもう1回
      await page.waitForLoadState('load').catch(() => {});
    }
  }
  await page.waitForTimeout(ms).catch(() => {});
}

const withTimeout = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`固まった：${what}`)), ms))]);
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
function finish(errors = pageErrors) {
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

/**
 * 段（[名前, 関数] の並び）を順に走らせて finish する（単独の実行。`if (require.main === module) runSteps(steps)`）。
 * 段が投げたら（準備の失敗など）1 で終える。包みは同じ段を test.step で回す
 */
async function runSteps(steps) {
  try {
    for (const [, fn] of steps) await fn();
  } catch (e) {
    console.error(e);
    await closeBrowsers();
    process.exit(1);
  }
  await closeBrowsers();
  finish(pageErrors);
}

module.exports = {
  SCRIPT,
  NAME,
  loadPlaywright,
  chromium,
  hooks,
  launch,
  closeBrowsers,
  BASE,
  OUT_DIR,
  JST,
  nextWednesdayNoonJst,
  NOW,
  TODAY,
  perfMs,
  STORAGE_KEY,
  check,
  pageErrors,
  watchErrors,
  until,
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
  runSteps,
};
