// 〈スタッフ〉・〈利用者さん〉の画面の閲覧の欄（PRD D127〜D131。ADR-0023）を本物のブラウザで確かめる：
// 一覧・`?id=`・相性の吹き出しのリンクで閲覧の欄が開き入力欄が無い（中身・地図・節の見出しは h3）／「編集する」で編集の欄（主ボタンにしない）／
// 保存・取り消しで閲覧に戻りフォーカスは「編集する」／変更があるまま取り消す・×・Esc・別の人の `?id=` で確認が出て、断れば編集が続く／
// 変更が無い・同じ人の `?id=`・特性を未確認に戻しただけ・担当できる人を限るを入れて外しただけなら確認しない／変更があるときだけ beforeunload／
// 「追加」はすぐ編集の欄／「まとめて地図に置く」の「編集」は編集の欄／定期パターン・休みは閲覧では読むだけ（これからの休みと終わった休みの件数）／
// 最終勤務日の振り直しの欄は今どおり。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-view.cjs
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
const OUT_DIR = process.env.OUT_DIR || path.join(os.tmpdir(), 'e2e-view');
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
fs.mkdirSync(OUT_DIR, { recursive: true });

let fails = 0;
function check(ok, name, info = '') {
  if (!ok) fails++;
  console.log(
    `${ok ? 'OK  ' : 'NG  '} ${name}${info === '' ? '' : `  ${typeof info === 'string' ? info : JSON.stringify(info)}`}`,
  );
}
const urlOf = (page) => decodeURIComponent(page.url());
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), STORAGE_KEY);
const panel = (page) => page.locator('.drawer');
const view = (page) => page.getByTestId('person-view');
/** 欄の中の入力欄の数 */
const inputs = (page) => panel(page).locator('input, select, textarea').count();
const settle = (page, ms = 250) => page.waitForTimeout(ms);

/** 確認（独自の確認ダイアログ。PRD D146）の受け方を決め、出た文（見出しと本文）を記録する */
const dialogs = (page) => answerConfirms(page);

async function open(page, hash, ready) {
  await page.goto(`${BASE}#${hash}`);
  await page.reload();
  await page.locator(ready).first().waitFor({ timeout: 30000 });
  await settle(page, 400);
}

/** 閲覧の欄が開いていて、入力欄が無く、「編集する」が主ボタンでない */
async function isView(page, where, words = []) {
  await view(page).waitFor({ timeout: 5000 });
  const n = await inputs(page);
  const edit = panel(page).getByTestId('view-edit');
  const cls = (await edit.getAttribute('class')) ?? '';
  const text = (await view(page).textContent()) ?? '';
  check(n === 0, `${where}：閲覧の欄に入力欄が無い`, n);
  check((await edit.count()) === 1 && !cls.includes('btn-primary'), `${where}：右上に「編集する」（主ボタンでない）`);
  check(
    words.every((w) => text.includes(w)),
    `${where}：閲覧の中身`,
    words.filter((w) => !text.includes(w)),
  );
  check((await panel(page).locator('.btn-primary').count()) === 0, `${where}：閲覧の欄に主ボタンが無い`);
}

