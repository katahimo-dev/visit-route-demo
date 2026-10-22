// 日の画面の「AI で組む ▾」（版2：AI は提案を出し、当てるまで担当を変えない。ADR-0053。PRD D156〜D159）を本物のブラウザで確かめる：
// 項目の並び（AI で組む（提案を出す）／プリセットを当ててみる／比べる／そのほか の4つのまとまり。role="group"・aria-label）、
// 各項目の1行の説明（aria-describedby）、ピンが無いときの押せない理由（見える文と aria-disabled。押しても何もしない）、
// キーボード（開くと先頭・↑↓・Home・End・Esc でボタンへ戻る・↑で開くと最後・Tab で閉じる）、
// 提案（「AI で組む」で提案の帯が出て、当てるまで訪問は変わらない・「当てる」で訪問に担当を書き、トーストと操作の行の「元に戻す」で1手戻る・
// 「やめる」で何も変えない・プリセットを当ててみると帯にその名前）、「プリセットの提案を比べる」で比較の画面へ・その場で提案を作って並べる（保存しない）。
// 訪問の詳細の「担当を変える ▾」（PRD D217〜D219。ADR-0030）：まとまりと項目（role="menuitem"・説明・今の担当・押せない理由・
// 「担当なしにする」）、キーボード（Enter で開いて ↓・Enter）で移すと担当が変わりピン、トーストの「元に戻す」で担当・ピンが戻る、
// 「担当なしにする」のあとの確定の確認の本文の先頭に要対応の件数、操作の行の「元に戻す」（キーボード）、390px で押せて収まる。
// 操作の行の「その他 ▾」（PRD D278・D279。ADR-0045）：日の予定は訪問を追加・使い方をたたむ（メールで送るは見出し。PRD D306）（キーボードで開いて訪問の入力・
// 閉じるとフォーカスは「その他」・使い方は下に開いてフォーカス）、月の予定は表示を選ぶ・印刷・勤務の見込み・マスの見方の説明を
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

/** 訪問の担当（版2：保存した訪問は staffId、計算した繰り返しの回は繰り返しの担当）とピン */
function staffOf(d, vid) {
  const own = d.visits.find((v) => v.id === vid);
  if (own) return { staffId: own.staffId, pinned: !!own.pinned };
  const p = d.patterns.find((x) => vid.endsWith(`_${x.id}`));
  return { staffId: p?.usualStaffId ?? null, pinned: false };
}
const visitsKey = (d) => JSON.stringify(d.visits);

