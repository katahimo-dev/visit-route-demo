// 〈スタッフ〉・〈利用者さん〉の画面の閲覧の欄（PRD D127〜D131。ADR-0023）を本物のブラウザで確かめる：
// 一覧・`?id=`・相性の吹き出しのリンクで閲覧の欄が開き入力欄が無い（中身・地図・節の見出しは h3）／「編集する」で編集の欄（主ボタンにしない）／
// 保存・取り消しで閲覧に戻りフォーカスは「編集する」／変更があるまま取り消す・×・Esc・別の人の `?id=` で確認が出て、断れば編集が続く／
// 変更が無い・同じ人の `?id=`・特性を未確認に戻しただけ・担当できる人を限るを入れて外しただけなら確認しない／変更があるときだけ beforeunload／
// 「追加」はすぐ編集の欄／「まとめて地図に置く」の「編集」は編集の欄／定期パターン・休みは閲覧では読むだけ（これからの休みと終わった休みの件数）／
// 最終勤務日の振り直しの欄は今どおり。
// 相性・担当の名前（PRD D198〜D200）：〈スタッフ〉の閲覧の欄にいつもの担当・相性の記号ごとの〈利用者さん〉の名前（人数・利用中だけ・
// 13人目から「あと N人」）、名前で詳細の吹き出し（欄の中に出す・Tab は吹き出しの中を進み端で閉じて名前へ・Esc は吹き出しだけ閉じる・欄を巻いて名前が隠れたら閉じる）、リンクで相手の閲覧の欄、
// 〈利用者さん〉の担当できる人・いつもの担当も名前から。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-view.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { skipTour } = require('./lib/tourSeen.cjs');
const { answerConfirms } = require('./lib/confirmDialog.cjs');
const {
  launch,
  BASE,
  OUT_DIR,
  JST,
  NOW,
  STORAGE_KEY,
  check,
  settle,
  urlOf,
  stored,
  failShot,
  run,
} = require('./lib/env.cjs');

const panel = (page) => page.locator('.drawer');
const view = (page) => page.getByTestId('person-view');
/** 欄の中の入力欄の数 */
const inputs = (page) => panel(page).locator('input, select, textarea').count();

/** 確認（独自の確認ダイアログ。PRD D146）の受け方を決め、出た文（見出しと本文）を記録する */
const dialogs = (page) => answerConfirms(page);

async function open(page, hash, ready) {
  // 同じ文書の中で hash を移してから読み直すと、読み直す前に `?id=` が処理されて URL から消えることがあるので、
  // about:blank を挟んで開く（e2e-home と同じ）
  await page.goto('about:blank');
  await page.goto(`${BASE}#${hash}`);
  await page.locator(ready).first().waitFor({ timeout: 30000 });
  await settle(page, 400);
}

/** 閲覧の欄が開いていて、入力欄が無く、「編集する」が主ボタンでない */
async function isView(page, where, words = []) {
  await view(page).waitFor({ timeout: 5000 });
  const n = await inputs(page);
  const edit = panel(page).getByTestId('view-edit');
  const cls = (await edit.getAttribute('class')) ?? '';
  const text = (await view(page).textContent()) ?? '';
  check(n === 0, `${where}：閲覧の欄に入力欄が無い`, n);
  check((await edit.count()) === 1 && !cls.includes('btn-primary'), `${where}：右上に「編集する」（主ボタンでない）`);
  check(
    words.every((w) => text.includes(w)),
    `${where}：閲覧の中身`,
    words.filter((w) => !text.includes(w)),
  );
  check((await panel(page).locator('.btn-primary').count()) === 0, `${where}：閲覧の欄に主ボタンが無い`);
}

