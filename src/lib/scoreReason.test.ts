import { describe, expect, it } from 'vitest';
import type { HundredPart, PlanScore, RuleAchievement } from '../contracts/problem';
import type { Rule } from '../contracts/rules';
import { REASON_MIN_POINTS, scoreReason, scoreReasonLabel } from './scoreReason';

const part = (key: HundredPart['key'], points: number): HundredPart => ({ key, label: key, points });
type Sc = Pick<PlanScore, 'travelMinutes' | 'waitMinutes' | 'dropped' | 'perRule' | 'hardViolations'>;
const sc = (x: Partial<Sc> = {}): Sc => ({
  travelMinutes: 190.4,
  waitMinutes: 45,
  dropped: 0,
  perRule: {},
  hardViolations: [],
  ...x,
});
const rule = (id: string, type: Rule['type'], weight: number, label = id, hard = false): Rule => ({
  id,
  type,
  label,
  weight,
  hard,
});
const pr = (points: number, misses = 0) => ({ hits: 0, misses, points });
const compat = (poor: number, ng = 0): RuleAchievement => ({
  ruleId: 'cp',
  unit: 'visit',
  total: 10,
  met: 10 - poor - ng,
  compat: { great: 3, good: 2, poor, ng },
});
const hv = { visitId: 'v1', staffId: 's1', kind: 'notAllowed' as const, label: 'x' };

describe('scoreReason', () => {
  it('いちばん大きい減点の成分を選ぶ（並びに頼らない）', () => {
    const r = scoreReason([part('wait', 3), part('travel', 12), part('assign', 5)], sc());
    expect(r).toMatchObject({ key: 'travel', text: '移動が長め（190分）', points: 12 });
    expect(scoreReason([part('wait', 2)], sc())?.text).toBe('空き時間（待ち）が長め（45分）');
  });
  it('必須の違反があれば、点の大きさに関わらず先に出す', () => {
    const r = scoreReason([part('travel', 30)], sc({ hardViolations: [hv, hv], dropped: 1 }));
    expect(r).toMatchObject({ key: 'hard', text: '必須の違反 2件' });
  });
  it('入らない訪問があれば、点の大きさに関わらず先に出す', () => {
    const r = scoreReason([part('travel', 30), part('dropped', 0.1)], sc({ dropped: 1 }));
    expect(r).toMatchObject({ key: 'dropped', text: '入らない訪問 1件' });
  });
  it('0.5点の判定は合計の減点で決める（1つずつは小さくても合計が0.5以上なら出す）', () => {
    const r = scoreReason([part('travel', 0.3), part('wait', 0.25)], sc());
    expect(r?.key).toBe('travel');
    expect(scoreReason([part('travel', REASON_MIN_POINTS - 0.2), part('wait', 0.1)], sc())).toBeNull();
    expect(scoreReason([], sc())).toBeNull();
    expect(scoreReason([part('travel', -3), part('wait', 0.4)], sc())).toBeNull();
  });
  it('担当の条件：perRule の点の下限からの超過がいちばん大きい条件（外れた件数ではなく）', () => {
    const rules = [rule('co', 'continuity', 1), rule('pref', 'clientPreference', 4, '同性の担当')];
    // co は外れ3件でも超過 10、pref は外れ1件で超過 40
    const r = scoreReason([part('assign', 6)], sc({ perRule: { co: pr(30, 3), pref: pr(40, 1) } }), {
      rules,
      ruleLower: { co: 20 },
    });
    expect(r?.text).toBe('「同性の担当」に合わない訪問 1件');
    const r2 = scoreReason([part('assign', 6)], sc({ perRule: { co: pr(60, 3), pref: pr(40, 1) } }), {
      rules,
      ruleLower: { co: 0 },
    });
    expect(r2?.text).toBe('いつもの担当でない訪問 3件');
  });
  it('相性：△・× の件数。外れは無く加点を取り逃しただけなら「相性◎を取り逃した」', () => {
    const rules = [rule('cp', 'compatibility', 3)];
    const bad = scoreReason([part('assign', 8)], sc({ perRule: { cp: pr(-10, 1) } }), {
      rules,
      ruleLower: { cp: -60 },
      achievements: [compat(1)],
    });
    expect(bad?.text).toBe('相性△が1件');
    const both = scoreReason([part('assign', 8)], sc({ perRule: { cp: pr(-10, 2) } }), {
      rules,
      ruleLower: { cp: -60 },
      achievements: [compat(1, 1)],
    });
    expect(both?.text).toBe('相性△・×が2件');
    const missed = scoreReason([part('assign', 8)], sc({ perRule: { cp: pr(-30, 0) } }), {
      rules,
      ruleLower: { cp: -60 },
      achievements: [compat(0)],
    });
    expect(missed?.text).toBe('相性◎を取り逃した訪問がある');
  });
  it('名前の付いた条件で外れが無ければ「加点を取り逃した」', () => {
    const r = scoreReason([part('assign', 3)], sc({ perRule: { p: pr(-5, 0) } }), {
      rules: [rule('p', 'staffPreference', 2, '経験の長い人')],
      ruleLower: { p: -20 },
    });
    expect(r?.text).toBe('「経験の長い人」の加点を取り逃した訪問がある');
  });
  it('必須の条件・下限から超えていない条件は比べない。分からなければ一般の文', () => {
    const rules = [rule('h', 'clientRequirement', 3, '資格', true), rule('p', 'clientPreference', 1, '好み')];
    const r = scoreReason([part('assign', 6)], sc({ perRule: { h: pr(90, 3), p: pr(10, 1) } }), {
      rules,
      ruleLower: { p: 10 },
    });
    expect(r?.text).toBe('担当の条件に合わない訪問がある');
  });
  it('負担の均等：目安から外れた人数', () => {
    const b: RuleAchievement = { ruleId: 'balance', unit: 'staff', total: 6, met: 4, compat: null };
    expect(scoreReason([part('balance', 4)], sc(), { achievements: [b] })?.text).toBe(
      '件数の偏り（目安から外れた人 2人）',
    );
    expect(scoreReason([part('balance', 4)], sc())?.text).toBe('件数の偏り');
  });
  it('読み上げの文', () => {
    const r = scoreReason([part('travel', 12)], sc());
    expect(r && scoreReasonLabel(r)).toBe('点を下げているいちばんの理由：移動が長め（190分）');
  });
});
