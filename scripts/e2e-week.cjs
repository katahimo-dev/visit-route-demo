// 週間の時間軸の「〈利用者さん〉で見る」のつなぎこみ（PRD D136〜D140。ADR-0024 追記）を本物のブラウザで確かめる：
// 表からの引き継ぎ（絞り込みなし＝書かない・あり＝先頭8人）、9人目の上限の文、戻るボタンで選択が戻り上限の文が消える、
// 畳む・「あと N人」（1400px・390px。選んでいる人はいつも見え、選んでいない人は2行まで。開いた状態は週を送っても表と行き来しても残る）、
// 週を送ると その週の先頭8人（データを作って確かめる）、「ほかの人を探す」で選んだ この週に訪問の無い人がチップの後ろに出る。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-week.cjs
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
const OUT_DIR = process.env.OUT_DIR || path.join(os.tmpdir(), 'e2e-week');
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

const KEY = 'vrdemo:data:v1';
/** テストの「今日」（日本時間）と、その週・次の週の月曜 */
const TODAY = new Date(NOW.getTime() + JST).toISOString().slice(0, 10);
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
const urlOf = (page) => decodeURIComponent(page.url());

async function open(page, hash) {
  await page.goto(`${BASE}#${hash}`);
  await page.reload();
  await page.getByTestId('week-grid').or(page.getByTestId('week-client-filter')).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
}
async function expandChips(page) {
  const more = page.getByTestId('week-client-chips-more');
  if ((await more.count()) > 0 && (await more.getAttribute('aria-expanded')) === 'false') await more.click();
  await page.waitForTimeout(100);
}

/** 表から時間軸へ：絞り込んでいなければ書かない（先頭8人）、絞り込んでいればその先頭8人（PRD D139） */
async function handoff(page) {
  await open(page, '/week?view=clients&by=client');
  await page.getByTestId('tab-timeline').click();
  await page.waitForTimeout(300);
  check(
    !urlOf(page).includes('client=') && (await pressedIds(page)).length === 8,
    '表（絞り込みなし）→時間軸：先頭8人・URL に書かない',
    urlOf(page),
  );
  await page.getByTestId('tab-clients').click();
  await page.getByTestId('week-client-filter-input').fill('館');
  await page.waitForTimeout(800);
  const rows = await page
    .getByTestId('week-client-table')
    .locator('tbody tr')
    .evaluateAll((els) =>
      els.map((e) => e.querySelector('[data-client]')?.dataset.client ?? e.dataset.client).filter(Boolean),
    );
  await page.getByTestId('tab-timeline').click();
  await page.waitForTimeout(300);
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
  }, KEY);
  await open(page, '/week?by=client');
  await page.getByTestId('week-client-chips-none').click();
  await page.getByTestId('week-client-search').locator('summary').click();
  await page.getByTestId('week-client-picker-input').fill('ほか てすと');
  await page.getByTestId('week-client-picker-option').filter({ hasText: 'ほか テスト' }).click();
  await page.waitForTimeout(300);
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
  await page.waitForTimeout(200);
  const after = await pressedIds(page);
  await chipsOf(page).first().click(); // 戻す（8人＝初期値なので URL から消える）
  await page.waitForTimeout(200);
  await chipsOf(page).nth(8).click(); // 9人目：上限の文
  await page.waitForTimeout(300);
  const msg = await page.getByTestId('week-client-chips-message').innerText();
  check(msg.includes('8人まで') && (await pressedIds(page)).length === 8, '9人目は選ばずに上限の文', msg);
  await page.goBack();
  await page.waitForTimeout(400);
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
  await page.waitForTimeout(150);
  const all = await allIds(page);
  check(
    all.length === shown.length + n && (await more.innerText()) === '畳む',
    `${w}px：「あと N人」で全員を出す`,
    all.length,
  );
  await page.getByLabel('次の週').click();
  await page.waitForTimeout(400);
  await page.getByTestId('tab-clients').click();
  await page.getByTestId('tab-timeline').click();
  await page.waitForTimeout(300);
  check((await more.getAttribute('aria-expanded')) === 'true', `${w}px：開いた状態は週を送っても表と行き来しても残る`);
  const gridTop = () => page.getByTestId('week-grid').evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  const grid = { y: await gridTop() };
  await more.click();
  await page.waitForTimeout(150);
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
    [KEY, top, NEXT_MON],
  );
  await open(page, '/week?by=client');
  await page.getByLabel('次の週').click();
  await page.waitForTimeout(500);
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
    ['handoff', handoff],
    ['back', back],
    ['fold-1400', (p) => fold(p, 1400, 1000)],
    ['fold-390', (p) => fold(p, 390, 844)],
    // データを書き換えるので後ろに
    ['next-week', nextWeek],
    ['search', search],
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
