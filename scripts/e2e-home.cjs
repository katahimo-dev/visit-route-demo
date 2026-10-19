// ホーム「今日やること」（PRD D141〜D145。ADR-0025）を本物のブラウザで確かめる：
// 起動（#/・知らない URL）でホームへ、ほかの画面の URL（?id= など）はそのまま、カードの並び（要対応 → 今日 → 確定していない日 → 案を作る）、
// 今日のカードで日の画面（選んでいる日付が今日）、「まとめて作る」のカードで月の画面のまとめて作るの欄が開き ?do= が消える、
// 月の画面の ?do=attention・?do=unconfirmed で右の欄、案ができたらホームの今日のカードが「未確定」に、
// いつでもの入口（欠勤・空き状況・探す）、何も無いデータで「今日の準備はできています」、
// メニューの先頭の「ホーム」（1400px）、スマホ（390×844）で縦に並び横にはみ出さない・下のタブの「ホーム」、印刷で出さない。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-home.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { skipTour } = require('./lib/tourSeen.cjs');
const { answerConfirms } = require('./lib/confirmDialog.cjs');
const { launch, BASE, OUT_DIR, NOW, TODAY, STORAGE_KEY, check, hashOf, failShot, run } = require('./lib/env.cjs');

const YM = TODAY.slice(0, 7);

const RANK = { attention: 0, today: 1, confirm: 2, create: 3 };

/**
 * 画面を新しく開く。同じ文書の中で hash を移すと、読み直す前に `?do=` が処理されて消えることがあるので、
 * いったん about:blank に移ってから開く（読み直しはしない）。固定の秒数で待たず、目印と見出しの文が出るのを待つ
 */
async function open(page, hash, ready = '[data-testid="home-tasks"]') {
  await page.goto('about:blank');
  await page.goto(`${BASE}#${hash}`);
  await page.locator(ready).first().waitFor({ timeout: 30000 });
  await page.locator('h1').filter({ hasText: /\S/ }).first().waitFor({ timeout: 30000 });
}
/** 文が出るまで待つ（出なければ時間切れで続け、呼ぶ側の check で落とす） */
async function waitText(locator, text, timeout = 10000) {
  await locator
    .filter({ hasText: text })
    .first()
    .waitFor({ timeout })
    .catch(() => {});
}
/** 次の一手のカード（種類・色・題名） */
async function tasks(page) {
  return page.getByTestId('home-task').evaluateAll((els) =>
    els.map((el) => ({
      kind: el.dataset.kind,
      tone: el.dataset.tone,
      title: el.querySelector('strong').textContent,
    })),
  );
}

async function start(page) {
  await open(page, '/');
  check(hashOf(page) === '#/home', '起動（#/）でホームへ', hashOf(page));
  check((await page.locator('h1').innerText()) === '今日やること', '見出し「今日やること」');
  await open(page, '/nowhere');
  check(hashOf(page) === '#/home', '知らない URL もホームへ', hashOf(page));
  await open(page, '/staff?id=s1', '[data-testid="person-view"]');
  check(hashOf(page).startsWith('#/staff'), 'ほかの画面の URL（?id=）はそのまま（閲覧の欄が開く）', hashOf(page));
  await open(page, '/schedule', '.app-header');
  check(hashOf(page).startsWith('#/plan'), '古い #/schedule は今までどおり日の画面へ', hashOf(page));
}

/** 保存したデータを消して初期データから始める */
async function reset(page) {
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
}

