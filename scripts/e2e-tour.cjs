// 区切り8b（PRD D189〜D193。ADR-0025 追記）を本物のブラウザで確かめる：
// 初回の案内ツアー（初めて開くと中央のカード・role="dialog"・aria-modal・見出しと本文・1 / 3・最初のフォーカスは「次へ」・
// 裏の inert とスクロールのロック・「戻る」は最初の枚で押せずフォーカスを「次へ」へ・Tab と Shift+Tab が中で回る・
// 開いている間は Ctrl+K でパレットを開かない・3枚（ホーム・予定・欠勤。PRD D277）・予定の枚は3段（提案（AI）→ ピン → 確定（伝えた））の説明・
// 最後の枚は主ボタン「今日の予定を開く」・「閉じる」（とばすは出さない。PRD D226）・
// 初めて開くと機能は「基本」で、1枚目に「どこまで使いますか」（基本／すべて。Tab は選んだ方だけ・矢印で選び直しても当てない）・
// 「すべて」を選んで「次へ」（とばすでも）でその入り切りで初期データを作り直し「条件が変わった」にならない・「基本」に戻せる・
// 別のタブで変わっていたら入り切りだけ書き換える・もう一度見るでは聞かない（PRD D276）・
// 「閉じる」で閉じて見たことを localStorage（DemoData と別のキー）に覚える・「今日の予定を開く」で閉じて今日の日の画面へ・
// 最後の枚まで進んだら覚える・読み直しても出ない・Esc と「とばす」でも覚える・?id=・?do=・人の画面（#/clients/:id）のリンクでは出さない（見たことにもしない）・データの画面の「案内をもう一度見る」で開き閉じるとフォーカスがボタンへ・
// 初期状態に戻しても見たことは残る・「見た」の印（scripts/lib/tourSeen.cjs）があれば自動で出ない・月の印刷の画面では出ない・
// 390px で収まる・印刷で出さない）、
// データの画面のファイル選択（すべて同じ部品・日本語のボタン「ファイルを選ぶ」と未選択の文・ブラウザ標準の input は見えない・
// input はボタンと同じ大きさ・種類を切り替えると文を消す・入力欄の名前（何を読み込むか＋ファイルを選ぶ）・Tab で届きフォーカスの枠・Space で選ぶ画面・控え（JSON）を選ぶと確認と
// ファイル名・取り消してもデータはそのまま・確定で読み込む・Excel の壊れたファイルは誤りの文・名簿の見出し）、
// 月の画面の日ごとの一覧（390px ははじめ一覧で横にはみ出さず土曜も見える・今日の行が画面に入る・「今日へ」・切り替えは操作の欄より上・行の読み上げ・押すとその日の訪問の下から出る欄（日の予定へは移らない）→ 欄の「この日の日の予定を開く」でその日の日の画面・
// カレンダーへ切り替えると URL の ?layout=calendar・読み直しても同じ・戻すと ?layout=list（押したら必ず書く）・1400px ははじめカレンダー・
// ?layout=list で一覧・「休みを入れる」の行は押すと希望休を付け外し・印刷の画面は今のまま）、
// データを守る（PRD D227。ADR-0032）：初期状態に戻したあと「直前の状態に戻す」で戻る（確認の本文に控えの文・欄の文・もう一度戻せる）・
// 書き出すと「最後に書き出した日」が今日になる（download）・「古い案と記録を片づける」で古い記録が消え新しいものは残る・
// 保存していたデータが壊れていると起動時の知らせ（閉じられる）と「読めなかったデータを書き出す」（元の文字）・別のタブの変更の知らせ・控えの知らせ（トースト）。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-tour.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const fs = require('node:fs');
const path = require('node:path');
const { startAll } = require('./lib/startFeatures.cjs');
const { skipTour } = require('./lib/tourSeen.cjs');
const {
  launch,
  BASE,
  OUT_DIR,
  NOW,
  TODAY,
  STORAGE_KEY,
  check,
  hashOf,
  stored,
  pageErrors,
  runSteps,
  settle,
  until,
} = require('./lib/env.cjs');
const { guard } = require('./lib/steps.cjs');

const YM = TODAY.slice(0, 7);
const TOUR_KEY = 'vrdemo:tour:seen';

/** ページのエラー（終わりに失敗に数える。env.cjs の pageErrors） */
const errors = pageErrors;
const native = [];
const tour = (page) => page.getByTestId('tour');
const visible = (loc) => loc.isVisible().catch(() => false);
/** フォーカスがツアーのカードの中か */
const focusInTour = (page) => page.evaluate(() => !!document.activeElement?.closest('[data-testid="tour"]'));
const activeTestId = (page) => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
const seenValue = (page) => page.evaluate((k) => localStorage.getItem(k), TOUR_KEY);

/**
 * 新しいブラウザの文脈（localStorage は空）。human なら「見た」の印を入れない（人が初めて開いたとき。機能は「基本」で始まる。
 * start: 'all' なら初回の入り切りだけ「すべて」に固定）。そうでなければ skipTour（初回の入り切りも「すべて」）
 */
async function newPage(b, { human, width = 1400, height = 1000, start }) {
  const ctx = await b.newContext({ viewport: { width, height } });
  if (!human) await skipTour(ctx);
  else if (start === 'all') await startAll(ctx);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  page.on('pageerror', (e) => {
    errors.push(String(e));
    console.log('ERR', String(e));
  });
  page.on('dialog', (d) => {
    if (d.type() === 'beforeunload') {
      d.accept();
      return;
    }
    native.push(`${d.type()}: ${d.message()}`);
    d.dismiss();
  });
  return { ctx, page };
}

async function open(page, hash, ready) {
  await page.goto('about:blank');
  await page.goto(`${BASE}#${hash}`);
  await page.locator(ready).first().waitFor({ timeout: 30000 });
}

