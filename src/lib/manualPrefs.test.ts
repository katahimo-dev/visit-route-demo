import { describe, expect, it } from 'vitest';
import type { AiPlan, DemoData, ManualPrefs } from '../contracts/data';
import { compile, prefKey, withManualPrefs } from '../matching';
import { client, DATE, makeData, rule, staff, visit } from '../matching/fixtures';
import { solve } from '../solver';
import {
  applyFutureAssigned,
  forgetManualPref,
  futureAssigned,
  patchManualPrefs,
  prefDatesText,
  prefWhenText,
  recordManualPref,
  restoreManualPref,
  samePlanEdit,
  trimManualPrefs,
  undoPrefExtras,
} from './manualPrefs';
import { applyDayRun, planStale } from './month';
import { addRun, problemKey } from './runs';

const NEXT = '2026-10-19';
const NEXT2 = '2026-10-26';

/** 2人・〈利用者さん〉1人の毎週月曜 9:00〜10:00 の訪問（今週・来週・再来週） */
function data(): DemoData {
  return makeData({
    staff: [staff('s1', 38.26, 140.87), staff('s2', 38.29, 140.9)],
    clients: [client('c1', 38.27, 140.88)],
    visits: [
      visit('v1', 'c1', '09:00', '10:00'),
      visit('v2', 'c1', '09:00', '10:00', { date: NEXT }),
      visit('v3', 'c1', '09:00', '10:00', { date: NEXT2 }),
    ],
    rules: [rule('w', 'wait', 3)],
  });
}

function plan(date: string, routes: Record<string, string[]>): AiPlan {
  return {
    date,
    createdAt: 1,
    seed: 1,
    iterations: 1,
    routes,
    unassigned: [],
    score: 0,
    stopped: false,
    rules: [rule('w', 'wait', 3)],
    generated: { routes, unassigned: [], score: 0 },
    pins: {},
  };
}

describe('記憶を書く・消す', () => {
  const v = visit('v1', 'c1', '09:00', '10:00');
  it('同じキーは上書き（最新だけ）', () => {
    const a = recordManualPref({}, v, 's1', 1);
    const b = recordManualPref(a, { ...v, date: NEXT }, 's2', 2);
    expect(b).toEqual({ [prefKey(v)]: { staffId: 's2', updatedAt: 2 } });
  });
  it('上限を超えたら updatedAt の古い順に消す', () => {
    const many: ManualPrefs = {};
    for (let i = 0; i < 5; i++) many[`k${i}`] = { staffId: 's1', updatedAt: i };
    expect(Object.keys(trimManualPrefs(many, 3)).sort()).toEqual(['k2', 'k3', 'k4']);
    expect(trimManualPrefs(many, 5)).toBe(many);
    // 2000件を超えると古いものから
    const full: ManualPrefs = {};
    for (let i = 0; i < 2000; i++) full[`k${i}`] = { staffId: 's1', updatedAt: i + 10 };
    const next = recordManualPref(full, v, 's2', 99999);
    expect(Object.keys(next)).toHaveLength(2000);
    expect(next.k0).toBeUndefined();
    expect(next[prefKey(v)]?.staffId).toBe('s2');
  });
  it('固定を外したときは、その担当の記憶だけ消す（別の担当に書き直された記憶は残す）', () => {
    const a = recordManualPref({}, v, 's1', 1);
    expect(forgetManualPref(a, v, 's2')).toBe(a);
    expect(forgetManualPref(a, v, 's1')).toEqual({});
  });
  it('patchManualPrefs と元に戻す', () => {
    const d = data();
    const set = patchManualPrefs(d, { set: { v1: 's2' } }, 5);
    expect(set.manualPrefs[prefKey(v)]).toEqual({ staffId: 's2', updatedAt: 5 });
    expect(patchManualPrefs(set, { clear: { v1: 's1' } }, 0)).toBe(set);
    expect(patchManualPrefs(set, { clear: { v1: 's2' } }, 0).manualPrefs).toEqual({});
    expect(restoreManualPref(set.manualPrefs, prefKey(v), null)).toEqual({});
    expect(restoreManualPref({}, prefKey(v), { staffId: 's1', updatedAt: 1 })).toEqual({
      [prefKey(v)]: { staffId: 's1', updatedAt: 1 },
    });
  });
  it('確認の文', () => {
    expect(prefWhenText(v)).toBe('月曜 09:00〜10:00');
    expect(prefWhenText({ ...v, latestStart: '09:00' })).toBe('月曜 09:00');
    expect(prefDatesText(['2026-10-19', '2026-10-26', '2026-10-26'])).toBe('10/19・10/26');
    expect(prefDatesText(['2026-10-19', '2026-10-26', '2026-11-02'], 2)).toBe('10/19・10/26 ほか1日');
  });
});

