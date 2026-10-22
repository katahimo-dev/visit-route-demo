import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import type { Pattern, VisitType } from '../contracts/documents';
import { addDays, hhmmToMinutes } from '../domain/time';
import { client, DATE, makeData, staff, visit } from '../matching/fixtures';
import { putVisits, visitsOn } from '../patterns';
import { createDemoData } from '../seed';
import { confirmDay } from './confirmDay';
import { dayProblemOf } from './dayPlan';
import {
  addMonths,
  attentionList,
  batchTargets,
  calendarWeeks,
  clientDay,
  clientMonth,
  type DayStatus,
  dayMarks,
  dayPlanOf,
  dayStatus,
  firstDayOf,
  issueBreakdown,
  isYm,
  monthDates,
  monthProgress,
  monthShown,
  staffDay,
  staffMonth,
  ymOf,
} from './month';
import { attentionCountByDate } from './monthRest';

const TODAY = '2026-11-10';
/** 11月のデモのデータ（繰り返しの担当で回が計算される。版2） */
const novData = (): DemoData => createDemoData('2026-11-02');

describe('月の日付', () => {
  it('monthDates：その月の1日から末日まで（うるう年も）', () => {
    expect(monthDates('2026-11')).toHaveLength(30);
    expect(monthDates('2026-11')[0]).toBe('2026-11-01');
    expect(monthDates('2026-11').at(-1)).toBe('2026-11-30');
    expect(monthDates('2028-02')).toHaveLength(29);
    expect(monthDates('2026-02')).toHaveLength(28);
  });

  it('calendarWeeks：日曜はじまりの6週×7日（前後の月を含む）', () => {
    const w = calendarWeeks('2026-11'); // 2026-11-01 は日曜
    expect(w).toHaveLength(6);
    expect(w.every((x) => x.length === 7)).toBe(true);
    expect(w[0]![0]).toBe('2026-11-01');
    expect(w[5]![6]).toBe('2026-12-12');
    const oct = calendarWeeks('2026-10'); // 2026-10-01 は木曜
    expect(oct[0]![0]).toBe('2026-09-27');
    expect(oct[0]![4]).toBe('2026-10-01');
  });

  it('月の送り・形', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(ymOf('2026-11-14')).toBe('2026-11');
    expect(isYm('2026-11')).toBe(true);
    expect(isYm('2026-13')).toBe(false);
    expect(isYm('2026-1')).toBe(false);
  });
});

describe('担当を AI で組む日（batchTargets。版2）', () => {
  const d = novData();
  const nov = monthDates('2026-11');
  const statusOf = (x: DemoData) => (date: string) => dayStatus(x, date);
  it("'all'：今日以降・訪問がある・伝えていない日。確定した日・今日より前は対象外", () => {
    const all = batchTargets(d, nov, TODAY, 'all', statusOf(d));
    expect(all.every((x) => x >= TODAY)).toBe(true);
    expect(all.every((x) => visitsOn(d, x).some((v) => !v.cancelled))).toBe(true);
    const told = confirmDay(d, all[0]!, dayProblemOf(d, all[0]!)!, 1);
    expect(batchTargets(told, nov, TODAY, 'all', statusOf(told))).not.toContain(all[0]);
  });
  it("'care'：要対応の訪問がある日だけ", () => {
    const all = batchTargets(d, nov, TODAY, 'all', statusOf(d));
    const day = all[0]!;
    const v = visitsOn(d, day).find((x) => !x.cancelled)!;
    const x = { ...d, visits: putVisits(d.visits, [{ ...v, staffId: null }]) };
    const care = batchTargets(x, nov, TODAY, 'care', statusOf(x));
    expect(care).toContain(day);
    expect(care.every((date) => dayStatus(x, date).care > 0)).toBe(true);
  });
});

