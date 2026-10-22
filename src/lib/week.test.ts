import { describe, expect, it } from 'vitest';
import type { AiPlan, DemoData } from '../contracts/data';
import type { Pattern } from '../contracts/documents';
import { compile } from '../matching';
import { client, DATE, ITEMS, makeData, staff, visit } from '../matching/fixtures';
import { applyPatterns } from '../patterns';
import {
  allowedStaffOf,
  canMoveVisit,
  changedDates,
  clientItemMark,
  clientLanes,
  clientWeekTable,
  fitCountAt,
  INSERT_RUN_LABEL,
  insertAllIntoPlans,
  insertIntoPlan,
  laneLayout,
  limitUnfit,
  moveFollowing,
  moveOnce,
  qualificationBadges,
  snapMinutes,
  staffWeekTable,
  staffWithQualification,
  typeUnfit,
  unfitMarks,
  weekDates,
  weekDay,
  weekStart,
} from './week';

// DATE（2026-10-12）は月曜

function pattern(id: string, weekdays: number[], over: Partial<Pattern> = {}): Pattern {
  return {
    id,
    clientId: 'c1',
    typeId: null,
    weekdays,
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

/** パターンを3週分（10/12〜10/31）展開したデータ */
function withPatterns(patterns: Pattern[]): DemoData {
  const d = makeData({
    staff: [staff('s1', 38.26, 140.87)],
    clients: [client('c1', 38.27, 140.88)],
    patterns,
  });
  const c = applyPatterns(d, { from: DATE, to: '2026-10-31' }, DATE);
  return { ...d, visits: c.visits };
}

function planOf(date: string, routes: Record<string, string[]>, unassigned: string[] = []): AiPlan {
  return {
    date,
    createdAt: 1,
    seed: 1,
    iterations: 1,
    routes,
    unassigned,
    score: 0,
    stopped: false,
    rules: [],
    generated: { routes, unassigned, score: 0 },
    pins: {},
  };
}

describe('weekDates・weekStart・snapMinutes', () => {
  it('月曜はじまりの7日（日曜はその前の月曜からの週）', () => {
    expect(weekDates('2026-10-14')).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ]);
    expect(weekStart('2026-10-18')).toBe('2026-10-12');
    expect(weekStart('2026-10-12')).toBe('2026-10-12');
    expect(weekDates('2026-11-01')[0]).toBe('2026-10-26');
  });

  it('15分刻みに丸める', () => {
    expect(snapMinutes(9 * 60 + 7)).toBe(9 * 60);
    expect(snapMinutes(9 * 60 + 8)).toBe(9 * 60 + 15);
  });
});

describe('laneLayout', () => {
  it('重なる帯は横に並べ、重ならない帯は1列', () => {
    const m = laneLayout([
      { id: 'a', start: 540, end: 600 },
      { id: 'b', start: 570, end: 630 },
      { id: 'c', start: 600, end: 660 },
      { id: 'd', start: 720, end: 780 },
    ]);
    expect(m.get('a')).toEqual({ lane: 0, lanes: 2 });
    expect(m.get('b')).toEqual({ lane: 1, lanes: 2 });
    // a が終わった時刻に始まる c は a のレーンに入る
    expect(m.get('c')).toEqual({ lane: 0, lanes: 2 });
    expect(m.get('d')).toEqual({ lane: 0, lanes: 1 });
  });

  it('3つ同時なら3レーン', () => {
    const m = laneLayout([
      { id: 'x', start: 540, end: 600 },
      { id: 'y', start: 540, end: 600 },
      { id: 'z', start: 550, end: 560 },
    ]);
    expect(new Set([...m.values()].map((l) => l.lane))).toEqual(new Set([0, 1, 2]));
    expect([...m.values()].every((l) => l.lanes === 3)).toBe(true);
  });
});

