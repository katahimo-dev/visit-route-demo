// 見直しの4段目（ADR-0054。PRD D326〜D332）を本物のブラウザで確かめる：
// メニューの最上位6項目（ホーム・予定・予定を組む・空き状況・人・設定。予定・予定を組む・人・設定は子の項目を持つ。PRD D349。ADR-0063）と
// 人のタブ（〈利用者さん〉・〈スタッフ〉・相性・勤務時間（シフト）。最後に開いたタブ・勤務の見込みは勤務時間（シフト）の印）、パレットに案を比べるが出ない、
// 日・週・月の切り替えで同じ操作の行（欠勤・キャンセルを登録／元に戻す／（月だけ）その他 ▾。「AI で組む ▾」は無い）、
// 担当を組むの画面で週を組んだ範囲の提案の帯（反映するまで訪問は変わらない・週・日の予定にも出る・「反映する」で1回の update・
// Ctrl+Z で戻る・Ctrl+Shift+Z でやり直す）、
// 全体の元に戻す（入力欄の中では Ctrl+Z を奪わない・操作の行の「元に戻す」の title に手の名前・やり直しのトースト）、
// 複数選択（日の時間軸の帯を Shift・Ctrl＋クリック、Shift＋Enter で足す、Esc で外す、帯の「時刻をずらす +15分」で2件の時刻が変わり1手で戻る、
// 週の時間軸の帯で Ctrl＋クリック → 取り消す（独自の確認））、390px（メニューの引き出しの最上位5項目・操作の行と複数選択の帯がはみ出さない）、印刷（操作の行・帯を出さない）。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-schedule-v4.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { BASE, OUT_DIR, TODAY, STORAGE_KEY, check, settle, stored, until, runSteps } = require('./lib/env.cjs');
const { sharedPage, openPage } = require('./lib/steps.cjs');

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const shot = (page, name) => page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
const visitsKey = (d) => JSON.stringify(d?.visits ?? null);
/** メニューの最上位の項目（子の無い項目と、畳める親の行の項目。PRD D349） */
const TOP_LINKS =
  '.nav-groups > .nav-group > .nav-link, .nav-groups > .nav-group > .nav-parent > .nav-parent-row > .nav-link';
/** 項目の名前（件数の印の文字は除く） */
const labelsOf = (els) => els.map((e) => e.querySelector(':scope > span:not(.nav-badge)')?.textContent.trim() ?? '');
/** メニューの最上位の項目名 */
const navLabels = (page, scope = '.side-nav') => page.locator(`${scope} :is(${TOP_LINKS})`).evaluateAll(labelsOf);
/** 親ごとの子の項目の key */
const navKids = (page, parent, scope = '.side-nav') =>
  page
    .locator(`${scope} [data-parent="${parent}"] > .nav-sub > .nav-link.nav-child`)
    .evaluateAll((els) => els.map((e) => e.dataset.key));
/** 今の画面の印が付いた項目の key */
const current = (page, scope = '.side-nav') =>
  page
    .locator(`${scope} [data-testid="nav-link"][aria-current="page"]`)
    .evaluateAll((els) => els.map((e) => e.dataset.key));
/** 親の行の項目が has-current（子に今の画面がある）か */
const parentHasCurrent = async (page, parent, scope = '.side-nav') =>
  (await page.locator(`${scope} [data-parent="${parent}"] > .nav-parent-row > .nav-link.has-current`).count()) === 1;

