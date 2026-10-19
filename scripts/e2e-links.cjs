// 行き止まりの所から次の画面へ移る道（PRD D201〜D204。ADR-0025 追記）を本物のブラウザで確かめる：
// 月の要対応の行き先（入らない訪問 → 日の画面の「入らなかった訪問」へ巻く・休みの人に残る訪問 → その日の「欠勤・キャンセル」の欄・
// 拘束が上限を超える → 稼働の見込みをその月・その人で・そのほか → 日の画面。行き先の文「（〜で開く）」・`?do=` は消える）、
// 稼働の見込みの日ごとの表の日付と〈スタッフ〉×日の表のマスから日の画面（マスに名前の吹き出しを付けない）、
// 稼働時間の右の欄から「欠勤・キャンセル」の欄（その人の2段目。欠勤が無ければ登録の文）、空き状況の右の欄の日ごとの結果から日の画面。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-links.cjs
// 環境変数は scripts/e2e-drag.cjs と同じ（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { skipTour } = require('./lib/tourSeen.cjs');
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
const OUT_DIR = process.env.OUT_DIR || path.join(os.tmpdir(), 'e2e-links');
const STORAGE_KEY = 'vrdemo:data:v1';
const JST = 9 * 3600 * 1000;
/** 次の水曜（今日が水曜なら今日）の日本時間 12:00（e2e-drag と同じ） */
function nextWednesdayNoonJst(now) {
  const j = new Date(now.getTime() + JST);
  const add = (3 - j.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() + add, 12) - JST);
}
const NOW = process.env.FAKE_NOW ? new Date(process.env.FAKE_NOW) : nextWednesdayNoonJst(new Date());
if (Number.isNaN(NOW.getTime())) throw new Error(`FAKE_NOW が日時として読めません：${process.env.FAKE_NOW}`);
/** アプリと同じ日本時間の今日 */
const TODAY = new Date(NOW.getTime() + JST).toISOString().slice(0, 10);
fs.mkdirSync(OUT_DIR, { recursive: true });

let fails = 0;
function check(ok, name, info = '') {
  if (!ok) fails++;
  console.log(
    `${ok ? 'OK  ' : 'NG  '} ${name}${info === '' ? '' : `  ${typeof info === 'string' ? info : JSON.stringify(info)}`}`,
  );
}
const hashOf = (page) => decodeURIComponent(new URL(page.url()).hash);
const settle = (page, ms = 250) => page.waitForTimeout(ms);
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), STORAGE_KEY);
/** 「10/21」の形（月の要対応の日付の文） */
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
/** 日の画面で選んでいる日付 */
const dayOf = (page) => page.locator('.date-switch select').inputValue();

/**
 * 画面を新しく開く（e2e-home と同じ：同じ文書の中で hash を移すと `?do=` が先に処理されることがあるので、about:blank を挟む）
 */
async function open(page, hash, ready) {
  await page.goto('about:blank');
  await page.goto(`${BASE}#${hash}`);
  await page.locator(ready).first().waitFor({ timeout: 30000 });
  await settle(page, 300);
}
/** 日の画面が開いてその日を選んでいる（移ったあと） */
async function onPlan(page, date) {
  await page.waitForURL(/#\/plan/, { timeout: 10000 });
  await page.locator('.date-switch select').waitFor({ timeout: 30000 });
  await page
    .waitForFunction((d) => document.querySelector('.date-switch select')?.value === d, date, { timeout: 10000 })
    .catch(() => {});
  return (await dayOf(page)) === date;
}
/** 日の画面の案ができるまで待つ（e2e-rebuild と同じ） */
async function planReady(page) {
  await page.getByTestId('confirm-state').waitFor({ timeout: 60000 });
  await page.waitForFunction(
    () => {
      const s = document.querySelector('[data-testid="band-day"]')?.dataset.state;
      return s === 'plan' || s === 'confirmed';
    },
    null,
    { timeout: 60000 },
  );
}
/** 要素が画面の中に見えている（巻いて見せたか） */
const inView = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top >= -2 && r.top < window.innerHeight;
  }, sel);

