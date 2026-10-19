import { describe, expect, it } from 'vitest';
import {
  absenceHref,
  activeNavPath,
  activeTabPath,
  bottomTabs,
  isActiveNav,
  isActiveTab,
  isNavAction,
  menuSections,
  type NavSection,
  navTitle,
  navTitleParts,
  tabClick,
  tabHref,
  tabLabel,
  todayPlanHref,
} from './nav';

const terms = { client: '利用者さん', staff: 'スタッフ' };
const TODAY = '2026-10-21';
const groups: NavSection[] = menuSections(terms, TODAY, {});

describe('menuSections（PRD D178・D179・D230〜D232）', () => {
  it('やりたいことの順に5つのグループ：ホーム／予定／当日・問い合わせ／人／AI の条件／設定', () => {
    expect(groups.map((g) => g.title ?? null)).toEqual([null, '予定', '当日・問い合わせ', '人', 'AI の条件', '設定']);
    expect(groups.flatMap((g) => g.items.map((i) => i.label))).toEqual([
      'ホーム',
      '月の予定',
      '週の予定',
      '日の予定',
      '案を比べる',
      '欠勤・キャンセルを登録',
      '空き状況',
      '利用者さん一覧',
      'スタッフ一覧',
      '勤務時間（シフト）',
      '勤務の見込み',
      '条件の重み',
      '相性',
      '訪問の種類',
      '特性の項目',
      '管理者設定',
      'データ',
    ]);
  });
  it('人は〈利用者さん〉一覧 → 〈スタッフ〉一覧・勤務時間（シフト）・勤務の見込み。相性は AI の条件（ADR-0034）', () => {
    const people = groups.find((g) => g.title === '人')!.items.map((i) => i.to);
    expect(people).toEqual(['/clients', '/staff', '/availability', '/workload']);
    expect(groups.find((g) => g.title === 'AI の条件')!.items.map((i) => i.to)).toEqual(['/rules', '/compat']);
    expect(groups.find((g) => g.title === '設定')!.items.map((i) => i.to)).toEqual([
      '/types',
      '/items',
      '/settings',
      '/data',
    ]);
  });
  it('名前は呼び方から引き、同じ名前の項目が無い', () => {
    const labels = menuSections({ client: 'お客様', staff: 'シッター' }, TODAY, {}).flatMap((g) =>
      g.items.map((i) => i.label),
    );
    expect(labels).toContain('お客様一覧');
    expect(labels).toContain('シッター一覧');
    expect(new Set(labels).size).toBe(labels.length);
  });
  it('URL は今のまま。欠勤・キャンセルを登録は今日の日の予定の欄を開く操作', () => {
    const tos = groups.flatMap((g) => g.items.map((i) => i.to));
    expect(tos).toContain('/compare');
    expect(tos).toContain(absenceHref(TODAY));
    expect(absenceHref(TODAY)).toBe('/plan?date=2026-10-21&do=absence');
    expect(tos.filter(isNavAction)).toEqual([absenceHref(TODAY)]);
  });
});

describe('activeNavPath・isActiveNav', () => {
  it('古い #/schedule は日の予定と見る', () => {
    expect(activeNavPath('/schedule')).toBe('/plan');
    expect(isActiveNav('/plan', '/schedule')).toBe(true);
  });
  it('比較はメニューの「案を比べる」（PRD D180）', () => {
    expect(activeNavPath('/compare')).toBe('/compare');
    expect(isActiveNav('/compare', '/compare')).toBe(true);
    expect(isActiveNav('/plan', '/compare')).toBe(false);
  });
  it('操作の項目は今の画面にしない', () => {
    expect(isActiveNav(absenceHref(TODAY), '/plan')).toBe(false);
    expect(isActiveNav('/plan', '/plan')).toBe(true);
  });
  it('ほかはそのまま', () => {
    expect(activeNavPath('/week')).toBe('/week');
    expect(isActiveNav('/staff', '/staff')).toBe(true);
  });
});

describe('activeTabPath・isActiveTab', () => {
  it('比較はタブに無いので「今日」のタブ（PRD D134・D180・D232）', () => {
    expect(activeTabPath('/compare')).toBe('/plan');
    expect(isActiveTab('/plan', '/compare')).toBe(true);
    expect(isActiveTab('/plan', '/schedule')).toBe(true);
    expect(isActiveTab('/week', '/week')).toBe(true);
    expect(isActiveTab('/plan', '/clients')).toBe(false);
  });
});

