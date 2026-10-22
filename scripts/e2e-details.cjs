// 予定（月・週・日）の名前から開く〈スタッフ〉・〈利用者さん〉の詳細（PRD D122〜D126。ADR-0022 追記）を本物のブラウザで確かめる：
// 月：右の欄の名前（〈スタッフ〉・〈利用者さん〉）／週：時間軸の〈スタッフ〉・〈利用者さん〉のチップの横の i・
// 〈スタッフ〉×曜日と〈利用者さん〉×曜日の表の名前／日：列の見出しの i・訪問の詳細の名前・担当ごとの1日の i・一覧の名前。
// 吹き出しの開閉（もう一度押す・Esc・外を押す・Tab）とフォーカスの戻り・同時に1つ・見出しが消えたら閉じる・
// 「〈スタッフ〉の画面で開く」「〈利用者さん〉の画面で開く」でその人の画面が開く・i を押してもチップ・見出しの動き（選ぶ・地図の絞り込み）が起きない・
// 訪問の選択とドラッグが今どおり動く・印刷では i を出さない。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-details.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）。PERF_MS_DETAILS で吹き出しが出るまでの上限（既定 100ms。無ければ PERF_MS）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const {
  BASE,
  OUT_DIR,
  perfMs,
  check,
  withRealClock,
  pageErrors,
  urlOf,
  isFocused,
  runSteps,
  settle,
} = require('./lib/env.cjs');
const { sharedPage } = require('./lib/steps.cjs');

const PERF_MS = perfMs('PERF_MS_DETAILS', 100);
const pop = (page) => page.getByTestId('person-pop');
const nameOf = async (loc) => ((await loc.getAttribute('aria-label')) ?? '').replace(/の詳細$/, '');

async function open(page, hash, ready) {
  await page.goto(`${BASE}#${hash}`);
  await page.reload();
  await page.locator(ready).first().waitFor({ timeout: 30000 });
  await settle(page, 500);
}

/**
 * 吹き出しの決まりを1つのボタンで確かめる：押すと開く（aria-expanded・aria-controls・中身）、Esc で閉じてボタンへ戻る、
 * もう一度押すと閉じる、外を押すと閉じる、Tab で外へ出ると閉じる
 */
async function rules(page, btn, where, words) {
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await pop(page).waitFor();
  const id = await pop(page).getAttribute('id');
  check(
    (await btn.getAttribute('aria-expanded')) === 'true' && (await btn.getAttribute('aria-controls')) === id,
    `${where}：押すと開く（aria-expanded・aria-controls）`,
  );
  const text = await pop(page).textContent();
  check(
    words.every((w) => text.includes(w)),
    `${where}：中身`,
    words.filter((w) => !text.includes(w)),
  );
  check(
    await pop(page).evaluate((el) => el.contains(document.activeElement)),
    `${where}：開いたらフォーカスが吹き出しへ`,
  );
  await page.keyboard.press('Escape');
  await pop(page).waitFor({ state: 'detached' });
  check(await isFocused(btn), `${where}：Esc で閉じてフォーカスがボタンへ`);
  await btn.click();
  await pop(page).waitFor();
  await btn.click();
  await pop(page).waitFor({ state: 'detached' });
  check((await btn.getAttribute('aria-expanded')) === 'false', `${where}：もう一度押すと閉じる`);
  await btn.click();
  await pop(page).waitFor();
  await page.mouse.click(5, 5);
  await pop(page).waitFor({ state: 'detached' });
  check(true, `${where}：外を押すと閉じる`);
  await btn.click();
  await pop(page).waitFor();
  // 閉じるボタン → リンク → 外へ
  for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
  await settle(page, 100);
  check((await pop(page).count()) === 0 && (await isFocused(btn)), `${where}：Tab で外へ出ると閉じてボタンへ戻る`);
}

