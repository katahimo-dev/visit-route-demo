// 相性の画面（PRD D113〜D117。ADR-0022）を本物のブラウザで確かめる：
// 列の見出しの名前が全部出る／吹き出しの開閉・キーボード・フォーカスの戻り・Tab で外へ出ると閉じる・中を巻ける・画面の端で切れない／
// 〈スタッフ〉・〈利用者さん〉の画面で開く（?id=）／列（?sf=）と行（?cf=）の絞り込みと再読込での復元・履歴を増やさない・
// 日本語の変換（IME）／0人の表示と「絞り込みを戻す」／最初に表の行が10行以上見える／
// 回帰：相性のチップを押したままセルを押しても行が消えない（「表を並べ直す」で並べ直す）、絞り込みで見出しが消えたら吹き出しを閉じる／
// 性能：〈利用者さん〉300人×〈スタッフ〉60人で、セルを1回押してから描き終わるまでの時間（目安 100ms 以下）。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-compat.cjs
// 環境変数は scripts/e2e-drag.cjs と同じ（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR）。ほかに
//   PERF_MS … セルを押してから描き終わるまでの上限（ミリ秒。既定 100。中央値で比べる）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean);
  for (const p of tries) {
    try {
      return require(p);
    } catch {
      // 次の候補へ
    }
  }
  throw new Error(`Playwright が見つかりません（試した場所：${tries.join('、')}）。PLAYWRIGHT で場所を渡してください`);
}

const { chromium } = loadPlaywright();
const BASE = process.env.BASE || 'http://localhost:4183/';
const OUT_DIR = process.env.OUT_DIR || path.join(os.tmpdir(), 'e2e-compat');
const PERF_MS = Number(process.env.PERF_MS || 100);
fs.mkdirSync(OUT_DIR, { recursive: true });

let fails = 0;
function check(ok, name, info = '') {
  if (!ok) fails++;
  console.log(
    `${ok ? 'OK  ' : 'NG  '} ${name}${info === '' ? '' : `  ${typeof info === 'string' ? info : JSON.stringify(info)}`}`,
  );
}
/** URL（値の中も encodeURIComponent しているので2回戻す） */
const urlOf = (page) => decodeURIComponent(decodeURIComponent(page.url()));
/** 押したあとの描き直しを待つ */
const settle = (page) => page.waitForTimeout(250);
const countOf = async (loc) =>
  Number(((await loc.locator('.client-filter-count').textContent()) ?? '').replace(/\D/g, ''));

async function openCompat(page, query = '') {
  await page.goto(`${BASE}#/compat${query}`);
  await page.getByTestId('compat-filters').waitFor();
  await page.waitForTimeout(300);
}
/** 絞り込みの欄を開く（畳んであれば） */
async function openBox(page, which) {
  const box = page.getByTestId(`compat-${which}-box`);
  if (!(await box.evaluate((el) => el.open))) await box.locator('summary').click();
}
const heads = (page) => page.getByTestId('compat-head-btn');
const rows = (page) => page.getByTestId('compat-client-btn');
const pop = (page) => page.getByTestId('compat-pop');
const label = async (loc) => ((await loc.getAttribute('aria-label')) ?? '').replace(/の詳細$/, '');

