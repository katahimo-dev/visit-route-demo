import { describe, expect, it } from 'vitest';
import type { Problem } from '../contracts/problem';
import { client, DATE, ITEMS, makeData, randomData, rule, staff, visit } from './fixtures';
import { compile, conditionText, matches, routeCost, scheduleRoute } from './index';

const [gender, license, years, pet] = ITEMS;

describe('matches・conditionText', () => {
  it('条件の型ごとに判定する（未入力は not だけ満たす）', () => {
    expect(matches({ itemId: 'gender', op: 'is', value: '女性' }, gender, '女性')).toBe(true);
    expect(matches({ itemId: 'gender', op: 'is', value: '女性' }, gender, null)).toBe(false);
    expect(matches({ itemId: 'gender', op: 'not', value: '女性' }, gender, null)).toBe(true);
    expect(matches({ itemId: 'gender', op: 'in', value: ['女性', '男性'] }, gender, '男性')).toBe(true);
    expect(matches({ itemId: 'license', op: 'hasAny', value: ['看護師'] }, license, ['看護師', '保育士'])).toBe(true);
    expect(matches({ itemId: 'license', op: 'hasAll', value: ['看護師', '介護福祉士'] }, license, ['看護師'])).toBe(
      false,
    );
    expect(matches({ itemId: 'years', op: 'gte', value: 3 }, years, 3)).toBe(true);
    expect(matches({ itemId: 'years', op: 'lte', value: 3 }, years, 4)).toBe(false);
    expect(matches({ itemId: 'pet', op: 'is', value: false }, pet, false)).toBe(true);
    expect(matches({ itemId: 'x', op: 'is', value: 1 }, undefined, 1)).toBe(false);
  });
  it('表示文', () => {
    expect(conditionText({ itemId: 'license', op: 'hasAny', value: ['看護師'] }, license)).toBe('資格に看護師を含む');
    expect(conditionText({ itemId: 'years', op: 'gte', value: 3 }, years)).toBe('経験年数 3以上');
    expect(conditionText({ itemId: 'gender', op: 'is', value: '女性' }, gender)).toBe('性別が女性');
  });
});

/** 2人（s1 看護師・女性、s2 なし・男性）と訪問先1か所 */
function twoStaff(over: Parameters<typeof makeData>[0] = {}, c = {}) {
  return makeData({
    staff: [
      staff('s1', 38.26, 140.87, { traits: { license: ['看護師'], gender: '女性', years: 5 } }),
      staff('s2', 38.27, 140.88, { traits: { license: ['なし'], gender: '男性', years: 1 } }),
    ],
    clients: [client('c1', 38.265, 140.875, c)],
    visits: [visit('v1', 'c1', '10:00', '11:00')],
    ...over,
  });
}

