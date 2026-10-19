// 急な欠勤・当日キャンセルを目立つ入口から登録して振り直すこと（PRD D167〜D172。ADR-0025 追記・ADR-0011・ADR-0015）を本物のブラウザで確かめる：
// ホームの「欠勤・キャンセルを登録」で今日の日の予定の「欠勤・キャンセル」の欄が1段目で開き `?do=`・`?date=` が URL から消える、
// 段階の表示（aria-current="step"）と段階ごとのフォーカス（段階の見出し）、〈スタッフ〉が休む → 人と時間帯 → 影響（入らなくなる訪問 N件）→
// 登録して振り直す（案A）→ 4段目のまとめと案A・案B（案B を作って今の案にする）→ この割当で確定（独自の確認ダイアログ）→ 確定済み、
// 当日キャンセル（訪問を選ぶ・当日キャンセルが既定・影響の文・取り消すと cancelKind='sameDay'・4段目）、
// 列の見出しの「欠勤を直す」で同じ欄が2段目で開き、欠勤を取り消せる、戻る、Esc で閉じて入口のボタンへフォーカス、
// 案の無い日は欠勤だけ登録できる、390px で入口が見え欄が画面に収まる・下のタブは5つのまま、印刷で入口を出さない、ブラウザの確認を出さない。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-absence.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { skipTour } = require('./lib/tourSeen.cjs');
const { answerConfirms } = require('./lib/confirmDialog.cjs');
const {
  launch,
  BASE,
  OUT_DIR,
  NOW,
  TODAY,
  STORAGE_KEY,
  check,
  settle,
  hashOf,
  stored,
  failShot,
  run,
} = require('./lib/env.cjs');

