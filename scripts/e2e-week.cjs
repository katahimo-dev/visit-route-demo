// 週間の時間軸の「〈利用者さん〉で見る」のつなぎこみ（PRD D136〜D140。ADR-0024 追記）を本物のブラウザで確かめる：
// 表示の切り替えは1つ（PRD D188：4つの表示・古い ?view=・?by= の URL で同じ表示・押したときの URL・390px で2段まで）、
// 表からの引き継ぎ（絞り込みなし＝書かない・あり＝先頭8人）、9人目の上限の文、戻るボタンで選択が戻り上限の文が消える、
// 畳む・「あと N人」（1400px・390px。選んでいる人はいつも見え、選んでいない人は2行まで。開いた状態は週を送っても表と行き来しても残る）、
// 週を送ると その週の先頭8人（データを作って確かめる）、「ほかの人を探す」で選んだ この週に訪問の無い人がチップの後ろに出る。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-week.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { BASE, OUT_DIR, TODAY, STORAGE_KEY, check, urlOf, runSteps, settle } = require('./lib/env.cjs');
const { sharedPage } = require('./lib/steps.cjs');

const addDays = (d, n) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const monday = (d) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
const NEXT_MON = addDays(monday(TODAY), 7);

const chipsOf = (page) => page.getByTestId('week-client-chips').getByTestId('pick-chip');
const pressedIds = (page) =>
  chipsOf(page).evaluateAll((els) =>
    els.filter((e) => e.getAttribute('aria-pressed') === 'true').map((e) => e.dataset.id),
  );
const allIds = (page) => chipsOf(page).evaluateAll((els) => els.map((e) => e.dataset.id));

async function open(page, hash) {
  await page.goto(`${BASE}#${hash}`);
  await page.reload();
  await page.getByTestId('week-grid').or(page.getByTestId('week-client-filter')).first().waitFor({ timeout: 30000 });
  await settle(page, 500);
}
async function expandChips(page) {
  const more = page.getByTestId('week-client-chips-more');
  if ((await more.count()) > 0 && (await more.getAttribute('aria-expanded')) === 'false') await more.click();
  await settle(page, 100);
}

/** 表示の切り替えは1つ（PRD D188）：4つの表示・古い URL で同じ表示・押すと今までのクエリで書く・390px で2段まで */
const VIEW_IDS = ['by-staff', 'by-client', 'tab-table', 'tab-clients'];
const pressedView = (page) =>
  page
    .getByTestId('week-views')
    .locator('button')
    .evaluateAll((els) => els.filter((e) => e.getAttribute('aria-pressed') === 'true').map((e) => e.dataset.testid));
async function shownView(page) {
  if ((await page.getByTestId('week-table').count()) > 0) return 'tab-table';
  if (
    (await page.getByTestId('week-client-table').count()) > 0 ||
    (await page.getByTestId('week-client-filter').count()) > 0
  )
    return 'tab-clients';
  if ((await page.getByTestId('week-client-chips').count()) > 0) return 'by-client';
  if ((await page.getByTestId('staff-chips').count()) > 0) return 'by-staff';
  return '?';
}
async function views(page) {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await open(page, '/week');
  const names = await page.getByTestId('week-views').locator('button').allInnerTexts();
  check(
    JSON.stringify(names) ===
      JSON.stringify(['時間軸：スタッフ', '時間軸：利用者さん', 'スタッフ×曜日', '利用者さん×曜日']),
    '表示の切り替えは1つで4つの表示',
    names,
  );
  check(
    (await page.locator('.week-head fieldset.segmented').count()) === 1 &&
      (await page.locator('.week-by').count()) === 0,
    '「見る人」の2つ目の切り替えは無い',
  );
  check((await page.getByTestId('week-views').getAttribute('aria-label')) === '表示', '切り替えの名前は「表示」');
  // 古い URL（?view= と ?by= の組み合わせ）で開いても今までと同じ表示
  for (const [hash, want] of [
    ['/week', 'by-staff'],
    ['/week?by=client', 'by-client'],
    ['/week?view=timeline', 'by-staff'],
    ['/week?view=timeline&by=staff', 'by-staff'],
    ['/week?view=timeline&by=client', 'by-client'],
    ['/week?view=table', 'tab-table'],
    ['/week?view=table&by=client', 'tab-table'],
    ['/week?view=clients', 'tab-clients'],
    ['/week?view=clients&by=client', 'tab-clients'],
  ]) {
    await page.goto(`${BASE}#${hash}`);
    await page.reload();
    await page
      .getByTestId('week-grid')
      .or(page.getByTestId('week-client-filter'))
      .or(page.getByTestId('week-table'))
      .first()
      .waitFor({ timeout: 30000 });
    await settle(page, 300);
    const pressed = await pressedView(page);
    const shown = await shownView(page);
    check(JSON.stringify(pressed) === JSON.stringify([want]) && shown === want, `古い URL ${hash} → ${want}`, {
      pressed,
      shown,
    });
  }
  // 押すと今までのクエリで書く（時間軸は ?view= を書かない・表では ?by= を消す）。?d= は残す
  await open(page, `/week?d=${NEXT_MON}`);
  const want = {
    'by-client': (u) => /by=client/.test(u) && !/view=/.test(u) && !/client=/.test(u.replace('by=client', '')),
    'tab-table': (u) => /view=table/.test(u) && !/by=/.test(u),
    'tab-clients': (u) => /view=clients/.test(u) && !/by=/.test(u),
    'by-staff': (u) => !/view=/.test(u) && !/by=/.test(u),
  };
  for (const id of ['by-client', 'tab-table', 'tab-clients', 'by-staff']) {
    await page.getByTestId(id).click();
    await settle(page, 400);
    const u = urlOf(page);
    check(
      want[id](u) &&
        u.includes(`d=${NEXT_MON}`) &&
        (await shownView(page)) === id &&
        JSON.stringify(await pressedView(page)) === JSON.stringify([id]),
      `押して ${id}：表示と URL`,
      u,
    );
    if (id === 'by-client') {
      check((await pressedIds(page)).length === 8, '時間軸：利用者さん は先頭8人（URL に書かない。PRD D137）');
    }
  }
  // 今の表示を押しても何もしない（履歴を増やさない）
  const before = urlOf(page);
  const len = await page.evaluate(() => history.length);
  await page.getByTestId('by-staff').click();
  await settle(page, 200);
  check(urlOf(page) === before && (await page.evaluate(() => history.length)) === len, '今の表示を押しても何もしない');
  // 戻るで1つ前の表示（表）に戻る
  await page.goBack();
  await settle(page, 400);
  check((await shownView(page)) === 'tab-clients', '戻るで1つ前の表示に戻る');
  await page.screenshot({ path: path.join(OUT_DIR, 'week-views-1400.png') });

  // 390px：切り替えは幅に収まり2段まで（前は 表示・見る人 で3段）
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/week?by=client');
  const boxes = await page
    .getByTestId('week-views')
    .locator('button')
    .evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect()).map((r) => ({ top: Math.round(r.top), left: r.left, right: r.right })),
    );
  const rowsN = new Set(boxes.map((b) => b.top)).size;
  check(rowsN <= 2 && boxes.every((b) => b.left >= 0 && b.right <= 390), '390px：表示の切り替えは幅に収まり2段まで', {
    rowsN,
    boxes,
  });
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  check(scrollW <= 390, '390px：ページが横にはみ出さない', scrollW);
  for (const id of VIEW_IDS) {
    const r = await page.getByTestId(id).boundingBox();
    check(r && r.height >= 30, `390px：${id} は押せる大きさ`, r);
  }
  await page.screenshot({ path: path.join(OUT_DIR, 'week-views-390.png') });
  await page.setViewportSize({ width: 1400, height: 1000 });
}

