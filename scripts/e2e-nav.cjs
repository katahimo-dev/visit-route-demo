// メニューの用途ごとの並びとコマンドパレット（PRD D178〜D183。ADR-0027）を本物のブラウザで確かめる：
// メニュー（グループの見出しと並び・名前（〈利用者さん〉一覧・〈スタッフ〉一覧）・同じ名前が無い・aria-current（比較は「案を比べる」、
// 欠勤・キャンセルは印を付けず今日の日の画面の欄を開く）・画面の見出しがメニューの名前とそろう）、
// コマンドパレット（Ctrl+K で開く・role=dialog・aria-modal・combobox と listbox（aria-activedescendant）・裏の inert とスクロールのロック・
// 打つと絞り込む・↑↓（端で回る）・Enter で移る・操作（欠勤・キャンセル）・人の名前（よみ・カタカナ）で閲覧の欄・Esc とフォーカスの戻り・
// 背景で閉じる・Tab が中で回る・Ctrl+K で閉じる・入力欄の中の Ctrl+K（入れた文字はそのまま・閉じたら入力欄へ）・右の欄が開いているときは開かない）、
// 390px（上の帯のボタンから開ける・収まる・上の帯の名前・引き出しの並び・下のタブ）、印刷で出さない、300人×60人で打つたびの速さ。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-nav.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）。PERF_MS_NAV で1文字打って描き終わるまでの上限（既定 100ms。無ければ PERF_MS）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { skipTour } = require('./lib/tourSeen.cjs');
const { answerConfirms } = require('./lib/confirmDialog.cjs');
const {
  launch,
  BASE,
  OUT_DIR,
  NOW,
  TODAY,
  STORAGE_KEY,
  perfMs,
  check,
  hashOf,
  isFocused,
  failShot,
  run,
} = require('./lib/env.cjs');

const PERF_MS = perfMs('PERF_MS_NAV', 100);

const palette = (page) => page.getByTestId('cmdk');
const input = (page) => page.getByTestId('cmdk-input');
const options = (page) => page.getByTestId('cmdk-option');
const rootInert = (page) => page.evaluate(() => document.getElementById('root').inert);

/** 画面を新しく開く（about:blank を挟み、`?do=`・`?id=` を読み直す前に消さない） */
async function open(page, hash, ready = 'h1') {
  await page.goto('about:blank');
  await page.goto(`${BASE}#${hash}`);
  await page.locator(ready).first().waitFor({ timeout: 30000 });
  await page.locator('h1').filter({ hasText: /\S/ }).first().waitFor({ timeout: 30000 });
}
/** パレットの今の候補（名前・種類・選んでいるか） */
async function listed(page) {
  return options(page).evaluateAll((els) =>
    els.map((el) => ({
      label: el.querySelector('.cmdk-option-label').textContent,
      kind: el.dataset.kind,
      selected: el.getAttribute('aria-selected') === 'true',
      id: el.id,
    })),
  );
}
/** 打つ（1文字ずつ。IME は使わない） */
async function type(page, text) {
  await input(page).fill('');
  await input(page).pressSequentially(text, { delay: 20 });
  await page.waitForTimeout(100);
}
/** seed の人（〈利用者さん〉の先頭・〈スタッフ〉の先頭） */
async function seedPeople(page) {
  return page.evaluate((key) => {
    const d = JSON.parse(localStorage.getItem(key));
    const c = d.clients.find((x) => x.stage === 'active' && x.kana);
    const s = d.staff.find((x) => x.active);
    return { client: { id: c.id, name: c.displayName, kana: c.kana }, staff: { id: s.id, name: s.name } };
  }, STORAGE_KEY);
}
/** ひらがな → カタカナ */
const toKata = (s) => s.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));

// 最後のグループ「管理者」（管理者設定・データ。PRD D210。ADR-0028）
const GROUPS = ['予定を組む', '当日の対応', '問い合わせ', '人の情報', 'AI の考え方', '管理者'];
const LABELS = [
  'ホーム',
  '月',
  '週',
  '日',
  '案を比べる',
  '欠勤・キャンセル',
  '空き状況',
  '利用者さん一覧',
  '相性',
  'スタッフ一覧',
  '稼働時間',
  '稼働の見込み',
  '条件の重み',
  '訪問の種類',
  '特性の項目',
  '管理者設定',
  'データ',
];

