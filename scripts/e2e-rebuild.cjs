// 条件を変えたら、その場で影響と「作り直す」を出す帯（PRD D161〜D165。ADR-0025 追記）を本物のブラウザで確かめる：
// 条件が変わった日が無ければ帯を出さない、条件の重みの画面で点数の基準のプリセットの重みを変えると帯が出る（入力の間は数えない）、
// 「影響する日 N日（未確定 a日・確定済み b日）」の数が月の画面の要対応の「条件が変わった」と同じ、読み上げ（変わったときだけ）、
// ［後で］でその画面の間だけ隠れる（フォーカスは見出し・ほかの画面では出る・戻ると出る・データに保存しない）、
// ［作り直す］で月の画面の「条件が変わった日だけ作り直す」の欄が開き ?do= が消える、作り直すと確定済みの日だけ残り「要対応を見る」、
// 390px で収まる、印刷で出さない、ブラウザの確認を出さない。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-rebuild.cjs
// 環境変数は scripts/e2e-drag.cjs と同じ（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { answerConfirms } = require('./lib/confirmDialog.cjs');

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
const OUT_DIR = process.env.OUT_DIR || path.join(os.tmpdir(), 'e2e-rebuild');
const JST = 9 * 3600 * 1000;
/** 次の水曜（今日が水曜なら今日）の日本時間 12:00（e2e-drag と同じ） */
function nextWednesdayNoonJst(now) {
  const j = new Date(now.getTime() + JST);
  const add = (3 - j.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() + add, 12) - JST);
}
const NOW = process.env.FAKE_NOW ? new Date(process.env.FAKE_NOW) : nextWednesdayNoonJst(new Date());
if (Number.isNaN(NOW.getTime())) throw new Error(`FAKE_NOW が日時として読めません：${process.env.FAKE_NOW}`);
/** アプリと同じく日本時間の今日（YYYY-MM-DD） */
const TODAY = new Date(NOW.getTime() + JST).toISOString().slice(0, 10);
const STORAGE_KEY = 'vrdemo:data:v1';
fs.mkdirSync(OUT_DIR, { recursive: true });

let fails = 0;
function check(ok, name, info = '') {
  if (!ok) fails++;
  console.log(
    `${ok ? 'OK  ' : 'NG  '} ${name}${info === '' ? '' : `  ${typeof info === 'string' ? info : JSON.stringify(info)}`}`,
  );
}
const hashOf = (page) => decodeURIComponent(new URL(page.url()).hash);
const monthNo = (ym) => Number(ym.slice(5, 7));
const band = (page) => page.getByTestId('rebuild-band');
const live = (page) => page.getByTestId('rebuild-live');

/** 帯の数え（読み上げの領域の data-*。帯を隠していても数える） */
async function counts(page) {
  return live(page).evaluate((el) => ({
    days: Number(el.dataset.days),
    unconfirmed: Number(el.dataset.unconfirmed),
    confirmed: Number(el.dataset.confirmed),
  }));
}
/** 画面を開いて、帯が数え終わる（読み上げの領域が置かれる）まで待つ */
async function openSettings(page, hash) {
  await page.goto(`${BASE}#${hash}`);
  await page.locator('h1').first().waitFor({ timeout: 30000 });
  await live(page).waitFor({ state: 'attached', timeout: 30000 });
  await page.waitForTimeout(300);
}
/** 日の画面で今の案ができる（自動作成）まで待つ */
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
/** 月の画面の要対応のうち「条件が変わった」の日付 */
async function staleInMonth(page, ym) {
  await page.goto(`${BASE}#/month?ym=${ym}`);
  await page.locator('[data-testid="progress-band"][data-ym]').waitFor({ timeout: 30000 });
  await page.getByTestId('band-attention').click();
  await page.waitForTimeout(300);
  const list = page.getByTestId('month-attention');
  if ((await list.count()) === 0) return 0;
  return list.locator('li').filter({ hasText: '条件が変わった' }).count();
}

// ---- 用意：今日の案（未確定）と、次の訪問のある日の案（確定）----
let SECOND = '';
async function prepare(page) {
  await page.goto(`${BASE}#/home`);
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.goto(`${BASE}#/plan`);
  await page.reload();
  await planReady(page);
  const options = await page.locator('.date-switch select option').evaluateAll((os) => os.map((o) => o.value));
  SECOND = options.find((d) => d > TODAY) ?? '';
  await page.locator('.date-switch select').selectOption(SECOND);
  await page.waitForFunction((d) => document.querySelector('.date-switch select')?.value === d, SECOND);
  await page.waitForTimeout(500);
  await planReady(page);
  await page.waitForFunction(() => !document.querySelector('[data-testid="adopt"]')?.disabled, null, {
    timeout: 60000,
  });
  await page.getByTestId('adopt').click();
  await page.waitForFunction(
    () => /確定済み/.test(document.querySelector('[data-testid="confirm-state"]')?.textContent ?? ''),
    null,
    { timeout: 10000 },
  );
  check(!!SECOND, '用意：今日の案（未確定）と次の日の案（確定）', { today: TODAY, second: SECOND });
}