/** 案の無い日を作るのに使う、今日の次の日 */
const NEXT = new Date(Date.parse(`${TODAY}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
/** 開くと自動で案を作る日（今日の2日後）。初期データでは案があるので、runningDay の用意で案と記録を消す（PRD D225） */
const DAY2 = new Date(Date.parse(`${TODAY}T00:00:00Z`) + 2 * 86400000).toISOString().slice(0, 10);

/** 保存（少し遅れて書く）が条件を満たすまで待つ（満たさなければ時間切れで続ける） */
async function waitStored(page, pred, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const d = await stored(page);
    if (d && pred(d)) return d;
    await page.waitForTimeout(100);
  }
  return stored(page);
}
const panel = (page) => page.getByTestId('sudden-panel');
const stepOf = (page) => panel(page).getAttribute('data-step');
/** いまフォーカスのある要素（data-testid・クラス・タグ） */
const focused = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el ? (el.getAttribute('data-testid') ?? el.className ?? el.tagName) : '';
  });
/** 段階の表示の今の段階の名前 */
const currentStep = (page) =>
  page.locator('.sudden-steps [aria-current="step"]').evaluate((el) => el.textContent.replace(/^\d/, '').trim());

/** 段階の表示の4つが1行に並ぶ（上の端が同じ） */
const oneLine = (page) =>
  page
    .locator('.sudden-steps li')
    .evaluateAll(
      (els) => els.length === 4 && new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))).size === 1,
    );
/** 今の案が出て計算が終わるまで待つ */
async function waitPlan(page) {
  await page.getByTestId('confirm-state').waitFor({ state: 'attached', timeout: 60000 });
  await page.getByTestId('plan-progress').waitFor({ state: 'detached', timeout: 60000 });
  await settle(page, 300);
}
/** 日の画面を開き直す（今日） */
async function openPlan(page) {
  await page.goto(`${BASE}#/plan?date=${TODAY}`);
  await page.reload();
  await waitPlan(page);
}
/** 休む人の選択肢のうち、訪問のいちばん多い人（値と件数） */
async function busiestStaff(page) {
  return page.getByTestId('sudden-staff').evaluate((sel) => {
    let best = { value: '', count: -1, label: '' };
    for (const o of sel.options) {
      const m = /訪問 (\d+)件/.exec(o.textContent);
      if (!o.value || !m) continue;
      const n = Number(m[1]);
      if (n > best.count) best = { value: o.value, count: n, label: o.textContent };
    }
    return best;
  });
}

// ---- ホームから開く → 〈スタッフ〉の欠勤 → 案A → 案B を選ぶ → 確定 ----
async function fromHome(page) {
  await page.goto(`${BASE}#/home`);
  await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
  await page.reload();
  await page.getByTestId('home-absence').waitFor();
  const href = await page.getByTestId('home-absence').getAttribute('href');
  check(href?.includes(`/plan?date=${TODAY}&do=absence`), 'ホームのカードの行き先が ?date=今日&do=absence', href);
  await page.getByTestId('home-absence').click();
  await panel(page).waitFor({ timeout: 20000 });
  await settle(page, 300);
  check(hashOf(page) === '#/plan', '開いたら URL から ?do=・?date= が消える', hashOf(page));
  check((await page.locator('.date-switch select').inputValue()) === TODAY, '今日の日の予定');
  check((await stepOf(page)) === '1', '1段目（何が起きたか）で開く');
  check(
    (await page.locator('.drawer').getAttribute('role')) === 'dialog' &&
      (await page.locator('.drawer').getAttribute('aria-modal')) === 'true',
    '右の欄（role=dialog・aria-modal）',
  );
  const steps = await page.locator('.sudden-steps li').allTextContents();
  check(steps.length === 4, '段階の表示が4つ', steps);
  check((await currentStep(page)) === '起きたこと', '今の段階（aria-current="step"）', await currentStep(page));
  check(
    (await page.locator('h3.sudden-step-title').textContent()) === '何が起きましたか？',
    '見出しは段階の短い名前と重ならない',
  );
  check(await oneLine(page), '段階の表示は1行');
  check(
    await page.evaluate(() => !!document.activeElement?.closest('.drawer')),
    '開いたらフォーカスは欄の中',
    await focused(page),
  );
  await waitPlan(page);
  await page.screenshot({ path: path.join(OUT_DIR, 'step1.png') });
  await page.getByTestId('sudden-kind-staff').click();
  await settle(page);
  check((await stepOf(page)) === '2', '「スタッフが休む」で2段目');
  check(
    (await focused(page)).includes('sudden-step-title'),
    '段階が進むと、フォーカスは段階の見出し',
    await focused(page),
  );
  check((await page.getByTestId('sudden-next').isDisabled()) === true, '人を選ぶまで「次へ」は押せない');
  const best = await busiestStaff(page);
  check(best.count > 0, '休む人の選択肢に訪問の件数', best);
  await page.getByTestId('sudden-staff').selectOption(best.value);
  await settle(page);
  // 時間帯：開始も終了も空だと誤り → 終日に戻す
  await page.locator('.sudden-panel .segmented button', { hasText: '時間帯' }).click();
  await settle(page);
  check(
    (await page.locator('.sudden-panel .error').textContent()) === '開始か終了を選んでください' &&
      (await page.getByTestId('sudden-next').isDisabled()),
    '時間帯で開始も終了も空なら誤りで「次へ」は押せない',
  );
  await page.locator('.sudden-panel .segmented button', { hasText: '終日' }).click();
  await page.locator('.sudden-panel input:not([type])').first().fill('発熱');
  await page.getByTestId('sudden-next').click();
  await settle(page, 400);
  check((await stepOf(page)) === '3', '「次へ」で3段目（影響と振り直し）');
  const impact = await page.getByTestId('sudden-impact').textContent();
  check(/入らなくなる訪問 \d+件/.test(impact), '影響：入らなくなる訪問 N件', impact);
  check((await page.locator('.sudden-targets li').count()) > 0, '影響：振り直す訪問の一覧');
  check(await page.getByTestId('anneal-suggest').isVisible(), '振り直しの案：案A と案B の説明');
  check(
    (await page.locator('.sudden-option').first().textContent()).includes('欠勤明けの移動で開始が遅れることがあります'),
    '案A の説明に「残りの訪問は欠勤明けの移動で開始が遅れることがあります」',
  );
  const recommended = await panel(page).locator('.chip-primary', { hasText: 'おすすめ' }).count();
  const primary = await page.locator('.drawer-foot .btn-primary').getAttribute('data-testid');
  check(
    recommended > 0
      ? primary === 'sudden-anneal' &&
          (await page.getByTestId('sudden-anneal').textContent()).includes('おすすめ') &&
          (await page.getByTestId('sudden-reassign').isVisible())
      : primary === 'sudden-reassign',
    'おすすめがあれば主ボタンは「登録して案B も作る（おすすめ）」で案A は2番目、無ければ案A が主ボタン',
    { recommended, primary },
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'step3-staff.png') });
  // 戻る → 2段目（選んだ人はそのまま）→ もう一度次へ
  await page.getByTestId('sudden-back').click();
  await settle(page);
  check(
    (await stepOf(page)) === '2' && (await page.getByTestId('sudden-staff').inputValue()) === best.value,
    '戻るで2段目（選んだ人はそのまま）',
  );
  await page.getByTestId('sudden-next').click();
  await settle(page, 400);
  check(!(await page.getByTestId('sudden-reassign').isDisabled()), '「登録して振り直す（案A）」が押せる');
  await page.getByTestId('sudden-reassign').click();
  await page.getByTestId('sudden-done').waitFor({ timeout: 10000 });
  await page.getByTestId('sudden-result').waitFor({ timeout: 10000 });
  check((await stepOf(page)) === '4', '振り直すと4段目（選んで確定）。欄は閉じない');
  check(
    await page.getByTestId('sudden-summary').isVisible(),
    '4段目：振り直しのまとめ（変わる人・振り直し・入らない）',
  );
  const d1 = await waitStored(page, (d) => !!d.aiPlans?.[TODAY]?.reassign);
  check(
    d1.absences.some((a) => a.staffId === best.value && a.date === TODAY && a.from === null && a.note === '発熱') &&
      d1.aiPlans[TODAY].reassign.method === 'insert',
    '欠勤（終日・メモ）を登録し、今の案が案A の振り直し',
  );
  check(
    (await page.getByTestId('sudden-confirm-note').textContent()).includes('確定'),
    '4段目：確定の状態の文',
    await page.getByTestId('sudden-confirm-note').textContent(),
  );
  // 案B を作って選ぶ（差の欄と同じ AnnealBox）
  const box = panel(page).getByTestId('anneal-box');
  await box.getByRole('button', { name: /案B を作る/ }).click();
  await box.getByTestId('anneal-table').waitFor({ timeout: 90000 });
  await page.getByTestId('plan-progress').waitFor({ state: 'detached', timeout: 90000 });
  await settle(page, 400);
  const chooseB = box.getByRole('button', { name: /^案B.*を今の案にする$/ });
  if ((await chooseB.count()) > 0 && !(await chooseB.isDisabled())) {
    await chooseB.click();
    const d2 = await waitStored(page, (d) => d.aiPlans?.[TODAY]?.reassign?.method === 'anneal');
    check(d2.aiPlans[TODAY].reassign.method === 'anneal', '4段目で案B を今の案にできる');
  } else {
    // 案B が案A と同じ（案A のまま）ときは表に選ぶボタンが出ないか、案A が今の案
    check((await box.textContent()).includes('案A'), '案B を作った（案A のままの知らせ）');
  }
  await page.screenshot({ path: path.join(OUT_DIR, 'step4-staff.png') });
  // 確定（独自の確認ダイアログ。answerConfirms が確定を押す）
  await page.getByTestId('sudden-adopt').click();
  await panel(page).waitFor({ state: 'detached', timeout: 10000 });
  const d3 = await waitStored(page, (d) => !!d.manualPlans?.[TODAY]);
  check(!!d3.manualPlans[TODAY], '「この割当で確定」で確定した割当を書く');
  await settle(page, 300);
  check(
    (await page.getByTestId('confirm-state').textContent()).includes('確定済み'),
    '確定すると欄が閉じて「確定済み」',
  );
  return best;
}