describe('moveOnce（この回だけ）', () => {
  it('その訪問の日付・開始（幅を保つ）だけ変え、edited にする。日付が変われば担当を外す', () => {
    const base = withPatterns([pattern('p1', [1], { windowKind: 'window', latestStart: '09:30' })]);
    const d = {
      ...base,
      visits: base.visits.map((v) => (v.id === '2026-10-19_p1' ? { ...v, staffId: 's1' } : v)),
    };
    const next = moveOnce(d, '2026-10-19_p1', '2026-10-21', 10 * 60 + 15, DATE);
    const v = next.visits.find((x) => x.id === '2026-10-19_p1')!;
    expect(v.date).toBe('2026-10-21');
    expect(v.earliestStart).toBe('10:15');
    expect(v.latestStart).toBe('10:45');
    expect(v.pattern).toEqual({ id: 'p1', date: '2026-10-19', edited: true });
    expect(v.staffId).toBeNull();
    // ほかの回とパターンは変わらない
    expect(next.visits.filter((x) => x.id !== v.id)).toEqual(d.visits.filter((x) => x.id !== v.id));
    expect(next.patterns).toEqual(d.patterns);
  });

  it('今日より前の訪問・今日より前の日へは動かさない（そのまま）', () => {
    const d = withPatterns([pattern('p1', [1])]);
    const today = '2026-10-14';
    expect(moveOnce(d, '2026-10-12_p1', '2026-10-20', 600, today)).toBe(d);
    expect(moveOnce(d, '2026-10-19_p1', '2026-10-13', 600, today)).toBe(d);
    expect(moveOnce(d, '2026-10-19_p1', today, 600, today)).not.toBe(d);
  });

  it('canMoveVisit：今日以降の訪問だけ・今日以降の日へだけ動かせる', () => {
    expect(canMoveVisit('2026-10-13', '2026-10-14')).toBe(false);
    expect(canMoveVisit('2026-10-14', '2026-10-14')).toBe(true);
    expect(canMoveVisit('2026-10-20', '2026-10-14')).toBe(true);
  });

  it('単発の訪問は pattern が null のまま。無い訪問はそのまま', () => {
    const d = makeData({ visits: [visit('v1', 'c1', '09:00', '09:00')] });
    const next = moveOnce(d, 'v1', DATE, 11 * 60, DATE);
    expect(next.visits[0]!.pattern).toBeNull();
    expect(next.visits[0]!.earliestStart).toBe('11:00');
    expect(moveOnce(d, 'nope', DATE, 600, DATE)).toBe(d);
  });
});