// ---- 並び・説明・押せない理由・キーボード ----
async function plain(page) {
  await editData(page, (key) => localStorage.removeItem(key), STORAGE_KEY);
  await openPlan(page);
  const data = await stored(page);
  const btn = menuBtn(page);
  check((await btn.getAttribute('aria-haspopup')) === 'menu', 'ボタン：aria-haspopup="menu"');
  check((await btn.innerText()).includes('AI で組む'), 'ボタンの名前は「AI で組む」', await btn.innerText());
  await btn.click();
  await menuList(page).waitFor();
  const s = await menuShape(page);
  check(s.role === 'menu', '一覧：role="menu"');
  check(
    JSON.stringify(s.groups.map((g) => g.label)) ===
      JSON.stringify(['AI で組む（範囲）', 'プリセットを当ててみる', '比べる', 'そのほか']),
    '並び：目的の4つのまとまり（先頭は範囲＝日・週・月で同じ。見出しは role="group" の aria-label）',
    s.groups,
  );
  const keys = s.items.map((x) => x.key);
  check(
    JSON.stringify(keys.slice(0, 3)) === JSON.stringify(['scope-day', 'scope-week', 'scope-month']) &&
      keys.slice(3, -2).every((k) => k.startsWith('preset-')) &&
      keys.slice(3, -2).length === data.presets.length - 1 &&
      JSON.stringify(keys.slice(-2)) === JSON.stringify(['compare', 'unpin']),
    '並び：この日・この週・この月→ほかのプリセット（点数の基準のほか）→比べる→ピンを外す',
    keys,
  );
  check(
    /^この日（\d+\/\d+）を組む$/.test(item(s, 'scope-day')?.name ?? '') &&
      /^この週（\d+\/\d+〜\d+\/\d+）を組む$/.test(item(s, 'scope-week')?.name ?? '') &&
      /^この月（\d+月）を組む$/.test(item(s, 'scope-month')?.name ?? ''),
    '名前：「この日（M/D）を組む」「この週（M/D〜M/D）を組む」「この月（N月）を組む」',
    [item(s, 'scope-day'), item(s, 'scope-week'), item(s, 'scope-month')],
  );
  check(
    s.items.filter((x) => x.key.startsWith('preset-')).every((x) => /^「.+」で組む$/.test(x.name)),
    '名前：プリセットは「「名前」で組む」',
  );
  check(item(s, 'compare')?.name === '2つの提案を比べる', '名前：「2つの提案を比べる」');
  check(
    s.items.every((x) => x.desc.length > 0 && x.visibleDesc.length > 0) || item(s, 'unpin')?.disabled,
    'どの項目にも1行の説明（見える文と aria-describedby）',
    s.items.filter((x) => !x.desc).map((x) => x.key),
  );
  check(
    /当てるまで担当は変わりません/.test(item(s, 'scope-day')?.desc ?? ''),
    '説明：提案を出す（当てるまで担当は変わらない）',
    item(s, 'scope-day')?.desc,
  );
  const pins = data.visits.filter((v) => v.date === TODAY && v.pinned).length;
  if (pins === 0)
    check(
      item(s, 'unpin')?.disabled && /ピンの付いた訪問はありません/.test(item(s, 'unpin')?.visibleDesc ?? ''),
      'ピンが無い：「ピンをすべて外す」は押せず、理由を見える文で',
      item(s, 'unpin'),
    );
  await page.screenshot({ path: path.join(OUT_DIR, 'menu-plain.png') });
  // キーボード：開くと先頭・↓・End・Home・Esc でボタンへ
  check((await focusedId(page)) === 'ai-scope-day', 'キーボード：開くと先頭の項目へフォーカス', await focusedId(page));
  await page.keyboard.press('ArrowDown');
  check((await focusedId(page)) === 'ai-scope-week', 'キーボード：↓で次', await focusedId(page));
  await page.keyboard.press('End');
  check((await focusedId(page)) === 'plan-menu-unpin', 'キーボード：End で最後（押せない項目にも移る）');
  await page.keyboard.press('ArrowDown');
  check((await focusedId(page)) === 'ai-scope-day', 'キーボード：最後から↓で先頭へ回る');
  await page.keyboard.press('Home');
  check((await focusedId(page)) === 'ai-scope-day', 'キーボード：Home で先頭');
  if (pins === 0) {
    // 押せない項目は押しても何もしない（一覧も閉じない・確認も出ない）
    await page.getByTestId('plan-menu-unpin').click({ force: true });
    await settle(page);
    check(
      (await menuList(page).isVisible()) && (await dialog(page).count()) === 0,
      '押せない項目を押しても何もしない（閉じない・確認を出さない）',
    );
  }
  await page.getByTestId('plan-menu-unpin').focus();
  await page.keyboard.press('Escape');
  await menuList(page).waitFor({ state: 'detached' });
  check((await focusedId(page)) === 'plan-menu', 'キーボード：Esc で閉じてボタンへ戻る');
  check((await btn.getAttribute('aria-expanded')) === 'false', 'ボタン：閉じたら aria-expanded="false"');
  await page.keyboard.press('ArrowUp');
  await menuList(page).waitFor();
  check((await focusedId(page)) === 'plan-menu-unpin', 'キーボード：ボタンで↑を押すと最後の項目から開く');
  await page.keyboard.press('Tab');
  await menuList(page).waitFor({ state: 'detached' });
  check(true, 'キーボード：Tab で閉じる');
}

/** 「AI で組む ▾」の項目を押して、提案の帯が出るまで待つ */
async function proposeWith(page, testId, nth = 0) {
  await menuBtn(page).click();
  await menuList(page).waitFor();
  await page.getByTestId(testId).nth(nth).click();
  await page.getByTestId('proposal-band').waitFor({ timeout: 90000 });
  await page.getByTestId('plan-progress').waitFor({ state: 'detached', timeout: 90000 });
  await settle(page, 300);
}

