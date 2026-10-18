// 区切り8b（PRD D189〜D193。ADR-0025 追記）を本物のブラウザで確かめる：
// 初回の案内ツアー（初めて開くと中央のカード・role="dialog"・aria-modal・見出しと本文・1 / 5・最初のフォーカスは「次へ」・
// 裏の inert とスクロールのロック・「戻る」は最初の枚で押せずフォーカスを「次へ」へ・Tab と Shift+Tab が中で回る・
// 開いている間は Ctrl+K でパレットを開かない・最後は「はじめる」で閉じて見たことを localStorage（DemoData と別のキー）に覚える・
// 読み直しても出ない・Esc と「とばす」でも覚える・データの画面の「案内をもう一度見る」で開き閉じるとフォーカスがボタンへ・
// 初期状態に戻しても見たことは残る・自動操作のブラウザ（navigator.webdriver）では自動で出ない・月の印刷の画面では出ない・
// 390px で収まる・印刷で出さない）、
// データの画面のファイル選択（すべて同じ部品・日本語のボタン「ファイルを選ぶ」と未選択の文・ブラウザ標準の input は見えない・
// 入力欄の名前（何を読み込むか＋ファイルを選ぶ）・Tab で届きフォーカスの枠・Space で選ぶ画面・控え（JSON）を選ぶと確認と
// ファイル名・取り消してもデータはそのまま・確定で読み込む・Excel の壊れたファイルは誤りの文・名簿の見出し）、
// 月の画面の日ごとの一覧（390px ははじめ一覧で横にはみ出さず土曜も見える・行の読み上げ・押すとその日の日の画面・
// カレンダーへ切り替えると URL の ?layout=calendar・読み直しても同じ・戻すと URL から消える・1400px ははじめカレンダー・
// ?layout=list で一覧・「休みを入れる」の行は押すと希望休を付け外し・印刷の画面は今のまま）。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-tour.cjs
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
const OUT_DIR = process.env.OUT_DIR || path.join(os.tmpdir(), 'e2e-tour');
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
const STORAGE_KEY = 'vrdemo:data:v1';
const TOUR_KEY = 'vrdemo:tour:seen';
fs.mkdirSync(OUT_DIR, { recursive: true });

let fails = 0;
function check(ok, name, info = '') {
  if (!ok) fails++;
  console.log(
    `${ok ? 'OK  ' : 'NG  '} ${name}${info === '' ? '' : `  ${typeof info === 'string' ? info : JSON.stringify(info)}`}`,
  );
}
const errors = [];
const native = [];
const tour = (page) => page.getByTestId('tour');
const visible = (loc) => loc.isVisible().catch(() => false);
const hashOf = (page) => decodeURIComponent(new URL(page.url()).hash);
/** フォーカスがツアーのカードの中か */
const focusInTour = (page) => page.evaluate(() => !!document.activeElement?.closest('[data-testid="tour"]'));
const activeTestId = (page) => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
const seenValue = (page) => page.evaluate((k) => localStorage.getItem(k), TOUR_KEY);

/** 新しいブラウザの文脈（localStorage は空）。human なら navigator.webdriver を false に見せる（人が初めて開いたとき） */
async function newPage(b, { human, width = 1400, height = 1000 }) {
  const ctx = await b.newContext({ viewport: { width, height } });
  if (human)
    await ctx.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
    });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  page.on('pageerror', (e) => {
    errors.push(String(e));
    console.log('ERR', String(e));
  });
  page.on('dialog', (d) => {
    if (d.type() === 'beforeunload') {
      d.accept();
      return;
    }
    native.push(`${d.type()}: ${d.message()}`);
    d.dismiss();
  });
  return { ctx, page };
}

async function open(page, hash, ready) {
  await page.goto('about:blank');
  await page.goto(`${BASE}#${hash}`);
  await page.locator(ready).first().waitFor({ timeout: 30000 });
}

