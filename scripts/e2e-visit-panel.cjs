// 訪問の詳細の欄（VisitPanel。PRD D301〜D304。ADR-0051）を本物のブラウザで確かめる：
// 日の予定の時間軸の帯から開く（詳細の「詳細・変更」）・Esc で閉じてフォーカスは帯、日時と担当を同時に変えて保存（この回だけ。
// 担当は今の案で固定・フォーカスは開いた帯・トーストの「元に戻す」で戻る）、繰り返しの回の範囲（この回だけ／これ以降／すべて）、
// 取り消しと取り消しをやめる（当日キャンセル）、週の予定の帯・月の予定で〈利用者さん〉を選んだときのリンクの先の回・日の予定の一覧の行から開いても
// 同じ欄、新しい訪問（日の予定の「その他 ▾」・ホームのいつでも・コマンドパレットの操作）、ホームの今日の訪問から開く、
// コマンドパレットで「名前 日付」から開く（画面は移らない）、390px（見る・取り消す・担当替えができ、日時の変更・追加は出さない・
// 横にはみ出さない）、印刷で出さない。
// スクリーンショット（OUT_DIR）：plan-band・scope・week・new（1400px）、narrow（390px）。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-visit-panel.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { answerConfirms } = require('./lib/confirmDialog.cjs');
const { BASE, OUT_DIR, TODAY, STORAGE_KEY, check, hashOf, runSteps, settle, until } = require('./lib/env.cjs');
const { sharedPage, openPage } = require('./lib/steps.cjs');

const shot = (page, name) => page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
const panel = (page) => page.getByTestId('visit-panel');
const data = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORAGE_KEY);
/**
 * 版2：その日の訪問（保存した訪問と、保存した回の無い繰り返しの計算した回。ADR-0053）。
 * 初期データの繰り返しは毎週なので、毎週の繰り返しだけを計算する（隔週・毎月は見ない簡易版）
 */
function visitsOnDate(d, date) {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  const own = d.visits.filter((v) => v.date === date);
  const ids = new Set(own.map((v) => v.id));
  const active = new Set(d.clients.filter((c) => c.active).map((c) => c.id));
  const calc = d.patterns
    .filter(
      (p) =>
        active.has(p.clientId) &&
        p.weekdays.includes(wd) &&
        p.from <= date &&
        (!p.to || p.to >= date) &&
        (p.repeat ?? 'weekly') === 'weekly' &&
        p.everyWeeks === 1 &&
        !ids.has(`${date}_${p.id}`),
    )
    .map((p) => {
      const t = (p.dayTimes ?? []).find((x) => x.weekday === wd);
      return {
        id: `${date}_${p.id}`,
        date,
        clientId: p.clientId,
        earliestStart: t?.earliestStart ?? p.earliestStart,
        latestStart: t?.latestStart ?? p.latestStart,
        staffId: p.usualStaffId,
        pinned: false,
        cancelled: false,
        pattern: { id: p.id, date, edited: false },
      };
    });
  return [...own, ...calc];
}
/** ID の訪問（保存した回か計算した回） */
const findIn = (d, id) =>
  d.visits.find((v) => v.id === id) ?? visitsOnDate(d, id.slice(0, 10)).find((v) => v.id === id);
const visitOf = async (page, id) => findIn(await data(page), id);
/** 保存（localStorage へ書くのは少し後）を待って読む：ok(d) が真になるまで（最長5秒） */
const dataWhen = async (page, ok) =>
  (await until(async () => {
    const d = await data(page);
    return ok(d) ? d : null;
  })) ?? (await data(page));
/** d から n 日後 */
function addDays(d, n) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

