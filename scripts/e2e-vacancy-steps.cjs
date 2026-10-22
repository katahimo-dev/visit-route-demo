// 空き状況の段階（PRD D184〜D187。ADR-0025 追記。UI/UX 改善の区切り8a）を本物のブラウザで確かめる：
// 段階の並び（1 いつ・何を → 2 場所（任意。畳む）→ 3 受けられる曜日・時間帯 → 4 次の一手）、開いてすぐ結果（PERF_MS 以内）、
// 1段目を変えるとすぐ結果が変わる、場所をあとから足すと表が移動を含む値になり、畳んでも入力・ピンが残る、
// 主ボタンは段階ごとに1つ（4段目の「要約をコピー」だけ）、マスの読み方（凡例・用語の説明・×に「約0」を出さない・読み上げ）、
// × のマスは薄い灰で赤くしない・色の凡例「0人（受けられない）」（PRD D228）、
// 案の無い日の注意は1か所、案内文ははじめ畳み開くまで計算しない、仮押さえ、390px で収まる、ブラウザの確認を出さない。
// 答えのカードが結果の1枚目・凡例は1か所・「指定なし」・入力はタブの間だけ残る・その場で［担当なしを AI で組む（N日）］（PRD D258・D259）。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-vacancy-steps.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）。PERF_MS_VACANCY で結果が出るまでの上限（既定 5000ms。PRD §5。無ければ PERF_MS）
// 外部の検索（国土地理院）は page.route の偽の応答に差し替え、外へは出さない。地図のタイルは取りに行かない
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { skipTour } = require('./lib/tourSeen.cjs');
const {
  launch,
  BASE,
  OUT_DIR,
  NOW,
  TODAY,
  STORAGE_KEY,
  perfMs,
  check,
  watchErrors,
  runSteps,
  settle,
} = require('./lib/env.cjs');
const { guard, closeContext, firstLine, message } = require('./lib/steps.cjs');

const PERF_MS = perfMs('PERF_MS_VACANCY', 5000);

const GSI_ONE = [
  {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [140.8716, 38.2601] },
    properties: { title: '宮城県仙台市青葉区一番町一丁目' },
  },
];

/** 国土地理院の住所検索は偽の応答。地図のタイルは取りに行かない（外へ出さない） */
async function fakeServices(page) {
  await page.route(/msearch\.gsi\.go\.jp/, async (route) => {
    const cb = new URL(route.request().url()).searchParams.get('callback');
    await route.fulfill({
      status: 200,
      contentType: cb ? 'text/javascript' : 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: cb ? `${cb}(${JSON.stringify(GSI_ONE)})` : JSON.stringify(GSI_ONE),
    });
  });
  await page.route(/zipcloud\.ibsnet\.co\.jp/, (route) => route.abort('failed'));
  await page.route(/tile\.openstreetmap|cyberjapandata|\.png(\?|$)/, (route) => route.abort('failed'));
}

const visible = async (loc) => (await loc.count()) > 0 && (await loc.first().isVisible());
const title3 = (page) => page.getByTestId('vacancy-table-card').locator('.section-title').first().textContent();
const gridText = (page) => page.getByTestId('vacancy-grid').textContent();
/** 見えている主ボタンの数（root の中） */
const primaries = (loc) =>
  loc.locator('.btn-primary').evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length);

/** 開いて、表と要約が出るまでの時間（ms） */
async function openVacancy(page) {
  await page.goto(`${BASE}#/`);
  const t0 = Date.now();
  await page.evaluate(() => {
    location.hash = '#/vacancy';
  });
  await page.getByTestId('vacancy-grid').waitFor({ timeout: 30000 });
  await page.getByTestId('inquiry-summary').waitFor({ timeout: 30000 });
  return Date.now() - t0;
}

