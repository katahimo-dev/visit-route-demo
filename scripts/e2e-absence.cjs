// 急な欠勤・当日キャンセルを目立つ入口から登録して振り直すこと（PRD D167〜D172。ADR-0025 追記・ADR-0011・ADR-0015）を本物のブラウザで確かめる：
// ホームの「欠勤・キャンセルを登録」で今日の日の予定の「欠勤・キャンセル」の欄が1段目で開き `?do=`・`?date=` が URL から消える、
// 段階の表示（aria-current="step"）と段階ごとのフォーカス（段階の見出し）、〈スタッフ〉が休む → 人と時間帯 → 影響（入らなくなる訪問 N件）→
// 主ボタンは「登録して振り直す（おすすめ）」の1つ・ほかのやり方は文字のボタン（PRD D264）→ 案A で振り直す → 4段目のまとめ・担当が移る訪問の一覧（PRD D265）と案A・案B（案B を作って今の案にする）→ この割当で確定（独自の確認ダイアログ）→
// 5段目の連絡（人ごとの文・［文をコピー］・メール・［連絡した］の数。PRD D243〜D246）→ 終わる → 確定済み、
// 当日キャンセル（訪問を選ぶ・当日キャンセルが既定・影響の文・取り消すと cancelKind='sameDay'・4段目・5段目で担当に「中止」）、
// 列の見出しの「欠勤を直す」で同じ欄が2段目で開き、欠勤を取り消せる、戻る、Esc で閉じて入口のボタンへフォーカス、
// 訪問の無い日は欠勤だけ登録できる、390px で入口が見え欄が画面に収まる・下のタブは5つ（ホーム・予定・欠勤・探す・メニュー。PRD D336）、印刷で入口を出さない、ブラウザの確認を出さない。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-absence.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { answerConfirms } = require('./lib/confirmDialog.cjs');
const { BASE, OUT_DIR, TODAY, STORAGE_KEY, check, settle, hashOf, stored, runSteps } = require('./lib/env.cjs');
const { sharedPage, openPage } = require('./lib/steps.cjs');

