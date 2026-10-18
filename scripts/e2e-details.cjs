// 予定（月・週・日）の名前から開く〈スタッフ〉・〈利用者さん〉の詳細（PRD D122〜D126。ADR-0022 追記）を本物のブラウザで確かめる：
// 月：右の欄の名前（〈スタッフ〉・〈利用者さん〉）／週：時間軸の〈スタッフ〉のチップの横の i・〈利用者さん〉のチップの名前・
// 〈スタッフ〉×曜日と〈利用者さん〉×曜日の表の名前／日：列の見出しの i・訪問の詳細の名前・担当ごとの1日の i・一覧の名前。
// 吹き出しの開閉（もう一度押す・Esc・外を押す・Tab）とフォーカスの戻り・同時に1つ・見出しが消えたら閉じる・
// 「〈スタッフ〉の画面で開く」「〈利用者さん〉の画面で開く」で閲覧の欄が開く・i を押してもチップ・見出しの動き（選ぶ・地図の絞り込み）が起きない・
// 訪問の選択とドラッグが今どおり動く・印刷では i を出さない。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-details.cjs
// 環境変数は scripts/e2e-drag.cjs と同じ（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean);
  for (const p of tries) {
    try {
      return require(p);
    } catch {
      // 次の候補へ
    }
  }
  throw new Error(`Playwright が見つかりません（試した場所：${tries.join('、')}）。PLAYWRIGHT で場所を渡してください`);
}

const { chromium } = loadPlaywright();
const BASE = process.env.BASE || 'http://localhost:4183/';
const OUT_DIR = process.env.OUT_DIR || path.join(os.tmpdir(), 'e2e-details');
const JST = 9 * 3600 * 1000;
/** 次の水曜（今日が水曜なら今日）の日本時間 12:00（e2e-drag と同じ） */
function nextWednesdayNoonJst(now) {
  const j = new Date(now.getTime() + JST);
  const add = (3 - j.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() + add, 12) - JST);
}
const NOW = process.env.FAKE_NOW ? new Date(process.env.FAKE_NOW) : nextWednesdayNoonJst(new Date());
if (Number.isNaN(NOW.getTime())) throw new Error(`FAKE_NOW が日時として読めません：${process.env.FAKE_NOW}`);
fs.mkdirSync(OUT_DIR, { recursive: true });

let fails = 0;
function check(ok, name, info = '') {
  if (!ok) fails++;
  console.log(
    `${ok ? 'OK  ' : 'NG  '} ${name}${info === '' ? '' : `  ${typeof info === 'string' ? info : JSON.stringify(info)}`}`,
  );
}
const urlOf = (page) => decodeURIComponent(page.url());
const pop = (page) => page.getByTestId('person-pop');
const nameOf = async (loc) => ((await loc.getAttribute('aria-label')) ?? '').replace(/の詳細$/, '');
const isFocused = (loc) => loc.evaluate((el) => document.activeElement === el);

async function open(page, hash, ready) {
  await page.goto(`${BASE}#${hash}`);
  await page.reload();
  await page.locator(ready).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
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
  await page.waitForTimeout(100);
  check((await pop(page).count()) === 0 && (await isFocused(btn)), `${where}：Tab で外へ出ると閉じてボタンへ戻る`);
}

/** リンクで各画面のその人の閲覧の欄が開く（?id=。PRD D127） */
async function link(page, btn, where, to) {
  const name = await nameOf(btn);
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await pop(page).getByTestId('person-pop-link').click();
  await page.waitForTimeout(500);
  const head = (await page.locator('.drawer h2').first().textContent()) ?? '';
  check(
    urlOf(page).includes(to) &&
      head.includes(name) &&
      (await page.getByTestId('person-view').count()) === 1 &&
      (await pop(page).count()) === 0,
    `${where}：リンクで ${name} の閲覧の欄が開く`,
  );
}