/** 表から時間軸へ：絞り込んでいなければ書かない（先頭8人）、絞り込んでいればその先頭8人（PRD D139） */
async function handoff(page) {
  await open(page, '/week?view=clients&by=client');
  await page.getByTestId('by-client').click();
  await settle(page, 300);
  check(
    !urlOf(page).includes('client=') && (await pressedIds(page)).length === 8,
    '表（絞り込みなし）→時間軸：先頭8人・URL に書かない',
    urlOf(page),
  );
  await page.getByTestId('tab-clients').click();
  await page.getByTestId('week-client-filter-input').fill('館');
  await settle(page, 800);
  const rows = await page
    .getByTestId('week-client-table')
    .locator('tbody tr')
    .evaluateAll((els) =>
      els.map((e) => e.querySelector('[data-client]')?.dataset.client ?? e.dataset.client).filter(Boolean),
    );
  await page.getByTestId('by-client').click();
  await settle(page, 300);
  const m = urlOf(page).match(/client=([^&]*)/);
  const written = m ? m[1].split(',') : [];
  const pressed = await pressedIds(page);
  check(
    written.length > 0 &&
      written.length <= 8 &&
      JSON.stringify([...pressed].sort()) === JSON.stringify([...written].sort()),
    '表（絞り込みあり）→時間軸：表の先頭8人を ?client= に書いてチップも同じ',
    { written, pressed, rows: rows.length },
  );
}

/** 表から「時間軸：スタッフ」へ移っても ?client= を書き、そのあと「時間軸：利用者さん」で引き継がれる（D139。PR #44 のレビュー） */
async function handoffViaStaff(page) {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await open(page, '/week?view=clients');
  await page.getByTestId('week-client-filter-input').fill('館');
  await settle(page, 800);
  await page.getByTestId('by-staff').click();
  await settle(page, 300);
  const m = urlOf(page).match(/client=([^&]*)/);
  const written = m ? m[1].split(',') : [];
  check(
    written.length > 0 && written.length <= 8 && !/by=/.test(urlOf(page)),
    '表→時間軸：スタッフ でも ?client= を書く',
    urlOf(page),
  );
  await page.getByTestId('by-client').click();
  await settle(page, 300);
  const pressed = await pressedIds(page);
  check(
    JSON.stringify([...pressed].sort()) === JSON.stringify([...written].sort()),
    'そのあと 時間軸：利用者さん で表の人が引き継がれる',
    { written, pressed },
  );
}