async function clients(page, dlg) {
  await open(page, '/clients', '[data-testid="client-row"]');
  // 一覧の行の「開く」で閲覧
  await page.getByRole('button', { name: '図書館 ふみを開く' }).click();
  await isView(page, '〈利用者さん〉・一覧', [
    '段階',
    '住所',
    '地図の位置',
    '特性',
    '必要条件',
    '希望',
    '担当できる人',
    'いつもの担当',
    '訪問先の決まりごと',
    '定期パターン',
    '休み',
    '紹介元',
    '—',
  ]);
  // 地図の本体は別のチャンク（PRD D248）：読み終わるのを待つ
  await view(page)
    .locator('.leaflet-container')
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  check(
    (await view(page).locator('.leaflet-container').count()) === 1,
    '〈利用者さん〉：位置があれば地図の小さな表示（読むだけ）',
  );
  // 定期パターン・休みは読むだけ（足す・直す・消すのボタンを出さない）
  check(
    (await panel(page).getByTestId('patterns-section').count()) === 0 &&
      (await panel(page)
        .getByRole('button', { name: /パターンを追加|パターンを直す|パターンを消す|休みを入れる/ })
        .count()) === 0,
    '〈利用者さん〉：閲覧では定期パターン・休みを書き換えるボタンが無い',
  );
  check(
    (await page.getByTestId('view-patterns').locator('li').count()) > 0,
    '〈利用者さん〉：定期パターンを読むだけで並べる',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'client-view.png') });

  // 「編集する」で編集の欄（最初の入力欄へフォーカス）
  await page.getByTestId('view-edit').click();
  await settle(page);
  check((await inputs(page)) > 5 && (await view(page).count()) === 0, '〈利用者さん〉：「編集する」で編集の欄になる');
  check(
    await page.evaluate(() => document.activeElement?.tagName === 'INPUT'),
    '〈利用者さん〉：編集の欄にしたら入力欄へフォーカス',
  );
  check(
    (await panel(page).getByTestId('patterns-section').count()) === 1,
    '〈利用者さん〉：編集では定期パターンの節を出す',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'client-edit.png') });

  // 変更なしの取り消し：確認なしで閲覧に戻る
  dlg.messages.length = 0;
  await page.getByTestId('edit-cancel').click();
  await settle(page);
  check(
    dlg.messages.length === 0 && (await view(page).count()) === 1,
    '〈利用者さん〉：変更なしの取り消しは確認なしで閲覧に戻る',
  );

  // 変更ありの取り消し：確認が出る。断れば編集のまま、受ければ捨てて閲覧に戻る
  await page.getByTestId('view-edit').click();
  const memo = panel(page).locator('label', { hasText: 'メモ' }).first().locator('input');
  await memo.fill('閲覧の確認のメモ');
  dlg.answer = false;
  await page.getByTestId('edit-cancel').click();
  await settle(page);
  check(
    dlg.messages.length === 1 &&
      /閲覧に戻りますか/.test(dlg.messages[0]) &&
      (await memo.inputValue()) === '閲覧の確認のメモ',
    '〈利用者さん〉：変更ありの取り消しは確認が出て、断れば編集のまま',
    dlg.messages,
  );
  dlg.answer = true;
  await page.getByTestId('edit-cancel').click();
  await settle(page);
  const c1a = (await stored(page)).clients.find((c) => c.id === 'c1');
  check(
    (await view(page).count()) === 1 && c1a.note !== '閲覧の確認のメモ',
    '〈利用者さん〉：受ければ変更を捨てて閲覧に戻る',
  );

  // 保存で閲覧に戻り、閲覧に保存した中身が出る
  await page.getByTestId('view-edit').click();
  await panel(page).locator('label', { hasText: 'メモ' }).first().locator('input').fill('保存した閲覧のメモ');
  dlg.messages.length = 0;
  await page.getByRole('button', { name: '保存' }).click();
  await settle(page, 600);
  const c1b = (await stored(page)).clients.find((c) => c.id === 'c1');
  check(
    (await view(page).count()) === 1 &&
      (await view(page).textContent()).includes('保存した閲覧のメモ') &&
      c1b.note === '保存した閲覧のメモ' &&
      dlg.messages.length === 0,
    '〈利用者さん〉：保存すると閲覧に戻り、保存した中身が出る',
  );

  // 変更ありで閉じる（Esc・×）：確認が出る
  await page.getByTestId('view-edit').click();
  await panel(page).locator('label', { hasText: 'メモ' }).first().locator('input').fill('閉じる前のメモ');
  dlg.answer = false;
  dlg.messages.length = 0;
  await page.keyboard.press('Escape');
  await settle(page);
  check(
    dlg.messages.length === 1 && /欄を閉じますか/.test(dlg.messages[0]) && (await panel(page).count()) === 1,
    '〈利用者さん〉：変更ありで Esc を押すと確認が出て、断れば欄が残る',
  );
  dlg.answer = true;
  await panel(page).getByRole('button', { name: '閉じる' }).click();
  await settle(page);
  check((await panel(page).count()) === 0, '〈利用者さん〉：× で確認を受けると欄を閉じる');

  // ?id= で閲覧（URL から id を消す）
  await page.goto(`${BASE}#/clients?id=c2`);
  await settle(page, 500);
  await isView(page, '〈利用者さん〉・?id=');
  check(!urlOf(page).includes('id='), '〈利用者さん〉：?id= で開いたら URL から id を消す');
  check(
    (await panel(page).locator('h2').first().textContent()).includes('動物公園 やぎお'),
    '〈利用者さん〉：?id= の人の閲覧の欄',
  );

  // 編集中に変更があるまま別の人を ?id= で開く：確認が出る（受ければその人の閲覧）
  await page.getByTestId('view-edit').click();
  await panel(page).locator('label', { hasText: 'メモ' }).first().locator('input').fill('別の人を開く前');
  dlg.messages.length = 0;
  dlg.answer = false;
  await page.evaluate(() => {
    location.hash = '#/clients?id=c1';
  });
  await settle(page, 500);
  check(
    dlg.messages.length === 1 && /図書館 ふみを開きますか/.test(dlg.messages[0]) && (await view(page).count()) === 0,
    '〈利用者さん〉：変更があるまま別の人を開くと確認が出て、断れば編集のまま',
    dlg.messages,
  );
  dlg.answer = true;
  await page.evaluate(() => {
    location.hash = '#/clients?id=c1';
  });
  await settle(page, 500);
  check(
    (await view(page).count()) === 1 && (await panel(page).locator('h2').first().textContent()).includes('図書館 ふみ'),
    '〈利用者さん〉：受ければ別の人の閲覧の欄になる',
  );
  await panel(page).getByRole('button', { name: '閉じる' }).click();

  // 「追加」はすぐ編集の欄。何も入れずに取り消すと確認なしで閉じる
  await page.getByRole('button', { name: /を追加$/ }).click();
  await settle(page);
  check(
    (await view(page).count()) === 0 &&
      (await inputs(page)) > 5 &&
      (await panel(page).locator('h2').first().textContent()).includes('を追加'),
    '〈利用者さん〉：「追加」はすぐ編集の欄で開く',
  );
  dlg.messages.length = 0;
  await page.getByTestId('edit-cancel').click();
  await settle(page);
  check(
    (await panel(page).count()) === 0 && dlg.messages.length === 0,
    '〈利用者さん〉：何も入れない追加の取り消しは確認なしで閉じる',
  );
  // 名前を入れて保存すると、その人の閲覧の欄
  await page.getByRole('button', { name: /を追加$/ }).click();
  await panel(page).locator('label', { hasText: '表示名' }).locator('input').fill('閲覧 たしかめ');
  await page.getByRole('button', { name: '保存' }).click();
  await settle(page);
  check(
    (await view(page).count()) === 1 &&
      (await panel(page).locator('h2').first().textContent()).includes('閲覧 たしかめ'),
    '〈利用者さん〉：追加して保存すると、その人の閲覧の欄になる',
  );
}

