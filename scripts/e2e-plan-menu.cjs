// 日の画面の「案を変える ▾」を目的の言葉で選べるようにしたこと（PRD D156〜D159。ADR-0025 追記）を本物のブラウザで確かめる：
// 項目の並び（AI に作らせる／別の考え方（プリセット）に切り替える／比べる・戻す／そのほか の4つのまとまり。role="group"・aria-label）、
// 各項目の1行の説明（aria-describedby）、手直し・固定が無いときの押せない理由（見える文と aria-disabled。押しても何もしない）、
// キーボード（開くと先頭・↑↓・Home・End・Esc でボタンへ戻る・↑で開くと最後・Tab で閉じる）、
// 手直し・固定があるとき（説明に「手直しと固定は消えます」、作り直すは独自の確認ダイアログで取り消せば何も変わらずフォーカスはボタンへ、
// 「AI が出したままに戻す」は確認して固定が消える）、「2つの案を比べる」で比較の画面へ、案が1つの比較の画面の「もう1案作って比べる」
// （今ある案と同じ考え方は選択肢に出ない・作ると記録が2件で A＝今ある案・B＝作った案・今の案は変わらない）、
// プリセットが1つだけのときの作れない理由、390px で一覧と「もう1案作って比べる」が画面に収まる、ブラウザの確認を出さない。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-plan-menu.cjs
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
const OUT_DIR = process.env.OUT_DIR || path.join(os.tmpdir(), 'e2e-plan-menu');
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
/** 保存（少し遅れて書く）が条件を満たすまで待つ（満たさなければ時間切れで続ける） */
async function waitStored(page, pred, arg, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const d = await stored(page);
    if (d && pred(d, arg)) return;
    await page.waitForTimeout(100);
  }
}
const hashOf = (page) => decodeURIComponent(new URL(page.url()).hash);
const dialog = (page) => page.getByTestId('confirm-dialog');
const menuBtn = (page) => page.getByTestId('plan-menu');
const menuList = (page) => page.getByTestId('plan-menu-list');
/** いまフォーカスのある要素の data-testid（無ければ data-key） */
const focusedId = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el ? (el.getAttribute('data-testid') ?? el.getAttribute('data-key') ?? el.tagName) : '';
  });

