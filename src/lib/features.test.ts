import { describe, expect, it } from 'vitest';
import type { Absence, Client, Staff } from '../contracts/documents';
import { FEATURE_IDS, type FeatureId, type Features } from '../contracts/features';
import { createDemoData } from '../seed';
import { paletteActions } from './commandPalette';
import {
  applyTemplate,
  calcFeaturesOf,
  FEATURE_GROUPS,
  FEATURES,
  featureDef,
  featureLabel,
  featureOfHref,
  featureOfLocation,
  fillTerms,
  isFeatureOffState,
  isHrefOn,
  isOn,
  matchTemplate,
  sameCalcFeatures,
  TEMPLATE_IDS,
  TEMPLATES,
  type TemplateId,
  templateDiff,
  turnOffImpact,
  withFeature,
} from './features';
import { homeEntries, homeTasks } from './home';
import { attentionTarget, dayHref, linkIfOn, suddenHref, unassignedHref, workloadHref } from './links';
import type { Attention, DayStatus } from './month';
import { bottomTabs, menuSections } from './nav';
import { recreateTodayHref } from './rebuildBand';
import { tourSteps } from './tour';

const terms = { client: '利用者さん', staff: 'スタッフ' };
const TODAY = '2026-10-21';

/** 土台の画面（切れない。PRD D210）：ホーム・月・週・日・〈利用者さん〉一覧・〈スタッフ〉一覧・稼働時間・訪問の種類・データ・管理者設定 */
const BASE_PATHS = new Set([
  '/home',
  '/month',
  '/week',
  '/plan',
  '/clients',
  '/staff',
  '/availability',
  '/types',
  '/data',
  '/settings',
]);
const pathOf = (href: string) => href.split('?')[0]!;
/** 行き先が土台か表のどれかの機能に属するか */
const belongs = (href: string) => featureOfHref(href) !== null || BASE_PATHS.has(pathOf(href));

/** ADR-0028 の「ひな形」の表（入れる機能） */
const TABLE: Record<TemplateId, FeatureId[]> = {
  basic: ['sudden', 'vacancy', 'compat', 'mapsLink', 'geocode'],
  laborContract: ['sudden', 'vacancy', 'compat', 'clientStage', 'offboard', 'workload', 'fare', 'mapsLink', 'geocode'],
  monthlyField: [
    'patternMonthly',
    'clientLeave',
    'requestedOff',
    'monthPrint',
    'sudden',
    'vacancy',
    'vacancyNotice',
    'compat',
    'allowedStaff',
    'visitNotes',
    'mapsLink',
    'geocode',
    'excel',
  ],
  all: [...FEATURE_IDS],
};

describe('機能の表（ADR-0028 の機能の一覧）', () => {
  it('20の機能が契約の ID と同じ順に1つずつ。グループは決まった7つのどれか', () => {
    expect(FEATURES.map((f) => f.id)).toEqual([...FEATURE_IDS]);
    expect(FEATURES).toHaveLength(20);
    for (const f of FEATURES) {
      expect(FEATURE_GROUPS).toContain(f.group);
      expect(f.label).not.toBe('');
      expect(f.description).not.toBe('');
      expect(f.hides).not.toBe('');
    }
  });
  it('依存は 空き枠の案内文 → 空き状況、交通費 → 稼働の見込み の2つだけ', () => {
    expect(FEATURES.filter((f) => f.requires).map((f) => [f.id, f.requires])).toEqual([
      ['vacancyNotice', 'vacancy'],
      ['fare', 'workload'],
    ]);
  });
  it('名前の呼び方は terms から', () => {
    expect(featureLabel('clientLeave', terms)).toBe('利用者さんの休み');
    expect(featureLabel('clientLeave', { client: 'お客様', staff: 'シッター' })).toBe('お客様の休み');
    expect(fillTerms('{staff}と{client}', { client: 'お客様', staff: 'シッター' })).toBe('シッターとお客様');
    expect(featureDef('compare').label).toBe('案を比べる');
  });
});

