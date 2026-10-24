// 日の予定の手で直す操作と比較の画面を本物のブラウザで確かめる（日の予定に「AI で組む ▾」は無い。ADR-0063）：
// 担当を組むの「案を比べる」で比較の画面へ・その場で提案を作って並べる（保存しない）・反映するとトーストの「元に戻す」で1手戻る。
// 訪問の詳細の「担当を変える ▾」（PRD D217〜D219。ADR-0030）：まとまりと項目（role="menuitem"・説明・今の担当・押せない理由・
// 「担当なしにする」）、キーボード（Enter で開いて ↓・Enter）で移すと担当が変わりピン、トーストの「元に戻す」で担当・ピンが戻る、
// 「担当なしにする」のあとの確定の確認の本文の先頭に要対応の件数、操作の行の「元に戻す」（キーボード）、390px で押せて収まる。
// 操作の行（PRD D278・D279・D344。ADR-0045）：日の予定は訪問を追加・使い方を操作の行に出し（その他 ▾ はスマホだけ。メールで送るは見出し。PRD D306）
// （キーボードで訪問の入力・閉じるとフォーカスは「訪問を追加」・使い方は下に開いてフォーカス・操作の行は今の担当のすぐ下）、月の予定は表示を選ぶ・印刷・勤務の見込み・マスの見方の説明を
// たたむ（表示の選択は開くと欄へフォーカス・〈スタッフ〉を選んでいる間はたためない）。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-plan-menu.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { BASE, OUT_DIR, TODAY, STORAGE_KEY, check, settle, stored, runSteps } = require('./lib/env.cjs');
const { sharedPage, openPage } = require('./lib/steps.cjs');

/** 保存（少し遅れて書く）が条件を満たすまで待つ（満たさなければ時間切れで続ける） */
async function waitStored(page, pred, arg, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const d = await stored(page);
    if (d && pred(d, arg)) return;
    await settle(page, 100);
  }
}
const dialog = (page) => page.getByTestId('confirm-dialog');
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

/** 訪問の担当（版2：保存した訪問は staffId、計算した繰り返しの回は繰り返しの担当）とピン */
function staffOf(d, vid) {
  const own = d.visits.find((v) => v.id === vid);
  if (own) return { staffId: own.staffId, pinned: !!own.pinned };
  const p = d.patterns.find((x) => vid.endsWith(`_${x.id}`));
  return { staffId: p?.usualStaffId ?? null, pinned: false };
}
const visitsKey = (d) => JSON.stringify(d.visits);