/** 訪問の無い日を作るのに使う、今日の次の日 */
const NEXT = new Date(Date.parse(`${TODAY}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
/** 案A で入らない見込みの日を作る日（初期データの案がある日。PRD D225） */
const DAY3 = new Date(Date.parse(`${TODAY}T00:00:00Z`) + 3 * 86400000).toISOString().slice(0, 10);

/** 保存（少し遅れて書く）が条件を満たすまで待つ（満たさなければ時間切れで続ける） */
async function waitStored(page, pred, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const d = await stored(page);
    if (d && pred(d)) return d;
    await settle(page, 100);
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

/** 段階の表示の5つが1行に並ぶ（上の端が同じ） */
const oneLine = (page) =>
  page
    .locator('.sudden-steps li')
    .evaluateAll(
      (els) => els.length === 5 && new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))).size === 1,
    );
/** 5段目の連絡の行（宛先・種類・文） */
const contactRowsOf = (page) =>
  panel(page)
    .getByTestId('sudden-contact')
    .evaluateAll((els) =>
      els.map((el) => ({
        to: el.dataset.to,
        kinds: el.dataset.kinds,
        text: el.querySelector('[data-testid="sudden-contact-text"]')?.textContent ?? '',
        mail: el.querySelector('[data-testid="sudden-contact-mail"]')?.getAttribute('href') ?? null,
      })),
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
  check(
    hashOf(page).startsWith('#/plan') && !/[?&](do|date)=/.test(hashOf(page)),
    '開いたら URL から ?do=・?date= が消える',
    hashOf(page),
  );
  check((await page.locator('.date-switch select').inputValue()) === TODAY, '今日の日の予定');
  check((await stepOf(page)) === '1', '1段目（何が起きたか）で開く');
  check(
    (await page.locator('.drawer').getAttribute('role')) === 'dialog' &&
      (await page.locator('.drawer').getAttribute('aria-modal')) === 'true',
    '右の欄（role=dialog・aria-modal）',
  );
  const steps = await page.locator('.sudden-steps li').allTextContents();
  check(
    steps.length === 5 && steps.at(-1).includes('連絡'),
    '段階の表示が5つ（起きたこと→休む人→影響→確定→連絡）',
    steps,
  );
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
  // 主ボタンは「登録して振り直す（おすすめ）」の1つ。おすすめが案B（案A で入らない見込み）なら sudden-anneal、
  // 無ければ sudden-reassign。もう一方と「欠勤だけ登録」は控えめな文字のボタン（PRD D264）
  const recommendB = await page.getByTestId('anneal-suggest').evaluate((el) => el.classList.contains('is-recommended'));
  const primaries = await page.locator('.drawer .btn-primary').evaluateAll((els) => els.map((e) => e.dataset.testid));
  const primaryText = await page.locator('.drawer-foot .btn-primary').textContent();
  const alt = await page
    .getByTestId('sudden-alt')
    .locator('button')
    .evaluateAll((els) => els.map((e) => ({ id: e.dataset.testid, text: e.classList.contains('btn-text') })));
  check(
    primaries.length === 1 &&
      primaries[0] === (recommendB ? 'sudden-anneal' : 'sudden-reassign') &&
      primaryText.includes('登録して振り直す（おすすめ）'),
    '影響：主ボタンは「登録して振り直す（おすすめ）」の1つ（案B がおすすめなら案B も作る）',
    { recommendB, primaries, primaryText },
  );
  check(
    alt.length === 2 &&
      alt.every((x) => x.text) &&
      alt.some((x) => x.id === (recommendB ? 'sudden-reassign' : 'sudden-anneal')) &&
      alt.some((x) => x.id === 'sudden-save-only'),
    '影響：ほかのやり方（もう一方の案・欠勤だけ登録）は文字のボタン',
    alt,
  );
  check(
    (await panel(page).locator('.sudden-option.is-recommended').count()) === 1 &&
      (await panel(page).locator('.sudden-option.is-recommended .chip-primary', { hasText: 'おすすめ' }).count()) === 1,
    '影響：おすすめの案の説明カードに縁と札「おすすめ」',
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
  check(!(await page.getByTestId('sudden-reassign').isDisabled()), '「案A で振り直す」が押せる');
  await page.getByTestId('sudden-reassign').click();
  await page.getByTestId('sudden-done').waitFor({ timeout: 10000 });
  await page.getByTestId('sudden-result').waitFor({ timeout: 10000 });
  check((await stepOf(page)) === '4', '振り直すと4段目（選んで確定）。欄は閉じない');
  check(
    await page.getByTestId('sudden-summary').isVisible(),
    '4段目：振り直しのまとめ（変わる人・振り直し・入らない）',
  );
  // 誰のどの訪問が誰へ移るか（PRD D265）：〈利用者さん〉の名前・時刻と、元の担当 → 新しい担当（入らない訪問は「入らない」）
  const moves = await panel(page)
    .getByTestId('reassign-move')
    .evaluateAll((els) => els.map((el) => el.innerText.replace(/\s+/g, ' ')));
  check(
    moves.length > 0 && moves.every((t) => /^\d{1,2}:\d{2} \S.* (\S.*さん から \S.*さん|入らない)/.test(t)),
    '4段目：担当が変わる訪問の一覧（時刻・名前・元の担当 → 新しい担当）',
    moves,
  );
  const more = panel(page).getByTestId('anneal-more');
  check(
    (await more.count()) === 1 &&
      !(await more.evaluate((el) => el.open)) &&
      !(await panel(page).locator('.anneal-weight input[type="range"]').isVisible()),
    '4段目：「変更を減らす」のスライダーは「詳しく」の中に畳む',
  );
  const d1 = await waitStored(page, (d) => !!d.reassigns?.[TODAY]);
  check(
    d1.absences.some((a) => a.staffId === best.value && a.date === TODAY && a.from === null && a.note === '発熱') &&
      d1.reassigns[TODAY].method === 'insert',
    '欠勤（終日・メモ）を登録し、今の担当が案A の振り直し',
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
    const d2 = await waitStored(page, (d) => d.reassigns?.[TODAY]?.method === 'anneal');
    check(d2.reassigns[TODAY]?.method === 'anneal', '4段目で案B を今の案にできる');
  } else {
    // 案B が案A と同じ（案A のまま）ときは表に選ぶボタンが出ないか、案A が今の案
    check((await box.textContent()).includes('案A'), '案B を作った（案A のままの知らせ）');
  }
  await page.screenshot({ path: path.join(OUT_DIR, 'step4-staff.png') });
  // 次へ：連絡（版2：確定＝伝えた内容なので、連絡の段で確定する。ADR-0053）
  await page.getByTestId('sudden-to-contacts').click();
  // 5段目：連絡（PRD D243〜D246）
  await page.locator('[data-testid="sudden-panel"][data-step="5"]').waitFor({ timeout: 10000 });
  await settle(page, 300);
  check((await stepOf(page)) === '5', '「次へ：連絡」で5段目（連絡）');
  check(
    (await page.getByTestId('sudden-confirm-note').textContent()).includes('確定'),
    '5段目：確定の状態の文',
    await page.getByTestId('sudden-confirm-note').textContent(),
  );
  check((await currentStep(page)) === '連絡・確定', '5段目の段階の名前は「連絡・確定」', await currentStep(page));
  check(
    (await page.locator('h3.sudden-step-title').textContent()) === '変更を伝えて確定する',
    '5段目の見出し「変更を伝えて確定する」',
  );
  const rows = await contactRowsOf(page);
  const removed = rows.find((r) => r.to === 'staff' && r.kinds.includes('removed'));
  check(
    !!removed &&
      /^.+さん\n\d+月\d+日（.）の予定の変更です。/.test(removed.text) &&
      /代わりました|調整中です/.test(removed.text),
    '5段目：休む人あての文（日付・「〜さんに代わりました」）',
    removed,
  );
  const added = rows.find((r) => r.to === 'staff' && r.kinds.includes('added'));
  check(!added || added.text.includes('の訪問をお願いします'), '5段目：新しく入る人あての文（お願いします）', added);
  const client = rows.find((r) => r.to === 'client');
  check(
    !client ||
      (client.text.includes('いつもお世話になっております') &&
        !/様の訪問/.test(client.text.split('\n').slice(1).join(''))),
    '5段目：〈利用者さん〉あては敬語で、ほかの〈利用者さん〉の名前を載せない',
    client,
  );
  check(
    rows.filter((r) => r.to === 'staff').every((r) => r.mail === null || r.mail.startsWith('mailto:')),
    '5段目：〈スタッフ〉あてのメールは mailto: のリンク',
    rows.map((r) => r.mail),
  );
  const total = rows.length;
  check(
    (await page.getByTestId('sudden-contacts-count').textContent()) === `連絡した 0/${total}人`,
    '5段目：連絡した数（はじめ 0）',
    await page.getByTestId('sudden-contacts-count').textContent(),
  );
  await panel(page).getByTestId('sudden-contact-sent').first().check();
  check(
    (await page.getByTestId('sudden-contacts-count').textContent()) === `連絡した 1/${total}人`,
    '5段目：［連絡した］で数が増える',
    await page.getByTestId('sudden-contacts-count').textContent(),
  );
  await panel(page).getByTestId('sudden-contact-copy').first().click();
  await page
    .locator('.toast')
    .filter({ hasText: /をコピーしました|コピーできませんでした/ })
    .first()
    .waitFor({ timeout: 5000 });
  check(true, '5段目：［文をコピー］で知らせが出る');
  await page.screenshot({ path: path.join(OUT_DIR, 'step5-staff.png') });
  // 連絡したので確定（独自の確認ダイアログ。answerConfirms が確定を押す）
  await page.getByTestId('sudden-adopt').click();
  await panel(page).waitFor({ state: 'detached', timeout: 10000 });
  const d3 = await waitStored(page, (d) => !!d.snapshots?.[TODAY]);
  check(!!d3.snapshots[TODAY], '「連絡したので確定」で伝えた内容を書く');
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
  // 差の欄の「担当が変わった訪問を見る（N件）」（PRD D296）：はじめ畳み、開くと4段目と同じ一覧で件数がそろう
  const movesBox = page.getByTestId('reassign-bar-moves');
  if ((await movesBox.count()) > 0) {
    const summaryText = await movesBox.locator('summary').innerText();
    const closed = !(await movesBox.evaluate((el) => el.open));
    await movesBox.locator('summary').click();
    const rows = await movesBox.getByTestId('reassign-move').count();
    check(
      closed && rows > 0 && summaryText.includes(`（${rows}件）`),
      '差の欄：「担当が変わった訪問を見る（N件）」ははじめ畳み、開くと N 行',
      { summaryText, rows },
    );
    await movesBox.locator('summary').click();
  } else {
    check(false, '差の欄：「担当が変わった訪問を見る」がある（振り直しで担当が変わった訪問がある）');
  }
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

// ---- 伝えた日の5段目：手で変えた訪問も連絡の一覧に出る（PR #80 のレビュー）。欠勤の振り直しも「元に戻す」で欠勤ごと戻る ----
async function toldContacts(page) {
  await page.goto(`${BASE}#/home`);
  await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
  await openPlan(page);
  // 確定（伝えた）
  await page.getByTestId('adopt').click();
  await waitStored(page, (d) => !!d.snapshots?.[TODAY]);
  // 別のタブで、伝えた訪問の1件を手で別の人に替える（ピン）
  const other = await page.context().newPage();
  await other.goto(`${BASE}#/data`);
  const moved = await other.evaluate(
    ([k, day]) => {
      const d = JSON.parse(localStorage.getItem(k));
      const v = d.visits.find((x) => x.date === day && !x.cancelled && x.staffId);
      const to = d.staff.find((s) => s.active && s.id !== v.staffId);
      v.staffId = to.id;
      v.pinned = true;
      localStorage.setItem(k, JSON.stringify(d));
      return { id: v.id, name: to.name };
    },
    [STORAGE_KEY, TODAY],
  );
  await other.close();
  await openPlan(page);
  // キャンセルを別の訪問で登録 → 5段目の連絡の一覧に、手で替えた人あての行も出る
  await page.getByTestId('sudden-open').click();
  await panel(page).waitFor();
  await page.getByTestId('sudden-kind-client').click();
  const pick = await page
    .getByTestId('sudden-visit')
    .evaluate((sel, skip) => [...sel.options].find((o) => o.value && o.value !== skip)?.value ?? '', moved.id);
  await page.getByTestId('sudden-visit').selectOption(pick);
  await page.getByTestId('sudden-next').click();
  await page.getByTestId('sudden-cancel-ok').click();
  await page.getByTestId('sudden-done').waitFor();
  await page.getByTestId('sudden-to-contacts').click();
  await page.locator('[data-testid="sudden-panel"][data-step="5"]').waitFor({ timeout: 10000 });
  const rows = await contactRowsOf(page);
  check(
    rows.some((r) => r.to === 'staff' && r.text.startsWith(moved.name) && r.kinds.includes('added')),
    '伝えた日の5段目：手で替えた訪問も連絡の一覧に出る（「連絡したので確定」で伝えたことにするもの）',
    rows.map((r) => [r.kinds, r.text.split('\n')[0]]),
  );
  await page.keyboard.press('Escape');
  await panel(page).waitFor({ state: 'detached' });

  // 欠勤を登録して振り直す → 「元に戻す」で欠勤も振り直しも戻る
  await page.goto(`${BASE}#/home`);
  await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
  await openPlan(page);
  const before = await stored(page);
  await page.getByTestId('sudden-open').click();
  await panel(page).waitFor();
  await page.getByTestId('sudden-kind-staff').click();
  const best = await busiestStaff(page);
  await page.getByTestId('sudden-staff').selectOption(best.value);
  await page.getByTestId('sudden-next').click();
  await page.getByTestId('sudden-reassign').click();
  await page.getByTestId('sudden-done').waitFor({ timeout: 10000 });
  await waitStored(page, (d) => !!d.reassigns?.[TODAY] && d.absences.length === before.absences.length + 1);
  await page.keyboard.press('Escape');
  await panel(page).waitFor({ state: 'detached' });
  // 欠勤の登録と振り直しは別の手（全体の元に戻す。PRD D329）：1回目で振り直す前（欠勤は残る）、2回目で欠勤も戻る
  await page.getByTestId('undo-btn').click();
  const mid = await waitStored(page, (d) => !d.reassigns?.[TODAY] && d.absences.length === before.absences.length + 1);
  check(
    !mid.reassigns?.[TODAY] &&
      mid.absences.length === before.absences.length + 1 &&
      JSON.stringify(mid.visits) === JSON.stringify(before.visits),
    '「登録して振り直す」のあとの「元に戻す」1回で振り直す前の担当に戻る（欠勤は残る）',
    { absences: mid.absences.length, reassign: !!mid.reassigns?.[TODAY] },
  );
  await page.getByTestId('undo-btn').click();
  const back = await waitStored(page, (d) => !d.reassigns?.[TODAY] && d.absences.length === before.absences.length);
  check(
    !back.reassigns?.[TODAY] &&
      back.absences.length === before.absences.length &&
      JSON.stringify(back.visits) === JSON.stringify(before.visits),
    'もう1回の「元に戻す」で欠勤も登録する前に戻る',
    { absences: back.absences.length, reassign: !!back.reassigns?.[TODAY] },
  );
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
  // 5段目：取り消した訪問の担当に「中止」（確定済みの日なので「次へ：連絡」、違えば確定してから）
  const toContacts = page.getByTestId('sudden-to-contacts');
  if ((await toContacts.count()) > 0) await toContacts.click();
  else await page.getByTestId('sudden-adopt').click();
  await page.locator('[data-testid="sudden-panel"][data-step="5"]').waitFor({ timeout: 10000 });
  const crow = await contactRowsOf(page);
  const owner = v.staffId ?? null;
  check(
    owner === null
      ? crow.every((r) => !r.kinds.includes('cancelled'))
      : crow.some((r) => r.to === 'staff' && r.kinds.includes('cancelled') && r.text.includes('中止です')),
    'キャンセルの5段目：担当に「中止です」（〈利用者さん〉あては作らない）',
    crow,
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'step5-cancel.png') });
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

