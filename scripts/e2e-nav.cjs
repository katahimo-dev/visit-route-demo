// メニューの用途ごとの並びとコマンドパレット（PRD D178〜D183・D273〜D275。ADR-0027・0045）を本物のブラウザで確かめる：
// メニュー（9項目の並び・名前（〈利用者さん〉一覧・〈スタッフ〉一覧）・同じ名前が無い・aria-current（月・週・日・比較は「予定」、
// 設定のタブは「設定」、勤務の見込みは「勤務時間（シフト）」、欠勤・キャンセルは印を付けず今日の日の画面の欄を開く）・
// 「予定」「設定」は最後に開いた表示・タブ・設定のタブ・メニューから外した画面の入口・画面の見出しが画面の名前とそろう）、
// コマンドパレット（Ctrl+K で開く・role=dialog・aria-modal・combobox と listbox（aria-activedescendant）・裏の inert とスクロールのロック・
// 打つと絞り込む・↑↓（端で回る）・Enter で移る・操作（欠勤・キャンセル）・人の名前（よみ・カタカナ）でその人の画面・Esc とフォーカスの戻り・
// 背景で閉じる・Tab が中で回る・Ctrl+K で閉じる・入力欄の中の Ctrl+K（入れた文字はそのまま・閉じたら入力欄へ）・右の欄が開いているときは開かない）、
// 390px（上の帯のボタンから開ける・収まる・上の帯の名前・引き出しの並び・下のタブ（ホーム・予定・欠勤・空き状況・メニュー））、印刷で出さない、300人×60人で打つたびの速さ。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-nav.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）。PERF_MS_NAV で1文字打って描き終わるまでの上限（既定 100ms。無ければ PERF_MS）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { answerConfirms } = require('./lib/confirmDialog.cjs');
const {
  BASE,
  OUT_DIR,
  TODAY,
  STORAGE_KEY,
  perfMs,
  check,
  withRealClock,
  pageErrors,
  hashOf,
  isFocused,
  runSteps,
  settle,
} = require('./lib/env.cjs');
const { sharedPage, openPage } = require('./lib/steps.cjs');

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
  await settle(page, 100);
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

// メニューの9項目（PRD D273〜D275。ADR-0045・0047：相性は「人」）：見出しのあるグループは当日・問い合わせ／人の2つ（ホーム・予定と設定は見出しなし）
const GROUPS = ['当日・問い合わせ', '人'];
const LABELS = [
  'ホーム',
  '予定',
  '欠勤・キャンセルを登録',
  '空き状況',
  '利用者さん一覧',
  'スタッフ一覧',
  '相性',
  '勤務時間（シフト）',
  '設定',
];
/** 画面の見出し（h1）は上の帯・パレットの画面の名前と同じ（PRD D179・D230） */
const HEADINGS = [
  ['/home', 'ホーム'],
  ['/month', '月の予定'],
  ['/week', '週の予定'],
  ['/plan', '日の予定'],
  ['/availability', '勤務時間（シフト）'],
  ['/workload', '勤務の見込み'],
];
/** 設定のタブ（PRD D275）：URL と見出し */
const SETTINGS = [
  ['/types', '訪問の種類'],
  ['/items', '特性の項目'],
  ['/rules', '条件の重み'],
  ['/settings', '管理者設定'],
  ['/data', 'データ'],
];

