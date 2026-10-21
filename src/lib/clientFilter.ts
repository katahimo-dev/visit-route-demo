// 〈利用者さん〉の絞り込み（PRD D108〜D112。ADR-0021）。週間の〈利用者さん〉×曜日の表と〈利用者さん〉の画面の一覧で使う。
// 名前・よみの検索・地区（市区→町名）・絞り込みのチップ（AND）・「終了の人も出す」。純粋関数（データは書き換えない）
import type { Client, ClientLeave, Pattern, Staff, Visit } from '../contracts/documents';
import { type Area, areaOf } from './area';
import { defaultStaffOf, matchClient, staffClientMap } from './search';
import type { WeekDay } from './week';

/**
 * 絞り込みのチップ（PRD D112）：
 * period＝この期間に訪問がある人、staff＝〈スタッフ〉が担当する人、unassigned＝担当が決まっていない訪問がある人、
 * noUsual＝いつもの担当がいない人、limited＝担当を限っている人、leave＝休みのある人、noPattern＝定期パターンの無い人
 */
export const FILTER_CHIPS = ['period', 'staff', 'unassigned', 'noUsual', 'limited', 'leave', 'noPattern'] as const;
export type FilterChip = (typeof FILTER_CHIPS)[number];

/** 住所の無い・地区を取り出せない人の市区（「住所なし」にまとめる） */
export const NO_AREA = '';
export const NO_AREA_LABEL = '住所なし';
/** 町名の無い人（住所が市区で終わる）の町名のチップ */
export const NO_TOWN_LABEL = '（町名なし）';

/** 絞り込みの状態（週間の表は URL の ?cf= に残す） */
export type ClientFilterState = {
  /** 名前・よみの検索の文字 */
  query: string;
  /** 選んだ市区（NO_AREA＝住所なし）。空なら地区で絞らない */
  cities: string[];
  /** 選んだ町名（townKey）。選んだ市区のうち、町名を選んでいない市区はその市区の全員 */
  towns: string[];
  /** 押しているチップ（FILTER_CHIPS の順） */
  chips: FilterChip[];
  /** チップ「〈スタッフ〉が担当する人」の〈スタッフ〉（null＝担当する人がいる最初の人） */
  staffId: string | null;
  /** 終了の人も出す（既定 false） */
  showEnded: boolean;
  /**
   * 押している訪問の種類（VisitType.id。PRD D263）。この期間にそのどれかの種類の訪問がある人に絞る（OR）。
   * 無い・空なら種類で絞らない。チップ「この期間に訪問がある人」などとは AND
   */
  types?: readonly string[];
  /**
   * 画面ごとに足すチップのうち押しているもの（PRD D116。相性の画面だけ。キーは呼ぶ側が決め、判定は FilterFacts の
   * extraTests）。無い・空なら足すチップで絞らない
   */
  extra?: readonly string[];
};

/** 何も絞らない状態（〈利用者さん〉の画面の既定） */
export const EMPTY_FILTER: ClientFilterState = {
  query: '',
  cities: [],
  towns: [],
  chips: [],
  staffId: null,
  showEnded: false,
};
/** 週間の〈利用者さん〉×曜日の表の既定：この週に訪問がある人 */
export const WEEK_TABLE_FILTER: ClientFilterState = { ...EMPTY_FILTER, chips: ['period'] };

/** 町名のキー（市区と町名を「|」でつなぐ。市区に「|」は入らない） */
export const townKey = (city: string, town: string): string => `${city}|${town}`;
const cityOfKey = (key: string): string => key.slice(0, key.indexOf('|'));

