// 札の3段の大きさと入れ物（PRD D342・D343）を本物のブラウザで確かめる：
// 週の〈スタッフ〉×曜日の表の小さな札（「時刻 頭文字」・1マス3件まで・「+N」と一覧・Esc でフォーカスは「+N」・選ぶ・
// ←→ で曜日・↓ で隣の担当・Enter で欄・Ctrl+Z・別のマスへのドラッグ）、〈利用者さん〉×曜日の表の札（時刻と担当の印・3件まで・
// 同じ行の別の日へのドラッグ）、月のマスの1回目は右の欄の一覧・2回目で日の予定・マスのキー・一覧の行のドラッグ・
// 選んだ行の「別の日へ」（時刻はそのまま・Ctrl+Z 1回で戻る・確定した日は確認）、印（data-marks）が3段（l・s・m）で同じ、
// 390px の週の表の長押しと月の下から出る欄、印刷で「+N」の一覧と選択の帯を出さない。
// スクリーンショット week-chips-1400・week-more-1400・week-drag-1400・month-list-1400・week-chips-390・month-sheet-390
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-chip-containers.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）。FAKE_NOW は週の途中（既定の水曜）にする
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
  hashOf,
} = require('./lib/env.cjs');
const { sharedPage, openPage } = require('./lib/steps.cjs');
const { answerConfirms } = require('./lib/confirmDialog.cjs');

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const WD = '日月火水木金土';
const shot = (page, name) => page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
const visitOf = (d, id) => d?.visits?.find((v) => v.id === id) ?? null;
const addDays = (d, n) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
/** 「10/29（木）」（lib/common の dateText と同じ） */
const dateText = (d) =>
  `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}（${WD[new Date(`${d}T00:00:00Z`).getUTCDay()]}）`;
