// 版2の日の割当（ADR-0053）：担当は訪問に持ち、日の割当は訪問の担当と開始の並びから決まる
import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import type { Pattern } from '../contracts/documents';
import { addDays } from '../domain/time';
import { client, DATE, makeData, staff, visit } from '../matching/fixtures';
import { findVisit, visitsOn } from '../patterns';
import { createDemoData } from '../seed';
import {
  activeDayVisits,
  changeCount,
  contactsBetween,
  dayProblemOf,
  dayRoutes,
  pinsOf,
  routesOf,
  settleDay,
  tellDay,
  toldChanges,
  toldStateOf,
  unassignedDays,
  unassignedOf,
  visitIssues,
  writeRoutes,
} from './dayPlan';

const fixed = (id: string, c: string, at: string, over = {}) => visit(id, c, at, at, { windowKind: 'fixed', ...over });
const pattern: Pattern = {
  id: 'p1',
  clientId: 'c3',
  typeId: null,
  weekdays: [1],
  everyWeeks: 1,
  repeat: 'weekly',
  monthWeeks: [],
  dayTimes: [],
  windowKind: 'fixed',
  earliestStart: '15:00',
  latestStart: '15:00',
  durationMinutes: 60,
  from: DATE,
  to: null,
  usualStaffId: 's2',
  note: '',
};

/** s1 に v2（11:00）・v1（9:00）、v3 は担当なし、繰り返しの回（15:00）は s2 */
function data(over: Partial<DemoData> = {}): DemoData {
  return makeData({
    staff: [staff('s1', 38.26, 140.87), staff('s2', 38.262, 140.872)],
    clients: [client('c1', 38.261, 140.871), client('c2', 38.262, 140.871), client('c3', 38.263, 140.871)],
    visits: [
      fixed('v2', 'c2', '11:00', { staffId: 's1' }),
      fixed('v1', 'c1', '09:00', { staffId: 's1', pinned: true }),
      fixed('v3', 'c3', '13:00'),
    ],
    patterns: [pattern],
    ...over,
  });
}
const P1 = `${DATE}_p1`;

describe('日の割当（routesOf・pinsOf・unassignedOf）', () => {
  it('訪問の担当を開始の順に並べる。担当なしは列に入らない。ピンは担当のある訪問だけ', () => {
    const d = data();
    const p = dayProblemOf(d, DATE)!;
    const routes = dayRoutes(d, DATE, p);
    expect(routes).toEqual({ s1: ['v1', 'v2'], s2: [P1] });
    expect(routesOf(p, visitsOn(d, DATE))).toEqual(routes);
    expect(unassignedOf(p, routes)).toEqual(['v3']);
    expect(pinsOf(visitsOn(d, DATE))).toEqual({ v1: 's1' });
  });
  it('計算に入れる訪問は取り消し・休み・利用中でない人の訪問を除く', () => {
    const d = data({
      visits: [fixed('v1', 'c1', '09:00', { cancelled: true }), fixed('v2', 'c2', '11:00')],
      clientLeaves: [{ id: 'l', clientId: 'c3', from: DATE, to: DATE, note: '' }],
    });
    expect(activeDayVisits(d, DATE).map((v) => v.id)).toEqual(['v2']);
  });
});

describe('writeRoutes（提案を反映する・担当を替える）', () => {
  it('担当と lenient の開始を訪問に書く。計算した回も変われば保存した回にする。ピンは渡したとおり', () => {
    const d = data();
    const p = dayProblemOf(d, DATE)!;
    const out = writeRoutes(d, DATE, p, { s1: ['v1'], s2: ['v3', P1, 'v2'] }, { pins: { v3: 's2' } });
    expect(findVisit(out, 'v2')).toMatchObject({ staffId: 's2', pinned: false });
    expect(findVisit(out, 'v3')).toMatchObject({ staffId: 's2', start: '13:00', pinned: true });
    expect(findVisit(out, 'v1')).toMatchObject({ staffId: 's1', start: '09:00', pinned: false });
    expect(out.visits.some((v) => v.id === P1)).toBe(true);
    // 担当・開始・ピンが同じなら書かない
    expect(writeRoutes(out, DATE, p, dayRoutes(out, DATE, p))).toBe(out);
  });
  it('pins を渡さなければピンは今のまま（担当なしにした訪問のピンは外す）', () => {
    const d = data();
    const p = dayProblemOf(d, DATE)!;
    const out = writeRoutes(d, DATE, p, { s1: ['v2'], s2: [P1] });
    expect(findVisit(out, 'v1')).toMatchObject({ staffId: null, start: null, pinned: false });
    expect(findVisit(out, 'v2')!.pinned).toBe(false);
  });
  it('settleDay は今の並びのまま開始を書き直す', () => {
    const d = data();
    const settled = settleDay(d, DATE);
    expect(findVisit(settled, 'v1')!.start).toBe('09:00');
    expect(findVisit(settled, 'v2')!.start).toBe('11:00');
  });
});