async function clients(page, dlg) {
  await open(page, '/clients', '[data-testid="client-row"]');
  // 一覧の行の「開く」で閲覧
  await page.getByRole('button', { name: '図書館 ふみを開く' }).click();
  await isView(page, '〈利用者さん〉・一覧', [
    '段階',
    '住所',
    '地図の位置',
    '特性',
    '必要条件',
    '希望',
    '担当できる人',
    'いつもの担当',
    '訪問先の決まりごと',
    '定期パターン',
    '休み',
    '紹介元',
    '—',
  ]);
  check(
    (await view(page).locator('.leaflet-container').count()) === 1,
    '〈利用者さん〉：位置があれば地図の小さな表示（読むだけ）',
  );
  // 定期パターン・休みは読むだけ（足す・直す・消すのボタンを出さない）
  check(
    (await panel(page).getByTestId('patterns-section').count()) === 0 &&
      (await panel(page)
        .getByRole('button', { name: /パターンを追加|パターンを直す|パターンを消す|休みを入れる/ })
        .count()) === 0,
    '〈利用者さん〉：閲覧では定期パターン・休みを書き換えるボタンが無い',
  );
  check(
    (await page.getByTestId('view-patterns').locator('li').count()) > 0,
    '〈利用者さん〉：定期パターンを読むだけで並べる',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'client-view.png') });

  // 「編集する」で編集の欄（最初の入力欄へフォーカス）
  await page.getByTestId('view-edit').click();
  await settle(page);
  check((await inputs(page)) > 5 && (await view(page).count()) === 0, '〈利用者さん〉：「編集する」で編集の欄になる');
  check(
    await page.evaluate(() => document.activeElement?.tagName === 'INPUT'),
    '〈利用者さん〉：編集の欄にしたら入力欄へフォーカス',
  );
  check(
    (await panel(page).getByTestId('patterns-section').count()) === 1,
    '〈利用者さん〉：編集では定期パターンの節を出す',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'client-edit.png') });

  // 変更なしの取り消し：確認なしで閲覧に戻る
  dlg.messages.length = 0;
  await page.getByTestId('edit-cancel').click();
  await settle(page);
  check(
    dlg.messages.length === 0 && (await view(page).count()) === 1,
    '〈利用者さん〉：変更なしの取り消しは確認なしで閲覧に戻る',
  );

  // 変更ありの取り消し：確認が出る。断れば編集のまま、受ければ捨てて閲覧に戻る
  await page.getByTestId('view-edit').click();
  const memo = panel(page).locator('label', { hasText: 'メモ' }).first().locator('input');
  await memo.fill('閲覧の確認のメモ');
  dlg.answer = false;
  await page.getByTestId('edit-cancel').click();
  await settle(page);
  check(
    dlg.messages.length === 1 &&
      /閲覧に戻りますか/.test(dlg.messages[0]) &&
      (await memo.inputValue()) === '閲覧の確認のメモ',
    '〈利用者さん〉：変更ありの取り消しは確認が出て、断れば編集のまま',
    dlg.messages,
  );
  dlg.answer = true;
  await page.getByTestId('edit-cancel').click();
  await settle(page);
  const c1a = (await stored(page)).clients.find((c) => c.id === 'c1');
  check(
    (await view(page).count()) === 1 && c1a.note !== '閲覧の確認のメモ',
    '〈利用者さん〉：受ければ変更を捨てて閲覧に戻る',
  );

  // 保存で閲覧に戻り、閲覧に保存した中身が出る
  await page.getByTestId('view-edit').click();
  await panel(page).locator('label', { hasText: 'メモ' }).first().locator('input').fill('保存した閲覧のメモ');
  dlg.messages.length = 0;
  await page.getByRole('button', { name: '保存' }).click();
  await settle(page, 600);
  const c1b = (await stored(page)).clients.find((c) => c.id === 'c1');
  check(
    (await view(page).count()) === 1 &&
      (await view(page).textContent()).includes('保存した閲覧のメモ') &&
      c1b.note === '保存した閲覧のメモ' &&
      dlg.messages.length === 0,
    '〈利用者さん〉：保存すると閲覧に戻り、保存した中身が出る',
  );

  // 変更ありで閉じる（Esc・×）：確認が出る
  await page.getByTestId('view-edit').click();
  await panel(page).locator('label', { hasText: 'メモ' }).first().locator('input').fill('閉じる前のメモ');
  dlg.answer = false;
  dlg.messages.length = 0;
  await page.keyboard.press('Escape');
  await settle(page);
  check(
    dlg.messages.length === 1 && /欄を閉じますか/.test(dlg.messages[0]) && (await panel(page).count()) === 1,
    '〈利用者さん〉：変更ありで Esc を押すと確認が出て、断れば欄が残る',
  );
  dlg.answer = true;
  await panel(page).getByRole('button', { name: '閉じる' }).click();
  await settle(page);
  check((await panel(page).count()) === 0, '〈利用者さん〉：× で確認を受けると欄を閉じる');

  // ?id= で閲覧（URL から id を消す）
  await page.goto(`${BASE}#/clients?id=c2`);
  await settle(page, 500);
  await isView(page, '〈利用者さん〉・?id=');
  check(!urlOf(page).includes('id='), '〈利用者さん〉：?id= で開いたら URL から id を消す');
  check(
    (await panel(page).locator('h2').first().textContent()).includes('動物公園 やぎお'),
    '〈利用者さん〉：?id= の人の閲覧の欄',
  );

  // 編集中に変更があるまま別の人を ?id= で開く：確認が出る（受ければその人の閲覧）
  await page.getByTestId('view-edit').click();
  await panel(page).locator('label', { hasText: 'メモ' }).first().locator('input').fill('別の人を開く前');
  dlg.messages.length = 0;
  dlg.answer = false;
  await page.evaluate(() => {
    location.hash = '#/clients?id=c1';
  });
  await settle(page, 500);
  check(
    dlg.messages.length === 1 && /図書館 ふみを開きますか/.test(dlg.messages[0]) && (await view(page).count()) === 0,
    '〈利用者さん〉：変更があるまま別の人を開くと確認が出て、断れば編集のまま',
    dlg.messages,
  );
  dlg.answer = true;
  await page.evaluate(() => {
    location.hash = '#/clients?id=c1';
  });
  await settle(page, 500);
  check(
    (await view(page).count()) === 1 && (await panel(page).locator('h2').first().textContent()).includes('図書館 ふみ'),
    '〈利用者さん〉：受ければ別の人の閲覧の欄になる',
  );
  await panel(page).getByRole('button', { name: '閉じる' }).click();

  // 「追加」はすぐ編集の欄。何も入れずに取り消すと確認なしで閉じる
  await page.getByRole('button', { name: /を追加$/ }).click();
  await settle(page);
  check(
    (await view(page).count()) === 0 &&
      (await inputs(page)) > 5 &&
      (await panel(page).locator('h2').first().textContent()).includes('を追加'),
    '〈利用者さん〉：「追加」はすぐ編集の欄で開く',
  );
  dlg.messages.length = 0;
  await page.getByTestId('edit-cancel').click();
  await settle(page);
  check(
    (await panel(page).count()) === 0 && dlg.messages.length === 0,
    '〈利用者さん〉：何も入れない追加の取り消しは確認なしで閉じる',
  );
  // 名前を入れて保存すると、その人の閲覧の欄
  await page.getByRole('button', { name: /を追加$/ }).click();
  await panel(page).locator('label', { hasText: '表示名' }).locator('input').fill('閲覧 たしかめ');
  await page.getByRole('button', { name: '保存' }).click();
  await settle(page);
  check(
    (await view(page).count()) === 1 &&
      (await panel(page).locator('h2').first().textContent()).includes('閲覧 たしかめ'),
    '〈利用者さん〉：追加して保存すると、その人の閲覧の欄になる',
  );
}

