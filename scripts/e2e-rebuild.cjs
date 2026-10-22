// 条件を変えたら、その場で影響と「作り直す」を出す帯（PRD D161〜D165。ADR-0025 追記）を本物のブラウザで確かめる：
// 条件が変わった日が無ければ帯を出さない、条件の重みの画面で点数の基準のプリセットの重みを変えると帯が出る（入力の間は数えない）、
// 条件の重みの表は点数の基準の重みを直し、この日だけ試す重みも基準にそろう（ADR-0035。PRD D233〜D235）、試す重みがプリセットと違えば案内、
// 「影響する日 N日（未確定 a日・確定済み b日）」の数が月の画面の要対応の「条件が変わった」と同じ、読み上げ（変わったときだけ）、
// ［後で］でその画面の間だけ隠れる（フォーカスは見出し・ほかの画面では出る・戻ると出る・データに保存しない）、
// ［作り直す］で月の画面の「条件が変わった日だけ作り直す」の欄が開き ?do= が消える、作り直すと確定済みの日だけ残り「要対応を見る」、
// 390px で収まる、印刷で出さない、ブラウザの確認を出さない。
// 条件の重みの表の下書き（PRD D286。ADR-0048）：動かしても保存しない・変わった行の色と「変更あり 3→2.5」・確定の帯（主ボタンは1つ・
// 巻いても見える）・取り消す・確定の確認（変わる重み・作り方・影響する日の数＝確定後の帯の数）・確定で保存とトースト・
// 下書きのまま画面を離れる（メニューのリンク・パレット）と確認・断れば留まる・再読込は beforeunload・基準を替えると下書きを捨てる。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-rebuild.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { answerConfirms } = require('./lib/confirmDialog.cjs');
const { BASE, OUT_DIR, TODAY, STORAGE_KEY, check, hashOf, runSteps, settle, until } = require('./lib/env.cjs');
const { sharedPage, openPage } = require('./lib/steps.cjs');

/** 帯が数え直すまでの待ち（components/rebuildBand の SETTLE_MS） */
const SETTLE = 600;

const monthNo = (ym) => Number(ym.slice(5, 7));
const band = (page) => page.getByTestId('rebuild-band');
const live = (page) => page.getByTestId('rebuild-live');
/** 影響する日の行・試す重みの案内の行（1つの帯の中の2行） */
const daysRow = (page) => page.getByTestId('rebuild-days-row');
const customRow = (page) => page.getByTestId('rebuild-custom');

/** 帯の数え（読み上げの領域の data-*。帯を隠していても数える） */
async function counts(page) {
  return live(page).evaluate((el) => ({
    days: Number(el.dataset.days),
    unconfirmed: Number(el.dataset.unconfirmed),
    confirmed: Number(el.dataset.confirmed),
  }));
}
/** 画面を開いて、帯が数え終わる（読み上げの領域が置かれる）まで待つ */
async function openSettings(page, hash) {
  await page.goto(`${BASE}#${hash}`);
  await page.locator('h1').first().waitFor({ timeout: 30000 });
  await page.locator('[data-testid="rebuild-live"][data-ready="1"]').waitFor({ state: 'attached', timeout: 30000 });
  await settle(page, 300);
}
/** 日の画面で今の案ができる（自動作成）まで待つ */
async function planReady(page) {
  await page.getByTestId('confirm-state').waitFor({ timeout: 60000 });
  await page.waitForFunction(
    () => {
      const s = document.querySelector('[data-testid="band-day"]')?.dataset.state;
      return s === 'plan' || s === 'confirmed';
    },
    null,
    { timeout: 60000 },
  );
}
/** この日だけ試す重み（data.rules）を、どのプリセットとも違う重みにする（日の予定の右の欄で変えたのと同じデータ） */
async function setTrialWeights(page) {
  await page.evaluate((key) => {
    const d = JSON.parse(localStorage.getItem(key));
    const r = d.rules.find((x) => x.type === 'wait');
    r.weight = r.weight >= 4.5 ? r.weight - 1.5 : r.weight + 1.5;
    localStorage.setItem(key, JSON.stringify(d));
  }, STORAGE_KEY);
  // 開いている画面は前のデータを持っているので読み直す
  await page.reload();
  await page.locator('h1').first().waitFor({ timeout: 30000 });
}
/** 保存してある点数の基準のプリセットと、この日だけ試す重み */
async function stored(page) {
  return page.evaluate((key) => {
    const d = JSON.parse(localStorage.getItem(key));
    const basis = d.presets.find((p) => p.id === d.scorePresetId) ?? d.presets[0];
    return { basis: basis.weights, rules: d.rules.map((r) => ({ type: r.type, weight: r.weight, hard: r.hard })) };
  }, STORAGE_KEY);
}
/** 条件の重みの表の下書き（PRD D286）：確定の帯・行の印 */
const draftBar = (page) => page.getByTestId('rules-draft-bar');
const mainSlider = (page) => page.getByTestId('narrow-rules').locator('input[type="range"]:not([disabled])').first();
/** メニューの「ホーム」のリンク */
const homeLink = (page) => page.locator('.side-nav a[href="#/home"]').first();
/** 表の1つ目のスライダーを1段動かす（0 なら上げる）。前後の値 */
async function nudge(page) {
  const slider = mainSlider(page);
  const before = Number(await slider.inputValue());
  await slider.focus();
  await page.keyboard.press(before > 0 ? 'ArrowLeft' : 'ArrowRight');
  await draftBar(page).waitFor({ timeout: 5000 });
  return { before, after: Number(await slider.inputValue()) };
}
/** 「変更を確定」を押し（確認は answerConfirms が答える）、帯が消えるまで待つ */
async function confirmDraft(page) {
  await page.getByTestId('rules-draft-confirm').click();
  await draftBar(page).waitFor({ state: 'detached', timeout: 10000 });
  await settle(page, 300);
}

/** 月の画面の要対応のうち「条件が変わった」の日付 */
async function staleInMonth(page, ym) {
  await page.goto(`${BASE}#/month?ym=${ym}`);
  await page.locator('[data-testid="progress-band"][data-ym]').waitFor({ timeout: 30000 });
  await page.getByTestId('band-attention').click();
  await settle(page, 300);
  const list = page.getByTestId('month-attention');
  if ((await list.count()) === 0) return 0;
  return list.locator('li').filter({ hasText: '条件が変わった' }).count();
}

