import { describe, expect, it } from 'vitest';
import { activeNavPath, bottomTabs, isActiveNav, type NavSection, navTitle } from './nav';

const groups: NavSection[] = [
  {
    title: '予定',
    items: [
      { to: '/month', label: '月' },
      { to: '/week', label: '週' },
      { to: '/plan', label: '日' },
    ],
  },
  { title: '問い合わせ', items: [{ to: '/vacancy', label: '空き状況' }] },
  { title: '利用者さん', items: [{ to: '/clients', label: '一覧・編集' }] },
  { title: 'スタッフ', items: [{ to: '/staff', label: '一覧・編集' }] },
  { items: [{ to: '/data', label: 'データ' }] },
];

describe('activeNavPath・isActiveNav', () => {
  it('比較と古い #/schedule は日の画面と見る', () => {
    expect(activeNavPath('/compare')).toBe('/plan');
    expect(activeNavPath('/schedule')).toBe('/plan');
    expect(isActiveNav('/plan', '/compare')).toBe(true);
    expect(isActiveNav('/week', '/compare')).toBe(false);
  });
  it('ほかはそのまま', () => {
    expect(activeNavPath('/week')).toBe('/week');
    expect(isActiveNav('/staff', '/staff')).toBe(true);
  });
});

describe('navTitle', () => {
  it('グループの見出し＋項目名で、〈利用者さん〉と〈スタッフ〉の「一覧・編集」を見分ける', () => {
    expect(navTitle(groups, '/clients')).toBe('利用者さん・一覧・編集');
    expect(navTitle(groups, '/staff')).toBe('スタッフ・一覧・編集');
    expect(navTitle(groups, '/plan')).toBe('予定・日');
  });
  it('比較は「予定・日」、見出しの無いグループは項目名だけ', () => {
    expect(navTitle(groups, '/compare')).toBe('予定・日');
    expect(navTitle(groups, '/data')).toBe('データ');
  });
  it('メニューに無い画面は null', () => {
    expect(navTitle(groups, '/nowhere')).toBeNull();
  });
});

describe('bottomTabs', () => {
  it('月・週・日・空き状況の順に引く', () => {
    expect(bottomTabs(groups).map((i) => i.label)).toEqual(['月', '週', '日', '空き状況']);
  });
  it('メニューに無い URL は出さない', () => {
    expect(bottomTabs([{ items: [{ to: '/week', label: '週' }] }]).map((i) => i.to)).toEqual(['/week']);
  });
});