// ---- ツアー：初めて開いたとき・枚の行き来・閉じる・覚える ----
async function tourFirst(b) {
  const { ctx, page } = await newPage(b, { human: true });
  await open(page, '/', '[data-testid="tour"]');
  const t = tour(page);
  const attrs = await t.evaluate((el) => ({
    role: el.getAttribute('role'),
    modal: el.getAttribute('aria-modal'),
    title: document.getElementById(el.getAttribute('aria-labelledby'))?.textContent,
    body: document.getElementById(el.getAttribute('aria-describedby'))?.textContent,
  }));
  check(
    attrs.role === 'dialog' && attrs.modal === 'true' && /今日やること/.test(attrs.title) && attrs.body.length > 10,
    'ツアー：初めて開くと出る（role=dialog・aria-modal・見出し・本文）',
    attrs,
  );
  check(/#\/home/.test(hashOf(page)), 'ツアー：裏はホーム', hashOf(page));
  check((await page.getByTestId('tour-count').innerText()).includes('1 / 3'), 'ツアー：1 / 3');
  check((await activeTestId(page)) === 'tour-next', 'ツアー：最初のフォーカスは「次へ」');
  check(await page.getByTestId('tour-back').isDisabled(), 'ツアー：最初の枚は「戻る」を押せない');
  const lock = await page.evaluate(() => ({
    inert: document.getElementById('root').inert,
    html: document.documentElement.style.overflow,
  }));
  check(lock.inert && lock.html === 'hidden', 'ツアー：裏は inert・巻かない', lock);
  // 中央のカード
  const box = await t.boundingBox();
  check(
    Math.abs(box.x + box.width / 2 - 700) < 4 && Math.abs(box.y + box.height / 2 - 500) < 40,
    'ツアー：画面の中央',
    box,
  );
  // Tab・Shift+Tab は中で回る
  let inside = true;
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    inside = inside && (await focusInTour(page));
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Shift+Tab');
    inside = inside && (await focusInTour(page));
  }
  check(inside, 'ツアー：Tab・Shift+Tab は中で回る');
  // 開いている間は Ctrl+K でパレットを開かない
  await page.keyboard.press('Control+k');
  await settle(page, 200);
  check((await page.getByTestId('cmdk-wrap').count()) === 0, 'ツアー：開いている間は Ctrl+K で探す画面を開かない');
  // 次へ → 戻る
  await page.getByTestId('tour-next').click();
  check((await page.getByTestId('tour-count').innerText()).includes('2 / 3'), 'ツアー：次へで 2 / 3');
  check((await tour(page).getAttribute('data-step')) === 'plan', 'ツアー：2枚目は予定（月・週・日）');
  check((await page.getByTestId('tour-start').count()) === 0, 'ツアー：「どこまで使いますか」は1枚目だけ');
  await page.getByTestId('tour-back').click();
  check((await page.getByTestId('tour-count').innerText()).includes('1 / 3'), 'ツアー：戻るで 1 / 3');
  check(
    (await activeTestId(page)) === 'tour-next',
    'ツアー：最初の枚へ戻って「戻る」が押せなくなるとフォーカスは「次へ」',
  );
  const keys = [];
  for (let i = 0; i < 2; i++) {
    keys.push(await tour(page).getAttribute('data-step'));
    if (i === 1) {
      check((await seenValue(page)) === null, 'ツアー：途中（2枚目まで）は覚えない');
      // 予定の枚：3段の説明（PRD D226）と［月｜週｜日］の切り替え
      const points = await page.getByTestId('tour-points').locator('li').allInnerTexts();
      check(
        (await page.getByTestId('tour-title').innerText()) === '予定で担当を組んで確定します' &&
          (await page.getByTestId('tour-body').innerText()).includes('［月｜週｜日］') &&
          points.length === 3 &&
          /^提案（AI）：/.test(points[0]) &&
          /^ピン：/.test(points[1]) &&
          /^確定（伝えた）：/.test(points[2]),
        'ツアー：予定の枚は［月｜週｜日］と3段（提案（AI）→ ピン → 確定（伝えた））の説明',
        points,
      );
      const body = await tour(page).evaluate(
        (el) => document.getElementById(el.getAttribute('aria-describedby'))?.textContent ?? '',
      );
      check(
        /提案（AI）：/.test(body) && /確定（伝えた）：/.test(body),
        'ツアー：予定の枚の説明（aria-describedby）に3段も入る',
        body,
      );
    }
    await page.getByTestId('tour-next').click();
  }
  keys.push(await tour(page).getAttribute('data-step'));
  check(
    JSON.stringify(keys) === JSON.stringify(['home', 'plan', 'absence']),
    'ツアー：3枚（ホーム・予定・欠勤・キャンセル）。条件・探す（Ctrl+K）の枚は無い',
    keys,
  );
  const lastBtns = await page.locator('[data-testid="tour"] .tour-actions button').evaluateAll((els) =>
    els.map((e) => ({
      id: e.dataset.testid,
      text: e.textContent.trim(),
      primary: e.classList.contains('btn-primary'),
    })),
  );
  check(
    JSON.stringify(lastBtns.filter((x) => x.primary).map((x) => x.id)) === '["tour-today"]' &&
      lastBtns.find((x) => x.id === 'tour-today')?.text === '今日の予定を開く' &&
      !lastBtns.some((x) => x.id === 'tour-skip'),
    'ツアー：最後の枚の主ボタンは「今日の予定を開く」だけ（「とばす」は出さない）',
    lastBtns,
  );
  check((await page.getByTestId('tour-next').innerText()).trim() === '閉じる', 'ツアー：最後の枚のボタンは「閉じる」');
  check(
    (await activeTestId(page)) === 'tour-today',
    'ツアー：最後の枚に入るとフォーカスは主ボタン「今日の予定を開く」',
    await activeTestId(page),
  );
  check((await seenValue(page)) === '1', 'ツアー：最後の枚まで進んだら閉じる前でも見たことを覚える');
  await page.screenshot({ path: path.join(OUT_DIR, 'tour-last.png') });
  await page.getByTestId('tour-next').click();
  await tour(page).waitFor({ state: 'detached' });
  const after = await page.evaluate(
    ([k, d]) => ({
      seen: localStorage.getItem(k),
      inert: document.getElementById('root').inert,
      html: document.documentElement.style.overflow,
      dataHasTour: (localStorage.getItem(d) ?? '').includes('tour'),
    }),
    [TOUR_KEY, STORAGE_KEY],
  );
  check(
    after.seen === '1' && !after.inert && after.html === '' && !after.dataHasTour,
    '「閉じる」で閉じ、見たことを DemoData と別のキーに覚える・裏の inert とロックを戻す',
    after,
  );
  // 読み直しても出ない
  await open(page, '/', '[data-testid="home-tasks"]');
  await settle(page, 500);
  check((await tour(page).count()) === 0, '読み直しても出ない（見たことを覚えている）');
  await ctx.close();
}