// ---- 訪問の無い日：欠勤だけ登録できる ----
async function noPlanDay(page) {
  // 次の日の訪問を消して訪問の無い日にする（稼働する人は残る）
  await page.goto(`${BASE}#/home`);
  await page.evaluate(
    ([k, day]) => {
      const d = JSON.parse(localStorage.getItem(k));
      d.visits = d.visits.filter((v) => v.date !== day);
      d.patterns = [];
      delete d.snapshots[day];
      localStorage.setItem(k, JSON.stringify(d));
    },
    [STORAGE_KEY, NEXT],
  );
  // about:blank を挟んで開き直す（同じ文書で ?do= へ移してから読み直すと、読み直す前にアプリが ?do= を消すことがある。ADR-0029）
  await page.goto('about:blank');
  await page.goto(`${BASE}#/plan?date=${NEXT}&do=absence`);
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
  check(await page.getByTestId('sudden-no-plan').isVisible(), '訪問の無い日：「欠勤だけ登録できます」');
  const primaries = await page.locator('.drawer .btn-primary').evaluateAll((els) => els.map((e) => e.dataset.testid));
  check(
    (await page.getByTestId('sudden-reassign').count()) === 0 &&
      (await page.getByTestId('sudden-anneal').count()) === 0 &&
      JSON.stringify(primaries) === '["sudden-save-only"]',
    '訪問の無い日：押せない振り直しのボタンは出さず、「欠勤だけ登録」が主ボタン（主ボタンは1つ。PRD D264）',
    primaries,
  );
  await page.getByTestId('sudden-save-only').click();
  await panel(page).waitFor({ state: 'detached' });
  const d = await waitStored(page, (x) => x.absences.some((a) => a.staffId === v && a.date === NEXT));
  check(
    d.absences.some((a) => a.staffId === v && a.date === NEXT),
    '訪問の無い日：欠勤だけ登録する',
  );
}