// ---- 提案：出す → 当てるまで変わらない → 当てる → 元に戻す（1手）・やめる・プリセット ----
async function proposal(page) {
  await editData(page, (key) => localStorage.removeItem(key), STORAGE_KEY);
  // 今日の担当のある訪問1件を担当なしにしておく（提案はそれに担当を入れるので、当てると訪問が変わる）
  await openPlan(page);
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
  await proposeWith(page, 'ai-scope-day');
  const band = page.getByTestId('proposal-band');
  check(
    (await band.innerText()).includes('件') && (await page.getByTestId('proposal-apply').isEnabled()),
    '提案の帯：変わる件数と「当てる」',
    await band.innerText(),
  );
  check(visitsKey(await stored(page)) === before, '提案を出しただけでは訪問は変わらない（保存しない）');
  await page.screenshot({ path: path.join(OUT_DIR, 'proposal-band.png') });
  // やめる：何も変えずに帯が消える
  await page.getByTestId('proposal-discard').click();
  await band.waitFor({ state: 'detached', timeout: 5000 });
  check(visitsKey(await stored(page)) === before, '「やめる」で帯が消え、訪問は変わらない');
  // もう一度出して当てる
  await proposeWith(page, 'ai-scope-day');
  const moved = Number(await page.getByTestId('proposal-moved').innerText());
  await page.getByTestId('proposal-apply').click();
  await band.waitFor({ state: 'detached', timeout: 5000 });
  await page.locator('.toast').filter({ hasText: '提案を当てました' }).waitFor({ timeout: 5000 });
  check(true, '「当てる」で知らせ「提案を当てました」');
  await waitStored(page, (d, b) => JSON.stringify(d.visits) !== b, before);
  const applied = await stored(page);
  check(visitsKey(applied) !== before, '「当てる」で訪問に担当・開始を書く', {
    moved,
    saved: applied.visits.length,
  });
  // 操作の行の「元に戻す」で1手戻る（当てる前の訪問）
  const undoBtn = page.getByTestId('undo-btn');
  check((await undoBtn.getAttribute('aria-disabled')) !== 'true', '当てたあとは「元に戻す」を押せる');
  await undoBtn.click();
  await waitStored(page, (d, b) => JSON.stringify(d.visits) === b, before);
  check(visitsKey(await stored(page)) === before, '「元に戻す」で当てる前の訪問に戻る');
  check(
    (await undoBtn.getAttribute('aria-disabled')) === 'true' && (await page.getByTestId('redo-btn').count()) === 1,
    '戻したあとは（ほかに戻せる手が無いので）「元に戻す」を押せず、「やり直す」が出る',
  );
  // プリセットを当ててみる：帯にその名前
  const presets = await (async () => {
    await menuBtn(page).click();
    await menuList(page).waitFor();
    const n = await page.getByTestId('plan-menu-preset').count();
    const name = n > 0 ? await page.getByTestId('plan-menu-preset').first().innerText() : '';
    await page.keyboard.press('Escape');
    return { n, name };
  })();
  if (presets.n > 0) {
    await proposeWith(page, 'plan-menu-preset');
    const name = /「(.+)」/.exec(presets.name)?.[1] ?? '';
    check(name !== '' && (await band.innerText()).includes(name), 'プリセットを当ててみる：提案の帯にその名前', {
      name,
      band: await band.innerText(),
    });
    check(visitsKey(await stored(page)) === before, 'プリセットの提案も、当てるまで訪問は変えない');
    await page.getByTestId('proposal-discard').click();
  }
}

