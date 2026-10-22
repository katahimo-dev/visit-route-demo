// 訪問の帯の共通の部品（ADR-0056。PRD D339〜D341）を本物のブラウザで確かめる：
// 週の表（〈スタッフ〉×曜日のマスの訪問・〈利用者さん〉×曜日の帯）・月のカレンダー（マスのキー・その日の回の一覧）・人の予定表で
// 複数選択（Ctrl＋クリック・Shift＋Enter・Esc）とキー（↓ 15分・Enter 欄・Ctrl+Z）が効く、〈スタッフ〉の画面は日時を動かさない、
// 帯の見た目（data-marks：要対応・ピン）が3画面と週の時間軸で同じ、ドラッグの落とし先の判定（今日より前の日は置けない・
// 同じ理由の文・入る日へ落とすと落とした日の欄）が週の表・月・人の予定表で同じ、390px で長押しの選ぶ・2段目の行が日ごとのリストと同じ形。
// スクリーンショット week-table-1400・week-clients-1400・month-list-1400・person-1400・week-table-390・person-390
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-shared-parts.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const {
  BASE,
  OUT_DIR,
  TODAY,
  STORAGE_KEY,
  check,
  settle,
  stored,
  until,
  runSteps,
  withTimeout,
} = require('./lib/env.cjs');
const { sharedPage, openPage } = require('./lib/steps.cjs');
const { answerConfirms } = require('./lib/confirmDialog.cjs');

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const shot = (page, name) => page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
const visitOf = (d, id) => d?.visits?.find((v) => v.id === id) ?? null;
const toMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const addDays = (d, n) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const YM = TODAY.slice(0, 7);
const panel = (page) => page.getByTestId('visit-panel');
const focusedVisit = (page) => page.evaluate(() => document.activeElement?.dataset?.visit ?? null);

async function waitStored(page, pred, timeout = 8000) {
  return until(async () => pred(await stored(page)), timeout, 100).catch(() => false);
}
/** 初期データで開き直す */
async function fresh(page, hash, ready) {
  await page.goto(`${BASE}#/home`);
  await page.locator('h1').waitFor();
  await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
  await page.reload();
  await page.locator('h1').waitFor();
  await page.goto(`${BASE}#${hash}`);
  await page.locator(ready).first().waitFor({ timeout: 60000 });
  await settle(page, 500);
}
/** 欄を閉じる（変えた入力を捨てる確認には答える） */
async function closePanel(page) {
  if ((await panel(page).count()) === 0) return;
  await page.keyboard.press('Escape');
  await panel(page)
    .waitFor({ state: 'detached', timeout: 5000 })
    .catch(async () => {
      await page.getByTestId('vp-close').first().click();
      await panel(page).waitFor({ state: 'detached', timeout: 5000 });
    });
}
/** 今日より後の日の帯（selector）の data-visit を n 件（日付は帯か、近い祖先の data-date） */
async function futureItems(page, selector, n) {
  return page.evaluate(
    ({ selector, n, today }) => {
      const out = [];
      for (const el of document.querySelectorAll(selector)) {
        const d = el.dataset.date ?? el.parentElement?.closest('[data-date]')?.dataset.date;
        if (d && d > today && !el.classList.contains('is-off') && !out.includes(el.dataset.visit))
          out.push(el.dataset.visit);
        if (out.length >= n) break;
      }
      return out;
    },
    { selector, n, today: TODAY },
  );
}
/**
 * 選ぶ・キーの確かめ（どの画面も同じ手順）：Ctrl＋クリックで2件選ぶ（欄は開かない）・Esc で外す・Shift＋Enter で選ぶ・
 * ↓ で15分後（フォーカスは帯のまま・手の名前）・Ctrl+Z で戻る・Enter で欄（Esc でフォーカスは帯）
 */
