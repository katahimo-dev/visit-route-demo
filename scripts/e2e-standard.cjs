// 組み方の標準（PRD D350〜D354。ADR-0063）：#/standard を開くと予定を組むのタブ（組み方の標準が今のタブ）・案をくらべる
// （カード・王冠・点・偏り・今の標準と違うマス）・表で見る（違うマスに「変更」）・この案から作る・ほかの画面へ移っても下書きと案が残る・
// マスを直す（範囲外の時刻は受け付けない・Esc で閉じてフォーカスはマス）・違う所の数・390px で横にはみ出さない・
// 標準にする（入れ替えるが既定・確認・完了の表示と週の予定へのリンク・点数の基準が案のプリセット）・登録後は今の標準と同じ。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-standard.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
const path = require('node:path');
const { BASE, OUT_DIR, STORAGE_KEY, check, hashOf, runSteps, settle } = require('./lib/env.cjs');
const { sharedPage } = require('./lib/steps.cjs');

const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), STORAGE_KEY);

async function confirm(page) {
  await page.getByTestId('confirm-ok').click();
  await page.getByTestId('confirm-dialog').waitFor({ state: 'detached' });
  await settle(page, 300);
}
/** 「今の標準と違う所 N か所」の N */
async function diffCount(page) {
  const t = await page.getByTestId('standard-diff-count').innerText();
  return Number(/(\d+)/.exec(t)?.[1] ?? Number.NaN);
}
const changedCells = (page, table) =>
  page.locator(`[data-testid="${table}"] [data-testid="standard-cell"][data-changed="true"]`).count();

/** 選んだ案（2つ目のカード） */
const picked = { id: null, name: null };

