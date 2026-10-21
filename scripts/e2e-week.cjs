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

/** 週を送ると、?client= が無ければその週の先頭8人（データを作って、今週の先頭の人を次の週は取り消す） */
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
      to.setUTCDate(to.getUTCDate() + 7);
      const end = to.toISOString().slice(0, 10);
      for (const v of d.visits) if (v.clientId === cid && v.date >= from && v.date < end) v.cancelled = true;
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

// ---- この週の案を作る・確定（PRD D280・D282。ADR-0046）：月をまたぐ週で、未作成 → 作る → 確定 → 済み ----
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
/** 日の見出しの件数の文と未作成の件数（日付の順） */
const headsOf = (page) =>
  page
    .getByTestId('week-day-count')
    .evaluateAll((els) => els.map((e) => ({ text: e.innerText, unmade: Number(e.dataset.unmade) })));
const nextKind = (page) => page.getByTestId('week-next').getAttribute('data-kind');
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORAGE_KEY);

async function weekUnmade(page) {
  await page.setViewportSize({ width: 1400, height: 1000 });
  check(!!CROSS, '月をまたぐ週がある（作る・確定を2つの月で確かめる前提）', TODAY);
  if (!CROSS) return;
  // 案を全部消し、後ろの月の日の定期パターンの訪問を消して「未作成」にする（前の月の日は訪問あり・案なし）
  await page.goto(`${BASE}#/week?d=${CROSS.start}`);
  const removed = await page.evaluate(
    ([k, later]) => {
      const d = JSON.parse(localStorage.getItem(k));
      d.aiPlans = {};
      d.aiRuns = {};
      d.manualPlans = {};
      const before = d.visits.length;
      d.visits = d.visits.filter((v) => !(v.pattern && later.includes(v.date)));
      localStorage.setItem(k, JSON.stringify(d));
      return before - d.visits.length;
    },
    [STORAGE_KEY, CROSS.later],
  );
  await open(page, `/week?d=${CROSS.start}`);
  await page.getByTestId('week-next').waitFor({ timeout: 30000 });
  const heads = await headsOf(page);
  const at = (d) => heads[CROSS.dates.indexOf(d)];
  const laterHeads = CROSS.later.map(at);
  check(
    laterHeads.some((h) => h.text === '未作成' && h.unmade > 0) &&
      laterHeads.every((h) => h.text !== '0件' || h.unmade === 0),
    '未作成の日は「0件」でなく「未作成」（PRD D282）',
    { removed, laterHeads },
  );
  const firstFuture = CROSS.future.filter((d) => !CROSS.later.includes(d)).map(at);
  check(
    firstFuture.every((h) => /^\d+件・案なし$|^0件$/.test(h.text)),
    '訪問のある日は「N件・案なし」、本当に訪問の無い日は「0件」',
    firstFuture,
  );
  // 主ボタンは見出しの「この週の案を作る（N日）」の1つ。N＝今日以降の、訪問がある日と未作成の日
  const want = CROSS.future.map(at).filter((h) => h.text !== '0件').length;
  const label = await page.getByTestId('week-next-btn').innerText();
  check(
    (await nextKind(page)) === 'make' && label.includes(`この週の案を作る（${want}日）`),
    '週の主ボタン：この週の案を作る（N日）',
    { label, want },
  );
  check(
    (await page.locator('.btn-primary').count()) === 1,
    '週の予定の主ボタンは1つ',
    await page.locator('.btn-primary').allInnerTexts(),
  );
  // 月のマスでも、未作成の日と本当に0件の日を分ける
  const ym2 = CROSS.later[0].slice(0, 7);
  await page.goto(`${BASE}#/month?ym=${ym2}&layout=calendar`);
  await page.locator('[data-testid="month-day"]').first().waitFor({ timeout: 30000 });
  await settle(page, 300);
  const cells = await page
    .locator('[data-testid="month-day"]')
    .evaluateAll((els) => Object.fromEntries(els.map((e) => [e.dataset.date, e.dataset.unmade ?? null])));
  check(
    CROSS.later.some((d) => Number(cells[d]) > 0) && (await page.getByTestId('month-unmade').count()) > 0,
    '月のマスでも未作成の日に「未作成」',
    CROSS.later.map((d) => `${d}:${cells[d]}`),
  );
  // 390px：主ボタンが画面の中に入り、横にはみ出さない
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, `/week?d=${CROSS.start}&view=timeline`);
  const box = await page.getByTestId('week-next-btn').boundingBox();
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(box && box.x >= 0 && box.x + box.width <= 390 && sw <= 390, '390px：週の主ボタンが画面に入る', { box, sw });
  await page.screenshot({ path: path.join(OUT_DIR, 'week-make-390.png') });
  await page.setViewportSize({ width: 1400, height: 1000 });
}

