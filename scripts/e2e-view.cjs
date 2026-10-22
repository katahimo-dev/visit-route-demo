// 〈スタッフ〉・〈利用者さん〉の画面（全画面。PRD D308〜D312。ADR-0052）の節を本物のブラウザで確かめる：
// 一覧の「開く」・`?id=`（その人の画面へ移る）・相性の吹き出しのリンクでその人の画面が開き、節は読むだけ（入力欄・主ボタンが無い。中身・地図・節の見出しは h2）／
// 節の「直す」で入力欄（最初の入力欄へフォーカス・主ボタンは「保存」）、保存・取り消しで読むだけに戻りフォーカスは「直す」／
// 変更があるまま取り消す・Esc・タブを替える・メニューで移る・別の人の URL で確認が出て、断れば編集が続く／
// 変更が無い・特性を未確認に戻しただけ・担当できる人を限るを入れて外しただけなら確認しない／変更があるときだけ beforeunload／
// 「追加」は新しい人の画面（基本の節が開いた形。何も入れずに取り消すと確認なしで一覧へ）／「まとめて地図に置く」の「編集」は住所の節を開く／
// 予定のタブの休みはこれからの休み・休みのタブは終わった休みも／最終勤務日を入れて保存すると担当の振り直しの欄。
// 相性・担当の名前（PRD D198〜D200）：〈スタッフ〉の相性のタブにいつもの担当・相性の記号ごとの〈利用者さん〉の名前（人数・利用中だけ・
// 13人目から「あと N人」）、名前で詳細の吹き出し（Tab は吹き出しの中を進み端で閉じて名前へ・Esc は吹き出しだけ閉じる）、リンクで相手の画面、
// 〈利用者さん〉の担当できる人・いつもの担当も名前から。一覧の行を押すとその人の画面（1280px・390px。文字をドラッグで選んでも移らない）。
// 〈スタッフ〉のアイコン（PRD D299）：「訪」を保存すると一覧・日の予定の印が「訪」、3文字は保存しない、空に戻すと苗字の最初の1文字。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-view.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { skipTour } = require('./lib/tourSeen.cjs');
const { answerConfirms } = require('./lib/confirmDialog.cjs');
const {
  BASE,
  OUT_DIR,
  JST,
  NOW,
  STORAGE_KEY,
  check,
  settle,
  urlOf,
  hashOf,
  stored,
  runSteps,
} = require('./lib/env.cjs');
const { pagePerStep } = require('./lib/steps.cjs');

/** その人の画面（全画面）の外枠 */
const view = (page) => page.getByTestId('person-view');
const sec = (page, name) => page.locator(`[data-testid="person-sec"][data-section="${name}"]`);
/** 節の中の入力欄の数（直していなければ 0） */
const secInputs = (page) => page.locator('[data-testid="person-sec"]').locator('input, select, textarea').count();
const tab = (page, key) => page.getByTestId('person-tabs').locator(`[data-tab="${key}"]`);
const activeTestId = (page) => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
const beforeUnloadBlocked = (page) =>
  page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
const goHash = (page, hash) =>
  page.evaluate((h) => {
    location.hash = h;
  }, hash);

async function open(page, hash, ready) {
  // 同じ文書の中で hash を移してから読み直すと、読み直す前に `?id=` が処理されることがあるので、about:blank を挟んで開く
  await page.goto('about:blank');
  await page.goto(`${BASE}#${hash}`);
  await page.locator(ready).first().waitFor({ timeout: 30000 });
  await settle(page, 400);
}
async function goTab(page, key) {
  await tab(page, key).click();
  await settle(page, 300);
}
async function editSec(page, name) {
  await sec(page, name).getByTestId('sec-edit').click();
  await settle(page);
}

/** 読むだけ：節に入力欄・主ボタンが無い（中身の語も） */
async function isReading(page, where, words = []) {
  await view(page).waitFor({ timeout: 5000 });
  const n = await secInputs(page);
  const text = (await view(page).textContent()) ?? '';
  check(n === 0, `${where}：節に入力欄が無い（読むだけ）`, n);
  check(
    words.every((w) => text.includes(w)),
    `${where}：中身`,
    words.filter((w) => !text.includes(w)),
  );
  check((await page.locator('[data-testid="person-sec"] .btn-primary').count()) === 0, `${where}：節に主ボタンが無い`);
}

