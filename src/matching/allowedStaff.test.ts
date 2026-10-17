// 担当できる人を限る（PRD D68。ADR-0014）：限った人以外との組は常に必須で外れる
import { describe, expect, it } from 'vitest';
import { explain } from '../evaluate';
import { problemKey } from '../lib/runs';
import { fitsOf, reassign, targetsOf } from '../reassign';
import { client, DATE, makeData, staff, visit } from './fixtures';
import { ALLOWED_STAFF_RULE_ID, compile } from './index';

const INF = Number.POSITIVE_INFINITY;

/** 3人（s1・s2・s3）と訪問先1か所。c1 は allowed の人だけ */
function threeStaff(allowed: string[], over: Parameters<typeof makeData>[0] = {}) {
  return makeData({
    staff: [staff('s1', 38.26, 140.87), staff('s2', 38.27, 140.88), staff('s3', 38.262, 140.872)],
    clients: [client('c1', 38.265, 140.875, { allowedStaffIds: allowed }), client('c2', 38.266, 140.876)],
    visits: [visit('v1', 'c1', '10:00', '11:00'), visit('v2', 'c2', '13:00', '14:00')],
    ...over,
  });
}

describe('担当できる人を限る（compile）', () => {
  it('限った人だけ可。外れる人の理由は「担当を限る：s1・s3 ✗」（Infinity）、限った人は ✓・0点', () => {
    const p = compile(threeStaff(['s1', 's3']), DATE);
    expect(p.allowed[0]).toEqual([true, false, true]);
    expect(p.reasons[0]![1]).toContainEqual({
      ruleId: ALLOWED_STAFF_RULE_ID,
      label: '担当を限る：s1・s3 ✗',
      points: INF,
    });
    expect(p.reasons[0]![0]).toContainEqual({
      ruleId: ALLOWED_STAFF_RULE_ID,
      label: '担当を限る：s1・s3 ✓',
      points: 0,
    });
    // 限らない〈利用者さん〉の訪問は今までどおり
    expect(p.allowed[1]).toEqual([true, true, true]);
    expect(p.reasons[1]!.flat().some((r) => r.ruleId === ALLOWED_STAFF_RULE_ID)).toBe(false);
  });

  it('空（限らない）なら、項目の無い古いデータと同じ問題になる（problemKey も同じ）', () => {
    const a = compile(threeStaff([]), DATE);
    const plain = threeStaff([]);
    const old = makeData({
      ...plain,
      clients: plain.clients.map(({ allowedStaffIds: _x, ...c }) => c as typeof c & { allowedStaffIds: string[] }),
    });
    // 型の上では必須なので既定値で補う（store の migrate と同じ）
    const b = compile(
      { ...old, clients: old.clients.map((c) => ({ ...c, allowedStaffIds: c.allowedStaffIds ?? [] })) },
      DATE,
    );
    expect(problemKey(a)).toBe(problemKey(b));
  });

  it('休止中・いない人は数えない。限った人が全員いなければ限らない', () => {
    const d = threeStaff(['s2', 'ghost']);
    const off = { ...d, staff: d.staff.map((s) => (s.id === 's2' ? { ...s, active: false } : s)) };
    const p = compile(off, DATE);
    // s2 は問題にいない（休止中）。残る s1・s3 はどちらも可（限らない）
    expect(p.staff.map((s) => s.id)).toEqual(['s1', 's3']);
    expect(p.allowed[0]).toEqual([true, true]);
    // s2 が利用中なら s2 だけ（いない ghost は数えない）
    expect(compile(d, DATE).allowed[0]).toEqual([false, true, false]);
  });

  it('限った人が休みの日は、どの人も可にならず infeasible に原因が出る（入らない訪問の理由）', () => {
    const d = threeStaff(['s2'], { availability: [{ staffId: 's2', date: DATE, slots: [] }] });
    const p = compile(d, DATE);
    expect(p.allowed[0]).toEqual([false, false, false]);
    const why = p.infeasible.find((x) => x.visit === 0)!.reasons.map((r) => r.label);
    expect(why).toContain('担当を限る：s2 ✗（2人）');
    // 説明（evaluate）にも同じ原因
    const ex = explain(p, { s1: [], s2: [], s3: [] }).find((x) => x.visitId === 'v1')!;
    expect(ex.reasons.map((r) => r.label).join('／')).toContain('担当を限る：s2 ✗');
  });

  it('固定で限った人以外にすると可否で外れたまま（必須の違反）。条件の重み・必須に関係しない', () => {
    const d = threeStaff(['s1']);
    const p = compile({ ...d, rules: [] }, DATE, { v1: 's2' });
    expect(p.allowed[0]).toEqual([false, false, false]);
  });
});

describe('担当できる人を限る：振り直し・空き時間に入る人（reassign）', () => {
  it('fitsOf（週のドロップの「入れる人」・空き状況）は限った人だけを返す', () => {
    const p = compile(threeStaff(['s3']), DATE);
    const fits = fitsOf(p, { s1: ['v2'], s2: [], s3: [] }, 'v1');
    expect(fits.map((f) => f.staffId)).toEqual(['s3']);
  });

  it('欠勤の振り直し（案A）は限った人へ入れ、限った人が欠勤なら入らない', () => {
    const base = threeStaff(['s1', 's2']);
    const routes = { s1: ['v1'], s2: [], s3: ['v2'] };
    // s1 が終日の欠勤 → s2 へ（s3 は空いていても限った人でない）
    const absent = { ...base, absences: [{ id: 'a1', staffId: 's1', date: DATE, from: null, to: null, note: '' }] };
    const p = compile(absent, DATE);
    const before = compile(base, DATE);
    const t = targetsOf(p, { problem: before, routes }, ['s1']);
    const r = reassign(p, routes, t);
    expect(r.routes.s2).toEqual(['v1']);
    // s1・s2 とも欠勤 → 入らない
    const both = {
      ...absent,
      absences: [...absent.absences, { id: 'a2', staffId: 's2', date: DATE, from: null, to: null, note: '' }],
    };
    const p2 = compile(both, DATE);
    const r2 = reassign(p2, routes, targetsOf(p2, { problem: before, routes }, ['s1', 's2']));
    expect(r2.unassigned).toContain('v1');
  });
});