// ---- 用意：今日より後の、訪問のある日（SECOND）に案を作り、入らない訪問・欠勤の人に残る訪問・拘束の上限超えを作る ----
let SECOND = '';
let YM2 = '';
/** 欠勤にした人・その日に欠勤の無い人 */
let ABSENT = '';
let PRESENT = '';
async function prepare(page) {
  await open(page, '/plan', '.date-switch select');
  await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
  await page.reload();
  await page.locator('.date-switch select').waitFor({ timeout: 30000 });
  const options = await page.locator('.date-switch select option').evaluateAll((os) => os.map((o) => o.value));
  SECOND = options.find((d) => d > TODAY) ?? '';
  YM2 = SECOND.slice(0, 7);
  check(SECOND !== '', '用意：今日より後の日がある', SECOND);
  await page.locator('.date-switch select').selectOption(SECOND);
  await planReady(page);
  await page.waitForFunction(
    ({ k, d }) => !!JSON.parse(localStorage.getItem(k) ?? '{}').aiPlans?.[d],
    { k: STORAGE_KEY, d: SECOND },
    { timeout: 60000 },
  );
  // 別のタブで書く（storage の知らせでこのタブのデータも入れ替わる。e2e-view の names() と同じ）
  const other = await page.context().newPage();
  await other.goto(`${BASE}#/data`);
  const picked = await other.evaluate(
    ({ k, d }) => {
      const data = JSON.parse(localStorage.getItem(k));
      const plan = data.aiPlans[d];
      const staffWith = Object.keys(plan.routes).filter((s) => s !== '__none' && plan.routes[s].length > 0);
      // 1人目の最初の訪問を「入らない」にする
      const a = staffWith[0];
      const vid = plan.routes[a][0];
      plan.routes[a] = plan.routes[a].slice(1);
      plan.unassigned = [...(plan.unassigned ?? []), vid];
      // 2人目を終日の欠勤にする（訪問が残る）
      const absent = staffWith[1];
      data.absences = [
        ...data.absences.filter((x) => !(x.staffId === absent && x.date === d)),
        { id: `e2e-links-${absent}`, staffId: absent, date: d, from: null, to: null, note: '' },
      ];
      // 拘束の上限を1時間にして、上限を超える人を出す
      data.org.spanLimitHours = 1;
      localStorage.setItem(k, JSON.stringify(data));
      const present = data.staff.find(
        (s) => s.active && s.id !== absent && !data.absences.some((x) => x.staffId === s.id && x.date === d),
      );
      return { absent, present: present?.id ?? '' };
    },
    { k: STORAGE_KEY, d: SECOND },
  );
  await other.close();
  ABSENT = picked.absent;
  PRESENT = picked.present;
  await settle(page, 300);
}

/** 月の画面の要対応の行（SECOND の、その種類） */
async function attentionRow(page, kind) {
  await open(page, `/month?ym=${YM2}&do=attention`, '[data-testid="month-attention"]');
  return page
    .locator(`.month-attention-btn.is-${kind}`)
    .filter({ hasText: md(SECOND) })
    .first();
}

