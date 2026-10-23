// 日・週の予定のメール（PRD D92・D93・D346。ADR-0059）：
// 日の予定の「予定をメールで送る」の欄で、送れる人（アドレスがあり、長すぎない）全員分の「メールを作る」を押すと、その日が確定（伝えた）になる。
// 作った人に「作成済み」、欄に「メールを作った人 N/M人」。知らせの「元に戻す」で確定が戻る。欄の「確定（伝えた）にする」は確認を出して確定する。
// 区間ごとの道順のリンクは、長さの目安 2000字の端末でも訪問4件までは本文に残る（区間を外す前に、決まりごと・全行程・住所を外す）。
// 週の予定の「予定をメールで送る」は見出し（日と同じ場所）にあり、時間軸の表示でも出る。週のメールに「まだ確定していません」を日ごとに書かない。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-mail-confirm.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
const path = require('node:path');
const { BASE, OUT_DIR, TODAY, check, runSteps, settle } = require('./lib/env.cjs');
const { sharedPage } = require('./lib/steps.cjs');

/** メールを作るボタン（a 要素）の本文（mailto の body） */
async function bodies(page) {
  return page
    .locator('[data-testid="day-mail-rows"] a[data-testid="mail-open"]')
    .evaluateAll((els) => els.map((el) => new URL(el.getAttribute('href')).searchParams.get('body') ?? ''));
}

async function openDay(page) {
  await page.goto(`${BASE}#/plan`);
  await page.reload();
  await page.getByTestId('day-mail').waitFor({ timeout: 30000 });
  await settle(page, 300);
}