describe('moveFollowing（以降すべて）', () => {
  it('曜日が1つのパターン：元の日以降の回が新しい曜日・時刻になり、前の回は変わらない', () => {
    const d = withPatterns([pattern('p1', [1])]);
    const r = moveFollowing(d, '2026-10-19_p1', '2026-10-20', 10 * 60, DATE, ['np1', 'np2'])!;
    const ids = r.data.visits.map((v) => v.id).sort();
    expect(ids).toEqual(['2026-10-12_p1', '2026-10-20_np1', '2026-10-27_np1']);
    expect(r.data.visits.find((v) => v.id === '2026-10-20_np1')!.earliestStart).toBe('10:00');
    expect(r.movedVisitId).toBe('2026-10-20_np1');
    const p1 = r.data.patterns.find((p) => p.id === 'p1')!;
    expect(p1.to).toBe('2026-10-18');
    const np1 = r.data.patterns.find((p) => p.id === 'np1')!;
    expect(np1.weekdays).toEqual([2]);
    // 新しいパターンの from はドラッグした日（複数の曜日の分岐とそろえる）
    expect(np1.from).toBe('2026-10-20');
    expect(changedDates(r.change)).toEqual(['2026-10-19', '2026-10-20', '2026-10-26', '2026-10-27']);
  });

  it('ほかの曜日もあるパターン：ほかの曜日の時刻は変えず、動かした曜日だけ新しい曜日・時刻に', () => {
    const d = withPatterns([pattern('p1', [1, 3])]);
    const r = moveFollowing(d, '2026-10-19_p1', '2026-10-20', 10 * 60, DATE, ['np1', 'np2'])!;
    const after = r.data.visits.filter((v) => v.date >= '2026-10-19');
    // 月曜の回は無くなる
    expect(after.some((v) => v.date === '2026-10-19' || v.date === '2026-10-26')).toBe(false);
    // 水曜の回は 09:00 のまま
    const wed = after.filter((v) => v.date === '2026-10-21' || v.date === '2026-10-28');
    expect(wed).toHaveLength(2);
    expect(wed.every((v) => v.earliestStart === '09:00')).toBe(true);
    // 火曜の回が 10:00 で入る
    const tue = after.filter((v) => v.date === '2026-10-20' || v.date === '2026-10-27');
    expect(tue.map((v) => v.earliestStart)).toEqual(['10:00', '10:00']);
    expect(r.movedVisitId).toBe('2026-10-20_np2');
    // 前の週は変わらない
    expect(r.data.visits.filter((v) => v.date < '2026-10-19')).toEqual(d.visits.filter((v) => v.date < '2026-10-19'));
    expect(r.data.patterns.map((p) => p.id)).toEqual(['p1', 'np1', 'np2']);
  });

  it('over：動かした曜日の新しいパターンの所要・種類・幅・いつもの担当も変える（訪問の詳細の欄。PRD D300）', () => {
    const d = withPatterns([pattern('p1', [1, 3])]);
    const r = moveFollowing(d, '2026-10-19_p1', '2026-10-19', 10 * 60, DATE, ['np1', 'np2'], {
      durationMinutes: 90,
      windowKind: 'window',
      width: 30,
      usualStaffId: 's1',
    })!;
    const np2 = r.data.patterns.find((p) => p.id === 'np2')!;
    expect(np2).toMatchObject({
      durationMinutes: 90,
      windowKind: 'window',
      earliestStart: '10:00',
      latestStart: '10:30',
      usualStaffId: 's1',
    });
    // ほかの曜日（水曜）のパターンは変えない
    expect(r.data.patterns.find((p) => p.id === 'np1')!).toMatchObject({ durationMinutes: 60, usualStaffId: null });
  });

  it('単発の訪問は null', () => {
    const d = makeData({ visits: [visit('v1', 'c1', '09:00', '09:00')] });
    expect(moveFollowing(d, 'v1', DATE, 600, DATE, ['a', 'b'])).toBeNull();
  });

  it('取り消し・この回だけの変更の回は、時刻だけ動かしても復活・二重にならない（毎週水曜）', () => {
    const base = withPatterns([pattern('p1', [3])]);
    const d = {
      ...base,
      visits: base.visits.map((v) =>
        v.id === '2026-10-28_p1' ? { ...v, cancelled: true, pattern: { ...v.pattern!, edited: true } } : v,
      ),
    };
    const r = moveFollowing(d, '2026-10-21_p1', '2026-10-21', 15 * 60, DATE, ['np1', 'np2'])!;
    expect(r.data.visits.filter((v) => v.date === '2026-10-28').map((v) => v.id)).toEqual(['2026-10-28_p1']);
    expect(r.data.visits.find((v) => v.id === '2026-10-28_p1')!.cancelled).toBe(true);
    expect(r.data.visits.filter((v) => v.date === '2026-10-21').map((v) => v.id)).toEqual(['2026-10-21_np1']);
    expect(r.movedVisitId).toBe('2026-10-21_np1');
  });

  it('ほかの曜日もあるパターンでも、取り消した回は二重にならない', () => {
    const base = withPatterns([pattern('p1', [1, 3])]);
    const d = {
      ...base,
      visits: base.visits.map((v) =>
        v.id === '2026-10-28_p1' ? { ...v, cancelled: true, pattern: { ...v.pattern!, edited: true } } : v,
      ),
    };
    const r = moveFollowing(d, '2026-10-21_p1', '2026-10-21', 15 * 60, DATE, ['np1', 'np2'])!;
    expect(r.data.visits.filter((v) => v.date === '2026-10-28').map((v) => v.id)).toEqual(['2026-10-28_p1']);
    expect(r.movedVisitId).toBe('2026-10-21_np2');
  });

  it('この回だけ変えてあった回を「以降すべて」で同じ日に動かすと、その回は新しいパターンの回になる', () => {
    const base = withPatterns([pattern('p1', [3])]);
    const d = {
      ...base,
      visits: base.visits.map((v) =>
        v.id === '2026-10-21_p1'
          ? { ...v, earliestStart: '16:00', latestStart: '16:00', pattern: { ...v.pattern!, edited: true } }
          : v,
      ),
    };
    const r = moveFollowing(d, '2026-10-21_p1', '2026-10-21', 15 * 60, DATE, ['np1', 'np2'])!;
    const on21 = r.data.visits.filter((v) => v.date === '2026-10-21');
    expect(on21.map((v) => [v.id, v.earliestStart])).toEqual([['2026-10-21_np1', '15:00']]);
    expect(r.change.removed).toContainEqual({ visitId: '2026-10-21_p1', date: '2026-10-21' });
  });

  it('毎月のパターン（ADR-0013）：第N を「新しい日の第N − 元の日の第N」だけずらす（第3木 1/21 → 第4金 1/22）', () => {
    // 2027年1月の木曜は 7・14・21・28、金曜は 1・8・15・22・29。2月の金曜は 5・12・19・26
    const TODAY27 = '2027-01-10';
    const base = makeData({
      staff: [staff('s1', 38.26, 140.87)],
      clients: [client('c1', 38.27, 140.88)],
      patterns: [pattern('p1', [4], { repeat: 'monthly', monthWeeks: [3, 5], from: '2027-01-01' })],
    });
    const d = { ...base, visits: applyPatterns(base, { from: TODAY27, to: '2027-02-28' }, TODAY27).visits };
    expect(d.visits.map((v) => v.date)).toEqual(['2027-01-21', '2027-02-18']);
    const r = moveFollowing(d, '2027-01-21_p1', '2027-01-22', 10 * 60, TODAY27, ['np1', 'np2'])!;
    expect(r).not.toBeNull();
    expect(r.movedVisitId).toBe('2027-01-22_np1');
    const np1 = r.data.patterns.find((p) => p.id === 'np1')!;
    // 第3 → 第4、第5 → 第6 は無いので捨てる
    expect([np1.weekdays, np1.monthWeeks, np1.from]).toEqual([[5], [4], '2027-01-22']);
    expect(r.data.visits.map((v) => v.id).sort()).toEqual(['2027-01-22_np1', '2027-02-26_np1']);
  });

  it('動かした回が新しい日にできない組み合わせ（毎月のパターンで第N が合わない）は null でデータを変えない', () => {
    const TODAY27 = '2027-01-10';
    const base = makeData({
      staff: [staff('s1', 38.26, 140.87)],
      clients: [client('c1', 38.27, 140.88)],
      // 元の日の 1/21 は第3だが、パターンは第1だけ（あとから直した）→ ずらすと第2・第0 で合わない
      patterns: [pattern('p1', [4], { repeat: 'monthly', monthWeeks: [1], from: '2027-01-01' })],
    });
    const v = {
      ...applyPatterns(
        { ...base, patterns: [pattern('p1', [4], { repeat: 'monthly', monthWeeks: [3], from: '2027-01-01' })] },
        { from: TODAY27, to: '2027-01-31' },
        TODAY27,
      ).visits[0]!,
    };
    const d = { ...base, visits: [v] };
    expect(moveFollowing(d, v.id, '2027-01-22', 600, TODAY27, ['np1', 'np2'])).toBeNull();
    // 第1 + 1 = 第2 の金曜（1/8）ではなく、1/22（第4）へは作れない
  });

  it('曜日ごとの時刻（ADR-0013）：動かした曜日の上書きは外し、ほかの曜日の時刻はそのまま', () => {
    // 月 9:00（共通）・水 14:00〜14:30（上書き）。水曜の回を木曜 15:00 へ「以降すべて」
    const d = withPatterns([
      pattern('p1', [1, 3], {
        windowKind: 'window',
        latestStart: '09:30',
        dayTimes: [{ weekday: 3, earliestStart: '14:00', latestStart: '14:30' }],
      }),
    ]);
    expect(d.visits.find((v) => v.id === '2026-10-21_p1')!.earliestStart).toBe('14:00');
    const r = moveFollowing(d, '2026-10-21_p1', '2026-10-22', 15 * 60, DATE, ['np1', 'np2'])!;
    const np1 = r.data.patterns.find((p) => p.id === 'np1')!;
    expect(np1.weekdays).toEqual([1]);
    expect(np1.dayTimes).toEqual([]);
    const np2 = r.data.patterns.find((p) => p.id === 'np2')!;
    // 動かした回の幅（30分）を保って共通の時刻にする
    expect([np2.weekdays, np2.earliestStart, np2.latestStart, np2.dayTimes]).toEqual([[4], '15:00', '15:30', []]);
    expect(r.data.visits.find((v) => v.id === '2026-10-22_np2')!.earliestStart).toBe('15:00');
    expect(r.data.visits.find((v) => v.id === '2026-10-26_np1')!.earliestStart).toBe('09:00');
  });

  it('隔週を翌週の別の曜日へ動かすと、ドラッグした日に回ができる（新しいパターンの from はドラッグした日）', () => {
    const d = withPatterns([pattern('p1', [1], { everyWeeks: 2 })]);
    expect(d.visits.map((v) => v.id)).toEqual(['2026-10-12_p1', '2026-10-26_p1']);
    const r = moveFollowing(d, '2026-10-26_p1', '2026-11-03', 10 * 60, DATE, ['np1', 'np2'])!;
    expect(r.movedVisitId).toBe('2026-11-03_np1');
    expect(r.data.patterns.find((p) => p.id === 'np1')!.from).toBe('2026-11-03');
    expect(r.data.patterns.find((p) => p.id === 'p1')!.to).toBe('2026-10-25');
    expect(r.data.visits.map((v) => v.id).sort()).toEqual(['2026-10-12_p1', '2026-11-03_np1']);
  });

  it('今日より前の訪問・今日より前の日へは動かさない（null）。今日より前の訪問は残る', () => {
    const d = withPatterns([pattern('p1', [1])]);
    const today = '2026-10-14';
    expect(moveFollowing(d, '2026-10-12_p1', '2026-10-20', 600, today, ['np1', 'np2'])).toBeNull();
    expect(moveFollowing(d, '2026-10-19_p1', '2026-10-13', 600, today, ['np1', 'np2'])).toBeNull();
  });
});

