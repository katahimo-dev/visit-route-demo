// 言葉と案内（PRD D173〜D177。ADR-0025 追記）を本物のブラウザで確かめる：
// 点数の理由（日の画面の今の案の帯の点数の横・比較の画面の記録の表。読み上げの前置き）、
// 用語の説明（マウスを重ねると出て離れると消える・Tab のフォーカスで出て Esc で消える（フォーカスは用語のまま）・Tab で外れると消える・
// aria-describedby の先が role="tooltip" で説明の文・タッチで押すと開き、もう一度押すと閉じる・外を押すと閉じる・画面に収まる）、
// 言い換え（稼働の見込みの「出勤〜退勤（拘束）」「空き時間（待ち）」、乱数の種は「詳細設定」に畳む）、
// 空の画面（週：案が無い／訪問が無い、稼働の見込み、比較：なぜ空かと次の一手。まとめて作るのボタンで月の画面の欄が開き ?do= が消える・
// 日の画面のボタンでその日の日の画面）、空き状況の案の無い日の注意は1か所、
// 月の凡例（はじめは畳む・開く・読み直すと畳む（保存しない）・マスにマウスを重ねる／フォーカスで読み方・Esc で消す）、
// 相性のセルの記号の意味（title・aria-label）、390px で収まる・印刷で用語の説明・ボタン・凡例の開け閉めを出さない、ブラウザの確認を出さない。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-words.cjs
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
const OUT_DIR = process.env.OUT_DIR || path.join(os.tmpdir(), 'e2e-words');
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
const YM = TODAY.slice(0, 7);
const MONTH = Number(YM.slice(5, 7));
const STORAGE_KEY = 'vrdemo:data:v1';
fs.mkdirSync(OUT_DIR, { recursive: true });

let fails = 0;
function check(ok, name, info = '') {
  if (!ok) fails++;
  console.log(
    `${ok ? 'OK  ' : 'NG  '} ${name}${info === '' ? '' : `  ${typeof info === 'string' ? info : JSON.stringify(info)}`}`,
  );
}
const settle = (page, ms = 250) => page.waitForTimeout(ms);
const hashOf = (page) => decodeURIComponent(new URL(page.url()).hash);
/** 日付を n 日ずらす（YYYY-MM-DD） */
function addDays(d, n) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/**
 * 画面を新しく開く（e2e-home と同じ。about:blank を挟み、同じ文書の中で hash を移したときに読み直す前の `?do=` の処理で
 * 消えるのを避ける）。wait の要素が出るまで待つ
 */
async function open(page, hash, wait) {
  await page.goto('about:blank');
  await page.goto(`${BASE}#${hash}`);
  await page.locator(wait).first().waitFor({ timeout: 60000 });
  await settle(page, 300);
}
/** 初期データに戻す（ホームはデータを書かないので、ホームで消してから読み直す） */
async function resetData(page) {
  await open(page, '/home', 'h1');
  await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
  await page.reload();
  await page.locator('h1').waitFor();
}
/** 日の画面を開き、今の案が出て計算が終わるまで待つ */
async function openPlan(page) {
  await open(page, '/plan', '[data-testid="confirm-state"]');
  await page.getByTestId('plan-progress').waitFor({ state: 'detached', timeout: 60000 });
  await settle(page, 300);
}
/** 用語のボタン k の説明の要素（aria-describedby の先） */
async function tipOf(page, term) {
  const id = await term.getAttribute('aria-describedby');
  return { id, loc: page.locator(`[id="${id}"]`) };
}
/** el の直前（Tab の順）の要素にフォーカスを置いてから Tab で el へ入る（キーボードで来たフォーカス＝:focus-visible） */
async function tabInto(page, el) {
  await el.evaluate((target) => {
    const sel =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
    const all = [...document.querySelectorAll(sel)].filter((x) => x.getClientRects().length > 0);
    const i = all.indexOf(target);
    const prev = all[i - 1];
    if (prev) prev.focus();
  });
  await page.keyboard.press('Tab');
  await settle(page, 150);
}
const activeTerm = (page) => page.evaluate(() => document.activeElement?.getAttribute('data-term') ?? '');