// ---- メニューの並び・名前・aria-current（1400px）----
async function menu(page) {
  await open(page, '/home');
  const side = page.locator('.side-nav');
  const titles = await side.locator('h2.nav-group-title').allInnerTexts();
  check(
    JSON.stringify(titles) === JSON.stringify(GROUPS),
    'メニュー：グループの見出し（h2）は当日・問い合わせ・人',
    titles,
  );
  const labels = (await side.getByTestId('nav-link').allInnerTexts()).map((t) => t.trim());
  check(JSON.stringify(labels) === JSON.stringify(LABELS), 'メニュー：9項目の並びと名前（予定・設定は1項目）', labels);
  check(new Set(labels).size === labels.length, 'メニュー：同じ名前の項目が無い（「一覧・編集」が2つ並ばない）');
  const current = async () => (await side.locator('[aria-current="page"]').allInnerTexts()).map((t) => t.trim());
  const link = (name) => side.getByTestId('nav-link').filter({ hasText: new RegExp(`^${name}$`) });
  check(JSON.stringify(await current()) === '["ホーム"]', 'aria-current：ホーム');
  // 予定：月・週・日・比較のどれでも「予定」に印（PRD D273）
  for (const hash of ['/month', '/week', '/compare']) {
    await open(page, hash);
    check(JSON.stringify(await current()) === '["予定"]', `aria-current：${hash} は「予定」`);
  }
  check((await page.locator('h1').innerText()).trim() === '提案を比べる', '比較の見出しは「提案を比べる」');
  await open(page, '/plan', '[data-testid="sudden-open"]');
  check(
    JSON.stringify(await current()) === '["予定"]',
    'aria-current：日の予定は「予定」だけ（欠勤・キャンセルを登録に印を付けない）',
  );
  for (const [hash, h1] of HEADINGS) {
    await open(page, hash);
    check((await page.locator('h1').innerText()).trim() === h1, `見出しは画面の名前「${h1}」`);
  }
  check(
    JSON.stringify(await current()) === '["勤務時間（シフト）"]',
    'aria-current：勤務の見込みは「勤務時間（シフト）」',
  );
  // 予定は最後に開いた表示を開く（既定は日の予定。PRD D273）。ページを読み直すと既定に戻る
  await open(page, '/home');
  check(
    (await link('予定').getAttribute('href')) === '#/plan',
    '「予定」の既定は日の予定',
    await link('予定').getAttribute('href'),
  );
  await link('予定').click();
  await page.locator('h1').filter({ hasText: '日の予定' }).waitFor();
  await page.locator('.view-switch [data-view="month"]').click();
  await page.locator('h1').filter({ hasText: '月の予定' }).waitFor();
  await link('ホーム').click();
  await page.locator('h1').filter({ hasText: 'ホーム' }).waitFor();
  await link('予定').click();
  await page
    .locator('h1')
    .filter({ hasText: /月の予定|日の予定|週の予定/ })
    .waitFor();
  check(
    (await page.locator('h1').innerText()).trim() === '月の予定',
    '「予定」は最後に開いた表示（月の予定）を開く',
    await page.locator('h1').innerText(),
  );
  // 設定：タブの画面のどれでも「設定」に印・見出しの下に設定のタブ・最後に開いたタブ（PRD D275）
  for (const [hash, h1] of SETTINGS) {
    await open(page, hash);
    check(
      JSON.stringify(await current()) === '["設定"]' && (await page.locator('h1').innerText()).trim() === h1,
      `設定のタブ ${hash}：aria-current は「設定」・見出し「${h1}」`,
    );
    const tabs = page.getByTestId('settings-tabs');
    const on = await tabs.locator('[aria-current="page"]').allInnerTexts();
    check(
      (await tabs.locator('a').count()) === 5 && on.length === 1 && on[0].trim() === h1,
      `設定のタブ ${hash}：5つのタブで今のタブに aria-current`,
      on,
    );
  }
  // 相性は設定のタブに無い：「人」の項目（ADR-0047）。設定のタブは出さず、メニューは「相性」に印
  await open(page, '/compat');
  check(JSON.stringify(await current()) === '["相性"]', 'aria-current：#/compat は「相性」（設定ではない）');
  check((await page.getByTestId('settings-tabs').count()) === 0, '相性の画面に設定のタブを出さない');
  await open(page, '/types');
  await page.getByTestId('settings-tabs').locator('a').filter({ hasText: '条件の重み' }).click();
  await page.locator('h1').filter({ hasText: '条件の重み' }).waitFor();
  check(hashOf(page) === '#/rules', '設定のタブを押すと前の URL の画面（#/rules）', hashOf(page));
  await link('ホーム').click();
  await page.locator('h1').filter({ hasText: 'ホーム' }).waitFor();
  check(
    (await link('設定').getAttribute('href')) === '#/rules',
    '「設定」は最後に開いたタブ（条件の重み）',
    await link('設定').getAttribute('href'),
  );
  await open(page, '/clients');
  check(JSON.stringify(await current()) === '["利用者さん一覧"]', 'aria-current：〈利用者さん〉一覧');
  check(
    (await page.locator('h1').innerText()).trim() === '利用者さん一覧',
    '〈利用者さん〉の見出しは「利用者さん一覧」',
  );
  await open(page, '/staff');
  check((await page.locator('h1').innerText()).trim() === 'スタッフ一覧', '〈スタッフ〉の見出しは「スタッフ一覧」');
  // 相性の表への文字ボタン（一覧の見出しの近く。ADR-0047）
  for (const h of ['/clients', '/staff']) {
    await open(page, h, '[data-testid="to-compat"]');
    await page.getByTestId('to-compat').click();
    await page.getByTestId('compat-table').waitFor();
    check(hashOf(page) === '#/compat', `${h} の「相性の表」で相性の画面へ`, hashOf(page));
  }
  // メニューから外した画面の入口が残る（PRD D275）：勤務の見込みは勤務時間（シフト）と月の予定の「その他 ▾」、提案を比べるは日の予定の「AI で組む ▾」
  await open(page, '/availability', '[data-testid="avail-workload"]');
  await page.getByTestId('avail-workload').click();
  await page.locator('h1').filter({ hasText: '勤務の見込み' }).waitFor();
  check(hashOf(page).startsWith('#/workload'), '勤務時間（シフト）の「勤務の見込み」で勤務の見込み', hashOf(page));
  await open(page, '/month', '[data-testid="month-more"]');
  await page.getByTestId('month-more').click();
  await page.getByTestId('month-workload').click();
  await page.locator('h1').filter({ hasText: '勤務の見込み' }).waitFor();
  check(hashOf(page).startsWith('#/workload'), '月の予定の「その他 ▾」の「勤務の見込み」で勤務の見込み', hashOf(page));
  await open(page, '/plan', '[data-testid="plan-menu"]');
  await page.getByTestId('plan-menu').click();
  check(
    (await page.getByTestId('plan-menu-list').getByText('プリセットの提案を比べる').count()) === 1,
    '日の予定の「AI で組む ▾」に「プリセットの提案を比べる」（比較の入口）',
  );
  await page.keyboard.press('Escape');
  // 欠勤・キャンセル：今日の日の画面で欄が開き、?do=・?date= は消える
  await open(page, '/week');
  await side.getByTestId('nav-link').filter({ hasText: '欠勤・キャンセルを登録' }).click();
  await page.getByTestId('sudden-panel').waitFor({ timeout: 15000 });
  const h = hashOf(page);
  check(
    h.startsWith('#/plan') && !h.includes('do=') && !h.includes('date='),
    'メニューの欠勤・キャンセルで日の予定の欄が開き URL から消える',
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
    JSON.stringify(list.map((o) => o.label)) === '["勤務時間（シフト）","勤務の見込み"]',
    '打つと絞り込む（ひらがなで画面の名前を引く。前の名前のよみでも引ける）',
    list.map((o) => o.label),
  );
  check((await page.getByTestId('cmdk-status').innerText()) === '2件', '件数を読み上げる（aria-live）');
  // メニューから外した画面も1つずつ引ける（PRD D273・D275）
  const screensOf = async (q) => {
    await type(page, q);
    return (await listed(page)).filter((o) => o.kind === 'screen').map((o) => o.label);
  };
  const sch = await screensOf('よてい');
  check(
    ['月の予定', '週の予定', '日の予定'].every((x) => sch.includes(x)),
    'パレット：月・週・日の予定を1つずつ引ける（メニューは「予定」1つ）',
    sch,
  );
  const st = await screensOf('せってい');
  check(
    ['訪問の種類', '特性の項目', '条件の重み', '管理者設定', 'データ'].every((x) => st.includes(x)),
    'パレット：「せってい」で設定のタブの画面を1つずつ引ける',
    st,
  );
  await type(page, 'きょう');
  const acts = (await listed(page)).filter((o) => o.kind === 'action').map((o) => o.label);
  check(
    acts.includes('日の予定（今日）を開く'),
    'パレット：操作「日の予定（今日）を開く」（呼び名は「日の予定」）',
    acts,
  );
  await type(page, 'かどう');
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
    '操作「欠勤・キャンセルを登録」で日の予定の欄が開く',
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
  await settle(page, 200);
  check((await palette(page).count()) === 0, '右の欄が開いているあいだは Ctrl+K で開かない');
  check((await page.evaluate(() => window.__ctrlK)) === true, '開かないときも Ctrl+K の既定の動きは止める');
  await page.keyboard.press('Escape');

  // 操作：今月の担当を AI で組む（月の画面の ?do=batch）
  await open(page, '/home');
  await page.keyboard.press('Control+k');
  await palette(page).waitFor();
  await type(page, 'まとめて');
  list = await listed(page);
  const m = Number(TODAY.slice(5, 7));
  check(
    list[0]?.label === `${m}月の担当を AI で組む`,
    '操作：今月の担当を AI で組むが先頭',
    list.map((o) => o.label),
  );
  await page.keyboard.press('Enter');
  await page.waitForURL(/#\/month/);
  await settle(page, 600);
  check(!hashOf(page).includes('do='), '月の予定へ移り ?do= は月の予定が消す', hashOf(page));
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
  await page.keyboard.press('Escape');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
}

// ---- 人の名前でその人の画面 ----
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
    (await view.getAttribute('data-id')) === p.client.id && hashOf(page) === `#/clients/${p.client.id}`,
    '〈利用者さん〉を選ぶとその人の画面（#/clients/:id）が開く',
    hashOf(page),
  );
  check(
    await page.evaluate(() => document.activeElement !== document.body && document.activeElement !== null),
    'その人の画面へ移ってもフォーカスを body に落とさない',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'nav-person.png') });
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
  check(
    (await sv.getAttribute('data-id')) === p.staff.id && hashOf(page) === `#/staff/${p.staff.id}`,
    '〈スタッフ〉を押すとその人の画面（#/staff/:id）が開く',
  );
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
  await settle(page, 100);
  const bottom = await lst.evaluate((el) => el.scrollTop);
  await page.keyboard.press('ArrowDown'); // 先頭へ回る
  await settle(page, 100);
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
  await settle(page, 100);
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
    (await page.getByTestId('screen-name').innerText()) === '人・利用者さん一覧',
    '390px：上の帯の名前「人・利用者さん一覧」',
  );
  // 予定のグループは項目名だけ（「予定・日の予定」と重ねない。PRD D230）
  for (const [h, name] of [
    ['/plan', '日の予定'],
    ['/month', '月の予定'],
    ['/availability', '人・勤務時間（シフト）'],
  ]) {
    await open(page, h);
    const got = (await page.getByTestId('screen-name').innerText()).replace(/\s/g, '');
    check(got === name, `390px：上の帯の名前「${name}」`, got);
  }
  // 名前が切れない（見出し・項目名をそれぞれひとまとまりで折り返す）
  const clipped = [];
  for (const h of ['/clients', '/rules', '/workload', '/compare', '/availability', '/compat']) {
    await open(page, h);
    const c = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="screen-name"], .m-screen-group, .m-screen-item')].some(
        (el) => el.scrollWidth > el.clientWidth + 1,
      ),
    );
    if (c) clipped.push(h);
  }
  check(clipped.length === 0, '390px：上の帯の名前が切れない', clipped);
  // 設定のタブ（PRD D275）：横に巻く枠の中で、今のタブ（後ろのデータ）が見える。ページははみ出さない
  await open(page, '/data', '[data-testid="settings-tabs"]');
  const stab = await page.evaluate(() => {
    const nav = document.querySelector('[data-testid="settings-tabs"]');
    const on = nav.querySelector('[aria-current="page"]').getBoundingClientRect();
    const box = nav.getBoundingClientRect();
    return {
      on: { l: on.left, r: on.right },
      box: { l: box.left, r: box.right },
      scrolls: nav.scrollWidth > nav.clientWidth,
      sw: document.documentElement.scrollWidth,
    };
  });
  check(
    stab.on.l >= stab.box.l - 1 && stab.on.r <= stab.box.r + 1 && stab.sw <= 390,
    '390px：設定のタブは枠の中で横に巻き、今のタブ（データ）が見える・ページははみ出さない',
    stab,
  );
  check(
    (await page.getByTestId('screen-name').innerText()).replace(/\s/g, '') === '設定・データ',
    '390px：設定のタブの上の帯の名前「設定・データ」',
  );
  await open(page, '/clients');
  const btn = page.getByTestId('cmdk-open');
  const bb = await btn.boundingBox();
  const nb = await page.getByTestId('screen-name').boundingBox();
  check(
    bb && bb.x >= 0 && bb.x + bb.width <= 390 && bb.y < 80 && bb.y < nb.y + nb.height,
    '390px：「探す」のボタンが上の帯の1段目（画面の名前の隣）に収まる',
    { bb, nb },
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
  await settle(page, 200);
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
  const tabs = await page.getByTestId('bottom-tabs').locator('.bottom-tab').allInnerTexts();
  check(
    JSON.stringify(tabs.map((t) => t.trim())) === JSON.stringify(['ホーム', '予定', '欠勤', '空き状況', 'メニュー']),
    '390px：下のタブは ホーム・予定・欠勤・空き状況・メニュー（PRD D274）',
    tabs,
  );
  await open(page, '/compare');
  check(
    (await page.getByTestId('screen-name').innerText()) === '提案を比べる' &&
      JSON.stringify(await page.locator('.bottom-tab.active[aria-current="page"]').allInnerTexts()) === '["予定"]',
    '390px：比較は上の帯「提案を比べる」、下のタブは「予定」',
  );
  await scheduleTab(page);
  await page.setViewportSize({ width: 1400, height: 1000 });
}

