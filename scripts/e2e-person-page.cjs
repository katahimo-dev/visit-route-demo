// 〈利用者さん〉・〈スタッフ〉の画面の予定（PRD D308〜D312。ADR-0052）を本物のブラウザで確かめる：
// 一覧の行から全画面の〈利用者さん〉の画面へ（タブ［予定｜基本情報｜担当・相性｜休み］・先頭は予定）、予定の週のカレンダーで回を押すと
// 訪問の詳細の欄（Esc でフォーカスは回）、繰り返しを押すとその回を強調、月の見せ方（URL の cal・送る・マスの「＋」で新規）、
// 空き枠を縦にドラッグすると所要の長さで新しい訪問の欄（その〈利用者さん〉入り）→ 追加、回をドラッグすると落とした日時で欄が開き
// 範囲（この回だけ／これ以降）を選んで保存、繰り返しを足す・直す（確認）・終わらせる（確認）、休みを入れる・消す（確認）、
// 繰り返し・休みの入力があるまま離れるときの確認、月の予定で〈利用者さん〉を選んだときのリンク、〈スタッフ〉の画面（担当の回・欠勤・
// 勤務の見込み・回から欄）、390px（タブを横に巻き、予定は日ごとのリスト・足す／動かすは出さない・はみ出さない）、印刷でタブ・道具を出さない。
// スクリーンショット（OUT_DIR）：client-schedule・client-month・slot-new・move-scope・staff-schedule（1400px）、narrow-client・narrow-staff（390px）
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-person-page.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { skipTour } = require('./lib/tourSeen.cjs');
const { answerConfirms } = require('./lib/confirmDialog.cjs');
const {
  BASE,
  OUT_DIR,
  NOW,
  TODAY,
  STORAGE_KEY,
  check,
  settle,
  until,
  urlOf,
  hashOf,
  stored,
  runSteps,
  withTimeout,
} = require('./lib/env.cjs');
const { pagePerStep } = require('./lib/steps.cjs');

const shot = (page, name) => page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
const panel = (page) => page.getByTestId('visit-panel');
const cal = (page) => page.getByTestId('pcal');
const visitBtn = (page, id) => page.locator(`[data-testid="pcal-visit"][data-visit="${id}"]`);
const col = (page, date) => page.locator(`[data-testid="pcal-col"][data-date="${date}"]`);
const tab = (page, key) => page.getByTestId('person-tabs').locator(`[data-tab="${key}"]`);
const activeVisit = (page) => page.evaluate(() => document.activeElement?.getAttribute('data-visit') ?? '');
const closed = (page) => panel(page).waitFor({ state: 'detached', timeout: 10000 });
/** 保存（localStorage へ書くのは少し後）を待って読む：ok(d) が真になるまで（最長5秒） */
const dataWhen = async (page, ok) =>
  (await until(async () => {
    const d = await stored(page);
    return ok(d) ? d : null;
  })) ?? (await stored(page));
/** d から n 日後 */
function addDays(d, n) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
/** その日を含む週の月曜 */
const weekStart = (d) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
/** 時間軸の 1分の高さ（px）と始まり（07:00） */
const PX = 0.8;
const DAY_START = 7 * 60;

async function open(page, hash, ready) {
  await page.goto('about:blank');
  await page.goto(`${BASE}#${hash}`);
  await page.locator(ready).first().waitFor({ timeout: 30000 });
  await settle(page, 400);
}

/** c1 の、今日より後の繰り返しの回（今週の中。無ければ来週）と、そのとき開く週の基準の日 */
async function futureSeries(page, clientId = 'c1') {
  const d = await stored(page);
  const end = addDays(weekStart(TODAY), 6);
  const list = d.visits
    .filter((v) => v.clientId === clientId && v.pattern && !v.cancelled && v.date > TODAY)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const v = list.find((x) => x.date <= end) ?? list[0];
  return v ? { v, anchor: v.date } : null;
}

/** 本物のマウス操作でつかんで動かして離す（e2e-drag と同じ。HTML のドラッグは合成のイベントでは動かないことがある） */
async function realDrag(page, src, to, name) {
  await src.scrollIntoViewIfNeeded();
  const sb = await src.boundingBox();
  const sx = sb.x + sb.width / 2;
  const sy = sb.y + 4;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await withTimeout(page.mouse.move(sx + 6, sy + 6, { steps: 3 }), 3000, `${name}：つかみ`);
  await settle(page, 150);
  const { x, y } = await to();
  await withTimeout(page.mouse.move(x, y, { steps: 15 }), 3000, `${name}：移動`);
  await settle(page, 300);
  await withTimeout(page.mouse.up(), 3000, `${name}：離す`);
  await settle(page, 500);
}

