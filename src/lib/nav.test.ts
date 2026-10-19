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
} from './nav';

const terms = { client: '利用者さん', staff: 'スタッフ' };
const TODAY = '2026-10-21';
const groups: NavSection[] = menuSections(terms, TODAY, {});

describe('menuSections（PRD D178・D179）', () => {
  it('やりたいことの順に並ぶ：ホーム／予定を組む／当日の対応／問い合わせ／人の情報／AI の考え方／管理者（管理者設定・データ）', () => {
    expect(groups.map((g) => g.title ?? null)).toEqual([
      null,
      '予定を組む',
      '当日の対応',
      '問い合わせ',
      '人の情報',
      'AI の考え方',
      '管理者',
    ]);
    expect(groups.flatMap((g) => g.items.map((i) => i.label))).toEqual([
      'ホーム',
      '月',
      '週',
      '日',
      '案を比べる',
      '欠勤・キャンセル',
      '空き状況',
      '利用者さん一覧',
      '相性',
      'スタッフ一覧',
      '稼働時間',
      '稼働の見込み',
      '条件の重み',
      '訪問の種類',
      '特性の項目',
      '管理者設定',
      'データ',
    ]);
  });
  it('人の情報は人ごとの順（〈利用者さん〉一覧・相性 → 〈スタッフ〉一覧・稼働時間・稼働の見込み。ADR-0019 の並びを残す）', () => {
    const people = groups.find((g) => g.title === '人の情報')!.items.map((i) => i.to);
    expect(people).toEqual(['/clients', '/compat', '/staff', '/availability', '/workload']);
  });
  it('名前は呼び方から引き、同じ名前の項目が無い', () => {
    const labels = menuSections({ client: 'お客様', staff: 'シッター' }, TODAY, {}).flatMap((g) =>
      g.items.map((i) => i.label),
    );
    expect(labels).toContain('お客様一覧');
    expect(labels).toContain('シッター一覧');
    expect(new Set(labels).size).toBe(labels.length);
  });
  it('URL は今のまま。欠勤・キャンセルは今日の日の画面の欄を開く操作', () => {
    const tos = groups.flatMap((g) => g.items.map((i) => i.to));
    expect(tos).toContain('/compare');
    expect(tos).toContain(absenceHref(TODAY));
    expect(absenceHref(TODAY)).toBe('/plan?date=2026-10-21&do=absence');
    expect(tos.filter(isNavAction)).toEqual([absenceHref(TODAY)]);
  });
});

describe('activeNavPath・isActiveNav', () => {
  it('古い #/schedule は日の画面と見る', () => {
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
  it('比較はタブに無いので「日」（PRD D134・D180）', () => {
    expect(activeTabPath('/compare')).toBe('/plan');
    expect(isActiveTab('/plan', '/compare')).toBe(true);
    expect(isActiveTab('/plan', '/schedule')).toBe(true);
    expect(isActiveTab('/week', '/week')).toBe(true);
    expect(isActiveTab('/plan', '/clients')).toBe(false);
  });
});

describe('navTitle', () => {
  it('グループの見出し＋項目名で、〈利用者さん〉と〈スタッフ〉の一覧を見分ける', () => {
    expect(navTitle(groups, '/clients')).toBe('人の情報・利用者さん一覧');
    expect(navTitle(groups, '/staff')).toBe('人の情報・スタッフ一覧');
    expect(navTitle(groups, '/plan')).toBe('予定を組む・日');
    expect(navTitle(groups, '/rules')).toBe('AI の考え方・条件の重み');
  });
  it('比較は「予定を組む・案を比べる」、見出しの無いグループは項目名だけ', () => {
    expect(navTitle(groups, '/compare')).toBe('予定を組む・案を比べる');
    expect(navTitle(groups, '/data')).toBe('管理者・データ');
    expect(navTitle(groups, '/settings')).toBe('管理者・管理者設定');
    expect(navTitle(groups, '/home')).toBe('ホーム');
  });
  it('メニューに無い画面は null', () => {
    expect(navTitle(groups, '/nowhere')).toBeNull();
    expect(navTitleParts(groups, '/nowhere')).toBeNull();
  });
  it('navTitleParts：見出しと項目名を分ける（見出しの無いグループは null）', () => {
    expect(navTitleParts(groups, '/clients')).toEqual({ group: '人の情報', item: '利用者さん一覧' });
    expect(navTitleParts(groups, '/home')).toEqual({ group: null, item: 'ホーム' });
  });
});

describe('bottomTabs', () => {
  it('ホーム・月・週・日・空き状況の順に引く（PRD D144。メニューの並びの順）', () => {
    expect(bottomTabs(groups).map((i) => i.label)).toEqual(['ホーム', '月', '週', '日', '空き状況']);
    const order = groups.flatMap((g) => g.items.map((i) => i.to));
    const idx = bottomTabs(groups).map((i) => order.indexOf(i.to));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });
  it('メニューに無い URL は出さない', () => {
    expect(bottomTabs([{ items: [{ to: '/week', label: '週' }] }]).map((i) => i.to)).toEqual(['/week']);
  });
});