async function clients(page, dlg) {
  await open(page, '/clients', '[data-testid="client-row"]');
  await page.getByRole('link', { name: '図書館 ふみを開く' }).click();
  await view(page).waitFor();
  await settle(page, 400);
  check(
    hashOf(page) === '#/clients/c1' && (await view(page).getAttribute('data-id')) === 'c1',
    '〈利用者さん〉：一覧の「開く」でその人の画面（#/clients/c1）',
    hashOf(page),
  );
  check(
    (await page.locator('h1').first().textContent()).includes('図書館 ふみ') &&
      (await tab(page, 'schedule').getAttribute('aria-current')) === 'page',
    '〈利用者さん〉：見出しに名前、タブの先頭の「予定」を開く',
  );
  await goTab(page, 'basic');
  check(urlOf(page).includes('tab=basic'), '〈利用者さん〉：タブは URL の ?tab=', urlOf(page));
  await isReading(page, '〈利用者さん〉・基本情報', [
    '段階',
    '住所',
    '地図の位置',
    '特性',
    '訪問先の決まりごと',
    '紹介元',
    '—',
  ]);
  check(
    (await page.locator('[data-testid="person-sec"] .section-title h2').count()) >= 5,
    '〈利用者さん〉：節の見出しは h2（画面の見出しは h1）',
  );
  await sec(page, 'place')
    .locator('.leaflet-container')
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  check(
    (await sec(page, 'place').locator('.leaflet-container').count()) === 1,
    '〈利用者さん〉：位置があれば住所の節に地図の小さな表示',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'client-basic.png') });
  await goTab(page, 'staffing');
  await isReading(page, '〈利用者さん〉・担当・相性', ['必要条件', '希望', '担当できる人', 'いつもの担当', '相性']);
  await goTab(page, 'leaves');
  check((await page.getByTestId('leaves-section').count()) === 1, '〈利用者さん〉：休みのタブに休みの節');
  await goTab(page, 'basic');

  // 「直す」で入力欄（最初の入力欄へフォーカス・主ボタンは「保存」）
  await editSec(page, 'basic');
  check(
    (await sec(page, 'basic').locator('input').count()) >= 3 &&
      (await sec(page, 'stage').locator('input, select').count()) === 0,
    '〈利用者さん〉：「直す」でその節だけ入力欄になる',
  );
  check(
    await page.evaluate(() => document.activeElement?.tagName === 'INPUT'),
    '〈利用者さん〉：直すと入力欄へフォーカス',
  );
  check(
    ((await sec(page, 'basic').getByTestId('sec-save').getAttribute('class')) ?? '').includes('btn-primary'),
    '〈利用者さん〉：直している節の「保存」が主ボタン',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'client-edit.png') });

  // 変更なしの取り消し：確認なしで読むだけに戻り、フォーカスは「直す」
  dlg.messages.length = 0;
  await sec(page, 'basic').getByTestId('sec-cancel').click();
  await settle(page);
  check(
    dlg.messages.length === 0 && (await secInputs(page)) === 0 && (await activeTestId(page)) === 'sec-edit',
    '〈利用者さん〉：変更なしの取り消しは確認なしで読むだけに戻り、フォーカスは「直す」',
  );

  // 変更ありの取り消し：確認が出る。断れば編集のまま、受ければ捨てる
  await editSec(page, 'basic');
  const memo = sec(page, 'basic').locator('label', { hasText: 'メモ' }).locator('input');
  await memo.fill('節の確認のメモ');
  dlg.answer = false;
  await sec(page, 'basic').getByTestId('sec-cancel').click();
  await settle(page);
  check(
    dlg.messages.length === 1 &&
      /変更を捨てますか/.test(dlg.messages[0]) &&
      (await memo.inputValue()) === '節の確認のメモ',
    '〈利用者さん〉：変更ありの取り消しは確認が出て、断れば編集のまま',
    dlg.messages,
  );
  // Esc も取り消しと同じ（確認）
  dlg.messages.length = 0;
  await memo.press('Escape');
  await settle(page);
  check(
    dlg.messages.length === 1 && (await memo.inputValue()) === '節の確認のメモ',
    '〈利用者さん〉：変更ありで Esc を押すと確認が出て、断れば編集のまま',
    dlg.messages,
  );
  // タブを替える・メニューで移る：確認が出て、断れば留まる
  dlg.messages.length = 0;
  await tab(page, 'schedule').click();
  await settle(page);
  check(
    dlg.messages.length === 1 &&
      /タブを替えますか/.test(dlg.messages[0]) &&
      urlOf(page).includes('tab=basic') &&
      (await memo.inputValue()) === '節の確認のメモ',
    '〈利用者さん〉：変更があるままタブを替えると確認が出て、断れば留まる',
    dlg.messages,
  );
  dlg.messages.length = 0;
  await page
    .locator('.side-nav')
    .getByRole('link', { name: /スタッフ一覧/ })
    .click();
  await settle(page);
  check(
    dlg.messages.length === 1 && /移りますか/.test(dlg.messages[0]) && hashOf(page).startsWith('#/clients/c1'),
    '〈利用者さん〉：変更があるままメニューで移ると確認が出て、断れば留まる',
    dlg.messages,
  );
  check(
    await beforeUnloadBlocked(page),
    '〈利用者さん〉：変更があるとき、再読込・タブを閉じる前に確認する（beforeunload）',
  );
  // 別の人の URL：確認が出て、断れば元の人に戻る・受ければその人
  dlg.messages.length = 0;
  await goHash(page, '#/clients/c2');
  await settle(page, 500);
  check(
    dlg.messages.length === 1 &&
      /動物公園 やぎおを開きますか/.test(dlg.messages[0]) &&
      hashOf(page).startsWith('#/clients/c1') &&
      (await memo.inputValue()) === '節の確認のメモ',
    '〈利用者さん〉：変更があるまま別の人の URL になると確認が出て、断れば元の人の編集のまま',
    { m: dlg.messages, h: hashOf(page) },
  );
  dlg.answer = true;
  dlg.messages.length = 0;
  await goHash(page, '#/clients/c2');
  await settle(page, 500);
  check(
    dlg.messages.length === 1 && (await view(page).getAttribute('data-id')) === 'c2',
    '〈利用者さん〉：受ければ別の人の画面になる',
  );
  check(
    (await stored(page)).clients.find((c) => c.id === 'c1').note !== '節の確認のメモ',
    '〈利用者さん〉：捨てた変更は保存しない',
  );
  check(!(await beforeUnloadBlocked(page)), '〈利用者さん〉：変更が無ければ beforeunload で止めない');

  // 保存で読むだけに戻り、保存した中身が出る（ほかの節の項目は変えない）
  await open(page, '/clients/c1?tab=basic', '[data-testid="person-sec"]');
  await editSec(page, 'basic');
  await sec(page, 'basic').locator('label', { hasText: 'メモ' }).locator('input').fill('保存した節のメモ');
  dlg.messages.length = 0;
  await sec(page, 'basic').getByTestId('sec-save').click();
  await settle(page, 600);
  const c1b = (await stored(page)).clients.find((c) => c.id === 'c1');
  check(
    (await secInputs(page)) === 0 &&
      (await sec(page, 'basic').textContent()).includes('保存した節のメモ') &&
      c1b.note === '保存した節のメモ' &&
      dlg.messages.length === 0 &&
      (await activeTestId(page)) === 'sec-edit',
    '〈利用者さん〉：保存すると読むだけに戻り、保存した中身が出る（フォーカスは「直す」）',
  );

  // ?id=（古いリンク）：その人の画面へ移る
  await open(page, '/clients?id=c2', '[data-testid="person-view"]');
  check(
    hashOf(page) === '#/clients/c2' && (await view(page).getAttribute('data-id')) === 'c2',
    '〈利用者さん〉：?id= はその人の画面（#/clients/c2）へ移る',
    hashOf(page),
  );

  // 「追加」は新しい人の画面（基本の節が開いた形）。何も入れずに取り消すと確認なしで一覧へ
  await open(page, '/clients', '[data-testid="client-row"]');
  await page.getByTestId('client-add').click();
  await settle(page, 400);
  check(
    hashOf(page) === '#/clients/new' &&
      (await sec(page, 'new').locator('input').count()) > 2 &&
      (await page.locator('h1').first().textContent()).includes('を追加'),
    '〈利用者さん〉：「追加」は新しい人の画面で、基本の節が開いている',
  );
  dlg.messages.length = 0;
  await sec(page, 'new').getByTestId('sec-cancel').click();
  await settle(page);
  check(
    hashOf(page) === '#/clients' && dlg.messages.length === 0,
    '〈利用者さん〉：何も入れない追加の取り消しは確認なしで一覧へ',
  );
  await page.getByTestId('client-add').click();
  await sec(page, 'new').locator('label', { hasText: '表示名' }).locator('input').fill('節 たしかめ');
  await sec(page, 'new').getByTestId('sec-save').click();
  await settle(page, 600);
  const made = (await stored(page)).clients.find((c) => c.displayName === '節 たしかめ');
  check(
    !!made &&
      hashOf(page).startsWith(`#/clients/${made.id}`) &&
      (await page.locator('h1').first().textContent()).includes('節 たしかめ'),
    '〈利用者さん〉：追加して保存すると、その人の画面（基本情報）になる',
    hashOf(page),
  );
}