describe('日の状態（dayStatus。版2）', () => {
  it('まだ伝えていない → 確定済み → 未連絡の変更あり。担当なしは要対応', () => {
    const d0 = novData();
    const day = batchTargets(d0, monthDates('2026-11'), TODAY, 'all', (x) => dayStatus(d0, x))[0]!;
    const s0 = dayStatus(d0, day);
    expect(s0.state).toBe('none');
    expect(s0.count).toBe(visitsOn(d0, day).filter((v) => !v.cancelled).length);
    const told = confirmDay(d0, day, dayProblemOf(d0, day)!, 1);
    expect(dayStatus(told, day)).toMatchObject({ state: 'told', changes: 0 });
    const v = visitsOn(told, day).find((x) => x.staffId !== null)!;
    const changed = { ...told, visits: putVisits(told.visits, [{ ...v, staffId: null }]) };
    const s2 = dayStatus(changed, day);
    expect(s2.state).toBe('changed');
    expect(s2.changes).toBe(1);
    expect(s2.unassigned).toBe(s0.unassigned + 1);
    expect(s2.needsCare).toBe(true);
    expect(issueBreakdown(s2.issues)).toContain(`担当なし ${s0.unassigned + 1}`);
  });

  it('欠勤の印・訪問の無い日は手当て不要', () => {
    const d0 = novData();
    const day = batchTargets(d0, monthDates('2026-11'), TODAY, 'all', (x) => dayStatus(d0, x))[0]!;
    const d = { ...d0, absences: [{ id: 'ab1', staffId: d0.staff[0]!.id, date: day, from: null, to: null, note: '' }] };
    expect(dayStatus(d, day).absence).toBe(true);
    const empty = dayStatus({ ...d, patterns: [] }, '2026-12-31');
    expect(empty.count).toBe(0);
    expect(empty.needsCare).toBe(false);
  });
});

// ---- 月間の改定（D53〜D55） ----

const CARE: VisitType = { id: 'care', name: '介護', color: 0, durationMinutes: 60, requirements: [], note: '' };
const REHAB: VisitType = { ...CARE, id: 'rehab', name: 'リハビリ', color: 3 };
const TUE = addDays(DATE, 1);
/** 月曜の繰り返し（繰り返しの担当は s2） */
const PATTERN: Pattern = {
  id: 'p1',
  clientId: 'c1',
  typeId: 'care',
  weekdays: [1],
  everyWeeks: 1,
  repeat: 'weekly',
  monthWeeks: [],
  dayTimes: [],
  windowKind: 'fixed',
  earliestStart: '10:00',
  latestStart: '10:00',
  durationMinutes: 60,
  from: DATE,
  to: TUE,
  usualStaffId: 's2',
  note: '',
};
/** 繰り返しの回（DATE の p1。この回だけ変えた） */
const A = `${DATE}_p1`;

/**
 * 月曜（DATE）：s1・s2（8:00〜18:00）、s3（月曜は休み）。c1 の A（10:00 介護。繰り返しの回・この回だけ変えた）・
 * b（14:00 リハビリ）・x（取り消し）、c2 の c（9:00 介護）。担当は s1＝[c, A]、s2＝[b]
 */
function selData() {
  const at = (id: string, c: string, hhmm: string, over = {}) =>
    visit(id, c, hhmm, hhmm, { windowKind: 'fixed', durationMinutes: 60, ...over });
  const visits = [
    at(A, 'c1', '10:00', { typeId: 'care', pattern: { id: 'p1', date: DATE, edited: true }, staffId: 's1' }),
    at('b', 'c1', '14:00', { typeId: 'rehab', staffId: 's2' }),
    at('x', 'c1', '16:00', { cancelled: true, typeId: 'care' }),
    at('c', 'c2', '09:00', { typeId: 'care', staffId: 's1' }),
    at('t1', 'c1', '10:00', { date: TUE, typeId: 'care' }),
  ];
  return makeData({
    staff: [
      staff('s1', 38.26, 140.87, { name: '青葉 一郎', traits: { license: ['看護師', '介護福祉士'] } }),
      staff('s2', 38.27, 140.88, { name: '泉 二郎' }),
      staff('s3', 38.27, 140.88, { name: '若林 三郎', workDays: [2, 3] }),
    ],
    clients: [
      client('c1', 38.261, 140.871, { displayName: '天文台' }),
      client('c2', 38.262, 140.872, { displayName: '城跡' }),
    ],
    visits,
    visitTypes: [CARE, REHAB],
    patterns: [PATTERN],
  });
}

describe('その日の担当の並び（dayPlanOf）', () => {
  it('訪問の担当で、開始の順', () => {
    const p = dayPlanOf(selData(), DATE);
    expect(p.routes).toEqual({ s1: ['c', A], s2: ['b'] });
    expect(p.problem).not.toBeNull();
  });
});

