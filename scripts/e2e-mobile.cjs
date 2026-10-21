// スマホ（幅860px以下）のメニュー（PRD D132〜D135・D274。ADR-0024・0045）を本物のブラウザ（390×844）で確かめる：
// 上の帯（ロゴと今の画面の名前・「探す」・日付の切り替え。〈利用者さん〉一覧と〈スタッフ〉一覧を見分ける。PRD D179）、
// 引き出し（下のタブの「メニュー」で開く。role="dialog"・aria-modal・名前、ボタンの aria-expanded・aria-controls、グループの見出し付きの縦並び、
// 画面を選ぶ・外を押す・Esc で閉じてフォーカスが「メニュー」へ、Tab・Shift+Tab が中で回る、開いているあいだ裏を巻かない）、
// 下のタブ（ホーム・予定・欠勤・空き状況・メニュー（PRD D274）、active と aria-current、月・週・日・比較では「予定」、本文の最後がタブに隠れない）、
// 浮いている部品（地図の MapDock・欠勤の振り直しの ReassignDock・トースト）がタブに重ならない、
// 本物の地図のボタンと本物のトースト（PRD D190。ボタンはタブのすぐ上・トーストが出ても互いに隠れない・本文の下を空ける・safe-area）、印刷で上の帯・下のタブ・引き出しを出さない、
// 広い画面（1400px）では今の左のメニューのままで、上の帯の部品・下のタブを出さない。
// 狭い画面の表（PRD D220〜D222）：条件の重み・特性の項目・〈スタッフ〉一覧・〈利用者さん〉一覧・比較の行がカードで横にはみ出さない、
// 条件のスライダーと必須が画面の中、〈利用者さん〉の絞り込みは「絞り込み（N）」に畳む、比較の主ボタンがタブに隠れない、
// 表の role（table・row・cell・columnheader）を明示する、週の既定は〈スタッフ〉×曜日の表で今日が見え、右の端まで巻いても名前の列が上で押せる、空き状況の表は 9:00 から・右に続きがある印、1400px は表のまま。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-mobile.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { skipTour } = require('./lib/tourSeen.cjs');
const { BASE, OUT_DIR, NOW, STORAGE_KEY, check, isFocused, runSteps, settle } = require('./lib/env.cjs');
const { sharedPage, openPage } = require('./lib/steps.cjs');

const drawer = (page) => page.getByTestId('nav-drawer');
const menuBtn = (page) => page.getByTestId('menu-btn');
const tabs = (page) => page.getByTestId('bottom-tabs');
const visible = (loc) => loc.isVisible().catch(() => false);
/** 2つの箱が重なるか（1px の接しは許す） */
const overlaps = (a, b) =>
  a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

async function open(page, hash, ready) {
  // 同じ文書の中で hash を移してから読み直すと、読み直す前に `?id=` が処理されて URL から消えることがあるので、
  // about:blank を挟んで開く（e2e-home と同じ）
  await page.goto('about:blank');
  await page.goto(`${BASE}#${hash}`);
  await page.locator(ready).first().waitFor({ timeout: 30000 });
  await settle(page, 400);
}

async function header(page) {
  await open(page, '/clients', '[data-testid="screen-name"]');
  const name = await page.getByTestId('screen-name').innerText();
  await open(page, '/staff', '[data-testid="screen-name"]');
  const name2 = await page.getByTestId('screen-name').innerText();
  check(
    name === '人・利用者さん一覧' && name2 === '人・スタッフ一覧',
    '上の帯：〈利用者さん〉一覧と〈スタッフ〉一覧を見分ける',
    {
      name,
      name2,
    },
  );
  await open(page, '/plan', '[data-testid="screen-name"]');
  check(
    (await page.getByTestId('screen-name').innerText()) === '日の予定',
    '上の帯：日の予定（予定のグループは項目名だけ）',
  );
  check(await visible(page.locator('.app-header .date-switch')), '上の帯：日付の切り替えがある');
  check(!(await visible(page.locator('.side-nav'))), '左のメニューは出さない');
  const hb = await page.locator('.app-header').boundingBox();
  const mb = await page.getByTestId('cmdk-open').boundingBox();
  check(mb.x + mb.width <= 390 && hb.width <= 390, '上の帯が画面の幅に収まる（横に巻かない）', { hb, mb });
  check(
    (await page.locator('.app-header [data-testid="menu-btn"]').count()) === 0 &&
      (await tabs(page).locator('[data-testid="menu-btn"]').count()) === 1,
    '「メニュー」は上の帯でなく下のタブの最後（PRD D274）',
  );
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  check(scrollW <= 390, 'ページが横にはみ出さない', scrollW);
  await page.screenshot({ path: path.join(OUT_DIR, 'mobile-plan.png') });
}

