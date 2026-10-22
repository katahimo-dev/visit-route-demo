// 機能の入り切り その1（PRD D210〜D213・D216。ADR-0028）を本物のブラウザで確かめる：
// すべて入（初期データ。e2e は初回もすべて入に固定。PRD D276）でメニューの最後に「設定」（タブに管理者設定・データ）、管理者設定の画面（見出し・説明・ひな形の4つ・
// 「いまの設定」とカスタムの印・20のスイッチの role=switch・aria-checked・名前・説明）。
// ひな形の4通り（基本・月次予定・現場共有・すべては管理者設定で適用する（独自の確認ダイアログに入る機能・切れる機能、取り消すと変わらない）、
// 労務・契約管理は別のタブで localStorage を書き換えて作る）ごとに、メニューの項目（相性の機能の入り切りだけで変わる）・設定のタブ・下のタブ・パレットの画面と操作・ホームのいつでもの入口・
// 切った機能の URL（`?do=` も）を開くとホームへ移り（replace）、ホームの上に閉じられる知らせと管理者設定へのリンク、
// スイッチ（押すとすぐ保存・トースト・依存先が切なら押せず理由）、390px で横にはみ出さない、印刷で知らせ・メニューを出さない。
// 末尾の /・大文字の URL（#/vacancy/・#/Vacancy・#/month/print/）もホームへ移す、390px で空き状況を切ると下のタブ4つが全幅を等分、
// 稼働の見込み・欠勤・キャンセル・月の印刷・案を比べるを切ると、月の要対応の行・月のボタン・日の画面の拘束の帯と「案を変える ▾」・
// 稼働時間の右の欄にそこへ移るリンク・ボタンが無い。
// その2（PRD D211・D213〜D215）：ひな形の4通りごとに画面の中の入口（日の画面の欠勤・キャンセル・メール・条件を調整する・
// プリセットの数・点数の理由、〈利用者さん〉の欄の段階の選択・紹介元・担当できる人・休み・決まりごと・住所の検索・絞り込みのチップ、
// 〈利用者さん〉の画面の紹介元・決まりごと・休みのタブ、〈スタッフ〉の画面のメールアドレス・最終勤務日、月の「休みを入れる」・印刷、空き状況の案内文、
// データの Excel、稼働の見込みの交通費の単価）。相性を切るときの独自の確認（件数と効き方。取り消すと変わらない）と、
// 切ったあとの月の要対応の「条件が変わった」、相性×の組が切ると担当に入ること（別のタブで×を書き、日の画面で作り直す）。
// レビューの反映：希望休のまとめ入力を切っても月の「休みの人に N」は出す、欠勤・キャンセルを切ると稼働時間の凡例で登録の場所を出さない、
// 切ったまま保存してもデータが残る（段階「契約」・担当できる人・〈スタッフ〉のメールアドレス・毎月のパターンの repeat と monthWeeks）。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-features.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { answerConfirms } = require('./lib/confirmDialog.cjs');
const { BASE, OUT_DIR, TODAY, STORAGE_KEY, check, hashOf, runSteps, settle } = require('./lib/env.cjs');
const { sharedPage, openPage } = require('./lib/steps.cjs');

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 機能の ID（src/contracts/features.ts の FEATURE_IDS と同じ順） */
const FEATURE_IDS = [
  'patternMonthly',
  'clientLeave',
  'requestedOff',
  'monthPrint',
  'compare',
  'sudden',
  'vacancy',
  'vacancyNotice',
  'compat',
  'allowedStaff',
  'clientStage',
  'visitNotes',
  'offboard',
  'workload',
  'fare',
  'rules',
  'mail',
  'mapsLink',
  'geocode',
  'excel',
];
/** ひな形で入れる機能（ADR-0028 の表） */
const BASIC_ON = ['sudden', 'vacancy', 'compat', 'mapsLink', 'geocode'];
const TEMPLATE_ON = {
  basic: BASIC_ON,
  laborContract: [...BASIC_ON, 'clientStage', 'offboard', 'workload', 'fare'],
  monthlyField: [
    ...BASIC_ON,
    'patternMonthly',
    'clientLeave',
    'requestedOff',
    'monthPrint',
    'vacancyNotice',
    'allowedStaff',
    'visitNotes',
    'excel',
  ],
  all: FEATURE_IDS,
};
const TEMPLATE_LABEL = {
  basic: '基本',
  laborContract: '労務・契約管理',
  monthlyField: '月次予定・現場共有',
  all: 'すべて',
};
const asFeatures = (on) => Object.fromEntries(FEATURE_IDS.map((id) => [id, on.includes(id)]));