/** リンクでその人の画面（`#/staff/:id`・`#/clients/:id`。PRD D308）が開く */
async function link(page, btn, where, to) {
  const name = await nameOf(btn);
  const id = await btn.getAttribute('data-id');
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await pop(page).getByTestId('person-pop-link').click();
  await settle(page, 500);
  // 見出し（h1）は名前。名前は完全一致、画面の data-id は押した人の ID
  const head = ((await page.locator('h1').first().textContent()) ?? '').trim();
  const view = page.getByTestId('person-view');
  check(
    urlOf(page).includes(`${to}/${encodeURIComponent(id)}`) &&
      head === name &&
      (await view.count()) === 1 &&
      (await view.getAttribute('data-id')) === id &&
      (await pop(page).count()) === 0,
    `${where}：リンクで ${name} の画面が開く`,
    head,
  );
}

/** 月の予定の表示の選択を出す（「その他 ▾」の「表示を選ぶ」。PRD D278） */
async function openMonthPickers(page) {
  await open(page, '/month', '[data-testid="month-more"]');
  await page.getByTestId('month-more').click();
  await page.getByTestId('month-more-pickers').click();
  await page.getByTestId('month-focus').waitFor();
}

async function month(page) {
  // 〈スタッフ〉を選んだ右の欄
  await openMonthPickers(page);
  const sid = await page.getByTestId('month-focus').locator('option[value^="staff:"]').first().getAttribute('value');
  await page.getByTestId('month-focus').selectOption(sid);
  const btn = page.getByTestId('month-aside-name');
  await btn.waitFor();
  check((await btn.getAttribute('data-kind')) === 'staff', '月：右の欄の名前がボタン（〈スタッフ〉）');
  await rules(page, btn, '月・〈スタッフ〉', ['移動手段', '稼働時間', '相性', '◎', 'いつもの担当', 'の画面で開く']);
  await page.screenshot({ path: path.join(OUT_DIR, 'month-staff.png') });
  await link(page, btn, '月・〈スタッフ〉', '#/staff');
  // 〈利用者さん〉を選んだ右の欄（?client=）
  await openMonthPickers(page);
  await page.getByTestId('month-focus').selectOption('client');
  await page.getByTestId('month-client-picker-shortcut-period').click();
  await page.getByTestId('month-client-picker-option').first().click();
  const cbtn = page.getByTestId('month-aside-name');
  await cbtn.waitFor();
  await cbtn.click();
  await pop(page).waitFor();
  const text = await pop(page).textContent();
  check(
    ['段階', '地区', '必要条件', '担当できる人'].every((w) => text.includes(w)),
    '月・〈利用者さん〉：中身',
  );
  await page.keyboard.press('Escape');
  await link(page, cbtn, '月・〈利用者さん〉', '#/clients');
}

async function week(page) {
  // 時間軸（〈スタッフ〉で見る）：チップの横の i
  await open(page, '/week', '[data-testid="week-col"]');
  const chips = page.getByTestId('staff-chips');
  const info = chips.getByTestId('person-info').first();
  const chip = chips.getByTestId('pick-chip').first();
  const pressed = await chip.getAttribute('aria-pressed');
  const bands = await page.getByTestId('week-band').count();
  await rules(page, info, '週・時間軸の〈スタッフ〉の i', ['移動手段', '稼働時間']);
  check(
    (await chip.getAttribute('aria-pressed')) === pressed && (await page.getByTestId('week-band').count()) === bands,
    '週：i を押してもチップの選択は変わらない',
  );
  // 同時に1つ
  await info.click();
  await pop(page).waitFor();
  await chips.getByTestId('person-info').nth(1).click();
  await settle(page, 200);
  check(
    (await pop(page).count()) === 1 && (await info.getAttribute('aria-expanded')) === 'false',
    '週：別の i を押すと入れ替わる（同時に1つ）',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'week-timeline.png') });
  // 見出しが消えたら閉じる（押さずに URL で〈利用者さん〉で見るへ）
  await page.evaluate(() => {
    location.hash = '#/week?by=client';
  });
  await settle(page, 400);
  check((await pop(page).count()) === 0, '週：見出し（チップ）が消えたら吹き出しを閉じる');
  // 時間軸（〈利用者さん〉で見る）：この週に訪問がある人のチップの横の i（PRD D136。〈スタッフ〉のチップと同じ）
  const cchips = page.getByTestId('week-client-chips');
  const cname = cchips.getByTestId('person-info').first();
  await cname.waitFor();
  const cpressed = await cchips.getByTestId('pick-chip').evaluateAll((els) => els.map((el) => el.ariaPressed));
  await rules(page, cname, '週・時間軸の〈利用者さん〉のチップの i', ['段階', '必要条件']);
  check(
    JSON.stringify(await cchips.getByTestId('pick-chip').evaluateAll((els) => els.map((el) => el.ariaPressed))) ===
      JSON.stringify(cpressed),
    '週：i を押しても〈利用者さん〉のチップの選択は変わらない',
  );
  // 〈スタッフ〉×曜日の表
  await open(page, '/week?view=table', '[data-testid="week-table"]');
  const tbtn = page.getByTestId('week-table').locator('tbody th').first().getByTestId('person-btn');
  await rules(page, tbtn, '週・〈スタッフ〉×曜日の表', ['移動手段']);
  await link(page, tbtn, '週・〈スタッフ〉×曜日の表', '#/staff');
  // 〈利用者さん〉×曜日の表
  await open(page, '/week?view=clients', '[data-testid="week-client-table"]');
  const cbtn = page.getByTestId('week-client-table').locator('tbody th').first().getByTestId('person-btn');
  await rules(page, cbtn, '週・〈利用者さん〉×曜日の表', ['段階', '地区']);
  await page.screenshot({ path: path.join(OUT_DIR, 'week-clients.png') });
  await link(page, cbtn, '週・〈利用者さん〉×曜日の表', '#/clients');
}

