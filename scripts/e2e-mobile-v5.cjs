// 見直しの5段目（ADR-0055。PRD D333〜D338）を本物のブラウザで確かめる：
// 390×844：日の予定は日ごとのリスト（最初の画面に訪問が見える・操作の行が1段・行に時刻・〈利用者さん〉・担当）、
// 上の帯の日付送りとスワイプで日を送る、行を押すと下から出る欄（大きな4つのボタン：担当を替える・取り消す・道順・日の予定で見る。
// 日時の変更・範囲は出ない。担当を替えて保存・取り消すと書き、元に戻すで戻る）、複数選択（長押し・「選ぶ」。帯は下から出る置き場所で
// 時刻をずらすは出ない・まとめて取り消す）、下のタブ（ホーム・予定・欠勤・探す・メニュー。「探す」でパレット・上の帯に「探す」は無い・
// 空き状況はパレットから）。
// 1400×1000：日の予定の時間軸の帯のキーボード（↑↓ 15分・Shift+→ 隣の担当の列・→ 次の日（その日へ移る）・Enter で欄・Esc で帯へ・
// Delete で取り消し（確認）・どれも全体の元に戻すの1手で手の名前・Ctrl+Z で全部戻る）、繰り返しの回の範囲の小さな帯（これ以降も）、
// 週の時間軸の帯の ↓、パレットで担当の名前＋日付・「担当なし」で訪問を引く、担当を組むで出した範囲の提案が画面を移っても残る。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-mobile-v5.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { BASE, OUT_DIR, TODAY, STORAGE_KEY, check, settle, stored, until, runSteps } = require('./lib/env.cjs');
const { sharedPage, openPage } = require('./lib/steps.cjs');

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const shot = (page, name) => page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
const visitsKey = (d) => JSON.stringify(d?.visits ?? null);
const visitOf = (d, id) => d?.visits?.find((v) => v.id === id) ?? null;
/** YYYY-MM-DD に n 日足す */
const addDays = (d, n) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const toMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** 保存（少し遅れて書く）が条件を満たすまで待つ */
async function waitStored(page, pred, timeout = 8000) {
  return until(async () => pred(await stored(page)), timeout, 100).catch(() => false);
}
/** 初期データで日の予定（今日）を開く */
async function freshPlan(page, hash = '/plan') {
  await page.goto(`${BASE}#/home`);
  await page.locator('h1').waitFor();
  await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
  await page.reload();
  await page.locator('h1').waitFor();
  await page.goto(`${BASE}#${hash}`);
  await page.getByTestId('schedule-toolbar').waitFor({ timeout: 60000 });
  await settle(page, 400);
}
const rows = (page) => page.getByTestId('day-row');
const panel = (page) => page.getByTestId('visit-panel');
const dateValue = (page) => page.locator('.date-switch select').inputValue();

// ---- 390px：日ごとのリスト ----
async function dayList(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshPlan(page);
  await page.getByTestId('day-list').waitFor({ timeout: 30000 });
  const n = await rows(page).count();
  check(n > 0, '390px：日の予定は日ごとのリスト（行がある）', n);
  check((await page.locator('.tl-band, .route-item').count()) === 0, '390px：時間軸・順番のカードは既定で出さない');
  const first = await rows(page).first().boundingBox();
  const tabs = await page.getByTestId('bottom-tabs').boundingBox();
  check(first && tabs && first.y + first.height <= tabs.y, '390px：最初の画面（下のタブより上）に訪問の行が見える', {
    first,
    tabs,
  });
  const visible = await rows(page).evaluateAll(
    (els, bottom) => els.filter((e) => e.getBoundingClientRect().bottom <= bottom).length,
    tabs?.y ?? 844,
  );
  check(visible >= 3, '390px：最初の画面に訪問が3件以上見える', visible);
  // 操作の行が1段（子の上端がそろい、高さが1段分）
  const bar = await page.getByTestId('schedule-toolbar').evaluate((el) => {
    const kids = [...el.children].filter((c) => getComputedStyle(c).display !== 'none');
    const tops = kids.map((c) => Math.round(c.getBoundingClientRect().top));
    return { h: el.getBoundingClientRect().height, spread: Math.max(...tops) - Math.min(...tops), n: kids.length };
  });
  check(bar.h <= 56 && bar.spread <= 4, '390px：操作の行は1段', bar);
  check(
    (await page.getByTestId('sudden-open').getAttribute('class'))?.includes('btn') &&
      /欠勤・キャンセルを登録/.test((await page.getByTestId('sudden-open').textContent()) ?? ''),
    '390px：操作の行のアイコンのボタンにも名前（読み上げ）が残る',
  );
  check((await page.locator('.plan-view-toggle').count()) === 0, '390px：表示の切り替えのボタンは操作の行に無い');
  await page.getByTestId('plan-more').click();
  check(
    (await page.getByTestId('plan-view-day').count()) === 1 &&
      (await page.getByTestId('plan-view-order').count()) === 1,
    '390px：表示の切り替えは「その他 ▾」の「表示」',
  );
  await page.keyboard.press('Escape');
  const row = rows(page).first();
  const text = await row.innerText();
  check(/\d{1,2}:\d{2}〜\d{1,2}:\d{2}/.test(text), '行：時刻（M:MM〜M:MM）', text);
  const label = (await row.getAttribute('aria-label')) ?? '';
  check(/さん・(担当 |担当なし)/.test(label), '行の読み上げ：〈利用者さん〉と担当', label);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  check(wide <= 390, '390px：横にはみ出さない', wide);
  await shot(page, 'day-list-390');
}