describe('insertIntoPlan（空き時間に入れる）', () => {
  const base = () =>
    makeData({
      staff: [staff('s1', 38.26, 140.87), staff('s2', 38.3, 140.9)],
      clients: [client('c1', 38.27, 140.88), client('c2', 38.27, 140.881)],
      visits: [visit('v1', 'c1', '09:00', '09:00'), visit('v2', 'c2', '13:00', '13:00')],
    });

  it('今の案の空き時間に入れて固定し、他の訪問の開始は変えない。記録に1件足して今の案の元にする', () => {
    const d0 = base();
    const d = { ...d0, aiPlans: { [DATE]: planOf(DATE, { s1: ['v1'] }, ['v2']) } };
    const before = weekDay(d, DATE);
    const r = insertIntoPlan(d, DATE, 'v2', 5);
    expect(r.staffId).not.toBeNull();
    const plan = r.data.aiPlans[DATE]!;
    expect(Object.values(plan.routes).flat().sort()).toEqual(['v1', 'v2']);
    expect(plan.unassigned).toEqual([]);
    expect(plan.pins).toEqual({ v2: r.staffId });
    expect(plan.generated).toEqual(d.aiPlans[DATE]!.generated);
    const after = weekDay(r.data, DATE);
    const startOf = (w: typeof after, id: string) => w.bands.find((b) => b.visitId === id)!.start;
    expect(startOf(after, 'v1')).toBe(startOf(before, 'v1'));
    const runs = r.data.aiRuns[DATE]!;
    expect(runs).toHaveLength(1);
    expect(runs[0]!.label).toBe(INSERT_RUN_LABEL);
    expect(plan.runId).toBe(runs[0]!.id);
  });

  it('今の案が無い・空き時間に入らないときはそのまま（staffId は null）', () => {
    const d0 = base();
    expect(insertIntoPlan(d0, DATE, 'v2', 1)).toEqual({ data: d0, staffId: null });
    // 稼働時間（08:00〜18:00）の外の訪問は入らない
    const late = {
      ...d0,
      visits: d0.visits.map((v) => (v.id === 'v2' ? { ...v, earliestStart: '19:00', latestStart: '19:00' } : v)),
      aiPlans: { [DATE]: planOf(DATE, { s1: ['v1'] }, ['v2']) },
    };
    const r = insertIntoPlan(late, DATE, 'v2', 1);
    expect(r.staffId).toBeNull();
    expect(r.data).toBe(late);
  });
});