/** 「ほかの人を探す」：この週に訪問の無い人を選ぶと、チップの後ろに✓付きで出る */
async function search(page) {
  await page.goto(`${BASE}#/week`);
  await page.evaluate((key) => {
    const d = JSON.parse(localStorage.getItem(key));
    const c = d.clients.find((x) => x.active);
    d.clients.push({
      ...c,
      id: 'e2e-nov',
      displayName: 'ほか テスト',
      kana: 'ほかてすと',
      usualStaffId: null,
      allowedStaffIds: [],
    });
    localStorage.setItem(key, JSON.stringify(d));
  }, STORAGE_KEY);
  await open(page, '/week?by=client');
  await page.getByTestId('week-client-chips-none').click();
  await page.getByTestId('week-client-search').locator('summary').click();
  await page.getByTestId('week-client-picker-input').fill('ほか てすと');
  await page.getByTestId('week-client-picker-option').filter({ hasText: 'ほか テスト' }).click();
  await settle(page, 300);
  await expandChips(page);
  const ids = await allIds(page);
  check(
    ids.at(-1) === 'e2e-nov' &&
      JSON.stringify(await pressedIds(page)) === '["e2e-nov"]' &&
      urlOf(page).includes('client=e2e-nov'),
    '「ほかの人を探す」で選んだ人がチップの後ろに出る',
    { last: ids.at(-1) },
  );
}

/** 戻るボタン：選択が戻り、上限の文は消える */
async function back(page) {
  await open(page, '/week?by=client');
  await expandChips(page);
  const first = await pressedIds(page);
  await chipsOf(page).first().click(); // 1人外す（URL に書く）
  await settle(page, 200);
  const after = await pressedIds(page);
  await chipsOf(page).first().click(); // 戻す（8人＝初期値なので URL から消える）
  await settle(page, 200);
  await chipsOf(page).nth(8).click(); // 9人目：上限の文
  await settle(page, 300);
  const msg = await page.getByTestId('week-client-chips-message').innerText();
  check(msg.includes('8人まで') && (await pressedIds(page)).length === 8, '9人目は選ばずに上限の文', msg);
  await page.goBack();
  await settle(page, 400);
  check(
    JSON.stringify(await pressedIds(page)) === JSON.stringify(after) &&
      (await page.getByTestId('week-client-chips-message').innerText()) === '',
    '戻るで1つ前の選択に戻り、上限の文は消える',
    { first: first.length, after: after.length, url: urlOf(page) },
  );
  // 枠はいつも描く（読み上げの live 領域を消さない）
  check((await page.getByTestId('week-client-chips-message').count()) === 1, '上限の文の枠は空でも残る');
}

/** 畳む・あと N人：選んでいる人はいつも見え、開いた状態は週を送っても表との行き来でも残る */
async function fold(page, w, h) {
  await page.setViewportSize({ width: w, height: h });
  await open(page, '/week?by=client');
  const more = page.getByTestId('week-client-chips-more');
  const shown = await allIds(page);
  const pressed = await pressedIds(page);
  const n = Number(((await more.innerText()).match(/\d+/) ?? ['0'])[0]);
  const rows = await page.getByTestId('week-client-chips').evaluate((root) => {
    const tops = new Set();
    for (const el of root.querySelectorAll('[data-fold-item]')) {
      if (!el.querySelector('[aria-pressed="true"]')) tops.add(Math.round(el.getBoundingClientRect().top));
    }
    return tops.size;
  });
  check(
    n > 0 &&
      pressed.length === 8 &&
      pressed.every((id) => shown.includes(id)) &&
      rows <= 2 &&
      (await more.getAttribute('aria-expanded')) === 'false',
    `${w}px：畳むと選んでいる人と2行ぶんだけ（あと N人）`,
    { shown: shown.length, n, rows },
  );
  await more.click();
  await settle(page, 150);
  const all = await allIds(page);
  check(
    all.length === shown.length + n && (await more.innerText()) === '畳む',
    `${w}px：「あと N人」で全員を出す`,
    all.length,
  );
  await page.getByLabel('次の週').click();
  await settle(page, 400);
  await page.getByTestId('tab-clients').click();
  await page.getByTestId('by-client').click();
  await settle(page, 300);
  check((await more.getAttribute('aria-expanded')) === 'true', `${w}px：開いた状態は週を送っても表と行き来しても残る`);
  const gridTop = () => page.getByTestId('week-grid').evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  const grid = { y: await gridTop() };
  await more.click();
  await settle(page, 150);
  const grid2 = { y: await gridTop() };
  console.log(
    `  ${w}px：時間軸の上端（ページの上から） ${Math.round(grid2.y)}px（開いたとき ${Math.round(grid.y)}px・画面の高さ ${h}px）`,
  );
  await page.screenshot({ path: path.join(OUT_DIR, `week-fold-${w}.png`) });
}

