import { describe, expect, it } from 'vitest';
import type { MonthProgress } from './month';
import { bandHref, bandMonth, bandNext, urgentCount, visitsText } from './progressBand';

/** 進み具合（既定は訪問のある日10日・全部確定・要対応なし） */
function pg(x: Partial<MonthProgress> = {}): MonthProgress {
  return { visits: 30, days: 10, planned: 10, confirmed: 10, unconfirmed: [], attention: 0, ...x };
}
const base = { canExpand: 0, emptyTargets: 0, urgent: 0 };

describe('bandNext', () => {
  it('訪問も作れる訪問も無い：ボタンなしで「訪問はありません」', () => {
    const r = bandNext({ ...base, progress: pg({ visits: 0, days: 0, planned: 0, confirmed: 0 }) });
    expect(r.kind).toBe('empty');
  });
  it('訪問はまだ無いが定期パターンから作れる：まとめて作る', () => {
    const r = bandNext({ ...base, canExpand: 40, progress: pg({ visits: 0, days: 0, planned: 0, confirmed: 0 }) });
    expect(r).toMatchObject({ kind: 'batch', label: 'まとめて作る', short: '作る' });
  });
  it('案の無い日がある：要対応・確定していない日より先にまとめて作る', () => {
    const r = bandNext({
      ...base,
      emptyTargets: 3,
      urgent: 2,
      progress: pg({ planned: 7, confirmed: 0, unconfirmed: ['2026-10-20'], attention: 2 }),
    });
    expect(r.kind).toBe('batch');
  });
  it('案は全部ある・手当てが要る要対応がある：確定していない日より先に要対応', () => {
    const r = bandNext({
      ...base,
      urgent: 1,
      progress: pg({ confirmed: 4, unconfirmed: ['2026-10-20'], attention: 3 }),
    });
    expect(r).toMatchObject({ kind: 'attention', label: '要対応を見る' });
  });
  it('手当てが要るものは無い・確定していない日がある：確定していない日を見る（欠勤の日だけの要対応より先）', () => {
    const r = bandNext({
      ...base,
      progress: pg({ confirmed: 8, unconfirmed: ['2026-10-20', '2026-10-21'], attention: 1 }),
    });
    expect(r).toMatchObject({ kind: 'unconfirmed', label: '確定していない日を見る', short: '未確定' });
  });
  it('全部確定・見るだけの要対応（欠勤・拘束）が残る：要対応を見る', () => {
    expect(bandNext({ ...base, progress: pg({ attention: 1 }) }).kind).toBe('attention');
  });
  it('全部済み：ボタンなしで「準備は済みました」', () => {
    expect(bandNext({ ...base, progress: pg() })).toMatchObject({ kind: 'done', label: '準備は済みました' });
  });
});

describe('urgentCount', () => {
  it('入らない・欠勤の人に残る・条件が変わったを数え、拘束・欠勤は数えない', () => {
    expect(
      urgentCount([
        { kind: 'unassigned' },
        { kind: 'absentLeft' },
        { kind: 'stale' },
        { kind: 'overSpan' },
        { kind: 'absence' },
      ]),
    ).toBe(3);
    expect(urgentCount([])).toBe(0);
  });
});

describe('bandMonth・bandHref・visitsText', () => {
  it('選んでいる日付の月（月をまたぐ週も選んでいる日の月）', () => {
    expect(bandMonth('2026-10-31')).toBe('2026-10');
    expect(bandMonth('2026-11-01')).toBe('2026-11');
  });
  it('月の画面の欄へ', () => {
    expect(bandHref('2026-11', 'batch')).toBe('/month?ym=2026-11&do=batch');
    expect(bandHref('2026-10', 'unconfirmed')).toBe('/month?ym=2026-10&do=unconfirmed');
  });
  it('訪問の件数：作っていない訪問があれば「あと N件」', () => {
    expect(visitsText(12, 0)).toBe('12件');
    expect(visitsText(12, 30)).toBe('12件（未作成 30件）');
  });
});
