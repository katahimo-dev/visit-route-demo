// e2e の共通：初回の案内ツアー（PRD D192・D193。ADR-0025 追記）を見た扱いにする。
// 文脈（browser.newContext）か page に渡す。どのページを開いても（読み直し・localStorage.clear() のあとも）
// アプリより先に「見た」の印を入れるので、ツアーが確かめを止めない。ツアー自体の確かめ（e2e-tour）では使わない。
// 既定で初めて開いたときの機能の入り切りも「すべて」に固定する（startFeatures.cjs。PRD D276。今までの e2e は全部入りの前提）。
// 初回の「基本」で確かめるときは { start: 'basic' }
const { startAll } = require('./startFeatures.cjs');

/** store/tour.ts の TOUR_SEEN_KEY と同じ */
const TOUR_SEEN_KEY = 'vrdemo:tour:seen';

/** newContext（または newPage）のすぐあとで呼ぶ。start：初めて開いたときの入り切り（'all'＝すべて（既定）・'basic'＝アプリの既定のまま） */
async function skipTour(target, { start = 'all' } = {}) {
  await target.addInitScript((k) => {
    try {
      localStorage.setItem(k, '1');
    } catch {
      // about:blank などでは localStorage が使えない
    }
  }, TOUR_SEEN_KEY);
  if (start === 'all') await startAll(target);
}

module.exports = { skipTour, TOUR_SEEN_KEY };