// ---- 用意：今日の案（未確定）と、次の訪問のある日の案（確定）----
let SECOND = '';
async function prepare(page) {
  await page.goto(`${BASE}#/home`);
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  // 初期データ（今日から7日分の案を持つ。PRD D225）を作らせてから案を消し、案は今日と次の日の2日だけにする
  await page.reload();
  await page.getByTestId('home-tasks').waitFor({ timeout: 30000 });
  await page.evaluate((key) => {
    const d = JSON.parse(localStorage.getItem(key));
    d.aiPlans = {};
    d.aiRuns = {};
    localStorage.setItem(key, JSON.stringify(d));
  }, STORAGE_KEY);
  await page.goto(`${BASE}#/plan`);
  await page.reload();
  await planReady(page);
  const options = await page.locator('.date-switch select option').evaluateAll((os) => os.map((o) => o.value));
  SECOND = options.find((d) => d > TODAY) ?? '';
  await page.locator('.date-switch select').selectOption(SECOND);
  await page.waitForFunction((d) => document.querySelector('.date-switch select')?.value === d, SECOND);
  await settle(page, 500);
  await planReady(page);
  await page.waitForFunction(() => !document.querySelector('[data-testid="adopt"]')?.disabled, null, {
    timeout: 60000,
  });
  await page.getByTestId('adopt').click();
  await page.waitForFunction(
    () => /確定済み/.test(document.querySelector('[data-testid="confirm-state"]')?.textContent ?? ''),
    null,
    { timeout: 10000 },
  );
  check(!!SECOND, '用意：今日の案（未確定）と次の日の案（確定）', { today: TODAY, second: SECOND });
}

