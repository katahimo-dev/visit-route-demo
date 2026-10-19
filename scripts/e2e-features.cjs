// 機能の入り切り その1（PRD D210〜D213・D216。ADR-0028）を本物のブラウザで確かめる：
// すべて入（初期データ）でメニューの最後に「管理者」（管理者設定・データ）、管理者設定の画面（見出し・説明・ひな形の4つ・
// 「いまの設定」とカスタムの印・20のスイッチの role=switch・aria-checked・名前・説明）。
// ひな形の4通り（基本・月次予定・現場共有・すべては管理者設定で当てる（独自の確認ダイアログに入る機能・切れる機能、取り消すと変わらない）、
// 労務・契約管理は別のタブで localStorage を書き換えて作る）ごとに、メニューの項目・下のタブ・パレットの画面と操作・ホームのいつでもの入口・
// 切った機能の URL（`?do=` も）を開くとホームへ移り（replace）、ホームの上に閉じられる知らせと管理者設定へのリンク、
// スイッチ（押すとすぐ保存・トースト・依存先が切なら押せず理由）、390px で横にはみ出さない、印刷で知らせ・メニューを出さない。
// 末尾の /・大文字の URL（#/vacancy/・#/Vacancy・#/month/print/）もホームへ移す、390px で空き状況を切ると下のタブ4つが全幅を等分、
// 稼働の見込み・欠勤・キャンセル・月の印刷・案を比べるを切ると、月の要対応の行・月のボタン・日の画面の拘束の帯と「案を変える ▾」・
// 稼働時間の右の欄にそこへ移るリンク・ボタンが無い。
// その2（PRD D211・D213〜D215）：ひな形の4通りごとに画面の中の入口（日の画面の欠勤・キャンセル・メール・条件を調整する・
// プリセットの数・点数の理由、〈利用者さん〉の欄の段階の選択・紹介元・担当できる人・休み・決まりごと・住所の検索・絞り込みのチップ、
// 閲覧の欄の紹介元・決まりごと、〈スタッフ〉の欄のメールアドレス・最終勤務日、月の「休みを入れる」・印刷、空き状況の案内文、
// データの Excel、稼働の見込みの交通費の単価）。相性を切るときの独自の確認（件数と効き方。取り消すと変わらない）と、
// 切ったあとの月の要対応の「条件が変わった」、相性×の組が切ると担当に入ること（別のタブで×を書き、日の画面で作り直す）。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-features.cjs
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
const OUT_DIR = process.env.OUT_DIR || path.join(os.tmpdir(), 'e2e-features');
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
const hashOf = (page) => decodeURIComponent(new URL(page.url()).hash);
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

