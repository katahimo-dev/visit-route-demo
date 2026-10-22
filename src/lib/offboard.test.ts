// 退職・担当替えの一括振り直し・最終勤務日（PRD D71。ADR-0015）
import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import type { Pattern } from '../contracts/documents';
import { afterLastDay, availabilityOf } from '../domain/availability';
import { AFTER_LAST_DAY, compile } from '../matching';
import { client, DATE, makeData, staff } from '../matching/fixtures';
import { findVisit, putVisits, visitsOn } from '../patterns';
import { applyOffboard, applyOffboardWith, defaultChoice, offboardScope, unlimitedBy } from './offboard';
import { absentLeftIds } from './requestedOff';

/** DATE（月曜）の翌日 */
const TUE = '2026-10-13';

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
      client('c1', 38.265, 140.875, { displayName: '青葉' }),
      client('c2', 38.266, 140.876, { displayName: '泉', allowedStaffIds: ['s1'] }),
      client('c3', 38.267, 140.877, { displayName: '宮城野' }),
      client('c4', 38.268, 140.878, { displayName: '若林', stage: 'ended', active: false }),
    ],
    // 繰り返しの担当（版2）：c1 は s1、c4（終了）も s1
    patterns: [
      pattern('p1', 'c1', { usualStaffId: 's1' }),
      pattern('p2', 'c2', { earliestStart: '13:00', latestStart: '13:00' }),
      pattern('p4', 'c4', { usualStaffId: 's1' }),
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
    // 版2：繰り返しの担当のまま計算した回は、日の検査で「担当が休み」になる
    expect(findVisit(d, `${TUE}_p1`)!.staffId).toBe('s1');
  });
});

