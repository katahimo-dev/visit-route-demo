import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import type { SolveResult } from '../contracts/problem';
import { compile } from '../matching';
import { applyPatterns } from '../patterns';
import { createDemoData, scoreRulesOf } from '../seed';
import {
  addMonths,
  applyDayRun,
  batchTargets,
  calendarWeeks,
  dayStatus,
  expandMonth,
  isYm,
  monthDates,
  planStale,
  ymOf,
} from './month';
import { problemKey } from './runs';

const TODAY = '2026-11-10';

/** 11月いっぱいの訪問を展開したデータ */
function novData(): DemoData {
  const d = createDemoData('2026-11-02');
  const c = applyPatterns(d, { from: '2026-11-01', to: '2026-11-30' }, '2026-11-01');
  return { ...d, visits: c.visits };
}

const resultOf = (d: DemoData, date: string): SolveResult => {
  const ids = d.visits.filter((v) => v.date === date && !v.cancelled).map((v) => v.id);
  const sid = d.staff[0]!.id;
  return {
    routes: { [sid]: ids.slice(0, 1) },
    unassigned: ids.slice(1),
    score: 10,
    seed: d.seed,
    iterations: 1,
    stopped: false,
  };
};

/** その日に案（と記録）を書く。inputKey はいまのデータの基準の条件の問題 */
function withPlan(d: DemoData, date: string, onlyEmpty = false): DemoData {
  const rules = scoreRulesOf(d);
  const inputKey = problemKey(compile({ ...d, rules }, date));
  return applyDayRun(d, date, { rules, result: resultOf(d, date), createdAt: 1, inputKey, onlyEmpty });
}

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

describe('月まとめ作成の対象（batchTargets）', () => {
  it("'empty'：今日以降・訪問がある・確定していない・案の無い日", () => {
    const d0 = novData();
    const all = batchTargets(d0, '2026-11', TODAY, 'empty');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((x) => x >= TODAY && ymOf(x) === '2026-11')).toBe(true);
    // どの日も訪問がある
    expect(all.every((x) => d0.visits.some((v) => v.date === x && !v.cancelled))).toBe(true);
    const [a, b, c] = all;
    // 案のある日・確定した日は除く
    let d = withPlan(d0, a!);
    d = { ...d, manualPlans: { ...d.manualPlans, [b!]: {} } };
    const next = batchTargets(d, '2026-11', TODAY, 'empty');
    expect(next).not.toContain(a);
    expect(next).not.toContain(b);
    expect(next).toContain(c);
    // すべて取り消した日は除く
    const cancelled = { ...d, visits: d.visits.map((v) => (v.date === c ? { ...v, cancelled: true } : v)) };
    expect(batchTargets(cancelled, '2026-11', TODAY, 'empty')).not.toContain(c);
  });

  it("'all'：案があっても確定していなければ対象。確定した日・今日より前は対象外", () => {
    const d0 = novData();
    const [a, b] = batchTargets(d0, '2026-11', TODAY, 'empty');
    let d = withPlan(d0, a!);
    d = { ...d, manualPlans: { ...d.manualPlans, [b!]: {} } };
    const all = batchTargets(d, '2026-11', TODAY, 'all');
    expect(all).toContain(a);
    expect(all).not.toContain(b);
    expect(all.every((x) => x >= TODAY)).toBe(true);
  });

  it("'stale'：案を作ったあとに訪問が変わった日だけ", () => {
    const d0 = novData();
    const [a, b] = batchTargets(d0, '2026-11', TODAY, 'empty');
    let d = withPlan(withPlan(d0, a!), b!);
    expect(batchTargets(d, '2026-11', TODAY, 'stale')).toEqual([]);
    expect(planStale(d, d, a!)).toBe(false);
    // a の訪問の所要を変える
    const target = d.visits.find((v) => v.date === a && !v.cancelled)!;
    d = {
      ...d,
      visits: d.visits.map((v) => (v.id === target.id ? { ...v, durationMinutes: v.durationMinutes + 15 } : v)),
    };
    expect(planStale(d, d, a!)).toBe(true);
    expect(batchTargets(d, '2026-11', TODAY, 'stale')).toEqual([a]);
  });
});