// ---- 振り直して閉じたあとに開き直し、欠勤だけ登録してもフォーカスは差の欄へ飛ばない ----
async function reopenFocus(page, best) {
  await openPlan(page);
  const others = async () =>
    page
      .getByTestId('sudden-staff')
      .evaluate(
        (sel, skip) => [...sel.options].map((o) => o.value).filter((v) => v && !skip.includes(v)),
        [best.value],
      );
  await page.getByTestId('sudden-open').click();
  await panel(page).waitFor();
  await page.getByTestId('sudden-kind-staff').click();
  const list = await others();
  await page.getByTestId('sudden-staff').selectOption(list[0]);
  await page.getByTestId('sudden-next').click();
  await settle(page, 400);
  await page.getByTestId('sudden-reassign').click();
  await page.getByTestId('sudden-done').waitFor({ timeout: 10000 });
  await page.keyboard.press('Escape');
  await panel(page).waitFor({ state: 'detached' });
  await settle(page, 600);
  check((await focused(page)) === 'reassign-bar', '振り直して閉じると差の欄へ', await focused(page));
  await page.getByTestId('sudden-open').click();
  await panel(page).waitFor();
  await page.getByTestId('sudden-kind-staff').click();
  await page.getByTestId('sudden-staff').selectOption(list[1]);
  await page.getByTestId('sudden-next').click();
  await settle(page, 400);
  await page.getByTestId('sudden-save-only').click();
  await panel(page).waitFor({ state: 'detached' });
  await settle(page, 600);
  check(
    (await focused(page)) === 'sudden-open',
    '開き直して欠勤だけ登録すると、フォーカスは入口へ（差の欄へ飛ばない）',
    await focused(page),
  );
  // 1段目で種類を変えたら、前に選んだ人・訪問を消す
  await page.getByTestId('sudden-open').click();
  await panel(page).waitFor();
  await page.getByTestId('sudden-kind-staff').click();
  await page.getByTestId('sudden-staff').selectOption(list[2] ?? list[0]);
  await page.getByTestId('sudden-back').click();
  await page.getByTestId('sudden-kind-client').click();
  await page.getByTestId('sudden-back').click();
  await page.getByTestId('sudden-kind-staff').click();
  check((await page.getByTestId('sudden-staff').inputValue()) === '', '種類を変えたら前に選んだ人を消す');
  await page.keyboard.press('Escape');
  await panel(page).waitFor({ state: 'detached' });
}

