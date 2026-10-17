// 定期パターンの表示の文（ADR-0012・ADR-0013）
import { describe, expect, it } from 'vitest';
import type { Pattern } from '../contracts/documents';
import { monthWeeksLabel, patternWhenText, repeatText } from './patternText';

const p = (over: Partial<Pattern> = {}) => ({
  weekdays: [1, 4],
  everyWeeks: 1,
  repeat: 'weekly' as const,
  monthWeeks: [] as number[],
  dayTimes: [] as Pattern['dayTimes'],
  windowKind: 'fixed' as const,
  earliestStart: '10:00',
  latestStart: '10:00',
  ...over,
});

describe('patternWhenText', () => {
  it('毎週・隔週は今までどおり', () => {
    expect(patternWhenText(p())).toBe('月・木 10:00');
    expect(patternWhenText(p({ everyWeeks: 2, weekdays: [1] }))).toBe('隔週 月 10:00');
  });
  it('毎月の第N曜日（ADR-0013）', () => {
    expect(patternWhenText(p({ repeat: 'monthly', monthWeeks: [4, 3], weekdays: [4] }))).toBe('毎月 第3・第4 木 10:00');
    expect(monthWeeksLabel([5, 1, 1])).toBe('第1・第5');
    expect(repeatText(p({ repeat: 'monthly', monthWeeks: [2], everyWeeks: 2 }))).toBe('毎月 第2');
    expect(repeatText(p())).toBe('');
  });
  it('曜日ごとの時刻があれば曜日ごとに時刻を並べる（上書きの無い曜日は共通の時刻）', () => {
    expect(
      patternWhenText(
        p({
          earliestStart: '15:00',
          latestStart: '15:00',
          dayTimes: [{ weekday: 1, earliestStart: '09:30', latestStart: '09:30' }],
        }),
      ),
    ).toBe('月 09:30・木 15:00');
    expect(
      patternWhenText(
        p({
          windowKind: 'window',
          latestStart: '10:30',
          weekdays: [2],
          dayTimes: [{ weekday: 2, earliestStart: '13:00', latestStart: '14:00' }],
        }),
      ),
    ).toBe('火 13:00〜14:00の間');
  });
});