async function drawerOpenClose(page) {
  await open(page, '/week', '[data-testid="menu-btn"]');
  const btn = menuBtn(page);
  check(
    (await btn.getAttribute('aria-expanded')) === 'false' &&
      (await btn.getAttribute('aria-controls')) === null &&
      (await btn.getAttribute('aria-haspopup')) === 'dialog',
    'ボタン：閉じているとき aria-expanded=false・aria-controls なし・aria-haspopup=dialog',
  );
  await btn.click();
  await drawer(page).waitFor();
  const d = drawer(page);
  check(
    (await d.getAttribute('role')) === 'dialog' &&
      (await d.getAttribute('aria-modal')) === 'true' &&
      (await d.getAttribute('aria-label')) === 'メニュー' &&
      (await d.locator('nav').getAttribute('aria-label')) === '画面の一覧',
    '引き出し：role=dialog・aria-modal・名前「メニュー」・中の nav は「画面の一覧」',
  );
  check(
    (await page.evaluate(() => document.getElementById('root').inert)) &&
      (await d.locator('h2.nav-group-title').count()) === 2,
    '引き出し：後ろの画面は inert・グループの見出しは h2',
  );
  check(
    (await btn.getAttribute('aria-expanded')) === 'true' &&
      (await btn.getAttribute('aria-controls')) === (await d.getAttribute('id')),
    'ボタン：aria-expanded=true・aria-controls が引き出しを指す',
  );
  const titles = await d.locator('.nav-group-title').allInnerTexts();
  check(
    JSON.stringify(titles) === JSON.stringify(['当日・問い合わせ', '人']),
    '引き出し：グループの見出し付き（当日・問い合わせ・人）',
    titles,
  );
  const links = d.locator('.nav-link');
  const n = await links.count();
  const boxes = [];
  for (let i = 0; i < n; i++) boxes.push(await links.nth(i).boundingBox());
  check(
    n === 9 && boxes.every((b, i) => i === 0 || b.y > boxes[i - 1].y),
    '引き出し：全部のメニュー（9項目）を縦に並べる',
    {
      n,
    },
  );
  await settle(page, 400); // 出てくる動きが終わるまで
  const db = await d.boundingBox();
  check(db.x === 0 && db.width < 390, '引き出し：左から出る', db);
  const current = d.locator('[aria-current="page"]');
  check(
    (await current.innerText()).trim() === '予定' && (await isFocused(current)),
    '引き出し：開いたら今の画面の項目（週の予定は「予定」）へフォーカス',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'mobile-drawer.png') });

  // 裏の画面を巻かない
  const y0 = await page.evaluate(() => window.scrollY);
  await page.mouse.move(380, 600);
  await page.mouse.wheel(0, 600);
  await settle(page, 300);
  const y1 = await page.evaluate(() => window.scrollY);
  check(
    y1 === y0 && (await page.evaluate(() => getComputedStyle(document.body).overflow)) === 'hidden',
    '開いているあいだ裏の画面を巻かない',
    { y0, y1 },
  );

  // フォーカスを閉じ込める（Tab・Shift+Tab）
  let inside = true;
  for (let i = 0; i < n + 4; i++) {
    await page.keyboard.press('Tab');
    inside &&= await d.evaluate((el) => el.contains(document.activeElement));
  }
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Shift+Tab');
    inside &&= await d.evaluate((el) => el.contains(document.activeElement));
  }
  check(inside, 'Tab・Shift+Tab でフォーカスが引き出しの中で回る');

  // Esc
  await page.keyboard.press('Escape');
  await d.waitFor({ state: 'detached' });
  check(
    (await isFocused(btn)) && (await btn.getAttribute('aria-expanded')) === 'false',
    'Esc で閉じてフォーカスが「メニュー」へ',
  );
  check((await page.evaluate(() => document.body.style.overflow)) === '', '閉じたら裏の画面を巻ける');

  // 外を押す
  await btn.click();
  await d.waitFor();
  await page.mouse.click(380, 400);
  await d.waitFor({ state: 'detached' });
  check(await isFocused(btn), '外を押すと閉じてフォーカスが「メニュー」へ');

  // 画面を選ぶ
  await btn.click();
  await d.waitFor();
  await d.locator('.nav-link', { hasText: 'スタッフ一覧' }).click();
  await d.waitFor({ state: 'detached' });
  await page.waitForURL(/#\/staff/);
  check(
    (await isFocused(btn)) && /・スタッフ一覧$/.test(await page.getByTestId('screen-name').innerText()),
    '画面を選ぶと移って閉じ、フォーカスが「メニュー」へ',
  );
  // 今の画面を選んでも閉じるだけ（URL のクエリ＝画面の状態を消さない）
  await open(page, '/week?view=table', '[data-testid="menu-btn"]');
  await btn.click();
  await d.waitFor();
  await d.locator('[aria-current="page"]').click();
  await d.waitFor({ state: 'detached' });
  check(
    (await isFocused(btn)) &&
      page.url().includes('view=table') &&
      !(await page.evaluate(() => document.getElementById('root').inert)),
    '今の画面を選ぶと閉じるだけで、URL のクエリは残る・inert を外す',
    page.url(),
  );
}