/** メニュー（9項目。相性の機能を切ると減る。PRD D275。ADR-0045・0047） */
const MENU = [
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
/** すべて入の画面の一覧（パレットの画面。メニューから外した画面も1つずつ。PRD D273・D275） */
const ALL_SCREENS = [
  'ホーム',
  '月の予定',
  '週の予定',
  '日の予定',
  '案を比べる',
  '空き状況',
  '利用者さん一覧',
  'スタッフ一覧',
  '相性',
  '勤務時間（シフト）',
  '勤務の見込み',
  '訪問の種類',
  '特性の項目',
  '条件の重み',
  '管理者設定',
  'データ',
];
/** ひな形ごとの、パレットの画面に出ない画面 */
const HIDDEN = {
  basic: ['案を比べる', '勤務の見込み', '条件の重み', '特性の項目'],
  laborContract: ['案を比べる', '条件の重み', '特性の項目'],
  monthlyField: ['案を比べる', '勤務の見込み', '条件の重み', '特性の項目'],
  all: [],
};
const screensFor = (t) => ALL_SCREENS.filter((l) => !HIDDEN[t].includes(l));
/** 設定のタブ（ひな形ごと。条件の重み・特性の項目は rules を切ると出さない） */
const SETTINGS_TABS = ['訪問の種類', '特性の項目', '条件の重み', '管理者設定', 'データ'];
const settingsTabsFor = (t) => SETTINGS_TABS.filter((l) => !HIDDEN[t].includes(l));
/** メニューは空き状況・欠勤を切ると減る */
const menuFor = (on) =>
  MENU.filter(
    (l) =>
      (l !== '空き状況' || on.includes('vacancy')) &&
      (l !== '欠勤・キャンセルを登録' || on.includes('sudden')) &&
      (l !== '相性' || on.includes('compat')),
  );
/** 下のタブ（ホーム・予定・欠勤・空き状況。「メニュー」はボタン。PRD D274） */
const tabsFor = (on) =>
  ['ホーム', '予定', '欠勤', '空き状況'].filter(
    (l) => (l !== '空き状況' || on.includes('vacancy')) && (l !== '欠勤' || on.includes('sudden')),
  );

/** 切った機能の URL（ひな形ごとに、ホームへ移るもの・移らないもの） */
const ROUTES = [
  { hash: '/compare', feature: 'compare' },
  { hash: '/workload', feature: 'workload' },
  { hash: '/rules', feature: 'rules' },
  { hash: '/items', feature: 'rules' },
  { hash: '/vacancy', feature: 'vacancy' },
  { hash: '/compat', feature: 'compat' },
  { hash: `/month/print?ym=${TODAY.slice(0, 7)}`, feature: 'monthPrint' },
  { hash: `/plan?date=${TODAY}&do=absence`, feature: 'sudden' },
];

/** 画面を新しく開く（about:blank を挟み、`?do=` を読み直す前に消さない） */
async function open(page, hash, ready = 'h1') {
  await page.goto('about:blank');
  await page.goto(`${BASE}#${hash}`);
  await page.locator(ready).first().waitFor({ timeout: 30000 });
  await page.locator('h1').filter({ hasText: /\S/ }).first().waitFor({ timeout: 30000 });
}
/** 保存したデータの入り切り */
const storedFeatures = (page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').org?.features ?? null, STORAGE_KEY);
/** 左のメニュー（見出しと項目名） */
async function menu(page) {
  const side = page.locator('.side-nav');
  return {
    titles: await side.locator('.nav-group-title').allInnerTexts(),
    labels: await side.getByTestId('nav-link').allInnerTexts(),
  };
}
/** パレットの候補（打つ前＝操作と画面） */
async function paletteItems(page) {
  await page.getByTestId('cmdk-open').click();
  await page.getByTestId('cmdk').waitFor();
  const items = await page
    .getByTestId('cmdk-option')
    .evaluateAll((els) =>
      els.map((el) => ({ kind: el.dataset.kind, label: el.querySelector('.cmdk-option-label').textContent })),
    );
  await page.keyboard.press('Escape');
  await page.getByTestId('cmdk').waitFor({ state: 'detached' });
  return {
    screens: items.filter((i) => i.kind === 'screen').map((i) => i.label),
    actions: items.filter((i) => i.kind === 'action').map((i) => i.label),
  };
}
/** パレットで打って絞り込んだ候補の名前 */
async function paletteSearch(page, text) {
  await page.getByTestId('cmdk-open').click();
  await page.getByTestId('cmdk-input').pressSequentially(text, { delay: 20 });
  await settle(page, 150);
  const labels = await page.locator('[data-testid="cmdk-option"] .cmdk-option-label').allInnerTexts();
  await page.keyboard.press('Escape');
  await page.getByTestId('cmdk').waitFor({ state: 'detached' });
  return labels;
}
/** 管理者設定でひな形を適用する（確認に答える） */
async function applyTemplate(page, dlg, id, answer = true) {
  await open(page, '/settings', '[data-testid="feature-templates"]');
  dlg.messages.length = 0;
  dlg.answer = answer;
  await page.locator(`[data-template="${id}"] [data-testid="feature-template-apply"]`).click();
  await settle(page, 400);
  dlg.answer = true;
  return dlg.messages.slice();
}
/** 機能の入り切りを別のタブで書き換える（アプリの外の書き換え。読み直して確かめる） */
async function writeFeaturesInOtherTab(ctx, features) {
  const other = await ctx.newPage();
  await other.goto(`${BASE}#/data`);
  await other.locator('h1').first().waitFor({ timeout: 30000 });
  await other.evaluate(
    ([key, f]) => {
      const d = JSON.parse(localStorage.getItem(key));
      d.org.features = f;
      localStorage.setItem(key, JSON.stringify(d));
    },
    [STORAGE_KEY, features],
  );
  await other.close();
}

// ---- すべて入（初期データ）：管理者のグループと管理者設定の画面 ----
async function allOn(page) {
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await open(page, '/home', '[data-testid="home-tasks"]');
  const m = await menu(page);
  check(m.labels.at(-1) === '設定', 'すべて入：メニューの最後は「設定」', m.labels);
  check(same(m.labels, MENU), 'すべて入：メニューは9項目', m.labels);
  check(
    same(await storedFeatures(page), {}),
    '初期データの入り切りは {}（e2e は初回もすべて入に固定）',
    await storedFeatures(page),
  );

  await page.locator('.side-nav').getByRole('link', { name: '設定' }).click();
  await page.getByTestId('settings-tabs').waitFor();
  await page.getByTestId('settings-tabs').getByRole('link', { name: '管理者設定' }).click();
  await page.waitForURL(/#\/settings/);
  await page.getByTestId('feature-templates').waitFor();
  check((await page.locator('h1').innerText()) === '管理者設定', '管理者設定：見出し');
  check(
    (await page.locator('.page-lead').innerText()).includes('切った機能のデータは消えません'),
    '管理者設定：説明の文',
  );
  check(
    (await page.locator('.side-nav [aria-current="page"]').innerText()) === '設定' &&
      (await page.getByTestId('settings-tabs').locator('[aria-current="page"]').innerText()).trim() === '管理者設定',
    '管理者設定：メニューの今の画面の印は「設定」、設定のタブは「管理者設定」',
  );
  const tmpl = await page.getByTestId('feature-template').evaluateAll((els) => els.map((el) => el.dataset.template));
  check(same(tmpl, ['basic', 'laborContract', 'monthlyField', 'all']), 'ひな形の4つの並び', tmpl);
  const now = await page
    .locator('[data-testid="feature-template"]:has([data-testid="feature-template-now"])')
    .evaluateAll((els) => els.map((el) => el.dataset.template));
  check(same(now, ['all']), '「いまの設定」は すべて', now);
  check((await page.getByTestId('feature-custom').count()) === 0, 'すべて入ではカスタムの印を出さない');
  const sw = await page
    .getByRole('switch')
    .evaluateAll((els) =>
      els.map((el) => ({ checked: el.getAttribute('aria-checked'), disabled: el.getAttribute('aria-disabled') })),
    );
  check(sw.length === 20 && sw.every((s) => s.checked === 'true' && s.disabled === null), 'スイッチは20・すべて入', sw);
  const vac = page.getByRole('switch', { name: '空き状況', exact: true });
  check((await vac.count()) === 1, 'スイッチの名前（読み上げ）：「空き状況」');
  const desc = await vac.evaluate((el) =>
    el
      .getAttribute('aria-describedby')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join('／'),
  );
  check(
    desc.includes('切ると隠れるもの') && desc.includes('空き'),
    'スイッチの説明（aria-describedby）に説明と隠れるもの',
    desc,
  );
  const notice = page.getByRole('switch', { name: '空き枠の案内文' });
  const noticeDesc = await notice.evaluate((el) => el.getAttribute('aria-describedby'));
  check(noticeDesc.split(' ').length === 3, '依存のある機能は依存の注記も読む', noticeDesc);
  const leave = await page.locator('[data-feature="clientLeave"] strong').innerText();
  check(leave === '利用者さんの休み', '機能の名前の呼び方は org.terms', leave);
  await page.screenshot({ path: path.join(OUT_DIR, 'settings-all.png'), fullPage: true });
}

// ---- スイッチ：押すとすぐ保存・トースト・依存・カスタム・切った URL ----
async function switches(page) {
  await open(page, '/settings', '[data-testid="feature-templates"]');
  const vac = page.getByRole('switch', { name: '空き状況', exact: true });
  await vac.click();
  await page.locator('.toast').filter({ hasText: '空き状況を切りました' }).waitFor({ timeout: 5000 });
  check(true, 'トースト「空き状況を切りました」');
  check((await vac.getAttribute('aria-checked')) === 'false', '押すと aria-checked が false');
  check(await vac.evaluate((el) => document.activeElement === el), '押したあともフォーカスはスイッチ');
  await settle(page, 500);
  check((await storedFeatures(page)).vacancy === false, 'すぐ保存（org.features.vacancy＝false）');
  const notice = page.getByRole('switch', { name: '空き枠の案内文' });
  check(
    (await notice.getAttribute('aria-checked')) === 'false' && (await notice.getAttribute('aria-disabled')) === 'true',
    '依存先が切：空き枠の案内文は切で押せない（aria-disabled）',
  );
  const reason = await page.locator('[data-feature="vacancyNotice"] .feature-req').innerText();
  check(reason === '「空き状況」を入れると使えます', '押せない理由', reason);
  // aria-disabled（フォーカスは残す）なので、押すと何もしないことを確かめる
  await notice.click({ force: true });
  await settle(page, 300);
  check((await storedFeatures(page)).vacancyNotice === undefined, '押せないスイッチを押しても書かない');
  check((await page.getByTestId('feature-custom').count()) === 1, 'どのひな形とも違えば「カスタム」');
  check((await page.getByTestId('feature-template-now').count()) === 0, 'カスタムでは「いまの設定」を出さない');
  const tabs = await page.getByTestId('bottom-tab').allInnerTexts();
  check(!tabs.includes('空き状況'), '下のタブから空き状況が消える（DOM）', tabs);
  const m = await menu(page);
  check(
    m.titles.includes('当日・問い合わせ') && !m.labels.includes('空き状況'),
    '空き状況を切っても「当日・問い合わせ」は欠勤・キャンセルを登録が残るので出す',
    m,
  );

  // 切った機能の URL → ホームへ（replace）・知らせ・管理者設定へのリンク
  await open(page, '/staff');
  await page.goto(`${BASE}#/vacancy`);
  await page.getByTestId('feature-off-notice').waitFor({ timeout: 10000 });
  check(hashOf(page) === '#/home', '切った機能の URL（#/vacancy）はホームへ', hashOf(page));
  const text = await page.getByTestId('feature-off-notice').innerText();
  check(text.includes('この機能は管理者設定で切っています') && text.includes('空き状況'), '知らせの文', text);
  await page.goBack();
  await settle(page, 400);
  check(hashOf(page) === '#/staff', '移すのは replace（戻るで切った URL に戻らない）', hashOf(page));
  await page.goto(`${BASE}#/vacancy`);
  await page.getByTestId('feature-off-notice').waitFor({ timeout: 10000 });
  await page.getByTestId('feature-off-settings').click();
  await page.waitForURL(/#\/settings/);
  check(true, '知らせのリンクで管理者設定へ');
  await page.goto(`${BASE}#/vacancy`);
  await page.getByTestId('feature-off-notice').waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: '知らせを閉じる' }).click();
  await settle(page, 300);
  check((await page.getByTestId('feature-off-notice').count()) === 0, '知らせは閉じられる');
  check(hashOf(page) === '#/home', '閉じても URL はホームのまま', hashOf(page));

  // 入れ直すと戻る（データは消えない）
  await open(page, '/settings', '[data-testid="feature-templates"]');
  await page.getByRole('switch', { name: '空き状況', exact: true }).click();
  await page.locator('.toast').filter({ hasText: '空き状況を入れました' }).waitFor({ timeout: 5000 });
  check(
    (await page.getByRole('switch', { name: '空き枠の案内文' }).getAttribute('aria-checked')) === 'true',
    '空き状況を入れ直すと案内文も使える',
  );
  check((await page.getByTestId('feature-custom').count()) === 0, '入れ直すと すべて に戻る（カスタムを出さない）');
}

/** ひな形ごとの確かめ（メニュー・下のタブ・パレット・ホーム・切った URL） */
async function checkTemplate(page, t) {
  const on = TEMPLATE_ON[t];
  const label = TEMPLATE_LABEL[t];
  await open(page, '/home', '[data-testid="home-tasks"]');
  const m = await menu(page);
  check(same(m.labels, menuFor(on)), `${label}：メニューの項目（相性の機能の入り切りだけで変わる）`, m.labels);
  const tabs = await page.getByTestId('bottom-tab').allInnerTexts();
  check(same(tabs, tabsFor(on)), `${label}：下のタブ`, tabs);
  const pal = await paletteItems(page);
  check(same(pal.screens, screensFor(t)), `${label}：パレットの画面`, pal.screens);
  check(
    pal.actions.includes('欠勤・キャンセルを登録') === on.includes('sudden') &&
      pal.actions.includes('問い合わせに答える') === on.includes('vacancy'),
    `${label}：パレットの操作`,
    pal.actions,
  );
  const anytime = await page
    .getByTestId('home-anytime')
    .locator('a')
    .evaluateAll((els) => els.map((el) => el.dataset.testid));
  const wantAnytime = [
    ...(on.includes('sudden') ? ['home-absence'] : []),
    ...(on.includes('vacancy') ? ['home-vacancy'] : []),
    'home-clients',
    'home-staff',
  ];
  check(same(anytime, wantAnytime), `${label}：ホームのいつでもの入口`, anytime);
  const settingsFound = await paletteSearch(page, 'かんりしゃせってい');
  check(settingsFound.includes('管理者設定'), `${label}：パレットで「かんりしゃせってい」→ 管理者設定`, settingsFound);
  for (const r of ROUTES) {
    await page.goto('about:blank');
    await page.goto(`${BASE}#${r.hash}`);
    await page.locator('h1').filter({ hasText: /\S/ }).first().waitFor({ timeout: 30000 });
    await settle(page, 200);
    const h = hashOf(page);
    const off = !on.includes(r.feature);
    const hasNotice = (await page.getByTestId('feature-off-notice').count()) === 1;
    if (off) check(h === '#/home' && hasNotice, `${label}：切った ${r.hash} はホームへ移し知らせる`, h);
    else check(!h.startsWith('#/home') && !hasNotice, `${label}：入っている ${r.hash} は開ける`, h);
  }
  // 管理者設定と土台の画面は切れない
  for (const h of ['/settings', '/data', '/types', '/availability']) {
    await open(page, h);
    check(hashOf(page) === `#${h}`, `${label}：${h} は開ける（切れない）`, hashOf(page));
  }
  const s = await open(page, '/settings', '[data-testid="feature-templates"]').then(() =>
    page
      .locator('[data-testid="feature-template"]:has([data-testid="feature-template-now"])')
      .evaluateAll((els) => els.map((el) => el.dataset.template)),
  );
  check(same(s, [t]), `${label}：管理者設定の「いまの設定」`, s);
  const stabs = (await page.getByTestId('settings-tabs').locator('a').allInnerTexts()).map((x) => x.trim());
  check(same(stabs, settingsTabsFor(t)), `${label}：設定のタブ`, stabs);
  // スイッチの並びはグループ順（メニューのグループにそろえる。ADR-0034）なので、行の data-feature で ID に引き当てる
  const byId = Object.fromEntries(
    await page
      .getByTestId('feature-row')
      .evaluateAll((els) =>
        els.map((el) => [el.dataset.feature, el.querySelector('[role="switch"]')?.getAttribute('aria-checked')]),
      ),
  );
  const checked = FEATURE_IDS.map((id) => byId[id]);
  check(
    same(
      checked,
      FEATURE_IDS.map((id) => String(on.includes(id))),
    ),
    `${label}：スイッチの入り切りが表どおり`,
    checked,
  );
}

// ---- ひな形の4通り ----
async function templates(page, dlg, ctx) {
  // すべて入から始める（スイッチの確かめで {vacancy: true} などが残っていても すべて と同じ）
  await open(page, '/settings', '[data-testid="feature-templates"]');
  const before = await storedFeatures(page);
  // 取り消すと変わらない
  const msg0 = await applyTemplate(page, dlg, 'basic', false);
  check(
    msg0.length === 1 && msg0[0].includes('ひな形「基本」を適用しますか？'),
    '適用する前に独自の確認（見出し）',
    msg0,
  );
  check(
    msg0[0]?.includes('入る機能：なし') && msg0[0]?.includes('切れる機能：') && msg0[0]?.includes('案を比べる'),
    '確認の本文に入る機能・切れる機能の名前',
    msg0,
  );
  check(same(await storedFeatures(page), before), '取り消すと入り切りは変わらない', await storedFeatures(page));

  // 基本（管理者設定で適用する）
  await applyTemplate(page, dlg, 'basic');
  await page.locator('.toast').filter({ hasText: 'ひな形「基本」を適用しました' }).waitFor({ timeout: 5000 });
  check(same(await storedFeatures(page), asFeatures(TEMPLATE_ON.basic)), '基本：全20の ID を明示して書く');
  await checkTemplate(page, 'basic');
  await page.screenshot({ path: path.join(OUT_DIR, 'settings-basic.png'), fullPage: true });

  // 労務・契約管理（別のタブで localStorage を書き換える）
  await writeFeaturesInOtherTab(ctx, asFeatures(TEMPLATE_ON.laborContract));
  await checkTemplate(page, 'laborContract');

  // 月次予定・現場共有（管理者設定で適用する。確認に入る機能・切れる機能）
  const msg = await applyTemplate(page, dlg, 'monthlyField');
  check(
    msg[0]?.includes('入る機能：') &&
      msg[0]?.includes('月の予定の印刷') &&
      msg[0]?.includes('切れる機能：') &&
      msg[0]?.includes('勤務の見込み'),
    '月次予定・現場共有：確認に入る機能・切れる機能',
    msg,
  );
  await checkTemplate(page, 'monthlyField');

  // すべて
  await applyTemplate(page, dlg, 'all');
  await checkTemplate(page, 'all');
}

// ---- 390px・印刷 ----
async function mobile(page, dlg) {
  await applyTemplate(page, dlg, 'basic');
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/settings', '[data-testid="feature-templates"]');
  const w1 = await page.evaluate(() => document.documentElement.scrollWidth);
  check(w1 <= 390, '390px：管理者設定が横にはみ出さない', w1);
  const name = await page.getByTestId('screen-name').innerText();
  check(name.replace(/\s/g, '') === '設定・管理者設定', '390px：上の帯の名前', name);
  await page.screenshot({ path: path.join(OUT_DIR, 'settings-mobile.png'), fullPage: true });
  await page.goto('about:blank');
  await page.goto(`${BASE}#/compare`);
  await page.getByTestId('feature-off-notice').waitFor({ timeout: 10000 });
  const w2 = await page.evaluate(() => document.documentElement.scrollWidth);
  check(w2 <= 390, '390px：ホームの知らせが横にはみ出さない', w2);
  const tabs = await page.getByTestId('bottom-tabs').locator('.bottom-tab').allInnerTexts();
  check(tabs.length === 5, '390px：基本は下のタブ5つ（ホーム・予定・欠勤・空き状況・メニュー）', tabs);
  await page.getByTestId('menu-btn').click();
  const drawer = await page.locator('.nav-drawer .nav-link').allInnerTexts();
  check(same(drawer, menuFor(TEMPLATE_ON.basic)), '390px：引き出しもメニューと同じ項目', drawer);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(OUT_DIR, 'notice-mobile.png'), fullPage: true });
  await page.emulateMedia({ media: 'print' });
  check(!(await page.getByTestId('feature-off-notice').isVisible()), '印刷：知らせを出さない');
  check(!(await page.getByTestId('bottom-tabs').isVisible()), '印刷：下のタブを出さない');
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 1400, height: 1000 });
  await open(page, '/settings', '[data-testid="feature-templates"]');
  await page.emulateMedia({ media: 'print' });
  check(!(await page.getByTestId('feature-template-apply').first().isVisible()), '印刷：ひな形の「適用」を出さない');
  await page.emulateMedia({ media: 'screen' });
  await applyTemplate(page, dlg, 'all');
}

