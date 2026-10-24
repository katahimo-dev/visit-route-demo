// 予定のモード［組む｜変更｜確認］とメニューの畳める子の項目（PRD D348・D349。ADR-0061）：
// 既定のモード（月の後半で来月の担当なしの日が2日以上なら組む、それ以外は確認）・モードで出す操作（組む：AI で組む・欠勤とメールなし、
// 確認：AI で組むなし・札を動かさない、変更：すべて）・選んだモードを画面を移っても覚える・?mode= で開く・
// メニューの予定の子（今日の予定・◯月を組む・欠勤・キャンセル）とモードの印・設定を畳む／開く（覚える）・件数の印。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-modes.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
const path = require('node:path');
const { BASE, OUT_DIR, TODAY, MODE_KEY, STORAGE_KEY, check, hashOf, runSteps, settle } = require('./lib/env.cjs');
const { sharedPage } = require('./lib/steps.cjs');

const side = (page) => page.locator('.side-nav');
const modeOf = (page) => page.getByTestId('mode-switch').getAttribute('data-mode');
const count = (page, sel) => page.locator(sel).count();

async function open(page, hash, ready = '[data-testid="mode-switch"]') {
  await page.goto(`${BASE}#${hash}`);
  await page.locator(ready).first().waitFor({ timeout: 30000 });
  await settle(page, 300);
}
async function pick(page, mode) {
  await page.locator(`[data-testid="mode-switch"] [data-mode="${mode}"]`).click();
  await settle(page, 200);
}

