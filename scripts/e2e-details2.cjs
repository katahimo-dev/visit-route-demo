// 名前から詳細を開く場所を足した所（PRD D205〜D209。ADR-0022 追記）を本物のブラウザで確かめる：
// 日の画面の「入らなかった訪問」の〈利用者さん〉の i（カードの外・ボタンの入れ子にしない）／「受けられる人」の候補の名前（「この人に入れる」とは別）／
// 欠勤の人に残る訪問の〈利用者さん〉の名前／拘束が上限を超える帯の名前（2人以上なら名前ごとの稼働の見込みのリンク、1人なら今までのボタン）／
// 〈利用者さん〉の休みの帯の名前／担当の振り直しの欄の〈利用者さん〉の名前／データの画面の名簿の読み込みのあとの最終勤務日の知らせ（名前と閲覧の欄へのリンク・閉じる）。
// それぞれ、名前を押すと吹き出しが出て、リンクで閲覧の欄へ移る。印刷で i と稼働の見込みのリンクを出さない・390px で横にはみ出さない。
// 入らない訪問・欠勤・休み・上限を超える拘束・最終勤務日のデータは、別のタブで localStorage を書き換えて作る（e2e-view の names() と同じ）。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-details2.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const fs = require('node:fs');
const path = require('node:path');
const { skipTour } = require('./lib/tourSeen.cjs');
const { answerConfirms } = require('./lib/confirmDialog.cjs');
const { BASE, OUT_DIR, NOW, TODAY, STORAGE_KEY, check, settle, urlOf, stored, runSteps } = require('./lib/env.cjs');
const { pagePerStep } = require('./lib/steps.cjs');

/** 最終勤務日に入れる日（今日の30日後） */
const LAST_DAY = new Date(Date.parse(`${TODAY}T00:00:00Z`) + 30 * 86400000).toISOString().slice(0, 10);

/** 保存（少し遅れて書く）が条件を満たすまで待つ（満たさなければ時間切れで続ける） */
async function waitStored(page, pred, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const d = await stored(page);
    if (d && pred(d)) return d;
    await settle(page, 100);
  }
  return stored(page);
}
const pop = (page) => page.getByTestId('person-pop');
const view = (page) => page.getByTestId('person-view');
const nameOf = async (loc) => ((await loc.getAttribute('aria-label')) ?? '').replace(/の詳細$/, '');

/** 今の案が出て計算が終わるまで待つ */
async function waitPlan(page) {
  await page.getByTestId('confirm-state').waitFor({ state: 'attached', timeout: 60000 });
  await page.getByTestId('plan-progress').waitFor({ state: 'detached', timeout: 60000 });
  await settle(page, 400);
}
async function openPlan(page) {
  await page.goto(`${BASE}#/plan?date=${TODAY}`);
  await page.reload();
  await waitPlan(page);
}

/** 別のタブで localStorage のデータを書き換える（storage の知らせでこのタブのデータも入れ替わる） */
async function mutate(page, fn, arg) {
  const other = await page.context().newPage();
  await other.goto(`${BASE}#/data`);
  await other.getByTestId('excel-kind').waitFor({ timeout: 30000 });
  // 読んで node の中で書き換え、書き戻す
  const d = await other.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORAGE_KEY);
  const out = fn(d, arg);
  await other.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: STORAGE_KEY, v: JSON.stringify(d) });
  await other.close();
  await settle(page, 300);
  return out;
}

/**
 * 名前のボタン（または i）を押すと吹き出しが出て、そのリンクで閲覧の欄へ移る。
 * to は `#/staff` か `#/clients`。戻ったあとの確認は呼ぶ側で
 */