// ---- 390px：日付を送る（上の帯・スワイプ） ----
async function dateSend(page) {
  const d0 = await dateValue(page);
  const label0 = await page.getByTestId('day-list').getAttribute('aria-label');
  await page.getByRole('button', { name: '次の日' }).click();
  await until(async () => (await dateValue(page)) !== d0, 5000);
  const d1 = await dateValue(page);
  check(d1 > d0, '上の帯の「次の日」で日を送る', { d0, d1 });
  check((await page.getByTestId('day-list').getAttribute('aria-label')) !== label0, '日を送るとリストもその日になる');
  // スワイプ（右から左＝次の日、左から右＝前の日）
  const box = await page.getByTestId('day-list').boundingBox();
  const y = box.y + 30;
  // タッチのスワイプ（pointerType="touch" の pointer の出来事。スワイプはタッチ・ペンだけで、マウスでなぞっても日を送らない）
  const swipe = (from, to) =>
    page.evaluate(
      ([from, to, y]) => {
        const el = document.elementFromPoint(from, y);
        const fire = (type, x) =>
          el.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              pointerType: 'touch',
              isPrimary: true,
              button: 0,
              clientX: x,
              clientY: y,
            }),
          );
        fire('pointerdown', from);
        fire('pointermove', (from + to) / 2);
        fire('pointermove', to);
        fire('pointerup', to);
      },
      [from, to, y],
    );
  // マウスでなぞっても日を送らない
  await page.mouse.move(box.x + box.width - 30, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 30, y, { steps: 6 });
  await page.mouse.up();
  await settle(page, 300);
  check(
    (await dateValue(page)) === d1 && (await panel(page).count()) === 0,
    'マウスでなぞっても日を送らない・欄も開かない',
  );
  await swipe(box.x + box.width - 30, box.x + 30);
  await until(async () => (await dateValue(page)) !== d1, 5000).catch(() => {});
  const d2 = await dateValue(page);
  check(d2 > d1, 'リストを左へスワイプすると次の日', { d1, d2 });
  await swipe(box.x + 30, box.x + box.width - 30);
  await until(async () => (await dateValue(page)) !== d2, 5000).catch(() => {});
  check((await dateValue(page)) === d1, 'リストを右へスワイプすると前の日', await dateValue(page));
  check((await panel(page).count()) === 0, 'スワイプでは訪問の欄を開かない');
  // 今日へ戻す
  await page.locator('.date-switch select').selectOption(TODAY);
  await settle(page, 300);
}

