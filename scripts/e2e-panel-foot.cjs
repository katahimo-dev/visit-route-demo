// 右の欄（SidePanel）の確定のボタンの帯が中身に付いてくること（PRD D194〜D197。ADR-0025 追記）を本物のブラウザで確かめる：
// 中身が短い欄は帯が内容のすぐ下（欄の下端より上）・区切りの線と影を出さない、中身が長い欄は帯が欄の下に貼り付き
// 巻いても見え、内容が帯の下に隠れている間だけ区切り（data-stuck="true"）・巻き終えると区切りを消す、
// 帯の下に隠れた入力欄へ Tab で入ると帯の上まで巻く（scroll-padding-bottom）、Tab が中で回る・Esc で閉じて戻る、
// 帯の無い欄（閲覧）、390px：2つまでは横に並べ主ボタンが先、3つ以上は主ボタンを1行目に全幅・残りは2つずつ、
// 下のタブ・safe-area に隠れない、キーボード（visualViewport が縮む）が出ても帯が見える、印刷（連絡の一覧）で帯を出さない。
// 代表の欄：欠勤・キャンセル（1〜4段目・キャンセルの3段目）、〈スタッフ〉の閲覧と編集、月の「まとめて作る」、日の差の欄の「連絡の一覧」。
// 1400×1000 と 390×844 の両方で見る。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-panel-foot.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { skipTour } = require('./lib/tourSeen.cjs');
const { answerConfirms } = require('./lib/confirmDialog.cjs');
const { launch, BASE, OUT_DIR, NOW, TODAY, STORAGE_KEY, check, settle, failShot, runSteps } = require('./lib/env.cjs');
const { guard, firstLine } = require('./lib/steps.cjs');

const YM = TODAY.slice(0, 7);

const drawer = (page) => page.locator('.drawer');
const sudden = (page) => page.getByTestId('sudden-panel');
const shot = (page, name) => page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });

async function open(page, hash, ready) {
  // 同じ文書の中で hash を移してから読み直すと、読み直す前に `?id=` が処理されて URL から消えることがあるので、
  // about:blank を挟んで開く（e2e-home と同じ）
  await page.goto('about:blank');
  await page.goto(`${BASE}#${hash}`);
  await page.locator(ready).first().waitFor({ timeout: 60000 });
  await settle(page, 400);
}
/** 今の案が出て計算が終わるまで待つ */
async function waitPlan(page) {
  await page.getByTestId('confirm-state').waitFor({ state: 'attached', timeout: 60000 });
  await page.getByTestId('plan-progress').waitFor({ state: 'detached', timeout: 60000 });
  await settle(page, 300);
}
/** データを初期状態に戻して今日の日の画面を開く */
async function freshPlan(page) {
  await page.goto(`${BASE}#/home`);
  await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
  await page.goto(`${BASE}#/plan?date=${TODAY}`);
  await page.reload();
  await waitPlan(page);
}

/**
 * 欄と帯の位置（画面の座標）。帯が無ければ foot は null。
 * last＝内容（帯の前）の最後の子の下端、body＝巻く領域
 */
const metrics = (page) =>
  page.evaluate(() => {
    const dr = document.querySelector('.drawer');
    if (!dr) return null;
    const body = dr.querySelector('.drawer-body');
    const foot = dr.querySelector('.drawer-foot');
    const content = dr.querySelector('.drawer-content') ?? body;
    const kids = [...content.children].filter((el) => el.offsetParent !== null && el !== foot);
    const last = kids.length ? Math.max(...kids.map((el) => el.getBoundingClientRect().bottom)) : 0;
    const r = (el) => {
      const b = el.getBoundingClientRect();
      return {
        top: Math.round(b.top),
        bottom: Math.round(b.bottom),
        left: Math.round(b.left),
        right: Math.round(b.right),
      };
    };
    const btns = foot
      ? [...foot.querySelectorAll(':scope > .btn')].map((b) => ({
          ...r(b),
          width: Math.round(b.getBoundingClientRect().width),
          primary: b.classList.contains('btn-primary') || b.classList.contains('btn-danger'),
          // ボタンの真ん中に、ほかの物（下のタブなど）が重なっていないか
          hit: (() => {
            const c = b.getBoundingClientRect();
            const at = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
            return !!at && b.contains(at);
          })(),
        }))
      : [];
    return {
      drawer: r(dr),
      body: {
        ...r(body),
        scrollTop: Math.round(body.scrollTop),
        scrollable: body.scrollHeight > body.clientHeight + 1,
      },
      foot: foot ? r(foot) : null,
      footWidth: foot ? Math.round(foot.getBoundingClientRect().width) : 0,
      footScrollW: foot ? foot.scrollWidth : 0,
      footClientW: foot ? foot.clientWidth : 0,
      stuck: foot?.getAttribute('data-stuck') ?? null,
      last: Math.round(last),
      innerHeight: window.innerHeight,
      btns,
    };
  });

