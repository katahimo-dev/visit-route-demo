// 裏の画面を巻かないようにする（PRD D133。design.md §4 app「スマホのメニュー」）。
// 右の欄（SidePanel）とスマホのメニューの引き出しが重なっても、最後の1つが閉じるまで戻さないよう数を数える

/** overflow を持つもの（html・body の style。テストでは素のオブジェクト） */
export type OverflowStyle = { overflow: string };

/**
 * 数を数えるロック。最初の lock で targets の overflow を覚えて hidden にし、最後の解除で覚えた値に戻す。
 * lock が返す関数は解除（2回呼んでも1回だけ数える）
 */
export function createScrollLock(targets: () => OverflowStyle[]) {
  let count = 0;
  let saved: { style: OverflowStyle; overflow: string }[] = [];
  return {
    lock(): () => void {
      if (count === 0) {
        saved = targets().map((style) => ({ style, overflow: style.overflow }));
        for (const s of saved) s.style.overflow = 'hidden';
      }
      count++;
      let done = false;
      return () => {
        if (done) return;
        done = true;
        count--;
        if (count === 0) {
          for (const s of saved) s.style.overflow = s.overflow;
          saved = [];
        }
      };
    },
    /** いま掛かっているロックの数 */
    count: () => count,
  };
}