/** 週を送ると、?client= が無ければその週の先頭8人（データを作って、今週の先頭の人の繰り返しを今週で終わらせる） */
async function nextWeek(page) {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await open(page, '/week?by=client');
  await expandChips(page);
  const thisWeek = await allIds(page);
  const top = thisWeek[0];
  await page.evaluate(
    ([key, cid, from]) => {
      const d = JSON.parse(localStorage.getItem(key));
      const to = new Date(`${from}T00:00:00Z`);
      to.setUTCDate(to.getUTCDate() + 6);
      const end = to.toISOString().slice(0, 10);
      // 版2：繰り返しの回は保存せず計算するので、その人の繰り返しを次の週の前の日で終わらせ、保存した回は取り消す
      const prev = new Date(`${from}T00:00:00Z`);
      prev.setUTCDate(prev.getUTCDate() - 1);
      const last = prev.toISOString().slice(0, 10);
      for (const p of d.patterns) if (p.clientId === cid && (!p.to || p.to > last)) p.to = last;
      for (const v of d.visits) if (v.clientId === cid && v.date >= from && v.date <= end) v.cancelled = true;
      localStorage.setItem(key, JSON.stringify(d));
    },
    [STORAGE_KEY, top, NEXT_MON],
  );
  await open(page, '/week?by=client');
  await page.getByLabel('次の週').click();
  await settle(page, 500);
  await expandChips(page);
  const ids = await allIds(page);
  const pressed = await pressedIds(page);
  check(
    !ids.includes(top) &&
      JSON.stringify(pressed) === JSON.stringify(ids.slice(0, 8)) &&
      !urlOf(page).includes('client='),
    '週を送ると、その週の先頭8人（前の週の人は残らない）',
    { top, pressed },
  );
}

// ---- この週の担当を AI で組む・確定（PRD D280。ADR-0046・ADR-0053）：月をまたぐ週で、担当なし → 組む → 確定 → 済み ----
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const dayLabel = (d) => `${md(d)}（${WD[new Date(`${d}T00:00:00Z`).getUTCDay()]}）`;
/**
 * 今日以降の日が2つの月にまたがる週（今週から順に探す。どの FAKE_NOW でも月の変わり目は5週以内にある）。
 * later は後ろの月の日（今日以降）
 */
const CROSS = (() => {
  for (let w = 0; w < 7; w++) {
    const start = addDays(monday(TODAY), 7 * w);
    const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const future = dates.filter((d) => d >= TODAY);
    const months = [...new Set(future.map((d) => d.slice(0, 7)))];
    if (months.length === 2) return { start, dates, future, later: future.filter((d) => d.slice(0, 7) === months[1]) };
  }
  return null;
})();
/** 日の見出しの件数の文（日付の順） */
const headsOf = (page) =>
  page.getByTestId('week-day-count').evaluateAll((els) => els.map((e) => ({ text: e.innerText })));
const nextKind = (page) => page.getByTestId('week-next').getAttribute('data-kind');
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORAGE_KEY);
/** 担当をすべて外す（繰り返しの担当・保存した訪問の担当・伝えた内容）。ページの中で動かす */
const unassignAll = (k) => {
  const d = JSON.parse(localStorage.getItem(k));
  for (const p of d.patterns) p.usualStaffId = null;
  d.visits = d.visits.map((v) => ({ ...v, staffId: null, pinned: false }));
  d.snapshots = {};
  localStorage.setItem(k, JSON.stringify(d));
};

/** 「AI で組む ▾」の「この週」の項目（開いて返す。閉じるのは呼ぶ側） */
async function scopeWeekItem(page) {
  await page.getByTestId('plan-menu').click();
  await page.getByTestId('plan-menu-list').waitFor();
  return page.getByTestId('ai-scope-week');
}
/** 「AI で組む ▾」の「この週」で組み始める（ADR-0054。週の主ボタンは確定だけ） */
async function startWeek(page) {
  const item = await scopeWeekItem(page);
  await item.click();
}
const rangeBand = (page) => page.locator('[data-testid="proposal-band"][data-kind="range"]');

async function weekPrep(page) {
  await page.setViewportSize({ width: 1400, height: 1000 });
  check(!!CROSS, '月をまたぐ週がある（組む・確定を2つの月で確かめる前提）', TODAY);
  if (!CROSS) return;
  // 担当をすべて外す（訪問のある日は「N件・担当なしM」）
  await page.goto(`${BASE}#/week?d=${CROSS.start}`);
  await page.evaluate(unassignAll, STORAGE_KEY);
  await open(page, `/week?d=${CROSS.start}`);
  await page.getByTestId('week-next').waitFor({ timeout: 30000 });
  const heads = await headsOf(page);
  const at = (d) => heads[CROSS.dates.indexOf(d)];
  const future = CROSS.future.map(at);
  check(
    future.every((h) => /^\d+件・担当なし\d+$|^0件$/.test(h.text)),
    '訪問のある日は「N件・担当なしM」、訪問の無い日は「0件」',
    future,
  );
  // 組むのは操作の行の「AI で組む ▾」の「この週」（日・週・月で同じ入口。ADR-0054）。週の主ボタンは確定だけ
  check(
    ['rest', 'none', 'done'].includes(await nextKind(page)) && (await page.getByTestId('week-next-btn').count()) === 0,
    '担当なしの日しか無ければ、週の主ボタン（確定）は出さない（組むボタンも無い）',
    await nextKind(page),
  );
  const item = await scopeWeekItem(page);
  const itemText = await item.innerText();
  check(
    (await item.getAttribute('aria-disabled')) !== 'true' &&
      itemText.startsWith(`この週（${md(CROSS.start)}〜${md(CROSS.dates[6])}）を組む`),
    '「AI で組む ▾」に「この週（M/D〜M/D）を組む」',
    itemText,
  );
  await page.keyboard.press('Escape');
  check((await page.getByTestId('progress-band').count()) === 0, '週は進み具合の帯を出さない（月だけ）');
  check((await page.getByTestId('week-status').count()) === 1, '週は1行の状態');
  check(
    (await page.locator('.btn-primary').count()) <= 1,
    '週の予定の主ボタンは1つまで',
    await page.locator('.btn-primary').allInnerTexts(),
  );
  // 月のマスでも担当なしの日に「担当なし N」
  const ym2 = CROSS.later[0].slice(0, 7);
  await page.goto(`${BASE}#/month?ym=${ym2}&layout=calendar`);
  await page.locator('[data-testid="month-day"]').first().waitFor({ timeout: 30000 });
  await settle(page, 300);
  const flagged = await page
    .locator('[data-testid="month-day"]')
    .evaluateAll((els) =>
      els.filter((e) => e.querySelector('[data-testid="month-unassigned"]')).map((e) => e.dataset.date),
    );
  check(
    CROSS.later.some((d) => flagged.includes(d)),
    '月のマスでも担当なしの日に「担当なし N」',
    CROSS.later.map((d) => `${d}:${flagged.includes(d)}`),
  );
  // 390px：操作の行が画面の中に入り、横にはみ出さない
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, `/week?d=${CROSS.start}&view=timeline`);
  const box = await page.getByTestId('schedule-toolbar').boundingBox();
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(box && box.x >= 0 && box.x + box.width <= 390 && sw <= 390, '390px：週の操作の行が画面に入る', { box, sw });
  await page.screenshot({ path: path.join(OUT_DIR, 'week-make-390.png') });
  await page.setViewportSize({ width: 1400, height: 1000 });
}

