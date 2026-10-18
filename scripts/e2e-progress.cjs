// 予定（月・週・日）に共通の進み具合の帯（PRD D151〜D155。ADR-0025 追記）を本物のブラウザで確かめる：
// 月・週・日の上に同じ帯（data-ym・数字が3画面で同じ・ホームの確定していない日とも同じ）、月の画面の「まとめて作る」の入口は帯の1か所
// （見出しのボタン・今月の準備は無い。帯の次の一手が主ボタン）、帯の数字・ボタンで月の画面の欄が開き ?do= が消える
// （週・日から：まとめて作る・確定していない日・要対応。月の画面の中では URL を変えずに開く）、作っていない訪問がある月は
// 「訪問 N件（あと M件）」と欄の「訪問だけ作る」、日の画面の「この日」（案なし → 未確定 → 確定すると確定済み・確定 +1）、
// 週は選んでいる日付の月（月をまたぐ週）、訪問の無いデータは「今日以降の訪問はありません」でボタンなし、
// 案が全部ある月で週・日を開いても帯が速く出る・確定の操作が待たされない、スマホ（390×844）で1行・横にはみ出さない、印刷で出さない。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-progress.cjs
// 環境変数は scripts/e2e-drag.cjs と同じ（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）。PERF_MS で帯が出るまでの上限（既定 3000ms）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { answerConfirms } = require('./lib/confirmDialog.cjs');

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
const BASE = process.env.BASE || 'http://localhost:4183/';
const OUT_DIR = process.env.OUT_DIR || path.join(os.tmpdir(), 'e2e-progress');
const PERF_MS = Number(process.env.PERF_MS || 3000);
const JST = 9 * 3600 * 1000;
/** 次の水曜（今日が水曜なら今日）の日本時間 12:00（e2e-drag と同じ） */
function nextWednesdayNoonJst(now) {
  const j = new Date(now.getTime() + JST);
  const add = (3 - j.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() + add, 12) - JST);
}
const NOW = process.env.FAKE_NOW ? new Date(process.env.FAKE_NOW) : nextWednesdayNoonJst(new Date());
if (Number.isNaN(NOW.getTime())) throw new Error(`FAKE_NOW が日時として読めません：${process.env.FAKE_NOW}`);
/** アプリと同じく日本時間の今日（YYYY-MM-DD） */
const TODAY = new Date(NOW.getTime() + JST).toISOString().slice(0, 10);
const YM = TODAY.slice(0, 7);
/** 来月（YYYY-MM） */
function nextYm(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
const NEXT_YM = nextYm(YM);
/** その月の末日 */
function lastDayOf(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
const monthNo = (ym) => Number(ym.slice(5, 7));
const STORAGE_KEY = 'vrdemo:data:v1';
fs.mkdirSync(OUT_DIR, { recursive: true });

let fails = 0;
function check(ok, name, info = '') {
  if (!ok) fails++;
  console.log(
    `${ok ? 'OK  ' : 'NG  '} ${name}${info === '' ? '' : `  ${typeof info === 'string' ? info : JSON.stringify(info)}`}`,
  );
}
const hashOf = (page) => decodeURIComponent(new URL(page.url()).hash);

/** 帯が数え終わる（data-ym が付く）まで待つ */
async function bandReady(page, timeout = 30000) {
  await page.locator('[data-testid="progress-band"][data-ym]').waitFor({ timeout });
}
async function open(page, hash, ready) {
  await page.goto(`${BASE}#${hash}`);
  await page.reload();
  await page
    .locator(ready ?? 'h1')
    .first()
    .waitFor({ timeout: 30000 });
  // ホームには帯が無い
  if (!hash.startsWith('/home')) await bandReady(page);
  await page.waitForTimeout(300);
}
/** 保存したデータを書き換える（ホームはデータを書かないので、ホームで書き換えてから読み直す） */
async function editData(page, fn, arg) {
  await page.goto(`${BASE}#/home`);
  await page.reload();
  await page.locator('h1').waitFor();
  await page.evaluate(fn, arg);
  await page.reload();
  await page.locator('h1').waitFor();
}
/** 帯の数字 */
async function bandNumbers(page) {
  return page.getByTestId('progress-band').evaluate((el) => {
    const q = (id) => el.querySelector(`[data-testid="${id}"]`);
    return {
      ym: el.dataset.ym,
      next: el.dataset.next,
      planned: Number(q('band-plans').dataset.planned),
      days: Number(q('band-plans').dataset.days),
      confirmed: Number(q('band-confirm').dataset.confirmed),
      unconfirmed: Number(q('band-confirm').dataset.unconfirmed),
      attention: Number(q('band-attention').dataset.count),
      visits: q('band-visits').textContent,
    };
  });
}
/**
 * 帯からまとめて作るの欄を開いたときの確かめ：作っていない訪問・案の無い日・確定していない日のどれかがあれば欄が開き、
 * どれも無ければ開かずに知らせ（月末で今日しか残っていないときなど。PRD D153）
 */
async function expectBatch(page, n, name) {
  const opens = n.unconfirmed > 0 || n.planned < n.days || /あと/.test(n.visits);
  if (opens) {
    await batchPanel(page, YM).waitFor({ timeout: 10000 });
    check(true, `${name}：まとめて作るの欄が開く`);
    return true;
  }
  await page.locator('.toast').first().waitFor({ timeout: 5000 });
  check((await batchPanel(page, YM).count()) === 0, `${name}：作る日が無いので欄を開かず知らせ`);
  return false;
}
/** まとめて作るの欄（SidePanel） */
const batchPanel = (page, ym) => page.getByRole('dialog', { name: `${monthNo(ym)}月の案をまとめて作る` });

// ---- 月の画面：入口は帯の1か所 ----
async function monthEntry(page) {
  await editData(page, (key) => localStorage.removeItem(key), STORAGE_KEY);
  await open(page, `/month?ym=${YM}`, '[data-testid="month-grid"]');
  check(
    (await page.getByTestId('progress-band').isVisible()) &&
      (await page.getByTestId('progress-band').getAttribute('data-ym')) === YM,
    '月：見出しの下に帯（この月）',
  );
  check((await page.getByTestId('month-prep').count()) === 0, '月：今月の準備（①〜③）は帯にまとめた');
  check(
    (await page.locator('.page-head .page-actions').count()) === 0,
    '月：見出しに「◯月の案をまとめて作る」のボタンが無い',
  );
  const entries = await page.locator('main button:visible, main a:visible').filter({ hasText: 'まとめて作る' }).count();
  check(entries === 1, '月：「まとめて作る」の入口は1か所', entries);
  const next = page.getByTestId('band-next');
  check(
    (await next.getAttribute('data-kind')) === 'batch' && /btn-primary/.test((await next.getAttribute('class')) ?? ''),
    '月：案の無い日があるので次の一手は「まとめて作る」（主ボタン）',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'month-band.png') });
  await next.click();
  await batchPanel(page, YM).waitFor({ timeout: 5000 });
  check(hashOf(page) === `#/month?ym=${YM}`, '月：帯から欄が開く（URL は変えない）', hashOf(page));
  await page.keyboard.press('Escape');
  await batchPanel(page, YM).waitFor({ state: 'detached' });
  // 帯の数字 → 右の欄（画面の中で開く）
  await page.getByTestId('band-confirm').click();
  await page.getByTestId('month-unconfirmed').waitFor({ timeout: 5000 });
  const nums = await bandNumbers(page);
  const listed = await page.getByTestId('month-unconfirmed').locator('li').count();
  check(listed === nums.unconfirmed, '月：帯の確定していない日数＝右の欄の日数', { band: nums.unconfirmed, listed });
  await page.getByTestId('band-attention').click();
  await page.waitForTimeout(300);
  const att = await page.getByTestId('month-attention').locator('li').count();
  check(att === nums.attention, '月：帯の要対応＝右の欄の要対応', { band: nums.attention, listed: att });
  // 見出しの下の要約は月全体で、帯と同じ言葉（訪問・案のある日）を並べない（PR #38 のレビュー）
  const sum = await page.getByTestId('month-summary').innerText();
  check(
    !/訪問|案のある日/.test(sum) && /月全体：入らない/.test(sum),
    '月：要約は帯に無いもの（月全体の入らない など）だけ',
    sum,
  );
  // 数字のリンクは押すと何が起きるかを読み上げる
  const label = await page.getByTestId('band-plans').getAttribute('aria-label');
  check(/^案を作った日 \d+\/\d+日.*。まとめて作るを開く$/.test(label ?? ''), '月：数字のリンクの aria-label', label);
  check(
    (await page.getByTestId('band-live').count()) === 1 && (await page.getByTestId('band-live').innerText()) === '',
    '月：読み上げの領域は最初から空で置く',
  );
  // Ctrl+クリックはブラウザに任せる（新しいタブで月の画面。この画面の欄は開かない）
  const [popup] = await Promise.all([
    page.context().waitForEvent('page', { timeout: 5000 }),
    page.getByTestId('band-confirm').click({ modifiers: ['ControlOrMeta'] }),
  ]);
  await popup.waitForURL(/#\/month/, { timeout: 10000 }).catch(() => {});
  check(
    /#\/month\?ym=/.test(decodeURIComponent(popup.url())) && hashOf(page) === `#/month?ym=${YM}`,
    '月：Ctrl+クリックは新しいタブで開く（この画面はそのまま）',
    popup.url(),
  );
  await popup.close();
}

// ---- 来月：作っていない訪問があれば「あと N件」、欄の「訪問だけ作る」 ----
async function nextMonth(page) {
  await open(page, `/month?ym=${NEXT_YM}`, '[data-testid="month-grid"]');
  const v0 = await page.getByTestId('band-visits').innerText();
  const more = /あと(\d+)件/.exec(v0);
  check(!!more, '来月：定期パターンから作っていない訪問「あと N件」', v0);
  check(
    (await page.getByTestId('band-next').getAttribute('data-kind')) === 'batch',
    '来月：次の一手は「まとめて作る」',
  );
  await page.getByTestId('band-next').click();
  await batchPanel(page, NEXT_YM).waitFor({ timeout: 5000 });
  const only = page.getByTestId('batch-expand-only');
  check(await only.isVisible(), '来月：欄に「訪問だけ作る」（今月の準備の①から移した）');
  await only.click();
  await page.waitForTimeout(500);
  const v1 = await page.getByTestId('band-visits').innerText();
  check(!/あと/.test(v1) && /\d+件/.test(v1), '訪問だけ作ると帯の訪問が済み（あと N件が消える）', v1);
  check(!(await only.isVisible().catch(() => false)), '作ったあとは「訪問だけ作る」を出さない');
  await page.keyboard.press('Escape');
}

// ---- 日の画面：この日の状態、確定すると帯の確定が増える ----
async function dayConfirm(page) {
  await editData(page, (key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.goto(`${BASE}#/plan`);
  await page.reload();
  await page.getByTestId('confirm-state').waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  await bandReady(page);
  const day = page.getByTestId('band-day');
  await page.waitForFunction(() => document.querySelector('[data-testid="band-day"]')?.dataset.state === 'plan', null, {
    timeout: 10000,
  });
  check(
    /未確定/.test(await day.innerText()) && /この割当で確定/.test(await day.innerText()),
    '日：帯に「この日 未確定」と確定の仕方',
    await day.innerText(),
  );
  const n0 = await bandNumbers(page);
  check(n0.ym === YM && n0.planned >= 1, '日：今日の案ができると帯の案が数える', n0);
  await page.screenshot({ path: path.join(OUT_DIR, 'day-band.png') });
  const t0 = Date.now();
  await page.getByTestId('adopt').click();
  await page.waitForFunction(() =>
    /確定済み/.test(document.querySelector('[data-testid="confirm-state"]')?.textContent ?? ''),
  );
  const confirmMs = Date.now() - t0;
  await page.waitForFunction(
    () => document.querySelector('[data-testid="band-day"]')?.dataset.state === 'confirmed',
    null,
    {
      timeout: 10000,
    },
  );
  const n1 = await bandNumbers(page);
  check(
    n1.confirmed === n0.confirmed + 1 && n1.unconfirmed === n0.unconfirmed - 1,
    '日：確定すると帯の確定 +1・確定していない日 −1',
    {
      before: n0,
      after: n1,
    },
  );
  check(/確定済み/.test(await day.innerText()), '日：帯の「この日」が確定済み', await day.innerText());
  check(confirmMs < 1500, '日：確定の操作が帯の計算で待たされない', `${confirmMs}ms`);
  // 3画面とホームで同じ数
  await open(page, `/week?d=${TODAY}`, '[data-testid="week-title"]');
  const w = await bandNumbers(page);
  await open(page, `/month?ym=${YM}`, '[data-testid="month-grid"]');
  const m = await bandNumbers(page);
  const pick = (x) => [x.ym, x.planned, x.days, x.confirmed, x.unconfirmed, x.attention];
  check(
    JSON.stringify(pick(w)) === JSON.stringify(pick(n1)) && JSON.stringify(pick(m)) === JSON.stringify(pick(n1)),
    '月・週・日の帯は同じ月の同じ数',
    { day: pick(n1), week: pick(w), month: pick(m) },
  );
  // まだ案の無い日があれば「まとめて作る」（月末で今日しか残っていなければ、案はもう全部ある）
  const kind = await page.getByTestId('band-next').getAttribute('data-kind');
  check(
    n1.planned < n1.days ? kind === 'batch' : kind !== 'batch',
    'まだ案の無い日があれば、どの画面でも次の一手は「まとめて作る」（無ければ出さない）',
    { kind, planned: n1.planned, days: n1.days },
  );
  await open(page, '/home', '[data-testid="home-tasks"]');
  const card = page.locator('[data-kind="confirm"] strong').filter({ hasText: `${monthNo(YM)}月の確定していない日` });
  const title = (await card.count()) > 0 ? await card.innerText() : '';
  const homeN = Number(/(\d+)日を確認/.exec(title)?.[1] ?? 0);
  check(homeN === n1.unconfirmed, 'ホームの確定していない日＝帯の確定していない日', {
    home: homeN,
    band: n1.unconfirmed,
  });
}

// ---- 週・日の帯から月の画面の欄へ（?do=） ----
async function links(page) {
  await open(page, `/week?d=${TODAY}`, '[data-testid="week-title"]');
  const nw = await bandNumbers(page);
  check(
    !/btn-primary/.test((await page.getByTestId('band-next').getAttribute('class')) ?? ''),
    '週：帯のボタンは主ボタンにしない（画面の主ボタンと重ねない）',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'week-band.png') });
  await page.getByTestId('band-plans').click();
  await page.waitForURL(/#\/month/);
  await expectBatch(page, nw, '週の帯の「案」→ 月の画面');
  check(hashOf(page) === `#/month?ym=${YM}`, '週の帯の「案」→ 月の画面、?do= は消える', hashOf(page));
  await page.keyboard.press('Escape');

  await open(page, `/week?d=${TODAY}`, '[data-testid="week-title"]');
  await page.getByTestId('band-attention').click();
  await page.waitForURL(/#\/month/);
  await page.waitForTimeout(500);
  check(
    hashOf(page) === `#/month?ym=${YM}` &&
      (await page.locator('.month-aside-title').first().innerText()).includes('要対応'),
    '週の帯の「要対応」→ 月の画面の要対応',
    hashOf(page),
  );

  await open(page, '/plan', '[data-testid="band-day"]');
  const n = await bandNumbers(page);
  await page.getByTestId('band-confirm').click();
  await page.waitForURL(/#\/month/);
  await page.locator('.month-aside-title').filter({ hasText: '確定していない日' }).waitFor({ timeout: 10000 });
  const listed = await page.getByTestId('month-unconfirmed').locator('li').count();
  check(
    hashOf(page) === `#/month?ym=${YM}` && listed === n.unconfirmed,
    '日の帯の「確定」→ 月の画面の確定していない日（同じ日数）',
    { hash: hashOf(page), listed, band: n.unconfirmed },
  );
  await open(page, '/plan', '[data-testid="band-day"]');
  if ((await page.getByTestId('band-next').getAttribute('data-kind')) === 'batch') {
    await page.getByTestId('band-next').click();
    await page.waitForURL(/#\/month/);
    await batchPanel(page, YM).waitFor({ timeout: 10000 });
    check(true, '日の帯の次の一手「まとめて作る」→ 月の画面の欄');
    await page.keyboard.press('Escape');
  }
}

// ---- 週は選んでいる日付の月（月をまたぐ週） ----
async function crossMonth(page) {
  const last = lastDayOf(YM);
  const first = `${NEXT_YM}-01`;
  await open(page, `/week?d=${last}`, '[data-testid="week-title"]');
  const a = await page.getByTestId('progress-band').getAttribute('data-ym');
  await open(page, `/week?d=${first}`, '[data-testid="week-title"]');
  const b = await page.getByTestId('progress-band').getAttribute('data-ym');
  check(a === YM && b === NEXT_YM, '週：帯は選んでいる日付の月（月末の日なら今月、1日なら来月）', {
    last: a,
    first: b,
  });
  check(
    (await page.getByTestId('progress-band').locator('.pb-month').innerText()) === `${monthNo(NEXT_YM)}月`,
    '週：帯の先頭に数えている月の名前',
  );
}

// ---- 案が全部ある月：週・日の帯が速く出る ----
async function perf(page) {
  // 今月の今日以降の訪問のある日すべてに今の案を入れる（日の画面で作った今日の案を写す。数えるのに compile・採点が要る状態）
  await editData(
    page,
    ({ key, today }) => {
      const d = JSON.parse(localStorage.getItem(key));
      const plan = d.aiPlans[today];
      const dates = [
        ...new Set(
          d.visits
            .filter((v) => !v.cancelled && v.date >= today && v.date.slice(0, 7) === today.slice(0, 7))
            .map((v) => v.date),
        ),
      ];
      for (const x of dates) {
        if (d.aiPlans[x]) continue;
        const ids = d.visits.filter((v) => v.date === x && !v.cancelled).map((v) => v.id);
        const staffIds = Object.keys(plan.routes).filter((s) => s !== '__none');
        const routes = {};
        ids.forEach((id, i) => {
          const s = staffIds[i % staffIds.length];
          routes[s] = [...(routes[s] ?? []), id];
        });
        const { runId: _r, reassign: _a, ...rest } = plan;
        d.aiPlans[x] = {
          ...rest,
          date: x,
          routes,
          unassigned: [],
          generated: { routes, unassigned: [], score: plan.score },
          pins: {},
        };
      }
      localStorage.setItem(key, JSON.stringify(d));
    },
    { key: STORAGE_KEY, today: TODAY },
  );
  for (const [hash, ready] of [
    [`/week?d=${TODAY}`, '[data-testid="week-title"]'],
    ['/plan', '[data-testid="confirm-state"]'],
  ]) {
    await page.goto(`${BASE}#/home`);
    await page.reload();
    await page.locator('h1').waitFor();
    const t0 = Date.now();
    await page.goto(`${BASE}#${hash}`);
    await page.locator(ready).waitFor({ timeout: 30000 });
    const head = Date.now() - t0;
    await bandReady(page, 30000);
    const band = Date.now() - t0;
    check(band < PERF_MS, `${hash}：案が全部ある月でも帯が ${PERF_MS}ms 以内に出る`, { head, band });
  }
  const n = await bandNumbers(page);
  check(n.planned === n.days && n.next !== 'batch', '案が全部あれば次の一手は「まとめて作る」でない', n);
  // 済んだ「案 ✓」から開いても、既定は「まだ案の無い日だけ」（作り直しは利用者が選んだときだけ。PR #38 のレビュー）
  await open(page, `/month?ym=${YM}`, '[data-testid="month-grid"]');
  check(/済/.test(await page.getByTestId('band-plans').innerText()), '案が全部ある：案のチップに読み上げの「済」');
  const nm = await bandNumbers(page);
  await page.getByTestId('band-plans').click();
  const panel = batchPanel(page, YM);
  if (!(await expectBatch(page, nm, '済んだ案から'))) return;
  const checked = await panel
    .locator('input[name="batch-mode"]:checked')
    .evaluate((el) => el.parentElement.textContent);
  const count = await page.getByTestId('batch-count').innerText();
  check(
    /まだ案の無い日だけ/.test(checked) && /0日/.test(count),
    '済んだ案から開くと既定は「まだ案の無い日だけ（0日）」',
    {
      checked,
      count,
    },
  );
  await page.keyboard.press('Escape');
}

// ---- 訪問の無いデータ：ボタンなし ----
async function empty(page) {
  await editData(
    page,
    (key) => {
      const d = JSON.parse(localStorage.getItem(key));
      d.visits = d.visits.map((v) => ({ ...v, cancelled: true }));
      d.patterns = [];
      d.aiPlans = {};
      d.manualPlans = {};
      d.absences = [];
      localStorage.setItem(key, JSON.stringify(d));
    },
    STORAGE_KEY,
  );
  await open(page, `/month?ym=${YM}`, '[data-testid="month-grid"]');
  const next = page.getByTestId('band-next');
  check(
    (await next.getAttribute('data-kind')) === 'empty' && (await next.evaluate((el) => el.tagName)) === 'SPAN',
    '訪問の無い月：「今日以降の訪問はありません」でボタンなし',
    await next.innerText(),
  );
  await editData(page, (key) => localStorage.removeItem(key), STORAGE_KEY);
}

// ---- スマホ（390×844）で1行・印刷で出さない ----
async function mobile(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [hash, ready, name] of [
    [`/month?ym=${YM}`, '[data-testid="month-grid"]', 'month'],
    [`/week?d=${TODAY}`, '[data-testid="week-title"]', 'week'],
    ['/plan', '[data-testid="confirm-state"]', 'day'],
  ]) {
    await page.goto(`${BASE}#${hash}`);
    await page.reload();
    await page.locator(ready).waitFor({ timeout: 60000 });
    await bandReady(page);
    await page.waitForTimeout(300);
    const box = await page.getByTestId('progress-band').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const kids = [...el.querySelectorAll('.pb-month, .pb-item, [data-testid="band-next"]')]
        .filter((x) => x.getBoundingClientRect().width > 0)
        .map((x) => x.getBoundingClientRect());
      return {
        h: Math.round(r.height),
        right: Math.round(r.right),
        overflow: el.scrollWidth > el.clientWidth + 1,
        rows: new Set(kids.map((k) => Math.round(k.top + k.height / 2) >> 3)).size,
        tops: kids.map((k) => Math.round(k.top)),
      };
    });
    check(box.h <= 50 && box.right <= 390 && !box.overflow && box.rows === 1, `390px（${name}）：帯が1行に収まる`, box);
    check(!(await page.getByTestId('band-visits').isVisible()), `390px（${name}）：訪問の件数は省く`);
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    check(scrollW <= 390, `390px（${name}）：横にはみ出さない`, scrollW);
    await page.screenshot({ path: path.join(OUT_DIR, `mobile-${name}.png`) });
    await page.emulateMedia({ media: 'print' });
    check(!(await page.getByTestId('progress-band').isVisible()), `印刷（${name}）：帯を出さない`);
    await page.emulateMedia({ media: 'screen' });
  }
  await page.setViewportSize({ width: 1400, height: 1000 });
}

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(String(e));
    console.log('ERR', String(e));
  });
  // 確認は独自のダイアログで受ける（ネイティブのダイアログが出たら失敗。PRD D146）
  const dlg = await answerConfirms(page);
  for (const [name, fn] of [
    ['month-entry', monthEntry],
    ['next-month', nextMonth],
    ['day-confirm', dayConfirm],
    ['links', links],
    ['cross-month', crossMonth],
    ['mobile', mobile],
    ['perf', perf],
    ['empty', empty],
  ]) {
    try {
      await fn(page);
    } catch (e) {
      check(false, name, String(e.message || e));
      await page.screenshot({ path: path.join(OUT_DIR, `fail-${name}.png`) }).catch(() => {});
    }
  }
  check(dlg.native.length === 0, 'ブラウザのダイアログを出さない', dlg.native);
  await b.close();
  console.log(`スクリーンショット：${OUT_DIR}`);
  const ng = fails + errors.length;
  console.log(ng === 0 ? '全部通った' : `${fails} 件が通らない・ページのエラー ${errors.length} 件`);
  process.exit(ng === 0 ? 0 : 1);
})();
