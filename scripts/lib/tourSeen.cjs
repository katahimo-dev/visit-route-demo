// e2e の共通：初回の案内ツアー（PRD D192・D193。ADR-0025 追記）を見た扱いにする。
// 文脈（browser.newContext）か page に渡す。どのページを開いても（読み直し・localStorage.clear() のあとも）
// アプリより先に「見た」の印を入れるので、ツアーが確かめを止めない。ツアー自体の確かめ（e2e-tour）では使わない

/** store/tour.ts の TOUR_SEEN_KEY と同じ */
const TOUR_SEEN_KEY = 'vrdemo:tour:seen';

/** newContext（または newPage）のすぐあとで呼ぶ */
async function skipTour(target) {
  await target.addInitScript((k) => {
    try {
      localStorage.setItem(k, '1');
    } catch {
      // about:blank などでは localStorage が使えない
    }
  }, TOUR_SEEN_KEY);
}

module.exports = { skipTour, TOUR_SEEN_KEY };