// ---- 担当を組むの「案を比べる」→ 比較の画面でその場で提案を作って並べる（保存しない） ----
async function compare(page) {
  await editData(page, (key) => localStorage.removeItem(key), STORAGE_KEY);
  await openPlan(page);
  // 今日の担当のある訪問1件を担当なしにしておく（提案はそれに担当を入れるので、反映すると訪問が変わる）
  await editData(
    page,
    ({ key, date }) => {
      const d = JSON.parse(localStorage.getItem(key));
      const v = d.visits.find((x) => x.date === date && !x.cancelled && x.staffId);
      v.staffId = null;
      v.pinned = false;
      localStorage.setItem(key, JSON.stringify(d));
    },
    { key: STORAGE_KEY, date: TODAY },
  );
  await openPlan(page);
  const before = visitsKey(await stored(page));
  // 比較の画面へは担当を組むの画面の「案を比べる」から（ADR-0063）
  await page.goto(`${BASE}#/arrange?date=${TODAY}`);
  await page.getByTestId('arrange-compare-open').click();
  await page.waitForURL(/#\/compare/, { timeout: 10000 });
  await page.getByTestId('compare-another').waitFor({ timeout: 30000 });
  check((await page.locator('h1').innerText()).trim() === '提案を比べる', '比較の画面「提案を比べる」');
  const n0 = await page.getByTestId('compare-apply').count();
  await page.getByTestId('compare-another-make').click();
  await page
    .waitForFunction((n) => document.querySelectorAll('[data-testid="compare-apply"]').length > n, n0, {
      timeout: 90000,
    })
    .catch(() => {});
  const n1 = await page.getByTestId('compare-apply').count();
  check(n1 === n0 + 1, '「提案を作って比べる」で提案が1つ増え、反映するボタンが出る', { n0, n1 });
  check(visitsKey(await stored(page)) === before, '比較の提案は保存しない（訪問は変わらない）');
  await page.screenshot({ path: path.join(OUT_DIR, 'compare-proposal.png') });
  // 反映する → トーストの「元に戻す」で反映する前に戻る（日の予定と同じ控え。PR #80 のレビュー）
  await page.getByTestId('compare-apply').last().click();
  await page.getByTestId('toast-undo').waitFor({ timeout: 5000 });
  await waitStored(page, (d, b) => JSON.stringify(d.visits) !== b, before);
  const applied = visitsKey(await stored(page));
  await page.getByTestId('toast-undo').click();
  await waitStored(page, (d, b) => JSON.stringify(d.visits) === b, before);
  check(
    applied !== before && visitsKey(await stored(page)) === before,
    '比較の画面で反映すると訪問が変わり、トーストの「元に戻す」で1手戻せる',
  );
}

// ---- 担当を変える ▾・元に戻す・確定の確認の件数（PRD D217〜D219。ADR-0030） ----
const reBtn = (page) => page.getByTestId('plan-reassign');
const reList = (page) => page.getByTestId('plan-reassign-list');
/** 開いた「担当を変える」の一覧の中身（まとまり・項目の名前・説明・押せないか・今の担当） */
async function reassignShape(page) {
  return reList(page).evaluate((list) => {
    const text = (ids) =>
      (ids ?? '')
        .split(' ')
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .trim();
    return {
      role: list.getAttribute('role'),
      groups: [...list.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-label')),
      buttons: list.querySelectorAll('button').length,
      items: [...list.querySelectorAll('[role="menuitem"]')].map((el) => ({
        key: el.getAttribute('data-key'),
        name: text(el.getAttribute('aria-labelledby')),
        desc: text(el.getAttribute('aria-describedby')),
        disabled: el.getAttribute('aria-disabled') === 'true',
        current: el.getAttribute('aria-current') === 'true',
      })),
    };
  });
}

/** いまのフォーカス：body か・いちばん近い訪問（data-visit）と、どの描き方か（時間軸の帯・順番のカード） */
const activeInfo = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return {
      body: !el || el === document.body,
      visit: el?.closest('[data-visit]')?.getAttribute('data-visit') ?? null,
      cls: el?.className ?? '',
    };
  });