// ---- 条件の重みの画面：変わった日が無ければ出さない → 初期状態のまま基準のプリセット（標準）の重みを変えると出る ----
async function rules(page) {
  await openSettings(page, '/rules');
  check(
    (await band(page).count()) === 0,
    '条件が変わった日が無く、いまの条件がプリセットと同じなら帯を出さない',
    await counts(page),
  );
  check((await live(page).innerText()) === '', '読み上げの領域は最初から空で置く');
  // 点数の基準のプリセット（標準）の「待ち」の重みを動かす（スライダーの1段ずつ。入力の間は数えない）
  const preset = page.getByTestId('preset-edit').filter({ has: page.locator('.chip', { hasText: '点数の基準' }) });
  await preset.locator('summary').click();
  const slider = preset.locator('input[type="range"]:not([disabled])').last();
  await slider.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
  // 数え直しの間引き（600ms）の途中を見るので、固定の短い待ち（settle は間引きが終わるまで待ってしまう。ADR-0041）
  await page.waitForTimeout(100);
  check((await daysRow(page).count()) === 0, '動かしている間（止まってから少しのあいだ）は数え直さない');
  await daysRow(page).waitFor({ timeout: 10000 });
  const c = await counts(page);
  check(
    c.days === 2 && c.unconfirmed === 1 && c.confirmed === 1,
    '初期状態のまま標準の重みを変えると帯：影響する日 2日（未確定 1・確定済み 1）',
    c,
  );
  // 基準（標準）を直すと、この日だけ試す重みも新しい標準にそろうので、試す重みの案内は出ない（ADR-0035）
  check((await customRow(page).count()) === 0, '標準を変えると、試す重みも標準にそろい案内は出ない');
  const text = await daysRow(page).innerText();
  check(
    text.replace(/\s+/g, ' ').includes('条件が変わりました：影響する日 2日（未確定 1日・確定済み 1日）') &&
      /「標準」の重みで作り直します/.test(text),
    '帯の文（基準のプリセットで作り直すと書く）',
    text,
  );
  await page.waitForFunction(() => document.querySelector('[data-testid="rebuild-live"]')?.textContent !== '');
  check(
    /影響する日 2日/.test(await live(page).innerText()),
    '数えた結果が変わったときだけ読み上げる',
    await live(page).innerText(),
  );
  // 戻すと0日になり、1度だけ「影響する日は無くなりました」
  await slider.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await daysRow(page).waitFor({ state: 'detached', timeout: 10000 });
  check(
    (await live(page).innerText()) === '影響する日は無くなりました',
    '0日になったら「影響する日は無くなりました」と読み上げる',
    await live(page).innerText(),
  );
  await slider.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
  await daysRow(page).waitFor({ timeout: 10000 });
  // 条件の重みの表の重みは点数の基準（標準）の重み：動かすと標準と試す重みの両方が変わり、案内は出ない（ADR-0035）
  const main = page.getByTestId('narrow-rules').locator('input[type="range"]:not([disabled])').first();
  const type = await main.evaluate((el) => el.closest('tr')?.querySelector('.chip-type')?.textContent ?? '');
  const s0 = await stored(page);
  await main.focus();
  await page.keyboard.press('ArrowLeft');
  // 表の重みは下書き（PRD D286）：確定するまで保存しない
  await draftBar(page).waitFor({ timeout: 5000 });
  check(JSON.stringify(await stored(page)) === JSON.stringify(s0), '表のスライダーを動かしただけでは保存しない');
  await confirmDraft(page);
  await settle(page, SETTLE + 300);
  const s1 = await stored(page);
  const changed = Object.keys(s1.basis).filter((t) => s1.basis[t].weight !== s0.basis[t].weight);
  check(
    changed.length === 1 &&
      s1.rules.filter((r) => r.type === changed[0]).every((r) => r.weight === s1.basis[changed[0]].weight) &&
      (await customRow(page).count()) === 0,
    '条件の重みの表は点数の基準のプリセットの重みを直し、試す重みも同じになる（案内は出ない）',
    { type, changed, basis: s1.basis[changed[0]], rules: s1.rules },
  );
  // この日だけ試す重み（日の予定の右の欄）がどのプリセットとも違えば案内が出る（プリセットで作った案の日数は変わらない）
  await setTrialWeights(page);
  await openSettings(page, '/rules');
  await customRow(page).waitFor({ timeout: 5000 });
  const ct = await customRow(page).innerText();
  check(
    /日の予定で変えた重みが、どのプリセットとも違います。月のまとめて作る・作り直しは「標準」の重みで作ります/.test(
      ct,
    ) &&
      (await page.getByTestId('rebuild-today').count()) === 1 &&
      /今日の案を日の予定の重みで作り直す/.test(ct) &&
      /この重みをプリセットとして保存/.test(ct),
    'いまの条件がプリセットと違えば案内と［今日の案をいまの条件で作り直す］［プリセットとして保存］',
    ct,
  );
  await settle(page, SETTLE + 300);
  check(
    (await counts(page)).days === 2 &&
      (await band(page).count()) === 1 &&
      (await band(page).locator('.rb-row').count()) === 2,
    '影響する日といまの条件の案内は1つの帯の2行（プリセットで作った案の日数は変わらない）',
    await counts(page),
  );
  const go = page.getByTestId('rebuild-go');
  check(
    /作り直す/.test(await go.innerText()) && !!(await go.getAttribute('aria-describedby')),
    '［作り直す］（説明は aria-describedby）',
  );
  check(
    !/btn-primary/.test((await go.getAttribute('class')) ?? ''),
    '［作り直す］は主ボタンにしない（画面の主ボタンと重ねない）',
  );
  // 帯は画面の上（見出しより上）
  const order = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="rebuild-band"]');
    const h = document.querySelector('.app-main h1');
    return !!b && !!h && !!(b.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  check(order, '帯は画面の上（見出しより前）');
  // 下へ巻いて設定を変えていても見える（広い画面では上の帯のすぐ下に貼り付く）
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await settle(page, 200);
  const pos = await band(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const h = document.querySelector('.app-header').getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), header: Math.round(h.bottom) };
  });
  check(
    Math.abs(pos.top - pos.header) <= 1 && pos.bottom <= 1000,
    '下へ巻いても帯が上の帯のすぐ下（隙間なし）に見えている',
    pos,
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'rules-band.png') });
  // Tab で入った入力欄が帯の下に隠れない（scroll-padding-top）
  await page.evaluate(() => {
    const target = document.querySelector('.rules-table input:not([type="range"])');
    const all = [
      ...document.querySelectorAll(
        '.app-main input, .app-main button, .app-main a[href], .app-main select, .app-main summary',
      ),
    ].filter((x) => !x.disabled && x.getClientRects().length > 0);
    const prev = all[all.indexOf(target) - 1];
    prev.focus({ preventScroll: true });
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await settle(page, 100);
  await page.keyboard.press('Tab');
  await settle(page, 300);
  const hid = await page.evaluate(() => {
    const t = document.activeElement.getBoundingClientRect();
    const b = document.querySelector('[data-testid="rebuild-band"]').getBoundingClientRect();
    return { input: Math.round(t.top), band: Math.round(b.bottom), tag: document.activeElement.tagName };
  });
  check(hid.tag === 'INPUT' && hid.input >= hid.band, 'Tab で入った入力欄が帯の下に隠れない', hid);
}

// ---- 条件の重みの表の下書き（PRD D286。ADR-0048）：動かしても保存しない → 色と印・確定の帯 → 取り消す・確認・離れるときの確認 → 確定 ----
async function draft(page, { dlg }) {
  await openSettings(page, '/rules');
  const s0 = await stored(page);
  const same0 = async () => JSON.stringify(await stored(page)) === JSON.stringify(s0);
  const primaries = () => page.locator('.app-main .btn-primary:visible').count();
  check(
    (await draftBar(page).count()) === 0 && (await primaries()) === 1,
    '下書きが無ければ確定の帯は出さない（主ボタンは「条件を足す」の1つ）',
  );
  const row = mainSlider(page).locator('xpath=ancestor::tr[1]');
  const v = await nudge(page);
  // 保存しない・作り直しの帯も出ない
  await settle(page, SETTLE + 300);
  check(await same0(), '動かしても保存しない（下書き）');
  check(
    (await band(page).count()) === 0,
    '下書きの間は作り直しの帯を出さない（保存した値で数える）',
    await counts(page),
  );
  // 行の色と印（色だけに頼らず文字でも）
  const mark = await row.getByTestId('rules-draft-mark').innerText();
  const look = await row.evaluate((el) => ({
    cls: el.className,
    shadow: getComputedStyle(el.querySelector('td')).boxShadow,
    bg: getComputedStyle(el.querySelector('td')).backgroundColor,
  }));
  check(
    /is-draft/.test(look.cls) &&
      look.shadow !== 'none' &&
      look.bg !== 'rgba(0, 0, 0, 0)' &&
      mark === `変更あり ${v.before}→${v.after}`,
    '保存済みと違う行は左に注意の帯・淡い地と「変更あり 前→後」',
    { ...look, mark, v },
  );
  const confirmBtn = page.getByTestId('rules-draft-confirm');
  check(
    (await confirmBtn.innerText()) === '変更を確定（1件）' &&
      /btn-primary/.test((await confirmBtn.getAttribute('class')) ?? '') &&
      (await primaries()) === 1,
    '確定の帯：「変更を確定（1件）」が主ボタン（画面に1つ。「条件を足す」は枠になる）',
    await primaries(),
  );
  check(
    /btn-text/.test((await page.getByTestId('rules-draft-discard').getAttribute('class')) ?? ''),
    '「取り消す」は文字のボタン',
  );
  // 下へ巻いても上へ巻いても帯が画面の中（下に貼り付く）
  for (const where of ['bottom', 'top']) {
    await page.evaluate((w) => window.scrollTo(0, w === 'bottom' ? document.documentElement.scrollHeight : 0), where);
    await settle(page, 200);
    const box = await draftBar(page).boundingBox();
    const vh = page.viewportSize().height;
    check(!!box && box.y >= 0 && box.y + box.height <= vh + 1, `確定の帯は巻いても見える（${where}）`, { box, vh });
  }
  // 取り消す：下書きを捨てる（保存しない・スライダーが戻る・フォーカスは見出し）
  await page.getByTestId('rules-draft-discard').click();
  await draftBar(page).waitFor({ state: 'detached', timeout: 5000 });
  await settle(page, 200);
  check(
    Number(await mainSlider(page).inputValue()) === v.before &&
      (await same0()) &&
      (await page.getByTestId('rules-draft-mark').count()) === 0,
    '「取り消す」で下書きを捨てる（値が戻り、保存しない）',
  );
  check(
    await page.evaluate(() => document.activeElement === document.querySelector('.app-main h1')),
    '取り消したあとのフォーカスは画面の見出し',
  );
  // 確定の確認：取り消すと何も変わらない。本文に変わる重み・作り方・影響する日
  await nudge(page);
  dlg.answer = false;
  const m0 = dlg.messages.length;
  await confirmBtn.click();
  await until(() => dlg.messages.length > m0);
  await settle(page, 300);
  const msg = dlg.messages[m0] ?? '';
  const nums = /（未確定 (\d+)日・確定済み (\d+)日）/.exec(msg);
  check(
    msg.startsWith('重みの変更（1件）を確定しますか？') &&
      msg.includes(`${v.before}→${v.after}`) &&
      msg.includes('「標準」の重みが変わります') &&
      msg.includes('月のまとめて作る・作り直し・点数に、この重みを使います') &&
      msg.includes('が「条件が変わった」になります') &&
      msg.includes('確定済みの日は作り直しません') &&
      !!nums,
    '確定の確認：変わる条件と重み（前→後）・基準のプリセットになる・作り方・影響する日・確定済みは作り直さない',
    msg,
  );
  check((await draftBar(page).count()) === 1 && (await same0()), '確認を取り消すと下書きのまま（保存しない）');
  // 下書きのまま画面を離れる：メニューのリンク → 確認（断れば留まる）
  const m1 = dlg.messages.length;
  await homeLink(page).click();
  await until(() => dlg.messages.length > m1);
  await settle(page, 300);
  check(
    (dlg.messages[m1] ?? '').startsWith('重みの変更を捨てて、画面を移りますか？') &&
      hashOf(page).startsWith('#/rules') &&
      (await draftBar(page).count()) === 1,
    '下書きのままメニューで移ると確認。断れば留まり下書きも残る',
    { msg: dlg.messages[m1], hash: hashOf(page) },
  );
  // コマンドパレットで移るときも
  const m2 = dlg.messages.length;
  await page.keyboard.press('Control+k');
  await page.getByTestId('cmdk-input').fill('ホーム');
  await settle(page, 200);
  await page.keyboard.press('Enter');
  await until(() => dlg.messages.length > m2);
  await settle(page, 300);
  check(
    (dlg.messages[m2] ?? '').startsWith('重みの変更を捨てて') && hashOf(page).startsWith('#/rules'),
    'コマンドパレットで移るときも確認。断れば留まる',
    { msg: dlg.messages[m2], hash: hashOf(page) },
  );
  // 再読込は beforeunload（ブラウザの確認。answerConfirms が受ける）。読み直すと下書きは消え、保存はしない
  let unload = 0;
  const onDialog = (d) => {
    if (d.type() === 'beforeunload') unload++;
  };
  page.on('dialog', onDialog);
  await page.reload();
  await page.locator('h1').first().waitFor({ timeout: 30000 });
  page.off('dialog', onDialog);
  check(unload === 1, '下書きのまま再読込すると beforeunload の確認', unload);
  check((await draftBar(page).count()) === 0 && (await same0()), '読み直すと下書きは消え、保存もしない');
  // 点数の基準を替えると下書きを捨てる
  await openSettings(page, '/rules');
  await nudge(page);
  const radios = page.getByTestId('score-ruler-choice').locator('input[type="radio"]');
  // 下書きがあれば、捨てることを確かめてから替える（黙って捨てない）。断れば基準も下書きもそのまま
  dlg.answer = false;
  const mBasis = dlg.messages.length;
  await radios.nth(1).click();
  await until(() => dlg.messages.length > mBasis);
  await settle(page, 300);
  check(
    (dlg.messages[mBasis] ?? '').startsWith('点数の基準を「') &&
      (await draftBar(page).count()) === 1 &&
      (await radios.first().isChecked()),
    '下書きのまま基準を替えると確認。断れば基準も下書きもそのまま',
    dlg.messages[mBasis],
  );
  dlg.answer = true;
  await radios.nth(1).click();
  await settle(page, 300);
  check(
    (await draftBar(page).count()) === 0 && (await radios.nth(1).isChecked()),
    '点数の基準を替えると下書きを捨てる',
  );
  await radios.first().check();
  await settle(page, SETTLE + 300);
  check(await same0(), '基準を戻すと元の重み');
  // 確定：確認で確定 → 保存・トースト・帯の数は確認の本文の数と同じ
  await nudge(page);
  dlg.answer = true;
  await confirmDraft(page);
  const t = await page.locator('.toast').filter({ hasText: '重みを確定しました' }).first().innerText();
  check(!(await same0()) && /「標準」の重みを確定しました（1件）/.test(t), '確定すると保存し、トースト', t);
  await daysRow(page).waitFor({ timeout: 10000 });
  const c = await counts(page);
  check(
    !!nums && c.unconfirmed === Number(nums[1]) && c.confirmed === Number(nums[2]),
    '確認に出した影響する日の数＝確定後の作り直しの帯の数',
    { c, dialog: nums?.[0] },
  );
  // 元の重みに戻して確定する（後の段のため）
  const back = mainSlider(page);
  await back.focus();
  await page.keyboard.press(v.before > v.after ? 'ArrowRight' : 'ArrowLeft');
  await draftBar(page).waitFor({ timeout: 5000 });
  await confirmDraft(page);
  check(await same0(), '元の重みに戻して確定できる');
  // 下書きが無ければメニューで移っても確認しない
  const m3 = dlg.messages.length;
  await homeLink(page).click();
  await page.waitForFunction(() => location.hash.startsWith('#/home'), null, { timeout: 10000 });
  check(dlg.messages.length === m3, '下書きが無ければ確認せずに移る');
  // 下書きのまま移るを「捨てて移る」で確定すると移り、保存しない
  await openSettings(page, '/rules');
  await nudge(page);
  await homeLink(page).click();
  await page.waitForFunction(() => location.hash.startsWith('#/home'), null, { timeout: 10000 });
  check(await same0(), '確認で「捨てて移る」と移り、下書きは保存しない');
}

// ---- 月の要対応と同じ数 ----
let BAND_DAYS = 0;
async function sameAsMonth(page) {
  await openSettings(page, '/rules');
  await band(page).waitFor({ timeout: 10000 });
  BAND_DAYS = (await counts(page)).days;
  const ym = TODAY.slice(0, 7);
  let n = await staleInMonth(page, ym);
  if (SECOND.slice(0, 7) !== ym) n += await staleInMonth(page, SECOND.slice(0, 7));
  check(n === BAND_DAYS, '帯の影響する日＝月の予定の要対応の「条件が変わった」', { band: BAND_DAYS, month: n });
}

// ---- ［後で］：その画面の間だけ隠す ----
async function later(page) {
  await openSettings(page, '/rules');
  await band(page).waitFor({ timeout: 10000 });
  const before = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  await page.getByTestId('rebuild-later').click();
  check((await band(page).count()) === 0, '［後で］で帯が隠れる');
  check(
    await page.evaluate(() => document.activeElement === document.querySelector('.app-main h1')),
    '［後で］のあとのフォーカスは画面の見出し',
  );
  const after = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  check(before === after, '［後で］はデータに保存しない');
  // 同じ画面で条件をまた変えても、この画面の間は隠したまま（点数の基準の重みをさらに変えて確定する）
  const slider = page.locator('.rules-table input[type="range"]:not([disabled])').first();
  await slider.focus();
  await page.keyboard.press('ArrowLeft');
  await confirmDraft(page);
  await settle(page, 1200);
  check((await band(page).count()) === 0, '同じ画面の間は隠したまま');
  check((await live(page).innerText()) === '', '隠したあとは読み上げない');
  // ほかの設定の画面では出る（相性・〈スタッフ〉）
  for (const [hash, name] of [
    ['/compat', '相性'],
    ['/staff', '〈スタッフ〉'],
    ['/clients', '〈利用者さん〉'],
    ['/availability', '勤務時間（シフト）'],
    ['/types', '訪問の種類'],
    ['/items', '特性の項目'],
  ]) {
    await openSettings(page, hash);
    await daysRow(page).waitFor({ timeout: 10000 });
    const c = await counts(page);
    check(
      c.days === BAND_DAYS && (await customRow(page).count()) === 0,
      `${name}の画面にも同じ帯（いまの条件の案内は条件の重みの画面だけ）`,
      c,
    );
  }
  // 予定の画面・ホームには出さない（要対応・進み具合の帯に残る）
  await page.goto(`${BASE}#/month`);
  await page.locator('[data-testid="progress-band"][data-ym]').waitFor({ timeout: 30000 });
  check((await band(page).count()) === 0, '月の予定には作り直しの帯を出さない');
  check(
    Number(await page.getByTestId('band-attention').getAttribute('data-count')) >= 1,
    '月の進み具合の帯の要対応には残る',
  );
  // 条件の重みの画面へ戻ると出る
  await openSettings(page, '/rules');
  await band(page).waitFor({ timeout: 10000 });
  check(true, '画面を出て戻ると帯がまた出る');
}

// ---- ［作り直す］：月の画面の欄が開き、作り直すと確定済みの日だけ残る ----
async function rebuild(page) {
  await openSettings(page, '/rules');
  await band(page).waitFor({ timeout: 10000 });
  const ym = TODAY.slice(0, 7);
  await page.getByTestId('rebuild-go').click();
  const panel = page.getByRole('dialog', { name: `${monthNo(ym)}月の案をまとめて作る` });
  await panel.waitFor({ timeout: 10000 });
  await page.waitForFunction(() => !/do=/.test(decodeURIComponent(location.hash)));
  check(hashOf(page) === `#/month?ym=${ym}`, '［作り直す］で月の予定へ。?do= は消える', hashOf(page));
  check(await page.getByTestId('batch-mode-stale').isChecked(), '欄は「条件が変わった日だけ作り直す」');
  const count = await page.getByTestId('batch-count').innerText();
  check(/対象の日：\s*1日/.test(count), '対象は未確定の日だけ（1日）', count);
  const note = await page.getByTestId('batch-stale-note').innerText();
  check(/「標準」の重みで作り直します/.test(note), '欄に基準のプリセットで作り直すと書く', note);
  // 確定済みの日が同じ月なら欄に書く（月末で来月なら、この月の欄には書かない）
  const sameMonth = SECOND.slice(0, 7) === ym;
  check(
    sameMonth ? /確定済みの日 1日/.test(note) : !/確定済みの日/.test(note),
    '欄に（この月の）確定済みの日は作り直さないと書く',
    note,
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'month-panel.png') });
  await panel.getByRole('button', { name: '作り始める' }).click();
  await page
    .locator('.toast')
    .filter({ hasText: /の案を\d+日分作りました/ })
    .first()
    .waitFor({ timeout: 60000 });
  await openSettings(page, '/rules');
  await band(page).waitFor({ timeout: 10000 });
  const c = await counts(page);
  check(c.days === 1 && c.unconfirmed === 0 && c.confirmed === 1, '作り直すと確定済みの日だけ残る', c);
  const go = page.getByTestId('rebuild-go');
  check(/要対応を見る/.test(await go.innerText()), '確定済みの日だけなら［要対応を見る］', await go.innerText());
  await go.click();
  await page.getByTestId('month-attention').waitFor({ timeout: 10000 });
  check(!/do=/.test(hashOf(page)), '［要対応を見る］で月の予定の要対応（?do= は消える）', hashOf(page));
}

