// 空き状況の段階（PRD D184〜D187。ADR-0025 追記。UI/UX 改善の区切り8a）を本物のブラウザで確かめる：
// 段階の並び（1 いつ・何を → 2 場所（任意。畳む）→ 3 受けられる曜日・時間帯 → 4 次の一手）、開いてすぐ結果（PERF_MS 以内）、
// 1段目を変えるとすぐ結果が変わる、場所をあとから足すと表が移動を含む値になり、畳んでも入力・ピンが残る、
// 主ボタンは段階ごとに1つ（4段目の「要約をコピー」だけ）、マスの読み方（凡例・用語の説明・×に「約0」を出さない・読み上げ）、
// × のマスは薄い灰で赤くしない・色の凡例「0人（受けられない）」（PRD D228）、
// 案の無い日の注意は1か所、案内文ははじめ畳み開くまで計算しない、仮押さえ、390px で収まる、ブラウザの確認を出さない。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-vacancy-steps.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）。PERF_MS_VACANCY で結果が出るまでの上限（既定 5000ms。PRD §5。無ければ PERF_MS）
// 外部の検索（国土地理院）は page.route の偽の応答に差し替え、外へは出さない。地図のタイルは取りに行かない
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { skipTour } = require('./lib/tourSeen.cjs');
const { launch, BASE, OUT_DIR, NOW, STORAGE_KEY, perfMs, check, failShot, run } = require('./lib/env.cjs');

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
  check(/来週・種類なし（60分）/.test(await page.getByTestId('notice-line').textContent()), '案内文の要約の行');
  await page.waitForTimeout(600);
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
  await page.waitForTimeout(100);
  check((await page.getByTestId('notice-text').count()) === 0, '畳んだら古い案内文を捨てる');
  await page.getByTestId('vacancy-duration').fill('120');
  await page.waitForTimeout(500);
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
  await page.waitForTimeout(500);
  const legend = await page
    .getByTestId('vacancy-mark-legend')
    .locator('li')
    .evaluateAll((els) => els.map((e) => e.textContent));
  check(
    legend.length === 4 &&
      /○.*どの週も受けられる/.test(legend[0]) &&
      /△.*受けられない週がある/.test(legend[1]) &&
      /×.*受けられない/.test(legend[2]) &&
      /？.*案が無く数えていない/.test(legend[3]),
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
  await page.waitForTimeout(300);
  const tip = await page.locator('[role="tooltip"]:visible').first().textContent();
  check(/いちばん少ない週の人数/.test(tip ?? ''), '用語の説明が出る', tip);
  await page.mouse.move(5, 5);
  check((await page.getByTestId('term-vacancy-estimate').count()) === 1, '場所が無いときは「目安（約）」の用語');
}

async function placeLater(page) {
  await openVacancy(page);
  await page.waitForTimeout(500);
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
  await page.waitForTimeout(200);
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
  await page.waitForTimeout(600);
  const c = await page.evaluate(
    (k) => JSON.parse(localStorage.getItem(k)).clients.find((x) => x.displayName === '段階 確認さん'),
    STORAGE_KEY,
  );
  check(c && c.tentative === true && c.place.lat === 38.2601, '仮押さえで仮の利用者さんと場所が入る', c?.place);
}

async function narrow(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await openVacancy(page);
  await page.waitForTimeout(500);
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

run(async () => {
  const b = await launch();
  const errors = [];
  for (const [name, fn] of [
    ['steps', steps],
    ['marks', marks],
    ['place-later', placeLater],
    ['narrow', narrow],
  ]) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    // 初回の案内ツアーを見た扱いにする（PRD D193）
    await skipTour(ctx);
    const page = await ctx.newPage();
    await page.clock.setFixedTime(NOW);
    page.on('pageerror', (e) => {
      errors.push(String(e));
      console.log('ERR', String(e));
    });
    // ブラウザの確認・知らせは出さない（PRD D146）
    page.on('dialog', async (d) => {
      check(false, 'ブラウザの確認を出さない', d.message());
      await d.dismiss();
    });
    await fakeServices(page);
    try {
      await fn(page);
    } catch (e) {
      check(false, name, String(e.message || e).split('\n')[0]);
      await failShot(page, name);
    }
    await ctx.close();
  }
  await b.close();
  return errors;
});
