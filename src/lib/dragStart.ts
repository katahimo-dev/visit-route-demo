// ドラッグの始まりで画面を変えるのを、次のタスクまで遅らせる（予定の画面の手直し）
//
// Chrome は dragstart の中（同じタスク）で DOM が変わり、掴んだカードが指の下からずれると、
// ドラッグをすぐ終わらせる（dragstart の直後に dragend が来て、dragover・drop が来ない）。
// 予定の画面では、ドラッグの始まりで「入らなかった訪問（未割当）」の列を列の先頭に足すため、
// 未割当が0件の案（自動作成の直後など）では列が右へずれて、別の担当へ移せなくなっていた。
// React はクリックやドラッグの始まりの更新をそのイベントの中で画面に出すので、state の更新を遅らせる。

/** 遅らせる手段（テストで差し替える） */
export type Scheduler = {
  schedule: (fn: () => void) => unknown;
  cancel: (handle: unknown) => void;
};

const timeoutScheduler: Scheduler = {
  schedule: (fn) => setTimeout(fn, 0),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * ドラッグの始まりの処理を遅らせる係。
 * start(fn)：fn を次のタスクで行う（前の分が残っていれば取り消す）。
 * end()：まだ行っていない fn を取り消す（すぐ離したときに、終わったあとで「ドラッグ中」に戻さない）。
 */
export function deferredDragStart(scheduler: Scheduler = timeoutScheduler) {
  let handle: unknown = null;
  let pending = false;
  const end = () => {
    if (pending) scheduler.cancel(handle);
    pending = false;
    handle = null;
  };
  return {
    start(fn: () => void) {
      end();
      pending = true;
      handle = scheduler.schedule(() => {
        pending = false;
        handle = null;
        fn();
      });
    },
    end,
  };
}
