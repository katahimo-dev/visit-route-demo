import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import { findVisit, putVisits, visitsOn } from '../patterns';
import { createInitialData } from '../seed/plans';
import {
  type BulkConfirm,
  bulkConfirmDialog,
  bulkConfirmLabel,
  bulkConfirmTargets,
  bulkConfirmWhy,
  confirmDay,
  datesText,
  dayLabel,
  nextUnconfirmed,
} from './confirmDay';
import { changedVisitIds, dayProblemOf, dayRoutes, toldChanges } from './dayPlan';
import { type DayStatus, dayStatus } from './month';

const TODAY = '2026-10-21';
const DAY = '2026-10-22';
const base = createInitialData(TODAY);
const problemOf = (d: DemoData, date = DAY) => dayProblemOf(d, date)!;

describe('confirmDay（確定＝伝えた内容。版2。ADR-0053）', () => {
  it('今の担当・開始を伝えた内容として残す。訪問・ほかの日は変えない。日の状態は確定済み', () => {
    const p = problemOf(base);
    const out = confirmDay(base, DAY, p, 123);
    const snap = out.snapshots[DAY]!;
    expect(snap.at).toBe(123);
    expect(snap.visits.map((x) => x.id).sort()).toEqual(p.visits.map((v) => v.id).sort());
    const routes = dayRoutes(base, DAY, p);
    for (const [sid, ids] of Object.entries(routes))
      for (const id of ids) expect(snap.visits.find((x) => x.id === id)?.staffId).toBe(sid);
    expect(out.visits).toBe(base.visits);
    expect(Object.keys(out.snapshots)).toEqual([DAY]);
    expect(dayStatus(out, DAY).state).toBe('told');
    expect(base.snapshots).toEqual({});
  });

  it('伝えたあとに担当を替えると「未連絡の変更」（替えた訪問だけ。外れる人・入る人の連絡）', () => {
    const told = confirmDay(base, DAY, problemOf(base));
    const v = visitsOn(told, DAY).find((x) => x.staffId !== null && !x.cancelled)!;
    const other = told.staff.find((s) => s.id !== v.staffId && s.active)!.id;
    const changed: DemoData = { ...told, visits: putVisits(told.visits, [{ ...v, staffId: other, pinned: true }]) };
    const p = problemOf(changed);
    const c = toldChanges(changed, DAY, p, dayRoutes(changed, DAY, p))!;
    expect(c.staffChanged.map((x) => [x.visitId, x.fromStaffId, x.toStaffId])).toEqual([[v.id, v.staffId, other]]);
    expect(changedVisitIds(c).has(v.id)).toBe(true);
    const s = dayStatus(changed, DAY);
    expect(s.state).toBe('changed');
    expect(s.changes).toBeGreaterThanOrEqual(1);
    // 確定し直すと伝えた状態に戻る
    expect(dayStatus(confirmDay(changed, DAY, p), DAY).state).toBe('told');
  });

  it('伝えたあとに取り消した訪問は「外れる」', () => {
    const told = confirmDay(base, DAY, problemOf(base));
    const v = visitsOn(told, DAY).find((x) => x.staffId !== null && !x.cancelled)!;
    const cancelled: DemoData = { ...told, visits: putVisits(told.visits, [{ ...v, cancelled: true }]) };
    const p = problemOf(cancelled);
    const c = toldChanges(cancelled, DAY, p, dayRoutes(cancelled, DAY, p))!;
    expect(c.staffChanged).toEqual([expect.objectContaining({ visitId: v.id, toStaffId: null })]);
    expect(findVisit(cancelled, v.id)?.cancelled).toBe(true);
  });
});

const st = (date: string, x: Partial<DayStatus>): DayStatus => ({
  date,
  count: 10,
  state: 'none',
  unassigned: 0,
  issues: new Map(),
  care: 0,
  changes: 0,
  absence: false,
  overSpan: [],
  needsCare: false,
  ...x,
});