// ---- ツアー：初めて開いたとき・枚の行き来・閉じる・覚える ----
async function tourFirst(b) {
  const { ctx, page } = await newPage(b, { human: true });
  await open(page, '/', '[data-testid="tour"]');
  const t = tour(page);
  const attrs = await t.evaluate((el) => ({
    role: el.getAttribute('role'),
    modal: el.getAttribute('aria-modal'),
    title: document.getElementById(el.getAttribute('aria-labelledby'))?.textContent,
    body: document.getElementById(el.getAttribute('aria-describedby'))?.textContent,
  }));
  check(
    attrs.role === 'dialog' && attrs.modal === 'true' && /今日やること/.test(attrs.title) && attrs.body.length > 10,
    'ツアー：初めて開くと出る（role=dialog・aria-modal・見出し・本文）',
    attrs,
  );
  check(/#\/home/.test(hashOf(page)), 'ツアー：裏はホーム', hashOf(page));
  check((await page.getByTestId('tour-count').innerText()).includes('1 / 5'), 'ツアー：1 / 5');
  check((await activeTestId(page)) === 'tour-next', 'ツアー：最初のフォーカスは「次へ」');
  check(await page.getByTestId('tour-back').isDisabled(), 'ツアー：最初の枚は「戻る」を押せない');
  const lock = await page.evaluate(() => ({
    inert: document.getElementById('root').inert,
    html: document.documentElement.style.overflow,
  }));
  check(lock.inert && lock.html === 'hidden', 'ツアー：裏は inert・巻かない', lock);
  // 中央のカード
  const box = await t.boundingBox();
  check(
    Math.abs(box.x + box.width / 2 - 700) < 4 && Math.abs(box.y + box.height / 2 - 500) < 40,
    'ツアー：画面の中央',
    box,
  );
  // Tab・Shift+Tab は中で回る
  let inside = true;
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    inside = inside && (await focusInTour(page));
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Shift+Tab');
    inside = inside && (await focusInTour(page));
  }
  check(inside, 'ツアー：Tab・Shift+Tab は中で回る');
  // 開いている間は Ctrl+K でパレットを開かない
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(200);
  check((await page.getByTestId('cmdk-wrap').count()) === 0, 'ツアー：開いている間は Ctrl+K で探す画面を開かない');
  // 次へ → 戻る
  await page.getByTestId('tour-next').click();
  check((await page.getByTestId('tour-count').innerText()).includes('2 / 5'), 'ツアー：次へで 2 / 5');
  check((await tour(page).getAttribute('data-step')) === 'plan', 'ツアー：2枚目は予定（月・週・日）');
  await page.getByTestId('tour-back').click();
  check((await page.getByTestId('tour-count').innerText()).includes('1 / 5'), 'ツアー：戻るで 1 / 5');
  check(
    (await activeTestId(page)) === 'tour-next',
    'ツアー：最初の枚へ戻って「戻る」が押せなくなるとフォーカスは「次へ」',
  );
  const keys = [];
  for (let i = 0; i < 4; i++) {
    keys.push(await tour(page).getAttribute('data-step'));
    await page.getByTestId('tour-next').click();
  }
  keys.push(await tour(page).getAttribute('data-step'));
  check(
    JSON.stringify(keys) === JSON.stringify(['home', 'plan', 'absence', 'rules', 'search']),
    'ツアー：5枚（ホーム・予定・欠勤・キャンセル・条件・探す）',
    keys,
  );
  check((await page.getByTestId('tour-title').innerText()).includes('Ctrl+K'), 'ツアー：最後は Ctrl+K で探せる');
  check(
    (await page.getByTestId('tour-next').innerText()).trim() === 'はじめる',
    'ツアー：最後の枚のボタンは「はじめる」',
  );
  check((await seenValue(page)) === null, 'ツアー：閉じるまでは覚えない');
  await page.screenshot({ path: path.join(OUT_DIR, 'tour-last.png') });
  await page.getByTestId('tour-next').click();
  await tour(page).waitFor({ state: 'detached' });
  const after = await page.evaluate(
    ([k, d]) => ({
      seen: localStorage.getItem(k),
      inert: document.getElementById('root').inert,
      html: document.documentElement.style.overflow,
      dataHasTour: (localStorage.getItem(d) ?? '').includes('tour'),
    }),
    [TOUR_KEY, STORAGE_KEY],
  );
  check(
    after.seen === '1' && !after.inert && after.html === '' && !after.dataHasTour,
    '「はじめる」で閉じ、見たことを DemoData と別のキーに覚える・裏の inert とロックを戻す',
    after,
  );
  // 読み直しても出ない
  await open(page, '/', '[data-testid="home-tasks"]');
  await page.waitForTimeout(500);
  check((await tour(page).count()) === 0, '読み直しても出ない（見たことを覚えている）');
  await ctx.close();
}