async function bottom(page) {
  await open(page, '/week', '[data-testid="bottom-tabs"]');
  const t = tabs(page);
  const labels = (await t.locator('.bottom-tab').allInnerTexts()).map((x) => x.trim());
  check(
    JSON.stringify(labels) === JSON.stringify(['ホーム', '予定', '欠勤', '空き状況', 'メニュー']),
    '下のタブ：ホーム・予定・欠勤・空き状況・メニュー（PRD D274）',
    labels,
  );
  const tb = await t.boundingBox();
  check(Math.round(tb.y + tb.height) === 844 && tb.x === 0 && tb.width === 390, '下のタブ：画面の下に常に並ぶ', tb);
  const active = async () => t.locator('.bottom-tab.active[aria-current="page"]').allInnerTexts();
  check(
    JSON.stringify(await active()) === '["予定"]',
    '下のタブ：今の画面（週の予定）は「予定」が active・aria-current',
  );
  // 今の画面のタブは何もしない（URL のクエリを消さない）
  await open(page, '/week?view=table', '[data-testid="bottom-tabs"]');
  await t.getByTestId('bottom-tab').filter({ hasText: '予定' }).click();
  await settle(page, 300);
  check(
    page.url().includes('view=table') && JSON.stringify(await active()) === '["予定"]',
    '下のタブ：今の画面のタブは何もしない',
    page.url(),
  );
  await t.getByTestId('bottom-tab').filter({ hasText: '空き状況' }).click();
  await page.waitForURL(/#\/vacancy/);
  await settle(page, 300);
  check(JSON.stringify(await active()) === '["空き状況"]', '下のタブ：押すと移る（空き状況）', await active());
  await open(page, '/compare', '[data-testid="bottom-tabs"]');
  check(JSON.stringify(await active()) === '["予定"]', '下のタブ：比較では「予定」');
  await open(page, '/clients', '[data-testid="bottom-tabs"]');
  check((await active()).length === 0, '下のタブ：タブに無い画面ではどれも active にしない');
  // 「メニュー」のボタンもタブと同じ大きさで並ぶ
  const boxes = await t.locator('.bottom-tab').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  check(
    boxes.length === 5 && boxes.every((w) => Math.abs(w - 78) <= 1),
    '下のタブ：5つが全幅を等分する（メニューも同じ幅）',
    boxes,
  );
  // 本文の最後がタブに隠れない（いちばん下まで巻いて、本文の下の端がタブより上）
  await open(page, '/data', '[data-testid="bottom-tabs"]');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await settle(page, 300);
  const lastBottom = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.app-main > *')];
    return Math.max(...els.map((el) => el.getBoundingClientRect().bottom));
  });
  const tb2 = await t.boundingBox();
  check(lastBottom <= tb2.y, '本文の最後が下のタブに隠れない', { lastBottom, tabsTop: tb2.y });
  await page.screenshot({ path: path.join(OUT_DIR, 'mobile-bottom.png') });
}

/** 浮いている部品：本物の部品と同じクラスの箱を置き、CSS の決まり（--bottom-tabs-h・--*-top）でタブの上に出るかを見る */
async function floating(page) {
  await open(page, '/plan', '[data-testid="bottom-tabs"]');
  const tb = await tabs(page).boundingBox();
  const boxOf = (cls, setVar) =>
    page.evaluate(
      ([c, v]) => {
        const el = document.createElement('div');
        el.className = c;
        el.style.height = '48px';
        el.textContent = '確かめ';
        el.dataset.probe = '1';
        document.body.appendChild(el);
        if (v)
          document.documentElement.style.setProperty(
            v,
            `${Math.round(window.innerHeight - el.getBoundingClientRect().top)}px`,
          );
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      },
      [cls, setVar],
    );
  const fab = await boxOf('map-dock-fab', '--map-dock-top');
  check(!overlaps(fab, tb), '地図のボタン（MapDock）が下のタブに重ならない', { fab, tb });
  const dock = await boxOf('reassign-dock', null);
  check(!overlaps(dock, tb) && !overlaps(dock, fab), '欠勤の振り直しの帯（ReassignDock）が下のタブ・地図に重ならない', {
    dock,
  });
  const toast = await boxOf('toast', null);
  check(!overlaps(toast, tb) && !overlaps(toast, fab), 'トーストが下のタブ・地図に重ならない', { toast });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-probe]')) el.remove();
    document.documentElement.style.removeProperty('--map-dock-top');
  });
  const mapDock = await boxOf('map-dock', null);
  check(!overlaps(mapDock, tb), '開いた地図（MapDock）が下のタブに重ならない', { mapDock });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-probe]')) el.remove();
  });
  // 本物の地図のボタン：地図のカードが画面の外に出るまで巻いたとき（出れば重ならないかを見る）。
  // 狭い画面の地図のカードは本体の下（ページの終わり）なので、カードの上端が画面の下より下になる所まで巻く
  // （初期データに今日の案がある（PRD D225）ので、開いた時点で地図のカードまで描かれている。いちばん下へ巻くとカードが見えてボタンは出ない）
  await page.locator('.plan-map').first().waitFor({ timeout: 30000 });
  await page.evaluate(() => {
    const card = document.querySelector('.plan-map');
    const top = card.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, top - window.innerHeight - 40));
  });
  await settle(page, 800);
  const fabReal = page.locator('.map-dock-fab');
  await fabReal.waitFor({ timeout: 20000 });
  const fb = await fabReal.boundingBox();
  check(!overlaps(fb, tb), '本物の地図のボタン（MapDock）が下のタブに重ならない', fb);
  // 開いた地図も本物で
  await fabReal.click();
  const dockReal = page.locator('section.map-dock');
  await dockReal.waitFor();
  await settle(page, 400); // 出てくる動きが終わるまで
  const rb = await dockReal.boundingBox();
  check(!overlaps(rb, tb) && rb.y >= 0, '本物の開いた地図（MapDock）が下のタブに重ならない', rb);
  await page.screenshot({ path: path.join(OUT_DIR, 'mobile-mapdock.png') });
}