async function steps(page) {
  const ms = await openVacancy(page);
  check(ms <= PERF_MS, `開いて受けられる曜日・時間帯が出るまで ${PERF_MS}ms 以内（PRD §5）`, `${ms}ms`);
  // 段階の並び
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('.vacancy-page > .vacancy-stage')].map((e) => e.dataset.testid),
  );
  check(
    JSON.stringify(order) ===
      JSON.stringify(['vacancy-step-when', 'vacancy-step-place', 'vacancy-table-card', 'vacancy-step-next']),
    '段階の並び：いつ・何を → 場所 → 受けられる曜日・時間帯 → 次の一手',
    order,
  );
  const heads = await page.evaluate(() =>
    [...document.querySelectorAll('.vacancy-step-no')].map((e) => e.textContent.replace('.', '')),
  );
  check(JSON.stringify(heads) === '["1","2","3","4"]', '段階の番号 1〜4', heads);
  // 1段目に いつ・何を の入力がまとまっている
  const when = page.getByTestId('vacancy-step-when');
  check(
    (await when.getByTestId('vacancy-type').count()) === 1 &&
      (await when.getByTestId('vacancy-duration').count()) === 1 &&
      (await when.getByTestId('wish-days').count()) === 1 &&
      (await when.getByTestId('wish-from').count()) === 1 &&
      (await when.locator('input[type="date"]').count()) === 1,
    '1段目に 種類・所要・曜日・時間帯・開始日',
  );
  check((await primaries(when)) === 0, '1段目は自動で計算するので主ボタンなし');
  // 2段目は畳んで要約の行
  const place = page.getByTestId('vacancy-step-place');
  check((await place.getAttribute('open')) === null, '2段目（場所）ははじめ畳む');
  check(!(await visible(page.getByTestId('vacancy-place'))), '畳んでいる間は郵便番号・住所・地図を出さない');
  const line = await page.getByTestId('vacancy-place-line').textContent();
  check(/場所を入れると移動も含めて絞り込めます/.test(line), '場所の要約の行', line);
  check(/目安/.test(await title3(page)), '場所が空なら結果は目安', await title3(page));
  // 4段目：主ボタンは「要約をコピー」の1つ。仮押さえ・案内文のコピーは主ボタンにしない
  const next = page.getByTestId('vacancy-step-next');
  check((await primaries(next)) === 1, '4段目の主ボタンは1つ');
  check(
    (await page.getByTestId('copy-summary').getAttribute('class')).includes('btn-primary'),
    '主ボタンは「要約をコピー」',
  );
  if ((await page.getByTestId('hold-open').count()) > 0) {
    check(
      !(await page.getByTestId('hold-open').getAttribute('class')).includes('btn-primary'),
      '仮押さえは主ボタンにしない',
    );
  }
  check((await primaries(page.locator('.vacancy-page'))) === 1, '画面全体でも見えている主ボタンは1つ');
  // 案内文ははじめ畳み、開くまで計算しない
  check((await page.getByTestId('notice-card').getAttribute('open')) === null, '案内文の欄ははじめ畳む');
  check(/来週・種類の指定なし（60分）/.test(await page.getByTestId('notice-line').textContent()), '案内文の要約の行');
  await settle(page, 600);
  check((await page.getByTestId('notice-text').count()) === 0, '畳んでいる間は案内文を計算しない');
  await page.getByTestId('notice-toggle').click();
  await page.getByTestId('notice-text').waitFor({ timeout: 10000 });
  check(/〜/.test(await page.getByTestId('notice-text').textContent()), '開くと案内文が出る');
  check(
    !(await page.getByTestId('copy-notice').getAttribute('class')).includes('btn-primary') &&
      (await visible(page.getByTestId('notice-mail'))),
    '案内文のコピー・紹介元へメールは開いた中（主ボタンにしない）',
  );
  check((await primaries(page.locator('.vacancy-page'))) === 1, '案内文を開いても主ボタンは1つ');
  // 古い案内文を出さない（PR #44 のレビュー）：開く → 畳む → 条件を変える → 開き直すと、前の文は出さず計算し直してから押せる
  const oldText = await page.getByTestId('notice-text').textContent();
  await page.getByTestId('notice-toggle').click();
  await settle(page, 100);
  check((await page.getByTestId('notice-text').count()) === 0, '畳んだら古い案内文を捨てる');
  await page.getByTestId('vacancy-duration').fill('120');
  await settle(page, 500);
  await page.getByTestId('notice-toggle').click();
  const early = await page.evaluate(() => ({
    text: document.querySelector('[data-testid="notice-text"]')?.textContent ?? null,
    copy: document.querySelector('[data-testid="copy-notice"]')?.disabled ?? null,
  }));
  check(
    early.text === null || (early.text !== oldText && early.copy === false),
    '開き直した直後に前の文を出さない',
    early,
  );
  await page.getByTestId('notice-text').waitFor({ timeout: 10000 });
  const newText = await page.getByTestId('notice-text').textContent();
  check(
    newText !== oldText && /120分/.test(await page.getByTestId('notice-line').textContent()),
    '開き直すと今の条件で作り直す',
  );
  check(!(await page.getByTestId('copy-notice').isDisabled()), '作り直したらコピーを押せる');
  // 開いたまま期間を変えると、計算し直すまでコピーとメールを押せない
  await page.getByTestId('notice-period').getByRole('button', { name: '今週' }).click();
  const busy = await page.evaluate(() => ({
    copy: document.querySelector('[data-testid="copy-notice"]')?.disabled,
    mail: [...document.querySelectorAll('[data-testid="notice-mail-open"]')].map(
      (e) => e.tagName === 'A' && e.getAttribute('aria-disabled') !== 'true',
    ),
  }));
  check(busy.copy === true && busy.mail.every((x) => !x), '計算し直すまでコピー・メールを押せない', busy);
  await page.waitForFunction(() => !document.querySelector('[data-testid="copy-notice"]')?.disabled, null, {
    timeout: 10000,
  });
  check(true, '計算し直したらコピーを押せる');
  await page.getByTestId('vacancy-duration').fill('60');
  await page.getByTestId('notice-toggle').click();
  // 見出しの並び（PR #44 のレビュー）：段階は h2 で4つ、「開く ▾」は読み上げに入れない
  const hs = await page.evaluate(() => ({
    h2: [...document.querySelectorAll('.vacancy-page .vacancy-stage h2')].map((e) => e.textContent.trim().slice(0, 4)),
    h3: !!document.querySelector('[data-testid="notice-toggle"] h3'),
    hidden: [...document.querySelectorAll('.vacancy-fold-mark')].every((e) => e.getAttribute('aria-hidden') === 'true'),
    after: getComputedStyle(document.querySelector('[data-testid="vacancy-place-toggle"]'), '::after').content,
  }));
  check(
    hs.h2.length === 4 && /^2/.test(hs.h2[1]) && hs.h3 && hs.hidden && (hs.after === 'none' || hs.after === 'normal'),
    '場所の見出しも h2・案内文は h3・「開く ▾」は aria-hidden',
    hs,
  );
  // 案の無い日の注意は1か所（PRD D176）
  check((await page.locator('.vacancy-noplan').count()) <= 1, '案の無い日の注意は1か所');

  // 1段目を変えるとすぐ結果が変わる
  const before = await page.getByTestId('inquiry-summary').textContent();
  const t0 = Date.now();
  await page.getByTestId('wish-days').getByRole('button', { name: '火' }).click();
  await page.waitForFunction(
    (b) => document.querySelector('[data-testid="inquiry-summary"]')?.textContent !== b,
    before,
    { timeout: PERF_MS },
  );
  const ms2 = Date.now() - t0;
  check(ms2 <= PERF_MS, `曜日を選ぶと ${PERF_MS}ms 以内に結果が変わる`, `${ms2}ms`);
  check(/火/.test(await page.getByTestId('vacancy-when-line').textContent()), '結果の上に いつ・何を の要約（火）');
  await page.screenshot({ path: path.join(OUT_DIR, 'vacancy-steps-1280.png'), fullPage: true });
}