async function open(page, hash, ready) {
  await page.goto('about:blank');
  await page.goto(`${BASE}#${hash}`);
  await page.locator(ready).first().waitFor({ timeout: 60000 });
  await settle(page, 400);
}
/** 初期データに戻して、今日の日の予定（今の案が出て計算が終わるまで） */
async function freshPlan(page, date = TODAY) {
  await page.goto(`${BASE}#/home`);
  await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
  await page.goto(`${BASE}#/plan?date=${date}`);
  await page.reload();
  await page.getByTestId('confirm-state').waitFor({ state: 'attached', timeout: 60000 });
  await page
    .getByTestId('plan-progress')
    .waitFor({ state: 'detached', timeout: 60000 })
    .catch(() => {});
  await settle(page, 400);
}
/** 欄が閉じるまで */
const closed = (page) => panel(page).waitFor({ state: 'detached', timeout: 10000 });

/** 時間軸の帯を押して詳細の「詳細・変更」で欄を開く。開いた帯の訪問 ID */
async function openFromBand(page, vid) {
  const band = vid
    ? page.locator(`.tl-band[data-visit="${vid}"] .tl-band-btn`)
    : page.locator('.tl-band[data-visit] .tl-band-btn').first();
  const id = vid ?? (await band.evaluate((el) => el.closest('.tl-band').dataset.visit));
  await band.scrollIntoViewIfNeeded();
  await band.click();
  await page.getByTestId('visit-open').first().click();
  await panel(page).waitFor();
  await settle(page, 300);
  return id;
}

async function bandOpen(page) {
  await freshPlan(page);
  const id = await openFromBand(page);
  const p = panel(page);
  check((await p.getAttribute('data-visit')) === id, '時間軸の帯の「詳細・変更」で、その訪問の欄が開く', id);
  const when = await p.getByTestId('vp-when').innerText();
  check(/\d+\/\d+（.）\s\d{2}:\d{2}/.test(when), '欄に日付・時刻', when);
  check(
    (await p.getByTestId('vp-staff-now').innerText()).trim() !== '' &&
      (await p.getByTestId('vp-client-name').count()) === 1,
    '欄に〈利用者さん〉の名前（押せる）と担当',
  );
  check(
    (await p.getByTestId('vp-time').count()) === 1 &&
      (await p.getByTestId('vp-staff').count()) === 1 &&
      (await p.getByTestId('vp-cancel').count()) === 1,
    '日時を変える・担当を替える・取り消すが同じ欄にある',
  );
  check((await page.locator('.drawer .btn-primary').count()) === 1, '主ボタンは欄に1つ（保存）');
  check(
    (await p.getByTestId('vp-open-day').count()) === 0,
    '今見ている日の予定から開いたら「日の予定で見る」を出さない',
  );
  await shot(page, 'plan-band');
  // Tab は欄の中で回る
  for (let i = 0; i < 40; i++) await page.keyboard.press('Tab');
  check(
    await page.evaluate(() => !!document.activeElement?.closest('.drawer')),
    'Tab を押し続けてもフォーカスは欄の中',
  );
  await page.keyboard.press('Escape');
  await closed(page);
  const back = await page.evaluate(() => document.activeElement?.closest('.tl-band')?.dataset.visit ?? '');
  check(back === id, 'Esc で閉じるとフォーカスは開いた帯', back);
}

async function timeAndStaff(page) {
  await freshPlan(page);
  const id = await openFromBand(page);
  const before = await visitOf(page, id);
  const p = panel(page);
  const start = toMin(before.earliestStart) + 30;
  await p.getByTestId('vp-start').fill(hhmm(start));
  if ((await p.getByTestId('vp-scope').count()) === 1) await p.getByTestId('vp-scope-once').check();
  // 日時を変えると、その日時で候補を出し直す（説明に時間の約束）
  await settle(page, 400);
  const choice = p.locator('[data-testid="vp-staff-choice"]:not(.is-off)').first();
  await choice.waitFor();
  const desc = await choice.innerText();
  check(/時間の約束/.test(desc), '担当の候補に時間の約束 ✓✗ などの判定', desc);
  const sid = await choice.getAttribute('data-staff');
  await choice.locator('input').check();
  await page.getByTestId('vp-save').click();
  await closed(page);
  const d = await dataWhen(page, (x) => x.visits.find((v) => v.id === id)?.earliestStart === hhmm(start));
  const after = d.visits.find((v) => v.id === id);
  check(after.earliestStart === hhmm(start), '保存で時刻が変わる', after.earliestStart);
  check(after.staffId === sid && after.pinned, '担当は訪問に書いてピン（版2）', { sid, after });
  const back = await page.evaluate(
    () => document.activeElement?.closest('.tl-band, .route-item')?.dataset.visit ?? document.activeElement?.tagName,
  );
  check(back === id, '保存のあとフォーカスは開いた帯', back);
  // トーストの「元に戻す」
  await page.getByTestId('toast-undo').click();
  const undone =
    (await dataWhen(page, (x) => findIn(x, id)?.earliestStart === before.earliestStart)).visits.find(
      (v) => v.id === id,
    ) ?? (await visitOf(page, id));
  check(undone.earliestStart === before.earliestStart, 'トーストの「元に戻す」で時刻が戻る', undone.earliestStart);
}