// ---- 切った URL のすり抜け（末尾の /・大文字）と、390px で空き状況を切ったときの下のタブ ----
async function pathVariants(page, dlg, ctx) {
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await open(page, '/home', '[data-testid="home-tasks"]');
  await writeFeaturesInOtherTab(ctx, { vacancy: false, monthPrint: false });
  for (const h of ['/vacancy/', '/Vacancy', '/VACANCY//', '/month/print/', `/Month/Print?ym=${TODAY.slice(0, 7)}`]) {
    await page.goto('about:blank');
    await page.goto(`${BASE}#${h}`);
    await page.locator('h1').filter({ hasText: /\S/ }).first().waitFor({ timeout: 30000 });
    await settle(page, 200);
    const hasNotice = (await page.getByTestId('feature-off-notice').count()) === 1;
    check(hashOf(page) === '#/home' && hasNotice, `切った機能の ${h} もホームへ移し知らせる`, hashOf(page));
  }
  // 390px：空き状況を切ると下のタブは4つ（ホーム・予定・欠勤・メニュー）で、全幅を等分する
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/home', '[data-testid="home-tasks"]');
  const boxes = await page
    .getByTestId('bottom-tabs')
    .locator('.bottom-tab')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ x: r.x, w: r.width })));
  const vw = await page.evaluate(() => document.documentElement.clientWidth);
  const total = boxes.reduce((a, b) => a + b.w, 0);
  check(boxes.length === 4, '390px・空き状況を切る：下のタブは4つ', boxes.length);
  check(
    boxes.length === 4 &&
      Math.abs(boxes[0].x) <= 1 &&
      Math.abs(boxes[3].x + boxes[3].w - vw) <= 1 &&
      Math.abs(total - vw) <= 2 &&
      boxes.every((b) => Math.abs(b.w - vw / 4) <= 1),
    '390px・空き状況を切る：4つが全幅を等分する',
    { vw, boxes },
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'tabs-4-mobile.png') });
  await page.setViewportSize({ width: 1400, height: 1000 });
  // 欠勤・キャンセルと空き状況の両方を切ると「当日・問い合わせ」は見出しごと消える（PRD D232。片方なら残るのは allOn で確かめる）
  await writeFeaturesInOtherTab(ctx, { sudden: false, vacancy: false });
  await open(page, '/home', '[data-testid="home-tasks"]');
  const m = await menu(page);
  check(
    !m.titles.includes('当日・問い合わせ') &&
      !m.labels.includes('欠勤・キャンセルを登録') &&
      !m.labels.includes('空き状況') &&
      same(m.titles, ['人']),
    '欠勤・キャンセルと空き状況を切ると「当日・問い合わせ」は見出しごと出さない',
    m.titles,
  );
  await applyTemplate(page, dlg, 'all');
}