/** 一覧から開く・タブ・予定のカレンダーで回を押すと欄 */
async function fromList(page) {
  await open(page, '/clients', '[data-testid="client-row"]');
  await page.getByTestId('client-row').filter({ hasText: '図書館 ふみ' }).first().locator('td').nth(2).click();
  await cal(page).waitFor();
  await settle(page, 400);
  const tabs = await page
    .getByTestId('person-tabs')
    .locator('[data-tab]')
    .evaluateAll((els) => els.map((e) => e.dataset.tab));
  check(
    hashOf(page) === '#/clients/c1' && tabs.join(',') === 'schedule,basic,staffing,leaves',
    '一覧の行から〈利用者さん〉の画面。タブは［予定｜基本情報｜担当・相性｜休み］',
    { h: hashOf(page), tabs },
  );
  check(
    (await tab(page, 'schedule').getAttribute('aria-current')) === 'page' &&
      (await cal(page).getAttribute('data-view')) === 'week' &&
      (await page.getByTestId('pattern-row').count()) > 0,
    '先頭は予定：左に繰り返し、右に週のカレンダー',
  );
  const s = await futureSeries(page);
  check(!!s, 'c1 に今日より後の繰り返しの回がある（初期データ）');
  if (!s) return;
  if (s.anchor > addDays(weekStart(TODAY), 6)) await page.getByTestId('pcal-next').click();
  const b = visitBtn(page, s.v.id);
  await b.waitFor();
  const marks = await cal(page)
    .locator('[data-testid="pcal-visit"]')
    .evaluateAll((els) =>
      els.filter((e) => e.dataset.state === 'assigned').map((e) => !!e.querySelector('[data-staff-mark]')),
    );
  check(marks.length === 0 || marks.every(Boolean), '担当のある回は〈スタッフ〉の印（StaffMark）', marks.length);
  await shot(page, 'client-schedule');
  await b.click();
  await panel(page).waitFor();
  check((await panel(page).getAttribute('data-visit')) === s.v.id, 'カレンダーの回を押すと訪問の詳細の欄（その回）');
  await page.keyboard.press('Escape');
  await closed(page);
  check((await activeVisit(page)) === s.v.id, '閉じるとフォーカスはカレンダーの回');
  // Enter でも開く
  await b.focus();
  await page.keyboard.press('Enter');
  await panel(page).waitFor();
  check((await panel(page).getAttribute('data-visit')) === s.v.id, 'キーボード（Enter）でも開く');
  await page.keyboard.press('Escape');
  await closed(page);
}

/** 繰り返しを押すとその回を強調・月の見せ方 */
async function highlightAndMonth(page) {
  await open(page, '/clients/c1', '[data-testid="pcal"]');
  const pick = page.getByTestId('pattern-pick').first();
  const pid = await page.getByTestId('pattern-row').first().getAttribute('data-pattern');
  await pick.click();
  await settle(page);
  const states = await cal(page)
    .locator('[data-testid="pcal-visit"]')
    .evaluateAll((els) => els.map((e) => ({ p: e.dataset.pattern, cls: e.className })));
  check(
    (await pick.getAttribute('aria-pressed')) === 'true' &&
      states.length > 0 &&
      states.every((x) => (x.p === pid ? x.cls.includes('is-hl') : x.cls.includes('is-dim'))) &&
      (await page.getByTestId('pcal-hl-note').count()) === 1,
    '繰り返しを押すと、その繰り返しの回を強調し（ほかは薄く）、回数を出す',
    states.slice(0, 3),
  );
  await pick.click();
  await settle(page);
  check(
    (await pick.getAttribute('aria-pressed')) === 'false' &&
      (await cal(page).locator('.pcal-item.is-hl, .pcal-item.is-dim').count()) === 0,
    'もう一度押すと強調をやめる',
  );
  // 月
  await page.locator('[data-testid="pcal-view"][data-view="month"]').click();
  await settle(page, 300);
  check(
    (await cal(page).getAttribute('data-view')) === 'month' &&
      urlOf(page).includes('cal=month') &&
      (await page.getByTestId('pcal-cell').count()) >= 28,
    '「月」で月のマス（URL の cal=month）',
    urlOf(page),
  );
  await shot(page, 'client-month');
  const title = await page.getByTestId('pcal-title').innerText();
  await page.getByTestId('pcal-next').click();
  await settle(page);
  check(
    (await page.getByTestId('pcal-title').innerText()) !== title && urlOf(page).includes('d='),
    '月を送ると見出しと URL の d が変わる',
  );
  await page.getByTestId('pcal-prev').click();
  await settle(page);
  // マスの「＋」で新規（この〈利用者さん〉入り）
  const add = page.getByTestId('pcal-cell-add').first();
  const day = await add.evaluate((el) => el.closest('[data-date]').dataset.date);
  await add.click();
  await panel(page).waitFor();
  const p = panel(page);
  check(
    (await p.getAttribute('data-new')) === 'true' &&
      (await p.getByTestId('vp-client').inputValue()) === 'c1' &&
      (await p.getByTestId('vp-date').inputValue()) === day,
    'マスの「＋」で、その日・この〈利用者さん〉の新しい訪問の欄',
    day,
  );
  await page.keyboard.press('Escape');
  await closed(page);
  // 再読込しても月のまま
  await page.reload();
  await cal(page).waitFor();
  check((await cal(page).getAttribute('data-view')) === 'month', '再読込しても月の見せ方のまま（URL）');
}