/**
 * 本物の地図のボタンと本物のトースト（PRD D190）：日の画面を地図のカードが外に出るまで巻き、地図のボタンを出したまま
 * 「この割当で確定」（独自の確認で確定）でトーストを出す。ボタンは下のタブのすぐ上（間 8px 以上）・画面の中、
 * トーストはボタンにもタブにも重ならず画面の中。ボタンが出ている間は本文の下を空ける。右・下の safe-area を CSS で避ける
 */
async function fabWithToast(page) {
  await open(page, '/plan', '[data-testid="bottom-tabs"]');
  const tb = await tabs(page).boundingBox();
  // 地図のカードが見えなくなる所（ページの途中）まで巻く
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
  const fab = page.locator('.map-dock-fab');
  await fab.waitFor({ timeout: 20000 });
  await settle(page, 300);
  const fb = await fab.boundingBox();
  check(
    fb.y + fb.height <= tb.y - 8 && fb.x + fb.width <= 390 && fb.y >= 0,
    '地図のボタン：下のタブのすぐ上（重ならず間 8px 以上）・画面の中',
    { fb, tabsTop: tb.y },
  );
  const pad = await page.evaluate(() => {
    const main = Number.parseFloat(getComputedStyle(document.querySelector('.app-main')).paddingBottom);
    const tabsH = document.querySelector('.bottom-tabs').getBoundingClientRect().height;
    return { main, tabsH };
  });
  check(pad.main >= pad.tabsH + 40 + 42, '地図のボタンが出ている間は、本文の下をボタンの分だけ空ける', pad);
  // safe-area（切り欠き・ホームバー）：右と下は env() で避ける（下は --bottom-tabs-h に入っている）
  const safe = await page.evaluate(() => {
    const out = [];
    for (const sh of document.styleSheets) {
      let rules;
      try {
        rules = sh.cssRules;
      } catch {
        continue;
      }
      for (const r of rules) {
        if (r.media && /max-width: 860px/.test(r.conditionText || r.media.mediaText))
          for (const x of r.cssRules) if (x.selectorText === '.map-dock-fab') out.push(x.cssText);
      }
    }
    return out.join(' ');
  });
  check(
    /safe-area-inset-right/.test(safe) && /--bottom-tabs-h/.test(safe),
    '地図のボタン：右の safe-area と下のタブ（ホームバーの safe-area 込み）を避ける',
    safe,
  );
  // 本物のトースト：画面を巻かずに「この割当で確定」を押し（スクリプトで click）、独自の確認で確定する
  await page.evaluate(() => document.querySelector('[data-testid="adopt"]').click());
  await page.getByTestId('confirm-ok').click();
  const toast = page.locator('.toast');
  await toast.waitFor({ timeout: 10000 });
  await settle(page, 400); // 出てくる動きが終わるまで
  const tt = await toast.boundingBox();
  const fb2 = await fab.boundingBox();
  check(
    fb2 !== null && !overlaps(tt, fb2) && !overlaps(tt, tb) && tt.y >= 0 && tt.x >= 0 && tt.x + tt.width <= 390,
    'トーストが出ている間：地図のボタンは隠れず、トーストもボタン・タブに隠れない',
    { tt, fb2 },
  );
  // 押せる（いちばん上にあるのがボタン）
  const top = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('.map-dock-fab') !== null,
    [fb2.x + fb2.width / 2, fb2.y + fb2.height / 2],
  );
  check(top, 'トーストが出ている間も地図のボタンの真ん中はボタン（上に何も重ならない）');
  await page.screenshot({ path: path.join(OUT_DIR, 'mobile-fab-toast.png') });
}

/** 開いたまま広い画面へ戻す：閉じて、フォーカスは左のメニューの今の項目へ。裏のロック・inert も外す */
async function wideWhileOpen(page) {
  await open(page, '/week', '[data-testid="menu-btn"]');
  await menuBtn(page).click();
  await drawer(page).waitFor();
  await page.setViewportSize({ width: 1400, height: 1000 });
  await drawer(page).waitFor({ state: 'detached' });
  const st = await page.evaluate(() => ({
    focus: document.activeElement?.closest('.side-nav') ? document.activeElement.getAttribute('aria-current') : null,
    html: document.documentElement.style.overflow,
    body: document.body.style.overflow,
    inert: document.getElementById('root').inert,
  }));
  check(
    st.focus === 'page' && st.html === '' && st.body === '' && !st.inert,
    '開いたまま広い画面へ戻すと閉じ、フォーカスは左のメニューの今の項目へ',
    st,
  );
  await page.setViewportSize({ width: 390, height: 844 });
}