// ---- 390px：下から出る欄 ----
async function sheet(page) {
  const row = rows(page).filter({ hasNotText: '担当なし' }).first();
  const vid = await row.getAttribute('data-visit');
  await row.click();
  await panel(page).waitFor();
  await settle(page, 300);
  const box = await page.locator('.drawer.is-sheet').boundingBox();
  check(
    box && Math.abs(box.y + box.height - 844) <= 2 && box.y > 100,
    '390px：訪問の欄は下から出る（下に寄り、上は空く）',
    box,
  );
  check((await panel(page).getAttribute('data-visit')) === vid, '押した行の訪問の欄', vid);
  const big = await page
    .getByTestId('vp-big')
    .locator('button, a')
    .evaluateAll((els) => els.map((e) => e.textContent.trim()));
  check(
    JSON.stringify(big) === JSON.stringify(['担当を替える', '取り消す', '道順', '日の予定で見る']),
    '大きな4つのボタン（担当を替える・取り消す・道順・日の予定で見る）',
    big,
  );
  const heights = await page
    .getByTestId('vp-big')
    .locator('button, a')
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  check(
    heights.every((h) => h >= 56),
    '4つのボタンは指で押しやすい高さ',
    heights,
  );
  check(
    (await page.getByTestId('vp-time').count()) === 0 &&
      (await page.getByTestId('vp-scope').count()) === 0 &&
      (await page.getByTestId('vp-date').count()) === 0,
    '390px：日時の変更・範囲は出ない',
  );
  check((await page.getByTestId('vp-save').count()) === 0, '担当を替えるを押すまで保存は出ない（閉じるだけ）');
  const route = page.getByTestId('vp-big-route');
  const href = (await route.getAttribute('href')) ?? '';
  check(
    /^https:\/\/www\.google\.com\/maps\/dir\//.test(href) && (await route.getAttribute('target')) === '_blank',
    '道順は Google マップ（新しいタブ）',
    href,
  );
  await shot(page, 'sheet-390');
  // 担当を替える
  await page.getByTestId('vp-big-staff').click();
  await page.getByTestId('vp-staff').waitFor();
  check(
    (await page.getByTestId('vp-big-staff').getAttribute('aria-expanded')) === 'true',
    '担当を替える：aria-expanded',
  );
  const choice = page.locator('[data-testid="vp-staff-choice"]:not(.is-off)').first();
  const to = await choice.getAttribute('data-staff');
  await choice.locator('input').check();
  await shot(page, 'sheet-staff-390');
  const before = await stored(page);
  await page.getByTestId('vp-save').click();
  const ok = await waitStored(page, (d) => {
    const v = visitOf(d, vid);
    return !!v && v.staffId === to && v.pinned;
  });
  check(ok, '下から出る欄で担当を替えて保存（担当が変わりピン）', { vid, to });
  await panel(page).waitFor({ state: 'detached' });
  // 元に戻す（操作の行）
  await page.getByTestId('undo-btn').click();
  const back = await waitStored(page, (d) => visitsKey(d) === visitsKey(before));
  check(back, '操作の行の「元に戻す」で担当が戻る');
  // 取り消す
  await page.locator(`[data-testid="day-row"][data-visit="${vid}"]`).click();
  await panel(page).waitFor();
  await page.getByTestId('vp-big-cancel').click();
  await page.getByTestId('vp-cancel-area').waitFor();
  await page.getByTestId('vp-cancel').click();
  const cancelled = await waitStored(page, (d) => !!visitOf(d, vid)?.cancelled);
  check(cancelled, '取り消すで訪問を取り消す');
  check(
    (await page.getByTestId('vp-big-cancel').innerText()).includes('取り消しをやめる'),
    '取り消した回は「取り消しをやめる」',
  );
  check(
    (await page.getByTestId('vp-uncancel').count()) === 0,
    '取り消した回の「取り消しをやめる」は1つだけ（大きなボタン）',
  );
  await page.getByTestId('vp-big-cancel').click();
  const un = await waitStored(page, (d) => !visitOf(d, vid)?.cancelled);
  check(un, '取り消しをやめる');
  // 日の予定で見る（今その日の日の予定なら閉じる）
  await page.getByTestId('vp-big-day').click();
  await panel(page).waitFor({ state: 'detached' });
  check(true, '「日の予定で見る」：その日の日の予定にいるので欄を閉じる');
  const f = await page.evaluate(() => document.activeElement?.closest('.day-row')?.dataset.visit ?? null);
  check(f === vid, '閉じたあとフォーカスは押した行', f);
}

