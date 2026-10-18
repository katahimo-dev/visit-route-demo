// 本物のマウス操作（mouse.down → move → up）で、画面のドラッグが動くかを確かめる（6種類）。
// 週の〈利用者さん〉で見るでは、初期値で先頭8人のチップが選ばれていることも確かめる（week-client-default。PRD D136・D137）。
// 週・スタッフ／週・利用者さん／利用者さん×曜日の表／予定の時間軸／予定の順番／月 → 日（予定の時間軸）。
// あわせて、週間の〈利用者さん〉×曜日の表の検索欄で日本語の変換（IME。CDP の Input.imeSetComposition）が壊れないかも確かめる
// （week-clients-ime。変換中は URL の ?cf= を書かず、確定後に書く。URL が外から変わったら入力欄を合わせる。PRD D109）。
// Playwright の dragTo や合成の DragEvent では、dragstart の中で画面の高さが変わってドラッグが取り消される不具合
// （src/lib/dragStart.ts）を再現できないため、マウスを本当に動かす。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-drag.cjs
// 環境変数（npm の依存には入れない。手元の Playwright・Chromium を使う）：
//   PLAYWRIGHT … Playwright のモジュールの場所（既定：require('playwright')、無ければ /opt/node22/lib/node_modules/playwright）
//   CHROMIUM   … Chromium の実行ファイル（既定：Playwright の既定の場所）
//   BASE       … 開くサイト（既定：http://localhost:4183/）
//   OUT_DIR    … スクリーンショットの置き場所（既定：OS の一時フォルダの e2e-drag）
//   FAKE_NOW   … ページの時計をこの時刻に止める（ISO 8601。例 2026-10-21T12:00:00+09:00）。既定は、実行した日から見て
//                次の水曜（今日が水曜なら今日）の日本時間 12:00。アプリは「今日」を日本時間で決め、今日より前の訪問は動かせないので、
//                週の途中に止めて今週に今日より後の日を残す（日曜に実行すると今週に動かし先が無くなるため）
// 終了コード：全部動けば 0、動かないものがあれば 1。ページのエラー（pageerror）も失敗に数える
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
const OUT_DIR = process.env.OUT_DIR || path.join(os.tmpdir(), 'e2e-drag');
const JST = 9 * 3600 * 1000;
/** 次の水曜（今日が水曜なら今日）の日本時間 12:00 */
function nextWednesdayNoonJst(now) {
  const j = new Date(now.getTime() + JST);
  const add = (3 - j.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() + add, 12) - JST);
}
const NOW = process.env.FAKE_NOW ? new Date(process.env.FAKE_NOW) : nextWednesdayNoonJst(new Date());
if (Number.isNaN(NOW.getTime())) throw new Error(`FAKE_NOW が日時として読めません：${process.env.FAKE_NOW}`);
/** テストの「今日」（アプリと同じく日本時間で決める） */
const TODAY = new Date(NOW.getTime() + JST).toISOString().slice(0, 10);
/** 動かし先が見つからないときは、null のまま進まず分かる言葉で止める */
function need(x, what) {
  if (!x) throw new Error(`${what}が見つかりません（今日＝${TODAY}。FAKE_NOW で週の途中の日にしてください）`);
  return x;
}
fs.mkdirSync(OUT_DIR, { recursive: true });

const withTimeout = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`固まった：${what}`)), ms))]);

/** 本物のマウス操作でつかんで動かして離す。つかんだあと（遅らせた再描画のあと）に元の要素が動いた距離も返す */
async function realDrag(page, src, target, name) {
  await src.scrollIntoViewIfNeeded();
  const sb = await src.boundingBox();
  const sx = sb.x + sb.width / 2;
  const sy = sb.y + Math.min(8, sb.height / 2);
  await page.evaluate(() => {
    window.__ev = [];
    for (const t of ['dragstart', 'dragend', 'drop']) document.addEventListener(t, () => window.__ev.push(t), true);
  });
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await withTimeout(page.mouse.move(sx + 6, sy + 6, { steps: 3 }), 3000, `${name}：つかみ`);
  await page.waitForTimeout(150); // 遅らせた再描画が済むまで
  const during = await src.boundingBox().catch(() => null);
  const { x, y } = await target();
  await withTimeout(page.mouse.move(x, y, { steps: 15 }), 3000, `${name}：移動`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, `dd-${name}-during.png`) });
  await withTimeout(page.mouse.up(), 3000, `${name}：離す`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, `dd-${name}-after.png`) });
  const ev = await page.evaluate(() => window.__ev);
  const moved = during ? Math.round(Math.hypot(during.x - sb.x, during.y - sb.y)) : null;
  return { ev, moved };
}