describe('日のマスの印（dayMarks）', () => {
  it('種類ごとの件数（取り消しを除く・種類の順）、休み・欠勤の人、始まる・終わるパターンの利用者さん', () => {
    const d = {
      ...selData(),
      // 基準日（データの最初の日）より後に始まるパターンだけを「始まる」に数えるので、基準日を前にずらす
      baseDate: addDays(DATE, -7),
      absences: [{ id: 'ab', staffId: 's2', date: DATE, from: '13:00', to: null, note: '' }],
    };
    const m = dayMarks(d, DATE);
    expect(m.types).toEqual([
      { typeId: 'care', count: 2 },
      { typeId: 'rehab', count: 1 },
    ]);
    expect(m.off).toEqual(['若林 三郎']);
    expect(m.absent).toEqual(['泉 二郎']);
    expect(m.starts).toEqual(['天文台']);
    expect(m.ends).toEqual([]);
    expect(dayMarks(d, TUE).ends).toEqual(['天文台']);
    expect(dayMarks(d, TUE).off).toEqual([]);
  });

  it('基準日（データの最初の日）以前に始まるパターンは「始まる」に数えない（初期データで全員が▶にならない）', () => {
    const d = selData();
    expect(d.baseDate).toBe(DATE);
    expect(dayMarks(d, DATE).starts).toEqual([]);
    const seed = createDemoData('2026-10-17');
    expect(dayMarks(seed, '2026-10-17').starts).toEqual([]);
  });

  it('「以降すべて」で分けたパターン（前が前日に終わり、同じ利用者さんの次が翌日から）は始まる・終わるに数えない', () => {
    const base = { ...selData(), baseDate: addDays(DATE, -30) };
    const WED = addDays(DATE, 2);
    const cut: Pattern = { ...PATTERN, to: TUE };
    const next: Pattern = { ...PATTERN, id: 'p1b', from: WED, to: null, weekdays: [3] };
    const d = { ...base, patterns: [cut, next] };
    expect(dayMarks(d, TUE).ends).toEqual([]);
    expect(dayMarks(d, WED).starts).toEqual([]);
    // 間が空けば、終わる・始まるに数える
    const later = { ...d, patterns: [cut, { ...next, from: addDays(DATE, 9) }] };
    expect(dayMarks(later, TUE).ends).toEqual(['天文台']);
    expect(dayMarks(later, addDays(DATE, 9)).starts).toEqual(['天文台']);
    // 別のパターンが続いていれば終わらない
    const other: Pattern = { ...PATTERN, id: 'p2', from: addDays(DATE, -20), to: null };
    expect(dayMarks({ ...d, patterns: [cut, other] }, TUE).ends).toEqual([]);
  });
});

describe('選んだスタッフ（staffDay・staffMonth）', () => {
  it('勤務時間帯・担当の件数・目安・移動・種類ごとの件数', () => {
    const d = selData();
    const day = dayPlanOf(d, DATE);
    const s1 = staffDay(d, day, 's1');
    expect(s1.slots).toEqual([{ start: '08:00', end: '18:00' }]);
    expect(s1.off).toBe(false);
    expect(s1.absence).toBeNull();
    expect(s1.count).toBe(2);
    expect(s1.travel).toBeGreaterThan(0);
    expect(s1.minutes).toBe(600);
    expect(s1.types).toEqual([{ typeId: 'care', count: 2 }]);
    // 目安：担当できる訪問 3件を s1・s2 の稼働時間（同じ長さ）で按分。s3 は休み
    expect(s1.target).toBeCloseTo(1.5, 6);
    const s3 = staffDay(d, day, 's3');
    expect(s3).toMatchObject({ off: true, count: 0, target: null, travel: 0, minutes: 0 });
  });

  it('欠勤：稼働時間帯から差し引き、終日なら目安は null。担当なしの日は空き', () => {
    const d = { ...selData(), absences: [{ id: 'ab', staffId: 's1', date: DATE, from: null, to: null, note: '' }] };
    const s1 = staffDay(d, dayPlanOf(d, DATE), 's1');
    expect(s1).toMatchObject({ off: false, slots: [], minutes: 0, target: null });
    expect(s1.absence?.id).toBe('ab');
    const half = { ...d, absences: [{ id: 'ab', staffId: 's1', date: DATE, from: '13:00', to: null, note: '' }] };
    expect(staffDay(half, dayPlanOf(half, DATE), 's1').slots).toEqual([{ start: '08:00', end: '13:00' }]);
    const none = { ...selData(), visits: selData().visits.map((v) => ({ ...v, staffId: null })) };
    const free = staffDay(none, dayPlanOf(none, DATE), 's1');
    expect(free.count).toBe(0);
    expect(free.bar.some((x) => x.state === 'free')).toBe(true);
    // 8〜20時は休み（残った訪問・移動を除く）。外は勤務外（PRD D82）
    expect(
      s1.bar
        .filter((x) => x.start >= 480 && x.start < 1200)
        .every((x) => x.state === 'rest' || x.state === 'visit' || x.state === 'travel'),
    ).toBe(true);
    expect(s1.bar.some((x) => x.state === 'visit')).toBe(true);
    expect(s1.bar.find((x) => x.start === 480)?.state).toBe('rest');
  });

  it('月の集計：件数・稼働時間・移動・種類・資格', () => {
    const d = selData();
    const days = [dayPlanOf(d, DATE), dayPlanOf(d, TUE)];
    const m = staffMonth(d, days, 's1');
    const first = staffDay(d, days[0]!, 's1');
    expect(m.count).toBe(2);
    expect(m.minutes).toBe(1200);
    expect(m.travel).toBe(first.travel);
    expect(m.workDays).toBe(2);
    expect(m.absenceDays).toBe(0);
    expect(m.types).toEqual([{ typeId: 'care', count: 2 }]);
    expect(m.qualifications).toEqual(['看護師', '介護福祉士']);
    expect(staffMonth(d, days, 's2').qualifications).toEqual([]);
  });
});