/** 〈利用者さん〉：特性を戻す／担当を限るを入れて外すだけなら確認なし */
async function clientsMore(page, dlg) {
  await open(page, '/clients/c1?tab=basic', '[data-testid="person-sec"]');
  await editSec(page, 'traits');
  // 1つ目の項目（ペットあり：なし）を「あり」にしてから「なし」に戻す
  const seg = sec(page, 'traits').locator('fieldset.segmented').first();
  await seg.getByRole('button', { name: 'あり', exact: true }).click();
  await seg.getByRole('button', { name: 'なし', exact: true }).click();
  dlg.messages.length = 0;
  await sec(page, 'traits').getByTestId('sec-cancel').click();
  await settle(page);
  check(
    dlg.messages.length === 0 && (await secInputs(page)) === 0,
    '〈利用者さん〉：特性を選んでから元の値に戻しただけなら、確認なしで取り消せる',
    dlg.messages,
  );
  await goTab(page, 'staffing');
  await editSec(page, 'staffing');
  const lim = sec(page, 'staffing').getByLabel('担当できる人を限る');
  await lim.check();
  await lim.uncheck();
  dlg.messages.length = 0;
  await sec(page, 'staffing').getByTestId('sec-cancel').click();
  await settle(page);
  check(
    dlg.messages.length === 0 && (await secInputs(page)) === 0,
    '〈利用者さん〉：担当できる人を限るを入れてすぐ外しただけなら、確認なしで戻る',
    dlg.messages,
  );
  // 別の節を直すと、変更が無ければそのまま替わる・あれば確かめる
  await editSec(page, 'staffing');
  await sec(page, 'staffing').getByTestId('client-usual').selectOption({ index: 1 });
  dlg.answer = false;
  dlg.messages.length = 0;
  await sec(page, 'conds').getByTestId('sec-edit').click();
  await settle(page);
  check(
    dlg.messages.length === 1 &&
      /ほかの節を直しますか/.test(dlg.messages[0]) &&
      (await sec(page, 'staffing').locator('select').count()) > 0,
    '〈利用者さん〉：変更があるまま別の節を直すと確認が出て、断れば今の節のまま',
    dlg.messages,
  );
  dlg.answer = true;
  await sec(page, 'conds').getByTestId('sec-edit').click();
  await settle(page);
  check(
    (await sec(page, 'staffing').locator('select').count()) === 0 &&
      (await sec(page, 'conds').getByTestId('sec-save').count()) === 1,
    '〈利用者さん〉：受ければ前の節を捨てて、押した節を直す',
  );
}