/** チップの判定に使う、期間とデータから作った集まり（filterFacts で作る） */
export type FilterFacts = {
  /** この期間に（取り消しでない）訪問がある〈利用者さん〉 */
  periodIds: ReadonlySet<string>;
  /** この期間に、担当が決まっていない（案が無い・入らない）訪問がある〈利用者さん〉（休みの訪問は数えない） */
  unassignedIds: ReadonlySet<string>;
  /** この期間に休み（clientLeaves）がかかる〈利用者さん〉 */
  leaveIds: ReadonlySet<string>;
  /** 定期パターンがある〈利用者さん〉 */
  patternClientIds: ReadonlySet<string>;
  /** 〈スタッフ〉が担当する〈利用者さん〉（期間の帯の担当と、いつもの担当） */
  staffClientIds: (staffId: string) => ReadonlySet<string>;
  /** いつもの担当として期間の終わりまで働ける〈スタッフ〉（利用中で、最終勤務日が無いか期間の終わり以降） */
  workingStaffIds: ReadonlySet<string>;
  /**
   * 終了でも「終了の人も出す」を入れずに出す〈利用者さん〉。週間の表では、この週に（取り消しでない）訪問がある人
   * （その訪問を表でドラッグできるように。PRD D111）。〈利用者さん〉の画面は空
   */
  endedShownIds: ReadonlySet<string>;
  /** 訪問の種類（VisitType.id）→ この期間にその種類の（取り消しでない）訪問がある〈利用者さん〉。無ければ種類で絞らない */
  typeClientIds?: ReadonlyMap<string, ReadonlySet<string>>;
  /** 今ある訪問の種類の id（state.types のうち、消えた種類の id は無いものとして扱う）。無ければ種類で絞らない */
  typeIds?: ReadonlySet<string>;
  /** 画面ごとに足すチップの判定（PRD D116。キー → 当てはまるか）。判定の無いキーは絞らない */
  extraTests?: Readonly<Record<string, (c: FilterClient) => boolean>>;
};

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

/**
 * 期間（days。週間の weekDay の結果。from〜to はその最初と最後の日）とデータから FilterFacts を作る。
 * 担当が決まっていない訪問は、weekDay の帯で担当が null（案が無い日の訪問・案で入らない訪問）のもの（休みの帯は除く）
 */
export function filterFacts(input: {
  days: readonly WeekDay[];
  visits: readonly Visit[];
  clients: readonly Pick<Client, 'id' | 'usualStaffId'>[];
  patterns: readonly Pick<Pattern, 'clientId'>[];
  clientLeaves: readonly ClientLeave[];
  staff: readonly Pick<Staff, 'id' | 'active' | 'lastDay'>[];
  /** この期間に訪問がある人は終了でも出す（週間の表） */
  showEndedInPeriod?: boolean;
  /** 訪問の種類（data.visitTypes）。渡すと「訪問の種類」のチップで絞れる */
  visitTypes?: readonly { id: string }[];
}): FilterFacts {
  const { days, visits, clients, patterns, clientLeaves, staff, showEndedInPeriod = false, visitTypes } = input;
  const from = days[0]?.date ?? '';
  const to = days.at(-1)?.date ?? '';
  const visitById = new Map(visits.map((v) => [v.id, v]));
  const periodIds = new Set<string>();
  const unassignedIds = new Set<string>();
  const pairs: [string, string | undefined][] = [];
  const typeClientIds = new Map<string, Set<string>>((visitTypes ?? []).map((t) => [t.id, new Set<string>()]));
  for (const d of days)
    for (const b of d.bands) {
      const v = visitById.get(b.visitId);
      const cid = v?.clientId;
      if (!cid) continue;
      periodIds.add(cid);
      if (v.typeId) typeClientIds.get(v.typeId)?.add(cid);
      if (b.staffId === null && !b.leave) unassignedIds.add(cid);
      if (b.staffId) pairs.push([b.staffId, cid]);
    }
  const leaveIds = new Set(
    days.length === 0 ? [] : clientLeaves.filter((l) => l.from <= to && l.to >= from).map((l) => l.clientId),
  );
  const byStaff = staffClientMap(pairs, clients);
  return {
    periodIds,
    unassignedIds,
    leaveIds,
    patternClientIds: new Set(patterns.map((p) => p.clientId)),
    staffClientIds: (id) => byStaff.get(id) ?? EMPTY_SET,
    workingStaffIds: new Set(staff.filter((s) => s.active && (s.lastDay === null || s.lastDay >= to)).map((s) => s.id)),
    endedShownIds: showEndedInPeriod ? periodIds : EMPTY_SET,
    ...(visitTypes ? { typeClientIds, typeIds: new Set(visitTypes.map((t) => t.id)) } : {}),
  };
}

export type FilterClient = Pick<
  Client,
  'id' | 'displayName' | 'kana' | 'stage' | 'usualStaffId' | 'allowedStaffIds'
> & {
  place: Pick<Client['place'], 'address'>;
};