// ---- D201 月の要対応 ----
async function attention(page) {
  await prepare(page);
  // 入らない訪問 → 日の画面の「入らなかった訪問」の列へ巻く
  let row = await attentionRow(page, 'unassigned');
  check((await row.count()) === 1, '要対応に「入らない訪問」の行がある', SECOND);
  check(
    (await row.innerText()).includes('（日の画面の「入らなかった訪問」で開く）'),
    '入らない訪問：行き先の文',
    await row.innerText(),
  );
  check((await row.locator('button, a').count()) === 0, '行の中にボタンを入れ子にしない');
  await row.click();
  check(await onPlan(page, SECOND), '入らない訪問 → その日の日の画面', await dayOf(page));
  await page.locator('.route-col-none').first().waitFor({ timeout: 30000 });
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector('.route-col-none');
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.top >= -2 && r.top < window.innerHeight * 0.5;
      },
      null,
      { timeout: 10000 },
    )
    .catch(() => {});
  check(await inView(page, '.route-col-none'), '入らない訪問 → 「入らなかった訪問」の列へ巻いて見せる');
  check(!/do=|date=/.test(hashOf(page)), '入らない訪問 → ?do=・?date= は消える', hashOf(page));
  await page.screenshot({ path: path.join(OUT_DIR, 'links-unassigned.png') });

  // URL から直接（?date=…&do=unassigned）。今日を選んでいても、その日を選んで巻く
  await open(page, '/plan', '.date-switch select');
  await page.locator('.date-switch select').selectOption(TODAY);
  await settle(page, 300);
  await open(page, `/plan?date=${SECOND}&do=unassigned`, '.date-switch select');
  check(await onPlan(page, SECOND), '?date=…&do=unassigned でその日を選ぶ', await dayOf(page));
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector('.route-col-none');
        return !!el && el.getBoundingClientRect().top < window.innerHeight * 0.5;
      },
      null,
      { timeout: 10000 },
    )
    .catch(() => {});
  check(await inView(page, '.route-col-none'), '?do=unassigned で「入らなかった訪問」の列へ巻く');
  check(hashOf(page) === '#/plan', '?do=unassigned は読んだら消す', hashOf(page));
  check((await page.getByTestId('tour').count()) === 0, '?do= のリンクでは案内ツアーを出さない');

  // 休みの人に訪問が残る → その日の「欠勤・キャンセル」の欄（1段目）
  row = await attentionRow(page, 'absentLeft');
  check((await row.count()) === 1, '要対応に「休みの人に訪問」の行がある');
  check(
    (await row.innerText()).includes('（日の画面の「欠勤・キャンセル」で開く）'),
    '休みの人に訪問：行き先の文',
    await row.innerText(),
  );
  await row.click();
  check(await onPlan(page, SECOND), '休みの人に訪問 → その日の日の画面', await dayOf(page));
  await page.getByTestId('sudden-panel').waitFor({ timeout: 10000 });
  check(
    (await page.locator('h3.sudden-step-title').textContent()) === '何が起きましたか？',
    '休みの人に訪問 → 「欠勤・キャンセル」の欄の1段目',
  );
  check(!/do=|date=/.test(hashOf(page)), '休みの人に訪問 → ?do=・?date= は消える', hashOf(page));
  await page.screenshot({ path: path.join(OUT_DIR, 'links-absent-left.png') });

  // 拘束が上限を超える → 稼働の見込み（その月・その人）
  row = await attentionRow(page, 'overSpan');
  check((await row.count()) === 1, '要対応に「出勤〜退勤（拘束）が上限を超える」の行がある');
  check((await row.innerText()).includes('（稼働の見込みで開く）'), '拘束の上限：行き先の文', await row.innerText());
  const to = (await row.getAttribute('data-to')) ?? '';
  const sid = new URLSearchParams(to.split('?')[1] ?? '').get('staff') ?? '';
  await row.click();
  await page.waitForURL(/#\/workload/, { timeout: 10000 });
  await page.getByTestId('work-staff').waitFor({ timeout: 30000 });
  check(
    hashOf(page) === `#/workload?ym=${YM2}&staff=${sid}`,
    '拘束の上限 → 稼働の見込み（その月・その人）',
    hashOf(page),
  );
  check(
    sid !== '' && (await page.getByTestId('work-staff').inputValue()) === sid,
    '稼働の見込み：その人を日ごとに選んでいる',
    { sid, value: await page.getByTestId('work-staff').inputValue() },
  );
  check(
    (await page.locator('.work-nav').innerText()).includes(`${Number(YM2.slice(5, 7))}月`),
    '稼働の見込み：その月を開いている',
  );
  check(
    (await page.getByTestId('work-detail').locator(`[data-testid="work-day-open"][data-date="${SECOND}"]`).count()) ===
      1,
    '稼働の見込み：選んだ人の日ごとの表にその日がある',
  );

  // そのほか（欠勤がある）→ 今のまま日の画面
  row = await attentionRow(page, 'absence');
  check((await row.innerText()).includes('（日の画面で開く）'), 'そのほか：行き先の文', await row.innerText());
  await row.click();
  check(await onPlan(page, SECOND), '欠勤がある → その日の日の画面', await dayOf(page));
  check((await page.getByTestId('sudden-panel').count()) === 0, '欠勤がある → 欄は開かない（今のまま）');
  check(hashOf(page) === '#/plan', '欠勤がある → URL は /plan', hashOf(page));
}