/**
 * レビューの直し（PR #79）：タブを替えて捨てたら戻っても直していない／吹き出しのリンクで捨てて移ると移る／
 * 誤りの文と入力欄の aria-describedby が合う／ほかの節の古い値で保存を止めない／予定のタブで edit= を開くと節のタブへ／
 * いない人の URL は一覧で知らせる
 */
async function reviewFixes(page, dlg) {
  dlg.answer = true;
  // タブを替えて「捨てて替える」→ 戻ると読むだけ
  await open(page, '/clients/c1?tab=basic', '[data-testid="person-sec"]');
  await editSec(page, 'basic');
  await sec(page, 'basic').locator('label', { hasText: 'メモ' }).locator('input').fill('タブで捨てる');
  dlg.messages.length = 0;
  await goTab(page, 'schedule');
  await goTab(page, 'basic');
  check(
    dlg.messages.length === 1 && (await secInputs(page)) === 0,
    'タブを替えて捨てたら、戻っても前の下書きを出さない（読むだけ）',
    dlg.messages,
  );
  // 吹き出しのリンクで「捨てて移る」→ 移る（確認で吹き出しが閉じても）
  await goTab(page, 'staffing');
  await editSec(page, 'staffing');
  await sec(page, 'staffing').getByTestId('client-usual').selectOption({ index: 1 });
  const name = page.locator('[data-section="compat"] [data-testid="person-btn"]').first();
  if ((await name.count()) === 0) check(false, '相性の節に名前がある（確かめの前提）');
  else {
    const sid = await name.getAttribute('data-id');
    await name.click();
    dlg.messages.length = 0;
    await page.getByTestId('person-pop-link').click();
    await settle(page, 600);
    check(
      dlg.messages.length === 1 && hashOf(page) === `#/staff/${sid}`,
      '変更があるまま吹き出しのリンクで「捨てて移る」と、その人の画面へ移る',
      { m: dlg.messages, h: hashOf(page) },
    );
  }
  // 誤りの文と入力欄の aria-describedby（同じ名前で保存）
  await open(page, '/clients/c1?tab=basic', '[data-testid="person-sec"]');
  const other = (await stored(page)).clients.find((c) => c.id !== 'c1').displayName;
  await editSec(page, 'basic');
  const nameInput = page.getByTestId('client-name');
  await nameInput.fill(other);
  await sec(page, 'basic').getByTestId('sec-save').click();
  await settle(page, 300);
  const desc = await nameInput.getAttribute('aria-describedby');
  const errText = desc
    ? await page
        .locator(`[id="${desc}"]`)
        .textContent()
        .catch(() => '')
    : '';
  check(
    (await nameInput.getAttribute('aria-invalid')) === 'true' && /同じ名前/.test(errText ?? ''),
    '誤った欄の aria-describedby が節の誤りの文を指す',
    { desc, errText },
  );
  await sec(page, 'basic').getByTestId('sec-cancel').click();
  await settle(page);
  // ほかの節の古い値（壊れた郵便番号）があっても、直している節は保存できる
  const o2 = await page.context().newPage();
  await o2.goto(`${BASE}#/data`);
  await o2.evaluate((k) => {
    const d = JSON.parse(localStorage.getItem(k));
    d.clients.find((c) => c.id === 'c1').place.postalCode = '12';
    localStorage.setItem(k, JSON.stringify(d));
  }, STORAGE_KEY);
  await o2.close();
  await settle(page, 400);
  await editSec(page, 'basic');
  await sec(page, 'basic').locator('label', { hasText: 'メモ' }).locator('input').fill('ほかの節は検査しない');
  await sec(page, 'basic').getByTestId('sec-save').click();
  await settle(page, 500);
  check(
    (await stored(page)).clients.find((c) => c.id === 'c1').note === 'ほかの節は検査しない',
    'ほかの節の古い値（郵便番号）で、直している節の保存を止めない',
  );
  // 予定のタブで edit= を開くと、節のあるタブへ移って開く
  await open(page, '/clients/c2?edit=place', '[data-testid="person-sec"]');
  check(
    urlOf(page).includes('tab=basic') &&
      !urlOf(page).includes('edit=') &&
      (await sec(page, 'place').locator('input').count()) > 0,
    'タブの無い URL の edit= は節のあるタブ（基本情報）へ移って開く',
    urlOf(page),
  );
  await sec(page, 'place').getByTestId('sec-cancel').click();
  // いない人の URL：一覧へ移って知らせる
  await open(page, '/clients/nobody', '[data-testid="client-row"]');
  await page
    .locator('.toast')
    .filter({ hasText: '見つかりません' })
    .waitFor({ timeout: 3000 })
    .catch(() => {});
  check(
    hashOf(page) === '#/clients' && (await page.locator('.toast').filter({ hasText: '見つかりません' }).count()) === 1,
    'いない人の URL は一覧へ移り、見つからないと知らせる',
  );
}

