import { describe, expect, it } from 'vitest';
import { canUndo, editKey, takeSnapshot, undoState } from './undoEdit';

const DATE = '2026-10-21';
const before = { routes: { s1: ['v1', 'v2'], s2: ['v3'] }, pins: { v3: 's2' } };
// v1 を s2 へ移して固定した（ドラッグ・「担当を変える」と同じ書き換え）
const after = { routes: { s1: ['v2'], s2: ['v1', 'v3'] }, pins: { v3: 's2', v1: 's2' } };

describe('editKey（routes・pins の形のキー）', () => {
  it('担当の並び・空の列・固定の書いた順に左右されない', () => {
    expect(editKey({ routes: { s2: ['v3'], s1: ['v1', 'v2'], s9: [] }, pins: { v3: 's2' } })).toBe(editKey(before));
    expect(editKey({ routes: before.routes, pins: { v1: 's2', v3: 's2' } })).toBe(
      editKey({ routes: before.routes, pins: { v3: 's2', v1: 's2' } }),
    );
  });
  it('回る順・固定が違えば違うキー', () => {
    expect(editKey({ routes: { s1: ['v2', 'v1'], s2: ['v3'] }, pins: before.pins })).not.toBe(editKey(before));
    expect(editKey({ routes: before.routes, pins: {} })).not.toBe(editKey(before));
  });
});

describe('takeSnapshot・canUndo・undoState（1手だけ戻す）', () => {
  it('前と後が同じなら控えない', () => {
    expect(takeSnapshot(DATE, before, { routes: { ...before.routes }, pins: { ...before.pins } })).toBeNull();
  });
  it('今の案が手直しのあとの形のままなら戻せ、前の routes と固定にそのまま戻る', () => {
    const snap = takeSnapshot(DATE, before, after);
    expect(canUndo(snap, DATE, after)).toBe(true);
    expect(snap && undoState(snap)).toEqual(before);
  });
  it('控えは写し：あとで元の値を書き換えても戻す先は変わらない', () => {
    const b = { routes: { s1: ['v1'] }, pins: {} as Record<string, string> };
    const snap = takeSnapshot(DATE, b, { routes: { s2: ['v1'] }, pins: { v1: 's2' } });
    b.routes.s1.push('v9');
    b.pins.v9 = 's1';
    expect(snap && undoState(snap)).toEqual({ routes: { s1: ['v1'] }, pins: {} });
  });
  it('ほかの操作（作り直す・別の手直し・訪問の取消など）で今の案が変わったら戻さない', () => {
    const snap = takeSnapshot(DATE, before, after);
    expect(canUndo(snap, DATE, { routes: after.routes, pins: { v3: 's2' } })).toBe(false);
    expect(canUndo(snap, DATE, before)).toBe(false);
    expect(canUndo(snap, DATE, null)).toBe(false);
  });
  it('別の日では戻さない・控えが無ければ戻さない', () => {
    const snap = takeSnapshot(DATE, before, after);
    expect(canUndo(snap, '2026-10-22', after)).toBe(false);
    expect(canUndo(null, DATE, after)).toBe(false);
  });
});