async function reassignMenu(page) {
  await editData(page, (key) => localStorage.removeItem(key), STORAGE_KEY);
  await openPlan(page);
  const d0 = await stored(page);
  const beforeKey = visitsKey(d0);
  // 時間軸の担当の列の最初の帯を押して詳細を開く
  const band = page.locator('.route-col:not(.route-col-none) .tl-band').first();
  const vid = await band.getAttribute('data-visit');
  const from = staffOf(d0, vid).staffId;
  await band.locator('.tl-band-btn').click();
  await reBtn(page).waitFor({ timeout: 5000 });
  check(
    (await reBtn(page).getAttribute('aria-haspopup')) === 'menu',
    '担当を変える：訪問の詳細にボタン（aria-haspopup="menu"）',
  );
  // キーボード：ボタンにフォーカスして Enter で開く（先頭＝今の担当）
  await reBtn(page).focus();
  await page.keyboard.press('Enter');
  await reList(page).waitFor();
  const s = await reassignShape(page);
  check(
    s.role === 'menu' && s.buttons === s.items.length,
    '担当を変える：一覧は role="menu"・項目はすべて role="menuitem"',
    s,
  );
  check(
    JSON.stringify(s.groups) === JSON.stringify(['今の担当', 'ほかのスタッフへ移す', 'そのほか']),
    '担当を変える：まとまり（今の担当／ほかの〈スタッフ〉へ移す／そのほか）',
    s.groups,
  );
  const cur = s.items[0];
  check(
    cur?.key === `cur-${from}` && cur.current && cur.disabled && /今の担当です/.test(cur.desc),
    '担当を変える：先頭は今の担当（印・押せない・説明「今の担当です」）',
    cur,
  );
  const others = s.items.filter((x) => x.key.startsWith('to-'));
  check(
    others.length > 0 && others.every((x) => x.desc.length > 0),
    '担当を変える：ほかの人ごとに1行の説明（aria-describedby）',
    others.map((x) => `${x.name}：${x.desc}`),
  );
  const firstOff = others.findIndex((x) => x.disabled);
  check(
    firstOff < 0 || others.slice(firstOff).every((x) => x.disabled),
    '担当を変える：押せる人が先、押せない人は後ろ',
    others.filter((x) => x.disabled),
  );
  const last = s.items.at(-1);
  check(last?.key === 'none' && !last.disabled, '担当を変える：最後に「担当なしにする」', last);
  check((await focusedId(page)) === 'plan-reassign-current', 'キーボード：開くと先頭（今の担当）にフォーカス');
  // ↓ で最初の候補へ、Enter で移す
  await page.keyboard.press('ArrowDown');
  const target = others[0];
  check(
    (await page.evaluate(() => document.activeElement?.getAttribute('data-key'))) === target.key && !target.disabled,
    'キーボード：↓ で最初の候補（押せる人）へ',
    target,
  );
  const to = target.key.slice(3);
  await page.keyboard.press('Enter');
  await reList(page).waitFor({ state: 'detached' });
  await waitStored(page, (d, [v, t]) => d.visits.some((x) => x.id === v && x.staffId === t && x.pinned), [vid, to]);
  const moved = staffOf(await stored(page), vid);
  check(moved.staffId === to && moved.pinned, 'Enter で選ぶと担当が変わりピンが付く（ドラッグと同じ。訪問に書く）', {
    from,
    moved,
  });
  await settle(page, 200);
  const f1 = await activeInfo(page);
  check(!f1.body && f1.visit === vid, '選んだあと：フォーカスは body に落ちず、移した先の訪問へ', f1);
  const toastUndo = page.getByTestId('toast-undo');
  await toastUndo.waitFor({ timeout: 3000 });
  const toastText = await page.locator('.toast').innerText();
  check(
    /さんへ移しました/.test(toastText) && /元に戻す/.test(toastText),
    'トースト「〈名前〉さんへ移しました」と「元に戻す」',
    toastText,
  );
  const undoBtn = page.getByTestId('undo-btn');
  check((await undoBtn.getAttribute('aria-disabled')) !== 'true', '操作の行の「元に戻す」：移したあとは押せる');
  await page.screenshot({ path: path.join(OUT_DIR, 'reassign-moved.png') });
  // トーストの「元に戻す」で、担当・ピンが移す前に戻る
  await toastUndo.click();
  await waitStored(page, (d, b) => JSON.stringify(d.visits) === b, beforeKey);
  check(visitsKey(await stored(page)) === beforeKey, 'トーストの「元に戻す」：担当・ピンが移す前のとおりに戻る');
  await page.locator('.toast').filter({ hasText: '元に戻しました' }).waitFor({ timeout: 3000 });
  check(true, '戻すと知らせ「元に戻しました」');
  const f2 = await activeInfo(page);
  check(!f2.body && f2.visit === vid, 'トーストの「元に戻す」のあと：フォーカスは body に落ちず、戻した訪問へ', f2);
  check(
    (await undoBtn.getAttribute('aria-disabled')) === 'true',
    '戻したあとは（ほかに戻せる手が無いので）「元に戻す」を押せない',
  );

  // 「担当なしにする」→ 確定の確認に要対応の件数 → 取り消す → 操作の行の「元に戻す」
  const pick = page.locator(`.tl-band[data-visit="${vid}"] .tl-band-btn`);
  if (!(await reBtn(page).count())) await pick.click();
  await reBtn(page).click();
  await reList(page).waitFor();
  await page.getByTestId('plan-reassign-none').click();
  await waitStored(page, (d, v) => d.visits.some((x) => x.id === v && x.staffId === null), vid);
  const none = staffOf(await stored(page), vid);
  check(none.staffId === null && !none.pinned, '「担当なしにする」：担当なしになりピンは付かない', none);
  await settle(page, 200);
  const f3 = await activeInfo(page);
  check(!f3.body && f3.visit === vid, '「担当なしにする」のあと：フォーカスは body に落ちず、その訪問のカードへ', f3);
  check(/担当なしにしました/.test(await page.locator('.toast').innerText()), '「担当なしにする」：知らせ');
  await page.getByTestId('adopt').click();
  await dialog(page).waitFor({ timeout: 5000 });
  const body = await page.getByTestId('confirm-body').innerText();
  check(/^要対応の訪問が \d+件あります。/.test(body), '確定の確認：本文の先頭に要対応の訪問の件数', body);
  await page.getByTestId('confirm-cancel').click();
  await dialog(page).waitFor({ state: 'detached' });
  await page.screenshot({ path: path.join(OUT_DIR, 'reassign-none.png') });
  check((await undoBtn.getAttribute('aria-disabled')) !== 'true', '確定を取り消しても「元に戻す」は押せる');
  await undoBtn.focus();
  await page.keyboard.press('Enter');
  await waitStored(page, (d, b) => JSON.stringify(d.visits) === b, beforeKey);
  check(
    visitsKey(await stored(page)) === beforeKey,
    '操作の行の「元に戻す」（キーボード）：担当なしから元の担当へ戻る',
  );
  check((await focusedId(page)) === 'undo-btn', '戻したあともフォーカスは「元に戻す」に残る');
}

