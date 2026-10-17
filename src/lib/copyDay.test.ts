import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import type { Pattern } from '../contracts/documents';
import { client, DATE, makeData, staff, visit } from '../matching/fixtures';
import { applyPatterns } from '../patterns';
import { copyDayVisits } from './copyDay';

// DATE（2026-10-12）は月曜。10/12 → 10/19 へコピーする
const TO = '2026-10-19';

function pattern(id: string, over: Partial<Pattern> = {}): Pattern {
  return {
    id,
    clientId: 'c1',
    typeId: null,
    weekdays: [1],
    everyWeeks: 1,
    repeat: 'weekly',
    monthWeeks: [],
    dayTimes: [],
    windowKind: 'fixed',
    earliestStart: '09:00',
    latestStart: '09:00',
    durationMinutes: 60,
    from: DATE,
    to: null,
    usualStaffId: null,
    note: '',
    ...over,
  };
}

/** 10/12 だけ展開したデータ（10/19 はまだ展開していない） */
function data(patterns: Pattern[]): DemoData {
  const d = makeData({
    staff: [staff('s1', 38.26, 140.87)],
    clients: [client('c1', 38.27, 140.88), client('c2', 38.27, 140.881)],
    patterns,
    visits: [visit('v1', 'c2', '13:00', '13:00')],
  });
  return { ...d, visits: applyPatterns(d, { from: DATE, to: DATE }, DATE).visits };
}

const ids = () => {
  let n = 0;
  return () => `new${++n}`;
};

describe('copyDayVisits（前の週の同じ曜日からコピー）', () => {
  it('コピー先がパターンの回なら ID を「元の日_パターンID」にし、あとの applyPatterns で二重にならない', () => {
    const d = data([pattern('p1')]);
    const r = copyDayVisits(d, DATE, TO, ids());
    const pv = r.visits.find((v) => v.clientId === 'c1')!;
    expect(pv.id).toBe(`${TO}_p1`);
    expect(pv.date).toBe(TO);
    expect(pv.pattern).toEqual({ id: 'p1', date: TO, edited: false });
    // 単発は新しい ID・pattern は null
    const single = r.visits.find((v) => v.clientId === 'c2')!;
    expect(single.id).toBe('new1');
    expect(single.pattern).toBeNull();
    const next = { ...d, visits: [...d.visits, ...r.visits] };
    const again = applyPatterns(next, { from: DATE, to: TO }, DATE);
    expect(again.added).toEqual([]);
    expect(again.visits.filter((v) => v.date === TO && v.clientId === 'c1')).toHaveLength(1);
  });

  it('時刻・所要・種類が展開と違えば edited', () => {
    const d0 = data([pattern('p1')]);
    const d = {
      ...d0,
      visits: d0.visits.map((v) =>
        v.id === `${DATE}_p1`
          ? { ...v, earliestStart: '10:00', latestStart: '10:00', pattern: { ...v.pattern!, edited: true } }
          : v,
      ),
    };
    const r = copyDayVisits(d, DATE, TO, ids());
    expect(r.visits.find((v) => v.id === `${TO}_p1`)!.pattern).toEqual({ id: 'p1', date: TO, edited: true });
    // メモだけ違うのは edited にしない
    const d2 = { ...d0, visits: d0.visits.map((v) => (v.id === `${DATE}_p1` ? { ...v, note: 'メモ' } : v)) };
    expect(copyDayVisits(d2, DATE, TO, ids()).visits.find((v) => v.id === `${TO}_p1`)!.pattern!.edited).toBe(false);
  });

  it('コピー先がパターンの回でなければ（隔週の休みの週）単発で写す', () => {
    const d = data([pattern('p1', { everyWeeks: 2 })]);
    const r = copyDayVisits(d, DATE, TO, ids());
    expect(r.visits.map((v) => v.pattern)).toEqual([null, null]);
  });

  it('同じ ID の訪問がすでにあれば写さず、確定した割当はその訪問を指す', () => {
    const d0 = data([pattern('p1')]);
    const withTo = { ...d0, visits: applyPatterns(d0, { from: DATE, to: TO }, DATE).visits };
    const d = { ...withTo, manualPlans: { [DATE]: { s1: [`${DATE}_p1`, 'v1'] } } };
    const r = copyDayVisits(d, DATE, TO, ids());
    expect(r.visits.map((v) => v.id)).toEqual(['new1']);
    expect(r.cols).toEqual({ s1: [`${TO}_p1`, 'new1'] });
  });

  it('取り消した訪問は写さない', () => {
    const d0 = data([pattern('p1')]);
    const d = { ...d0, visits: d0.visits.map((v) => (v.id === 'v1' ? { ...v, cancelled: true } : v)) };
    expect(copyDayVisits(d, DATE, TO, ids()).visits.map((v) => v.id)).toEqual([`${TO}_p1`]);
  });
});
