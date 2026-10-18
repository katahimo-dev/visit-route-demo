import { describe, expect, it } from 'vitest';
import { batchHref, compareEmptyGuide, periodEmptyGuide } from './emptyGuide';

const week = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
const base = { period: 'この週', dates: week, today: '2026-10-21', visitDays: [], planDays: [] };

describe('periodEmptyGuide', () => {
  it('案のある日が1日でもあれば空ではない', () => {
    expect(periodEmptyGuide({ ...base, visitDays: ['2026-10-21'], planDays: ['2026-10-21'] })).toBeNull();
    expect(periodEmptyGuide({ ...base, dates: [] })).toBeNull();
  });
  it('訪問はあるのに案が無い：今日以降の最初の訪問の日の月のまとめて作ると、その日の日の画面', () => {
    const g = periodEmptyGuide({ ...base, visitDays: ['2026-10-19', '2026-10-22', '2026-10-23'] });
    expect(g?.title).toBe('この週は案がありません');
    expect(g?.why).toContain('訪問のある 3日');
    expect(g?.why).not.toContain('またがる');
    expect(g?.actions).toEqual([
      { kind: 'batch', ym: '2026-10', label: '10月の案をまとめて作る', primary: true },
      { kind: 'day', date: '2026-10-22', label: '10/22の案を日の画面で作る', primary: false },
    ]);
  });
  it('月をまたぐ週：今日以降の最初の訪問の日の月', () => {
    const g = periodEmptyGuide({
      ...base,
      dates: ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'],
      today: '2026-10-31',
      visitDays: ['2026-10-27', '2026-11-01'],
    });
    expect(g?.actions[0]).toMatchObject({ kind: 'batch', ym: '2026-11' });
    expect(g?.actions).toHaveLength(2);
  });
  it('月をまたぐ週で両方の月に今日以降の訪問：月ごとにボタン（先の月が主）と補足の文', () => {
    const g = periodEmptyGuide({
      ...base,
      dates: ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'],
      today: '2026-10-28',
      visitDays: ['2026-10-30', '2026-11-01'],
    });
    expect(g?.actions.filter((a) => a.kind === 'batch')).toEqual([
      { kind: 'batch', ym: '2026-10', label: '10月の案をまとめて作る', primary: true },
      { kind: 'batch', ym: '2026-11', label: '11月の案をまとめて作る', primary: false },
    ]);
    expect(g?.why).toContain('10月と11月にまたがるので、月ごとにまとめて作ります');
  });
  it('訪問の日がみな過ぎた：日の画面だけ（まとめて作るは出さない）', () => {
    const g = periodEmptyGuide({ ...base, today: '2026-10-30', visitDays: ['2026-10-20'] });
    expect(g?.actions).toEqual([{ kind: 'day', date: '2026-10-20', label: '10/20を日の画面で開く', primary: true }]);
    expect(g?.why).toContain('過ぎています');
  });
  it('訪問が無い：訪問と案を作る（月の画面）と、日の画面で訪問を足す', () => {
    const g = periodEmptyGuide(base);
    expect(g?.title).toBe('この週には訪問がありません');
    expect(g?.actions).toEqual([
      { kind: 'batch', ym: '2026-10', label: '10月の訪問と案を作る', primary: true },
      { kind: 'day', date: '2026-10-21', label: '日の画面で訪問を足す', primary: false },
    ]);
  });
  it('訪問が無い過ぎた期間：日の画面だけ（主ボタン）', () => {
    const g = periodEmptyGuide({ ...base, period: 'この月', today: '2026-11-05' });
    expect(g?.title).toBe('この月には訪問がありません');
    expect(g?.actions).toEqual([{ kind: 'day', date: '2026-10-19', label: '日の画面で訪問を足す', primary: true }]);
  });
});

describe('compareEmptyGuide', () => {
  it('訪問が無い日：日の画面で訪問を足す', () => {
    const g = compareEmptyGuide({ date: '2026-10-22', today: '2026-10-21', visits: 0 });
    expect(g.title).toBe('この日には訪問がありません');
    expect(g.actions.map((a) => a.kind)).toEqual(['day']);
  });
  it('訪問があり案が無い：日の画面で案を作る（主）と、今日以降ならまとめて作る', () => {
    const g = compareEmptyGuide({ date: '2026-10-22', today: '2026-10-21', visits: 5 });
    expect(g.actions).toEqual([
      { kind: 'day', date: '2026-10-22', label: '日の画面で案を作る', primary: true },
      { kind: 'batch', ym: '2026-10', label: '10月の案をまとめて作る', primary: false },
    ]);
    expect(compareEmptyGuide({ date: '2026-10-20', today: '2026-10-21', visits: 5 }).actions).toHaveLength(1);
  });
  it('まとめて作るの URL', () => {
    expect(batchHref('2026-11')).toBe('/month?ym=2026-11&do=batch');
  });
});