/** すべて入のメニュー（今の16＋管理者設定） */
const ALL_LABELS = [
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
/** ひな形ごとの、メニューに出ない項目 */
const HIDDEN = {
  basic: ['案を比べる', '稼働の見込み', '条件の重み', '特性の項目'],
  laborContract: ['案を比べる', '条件の重み', '特性の項目'],
  monthlyField: ['案を比べる', '稼働の見込み', '条件の重み', '特性の項目'],
  all: [],
};
const menuFor = (t) => ALL_LABELS.filter((l) => !HIDDEN[t].includes(l));

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
  await page.waitForTimeout(150);
  const labels = await page.locator('[data-testid="cmdk-option"] .cmdk-option-label').allInnerTexts();
  await page.keyboard.press('Escape');
  await page.getByTestId('cmdk').waitFor({ state: 'detached' });
  return labels;
}
/** 管理者設定でひな形を当てる（確認に答える） */
async function applyTemplate(page, dlg, id, answer = true) {
  await open(page, '/settings', '[data-testid="feature-templates"]');
  dlg.messages.length = 0;
  dlg.answer = answer;
  await page.locator(`[data-template="${id}"] [data-testid="feature-template-apply"]`).click();
  await page.waitForTimeout(400);
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
  check(m.titles.at(-1) === '管理者', 'すべて入：メニューの最後のグループは「管理者」', m.titles);
  check(same(m.labels, ALL_LABELS), 'すべて入：今の16に管理者設定が足されるだけ', m.labels);
  check(same(await storedFeatures(page), {}), '初期データの入り切りは {}', await storedFeatures(page));

  await page.locator('.side-nav').getByRole('link', { name: '管理者設定' }).click();
  await page.waitForURL(/#\/settings/);
  await page.getByTestId('feature-templates').waitFor();
  check((await page.locator('h1').innerText()) === '管理者設定', '管理者設定：見出し');
  check(
    (await page.locator('.page-lead').innerText()).includes('切った機能のデータは消えません'),
    '管理者設定：説明の文',
  );
  check(
    (await page.locator('.side-nav [aria-current="page"]').innerText()) === '管理者設定',
    '管理者設定：メニューの今の画面の印',
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
  await page.waitForTimeout(500);
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
  await page.waitForTimeout(300);
  check((await storedFeatures(page)).vacancyNotice === undefined, '押せないスイッチを押しても書かない');
  check((await page.getByTestId('feature-custom').count()) === 1, 'どのひな形とも違えば「カスタム」');
  check((await page.getByTestId('feature-template-now').count()) === 0, 'カスタムでは「いまの設定」を出さない');
  const tabs = await page.getByTestId('bottom-tab').allInnerTexts();
  check(!tabs.includes('空き状況'), '下のタブから空き状況が消える（DOM）', tabs);
  const m = await menu(page);
  check(
    !m.titles.includes('問い合わせ') && !m.labels.includes('空き状況'),
    '項目の無いグループは見出しごと出さない',
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
  await page.waitForTimeout(400);
  check(hashOf(page) === '#/staff', '移すのは replace（戻るで切った URL に戻らない）', hashOf(page));
  await page.goto(`${BASE}#/vacancy`);
  await page.getByTestId('feature-off-notice').waitFor({ timeout: 10000 });
  await page.getByTestId('feature-off-settings').click();
  await page.waitForURL(/#\/settings/);
  check(true, '知らせのリンクで管理者設定へ');
  await page.goto(`${BASE}#/vacancy`);
  await page.getByTestId('feature-off-notice').waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: '知らせを閉じる' }).click();
  await page.waitForTimeout(300);
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
  check(same(m.labels, menuFor(t)), `${label}：メニューの項目`, m.labels);
  const tabs = await page.getByTestId('bottom-tab').allInnerTexts();
  check(
    same(tabs, on.includes('vacancy') ? ['ホーム', '月', '週', '日', '空き状況'] : ['ホーム', '月', '週', '日']),
    `${label}：下のタブ`,
    tabs,
  );
  const pal = await paletteItems(page);
  check(
    same(
      pal.screens,
      menuFor(t).filter((l) => l !== '欠勤・キャンセル'),
    ),
    `${label}：パレットの画面`,
    pal.screens,
  );
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
    await page.waitForTimeout(200);
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
  const checked = await page.getByRole('switch').evaluateAll((els) => els.map((el) => el.getAttribute('aria-checked')));
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
  check(msg0.length === 1 && msg0[0].includes('ひな形「基本」を当てますか？'), '当てる前に独自の確認（見出し）', msg0);
  check(
    msg0[0]?.includes('入る機能：なし') && msg0[0]?.includes('切れる機能：') && msg0[0]?.includes('案を比べる'),
    '確認の本文に入る機能・切れる機能の名前',
    msg0,
  );
  check(same(await storedFeatures(page), before), '取り消すと入り切りは変わらない', await storedFeatures(page));

  // 基本（管理者設定で当てる）
  await applyTemplate(page, dlg, 'basic');
  await page.locator('.toast').filter({ hasText: 'ひな形「基本」を当てました' }).waitFor({ timeout: 5000 });
  check(same(await storedFeatures(page), asFeatures(TEMPLATE_ON.basic)), '基本：全20の ID を明示して書く');
  await checkTemplate(page, 'basic');
  await page.screenshot({ path: path.join(OUT_DIR, 'settings-basic.png'), fullPage: true });

  // 労務・契約管理（別のタブで localStorage を書き換える）
  await writeFeaturesInOtherTab(ctx, asFeatures(TEMPLATE_ON.laborContract));
  await checkTemplate(page, 'laborContract');

  // 月次予定・現場共有（管理者設定で当てる。確認に入る機能・切れる機能）
  const msg = await applyTemplate(page, dlg, 'monthlyField');
  check(
    msg[0]?.includes('入る機能：') &&
      msg[0]?.includes('月の予定の印刷') &&
      msg[0]?.includes('切れる機能：') &&
      msg[0]?.includes('稼働の見込み'),
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
  check(name.replace(/\s/g, '') === '管理者・管理者設定', '390px：上の帯の名前', name);
  await page.screenshot({ path: path.join(OUT_DIR, 'settings-mobile.png'), fullPage: true });
  await page.goto('about:blank');
  await page.goto(`${BASE}#/compare`);
  await page.getByTestId('feature-off-notice').waitFor({ timeout: 10000 });
  const w2 = await page.evaluate(() => document.documentElement.scrollWidth);
  check(w2 <= 390, '390px：ホームの知らせが横にはみ出さない', w2);
  const tabs = await page.getByTestId('bottom-tab').allInnerTexts();
  check(tabs.length === 5, '390px：基本は下のタブ5つ', tabs);
  await page.getByTestId('menu-btn').click();
  const drawer = await page.locator('.nav-drawer .nav-link').allInnerTexts();
  check(same(drawer, menuFor('basic')), '390px：引き出しもメニューと同じ項目', drawer);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(OUT_DIR, 'notice-mobile.png'), fullPage: true });
  await page.emulateMedia({ media: 'print' });
  check(!(await page.getByTestId('feature-off-notice').isVisible()), '印刷：知らせを出さない');
  check(!(await page.getByTestId('bottom-tabs').isVisible()), '印刷：下のタブを出さない');
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 1400, height: 1000 });
  await open(page, '/settings', '[data-testid="feature-templates"]');
  await page.emulateMedia({ media: 'print' });
  check(!(await page.getByTestId('feature-template-apply').first().isVisible()), '印刷：ひな形の「当てる」を出さない');
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
    await page.waitForTimeout(200);
    const hasNotice = (await page.getByTestId('feature-off-notice').count()) === 1;
    check(hashOf(page) === '#/home' && hasNotice, `切った機能の ${h} もホームへ移し知らせる`, hashOf(page));
  }
  // 390px：空き状況を切ると下のタブは4つで、全幅を等分する
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/home', '[data-testid="home-tasks"]');
  const boxes = await page
    .getByTestId('bottom-tab')
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
      data.org.features = { workload: false, sudden: false, monthPrint: false, compare: false };
      localStorage.setItem(k, JSON.stringify(data));
      return absentId;
    },
    { k: STORAGE_KEY, d: second },
  );
  await other.close();
  await page.waitForTimeout(300);

  // 月の要対応：休みの人に訪問・拘束の上限の行は、欠勤・キャンセルの欄・稼働の見込みでなく日の画面へ
  await open(page, `/month?ym=${ym}&do=attention`, '[data-testid="month-attention"]');
  await page.locator('.month-attention-btn').first().waitFor({ timeout: 30000 });
  const rows = await page
    .locator('.month-attention-btn')
    .evaluateAll((els) => els.map((el) => ({ cls: el.className, to: el.dataset.to ?? '', text: el.textContent })));
  check(rows.length > 0, '月の要対応の行がある', rows.length);
  check(
    rows.every((r) => !r.to.includes('/workload') && !r.to.includes('do=absence')),
    '月の要対応：切った機能（稼働の見込み・欠勤・キャンセル）への行き先が無い',
    rows.map((r) => r.to),
  );
  for (const kind of ['absentLeft', 'overSpan']) {
    const r = rows.find((x) => x.cls.includes(`is-${kind}`) && x.text.includes(md(second)));
    check(
      !!r && r.to === '/plan' && r.text.includes('（日の画面で開く）'),
      `月の要対応：${kind} の行は日の画面へ（「（日の画面で開く）」）`,
      r,
    );
  }
  check((await page.getByTestId('month-workload').count()) === 0, '月：稼働の見込みのボタンを出さない');
  check((await page.getByTestId('month-print').count()) === 0, '月：印刷のボタンを出さない');
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
      '拘束の上限の行を押すと日の画面',
      hashOf(page),
    );
  }

  // 日の画面：稼働の見込みを切ると拘束の上限の帯ごと出さない（その2。リンク・ボタンも無い）。「案を変える ▾」に比べるが無い
  await open(page, `/plan?date=${second}`, '.date-switch select');
  await page.getByTestId('plan-menu').waitFor({ timeout: 60000 });
  await page.waitForTimeout(500);
  check(
    (await page.getByTestId('band-over-span').count()) === 0 &&
      (await page.getByTestId('over-span-link').count()) === 0 &&
      (await page.locator('.app-main a[href*="workload"]').count()) === 0,
    '日の画面：稼働の見込みを切ると拘束の上限の帯と稼働の見込みへのリンクを出さない',
  );
  await page.getByTestId('plan-menu').click();
  await page.getByTestId('plan-menu-list').waitFor({ timeout: 5000 });
  check(
    (await page.getByTestId('plan-menu-compare').count()) === 0 &&
      (await page.getByTestId('plan-menu-revert').count()) === 1,
    '日の画面：「案を変える ▾」に比べるを出さない（戻すは残る）',
  );
  await page.keyboard.press('Escape');

  // 稼働時間の右の欄：欠勤・キャンセルの欄へのリンクが無い
  const data = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORAGE_KEY);
  const name = data.staff.find((s) => s.id === absent)?.name ?? '';
  await open(page, '/availability', '.avail-table');
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
  await page.waitForTimeout(200);
  check(
    (await page.getByTestId('availability-absence-link').count()) === 0 &&
      (await page.locator('.drawer a[href*="do=absence"]').count()) === 0,
    '稼働時間の右の欄：欠勤・キャンセルの欄へのリンクを出さない',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'dead-ends-availability.png') });
  await applyTemplate(page, dlg, 'all');
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
    await page.waitForTimeout(500);
    check((await count('sudden-open')) === (on('sudden') ? 1 : 0), `${label}：日の画面の「欠勤・キャンセル」`);
    check((await page.locator('.absence-btn').count()) > 0 === on('sudden'), `${label}：列の見出しの「急な欠勤」`);
    check((await count('day-mail')) === (on('mail') ? 1 : 0), `${label}：日の画面の「メールで送る」`);
    if (!on('rules')) check((await count('plan-reason')) === 0, `${label}：点数の横の理由を出さない`);
    await page.getByTestId('plan-menu').click();
    await page.getByTestId('plan-menu-list').waitFor({ timeout: 5000 });
    check((await count('plan-menu-tune')) === (on('rules') ? 1 : 0), `${label}：「条件を調整する…」`);
    const presets = await count('plan-menu-preset');
    check(presets === (on('rules') ? data.presets.length : 1), `${label}：プリセットの数`, presets);
    check((await count('plan-menu-batch')) === (on('rules') ? 1 : 0), `${label}：まとめて作る`);
    check((await count('plan-menu-compare')) === (on('compare') ? 1 : 0), `${label}：「2つの案を比べる」`);
    await page.keyboard.press('Escape');

    // 〈利用者さん〉：閲覧の欄と編集の欄
    const client = data.clients.find((c) => c.referrer.name) ?? data.clients[0];
    await open(page, `/clients?id=${encodeURIComponent(client.id)}`, '[data-testid="person-view"]');
    const viewText = await page.getByTestId('person-view').innerText();
    check(viewText.includes('紹介元') === on('clientStage'), `${label}：閲覧の欄の紹介元`);
    check(viewText.includes('訪問先の決まりごと') === on('visitNotes'), `${label}：閲覧の欄の決まりごと`);
    check(viewText.includes('担当できる人') === on('allowedStaff'), `${label}：閲覧の欄の担当できる人`);
    check(viewText.includes('休み'), `${label}：閲覧の欄の休み（事実なので残す）`);
    const chips = await page
      .getByTestId('clients-cf-chip')
      .evaluateAll((els) => els.map((el) => el.dataset.chip).filter(Boolean));
    check(chips.includes('leave') === on('clientLeave'), `${label}：絞り込みのチップ「休み」`, chips);
    check(chips.includes('limited') === on('allowedStaff'), `${label}：絞り込みのチップ「担当を限る」`, chips);
    await page.getByTestId('view-edit').click();
    await page.getByTestId('client-stage-select').waitFor({ timeout: 5000 });
    const stages = await page.getByTestId('client-stage-select').locator('option').allInnerTexts();
    check(
      same(stages, on('clientStage') ? ['相談受付', '顔合わせ', '契約', '利用中', '終了'] : ['利用中', '終了']),
      `${label}：段階の選択`,
      stages,
    );
    check((await count('client-referrer-name')) === (on('clientStage') ? 1 : 0), `${label}：紹介元の欄`);
    const panelText = await page.locator('.drawer').innerText();
    check(panelText.includes('担当できる人（社内の決まり）') === on('allowedStaff'), `${label}：担当できる人の欄`);
    check((await count('leaves-section')) === (on('clientLeave') ? 1 : 0), `${label}：休みの欄`);
    check((await count('visit-rules-form')) === (on('visitNotes') ? 1 : 0), `${label}：決まりごとの欄`);
    check((await count('client-postal-search')) === (on('geocode') ? 1 : 0), `${label}：住所を探す`);
    check((await count('client-postal')) === 1, `${label}：郵便番号の欄は残る`);
    await page.keyboard.press('Escape');

    // 〈スタッフ〉：編集の欄
    const staff = data.staff[0];
    await open(page, `/staff?id=${encodeURIComponent(staff.id)}`, '[data-testid="person-view"]');
    const staffView = await page.getByTestId('person-view').innerText();
    check(staffView.includes('メールアドレス') === on('mail'), `${label}：〈スタッフ〉の閲覧の欄のメールアドレス`);
    check(staffView.includes('◎ 選ばれやすい') === on('compat'), `${label}：〈スタッフ〉の閲覧の欄の相性`);
    await page.getByTestId('view-edit').click();
    await page.locator('.drawer input').first().waitFor({ timeout: 5000 });
    check((await count('staff-email')) === (on('mail') ? 1 : 0), `${label}：〈スタッフ〉のメールアドレスの欄`);
    check((await count('staff-lastday-input')) === (on('offboard') ? 1 : 0), `${label}：最終勤務日の欄`);
    await page.keyboard.press('Escape');

    // 月：〈スタッフ〉を選ぶと「休みを入れる」
    await open(
      page,
      `/month?ym=${TODAY.slice(0, 7)}&staff=${encodeURIComponent(staff.id)}`,
      '[data-testid="month-focus"]',
    );
    await page.waitForTimeout(300);
    check((await count('month-off-toggle')) === (on('requestedOff') ? 1 : 0), `${label}：月の「休みを入れる」`);
    check((await count('month-print')) === (on('monthPrint') ? 1 : 0), `${label}：月の印刷のボタン`);

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
      check(w <= 390, '390px・基本：日の画面が横にはみ出さない', w);
      await page.screenshot({ path: path.join(OUT_DIR, 'inside-basic-mobile.png') });
      await page.setViewportSize({ width: 1400, height: 1000 });
    }
  }
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
  await page.waitForTimeout(400);
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
  await page.waitForTimeout(500);
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

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
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
  // 確認は独自のダイアログで受ける（ネイティブのダイアログが出たら失敗。PRD D146）
  const dlg = await answerConfirms(page);
  await page.goto(`${BASE}#/home`);
  for (const [name, fn] of [
    ['all-on', allOn],
    ['switches', switches],
    ['templates', templates],
    ['mobile', mobile],
    ['path-variants', pathVariants],
    ['dead-ends', deadEnds],
    ['inside-entries', insideEntries],
    ['turn-off-compat', turnOffCompat],
  ]) {
    try {
      await fn(page, dlg, ctx);
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