describe('isOn（依存を見る）', () => {
  it('無い ID は入。{} はすべて入', () => {
    for (const id of FEATURE_IDS) expect(isOn({}, id)).toBe(true);
  });
  it('切ったものは切', () => {
    expect(isOn({ compat: false }, 'compat')).toBe(false);
    expect(isOn({ compat: true }, 'compat')).toBe(true);
  });
  it('空き状況を切ると空き枠の案内文も切、稼働の見込みを切ると交通費も切（スイッチが入でも）', () => {
    expect(isOn({ vacancy: false, vacancyNotice: true }, 'vacancyNotice')).toBe(false);
    expect(isOn({ workload: false }, 'fare')).toBe(false);
    expect(isOn({ workload: true, fare: true }, 'fare')).toBe(true);
    expect(isOn({ fare: false }, 'workload')).toBe(true);
  });
  it('withFeature はその機能だけ明示して書く', () => {
    const f: Features = { compat: false };
    expect(withFeature(f, 'mail', false)).toEqual({ compat: false, mail: false });
    expect(withFeature(f, 'compat', true)).toEqual({ compat: true });
    expect(f).toEqual({ compat: false });
  });
});

describe('featureOfLocation（URL に要る機能）', () => {
  it('機能の画面', () => {
    expect(featureOfLocation('/vacancy', '')).toBe('vacancy');
    expect(featureOfLocation('/compare', '')).toBe('compare');
    expect(featureOfLocation('/workload', '?ym=2026-10&staff=s1')).toBe('workload');
    expect(featureOfLocation('/compat', '?id=c1')).toBe('compat');
    expect(featureOfLocation('/rules', '')).toBe('rules');
    expect(featureOfLocation('/items', '')).toBe('rules');
    expect(featureOfLocation('/month/print', '?ym=2026-10')).toBe('monthPrint');
  });
  it('?do= の入口：欠勤・キャンセルは sudden、今日の案をいまの条件で作り直すは rules', () => {
    expect(featureOfLocation('/plan', `?date=${TODAY}&do=absence`)).toBe('sudden');
    expect(featureOfLocation('/plan', '?do=absence&staff=s1')).toBe('sudden');
    expect(featureOfLocation('/plan', `?date=${TODAY}&do=recreate`)).toBe('rules');
    expect(featureOfHref(suddenHref(TODAY, 's1'))).toBe('sudden');
    expect(featureOfHref(recreateTodayHref(TODAY))).toBe('rules');
  });
  it('土台の画面・土台の操作は null', () => {
    for (const p of BASE_PATHS) expect(featureOfLocation(p, '')).toBeNull();
    expect(featureOfLocation('/plan', `?date=${TODAY}&do=unassigned`)).toBeNull();
    expect(featureOfLocation('/month', '?ym=2026-10&do=batch')).toBeNull();
    expect(featureOfLocation('/month', '?do=absence')).toBeNull();
    expect(featureOfLocation('/clients', '?id=c1')).toBeNull();
  });
  it('大文字小文字・末尾の / を区別しない（#/Vacancy・#/vacancy/・#/month/print/ でガードをすり抜けない）', () => {
    expect(featureOfLocation('/vacancy/', '')).toBe('vacancy');
    expect(featureOfLocation('/Vacancy', '')).toBe('vacancy');
    expect(featureOfLocation('/VACANCY//', '')).toBe('vacancy');
    expect(featureOfLocation('/month/print/', '?ym=2026-10')).toBe('monthPrint');
    expect(featureOfLocation('/Month/Print', '')).toBe('monthPrint');
    expect(featureOfLocation('/plan/', `?date=${TODAY}&do=absence`)).toBe('sudden');
    expect(featureOfLocation('/Plan', '?do=recreate')).toBe('rules');
    expect(featureOfHref('/Workload/?ym=2026-10')).toBe('workload');
    expect(featureOfLocation('/', '')).toBeNull();
    expect(featureOfLocation('/Month/', '')).toBeNull();
  });
  it('featureOfHref は # から後を見ない（/rules#presets は rules）', () => {
    expect(featureOfHref('/rules#presets')).toBe('rules');
    expect(featureOfHref('/plan?do=absence#x')).toBe('sudden');
    expect(isHrefOn({ rules: false }, '/rules#presets')).toBe(false);
  });
  it('isHrefOn：土台はいつも、機能はその入り切りで', () => {
    expect(isHrefOn({ vacancy: false }, '/vacancy')).toBe(false);
    expect(isHrefOn({ vacancy: false }, '/home')).toBe(true);
    expect(isHrefOn({}, '/vacancy')).toBe(true);
  });
  it('ルートの state（ホームの知らせ）', () => {
    expect(isFeatureOffState({ featureOff: 'vacancy' })).toBe(true);
    expect(isFeatureOffState({ featureOff: 'nope' })).toBe(false);
    expect(isFeatureOffState(null)).toBe(false);
    expect(isFeatureOffState('vacancy')).toBe(false);
  });
});

