// 月の予定の進み具合の帯（PRD D151〜D155・D332。ADR-0025 追記・ADR-0053・ADR-0054。週・日には出さない）を本物のブラウザで確かめる：
// 月の帯（data-ym・数字がホームの確定していない日と同じ）、月の画面の「担当を AI で組む」の主ボタンは帯の1か所
// （見出しのボタン・今月の準備は無い。帯の次の一手が主ボタン）で、押すと担当を組むの画面（#/arrange?ym=。ADR-0063）、
// 帯の数字で月の画面の欄が開く（URL を変えない）、古い `?do=batch` は担当を組むの画面へ移す、
// 週・日・ホームからの `?do=`（確定していない日・要対応）で月の画面の欄が開き ?do= が消える、来月も担当なしの日が多ければ「担当を AI で組む」、
// 日の予定で確定すると状態の印が確定済み・月の帯の確定 +1、週・日に進み具合の帯は無い（週は1行の状態）、
// 訪問の無いデータは「今日以降の訪問はありません」でボタンなし、
// 週・日の操作の行が速く出る・確定の操作が待たされない、スマホ（390×844）で月の帯が1行・横にはみ出さない、印刷で出さない。
// 担当を組むの画面で組み始めるとほかの画面へ移っても続き、上の帯に進み具合と［止める］、戻ると進み具合、知らせから担当を組むへ（PRD D256・D257）。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-progress.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）。PERF_MS_PROGRESS で帯が出るまでの上限（既定 3000ms。無ければ PERF_MS）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { answerConfirms } = require('./lib/confirmDialog.cjs');
const { BASE, OUT_DIR, TODAY, STORAGE_KEY, perfMs, check, hashOf, runSteps, settle } = require('./lib/env.cjs');
const { sharedPage, openPage } = require('./lib/steps.cjs');