const steps = sharedPage({
  steps: [
    [
      'default-mode',
      async (page) => {
        // 選んでいない（読めない値）：既定のモード。初期データに戻す
        await page.goto(`${BASE}#/home`);
        await page.evaluate(
          ([k, s]) => {
            sessionStorage.setItem(k, '');
            localStorage.removeItem(s);
          },
          [MODE_KEY, STORAGE_KEY],
        );
        await page.reload();
        await open(page, '/plan');
        // メニューの「◯月を組む」の件数（担当なしの訪問がある日）から既定を出す（lib/scheduleMode の defaultMode と同じ）
        const late = Number(TODAY.slice(8, 10)) >= 15;
        const badge = await side(page)
          .locator('[data-key="mode-plan"] [data-testid="nav-badge"]')
          .getAttribute('title')
          .catch(() => null);
        const days = Number(/(\d+)日/.exec(badge ?? '')?.[1] ?? 0);
        const want = late && days >= 2 ? 'plan' : 'check';
        check((await modeOf(page)) === want, `既定のモード（月の後半＝${late}・来月の担当なしの日 ${days}日）`, {
          mode: await modeOf(page),
          want,
        });
        check(
          (await page.getByTestId('mode-lead').innerText()).length > 0,
          'ナビの行の下にモードの1行の説明',
          await page.getByTestId('mode-lead').innerText(),
        );
      },
    ],
    [
      'tools-by-mode',
      async (page) => {
        await open(page, '/plan', '[data-testid="schedule-toolbar"]');
        await pick(page, 'plan');
        check(
          (await count(page, '[data-testid="sudden-open"]')) === 0 &&
            (await count(page, '[data-testid="day-mail"]')) === 0 &&
            (await count(page, '[data-testid="plan-menu"]')) === 1,
          '組む：AI で組む ▾ だけ（欠勤の登録・メールは出さない）',
        );
        await pick(page, 'check');
        check(
          (await count(page, '[data-testid="plan-menu"]')) === 0 &&
            (await count(page, '[data-testid="sudden-open"]')) === 1 &&
            (await count(page, '[data-testid="day-mail"]')) === 1 &&
            (await count(page, '[data-testid="adopt"]')) === 1,
          '確認：欠勤の登録・メール・確定（AI で組む ▾ は出さない）',
        );
        check(
          (await count(page, 'main [draggable="true"]')) === 0,
          '確認：日の予定の札はつかめない',
          await count(page, 'main [draggable="true"]'),
        );
        await pick(page, 'change');
        check(
          (await count(page, '[data-testid="plan-menu"]')) === 1 &&
            (await count(page, '[data-testid="sudden-open"]')) === 1 &&
            (await count(page, '[data-testid="day-mail"]')) === 1 &&
            (await count(page, 'main [draggable="true"]')) > 0,
          '変更：すべての操作・札をつかめる',
        );
        check(
          (await page.getByTestId('schedule-toolbar').getAttribute('data-mode')) === 'change',
          '操作の行に今のモード（data-mode）',
        );
      },
    ],
    [
      'remember-and-url',
      async (page) => {
        await open(page, '/plan');
        await pick(page, 'check');
        // 週へ移っても同じモード。週の札もつかめない
        await page.locator('.sched-nav .view-switch [data-view="week"]').click();
        await page.locator('h1').filter({ hasText: '週の予定' }).waitFor();
        await settle(page, 300);
        check((await modeOf(page)) === 'check', '画面を移っても選んだモードのまま（週）');
        check(
          (await count(page, 'main [draggable="true"]')) === 0 && (await count(page, '[data-testid="week-mail"]')) === 1,
          '確認：週の札はつかめず、メールで送るはある',
        );
        // 読み直しても覚えている（タブの間）
        await page.reload();
        await page.getByTestId('mode-switch').waitFor();
        check((await modeOf(page)) === 'check', '読み直してもモードを覚えている');
        // ?mode= で開くとそのモード
        await open(page, '/month?mode=plan');
        check((await modeOf(page)) === 'plan', '?mode=plan で開くと組む');
        await page.screenshot({ path: path.join(OUT_DIR, 'modes-month-plan.png') });
      },
    ],
    [
      'menu-children',
      async (page) => {
        await page.evaluate(() => localStorage.removeItem('visit-route-demo:nav-open'));
        await open(page, '/home', 'h1');
        await page.reload();
        await page.locator('h1').waitFor();
        const tops = await side(page)
          .locator('.nav-groups > .nav-group > .nav-link, .nav-groups > .nav-group > .nav-parent > .nav-parent-row > .nav-link')
          .allInnerTexts();
        check(
          JSON.stringify(tops.map((t) => t.trim())) === JSON.stringify(['ホーム', '予定', '空き状況', '人', '設定']),
          'メニューは5項目（予定・人・設定は子の項目を持つ）',
          tops,
        );
        const kids = await side(page).locator('[data-parent="schedule"] .nav-child').evaluateAll((els) =>
          els.map((e) => e.dataset.key),
        );
        check(
          JSON.stringify(kids) === JSON.stringify(['mode-check', 'mode-plan', 'absence']),
          '予定の子：今日の予定・◯月を組む・欠勤・キャンセル',
          kids,
        );
        // 設定ははじめ畳む。▾ で開き、読み直しても開いたまま
        const toggle = side(page).locator('[data-parent="settings"] [data-testid="nav-toggle"]');
        check(
          (await toggle.getAttribute('aria-expanded')) === 'false' &&
            (await side(page).locator('[data-parent="settings"] .nav-child').count()) === 0,
          '設定ははじめ畳んでいる',
        );
        await toggle.click();
        check(
          (await toggle.getAttribute('aria-expanded')) === 'true' &&
            (await side(page).locator('[data-parent="settings"] .nav-child').count()) >= 3,
          '▾ で設定の子（タブ）が開く',
        );
        await page.reload();
        await page.locator('h1').waitFor();
        check(
          (await side(page).locator('[data-parent="settings"] [data-testid="nav-toggle"]').getAttribute('aria-expanded')) ===
            'true',
          '開け閉めを覚える',
        );
        // 今日の予定：今日の日の予定を確認のモードで開き、子に印
        await side(page).locator('[data-key="mode-check"]').click();
        await page.getByTestId('mode-switch').waitFor();
        await settle(page, 300);
        check(
          hashOf(page).startsWith('#/plan') &&
            (await modeOf(page)) === 'check' &&
            (await side(page).locator('[data-key="mode-check"]').getAttribute('aria-current')) === 'page' &&
            (await side(page).locator('[data-parent="schedule"] > .nav-parent-row > .nav-link').getAttribute('aria-current')) ===
              null,
          '「今日の予定」：日の予定を確認で開き、子に今の画面の印（親には付けない）',
          hashOf(page),
        );
        check(
          (await page.locator('.date-switch select').inputValue()) === TODAY,
          '「今日の予定」は今日の日付',
          await page.locator('.date-switch select').inputValue(),
        );
        // ◯月を組む：月の予定を組むで開く
        await side(page).locator('[data-key="mode-plan"]').click();
        await page.locator('h1').filter({ hasText: '月の予定' }).waitFor();
        await settle(page, 300);
        check(
          (await modeOf(page)) === 'plan' &&
            (await side(page).locator('[data-key="mode-plan"]').getAttribute('aria-current')) === 'page',
          '「◯月を組む」：月の予定を組むで開く',
        );
        // 予定を畳むと親に印
        await side(page).locator('[data-parent="schedule"] [data-testid="nav-toggle"]').click();
        check(
          (await side(page).locator('[data-parent="schedule"] > .nav-parent-row > .nav-link').getAttribute('aria-current')) ===
            'page',
          '予定を畳むと親に今の画面の印',
        );
        await side(page).locator('[data-parent="schedule"] [data-testid="nav-toggle"]').click();
        await page.screenshot({ path: path.join(OUT_DIR, 'modes-menu.png') });
      },
    ],
    [
      'menu-fits-1366',
      async (page) => {
        await page.setViewportSize({ width: 1366, height: 768 });
        await page.evaluate(() => localStorage.removeItem('visit-route-demo:nav-open'));
        await open(page, '/plan');
        await page.reload();
        await page.getByTestId('mode-switch').waitFor();
        const fit = await page.evaluate(() => {
          const nav = document.querySelector('.side-nav');
          return { fits: nav.scrollHeight <= nav.clientHeight + 1, sh: nav.scrollHeight, ch: nav.clientHeight };
        });
        check(fit.fits, '1366×768：既定の開け閉めで左のメニューが巻かずに入る（PRD D270・D349）', fit);
        await page.setViewportSize({ width: 1400, height: 1000 });
      },
    ],
  ],
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