/** 「10/21」の形（月の要対応の日付の文） */
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

// ---- 切った機能（稼働の見込み・欠勤・キャンセルなど）の画面へ移るリンク・ボタンを、画面の中から出さない ----
async function deadEnds(page, dlg, ctx) {
  // 用意（e2e-links の prepare と同じ）：今日より後の日に案を作り、入らない訪問・欠勤の人に残る訪問・拘束の上限超えを作る
  await open(page, '/plan', '.date-switch select');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
  await page.locator('.date-switch select').waitFor({ timeout: 30000 });
  const options = await page.locator('.date-switch select option').evaluateAll((os) => os.map((o) => o.value));
  const second = options.find((d) => d > TODAY) ?? '';
  check(second !== '', '用意：今日より後の日がある', second);
  const ym = second.slice(0, 7);
  await page.locator('.date-switch select').selectOption(second);
  await page.waitForFunction(
    ({ k, d }) => !!JSON.parse(localStorage.getItem(k) ?? '{}').aiPlans?.[d],
    { k: STORAGE_KEY, d: second },
    { timeout: 60000 },
  );
  // 別のタブで書く（storage の知らせでこのタブのデータも入れ替わる）
  const other = await ctx.newPage();
  await other.goto(`${BASE}#/data`);
  await other.locator('h1').first().waitFor({ timeout: 30000 });
  const absent = await other.evaluate(
    ({ k, d }) => {
      const data = JSON.parse(localStorage.getItem(k));
      const plan = data.aiPlans[d];
      const staffWith = Object.keys(plan.routes).filter((s) => s !== '__none' && plan.routes[s].length > 0);
      const a = staffWith[0];
      const vid = plan.routes[a][0];
      plan.routes[a] = plan.routes[a].slice(1);
      plan.unassigned = [...(plan.unassigned ?? []), vid];
      const absentId = staffWith[1];
      data.absences = [
        ...data.absences.filter((x) => !(x.staffId === absentId && x.date === d)),
        { id: `e2e-features-${absentId}`, staffId: absentId, date: d, from: null, to: null, note: '' },
      ];
      data.org.spanLimitHours = 1;
      // 稼働の見込み・欠勤・キャンセル・月の印刷・案を比べるを切る
      // 希望休のまとめ入力も切る（「休みの人に N」の印は事実なので残る）
      data.org.features = { workload: false, sudden: false, monthPrint: false, compare: false, requestedOff: false };
      localStorage.setItem(k, JSON.stringify(data));
      return absentId;
    },
    { k: STORAGE_KEY, d: second },
  );
  await other.close();
  await settle(page, 300);

  // 月の要対応：休みの人に訪問・拘束の上限の行は、欠勤・キャンセルの欄・稼働の見込みでなく日の画面へ
  await open(page, `/month?ym=${ym}&do=attention`, '[data-testid="month-attention"]');
  await page.locator('.month-attention-btn').first().waitFor({ timeout: 30000 });
  const rows = await page
    .locator('.month-attention-btn')
    .evaluateAll((els) => els.map((el) => ({ cls: el.className, to: el.dataset.to ?? '', text: el.textContent })));
  check(rows.length > 0, '月の要対応の行がある', rows.length);
  check(
    rows.every((r) => !r.to.includes('/workload') && !r.to.includes('do=absence')),
    '月の要対応：切った機能（勤務の見込み・欠勤・キャンセル）への行き先が無い',
    rows.map((r) => r.to),
  );
  for (const kind of ['absentLeft', 'overSpan']) {
    const r = rows.find((x) => x.cls.includes(`is-${kind}`) && x.text.includes(md(second)));
    check(
      !!r && r.to === '/plan' && r.text.includes('（日の予定で開く）'),
      `月の要対応：${kind} の行は日の予定へ（「（日の予定で開く）」）`,
      r,
    );
  }
  check(
    (await page.getByTestId('month-absent-left').count()) > 0,
    '月：希望休のまとめ入力を切っても「休みの人に N」の印は出す（欠勤の人に残る訪問の事実）',
  );
  await page.getByTestId('month-more').click();
  await page.getByTestId('month-more-list').waitFor();
  check((await page.getByTestId('month-workload').count()) === 0, '月：「その他 ▾」に勤務の見込みを出さない');
  check((await page.getByTestId('month-print').count()) === 0, '月：「その他 ▾」に印刷を出さない');
  await page.keyboard.press('Escape');
  const r = rows.find((x) => x.cls.includes('is-overSpan') && x.text.includes(md(second)));
  if (r) {
    await page
      .locator('.month-attention-btn.is-overSpan')
      .filter({ hasText: md(second) })
      .first()
      .click();
    await page.waitForURL(/#\/plan/, { timeout: 10000 });
    check(
      !/workload/.test(hashOf(page)) && !(await page.getByTestId('feature-off-notice').count()),
      '拘束の上限の行を押すと日の予定',
      hashOf(page),
    );
  }

  // 日の画面：稼働の見込みを切ると拘束の上限の帯ごと出さない（その2。リンク・ボタンも無い）。「案を変える ▾」に比べるが無い
  await open(page, `/plan?date=${second}`, '.date-switch select');
  await page.getByTestId('plan-menu').waitFor({ timeout: 60000 });
  await settle(page, 500);
  check(
    (await page.getByTestId('band-over-span').count()) === 0 &&
      (await page.getByTestId('over-span-link').count()) === 0 &&
      (await page.locator('.app-main a[href*="workload"]').count()) === 0,
    '日の予定：勤務の見込みを切ると拘束の上限の帯と勤務の見込みへのリンクを出さない',
  );
  await page.getByTestId('plan-menu').click();
  await page.getByTestId('plan-menu-list').waitFor({ timeout: 5000 });
  check(
    (await page.getByTestId('plan-menu-compare').count()) === 0 &&
      (await page.getByTestId('plan-menu-revert').count()) === 1,
    '日の予定：「案を変える ▾」に比べるを出さない（戻すは残る）',
  );
  await page.keyboard.press('Escape');

  // 稼働時間の右の欄：欠勤・キャンセルの欄へのリンクが無い
  const data = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORAGE_KEY);
  const name = data.staff.find((s) => s.id === absent)?.name ?? '';
  await open(page, '/availability', '.avail-table');
  const legend = await page.locator('.app-main').innerText();
  check(
    legend.includes('急な欠勤') && !legend.includes('急な欠勤（日の予定で登録）') && !legend.includes('予定の画面'),
    '勤務時間（シフト）の凡例：欠勤・キャンセルを切ると「（日の予定で登録）」を出さない',
  );
  const heads = await page.locator('.avail-table thead th').allInnerTexts();
  const col = heads.findIndex((t) => t.replace(/\s+/g, '').startsWith(md(second)));
  check(col > 0, '稼働時間の表にその日の列がある', col);
  await page
    .locator('.avail-table tbody tr')
    .filter({ has: page.locator('th.avail-name', { hasText: name }) })
    .locator('td')
    .nth(col - 1)
    .locator('button')
    .click();
  await page.locator('.drawer').waitFor({ timeout: 5000 });
  await settle(page, 200);
  check(
    (await page.getByTestId('availability-absence-link').count()) === 0 &&
      (await page.locator('.drawer a[href*="do=absence"]').count()) === 0,
    '稼働時間の右の欄：欠勤・キャンセルの欄へのリンクを出さない',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'dead-ends-availability.png') });
  await applyTemplate(page, dlg, 'all');
  // 入に戻すと凡例に登録の場所（新しい画面名「日の予定」）が出る（PRD D230）
  await open(page, '/availability', '.avail-table');
  check(
    (await page.locator('.app-main').innerText()).includes('急な欠勤（日の予定で登録）'),
    '勤務時間（シフト）の凡例：欠勤・キャンセルが入なら「急な欠勤（日の予定で登録）」',
  );
}

