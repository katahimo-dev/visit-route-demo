// 組み方の標準（PRD D350〜D354。ADR-0062）：設定のタブから開く・期間・考え方で作る（カード・王冠）・この考え方で作る
// （点数の基準が替わる・元に戻す）・標準として登録（差分の表・一時の変更の選び・登録のあとは今の標準と同じ）・
// ホームの「はじめに組み方の標準を決める」とナビの行のリンク（登録したら出さない）。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-standard.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
const path = require('node:path');
const { BASE, OUT_DIR, STORAGE_KEY, check, hashOf, runSteps, settle } = require('./lib/env.cjs');
const { sharedPage } = require('./lib/steps.cjs');

const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), STORAGE_KEY);

async function open(page, hash, ready) {
  await page.goto(`${BASE}#${hash}`);
  await page.locator(ready).first().waitFor({ timeout: 30000 });
  await settle(page, 300);
}
async function confirm(page) {
  await page.getByTestId('confirm-ok').click();
  await page.getByTestId('confirm-dialog').waitFor({ state: 'detached' });
  await settle(page, 300);
}

const steps = sharedPage({
  steps: [
    [
      'entry-before-register',
      async (page) => {
        // 初期データ（標準を登録していない）
        await page.goto(`${BASE}#/home`);
        await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
        await page.reload();
        await page.locator('h1').waitFor();
        await settle(page, 500);
        const lead = page.locator('[data-lead]').first();
        check(
          (await lead.innerText()).includes('はじめに組み方の標準を決める'),
          'ホームの先頭のカードは「はじめに組み方の標準を決める」',
          await lead.innerText(),
        );
        await open(page, '/plan', '[data-testid="mode-lead"]');
        check(
          (await page.getByTestId('mode-standard-link').count()) === 1,
          'ナビの行の下に「組み方の標準を決める」のリンク',
        );
        await page.getByTestId('mode-standard-link').click();
        await page.getByTestId('standard-steps').waitFor();
        check(hashOf(page).startsWith('#/standard'), 'リンクで組み方の標準の画面へ', hashOf(page));
      },
    ],
    [
      'period-and-tabs',
      async (page) => {
        check(
          (await page.locator('[data-testid="settings-tabs"] [data-tab]').first().innerText()).includes('組み方の標準'),
          '設定のタブの先頭は組み方の標準',
        );
        check(
          (await page.getByTestId('standard-now').innerText()).includes('まだ標準を登録していません'),
          '今の標準：まだ登録していない',
        );
        const period = await page.getByTestId('standard-period').innerText();
        check(/\d+\/\d+〜\d+\/\d+（\d週）/.test(period), '期間の文（M/D〜M/D（N週）と理由）', period);
        check((await page.getByTestId('standard-card').count()) >= 3, 'プリセットごとのカード（3つ以上）');
      },
    ],
    [
      'run-and-pick',
      async (page) => {
        await page.getByTestId('standard-run').click();
        const cards = await page.getByTestId('standard-card').count();
        await page.waitForFunction(
          (n) => document.querySelectorAll('[data-testid="standard-pick"]').length === n,
          cards,
          { timeout: 5 * 60 * 1000 },
        );
        await settle(page, 300);
        check((await page.getByTestId('standard-crown').count()) === 1, '王冠は1つ（いちばん点の高いカード）');
        const pts = await page.getByTestId('standard-points').allInnerTexts();
        check(pts.length === cards && pts.every((p) => /^\d+$/.test(p.trim())), 'どのカードにも点', pts);
        check((await page.getByTestId('standard-spread').count()) === cards, 'どのカードにも件数の偏り');
        await page.screenshot({ path: path.join(OUT_DIR, 'standard-cards.png'), fullPage: true });
        // 2つ目のカードで書く → 点数の基準がそのプリセットに
        const second = page.getByTestId('standard-card').nth(1);
        const presetId = await second.getAttribute('data-preset');
        const before = (await stored(page))?.scorePresetId;
        await second.getByTestId('standard-pick').click();
        check((await page.getByTestId('confirm-title').innerText()).includes('担当を書きますか'), '書く前に確認');
        await confirm(page);
        const d = await stored(page);
        check(d?.scorePresetId === presetId, '書くと点数の基準がそのプリセットになる', {
          want: presetId,
          got: d?.scorePresetId,
        });
        // 元に戻すで書く前に戻る
        await page.getByTestId('toast-undo').click();
        await settle(page, 300);
        check(
          ((await stored(page))?.scorePresetId ?? null) === (before ?? null),
          '元に戻すで点数の基準も戻る',
          (await stored(page))?.scorePresetId,
        );
      },
    ],
    [
      'register',
      async (page) => {
        // 提案は書いたら捨てるので、作り直さずに今の担当（初期の AI の担当）で登録する
        await page.getByTestId('standard-steps').waitFor();
        const changed = await page.locator('[data-testid="standard-row"][data-changed="true"]').count();
        check(changed > 0, '差分の表に変わる繰り返しがある', changed);
        if ((await page.getByTestId('standard-temp').count()) > 0) {
          await page.getByTestId('standard-temp-choice').getByText('標準に戻す（消す）').click();
        }
        await page.getByTestId('standard-register').click();
        check((await page.getByTestId('confirm-title').innerText()).includes('標準を登録しますか'), '登録の前に確認');
        await confirm(page);
        const d = await stored(page);
        check(!!d?.standard, '登録の記録（standard）が残る', d?.standard);
        check(
          (await page.getByTestId('standard-now').innerText()).startsWith('標準：'),
          '今の標準の1行が出る',
          await page.getByTestId('standard-now').innerText(),
        );
        check(
          (await page.locator('[data-testid="standard-row"][data-changed="true"]').count()) === 0 &&
            (await page.getByTestId('standard-register').isDisabled()),
          '登録したあとは今の標準と同じ（差分0・押せない）',
        );
        await page.screenshot({ path: path.join(OUT_DIR, 'standard-registered.png'), fullPage: true });
      },
    ],
    [
      'entry-after-register',
      async (page) => {
        await open(page, '/home', 'h1');
        check(
          !(await page.locator('main').innerText()).includes('はじめに組み方の標準を決める'),
          '登録したらホームに標準のカードを出さない',
        );
        await open(page, '/plan', '[data-testid="mode-lead"]');
        check((await page.getByTestId('mode-standard-link').count()) === 0, '登録したらナビの行のリンクを出さない');
      },
    ],
  ],
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