async function openAndLink(page, btn, where, to) {
  const name = await nameOf(btn);
  const id = await btn.getAttribute('data-id');
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await pop(page).waitFor({ timeout: 3000 });
  const title = (await pop(page).locator('h2, h3, strong').first().textContent()) ?? '';
  check(
    (await btn.getAttribute('aria-expanded')) === 'true' && (await pop(page).textContent()).includes(name),
    `${where}：押すと ${name} の詳細の吹き出し`,
    title,
  );
  await pop(page).getByTestId('person-pop-link').click();
  await settle(page, 600);
  await view(page)
    .waitFor({ timeout: 5000 })
    .catch(() => {});
  check(
    urlOf(page).includes(to) && (await view(page).count()) === 1 && (await view(page).getAttribute('data-id')) === id,
    `${where}：リンクで ${name} の閲覧の欄が開く`,
    urlOf(page),
  );
}

/** ボタンの入れ子が無い（押す所の中に別のボタンを置かない） */
const notNested = (loc) =>
  loc.evaluate((el) => !el.parentElement?.closest('button, [role="button"], a, label, option, select'));

/** 390px で横にはみ出さない */
async function fitsNarrow(page, where, sel) {
  const r = await page.evaluate((s) => {
    const over = [...document.querySelectorAll(s)].map((el) => el.getBoundingClientRect().right);
    return {
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
      right: Math.max(0, ...over),
    };
  }, sel);
  check(r.scroll <= r.inner + 1 && r.right <= r.inner + 1, `${where}：390px で横にはみ出さない`, r);
}

/**
 * 日の画面のデータを作る：いちばん訪問の多い人を終日の欠勤にし、その人の訪問の1件目を入らない（振り直しの案A で入らなかった扱い）、
 * 2件目を欠勤の人に残す。ほかの人の訪問の〈利用者さん〉を今日休みにする。拘束の上限を 0.5時間にする
 */
function makeDay(d, today) {
  const plan = d.aiPlans[today];
  const routes = plan.routes;
  const [absent, list] = Object.entries(routes).sort((a, b) => b[1].length - a[1].length)[0];
  const base = JSON.parse(JSON.stringify(routes));
  const v1 = list[0];
  const v2 = list[1];
  d.absences = d.absences ?? [];
  d.absences.push({ id: 'e2e-abs', staffId: absent, date: today, from: null, to: null, note: '' });
  routes[absent] = list.filter((v) => v !== v1);
  plan.unassigned = [...plan.unassigned, v1];
  plan.reassign = { method: 'insert', from: 'plan', baseRoutes: base, basePins: {}, absenceIds: ['e2e-abs'] };
  const clientOf = (vid) => d.visits.find((v) => v.id === vid)?.clientId;
  const used = new Set([clientOf(v1), clientOf(v2)]);
  let leaveClient = null;
  for (const [sid, ids] of Object.entries(routes)) {
    if (sid === absent) continue;
    const c = ids.map(clientOf).find((x) => x && !used.has(x));
    if (c) {
      leaveClient = c;
      break;
    }
  }
  d.clientLeaves = d.clientLeaves ?? [];
  d.clientLeaves.push({ id: 'e2e-leave', clientId: leaveClient, from: today, to: today, note: '入院' });
  d.org.spanLimitHours = 0.5;
  return { absent, v1: clientOf(v1), v2: clientOf(v2), leaveClient };
}