/** 空き枠を縦にドラッグして新しい訪問 → 追加 */
async function slotNew(page) {
  await open(page, '/clients/c1', '[data-testid="pcal"]');
  const target = addDays(TODAY, 1) <= addDays(weekStart(TODAY), 6) ? addDays(TODAY, 1) : TODAY;
  const c = col(page, target);
  await c.scrollIntoViewIfNeeded();
  const box = await c.boundingBox();
  // 18:00 から 19:30 まで縦にドラッグ（訪問の無い時間）
  const y0 = box.y + (18 * 60 - DAY_START) * PX + 2;
  const y1 = box.y + (19 * 60 + 30 - DAY_START) * PX - 4;
  await page.mouse.move(box.x + box.width / 2, y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, (y0 + y1) / 2, { steps: 4 });
  check((await page.getByTestId('pcal-ghost').count()) === 1, '縦にドラッグしている間は、足す範囲の影');
  await page.mouse.move(box.x + box.width / 2, y1, { steps: 4 });
  await page.mouse.up();
  await panel(page).waitFor();
  const p = panel(page);
  const got = {
    client: await p.getByTestId('vp-client').inputValue(),
    date: await p.getByTestId('vp-date').inputValue(),
    start: await p.getByTestId('vp-start').inputValue(),
    dur: await p.getByTestId('vp-duration').inputValue(),
  };
  check(
    got.client === 'c1' && got.date === target && got.start === '18:00' && got.dur === '90',
    '空き枠を縦にドラッグすると、その日時・所要（ドラッグした長さ）・この〈利用者さん〉の新しい訪問の欄',
    got,
  );
  await shot(page, 'slot-new');
  const n0 = (await stored(page)).visits.length;
  await page.getByTestId('vp-save').click();
  await closed(page);
  const d = await dataWhen(page, (x) => x.visits.length === n0 + 1);
  const made = d.visits.find((v) => v.clientId === 'c1' && v.date === target && v.earliestStart === '18:00');
  check(!!made && made.durationMinutes === 90 && !made.pattern, '「追加」で単発の訪問が足され、カレンダーに出る');
  if (made) check((await visitBtn(page, made.id).count()) === 1, '足した訪問がカレンダーに出る');
  // 押しただけなら既定の所要（60分）。訪問の無い 16:15 を押す（閉じたあとフォーカスが足した回へ移って巻くことがあるので、列の位置は測り直す）
  await settle(page, 300);
  const box2 = await c.boundingBox();
  const y = box2.y + (16 * 60 + 15 - DAY_START) * PX + 2;
  await page.mouse.click(box2.x + 6, y);
  await panel(page).waitFor();
  check(
    (await panel(page).getByTestId('vp-start').inputValue()) === '16:15' &&
      (await panel(page).getByTestId('vp-duration').inputValue()) === '60',
    '空き枠を押しただけなら、押した時刻（15分刻み）・既定の所要 60分',
  );
  await page.keyboard.press('Escape');
  await closed(page);
  // 同じ枠の中で少し動いただけなら押しただけと同じ（既定の所要）
  const y3 = box2.y + (16 * 60 + 15 - DAY_START) * PX + 2;
  await page.mouse.move(box2.x + 6, y3);
  await page.mouse.down();
  await page.mouse.move(box2.x + 6, y3 + 3, { steps: 2 });
  await page.mouse.up();
  await panel(page).waitFor();
  check(
    (await panel(page).getByTestId('vp-start').inputValue()) === '16:15' &&
      (await panel(page).getByTestId('vp-duration').inputValue()) === '60',
    '空き枠を押して同じ枠の中で少し動いただけなら、既定の所要 60分（15分にしない）',
  );
  await page.keyboard.press('Escape');
  await closed(page);
  // 上へドラッグしても押した枠を含む（17:30 の枠を押して 16:15 の枠まで上げる → 16:15〜17:45）
  const yUp0 = box2.y + (17 * 60 + 40 - DAY_START) * PX;
  const yUp1 = box2.y + (16 * 60 + 20 - DAY_START) * PX;
  await page.mouse.move(box2.x + 6, yUp0);
  await page.mouse.down();
  await page.mouse.move(box2.x + 6, yUp1, { steps: 5 });
  await page.mouse.up();
  await panel(page).waitFor();
  check(
    (await panel(page).getByTestId('vp-start').inputValue()) === '16:15' &&
      (await panel(page).getByTestId('vp-duration').inputValue()) === '90',
    '上へドラッグしても押した枠を含む長さ（16:15〜17:45 の 90分）',
    {
      start: await panel(page).getByTestId('vp-start').inputValue(),
      dur: await panel(page).getByTestId('vp-duration').inputValue(),
    },
  );
  await page.keyboard.press('Escape');
  await closed(page);
  // 道具の行の「訪問を足す」（キーボードでも足せる）
  await page.getByTestId('pcal-add').click();
  await panel(page).waitFor();
  check((await panel(page).getByTestId('vp-client').inputValue()) === 'c1', '「訪問を足す」もこの〈利用者さん〉入り');
  await page.keyboard.press('Escape');
  await closed(page);
}