// ---- ［今日の案を日の予定の重みで作り直す］：日の画面で今日の案をこの日だけ試す重みで作る ----
async function today(page) {
  // 前の段で基準の重みを直すと試す重みも基準にそろうので、もう一度プリセットと違う試す重みにする（ADR-0035）
  await setTrialWeights(page);
  await openSettings(page, '/rules');
  await customRow(page).waitFor({ timeout: 10000 });
  const runsBefore = await page.evaluate(
    ({ key, d }) => (JSON.parse(localStorage.getItem(key)).aiRuns[d] ?? []).length,
    { key: STORAGE_KEY, d: TODAY },
  );
  await page.getByTestId('rebuild-today').click();
  await page.getByTestId('confirm-state').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => !/do=|date=/.test(decodeURIComponent(location.hash)));
  check(hashOf(page) === '#/plan', '日の予定へ。?date= と ?do= は消える', hashOf(page));
  check((await page.locator('.date-switch select').inputValue()) === TODAY, '今日を選んでいる');
  await page.waitForFunction(
    ({ key, d, n }) => (JSON.parse(localStorage.getItem(key)).aiRuns[d] ?? []).length > n,
    { key: STORAGE_KEY, d: TODAY, n: runsBefore },
    { timeout: 60000 },
  );
  const same = await page.evaluate(
    ({ key, d }) => {
      const x = JSON.parse(localStorage.getItem(key));
      const k = (rs) => JSON.stringify(rs.map((r) => [r.id, r.weight]));
      return k(x.aiPlans[d].rules) === k(x.rules);
    },
    { key: STORAGE_KEY, d: TODAY },
  );
  check(same, '今日の案をいまの条件で作り直した');
}