/**
 * 案A で入らない見込みの日（PRD D264）：休む人の訪問の〈利用者さん〉の担当をその人だけに限ると、ほかの人へ移せず案A で
 * 入らない。そのときおすすめは案B で、主ボタン「登録して振り直す（おすすめ）」は案B も作るボタン（sudden-anneal）、
 * 「案A だけで振り直す」は文字のボタン
 */
async function recommendB(page) {
  await page.goto(`${BASE}#/home`);
  const staffId = await page.evaluate(
    ([k, day]) => {
      const d = JSON.parse(localStorage.getItem(k));
      // その日の担当ごとの〈利用者さん〉（保存した訪問の担当と、その曜日の繰り返しの担当）
      const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
      const by = new Map();
      const add = (sid, cid) => {
        if (!sid) return;
        if (!by.has(sid)) by.set(sid, new Set());
        by.get(sid).add(cid);
      };
      const own = new Set(d.visits.filter((v) => v.date === day).map((v) => v.id));
      for (const v of d.visits) if (v.date === day && !v.cancelled) add(v.staffId, v.clientId);
      for (const p of d.patterns)
        if (p.weekdays.includes(wd) && p.from <= day && (!p.to || p.to >= day) && !own.has(`${day}_${p.id}`))
          add(p.usualStaffId, p.clientId);
      const [sid, clients] = [...by.entries()].sort((a, b) => b[1].size - a[1].size)[0] ?? [];
      if (!sid) return '';
      d.clients = d.clients.map((c) => (clients.has(c.id) ? { ...c, allowedStaffIds: [sid] } : c));
      localStorage.setItem(k, JSON.stringify(d));
      return sid;
    },
    [STORAGE_KEY, DAY3],
  );
  check(!!staffId, `${DAY3} に担当の入った訪問がある`, staffId);
  if (!staffId) return;
  await page.goto('about:blank');
  await page.goto(`${BASE}#/plan?date=${DAY3}&do=absence`);
  await panel(page).waitFor({ timeout: 20000 });
  await page.getByTestId('sudden-kind-staff').click();
  await page.getByTestId('sudden-staff').selectOption(staffId);
  await page.getByTestId('sudden-next').click();
  await page.getByTestId('absence-preview').waitFor({ timeout: 30000 });
  await page.getByTestId('plan-progress').waitFor({ state: 'detached', timeout: 60000 });
  await settle(page, 400);
  const st = {
    recommended: await page.getByTestId('anneal-suggest').evaluate((el) => el.classList.contains('is-recommended')),
    primaries: await page.locator('.drawer .btn-primary').evaluateAll((els) => els.map((e) => e.dataset.testid)),
    primaryText: await page.locator('.drawer-foot .btn-primary').textContent(),
    alt: await page
      .getByTestId('sudden-alt')
      .locator('button')
      .evaluateAll((els) => els.map((e) => [e.dataset.testid, e.classList.contains('btn-text'), e.textContent])),
    note: await page.getByTestId('sudden-recommend').textContent(),
  };
  check(
    st.recommended &&
      JSON.stringify(st.primaries) === '["sudden-anneal"]' &&
      st.primaryText.includes('登録して振り直す（おすすめ）') &&
      st.alt.some(([id, text, label]) => id === 'sudden-reassign' && text && label.includes('案A だけ')) &&
      /案B も作って比べます/.test(st.note),
    '案A で入らない見込み：おすすめは案B で、主ボタンは案B も作る（sudden-anneal）・案A だけは文字のボタン',
    st,
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'step3-recommend-b.png') });
  await page.keyboard.press('Escape');
  await panel(page).waitFor({ state: 'detached' });
}