/** 回をドラッグで別の日時へ → 欄で範囲を選んで保存（この回だけ・これ以降） */
async function dragMove(page) {
  await open(page, '/clients/c1', '[data-testid="pcal"]');
  const s = await futureSeries(page);
  if (!s) return check(false, 'ドラッグする繰り返しの回が無い');
  if (s.anchor > addDays(weekStart(TODAY), 6)) await page.getByTestId('pcal-next').click();
  const { v } = s;
  // 同じ週の、今日以降で別の日（無ければ同じ日）の 13:00 へ
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart(v.date), i)).filter((d) => d >= TODAY);
  const dest = days.find((d) => d !== v.date) ?? v.date;
  const at = 13 * 60;
  await realDrag(
    page,
    visitBtn(page, v.id),
    async () => {
      const b = await col(page, dest).boundingBox();
      return { x: b.x + b.width / 2, y: b.y + (at - DAY_START) * PX + 4 };
    },
    'move-once',
  );
  await panel(page).waitFor({ timeout: 5000 });
  const p = panel(page);
  check(
    (await p.getAttribute('data-visit')) === v.id &&
      (await p.getByTestId('vp-date').inputValue()) === dest &&
      (await p.getByTestId('vp-start').inputValue()) === '13:00' &&
      (await p.getByTestId('vp-scope').count()) === 1,
    '回をドラッグすると、落とした日時で欄が開き、範囲（この回だけ／これ以降／すべて）を選べる',
    { date: await p.getByTestId('vp-date').inputValue(), start: await p.getByTestId('vp-start').inputValue() },
  );
  await shot(page, 'move-scope');
  await p.getByTestId('vp-scope-once').check();
  await page.getByTestId('vp-save').click();
  await closed(page);
  let d = await dataWhen(page, (x) => x.visits.find((y) => y.id === v.id)?.earliestStart === '13:00');
  const moved = d.visits.find((y) => y.id === v.id);
  const next = d.visits.find(
    (y) => y.pattern?.id === v.pattern.id && y.date === addDays(v.date, 7) && !y.pattern.edited,
  );
  check(
    moved.date === dest && moved.earliestStart === '13:00' && moved.pattern?.edited === true,
    'この回だけ：この回だけ日時が変わる（この回だけ変えた印）',
    moved,
  );
  check(!next || next.earliestStart === v.earliestStart, 'この回だけ：次の週の回はそのまま');
  // 担当を選ばずに動かし、動かした回に担当が無ければ「空き時間に入れる」の知らせ（週の予定と同じ）
  if (!moved.staffId) {
    await page
      .getByTestId('pcal-notice')
      .waitFor({ timeout: 5000 })
      .catch(() => {});
    check(
      (await page.getByTestId('pcal-notice').count()) === 1 && (await page.getByTestId('pcal-insert').count()) === 1,
      '担当を選ばずに動かすと「〈日〉の案に空き時間で入れる」の知らせ',
    );
    await page.getByTestId('pcal-insert').click();
    await settle(page, 600);
    check(
      (await page.getByTestId('pcal-notice').count()) === 0 ||
        (await page.getByTestId('pcal-notice').locator('.warn-text').count()) === 1,
      '「空き時間に入れる」で入れる（入らなければ理由）',
    );
  }
  // これ以降：別の回（同じ繰り返し）をつかんで 14:00 へ（同じ日）
  const s2 = (await stored(page)).visits.find(
    (y) =>
      y.pattern?.id === v.pattern.id && !y.pattern.edited && !y.cancelled && y.date > TODAY && y.date <= days.at(-1),
  );
  if (!s2) return check(true, 'これ以降：この週に別の回が無いので確かめない');
  await realDrag(
    page,
    visitBtn(page, s2.id),
    async () => {
      const b = await col(page, s2.date).boundingBox();
      return { x: b.x + b.width / 2, y: b.y + (14 * 60 - DAY_START) * PX + 4 };
    },
    'move-following',
  );
  await panel(page).waitFor({ timeout: 5000 });
  await panel(page).getByTestId('vp-scope-following').check();
  await page.getByTestId('vp-save').click();
  await closed(page);
  const wd = new Date(`${s2.date}T00:00:00Z`).getUTCDay();
  d = await dataWhen(page, (x) =>
    x.visits.some((y) => y.date === s2.date && y.clientId === 'c1' && y.earliestStart === '14:00'),
  );
  const later = d.visits.filter(
    (y) =>
      y.clientId === 'c1' &&
      !y.cancelled &&
      y.date >= s2.date &&
      new Date(`${y.date}T00:00:00Z`).getUTCDay() === wd &&
      y.pattern &&
      !y.pattern.edited,
  );
  const other = d.visits.find(
    (y) =>
      y.pattern?.id === v.pattern.id &&
      !y.pattern.edited &&
      !y.cancelled &&
      new Date(`${y.date}T00:00:00Z`).getUTCDay() !== wd,
  );
  check(
    later.length > 0 && later.every((y) => y.earliestStart === '14:00'),
    'これ以降：その日以降の同じ曜日の回が 14:00 になる',
    later.map((y) => `${y.date} ${y.earliestStart}`),
  );
  check(!other || other.earliestStart === v.earliestStart, 'これ以降：ほかの曜日の回は変えない');
}

