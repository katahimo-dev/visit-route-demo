// スマホ（幅860px以下）のメニュー（PRD D132〜D135。ADR-0024）を本物のブラウザ（390×844）で確かめる：
// 上の帯（ロゴと今の画面の名前・「メニュー」・日付の切り替え。〈利用者さん〉一覧と〈スタッフ〉一覧を見分ける。PRD D179）、
// 引き出し（role="dialog"・aria-modal・名前、ボタンの aria-expanded・aria-controls、グループの見出し付きの縦並び、
// 画面を選ぶ・外を押す・Esc で閉じてフォーカスが「メニュー」へ、Tab・Shift+Tab が中で回る、開いているあいだ裏を巻かない）、
// 下のタブ（ホーム・月・週・日・空き状況（PRD D144）、active と aria-current、比較では「日」、本文の最後がタブに隠れない）、
// 浮いている部品（地図の MapDock・欠勤の振り直しの ReassignDock・トースト）がタブに重ならない、
// 本物の地図のボタンと本物のトースト（PRD D190。ボタンはタブのすぐ上・トーストが出ても互いに隠れない・本文の下を空ける・safe-area）、印刷で上の帯・下のタブ・引き出しを出さない、
// 広い画面（1400px）では今の左のメニューのままで、上の帯の部品・下のタブを出さない。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-mobile.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { skipTour } = require('./lib/tourSeen.cjs');
const { launch, BASE, OUT_DIR, NOW, check, isFocused, failShot, run } = require('./lib/env.cjs');

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
  await page.waitForTimeout(400);
}