/** ひな形ごとの、画面の中の入口（その2。ADR-0028 の「切ると隠れるもの」） */
async function insideEntries(page, dlg, ctx) {
  for (const t of ['basic', 'laborContract', 'monthlyField', 'all']) {
    const on = (id) => TEMPLATE_ON[t].includes(id);
    const label = TEMPLATE_LABEL[t];
    await open(page, '/home', '[data-testid="home-tasks"]');
    await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
    await open(page, '/home', '[data-testid="home-tasks"]');
    await writeFeaturesInOtherTab(ctx, asFeatures(TEMPLATE_ON[t]));
    const data = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORAGE_KEY);
    check(same(data.org.features, asFeatures(TEMPLATE_ON[t])), `${label}：入り切りを書いた`);
    const count = (id) => page.getByTestId(id).count();

    // 日の画面（今日）
    await open(page, `/plan?date=${TODAY}`, '.date-switch select');
    await page.getByTestId('plan-menu').waitFor({ timeout: 60000 });
    await page.waitForFunction(
      ({ k, d }) => !!JSON.parse(localStorage.getItem(k) ?? '{}').aiPlans?.[d],
      { k: STORAGE_KEY, d: TODAY },
      { timeout: 60000 },
    );
    await settle(page, 500);
    check((await count('sudden-open')) === (on('sudden') ? 1 : 0), `${label}：日の予定の「欠勤・キャンセルを登録」`);
    check(
      (await page.locator('.absence-btn').count()) > 0 === on('sudden'),
      `${label}：列の見出しの「この人の欠勤を登録」`,
    );
    // 予定をメールで送るは見出しの主ボタンの隣（PRD D306）
    check((await count('day-mail')) === (on('mail') ? 1 : 0), `${label}：日の予定の見出しの「予定をメールで送る」`);
    if (!on('rules')) check((await count('plan-reason')) === 0, `${label}：点数の横の理由を出さない`);
    await page.getByTestId('plan-menu').click();
    await page.getByTestId('plan-menu-list').waitFor({ timeout: 5000 });
    check((await count('plan-menu-tune')) === (on('rules') ? 1 : 0), `${label}：「条件を調整する…」`);
    const presets = await count('plan-menu-preset');
    check(presets === (on('rules') ? data.presets.length : 1), `${label}：プリセットの数`, presets);
    check((await count('plan-menu-batch')) === (on('rules') ? 1 : 0), `${label}：まとめて作る`);
    check((await count('plan-menu-compare')) === (on('compare') ? 1 : 0), `${label}：「2つの案を比べる」`);
    await page.keyboard.press('Escape');

    // 〈利用者さん〉：その人の画面の節（PRD D308）
    const client = data.clients.find((c) => c.referrer.name) ?? data.clients[0];
    const cid = encodeURIComponent(client.id);
    const csec = (name) => page.locator(`[data-testid="person-sec"][data-section="${name}"]`);
    await open(page, `/clients/${cid}`, '[data-testid="person-view"]');
    check((await count('schedule-leaves')) === 1, `${label}：予定のタブの休み（事実なので残す）`);
    check(
      (await page.getByTestId('person-tabs').locator('[data-tab="leaves"]').count()) === (on('clientLeave') ? 1 : 0),
      `${label}：休みのタブ`,
    );
    await open(page, `/clients/${cid}?tab=basic`, '[data-testid="person-sec"]');
    const viewText = await page.getByTestId('person-view').innerText();
    check(viewText.includes('紹介元') === on('clientStage'), `${label}：基本情報の紹介元`);
    check(viewText.includes('訪問先の決まりごと') === on('visitNotes'), `${label}：基本情報の決まりごと`);
    await csec('stage').getByTestId('sec-edit').click();
    await page.getByTestId('client-stage-select').waitFor({ timeout: 5000 });
    const stages = await page.getByTestId('client-stage-select').locator('option').allInnerTexts();
    check(
      same(stages, on('clientStage') ? ['相談受付', '顔合わせ', '契約', '利用中', '終了'] : ['利用中', '終了']),
      `${label}：段階の選択`,
      stages,
    );
    check((await count('client-referrer-name')) === (on('clientStage') ? 1 : 0), `${label}：紹介元の欄`);
    await csec('stage').getByTestId('sec-cancel').click();
    if (on('visitNotes')) {
      await csec('rules').getByTestId('sec-edit').click();
      check((await count('visit-rules-form')) === 1, `${label}：決まりごとの欄`);
      await csec('rules').getByTestId('sec-cancel').click();
    } else check((await csec('rules').count()) === 0, `${label}：決まりごとの節が無い`);
    await csec('place').getByTestId('sec-edit').click();
    await page.getByTestId('client-postal').waitFor({ timeout: 5000 });
    check((await count('client-postal-search')) === (on('geocode') ? 1 : 0), `${label}：住所を探す`);
    check((await count('client-postal')) === 1, `${label}：郵便番号の欄は残る`);
    await csec('place').getByTestId('sec-cancel').click();
    await open(page, `/clients/${cid}?tab=staffing`, '[data-testid="person-sec"]');
    check(
      (await page.getByTestId('person-view').innerText()).includes('担当できる人') === on('allowedStaff'),
      `${label}：担当の節の担当できる人`,
    );
    await csec('staffing').getByTestId('sec-edit').click();
    check(
      (await csec('staffing').getByText('担当できる人を限る').count()) === (on('allowedStaff') ? 1 : 0),
      `${label}：担当できる人の欄`,
    );
    await csec('staffing').getByTestId('sec-cancel').click();
    if (on('clientLeave')) {
      await open(page, `/clients/${cid}?tab=leaves`, '[data-testid="person-view"]');
      check((await count('leaves-section')) === 1, `${label}：休みの欄`);
    }
    await open(page, '/clients', '[data-testid="client-row"]');
    const chips = await page
      .getByTestId('clients-cf-chip')
      .evaluateAll((els) => els.map((el) => el.dataset.chip).filter(Boolean));
    check(chips.includes('leave') === on('clientLeave'), `${label}：絞り込みのチップ「休み」`, chips);
    check(chips.includes('limited') === on('allowedStaff'), `${label}：絞り込みのチップ「担当を限る」`, chips);

    // 〈スタッフ〉：その人の画面の節
    const staff = data.staff[0];
    const sid = encodeURIComponent(staff.id);
    await open(page, `/staff/${sid}?tab=basic`, '[data-testid="person-sec"]');
    const staffView = await page.getByTestId('person-view').innerText();
    check(staffView.includes('メールアドレス') === on('mail'), `${label}：〈スタッフ〉の基本情報のメールアドレス`);
    check((await csec('lastDay').count()) === (on('offboard') ? 1 : 0), `${label}：最終勤務日の節`);
    await csec('basic').getByTestId('sec-edit').click();
    check((await count('staff-email')) === (on('mail') ? 1 : 0), `${label}：〈スタッフ〉のメールアドレスの欄`);
    await csec('basic').getByTestId('sec-cancel').click();
    await open(page, `/staff/${sid}?tab=compat`, '[data-testid="person-sec"]');
    check(
      (await page.getByTestId('person-view').innerText()).includes('◎ 選ばれやすい') === on('compat'),
      `${label}：〈スタッフ〉の相性`,
    );

    // 月：〈スタッフ〉を選ぶと「休みを入れる」
    await open(
      page,
      `/month?ym=${TODAY.slice(0, 7)}&staff=${encodeURIComponent(staff.id)}`,
      '[data-testid="month-focus"]',
    );
    await settle(page, 300);
    check((await count('month-off-toggle')) === (on('requestedOff') ? 1 : 0), `${label}：月の「休みを入れる」`);
    // 印刷は「その他 ▾」の中（PRD D278）
    await page.getByTestId('month-more').click();
    await page.getByTestId('month-more-list').waitFor({ timeout: 5000 });
    check((await count('month-print')) === (on('monthPrint') ? 1 : 0), `${label}：月の「その他 ▾」の印刷`);
    await page.keyboard.press('Escape');

    // 空き状況の案内文
    if (on('vacancy')) {
      await open(page, '/vacancy', '[data-testid="vacancy-step-next"]');
      check((await count('notice-card')) === (on('vacancyNotice') ? 1 : 0), `${label}：空き状況の案内文の欄`);
    }
    // データの Excel
    await open(page, '/data');
    check((await count('excel-card')) === (on('excel') ? 1 : 0), `${label}：データの Excel の欄`);
    // 稼働の見込みの交通費の単価
    if (on('workload')) {
      await open(page, '/workload');
      check((await count('work-fare')) === (on('fare') ? 1 : 0), `${label}：交通費の単価の欄`);
    }
    if (t === 'basic') {
      await page.setViewportSize({ width: 390, height: 844 });
      await open(page, `/plan?date=${TODAY}`, '.date-switch select');
      await page.getByTestId('plan-menu').waitFor({ timeout: 60000 });
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      check(w <= 390, '390px・基本：日の予定が横にはみ出さない', w);
      await page.screenshot({ path: path.join(OUT_DIR, 'inside-basic-mobile.png') });
      await page.setViewportSize({ width: 1400, height: 1000 });
    }
  }
  await applyTemplate(page, dlg, 'all');
}