describe('visitIssues（訪問ごとの検査）', () => {
  it('担当なし・担当が休み（欠勤）・時間に間に合わない', () => {
    const d = data({
      absences: [{ id: 'a', staffId: 's2', date: DATE, from: null, to: null, note: '' }],
      visits: [
        fixed('v1', 'c1', '09:00', { staffId: 's1' }),
        fixed('v2', 'c2', '09:00', { staffId: 's1' }),
        fixed('v3', 'c3', '13:00'),
      ],
    });
    const p = dayProblemOf(d, DATE)!;
    const issues = visitIssues(p, dayRoutes(d, DATE, p), visitsOn(d, DATE));
    expect(issues.get('v3')!.map((x) => x.kind)).toEqual(['unassigned']);
    expect(issues.get(P1)!.map((x) => x.kind)).toEqual(['off']);
    // 同じ人に同じ時刻の2件：どちらかが間に合わない
    expect([issues.get('v1'), issues.get('v2')].flat().some((x) => x?.kind === 'late')).toBe(true);
  });
});

describe('確定（伝えた内容）と未連絡の変更', () => {
  it('伝えたあとに担当・時刻を変えると、連絡の一覧（外れる・入る・時刻が変わる）', () => {
    const d = data();
    const p = dayProblemOf(d, DATE)!;
    const told = tellDay(d, DATE, p, 1);
    expect(toldStateOf(told, DATE, toldChanges(told, DATE, p, dayRoutes(told, DATE, p)))).toBe('told');
    const moved = writeRoutes(told, DATE, p, { s1: ['v1', 'v3'], s2: [P1, 'v2'] });
    const c = toldChanges(moved, DATE, p, dayRoutes(moved, DATE, p))!;
    // 時刻の順（v3 13:00 → v2 は s2 の 15:00 のあと）
    expect(c.staffChanged.map((x) => [x.visitId, x.fromStaffId, x.toStaffId])).toEqual([
      ['v3', null, 's1'],
      ['v2', 's1', 's2'],
    ]);
    expect(c.staff.map((x) => x.staffId)).toEqual(['s1', 's2']);
    expect(toldStateOf(moved, DATE, c)).toBe('changed');
    expect(changeCount(c)).toBe(2);
    expect(toldStateOf(d, DATE, null)).toBe('none');
  });
  it('contactsBetween：開始が1分以上変わった訪問は時刻の変更', () => {
    const at = (staffId: string | null, start: number | null) => ({ clientId: 'c1', staffId, start });
    const c = contactsBetween(
      new Map([
        ['a', at('s1', 540)],
        ['b', at('s1', 600)],
      ]),
      new Map([
        ['a', at('s1', 540.4)],
        ['b', at('s1', 630)],
      ]),
      ['s1'],
    );
    expect(c.timeChanged.map((x) => x.visitId)).toEqual(['b']);
    expect(c.staffChanged).toEqual([]);
  });
});

describe('unassignedDays（担当の足りない日。空き状況。PRD D259）', () => {
  const TODAY = '2026-10-21';
  /** 繰り返しの担当を外したデモのデータ（どの回も担当なし） */
  const unassigned = (): DemoData => {
    const d = createDemoData(TODAY);
    return { ...d, patterns: d.patterns.map((p) => ({ ...p, usualStaffId: null })) };
  };
  it('範囲の今日以降で担当なしの訪問がある日。確定した日・今日より前は入れない', () => {
    const d = unassigned();
    const range = Array.from({ length: 7 }, (_, i) => addDays(TODAY, i - 2));
    const withVisits = range.filter((x) => x >= TODAY && visitsOn(d, x).some((v) => !v.cancelled));
    const all = unassignedDays(d, range, TODAY);
    expect(all).toEqual(withVisits);
    const first = all[0]!;
    const told = { ...d, snapshots: { [first]: { date: first, at: 1, visits: [] } } };
    expect(unassignedDays(told, range, TODAY)).not.toContain(first);
    // 繰り返しの担当で全部埋まっていれば足りない日はほぼ無い
    expect(unassignedDays(createDemoData(TODAY), [TODAY], TODAY).length).toBeLessThanOrEqual(1);
  });
});