// 初めて開いたときの機能の入り切り（PRD D276。ADR-0045）：保存データが無ければ「基本」で始め、1枚目で「どこまで使いますか」。
// 「すべて」を選ぶとその入り切りで初期データを作り直し（担当もその入り切りで組む）、「基本」に戻せる
async function tourStart(b) {
  const { ctx, page } = await newPage(b, { human: true });
  await open(page, '/', '[data-testid="tour"]');
  const data = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), STORAGE_KEY);
  /** 初期データで担当を組んだ訪問（今日から7日。版2：担当は訪問に持つ） */
  const assignedOf = (d) => (d?.visits ?? []).filter((v) => v.staffId).length;
  let d = await data();
  const f0 = d?.org?.features ?? {};
  check(
    f0.rules === false && f0.compare === false && f0.workload === false && f0.sudden === true && f0.compat === true,
    '初めて開くと機能は「基本」（条件の重み・案を比べる・勤務の見込みは切）',
    f0,
  );
  check(assignedOf(d) > 0, '初めて開いたときに初期データの担当（今日から7日）が入っている', assignedOf(d));
  const start = page.getByTestId('tour-start');
  check(await start.isVisible(), '1枚目に「どこまで使いますか」を出す');
  check(
    (await start.locator('legend').innerText()).includes('どこまで使いますか') &&
      (await page.getByTestId('tour-start-basic').isChecked()) &&
      !(await page.getByTestId('tour-start-all').isChecked()) &&
      (await start.innerText()).includes('管理者設定'),
    '「どこまで使いますか」：基本を選んだ状態・すべて・管理者設定の注記',
  );
  check((await activeTestId(page)) === 'tour-next', '「どこまで使いますか」があっても最初のフォーカスは「次へ」');
  await page.screenshot({ path: path.join(OUT_DIR, 'tour-start.png') });
  // ラジオは標準の radio group：Tab は選んでいる方だけ、矢印で選び直す。選び直しただけでは当てない（1枚目を離れるときに当てる）
  const stops = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    stops.push(await activeTestId(page));
  }
  check(
    stops.includes('tour-start-basic') && !stops.includes('tour-start-all'),
    '「どこまで使いますか」：Tab は選んでいる方（基本）だけに止まる',
    stops,
  );
  await page.getByTestId('tour-start-basic').focus();
  await page.keyboard.press('ArrowDown');
  check(
    (await page.getByTestId('tour-start-all').isChecked()) && (await activeTestId(page)) === 'tour-start-all',
    '「どこまで使いますか」：矢印で「すべて」へ選び直す',
  );
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowDown');
  await settle(page, 300);
  check((await data())?.org?.features?.rules === false, '矢印で選び直しただけでは当てない（データはそのまま）');
  // 「次へ」で当てる
  await page.getByTestId('tour-next').click();
  await until(async () => (await data())?.org?.features?.rules === true, 10000);
  d = await data();
  const f1 = d?.org?.features ?? {};
  check(
    Object.values(f1).length === 20 && Object.values(f1).every((v) => v === true),
    '「すべて」を選んで「次へ」で、すべての機能を入れる',
    f1,
  );
  check(assignedOf(d) > 0, '「すべて」を当てると初期データを作り直し、担当も入っている', assignedOf(d));
  // 戻って「基本」に戻せる
  await page.getByTestId('tour-back').click();
  check(await page.getByTestId('tour-start-all').isChecked(), '戻ると「すべて」を選んだ状態');
  await page.getByTestId('tour-start-basic').check();
  await page.getByTestId('tour-next').click();
  await until(async () => (await data())?.org?.features?.rules === false, 10000);
  check((await data())?.org?.features?.compare === false, '「基本」に戻せる');
  await page.getByTestId('tour-back').click();
  await page.getByTestId('tour-start-all').check();
  // 「とばす」でも当てる
  await page.getByTestId('tour-skip').click();
  await tour(page).waitFor({ state: 'detached' });
  await until(async () => (await data())?.org?.features?.rules === true, 10000);
  check(
    Object.values((await data())?.org?.features ?? {}).every((v) => v === true) && assignedOf(await data()) > 0,
    '「とばす」でも選んだもの（すべて）を当てる（担当も入っている）',
  );
  // 読み直しても入り切りは残り、ツアーは出ない
  await open(page, '/settings', '[data-testid="settings-tabs"]');
  await settle(page, 400);
  const tabs = await page.getByTestId('settings-tabs').locator('a').allInnerTexts();
  check(
    tabs.length === 6 && (await tour(page).count()) === 0,
    '読み直しても「すべて」のまま（設定のタブ6つ）・ツアーは出ない',
    tabs,
  );
  await ctx.close();
  // 起動したあと別のタブでデータが変わっていたら、作り直さずに入り切りだけ書き換える（別のタブの変更を消さない）
  {
    const o = await newPage(b, { human: true });
    await open(o.page, '/', '[data-testid="tour"]');
    const other = await o.ctx.newPage();
    await other.goto(`${BASE}#/data`);
    await other.locator('h1').first().waitFor({ timeout: 30000 });
    await other.evaluate((k) => {
      const x = JSON.parse(localStorage.getItem(k));
      x.org.name = 'e2e 別のタブで変えた事業所';
      localStorage.setItem(k, JSON.stringify(x));
    }, STORAGE_KEY);
    await other.close();
    await settle(o.page, 500);
    await o.page.getByTestId('tour-start-all').check();
    await o.page.getByTestId('tour-next').click();
    const od = () => o.page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), STORAGE_KEY);
    await until(async () => (await od())?.org?.features?.rules === true, 10000);
    check(
      (await od())?.org?.name === 'e2e 別のタブで変えた事業所',
      '別のタブで変わったあとに「すべて」を当てても作り直さず、別のタブの変更は残る（入り切りだけ書き換える）',
      (await od())?.org?.name,
    );
    await o.ctx.close();
  }
  // 保存データがある人：features の無い古いデータは今までどおりすべて入（1問も出さない）
  const h = await newPage(b, { human: true });
  await open(h.page, '/', '[data-testid="tour"]');
  await h.page.evaluate((k) => {
    const x = JSON.parse(localStorage.getItem(k));
    delete x.org.features;
    localStorage.setItem(k, JSON.stringify(x));
  }, STORAGE_KEY);
  await open(h.page, '/', '[data-testid="tour"]');
  check(
    (await h.page.getByTestId('tour-start').count()) === 0,
    '保存データがある人（初めてでない）には「どこまで使いますか」を出さない',
  );
  await h.page.getByTestId('tour-skip').click();
  await open(h.page, '/settings', '[data-testid="settings-tabs"]');
  check(
    (await h.page.getByTestId('settings-tabs').locator('a').count()) === 6,
    'features の無い保存データは今までどおりすべて入（設定のタブ6つ）',
  );
  await h.ctx.close();
}