// ---- 点数の理由（日の画面・比較の画面）----
async function reason(page) {
  await resetData(page);
  await openPlan(page);
  const r = page.getByTestId('plan-reason');
  await r.waitFor({ timeout: 10000 });
  const text = await r.innerText();
  check(
    /移動が長め（\d+分）|相性.+が\d+件|入らない訪問 \d+件|空き時間（待ち）が長め|件数の偏り|合わない訪問|いつもの担当でない/.test(
      text,
    ),
    '日の画面：点数の横に点を下げているいちばんの理由',
    text,
  );
  const sr = await r.locator('.sr-only').innerText();
  check(sr === '点を下げているいちばんの理由：', '読み上げは「点を下げているいちばんの理由：…」', sr);
  const sameLine = await page
    .getByTestId('plan-summary')
    .evaluate((el) => el.contains(document.querySelector('[data-testid="plan-reason"]')));
  check(sameLine, '理由は今の案の帯（訪問・入らない・必須の違反・移動・点数）の中');
  await page.screenshot({
    path: path.join(OUT_DIR, 'plan-reason.png'),
    clip: { x: 0, y: 0, width: 1400, height: 400 },
  });
  // 比較の画面の記録の表にも同じ決まりで出す
  await open(page, '/compare', 'h1');
  await page.locator('.runs-table').waitFor({ timeout: 10000 });
  const n = await page.getByTestId('compare-reason').count();
  check(n >= 1, '比較の画面：記録の表の合計点の下にも理由', n);
  const ct = n > 0 ? await page.getByTestId('compare-reason').first().innerText() : '';
  check(
    ct.length > 0 && ct.replace(/\s/g, '') === text.replace(/\s/g, ''),
    '比較の画面：今の案と同じ記録なら日の画面と同じ文',
    {
      plan: text,
      compare: ct,
    },
  );
}

// ---- 用語の説明：マウス・キーボード・Esc ----
async function termMouseKeyboard(page) {
  await openPlan(page);
  const term = page.locator('[data-testid="plan-summary"] [data-term="dropped"]');
  const { id, loc: tip } = await tipOf(page, term);
  check(!!id && (await tip.getAttribute('role')) === 'tooltip', 'aria-describedby の先は role="tooltip"', id);
  check(!(await tip.isVisible()), 'はじめは説明を出さない');
  const desc = await tip.evaluate((el) => el.textContent);
  check(/予定にも入れられなかった訪問/.test(desc ?? ''), '説明の文（閉じていても aria-describedby で読める）', desc);
  await term.hover();
  await settle(page, 200);
  check(await tip.isVisible(), 'マウスを重ねると説明が出る');
  const tb = await tip.boundingBox();
  const ab = await term.boundingBox();
  check(tb && ab && tb.y >= ab.y + ab.height - 1, '説明は用語の下に出る', { tb, ab });
  await page.screenshot({ path: path.join(OUT_DIR, 'term-hover.png'), clip: { x: 0, y: 0, width: 1400, height: 400 } });
  // 説明の上へ移っても消えない
  if (tb) await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 4 });
  await settle(page, 250);
  check(await tip.isVisible(), '説明の上へマウスを移しても消えない');
  await page.mouse.move(5, 700);
  await settle(page, 400);
  check(!(await tip.isVisible()), '離れると消える');
  // マウスで重ねて出したまま Esc で消える
  await term.hover();
  await settle(page, 200);
  await page.keyboard.press('Escape');
  await settle(page, 150);
  check(!(await tip.isVisible()), 'マウスで出した説明も Esc で消える');
  await page.mouse.move(5, 700);
  await settle(page, 300);
  // キーボード
  await tabInto(page, term);
  check((await activeTerm(page)) === 'dropped', 'Tab で用語へフォーカスが入る');
  check(await tip.isVisible(), 'キーボードのフォーカスで説明が出る');
  await page.keyboard.press('Escape');
  await settle(page, 150);
  check(!(await tip.isVisible()), 'Esc で説明が消える');
  check((await activeTerm(page)) === 'dropped', 'Esc のあともフォーカスは用語のまま');
  await page.keyboard.press('Tab');
  await settle(page, 150);
  check(!(await tip.isVisible()), 'Tab で外へ出ても出さない');
  const hard = page.locator('[data-testid="plan-summary"] [data-term="hard"]');
  check((await activeTerm(page)) === 'hard', 'Tab で次の用語（必須の違反）へ');
  const { loc: hardTip } = await tipOf(page, hard);
  check(await hardTip.isVisible(), '次の用語の説明が出る（前の用語の説明は消える）');
  check((await page.locator('[role="tooltip"]:visible').count()) === 1, '出ている説明は1つ');
  await page.keyboard.press('Shift+Tab');
  await settle(page, 150);
  check(await tip.isVisible(), 'Shift+Tab で戻ると前の用語の説明が出る（Esc で消したのは外れるまで）');
  // マウスで押しても行の操作は起きず、説明の開け閉めだけ
  await page.locator('body').click({ position: { x: 5, y: 700 } });
  await settle(page, 200);
  check((await page.locator('[role="tooltip"]:visible').count()) === 0, '外を押すと説明は無い');
  // 詳しくの「空き時間（待ち）」の言い換え（右の欄の中の用語でも Esc は説明だけを閉じる）
  await page.getByTestId('plan-detail').click();
  await page.locator('.drawer').first().waitFor();
  const wait = page.locator('.drawer [data-term="wait"]').first();
  check((await wait.innerText()) === '空き時間（待ち）', '詳しく：待ちは「空き時間（待ち）」', await wait.innerText());
  await tabInto(page, wait);
  const { loc: waitTip } = await tipOf(page, wait);
  check(await waitTip.isVisible(), '右の欄の中の用語もフォーカスで説明');
  await page.keyboard.press('Escape');
  await settle(page, 200);
  check(
    !(await waitTip.isVisible()) && (await page.locator('.drawer').count()) > 0,
    '右の欄の中で Esc：説明だけ閉じ、欄は開いたまま',
  );
  await page.keyboard.press('Escape');
  await settle(page, 300);
  check((await page.locator('.drawer').count()) === 0, 'もう一度 Esc で欄が閉じる');
}