/** 日の画面を開き、今の案が出て計算が終わるまで待つ */
async function openPlan(page) {
  await page.goto(`${BASE}#/plan`);
  await page.reload();
  await page.getByTestId('confirm-state').waitFor({ timeout: 60000 });
  await page.getByTestId('plan-progress').waitFor({ state: 'detached', timeout: 60000 });
  await settle(page, 300);
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
/** 開いたメニューの中身：まとまり（見出し）と項目（名前・説明・押せないか） */
async function menuShape(page) {
  return menuList(page).evaluate((list) => {
    const text = (ids) =>
      (ids ?? '')
        .split(' ')
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .trim();
    return {
      role: list.getAttribute('role'),
      groups: [...list.querySelectorAll('[role="group"]')].map((g) => ({
        label: g.getAttribute('aria-label'),
        items: g.querySelectorAll('[role="menuitem"]').length,
      })),
      items: [...list.querySelectorAll('[role="menuitem"]')].map((el) => ({
        key: el.getAttribute('data-key'),
        name: text(el.getAttribute('aria-labelledby')),
        desc: text(el.getAttribute('aria-describedby')),
        disabled: el.getAttribute('aria-disabled') === 'true',
        visibleDesc: el.querySelector('.menu-item-desc')?.textContent ?? '',
      })),
    };
  });
}
const item = (shape, key) => shape.items.find((x) => x.key === key);

// ---- 手直しの無い今の案：並び・説明・押せない理由・キーボード ----
async function plain(page) {
  await editData(page, (key) => localStorage.removeItem(key), STORAGE_KEY);
  await openPlan(page);
  const btn = menuBtn(page);
  check((await btn.getAttribute('aria-haspopup')) === 'menu', 'ボタン：aria-haspopup="menu"');
  await btn.click();
  await menuList(page).waitFor();
  const s = await menuShape(page);
  check(s.role === 'menu', '一覧：role="menu"');
  check(
    JSON.stringify(s.groups.map((g) => g.label)) ===
      JSON.stringify(['AI に作らせる', '別の考え方（プリセット）に切り替える', '比べる・戻す', 'そのほか']),
    '並び：目的の4つのまとまり（見出しは role="group" の aria-label）',
    s.groups,
  );
  const keys = s.items.map((x) => x.key);
  check(
    keys[0] === 'create' &&
      keys[1] === 'resolve' &&
      keys.slice(2, -5).every((k) => k.startsWith('preset-')) &&
      JSON.stringify(keys.slice(-5)) === JSON.stringify(['batch', 'compare', 'revert', 'copy', 'tune']),
    '並び：作らせる→手で動かした所は残す→考え方→まとめて作る→比べる→戻す→コピー→条件',
    keys,
  );
  check(item(s, 'create')?.name === 'AI にもう一度作らせる', '名前：「AI にもう一度作らせる」', item(s, 'create'));
  check(
    item(s, 'resolve')?.name === '手で動かした所は残して、ほかを作り直す',
    '名前：「手で動かした所は残して、ほかを作り直す」',
  );
  check(/^2つの案を比べる/.test(item(s, 'compare')?.name ?? ''), '名前：「2つの案を比べる」（件数つき）');
  check(item(s, 'revert')?.name === 'AI が出したままに戻す', '名前：「AI が出したままに戻す」');
  check(
    s.items.every((x) => x.desc.length > 0 && x.visibleDesc.length > 0),
    'どの項目にも1行の説明（見える文と aria-describedby）',
    s.items.filter((x) => !x.desc).map((x) => x.key),
  );
  check(
    !/消えます/.test(item(s, 'create')?.desc ?? '') && /今の条件（標準）/.test(item(s, 'create')?.desc ?? ''),
    '説明：手直しが無いときは「消えます」を書かない・今の条件の名前',
    item(s, 'create')?.desc,
  );
  check(
    item(s, 'resolve')?.disabled && /固定した訪問がありません/.test(item(s, 'resolve')?.visibleDesc ?? ''),
    '固定が無い：「手で動かした所は残して…」は押せず、理由を見える文で',
    item(s, 'resolve'),
  );
  check(
    item(s, 'revert')?.disabled && /手直し・固定はありません/.test(item(s, 'revert')?.visibleDesc ?? ''),
    '手直しが無い：「AI が出したままに戻す」は押せず、理由を見える文で',
    item(s, 'revert'),
  );
  check(/案がまだ1つ/.test(item(s, 'compare')?.desc ?? ''), '比べる：案が1つなら比較の画面で作れると書く');
  await page.screenshot({ path: path.join(OUT_DIR, 'menu-plain.png') });
  // キーボード：開くと先頭・↓・End・Home・Esc でボタンへ
  check(
    (await focusedId(page)) === 'plan-menu-create',
    'キーボード：開くと先頭の項目へフォーカス',
    await focusedId(page),
  );
  await page.keyboard.press('ArrowDown');
  check((await focusedId(page)) === 'plan-menu-resolve', 'キーボード：↓で次（押せない項目にも移る）');
  await page.keyboard.press('End');
  check((await focusedId(page)) === 'plan-menu-tune', 'キーボード：End で最後');
  await page.keyboard.press('ArrowDown');
  check((await focusedId(page)) === 'plan-menu-create', 'キーボード：最後から↓で先頭へ回る');
  await page.keyboard.press('Home');
  check((await focusedId(page)) === 'plan-menu-create', 'キーボード：Home で先頭');
  // 押せない項目は押しても何もしない（一覧も閉じない・確認も出ない）
  await page.getByTestId('plan-menu-revert').click({ force: true });
  await settle(page);
  check(
    (await menuList(page).isVisible()) && (await dialog(page).count()) === 0,
    '押せない項目を押しても何もしない（閉じない・確認を出さない）',
  );
  await page.getByTestId('plan-menu-revert').focus();
  await page.keyboard.press('Escape');
  await menuList(page).waitFor({ state: 'detached' });
  check((await focusedId(page)) === 'plan-menu', 'キーボード：Esc で閉じてボタンへ戻る');
  check((await btn.getAttribute('aria-expanded')) === 'false', 'ボタン：閉じたら aria-expanded="false"');
  await page.keyboard.press('ArrowUp');
  await menuList(page).waitFor();
  check((await focusedId(page)) === 'plan-menu-tune', 'キーボード：ボタンで↑を押すと最後の項目から開く');
  await page.keyboard.press('Tab');
  await menuList(page).waitFor({ state: 'detached' });
  check(true, 'キーボード：Tab で閉じる');
}

// ---- 手直し・固定があるとき：説明・確認ダイアログ・戻す ----
async function edited(page) {
  // 今の案の最初の訪問を、その担当のまま固定にする（手で動かしたのと同じ。PRD D18）
  await editData(
    page,
    ([key, date]) => {
      const d = JSON.parse(localStorage.getItem(key));
      const plan = d.aiPlans[date];
      const [sid, ids] = Object.entries(plan.routes).find(([, v]) => v.length > 0);
      plan.pins = { [ids[0]]: sid };
      localStorage.setItem(key, JSON.stringify(d));
    },
    [STORAGE_KEY, TODAY],
  );
  await openPlan(page);
  const before = (await stored(page)).aiPlans[TODAY];
  await menuBtn(page).click();
  await menuList(page).waitFor();
  const s = await menuShape(page);
  check(
    /手直しと固定は消えます/.test(item(s, 'create')?.desc ?? ''),
    '手直しあり：「AI にもう一度作らせる」の説明に「手直しと固定は消えます」',
    item(s, 'create')?.desc,
  );
  check(
    !item(s, 'resolve')?.disabled && /固定した 1件の担当はそのまま/.test(item(s, 'resolve')?.desc ?? ''),
    '固定あり：「手で動かした所は残して…」は押せて、固定の件数を書く',
    item(s, 'resolve'),
  );
  check(!item(s, 'revert')?.disabled, '手直しあり：「AI が出したままに戻す」は押せる');
  check(
    s.items
      .filter((x) => x.key.startsWith('preset-') && !x.disabled)
      .every((x) => /手直しと固定は消えます/.test(x.desc)),
    '手直しあり：考え方に切り替える項目の説明にも「消えます」',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'menu-edited.png') });
  // 作り直す：確認ダイアログ（取り消せば何も変わらない・フォーカスはボタンへ）
  await page.getByTestId('plan-menu-create').click();
  await dialog(page).waitFor({ timeout: 5000 });
  const title = await page.getByTestId('confirm-title').innerText();
  check(/手直しと固定を捨てて/.test(title), '作り直す：独自の確認ダイアログで確かめる', title);
  await page.keyboard.press('Escape');
  await dialog(page).waitFor({ state: 'detached' });
  await settle(page);
  const after = (await stored(page)).aiPlans[TODAY];
  check(
    JSON.stringify(after.pins) === JSON.stringify(before.pins) && after.createdAt === before.createdAt,
    '作り直す：取り消すと何も変わらない（固定も案もそのまま）',
  );
  check((await page.getByTestId('plan-progress').count()) === 0, '作り直す：取り消すと計算を始めない');
  check(
    (await focusedId(page)) === 'plan-menu',
    '作り直す：閉じたらフォーカスは「案を変える」へ',
    await focusedId(page),
  );
  // 戻す：確認して固定が消える
  await menuBtn(page).click();
  await menuList(page).waitFor();
  await page.getByTestId('plan-menu-revert').click();
  await dialog(page).waitFor({ timeout: 5000 });
  check(
    /AIが出したままの案に戻しますか/.test(await page.getByTestId('confirm-title').innerText()),
    '戻す：確認ダイアログ',
  );
  await page.getByTestId('confirm-ok').click();
  await dialog(page).waitFor({ state: 'detached' });
  await waitStored(page, (d, date) => Object.keys(d.aiPlans[date].pins).length === 0, TODAY);
  const reverted = (await stored(page)).aiPlans[TODAY];
  check(Object.keys(reverted.pins).length === 0, '戻す：固定が消える', reverted.pins);
  await menuBtn(page).click();
  await menuList(page).waitFor();
  const s2 = await menuShape(page);
  check(item(s2, 'revert')?.disabled && item(s2, 'resolve')?.disabled, '戻したあと：戻す・残して作り直すは押せない');
  await page.keyboard.press('Escape');
}

