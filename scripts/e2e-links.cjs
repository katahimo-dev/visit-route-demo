// 行き止まりの所から次の画面へ移る道（PRD D201〜D204。ADR-0025 追記）を本物のブラウザで確かめる：
// 月の要対応の行き先（入らない訪問 → 日の画面の「入らなかった訪問」へ巻く・休みの人に残る訪問 → その日の「欠勤・キャンセル」の欄・
// 拘束が上限を超える → 稼働の見込みをその月・その人で・そのほか → 日の画面。行き先の文「（〜で開く）」・`?do=` は消える）、
// 稼働の見込みの日ごとの表の日付と〈スタッフ〉×日の表のマスから日の画面（マスに名前の吹き出しを付けない）、
// 稼働時間の右の欄から「欠勤・キャンセル」の欄（その人の2段目。欠勤が無ければ登録の文）、空き状況の右の欄の日ごとの結果から日の画面。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-links.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { skipTour } = require('./lib/tourSeen.cjs');
const { answerConfirms } = require('./lib/confirmDialog.cjs');
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

/** 「10/21」の形（月の要対応の日付の文） */
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
/** 日の画面で選んでいる日付 */
const dayOf = (page) => page.locator('.date-switch select').inputValue();

/**
 * 画面を新しく開く（e2e-home と同じ：同じ文書の中で hash を移すと `?do=` が先に処理されることがあるので、about:blank を挟む）
 */