// ---- 言い換え（稼働の見込み・条件の重み・データ）----
async function rename(page) {
  await open(page, `/workload?ym=${YM}`, 'h1');
  const lead = await page.locator('.page-lead').innerText();
  check(/出勤〜退勤（拘束）/.test(lead) && /空き時間（待ち）/.test(lead), '稼働の見込み：見出しの文の言い換え', lead);
  const span = page.getByTestId('term-span');
  check((await span.innerText()) === '出勤〜退勤（拘束）', '稼働の見込み：上限の設定の用語', await span.innerText());
  // ラベルの中の用語を押しても入力欄へは移らず、説明の開け閉めだけ
  await span.click();
  await settle(page, 150);
  const { loc: spanTip } = await tipOf(page, span);
  check(await spanTip.isVisible(), 'ラベルの中の用語を押すと説明が出る');
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
  check(focused !== 'work-limit', '押しても上限の入力欄へは移らない', focused);
  await page.locator('h1').click();
  await settle(page, 400);
  check(!(await spanTip.isVisible()), '外を押すと閉じる');
  // 条件の重み：乱数の種は「詳細設定」に畳む
  await open(page, '/rules', 'h1');
  const adv = page.getByTestId('rules-advanced');
  check((await adv.getAttribute('open')) === null, '条件の重み：「詳細設定」ははじめ畳む');
  check(!(await page.getByLabel('乱数の種').isVisible()), '乱数の種の入力欄は畳んだ中');
  await adv.locator('summary').click();
  await settle(page, 150);
  check(await page.getByLabel('乱数の種').isVisible(), '「詳細設定」を開くと乱数の種');
  check(await page.getByTestId('term-seed').isVisible(), '乱数の種に用語の説明');
  await page.reload();
  await page.locator('h1').waitFor();
  check((await page.getByTestId('rules-advanced').getAttribute('open')) === null, '読み直すと畳む（保存しない）');
  // データ：控え（バックアップ）・画面での呼び方
  await open(page, '/data', 'h1');
  check((await page.getByTestId('term-backup').innerText()) === '控え（バックアップ）', 'データ：控え（バックアップ）');
  check((await page.getByTestId('term-terms').innerText()) === '画面での呼び方', 'データ：画面での呼び方');
}