// ---- メニューの並び・名前・aria-current（1400px）----
async function menu(page) {
  await open(page, '/home');
  const side = page.locator('.side-nav');
  const titles = await side.locator('h2.nav-group-title').allInnerTexts();
  check(JSON.stringify(titles) === JSON.stringify(GROUPS), 'メニュー：グループの見出しが用途の順（h2）', titles);
  const labels = (await side.getByTestId('nav-link').allInnerTexts()).map((t) => t.trim());
  check(JSON.stringify(labels) === JSON.stringify(LABELS), 'メニュー：項目の並びと名前', labels);
  check(new Set(labels).size === labels.length, 'メニュー：同じ名前の項目が無い（「一覧・編集」が2つ並ばない）');
  const current = async () => (await side.locator('[aria-current="page"]').allInnerTexts()).map((t) => t.trim());
  check(JSON.stringify(await current()) === '["ホーム"]', 'aria-current：ホーム');
  await open(page, '/compare');
  check(JSON.stringify(await current()) === '["案を比べる"]', 'aria-current：比較は「案を比べる」（日ではない）');
  check((await page.locator('h1').innerText()).trim() === '案を比べる', '比較の見出しはメニューと同じ「案を比べる」');
  await open(page, '/plan', '[data-testid="sudden-open"]');
  check(
    JSON.stringify(await current()) === '["日"]',
    'aria-current：日の画面は「日」だけ（欠勤・キャンセルに印を付けない）',
  );
  await open(page, '/clients');
  check(JSON.stringify(await current()) === '["利用者さん一覧"]', 'aria-current：〈利用者さん〉一覧');
  check(
    (await page.locator('h1').innerText()).trim() === '利用者さん一覧',
    '〈利用者さん〉の見出しは「利用者さん一覧」',
  );
  await open(page, '/staff');
  check((await page.locator('h1').innerText()).trim() === 'スタッフ一覧', '〈スタッフ〉の見出しは「スタッフ一覧」');
  // 欠勤・キャンセル：今日の日の画面で欄が開き、?do=・?date= は消える
  await open(page, '/week');
  await side.getByTestId('nav-link').filter({ hasText: '欠勤・キャンセル' }).click();
  await page.getByTestId('sudden-panel').waitFor({ timeout: 15000 });
  const h = hashOf(page);
  check(
    h.startsWith('#/plan') && !h.includes('do=') && !h.includes('date='),
    'メニューの欠勤・キャンセルで日の画面の欄が開き URL から消える',
    h,
  );
  check(
    (await page.locator('.app-header select[aria-label="日付"]').inputValue()) === TODAY,
    '欠勤・キャンセル：今日の日付を選ぶ',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'nav-wide-absence.png') });
  await page.keyboard.press('Escape');
  await open(page, '/home');
  await page.screenshot({ path: path.join(OUT_DIR, 'nav-wide.png') });
}