/** 本物のマウス操作でつかんで動かして離す（e2e-drag と同じ） */
async function realDrag(page, src, target) {
  await src.scrollIntoViewIfNeeded();
  const sb = await src.boundingBox();
  const sx = sb.x + sb.width / 2;
  const sy = sb.y + Math.min(8, sb.height / 2);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 6, sy + 6, { steps: 3 });
  await settle(page, 150);
  const { x, y } = await target();
  await page.mouse.move(x, y, { steps: 15 });
  await settle(page, 300);
  await page.mouse.up();
  await settle(page, 500);
}

async function plan(page) {
  await open(page, '/plan', '.tl-band[draggable="true"]');
  // 列の見出しの i：押しても地図の絞り込み（見出しのボタン）は変わらない
  const head = page.locator('.tl-head .col-focus').first();
  const colInfo = page.getByTestId('col-info').first();
  await rules(page, colInfo, '日・列の見出しの i', ['移動手段', '稼働時間']);
  check((await head.getAttribute('aria-pressed')) === 'false', '日：i を押しても見出しの地図の絞り込みは変わらない');
  // 訪問の詳細：帯を押すと選ぶ（今どおり）、詳細の名前で吹き出し、帯の選択は残る
  const band = page.locator('.tl-band[draggable="true"]').first();
  const vid = await band.getAttribute('data-visit');
  const bandBtn = band.locator('.tl-band-btn');
  await bandBtn.click();
  check((await bandBtn.getAttribute('aria-pressed')) === 'true', '日：帯を押すと選ぶ（今どおり）');
  const detail = page.locator('.tl-detail').first();
  const who = detail.getByTestId('person-btn');
  check((await who.count()) >= 2, '日：訪問の詳細に〈利用者さん〉・担当の名前のボタン', await who.count());
  await who.first().click();
  await pop(page).waitFor();
  check((await bandBtn.getAttribute('aria-pressed')) === 'true', '日：名前を押しても帯の選択は残る');
  await page.keyboard.press('Escape');
  await pop(page).waitFor({ state: 'detached' });
  await who.last().click();
  await pop(page).waitFor();
  check((await pop(page).textContent()).includes('移動手段'), '日：担当の名前で〈スタッフ〉の詳細');
  // 帯をもう一度押すと選択を外し、詳細（見出し）が消えたら吹き出しも閉じる
  await bandBtn.click();
  await settle(page, 200);
  check(
    (await bandBtn.getAttribute('aria-pressed')) === 'false' && (await pop(page).count()) === 0,
    '日：帯をもう一度押すと選択を外し、吹き出しも閉じる',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'plan-timeline.png') });
  // ドラッグは今どおり（吹き出しを開け閉めしたあとで別の担当の列へ移す）
  const staffOf = () =>
    page.evaluate(
      (v) =>
        document.querySelector(`[draggable="true"][data-visit="${v}"]`)?.closest('[data-staff]')?.dataset.staff ?? null,
      vid,
    );
  const from = await staffOf();
  const to = await page.$$eval(
    '.tl-col[data-staff]',
    (cs, f) => cs.map((c) => c.dataset.staff).find((s) => s !== f),
    from,
  );
  await realDrag(page, band, async () => {
    const col = page.locator(`.tl-col[data-staff="${to}"]`);
    await col.scrollIntoViewIfNeeded();
    const cb = await col.boundingBox();
    // 列の上が上の帯（固定の見出し）の下に隠れていても、見えている所に落とす
    const top = Math.max(cb.y, 140);
    return { x: cb.x + cb.width / 2, y: Math.min(top + 120, cb.y + cb.height - 20) };
  });
  check((await staffOf()) === to, '日：帯のドラッグで別の担当へ移せる（今どおり）', { from, to: await staffOf() });
  // 担当ごとの1日の i：押しても列へは移らない（行のボタンの動きを起こさない）
  const lineInfo = page.getByTestId('daylines').getByTestId('person-info').first();
  await lineInfo.scrollIntoViewIfNeeded();
  const y0 = await page.evaluate(() => window.scrollY);
  await lineInfo.click();
  await pop(page).waitFor();
  check(
    (await pop(page).textContent()).includes('稼働時間') && (await page.evaluate(() => window.scrollY)) === y0,
    '日：担当ごとの1日の i で詳細（列へは移らない）',
  );
  await page.keyboard.press('Escape');
  // 順番の表示：カードの詳細の名前
  await page.getByRole('button', { name: '順番', exact: true }).click();
  await settle(page, 400);
  const card = page.locator('.route-grid .route-col[data-staff] .route-btn').first();
  await card.click();
  check((await card.getAttribute('aria-pressed')) === 'true', '日・順番：カードを押すと選ぶ（今どおり）');
  const cardWho = page.locator('.route-grid').getByTestId('visit-who').first().getByTestId('person-btn').first();
  await rules(page, cardWho, '日・順番：訪問の詳細の名前', ['段階']);
  check((await card.getAttribute('aria-pressed')) === 'true', '日・順番：名前を押してもカードの選択は残る');
  const orderInfo = page.locator('.route-grid').getByTestId('col-info').first();
  await orderInfo.click();
  await pop(page).waitFor();
  check(true, '日・順番：列の見出しの i');
  await page.keyboard.press('Escape');
  // 一覧の表示
  await page.getByRole('button', { name: '一覧', exact: true }).click();
  await settle(page, 400);
  const list = page.getByTestId('visit-list');
  const lc = list.locator('[data-testid="person-btn"][data-kind="client"]').first();
  await rules(page, lc, '日・一覧の〈利用者さん〉', ['段階']);
  const ls = list.locator('[data-testid="person-btn"][data-kind="staff"]').first();
  await link(page, ls, '日・一覧の担当', '#/staff');
  // 印刷では i を出さず、名前のボタンはただの文字の見た目
  await open(page, '/plan', '.tl-band[draggable="true"]');
  await page.emulateMedia({ media: 'print' });
  await settle(page, 400);
  const printed = await page.evaluate(() => ({
    info: [...document.querySelectorAll('.person-info')].filter((e) => getComputedStyle(e).display !== 'none').length,
    deco: [...document.querySelectorAll('.person-btn')].map((e) => getComputedStyle(e).textDecorationLine),
  }));
  check(printed.info === 0 && printed.deco.every((d) => d === 'none'), '印刷では i を出さず、名前に下線を付けない', {
    info: printed.info,
  });
  await page.emulateMedia({ media: 'screen' });
}

