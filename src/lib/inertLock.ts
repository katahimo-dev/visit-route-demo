// 裏の画面を操作できなくする（inert）を、要素ごとに数えるロック（ADR-0026 追記。PR #37 のレビュー）。
// スマホのメニューの引き出し（#root）と確認ダイアログ（body のほかの子）が重なり、閉じる順が逆になっても、
// 最後の1つが外れるまで inert を戻さない（scrollLock と同じ考え方）

/** inert を持つもの（HTMLElement。テストでは素のオブジェクト） */
export type InertTarget = { inert: boolean };

/**
 * 要素ごとに数えるロック。その要素の最初の lock で元の inert を覚えて true にし、最後の解除で覚えた値に戻す。
 * lock が返す関数は解除（2回呼んでも1回だけ数える）
 */
export function createInertLock() {
  const held = new Map<InertTarget, { count: number; was: boolean }>();
  return {
    lock(targets: readonly InertTarget[]): () => void {
      const list = [...new Set(targets)];
      for (const t of list) {
        const h = held.get(t);
        if (h) h.count++;
        else {
          held.set(t, { count: 1, was: t.inert });
          t.inert = true;
        }
      }
      let done = false;
      return () => {
        if (done) return;
        done = true;
        for (const t of list) {
          const h = held.get(t);
          if (!h) continue;
          h.count--;
          if (h.count === 0) {
            held.delete(t);
            t.inert = h.was;
          }
        }
      };
    },
    /** その要素に掛かっているロックの数 */
    count: (t: InertTarget) => held.get(t)?.count ?? 0,
  };
}