async function header(page) {
  await open(page, '/clients', '[data-testid="screen-name"]');
  const name = await page.getByTestId('screen-name').innerText();
  await open(page, '/staff', '[data-testid="screen-name"]');
  const name2 = await page.getByTestId('screen-name').innerText();
  check(
    name === '人の情報・利用者さん一覧' && name2 === '人の情報・スタッフ一覧',
    '上の帯：〈利用者さん〉一覧と〈スタッフ〉一覧を見分ける',
    {
      name,
      name2,
    },
  );
  await open(page, '/plan', '[data-testid="screen-name"]');
  check((await page.getByTestId('screen-name').innerText()) === '予定を組む・日', '上の帯：予定を組む・日');
  check(await visible(page.locator('.app-header .date-switch')), '上の帯：日付の切り替えがある');
  check(!(await visible(page.locator('.side-nav'))), '左のメニューは出さない');
  const hb = await page.locator('.app-header').boundingBox();
  const mb = await menuBtn(page).boundingBox();
  check(mb.x + mb.width <= 390 && hb.width <= 390, '上の帯が画面の幅に収まる（横に巻かない）', { hb, mb });
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
      (await d.locator('h2.nav-group-title').count()) >= 5,
    '引き出し：後ろの画面は inert・グループの見出しは h2',
  );
  check(
    (await btn.getAttribute('aria-expanded')) === 'true' &&
      (await btn.getAttribute('aria-controls')) === (await d.getAttribute('id')),
    'ボタン：aria-expanded=true・aria-controls が引き出しを指す',
  );
  const titles = await d.locator('.nav-group-title').allInnerTexts();
  check(
    titles.length >= 5 && titles.includes('予定を組む') && titles.includes('AI の考え方'),
    '引き出し：グループの見出し付き',
    titles,
  );
  const links = d.locator('.nav-link');
  const n = await links.count();
  const boxes = [];
  for (let i = 0; i < n; i++) boxes.push(await links.nth(i).boundingBox());
  check(n >= 16 && boxes.every((b, i) => i === 0 || b.y > boxes[i - 1].y), '引き出し：全部のメニューを縦に並べる', {
    n,
  });
  await page.waitForTimeout(400); // 出てくる動きが終わるまで
  const db = await d.boundingBox();
  check(db.x === 0 && db.width < 390, '引き出し：左から出る', db);
  const current = d.locator('[aria-current="page"]');
  check(
    (await current.innerText()).includes('週') && (await isFocused(current)),
    '引き出し：開いたら今の画面の項目へフォーカス',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'mobile-drawer.png') });

  // 裏の画面を巻かない
  const y0 = await page.evaluate(() => window.scrollY);
  await page.mouse.move(380, 600);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(300);
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
  const labels = await t.getByTestId('bottom-tab').allInnerTexts();
  check(
    JSON.stringify(labels) === JSON.stringify(['ホーム', '月', '週', '日', '空き状況']),
    '下のタブ：ホーム・月・週・日・空き状況（PRD D144）',
    labels,
  );
  const tb = await t.boundingBox();
  check(Math.round(tb.y + tb.height) === 844 && tb.x === 0 && tb.width === 390, '下のタブ：画面の下に常に並ぶ', tb);
  const active = async () => t.locator('.bottom-tab.active[aria-current="page"]').allInnerTexts();
  check(JSON.stringify(await active()) === '["週"]', '下のタブ：今の画面（週）が active・aria-current');
  // 今の画面のタブは何もしない（URL のクエリを消さない）
  await open(page, '/week?view=table', '[data-testid="bottom-tabs"]');
  await t.getByTestId('bottom-tab').filter({ hasText: '週' }).click();
  await page.waitForTimeout(300);
  check(
    page.url().includes('view=table') && JSON.stringify(await active()) === '["週"]',
    '下のタブ：今の画面のタブは何もしない',
    page.url(),
  );
  await t.getByTestId('bottom-tab').filter({ hasText: '空き状況' }).click();
  await page.waitForURL(/#\/vacancy/);
  await page.waitForTimeout(300);
  check(JSON.stringify(await active()) === '["空き状況"]', '下のタブ：押すと移る（空き状況）', await active());
  await open(page, '/compare', '[data-testid="bottom-tabs"]');
  check(JSON.stringify(await active()) === '["日"]', '下のタブ：比較では「日」');
  await open(page, '/clients', '[data-testid="bottom-tabs"]');
  check((await active()).length === 0, '下のタブ：5つ以外の画面ではどれも active にしない');
  // 本文の最後がタブに隠れない（いちばん下まで巻いて、本文の下の端がタブより上）
  await open(page, '/data', '[data-testid="bottom-tabs"]');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
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
  // 本物の地図のボタン：地図のカードが画面の外に出るまで巻いたとき（出れば重ならないかを見る）
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(800);
  const fabReal = page.locator('.map-dock-fab');
  await fabReal.waitFor({ timeout: 20000 });
  const fb = await fabReal.boundingBox();
  check(!overlaps(fb, tb), '本物の地図のボタン（MapDock）が下のタブに重ならない', fb);
  // 開いた地図も本物で
  await fabReal.click();
  const dockReal = page.locator('section.map-dock');
  await dockReal.waitFor();
  await page.waitForTimeout(400); // 出てくる動きが終わるまで
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
  await page.waitForTimeout(300);
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
  await page.waitForTimeout(400); // 出てくる動きが終わるまで
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

async function print(page) {
  await open(page, '/plan', '[data-testid="bottom-tabs"]');
  await menuBtn(page).click();
  await drawer(page).waitFor();
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(200);
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
    ['.m-head-title', '.m-menu-btn', '.bottom-tabs'].map((s) => getComputedStyle(document.querySelector(s)).display),
  );
  check(
    shown.every((d) => d === 'none'),
    '広い画面：上の帯の部品・下のタブを出さない',
    shown,
  );
  const nav = await page.locator('.side-nav').boundingBox();
  check(nav.width === 232 && nav.height === 1000, '広い画面：左のメニューは今のまま（幅232px・縦いっぱい）', nav);
  check(
    (await page.locator('.side-nav .nav-group-title').count()) >= 5 &&
      (await page.locator('.app-header').boundingBox()).height === 72,
    '広い画面：見出し付きのメニュー・上の帯の高さ 72px',
  );
  const pad = await page.evaluate(() => getComputedStyle(document.querySelector('.app-main')).paddingBottom);
  check(pad === '48px', '広い画面：本文の下の余白は今のまま', pad);
  await page.screenshot({ path: path.join(OUT_DIR, 'mobile-wide.png') });
}

run(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: false });
  // 初回の案内ツアーを見た扱いにする（PRD D193）
  await skipTour(ctx);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(String(e));
    console.log('ERR', String(e));
  });
  for (const [name, fn] of [
    ['header', header],
    ['drawer', drawerOpenClose],
    ['bottom', bottom],
    ['floating', floating],
    ['fab-with-toast', fabWithToast],
    ['wide-while-open', wideWhileOpen],
    ['lock-with-panel', lockWithPanel],
    ['print', print],
    ['wide', wide],
  ]) {
    try {
      await fn(page);
    } catch (e) {
      check(false, name, String(e.message || e));
      await failShot(page, name);
    }
  }
  await b.close();
  return errors;
});