const steps = sharedPage({
  steps: [
    [
      'day-mail-confirm',
      async (page) => {
        await openDay(page);
        check(
          (await page.getByTestId('confirm-state').innerText()).includes('まだ伝えていない'),
          `日の予定（${TODAY}）ははじめ まだ伝えていない`,
        );
        await page.getByTestId('day-mail').click();
        const panel = page.getByTestId('day-mail-panel');
        await panel.waitFor();
        const progress = page.getByTestId('day-mail-progress');
        const first = await progress.innerText();
        const m = /(\d+)\/(\d+)人/.exec(first);
        check(!!m && m[1] === '0' && Number(m[2]) > 0, '欄に「メールを作った人 0/M人」', first);
        check((await page.getByTestId('day-mail-confirm').count()) === 1, '欄に「確定（伝えた）にする」');
        // 区間ごとの道順は本文に残る（Windows の目安 2000字でも訪問4件までは。このテストの端末は 2000字の目安）
        const bs = await bodies(page);
        check(
          bs.length > 0 && bs.every((b) => /https:\/\/www\.google\.com\/maps\/dir\//.test(b)),
          'どの人のメールにも Google マップの道順のリンク',
          bs.map((b) => b.length),
        );
        // 欄から送るメールは送ると確定になるので、本文は「確定した担当」（「まだ確定していません」「（未確定）」と書かない）
        check(
          bs.every((b) => !b.includes('まだ確定していません') && !b.includes('（未確定）')),
          '日のメールの本文に「まだ確定していません」「（未確定）」と書かない',
        );
        const fourOrLess = bs.filter((b) => (b.match(/^\d+\. /gm) ?? []).length <= 4);
        check(
          fourOrLess.length > 0 && fourOrLess.every((b) => (b.match(/maps\/dir\//g) ?? []).length >= 2),
          '訪問4件までの人のメールには区間ごとの道順（2本以上）',
          fourOrLess.map((b) => (b.match(/maps\/dir\//g) ?? []).length),
        );
        await page.screenshot({ path: path.join(OUT_DIR, 'day-mail-panel.png') });
        // メールアプリを開かずに押す（href を外してから押す。押したことだけ数える）
        const links = page.locator('[data-testid="day-mail-rows"] a[data-testid="mail-open"]');
        const n = await links.count();
        await links.evaluateAll((els) => {
          for (const el of els) el.removeAttribute('href');
        });
        for (let i = 0; i < n - 1; i++) await links.nth(i).click();
        await settle(page, 200);
        check(
          (await page.getByTestId('mail-sent').count()) === n - 1 &&
            (await progress.innerText()).includes(`${n - 1}/${n}人`),
          '押した人に「作成済み」・数が進む',
          await progress.innerText(),
        );
        check(
          (await page.getByTestId('confirm-state').innerText()).includes('まだ伝えていない'),
          '全員分を作るまでは確定しない',
        );
        await links.nth(n - 1).click();
        await settle(page, 400);
        check(
          (await page.getByTestId('confirm-state').innerText()).includes('確定済み'),
          '全員分のメールを作ると確定（伝えた）になる',
        );
        const toast = page.locator('.toast', { hasText: '全員分のメールを作ったので' });
        check((await toast.count()) === 1, '知らせ「全員分のメールを作ったので、この日を確定（伝えた）にしました」');
        check((await progress.innerText()).includes('確定（伝えた）済み'), '欄は「確定（伝えた）済み」');
        check((await page.getByTestId('day-mail-confirm').count()) === 0, '確定したら欄の「確定にする」は出さない');
        await page.screenshot({ path: path.join(OUT_DIR, 'day-mail-confirmed.png') });
        await toast.getByTestId('toast-undo').click();
        await settle(page, 400);
        check(
          (await page.getByTestId('confirm-state').innerText()).includes('まだ伝えていない'),
          '知らせの「元に戻す」で確定が戻る',
        );
        check(
          (await progress.innerText()).includes('確定を元に戻しました'),
          '元に戻したあとの欄は「確定を元に戻しました…「確定（伝えた）にする」を押してください」',
          await progress.innerText(),
        );
        // 元に戻したあと、同じ欄で押し直しても二重に確定しない（欄を開き直すと数え直す）
        await links.nth(0).click();
        await settle(page, 300);
        check(
          (await page.getByTestId('confirm-state').innerText()).includes('まだ伝えていない'),
          '戻したあとに同じ欄で押し直しても確定しない',
        );
        // 欄の「確定（伝えた）にする」は確認を出して確定する
        await page.getByTestId('day-mail-confirm').click();
        const dlg = page.getByRole('alertdialog');
        await dlg.waitFor();
        await dlg.getByRole('button', { name: '確定する' }).click();
        await settle(page, 400);
        check(
          (await page.getByTestId('confirm-state').innerText()).includes('確定済み'),
          '欄の「確定（伝えた）にする」→ 確認 → 確定',
        );
      },
    ],
    [
      'week-mail-button',
      async (page) => {
        await page.goto(`${BASE}#/week`);
        await page.reload();
        const btn = page.locator('.page-head [data-testid="week-mail"]');
        await btn.waitFor({ timeout: 30000 });
        check((await btn.count()) === 1, '週の予定：見出しに「予定をメールで送る」（日と同じ場所）');
        check(
          (await page.locator('[data-testid="week-mail"]').count()) === 1,
          '週の予定：メールのボタンは見出しの1つだけ（表の上には無い）',
        );
        await btn.click();
        const rows = page.getByTestId('week-mail-rows');
        await rows.waitFor();
        const body = await rows
          .locator('a[data-testid="mail-open"]')
          .first()
          .evaluate((el) => new URL(el.getAttribute('href')).searchParams.get('body') ?? '');
        check(
          !body.includes('まだ確定していません'),
          '週のメール：日ごとに「まだ確定していません」と書かない',
          body.slice(0, 200),
        );
        check(
          body.split('確定した予定は前日のメールでお知らせします').length <= 2,
          '週のメール：確定していない日があれば冒頭に1回だけ',
        );
        await page.screenshot({ path: path.join(OUT_DIR, 'week-mail.png') });
      },
    ],
  ],
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