// ---- 日の画面の［作り直す］：基準のプリセットの重みで解くだけで、いまの条件は書き換えない（PR #40 の再レビュー）----
async function dayRemake(page) {
  // 今日の訪問の所要を変えて、今日の案（いまの条件で作った案）を「条件が変わった」にする
  await page.goto(`${BASE}#/home`);
  await page.locator('h1').waitFor();
  const rulesBefore = await page.evaluate(
    ({ key, d }) => {
      const x = JSON.parse(localStorage.getItem(key));
      const v = x.visits.find((y) => y.date === d && !y.cancelled);
      v.durationMinutes += 15;
      localStorage.setItem(key, JSON.stringify(x));
      return JSON.stringify(x.rules);
    },
    { key: STORAGE_KEY, d: TODAY },
  );
  await page.goto(`${BASE}#/plan`);
  await page.reload();
  await page.getByTestId('plan-stale').waitFor({ timeout: 60000 });
  check(
    /「標準」の重みで作り直します/.test(await page.getByTestId('plan-stale-with').innerText()),
    '日の予定の作り直すの帯に「標準」で作り直すと書く',
  );
  const runIdOf = () =>
    page.evaluate(({ key, d }) => JSON.parse(localStorage.getItem(key)).aiPlans[d]?.runId ?? null, {
      key: STORAGE_KEY,
      d: TODAY,
    });
  const id0 = await runIdOf();
  await page.getByTestId('plan-stale').getByRole('button', { name: '作り直す' }).click();
  // 作り終わる（今の案の元の記録が替わる）まで待つ
  await page.waitForFunction(
    ({ key, d, id }) => (JSON.parse(localStorage.getItem(key)).aiPlans[d]?.runId ?? null) !== id,
    { key: STORAGE_KEY, d: TODAY, id: id0 },
    { timeout: 60000 },
  );
  await settle(page, 500);
  check((await page.getByTestId('plan-stale').count()) === 0, '作り直すと日の予定の作り直すの帯が消える');
  const after = await page.evaluate((key) => JSON.stringify(JSON.parse(localStorage.getItem(key)).rules), STORAGE_KEY);
  check(after === rulesBefore, '日の予定の［作り直す］はいまの条件を書き換えない');
  await openSettings(page, '/rules');
  await settle(page, SETTLE + 300);
  const c = await counts(page);
  check(c.unconfirmed === 0, '作り直した日は「条件が変わった」から消え、ほかの日も増えない', c);
}