/** 右の欄（SidePanel）と引き出しが重なっても、最後の1つが閉じるまで裏を巻かない（useBodyScrollLock） */
async function lockWithPanel(page) {
  await open(page, '/staff?id=s1', '.drawer');
  const lock = () =>
    page.evaluate(() => [document.documentElement.style.overflow, document.body.style.overflow].join(','));
  const a = await lock();
  // 欄の後ろの「メニュー」をスクリプトで押して、欄の上に引き出しを重ねる
  await page.evaluate(() => document.querySelector('[data-testid="menu-btn"]').click());
  await drawer(page).waitFor();
  const b = await lock();
  await page.getByTestId('nav-drawer-backdrop').click({ position: { x: 370, y: 400 } });
  await drawer(page).waitFor({ state: 'detached' });
  const c = await lock();
  await page.locator('.drawer').getByRole('button', { name: '閉じる' }).click();
  await page.locator('.drawer').waitFor({ state: 'detached' });
  const d = await lock();
  check(
    a === 'hidden,hidden' && b === 'hidden,hidden' && c === 'hidden,hidden' && d === ',',
    '右の欄と引き出しが重なっても、最後の1つが閉じるまで裏を巻かない',
    { a, b, c, d },
  );
}

/** ページが横にはみ出さない（documentElement.scrollWidth が画面の幅以下） */
const pageWidth = (page) => page.evaluate(() => document.documentElement.scrollWidth);
/** 下のタブの上端と上の帯の下端（見える所の上下） */
const viewBand = (page) =>
  page.evaluate(() => ({
    top: document.querySelector('.app-header').getBoundingClientRect().bottom,
    bottom: document.querySelector('.bottom-tabs').getBoundingClientRect().top,
  }));

/**
 * 条件の重み（PRD D220）：行がカード（display: flex）・1つ目の条件のスライダーと必須の切り替えが画面の中・横にはみ出さない。
 * プリセットの名前とボタンの文字が1字ずつ折り返さない
 */
async function narrowRules(page) {
  await open(page, '/rules', '[data-testid="narrow-rules"]');
  const row = page.getByTestId('narrow-rules').locator('tbody > tr').first();
  const slider = await row.locator('input[type="range"]').boundingBox();
  const hard = await row.locator('.hard-toggle').boundingBox();
  const display = await row.evaluate((el) => getComputedStyle(el).display);
  const sw = await pageWidth(page);
  check(
    display === 'flex' && slider && hard && slider.x + slider.width <= 390 && hard.x + hard.width <= 390 && sw <= 390,
    '条件の重み：行がカードで、1つ目の条件のスライダーと必須が画面の中・横にはみ出さない（PRD D220）',
    { display, slider, hard, sw },
  );
  const lines = await page.evaluate(() => {
    const h = (el) => Math.round(el.getBoundingClientRect().height);
    const lh = (el) => Number.parseFloat(getComputedStyle(el).lineHeight) || 24;
    const names = [...document.querySelectorAll('.narrow-preset-summary > strong')].map((el) => h(el) / lh(el));
    const btns = [...document.querySelectorAll('.narrow-stack > .btn')].map((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return r.getClientRects().length > 0 ? h(el) : 0;
    });
    return { names, btns };
  });
  check(
    lines.names.length >= 3 && lines.names.every((n) => n < 1.6) && lines.btns.every((b) => b > 0 && b < 60),
    'プリセット：名前は1行・「いまの重みをプリセットとして保存」「初期値に戻す」は折り返さない',
    lines,
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'narrow-rules.png') });
}

/** 一覧の表（特性の項目・〈スタッフ〉一覧・〈利用者さん〉一覧）：行がカードで横にはみ出さない（PRD D220） */
async function narrowLists(page) {
  for (const [hash, ready] of [
    ['/items', '.items-table'],
    ['/staff', '[data-testid="narrow-staff"]'],
    ['/clients', '[data-testid="narrow-clients"]'],
  ]) {
    await open(page, hash, ready);
    const st = await page.evaluate((sel) => {
      const t = document.querySelector(sel);
      const tr = t.querySelector('tbody > tr');
      const cells = [...t.querySelectorAll('tbody > tr:first-child > td')].map((td) => td.getBoundingClientRect());
      return {
        display: tr ? getComputedStyle(tr).display : '',
        right: Math.max(...cells.map((r) => r.right)),
        sw: document.documentElement.scrollWidth,
        // カードにしても表として読める（WebKit が落とす role を明示する。ADR-0033）
        roles: [t, t.querySelector('thead'), tr, tr?.querySelector('td'), t.querySelector('thead th')].map((el) =>
          el?.getAttribute('role'),
        ),
      };
    }, ready);
    check(
      st.display === 'flex' &&
        st.right <= 390 &&
        st.sw <= 390 &&
        JSON.stringify(st.roles) === '["table","rowgroup","row","cell","columnheader"]',
      `${hash}：行がカードで、どのマスも画面の中・横にはみ出さない（PRD D220）`,
      st,
    );
    await page.screenshot({ path: path.join(OUT_DIR, `narrow-${hash.slice(1)}.png`) });
  }
}