async function mobile(page) {
  await editData(page, (key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.setViewportSize({ width: 390, height: 844 });
  await openPlan(page);
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  check(scrollW <= 390, '390px：横にはみ出さない', scrollW);
  // 担当を変える（PRD D217）：390px の既定は日ごとのリスト（ADR-0055）。「その他 ▾」の「表示」で順番にすると、
  // カードを押すと詳細に出て、押して開ける・収まる
  await page.getByTestId('plan-more').click();
  await page.getByTestId('plan-view-order').click();
  await page.locator('.route-col:not(.route-col-none) .route-btn').first().click();
  await reBtn(page).waitFor({ timeout: 5000 });
  await reBtn(page).scrollIntoViewIfNeeded();
  const rb = await reBtn(page).boundingBox();
  check(rb && rb.x >= 0 && rb.x + rb.width <= 390, '390px：「担当を変える」が画面に収まる', rb);
  await reBtn(page).click();
  await reList(page).waitFor();
  await settle(page);
  const rl = await reList(page).boundingBox();
  const n = await reList(page).locator('[role="menuitem"]').count();
  check(rl && rl.x >= 0 && rl.x + rl.width <= 390 && n > 1, '390px：押して開け、一覧が画面の幅に収まる', { rl, n });
  check((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390, '390px：開いても横にはみ出さない');
  await page.screenshot({ path: path.join(OUT_DIR, 'mobile-reassign.png') });
  await page.keyboard.press('Escape');
  await page.goto(`${BASE}#/compare`);
  await page.getByTestId('compare-another').waitFor({ timeout: 10000 });
  const b = await page.getByTestId('compare-another-make').boundingBox();
  check(b && b.x >= 0 && b.x + b.width <= 390, '390px：「提案を作って比べる」が収まる', b);
  const scrollW2 = await page.evaluate(() => document.documentElement.scrollWidth);
  check(scrollW2 <= 390, '390px：比較の画面も横にはみ出さない', scrollW2);
  await page.getByTestId('compare-another').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT_DIR, 'mobile-compare.png') });
  await page.emulateMedia({ media: 'print' });
  check(!(await page.getByTestId('compare-another').isVisible()), '印刷：「提案を作って比べる」を出さない');
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 1400, height: 1000 });
}

