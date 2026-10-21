// 〈利用者さん〉の絞り込み（PRD D108〜D112。ADR-0021）
import { describe, expect, it } from 'vitest';
import type { AiPlan } from '../contracts/data';
import type { Pattern } from '../contracts/documents';
import { client, DATE, makeData, staff, visit } from '../matching/fixtures';
import {
  activeFilterCount,
  type ClientFilterState,
  chipCounts,
  chipMatches,
  cityChips,
  decodeFilter,
  EMPTY_FILTER,
  encodeFilter,
  type FilterFacts,
  filterClients,
  filterFacts,
  matchArea,
  matchTypes,
  NO_AREA,
  resolveStaffId,
  sameFilter,
  staffCounts,
  toggleChip,
  toggleCity,
  toggleTown,
  toggleType,
  townChips,
  townKey,
  typeChips,
  WEEK_TABLE_FILTER,
} from './clientFilter';
import { weekDates, weekDay } from './week';

const at = (address: string) => ({ address, lat: null, lng: null, postalCode: '' });

/** 地区・段階・担当の違う5人（表示名の順） */
const people = [
  client('a', 0, 0, {
    displayName: 'あおば 一',
    kana: 'あおば',
    place: at('仙台市青葉区国分町3丁目'),
    usualStaffId: 's1',
  }),
  client('b', 0, 0, { displayName: 'いずみ 二', kana: 'いずみ', place: at('仙台市青葉区春日町'), usualStaffId: 's2' }),
  client('c', 0, 0, { displayName: 'うみ 三', kana: 'うみ', place: at('仙台市泉区泉中央'), allowedStaffIds: ['s1'] }),
  client('d', 0, 0, { displayName: 'えき 四', kana: 'えき', place: at(''), stage: 'ended', active: false }),
  client('e', 0, 0, { displayName: 'おか 五', kana: 'おか', place: at('宮城郡七ヶ浜町汐見台'), stage: 'inquiry' }),
];

const facts = (over: Partial<FilterFacts> = {}): FilterFacts => ({
  periodIds: new Set(['a', 'c']),
  unassignedIds: new Set(['c']),
  leaveIds: new Set(['b']),
  patternClientIds: new Set(['a', 'c']),
  staffClientIds: (id) => new Set(id === 's1' ? ['a', 'c'] : id === 's2' ? ['b'] : []),
  workingStaffIds: new Set(['s1']),
  endedShownIds: new Set(),
  ...over,
});
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const f = (over: Partial<ClientFilterState> = {}): ClientFilterState => ({ ...EMPTY_FILTER, ...over });

describe('チップの判定（chipMatches）', () => {
  const F = facts();
  const hit = (chip: Parameters<typeof chipMatches>[0], staffId = 's1') =>
    people.filter((c) => chipMatches(chip, c, F, staffId)).map((c) => c.id);
  it('期間に訪問がある・担当が決まっていない訪問がある・休み', () => {
    expect(hit('period')).toEqual(['a', 'c']);
    expect(hit('unassigned')).toEqual(['c']);
    expect(hit('leave')).toEqual(['b']);
  });
  it('〈スタッフ〉が担当する人（選んだ〈スタッフ〉で。空なら0人）', () => {
    expect(hit('staff', 's1')).toEqual(['a', 'c']);
    expect(hit('staff', 's2')).toEqual(['b']);
    expect(hit('staff', '')).toEqual([]);
  });
  it('いつもの担当がいない人：空か、働けない（休止・最終勤務日を過ぎた）〈スタッフ〉', () => {
    // a の s1 は働ける、b の s2 は働けない、c・d・e は空
    expect(hit('noUsual')).toEqual(['b', 'c', 'd', 'e']);
  });
  it('担当を限っている人', () => {
    expect(hit('limited')).toEqual(['c']);
  });
  it('定期パターンの無い人：利用中なのにパターンが無い人だけ（終了・相談受付は数えない）', () => {
    expect(hit('noPattern')).toEqual(['b']);
  });
});

