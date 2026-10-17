import { describe, expect, it } from 'vitest';
import { compile } from '../matching';
import { client, DATE, makeData, staff, visit } from '../matching/fixtures';
import { dayLineRange, dayLines, dayLineText, subtractSpans } from './dayLine';
import { workStats } from './workload';

function data(over: Parameters<typeof makeData>[0] = {}) {
  return makeData({
    staff: [staff('s1', 38.26, 140.87), staff('s2', 38.3, 140.9), staff('s3', 38.3, 140.9, { workDays: [0] })],
    clients: [client('c1', 38.265, 140.875), client('c2', 38.27, 140.88), client('c3', 38.28, 140.89)],
    visits: [
      visit('v1', 'c1', '09:00', '09:00', { windowKind: 'fixed' }),
      visit('v2', 'c2', '11:00', '11:00', { windowKind: 'fixed' }),
      visit('v3', 'c3', '14:00', '14:00', { windowKind: 'fixed', durationMinutes: 90 }),
    ],
    ...over,
  });
}

describe('dayLines（担当ごとの1日。PRD D84）', () => {
  it('勤務の時間帯・件数・区間（自宅からの移動＋拘束の内訳）。訪問・移動・待ちの合計は稼働の見込みと一致（自宅からの移動の分だけ移動が多い）', () => {
    const d = data();
    const p = compile(d, DATE);
    const routes = { s1: ['v1', 'v2', 'v3'] };
    const [a, b, c] = dayLines(p, routes, ['s1', 's2', 's3']);
    expect(a!.shift).toEqual([{ start: 8 * 60, end: 18 * 60 }]);
    expect(a!.count).toBe(3);
    // 最初は自宅からの移動、そのあと訪問から始まる拘束の内訳
    expect(a!.parts[0]!.kind).toBe('travel');
    expect(a!.parts[0]!.end).toBe(9 * 60);
    expect(a!.parts[1]).toMatchObject({ kind: 'visit', start: 9 * 60 });
    const [w] = workStats(p, routes, d.org);
    const homeIn = a!.parts[0]!.end - a!.parts[0]!.start;
    expect(a!.visit).toBeCloseTo(w!.visit, 6);
    expect(a!.wait).toBeCloseTo(w!.wait, 6);
    expect(a!.travel).toBeCloseTo(w!.travel + homeIn, 6);
    // 空き＝勤務 − 区間（勤務の中で）
    expect(a!.free).toBeCloseTo(10 * 60 - (a!.visit + a!.travel + a!.wait), 6);
    // 訪問の無い人は区間なし・勤務の全部が空き。勤務の無い人は勤務なし
    expect(b).toMatchObject({ staffId: 's2', count: 0, parts: [], free: 10 * 60 });
    expect(c).toMatchObject({ staffId: 's3', count: 0, shift: [], free: 0 });
  });

  it('欠勤の時間は rest（休みの模様）。欠勤の時間に残った訪問は区間（訪問）のまま', () => {
    const d = data({ absences: [{ id: 'a1', staffId: 's1', date: DATE, from: '10:30', to: '12:00', note: '' }] });
    const p = compile(d, DATE);
    const base = () => [{ start: 8 * 60, end: 18 * 60 }];
    const [a] = dayLines(p, { s1: ['v1', 'v2'] }, ['s1'], base);
    expect(a!.shift).toEqual([
      { start: 8 * 60, end: 10.5 * 60 },
      { start: 12 * 60, end: 18 * 60 },
    ]);
    expect(a!.rest).toEqual([{ start: 10.5 * 60, end: 12 * 60 }]);
    // 時間の欠勤：v2 は欠勤の後（lenient で 12:00）に出る
    expect(a!.parts.some((x) => x.kind === 'visit' && x.start === 12 * 60)).toBe(true);
    // baseOf が無ければ rest は空
    expect(dayLines(p, {}, ['s1'])[0]!.rest).toEqual([]);
    // 終日の欠勤：勤務なし・全部休み
    const off = data({ absences: [{ id: 'a2', staffId: 's1', date: DATE, from: null, to: null, note: '' }] });
    const [o] = dayLines(compile(off, DATE), { s1: ['v1'] }, ['s1'], base);
    expect(o!.shift).toEqual([]);
    expect(o!.rest).toEqual(base());
    // 欠勤の人に残った訪問は訪問として描く（休みの模様の上）
    expect(o!.count).toBe(1);
    expect(o!.parts.some((x) => x.kind === 'visit' && x.start === 9 * 60)).toBe(true);
  });

  it('subtractSpans：区間の差', () => {
    expect(
      subtractSpans(
        [{ start: 0, end: 100 }],
        [
          { start: 20, end: 30 },
          { start: 90, end: 120 },
        ],
      ),
    ).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 90 },
    ]);
    expect(subtractSpans([{ start: 0, end: 10 }], [{ start: 0, end: 10 }])).toEqual([]);
  });

  it('dayLineRange：8〜20時。勤務・区間がはみ出せば1時間単位で広げる', () => {
    const p = compile(data(), DATE);
    expect(dayLineRange(dayLines(p, {}, ['s1']))).toEqual({ start: 8 * 60, end: 20 * 60 });
    const early = compile(
      data({ staff: [staff('s1', 38.26, 140.87, { shiftStart: '06:30', shiftEnd: '21:15' })] }),
      DATE,
    );
    expect(dayLineRange(dayLines(early, {}, ['s1']))).toEqual({ start: 6 * 60, end: 22 * 60 });
  });

  it('dayLineText：件数・勤務・訪問の始め〜終わりと内訳・空き。訪問なし・勤務なし', () => {
    const d = data();
    const p = compile(d, DATE);
    const [a, b, c] = dayLines(p, { s1: ['v1'] }, ['s1', 's2', 's3']);
    expect(dayLineText(a!)).toMatch(
      /^1件・勤務 8:00〜18:00・訪問 9:00〜10:00（訪問 1時間・移動 \d+分）・空き \d+時間\d*分?$/,
    );
    expect(dayLineText(b!)).toBe('0件・勤務 8:00〜18:00・訪問なし');
    expect(dayLineText(c!)).toBe('0件・勤務なし・訪問なし');
  });
});