async function staff(page, dlg) {
  await open(page, '/staff', '.people-table tbody tr');
  await page.getByRole('button', { name: '市役所 まち子を開く' }).click();
  await isView(page, '〈スタッフ〉・一覧', [
    '特性',
    '稼働時間',
    '自宅',
    '最終勤務日',
    'メールアドレス',
    '移動手段',
    '相性',
  ]);
  await page.screenshot({ path: path.join(OUT_DIR, 'staff-view.png') });
  await page.getByTestId('view-edit').click();
  await settle(page);
  check((await inputs(page)) > 5 && (await view(page).count()) === 0, '〈スタッフ〉：「編集する」で編集の欄になる');
  // 変更なしの取り消し
  dlg.messages.length = 0;
  await page.getByTestId('edit-cancel').click();
  await settle(page);
  check(
    dlg.messages.length === 0 && (await view(page).count()) === 1,
    '〈スタッフ〉：変更なしの取り消しは確認なしで閲覧に戻る',
  );
  // 変更ありの取り消し
  await page.getByTestId('view-edit').click();
  await page.getByTestId('staff-email').fill('view-check@example.com');
  dlg.answer = false;
  await page.getByTestId('edit-cancel').click();
  await settle(page);
  check(
    dlg.messages.length === 1 && /閲覧に戻りますか/.test(dlg.messages[0]),
    '〈スタッフ〉：変更ありの取り消しは確認が出る',
  );
  dlg.answer = true;
  // 保存で閲覧に戻る
  await page.getByRole('button', { name: '保存' }).click();
  await settle(page, 600);
  const s1 = (await stored(page)).staff.find((s) => s.id === 's1');
  check(
    (await view(page).count()) === 1 &&
      (await view(page).textContent()).includes('view-check@example.com') &&
      s1.email === 'view-check@example.com',
    '〈スタッフ〉：保存すると閲覧に戻り、保存した中身が出る',
  );
  await panel(page).getByRole('button', { name: '閉じる' }).click();
  // ?id=
  await page.goto(`${BASE}#/staff?id=s2`);
  await settle(page, 500);
  await isView(page, '〈スタッフ〉・?id=');
  check(!urlOf(page).includes('id='), '〈スタッフ〉：?id= で開いたら URL から id を消す');
  await panel(page).getByRole('button', { name: '閉じる' }).click();
  // 追加
  await page.getByRole('button', { name: /を追加$/ }).click();
  await settle(page);
  check(
    (await view(page).count()) === 0 && (await panel(page).locator('h2').first().textContent()).includes('を追加'),
    '〈スタッフ〉：「追加」はすぐ編集の欄で開く',
  );
  await page.getByTestId('edit-cancel').click();
  // 最終勤務日を入れて保存すると、今までどおり担当の振り直しの欄（閲覧に戻らない）
  await page.getByRole('button', { name: '市役所 まち子を開く' }).click();
  await page.getByTestId('view-edit').click();
  const d = new Date(NOW.getTime() + JST + 7 * 86400000).toISOString().slice(0, 10);
  await page.getByTestId('staff-lastday-input').fill(d);
  await page.getByRole('button', { name: '保存' }).click();
  await settle(page, 500);
  const head = (await panel(page).locator('h2').first().textContent()) ?? '';
  check(
    (await view(page).count()) === 0 && /振り直し/.test(head),
    '〈スタッフ〉：最終勤務日を入れて保存すると、今までどおり担当の振り直しの欄が開く',
    head,
  );
}