async function staff(page, dlg) {
  await open(page, '/staff', '.people-table tbody tr');
  await page.getByRole('button', { name: '市役所 まち子を開く' }).click();
  await isView(page, '〈スタッフ〉・一覧', [
    '特性',
    '稼働時間',
    '自宅',
    '最終勤務日',
    'メールアドレス',
    '移動手段',
    '相性',
  ]);
  await page.screenshot({ path: path.join(OUT_DIR, 'staff-view.png') });
  await page.getByTestId('view-edit').click();
  await settle(page);
  check((await inputs(page)) > 5 && (await view(page).count()) === 0, '〈スタッフ〉：「編集する」で編集の欄になる');
  // 変更なしの取り消し
  dlg.messages.length = 0;
  await page.getByTestId('edit-cancel').click();
  await settle(page);
  check(
    dlg.messages.length === 0 && (await view(page).count()) === 1,
    '〈スタッフ〉：変更なしの取り消しは確認なしで閲覧に戻る',
  );
  // 変更ありの取り消し
  await page.getByTestId('view-edit').click();
  await page.getByTestId('staff-email').fill('view-check@example.com');
  dlg.answer = false;
  await page.getByTestId('edit-cancel').click();
  await settle(page);
  check(
    dlg.messages.length === 1 && /閲覧に戻りますか/.test(dlg.messages[0]),
    '〈スタッフ〉：変更ありの取り消しは確認が出る',
  );
  dlg.answer = true;
  // 保存で閲覧に戻る
  await page.getByRole('button', { name: '保存' }).click();
  await settle(page, 600);
  const s1 = (await stored(page)).staff.find((s) => s.id === 's1');
  check(
    (await view(page).count()) === 1 &&
      (await view(page).textContent()).includes('view-check@example.com') &&
      s1.email === 'view-check@example.com',
    '〈スタッフ〉：保存すると閲覧に戻り、保存した中身が出る',
  );
  await panel(page).getByRole('button', { name: '閉じる' }).click();
  // ?id=
  await page.goto(`${BASE}#/staff?id=s2`);
  await settle(page, 500);
  await isView(page, '〈スタッフ〉・?id=');
  check(!urlOf(page).includes('id='), '〈スタッフ〉：?id= で開いたら URL から id を消す');
  await panel(page).getByRole('button', { name: '閉じる' }).click();
  // 追加
  await page.getByRole('button', { name: /を追加$/ }).click();
  await settle(page);
  check(
    (await view(page).count()) === 0 && (await panel(page).locator('h2').first().textContent()).includes('を追加'),
    '〈スタッフ〉：「追加」はすぐ編集の欄で開く',
  );
  await page.getByTestId('edit-cancel').click();
  // 最終勤務日を入れて保存すると、今までどおり担当の振り直しの欄（閲覧に戻らない）
  await page.getByRole('button', { name: '市役所 まち子を開く' }).click();
  await page.getByTestId('view-edit').click();
  const d = new Date(NOW.getTime() + JST + 7 * 86400000).toISOString().slice(0, 10);
  await page.getByTestId('staff-lastday-input').fill(d);
  await page.getByRole('button', { name: '保存' }).click();
  await settle(page, 500);
  const head = (await panel(page).locator('h2').first().textContent()) ?? '';
  check(
    (await view(page).count()) === 0 && /振り直し/.test(head),
    '〈スタッフ〉：最終勤務日を入れて保存すると、今までどおり担当の振り直しの欄が開く',
    head,
  );
}

