// 欠勤の振り直し（ADR-0011）。design.md §4 reassign の完了の条件
import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import type { Absence } from '../contracts/documents';
import type { Problem } from '../contracts/problem';
import { addDays } from '../domain/time';
import { compile, naiveSeqs, scheduleRoute } from '../matching';
import { client, DATE, makeData, randomData, rule, staff, visit } from '../matching/fixtures';
import { createDemoData } from '../seed';
import { candidatesFor, placeVisit, type Routes, reassign, reassignDiff, targetsOf } from './index';

const fixed = (id: string, c: string, at: string, minutes = 60) =>
  visit(id, c, at, at, { windowKind: 'fixed', durationMinutes: minutes });
const absence = (staffId: string, from: string | null, to: string | null, date = DATE): Absence => ({
  id: `a-${staffId}-${date}`,
  staffId,
  date,
  from,
  to,
  note: '',
});
const routesOf = (p: Problem, seqs: number[][]): Routes =>
  Object.fromEntries(p.staff.map((s, i) => [s.id, seqs[i]!.map((v) => p.visits[v]!.id)]));
const startsOf = (p: Problem, routes: Routes, staffId: string) => {
  const s = p.staff.findIndex((x) => x.id === staffId);
  const vIndex = new Map(p.visits.map((v, i) => [v.id, i]));
  const seq = (routes[staffId] ?? []).map((id) => vIndex.get(id)!).filter((x) => x !== undefined);
  return scheduleRoute(p, s, seq, 'strict');
};

/** s1・s2・s3 の3人（8:00〜18:00）。s1 は4件を持つ */
function small(over: Partial<DemoData> = {}) {
  return makeData({
    staff: [staff('s1', 38.26, 140.87), staff('s2', 38.262, 140.872), staff('s3', 38.3, 140.95)],
    clients: [
      client('c1', 38.261, 140.871),
      client('c2', 38.262, 140.871),
      client('c3', 38.263, 140.871),
      client('c4', 38.264, 140.871),
      client('c5', 38.265, 140.871),
    ],
    visits: [
      fixed('v1', 'c1', '09:00'),
      fixed('v2', 'c2', '10:30'),
      fixed('v3', 'c3', '13:00'),
      fixed('v4', 'c4', '15:00'),
      fixed('v5', 'c5', '10:00'),
    ],
    ...over,
  });
}
const BASE: Routes = { s1: ['v1', 'v2', 'v3', 'v4'], s2: ['v5'], s3: [] };

describe('targetsOf（振り直す訪問）', () => {
  it('欠勤と重なる訪問は absence、欠勤明けに間に合わない訪問は unreachable、重ならず間に合う訪問はならない', () => {
    // 〜13:00 の欠勤：v1・v2 は重なる。v3（13:00）は欠勤明けちょうどで、自宅から移動すると間に合わない
    const p = compile(small({ absences: [absence('s1', null, '13:00')] }), DATE);
    const t = targetsOf(p, BASE, ['s1'], null);
    expect(t).toEqual([
      { visitId: 'v1', fromStaffId: 's1', reason: 'absence' },
      { visitId: 'v2', fromStaffId: 's1', reason: 'absence' },
      { visitId: 'v3', fromStaffId: 's1', reason: 'unreachable' },
    ]);
  });
  it('始まった訪問（earliest ＜ いまの時刻）は振り直さない。終日の欠勤では残りすべて', () => {
    const p = compile(small({ absences: [absence('s1', null, null)] }), DATE);
    // 10:30 ちょうどの v2 はまだ始まっていない
    expect(targetsOf(p, BASE, ['s1'], 10 * 60 + 30).map((x) => x.visitId)).toEqual(['v2', 'v3', 'v4']);
    expect(targetsOf(p, BASE, ['s1'], 10 * 60 + 45).map((x) => x.visitId)).toEqual(['v3', 'v4']);
    expect(targetsOf(p, BASE, ['s1'], null).map((x) => x.visitId)).toEqual(['v1', 'v2', 'v3', 'v4']);
  });
  it('ほかの必須の条件で外れる訪問は notAllowed。問題に無い人・訪問は無視', () => {
    const d = small({ compat: { c4: { s1: -2 } } });
    const p = compile(d, DATE);
    const t = targetsOf(p, { ...BASE, s1: [...BASE.s1!, 'ghost'] }, ['s1', 'nobody'], null);
    expect(t).toEqual([{ visitId: 'v4', fromStaffId: 's1', reason: 'notAllowed' }]);
  });
});