/** 今日より後の、繰り返しの回（同じ繰り返しの同じ曜日の回が次の週にもあるもの）。初期データで組んだ7日より後から探す */
async function seriesVisit(page) {
  const d = await data(page);
  for (let i = 8; i <= 21; i++) {
    const date = addDays(TODAY, i);
    for (const v of visitsOnDate(d, date)) {
      if (!v.pattern || v.cancelled || v.pattern.edited) continue;
      const next = addDays(date, 7);
      const later = visitsOnDate(d, next).filter((x) => x.pattern?.id === v.pattern.id);
      if (later.length >= 1) return { v, later };
    }
  }
  return null;
}

async function scopes(page) {
  await freshPlan(page);
  const s = await seriesVisit(page);
  check(!!s, '繰り返しの回がある（初期データ）');
  if (!s) return;
  const { v } = s;
  const go = async (scope, minutes) => {
    await open(page, `/plan?date=${v.date}`, '[data-testid="confirm-state"]');
    await page.getByRole('button', { name: '一覧', exact: true }).click();
    await page.locator(`[data-testid="visit-row-open"][data-visit="${v.id}"]`).click();
    await panel(page).waitFor();
    const p = panel(page);
    check((await p.getByTestId('vp-pattern').innerText()).includes('の回'), `${scope}：繰り返しの回の文`);
    await p.getByTestId('vp-start').fill(hhmm(minutes));
    await p.getByTestId(`vp-scope-${scope}`).check();
    if (scope === 'following') await shot(page, 'scope');
    await page.getByTestId('vp-save').click();
    await closed(page);
    await settle(page, 400);
  };
  const base = toMin(v.earliestStart);
  // この回だけ：ほかの回は変えない
  await go('once', base + 15);
  let d = await dataWhen(page, (x) => findIn(x, v.id)?.earliestStart === hhmm(base + 15));
  const same = (x) => x.pattern?.id === v.pattern.id;
  const nextWeek = addDays(v.date, 7);
  check(
    findIn(d, v.id).earliestStart === hhmm(base + 15) &&
      visitsOnDate(d, nextWeek).find((x) => same(x)).earliestStart === v.earliestStart,
    'この回だけ：この回だけ変わり、次の週の回はそのまま',
  );
  // これ以降：次の週の回も変わり、前の回は変わらない
  await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
  await go('following', base + 30);
  d = await dataWhen(page, (x) =>
    visitsOnDate(x, v.date).some((y) => y.clientId === v.clientId && y.earliestStart === hhmm(base + 30)),
  );
  const at = (date) => visitsOnDate(d, date).find((x) => x.clientId === v.clientId && !x.cancelled && x.pattern);
  const prevDate = addDays(v.date, -7);
  const prev = prevDate >= TODAY ? at(prevDate) : null;
  check(
    at(v.date)?.earliestStart === hhmm(base + 30) &&
      at(nextWeek)?.earliestStart === hhmm(base + 30) &&
      (!prev || prev.earliestStart === v.earliestStart),
    'これ以降：この回と後の回が変わり、前の回はそのまま',
    { at: at(v.date)?.earliestStart, next: at(nextWeek)?.earliestStart, prev: prev?.earliestStart },
  );
  // すべて：今日以降の同じ曜日の回がすべて変わる
  await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
  await go('all', base + 45);
  d = await dataWhen(page, (x) =>
    visitsOnDate(x, v.date).some((y) => y.clientId === v.clientId && y.earliestStart === hhmm(base + 45)),
  );
  // 今日以降の同じ曜日の日（今日から4週）の、その〈利用者さん〉の繰り返しの回
  const wd = new Date(`${v.date}T00:00:00Z`).getUTCDay();
  const sameDays = Array.from({ length: 28 }, (_, i) => addDays(TODAY, i)).filter(
    (x) => new Date(`${x}T00:00:00Z`).getUTCDay() === wd,
  );
  const series = sameDays
    .flatMap((x) => visitsOnDate(d, x))
    .filter(
      (x) => x.clientId === v.clientId && x.pattern && !x.cancelled && Math.abs(toMin(x.earliestStart) - base) <= 45,
    );
  check(
    series.length >= 2 && series.every((x) => x.earliestStart === hhmm(base + 45)),
    'すべて：今日以降の同じ曜日の回がすべて変わる',
    series.map((x) => `${x.date} ${x.earliestStart}`),
  );
}

