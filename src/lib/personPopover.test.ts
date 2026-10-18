// 詳細の吹き出しの開いている状態（PRD D122〜D126）
import { describe, expect, it, vi } from 'vitest';
import { createPersonPopoverStore } from './personPopover';

const a = { kind: 'staff' as const, id: 's1', anchorId: 'btn-a' };
const b = { kind: 'client' as const, id: 'c1', anchorId: 'btn-b' };

describe('詳細の吹き出しの状態（createPersonPopoverStore）', () => {
  it('押すと開き、同じボタンをもう一度押すと閉じる', () => {
    const s = createPersonPopoverStore();
    expect(s.get()).toBeNull();
    s.toggle(a);
    expect(s.get()).toEqual(a);
    s.toggle({ ...a });
    expect(s.get()).toBeNull();
  });
  it('同時に1つ：別のボタンを押すと入れ替わる。同じ人でもボタンが違えば開き直す', () => {
    const s = createPersonPopoverStore();
    s.toggle(a);
    s.toggle(b);
    expect(s.get()).toEqual(b);
    const sameStaffOther = { ...a, anchorId: 'btn-c' };
    s.toggle(a);
    s.toggle(sameStaffOther);
    expect(s.get()).toEqual(sameStaffOther);
  });
  it('closeIf はそのボタンで開いているときだけ閉じる', () => {
    const s = createPersonPopoverStore();
    s.toggle(a);
    s.closeIf('btn-b');
    expect(s.get()).toEqual(a);
    s.closeIf('btn-a');
    expect(s.get()).toBeNull();
  });
  it('変わったときだけ知らせ、外した購読には知らせない', () => {
    const s = createPersonPopoverStore();
    const fn = vi.fn();
    const off = s.subscribe(fn);
    s.close();
    expect(fn).not.toHaveBeenCalled();
    s.toggle(a);
    expect(fn).toHaveBeenCalledTimes(1);
    s.closeIf('btn-b');
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    s.close();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