describe('insertAllIntoPlans', () => {
  it('今の案がある日だけ入れ、入らない日を数える', () => {
    const d = makeData({
      staff: [staff('s1', 38.26, 140.87)],
      clients: [client('c1', 38.27, 140.88), client('c2', 38.27, 140.881)],
      visits: [
        visit('v1', 'c1', '09:00', '09:00'),
        visit('v2', 'c2', '13:00', '13:00'),
        visit('v3', 'c2', '19:00', '19:00', { date: '2026-10-13' }),
        visit('v4', 'c2', '13:00', '13:00', { date: '2026-10-14' }),
      ],
      aiPlans: {
        [DATE]: planOf(DATE, { s1: ['v1'] }, ['v2']),
        '2026-10-13': planOf('2026-10-13', {}, ['v3']),
      },
    });
    const r = insertAllIntoPlans(
      d,
      [
        { visitId: 'v4', date: '2026-10-14' },
        { visitId: 'v3', date: '2026-10-13' },
        { visitId: 'v2', date: DATE },
      ],
      1,
    );
    expect(r.inserted).toBe(1);
    expect(r.failedDates).toEqual(['2026-10-13']);
    expect(r.data.aiPlans[DATE]!.routes.s1).toContain('v2');
    expect(r.data.aiPlans['2026-10-14']).toBeUndefined();
  });
});

describe('weekDay', () => {
  it('今の案の lenient の時刻に帯を置き、案に無い訪問は未割当で開始（早）に置く', () => {
    const d = makeData({
      staff: [staff('s1', 38.26, 140.87)],
      clients: [client('c1', 38.27, 140.88), client('c2', 38.27, 140.881)],
      visits: [visit('v1', 'c1', '09:00', '10:00'), visit('v2', 'c2', '14:00', '14:00')],
      aiPlans: { [DATE]: planOf(DATE, { s1: ['v1'] }, ['v2']) },
    });
    const w = weekDay(d, DATE);
    expect(w.source).toBe('plan');
    expect(w.bands.map((b) => [b.visitId, b.staffId, b.start, b.end])).toEqual([
      ['v1', 's1', 540, 600],
      ['v2', null, 840, 900],
    ]);
  });

  it('今の案が無ければ確定した割当、どちらも無ければ案なし', () => {
    const d = makeData({
      staff: [staff('s1', 38.26, 140.87)],
      clients: [client('c1', 38.27, 140.88)],
      visits: [visit('v1', 'c1', '09:00', '09:00')],
      manualPlans: { [DATE]: { s1: ['v1'] } },
    });
    expect(weekDay(d, DATE).source).toBe('confirmed');
    expect(weekDay(d, DATE).bands[0]!.staffId).toBe('s1');
    const none = weekDay({ ...d, manualPlans: {} }, DATE);
    expect(none.source).toBeNull();
    expect(none.bands[0]).toMatchObject({ staffId: null, source: 'visit', start: 540 });
  });
});