const steps = sharedPage({
  steps: [
    [
      'open-and-tabs',
      async (page) => {
        // 初期データ（標準を登録していない）
        await page.goto(`${BASE}#/home`);
        await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
        await page.goto(`${BASE}#/standard`);
        await page.reload();
        await page.getByTestId('standard-steps').waitFor({ timeout: 30000 });
        await settle(page, 300);
        check(hashOf(page).startsWith('#/standard'), '#/standard を開く', hashOf(page));
        const tabs = page.getByTestId('arrange-tabs');
        check((await tabs.count()) === 1, '予定を組むのタブがある');
        const cur = tabs.locator('[aria-current="page"]');
        check(
          (await cur.count()) === 1 && (await cur.innerText()).includes('組み方の標準'),
          '組み方の標準が今のタブ',
          (await cur.count()) ? await cur.innerText() : '',
        );
        check(
          (await page.getByTestId('standard-now').innerText()).includes('まだ標準を登録していません'),
          '今の標準：まだ登録していない',
        );
        const period = await page.getByTestId('standard-period').innerText();
        check(/\d+\/\d+〜\d+\/\d+（\d週/.test(period), '案を作る期間の文（M/D〜M/D（N週。理由））', period);
        check((await page.getByTestId('standard-card').count()) >= 3, 'プリセットごとのカード（3つ以上）');
        check((await page.getByTestId('standard-table').count()) === 0, 'はじめは下書きが無い');
        check((await page.getByTestId('standard-from-current').count()) === 1, '［今の標準から作る］がある');
        check(
          (await page.locator('[data-step="register"]').count()) === 0,
          '下書きが無ければ「標準にする」の段は出さない',
        );
        check(
          (await page.locator('.btn-primary').count()) === 1 &&
            (await page.getByTestId('standard-run').getAttribute('class')).includes('btn-primary'),
          '主ボタンは「案を作る」の1つ',
        );
      },
    ],
    [
      'run-proposals',
      async (page) => {
        const run = page.getByTestId('standard-run');
        check(/^\d+つの考え方で案を作る$/.test((await run.innerText()).trim()), '主ボタン「N つの考え方で案を作る」');
        await run.click();
        await page.getByTestId('standard-progress').waitFor({ timeout: 10000 });
        const cards = await page.getByTestId('standard-card').count();
        await page.waitForFunction(
          (n) =>
            document.querySelectorAll('[data-testid="standard-use"]').length === n &&
            !document.querySelector('[data-testid="standard-progress"]'),
          cards,
          { timeout: 5 * 60 * 1000 },
        );
        await settle(page, 300);
        check((await page.getByTestId('standard-crown').count()) === 1, '王冠は1つ（いちばん点の高いカード）');
        const pts = await page.getByTestId('standard-points').allInnerTexts();
        check(pts.length === cards && pts.every((p) => /^\d+$/.test(p.trim())), 'どのカードにも点', pts);
        check((await page.getByTestId('standard-spread').count()) === cards, 'どのカードにも件数の偏り');
        const diffs = await page.getByTestId('standard-card-diff').allInnerTexts();
        check(
          diffs.length === cards && diffs.every((t) => /^\d+マス（担当 \d+・時刻だけ \d+）$/.test(t.trim())),
          'どのカードにも今の標準と違うマスの数',
          diffs,
        );
        const d = await stored(page);
        check(!d?.standard, '案を作っても標準・予定は書かない', d?.standard);
        await page.screenshot({ path: path.join(OUT_DIR, 'standard-cards.png'), fullPage: true });
      },
    ],
    [
      'view-table',
      async (page) => {
        const card = page.getByTestId('standard-card').first();
        const n = Number(/(\d+)/.exec(await card.getByTestId('standard-card-diff').innerText())?.[1]);
        const view = card.getByTestId('standard-view');
        await view.click();
        await page.getByTestId('standard-view-table').waitFor();
        check((await view.getAttribute('aria-expanded')) === 'true', '［表で見る］は aria-expanded=true');
        const changed = page.locator('[data-testid="standard-view-table"] [data-changed="true"]');
        check((await changed.count()) === n, '表の違うマスの数はカードの数と同じ', {
          card: n,
          got: await changed.count(),
        });
        if (n > 0) check((await changed.first().innerText()).includes('変更'), '違うマスに「変更」の文字');
        check(
          (await page.locator('[data-testid="standard-view-table"] button').count()) === 0,
          '案の表は読み取り専用（押せるマスが無い）',
        );
        await view.click();
        await settle(page, 200);
        check((await page.getByTestId('standard-view-table').count()) === 0, 'もう一度押すと閉じる');
      },
    ],
    [
      'use-proposal',
      async (page) => {
        const card = page.getByTestId('standard-card').nth(1);
        picked.id = await card.getAttribute('data-preset');
        picked.name = (await card.locator('h3').innerText()).trim();
        const n = Number(/(\d+)/.exec(await card.getByTestId('standard-card-diff').innerText())?.[1]);
        await card.getByTestId('standard-use').click();
        await page.getByTestId('standard-table').waitFor();
        await settle(page, 300);
        check(
          (await page.getByTestId('standard-draft-from').innerText()).includes(picked.name),
          '下書きは選んだ案から作った',
          await page.getByTestId('standard-draft-from').innerText(),
        );
        check((await diffCount(page)) === n, '違う所の数は案のカードと同じ', { card: n, got: await diffCount(page) });
        check((await changedCells(page, 'standard-table')) === n, '下書きの違うマスの数');
        check((await page.locator('[data-step="register"]').count()) === 1, '下書きがあると「標準にする」の段');
        check((await page.locator('.btn-primary').count()) === 1, '主ボタンは画面に1つ（標準にする）');
        // 下書きがあるときの［この案から作る］は確認してから置き換える
        await page.getByTestId('standard-card').first().getByTestId('standard-use').click();
        await page.getByTestId('confirm-dialog').waitFor();
        check((await page.getByTestId('confirm-title').innerText()).includes('置き換えますか'), '置き換える前に確認');
        await page.getByTestId('confirm-cancel').click();
        await page.getByTestId('confirm-dialog').waitFor({ state: 'detached' });
        check(
          (await page.getByTestId('standard-draft-from').innerText()).includes(picked.name),
          '取り消すと下書きはそのまま',
        );
      },
    ],
    [
      'keep-across-pages',
      async (page) => {
        const before = await diffCount(page);
        await page.goto(`${BASE}#/home`);
        await page.locator('h1').first().waitFor();
        await settle(page, 300);
        await page.goto(`${BASE}#/standard`);
        await page.getByTestId('standard-steps').waitFor();
        await settle(page, 300);
        check((await page.getByTestId('standard-table').count()) === 1, 'ほかの画面へ移って戻っても下書きが残る');
        check((await diffCount(page)) === before, '下書きの違う所の数も同じ');
        check(
          (await page.getByTestId('standard-use').count()) === (await page.getByTestId('standard-card').count()),
          '案も残る',
        );
      },
    ],
    [
      'edit-cell',
      async (page) => {
        const cell = page.locator('[data-testid="standard-table"] [data-testid="standard-cell"]').first();
        const pid = await cell.getAttribute('data-pattern');
        const wd = await cell.getAttribute('data-weekday');
        const sel = `[data-testid="standard-table"] [data-testid="standard-cell"][data-pattern="${pid}"][data-weekday="${wd}"]`;
        const btn = page.locator(`${sel} button`);
        await btn.click();
        const editor = page.getByTestId('standard-editor');
        await editor.waitFor();
        check(
          await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'standard-editor-staff'),
          '欄を開くとフォーカスは担当',
        );
        // 今と違う担当を選ぶ
        const staffSel = page.getByTestId('standard-editor-staff');
        const now = await staffSel.inputValue();
        const values = await staffSel.locator('option').evaluateAll((os) => os.map((o) => o.value));
        check(values.includes(''), '担当の選びに「担当なし」がある');
        const next = values.find((v) => v !== now && v !== '') ?? '';
        await staffSel.selectOption(next);
        const nextName = (await staffSel.locator(`option[value="${next}"]`).innerText()).trim();
        // 時間の約束の外は受け付けない
        await page.getByTestId('standard-editor-start').fill('23:50');
        await page.getByTestId('standard-editor-ok').click();
        await settle(page, 200);
        check((await page.getByTestId('standard-editor-error').count()) === 1, '範囲外の時刻は文を出す');
        check((await editor.count()) === 1, '範囲外の時刻では閉じない');
        await page.getByTestId('standard-editor-start').fill('');
        await page.getByTestId('standard-editor-ok').click();
        await editor.waitFor({ state: 'detached' });
        await settle(page, 200);
        check((await page.locator(sel).innerText()).includes(nextName), '決めるとマスが選んだ担当になる', {
          want: nextName,
          got: await page.locator(sel).innerText(),
        });
        check(
          await page.evaluate((s) => document.activeElement === document.querySelector(`${s} button`), sel),
          '閉じるとフォーカスはマス',
        );
        check(
          (await diffCount(page)) === (await changedCells(page, 'standard-table')),
          '違う所の数は色の付いたマスの数と同じ',
          { count: await diffCount(page), cells: await changedCells(page, 'standard-table') },
        );
        const changed = page.locator('[data-testid="standard-table"] [data-changed="true"]');
        if ((await changed.count()) > 0)
          check((await changed.first().innerText()).includes('変更'), '違うマスに「変更」の文字');
        // Esc で閉じる（何も変えない）
        const before = await diffCount(page);
        await btn.click();
        await editor.waitFor();
        await page.keyboard.press('Escape');
        await editor.waitFor({ state: 'detached' });
        await settle(page, 200);
        check(
          await page.evaluate((s) => document.activeElement === document.querySelector(`${s} button`), sel),
          'Esc で閉じてフォーカスはマス',
        );
        check((await diffCount(page)) === before, 'Esc では変えない');
      },
    ],
    [
      'narrow',
      async (page) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await settle(page, 400);
        const w = await page.evaluate(() => document.documentElement.scrollWidth);
        check(w <= 391, '390px で画面が横にはみ出さない（表は中で巻く）', w);
        await page.screenshot({ path: path.join(OUT_DIR, 'standard-draft-390.png'), fullPage: true });
        await page.setViewportSize({ width: 1400, height: 1000 });
        await settle(page, 300);
      },
    ],
    [
      'register',
      async (page) => {
        if ((await diffCount(page)) === 0) {
          // 違う所が無ければ1マス替える
          await page.locator('[data-testid="standard-table"] [data-testid="standard-cell"] button').first().click();
          const s = page.getByTestId('standard-editor-staff');
          const now = await s.inputValue();
          await s.selectOption(now === '' ? { index: 0 } : '');
          await page.getByTestId('standard-editor-ok').click();
          await settle(page, 200);
        }
        if ((await page.getByTestId('standard-temp-choice').count()) > 0) {
          check(await page.getByTestId('standard-temp-drop').isChecked(), '既定は「標準どおりに入れ替える」');
          const txt = await page.getByTestId('standard-temp-choice').innerText();
          check(
            txt.includes('その予定を消して、新しい標準の担当・時刻にします') &&
              txt.includes('その予定は今の担当のまま固定（ピン）します'),
            '選びに何が起きるかの文',
          );
        }
        await page.getByTestId('standard-register').click();
        await page.getByTestId('confirm-dialog').waitFor();
        check((await page.getByTestId('confirm-title').innerText()).includes('標準にしますか'), '登録の前に確認');
        check(
          (await page.getByTestId('confirm-dialog').innerText()).includes(`「${picked.name}」`),
          '確認に標準の考え方を書く',
        );
        await confirm(page);
        const d = await stored(page);
        check(!!d?.standard, '登録の記録（standard）が残る', d?.standard);
        check(d?.scorePresetId === picked.id, '点数の基準（標準の考え方）が案のプリセットになる', {
          want: picked.id,
          got: d?.scorePresetId,
        });
        const done = page.getByTestId('standard-done');
        check(
          (await done.count()) === 1 && /\d+\/\d+ から毎週この表のとおりに並びます/.test(await done.innerText()),
          '完了の表示「M/D から毎週この表のとおりに並びます」',
        );
        const href = await page.getByTestId('standard-week-link').getAttribute('href');
        check(/#\/week\?d=\d{4}-\d{2}-\d{2}$/.test(href ?? ''), '［週の予定で見る］は週の予定へ', href);
        check((await page.getByTestId('standard-table').count()) === 0, '登録したら下書きを捨てる');
        check((await page.getByTestId('toast-undo').count()) === 1, 'トーストに［元に戻す］');
        check(
          (await page.getByTestId('standard-now').innerText()).startsWith('標準：'),
          '今の標準の1行が出る',
          await page.getByTestId('standard-now').innerText(),
        );
        await page.screenshot({ path: path.join(OUT_DIR, 'standard-registered.png'), fullPage: true });
      },
    ],
    [
      'same-after-register',
      async (page) => {
        await page.getByTestId('standard-from-current').click();
        await page.getByTestId('standard-table').waitFor();
        await settle(page, 300);
        check((await diffCount(page)) === 0, '登録したあと今の標準から作ると違う所0');
        check(await page.getByTestId('standard-register').isDisabled(), '違う所0なら標準にするを押せない');
        check((await page.getByTestId('standard-same').count()) === 1, '「今の標準と同じです」');
      },
    ],
  ],
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