describe('選んだ利用者さん（clientDay・clientMonth）', () => {
  it('訪問の時刻・種類・担当、繰り返しの担当でない日は「代」、この回だけ変えた・取り消し・担当なしの印', () => {
    const d = selData();
    const c = clientDay(d, dayPlanOf(d, DATE), 'c1');
    expect(c.visits.map((v) => v.visitId)).toEqual([A, 'b', 'x']);
    // A は c（9:00〜10:00）のあとの移動の分だけ遅れる（lenient の時刻）
    expect(c.visits[0]).toMatchObject({ typeId: 'care', staffId: 's1' });
    expect(c.visits[0]!.start).toBeGreaterThan(hhmmToMinutes('10:00'));
    expect(c.visits[0]!.start).toBeLessThan(hhmmToMinutes('10:10'));
    // 繰り返しの担当は s2 なので s1 は代
    expect(c.visits[0]).toMatchObject({ substitute: true, edited: true, cancelled: false, unassigned: false });
    expect(c.visits[1]).toMatchObject({ start: hhmmToMinutes('14:00'), staffId: 's2', substitute: false });
    expect(c.visits[2]).toMatchObject({ cancelled: true, staffId: null, unassigned: false });
    const t = clientDay(d, dayPlanOf(d, TUE), 'c1');
    expect(t.visits[0]).toMatchObject({ staffId: null, unassigned: true });
  });

  it('月の集計：予定の回数・変更・取り消し・代わり・担当した人の内訳', () => {
    const d = selData();
    const m = clientMonth(d, [dayPlanOf(d, DATE), dayPlanOf(d, TUE)], 'c1');
    expect(m).toEqual({
      planned: 3,
      edited: 1,
      cancelled: 1,
      sameDay: 0,
      leave: 0,
      substitute: 1,
      byStaff: [
        { staffId: 's1', count: 1 },
        { staffId: 's2', count: 1 },
        { staffId: null, count: 1 },
      ],
    });
  });
});

describe('要対応（attentionList。版2）', () => {
  const st = (date: string, over: Partial<DayStatus>): DayStatus => ({
    date,
    count: 3,
    state: 'none',
    unassigned: 0,
    issues: new Map(),
    care: 0,
    changes: 0,
    absence: false,
    overSpan: [],
    needsCare: false,
    ...over,
  });
  const issues = (...kinds: ('unassigned' | 'off' | 'notAllowed' | 'late')[]) =>
    new Map(kinds.map((kind, i) => [`v${i}`, [{ kind, label: kind }]]));
  it('今日以降の、要対応の訪問（内訳つき）・未連絡の変更・拘束超（日付の順）', () => {
    const d = selData();
    const list = attentionList(
      d,
      [
        st('2026-10-21', { care: 2, issues: issues('unassigned', 'off'), changes: 1, state: 'changed' }),
        st('2026-10-20', { overSpan: ['s2'] }),
        st('2026-10-10', { care: 1, issues: issues('unassigned') }),
        st('2026-10-22', { absence: true }),
      ],
      '2026-10-12',
    );
    expect(list).toEqual([
      { date: '2026-10-20', kind: 'overSpan', count: 1, names: ['泉 二郎'], staffIds: ['s2'] },
      { date: '2026-10-21', kind: 'care', count: 2, names: ['担当なし 1', '担当が休み 1'] },
      { date: '2026-10-21', kind: 'changed', count: 1, names: [] },
    ]);
    expect(attentionCountByDate(list).get('2026-10-21')).toBe(2);
  });
  it('拘束が上限を超える人は要対応に名前つきで出る（手当てが必要には数えない）', () => {
    const d = selData();
    const s = st(DATE, { overSpan: ['s1'] });
    expect(attentionList(d, [s], DATE)).toEqual([
      { date: DATE, kind: 'overSpan', count: 1, names: ['青葉 一郎'], staffIds: ['s1'] },
    ]);
  });
});

