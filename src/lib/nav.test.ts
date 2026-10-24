import { describe, expect, it } from 'vitest';
import { applyTemplate } from './features';
import {
  absenceHref,
  activeNavPath,
  bottomTabs,
  isActiveNav,
  isNavAction,
  isPeoplePath,
  isScheduleView,
  isSettingsPath,
  type MenuItem,
  menuSections,
  NAV_OPEN_DEFAULT,
  navTitle,
  navTitleParts,
  peopleHref,
  peopleTabs,
  SCHEDULE_DEFAULT,
  scheduleHref,
  screenSections,
  settingsHref,
  showsDateSwitch,
  tabClick,
  tabLabel,
} from './nav';

const terms = { client: '利用者さん', staff: 'スタッフ' };
const TODAY = '2026-10-21';
const groups = menuSections(terms, TODAY, {});
const screens = screenSections(terms, {});
/** key でメニューの項目を引く（子の項目も） */
const item = (key: string, g = groups): MenuItem =>
  g.flatMap((x) => x.items.flatMap((i) => [i, ...(i.children ?? [])])).find((i) => i.key === key)!;

describe('menuSections（PRD D326・D349。ADR-0054・0063）', () => {
  it('見出しの無い6項目：ホーム・予定・予定を組む・空き状況・人・設定', () => {
    expect(groups.map((g) => g.title ?? null)).toEqual([null]);
    expect(groups.flatMap((g) => g.items.map((i) => i.label))).toEqual([
      'ホーム',
      '予定',
      '予定を組む',
      '空き状況',
      '人',
      '設定',
    ]);
  });
  it('予定の子はリンク（今日の予定・◯月の予定・欠勤・キャンセル）、予定を組むの子は担当を組む・組み方の標準', () => {
    expect(item('schedule').children?.map((i) => [i.label, i.to])).toEqual([
      ['今日の予定', '/plan?date=2026-10-21'],
      ['11月の予定', '/month?ym=2026-11'],
      ['欠勤・キャンセル', '/plan?date=2026-10-21&do=absence'],
    ]);
    expect(item('arrange').children?.map((i) => [i.label, i.to])).toEqual([
      ['担当を組む', '/arrange?ym=2026-11'],
      ['組み方の標準', '/standard'],
    ]);
    expect(item('people').children?.map((i) => i.to)).toEqual(['/clients', '/staff', '/compat', '/availability']);
    expect(item('settings').children?.map((i) => i.to)).toEqual(['/types', '/items', '/rules', '/settings', '/data']);
    // 前半は今月
    const early = menuSections(terms, '2026-10-03', {});
    expect(item('month-view', early).to).toBe('/month?ym=2026-10');
    expect(item('arrange:assign', early).to).toBe('/arrange?ym=2026-10');
    expect(NAV_OPEN_DEFAULT).toEqual({ schedule: true, arrange: true, people: true, settings: false });
  });
  it('件数の印：組む月の担当なしの日は「担当を組む」、今日をまだ伝えていないは「今日の予定」', () => {
    const g = menuSections(terms, TODAY, {}, {}, { planUnassignedDays: 3, todayUntold: true });
    expect(item('arrange:assign', g).badge).toEqual({ text: '3日', label: '担当なしの訪問がある日 3日' });
    expect(item('today', g).badge?.text).toBe('未確定');
    expect(item('arrange:assign').badge).toBeUndefined();
  });
  it('今の画面の印は画面で決める（予定の子・予定を組むの子）', () => {
    expect(isActiveNav(item('today'), '/plan')).toBe(true);
    expect(isActiveNav(item('month-view'), '/week')).toBe(true);
    expect(isActiveNav(item('month-view'), '/plan')).toBe(false);
    expect(isActiveNav(item('absence'), '/plan')).toBe(false);
    expect(isActiveNav(item('schedule'), '/compare')).toBe(false);
    expect(isActiveNav(item('arrange'), '/compare')).toBe(true);
    expect(isActiveNav(item('arrange:assign'), '/compare')).toBe(true);
    expect(isActiveNav(item('arrange:standard'), '/standard')).toBe(true);
  });
  it('下のタブは子の項目からも引く（欠勤）', () => {
    expect(bottomTabs(groups).map((i) => i.key)).toEqual(['home', 'schedule', 'absence']);
  });
  it('同じ名前の項目が無い', () => {
    const labels = menuSections({ client: 'お客様', staff: 'シッター' }, TODAY, {}).flatMap((g) =>
      g.items.map((i) => i.label),
    );
    expect(new Set(labels).size).toBe(labels.length);
  });
  it('「人」は最後に開いた人のタブ（無ければ〈利用者さん〉。勤務の見込みは勤務時間（シフト））', () => {
    expect(item('people').to).toBe('/clients');
    expect(item('people', menuSections(terms, TODAY, {}, { people: '/compat' })).to).toBe('/compat');
    expect(peopleHref({}, '/workload')).toBe('/availability');
    expect(peopleHref({ compat: false }, '/compat')).toBe('/clients');
    expect(peopleTabs(terms, {}).map((t) => t.label)).toEqual(['利用者さん', 'スタッフ', '相性', '勤務時間（シフト）']);
    expect(peopleTabs(terms, { compat: false }).map((t) => t.to)).toEqual(['/clients', '/staff', '/availability']);
    for (const p of ['/clients', '/staff', '/compat', '/availability', '/workload', '/clients/c1', '/staff/s1'])
      expect(isPeoplePath(p)).toBe(true);
    expect(isPeoplePath('/plan')).toBe(false);
  });
  it('欠勤・キャンセルを登録は今日の日の予定の欄を開く操作', () => {
    expect(item('absence').to).toBe(absenceHref(TODAY));
    expect(absenceHref(TODAY)).toBe('/plan?date=2026-10-21&do=absence');
    expect(isNavAction(item('absence').to)).toBe(true);
  });
  it('「予定」は最後に開いた表示（無ければ日の予定）。比較は覚えない', () => {
    expect(item('schedule').to).toBe(SCHEDULE_DEFAULT);
    expect(SCHEDULE_DEFAULT).toBe('/plan');
    expect(item('schedule', menuSections(terms, TODAY, {}, { schedule: '/month' })).to).toBe('/month');
    expect(scheduleHref('/week')).toBe('/week');
    expect(scheduleHref('/compare')).toBe('/plan');
    expect(scheduleHref(null)).toBe('/plan');
  });
  it('「設定」は最後に開いたタブ（切っていれば先頭のタブ）。無ければ訪問の種類（ADR-0047）', () => {
    expect(item('settings').to).toBe('/types');
    expect(settingsHref(applyTemplate('basic'))).toBe('/types');
    expect(settingsHref({}, '/data')).toBe('/data');
    expect(settingsHref({ rules: false }, '/rules')).toBe('/types');
    expect(settingsHref({}, '/compat')).toBe('/types');
    expect(item('settings', menuSections(terms, TODAY, {}, { settings: '/types' })).to).toBe('/types');
  });
  it('isScheduleView・isSettingsPath', () => {
    for (const p of ['/month', '/week', '/plan', '/schedule']) expect(isScheduleView(p)).toBe(true);
    expect(isScheduleView('/compare')).toBe(false);
    for (const p of ['/types', '/items', '/rules', '/settings', '/data']) expect(isSettingsPath(p)).toBe(true);
    expect(isSettingsPath('/staff')).toBe(false);
    expect(isSettingsPath('/compat')).toBe(false);
  });
});