const results = [];
function report(name, ok, info) {
  results.push(ok);
  console.log(`${ok ? 'OK  ' : 'NG  '} ${name}  ${JSON.stringify(info)}`);
}

/**
 * 週間の時間軸の「〈利用者さん〉で見る」の初期値（PRD D136・D137）：この週に訪問がある人のチップが並び、?client= が無くても
 * 先頭8人（8人に満たなければ全員）が選ばれている。URL には書かない。確かめたら「ほかの人を探す」を開いて検索欄にフォーカスし、
 * 候補の欄を開いたままにしておく（開いた欄があっても帯をつかめるか）
 */
async function weekClientDefault(page) {
  const chips = page.getByTestId('week-client-chips').getByTestId('pick-chip');
  await chips.first().waitFor();
  const n = await chips.count();
  const pressed = await chips.evaluateAll((els) => els.map((el) => el.getAttribute('aria-pressed') === 'true'));
  const want = Math.min(8, n);
  const ok =
    pressed.slice(0, want).every(Boolean) && pressed.slice(want).every((p) => !p) && !page.url().includes('client=');
  report('week-client-default', ok, { chips: n, pressed: pressed.filter(Boolean).length, url: page.url() });
  // 9人目は選ばずに上限の文（PRD D138）。「全部外す」で0人（?client= が空）、「先頭8人に戻す」で URL から消える
  const pressedCount = () =>
    chips.evaluateAll((els) => els.filter((el) => el.getAttribute('aria-pressed') === 'true').length);
  if (n > 8) {
    await chips.nth(8).click();
    // 上限の文は読み上げ直すため、いったん空にしてから少し後に入る
    await page
      .waitForFunction(
        () => document.querySelector('[data-testid="week-client-chips-message"]')?.textContent !== '',
        null,
        { timeout: 2000 },
      )
      .catch(() => {});
    const msg = await page.getByTestId('week-client-chips-message').innerText();
    report('week-client-max', (await pressedCount()) === 8 && msg.includes('8人まで'), { msg });
  }
  await page.getByTestId('week-client-chips-none').click();
  await page.waitForTimeout(200);
  const none = (await pressedCount()) === 0 && /client=(&|$)/.test(page.url());
  await page.getByTestId('week-client-chips-reset').click();
  await page.waitForTimeout(200);
  report('week-client-none-reset', none && (await pressedCount()) === want && !page.url().includes('client='), {
    url: page.url(),
  });
  await page.getByTestId('week-client-search').locator('summary').click();
  await page.getByTestId('week-client-picker-input').focus();
}

async function weekTimeline(page, by) {
  const name = `week-${by}`;
  await page.goto(`${BASE}#/week${by === 'client' ? '?by=client' : ''}`);
  await page.reload();
  await page.getByTestId('week-col').first().waitFor();
  await page.waitForTimeout(800);
  // 〈利用者さん〉で見るときは初期値（この週の先頭8人）を確かめ、「ほかの人を探す」の候補の欄を開いたまま帯をつかむ
  if (by === 'client') await weekClientDefault(page);
  // つかむ帯：つかむ位置に別の要素（開いたままの候補の欄など）が重なっていない最初の帯
  const vid = await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-testid="week-band"][draggable="true"]')) {
      el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(8, r.height / 2));
      if (hit && el.contains(hit)) return el.dataset.visit;
    }
    return null;
  });
  need(vid, 'つかめる週の帯');
  const band = page.locator(`[data-testid="week-band"][data-visit="${vid}"]`);
  const from = await band.evaluate((el) => el.closest('[data-testid="week-col"]').dataset.date);
  const cols = page.getByTestId('week-col');
  let col = null;
  for (let i = 0; i < (await cols.count()); i++) {
    const d = await cols.nth(i).getAttribute('data-date');
    if (d !== from && d >= TODAY) {
      col = page.locator(`[data-testid="week-col"][data-date="${d}"]`);
      break;
    }
  }
  need(col, `動かし先の日（${from} 以外で ${TODAY} 以降の列）`);
  const open = await page
    .getByTestId('week-client-picker-input')
    .getAttribute('aria-expanded')
    .catch(() => null);
  const r = await realDrag(
    page,
    band,
    async () => {
      const cb = await col.boundingBox();
      return { x: cb.x + cb.width / 2, y: Math.min(cb.y + 120, 900) };
    },
    name,
  );
  const summary = await page
    .getByTestId('move-summary')
    .innerText()
    .catch(() => null);
  report(name, r.ev.includes('drop') && !!summary && r.moved === 0, { vid, pickerOpen: open, ...r, summary });
}