/** 休みの見え方・「まとめて地図に置く」の「編集」は住所の節を開く */
async function seeded(page) {
  await open(page, '/clients', '[data-testid="client-row"]');
  const today = new Date(NOW.getTime() + JST).toISOString().slice(0, 10);
  const shift = (n) => new Date(NOW.getTime() + JST + n * 86400000).toISOString().slice(0, 10);
  const leaves = [
    { id: 'lv-past', clientId: 'c1', from: shift(-20), to: shift(-15), note: '終わった入院' },
    { id: 'lv-now', clientId: 'c1', from: shift(-1), to: today, note: '' },
    { id: 'lv-next', clientId: 'c1', from: shift(10), to: shift(12), note: 'ショートステイ' },
  ];
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
  await page.getByRole('link', { name: '図書館 ふみを開く' }).click();
  await page.getByTestId('schedule-leaves').waitFor();
  const items = await page.getByTestId('schedule-leaves').locator('li').allTextContents();
  check(
    items.length === 2 && items[0].includes('理由なし') && items[1].includes('ショートステイ'),
    '〈利用者さん〉：予定のタブの休みはこれからの休み（今日を含む・開始日の順）',
    items,
  );
  check(
    (await page.getByTestId('person-state').textContent()).includes('休み中'),
    '〈利用者さん〉：休みの間は見出しに「休み中」',
  );
  await page.getByTestId('to-leaves').click();
  await page.getByTestId('leaves-section').waitFor();
  const rows = await page.getByTestId('leave-row').allTextContents();
  check(
    rows.length === 3 && rows.some((r) => r.includes('終わった休み')),
    '〈利用者さん〉：休みのタブは終わった休みも（印つき）',
    rows,
  );
  // 位置も住所も無い人の「編集」（まとめて地図に置く）は、その人の画面の住所の節を開く
  await open(page, '/clients', '[data-testid="client-row"]');
  await page
    .getByTestId('place-all-skipped')
    .getByRole('button', { name: /動物公園 やぎお/ })
    .click();
  await settle(page, 500);
  check(
    hashOf(page).startsWith('#/clients/c2') &&
      !urlOf(page).includes('edit=') &&
      (await sec(page, 'place').locator('input').count()) > 0,
    '〈利用者さん〉：「まとめて地図に置く」の「編集」はその人の画面の住所の節を開く（URL の edit は消す）',
    urlOf(page),
  );
  await sec(page, 'place').getByTestId('sec-cancel').click();
  await settle(page);
  check(
    (await sec(page, 'place').textContent()).includes('住所なし'),
    '〈利用者さん〉：住所が無ければ地区は「住所なし」',
  );
}