describe('日の状態（dayStatus）', () => {
  it('案なし → 案あり → 確定済み → 未確定の変更あり', () => {
    const d0 = novData();
    const [a] = batchTargets(d0, '2026-11', TODAY, 'empty');
    const s0 = dayStatus(d0, a!);
    expect(s0.state).toBe('none');
    expect(s0.count).toBe(d0.visits.filter((v) => v.date === a && !v.cancelled).length);
    expect(s0.needsCare).toBe(true);

    const d1 = withPlan(d0, a!);
    const s1 = dayStatus(d1, a!, { hundred: 80, hard: 0, stale: false });
    expect(s1.state).toBe('plan');
    expect(s1.hundred).toBe(80);
    expect(s1.unassigned).toBe(s0.count - 1);
    expect(s1.needsCare).toBe(s1.unassigned > 0);

    const plan = d1.aiPlans[a!]!;
    const d2 = { ...d1, manualPlans: { ...d1.manualPlans, [a!]: plan.routes } };
    expect(dayStatus(d2, a!).state).toBe('confirmed');
    const sid = d1.staff[1]!.id;
    const d3 = { ...d1, manualPlans: { ...d1.manualPlans, [a!]: { [sid]: Object.values(plan.routes).flat() } } };
    expect(dayStatus(d3, a!).state).toBe('diff');
  });

  it('欠勤の印・案が無い日は点数を出さない・訪問の無い日は手当て不要', () => {
    const d0 = novData();
    const [a] = batchTargets(d0, '2026-11', TODAY, 'empty');
    const d = {
      ...d0,
      absences: [{ id: 'ab1', staffId: d0.staff[0]!.id, date: a!, from: null, to: null, note: '' }],
    };
    const s = dayStatus(d, a!, { hundred: 90, stale: true });
    expect(s.absence).toBe(true);
    expect(s.hundred).toBeNull();
    expect(s.stale).toBe(false);
    const empty = dayStatus(d, '2026-12-31');
    expect(empty.count).toBe(0);
    expect(empty.needsCare).toBe(false);
  });
});

describe('案を書く（applyDayRun）', () => {
  it('今の案（pins なし・runId 付き）と記録を1件。同じ結果なら記録は増えない', () => {
    const d0 = novData();
    const [a] = batchTargets(d0, '2026-11', TODAY, 'empty');
    const d1 = withPlan(d0, a!);
    const plan = d1.aiPlans[a!]!;
    expect(plan.pins).toEqual({});
    expect(plan.generated.routes).toEqual(plan.routes);
    expect(d1.aiRuns[a!]).toHaveLength(1);
    expect(plan.runId).toBe(d1.aiRuns[a!]![0]!.id);
    expect(d1.aiRuns[a!]![0]!.label).toBe('標準');
    const d2 = withPlan(d1, a!);
    expect(d2.aiRuns[a!]).toHaveLength(1);
  });

  it('「まだ案の無い日だけ」で案がすでにあれば今の案は変えず記録だけ足す', () => {
    const d0 = novData();
    const [a] = batchTargets(d0, '2026-11', TODAY, 'empty');
    const d1 = withPlan(d0, a!);
    const rules = scoreRulesOf(d1);
    const other: SolveResult = { ...resultOf(d1, a!), routes: {}, score: 99 };
    const d2 = applyDayRun(d1, a!, { rules, result: other, createdAt: 2, inputKey: 'k', onlyEmpty: true });
    expect(d2.aiPlans[a!]).toBe(d1.aiPlans[a!]);
    expect(d2.aiRuns[a!]).toHaveLength(2);
    const d3 = applyDayRun(d1, a!, { rules, result: other, createdAt: 2, inputKey: 'k', onlyEmpty: false });
    expect(d3.aiPlans[a!]!.score).toBe(99);
  });
});

describe('月の訪問の展開（expandMonth）', () => {
  it('その月の今日以降だけ展開し、2回目は増えない', () => {
    const d0 = createDemoData('2026-10-16');
    const { data: d1, added } = expandMonth(d0, '2026-12', '2026-12-10');
    expect(added).toBeGreaterThan(0);
    const dec = d1.visits.filter((v) => ymOf(v.date) === '2026-12');
    expect(dec.every((v) => v.date >= '2026-12-10')).toBe(true);
    expect(dec).toHaveLength(added);
    const again = expandMonth(d1, '2026-12', '2026-12-10');
    expect(again.added).toBe(0);
    expect(again.data).toBe(d1);
  });
});