async function namesAndLayout(page) {
  await openCompat(page);
  const info = await page.$$eval('[data-testid="compat-head-btn"]', (bs) =>
    bs.map((b) => ({
      name: b
        .getAttribute('aria-label')
        .replace(/の詳細$/, '')
        .replace(/\s+/g, ''),
      lines: [...b.querySelectorAll('.compat-head-line')].map((l) => ({
        t: l.textContent,
        cut: l.scrollWidth > l.clientWidth + 1,
      })),
      width: Math.round(b.closest('th').getBoundingClientRect().width),
    })),
  );
  check(info.length > 0, '列の見出しがある', info.length);
  check(
    info.every((h) => h.lines.map((l) => l.t).join('') === h.name && h.lines.every((l) => !l.cut)),
    '名前が切れずに全部出る（2行）',
    info.map((h) => h.lines.map((l) => l.t).join('/')).join('、'),
  );
  check(
    Math.max(...info.map((h) => h.width)) <= 80,
    '列の幅は今と同じくらい',
    `${Math.max(...info.map((h) => h.width))}px`,
  );
  // 畳んだ欄の要約と、最初に見える行の数
  check(!(await page.getByTestId('compat-sf-box').evaluate((el) => el.open)), 'URL に絞り込みが無ければ欄は畳んである');
  check(
    /人・絞り込みなし$/.test(await page.getByTestId('compat-sf-summary').textContent()),
    '要約に今の状態',
    await page.getByTestId('compat-sf-summary').textContent(),
  );
  const visible = await page.$$eval(
    '[data-testid="compat-client-btn"]',
    (bs) => bs.filter((b) => b.getBoundingClientRect().bottom <= window.innerHeight).length,
  );
  check(visible >= 10, '1280×900 で最初に表の行が10行以上見える', `${visible}行`);
  await page.screenshot({ path: path.join(OUT_DIR, 'compat-first.png') });
  // 見出しの行と1列目は止まる
  await page.locator('.compat-scroll').evaluate((el) => {
    el.scrollTop = 200;
    el.scrollLeft = 100;
  });
  await page.waitForTimeout(100);
  const stick = await page.evaluate(() => {
    const sc = document.querySelector('.compat-scroll').getBoundingClientRect();
    const th = document.querySelector('.compat-table thead th.compat-head').getBoundingClientRect();
    const first = document.querySelector('.compat-table tbody th').getBoundingClientRect();
    return { headTop: Math.round(th.top - sc.top), firstLeft: Math.round(first.left - sc.left) };
  });
  check(stick.headTop <= 3 && stick.firstLeft <= 3, '見出しの行と1列目が止まる', stick);
}

async function popover(page) {
  await openCompat(page);
  const btn = heads(page).first();
  await btn.click();
  await pop(page).waitFor();
  const id = await pop(page).getAttribute('id');
  check(
    (await btn.getAttribute('aria-expanded')) === 'true' && (await btn.getAttribute('aria-controls')) === id,
    'aria-expanded・aria-controls',
  );
  check(
    (await pop(page).getAttribute('role')) === 'dialog' && (await pop(page).getAttribute('aria-labelledby')) !== null,
    'role=dialog と名前',
  );
  const text = await pop(page).textContent();
  check(
    ['移動手段', '稼働時間', '相性', '◎', 'いつもの担当', 'の画面で開く'].every((w) => text.includes(w)),
    '〈スタッフ〉の中身',
  );
  check(await pop(page).evaluate((el) => el.contains(document.activeElement)), '開いたらフォーカスが吹き出しへ');
  await page.keyboard.press('Escape');
  await pop(page).waitFor({ state: 'detached' });
  check(await btn.evaluate((el) => document.activeElement === el), 'Esc で閉じてフォーカスがボタンへ');
  await page.keyboard.press('Enter');
  await pop(page).waitFor();
  await btn.click();
  await pop(page).waitFor({ state: 'detached' });
  check(await btn.evaluate((el) => document.activeElement === el), 'もう一度押すと閉じてフォーカスがボタンへ');
  await page.keyboard.press(' ');
  await pop(page).waitFor();
  await page.mouse.click(5, 5);
  await pop(page).waitFor({ state: 'detached' });
  check(true, '外を押すと閉じる');
  // Tab で外へ出ると閉じる
  await btn.click();
  await pop(page).waitFor();
  for (let i = 0; i < 5 && (await pop(page).count()) > 0; i++) await page.keyboard.press('Tab');
  check(
    (await pop(page).count()) === 0 && (await btn.evaluate((el) => document.activeElement === el)),
    'Tab で外へ出ると閉じてフォーカスがボタンへ',
  );

  // 中を巻ける（低い画面）・画面の端で切れない（狭い画面）
  await page.setViewportSize({ width: 480, height: 360 });
  const last = heads(page).last();
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await pop(page).waitFor();
  const box = await pop(page).boundingBox();
  check(box.x >= 0 && box.x + box.width <= 480 && box.y >= 0 && box.y + box.height <= 360, '画面の中に出る', box);
  const canScroll = await pop(page).evaluate((el) => el.scrollHeight > el.clientHeight);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(400);
  const top = await pop(page).evaluate((el) => el.scrollTop);
  check(canScroll && top > 0, '吹き出しの中を巻ける（戻らない）', { canScroll, scrollTop: top });
  await page.screenshot({ path: path.join(OUT_DIR, 'compat-pop-scroll.png') });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 900 });

  // 〈利用者さん〉の吹き出し
  const cbtn = rows(page).first();
  await cbtn.click();
  await pop(page).waitFor();
  const ctext = await pop(page).textContent();
  check(
    ['段階', '地区', '必要条件', '希望', '担当できる人', 'いつもの担当'].every((w) => ctext.includes(w)),
    '〈利用者さん〉の中身',
  );
  await page.keyboard.press('Escape');
}

