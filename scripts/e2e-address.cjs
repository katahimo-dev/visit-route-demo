// 住所の入力の部品（AddressField。PRD D86〜D90・D118〜D121。ADR-0016）を本物のブラウザで確かめる。
// 外部の検索（郵便番号検索・国土地理院）は page.route の偽の応答に差し替え、外へは出さない：
//   1 開いただけ・打っただけでは送らない。送るのは zipcode・q だけ
//   2 郵便番号を7桁に直す（全角・ハイフン・空白の多い貼り付け）
//   3 候補・「住所を元に戻す」
//   4 見つからない・つながらない・時間切れ（8秒）で知らせを出し、データを変えない
//   5 連打しても1回だけ送る。探している途中に欄を閉じたら書かない
//   6 探している途中に欄を書き換えたら、古い応答で上書きしない
//   7 空き状況：郵便番号を打っても計算し直さない・ピンで見出しが切り替わる・ピンがあれば住所を打っても計算し直さない・
//     郵便番号で住所を差し替えてもピンは残る・仮押さえで postalCode が入る
//   8 〈スタッフ〉の自宅：郵便番号を保存しない
//   9 〈利用者さん〉の回帰：data-testid がそろっている・保存で postalCode が入る
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-address.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { skipTour } = require('./lib/tourSeen.cjs');
const { answerConfirms } = require('./lib/confirmDialog.cjs');
const { launch, BASE, OUT_DIR, NOW, check, stored, failShot, run } = require('./lib/env.cjs');

const ZIP_ONE = {
  status: 200,
  message: null,
  results: [{ address1: '宮城県', address2: '仙台市青葉区', address3: '一番町' }],
};
const ZIP_TWO = {
  status: 200,
  message: null,
  results: [
    { address1: '宮城県', address2: '仙台市青葉区', address3: '一番町' },
    { address1: '宮城県', address2: '仙台市青葉区', address3: '二日町' },
  ],
};
const feature = (lng, lat, title) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: { title },
});
const GSI_TWO = [
  feature(140.8716, 38.2601, '宮城県仙台市青葉区一番町一丁目'),
  feature(140.88, 38.27, '宮城県仙台市青葉区一番町二丁目'),
];
const GSI_ONE = [feature(140.8716, 38.2601, '宮城県仙台市青葉区一番町一丁目')];

/**
 * 偽の検索サービス。mode：ok（応答を返す）・notFound・abort（つながらない）・hang（応答しない）。delay で応答を遅らせる。
 * 呼ばれた URL（デコード済み）を calls に残す
 */
async function fakeServices(page) {
  const fake = {
    zip: { mode: 'ok', body: ZIP_ONE, delay: 0 },
    gsi: { mode: 'ok', body: GSI_ONE, delay: 0 },
    calls: [],
  };
  const handle = (key, notFoundBody) => async (route) => {
    const url = decodeURIComponent(route.request().url());
    fake.calls.push(url);
    const f = fake[key];
    if (f.mode === 'hang') return; // 応答しない（アプリの時間切れを待つ）
    if (f.delay) await new Promise((r) => setTimeout(r, f.delay));
    try {
      if (f.mode === 'abort') return await route.abort('failed');
      const body = f.mode === 'notFound' ? notFoundBody : f.body;
      // JSONP で呼び直されたときは callback で包む
      const cb = new URL(route.request().url()).searchParams.get('callback');
      await route.fulfill({
        status: 200,
        contentType: cb ? 'text/javascript' : 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: cb ? `${cb}(${JSON.stringify(body)})` : JSON.stringify(body),
      });
    } catch {
      // ページが閉じた・呼び出しを止めた
    }
  };
  await page.route(/zipcloud\.ibsnet\.co\.jp/, handle('zip', { status: 200, message: null, results: null }));
  await page.route(/msearch\.gsi\.go\.jp/, handle('gsi', []));
  return fake;
}