/** 相性の画面の吹き出しのリンクで閲覧の欄 */
async function links(page) {
  await open(page, '/compat', '[data-testid="compat-head-btn"]');
  await page.getByTestId('compat-head-btn').first().click();
  await page.getByTestId('compat-pop-link').click();
  await settle(page, 500);
  await isView(page, '相性の吹き出しのリンク（〈スタッフ〉）');
  await open(page, '/compat', '[data-testid="compat-client-btn"]');
  await page.getByTestId('compat-client-btn').first().click();
  await page.getByTestId('compat-pop-link').click();
  await settle(page, 500);
  await isView(page, '相性の吹き出しのリンク（〈利用者さん〉）');
}

/** 相性・担当の名前から詳細の吹き出し・相手の閲覧の欄（PRD D198〜D200） */
async function names(page) {
  await open(page, '/staff', '.people-table tbody tr');
  // s1 を全員と ◎ にし、1人を休止中・1人を s1 のいつもの担当にする（13人目からの「あと N人」と利用中だけを確かめる）
  // 別のタブで書く（storage の知らせでこのタブのデータも入れ替わり、読み直すときに古いデータで上書きしない）
  const other = await page.context().newPage();
  await other.goto(`${BASE}#/data`);
  await other.evaluate((k) => {
    const d = JSON.parse(localStorage.getItem(k));
    d.compat = d.compat ?? {};
    for (const c of d.clients) d.compat[c.id] = { ...(d.compat[c.id] ?? {}), s1: 2 };
    d.clients[0].active = false;
    d.clients[0].stage = 'ended';
    d.clients[1].usualStaffId = 's1';
    localStorage.setItem(k, JSON.stringify(d));
  }, STORAGE_KEY);
  await other.close();
  await settle(page, 300);
  const data = await stored(page);
  const active = data.clients.filter((c) => c.active);
  const usual = active.filter((c) => c.usualStaffId === 's1');
  await open(page, '/staff?id=s1', '[data-testid="person-view"]');
  const great = panel(page).getByTestId('view-compat-great');
  const btns = great.getByTestId('person-btn');
  check(
    (await great.textContent()).includes(`${active.length}人`) && (await btns.count()) === Math.min(12, active.length),
    '〈スタッフ〉：◎ の〈利用者さん〉を人数と名前で並べ、13人目からは畳む（利用中だけ）',
    { text: await great.textContent(), n: await btns.count(), active: active.length },
  );
  check(
    !(await great.textContent()).includes(data.clients[0].displayName),
    '〈スタッフ〉：休止中の〈利用者さん〉は並べない',
  );
  const more = panel(page).getByTestId('view-compat-great-more');
  check(
    (await more.textContent()) === `あと ${active.length - 12}人`,
    '〈スタッフ〉：「あと N人」',
    await more.textContent(),
  );
  await more.click();
  check(
    (await btns.count()) === active.length && (await more.getAttribute('aria-expanded')) === 'true',
    '〈スタッフ〉：「あと N人」で全員・もう一度で畳む',
  );
  const usualNames = await panel(page).getByTestId('view-usual-clients').getByTestId('person-btn').allTextContents();
  check(
    usualNames.length === usual.length && usual.every((c) => usualNames.includes(c.displayName)),
    '〈スタッフ〉：いつもの担当の〈利用者さん〉の名前',
    usualNames,
  );
  check((await panel(page).getByTestId('view-compat-ng').textContent()) === '—', '〈スタッフ〉：居ない記号は「—」');
  // 名前で詳細の吹き出し。Tab は吹き出しの中、Esc は吹き出しだけ閉じる
  const first = btns.first();
  const firstId = await first.getAttribute('data-id');
  await first.click();
  const pop = page.getByTestId('person-pop');
  await pop.waitFor({ timeout: 3000 });
  check(
    await page.evaluate(() => !!document.querySelector('[aria-modal="true"] [data-testid="person-pop"]')),
    '欄の中の吹き出し：欄（aria-modal）の中に出す',
  );
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const inPop = await page.evaluate(() => !!document.activeElement?.closest('[data-testid="person-pop"]'));
  check(inPop, '欄の中の吹き出し：Tab でフォーカスが吹き出しの中を進む（欄の閉じ込めに取られない）');
  // 吹き出しの端から Tab で出ると閉じて名前へ戻る（欄の先頭へ飛ばない）
  await page.keyboard.press('Tab');
  await settle(page);
  check(
    (await pop.count()) === 0 &&
      (await page.evaluate(() => document.activeElement?.getAttribute('data-id'))) === firstId,
    '欄の中の吹き出し：端から Tab で出ると閉じ、フォーカスは名前へ戻る',
  );
  // 欄を巻いて名前が見えなくなったら閉じる
  await first.click();
  await pop.waitFor({ timeout: 3000 });
  await panel(page)
    .locator('.drawer-body')
    .evaluate((el) => {
      el.scrollTop = 0;
    });
  await settle(page);
  check((await pop.count()) === 0, '欄の中の吹き出し：欄を巻いて名前が見えなくなったら閉じる');
  await first.scrollIntoViewIfNeeded();
  await first.click();
  await pop.waitFor({ timeout: 3000 });
  await page.keyboard.press('Escape');
  await settle(page);
  check(
    (await pop.count()) === 0 &&
      (await panel(page).count()) === 1 &&
      (await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === 'person-btn',
    '欄の中の吹き出し：Esc は吹き出しだけ閉じ、フォーカスは名前へ戻る',
  );
  await first.click();
  await page.getByTestId('person-pop-link').click();
  await settle(page, 500);
  check(
    urlOf(page).includes('#/clients') && (await view(page).getAttribute('data-id')) === firstId,
    '吹き出しのリンクで〈利用者さん〉の閲覧の欄',
    urlOf(page),
  );
  // 〈利用者さん〉の担当できる人・いつもの担当も名前から
  const c = data.clients.find((x) => x.id === firstId);
  const usualStaff = panel(page).getByTestId('view-usual-staff').getByTestId('person-btn');
  if (c.usualStaffId) {
    await usualStaff.click();
    await page.getByTestId('person-pop-link').click();
    await settle(page, 500);
    check(
      (await view(page).getAttribute('data-id')) === c.usualStaffId && urlOf(page).includes('#/staff'),
      '〈利用者さん〉：いつもの担当の名前から〈スタッフ〉の閲覧の欄',
    );
  } else {
    check((await usualStaff.count()) === 0, '〈利用者さん〉：いつもの担当が無ければ名前のボタンは無い');
  }
  await page.screenshot({ path: path.join(OUT_DIR, 'names.png') });
}

/** 編集の欄のメモの入力（〈利用者さん〉） */
const memoInput = (page) => panel(page).locator('label', { hasText: 'メモ' }).first().locator('input');
const headText = async (page) => (await panel(page).locator('h2').first().textContent()) ?? '';
const goHash = (page, hash) =>
  page.evaluate((h) => {
    location.hash = h;
  }, hash);

/** 〈利用者さん〉：同じ人の ?id= で編集が続く・特性を戻す／担当を限るを入れて外すだけなら確認なし・保存後のフォーカス・節の見出し */
async function clientsMore(page, dlg) {
  await open(page, '/clients', '[data-testid="client-row"]');
  await page.getByRole('button', { name: '図書館 ふみを開く' }).click();
  await view(page).waitFor();
  check(
    (await panel(page).locator('.section-title h3').count()) > 3 &&
      (await panel(page).locator('.section-title h2').count()) === 0,
    '〈利用者さん〉：閲覧の欄の節の見出しは h3',
  );
  await page.getByTestId('view-edit').click();
  check(
    (await panel(page).locator('.section-title h3').count()) > 3 &&
      (await panel(page).locator('.section-title h2').count()) === 0,
    '〈利用者さん〉：編集の欄の節の見出しも h3（定期パターン・休みの節を含む）',
  );
  // 同じ人の ?id=：確認なしで編集が続く
  await memoInput(page).fill('同じ人の id');
  dlg.messages.length = 0;
  await goHash(page, '#/clients?id=c1');
  await settle(page, 500);
  check(
    dlg.messages.length === 0 &&
      (await view(page).count()) === 0 &&
      (await memoInput(page).inputValue()) === '同じ人の id',
    '〈利用者さん〉：編集中に同じ人の ?id= が来ても、確認なしで編集が続く',
  );
  check(!urlOf(page).includes('id='), '〈利用者さん〉：そのときも URL から id を消す');
  // 変更があるときの再読込の確認（beforeunload）
  const blocked = await page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  check(blocked, '〈利用者さん〉：変更があるとき、再読込・タブを閉じる前に確認する（beforeunload）');
  dlg.answer = true;
  await page.getByTestId('edit-cancel').click();
  await settle(page);
  const free = await page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  check(!free, '〈利用者さん〉：変更が無ければ beforeunload で止めない');
  check(
    await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'view-edit'),
    '〈利用者さん〉：取り消して閲覧に戻ると、フォーカスは「編集する」',
  );
  // 「担当できる人を限る」を入れてすぐ外すだけなら変更なし
  await page.getByTestId('view-edit').click();
  const lim = panel(page).getByLabel('担当できる人を限る');
  await lim.check();
  await lim.uncheck();
  dlg.messages.length = 0;
  await page.getByTestId('edit-cancel').click();
  await settle(page);
  check(
    dlg.messages.length === 0 && (await view(page).count()) === 1,
    '〈利用者さん〉：担当できる人を限るを入れてすぐ外しただけなら、確認なしで閲覧に戻る',
    dlg.messages,
  );
  // 保存したらフォーカスは「編集する」
  await page.getByTestId('view-edit').click();
  await memoInput(page).fill('保存のフォーカス');
  await page.getByRole('button', { name: '保存' }).click();
  await settle(page, 600);
  check(
    (await view(page).count()) === 1 &&
      (await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'view-edit')),
    '〈利用者さん〉：保存して閲覧に戻ると、フォーカスは「編集する」',
  );
  await panel(page).getByRole('button', { name: '閉じる' }).click();
  // 追加で特性を選んでから未確認に戻すだけなら変更なし
  await page.getByRole('button', { name: /を追加$/ }).click();
  const seg = panel(page).locator('fieldset.segmented').first();
  await seg.getByRole('button', { name: 'あり' }).click();
  await seg.getByRole('button', { name: '未確認' }).click();
  dlg.messages.length = 0;
  await page.getByTestId('edit-cancel').click();
  await settle(page);
  check(
    dlg.messages.length === 0 && (await panel(page).count()) === 0,
    '〈利用者さん〉：特性を選んでから未確認に戻しただけなら、確認なしで取り消せる',
    dlg.messages,
  );
}