async function marks(page) {
  await openVacancy(page);
  await settle(page, 500);
  const legend = await page
    .getByTestId('vacancy-mark-legend')
    .locator('li')
    .evaluateAll((els) => els.map((e) => e.textContent));
  check(
    legend.length === 4 &&
      /○.*どの週も受けられる/.test(legend[0]) &&
      /△.*受けられない週がある/.test(legend[1]) &&
      /×.*受けられない/.test(legend[2]) &&
      /？.*数えられない日/.test(legend[3]),
    'マスの読み方の凡例（○△×？）',
    legend,
  );
  check(!/約0/.test(await gridText(page)), 'マスに「約0」を出さない');
  const faces = await page.getByTestId('vacancy-cell').evaluateAll((els) =>
    els.map((e) => ({
      v: e.dataset.verdict,
      sub: e.querySelector('.vacancy-count')?.textContent ?? '',
      label: e.getAttribute('aria-label') ?? '',
    })),
  );
  const ng = faces.filter((f) => f.v === 'ng');
  const ok = faces.filter((f) => f.v === 'ok');
  const pa = faces.filter((f) => f.v === 'partial');
  check(
    ng.every((f) => f.sub === '' && /受けられない/.test(f.label)),
    '× は数字なし・読み上げは「受けられない」',
    ng.length,
  );
  // × のマスは薄い灰（赤は要対応だけ。PRD D228）
  const ngColors = await page.locator('[data-testid="vacancy-cell"][data-verdict="ng"].lv-none').evaluateAll((els) =>
    els.map((e) => {
      const cs = getComputedStyle(e);
      const [r, g, b] = (cs.backgroundColor.match(/\d+/g) ?? []).map(Number);
      return { bg: cs.backgroundColor, shadow: cs.boxShadow, reddish: r - Math.min(g, b) > 40 };
    }),
  );
  check(
    ngColors.length > 0 && ngColors.every((c) => !c.reddish && !/rgb\((184|210), (57|63)/.test(c.shadow)),
    '× のマスは薄い灰（赤の地・赤の枠にしない）',
    ngColors.slice(0, 2),
  );
  const levelLegend = await page.getByTestId('level-legend').innerText();
  check(/0人（受けられない）/.test(levelLegend), '色の凡例「0人（受けられない）」', levelLegend);
  check(
    ok.every((f) => /^約\d+$/.test(f.sub) && /どの週でも 約\d+人/.test(f.label)),
    '○ は人数（目安は「約」）',
    ok.length,
  );
  check(
    pa.every((f) => /^\d+\/\d+$/.test(f.sub) && /受けられる週/.test(f.label)),
    '△ は受けられる週の数',
    pa.length,
  );
  // 用語の説明（区切り6の部品）
  const term = page.getByTestId('term-vacancy-count');
  check((await term.count()) === 1 && /受けられる人数/.test(await term.textContent()), '「受けられる人数」の用語');
  await term.hover();
  await settle(page, 300);
  const tip = await page.locator('[role="tooltip"]:visible').first().textContent();
  check(/いちばん少ない週の数/.test(tip ?? ''), '用語の説明が出る', tip);
  await page.mouse.move(5, 5);
  check((await page.getByTestId('term-vacancy-estimate').count()) === 1, '場所が無いときは「目安（約）」の用語');
}

/** YYYY-MM-DD に n 日足す */
const plusDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// ---- 答えのカード・凡例・指定なし・入力の保持・担当なしを AI で組む（PRD D258・D259）----
async function answer(page) {
  await openVacancy(page);
  await settle(page, 500);
  const card = page.getByTestId('vacancy-answer');
  const text = await card.innerText();
  check(
    /^(受けられます|週\d回には足りません|受けられない週があります|受けられません|案が無く数えられません)/.test(text),
    '結果の1枚目に答えのカード',
    text,
  );
  const order = await page.evaluate(() => {
    const box = document.querySelector('[data-testid="vacancy-table-card"]');
    const a = box.querySelector('[data-testid="vacancy-answer"]');
    const s = box.querySelector('[data-testid="inquiry-summary"]');
    const g = box.querySelector('[data-testid="vacancy-grid"]');
    const F = Node.DOCUMENT_POSITION_FOLLOWING;
    return !!a && !!s && !!g && (a.compareDocumentPosition(s) & F) !== 0 && (a.compareDocumentPosition(g) & F) !== 0;
  });
  check(order, '答えのカードは要約・表より前');
  if ((await card.getAttribute('data-tone')) === 'ok') {
    check(/^受けられます：.+ に (約)?\d+(〜\d+)?人/.test(text), '答え：曜日・時間と人数', text);
  }
  // 凡例は1か所（印・色・読み方をひとまとめ）
  const legends = await page.evaluate(() => ({
    level: document.querySelectorAll('[data-testid="level-legend"]').length,
    mark: document.querySelectorAll('[data-testid="vacancy-mark-legend"]').length,
    inBox:
      !!document.querySelector('[data-testid="vacancy-legend"] [data-testid="level-legend"]') &&
      !!document.querySelector('[data-testid="vacancy-legend"] [data-testid="vacancy-mark-legend"]'),
    weeksNote: /行の頭は、希望の時間帯の中で/.test(document.querySelector('.vacancy-page').textContent),
  }));
  check(
    legends.level === 1 && legends.mark === 1 && legends.inBox && !legends.weeksNote,
    '凡例は1か所（印・色・読み方）',
    legends,
  );
  // 「種類なし」→「指定なし」
  const first = await page.getByTestId('vacancy-type').locator('option').first().innerText();
  check(first === '指定なし', '種類を選ばないときは「指定なし」', first);
  await page.screenshot({ path: path.join(OUT_DIR, 'vacancy-answer-1280.png'), fullPage: true });

  // 入力はタブの間だけ残る（画面を移って戻る・読み直す。新しいタブは既定）
  await page.getByTestId('vacancy-duration').fill('90');
  await page.getByTestId('wish-days').getByRole('button', { name: '木' }).click();
  await settle(page, 400);
  await page.evaluate(() => {
    location.hash = '#/home';
  });
  await page.locator('h1').first().waitFor();
  await page.evaluate(() => {
    location.hash = '#/vacancy';
  });
  await page.getByTestId('vacancy-duration').waitFor();
  const kept = {
    duration: await page.getByTestId('vacancy-duration').inputValue(),
    thu: await page.getByTestId('wish-days').getByRole('button', { name: '木' }).getAttribute('aria-pressed'),
  };
  check(kept.duration === '90' && kept.thu === 'true', '画面を移って戻っても入力が残る', kept);
  const other = await page.context().newPage();
  await other.clock.setFixedTime(NOW);
  await other.goto(`${BASE}#/vacancy`);
  await other.getByTestId('vacancy-duration').waitFor({ timeout: 30000 });
  check(
    (await other.getByTestId('vacancy-duration').inputValue()) === '60',
    '新しいタブ（閉じて開き直す）は既定の入力',
  );
  await other.close();

  // その場で担当なしの日を組む（PRD D259）：1週だけ見て、2日の訪問の担当を外す
  await page.getByLabel('見る週の数').selectOption('1');
  // 外す2日は、今日から1週の中で担当のある保存した訪問がある日から選ぶ（FAKE_NOW の曜日・月末に依らない）
  const gone = await page.evaluate(
    ({ key, days }) => {
      const d = JSON.parse(localStorage.getItem(key));
      return days
        .filter((x) => !d.snapshots[x] && d.visits.some((v) => v.date === x && !v.cancelled && v.staffId))
        .slice(0, 2);
    },
    { key: STORAGE_KEY, days: Array.from({ length: 7 }, (_, i) => plusDays(TODAY, i)) },
  );
  check(gone.length === 2, '担当を外す2日がある', gone);
  await page.evaluate(
    ({ key, gone }) => {
      const d = JSON.parse(localStorage.getItem(key));
      d.visits = d.visits.map((v) => (gone.includes(v.date) ? { ...v, staffId: null, pinned: false } : v));
      localStorage.setItem(key, JSON.stringify(d));
    },
    { key: STORAGE_KEY, gone },
  );
  await page.reload();
  const make = page.getByTestId('vacancy-noplan-make');
  await make.waitFor({ timeout: 30000 });
  check((await page.getByTestId('vacancy-duration').inputValue()) === '90', '読み直しても入力が残る（同じタブ）');
  const label = await make.innerText();
  const n = Number(/担当なしを AI で組む（(\d+)日）/.exec(label)?.[1] ?? 0);
  check(n >= 2, '［担当なしを AI で組む（N日）］', label);
  await make.click();
  await page.getByTestId('batch-band').waitFor({ timeout: 10000 });
  check(
    new RegExp(`月の担当を組んでいます \\d+/${n}日`).test(await page.getByTestId('batch-band-text').innerText()),
    '上の帯に進み具合',
  );
  // disabled にせず aria-disabled（フォーカスを失わない）。押しても始めない（Playwright は aria-disabled を押さないので直接送る）
  await make.dispatchEvent('click');
  check(
    (await make.getAttribute('aria-disabled')) === 'true' && /の担当を組んでいます/.test(await make.innerText()),
    '組んでいる間は押せない（二重に始めない）',
    await make.innerText(),
  );
  await page
    .locator('.toast')
    .filter({ hasText: new RegExp(`月の提案を出しました（${n}日分`) })
    .waitFor({ timeout: 90000 });
  check(true, '組み終えたら知らせ（◯月の提案を出しました（N日分…））');
  // 提案の帯（日・週・月の予定と同じ形。PRD D328）：当てると担当が入る
  const band = page.locator('[data-testid="proposal-band"][data-kind="range"]');
  await band.waitFor({ timeout: 10000 });
  check(true, '空き状況にも提案の帯が出る');
  await band.getByTestId('proposal-apply').click();
  await band.waitFor({ state: 'detached', timeout: 10000 });
  const left = await page
    .getByTestId('vacancy-noplan-make')
    .getAttribute('data-count', { timeout: 5000 })
    .catch(() => null);
  check(left === null || Number(left) < n, '組むと担当なしの日が減る（結果を数え直す）', { n, left });
}

async function placeLater(page) {
  await openVacancy(page);
  await settle(page, 500);
  const gridBefore = await gridText(page);
  await page.getByTestId('vacancy-place-toggle').click();
  await page.getByTestId('vacancy-place').waitFor();
  check(await visible(page.getByTestId('vacancy-address')), '「2 場所」を開くと住所を入れられる');
  await page.getByTestId('vacancy-address').fill('宮城県仙台市青葉区一番町1-1');
  await page.getByTestId('vacancy-geo-search').click();
  await page.waitForFunction(
    () =>
      /への移動を含む/.test(
        document.querySelector('[data-testid="vacancy-table-card"] .section-title')?.textContent ?? '',
      ),
    null,
    { timeout: 10000 },
  );
  await page.waitForFunction(
    () => !/約/.test(document.querySelector('[data-testid="vacancy-grid"]')?.textContent ?? '約'),
    null,
    { timeout: 10000 },
  );
  check(/一番町1-1への移動を含む/.test(await title3(page)), '場所を入れると見出しが「移動を含む」', await title3(page));
  check(!/約/.test(await gridText(page)) && (await gridText(page)) !== gridBefore, '場所を入れると表が更新される');
  check(!(await visible(page.getByTestId('term-vacancy-estimate'))), '場所があれば「目安」の用語は出さない');
  // 畳んでも入力・ピンは残り、要約の行に場所
  await page.getByTestId('vacancy-place-toggle').click();
  await settle(page, 200);
  const line = await page.getByTestId('vacancy-place-line').textContent();
  check(/一番町1-1（移動を含めて数えています）/.test(line), '畳むと要約の行に場所', line);
  check(/への移動を含む/.test(await title3(page)), '畳んでも結果は移動を含むまま');
  await page.getByTestId('vacancy-place-toggle').click();
  check(
    (await page.getByTestId('vacancy-address').inputValue()) === '宮城県仙台市青葉区一番町1-1' &&
      /38\.26/.test(await page.getByTestId('vacancy-place').getByTestId('place-pin-text').textContent()),
    '開き直しても住所とピンは残る',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'vacancy-place-1280.png'), fullPage: true });
  // 仮押さえ（4段目から）：場所も写る
  if ((await page.getByTestId('hold-open').count()) === 0) {
    check(/仮押さえは/.test(await page.getByTestId('hold-why').textContent()), '仮押さえできないときは理由');
    return;
  }
  await page.getByTestId('hold-open').click();
  await page.getByTestId('hold-name').fill('段階 確認さん');
  await page.getByTestId('hold-register').click();
  await settle(page, 600);
  const c = await page.evaluate(
    (k) => JSON.parse(localStorage.getItem(k)).clients.find((x) => x.displayName === '段階 確認さん'),
    STORAGE_KEY,
  );
  check(c && c.tentative === true && c.place.lat === 38.2601, '仮押さえで仮の利用者さんと場所が入る', c?.place);
}

