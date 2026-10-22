import { describe, expect, it } from 'vitest';
import type { DayStatus } from './month';
import { DAY_STATE_TEXT, monthLayoutOf, monthListFocusDate, monthListRow } from './monthList';

const status = (o: Partial<DayStatus> & { date: string }): DayStatus => ({
  count: 0,
  state: 'none',
  unassigned: 0,
  issues: new Map(),
  care: 0,
  changes: 0,
  absence: false,
  overSpan: [],
  needsCare: false,
  ...o,
});

describe('monthLayoutOf・monthListFocusDate', () => {
  it('URL に無ければ狭い画面は一覧・広い画面はカレンダー', () => {
    expect(monthLayoutOf(null, true)).toBe('list');
    expect(monthLayoutOf(null, false)).toBe('calendar');
    // 知らない値は無いのと同じ
    expect(monthLayoutOf('table', true)).toBe('list');
    expect(monthLayoutOf('', false)).toBe('calendar');
  });
  it('URL に書いてあれば幅にかかわらずそれ', () => {
    expect(monthLayoutOf('calendar', true)).toBe('calendar');
    expect(monthLayoutOf('list', false)).toBe('list');
  });
  it('最初に見せる日：今月だけ。選んでいる日が今月ならその日、無ければ今日', () => {
    expect(monthListFocusDate('2026-10', '2026-10-25', '2026-10-21', false)).toBe('2026-10-25');
    expect(monthListFocusDate('2026-10', '2026-11-01', '2026-10-21', false)).toBe('2026-10-21');
    // ほかの月・行き先があるときは巻かない
    expect(monthListFocusDate('2026-11', '2026-11-01', '2026-10-21', false)).toBeNull();
    expect(monthListFocusDate('2026-10', '2026-10-21', '2026-10-21', true)).toBeNull();
  });
});

describe('monthListRow', () => {
  const today = '2026-10-21';
  it('訪問の無い日：「訪問なし」・印なし', () => {
    const r = monthListRow(status({ date: '2026-10-25' }), today);
    expect(r.dayText).toBe('25日（日）');
    expect(r.weekday).toBe(0);
    expect(r.state).toBe('empty');
    expect(r.stateText).toBe('訪問なし');
    expect(r.flags).toEqual([]);
    expect(r.care).toBe(false);
    expect(r.label).toBe('10月25日（日）・訪問なし');
  });
  it('今日・まだ伝えていない・件数', () => {
    const r = monthListRow(status({ date: today, count: 17, state: 'none' }), today);
    expect(r.isToday).toBe(true);
    expect(r.stateText).toBe(DAY_STATE_TEXT.none);
    expect(r.label).toBe('10月21日（水）・今日・訪問 17件・まだ伝えていない');
  });
  it('要対応の印（赤：検査の内訳 → 注意：未連絡・拘束超）、要対応は今日以降だけ', () => {
    const s = status({
      date: '2026-10-24',
      count: 8,
      state: 'changed',
      unassigned: 2,
      issues: new Map([
        ['a', [{ kind: 'unassigned' as const, label: '担当なし' }]],
        ['b', [{ kind: 'unassigned' as const, label: '担当なし' }]],
        ['c', [{ kind: 'off' as const, label: '欠勤' }]],
      ]),
      care: 3,
      changes: 1,
      overSpan: ['s1', 's2'],
      needsCare: true,
    });
    const r = monthListRow(s, today);
    expect(r.care).toBe(true);
    expect(r.flags).toEqual([
      { text: '担当なし 2', tone: 'red' },
      { text: '担当が休み 1', tone: 'red' },
      { text: '未連絡の変更 1件', tone: 'warn' },
      { text: '拘束超 2人', tone: 'warn' },
    ]);
    expect(r.label).toBe(
      '10月24日（土）・訪問 8件・未連絡の変更あり・要対応・担当なし 2・担当が休み 1・未連絡の変更 1件・拘束超 2人',
    );
    // 過ぎた日は要対応にしない
    const past = monthListRow({ ...s, date: '2026-10-20' }, today);
    expect(past.care).toBe(false);
    expect(past.isPast).toBe(true);
  });
  it('補足の文を読み上げの最後に足す', () => {
    const r = monthListRow(status({ date: '2026-10-22', count: 3, state: 'told' }), today, ['担当 2件']);
    expect(r.label).toBe('10月22日（木）・訪問 3件・確定済み・担当 2件');
  });
  it('要対応の札の数は今日以降だけ', () => {
    expect(monthListRow(status({ date: '2026-10-22', count: 3 }), today, [], { attention: 2 }).attention).toBe(2);
    expect(monthListRow(status({ date: '2026-10-20', count: 3 }), today, [], { attention: 2 }).attention).toBe(0);
  });
});