/** 中身が短い欄：帯は内容のすぐ下で、欄の下端より上。区切りは出さない */
async function expectShort(page, label) {
  const m = await metrics(page);
  check(!!m?.foot, `${label}：帯がある`);
  if (!m?.foot) return m;
  check(!m.body.scrollable, `${label}：中身が短く巻かない`, m.body);
  const gap = m.foot.top - m.last;
  check(gap >= 0 && gap <= 40, `${label}：帯が内容のすぐ下（間 ${gap}px）`, { footTop: m.foot.top, last: m.last });
  // 短い欄の帯は内容のすぐ下（上の確かめ）にあり、欄の下に貼り付かない（下端が欄の下端より上で、欄の中）。
  // 空きの幅は中身の量で変わるので決めない。貼り付いた帯は下端が欄の下端と同じ（±1px）なので、それより上なら足りる
  check(m.foot.top >= m.drawer.top && m.foot.bottom < m.drawer.bottom - 1, `${label}：帯が欄の下端より上`, {
    foot: m.foot.bottom,
    drawer: m.drawer.bottom,
  });
  check(m.stuck === 'false', `${label}：貼り付いていないので区切り（線・影）を出さない`, m.stuck);
  check(
    m.btns.every((b) => b.hit && b.bottom <= m.innerHeight),
    `${label}：ボタンが見えて押せる`,
    m.btns,
  );
  return m;
}

/** 中身が長い欄：帯は欄の下に貼り付き、巻いても見える。内容が隠れている間だけ区切り、巻き終えると消える */
async function expectLong(page, label) {
  const body = page.locator('.drawer-body');
  await body.evaluate((el) => {
    el.scrollTop = 0;
  });
  await settle(page, 200);
  let m = await metrics(page);
  check(!!m?.foot, `${label}：帯がある`);
  if (!m?.foot) return m;
  check(m.body.scrollable, `${label}：中身が長く巻く`, m.body);
  check(Math.abs(m.foot.bottom - m.drawer.bottom) <= 1, `${label}：帯が欄の下に貼り付く（上の端）`, {
    foot: m.foot.bottom,
    drawer: m.drawer.bottom,
  });
  check(m.stuck === 'true', `${label}：内容が帯の下にある間は区切り（線・影）を出す`, m.stuck);
  check(
    m.btns.every((b) => b.hit && b.bottom <= m.innerHeight),
    `${label}：巻かなくても確定のボタンが見えて押せる`,
    m.btns,
  );
  await body.evaluate((el) => {
    el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
  });
  await settle(page, 200);
  m = await metrics(page);
  check(
    Math.abs(m.foot.bottom - m.drawer.bottom) <= 1 && m.stuck === 'true' && m.btns.every((b) => b.hit),
    `${label}：途中まで巻いても帯が下に見える`,
    { foot: m.foot, stuck: m.stuck },
  );
  await body.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await settle(page, 250);
  m = await metrics(page);
  const gap = m.foot.top - m.last;
  check(
    Math.abs(m.foot.bottom - m.drawer.bottom) <= 1 && gap >= 0 && gap <= 40,
    `${label}：巻き終えると帯は内容のすぐ下（間 ${gap}px）`,
    { foot: m.foot, last: m.last },
  );
  check(m.stuck === 'false', `${label}：巻き終えると区切りを消す`, m.stuck);
  await body.evaluate((el) => {
    el.scrollTop = 0;
  });
  await settle(page, 200);
  return m;
}