async function tourEscSkip(b) {
  // Esc
  {
    const { ctx, page } = await newPage(b, { human: true });
    await open(page, '/week', '[data-testid="tour"]');
    await page.getByTestId('tour-next').click();
    await page.keyboard.press('Escape');
    await tour(page).waitFor({ state: 'detached' });
    check((await seenValue(page)) === '1', 'Esc で閉じ、見たことを覚える');
    check(/#\/week/.test(hashOf(page)), 'Esc で閉じても画面はそのまま', hashOf(page));
    await ctx.close();
  }
  // とばす
  {
    const { ctx, page } = await newPage(b, { human: true });
    await open(page, '/', '[data-testid="tour"]');
    await page.getByTestId('tour-skip').click();
    await tour(page).waitFor({ state: 'detached' });
    check((await seenValue(page)) === '1', '「とばす」で閉じ、見たことを覚える');
    await ctx.close();
  }
  // ?id=・?do= のリンク、人の画面（#/clients/:id）のリンクで開いたときは出ない。次にふつうに開くと出る
  {
    const { ctx, page } = await newPage(b, { human: true });
    await open(page, '/clients?id=c1', '[data-testid="person-view"]');
    await settle(page, 500);
    check(
      (await tour(page).count()) === 0 && (await page.getByTestId('person-view').getAttribute('data-id')) === 'c1',
      '?id= のリンクで開くとツアーは出ず、その人の画面',
    );
    await open(page, '/staff/s1', '[data-testid="person-view"]');
    await settle(page, 500);
    check((await tour(page).count()) === 0, '人の画面（#/staff/:id）のリンクで開くとツアーは出ない');
    check((await seenValue(page)) === null, '?id= で出さなくても見たことにはしない');
    await open(page, `/plan?date=${TODAY}&do=absence`, '.drawer');
    await settle(page, 500);
    check((await tour(page).count()) === 0, '?do= のリンクで開くとツアーは出ない');
    await open(page, '/', '[data-testid="tour"]');
    check(true, '次にふつうに開くとツアーが出る');
    await ctx.close();
  }
  // 月の印刷の画面（メニューの外）では出ない（初回は「基本」で月の印刷を切っているので、初回の入り切りを「すべて」にして開く）
  {
    const { ctx, page } = await newPage(b, { human: true, start: 'all' });
    await page.goto(`${BASE}#/month/print?ym=${YM}`);
    await page.locator('.mprint').first().waitFor({ timeout: 30000 });
    await settle(page, 400);
    check((await tour(page).count()) === 0, '月の印刷の画面では出ない');
    await ctx.close();
  }
}

// 最後の枚の「今日の予定を開く」（PRD D226）：閉じて今日の日の画面（選んでいる日付は今日）。見たことを覚える
async function tourToday(b) {
  const { ctx, page } = await newPage(b, { human: true });
  await open(page, '/month', '[data-testid="tour"]');
  for (let i = 0; i < 2; i++) await page.getByTestId('tour-next').click();
  check(
    (await tour(page).getAttribute('data-step')) === 'absence',
    '「今日の予定を開く」：最後の枚（欠勤・キャンセル）まで進む',
  );
  // フォーカスは「今日の予定を開く」にあるので、Enter で押せる
  check((await activeTestId(page)) === 'tour-today', '「今日の予定を開く」：最後の枚ではフォーカスがこのボタン');
  await page.keyboard.press('Enter');
  await tour(page).waitFor({ state: 'detached' });
  await page.waitForURL(/#\/plan/);
  await page.locator('.date-switch select').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => !/date=/.test(location.hash), null, { timeout: 5000 }).catch(() => {});
  const st = await page.evaluate(
    (k) => ({
      date: document.querySelector('.date-switch select')?.value,
      hash: decodeURIComponent(location.hash),
      seen: localStorage.getItem(k),
      inert: document.getElementById('root').inert,
    }),
    TOUR_KEY,
  );
  check(
    st.date === TODAY && st.hash === '#/plan' && st.seen === '1' && !st.inert,
    '「今日の予定を開く」で閉じ、今日の日の予定（?date= は消える）・見たことを覚える',
    st,
  );
  // 初期データに今日の担当がある（PRD D225）ので、そのまま確定の手前まで見える
  await page.getByTestId('confirm-state').waitFor({ timeout: 30000 });
  check(
    /まだ伝えていない/.test(await page.getByTestId('confirm-state').innerText()),
    '「今日の予定を開く」：今日の担当が出ている（まだ伝えていない）',
  );
  await ctx.close();
}

async function tourAgain(b) {
  // 「見た」の印があれば自動で出ない（ほかの e2e は skipTour で印を入れる）。データの画面から開ける
  const { ctx, page } = await newPage(b, { human: false });
  await open(page, '/', '[data-testid="home-tasks"]');
  await settle(page, 500);
  check(
    (await tour(page).count()) === 0,
    '「見た」の印があれば自動で出ない（ほかの e2e は scripts/lib/tourSeen.cjs で印を入れる）',
  );
  await open(page, '/data', '[data-testid="tour-again"]');
  const btn = page.getByTestId('tour-again');
  await btn.click();
  await tour(page).waitFor();
  check(
    (await page.getByTestId('tour-count').innerText()).includes('1 / 3'),
    'データの「案内をもう一度見る」で1枚目から開く',
  );
  check(
    (await page.getByTestId('tour-start').count()) === 0,
    '「案内をもう一度見る」では「どこまで使いますか」を出さない',
  );
  await page.keyboard.press('Escape');
  await tour(page).waitFor({ state: 'detached' });
  check((await activeTestId(page)) === 'tour-again', '閉じたらフォーカスは「案内をもう一度見る」へ');
  check((await seenValue(page)) === '1', 'もう一度見て閉じても見たまま');
  // 初期状態に戻しても見たことは残る
  await page.getByRole('button', { name: 'デモの初期状態に戻す' }).click();
  await page.getByTestId('confirm-ok').click();
  await page.locator('.toast').filter({ hasText: '初期状態に戻しました' }).waitFor();
  check((await seenValue(page)) === '1', '初期状態に戻しても見たことは残る（データとは別）');
  await ctx.close();
  // 人のブラウザで：見たあとに初期状態に戻して読み直しても出ない
  const h = await newPage(b, { human: true });
  await open(h.page, '/data', '[data-testid="tour"]');
  await h.page.getByTestId('tour-skip').click();
  await h.page.getByRole('button', { name: 'デモの初期状態に戻す' }).click();
  await h.page.getByTestId('confirm-ok').click();
  await h.page.locator('.toast').filter({ hasText: '初期状態に戻しました' }).waitFor();
  await settle(h.page, 600);
  await open(h.page, '/', '[data-testid="home-tasks"]');
  await settle(h.page, 500);
  check((await tour(h.page).count()) === 0, '初期状態に戻して読み直してもツアーは出ない');
  await h.ctx.close();
}

async function tourMobilePrint(b) {
  const { ctx, page } = await newPage(b, { human: true, width: 390, height: 844 });
  await open(page, '/', '[data-testid="tour"]');
  for (let i = 0; i < 3; i++) {
    const box = await tour(page).boundingBox();
    const btns = await page
      .locator('[data-testid="tour"] button')
      .evaluateAll((els) =>
        els.map((e) => e.getBoundingClientRect()).map((r) => ({ l: r.left, r: r.right, b: r.bottom })),
      );
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check(
      box.x >= 0 &&
        box.x + box.width <= 390 &&
        box.y >= 0 &&
        box.y + box.height <= 844 &&
        btns.every((x) => x.l >= 0 && x.r <= 390 && x.b <= 844) &&
        sw <= 390,
      `390px：${i + 1}枚目のカードとボタンが画面に収まる`,
      { box, sw },
    );
    if (i === 0) await page.screenshot({ path: path.join(OUT_DIR, 'tour-390.png') });
    if (i === 2) await page.screenshot({ path: path.join(OUT_DIR, 'tour-last-390.png') });
    if (i < 2) await page.getByTestId('tour-next').click();
  }
  await page.emulateMedia({ media: 'print' });
  check(!(await visible(tour(page))), '印刷ではツアーを出さない');
  await page.emulateMedia({ media: 'screen' });
  await ctx.close();
}

// ---- データの画面のファイル選択 ----
async function filePick(b) {
  const { ctx, page } = await newPage(b, { human: false });
  // 選ぶ画面（filechooser）の受け口は先に付けておく。受け口を付けたときにブラウザへ横取りを頼む知らせは待たずに送られるので、
  // 押す直前に waitForEvent を付けるだけでは、横取りが入る前に Space が届いて取りこぼすことがある
  page.on('filechooser', () => {});
  await open(page, '/data', '[data-testid="backup-file"]');
  const counts = await page.evaluate(() => ({
    all: document.querySelectorAll('input[type="file"]').length,
    pick: document.querySelectorAll('.file-pick input[type="file"]').length,
  }));
  check(counts.all === 2 && counts.pick === 2, 'ファイル選択は控え（JSON）と Excel の2つで、どちらも同じ部品', counts);
  const shape = await page.evaluate(() =>
    [...document.querySelectorAll('.file-pick')].map((el) => {
      const input = el.querySelector('input[type="file"]');
      const r = input.getBoundingClientRect();
      return {
        btn: el.querySelector('label.file-pick-btn')?.textContent.trim(),
        name: el.querySelector('.file-pick-name')?.textContent.trim(),
        input: { w: Math.round(r.width), h: Math.round(r.height) },
        btnBox: (() => {
          const b = el.querySelector('label.file-pick-btn').getBoundingClientRect();
          return { w: Math.round(b.width), h: Math.round(b.height) };
        })(),
        opacity: getComputedStyle(input).opacity,
        display: getComputedStyle(input).display,
        label: (input.getAttribute('aria-labelledby') ?? '')
          .split(' ')
          .map((id) => document.getElementById(id)?.textContent.trim())
          .join(' '),
        desc: document.getElementById(input.getAttribute('aria-describedby'))?.textContent.trim(),
      };
    }),
  );
  check(
    shape.every((s) => s.btn === 'ファイルを選ぶ' && s.name === 'ファイルを選んでいません'),
    '日本語のボタン「ファイルを選ぶ」と未選択の文',
    shape,
  );
  check(
    shape.every(
      (s) => s.input.w === s.btnBox.w && s.input.h === s.btnBox.h && s.opacity === '0' && s.display !== 'none',
    ),
    'ブラウザ標準の input（Choose File）は見えないまま、見た目のボタンと同じ大きさで残す（VoiceOver で触れる）',
    shape.map((x) => [x.input, x.btnBox]),
  );
  check(
    shape[0].label === '読み込む控え（JSON） ファイルを選ぶ' && shape[0].desc === 'ファイルを選んでいません',
    '入力欄の名前は「何を読み込むか＋ファイルを選ぶ」、説明は選んだファイルの文',
    shape[0],
  );
  check(/読み込む Excel/.test(shape[1].label), 'Excel の入力欄の名前', shape[1].label);
  check(
    (await page.getByRole('button', { name: '読み込む控え（JSON） ファイルを選ぶ', exact: true }).count()) === 1,
    '読み上げの木で入力欄が名前付きのボタン（「読み込む控え（JSON） ファイルを選ぶ」）',
  );
  // キーボード：「ファイルに書き出す」から Tab で入力欄へ・枠が見える・Space で選ぶ画面
  await page.getByRole('button', { name: 'ファイルに書き出す' }).focus();
  await page.keyboard.press('Tab');
  check((await activeTestId(page)) === 'backup-file-input', 'Tab で控えの入力欄に届く');
  const outline = await page
    .locator('[data-testid="backup-file"] label.file-pick-btn')
    .evaluate((el) => getComputedStyle(el).outlineStyle);
  check(outline === 'solid', 'フォーカスしているときはボタンの見た目に枠', outline);
  // Space で選ぶ画面（filechooser）。待ち受けは押す前に始める
  const chooser = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
  await page.keyboard.press('Space');
  const chosen = await chooser;
  check(chosen !== null, 'Space でファイルを選ぶ画面が開く');
  // 控え（JSON）を選ぶ：確認 → 取り消すでデータはそのまま、文はファイル名
  const json = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  const before = json;
  await page
    .getByTestId('backup-file-input')
    .setInputFiles({ name: 'ひかえ.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.getByTestId('confirm-dialog').waitFor();
  const title = await page.getByTestId('confirm-title').innerText();
  check(title.includes('「ひかえ.json」'), '選ぶと確認（ファイル名入り）', title);
  await page.getByTestId('confirm-cancel').click();
  await settle(page, 400);
  check(
    (await page.getByTestId('backup-file-name').innerText()) === '選んだファイル：ひかえ.json',
    '選んだファイル名を出す',
  );
  check((await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)) === before, '取り消すとデータはそのまま');
  // 同じファイルをもう一度選べる（input の値は空に戻す）→ 確定で読み込む
  check((await page.getByTestId('backup-file-input').inputValue()) === '', '選んだあと input の値は空に戻す');
  await page
    .getByTestId('backup-file-input')
    .setInputFiles({ name: 'ひかえ.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.getByTestId('confirm-ok').click();
  await page.locator('.toast').filter({ hasText: '読み込みました' }).waitFor({ timeout: 5000 });
  check(true, '同じファイルをもう一度選んで確定すると読み込む');
  // Excel：壊れたファイルは誤りの文（データはそのまま）
  await page
    .getByTestId('excel-file-input')
    .setInputFiles({ name: 'こわれた.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('not a book') });
  await page.locator('.error').filter({ hasText: '読み込めませんでした' }).first().waitFor({ timeout: 10000 });
  check(
    (await page.getByTestId('excel-file-name').innerText()) === '選んだファイル：こわれた.xlsx',
    'Excel：選んだファイル名と誤りの文',
  );
  // 名簿にすると見出しが変わる
  await page
    .getByTestId('excel-kind')
    .getByRole('button', { name: /利用者さんの名簿/ })
    .click();
  check(
    (await page.locator('[data-testid="excel-file"] .file-pick-caption').innerText()) ===
      '読み込む利用者さんの名簿（Excel）',
    'Excel：名簿の見出し（呼び方）',
  );
  check(
    (await page.getByTestId('excel-file-name').innerText()) === 'ファイルを選んでいません',
    'Excel：種類を切り替えると選んだファイルの文を消す',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'data-file-pick.png'), fullPage: true });
  // 390px：横にはみ出さない
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page, 300);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  const bb = await page.locator('[data-testid="backup-file"] label.file-pick-btn').boundingBox();
  check(sw <= 390 && bb.x >= 0 && bb.x + bb.width <= 390, '390px：ファイル選択が収まる', { sw, bb });
  await ctx.close();
}

// ---- 月の画面の日ごとの一覧 ----
async function monthList(b) {
  const { ctx, page } = await newPage(b, { human: false, width: 390, height: 844 });
  await open(page, `/month?ym=${YM}`, '[data-testid="month-layout"]');
  await page.locator('[data-testid="month-list-day"]').first().waitFor({ timeout: 30000 });
  check(
    (await page.getByTestId('month-grid').count()) === 0,
    '390px：はじめは日ごとの一覧（カレンダーの表を出さない）',
  );
  const pressed = await page
    .locator('[data-testid="month-layout"] button')
    .evaluateAll((els) => els.map((e) => `${e.dataset.layout}:${e.getAttribute('aria-pressed')}`));
  check(pressed.join(',') === 'calendar:false,list:true', '切り替えの aria-pressed', pressed);
  const rows = page.getByTestId('month-list-day');
  const n = await rows.count();
  const last = new Date(Date.UTC(Number(YM.slice(0, 4)), Number(YM.slice(5, 7)), 0)).getUTCDate();
  check(n === last, `一覧は月の日数（${last}日）の行`, n);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  const widths = await rows.evaluateAll(
    (els) => els.map((e) => e.getBoundingClientRect()).filter((r) => r.left < 0 || r.right > 390).length,
  );
  check(sw <= 390 && widths === 0, '390px：一覧は横にはみ出さない', { sw, widths });
  const sat = await rows.filter({ hasText: '（土）' }).count();
  check(sat >= 4, '390px：土曜の行も見える', sat);
  // 今日の行が画面に入る（上の帯・下のタブに隠れない。今月で行き先が無いとき）
  const inView = async (loc) => {
    const r = await loc.boundingBox();
    const head = await page.locator('.app-header').boundingBox();
    const tb = await page.getByTestId('bottom-tabs').boundingBox();
    return {
      ok: r.y >= head.y + head.height - 1 && r.y + r.height <= tb.y + 1,
      r: r.y,
      head: head.y + head.height,
      tabs: tb.y,
    };
  };
  const today = rows.filter({ has: page.locator('.month-today') });
  await settle(page, 400);
  const v1 = await inView(today);
  check(v1.ok, '390px：開くと今日の行が画面に入る（上の帯・下のタブに隠れない）', v1);
  // 「今日へ」：上へ巻いてから押すと、今日の行へ巻いてフォーカス
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page, 200);
  await page.getByTestId('month-list-today').click();
  // 巻く動き（smooth）は DOM を変えないので、今日の行が画面に入るまで待つ
  await until(async () => (await inView(today)).ok, 5000);
  const v2 = await inView(today);
  const focused = await today.evaluate((el) => document.activeElement === el);
  check(v2.ok && focused, '「今日へ」で今日の行へ巻いてフォーカス', { ...v2, focused });
  // 切り替えは操作の欄（月の見出しのカード）より上
  // 2つの位置は同じ瞬間に測る（巻く動きの途中に別々に測ると、間に巻いた分だけずれる）
  const pos = await page.evaluate(() => ({
    layout: document.querySelector('[data-testid="month-layout"]').getBoundingClientRect().y,
    head: document.querySelector('.month-head').getBoundingClientRect().y,
  }));
  check(pos.layout < pos.head, '切り替えは操作の欄より上', pos);
  // 行の読み上げ：日付・件数・状態
  const label = await today.getAttribute('aria-label');
  check(
    /今日/.test(label) &&
      /(訪問 \d+件|訪問なし)/.test(label) &&
      /(まだ伝えていない|確定済み|未連絡の変更あり|訪問なし)/.test(label),
    '行の読み上げ（日付・今日・件数・状態）',
    label,
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'month-list-390.png') });
  // カレンダーへ切り替え：URL に ?layout=calendar、読み直しても同じ
  await page.locator('[data-testid="month-layout"] button[data-layout="calendar"]').click();
  await page.getByTestId('month-grid').waitFor();
  check(/layout=calendar/.test(hashOf(page)), 'カレンダーへ切り替えると URL に ?layout=calendar', hashOf(page));
  await page.reload();
  await page.getByTestId('month-grid').waitFor({ timeout: 30000 });
  check((await page.getByTestId('month-list').count()) === 0, '読み直してもカレンダーのまま');
  await page.locator('[data-testid="month-layout"] button[data-layout="list"]').click();
  await page.getByTestId('month-list').waitFor();
  check(/layout=list/.test(hashOf(page)), '一覧へ戻すと URL に ?layout=list（押したら幅の既定でも書く）', hashOf(page));
  // 行を押すとその日の訪問の下から出る欄（スマホ。PRD D343）、欄の「この日の日の予定を開く」でその日の日の画面
  const target = await rows.nth(Math.min(n - 1, 20)).getAttribute('data-date');
  await page.locator(`[data-testid="month-list-day"][data-date="${target}"]`).click();
  const sheet = page.getByTestId('month-day-sheet');
  await sheet.waitFor({ timeout: 10000 });
  check(
    (await sheet.getAttribute('data-date')) === target,
    '行を押すとその日の訪問の下から出る欄（日の予定へは移らない）',
    {
      date: await sheet.getAttribute('data-date'),
      hash: hashOf(page),
    },
  );
  await page.getByTestId('month-day-visits-plan').click();
  await page.waitForURL(/#\/plan/);
  const sel = await page.locator('.date-switch select').inputValue();
  check(sel === target, '欄の「この日の日の予定を開く」でその日の「日の予定」', { sel, target });
  // 「休みを入れる」：〈スタッフ〉を選んで、勤務日の行を押すと希望休を付け外し。
  // 希望休を入れられる行（data-off="open"）がある〈スタッフ〉を探す。今月に1つも無ければ（月末で残りの日に働く人がいない）翌月で
  const nextYm = (() => {
    const [y, m] = YM.split('-').map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  })();
  const openRow = page.locator('[data-testid="month-list-day"][data-off="open"]').first();
  let found = false;
  for (const ym of [YM, nextYm]) {
    await open(page, `/month?ym=${ym}`, '[data-testid="month-list"]');
    // 表示の選択は「その他 ▾」の「表示を選ぶ」で開く（PRD D278）
    await page.getByTestId('month-more').click();
    await page.getByTestId('month-more-pickers').click();
    await page.getByTestId('month-focus').waitFor();
    const staffOpts = await page
      .locator('[data-testid="month-focus"] option')
      .evaluateAll((els) => els.map((e) => e.value).filter((v) => v.startsWith('staff:')));
    for (const [i, v] of staffOpts.entries()) {
      await page.getByTestId('month-focus').selectOption(v);
      if (i === 0) await page.getByTestId('month-off-toggle').click();
      await page.locator('[data-testid="month-list-day"][data-off]').first().waitFor({ timeout: 10000 });
      if ((await openRow.count()) > 0) {
        found = true;
        break;
      }
    }
    if (found) break;
  }
  check(found, '「休みを入れる」：希望休を入れられる行のある〈スタッフ〉がいる（今月に無ければ翌月）');
  await openRow.waitFor({ timeout: 10000 });
  const offDate = await openRow.getAttribute('data-date');
  await openRow.click();
  const row = page.locator(`[data-testid="month-list-day"][data-date="${offDate}"]`);
  await settle(page, 400);
  check(
    (await row.getAttribute('data-off')) === 'requested' && (await row.getAttribute('aria-pressed')) === 'true',
    '「休みを入れる」：行を押すと希望休（マスと同じ動き）',
  );
  await row.click();
  await settle(page, 400);
  check((await row.getAttribute('data-off')) === 'open', '「休みを入れる」：もう一度押すと外す');
  check(/#\/month/.test(hashOf(page)), '「休みを入れる」の間は日の予定へ移らない');
  // 広い画面：はじめカレンダー、?layout=list で一覧
  await page.setViewportSize({ width: 1400, height: 1000 });
  await open(page, `/month?ym=${YM}`, '[data-testid="month-grid"]');
  check((await page.getByTestId('month-list').count()) === 0, '1400px：はじめはカレンダー');
  await open(page, `/month?ym=${YM}&layout=list`, '[data-testid="month-list"]');
  check((await page.getByTestId('month-grid').count()) === 0, '1400px：?layout=list で一覧');
  // 月の印刷の画面は今のまま（カレンダーの表）
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}#/month/print?ym=${YM}`);
  await page.locator('.mprint').first().waitFor({ timeout: 30000 });
  check(
    (await page.getByTestId('month-list').count()) === 0 && (await page.locator('.mprint table').count()) > 0,
    '月の印刷の画面は今のまま（一覧にしない）',
  );
  await open(page, `/month?ym=${YM}`, '[data-testid="month-layout"]');
  await page.emulateMedia({ media: 'print' });
  check(!(await visible(page.getByTestId('month-layout'))), '印刷では切り替えを出さない');
  await page.emulateMedia({ media: 'screen' });
  await ctx.close();
}

// ---- データを守る（PRD D227。ADR-0032）----
const PREV_KEY = 'vrdemo:data:prev';
const BACKUP_LAST_KEY = 'vrdemo:backup:last';
/** 日付を n か月ずらした月の d 日（YYYY-MM-DD） */
function monthsAgo(n, d) {
  const [y, m] = TODAY.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 - n, d));
  return t.toISOString().slice(0, 10);
}
/** 伝えた内容（形だけ。古い日付の片づけの確かめ用） */
const fakeSnap = (date) => ({ date, at: Date.parse(`${date}T09:00:00+09:00`), visits: [] });