/**
 * 切ったまま保存してもデータが残る（ADR-0028。データは消さない）：段階が「契約」の〈利用者さん〉の段階・担当できる人、
 * 〈スタッフ〉のメールアドレス、毎月のパターンの繰り返し方（repeat）と第何週（monthWeeks）
 */
async function keepData(page, dlg, ctx) {
  await open(page, '/home', '[data-testid="home-tasks"]');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await open(page, '/home', '[data-testid="home-tasks"]');
  const other = await ctx.newPage();
  await other.goto(`${BASE}#/data`);
  await other.locator('h1').first().waitFor({ timeout: 30000 });
  const ids = await other.evaluate((k) => {
    const data = JSON.parse(localStorage.getItem(k));
    const withPattern = data.clients.find((c) => data.patterns.some((p) => p.clientId === c.id)) ?? data.clients[0];
    const s0 = data.staff.find((s) => s.active);
    const c = withPattern;
    c.stage = 'contract';
    c.active = false;
    c.tentative = false;
    c.allowedStaffIds = [s0.id];
    s0.email = 'keep@example.com';
    const p = data.patterns.find((x) => x.clientId === c.id);
    if (p) {
      p.repeat = 'monthly';
      p.everyWeeks = 1;
      p.monthWeeks = [1, 3];
      p.dayTimes = [];
    }
    data.org.features = { clientStage: false, allowedStaff: false, mail: false, patternMonthly: false };
    localStorage.setItem(k, JSON.stringify(data));
    return {
      client: c.id,
      staff: s0.id,
      pattern: p?.id ?? null,
      others: data.patterns.filter((x) => x.clientId === c.id && x.id !== p?.id).map((x) => x.id),
    };
  }, STORAGE_KEY);
  await other.close();
  await settle(page, 300);
  const stored = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORAGE_KEY);

  // 〈利用者さん〉：段階・担当できる人の欄が無いまま保存する（節ごとに保存）
  const sec = (name) => page.locator(`[data-testid="person-sec"][data-section="${name}"]`);
  await open(page, `/clients/${encodeURIComponent(ids.client)}?tab=basic`, '[data-testid="person-sec"]');
  await sec('stage').getByTestId('sec-edit').click();
  await page.getByTestId('client-stage-select').waitFor({ timeout: 5000 });
  check(
    (await page.getByTestId('client-stage-select').inputValue()) === 'contract',
    '段階・紹介元を切っても、契約の人の選択は今の段階のまま',
  );
  await sec('stage').getByTestId('sec-save').click();
  await sec('stage').getByTestId('sec-edit').waitFor({ timeout: 5000 });
  await open(page, `/clients/${encodeURIComponent(ids.client)}?tab=staffing`, '[data-testid="person-sec"]');
  await sec('staffing').getByTestId('sec-edit').click();
  await sec('staffing').getByTestId('sec-save').click();
  await sec('staffing').getByTestId('sec-edit').waitFor({ timeout: 5000 });
  await settle(page, 300);
  let data = await stored();
  const c = data.clients.find((x) => x.id === ids.client);
  check(c.stage === 'contract', '切ったまま保存しても段階（契約）が残る', c.stage);
  check(same(c.allowedStaffIds, [ids.staff]), '切ったまま保存しても担当できる人が残る', c.allowedStaffIds);

  // 毎月のパターン：曜日ごと・第N週を切ったまま直す（予定のタブの繰り返し）
  if (ids.pattern) {
    await open(page, `/clients/${encodeURIComponent(ids.client)}`, '[data-testid="patterns-section"]');
    await page
      .locator(`[data-testid="pattern-row"][data-pattern="${ids.pattern}"]`)
      .getByTestId('pattern-edit')
      .click();
    await page.getByTestId('pattern-form').waitFor({ timeout: 5000 });
    check(
      (await page.getByTestId('pattern-monthly-off').count()) === 1,
      '切った毎月のパターン：管理者設定で切っていますの注記',
    );
    check(
      (await page.getByTestId('pattern-repeat').isDisabled()) &&
        (await page.getByTestId('pattern-month-weeks').locator('button').first().isDisabled()),
      '切った毎月のパターン：繰り返し方と第何週は読むだけ',
    );
    await page.getByTestId('pattern-save').click();
    await settle(page, 600);
    data = await stored();
    const mine = data.patterns.filter((p) => p.clientId === ids.client && !ids.others.includes(p.id));
    check(
      mine.length > 0 && mine.every((p) => p.repeat === 'monthly' && same(p.monthWeeks, [1, 3])),
      '切ったまま直しても毎月のパターンの repeat・monthWeeks が残る',
      mine.map((p) => [p.repeat, p.monthWeeks]),
    );
  }

  // 〈スタッフ〉：メールアドレスの欄が無いまま保存する
  await open(page, `/staff/${encodeURIComponent(ids.staff)}?tab=basic`, '[data-testid="person-sec"]');
  await sec('basic').getByTestId('sec-edit').click();
  await sec('basic').locator('input').first().waitFor({ timeout: 5000 });
  check((await page.getByTestId('staff-email').count()) === 0, 'メールを切るとメールアドレスの欄が無い');
  await sec('basic').getByTestId('sec-save').click();
  await sec('basic').getByTestId('sec-edit').waitFor({ timeout: 5000 });
  await settle(page, 300);
  data = await stored();
  const s = data.staff.find((x) => x.id === ids.staff);
  check(s.email === 'keep@example.com', '切ったまま保存しても〈スタッフ〉のメールアドレスが残る', s.email);
  await applyTemplate(page, dlg, 'all');
}

