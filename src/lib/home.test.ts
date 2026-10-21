import { describe, expect, it } from 'vitest';
import type { Absence, Staff } from '../contracts/documents';
import { HOME_NEXT_MONTH_FROM_DAY, homeDays, homeMonths, homeTasks, monthLabel } from './home';
import { type DayStatus, monthProgress } from './month';

/** 日の状態（既定は訪問3件・確定済み・問題なし） */
function st(date: string, x: Partial<DayStatus> = {}): DayStatus {
  return {
    date,
    count: 3,
    state: 'confirmed',
    unassigned: 0,
    absence: false,
    absentLeft: 0,
    overSpan: [],
    hundred: null,
    hard: 0,
    stale: false,
    needsCare: false,
    ...x,
  };
}
const data = { absences: [] as Absence[], staff: [] as Staff[] };
const TODAY = '2026-10-14';

describe('homeMonths・homeDays', () => {
  it('14日までは今月だけ', () => {
    expect(homeMonths('2026-10-14')).toEqual(['2026-10']);
    expect(homeMonths('2026-10-01')).toEqual(['2026-10']);
    expect(homeDays('2026-10-14')).toHaveLength(18);
    expect(homeDays('2026-10-14')[0]).toBe('2026-10-14');
  });
  it(`${HOME_NEXT_MONTH_FROM_DAY}日以降なら来月も（年をまたぐ）`, () => {
    expect(homeMonths('2026-10-15')).toEqual(['2026-10', '2026-11']);
    expect(homeMonths('2026-10-25')).toEqual(['2026-10', '2026-11']);
    expect(homeDays('2026-10-15')).toHaveLength(17 + 30);
    expect(homeMonths('2026-12-31')).toEqual(['2026-12', '2027-01']);
    expect(homeMonths('2027-02-22')).toEqual(['2027-02', '2027-03']);
    const days = homeDays('2026-12-31');
    expect(days[0]).toBe('2026-12-31');
    expect(days.at(-1)).toBe('2027-01-31');
    expect(days).toHaveLength(32);
  });
  it('月の名前', () => {
    expect(monthLabel('2026-03')).toBe('3月');
  });
});