// ---- 比較：「2つの案を比べる」から入り、案が1つなら「もう1案作って比べる」 ----
async function compareMore(page) {
  await editData(page, (key) => localStorage.removeItem(key), STORAGE_KEY);
  await openPlan(page);
  const before = (await stored(page)).aiPlans[TODAY];
  const runs0 = (await stored(page)).aiRuns[TODAY] ?? [];
  check(runs0.length === 1, '比較の前：この日の案は1つ（開いたときに標準で作った案）', runs0.length);
  await menuBtn(page).click();
  await menuList(page).waitFor();
  await page.getByTestId('plan-menu-compare').click();
  await page.waitForURL(/#\/compare/, { timeout: 5000 });
  check(hashOf(page) === '#/compare', '「2つの案を比べる」で比較の画面へ', hashOf(page));
  const box = page.getByTestId('compare-another');
  await box.waitFor({ timeout: 10000 });
  const opts = await page
    .getByTestId('compare-another-select')
    .locator('option')
    .evaluateAll((os) => os.map((o) => o.textContent));
  check(
    opts.length >= 1 && !opts.some((o) => /^標準/.test(o ?? '')),
    '案が1つ：選択肢に今ある案と同じ考え方（標準）は出ない',
    opts,
  );
  check(
    (await page.getByTestId('compare-another-make').innerText()).includes('もう1案作って比べる'),
    '案が1つ：「もう1案作って比べる」のボタン',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'compare-one.png') });
  await page.getByTestId('compare-another-make').click();
  await page.getByTestId('compare-another-progress').waitFor({ timeout: 5000 });
  check(true, '作っている間は進み具合と「止める」');
  await page.locator('.runs-table tbody tr').nth(1).waitFor({ timeout: 60000 });
  await waitStored(page, (d, date) => (d.aiRuns[date] ?? []).length === 2, TODAY);
  const d = await stored(page);
  const runs = d.aiRuns[TODAY] ?? [];
  check(runs.length === 2, '作ると記録が2件', runs.length);
  check(runs[1] && `${runs[1].label}で作る` === opts[0], '作った案は選んだ考え方（先頭の選択肢）', {
    label: runs[1]?.label,
    want: opts[0],
  });
  const ab = await page.locator('.runs-table tbody tr').evaluateAll((rows) =>
    rows.map((r) => ({
      a: r.querySelector('input[name="pick-a"]')?.checked,
      b: r.querySelector('input[name="pick-b"]')?.checked,
    })),
  );
  check(ab[0]?.a && ab[1]?.b, 'A＝今ある案、B＝作った案に並ぶ', ab);
  check((await page.getByTestId('compare-another').count()) === 0, '2つになったら「もう1案作って比べる」は消える');
  check(
    d.aiPlans[TODAY].runId === before.runId && JSON.stringify(d.rules) === JSON.stringify((await stored(page)).rules),
    '今の案は変わらない（記録に足すだけ）',
  );
  check(/A と B に並べています/.test(await page.locator('.toast').first().innerText()), '作ったら知らせ（トースト）');
  await page.screenshot({ path: path.join(OUT_DIR, 'compare-two.png') });
  // 日の画面に戻ると「2つの案を比べる」の説明が件数に
  await openPlan(page);
  await menuBtn(page).click();
  await menuList(page).waitFor();
  const s = await menuShape(page);
  check(
    /2件/.test(item(s, 'compare')?.desc ?? ''),
    '日の画面：比べるの説明が「この日に作った案（2件）」に',
    item(s, 'compare'),
  );
  await page.keyboard.press('Escape');
}

