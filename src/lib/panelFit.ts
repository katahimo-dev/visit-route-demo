// 右の欄（SidePanel）を、スマホのキーボードが出て見えている所（visualViewport）が縮んだときに、そこへ合わせる（PRD D197。ADR-0025 追記）。
// 欄は position: fixed; inset: 0 で、iOS・Android の Chrome はキーボードが出ても layout viewport を縮めないので、
// 下に貼り付いた確定のボタンの帯がキーボードの裏に隠れる。見えている所の上端と高さを欄の入れ物に当てる

/** visualViewport と画面の高さ（テストでは素のオブジェクト） */
export type ViewportLike = {
  /** window.innerHeight（layout viewport の高さ） */
  innerHeight: number;
  /** visualViewport.height（見えている所の高さ） */
  height: number;
  /** visualViewport.offsetTop（見えている所の上端。iOS で下へずれる） */
  offsetTop: number;
  /** visualViewport.scale（拡大しているか） */
  scale: number;
};

/** 縮んだとみなす差（px）。アドレスバーの出入りの小さな揺れでは合わせ直さない */
export const KEYBOARD_MIN_PX = 80;

/**
 * 欄の入れ物に当てる上端と高さ（px）。合わせなくてよいとき（キーボードが無い・指で拡大している）は null（CSS の inset: 0 のまま）。
 * 拡大中は見えている所が小さいのは拡大のせいなので合わせない（欄が小さく潰れる）
 */
export function panelFit(v: ViewportLike): { top: number; height: number } | null {
  if (!(v.height > 0) || !(v.innerHeight > 0)) return null;
  if (Math.abs(v.scale - 1) > 0.01) return null;
  if (v.innerHeight - v.height < KEYBOARD_MIN_PX) return null;
  return { top: Math.max(0, Math.round(v.offsetTop)), height: Math.round(v.height) };
}