async function staff(page, dlg) {
  await open(page, '/staff', '.people-table tbody tr');
  await page.getByRole('link', { name: '市役所 まち子を開く' }).click();
  await view(page).waitFor();
  await settle(page, 400);
  check(hashOf(page) === '#/staff/s1', '〈スタッフ〉：一覧の「開く」でその人の画面（#/staff/s1）', hashOf(page));
  await goTab(page, 'basic');
  await isReading(page, '〈スタッフ〉・基本情報', ['特性', '自宅', '最終勤務日', 'メールアドレス', '移動手段']);
  await goTab(page, 'hours');
  await isReading(page, '〈スタッフ〉・勤務時間', ['稼働時間']);
  await goTab(page, 'compat');
  await isReading(page, '〈スタッフ〉・相性', ['相性', 'いつもの担当の']);
  await goTab(page, 'basic');
  await page.screenshot({ path: path.join(OUT_DIR, 'staff-basic.png') });
  await editSec(page, 'basic');
  check((await sec(page, 'basic').locator('input').count()) > 2, '〈スタッフ〉：「直す」で入力欄になる');
  dlg.messages.length = 0;
  await sec(page, 'basic').getByTestId('sec-cancel').click();
  await settle(page);
  check(dlg.messages.length === 0 && (await secInputs(page)) === 0, '〈スタッフ〉：変更なしの取り消しは確認なし');
  await editSec(page, 'basic');
  await page.getByTestId('staff-email').fill('view-check@example.com');
  dlg.answer = false;
  await sec(page, 'basic').getByTestId('sec-cancel').click();
  await settle(page);
  check(
    dlg.messages.length === 1 && /変更を捨てますか/.test(dlg.messages[0]),
    '〈スタッフ〉：変更ありの取り消しは確認が出る',
  );
  dlg.answer = true;
  await sec(page, 'basic').getByTestId('sec-save').click();
  await settle(page, 600);
  const s1 = (await stored(page)).staff.find((s) => s.id === 's1');
  check(
    (await secInputs(page)) === 0 &&
      (await sec(page, 'basic').textContent()).includes('view-check@example.com') &&
      s1.email === 'view-check@example.com',
    '〈スタッフ〉：保存すると読むだけに戻り、保存した中身が出る',
  );
  // ?id=
  await open(page, '/staff?id=s2', '[data-testid="person-view"]');
  check(hashOf(page) === '#/staff/s2', '〈スタッフ〉：?id= はその人の画面へ移る', hashOf(page));
  // 追加
  await open(page, '/staff', '.people-table tbody tr');
  await page.getByTestId('staff-add').click();
  await settle(page);
  check(
    hashOf(page) === '#/staff/new' && (await page.locator('h1').first().textContent()).includes('を追加'),
    '〈スタッフ〉：「追加」は新しい人の画面',
  );
  await sec(page, 'new').getByTestId('sec-cancel').click();
  await settle(page);
  check(hashOf(page) === '#/staff', '〈スタッフ〉：何も入れない追加の取り消しは一覧へ');
  // 最終勤務日を入れて保存すると、担当の振り直しの欄
  await open(page, '/staff/s1?tab=basic', '[data-testid="person-sec"]');
  await editSec(page, 'lastDay');
  const d = new Date(NOW.getTime() + JST + 7 * 86400000).toISOString().slice(0, 10);
  await page.getByTestId('staff-lastday-input').fill(d);
  await sec(page, 'lastDay').getByTestId('sec-save').click();
  await settle(page, 500);
  const head =
    (await page
      .locator('.drawer h2')
      .first()
      .textContent()
      .catch(() => '')) ?? '';
  check(/振り直し/.test(head), '〈スタッフ〉：最終勤務日を入れて保存すると、担当の振り直しの欄が開く', head);
}

/** 〈スタッフ〉：変更があるときの Esc・別の人の URL（断る・受ける） */
async function staffMore(page, dlg) {
  await open(page, '/staff/s1?tab=basic', '[data-testid="person-sec"]');
  await editSec(page, 'basic');
  const email = page.getByTestId('staff-email');
  await email.fill('more@example.com');
  dlg.answer = false;
  dlg.messages.length = 0;
  await email.press('Escape');
  await settle(page);
  check(
    dlg.messages.length === 1 && (await email.inputValue()) === 'more@example.com',
    '〈スタッフ〉：変更ありで Esc を押すと確認が出て、断れば編集が続く',
    dlg.messages,
  );
  const s2 = (await stored(page)).staff.find((s) => s.id === 's2');
  dlg.messages.length = 0;
  await goHash(page, '#/staff/s2');
  await settle(page, 500);
  check(
    dlg.messages.length === 1 &&
      dlg.messages[0].includes(`${s2.name}を開きますか`) &&
      (await email.inputValue()) === 'more@example.com' &&
      hashOf(page).startsWith('#/staff/s1'),
    '〈スタッフ〉：変更があるまま別の人の URL になると確認が出て、断れば編集のまま',
    dlg.messages,
  );
  dlg.answer = true;
  await goHash(page, '#/staff/s2');
  await settle(page, 500);
  check(
    (await view(page).getAttribute('data-id')) === 's2' &&
      (await page.locator('h1').first().textContent()).includes(s2.name),
    '〈スタッフ〉：受ければ別の人の画面になる',
  );
  const s1 = (await stored(page)).staff.find((s) => s.id === 's1');
  check(s1.email !== 'more@example.com', '〈スタッフ〉：捨てた変更は保存しない');
}

/** 相性の画面の吹き出しのリンクでその人の画面 */
async function links(page) {
  await open(page, '/compat', '[data-testid="compat-head-btn"]');
  await page.getByTestId('compat-head-btn').first().click();
  await page.getByTestId('compat-pop-link').click();
  await settle(page, 500);
  check(
    hashOf(page).startsWith('#/staff/') && (await view(page).getAttribute('data-kind')) === 'staff',
    '相性の吹き出しのリンク（〈スタッフ〉）でその人の画面',
    hashOf(page),
  );
  await open(page, '/compat', '[data-testid="compat-client-btn"]');
  await page.getByTestId('compat-client-btn').first().click();
  await page.getByTestId('compat-pop-link').click();
  await settle(page, 500);
  check(
    hashOf(page).startsWith('#/clients/') && (await view(page).getAttribute('data-kind')) === 'client',
    '相性の吹き出しのリンク（〈利用者さん〉）でその人の画面',
    hashOf(page),
  );
}