// ---- 空の画面 ----
async function empties(page) {
  await resetData(page);
  // 週：案が1日も無い（初期データは案が無い）
  await open(page, `/week?d=${TODAY}`, 'h1');
  const we = page.getByTestId('week-empty');
  await we.waitFor({ timeout: 10000 });
  const wt = await we.innerText();
  check(/この週(は案がありません|には訪問がありません)/.test(wt), '週：なぜ空か', wt);
  const batch = we.getByTestId('empty-next-batch');
  check((await batch.count()) === 1, '週：［この週の案を作る］（月のまとめて作る）');
  check((await we.locator('.btn-primary').count()) === 0, '週：主ボタンにしない（進み具合の帯の主ボタンと重ねない）');
  const href = await batch.getAttribute('href');
  check(/#\/month\?ym=\d{4}-\d{2}&do=batch$/.test(href ?? ''), '週：行き先は月の画面の ?do=batch', href);
  await page.screenshot({ path: path.join(OUT_DIR, 'week-empty.png') });
  await batch.click();
  const panel = page.getByRole('dialog', { name: /月の案をまとめて作る/ });
  await panel.waitFor({ timeout: 10000 });
  check(true, '週の［この週の案を作る］で月の画面のまとめて作るの欄が開く');
  check(/^#\/month\?ym=\d{4}-\d{2}$/.test(hashOf(page)), '月の画面：?do= は消える', hashOf(page));
  await page.keyboard.press('Escape');
  // 週：日の画面のボタンでその日の日の画面
  await open(page, `/week?d=${TODAY}`, '[data-testid="week-empty"]');
  const day = page.getByTestId('week-empty').getByTestId('empty-next-day');
  const dayLabel = await day.innerText();
  await day.click();
  await page.getByTestId('confirm-state').waitFor({ timeout: 60000 });
  check(hashOf(page).startsWith('#/plan'), '週の日の画面のボタンで日の画面（その日の案を自動で作る）', dayLabel);
  await page.getByTestId('plan-progress').waitFor({ state: 'detached', timeout: 60000 });
  // 案ができた週は空の画面を出さない
  await open(page, `/week?d=${TODAY}`, '[data-testid="week-grid"]');
  check((await page.getByTestId('week-empty').count()) === 0, '週：案のある日があれば空の画面を出さない');
  // 週：訪問の無い週（ずっと先）
  const far = addDays(TODAY, 7 * 30);
  await open(page, `/week?d=${far}`, '[data-testid="week-empty"]');
  const ft = await page.getByTestId('week-empty').innerText();
  check(/この週には訪問がありません/.test(ft), '週：訪問の無い週は「訪問がありません」', ft);
  // 稼働の見込み：来年の月（案が無い）
  const nextYm = `${Number(YM.slice(0, 4)) + 1}${YM.slice(4)}`;
  await open(page, `/workload?ym=${nextYm}`, '[data-testid="work-empty"]');
  const wk = page.getByTestId('work-empty');
  const wkt = await wk.innerText();
  check(/この月(は案がありません|には訪問がありません)/.test(wkt), '稼働の見込み：なぜ空か', wkt);
  check((await wk.getByTestId('empty-next-batch').count()) === 1, '稼働の見込み：月の画面のまとめて作るへのボタン');
  check((await wk.locator('.btn-primary').count()) === 1, '稼働の見込み：次の一手が主ボタン');
  await page.screenshot({ path: path.join(OUT_DIR, 'workload-empty.png') });
  // 比較：案の無い日（明日。週の ?d= で選んでいる日付を明日にし、読み直さずに比較の画面へ）
  const tomorrow = addDays(TODAY, 1);
  await open(page, `/week?d=${tomorrow}`, 'h1');
  await page.evaluate(() => {
    location.hash = '#/compare';
  });
  await page.getByTestId('compare-empty').waitFor({ timeout: 10000 });
  const cet = await page.getByTestId('compare-empty').innerText();
  check(/この日(の案はまだありません|には訪問がありません)/.test(cet), '比較：なぜ空か', cet);
  await page.screenshot({ path: path.join(OUT_DIR, 'compare-empty.png') });
  const cday = page.getByTestId('compare-empty').getByTestId('empty-next-day');
  check((await cday.count()) === 1, '比較：［日の画面で案を作る］');
  await cday.click();
  await page.getByTestId('confirm-state').waitFor({ timeout: 60000 });
  check(hashOf(page).startsWith('#/plan'), '比較の空の画面のボタンで日の画面へ（案を自動で作る）');
  // 空き状況：案の無い日の注意は1か所（表の上）
  await open(page, '/vacancy', 'h1');
  await page.getByTestId('vacancy-table-card').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="vacancy-grid"]'), null, { timeout: 30000 });
  const notes = await page.locator('.vacancy-noplan').count();
  check(notes <= 1, '空き状況：案の無い日の注意は1か所', notes);
  if (notes === 1) {
    const mk = page.getByTestId('vacancy-noplan-make');
    check(/do=batch$/.test((await mk.getAttribute('href')) ?? ''), '空き状況：注意から月のまとめて作るへ');
  }
}

// ---- 月の凡例・マスの読み方 ----
async function legend(page) {
  await open(page, `/month?ym=${YM}`, '[data-testid="month-grid"]');
  const fold = page.getByTestId('month-legend-fold');
  check((await fold.getAttribute('open')) === null, '月：凡例ははじめ畳む');
  check(!(await page.getByTestId('month-legend').isVisible()), '月：凡例の中身は畳んだ中');
  const line = await page.locator('.month-legend-line').innerText();
  check(/色＝日の状態/.test(line), '月：1行の要約', line);
  await page.getByTestId('month-legend-toggle').click();
  await settle(page, 150);
  check(await page.getByTestId('month-legend').isVisible(), '「凡例を見る」で開く');
  check(await page.getByTestId('term-free-zero').isVisible(), '凡例の「空き 0人」に用語の説明');
  await page.reload();
  await page.getByTestId('month-grid').waitFor();
  check((await page.getByTestId('month-legend-fold').getAttribute('open')) === null, '読み直すと畳む（保存しない）');
  // マスにマウスを重ねると読み方
  const cell = page.locator(`[data-testid="month-day"][data-date="${TODAY}"]`);
  check((await cell.getAttribute('title')) === null, 'マスに title を出さない（読み方の吹き出しと二重にしない）');
  await cell.hover();
  const tip = page.getByTestId('month-cell-tip');
  await tip.waitFor({ state: 'visible', timeout: 3000 });
  const tt = await tip.innerText();
  check(/このマスの読み方/.test(tt) && /背景/.test(tt), 'マスにマウスを重ねると読み方', tt.slice(0, 120));
  const restCell = page.locator('[data-testid="month-day"]:has([data-testid="month-resting"])').first();
  if ((await restCell.count()) > 0) {
    await restCell.hover();
    await settle(page, 200);
    check(/「休 N」＝休む/.test(await tip.innerText()), '「休 N」のあるマスは休 N の読み方（隣のマスへすぐ移る）');
  }
  await page.screenshot({ path: path.join(OUT_DIR, 'month-cell-tip.png') });
  await page.keyboard.press('Escape');
  await settle(page, 150);
  check(!(await tip.isVisible()), 'Esc で読み方を消す');
  await page.mouse.move(5, 5);
  await settle(page, 300);
  // キーボードのフォーカスで読み方（次のマスがある月の中ほどの日。月末に実行しても Tab で次のマスへ移れる）
  const midCell = page.locator(`[data-testid="month-day"][data-date="${YM}-10"]`);
  await tabInto(page, midCell);
  await settle(page, 150);
  check(await tip.isVisible(), 'キーボードでマスへ来ると読み方');
  const tb = await tip.boundingBox();
  const cb = await midCell.boundingBox();
  check(
    tb && cb && (tb.y >= cb.y + cb.height - 1 || tb.y + tb.height <= cb.y + 1),
    '読み方はマスの上か下（マスを隠さない）',
    {
      tb,
      cb,
    },
  );
  await page.keyboard.press('Tab');
  await settle(page, 150);
  check(await tip.isVisible(), 'Tab で次のマスへ移ると、そのマスの読み方');
  await page.locator('h1').click();
  await settle(page, 150);
  check(!(await tip.isVisible()), 'フォーカスが外れると消える');
  // 相性のセルの記号の意味
  await open(page, '/compat', '[data-testid="compat-table"]');
  const x = page.locator('.compat-btn', { hasText: '×' }).first();
  if ((await x.count()) > 0) {
    check(/担当にしない/.test((await x.getAttribute('aria-label')) ?? ''), '相性：× のセルの読み上げに意味');
    check(/× 担当にしない/.test((await x.getAttribute('title')) ?? ''), '相性：× のセルの title に意味');
  }
  const blank = page.locator('.compat-btn:not(.lv2):not(.lv1):not(.lvm1):not(.lvm2)').first();
  check(/未入力/.test((await blank.getAttribute('aria-label')) ?? ''), '相性：空のセルは「未入力」');
}

// ---- タッチ・390px・印刷 ----
async function mobile(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  page.on('pageerror', (e) => check(false, 'ページのエラー（390px）', String(e)));
  await openPlan(page);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(sw <= 390, '390px：日の画面が横にはみ出さない（点数の理由を足しても）', sw);
  const r = await page.getByTestId('plan-reason').boundingBox();
  check(r && r.x >= 0 && r.x + r.width <= 390, '390px：点数の理由が画面に収まる', r);
  const term = page.locator('[data-testid="plan-summary"] [data-term="dropped"]');
  const { loc: tip } = await tipOf(page, term);
  await term.tap();
  await settle(page, 200);
  check(await tip.isVisible(), 'タッチ：押すと説明が開く');
  const tb = await tip.boundingBox();
  check(tb && tb.x >= 0 && tb.x + tb.width <= 390, '390px：説明が画面に収まる', tb);
  await page.screenshot({ path: path.join(OUT_DIR, 'mobile-term.png') });
  await term.tap();
  await settle(page, 200);
  check(!(await tip.isVisible()), 'タッチ：もう一度押すと閉じる');
  await term.tap();
  await settle(page, 150);
  await page.locator('h1').tap();
  await settle(page, 200);
  check(!(await tip.isVisible()), 'タッチ：外を押すと閉じる');
  // 印刷：用語の説明・凡例の開け閉め・空の画面のボタンを出さない
  await term.tap();
  await settle(page, 150);
  await page.emulateMedia({ media: 'print' });
  check(!(await tip.isVisible()), '印刷：用語の説明を出さない');
  await page.emulateMedia({ media: 'screen' });
  // 月：凡例の要約が1行で収まる
  await open(page, `/month?ym=${YM}`, '[data-testid="month-legend-toggle"]');
  const lb = await page.getByTestId('month-legend-toggle').boundingBox();
  check(lb && lb.x + lb.width <= 390 && lb.height < 40, '390px：凡例の要約は1行で収まる', lb);
  await page.screenshot({ path: path.join(OUT_DIR, 'mobile-month.png') });
  await page.emulateMedia({ media: 'print' });
  check(!(await page.locator('.month-legend-open').isVisible()), '印刷：「凡例を見る」を出さない');
  await page.emulateMedia({ media: 'screen' });
  // 空の画面（ずっと先の週）
  await open(page, `/week?d=${addDays(TODAY, 7 * 30)}`, '[data-testid="week-empty"]');
  const eb = await page.getByTestId('week-empty').boundingBox();
  const sw2 = await page.evaluate(() => document.documentElement.scrollWidth);
  check(eb && eb.x >= 0 && eb.x + eb.width <= 390 && sw2 <= 390, '390px：週の空の画面が収まる', { eb, sw2 });
  await page.getByTestId('week-empty').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT_DIR, 'mobile-week-empty.png') });
  await page.emulateMedia({ media: 'print' });
  check(!(await page.getByTestId('empty-next-batch').first().isVisible()), '印刷：空の画面のボタンを出さない');
  await page.emulateMedia({ media: 'screen' });
  await ctx.close();
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
  // ブラウザのダイアログ（confirm・alert・prompt）が出たら失敗（PRD D146）
  const native = [];
  page.on('dialog', (d) => {
    if (d.type() === 'beforeunload') {
      d.accept();
      return;
    }
    native.push(`${d.type()}: ${d.message()}`);
    d.dismiss();
  });
  console.log(`今日：${TODAY}（${MONTH}月）`);
  for (const [name, fn] of [
    ['reason', reason],
    ['term', termMouseKeyboard],
    ['rename', rename],
    ['empties', empties],
    ['legend', legend],
  ]) {
    try {
      await fn(page);
    } catch (e) {
      check(false, name, String(e.message || e));
      await page.screenshot({ path: path.join(OUT_DIR, `fail-${name}.png`) }).catch(() => {});
    }
  }
  try {
    await mobile(b);
  } catch (e) {
    check(false, 'mobile', String(e.message || e));
  }
  check(native.length === 0, 'ブラウザのダイアログを出さない', native);
  await b.close();
  console.log(`スクリーンショット：${OUT_DIR}`);
  const ng = fails + errors.length;
  console.log(ng === 0 ? '全部通った' : `${fails} 件が通らない・ページのエラー ${errors.length} 件`);
  process.exit(ng === 0 ? 0 : 1);
})();