async function narrow(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await openVacancy(page);
  await settle(page, 500);
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  check(scrollW <= 390, '390px：ページが横にはみ出さない（表は表の中で巻く）', scrollW);
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll('.vacancy-page > .vacancy-stage')].map((e) => {
      const r = e.getBoundingClientRect();
      return { id: e.dataset.testid, left: Math.round(r.left), right: Math.round(r.right) };
    }),
  );
  check(boxes.length === 4 && boxes.every((b) => b.left >= 0 && b.right <= 390), '390px：4つの段階が幅に収まる', boxes);
  const sum = await page.getByTestId('vacancy-place-toggle').boundingBox();
  check(sum && sum.height <= 110, '390px：畳んだ場所は短い要約の行', sum);
  const copy = await page.getByTestId('copy-summary').boundingBox();
  check(copy && copy.x >= 0 && copy.x + copy.width <= 390, '390px：主ボタンが収まる', copy);
  await page.screenshot({ path: path.join(OUT_DIR, 'vacancy-steps-390.png'), fullPage: true });
  await page.getByTestId('vacancy-place-toggle').click();
  await page.getByTestId('vacancy-place').waitFor();
  const scrollW2 = await page.evaluate(() => document.documentElement.scrollWidth);
  check(scrollW2 <= 390, '390px：場所を開いてもはみ出さない', scrollW2);
  await page.screenshot({ path: path.join(OUT_DIR, 'vacancy-place-390.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
}

let b = null;
/** 段ごとに新しい文脈を開く（ブラウザの確認・知らせは出さない。PRD D146） */
const fresh = (name, fn) => async () => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  // 初回の案内ツアーを見た扱いにする（PRD D193）
  await skipTour(ctx);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  watchErrors(page);
  page.on('dialog', async (d) => {
    check(false, 'ブラウザの確認を出さない', d.message());
    await d.dismiss();
  });
  await fakeServices(page);
  await guard(() => fn(page), { label: name, info: (e) => firstLine(message(e)), page: () => page })();
  await closeContext(ctx);
};
// 段の関数に steps があるので、並びは allSteps と呼ぶ
const allSteps = [
  [
    '準備',
    async () => {
      b = await launch();
    },
  ],
  ...[
    ['steps', steps],
    ['marks', marks],
    ['answer', answer],
    ['place-later', placeLater],
    ['narrow', narrow],
  ].map(([name, fn]) => [name, fresh(name, fn)]),
];

module.exports = { steps: allSteps };
if (require.main === module) runSteps(allSteps);
