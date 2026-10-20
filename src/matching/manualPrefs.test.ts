import { describe, expect, it } from 'vitest';
import { problemKey } from '../lib/runs';
import { solve } from '../solver';
import { client, DATE, makeData, rule, staff, visit } from './fixtures';
import { compile } from './index';
import { applyPrefPins, MANUAL_PREF_RULE_ID, prefKey, requestedPrefPins, withManualPrefs } from './manualPrefs';

/** 2人・2件（v1 9:00〜10:00、v2 13:00） */
function data() {
  const cl = [client('c1', 38.26, 140.87), client('c2', 38.27, 140.88)];
  return makeData({
    staff: [staff('s1', 38.26, 140.87), staff('s2', 38.29, 140.9)],
    clients: cl,
    visits: [visit('v1', 'c1', '09:00', '10:00'), visit('v2', 'c2', '13:00', '13:00', { windowKind: 'fixed' })],
    rules: [rule('w', 'wait', 3)],
  });
}

describe('prefKey（手直しの記憶のキー）', () => {
  it('〈利用者さん〉・曜日・時間の約束・種類。日付・所要は入れない', () => {
    const v = visit('v1', 'c1', '09:00', '10:00');
    // 2026-10-12 は月曜（1）
    expect(prefKey(v)).toBe('c1|1|09:00-10:00|');
    expect(prefKey({ ...v, typeId: 't1' })).toBe('c1|1|09:00-10:00|t1');
    // 次の週の同じ曜日は同じキー、次の日は別のキー
    expect(prefKey(visit('v9', 'c1', '09:00', '10:00', { date: '2026-10-19', durationMinutes: 30 }))).toBe(prefKey(v));
    expect(prefKey({ ...v, date: '2026-10-13' })).not.toBe(prefKey(v));
    expect(prefKey({ ...v, latestStart: '09:30' })).not.toBe(prefKey(v));
  });
});

describe('記憶を問題に当てる', () => {
  it('記憶の担当が可なら、その訪問はその担当だけ可（費用は同じ）。理由に「前に手で」', () => {
    const d = {
      ...data(),
      manualPrefs: { [prefKey(visit('v1', 'c1', '09:00', '10:00'))]: { staffId: 's2', updatedAt: 1 } },
    };
    const base = compile(d, DATE);
    const { problem, applied } = withManualPrefs(base, d);
    expect(applied).toEqual({ v1: 's2' });
    expect(problem.allowed[0]).toEqual([false, true]);
    expect(problem.allowed[1]).toEqual(base.allowed[1]);
    expect(problem.assignCost).toEqual(base.assignCost);
    expect(problem.reasons[0]![1]).toContainEqual({
      ruleId: MANUAL_PREF_RULE_ID,
      label: '手直しの記憶：前に手でs2さんにした',
      points: 0,
    });
    expect(problem.reasons[0]![0]![0]!.ruleId).toBe(MANUAL_PREF_RULE_ID);
    // 記憶が問題のキーを変える（使い回しの判定。ADR-0010）
    expect(problemKey(problem)).not.toBe(problemKey(base));
    // 解いてもその担当
    expect(solve(problem, { seed: 1, iterations: 2000 }).routes.s2).toContain('v1');
  });
  it('記憶の担当が欠勤・いない人なら当てない（黙ってふつうの割当）', () => {
    const key = prefKey(visit('v1', 'c1', '09:00', '10:00'));
    const absent = {
      ...data(),
      absences: [{ id: 'a1', staffId: 's2', date: DATE, from: null, to: null, note: '' }],
      manualPrefs: { [key]: { staffId: 's2', updatedAt: 1 } },
    };
    const base = compile(absent, DATE);
    const r = withManualPrefs(base, absent);
    expect(r.applied).toEqual({});
    expect(r.problem).toBe(base);
    const gone = { ...data(), manualPrefs: { [key]: { staffId: 'zz', updatedAt: 1 } } };
    expect(withManualPrefs(compile(gone, DATE), gone).applied).toEqual({});
  });
  it('相性×で外れる人には当てない', () => {
    const key = prefKey(visit('v1', 'c1', '09:00', '10:00'));
    const d = {
      ...data(),
      compat: { c1: { s2: -2 as const } },
      manualPrefs: { [key]: { staffId: 's2', updatedAt: 1 } },
    };
    expect(withManualPrefs(compile(d, DATE), d).applied).toEqual({});
  });
  it('手直しの固定がある訪問は固定が先（記憶は当てない）', () => {
    const key = prefKey(visit('v1', 'c1', '09:00', '10:00'));
    const d = { ...data(), manualPrefs: { [key]: { staffId: 's2', updatedAt: 1 } } };
    const pinned = compile(d, DATE, { v1: 's1' });
    expect(requestedPrefPins(pinned, d, { v1: 's1' })).toEqual({});
    expect(withManualPrefs(pinned, d, { v1: 's1' }).problem.allowed[0]).toEqual([true, false]);
  });
  it('記憶が無ければ同じ問題を返す', () => {
    const base = compile(data(), DATE);
    expect(applyPrefPins(base, {}).problem).toBe(base);
    expect(withManualPrefs(base, data()).problem).toBe(base);
  });
});