describe('navTitle', () => {
  it('グループの見出し＋項目名で、〈利用者さん〉と〈スタッフ〉の一覧を見分ける', () => {
    expect(navTitle(groups, '/clients')).toBe('人・利用者さん一覧');
    expect(navTitle(groups, '/staff')).toBe('人・スタッフ一覧');
    expect(navTitle(groups, '/availability')).toBe('人・勤務時間（シフト）');
    expect(navTitle(groups, '/rules')).toBe('AI の条件・条件の重み');
    expect(navTitle(groups, '/vacancy')).toBe('当日・問い合わせ・空き状況');
  });
  it('予定のグループは項目名だけ（「予定・日の予定」と重ねない。PRD D230）', () => {
    expect(navTitle(groups, '/plan')).toBe('日の予定');
    expect(navTitle(groups, '/schedule')).toBe('日の予定');
    expect(navTitle(groups, '/month')).toBe('月の予定');
    expect(navTitle(groups, '/week')).toBe('週の予定');
    expect(navTitle(groups, '/compare')).toBe('案を比べる');
    expect(navTitleParts(groups, '/plan')).toEqual({ group: null, item: '日の予定' });
  });
  it('設定は「設定・データ」、見出しの無いグループは項目名だけ', () => {
    expect(navTitle(groups, '/data')).toBe('設定・データ');
    expect(navTitle(groups, '/settings')).toBe('設定・管理者設定');
    expect(navTitle(groups, '/types')).toBe('設定・訪問の種類');
    expect(navTitle(groups, '/home')).toBe('ホーム');
  });
  it('メニューに無い画面は null', () => {
    expect(navTitle(groups, '/nowhere')).toBeNull();
    expect(navTitleParts(groups, '/nowhere')).toBeNull();
  });
  it('navTitleParts：見出しと項目名を分ける（見出しの無いグループは null）', () => {
    expect(navTitleParts(groups, '/clients')).toEqual({ group: '人', item: '利用者さん一覧' });
    expect(navTitleParts(groups, '/home')).toEqual({ group: null, item: 'ホーム' });
  });
});

describe('bottomTabs', () => {
  it('ホーム・月・週・今日・空き状況の順に引き、短い名前で出す（PRD D144・D232。メニューの並びの順）', () => {
    expect(bottomTabs(groups).map(tabLabel)).toEqual(['ホーム', '月', '週', '今日', '空き状況']);
    expect(bottomTabs(groups).map((i) => i.label)).toEqual(['ホーム', '月の予定', '週の予定', '日の予定', '空き状況']);
    const order = groups.flatMap((g) => g.items.map((i) => i.to));
    const idx = bottomTabs(groups).map((i) => order.indexOf(i.to));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });
  it('メニューに無い URL は出さない', () => {
    expect(bottomTabs([{ items: [{ to: '/week', label: '週' }] }]).map((i) => i.to)).toEqual(['/week']);
  });
});

describe('下のタブの「今日」（PRD D232）', () => {
  it('短い名前が無ければメニューの名前', () => {
    expect(tabLabel({ to: '/x', label: '名前' })).toBe('名前');
    expect(tabLabel({ to: '/x', label: '名前', short: '短' })).toBe('短');
  });
  it('「今日」は今日の日の予定（?date=今日）。ほかはメニューと同じ URL', () => {
    expect(todayPlanHref(TODAY)).toBe('/plan?date=2026-10-21');
    expect(tabHref('/plan', TODAY)).toBe('/plan?date=2026-10-21');
    expect(tabHref('/month', TODAY)).toBe('/month');
    expect(tabHref('/home', TODAY)).toBe('/home');
  });
  it('今の画面のタブは何もしない。ただし日の予定の「今日」は今日を選び直す（履歴は増やさない）', () => {
    expect(tabClick('/month', '/month')).toBe('stay');
    expect(tabClick('/home', '/home')).toBe('stay');
    expect(tabClick('/plan', '/plan')).toBe('replace');
    expect(tabClick('/plan', '/schedule')).toBe('replace');
    // 比較から「今日」は日の予定へ移る（別の画面）
    expect(tabClick('/plan', '/compare')).toBe('go');
    expect(tabClick('/week', '/plan')).toBe('go');
  });
});