// ---- 操作の行の「その他 ▾」（PRD D278・D279・D344。ADR-0045）：日の予定（たたまない）と月の予定 ----
async function moreMenus(page) {
  const focusedId = () => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
  await openPlan(page);
  // 日の予定：見せるのは欠勤・キャンセルを登録・元に戻す・表示・訪問を追加・使い方（その他 ▾ はスマホだけ。PRD D344。AI で組む ▾ は無い。ADR-0063）
  const shown = await page
    .getByTestId('schedule-toolbar')
    .locator('button:visible')
    .evaluateAll((els) => els.map((el) => el.textContent.trim()));
  check(
    shown.includes('欠勤・キャンセルを登録') &&
      !shown.includes('AI で組む') &&
      shown.includes('元に戻す') &&
      shown.includes('訪問を追加') &&
      shown.includes('使い方') &&
      !shown.includes('その他') &&
      !shown.includes('メールで送る'),
    '日の予定：操作の行は 欠勤・元に戻す・表示・訪問を追加・使い方（AI で組む ▾・その他 ▾ は無い）',
    shown,
  );
  // 操作の行は状態の1行（今の担当）のすぐ下（週・月と同じ位置。PRD D344）
  const order = await page.evaluate(() => {
    const sum = document.querySelector('[data-testid="plan-summary"]');
    const bar = document.querySelector('[data-testid="schedule-toolbar"]');
    return !!sum && !!bar && sum.nextElementSibling === bar;
  });
  check(order, '日の予定：操作の行は「今の担当」の1行のすぐ下');
  // 予定をメールで送るはナビの行の主ボタンの隣（毎日送るので見つけやすく。PRD D306・D347）
  const headMail = page.locator('[data-testid="sched-nav"] [data-testid="day-mail"]');
  check(
    (await headMail.count()) === 1 && (await headMail.innerText()).includes('予定をメールで送る'),
    '日の予定：ナビの行に「予定をメールで送る」（枠のボタン）',
  );
  check(
    (await page.locator('.btn-primary:visible').count()) === 1 &&
      (await page.locator('[data-testid="sched-nav"] [data-testid="adopt"]').count()) === 1,
    '日の予定：主ボタンはナビの行の「確定（伝えた）」の1つ',
  );
  const addBtn = page.getByTestId('plan-visit-add');
  await addBtn.focus();
  await page.keyboard.press('Enter');
  // 訪問の詳細の欄の新規の形（PRD D301）
  const form = page.getByTestId('visit-panel');
  await form.waitFor();
  check(
    (await form.getAttribute('data-new')) === 'true' && (await focusedId()) === 'vp-client',
    '「訪問を追加」で訪問の詳細の欄（新規）が開き、最初の欄へフォーカス',
  );
  await page.getByTestId('vp-close').click();
  await form.waitFor({ state: 'detached' });
  check(
    (await focusedId()) === 'plan-visit-add',
    '訪問の入力を閉じるとフォーカスは「訪問を追加」へ戻る',
    await focusedId(),
  );
  // 使い方：操作の行の下に開き、フォーカスを移す
  await page.getByTestId('plan-help-btn').click();
  const help = page.getByTestId('plan-help');
  await help.waitFor();
  check(
    (await focusedId()) === 'plan-help' && (await help.innerText()).includes('ピン'),
    '「使い方」で操作の行の下に説明が開き、フォーカスが移る',
  );
  await help.getByRole('button', { name: '使い方を閉じる' }).click();
  await help.waitFor({ state: 'detached' });
  check(true, '「使い方を閉じる」で閉じる');

  // 〈利用者さん〉が0人なら「訪問を追加」は押せず理由
  await page.evaluate((k) => {
    const d = JSON.parse(localStorage.getItem(k));
    d.clients = [];
    localStorage.setItem(k, JSON.stringify(d));
  }, STORAGE_KEY);
  await page.goto(`${BASE}#/plan`);
  await page.reload();
  await page.getByTestId('plan-visit-add').waitFor({ timeout: 30000 });
  await settle(page, 300);
  const add = page.getByTestId('plan-visit-add');
  check(
    (await add.getAttribute('aria-disabled')) === 'true' && /いません/.test((await add.getAttribute('title')) ?? ''),
    '〈利用者さん〉が0人なら「訪問を追加」は押せず理由',
    await add.getAttribute('title'),
  );
  // aria-disabled（フォーカスは残す）なので、押しても何もしないことを確かめる
  await add.click({ force: true });
  await settle(page, 200);
  check((await page.getByTestId('visit-panel').count()) === 0, '押せない「訪問を追加」を押しても欄は開かない');
  await page.keyboard.press('Escape');

  // 月の予定：月送り・今日はナビの行（PRD D347）、操作の欄は その他 ▾ だけ（印刷・勤務の見込み・表示の選択・説明はたたむ）。初期データに戻して開く
  await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
  await page.goto(`${BASE}#/month`);
  await page.reload();
  await page.getByTestId('month-more').waitFor({ timeout: 30000 });
  await settle(page, 300);
  const nav = await page
    .getByTestId('sched-nav')
    .locator('button:visible')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? el.textContent.trim()));
  const head = await page
    .locator('.month-head button:visible, .month-head select:visible')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? el.textContent.trim()));
  const bar = await page
    .getByTestId('schedule-toolbar')
    .locator('button:visible, a:visible')
    .evaluateAll((els) => els.map((el) => el.textContent.trim()));
  check(
    nav.includes('前の月') &&
      nav.includes('次の月') &&
      nav.includes('今日') &&
      !head.includes('前の月') &&
      !head.includes('今月') &&
      bar.includes('その他') &&
      !head.some((x) => /印刷|勤務の見込み|全体/.test(x)) &&
      !bar.some((x) => /印刷|勤務の見込み/.test(x)) &&
      (await page.getByTestId('month-focus').count()) === 0,
    '月の予定：月送り・今日はナビの行、操作の行の「その他 ▾」（表示の選択・印刷・勤務の見込み はたたむ。PRD D327・D347）',
    { nav, head, bar },
  );
  await page.getByTestId('month-more').click();
  const mItems = await page
    .getByTestId('month-more-list')
    .locator('[role="menuitem"] .menu-item-label')
    .allInnerTexts();
  check(
    mItems.length === 4 &&
      /^表示を選ぶ/.test(mItems[0]) &&
      mItems[1] === '印刷' &&
      mItems[2] === '勤務の見込み' &&
      mItems[3] === 'マスの見方の説明',
    '月の予定の「その他 ▾」：表示を選ぶ・印刷・勤務の見込み・マスの見方の説明',
    mItems,
  );
  await page.getByTestId('month-more-help').click();
  await page.getByTestId('month-help').waitFor();
  check((await focusedId()) === 'month-help', '「マスの見方の説明」で説明が開き、フォーカスが移る');
  await page.getByTestId('month-more').click();
  await page.getByTestId('month-more-pickers').click();
  await page.getByTestId('month-focus').waitFor();
  check((await focusedId()) === 'month-focus', '「表示を選ぶ」で表示の選択が開き、フォーカスは表示の欄');
  const sid = await page.getByTestId('month-focus').locator('option[value^="staff:"]').first().getAttribute('value');
  await page.getByTestId('month-focus').selectOption(sid);
  await settle(page, 300);
  await page.getByTestId('month-more').click();
  const pk = page.getByTestId('month-more-pickers');
  check(
    (await pk.innerText()).includes('表示の選択をたたむ') && (await pk.getAttribute('aria-disabled')) === 'true',
    '〈スタッフ〉を選んでいる間は表示の選択をたためない（押せず理由）',
    await pk.getAttribute('title'),
  );
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(OUT_DIR, 'month-more.png') });
  // ?staff= で開いて（段はたたまず出ている）、段の中で〈利用者さん〉・全体へ選び直しても段は出したまま・フォーカスは欄のまま（PRD D278）
  await page.goto(`${BASE}#/month?staff=${encodeURIComponent(sid.slice('staff:'.length))}`);
  await page.reload();
  const focusSel = page.getByTestId('month-focus');
  await focusSel.waitFor({ timeout: 30000 });
  await settle(page, 300);
  await focusSel.focus();
  await focusSel.selectOption('client');
  await settle(page, 300);
  check(
    (await page.getByTestId('month-pickers').count()) === 1 && (await focusedId()) === 'month-focus',
    '?staff= から〈利用者さん〉へ選び直しても段は出したまま・フォーカスは表示の欄（BODY に落とさない）',
    await focusedId(),
  );
  await focusSel.selectOption('all');
  await settle(page, 300);
  check(
    (await page.getByTestId('month-pickers').count()) === 1 && (await focusedId()) === 'month-focus',
    '全体へ選び直しても段は出したまま・フォーカスは表示の欄',
    await focusedId(),
  );
  await page.getByTestId('month-more').click();
  const pk2 = page.getByTestId('month-more-pickers');
  check(
    (await pk2.innerText()).includes('表示の選択をたたむ') && (await pk2.getAttribute('aria-disabled')) === null,
    '全体に戻したら「表示の選択をたたむ」でたためる',
  );
  await pk2.click();
  await settle(page, 200);
  check((await page.getByTestId('month-pickers').count()) === 0, '「表示の選択をたたむ」で段をたたむ');
}

const steps = sharedPage({
  open: async () => {
    const s = await openPage();
    // 確認は独自のダイアログ。ブラウザのダイアログ（confirm・alert・prompt）が出たら失敗（PRD D146）
    const native = [];
    s.page.on('dialog', (d) => {
      if (d.type() === 'beforeunload') {
        d.accept();
        return;
      }
      native.push(`${d.type()}: ${d.message()}`);
      d.dismiss();
    });
    return { ...s, native };
  },
  steps: [
    ['compare', compare],
    ['reassign-menu', reassignMenu],
    ['more-menus', moreMenus],
    ['mobile', mobile],
  ],
  after: ({ native }) => check(native.length === 0, 'ブラウザのダイアログを出さない', native),
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