async function cancelAndBack(page) {
  await freshPlan(page);
  const id = await openFromBand(page);
  const p = panel(page);
  await p.getByTestId('vp-cancel-sameday').click();
  await p.getByTestId('vp-cancelled').waitFor();
  let v = (await dataWhen(page, (x) => x.visits.find((y) => y.id === id).cancelled)).visits.find((y) => y.id === id);
  check(v.cancelled && v.cancelKind === 'sameDay', '当日キャンセルとして取り消す（欄は開いたまま）', v);
  check((await p.getByTestId('vp-time').count()) === 0, '取り消した訪問は日時を変えない');
  await p.getByTestId('vp-uncancel').click();
  await p.getByTestId('vp-cancelled').waitFor({ state: 'detached' });
  v = (await dataWhen(page, (x) => !x.visits.find((y) => y.id === id).cancelled)).visits.find((y) => y.id === id);
  check(!v.cancelled && v.cancelKind === null, '取り消しをやめると元に戻る', v);
  await page.keyboard.press('Escape');
  await closed(page);
}

async function sameEverywhere(page) {
  await freshPlan(page);
  const s = await seriesVisit(page);
  // 週の予定の帯
  await open(page, `/week?d=${s.v.date}`, '[data-testid="week-band"]');
  const band = page.locator(`[data-testid="week-band"][data-visit="${s.v.id}"]`);
  await band.scrollIntoViewIfNeeded();
  await band.click();
  await panel(page).waitFor();
  check((await panel(page).getAttribute('data-visit')) === s.v.id, '週の予定の帯を押すと同じ欄', s.v.id);
  check((await panel(page).getByTestId('vp-scope').count()) === 1, '週から開いても範囲の選択がある');
  check((await panel(page).getByTestId('vp-open-day').count()) === 1, '週から開くと「日の予定で見る」');
  await shot(page, 'week');
  await page.keyboard.press('Escape');
  await closed(page);
  check(
    (await page.evaluate(() => document.activeElement?.dataset.visit ?? '')) === s.v.id,
    '閉じるとフォーカスは週の帯',
  );
  // 月の予定で〈利用者さん〉を選んだときは〈利用者さん〉の画面の予定（月）へのリンク。そのカレンダーの回から同じ欄（PRD D311）
  await open(page, `/month?ym=${s.v.date.slice(0, 7)}&client=${s.v.clientId}`, '[data-testid="month-client-open"]');
  await page.getByTestId('month-client-open').click();
  await page.locator(`[data-testid="pcal-visit"][data-visit="${s.v.id}"]`).click();
  await panel(page).waitFor();
  check(
    (await panel(page).getAttribute('data-visit')) === s.v.id,
    '月の予定で〈利用者さん〉を選んだときのリンクの先（その人の予定の月）の回から同じ欄',
  );
  await page.keyboard.press('Escape');
  await closed(page);
  // 日の予定の一覧の行
  await open(page, `/plan?date=${s.v.date}`, '[data-testid="confirm-state"]');
  await page.getByRole('button', { name: '一覧', exact: true }).click();
  check((await page.locator('[aria-label$="を編集"]').count()) === 0, '一覧の行に鉛筆（編集）を出さない');
  await page.locator(`[data-testid="visit-row-open"][data-visit="${s.v.id}"]`).click();
  await panel(page).waitFor();
  check((await panel(page).getByTestId('vp-summary').count()) === 1, '一覧の行の「開く」から同じ欄');
  await page.keyboard.press('Escape');
  await closed(page);
}