/** 相性の画面の吹き出しのリンクで閲覧の欄 */
async function links(page) {
  await open(page, '/compat', '[data-testid="compat-head-btn"]');
  await page.getByTestId('compat-head-btn').first().click();
  await page.getByTestId('compat-pop-link').click();
  await settle(page, 500);
  await isView(page, '相性の吹き出しのリンク（〈スタッフ〉）');
  await open(page, '/compat', '[data-testid="compat-client-btn"]');
  await page.getByTestId('compat-client-btn').first().click();
  await page.getByTestId('compat-pop-link').click();
  await settle(page, 500);
  await isView(page, '相性の吹き出しのリンク（〈利用者さん〉）');
}

/** 編集の欄のメモの入力（〈利用者さん〉） */
const memoInput = (page) => panel(page).locator('label', { hasText: 'メモ' }).first().locator('input');
const headText = async (page) => (await panel(page).locator('h2').first().textContent()) ?? '';
const goHash = (page, hash) =>
  page.evaluate((h) => {
    location.hash = h;
  }, hash);

/** 〈利用者さん〉：同じ人の ?id= で編集が続く・特性を戻す／担当を限るを入れて外すだけなら確認なし・保存後のフォーカス・節の見出し */
async function clientsMore(page, dlg) {
  await open(page, '/clients', '[data-testid="client-row"]');
  await page.getByRole('button', { name: '図書館 ふみを開く' }).click();
  await view(page).waitFor();
  check(
    (await panel(page).locator('.section-title h3').count()) > 3 &&
      (await panel(page).locator('.section-title h2').count()) === 0,
    '〈利用者さん〉：閲覧の欄の節の見出しは h3',
  );
  await page.getByTestId('view-edit').click();
  check(
    (await panel(page).locator('.section-title h3').count()) > 3 &&
      (await panel(page).locator('.section-title h2').count()) === 0,
    '〈利用者さん〉：編集の欄の節の見出しも h3（定期パターン・休みの節を含む）',
  );
  // 同じ人の ?id=：確認なしで編集が続く
  await memoInput(page).fill('同じ人の id');
  dlg.messages.length = 0;
  await goHash(page, '#/clients?id=c1');
  await settle(page, 500);
  check(
    dlg.messages.length === 0 &&
      (await view(page).count()) === 0 &&
      (await memoInput(page).inputValue()) === '同じ人の id',
    '〈利用者さん〉：編集中に同じ人の ?id= が来ても、確認なしで編集が続く',
  );
  check(!urlOf(page).includes('id='), '〈利用者さん〉：そのときも URL から id を消す');
  // 変更があるときの再読込の確認（beforeunload）
  const blocked = await page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  check(blocked, '〈利用者さん〉：変更があるとき、再読込・タブを閉じる前に確認する（beforeunload）');
  dlg.answer = true;
  await page.getByTestId('edit-cancel').click();
  await settle(page);
  const free = await page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  check(!free, '〈利用者さん〉：変更が無ければ beforeunload で止めない');
  check(
    await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'view-edit'),
    '〈利用者さん〉：取り消して閲覧に戻ると、フォーカスは「編集する」',
  );
  // 「担当できる人を限る」を入れてすぐ外すだけなら変更なし
  await page.getByTestId('view-edit').click();
  const lim = panel(page).getByLabel('担当できる人を限る');
  await lim.check();
  await lim.uncheck();
  dlg.messages.length = 0;
  await page.getByTestId('edit-cancel').click();
  await settle(page);
  check(
    dlg.messages.length === 0 && (await view(page).count()) === 1,
    '〈利用者さん〉：担当できる人を限るを入れてすぐ外しただけなら、確認なしで閲覧に戻る',
    dlg.messages,
  );
  // 保存したらフォーカスは「編集する」
  await page.getByTestId('view-edit').click();
  await memoInput(page).fill('保存のフォーカス');
  await page.getByRole('button', { name: '保存' }).click();
  await settle(page, 600);
  check(
    (await view(page).count()) === 1 &&
      (await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'view-edit')),
    '〈利用者さん〉：保存して閲覧に戻ると、フォーカスは「編集する」',
  );
  await panel(page).getByRole('button', { name: '閉じる' }).click();
  // 追加で特性を選んでから未確認に戻すだけなら変更なし
  await page.getByRole('button', { name: /を追加$/ }).click();
  const seg = panel(page).locator('fieldset.segmented').first();
  await seg.getByRole('button', { name: 'あり' }).click();
  await seg.getByRole('button', { name: '未確認' }).click();
  dlg.messages.length = 0;
  await page.getByTestId('edit-cancel').click();
  await settle(page);
  check(
    dlg.messages.length === 0 && (await panel(page).count()) === 0,
    '〈利用者さん〉：特性を選んでから未確認に戻しただけなら、確認なしで取り消せる',
    dlg.messages,
  );
}