const pinText = (page, id) => page.getByTestId(`${id}-place`).getByTestId('place-pin-text').textContent();
/** 要素の文字が正規表現に当たるまで待つ */
async function until(loc, re, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const t = (await loc.textContent()) ?? (await loc.inputValue().catch(() => ''));
    if (re.test(t)) return t;
    await loc.page().waitForTimeout(50);
  }
  return (await loc.textContent()) ?? '';
}
async function untilValue(loc, pred, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await loc.inputValue();
    if (pred(v)) return v;
    await loc.page().waitForTimeout(50);
  }
  return loc.inputValue();
}

/** ?id= で閲覧の欄を開き、「編集する」で編集の欄にする（PRD D127・D128） */
async function openClient(page, id = 'c1') {
  await page.goto(`${BASE}#/clients?id=${id}`);
  await page.getByTestId('view-edit').click();
  await page.getByTestId('client-place').waitFor();
}

/** 1・2・3・9：送るもの・正規化・候補・元に戻す・〈利用者さん〉の回帰 */
async function basics(page, fake) {
  await openClient(page);
  const box = page.getByTestId('client-place');
  for (const id of [
    'client-postal',
    'client-postal-search',
    'client-address',
    'client-geo-search',
    'place-notice',
    'place-lookup-status',
    'place-pin',
    'place-pin-text',
  ]) {
    check((await box.getByTestId(id).count()) === 1, `〈利用者さん〉：data-testid「${id}」がある`);
  }
  check(
    /名前などほかの項目は送りません/.test(await box.getByTestId('place-notice').textContent()),
    '〈利用者さん〉：注記',
  );
  const before = await page.getByTestId('client-address').inputValue();
  await page.getByTestId('client-postal').fill('  ９８０ －　０８１１  ');
  await page.getByTestId('client-address').fill(`${before}`);
  await page.waitForTimeout(400);
  check(fake.calls.length === 0, '開いただけ・打っただけでは送らない', fake.calls);
  // 押せない理由は読み上げでも聞こえる
  await page.getByTestId('client-postal').fill('980-08');
  check(
    (await page.getByTestId('client-postal').getAttribute('aria-describedby')) !== null &&
      (await page.getByTestId('client-postal-search').getAttribute('aria-describedby')) !== null,
    '郵便番号のエラー・押せない理由を aria-describedby で結ぶ',
  );
  // aria-disabled のボタンも押せる（押しても送らない）
  await page.getByTestId('client-postal-search').click({ force: true });
  await page.waitForTimeout(200);
  check(fake.calls.length === 0, '7桁でなければ送らない');
  // 2 正規化（空白の多い貼り付け）
  await page.getByTestId('client-postal').fill('  ９８０ －　０８１１  ');
  await page.getByTestId('client-postal').blur();
  check((await page.getByTestId('client-postal').inputValue()) === '9800811', '郵便番号を7桁に直す（離れたとき）');
  // 3 候補・元に戻す
  fake.zip.body = ZIP_TWO;
  await page.getByTestId('client-address').fill('東京都千代田区1-1');
  await page.getByTestId('client-postal-search').click();
  await untilValue(page.getByTestId('client-address'), (v) => v === '宮城県仙台市青葉区一番町');
  check(fake.calls.length === 1 && /\?zipcode=9800811$/.test(fake.calls[0]), '送るのは zipcode だけ', fake.calls);
  check((await page.getByTestId('postal-candidate').count()) === 2, '郵便番号の候補が出る');
  await page.getByTestId('postal-candidate').nth(1).click();
  check(
    (await page.getByTestId('client-address').inputValue()) === '宮城県仙台市青葉区二日町',
    '候補を押すと住所を置き換える',
  );
  await page.getByTestId('client-address-undo').click();
  check(
    (await page.getByTestId('client-address').inputValue()) === '東京都千代田区1-1',
    '「住所を元に戻す」で最初の住所に戻る',
  );
  // 住所 → ピン（候補つき）
  fake.gsi.body = GSI_TWO;
  await page.getByTestId('client-address').fill('宮城県仙台市青葉区一番町1-1');
  await page.getByTestId('client-geo-search').click();
  await until(box.getByTestId('place-pin-text'), /38\.26010/);
  const q = fake.calls.at(-1);
  check(/AddressSearch\?q=宮城県仙台市青葉区一番町1-1$/.test(q), '送るのは q だけ', q);
  check((await page.getByTestId('geo-candidate').count()) === 2, '住所の候補が出る');
  await page.getByTestId('geo-candidate').nth(1).click();
  check(/38\.27000/.test(await pinText(page, 'client')), '候補を押すとピンを置き直す');
  // ピンがある状態で郵便番号から住所を差し替えても、ピンは残る
  fake.zip.body = ZIP_ONE;
  await page.getByTestId('client-address').fill('東京都');
  await page.getByTestId('client-postal-search').click();
  const s = await until(box.getByTestId('place-lookup-status'), /位置は前のまま/);
  check(/『住所から置き直す』を押してください/.test(s), 'ピンがあれば置き直しを促す知らせ', s);
  check(/38\.27000/.test(await pinText(page, 'client')), 'ピンは消さずに残す');
  // 9 保存で postalCode が入る
  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForTimeout(400);
  const c1 = (await stored(page)).clients.find((c) => c.id === 'c1');
  check(
    c1.place.postalCode === '9800811' && c1.place.address === '宮城県仙台市青葉区一番町' && c1.place.lat === 38.27,
    '〈利用者さん〉：保存で郵便番号・住所・位置が入る',
    c1.place,
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'address-client.png'), fullPage: true });
}