// ---- 自動作成の計算中に案の無い日を開く：振り直し・欠勤だけ登録は押せず「案を作っています」 ----
async function runningDay(page) {
  // 用意：初期データの DAY2 の案と記録を別のタブで消す（案の無い日にして、開くと自動で作らせる）
  const other = await page.context().newPage();
  await other.goto(`${BASE}#/data`);
  await other.evaluate(
    ([k, day]) => {
      const d = JSON.parse(localStorage.getItem(k));
      delete d.aiPlans[day];
      delete d.aiRuns[day];
      localStorage.setItem(k, JSON.stringify(d));
    },
    [STORAGE_KEY, DAY2],
  );
  await other.close();
  await page.goto('about:blank');
  await page.goto(`${BASE}#/plan?date=${DAY2}&do=absence`);
  await panel(page).waitFor({ timeout: 20000 });
  await page.getByTestId('sudden-kind-staff').click();
  const v = await page
    .getByTestId('sudden-staff')
    .evaluate((sel) => [...sel.options].find((o) => o.value)?.value ?? '');
  await page.getByTestId('sudden-staff').selectOption(v);
  await page.getByTestId('sudden-next').click();
  const computing = (await page.getByTestId('plan-progress').count()) > 0;
  if (computing && (await page.getByTestId('sudden-no-plan').count()) > 0) {
    check(
      (await page.getByTestId('sudden-no-plan').textContent()) === '案を作っています。終わると振り直せます' &&
        (await page.getByTestId('sudden-save-only').isDisabled()) &&
        (await page.getByTestId('sudden-reassign').isDisabled()),
      '計算中：「案を作っています。終わると振り直せます」・欠勤だけ登録も振り直しも押せない',
    );
  } else {
    check(true, '計算中の確かめ：開いたときには計算が終わっていた（飛ばす）');
  }
  await page.getByTestId('plan-progress').waitFor({ state: 'detached', timeout: 60000 });
  await page.getByTestId('sudden-reassign').waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-testid="sudden-reassign"]')?.disabled, null, {
    timeout: 10000,
  });
  check(
    (await page.getByTestId('sudden-no-plan').count()) === 0 &&
      !(await page.getByTestId('sudden-save-only').isDisabled()),
    '作り終えると振り直せる（欠勤だけ登録も押せる）',
  );
  await page.keyboard.press('Escape');
  await panel(page).waitFor({ state: 'detached' });
}