const PERF_MS = perfMs('PERF_MS_PROGRESS', 3000);
const YM = TODAY.slice(0, 7);
/** 来月（YYYY-MM） */
function nextYm(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
const NEXT_YM = nextYm(YM);
/** その月の末日 */
function lastDayOf(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
const monthNo = (ym) => Number(ym.slice(5, 7));

/** 帯が数え終わる（data-ym が付く）まで待つ */
async function bandReady(page, timeout = 30000) {
  await page.locator('[data-testid="progress-band"][data-ym]').waitFor({ timeout });
}
async function open(page, hash, ready) {
  await page.goto(`${BASE}#${hash}`);
  await page.reload();
  await page
    .locator(ready ?? 'h1')
    .first()
    .waitFor({ timeout: 30000 });
  // 帯は月の予定だけ（PRD D332）
  if (hash.startsWith('/month')) await bandReady(page);
  await settle(page, 300);
}
/** 保存したデータを書き換える（ホームはデータを書かないので、ホームで書き換えてから読み直す） */
async function editData(page, fn, arg) {
  await page.goto(`${BASE}#/home`);
  await page.reload();
  await page.locator('h1').waitFor();
  await page.evaluate(fn, arg);
  await page.reload();
  await page.locator('h1').waitFor();
}
/**
 * 今日より後の担当を外す（繰り返しの担当と保存した回の担当。担当なしの日ができて、次の一手が「担当を AI で組む」になる形を作る。
 * 月末に近い日は初期データの担当（今日から7日分。PRD D225）と担当を AI で組むで今月が埋まることがあるため）
 */
async function dropLaterPlan(page) {
  await editData(
    page,
    ({ key, today }) => {
      const d = JSON.parse(localStorage.getItem(key));
      for (const p of d.patterns) p.usualStaffId = null;
      // 初期データで組んだ日（保存した回）も、今日より後は担当なしにする
      d.visits = d.visits.map((v) => (v.date > today ? { ...v, staffId: null, pinned: false } : v));
      localStorage.setItem(key, JSON.stringify(d));
    },
    { key: STORAGE_KEY, today: TODAY },
  );
}
/** 帯の数字 */
async function bandNumbers(page) {
  return page.getByTestId('progress-band').evaluate((el) => {
    const q = (id) => el.querySelector(`[data-testid="${id}"]`);
    return {
      ym: el.dataset.ym,
      next: el.dataset.next,
      planned: Number(q('band-plans').dataset.planned),
      days: Number(q('band-plans').dataset.days),
      confirmed: Number(q('band-confirm').dataset.confirmed),
      unconfirmed: Number(q('band-confirm').dataset.unconfirmed),
      attention: Number(q('band-attention').dataset.count),
      visits: q('band-visits').textContent,
    };
  });
}
/**
 * 担当をすべて外して読み直す（繰り返しの担当・保存した訪問の担当）。担当なしの日から始める確かめ用
 * （月末の6日以内は今月の残りが初期データの担当で埋まり、次の一手が「担当を AI で組む」にならないため）
 */
async function clearPlans(page) {
  await editData(
    page,
    (key) => {
      const d = JSON.parse(localStorage.getItem(key));
      for (const p of d.patterns) p.usualStaffId = null;
      d.visits = d.visits.map((v) => ({ ...v, staffId: null, pinned: false }));
      d.snapshots = {};
      localStorage.setItem(key, JSON.stringify(d));
    },
    STORAGE_KEY,
  );
}
/** 保存した訪問のうち、その月の担当の入った件数（担当を AI で組むと増える） */
const assignedIn = (page, ym) =>
  page.evaluate(
    ({ k, m }) => JSON.parse(localStorage.getItem(k)).visits.filter((v) => v.date.startsWith(m) && v.staffId).length,
    { k: STORAGE_KEY, m: ym },
  );

// ---- 月の画面：入口は帯の1か所 ----
async function monthEntry(page) {
  await editData(page, (key) => localStorage.removeItem(key), STORAGE_KEY);
  await clearPlans(page);
  await open(page, `/month?ym=${YM}`, '[data-testid="month-grid"]');
  check(
    (await page.getByTestId('progress-band').isVisible()) &&
      (await page.getByTestId('progress-band').getAttribute('data-ym')) === YM,
    '月：見出しの下に帯（この月）',
  );
  check((await page.getByTestId('month-prep').count()) === 0, '月：今月の準備（①〜③）は帯にまとめた');
  check(
    (await page.locator('.page-head .page-actions').count()) === 0,
    '月：見出しに「◯月の担当を AI で組む」のボタンが無い',
  );
  const entries = await page
    .locator('main button:visible, main a:visible')
    .filter({ hasText: '担当を AI で組む' })
    .count();
  check(entries === 1, '月：「担当を AI で組む」の入口は1か所', entries);
  const next = page.getByTestId('band-next');
  check(
    (await next.getAttribute('data-kind')) === 'batch' && /btn-primary/.test((await next.getAttribute('class')) ?? ''),
    '月：担当なしの日があるので次の一手は「担当を AI で組む」（主ボタン）',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'month-band.png') });
  await next.click();
  await page.waitForURL(/#\/arrange/, { timeout: 10000 });
  check(hashOf(page) === `#/arrange?ym=${YM}`, '月：帯の「担当を AI で組む」で担当を組むの画面（その月）', hashOf(page));
  await page.getByTestId('arrange-start').waitFor({ timeout: 10000 });
  // 古い ?do=batch は担当を組むの画面へ移す
  await page.evaluate((ym) => {
    location.hash = `#/month?ym=${ym}&do=batch`;
  }, YM);
  await page.waitForFunction(() => location.hash.startsWith('#/arrange'), null, { timeout: 10000 });
  check(hashOf(page) === `#/arrange?ym=${YM}`, '月：古い ?do=batch は担当を組むの画面へ', hashOf(page));
  await open(page, `/month?ym=${YM}`, '[data-testid="month-grid"]');
  // 帯の数字 → 右の欄（画面の中で開く）
  await page.getByTestId('band-confirm').click();
  await page.getByTestId('month-unconfirmed').waitFor({ timeout: 5000 });
  const nums = await bandNumbers(page);
  const listed = await page.getByTestId('month-unconfirmed').locator('li').count();
  check(listed === nums.unconfirmed, '月：帯の確定していない日数＝右の欄の日数', { band: nums.unconfirmed, listed });
  await page.getByTestId('band-attention').click();
  await settle(page, 300);
  const att = await page.getByTestId('month-attention').locator('li').count();
  check(att === nums.attention, '月：帯の要対応＝右の欄の要対応', { band: nums.attention, listed: att });
  // 見出しの下の要約は月全体で、帯と同じ言葉（訪問・案のある日）を並べない（PR #38 のレビュー）
  const sum = await page.getByTestId('month-summary').innerText();
  check(
    !/訪問|案のある日/.test(sum) && /月全体：担当なし/.test(sum),
    '月：要約は帯に無いもの（月全体の担当なし など）だけ',
    sum,
  );
  // 数字のリンクは押すと何が起きるかを読み上げる
  const label = await page.getByTestId('band-plans').getAttribute('aria-label');
  check(
    /^担当が全部入った日 \d+\/\d+日.*。担当を組むの画面を開く$/.test(label ?? ''),
    '月：数字のリンクの aria-label',
    label,
  );
  check(
    (await page.getByTestId('band-live').count()) === 1 && (await page.getByTestId('band-live').innerText()) === '',
    '月：読み上げの領域は最初から空で置く',
  );
  // Ctrl+クリックはブラウザに任せる（新しいタブで月の画面。この画面の欄は開かない）
  const [popup] = await Promise.all([
    page.context().waitForEvent('page', { timeout: 5000 }),
    page.getByTestId('band-confirm').click({ modifiers: ['ControlOrMeta'] }),
  ]);
  await popup.waitForURL(/#\/month/, { timeout: 10000 }).catch(() => {});
  check(
    /#\/month\?ym=/.test(decodeURIComponent(popup.url())) && hashOf(page) === `#/month?ym=${YM}`,
    '月：Ctrl+クリックは新しいタブで開く（この画面はそのまま）',
    popup.url(),
  );
  await popup.close();
}

// ---- 来月：繰り返しの回は繰り返しの担当で最初から入る（版2。未作成は無い）。担当なしの日が多ければ「担当を AI で組む」 ----
async function nextMonth(page) {
  await open(page, `/month?ym=${NEXT_YM}`, '[data-testid="month-grid"]');
  const v0 = await page.getByTestId('band-visits').innerText();
  check(!/未作成/.test(v0) && /\d+件/.test(v0), '来月：訪問は繰り返しから計算して数える（未作成は無い）', v0);
  check((await page.locator('[data-testid="month-day"][data-unmade]').count()) === 0, '来月：マスに「未作成」は無い');
  const n = await bandNumbers(page);
  check(n.days > 0 && n.planned <= n.days, '来月：担当が全部入った日の数', n);
  if ((await page.getByTestId('band-next').getAttribute('data-kind')) === 'batch') {
    await page.getByTestId('band-next').click();
    await page.waitForURL(/#\/arrange/, { timeout: 10000 });
    check(hashOf(page) === `#/arrange?ym=${NEXT_YM}`, '来月：次の一手「担当を AI で組む」で担当を組むの画面（来月）', hashOf(page));
  }
}

// ---- 担当を組むで組み始めると画面を移っても続く（PRD D256・D257。ADR-0042）：上の帯に進み具合と［止める］、戻ると進み具合、知らせから担当を組むへ ----
async function keepRunning(page) {
  await clearPlans(page);
  await open(page, `/arrange?ym=${YM}`, '[data-testid="arrange-start"]');
  await settle(page, 500);
  await page.getByTestId('arrange-start').click();
  await page.getByTestId('arrange-progress').waitFor({ timeout: 10000 });
  check((await page.getByTestId('batch-band').count()) === 0, '担当を組むの画面では上の帯に出さない（画面の中に進み具合）');
  check(
    (await page.getByTestId('arrange-start').getAttribute('aria-disabled')) === 'true',
    '組んでいる間は「AI で組む」を押せない（二重に始めない）',
  );
  // 読み直さずにホームへ（HashRouter の中で移る）
  await page.evaluate(() => {
    location.hash = '#/home';
  });
  const bandText = page.getByTestId('batch-band-text');
  await bandText.waitFor({ timeout: 10000 });
  const t0 = await bandText.innerText();
  check(
    new RegExp(`^${monthNo(YM)}月の担当を組んでいます \\d+/\\d+日$`).test(t0),
    'ほかの画面へ移っても組み続け、上の帯に「◯月の担当を組んでいます N/M日」',
    t0,
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'batch-band-home.png') });
  // 進む（日ごとに提案にたまる。反映するまで訪問は書かない。ADR-0054）
  const progressed = await page
    .waitForFunction((t) => (document.querySelector('[data-testid="batch-band-text"]')?.textContent ?? t) !== t, t0, {
      timeout: 60000,
    })
    .then(() => true)
    .catch(() => false);
  check(progressed, 'ホームにいる間も組み続ける（上の帯の日数が進む）');
  check((await assignedIn(page, YM)) === 0, '組んでいる間は訪問に書かない（提案にためる）');
  // 帯の文から担当を組むへ戻ると、画面の中に進み具合
  await bandText.click();
  await page.waitForURL(/#\/arrange/);
  await page.getByTestId('arrange-progress').waitFor({ timeout: 10000 });
  check(hashOf(page) === `#/arrange?ym=${YM}`, '帯の文で担当を組む（その月）へ戻ると進み具合が見える', hashOf(page));
  // 月の予定でも画面の中に進み具合（上の帯は出さない）
  await page.evaluate((ym) => {
    location.hash = `#/month?ym=${ym}`;
  }, YM);
  await page.getByTestId('month-progress').waitFor({ timeout: 10000 });
  check((await page.getByTestId('batch-band').count()) === 0, '月の予定でも上の帯に出さない（画面の中に進み具合）');
  // ほかの画面（予定でない画面）の帯の［止める］で止め、知らせの［担当を組むを開く］で担当を組むへ
  await page.evaluate(() => {
    location.hash = '#/home';
  });
  await page.getByTestId('batch-band-stop').click();
  const toast = page.locator('.toast').filter({ hasText: /の担当を\d+日分組んだところで止めました/ });
  await toast.waitFor({ timeout: 60000 });
  check(true, '［止める］で止まり、知らせ（作った日数）');
  check((await page.getByTestId('batch-band').count()) === 0, '止めたら上の帯は消える');
  await page.getByTestId('batch-done-open').click();
  await page.waitForURL(/#\/arrange/);
  check(hashOf(page) === `#/arrange?ym=${YM}`, '知らせの［担当を組むを開く］で担当を組む（その月）へ', hashOf(page));
  check((await page.getByTestId('arrange-progress').count()) === 0, '止めたあとは進み具合を出さない');
  const stoppedBand = await page
    .locator('[data-testid="proposal-band"][data-kind="range"]')
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  check(
    stoppedBand,
    '止めたあと：そこまでの日の提案の帯が出る（反映するまで変わらない）',
    await toast.innerText().catch(() => ''),
  );
  check((await assignedIn(page, YM)) === 0, '止めても反映するまで訪問は変わらない');
  // 担当を組むの画面にいる間に終わったら、知らせに［担当を組むを開く］を出さない（行き先が今の画面。PRD D268）
  await page.getByTestId('arrange-mode-all').check();
  await page.getByTestId('arrange-start').click();
  await page.getByTestId('confirm-dialog').waitFor({ timeout: 5000 });
  await page.getByTestId('confirm-dialog').getByRole('button', { name: '捨てて組み始める' }).click();
  const progress = page.getByTestId('arrange-progress');
  await progress.waitFor({ timeout: 10000 });
  await page.getByTestId('arrange-stop').click();
  const toast2 = page.locator('.toast').filter({ hasText: /の担当を\d+日分組んだところで止めました/ });
  await toast2.waitFor({ timeout: 60000 });
  check(
    (await page.getByTestId('batch-done-open').count()) === 0,
    '担当を組むの画面にいるときの知らせには［担当を組むを開く］を出さない（PRD D268）',
  );
}

// ---- 日の画面：確定すると状態の印が確定済み・月の帯の確定が増える（週・日に帯は無い。PRD D332） ----
async function dayConfirm(page) {
  await editData(page, (key) => localStorage.removeItem(key), STORAGE_KEY);
  await open(page, `/month?ym=${YM}`, '[data-testid="month-grid"]');
  const n0 = await bandNumbers(page);
  check(n0.ym === YM && n0.days >= 1, '月の帯は今月を数える', n0);
  await page.goto(`${BASE}#/plan`);
  await page.reload();
  await page.getByTestId('confirm-state').waitFor({ timeout: 60000 });
  await settle(page, 800);
  check((await page.getByTestId('progress-band').count()) === 0, '日：進み具合の帯は出さない（月だけ）');
  check(
    /まだ伝えていない/.test(await page.getByTestId('confirm-state').innerText()),
    '日：状態の印「まだ伝えていない」',
  );
  const t0 = Date.now();
  await page.getByTestId('adopt').click();
  await page.waitForFunction(() =>
    /確定済み/.test(document.querySelector('[data-testid="confirm-state"]')?.textContent ?? ''),
  );
  const confirmMs = Date.now() - t0;
  check(confirmMs < 1500, '日：確定の操作が待たされない', `${confirmMs}ms`);
  await open(page, `/week?d=${TODAY}`, '[data-testid="week-title"]');
  check(
    (await page.getByTestId('progress-band').count()) === 0 && (await page.getByTestId('week-status').count()) === 1,
    '週：進み具合の帯は無く、1行の状態',
  );
  check(
    /確定済み [1-9]/.test(await page.getByTestId('week-status').innerText()),
    '週の1行の状態に確定済みの日',
    await page.getByTestId('week-status').innerText(),
  );
  await open(page, `/month?ym=${YM}`, '[data-testid="month-grid"]');
  const n1 = await bandNumbers(page);
  check(
    n1.confirmed === n0.confirmed + 1 && n1.unconfirmed === n0.unconfirmed - 1,
    '日で確定すると月の帯の確定 +1・確定していない日 −1',
    { before: n0, after: n1 },
  );
  await open(page, '/home', '[data-testid="home-tasks"]');
  const card = page.locator('[data-kind="confirm"] strong').filter({ hasText: `${monthNo(YM)}月の確定していない日` });
  const title = (await card.count()) > 0 ? await card.innerText() : '';
  const homeN = Number(/(\d+)日を確認/.exec(title)?.[1] ?? 0);
  check(homeN === n1.unconfirmed, 'ホームの確定していない日＝月の帯の確定していない日', {
    home: homeN,
    band: n1.unconfirmed,
  });
}

// ---- 週・日・ホームから月の画面の欄へ（?do=。進み具合の帯は月だけ） ----
async function links(page) {
  await open(page, `/month?ym=${YM}`, '[data-testid="month-grid"]');
  const n = await bandNumbers(page);
  for (const [op, want] of [
    ['attention', '要対応'],
    ['unconfirmed', '確定していない日'],
  ]) {
    await open(page, `/week?d=${TODAY}`, '[data-testid="week-title"]');
    await page.evaluate(
      ([ym, o]) => {
        location.hash = `#/month?ym=${ym}&do=${o}`;
      },
      [YM, op],
    );
    await page.locator('.month-aside-title').filter({ hasText: want }).first().waitFor({ timeout: 10000 });
    await page.waitForFunction(() => !/do=/.test(decodeURIComponent(location.hash)), null, { timeout: 10000 });
    check(hashOf(page) === `#/month?ym=${YM}`, `週から ?do=${op} → 月の予定の${want}、?do= は消える`, hashOf(page));
  }
  const listed = await page.getByTestId('month-unconfirmed').locator('li').count();
  check(listed === n.unconfirmed, '月の予定の確定していない日＝帯の日数', { listed, band: n.unconfirmed });
  // 担当なしの日を作る（繰り返しの担当を外す）
  await dropLaterPlan(page);
  await open(page, `/month?ym=${YM}`, '[data-testid="month-grid"]');
  check(
    (await page.getByTestId('band-next').getAttribute('data-kind')) === 'batch',
    '担当なしの日が多い：月の帯の次の一手は「担当を AI で組む」',
  );
}

// ---- 週・日の操作の行が速く出る（版2：日の割当は訪問から毎回計算する） ----
async function perf(page) {
  await editData(page, (key) => localStorage.removeItem(key), STORAGE_KEY);
  for (const [hash, ready] of [
    [`/week?d=${TODAY}`, '[data-testid="week-title"]'],
    ['/plan', '[data-testid="confirm-state"]'],
  ]) {
    await page.goto(`${BASE}#/home`);
    await page.reload();
    await page.locator('h1').waitFor();
    const t0 = Date.now();
    await page.goto(`${BASE}#${hash}`);
    await page.locator(ready).waitFor({ timeout: 30000 });
    await page.getByTestId('schedule-toolbar').waitFor({ timeout: 30000 });
    const bar = Date.now() - t0;
    check(bar < PERF_MS, `${hash}：操作の行が ${PERF_MS}ms 以内に出る`, { bar });
  }
  // 帯の「担当」から開くと、既定は「要対応のある日だけ」（組み直しは利用者が選んだときだけ。PR #38 のレビュー）
  await open(page, `/month?ym=${YM}`, '[data-testid="month-grid"]');
  const nm = await bandNumbers(page);
  await page.getByTestId('band-plans').click();
  const panel = batchPanel(page, YM);
  if (!(await expectBatch(page, nm, '帯の「担当」から'))) return;
  check(
    await panel.getByTestId('batch-mode-care').isChecked(),
    '開いたときの既定は「要対応のある日だけ」',
    await panel.getByTestId('batch-count').innerText(),
  );
  await page.keyboard.press('Escape');
}

// ---- 訪問の無いデータ：ボタンなし ----
async function empty(page) {
  await editData(
    page,
    (key) => {
      const d = JSON.parse(localStorage.getItem(key));
      d.visits = d.visits.map((v) => ({ ...v, cancelled: true }));
      d.patterns = [];
      d.snapshots = {};
      d.absences = [];
      localStorage.setItem(key, JSON.stringify(d));
    },
    STORAGE_KEY,
  );
  await open(page, `/month?ym=${YM}`, '[data-testid="month-grid"]');
  const next = page.getByTestId('band-next');
  check(
    (await next.getAttribute('data-kind')) === 'empty' && (await next.evaluate((el) => el.tagName)) === 'SPAN',
    '訪問の無い月：「今日以降の訪問はありません」でボタンなし',
    await next.innerText(),
  );
  await editData(page, (key) => localStorage.removeItem(key), STORAGE_KEY);
}

// ---- スマホ（390×844）で1行・印刷で出さない ----
async function mobile(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [hash, ready, name] of [
    // 390px の月ははじめ日ごとの一覧（PRD D189）。カレンダーと一覧のどちらでもある切り替えを待つ
    [`/month?ym=${YM}`, '[data-testid="month-layout"]', 'month'],
  ]) {
    await page.goto(`${BASE}#${hash}`);
    await page.reload();
    await page.locator(ready).waitFor({ timeout: 60000 });
    await bandReady(page);
    await settle(page, 300);
    const box = await page.getByTestId('progress-band').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const kids = [...el.querySelectorAll('.pb-month, .pb-item, [data-testid="band-next"]')]
        .filter((x) => x.getBoundingClientRect().width > 0)
        .map((x) => x.getBoundingClientRect());
      return {
        h: Math.round(r.height),
        right: Math.round(r.right),
        overflow: el.scrollWidth > el.clientWidth + 1,
        // 行の数：縦の中心が前の行の中心から8px以上離れたら次の行（ページの巻いた位置で8px刻みの境をまたいで2行と数えない）
        rows: kids
          .map((k) => k.top + k.height / 2)
          .sort((a, b) => a - b)
          .reduce((m, c, i, all) => (i > 0 && c - all[i - 1] >= 8 ? m + 1 : m), 1),
        tops: kids.map((k) => Math.round(k.top)),
      };
    });
    check(box.h <= 50 && box.right <= 390 && !box.overflow && box.rows === 1, `390px（${name}）：帯が1行に収まる`, box);
    check(!(await page.getByTestId('band-visits').isVisible()), `390px（${name}）：訪問の件数は省く`);
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    check(scrollW <= 390, `390px（${name}）：横にはみ出さない`, scrollW);
    await page.screenshot({ path: path.join(OUT_DIR, `mobile-${name}.png`) });
    await page.emulateMedia({ media: 'print' });
    check(!(await page.getByTestId('progress-band').isVisible()), `印刷（${name}）：帯を出さない`);
    await page.emulateMedia({ media: 'screen' });
  }
  await page.setViewportSize({ width: 1400, height: 1000 });
}

const steps = sharedPage({
  open: async () => {
    const s = await openPage();
    // 確認は独自のダイアログで受ける（ネイティブのダイアログが出たら失敗。PRD D146）
    return { ...s, dlg: await answerConfirms(s.page) };
  },
  steps: [
    ['month-entry', monthEntry],
    ['next-month', nextMonth],
    ['keep-running', keepRunning],
    ['day-confirm', dayConfirm],
    ['links', links],
    ['mobile', mobile],
    ['perf', perf],
    ['empty', empty],
  ],
  after: ({ dlg }) => check(dlg.native.length === 0, 'ブラウザのダイアログを出さない', dlg.native),
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
