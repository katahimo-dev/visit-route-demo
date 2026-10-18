// 独自の確認ダイアログ（PRD D146〜D150。ADR-0026）を本物のブラウザで確かめる：
// 代表の数か所（条件を消す・項目を消す・データを初期状態に戻す・日の画面の「この割当で確定」・〈スタッフ〉の変更を捨てる）で、
// 画面の中央に独自のダイアログが出て、ブラウザのネイティブのダイアログは出ない（page.on('dialog') が呼ばれたら失敗）。
// role=alertdialog・aria-modal・見出しと本文の aria-labelledby/describedby、最初のフォーカスは取り消し、Tab・Shift+Tab は中で回る、
// 裏（#root）は inert・巻かない。Esc・取り消す・背景を押すでは何も変わらず、確定で処理が進む。閉じたら押したボタンへフォーカスが戻る。
// 右の欄（SidePanel）の上に出たとき、Esc は確認だけを閉じる（欄は閉じない）。390px で画面に収まる。印刷では出さない。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-dialog.cjs
// 環境変数は scripts/e2e-drag.cjs と同じ（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
const OUT_DIR = process.env.OUT_DIR || path.join(os.tmpdir(), 'e2e-dialog');
const JST = 9 * 3600 * 1000;
/** 次の水曜（今日が水曜なら今日）の日本時間 12:00（e2e-drag と同じ） */
function nextWednesdayNoonJst(now) {
  const j = new Date(now.getTime() + JST);
  const add = (3 - j.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() + add, 12) - JST);
}
const NOW = process.env.FAKE_NOW ? new Date(process.env.FAKE_NOW) : nextWednesdayNoonJst(new Date());
if (Number.isNaN(NOW.getTime())) throw new Error(`FAKE_NOW が日時として読めません：${process.env.FAKE_NOW}`);
const STORAGE_KEY = 'vrdemo:data:v1';
fs.mkdirSync(OUT_DIR, { recursive: true });

let fails = 0;
function check(ok, name, info = '') {
  if (!ok) fails++;
  console.log(
    `${ok ? 'OK  ' : 'NG  '} ${name}${info === '' ? '' : `  ${typeof info === 'string' ? info : JSON.stringify(info)}`}`,
  );
}
const settle = (page, ms = 250) => page.waitForTimeout(ms);
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), STORAGE_KEY);
const dialog = (page) => page.getByTestId('confirm-dialog');
/** いまフォーカスのある要素の data-testid・読み上げ名 */
const focused = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.getAttribute('data-testid') ?? ''}|${el.getAttribute('aria-label') ?? el.textContent ?? ''}` : '';
  });

async function open(page, hash, ready) {
  await page.goto(`${BASE}#${hash}`);
  await page.reload();
  await page.locator(ready).first().waitFor({ timeout: 30000 });
  await settle(page, 400);
}

/** 出ているダイアログの形（ARIA・フォーカス・裏の inert とスクロールのロック・中央） */
async function shape(page, where) {
  await dialog(page).waitFor({ timeout: 5000 });
  const a = await dialog(page).evaluate((d) => {
    const t = document.getElementById(d.getAttribute('aria-labelledby') ?? '');
    const b = document.getElementById(d.getAttribute('aria-describedby') ?? '');
    const r = d.getBoundingClientRect();
    return {
      role: d.getAttribute('role'),
      modal: d.getAttribute('aria-modal'),
      title: t?.textContent ?? '',
      body: b?.textContent ?? '',
      rootInert: document.getElementById('root')?.inert ?? false,
      overflow: getComputedStyle(document.body).overflow,
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      vw: innerWidth,
      vh: innerHeight,
      inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
    };
  });
  check(
    a.role === 'alertdialog' && a.modal === 'true' && a.title !== '',
    `${where}：role=alertdialog・aria-modal・見出しで名前`,
    a,
  );
  check(a.rootInert && a.overflow === 'hidden', `${where}：裏は inert で巻かない`, a);
  check(
    a.inView && Math.abs(a.cx - a.vw / 2) < 4 && Math.abs(a.cy - a.vh / 2) < a.vh / 4,
    `${where}：画面の中央に収まる`,
    a,
  );
  check(
    (await focused(page)).startsWith('confirm-cancel'),
    `${where}：最初のフォーカスは取り消し`,
    await focused(page),
  );
  return a;
}