// ---- 当日キャンセル ----
async function sameDayCancel(page) {
  await openPlan(page);
  await page.getByTestId('sudden-open').click();
  await panel(page).waitFor();
  await page.getByTestId('sudden-kind-client').click();
  await settle(page);
  check((await stepOf(page)) === '2', '「キャンセル」で2段目（キャンセルの訪問）');
  check((await currentStep(page)) === '訪問', '段階の名前がキャンセルの流れ', await currentStep(page));
  check(await page.getByTestId('sudden-same-day').isChecked(), '取り消しの種類の既定は当日キャンセル');
  const first = await page
    .getByTestId('sudden-visit')
    .evaluate((sel) => [...sel.options].find((o) => o.value)?.value ?? '');
  check(first !== '', '訪問の選択肢がある');
  await page.getByTestId('sudden-visit').selectOption(first);
  await page.getByTestId('sudden-next').click();
  await settle(page);
  check((await stepOf(page)) === '3', '3段目（影響の確認）');
  const impact = await page.getByTestId('sudden-cancel-impact').textContent();
  check(
    impact.includes('当日キャンセルは') && impact.includes('回数'),
    '影響の文（担当の予定から外れる・回数に出る）',
    impact,
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'step3-cancel.png') });
  await page.getByTestId('sudden-cancel-ok').click();
  await page.getByTestId('sudden-done').waitFor();
  const d = await waitStored(page, (x) => x.visits.some((v) => v.id === first && v.cancelled));
  const v = d.visits.find((x) => x.id === first);
  check(v.cancelled === true && v.cancelKind === 'sameDay', '取り消すと cancelKind=sameDay', v);
  check((await stepOf(page)) === '4', 'キャンセルのあと4段目');
  // Esc で閉じ、フォーカスは入口のボタンへ
  await page.keyboard.press('Escape');
  await panel(page).waitFor({ state: 'detached' });
  await settle(page);
  check(
    (await focused(page)) === 'sudden-open',
    'Esc で閉じて、フォーカスは「欠勤・キャンセル」のボタン',
    await focused(page),
  );
}