/** 4：見つからない・つながらない・時間切れ */
async function failures(page, fake) {
  await openClient(page, 'c2');
  const box = page.getByTestId('client-place');
  const status = box.getByTestId('place-lookup-status');
  const addr0 = await page.getByTestId('client-address').inputValue();
  const pin0 = await pinText(page, 'client');
  fake.zip.mode = 'notFound';
  await page.getByTestId('client-postal').fill('9999999');
  await page.getByTestId('client-postal-search').click();
  check(/見つかりませんでした/.test(await until(status, /見つかりませんでした/)), '郵便番号：見つからない');
  fake.zip.mode = 'abort';
  await page.getByTestId('client-postal-search').click();
  check(
    /つながりませんでした/.test(await until(status, /つながりませんでした/)),
    '郵便番号：つながらない（JSONP も失敗）',
  );
  fake.gsi.mode = 'notFound';
  await page.getByTestId('client-address').fill('どこにもない住所');
  await page.getByTestId('client-geo-search').click();
  check(/見つかりませんでした/.test(await until(status, /見つかりませんでした/)), '住所：見つからない');
  fake.gsi.mode = 'abort';
  await page.getByTestId('client-geo-search').click();
  check(/つながりませんでした/.test(await until(status, /つながりませんでした/)), '住所：つながらない');
  fake.gsi.mode = 'hang';
  await page.getByTestId('client-geo-search').click();
  check(
    /時間内に応答がありませんでした/.test(await until(status, /時間内に応答がありませんでした/, 11000)),
    '住所：時間切れ（8秒）',
  );
  check(
    (await page.getByTestId('client-address').inputValue()) === 'どこにもない住所' &&
      (await pinText(page, 'client')) === pin0,
    '失敗してもデータ（住所・位置）は変えない',
  );
  await page.getByRole('button', { name: '閉じる' }).last().click();
  const c2 = (await stored(page)).clients.find((c) => c.id === 'c2');
  check(c2.place.address === addr0, '失敗しても store は変えない');
}

/** 空き状況の「2 場所（任意）」を開く（PRD D185。はじめは畳んで要約の行だけ） */
async function openVacancyPlace(page) {
  const stage = page.getByTestId('vacancy-step-place');
  await stage.waitFor();
  if ((await stage.getAttribute('open')) === null) await page.getByTestId('vacancy-place-toggle').click();
  await page.getByTestId('vacancy-place').waitFor();
}