/** その人がチップに当てはまるか（staffId はチップ「〈スタッフ〉が担当する人」の〈スタッフ〉） */
export function chipMatches(chip: FilterChip, c: FilterClient, facts: FilterFacts, staffId: string): boolean {
  switch (chip) {
    case 'period':
      return facts.periodIds.has(c.id);
    case 'staff':
      return staffId !== '' && facts.staffClientIds(staffId).has(c.id);
    case 'unassigned':
      return facts.unassignedIds.has(c.id);
    case 'noUsual':
      return !c.usualStaffId || !facts.workingStaffIds.has(c.usualStaffId);
    case 'limited':
      return c.allowedStaffIds.length > 0;
    case 'leave':
      return facts.leaveIds.has(c.id);
    case 'noPattern':
      return c.stage === 'active' && !facts.patternClientIds.has(c.id);
  }
}

/** 地区（取り出せなければ市区 NO_AREA・町名 ''） */
export function clientArea(c: FilterClient): Area {
  return areaOf(c.place.address) ?? { city: NO_AREA, town: '' };
}

/** 地区で当てはまるか：市区を選んでいなければ全員。市区の中で町名を選んでいれば、その町名の人だけ */
export function matchArea(c: FilterClient, state: Pick<ClientFilterState, 'cities' | 'towns'>): boolean {
  if (state.cities.length === 0) return true;
  const a = clientArea(c);
  if (!state.cities.includes(a.city)) return false;
  const towns = state.towns.filter((k) => cityOfKey(k) === a.city);
  return towns.length === 0 || towns.includes(townKey(a.city, a.town));
}

/** 地区・チップを除いた絞り込み（終了の人・名前・よみ） */
/** 終了の扱いで出す人か（終了でない・「終了の人も出す」・facts.endedShownIds にいる） */
export const endedVisible = (
  c: Pick<Client, 'id' | 'stage'>,
  state: Pick<ClientFilterState, 'showEnded'>,
  facts: Pick<FilterFacts, 'endedShownIds'>,
): boolean => state.showEnded || c.stage !== 'ended' || facts.endedShownIds.has(c.id);

/** 画面ごとに足すチップ（押しているものすべて）に当てはまるか */
const extraMatch = (c: FilterClient, state: ClientFilterState, facts: FilterFacts) =>
  (state.extra ?? []).every((k) => facts.extraTests?.[k]?.(c) ?? true);

/** 押している種類のどれかの訪問がこの期間にある人か（種類を押していない・facts に種類が無ければ全員） */
export function matchTypes(
  c: Pick<FilterClient, 'id'>,
  state: Pick<ClientFilterState, 'types'>,
  facts: FilterFacts,
): boolean {
  const on = (state.types ?? []).filter((id) => facts.typeIds?.has(id));
  if (on.length === 0) return true;
  return on.some((id) => facts.typeClientIds?.get(id)?.has(c.id));
}

const baseMatch = (c: FilterClient, state: ClientFilterState, facts: FilterFacts) =>
  endedVisible(c, state, facts) && matchClient(c, state.query) && extraMatch(c, state, facts);

/**
 * 絞り込む（AND）：終了の人（showEnded でなければ除く。facts.endedShownIds の人は出す）・名前・よみ・地区・押しているチップすべて。渡した順のまま。
 * staffId はチップ「〈スタッフ〉が担当する人」の〈スタッフ〉（resolveStaffId で決める）
 */
export function filterClients<T extends FilterClient>(
  clients: readonly T[],
  state: ClientFilterState,
  facts: FilterFacts,
  staffId: string,
): T[] {
  return clients.filter(
    (c) =>
      baseMatch(c, state, facts) &&
      matchArea(c, state) &&
      matchTypes(c, state, facts) &&
      state.chips.every((ch) => chipMatches(ch, c, facts, staffId)),
  );
}

/**
 * チップごとの人数：押していないチップは「押したら何人になるか」、押しているチップは今の人数（0人なら押せない・0人と分かる）
 */
export function chipCounts(
  clients: readonly FilterClient[],
  state: ClientFilterState,
  facts: FilterFacts,
  staffId: string,
): Record<FilterChip, number> {
  const out = {} as Record<FilterChip, number>;
  for (const chip of FILTER_CHIPS) {
    const chips = state.chips.includes(chip) ? state.chips : [...state.chips, chip];
    out[chip] = filterClients(clients, { ...state, chips }, facts, staffId).length;
  }
  return out;
}