/** 今週の日付（月〜日） */
const WEEK = (() => {
  const wd = new Date(`${TODAY}T00:00:00Z`).getUTCDay();
  const mon = addDays(TODAY, -((wd + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
})();
const panel = (page) => page.getByTestId('visit-panel');
const focusedVisit = (page) => page.evaluate(() => document.activeElement?.dataset?.visit ?? null);
const countText = (page) =>
  page
    .getByTestId('selection-count')
    .innerText()
    .catch(() => '');

async function waitStored(page, pred, timeout = 8000) {
  return until(async () => pred(await stored(page)), timeout, 100).catch(() => false);
}
/** 初期データで開き直す。mutate があれば初期データを書き換えて（別のタブで書き換えたのと同じ）読み直す */
async function fresh(page, hash, ready, mutate = null, arg = null) {
  await page.goto(`${BASE}#/home`);
  await page.locator('h1').waitFor();
  await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
  await page.reload();
  await page.locator('h1').waitFor();
  let out = null;
  if (mutate) {
    // 初期データが保存されるのを待ってから書き換える
    await until(() => page.evaluate((k) => !!localStorage.getItem(k), STORAGE_KEY), 10000);
    out = await page.evaluate(mutate, { k: STORAGE_KEY, today: TODAY, week: WEEK, arg });
    await page.reload();
    await page.locator('h1').waitFor();
  }
  await page.goto(`${BASE}#${hash}`);
  await page.locator(ready).first().waitFor({ timeout: 60000 });
  await settle(page, 500);
  return out;
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

/**
 * 1つの〈利用者さん〉の、明日（今週の今日より後の日）の訪問を6件にする（ページの中で走る）：元の訪問のほかに
 * 同じ担当2件・担当なし1件・取り消し1件・ほかの〈スタッフ〉（いつもの担当でない）1件を足す。
 * 〈スタッフ〉×曜日の表のその人のマスも3件を超え、「+N」が出る
 */
function crowd({ k, today, week }) {
  const d = JSON.parse(localStorage.getItem(k));
  const day = week.find((x) => x > today);
  if (!day) return null;
  const orig = d.visits.find((v) => v.date === day && v.staffId && !v.cancelled);
  if (!orig) return null;
  // いつもの担当（繰り返しの担当）でも元の担当でもない人（〈利用者さん〉×曜日の表の札に「代」）
  const usual = new Set(d.patterns.filter((p) => p.clientId === orig.clientId).map((p) => p.usualStaffId));
  const other = d.staff.find((s) => s.active && s.id !== orig.staffId && !usual.has(s.id))?.id ?? null;
  const add = (n, hhmm, patch) => ({
    ...orig,
    id: `e2e-chip-${n}`,
    earliestStart: hhmm,
    latestStart: hhmm,
    windowKind: 'fixed',
    durationMinutes: 30,
    start: null,
    pinned: false,
    cancelled: false,
    cancelKind: null,
    note: '',
    pattern: null,
    ...patch,
  });
  d.visits.push(
    add(1, '07:30', {}),
    add(2, '18:00', {}),
    add(3, '19:00', { staffId: null }),
    add(4, '19:30', { cancelled: true }),
    add(5, '17:00', { staffId: other }),
  );
  localStorage.setItem(k, JSON.stringify(d));
  return { day, client: orig.clientId, staff: orig.staffId, other, orig: orig.id };
}

/** 本物のマウスでつかみ、target の上で止めて影を読み（shotName があればスクリーンショット）、離す */
async function dragOver(page, src, target, shotName = null) {
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
  // 影は落とし先に入れる人を数えてから出る。dragover はマウスが動くたびなので、少し動かしながら待つ
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
  if (shotName) await shot(page, shotName);
  // 置けない日では離しても何も起きない（drop を受けない）
  await withTimeout(page.mouse.up(), 3000, '離す');
  await settle(page, 400);
  return shadow;
}

// ---- 週の〈スタッフ〉×曜日の表：札の形・3件まで・「+N」の一覧 ----
async function weekChips(page) {
  const fx = await fresh(page, '/week?view=table', '[data-testid="week-tvisit"]', crowd);
  if (!fx) {
    check(false, '準備：今週の今日より後の日に担当のある訪問（FAKE_NOW を週の途中に）');
    return;
  }
  page.fx = fx;
  const d = await stored(page);
  const clientName = new Map(d.clients.map((c) => [c.id, c.displayName]));
  const cells = await page.$$eval('[data-testid="week-cell"]', (els) =>
    els.map((c) => ({
      date: c.dataset.date,
      staff: c.dataset.staff,
      chips: [...c.querySelectorAll('[data-testid="week-tvisit"]')].map((x) => ({
        id: x.dataset.visit,
        size: x.dataset.size,
        time: x.querySelector('.vchip-time')?.textContent ?? '',
        short: x.querySelector('.vchip-short')?.textContent ?? '',
        marks: x.hasAttribute('data-marks'),
      })),
      rest: c.querySelector('[data-testid="chip-more"]')?.dataset.rest ?? null,
    })),
  );
  const chips = cells.flatMap((c) => c.chips);
  check(chips.length > 0, '週の表：マスに札がある', chips.length);
  const visitById = new Map();
  for (const v of d.visits) visitById.set(v.id, v);
  const badShape = chips.filter((x) => {
    const v = visitById.get(x.id);
    const name = v ? (clientName.get(v.clientId) ?? '') : null;
    // 保存していない繰り返しの回は名前を確かめず、形だけ
    return (
      x.size !== 's' ||
      !x.marks ||
      !/^\d{1,2}:\d{2}$/.test(x.time) ||
      Array.from(x.short).length !== 1 ||
      (name !== null && Array.from(name.trim())[0] !== x.short)
    );
  });
  check(badShape.length === 0, '週の表：札は「時刻 頭文字」（data-size="s"・data-marks）', badShape.slice(0, 3));
  check(
    cells.every((c) => c.chips.length <= 3) && cells.filter((c) => c.rest !== null).every((c) => c.chips.length === 3),
    '週の表：1マスに札は3件まで（「+N」のあるマスは3件）',
    cells.filter((c) => c.chips.length > 3).length,
  );
  // 足した訪問のマス（その人のその日）
  const full = cells.find((c) => c.date === fx.day && c.staff === fx.staff);
  const total = d.visits.filter((v) => v.date === fx.day && v.staffId === fx.staff && !v.cancelled).length;
  check(
    !!full && full.rest !== null && full.chips.length + Number(full.rest) === total,
    '週の表：残りは「+N」（data-rest＝そのマスの件数−3）',
    { chips: full?.chips.length, rest: full?.rest, total },
  );
  await shot(page, 'week-chips-1400');
  const cell = page.locator(`[data-testid="week-cell"][data-date="${fx.day}"][data-staff="${fx.staff}"]`);
  const more = cell.getByTestId('chip-more');
  await more.scrollIntoViewIfNeeded();
  check((await more.getAttribute('aria-expanded')) === 'false', '週の表：「+N」は aria-expanded=false');
  await more.click();
  const list = page.getByTestId('chip-list');
  await list.waitFor({ timeout: 5000 });
  await settle(page, 200);
  const info = await list.evaluate((el) => ({
    role: el.getAttribute('role'),
    body: el.parentElement === document.body,
    rows: [...el.querySelectorAll('[data-testid="week-list-visit"]')].map((r) => r.dataset.size),
  }));
  check(
    info.role === 'dialog' && info.body && (await more.getAttribute('aria-expanded')) === 'true',
    '週の表：「+N」を押すとそのマスの一覧（body の直下の role="dialog"・aria-expanded=true）',
    info,
  );
  check(
    info.rows.length === total && info.rows.every((s) => s === 'm'),
    '週の表：一覧の行の数＝そのマスの件数（行は VisitRow・data-size="m"）',
    { rows: info.rows.length, total },
  );
  check(
    await page.evaluate(() => document.activeElement?.closest('[data-testid="chip-list"]') !== null),
    '週の表：一覧を開くとフォーカスは一覧の行',
  );
  await shot(page, 'week-more-1400');
  await page.keyboard.press('Escape');
  await list.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  await settle(page, 150);
  check(
    (await list.count()) === 0 && (await more.evaluate((el) => document.activeElement === el)),
    '週の表：Esc で一覧を閉じ、フォーカスは「+N」',
  );
  // 外を押しても閉じる
  await more.click();
  await list.waitFor({ timeout: 5000 });
  await page.locator('h1').click();
  await settle(page, 200);
  check((await list.count()) === 0, '週の表：外を押すと一覧を閉じる');
  // 一覧の行のキー（リストの入れ物なので ↓ は15分。PRD D342）：↓ 2回で30分あと・担当は同じ・フォーカスは一覧の行のまま
  const rid = 'e2e-chip-2';
  const before = await stored(page);
  const r0 = visitOf(before, rid);
  const inList = (id) =>
    page.evaluate((id) => {
      const a = document.activeElement;
      return (
        a?.dataset?.testid === 'week-list-visit' &&
        a.dataset.visit === id &&
        a.closest('[data-testid="chip-list"]') !== null
      );
    }, id);
  await more.click();
  await list.waitFor({ timeout: 5000 });
  await settle(page, 200);
  const lrow = list.locator(`[data-testid="week-list-visit"][data-visit="${rid}"]`);
  await lrow.focus();
  await page.keyboard.press('ArrowDown');
  await waitStored(page, (d) => visitOf(d, rid)?.earliestStart === '18:15');
  await settle(page, 300);
  await page.keyboard.press('ArrowDown');
  const moved30 = await waitStored(page, (d) => {
    const v = visitOf(d, rid);
    return !!v && v.earliestStart === '18:30' && v.staffId === r0.staffId && v.date === r0.date;
  });
  check(moved30, '「+N」の一覧：行で ↓ を2回で30分あと（担当・日付は変わらない）', visitOf(await stored(page), rid));
  await settle(page, 300);
  check(
    (await list.count()) === 1 && (await inList(rid)),
    '「+N」の一覧：↓ で動かしたあともフォーカスは一覧の行（chip-list の中）',
  );
  // Enter で欄、Esc で閉じるとフォーカスは一覧の行
  await page.keyboard.press('Enter');
  await panel(page).waitFor({ timeout: 5000 });
  check((await panel(page).getAttribute('data-visit')) === rid, '「+N」の一覧：行で Enter で訪問の詳細の欄');
  await page.keyboard.press('Escape');
  await panel(page).waitFor({ state: 'detached', timeout: 5000 });
  await settle(page, 300);
  check((await list.count()) === 1 && (await inList(rid)), '「+N」の一覧：欄を Esc で閉じるとフォーカスは一覧の行');
  // Ctrl+Z で戻す（2手）
  await page.keyboard.press(`${MOD}+z`);
  await settle(page, 300);
  await page.keyboard.press(`${MOD}+z`);
  check(
    await waitStored(page, (d) => JSON.stringify(visitOf(d, rid)) === JSON.stringify(r0)),
    '「+N」の一覧：Ctrl+Z で ↓ の前に戻る',
  );
  await settle(page, 300);
  // 端の Tab（最後の行）・Shift+Tab（最初の行）は一覧を閉じてフォーカスは「+N」
  if ((await list.count()) === 0) {
    await more.click();
    await list.waitFor({ timeout: 5000 });
    await settle(page, 200);
  }
  await list.locator('[data-testid="week-list-visit"]').last().focus();
  await page.keyboard.press('Tab');
  await settle(page, 200);
  check(
    (await list.count()) === 0 && (await more.evaluate((el) => document.activeElement === el)),
    '「+N」の一覧：最後の行で Tab は一覧を閉じ、フォーカスは「+N」',
  );
  await more.click();
  await list.waitFor({ timeout: 5000 });
  await settle(page, 200);
  await list.locator('[data-testid="week-list-visit"]').first().focus();
  await page.keyboard.press('Shift+Tab');
  await settle(page, 200);
  check(
    (await list.count()) === 0 && (await more.evaluate((el) => document.activeElement === el)),
    '「+N」の一覧：最初の行で Shift+Tab は一覧を閉じ、フォーカスは「+N」',
  );
  // 一覧の中ほどの Tab は一覧の中を進む（閉じない）
  await more.click();
  await list.waitFor({ timeout: 5000 });
  await settle(page, 200);
  await list.locator('[data-testid="week-list-visit"]').first().focus();
  await page.keyboard.press('Tab');
  await settle(page, 150);
  check(
    (await list.count()) === 1 &&
      (await page.evaluate(() => document.activeElement?.closest('[data-testid="chip-list"]') !== null)),
    '「+N」の一覧：最初の行で Tab は一覧の中の次へ（閉じない）',
  );
  await page.keyboard.press('Escape');
  await settle(page, 150);
}

// ---- 週の〈スタッフ〉×曜日の表：選ぶ・キー ----
async function weekKeys(page) {
  await fresh(page, '/week?view=table', '[data-testid="week-tvisit"]');
  const d0 = await stored(page);
  // 今日より後で、次の日も今週の日の、保存した訪問の札（→ で週を移らない）
  const ids = await page.$$eval(
    '[data-testid="week-tvisit"]',
    (els, { today, last }) =>
      els
        .filter((e) => {
          const date = e.closest('[data-date]')?.dataset.date ?? '';
          return date > today && date < last && !e.classList.contains('is-off');
        })
        .map((e) => e.dataset.visit),
    { today: TODAY, last: WEEK[6] },
  );
  const saved = ids.filter((id) => visitOf(d0, id));
  check(saved.length >= 2, '週の表：今日より後の札が2件以上', saved.length);
  if (saved.length < 2) return;
  const chip = (id) => page.locator(`[data-testid="week-tvisit"][data-visit="${id}"]`);
  // 選ぶ：Ctrl＋クリック（欄は開かない）・Esc で外す・Shift＋Enter
  await chip(saved[0]).click({ modifiers: [MOD] });
  await chip(saved[1]).click({ modifiers: [MOD] });
  await settle(page, 200);
  check(
    (await countText(page)) === '2件を選択' &&
      (await panel(page).count()) === 0 &&
      (await chip(saved[0]).getAttribute('aria-pressed')) === 'true' &&
      (await chip(saved[0]).getAttribute('data-selected')) !== null,
    '週の表：札を Ctrl＋クリックで2件選ぶ（aria-pressed・data-selected・欄は開かない）',
  );
  await page.keyboard.press('Escape');
  await settle(page, 150);
  check((await page.getByTestId('selection-bar').count()) === 0, '週の表：Esc で選択を外す');
  await chip(saved[0]).focus();
  await page.keyboard.press('Shift+Enter');
  await settle(page, 150);
  check((await countText(page)) === '1件を選択', '週の表：札で Shift＋Enter で選ぶ');
  await page.keyboard.press('Escape');
  await settle(page, 150);
  // → で次の日（時刻はそのまま・フォーカスは札）
  const id = saved[0];
  const v0 = visitOf(d0, id);
  await chip(id).focus();
  await page.keyboard.press('ArrowRight');
  const movedDay = await waitStored(page, (d) => {
    const v = visitOf(d, id);
    return !!v && v.date === addDays(v0.date, 1) && v.earliestStart === v0.earliestStart;
  });
  check(movedDay, '週の表：札で → で次の日（データの日付が1日後・時刻はそのまま）', v0);
  await settle(page, 300);
  check((await focusedVisit(page)) === id, '週の表：→ で動かしたあともフォーカスは札');
  check(
    /訪問を次の日へ/.test((await page.getByTestId('undo-btn').getAttribute('title')) ?? ''),
    '週の表：→ は全体の元に戻すの1手（手の名前）',
  );
  await page.locator('h1').click();
  await page.keyboard.press(`${MOD}+z`);
  check(
    await waitStored(page, (d) => JSON.stringify(visitOf(d, id)) === JSON.stringify(v0)),
    '週の表：Ctrl+Z で → の前に戻る',
  );
  await settle(page, 300);
  // ↓ で隣の担当の行（表の行の順。時刻はそのまま）
  const order = await page.$$eval('[data-testid="week-cell"]', (els) => [...new Set(els.map((e) => e.dataset.staff))]);
  await chip(id).focus();
  await page.keyboard.press('ArrowDown');
  const movedStaff = await waitStored(page, (d) => {
    const v = visitOf(d, id);
    return !!v && v.staffId !== v0.staffId && v.date === v0.date && v.earliestStart === v0.earliestStart;
  });
  const v1 = visitOf(await stored(page), id);
  check(
    movedStaff && order.indexOf(v1?.staffId) > order.indexOf(v0.staffId),
    '週の表：札で ↓ で下の担当の行（担当が変わる・日付と時刻はそのまま）',
    { from: v0.staffId, to: v1?.staffId, order },
  );
  await settle(page, 300);
  check((await focusedVisit(page)) === id, '週の表：↓ で動かしたあともフォーカスは札（動かした先の行）');
  check(
    (await chip(id).evaluate((el) => el.closest('[data-staff]')?.dataset.staff)) === v1?.staffId,
    '週の表：札は動かした担当の行のマスに出る',
  );
  await page.locator('h1').click();
  await page.keyboard.press(`${MOD}+z`);
  check(await waitStored(page, (d) => visitOf(d, id)?.staffId === v0.staffId), '週の表：Ctrl+Z で ↓ の前の担当に戻る');
  await settle(page, 300);
  // 表の札では Shift+→ は読まない（担当は ↑↓）
  const beforeShift = await stored(page);
  await chip(id).focus();
  await page.keyboard.press('Shift+ArrowRight');
  await settle(page, 400);
  check(
    JSON.stringify((await stored(page)).visits) === JSON.stringify(beforeShift.visits),
    '週の表：札で Shift+→ は何もしない（データが変わらない）',
  );
  // Enter で訪問の詳細の欄
  await chip(id).focus();
  await page.keyboard.press('Enter');
  await panel(page).waitFor({ timeout: 5000 });
  check((await panel(page).getAttribute('data-visit')) === id, '週の表：札で Enter で訪問の詳細の欄');
  await page.keyboard.press('Escape');
  await panel(page).waitFor({ state: 'detached' });
  await settle(page, 200);
  check((await focusedVisit(page)) === id, '週の表：欄を Esc で閉じるとフォーカスは札');
}

// ---- 週の〈スタッフ〉×曜日の表：別のマスへドラッグ ----
async function weekDrag(page) {
  // つかむ札と落とすマスがどちらも画面に入るよう、縦に長くする
  await page.setViewportSize({ width: 1400, height: 1800 });
  try {
    await weekDragIn(page);
  } finally {
    await page.setViewportSize({ width: 1400, height: 1000 });
  }
}
async function weekDragIn(page) {
  await fresh(page, '/week?view=table', '[data-testid="week-tvisit"]');
  const pastDay = WEEK.find((x) => x < TODAY);
  const futDays = WEEK.filter((x) => x > TODAY);
  if (!pastDay || futDays.length < 2) {
    check(false, '週の表のドラッグ：今週に今日より前と後の日（FAKE_NOW を週の途中に）');
    return;
  }
  const d0 = await stored(page);
  const src = await page.$$eval(
    '[data-testid="week-tvisit"][draggable="true"]',
    (els, today) =>
      els
        .map((e) => ({
          id: e.dataset.visit,
          date: e.closest('[data-date]')?.dataset.date,
          staff: e.closest('[data-staff]')?.dataset.staff,
        }))
        .find((x) => x.date > today),
    TODAY,
  );
  if (!src) {
    check(false, '週の表のドラッグ：今日より後の動かせる札');
    return;
  }
  const chip = page.locator(`[data-testid="week-tvisit"][data-visit="${src.id}"]`);
  const cellOf = (date, staff) => page.locator(`[data-testid="week-cell"][data-date="${date}"][data-staff="${staff}"]`);
  // 今日より前の日のマス：置けない（同じ理由の文）・落としても何も変わらない
  const past = await dragOver(page, chip, cellOf(pastDay, src.staff));
  check(
    !!past &&
      past.tone === 'ng' &&
      (past.text ?? '').includes('今日より前の日へは動かせません') &&
      (await panel(page).count()) === 0,
    '週の表のドラッグ：今日より前の日のマスは置けない影と理由の文（落としても欄は開かない）',
    past,
  );
  check(
    JSON.stringify(visitOf(await stored(page), src.id)) === JSON.stringify(visitOf(d0, src.id)),
    '週の表のドラッグ：置けないマスに落としても訪問は変わらない',
  );
  // ほかの人・ほかの日のマス：入る影が出るマスへ落とすと、その日・その人を入れた欄
  const staffs = await page.$$eval('[data-testid="week-cell"]', (els) => [...new Set(els.map((e) => e.dataset.staff))]);
  const targets = [];
  for (const day of futDays.filter((x) => x !== src.date))
    for (const s of staffs.filter((x) => x !== src.staff)) targets.push({ day, s });
  let done = null;
  for (const t of targets.slice(0, 12)) {
    // ドラッグ中の影のスクリーンショット（入る影が出たマスの分が残る）
    const sh = await dragOver(page, chip, cellOf(t.day, t.s), 'week-drag-1400');
    if (sh?.tone === 'ok') {
      done = { ...t, shadow: sh };
      break;
    }
    await closePanel(page);
  }
  if (!done) {
    check(false, '週の表のドラッグ：入る影の出るマスがある', targets.slice(0, 12));
    return;
  }
  check(
    /入れる人 \d+人|入る/.test(done.shadow.text ?? ''),
    '週の表のドラッグ：入るマスの影の文（入れる人 N人）',
    done.shadow,
  );
  await panel(page)
    .waitFor({ timeout: 5000 })
    .catch(() => {});
  const vpDate = await panel(page)
    .getByTestId('vp-date')
    .inputValue()
    .catch(() => null);
  const picked = await panel(page)
    .locator('[data-testid="vp-staff-choice"]:has(input:checked)')
    .getAttribute('data-staff')
    .catch(() => null);
  check(
    (await panel(page)
      .getAttribute('data-visit')
      .catch(() => null)) === src.id &&
      vpDate === done.day &&
      picked === done.s,
    '週の表のドラッグ：落とすと落とした日・担当を入れた訪問の詳細の欄',
    { vpDate, picked, want: done },
  );
  await closePanel(page);
  check(
    JSON.stringify(visitOf(await stored(page), src.id)) === JSON.stringify(visitOf(d0, src.id)),
    '週の表のドラッグ：欄を保存しなければ訪問は変わらない',
  );
}

// ---- 週の〈利用者さん〉×曜日の表：札の中身・3件まで・同じ行の別の日へドラッグ ----
async function weekClients(page) {
  const fx = await fresh(page, '/week?view=clients', '[data-testid="week-citem"]', crowd);
  if (!fx) {
    check(false, '〈利用者さん〉の表：準備');
    return;
  }
  check((await page.getByTestId('week-chip-legend').count()) === 1, '〈利用者さん〉の表：札の凡例（week-chip-legend）');
  check(
    (await page.locator('.cbar-row, [data-testid="client-bar-legend"]').count()) === 0,
    '〈利用者さん〉の表：3段の帯（cbar・client-bar-legend）は無い',
  );
  const cells = await page.$$eval('[data-testid="week-ccell"]', (els) =>
    els.map((c) => ({
      n: c.querySelectorAll('[data-testid="week-citem"]').length,
      rest: c.querySelector('[data-testid="chip-more"]')?.dataset.rest ?? null,
    })),
  );
  check(
    cells.every((c) => c.n <= 3),
    '〈利用者さん〉の表：1マスに札は3件まで',
  );
  const cell = page.locator(`[data-testid="week-ccell"][data-client="${fx.client}"][data-date="${fx.day}"]`);
  const all = await page.evaluate(
    ({ k, day, client }) =>
      JSON.parse(localStorage.getItem(k)).visits.filter((v) => v.date === day && v.clientId === client).length,
    { k: STORAGE_KEY, day: fx.day, client: fx.client },
  );
  const rest = await cell
    .getByTestId('chip-more')
    .getAttribute('data-rest')
    .catch(() => null);
  check(
    (await cell.getByTestId('week-citem').count()) === 3 && Number(rest) === all - 3,
    '〈利用者さん〉の表：6件の日は札3件と「+3」',
    { rest, all },
  );
  // 中身：時刻と担当の印（担当なしは「なし」・取り消し「取消」・いつもの担当でない「代」）。「+N」の一覧で全部の行
  const items = await cell.locator('[data-testid="week-citem"]').evaluateAll((els) =>
    els.map((e) => ({
      id: e.dataset.visit,
      size: e.dataset.size,
      time: e.querySelector('.vchip-time')?.textContent ?? '',
      mark: e.querySelector('[data-staff-mark]')?.dataset.staffMark ?? null,
      short: e.querySelector('.vchip-short')?.textContent ?? '',
    })),
  );
  const d = await stored(page);
  const okItem = (x) => {
    const v = visitOf(d, x.id);
    if (!v || x.size !== 's' || !/^\d{1,2}:\d{2}$/.test(x.time)) return false;
    if (v.cancelled) return x.short.includes('取消');
    if (!v.staffId) return x.short.includes('なし');
    return x.mark === v.staffId;
  };
  check(
    items.length === 3 && items.every(okItem),
    '〈利用者さん〉の表：札は時刻と担当の印（担当の印は担当の人）',
    items,
  );
  // 足した5件の札の中身（「+N」に隠れた分は札を開けないので、時刻の順で先頭3件にある分だけ）
  const kinds = {
    none: items.find((x) => x.id === 'e2e-chip-3'),
    cancel: items.find((x) => x.id === 'e2e-chip-4'),
    sub: items.find((x) => x.id === 'e2e-chip-5'),
  };
  check(!kinds.none || kinds.none.short.includes('なし'), '〈利用者さん〉の表：担当なしの札は「なし」', kinds.none);
  // 「+N」の一覧で、取り消し・担当なし・ほかの担当の行がある
  await cell.getByTestId('chip-more').click();
  const list = page.getByTestId('chip-list');
  await list.waitFor({ timeout: 5000 });
  const rows = await list
    .locator('[data-testid="week-list-visit"]')
    .evaluateAll((els) => els.map((e) => ({ id: e.dataset.visit, text: e.textContent })));
  check(rows.length === all, '〈利用者さん〉の表：「+N」の一覧はそのマスの全部の訪問', { rows: rows.length, all });
  check(
    /取り消し/.test(rows.find((r) => r.id === 'e2e-chip-4')?.text ?? ''),
    '〈利用者さん〉の表：一覧の取り消しの行に「取り消し」',
    rows.find((r) => r.id === 'e2e-chip-4'),
  );
  await page.keyboard.press('Escape');
  await settle(page, 200);
  // 札の「代」と「取消」：取り消しの訪問と、繰り返しの回（元の訪問）をいつもの担当でない人にして時刻の早い所へ動かし、
  // 先頭3件に入れる（「代」は繰り返しの回だけ。別のタブで書き換えたのと同じ）
  await page.evaluate(
    ({ k, orig, other }) => {
      const d = JSON.parse(localStorage.getItem(k));
      for (const v of d.visits) {
        if (v.id === 'e2e-chip-4') Object.assign(v, { earliestStart: '07:00', latestStart: '07:00' });
        if (v.id === orig)
          Object.assign(v, { earliestStart: '07:10', latestStart: '07:10', start: null, staffId: other });
      }
      localStorage.setItem(k, JSON.stringify(d));
    },
    { k: STORAGE_KEY, orig: fx.orig, other: fx.other },
  );
  await page.reload();
  await cell.getByTestId('week-citem').first().waitFor({ timeout: 30000 });
  await settle(page, 400);
  const shorts = await cell
    .locator('[data-testid="week-citem"]')
    .evaluateAll((els) =>
      Object.fromEntries(els.map((e) => [e.dataset.visit, e.querySelector('.vchip-short')?.textContent ?? ''])),
    );
  check((shorts['e2e-chip-4'] ?? '').includes('取消'), '〈利用者さん〉の表：取り消しの札は「取消」', shorts);
  check((shorts[fx.orig] ?? '').includes('代'), '〈利用者さん〉の表：いつもの担当でない札は「代」', shorts);
  // 同じ行の別の日へドラッグ：落とすとその日の欄（時刻はそのまま）
  const later = WEEK.filter((x) => x > TODAY && x !== fx.day);
  const src = cell.locator('[data-testid="week-citem"][draggable="true"]').first();
  if (later.length === 0 || (await src.count()) === 0) {
    check(false, '〈利用者さん〉の表のドラッグ：動かせる札と、同じ行に今日より後の別の日', { later });
    return;
  }
  const to = later[0];
  // 行を画面のまんなかへ巻く（画面の端だと同じ行の落とし先のマスが画面の外に出る。上のナビの行で本体が下がった。PRD D347）
  await cell.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const sh = await dragOver(
    page,
    src,
    page.locator(`[data-testid="week-ccell"][data-client="${fx.client}"][data-date="${to}"]`),
  );
  await panel(page)
    .waitFor({ timeout: 5000 })
    .catch(() => {});
  const vpDate = await panel(page)
    .getByTestId('vp-date')
    .inputValue()
    .catch(() => null);
  check(!!sh && sh.tone !== 'ng' && vpDate === to, '〈利用者さん〉の表のドラッグ：同じ行の別の日へ落とすとその日の欄', {
    sh,
    vpDate,
    to,
  });
  await closePanel(page);
  // ほかの〈利用者さん〉の行へは置けない
  const otherRow = await page.$$eval(
    '[data-testid="week-ccell"]',
    (els, { client, to }) =>
      els.find((e) => e.dataset.client !== client && e.dataset.date === to)?.dataset.client ?? null,
    { client: fx.client, to },
  );
  if (otherRow) {
    const ng = await dragOver(
      page,
      src,
      page.locator(`[data-testid="week-ccell"][data-client="${otherRow}"][data-date="${to}"]`),
    );
    check(
      (await panel(page).count()) === 0 && !!ng && ng.tone === 'ng' && /ほかの人の行/.test(ng.text ?? ''),
      '〈利用者さん〉の表のドラッグ：ほかの人の行には置けない影（ng）と理由の文',
      ng,
    );
    await closePanel(page);
  } else check(false, '〈利用者さん〉の表のドラッグ：同じ日のほかの人の行がある');
}

// ---- 週の〈利用者さん〉×曜日の表：札のキー（↓ で隣の担当・Shift+→ は読まない） ----
async function weekClientKeys(page) {
  // 利用中の〈スタッフ〉の順（画面の並び。〈スタッフ〉×曜日の表の行と同じ）
  await fresh(page, '/week?view=table', '[data-testid="week-cell"]');
  const order = await page.$$eval('[data-testid="week-cell"]', (els) => [...new Set(els.map((e) => e.dataset.staff))]);
  await page.goto(`${BASE}#/week?view=clients`);
  await page.getByTestId('week-citem').first().waitFor({ timeout: 30000 });
  await settle(page, 400);
  const d0 = await stored(page);
  const ids = await page.$$eval(
    '[data-testid="week-citem"][draggable="true"]',
    (els, today) =>
      els.filter((e) => (e.closest('[data-date]')?.dataset.date ?? '') > today).map((e) => e.dataset.visit),
    TODAY,
  );
  // 下に担当できる人がいる訪問（いなければ次の訪問。理由の知らせはデータを変えない）
  let done = null;
  for (const id of ids.filter((x) => visitOf(d0, x)?.staffId).slice(0, 6)) {
    const v0 = visitOf(await stored(page), id);
    const chip = page.locator(`[data-testid="week-citem"][data-visit="${id}"]`);
    await chip.focus();
    await page.keyboard.press('ArrowDown');
    const ok = await waitStored(page, (d) => visitOf(d, id)?.staffId !== v0.staffId, 3000);
    if (ok) {
      done = { id, v0, v1: visitOf(await stored(page), id) };
      break;
    }
    await settle(page, 200);
  }
  if (!done) {
    check(false, '〈利用者さん〉の表：↓ で隣の担当へ動かせる札', ids.slice(0, 6));
    return;
  }
  const { id, v0, v1 } = done;
  check(
    v1.date === v0.date &&
      v1.earliestStart === v0.earliestStart &&
      order.indexOf(v1.staffId) > order.indexOf(v0.staffId),
    '〈利用者さん〉の表：札で ↓ で隣の担当（利用中の〈スタッフ〉の順で後ろ・日付と時刻は同じ）',
    { from: v0.staffId, to: v1.staffId, order },
  );
  check(
    /担当を.+さんへ/.test((await page.getByTestId('undo-btn').getAttribute('title')) ?? ''),
    '〈利用者さん〉の表：↓ は全体の元に戻すの1手（担当を〜さんへ）',
  );
  await settle(page, 300);
  await page.locator('h1').click();
  await page.keyboard.press(`${MOD}+z`);
  check(
    await waitStored(page, (d) => visitOf(d, id)?.staffId === v0.staffId),
    '〈利用者さん〉の表：Ctrl+Z で ↓ の前の担当に戻る',
  );
  await settle(page, 300);
  const before = await stored(page);
  await page.locator(`[data-testid="week-citem"][data-visit="${id}"]`).focus();
  await page.keyboard.press('Shift+ArrowRight');
  await settle(page, 400);
  check(
    JSON.stringify((await stored(page)).visits) === JSON.stringify(before.visits),
    '〈利用者さん〉の表：札で Shift+→ は何もしない（データが変わらない）',
  );
}

// ---- 月：マスの1回目は右の欄・2回目で日の予定・キー ----
async function monthCells(page) {
  await fresh(page, `/month?ym=${TODAY.slice(0, 7)}&layout=calendar`, '[data-testid="month-grid"]');
  // 今日より後の、取り消しの無い訪問のある日
  const day = await page.evaluate((today) => {
    for (const el of document.querySelectorAll('[data-testid="month-day"]:not([data-state="empty"])'))
      if (el.dataset.date > today && el.querySelector('.month-count')) return el.dataset.date;
    return null;
  }, TODAY);
  if (!day) {
    check(false, '月：今日より後に訪問のある日（今月）');
    return;
  }
  const cell = (d) => page.locator(`[data-testid="month-day"][data-date="${d}"]`);
  const n = Number(/(\d+)件/.exec(await cell(day).locator('.month-count').innerText())?.[1] ?? -1);
  await cell(day).click();
  const list = page.getByTestId('month-day-visits');
  await list.waitFor({ timeout: 5000 });
  await settle(page, 300);
  const rows = await list.getByTestId('month-visit').count();
  const sizes = await list.getByTestId('month-visit').evaluateAll((els) => els.map((e) => e.dataset.size));
  check(
    hashOf(page).startsWith('#/month') && (await list.getAttribute('data-date')) === day,
    '月：マスを1回押すと右の欄の先頭にその日の一覧（日の予定へは移らない）',
    hashOf(page),
  );
  check(rows === n, '月：一覧の行の数＝マスの件数', { rows, cell: n });
  check(sizes.length > 0 && sizes.every((s) => s === 'm'), '月：一覧の行は data-size="m"', sizes);
  check(
    await cell(day).evaluate((el) => el.closest('.is-listed') !== null),
    '月：右の欄に出している日のマスは is-listed',
  );
  await shot(page, 'month-list-1400');
  // もう一度押すと日の予定
  await cell(day).click();
  await page.waitForURL(/#\/plan/, { timeout: 10000 });
  await page.locator('.date-switch select').waitFor({ timeout: 30000 });
  check(
    (await page.locator('.date-switch select').inputValue()) === day,
    '月：右の欄に出している日のマスをもう一度押すと日の予定',
  );
  // キー：←→ 日・↑↓ 週・Enter で一覧（最初の行へフォーカス）
  await page.goto(`${BASE}#/month?ym=${TODAY.slice(0, 7)}&layout=calendar`);
  await page.getByTestId('month-grid').waitFor({ timeout: 30000 });
  await settle(page, 300);
  const focusedDate = () => page.evaluate(() => document.activeElement?.dataset?.date ?? null);
  const YM = TODAY.slice(0, 7);
  const moves = [
    ['ArrowRight', 1],
    ['ArrowLeft', -1],
    ['ArrowDown', 7],
    ['ArrowUp', -7],
  ];
  const got = {};
  for (const [key, step] of moves) {
    // 月の中に収まる向きだけ
    if (addDays(day, step).slice(0, 7) !== YM) continue;
    await cell(day).focus();
    await page.keyboard.press(key);
    await settle(page, 150);
    got[key] = (await focusedDate()) === addDays(day, step);
  }
  check(
    Object.keys(got).length >= 2 && Object.values(got).every(Boolean),
    '月：マスで ←→ は1日・↑↓ は1週のマスへ',
    got,
  );
  await cell(day).focus();
  await page.keyboard.press('Enter');
  await list.waitFor({ timeout: 5000 });
  await settle(page, 200);
  check(
    (await list.getAttribute('data-date')) === day &&
      (await page.evaluate(() => document.activeElement?.dataset?.testid === 'month-visit')) &&
      (await page.evaluate(
        () =>
          document.activeElement ===
          document.querySelector('[data-testid="month-day-visits"] [data-testid="month-visit"]'),
      )),
    '月：マスで Enter でその日の一覧、フォーカスは最初の行',
  );
}

// ---- 月：一覧の行のドラッグ・「別の日へ」・確定した日の確認 ----
async function monthMove(page, { confirms }) {
  await fresh(page, '/home', 'h1');
  const d0 = await stored(page);
  // 保存した訪問が2件以上ある今日より後の日（同じ月）と、移す先（同じ月の今日より後の別の日）
  const byDay = new Map();
  for (const v of d0.visits)
    if (v.date > TODAY && !v.cancelled) byDay.set(v.date, [...(byDay.get(v.date) ?? []), v.id]);
  const day = [...byDay.keys()].sort().find((x) => byDay.get(x).length >= 2);
  if (!day) {
    check(false, '月の移す：今日より後に保存した訪問が2件以上ある日');
    return;
  }
  const ym = day.slice(0, 7);
  const to = [addDays(day, 2), addDays(day, 1), addDays(day, -1)].find((x) => x > TODAY && x.slice(0, 7) === ym);
  const openList = async () => {
    await page.goto(`${BASE}#/month?ym=${ym}&layout=calendar`);
    await page.reload();
    await page.getByTestId('month-grid').waitFor({ timeout: 30000 });
    await settle(page, 300);
    await page.locator(`[data-testid="month-day"][data-date="${day}"]`).click();
    await page.getByTestId('month-day-visits').waitFor({ timeout: 5000 });
    await settle(page, 200);
  };
  // 一覧の行をほかの日のマスへドラッグ：落とした日の欄
  if (to) {
    await openList();
    const row = page.locator('[data-testid="month-visit"][draggable="true"]').first();
    const rowId = await row.getAttribute('data-visit');
    const sh = await dragOver(page, row, page.locator(`[data-testid="month-day"][data-date="${to}"]`));
    await panel(page)
      .waitFor({ timeout: 5000 })
      .catch(() => {});
    const vpDate = await panel(page)
      .getByTestId('vp-date')
      .inputValue()
      .catch(() => null);
    check(
      !!sh &&
        sh.tone !== 'ng' &&
        vpDate === to &&
        (await panel(page)
          .getAttribute('data-visit')
          .catch(() => null)) === rowId,
      '月：一覧の行をほかの日のマスへドラッグすると落とした日の欄',
      { sh, vpDate, to },
    );
    await closePanel(page);
  } else check(false, '月の移す：同じ月の移す先の日', day);
  // 2件を選んで「別の日へ」→ 日付 → 移す（時刻はそのまま・1手で戻る）
  await openList();
  const ids = await page.$$eval('[data-testid="month-visit"][draggable="true"]', (els) =>
    els.map((e) => e.dataset.visit),
  );
  const two = ids.filter((id) => visitOf(d0, id)).slice(0, 2);
  if (two.length < 2 || !to) {
    check(false, '月の移す：一覧に動かせる保存した訪問が2件', ids);
    return;
  }
  const pickTwo = async () => {
    for (const id of two)
      await page.locator(`[data-testid="month-visit"][data-visit="${id}"]`).click({ modifiers: [MOD] });
    await settle(page, 200);
  };
  await pickTwo();
  check((await countText(page)) === '2件を選択', '月の移す：一覧の行を Ctrl＋クリックで2件選ぶ');
  await page.getByTestId('selection-move').click();
  await page.getByTestId('selection-move-date').waitFor({ timeout: 3000 });
  check(
    (await page.getByTestId('selection-move').getAttribute('aria-expanded')) === 'true',
    '月の移す：「別の日へ」で日付の入力',
  );
  await page.getByTestId('selection-move-date').fill(to);
  await page.getByTestId('selection-move-go').click();
  const moved = await waitStored(page, (d) =>
    two.every((id) => {
      const v = visitOf(d, id);
      const o = visitOf(d0, id);
      return v && v.date === to && v.earliestStart === o.earliestStart && v.latestStart === o.latestStart;
    }),
  );
  check(moved, '月の移す：「移す」で2件の日付が移る（時刻はそのまま）', { to, two });
  await settle(page, 300);
  const title = (await page.getByTestId('undo-btn').getAttribute('title')) ?? '';
  check(title.includes(`${dateText(to)}へ移しました`), '月の移す：手の名前は「M/D（曜）へ移しました」', title);
  check(
    await until(() => page.evaluate(() => document.activeElement?.dataset?.testid === 'undo-btn'), 3000),
    '月の移す：移したあとフォーカスは「元に戻す」',
  );
  await page.locator('h1').click();
  await page.keyboard.press(`${MOD}+z`);
  check(
    await waitStored(page, (d) =>
      two.every((id) => JSON.stringify(visitOf(d, id)) === JSON.stringify(visitOf(d0, id))),
    ),
    '月の移す：Ctrl+Z 1回で2件とも戻る',
  );
  // 全部同じ日へ移す（1件も移せない）と選んだまま
  await openList();
  await pickTwo();
  const same0 = await stored(page);
  await page.getByTestId('selection-move').click();
  await page.getByTestId('selection-move-date').fill(day);
  await page.getByTestId('selection-move-go').click();
  await settle(page, 400);
  check(
    (await countText(page)) === '2件を選択' &&
      JSON.stringify((await stored(page)).visits) === JSON.stringify(same0.visits),
    '月の移す：全部同じ日へ移す（1件も移せない）と何も変えず選んだまま',
    await countText(page),
  );
  // 日付の欄を開いたまま「選択を外す」→ もう一度選ぶと日付の欄は閉じている
  if ((await page.getByTestId('selection-move-date').count()) === 0) await page.getByTestId('selection-move').click();
  await page.getByTestId('selection-move-date').waitFor({ timeout: 3000 });
  await page.getByTestId('selection-clear').click();
  await settle(page, 200);
  await pickTwo();
  check(
    (await countText(page)) === '2件を選択' &&
      (await page.getByTestId('selection-move-date').count()) === 0 &&
      (await page.getByTestId('selection-move').getAttribute('aria-expanded')) === 'false',
    '月の移す：日付の欄を開いたまま選択を外し、選び直すと日付の欄は閉じている',
  );
  // 日付の欄の［移す］で Esc：欄だけ閉じ、選んだまま、フォーカスは「別の日へ」
  await page.getByTestId('selection-move').click();
  await page.getByTestId('selection-move-go').focus();
  await page.keyboard.press('Escape');
  await settle(page, 200);
  check(
    (await page.getByTestId('selection-move-date').count()) === 0 &&
      (await countText(page)) === '2件を選択' &&
      (await page.getByTestId('selection-move').evaluate((el) => document.activeElement === el)),
    '月の移す：［移す］で Esc は日付の欄だけ閉じ（選んだまま）、フォーカスは「別の日へ」',
  );
  await page.getByTestId('selection-clear').click();
  await settle(page, 150);
  // 確定した日へ移すと確認、取り消すと変わらない（確定した日は伝えた内容を書く：別のタブで書き換えたのと同じ）
  await page.evaluate(
    ({ k, to }) => {
      const d = JSON.parse(localStorage.getItem(k));
      d.snapshots[to] = { date: to, at: 1, visits: [] };
      localStorage.setItem(k, JSON.stringify(d));
    },
    { k: STORAGE_KEY, to },
  );
  await openList();
  const before = await stored(page);
  await pickTwo();
  await page.getByTestId('selection-move').click();
  await page.getByTestId('selection-move-date').fill(to);
  const n0 = confirms.messages.length;
  confirms.answer = false;
  await page.getByTestId('selection-move-go').click();
  await until(() => confirms.messages.length > n0, 5000);
  await settle(page, 300);
  confirms.answer = true;
  const msg = confirms.messages[n0] ?? '';
  check(
    msg.startsWith('確定した日の訪問も変えますか？') && msg.includes(dateText(to)),
    '月の移す：確定した日へ移すと独自の確認「確定した日の訪問も変えますか？」',
    msg,
  );
  check(
    JSON.stringify((await stored(page)).visits) === JSON.stringify(before.visits),
    '月の移す：確認を取り消すと何も変わらない',
  );
  await page.keyboard.press('Escape');
  await settle(page, 150);
}

// ---- 印が3段（l・s・m）で同じ ----
async function sameMarks(page) {
  // 今日より後の保存した訪問を1件ピンにし、その〈利用者さん〉の担当できる人をほかの1人に限る（限✗・要対応）
  const fx = await fresh(page, '/home', 'h1', ({ k, today, week }) => {
    const d = JSON.parse(localStorage.getItem(k));
    const v = d.visits.find((x) => x.date > today && week.includes(x.date) && x.staffId && !x.cancelled);
    if (!v) return null;
    v.pinned = true;
    const c = d.clients.find((x) => x.id === v.clientId);
    const other = d.staff.find((s) => s.active && s.id !== v.staffId);
    c.allowedStaffIds = [other.id];
    localStorage.setItem(k, JSON.stringify(d));
    return { id: v.id, date: v.date, staff: v.staffId };
  });
  if (!fx) {
    check(false, '印：今週の今日より後に保存した訪問');
    return;
  }
  const marksOf = async (sel) => {
    const el = page.locator(`${sel}[data-visit="${fx.id}"]`).first();
    const m = await el.getAttribute('data-marks', { timeout: 15000 }).catch(() => null);
    const s = await el.getAttribute('data-size').catch(() => null);
    return { m, s };
  };
  const seen = {};
  await page.goto(`${BASE}#/week?view=timeline&d=${fx.date}`);
  await page.getByTestId('week-band').first().waitFor({ timeout: 30000 });
  await settle(page, 300);
  seen.weekTimeline = await marksOf('[data-testid="week-band"]');
  await page.goto(`${BASE}#/week?view=table&d=${fx.date}`);
  await page.getByTestId('week-tvisit').first().waitFor({ timeout: 30000 });
  await settle(page, 300);
  // 札が「+N」に隠れていれば、その人のその日のマスの「+N」の一覧を開いて行（m）で必ず見る
  if ((await page.locator(`[data-testid="week-tvisit"][data-visit="${fx.id}"]`).count()) === 0) {
    await page
      .locator(`[data-testid="week-cell"][data-date="${fx.date}"][data-staff="${fx.staff}"]`)
      .getByTestId('chip-more')
      .click();
    await page.getByTestId('chip-list').waitFor({ timeout: 5000 });
    seen.weekTable = await marksOf('[data-testid="chip-list"] [data-testid="week-list-visit"]');
    seen.weekTableHidden = true;
    await page.keyboard.press('Escape');
  } else seen.weekTable = await marksOf('[data-testid="week-tvisit"]');
  check(
    seen.weekTable.m !== null,
    '印：週の表でその訪問の札（隠れていれば「+N」の一覧の行）が見つかる',
    seen.weekTable,
  );
  await page.goto(`${BASE}#/month?ym=${fx.date.slice(0, 7)}&layout=calendar`);
  await page.getByTestId('month-grid').waitFor({ timeout: 30000 });
  await settle(page, 300);
  await page.locator(`[data-testid="month-day"][data-date="${fx.date}"]`).click();
  await page.getByTestId('month-day-visits').waitFor({ timeout: 10000 });
  seen.month = await marksOf('[data-testid="month-visit"]');
  await page.goto(`${BASE}#/plan?date=${fx.date}`);
  await page.locator('.tl-band-btn').first().waitFor({ timeout: 60000 });
  await settle(page, 300);
  const dayBtn = page.locator(`.tl-band[data-visit="${fx.id}"] .tl-band-btn`).first();
  seen.day = {
    m: await dayBtn.getAttribute('data-marks', { timeout: 15000 }).catch(() => null),
    s: await dayBtn.getAttribute('data-size').catch(() => null),
  };
  const ms = [seen.weekTimeline, seen.weekTable, seen.month, seen.day].map((x) => x.m);
  check(
    new Set(ms).size === 1 && /\bpin\b/.test(ms[0] ?? '') && /\b(issue|unfit)\b/.test(ms[0] ?? ''),
    '印：ピンと要対応（限✗）の訪問の data-marks が週の時間軸・週の表の札・月の一覧の行・日の予定の帯で同じ',
    seen,
  );
  check(
    seen.weekTimeline.s === 'l' && seen.day.s === 'l' && seen.month.s === 'm' && ['s', 'm'].includes(seen.weekTable.s),
    '印：大きさは時間軸 l・表の札 s・リストの行 m',
    seen,
  );
}

// ---- 印刷：「+N」の一覧と選択の帯を出さない ----
async function print(page) {
  const fx = await fresh(page, '/week?view=table', '[data-testid="week-tvisit"]', crowd);
  if (!fx) return check(false, '印刷：準備');
  const id = await page.$$eval(
    '[data-testid="week-tvisit"]',
    (els, today) => els.find((e) => (e.closest('[data-date]')?.dataset.date ?? '') > today)?.dataset.visit,
    TODAY,
  );
  await page.locator(`[data-testid="week-tvisit"][data-visit="${id}"]`).click({ modifiers: [MOD] });
  await page
    .locator(`[data-testid="week-cell"][data-date="${fx.day}"][data-staff="${fx.staff}"]`)
    .getByTestId('chip-more')
    .click();
  await page.getByTestId('chip-list').waitFor({ timeout: 5000 });
  check(
    (await page.getByTestId('selection-bar').count()) === 1 && (await page.getByTestId('chip-list').count()) === 1,
    '印刷の前：一覧と選択の帯が出ている',
  );
  await page.emulateMedia({ media: 'print' });
  const shown = await page.evaluate(() => {
    const vis = (sel) => {
      const el = document.querySelector(sel);
      return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
    };
    return { list: vis('[data-testid="chip-list"]'), bar: vis('[data-testid="selection-bar"]') };
  });
  check(!shown.list && !shown.bar, '印刷：「+N」の一覧と選択の帯を出さない', shown);
  await page.emulateMedia({ media: 'screen' });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

// ---- 390px：週の表の長押し・月の下から出る欄 ----
async function narrow(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await fresh(page, '/week?view=table', '[data-testid="week-tvisit"]');
  const id = await page.$$eval(
    '[data-testid="week-tvisit"]',
    (els, today) => els.find((e) => (e.closest('[data-date]')?.dataset.date ?? '') > today)?.dataset.visit ?? null,
    TODAY,
  );
  if (!id) {
    check(false, '390px：週の表に今日より後の札');
  } else {
    const chip = page.locator(`[data-testid="week-tvisit"][data-visit="${id}"]`);
    await chip.scrollIntoViewIfNeeded();
    const b = await chip.boundingBox();
    await page.mouse.move(b.x + 4, b.y + 4);
    await page.mouse.down();
    // 長押しの時間（500ms）そのものを見るので固定の待ち
    await page.waitForTimeout(700);
    await page.mouse.up();
    await settle(page, 200);
    check(
      (await countText(page)) === '1件を選択' &&
        (await chip.getAttribute('aria-pressed')) === 'true' &&
        (await chip.getAttribute('data-size')) === 's' &&
        (await panel(page).count()) === 0,
      '390px：週の表の札を長押しすると選ぶ形に入って選ぶ（欄は開かない）',
    );
    await shot(page, 'week-chips-390');
    await page.getByTestId('selection-clear').click();
    await settle(page, 150);
  }
  // 月：一覧の行を押すと下から出る欄
  await page.goto(`${BASE}#/month?ym=${TODAY.slice(0, 7)}`);
  await page.locator('[data-testid="month-list-day"]').first().waitFor({ timeout: 30000 });
  await settle(page, 300);
  const d = await stored(page);
  const counts = new Map();
  for (const v of d.visits) if (v.date > TODAY && !v.cancelled) counts.set(v.date, (counts.get(v.date) ?? 0) + 1);
  const day = [...counts.keys()].sort().find((x) => x.slice(0, 7) === TODAY.slice(0, 7) && counts.get(x) >= 2);
  if (!day) {
    check(false, '390px：今月の今日より後に訪問が2件以上ある日');
    return;
  }
  const row = page.locator(`[data-testid="month-list-day"][data-date="${day}"]`);
  await row.scrollIntoViewIfNeeded();
  await row.click();
  const sheet = page.getByTestId('month-day-sheet');
  await sheet.waitFor({ timeout: 5000 });
  await settle(page, 400);
  const rows = sheet.getByTestId('month-visit');
  check(
    hashOf(page).startsWith('#/month') && (await sheet.getAttribute('data-date')) === day && (await rows.count()) >= 2,
    '390px：月の一覧の行を押すと下から出る欄（その日の訪問の行）',
    { hash: hashOf(page), rows: await rows.count() },
  );
  check(
    (await page.getByTestId('month-select').count()) === 1 &&
      (await page.getByTestId('month-day-visits-plan').count()) === 1,
    '390px：欄に「選ぶ」と「この日の日の予定を開く」',
  );
  const fit = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="month-day-sheet"]');
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, sw: document.documentElement.scrollWidth, w: window.innerWidth };
  });
  check(fit.left >= 0 && fit.right <= fit.w + 1 && fit.sw <= fit.w + 1, '390px：下から出る欄がはみ出さない', fit);
  // 長押しで選ぶ → 欄の中の選択の帯（担当を替える・取り消すだけ。時刻をずらす・別の日へは出ない）
  const sel = await rows.evaluateAll((els) =>
    els.filter((e) => e.getAttribute('aria-disabled') !== 'true').map((e) => e.dataset.visit),
  );
  const first = sheet.locator(`[data-testid="month-visit"][data-visit="${sel[0]}"]`);
  const fb = await first.boundingBox();
  await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
  await page.mouse.down();
  // 長押しの時間そのものを見るので固定の待ち
  await page.waitForTimeout(700);
  await page.mouse.up();
  await settle(page, 200);
  const bar = sheet.getByTestId('selection-bar');
  check(
    (await bar.count()) === 1 &&
      (await countText(page)) === '1件を選択' &&
      (await panel(page).count()) === 0 &&
      (await bar.evaluate((el) => el.classList.contains('is-inline'))),
    '390px：欄の行を長押しすると選ぶ（欄の中の選択の帯・is-inline）',
  );
  check(
    (await page.getByTestId('selection-move').count()) === 0 &&
      (await page.getByTestId('selection-shift').count()) === 0 &&
      (await bar.getByTestId('selection-assign').count()) === 1 &&
      (await bar.getByTestId('selection-cancel').count()) === 1,
    '390px：欄の選択の帯は担当を替える・取り消すだけ（時刻をずらす・別の日へは出ない）',
  );
  await shot(page, 'month-sheet-390');
  // 「選ぶ」→ 1件選ぶ → Esc で欄を閉じても選択は残る（ページの選択の帯）
  await bar.getByTestId('selection-clear').click();
  await settle(page, 150);
  if ((await page.getByTestId('month-select').getAttribute('aria-pressed')) !== 'true')
    await page.getByTestId('month-select').click();
  await settle(page, 150);
  await sheet.locator(`[data-testid="month-visit"][data-visit="${sel[0]}"]`).click();
  await settle(page, 200);
  check((await countText(page)) === '1件を選択', '390px：「選ぶ」のあと行を押すと選ぶ');
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  await settle(page, 300);
  check(
    (await sheet.count()) === 0 &&
      (await page.getByTestId('selection-bar').count()) === 1 &&
      (await countText(page)) === '1件を選択',
    '390px：Esc で下から出る欄を閉じても選択は残る（ページの選択の帯に「1件を選択」）',
  );
  await page.getByTestId('selection-clear').click();
  await settle(page, 150);
  // 欄を開き直し（選ぶ形は抜けている）、行を押すと欄を閉じて訪問の詳細の欄
  await row.click();
  await sheet.waitFor({ timeout: 5000 });
  await settle(page, 300);
  if ((await page.getByTestId('month-select').getAttribute('aria-pressed')) === 'true')
    await page.getByTestId('month-select').click();
  await settle(page, 150);
  await sheet.locator(`[data-testid="month-visit"][data-visit="${sel[0]}"]`).click();
  await panel(page)
    .waitFor({ timeout: 5000 })
    .catch(() => {});
  check(
    (await sheet.count()) === 0 &&
      (await panel(page)
        .getAttribute('data-visit')
        .catch(() => null)) === sel[0],
    '390px：欄の行を押すと下から出る欄を閉じて訪問の詳細の欄',
  );
  await closePanel(page);
  await settle(page, 300);
  check(
    await page.evaluate((d) => {
      const a = document.activeElement;
      return a?.dataset?.testid === 'month-list-day' && a.dataset.date === d;
    }, day),
    '390px：訪問の詳細の欄を閉じるとフォーカスはその日の行（month-list-day）',
    await page.evaluate(() => `${document.activeElement?.dataset?.testid ?? document.activeElement?.tagName}`),
  );
  // カレンダーのマスでも同じ欄
  await page.goto(`${BASE}#/month?ym=${TODAY.slice(0, 7)}&layout=calendar`);
  await page.getByTestId('month-grid').waitFor({ timeout: 30000 });
  await settle(page, 300);
  await page.locator(`[data-testid="month-day"][data-date="${day}"]`).click();
  await sheet.waitFor({ timeout: 5000 }).catch(() => {});
  check(
    (await sheet.getAttribute('data-date').catch(() => null)) === day && hashOf(page).startsWith('#/month'),
    '390px：カレンダーのマスを押しても下から出る欄',
  );
  await page.setViewportSize({ width: 1400, height: 1000 });
}

const steps = sharedPage({
  open: async () => {
    const s = await openPage({ context: { hasTouch: true } });
    const confirms = await answerConfirms(s.page);
    await s.ctx.route(/tile|cyberjapandata/, (r) => r.fulfill({ status: 204, body: '' }));
    return { ...s, confirms };
  },
  call: (fn, s) => fn(s.page, s),
  steps: [
    ['week-chips', weekChips],
    ['week-keys', weekKeys],
    ['week-drag', weekDrag],
    ['week-clients', weekClients],
    ['week-client-keys', weekClientKeys],
    ['month-cells', monthCells],
    ['month-move', monthMove],
    ['same-marks', sameMarks],
    ['print', print],
    ['narrow', narrow],
  ],
  after: ({ confirms }) => {
    check(confirms.native.length === 0, 'ブラウザのダイアログを出さない', confirms.native);
  },
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