// ---- 「プリセットの提案を比べる」→ 比較の画面でその場で提案を作って並べる（保存しない） ----
async function compare(page) {
  await editData(page, (key) => localStorage.removeItem(key), STORAGE_KEY);
  await openPlan(page);
  // 今日の担当のある訪問1件を担当なしにしておく（提案はそれに担当を入れるので、当てると訪問が変わる）
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
  await menuBtn(page).click();
  await menuList(page).waitFor();
  await page.getByTestId('plan-menu-compare').click();
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
  check(n1 === n0 + 1, '「提案を作って比べる」で提案が1つ増え、当てるボタンが出る', { n0, n1 });
  check(visitsKey(await stored(page)) === before, '比較の提案は保存しない（訪問は変わらない）');
  await page.screenshot({ path: path.join(OUT_DIR, 'compare-proposal.png') });
  // 当てる → トーストの「元に戻す」で当てる前に戻る（日の予定と同じ控え。PR #80 のレビュー）
  await page.getByTestId('compare-apply').last().click();
  await page.getByTestId('toast-undo').waitFor({ timeout: 5000 });
  await waitStored(page, (d, b) => JSON.stringify(d.visits) !== b, before);
  const applied = visitsKey(await stored(page));
  await page.getByTestId('toast-undo').click();
  await waitStored(page, (d, b) => JSON.stringify(d.visits) === b, before);
  check(
    applied !== before && visitsKey(await stored(page)) === before,
    '比較の画面で当てると訪問が変わり、トーストの「元に戻す」で1手戻せる',
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
  // 担当を変える（PRD D217）：390px は順番の表示。カードを押すと詳細に出て、押して開ける・収まる
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

// ---- 操作の行の「その他 ▾」（PRD D278・D279。ADR-0045）：日の予定と月の予定 ----
async function moreMenus(page) {
  const focusedId = () => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
  await openPlan(page);
  // 日の予定：見せるのは欠勤・キャンセルを登録・AI で組む ▾・元に戻す・表示・その他 ▾
  const shown = await page
    .getByTestId('schedule-toolbar')
    .locator('button:visible')
    .evaluateAll((els) => els.map((el) => el.textContent.trim()));
  check(
    shown.includes('欠勤・キャンセルを登録') &&
      shown.includes('AI で組む') &&
      shown.includes('元に戻す') &&
      shown.includes('その他') &&
      !shown.includes('訪問を追加') &&
      !shown.includes('メールで送る') &&
      !shown.includes('使い方'),
    '日の予定：操作の行は 欠勤・AI で組む ▾・元に戻す・表示・その他 ▾（訪問を追加・使い方はたたむ）',
    shown,
  );
  // 予定をメールで送るは見出しの主ボタンの隣（毎日送るので見つけやすく。PRD D306）
  const headMail = page.locator('.page-head [data-testid="day-mail"]');
  check(
    (await headMail.count()) === 1 && (await headMail.innerText()).includes('予定をメールで送る'),
    '日の予定：見出しに「予定をメールで送る」（枠のボタン）',
  );
  check(
    (await page.locator('.btn-primary:visible').count()) === 1,
    '日の予定：主ボタンは見出しの「確定（伝えた）」の1つ',
  );
  const more = page.getByTestId('plan-more');
  await more.focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('plan-more-list').waitFor();
  const items = await page.getByTestId('plan-more-list').locator('[role="menuitem"] .menu-item-label').allInnerTexts();
  check(
    JSON.stringify(items) === JSON.stringify(['訪問を追加', '使い方']),
    '日の予定の「その他 ▾」：訪問を追加・使い方',
    items,
  );
  check((await focusedId()) === 'plan-visit-add', '「その他 ▾」を Enter で開くとフォーカスは先頭の項目');
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
  check((await focusedId()) === 'plan-more', '訪問の入力を閉じるとフォーカスは「その他」へ戻る', await focusedId());
  // 使い方：操作の行の下に開き、フォーカスを移す
  await more.click();
  await page.getByTestId('plan-more-help').click();
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
  await page.getByTestId('plan-more').waitFor({ timeout: 30000 });
  await settle(page, 300);
  await page.getByTestId('plan-more').click();
  const add = page.getByTestId('plan-visit-add');
  check(
    (await add.getAttribute('aria-disabled')) === 'true' && /いません/.test((await add.getAttribute('title')) ?? ''),
    '「その他 ▾」：〈利用者さん〉が0人なら「訪問を追加」は押せず理由',
    await add.getAttribute('title'),
  );
  // aria-disabled（フォーカスは残す）なので、押しても何もしないことを確かめる
  await add.click({ force: true });
  await settle(page, 200);
  check((await page.getByTestId('visit-panel').count()) === 0, '押せない「訪問を追加」を押しても欄は開かない');
  await page.keyboard.press('Escape');

  // 月の予定：月送り・今月・その他 ▾ だけ（印刷・勤務の見込み・表示の選択・説明はたたむ）。初期データに戻して開く
  await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
  await page.goto(`${BASE}#/month`);
  await page.reload();
  await page.getByTestId('month-more').waitFor({ timeout: 30000 });
  await settle(page, 300);
  const head = await page
    .locator('.month-head button:visible, .month-head select:visible')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? el.textContent.trim()));
  const bar = await page
    .getByTestId('schedule-toolbar')
    .locator('button:visible, a:visible')
    .evaluateAll((els) => els.map((el) => el.textContent.trim()));
  check(
    head.includes('前の月') &&
      head.includes('次の月') &&
      head.includes('今月') &&
      bar.includes('その他') &&
      !head.some((x) => /印刷|勤務の見込み|全体/.test(x)) &&
      !bar.some((x) => /印刷|勤務の見込み/.test(x)) &&
      (await page.getByTestId('month-focus').count()) === 0,
    '月の予定：月送り・今月と、操作の行の「その他 ▾」（表示の選択・印刷・勤務の見込み はたたむ。PRD D327）',
    { head, bar },
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
    ['plain', plain],
    ['proposal', proposal],
    ['compare', compare],
    ['reassign-menu', reassignMenu],
    ['more-menus', moreMenus],
    ['mobile', mobile],
  ],
  after: ({ native }) => check(native.length === 0, 'ブラウザのダイアログを出さない', native),
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