// ---- 条件を消す（#/rules）：Esc・取り消す・背景は何もしない、確定で消える、フォーカスの戻り、Tab が中で回る ----
async function rules(page) {
  await open(page, '/rules', 'table');
  const before = (await stored(page)).rules;
  const r0 = before[0];
  const btn = page.getByRole('button', { name: `条件「${r0.label}」を消す` });
  await btn.click();
  const a = await shape(page, '条件を消す');
  check(a.title === `条件「${r0.label}」を消しますか？`, '条件を消す：見出しは問い', a.title);
  const ok = page.getByTestId('confirm-ok');
  check(
    (await ok.textContent()) === '消す' && ((await ok.getAttribute('class')) ?? '').includes('btn-danger-solid'),
    '条件を消す：確定は動詞「消す」で危険の色',
  );
  check((await page.getByTestId('confirm-cancel').textContent()) === '取り消す', '条件を消す：取り消しは「取り消す」');
  await settle(page, 300);
  await page.screenshot({ path: path.join(OUT_DIR, 'dialog-rules-1400.png') });
  // Tab は中で回る（取り消す → 消す → 取り消す、Shift+Tab で逆）
  await page.keyboard.press('Tab');
  const t1 = await focused(page);
  await page.keyboard.press('Tab');
  const t2 = await focused(page);
  await page.keyboard.press('Shift+Tab');
  const t3 = await focused(page);
  await page.keyboard.press('Shift+Tab');
  const t4 = await focused(page);
  check(
    t1.startsWith('confirm-ok') &&
      t2.startsWith('confirm-cancel') &&
      t3.startsWith('confirm-ok') &&
      t4.startsWith('confirm-cancel'),
    '条件を消す：Tab・Shift+Tab は中で回る',
    [t1, t2, t3, t4],
  );
  // Esc：何も変わらず、押したボタンへ戻る
  await page.keyboard.press('Escape');
  await settle(page);
  check(
    (await dialog(page).count()) === 0 && (await stored(page)).rules.length === before.length,
    '条件を消す：Esc で閉じて何も変わらない',
  );
  check(
    (await focused(page)).includes(`条件「${r0.label}」を消す`),
    '条件を消す：閉じたら押したボタンへフォーカスが戻る',
    await focused(page),
  );
  const rootInert = await page.evaluate(() => document.getElementById('root')?.inert ?? false);
  const overflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
  check(!rootInert && overflow !== 'hidden', '条件を消す：閉じたら inert・巻かないを戻す', { rootInert, overflow });
  // 取り消す
  await btn.click();
  await dialog(page).waitFor();
  await page.getByTestId('confirm-cancel').click();
  await settle(page);
  check(
    (await dialog(page).count()) === 0 && (await stored(page)).rules.length === before.length,
    '条件を消す：「取り消す」で何も変わらない',
  );
  // 背景を押す
  await btn.click();
  await dialog(page).waitFor();
  await page.mouse.click(8, 8);
  await settle(page);
  check(
    (await dialog(page).count()) === 0 && (await stored(page)).rules.length === before.length,
    '条件を消す：背景を押すと取り消し（何も変わらない）',
  );
  // 確定：消える
  await btn.click();
  await dialog(page).waitFor();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await settle(page, 400);
  const after = (await stored(page)).rules;
  check(
    (await dialog(page).count()) === 0 && after.length === before.length - 1 && !after.some((x) => x.id === r0.id),
    '条件を消す：確定（キーボード）で消える',
    after.length,
  );
}

// ---- データを初期状態に戻す（#/data）：取り消しでトーストなし、確定でトースト ----
async function dataReset(page) {
  await open(page, '/data', 'h1');
  await page.getByRole('button', { name: 'デモの初期状態に戻す' }).click();
  const a = await shape(page, '初期状態に戻す');
  check(/いまの変更はすべて消えます/.test(a.body), '初期状態に戻す：本文（aria-describedby）', a.body);
  await page.getByTestId('confirm-cancel').click();
  await settle(page);
  check((await page.locator('.toast').count()) === 0, '初期状態に戻す：取り消すと何もしない（知らせも出ない）');
  await page.getByRole('button', { name: 'デモの初期状態に戻す' }).click();
  await dialog(page).waitFor();
  await page.getByTestId('confirm-ok').click();
  await page.locator('.toast').waitFor({ timeout: 5000 });
  check(
    ((await page.locator('.toast').textContent()) ?? '').includes('初期状態に戻しました'),
    '初期状態に戻す：確定で戻り、知らせ（トースト）が出る',
  );
}

// ---- 日の画面の「この割当で確定」（#/plan）：取り消しでは未確定のまま、確定で「確定済み」 ----
async function adopt(page) {
  await open(page, '/plan', '.date-switch select');
  await page.getByTestId('confirm-state').waitFor({ timeout: 60000 });
  await settle(page, 600);
  const state = () => page.getByTestId('confirm-state').textContent();
  const s0 = (await state()) ?? '';
  await page.getByTestId('adopt').click();
  const a = await shape(page, 'この割当で確定');
  check(a.title === 'この割当で確定しますか？', 'この割当で確定：見出し', a.title);
  await page.keyboard.press('Escape');
  await settle(page);
  check((await state()) === s0 && !/確定済み/.test(s0), 'この割当で確定：Esc では確定しない', s0);
  await page.getByTestId('adopt').click();
  await dialog(page).waitFor();
  await page.getByTestId('confirm-ok').click();
  await settle(page, 500);
  check(/確定済み/.test((await state()) ?? ''), 'この割当で確定：確定で「確定済み」', await state());
}