/** 〈利用者さん〉一覧の絞り込み：「絞り込み（N）」に畳み、押すと開く。N は効いている絞り込みの数（PRD D220） */
async function narrowClientFilter(page) {
  await open(page, '/clients', '[data-testid="narrow-filter-toggle"]');
  const btn = page.getByTestId('narrow-filter-toggle');
  const cf = page.getByTestId('clients-cf');
  const t0 = await btn.innerText();
  const closed = (await btn.getAttribute('aria-expanded')) === 'false' && !(await visible(cf));
  const firstRow = await page.getByTestId('client-row').first().boundingBox();
  const vb = await viewBand(page);
  check(
    /^絞り込み（0）/.test(t0.trim()) && closed && firstRow && firstRow.y < vb.bottom,
    '〈利用者さん〉一覧：絞り込みは「絞り込み（0）」に畳まれ、1枚目のカードが最初の画面に入る',
    { t0, closed, firstRow, vb },
  );
  await btn.click();
  await cf.waitFor();
  const ctl = await btn.getAttribute('aria-controls');
  const ctlOk = await page.evaluate(
    (id) => !!document.getElementById(id)?.contains(document.querySelector('[data-testid="clients-cf"]')),
    ctl,
  );
  // チップを1つ押すと数が 1 になる
  await cf.locator('button[aria-pressed="false"]:not([disabled])').first().click();
  await settle(page, 200);
  const t1 = await btn.innerText();
  check(
    (await btn.getAttribute('aria-expanded')) === 'true' && ctlOk && /^絞り込み（1）/.test(t1.trim()),
    '〈利用者さん〉一覧：押すと開き（aria-expanded・aria-controls）、チップを押すと「絞り込み（1）」',
    { t1, ctl },
  );
  check((await pageWidth(page)) <= 390, '〈利用者さん〉一覧：絞り込みを開いても横にはみ出さない');
  await page.screenshot({ path: path.join(OUT_DIR, 'narrow-clients-filter.png') });
}

/** 比較の画面（案が1つ）：記録がカード・横にはみ出さない・主ボタン「もう1案作って比べる」が下のタブに隠れない（PRD D220） */
async function narrowCompare(page) {
  await open(page, '/plan', '[data-testid="confirm-state"]');
  await page
    .getByTestId('plan-progress')
    .waitFor({ state: 'detached', timeout: 60000 })
    .catch(() => {});
  await open(page, '/compare', '[data-testid="compare-another-make"]');
  const b = await page.getByTestId('compare-another-make').boundingBox();
  const vb = await viewBand(page);
  const top = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="compare-another-make"]') !== null,
    [b.x + b.width / 2, b.y + b.height - 2],
  );
  const display = await page
    .getByTestId('narrow-runs')
    .locator('tbody > tr')
    .first()
    .evaluate((el) => getComputedStyle(el).display);
  check(
    b.y >= vb.top && b.y + b.height <= vb.bottom && b.x + b.width <= 390 && top,
    '比較：主ボタン「もう1案作って比べる」が下のタブの上にすべて見え、押せる',
    { b, vb, top },
  );
  check(display === 'flex' && (await pageWidth(page)) <= 390, '比較：記録の行がカードで横にはみ出さない', display);
  await page.screenshot({ path: path.join(OUT_DIR, 'narrow-compare.png') });
}

