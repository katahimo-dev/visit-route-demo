// 動きを減らす設定（prefers-reduced-motion）。なめらかに巻く所（scrollIntoView）はここで巻き方を決める

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** 動きを減らす設定なら true。matchMedia の無い所（テスト・古いブラウザ）は false */
export function prefersReducedMotion(matchMedia: ((query: string) => { matches: boolean }) | undefined): boolean {
  if (!matchMedia) return false;
  try {
    return matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

/** scrollIntoView の behavior：動きを減らす設定ならすぐ移る（auto）、ほかはなめらか（smooth） */
export function scrollBehavior(
  matchMedia: ((query: string) => { matches: boolean }) | undefined = globalThis.matchMedia?.bind(globalThis),
): ScrollBehavior {
  return prefersReducedMotion(matchMedia) ? 'auto' : 'smooth';
}