/**
 * 下のタブの「予定」「欠勤」（PRD D273・D274）：「予定」は月・週・日の予定で印、押すと最後に開いた表示（既定は日の予定）・
 * 今の表示では何もしない。「欠勤」は今日の日の予定で欠勤・キャンセルの欄を開く（印は付けない）
 */
async function scheduleTab(page) {
  const sel = page.locator('.app-header select[aria-label="日付"]');
  const tab = (name) => page.getByTestId('bottom-tab').filter({ hasText: new RegExp(`^${name}$`) });
  const active = async () => page.locator('.bottom-tab.active[aria-current="page"]').allInnerTexts();
  // 比較から「予定」：まだどの表示も開いていない（読み直した）ので日の予定
  await tab('予定').click();
  await page.locator('h1').filter({ hasText: '日の予定' }).waitFor({ timeout: 10000 });
  check(hashOf(page).startsWith('#/plan'), '「予定」のタブ：比較から押すと日の予定（既定）', hashOf(page));
  // 週へ切り替えてホームへ → 「予定」で週
  await page.locator('.view-switch [data-view="week"]').click();
  await page.locator('h1').filter({ hasText: '週の予定' }).waitFor();
  check(JSON.stringify(await active()) === '["予定"]', '「予定」のタブ：週の予定でも印');
  const len = await page.evaluate(() => history.length);
  const h0 = hashOf(page);
  await tab('予定').click();
  await settle(page, 200);
  check(
    hashOf(page) === h0 && (await page.evaluate(() => history.length)) === len,
    '「予定」のタブ：今の表示（週）では何もしない（URL・履歴そのまま）',
  );
  await tab('ホーム').click();
  await page.locator('h1').filter({ hasText: 'ホーム' }).waitFor();
  await tab('予定').click();
  await page.locator('h1').filter({ hasText: '週の予定' }).waitFor({ timeout: 10000 });
  check(true, '「予定」のタブ：最後に開いた表示（週の予定）を開く');
  // 「欠勤」：ほかの日を選んでいても今日の日の予定で欠勤・キャンセルの欄
  const other = (await sel.locator('option').evaluateAll((os) => os.map((o) => o.value))).find((v) => v !== TODAY);
  await sel.selectOption(other);
  await settle(page, 150);
  await tab('欠勤').click();
  await page.getByTestId('sudden-panel').waitFor({ timeout: 15000 });
  check(
    (await sel.inputValue()) === TODAY && hashOf(page).startsWith('#/plan') && !hashOf(page).includes('do='),
    '「欠勤」のタブ：今日の日の予定で欠勤・キャンセルの欄が開く（?do=・?date= は消える）',
    { hash: hashOf(page), sel: await sel.inputValue() },
  );
  await page.keyboard.press('Escape');
  await page.getByTestId('sudden-panel').waitFor({ state: 'detached' });
  check(JSON.stringify(await active()) === '["予定"]', '「欠勤」のタブ：印は付けない（日の予定は「予定」）');
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
  // 速さの計測の前に、読み込み直後の仕事が引くのを待つ。計測の条件なので固定の待ちのまま（ADR-0041）
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

/**
 * 1366×768（PRD D267・D269・D270）：左のメニューは最後の項目（データ）まで巻かずに見える、上の帯の日付の選択は日付で
 * 中身が変わる画面だけ（ほかの画面でも選んでいる日付は覚えたまま）、日の予定の時間軸の列の名前が切れず、右に続きの列が
 * あれば端に影
 */
async function screen1366(page) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await open(page, '/home');
  const side = await page.evaluate(() => {
    const nav = document.querySelector('.side-nav');
    const links = [...nav.querySelectorAll('.nav-link')];
    const last = links.at(-1).getBoundingClientRect();
    return {
      last: links.at(-1).textContent.trim(),
      bottom: Math.round(last.bottom),
      vh: window.innerHeight,
      fits: nav.scrollHeight <= nav.clientHeight + 1,
    };
  });
  check(side.fits && side.bottom <= side.vh, '1366×768：左のメニューの最後の項目まで巻かずに見える（PRD D270）', side);
  const shown = [];
  const hidden = [];
  for (const h of ['/plan', '/week', '/month', '/compare', '/workload', '/availability']) {
    await open(page, h);
    if ((await page.locator('.app-header .date-switch').count()) !== 1) shown.push(h);
  }
  for (const h of [
    '/home',
    '/vacancy',
    '/clients',
    '/staff',
    '/compat',
    '/rules',
    '/types',
    '/items',
    '/settings',
    '/data',
  ]) {
    await open(page, h);
    if ((await page.locator('.app-header .date-switch').count()) !== 0) hidden.push(h);
  }
  check(
    shown.length === 0 && hidden.length === 0,
    '上の帯の日付の選択は日・週・月・比較・勤務の見込み・勤務時間（シフト）だけ（PRD D267）',
    { 出ない: shown, 出る: hidden },
  );
  // 日付を選んでから日付の無い画面へ移り、戻っても同じ日付
  await open(page, '/plan', '.date-switch select');
  const options = await page.locator('.date-switch select option').evaluateAll((os) => os.map((o) => o.value));
  const pick = options[Math.min(2, options.length - 1)];
  await page.locator('.date-switch select').selectOption(pick);
  await page.evaluate(() => {
    location.hash = '#/clients';
  });
  await page.locator('h1').filter({ hasText: /一覧/ }).first().waitFor();
  await settle(page, 200);
  const kept = await page.locator('.app-shell').getAttribute('data-date');
  await page.evaluate(() => {
    location.hash = '#/plan';
  });
  await page.locator('.date-switch select').waitFor();
  check(
    kept === pick && (await page.locator('.date-switch select').inputValue()) === pick,
    '日付の無い画面へ移っても選んでいる日付はそのまま',
    { pick, kept },
  );
  // 日の予定の時間軸（今日）：列の名前を切らず、右に続きの列があれば端に影（PRD D269）
  await open(page, '/plan', '[data-testid="route-timeline"]');
  await page.locator('.tl-head .col-head-name').first().waitFor({ timeout: 60000 });
  await settle(page, 300);
  const tl = await page.evaluate(() => {
    const box = document.querySelector('[data-testid="route-timeline"]');
    const names = [...document.querySelectorAll('.tl-head .col-head-name')].map((el) => {
      const col = el.closest('.route-col').getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return { text: el.textContent, clip: el.scrollWidth > el.clientWidth + 1 || r.right > col.right + 1 };
    });
    return {
      clipped: names.filter((n) => n.clip).map((n) => n.text),
      count: names.length,
      more: box.scrollWidth > box.clientWidth + 1,
      edge: box.parentElement.classList.contains('has-more-right'),
      shadow: getComputedStyle(box.parentElement, '::after').opacity,
    };
  });
  check(tl.count > 0 && tl.clipped.length === 0, '日の予定の時間軸：列の名前が切れない（PRD D269）', tl);
  check(!tl.more || (tl.edge && tl.shadow === '1'), '日の予定の時間軸：右に続きの列があれば端に影（PRD D269）', tl);
  await page.screenshot({ path: path.join(OUT_DIR, 'plan-1366.png') });
  await page.setViewportSize({ width: 1400, height: 1000 });
}

const steps = sharedPage({
  open: async () => {
    const s = await openPage();
    // 確認は独自のダイアログで受ける（ネイティブのダイアログが出たら失敗。PRD D146）
    return { ...s, dlg: await answerConfirms(s.page) };
  },
  call: (fn, s) => fn(s.page, s),
  steps: [
    ['menu', menu],
    ['keyboard', keyboard],
    ['people', people],
    ['focus', focus],
    ['mobile', mobile],
    ['print', print],
    ['screen-1366', screen1366],
    // 速さは時計を止めない別の文脈で測る（scripts/lib/env.cjs の withRealClock）
    ['perf', (_page, s) => withRealClock(s.b, pageErrors, perf)],
  ],
  after: ({ dlg }) => check(dlg.native.length === 0, 'ブラウザのダイアログを出さない', dlg.native),
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