// ---- プリセットが1つで、今ある案と同じ条件：作れない理由を出す ----
async function compareNoOption(page) {
  await editData(page, (key) => localStorage.removeItem(key), STORAGE_KEY);
  await openPlan(page);
  await editData(
    page,
    (key) => {
      const d = JSON.parse(localStorage.getItem(key));
      d.presets = d.presets.filter((p) => p.id === d.scorePresetId);
      localStorage.setItem(key, JSON.stringify(d));
    },
    STORAGE_KEY,
  );
  await page.goto(`${BASE}#/compare`);
  await page.getByTestId('compare-another').waitFor({ timeout: 10000 });
  const why = await page.getByTestId('compare-another-why').innerText();
  check(/同じ条件になります/.test(why), 'プリセットが1つ：作れない理由と次の一手（条件を調整する）', why);
  check((await page.getByTestId('compare-another-make').count()) === 0, 'プリセットが1つ：作るボタンは出さない');
}

// ---- スマホ（390×844）：一覧と「もう1案作って比べる」が画面に収まる ----
async function mobile(page) {
  await editData(page, (key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.setViewportSize({ width: 390, height: 844 });
  await openPlan(page);
  await menuBtn(page).scrollIntoViewIfNeeded();
  await menuBtn(page).click();
  await menuList(page).waitFor();
  await settle(page);
  const r = await menuList(page).boundingBox();
  check(r && r.x >= 0 && r.x + r.width <= 390, '390px：一覧が画面の幅に収まる', r);
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  check(scrollW <= 390, '390px：横にはみ出さない', scrollW);
  await page.screenshot({ path: path.join(OUT_DIR, 'mobile-menu.png') });
  await page.keyboard.press('Escape');
  await page.goto(`${BASE}#/compare`);
  await page.getByTestId('compare-another').waitFor({ timeout: 10000 });
  const b = await page.getByTestId('compare-another-make').boundingBox();
  check(b && b.x >= 0 && b.x + b.width <= 390, '390px：「もう1案作って比べる」が収まる', b);
  const scrollW2 = await page.evaluate(() => document.documentElement.scrollWidth);
  check(scrollW2 <= 390, '390px：比較の画面も横にはみ出さない', scrollW2);
  await page.getByTestId('compare-another').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT_DIR, 'mobile-compare.png') });
  await page.emulateMedia({ media: 'print' });
  check(!(await page.getByTestId('compare-another').isVisible()), '印刷：「もう1案作って比べる」を出さない');
  await page.emulateMedia({ media: 'screen' });
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
  // ブラウザのダイアログ（confirm・alert・prompt）が出たら失敗（PRD D146）
  const native = [];
  page.on('dialog', (d) => {
    if (d.type() === 'beforeunload') {
      d.accept();
      return;
    }
    native.push(`${d.type()}: ${d.message()}`);
    d.dismiss();
  });
  for (const [name, fn] of [
    ['plain', plain],
    ['edited', edited],
    ['compare-more', compareMore],
    ['compare-no-option', compareNoOption],
    ['mobile', mobile],
  ]) {
    try {
      await fn(page);
    } catch (e) {
      check(false, name, String(e.message || e));
      await page.screenshot({ path: path.join(OUT_DIR, `fail-${name}.png`) }).catch(() => {});
    }
  }
  check(native.length === 0, 'ブラウザのダイアログを出さない', native);
  await b.close();
  console.log(`スクリーンショット：${OUT_DIR}`);
  const ng = fails + errors.length;
  console.log(ng === 0 ? '全部通った' : `${fails} 件が通らない・ページのエラー ${errors.length} 件`);
  process.exit(ng === 0 ? 0 : 1);
})();