/** 相性・担当の名前から詳細の吹き出し・相手の画面（PRD D198〜D200） */
async function names(page) {
  await open(page, '/staff', '.people-table tbody tr');
  // s1 を全員と ◎ にし、1人を休止中・1人を s1 のいつもの担当にする（別のタブで書く）
  const other = await page.context().newPage();
  await other.goto(`${BASE}#/data`);
  await other.evaluate((k) => {
    const d = JSON.parse(localStorage.getItem(k));
    d.compat = d.compat ?? {};
    for (const c of d.clients) d.compat[c.id] = { ...(d.compat[c.id] ?? {}), s1: 2 };
    d.clients[0].active = false;
    d.clients[0].stage = 'ended';
    d.clients[1].usualStaffId = 's1';
    localStorage.setItem(k, JSON.stringify(d));
  }, STORAGE_KEY);
  await other.close();
  await settle(page, 300);
  const data = await stored(page);
  const active = data.clients.filter((c) => c.active);
  const usual = active.filter((c) => c.usualStaffId === 's1');
  await open(page, '/staff/s1?tab=compat', '[data-testid="view-compat-great"]');
  const great = page.getByTestId('view-compat-great');
  const btns = great.getByTestId('person-btn');
  check(
    (await great.textContent()).includes(`${active.length}人`) && (await btns.count()) === Math.min(12, active.length),
    '〈スタッフ〉：◎ の〈利用者さん〉を人数と名前で並べ、13人目からは畳む（利用中だけ）',
    { text: await great.textContent(), n: await btns.count(), active: active.length },
  );
  check(
    !(await great.textContent()).includes(data.clients[0].displayName),
    '〈スタッフ〉：休止中の〈利用者さん〉は並べない',
  );
  const more = page.getByTestId('view-compat-great-more');
  check(
    (await more.textContent()) === `あと ${active.length - 12}人`,
    '〈スタッフ〉：「あと N人」',
    await more.textContent(),
  );
  await more.click();
  check(
    (await btns.count()) === active.length && (await more.getAttribute('aria-expanded')) === 'true',
    '〈スタッフ〉：「あと N人」で全員',
  );
  const usualNames = await page.getByTestId('view-usual-clients').getByTestId('person-btn').allTextContents();
  check(
    usualNames.length === usual.length && usual.every((c) => usualNames.includes(c.displayName)),
    '〈スタッフ〉：いつもの担当の〈利用者さん〉の名前',
    usualNames,
  );
  check((await page.getByTestId('view-compat-ng').textContent()) === '—', '〈スタッフ〉：居ない記号は「—」');
  // 名前で詳細の吹き出し。Tab は吹き出しの中、端から出ると閉じて名前へ、Esc は吹き出しだけ閉じる
  const first = btns.first();
  const firstId = await first.getAttribute('data-id');
  await first.click();
  const pop = page.getByTestId('person-pop');
  await pop.waitFor({ timeout: 3000 });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  check(
    await page.evaluate(() => !!document.activeElement?.closest('[data-testid="person-pop"]')),
    '名前の吹き出し：Tab でフォーカスが吹き出しの中を進む',
  );
  await page.keyboard.press('Tab');
  await settle(page);
  check(
    (await pop.count()) === 0 &&
      (await page.evaluate(() => document.activeElement?.getAttribute('data-id'))) === firstId,
    '名前の吹き出し：端から Tab で出ると閉じ、フォーカスは名前へ戻る',
  );
  await first.click();
  await pop.waitFor({ timeout: 3000 });
  await page.keyboard.press('Escape');
  await settle(page);
  check(
    (await pop.count()) === 0 && (await activeTestId(page)) === 'person-btn',
    '名前の吹き出し：Esc は吹き出しだけ閉じ、フォーカスは名前へ戻る',
  );
  await first.click();
  await page.getByTestId('person-pop-link').click();
  await settle(page, 500);
  check(
    hashOf(page) === `#/clients/${firstId}` && (await view(page).getAttribute('data-id')) === firstId,
    '吹き出しのリンクで〈利用者さん〉の画面',
    urlOf(page),
  );
  // 〈利用者さん〉の担当できる人・いつもの担当も名前から
  const c = data.clients.find((x) => x.id === firstId);
  await goTab(page, 'staffing');
  const usualStaff = page.getByTestId('view-usual-staff').getByTestId('person-btn');
  if (c.usualStaffId) {
    await usualStaff.click();
    await page.getByTestId('person-pop-link').click();
    await settle(page, 500);
    check(
      (await view(page).getAttribute('data-id')) === c.usualStaffId && hashOf(page).startsWith('#/staff/'),
      '〈利用者さん〉：いつもの担当の名前から〈スタッフ〉の画面',
    );
  } else {
    check((await usualStaff.count()) === 0, '〈利用者さん〉：いつもの担当が無ければ名前のボタンは無い');
  }
  await page.screenshot({ path: path.join(OUT_DIR, 'names.png') });
}