/** 戻るでボタンはそのままに人が替わったら閉じる（月の右の欄）・同じ人が2か所に出るとき（日の列の見出しと担当ごとの1日） */
async function sameButtonAndTwice(page) {
  await open(page, '/month?staff=s1', '[data-testid="month-aside-name"]');
  await page.goto(`${BASE}#/month?staff=s2`);
  const btn = page.getByTestId('month-aside-name');
  await page.waitForFunction(() => document.querySelector('[data-testid="month-aside-name"]')?.dataset.id === 's2');
  await btn.click();
  await pop(page).waitFor();
  const title2 = await pop(page).locator('h3').textContent();
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('[data-testid="month-aside-name"]')?.dataset.id === 's1');
  await settle(page, 200);
  check(
    (await pop(page).count()) === 0 && (await btn.getAttribute('aria-expanded')) === 'false',
    '月：戻るで見出しの人が替わったら吹き出しを閉じる',
    { before: title2, now: await nameOf(btn) },
  );

  await open(page, '/plan', '.tl-band[draggable="true"]');
  const colInfo = page.getByTestId('col-info').first();
  const sid = await colInfo.getAttribute('data-id');
  const lineInfo = page.getByTestId('daylines').locator(`[data-testid="person-info"][data-id="${sid}"]`);
  await colInfo.click();
  await pop(page).waitFor();
  await lineInfo.scrollIntoViewIfNeeded();
  await lineInfo.click();
  await settle(page, 200);
  const expanded = await page.$$eval(`[data-id="${sid}"][aria-expanded="true"]`, (xs) =>
    xs.map((x) => x.dataset.testid),
  );
  check(
    (await pop(page).count()) === 1 && expanded.length === 1 && expanded[0] === 'person-info',
    '日：同じ人の2か所目を押すと吹き出しは1つで、aria-expanded が true なのは押したほうだけ',
    expanded,
  );
  await page.keyboard.press('Escape');
  await pop(page).waitFor({ state: 'detached' });
  check(await isFocused(lineInfo), '日：閉じたらフォーカスは2か所目（押したほう）へ戻る');
}