describe('homeTasks', () => {
  it('何も無い（訪問もパターンも無い）：今日の訪問は無い知らせだけで、準備はできている', () => {
    const r = homeTasks({
      today: TODAY,
      statuses: [st(TODAY, { count: 0, state: 'none' })],
      months: [{ ym: '2026-10', canExpand: 0 }],
      todayStaff: 0,
      data,
      features: {},
    });
    expect(r.ready).toBe(true);
    expect(r.tasks.map((t) => t.kind)).toEqual(['today']);
    expect(r.tasks[0]).toMatchObject({ tone: 'info', to: '/plan', date: TODAY });
    expect(r.tasks[0]!.title).toContain('訪問はありません');
  });

  it('全部済み：今日の予定の要約（確定済み）だけで、準備はできている', () => {
    const r = homeTasks({
      today: TODAY,
      statuses: [st(TODAY), st('2026-10-15'), st('2026-10-16', { count: 0, state: 'none' })],
      months: [{ ym: '2026-10', canExpand: 0 }],
      todayStaff: 2,
      data,
      features: {},
    });
    expect(r.ready).toBe(true);
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0]).toMatchObject({ kind: 'today', tone: 'info' });
    expect(r.tasks[0]!.title).toContain('確定済み');
    expect(r.tasks[0]!.detail).toBe('訪問 3件・担当 2人・入らない 0件');
  });

  it('訪問をまだ作っていない：まとめて作るへ（月の画面の ?do=batch）', () => {
    const r = homeTasks({
      today: TODAY,
      statuses: [st(TODAY, { count: 0, state: 'none' })],
      months: [{ ym: '2026-10', canExpand: 40 }],
      todayStaff: 0,
      data,
      features: {},
    });
    expect(r.ready).toBe(false);
    const c = r.tasks.find((t) => t.kind === 'create')!;
    expect(c).toMatchObject({ tone: 'todo', title: '10月の案をまとめて作る', to: '/month?ym=2026-10&do=batch' });
    expect(c.detail).toBe('定期パターンからまだ作っていない訪問 40件');
  });

  it('一部済み：要対応 → 案を作る → 確定していない日 → 今日 の順（作業の順。PRD D263）', () => {
    const r = homeTasks({
      today: TODAY,
      statuses: [
        st('2026-10-13', { state: 'none' }), // 今日より前は数えない
        st(TODAY, { state: 'plan', unassigned: 1 }),
        st('2026-10-15', { state: 'diff' }),
        st('2026-10-16', { state: 'none' }),
        st('2026-10-17', { state: 'none' }),
      ],
      months: [{ ym: '2026-10', canExpand: 0 }],
      todayStaff: 3,
      data,
      features: {},
    });
    expect(r.ready).toBe(false);
    expect(r.tasks.map((t) => t.kind)).toEqual(['attention', 'create', 'confirm', 'today']);
    const [att, create, conf, today] = r.tasks;
    // 要対応は1日だけなので日の画面へ
    expect(att).toMatchObject({
      title: '10月の要対応 1件',
      detail: '入らない訪問がある日 1日',
      to: '/plan',
      date: TODAY,
    });
    expect(today).toMatchObject({ tone: 'warn' });
    expect(today!.title).toContain('（未確定）');
    expect(today!.detail).toBe('訪問 3件・担当 3人・入らない 1件');
    // 確定していない日は今日から17日までの4日（案の無い日も含む＝月の③と同じ。月の画面の右の欄へ）
    expect(conf).toMatchObject({ title: '10月の確定していない日 4日を確認', to: '/month?ym=2026-10&do=unconfirmed' });
    // 案の無い日の日数は「案を作る」のカードにだけ書く（PRD D263）
    expect(conf!.detail).toBe(
      '未確定 1日・未確定の変更あり 1日・ほかは案の無い日（先に作る）。見直して「この割当で確定」',
    );
    expect(create).toMatchObject({ detail: '案の無い日 2日', to: '/month?ym=2026-10&do=batch' });
  });

  it('確定していない日の日数・並びは月の「今月の準備」の③（monthProgress の unconfirmed）と同じ', () => {
    const list = [
      st(TODAY, { state: 'none' }),
      st('2026-10-15', { state: 'confirmed' }),
      st('2026-10-16', { state: 'plan' }),
      st('2026-10-18', { state: 'diff' }),
      st('2026-10-20', { state: 'none', count: 0 }),
    ];
    const byDate = new Map(list.map((x) => [x.date, x]));
    const progress = monthProgress(
      { ...data, visits: [], aiPlans: {}, manualPlans: {}, clientLeaves: [] },
      '2026-10',
      TODAY,
      undefined,
      (d) => byDate.get(d) ?? st(d, { count: 0, state: 'none' }),
    );
    const r = homeTasks({
      today: TODAY,
      statuses: list,
      months: [{ ym: '2026-10', canExpand: 0 }],
      todayStaff: 0,
      data,
      features: {},
    });
    const conf = r.tasks.find((t) => t.kind === 'confirm')!;
    expect(progress.unconfirmed).toEqual([TODAY, '2026-10-16', '2026-10-18']);
    expect(conf.title).toBe(`10月の確定していない日 ${progress.unconfirmed.length}日を確認`);
  });

  it('要対応が2日以上なら月の画面の要対応へ。欠勤（希望休は除く）も数える', () => {
    const r = homeTasks({
      today: TODAY,
      statuses: [st(TODAY, { stale: true }), st('2026-10-20', { absence: true })],
      months: [{ ym: '2026-10', canExpand: 0 }],
      todayStaff: 1,
      data: {
        staff: [{ id: 's1', name: '山田' } as Staff],
        absences: [{ id: 'a1', staffId: 's1', date: '2026-10-20', from: '09:00', to: '12:00', note: '' } as Absence],
      },
      features: {},
    });
    const att = r.tasks[0]!;
    expect(att).toMatchObject({ kind: 'attention', title: '10月の要対応 2件', to: '/month?ym=2026-10&do=attention' });
    expect(att.date).toBeUndefined();
    expect(att.detail).toBe('条件が変わった日 1日・欠勤がある日 1日');
  });

  it('今日の案が無い：今日のカードを warn にして日の画面へ', () => {
    const r = homeTasks({
      today: TODAY,
      statuses: [st(TODAY, { state: 'none' })],
      months: [{ ym: '2026-10', canExpand: 0 }],
      todayStaff: 0,
      data,
      features: {},
    });
    const t = r.tasks.find((x) => x.kind === 'today')!;
    expect(t).toMatchObject({ tone: 'warn', to: '/plan', date: TODAY });
    expect(t.title).toContain('案がまだありません');
  });

  it('月末は来月のカードも（今月は済み、来月は訪問を作っていない）', () => {
    const today = '2026-10-28';
    const r = homeTasks({
      today,
      statuses: [st(today), st('2026-11-02', { count: 0, state: 'none' })],
      months: [
        { ym: '2026-10', canExpand: 0 },
        { ym: '2026-11', canExpand: 120 },
      ],
      todayStaff: 2,
      data,
      features: {},
    });
    expect(r.tasks.map((t) => [t.kind, t.title])).toEqual([
      ['create', '11月の案をまとめて作る'],
      ['today', '今日 10/28（水）の予定（確定済み）'],
    ]);
  });

  it('同じ月では作る → 確認、今月 → 来月。案の無い日だけの確認のカードは、作るカードがあれば出さない（PRD D263）', () => {
    const today = '2026-10-20';
    const r = homeTasks({
      today,
      statuses: [
        st(today, { state: 'plan' }),
        st('2026-10-21', { state: 'none' }),
        st('2026-11-02', { state: 'none' }),
        st('2026-11-03', { state: 'none' }),
      ],
      months: [
        { ym: '2026-10', canExpand: 0 },
        { ym: '2026-11', canExpand: 50 },
      ],
      todayStaff: 2,
      data,
      features: {},
    });
    expect(r.tasks.map((t) => [t.kind, t.title])).toEqual([
      ['create', '10月の案をまとめて作る'],
      ['confirm', '10月の確定していない日 2日を確認'],
      ['create', '11月の案をまとめて作る'],
      ['today', '今日 10/20（火）の予定（未確定）'],
    ]);
    // 「案の無い日 N日」は作るカードにだけ
    expect(r.tasks.filter((t) => t.detail.includes('案の無い日 1日')).map((t) => t.kind)).toEqual(['create']);
    expect(r.tasks[2]!.detail).toBe('定期パターンからまだ作っていない訪問 50件・案の無い日 2日');
  });

  it('作るカードが無い月（作れる訪問なし・案の無い日なし）は確認のカードがそのまま', () => {
    const r = homeTasks({
      today: TODAY,
      statuses: [st(TODAY, { state: 'plan' }), st('2026-10-15', { state: 'plan' })],
      months: [{ ym: '2026-10', canExpand: 0 }],
      todayStaff: 2,
      data,
      features: {},
    });
    expect(r.tasks.map((t) => t.kind)).toEqual(['confirm', 'today']);
    expect(r.tasks[0]!.detail).toBe('未確定 2日。見直して「この割当で確定」');
  });
});
