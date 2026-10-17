// 訪問の種類の必要条件・パターンのいつもの担当（ADR-0012）
import { describe, expect, it } from 'vitest';
import type { Pattern, VisitType } from '../contracts/documents';
import { problemKey } from '../lib/runs';
import { client, DATE, makeData, randomData, rule, staff, visit } from './fixtures';
import { compile, VISIT_TYPE_RULE_ID } from './index';

const REHAB: VisitType = {
  id: 'rehab',
  name: 'リハビリ',
  color: 1,
  durationMinutes: 40,
  requirements: [{ itemId: 'license', op: 'hasAny', value: ['看護師'] }],
  note: '',
};

function pattern(id: string, over: Partial<Pattern> = {}): Pattern {
  return {
    id,
    clientId: 'c1',
    typeId: null,
    weekdays: [1],
    everyWeeks: 1,
    repeat: 'weekly',
    monthWeeks: [],
    dayTimes: [],
    windowKind: 'window',
    earliestStart: '10:00',
    latestStart: '11:00',
    durationMinutes: 60,
    from: DATE,
    to: null,
    usualStaffId: null,
    note: '',
    ...over,
  };
}

/** 2人（s1 看護師、s2 なし）と訪問先1か所 */
function twoStaff(over: Parameters<typeof makeData>[0] = {}) {
  return makeData({
    staff: [
      staff('s1', 38.26, 140.87, { traits: { license: ['看護師'] } }),
      staff('s2', 38.27, 140.88, { traits: { license: ['なし'] } }),
    ],
    clients: [client('c1', 38.265, 140.875, { usualStaffId: 's1' })],
    visits: [visit('v1', 'c1', '10:00', '11:00', { typeId: 'rehab' })],
    visitTypes: [REHAB],
    ...over,
  });
}

describe('訪問の種類の必要条件（常に必須）', () => {
  it('満たさない人は可にならず、理由が「種類（リハビリ）：… ✗」。満たす人は ✓・0点', () => {
    const p = compile(twoStaff(), DATE);
    expect(p.allowed[0]).toEqual([true, false]);
    expect(p.reasons[0]![1]).toContainEqual({
      ruleId: VISIT_TYPE_RULE_ID,
      label: '種類（リハビリ）：資格に看護師を含む ✗',
      points: Number.POSITIVE_INFINITY,
    });
    expect(p.reasons[0]![0]).toContainEqual({
      ruleId: VISIT_TYPE_RULE_ID,
      label: '種類（リハビリ）：資格に看護師を含む ✓',
      points: 0,
    });
    expect(p.assignCost[0]![0]).toBe(0);
  });
  it('条件の重み・必須にかかわらず効く（利用者さんの必要条件が重み0・必須でなくても）', () => {
    for (const rules of [[], [rule('req', 'clientRequirement', 0)], [rule('req', 'clientRequirement', 1)]]) {
      const p = compile(twoStaff({ rules }), DATE);
      expect(p.allowed[0]).toEqual([true, false]);
    }
  });
  it('誰も満たさなければ infeasible に原因の条件が入る', () => {
    const d = twoStaff();
    d.staff[0]!.traits = { license: ['なし'] };
    const p = compile(d, DATE);
    expect(p.infeasible).toHaveLength(1);
    expect(p.infeasible[0]!.reasons[0]!.label).toBe('種類（リハビリ）：資格に看護師を含む ✗（2人）');
  });
  it('種類の無い訪問・いない種類の訪問は、種類が無いデータと同じ問題になる（problemKey も同じ）', () => {
    const plain = randomData(4, 10, 7, [rule('cont', 'continuity', 2), rule('req', 'clientRequirement', 3)]);
    const base = compile(plain, DATE);
    const withTypes = {
      ...plain,
      visitTypes: [REHAB],
      patterns: [pattern('p1')],
      visits: plain.visits.map((v, i) => ({ ...v, typeId: i % 2 === 0 ? null : 'ghost' })),
    };
    const p = compile(withTypes, DATE);
    expect(p).toEqual(base);
    expect(problemKey(p)).toBe(problemKey(base));
  });
});

describe('いつもの担当（継続）', () => {
  const cont = [rule('cont', 'continuity', 2)];
  const data = (usualStaffId: string | null) =>
    twoStaff({
      rules: cont,
      visitTypes: [],
      patterns: [pattern('p1', { usualStaffId })],
      visits: [visit('v1', 'c1', '10:00', '11:00', { pattern: { id: 'p1', date: DATE, edited: false } })],
    });
  it('パターンにいつもの担当があればその人を使う', () => {
    const p = compile(data('s2'), DATE);
    expect(p.reasons[0]![1]).toContainEqual({ ruleId: 'cont', label: 'いつもの担当', points: 0 });
    expect(p.reasons[0]![0]).toContainEqual({ ruleId: 'cont', label: 'いつもの担当でない', points: 20 });
  });
  it('パターンに無ければ利用者さんのいつもの担当', () => {
    const p = compile(data(null), DATE);
    expect(p.reasons[0]![0]).toContainEqual({ ruleId: 'cont', label: 'いつもの担当', points: 0 });
  });
  it('元のパターンが無い訪問は利用者さんのいつもの担当', () => {
    const d = data('s2');
    d.patterns = [];
    const p = compile(d, DATE);
    expect(p.reasons[0]![0]).toContainEqual({ ruleId: 'cont', label: 'いつもの担当', points: 0 });
  });
});
