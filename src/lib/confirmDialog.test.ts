import { describe, expect, it } from 'vitest';
import { CANCEL_LABEL, enqueue, settle, toRequest, trapTarget } from './confirmDialog';

describe('toRequest', () => {
  it('既定：取り消しは「取り消す」、色は primary、本文なしは空', () => {
    expect(toRequest(1, { title: ' 消しますか？ ', confirmLabel: ' 消す ' })).toEqual({
      id: 1,
      title: '消しますか？',
      body: '',
      confirmLabel: '消す',
      cancelLabel: CANCEL_LABEL,
      tone: 'primary',
    });
  });
  it('指定した文言・色はそのまま（空の取り消しは既定）', () => {
    const r = toRequest(2, {
      title: 't',
      body: 'a\nb',
      confirmLabel: '捨てる',
      cancelLabel: '編集を続ける',
      tone: 'danger',
    });
    expect([r.body, r.cancelLabel, r.tone]).toEqual(['a\nb', '編集を続ける', 'danger']);
    expect(toRequest(3, { title: 't', confirmLabel: 'x', cancelLabel: '  ' }).cancelLabel).toBe(CANCEL_LABEL);
  });
});

describe('enqueue・settle', () => {
  const a = toRequest(1, { title: 'a', confirmLabel: 'x' });
  const b = toRequest(2, { title: 'b', confirmLabel: 'y' });
  it('頼んだ順に並び、答えたものを外す（先頭が出ているもの）', () => {
    const q = enqueue(enqueue([], a), b);
    expect(q.map((r) => r.id)).toEqual([1, 2]);
    expect(settle(q, 1).map((r) => r.id)).toEqual([2]);
    expect(settle(settle(q, 1), 2)).toEqual([]);
  });
  it('無い ID（2回押した）は何もしない（同じ並びを返す）', () => {
    const q = enqueue([], a);
    expect(settle(q, 9)).toBe(q);
  });
});

describe('trapTarget', () => {
  it('最後で Tab → 最初、最初で Shift+Tab → 最後', () => {
    expect(trapTarget(2, 1, false)).toBe(0);
    expect(trapTarget(2, 0, true)).toBe(1);
  });
  it('途中はブラウザに任せる', () => {
    expect(trapTarget(3, 0, false)).toBeNull();
    expect(trapTarget(3, 2, true)).toBeNull();
  });
  it('外にフォーカスがあれば中へ戻す（Tab は最初、Shift+Tab は最後）', () => {
    expect(trapTarget(2, -1, false)).toBe(0);
    expect(trapTarget(2, -1, true)).toBe(1);
  });
  it('何も無ければ動かさない', () => {
    expect(trapTarget(0, -1, false)).toBe(-1);
  });
});