// ---- コマンドパレット：Ctrl+K で開く → 打つ → 矢印 → Enter で移る ----
async function keyboard(page) {
  await open(page, '/week');
  await page.locator('h1').click(); // フォーカスを本文に（入力欄の外）
  await page.keyboard.press('Control+k');
  await palette(page).waitFor();
  const d = palette(page);
  const inp = input(page);
  const listId = await page.getByTestId('cmdk-list').getAttribute('id');
  check(
    (await d.getAttribute('role')) === 'dialog' &&
      (await d.getAttribute('aria-modal')) === 'true' &&
      (await d.getAttribute('aria-label')) === '探す・移動',
    'パレット：role=dialog・aria-modal・名前「探す・移動」',
  );
  check(
    (await isFocused(inp)) &&
      (await inp.getAttribute('role')) === 'combobox' &&
      (await inp.getAttribute('aria-controls')) === listId &&
      (await inp.getAttribute('aria-autocomplete')) === 'list' &&
      (await inp.getAttribute('aria-expanded')) === 'true' &&
      (await page.getByTestId('cmdk-list').getAttribute('role')) === 'listbox',
    'パレット：開くと入力欄（combobox・aria-controls が listbox）へフォーカス',
  );
  check(
    (await rootInert(page)) && (await page.evaluate(() => getComputedStyle(document.body).overflow)) === 'hidden',
    'パレット：裏は inert・巻かない',
  );
  check(
    (await page.getByTestId('cmdk-open').getAttribute('aria-expanded')) === 'true',
    '上の帯のボタン：開いているあいだ aria-expanded=true',
  );
  const first = await listed(page);
  const kinds = [...new Set(first.map((o) => o.kind))];
  check(
    JSON.stringify(kinds) === '["action","screen"]' && first[0].label === '欠勤・キャンセルを登録' && first[0].selected,
    '打つ前：操作と画面だけ（人は出さない）・先頭を選んでいる',
    kinds,
  );
  check((await inp.getAttribute('aria-activedescendant')) === first[0].id, 'aria-activedescendant が選んでいる候補');
  check((await page.getByTestId('cmdk-status').innerText()) === '', '開いたときは件数を読み上げない');
  await page.screenshot({ path: path.join(OUT_DIR, 'nav-palette-open.png') });

  await type(page, 'かどう');
  let list = await listed(page);
  check(
    JSON.stringify(list.map((o) => o.label)) === '["稼働時間","稼働の見込み"]',
    '打つと絞り込む（ひらがなで画面の名前を引く）',
    list.map((o) => o.label),
  );
  check((await page.getByTestId('cmdk-status').innerText()) === '2件', '件数を読み上げる（aria-live）');
  await page.keyboard.press('ArrowDown');
  list = await listed(page);
  check(
    list[1].selected && !list[0].selected && (await inp.getAttribute('aria-activedescendant')) === list[1].id,
    '↓ で次の候補（aria-selected・aria-activedescendant）',
  );
  await page.keyboard.press('ArrowDown');
  list = await listed(page);
  check(list[0].selected, '↓ で最後から先頭へ回る');
  await page.keyboard.press('ArrowUp');
  list = await listed(page);
  check(list[1].selected, '↑ で先頭から最後へ回る');
  await page.keyboard.press('Enter');
  await page.waitForURL(/#\/workload/);
  await palette(page).waitFor({ state: 'detached' });
  check(
    !(await rootInert(page)) && (await page.evaluate(() => document.body.style.overflow)) === '',
    'Enter で移り、閉じたら inert とロックを戻す',
    hashOf(page),
  );

  // 見つからない
  await page.keyboard.press('Control+k');
  await palette(page).waitFor();
  await type(page, 'zzzzz');
  check(
    (await options(page).count()) === 0 &&
      (await page.getByTestId('cmdk-empty').isVisible()) &&
      (await input(page).getAttribute('aria-expanded')) === 'false' &&
      (await input(page).getAttribute('aria-activedescendant')) === null,
    '見つからないとき：案内の文・aria-expanded=false',
  );
  await page.keyboard.press('Enter');
  check(await palette(page).isVisible(), '候補が無いときの Enter は何もしない');
  // Ctrl+K で閉じる
  await page.keyboard.press('Control+k');
  await palette(page).waitFor({ state: 'detached' });
  check(true, '開いているときの Ctrl+K で閉じる');

  // 操作：欠勤・キャンセル
  await open(page, '/home');
  await page.keyboard.press('Control+k');
  await palette(page).waitFor();
  await type(page, 'けっきん');
  list = await listed(page);
  check(list[0]?.label === '欠勤・キャンセルを登録' && list[0].kind === 'action', '操作をよみで引く', list);
  await page.keyboard.press('Enter');
  await page.getByTestId('sudden-panel').waitFor({ timeout: 15000 });
  check(
    hashOf(page).startsWith('#/plan') && !hashOf(page).includes('do='),
    '操作「欠勤・キャンセルを登録」で日の画面の欄が開く',
    hashOf(page),
  );
  // 右の欄が開いているあいだは Ctrl+K で開かない（ブラウザの動き（アドレスバーへ移る）は止める）
  await page.evaluate(() => {
    window.__ctrlK = null;
    window.addEventListener('keydown', (e) => {
      if (e.key === 'k') window.__ctrlK = e.defaultPrevented;
    });
  });
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(200);
  check((await palette(page).count()) === 0, '右の欄が開いているあいだは Ctrl+K で開かない');
  check((await page.evaluate(() => window.__ctrlK)) === true, '開かないときも Ctrl+K の既定の動きは止める');
  await page.keyboard.press('Escape');

  // 操作：今月の案をまとめて作る（月の画面の ?do=batch）
  await open(page, '/home');
  await page.keyboard.press('Control+k');
  await palette(page).waitFor();
  await type(page, 'まとめて');
  list = await listed(page);
  const m = Number(TODAY.slice(5, 7));
  check(
    list[0]?.label === `${m}月の案をまとめて作る`,
    '操作：今月の案をまとめて作るが先頭',
    list.map((o) => o.label),
  );
  await page.keyboard.press('Enter');
  await page.waitForURL(/#\/month/);
  await page.waitForTimeout(600);
  check(!hashOf(page).includes('do='), '月の画面へ移り ?do= は月の画面が消す', hashOf(page));
  // 呼び方のよみで画面を引く
  await open(page, '/home');
  await page.keyboard.press('Control+k');
  await palette(page).waitFor();
  await type(page, 'りようしゃ');
  list = await listed(page);
  check(
    list.some((o) => o.kind === 'screen' && o.label === '利用者さん一覧'),
    '呼び方のよみ（りようしゃ）で〈利用者さん〉一覧',
    list.map((o) => o.label),
  );
  await type(page, 'つくりなおす');
  list = await listed(page);
  check(
    !list.some((o) => o.label === '今日の案をいまの条件で作り直す'),
    'いまの条件がプリセットと同じなら「いまの条件で作り直す」を出さない',
    list.map((o) => o.label),
  );
  await page.keyboard.press('Escape');
  // いまの条件がどのプリセットとも違えば「今日の案をいまの条件で作り直す」（?do=recreate）
  await page.evaluate((key) => {
    const d = JSON.parse(localStorage.getItem(key));
    const r = d.rules.find((x) => typeof x.weight === 'number');
    r.weight = r.weight >= 4.5 ? r.weight - 1.5 : r.weight + 1.5;
    localStorage.setItem(key, JSON.stringify(d));
  }, STORAGE_KEY);
  await open(page, '/home');
  await page.keyboard.press('Control+k');
  await palette(page).waitFor();
  await type(page, 'つくりなおす');
  list = await listed(page);
  const ri = list.findIndex((o) => o.label === '今日の案をいまの条件で作り直す');
  check(
    ri >= 0 && list[ri].kind === 'action',
    'いまの条件がプリセットと違えば「今日の案をいまの条件で作り直す」',
    list.map((o) => o.label),
  );
  for (let i = 0; i < ri; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForURL(/#\/plan/);
  await page.waitForTimeout(800);
  check(!hashOf(page).includes('do='), '日の画面へ移り ?do=recreate は日の画面が消す', hashOf(page));
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
}

// ---- 人の名前で閲覧の欄 ----
async function people(page) {
  await open(page, '/home');
  const p = await seedPeople(page);
  await page.getByTestId('cmdk-open').click();
  await palette(page).waitFor();
  // よみをカタカナで（ひらがな・カタカナの揺れ）
  const kata = toKata(p.client.kana.split(/\s+/)[0]);
  await type(page, kata);
  let list = await listed(page);
  const hit = list.find((o) => o.label === p.client.name);
  check(!!hit && hit.kind === 'client', '〈利用者さん〉をよみ（カタカナ）で引く', {
    kata,
    list: list.map((o) => o.label),
  });
  const idx = list.findIndex((o) => o.label === p.client.name);
  for (let i = 0; i < idx; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForURL(/#\/clients/);
  const view = page.locator('[data-testid="person-view"][data-kind="client"]');
  await view.waitFor({ timeout: 10000 });
  check(
    (await view.getAttribute('data-id')) === p.client.id && !hashOf(page).includes('id='),
    '〈利用者さん〉を選ぶと一覧の閲覧の欄が開く（?id= は消える）',
    hashOf(page),
  );
  check(
    await page.evaluate(() => !!document.activeElement?.closest('.drawer')),
    '閲覧の欄が開いたらフォーカスは欄の中',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'nav-person.png') });
  await page.keyboard.press('Escape');
  // 〈スタッフ〉は名前で（マウスで押す）
  await page.getByTestId('cmdk-open').click();
  await palette(page).waitFor();
  await type(page, p.staff.name.split(/\s+/)[0]);
  list = await listed(page);
  check(
    list.some((o) => o.kind === 'staff' && o.label === p.staff.name),
    '〈スタッフ〉を名前で引く',
    list,
  );
  await options(page).filter({ hasText: p.staff.name }).first().click();
  await page.waitForURL(/#\/staff/);
  const sv = page.locator('[data-testid="person-view"][data-kind="staff"]');
  await sv.waitFor({ timeout: 10000 });
  check((await sv.getAttribute('data-id')) === p.staff.id, '〈スタッフ〉を押すと閲覧の欄が開く');
  await page.keyboard.press('Escape');
}

// ---- Esc とフォーカスの戻り・背景・Tab・入力欄の中の Ctrl+K ----
async function focus(page) {
  await open(page, '/clients');
  const btn = page.getByTestId('cmdk-open');
  await btn.click();
  await palette(page).waitFor();
  await type(page, 'あ');
  // Tab は中で回る（入力欄 ⇄ 閉じる）
  let inside = true;
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    inside &&= await palette(page).evaluate((el) => el.contains(document.activeElement));
  }
  await page.keyboard.press('Shift+Tab');
  inside &&= await palette(page).evaluate((el) => el.contains(document.activeElement));
  check(inside, 'Tab・Shift+Tab でフォーカスがパレットの中で回る');
  await page.keyboard.press('Escape');
  await palette(page).waitFor({ state: 'detached' });
  check((await isFocused(btn)) && hashOf(page) === '#/clients', 'Esc で閉じて、フォーカスは開いたボタンへ（移らない）');
  check((await btn.getAttribute('aria-expanded')) === 'false', '閉じたら aria-expanded=false');
  // 背景を押す
  await btn.click();
  await palette(page).waitFor();
  await page.mouse.click(10, 990);
  await palette(page).waitFor({ state: 'detached' });
  check(await isFocused(btn), '背景を押すと閉じてフォーカスはボタンへ');
  // 閉じるボタン
  await btn.click();
  await palette(page).waitFor();
  await palette(page).getByRole('button', { name: '閉じる' }).click();
  await palette(page).waitFor({ state: 'detached' });
  check(await isFocused(btn), '×で閉じてフォーカスはボタンへ');
  // 入力欄の中の Ctrl+K：開く。入れた文字はそのまま、閉じたら入力欄へ
  const search = page.locator('input[type="search"]').first();
  await search.fill('ながまち');
  await search.focus();
  await page.keyboard.press('Control+k');
  await palette(page).waitFor();
  check(await isFocused(input(page)), '入力欄の中でも Ctrl+K で開く');
  await page.keyboard.press('Escape');
  await palette(page).waitFor({ state: 'detached' });
  check(
    (await isFocused(search)) && (await search.inputValue()) === 'ながまち',
    '閉じるとフォーカスは入力欄へ戻り、入れた文字はそのまま',
  );
  // 今の画面を選ぶと閉じるだけ（URL は変えない）
  await page.keyboard.press('Control+k');
  await palette(page).waitFor();
  await type(page, '利用者さん一覧');
  await page.keyboard.press('Enter');
  await palette(page).waitFor({ state: 'detached' });
  check(hashOf(page) === '#/clients' && (await search.inputValue()) === 'ながまち', '今の画面を選ぶと閉じるだけ');

  // 吹き出しの中から開いて閉じても、フォーカスを body に落とさない（戻す先が消えていたら「探す」へ）
  await open(page, '/week', '[data-testid="week-col"]');
  await page.getByTestId('staff-chips').getByTestId('person-info').first().click();
  await page.getByTestId('person-pop').waitFor();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Control+k');
  await palette(page).waitFor();
  await page.keyboard.press('Escape');
  await palette(page).waitFor({ state: 'detached' });
  const fo = await page.evaluate(() => ({
    body: document.activeElement === document.body || document.activeElement === null,
    id: document.activeElement?.dataset?.testid ?? document.activeElement?.tagName,
  }));
  check(!fo.body, '吹き出しの中から開いて閉じても、フォーカスは body に落ちない', fo);

  // ↓ で末尾から先頭へ回ると一番上まで巻く・種類の先頭の候補では見出しも見える
  await page.keyboard.press('Control+k');
  await palette(page).waitFor();
  const lst = page.getByTestId('cmdk-list');
  await page.keyboard.press('ArrowUp'); // 末尾へ
  await page.waitForTimeout(100);
  const bottom = await lst.evaluate((el) => el.scrollTop);
  await page.keyboard.press('ArrowDown'); // 先頭へ回る
  await page.waitForTimeout(100);
  check(
    bottom > 0 && (await lst.evaluate((el) => el.scrollTop)) === 0,
    '↓ で末尾から先頭へ回ると一番上まで巻く',
    bottom,
  );
  // 末尾から ↑ で画面の先頭の候補まで戻る
  const all = await listed(page);
  const firstScreen = all.findIndex((o) => o.kind === 'screen');
  await page.keyboard.press('ArrowUp');
  for (let i = all.length - 1; i > firstScreen; i--) await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(100);
  const vis = await lst.evaluate((el) => {
    const t = el.querySelector('[data-kind="screen"] .cmdk-group-title');
    const sel = el.querySelector('[aria-selected="true"]');
    return {
      title: t.getBoundingClientRect().top - el.getBoundingClientRect().top,
      sel: sel?.dataset.kind,
      selFirst: sel?.previousElementSibling === t,
    };
  });
  check(vis.sel === 'screen' && vis.selFirst && vis.title >= 0, '種類の先頭の候補を選ぶと見出しも見える', vis);
  await page.keyboard.press('Escape');
}

// ---- 390px：上の帯のボタン・収まる・名前・引き出し・下のタブ ----
async function mobile(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/clients');
  check(
    (await page.getByTestId('screen-name').innerText()) === '人の情報・利用者さん一覧',
    '390px：上の帯の名前「人の情報・利用者さん一覧」',
  );
  // 名前が切れない（見出し・項目名をそれぞれひとまとまりで折り返す）
  const clipped = [];
  for (const h of ['/clients', '/rules', '/workload', '/compare']) {
    await open(page, h);
    const c = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="screen-name"], .m-screen-group, .m-screen-item')].some(
        (el) => el.scrollWidth > el.clientWidth + 1,
      ),
    );
    if (c) clipped.push(h);
  }
  check(clipped.length === 0, '390px：上の帯の名前が切れない', clipped);
  await open(page, '/clients');
  const btn = page.getByTestId('cmdk-open');
  const bb = await btn.boundingBox();
  const mb = await page.getByTestId('menu-btn').boundingBox();
  check(
    bb && bb.x >= 0 && bb.x + bb.width <= 390 && bb.y < 80 && Math.abs(bb.y - mb.y) < 4,
    '390px：「探す」のボタンが上の帯の1段目（メニューの隣）に収まる',
    { bb, mb },
  );
  check(
    (await btn.innerText()).trim() === '探す',
    '390px：ボタンは「探す」（キーの印を出さない）',
    await btn.innerText(),
  );
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(sw <= 390, '390px：ページが横にはみ出さない', sw);
  await btn.click();
  await palette(page).waitFor();
  await page.waitForTimeout(200);
  const pb = await palette(page).boundingBox();
  check(pb.x >= 0 && pb.x + pb.width <= 390 && pb.y + pb.height <= 844, '390px：パレットが画面に収まる', pb);
  check(await isFocused(input(page)), '390px：開くと入力欄へフォーカス');
  await type(page, 'ひ');
  await page.screenshot({ path: path.join(OUT_DIR, 'nav-mobile-palette.png') });
  await page.keyboard.press('Escape');
  await palette(page).waitFor({ state: 'detached' });
  check(await isFocused(btn), '390px：閉じたらボタンへ');
  // 引き出しも同じ並び
  await page.getByTestId('menu-btn').click();
  const d = page.getByTestId('nav-drawer');
  await d.waitFor();
  const titles = await d.locator('h2.nav-group-title').allInnerTexts();
  const labels = (await d.getByTestId('nav-link').allInnerTexts()).map((t) => t.trim());
  check(
    JSON.stringify(titles) === JSON.stringify(GROUPS) && JSON.stringify(labels) === JSON.stringify(LABELS),
    '390px：引き出しもメニューと同じ並び',
    { titles, labels },
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'nav-mobile-drawer.png') });
  await page.keyboard.press('Escape');
  const tabs = await page.getByTestId('bottom-tab').allInnerTexts();
  check(
    JSON.stringify(tabs) === JSON.stringify(['ホーム', '月', '週', '日', '空き状況']),
    '390px：下のタブは5つのまま',
    tabs,
  );
  await open(page, '/compare');
  check(
    (await page.getByTestId('screen-name').innerText()) === '予定を組む・案を比べる' &&
      JSON.stringify(await page.locator('.bottom-tab.active[aria-current="page"]').allInnerTexts()) === '["日"]',
    '390px：比較は上の帯「予定を組む・案を比べる」、下のタブは「日」',
  );
  await page.setViewportSize({ width: 1400, height: 1000 });
}