// ---- D202 稼働の見込み ----
async function workload(page) {
  await prepare(page);
  await open(page, `/workload?ym=${YM2}`, '[data-testid="work-detail"]');
  // 選んだ人の日ごとの表の日付
  const link = page.getByTestId('work-day-open').first();
  const d1 = (await link.getAttribute('data-date')) ?? '';
  check(
    /（日の画面で開く）$/.test((await link.getAttribute('aria-label')) ?? ''),
    '日ごとの表の日付：読み上げに「（日の画面で開く）」',
    await link.getAttribute('aria-label'),
  );
  await link.click();
  check(await onPlan(page, d1), '日ごとの表の日付 → その日の日の画面', { d1, now: await dayOf(page) });
  // 〈スタッフ〉×日の表のマス（今日でない日・上限を超えるマス）
  await open(page, `/workload?ym=${YM2}`, '[data-testid="work-grid"]');
  const grid = page.getByTestId('work-grid');
  check(
    (await grid.locator('[data-testid="person-btn"]').count()) === 0,
    '〈スタッフ〉×日の表に名前の吹き出しを付けない（D124）',
  );
  const cell = grid.locator(`.work-cell.is-over .work-cell-btn[data-date="${SECOND}"]`).first();
  check((await cell.count()) === 1, '上限を超えるマス（「!」）がある', SECOND);
  check(
    /上限を超える（日の画面で開く）$/.test((await cell.getAttribute('aria-label')) ?? ''),
    'マス：読み上げに内訳と「（日の画面で開く）」',
    await cell.getAttribute('aria-label'),
  );
  check(!!(await cell.getAttribute('title')), 'マス：指を置くと内訳（title）は今どおり');
  // キーボードで押せる
  await cell.focus();
  await page.keyboard.press('Enter');
  check(await onPlan(page, SECOND), 'マス → その日の日の画面（キーボード）', await dayOf(page));
  await page.screenshot({ path: path.join(OUT_DIR, 'links-workload.png') });
}

// ---- D203 稼働時間の右の欄 ----
async function availability(page) {
  await prepare(page);
  const data = await stored(page);
  const nameOf = (id) => data.staff.find((s) => s.id === id)?.name ?? '';
  await open(page, '/availability', '.avail-table');
  const heads = await page.locator('.avail-table thead th').allInnerTexts();
  const col = heads.findIndex((t) => t.replace(/\s+/g, '').startsWith(md(SECOND)));
  check(col > 0, '稼働時間の表にその日の列がある', { col, heads: heads.slice(0, 4) });
  const cellOf = (id) =>
    page
      .locator('.avail-table tbody tr')
      .filter({ has: page.locator('th.avail-name', { hasText: nameOf(id) }) })
      .locator('td')
      .nth(col - 1)
      .locator('button');
  // 欠勤のある人：「直す・取り消す」で、その人の2段目
  await cellOf(ABSENT).click();
  const link = page.getByTestId('availability-absence-link');
  await link.waitFor({ timeout: 5000 });
  check(
    (await link.innerText()).includes('この日の欠勤を直す・取り消す（日の画面の「欠勤・キャンセル」で開く）'),
    '欠勤のある日：直す・取り消すのリンクと行き先',
    await link.innerText(),
  );
  check(
    (await link.getAttribute('href')) === `#/plan?date=${SECOND}&do=absence&staff=${ABSENT}`,
    'リンクは ?date=…&do=absence&staff=…（新しいタブでも開ける）',
    await link.getAttribute('href'),
  );
  await link.click();
  check(await onPlan(page, SECOND), '稼働時間 → その日の日の画面', await dayOf(page));
  await page.getByTestId('sudden-staff').waitFor({ timeout: 10000 });
  check(
    (await page.getByTestId('sudden-staff').inputValue()) === ABSENT,
    '「欠勤・キャンセル」の欄をその人の2段目で開く',
    await page.getByTestId('sudden-staff').inputValue(),
  );
  check(!/do=|date=|staff=/.test(hashOf(page)), '?do=・?date=・?staff= は消える', hashOf(page));
  await page.screenshot({ path: path.join(OUT_DIR, 'links-availability.png') });
  // 欠勤の無い人：登録のリンク
  if (PRESENT) {
    await open(page, '/availability', '.avail-table');
    await cellOf(PRESENT).click();
    await link.waitFor({ timeout: 5000 });
    check(
      (await link.innerText()).startsWith('この日の欠勤を登録する'),
      '欠勤の無い日：登録のリンク',
      await link.innerText(),
    );
  }
  // 知らない人の staff= は1段目
  await open(page, `/plan?date=${SECOND}&do=absence&staff=nobody`, '.date-switch select');
  await page.getByTestId('sudden-panel').waitFor({ timeout: 10000 });
  check(
    (await page.locator('h3.sudden-step-title').textContent()) === '何が起きましたか？',
    '知らない人の staff= は1段目で開く',
  );
}