describe('ひな形（ADR-0028 の表）', () => {
  it('4つが 基本・労務・契約管理・月次予定・現場共有・すべて の順', () => {
    expect(TEMPLATES.map((t) => [t.id, t.label])).toEqual([
      ['basic', '基本'],
      ['laborContract', '労務・契約管理'],
      ['monthlyField', '月次予定・現場共有'],
      ['all', 'すべて'],
    ]);
    for (const t of TEMPLATES) expect(t.description).not.toBe('');
  });
  it.each(TEMPLATE_IDS)('%s を当てると表どおりの入り切り（全20の ID を明示）で、matchTemplate がそれを返す', (id) => {
    const f = applyTemplate(id);
    expect(Object.keys(f).sort()).toEqual([...FEATURE_IDS].sort());
    const on = FEATURE_IDS.filter((x) => f[x]);
    expect(on.sort()).toEqual([...TABLE[id]].sort());
    expect(matchTemplate(f)).toBe(id);
  });
  it('「条件の重みとプリセット」「案を比べる」「メール」は すべて 以外で切', () => {
    for (const id of ['basic', 'laborContract', 'monthlyField'] as const) {
      const f = applyTemplate(id);
      expect([f.rules, f.compare, f.mail]).toEqual([false, false, false]);
    }
  });
  it('{}（無い古いデータ・初期データ）は すべて', () => {
    expect(matchTemplate({})).toBe('all');
    expect(matchTemplate({ compat: true })).toBe('all');
  });
  it('1つ直すと custom', () => {
    expect(matchTemplate({ compat: false })).toBe('custom');
    expect(matchTemplate(withFeature(applyTemplate('basic'), 'mail', true))).toBe('custom');
    expect(matchTemplate(withFeature(applyTemplate('laborContract'), 'fare', false))).toBe('custom');
  });
  it('使えるか（依存を見る）で比べる：依存先が切なら、依存する機能のスイッチが入でもひな形と同じ', () => {
    // 基本（稼働の見込み・空き状況の案内文は切）に、交通費だけ入れても稼働の見込みが切なので使えない＝基本のまま
    expect(matchTemplate(withFeature(applyTemplate('basic'), 'fare', true))).toBe('basic');
    // 月次予定・現場共有から空き状況を切ると案内文も使えない。基本との差は残るので custom
    expect(matchTemplate(withFeature(applyTemplate('monthlyField'), 'vacancy', false))).toBe('custom');
    // すべてから稼働の見込みを切った（交通費のスイッチは入のまま）ものは、どのひな形とも違う
    expect(matchTemplate({ workload: false })).toBe('custom');
  });
  it('templateDiff：入る機能・切れる機能（表の順）', () => {
    expect(templateDiff({}, 'all')).toEqual({ on: [], off: [] });
    expect(templateDiff({}, 'basic')).toEqual({
      on: [],
      off: FEATURE_IDS.filter((x) => !TABLE.basic.includes(x)),
    });
    expect(templateDiff(applyTemplate('basic'), 'laborContract')).toEqual({
      on: ['clientStage', 'offboard', 'workload', 'fare'],
      off: [],
    });
    expect(templateDiff(applyTemplate('laborContract'), 'monthlyField')).toEqual({
      on: [
        'patternMonthly',
        'clientLeave',
        'requestedOff',
        'monthPrint',
        'vacancyNotice',
        'allowedStaff',
        'visitNotes',
        'excel',
      ],
      off: ['clientStage', 'offboard', 'workload', 'fare'],
    });
  });
  it('templateDiff は使えるか（依存）で比べる：空き状況が切なら案内文は入っていない扱い', () => {
    const f: Features = { ...applyTemplate('monthlyField'), vacancy: false };
    expect(templateDiff(f, 'monthlyField')).toEqual({ on: ['vacancy', 'vacancyNotice'], off: [] });
  });
});