async function openById(page) {
  for (const [kind, sel, to] of [
    ['client', 'compat-client-btn', '#/clients'],
    ['staff', 'compat-head-btn', '#/staff'],
  ]) {
    await openCompat(page);
    const b = page.getByTestId(sel).first();
    const name = await label(b);
    await b.click();
    await pop(page).getByTestId('compat-pop-link').click();
    await page.waitForTimeout(400);
    // 開くのは閲覧の欄（PRD D127）。見出しに名前
    const head = (await page.locator('.drawer h2').first().textContent()) ?? '';
    const opened = head.includes(name) && (await page.getByTestId('person-view').count()) === 1;
    check(
      urlOf(page).includes(to) && !urlOf(page).includes('id=') && opened,
      `${kind}：?id= で ${name} の閲覧の欄が開き、URL から id を消す`,
    );
  }
  // いない ID は何もしない
  await page.goto(`${BASE}#/staff?id=nobody`);
  await page.waitForTimeout(300);
  check(!urlOf(page).includes('id=') && (await page.locator('.side-panel').count()) === 0, 'いない ID は欄を開かない');
}

async function filters(page) {
  await openCompat(page);
  const hist0 = await page.evaluate(() => history.length);
  const cols0 = await heads(page).count();
  const rows0 = await rows(page).count();
  await openBox(page, 'sf');
  const chip = page.getByTestId('compat-sf-chip').filter({ hasText: '性別：女性' });
  const n = await countOf(chip);
  await chip.click();
  await settle(page);
  check((await heads(page).count()) === n && n < cols0, '特性のチップで列を絞る', `${cols0} → ${n}`);
  check(
    (await page.locator('[data-testid="compat-sf-chip"][aria-disabled="true"]').count()) > 0,
    '0人のチップは押せない',
  );
  const sfIn = page.getByTestId('compat-sf-input');
  const first = (await label(heads(page).first())).split(/\s/)[0];
  await sfIn.fill(first);
  await page.waitForTimeout(500);
  check((await heads(page).count()) === 1, '名前で探す');
  await openBox(page, 'cf');
  const ng = page.locator('[data-testid="compat-cf-chip"][data-chip="ng"]');
  const ngN = await countOf(ng);
  await ng.click();
  await settle(page);
  check((await rows(page).count()) === ngN && ngN < rows0, '× がある人で行を絞る', `${rows0} → ${ngN}`);
  check(
    urlOf(page).includes(`sf=q:${first}`) && urlOf(page).includes('x:ng'),
    'URL に ?sf= と ?cf= を書く',
    urlOf(page),
  );
  check(
    (await page.getByTestId('compat-cf-summary').textContent()).includes(`${ngN}人／${rows0}人`),
    '行の要約',
    await page.getByTestId('compat-cf-summary').textContent(),
  );
  const hist1 = await page.evaluate(() => history.length);
  await page.reload();
  await page.getByTestId('compat-filters').waitFor();
  await page.waitForTimeout(300);
  check((await heads(page).count()) === 1 && (await rows(page).count()) === ngN, '再読込で絞り込みが戻る');
  check(
    (await page.getByTestId('compat-sf-box').evaluate((el) => el.open)) &&
      (await page.getByTestId('compat-cf-box').evaluate((el) => el.open)),
    'URL に絞り込みがあれば欄を開いておく',
  );
  check(
    (await ng.getAttribute('aria-pressed')) === 'true' && (await sfIn.inputValue()) === first,
    'チップ・検索の文字が戻る',
  );
  check(hist1 === hist0, '絞り込みで履歴を増やさない', `${hist0} → ${hist1}`);
  await ng.click();
  await settle(page);
  const pend = page.locator('[data-testid="compat-cf-chip"][data-chip="pending"]');
  const pN = await countOf(pend);
  await pend.click();
  await settle(page);
  check((await rows(page).count()) === pN, 'まだ相性が入っていない組がある人', `${pN}人`);
  await pend.click();
  await settle(page);
  await page.getByTestId('compat-cf-city').first().click();
  await settle(page);
  check((await rows(page).count()) < rows0, '地区で行を絞る');
  check((await page.getByTestId('compat-cf-ended').count()) === 0, '「終了の人も出す」は出さない');
  // 0人
  await sfIn.fill('存在しない名前');
  await page.waitForTimeout(500);
  const empty = page.getByTestId('compat-empty');
  check(
    (await empty.textContent()).includes('当てはまる') && (await page.getByTestId('compat-table').count()) === 0,
    '0人なら表の代わりに知らせる',
    await empty.textContent(),
  );
  await page.getByTestId('compat-empty-sf-reset').click();
  await settle(page);
  check((await heads(page).count()) === cols0 && (await sfIn.inputValue()) === '', '「絞り込みを戻す」で列が戻る');
  await page.getByTestId('compat-cf-reset').click();
  await settle(page);
  check((await rows(page).count()) === rows0 && !urlOf(page).includes('cf='), '行の絞り込みを戻す');
  // 日本語の変換
  const cdp = await page.context().newCDPSession(page);
  await sfIn.click();
  const before = urlOf(page);
  await cdp.send('Input.imeSetComposition', { text: 'し', selectionStart: 1, selectionEnd: 1 });
  await page.waitForTimeout(400);
  await cdp.send('Input.imeSetComposition', { text: 'しや', selectionStart: 2, selectionEnd: 2 });
  await page.waitForTimeout(400);
  check(urlOf(page) === before && (await sfIn.inputValue()) === 'しや', '変換中は URL に書かず、文字も残る');
  await cdp.send('Input.insertText', { text: '市役所' });
  await page.waitForTimeout(500);
  check(urlOf(page).includes('q:市役所'), '確定で URL に書く');
  // 知らないチップ・終了の人も出すは URL から捨てる
  await openCompat(page, '?sf=chip:nope&cf=chip:;ended:1;x:zzz');
  check(!urlOf(page).includes('sf=') && !urlOf(page).includes('cf='), '捨てたチップは URL を書き直す', urlOf(page));
}

