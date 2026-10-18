import { describe, expect, it } from 'vitest';
import type { DayState, DayStatus } from './month';
import { rebuildAction, rebuildDays, rebuildSummary, rebuildText, showsRebuildBand } from './rebuildBand';

const TODAY = '2026-10-21';

/** 日の状態（既定は案あり・条件は変わっていない） */
function st(date: string, state: DayState = 'plan', stale = true): DayStatus {
  return {
    date,
    count: 5,
    state,
    unassigned: 0,
    absence: false,
    absentLeft: 0,
    overSpan: [],
    hundred: null,
    hard: 0,
    stale,
    needsCare: false,
  };
}

describe('showsRebuildBand', () => {
  it('設定の画面だけ（予定・ホーム・データには出さない）', () => {
    for (const p of ['/rules', '/compat', '/availability', '/types', '/items', '/staff', '/clients'])
      expect(showsRebuildBand(p)).toBe(true);
    for (const p of ['/home', '/month', '/week', '/plan', '/compare', '/data', '/vacancy', '/workload'])
      expect(showsRebuildBand(p)).toBe(false);
  });
});

describe('rebuildDays', () => {
  it('今日以降の案のある日を日付の順に', () => {
    const plans = { '2026-10-25': {}, '2026-10-20': {}, '2026-10-21': {}, '2026-11-02': {} };
    expect(rebuildDays(plans, TODAY)).toEqual(['2026-10-21', '2026-10-25', '2026-11-02']);
  });
});

describe('rebuildSummary', () => {
  it('条件が変わった日だけ、今日より前は数えない。確定済み・未確定の変更ありは確定済みに数える', () => {
    const s = rebuildSummary(
      [
        st('2026-10-20'),
        st('2026-10-23', 'confirmed'),
        st('2026-10-21'),
        st('2026-10-22', 'plan', false),
        st('2026-10-24', 'diff'),
        st('2026-11-03'),
      ],
      TODAY,
    );
    expect(s).toEqual({
      days: ['2026-10-21', '2026-10-23', '2026-10-24', '2026-11-03'],
      unconfirmed: ['2026-10-21', '2026-11-03'],
      confirmed: ['2026-10-23', '2026-10-24'],
    });
    expect(rebuildText(s)).toBe('条件が変わりました：影響する日 4日（未確定 2日・確定済み 2日）');
  });
  it('無ければ0日で、ボタンも無い', () => {
    const s = rebuildSummary([st('2026-10-22', 'plan', false)], TODAY);
    expect(s.days).toEqual([]);
    expect(rebuildAction(s)).toBeNull();
  });
});

describe('rebuildAction', () => {
  it('未確定の日があれば、その最初の日の月の「条件が変わった日を作り直す」の欄（?do=stale）', () => {
    const a = rebuildAction(rebuildSummary([st('2026-10-30'), st('2026-11-03'), st('2026-10-31')], TODAY));
    expect(a?.href).toBe('/month?ym=2026-10&do=stale');
    expect(a?.label).toBe('作り直す');
    expect(a?.note).toMatch(/10月.*（2日）/);
    expect(a?.note).toMatch(/ほかの月/);
  });
  it('確定済みの日もあれば、作り直さないと書く', () => {
    const a = rebuildAction(rebuildSummary([st('2026-10-30'), st('2026-10-29', 'confirmed')], TODAY));
    expect(a?.href).toBe('/month?ym=2026-10&do=stale');
    expect(a?.note).toMatch(/確定済みの日は作り直しません/);
    expect(a?.note).not.toMatch(/ほかの月/);
  });
  it('確定済みの日だけなら、作り直す日が無いので要対応を見る（?do=attention）', () => {
    const a = rebuildAction(rebuildSummary([st('2026-11-04', 'confirmed')], TODAY));
    expect(a).toMatchObject({ href: '/month?ym=2026-11&do=attention', label: '要対応を見る' });
  });
});