async function weekClients(page) {
  const name = 'week-clients';
  await page.goto(`${BASE}#/week?view=clients`);
  await page.reload();
  await page.getByTestId('week-client-filter').waitFor();
  await page.waitForTimeout(800);
  // 表は選ばずに、この週に訪問がある人を全員出す（PRD D108。絞り込みは既定のまま）
  await page.getByTestId('week-ccell').first().waitFor();
  const items = page.locator('[data-testid="week-citem"][draggable="true"]');
  let item = null;
  let cell = null;
  for (let i = 0; i < (await items.count()) && !cell; i++) {
    const it = items.nth(i);
    const { client, date } = await it.evaluate((el) => {
      const td = el.closest('td');
      return { client: td.dataset.client, date: td.dataset.date };
    });
    const cells = page.locator(`[data-testid="week-ccell"][data-client="${client}"]`);
    for (let j = 0; j < (await cells.count()); j++) {
      const d = await cells.nth(j).getAttribute('data-date');
      if (d !== date && d >= TODAY) {
        item = page.locator(`[data-testid="week-citem"][data-visit="${await it.getAttribute('data-visit')}"]`);
        cell = page.locator(`[data-testid="week-ccell"][data-client="${client}"][data-date="${d}"]`);
        break;
      }
    }
  }
  need(cell, `動かし先のマス（同じ〈利用者さん〉の、元の日以外で ${TODAY} 以降の日）`);
  const r = await realDrag(
    page,
    item,
    async () => {
      const cb = await cell.boundingBox();
      return { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 };
    },
    name,
  );
  const summary = await page
    .getByTestId('move-summary')
    .innerText()
    .catch(() => null);
  report(name, r.ev.includes('drop') && !!summary && r.moved === 0, { ...r, summary });
}

/** 予定の画面：訪問を別の担当の列へ移す（時間軸・順番） */
async function planMove(page, view, name) {
  await page.locator('.tl-band[draggable="true"], .route-col [draggable="true"]').first().waitFor({ timeout: 30000 });
  if (view === 'order') {
    await page.getByRole('button', { name: '順番', exact: true }).click();
    await page.waitForTimeout(500);
  }
  const srcSel =
    view === 'order' ? '.route-grid .route-col[data-staff] [draggable="true"]' : '.tl-band[draggable="true"]';
  const src = page.locator(srcSel).first();
  const vid = await src.getAttribute('data-visit').catch(() => null);
  const staffOf = () =>
    page.evaluate(
      (v) =>
        document.querySelector(`[draggable="true"][data-visit="${v}"]`)?.closest('[data-staff]')?.dataset.staff ?? null,
      vid,
    );
  const from = await staffOf();
  const cols = page.locator(view === 'order' ? '.route-grid .route-col[data-staff]' : '.tl-col[data-staff]');
  let col = null;
  for (let i = 0; i < (await cols.count()); i++) {
    const sid = await cols.nth(i).getAttribute('data-staff');
    if (sid !== from) {
      // nth は後から数え直されるので、列は担当の ID で指す（ドラッグ中に未割当の列が足される）
      col = page.locator(`${view === 'order' ? '.route-grid .route-col' : '.tl-col'}[data-staff="${sid}"]`);
      break;
    }
  }
  const r = await realDrag(
    page,
    src,
    async () => {
      await col.scrollIntoViewIfNeeded();
      const cb = await col.boundingBox();
      return { x: cb.x + cb.width / 2, y: cb.y + Math.min(cb.height / 2, 120) };
    },
    name,
  );
  await page.waitForTimeout(500);
  const to = await staffOf();
  report(name, r.ev.includes('drop') && to !== from && r.moved === 0, { vid, from, to, ...r });
}