/** 画面ごとに足すチップの人数（chipCounts と同じ数え方。keys の順に） */
export function extraCounts(
  clients: readonly FilterClient[],
  state: ClientFilterState,
  facts: FilterFacts,
  staffId: string,
  keys: readonly string[],
): Map<string, number> {
  return new Map(
    keys.map((k) => {
      const extra = state.extra ?? [];
      const next = extra.includes(k) ? extra : [...extra, k];
      return [k, filterClients(clients, { ...state, extra: next }, facts, staffId).length];
    }),
  );
}

/** 画面ごとに足すチップを付け外しする */
export function toggleExtra(state: ClientFilterState, key: string): ClientFilterState {
  const extra = state.extra ?? [];
  return { ...state, extra: extra.includes(key) ? extra.filter((k) => k !== key) : [...extra, key] };
}

/** 地区のチップ1つ（key は市区か townKey、label は画面の文字、count は地区のほかの絞り込みをかけた人数） */
export type AreaChip = { key: string; label: string; count: number };

/** 地区を除いた絞り込み（チップ・名前・よみ・終了）に当てはまる人 */
const withoutArea = <T extends FilterClient>(
  clients: readonly T[],
  state: ClientFilterState,
  facts: FilterFacts,
  staffId: string,
) => filterClients(clients, { ...state, cities: [], towns: [] }, facts, staffId);

/**
 * 1段目の市区のチップ：候補（終了の人は showEnded のときだけ）にいる市区を名前の順に、「住所なし」は最後に。
 * 人数は地区のほかの絞り込みをかけた数
 */
export function cityChips(
  clients: readonly FilterClient[],
  state: ClientFilterState,
  facts: FilterFacts,
  staffId: string,
): AreaChip[] {
  const all = new Set(clients.filter((c) => endedVisible(c, state, facts)).map((c) => clientArea(c).city));
  for (const c of state.cities) all.add(c);
  const counts = new Map<string, number>();
  for (const c of withoutArea(clients, state, facts, staffId)) {
    const city = clientArea(c).city;
    counts.set(city, (counts.get(city) ?? 0) + 1);
  }
  return [...all]
    .sort((a, b) => (a === NO_AREA ? 1 : b === NO_AREA ? -1 : a.localeCompare(b, 'ja')))
    .map((city) => ({ key: city, label: city === NO_AREA ? NO_AREA_LABEL : city, count: counts.get(city) ?? 0 }));
}

/** 2段目の町名のチップ（選んだ市区の中の町名。住所なしには出さない）。並びと人数は cityChips と同じ決め方 */
export function townChips(
  clients: readonly FilterClient[],
  state: ClientFilterState,
  facts: FilterFacts,
  staffId: string,
  city: string,
): AreaChip[] {
  if (city === NO_AREA) return [];
  const towns = new Set<string>();
  for (const c of clients) {
    if (!endedVisible(c, state, facts)) continue;
    const a = clientArea(c);
    if (a.city === city) towns.add(a.town);
  }
  for (const k of state.towns) if (cityOfKey(k) === city) towns.add(k.slice(city.length + 1));
  const counts = new Map<string, number>();
  for (const c of withoutArea(clients, state, facts, staffId)) {
    const a = clientArea(c);
    if (a.city === city) counts.set(a.town, (counts.get(a.town) ?? 0) + 1);
  }
  return [...towns]
    .sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'ja')))
    .map((t) => ({ key: townKey(city, t), label: t === '' ? NO_TOWN_LABEL : t, count: counts.get(t) ?? 0 }));
}

/** 訪問の種類のチップ1つ（count は種類のほかの絞り込みをかけた、その種類の訪問がある人数） */
export type TypeChip = { id: string; name: string; count: number };

/**
 * 訪問の種類のチップ（visitTypes の順）。人数は種類を除いたほかの絞り込みをかけた、その種類の訪問がこの期間にある人。
 * 押しているものは state.types のまま（消えた種類は含めない）
 */
export function typeChips(
  clients: readonly FilterClient[],
  state: ClientFilterState,
  facts: FilterFacts,
  staffId: string,
  visitTypes: readonly { id: string; name: string }[],
): TypeChip[] {
  const base = filterClients(clients, { ...state, types: [] }, facts, staffId);
  return visitTypes.map((t) => ({
    id: t.id,
    name: t.name,
    count: base.filter((c) => facts.typeClientIds?.get(t.id)?.has(c.id)).length,
  }));
}