describe('menuSections（ひな形ごとの項目。PRD D213）', () => {
  const labels = (f: Features) => menuSections(terms, TODAY, f).flatMap((g) => g.items.map((i) => i.label));
  const titles = (f: Features) => menuSections(terms, TODAY, f).map((g) => g.title ?? null);
  it('すべて：今と同じ16に、管理者設定が足されるだけ', () => {
    expect(labels(applyTemplate('all'))).toEqual(labels({}));
    expect(labels({})).toHaveLength(17);
  });
  it('基本：12＋管理者設定（案を比べる・稼働の見込み・条件の重み・特性の項目が無い）', () => {
    expect(labels(applyTemplate('basic'))).toEqual([
      'ホーム',
      '月',
      '週',
      '日',
      '欠勤・キャンセル',
      '空き状況',
      '利用者さん一覧',
      '相性',
      'スタッフ一覧',
      '稼働時間',
      '訪問の種類',
      '管理者設定',
      'データ',
    ]);
  });
  it('労務・契約管理：13＋管理者設定（稼働の見込みが戻る）', () => {
    const l = labels(applyTemplate('laborContract'));
    expect(l).toHaveLength(14);
    expect(l).toContain('稼働の見込み');
    expect(l).not.toContain('案を比べる');
    expect(l).not.toContain('条件の重み');
  });
  it('月次予定・現場共有：12＋管理者設定', () => {
    const l = labels(applyTemplate('monthlyField'));
    expect(l).toHaveLength(13);
    expect(l).not.toContain('稼働の見込み');
  });
  it('項目の無くなったグループは見出しごと出さない', () => {
    expect(titles({ sudden: false })).not.toContain('当日の対応');
    expect(titles({ vacancy: false })).not.toContain('問い合わせ');
    // AI の考え方は訪問の種類（土台）が残る
    expect(titles({ rules: false })).toContain('AI の考え方');
    expect(titles(applyTemplate('basic'))).toEqual([
      null,
      '予定を組む',
      '当日の対応',
      '問い合わせ',
      '人の情報',
      'AI の考え方',
      '管理者',
    ]);
  });
  it('下のタブは空き状況を切ると4つ', () => {
    expect(bottomTabs(menuSections(terms, TODAY, {})).map((t) => t.to)).toEqual([
      '/home',
      '/month',
      '/week',
      '/plan',
      '/vacancy',
    ]);
    expect(bottomTabs(menuSections(terms, TODAY, { vacancy: false })).map((t) => t.to)).toEqual([
      '/home',
      '/month',
      '/week',
      '/plan',
    ]);
  });
});

/** 状態（既定は訪問3件・確定済み・問題なし） */
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
const homeInput = (features: Features = {}) => ({
  today: TODAY,
  statuses: [st(TODAY, { state: 'plan', unassigned: 1 }), st('2026-10-22', { state: 'none' })],
  months: [{ ym: '2026-10', canExpand: 3 }],
  todayStaff: 2,
  data: { absences: [] as Absence[], staff: [] as Staff[] },
  features,
});

describe('表の整合（メニュー・パレット・ホーム・ツアー・links の行き先が、土台か表のどれかに属する）', () => {
  it('メニューの項目', () => {
    for (const g of menuSections(terms, TODAY, {})) for (const i of g.items) expect(belongs(i.to), i.to).toBe(true);
  });
  it('パレットの操作', () => {
    for (const a of paletteActions(TODAY, { customRules: true })) expect(belongs(a.to), a.to).toBe(true);
  });
  it('ホームのカードといつでもの入口', () => {
    const r = homeTasks(homeInput());
    expect(r.tasks.length).toBeGreaterThan(2);
    for (const t of r.tasks) expect(belongs(t.to), t.to).toBe(true);
    for (const e of homeEntries(TODAY, terms, {})) expect(belongs(e.to), e.to).toBe(true);
  });
  it('ツアーの枚の機能は表のどれか（無ければ土台）', () => {
    for (const s of tourSteps(terms, false)) if (s.feature) expect(FEATURE_IDS).toContain(s.feature);
  });
  it('links の行き先', () => {
    for (const h of [
      suddenHref(TODAY),
      suddenHref(TODAY, 's1'),
      dayHref(TODAY),
      unassignedHref(TODAY),
      workloadHref('2026-10'),
    ])
      expect(belongs(h), h).toBe(true);
  });
});