// ---- 390px・印刷 ----
async function mobile(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSettings(page, '/rules');
  await band(page).waitFor({ timeout: 10000 });
  const box = await band(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const btns = [...el.querySelectorAll('.btn')].map((b) => b.getBoundingClientRect().right);
    return { left: r.left, right: r.right, btnRight: Math.max(...btns), overflow: el.scrollWidth > el.clientWidth + 1 };
  });
  check(box.left >= 0 && box.right <= 390 && box.btnRight <= 390 && !box.overflow, '390px：帯が画面に収まる', box);
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  check(scrollW <= 390, '390px：横にはみ出さない', scrollW);
  await page.screenshot({ path: path.join(OUT_DIR, 'mobile-rules.png') });
  await page.emulateMedia({ media: 'print' });
  check(!(await band(page).isVisible()), '印刷：帯を出さない');
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 1400, height: 1000 });
}

const steps = sharedPage({
  open: async () => {
    const s = await openPage();
    // 確認は独自のダイアログで受ける（ネイティブのダイアログが出たら失敗。PRD D146）
    return { ...s, dlg: await answerConfirms(s.page) };
  },
  // 段に page と文脈（確認の答え dlg）を渡す
  call: (fn, s) => fn(s.page, s),
  steps: [
    ['prepare', prepare],
    ['draft', draft],
    ['rules', rules],
    ['same-as-month', sameAsMonth],
    ['later', later],
    ['mobile', mobile],
    ['rebuild', rebuild],
    ['today', today],
    ['day-remake', dayRemake],
  ],
  after: ({ dlg }) => check(dlg.native.length === 0, 'ブラウザのダイアログを出さない', dlg.native),
});

// 何が変わったかと「戻す」（PRD D290〜D292）の段は末尾の changeSteps（前の段と別のページ・初期データから）
steps.push(...changeSteps());

module.exports = { steps };
if (require.main === module) runSteps(steps);