async function weekMake(page) {
  if (!CROSS) return check(false, 'week-make：月をまたぐ週が無い');
  await page.setViewportSize({ width: 1400, height: 1000 });
  await open(page, `/week?d=${CROSS.start}`);
  await page.getByTestId('week-next').waitFor({ timeout: 30000 });
  const want = (await headsOf(page)).filter((h, i) => CROSS.dates[i] >= TODAY && /担当なし/.test(h.text)).length;
  await startWeek(page);
  await page.getByTestId('batch-band').waitFor({ timeout: 10000 });
  const bandText = await page.getByTestId('batch-band-text').innerText();
  check(
    bandText.startsWith(`${md(CROSS.start)}〜${md(CROSS.dates[6])}の週の担当を組んでいます`) &&
      (await page.getByTestId('batch-band-text').getAttribute('href')) === `#/week?d=${CROSS.start}`,
    '作っている間は上の帯に週の進み具合（行き先はその週の週の予定）',
    bandText,
  );
  check(urlOf(page).includes(`#/week?d=${CROSS.start}`), '作っている間も週の予定にとどまる', urlOf(page));
  check(
    (await nextKind(page)) === 'making' &&
      (await page.getByTestId('week-next-btn').getAttribute('aria-disabled')) === 'true',
    '組んでいる間の主ボタンは「この週の担当を組んでいます…」で押せない',
  );
  await page.waitForFunction(
    () => document.querySelector('[data-testid="week-next"]')?.dataset.kind !== 'making',
    null,
    {
      timeout: 150000,
    },
  );
  const toast = page.locator('.toast').filter({ hasText: /の週の提案を出しました/ });
  await toast.first().waitFor({ timeout: 10000 });
  const tt = await toast.first().innerText();
  check(
    tt.includes(`${md(CROSS.start)}〜${md(CROSS.dates[6])}の週の提案を出しました`) &&
      (await toast.first().getByTestId('batch-done-open').count()) === 0,
    '組み終えた知らせ（提案の帯が見えるので［週の予定を見る］は出さない）',
    { tt, want },
  );
  // 提案（範囲）：反映するまで訪問は変わらない → 反映する
  await rangeBand(page).waitFor({ timeout: 10000 });
  const before = await stored(page);
  check(
    before.visits.every((v) => !v.staffId),
    '提案を出しただけでは訪問は変わらない',
  );
  check(Number(await rangeBand(page).getByTestId('proposal-moved').innerText()) > 0, '提案の帯：担当が変わる件数');
  await rangeBand(page).getByTestId('proposal-apply').click();
  await rangeBand(page).waitFor({ state: 'detached', timeout: 10000 });
  await settle(page, 500);
  const heads = await headsOf(page);
  const future = CROSS.future.map((d) => heads[CROSS.dates.indexOf(d)]);
  const left = future.filter((h) => /担当なし/.test(h.text)).length;
  check(left < want, '組むと今日以降の日の「担当なし」が減る', future);
  const d = await stored(page);
  const assigned = [...new Set(d.visits.filter((v) => v.staffId).map((v) => v.date))].sort();
  const months = [...new Set(assigned.map((x) => x.slice(0, 7)))];
  check(
    months.length === 2 && assigned.every((x) => x >= TODAY),
    '週の組むは2つの月の日に担当を書き、今日より前の日は組まない',
    { months, assigned },
  );
  check(
    assigned.every((x) => x >= CROSS.start && x <= CROSS.dates[6]),
    '週の外の日は組まない（月の担当を AI で組むとの違い）',
    assigned,
  );
}