describe('振り直しの範囲と候補（offboardScope。版2）', () => {
  it('最終勤務日の後に担当している訪問（計算した回も・伝えた日の印）と、その人を持つ〈利用者さん〉（終了の人は除く）', () => {
    const d0 = data();
    const p2 = findVisit(d0, `${TUE}_p2`)!;
    const d: DemoData = {
      ...d0,
      visits: putVisits(d0.visits, [{ ...p2, staffId: 's1' }]),
      snapshots: { [TUE]: { date: TUE, at: 1, visits: [] } },
    };
    const sc = offboardScope(d, 's1', DATE)!;
    expect(sc.lastDay).toBe(DATE);
    expect(sc.from).toBe(TUE);
    expect(sc.visits.filter((v) => v.date === TUE)).toEqual([
      { date: TUE, visitId: `${TUE}_p1`, clientId: 'c1', confirmed: true, plan: true },
      { date: TUE, visitId: `${TUE}_p2`, clientId: 'c2', confirmed: true, plan: true },
    ]);
    expect(new Map(sc.clients.map((c) => [c.clientId, c.roles]))).toEqual(
      new Map([
        ['c1', ['pattern']],
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
    // 見本の期間（28日）の平日の回を数える
    expect(c1.sample).toBeGreaterThan(10);
    expect(c1.candidates.map((x) => x.staffId)).toEqual(['s2', 's3']);
    expect(c1.candidates[0]!.fits).toBe(c1.sample);
    expect(c1.candidates[1]!.fits).toBe(0);
    expect(defaultChoice(c1)).toBe('s2');
    // 担当できる人を限っていても、置き換えるので候補は限らない
    const c2 = sc.clients.find((c) => c.clientId === 'c2')!;
    expect(c2.candidates.every((x) => x.fits === c2.sample)).toBe(true);
  });
});

describe('まとめて適用（applyOffboard。版2）', () => {
  const ids = () => {
    let n = 0;
    return () => `new${++n}`;
  };

  it('数え始める日から移す：続く繰り返しは分け（前はその人・後ろは代わりの人）、担当できる人には代わりの人を足す', () => {
    const d = data({
      patterns: [
        pattern('p1', 'c1', { usualStaffId: 's1' }),
        pattern('p0', 'c1', { usualStaffId: 's1', from: '2026-09-01', to: '2026-10-01' }),
        pattern('p2', 'c2'),
      ],
    });
    const x = applyOffboard(d, 's1', { c1: 's3', c2: 's2' }, TUE, DATE, ids());
    const c = new Map(x.clients.map((y) => [y.id, y]));
    expect(c.get('c2')!.allowedStaffIds).toEqual(['s1', 's2']);
    const p = new Map(x.patterns.map((y) => [y.id, y]));
    expect([p.get('p1')!.usualStaffId, p.get('p1')!.to]).toEqual(['s1', DATE]);
    expect([p.get('new1')!.usualStaffId, p.get('new1')!.from, p.get('new1')!.to]).toEqual(['s3', TUE, null]);
    // 終わった繰り返しは変えない
    expect(p.get('p0')!.usualStaffId).toBe('s1');
    // 前の日はその人、数え始める日からは代わりの人の回
    expect(findVisit(x, `${DATE}_p1`)!.staffId).toBe('s1');
    expect(findVisit(x, `${TUE}_p1`)).toBeNull();
    expect(findVisit(x, `${TUE}_new1`)!.staffId).toBe('s3');
    // 振り直しが済むと範囲に〈利用者さん〉は残らない
    expect(offboardScope(x, 's1', DATE)!.clients).toEqual([]);
  });

  it('数え始める日からの保存した回で、担当がその人のものも代わりの人に（ピン・組んだ開始は外す）', () => {
    const d0 = data({ patterns: [pattern('p2', 'c2')] });
    const v = findVisit(d0, `${TUE}_p2`)!;
    const d = { ...d0, visits: putVisits(d0.visits, [{ ...v, staffId: 's1', pinned: true, start: '13:00' }]) };
    const x = applyOffboard(d, 's1', { c2: 's2' }, TUE, DATE, ids());
    expect(findVisit(x, `${TUE}_p2`)).toMatchObject({ staffId: 's2', pinned: false, start: null });
  });

  it('前の日の「いつもの担当」は変えない（その人が勤める日の問題が変わらない）', () => {
    const d = data();
    const rules = [{ id: 'cont', type: 'continuity' as const, label: 'いつもの担当', weight: 2, hard: false }];
    const before = compile({ ...d, rules }, DATE);
    const x = applyOffboard(d, 's1', { c1: 's2' }, TUE, DATE, ids());
    const after = compile({ ...x, rules }, DATE);
    expect(after.assignCost).toEqual(before.assignCost);
    const tue = compile({ ...x, rules }, TUE);
    const v = tue.visits.findIndex((y) => y.clientId === 'c1');
    expect(tue.reasons[v]![1]!.some((r) => r.label === 'いつもの担当')).toBe(true);
  });

  it('だれにもしない（null）：繰り返しの担当は無しに、担当できる人からは外す（全員いなくなれば限らない）', () => {
    const x = applyOffboard(data(), 's1', { c1: null, c2: null }, TUE, DATE, ids());
    expect(x.patterns.find((p) => p.id === 'new1')!.usualStaffId).toBeNull();
    expect(x.clients.find((c) => c.id === 'c2')!.allowedStaffIds).toEqual([]);
    expect(offboardScope(x, 's1', DATE)!.clients).toEqual([]);
  });

  it('この回だけ変えた・取り消した回は新しい繰り返しの回にする（前の日の回は元のまま）', () => {
    const d0 = data();
    const tue = findVisit(d0, `${TUE}_p1`)!;
    const mon = findVisit(d0, `${DATE}_p1`)!;
    const d: DemoData = {
      ...d0,
      visits: putVisits(d0.visits, [
        { ...tue, cancelled: true, pattern: { ...tue.pattern!, edited: true } },
        { ...mon, note: 'メモ', pattern: { ...mon.pattern!, edited: true } },
      ]),
    };
    const r = applyOffboardWith(d, 's1', { c1: 's2' }, TUE, DATE, ids());
    expect(r.renamed).toBe(1);
    const cancelled = r.data.visits.find((v) => v.date === TUE && v.clientId === 'c1')!;
    expect([cancelled.id, cancelled.pattern?.id, cancelled.cancelled]).toEqual([`${TUE}_new1`, 'new1', true]);
    expect(r.data.visits.find((v) => v.date === DATE && v.clientId === 'c1')!.pattern?.id).toBe('p1');
    // 二重にならない
    expect(visitsOn(r.data, TUE).filter((v) => v.clientId === 'c1')).toHaveLength(1);
  });

  it('担当できる人がその人だけの〈利用者さん〉を「だれにもしない」にすると、担当を限らなくなる（確認に出す）', () => {
    const d = data();
    expect(unlimitedBy(d, 's1', { c2: null, c1: null })).toEqual(['c2']);
    expect(unlimitedBy(d, 's1', { c2: 's2' })).toEqual([]);
  });
});