/** 訪問の種類を付け外しする（並びは visitTypes の順にそろえる） */
export function toggleType(
  state: ClientFilterState,
  id: string,
  visitTypes: readonly { id: string }[],
): ClientFilterState {
  const cur = state.types ?? [];
  const on = cur.includes(id);
  const next = visitTypes.map((t) => t.id).filter((x) => (x === id ? !on : cur.includes(x)));
  return { ...state, types: next };
}

/** 市区を付け外しする（外すとその市区の町名の選択も外す） */
export function toggleCity(state: ClientFilterState, city: string): ClientFilterState {
  if (state.cities.includes(city))
    return {
      ...state,
      cities: state.cities.filter((c) => c !== city),
      towns: state.towns.filter((k) => cityOfKey(k) !== city),
    };
  return { ...state, cities: [...state.cities, city] };
}

/** 町名を付け外しする */
export function toggleTown(state: ClientFilterState, key: string): ClientFilterState {
  return {
    ...state,
    towns: state.towns.includes(key) ? state.towns.filter((k) => k !== key) : [...state.towns, key],
  };
}

/** チップを付け外しする（並びは FILTER_CHIPS の順にそろえる） */
export function toggleChip(state: ClientFilterState, chip: FilterChip): ClientFilterState {
  const on = state.chips.includes(chip);
  return { ...state, chips: FILTER_CHIPS.filter((c) => (c === chip ? !on : state.chips.includes(c))) };
}

/**
 * 〈スタッフ〉ごとの「チップ『〈スタッフ〉が担当する人』をその人で押したら何人になるか」（今の絞り込み＝終了の扱い・
 * 名前・よみ・地区・ほかのチップをかけた数。select の「（N人）」と、最初に選んでおく人に使う）
 */
export function staffCounts(
  clients: readonly FilterClient[],
  state: ClientFilterState,
  facts: FilterFacts,
  staff: readonly { id: string }[],
): Map<string, number> {
  const chips = state.chips.includes('staff') ? state.chips : toggleChip(state, 'staff').chips;
  return new Map(staff.map((s) => [s.id, filterClients(clients, { ...state, chips }, facts, s.id).length]));
}

/**
 * チップ「〈スタッフ〉が担当する人」の〈スタッフ〉：選んだ人が staff にいればその人、いなければ今の絞り込みで
 * 担当する人が1人以上いる最初の人（staffCounts・defaultStaffOf。だれも0人なら先頭、〈スタッフ〉がいなければ ''）
 */
export function resolveStaffId(
  state: ClientFilterState,
  staff: readonly { id: string }[],
  facts: FilterFacts,
  clients: readonly FilterClient[],
): string {
  if (state.staffId !== null && staff.some((s) => s.id === state.staffId)) return state.staffId;
  const counts = staffCounts(clients, state, facts, staff);
  return defaultStaffOf(staff, (id) => counts.get(id) ?? 0);
}

// ---- URL（?cf=）----

const enc = (xs: readonly string[]) => xs.map(encodeURIComponent).join(',');
const dec = (raw: string) =>
  raw === ''
    ? []
    : raw.split(',').flatMap((x) => {
        try {
          return [decodeURIComponent(x)];
        } catch {
          return [];
        }
      });

/**
 * 状態を URL の値にする（例 `chip:period,staff;staff:s1;city:%E4%BB%99...`）。chip はいつも書く（無ければ `chip:`）。
 * ほかは値があるときだけ
 */
export function encodeFilter(state: ClientFilterState): string {
  const parts: string[] = [];
  if (state.query !== '') parts.push(`q:${encodeURIComponent(state.query)}`);
  if (state.cities.length > 0) parts.push(`city:${enc(state.cities)}`);
  if (state.towns.length > 0) parts.push(`town:${enc(state.towns)}`);
  parts.push(`chip:${FILTER_CHIPS.filter((c) => state.chips.includes(c)).join(',')}`);
  // 〈スタッフ〉はチップ「〈スタッフ〉が担当する人」を押しているときだけ書く
  if (state.staffId && state.chips.includes('staff')) parts.push(`staff:${encodeURIComponent(state.staffId)}`);
  if (state.showEnded) parts.push('ended:1');
  // 訪問の種類は押しているときだけ
  if (state.types && state.types.length > 0) parts.push(`type:${enc(state.types)}`);
  // 画面ごとに足すチップは押しているときだけ（並びはそろえる）
  if (state.extra && state.extra.length > 0) parts.push(`x:${enc([...state.extra].sort())}`);
  return parts.join(';');
}