describe('reassign（案A：空き時間に入れるだけ）', () => {
  it('他の人の担当・順番・開始時刻を変えずに入れ、全訪問を固定する', () => {
    const p = compile(small({ absences: [absence('s1', null, '12:00')] }), DATE);
    const targets = targetsOf(p, BASE, ['s1'], null);
    const r = reassign(p, BASE, targets, { now: null });
    const s2Before = startsOf(p, BASE, 's2')!;
    const s2After = startsOf(p, r.routes, 's2')!;
    const moved = new Set(r.placed.map((x) => x.visitId));
    expect(r.routes.s2!.filter((id) => !moved.has(id))).toEqual(BASE.s2);
    for (const stop of s2Before.stops) {
      expect(s2After.stops.find((x) => x.visitId === stop.visitId)!.start).toBe(stop.start);
    }
    // 欠勤の人の残り（v3・v4）はその人のまま
    expect(r.routes.s1).toEqual(['v3', 'v4']);
    for (const pl of r.placed) expect(p.allowed[p.visits.findIndex((v) => v.id === pl.visitId)]![0]).toBe(false);
    // pins：担当のいるすべての訪問。unplaced はどの列にも無い
    const assigned = Object.entries(r.routes).flatMap(([sid, ids]) => ids.map((id) => [id, sid]));
    expect(r.pins).toEqual(Object.fromEntries(assigned));
    for (const id of r.unplaced) expect(assigned.some(([v]) => v === id)).toBe(false);
    expect([...r.unassigned].sort()).toEqual([...r.unplaced].sort());
    // strict を守る
    for (const st of p.staff) expect(startsOf(p, r.routes, st.id)).not.toBeNull();
  });
  it('入れた訪問はいまの時刻より前に始めない。入らない訪問は unplaced に残す', () => {
    const p = compile(small({ absences: [absence('s1', null, null)] }), DATE);
    const now = 9 * 60 + 30;
    const targets = targetsOf(p, BASE, ['s1'], now);
    expect(targets.map((t) => t.visitId)).toEqual(['v2', 'v3', 'v4']);
    const r = reassign(p, BASE, targets, { now });
    for (const st of p.staff) {
      const t = startsOf(p, r.routes, st.id);
      for (const stop of t?.stops ?? []) {
        if (r.placed.some((x) => x.visitId === stop.visitId)) expect(stop.start).toBeGreaterThanOrEqual(now);
      }
    }
    // 始まった v1 は欠勤の人の列に残る
    expect(r.routes.s1).toEqual(['v1']);
  });
  it('入れる順：入れられる人の少ない訪問から（同じなら regret の大きい訪問）。同じ入力で同じ結果', () => {
    // s1 が終日欠勤。v2 は s2 だけ（s3 は必要条件で外れる）→ 先に入れる
    const d = small({
      absences: [absence('s1', null, null)],
      rules: [rule('req', 'clientRequirement', 0, true)],
      staff: [
        staff('s1', 38.26, 140.87, { traits: { license: ['看護師'] } }),
        staff('s2', 38.262, 140.872, { traits: { license: ['看護師'] } }),
        staff('s3', 38.3, 140.95, { traits: { license: ['なし'] } }),
      ],
      clients: [
        client('c1', 38.261, 140.871),
        client('c2', 38.262, 140.871, { requirements: [{ itemId: 'license', op: 'hasAny', value: ['看護師'] }] }),
        client('c3', 38.263, 140.871),
        client('c4', 38.264, 140.871),
        client('c5', 38.265, 140.871),
      ],
    });
    const p = compile(d, DATE);
    const base: Routes = { s1: ['v1', 'v2', 'v3', 'v4'], s2: [], s3: [] };
    const targets = targetsOf(p, base, ['s1'], null);
    const r = reassign(p, base, targets, { now: null });
    expect(r.placed[0]!.visitId).toBe('v2');
    expect(r.placed[0]!.staffId).toBe('s2');
    expect(reassign(p, base, targets, { now: null })).toEqual(r);
  });
  it('入れられる人の数が同じなら regret（最良と次善の差）の大きい訪問から（開始の早さより先）', () => {
    const d = makeData({
      staff: [staff('s1', 38.3, 140.9), staff('s2', 38.26, 140.87), staff('s3', 38.26, 140.97)],
      clients: [client('cx', 38.26, 140.871), client('cy', 38.26, 140.92)],
      // y は2人の真ん中（regret 小）で早い、x は s2 のすぐ近く（regret 大）で遅い
      visits: [fixed('y', 'cy', '10:00'), fixed('x', 'cx', '14:00')],
      absences: [absence('s1', null, null)],
    });
    const p = compile(d, DATE);
    const base: Routes = { s1: ['y', 'x'], s2: [], s3: [] };
    const r = reassign(p, base, targetsOf(p, base, ['s1'], null), { now: null });
    expect(r.placed.map((x) => x.visitId)).toEqual(['x', 'y']);
    expect(r.placed[0]!.staffId).toBe('s2');
  });
  it('件数の上限（必須の負担の均等）を超えない', () => {
    const d = small({ absences: [absence('s1', null, null)], rules: [rule('bal', 'balance', 3, true)] });
    const p = compile(d, DATE);
    const r = reassign(p, BASE, targetsOf(p, BASE, ['s1'], null), { now: null });
    p.staff.forEach((st, s) => {
      const n = (r.routes[st.id] ?? []).length;
      expect(n).toBeLessThanOrEqual(p.balance!.cap![s]!);
    });
  });
  it('性質：seed の14日・各スタッフの終日・午前・午後の欠勤で、他の人の訪問の担当・順番・開始時刻は変わらない', () => {
    const today = '2026-10-12';
    const data = createDemoData(today);
    for (let k = 0; k < 14; k++) {
      const date = addDays(today, k);
      const plain = compile(data, date);
      const base = routesOf(plain, naiveSeqs(plain));
      for (const st of plain.staff) {
        if (st.slots.length === 0 || (base[st.id] ?? []).length === 0) continue;
        for (const [from, to] of [
          [null, null],
          [null, '12:00'],
          ['12:00', null],
        ] as const) {
          const p = compile({ ...data, absences: [absence(st.id, from, to, date)] }, date);
          const targets = targetsOf(p, base, [st.id], null);
          const r = reassign(p, base, targets, { now: null });
          const tIds = new Set(targets.map((t) => t.visitId));
          const placed = new Map(r.placed.map((x) => [x.visitId, x.staffId]));
          for (const other of p.staff) {
            const expected = (base[other.id] ?? []).filter((id) => other.id !== st.id || !tIds.has(id));
            expect((r.routes[other.id] ?? []).filter((id) => !placed.has(id))).toEqual(expected);
            if (other.id === st.id) continue;
            const before = startsOf(p, base, other.id);
            const after = startsOf(p, r.routes, other.id);
            expect(after).not.toBeNull();
            for (const stop of before?.stops ?? []) {
              expect(after!.stops.find((x) => x.visitId === stop.visitId)!.start).toBeCloseTo(stop.start, 6);
            }
          }
          // 振り直した訪問は可・件数の上限を守る
          for (const [vid, sid] of placed) {
            const v = p.visits.findIndex((x) => x.id === vid);
            const s = p.staff.findIndex((x) => x.id === sid);
            expect(p.allowed[v]![s]).toBe(true);
            if (p.balance?.cap) expect((r.routes[sid] ?? []).length).toBeLessThanOrEqual(p.balance.cap[s]!);
          }
          expect(r.placed.length + r.unplaced.length).toBe(targets.length);
        }
      }
    }
  });
});