async function open(page, hash, ready) {
  await page.goto('about:blank');
  await page.goto(`${BASE}#${hash}`);
  await page.locator(ready).first().waitFor({ timeout: 30000 });
  await settle(page, 300);
}
/** 日の画面が開いてその日を選んでいる（移ったあと） */
async function onPlan(page, date) {
  await page.waitForURL(/#\/plan/, { timeout: 10000 });
  await page.locator('.date-switch select').waitFor({ timeout: 30000 });
  await page
    .waitForFunction((d) => document.querySelector('.date-switch select')?.value === d, date, { timeout: 10000 })
    .catch(() => {});
  return (await dayOf(page)) === date;
}
/** 日の画面の案ができるまで待つ（e2e-rebuild と同じ） */
async function planReady(page) {
  await page.getByTestId('confirm-state').waitFor({ timeout: 60000 });
  await page.waitForFunction(
    () => {
      const s = document.querySelector('[data-testid="band-day"]')?.dataset.state;
      return s === 'plan' || s === 'confirmed';
    },
    null,
    { timeout: 60000 },
  );
}
/**
 * 「入らなかった訪問」の列へ巻いたか：ページが巻かれていて（scrollY > 0）、列の上端が画面の上半分にある。
 * 巻かずに開くと列は画面の下の方（1280×900 で上から 640px ほど）・scrollY は 0 なので、巻かなければ通らない。
 * 待っても巻かれなければ false（NG に数える）
 */
async function scrolledToNone(page, timeout = 15000) {
  return page
    .waitForFunction(
      () => {
        const el = document.querySelector('.route-col-none');
        if (!el) return false;
        const top = el.getBoundingClientRect().top;
        return window.scrollY > 0 && top >= -2 && top < window.innerHeight * 0.5;
      },
      null,
      { timeout },
    )
    .then(() => true)
    .catch(() => false);
}
/** 巻いていない（対照）：しばらく待っても scrollY が 0 で、列が画面の上半分に来ていない */
async function notScrolled(page, ms = 1500) {
  await settle(page, ms);
  return page.evaluate(() => {
    const el = document.querySelector('.route-col-none');
    const top = el ? el.getBoundingClientRect().top : Number.POSITIVE_INFINITY;
    return window.scrollY === 0 && top >= window.innerHeight * 0.5;
  });
}
/** ページの一番上へ戻す（同じ文書の中で開き直す前に） */
const toTop = (page) => page.evaluate(() => window.scrollTo(0, 0));
/** 同じ文書の中で hash を変える（読み直さない） */
const setHash = (page, hash) =>
  page.evaluate((h) => {
    location.hash = h;
  }, hash);

// ---- 用意：今日より後の、訪問のある日（SECOND）に案を作り、入らない訪問・欠勤の人に残る訪問・拘束の上限超えを作る ----
let SECOND = '';
let YM2 = '';
/** 欠勤にした人・その日に欠勤の無い人 */
let ABSENT = '';
let PRESENT = '';
async function prepare(page) {
  await open(page, '/plan', '.date-switch select');
  await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
  await page.reload();
  await page.locator('.date-switch select').waitFor({ timeout: 30000 });
  const options = await page.locator('.date-switch select option').evaluateAll((os) => os.map((o) => o.value));
  SECOND = options.find((d) => d > TODAY) ?? '';
  YM2 = SECOND.slice(0, 7);
  check(SECOND !== '', '用意：今日より後の日がある', SECOND);
  await page.locator('.date-switch select').selectOption(SECOND);
  await planReady(page);
  await page.waitForFunction(
    ({ k, d }) => !!JSON.parse(localStorage.getItem(k) ?? '{}').aiPlans?.[d],
    { k: STORAGE_KEY, d: SECOND },
    { timeout: 60000 },
  );
  // 別のタブで書く（storage の知らせでこのタブのデータも入れ替わる。e2e-view の names() と同じ）
  const other = await page.context().newPage();
  await other.goto(`${BASE}#/data`);
  const picked = await other.evaluate(
    ({ k, d }) => {
      const data = JSON.parse(localStorage.getItem(k));
      const plan = data.aiPlans[d];
      const staffWith = Object.keys(plan.routes).filter((s) => s !== '__none' && plan.routes[s].length > 0);
      // 1人目の最初の訪問を「入らない」にする
      const a = staffWith[0];
      const vid = plan.routes[a][0];
      plan.routes[a] = plan.routes[a].slice(1);
      plan.unassigned = [...(plan.unassigned ?? []), vid];
      // 2人目を終日の欠勤にする（訪問が残る）
      const absent = staffWith[1];
      data.absences = [
        ...data.absences.filter((x) => !(x.staffId === absent && x.date === d)),
        { id: `e2e-links-${absent}`, staffId: absent, date: d, from: null, to: null, note: '' },
      ];
      // 拘束の上限を1時間にして、上限を超える人を出す
      data.org.spanLimitHours = 1;
      localStorage.setItem(k, JSON.stringify(data));
      const present = data.staff.find(
        (s) => s.active && s.id !== absent && !data.absences.some((x) => x.staffId === s.id && x.date === d),
      );
      return { absent, present: present?.id ?? '' };
    },
    { k: STORAGE_KEY, d: SECOND },
  );
  await other.close();
  ABSENT = picked.absent;
  PRESENT = picked.present;
  await settle(page, 300);
}

/** 月の画面の要対応の行（SECOND の、その種類） */
async function attentionRow(page, kind) {
  await open(page, `/month?ym=${YM2}&do=attention`, '[data-testid="month-attention"]');
  return page
    .locator(`.month-attention-btn.is-${kind}`)
    .filter({ hasText: md(SECOND) })
    .first();
}

// ---- D201 月の要対応 ----
async function attention(page) {
  await prepare(page);
  // 入らない訪問 → 日の画面の「入らなかった訪問」の列へ巻く
  let row = await attentionRow(page, 'unassigned');
  check((await row.count()) === 1, '要対応に「入らない訪問」の行がある', SECOND);
  check(
    (await row.innerText()).includes('（日の予定の「入らなかった訪問」で開く）'),
    '入らない訪問：行き先の文',
    await row.innerText(),
  );
  check((await row.locator('button, a').count()) === 0, '行の中にボタンを入れ子にしない');
  await row.click();
  check(await onPlan(page, SECOND), '入らない訪問 → その日の「日の予定」', await dayOf(page));
  await page.locator('.route-col-none').first().waitFor({ timeout: 30000 });
  check(await scrolledToNone(page), '入らない訪問 → 「入らなかった訪問」の列へ巻いて見せる');
  check(!/do=|date=/.test(hashOf(page)), '入らない訪問 → ?do=・?date= は消える', hashOf(page));
  await page.screenshot({ path: path.join(OUT_DIR, 'links-unassigned.png') });

  // 対照：?do= 無しで同じ日を開くと巻かない
  await open(page, '/plan', '.date-switch select');
  await page.locator('.date-switch select').selectOption(SECOND);
  await page.locator('.route-col-none').first().waitFor({ timeout: 30000 });
  check(await notScrolled(page), '対照：?do= 無しで開くと「入らなかった訪問」へ巻かない');

  // 同じ文書の中で hash を変える：同じ日を開いているとき
  await toTop(page);
  await setHash(page, `#/plan?date=${SECOND}&do=unassigned`);
  check(await scrolledToNone(page), '同じ文書・同じ日：?do=unassigned で巻く');
  check(hashOf(page) === '#/plan', '同じ文書・同じ日：?do= は消える', hashOf(page));
  // 同じ文書の中で hash を変える：別の日を開いているとき
  await page.locator('.date-switch select').selectOption(TODAY);
  await settle(page, 300);
  await toTop(page);
  await setHash(page, `#/plan?date=${SECOND}&do=unassigned`);
  check(await onPlan(page, SECOND), '同じ文書・別の日：その日を選ぶ', await dayOf(page));
  check(await scrolledToNone(page), '同じ文書・別の日：?do=unassigned で巻く');

  // URL から直接（?date=…&do=unassigned）。今日を選んでいても、その日を選んで巻く
  await open(page, '/plan', '.date-switch select');
  await page.locator('.date-switch select').selectOption(TODAY);
  await settle(page, 300);
  await open(page, `/plan?date=${SECOND}&do=unassigned`, '.date-switch select');
  check(await onPlan(page, SECOND), '?date=…&do=unassigned でその日を選ぶ', await dayOf(page));
  check(await scrolledToNone(page), '?do=unassigned で「入らなかった訪問」の列へ巻く');
  check(hashOf(page) === '#/plan', '?do=unassigned は読んだら消す', hashOf(page));
  check((await page.getByTestId('tour').count()) === 0, '?do= のリンクでは案内ツアーを出さない');

  // 休みの人に訪問が残る → その日の「欠勤・キャンセル」の欄（1段目）
  row = await attentionRow(page, 'absentLeft');
  check((await row.count()) === 1, '要対応に「休みの人に訪問」の行がある');
  check(
    (await row.innerText()).includes('（日の予定の「欠勤・キャンセル」で開く）'),
    '休みの人に訪問：行き先の文',
    await row.innerText(),
  );
  await row.click();
  check(await onPlan(page, SECOND), '休みの人に訪問 → その日の「日の予定」', await dayOf(page));
  await page.getByTestId('sudden-panel').waitFor({ timeout: 10000 });
  check(
    (await page.locator('h3.sudden-step-title').textContent()) === '何が起きましたか？',
    '休みの人に訪問 → 「欠勤・キャンセル」の欄の1段目',
  );
  check(!/do=|date=/.test(hashOf(page)), '休みの人に訪問 → ?do=・?date= は消える', hashOf(page));
  await page.screenshot({ path: path.join(OUT_DIR, 'links-absent-left.png') });

  // 拘束が上限を超える → 稼働の見込み（その月・その人）
  row = await attentionRow(page, 'overSpan');
  check((await row.count()) === 1, '要対応に「出勤〜退勤（拘束）が上限を超える」の行がある');
  check((await row.innerText()).includes('（勤務の見込みで開く）'), '拘束の上限：行き先の文', await row.innerText());
  const to = (await row.getAttribute('data-to')) ?? '';
  const sid = new URLSearchParams(to.split('?')[1] ?? '').get('staff') ?? '';
  await row.click();
  await page.waitForURL(/#\/workload/, { timeout: 10000 });
  await page.getByTestId('work-staff').waitFor({ timeout: 30000 });
  check(
    hashOf(page) === `#/workload?ym=${YM2}&staff=${sid}`,
    '拘束の上限 → 勤務の見込み（その月・その人）',
    hashOf(page),
  );
  check(
    sid !== '' && (await page.getByTestId('work-staff').inputValue()) === sid,
    '勤務の見込み：その人を日ごとに選んでいる',
    { sid, value: await page.getByTestId('work-staff').inputValue() },
  );
  check(
    (await page.locator('.work-nav').innerText()).includes(`${Number(YM2.slice(5, 7))}月`),
    '勤務の見込み：その月を開いている',
  );
  check(
    (await page.getByTestId('work-detail').locator(`[data-testid="work-day-open"][data-date="${SECOND}"]`).count()) ===
      1,
    '勤務の見込み：選んだ人の日ごとの表にその日がある',
  );

  // そのほか（欠勤がある）→ 今のまま日の画面
  row = await attentionRow(page, 'absence');
  check((await row.innerText()).includes('（日の予定で開く）'), 'そのほか：行き先の文', await row.innerText());
  await row.click();
  check(await onPlan(page, SECOND), '欠勤がある → その日の「日の予定」', await dayOf(page));
  check((await page.getByTestId('sudden-panel').count()) === 0, '欠勤がある → 欄は開かない（今のまま）');
  check(hashOf(page) === '#/plan', '欠勤がある → URL は /plan', hashOf(page));
}

// ---- D201 案の無い日：自動作成のあとに巻く・自動作成が走らないなら忘れる（PR #48 のレビュー）----
async function noPlanDay(page) {
  await prepare(page);
  const options = await page.locator('.date-switch select option').evaluateAll((os) => os.map((o) => o.value));
  const third = options.find((d) => d > SECOND) ?? '';
  check(third !== '', '用意：案の無い日がある', third);
  // 別のタブで書く（e2e-view の names() と同じ）
  const edit = async (fn) => {
    const other = await page.context().newPage();
    await other.goto(`${BASE}#/data`);
    await other.evaluate(fn, { k: STORAGE_KEY, d: third });
    await other.close();
    await settle(page, 300);
  };
  // その日に誰も入れない夜中の訪問を足し（入らない訪問になる）、案を消しておく
  await edit(({ k, d }) => {
    const data = JSON.parse(localStorage.getItem(k));
    const base = data.visits.find((v) => v.date === d && !v.cancelled);
    data.visits.push({
      ...base,
      id: 'e2e-links-night',
      earliestStart: '03:00',
      latestStart: '03:00',
      staffId: null,
      pattern: null,
    });
    delete data.aiPlans[d];
    localStorage.setItem(k, JSON.stringify(data));
  });
  // 案の無い日を ?do=unassigned で開く：自動作成のあとに巻く
  await open(page, `/plan?date=${third}&do=unassigned`, '.date-switch select');
  check(await onPlan(page, third), '案の無い日：その日を選ぶ', await dayOf(page));
  await planReady(page);
  check(await scrolledToNone(page, 60000), '案の無い日：自動作成のあとに「入らなかった訪問」へ巻く');
  // 案を消し（この文書ではもう自動作成しない日）、同じ文書で ?do=unassigned を受ける → 巻かずに忘れる
  await edit(({ k, d }) => {
    const data = JSON.parse(localStorage.getItem(k));
    delete data.aiPlans[d];
    localStorage.setItem(k, JSON.stringify(data));
  });
  const makeBtn = page.locator('.card .btn-primary', { hasText: 'AI案を作る' });
  await makeBtn.waitFor({ timeout: 10000 });
  await toTop(page);
  await setHash(page, `#/plan?date=${third}&do=unassigned`);
  await page.waitForFunction(() => location.hash === '#/plan', null, { timeout: 5000 }).catch(() => {});
  check(hashOf(page) === '#/plan', '自動作成が走らない日：?do= は消える', hashOf(page));
  // あとで「AI案を作る」を押しても急に巻かない
  await settle(page, 500);
  await makeBtn.click();
  await planReady(page);
  await page.locator('.route-col-none').first().waitFor({ timeout: 30000 });
  check(await notScrolled(page, 2000), '自動作成が走らない日：あとで「AI案を作る」を押しても巻かない');
}

// ---- D202 稼働の見込み ----
async function workload(page) {
  await prepare(page);
  await open(page, `/workload?ym=${YM2}`, '[data-testid="work-detail"]');
  // 選んだ人の日ごとの表の日付
  const link = page.getByTestId('work-day-open').first();
  const d1 = (await link.getAttribute('data-date')) ?? '';
  check(
    /（日の予定で開く）$/.test((await link.getAttribute('aria-label')) ?? ''),
    '日ごとの表の日付：読み上げに「（日の予定で開く）」',
    await link.getAttribute('aria-label'),
  );
  await link.click();
  check(await onPlan(page, d1), '日ごとの表の日付 → その日の「日の予定」', { d1, now: await dayOf(page) });
  // 〈スタッフ〉×日の表のマス（今日でない日・上限を超えるマス）
  await open(page, `/workload?ym=${YM2}`, '[data-testid="work-grid"]');
  const grid = page.getByTestId('work-grid');
  check(
    (await grid.locator('[data-testid="person-btn"]').count()) === 0,
    '〈スタッフ〉×日の表に名前の吹き出しを付けない（D124）',
  );
  const cell = grid.locator(`.work-cell.is-over .work-cell-btn[data-date="${SECOND}"]`).first();
  check((await cell.count()) === 1, '上限を超えるマス（「!」）がある', SECOND);
  const label = (await cell.getAttribute('aria-label')) ?? '';
  const num = ((await cell.locator('.work-cell-num').textContent()) ?? '').replace('（上限を超える）', '').trim();
  check(
    label.startsWith(num) && /^\d+\.\d!$/.test(num) && /上限を超える（日の予定で開く）$/.test(label),
    'マス：読み上げの先頭は見えている数字、続けて内訳と「（日の予定で開く）」',
    { num, label },
  );
  check(!!(await cell.getAttribute('title')), 'マス：内訳の title は今どおり');
  const note = await page.getByTestId('work-grid-note').innerText();
  check(
    note.includes('内訳は下の「日ごと」の表で') && !note.includes('指を置く'),
    'マスの説明：タッチでも成り立つ文（内訳は「日ごと」の表）',
    note,
  );
  // キーボードで押せる
  await cell.focus();
  await page.keyboard.press('Enter');
  check(await onPlan(page, SECOND), 'マス → その日の「日の予定」（キーボード）', await dayOf(page));
  await page.screenshot({ path: path.join(OUT_DIR, 'links-workload.png') });
}

// ---- D203 稼働時間の右の欄 ----
async function availability(page) {
  await prepare(page);
  const data = await stored(page);
  const nameOf = (id) => data.staff.find((s) => s.id === id)?.name ?? '';
  await open(page, '/availability', '.avail-table');
  const heads = await page.locator('.avail-table thead th').allInnerTexts();
  const col = heads.findIndex((t) => t.replace(/\s+/g, '').startsWith(md(SECOND)));
  check(col > 0, '稼働時間の表にその日の列がある', { col, heads: heads.slice(0, 4) });
  const cellOf = (id) =>
    page
      .locator('.avail-table tbody tr')
      .filter({ has: page.locator('th.avail-name', { hasText: nameOf(id) }) })
      .locator('td')
      .nth(col - 1)
      .locator('button');
  // 欠勤のある人：「直す・取り消す」で、その人の2段目
  await cellOf(ABSENT).click();
  const link = page.getByTestId('availability-absence-link');
  await link.waitFor({ timeout: 5000 });
  check(
    (await link.innerText()).includes('この日の欠勤を直す・取り消す（日の予定の「欠勤・キャンセル」で開く）'),
    '欠勤のある日：直す・取り消すのリンクと行き先',
    await link.innerText(),
  );
  check(
    (await link.getAttribute('href')) === `#/plan?date=${SECOND}&do=absence&staff=${ABSENT}`,
    'リンクは ?date=…&do=absence&staff=…（新しいタブでも開ける）',
    await link.getAttribute('href'),
  );
  await link.click();
  check(await onPlan(page, SECOND), '稼働時間 → その日の「日の予定」', await dayOf(page));
  await page.getByTestId('sudden-staff').waitFor({ timeout: 10000 });
  check(
    (await page.getByTestId('sudden-staff').inputValue()) === ABSENT,
    '「欠勤・キャンセル」の欄をその人の2段目で開く',
    await page.getByTestId('sudden-staff').inputValue(),
  );
  check(!/do=|date=|staff=/.test(hashOf(page)), '?do=・?date=・?staff= は消える', hashOf(page));
  await page.screenshot({ path: path.join(OUT_DIR, 'links-availability.png') });
  // 欠勤の無い人：登録のリンク
  if (PRESENT) {
    await open(page, '/availability', '.avail-table');
    await cellOf(PRESENT).click();
    await link.waitFor({ timeout: 5000 });
    check(
      (await link.innerText()).startsWith('この日の欠勤を登録する'),
      '欠勤の無い日：登録のリンク',
      await link.innerText(),
    );
  }
  // 休みの日のセル（その日に働かない人）にはリンクを出さない（PR #48 のレビュー）
  await open(page, '/availability', '.avail-table');
  const offCell = page.locator(`.avail-table tbody tr td:nth-child(${col + 1}) button.is-off`).first();
  let offId = '';
  if ((await offCell.count()) === 1) {
    const offName = (await offCell.locator('xpath=ancestor::tr[1]/th').innerText()).trim();
    offId = data.staff.find((s) => s.name === offName)?.id ?? '';
    await offCell.click();
    await page.locator('.drawer').waitFor({ timeout: 5000 });
    await settle(page, 200);
    check((await link.count()) === 0, '休みの日のセル：欠勤・キャンセルへのリンクを出さない', offName);
  } else {
    check(false, '用意：その日に休みの人がいる');
  }
  // URL で休みの人を渡しても2段目にしない（1段目）
  if (offId) {
    await open(page, `/plan?date=${SECOND}&do=absence&staff=${offId}`, '.date-switch select');
    await page.getByTestId('sudden-panel').waitFor({ timeout: 10000 });
    check(
      (await page.locator('h3.sudden-step-title').textContent()) === '何が起きましたか？',
      'その日に働かない人の staff= は1段目で開く',
      offId,
    );
  }
  // Ctrl+クリックで新しいタブ：元のタブの日付は変わらない（setDate しない）
  if (PRESENT) {
    await open(page, '/availability', '.avail-table');
    const before = await page.locator('.date-switch select').inputValue();
    await cellOf(PRESENT).click();
    await link.waitFor({ timeout: 5000 });
    const [tab] = await Promise.all([
      page.context().waitForEvent('page', { timeout: 10000 }),
      link.click({ modifiers: ['Control'] }),
    ]);
    await tab.waitForLoadState();
    await settle(page, 300);
    check(
      before !== SECOND &&
        (await page.locator('.date-switch select').inputValue()) === before &&
        /#\/availability/.test(page.url()),
      'Ctrl+クリック：元のタブは稼働時間のまま・日付も変わらない',
      { before, after: await page.locator('.date-switch select').inputValue() },
    );
    await tab.getByTestId('sudden-staff').waitFor({ timeout: 30000 });
    check(
      (await tab.locator('.date-switch select').inputValue()) === SECOND &&
        (await tab.getByTestId('sudden-staff').inputValue()) === PRESENT,
      'Ctrl+クリック：新しいタブでその日・その人の2段目',
    );
    await tab.close();
  }
  // 最終勤務日の後の人にもリンクを出さない
  const retired = data.staff.find((s) => s.active && s.id !== ABSENT && s.id !== PRESENT && s.id !== offId);
  if (retired) {
    const other = await page.context().newPage();
    await other.goto(`${BASE}#/data`);
    await other.evaluate(
      ({ k, id, d }) => {
        const x = JSON.parse(localStorage.getItem(k));
        x.staff.find((s) => s.id === id).lastDay = d;
        localStorage.setItem(k, JSON.stringify(x));
      },
      { k: STORAGE_KEY, id: retired.id, d: TODAY },
    );
    await other.close();
    await open(page, '/availability', '.avail-table');
    await cellOf(retired.id).click();
    await page.getByTestId('availability-retired').waitFor({ timeout: 5000 });
    check((await link.count()) === 0, '最終勤務日の後：欠勤・キャンセルへのリンクを出さない');
  }
  // 知らない人の staff= は1段目
  await open(page, `/plan?date=${SECOND}&do=absence&staff=nobody`, '.date-switch select');
  await page.getByTestId('sudden-panel').waitFor({ timeout: 10000 });
  check(
    (await page.locator('h3.sudden-step-title').textContent()) === '何が起きましたか？',
    '知らない人の staff= は1段目で開く',
  );
}

// ---- D204 空き状況の右の欄 ----
async function vacancy(page) {
  await prepare(page);
  await open(page, '/vacancy', '[data-testid="vacancy-grid"]');
  const cells = page.getByTestId('vacancy-cell');
  const n = await cells.count();
  let found = false;
  for (let i = 0; i < n && !found; i++) {
    await cells.nth(i).click();
    await settle(page, 80);
    if ((await page.getByTestId('vacancy-day-open').count()) > 0) found = true;
  }
  check(found, '空き状況：右の欄に日ごとの結果がある');
  if (!found) return;
  const list = page.getByTestId('vacancy-dates');
  check(
    (await list.locator('[data-testid="person-btn"]').count()) === 0,
    '日ごとの結果に名前の吹き出しを付けない（D124）',
  );
  const rows = await list.locator('li').count();
  check((await page.getByTestId('vacancy-day-open').count()) === rows, '日付ごとに「その日の案を見る」', rows);
  const btn = page.getByTestId('vacancy-day-open').last();
  const d = (await btn.getAttribute('data-date')) ?? '';
  check((await btn.innerText()) === 'その日の案を見る', 'ボタンの文', await btn.innerText());
  check(
    /^その日の案を見る（.+・日の予定で開く）$/.test((await btn.getAttribute('aria-label')) ?? ''),
    '読み上げは見えている文字が先頭で、日付と「日の予定で開く」',
    await btn.getAttribute('aria-label'),
  );
  check(
    (await btn.getAttribute('href')) === `#/plan?date=${d}`,
    'リンク（?date= だけ）',
    await btn.getAttribute('href'),
  );
  check((await page.locator('.drawer .btn-primary').count()) === 0, '右の欄に主ボタンを足さない');
  // Ctrl+クリックで新しいタブ（元のタブは空き状況のまま・右の欄も開いたまま）
  const before = await page.locator('.date-switch select').inputValue();
  const [tab] = await Promise.all([
    page.context().waitForEvent('page', { timeout: 10000 }),
    btn.click({ modifiers: ['Control'] }),
  ]);
  await tab.waitForLoadState();
  await tab.locator('.date-switch select').waitFor({ timeout: 30000 });
  await tab
    .waitForFunction((x) => document.querySelector('.date-switch select')?.value === x, d, { timeout: 10000 })
    .catch(() => {});
  check(
    (await tab.locator('.date-switch select').inputValue()) === d && /#\/plan$/.test(tab.url()),
    'Ctrl+クリック：新しいタブで ?date= だけでもその日の「日の予定」（?date= は消える）',
    { d, now: await tab.locator('.date-switch select').inputValue(), url: tab.url() },
  );
  await tab.close();
  check(
    /#\/vacancy/.test(page.url()) &&
      (await page.getByTestId('vacancy-dates').count()) === 1 &&
      (await page.locator('.date-switch select').inputValue()) === before,
    'Ctrl+クリック：元のタブは空き状況のまま（右の欄も開いたまま・日付も変わらない）',
  );
  // ふつうに押すと同じタブで移る
  await btn.click();
  check(await onPlan(page, d), '空き状況 → その日の「日の予定」', { d, now: await dayOf(page) });
  await page.screenshot({ path: path.join(OUT_DIR, 'links-vacancy.png') });
}

run(async () => {
  const browser = await launch();
  const errors = [];
  for (const step of [attention, noPlanDay, workload, availability, vacancy]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // 初回の案内ツアーを見た扱いにする（PRD D193）
    await skipTour(ctx);
    // 地図のタイルは外へ取りに行かない
    await ctx.route(/cyberjapandata\.gsi\.go\.jp|tile\.openstreetmap/, (r) => r.fulfill({ status: 204, body: '' }));
    const page = await ctx.newPage();
    // ページの時計を止める（e2e-view と同じ）
    await page.clock.setFixedTime(NOW);
    page.on('pageerror', (e) => errors.push(String(e)));
    const dlg = await answerConfirms(page);
    try {
      await step(page, dlg);
    } catch (e) {
      check(false, `${step.name}：途中で止まった`, String(e).split('\n')[0]);
      await failShot(page, step.name);
    }
    check(dlg.native.length === 0, `${step.name}：ブラウザのダイアログを出さない`, dlg.native);
    await ctx.close();
  }
  check(errors.length === 0, 'ページのエラーが無い', errors);
  await browser.close();
});