/** 繰り返しを足す・直す・終わらせる（保存を押すまで変えない・確認） */
async function patterns(page, dlg) {
  await open(page, '/clients/c1', '[data-testid="pcal"]');
  const p0 = (await stored(page)).patterns.filter((p) => p.clientId === 'c1').length;
  await page.getByTestId('pattern-add').click();
  const form = page.getByTestId('pattern-form');
  await form.waitFor();
  await form.getByTestId('pattern-weekdays').getByRole('button', { name: '木' }).click();
  await form.getByLabel('開始', { exact: true }).fill('17:00');
  // 入力があるまま離れようとすると確かめる（断れば留まる）
  dlg.answer = false;
  dlg.messages.length = 0;
  await page
    .locator('.side-nav')
    .getByRole('link', { name: /スタッフ一覧/ })
    .click();
  await settle(page);
  check(
    dlg.messages.length === 1 && hashOf(page).startsWith('#/clients/c1') && (await form.count()) === 1,
    '繰り返しの入力があるまま離れようとすると確認が出て、断れば留まる',
    dlg.messages,
  );
  check(
    (await stored(page)).patterns.filter((p) => p.clientId === 'c1').length === p0,
    '保存を押すまで繰り返しは変えない',
  );
  // 入力があるまま、訪問の詳細の欄の「日の予定で見る」でも確かめる（断れば移らない）
  await cal(page).locator('[data-testid="pcal-visit"]').first().click();
  await panel(page).waitFor();
  dlg.messages.length = 0;
  await page.getByTestId('vp-open-day').click();
  await settle(page);
  check(
    dlg.messages.length === 1 && hashOf(page).startsWith('#/clients/c1') && (await form.count()) === 1,
    '入力があるまま欄の「日の予定で見る」を押すと確認が出て、断れば移らない',
    dlg.messages,
  );
  if ((await panel(page).count()) === 1) {
    await page.keyboard.press('Escape');
    await closed(page);
  }
  dlg.answer = true;
  await form.getByTestId('pattern-save').click();
  await settle(page, 500);
  let d = await dataWhen(page, (x) => x.patterns.filter((p) => p.clientId === 'c1').length === p0 + 1);
  const added = d.patterns.find((p) => p.clientId === 'c1' && p.earliestStart === '17:00');
  check(!!added && added.weekdays.join() === '4', '「繰り返しを足す」→ 保存で繰り返しが増える', added);
  // 版2：繰り返しの回は保存せず、見るときに計算する（ADR-0053）。カレンダーに足した繰り返しの回が出る
  await page
    .locator(`[data-testid="pcal-visit"][data-visit$="_${added?.id}"]`)
    .first()
    .waitFor({ timeout: 5000 })
    .catch(() => {});
  check(
    (await page.locator(`[data-testid="pcal-visit"][data-visit$="_${added?.id}"]`).count()) > 0 &&
      !d.visits.some((v) => v.pattern?.id === added?.id),
    '足した繰り返しの回がカレンダーに出る（回は保存しない）',
  );
  // 直す：時刻を変えて保存 → 確認→ 受ける
  const row = page.locator(`[data-testid="pattern-row"][data-pattern="${added.id}"]`);
  await row.getByTestId('pattern-edit').click();
  await form.getByLabel('開始', { exact: true }).fill('17:30');
  dlg.messages.length = 0;
  await form.getByTestId('pattern-save').click();
  await settle(page, 500);
  d = await dataWhen(page, (x) => x.patterns.some((p) => p.clientId === 'c1' && p.earliestStart === '17:30'));
  check(
    dlg.messages.length === 1 &&
      /から変えますか/.test(dlg.messages[0]) &&
      d.patterns.some((p) => p.clientId === 'c1' && p.earliestStart === '17:30'),
    '「直す」→ 保存で確認が出て、受けると繰り返しが変わる（回は新しい繰り返しのとおり）',
    dlg.messages,
  );
  // 終わらせる：最後の日を今日にして保存 → 確認 → 今日より後の回が消える
  const cur = d.patterns.find((p) => p.clientId === 'c1' && p.earliestStart === '17:30');
  const r2 = page.locator(`[data-testid="pattern-row"][data-pattern="${cur.id}"]`);
  await r2.getByTestId('pattern-end').click();
  await page.getByTestId('pattern-end-last').fill(TODAY);
  dlg.messages.length = 0;
  await page.getByTestId('pattern-end-save').click();
  await settle(page, 500);
  d = await dataWhen(page, (x) => x.patterns.find((p) => p.id === cur.id)?.to === TODAY);
  check(
    dlg.messages.length === 1 &&
      /終わらせますか/.test(dlg.messages[0]) &&
      d.patterns.find((p) => p.id === cur.id)?.to === TODAY &&
      !d.visits.some((v) => v.pattern?.id === cur.id && v.date > TODAY),
    '「終わらせる」→ 保存で確認が出て、受けると終了日を入れ、その後の回を消す',
    dlg.messages,
  );
  // 先の日から始まる繰り返しの「終わらせる」：最後の日の既定は開始日で、消し方を案内する
  const future = addDays(TODAY, 10);
  await page.getByTestId('pattern-add').click();
  await form.getByTestId('pattern-weekdays').getByRole('button', { name: '金' }).click();
  await form.getByLabel('開始日', { exact: true }).fill(future);
  await form.getByTestId('pattern-save').click();
  d = await dataWhen(page, (x) => x.patterns.some((p) => p.clientId === 'c1' && p.from === future));
  const fut = d.patterns.find((p) => p.clientId === 'c1' && p.from === future);
  await page.locator(`[data-testid="pattern-row"][data-pattern="${fut.id}"]`).getByTestId('pattern-end').click();
  check(
    (await page.getByTestId('pattern-end-last').inputValue()) === future &&
      (await page.getByTestId('pattern-end-before').count()) === 1,
    '先の日から始まる繰り返しの「終わらせる」は、最後の日の既定が開始日で、消し方を案内する',
  );
  // 開いただけなら変更なし（離れるときに確かめない）
  dlg.messages.length = 0;
  await tab(page, 'basic').click();
  await settle(page);
  check(
    dlg.messages.length === 0 && urlOf(page).includes('tab=basic'),
    '「終わらせる」を開いただけなら確かめずにタブを替える',
  );
  await tab(page, 'schedule').click();
  await settle(page);
  // 直す → この繰り返しを消す（確認）
  await r2.getByTestId('pattern-edit').click();
  dlg.messages.length = 0;
  await page.getByTestId('pattern-remove').click();
  await settle(page, 500);
  d = await dataWhen(page, (x) => !x.patterns.some((p) => p.id === cur.id));
  check(
    dlg.messages.length === 1 && !d.patterns.some((p) => p.id === cur.id),
    '直す欄の「この繰り返しを消す」は確認のうえ消す',
  );
}

