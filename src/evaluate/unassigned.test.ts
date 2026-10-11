import { describe, expect, it } from 'vitest';
import { compile } from '../matching';
import { createDemoData } from '../seed';
import { solve } from '../solver';
import { explain } from './index';

describe('入らなかった訪問の理由', () => {
  it('候補がいるのに入らない訪問にも、担当ごとの理由（時間が合わない・可否の原因の人数）を出す', () => {
    const d = createDemoData('2026-10-12');
    const p = compile(d, '2026-10-12');
    const r = solve(p, { seed: 1, iterations: 200_000 });
    const infeasible = new Set(p.infeasible.map((x) => p.visits[x.visit]!.id));
    const dropped = r.unassigned.filter((id) => !infeasible.has(id));
    const ex = new Map(explain(p, r.routes).map((e) => [e.visitId, e]));
    for (const id of dropped) {
      const reasons = ex.get(id)!.reasons;
      expect(reasons.length).toBeGreaterThan(0);
      expect(reasons.some((x) => x.label.includes('人）') || x.label.includes('時間が合わない'))).toBe(true);
    }
  });
});