async function weekConfirm(page) {
  if (!CROSS) return check(false, 'week-confirm：月をまたぐ週が無い');
  await open(page, `/week?d=${CROSS.start}`);
  await page.getByTestId('week-next').waitFor({ timeout: 30000 });
  await page
    .waitForFunction(() => document.querySelector('[data-testid="week-next"]')?.dataset.kind === 'confirm', null, {
      timeout: 30000,
    })
    .catch(() => {});
  const label = await page.getByTestId('week-next').innerText();
  const k = Number(/まとめて確定（(\d+)日）/.exec(label)?.[1] ?? 0);
  check(
    (await nextKind(page)) === 'confirm' && k > 0,
    '組み終えたら主ボタンは「この週の問題の無い日をまとめて確定（N日）」',
    label,
  );
  await page.getByTestId('week-next-btn').click();
  const dlg = page.getByTestId('confirm-dialog');
  await dlg.waitFor({ timeout: 5000 });
  const title = await page.getByTestId('confirm-title').innerText();
  const body = await page.getByTestId('confirm-body').innerText();
  const listed = CROSS.future.filter((x) => body.includes(dayLabel(x)));
  check(
    title === `問題の無い ${k}日を確定しますか？` && body.includes(`計 ${k}日`) && listed.length === k,
    '確認：月のまとめて確定と同じ型（見出し・日付・計 N日）で、範囲はこの週',
    { title, body },
  );
  check(new Set(listed.map((x) => x.slice(0, 7))).size === 2, '確認：2つの月の日をまとめて確定する', listed);
  check(
    (await page.evaluate(() => document.activeElement?.dataset.testid)) === 'confirm-cancel',
    '確認：最初のフォーカスは取り消し',
  );
  await page.getByTestId('confirm-cancel').click();
  await dlg.waitFor({ state: 'detached' });
  check(Object.keys((await stored(page)).snapshots).length === 0, '取り消すと何も確定しない');
  await page.getByTestId('week-next-btn').click();
  await dlg.waitFor({ timeout: 5000 });
  await page.getByTestId('confirm-ok').click();
  await page
    .locator('.toast')
    .filter({ hasText: `${k}日を確定しました` })
    .first()
    .waitFor({ timeout: 5000 });
  await settle(page, 500);
  const d = await stored(page);
  check(
    listed.every((x) => !!d.snapshots[x]) && Object.keys(d.snapshots).length === k,
    '確定した日の伝えた内容を書く（この週の日だけ）',
    Object.keys(d.snapshots).sort(),
  );
  const kind = await nextKind(page);
  check(
    kind === 'done' || kind === 'rest',
    '確定したあとは「済み」（残る日があれば日の予定で）。主ボタンは無くなる',
    kind,
  );
  check(
    (await page.evaluate(() => document.activeElement?.dataset.testid)) === 'week-next',
    '確定したあと、フォーカスは主ボタンの場所（body に落とさない）',
    await page.evaluate(() => document.activeElement?.dataset.testid ?? document.activeElement?.tagName),
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'week-confirmed.png') });
}

/** 月をまたぐ週の次の週（後ろの月の中の週。今日以降の7日） */
const W2 = CROSS ? addDays(CROSS.start, 7) : null;
/**
 * week-busy で月の予定のまとめて作るを動かす月（W2 の次の月。W2 の週には触れない）と、その月の後ろのほうの週
 * （まとめて作るは日付の順に作るので、確かめる前にこの週の日へ届かないよう月の後ろの週にする）
 */
const YM3 = W2
  ? (() => {
      const [y, m] = W2.slice(0, 7).split('-').map(Number);
      return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    })()
  : null;
const W3 = YM3 ? monday(`${YM3}-22`) : null;
const W2_LABEL = W2 ? `${md(W2)}〜${md(addDays(W2, 6))}の週` : '';
/**
 * 計算（Worker のスクリプト）の読み込みを止めておく（作成を1日目のまま続けるため。速い端末では確かめる前に作り終わる）。
 * 返す関数で通す
 */
async function holdWorker(page) {
  let release = () => {};
  const held = new Promise((r) => {
    release = r;
  });
  const hold = async (route) => {
    await held;
    await route.continue().catch(() => {});
  };
  await page.route('**/worker-*.js', hold);
  return async () => {
    release();
    await page.unroute('**/worker-*.js', hold).catch(() => {});
  };
}
/** 上の帯（作っている間）が消えるまで待つ */
const bandGone = (page, timeout = 60000) => page.getByTestId('batch-band').waitFor({ state: 'detached', timeout });