/** 閲覧の休みの一覧と終わった休みの件数・「まとめて地図に置く」の「編集」は編集の欄 */
async function seeded(page) {
  await open(page, '/clients', '[data-testid="client-row"]');
  const today = new Date(NOW.getTime() + JST).toISOString().slice(0, 10);
  const shift = (n) => new Date(NOW.getTime() + JST + n * 86400000).toISOString().slice(0, 10);
  const leaves = [
    { id: 'lv-past', clientId: 'c1', from: shift(-20), to: shift(-15), note: '終わった入院' },
    { id: 'lv-now', clientId: 'c1', from: shift(-1), to: today, note: '' },
    { id: 'lv-next', clientId: 'c1', from: shift(10), to: shift(12), note: 'ショートステイ' },
  ];
  // c1 に休みを入れ、c2 の位置と住所を消してから開き直す
  await page.evaluate(
    ([k, ls]) => {
      const d = JSON.parse(localStorage.getItem(k));
      d.clientLeaves = [...d.clientLeaves.filter((l) => l.clientId !== 'c1'), ...ls];
      d.clients = d.clients.map((c) =>
        c.id === 'c2' ? { ...c, place: { address: '', lat: null, lng: null, postalCode: '' } } : c,
      );
      localStorage.setItem(k, JSON.stringify(d));
    },
    [STORAGE_KEY, leaves],
  );
  await page.reload();

  await page.locator('[data-testid="client-row"]').first().waitFor();
  await settle(page, 400);
  await page.getByRole('button', { name: '図書館 ふみを開く' }).click();
  await view(page).waitFor();
  const items = await page.getByTestId('view-leaves').locator('li').allTextContents();
  const text = await view(page).textContent();
  check(
    items.length === 2 &&
      items[0].includes('理由なし') &&
      items[1].includes('ショートステイ') &&
      !text.includes('終わった入院') &&
      text.includes('終わった休み 1件'),
    '〈利用者さん〉：閲覧の休みはこれからの休み（今日を含む・開始日の順）と、終わった休みの件数',
    items,
  );
  await panel(page).getByRole('button', { name: '閉じる' }).click();
  // 位置も住所も無い人の「編集」（まとめて地図に置く）は、閲覧を挟まず編集の欄
  await page
    .getByTestId('place-all-skipped')
    .getByRole('button', { name: /動物公園 やぎお/ })
    .click();
  await settle(page);
  check(
    (await view(page).count()) === 0 &&
      (await inputs(page)) > 5 &&
      (await headText(page)).includes('を編集：動物公園 やぎお'),
    '〈利用者さん〉：「まとめて地図に置く」の「編集」は編集の欄で開く',
  );
  await page.getByTestId('edit-cancel').click();
  await settle(page);
  check((await view(page).count()) === 1, '〈利用者さん〉：そこから取り消すと、その人の閲覧の欄');
  check((await view(page).textContent()).includes('住所なし'), '〈利用者さん〉：住所が無ければ地区は「住所なし」');
}