// ---- 〈スタッフ〉の変更を捨てる（右の欄の上に出る）：Esc は確認だけを閉じる、捨てて閉じる ----
async function staffDiscard(page) {
  await open(page, '/staff?id=s1', '[data-testid="view-edit"]');
  await page.getByTestId('view-edit').click();
  const email = page.locator('.drawer').locator('input[type="email"]').first();
  await email.waitFor();
  await email.fill('dialog@example.com');
  // 欄の Esc → 確認
  await page.keyboard.press('Escape');
  const a = await shape(page, '変更を捨てる');
  check(a.title === '変更を捨てて、欄を閉じますか？', '変更を捨てる：見出し', a.title);
  check(
    (await page.getByTestId('confirm-cancel').textContent()) === '編集を続ける',
    '変更を捨てる：取り消しは「編集を続ける」',
  );
  // 確認の Esc は欄に渡さない（欄は開いたまま・入力はそのまま）
  await page.keyboard.press('Escape');
  await settle(page);
  check(
    (await dialog(page).count()) === 0 &&
      (await page.locator('.drawer').count()) === 1 &&
      (await email.inputValue()) === 'dialog@example.com',
    '変更を捨てる：確認の Esc は確認だけを閉じ、編集が続く',
  );
  // × → 捨てて閉じる
  await page.locator('.drawer').getByRole('button', { name: '閉じる' }).first().click();
  await dialog(page).waitFor();
  check(
    (await page.getByTestId('confirm-ok').textContent()) === '捨てて閉じる',
    '変更を捨てる：確定は「捨てて閉じる」',
  );
  await page.getByTestId('confirm-ok').click();
  await settle(page, 400);
  const s1 = (await stored(page)).staff.find((s) => s.id === 's1');
  check(
    (await page.locator('.drawer').count()) === 0 && s1.email !== 'dialog@example.com',
    '変更を捨てる：確定で欄が閉じ、保存しない',
  );
}

// ---- 狭い画面（390×844）と印刷 ----
async function narrow(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/items', 'table');
  const del = page.getByRole('button', { name: /を消す$/ }).first();
  await del.click();
  await shape(page, '390px・選択肢を消す');
  const box = await dialog(page).boundingBox();
  const btns = await page.locator('.confirm-actions .btn').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { l: r.left, r: r.right, w: r.width };
    }),
  );
  check(box && box.x >= 0 && box.x + box.width <= 390, '390px：横にはみ出さない', box);
  check(btns.length === 2 && btns.every((b) => b.w > 200), '390px：ボタンは幅いっぱいに縦に並ぶ', btns);
  await settle(page, 300);
  await page.screenshot({ path: path.join(OUT_DIR, 'dialog-items-390.png') });
  await page.emulateMedia({ media: 'print' });
  check(!(await dialog(page).isVisible()), '印刷では出さない');
  await page.emulateMedia({ media: 'screen' });
  await page.getByTestId('confirm-cancel').click();
  await settle(page);
  check((await dialog(page).count()) === 0, '390px：取り消すで閉じる');
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const errors = [];
  for (const step of [rules, dataReset, adopt, staffDiscard, narrow]) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    // 地図のタイルは外へ取りに行かない
    await ctx.route(/cyberjapandata\.gsi\.go\.jp|tile\.openstreetmap\.org/, (r) =>
      r.fulfill({ status: 204, body: '' }),
    );
    const page = await ctx.newPage();
    await page.clock.setFixedTime(NOW);
    page.on('pageerror', (e) => errors.push(String(e)));
    // ブラウザのネイティブのダイアログ（confirm・alert・prompt）が出たら失敗
    const native = [];
    page.on('dialog', (d) => {
      native.push(`${d.type()}: ${d.message()}`);
      d.dismiss().catch(() => {});
    });
    try {
      await step(page);
    } catch (e) {
      check(false, `${step.name}：途中で止まった`, String(e).split('\n')[0]);
      await page.screenshot({ path: path.join(OUT_DIR, `${step.name}-error.png`) }).catch(() => {});
    }
    check(native.length === 0, `${step.name}：ブラウザのダイアログを出さない`, native);
    await ctx.close();
  }
  check(errors.length === 0, 'ページのエラーが無い', errors);
  await browser.close();
  console.log(`スクリーンショット：${OUT_DIR}`);
  console.log(fails === 0 ? 'すべて OK' : `NG ${fails}件`);
  process.exit(fails === 0 ? 0 : 1);
})();
