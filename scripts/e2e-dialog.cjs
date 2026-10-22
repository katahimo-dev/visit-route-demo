// 独自の確認ダイアログ（PRD D146〜D150。ADR-0026）を本物のブラウザで確かめる：
// 代表の数か所（条件を消す・項目を消す・データを初期状態に戻す・日の画面の「この割当で確定」・〈スタッフ〉の変更を捨てる）で、
// 画面の中央に独自のダイアログが出て、ブラウザのネイティブのダイアログは出ない（page.on('dialog') が呼ばれたら失敗）。
// role=alertdialog・aria-modal・見出しと本文の aria-labelledby/describedby、最初のフォーカスは取り消し、Tab・Shift+Tab は中で回る、
// 裏（#root）は inert・巻かない。Esc・取り消す・背景を押すでは何も変わらず、確定で処理が進む。閉じたら押したボタンへフォーカスが戻る。
// 節を直しているときに出たとき、Esc は確認だけを閉じる（節は直したまま）。ダブルクリックの2回目で取り消しにならない。
// 確認中に「戻る」で別の画面へ移ると、確認が閉じてデータは変わらない。390px で画面に収まる。印刷では出さない。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-dialog.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { skipTour } = require('./lib/tourSeen.cjs');
const { BASE, OUT_DIR, NOW, check, settle, stored, runSteps } = require('./lib/env.cjs');
const { pagePerStep } = require('./lib/steps.cjs');

const dialog = (page) => page.getByTestId('confirm-dialog');
/** いまフォーカスのある要素の data-testid・読み上げ名 */
const focused = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.getAttribute('data-testid') ?? ''}|${el.getAttribute('aria-label') ?? el.textContent ?? ''}` : '';
  });

async function open(page, hash, ready) {
  // 同じ文書の中で hash を移してから読み直すと、読み直す前に `?id=` が処理されて URL から消えることがあるので、
  // about:blank を挟んで開く（e2e-home と同じ）
  await page.goto('about:blank');
  await page.goto(`${BASE}#${hash}`);
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

// ---- 条件の名前（PRD D271）：ふだんは文字・［名前を変える］で入力欄・Enter で決める・Esc で取り消す、必須の条件を消す確認の本文 ----
async function ruleNames(page) {
  await open(page, '/rules', 'table');
  const r0 = (await stored(page)).rules[0];
  const row = page.locator('.rules-table tbody > tr').first();
  check(
    (await row.locator('input:not([type="range"]):not([type="checkbox"])').count()) === 0 &&
      (await row.getByTestId('rule-name').textContent()) === r0.label,
    '条件の名前：ふだんは文字（入力欄にしない）',
  );
  await row.getByTestId('rule-rename').click();
  const input = row.getByTestId('rule-name-input');
  await input.waitFor();
  check(
    (await input.evaluate((el) => el === document.activeElement)) && (await input.inputValue()) === r0.label,
    '［名前を変える］で入力欄（今の名前・フォーカス）',
  );
  await input.fill('取り消す名前');
  await page.keyboard.press('Escape');
  await settle(page);
  check(
    (await stored(page)).rules[0].label === r0.label && (await row.getByTestId('rule-name').textContent()) === r0.label,
    '条件の名前：Esc で取り消すと変わらない',
  );
  check(
    (await page.evaluate(() => document.activeElement?.dataset.testid)) === 'rule-rename',
    '条件の名前：閉じたらフォーカスは［名前を変える］',
  );
  await row.getByTestId('rule-rename').click();
  await row.getByTestId('rule-name-input').fill('新しい名前');
  // 変換中の Enter（かなの確定）では決めない（入力欄のまま・保存しない）
  await row.getByTestId('rule-name-input').evaluate((el) => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true }));
  });
  await settle(page);
  check(
    (await row.getByTestId('rule-name-input').count()) === 1 && (await stored(page)).rules[0].label === r0.label,
    '条件の名前：変換中の Enter では決めない',
  );
  await page.keyboard.press('Enter');
  await settle(page);
  check(
    (await stored(page)).rules[0].label === '新しい名前' &&
      (await row.getByTestId('rule-name').textContent()) === '新しい名前',
    '条件の名前：Enter で決めると保存して文字に戻る',
  );
  // 必須の条件を消す：確認の本文で「守らなければ担当にしない」が無くなることを伝える。取り消すと消えない
  const hardRow = page
    .locator('.rules-table tbody > tr')
    .filter({ has: page.locator('.hard-toggle.is-on') })
    .first();
  const n = (await stored(page)).rules.length;
  await hardRow.getByRole('button', { name: /を消す$/ }).click();
  const a = await shape(page, '必須の条件を消す');
  check(/必須の条件です。.*守らなければ担当にしない/.test(a.body), '必須の条件を消す：確認の本文', a.body);
  await page.getByTestId('confirm-cancel').click();
  await settle(page);
  check((await stored(page)).rules.length === n, '必須の条件を消す：取り消すと消えない');
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
  // ボタンのダブルクリック：2回目が背景に当たっても取り消しにしない（開いてすぐ・連続のクリックは無視）
  await btn.dblclick();
  // 「開いてすぐのクリックは無視」の時間を過ぎるまで待つ（時間そのものを見るので固定の待ち。ADR-0041）
  await page.waitForTimeout(400);
  check((await dialog(page).count()) === 1, '条件を消す：ダブルクリックでも確認が残る');
  // 背景を押す（開いてから少したったクリック）
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

