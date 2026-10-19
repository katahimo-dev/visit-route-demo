import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import type { Pattern, VisitType } from '../contracts/documents';
import type { SolveResult } from '../contracts/problem';
import { addDays, hhmmToMinutes } from '../domain/time';
import { compile } from '../matching';
import { client, DATE, makeData, staff, visit } from '../matching/fixtures';
import { applyPatterns } from '../patterns';
import { createDemoData, scoreRulesOf } from '../seed';
import {
  addMonths,
  applyDayRun,
  attentionList,
  batchTargets,
  calendarWeeks,
  clientDay,
  clientMonth,
  currentRuleKeys,
  type DayStatus,
  dayMarks,
  dayPlanOf,
  dayStatus,
  expandMonth,
  expandMonthVisits,
  firstDayOf,
  isYm,
  monthDates,
  monthProgress,
  planRunOf,
  planStale,
  ruleSetKey,
  rulesStale,
  staffDay,
  staffMonth,
  ymOf,
} from './month';
import { addPresetFromRules, patchPreset, setScorePreset } from './presets';
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

describe('作った条件が変わったか（rulesStale。PRD D161）', () => {
  const keysOf = (d: DemoData) => currentRuleKeys(d.rules, d.presets);
  /** 点数の基準のプリセットで案を作る（月のまとめて作る・作り直しと同じ条件） */
  const build = (d: DemoData, date: string) => withPlan(d, date);
  const firstDay = (d: DemoData) => batchTargets(d, '2026-11', TODAY, 'empty')[0]!;
  const setWeight = (d: DemoData, presetId: string, weight: number): DemoData =>
    patchPreset(d, presetId, {
      weights: { ...d.presets.find((p) => p.id === presetId)!.weights, wait: { weight, hard: false } },
    });

  it('基準のプリセットで作った案：いまの条件の重み・名前を変えても、プリセットが同じなら変わったにしない', () => {
    const d0 = novData();
    const a = firstDay(d0);
    const d = build(d0, a);
    expect(rulesStale(d, a, keysOf(d))).toBe(false);
    const moved = { ...d, rules: d.rules.map((r, i) => (i === 1 ? { ...r, weight: r.weight + 1.5 } : r)) };
    expect(rulesStale(moved, a, keysOf(moved))).toBe(false);
    const renamed = { ...d, rules: d.rules.map((r) => ({ ...r, label: `${r.label}（改）` })) };
    expect(rulesStale(renamed, a, keysOf(renamed))).toBe(false);
  });
  it('初期状態（いまの条件が標準と同じ重み）で標準の重みを変える：変わった。基準で作り直すと消える', () => {
    const d0 = novData();
    const a = firstDay(d0);
    let d = build(d0, a);
    d = setWeight(d, 'standard', 1);
    expect(rulesStale(d, a, keysOf(d))).toBe(true);
    d = build(d, a);
    expect(rulesStale(d, a, keysOf(d))).toBe(false);
  });
  it('条件を消した：変わった', () => {
    const d0 = novData();
    const a = firstDay(d0);
    const d = build(d0, a);
    const removed = { ...d, rules: d.rules.slice(1) };
    expect(rulesStale(removed, a, keysOf(removed))).toBe(true);
  });
  it('点数の基準を切り替えただけでは変わったにしない', () => {
    const d0 = novData();
    const a = firstDay(d0);
    const d = build(d0, a);
    const other = d.presets.find((p) => p.id !== d.scorePresetId)!;
    const switched = setScorePreset(d, other.id);
    expect(rulesStale(switched, a, keysOf(switched))).toBe(false);
  });
  it('自動作成（標準）→ 標準の重みを変える → いまの条件で作り直して同じ案になる：記録を使い回しても presetId が今のものになり消える（PR #40 の再レビュー）', () => {
    const d0 = novData();
    const a = firstDay(d0);
    let d = build(d0, a);
    expect(planRunOf(d, a)?.presetId).toBe('standard');
    d = setWeight(d, 'standard', 1);
    expect(rulesStale(d, a, keysOf(d))).toBe(true);
    // いまの条件（古い標準の重み）で解いて同じ結果：addRun は同じ記録を使い回す
    const run = planRunOf(d, a)!;
    const before = (d.aiRuns[a] ?? []).length;
    d = applyDayRun(d, a, {
      rules: d.rules,
      result: resultOf(d, a),
      createdAt: 2,
      inputKey: run.inputKey!,
      onlyEmpty: false,
    });
    expect((d.aiRuns[a] ?? []).length).toBe(before);
    expect(planRunOf(d, a)?.presetId).toBeNull();
    expect(rulesStale(d, a, keysOf(d))).toBe(false);
  });
  it('いまの条件（プリセットに無い重み）で作った案のあとに重みを変えた：変わった。基準で作り直すと消える', () => {
    const d0 = novData();
    const a = firstDay(d0);
    const custom = d0.rules.map((r) => (r.type === 'wait' ? { ...r, weight: 4.5 } : r));
    const d1 = { ...d0, rules: custom };
    let d = applyDayRun(d1, a, {
      rules: custom,
      result: resultOf(d1, a),
      createdAt: 1,
      inputKey: problemKey(compile({ ...d1, rules: custom }, a)),
      onlyEmpty: false,
    });
    expect(planRunOf(d, a)?.presetId).toBeNull();
    expect(rulesStale(d, a, keysOf(d))).toBe(false);
    // プリセットを変えても、いまの条件が変わらない限り変わったにしない
    const edited = setWeight(d, 'standard', 1);
    expect(rulesStale(edited, a, keysOf(edited))).toBe(false);
    d = { ...d, rules: d.rules.map((r) => (r.type === 'wait' ? { ...r, weight: 1 } : r)) };
    expect(rulesStale(d, a, keysOf(d))).toBe(true);
    d = build(d, a);
    expect(rulesStale(d, a, keysOf(d))).toBe(false);
  });
  it('「プリセットとして保存」→ 基準にする → 作る → 標準を変える → 作り直す：作り直すと必ず消える（PR #40 のレビュー）', () => {
    let d = novData();
    d = addPresetFromRules(d, 'マイ');
    const my = d.presets.at(-1)!.id;
    d = setScorePreset(d, my);
    const a = firstDay(d);
    d = build(d, a);
    expect(rulesStale(d, a, keysOf(d))).toBe(false);
    // 標準の重みを変えても、作った重みは「マイ」に残っている
    d = setWeight(d, 'standard', 1);
    expect(rulesStale(d, a, keysOf(d))).toBe(false);
    d = build(d, a);
    expect(rulesStale(d, a, keysOf(d))).toBe(false);
    // 基準の「マイ」を変えると変わった。作り直すと消える
    d = setWeight(d, my, 0.5);
    expect(rulesStale(d, a, keysOf(d))).toBe(true);
    d = build(d, a);
    expect(rulesStale(d, a, keysOf(d))).toBe(false);
  });
  it('案が無い・記録が無い日は判定しない', () => {
    const d = novData();
    const a = firstDay(d);
    expect(rulesStale(d, a, keysOf(d))).toBe(false);
  });
  it('ruleSetKey：必須にできない型の必須は数えない', () => {
    const r = { id: 'x', type: 'wait' as const, label: '待ち', weight: 3, hard: false };
    expect(ruleSetKey([r])).toBe(ruleSetKey([{ ...r, hard: true }]));
    expect(ruleSetKey([r])).not.toBe(ruleSetKey([{ ...r, weight: 2 }]));
  });
});

