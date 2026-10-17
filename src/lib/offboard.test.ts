// 退職・担当替えの一括振り直し・最終勤務日（PRD D71。ADR-0015）
import { describe, expect, it } from 'vitest';
import type { AiPlan, DemoData } from '../contracts/data';
import type { Pattern } from '../contracts/documents';
import { afterLastDay, availabilityOf } from '../domain/availability';
import { AFTER_LAST_DAY, compile } from '../matching';
import { client, DATE, makeData, staff, visit } from '../matching/fixtures';
import { applyOffboard, defaultChoice, offboardScope } from './offboard';
import { absentLeftIds } from './requestedOff';

/** DATE（月曜）の翌日 */
const TUE = '2026-10-13';

const plan = (routes: Record<string, string[]>, date: string): AiPlan => ({
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

const pattern = (id: string, clientId: string, over: Partial<Pattern> = {}): Pattern => ({
  id,
  clientId,
  typeId: null,
  weekdays: [1, 2, 3, 4, 5],
  everyWeeks: 1,
  repeat: 'weekly',
  monthWeeks: [],
  dayTimes: [],
  windowKind: 'fixed',
  earliestStart: '10:00',
  latestStart: '10:00',
  durationMinutes: 60,
  from: DATE,
  to: null,
  usualStaffId: null,
  note: '',
  ...over,
});

function data(over: Partial<DemoData> = {}): DemoData {
  return makeData({
    staff: [
      staff('s1', 38.26, 140.87, { name: '山田 花', lastDay: DATE }),
      staff('s2', 38.27, 140.88, { name: '佐藤 一' }),
      staff('s3', 38.28, 140.89, { name: '鈴木 三', traits: { gender: '男性' } }),
    ],
    clients: [
      client('c1', 38.265, 140.875, { displayName: '青葉', usualStaffId: 's1' }),
      client('c2', 38.266, 140.876, { displayName: '泉', allowedStaffIds: ['s1'] }),
      client('c3', 38.267, 140.877, { displayName: '宮城野', usualStaffId: 's2' }),
      client('c4', 38.268, 140.878, { displayName: '若林', usualStaffId: 's1', stage: 'ended', active: false }),
    ],
    patterns: [pattern('p1', 'c1'), pattern('p2', 'c2', { earliestStart: '13:00', latestStart: '13:00' })],
    visits: [
      visit(`${TUE}_p1`, 'c1', '10:00', '10:00', {
        windowKind: 'fixed',
        date: TUE,
        pattern: { id: 'p1', date: TUE, edited: false },
      }),
      visit(`${TUE}_p2`, 'c2', '13:00', '13:00', {
        windowKind: 'fixed',
        date: TUE,
        pattern: { id: 'p2', date: TUE, edited: false },
      }),
    ],
    ...over,
  });
}

describe('最終勤務日（availabilityOf・compile）', () => {
  it('最終勤務日の翌日からは勤務なし（日ごとの上書きも見ない）。当日までは今までどおり', () => {
    const s = staff('s1', 0, 0, { lastDay: DATE });
    expect(afterLastDay(s, DATE)).toBe(false);
    expect(afterLastDay(s, TUE)).toBe(true);
    expect(availabilityOf(s, DATE, null).slots).toHaveLength(1);
    expect(availabilityOf(s, TUE, null).slots).toEqual([]);
    expect(availabilityOf(s, TUE, { slots: [{ start: '09:00', end: '12:00' }] }).slots).toEqual([]);
    expect(afterLastDay(staff('s2', 0, 0), TUE)).toBe(false);
  });

  it('compile は最終勤務日の後の人を「最終勤務日の後」で外し、その人に残る訪問を absentLeftIds で数える', () => {
    const d = data();
    const p = compile(d, TUE);
    const v = p.visits.findIndex((x) => x.id === `${TUE}_p1`);
    expect(p.allowed[v]![0]).toBe(false);
    expect(p.reasons[v]![0]!.some((r) => r.ruleId === 'slot' && r.label === AFTER_LAST_DAY)).toBe(true);
    expect(absentLeftIds(p, { s1: [`${TUE}_p1`], s2: [`${TUE}_p2`] })).toEqual([`${TUE}_p1`]);
  });
});

describe('振り直しの範囲と候補（offboardScope）', () => {
  it('最終勤務日の後に担当している訪問（確定・今の案）と、その人を持つ〈利用者さん〉（終了の人は除く）', () => {
    const d = data({
      aiPlans: { [TUE]: plan({ s1: [`${TUE}_p1`], s2: [`${TUE}_p2`] }, TUE) },
      manualPlans: { [TUE]: { s1: [`${TUE}_p1`, `${TUE}_p2`] } },
    });
    const sc = offboardScope(d, 's1', DATE)!;
    expect(sc.lastDay).toBe(DATE);
    expect(sc.from).toBe(TUE);
    expect(sc.visits).toEqual([
      { date: TUE, visitId: `${TUE}_p1`, clientId: 'c1', confirmed: true, plan: true },
      { date: TUE, visitId: `${TUE}_p2`, clientId: 'c2', confirmed: true, plan: false },
    ]);
    expect(new Map(sc.clients.map((c) => [c.clientId, c.roles]))).toEqual(
      new Map([
        ['c1', ['usual']],
        ['c2', ['allowed']],
      ]),
    );
    expect(offboardScope(data({ staff: [staff('s1', 0, 0)] }), 's1', DATE)).toBeNull();
  });

  it('候補は最終勤務日の人を除き、入れる回の多い順。必須の条件で外れる人は入れる回が 0', () => {
    const d = data({
      rules: [{ id: 'req', type: 'clientRequirement', label: '必要条件', weight: 0, hard: true }],
      clients: data().clients.map((c) =>
        c.id === 'c1' ? { ...c, requirements: [{ itemId: 'gender', op: 'is' as const, value: '女性' }] } : c,
      ),
      staff: [
        staff('s1', 38.26, 140.87, { name: '山田 花', lastDay: DATE, traits: { gender: '女性' } }),
        staff('s2', 38.27, 140.88, { name: '佐藤 一', traits: { gender: '女性' } }),
        staff('s3', 38.28, 140.89, { name: '鈴木 三', traits: { gender: '男性' } }),
      ],
    });
    const sc = offboardScope(d, 's1', DATE)!;
    const c1 = sc.clients.find((c) => c.clientId === 'c1')!;
    // 見本の期間（28日）の平日の訪問を数える（定期パターンの未展開の回も）
    expect(c1.sample).toBeGreaterThan(10);
    expect(c1.candidates.map((x) => x.staffId)).toEqual(['s2', 's3']);
    expect(c1.candidates[0]!.fits).toBe(c1.sample);
    expect(c1.candidates[1]!.fits).toBe(0);
    expect(defaultChoice(c1)).toBe('s2');
    // 担当できる人を限っていても、置き換えるので候補は限らない（s3 も入れる）
    const c2 = sc.clients.find((c) => c.clientId === 'c2')!;
    expect(c2.candidates.every((x) => x.fits === c2.sample)).toBe(true);
  });
});

describe('まとめて適用（applyOffboard）', () => {
  const ids = () => {
    let n = 0;
    return () => `new${++n}`;
  };

  it('数え始める日から移す：続くパターンは分け（前はその人・後ろは代わりの人）、いつもの担当・担当できる人も。案は変えない', () => {
    const d = data({
      patterns: [
        pattern('p1', 'c1', { usualStaffId: 's1' }),
        pattern('p0', 'c1', { usualStaffId: 's1', from: '2026-09-01', to: '2026-10-01' }),
        pattern('p2', 'c2'),
      ],
      aiPlans: { [TUE]: plan({ s1: [`${TUE}_p1`] }, TUE) },
    });
    const x = applyOffboard(d, 's1', { c1: 's3', c2: 's2' }, TUE, DATE, ids());
    const c = new Map(x.clients.map((y) => [y.id, y]));
    expect(c.get('c1')!.usualStaffId).toBe('s3');
    // 担当できる人は代わりの人を足す（その人は最終勤務日まで勤めるので残す）
    expect(c.get('c2')!.allowedStaffIds).toEqual(['s1', 's2']);
    // 選んでいない〈利用者さん〉（終了の人）は変えない
    expect(c.get('c4')!.usualStaffId).toBe('s1');
    const p = new Map(x.patterns.map((y) => [y.id, y]));
    // 分けた：前（元の ID）はその人で最終勤務日まで、後ろ（新しい ID）は代わりの人で数え始める日から
    expect([p.get('p1')!.usualStaffId, p.get('p1')!.to]).toEqual(['s1', DATE]);
    expect([p.get('new1')!.usualStaffId, p.get('new1')!.from, p.get('new1')!.to]).toEqual(['s3', TUE, null]);
    // 終わったパターンは変えない
    expect(p.get('p0')!.usualStaffId).toBe('s1');
    // 分けたパターンの数え始める日からの訪問は作り直す（ID が新しいパターンの回）
    expect(x.visits.some((v) => v.id === `${TUE}_p1`)).toBe(false);
    expect(x.visits.some((v) => v.id === `${TUE}_new1` && v.clientId === 'c1')).toBe(true);
    expect(x.aiPlans).toBe(d.aiPlans);
    // 振り直しが済むと範囲に〈利用者さん〉は残らない
    expect(offboardScope(x, 's1', DATE)!.clients).toEqual([]);
  });

  it('前の日の「いつもの担当」は変えない（その人が勤める日の問題のキーが変わらない）', () => {
    const d = data({
      visits: [
        ...data().visits,
        visit(`${DATE}_p1`, 'c1', '10:00', '10:00', {
          windowKind: 'fixed',
          pattern: { id: 'p1', date: DATE, edited: false },
        }),
      ],
    });
    const rules = [{ id: 'cont', type: 'continuity' as const, label: 'いつもの担当', weight: 2, hard: false }];
    const before = compile({ ...d, rules }, DATE);
    const x = applyOffboard(d, 's1', { c1: 's2' }, TUE, DATE, ids());
    const after = compile({ ...x, rules }, DATE);
    expect(after.assignCost).toEqual(before.assignCost);
    // 後ろの日は代わりの人がいつもの担当
    const tue = compile({ ...x, rules }, TUE);
    const v = tue.visits.findIndex((y) => y.clientId === 'c1');
    expect(tue.reasons[v]![1]!.some((r) => r.label === 'いつもの担当')).toBe(true);
  });

  it('だれにもしない（null）：いつもの担当は無しに、担当できる人からは外す（全員いなくなれば限らない）', () => {
    const d = data();
    const x = applyOffboard(d, 's1', { c1: null, c2: null }, TUE, DATE, ids());
    const c = new Map(x.clients.map((y) => [y.id, y]));
    expect(c.get('c1')!.usualStaffId).toBeNull();
    expect(c.get('c2')!.allowedStaffIds).toEqual([]);
    expect(offboardScope(x, 's1', DATE)!.clients).toEqual([]);
  });
});