describe('candidatesFor・placeVisit', () => {
  it('入る人が先で増える費用の小さい順。入らない人は「ずらせば入る」分と理由を返す', () => {
    // s2 は v5（10:00〜11:00）を持つ。v2（10:30）は s2 には重なる、s3 には入る
    const d = small({ absences: [absence('s1', null, null)] });
    const p = compile(d, DATE);
    const routes: Routes = { s1: [], s2: ['v5'], s3: [] };
    const c = candidatesFor(p, routes, 'v2', { now: null });
    expect(c.map((x) => x.staffId)).toEqual(['s3', 's2', 's1']);
    expect(c[0]).toMatchObject({ staffId: 's3', fits: true, shiftMinutes: null, overCap: false });
    expect(c[0]!.addedTravel).toBeGreaterThan(0);
    // s2 は v5 が 11:00 に終わり移動して入るには少し遅らせる
    expect(c[1]!.fits).toBe(false);
    expect(c[1]!.shiftMinutes).toBeGreaterThan(0);
    expect(c[1]!.shiftMinutes! % 5).toBe(0);
    // s1 は欠勤（終日）：ずらしても入らず、理由が出る
    expect(c[2]).toMatchObject({ staffId: 's1', fits: false, shiftMinutes: null });
    expect(c[2]!.violations[0]).toMatchObject({ ruleId: 'slot', label: '欠勤（終日）' });
    expect(candidatesFor(p, routes, 'ghost', { now: null })).toEqual([]);
  });
  it('placeVisit は候補の「入る」と同じ位置に入れ、入らない人には bestInsertion と同じ規則（時刻は変えない）', () => {
    const d = small({ absences: [absence('s1', null, null)] });
    const p = compile(d, DATE);
    const routes: Routes = { s1: [], s2: ['v5'], s3: ['v1'] };
    const r3 = placeVisit(p, routes, 'v2', 's3', { now: null });
    expect(r3.s3).toEqual(['v1', 'v2']);
    const r2 = placeVisit(p, routes, 'v2', 's2', { now: null });
    expect(r2.s2).toEqual(['v5', 'v2']);
    // 時間の約束を守れない（違反として見える）
    expect(startsOf(p, r2, 's2')).toBeNull();
    // 元の列から抜く
    const again = placeVisit(p, r3, 'v2', 's2', { now: null });
    expect(again.s3).toEqual(['v1']);
  });
});