describe('isActiveNav（今の画面の印。PRD D273・D275）', () => {
  it('「予定」は月・週・日の予定（古い #/schedule も）。比較は予定を組む', () => {
    for (const p of ['/month', '/week', '/plan', '/schedule'])
      expect(isActiveNav(item('schedule'), p)).toBe(true);
    expect(isActiveNav(item('schedule'), '/home')).toBe(false);
  });
  it('「設定」は設定のタブ。勤務の見込みは勤務時間（シフト）', () => {
    for (const p of ['/types', '/items', '/rules', '/settings', '/data'])
      expect(isActiveNav(item('settings'), p)).toBe(true);
    expect(isActiveNav(item('settings'), '/compat')).toBe(false);
    for (const p of ['/clients', '/staff', '/compat', '/availability', '/workload'])
      expect(isActiveNav(item('people'), p)).toBe(true);
  });
  it('操作の項目は今の画面にしない', () => {
    expect(isActiveNav(item('absence'), '/plan')).toBe(false);
  });
  it('古い #/schedule は日の予定と見る', () => {
    expect(activeNavPath('/schedule')).toBe('/plan');
    expect(activeNavPath('/week')).toBe('/week');
  });
  it('〈利用者さん〉・〈スタッフ〉の画面は一覧の項目に当てる（PRD D308）', () => {
    expect(activeNavPath('/clients/c1')).toBe('/clients');
    expect(activeNavPath('/staff/new')).toBe('/staff');
    expect(isActiveNav(item('people'), '/clients/c1')).toBe(true);
    expect(isActiveNav(item('people'), '/staff/s1')).toBe(true);
    expect(activeNavPath('/staff-view/s1')).toBe('/staff-view/s1');
  });
});