// ---- 390px：複数選択（長押し・選ぶ） ----
async function multi(page) {
  await freshPlan(page);
  const r = rows(page);
  const a = r.nth(0);
  const b = r.nth(1);
  const ida = await a.getAttribute('data-visit');
  const idb = await b.getAttribute('data-visit');
  const box = await a.boundingBox();
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await page.mouse.down();
  // 長押し（500ms）を待つ（時間そのものを見る所なので固定の待ち）
  await page.waitForTimeout(800);
  await page.mouse.up();
  await page.getByTestId('selection-bar').waitFor({ timeout: 5000 });
  check((await page.getByTestId('selection-count').innerText()) === '1件を選択', '長押しで選ぶ（1件）');
  check((await panel(page).count()) === 0, '長押しでは訪問の欄を開かない');
  check((await page.getByTestId('day-list-select').getAttribute('aria-pressed')) === 'true', '長押しで選ぶ形に入る');
  await b.click();
  await settle(page, 200);
  check((await page.getByTestId('selection-count').innerText()) === '2件を選択', '選ぶ形では押すと選ぶ（2件）');
  check((await page.getByTestId('selection-shift').count()) === 0, '390px：複数選択の帯に時刻をずらすは出ない');
  const sb = await page.getByTestId('selection-bar').boundingBox();
  const tabs = await page.getByTestId('bottom-tabs').boundingBox();
  check(
    sb && tabs && Math.abs(sb.y + sb.height - tabs.y) <= 2 && sb.x <= 1 && sb.width >= 388,
    '390px：複数選択の帯は下から出る欄と同じ置き場所（下のタブのすぐ上・全幅）',
    { sb, tabs },
  );
  check(sb && sb.height <= 140, '390px：複数選択の帯の高さ', sb?.height);
  await shot(page, 'multi-390');
  const before = await stored(page);
  await page.getByTestId('selection-cancel').click();
  await page.getByTestId('confirm-dialog').waitFor({ timeout: 5000 });
  await page.getByTestId('confirm-ok').click();
  const done = await waitStored(page, (d) => !!visitOf(d, ida)?.cancelled && !!visitOf(d, idb)?.cancelled);
  check(done, 'まとめて取り消す（確認のあと2件）');
  await page.getByTestId('undo-btn').click();
  const back = await waitStored(page, (d) => visitsKey(d) === visitsKey(before));
  check(back, '「元に戻す」で2件の取り消しが1手で戻る');
  // 「選ぶ」で入る・抜ける
  if ((await page.getByTestId('day-list-select').getAttribute('aria-pressed')) === 'true')
    await page.getByTestId('day-list-select').click();
  await settle(page, 200);
  check((await page.getByTestId('selection-bar').count()) === 0, '「選び終える」で選択を外す');
  await page.getByTestId('day-list-select').click();
  await rows(page).nth(2).click();
  await settle(page, 200);
  check(
    (await page.getByTestId('selection-count').innerText()) === '1件を選択' && (await panel(page).count()) === 0,
    '「選ぶ」のあと行を押すと選ぶ（欄は開かない）',
  );
  await page.getByTestId('selection-clear').click();
  await page.getByTestId('day-list-select').click();
}

// ---- 390px：下のタブ（探す） ----
async function tabs(page) {
  const names = await page
    .getByTestId('bottom-tabs')
    .locator('a, button')
    .evaluateAll((els) => els.map((e) => e.textContent.trim()));
  check(
    JSON.stringify(names) === JSON.stringify(['ホーム', '予定', '欠勤', '探す', 'メニュー']),
    '下のタブ：ホーム・予定・欠勤・探す・メニュー',
    names,
  );
  check(!(await page.getByTestId('cmdk-open').isVisible()), '390px：上の帯に「探す」は出さない');
  const head = await page.locator('.app-header').boundingBox();
  check(head && head.height <= 64, '390px：日の予定の上の帯は1段（名前と日付の切り替え）', head);
  await page.getByTestId('bottom-search').click();
  const input = page.getByTestId('cmdk-input');
  await input.waitFor();
  check((await page.getByTestId('bottom-search').getAttribute('aria-expanded')) === 'true', '「探す」：aria-expanded');
  await input.fill('空き状況');
  await settle(page, 300);
  const opts = await page
    .locator('[data-testid="cmdk-option"][data-kind="screen"]')
    .evaluateAll((els) => els.map((e) => e.dataset.to));
  check(opts.includes('/vacancy'), '空き状況はパレット（探す）から開ける', opts);
  await shot(page, 'palette-390');
  await page.keyboard.press('Escape');
  await input.waitFor({ state: 'detached' });
  check(
    await page.getByTestId('bottom-search').evaluate((el) => document.activeElement === el),
    'パレットを閉じるとフォーカスは「探す」',
  );
  await shot(page, 'tabs-390');
}

