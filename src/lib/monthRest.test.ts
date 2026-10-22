import { describe, expect, it } from 'vitest';
import { attentionCountByDate, showRestMark, usualRestByWeekday } from './monthRest';

// 2026-11-02 は月曜、11-03 は火曜
describe('usualRestByWeekday', () => {
  it('同じ曜日の最頻値（0人の日も数える）', () => {
    const u = usualRestByWeekday([
      { date: '2026-11-02', resting: 2 },
      { date: '2026-11-09', resting: 2 },
      { date: '2026-11-16', resting: 3 },
      { date: '2026-11-23', resting: 0 },
      { date: '2026-11-03', resting: 1 },
    ]);
    expect(u[1]).toBe(2);
    expect(u[2]).toBe(1);
    expect(u[0]).toBe(0); // 日曜の日が無い
  });
  it('同数なら小さい方', () => {
    const u = usualRestByWeekday([
      { date: '2026-11-02', resting: 3 },
      { date: '2026-11-09', resting: 1 },
      { date: '2026-11-16', resting: 3 },
      { date: '2026-11-23', resting: 1 },
    ]);
    expect(u[1]).toBe(1);
  });
  it('0人の日が多い曜日は、ふだん 0', () => {
    const u = usualRestByWeekday([
      { date: '2026-11-02', resting: 0 },
      { date: '2026-11-09', resting: 0 },
      { date: '2026-11-16', resting: 1 },
    ]);
    expect(u[1]).toBe(0);
  });
});

describe('showRestMark', () => {
  const b = { resting: 2, requested: 0, usual: 2, past: false };
  it('ふだんと同じか少ない日は出さない・多い日は出す', () => {
    expect(showRestMark(b)).toBe(false);
    expect(showRestMark({ ...b, resting: 1 })).toBe(false);
    expect(showRestMark({ ...b, resting: 3 })).toBe(true);
  });
  it('休みが無い日は出さない', () => {
    expect(showRestMark({ ...b, resting: 0, usual: 0 })).toBe(false);
  });
  it('希望休のある日・過去の日は今までどおり出す', () => {
    expect(showRestMark({ ...b, requested: 1 })).toBe(true);
    expect(showRestMark({ ...b, past: true })).toBe(true);
  });
});

describe('attentionCountByDate', () => {
  it('日ごとの行の数', () => {
    const m = attentionCountByDate([{ date: '2026-11-02' }, { date: '2026-11-02' }, { date: '2026-11-03' }]);
    expect(m.get('2026-11-02')).toBe(2);
    expect(m.get('2026-11-03')).toBe(1);
    expect(m.get('2026-11-04')).toBeUndefined();
  });
});
