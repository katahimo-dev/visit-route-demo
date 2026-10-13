// 条件ごとの達成の件数（evaluate.achievements。ADR-0008）
import { describe, expect, it } from 'vitest';
import { compile } from '../matching';
import { client, DATE, makeData, rule, staff, visit } from '../matching/fixtures';
import { achievements } from './index';

/** s1（看護師・経験5年）、s2（経験1年）。c1 は看護師が必要、c2 は希望 経験3年以上、相性 c3×s1=◎・c2×s2=△・c1×s2=○ */
function problem() {
  return compile(
    makeData({
      staff: [
        staff('s1', 38.26, 140.87, { traits: { license: ['看護師'], years: 5 } }),
        staff('s2', 38.27, 140.89, { traits: { license: ['なし'], years: 1 } }),
      ],
      clients: [
        client('c1', 38.262, 140.872, { requirements: [{ itemId: 'license', op: 'hasAny', value: ['看護師'] }] }),
        client('c2', 38.268, 140.885, { preferences: [{ itemId: 'years', op: 'gte', value: 3 }] }),
        client('c3', 38.265, 140.88),
      ],
      visits: [
        visit('v1', 'c1', '09:00', '09:30'),
        visit('v2', 'c2', '11:00', '12:00'),
        visit('v3', 'c3', '13:00', '13:00', { windowKind: 'fixed' }),
      ],
      compat: { c3: { s1: 2 }, c2: { s2: -1 }, c1: { s2: 1 } },
      rules: [
        rule('req', 'clientRequirement', 0, true),
        rule('pref', 'clientPreference', 3),
        rule('cp', 'compatibility', 2),
        rule('bal', 'balance', 3),
      ],
    }),
    DATE,
  );
}

describe('achievements', () => {
  it('条件の判定がある訪問を分母、すべて満たした訪問を分子にし、相性は ◎○△ を数える', () => {
    const p = problem();
    const a = achievements(p, { s1: ['v1', 'v3'], s2: ['v2'] });
    const by = new Map(a.map((x) => [x.ruleId, x]));
    expect(by.get('req')).toMatchObject({ unit: 'visit', total: 1, met: 1 });
    // v2 を経験1年の s2 に：希望を満たさない
    expect(by.get('pref')).toMatchObject({ total: 1, met: 0 });
    // v3（◎）と v2（△）
    expect(by.get('cp')).toMatchObject({ total: 2, met: 1, compat: { great: 1, good: 0, poor: 1, ng: 0 } });
    expect(by.get('balance')?.unit).toBe('staff');
    expect(a.at(-1)?.ruleId).toBe('balance');
  });

  it('入らない訪問は数えない。担当を変えると件数が変わる', () => {
    const p = problem();
    const a = achievements(p, { s1: ['v2'] });
    const by = new Map(a.map((x) => [x.ruleId, x]));
    expect(by.get('pref')).toMatchObject({ total: 1, met: 1 });
    expect(by.get('req')).toBeUndefined();
    expect(by.get('cp')).toBeUndefined();
  });

  it('決定的：同じ入力で同じ結果', () => {
    const p = problem();
    const r = { s1: ['v1', 'v3'], s2: ['v2'] };
    expect(achievements(p, r)).toEqual(achievements(p, r));
  });
});