describe('切った機能の入口を出さない（PRD D213）', () => {
  it('パレット：欠勤・キャンセルを登録・問い合わせに答える・いまの条件で作り直す', () => {
    const ids = (f: Features) => paletteActions(TODAY, { customRules: true, features: f }).map((a) => a.id);
    expect(ids({})).toContain('action:absence');
    expect(ids({ sudden: false })).not.toContain('action:absence');
    expect(ids({ vacancy: false })).not.toContain('action:vacancy');
    expect(ids({ rules: false })).not.toContain('action:recreate');
    expect(ids(applyTemplate('basic'))).toEqual(ids({}).filter((x) => x !== 'action:recreate'));
  });
  it('ホーム：いつでもの入口（欠勤・キャンセル・問い合わせ）', () => {
    expect(homeEntries(TODAY, terms, {}).map((e) => e.key)).toEqual(['absence', 'vacancy', 'clients', 'staff']);
    expect(homeEntries(TODAY, terms, { sudden: false, vacancy: false }).map((e) => e.key)).toEqual([
      'clients',
      'staff',
    ]);
    expect(homeEntries(TODAY, { client: 'お客様', staff: 'シッター' }, {})[2]!.title).toBe('お客様を探す');
    // 次の一手のカードはどれも土台なので、入り切りで変わらない
    expect(homeTasks(homeInput(applyTemplate('basic')))).toEqual(homeTasks(homeInput()));
  });
  it('ツアー：欠勤・キャンセルと条件の重みの枚を出さず、枚数が減る', () => {
    expect(tourSteps(terms, false, {}).map((s) => s.key)).toEqual([
      'home',
      'plan',
      'absence',
      'rules',
      'search',
      'flow',
    ]);
    expect(tourSteps(terms, false, applyTemplate('basic')).map((s) => s.key)).toEqual([
      'home',
      'plan',
      'absence',
      'search',
      'flow',
    ]);
    expect(tourSteps(terms, false, { sudden: false, rules: false }).map((s) => s.key)).toEqual([
      'home',
      'plan',
      'search',
      'flow',
    ]);
    // 案を比べるを切ると、予定を組むの場所の文から外す
    expect(tourSteps(terms, false, {})[1]!.where).toContain('案を比べる');
    expect(tourSteps(terms, false, { compare: false })[1]!.where).not.toContain('案を比べる');
  });
  it('links：切った機能なら null、土台はそのまま', () => {
    expect(linkIfOn({}, suddenHref(TODAY))).toBe(suddenHref(TODAY));
    expect(linkIfOn({ sudden: false }, suddenHref(TODAY, 's1'))).toBeNull();
    expect(linkIfOn({ workload: false }, workloadHref('2026-10', 's1'))).toBeNull();
    expect(linkIfOn({ workload: false, sudden: false }, unassignedHref(TODAY))).toBe(unassignedHref(TODAY));
    expect(linkIfOn(applyTemplate('basic'), dayHref(TODAY))).toBe(dayHref(TODAY));
  });
  it('月の要対応の行き先：切った機能なら、その日の日の画面', () => {
    const at = (kind: Attention['kind']): Attention => ({ date: TODAY, kind, count: 1, names: [], staffIds: ['s1'] });
    const day = { to: '/plan', date: TODAY, note: '（日の画面で開く）' };
    expect(attentionTarget(at('overSpan'), { workload: false })).toEqual(day);
    expect(attentionTarget(at('absentLeft'), { sudden: false })).toEqual(day);
    expect(attentionTarget(at('overSpan'), {}).to).toBe('/workload?ym=2026-10&staff=s1');
    expect(attentionTarget(at('unassigned'), applyTemplate('basic')).to).toBe(unassignedHref(TODAY));
  });
});