/** 回帰：相性のチップを押したままセルを押しても行が消えない。絞り込みで見出しが消えたら吹き出しを閉じる */
async function regressions(page) {
  await openCompat(page, '?cf=chip:;x:ng');
  const n0 = await rows(page).count();
  const cell = page.locator('tbody tr').first().locator('.compat-btn', { hasText: '×' }).first();
  const who = await label(rows(page).first());
  await cell.click();
  await settle(page);
  check(
    (await rows(page).count()) === n0 && (await label(rows(page).first())) === who,
    'セルを押しても行が消えない',
    `${n0}行`,
  );
  const resort = page.getByTestId('compat-resort');
  check(
    (await resort.count()) === 1 && !(await resort.evaluate((el) => el.classList.contains('btn-primary'))),
    '「表を並べ直す」が出る（主ボタンではない）',
  );
  await resort.click();
  await settle(page);
  check(
    (await rows(page).count()) <= n0 && (await resort.count()) === 0,
    '並べ直す',
    `${n0} → ${await rows(page).count()}`,
  );

  await openCompat(page);
  await openBox(page, 'sf');
  const b = heads(page).first();
  const name = await label(b);
  await b.click();
  await pop(page).waitFor();
  await page.getByTestId('compat-sf-input').fill('存在しない名前');
  await page.waitForTimeout(500);
  check((await pop(page).count()) === 0, '絞り込みで見出しが消えたら吹き出しを閉じる');
  await page.getByTestId('compat-sf-input').fill('');
  await page.waitForTimeout(500);
  const again = heads(page)
    .filter({ has: page.locator('.compat-head-name') })
    .first();
  check(
    (await label(again)) === name && (await again.getAttribute('aria-expanded')) === 'false',
    '見出しが戻っても開いたままにならない',
  );
}