// ---- 日の画面：入らなかった訪問・受けられる人・欠勤の人に残る訪問・休み・上限を超える拘束（2人以上） ----
async function day(page) {
  await openPlan(page);
  const made = await mutate(page, makeDay, TODAY);
  check(!!made?.leaveClient && !!made.v1 && !!made.v2, 'データを作った（欠勤・入らない訪問・休み・拘束の上限）', made);
  await openPlan(page);
  const data = await stored(page);
  const clientName = (id) => data.clients.find((c) => c.id === id)?.displayName ?? '';

  // D205：入らなかった訪問の〈利用者さん〉の i（カードの外）
  const none = page.locator('.route-col-none');
  const info = none.locator(`[data-testid="unplaced-info"][data-id="${made.v1}"]`);
  check((await info.count()) === 1, '入らなかった訪問：〈利用者さん〉の i がある', await none.count());
  check(
    (await info.getAttribute('aria-label')) === `${clientName(made.v1)}の詳細` && (await notNested(info)),
    '入らなかった訪問：i の読み上げは「〈名前〉の詳細」・カード（押すと選ぶ）の外に置く',
  );
  const picked = await none.locator('.route-item.is-picked').count();
  await info.click();
  await pop(page).waitFor({ timeout: 3000 });
  check(
    (await none.locator('.route-item.is-picked').count()) === picked,
    '入らなかった訪問：i を押してもカードは選ばれない',
  );
  await page.keyboard.press('Escape');
  await settle(page);
  await page.screenshot({ path: path.join(OUT_DIR, 'day-unplaced.png') });
  await openAndLink(page, info, '入らなかった訪問', '#/clients');

  // D206：受けられる人の候補の名前（「この人に入れる」とは別）
  await openPlan(page);
  const before = JSON.stringify((await stored(page)).aiPlans[TODAY].routes);
  await page.locator('.route-col-none .candidate-box button', { hasText: '受けられる人' }).first().click();
  await page.getByTestId('candidate-list').waitFor({ timeout: 10000 });
  const cand = page.getByTestId('candidate-list').getByTestId('candidate-name').first();
  check(
    (await cand.getAttribute('data-kind')) === 'staff' && (await notNested(cand)),
    '受けられる人：候補の名前がボタン（「この人に入れる」と別）',
  );
  await cand.click();
  await pop(page).waitFor({ timeout: 3000 });
  await settle(page, 300);
  check(
    JSON.stringify((await stored(page)).aiPlans[TODAY].routes) === before,
    '受けられる人：名前を押しても訪問は入れない',
  );
  await page.keyboard.press('Escape');
  await settle(page);
  const candId = await cand.getAttribute('data-id');
  await openAndLink(page, cand, '受けられる人', '#/staff');

  // 390px：候補の一覧が横にはみ出さず、長い名前は「…」で切り、Tab で移ると枠が見える
  await mutate(
    page,
    (d, id) => {
      const s = d.staff.find((x) => x.id === id);
      s.name = `${s.name}たいへん長い名前の例のスタッフさん`;
    },
    candId,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await openPlan(page);
  await page.locator('.route-col-none .candidate-box button', { hasText: '受けられる人' }).first().click();
  await page.getByTestId('candidate-list').waitFor({ timeout: 10000 });
  const list = page.getByTestId('candidate-list');
  await list.scrollIntoViewIfNeeded();
  const listBox = await list.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const over = [...el.querySelectorAll('*')].filter((x) => x.getBoundingClientRect().right > b.right + 1).length;
    return { right: b.right, over, inner: window.innerWidth };
  });
  check(
    listBox.over === 0 && listBox.right <= listBox.inner + 1,
    '受けられる人：390px で候補の一覧が横にはみ出さない',
    listBox,
  );
  const long = list.getByTestId('candidate-name').filter({ hasText: 'たいへん長い名前' }).first();
  const ell = await long.evaluate((el) => {
    const sp = el.querySelector('.ellipsis');
    return { cut: sp.scrollWidth > sp.clientWidth, overflow: getComputedStyle(sp).textOverflow };
  });
  check(ell.cut && ell.overflow === 'ellipsis', '受けられる人：長い名前は「…」で切る', ell);
  await long.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const ring = await long.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const box = el.parentElement.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      focused: document.activeElement === el,
      outline: cs.outlineStyle,
      // 枠（outline 2px・offset 2px）が親の箱の中に収まり、親は切らない
      inside: r.left - 4 >= box.left - 0.5 && r.right + 4 <= box.right + 0.5,
      clip: getComputedStyle(el.parentElement).overflow,
    };
  });
  check(
    ring.focused && ring.outline !== 'none' && ring.clip === 'visible',
    '受けられる人：390px で長い名前に Tab で移ると枠が見える（箱で切らない）',
    ring,
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'candidate-390.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  // 名前を戻す（ほかの所の確認に長い名前を持ち込まない）
  await mutate(
    page,
    (d, id) => {
      const st = d.staff.find((x) => x.id === id);
      st.name = st.name.replace('たいへん長い名前の例のスタッフさん', '');
    },
    candId,
  );

  // D206：欠勤の人に残る訪問の〈利用者さん〉の名前
  await openPlan(page);
  const left = page.getByTestId('left-box').getByTestId('left-client');
  check((await left.count()) >= 1, '欠勤の人に残る訪問：〈利用者さん〉の名前がボタン', await left.count());
  await openAndLink(page, left.first(), '欠勤の人に残る訪問', '#/clients');

  // D208：休みの帯の名前
  await openPlan(page);
  const leaveBand = page.getByTestId('band-leave');
  const leave = leaveBand.locator(`[data-testid="leave-name"][data-id="${made.leaveClient}"]`);
  check(
    (await leave.count()) === 1 &&
      (await leave.textContent()) === clientName(made.leaveClient) &&
      (await leaveBand.textContent()).includes(`${clientName(made.leaveClient)}（入院）`),
    '休みの帯：〈利用者さん〉の名前がボタンで、理由を添える',
    await leaveBand.textContent(),
  );
  await openAndLink(page, leave, '休みの帯', '#/clients');

  // D207：拘束が上限を超える帯（2人以上）
  await openPlan(page);
  const band = page.getByTestId('band-over-span');
  const names = band.getByTestId('over-span-name');
  const links = band.getByTestId('over-span-link');
  const n = await names.count();
  check(n >= 2, '上限を超える帯：2人以上', n);
  check(
    (await links.count()) === n && (await band.locator('button.btn').count()) === 0,
    '上限を超える帯：2人以上なら名前ごとに勤務の見込みのリンク（帯のボタンは出さない）',
    { links: await links.count() },
  );
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(await names.nth(i).getAttribute('data-id'));
  const hrefs = await links.evaluateAll((els) => els.map((el) => el.getAttribute('href')));
  check(
    ids.every((id, i) => hrefs[i]?.endsWith(`/workload?ym=${TODAY.slice(0, 7)}&staff=${encodeURIComponent(id)}`)),
    '上限を超える帯：リンクの行き先はその人の勤務の見込み',
    hrefs,
  );
  check(
    (await links.first().getAttribute('aria-label')).endsWith('さんの勤務の見込み'),
    '上限を超える帯：リンクの読み上げに名前',
  );
  // 印刷：i とリンクを出さず、名前は文字のまま
  await page.emulateMedia({ media: 'print' });
  check(
    !(await links.first().isVisible()) &&
      !(await page.locator('.route-col-none [data-testid="unplaced-info"]').first().isVisible()) &&
      (await names.first().isVisible()),
    '印刷：i と勤務の見込みのリンクを出さず、名前は出す',
  );
  await page.emulateMedia({ media: 'screen' });
  await page.getByTestId('band-over-span').screenshot({ path: path.join(OUT_DIR, 'day-over-span.png') });
  // 2人目のリンクで稼働の見込み（その人を選ぶ）
  await links.nth(1).click();
  await settle(page, 600);
  check(
    urlOf(page).includes(`#/workload?ym=${TODAY.slice(0, 7)}&staff=${ids[1]}`),
    '上限を超える帯：2人目のリンクでその人の勤務の見込み',
    urlOf(page),
  );
  await openPlan(page);
  await openAndLink(
    page,
    page.getByTestId('band-over-span').getByTestId('over-span-name').nth(1),
    '上限を超える帯',
    '#/staff',
  );

  // 390px
  await page.setViewportSize({ width: 390, height: 844 });
  await openPlan(page);
  await fitsNarrow(page, '日の予定の帯', '[data-testid="band-over-span"], [data-testid="band-leave"]');
  await page.getByTestId('band-over-span').screenshot({ path: path.join(OUT_DIR, 'day-390-over-span.png') });
  await page.getByTestId('band-leave').screenshot({ path: path.join(OUT_DIR, 'day-390-leave.png') });
}

