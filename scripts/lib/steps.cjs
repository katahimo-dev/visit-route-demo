// e2e の共通：段（steps）の型（ADR-0041。ADR-0029 の段階2）。
// スクリプトは `module.exports = { steps }`（[段の名前, 関数] の並び）を出し、
// 単独の実行では `if (require.main === module) runSteps(steps)`、包み（e2e/legacy.spec.ts）では段ごとに test.step で回す。
// 段の中の失敗（投げた）は、今までの try/catch と同じ文の確かめ（NG）とスクリーンショットにする。準備の段だけは投げたら止める
const { launch, NOW, check, failShot, watchErrors } = require('./env.cjs');
const { skipTour } = require('./tourSeen.cjs');

/** 投げたときの理由（1行目だけ） */
const firstLine = (e) => String(e).split('\n')[0];
/** 投げたときの理由（message） */
const message = (e) => String(e?.message || e);

/**
 * fn を包み、投げたら check(false, label, info(e)) とスクリーンショット（page() があれば <名前>-fail-<shot>.png）にする
 */
function guard(fn, { label, info = message, page, shot = label }) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      check(false, label, info(e));
      const p = page?.();
      if (p) await failShot(p, shot);
    }
  };
}

/**
 * ブラウザ・文脈・ページを開く（多くのスクリプトの準備）：初回の案内ツアーを見た扱い（PRD D193）・
 * ページの時計を NOW に止める・ページのエラーを集める（env.cjs の pageErrors）
 */
async function openPage({ viewport = { width: 1400, height: 1000 }, context = {}, clock = true, logErrors = true } = {}) {
  const b = await launch();
  const ctx = await b.newContext({ viewport, ...context });
  await skipTour(ctx);
  const page = await ctx.newPage();
  if (clock) await page.clock.setFixedTime(NOW);
  watchErrors(page, { log: logErrors });
  return { b, ctx, page };
}

/**
 * 1つのページを段で使い回す型。
 *   open  … 準備（既定 openPage()）。返したもの s が段に渡る（s.page は必須）
 *   steps … [名前, fn] の並び。call(fn, s) で呼ぶ（既定 fn(s.page)）。投げたら check(false, 名前, info(理由))
 *   after … 全部の段のあとの確かめ（s を受ける）
 */
function sharedPage({ open = () => openPage(), steps, after, call = (fn, s) => fn(s.page), info = message }) {
  const s = {};
  return [
    [
      '準備',
      async () => {
        Object.assign(s, await open());
      },
    ],
    ...steps.map(([name, fn]) => [name, guard(() => call(fn, s), { label: name, info, page: () => s.page })]),
    ...(after ? [['後始末', () => after(s)]] : []),
  ];
}

/**
 * 段ごとに新しい文脈とページを開く型（段の名前は関数の名前）。
 *   open(b, fn) … 文脈とページを開く（fn はこれから走らせる段）。{ ctx, page, ... } を返す（段のあとで ctx を閉じる）
 *   steps       … 関数の並び。call(fn, s) で呼ぶ（既定 fn(s.page)）
 *   label(name) … 投げたときの確かめの名前（理由は1行目だけ）
 *   after(name, s) … 段ごとの最後の確かめ
 *   end         … 全部の段のあとの確かめ
 */
function pagePerStep({ open, steps, label, after, end, call = (fn, s) => fn(s.page) }) {
  let b = null;
  return [
    [
      '準備',
      async () => {
        b = await launch();
      },
    ],
    ...steps.map((fn) => [
      fn.name,
      async () => {
        const s = await open(b, fn);
        await guard(() => call(fn, s), { label: label(fn.name), info: firstLine, page: () => s.page, shot: fn.name })();
        await after?.(fn.name, s);
        await s.ctx.close();
      },
    ]),
    ...(end ? [['後始末', end]] : []),
  ];
}

module.exports = { guard, firstLine, message, openPage, sharedPage, pagePerStep };
