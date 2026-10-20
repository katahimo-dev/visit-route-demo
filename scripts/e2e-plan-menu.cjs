// 日の画面の「案を変える ▾」を目的の言葉で選べるようにしたこと（PRD D156〜D159。ADR-0025 追記）を本物のブラウザで確かめる：
// 項目の並び（AI に作らせる／別の考え方（プリセット）に切り替える／比べる・戻す／そのほか の4つのまとまり。role="group"・aria-label）、
// 各項目の1行の説明（aria-describedby）、手直し・固定が無いときの押せない理由（見える文と aria-disabled。押しても何もしない）、
// キーボード（開くと先頭・↑↓・Home・End・Esc でボタンへ戻る・↑で開くと最後・Tab で閉じる）、
// 手直し・固定があるとき（説明に「手直しと固定は消えます」、作り直すは独自の確認ダイアログで取り消せば何も変わらずフォーカスはボタンへ、
// 「AI が出したままに戻す」は確認して固定が消える）、「2つの案を比べる」で比較の画面へ、案が1つの比較の画面の「もう1案作って比べる」
// （今ある案と同じ考え方は選択肢に出ない・作ると記録が2件で A＝今ある案・B＝作った案・今の案は変わらない）、
// プリセットが1つだけのときの作れない理由、390px で一覧と「もう1案作って比べる」が画面に収まる、ブラウザの確認を出さない。
// 訪問の詳細の「担当を変える ▾」（PRD D217〜D219。ADR-0030）：まとまりと項目（role="menuitem"・説明・今の担当・押せない理由・
// 「入らなかった訪問へ」）、キーボード（Enter で開いて ↓・Enter）で移すと担当が変わり固定、トーストの「元に戻す」で担当・順・固定が戻る、
// 「入らなかった訪問へ」のあとの確定の確認の本文の先頭に件数、操作の行の「元に戻す」（キーボード）、390px で押せて収まる。
// 手直しの記憶（PRD D260〜D262。ADR-0043）：手で動かすと帯で聞く（答える前は記憶しない）・次からも→来週の割当済みもまとめて変える・
// 「元に戻す」で全部戻る・別の週の同じ曜日で作り直すと同じ人と「記憶」の印・データの画面の件数と［すべて消す］。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-plan-menu.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { skipTour } = require('./lib/tourSeen.cjs');
const {
  launch,
  BASE,
  OUT_DIR,
  NOW,
  TODAY,
  STORAGE_KEY,
  check,
  settle,
  hashOf,
  stored,
  failShot,
  run,
} = require('./lib/env.cjs');

/** 保存（少し遅れて書く）が条件を満たすまで待つ（満たさなければ時間切れで続ける） */
async function waitStored(page, pred, arg, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const d = await stored(page);
    if (d && pred(d, arg)) return;
    await page.waitForTimeout(100);
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
    '並び：作らせる→固定した訪問は残す→考え方→まとめて作る→比べる→戻す→コピー→条件',
    keys,
  );
  check(item(s, 'create')?.name === 'AI にもう一度作らせる', '名前：「AI にもう一度作らせる」', item(s, 'create'));
  check(
    item(s, 'resolve')?.name === '固定した訪問は残して、ほかを作り直す',
    '名前：「固定した訪問は残して、ほかを作り直す」',
  );
  check(/^2つの案を比べる/.test(item(s, 'compare')?.name ?? ''), '名前：「2つの案を比べる」（件数つき）');
  check(item(s, 'revert')?.name === 'AI が出したままに戻す', '名前：「AI が出したままに戻す」');
  check(
    s.items.every((x) => x.desc.length > 0 && x.visibleDesc.length > 0),
    'どの項目にも1行の説明（見える文と aria-describedby）',
    s.items.filter((x) => !x.desc).map((x) => x.key),
  );
  check(
    !/消えます/.test(item(s, 'create')?.desc ?? '') && /この日だけ試す重み（標準）/.test(item(s, 'create')?.desc ?? ''),
    '説明：手直しが無いときは「消えます」を書かない・今の条件の名前',
    item(s, 'create')?.desc,
  );
  check(
    !item(s, 'resolve')?.disabled &&
      /固定がありません。AI が出したままの案（戻す先）は残して/.test(item(s, 'resolve')?.visibleDesc ?? ''),
    '固定が無い：「固定した訪問は残して…」も押せて、戻す先を残すと書く（PR #39 のレビュー）',
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
    !item(s, 'resolve')?.disabled &&
      /固定した 1件の担当はそのまま/.test(item(s, 'resolve')?.desc ?? '') &&
      !/消えます/.test(item(s, 'resolve')?.desc ?? ''),
    '固定あり：「固定した訪問は残して…」は押せて、固定の件数を書く（固定していない手直しは無いので「消えます」を書かない）',
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
  check(
    item(s2, 'revert')?.disabled && !item(s2, 'resolve')?.disabled,
    '戻したあと：戻すは押せない（固定した訪問は残して…は押せる）',
  );
  await page.keyboard.press('Escape');
}