describe('staffWeekTable', () => {
  it('件数・稼働時間・移動・種類・週の合計・平均との差・休み・案なし', () => {
    const d = makeData({
      staff: [staff('s1', 38.26, 140.87), staff('s2', 38.3, 140.9)],
      clients: [client('c1', 38.27, 140.88), client('c2', 38.27, 140.881)],
      visitTypes: [{ id: 't1', name: '介護', color: 0, durationMinutes: 60, requirements: [], note: '' }],
      visits: [visit('v1', 'c1', '09:00', '09:00', { typeId: 't1' }), visit('v2', 'c2', '13:00', '13:00')],
      absences: [{ id: 'a1', staffId: 's2', date: DATE, from: '08:00', to: '12:00', note: '' }],
      aiPlans: { [DATE]: planOf(DATE, { s1: ['v1', 'v2'] }) },
    });
    const days = weekDates(DATE).map((date) => weekDay(d, date));
    const t = staffWeekTable(d, days);
    expect(t.rows.map((r) => r.staffId)).toEqual(['s1', 's2']);
    const [r1, r2] = t.rows;
    const mon = r1!.cells[0]!;
    expect(mon).toMatchObject({ count: 2, hours: 10, off: false, noPlan: false, types: [{ typeId: 't1', count: 1 }] });
    expect(mon.travel).toBeGreaterThan(0);
    // 欠勤を差し引いた稼働時間
    expect(r2!.cells[0]!.hours).toBe(6);
    // 火曜は案なし、土日は休み
    // 火曜は訪問が無いので空の案（案なしにしない。dayLoad と同じ）
    expect(r1!.cells[1]!.noPlan).toBe(false);
    // 訪問の無い日は空き。休みの日は全部休み。月曜は訪問・空き（PRD D76）
    expect(r1!.cells[1]!.bar.some((x) => x.state === 'noplan')).toBe(false);
    expect(r1!.cells[1]!.bar.some((x) => x.state === 'free')).toBe(true);
    expect(r1!.cells[5]!.bar.filter((x) => x.start >= 480 && x.start < 1200).every((x) => x.state === 'rest')).toBe(
      true,
    );
    expect(mon.bar.some((x) => x.state === 'visit')).toBe(true);
    expect(mon.bar.some((x) => x.state === 'free')).toBe(true);
    expect(mon.bar.some((x) => x.state === 'noplan')).toBe(false);
    // 日ごとの合計に訪問の件数（案なしの日の「案なし（訪問 N件）」）
    expect(t.days[0]!.visits).toBe(2);
    expect(t.days[1]!.visits).toBe(0);
    expect(r1!.cells[5]!.off).toBe(true);
    expect(r1!.cells[6]!.off).toBe(true);
    expect(r1!.total).toMatchObject({ count: 2, hours: 50 });
    expect(t.average).toBe(1);
    expect(r1!.diff).toBe(1);
    expect(r2!.diff).toBe(-1);
    expect(r1!.strong && r2!.strong).toBe(true);
    expect(t.days[0]).toMatchObject({ count: 2, noPlan: false });
    expect(t.days[1]!.noPlan).toBe(false);
    // 訪問があるのに案の無い日は noPlan で、勤務内は「案なし」（空きにしない）。終日休みの人に残る件数は count
    const none = { ...d, aiPlans: {} };
    const t2 = staffWeekTable(
      none,
      weekDates(DATE).map((date) => weekDay(none, date)),
    );
    const c = t2.rows[0]!.cells[0]!;
    expect(c.noPlan).toBe(true);
    expect(c.bar.some((x) => x.state === 'noplan')).toBe(true);
    expect(c.bar.some((x) => x.state === 'free')).toBe(false);
    expect(t2.days[0]).toMatchObject({ noPlan: true, visits: 2 });
    const off = { ...d, absences: [{ id: 'a2', staffId: 's1', date: DATE, from: null, to: null, note: '' }] };
    const t3 = staffWeekTable(
      off,
      weekDates(DATE).map((date) => weekDay(off, date)),
    );
    expect(t3.rows[0]!.cells[0]).toMatchObject({ off: true, count: 2 });
  });
});

describe('qualificationBadges・staffWithQualification（資格）', () => {
  const nurse = staff('s1', 38.26, 140.87, { traits: { license: ['看護師', '介護福祉士'] } });
  const care = staff('s2', 38.26, 140.87, { traits: { license: ['介護福祉士'] } });
  const resting = staff('s3', 38.26, 140.87, { active: false, traits: { license: ['看護師'] } });

  it('選択肢の順に頭文字2字までのバッジと正式名', () => {
    expect(qualificationBadges(ITEMS, nurse)).toEqual([
      { short: '介護', name: '介護福祉士' },
      { short: '看護', name: '看護師' },
    ]);
    expect(qualificationBadges(ITEMS, staff('s4', 38, 140))).toEqual([]);
  });

  it('項目「資格」が無ければバッジもチップの選択も無い', () => {
    const items = ITEMS.filter((i) => i.name !== '資格');
    expect(qualificationBadges(items, nurse)).toEqual([]);
    expect(staffWithQualification(items, [nurse], '看護師')).toEqual([]);
  });

  it('その資格を持つ稼働中の人だけ', () => {
    expect(staffWithQualification(ITEMS, [nurse, care, resting], '看護師')).toEqual(['s1']);
    expect(staffWithQualification(ITEMS, [nurse, care, resting], '介護福祉士')).toEqual(['s1', 's2']);
  });
});