// ---- 1400px：時間軸の帯のキーボード ----
async function keyboard(page) {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await freshPlan(page);
  const bands = page.locator('.tl-band .tl-band-btn');
  await bands.first().waitFor({ timeout: 30000 });
  // 繰り返しの回（ID に _）で、列が2つ以上ある担当の帯
  const vid = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('.tl-col[data-staff]')];
    for (const c of cols.slice(0, -1)) {
      const b = c.querySelector('.tl-band[data-visit*="_"]');
      if (b) return b.dataset.visit;
    }
    return null;
  });
  if (!vid) {
    check(false, '動かせる繰り返しの回の帯がある');
    return;
  }
  const band = () => page.locator(`.tl-band[data-visit="${vid}"] .tl-band-btn`);
  const nextCol = await band().evaluate((el) => el.closest('.tl-col').nextElementSibling?.dataset.staff ?? null);
  // 開始の時刻（欄の日時）
  await band().focus();
  await page.keyboard.press('Enter');
  await panel(page).waitFor();
  check((await panel(page).getAttribute('data-visit')) === vid, 'Enter で訪問の詳細の欄');
  const when = await page.getByTestId('vp-when').innerText();
  const start0 = /(\d{2}:\d{2})/.exec(when)?.[1];
  await page.keyboard.press('Escape');
  await panel(page).waitFor({ state: 'detached' });
  check(await band().evaluate((el) => document.activeElement === el), 'Esc で閉じるとフォーカスは帯');
  const before = await stored(page);
  await shot(page, 'keyboard-before-1400');
  // ↓ で15分後
  await page.keyboard.press('ArrowDown');
  const down = await waitStored(page, (d) => {
    const v = visitOf(d, vid);
    return !!v && toMin(v.earliestStart) - toMin(start0) === 15;
  });
  check(down, '↓ で15分後（この回だけ）', start0);
  await settle(page, 300);
  check(await band().evaluate((el) => document.activeElement === el), '動かしたあともフォーカスは動かした帯');
  const status = await page.getByTestId('key-move-status').textContent();
  check(
    /動かしました：.+さん：.+ \d{2}:\d{2}・担当 .+さん（この回だけ）/.test(status ?? ''),
    '動いた先を読み上げる',
    status,
  );
  check(
    /訪問を15分後へ/.test((await page.getByTestId('undo-btn').getAttribute('title')) ?? ''),
    '全体の元に戻すの1手（手の名前「訪問を15分後へ」）',
  );
  check(
    (await page.getByTestId('key-move-band').count()) === 1,
    '繰り返しの回は範囲の小さな帯（これ以降も・すべての回も）',
  );
  await shot(page, 'keyboard-after-1400');
  check(/Alt\+↓ で範囲/.test(status ?? ''), '繰り返しの回は読み上げに範囲の帯への近道（Alt+↓）', status);
  await page.keyboard.press('Alt+ArrowDown');
  check(
    (await page.evaluate(() => document.activeElement?.dataset.testid)) === 'key-scope-following',
    'Alt+↓ で範囲の帯の先頭のボタンへ',
  );
  await page.keyboard.press('Escape');
  check(await band().evaluate((el) => document.activeElement === el), '帯の中の Esc で動かした訪問の帯へ戻る');
  // これ以降も：範囲つきで反映し直す（1手のまま）
  const patternsBefore = (await stored(page)).patterns.length;
  await page.getByTestId('key-scope-following').click();
  const split = await waitStored(page, (d) => d.patterns.length > patternsBefore);
  check(split, '「これ以降も」：繰り返しを分けて、これ以降の回も動かす');
  check(
    /（これ以降）/.test((await page.getByTestId('undo-btn').getAttribute('title')) ?? ''),
    '「これ以降も」の手の名前',
    await page.getByTestId('undo-btn').getAttribute('title'),
  );
  check((await page.getByTestId('key-move-band').count()) === 0, '範囲を選ぶと帯は消える');
  await page.locator('h1').click();
  await page.keyboard.press(`${MOD}+z`);
  const back1 = await waitStored(
    page,
    (d) => visitsKey(d) === visitsKey(before) && d.patterns.length === patternsBefore,
  );
  check(back1, 'Ctrl+Z 1回で「これ以降」の前（この回だけ動かす前）に戻る');
  // Shift+→ で右の、この訪問を担当できる最初の人の列（担当できない人は飛ばす）
  await band().focus();
  if (nextCol) {
    const right = await page.evaluate(
      (s) => {
        const cols = [...document.querySelectorAll('.tl-col[data-staff]')].map((c) => c.dataset.staff);
        return cols.slice(cols.indexOf(s) + 1);
      },
      await band().evaluate((el) => el.closest('.tl-col').dataset.staff),
    );
    await page.keyboard.press('Shift+ArrowRight');
    const moved = await waitStored(page, (d) => {
      const v = visitOf(d, vid);
      return !!v && right.includes(v.staffId) && v.pinned;
    });
    const why = await page.locator('.toast').filter({ hasText: '動かせません' }).count();
    check(moved || why > 0, 'Shift+→ で右の担当できる人の列（担当にしてピン。いなければ理由の知らせ）', {
      right,
      why,
    });
    if (moved) {
      await settle(page, 300);
      const to = visitOf(await stored(page), vid).staffId;
      check(
        await band().evaluate(
          (el, s) => document.activeElement === el && el.closest('.tl-col').dataset.staff === s,
          to,
        ),
        'Shift+→ のあともフォーカスは帯（移った列）',
      );
      check(
        /担当を.+さんへ/.test((await page.getByTestId('undo-btn').getAttribute('title')) ?? ''),
        '手の名前「担当を〇〇さんへ」',
      );
    }
  }
  // → で次の日（その日へ移る）
  await band().focus();
  await page.keyboard.press('ArrowRight');
  const tomorrow = addDays(TODAY, 1);
  const right = await waitStored(page, (d) => visitOf(d, vid)?.date === tomorrow);
  check(right, '→ で次の日（この回だけ）');
  await until(async () => (await dateValue(page)) === tomorrow, 5000).catch(() => {});
  check((await dateValue(page)) === tomorrow, '→ で日の予定もその日へ移る', await dateValue(page));
  await until(
    async () =>
      band()
        .evaluate((el) => document.activeElement === el)
        .catch(() => false),
    5000,
  ).catch(() => {});
  check(
    await band()
      .evaluate((el) => document.activeElement === el)
      .catch(() => false),
    '次の日へ移ってもフォーカスは帯',
  );
  // Delete で取り消し（確認）
  await page.keyboard.press('Delete');
  await page.getByTestId('confirm-dialog').waitFor({ timeout: 5000 });
  check(/取り消しますか/.test(await page.getByTestId('confirm-title').innerText()), 'Delete で取り消しの確認');
  await page.getByTestId('confirm-ok').click();
  const del = await waitStored(page, (d) => !!visitOf(d, vid)?.cancelled);
  check(del, '確認のあと取り消す');
  await settle(page, 300);
  check(
    (await page.evaluate(() => document.activeElement?.dataset.testid)) === 'undo-btn',
    '取り消したらフォーカスは「元に戻す」',
  );
  // Ctrl+Z で全部戻る
  for (let i = 0; i < 4; i++) {
    if ((await page.getByTestId('undo-btn').getAttribute('aria-disabled')) === 'true') break;
    await page.keyboard.press(`${MOD}+z`);
    await settle(page, 200);
  }
  const all = await waitStored(page, (d) => visitsKey(d) === visitsKey(before));
  check(all, 'Ctrl+Z で キーの手（↓・Shift+→・→・Delete）が全部戻る');
  // 週の時間軸の帯の ↓
  await page.goto(`${BASE}#/week?view=timeline`);
  const wb = page.locator('[data-testid="week-band"]:not(.is-leave)');
  await wb.first().waitFor({ timeout: 30000 });
  const wid = await page.evaluate((today) => {
    const cols = [...document.querySelectorAll('[data-testid="week-col"]')].filter((c) => c.dataset.date >= today);
    for (const c of cols) {
      const b = c.querySelector('[data-testid="week-band"]:not(.is-leave)');
      if (b) return b.dataset.visit;
    }
    return null;
  }, TODAY);
  const w = page.locator(`[data-testid="week-band"][data-visit="${wid}"]`);
  await w.focus();
  const wBefore = await stored(page);
  await page.keyboard.press('ArrowDown');
  const wDown = await waitStored(page, (d) => visitsKey(d) !== visitsKey(wBefore));
  check(wDown, '週の時間軸の帯でも ↓ で動く');
  await settle(page, 300);
  check(await w.evaluate((el) => document.activeElement === el).catch(() => false), '週：動かしたあともフォーカスは帯');
  await page.keyboard.press(`${MOD}+z`);
  check(await waitStored(page, (d) => visitsKey(d) === visitsKey(wBefore)), '週：Ctrl+Z で戻る');
}

