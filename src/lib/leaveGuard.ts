// 確定していない下書きがある画面を離れる前の確認（PRD D286。ADR-0048）。いまは条件の重みの画面（#/rules）の重みの下書きだけ。
// HashRouter（データのルーターでない）なので useBlocker は使えない。アプリの中のリンク（メニュー・下のタブ・設定のタブ・本文のリンク）は
// 捕捉の段で止めて確かめ、コマンドパレットは移る前に confirmLeave を呼ぶ。再読込・タブを閉じるは beforeunload（ブラウザの確認）。
// ブラウザの「戻る」は止められない（〈スタッフ〉の編集の欄と同じ。ADR-0023）
// 確かめる部品（useLeaveGuard）は components/useLeaveGuard.ts。ここは移る先の判定と、開いている画面の確かめ方の置き場

/** 移ってよいかを確かめる（確定で true） */
export type LeaveGuard = () => Promise<boolean>;
let current: LeaveGuard | null = null;

/** 確かめ方を置く（画面が下書きを持った時）。外すときに呼ぶ関数を返す（別の確かめ方に置き換わっていれば外さない） */
export function setLeaveGuard(g: LeaveGuard): () => void {
  current = g;
  return () => {
    if (current === g) current = null;
  };
}

/** 画面を移ってよいか（下書きのある画面が開いていれば確かめる。無ければすぐ true） */
export const confirmLeave = (): Promise<boolean> => (current ? current() : Promise.resolve(true));

/**
 * リンクの href がアプリの中の別の画面か：`#/month?ym=…` の形で、パスが今の画面と違えばその URL（HashRouter の中の
 * `/month?ym=…`）、同じ画面（`#/rules#presets` など）・外のリンク・`#` だけなら null
 */
export function leaveTarget(href: string | null, pathname: string): string | null {
  if (!href?.startsWith('#/')) return null;
  const to = href.slice(1);
  const path = to.split(/[?#]/)[0] ?? to;
  return path === pathname ? null : to;
}