/**
 * URL の値を状態にする。null（URL に無い）なら fallback。知らない項目・チップは捨てる。
 * extraKeys は画面ごとに足すチップのキー（それ以外の `x:` の値は捨てる）
 */
export function decodeFilter(
  raw: string | null,
  fallback: ClientFilterState,
  extraKeys: readonly string[] = [],
): ClientFilterState {
  if (raw === null) return fallback;
  const out: ClientFilterState = { ...EMPTY_FILTER, chips: [...fallback.chips] };
  let chipSeen = false;
  for (const part of raw.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const key = part.slice(0, i);
    const value = part.slice(i + 1);
    if (key === 'q') out.query = dec(value)[0] ?? '';
    else if (key === 'city') out.cities = dec(value);
    else if (key === 'town') out.towns = dec(value).filter((k) => k.includes('|'));
    else if (key === 'chip') {
      chipSeen = true;
      const xs = value.split(',');
      out.chips = FILTER_CHIPS.filter((c) => xs.includes(c));
    } else if (key === 'staff') out.staffId = dec(value)[0] || null;
    else if (key === 'ended') out.showEnded = value === '1';
    else if (key === 'type') {
      const ts = dec(value);
      if (ts.length > 0) out.types = ts;
    } else if (key === 'x') {
      const xs = dec(value);
      const extra = extraKeys.filter((k) => xs.includes(k));
      if (extra.length > 0) out.extra = extra;
    }
  }
  if (!chipSeen) out.chips = [...fallback.chips];
  // 選んでいない市区の町名は捨てる
  out.towns = out.towns.filter((k) => out.cities.includes(cityOfKey(k)));
  return out;
}

/** 同じ絞り込みか（URL に書く形で比べる） */
export const sameFilter = (a: ClientFilterState, b: ClientFilterState): boolean => encodeFilter(a) === encodeFilter(b);

/**
 * 効いている絞り込みの数（PRD D220。狭い画面で畳んだ「絞り込み（N）」の N）：検索の文字（あれば1）・選んだ市区・町名・
 * 押しているチップ・足すチップ・「終了の人も出す」（入なら1）を足す
 */
export function activeFilterCount(state: ClientFilterState): number {
  return (
    (state.query.trim() !== '' ? 1 : 0) +
    state.cities.length +
    state.towns.length +
    state.chips.length +
    (state.types?.length ?? 0) +
    (state.extra?.length ?? 0) +
    (state.showEnded ? 1 : 0)
  );
}

// ---- 画面の文字 ----

/** チップの文字（periodLabel は「この週」など、staffTerm は呼び方 org.terms.staff） */
export function chipLabel(chip: FilterChip, t: { periodLabel: string; staffTerm: string }): string {
  switch (chip) {
    case 'period':
      return `${t.periodLabel}に訪問がある人`;
    case 'staff':
      return `${t.staffTerm}が担当する人`;
    case 'unassigned':
      return '担当が決まっていない訪問がある人';
    case 'noUsual':
      return 'いつもの担当がいない人';
    case 'limited':
      return '担当を限っている人';
    case 'leave':
      return '休みのある人';
    case 'noPattern':
      return '定期パターンの無い人';
  }
}

/** チップの説明（title） */
export function chipHelp(chip: FilterChip, t: { periodLabel: string; staffTerm: string }): string {
  switch (chip) {
    case 'period':
      return `${t.periodLabel}に（取り消しでない）訪問がある人`;
    case 'staff':
      return `${t.periodLabel}の案で担当する人と、いつもの担当がその${t.staffTerm}の人`;
    case 'unassigned':
      return `${t.periodLabel}に、案が無い日の訪問か、案に入らない訪問がある人`;
    case 'noUsual':
      return `いつもの担当が空か、休止中・${t.periodLabel}の終わりより前に最終勤務日がある${t.staffTerm}の人`;
    case 'limited':
      return '担当できる人を限っている人';
    case 'leave':
      return `${t.periodLabel}に休み（入院など）がかかる人`;
    case 'noPattern':
      return '利用中なのに定期パターンが無い人';
  }
}