/** 休み：入れる・消す（保存・確認）、入力があるままタブを替えると確認 */
async function leaves(page, dlg) {
  await open(page, '/clients/c1?tab=leaves', '[data-testid="leaves-section"]');
  const n0 = (await stored(page)).clientLeaves.filter((l) => l.clientId === 'c1').length;
  await page.getByTestId('leave-add').click();
  const from = addDays(TODAY, 20);
  await page.getByTestId('leave-from').fill(from);
  await page.getByTestId('leave-to').fill(addDays(TODAY, 22));
  await page.getByTestId('leave-note').fill('ショートステイ');
  dlg.answer = false;
  dlg.messages.length = 0;
  await tab(page, 'schedule').click();
  await settle(page);
  check(
    dlg.messages.length === 1 && /タブを替えますか/.test(dlg.messages[0]) && urlOf(page).includes('tab=leaves'),
    '休みの入力があるままタブを替えると確認が出て、断れば留まる',
    dlg.messages,
  );
  dlg.answer = true;
  await page.getByTestId('leave-save').click();
  let d = await dataWhen(page, (x) => x.clientLeaves.filter((l) => l.clientId === 'c1').length === n0 + 1);
  const l = d.clientLeaves.find((x) => x.clientId === 'c1' && x.from === from);
  check(!!l && l.note === 'ショートステイ', '「休みを入れる」→ 保存で休みが入る');
  // 予定のタブのカレンダーの日に「休み」
  await open(page, `/clients/c1?d=${from}`, '[data-testid="pcal"]');
  check(
    (await page.locator(`.pcal-week-head[data-date="${from}"]`).textContent()).includes('休み'),
    '予定のカレンダーの日の見出しに「休み」',
  );
  await open(page, '/clients/c1?tab=leaves', '[data-testid="leaves-section"]');
  await page.getByTestId('leave-row').filter({ hasText: 'ショートステイ' }).last().getByTestId('leave-edit').click();
  dlg.messages.length = 0;
  await page.getByTestId('leave-remove').click();
  d = await dataWhen(page, (x) => !x.clientLeaves.some((y) => y.id === l.id));
  check(
    dlg.messages.length === 1 && !d.clientLeaves.some((y) => y.id === l.id),
    '直す欄の「この休みを消す」は確認のうえ消す',
    dlg.messages,
  );
}