/** 週（PRD D222）：?view= なしは〈スタッフ〉×曜日の表で URL に書かず、今日の列が見える。時間軸を押すと ?view=timeline */
async function narrowWeek(page) {
  await open(page, '/week', '[data-testid="week-table"]');
  await settle(page, 300);
  const today = page.locator('[data-testid="week-table"] thead th.is-today');
  const tb = await today.boundingBox();
  const vb = await viewBand(page);
  const name = await page.locator('[data-testid="week-table"] thead th').first().boundingBox();
  check(
    !page.url().includes('view=') &&
      tb &&
      tb.y >= vb.top - 1 &&
      tb.y + tb.height <= vb.bottom &&
      tb.x >= name.x + name.width - 1 &&
      tb.x + tb.width <= 390,
    '週：390px の既定は〈スタッフ〉×曜日の表（URL に書かない）で、今日の列の見出しが画面に見える',
    { url: page.url(), tb, vb, name },
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'narrow-week.png') });
  // 右の端まで巻いても、止めた名前の列がマス（.load-slot など）の上に見え、名前を押せる
  const hit = await page.getByTestId('week-table').evaluate((t) => {
    const box = t.parentElement;
    box.scrollLeft = box.scrollWidth;
    // 表の本体を上の帯のすぐ下へ（見える所の行だけ見る。下のタブの裏・画面の外の行は押せないので数えない）
    const top = document.querySelector('.app-header').getBoundingClientRect().bottom;
    window.scrollBy(0, t.querySelector('tbody').getBoundingClientRect().top - top - 4);
    return new Promise((res) =>
      requestAnimationFrame(() => {
        const bottom = document.querySelector('.bottom-tabs').getBoundingClientRect().top;
        const names = [...t.querySelectorAll('tbody th[scope="row"] button')].filter((b) => {
          const r = b.getBoundingClientRect();
          return r.top >= top && r.bottom <= bottom;
        });
        const bad = names
          .map((b) => {
            const r = b.getBoundingClientRect();
            const el = document.elementFromPoint(r.left + Math.min(r.width / 2, 20), r.top + r.height / 2);
            return b.contains(el) ? null : { name: b.textContent, at: el?.className ?? String(el) };
          })
          .filter(Boolean);
        res({ rows: names.length, sl: box.scrollLeft, bad });
      }),
    );
  });
  check(
    hit.rows > 0 && hit.sl > 0 && hit.bad.length === 0,
    '週：右の端まで巻いても、名前の列がマスの上に見え、名前を押せる',
    hit,
  );
  await page.getByTestId('by-staff').click();
  await page.waitForURL(/view=timeline/);
  await page
    .getByTestId('week-grid')
    .waitFor({ timeout: 5000 })
    .catch(() => {});
  check(
    await visible(page.getByTestId('week-grid')),
    '週：390px で時間軸：〈スタッフ〉を押すと ?view=timeline で時間軸',
  );
  check((await pageWidth(page)) <= 390, '週：横にはみ出さない');

  // 案の無い週（新しい文脈。初期データの案（今日から7日分。PRD D225）を消す）：案内「この週は案がありません」が見え、
  // 縦には巻かない。今日の列まで横には巻く
  const ctx2 = await page
    .context()
    .browser()
    .newContext({ viewport: { width: 390, height: 844 } });
  await skipTour(ctx2);
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => check(false, '週（案の無い週）：ページのエラー', String(e)));
  await p2.clock.setFixedTime(NOW);
  try {
    await open(p2, '/home', 'h1');
    await p2.evaluate((k) => {
      const d = JSON.parse(localStorage.getItem(k));
      d.aiPlans = {};
      d.aiRuns = {};
      localStorage.setItem(k, JSON.stringify(d));
    }, STORAGE_KEY);
    await open(p2, '/week', '[data-testid="week-table"]');
    await settle(p2, 300);
    const empty = await p2.getByTestId('week-empty').boundingBox();
    const vb2 = await viewBand(p2);
    const y = await p2.evaluate(() => window.scrollY);
    const t2 = await p2.locator('[data-testid="week-table"] thead th.is-today').boundingBox();
    const n2 = await p2.locator('[data-testid="week-table"] thead th').first().boundingBox();
    check(
      empty && empty.y >= vb2.top - 1 && empty.y + empty.height <= vb2.bottom && y === 0 && t2.x >= n2.x + n2.width - 1,
      '週：案の無い週は案内「この週は案がありません」が見え（縦に巻かない）、表は今日の列まで横に巻く',
      { empty, vb2, y, t2 },
    );
    await p2.screenshot({ path: path.join(OUT_DIR, 'narrow-week-empty.png') });
  } finally {
    await ctx2.close();
  }
}

/** 空き状況（PRD D221）：表ははじめ 9:00 の列から（曜日の列のすぐ右）。右に続きがある印は端まで巻くと消える */
async function narrowVacancy(page) {
  await open(page, '/vacancy', '[data-testid="vacancy-grid"]');
  await settle(page, 300);
  const st = await page.getByTestId('vacancy-grid').evaluate((t) => {
    const box = t.parentElement;
    const corner = t.querySelector('thead th.vacancy-corner').getBoundingClientRect();
    const nine = t.querySelector('thead th[data-start="09:00"]').getBoundingClientRect();
    return {
      sl: box.scrollLeft,
      cornerRight: corner.right,
      nineLeft: nine.left,
      more: box.parentElement.classList.contains('has-more-right'),
    };
  });
  check(
    st.sl > 0 && st.nineLeft >= st.cornerRight - 1 && st.nineLeft - st.cornerRight < 20 && st.more,
    '空き状況：表ははじめ 9:00 の列が曜日の列のすぐ右（scrollLeft > 0）・右に続きがある印',
    st,
  );
  await page.getByTestId('vacancy-grid').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT_DIR, 'narrow-vacancy.png') });
  await page.getByTestId('vacancy-grid').evaluate((t) => {
    t.parentElement.scrollLeft = t.parentElement.scrollWidth;
  });
  await settle(page, 300);
  const more = await page
    .getByTestId('vacancy-grid')
    .evaluate((t) => t.parentElement.parentElement.classList.contains('has-more-right'));
  check(!more, '空き状況：右の端まで巻くと続きの印が消える');
  check((await pageWidth(page)) <= 390, '空き状況：横にはみ出さない');
}

/**
 * 相性・勤務時間（シフト）（PRD D272。ADR-0033）：ページは横にはみ出さず、表は横巻きの枠の中。名前の列を詰めて
 * （折り返す）〈スタッフ〉・日付の列が4つ以上見え、列の見出しの名前が枠の中で切れずに読める。上の帯の名前も切れない
 */