describe('月を送ったときの日付（firstDayOf）', () => {
  it('その月の1日、今月なら今日', () => {
    expect(firstDayOf('2026-12', TODAY)).toBe('2026-12-01');
    expect(firstDayOf('2026-11', TODAY)).toBe(TODAY);
  });
});

describe('今月の準備（monthProgress。版2）', () => {
  it('今日以降の訪問の件数・担当が全部入った日・伝えた日・確定していない日・要対応', () => {
    const d0 = novData();
    const days = monthDates('2026-11').filter((x) => x >= TODAY && visitsOn(d0, x).some((v) => !v.cancelled));
    const count = days.reduce((m, x) => m + visitsOn(d0, x).filter((v) => !v.cancelled).length, 0);
    const p0 = monthProgress(d0, '2026-11', TODAY);
    expect(p0.visits).toBe(count);
    expect(p0.days).toBe(days.length);
    expect(p0.confirmed).toBe(0);
    expect(p0.unconfirmed).toEqual(days);

    const [a, b] = days;
    let d = confirmDay(d0, a!, dayProblemOf(d0, a!)!, 1);
    const v = visitsOn(d, b!).find((x) => x.staffId !== null)!;
    d = { ...d, visits: putVisits(d.visits, [{ ...v, staffId: null }]) };
    const p1 = monthProgress(d, '2026-11', TODAY);
    expect(p1.confirmed).toBe(1);
    expect(p1.unconfirmed).toEqual(days.filter((x) => x !== a));
    expect(p1.planned).toBe(p0.planned - (dayStatus(d0, b!).care === 0 ? 1 : 0));
    expect(p1.attention).toBeGreaterThanOrEqual(p0.attention + (dayStatus(d0, b!).care === 0 ? 1 : 0));
  });

  it('statusOf を渡すと日の状態をそれから引く・訪問の無い月は0', () => {
    const d0 = novData();
    const p = monthProgress(d0, '2026-11', TODAY, (date) => ({ ...dayStatus(d0, date), state: 'told' }));
    expect(p.confirmed).toBe(p.days);
    expect(p.unconfirmed).toEqual([]);
    expect(monthProgress({ ...d0, patterns: [] }, '2027-03', TODAY)).toEqual({
      visits: 0,
      days: 0,
      planned: 0,
      confirmed: 0,
      unconfirmed: [],
      attention: 0,
    });
  });
});

describe('最終勤務日・当日キャンセル（ADR-0015）', () => {
  it('最終勤務日の日は「最終」、後の日は休みに数えない。選んだ〈スタッフ〉の後の日は retired', () => {
    const d = { ...selData(), staff: selData().staff.map((s) => (s.id === 's3' ? { ...s, lastDay: DATE } : s)) };
    expect(dayMarks(d, DATE).lastDays).toEqual(['若林 三郎']);
    expect(dayMarks(d, DATE).off).toEqual(['若林 三郎']);
    expect(dayMarks(d, TUE).off).toEqual([]);
    expect(dayMarks(d, TUE).lastDays).toEqual([]);
    expect(staffDay(d, dayPlanOf(d, TUE), 's3').retired).toBe(true);
    expect(staffDay(d, dayPlanOf(d, DATE), 's3').retired).toBe(false);
  });

  it('〈利用者さん〉の月の集計に当日キャンセルの回数', () => {
    const d = selData();
    const x = {
      ...d,
      visits: d.visits.map((v) => (v.id === 'x' ? { ...v, cancelKind: 'sameDay' as const } : v)),
    };
    const sum = clientMonth(x, [dayPlanOf(x, DATE)], 'c1');
    expect(sum.cancelled).toBe(1);
    expect(sum.sameDay).toBe(1);
    expect(clientDay(x, dayPlanOf(x, DATE), 'c1').visits.find((v) => v.visitId === 'x')?.sameDay).toBe(true);
    expect(clientMonth(d, [dayPlanOf(d, DATE)], 'c1').sameDay).toBe(0);
  });
});

describe('monthShown（PRD D268）', () => {
  it('?ym= が正しければその月、無い・正しくなければ選んでいる日付の月', () => {
    expect(monthShown('?ym=2026-11', '2026-10-21')).toBe('2026-11');
    expect(monthShown('?ym=2026-11&do=batch', '2026-10-21')).toBe('2026-11');
    expect(monthShown('', '2026-10-21')).toBe('2026-10');
    expect(monthShown('?ym=2026-13', '2026-10-21')).toBe('2026-10');
    expect(monthShown('?ym=abc', '2026-10-21')).toBe('2026-10');
  });
});
