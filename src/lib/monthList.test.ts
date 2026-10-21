import { describe, expect, it } from 'vitest';
import type { DayStatus } from './month';
import { DAY_STATE_TEXT, monthLayoutOf, monthListFocusDate, monthListRow } from './monthList';

const status = (o: Partial<DayStatus> & { date: string }): DayStatus => ({
  count: 0,
  state: 'none',
  unassigned: 0,
  absence: false,
  absentLeft: 0,
  overSpan: [],
  hundred: null,
  hard: 0,
  stale: false,
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
  it('今日・案あり・件数', () => {
    const r = monthListRow(status({ date: today, count: 17, state: 'plan' }), today);
    expect(r.isToday).toBe(true);
    expect(r.stateText).toBe(DAY_STATE_TEXT.plan);
    expect(r.label).toBe('10月21日（水）・今日・訪問 17件・案あり');
  });
  it('要対応の印はマスと同じ並び（赤 → 注意）、要対応は今日以降だけ', () => {
    const s = status({
      date: '2026-10-24',
      count: 8,
      state: 'diff',
      unassigned: 2,
      hard: 1,
      absentLeft: 3,
      stale: true,
      overSpan: ['s1', 's2'],
      needsCare: true,
    });
    const r = monthListRow(s, today);
    expect(r.care).toBe(true);
    expect(r.flags).toEqual([
      { text: '入らない 2件', tone: 'red' },
      { text: '必須の違反 1件', tone: 'red' },
      { text: '休みの人に訪問 3件', tone: 'red' },
      { text: '条件が変わった', tone: 'warn' },
      { text: '拘束超 2人', tone: 'warn' },
    ]);
    expect(r.label).toBe(
      '10月24日（土）・訪問 8件・未確定の変更あり・要対応・入らない 2件・必須の違反 1件・休みの人に訪問 3件・条件が変わった・拘束超 2人',
    );
    // 過ぎた日は要対応にしない
    const past = monthListRow({ ...s, date: '2026-10-20' }, today);
    expect(past.care).toBe(false);
    expect(past.isPast).toBe(true);
  });
  it('今日以降で訪問があって案の無い日は注意（黄）で、要対応（赤）にしない（PRD D228）', () => {
    const r = monthListRow(status({ date: '2026-10-24', count: 5, state: 'none' }), today);
    expect(r.care).toBe(false);
    expect(r.caution).toBe(true);
    expect(r.label).toBe('10月24日（土）・訪問 5件・案なし・注意：まだ案が無い');
    expect(monthListRow(status({ date: '2026-10-20', count: 5, state: 'none' }), today).caution).toBe(false);
    expect(monthListRow(status({ date: '2026-10-24', count: 0, state: 'none' }), today).caution).toBe(false);
  });
  it('補足の文を読み上げの最後に足す', () => {
    const r = monthListRow(status({ date: '2026-10-22', count: 3, state: 'confirmed' }), today, ['担当 2件']);
    expect(r.label).toBe('10月22日（木）・訪問 3件・確定済み・担当 2件');
  });
});

describe('monthListRow：未作成・欠勤あり（対応済み）（PRD D281・D282）', () => {
  it('訪問の無い今日以降の日で、定期パターンからまだ作っていなければ「未作成」。本当に0件・過ぎた日は「訪問なし」', () => {
    const r = monthListRow(status({ date: '2026-10-25' }), '2026-10-21', [], { unmade: 5 });
    expect(r.stateText).toBe('未作成');
    expect(r.unmade).toBe(5);
    expect(r.state).toBe('empty');
    expect(r.label).toContain('定期パターンからまだ作っていない訪問 5件');
    expect(monthListRow(status({ date: '2026-10-25' }), '2026-10-21').stateText).toBe('訪問なし');
    expect(monthListRow(status({ date: '2026-10-20' }), '2026-10-21', [], { unmade: 5 }).stateText).toBe('訪問なし');
    // 訪問がある日は状態のまま
    expect(monthListRow(status({ date: '2026-10-25', count: 3 }), '2026-10-21', [], { unmade: 2 }).stateText).toBe(
      '案なし',
    );
  });
  it('欠勤の手当てが済んだ日は情報の印（要対応にしない）', () => {
    const r = monthListRow(
      status({ date: '2026-10-25', count: 3, state: 'confirmed', absence: true }),
      '2026-10-21',
      [],
      {
        absenceDone: true,
      },
    );
    expect(r.flags).toEqual([{ text: '欠勤あり（対応済み）', tone: 'info' }]);
    expect(r.care).toBe(false);
  });
});