/** 5・6：連打・閉じる・途中で書き換え */
async function races(page, fake) {
  await page.goto(`${BASE}#/vacancy`);
  await openVacancyPlace(page);
  const status = page.getByTestId('vacancy-status');
  // 5 連打しても1回
  fake.zip.delay = 600;
  await page.getByTestId('vacancy-postal').fill('9800811');
  await page.getByTestId('vacancy-postal-search').click({ clickCount: 3, delay: 20 });
  // 探している間（aria-disabled）にもう一度押す
  await page.getByTestId('vacancy-postal-search').click({ force: true });
  await untilValue(page.getByTestId('vacancy-address'), (v) => v !== '');
  check(fake.calls.filter((u) => u.includes('zipcode=')).length === 1, '連打しても1回しか送らない', fake.calls.length);
  // 6 郵便番号を探している途中に住所を書き換えたら、古い応答で上書きしない
  fake.zip.delay = 800;
  await page.getByTestId('vacancy-address').fill('');
  await page.getByTestId('vacancy-postal').fill('9800812');
  await page.getByTestId('vacancy-postal-search').click();
  await page.waitForTimeout(150);
  await page.getByTestId('vacancy-address').fill('手で書いた住所');
  await page.waitForTimeout(1100);
  check(
    (await page.getByTestId('vacancy-address').inputValue()) === '手で書いた住所',
    '途中で住所を書き換えたら、郵便番号の古い応答で上書きしない',
  );
  check(!/住所を探しています/.test(await status.textContent()), '書き換えたら「探しています」を解く');
  // 郵便番号を書き換えた場合
  await page.getByTestId('vacancy-address').fill('');
  await page.getByTestId('vacancy-postal-search').click();
  await page.waitForTimeout(150);
  await page.getByTestId('vacancy-postal').fill('100-0001');
  await page.waitForTimeout(1100);
  check(
    (await page.getByTestId('vacancy-address').inputValue()) === '',
    '途中で郵便番号を書き換えたら、古い応答を捨てる',
  );
  // 住所を探している途中に住所を書き換えたら、ピンを置かない
  fake.gsi.delay = 800;
  await page.getByTestId('vacancy-address').fill('宮城県仙台市青葉区一番町');
  await page.getByTestId('vacancy-geo-search').click();
  await page.waitForTimeout(150);
  await page.getByTestId('vacancy-address').fill('宮城県仙台市青葉区一番町2-2');
  await page.waitForTimeout(1100);
  check(/未登録/.test(await pinText(page, 'vacancy')), '途中で住所を書き換えたら、古い応答でピンを置かない');
  fake.zip.delay = 0;
  fake.gsi.delay = 0;

  // 5 探している途中に欄を閉じたら書かない
  fake.zip.delay = 800;
  await openClient(page, 'c3');
  const addr0 = await page.getByTestId('client-address').inputValue();
  await page.getByTestId('client-postal').fill('9800811');
  await page.getByTestId('client-postal-search').click();
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: '閉じる' }).last().click();
  await page.waitForTimeout(1100);
  const c3 = (await stored(page)).clients.find((c) => c.id === 'c3');
  check(c3.place.address === addr0 && c3.place.postalCode !== '9800811', '探している途中に閉じたら書かない');
  await openClient(page, 'c3');
  check((await page.getByTestId('client-address').inputValue()) === addr0, '開き直しても古い応答は入らない');
  fake.zip.delay = 0;
}