async function firstState(page) {
  // 初期データ：今日から14日の訪問はあるが、案はまだ無い
  await reset(page);
  await open(page, '/home');
  const list = await tasks(page);
  const ranks = list.map((t) => RANK[t.kind]);
  check(
    ranks.every((r, i) => i === 0 || ranks[i - 1] <= r),
    '並び：要対応 → 今日 → 確定していない日 → 案を作る',
    list,
  );
  const today = list.find((t) => t.kind === 'today');
  check(
    !!today && today.tone === 'warn' && /案がまだありません/.test(today.title),
    '今日のカード：案がまだない（warn）',
    today,
  );
  const month = Number(YM.slice(5, 7));
  const create = list.find((t) => t.kind === 'create' && t.title === `${month}月の案をまとめて作る`);
  check(!!create, `「${month}月の案をまとめて作る」のカード`, list);
  check(
    !(await page
      .getByTestId('home-ready')
      .isVisible()
      .catch(() => false)),
    'やることがあるので「準備はできています」は出さない',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'home-first.png'), fullPage: true });

  // 「まとめて作る」→ 月の画面で欄が開き、?do= は消える
  await page
    .getByTestId('home-task')
    .filter({ hasText: `${month}月の案をまとめて作る` })
    .click();
  await page.waitForURL(/#\/month/);
  const panel = page.getByRole('dialog', { name: `${month}月の案をまとめて作る` });
  await panel.waitFor({ timeout: 10000 });
  check(true, 'まとめて作るの欄が開く');
  await page.waitForTimeout(300);
  check(hashOf(page) === `#/month?ym=${YM}`, '月の画面：?ym= の月、?do= は消える', hashOf(page));
  await page.goBack();
  await page.waitForTimeout(500);
  check(hashOf(page) === '#/home', '戻るでホームへ（?do= を残さないので欄を繰り返し開かない）', hashOf(page));

  // 今日のカード → 日の画面（今日）。案ができる（開いた日の自動作成）
  await open(page, '/home');
  await page.getByTestId('home-task').filter({ hasText: '案がまだありません' }).click();
  await page.waitForURL(/#\/plan/);
  await page.getByTestId('confirm-state').waitFor({ timeout: 60000 });
  const picked = await page.locator('.date-switch select').inputValue();
  check(picked === TODAY, '今日のカード：日の画面で今日を選んでいる', picked);
  // 案ができたらホームの今日のカードは「未確定」。確定していない日は案の無い日も含めて数える（月の③と同じ。PR #36 のレビュー）
  await open(page, '/home');
  const list2 = await tasks(page);
  const today2 = list2.find((t) => t.kind === 'today');
  check(!!today2 && /（未確定）/.test(today2.title), '案ができたら今日のカードは「未確定」', today2);
  const todayText = await page.locator('[data-kind="today"] .sub').innerText();
  check(/^訪問 \d+件・担当 \d+人・入らない \d+件/.test(todayText), '今日の要約：訪問・担当・入らない', todayText);
  // 今月のカードだけ見る（月末7日以内は来月のカードも並ぶ。PR #38 のレビュー）
  const MONTH = Number(YM.slice(5, 7));
  const confTitle = `${MONTH}月の確定していない日`;
  const confDays = async () => {
    const t = (await tasks(page)).find((x) => x.kind === 'confirm' && x.title.startsWith(confTitle));
    const m = t && /確定していない日 (\d+)日/.exec(t.title);
    return m ? Number(m[1]) : 0;
  };
  const n2 = await confDays();
  check(n2 >= 1, '確定していない日のカード（案の無い日も含む）', n2);
  const confCard = page.locator('[data-kind="confirm"]').filter({ hasText: confTitle });
  if (n2 >= 2) {
    // カード → 月の画面の右の欄。同じ日数が並び、帯の確定していない日数も同じ
    await confCard.click();
    await page.waitForURL(/#\/month/);
    await page.getByTestId('month-unconfirmed').waitFor({ timeout: 10000 });
    await page.waitForTimeout(300);
    const listed = await page.getByTestId('month-unconfirmed').locator('li').count();
    // 今月の準備の③は進み具合の帯にまとめた（PRD D154）。帯の確定していない日数も同じ
    const band = Number(await page.getByTestId('band-confirm').getAttribute('data-unconfirmed'));
    check(listed === n2 && band === n2, 'ホームの日数＝月の右の欄の日数＝帯の確定していない日数', {
      home: n2,
      listed,
      band,
    });
  } else {
    // 今月の残りが今日だけ（月末）：1日だけなので日の画面のその日へ（D143）。帯の確定していない日数も1日
    await confCard.click();
    await page.waitForURL(/#\/plan/);
    await page.locator('[data-testid="progress-band"][data-ym]').waitFor({ timeout: 30000 });
    const picked = await page.locator('.date-switch select').inputValue();
    const band = Number(await page.getByTestId('band-confirm').getAttribute('data-unconfirmed'));
    check(picked === TODAY && band === 1, '確定していない日が1日だけ：日の画面のその日へ（帯も1日）', { picked, band });
  }
  // 確定すると今日のカードは「確定済み」、確定していない日は1日減る
  await page.goto(`${BASE}#/plan`);
  await page.getByTestId('adopt').click();
  await page.waitForTimeout(400);
  await open(page, '/home');
  const today3 = (await tasks(page)).find((t) => t.kind === 'today');
  check(!!today3 && /（確定済み）/.test(today3.title), '確定したら今日のカードは「確定済み」', today3);
  check((await confDays()) === n2 - 1, '確定したら確定していない日は1日減る', await confDays());
  check(
    (await page.getByTestId('home-anytime').locator('a').count()) === 4,
    'いつでもの入口が4つ（固定の data-testid）',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'home-after.png'), fullPage: true });
}

async function monthDo(page) {
  await open(page, `/month?ym=${YM}&do=attention`, '[data-testid="month-aside"]');
  await waitText(page.locator('.month-aside-title'), '要対応');
  await page
    .waitForFunction(() => document.activeElement?.dataset.testid === 'month-aside', null, { timeout: 5000 })
    .catch(() => {});
  check(
    hashOf(page) === `#/month?ym=${YM}` &&
      (await page.locator('.month-aside-title').first().innerText()).includes('要対応') &&
      (await page.evaluate(() => document.activeElement?.dataset.testid)) === 'month-aside',
    '月の画面 ?do=attention：右の欄の要対応へ（フォーカス）、?do= は消える',
    hashOf(page),
  );
  await open(page, `/month?ym=${YM}&staff=s1&do=unconfirmed`, '[data-testid="month-aside"]');
  await waitText(page.locator('.month-aside-title'), '確定していない日');
  check(
    hashOf(page) === `#/month?ym=${YM}` &&
      (await page.locator('.month-aside-title').first().innerText()).includes('確定していない日'),
    '月の画面 ?do=unconfirmed：全体の表示にして確定していない日へ',
    hashOf(page),
  );
}

async function anytime(page) {
  await open(page, '/home');
  await page.getByTestId('home-absence').click();
  await page.waitForURL(/#\/plan/);
  await page.locator('.date-switch select').waitFor();
  check((await page.locator('.date-switch select').inputValue()) === TODAY, '欠勤・キャンセル → 今日の日の画面');
  await open(page, '/home');
  await page.getByTestId('home-vacancy').click();
  await page.waitForURL(/#\/vacancy/);
  check(true, '問い合わせ → 空き状況');
  await open(page, '/home');
  await page.getByTestId('home-clients').click();
  await page.waitForURL(/#\/clients/);
  await open(page, '/home');
  await page.getByTestId('home-staff').click();
  await page.waitForURL(/#\/staff/);
  check(true, '探す → 〈利用者さん〉・〈スタッフ〉の画面');
}

async function ready(page) {
  // 訪問も定期パターンも無いデータ：やることが無いので「今日の準備はできています」
  await reset(page);
  await open(page, '/home');
  await page.evaluate((key) => {
    const d = JSON.parse(localStorage.getItem(key));
    // 訪問を全部取り消し、定期パターンを消す（訪問を空にすると読み込みのときに初期データの日を足し直すので、取り消しにする）
    d.visits = d.visits.map((v) => ({ ...v, cancelled: true }));
    d.patterns = [];
    d.aiPlans = {};
    d.manualPlans = {};
    d.absences = [];
    localStorage.setItem(key, JSON.stringify(d));
  }, STORAGE_KEY);
  await page.reload();
  await page.getByTestId('home-tasks').waitFor();
  await page.waitForTimeout(300);
  const list = await tasks(page);
  check(
    (await page.getByTestId('home-ready').isVisible()) &&
      list.length === 1 &&
      list[0].kind === 'today' &&
      list[0].tone === 'info',
    '何も無い：「今日の準備はできています」と今日の知らせだけ',
    list,
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'home-ready.png'), fullPage: true });
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
}

async function wide(page) {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await open(page, '/home');
  const first = page.locator('.side-nav .nav-link').first();
  check(
    (await first.innerText()).trim() === 'ホーム' && (await first.getAttribute('aria-current')) === 'page',
    '広い画面：メニューの先頭に「ホーム」（今の画面）',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'home-wide.png'), fullPage: true });
}

async function mobile(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/home');
  check((await page.getByTestId('screen-name').innerText()) === 'ホーム', 'スマホ：上の帯の名前「ホーム」');
  const labels = await page.getByTestId('bottom-tab').allInnerTexts();
  check(
    JSON.stringify(labels) === JSON.stringify(['ホーム', '月', '週', '日', '空き状況']),
    'スマホ：下のタブの先頭に「ホーム」',
    labels,
  );
  const active = await page.locator('.bottom-tab.active[aria-current="page"]').allInnerTexts();
  check(JSON.stringify(active) === '["ホーム"]', 'スマホ：ホームのタブが active', active);
  const boxes = await page
    .locator('.home-task')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
  check(
    boxes.length >= 5 &&
      boxes.every((b) => b.x === boxes[0].x && b.right <= 390) &&
      boxes.every((b, i) => i === 0 || b.y > boxes[i - 1].y),
    'スマホ：カードが縦に1列で並び、画面に収まる',
    boxes.map((b) => [Math.round(b.x), Math.round(b.y), Math.round(b.width)]),
  );
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  check(scrollW <= 390, 'スマホ：横にはみ出さない', scrollW);
  await page.screenshot({ path: path.join(OUT_DIR, 'home-mobile.png'), fullPage: true });
  await page.emulateMedia({ media: 'print' });
  check(!(await page.locator('.home-page').isVisible()), '印刷ではホームを出さない');
  await page.emulateMedia({ media: 'screen' });
}

run(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  // 初回の案内ツアーを見た扱いにする（PRD D193）
  await skipTour(ctx);
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
    ['start', start],
    ['first-state', firstState],
    ['month-do', monthDo],
    ['anytime', anytime],
    ['ready', ready],
    ['wide', wide],
    ['mobile', mobile],
  ]) {
    try {
      await fn(page);
    } catch (e) {
      check(false, name, String(e.message || e));
      await failShot(page, name);
    }
  }
  check(dlg.native.length === 0, 'ブラウザのダイアログを出さない', dlg.native);
  await b.close();
  return errors;
});
