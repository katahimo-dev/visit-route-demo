// 稼働の見込み（PRD D72。ADR-0015）
import { describe, expect, it } from 'vitest';
import type { AiPlan, DemoData } from '../contracts/data';
import { compile } from '../matching';
import { client, DATE, makeData, staff, visit } from '../matching/fixtures';
import {
  fareOf,
  hmText,
  isOverSpan,
  workDayOf,
  workloadTsv,
  workMonth,
  workRoutesOf,
  workStats,
  workTotals,
} from './workload';

const plan = (routes: Record<string, string[]>, date = DATE): AiPlan => ({
  date,
  createdAt: 1,
  seed: 1,
  iterations: 1,
  routes,
  unassigned: [],
  score: 0,
  stopped: false,
  rules: [],
  generated: { routes, unassigned: [], score: 0 },
  pins: {},
});

function data(over: Partial<DemoData> = {}): DemoData {
  return makeData({
    org: {
      name: 'テスト',
      industry: 'care',
      terms: { client: '利用者さん', staff: 'ヘルパー' },
      fareYenPerKm: 10,
      spanLimitHours: 10,
    },
    staff: [staff('s1', 38.26, 140.87, { name: '山田 花' }), staff('s2', 38.3, 140.9, { name: '佐藤 一' })],
    clients: [
      client('c1', 38.265, 140.875, { displayName: '青葉' }),
      client('c2', 38.27, 140.88, { displayName: '泉' }),
      client('c3', 38.28, 140.89, { displayName: '宮城野' }),
    ],
    visits: [
      visit('v1', 'c1', '09:00', '09:00', { windowKind: 'fixed' }),
      visit('v2', 'c2', '11:00', '11:00', { windowKind: 'fixed' }),
      visit('v3', 'c3', '14:00', '14:00', { windowKind: 'fixed', durationMinutes: 90 }),
    ],
    ...over,
  });
}

describe('稼働の見込み（workStats）', () => {
  it('拘束＝最初の訪問の開始〜最後の訪問の終わり＝訪問＋移動＋待ち。自宅との行き帰りは拘束に入れず、距離・交通費に入れる', () => {
    const d = data();
    const p = compile(d, DATE);
    const [x] = workStats(p, { s1: ['v1', 'v2', 'v3'] }, d.org);
    expect(x).toBeDefined();
    expect(x!.count).toBe(3);
    expect(x!.start).toBe(9 * 60);
    expect(x!.end).toBe(14 * 60 + 90);
    expect(x!.span).toBe(6.5 * 60);
    expect(x!.visit).toBe(60 + 60 + 90);
    expect(x!.travel + x!.wait + x!.visit).toBeCloseTo(x!.span, 6);
    expect(x!.travel).toBeGreaterThan(0);
    expect(x!.home).toBeGreaterThan(0);
    // 距離は自宅→訪問…→自宅（行き帰りを含む）。交通費は距離×単価
    const legs = p.meters;
    const at = (id: string) => p.visits.find((v) => v.id === id)!.point;
    const home = p.staff[0]!.point;
    const m = legs[home]![at('v1')]! + legs[at('v1')]![at('v2')]! + legs[at('v2')]![at('v3')]! + legs[at('v3')]![home]!;
    expect(x!.meters).toBeCloseTo(m, 6);
    expect(x!.fareYen).toBe(fareOf(m, 10));
    expect(x!.over).toBe(false);
  });

  it('上限を超える日は over。上限 0 なら注意しない。訪問の無い人・未割当の列は出さない', () => {
    const d = data({ org: { ...data().org, spanLimitHours: 6 } });
    const p = compile(d, DATE);
    const stats = workStats(p, { s1: ['v1', 'v2', 'v3'], s2: [], __none: [] }, d.org);
    expect(stats.map((x) => x.staffId)).toEqual(['s1']);
    expect(stats[0]!.over).toBe(true);
    expect(workStats(p, { s1: ['v1', 'v2', 'v3'] }, { ...d.org, spanLimitHours: 0 })[0]!.over).toBe(false);
    expect(isOverSpan(600, 10)).toBe(false);
    expect(isOverSpan(601, 10)).toBe(true);
    expect(isOverSpan(9999, 0)).toBe(false);
  });

  it('確定した割当は開始（早）の順に並べ直して数える（順番を持たないため）', () => {
    const d = data();
    const p = compile(d, DATE);
    const a = workStats(p, { s1: ['v3', 'v1', 'v2'] }, d.org, true)[0]!;
    const b = workStats(p, { s1: ['v1', 'v2', 'v3'] }, d.org)[0]!;
    expect(a).toEqual(b);
  });
});

describe('数える案（workRoutesOf・workDayOf）', () => {
  it('確定した割当に担当があればそれ、無ければ今の案、どちらも無ければ null', () => {
    const d = data({ aiPlans: { [DATE]: plan({ s1: ['v1', 'v2'], s2: ['v3'] }) } });
    const p = compile(d, DATE);
    expect(workRoutesOf(d, DATE, p)?.source).toBe('plan');
    const c = { ...d, manualPlans: { [DATE]: { s2: ['v1'], __none: ['v2', 'v3'] } } };
    expect(workRoutesOf(c, DATE, p)?.source).toBe('confirmed');
    // 確定した割当が未割当だけなら今の案
    const e = { ...d, manualPlans: { [DATE]: { __none: ['v1', 'v2', 'v3'] } } };
    expect(workRoutesOf(e, DATE, p)?.source).toBe('plan');
    expect(workRoutesOf(data(), DATE, p)).toBeNull();
    const day = workDayOf(c, DATE);
    expect(day.source).toBe('confirmed');
    expect(day.stats.map((x) => [x.staffId, x.count])).toEqual([['s2', 1]]);
  });

  it('月の合計と、表のコピー（タブ区切り。交通費は単価が 0 なら出さない）', () => {
    const next = '2026-10-13';
    const d = data({
      visits: [...data().visits, visit('w1', 'c1', '09:00', '09:00', { windowKind: 'fixed', date: next })],
      aiPlans: { [DATE]: plan({ s1: ['v1', 'v2', 'v3'] }), [next]: plan({ s1: ['w1'] }, next) },
    });
    const days = workMonth(d, '2026-10');
    expect(days).toHaveLength(31);
    const t = workTotals(days).get('s1')!;
    expect(t.days).toBe(2);
    expect(t.count).toBe(4);
    expect(t.span).toBe(6.5 * 60 + 60);
    expect(t.maxSpan).toBe(6.5 * 60);
    const tsv = workloadTsv(days, [{ id: 's1', name: '山田 花' }], d.org).split('\n');
    expect(tsv[0]!.split('\t')).toContain('交通費（円）');
    expect(tsv[1]!.split('\t')[0]).toBe('山田 花');
    expect(tsv[1]!.split('\t')[12]).toBe('6:30');
    const noFare = workloadTsv(days, [{ id: 's1', name: '山田 花' }], { ...d.org, fareYenPerKm: 0 });
    expect(noFare).not.toContain('交通費');
    expect(hmText(65)).toBe('1:05');
  });
});