describe('計算に効く入り切り（calcFeaturesOf・sameCalcFeatures。ADR-0028）', () => {
  it('切っている相性・担当を限るだけを書く。すべて入・ほかの機能だけ切ったときは {}', () => {
    expect(calcFeaturesOf({})).toEqual({});
    expect(calcFeaturesOf({ mail: false, clientLeave: false })).toEqual({});
    expect(calcFeaturesOf({ compat: false, allowedStaff: true })).toEqual({ compat: false });
    expect(calcFeaturesOf(applyTemplate('basic'))).toEqual({ allowedStaff: false });
  });
  it('無い（古い記録）はすべて入と同じ', () => {
    expect(sameCalcFeatures(undefined, {})).toBe(true);
    expect(sameCalcFeatures(undefined, { compat: true, allowedStaff: true })).toBe(true);
    expect(sameCalcFeatures(undefined, { compat: false })).toBe(false);
    expect(sameCalcFeatures({ allowedStaff: false }, { allowedStaff: false })).toBe(true);
  });
});

describe('turnOffImpact（切るときに残る・外れるデータ。PRD D215）', () => {
  const TODAY_I = '2026-11-05';
  const d0 = createDemoData('2026-11-02');
  // 利用中・休止の区別をはっきりさせる（先頭3人の〈利用者さん〉は利用中、4人目は終了。〈スタッフ〉は先頭2人が利用中、3人目は休止）
  const d = {
    ...d0,
    clients: d0.clients.map((c, i) =>
      i === 3 ? { ...c, active: false, stage: 'ended' as const } : { ...c, active: true },
    ),
    staff: d0.staff.map((x, i) => (i === 2 ? { ...x, active: false } : { ...x, active: true })),
  };
  const [c0, c1, c2, c3] = d.clients as [Client, Client, Client, Client];
  const [s0, s1, s2] = d.staff as [Staff, Staff, Staff];
  const data = {
    ...d,
    compat: {
      // 利用中×利用中の値のある組だけ数える（0・休止の〈スタッフ〉・終了の〈利用者さん〉は数えない）
      [c0.id]: { [s0.id]: -2 as const, [s1.id]: 0 as const, [s2.id]: 2 as const },
      [c1.id]: { [s0.id]: 2 as const },
      [c3.id]: { [s0.id]: -2 as const },
    },
    clients: d.clients.map((c) =>
      c.id === c0.id || c.id === c1.id
        ? { ...c, allowedStaffIds: [s0.id] }
        : // 休止の人だけに限った人・終了の人は計算に効かない
          c.id === c2.id || c.id === c3.id
          ? { ...c, allowedStaffIds: [s2.id] }
          : c,
    ),
    clientLeaves: [
      { id: 'l1', clientId: c0.id, from: '2026-11-03', to: '2026-11-05', note: '入院' },
      { id: 'l2', clientId: c1.id, from: '2026-11-10', to: '2026-11-10', note: '' },
      { id: 'l3', clientId: c1.id, from: '2026-11-01', to: '2026-11-04', note: '終わった休み' },
    ],
    absences: [
      { id: 'a1', staffId: s0.id, date: '2026-11-05', from: null, to: null, note: '希望休' },
      { id: 'a0', staffId: s0.id, date: '2026-11-04', from: null, to: null, note: '希望休' },
      { id: 'a2', staffId: s1.id, date: '2026-11-06', from: null, to: null, note: '病院' },
      { id: 'a3', staffId: s1.id, date: '2026-11-07', from: '09:00', to: '12:00', note: '' },
      { id: 'a4', staffId: s1.id, date: '2026-11-01', from: null, to: null, note: '過ぎた欠勤' },
    ],
  };
  it('相性は利用中の〈利用者さん〉×休止でない〈スタッフ〉の値のある組、担当を限るは計算で効く人で「計算から外れます」', () => {
    expect(turnOffImpact(data, 'compat', TODAY_I)).toEqual({ count: 2, text: '相性 2組は計算から外れます' });
    expect(turnOffImpact(data, 'allowedStaff', TODAY_I)).toEqual({
      count: 2,
      text: `担当を限る 2人（${d.org.terms.client}）は計算から外れます`,
    });
  });
  it('事実（休み・希望休・欠勤）は今日以降に掛かるものだけを「残り、計算に効き続けます」。呼び方を使う', () => {
    expect(turnOffImpact(data, 'clientLeave', TODAY_I)).toEqual({
      count: 2,
      text: `${d.org.terms.client}の休み 2件は残り、計算に効き続けます`,
    });
    expect(turnOffImpact(data, 'requestedOff', TODAY_I)).toEqual({
      count: 1,
      text: '希望休 1件は残り、計算に効き続けます',
    });
    expect(turnOffImpact(data, 'sudden', TODAY_I)).toEqual({ count: 2, text: '欠勤 2件は残り、計算に効き続けます' });
    // 今日が過ぎれば数えない
    expect(turnOffImpact(data, 'clientLeave', '2026-11-11')).toBeNull();
    expect(turnOffImpact(data, 'sudden', '2026-11-08')).toBeNull();
  });
  it('空き状況は仮押さえの〈利用者さん〉の件数で「AI案に入り続けます」', () => {
    const held = { ...data, clients: data.clients.map((c, i) => (i < 2 ? { ...c, tentative: true } : c)) };
    expect(turnOffImpact(held, 'vacancy', TODAY_I)).toEqual({
      count: 2,
      text: `仮押さえ 2人（${d.org.terms.client}）は残り、AI案に入り続けます`,
    });
    expect(turnOffImpact(data, 'vacancy', TODAY_I)).toBeNull();
  });
  it('呼び方を変えたデータでは、その呼び方で出す', () => {
    const renamed = {
      ...data,
      org: { ...data.org, terms: { ...data.org.terms, client: 'お客様', staff: 'シッター' } },
    };
    expect(turnOffImpact(renamed, 'allowedStaff', TODAY_I)?.text).toBe('担当を限る 2人（お客様）は計算から外れます');
    expect(turnOffImpact(renamed, 'clientLeave', TODAY_I)?.text).toBe('お客様の休み 2件は残り、計算に効き続けます');
    const held = { ...renamed, clients: renamed.clients.map((c, i) => (i === 0 ? { ...c, tentative: true } : c)) };
    expect(turnOffImpact(held, 'vacancy', TODAY_I)?.text).toBe('仮押さえ 1人（お客様）は残り、AI案に入り続けます');
    const off = { ...renamed, staff: renamed.staff.map((x, i) => (i === 0 ? { ...x, lastDay: '2026-12-01' } : x)) };
    expect(turnOffImpact(off, 'offboard', TODAY_I)?.text).toBe('最終勤務日 1人（シッター）は残り、計算に効き続けます');
  });
  it('定期パターンは毎月・曜日ごとの時刻を使うものだけ数える', () => {
    const p = d.patterns[0]!;
    const withMonthly = {
      ...data,
      patterns: [
        { ...p, id: 'p1', repeat: 'monthly' as const, monthWeeks: [1] },
        { ...p, id: 'p2', repeat: 'weekly' as const, monthWeeks: [], dayTimes: [] },
      ],
    };
    expect(turnOffImpact(withMonthly, 'patternMonthly', TODAY_I)).toEqual({
      count: 1,
      text: '定期パターンの毎月・曜日ごとの時刻 1件は残り、訪問は今どおり作られます',
    });
  });
  it('データが無い・数えない機能は null（確認を出さない）', () => {
    const empty = { ...data, compat: {}, clientLeaves: [], absences: [] };
    expect(turnOffImpact(empty, 'compat', TODAY_I)).toBeNull();
    expect(turnOffImpact(empty, 'clientLeave', TODAY_I)).toBeNull();
    expect(turnOffImpact(empty, 'requestedOff', TODAY_I)).toBeNull();
    expect(turnOffImpact(empty, 'sudden', TODAY_I)).toBeNull();
    expect(turnOffImpact(data, 'monthPrint', TODAY_I)).toBeNull();
    expect(turnOffImpact(data, 'compare', TODAY_I)).toBeNull();
  });
});