/** 長さに合わせてどちらか（中身が幅や段階で変わる欄） */
async function expectFits(page, label) {
  const m = await metrics(page);
  if (!m?.foot) {
    check(false, `${label}：帯がある`);
    return m;
  }
  return m.body.scrollable ? expectLong(page, `${label}（長い）`) : expectShort(page, `${label}（短い）`);
}

/** 390px の並び：2つまでは1行で主ボタンが先、3つ以上は主ボタンが1行目に全幅・残りは2つずつ。横にはみ出さない */
async function expectMobileRow(page, label) {
  const m = await metrics(page);
  if (!m?.foot) return;
  const b = m.btns;
  check(
    m.footScrollW <= m.footClientW && b.every((x) => x.left >= 0 && x.right <= 390),
    `${label}：帯が横にはみ出さない`,
    {
      sw: m.footScrollW,
      cw: m.footClientW,
    },
  );
  if (b.length === 0) return;
  if (b.some((x) => x.primary)) check(b[0].primary, `${label}：主ボタンが先頭`, b);
  if (b.length === 2) {
    check(b[0].top === b[1].top && b[0].left < b[1].left, `${label}：2つは横に並べ、主ボタンが左`, b);
    check(Math.abs(b[0].width - b[1].width) <= 2, `${label}：2つは同じ幅`, b);
  } else if (b.length === 1) {
    check(b[0].width >= m.footWidth - 60, `${label}：1つは帯いっぱい`, { w: b[0].width, foot: m.footWidth });
  } else {
    check(
      b[0].width >= m.footWidth - 60 && b.slice(1).every((x) => x.top > b[0].top),
      `${label}：3つ以上は主ボタンを1行目に全幅`,
      b,
    );
    const rows = new Map();
    for (const x of b.slice(1)) rows.set(x.top, (rows.get(x.top) ?? 0) + 1);
    check(
      [...rows.values()].every((n) => n <= 2),
      `${label}：残りは1行に2つまで`,
      [...rows.entries()],
    );
  }
  check(
    b.every((x) => x.hit && x.bottom <= m.innerHeight),
    `${label}：下のタブ・画面の端に隠れない`,
    b,
  );
}