async function addNew(page) {
  await freshPlan(page);
  const n0 = (await data(page)).visits.length;
  await page.getByTestId('plan-more').click();
  await page.getByTestId('plan-visit-add').click();
  await panel(page).waitFor();
  const p = panel(page);
  check((await p.getAttribute('data-new')) === 'true', '「その他 ▾」の「訪問を追加」で欄の新規の形');
  check(
    (await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === 'vp-client',
    '新規は最初の欄（〈利用者さん〉）へフォーカス',
  );
  await p.getByTestId('vp-start').fill('19:00');
  await settle(page, 400);
  check((await p.getByTestId('vp-staff-choice').count()) > 0, '新規でも担当の候補が出る');
  await shot(page, 'new');
  await page.getByTestId('vp-save').click();
  await closed(page);
  const d = await dataWhen(page, (x) => x.visits.length === n0 + 1);
  check(d.visits.length === n0 + 1 && d.visits.at(-1).earliestStart === '19:00', '「追加」で訪問が1件増える');
  const at = await page.evaluate(
    () =>
      document.activeElement?.closest('[data-visit]')?.dataset.visit ??
      document.activeElement?.getAttribute('data-testid') ??
      '',
  );
  check(
    at === 'plan-more' || at === d.visits.at(-1).id,
    '閉じるとフォーカスは足した訪問（帯・カード・行）か「その他」',
    at,
  );
}

async function home(page) {
  await freshPlan(page);
  await open(page, '/home', '[data-testid="home-visits"]');
  const row = page.getByTestId('home-visit').first();
  const id = await row.getAttribute('data-visit');
  await row.click();
  await panel(page).waitFor();
  check((await panel(page).getAttribute('data-visit')) === id, 'ホームの今日の訪問から欄を開く');
  await page.keyboard.press('Escape');
  await closed(page);
  check((await page.evaluate(() => document.activeElement?.dataset.visit ?? '')) === id, '閉じるとフォーカスは行');
  check(hashOf(page).startsWith('#/home'), 'ホームのまま（画面を移らない）');
  check(
    (await page.locator('.btn-primary:visible, .home-task.is-lead:visible').count()) <= 1,
    'ホームの主ボタンは増やさない',
  );
  await page.getByTestId('home-visit-add').click();
  await panel(page).waitFor();
  check((await panel(page).getAttribute('data-new')) === 'true', 'ホームのいつでもの「訪問を追加」で新規の欄');
  await page.keyboard.press('Escape');
  await closed(page);
}

async function palette(page) {
  await freshPlan(page);
  const s = await seriesVisit(page);
  const d = await data(page);
  const c = d.clients.find((x) => x.id === s.v.clientId);
  const name = (c.kana || c.displayName).split(/\s+/).at(-1);
  const md = `${Number(s.v.date.slice(5, 7))}/${Number(s.v.date.slice(8, 10))}`;
  await open(page, '/week', '[data-testid="week-col"]');
  const hash = hashOf(page);
  await page.keyboard.press('Control+k');
  await page.getByTestId('cmdk-input').fill(`${name} ${md}`);
  await settle(page, 300);
  const opt = page.locator(`[data-testid="cmdk-option"][data-kind="visit"]`).filter({ hasText: md });
  check((await opt.count()) >= 1, 'パレットで「名前 日付」から訪問が出る（「訪問」のまとまり）', `${name} ${md}`);
  check(
    (await page.locator('.cmdk-group[data-kind="visit"] .cmdk-group-title').innerText()) === '訪問',
    '訪問の見出し',
  );
  await opt.first().click();
  await panel(page).waitFor();
  check(
    (await panel(page).getAttribute('data-visit')) === s.v.id && hashOf(page) === hash,
    'パレットで選ぶと画面を移らずに欄が開く',
    hashOf(page),
  );
  await page.keyboard.press('Escape');
  await closed(page);
  // 操作の「訪問を追加」
  await page.keyboard.press('Control+k');
  await page.getByTestId('cmdk-input').fill('ほうもんをついか');
  await settle(page, 200);
  await page.keyboard.press('Enter');
  await panel(page).waitFor();
  check((await panel(page).getAttribute('data-new')) === 'true', 'パレットの操作「訪問を追加」で新規の欄');
  await page.keyboard.press('Escape');
  await closed(page);
}

async function narrow(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshPlan(page);
  // 390px の既定は日ごとのリスト（ADR-0055）。行を押すと下から出る欄
  const first = page.locator('[data-testid="day-row"][data-visit]').first();
  await first.waitFor({ timeout: 30000 });
  const id = await first.getAttribute('data-visit');
  const card = page.locator(`[data-testid="day-row"][data-visit="${id}"]`);
  // この回だけ変えた回にしておく（390px では「繰り返しのとおりに戻す」を出さない）
  const edited = await page.evaluate(
    ([k, vid]) => {
      const d = JSON.parse(localStorage.getItem(k));
      const v = d.visits.find((x) => x.id === vid);
      if (!v.pattern) return false;
      v.durationMinutes += 5;
      v.pattern.edited = true;
      localStorage.setItem(k, JSON.stringify(d));
      return true;
    },
    [STORAGE_KEY, id],
  );
  if (edited) {
    await page.reload();
    await page.getByTestId('confirm-state').waitFor({ state: 'attached', timeout: 60000 });
    await settle(page, 400);
  }
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await panel(page).waitFor();
  await settle(page, 300);
  const p = panel(page);
  check((await p.getAttribute('data-visit')) === id, '390px：日ごとのリストの行から欄が開く');
  check((await p.getByTestId('vp-time').count()) === 0, '390px：日時の変更は出さない');
  if (edited)
    check(
      (await p.getByTestId('vp-changes').count()) === 1 && (await p.getByTestId('vp-restore').count()) === 0,
      '390px：この回の変更は見えるが「繰り返しのとおりに戻す」は出さない',
    );
  // 担当替え・取り消しは大きな4つのボタンから（ADR-0055）
  await p.getByTestId('vp-big-cancel').click();
  check((await p.getByTestId('vp-cancel').count()) === 1, '390px：取り消しはできる（「取り消す」のボタンから）');
  await p.getByTestId('vp-big-staff').click();
  check((await p.getByTestId('vp-staff').count()) === 1, '390px：担当替えはできる（「担当を替える」のボタンから）');
  check(
    (await page.evaluate(() => document.documentElement.scrollWidth)) <= 390 &&
      (await page.locator('.drawer').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)),
    '390px：横にはみ出さない',
  );
  await shot(page, 'narrow');
  // 担当を替えて保存できる
  const choice = p.locator('[data-testid="vp-staff-choice"]:not(.is-off)').first();
  if ((await choice.count()) > 0) {
    const sid = await choice.getAttribute('data-staff');
    await choice.locator('input').check();
    await page.getByTestId('vp-save').click();
    await closed(page);
    const d = await dataWhen(page, (x) => x.visits.some((v) => v.id === id && v.staffId === sid && v.pinned));
    check(
      d.visits.some((v) => v.id === id && v.staffId === sid && v.pinned),
      '390px：担当を替えて保存できる（訪問に書いてピン）',
    );
  } else {
    await page.keyboard.press('Escape');
    await closed(page);
  }
  await page.getByTestId('plan-more').click();
  check(
    (await page.getByTestId('plan-visit-add').getAttribute('aria-disabled')) === 'true',
    '390px：「訪問を追加」は押せず理由（スマホでは足さない）',
  );
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1400, height: 1000 });
}