/** 7：空き状況 */
async function vacancy(page) {
  await page.goto(`${BASE}#/vacancy`);
  await openVacancyPlace(page);
  await page.waitForTimeout(800);
  // 「計算しています…」が出たら記録する
  await page.evaluate(() => {
    window.__calc = 0;
    const card = document.querySelector('[data-testid="vacancy-table-card"]');
    new MutationObserver(() => {
      if (/計算しています/.test(card.textContent)) window.__calc++;
    }).observe(card, { subtree: true, childList: true, characterData: true });
  });
  const calcs = () => page.evaluate(() => window.__calc);
  const title = () => page.getByTestId('vacancy-table-card').locator('.section-title, h2, h3').first().textContent();
  check(/目安/.test(await title()), '場所が空なら目安');
  check(
    /条件などほかの項目は送りません/.test(await page.getByTestId('vacancy-notice').textContent()),
    '空き状況：注記',
  );
  await page.getByTestId('vacancy-postal').fill('980-0811');
  await page.waitForTimeout(700);
  check((await calcs()) === 0, '郵便番号を打っても計算し直さない');
  await page.getByTestId('vacancy-postal-search').click();
  await untilValue(page.getByTestId('vacancy-address'), (v) => v === '宮城県仙台市青葉区一番町');
  check((await page.getByTestId('vacancy-postal').inputValue()) === '9800811', '空き状況：郵便番号を7桁に直す');
  await page.getByTestId('vacancy-address').fill('宮城県仙台市青葉区一番町1-1');
  const gridBefore = await page.getByTestId('vacancy-grid').textContent();
  await page.getByTestId('vacancy-geo-search').click();
  await until(page.getByTestId('vacancy-place').getByTestId('place-pin-text'), /38\.26010/);
  await page.waitForTimeout(1200);
  const t1 = await title();
  check(/宮城県仙台市青葉区一番町1-1への移動を含む/.test(t1), 'ピンで見出しが「移動を含む」に切り替わる', t1);
  check(
    !/約/.test(await page.getByTestId('vacancy-grid').textContent()) &&
      gridBefore !== (await page.getByTestId('vacancy-grid').textContent()),
    '表が移動を含む値に変わる',
  );
  // ピンがあるとき住所を打っても計算し直さない。見出しはピンを置いたときの住所のまま
  const n = await calcs();
  await page.getByTestId('vacancy-address').fill('宮城県仙台市青葉区一番町1-1 ビル');
  await page.waitForTimeout(700);
  check((await calcs()) === n, 'ピンがあるとき住所を打っても計算し直さない');
  check(/一番町1-1への移動を含む/.test(await title()), '見出しはピンを置いたときの住所');
  // 郵便番号から住所を差し替えてもピンは残り、知らせを出す
  await page.getByTestId('vacancy-address').fill('東京都');
  await page.getByTestId('vacancy-postal-search').click();
  const s = await until(page.getByTestId('vacancy-status'), /位置は前のまま/);
  check(
    /『住所から置き直す』/.test(s) && /38\.26010/.test(await pinText(page, 'vacancy')),
    '空き状況：住所を差し替えてもピンは残る',
  );
  check(/一番町1-1への移動を含む/.test(await title()), '差し替えても見出しはピンを置いたときの住所');
  await page.screenshot({ path: path.join(OUT_DIR, 'address-vacancy.png'), fullPage: true });
  // 仮押さえで postalCode が入る
  await page.getByTestId('hold-open').click();
  await page.getByTestId('hold-name').fill('問い合わせ 確認さん');
  await page.getByTestId('hold-register').click();
  await page.waitForTimeout(600);
  const c = (await stored(page)).clients.find((x) => x.displayName === '問い合わせ 確認さん');
  check(
    c && c.place.postalCode === '9800811' && c.place.lat === 38.2601,
    '仮押さえで postalCode・位置が入る',
    c?.place,
  );
  check(c && !('pinnedAddress' in c.place), '仮押さえの場所に画面だけの値を入れない');
}