// ---- 列の見出しから同じ欄（2段目）・欠勤の取り消し ----
async function fromHeader(page, best) {
  await openPlan(page);
  const btn = page.locator(`.route-col[data-staff="${best.value}"] .absence-btn`).first();
  check((await btn.textContent()) === '欠勤を直す', '欠勤のある人の列の見出しは「欠勤を直す」');
  await btn.click();
  await panel(page).waitFor();
  await settle(page);
  check(
    (await stepOf(page)) === '2' && (await page.getByTestId('sudden-staff').inputValue()) === best.value,
    '列の見出しから同じ欄が、その人を選んだ2段目で開く',
  );
  await page.getByTestId('sudden-next').click();
  await settle(page, 400);
  check(await page.getByTestId('sudden-remove').isVisible(), '登録済みなら「欠勤を取り消す」');
  await page.getByTestId('sudden-remove').click();
  await panel(page).waitFor({ state: 'detached', timeout: 10000 });
  const d = await waitStored(page, (x) => !x.absences.some((a) => a.staffId === best.value && a.date === TODAY));
  check(!d.absences.some((a) => a.staffId === best.value && a.date === TODAY), '確かめて欠勤を取り消す');
  // Esc：1段目で開いて閉じる（データは変わらない）
  await page.getByTestId('sudden-open').click();
  await panel(page).waitFor();
  const before = JSON.stringify((await stored(page)).absences);
  await page.keyboard.press('Escape');
  await panel(page).waitFor({ state: 'detached' });
  check(JSON.stringify((await stored(page)).absences) === before, 'Esc で閉じても何も変わらない');
}

// ---- 案の無い日：欠勤だけ登録できる ----
async function noPlanDay(page) {
  // 次の日の訪問を消して案の無い日にする（稼働する人は残る）
  await page.goto(`${BASE}#/home`);
  await page.evaluate(
    ([k, day]) => {
      const d = JSON.parse(localStorage.getItem(k));
      d.visits = d.visits.filter((v) => v.date !== day);
      d.patterns = [];
      delete d.aiPlans[day];
      delete d.manualPlans[day];
      localStorage.setItem(k, JSON.stringify(d));
    },
    [STORAGE_KEY, NEXT],
  );
  await page.goto(`${BASE}#/plan?date=${NEXT}&do=absence`);
  await page.reload();
  await panel(page).waitFor({ timeout: 20000 });
  check((await page.locator('.date-switch select').inputValue()) === NEXT, '?date= の日を選んで開く');
  await page.getByTestId('sudden-kind-staff').click();
  const has = await page.getByTestId('sudden-staff').count();
  if (has === 0) {
    check(true, 'この日に働く人がいない（欠勤の登録なし）');
    await page.keyboard.press('Escape');
    return;
  }
  const v = await page
    .getByTestId('sudden-staff')
    .evaluate((sel) => [...sel.options].find((o) => o.value)?.value ?? '');
  await page.getByTestId('sudden-staff').selectOption(v);
  await page.getByTestId('sudden-next').click();
  await settle(page, 400);
  check(await page.getByTestId('sudden-no-plan').isVisible(), '案の無い日：「欠勤だけ登録できます」');
  check(await page.getByTestId('sudden-reassign').isDisabled(), '案の無い日：振り直しは押せない');
  await page.getByTestId('sudden-save-only').click();
  await panel(page).waitFor({ state: 'detached' });
  const d = await waitStored(page, (x) => x.absences.some((a) => a.staffId === v && a.date === NEXT));
  check(
    d.absences.some((a) => a.staffId === v && a.date === NEXT),
    '案の無い日：欠勤だけ登録する',
  );
}