describe('reassignDiff', () => {
  it('担当が変わった訪問・開始が変わった訪問・入らない訪問・変わる人・移動の増減', () => {
    const p = compile(small(), DATE);
    const before: Routes = { s1: ['v1', 'v2', 'v3'], s2: ['v5'], s3: [] };
    const after: Routes = { s1: ['v1', 'v3'], s2: ['v5', 'v2'], s3: [] };
    const x = reassignDiff({ problem: p, routes: before }, { problem: p, routes: after });
    expect(x.moved).toEqual([{ visitId: 'v2', from: 's1', to: 's2' }]);
    expect(x.unplaced).toEqual([]);
    expect(x.changedStaff).toEqual(['s1', 's2']);
    // v2 は s2 では 10:30 に間に合わない（lenient で遅れる）
    expect(x.shifted).toEqual([]);
    const y = reassignDiff({ problem: p, routes: before }, { problem: p, routes: { s1: ['v1'], s2: ['v5'] } });
    expect(y.unplaced).toEqual(['v2', 'v3']);
    expect(y.travelDelta).toBeLessThan(0);
  });
  it('担当が同じで開始が変わった訪問は shifted（正＝遅く）', () => {
    const d = small({
      visits: [visit('w1', 'c1', '09:00', '12:00'), fixed('w2', 'c2', '09:00')],
    });
    const p = compile(d, DATE);
    const x = reassignDiff({ problem: p, routes: { s1: ['w1'] } }, { problem: p, routes: { s1: ['w2', 'w1'] } });
    expect(x.moved).toEqual([{ visitId: 'w2', from: null, to: 's1' }]);
    expect(x.shifted.length).toBe(1);
    expect(x.shifted[0]!.visitId).toBe('w1');
    expect(x.shifted[0]!.minutes).toBeGreaterThanOrEqual(60);
  });
});

describe('速さ', () => {
  it('30人・150件で1秒以内', () => {
    const d = randomData(30, 150, 7);
    const plain = compile(d, DATE);
    const base = routesOf(plain, naiveSeqs(plain));
    const sid = plain.staff.find((s) => (base[s.id] ?? []).length > 3)!.id;
    const p = compile({ ...d, absences: [absence(sid, null, null)] }, DATE);
    const t0 = performance.now();
    const targets = targetsOf(p, base, [sid], null);
    const r = reassign(p, base, targets, { now: null });
    for (const id of r.unplaced) candidatesFor(p, r.routes, id, { now: null });
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(targets.length).toBeGreaterThan(0);
  });
});