describe('allowedStaffOf・typeUnfit・fitCountAt（ドラッグ中の予告）', () => {
  const rehab = {
    id: 't1',
    name: 'リハビリ',
    color: 1,
    durationMinutes: 60,
    requirements: [{ itemId: 'license', op: 'hasAny' as const, value: ['看護師'] }],
    note: '',
  };
  const base = () =>
    makeData({
      staff: [
        staff('s1', 38.26, 140.87, { traits: { license: ['看護師'] } }),
        staff('s2', 38.26, 140.871, { traits: { license: ['介護福祉士'] } }),
      ],
      clients: [client('c1', 38.27, 140.88), client('c2', 38.27, 140.881)],
      visitTypes: [rehab],
      visits: [visit('v1', 'c1', '09:00', '09:00', { typeId: 't1' }), visit('v2', 'c2', '09:00', '09:00')],
      aiPlans: { [DATE]: planOf(DATE, { s1: ['v2'], s2: ['v1'] }) },
    });

  it('担当できる人と、種類の必要条件で可でない担当（資格✗）', () => {
    const w = weekDay(base(), DATE);
    expect(allowedStaffOf(w.problem, 'v1')).toEqual(['s1']);
    expect(allowedStaffOf(w.problem, 'v2')).toEqual(['s1', 's2']);
    expect(typeUnfit(w.problem, 'v1', 's2')).toBe(true);
    expect(typeUnfit(w.problem, 'v1', 's1')).toBe(false);
    expect(typeUnfit(w.problem, 'v1', null)).toBe(false);
    expect(allowedStaffOf(null, 'v1')).toEqual([]);
  });

  it('落とす日・時刻で空き時間に入れられる人の数（データは変えない）', () => {
    const d = base();
    // 9:00 は s1 が v2 で埋まっている（s2 は資格が無い）
    expect(fitCountAt(d, 'v1', DATE, 9 * 60)).toBe(0);
    // 13:00 なら s1 に入る
    expect(fitCountAt(d, 'v1', DATE, 13 * 60)).toBe(1);
    // 種類なしの v2 を 13:00 に：s1・s2 とも入る
    expect(fitCountAt(d, 'v2', DATE, 13 * 60)).toBe(2);
    // 案の無い火曜は空の列で数える
    const tue = '2026-10-13';
    expect(fitCountAt(d, 'v2', tue, 10 * 60)).toBe(2);
    // 土曜は誰も働かない
    expect(fitCountAt(d, 'v2', '2026-10-17', 10 * 60)).toBe(0);
    expect(d.visits.find((v) => v.id === 'v1')!.earliestStart).toBe('09:00');
    expect(fitCountAt(d, 'nope', DATE, 600)).toBeNull();
  });
});