describe('日の状態（dayStatus）', () => {
  it('案なし → 案あり → 確定済み → 未確定の変更あり', () => {
    const d0 = novData();
    const [a] = batchTargets(d0, '2026-11', TODAY, 'empty');
    const s0 = dayStatus(d0, a!);
    expect(s0.state).toBe('none');
    expect(s0.count).toBe(d0.visits.filter((v) => v.date === a && !v.cancelled).length);
    // 案の無い日は注意（黄）で、要対応（赤）にしない（PRD D228）
    expect(s0.needsCare).toBe(false);

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
  it('expandMonthVisits は expandMonth と同じ訪問・件数（定期パターン・訪問・〈利用者さん〉だけを読む）', () => {
    const d0 = createDemoData('2026-10-16');
    const full = expandMonth(d0, '2026-12', '2026-12-10');
    const only = expandMonthVisits(
      { patterns: d0.patterns, visits: d0.visits, clients: d0.clients },
      '2026-12',
      '2026-12-10',
    );
    expect(only.added).toBe(full.added);
    expect(only.visits).toEqual(full.data.visits);
    expect(expandMonthVisits(full.data, '2026-12', '2026-12-10')).toEqual({ visits: full.data.visits, added: 0 });
  });
});

// ---- 月間の改定（D53〜D55） ----

const CARE: VisitType = { id: 'care', name: '介護', color: 0, durationMinutes: 60, requirements: [], note: '' };
const REHAB: VisitType = { ...CARE, id: 'rehab', name: 'リハビリ', color: 3 };
const TUE = addDays(DATE, 1);
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
  usualStaffId: null,
  note: '',
};

/**
 * 月曜（DATE）：s1・s2（8:00〜18:00）、s3（月曜は休み）。c1 の a（10:00 介護。パターンの回・この回だけ変えた）・
 * b（14:00 リハビリ）・x（取り消し）、c2 の c（9:00 介護）。今の案は s1＝[c, a]、s2＝[b]。c1 のいつもの担当は s1
 */
function selData() {
  const at = (id: string, c: string, hhmm: string, over = {}) =>
    visit(id, c, hhmm, hhmm, { windowKind: 'fixed', durationMinutes: 60, ...over });
  const visits = [
    at('a', 'c1', '10:00', { typeId: 'care', pattern: { id: 'p1', date: DATE, edited: true } }),
    at('b', 'c1', '14:00', { typeId: 'rehab' }),
    at('x', 'c1', '16:00', { cancelled: true, typeId: 'care' }),
    at('c', 'c2', '09:00', { typeId: 'care' }),
    at('t1', 'c1', '10:00', { date: TUE, typeId: 'care' }),
  ];
  const d = makeData({
    staff: [
      staff('s1', 38.26, 140.87, { name: '青葉 一郎', traits: { license: ['看護師', '介護福祉士'] } }),
      staff('s2', 38.27, 140.88, { name: '泉 二郎' }),
      staff('s3', 38.27, 140.88, { name: '若林 三郎', workDays: [2, 3] }),
    ],
    clients: [
      client('c1', 38.261, 140.871, { displayName: '天文台', usualStaffId: 's1' }),
      client('c2', 38.262, 140.872, { displayName: '城跡' }),
    ],
    visits,
    visitTypes: [CARE, REHAB],
    patterns: [PATTERN],
  });
  const plan = withPlan(d, DATE);
  const routes = { s1: ['c', 'a'], s2: ['b'] };
  return {
    ...plan,
    aiPlans: { [DATE]: { ...plan.aiPlans[DATE]!, routes } },
  };
}

describe('数える案（dayPlanOf）', () => {
  it('今の案があればその列、無ければ確定した割当（開始の順）、どちらも無ければ案なし', () => {
    const d = selData();
    const p = dayPlanOf(d, DATE);
    expect(p.source).toBe('plan');
    expect(p.routes).toEqual({ s1: ['c', 'a'], s2: ['b'] });
    const confirmed = { ...d, aiPlans: {}, manualPlans: { [DATE]: { s1: ['a', 'c'], __none: ['b'] } } };
    const q = dayPlanOf(confirmed, DATE);
    expect(q.source).toBe('confirmed');
    expect(q.routes).toEqual({ s1: ['c', 'a'] });
    expect(dayPlanOf({ ...d, aiPlans: {} }, DATE).source).toBeNull();
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
    expect(s1.noPlan).toBe(false);
    expect(s1.count).toBe(2);
    expect(s1.travel).toBeGreaterThan(0);
    expect(s1.minutes).toBe(600);
    expect(s1.types).toEqual([{ typeId: 'care', count: 2 }]);
    // 目安：担当できる訪問 3件を s1・s2 の稼働時間（同じ長さ）で按分。s3 は休み
    expect(s1.target).toBeCloseTo(1.5, 6);
    const s3 = staffDay(d, day, 's3');
    expect(s3).toMatchObject({ off: true, count: 0, target: null, travel: 0, minutes: 0 });
  });

  it('欠勤：稼働時間帯から差し引き、終日なら目安は null。案の無い日は noPlan', () => {
    const d = { ...selData(), absences: [{ id: 'ab', staffId: 's1', date: DATE, from: null, to: null, note: '' }] };
    const s1 = staffDay(d, dayPlanOf(d, DATE), 's1');
    expect(s1).toMatchObject({ off: false, slots: [], minutes: 0, target: null });
    expect(s1.absence?.id).toBe('ab');
    const half = { ...d, absences: [{ id: 'ab', staffId: 's1', date: DATE, from: '13:00', to: null, note: '' }] };
    expect(staffDay(half, dayPlanOf(half, DATE), 's1').slots).toEqual([{ start: '08:00', end: '13:00' }]);
    const none = { ...selData(), aiPlans: {} };
    expect(staffDay(none, dayPlanOf(none, DATE), 's1')).toMatchObject({ noPlan: true, count: 0 });
    // 案の無い日は勤務内を「案なし」にし、空きにしない（PRD D75）。終日の欠勤は休み（残っている訪問は訪問・移動で出す）
    const np = staffDay(none, dayPlanOf(none, DATE), 's1');
    expect(np.noPlan).toBe(true);
    // 問題が作れなかった日（problem＝null）も、訪問があれば案なし（週の表と同じ）
    const broken = staffDay(none, { date: DATE, problem: null, source: null, routes: {} }, 's1');
    expect(broken.noPlan).toBe(true);
    expect(broken.bar.some((x) => x.state === 'free')).toBe(false);
    expect(np.bar.some((x) => x.state === 'noplan')).toBe(true);
    expect(np.bar.some((x) => x.state === 'free')).toBe(false);
    expect(s1.noPlan).toBe(false);
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
  it('訪問の時刻・種類・担当、いつもの担当でない日は「代」、この回だけ変えた・取り消しの印', () => {
    const d = selData();
    const c = clientDay(d, dayPlanOf(d, DATE), 'c1');
    expect(c.noPlan).toBe(false);
    expect(c.visits.map((v) => v.visitId)).toEqual(['a', 'b', 'x']);
    // a は c（9:00〜10:00）のあとの移動の分だけ遅れる（lenient の時刻）
    expect(c.visits[0]).toMatchObject({ typeId: 'care', staffId: 's1' });
    expect(c.visits[0]!.start).toBeGreaterThan(hhmmToMinutes('10:00'));
    expect(c.visits[0]!.start).toBeLessThan(hhmmToMinutes('10:10'));
    expect(c.visits[0]).toMatchObject({ substitute: false, edited: true, cancelled: false, unassigned: false });
    expect(c.visits[1]).toMatchObject({ start: hhmmToMinutes('14:00'), staffId: 's2', substitute: true });
    expect(c.visits[2]).toMatchObject({ cancelled: true, staffId: null, unassigned: false });
    // 案はあるが列に無い訪問は入らない。案の無い日は noPlan
    const drop = { ...d, aiPlans: { [DATE]: { ...d.aiPlans[DATE]!, routes: { s1: ['c', 'a'] } } } };
    expect(clientDay(drop, dayPlanOf(drop, DATE), 'c1').visits[1]).toMatchObject({ staffId: null, unassigned: true });
    const t = clientDay(d, dayPlanOf(d, TUE), 'c1');
    expect(t.noPlan).toBe(true);
    expect(t.visits[0]).toMatchObject({ staffId: null, unassigned: false });
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

describe('要対応（attentionList）', () => {
  const st = (date: string, over: Partial<DayStatus>): DayStatus => ({
    date,
    count: 3,
    state: 'plan',
    unassigned: 0,
    absence: false,
    absentLeft: 0,
    overSpan: [],
    hundred: null,
    hard: 0,
    stale: false,
    needsCare: false,
    ...over,
  });
  it('今日以降の、入らない・条件が変わった・欠勤のある日（日付の順）', () => {
    const d = selData();
    const data = { ...d, absences: [{ id: 'ab', staffId: 's2', date: '2026-10-20', from: null, to: null, note: '' }] };
    const list = attentionList(
      data,
      [
        st('2026-10-21', { unassigned: 2, stale: true }),
        st('2026-10-20', { absence: true }),
        st('2026-10-10', { unassigned: 1 }),
        st('2026-10-22', {}),
      ],
      '2026-10-12',
    );
    expect(list).toEqual([
      { date: '2026-10-20', kind: 'absence', count: 1, names: ['泉 二郎'] },
      { date: '2026-10-21', kind: 'unassigned', count: 2, names: [] },
      { date: '2026-10-21', kind: 'stale', count: 1, names: [] },
    ]);
  });

  it('同じ人のその日の欠勤が2件（時間帯が2つ）でも、欠勤の人数は1人・名前は1回', () => {
    const d = selData();
    const data = {
      ...d,
      absences: [
        { id: 'ab1', staffId: 's2', date: '2026-10-20', from: '09:00', to: '10:00', note: '' },
        { id: 'ab2', staffId: 's2', date: '2026-10-20', from: '15:00', to: null, note: '' },
      ],
    };
    expect(attentionList(data, [st('2026-10-20', { absence: true })], '2026-10-12')).toEqual([
      { date: '2026-10-20', kind: 'absence', count: 1, names: ['泉 二郎'] },
    ]);
  });
});

describe('月を送ったときの日付（firstDayOf）', () => {
  it('その月の1日、今月なら今日', () => {
    expect(firstDayOf('2026-12', TODAY)).toBe('2026-12-01');
    expect(firstDayOf('2026-11', TODAY)).toBe(TODAY);
  });
});

describe('今月の準備（monthProgress）', () => {
  it('今日以降の訪問の件数・案のある日・確定した日・確定していない日・要対応', () => {
    const d0 = novData();
    const future = (d: DemoData) =>
      d.visits.filter((v) => v.date >= TODAY && v.date.startsWith('2026-11') && !v.cancelled);
    const days = [...new Set(future(d0).map((v) => v.date))].sort();
    const p0 = monthProgress(d0, '2026-11', TODAY);
    expect(p0.visits).toBe(future(d0).length);
    expect(p0.days).toBe(days.length);
    expect(p0.planned).toBe(0);
    expect(p0.confirmed).toBe(0);
    expect(p0.unconfirmed).toEqual(days);
    expect(p0.attention).toBe(0);

    // 2日に案（1件だけ入る案）、うち1日を確定。今日より前の日の案は数えない
    const [a, b] = days;
    const before = d0.visits.find((v) => v.date < TODAY && v.date.startsWith('2026-11') && !v.cancelled)!.date;
    let d = withPlan(withPlan(withPlan(d0, a!), b!), before);
    d = { ...d, manualPlans: { ...d.manualPlans, [a!]: d.aiPlans[a!]!.routes } };
    const p1 = monthProgress(d, '2026-11', TODAY);
    expect(p1.planned).toBe(2);
    expect(p1.confirmed).toBe(1);
    expect(p1.unconfirmed).toEqual(days.filter((x) => x !== a));
    // 入らない訪問がある日が2日（a・b）
    expect(p1.attention).toBe(2);
    // 条件が変わった日は staleOf で数える
    expect(monthProgress(d, '2026-11', TODAY, (x) => x === b).attention).toBe(3);
  });

  it('statusOf を渡すと日の状態をそれから引く・訪問の無い月は0', () => {
    const d0 = novData();
    const p = monthProgress(d0, '2026-11', TODAY, undefined, (date) => ({
      ...dayStatus(d0, date),
      state: 'confirmed',
    }));
    expect(p.confirmed).toBe(p.days);
    expect(p.unconfirmed).toEqual([]);
    expect(monthProgress(d0, '2027-03', TODAY)).toEqual({
      visits: 0,
      days: 0,
      planned: 0,
      confirmed: 0,
      unconfirmed: [],
      attention: 0,
    });
  });
});

describe('最終勤務日・拘束の上限・当日キャンセル（ADR-0015）', () => {
  it('最終勤務日の日は「最終」、後の日は休みに数えない。選んだ〈スタッフ〉の後の日は retired', () => {
    const d = { ...selData(), staff: selData().staff.map((s) => (s.id === 's3' ? { ...s, lastDay: DATE } : s)) };
    // s3 は月曜は勤務なし（休み）で、その日が最終勤務日
    expect(dayMarks(d, DATE).lastDays).toEqual(['若林 三郎']);
    expect(dayMarks(d, DATE).off).toEqual(['若林 三郎']);
    // 翌日（もともと勤務日）は最終勤務日の後：休みにも数えない
    expect(dayMarks(d, TUE).off).toEqual([]);
    expect(dayMarks(d, TUE).lastDays).toEqual([]);
    expect(staffDay(d, dayPlanOf(d, TUE), 's3').retired).toBe(true);
    expect(staffDay(d, dayPlanOf(d, DATE), 's3').retired).toBe(false);
  });

  it('拘束が上限を超える人は要対応に名前つきで出る（手当てが必要には数えない）', () => {
    const d = selData();
    const s = dayStatus(d, DATE, { overSpan: ['s1'] });
    expect(s.overSpan).toEqual(['s1']);
    expect(s.needsCare).toBe(false);
    expect(attentionList(d, [s], DATE)).toEqual([
      { date: DATE, kind: 'overSpan', count: 1, names: ['青葉 一郎'], staffIds: ['s1'] },
    ]);
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

describe('入り切りで計算が変わった日だけ「条件が変わった」（ADR-0028。PRD D214）', () => {
  const keysOf = (d: DemoData) => currentRuleKeys(d.rules, d.presets);
  const firstDay = (d: DemoData) => batchTargets(d, '2026-11', TODAY, 'empty')[0]!;
  const withFeatures = (d: DemoData, features: DemoData['org']['features']): DemoData => ({
    ...d,
    org: { ...d.org, features },
  });
  /** 条件が変わったか（月の要対応と同じ：問題の違い（planStale）か、作った条件がもう無い（rulesStale）） */
  const stale = (d: DemoData, date: string) => planStale(d, d, date) || rulesStale(d, date, keysOf(d));
  /** その日に訪問がある〈利用者さん〉の1人を、先頭の〈スタッフ〉だけに限る */
  const limitOne = (d: DemoData, date: string): DemoData => {
    const cid = d.visits.find((v) => v.date === date && !v.cancelled)!.clientId;
    return {
      ...d,
      clients: d.clients.map((c) => (c.id === cid ? { ...c, allowedStaffIds: [d.staff[0]!.id] } : c)),
    };
  };

  it('すべて入で作った記録は calcFeatures を書かず（今と同じ形）、計算に効かない機能を切っても変わらない', () => {
    const d0 = novData();
    const a = firstDay(d0);
    const d = withPlan(d0, a);
    expect(planRunOf(d, a)!.calcFeatures).toBeUndefined();
    expect(stale(d, a)).toBe(false);
    const off = withFeatures(d, { mail: false, clientLeave: false, rules: false });
    expect(stale(off, a)).toBe(false);
  });

  it('担当を限るを切っても、限った人がいない（問題が変わらない）日は変わったにしない', () => {
    const d0 = novData();
    const a = firstDay(d0);
    const d = withFeatures(withPlan(d0, a), { allowedStaff: false });
    expect(stale(d, a)).toBe(false);
    expect(batchTargets(d, '2026-11', TODAY, 'stale')).toEqual([]);
  });

  it('担当を限るを切って問題が変わる日は変わった（planStale）。切ったまま作り直すと消え、記録に calcFeatures が残る', () => {
    const d0 = novData();
    const a = firstDay(d0);
    let d = withPlan(limitOne(d0, a), a);
    expect(stale(d, a)).toBe(false);
    d = withFeatures(d, { allowedStaff: false });
    expect(planStale(d, d, a)).toBe(true);
    expect(rulesStale(d, a, keysOf(d))).toBe(false);
    expect(batchTargets(d, '2026-11', TODAY, 'stale')).toEqual([a]);
    d = withPlan(d, a);
    expect(planRunOf(d, a)!.calcFeatures).toEqual({ allowedStaff: false });
    expect(stale(d, a)).toBe(false);
    // 入れ直すと、また問題が変わる
    d = withFeatures(d, {});
    expect(stale(d, a)).toBe(true);
  });

  it('記録の calcFeatures がいまと違っても、問題が同じなら変わったにしない（使い回しで同じ記録を返しても残らない）', () => {
    const d0 = novData();
    const a = firstDay(d0);
    const d = withFeatures(withPlan(withFeatures(d0, { compat: false }), a), {});
    expect(planRunOf(d, a)!.calcFeatures).toEqual({ compat: false });
    // novData の相性は計算に効く（相性の表がある）なら問題が変わる。どちらでも rulesStale は入り切りを見ない
    expect(rulesStale(d, a, keysOf(d))).toBe(false);
  });
});
