import { describe, expect, it } from 'vitest';
import { batchHref, compareEmptyGuide, periodEmptyGuide } from './emptyGuide';

const week = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
const base = { period: 'この週', dates: week, today: '2026-10-21', visitDays: [] };

describe('periodEmptyGuide（版2。ADR-0053）', () => {
  it('訪問のある日が1日でもあれば空ではない（担当なしは要対応として画面に出る）', () => {
    expect(periodEmptyGuide({ ...base, visitDays: ['2026-10-21'] })).toBeNull();
    expect(periodEmptyGuide({ ...base, dates: [] })).toBeNull();
  });
  it('訪問が無い：日の予定で訪問を足す（今日以降の最初の日）', () => {
    const g = periodEmptyGuide(base);
    expect(g?.title).toBe('この週には訪問がありません');
    expect(g?.actions).toEqual([{ kind: 'day', date: '2026-10-21', label: '日の予定で訪問を足す', primary: true }]);
  });
  it('訪問が無い過ぎた期間：期間の最初の日', () => {
    const g = periodEmptyGuide({ ...base, period: 'この月', today: '2026-11-05' });
    expect(g?.title).toBe('この月には訪問がありません');
    expect(g?.actions).toEqual([{ kind: 'day', date: '2026-10-19', label: '日の予定で訪問を足す', primary: true }]);
  });
});

describe('compareEmptyGuide', () => {
  it('訪問が無い日：日の画面で訪問を足す', () => {
    const g = compareEmptyGuide({ date: '2026-10-22' });
    expect(g.title).toBe('この日には訪問がありません');
    expect(g.actions).toEqual([{ kind: 'day', date: '2026-10-22', label: '日の予定で訪問を足す', primary: true }]);
  });
  it('まとめて組むの URL', () => {
    expect(batchHref('2026-11')).toBe('/month?ym=2026-11&do=batch');
  });
});
