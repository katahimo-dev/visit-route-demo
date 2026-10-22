import { describe, expect, it } from 'vitest';
import type { Reason } from '../contracts/problem';
import type { ReassignCandidate } from '../contracts/reassign';
import { reassignItemText, shiftText } from './reassignMenu';

const INF = Number.POSITIVE_INFINITY;
const cand = (over: Partial<ReassignCandidate> = {}): ReassignCandidate => ({
  staffId: 's1',
  fits: true,
  addedTravel: 12.4,
  addedCost: 20,
  shiftMinutes: null,
  overCap: false,
  violations: [],
  routeBroken: false,
  delayedCount: 0,
  maxDelayMinutes: 0,
  ...over,
});
const compat = (label: string, level: 2 | 1 | -1 | -2, points: number): Reason => ({
  ruleId: 'compat',
  label,
  points,
  level,
});

describe('reassignItemText（担当を変える ▾ の項目の説明）', () => {
  it('空き時間に入る人：移動の増え方と「時間の約束 ✓」、相性の記号・いつもの担当', () => {
    const reasons: Reason[] = [compat('相性◎', 2, -30), { ruleId: 'usual', label: 'いつもの担当', points: 0 }];
    expect(reassignItemText(cand(), reasons, true)).toEqual({
      description: '移動 +12分・時間の約束 ✓・相性◎・いつもの担当',
      disabled: false,
    });
    expect(reassignItemText(cand({ addedTravel: 0 }), [], true).description).toBe('移動 ±0分・時間の約束 ✓');
    expect(reassignItemText(cand({ addedTravel: -3 }), [], true).description).toBe('移動 −3分・時間の約束 ✓');
  });
  it('入らない人：「時間の約束 ✗」とずらせば入る分（受けられる人と同じ言い方）', () => {
    expect(reassignItemText(cand({ fits: false, addedTravel: null, shiftMinutes: 15 }), [], true).description).toBe(
      `時間の約束 ✗（${shiftText(15)}）`,
    );
    expect(shiftText(-10)).toBe('10分早めれば入る');
    expect(reassignItemText(cand({ fits: false, addedTravel: null }), [], true).description).toBe('時間の約束 ✗');
  });
  it('件数の上限・いまの予定の必須の違反は時間の代わりに書く', () => {
    expect(reassignItemText(cand({ fits: false, overCap: true }), [], true).description).toBe('件数の上限を超える');
    expect(reassignItemText(cand({ fits: false, routeBroken: true }), [], true).description).toBe(
      'いまの予定に守れない条件あり',
    );
  });
  it('重みの違反は2つまで（相性は記号で1回だけ）', () => {
    const a = compat('相性△', -1, 30);
    const v: Reason[] = [
      a,
      { ruleId: 'r1', label: 'いつもの担当でない', points: 10 },
      { ruleId: 'r2', label: '希望：女性 ✗', points: 10 },
      { ruleId: 'r3', label: '必要条件：喀痰 ✗', points: 10 },
    ];
    expect(reassignItemText(cand({ violations: v }), [a], true).description).toBe(
      '移動 +12分・時間の約束 ✓・相性△・いつもの担当でない・希望：女性 ✗',
    );
  });
  it('必須の条件に合わない人は押せず、理由に必須で外れる理由を並べる（同じ名前は1回）', () => {
    const x = compat('相性×', -2, INF);
    const v: Reason[] = [
      { ruleId: 'type', label: '種類（入浴）：資格 ✗', points: INF },
      x,
      { ruleId: 'type', label: '種類（入浴）：資格 ✗', points: INF },
    ];
    const t = reassignItemText(cand({ fits: false, addedTravel: null, violations: v }), [x], false);
    expect(t.disabled).toBe('必須の条件に合いません（種類（入浴）：資格 ✗・相性×）');
    expect(t.description).toContain('相性×');
    expect(reassignItemText(cand(), [], false).disabled).toBe('必須の条件に合いません');
  });
});