// ---- 390px・印刷 ----
async function mobile(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPlan(page);
  const b = await page.getByTestId('sudden-open').boundingBox();
  check(b && b.x >= 0 && b.x + b.width <= 390, '390px：入口のボタンが画面に収まる', b);
  const tabs = await page.getByTestId('bottom-tabs').locator('.bottom-tab').allTextContents();
  check(
    JSON.stringify(tabs.map((t) => t.trim())) === JSON.stringify(['ホーム', '予定', '欠勤', '探す', 'メニュー']),
    '390px：下のタブは5つ（欠勤のタブがある。PRD D336）',
    tabs,
  );
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
  const foot = await page.locator('.drawer-foot .btn-primary').boundingBox();
  check(
    foot && foot.x >= 0 && foot.x + foot.width <= 390 && foot.y + foot.height <= 844,
    '390px：主ボタンが画面の中',
    foot,
  );
  const sw = await page.evaluate(() => document.querySelector('.drawer-body').scrollWidth);
  const cw = await page.evaluate(() => document.querySelector('.drawer-body').clientWidth);
  check(sw <= cw, '390px：欄の中が横にはみ出さない', { sw, cw });
  await page.screenshot({ path: path.join(OUT_DIR, 'mobile-step3.png') });
  // 4段目：担当が変わる訪問の一覧が 390px でも欄に収まって見える（PRD D265）
  if (!(await page.locator('.drawer-foot .btn-primary').isDisabled())) {
    await page.locator('.drawer-foot .btn-primary').click();
    await page.locator('[data-testid="sudden-panel"][data-step="4"]').waitFor({ timeout: 60000 });
    const list = panel(page).getByTestId('reassign-moves');
    await list.waitFor({ timeout: 30000 }).catch(() => {});
    const lb = await list.boundingBox();
    const sw4 = await page.evaluate(() => document.querySelector('.drawer-body').scrollWidth);
    const cw4 = await page.evaluate(() => document.querySelector('.drawer-body').clientWidth);
    check(
      !!lb && lb.x >= 0 && lb.x + lb.width <= 390 && sw4 <= cw4,
      '390px：4段目の担当が変わる訪問の一覧が欄に収まる',
      { lb, sw4, cw4 },
    );
    await page.screenshot({ path: path.join(OUT_DIR, 'mobile-step4.png') });
  }
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
    // 390px の既定は日ごとのリスト（ADR-0055）。列の見出しは「その他 ▾」の「表示」で順番にして見る
    if (w <= 600) {
      await page.getByTestId('plan-more').click();
      await page.getByTestId('plan-view-order').click();
      await page.locator('.absence-btn').first().waitFor();
    }
    const got = await measure();
    check(
      got.length > 0 && got.every((x) => x.lines >= 1 && x.lines <= max && x.fits),
      `${w}px：列の見出しは「この人の欠勤を登録」で${max === 1 ? '1行' : '2行まで'}・列に収まる`,
      got.slice(0, 3),
    );
  }
  await page.setViewportSize({ width: 1400, height: 1000 });
}