// ---- 固定していない手直し（「入らなかった訪問」へ移した）があるとき：固定した訪問は残して…は確かめる（PR #39 のレビュー） ----
async function unpinnedEdit(page) {
  await editData(page, (key) => localStorage.removeItem(key), STORAGE_KEY);
  await openPlan(page);
  // 担当の列の最初の訪問を「入らなかった訪問」へ移す（日の画面の unassign と同じ書き換え：列から外し、固定も外す。
  // ドラッグそのものは e2e-drag で確かめる）
  await editData(
    page,
    ([key, date]) => {
      const d = JSON.parse(localStorage.getItem(key));
      const plan = d.aiPlans[date];
      const [sid, ids] = Object.entries(plan.routes).find(([s, v]) => s !== '__none' && v.length > 0);
      const id = ids[0];
      plan.routes[sid] = ids.slice(1);
      delete plan.pins[id];
      localStorage.setItem(key, JSON.stringify(d));
      localStorage.setItem('e2e-plan-menu-vid', id);
    },
    [STORAGE_KEY, TODAY],
  );
  const vid = await page.evaluate(() => localStorage.getItem('e2e-plan-menu-vid'));
  await openPlan(page);
  const before = (await stored(page)).aiPlans[TODAY];
  check(
    !Object.values(before.routes).some((ids) => ids.includes(vid)) && !before.pins[vid],
    '手直し：訪問を「入らなかった訪問」へ移した（固定は付かない）',
    vid,
  );
  await menuBtn(page).click();
  await menuList(page).waitFor();
  const s = await menuShape(page);
  check(
    !item(s, 'resolve')?.disabled && /固定していない手直しは消えます/.test(item(s, 'resolve')?.desc ?? ''),
    '固定していない手直しあり：説明に「固定していない手直しは消えます」',
    item(s, 'resolve')?.desc,
  );
  await page.getByTestId('plan-menu-resolve').click();
  await dialog(page).waitFor({ timeout: 5000 });
  const title = await page.getByTestId('confirm-title').innerText();
  check(/固定していない手直しを捨てて/.test(title), '固定した訪問は残して…：確認ダイアログを出す', title);
  await page.getByTestId('confirm-cancel').click();
  await dialog(page).waitFor({ state: 'detached' });
  await settle(page, 600);
  const after = (await stored(page)).aiPlans[TODAY];
  check(
    JSON.stringify(after.routes) === JSON.stringify(before.routes) && after.createdAt === before.createdAt,
    '取り消すと何も変わらない（移した訪問は入らなかった訪問のまま）',
  );
  check((await page.getByTestId('plan-progress').count()) === 0, '取り消すと計算を始めない');
  check((await focusedId(page)) === 'plan-menu', '閉じたらフォーカスは「案を変える」へ', await focusedId(page));
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
    '日の予定：比べるの説明が「この日に作った案（2件）」に',
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

// ---- 担当を変える ▾・元に戻す・確定の確認の件数（PRD D217〜D219。ADR-0030） ----
const reBtn = (page) => page.getByTestId('plan-reassign');
const reList = (page) => page.getByTestId('plan-reassign-list');
/** routes の形（担当の並び・空の列に左右されない） */
const routesKey = (routes) =>
  JSON.stringify(
    Object.keys(routes)
      .filter((k) => routes[k].length > 0)
      .sort()
      .map((k) => [k, routes[k]]),
  );
const ownerOf = (plan, vid) => Object.entries(plan.routes).find(([, ids]) => ids.includes(vid))?.[0] ?? null;
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
  const before = (await stored(page)).aiPlans[TODAY];
  // 時間軸の担当の列の最初の帯を押して詳細を開く
  const band = page.locator('.route-col:not(.route-col-none) .tl-band').first();
  const vid = await band.getAttribute('data-visit');
  const from = ownerOf(before, vid);
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
  check(
    others.filter((x) => !x.disabled).every((x) => /時間の約束|件数の上限|必須の違反/.test(x.desc)),
    '担当を変える：説明に時間の約束（✓／✗）か件数の上限',
  );
  const firstOff = others.findIndex((x) => x.disabled);
  check(
    firstOff < 0 || others.slice(firstOff).every((x) => x.disabled && /必須の条件に合いません/.test(x.desc)),
    '担当を変える：押せる人が先、必須の条件に合わない人は後ろで押せず理由を出す',
    others.filter((x) => x.disabled),
  );
  const last = s.items.at(-1);
  check(last?.key === 'none' && !last.disabled, '担当を変える：最後に「入らなかった訪問へ」', last);
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
  await waitStored(page, (d, [date, v, t]) => d.aiPlans[date].pins[v] === t, [TODAY, vid, to]);
  const moved = (await stored(page)).aiPlans[TODAY];
  check(
    ownerOf(moved, vid) === to && moved.pins[vid] === to,
    'Enter で選ぶと担当が変わり固定になる（ドラッグと同じ）',
    { from, to: ownerOf(moved, vid), pin: moved.pins[vid] },
  );
  await settle(page, 200);
  const f1 = await activeInfo(page);
  check(!f1.body && f1.visit === vid, '選んだあと：フォーカスは body に落ちず、移した先の訪問へ', f1);
  const toastUndo = page.getByTestId('plan-reassign-toast-undo');
  await toastUndo.waitFor({ timeout: 3000 });
  const toastText = await page.locator('.toast').innerText();
  check(
    /さんへ移しました/.test(toastText) && /元に戻す/.test(toastText),
    'トースト「〈名前〉さんへ移しました」と「元に戻す」',
    toastText,
  );
  check(
    (await page.locator('.toast output').innerText()).includes('さんへ移しました') &&
      !(await page.locator('.toast output').innerText()).includes('元に戻す'),
    'トースト：読み上げ（output）は文だけでボタンの名前を混ぜない',
  );
  const undoBtn = page.getByTestId('plan-reassign-undo');
  check((await undoBtn.getAttribute('aria-disabled')) !== 'true', '操作の行の「元に戻す」：移したあとは押せる');
  await page.screenshot({ path: path.join(OUT_DIR, 'reassign-moved.png') });
  // トーストの「元に戻す」で、担当・順・固定が移す前に戻る
  await toastUndo.click();
  await waitStored(page, (d, [date, v]) => !d.aiPlans[date].pins[v], [TODAY, vid]);
  const back = (await stored(page)).aiPlans[TODAY];
  check(
    routesKey(back.routes) === routesKey(before.routes) && JSON.stringify(back.pins) === JSON.stringify(before.pins),
    'トーストの「元に戻す」：担当・回る順・固定が移す前のとおりに戻る',
    { owner: ownerOf(back, vid), pins: back.pins },
  );
  await page.locator('.toast').filter({ hasText: '元に戻しました' }).waitFor({ timeout: 3000 });
  check(true, '戻すと知らせ「元に戻しました」');
  const f2 = await activeInfo(page);
  check(!f2.body && f2.visit === vid, 'トーストの「元に戻す」のあと：フォーカスは body に落ちず、戻した訪問へ', f2);
  check((await undoBtn.getAttribute('aria-disabled')) === 'true', '戻したあとは「元に戻す」を押せない（1手だけ）');

  // 「入らなかった訪問へ」→ 確定の確認に件数 → 取り消す → 操作の行の「元に戻す」
  const pick = page.locator(`.tl-band[data-visit="${vid}"] .tl-band-btn`);
  if (!(await reBtn(page).count())) await pick.click();
  await reBtn(page).click();
  await reList(page).waitFor();
  await page.getByTestId('plan-reassign-none').click();
  await waitStored(page, (d, [date, v]) => d.aiPlans[date].unassigned.includes(v), [TODAY, vid]);
  const none = (await stored(page)).aiPlans[TODAY];
  check(
    none.unassigned.includes(vid) && !none.pins[vid] && ownerOf(none, vid) === null,
    '「入らなかった訪問へ」：担当なしになり固定は付かない',
  );
  await settle(page, 200);
  const f3 = await activeInfo(page);
  check(
    !f3.body && f3.visit === vid,
    '「入らなかった訪問へ」のあと：フォーカスは body に落ちず、入らなかった訪問のカードへ',
    f3,
  );
  check(
    /入らなかった訪問へ移しました/.test(await page.locator('.toast').innerText()),
    '「入らなかった訪問へ」：トーストに「元に戻す」',
  );
  await page.getByTestId('adopt').click();
  await dialog(page).waitFor({ timeout: 5000 });
  const body = await page.getByTestId('confirm-body').innerText();
  check(
    body.startsWith(`入らない訪問が ${none.unassigned.length}件あります（担当なしのまま確定します）`),
    '確定の確認：本文の先頭に入らない訪問の件数',
    body,
  );
  await page.getByTestId('confirm-cancel').click();
  await dialog(page).waitFor({ state: 'detached' });
  await page.screenshot({ path: path.join(OUT_DIR, 'reassign-none.png') });
  check((await undoBtn.getAttribute('aria-disabled')) !== 'true', '確定を取り消しても「元に戻す」は押せる');
  await undoBtn.focus();
  await page.keyboard.press('Enter');
  await waitStored(page, (d, [date, v]) => !d.aiPlans[date].unassigned.includes(v), [TODAY, vid]);
  const back2 = (await stored(page)).aiPlans[TODAY];
  check(
    routesKey(back2.routes) === routesKey(before.routes) && JSON.stringify(back2.pins) === JSON.stringify(before.pins),
    '操作の行の「元に戻す」（キーボード）：入らなかった訪問から元の担当・順へ戻る',
  );
  check((await focusedId(page)) === 'plan-reassign-undo', '戻したあともフォーカスは「元に戻す」に残る');
  // 入らない訪問が無ければ件数の行は出さない
  if (back2.unassigned.length === 0) {
    await page.getByTestId('adopt').click();
    await dialog(page).waitFor({ timeout: 5000 });
    const body2 = await page.getByTestId('confirm-body').innerText();
    check(!/入らない訪問が/.test(body2), '確定の確認：入らない訪問が無ければ件数の行を出さない', body2);
    await page.keyboard.press('Escape');
    await dialog(page).waitFor({ state: 'detached' });
  }
  // 移したあとに確定したら、元に戻すは押せない（今の案だけ戻って確定した担当と食い違うため。PRD D218）
  if (!(await reBtn(page).count())) await pick.click();
  await reBtn(page).click();
  await reList(page).waitFor();
  await reList(page).locator(`[data-key="${target.key}"]`).click();
  await waitStored(page, (d, [date, v, t]) => d.aiPlans[date].pins[v] === t, [TODAY, vid, to]);
  check((await undoBtn.getAttribute('aria-disabled')) !== 'true', '確定の前：移したあとは「元に戻す」を押せる');
  await page.getByTestId('adopt').click();
  await dialog(page).waitFor({ timeout: 5000 });
  await page.getByTestId('confirm-ok').click();
  await dialog(page).waitFor({ state: 'detached' });
  await waitStored(page, (d, [date, v, t]) => (d.manualPlans[date]?.[t] ?? []).includes(v), [TODAY, vid, to]);
  await settle(page);
  check(
    (await undoBtn.getAttribute('aria-disabled')) === 'true' &&
      /戻せません/.test((await undoBtn.getAttribute('title')) ?? ''),
    '確定したあと：「元に戻す」は押せず、title に戻せない理由',
    await undoBtn.getAttribute('title'),
  );
}

