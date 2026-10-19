// 機能の入り切り（ADR-0028。PRD D214）：切った好み・社内の決まり（相性・担当を限る）は compile が読まない。事実は読む
import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import type { Features } from '../contracts/features';
import type { Problem } from '../contracts/problem';
import type { VacancyQuery } from '../contracts/vacancy';
import { achievements, hundredBreakdown, normalize, ruleLowerBounds, score } from '../evaluate';
import { problemKey } from '../lib/runs';
import { scoreReason } from '../lib/scoreReason';
import { fitsOf } from '../reassign';
import { vacancyOf } from '../vacancy';
import { client, DATE, makeData, rule, staff, visit } from './fixtures';
import { ALLOWED_STAFF_RULE_ID, compile } from './index';

/** 2人（s1・s2）と〈利用者さん〉2人。c1 は s1 と相性×・s2 と相性◎、c2 は s1 だけに限る */
function base(over: Partial<DemoData> = {}): DemoData {
  return makeData({
    rules: [rule('r-compat', 'compatibility', 3)],
    staff: [staff('s1', 38.26, 140.87), staff('s2', 38.27, 140.88)],
    clients: [client('c1', 38.265, 140.875), client('c2', 38.266, 140.876, { allowedStaffIds: ['s1'] })],
    compat: { c1: { s1: -2, s2: 2 } },
    visits: [visit('v1', 'c1', '10:00', '11:00'), visit('v2', 'c2', '13:00', '14:00')],
    ...over,
  });
}

const withFeatures = (d: DemoData, features: Features): DemoData => ({ ...d, org: { ...d.org, features } });

describe('機能の入り切り（compile）', () => {
  it('すべて入（{}）は今と同じ：相性×で外れ、担当を限る', () => {
    const d = base();
    const p = compile(d, DATE);
    expect(p.allowed[0]).toEqual([false, true]);
    expect(p.allowed[1]).toEqual([true, false]);
    // 入を明示しても同じ問題
    const q = compile(withFeatures(d, { compat: true, allowedStaff: true }), DATE);
    expect(problemKey(q)).toBe(problemKey(p));
  });

  it('相性を切ると×の組も可になり、理由に相性が出ない。相性のデータが空のときと同じ問題（problemKey も同じ）', () => {
    const d = base();
    const p = compile(withFeatures(d, { compat: false }), DATE);
    expect(p.allowed[0]).toEqual([true, true]);
    expect(p.reasons.flat(2).some((r) => r.label.startsWith('相性'))).toBe(false);
    const empty = compile({ ...d, compat: {} }, DATE);
    expect(problemKey(p)).toBe(problemKey(empty));
    // 担当を限るは入のまま効く
    expect(p.allowed[1]).toEqual([true, false]);
  });

  it('担当を限るを切ると限らないのと同じ問題になり、理由に出ない', () => {
    const d = base();
    const p = compile(withFeatures(d, { allowedStaff: false }), DATE);
    expect(p.allowed[1]).toEqual([true, true]);
    expect(p.reasons.flat(2).some((r) => r.ruleId === ALLOWED_STAFF_RULE_ID)).toBe(false);
    const empty = compile({ ...d, clients: d.clients.map((c) => ({ ...c, allowedStaffIds: [] })) }, DATE);
    expect(problemKey(p)).toBe(problemKey(empty));
    // 相性は入のまま効く
    expect(p.allowed[0]).toEqual([false, true]);
  });

  it('事実は切っても効く：休みの〈利用者さん〉の訪問は入らず、欠勤の人は可にならない', () => {
    const d = base({
      clientLeaves: [{ id: 'l1', clientId: 'c2', from: DATE, to: DATE, note: '入院' }],
      absences: [{ id: 'a1', staffId: 's2', date: DATE, from: null, to: null, note: '希望休' }],
    });
    const off = withFeatures(d, {
      compat: false,
      allowedStaff: false,
      clientLeave: false,
      requestedOff: false,
      sudden: false,
      offboard: false,
      patternMonthly: false,
    });
    const p = compile(off, DATE);
    expect(p.visits.map((v) => v.id)).toEqual(['v1']);
    expect(p.allowed[0]).toEqual([true, false]);
    // 相性・担当を限る以外の機能を切っても問題は変わらない
    const q = compile(withFeatures(d, { ...off.org.features, compat: true, allowedStaff: true }), DATE);
    expect(problemKey(q)).toBe(problemKey(compile(d, DATE)));
  });
});

describe('切ったときの採点・振り直し・空き状況は、そのデータが空のときと同じ（compile を通る先。ADR-0028）', () => {
  /** 採点・達成・点の理由（日の画面・比較の画面と同じ組み立て） */
  const evaluateAll = (p: Problem, routes: Record<string, string[]>) => {
    const sc = score(p, routes);
    const ach = achievements(p, routes);
    const reason = scoreReason(hundredBreakdown(sc, normalize(p), p), sc, {
      achievements: ach,
      rules: [rule('r-compat', 'compatibility', 3)],
      ruleLower: ruleLowerBounds(p),
    });
    return { sc, ach, reason };
  };

  it('相性を切ると score・achievements・scoreReason が相性のデータが空のときと同じ（×の組に担当しても）', () => {
    const d = base();
    // c1 の訪問を相性×の s1 に担当させる
    const routes = { s1: ['v1', 'v2'], s2: [] };
    const off = evaluateAll(compile(withFeatures(d, { compat: false }), DATE), routes);
    const empty = evaluateAll(compile({ ...d, compat: {} }, DATE), routes);
    expect(off).toEqual(empty);
    // 入なら違う（相性が効いている）
    const on = evaluateAll(compile(d, DATE), routes);
    expect(on.sc).not.toEqual(empty.sc);
  });

  it('担当を限るを切ると、振り直しの「受けられる人」（fitsOf）も限らない（限らないデータと同じ）', () => {
    const d = base();
    const routes = { s1: ['v1'], s2: [] };
    const ids = (p: Problem) => fitsOf(p, routes, 'v2').map((f) => f.staffId);
    const on = ids(compile(d, DATE));
    expect(on).toEqual(['s1']);
    const off = ids(compile(withFeatures(d, { allowedStaff: false }), DATE));
    const empty = ids(compile({ ...d, clients: d.clients.map((c) => ({ ...c, allowedStaffIds: [] })) }, DATE));
    expect(off).toEqual(empty);
    expect([...off].sort()).toEqual(['s1', 's2']);
  });

  it('担当を限る・相性を切った空き状況は、そのデータが空のときと同じ', () => {
    const d = { ...base(), manualPlans: { [DATE]: { s1: ['v2'], s2: ['v1'] } } };
    const q: VacancyQuery = {
      typeId: null,
      durationMinutes: 60,
      requirements: [],
      place: { address: '近く', lat: 38.2655, lng: 140.8755 },
      marginMinutes: 15,
      dayStart: '08:00',
      dayEnd: '18:00',
      stepMinutes: 60,
    };
    const range = { from: DATE, weeks: 1 };
    const off = vacancyOf(withFeatures(d, { allowedStaff: false, compat: false }), q, range);
    const empty = vacancyOf(
      { ...d, compat: {}, clients: d.clients.map((c) => ({ ...c, allowedStaffIds: [] })) },
      q,
      range,
    );
    expect(off).toEqual(empty);
  });
});