// ---- 条件の重みの画面：変わった日が無ければ出さない → 基準のプリセットの重みを変えると出る ----
async function rules(page) {
  await openSettings(page, '/rules');
  check((await band(page).count()) === 0, '条件が変わった日が無ければ帯を出さない', await counts(page));
  check((await live(page).innerText()) === '', '読み上げの領域は最初から空で置く');
  // 点数の基準のプリセット（標準）の「待ち」の重みを動かす（スライダーの1段ずつ。入力の間は数えない）
  const preset = page.getByTestId('preset-edit').filter({ has: page.locator('.chip', { hasText: '点数の基準' }) });
  await preset.locator('summary').click();
  const slider = preset.locator('input[type="range"]:not([disabled])').last();
  await slider.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(100);
  check((await band(page).count()) === 0, '動かしている間（止まってから少しのあいだ）は数え直さない');
  await band(page).waitFor({ timeout: 10000 });
  const c = await counts(page);
  check(
    c.days === 2 && c.unconfirmed === 1 && c.confirmed === 1,
    '重みを変えると帯：影響する日 2日（未確定 1・確定済み 1）',
    c,
  );
  const text = await band(page).innerText();
  check(
    text.replace(/\s+/g, ' ').includes('条件が変わりました：影響する日 2日（未確定 1日・確定済み 1日）'),
    '帯の文',
    text,
  );
  await page.waitForFunction(() => document.querySelector('[data-testid="rebuild-live"]')?.textContent !== '');
  check(
    /影響する日 2日/.test(await live(page).innerText()),
    '数えた結果が変わったときだけ読み上げる',
    await live(page).innerText(),
  );
  const go = page.getByTestId('rebuild-go');
  check(
    /作り直す/.test(await go.innerText()) && !!(await go.getAttribute('aria-describedby')),
    '［作り直す］（説明は aria-describedby）',
  );
  check(
    !/btn-primary/.test((await go.getAttribute('class')) ?? ''),
    '［作り直す］は主ボタンにしない（画面の主ボタンと重ねない）',
  );
  // 帯は画面の上（見出しより上）
  const order = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="rebuild-band"]');
    const h = document.querySelector('.app-main h1');
    return !!b && !!h && !!(b.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  check(order, '帯は画面の上（見出しより前）');
  // 下へ巻いて設定を変えていても見える（広い画面では上の帯の下に貼り付く）
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(200);
  const pos = await band(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const h = document.querySelector('.app-header').getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), header: Math.round(h.bottom) };
  });
  check(pos.top >= pos.header && pos.bottom <= 1000, '下へ巻いても帯が上の帯の下に見えている', pos);
  await page.screenshot({ path: path.join(OUT_DIR, 'rules-band.png') });
}

// ---- 月の要対応と同じ数 ----
let BAND_DAYS = 0;
async function sameAsMonth(page) {
  await openSettings(page, '/rules');
  await band(page).waitFor({ timeout: 10000 });
  BAND_DAYS = (await counts(page)).days;
  const ym = TODAY.slice(0, 7);
  let n = await staleInMonth(page, ym);
  if (SECOND.slice(0, 7) !== ym) n += await staleInMonth(page, SECOND.slice(0, 7));
  check(n === BAND_DAYS, '帯の影響する日＝月の画面の要対応の「条件が変わった」', { band: BAND_DAYS, month: n });
}

// ---- ［後で］：その画面の間だけ隠す ----
async function later(page) {
  await openSettings(page, '/rules');
  await band(page).waitFor({ timeout: 10000 });
  const before = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  await page.getByTestId('rebuild-later').click();
  check((await band(page).count()) === 0, '［後で］で帯が隠れる');
  check(
    await page.evaluate(() => document.activeElement === document.querySelector('.app-main h1')),
    '［後で］のあとのフォーカスは画面の見出し',
  );
  const after = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  check(before === after, '［後で］はデータに保存しない');
  // 同じ画面で条件をまた変えても、この画面の間は隠したまま
  const slider = page.locator('.rules-table input[type="range"]:not([disabled])').first();
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1200);
  check((await band(page).count()) === 0, '同じ画面の間は隠したまま');
  check((await live(page).innerText()) === '', '隠したあとは読み上げない');
  // ほかの設定の画面では出る（相性・〈スタッフ〉）
  for (const [hash, name] of [
    ['/compat', '相性'],
    ['/staff', '〈スタッフ〉'],
    ['/clients', '〈利用者さん〉'],
    ['/availability', '稼働時間'],
    ['/types', '訪問の種類'],
    ['/items', '特性の項目'],
  ]) {
    await openSettings(page, hash);
    await band(page).waitFor({ timeout: 10000 });
    const c = await counts(page);
    check(c.days === BAND_DAYS, `${name}の画面にも同じ帯`, c);
  }
  // 予定の画面・ホームには出さない（要対応・進み具合の帯に残る）
  await page.goto(`${BASE}#/month`);
  await page.locator('[data-testid="progress-band"][data-ym]').waitFor({ timeout: 30000 });
  check((await band(page).count()) === 0, '月の画面には作り直しの帯を出さない');
  check(
    Number(await page.getByTestId('band-attention').getAttribute('data-count')) >= 1,
    '月の進み具合の帯の要対応には残る',
  );
  // 条件の重みの画面へ戻ると出る
  await openSettings(page, '/rules');
  await band(page).waitFor({ timeout: 10000 });
  check(true, '画面を出て戻ると帯がまた出る');
}