/** 同じタブで localStorage のデータを書き換えて読み直す（storage イベントは出ない） */
async function writeData(page, fn, arg) {
  await page.evaluate(
    ({ k, src, a }) => {
      const d = JSON.parse(localStorage.getItem(k));
      // e2e の中だけ：関数の本文を文字で渡して作る
      const next = new Function(`return (${src})`)()(d, a);
      localStorage.setItem(k, JSON.stringify(next));
    },
    { k: STORAGE_KEY, src: fn.toString(), a: arg },
  );
  await page.reload();
}

async function dataProtect(b) {
  const { ctx, page } = await newPage(b, { human: false });
  await open(page, '/data', '[data-testid="tour-again"]');
  await settle(page, 600);
  // 控えはまだ無い・最後に書き出した日もまだ
  check((await page.getByTestId('data-prev-card').count()) === 0, '控えが無いうちは「直前の状態に戻す」を出さない');
  check(
    (await page.getByTestId('data-last-export').innerText()).includes('まだ書き出していません'),
    '最後に書き出した日：まだ書き出していません',
  );
  // いまのデータに印（乱数の種）を付けてから、初期状態に戻す
  await writeData(page, (d) => ({ ...d, seed: 424242 }));
  await page.getByTestId('tour-again').waitFor();
  await settle(page, 400);
  await page.getByRole('button', { name: 'デモの初期状態に戻す' }).click();
  await page.getByTestId('confirm-dialog').waitFor();
  const body = await page.getByTestId('confirm-body').innerText();
  check(
    /控えとして1つだけ残し/.test(body) && /直前の状態に戻す/.test(body),
    '初期状態に戻す：確認の本文に控えの文',
    body,
  );
  // 取り消すと控えは前の世代のまま（無い）
  await page.getByTestId('confirm-cancel').click();
  await settle(page, 300);
  check((await page.getByTestId('data-prev-card').count()) === 0, '取り消すと控えは残らない（前の世代に戻す）');
  check((await stored(page)).seed === 424242, '取り消すとデータはそのまま');
  await page.getByRole('button', { name: 'デモの初期状態に戻す' }).click();
  await page.getByTestId('confirm-ok').click();
  await page.locator('.toast').filter({ hasText: '初期状態に戻しました' }).waitFor();
  await settle(page, 500);
  check((await stored(page)).seed !== 424242, '初期状態に戻した（印が消えた）');
  const prevText = await page.getByTestId('data-prev-text').innerText();
  check(
    /^\d{1,2}\/\d{1,2} \d{2}:\d{2} の『初期状態に戻す』の前の状態に戻せます$/.test(prevText),
    '「直前の状態に戻す」の欄の文',
    prevText,
  );
  check(await page.evaluate((k) => localStorage.getItem(k) !== null, PREV_KEY), '控えは別のキー（vrdemo:data:prev）');
  await page.getByTestId('data-prev-restore').click();
  await page.getByTestId('confirm-dialog').waitFor();
  check(/前の状態に戻せます/.test(await page.getByTestId('confirm-body').innerText()), '直前の状態に戻す：確認つき');
  await page.getByTestId('confirm-ok').click();
  await page.locator('.toast').filter({ hasText: '直前の状態に戻しました' }).waitFor();
  await settle(page, 500);
  check((await stored(page)).seed === 424242, '直前の状態に戻すと、初期状態に戻す前のデータになる');
  check(
    /『直前の状態に戻す』の前の状態に戻せます/.test(await page.getByTestId('data-prev-text').innerText()),
    '戻したあとは、戻す前のデータが控えに残る（もう一度戻せる）',
  );
  // 書き出すと「最後に書き出した日」が今日になる
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ファイルに書き出す' }).click();
  const file = await dl;
  check(/\.json$/.test(file.suggestedFilename()), '控えを書き出す（download）', file.suggestedFilename());
  await settle(page, 300);
  const last = await page.getByTestId('data-last-export').innerText();
  const md = `${Number(TODAY.slice(5, 7))}/${Number(TODAY.slice(8, 10))}`;
  check(last.includes(`${md}（今日）`), '書き出すと最後に書き出した日が今日', last);
  check(
    (await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), BACKUP_LAST_KEY))?.date === TODAY,
    '最後に書き出した日は別のキー（vrdemo:backup:last）',
  );
  await page.reload();
  await page.getByTestId('data-last-export').waitFor();
  check(
    (await page.getByTestId('data-last-export').innerText()).includes('（今日）'),
    '読み直しても最後に書き出した日が残る',
  );
  // 古い訪問の記録を片づける：既定は3か月前の月より前。古い確定した内容だけ消え、新しいものは残る
  const old1 = monthsAgo(5, 10);
  const old2 = monthsAgo(4, 3);
  const recent = monthsAgo(1, 12);
  await writeData(
    page,
    (d, a) => ({
      ...d,
      snapshots: { ...d.snapshots, [a.old1]: a.s1, [a.old2]: a.s2, [a.recent]: a.s3 },
    }),
    { old1, old2, recent, s1: fakeSnap(old1), s2: fakeSnap(old2), s3: fakeSnap(recent) },
  );
  await page.getByTestId('data-tidy-card').waitFor();
  await settle(page, 400);
  const sel = await page.getByTestId('data-tidy-month').inputValue();
  check(sel === monthsAgo(3, 1).slice(0, 7), '片づけ：既定は3か月前の月', sel);
  const pv = await page.getByTestId('data-tidy-preview').innerText();
  check(/2日分の訪問 0件・確定した内容 2日分/.test(pv), '片づけ：件数と空く見込み', pv);
  await page.getByTestId('data-tidy-run').click();
  await page.getByTestId('confirm-dialog').waitFor();
  check(/確定した内容 2日分を消します/.test(await page.getByTestId('confirm-body').innerText()), '片づけ：確認つき');
  await page.getByTestId('confirm-ok').click();
  await page.locator('.toast').filter({ hasText: '訪問の記録を消しました' }).waitFor();
  await settle(page, 600);
  const after = await stored(page);
  check(
    !after.snapshots[old1] && !after.snapshots[old2],
    '片づけ：選んだ月より前の確定した内容が消える',
    Object.keys(after.snapshots),
  );
  check(!!after.snapshots[recent], '片づけ：新しい確定した内容は残る');
  check(after.seed === 424242, '片づけ：ほかのデータはそのまま');
  check(await page.getByTestId('data-tidy-run').isDisabled(), '片づけ：消せるものが無ければ押せない');
  await page.screenshot({ path: path.join(OUT_DIR, 'data-protect.png'), fullPage: true });
  // 別のタブで変わったら知らせる
  const other = await ctx.newPage();
  await other.clock.setFixedTime(NOW);
  await other.goto(`${BASE}#/home`);
  await other.locator('h1').waitFor();
  await other.evaluate((k) => {
    const d = JSON.parse(localStorage.getItem(k));
    localStorage.setItem(k, JSON.stringify({ ...d, seed: 515151 }));
  }, STORAGE_KEY);
  await page.locator('.toast').filter({ hasText: '別のタブで変わったので読み直しました' }).waitFor({ timeout: 5000 });
  check(true, '別のタブで変わると「別のタブで変わったので読み直しました」');
  await other.close();
  await ctx.close();
}