describe('compile：可否と割当費用', () => {
  const req = { requirements: [{ itemId: 'license', op: 'hasAny' as const, value: ['看護師'] }] };

  it('hard の必要条件を満たさない組は可否で外れ、理由に原因が出る', () => {
    const p = compile(twoStaff({ rules: [rule('req', 'clientRequirement', 0, true)] }, req), DATE);
    expect(p.allowed[0]).toEqual([true, false]);
    expect(p.reasons[0]![1]![0]).toEqual({ ruleId: 'req', label: '必要条件：資格に看護師を含む ✗', points: Infinity });
    expect(p.reasons[0]![0]![0]).toMatchObject({ label: '必要条件：資格に看護師を含む ✓', points: 0 });
  });
  it('重み付きなら外さず 重み×10点。重み0・hard でない条件は無効（費用にも理由にも出ない）', () => {
    const p = compile(twoStaff({ rules: [rule('req', 'clientRequirement', 2)] }, req), DATE);
    expect(p.allowed[0]).toEqual([true, true]);
    expect(p.assignCost[0]).toEqual([0, 20]);
    const p0 = compile(twoStaff({ rules: [rule('req', 'clientRequirement', 0)] }, req), DATE);
    expect(p0.assignCost[0]).toEqual([0, 0]);
    expect(p0.reasons[0]).toEqual([[], []]);
  });
  it('希望：満たさない条件1つ＝重み×10、満たせば points 0 で ○', () => {
    const pref = { preferences: [{ itemId: 'years', op: 'gte' as const, value: 3 }] };
    const p = compile(twoStaff({ rules: [rule('pref', 'clientPreference', 3)] }, pref), DATE);
    expect(p.assignCost[0]).toEqual([0, 30]);
    expect(p.reasons[0]![0]).toEqual([{ ruleId: 'pref', label: '希望○ 経験年数 3以上', points: 0 }]);
  });
  it('スタッフ側の必要条件は訪問先の特性を見る', () => {
    const d = twoStaff({ rules: [rule('sreq', 'staffRequirement', 0, true)] }, { traits: { pet: true } });
    d.staff[1]!.requirements = [{ itemId: 'pet', op: 'is', value: false }];
    const p = compile(d, DATE);
    expect(p.allowed[0]).toEqual([true, false]);
  });
  it('項目が無い条件は無視する', () => {
    const d = twoStaff(
      { rules: [rule('req', 'clientRequirement', 0, true)] },
      { requirements: [{ itemId: 'deleted', op: 'is', value: true }] },
    );
    expect(compile(d, DATE).allowed[0]).toEqual([true, true]);
  });
  it('相性：◎＝−重み×10、○＝−重み×5、×は重み0でも外す、hard なら△も外す', () => {
    const compat = { c1: { s1: 2 as const, s2: 1 as const } };
    const p = compile(twoStaff({ rules: [rule('cp', 'compatibility', 3)], compat }), DATE);
    expect(p.assignCost[0]).toEqual([-30, -15]);
    expect(p.reasons[0]![0]![0]!.label).toBe('相性◎');
    const px = compile(twoStaff({ rules: [rule('cp', 'compatibility', 0)], compat: { c1: { s2: -2 } } }), DATE);
    expect(px.allowed[0]).toEqual([true, false]);
    const ph = compile(twoStaff({ rules: [rule('cp', 'compatibility', 1, true)], compat: { c1: { s2: -1 } } }), DATE);
    expect(ph.allowed[0]).toEqual([true, false]);
  });
  it('いつもの担当でない＝重み×10、hard なら外す', () => {
    const p = compile(twoStaff({ rules: [rule('co', 'continuity', 2)] }, { usualStaffId: 's2' }), DATE);
    expect(p.assignCost[0]).toEqual([20, 0]);
    expect(p.reasons[0]![1]![0]!.label).toBe('いつもの担当');
    const ph = compile(twoStaff({ rules: [rule('co', 'continuity', 0, true)] }, { usualStaffId: 's2' }), DATE);
    expect(ph.allowed[0]).toEqual([false, true]);
  });
  it('同じ型の条件が複数あれば各々で数える', () => {
    const pref = { preferences: [{ itemId: 'years', op: 'gte' as const, value: 3 }] };
    const p = compile(
      twoStaff({ rules: [rule('a', 'clientPreference', 1), rule('b', 'clientPreference', 2)] }, pref),
      DATE,
    );
    expect(p.assignCost[0]).toEqual([0, 30]);
  });
  it('休み・作業が収まる時間帯がない組は slot で外れる。全員外れれば infeasible', () => {
    const d = twoStaff();
    d.availability = [{ staffId: 's1', date: DATE, slots: [] }];
    d.visits = [visit('v1', 'c1', '17:30', '17:30')]; // 60分は 18:00 までに収まらない
    const p = compile(d, DATE);
    expect(p.allowed[0]).toEqual([false, false]);
    expect(p.reasons[0]![0]![0]).toMatchObject({ ruleId: 'slot', label: '休み' });
    expect(p.reasons[0]![1]![0]).toMatchObject({ ruleId: 'slot' });
    expect(p.infeasible).toHaveLength(1);
    expect(p.infeasible[0]!.visit).toBe(0);
    expect(p.infeasible[0]!.reasons.map((r) => r.label)).toEqual([
      '休み（1人）',
      '稼働時間帯に作業が収まらない（1人）',
    ]);
  });
  it('位置がない訪問先は noPlace。キャンセル・休止中は入れない', () => {
    const d = twoStaff();
    d.clients.push(client('c2', 0, 0, { place: { address: '', lat: null, lng: null } }));
    d.clients.push(client('c3', 38.2, 140.8, { active: false }));
    d.visits.push(visit('v2', 'c2', '10:00', '11:00'), visit('v3', 'c3', '10:00', '11:00'));
    d.visits.push(visit('v4', 'c1', '10:00', '11:00', { cancelled: true }));
    d.staff.push(staff('s3', 38.2, 140.8, { active: false }));
    const p = compile(d, DATE);
    expect(p.visits.map((v) => v.id)).toEqual(['v1', 'v2']);
    expect(p.staff.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(p.allowed[1]).toEqual([false, false]);
    expect(p.reasons[1]![0]![0]!.ruleId).toBe('noPlace');
    expect(p.visits[1]!.point).toBe(3);
  });
  it('均等：可になる件数を稼働分に比例して配る。待ちは重み×0.1', () => {
    const d = randomData(3, 10, 1, [rule('bal', 'balance', 1), rule('w', 'wait', 3)]);
    d.availability = [{ staffId: 's1', date: DATE, slots: [{ start: '08:00', end: '13:00' }] }];
    const p = compile(d, DATE);
    expect(p.waitPerMinute).toBeCloseTo(0.3);
    expect(p.balance!.perVisit).toBe(10);
    const cap = p.staff.map((s) => s.slots.reduce((a, x) => a + x.end - x.start, 0));
    const sum = cap.reduce((a, b) => a + b, 0);
    const n = p.visits.length - p.infeasible.length;
    p.staff.forEach((_, i) => {
      expect(p.balance!.lo[i]).toBe(Math.floor((n * cap[i]!) / sum));
      expect(p.balance!.hi[i]).toBe(Math.ceil((n * cap[i]!) / sum));
    });
  });
});

/** 時刻の規則を見るための手作りの問題（移動は地点に関係なく10分） */
function timingProblem(slots: { start: number; end: number }[], visits: [number, number, number][]): Problem {
  const P = 1 + visits.length;
  const travel = Array.from({ length: P }, (_, i) => Array.from({ length: P }, (_, j) => (i === j ? 0 : 10)));
  return {
    date: DATE,
    staff: [{ id: 's', name: 's', point: 0, slots }],
    visits: visits.map(([earliest, latest, duration], i) => ({
      id: `v${i}`,
      clientId: `c${i}`,
      point: i + 1,
      earliest,
      latest,
      duration,
    })),
    travel,
    meters: travel.map((r) => r.map((x) => x * 100)),
    allowed: visits.map(() => [true]),
    assignCost: visits.map(() => [0]),
    reasons: visits.map(() => [[]]),
    waitPerMinute: 0.3,
    balance: null,
    infeasible: [],
  };
}

describe('scheduleRoute', () => {
  it('最初の訪問の待ちは0（着く時刻＝開始）、帰りの移動も数える', () => {
    const p = timingProblem([{ start: 480, end: 1080 }], [[600, 660, 60]]);
    const t = scheduleRoute(p, 0, [0], 'strict')!;
    expect(t.stops[0]).toEqual({ visitId: 'v0', arrival: 600, start: 600, end: 660, wait: 0, travelIn: 10 });
    expect(t.travelMinutes).toBe(20);
    expect(t.meters).toBe(2000);
  });
  it('自宅を出るのは最初の時間帯の開始以降', () => {
    const p = timingProblem([{ start: 480, end: 1080 }], [[470, 600, 30]]);
    expect(scheduleRoute(p, 0, [0], 'strict')!.stops[0]!.start).toBe(490);
  });
  it('時間帯の間の抜けにかかる作業は次の時間帯まで待つ', () => {
    const p = timingProblem(
      [
        { start: 480, end: 720 },
        { start: 780, end: 1080 },
      ],
      [
        [600, 600, 60],
        [680, 800, 60],
      ],
    );
    const t = scheduleRoute(p, 0, [0, 1], 'strict')!;
    // 1件目 10:00-11:00 → 移動10分 → 11:10 着、11:10 開始だと 12:10 で 12:00 を超えるので 13:00 開始
    expect(t.stops[1]).toMatchObject({ arrival: 670, start: 780, wait: 110 });
    expect(t.waitMinutes).toBe(110);
  });
  it('latest を超えると strict は null、lenient は time の違反を記録して続ける', () => {
    const p = timingProblem(
      [{ start: 480, end: 1080 }],
      [
        [600, 600, 60],
        [600, 660, 60],
      ],
    );
    expect(scheduleRoute(p, 0, [0, 1], 'strict')).toBeNull();
    const t = scheduleRoute(p, 0, [0, 1], 'lenient')!;
    expect(t.violations).toEqual([{ visitId: 'v1', kind: 'time' }]);
    expect(t.stops[1]!.start).toBe(670);
  });
  it('収まる時間帯がなければ slot の違反', () => {
    const p = timingProblem([{ start: 480, end: 720 }], [[700, 700, 60]]);
    expect(scheduleRoute(p, 0, [0], 'strict')).toBeNull();
    expect(scheduleRoute(p, 0, [0], 'lenient')!.violations).toEqual([{ visitId: 'v0', kind: 'slot' }]);
  });
  it('routeCost は strict の scheduleRoute と同じ値', () => {
    const p = compile(randomData(3, 12, 7, [rule('w', 'wait', 3)]), DATE);
    let a = 1;
    const rand = () => {
      a = (a * 16807) % 2147483647;
      return a / 2147483647;
    };
    let feasible = 0;
    for (let k = 0; k < 300; k++) {
      const s = Math.floor(rand() * p.staff.length);
      const seq = p.visits.map((_, i) => i).filter(() => rand() < 0.25);
      seq.sort((x, y) => p.visits[x]!.earliest - p.visits[y]!.earliest);
      const t = scheduleRoute(p, s, seq, 'strict');
      const c = routeCost(p, s, seq);
      if (!t) {
        expect(c).toBe(Infinity);
        continue;
      }
      feasible++;
      const assign = seq.reduce((acc, v) => acc + p.assignCost[v]![s]!, 0);
      expect(c).toBeCloseTo(t.travelMinutes + t.waitMinutes * p.waitPerMinute + assign, 9);
    }
    expect(feasible).toBeGreaterThan(10);
  });
});

describe('compile：欠勤（ADR-0011）', () => {
  const ab = (from: string | null, to: string | null, staffId = 's1') => ({
    id: `a-${staffId}`,
    staffId,
    date: DATE,
    from,
    to,
    note: '',
  });
  it('欠勤のある人の slots は欠勤を差し引いたもの。重なる訪問は可にならず理由が「欠勤の時間と重なる」', () => {
    const p = compile(twoStaff({ absences: [ab('08:00', '12:00')] }), DATE);
    expect(p.staff[0]!.slots).toEqual([{ start: 12 * 60, end: 18 * 60 }]);
    expect(p.staff[1]!.slots).toEqual([{ start: 8 * 60, end: 18 * 60 }]);
    expect(p.allowed[0]).toEqual([false, true]);
    expect(p.reasons[0]![0]![0]).toEqual({ ruleId: 'slot', label: '欠勤の時間と重なる', points: Infinity });
  });
  it('終日は「欠勤（終日）」', () => {
    const p = compile(twoStaff({ absences: [ab(null, null)] }), DATE);
    expect(p.staff[0]!.slots).toEqual([]);
    expect(p.reasons[0]![0]![0]).toEqual({ ruleId: 'slot', label: '欠勤（終日）', points: Infinity });
  });
  it('途中の欠勤で稼働時間帯が全部なくなったら「欠勤で稼働時間がない」', () => {
    const p = compile(twoStaff({ absences: [ab('08:00', '18:00')] }), DATE);
    expect(p.staff[0]!.slots).toEqual([]);
    expect(p.reasons[0]![0]![0]).toEqual({ ruleId: 'slot', label: '欠勤で稼働時間がない', points: Infinity });
  });
  it('欠勤と重ならない訪問は今までどおり。別の日・別の人の欠勤では問題が変わらない', () => {
    const p = compile(twoStaff({ absences: [ab('14:00', null)] }), DATE);
    expect(p.allowed[0]).toEqual([true, true]);
    const plain = compile(twoStaff(), DATE);
    const other = compile(twoStaff({ absences: [{ ...ab(null, null), date: '2026-10-13' }] }), DATE);
    expect(other).toEqual(plain);
  });
});