// ---- 印刷で出さない ----
async function print(page) {
  await open(page, '/home');
  await page.keyboard.press('Control+k');
  await palette(page).waitFor();
  await page.emulateMedia({ media: 'print' });
  const shown = await page.evaluate(() =>
    ['.cmdk-wrap', '.cmdk-open'].map((s) => getComputedStyle(document.querySelector(s)).display),
  );
  check(
    shown.every((x) => x === 'none'),
    '印刷：パレットと上の帯のボタンを出さない',
    shown,
  );
  await page.emulateMedia({ media: 'screen' });
  await page.keyboard.press('Escape');
}

// ---- 300人×60人：打つたびの速さ ----
async function perf(page) {
  await open(page, '/data');
  await page.evaluate((key) => {
    const d = JSON.parse(localStorage.getItem(key));
    const baseC = d.clients.filter((c) => c.active);
    const baseS = d.staff.filter((s) => s.active);
    const clients = [];
    for (let i = 0; clients.length < 300; i++) {
      const c = baseC[i % baseC.length];
      clients.push({
        ...c,
        id: `pc${i}`,
        displayName: `${c.displayName}${i}`,
        usualStaffId: null,
        allowedStaffIds: [],
      });
    }
    const staff = [];
    for (let i = 0; staff.length < 60; i++) {
      const s = baseS[i % baseS.length];
      staff.push({ ...s, id: `ps${i}`, name: `${s.name}${i}`, email: '' });
    }
    localStorage.setItem(
      key,
      JSON.stringify({ ...d, clients: [...d.clients, ...clients], staff: [...d.staff, ...staff] }),
    );
  }, STORAGE_KEY);
  await page.reload();
  await page.locator('h1').waitFor();
  await page.waitForTimeout(800);
  await page.keyboard.press('Control+k');
  await palette(page).waitFor();
  const kana = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)).clients.find((c) => c.kana).kana,
    STORAGE_KEY,
  );
  const text = kana.replace(/\s+/g, '').slice(0, 6);
  const times = await page.evaluate(async (t) => {
    const el = document.querySelector('[data-testid="cmdk-input"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const out = [];
    for (let i = 1; i <= t.length; i++) {
      const t0 = performance.now();
      setter.call(el, t.slice(0, i));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      out.push(Math.round(performance.now() - t0));
    }
    return out;
  }, text);
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const n = await options(page).count();
  const rest = await page.getByTestId('cmdk-rest').allInnerTexts();
  check(n > 0 && n <= 8 * 2 + 30, '300人×60人：人は種類ごとに8人まで', { n, rest });
  check(median <= PERF_MS, `300人×60人：1文字打って描き終わるまで（中央値 ${PERF_MS}ms 以下）`, { median, times });
  await page.keyboard.press('Escape');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
}

run(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  // 初回の案内ツアーを見た扱いにする（PRD D193）
  await skipTour(ctx);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(String(e));
    console.log('ERR', String(e));
  });
  const dlg = await answerConfirms(page);
  for (const [name, fn] of [
    ['menu', menu],
    ['keyboard', keyboard],
    ['people', people],
    ['focus', focus],
    ['mobile', mobile],
    ['print', print],
    ['perf', perf],
  ]) {
    try {
      await fn(page);
    } catch (e) {
      check(false, name, String(e.message || e));
      await failShot(page, name);
    }
  }
  check(dlg.native.length === 0, 'ブラウザのダイアログを出さない', dlg.native);
  await b.close();
  return errors;
});