/** 閲覧の休みの一覧と終わった休みの件数・「まとめて地図に置く」の「編集」は編集の欄 */
async function seeded(page) {
  await open(page, '/clients', '[data-testid="client-row"]');
  const today = new Date(NOW.getTime() + JST).toISOString().slice(0, 10);
  const shift = (n) => new Date(NOW.getTime() + JST + n * 86400000).toISOString().slice(0, 10);
  const leaves = [
    { id: 'lv-past', clientId: 'c1', from: shift(-20), to: shift(-15), note: '終わった入院' },
    { id: 'lv-now', clientId: 'c1', from: shift(-1), to: today, note: '' },
    { id: 'lv-next', clientId: 'c1', from: shift(10), to: shift(12), note: 'ショートステイ' },
  ];
  // c1 に休みを入れ、c2 の位置と住所を消してから開き直す
  await page.evaluate(
    ([k, ls]) => {
      const d = JSON.parse(localStorage.getItem(k));
      d.clientLeaves = [...d.clientLeaves.filter((l) => l.clientId !== 'c1'), ...ls];
      d.clients = d.clients.map((c) =>
        c.id === 'c2' ? { ...c, place: { address: '', lat: null, lng: null, postalCode: '' } } : c,
      );
      localStorage.setItem(k, JSON.stringify(d));
    },
    [STORAGE_KEY, leaves],
  );
  await page.reload();

  await page.locator('[data-testid="client-row"]').first().waitFor();
  await settle(page, 400);
  await page.getByRole('button', { name: '図書館 ふみを開く' }).click();
  await view(page).waitFor();
  const items = await page.getByTestId('view-leaves').locator('li').allTextContents();
  const text = await view(page).textContent();
  check(
    items.length === 2 &&
      items[0].includes('理由なし') &&
      items[1].includes('ショートステイ') &&
      !text.includes('終わった入院') &&
      text.includes('終わった休み 1件'),
    '〈利用者さん〉：閲覧の休みはこれからの休み（今日を含む・開始日の順）と、終わった休みの件数',
    items,
  );
  await panel(page).getByRole('button', { name: '閉じる' }).click();
  // 位置も住所も無い人の「編集」（まとめて地図に置く）は、閲覧を挟まず編集の欄
  await page
    .getByTestId('place-all-skipped')
    .getByRole('button', { name: /動物公園 やぎお/ })
    .click();
  await settle(page);
  check(
    (await view(page).count()) === 0 &&
      (await inputs(page)) > 5 &&
      (await headText(page)).includes('を編集：動物公園 やぎお'),
    '〈利用者さん〉：「まとめて地図に置く」の「編集」は編集の欄で開く',
  );
  await page.getByTestId('edit-cancel').click();
  await settle(page);
  check((await view(page).count()) === 1, '〈利用者さん〉：そこから取り消すと、その人の閲覧の欄');
  check((await view(page).textContent()).includes('住所なし'), '〈利用者さん〉：住所が無ければ地区は「住所なし」');
}

