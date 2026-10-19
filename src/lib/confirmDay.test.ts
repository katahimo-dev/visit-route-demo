import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import type { Problem } from '../contracts/problem';
import { NONE } from '../domain/scheduleModel';
import { compile } from '../matching';
import { createDemoData } from '../seed';
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
import { type DayStatus, dayStatus } from './month';

const TODAY = '2026-10-21';
const DAY = '2026-10-22';
const base = createInitialData(TODAY);
const problemOf = (d: DemoData, date = DAY): Problem => compile(d, date);
/** 訪問ID → 担当（未割当を除く） */
const owners = (routes: Record<string, string[]>) => {
  const m = new Map<string, string>();
  for (const [s, ids] of Object.entries(routes)) if (s !== NONE) for (const id of ids) m.set(id, s);
  return m;
};

describe('confirmDay（日の画面の「この割当で確定」と月のまとめて確定で共通）', () => {
  it('確定した割当と各訪問の担当が今の案になり、日の状態は確定済み', () => {
    const out = confirmDay(base, DAY, problemOf(base));
    const plan = owners(base.aiPlans[DAY]!.routes);
    const saved = owners(out.manualPlans[DAY]!);
    expect([...saved].sort()).toEqual([...plan].sort());
    for (const v of out.visits.filter((x) => x.date === DAY)) expect(v.staffId).toBe(plan.get(v.id) ?? null);
    // ほかの日・今の案・記録は変えない
    expect(out.visits.filter((x) => x.date !== DAY)).toEqual(base.visits.filter((x) => x.date !== DAY));
    expect(out.aiPlans).toBe(base.aiPlans);
    expect(out.aiRuns).toBe(base.aiRuns);
    expect(dayStatus(out, DAY).state).toBe('confirmed');
    // 元のデータは書き換えない
    expect(base.manualPlans).toEqual({});
  });

  it('計算に入れていない訪問の担当は、確定した割当（無ければ訪問の担当）のまま', () => {
    const p = problemOf(base);
    const [left, ...rest] = p.visits;
    const narrow: Problem = { ...p, visits: rest };
    const withOwner: DemoData = {
      ...base,
      visits: base.visits.map((v) => (v.id === left!.id ? { ...v, staffId: 's8' } : v)),
    };
    const out = confirmDay(withOwner, DAY, narrow);
    expect(out.visits.find((v) => v.id === left!.id)?.staffId).toBe('s8');
    expect(owners(out.manualPlans[DAY]!).get(left!.id)).toBe('s8');
  });

  it('〈利用者さん〉の休みの訪問は、前に確定した担当のまま残す', () => {
    const first = confirmDay(base, DAY, problemOf(base));
    const v = first.visits.find((x) => x.date === DAY && x.staffId !== null)!;
    const leave: DemoData = {
      ...first,
      clientLeaves: [{ id: 'l1', clientId: v.clientId, from: DAY, to: DAY, note: '' }],
    };
    const out = confirmDay(leave, DAY, problemOf(leave));
    expect(owners(out.manualPlans[DAY]!).get(v.id)).toBe(v.staffId);
  });

  it('今の案が無い日はそのまま', () => {
    const d = createDemoData(TODAY);
    expect(confirmDay(d, DAY, problemOf(d))).toBe(d);
  });
});

const st = (date: string, x: Partial<DayStatus>): DayStatus => ({
  date,
  count: 10,
  state: 'plan',
  unassigned: 0,
  absence: false,
  absentLeft: 0,
  overSpan: [],
  hundred: null,
  hard: 0,
  stale: false,
  needsCare: false,
  ...x,
});

describe('bulkConfirmTargets（PRD D223）', () => {
  const list: DayStatus[] = [
    st('2026-10-21', {}),
    st('2026-10-22', { state: 'diff' }),
    st('2026-10-23', { unassigned: 1 }),
    st('2026-10-24', { hard: 2 }),
    st('2026-10-25', { absentLeft: 1 }),
    st('2026-10-26', { state: 'none' }),
    st('2026-10-27', { state: 'confirmed' }),
    st('2026-10-28', { count: 0 }),
    // 条件が変わった日は残す（要対応に出る日を黙って確定しない）
    st('2026-10-29', { stale: true }),
    // 拘束超・欠勤（訪問は残っていない）も要対応に出るので残す
    st('2026-10-30', { overSpan: ['s1'], absence: true }),
    // 希望休だけ（要対応に出ない）の日は確定する
    st('2026-10-31', { absence: true }),
  ];
  const map = new Map(list.map((s) => [s.date, s]));
  // 月の要対応（attentionList）に出る日。10/29 は条件が変わったで、10/30 は拘束超・欠勤で出る
  const attention = [{ date: '2026-10-29' }, { date: '2026-10-30' }];
  const b = bulkConfirmTargets(
    list.map((s) => s.date),
    (d) => map.get(d),
    attention,
  );
  it('一度も確定していない日で、必須の違反が無く要対応に出ない日だけ', () => {
    expect(b.targets).toEqual(['2026-10-21', '2026-10-31']);
    expect(b.problem).toEqual(['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-29', '2026-10-30']);
    // 未確定の変更あり（前に確定した割当と今の案が違う）は残す
    expect(b.changed).toEqual(['2026-10-22']);
    expect(b.noPlan).toEqual(['2026-10-26']);
  });
  it('条件が変わった日は要対応を渡さなくても残す', () => {
    expect(bulkConfirmTargets(['2026-10-29'], (d) => map.get(d)).problem).toEqual(['2026-10-29']);
  });
  it('状態の分からない日は数えない', () => {
    expect(bulkConfirmTargets(['2026-11-01'], () => undefined).targets).toEqual([]);
  });
  it('ボタン・押せない理由・確認の文', () => {
    expect(bulkConfirmLabel(6)).toBe('問題の無い日をまとめて確定（6日）');
    const none: BulkConfirm = { targets: [], problem: [], changed: [], noPlan: [] };
    expect(bulkConfirmWhy(none)).toBe('確定していない日はありません');
    expect(bulkConfirmWhy({ ...none, noPlan: ['2026-10-26'] })).toContain('案の無い日');
    expect(bulkConfirmWhy({ ...none, changed: ['2026-10-22'] })).toContain('確定し直します');
    expect(bulkConfirmWhy({ ...none, problem: ['2026-10-23'] })).toContain('要対応');
    const dlg = bulkConfirmDialog(b, 'スタッフ');
    expect(dlg.title).toBe('問題の無い 2日を確定しますか？');
    expect(dlg.body).toContain('10/21（水）・10/31（土） 計 2日');
    expect(dlg.body).toContain('スタッフの画面');
    expect(dlg.body).not.toContain('置き換えます');
    expect(dlg.body).toContain(
      '問題のある 5日は残します（要対応で確認）：10/23（金）・10/24（土）・10/25（日）・10/29（木）・10/30（金）',
    );
    expect(dlg.body).toContain('前に確定した割当と違う 1日も残します（日の画面で確定し直します）。');
    expect(dlg.body).toContain('案の無い 1日も残します。');
    const plain = bulkConfirmDialog({ ...none, targets: ['2026-10-21'] }, 'ヘルパー');
    expect(plain.body).not.toContain('残します');
    expect(plain.body).not.toContain('確定し直します');
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