// ---- 欠勤・キャンセルの欄の各段階 ----
async function suddenSteps(page, w) {
  await freshPlan(page);
  await page.getByTestId('sudden-open').click();
  await sudden(page).waitFor();
  await settle(page, 300);
  const m1 = await expectShort(page, `${w}・欠勤・キャンセル 1段目`);
  await shot(page, `${w}-sudden-step1`);
  if (w === '390') await expectMobileRow(page, `${w}・1段目`);
  // 帯の上下の余白：画面の下の safe-area を足す（CSS の決まり）
  const safe = await page.evaluate(() =>
    [...document.styleSheets].some((s) => {
      try {
        return [...s.cssRules].some(
          (r) => r.cssText.includes('.drawer-foot') && r.cssText.includes('safe-area-inset-bottom'),
        );
      } catch {
        return false;
      }
    }),
  );
  check(safe, `${w}・帯の下の余白に safe-area-inset-bottom を足す`);
  void m1;

  await page.getByTestId('sudden-kind-staff').click();
  await settle(page);
  const best = await page.getByTestId('sudden-staff').evaluate((sel) => {
    let b = { value: '', count: -1 };
    for (const o of sel.options) {
      const mm = /訪問 (\d+)件/.exec(o.textContent);
      if (o.value && mm && Number(mm[1]) > b.count) b = { value: o.value, count: Number(mm[1]) };
    }
    return b;
  });
  await page.getByTestId('sudden-staff').selectOption(best.value);
  await settle(page, 300);
  await expectFits(page, `${w}・〈スタッフ〉が休む 2段目`);
  if (w === '390') await expectMobileRow(page, `${w}・2段目`);
  await shot(page, `${w}-sudden-step2`);
  await page.getByTestId('sudden-next').click();
  await settle(page, 500);
  await expectFits(page, `${w}・〈スタッフ〉が休む 3段目`);
  if (w === '390') await expectMobileRow(page, `${w}・3段目（ボタンが3つ以上）`);
  await shot(page, `${w}-sudden-step3`);
  // フォーカス：段階の見出しへ（focusKey）。Tab は欄の中で回る
  const inStep = await page.evaluate(() => !!document.activeElement?.closest('.drawer'));
  check(inStep, `${w}・段階が進んでもフォーカスは欄の中`);
  await page.getByTestId('sudden-reassign').click();
  await page.getByTestId('sudden-done').waitFor({ timeout: 15000 });
  await settle(page, 500);
  await expectFits(page, `${w}・4段目（済んだこと）`);
  if (w === '390') await expectMobileRow(page, `${w}・4段目`);
  await shot(page, `${w}-sudden-step4`);
  // 差の欄の「連絡の一覧」（日の差の欄から開く右の欄）
  await page.getByTestId('sudden-close').click();
  await sudden(page).waitFor({ state: 'detached' });
  await settle(page, 300);
  const contact = page.getByRole('button', { name: /^連絡の一覧/ }).first();
  if ((await contact.count()) > 0) {
    await contact.scrollIntoViewIfNeeded();
    await contact.click();
    await page.getByTestId('contact-sheet').waitFor();
    await settle(page, 300);
    await expectFits(page, `${w}・差の欄の「連絡の一覧」`);
    if (w === '390') await expectMobileRow(page, `${w}・連絡の一覧（ボタン3つ）`);
    await shot(page, `${w}-contact`);
    // 印刷では帯を出さない（今の決まりのまま）
    await page.emulateMedia({ media: 'print' });
    check(!(await page.locator('.drawer-foot').isVisible()), `${w}・印刷：連絡の一覧の帯を出さない`);
    check(await page.getByTestId('contact-sheet').isVisible(), `${w}・印刷：連絡の一覧は出す`);
    await page.emulateMedia({ media: 'screen' });
    await page.keyboard.press('Escape');
    await drawer(page).waitFor({ state: 'detached' });
  } else {
    check(false, `${w}・差の欄に「連絡の一覧」がある`);
  }
  // 当日キャンセルの3段目
  await page.getByTestId('sudden-open').click();
  await sudden(page).waitFor();
  await page.getByTestId('sudden-kind-client').click();
  await settle(page);
  const first = await page
    .getByTestId('sudden-visit')
    .evaluate((sel) => [...sel.options].find((o) => o.value)?.value ?? '');
  await page.getByTestId('sudden-visit').selectOption(first);
  await settle(page);
  await expectFits(page, `${w}・キャンセル 2段目`);
  await page.getByTestId('sudden-next').click();
  await settle(page, 300);
  await expectFits(page, `${w}・キャンセル 3段目`);
  if (w === '390') await expectMobileRow(page, `${w}・キャンセル 3段目（ボタン2つ）`);
  await shot(page, `${w}-cancel-step3`);
  // Esc で閉じて入口へ戻る
  await page.keyboard.press('Escape');
  await sudden(page).waitFor({ state: 'detached' });
  await settle(page, 200);
  check(
    (await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === 'sudden-open',
    `${w}・Esc で閉じてフォーカスが入口に戻る`,
  );
}

/** 欄の位置と知らせ（トースト）の位置 */
const toastBox = (page) =>
  page.evaluate(() => {
    const t = document.querySelector('.toast');
    const h = document.querySelector('.drawer-head');
    const d = document.querySelector('.drawer');
    if (!t || !h || !d) return null;
    const tb = t.getBoundingClientRect();
    return {
      top: Math.round(tb.top),
      bottom: Math.round(tb.bottom),
      left: Math.round(tb.left),
      right: Math.round(tb.right),
      headBottom: Math.round(h.getBoundingClientRect().bottom),
      drawerLeft: Math.round(d.getBoundingClientRect().left),
      drawerTop: Math.round(d.getBoundingClientRect().top),
      pointer: getComputedStyle(t).pointerEvents,
    };
  });

/**
 * 欄を開いたまま知らせを出す（〈スタッフ〉の編集で保存 →「保存しました」→ すぐ「編集する」）：
 * 390px は見出しに重ならず、重なった下の入力欄を押せる。1400px は欄をまたがない（PR #46 のレビュー）
 */
async function toastWhileOpen(page, w) {
  await drawer(page).getByTestId('view-edit').click();
  await settle(page, 200);
  await page.locator('.drawer-foot .btn-primary').click();
  await page.locator('.toast').waitFor({ timeout: 3000 });
  await drawer(page).getByTestId('view-edit').click();
  await settle(page, 250);
  const t = await toastBox(page);
  check(!!t, `${w}・欄を開いたまま知らせが出る`);
  if (!t) return;
  check(t.pointer === 'none', `${w}・知らせは押せない（下を押せる）`, t.pointer);
  if (w === '390') {
    check(t.top >= t.headBottom, `${w}・知らせが欄の見出しに重ならない`, t);
    // 知らせの真ん中を押すと、下の入力欄（またはその label）に届く
    await drawer(page)
      .locator('.drawer-body')
      .evaluate((el) => {
        el.scrollTop = 0;
      });
    const x = (t.left + t.right) / 2;
    const y = (t.top + t.bottom) / 2;
    const under = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return { inDrawer: !!el?.closest('.drawer-content'), tag: el?.tagName ?? '' };
      },
      { x, y },
    );
    await page.mouse.click(x, y);
    await settle(page, 150);
    const focus = await page.evaluate(() => ({
      tag: document.activeElement?.tagName ?? '',
      inDrawer: !!document.activeElement?.closest('.drawer-content'),
    }));
    check(
      under.inDrawer && focus.inDrawer && ['INPUT', 'SELECT', 'TEXTAREA'].includes(focus.tag),
      `${w}・知らせが出ていても下の入力欄を押せる`,
      { under, focus },
    );
    await shot(page, `${w}-toast`);
  } else {
    check(t.right <= t.drawerLeft, `${w}・知らせが欄をまたがない（欄の外に出る）`, t);
    check(t.left >= 0, `${w}・知らせが画面の左に収まる`, t);
    await shot(page, `${w}-toast`);
  }
  await page.locator('.toast').waitFor({ state: 'detached', timeout: 4000 });
  await page.getByTestId('edit-cancel').click();
  await settle(page, 200);
}