/** 相性を切るときの確認（D215）・「条件が変わった」（D214）・相性×の組が切ると担当に入る */
async function turnOffCompat(page, dlg, ctx) {
  await open(page, '/plan', '.date-switch select');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
  await page.locator('.date-switch select').waitFor({ timeout: 30000 });
  const options = await page.locator('.date-switch select option').evaluateAll((os) => os.map((o) => o.value));
  const second = options.find((d) => d > TODAY) ?? '';
  await page.locator('.date-switch select').selectOption(second);
  await page.waitForFunction(
    ({ k, d }) => !!JSON.parse(localStorage.getItem(k) ?? '{}').aiPlans?.[d],
    { k: STORAGE_KEY, d: second },
    { timeout: 60000 },
  );
  // 別のタブで、その日の担当の1組を相性×にする（相性が入なら、作り直すとその組は担当にならない）
  const other = await ctx.newPage();
  await other.goto(`${BASE}#/data`);
  await other.locator('h1').first().waitFor({ timeout: 30000 });
  const pair = await other.evaluate(
    ({ k, d }) => {
      const data = JSON.parse(localStorage.getItem(k));
      const plan = data.aiPlans[d];
      const sid = Object.keys(plan.routes).find((s) => s !== '__none' && plan.routes[s].length > 0);
      const vid = plan.routes[sid][0];
      const cid = data.visits.find((v) => v.id === vid).clientId;
      // ほかの〈スタッフ〉は全員この〈利用者さん〉と相性×にして、その人だけが入れるようにする
      data.compat[cid] = Object.fromEntries(data.staff.map((s) => [s.id, -2]));
      // 案と記録を消して、この日を作り直させる
      delete data.aiPlans[d];
      delete data.aiRuns[d];
      localStorage.setItem(k, JSON.stringify(data));
      return { sid, vid, cid };
    },
    { k: STORAGE_KEY, d: second },
  );
  await other.close();
  const assignedOf = (vid) =>
    page.evaluate(
      ({ k, d, v }) => {
        const plan = JSON.parse(localStorage.getItem(k) ?? '{}').aiPlans?.[d];
        if (!plan) return 'none';
        return Object.keys(plan.routes).find((s) => s !== '__none' && plan.routes[s].includes(v)) ?? null;
      },
      { k: STORAGE_KEY, d: second, v: vid },
    );
  await open(page, `/plan?date=${second}`, '.date-switch select');
  await page.waitForFunction(
    ({ k, d }) => !!JSON.parse(localStorage.getItem(k) ?? '{}').aiPlans?.[d],
    { k: STORAGE_KEY, d: second },
    { timeout: 60000 },
  );
  check((await assignedOf(pair.vid)) === null, '相性が入：全員と×の訪問は担当に入らない', await assignedOf(pair.vid));

  // 管理者設定で相性を切る：独自の確認（件数と効き方）。取り消すと変わらない
  await open(page, '/settings', '[data-testid="feature-templates"]');
  dlg.messages.length = 0;
  dlg.answer = false;
  await page.getByRole('switch', { name: '相性', exact: true }).click();
  await settle(page, 400);
  dlg.answer = true;
  check(
    dlg.messages.length === 1 &&
      dlg.messages[0].includes('相性を切りますか？') &&
      /相性 \d+組は計算から外れます/.test(dlg.messages[0]),
    '相性を切る前に独自の確認（件数と効き方）',
    dlg.messages,
  );
  check((await storedFeatures(page)).compat === undefined, '確認を取り消すと切らない');
  dlg.messages.length = 0;
  await page.getByRole('switch', { name: '相性', exact: true }).click();
  await page.locator('.toast').filter({ hasText: '相性を切りました' }).waitFor({ timeout: 5000 });
  await settle(page, 500);
  check((await storedFeatures(page)).compat === false, '確認すると切る（org.features.compat＝false）');
  // データの無い機能は確認なしで切れる
  dlg.messages.length = 0;
  await page.getByRole('switch', { name: '月の予定の印刷', exact: true }).click();
  await page.locator('.toast').filter({ hasText: '月の予定の印刷を切りました' }).waitFor({ timeout: 5000 });
  check(dlg.messages.length === 0, 'データの無い機能は確認なしで切る', dlg.messages);

  // 相性を切ったので、その日の案は「条件が変わった」（月の要対応）
  await open(page, `/month?ym=${second.slice(0, 7)}&do=attention`, '[data-testid="month-attention"]');
  await page.locator('.month-attention-btn').first().waitFor({ timeout: 30000 });
  const stale = await page.locator('.month-attention-btn.is-stale').allInnerTexts();
  check(
    stale.some((x) => x.includes(md(second))),
    '相性を切ると、その日が月の要対応の「条件が変わった」に入る',
    stale,
  );
  // 日の画面で作り直す（案を消して自動で作る）と、×の組にも担当が入る
  const other2 = await ctx.newPage();
  await other2.goto(`${BASE}#/data`);
  await other2.locator('h1').first().waitFor({ timeout: 30000 });
  await other2.evaluate(
    ({ k, d }) => {
      const data = JSON.parse(localStorage.getItem(k));
      delete data.aiPlans[d];
      localStorage.setItem(k, JSON.stringify(data));
    },
    { k: STORAGE_KEY, d: second },
  );
  await other2.close();
  await open(page, `/plan?date=${second}`, '.date-switch select');
  await page.waitForFunction(
    ({ k, d }) => !!JSON.parse(localStorage.getItem(k) ?? '{}').aiPlans?.[d],
    { k: STORAGE_KEY, d: second },
    { timeout: 60000 },
  );
  const after = await assignedOf(pair.vid);
  check(typeof after === 'string' && after !== 'none', '相性を切ると、全員と×の訪問にも担当が入る', after);
  const run = await page.evaluate(
    ({ k, d }) => {
      const data = JSON.parse(localStorage.getItem(k));
      const plan = data.aiPlans[d];
      return (data.aiRuns[d] ?? []).find((r) => r.id === plan.runId)?.calcFeatures ?? null;
    },
    { k: STORAGE_KEY, d: second },
  );
  check(same(run, { compat: false }), '作った記録に計算に効く入り切り（calcFeatures）', run);
  await applyTemplate(page, dlg, 'all');
}

const steps = sharedPage({
  open: async () => {
    const s = await openPage();
    // 確認は独自のダイアログで受ける（ネイティブのダイアログが出たら失敗。PRD D146）
    const dlg = await answerConfirms(s.page);
    await s.page.goto(`${BASE}#/home`);
    return { ...s, dlg };
  },
  call: (fn, s) => fn(s.page, s.dlg, s.ctx),
  steps: [
    ['all-on', allOn],
    ['switches', switches],
    ['templates', templates],
    ['mobile', mobile],
    ['path-variants', pathVariants],
    ['dead-ends', deadEnds],
    ['inside-entries', insideEntries],
    ['turn-off-compat', turnOffCompat],
    ['keep-data', keepData],
  ],
  after: ({ dlg }) => check(dlg.native.length === 0, 'ブラウザのダイアログを出さない', dlg.native),
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