// ---- 1400px：範囲を選び直す帯で、確定（伝えた）した日も変わるなら確かめる ----
async function rescopeConfirm(page) {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await freshPlan(page);
  // 来週の同じ曜日を確定（伝えた）にする
  const next = addDays(TODAY, 7);
  await page.locator('.date-switch select').selectOption(next);
  await page.getByTestId('adopt').waitFor({ timeout: 30000 });
  await page.getByTestId('adopt').click();
  // 要対応があるときだけ確認が出る
  if (
    await page
      .getByTestId('confirm-dialog')
      .waitFor({ timeout: 3000 })
      .then(() => true)
      .catch(() => false)
  )
    await page.getByTestId('confirm-ok').click();
  const told = await waitStored(page, (d) => !!d.snapshots?.[next]);
  if (!told) return check(false, '来週の同じ曜日を確定（確定の確かめの前提）');
  await page.locator('.date-switch select').selectOption(TODAY);
  await page.locator('.tl-band .tl-band-btn').first().waitFor({ timeout: 30000 });
  await settle(page, 300);
  const vid = await page.evaluate(() => document.querySelector('.tl-band[data-visit*="_"]')?.dataset.visit ?? null);
  if (!vid) return check(false, '繰り返しの回の帯がある（確定の確かめ）');
  await page.locator(`.tl-band[data-visit="${vid}"] .tl-band-btn`).focus();
  await page.keyboard.press('ArrowDown');
  const shown = await page
    .getByTestId('key-move-band')
    .waitFor({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!shown)
    return check(false, '↓ で範囲の帯が出る（確定の確かめの前提）', {
      vid,
      status: await page.getByTestId('key-move-status').textContent(),
      toast: await page.locator('.toast').allInnerTexts(),
    });
  const p0 = (await stored(page)).patterns.length;
  await page.getByTestId('key-scope-following').click();
  await page.getByTestId('confirm-dialog').waitFor({ timeout: 5000 });
  check(
    /確定した日の訪問も変えますか/.test(await page.getByTestId('confirm-title').innerText()),
    '「これ以降も」：確定した日も変わるなら確かめる（欄・週のドラッグと同じ文）',
  );
  await page.getByTestId('confirm-cancel').click();
  await settle(page, 300);
  check(
    (await stored(page)).patterns.length === p0 && (await page.getByTestId('key-move-band').count()) === 1,
    '確かめで取り消すと範囲を変えない（この回だけのまま・帯は残る）',
  );
  await page.getByTestId('key-scope-following').click();
  await page.getByTestId('confirm-dialog').waitFor({ timeout: 5000 });
  await page.getByTestId('confirm-ok').click();
  check(await waitStored(page, (d) => d.patterns.length > p0), '確かめで「変える」を押すと、これ以降も動かす');
}

// ---- 390px：道順のリンクを切ると道順のボタンを出さない・外を押すと閉じる ----
async function mapsOff(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshPlan(page);
  await page.evaluate((k) => {
    const d = JSON.parse(localStorage.getItem(k));
    d.org.features = { ...d.org.features, mapsLink: false };
    localStorage.setItem(k, JSON.stringify(d));
  }, STORAGE_KEY);
  await page.reload();
  await page.getByTestId('day-list').waitFor({ timeout: 60000 });
  await rows(page).first().click();
  await panel(page).waitFor();
  const big = await page
    .getByTestId('vp-big')
    .locator('button, a')
    .evaluateAll((els) => els.map((e) => e.textContent.trim()));
  check(
    JSON.stringify(big) === JSON.stringify(['担当を替える', '取り消す', '日の予定で見る']) &&
      (await page.getByTestId('vp-big-route').count()) === 0,
    '道順のリンクを切ると「道順」のボタンを出さない（3つに詰める）',
    big,
  );
  // 下から出る欄の外（上の幕）を押すと閉じる
  await page.mouse.click(195, 20);
  await panel(page).waitFor({ state: 'detached', timeout: 5000 });
  check(true, '下から出る欄は外を押すと閉じる');
}

// ---- 1400px：パレットで担当の名前・担当なし ----
async function palette(page) {
  await freshPlan(page);
  // 1件を担当なしにする（欄の「担当なし」）
  const b = page.locator('.tl-band .tl-band-btn').first();
  const vid = await b.evaluate((el) => el.closest('.tl-band').dataset.visit);
  const staffId = await b.evaluate((el) => el.closest('.tl-col').dataset.staff);
  const d0 = await stored(page);
  const staffName = d0.staff.find((s) => s.id === staffId)?.name ?? '';
  const surname = staffName.split(/[\s　]/)[0];
  // 担当の名前＋今日
  await page.keyboard.press(`${MOD}+k`);
  const input = page.getByTestId('cmdk-input');
  await input.waitFor();
  await input.fill(`${surname} きょう`);
  await settle(page, 300);
  const opts = page.locator('[data-testid="cmdk-option"][data-kind="visit"]');
  const hints = await opts.locator('.cmdk-option-hint').allInnerTexts();
  check(
    hints.length > 0 && hints.every((h) => h === staffName),
    `「${surname} きょう」で${staffName}さんが担当の今日の回`,
    hints,
  );
  check(
    (await opts.evaluateAll((els) => els.map((e) => e.dataset.visit))).includes(vid),
    '担当の名前で引いた回に帯の訪問がある',
  );
  await shot(page, 'palette-staff-1400');
  await page.keyboard.press('Escape');
  await b.focus();
  await page.keyboard.press('Enter');
  await panel(page).waitFor();
  await page.getByTestId('vp-staff-none').check();
  await page.getByTestId('vp-save').click();
  await waitStored(page, (d) => {
    const v = visitOf(d, vid);
    return !!v && v.staffId === null;
  });
  await panel(page).waitFor({ state: 'detached' });
  await page.keyboard.press(`${MOD}+k`);
  await input.waitFor();
  await input.fill('担当なし');
  await settle(page, 300);
  const ids = await opts.evaluateAll((els) => els.map((e) => e.dataset.visit));
  const hints2 = await opts.locator('.cmdk-option-hint').allInnerTexts();
  check(
    ids.includes(vid) && hints2.every((h) => h === '担当なし'),
    '「担当なし」で担当の無い回（さっき外した回を含む）',
    { ids, hints2 },
  );
  await input.fill('ようたいおう きょう');
  await settle(page, 400);
  const care = await opts.evaluateAll((els) => els.map((e) => e.dataset.visit));
  check(care.includes(vid), '「要対応」で要対応の回（担当なし）', care);
  await shot(page, 'palette-unassigned-1400');
  // 選ぶと画面を移らずに欄
  await page.locator(`[data-testid="cmdk-option"][data-visit="${vid}"]`).click();
  await panel(page).waitFor();
  check((await panel(page).getAttribute('data-visit')) === vid, 'パレットで選ぶと訪問の欄');
  await page.keyboard.press('Escape');
}

// ---- 1400px：範囲の提案は画面を移っても残る ----
async function keepRange(page) {
  await freshPlan(page, '/week');
  // 範囲の提案は担当を組むの画面で出す（ADR-0063）
  await page.goto(`${BASE}#/arrange?date=${TODAY}`);
  await page.getByTestId('arrange-mode-all').check();
  await page.getByTestId('arrange-start').click();
  const band = page.locator('[data-testid="proposal-band"][data-kind="range"]');
  await band.waitFor({ timeout: 120000 });
  await page.locator('.side-nav [data-testid="nav-link"]', { hasText: 'ホーム' }).click();
  await page.waitForURL(/#\/home/);
  await page.locator('.side-nav [data-testid="nav-link"]', { hasText: '人' }).click();
  await page.waitForURL(/#\/clients/);
  await page.goto(`${BASE}#/month`);
  await page.getByTestId('schedule-toolbar').waitFor({ timeout: 60000 });
  check(
    (await page.locator('[data-testid="proposal-band"][data-kind="range"]').count()) === 1,
    '範囲の提案：ホーム・人へ移って月の予定に戻っても残る',
  );
  await page.locator('[data-testid="proposal-band"][data-kind="range"]').getByTestId('proposal-discard').click();
}

const steps = sharedPage({
  open: async () => {
    const s = await openPage({ viewport: { width: 390, height: 844 }, context: { hasTouch: true } });
    const native = [];
    s.page.on('dialog', (d) => {
      if (d.type() === 'beforeunload') {
        d.accept();
        return;
      }
      native.push(`${d.type()}: ${d.message()}`);
      d.dismiss();
    });
    // 地図のタイルは取りに行かない
    await s.ctx.route(/tile|cyberjapandata/, (r) => r.fulfill({ status: 204, body: '' }));
    return { ...s, native };
  },
  steps: [
    ['day-list', dayList],
    ['date-send', dateSend],
    ['sheet', sheet],
    ['multi', multi],
    ['tabs', tabs],
    ['maps-off', mapsOff],
    ['keyboard', keyboard],
    ['rescope-confirm', rescopeConfirm],
    ['palette', palette],
    ['keep-range', keepRange],
  ],
  after: ({ native }) => {
    check(native.length === 0, 'ブラウザのダイアログを出さない', native);
  },
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