/** その日の日の予定で、いちばん訪問の多い人の欠勤を登録して振り直す（欄を閉じる） */
async function reassignHere(page) {
  await page.getByTestId('sudden-open').click();
  await panel(page).waitFor();
  await page.getByTestId('sudden-kind-staff').click();
  const who = await busiestStaff(page);
  await page.getByTestId('sudden-staff').selectOption(who.value);
  await page.getByTestId('sudden-next').click();
  await page.getByTestId('sudden-reassign').click();
  await page.getByTestId('sudden-done').waitFor({ timeout: 10000 });
  await page.keyboard.press('Escape');
  await panel(page).waitFor({ state: 'detached' });
  await settle(page, 300);
  return who;
}
/** ナビの行の日付の選択で日を替える（PRD D347）（読み直さない＝全体の元に戻すの履歴は残る） */
async function pickDate(page, date) {
  await page.locator('.date-switch select[aria-label="日付"]').selectOption(date);
  await waitPlan(page);
}

// ---- 「振り直す前に戻す」は別の日の振り直しのあとでは近道で戻さない・欠勤を取り消した知らせから戻す（PR #81 のレビュー） ----
async function revertCases(page, st) {
  await page.goto(`${BASE}#/home`);
  await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
  await openPlan(page);
  const day2 = await page
    .locator('.date-switch select[aria-label="日付"] option')
    .evaluateAll((os, t) => os.map((o) => o.value).find((v) => v > t) ?? '', TODAY);
  await reassignHere(page);
  await waitStored(page, (d) => !!d.reassigns?.[TODAY]);
  await pickDate(page, day2);
  const who2 = await reassignHere(page);
  await waitStored(page, (d) => !!d.reassigns?.[day2]);
  // 今日へ戻って「振り直す前に戻す」：直前の手は別の日の振り直しなので、確かめてから今日だけ戻す
  await pickDate(page, TODAY);
  const seen = st.messages.length;
  await page.locator('.plan-main').getByRole('button', { name: '振り直す前に戻す' }).first().click();
  const back = await waitStored(page, (d) => !d.reassigns?.[TODAY]);
  check(
    !back.reassigns?.[TODAY] && !!back.reassigns?.[day2] && back.absences.length === 2,
    '別の日の振り直しのあとの「振り直す前に戻す」は、その日だけ戻す（別の日の振り直し・欠勤はそのまま）',
    { today: !!back.reassigns?.[TODAY], day2: !!back.reassigns?.[day2], absences: back.absences.length },
  );
  check(
    st.messages.slice(seen).some((m) => m.includes('振り直す前の担当に戻しますか？')),
    '近道で戻せないときは確かめてから戻す',
    st.messages.slice(seen),
  );
  // 振り直した日の欠勤を取り消す → 知らせの「振り直す前に戻す」で担当が戻る（欠勤は戻らない）
  await pickDate(page, day2);
  const btn = page.locator(`.route-col[data-staff="${who2.value}"] .absence-btn`).first();
  await btn.click();
  await panel(page).waitFor();
  await page.getByTestId('sudden-next').click();
  await page.getByTestId('sudden-remove').click();
  await panel(page).waitFor({ state: 'detached', timeout: 10000 });
  const revert = page.getByTestId('toast-revert');
  await revert.waitFor({ timeout: 5000 });
  const tt = await page.locator('.toast').innerText();
  check(
    /振り直す前に戻す/.test(tt) && !/「元に戻す」/.test(tt),
    '欠勤の取り消しの知らせは「振り直す前に戻す」を案内する',
    tt,
  );
  await revert.click();
  const after = await waitStored(page, (d) => !d.reassigns?.[day2]);
  check(
    !after.reassigns?.[day2] && after.absences.length === 1,
    '知らせの「振り直す前に戻す」で担当が戻り、取り消した欠勤は戻らない',
    { day2: !!after.reassigns?.[day2], absences: after.absences.length },
  );
}

