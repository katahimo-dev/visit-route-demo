import { describe, expect, it } from 'vitest';
import { canUndo, confirmedKey, editKey, takeSnapshot, undoBlockReason, undoState } from './undoEdit';

const DATE = '2026-10-21';
const before = { routes: { s1: ['v1', 'v2'], s2: ['v3'] }, pins: { v3: 's2' } };
// v1 を s2 へ移して固定した（ドラッグ・「担当を変える」と同じ書き換え）
const after = { routes: { s1: ['v2'], s2: ['v1', 'v3'] }, pins: { v3: 's2', v1: 's2' } };
/** 手直しのときの確定した割当（まだ確定していない） */
const NONE = confirmedKey(null);

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

describe('confirmedKey（確定した割当のキー）', () => {
  it('無ければ null の印、担当の並び・空の列に左右されない', () => {
    expect(confirmedKey(undefined)).toBe(confirmedKey(null));
    expect(confirmedKey({ s1: ['v1'], s2: [] })).toBe(confirmedKey({ s1: ['v1'] }));
    expect(confirmedKey({ s1: ['v1'] })).not.toBe(confirmedKey(null));
  });
});

describe('takeSnapshot・canUndo・undoState（1手だけ戻す）', () => {
  it('前と後が同じなら控えない', () => {
    expect(takeSnapshot(DATE, before, { routes: { ...before.routes }, pins: { ...before.pins } }, NONE)).toBeNull();
  });
  it('今の案が手直しのあとの形のままなら戻せ、前の routes と固定にそのまま戻る', () => {
    const snap = takeSnapshot(DATE, before, after, NONE);
    expect(canUndo(snap, DATE, after, NONE)).toBe(true);
    expect(snap && undoState(snap)).toEqual(before);
  });
  it('控えは写し：あとで元の値を書き換えても戻す先は変わらない', () => {
    const b = { routes: { s1: ['v1'] }, pins: {} as Record<string, string> };
    const snap = takeSnapshot(DATE, b, { routes: { s2: ['v1'] }, pins: { v1: 's2' } }, NONE);
    b.routes.s1.push('v9');
    b.pins.v9 = 's1';
    expect(snap && undoState(snap)).toEqual({ routes: { s1: ['v1'] }, pins: {} });
  });
  it('ほかの操作（作り直す・別の手直し・訪問の取消など）で今の案が変わったら戻さない', () => {
    const snap = takeSnapshot(DATE, before, after, NONE);
    expect(canUndo(snap, DATE, { routes: after.routes, pins: { v3: 's2' } }, NONE)).toBe(false);
    expect(canUndo(snap, DATE, before, NONE)).toBe(false);
    expect(canUndo(snap, DATE, null, NONE)).toBe(false);
  });
  it('手直しのあとに確定したら戻さない（今の案は同じでも、確定した割当と食い違うため）', () => {
    const snap = takeSnapshot(DATE, before, after, NONE);
    const adopted = confirmedKey(after.routes);
    expect(canUndo(snap, DATE, after, adopted)).toBe(false);
    expect(undoBlockReason(snap, DATE, after, adopted, false)).toBe('手直しのあとに確定しました');
  });
  it('別の日では戻さない・控えが無ければ戻さない', () => {
    const snap = takeSnapshot(DATE, before, after, NONE);
    expect(canUndo(snap, '2026-10-22', after, NONE)).toBe(false);
    expect(canUndo(null, DATE, after, NONE)).toBe(false);
  });
});

describe('undoBlockReason（戻せない理由）', () => {
  const snap = takeSnapshot(DATE, before, after, NONE);
  it('戻せるなら null', () => {
    expect(undoBlockReason(snap, DATE, after, NONE, false)).toBeNull();
  });
  it('計算中・控えが無い・別の日・案が変わった、の順に理由', () => {
    expect(undoBlockReason(snap, DATE, after, NONE, true)).toBe('計算中です');
    expect(undoBlockReason(null, DATE, after, NONE, false)).toBe('戻せる手直しがありません');
    expect(undoBlockReason(snap, '2026-10-22', after, NONE, false)).toBe('別の日の手直しです');
    expect(undoBlockReason(snap, DATE, before, NONE, false)).toBe('手直しのあとに案が変わりました');
  });
});