async function narrowGrids(page) {
  for (const [h, table, min] of [
    ['/compat', 'compat-table', 4],
    ['/availability', null, 5],
  ]) {
    await open(page, h, table ? `[data-testid="${table}"]` : '.avail-table');
    await settle(page, 300);
    const st = await page.evaluate(
      (sel) => {
        const t = document.querySelector(sel);
        const box = t.closest('.table-scroll').getBoundingClientRect();
        const name = t.querySelector('thead th.avail-name').getBoundingClientRect();
        const heads = [...t.querySelectorAll('thead th:not(.avail-name)')].map((th) => th.getBoundingClientRect());
        const whole = heads.filter((r) => r.left >= name.right - 1 && r.right <= box.right + 1).length;
        const screen = document.querySelector('[data-testid="screen-name"]');
        const parts = [screen, ...document.querySelectorAll('.m-screen-group, .m-screen-item')];
        return {
          page: document.documentElement.scrollWidth,
          nameWidth: Math.round(name.width),
          whole,
          titleClipped: parts.some((el) => el && el.scrollWidth > el.clientWidth + 1),
        };
      },
      table ? `[data-testid="${table}"]` : '.avail-table',
    );
    check(
      st.page <= 390 && st.whole >= min && st.nameWidth <= 130 && !st.titleClipped,
      `${h}：横にはみ出さず、名前の列を詰めて列が${min}つ以上見える・上の帯の名前が切れない（PRD D272）`,
      st,
    );
    await page.screenshot({ path: path.join(OUT_DIR, `narrow-grid${h.replace('/', '-')}.png`) });
  }
}

/** 広い画面（1400px）では表のまま（カードにしない・絞り込みを畳まない・週は時間軸） */
async function narrowWide(page) {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await open(page, '/clients', '[data-testid="narrow-clients"]');
  const st = await page.evaluate(() => ({
    row: getComputedStyle(document.querySelector('[data-testid="narrow-clients"] tbody > tr')).display,
    head: getComputedStyle(document.querySelector('[data-testid="narrow-clients"] thead')).position,
    toggle: !!document.querySelector('[data-testid="narrow-filter-toggle"]'),
    cf: !!document.querySelector('[data-testid="clients-cf"]')?.getClientRects().length,
  }));
  await open(page, '/week', '[data-testid="week-views"]');
  const timeline = await visible(page.locator('.week-grid'));
  check(
    st.row === 'table-row' && st.head !== 'absolute' && !st.toggle && st.cf && timeline,
    '1400px：一覧は表のまま・絞り込みは開いたまま・週の既定は時間軸',
    { ...st, timeline },
  );
  await page.setViewportSize({ width: 390, height: 844 });
}

async function print(page) {
  await open(page, '/plan', '[data-testid="bottom-tabs"]');
  await menuBtn(page).click();
  await drawer(page).waitFor();
  await page.emulateMedia({ media: 'print' });
  await settle(page, 200);
  const shown = await page.evaluate(() =>
    ['.app-header', '.bottom-tabs', '.nav-drawer-wrap'].map((s) => {
      const el = document.querySelector(s);
      return el ? getComputedStyle(el).display : 'none';
    }),
  );
  check(
    shown.every((d) => d === 'none'),
    '印刷：上の帯・下のタブ・引き出しを出さない',
    shown,
  );
  await page.emulateMedia({ media: 'screen' });
  await page.keyboard.press('Escape');
}

async function wide(page) {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await open(page, '/plan', '.side-nav');
  const shown = await page.evaluate(() =>
    ['.m-head-title', '.bottom-tabs'].map((s) => getComputedStyle(document.querySelector(s)).display),
  );
  check(
    shown.every((d) => d === 'none'),
    '広い画面：上の帯の部品・下のタブを出さない',
    shown,
  );
  const nav = await page.locator('.side-nav').boundingBox();
  check(nav.width === 232 && nav.height === 1000, '広い画面：左のメニューは今のまま（幅232px・縦いっぱい）', nav);
  check(
    (await page.locator('.side-nav .nav-group-title').count()) === 2 &&
      (await page.locator('.app-header').boundingBox()).height === 72,
    '広い画面：見出し付きのメニュー・上の帯の高さ 72px',
  );
  const pad = await page.evaluate(() => getComputedStyle(document.querySelector('.app-main')).paddingBottom);
  check(pad === '48px', '広い画面：本文の下の余白は今のまま', pad);
  await page.screenshot({ path: path.join(OUT_DIR, 'mobile-wide.png') });
}

const steps = sharedPage({
  open: () => openPage({ viewport: { width: 390, height: 844 }, context: { hasTouch: false } }),
  steps: [
    ['header', header],
    ['drawer', drawerOpenClose],
    ['bottom', bottom],
    ['floating', floating],
    ['fab-with-toast', fabWithToast],
    ['wide-while-open', wideWhileOpen],
    ['lock-with-panel', lockWithPanel],
    ['rules-narrow', narrowRules],
    ['lists-narrow', narrowLists],
    ['clients-filter-narrow', narrowClientFilter],
    ['compare-narrow', narrowCompare],
    ['week-narrow-default', narrowWeek],
    ['vacancy-narrow-start', narrowVacancy],
    ['grids-narrow', narrowGrids],
    ['narrow-wide', narrowWide],
    ['print', print],
    ['wide', wide],
  ],
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