// ---- 手直しの記憶（PRD D260〜D262。ADR-0043）：手で動かす→確認で次からも→来週分もまとめて変える→元に戻す、
// 別の週の同じ曜日で作り直すと同じ人 ----
const addDaysIso = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const prefKeyOf = (v) =>
  `${v.clientId}|${new Date(`${v.date}T00:00:00Z`).getUTCDay()}|${v.earliestStart}-${v.latestStart}|${v.typeId ?? ''}`;
/** その日の訪問の「担当を変える ▾」で押せる人（ID の一覧）。日の予定を開き直して読む */
async function enabledFor(page, date, vid) {
  // ?date= は読むと URL から消えるので、ホームを挟んでから開く（読み直さない）
  await page.goto(`${BASE}#/home`);
  await page.locator('h1').waitFor();
  await page.goto(`${BASE}#/plan?date=${date}`);
  await page.getByTestId('confirm-state').waitFor({ timeout: 60000 });
  await page.getByTestId('plan-progress').waitFor({ state: 'detached', timeout: 60000 });
  await settle(page, 300);
  await page.locator(`.tl-band[data-visit="${vid}"] .tl-band-btn`).click();
  await reBtn(page).waitFor({ timeout: 5000 });
  await reBtn(page).click();
  await reList(page).waitFor();
  const shape = await reassignShape(page);
  await page.keyboard.press('Escape');
  return shape.items.filter((x) => x.key.startsWith('to-') && !x.disabled).map((x) => x.key.slice(3));
}
async function manualPrefs(page) {
  const NEXT = addDaysIso(TODAY, 7);
  await editData(page, (key) => localStorage.removeItem(key), STORAGE_KEY);
  // 来週の同じ曜日の案を作っておく（開くと自動で作る）
  await page.goto(`${BASE}#/plan?date=${NEXT}`);
  await page.getByTestId('confirm-state').waitFor({ timeout: 60000 });
  await page.getByTestId('plan-progress').waitFor({ state: 'detached', timeout: 60000 });
  await waitStored(page, (d, date) => !!d.aiPlans[date], NEXT, 60000);
  await openPlan(page);
  const d0 = await stored(page);
  const plan0 = d0.aiPlans[TODAY];
  const next0 = d0.aiPlans[NEXT];
  check(!!next0, '記憶：来週の同じ曜日に今の案がある（準備）');
  // 来週に同じキーの訪問があり、来週も担当のいる訪問を選ぶ
  const pairs = d0.visits
    .filter((v) => v.date === TODAY && !v.cancelled && ownerOf(plan0, v.id))
    .map((v) => ({ v, w: d0.visits.find((x) => x.date === NEXT && !x.cancelled && prefKeyOf(x) === prefKeyOf(v)) }))
    .filter((x) => x.w && ownerOf(next0, x.w.id));
  check(pairs.length > 0, '記憶：今日と来週に同じ〈利用者さん〉・曜日・時間の訪問がある（準備）', pairs.length);
  // 今日も来週も押せる（可の）人で、今の担当でも来週の担当でもない人がいる組を選ぶ
  let chosen = null;
  for (const pair of pairs.slice(0, 6)) {
    const nextOk = await enabledFor(page, NEXT, pair.w.id);
    const todayOk = await enabledFor(page, TODAY, pair.v.id);
    const f = ownerOf(plan0, pair.v.id);
    const n = ownerOf(next0, pair.w.id);
    const t = todayOk.find((id) => id !== f && id !== n && nextOk.includes(id));
    if (t) {
      chosen = { ...pair, to: t };
      break;
    }
  }
  check(!!chosen, '記憶：移せる人がいる（準備）', pairs.length);
  check(!!chosen, '記憶：移す人は来週の同じ訪問も担当できる（準備。「担当を変える ▾」で押せる人）');
  const { v, w, to } = chosen;
  const from = ownerOf(plan0, v.id);
  const nextOwner = ownerOf(next0, w.id);
  const cand = { key: `to-${to}` };
  // 担当を変える ▾ で、今の担当でも来週の担当でもない押せる人へ移す（enabledFor のあと今日の日の予定が開いている）
  await page.locator(`.tl-band[data-visit="${v.id}"] .tl-band-btn`).click();
  if (!(await reBtn(page).count())) await page.locator(`.tl-band[data-visit="${v.id}"] .tl-band-btn`).click();
  await reBtn(page).waitFor({ timeout: 5000 });
  await reBtn(page).click();
  await reList(page).waitFor();
  await reList(page).locator(`[data-key="${cand.key}"]`).click();
  await waitStored(page, (d, [date, id, t]) => d.aiPlans[date].pins[id] === t, [TODAY, v.id, to]);
  await page.getByTestId('pref-ask').waitFor({ timeout: 5000 });
  const ask = await page.getByTestId('pref-ask-text').innerText();
  check(
    /^次からも .曜 .+ の.+様は.+さんにしますか？$/.test(ask),
    '記憶：手で変えると帯で「次からも…にしますか？」と聞く',
    ask,
  );
  check(
    Object.keys((await stored(page)).manualPrefs ?? {}).length === 0,
    '記憶：答える前は記憶しない（既定は今回だけ）',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'pref-ask.png') });
  await page.getByTestId('pref-ask-yes').click();
  await waitStored(page, (d, [k, t]) => d.manualPrefs?.[k]?.staffId === t, [prefKeyOf(v), to]);
  check(
    (await stored(page)).manualPrefs?.[prefKeyOf(v)]?.staffId === to,
    '記憶：「次からもこの人にする」で記憶に書く（〈利用者さん〉・曜日・時間・種類のキー）',
  );
  await page.getByTestId('pref-bulk').waitFor({ timeout: 5000 });
  const bulk = await page.getByTestId('pref-bulk-text').innerText();
  const nd = `${Number(NEXT.slice(5, 7))}/${Number(NEXT.slice(8, 10))}`;
  check(
    /来週以降の.+件（.+）も.+に変えますか？/.test(bulk) && bulk.includes(nd),
    '記憶：来週以降の割当済みの件数と日付を出して聞く',
    bulk,
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'pref-bulk.png') });
  await page.getByTestId('pref-bulk-yes').click();
  await waitStored(page, (d, [date, id]) => !!d.aiPlans[date].pins[id], [NEXT, w.id]);
  const d1 = await stored(page);
  const changed = ownerOf(d1.aiPlans[NEXT], w.id) === to && d1.aiPlans[NEXT].pins[w.id] === to;
  const failedShown = (await page.getByTestId('pref-bulk-result').count()) > 0;
  check(changed && !failedShown, '記憶：まとめて変えると来週の今の案も同じ人で固定（担当できない日は知らせる）', {
    owner: ownerOf(d1.aiPlans[NEXT], w.id),
    to,
  });
  // 元に戻す（1手）：今日の手直し・記憶・来週の案が一緒に戻る
  const undoBtn = page.getByTestId('plan-reassign-undo');
  check((await undoBtn.getAttribute('aria-disabled')) !== 'true', '記憶：まとめて変えたあとも「元に戻す」を押せる');
  await undoBtn.click();
  await waitStored(page, (d, k) => !d.manualPrefs?.[k], prefKeyOf(v));
  const d2 = await stored(page);
  check(
    !d2.manualPrefs?.[prefKeyOf(v)] &&
      ownerOf(d2.aiPlans[TODAY], v.id) === from &&
      ownerOf(d2.aiPlans[NEXT], w.id) === nextOwner &&
      !d2.aiPlans[NEXT].pins[w.id],
    '記憶：「元に戻す」で今日の担当・記憶・来週の案が一緒に戻る',
  );
  // もう一度移して記憶だけ書き（来週は変えない）、来週の日で作り直すと同じ人になる
  await page.locator(`.tl-band[data-visit="${v.id}"] .tl-band-btn`).click();
  if (!(await reBtn(page).count())) await page.locator(`.tl-band[data-visit="${v.id}"] .tl-band-btn`).click();
  await reBtn(page).click();
  await reList(page).waitFor();
  await reList(page).locator(`[data-key="${cand.key}"]`).click();
  await page.getByTestId('pref-ask-yes').click();
  await page.getByTestId('pref-bulk-no').click();
  await waitStored(page, (d, [k, t]) => d.manualPrefs?.[k]?.staffId === t, [prefKeyOf(v), to]);
  check(ownerOf((await stored(page)).aiPlans[NEXT], w.id) === nextOwner, '記憶：「変えない」なら来週の案は変えない');
  await page.goto(`${BASE}#/plan?date=${NEXT}`);
  await page.getByTestId('confirm-state').waitFor({ timeout: 60000 });
  await menuBtn(page).click();
  await menuList(page).waitFor();
  await page.getByTestId('plan-menu-create').click();
  if (await dialog(page).count()) await page.getByTestId('confirm-ok').click();
  await page
    .getByTestId('plan-progress')
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  await waitStored(
    page,
    (d, [date, id, t]) =>
      Object.values(d.aiPlans[date].routes).some((ids) => ids.includes(id)) && d.aiPlans[date].routes[t]?.includes(id),
    [NEXT, w.id, to],
    60000,
  );
  await page.getByTestId('plan-progress').waitFor({ state: 'detached', timeout: 60000 });
  await settle(page, 300);
  const d3 = await stored(page);
  const run = d3.aiRuns[NEXT].find((r) => r.id === d3.aiPlans[NEXT].runId);
  check(
    ownerOf(d3.aiPlans[NEXT], w.id) === to && run?.prefPins?.[w.id] === to,
    '記憶：別の週の同じ曜日で作り直すと同じ人になる（記録の prefPins）',
    { owner: ownerOf(d3.aiPlans[NEXT], w.id), to, prefPins: run?.prefPins },
  );
  check(
    (await page.locator(`[data-visit="${w.id}"] [data-testid="pref-mark"]`).count()) > 0,
    '記憶：記憶で固定した訪問に「記憶」の印',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'pref-mark.png') });
  // データの画面：件数と［すべて消す］
  await page.goto(`${BASE}#/data`);
  await page.getByTestId('data-prefs-count').waitFor();
  check(/いま 1件 /.test(await page.getByTestId('data-prefs-count').innerText()), 'データの画面：手直しの記憶の件数');
  await page.getByTestId('data-prefs-clear').click();
  await page.getByTestId('confirm-ok').click();
  await waitStored(page, (d) => Object.keys(d.manualPrefs ?? {}).length === 0);
  check(Object.keys((await stored(page)).manualPrefs).length === 0, 'データの画面：［すべて消す］で記憶が空');
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
    ['unpinned-edit', unpinnedEdit],
    ['compare-more', compareMore],
    ['compare-no-option', compareNoOption],
    ['reassign-menu', reassignMenu],
    ['manual-prefs', manualPrefs],
    ['mobile', mobile],
  ]) {
    try {
      await fn(page);
    } catch (e) {
      check(false, name, String(e.message || e));
      await failShot(page, name);
    }
  }
  check(native.length === 0, 'ブラウザのダイアログを出さない', native);
  await b.close();
  return errors;
});
