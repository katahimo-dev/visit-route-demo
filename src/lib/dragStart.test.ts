// ドラッグの始まりの更新を dragstart の外へ出す（Chrome がドラッグをすぐ終わらせないように）
import { describe, expect, it } from 'vitest';
import { deferredDragStart, type Scheduler } from './dragStart';

/** 手で進めるタイマー */
function manual() {
  const queue = new Map<number, () => void>();
  let next = 1;
  const scheduler: Scheduler = {
    schedule: (fn) => {
      const id = next++;
      queue.set(id, fn);
      return id;
    },
    cancel: (h) => {
      queue.delete(h as number);
    },
  };
  const flush = () => {
    const fns = [...queue.values()];
    queue.clear();
    for (const fn of fns) fn();
  };
  return { scheduler, flush, size: () => queue.size };
}

describe('deferredDragStart', () => {
  it('dragstart の中では state を変えない（次のタスクで変える）', () => {
    const t = manual();
    const drag = deferredDragStart(t.scheduler);
    let dragging: string | null = null;
    drag.start(() => {
      dragging = 'v1';
    });
    // dragstart のハンドラを抜けるまでは画面（未割当の列）を変えない
    expect(dragging).toBeNull();
    t.flush();
    expect(dragging).toBe('v1');
  });

  it('すぐ離したら（dragend が先）、あとから「ドラッグ中」に戻さない', () => {
    const t = manual();
    const drag = deferredDragStart(t.scheduler);
    let dragging: string | null = null;
    drag.start(() => {
      dragging = 'v1';
    });
    drag.end();
    dragging = null;
    t.flush();
    expect(dragging).toBeNull();
    expect(t.size()).toBe(0);
  });

  it('続けて始めたら、前の分は取り消して最後の分だけ行う', () => {
    const t = manual();
    const drag = deferredDragStart(t.scheduler);
    const seen: string[] = [];
    drag.start(() => seen.push('v1'));
    drag.start(() => seen.push('v2'));
    t.flush();
    expect(seen).toEqual(['v2']);
  });
});