// ---- 390px・印刷 ----
async function mobile(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPlan(page);
  const b = await page.getByTestId('sudden-open').boundingBox();
  check(b && b.x >= 0 && b.x + b.width <= 390, '390px：入口のボタンが画面に収まる', b);
  const tabs = await page.getByTestId('bottom-tabs').locator('a').allTextContents();
  check(tabs.length === 5, '390px：下のタブは5つのまま（欠勤は入れない）', tabs);
  await page.getByTestId('sudden-open').click();
  await panel(page).waitFor();
  await page.getByTestId('sudden-kind-staff').click();
  const best = await busiestStaff(page);
  await page.getByTestId('sudden-staff').selectOption(best.value);
  await page.getByTestId('sudden-next').click();
  await settle(page, 400);
  check(await oneLine(page), '390px：段階の表示は1行（今の段階だけ名前）');
  const dr = await page.locator('.drawer').boundingBox();
  check(dr && dr.x >= 0 && dr.x + dr.width <= 390, '390px：欄が画面に収まる', dr);
  const foot = await page.getByTestId('sudden-reassign').boundingBox();
  check(
    foot && foot.x >= 0 && foot.x + foot.width <= 390 && foot.y + foot.height <= 844,
    '390px：主ボタンが画面の中',
    foot,
  );
  const sw = await page.evaluate(() => document.querySelector('.drawer-body').scrollWidth);
  const cw = await page.evaluate(() => document.querySelector('.drawer-body').clientWidth);
  check(sw <= cw, '390px：欄の中が横にはみ出さない', { sw, cw });
  await page.screenshot({ path: path.join(OUT_DIR, 'mobile-step3.png') });
  await page.keyboard.press('Escape');
  await panel(page).waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.emulateMedia({ media: 'print' });
  check(!(await page.getByTestId('sudden-open').isVisible()), '印刷：入口のボタンを出さない');
  await page.emulateMedia({ media: 'screen' });
}

/**
 * 列の見出しの入口の呼び名（PRD D231）：欠勤の無い人は「この人の欠勤を登録」。
 * 390px（順番）では1行、1440px（時間軸の狭い列）では2行まで（「この人の／欠勤を登録」で折り返す）
 */
async function headerLabel(page) {
  /** 欠勤の無い人の列の見出しのボタン：文字と行の数（内容の高さ ÷ 行の高さ）・列に収まるか */
  const measure = () =>
    page.locator('.absence-btn').evaluateAll((els) =>
      els
        .filter((el) => el.textContent === 'この人の欠勤を登録')
        .map((el) => {
          const cs = getComputedStyle(el);
          const inner = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
          const r = el.getBoundingClientRect();
          const col = el.closest('.route-col')?.getBoundingClientRect();
          return {
            lines: Math.round(inner / parseFloat(cs.lineHeight)),
            fits: !col || (r.left >= col.left - 1 && r.right <= col.right + 1),
          };
        }),
    );
  for (const [w, h, max] of [
    [390, 844, 1],
    [1440, 1000, 2],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await openPlan(page);
    const got = await measure();
    check(
      got.length > 0 && got.every((x) => x.lines >= 1 && x.lines <= max && x.fits),
      `${w}px：列の見出しは「この人の欠勤を登録」で${max === 1 ? '1行' : '2行まで'}・列に収まる`,
      got.slice(0, 3),
    );
  }
  await page.setViewportSize({ width: 1400, height: 1000 });
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
  // 確認ダイアログには確定で答える（ブラウザの確認が出たら st.native に入る）
  const st = await answerConfirms(page);
  let best = null;
  for (const [name, fn] of [
    [
      'from-home',
      async () => {
        best = await fromHome(page);
      },
    ],
    ['reopen-focus', () => (best ? reopenFocus(page, best) : check(false, 'reopen-focus：前の段が通らない'))],
    ['same-day-cancel', () => sameDayCancel(page)],
    ['running-day', () => runningDay(page)],
    ['from-header', () => (best ? fromHeader(page, best) : check(false, 'from-header：前の段が通らない'))],
    ['no-plan', () => noPlanDay(page)],
    ['mobile', () => mobile(page)],
    ['header-label', () => headerLabel(page)],
  ]) {
    try {
      await fn();
    } catch (e) {
      check(false, name, String(e.message || e));
      await failShot(page, name);
    }
  }
  check(
    st.messages.some((m) => m.startsWith('この割当で確定しますか？')) &&
      st.messages.some((m) => m.includes('欠勤を取り消しますか？')),
    '確定・欠勤の取り消しは独自の確認ダイアログで確かめる',
    st.messages,
  );
  check(st.native.length === 0, 'ブラウザのダイアログを出さない', st.native);
  await b.close();
  return errors;
});