describe('clientWeekTable（利用者さん×曜日）', () => {
  const d = makeData({
    staff: [staff('s1', 38.26, 140.87)],
    clients: [
      client('c2', 38.27, 140.88, { displayName: 'いとう' }),
      client('c1', 38.27, 140.881, { displayName: 'あべ' }),
      client('c3', 38.27, 140.882, { displayName: 'うえだ', active: false }),
    ],
    visits: [
      visit('v1', 'c1', '13:00', '13:00', { typeId: 't1' }),
      visit('v2', 'c1', '09:00', '09:00'),
      visit('v3', 'c2', '10:00', '10:00', { date: '2026-10-14' }),
      visit('v4', 'c1', '11:00', '11:00', { cancelled: true }),
    ],
    aiPlans: { [DATE]: planOf(DATE, { s1: ['v2', 'v1'] }) },
  });
  const days = weekDates(DATE).map((date) => weekDay(d, date));

  it('選ばなければ全員（表示名の順。休止中で訪問の無い人は除く）、マスは開始の順・取り消しも印として入る（PRD D83）', () => {
    const rows = clientWeekTable(d, days, null);
    expect(rows.map((r) => r.clientId)).toEqual(['c1', 'c2']);
    const mon = rows[0]!.cells[0]!;
    expect(mon.items.map((x) => [x.visitId, x.start, x.staffId, x.typeId, !!x.cancelled])).toEqual([
      ['v2', 540, 's1', null, false],
      ['v4', 660, null, null, true],
      ['v1', 780, 's1', 't1', false],
    ]);
    expect(mon.noPlan).toBe(false);
    // 案の無い日（水曜）は noPlan、入らない印は付けない
    expect(rows[1]!.cells[2]!.noPlan).toBe(true);
    expect(rows[1]!.cells[2]!.items[0]!.unassigned).toBeUndefined();
    expect(rows[1]!.cells[2]!.items.map((x) => [x.visitId, x.staffId])).toEqual([['v3', null]]);
    expect(rows[1]!.cells[0]!.items).toEqual([]);
  });

  it('選んだ人だけ（休止中でも選べば出す）', () => {
    expect(clientWeekTable(d, days, ['c3', 'c2']).map((r) => r.clientId)).toEqual(['c2', 'c3']);
    expect(clientWeekTable(d, days, []).map((r) => r.clientId)).toEqual(['c1', 'c2']);
  });

  it('印（PRD D83）：当日キャンセル・いつもの担当でない（パターンの担当が先、無ければ〈利用者さん〉の）・入らない・休み', () => {
    const p = pattern('p1', [1], { clientId: 'c1', usualStaffId: 's2' });
    const d2 = makeData({
      staff: [staff('s1', 38.26, 140.87), staff('s2', 38.26, 140.871)],
      clients: [client('c1', 38.27, 140.881, { usualStaffId: 's1' }), client('c2', 38.27, 140.88)],
      patterns: [p],
      visits: [
        visit('a', 'c1', '09:00', '09:00', { pattern: { id: 'p1', date: DATE, edited: false } }),
        visit('b', 'c1', '13:00', '13:00'),
        visit('c', 'c1', '15:00', '15:00'),
        visit('x', 'c2', '10:00', '10:00', { cancelled: true, cancelKind: 'sameDay' }),
        visit('l', 'c2', '16:00', '16:00'),
      ],
      clientLeaves: [{ id: 'L1', clientId: 'c2', from: DATE, to: DATE, note: '入院' }],
      aiPlans: { [DATE]: planOf(DATE, { s1: ['a', 'b'] }, ['c']) },
    });
    const ds = weekDates(DATE).map((date) => weekDay(d2, date));
    const rows = clientWeekTable(d2, ds, null);
    const byId = new Map(rows.flatMap((r) => r.cells[0]!.items).map((x) => [x.visitId, x]));
    // a：パターンのいつもの担当は s2 なので s1 は代
    expect(byId.get('a')!.substitute).toBe(true);
    // b：パターンが無いので〈利用者さん〉のいつもの担当（s1）と同じ
    expect(byId.get('b')!.substitute).toBeUndefined();
    expect(byId.get('c')!.unassigned).toBe(true);
    expect(byId.get('x')).toMatchObject({ cancelled: true, sameDay: true, staffId: null });
    expect(byId.get('l')!.leave).toBe(true);
    // 休み・取り消しだけのマスは案なしにしない
    expect(rows[1]!.cells[0]!.noPlan).toBe(false);
  });

  it('clientLanes：重なる帯は上下に分け、取り消し・休みは下のレーン。重ならなければ1レーン', () => {
    const it = (visitId: string, start: number, end: number, x: { cancelled?: boolean; leave?: boolean } = {}) => ({
      visitId,
      start,
      end,
      ...x,
    });
    const lanes = clientLanes([
      it('x', 540, 600, { cancelled: true }),
      it('a', 540, 600),
      it('b', 570, 630),
      it('l', 560, 580, { leave: true }),
      it('z', 900, 960),
    ]);
    // ふつうの訪問 a・b が上の2レーン、取り消し x・休み l はその下
    expect(lanes.get('a')).toEqual({ lane: 0, lanes: 4 });
    expect(lanes.get('b')).toEqual({ lane: 1, lanes: 4 });
    expect(lanes.get('x')!.lane).toBeGreaterThanOrEqual(2);
    expect(lanes.get('l')!.lane).toBeGreaterThanOrEqual(2);
    expect(lanes.get('x')!.lane).not.toBe(lanes.get('l')!.lane);
    expect(lanes.get('z')).toEqual({ lane: 0, lanes: 1 });
    // 取り消しと同じ時刻の訪問が1件ずつなら 上＝訪問・下＝取り消し
    const two = clientLanes([it('c', 540, 600, { cancelled: true }), it('v', 540, 600)]);
    expect(two.get('v')).toEqual({ lane: 0, lanes: 2 });
    expect(two.get('c')).toEqual({ lane: 1, lanes: 2 });
  });

  it('clientItemMark：形と短い文字（色だけにしない）', () => {
    const names = { short: (id: string) => `短${id}`, full: (id: string) => `名${id}` };
    const base = { visitId: 'v', date: DATE, start: 540, end: 600, typeId: null, staffId: null };
    expect(clientItemMark({ ...base, staffId: 's1', substitute: true }, false, names)).toEqual({
      kind: 'visit',
      short: '短s1',
      text: '名s1さん（いつもの担当でない）',
    });
    expect(clientItemMark({ ...base, cancelled: true }, false, names).short).toBe('取消');
    expect(clientItemMark({ ...base, cancelled: true, sameDay: true }, false, names).short).toBe('当日取消');
    expect(clientItemMark({ ...base, leave: true }, true, names)).toMatchObject({ kind: 'leave', short: '休' });
    expect(clientItemMark(base, true, names)).toMatchObject({ kind: 'noplan', short: '案なし' });
    expect(clientItemMark({ ...base, unassigned: true }, false, names)).toMatchObject({
      kind: 'unassigned',
      short: '入らない',
    });
  });
});

describe('帯の印（unfitMarks。ADR-0014 の限✗）', () => {
  it('担当を限る決まりで可でない担当に「限✗」、限った人・担当なしには付かない', () => {
    const d = makeData({
      staff: [staff('s1', 38.26, 140.87), staff('s2', 38.27, 140.88)],
      clients: [client('c1', 38.265, 140.875, { allowedStaffIds: ['s1'] })],
      visits: [visit('v1', 'c1', '10:00', '11:00')],
    });
    const p = compile(d, DATE);
    expect(limitUnfit(p, 'v1', 's2')).toBe(true);
    expect(unfitMarks(p, 'v1', 's2').map((m) => m.short)).toEqual(['限✗']);
    expect(unfitMarks(p, 'v1', 's1')).toEqual([]);
    expect(unfitMarks(p, 'v1', null)).toEqual([]);
  });
});