async function selectAndKeys(page, where, sel, ids, { move = true } = {}) {
  const item = (id) => page.locator(`${sel}[data-visit="${id}"]`).first();
  await item(ids[0]).scrollIntoViewIfNeeded();
  await item(ids[0]).click({ modifiers: [MOD] });
  await item(ids[1]).click({ modifiers: [MOD] });
  await settle(page, 200);
  check(
    (await page
      .getByTestId('selection-count')
      .innerText()
      .catch(() => '')) === '2件を選択' && (await panel(page).count()) === 0,
    `${where}：Ctrl＋クリックで2件を選ぶ（欄は開かない）`,
  );
  check(
    (await item(ids[0]).getAttribute('aria-pressed')) === 'true' &&
      (await item(ids[0]).getAttribute('data-selected')) !== null,
    `${where}：選んだ帯は aria-pressed と印`,
  );
  await page.keyboard.press('Escape');
  await settle(page, 150);
  check((await page.getByTestId('selection-bar').count()) === 0, `${where}：Esc で選択を外す`);
  await item(ids[0]).focus();
  await page.keyboard.press('Shift+Enter');
  await settle(page, 150);
  check(
    (await page
      .getByTestId('selection-count')
      .innerText()
      .catch(() => '')) === '1件を選択',
    `${where}：Shift＋Enter で選ぶ`,
  );
  await page.keyboard.press('Escape');
  await settle(page, 150);
  // ↓ で15分後（〈スタッフ〉の画面は動かさない）
  const before = await stored(page);
  const start0 = await page.evaluate(
    ({ k, id }) => {
      const d = JSON.parse(localStorage.getItem(k));
      return d.visits.find((v) => v.id === id)?.earliestStart ?? null;
    },
    { k: STORAGE_KEY, id: ids[0] },
  );
  await item(ids[0]).focus();
  await page.keyboard.press('ArrowDown');
  if (move) {
    const moved = await waitStored(page, (d) => {
      const v = visitOf(d, ids[0]);
      return !!v && (start0 === null || toMin(v.earliestStart) - toMin(start0) === 15) && d !== before;
    });
    check(moved, `${where}：↓ で15分後（store に書く）`);
    await settle(page, 300);
    check((await focusedVisit(page)) === ids[0], `${where}：動かしたあともフォーカスは動かした帯`);
    check(
      /訪問を15分後へ/.test((await page.getByTestId('undo-btn').getAttribute('title')) ?? ''),
      `${where}：全体の元に戻すの1手（手の名前）`,
    );
    await page.locator('h1').click();
    await page.keyboard.press(`${MOD}+z`);
    const back = await waitStored(page, (d) => JSON.stringify(d.visits) === JSON.stringify(before.visits));
    check(back, `${where}：Ctrl+Z で1手戻る`);
  } else {
    await settle(page, 400);
    check(
      JSON.stringify((await stored(page)).visits) === JSON.stringify(before.visits),
      `${where}：↓ では動かさない（日時を動かさない画面）`,
    );
  }
  // Enter で欄、Esc でフォーカスは帯
  await settle(page, 200);
  await item(ids[0]).focus();
  await page.keyboard.press('Enter');
  await panel(page).waitFor({ timeout: 5000 });
  check((await panel(page).getAttribute('data-visit')) === ids[0], `${where}：Enter で訪問の詳細の欄`);
  await page.keyboard.press('Escape');
  await panel(page).waitFor({ state: 'detached' });
  await settle(page, 200);
  check((await focusedVisit(page)) === ids[0], `${where}：Esc で閉じるとフォーカスは帯`);
}

// ---- 週の〈スタッフ〉×曜日の表 ----
async function weekTable(page) {
  await fresh(page, '/week?view=table', '[data-testid="week-tvisit"]');
  const ids = await futureItems(page, '[data-testid="week-tvisit"]', 2);
  check(ids.length === 2, '週の表：マスに訪問（今日より後に2件以上）', ids);
  if (ids.length < 2) return;
  await shot(page, 'week-table-1400');
  await selectAndKeys(page, '週の〈スタッフ〉×曜日の表', '[data-testid="week-tvisit"]', ids);
}