/** 性能：300人×60人で、セルを押して描き終わるまで（中央値） */
async function perf(page) {
  await openCompat(page);
  await page.evaluate(() => {
    const key = 'vrdemo:data:v1';
    const d = JSON.parse(localStorage.getItem(key));
    const baseC = d.clients.filter((c) => c.active);
    const baseS = d.staff.filter((s) => s.active);
    const clients = [];
    for (let i = 0; clients.length < 300; i++) {
      const c = baseC[i % baseC.length];
      clients.push({
        ...c,
        id: `pc${i}`,
        displayName: `${c.displayName}${i}`,
        usualStaffId: null,
        allowedStaffIds: [],
      });
    }
    const staff = [];
    for (let i = 0; staff.length < 60; i++) {
      const s = baseS[i % baseS.length];
      staff.push({ ...s, id: `ps${i}`, name: `${s.name}${i}`, email: '' });
    }
    const compat = {};
    clients.forEach((c, i) => {
      compat[c.id] = {};
      staff.forEach((s, j) => {
        const l = [2, 1, 0, -1, -2][(i * 7 + j * 3) % 5];
        if (l !== 0) compat[c.id][s.id] = l;
      });
    });
    localStorage.setItem(
      key,
      JSON.stringify({ ...d, clients: [...d.clients, ...clients], staff: [...d.staff, ...staff], compat }),
    );
  });
  await page.reload();
  await page.getByTestId('compat-table').waitFor();
  await page.waitForTimeout(1500);
  const size = { rows: await rows(page).count(), cols: await heads(page).count() };
  const times = await page.evaluate(async () => {
    const out = [];
    const btns = document.querySelectorAll('tbody tr:nth-child(5) .compat-btn');
    for (let i = 0; i < 7; i++) {
      const b = btns[i];
      const t0 = performance.now();
      b.click();
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      out.push(Math.round(performance.now() - t0));
    }
    return out;
  });
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  check(size.rows >= 300 && size.cols >= 60, '300人×60人の表', size);
  check(median <= PERF_MS, `セルを1回押して描き終わるまで（中央値 ${PERF_MS}ms 以下）`, { median, times });
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const errors = [];
  const fresh = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('dialog', (d) => d.accept());
    return { ctx, page };
  };
  for (const step of [namesAndLayout, popover, openById, filters, regressions, perf]) {
    const { ctx, page } = await fresh();
    try {
      await step(page);
    } catch (e) {
      check(false, `${step.name} が止まった`, String(e).split('\n')[0]);
      await page.screenshot({ path: path.join(OUT_DIR, `compat-error-${step.name}.png`) }).catch(() => {});
    }
    await ctx.close();
  }
  check(errors.length === 0, 'ページのエラーなし', errors.join(' / '));
  await browser.close();
  console.log(`スクリーンショット：${OUT_DIR}`);
  console.log(fails === 0 ? '全部通った' : `通らないもの ${fails}件`);
  process.exit(fails === 0 ? 0 : 1);
})();