async function weekMake(page) {
  if (!CROSS) return check(false, 'week-make：月をまたぐ週が無い');
  await page.setViewportSize({ width: 1400, height: 1000 });
  await open(page, `/week?d=${CROSS.start}`);
  await page.getByTestId('week-next-btn').waitFor({ timeout: 30000 });
  const want = Number(/（(\d+)日）/.exec(await page.getByTestId('week-next-btn').innerText())?.[1] ?? 0);
  await page.getByTestId('week-next-btn').click();
  await page.getByTestId('batch-band').waitFor({ timeout: 10000 });
  const bandText = await page.getByTestId('batch-band-text').innerText();
  check(
    bandText.startsWith(`${md(CROSS.start)}〜${md(CROSS.dates[6])}の週の案を作っています`) &&
      (await page.getByTestId('batch-band-text').getAttribute('href')) === `#/week?d=${CROSS.start}`,
    '作っている間は上の帯に週の進み具合（行き先はその週の週の予定）',
    bandText,
  );
  check(urlOf(page).includes(`#/week?d=${CROSS.start}`), '作っている間も週の予定にとどまる', urlOf(page));
  check(
    (await nextKind(page)) === 'making' &&
      (await page.getByTestId('week-next-btn').getAttribute('aria-disabled')) === 'true',
    '作っている間の主ボタンは「この週の案を作っています…」で押せない',
  );
  await page.waitForFunction(
    () => document.querySelector('[data-testid="week-next"]')?.dataset.kind !== 'making',
    null,
    {
      timeout: 150000,
    },
  );
  const toast = page.locator('.toast').filter({ hasText: /の週の案を\d+日分作りました/ });
  await toast.first().waitFor({ timeout: 10000 });
  const tt = await toast.first().innerText();
  check(
    tt.includes(`${md(CROSS.start)}〜${md(CROSS.dates[6])}の週の案を${want}日分作りました`) &&
      (await toast.first().getByTestId('batch-done-open').count()) === 0,
    '作り終えた知らせ（その週を見ているので［週の予定を見る］は出さない）',
    { tt, want },
  );
  await settle(page, 500);
  const heads = await headsOf(page);
  const future = CROSS.future.map((d) => heads[CROSS.dates.indexOf(d)]);
  check(
    future.every((h) => !/未作成|案なし/.test(h.text)),
    '作ると今日以降の日の「未作成」「案なし」が消える',
    future,
  );
  const d = await stored(page);
  const months = [...new Set(CROSS.future.filter((x) => d.aiPlans[x]).map((x) => x.slice(0, 7)))];
  check(
    months.length === 2 && CROSS.dates.filter((x) => x < TODAY).every((x) => !d.aiPlans[x]),
    '週の作るは2つの月の日に案を作り、今日より前の日は作らない',
    { months, plans: Object.keys(d.aiPlans).sort() },
  );
  check(
    Object.keys(d.aiPlans).every((x) => x >= CROSS.start && x <= CROSS.dates[6]),
    '週の外の日は作らない（月のまとめて作るとの違い）',
    Object.keys(d.aiPlans).sort(),
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
    '作り終えたら主ボタンは「この週の問題の無い日をまとめて確定（N日）」',
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
  check(Object.keys((await stored(page)).manualPlans).length === 0, '取り消すと何も確定しない');
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
    listed.every((x) => !!d.manualPlans[x]) && Object.keys(d.manualPlans).length === k,
    '確定した日の割当を書く（この週の日だけ）',
    Object.keys(d.manualPlans).sort(),
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

const steps = sharedPage({
  steps: [
    ['views', views],
    ['handoff', handoff],
    ['handoff-staff', handoffViaStaff],
    ['back', back],
    ['fold-1400', (p) => fold(p, 1400, 1000)],
    ['fold-390', (p) => fold(p, 390, 844)],
    // データを書き換えるので後ろに
    ['next-week', nextWeek],
    ['search', search],
    // この週の案を作る・確定（PRD D280・D282）。データを書き換えるので最後に
    ['week-unmade', weekUnmade],
    ['week-make', weekMake],
    ['week-confirm', weekConfirm],
  ],
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