/** 保存（少し遅れて書く）が条件を満たすまで待つ */
async function waitStored(page, pred, timeout = 8000) {
  return until(async () => pred(await stored(page)), timeout, 100).catch(() => false);
}
/** 予定の画面を開いて落ち着くまで待つ */
async function openView(page, hash) {
  await page.goto(`${BASE}#${hash}`);
  await page.getByTestId('schedule-toolbar').waitFor({ timeout: 60000 });
  await settle(page, 400);
}
// ---- メニュー（最上位5項目と子の項目）・人のタブ・パレット ----
async function menu(page) {
  await page.goto(`${BASE}#/home`);
  await page.locator('h1').waitFor();
  await settle(page, 300);
  const labels = await navLabels(page);
  check(
    JSON.stringify(labels) === JSON.stringify(['ホーム', '予定', '予定を組む', '空き状況', '人', '設定']),
    'メニューの最上位は6項目（ホーム・予定・予定を組む・空き状況・人・設定）',
    labels,
  );
  const kids = {
    schedule: await navKids(page, 'schedule'),
    arrange: await navKids(page, 'arrange'),
    people: await navKids(page, 'people'),
  };
  check(
    JSON.stringify(kids) ===
      JSON.stringify({
        schedule: ['today', 'month-view', 'absence'],
        arrange: ['arrange:assign', 'arrange:standard'],
        people: ['people:/clients', 'people:/staff', 'people:/compat', 'people:/availability'],
      }),
    '予定の子は今日の予定・◯月の予定・欠勤・キャンセル、予定を組むの子は担当を組む・組み方の標準、人の子は〈利用者さん〉・〈スタッフ〉・相性・勤務時間（シフト）',
    kids,
  );
  check((await page.locator('.side-nav .nav-group-title').count()) === 0, 'メニューにグループの見出しは無い');
  await shot(page, 'menu-1400');
  await page.locator('.side-nav [data-key="people"]').click();
  await page.waitForURL(/#\/clients$/);
  const tabs = page.getByTestId('people-tabs');
  await tabs.waitFor();
  const tabNames = await tabs.locator('a').evaluateAll((els) => els.map((e) => e.textContent.trim()));
  check(
    tabNames.length === 4 && tabNames[2] === '相性' && tabNames[3] === '勤務時間（シフト）',
    '人のタブは4つ',
    tabNames,
  );
  check(
    (await tabs.locator('[aria-current="page"]').getAttribute('data-tab')) === 'clients',
    '「人」の既定は〈利用者さん〉のタブ',
  );
  check(
    JSON.stringify(await current(page)) === JSON.stringify(['people:/clients']) &&
      (await parentHasCurrent(page, 'people')),
    '〈利用者さん〉一覧ではメニューの人の子「利用者さん」が今の画面（親の「人」は has-current）',
    await current(page),
  );
  check(
    (await page.getByTestId('to-compat').count()) === 0,
    '一覧の見出しの「相性の表」の文字ボタンは無い（タブで開く）',
  );
  await tabs.locator('[data-tab="compat"]').click();
  await page.waitForURL(/#\/compat/);
  // 相性は別のチャンク：読み終わって見出しが替わるまで待つ（前の画面のタブを読まない）
  await page.locator('h1').filter({ hasText: '相性' }).waitFor({ timeout: 30000 });
  check(
    (await page.getByTestId('people-tabs').locator('[aria-current="page"]').getAttribute('data-tab')) === 'compat',
    'タブで相性へ移り、相性のタブに印',
  );
  await page.goto(`${BASE}#/workload`);
  await page.getByTestId('people-tabs').waitFor();
  check(
    (await page.getByTestId('people-tabs').locator('[aria-current="page"]').getAttribute('data-tab')) ===
      'availability',
    '勤務の見込みは勤務時間（シフト）のタブに印',
  );
  check(
    JSON.stringify(await current(page)) === JSON.stringify(['people:/availability']) &&
      (await parentHasCurrent(page, 'people')),
    '勤務の見込みではメニューの人の子「勤務時間（シフト）」が今の画面（親の「人」は has-current）',
    await current(page),
  );
  await page.goto(`${BASE}#/compat`);
  await page.getByTestId('people-tabs').waitFor();
  await page.locator('.side-nav [data-key="home"]').click();
  await page.waitForURL(/#\/home/);
  const peopleHref = await page.locator('.side-nav [data-key="people"]').getAttribute('href');
  check(/#\/compat$/.test(peopleHref ?? ''), '「人」は最後に開いた人のタブ（相性）を開く', peopleHref);
  // パレット：案を比べるは出ない（担当を組むの画面から開く）
  await page.keyboard.press(`${MOD}+k`);
  const input = page.getByRole('combobox');
  await input.waitFor();
  await input.fill('くらべる');
  await settle(page, 300);
  const options = await page.getByRole('option').evaluateAll((els) => els.map((e) => e.textContent));
  check(!options.some((t) => t.includes('比べる')), 'パレットに「提案を比べる」は出ない', options);
  await page.keyboard.press('Escape');
  await settle(page, 200);
}

// ---- 日・週・月で同じ操作の行（「AI で組む ▾」は無い。ADR-0063） ----
async function zoom(page) {
  for (const [zoomName, hash] of [
    ['day', '/plan'],
    ['week', '/week'],
    ['month', '/month'],
  ]) {
    await openView(page, hash);
    const bar = page.getByTestId('schedule-toolbar');
    check((await bar.getAttribute('data-zoom')) === zoomName, `${zoomName}：操作の行（data-zoom）`);
    const order = await bar.evaluate((el) =>
      [...el.querySelectorAll('[data-testid]')]
        .map((x) => x.getAttribute('data-testid'))
        .filter((id) => ['sudden-open', 'plan-menu', 'undo-btn'].includes(id)),
    );
    check(
      JSON.stringify(order) === JSON.stringify(['sudden-open', 'undo-btn']),
      `${zoomName}：欠勤・キャンセルを登録 → 元に戻す の並び（AI で組む ▾ は無い）`,
      order,
    );
    // その他 ▾ は項目の多い月だけ（日・週は項目が少ないのでたたまない。PRD D344）
    check(
      (await bar.locator('[data-testid$="-more"]').count()) === (zoomName === 'month' ? 1 : 0),
      `${zoomName}：その他 ▾ は${zoomName === 'month' ? 'ある' : '無い'}`,
    );
    check(
      (await page.getByTestId('progress-band').count()) === (zoomName === 'month' ? 1 : 0),
      `${zoomName}：進み具合の帯は月だけ`,
    );
    if (zoomName === 'week') check((await page.getByTestId('week-status').count()) === 1, '週：1行の状態');
    await shot(page, `${zoomName}-1400`);
  }
  // 週・月の「欠勤・キャンセルを登録」は日の予定の欄を開く
  await openView(page, '/week');
  await page.getByTestId('sudden-open').click();
  await page.waitForURL(/#\/plan/);
  await page
    .getByTestId('sudden-kind-staff')
    .waitFor({ timeout: 30000 })
    .catch(() => {});
  check(
    (await page.getByTestId('sudden-kind-staff').count()) === 1,
    '週の「欠勤・キャンセルを登録」で日の予定の欄が開く',
  );
  await page.keyboard.press('Escape');
  await settle(page, 300);
}

// ---- 範囲の提案（週）と全体の元に戻す ----
async function scope(page) {
  // 今日以降の担当を外す（繰り返しの担当も）：「この週」の提案で担当が変わる訪問を出す
  await page.goto(`${BASE}#/home`);
  await page.locator('h1').waitFor();
  await page.evaluate(
    ([k, today]) => {
      const d = JSON.parse(localStorage.getItem(k));
      d.patterns = d.patterns.map((p) => ({ ...p, usualStaffId: null }));
      d.visits = d.visits.map((v) => (v.date >= today ? { ...v, staffId: null, pinned: false, start: null } : v));
      localStorage.setItem(k, JSON.stringify(d));
    },
    [STORAGE_KEY, TODAY],
  );
  await page.reload();
  await page.locator('h1').waitFor();
  await openView(page, '/week');
  const before = await stored(page);
  // 週を組むのは担当を組むの画面（ADR-0063）
  await page.goto(`${BASE}#/arrange?d=${TODAY}`);
  await page.getByTestId('arrange-mode-all').check();
  if ((await page.getByTestId('arrange-start').getAttribute('aria-disabled')) === 'true') {
    check(false, '担当を組む：この週を組める（今日以降の伝えていない日がある）');
    return;
  }
  await page.getByTestId('arrange-start').click();
  const band = page.locator('[data-testid="proposal-band"][data-kind="range"]');
  await band.waitFor({ timeout: 170000 });
  await settle(page, 300);
  check(visitsKey(await stored(page)) === visitsKey(before), '範囲の提案：反映するまで訪問は変わらない');
  const moved = Number(await band.getByTestId('proposal-moved').innerText());
  const shifted = Number(await band.getByTestId('proposal-shifted').innerText());
  check(
    moved > 0 && Number.isFinite(shifted),
    '範囲の提案の帯：担当が変わる件数（担当なしに担当が入る）・時刻が変わる件数',
    {
      moved,
      shifted,
    },
  );
  check(
    /^提案（.+の週・\d+日分）/.test(await band.innerText()),
    '範囲の提案の帯の題（〜の週・N日分）',
    await band.innerText(),
  );
  await shot(page, 'proposal-week-1400');
  // 日の予定にも同じ提案の帯（範囲）が出る
  await openView(page, '/plan');
  check(
    (await page.locator('[data-testid="proposal-band"][data-kind="range"]').count()) === 1,
    '範囲の提案は日の予定にも出る',
  );
  await page.goto(`${BASE}#/arrange?d=${TODAY}`);
  await page.getByTestId('arrange-mode-all').check();
  // 反映していない提案があるまま組み始めようとすると確かめる（残せば提案はそのまま。PR #81 のレビュー）
  await page.getByTestId('arrange-start').click();
  await page.getByTestId('confirm-dialog').waitFor({ timeout: 5000 });
  check(
    /反映していない提案/.test(await page.getByTestId('confirm-title').innerText()),
    '反映していない提案があるまま組み始めると確かめる',
  );
  await page.getByTestId('confirm-cancel').click();
  await settle(page, 300);
  check(
    (await page.locator('[data-testid="proposal-band"][data-kind="range"]').count()) === 1 &&
      (await page.getByTestId('batch-band').count()) === 0,
    '「提案を残す」で組み始めず、提案はそのまま',
  );
  await openView(page, '/week');
  check(
    (await page.locator('[data-testid="proposal-band"][data-kind="range"]').count()) === 1,
    '範囲の提案は週の予定にも出る',
  );
  if (moved + shifted === 0) {
    await page.getByTestId('proposal-discard').click();
    await resetData(page);
    return;
  }
  await page.locator('[data-testid="proposal-band"][data-kind="range"]').getByTestId('proposal-apply').click();
  const applied = await waitStored(page, (d) => visitsKey(d) !== visitsKey(before));
  check(applied, '「反映する」で訪問に担当・開始を書く');
  check((await page.getByTestId('proposal-band').count()) === 0, '反映したら提案の帯は消える');
  const afterApply = await stored(page);
  const undoTitle = await page.getByTestId('undo-btn').getAttribute('title');
  check(/AI の提案を反映/.test(undoTitle ?? ''), '操作の行の「元に戻す」の title に手の名前', undoTitle);
  // Ctrl+Z で戻す（本文にフォーカス）
  await page.locator('h1').click();
  await page.keyboard.press(`${MOD}+z`);
  const undone = await waitStored(page, (d) => visitsKey(d) === visitsKey(before));
  check(undone, 'Ctrl+Z で反映する前の訪問に戻る（1手）');
  check((await page.getByTestId('toast-redo').count()) === 1, '戻したらトーストに「やり直す」');
  await page.keyboard.press(`${MOD}+Shift+z`);
  const redone = await waitStored(page, (d) => visitsKey(d) === visitsKey(afterApply));
  check(redone, 'Ctrl+Shift+Z でやり直す');
  await page.keyboard.press(`${MOD}+z`);
  await waitStored(page, (d) => visitsKey(d) === visitsKey(before));
  await resetData(page);
}

/** 初期データに戻す（次の段のため） */
async function resetData(page) {
  await page.goto(`${BASE}#/home`);
  await page.locator('h1').waitFor();
  await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
  await page.reload();
  await page.locator('h1').waitFor();
  await settle(page, 300);
}

/** 時間軸の帯（今日の、動かせるもの）を n 個 */
const bandsOf = (page) => page.locator('.tl-band .tl-band-btn');

// ---- 複数選択（日・週）と元に戻す・入力欄の中の Ctrl+Z ----
async function multi(page) {
  await openView(page, '/plan');
  const bands = bandsOf(page);
  await bands.first().waitFor({ timeout: 30000 });
  await bands.nth(0).click({ modifiers: ['Shift'] });
  await bands.nth(1).click({ modifiers: [MOD] });
  const bar = page.getByTestId('selection-bar');
  await bar.waitFor();
  check((await page.getByTestId('selection-count').innerText()) === '2件を選択', 'Shift・Ctrl＋クリックで2件を選ぶ');
  check((await page.locator('.tl-band.is-multi').count()) === 2, '選んだ帯に印（is-multi）');
  // キーボード：Shift＋Enter で足す
  await bands.nth(2).focus();
  await page.keyboard.press('Shift+Enter');
  await settle(page, 200);
  check((await page.getByTestId('selection-count').innerText()) === '3件を選択', 'Shift＋Enter で足す');
  await shot(page, 'multi-day-1400');
  await page.keyboard.press('Escape');
  await settle(page, 200);
  check((await page.getByTestId('selection-bar').count()) === 0, 'Esc で選択を外す');
  // 2件を選んで +15分
  const ids = await bands.evaluateAll((els) =>
    els.slice(0, 2).map((e) => e.closest('.tl-band').getAttribute('data-visit')),
  );
  await bands.nth(0).click({ modifiers: ['Shift'] });
  await bands.nth(1).click({ modifiers: ['Shift'] });
  const before = await stored(page);
  await page.locator('[data-testid="selection-shift"][data-minutes="15"]').click();
  const shiftedOk = await waitStored(
    page,
    (d) =>
      ids.every((id) => {
        const v = d.visits.find((x) => x.id === id);
        return !!v && v.pattern?.edited !== false;
      }) && visitsKey(d) !== visitsKey(before),
  );
  check(shiftedOk, '「+15分」で選んだ2件の時刻を変える（1回の update）');
  const after = await stored(page);
  const m = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const delta = ids.map((id) => {
    const v = after.visits.find((x) => x.id === id);
    const b = before.visits.find((x) => x.id === id);
    const bStart = b ? b.earliestStart : null;
    return v && bStart ? m(v.earliestStart) - m(bStart) : v ? 'new' : null;
  });
  check(
    delta.every((x) => x === 15 || x === 'new'),
    '2件とも +15分',
    delta,
  );
  // 入力欄の中では Ctrl+Z を奪わない
  await page.goto(`${BASE}#/clients`);
  const search = page.locator('input[type="search"]').first();
  await search.waitFor();
  await search.fill('あ');
  await search.press(`${MOD}+z`);
  await settle(page, 300);
  check(visitsKey(await stored(page)) === visitsKey(after), '入力欄の中の Ctrl+Z ではデータを戻さない');
  await page.locator('h1').click();
  await page.keyboard.press(`${MOD}+z`);
  const back = await waitStored(page, (d) => visitsKey(d) === visitsKey(before));
  check(back, '本文で Ctrl+Z を押すと、ずらす前に戻る（2件まとめて1手）');
  // 週：Ctrl＋クリック → 取り消す
  await openView(page, '/week');
  const wb = page.locator('[data-testid="week-band"][draggable="true"]');
  await wb.first().waitFor({ timeout: 30000 });
  const wids = await wb.evaluateAll((els) => els.slice(0, 2).map((e) => e.getAttribute('data-visit')));
  await wb.nth(0).click({ modifiers: [MOD] });
  await wb.nth(1).click({ modifiers: [MOD] });
  await page.getByTestId('selection-bar').waitFor();
  check((await page.getByTestId('selection-count').innerText()) === '2件を選択', '週：Ctrl＋クリックで2件');
  check(
    (await page.locator('.drawer-wrap .visit-panel').count()) === 0,
    '週：Ctrl＋クリックでは訪問の詳細の欄を開かない',
  );
  await shot(page, 'multi-week-1400');
  await page.getByTestId('selection-cancel').click();
  await page.getByTestId('confirm-dialog').waitFor();
  // 確認を待つ間に別のタブで〈利用者さん〉の名前を変える：取り消しはその変更を消さない（PR #81 のレビュー）
  const other = await page.context().newPage();
  await other.goto(`${BASE}#/data`);
  await other.locator('h1').waitFor();
  const renamed = await other.evaluate((k) => {
    const d = JSON.parse(localStorage.getItem(k));
    d.clients[0].displayName = '別のタブで変えた名前';
    localStorage.setItem(k, JSON.stringify(d));
    return d.clients[0].id;
  }, STORAGE_KEY);
  await other.close();
  await settle(page, 500);
  await page.getByTestId('confirm-ok').click();
  const cancelled = await waitStored(page, (d) => wids.every((id) => d.visits.some((v) => v.id === id && v.cancelled)));
  check(cancelled, '週：「取り消す」で2件を取り消す');
  check(
    (await stored(page)).clients.find((c) => c.id === renamed)?.displayName === '別のタブで変えた名前',
    '週：確認の間の別のタブの変更を、取り消しが上書きしない',
  );
  await page.getByTestId('undo-btn').click();
  const restored = await waitStored(page, (d) => !wids.some((id) => d.visits.some((v) => v.id === id && v.cancelled)));
  check(restored, '操作の行の「元に戻す」で取り消しを戻す');
}

// ---- 戻せない操作（古い記録を消す）は履歴に積まず、Ctrl+Z で消した記録が戻らない（PR #81 のレビュー） ----
async function tidyUndo(page) {
  await resetData(page);
  await openView(page, '/plan');
  const bands = bandsOf(page);
  await bands.first().waitFor({ timeout: 30000 });
  await bands.nth(0).click({ modifiers: ['Shift'] });
  const before = await stored(page);
  await page.locator('[data-testid="selection-shift"][data-minutes="15"]').click();
  await waitStored(page, (d) => visitsKey(d) !== visitsKey(before));
  // 読み直さずにデータの画面へ（履歴は残っている）
  await page.evaluate(() => {
    location.hash = '#/data';
  });
  await page.getByTestId('data-tidy-card').waitFor({ timeout: 30000 });
  await page.getByTestId('data-tidy-month').selectOption(TODAY.slice(0, 7));
  await settle(page, 300);
  if (await page.getByTestId('data-tidy-run').isDisabled()) {
    check(false, '片づけ：前の月に消せる記録がある（前提）');
    return;
  }
  await page.getByTestId('data-tidy-run').click();
  await page.getByTestId('confirm-dialog').waitFor();
  await page.getByTestId('confirm-ok').click();
  await page.locator('.toast').filter({ hasText: '訪問の記録を消しました' }).waitFor();
  await settle(page, 600);
  const tidied = await stored(page);
  await page.locator('h1').click();
  await page.keyboard.press(`${MOD}+z`);
  await settle(page, 600);
  const after = await stored(page);
  check(
    JSON.stringify(Object.keys(after.snapshots).sort()) === JSON.stringify(Object.keys(tidied.snapshots).sort()) &&
      visitsKey(after) === visitsKey(tidied),
    '古い記録を消したあとの Ctrl+Z では、消した記録も前の手も戻らない（戻せない操作は履歴を捨てる）',
  );
  check(
    (await page.locator('.toast').filter({ hasText: '戻せる操作がありません' }).count()) === 1,
    '戻せる操作が無いと知らせる',
  );
  await resetData(page);
}

// ---- 390px：メニューの引き出し・操作の行・複数選択の帯 ----
async function narrow(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}#/home`);
  await page.locator('h1').waitFor();
  await page.getByTestId('menu-btn').click();
  const drawer = page.locator('[role="dialog"][aria-modal="true"]');
  await drawer.waitFor();
  const labels = await navLabels(page, '[role="dialog"][aria-modal="true"]');
  check(labels.length === 6 && labels[4] === '人', '390px：引き出しのメニューも最上位6項目', labels);
  await shot(page, 'menu-390');
  await page.keyboard.press('Escape');
  for (const hash of ['/plan', '/week', '/month']) {
    await openView(page, hash);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    const bar = await page.getByTestId('schedule-toolbar').boundingBox();
    check(wide <= 390 && bar && bar.x + bar.width <= 391, `390px：${hash} の操作の行がはみ出さない`, { wide, bar });
    await shot(page, `${hash.slice(1)}-390`);
  }
  await openView(page, '/plan');
  // 390px の既定は日ごとのリスト（ADR-0055）。順番のカードは「その他 ▾」の「表示」から
  await page.getByTestId('plan-more').click();
  await page.getByTestId('plan-view-order').click();
  const cards = page.locator('.route-item .route-btn');
  await cards.first().waitFor({ timeout: 30000 });
  await cards.nth(0).click({ modifiers: ['Shift'] });
  await cards.nth(1).click({ modifiers: ['Shift'] });
  const bar = page.getByTestId('selection-bar');
  await bar.waitFor();
  await bar.scrollIntoViewIfNeeded();
  const box = await bar.boundingBox();
  check(box && box.x >= 0 && box.x + box.width <= 391, '390px：順番のカードでも複数選択・帯がはみ出さない', box);
  await shot(page, 'multi-390');
  await cards.nth(0).click({ modifiers: ['Shift'] });
  await page.getByTestId('selection-bar').waitFor();
  // 印刷：操作の行・複数選択の帯を出さない
  await page.emulateMedia({ media: 'print' });
  const hidden = await page.evaluate(() =>
    ['schedule-toolbar', 'selection-bar'].map((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      return !el || getComputedStyle(el).display === 'none';
    }),
  );
  check(hidden.every(Boolean), '印刷：操作の行と複数選択の帯を出さない', hidden);
  await page.emulateMedia({ media: 'screen' });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1400, height: 1000 });
}

const steps = sharedPage({
  open: async () => {
    const s = await openPage();
    // 確認は独自のダイアログ。ブラウザのダイアログが出たら失敗（PRD D146）
    const native = [];
    s.page.on('dialog', (d) => {
      if (d.type() === 'beforeunload') {
        d.accept();
        return;
      }
      native.push(`${d.type()}: ${d.message()}`);
      d.dismiss();
    });
    await s.page.goto(`${BASE}#/home`);
    await s.page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
    await s.page.reload();
    return { ...s, native };
  },
  steps: [
    ['menu', menu],
    ['zoom', zoom],
    ['scope', scope],
    ['multi', multi],
    ['tidy-undo', tidyUndo],
    ['narrow', narrow],
  ],
  after: ({ native }) => {
    check(native.length === 0, 'ブラウザのダイアログを出さない', native);
    check(!!TODAY, `今日＝${TODAY}`);
  },
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