// ---- ［作り直す］：月の画面の欄が開き、作り直すと確定済みの日だけ残る ----
async function rebuild(page) {
  await openSettings(page, '/rules');
  await band(page).waitFor({ timeout: 10000 });
  const ym = TODAY.slice(0, 7);
  await page.getByTestId('rebuild-go').click();
  const panel = page.getByRole('dialog', { name: `${monthNo(ym)}月の案をまとめて作る` });
  await panel.waitFor({ timeout: 10000 });
  await page.waitForFunction(() => !/do=/.test(decodeURIComponent(location.hash)));
  check(hashOf(page) === `#/month?ym=${ym}`, '［作り直す］で月の画面へ。?do= は消える', hashOf(page));
  check(await page.getByTestId('batch-mode-stale').isChecked(), '欄は「条件が変わった日だけ作り直す」');
  const count = await page.getByTestId('batch-count').innerText();
  check(/対象の日：\s*1日/.test(count), '対象は未確定の日だけ（1日）', count);
  const note = await page.getByTestId('batch-stale-note').innerText();
  // 確定済みの日が同じ月なら欄に書く（月末で来月なら、この月の欄には書かない）
  const sameMonth = SECOND.slice(0, 7) === ym;
  check(
    sameMonth ? /確定済みの日 1日/.test(note) : !/確定済みの日/.test(note),
    '欄に（この月の）確定済みの日は作り直さないと書く',
    note,
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'month-panel.png') });
  await panel.getByRole('button', { name: '作り始める' }).click();
  await page.locator('.toast').filter({ hasText: '日分の案を作りました' }).first().waitFor({ timeout: 60000 });
  await openSettings(page, '/rules');
  await band(page).waitFor({ timeout: 10000 });
  const c = await counts(page);
  check(c.days === 1 && c.unconfirmed === 0 && c.confirmed === 1, '作り直すと確定済みの日だけ残る', c);
  const go = page.getByTestId('rebuild-go');
  check(/要対応を見る/.test(await go.innerText()), '確定済みの日だけなら［要対応を見る］', await go.innerText());
  await go.click();
  await page.getByTestId('month-attention').waitFor({ timeout: 10000 });
  check(!/do=/.test(hashOf(page)), '［要対応を見る］で月の画面の要対応（?do= は消える）', hashOf(page));
}

// ---- 390px・印刷 ----
async function mobile(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSettings(page, '/rules');
  await band(page).waitFor({ timeout: 10000 });
  const box = await band(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const btns = [...el.querySelectorAll('.btn')].map((b) => b.getBoundingClientRect().right);
    return { left: r.left, right: r.right, btnRight: Math.max(...btns), overflow: el.scrollWidth > el.clientWidth + 1 };
  });
  check(box.left >= 0 && box.right <= 390 && box.btnRight <= 390 && !box.overflow, '390px：帯が画面に収まる', box);
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  check(scrollW <= 390, '390px：横にはみ出さない', scrollW);
  await page.screenshot({ path: path.join(OUT_DIR, 'mobile-rules.png') });
  await page.emulateMedia({ media: 'print' });
  check(!(await band(page).isVisible()), '印刷：帯を出さない');
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 1400, height: 1000 });
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
  // 確認は独自のダイアログで受ける（ネイティブのダイアログが出たら失敗。PRD D146）
  const dlg = await answerConfirms(page);
  for (const [name, fn] of [
    ['prepare', prepare],
    ['rules', rules],
    ['same-as-month', sameAsMonth],
    ['later', later],
    ['mobile', mobile],
    ['rebuild', rebuild],
  ]) {
    try {
      await fn(page);
    } catch (e) {
      check(false, name, String(e.message || e));
      await page.screenshot({ path: path.join(OUT_DIR, `fail-${name}.png`) }).catch(() => {});
    }
  }
  check(dlg.native.length === 0, 'ブラウザのダイアログを出さない', dlg.native);
  await b.close();
  console.log(`スクリーンショット：${OUT_DIR}`);
  const ng = fails + errors.length;
  console.log(ng === 0 ? '全部通った' : `${fails} 件が通らない・ページのエラー ${errors.length} 件`);
  process.exit(ng === 0 ? 0 : 1);
})();