/** 月の予定でまとめて作っている間に同じ月の週を開く：週の主ボタンは押せず、理由を見える文で（PRD D280） */
async function weekBusy(page) {
  if (!YM3) return check(false, 'week-busy：月をまたぐ週が無い');
  const ym = YM3;
  await page.evaluate(unassignAll, STORAGE_KEY);
  await page.goto(`${BASE}#/month?ym=${ym}&layout=calendar`);
  await page.reload();
  await page.getByTestId('band-next').waitFor({ timeout: 30000 });
  check(
    (await page.getByTestId('band-next').getAttribute('data-kind')) === 'batch',
    '月の予定：次の一手は「担当を AI で組む」（前提）',
  );
  // 計算の読み込みを止めておき、月の作成が1日目のまま続くようにする
  const release = await holdWorker(page);
  try {
    await page.getByTestId('band-next').click();
    const panel = page.getByRole('dialog', { name: `${Number(ym.slice(5, 7))}月の担当を AI で組む` });
    await panel.waitFor({ timeout: 10000 });
    await panel.getByRole('button', { name: '組み始める' }).click();
    await page.getByTestId('month-progress').waitFor({ timeout: 10000 });
    // 読み直さずに同じ月の週の予定へ（作り続けている）
    await page.evaluate((w) => {
      location.hash = `#/week?d=${w}`;
    }, W3);
    await page.getByTestId('schedule-toolbar').waitFor({ timeout: 30000 });
    await page.getByTestId('batch-band').waitFor({ timeout: 10000 });
    const item = await scopeWeekItem(page);
    const itemText = await item.innerText();
    check(
      (await item.getAttribute('aria-disabled')) === 'true' && /ほかの担当を組んでいます/.test(itemText),
      '月の予定で担当を組んでいる間は、「AI で組む ▾」の「この週」は押せず理由',
      itemText,
    );
    // 押せない項目は押しても何もしない
    await item.click({ force: true });
    await settle(page, 300);
    await page.keyboard.press('Escape');
    check(
      (await page.getByTestId('week-next').getAttribute('data-kind')) !== 'making' &&
        (await page.locator('.toast').filter({ hasText: 'の週の' }).count()) === 0,
      '押せない「この週」を押しても週の組むは始まらない',
    );
    // 後始末：月の作成を止める
    await page.getByTestId('batch-band-stop').click();
  } finally {
    // 計算の読み込みを通す（落ちても次の段を止めない）。止めた日は計算が読み込まれてから終わる
    await release();
  }
  await bandGone(page);
}

/** 週の作るを上の帯の［止める］で止める：作った日は残り、主ボタンは「作る」に戻る */
async function weekStop(page) {
  if (!W2) return check(false, 'week-stop：月をまたぐ週が無い');
  await open(page, `/week?d=${W2}`);
  await page.getByTestId('week-next').waitFor({ timeout: 30000 });
  const n0 = (await headsOf(page)).filter((h) => /^\d+件/.test(h.text) && !/^0件$/.test(h.text)).length;
  check(n0 >= 2, '止める前：この週に訪問のある日が2日以上', n0);
  // 1日目を作っている間に止める（計算の読み込みを止めておく）
  const release = await holdWorker(page);
  try {
    await startWeek(page);
    await page.getByTestId('batch-band').waitFor({ timeout: 10000 });
    check(
      (await page.getByTestId('batch-band').getAttribute('aria-label')) === `${W2_LABEL}の担当を組む進み具合`,
      '上の帯の名前は週の文言',
      await page.getByTestId('batch-band').getAttribute('aria-label'),
    );
    await page.getByTestId('batch-band-stop').click();
  } finally {
    await release();
  }
  await bandGone(page);
  const toast = page.locator('.toast').filter({ hasText: `${W2_LABEL}の担当を` });
  await toast.first().waitFor({ timeout: 10000 });
  const tt = await toast.first().innerText();
  await rangeBand(page).waitFor({ timeout: 10000 });
  const bt = await rangeBand(page).innerText();
  const n1 = Number(/・(\d+)日分）/.exec(bt)?.[1] ?? 0);
  check(
    /組んだところで止めました/.test(tt) && /途中までの最良/.test(bt) && n1 > 0 && n1 < n0,
    '［止める］で止まり、そこまでの日の提案（途中までの最良）が出る',
    { tt, bt, n0, n1 },
  );
  await rangeBand(page).getByTestId('proposal-discard').click();
  await rangeBand(page).waitFor({ state: 'detached' });
}

/** 別の週を見ている間に週の作るが終わる：知らせに［週の予定を見る］、押すとその週 */
async function weekDoneElsewhere(page) {
  if (!W2) return check(false, 'week-done-elsewhere：月をまたぐ週が無い');
  await open(page, `/week?d=${W2}`);
  await page.getByTestId('week-next').waitFor({ timeout: 30000 });
  await startWeek(page);
  await page.getByTestId('batch-band').waitFor({ timeout: 10000 });
  // 読み直さずに別の週へ（作り続けている）
  await page.evaluate((w) => {
    location.hash = `#/week?d=${w}`;
  }, CROSS.start);
  await page
    .getByTestId('week-title')
    .filter({ hasText: md(CROSS.start) })
    .waitFor({ timeout: 10000 });
  const toast = page.locator('.toast').filter({ hasText: `${W2_LABEL}の提案を出しました` });
  await toast.first().waitFor({ timeout: 150000 });
  // 提案の帯は日・週・月の予定のどこにも出るので、別の週を見ていても帯で見られる（［週の予定を見る］は出さない）
  check(
    (await toast.first().getByTestId('batch-done-open').count()) === 0,
    '別の週を見ている間に終わっても、提案の帯が見えるので知らせにボタンは出さない',
    await toast.first().innerText(),
  );
  await rangeBand(page).waitFor({ timeout: 10000 });
  check((await rangeBand(page).innerText()).includes(W2_LABEL), '別の週の画面にも組んだ週の提案の帯', W2_LABEL);
  // ホームでは帯が見えないので、終わった知らせに［週の予定を見る］（次の組む）
  await rangeBand(page).getByTestId('proposal-discard').click();
  await page.goto(`${BASE}#/home`);
  await page.locator('h1').waitFor();
  await open(page, `/week?d=${W2}`);
  await startWeek(page);
  await page.getByTestId('batch-band').waitFor({ timeout: 10000 });
  await page.evaluate(() => {
    location.hash = '#/home';
  });
  const toast2 = page.locator('.toast').filter({ hasText: `${W2_LABEL}の提案を出しました` });
  await toast2.first().waitFor({ timeout: 150000 });
  const open2 = toast2.first().getByTestId('batch-done-open');
  check(
    (await open2.count()) === 1 && (await open2.innerText()).includes('週の予定を見る'),
    '予定でない画面にいる間に終わると、知らせに［週の予定を見る］',
    await toast2.first().innerText(),
  );
  await open2.click();
  await page.waitForFunction((w) => location.hash === `#/week?d=${w}`, W2, { timeout: 10000 });
  check(urlOf(page).includes(`#/week?d=${W2}`), '［週の予定を見る］で作った週の週の予定へ', urlOf(page));
  // hash が変わってから週の予定を描き終わるまで（移るのは transition なので、遅い機械では前の画面がしばらく残る）を目印で待つ
  await page
    .getByTestId('week-title')
    .filter({ hasText: md(W2) })
    .waitFor({ timeout: 15000 })
    .catch(() => {});
  await rangeBand(page)
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  check((await rangeBand(page).count()) === 1, '移った先で提案の帯が見える');
}