// ---- 〈スタッフ〉の閲覧（帯なし）と編集（長い） ----
async function staffPanel(page, w) {
  await open(page, '/staff?id=s1', '.drawer');
  await page.getByTestId('person-view').waitFor();
  const v = await metrics(page);
  check(v && v.foot === null, `${w}・〈スタッフ〉の閲覧：帯が無い`);
  check(
    v && v.body.bottom === v.drawer.bottom,
    `${w}・〈スタッフ〉の閲覧：巻く領域が欄の下まで`,
    v && { body: v.body.bottom, drawer: v.drawer.bottom },
  );
  await shot(page, `${w}-staff-view`);
  await drawer(page).getByTestId('view-edit').click();
  await settle(page, 400);
  check(
    await page.evaluate(() => document.activeElement?.tagName === 'INPUT'),
    `${w}・〈スタッフ〉の編集：最初の入力欄にフォーカス`,
  );
  await expectLong(page, `${w}・〈スタッフ〉の編集`);
  if (w === '390') await expectMobileRow(page, `${w}・〈スタッフ〉の編集（ボタン2つ）`);
  await shot(page, `${w}-staff-edit`);
  // 帯の下に隠れた入力欄へ Tab で入ると、帯の上まで巻く（scroll-padding-bottom）
  const hidden = await page.evaluate(() => {
    const body = document.querySelector('.drawer-body');
    const foot = document.querySelector('.drawer-foot');
    body.scrollTop = 0;
    const ft = foot.getBoundingClientRect().top;
    const list = [...body.querySelectorAll('input:not([type="hidden"]), select, textarea')].filter(
      (el) => el.offsetParent !== null && !foot.contains(el),
    );
    // 帯より下にある入力欄を1つ選び、その上端がちょうど帯の裏に来るまで巻く
    const i = list.findIndex((el, k) => k > 0 && el.getBoundingClientRect().top > ft);
    if (i > 0) body.scrollTop += list[i].getBoundingClientRect().top - (ft + 4);
    if (i <= 0) return null;
    list[i - 1].focus({ preventScroll: true });
    list[i].setAttribute('data-e2e-target', '1');
    const t = list[i].getBoundingClientRect().top;
    const f = foot.getBoundingClientRect();
    return { i, covered: t >= f.top && t < f.bottom };
  });
  if (hidden !== null) {
    check(hidden.covered, `${w}・確かめの前提：目当ての入力欄が帯の裏にある`, hidden);
    // 1つ前の入力欄から Tab（間にボタンがあれば、目当ての入力欄に着くまで Tab を続ける）
    for (let k = 0; k < 60; k++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(() => document.activeElement?.hasAttribute('data-e2e-target'))) break;
    }
    await settle(page, 300);
    const r = await page.evaluate(() => {
      const el = document.activeElement;
      const foot = document.querySelector('.drawer-foot');
      return {
        target: el?.hasAttribute('data-e2e-target') ?? false,
        bottom: Math.round(el.getBoundingClientRect().bottom),
        footTop: Math.round(foot.getBoundingClientRect().top),
      };
    });
    check(r.target && r.bottom <= r.footTop, `${w}・Tab で入った入力欄が帯に隠れない`, r);
  } else {
    check(false, `${w}・帯の下に隠れた入力欄がある（確かめの前提）`);
  }
  // Tab は欄の中で回る：帯の最後のボタンから Tab で欄の先頭へ
  await page.locator('.drawer-foot .btn').last().focus();
  await page.keyboard.press('Tab');
  check(
    await page.evaluate(() => !!document.activeElement?.closest('.drawer-head')),
    `${w}・帯の最後のボタンから Tab で欄の先頭（見出しの × など）へ回る`,
  );
  await page.keyboard.press('Shift+Tab');
  check(
    await page.evaluate(() => document.activeElement === [...document.querySelectorAll('.drawer-foot .btn')].at(-1)),
    `${w}・Shift+Tab で帯の最後のボタンへ戻る`,
  );
  // 裏の画面は巻かない（スクロールのロック）
  check(
    (await page.evaluate(() => getComputedStyle(document.documentElement).overflow)) === 'hidden',
    `${w}・欄が開いている間は裏の画面を巻かない`,
  );
  await page.getByTestId('edit-cancel').click();
  await settle(page, 300);
  check((await metrics(page))?.foot === null, `${w}・取り消しで閲覧に戻ると帯が消える`);
  await toastWhileOpen(page, w);
  await page.keyboard.press('Escape');
  await drawer(page).waitFor({ state: 'detached' });
}