// ---- 何が変わったかと「戻す」（PRD D290〜D292。ADR-0049）----
// 前の段とは別のページで、初期データ（今日から7日分の案）から始める。重みは条件の重みの画面の操作に頼らず、別のタブで localStorage を書き換える
function changeSteps() {
  /** 条件の変更の控えのキー（store/conditions の CONDITIONS_BASE_KEY） */
  const BASE_KEY = 'vrdemo:conditions:base';
  const CONDITION_KEYS = [
    'org',
    'items',
    'rules',
    'presets',
    'scorePresetId',
    'staff',
    'clients',
    'compat',
    'availability',
    'visitTypes',
    'patterns',
    'clientLeaves',
  ];
  const toggle = (page) => page.getByTestId('rebuild-changes-toggle');
  const items = (page) => page.getByTestId('rebuild-change');
  const baseOf = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), BASE_KEY);
  const firstStaff = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)).staff[0], STORAGE_KEY);
  const waitWeight = (page) =>
    page.evaluate((k) => {
      const d = JSON.parse(localStorage.getItem(k));
      return (d.presets.find((p) => p.id === d.scorePresetId) ?? d.presets[0]).weights.wait.weight;
    }, STORAGE_KEY);
  /** 別のタブで書き換える（開いている画面は storage の知らせで読み直す） */
  async function otherTab(page, fn, arg) {
    const other = await page.context().newPage();
    await other.goto(`${BASE}#/data`);
    await other.locator('h1').first().waitFor({ timeout: 30000 });
    await other.evaluate(fn, arg);
    await other.close();
    await settle(page, SETTLE + 300);
  }
  /** 一覧を開いて、行の文を返す */
  async function openList(page) {
    await toggle(page).waitFor({ timeout: 15000 });
    if ((await toggle(page).getAttribute('aria-expanded')) !== 'true') await toggle(page).click();
    await items(page).first().waitFor({ timeout: 5000 });
    return (await items(page).allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim());
  }

  async function fresh(page) {
    await page.goto(`${BASE}#/home`);
    await page.evaluate(
      ({ k, b }) => {
        localStorage.removeItem(k);
        localStorage.removeItem(b);
      },
      { k: STORAGE_KEY, b: BASE_KEY },
    );
    await page.reload();
    await page.getByTestId('home-tasks').waitFor({ timeout: 30000 });
    await openSettings(page, '/rules');
    check((await band(page).count()) === 0, '変更内容：初期データでは帯を出さない');
    check((await baseOf(page)) === null, '変更内容：はじめは控えが無い');
  }

  // 管理者設定で相性を切ると控えを取り、帯に「機能：相性を切」。戻すと元に戻り帯が消え、控えも消える
  async function features(page, { dlg }) {
    await page.goto(`${BASE}#/settings`);
    await page.locator('[data-testid="feature-templates"]').first().waitFor({ timeout: 30000 });
    dlg.answer = true;
    await page.getByRole('switch', { name: '相性', exact: true }).click();
    await page.locator('.toast').filter({ hasText: '相性を切りました' }).waitFor({ timeout: 5000 });
    await settle(page, 500);
    const b = await baseOf(page);
    check(
      !!b && typeof b.at === 'number' && b.data?.org?.features?.compat !== false && b.data.visits === undefined,
      '変更内容：update で条件が変わると、変わる前の条件を DemoData と別のキーに控える（訪問は入れない）',
      b && { at: b.at, features: b.data?.org?.features },
    );
    await openSettings(page, '/staff');
    await daysRow(page).waitFor({ timeout: 15000 });
    check(
      (await toggle(page).getAttribute('aria-expanded')) === 'false' &&
        /^変更内容を見る（1件）$/.test((await toggle(page).innerText()).trim()) &&
        (await items(page).count()) === 0,
      '変更内容：はじめ畳んで「変更内容を見る（1件）」',
      await toggle(page).innerText(),
    );
    const list = await openList(page);
    check(list.length === 1 && list[0].startsWith('機能：相性を切'), '変更内容：開くと「機能：相性を切」', list);
    check((await toggle(page).getAttribute('aria-expanded')) === 'true', '変更内容：開くと aria-expanded');
    dlg.messages.length = 0;
    dlg.answer = false;
    await page.getByTestId('rebuild-change-revert').first().click();
    await settle(page, 400);
    check(
      dlg.messages.length === 1 &&
        /「機能」を戻しますか？/.test(dlg.messages[0]) &&
        /機能：相性を切/.test(dlg.messages[0]),
      '変更内容：戻す前に独自の確認（何が戻るか）',
      dlg.messages,
    );
    check(
      (await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).org.features.compat, STORAGE_KEY)) === false,
      '変更内容：確認を取り消すと戻さない',
    );
    dlg.answer = true;
    await page.getByTestId('rebuild-change-revert').first().click();
    await daysRow(page).waitFor({ state: 'detached', timeout: 15000 });
    await settle(page, 300);
    check(
      (await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).org.features.compat, STORAGE_KEY)) !== false,
      '変更内容：戻すと相性が入に戻る',
    );
    check((await band(page).count()) === 0, '変更内容：戻すと影響する日が0日になり帯が消える');
    check((await baseOf(page)) === null, '変更内容：0日を数えたら控えを消す');
    check(
      (await live(page).innerText()) === '影響する日は無くなりました',
      '変更内容：戻したあと「影響する日は無くなりました」',
      await live(page).innerText(),
    );
  }

  // 控えがあるとき（別のタブで重みと〈スタッフ〉の勤務時間を変えた）：2件の一覧と「すべて戻す」
  async function revertAll(page, { dlg }) {
    await openSettings(page, '/rules');
    const before = await waitWeight(page);
    const staffBefore = await firstStaff(page);
    await otherTab(
      page,
      ({ k, b, keys, at }) => {
        const d = JSON.parse(localStorage.getItem(k));
        const base = JSON.stringify({ at, data: Object.fromEntries(keys.map((x) => [x, d[x]])) });
        const basis = d.presets.find((p) => p.id === d.scorePresetId) ?? d.presets[0];
        basis.weights.wait.weight = basis.weights.wait.weight >= 4 ? 1 : basis.weights.wait.weight + 1;
        for (const r of d.rules) if (r.type === 'wait') r.weight = basis.weights.wait.weight;
        d.staff[0].shiftEnd = d.staff[0].shiftEnd === '15:00' ? '14:00' : '15:00';
        // データを書いてから控え（ページの時計は止めてあり、控えが先に届くと時刻で前後を見分けられない）。控えの時刻は開いている画面の時計
        localStorage.setItem(k, JSON.stringify(d));
        localStorage.setItem(b, base);
      },
      { k: STORAGE_KEY, b: BASE_KEY, keys: CONDITION_KEYS, at: await page.evaluate(() => Date.now()) },
    );
    await daysRow(page).waitFor({ timeout: 15000 });
    const after = await waitWeight(page);
    const list = await openList(page);
    check(
      list.length === 2 &&
        list.some((x) => x.startsWith(`条件の重み：空き時間（待ち） ${before}→${after}`)) &&
        list.some((x) => x.includes(`${staffBefore.name}さんの勤務時間`)),
      '変更内容：控えと今の違い（条件の重み 前→今・〈スタッフ〉の勤務時間）',
      list,
    );
    check(/からの変更/.test(await page.getByTestId('rebuild-changes').innerText()), '変更内容：いつからの変更かを書く');
    await page.screenshot({ path: path.join(OUT_DIR, 'changes-open.png') });
    dlg.messages.length = 0;
    await page.getByTestId('rebuild-revert-all').click();
    await daysRow(page).waitFor({ state: 'detached', timeout: 15000 });
    check(
      dlg.messages.length === 1 &&
        /変更をすべて戻しますか？/.test(dlg.messages[0]) &&
        /条件の重み/.test(dlg.messages[0]),
      '変更内容：すべて戻すの確認に戻るものを出す',
      dlg.messages,
    );
    const staffNow = await firstStaff(page);
    const now = await waitWeight(page);
    check(now === before && staffNow.shiftEnd === staffBefore.shiftEnd, '変更内容：すべて戻すと重みも勤務時間も戻る', {
      before,
      now,
      shift: staffNow.shiftEnd,
    });
    await settle(page, 300);
    check((await baseOf(page)) === null && (await band(page).count()) === 0, '変更内容：帯と控えが消える');
  }

  // 控えが無いとき：作ったときの重みと点数の基準の重みの違いだけ出し、戻せる。それも無ければ記録が無いと書く
  async function noBase(page) {
    await openSettings(page, '/rules');
    const before = await waitWeight(page);
    await otherTab(
      page,
      ({ k, b }) => {
        localStorage.removeItem(b);
        const d = JSON.parse(localStorage.getItem(k));
        const basis = d.presets.find((p) => p.id === d.scorePresetId) ?? d.presets[0];
        basis.weights.wait.weight = basis.weights.wait.weight >= 4 ? 1 : basis.weights.wait.weight + 1;
        for (const r of d.rules) if (r.type === 'wait') r.weight = basis.weights.wait.weight;
        localStorage.setItem(k, JSON.stringify(d));
      },
      { k: STORAGE_KEY, b: BASE_KEY },
    );
    await daysRow(page).waitFor({ timeout: 15000 });
    const after = await waitWeight(page);
    const list = await openList(page);
    check(
      list.length === 1 && list[0].startsWith(`作ったときの重み：空き時間（待ち） ${before}、今：${after}`),
      '変更内容：控えが無いときは作ったときの重みと今の重み',
      list,
    );
    await page.getByTestId('rebuild-change-revert').click();
    await daysRow(page).waitFor({ state: 'detached', timeout: 15000 });
    await settle(page, 300);
    check((await waitWeight(page)) === before, '変更内容：戻すと基準の重みが作ったときの重みに戻る');
    check((await baseOf(page)) === null, '変更内容：戻したこと自体は控えない');
    // 重み以外（〈スタッフ〉の勤務時間）を控えなしで変えると、記録が無いと書く
    const staffBefore = await firstStaff(page);
    await otherTab(
      page,
      ({ k }) => {
        const d = JSON.parse(localStorage.getItem(k));
        d.staff[0].shiftEnd = d.staff[0].shiftEnd === '15:00' ? '14:00' : '15:00';
        localStorage.setItem(k, JSON.stringify(d));
      },
      { k: STORAGE_KEY },
    );
    await daysRow(page).waitFor({ timeout: 15000 });
    const none = page.getByTestId('rebuild-changes-none');
    const noneText = (await none.count()) > 0 ? await none.innerText() : null;
    check(
      !!noneText &&
        noneText.includes('何が変わったかはわかりません。作り直すか、日の予定で確かめてください') &&
        (await toggle(page).count()) === 0,
      '変更内容：記録が無ければ正直に書く（一覧と戻すは出さない）',
      noneText,
    );
    // 後片づけ（別のタブで元に戻す）
    await otherTab(
      page,
      ({ k, s }) => {
        const d = JSON.parse(localStorage.getItem(k));
        d.staff[0] = s;
        localStorage.setItem(k, JSON.stringify(d));
      },
      { k: STORAGE_KEY, s: staffBefore },
    );
    await daysRow(page).waitFor({ state: 'detached', timeout: 15000 });
  }

  // 足した・消したものは一覧に出すが［戻す］を出さない（PRD D291）。中身の変更（重み）だけ戻せる
  async function addRemove(page, { dlg }) {
    await openSettings(page, '/staff');
    const before = await waitWeight(page);
    await otherTab(
      page,
      ({ k, b, keys, at }) => {
        const d = JSON.parse(localStorage.getItem(k));
        const base = JSON.stringify({ at, data: Object.fromEntries(keys.map((x) => [x, d[x]])) });
        const basis = d.presets.find((p) => p.id === d.scorePresetId) ?? d.presets[0];
        basis.weights.wait.weight = basis.weights.wait.weight >= 4 ? 1 : basis.weights.wait.weight + 1;
        for (const r of d.rules) if (r.type === 'wait') r.weight = basis.weights.wait.weight;
        d.staff.push({ ...d.staff[0], id: 's-e2e-add', name: 'E2E追加', email: '' });
        localStorage.setItem(k, JSON.stringify(d));
        localStorage.setItem(b, base);
      },
      { k: STORAGE_KEY, b: BASE_KEY, keys: CONDITION_KEYS, at: await page.evaluate(() => Date.now()) },
    );
    await daysRow(page).waitFor({ timeout: 15000 });
    const list = await openList(page);
    const added = items(page).filter({ hasText: 'E2E追加さんを追加' });
    const weight = items(page).filter({ hasText: '条件の重み' });
    check(
      list.length === 2 &&
        (await added.count()) === 1 &&
        (await added.getByTestId('rebuild-change-revert').count()) === 0 &&
        (await weight.getByTestId('rebuild-change-revert').count()) === 1,
      '変更内容：足した人は一覧に出すが［戻す］を出さない（重みは戻せる）',
      list,
    );
    const note = page.getByTestId('rebuild-no-revert');
    check(
      (await note.count()) === 1 && (await note.innerText()).includes('各画面で直してください'),
      '変更内容：戻せないものがあれば「各画面で直してください」の短い文',
    );
    check(
      (await page.getByTestId('rebuild-revert-all').count()) === 0,
      '変更内容：戻せるものが1件なら［すべて戻す］は出さない',
    );
    dlg.answer = true;
    dlg.messages.length = 0;
    await weight.getByTestId('rebuild-change-revert').click();
    await settle(page, SETTLE + 300);
    check(
      (await waitWeight(page)) === before &&
        (await page.evaluate(
          (k) => JSON.parse(localStorage.getItem(k)).staff.some((s) => s.id === 's-e2e-add'),
          STORAGE_KEY,
        )),
      '変更内容：重みだけ戻り、足した人は残る',
      dlg.messages,
    );
    // 後片づけ：帯の無い画面（ホーム）へ移ってから、別のタブで足した人を消す → 影響する日が0日になり控えが消える（App の殻が数える）
    await page.goto(`${BASE}#/home`);
    await page.getByTestId('home-tasks').waitFor({ timeout: 30000 });
    await otherTab(
      page,
      ({ k }) => {
        const d = JSON.parse(localStorage.getItem(k));
        d.staff = d.staff.filter((s) => s.id !== 's-e2e-add');
        localStorage.setItem(k, JSON.stringify(d));
      },
      { k: STORAGE_KEY },
    );
    check(
      !!(await until(async () => (await baseOf(page)) === null, 15000)),
      '変更内容：帯の無い画面でも、0日になれば控えを消す',
    );
  }

  // 帯の無い画面（ホーム）で控えが届いても、影響する日が0日なら消す（月で作り直して0日になったときと同じ。PRD D290）
  async function sweep(page) {
    await page.goto(`${BASE}#/home`);
    await page.getByTestId('home-tasks').waitFor({ timeout: 30000 });
    await otherTab(
      page,
      ({ k, b, keys, at }) => {
        const d = JSON.parse(localStorage.getItem(k));
        // 条件でない所（乱数の種）だけ変えて、データの知らせも届ける（控えより後に止まったデータを数える）
        d.seed = (d.seed ?? 0) + 1;
        const base = JSON.stringify({ at, data: Object.fromEntries(keys.map((x) => [x, d[x]])) });
        localStorage.setItem(k, JSON.stringify(d));
        localStorage.setItem(b, base);
      },
      { k: STORAGE_KEY, b: BASE_KEY, keys: CONDITION_KEYS, at: await page.evaluate(() => Date.now()) },
    );
    check(
      !!(await until(async () => (await baseOf(page)) === null, 15000)),
      '変更内容：帯の無い画面でも、影響する日が0日なら控えを消す（後の変更と混ざらない）',
    );
  }

  const list = sharedPage({
    open: async () => {
      const s = await openPage();
      return { ...s, dlg: await answerConfirms(s.page) };
    },
    call: (fn, s) => fn(s.page, s),
    steps: [
      ['changes-fresh', fresh],
      ['changes-features', features],
      ['changes-revert-all', revertAll],
      ['changes-no-base', noBase],
      ['changes-add-remove', addRemove],
      ['changes-sweep', sweep],
    ],
    after: ({ dlg }) => check(dlg.native.length === 0, '変更内容：ブラウザのダイアログを出さない', dlg.native),
  });
  return list.map(([name, fn]) => [`変更内容・${name}`, fn]);
}