/** 表の絞り込みに「訪問の種類」（PRD D285）：種類ごとのチップ（人数つき）→押すとその種類の訪問がある人に絞る（URL の ?cf= に type:）→再読み込み・戻るで戻る */
async function visitType(page) {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await open(page, '/week?view=clients');
  const filter = page.getByTestId('week-client-filter');
  const chips = filter.getByTestId('week-client-filter-type');
  const n = await chips.count();
  const countOf = async (loc) =>
    Number(((await loc.locator('.client-filter-count').textContent()) ?? '').replace(/\D/g, ''));
  const shownCount = async () =>
    Number(
      (((await page.getByTestId('week-client-filter-count').textContent()) ?? '').split('／')[0] ?? '').replace(
        /\D/g,
        '',
      ),
    );
  const before = await shownCount();
  check(n > 0, '表の絞り込みに「訪問の種類」のチップが出る', { n });
  let target = null;
  for (let i = 0; i < n && !target; i++) {
    const c = chips.nth(i);
    if ((await c.getAttribute('aria-disabled')) === null && (await countOf(c)) < before) target = c;
  }
  target ??= chips.first();
  const label = (await target.textContent()) ?? '';
  const want = await countOf(target);
  await target.click();
  await settle(page, 500);
  const after = await shownCount();
  check(
    (await target.getAttribute('aria-pressed')) === 'true' &&
      after === want &&
      /type:/.test(decodeURIComponent(urlOf(page))),
    '種類のチップを押すと、その種類の訪問がある人（チップの人数）に絞られ、URL に書く',
    { label, want, before, after },
  );
  // 押した種類の人数が表の行の数と合う
  const rows = await page.getByTestId('week-client-table').locator('tbody tr').count();
  check(rows >= after && after > 0, '表の行も絞られる', { rows, after });
  await page.reload();
  await settle(page, 800);
  check(
    (await filter
      .getByTestId('week-client-filter-type')
      .filter({ hasText: label.replace(/\d+人?$/, '') })
      .first()
      .getAttribute('aria-pressed')) === 'true' && (await shownCount()) === after,
    '再読み込みしても種類の絞り込みが残る',
    { after },
  );
  // 種類で絞ったまま時間軸へ移ると、絞った人の先頭8人を引き継ぐ（PRD D139。時間軸の〈利用者さん〉の選び方は表から引き継ぐ）
  await page.getByTestId('by-client').click();
  await settle(page, 300);
  const m = urlOf(page).match(/client=([^&]*)/);
  const written = m ? m[1].split(',') : [];
  check(
    written.length === Math.min(8, after) &&
      JSON.stringify([...written].sort()) === JSON.stringify([...(await pressedIds(page))].sort()),
    '種類で絞ったまま時間軸へ移ると、その種類の人の先頭8人を引き継ぐ',
    { written, after },
  );
  await open(page, '/week?view=clients');
  await page.getByTestId('week-client-filter-type').first().click();
  await settle(page, 300);
  await page.getByTestId('week-client-filter-reset').click();
  await settle(page, 400);
  check(
    (await shownCount()) === before && !/type:/.test(decodeURIComponent(urlOf(page))),
    '「絞り込みを戻す」で種類も戻る',
    {
      before,
    },
  );
}

const steps = sharedPage({
  steps: [
    ['views', views],
    ['handoff', handoff],
    ['handoff-staff', handoffViaStaff],
    ['back', back],
    ['visit-type', visitType],
    ['fold-1400', (p) => fold(p, 1400, 1000)],
    ['fold-390', (p) => fold(p, 390, 844)],
    // データを書き換えるので後ろに
    ['next-week', nextWeek],
    ['search', search],
    // この週の担当を AI で組む・確定（PRD D280）。データを書き換えるので最後に
    ['week-prep', weekPrep],
    ['week-make', weekMake],
    ['week-confirm', weekConfirm],
    ['week-busy', weekBusy],
    ['week-stop', weekStop],
    ['week-done-elsewhere', weekDoneElsewhere],
  ],
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
