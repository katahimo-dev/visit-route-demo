import { describe, expect, it } from 'vitest';
import type { HundredPart, RuleAchievement } from '../contracts/problem';
import type { Rule } from '../contracts/rules';
import { REASON_MIN_POINTS, scoreReason, scoreReasonLabel } from './scoreReason';

const part = (key: HundredPart['key'], points: number): HundredPart => ({ key, label: key, points });
const sc = { travelMinutes: 190.4, waitMinutes: 45, dropped: 1 };
const rule = (id: string, type: Rule['type'], weight: number, label = id): Rule => ({
  id,
  type,
  label,
  weight,
  hard: false,
});
const ach = (
  ruleId: string,
  total: number,
  met: number,
  compat: RuleAchievement['compat'] = null,
): RuleAchievement => ({
  ruleId,
  unit: ruleId === 'balance' ? 'staff' : 'visit',
  total,
  met,
  compat,
});

describe('scoreReason', () => {
  it('いちばん大きい減点の成分を選ぶ（並びに頼らない）', () => {
    const r = scoreReason([part('wait', 3), part('travel', 12), part('assign', 5)], sc);
    expect(r).toMatchObject({ key: 'travel', text: '移動が長め（190分）' });
    expect(r?.points).toBe(12);
  });
  it('入らない訪問・空き時間（待ち）', () => {
    expect(scoreReason([part('dropped', 40)], sc)?.text).toBe('入らない訪問 1件');
    expect(scoreReason([part('wait', 2)], sc)?.text).toBe('空き時間（待ち）が長め（45分）');
  });
  it('ほぼ理想（減点が小さい）・内訳が無い：理由は出さない', () => {
    expect(scoreReason([part('travel', REASON_MIN_POINTS - 0.01)], sc)).toBeNull();
    expect(scoreReason([], sc)).toBeNull();
    expect(scoreReason([part('travel', -3)], sc)).toBeNull();
  });
  it('担当の条件：相性の △ の件数', () => {
    const r = scoreReason(
      [part('assign', 8), part('travel', 2)],
      sc,
      [ach('cp', 10, 9, { great: 3, good: 2, poor: 1, ng: 0 })],
      [rule('cp', 'compatibility', 3)],
    );
    expect(r).toMatchObject({ key: 'assign', text: '相性△が1件' });
  });
  it('担当の条件：外れた件数×重みが大きい条件を選ぶ（いつもの担当・名前の付いた条件）', () => {
    const rules = [rule('co', 'continuity', 1), rule('pref', 'clientPreference', 4, '同性の担当')];
    const achs = [ach('co', 10, 7), ach('pref', 10, 9)];
    // co：3件×1＝3、pref：1件×4＝4
    expect(scoreReason([part('assign', 6)], sc, achs, rules)?.text).toBe('「同性の担当」に合わない訪問 1件');
    const rules2 = [rule('co', 'continuity', 2), rule('pref', 'clientPreference', 1, '同性の担当')];
    expect(scoreReason([part('assign', 6)], sc, achs, rules2)?.text).toBe('いつもの担当でない訪問 3件');
  });
  it('担当の条件：外れた条件が分からなければ一般の文', () => {
    expect(scoreReason([part('assign', 6)], sc, [ach('x', 5, 5)])?.text).toBe('担当の条件に合わない訪問がある');
  });
  it('相性の × があれば × も書く', () => {
    const r = scoreReason([part('assign', 6)], sc, [ach('cp', 4, 2, { great: 0, good: 2, poor: 1, ng: 1 })]);
    expect(r?.text).toBe('相性△・×が2件');
  });
  it('負担の均等：目安から外れた人数', () => {
    expect(scoreReason([part('balance', 4)], sc, [ach('balance', 6, 4)])?.text).toBe(
      '件数の偏り（目安から外れた人 2人）',
    );
    expect(scoreReason([part('balance', 4)], sc)?.text).toBe('件数の偏り');
  });
  it('読み上げの文', () => {
    const r = scoreReason([part('travel', 12)], sc);
    expect(r && scoreReasonLabel(r)).toBe('点を下げているいちばんの理由：移動が長め（190分）');
  });
});