/** 日付を変えて候補が変わると、選んでいた担当は「変えない」に戻る（前の日の候補で当てない。PR #78 のレビュー） */
async function pickReset(page) {
  await freshPlan(page);
  await openFromBand(page);
  const p = panel(page);
  const choice = p.locator('[data-testid="vp-staff-choice"]:not(.is-off)').first();
  await choice.waitFor();
  await choice.locator('input').check();
  // 選んだ人が働かない曜日へ（その日の候補では選べない）
  const sid = await choice.getAttribute('data-staff');
  const d = await data(page);
  const st = d.staff.find((x) => x.id === sid);
  const off = Array.from({ length: 14 }, (_, i) => addDays(TODAY, i + 1)).find(
    (x) => !st.workDays.includes(new Date(`${x}T00:00:00Z`).getUTCDay()),
  );
  check(!!off, '選んだ人が働かない日がある（前提）', { sid, workDays: st.workDays });
  await p.getByTestId('vp-date').fill(off ?? addDays(TODAY, 1));
  const kept = await until(() => p.getByTestId('vp-staff-keep').isChecked());
  check(kept, '日付を変えて選んでいた担当が選べなくなると「変えない」に戻る');
  await page.keyboard.press('Escape');
  await closed(page);
}

/** 開いている間に別のタブで同じ訪問が変わったら、古い入力で上書きしない */
async function otherTab(page) {
  await freshPlan(page);
  const id = await openFromBand(page);
  const p = panel(page);
  await p.getByTestId('vp-note').fill('欄のメモ');
  const other = await page.context().newPage();
  await other.goto(`${BASE}#/home`);
  await other.evaluate(
    ([k, vid]) => {
      const d = JSON.parse(localStorage.getItem(k));
      d.visits.find((v) => v.id === vid).note = '別のタブのメモ';
      localStorage.setItem(k, JSON.stringify(d));
    },
    [STORAGE_KEY, id],
  );
  await other.close();
  await settle(page, 600);
  await page.getByTestId('vp-save').click();
  await settle(page, 300);
  const err = await p
    .locator('[role="alert"]')
    .innerText()
    .catch(() => '');
  check(/別の操作で変わりました/.test(err), '別のタブで変わった訪問は保存せず理由を出す', err);
  const v = await visitOf(page, id);
  check(v.note === '別のタブのメモ', '別のタブの変更を上書きしない', v.note);
  await page.keyboard.press('Escape');
  await closed(page);
}

async function print(page) {
  await freshPlan(page);
  await openFromBand(page);
  await page.emulateMedia({ media: 'print' });
  const shown = await page.locator('.drawer-wrap').evaluate((el) => getComputedStyle(el).display);
  check(shown === 'none', '印刷で欄を出さない', shown);
  await page.emulateMedia({ media: 'screen' });
  await page.keyboard.press('Escape');
  await closed(page);
}

const steps = sharedPage({
  open: async () => {
    const s = await openPage();
    // 「これ以降」「すべて」で確定した日も変わるときの確認には「変える」で答える
    s.confirms = await answerConfirms(s.page);
    return s;
  },
  steps: [
    ['時間軸の帯から開く', bandOpen],
    ['日時と担当を同時に変えて保存', timeAndStaff],
    ['繰り返しの回の範囲', scopes],
    ['取り消しと取り消しをやめる', cancelAndBack],
    ['週・月・一覧から開いても同じ欄', sameEverywhere],
    ['新しい訪問', addNew],
    ['ホームから開く', home],
    ['コマンドパレットから開く', palette],
    ['日付を変えると選んでいた担当を戻す', pickReset],
    ['別のタブの変更を上書きしない', otherTab],
    ['390px', narrow],
    ['印刷', print],
  ],
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