// ---- 月の「まとめて作る」 ----
async function monthBatch(page, w) {
  await page.goto(`${BASE}#/home`);
  await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
  await open(page, `/month?ym=${YM}&do=batch`, '.drawer');
  await page.getByTestId('batch-preset').waitFor();
  if (w === '1400') await expectShort(page, `${w}・月の「まとめて作る」`);
  else await expectFits(page, `${w}・月の「まとめて作る」`);
  if (w === '390') await expectMobileRow(page, `${w}・まとめて作る（ボタン2つ）`);
  await shot(page, `${w}-month-batch`);
  await page.keyboard.press('Escape');
  await drawer(page).waitFor({ state: 'detached' });
}

// ---- キーボード（スマホ）：visualViewport が縮んだら欄を見えている所に合わせ、帯を見える所に置く ----
async function keyboard(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await skipTour(ctx);
  await ctx.addInitScript(() => {
    // 本物のキーボードは出せないので、visualViewport を差し替えて縮める
    const fake = new EventTarget();
    let h = window.innerHeight;
    let top = 0;
    for (const [k, get] of Object.entries({
      height: () => h,
      width: () => window.innerWidth,
      offsetTop: () => top,
      offsetLeft: () => 0,
      pageTop: () => top,
      pageLeft: () => 0,
      scale: () => 1,
    }))
      Object.defineProperty(fake, k, { get });
    Object.defineProperty(window, 'visualViewport', { get: () => fake, configurable: true });
    window.__setViewport = (nh, nt = 0) => {
      h = nh;
      top = nt;
      fake.dispatchEvent(new Event('resize'));
    };
  });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await open(page, '/staff?id=s1', '.drawer');
  await drawer(page).getByTestId('view-edit').click();
  await settle(page, 300);
  await page.evaluate(() => window.__setViewport(500, 0));
  await settle(page, 300);
  let m = await metrics(page);
  check(
    m && Math.abs(m.drawer.bottom - 500) <= 1 && m.foot && m.foot.bottom <= 500 && m.btns.every((b) => b.bottom <= 500),
    '390・キーボードが出たら（見えている高さ 500px）帯がその上に出る',
    m && { drawer: m.drawer, foot: m.foot },
  );
  await shot(page, '390-keyboard');
  // iOS のように見えている所が下へずれたとき
  await page.evaluate(() => window.__setViewport(500, 120));
  await settle(page, 300);
  m = await metrics(page);
  check(
    m && Math.abs(m.drawer.top - 120) <= 1 && Math.abs(m.drawer.bottom - 620) <= 1,
    '390・見えている所がずれたら欄もそこへ合わせる',
    m?.drawer,
  );
  // 知らせも見えている所に合わせる（保存 →「保存しました」。欄は閲覧に戻る）
  await page.locator('.drawer-foot .btn-primary').click();
  await page.locator('.toast').waitFor({ timeout: 3000 });
  await settle(page, 250);
  const t = await toastBox(page);
  check(
    !!t && Math.abs(t.drawerTop - 120) <= 1 && t.top >= t.headBottom && t.top >= 120,
    '390・見えている所がずれたら知らせも欄の見出しの下に合わせる',
    t,
  );
  await page.locator('.toast').waitFor({ state: 'detached', timeout: 4000 });
  await drawer(page).getByTestId('view-edit').click();
  await settle(page, 200);
  await page.evaluate(() => window.__setViewport(window.innerHeight, 0));
  await settle(page, 300);
  m = await metrics(page);
  check(
    m && m.drawer.top === 0 && m.drawer.bottom === m.innerHeight,
    '390・キーボードが閉じたら欄は画面の高さに戻る',
    m?.drawer,
  );
  check(errors.length === 0, '390・キーボード：ページのエラーが無い', errors);
  await ctx.close();
}

