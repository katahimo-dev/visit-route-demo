import { describe, expect, it } from 'vitest';
import type { VacancyCell } from '../contracts/vacancy';
import { clientDot, inquiryDayLevel, inquiryRows, prepParts, vacancyLevel } from './glance';
import type { ClientVisitMark } from './month';

describe('vacancyLevel（空き状況のマスの段階。D78）', () => {
  const cell = (min: number, weeksOk: number, weeksTotal: number) => ({ min, weeksOk, weeksTotal });
  it('案なし・0人（どの週も）・0人の週がある・1・2・3・4人以上', () => {
    expect(vacancyLevel(cell(0, 0, 0))).toBe('unknown');
    expect(vacancyLevel(cell(0, 0, 4))).toBe('none');
    expect(vacancyLevel(cell(0, 2, 4))).toBe('partial');
    expect(vacancyLevel(cell(1, 4, 4))).toBe('one');
    expect(vacancyLevel(cell(2, 4, 4))).toBe('two');
    expect(vacancyLevel(cell(3, 4, 4))).toBe('three');
    expect(vacancyLevel(cell(7, 4, 4))).toBe('many');
  });
});

describe('inquiryRows（問い合わせの試算の週ごとのマス。D79）', () => {
  // 2026-10-19（月）・26（月）・20（火）・27（火）
  const dates = ['2026-10-19', '2026-10-20', '2026-10-26', '2026-10-27'];
  /** vacancyOf と同じ数え方のマス（数えた日＝byDate） */
  const c = (wd: number, start: number, byDate: Record<string, number>): VacancyCell => {
    const xs = Object.entries(byDate).map(([date, n]) => ({
      date,
      staffIds: Array.from({ length: n }, (_, i) => `s${i}`),
    }));
    return {
      weekday: wd,
      start,
      byDate: xs,
      min: xs.length > 0 ? Math.min(...xs.map((x) => x.staffIds.length)) : 0,
      weeksOk: xs.filter((x) => x.staffIds.length > 0).length,
      weeksTotal: xs.length,
    };
  };

  it('行は希望の時間帯の中で一番良い開始時刻（要約と同じ verdictOf）で決め、マスはその時刻の人数', () => {
    const result = {
      dates,
      noPlanDates: ['2026-10-27'],
      cells: [
        c(1, 540, { '2026-10-19': 1, '2026-10-26': 0 }),
        c(1, 600, { '2026-10-19': 3, '2026-10-26': 2 }),
        // 希望の時間帯の外（17:30）は見ない
        c(1, 1050, { '2026-10-19': 5, '2026-10-26': 5 }),
        c(2, 540, { '2026-10-20': 0 }),
      ],
    };
    const rows = inquiryRows(result, { weekdays: [2, 1], from: '09:00', to: '17:00' });
    expect(rows.map((r) => r.weekday)).toEqual([1, 2]); // 月〜日の順
    const [mon, tue] = rows;
    expect(mon!.start).toBe(600);
    expect(mon!.verdict).toBe('ok');
    expect(mon!.days).toEqual([
      { date: '2026-10-19', mark: 'ok', best: 3 },
      { date: '2026-10-26', mark: 'ok', best: 2 },
    ]);
    // 案の無い日（10/27）は？。数えた日がどれも0人なら ng
    expect(tue!.days.map((x) => x.mark)).toEqual(['ng', 'unknown']);
    expect(tue!.verdict).toBe('ng');
  });

  it('別々の時刻にしか空きが無い週は ○ にしない（10:00 は 10/19 だけ、14:00 は 10/26 だけ → 要約と同じく △）', () => {
    const result = {
      dates,
      noPlanDates: [],
      cells: [c(1, 600, { '2026-10-19': 1, '2026-10-26': 0 }), c(1, 840, { '2026-10-19': 0, '2026-10-26': 1 })],
    };
    const [mon] = inquiryRows(result, { weekdays: [1], from: '09:00', to: '17:00' });
    expect(mon!.verdict).toBe('partial');
    // 同じ判定なら早い時刻。マスはその時刻（10:00）の日ごと
    expect(mon!.start).toBe(600);
    expect(mon!.days.map((x) => x.mark)).toEqual(['ok', 'ng']);
  });

  it('希望の曜日が空なら全曜日。時間帯の中に開始時刻が無い・数えた週が無い曜日は unknown', () => {
    const rows = inquiryRows(
      { dates, noPlanDates: dates, cells: [c(1, 600, {})] },
      { weekdays: [], from: '09:00', to: '17:00' },
    );
    expect(rows).toHaveLength(7);
    expect(rows[0]!.verdict).toBe('unknown');
    expect(rows[1]!.start).toBeNull();
    expect(rows[6]!.days).toEqual([]);
  });

  it('inquiryDayLevel：？＝案なし、0人＝斜線、1人＝点々、2人以上＝緑', () => {
    expect(inquiryDayLevel({ date: '', mark: 'unknown', best: 0 })).toBe('unknown');
    expect(inquiryDayLevel({ date: '', mark: 'ng', best: 0 })).toBe('none');
    expect(inquiryDayLevel({ date: '', mark: 'ok', best: 1 })).toBe('one');
    expect(inquiryDayLevel({ date: '', mark: 'ok', best: 4 })).toBe('two');
  });
});

describe('prepParts（今月の準備の積み上げ。D80）', () => {
  it('確定済み・案あり（未確定）・案なしの日数（足すと訪問のある日）', () => {
    expect(prepParts({ days: 15, planned: 12, confirmed: 5 })).toEqual([
      { kind: 'confirmed', days: 5 },
      { kind: 'planned', days: 7 },
      { kind: 'none', days: 3 },
    ]);
    expect(prepParts({ days: 0, planned: 0, confirmed: 0 }).every((x) => x.days === 0)).toBe(true);
  });
});

describe('clientDot（〈利用者さん〉の日の点。D81）', () => {
  const v = (over: Partial<ClientVisitMark>): ClientVisitMark => ({
    visitId: 'v',
    start: 540,
    typeId: null,
    staffId: null,
    substitute: false,
    edited: false,
    cancelled: false,
    sameDay: false,
    leave: false,
    unassigned: false,
    ...over,
  });
  it('訪問が1件でもあれば訪問あり、無ければ 当日キャンセル＞取り消し＞休み、何も無ければ訪問なし', () => {
    expect(clientDot({ visits: [] })).toBe('none');
    expect(clientDot({ visits: [v({ cancelled: true }), v({})] })).toBe('visit');
    expect(clientDot({ visits: [v({ cancelled: true }), v({ cancelled: true, sameDay: true })] })).toBe('sameDay');
    expect(clientDot({ visits: [v({ cancelled: true }), v({ leave: true })] })).toBe('cancelled');
    expect(clientDot({ visits: [v({ leave: true })] })).toBe('leave');
  });
});