// ---- D204 空き状況の右の欄 ----
async function vacancy(page) {
  await prepare(page);
  await open(page, '/vacancy', '[data-testid="vacancy-grid"]');
  const cells = page.getByTestId('vacancy-cell');
  const n = await cells.count();
  let found = false;
  for (let i = 0; i < n && !found; i++) {
    await cells.nth(i).click();
    await settle(page, 80);
    if ((await page.getByTestId('vacancy-day-open').count()) > 0) found = true;
  }
  check(found, '空き状況：右の欄に日ごとの結果がある');
  if (!found) return;
  const list = page.getByTestId('vacancy-dates');
  check(
    (await list.locator('[data-testid="person-btn"]').count()) === 0,
    '日ごとの結果に名前の吹き出しを付けない（D124）',
  );
  const rows = await list.locator('li').count();
  check((await page.getByTestId('vacancy-day-open').count()) === rows, '日付ごとに「その日の案を見る」', rows);
  const btn = page.getByTestId('vacancy-day-open').last();
  const d = (await btn.getAttribute('data-date')) ?? '';
  check((await btn.innerText()) === 'その日の案を見る', 'ボタンの文', await btn.innerText());
  check(
    /の案を見る（日の画面で開く）$/.test((await btn.getAttribute('aria-label')) ?? ''),
    '読み上げに「（日の画面で開く）」',
    await btn.getAttribute('aria-label'),
  );
  check((await page.locator('.drawer .btn-primary').count()) === 0, '右の欄に主ボタンを足さない');
  await btn.click();
  check(await onPlan(page, d), '空き状況 → その日の日の画面', { d, now: await dayOf(page) });
  await page.screenshot({ path: path.join(OUT_DIR, 'links-vacancy.png') });
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const errors = [];
  for (const step of [attention, workload, availability, vacancy]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // 初回の案内ツアーを見た扱いにする（PRD D193）
    await skipTour(ctx);
    // 地図のタイルは外へ取りに行かない
    await ctx.route(/cyberjapandata\.gsi\.go\.jp|tile\.openstreetmap/, (r) => r.fulfill({ status: 204, body: '' }));
    const page = await ctx.newPage();
    // ページの時計を止める（e2e-view と同じ）
    await page.clock.setFixedTime(NOW);
    page.on('pageerror', (e) => errors.push(String(e)));
    const dlg = await answerConfirms(page);
    try {
      await step(page, dlg);
    } catch (e) {
      check(false, `${step.name}：途中で止まった`, String(e).split('\n')[0]);
      await page.screenshot({ path: path.join(OUT_DIR, `${step.name}-error.png`) }).catch(() => {});
    }
    check(dlg.native.length === 0, `${step.name}：ブラウザのダイアログを出さない`, dlg.native);
    await ctx.close();
  }
  check(errors.length === 0, 'ページのエラーが無い', errors);
  await browser.close();
  console.log(fails === 0 ? '\nすべて OK' : `\nNG ${fails} 件`);
  process.exit(fails === 0 ? 0 : 1);
})();