async function brokenData(b) {
  // 保存していたデータが壊れている：起動時に知らせと「読めなかったデータを書き出す」
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  await skipTour(ctx);
  await ctx.addInitScript((k) => {
    if (sessionStorage.getItem('e2e-broken')) return;
    sessionStorage.setItem('e2e-broken', '1');
    localStorage.setItem(k, '{こわれた');
  }, STORAGE_KEY);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  page.on('pageerror', (e) => {
    errors.push(String(e));
    console.log('ERR', String(e));
  });
  await page.goto(`${BASE}#/home`);
  const notice = page.getByTestId('data-broken-notice');
  await notice.waitFor({ timeout: 30000 });
  check(
    /保存していたデータを読めなかったため、初期データで開きました/.test(await notice.innerText()),
    '壊れたデータ：起動時に知らせる',
  );
  await page.emulateMedia({ media: 'print' });
  check(!(await notice.isVisible()), '印刷では知らせを出さない');
  await page.emulateMedia({ media: 'screen' });
  const dl = page.waitForEvent('download');
  await page.getByTestId('data-broken-download').click();
  const file = await dl;
  const text = fs.readFileSync(await file.path(), 'utf8');
  check(text === '{こわれた', '「読めなかったデータを書き出す」は元の文字のまま', text);
  await page.screenshot({ path: path.join(OUT_DIR, 'data-broken.png') });
  await page.getByTestId('data-broken-close').click();
  await settle(page, 300);
  check((await notice.count()) === 0, '閉じると消える');
  check(await page.evaluate(() => document.activeElement?.tagName === 'H1'), '閉じるとフォーカスは画面の見出し');
  // 退避できたので初期データを書いた：読み直しても知らせは出ない（1回だけ）。元の文字は退避先に残る
  await page.reload();
  await page.locator('h1').waitFor();
  await settle(page, 500);
  check((await notice.count()) === 0, '退避して初期データを書いたので、読み直すと知らせは出ない（1回だけ）');
  check(
    (await page.evaluate(() => localStorage.getItem('vrdemo:data:broken'))) === '{こわれた',
    '元の文字は vrdemo:data:broken に残る',
  );
  await ctx.close();
}