// ---- 週の〈利用者さん〉×曜日の表 ----
async function weekClients(page) {
  await page.goto(`${BASE}#/week?view=clients`);
  await page.getByTestId('week-citem').first().waitFor({ timeout: 30000 });
  await settle(page, 400);
  const ids = await futureItems(page, '[data-testid="week-citem"][draggable="true"]', 2);
  check(ids.length === 2, '週の〈利用者さん〉の表：動かせる帯が2件以上', ids);
  if (ids.length < 2) return;
  await shot(page, 'week-clients-1400');
  await selectAndKeys(page, '週の〈利用者さん〉×曜日の表', '[data-testid="week-citem"]', ids);
}

// ---- 月のカレンダー ----
async function month(page) {
  await page.goto(`${BASE}#/month?ym=${YM}&layout=calendar`);
  await page.getByTestId('month-grid').waitFor({ timeout: 30000 });
  await settle(page, 500);
  const cell = (d) => page.locator(`[data-testid="month-day"][data-date="${d}"]`);
  const focusedDate = () => page.evaluate(() => document.activeElement?.dataset?.date ?? null);
  await cell(TODAY).focus();
  // 月末でも月の中で確かめる（→ と ← のどちらか）
  const side = addDays(TODAY, 1).slice(0, 7) === YM ? 1 : -1;
  await page.keyboard.press(side > 0 ? 'ArrowRight' : 'ArrowLeft');
  await settle(page, 150);
  check((await focusedDate()) === addDays(TODAY, side), '月：←→ で隣の日のマスへ', await focusedDate());
  await cell(TODAY).focus();
  const wk = addDays(TODAY, 7).slice(0, 7) === YM ? 7 : -7;
  await page.keyboard.press(wk > 0 ? 'ArrowDown' : 'ArrowUp');
  await settle(page, 150);
  check((await focusedDate()) === addDays(TODAY, wk), '月：↑↓ で前・次の週のマスへ', await focusedDate());
  // 訪問のある今日より後の日
  const day = await page.evaluate((today) => {
    for (const el of document.querySelectorAll('[data-testid="month-day"]:not([data-state="empty"])'))
      if (el.dataset.date > today) return el.dataset.date;
    return null;
  }, TODAY);
  if (!day) {
    check(false, '月：今日より後に訪問のある日');
    return;
  }
  // Shift＋Enter でその日の選べる訪問をまとめて選ぶ
  await cell(day).focus();
  await page.keyboard.press('Shift+Enter');
  await settle(page, 200);
  const sel = await cell(day).getAttribute('data-selected');
  const bar = await page
    .getByTestId('selection-count')
    .innerText()
    .catch(() => '');
  check(Number(sel) > 0 && bar === `${sel}件を選択`, '月：マスで Shift＋Enter → その日の訪問をまとめて選ぶ', {
    sel,
    bar,
  });
  await cell(day).click({ modifiers: [MOD] });
  await settle(page, 150);
  check((await page.getByTestId('selection-bar').count()) === 0, '月：もう一度 Ctrl＋クリックで外す');
  check(new URL(page.url()).hash.startsWith('#/month'), '月：Ctrl＋クリックでは日の予定へ移らない');
  // Enter でその日の回の一覧（右の欄の先頭。フォーカスは最初の行）
  await cell(day).focus();
  await page.keyboard.press('Enter');
  const list = page.getByTestId('month-day-visits');
  await list.waitFor({ timeout: 5000 });
  await settle(page, 200);
  check((await list.getAttribute('data-date')) === day, '月：マスで Enter → その日の回の一覧');
  check(
    await page.evaluate(() => document.activeElement?.dataset?.testid === 'month-visit'),
    '月：一覧を開くとフォーカスは最初の行',
  );
  await shot(page, 'month-list-1400');
  const ids = await page.$$eval('[data-testid="month-visit"]', (els) =>
    els.filter((e) => !e.classList.contains('is-off')).map((e) => e.dataset.visit),
  );
  if (ids.length >= 2) await selectAndKeys(page, '月のその日の回の一覧', '[data-testid="month-visit"]', ids);
  else check(false, '月：その日の回が2件以上', ids);
  // Esc で一覧を閉じてマスへ
  await page.locator('[data-testid="month-visit"]').first().focus();
  await page.keyboard.press('Escape');
  await settle(page, 200);
  check((await list.count()) === 0 && (await focusedDate()) === day, '月：一覧の中の Esc で閉じ、フォーカスはマス');
  // ふつうに押すと今どおり日の予定
  await cell(day).click();
  await page.waitForURL(/#\/plan/, { timeout: 10000 });
  check(true, '月：マスを押すと今どおりその日の日の予定');
}

// ---- 人の予定表 ----
async function person(page) {
  await page.goto(`${BASE}#/clients/c1`);
  await page.getByTestId('pcal-visit').first().waitFor({ timeout: 30000 });
  await settle(page, 400);
  let ids = await futureItems(page, '[data-testid="pcal-visit"]', 2);
  if (ids.length < 2) {
    await page.getByTestId('pcal-next').click();
    await settle(page, 400);
    ids = await futureItems(page, '[data-testid="pcal-visit"]', 2);
  }
  check(ids.length === 2, '〈利用者さん〉の予定表：今日より後の回が2件以上', ids);
  if (ids.length < 2) return;
  await shot(page, 'person-1400');
  await selectAndKeys(page, '〈利用者さん〉の予定表', '[data-testid="pcal-visit"]', ids);
  // 〈スタッフ〉の画面：選べるが、日時は動かさない・帯に時刻をずらすは出ない
  const d = await stored(page);
  const sid = d.staff.find((s) => s.active)?.id;
  await page.goto(`${BASE}#/staff/${sid}`);
  await page.getByTestId('pcal').waitFor({ timeout: 30000 });
  await settle(page, 400);
  let sids = await futureItems(page, '[data-testid="pcal-visit"]', 2);
  if (sids.length < 2) {
    await page.getByTestId('pcal-next').click();
    await settle(page, 400);
    sids = await futureItems(page, '[data-testid="pcal-visit"]', 2);
  }
  if (sids.length < 2) {
    check(false, '〈スタッフ〉の予定表：今日より後の回が2件以上', sids);
    return;
  }
  await selectAndKeys(page, '〈スタッフ〉の予定表', '[data-testid="pcal-visit"]', sids, { move: false });
  await page.locator(`[data-testid="pcal-visit"][data-visit="${sids[0]}"]`).click({ modifiers: [MOD] });
  await settle(page, 150);
  check(
    (await page.getByTestId('selection-bar').count()) === 1 &&
      (await page.getByTestId('selection-shift').count()) === 0,
    '〈スタッフ〉の予定表：選んだ帯に「時刻をずらす」を出さない（動かさない）',
  );
  await page.keyboard.press('Escape');
}

// ---- 帯の見た目が3画面で同じ ----
async function sameLook(page) {
  // 今日より後の保存した訪問を1件ピン、1件担当なしにする（別のタブで書き換えたのと同じ）
  await fresh(page, '/home', 'h1');
  const picked = await page.evaluate(
    ({ k, today }) => {
      const d = JSON.parse(localStorage.getItem(k));
      const xs = d.visits.filter((v) => v.date > today && !v.cancelled && v.staffId);
      const a = xs[0];
      const b = xs.find((v) => v.date === a.date && v.id !== a.id && v.clientId !== a.clientId);
      if (!a || !b) return null;
      a.pinned = true;
      b.staffId = null;
      b.start = null;
      b.pinned = false;
      localStorage.setItem(k, JSON.stringify(d));
      return {
        pin: { id: a.id, date: a.date, client: a.clientId },
        none: { id: b.id, date: b.date, client: b.clientId },
      };
    },
    { k: STORAGE_KEY, today: TODAY },
  );
  if (!picked) {
    check(false, '見た目：ピンと担当なしにする訪問がある');
    return;
  }
  await page.reload();
  await page.locator('h1').waitFor();
  const marksOf = async (sel, id) =>
    page
      .locator(`${sel}[data-visit="${id}"]`)
      .first()
      .getAttribute('data-marks', { timeout: 15000 })
      .catch(() => 'なし');
  const seen = { pin: {}, none: {} };
  for (const [key, x] of Object.entries(picked)) {
    await page.goto(`${BASE}#/week?view=clients&d=${x.date}`);
    await page.getByTestId('week-citem').first().waitFor({ timeout: 30000 });
    await settle(page, 300);
    seen[key].weekClients = await marksOf('[data-testid="week-citem"]', x.id);
    await page.goto(`${BASE}#/week?view=timeline&d=${x.date}`);
    await page.getByTestId('week-band').first().waitFor({ timeout: 30000 });
    await settle(page, 300);
    seen[key].weekTimeline = await marksOf('[data-testid="week-band"]', x.id);
    if (key === 'pin') {
      await page.goto(`${BASE}#/week?view=table&d=${x.date}`);
      await page.getByTestId('week-tvisit').first().waitFor({ timeout: 30000 });
      await settle(page, 300);
      seen[key].weekTable = await marksOf('[data-testid="week-tvisit"]', x.id);
    }
    await page.goto(`${BASE}#/month?ym=${x.date.slice(0, 7)}&layout=calendar`);
    await page.getByTestId('month-grid').waitFor({ timeout: 30000 });
    await page.locator(`[data-testid="month-day"][data-date="${x.date}"]`).focus();
    await page.keyboard.press('Enter');
    await page.getByTestId('month-day-visits').waitFor({ timeout: 10000 });
    seen[key].month = await marksOf('[data-testid="month-visit"]', x.id);
    await page.goto(`${BASE}#/clients/${x.client}?d=${x.date}`);
    await page.getByTestId('pcal').waitFor({ timeout: 30000 });
    await settle(page, 300);
    seen[key].person = await marksOf('[data-testid="pcal-visit"]', x.id);
  }
  const same = (o) => new Set(Object.values(o)).size === 1;
  check(
    same(seen.pin) && /\bpin\b/.test(seen.pin.weekClients ?? ''),
    '見た目：ピンの印が週の時間軸・週の2つの表・月の一覧・人の予定表で同じ',
    seen.pin,
  );
  check(
    same(seen.none) && /\bissue\b/.test(seen.none.weekClients ?? ''),
    '見た目：担当なし（要対応）の印が週の時間軸・週の表・月の一覧・人の予定表で同じ',
    seen.none,
  );
}

/** 本物のマウスでつかみ、target の上で止めて影を読み、離す */
async function dragOver(page, src, target) {
  await src.scrollIntoViewIfNeeded();
  const sb = await src.boundingBox();
  const sx = sb.x + sb.width / 2;
  const sy = sb.y + Math.min(8, sb.height / 2);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await withTimeout(page.mouse.move(sx + 6, sy + 6, { steps: 3 }), 3000, 'つかみ');
  await settle(page, 150);
  const tb = await target.boundingBox();
  const cx = tb.x + tb.width / 2;
  const cy = tb.y + tb.height / 2;
  await withTimeout(page.mouse.move(cx, cy, { steps: 12 }), 3000, '移動');
  // 影は落とし先に入れる人を数えてから出る（その日の問題を作る）。dragover はマウスが動くたびなので、少し動かしながら待つ
  for (let i = 0; i < 20; i++) {
    if (await page.evaluate(() => !!document.querySelector('.vdrop'))) break;
    await page.mouse.move(cx + (i % 2 ? 2 : -2), cy, { steps: 1 });
    await settle(page, 100);
  }
  const shadow = await page.evaluate(() => {
    const el = document.querySelector('.vdrop');
    return el
      ? { tone: el.dataset.tone ?? [...el.classList].find((c) => c.startsWith('is-')), text: el.textContent }
      : null;
  });
  // 置けない日では離しても何も起きない（drop を受けない）。Esc で取りやめると次のドラッグが届かないことがあるので、いつも離す
  await withTimeout(page.mouse.up(), 3000, '離す');
  await settle(page, 400);
  return shadow;
}

// ---- ドラッグの判定が同じ ----
async function dropSame(page) {
  // つかむ帯と落とす先（月の1日など）がどちらも画面に入るよう、縦に長くする
  await page.setViewportSize({ width: 1400, height: 1800 });
  await fresh(page, `/week?view=clients`, '[data-testid="week-citem"]');
  const PAST = '今日より前の日へは動かせません';
  const results = {};
  // 週の〈利用者さん〉×曜日の表：同じ行の今日より前のマス／今日より後のマス
  const pair = await page.evaluate((today) => {
    for (const it of document.querySelectorAll('[data-testid="week-citem"][draggable="true"]')) {
      const td = it.closest('td');
      const row = td.parentElement;
      const cells = [...row.querySelectorAll('[data-testid="week-ccell"]')];
      const past = cells.find((c) => c.dataset.date < today);
      const fut = cells.find((c) => c.dataset.date > today && c.dataset.date !== td.dataset.date);
      if (past && fut)
        return { id: it.dataset.visit, client: td.dataset.client, past: past.dataset.date, fut: fut.dataset.date };
    }
    return null;
  }, TODAY);
  if (!pair) {
    check(false, 'ドラッグ：週の表に今日より前と後のマスがある行（FAKE_NOW を週の途中に）');
    return;
  }
  const citem = page.locator(`[data-testid="week-citem"][data-visit="${pair.id}"]`);
  const ccell = (d) => page.locator(`[data-testid="week-ccell"][data-client="${pair.client}"][data-date="${d}"]`);
  results.weekPast = await dragOver(page, citem, ccell(pair.past));
  results.weekFut = await dragOver(page, citem, ccell(pair.fut));
  const weekDate = await panel(page)
    .getByTestId('vp-date')
    .inputValue()
    .catch(() => null);
  await closePanel(page);
  // 月：その日の回の一覧の行を今日より前のマス／今日より後のマスへ（ドラッグごとに開き直す。続けてつかむと
  // 本物のマウスの2回目の dragover が届かないことがあった）
  const openList = async () => {
    await page.goto(`${BASE}#/month?ym=${YM}&layout=calendar`);
    await page.reload();
    await page.getByTestId('month-grid').waitFor({ timeout: 30000 });
    await settle(page, 300);
    await page.locator(`[data-testid="month-day"][data-date="${pair.fut}"]`).focus();
    await page.keyboard.press('Enter');
    await page.getByTestId('month-day-visits').waitFor();
    return page.locator('[data-testid="month-visit"][draggable="true"]').first();
  };
  const pastDay = `${YM}-01` < TODAY ? `${YM}-01` : null;
  const futDay = [addDays(pair.fut, 1), addDays(pair.fut, -1)].find((x) => x.slice(0, 7) === YM && x > TODAY);
  if (pastDay)
    results.monthPast = await dragOver(
      page,
      await openList(),
      page.locator(`[data-testid="month-day"][data-date="${pastDay}"]`),
    );
  if (futDay) {
    results.monthFut = await dragOver(
      page,
      await openList(),
      page.locator(`[data-testid="month-day"][data-date="${futDay}"]`),
    );
    results.monthDate = await panel(page)
      .getByTestId('vp-date')
      .inputValue()
      .catch(() => null);
    await closePanel(page);
  }
  // 人の予定表（月）：回を今日より前のマスへ
  await page.goto(`${BASE}#/clients/${pair.client}?cal=month`);
  await page.reload();
  await page.getByTestId('pcal-cell').first().waitFor({ timeout: 30000 });
  await settle(page, 300);
  const pv = page.locator('[data-testid="pcal-visit"][draggable="true"]').first();
  if (pastDay && (await pv.count()) > 0) {
    results.personPast = await dragOver(page, pv, page.locator(`[data-testid="pcal-cell"][data-date="${pastDay}"]`));
  }
  const ng = (r) => !!r && /ng/.test(r.tone) && (r.text ?? '').includes(PAST);
  check(ng(results.weekPast), 'ドラッグ：週の表で今日より前のマスは「置けません」と同じ理由', results.weekPast);
  check(
    !!results.weekFut && !/ng/.test(results.weekFut.tone) && weekDate === pair.fut,
    'ドラッグ：週の表で今日より後のマスは入る影・落とすとその日の欄',
    { shadow: results.weekFut, weekDate },
  );
  if (pastDay) {
    check(ng(results.monthPast), 'ドラッグ：月のカレンダーで今日より前のマスは同じ理由', results.monthPast);
    check(ng(results.personPast), 'ドラッグ：人の予定表で今日より前のマスは同じ理由', results.personPast);
  }
  if (futDay)
    check(
      !!results.monthFut && !/ng/.test(results.monthFut.tone) && results.monthDate === futDay,
      'ドラッグ：月の一覧の行をマスへ落とすとその日の欄',
      { shadow: results.monthFut, date: results.monthDate },
    );
  await page.setViewportSize({ width: 1400, height: 1000 });
}

// ---- 390px ----
async function narrow(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await fresh(page, '/week?view=table', '[data-testid="week-tvisit"]');
  const ids = await futureItems(page, '[data-testid="week-tvisit"]', 1);
  if (ids.length === 0) {
    check(false, '390px：週の表に今日より後の訪問');
    return;
  }
  const chip = page.locator(`[data-testid="week-tvisit"][data-visit="${ids[0]}"]`);
  await chip.scrollIntoViewIfNeeded();
  const b = await chip.boundingBox();
  // 長押し（タッチ）で選ぶ形に入って選ぶ
  await page.touchscreen.tap(b.x + 4, b.y + 4).catch(() => {});
  await panel(page)
    .waitFor({ timeout: 3000 })
    .catch(() => {});
  check((await panel(page).count()) === 1, '390px：週の表の訪問を押すと下から出る欄');
  await closePanel(page);
  await page.getByTestId('week-select').click();
  await chip.click();
  await settle(page, 200);
  check(
    (await page
      .getByTestId('selection-count')
      .innerText()
      .catch(() => '')) === '1件を選択' && (await page.getByTestId('selection-shift').count()) === 0,
    '390px：「選ぶ」で押すと選ぶ（時刻をずらすは出さない）',
  );
  await shot(page, 'week-table-390');
  await page.getByTestId('selection-clear').click();
  // 人の予定表の2段目の行は日の予定の日ごとのリストと同じ形（VisitRow）
  await page.goto(`${BASE}#/clients/c1`);
  await page.getByTestId('pcal-list').waitFor({ timeout: 30000 });
  await settle(page, 300);
  const rowClass = await page.locator('[data-testid="pcal-visit"]').first().getAttribute('class');
  check(/\bvrow\b/.test(rowClass ?? ''), '390px：人の予定表の行は日ごとのリストと同じ VisitRow', rowClass);
  await page.getByTestId('pcal-select').click();
  const pid = await futureItems(page, '[data-testid="pcal-visit"]', 1);
  if (pid.length > 0) {
    await page.locator(`[data-testid="pcal-visit"][data-visit="${pid[0]}"]`).click();
    await settle(page, 200);
    check(
      (await page
        .getByTestId('selection-count')
        .innerText()
        .catch(() => '')) === '1件を選択',
      '390px：人の予定表で「選ぶ」→ 押すと選ぶ',
    );
  }
  await shot(page, 'person-390');
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(over <= 1, '390px：横にはみ出さない', over);
  await page.goto(`${BASE}#/plan`);
  await page.getByTestId('day-list').waitFor({ timeout: 30000 });
  const dayClass = await page.getByTestId('day-row').first().getAttribute('class');
  check(/\bvrow\b/.test(dayClass ?? ''), '390px：日の予定の日ごとのリストの行も VisitRow', dayClass);
  await page.setViewportSize({ width: 1400, height: 1000 });
}

const steps = sharedPage({
  open: async () => {
    const s = await openPage({ context: { hasTouch: true } });
    const confirms = await answerConfirms(s.page);
    await s.ctx.route(/tile|cyberjapandata/, (r) => r.fulfill({ status: 204, body: '' }));
    return { ...s, confirms };
  },
  steps: [
    ['week-table', weekTable],
    ['week-clients', weekClients],
    ['month', month],
    ['person', person],
    ['same-look', sameLook],
    ['drop-same', dropSame],
    ['narrow', narrow],
  ],
  after: ({ confirms }) => {
    check(confirms.native.length === 0, 'ブラウザのダイアログを出さない', confirms.native);
  },
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