async function month(page) {
  // 〈スタッフ〉を選んだ右の欄
  await open(page, '/month', '[data-testid="month-focus"]');
  const sid = await page.getByTestId('month-focus').locator('option[value^="staff:"]').first().getAttribute('value');
  await page.getByTestId('month-focus').selectOption(sid);
  const btn = page.getByTestId('month-aside-name');
  await btn.waitFor();
  check((await btn.getAttribute('data-kind')) === 'staff', '月：右の欄の名前がボタン（〈スタッフ〉）');
  await rules(page, btn, '月・〈スタッフ〉', ['移動手段', '稼働時間', '相性', '◎', 'いつもの担当', 'の画面で開く']);
  await page.screenshot({ path: path.join(OUT_DIR, 'month-staff.png') });
  await link(page, btn, '月・〈スタッフ〉', '#/staff');
  // 〈利用者さん〉を選んだ右の欄（?client=）
  await open(page, '/month', '[data-testid="month-focus"]');
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
  await page.waitForTimeout(200);
  check(
    (await pop(page).count()) === 1 && (await info.getAttribute('aria-expanded')) === 'false',
    '週：別の i を押すと入れ替わる（同時に1つ）',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'week-timeline.png') });
  // 見出しが消えたら閉じる（押さずに URL で〈利用者さん〉で見るへ）
  await page.evaluate(() => {
    location.hash = '#/week?by=client';
  });
  await page.waitForTimeout(400);
  check((await pop(page).count()) === 0, '週：見出し（チップ）が消えたら吹き出しを閉じる');
  // 時間軸（〈利用者さん〉で見る）：選んだ人のチップの名前
  await page.getByTestId('week-client-picker-shortcut-period').click();
  await page.getByTestId('week-client-picker-option').first().click();
  const cname = page.getByTestId('week-client-picker-chip').first().getByTestId('person-btn');
  await cname.waitFor();
  await rules(page, cname, '週・時間軸の〈利用者さん〉のチップ', ['段階', '必要条件']);
  check((await page.getByTestId('week-client-picker-chip').count()) === 1, '週：名前を押しても選んだ人は外れない');
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
  await page.waitForTimeout(150);
  const { x, y } = await target();
  await page.mouse.move(x, y, { steps: 15 });
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(500);
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
  await page.waitForTimeout(200);
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
    return { x: cb.x + cb.width / 2, y: cb.y + Math.min(cb.height / 2, 120) };
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
  await page.waitForTimeout(400);
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
  await page.waitForTimeout(400);
  const list = page.getByTestId('visit-list');
  const lc = list.locator('[data-testid="person-btn"][data-kind="client"]').first();
  await rules(page, lc, '日・一覧の〈利用者さん〉', ['段階']);
  const ls = list.locator('[data-testid="person-btn"][data-kind="staff"]').first();
  await link(page, ls, '日・一覧の担当', '#/staff');
  // 印刷では i を出さず、名前のボタンはただの文字の見た目
  await open(page, '/plan', '.tl-band[draggable="true"]');
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(400);
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
  await page.waitForTimeout(200);
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
  await page.waitForTimeout(200);
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
  await page.waitForTimeout(500);
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
    await page.waitForTimeout(100);
  }
  const med = [...times].sort((a, b) => a - b)[2];
  check(med >= 0 && med <= 100, '週：i を押してから吹き出しが出るまで（中央値 100ms 以下）', times);
}

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(String(e));
    console.log('ERR', String(e));
  });
  for (const [name, fn] of [
    ['month', month],
    ['week', week],
    ['plan', plan],
    ['same-button-and-twice', sameButtonAndTwice],
    ['speed', speed],
    // データを書き換えるので最後に
    ['removed', removed],
  ]) {
    try {
      await fn(page);
    } catch (e) {
      check(false, name, String(e.message || e));
      await page.screenshot({ path: path.join(OUT_DIR, `fail-${name}.png`) }).catch(() => {});
    }
  }
  await b.close();
  console.log(`スクリーンショット：${OUT_DIR}`);
  const ng = fails + errors.length;
  console.log(ng === 0 ? '全部通った' : `${fails} 件が通らない・ページのエラー ${errors.length} 件`);
  process.exit(ng === 0 ? 0 : 1);
})();