async function tourEscSkip(b) {
  // Esc
  {
    const { ctx, page } = await newPage(b, { human: true });
    await open(page, '/week', '[data-testid="tour"]');
    await page.getByTestId('tour-next').click();
    await page.keyboard.press('Escape');
    await tour(page).waitFor({ state: 'detached' });
    check((await seenValue(page)) === '1', 'Esc で閉じ、見たことを覚える');
    check(/#\/week/.test(hashOf(page)), 'Esc で閉じても画面はそのまま', hashOf(page));
    await ctx.close();
  }
  // とばす
  {
    const { ctx, page } = await newPage(b, { human: true });
    await open(page, '/', '[data-testid="tour"]');
    await page.getByTestId('tour-skip').click();
    await tour(page).waitFor({ state: 'detached' });
    check((await seenValue(page)) === '1', '「とばす」で閉じ、見たことを覚える');
    await ctx.close();
  }
  // 月の印刷の画面（メニューの外）では出ない
  {
    const { ctx, page } = await newPage(b, { human: true });
    await page.goto(`${BASE}#/month/print?ym=${YM}`);
    await page.locator('.mprint').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(400);
    check((await tour(page).count()) === 0, '月の印刷の画面では出ない');
    await ctx.close();
  }
}

async function tourAgain(b) {
  // 自動操作のブラウザ（e2e）では自動で出ない。データの画面から開ける
  const { ctx, page } = await newPage(b, { human: false });
  await open(page, '/', '[data-testid="home-tasks"]');
  await page.waitForTimeout(500);
  check(
    (await tour(page).count()) === 0,
    '自動操作のブラウザ（navigator.webdriver）では自動で出ない（ほかの e2e を止めない）',
  );
  await open(page, '/data', '[data-testid="tour-again"]');
  const btn = page.getByTestId('tour-again');
  await btn.click();
  await tour(page).waitFor();
  check(
    (await page.getByTestId('tour-count').innerText()).includes('1 / 5'),
    'データの「案内をもう一度見る」で1枚目から開く',
  );
  await page.keyboard.press('Escape');
  await tour(page).waitFor({ state: 'detached' });
  check((await activeTestId(page)) === 'tour-again', '閉じたらフォーカスは「案内をもう一度見る」へ');
  check((await seenValue(page)) === '1', 'もう一度見て閉じても見たまま');
  // 初期状態に戻しても見たことは残る
  await page.getByRole('button', { name: 'デモの初期状態に戻す' }).click();
  await page.getByTestId('confirm-ok').click();
  await page.locator('.toast').filter({ hasText: '初期状態に戻しました' }).waitFor();
  check((await seenValue(page)) === '1', '初期状態に戻しても見たことは残る（データとは別）');
  await ctx.close();
  // 人のブラウザで：見たあとに初期状態に戻して読み直しても出ない
  const h = await newPage(b, { human: true });
  await open(h.page, '/data', '[data-testid="tour"]');
  await h.page.getByTestId('tour-skip').click();
  await h.page.getByRole('button', { name: 'デモの初期状態に戻す' }).click();
  await h.page.getByTestId('confirm-ok').click();
  await h.page.locator('.toast').filter({ hasText: '初期状態に戻しました' }).waitFor();
  await h.page.waitForTimeout(600);
  await open(h.page, '/', '[data-testid="home-tasks"]');
  await h.page.waitForTimeout(500);
  check((await tour(h.page).count()) === 0, '初期状態に戻して読み直してもツアーは出ない');
  await h.ctx.close();
}

async function tourMobilePrint(b) {
  const { ctx, page } = await newPage(b, { human: true, width: 390, height: 844 });
  await open(page, '/', '[data-testid="tour"]');
  for (let i = 0; i < 5; i++) {
    const box = await tour(page).boundingBox();
    const btns = await page
      .locator('[data-testid="tour"] button')
      .evaluateAll((els) =>
        els.map((e) => e.getBoundingClientRect()).map((r) => ({ l: r.left, r: r.right, b: r.bottom })),
      );
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check(
      box.x >= 0 &&
        box.x + box.width <= 390 &&
        box.y >= 0 &&
        box.y + box.height <= 844 &&
        btns.every((x) => x.l >= 0 && x.r <= 390 && x.b <= 844) &&
        sw <= 390,
      `390px：${i + 1}枚目のカードとボタンが画面に収まる`,
      { box, sw },
    );
    if (i === 0) await page.screenshot({ path: path.join(OUT_DIR, 'tour-390.png') });
    if (i < 4) await page.getByTestId('tour-next').click();
  }
  await page.emulateMedia({ media: 'print' });
  check(!(await visible(tour(page))), '印刷ではツアーを出さない');
  await page.emulateMedia({ media: 'screen' });
  await ctx.close();
}

// ---- データの画面のファイル選択 ----
async function filePick(b) {
  const { ctx, page } = await newPage(b, { human: false });
  await open(page, '/data', '[data-testid="backup-file"]');
  const counts = await page.evaluate(() => ({
    all: document.querySelectorAll('input[type="file"]').length,
    pick: document.querySelectorAll('.file-pick input[type="file"]').length,
  }));
  check(counts.all === 2 && counts.pick === 2, 'ファイル選択は控え（JSON）と Excel の2つで、どちらも同じ部品', counts);
  const shape = await page.evaluate(() =>
    [...document.querySelectorAll('.file-pick')].map((el) => {
      const input = el.querySelector('input[type="file"]');
      const r = input.getBoundingClientRect();
      return {
        btn: el.querySelector('label.file-pick-btn')?.textContent.trim(),
        name: el.querySelector('.file-pick-name')?.textContent.trim(),
        inputW: r.width,
        opacity: getComputedStyle(input).opacity,
        display: getComputedStyle(input).display,
        label: (input.getAttribute('aria-labelledby') ?? '')
          .split(' ')
          .map((id) => document.getElementById(id)?.textContent.trim())
          .join(' '),
        desc: document.getElementById(input.getAttribute('aria-describedby'))?.textContent.trim(),
      };
    }),
  );
  check(
    shape.every((s) => s.btn === 'ファイルを選ぶ' && s.name === 'ファイルを選んでいません'),
    '日本語のボタン「ファイルを選ぶ」と未選択の文',
    shape,
  );
  check(
    shape.every((s) => s.inputW <= 1 && s.opacity === '0' && s.display !== 'none'),
    'ブラウザ標準の input（Choose File）は見えない形で残す（display: none にしない）',
  );
  check(
    shape[0].label === '読み込む控え（JSON） ファイルを選ぶ' && shape[0].desc === 'ファイルを選んでいません',
    '入力欄の名前は「何を読み込むか＋ファイルを選ぶ」、説明は選んだファイルの文',
    shape[0],
  );
  check(/読み込む Excel/.test(shape[1].label), 'Excel の入力欄の名前', shape[1].label);
  check(
    (await page.getByRole('button', { name: '読み込む控え（JSON） ファイルを選ぶ', exact: true }).count()) === 1,
    '読み上げの木で入力欄が名前付きのボタン（「読み込む控え（JSON） ファイルを選ぶ」）',
  );
  // キーボード：「ファイルに書き出す」から Tab で入力欄へ・枠が見える・Space で選ぶ画面
  await page.getByRole('button', { name: 'ファイルに書き出す' }).focus();
  await page.keyboard.press('Tab');
  check((await activeTestId(page)) === 'backup-file-input', 'Tab で控えの入力欄に届く');
  const outline = await page
    .locator('[data-testid="backup-file"] label.file-pick-btn')
    .evaluate((el) => getComputedStyle(el).outlineStyle);
  check(outline === 'solid', 'フォーカスしているときはボタンの見た目に枠', outline);
  // Space で選ぶ画面（filechooser）。まれに最初の1回を取りこぼすので、出なければもう1回だけ押す
  let chosen = null;
  for (let i = 0; i < 2 && !chosen; i++) {
    const chooser = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
    await page.keyboard.press('Space');
    chosen = await chooser;
  }
  check(chosen !== null, 'Space でファイルを選ぶ画面が開く');
  // 控え（JSON）を選ぶ：確認 → 取り消すでデータはそのまま、文はファイル名
  const json = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  const before = json;
  await page
    .getByTestId('backup-file-input')
    .setInputFiles({ name: 'ひかえ.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.getByTestId('confirm-dialog').waitFor();
  const title = await page.getByTestId('confirm-title').innerText();
  check(title.includes('「ひかえ.json」'), '選ぶと確認（ファイル名入り）', title);
  await page.getByTestId('confirm-cancel').click();
  await page.waitForTimeout(400);
  check(
    (await page.getByTestId('backup-file-name').innerText()) === '選んだファイル：ひかえ.json',
    '選んだファイル名を出す',
  );
  check((await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)) === before, '取り消すとデータはそのまま');
  // 同じファイルをもう一度選べる（input の値は空に戻す）→ 確定で読み込む
  check((await page.getByTestId('backup-file-input').inputValue()) === '', '選んだあと input の値は空に戻す');
  await page
    .getByTestId('backup-file-input')
    .setInputFiles({ name: 'ひかえ.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.getByTestId('confirm-ok').click();
  await page.locator('.toast').filter({ hasText: '読み込みました' }).waitFor({ timeout: 5000 });
  check(true, '同じファイルをもう一度選んで確定すると読み込む');
  // Excel：壊れたファイルは誤りの文（データはそのまま）
  await page
    .getByTestId('excel-file-input')
    .setInputFiles({ name: 'こわれた.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('not a book') });
  await page.locator('.error').filter({ hasText: '読み込めませんでした' }).first().waitFor({ timeout: 10000 });
  check(
    (await page.getByTestId('excel-file-name').innerText()) === '選んだファイル：こわれた.xlsx',
    'Excel：選んだファイル名と誤りの文',
  );
  // 名簿にすると見出しが変わる
  await page
    .getByTestId('excel-kind')
    .getByRole('button', { name: /利用者さんの名簿/ })
    .click();
  check(
    (await page.locator('[data-testid="excel-file"] .file-pick-caption').innerText()) ===
      '読み込む利用者さんの名簿（Excel）',
    'Excel：名簿の見出し（呼び方）',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'data-file-pick.png'), fullPage: true });
  // 390px：横にはみ出さない
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  const bb = await page.locator('[data-testid="backup-file"] label.file-pick-btn').boundingBox();
  check(sw <= 390 && bb.x >= 0 && bb.x + bb.width <= 390, '390px：ファイル選択が収まる', { sw, bb });
  await ctx.close();
}

// ---- 月の画面の日ごとの一覧 ----
async function monthList(b) {
  const { ctx, page } = await newPage(b, { human: false, width: 390, height: 844 });
  await open(page, `/month?ym=${YM}`, '[data-testid="month-layout"]');
  await page.locator('[data-testid="month-list-day"]').first().waitFor({ timeout: 30000 });
  check(
    (await page.getByTestId('month-grid').count()) === 0,
    '390px：はじめは日ごとの一覧（カレンダーの表を出さない）',
  );
  const pressed = await page
    .locator('[data-testid="month-layout"] button')
    .evaluateAll((els) => els.map((e) => `${e.dataset.layout}:${e.getAttribute('aria-pressed')}`));
  check(pressed.join(',') === 'calendar:false,list:true', '切り替えの aria-pressed', pressed);
  const rows = page.getByTestId('month-list-day');
  const n = await rows.count();
  const last = new Date(Date.UTC(Number(YM.slice(0, 4)), Number(YM.slice(5, 7)), 0)).getUTCDate();
  check(n === last, `一覧は月の日数（${last}日）の行`, n);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  const widths = await rows.evaluateAll(
    (els) => els.map((e) => e.getBoundingClientRect()).filter((r) => r.left < 0 || r.right > 390).length,
  );
  check(sw <= 390 && widths === 0, '390px：一覧は横にはみ出さない', { sw, widths });
  const sat = await rows.filter({ hasText: '（土）' }).count();
  check(sat >= 4, '390px：土曜の行も見える', sat);
  // 行の読み上げ：日付・件数・状態
  const today = rows.filter({ has: page.locator('.month-today') });
  const label = await today.getAttribute('aria-label');
  check(
    /今日/.test(label) && /(訪問 \d+件|訪問なし)/.test(label) && /(案なし|案あり|確定済み|未確定|訪問なし)/.test(label),
    '行の読み上げ（日付・今日・件数・状態）',
    label,
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'month-list-390.png') });
  // カレンダーへ切り替え：URL に ?layout=calendar、読み直しても同じ
  await page.locator('[data-testid="month-layout"] button[data-layout="calendar"]').click();
  await page.getByTestId('month-grid').waitFor();
  check(/layout=calendar/.test(hashOf(page)), 'カレンダーへ切り替えると URL に ?layout=calendar', hashOf(page));
  await page.reload();
  await page.getByTestId('month-grid').waitFor({ timeout: 30000 });
  check((await page.getByTestId('month-list').count()) === 0, '読み直してもカレンダーのまま');
  await page.locator('[data-testid="month-layout"] button[data-layout="list"]').click();
  await page.getByTestId('month-list').waitFor();
  check(!/layout=/.test(hashOf(page)), '一覧へ戻すと URL から ?layout= を消す（390px の既定）', hashOf(page));
  // 行を押すとその日の日の画面
  const target = await rows.nth(Math.min(n - 1, 20)).getAttribute('data-date');
  await page.locator(`[data-testid="month-list-day"][data-date="${target}"]`).click();
  await page.waitForURL(/#\/plan/);
  const sel = await page.locator('.date-switch select').inputValue();
  check(sel === target, '行を押すとその日の日の画面', { sel, target });
  // 「休みを入れる」：〈スタッフ〉を選んで、勤務日の行を押すと希望休を付け外し
  await open(page, `/month?ym=${YM}`, '[data-testid="month-list"]');
  const staffOpt = await page
    .locator('[data-testid="month-focus"] option')
    .evaluateAll((els) => els.map((e) => e.value).find((v) => v.startsWith('staff:')));
  await page.getByTestId('month-focus').selectOption(staffOpt);
  await page.getByTestId('month-off-toggle').click();
  const openRow = page.locator('[data-testid="month-list-day"][data-off="open"]').first();
  await openRow.waitFor({ timeout: 10000 });
  const offDate = await openRow.getAttribute('data-date');
  await openRow.click();
  const row = page.locator(`[data-testid="month-list-day"][data-date="${offDate}"]`);
  await page.waitForTimeout(400);
  check(
    (await row.getAttribute('data-off')) === 'requested' && (await row.getAttribute('aria-pressed')) === 'true',
    '「休みを入れる」：行を押すと希望休（マスと同じ動き）',
  );
  await row.click();
  await page.waitForTimeout(400);
  check((await row.getAttribute('data-off')) === 'open', '「休みを入れる」：もう一度押すと外す');
  check(/#\/month/.test(hashOf(page)), '「休みを入れる」の間は日の画面へ移らない');
  // 広い画面：はじめカレンダー、?layout=list で一覧
  await page.setViewportSize({ width: 1400, height: 1000 });
  await open(page, `/month?ym=${YM}`, '[data-testid="month-grid"]');
  check((await page.getByTestId('month-list').count()) === 0, '1400px：はじめはカレンダー');
  await open(page, `/month?ym=${YM}&layout=list`, '[data-testid="month-list"]');
  check((await page.getByTestId('month-grid').count()) === 0, '1400px：?layout=list で一覧');
  // 月の印刷の画面は今のまま（カレンダーの表）
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}#/month/print?ym=${YM}`);
  await page.locator('.mprint').first().waitFor({ timeout: 30000 });
  check(
    (await page.getByTestId('month-list').count()) === 0 && (await page.locator('.mprint table').count()) > 0,
    '月の印刷の画面は今のまま（一覧にしない）',
  );
  await open(page, `/month?ym=${YM}`, '[data-testid="month-layout"]');
  await page.emulateMedia({ media: 'print' });
  check(!(await visible(page.getByTestId('month-layout'))), '印刷では切り替えを出さない');
  await page.emulateMedia({ media: 'screen' });
  await ctx.close();
}

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  for (const [name, fn] of [
    ['tour-first', tourFirst],
    ['tour-esc-skip', tourEscSkip],
    ['tour-again', tourAgain],
    ['tour-mobile-print', tourMobilePrint],
    ['file-pick', filePick],
    ['month-list', monthList],
  ]) {
    try {
      await fn(b);
    } catch (e) {
      check(false, name, String(e.message || e));
    }
  }
  check(native.length === 0, 'ブラウザのダイアログを出さない', native);
  await b.close();
  console.log(`スクリーンショット：${OUT_DIR}`);
  const ng = fails + errors.length;
  console.log(ng === 0 ? '全部通った' : `${fails} 件が通らない・ページのエラー ${errors.length} 件`);
  process.exit(ng === 0 ? 0 : 1);
})();