/** 開いている人がデータから消えたら閉じる（別のタブで消す。storage の知らせでデータが入れ替わる） */
async function removed(page) {
  await open(page, '/week?view=clients', '[data-testid="week-client-table"]');
  const btn = page.getByTestId('week-client-table').locator('tbody th').first().getByTestId('person-btn');
  const cid = await btn.getAttribute('data-id');
  await btn.click();
  await pop(page).waitFor();
  const other = await page.context().newPage();
  await other.goto(`${BASE}#/data`);
  await other.evaluate((id) => {
    const key = 'vrdemo:data:v1';
    const d = JSON.parse(localStorage.getItem(key));
    d.clients = d.clients.filter((c) => c.id !== id);
    d.visits = d.visits.filter((v) => v.clientId !== id);
    d.patterns = d.patterns.filter((x) => x.clientId !== id);
    d.clientLeaves = d.clientLeaves.filter((x) => x.clientId !== id);
    delete d.compat[id];
    localStorage.setItem(key, JSON.stringify(d));
  }, cid);
  await other.close();
  await settle(page, 500);
  check(
    (await pop(page).count()) === 0 &&
      (await page.locator(`[data-testid="person-btn"][data-id="${cid}"]`).count()) === 0,
    '開いている人がデータから消えたら閉じる',
    cid,
  );
}

async function speed(page) {
  // 週の時間軸：i を押してから吹き出しが出るまで（表全体を描き直さない）
  await open(page, '/week', '[data-testid="week-col"]');
  const times = [];
  const info = page.getByTestId('staff-chips').getByTestId('person-info').first();
  for (let i = 0; i < 5; i++) {
    const t = await info.evaluate(async (el) => {
      const t0 = performance.now();
      el.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return document.querySelector('[data-testid="person-pop"]') ? performance.now() - t0 : -1;
    });
    times.push(Math.round(t));
    await page.keyboard.press('Escape');
    // 計測の合間（前の回の後始末を次の回に入れない）。計測の条件なので固定の待ちのまま（ADR-0041）
    await page.waitForTimeout(100);
  }
  const med = [...times].sort((a, b) => a - b)[2];
  check(med >= 0 && med <= PERF_MS, `週：i を押してから吹き出しが出るまで（中央値 ${PERF_MS}ms 以下）`, times);
}

const steps = sharedPage({
  call: (fn, s) => fn(s.page, s),
  steps: [
    ['month', month],
    ['week', week],
    ['plan', plan],
    ['same-button-and-twice', sameButtonAndTwice],
    // 速さは時計を止めない別の文脈で測る（scripts/lib/env.cjs の withRealClock）
    ['speed', (_page, s) => withRealClock(s.b, pageErrors, speed)],
    // データを書き換えるので最後に
    ['removed', removed],
  ],
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