let best = null;
const steps = sharedPage({
  open: async () => {
    const s = await openPage();
    // 確認ダイアログには確定で答える（ブラウザの確認が出たら st.native に入る）
    return { ...s, st: await answerConfirms(s.page) };
  },
  steps: [
    [
      'from-home',
      async (page) => {
        best = await fromHome(page);
      },
    ],
    ['reopen-focus', (page) => (best ? reopenFocus(page, best) : check(false, 'reopen-focus：前の段が通らない'))],
    ['same-day-cancel', sameDayCancel],
    ['from-header', (page) => (best ? fromHeader(page, best) : check(false, 'from-header：前の段が通らない'))],
    ['no-plan', noPlanDay],
    ['recommend-b', recommendB],
    ['mobile', mobile],
    ['header-label', headerLabel],
    ['told-contacts', toldContacts],
    ['revert-cases', revertCases],
  ],
  call: (fn, s) => fn(s.page, s.st),
  after: ({ st }) => {
    check(
      st.messages.some((m) => m.includes('確定しますか？')) &&
        st.messages.some((m) => m.includes('欠勤を取り消しますか？')),
      '確定・欠勤の取り消しは独自の確認ダイアログで確かめる',
      st.messages,
    );
    check(st.native.length === 0, 'ブラウザのダイアログを出さない', st.native);
  },
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