/** 月の予定で〈利用者さん〉を選んだときは、その人の画面（月）へのリンク */
async function monthLink(page) {
  const ym = TODAY.slice(0, 7);
  await open(page, `/month?ym=${ym}&client=c1`, '[data-testid="month-client-open"]');
  check(
    (await page.getByTestId('month-aside').locator('[data-testid="month-client-sum"]').count()) === 0,
    '月の右の欄に〈利用者さん〉の集計・休みを重ねて出さない',
  );
  await page.getByTestId('month-client-open').click();
  await cal(page).waitFor();
  check(
    hashOf(page).startsWith('#/clients/c1') && (await cal(page).getAttribute('data-view')) === 'month',
    '月の予定の右の欄のリンクで、その人の画面の予定（月）',
    hashOf(page),
  );
}

/** 〈スタッフ〉の画面：担当の回・欠勤・勤務の見込み・回から欄・足す／動かすは出さない */
async function staffPage(page) {
  // s1 に明日の希望休を入れておく（別のタブで書く）
  await open(page, '/staff', '[data-testid="staff-row"]');
  const off = addDays(TODAY, 1);
  const other = await page.context().newPage();
  await other.goto(`${BASE}#/data`);
  await other.evaluate(
    ([k, date]) => {
      const d = JSON.parse(localStorage.getItem(k));
      d.absences = [
        ...d.absences.filter((a) => a.staffId !== 's1'),
        { id: 'a-e2e', staffId: 's1', date, from: null, to: null, note: '希望休' },
      ];
      localStorage.setItem(k, JSON.stringify(d));
    },
    [STORAGE_KEY, off],
  );
  await other.close();
  await settle(page, 300);
  await page.getByTestId('staff-row').filter({ hasText: '市役所 まち子' }).first().locator('td').nth(2).click();
  await cal(page).waitFor();
  await settle(page, 400);
  const tabs = await page
    .getByTestId('person-tabs')
    .locator('[data-tab]')
    .evaluateAll((els) => els.map((e) => e.dataset.tab));
  check(
    hashOf(page) === '#/staff/s1' && tabs.join(',') === 'schedule,basic,hours,compat',
    '〈スタッフ〉の画面のタブは［予定｜基本情報｜勤務時間｜相性］',
    tabs,
  );
  check(
    (await page.getByTestId('staff-work').count()) === 1 &&
      (await page.getByTestId('staff-absences').textContent()).includes('希望休'),
    '〈スタッフ〉の予定：勤務の見込みの要約と、欠勤・希望休',
  );
  if (off <= addDays(weekStart(TODAY), 6))
    check(
      (await page.locator(`.pcal-week-head[data-date="${off}"]`).textContent()).includes('希望休'),
      '〈スタッフ〉のカレンダーの日の見出しに「希望休」',
    );
  check(
    (await page.getByTestId('pcal-add').count()) === 0 && (await cal(page).locator('[draggable="true"]').count()) === 0,
    '〈スタッフ〉のカレンダーでは足す・動かすを出さない',
  );
  const items = cal(page).locator('[data-testid="pcal-visit"]');
  check((await items.count()) > 0, '〈スタッフ〉の担当の回がカレンダーに出る', await items.count());
  await shot(page, 'staff-schedule');
  const first = items.first();
  const id = await first.getAttribute('data-visit');
  const d = await stored(page);
  const date = await first.getAttribute('data-date');
  // 版2：担当は訪問に持つ（保存した回は staffId、計算した回は繰り返しの担当）
  const own = d.visits.find((x) => x.id === id);
  const pat = d.patterns.find((p) => id === `${date}_${p.id}`);
  check(own ? own.staffId === 's1' : pat?.usualStaffId === 's1', '出す回はその日にこの人が担当の回', {
    id,
    own: own?.staffId,
    pat: pat?.usualStaffId,
  });
  await first.click();
  await panel(page).waitFor();
  check((await panel(page).getAttribute('data-visit')) === id, '〈スタッフ〉のカレンダーの回を押すと訪問の詳細の欄');
  await page.keyboard.press('Escape');
  await closed(page);
}