/** 7：仮押さえの注記の出し分け */
async function holdNote(page) {
  await page.goto(`${BASE}#/vacancy`);
  await openVacancyPlace(page);
  await page.waitForTimeout(800);
  await page.getByTestId('hold-open').click();
  check(
    /場所が空なので、住所・位置はあとで/.test(await page.locator('.side-panel, [role="dialog"]').last().textContent()),
    '仮押さえ：場所が空の注記',
  );
  await page.getByRole('button', { name: '閉じる' }).last().click();
  await page.getByTestId('vacancy-address').fill('宮城県仙台市青葉区一番町');
  await page.getByTestId('hold-open').click();
  const t = await page.locator('.side-panel, [role="dialog"]').last().textContent();
  check(/位置はあとで入れてください/.test(t) && !/場所が空なので/.test(t), '仮押さえ：住所だけのときの注記');
}

/** 8：〈スタッフ〉の自宅 */
async function staffHome(page) {
  await page.goto(`${BASE}#/staff?id=s1`);
  await page.getByTestId('view-edit').click();
  await page.getByTestId('staff-home-place').waitFor();
  check(
    /保存しません/.test(await page.getByTestId('staff-home-place').textContent()),
    '自宅：郵便番号は保存しないと書く',
  );
  await page.getByTestId('staff-home-postal').fill('980-0811');
  await page.getByTestId('staff-home-postal-search').click();
  await untilValue(page.getByTestId('staff-home-address'), (v) => v.startsWith('宮城県仙台市青葉区一番町'));
  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForTimeout(400);
  const s1 = (await stored(page)).staff.find((s) => s.id === 's1');
  check(
    s1.home.address.startsWith('宮城県仙台市青葉区一番町') && !('postalCode' in s1.home),
    '自宅：住所は保存し、郵便番号は保存しない',
    s1.home,
  );
  // 保存すると閲覧の欄に戻る（PRD D129）。閲覧には郵便番号を出さず、編集し直すと郵便番号は空
  check(
    (await page.getByTestId('person-view').count()) === 1 &&
      !/980-?0811/.test(await page.getByTestId('person-view').textContent()),
    '自宅：保存すると閲覧の欄に戻り、郵便番号は出ない',
  );
  await page.getByTestId('view-edit').click();
  await page.getByTestId('staff-home-place').waitFor();
  check((await page.getByTestId('staff-home-postal').inputValue()) === '', '自宅：編集し直すと郵便番号は空');
  await page.getByRole('button', { name: '閉じる' }).last().click();
  await page.goto(`${BASE}#/staff?id=s1`);
  await page.getByTestId('view-edit').click();
  await page.getByTestId('staff-home-place').waitFor();
  check((await page.getByTestId('staff-home-postal').inputValue()) === '', '自宅：開き直すと郵便番号は空');
}

run(async () => {
  const browser = await launch();
  const errors = [];
  for (const step of [basics, failures, races, vacancy, holdNote, staffHome]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // 初回の案内ツアーを見た扱いにする（PRD D193）
    await skipTour(ctx);
    const page = await ctx.newPage();
    // ページの時計を止める（ほかの e2e と同じ。タイマーは止めないので時間切れの待ちはそのまま）
    await page.clock.setFixedTime(NOW);
    page.on('pageerror', (e) => errors.push(String(e)));
    // 確認は独自のダイアログで受ける（ネイティブのダイアログが出たら失敗。PRD D146）
    const dlg = await answerConfirms(page);
    const fake = await fakeServices(page);
    try {
      await step(page, fake);
    } catch (e) {
      check(false, `${step.name} が止まった`, String(e).split('\n')[0]);
      await failShot(page, step.name);
    }
    check(dlg.native.length === 0, `${step.name}：ブラウザのダイアログを出さない`, dlg.native);
    // 送り先は2つのサービスだけ
    check(
      fake.calls.every(
        (u) =>
          u.startsWith('https://zipcloud.ibsnet.co.jp/api/search?zipcode=') ||
          u.startsWith('https://msearch.gsi.go.jp/address-search/AddressSearch?q='),
      ),
      `${step.name}：送り先は郵便番号検索・国土地理院だけ`,
    );
    await ctx.close();
  }
  check(errors.length === 0, 'ページのエラーなし', errors.join(' / '));
  await browser.close();
});