// ---- 拘束が上限を超える人が1人なら、今までどおり帯の「稼働の見込み」ボタン ----
async function overOne(page) {
  await openPlan(page);
  // 今の案で、いちばん訪問の多い人だけに訪問を残し（ほかの人の訪問は入らない扱い）、上限を 0.5時間にする。
  // 拘束は今の案から数えるので、上限を超えるのは必ずその1人になる
  const only = await mutate(
    page,
    (d, today) => {
      const plan = d.aiPlans[today];
      const [keep] = Object.entries(plan.routes).sort((x, y) => y[1].length - x[1].length)[0];
      for (const [sid, ids] of Object.entries(plan.routes)) {
        if (sid === keep) continue;
        plan.unassigned.push(...ids);
        plan.routes[sid] = [];
      }
      d.org.spanLimitHours = 0.5;
      return keep;
    },
    TODAY,
  );
  await openPlan(page);
  const band = page.getByTestId('band-over-span');
  const name = band.getByTestId('over-span-name');
  const btn = band.locator('button.btn', { hasText: '勤務の見込み' });
  check(
    (await name.count()) === 1 && (await band.getByTestId('over-span-link').count()) === 0 && (await btn.count()) === 1,
    '上限を超える帯：1人なら名前のボタンと今までの「勤務の見込み」ボタン（リンクは出さない）',
    { only, n: await name.count() },
  );
  const id = await name.getAttribute('data-id');
  check(id === only, '上限を超える帯（1人）：訪問を残した人', { id, only });
  await btn.click();
  await settle(page, 600);
  check(
    urlOf(page).includes(`#/workload?ym=${TODAY.slice(0, 7)}&staff=${id}`),
    '上限を超える帯：1人なら「勤務の見込み」でその人',
    urlOf(page),
  );
  await openPlan(page);
  await openAndLink(
    page,
    page.getByTestId('band-over-span').getByTestId('over-span-name'),
    '上限を超える帯（1人）',
    '#/staff',
  );
}