/** 一覧の行を押すとその人の画面（PRD D308）：名前の文字・特性の欄を押しても移り、1280px と 390px で同じ */
async function rowClick(page) {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, '/clients', '[data-testid="client-row"]');
    const row = page.getByTestId('client-row').filter({ hasText: '図書館 ふみ' }).first();
    const cursor = await row.evaluate((el) => getComputedStyle(el).cursor);
    // ドラッグで文字を選んだときは移らない（名前の文字の上を左から右へ）
    const box = await row.getByText('図書館 ふみ', { exact: true }).first().boundingBox();
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await settle(page, 300);
    check(
      hashOf(page) === '#/clients',
      `〈利用者さん〉・${width}px：名前の文字をドラッグで選んでも移らない`,
      hashOf(page),
    );
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await row.getByText('図書館 ふみ', { exact: true }).first().click();
    await view(page).waitFor({ timeout: 5000 });
    check(
      cursor === 'pointer' && hashOf(page) === '#/clients/c1',
      `〈利用者さん〉・${width}px：行の名前を押すとその人の画面（指のカーソル）`,
      cursor,
    );
    await page.goBack();
    await page.getByTestId('client-row').first().waitFor();
    check(hashOf(page) === '#/clients', `〈利用者さん〉・${width}px：戻ると一覧`);
    await open(page, '/staff', '[data-testid="staff-row"]');
    const srow = page.getByTestId('staff-row').filter({ hasText: '市役所 まち子' }).first();
    await srow.locator('td').nth(2).click();
    await view(page).waitFor({ timeout: 5000 });
    check(hashOf(page) === '#/staff/s1', `〈スタッフ〉・${width}px：行の特性の欄を押すとその人の画面`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

/**
 * 〈スタッフ〉のアイコン（PRD D298・D299。ADR-0050）：基本の節で「訪」を入れて保存すると一覧・日の予定の列の見出しの印が「訪」、
 * 3文字は保存しない（誤りの欄）、空に戻すと苗字の最初の1文字。印の文字は data-text（CSS で描く）
 */
async function staffIcon(page) {
  const markText = (loc) => loc.first().getAttribute('data-text');
  const listMark = (p) => p.locator('.people-table [data-staff-mark="s1"]');
  await open(page, '/staff', '.people-table tbody tr');
  check((await markText(listMark(page))) === '市', '〈スタッフ〉の印：既定は苗字の最初の1文字（一覧）');
  await open(page, '/staff/s1?tab=basic', '[data-testid="person-sec"]');
  check(
    (await markText(sec(page, 'basic').locator('[data-staff-mark="s1"]'))) === '市',
    '〈スタッフ〉の印：基本の節にも印を出す',
  );
  await editSec(page, 'basic');
  const icon = page.getByTestId('staff-icon');
  check((await icon.getAttribute('placeholder')) === '市', '〈スタッフ〉の印：空のアイコンの欄は既定の文字を薄く出す');
  await icon.fill('訪問者');
  await sec(page, 'basic').getByTestId('sec-save').click();
  await settle(page, 400);
  check(
    (await icon.getAttribute('aria-invalid')) === 'true' &&
      ((await stored(page))?.staff.find((s) => s.id === 's1')?.icon ?? '') === '',
    '〈スタッフ〉の印：2文字を超えるアイコンは誤りで保存しない',
  );
  await icon.fill('訪');
  check(
    (await markText(sec(page, 'basic').locator('.staff-icon-field .staff-mark'))) === '訪',
    '〈スタッフ〉の印：入力の見本がその場で変わる',
  );
  await sec(page, 'basic').getByTestId('sec-save').click();
  await settle(page, 600);
  check((await stored(page)).staff.find((s) => s.id === 's1').icon === '訪', '〈スタッフ〉の印：「訪」を保存する');
  await open(page, '/staff', '.people-table tbody tr');
  check((await markText(listMark(page))) === '訪', '〈スタッフ〉の印：一覧の印が「訪」');
  await open(page, '/plan', '.route-col');
  const head = page.locator('.col-head [data-staff-mark="s1"]');
  check(
    (await head.count()) > 0 && (await markText(head)) === '訪',
    '〈スタッフ〉の印：日の予定の列の見出しの印も「訪」',
  );
  await open(page, '/staff/s1?tab=basic', '[data-testid="person-sec"]');
  await editSec(page, 'basic');
  await page.getByTestId('staff-icon').fill('');
  await sec(page, 'basic').getByTestId('sec-save').click();
  await settle(page, 600);
  check(
    (await stored(page)).staff.find((s) => s.id === 's1').icon === '',
    '〈スタッフ〉の印：アイコンを空に戻すと苗字の最初の1文字',
  );
}

const errors = [];
const steps = pagePerStep({
  open: async (browser) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // 初回の案内ツアーを見た扱いにする（PRD D193）
    await skipTour(ctx);
    // 地図のタイルは外へ取りに行かない
    await ctx.route(/cyberjapandata\.gsi\.go\.jp/, (r) => r.fulfill({ status: 204, body: '' }));
    const page = await ctx.newPage();
    await page.clock.setFixedTime(NOW);
    page.on('pageerror', (e) => errors.push(String(e)));
    return { ctx, page, dlg: await answerConfirms(page) };
  },
  call: (fn, s) => fn(s.page, s.dlg),
  steps: [clients, clientsMore, reviewFixes, seeded, staff, staffMore, links, names, rowClick, staffIcon],
  label: (name) => `${name}：途中で止まった`,
  after: (name, { dlg }) => check(dlg.native.length === 0, `${name}：ブラウザのダイアログを出さない`, dlg.native),
  end: () => check(errors.length === 0, 'ページのエラーが無い', errors),
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
