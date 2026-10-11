import { describe, expect, it } from 'vitest';
import { compile } from '../matching';
import { client, DATE, makeData, rule, staff, visit } from '../matching/fixtures';
import { diff, explain, score } from './index';

/** s1（看護師・女性）、s2（なし・男性）。c1 は看護師が必要、c2 は希望 経験3年以上 */
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
        visit('v3', 'c3', '09:00', '09:00', { windowKind: 'fixed' }),
      ],
      compat: { c3: { s1: 2 } },
      rules: [
        rule('req', 'clientRequirement', 0, true),
        rule('pref', 'clientPreference', 3),
        rule('cp', 'compatibility', 2),
        rule('w', 'wait', 3),
      ],
    }),
    DATE,
  );
}

describe('score', () => {
  it('手作業案の違反（可否・時間）を記録し、それでも移動・割当費用は数える', () => {
    const p = problem();
    // s2 は c1 の必要条件を満たさない。s1 は v1（9:00〜）と v3（9:00 固定）を両方は回れない
    const sc = score(p, { s1: ['v1', 'v3'], s2: ['v2'], __none: [] });
    expect(sc.hardViolations).toEqual([
      { visitId: 'v3', staffId: 's1', kind: 'time', label: '時間の約束に間に合わない' },
    ]);
    const sc2 = score(p, { s2: ['v1', 'v2'] });
    expect(sc2.hardViolations).toEqual([
      { visitId: 'v1', staffId: 's2', kind: 'notAllowed', label: '必要条件：資格に看護師を含む ✗' },
    ]);
    expect(sc2.dropped).toBe(1);
    expect(sc2.assignPoints).toBe(30); // v2 の希望✗（v1 の hard 違反は Infinity なので数えない）
    expect(sc2.perRule.req).toEqual({ hits: 0, misses: 1, points: 0 });
    expect(sc2.perRule.pref).toEqual({ hits: 0, misses: 1, points: 30 });
    expect(sc2.total).toBeCloseTo(sc2.travelMinutes + sc2.waitMinutes * 0.3 + 30 + 10000, 9);
  });

  it('problem にない訪問・重複は無視し、どの列にもない訪問は dropped', () => {
    const p = problem();
    const sc = score(p, { s1: ['v1', 'zzz', 'v1'], s2: [] });
    expect(sc.dropped).toBe(2);
    expect(sc.perRule.cp).toBeUndefined();
    const sc3 = score(p, { s1: ['v3', 'v2'] });
    expect(sc3.perRule.cp).toEqual({ hits: 1, misses: 0, points: -20 });
    expect(sc3.perRule.pref).toEqual({ hits: 1, misses: 0, points: 0 });
  });
});

describe('explain', () => {
  it('担当の理由と移動を、点の絶対値の大きい順に3つまで', () => {
    const p = problem();
    const ex = explain(p, { s1: ['v3', 'v2'], s2: [] });
    const v3 = ex.find((e) => e.visitId === 'v3')!;
    expect(v3.staffId).toBe('s1');
    expect(v3.reasons[0]!.label).toBe('相性◎');
    expect(v3.reasons.some((r) => r.ruleId === 'travel' && /^移動\d+分$/.test(r.label))).toBe(true);
    expect(v3.timing).toMatchObject({ visitId: 'v3', start: 540, wait: 0 });
    for (const e of ex) {
      expect(e.reasons.length).toBeLessThanOrEqual(3);
      const abs = e.reasons.map((r) => Math.abs(r.points));
      expect([...abs].sort((a, b) => b - a)).toEqual(abs);
    }
    const v1 = ex.find((e) => e.visitId === 'v1')!;
    expect(v1).toMatchObject({ staffId: null, timing: null });
  });
});

describe('diff', () => {
  it('担当が変わった訪問・移動の差・点の差（to−from）', () => {
    const p = problem();
    const from = { s1: ['v1', 'v2'], s2: ['v3'] };
    const to = { s1: ['v3', 'v2'], s2: [] };
    const d = diff(p, from, to);
    expect(d.changedVisits).toEqual(['v1', 'v3']);
    expect(d.travelDelta).toBeCloseTo(score(p, to).travelMinutes - score(p, from).travelMinutes, 9);
    expect(d.scoreDelta).toBeCloseTo(score(p, to).total - score(p, from).total, 9);
  });
});