// ---- 確認中に「戻る」で別の画面へ：確認が閉じ、外れた画面の続きはデータを書かない ----
async function backWhileAsking(page) {
  await open(page, '/data', 'h1');
  await page.goto(`${BASE}#/rules`);
  await page.locator('table').first().waitFor();
  await settle(page, 400);
  const before = (await stored(page)).rules.length;
  const r0 = (await stored(page)).rules[0];
  await page.getByRole('button', { name: `条件「${r0.label}」を消す` }).click();
  await dialog(page).waitFor();
  await page.goBack();
  await page.waitForURL(/#\/data/);
  await settle(page, 500);
  check(
    (await dialog(page).count()) === 0 && (await stored(page)).rules.length === before,
    '確認中に戻る：確認が閉じ、データが変わらない',
  );
  const rootInert = await page.evaluate(() => document.getElementById('root')?.inert ?? false);
  check(!rootInert, '確認中に戻る：裏の inert が残らない');
}

// ---- データを初期状態に戻す（#/data）：取り消しでトーストなし、確定でトースト ----
async function dataReset(page) {
  await open(page, '/data', 'h1');
  await page.getByRole('button', { name: 'デモの初期状態に戻す' }).click();
  const a = await shape(page, '初期状態に戻す');
  check(/いまの変更はすべて消えます/.test(a.body), '初期状態に戻す：本文（aria-describedby）', a.body);
  check(
    /管理者設定の機能の入り切りは、そのまま/.test(a.body),
    '初期状態に戻す：本文に「管理者設定の機能の入り切りは、そのまま」（PRD D216）',
    a.body,
  );
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

// ---- 〈スタッフ〉の変更を捨てる（その人の画面の節。PRD D308）：Esc は確認だけを閉じる、捨てて取り消す ----
async function staffDiscard(page) {
  await open(page, '/staff/s1?tab=basic', '[data-testid="person-sec"]');
  const basic = page.locator('[data-testid="person-sec"][data-section="basic"]');
  await basic.getByTestId('sec-edit').click();
  const email = basic.locator('input[type="email"]').first();
  await email.waitFor();
  await email.fill('dialog@example.com');
  // 節の Esc → 確認
  await email.press('Escape');
  const a = await shape(page, '変更を捨てる');
  check(a.title === '変更を捨てますか？', '変更を捨てる：見出し', a.title);
  check(
    (await page.getByTestId('confirm-cancel').textContent()) === '編集を続ける',
    '変更を捨てる：取り消しは「編集を続ける」',
  );
  // 確認の Esc は節に渡さない（節は直したまま・入力はそのまま）
  await page.keyboard.press('Escape');
  await settle(page);
  check(
    (await dialog(page).count()) === 0 &&
      (await basic.getByTestId('sec-save').count()) === 1 &&
      (await email.inputValue()) === 'dialog@example.com',
    '変更を捨てる：確認の Esc は確認だけを閉じ、編集が続く',
  );
  // 取り消し → 捨てる
  await basic.getByTestId('sec-cancel').click();
  await dialog(page).waitFor();
  check((await page.getByTestId('confirm-ok').textContent()) === '捨てる', '変更を捨てる：確定は「捨てる」');
  await page.getByTestId('confirm-ok').click();
  await settle(page, 400);
  const s1 = (await stored(page)).staff.find((s) => s.id === 's1');
  check(
    (await basic.getByTestId('sec-save').count()) === 0 && s1.email !== 'dialog@example.com',
    '変更を捨てる：確定で読むだけに戻り、保存しない',
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

const errors = [];
const steps = pagePerStep({
  open: async (browser) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    // 初回の案内ツアーを見た扱いにする（PRD D193）
    await skipTour(ctx);
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
    return { ctx, page, native };
  },
  steps: [ruleNames, rules, backWhileAsking, dataReset, adopt, staffDiscard, narrow],
  label: (name) => `${name}：途中で止まった`,
  after: (name, { native }) => check(native.length === 0, `${name}：ブラウザのダイアログを出さない`, native),
  end: () => check(errors.length === 0, 'ページのエラーが無い', errors),
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