describe('navTitle（上の帯の名前。画面の一覧から引く）', () => {
  it('グループの見出し＋項目名で、〈利用者さん〉と〈スタッフ〉の一覧を見分ける', () => {
    expect(navTitle(screens, '/clients')).toBe('人・利用者さん一覧');
    expect(navTitle(screens, '/staff')).toBe('人・スタッフ一覧');
    expect(navTitle(screens, '/availability')).toBe('人・勤務時間（シフト）');
    expect(navTitle(screens, '/compat')).toBe('人・相性');
    expect(navTitle(screens, '/workload')).toBe('人・勤務の見込み');
    expect(navTitle(screens, '/vacancy')).toBe('空き状況');
  });
  it('予定は項目名だけ（「日の予定」にそろえる。PRD D230・D273）', () => {
    expect(navTitle(screens, '/plan')).toBe('日の予定');
    expect(navTitle(screens, '/schedule')).toBe('日の予定');
    expect(navTitle(screens, '/month')).toBe('月の予定');
    expect(navTitle(screens, '/week')).toBe('週の予定');
    expect(navTitle(screens, '/compare')).toBe('提案を比べる');
    expect(navTitleParts(screens, '/plan')).toEqual({ group: null, item: '日の予定' });
  });
  it('設定のタブは「設定・〜」、見出しの無いグループは項目名だけ', () => {
    expect(navTitle(screens, '/rules')).toBe('設定・条件の重み');
    expect(navTitle(screens, '/data')).toBe('設定・データ');
    expect(navTitle(screens, '/settings')).toBe('設定・管理者設定');
    expect(navTitle(screens, '/types')).toBe('設定・訪問の種類');
    expect(navTitle(screens, '/home')).toBe('ホーム');
  });
  it('一覧に無い画面は null', () => {
    expect(navTitle(screens, '/nowhere')).toBeNull();
    expect(navTitleParts(screens, '/nowhere')).toBeNull();
  });
  it('navTitleParts：見出しと項目名を分ける（見出しの無いグループは null）', () => {
    expect(navTitleParts(screens, '/clients')).toEqual({ group: '人', item: '利用者さん一覧' });
    expect(navTitleParts(screens, '/home')).toEqual({ group: null, item: 'ホーム' });
  });
});

describe('bottomTabs（PRD D336）', () => {
  it('ホーム・予定・欠勤の順に引き、短い名前で出す（4つ目の「探す」・5つ目の「メニュー」は画面のボタン。空き状況は出さない）', () => {
    expect(bottomTabs(groups).map(tabLabel)).toEqual(['ホーム', '予定', '欠勤']);
    expect(bottomTabs(groups).map((i) => i.label)).toEqual(['ホーム', '予定', '欠勤・キャンセル']);
  });
  it('メニューに無い項目は出さない', () => {
    expect(bottomTabs([{ items: [{ key: 'home', to: '/home', label: 'ホーム' }] }]).map((i) => i.to)).toEqual([
      '/home',
    ]);
    expect(bottomTabs([{ items: [{ key: 'vacancy', to: '/vacancy', label: '空き状況' }] }])).toEqual([]);
  });
  it('短い名前が無ければメニューの名前', () => {
    expect(tabLabel({ to: '/x', label: '名前' })).toBe('名前');
    expect(tabLabel({ to: '/x', label: '名前', short: '短' })).toBe('短');
  });
});

describe('tabClick（下のタブ・メニューを押したとき）', () => {
  it('今開いている画面そのものなら何もしない。ほかは移る', () => {
    expect(tabClick(item('home'), '/home')).toBe('stay');
    expect(tabClick(item('schedule'), '/plan')).toBe('stay');
    expect(tabClick(item('schedule'), '/schedule')).toBe('stay');
    // 比較から「予定」は覚えた表示（既定は日の予定）へ移る
    expect(tabClick(item('schedule'), '/compare')).toBe('go');
    // 覚えた表示が月なら、週から押すと月へ
    const g = menuSections(terms, TODAY, {}, { schedule: '/month' });
    expect(tabClick(item('schedule', g), '/week')).toBe('go');
    expect(tabClick(item('schedule', g), '/month')).toBe('stay');
    // 欠勤は操作なので、日の予定の上でも移る（欄を開く）
    expect(tabClick(item('absence'), '/plan')).toBe('go');
    // 人の画面から「人」を押すと一覧（覚えたタブ）へ移る
    expect(tabClick(item('people'), '/clients/c1')).toBe('go');
    expect(tabClick(item('people'), '/clients')).toBe('stay');
    expect(tabClick(item('people'), '/staff')).toBe('go');
  });
});

describe('showsDateSwitch（PRD D267・D347）', () => {
  it('日付で中身が変わる画面だけ日付の選択を出す（予定の3画面は画面の中のナビの行）', () => {
    for (const p of ['/compare', '/workload', '/availability']) expect(showsDateSwitch(p)).toBe(true);
    for (const p of [
      '/plan',
      '/schedule',
      '/week',
      '/month',
      '/home',
      '/vacancy',
      '/clients',
      '/staff',
      '/compat',
      '/rules',
      '/types',
      '/items',
      '/settings',
      '/data',
    ])
      expect(showsDateSwitch(p)).toBe(false);
  });
});