// ---- データの画面：名簿の読み込みのあとの最終勤務日の知らせ → 閲覧の欄 → 担当の振り直しの欄の名前 ----
async function roster(page) {
  await page.goto(`${BASE}#/data`);
  await page.reload();
  await page.getByTestId('excel-kind').waitFor({ timeout: 30000 });
  // いちばん多くの〈利用者さん〉のいつもの担当の人に最終勤務日を入れて書き出し、外してから読み込む（読み込みで最終勤務日が入る）
  const sid = await mutate(
    page,
    (d, day) => {
      const count = new Map();
      for (const c of d.clients) {
        if (c.stage === 'ended' || !c.usualStaffId) continue;
        count.set(c.usualStaffId, (count.get(c.usualStaffId) ?? 0) + 1);
      }
      const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
      d.staff.find((s) => s.id === best).lastDay = day;
      return best;
    },
    LAST_DAY,
  );
  await page.getByTestId('excel-kind').locator('button').nth(2).click();
  await settle(page);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.getByRole('button', { name: 'Excel に書き出す' }).click(),
  ]);
  const book = fs.readFileSync(await download.path());
  await mutate(
    page,
    (d, id) => {
      d.staff.find((s) => s.id === id).lastDay = null;
    },
    sid,
  );
  check((await stored(page)).staff.find((s) => s.id === sid).lastDay === null, '読み込む前は最終勤務日が無い');
  await page.getByTestId('excel-file-input').setInputFiles({
    name: 'staff.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: book,
  });
  const notice = page.getByTestId('lastday-notice');
  await notice.waitFor({ timeout: 20000 });
  // 保存は少し遅れて書く
  const data = await waitStored(page, (d) => d.staff.find((x) => x.id === sid)?.lastDay === LAST_DAY);
  const s = data.staff.find((x) => x.id === sid);
  const link = notice.getByTestId('lastday-link');
  const got = {
    lastDay: s.lastDay,
    n: await link.count(),
    name: await link.textContent(),
    href: await link.getAttribute('href'),
    text: await notice.textContent(),
  };
  check(
    got.lastDay === LAST_DAY &&
      got.n === 1 &&
      got.name === s.name &&
      got.href.endsWith(`#/staff?id=${encodeURIComponent(sid)}`) &&
      got.text.includes(`最終勤務日 ${LAST_DAY}`),
    '知らせ：最終勤務日の入った人の名前と閲覧の欄へのリンク',
    got,
  );
  const toast = await page
    .locator('.toast')
    .filter({ hasText: '名簿を読み込みました' })
    .waitFor({ timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  check(toast, '知らせ：読み込んだことはトーストでも知らせる');
  await page.screenshot({ path: path.join(OUT_DIR, 'data-notice.png') });
  // 390px
  await page.setViewportSize({ width: 390, height: 844 });
  await notice.scrollIntoViewIfNeeded();
  await fitsNarrow(page, 'データの画面の知らせ', '[data-testid="lastday-notice"]');
  await page.screenshot({ path: path.join(OUT_DIR, 'data-notice-390.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  // 印刷：閉じるボタンは出さない
  await page.emulateMedia({ media: 'print' });
  check(
    !(await page.getByTestId('lastday-close').isVisible()) && (await link.isVisible()),
    '印刷：知らせの閉じるボタンを出さない',
  );
  await page.emulateMedia({ media: 'screen' });
  // 閉じる → 知らせが消えフォーカスは Excel の欄。保存しない（読み直すと出ない）
  await page.getByTestId('lastday-close').click();
  await settle(page);
  const focusTo = await page.evaluate(() => {
    const el = document.activeElement;
    const name = el?.getAttribute('aria-labelledby');
    return {
      testId: el?.getAttribute('data-testid'),
      role: el?.tagName,
      name: name ? document.getElementById(name)?.textContent : null,
      outline: el ? getComputedStyle(el).outlineStyle : '',
    };
  });
  check(
    (await notice.count()) === 0 &&
      focusTo.testId === 'excel-card' &&
      focusTo.role === 'SECTION' &&
      focusTo.name === 'Excel' &&
      focusTo.outline !== 'none',
    '知らせ：閉じると消え、フォーカスは Excel の欄（名前は見出し・枠が見える）',
    focusTo,
  );
  // Excel の種類を切り替えると消える
  await mutate(
    page,
    (d, id) => {
      d.staff.find((x) => x.id === id).lastDay = null;
    },
    sid,
  );
  await page.getByTestId('excel-file-input').setInputFiles({
    name: 'staff.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: book,
  });
  await notice.waitFor({ timeout: 20000 });
  await page.getByTestId('excel-kind').locator('button').nth(0).click();
  await settle(page);
  check((await notice.count()) === 0, '知らせ：Excel の種類を切り替えると消える');
  await page.getByTestId('excel-kind').locator('button').nth(2).click();
  await settle(page);
  // もう一度読み込んで（同じ日なので変更なし）知らせが出ないこと → 外してから読み込み直して、リンクで閲覧の欄
  await mutate(
    page,
    (d, id) => {
      d.staff.find((x) => x.id === id).lastDay = null;
    },
    sid,
  );
  await page.getByTestId('excel-file-input').setInputFiles({
    name: 'staff.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: book,
  });
  await notice.waitFor({ timeout: 20000 });
  await page.reload();
  await page.getByTestId('excel-kind').waitFor({ timeout: 30000 });
  check((await notice.count()) === 0, '知らせ：読み直すと出ない（保存しない）');
  await mutate(
    page,
    (d, id) => {
      d.staff.find((x) => x.id === id).lastDay = null;
    },
    sid,
  );
  await page.getByTestId('excel-kind').locator('button').nth(2).click();
  await page.getByTestId('excel-file-input').setInputFiles({
    name: 'staff.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: book,
  });
  await notice.waitFor({ timeout: 20000 });
  await notice.getByTestId('lastday-link').click();
  await settle(page, 600);
  check(
    urlOf(page).includes('#/staff') && (await view(page).getAttribute('data-id')) === sid,
    '知らせ：リンクでその人の閲覧の欄',
    urlOf(page),
  );

  // D208：担当の振り直しの欄の〈利用者さん〉の名前
  await page
    .locator('.drawer')
    .getByRole('button', { name: /閉じる/ })
    .first()
    .click();
  await settle(page, 400);
  await page.getByTestId('leaving-open').first().click();
  const rows = page.getByTestId('offboard-clients');
  await rows.waitFor({ timeout: 10000 });
  const btn = rows.getByTestId('offboard-client-name').first();
  check(
    (await btn.getAttribute('data-kind')) === 'client' &&
      (await notNested(btn)) &&
      (await rows.locator('option button, select button').count()) === 0,
    '担当の振り直し：〈利用者さん〉の名前がボタン（select の中には置かない）',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'offboard.png') });
  const cid = await btn.getAttribute('data-id');
  await btn.click();
  await pop(page).waitFor({ timeout: 3000 });
  check(
    await page.evaluate(() => !!document.querySelector('[aria-modal="true"] [data-testid="person-pop"]')),
    '担当の振り直し：吹き出しは欄（aria-modal）の中に出す',
  );
  await page.keyboard.press('Escape');
  await settle(page);
  check((await pop(page).count()) === 0 && (await rows.count()) === 1, '担当の振り直し：Esc は吹き出しだけ閉じる');
  await btn.click();
  await pop(page).waitFor({ timeout: 3000 });
  await pop(page).getByTestId('person-pop-link').click();
  await settle(page, 600);
  check(
    urlOf(page).includes('#/clients') && (await view(page).getAttribute('data-id')) === cid,
    '担当の振り直し：リンクで〈利用者さん〉の閲覧の欄',
    urlOf(page),
  );
}

// ---- 「初期状態に戻す」で最終勤務日の知らせが消える ----
async function rosterReset(page) {
  await page.goto(`${BASE}#/data`);
  await page.reload();
  await page.getByTestId('excel-kind').waitFor({ timeout: 30000 });
  const sid = await mutate(
    page,
    (d, day) => {
      d.staff[0].lastDay = day;
      return d.staff[0].id;
    },
    LAST_DAY,
  );
  await page.getByTestId('excel-kind').locator('button').nth(2).click();
  await settle(page);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.getByRole('button', { name: 'Excel に書き出す' }).click(),
  ]);
  const book = fs.readFileSync(await download.path());
  await mutate(
    page,
    (d, id) => {
      d.staff.find((s) => s.id === id).lastDay = null;
    },
    sid,
  );
  await page.getByTestId('excel-file-input').setInputFiles({
    name: 'staff.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: book,
  });
  const notice = page.getByTestId('lastday-notice');
  await notice.waitFor({ timeout: 20000 });
  check((await notice.count()) === 1, '初期状態に戻す：前に知らせが出ている');
  await page.getByRole('button', { name: 'デモの初期状態に戻す' }).click();
  await page
    .locator('.toast')
    .filter({ hasText: '初期状態に戻しました' })
    .waitFor({ timeout: 5000 })
    .catch(() => {});
  await settle(page);
  check((await notice.count()) === 0, '知らせ：「初期状態に戻す」で消える');
}

const errors = [];
const steps = pagePerStep({
  open: async (browser) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    // 初回の案内ツアーを見た扱いにする（PRD D193）
    await skipTour(ctx);
    // 地図のタイルは外へ取りに行かない
    await ctx.route(/cyberjapandata\.gsi\.go\.jp/, (r) => r.fulfill({ status: 204, body: '' }));
    const page = await ctx.newPage();
    // ページの時計を止める（e2e-details と同じ）
    await page.clock.setFixedTime(NOW);
    page.on('pageerror', (e) => errors.push(String(e)));
    return { ctx, page, dlg: await answerConfirms(page) };
  },
  steps: [day, overOne, roster, rosterReset],
  label: (name) => `${name}：途中で止まった`,
  after: (name, { dlg }) => check(dlg.native.length === 0, `${name}：ブラウザのダイアログを出さない`, dlg.native),
  end: () => check(errors.length === 0, 'ページのエラーが無い', errors),
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