/** 週間の表の検索欄で日本語を変換して確定する（変換中に入力欄が戻されない・確定後に URL に入る・外からの変更に合わせる） */
async function weekClientsIme(page) {
  const name = 'week-clients-ime';
  await page.goto(`${BASE}#/week?view=clients`);
  await page.reload();
  const input = page.getByTestId('week-client-filter-input');
  await input.waitFor();
  await input.click();
  const cdp = await page.context().newCDPSession(page);
  const steps = ['と', 'とし', 'としょ'];
  const during = [];
  for (const text of steps) {
    await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    // 遅らせて書く時間（300ms）より長く待つ。変換中に URL を書くと入力欄が戻され、変換が壊れる
    await page.waitForTimeout(450);
    during.push({ value: await input.inputValue(), cf: new URL(page.url().replace('#/', '')).searchParams.get('cf') });
  }
  await cdp.send('Input.insertText', { text: '図書' });
  await page.waitForTimeout(450);
  const value = await input.inputValue();
  const cf = new URL(page.url().replace('#/', '')).searchParams.get('cf') ?? '';
  // URL が外から変わったとき（戻るボタンなど）は入力欄を合わせる
  await page.evaluate(() => {
    location.hash = `#/week?view=clients&cf=${encodeURIComponent(`q:${encodeURIComponent('市')};chip:period`)}`;
  });
  await page.waitForTimeout(300);
  const synced = await input.inputValue();
  const okDuring = during.every((d, i) => d.value === steps[i] && (d.cf === null || !d.cf.includes('q:')));
  report(name, okDuring && value === '図書' && decodeURIComponent(cf).includes('図書') && synced === '市', {
    during,
    value,
    cf: decodeURIComponent(cf),
    synced,
  });
}

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const page = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  // ページの時計を週の途中の日本時間の日中に止める（FAKE_NOW。アプリの「今日」とテストの TODAY をそろえる）
  await page.clock.setFixedTime(NOW);
  console.log(`ページの時刻：${NOW.toISOString()}（今日＝${TODAY}）`);
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(String(e));
    console.log('ERR', String(e));
  });
  const run = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      report(name, false, String(e.message || e));
    }
  };
  await run('week-staff', () => weekTimeline(page, 'staff'));
  await run('week-client', () => weekTimeline(page, 'client'));
  await run('week-clients', () => weekClients(page));
  await run('week-clients-ime', () => weekClientsIme(page));
  await run('plan-timeline', async () => {
    await page.goto(`${BASE}#/plan`);
    await page.reload();
    await planMove(page, 'timeline', 'plan-timeline');
  });
  await run('plan-order', async () => {
    await page.goto(`${BASE}#/plan`);
    await page.reload();
    await planMove(page, 'order', 'plan-order');
  });
  await run('month-day', async () => {
    await page.goto(`${BASE}#/month`);
    await page.reload();
    const days = page.locator('[data-testid="month-day"]:not([data-state="empty"])');
    await days.first().waitFor();
    let d = null;
    for (let i = 0; i < (await days.count()); i++) {
      if ((await days.nth(i).getAttribute('data-date')) > TODAY) {
        d = days.nth(i);
        break;
      }
    }
    await need(d, `${TODAY} より後の月のマス`).click();
    await page.waitForURL(/#\/plan/);
    await planMove(page, 'timeline', 'month-day');
  });
  await b.close();
  const ng = results.filter((x) => !x).length;
  console.log(`スクリーンショット：${OUT_DIR}`);
  console.log(
    ng === 0 && errors.length === 0 ? '全部動いた' : `${ng} 件が動かない・ページのエラー ${errors.length} 件`,
  );
  process.exit(ng === 0 && errors.length === 0 ? 0 : 1);
})();