async function backupRemind(b) {
  // 確定した日があり、2週間以上書き出していなければ起動時に1回トースト（1日1回）
  const { ctx, page } = await newPage(b, { human: false });
  await open(page, '/home', 'h1');
  await page.evaluate(
    ({ k, last, today }) => {
      const d = JSON.parse(localStorage.getItem(k));
      const v = d.visits.find((x) => x.date === today && !x.cancelled);
      d.snapshots = {
        ...d.snapshots,
        [today]: {
          date: today,
          at: 1,
          visits: [{ id: v.id, clientId: v.clientId, staffId: d.staff[0].id, start: null }],
        },
      };
      localStorage.setItem(k, JSON.stringify(d));
      localStorage.setItem(last, JSON.stringify({ date: '2026-01-01', kind: 'json' }));
      localStorage.removeItem('vrdemo:backup:reminded');
    },
    { k: STORAGE_KEY, last: BACKUP_LAST_KEY, today: TODAY },
  );
  await page.reload();
  await page
    .locator('.toast')
    .filter({ hasText: '控え（バックアップ）を2週間以上書き出していません' })
    .waitFor({ timeout: 5000 });
  check(true, '控えの知らせ：確定した日があり2週間以上書き出していなければトースト');
  await page.reload();
  await page.locator('h1').waitFor();
  await settle(page, 800);
  check(
    (await page.locator('.toast').filter({ hasText: '控え（バックアップ）' }).count()) === 0,
    '控えの知らせ：1日1回まで',
  );
  await ctx.close();
}

let b = null;
const steps = [
  [
    '準備',
    async () => {
      b = await launch();
    },
  ],
  ...[
    ['tour-first', tourFirst],
    ['tour-start', tourStart],
    ['tour-esc-skip', tourEscSkip],
    ['tour-today', tourToday],
    ['tour-again', tourAgain],
    ['tour-mobile-print', tourMobilePrint],
    ['file-pick', filePick],
    ['month-list', monthList],
    ['data-protect', dataProtect],
    ['broken-data', brokenData],
    ['backup-remind', backupRemind],
  ].map(([name, fn]) => [name, guard(() => fn(b), { label: name })]),
  ['後始末', () => check(native.length === 0, 'ブラウザのダイアログを出さない', native)],
];

module.exports = { steps };
if (require.main === module) runSteps(steps);