/** 〈スタッフ〉：変更があるときの ×・Esc・?id=（別の人・同じ人）、取り消しを断ると編集が続く */
async function staffMore(page, dlg) {
  await open(page, '/staff', '.people-table tbody tr');
  await page.getByRole('button', { name: '市役所 まち子を開く' }).click();
  await page.getByTestId('view-edit').click();
  const email = page.getByTestId('staff-email');
  await email.fill('more@example.com');
  // 取り消しを断ると編集が続く
  dlg.answer = false;
  dlg.messages.length = 0;
  await page.getByTestId('edit-cancel').click();
  await settle(page);
  check(
    dlg.messages.length === 1 && (await email.inputValue()) === 'more@example.com' && (await view(page).count()) === 0,
    '〈スタッフ〉：変更ありの取り消しを断ると、編集が続く',
  );
  // ×
  dlg.messages.length = 0;
  await panel(page).getByRole('button', { name: '閉じる' }).click();
  await settle(page);
  check(
    dlg.messages.length === 1 &&
      /欄を閉じますか/.test(dlg.messages[0]) &&
      (await email.inputValue()) === 'more@example.com',
    '〈スタッフ〉：変更ありで × を押すと確認が出て、断れば編集が続く',
    dlg.messages,
  );
  // Esc
  dlg.messages.length = 0;
  await page.keyboard.press('Escape');
  await settle(page);
  check(
    dlg.messages.length === 1 && /欄を閉じますか/.test(dlg.messages[0]) && (await panel(page).count()) === 1,
    '〈スタッフ〉：変更ありで Esc を押すと確認が出て、断れば欄が残る',
  );
  // 同じ人の ?id=：確認なしで編集が続く
  dlg.messages.length = 0;
  await goHash(page, '#/staff?id=s1');
  await settle(page, 500);
  check(
    dlg.messages.length === 0 && (await email.inputValue()) === 'more@example.com',
    '〈スタッフ〉：編集中に同じ人の ?id= が来ても、確認なしで編集が続く',
  );
  // 別の人の ?id=：確認が出る。断れば編集のまま、受ければその人の閲覧
  const s2 = (await stored(page)).staff.find((s) => s.id === 's2');
  await goHash(page, '#/staff?id=s2');
  await settle(page, 500);
  check(
    dlg.messages.length === 1 &&
      dlg.messages[0].includes(`${s2.name}を開きますか`) &&
      (await email.inputValue()) === 'more@example.com',
    '〈スタッフ〉：変更があるまま別の人を ?id= で開くと確認が出て、断れば編集のまま',
    dlg.messages,
  );
  dlg.answer = true;
  await goHash(page, '#/staff?id=s2');
  await settle(page, 500);
  const head = await headText(page);
  check(
    (await view(page).count()) === 1 &&
      head.slice(head.indexOf('：') + 1) === s2.name &&
      (await view(page).getAttribute('data-id')) === 's2',
    '〈スタッフ〉：受ければ別の人の閲覧の欄になる',
    head,
  );
  const s1 = (await stored(page)).staff.find((s) => s.id === 's1');
  check(s1.email !== 'more@example.com', '〈スタッフ〉：捨てた変更は保存しない');
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const errors = [];
  for (const step of [clients, clientsMore, seeded, staff, staffMore, links]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // 初回の案内ツアーを見た扱いにする（PRD D193）
    await skipTour(ctx);
    // 地図のタイルは外へ取りに行かない
    await ctx.route(/cyberjapandata\.gsi\.go\.jp/, (r) => r.fulfill({ status: 204, body: '' }));
    const page = await ctx.newPage();
    // ページの時計を止める（e2e-details と同じ）
    await page.clock.setFixedTime(NOW);
    page.on('pageerror', (e) => errors.push(String(e)));
    const dlg = await dialogs(page);
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