/** 390px：タブを横に巻く・予定は日ごとのリスト（足す・動かすなし）・はみ出さない */
async function narrow(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/clients/c1', '[data-testid="pcal"]');
  const over = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(
    (await cal(page).getAttribute('data-layout')) === 'list' &&
      (await page.getByTestId('pcal-add').count()) === 0 &&
      (await page.getByTestId('pattern-add').count()) === 0 &&
      (await cal(page).locator('[draggable="true"]').count()) === 0,
    '390px：予定は日ごとのリストで、足す・動かす・繰り返しを足すは出さない',
  );
  check((await over()) <= 0, '390px：〈利用者さん〉の画面は横にはみ出さない', await over());
  const tabsBox = await page.getByTestId('person-tabs').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  check(tabsBox.cw <= 390, '390px：タブは画面の中（入りきらなければ横に巻く）', tabsBox);
  await shot(page, 'narrow-client');
  const item = cal(page).locator('[data-testid="pcal-visit"]').first();
  if ((await item.count()) > 0) {
    await item.click();
    await panel(page).waitFor();
    check(
      (await panel(page).getByTestId('vp-time').count()) === 0 &&
        (await panel(page).getByTestId('vp-cancel-area').count()) === 1,
      '390px：回を押すと欄（日時の変更は出さず、取り消しはできる）',
    );
    await page.keyboard.press('Escape');
    await closed(page);
  }
  await page.getByTestId('person-tabs').locator('[data-tab="leaves"]').click();
  await settle(page);
  check(urlOf(page).includes('tab=leaves'), '390px：巻いた先のタブも押せる');
  await open(page, '/staff/s1', '[data-testid="pcal"]');
  check(
    (await cal(page).getAttribute('data-layout')) === 'list' && (await over()) <= 0,
    '390px：〈スタッフ〉の画面も日ごとのリストで、はみ出さない',
  );
  await shot(page, 'narrow-staff');
  await page.setViewportSize({ width: 1400, height: 1000 });
}

/** 印刷：タブ・カレンダーの道具のボタン・繰り返しの操作を出さない（期間の見出しは出す） */
async function print(page) {
  await open(page, '/clients/c1', '[data-testid="pcal"]');
  await page.emulateMedia({ media: 'print' });
  const shown = async (sel) => page.locator(sel).evaluateAll((els) => els.filter((e) => e.checkVisibility()).length);
  check(
    (await shown('[data-testid="person-tabs"]')) === 0 &&
      (await shown('.pcal-tools button, .pcal-tools fieldset')) === 0 &&
      (await shown('.pattern-row .actions, [data-testid="pattern-add"]')) === 0,
    '印刷：タブ・カレンダーの道具のボタン・繰り返しの「直す」「終わらせる」「足す」を出さない',
  );
  check(
    (await shown('[data-testid="pcal"]')) === 1 && (await page.getByTestId('pcal-title').isVisible()),
    '印刷：カレンダーと期間の見出しは出す',
  );
  await page.emulateMedia({ media: 'screen' });
}

const errors = [];
const steps = pagePerStep({
  open: async (browser) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    await skipTour(ctx);
    // 地図のタイルは外へ取りに行かない
    await ctx.route(/cyberjapandata\.gsi\.go\.jp/, (r) => r.fulfill({ status: 204, body: '' }));
    const page = await ctx.newPage();
    await page.clock.setFixedTime(NOW);
    page.on('pageerror', (e) => errors.push(String(e)));
    return { ctx, page, dlg: await answerConfirms(page) };
  },
  call: (fn, s) => fn(s.page, s.dlg),
  steps: [fromList, highlightAndMonth, slotNew, dragMove, patterns, leaves, monthLink, staffPage, narrow, print],
  label: (name) => `${name}：途中で止まった`,
  after: (name, { dlg }) => check(dlg.native.length === 0, `${name}：ブラウザのダイアログを出さない`, dlg.native),
  end: () => check(errors.length === 0, 'ページのエラーが無い', errors),
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
