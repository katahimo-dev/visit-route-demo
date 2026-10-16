import { describe, expect, it } from 'vitest';
import type { AiPlan, AiRun, DemoData } from '../contracts/data';
import { client, DATE, makeData, staff, visit } from '../matching/fixtures';
import { cancelTentative, confirmedDatesOf } from './tentative';

const routes = { s1: ['v1', 'v2'] };
const plan: AiPlan = {
  date: DATE,
  createdAt: 1,
  seed: 1,
  iterations: 1,
  routes,
  unassigned: ['v3'],
  score: 0,
  stopped: false,
  rules: [],
  generated: { routes, unassigned: ['v3'], score: 0 },
  pins: { v2: 's1', v1: 's1' },
  reassign: {
    method: 'insert',
    from: 'plan',
    baseRoutes: routes,
    basePins: { v2: 's1' },
    baseGenerated: { routes, unassigned: [], score: 0 },
    absenceIds: [],
  },
};
const run: AiRun = {
  id: 'r1',
  no: 1,
  date: DATE,
  createdAt: 1,
  label: '標準',
  presetId: null,
  seed: 1,
  iterations: 1,
  rules: [],
  pins: { v2: 's1' },
  routes,
  unassigned: [],
  score: 0,
  stopped: false,
};

const data = (): DemoData => ({
  ...makeData({
    staff: [staff('s1', 38.26, 140.87)],
    clients: [client('c1', 38.27, 140.88), client('c2', 38.27, 140.881, { tentative: true })],
    visits: [
      visit('v1', 'c1', '09:00', '09:00'),
      visit('v2', 'c2', '11:00', '11:00'),
      visit('v3', 'c2', '13:00', '13:00'),
      visit('v4', 'c2', '13:00', '13:00', { date: '2026-10-13' }),
    ],
  }),
  compat: { c1: { s1: 1 }, c2: { s1: -1 } },
  manualPlans: { [DATE]: { s1: ['v1', 'v2'], __none: ['v3'] } },
  aiPlans: { [DATE]: plan },
  aiRuns: { [DATE]: [run] },
});

describe('cancelTentative（仮押さえを取り消す）', () => {
  it('消した訪問の ID を今の案・記録・確定した割当から、〈利用者さん〉を相性から除く', () => {
    const r = cancelTentative(data(), 'c2', DATE);
    expect(r.clients.map((c) => c.id)).toEqual(['c1']);
    expect(r.visits.map((v) => v.id)).toEqual(['v1']);
    expect(r.compat).toEqual({ c1: { s1: 1 } });
    expect(r.manualPlans[DATE]).toEqual({ s1: ['v1'], __none: [] });
    const p = r.aiPlans[DATE]!;
    expect(p.routes).toEqual({ s1: ['v1'] });
    expect(p.unassigned).toEqual([]);
    expect(p.generated.routes).toEqual({ s1: ['v1'] });
    expect(p.generated.unassigned).toEqual([]);
    expect(p.pins).toEqual({ v1: 's1' });
    expect(p.reassign!.baseRoutes).toEqual({ s1: ['v1'] });
    expect(p.reassign!.basePins).toEqual({});
    expect(p.reassign!.baseGenerated!.routes).toEqual({ s1: ['v1'] });
    const x = r.aiRuns[DATE]![0]!;
    expect(x.routes).toEqual({ s1: ['v1'] });
    expect(x.pins).toEqual({});
  });

  it('confirmedDatesOf：その人の訪問がある確定した日', () => {
    expect(confirmedDatesOf(data(), 'c2')).toEqual([DATE]);
    expect(confirmedDatesOf({ ...data(), manualPlans: {} }, 'c2')).toEqual([]);
  });
});