let b = null;
/** 幅ごとに1つの文脈を開き、3つの欄を順に確かめる */
const widthStep = (w, vp) => async () => {
  console.log(`---- ${w}px ----`);
  const ctx = await b.newContext({ viewport: vp, ...(w === '390' ? { hasTouch: true, isMobile: true } : {}) });
  await skipTour(ctx);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  await answerConfirms(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => {
    errors.push(`ブラウザの確認：${d.message()}`);
    void d.dismiss();
  });
  for (const [name, fn] of [
    ['sudden', suddenSteps],
    ['staff', staffPanel],
    ['month', monthBatch],
  ]) {
    await guard(() => fn(page, w), {
      label: `${w}・${name} が最後まで動く`,
      info: firstLine,
      page: () => page,
      shot: `${w}-${name}`,
    })();
  }
  check(errors.length === 0, `${w}・ページのエラー・ブラウザの確認が無い`, errors);
  await ctx.close();
};
const steps = [
  [
    '準備',
    async () => {
      b = await launch();
    },
  ],
  ['1400px', widthStep('1400', { width: 1400, height: 1000 })],
  ['390px', widthStep('390', { width: 390, height: 844 })],
  ['keyboard', guard(() => keyboard(b), { label: 'キーボードの確かめが最後まで動く', info: firstLine })],
];

module.exports = { steps };
if (require.main === module) runSteps(steps);