/** 〈スタッフ〉：変更があるときの ×・Esc・?id=（別の人・同じ人）、取り消しを断ると編集が続く */
async function staffMore(page, dlg) {
  await open(page, '/staff', '.people-table tbody tr');
  await page.getByRole('button', { name: '市役所 まち子を開く' }).click();
  await page.getByTestId('view-edit').click();
  const email = page.getByTestId('staff-email');
  await email.fill('more@example.com');
  // 取り消しを断ると編集が続く
  dlg.answer = false;
  dlg.messages.length = 0;
  await page.getByTestId('edit-cancel').click();
  await settle(page);
  check(
    dlg.messages.length === 1 && (await email.inputValue()) === 'more@example.com' && (await view(page).count()) === 0,
    '〈スタッフ〉：変更ありの取り消しを断ると、編集が続く',
  );
  // ×
  dlg.messages.length = 0;
  await panel(page).getByRole('button', { name: '閉じる' }).click();
  await settle(page);
  check(
    dlg.messages.length === 1 &&
      /欄を閉じますか/.test(dlg.messages[0]) &&
      (await email.inputValue()) === 'more@example.com',
    '〈スタッフ〉：変更ありで × を押すと確認が出て、断れば編集が続く',
    dlg.messages,
  );
  // Esc
  dlg.messages.length = 0;
  await page.keyboard.press('Escape');
  await settle(page);
  check(
    dlg.messages.length === 1 && /欄を閉じますか/.test(dlg.messages[0]) && (await panel(page).count()) === 1,
    '〈スタッフ〉：変更ありで Esc を押すと確認が出て、断れば欄が残る',
  );
  // 同じ人の ?id=：確認なしで編集が続く
  dlg.messages.length = 0;
  await goHash(page, '#/staff?id=s1');
  await settle(page, 500);
  check(
    dlg.messages.length === 0 && (await email.inputValue()) === 'more@example.com',
    '〈スタッフ〉：編集中に同じ人の ?id= が来ても、確認なしで編集が続く',
  );
  // 別の人の ?id=：確認が出る。断れば編集のまま、受ければその人の閲覧
  const s2 = (await stored(page)).staff.find((s) => s.id === 's2');
  await goHash(page, '#/staff?id=s2');
  await settle(page, 500);
  check(
    dlg.messages.length === 1 &&
      dlg.messages[0].includes(`${s2.name}を開きますか`) &&
      (await email.inputValue()) === 'more@example.com',
    '〈スタッフ〉：変更があるまま別の人を ?id= で開くと確認が出て、断れば編集のまま',
    dlg.messages,
  );
  dlg.answer = true;
  await goHash(page, '#/staff?id=s2');
  await settle(page, 500);
  const head = await headText(page);
  check(
    (await view(page).count()) === 1 &&
      head.slice(head.indexOf('：') + 1) === s2.name &&
      (await view(page).getAttribute('data-id')) === 's2',
    '〈スタッフ〉：受ければ別の人の閲覧の欄になる',
    head,
  );
  const s1 = (await stored(page)).staff.find((s) => s.id === 's1');
  check(s1.email !== 'more@example.com', '〈スタッフ〉：捨てた変更は保存しない');
}

run(async () => {
  const browser = await launch();
  const errors = [];
  for (const step of [clients, clientsMore, seeded, staff, staffMore, links, names]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // 初回の案内ツアーを見た扱いにする（PRD D193）
    await skipTour(ctx);
    // 地図のタイルは外へ取りに行かない
    await ctx.route(/cyberjapandata\.gsi\.go\.jp/, (r) => r.fulfill({ status: 204, body: '' }));
    const page = await ctx.newPage();
    // ページの時計を止める（e2e-details と同じ）
    await page.clock.setFixedTime(NOW);
    page.on('pageerror', (e) => errors.push(String(e)));
    const dlg = await dialogs(page);
    try {
      await step(page, dlg);
    } catch (e) {
      check(false, `${step.name}：途中で止まった`, String(e).split('\n')[0]);
      await failShot(page, step.name);
    }
    check(dlg.native.length === 0, `${step.name}：ブラウザのダイアログを出さない`, dlg.native);
    await ctx.close();
  }
  check(errors.length === 0, 'ページのエラーが無い', errors);
  await browser.close();
});
