// 予定の画面の時間軸（PRD D58）の位置の計算
import { describe, expect, it } from 'vitest';
import type { VisitType } from '../contracts/documents';
import type { StopTiming } from '../contracts/problem';
import { compile } from '../matching';
import { client, DATE, makeData, staff, visit } from '../matching/fixtures';
import {
  backgroundOf,
  boxOf,
  hourMarks,
  legsOf,
  shadowOf,
  spansOf,
  subtractSpans,
  TL_END,
  TL_START,
  timeRange,
  toY,
  typeUnfitOf,
} from './timeline';

describe('縦の範囲と位置', () => {
  it('07:00〜20:00 が基本で、はみ出せば1時間単位で広げる', () => {
    expect(timeRange([])).toEqual({ start: TL_START, end: TL_END });
    expect(timeRange([{ start: 8 * 60, end: 18 * 60 }])).toEqual({ start: 420, end: 1200 });
    expect(timeRange([{ start: 6 * 60 + 30, end: 20 * 60 + 10 }])).toEqual({ start: 360, end: 1260 });
    // 数でない値は無視し、0〜24時の外へは広げない
    expect(timeRange([{ start: Number.NEGATIVE_INFINITY, end: 25 * 60 }])).toEqual({ start: 420, end: 1440 });
  });
  it('目盛りは1時間ごと（両端を含む）', () => {
    expect(hourMarks({ start: 420, end: 600 })).toEqual([420, 480, 540, 600]);
  });
  it('分 → px（1分＝1.1px。範囲の外は端に寄せる）', () => {
    const r = { start: 420, end: 1200 };
    expect(toY(420, r)).toBe(0);
    expect(toY(480, r)).toBeCloseTo(66);
    expect(toY(300, r)).toBe(0);
    expect(toY(2000, r)).toBeCloseTo(780 * 1.1);
    expect(boxOf({ start: 540, end: 570 }, r, 2)).toEqual({ top: 240, height: 60 });
    // 高さの下限
    expect(boxOf({ start: 540, end: 541 }, r, 1, 12).height).toBe(12);
  });
});

describe('列の背景', () => {
  const range = { start: 420, end: 1200 };
  it('区間の差', () => {
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
  });
  it('稼働時間帯の外と途中の休みが off（灰）', () => {
    const base = spansOf([
      { start: '09:00', end: '12:00' },
      { start: '13:00', end: '17:00' },
    ]);
    expect(backgroundOf(range, base, base)).toEqual([
      { start: 420, end: 540, kind: 'off' },
      { start: 720, end: 780, kind: 'off' },
      { start: 1020, end: 1200, kind: 'off' },
    ]);
  });
  it('欠勤で差し引いた時間が absent（終日・時間帯）', () => {
    const base = spansOf([{ start: '08:00', end: '18:00' }]);
    expect(backgroundOf(range, base, [])).toEqual([
      { start: 420, end: 480, kind: 'off' },
      { start: 480, end: 1080, kind: 'absent' },
      { start: 1080, end: 1200, kind: 'off' },
    ]);
    const slots = spansOf([
      { start: '08:00', end: '10:00' },
      { start: '12:00', end: '18:00' },
    ]);
    expect(backgroundOf(range, base, slots).filter((x) => x.kind === 'absent')).toEqual([
      { start: 600, end: 720, kind: 'absent' },
    ]);
  });
  it('休みの日は範囲の全部が off', () => {
    expect(backgroundOf(range, [], [])).toEqual([{ start: 420, end: 1200, kind: 'off' }]);
  });
});

describe('移動・待ちの区間', () => {
  const stops: StopTiming[] = [
    { visitId: 'a', arrival: 540, start: 540, end: 600, wait: 0, travelIn: 15 },
    { visitId: 'b', arrival: 610, start: 630, end: 690, wait: 20, travelIn: 10 },
    { visitId: 'c', arrival: 690, start: 690, end: 720, wait: 0, travelIn: 0 },
  ];
  it('自宅から・移動・待ち・自宅まで（移動0分は出さない）', () => {
    expect(legsOf(stops, 12)).toEqual([
      { kind: 'fromHome', visitId: 'a', start: 525, end: 540, minutes: 15 },
      { kind: 'drive', visitId: 'b', start: 600, end: 610, minutes: 10 },
      { kind: 'wait', visitId: 'b', start: 610, end: 630, minutes: 20 },
      { kind: 'toHome', visitId: 'c', start: 720, end: 732, minutes: 12 },
    ]);
  });
  it('自宅の位置が無ければ「自宅まで」を出さない', () => {
    expect(legsOf(stops, null).some((x) => x.kind === 'toHome')).toBe(false);
    expect(legsOf([], 10)).toEqual([]);
  });
});

describe('ドラッグ中の影', () => {
  /** s1 は 9〜12時、s2 は 8〜18時。v1 は 10:00 固定、v2 は 10:00〜10:30 */
  const data = makeData({
    staff: [staff('s1', 38.26, 140.87, { shiftStart: '09:00', shiftEnd: '12:00' }), staff('s2', 38.27, 140.88)],
    clients: [client('c1', 38.265, 140.875), client('c2', 38.266, 140.876)],
    visits: [visit('v1', 'c1', '10:00', '10:00'), visit('v2', 'c2', '10:00', '10:30')],
  });
  const p = compile(data, DATE);
  it('入る：位置は earliest〜latest＋所要', () => {
    expect(shadowOf(p, { s1: [], s2: ['v1'] }, 'v2', 's1')).toEqual({
      start: 600,
      end: 690,
      ok: true,
      allowed: true,
    });
  });
  it('時間の約束を守れない（同じ時刻の訪問がある）なら ok が false', () => {
    const r = shadowOf(p, { s1: ['v1'], s2: [] }, 'v2', 's1');
    expect(r?.ok).toBe(false);
    expect(r?.allowed).toBe(true);
  });
  it('問題に無い訪問・人は null', () => {
    expect(shadowOf(p, {}, 'zz', 's1')).toBeNull();
    expect(shadowOf(p, {}, 'v1', 'zz')).toBeNull();
  });
  it('可否で外れる人は allowed・ok とも false', () => {
    const off = makeData({ ...data, staff: [staff('s1', 38.26, 140.87, { workDays: [] })] });
    const q = compile(off, DATE);
    expect(shadowOf(q, {}, 'v1', 's1')).toMatchObject({ ok: false, allowed: false });
  });
});

describe('資格✗', () => {
  const REHAB: VisitType = {
    id: 'rehab',
    name: 'リハビリ',
    color: 1,
    durationMinutes: 40,
    requirements: [{ itemId: 'license', op: 'hasAny', value: ['看護師'] }],
    note: '',
  };
  const data = makeData({
    staff: [
      staff('s1', 38.26, 140.87, { traits: { license: ['看護師'] } }),
      staff('s2', 38.27, 140.88, { traits: { license: ['なし'] } }),
    ],
    clients: [client('c1', 38.265, 140.875)],
    visits: [visit('v1', 'c1', '10:00', '11:00', { typeId: 'rehab' })],
    visitTypes: [REHAB],
  });
  const p = compile(data, DATE);
  it('種類の必要条件で可でない担当だけ true', () => {
    expect(typeUnfitOf(p, 'v1', 's1')).toBe(false);
    expect(typeUnfitOf(p, 'v1', 's2')).toBe(true);
    expect(typeUnfitOf(p, 'v1', null)).toBe(false);
    expect(typeUnfitOf(null, 'v1', 's2')).toBe(false);
  });
});