describe('bulkConfirmTargets（PRD D223）', () => {
  const list: DayStatus[] = [
    st('2026-10-21', {}),
    st('2026-10-22', { state: 'changed', changes: 1 }),
    st('2026-10-23', { unassigned: 1, care: 1, needsCare: true }),
    st('2026-10-24', { care: 2, needsCare: true }),
    st('2026-10-27', { state: 'told' }),
    st('2026-10-28', { count: 0 }),
    // 拘束超（要対応の一覧に出る）は残す
    st('2026-10-30', { overSpan: ['s1'] }),
    // 欠勤だけ（訪問は残っていない）の日は確定する
    st('2026-10-31', { absence: true }),
  ];
  const map = new Map(list.map((s) => [s.date, s]));
  const attention = [{ date: '2026-10-30', kind: 'overSpan' as const }];
  const b = bulkConfirmTargets(
    list.map((s) => s.date),
    (d) => map.get(d),
    attention,
  );
  it('まだ伝えていない日で、要対応の訪問が無く要対応に出ない日だけ', () => {
    expect(b.targets).toEqual(['2026-10-21', '2026-10-31']);
    expect(b.problem).toEqual(['2026-10-23', '2026-10-24', '2026-10-30']);
    // 未連絡の変更のある日は残す（連絡の一覧で確かめる）
    expect(b.changed).toEqual(['2026-10-22']);
  });
  it('状態の分からない日は数えない', () => {
    expect(bulkConfirmTargets(['2026-11-01'], () => undefined).targets).toEqual([]);
  });
  it('ボタン・押せない理由・確認の文', () => {
    expect(bulkConfirmLabel(6)).toBe('問題の無い日をまとめて確定（6日）');
    const none: BulkConfirm = { targets: [], problem: [], changed: [] };
    expect(bulkConfirmWhy(none)).toBe('確定していない日はありません');
    expect(bulkConfirmWhy({ ...none, changed: ['2026-10-22'] })).toContain('連絡の一覧');
    expect(bulkConfirmWhy({ ...none, problem: ['2026-10-23'] })).toContain('要対応');
    const dlg = bulkConfirmDialog(b, 'スタッフ');
    expect(dlg.title).toBe('問題の無い 2日を確定しますか？');
    expect(dlg.body).toContain('10/21（水）・10/31（土） 計 2日');
    expect(dlg.body).toContain('スタッフに伝えた内容として残します');
    expect(dlg.body).toContain('問題のある 3日は残します（要対応で確認）：10/23（金）・10/24（土）・10/30（金）');
    expect(dlg.body).toContain('未連絡の変更のある 1日も残します');
    const plain = bulkConfirmDialog({ ...none, targets: ['2026-10-21'] }, 'ヘルパー');
    expect(plain.body).not.toContain('要対応で確認');
  });
});

describe('datesText・dayLabel・nextUnconfirmed', () => {
  it('日付と曜日・多ければ略して計を添える', () => {
    expect(dayLabel('2026-10-22')).toBe('10/22（木）');
    expect(datesText(['2026-10-22', '2026-10-23'])).toBe('10/22（木）・10/23（金） 計 2日');
    const many = Array.from({ length: 9 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
    const t = datesText(many);
    expect(t.startsWith('11/1（日）・11/2（月）')).toBe(true);
    expect(t).toContain('11/6（金）・… 計 9日');
    expect(t).not.toContain('11/7');
  });
  it('次の確定していない日は date より後の最初の日（無ければ null）', () => {
    const u = ['2026-10-23', '2026-10-21', '2026-10-28'];
    expect(nextUnconfirmed(u, '2026-10-21')).toBe('2026-10-23');
    expect(nextUnconfirmed(u, '2026-10-22')).toBe('2026-10-23');
    expect(nextUnconfirmed(u, '2026-10-28')).toBeNull();
  });
});