describe('絞り込み（filterClients。AND）', () => {
  const F = facts();
  it('既定では終了の人を出さない。「終了の人も出す」で出る', () => {
    expect(ids(filterClients(people, f(), F, 's1'))).toEqual(['a', 'b', 'c', 'e']);
    expect(ids(filterClients(people, f({ showEnded: true }), F, 's1'))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('名前・よみ・地区・チップはすべてに当てはまる人だけ', () => {
    expect(ids(filterClients(people, f({ query: 'イズミ' }), F, 's1'))).toEqual(['b']);
    expect(ids(filterClients(people, f({ chips: ['period', 'limited'] }), F, 's1'))).toEqual(['c']);
    expect(ids(filterClients(people, f({ chips: ['period'], cities: ['仙台市青葉区'] }), F, 's1'))).toEqual(['a']);
    expect(ids(filterClients(people, f({ chips: ['leave', 'period'] }), F, 's1'))).toEqual([]);
  });
  it('endedShownIds の人（週間の表のこの週に訪問がある人）は終了でも出す', () => {
    const F2 = facts({ periodIds: new Set(['a', 'd']), endedShownIds: new Set(['d']) });
    expect(ids(filterClients(people, WEEK_TABLE_FILTER, F2, 's1'))).toEqual(['a', 'd']);
    expect(ids(filterClients(people, f(), F2, 's1'))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('週間の表の既定はこの週に訪問がある人', () => {
    expect(ids(filterClients(people, WEEK_TABLE_FILTER, F, 's1'))).toEqual(['a', 'c']);
  });
});

describe('地区（市区→町名）', () => {
  const F = facts();
  it('市区を選ぶとその市区の人、町名も選ぶとその町名の人。町名を選んでいない市区は全員', () => {
    const s = f({ cities: ['仙台市青葉区', '仙台市泉区'], towns: [townKey('仙台市青葉区', '春日町')] });
    expect(people.filter((c) => matchArea(c, s)).map((c) => c.id)).toEqual(['b', 'c']);
  });
  it('住所の無い人は「住所なし」にまとめる', () => {
    const s = f({ cities: [NO_AREA], showEnded: true });
    expect(ids(filterClients(people, s, F, 's1'))).toEqual(['d']);
  });
  it('市区のチップは名前の順、住所なしは最後。人数は地区のほかの絞り込みをかけた数', () => {
    const chips = cityChips(people, f({ showEnded: true }), F, 's1');
    // 名前の順は localeCompare('ja')（漢字は JIS の順）
    expect(chips.map((c) => [c.label, c.count])).toEqual([
      ['宮城郡七ヶ浜町', 1],
      ['仙台市青葉区', 2],
      ['仙台市泉区', 1],
      ['住所なし', 1],
    ]);
    // 終了の人を出さなければ住所なしのチップも出ない。チップで絞ると人数が変わる（0人の市区も残る）
    const withPeriod = cityChips(people, f({ chips: ['period'] }), F, 's1');
    expect(withPeriod.map((c) => [c.label, c.count])).toEqual([
      ['宮城郡七ヶ浜町', 0],
      ['仙台市青葉区', 1],
      ['仙台市泉区', 1],
    ]);
  });
  it('町名のチップは選んだ市区の中だけ', () => {
    const s = f({ cities: ['仙台市青葉区'] });
    expect(townChips(people, s, F, 's1', '仙台市青葉区').map((c) => [c.label, c.count])).toEqual([
      ['国分町', 1],
      ['春日町', 1],
    ]);
    expect(townChips(people, s, F, 's1', NO_AREA)).toEqual([]);
  });
  it('市区を外すとその市区の町名の選択も外れる', () => {
    let s = toggleCity(f(), '仙台市青葉区');
    s = toggleTown(s, townKey('仙台市青葉区', '国分町'));
    expect(s.towns).toEqual(['仙台市青葉区|国分町']);
    s = toggleCity(s, '仙台市青葉区');
    expect(s).toEqual(f());
  });
});

describe('チップの人数（chipCounts）', () => {
  it('押していないチップは押したら何人か、押しているチップは今の人数。0人も分かる', () => {
    const c = chipCounts(people, f({ chips: ['period'] }), facts(), 's1');
    expect(c).toEqual({ period: 2, staff: 2, unassigned: 1, noUsual: 1, limited: 1, leave: 0, noPattern: 0 });
  });
});

describe('toggleChip・resolveStaffId', () => {
  it('チップの並びは決まった順にそろう', () => {
    expect(toggleChip(f({ chips: ['leave'] }), 'period').chips).toEqual(['period', 'leave']);
    expect(toggleChip(f({ chips: ['period', 'leave'] }), 'period').chips).toEqual(['leave']);
  });
  const staffList = [{ id: 's0' }, { id: 's2' }, { id: 's1' }];
  it('選んだ〈スタッフ〉がいなければ、今の絞り込みで担当する人がいる最初の人', () => {
    expect(resolveStaffId(f(), staffList, facts(), people)).toBe('s2');
    expect(resolveStaffId(f({ staffId: 's1' }), staffList, facts(), people)).toBe('s1');
    expect(resolveStaffId(f({ staffId: 'gone' }), staffList, facts(), people)).toBe('s2');
    expect(resolveStaffId(f(), [], facts(), people)).toBe('');
    // s2 の担当の b は休み。ほかのチップ（この期間に訪問がある人）で b が外れると、最初の人は s1
    expect(resolveStaffId(f({ chips: ['period'] }), staffList, facts(), people)).toBe('s1');
    // 地区で絞っても同じ（泉区には s1 の c だけ）
    expect(resolveStaffId(f({ cities: ['仙台市泉区'] }), staffList, facts(), people)).toBe('s1');
  });
  it('select の人数は、その〈スタッフ〉で押したら何人になるか', () => {
    expect([...staffCounts(people, f(), facts(), staffList)]).toEqual([
      ['s0', 0],
      ['s2', 1],
      ['s1', 2],
    ]);
    expect([...staffCounts(people, f({ chips: ['limited'] }), facts(), staffList)]).toEqual([
      ['s0', 0],
      ['s2', 0],
      ['s1', 1],
    ]);
  });
});

describe('URL（?cf=）', () => {
  it('書いて読むと同じ状態に戻る（記号・日本語を含む）', () => {
    const s = f({
      query: 'あ;b,c:d',
      cities: ['仙台市青葉区', NO_AREA],
      towns: [townKey('仙台市青葉区', '国分町')],
      chips: ['staff', 'period'],
      staffId: 's1',
      showEnded: true,
    });
    const back = decodeFilter(encodeFilter(s), WEEK_TABLE_FILTER);
    expect(back).toEqual({ ...s, chips: ['period', 'staff'] });
    expect(sameFilter(back, s)).toBe(true);
  });
  it('URL に無ければ既定、チップの項目が空なら押していない', () => {
    expect(decodeFilter(null, WEEK_TABLE_FILTER)).toEqual(WEEK_TABLE_FILTER);
    expect(decodeFilter('chip:', WEEK_TABLE_FILTER).chips).toEqual([]);
    expect(decodeFilter('q:x', WEEK_TABLE_FILTER).chips).toEqual(['period']);
  });
  it('知らない項目・チップ・選んでいない市区の町名・壊れた文字は捨てる', () => {
    const s = decodeFilter('chip:period,bogus;zzz:1;town:%E5%A4%96|x;city:%E0%A4%A;ended:yes', WEEK_TABLE_FILTER);
    expect(s).toEqual({ ...EMPTY_FILTER, chips: ['period'] });
  });
  it('〈スタッフ〉はチップ「〈スタッフ〉が担当する人」を押しているときだけ書く', () => {
    expect(encodeFilter(f({ staffId: 's1' }))).toBe('chip:');
    expect(encodeFilter(f({ staffId: 's1', chips: ['staff'] }))).toBe('chip:staff;staff:s1');
    expect(sameFilter(f({ staffId: 's1' }), f())).toBe(true);
  });
  it('既定と同じなら sameFilter が true（URL から消す）', () => {
    expect(sameFilter(toggleChip(toggleChip(WEEK_TABLE_FILTER, 'leave'), 'leave'), WEEK_TABLE_FILTER)).toBe(true);
  });
});

describe('filterFacts（週の帯から作る）', () => {
  const dates = weekDates(DATE);
  const pat: Pattern = {
    id: 'p1',
    clientId: 'c1',
    typeId: null,
    weekdays: [1],
    everyWeeks: 1,
    repeat: 'weekly',
    monthWeeks: [],
    dayTimes: [],
    windowKind: 'window',
    earliestStart: '09:00',
    latestStart: '10:00',
    durationMinutes: 60,
    from: DATE,
    to: null,
    usualStaffId: null,
    note: '',
  };
  const base = () =>
    makeData({
      staff: [
        staff('s1', 38.26, 140.87),
        staff('s2', 38.26, 140.87, { lastDay: '2026-10-15' }),
        staff('s3', 38.26, 140.87, { active: false }),
      ],
      clients: [
        client('c1', 38.26, 140.87, { usualStaffId: 's2' }),
        client('c2', 38.27, 140.88, { usualStaffId: 's3' }),
        client('c3', 38.27, 140.88),
      ],
      visits: [
        visit('v1', 'c1', '09:00', '10:00'),
        visit('v2', 'c2', '11:00', '12:00', { date: '2026-10-14' }),
        visit('v3', 'c3', '13:00', '14:00', { date: '2026-10-14', cancelled: true }),
      ],
      patterns: [pat],
      clientLeaves: [{ id: 'l1', clientId: 'c3', from: '2026-10-18', to: '2026-10-25', note: '入院' }],
    });
  it('案の無い日の訪問は担当が決まっていない。取り消しは期間に数えない。休みは期間にかかれば', () => {
    const d = base();
    const days = dates.map((x) => weekDay(d, x));
    const F = filterFacts({ ...d, days });
    expect([...F.periodIds].sort()).toEqual(['c1', 'c2']);
    expect([...F.unassignedIds].sort()).toEqual(['c1', 'c2']);
    expect([...F.leaveIds]).toEqual(['c3']);
    expect([...F.patternClientIds]).toEqual(['c1']);
    // s2 は最終勤務日が週の終わり（10/18）より前、s3 は休止
    expect([...F.workingStaffIds]).toEqual(['s1']);
    expect([...F.staffClientIds('s2')]).toEqual(['c1']);
  });
  const planOf = (routes: Record<string, string[]>, unassigned: string[] = []): AiPlan => ({
    date: DATE,
    createdAt: 1,
    seed: 1,
    iterations: 1,
    routes,
    unassigned,
    score: 0,
    stopped: false,
    rules: [],
    generated: { routes, unassigned, score: 0 },
    pins: {},
  });
  it('今の案に入った訪問は担当が決まっている（担当の〈スタッフ〉が担当する人に入る）', () => {
    const d = base();
    const withPlan = { ...d, aiPlans: { [DATE]: planOf({ s1: ['v1'] }) } };
    const days = dates.map((x) => weekDay(withPlan, x));
    const F = filterFacts({ ...withPlan, days });
    expect([...F.unassignedIds]).toEqual(['c2']);
    expect([...F.staffClientIds('s1')]).toEqual(['c1']);
  });
  it('案がある日でも、案に入らない訪問は担当が決まっていない', () => {
    const d = base();
    const data = {
      ...d,
      visits: [...d.visits, visit('v4', 'c3', '15:00', '16:00')],
      aiPlans: { [DATE]: planOf({ s1: ['v1'] }, ['v4']) },
    };
    const F = filterFacts({ ...data, days: dates.map((x) => weekDay(data, x)) });
    expect([...F.unassignedIds].sort()).toEqual(['c2', 'c3']);
  });
  it('休みの帯は担当が決まっていない訪問に数えない（期間に訪問がある人には入る）', () => {
    const d = base();
    const data = { ...d, clientLeaves: [{ id: 'l2', clientId: 'c1', from: DATE, to: DATE, note: '' }] };
    const F = filterFacts({ ...data, days: dates.map((x) => weekDay(data, x)) });
    expect([...F.unassignedIds]).toEqual(['c2']);
    expect(F.periodIds.has('c1')).toBe(true);
    expect(F.leaveIds.has('c1')).toBe(true);
  });
  it('確定した割当（manualPlans）でも担当が決まっている', () => {
    const d = base();
    const data = { ...d, manualPlans: { '2026-10-14': { s1: ['v2'] } } };
    const F = filterFacts({ ...data, days: dates.map((x) => weekDay(data, x)) });
    expect([...F.unassignedIds]).toEqual(['c1']);
    expect(F.staffClientIds('s1').has('c2')).toBe(true);
  });
  it('showEndedInPeriod なら、期間に訪問がある人を endedShownIds に入れる', () => {
    const d = base();
    const days = dates.map((x) => weekDay(d, x));
    expect([...filterFacts({ ...d, days, showEndedInPeriod: true }).endedShownIds].sort()).toEqual(['c1', 'c2']);
    expect(filterFacts({ ...d, days }).endedShownIds.size).toBe(0);
  });
});

describe('activeFilterCount（PRD D220。畳んだ「絞り込み（N）」）', () => {
  it('何も絞らなければ0', () => {
    expect(activeFilterCount(EMPTY_FILTER)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTER, query: '  ' })).toBe(0);
  });
  it('検索の文字・市区・町名・チップ・足すチップ・終了の人も出すを足す', () => {
    const s: ClientFilterState = {
      ...EMPTY_FILTER,
      query: 'やま',
      cities: ['中央区', NO_AREA],
      towns: [townKey('中央区', '本町')],
      chips: ['period', 'leave'],
      extra: ['pending'],
      showEnded: true,
    };
    expect(activeFilterCount(s)).toBe(1 + 2 + 1 + 2 + 1 + 1);
    expect(activeFilterCount(WEEK_TABLE_FILTER)).toBe(1);
  });
});

describe('訪問の種類での絞り込み（PRD D285。複数ならどれか）', () => {
  const types = [
    { id: 't1', name: 'リハビリ' },
    { id: 't2', name: '入浴' },
    { id: 't3', name: '看護' },
  ];
  const F = facts({
    typeIds: new Set(['t1', 't2', 't3']),
    typeClientIds: new Map([
      ['t1', new Set(['a'])],
      ['t2', new Set(['a', 'c'])],
      ['t3', new Set<string>()],
    ]),
  });
  it('押した種類の訪問が期間にある人に絞る。複数はどれか（OR）。ほかの絞り込みとは AND', () => {
    expect(ids(filterClients(people, f({ types: ['t1'] }), F, ''))).toEqual(['a']);
    expect(ids(filterClients(people, f({ types: ['t1', 't2'] }), F, ''))).toEqual(['a', 'c']);
    expect(ids(filterClients(people, f({ types: ['t2'], chips: ['unassigned'] }), F, ''))).toEqual(['c']);
  });
  it('押していない・消えた種類だけ・facts に種類が無いときは絞らない', () => {
    expect(matchTypes(people[1], f(), F)).toBe(true);
    expect(matchTypes(people[1], f({ types: ['gone'] }), F)).toBe(true);
    expect(matchTypes(people[1], f({ types: ['t1'] }), facts())).toBe(true);
  });
  it('人数は種類のほかの絞り込みをかけた数（0人は押せない印）。押している種類でも人数は変わらない', () => {
    expect(typeChips(people, f(), F, '', types).map((x) => x.count)).toEqual([1, 2, 0]);
    expect(typeChips(people, f({ types: ['t1'] }), F, '', types).map((x) => x.count)).toEqual([1, 2, 0]);
    expect(typeChips(people, f({ chips: ['unassigned'] }), F, '', types).map((x) => x.count)).toEqual([0, 1, 0]);
  });
  it('付け外し（並びは種類の順）', () => {
    const on = toggleType(toggleType(f(), 't2', types), 't1', types);
    expect(on.types).toEqual(['t1', 't2']);
    expect(toggleType(on, 't1', types).types).toEqual(['t2']);
  });
  it('URL：type: に書いて戻る。無い古い URL は種類なし。数にも入る', () => {
    const s = f({ types: ['t1', 't2'], chips: ['period'] });
    expect(encodeFilter(s)).toBe('chip:period;type:t1,t2');
    expect(decodeFilter(encodeFilter(s), WEEK_TABLE_FILTER).types).toEqual(['t1', 't2']);
    expect(decodeFilter('chip:period', WEEK_TABLE_FILTER).types).toBeUndefined();
    expect(sameFilter(f({ types: [] }), EMPTY_FILTER)).toBe(true);
    expect(activeFilterCount(s)).toBe(3);
  });
  it('filterFacts：期間の（取り消しでない）訪問の種類から作る。visitTypes を渡さなければ作らない', () => {
    const data = makeData({
      clients: [client('c1', 0, 0), client('c2', 0, 0), client('c3', 0, 0)],
      visits: [
        visit('v1', 'c1', '09:00', '10:00', { typeId: 't1' }),
        visit('v2', 'c2', '09:00', '10:00', { typeId: 't2' }),
        visit('v3', 'c3', '09:00', '10:00', { typeId: 't1', cancelled: true }),
      ],
    });
    const days = weekDates(DATE).map((d) => weekDay(data, d));
    const input = { days, visits: data.visits, clients: data.clients, patterns: [], clientLeaves: [], staff: [] };
    const fx = filterFacts({ ...input, visitTypes: [{ id: 't1' }, { id: 't2' }] });
    expect([...(fx.typeClientIds?.get('t1') ?? [])]).toEqual(['c1']);
    expect([...(fx.typeClientIds?.get('t2') ?? [])]).toEqual(['c2']);
    expect(filterFacts(input).typeClientIds).toBeUndefined();
  });
});