describe('来週以降の割当済みをまとめて変える', () => {
  it('同じキーで今日より後に別の人が割り当たっている訪問を拾う（今の案、無ければ確定した割当）', () => {
    const d = {
      ...data(),
      aiPlans: { [NEXT]: plan(NEXT, { s1: ['v2'] }) },
      manualPlans: { [NEXT2]: { s1: ['v3'] } },
    };
    expect(futureAssigned(d, { v1: 's2' }, DATE)).toEqual([
      { date: NEXT, visitId: 'v2', from: 's1', to: 's2', source: 'plan' },
      { date: NEXT2, visitId: 'v3', from: 's1', to: 's2', source: 'confirmed' },
    ]);
    // 同じ人なら拾わない・今日より前は拾わない
    expect(futureAssigned(d, { v1: 's1' }, DATE)).toEqual([]);
    expect(futureAssigned(d, { v1: 's2' }, NEXT2)).toEqual([]);
  });
  it('今の案で差し替えて固定。担当できない日・確定した割当だけの日は変えない', () => {
    const d: DemoData = {
      ...data(),
      absences: [{ id: 'a1', staffId: 's2', date: NEXT2, from: null, to: null, note: '' }],
      aiPlans: { [NEXT]: plan(NEXT, { s1: ['v2'] }), [NEXT2]: plan(NEXT2, { s1: ['v3'] }) },
    };
    const list = futureAssigned(d, { v1: 's2' }, DATE);
    const r = applyFutureAssigned(d, list);
    expect(r.changed.map((x) => x.date)).toEqual([NEXT]);
    expect(r.failed).toEqual([{ ...list[1]!, why: 'その日は担当できない' }]);
    expect(r.data.aiPlans[NEXT]!.routes.s2).toEqual(['v2']);
    expect(r.data.aiPlans[NEXT]!.pins).toEqual({ v2: 's2' });
    expect(r.data.aiPlans[NEXT2]).toBe(d.aiPlans[NEXT2]);
    expect(r.before[NEXT]).toBe(d.aiPlans[NEXT]);
    // 元に戻せるかの判定
    expect(samePlanEdit(r.data.aiPlans[NEXT], r.data.aiPlans[NEXT])).toBe(true);
    expect(samePlanEdit(r.data.aiPlans[NEXT], d.aiPlans[NEXT])).toBe(false);
    // 確定した割当だけの日
    const conf = { ...data(), manualPlans: { [NEXT]: { s1: ['v2'] } } };
    const rc = applyFutureAssigned(conf, futureAssigned(conf, { v1: 's2' }, DATE));
    expect(rc.changed).toEqual([]);
    expect(rc.failed[0]?.why).toBe('確定した割当だけの日');
    expect(rc.data).toBe(conf);
  });
  it('〈利用者さん〉の休みで計算に入らない日は理由を分ける', () => {
    const d: DemoData = {
      ...data(),
      clientLeaves: [{ id: 'l1', clientId: 'c1', from: NEXT, to: NEXT, note: '' }],
      aiPlans: { [NEXT]: plan(NEXT, { s1: ['v2'] }) },
    };
    const r = applyFutureAssigned(d, futureAssigned(d, { v1: 's2' }, DATE));
    expect(r.failed.map((x) => x.why)).toEqual(['利用者さんの休み']);
  });
  it('元に戻す（1手）：記憶とまとめて変えたほかの日を一緒に戻す', () => {
    const d0: DemoData = { ...data(), aiPlans: { [NEXT]: plan(NEXT, { s1: ['v2'] }) } };
    const key = prefKey(visit('v1', 'c1', '09:00', '10:00'));
    const before = d0.manualPrefs[key] ?? null;
    const d1 = patchManualPrefs(d0, { set: { v1: 's2' } }, 3);
    const r = applyFutureAssigned(d1, futureAssigned(d1, { v1: 's2' }, DATE));
    const others = Object.entries(r.before).map(([date, b]) => ({ date, before: b }));
    const back = undoPrefExtras(r.data, { prefs: [{ key, before }], others });
    expect(back.manualPrefs).toEqual(d0.manualPrefs);
    expect(back.aiPlans[NEXT]).toBe(d0.aiPlans[NEXT]);
    expect(undoPrefExtras(d0, {})).toBe(d0);
  });
});

describe('記憶と「条件が変わった」・記録', () => {
  it('記憶で固定して作った案は、そのあと記憶が変わっても「条件が変わった」にならない', () => {
    const d0 = { ...data(), manualPrefs: {} as ManualPrefs };
    const d = patchManualPrefs(d0, { set: { v2: 's2' } }, 1);
    const base = compile(d, NEXT);
    const { problem, applied } = withManualPrefs(base, d);
    expect(applied).toEqual({ v2: 's2' });
    const result = solve(problem, { seed: 1, iterations: 500 });
    const made = applyDayRun(d, NEXT, {
      rules: d.rules,
      result,
      createdAt: 1,
      inputKey: problemKey(problem),
      onlyEmpty: false,
      prefPins: applied,
    });
    expect(made.aiRuns[NEXT]![0]!.prefPins).toEqual({ v2: 's2' });
    expect(planStale(made, made, NEXT)).toBe(false);
    // 記憶を書き直しても（手直しのたびに出ないよう）条件が変わったにしない
    const changed = patchManualPrefs(made, { set: { v1: 's1' } }, 2);
    expect(planStale(changed, changed, NEXT)).toBe(false);
    // 記憶の担当がその日に休むとデータが変わったので「条件が変わった」
    const absent = { ...made, absences: [{ id: 'a', staffId: 's2', date: NEXT, from: null, to: null, note: '' }] };
    expect(planStale(absent, absent, NEXT)).toBe(true);
  });
  it('同じ結果の記録を使い回すときも prefPins を今回のものに書き直す', () => {
    const d = data();
    const result = { routes: { s1: ['v1'] }, unassigned: [], score: 0, seed: 1, iterations: 1, stopped: false };
    const a = addRun(d, DATE, { rules: d.rules, pins: {}, result, createdAt: 1, inputKey: 'k1' });
    expect(a.aiRuns[DATE]![0]!.prefPins).toBeUndefined();
    const b = addRun(a, DATE, {
      rules: d.rules,
      pins: {},
      result,
      createdAt: 2,
      inputKey: 'k2',
      prefPins: { v1: 's1' },
    });
    expect(b.aiRuns[DATE]).toHaveLength(1);
    expect(b.aiRuns[DATE]![0]!.prefPins).toEqual({ v1: 's1' });
  });
});
