// 相性の画面（PRD D113〜D117。ADR-0022）の純粋関数：列の見出しの名前の2行、〈スタッフ〉の列の絞り込み（名前の検索・
// 特性のチップ AND・人数・URL の ?sf=）、行の絞り込みに足す相性のチップ、吹き出しに出す件数。データは書き換えない
import type { Client, Staff } from '../contracts/documents';
import type { Compat, Item, TraitValue } from '../contracts/rules';
import type { ClientFilterState } from './clientFilter';
import { normalizeKana } from './search';

// ---- 列の見出しの名前 ----

/** 空白が無い名前を折り返す文字数 */
export const NAME_CHUNK = 4;

/**
 * 列の見出しに出す名前の行（PRD D113）：最初の空白（全角も）で名字と名の2行に分ける（名にさらに空白があれば
 * 名の行に残す）。空白が無ければ4文字ごとに折り返す。文字は切らない（全部出す）
 */
export function nameLines(name: string): string[] {
  const t = name.trim();
  if (t === '') return [];
  const m = /^(\S+)\s+(.+)$/u.exec(t);
  if (m?.[1] && m[2]) return [m[1], m[2].replace(/\s+/gu, ' ')];
  const chars = Array.from(t);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += NAME_CHUNK) out.push(chars.slice(i, i + NAME_CHUNK).join(''));
  return out;
}

// ---- 〈スタッフ〉の列の絞り込み（?sf=）----

/** 〈スタッフ〉の特性のチップ1つ（項目の選択肢か、あり／なし） */
export type StaffChipDef = {
  /** URL に書くキー（項目の ID と値を encodeURIComponent して「=」でつなぐ） */
  key: string;
  itemId: string;
  /** 画面の文字（例「資格：看護師」「喫煙者：なし」） */
  label: string;
  /** choice・multi は選択肢、flag は true（あり）・false（なし） */
  value: string | boolean;
};

export const staffChipKey = (itemId: string, value: string | boolean): string =>
  `${encodeURIComponent(itemId)}=${encodeURIComponent(String(value))}`;

/**
 * 〈スタッフ〉の特性のチップ（PRD D116）：〈スタッフ〉の項目のうち、choice・multi は選択肢ごと、flag は「あり」「なし」。
 * 数値の項目は段階を作らないので出さない。並びは項目の順・選択肢の順
 */
export function staffChipDefs(items: readonly Item[]): StaffChipDef[] {
  return items
    .filter((it) => it.target === 'staff')
    .flatMap((it): StaffChipDef[] => {
      if (it.kind === 'choice' || it.kind === 'multi')
        return it.options.map((o) => ({
          key: staffChipKey(it.id, o),
          itemId: it.id,
          label: `${it.name}：${o}`,
          value: o,
        }));
      if (it.kind === 'flag')
        return [true, false].map((v) => ({
          key: staffChipKey(it.id, v),
          itemId: it.id,
          label: `${it.name}：${v ? 'あり' : 'なし'}`,
          value: v,
        }));
      return [];
    });
}

/** その〈スタッフ〉がチップに当てはまるか（未入力は「あり」「なし」のどちらにも当てはまらない） */
export function staffChipMatches(def: StaffChipDef, s: Pick<Staff, 'traits'>): boolean {
  const v = s.traits[def.itemId];
  if (v === undefined || v === null) return false;
  if (Array.isArray(v)) return typeof def.value === 'string' && v.includes(def.value);
  return v === def.value;
}

/** 〈スタッフ〉の列の絞り込みの状態（URL の ?sf=） */
export type StaffFilterState = {
  /** 名前の検索の文字 */
  query: string;
  /** 押している特性のチップ（StaffChipDef の key） */
  chips: string[];
};
export const EMPTY_STAFF_FILTER: StaffFilterState = { query: '', chips: [] };

/** 名前に query が含まれるか（ひらがな・カタカナ・全角半角・空白の違いを問わない。query が空なら true） */
export function matchStaffName(s: Pick<Staff, 'name'>, query: string): boolean {
  const q = normalizeKana(query);
  return q === '' || normalizeKana(s.name).includes(q);
}

/** 絞り込む（AND）：名前・押しているチップすべて（知らないチップは絞らない）。渡した順のまま */
export function filterStaff<T extends Pick<Staff, 'name' | 'traits'>>(
  staff: readonly T[],
  state: StaffFilterState,
  defs: readonly StaffChipDef[],
): T[] {
  const on = defs.filter((d) => state.chips.includes(d.key));
  return staff.filter((s) => matchStaffName(s, state.query) && on.every((d) => staffChipMatches(d, s)));
}

/** チップごとの人数：押していないチップは「押したら何人になるか」、押しているチップは今の人数 */
export function staffChipCounts(
  staff: readonly Pick<Staff, 'name' | 'traits'>[],
  state: StaffFilterState,
  defs: readonly StaffChipDef[],
): Map<string, number> {
  return new Map(
    defs.map((d) => {
      const chips = state.chips.includes(d.key) ? state.chips : [...state.chips, d.key];
      return [d.key, filterStaff(staff, { ...state, chips }, defs).length];
    }),
  );
}

/** チップを付け外しする（並びは defs の順にそろえる。defs に無いキーは外す） */
export function toggleStaffChip(state: StaffFilterState, key: string, defs: readonly StaffChipDef[]): StaffFilterState {
  const on = state.chips.includes(key);
  return { ...state, chips: defs.map((d) => d.key).filter((k) => (k === key ? !on : state.chips.includes(k))) };
}

/** 状態を URL の値にする（例 `q:%E5%B8%82;chip:i-gender=%E5%A5%B3%E6%80%A7`）。値があるものだけ */
export function encodeStaffFilter(state: StaffFilterState): string {
  const parts: string[] = [];
  if (state.query !== '') parts.push(`q:${encodeURIComponent(state.query)}`);
  if (state.chips.length > 0) parts.push(`chip:${state.chips.join(',')}`);
  return parts.join(';');
}

/** URL の値を状態にする。null（URL に無い）なら空。defs に無いチップ・知らない項目は捨てる */
export function decodeStaffFilter(raw: string | null, defs: readonly StaffChipDef[]): StaffFilterState {
  if (raw === null) return EMPTY_STAFF_FILTER;
  const out: StaffFilterState = { query: '', chips: [] };
  for (const part of raw.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const key = part.slice(0, i);
    const value = part.slice(i + 1);
    if (key === 'q') {
      try {
        out.query = decodeURIComponent(value);
      } catch {
        out.query = '';
      }
    } else if (key === 'chip') {
      const xs = value.split(',');
      out.chips = defs.map((d) => d.key).filter((k) => xs.includes(k));
    }
  }
  return out;
}

export const sameStaffFilter = (a: StaffFilterState, b: StaffFilterState): boolean =>
  encodeStaffFilter(a) === encodeStaffFilter(b);

// ---- 行の絞り込みに足す相性のチップ ----

/** 相性のチップ（PRD D116）：pending＝まだ相性が入っていない組がある人、ng＝× がある人 */
export const COMPAT_CHIPS = ['pending', 'ng'] as const;
export type CompatChip = (typeof COMPAT_CHIPS)[number];

/** チップの文字と説明 */
export function compatChipText(chip: CompatChip, staffTerm: string): { label: string; help: string } {
  return chip === 'pending'
    ? {
        label: 'まだ相性が入っていない組がある人',
        help: `いま見えている${staffTerm}の列のうち、相性が空の組が1つ以上ある人`,
      }
    : { label: '× がある人', help: `休止中でない${staffTerm}との相性に × が1つ以上ある人` };
}

/**
 * 相性のチップに当てはまる人（PRD D116）。pending は visibleStaffIds（いま見えている列）との組に空があるか、
 * ng は activeStaffIds（休止中でない〈スタッフ〉）との組に × があるか。前もって集まりにしておく（表が大きくても速く引ける）
 */
export function compatChipSets(
  compat: Compat,
  clientIds: readonly string[],
  visibleStaffIds: readonly string[],
  activeStaffIds: readonly string[],
): Record<CompatChip, ReadonlySet<string>> {
  const pending = new Set<string>();
  const ng = new Set<string>();
  for (const cid of clientIds) {
    const r = Object.hasOwn(compat, cid) ? compat[cid] : undefined;
    const level = (sid: string) => (r && Object.hasOwn(r, sid) ? (r[sid] ?? 0) : 0);
    if (visibleStaffIds.some((sid) => level(sid) === 0)) pending.add(cid);
    if (activeStaffIds.some((sid) => level(sid) === -2)) ng.add(cid);
  }
  return { pending, ng };
}

/** 相性のチップの判定（lib/clientFilter の FilterFacts.extraTests に渡す） */
export function compatChipTests(
  sets: Record<CompatChip, ReadonlySet<string>>,
): Record<CompatChip, (c: Pick<Client, 'id'>) => boolean> {
  return { pending: (c) => sets.pending.has(c.id), ng: (c) => sets.ng.has(c.id) };
}

// ---- 吹き出しの中身 ----

/** 〈スタッフ〉1人の相性の件数（clientIds の〈利用者さん〉との組。◎・○・△・×） */
export function staffCompatCounts(
  compat: Compat,
  staffId: string,
  clientIds: readonly string[],
): { great: number; good: number; poor: number; ng: number } {
  const out = { great: 0, good: 0, poor: 0, ng: 0 };
  for (const cid of clientIds) {
    const r = Object.hasOwn(compat, cid) ? compat[cid] : undefined;
    const l = r && Object.hasOwn(r, staffId) ? r[staffId] : 0;
    if (l === 2) out.great++;
    else if (l === 1) out.good++;
    else if (l === -1) out.poor++;
    else if (l === -2) out.ng++;
  }
  return out;
}

/** 〈スタッフ〉の画面の相性のタブに名前を並べる〈利用者さん〉（PRD D198）：いつもの担当と、相性の記号ごと（◎・○・△・×）。並びは clients のまま */
export function staffClientGroups<C extends Pick<Client, 'id' | 'usualStaffId'>>(
  compat: Compat,
  staffId: string,
  clients: readonly C[],
): { usual: C[]; great: C[]; good: C[]; poor: C[]; ng: C[] } {
  const out = { usual: [] as C[], great: [] as C[], good: [] as C[], poor: [] as C[], ng: [] as C[] };
  for (const c of clients) {
    if (c.usualStaffId === staffId) out.usual.push(c);
    const r = Object.hasOwn(compat, c.id) ? compat[c.id] : undefined;
    const l = r && Object.hasOwn(r, staffId) ? r[staffId] : 0;
    if (l === 2) out.great.push(c);
    else if (l === 1) out.good.push(c);
    else if (l === -1) out.poor.push(c);
    else if (l === -2) out.ng.push(c);
  }
  return out;
}

/** 特性の値の文字（あり／なし・選択肢を「・」でつなぐ・数値。空なら「—」） */
export function traitText(v: TraitValue | undefined): string {
  if (v === undefined || v === null || v === '') return '—';
  if (v === true) return 'あり';
  if (v === false) return 'なし';
  if (Array.isArray(v)) return v.length === 0 ? '—' : v.join('・');
  return String(v);
}

/** 曜日の並び（月〜日） */
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0] as const;

/** 曜日ごとの稼働時間（月〜日。勤務日でなければ null）。時刻は HH:mm のまま */
export function weeklyHours(
  s: Pick<Staff, 'workDays' | 'shiftStart' | 'shiftEnd'>,
): { weekday: number; hours: { start: string; end: string } | null }[] {
  return MON_FIRST.map((d) => ({
    weekday: d,
    hours: s.workDays.includes(d) ? { start: s.shiftStart, end: s.shiftEnd } : null,
  }));
}

// ---- 畳んだ絞り込みの欄の要約 ----

/** 人数の文字（絞っていなければ「N人」、絞っていれば「N人／M人」） */
const countText = (shown: number, total: number) => (shown === total ? `${total}人` : `${shown}人／${total}人`);

/** 〈スタッフ〉の列の欄の要約（例「スタッフ 8人・絞り込みなし」「スタッフ 3人／8人・名前「市」・特性2」） */
export function staffFilterSummary(state: StaffFilterState, shown: number, total: number, staffTerm: string): string {
  const parts: string[] = [];
  if (state.query.trim() !== '') parts.push(`名前「${state.query.trim()}」`);
  if (state.chips.length > 0) parts.push(`特性${state.chips.length}`);
  return `${staffTerm} ${countText(shown, total)}・${parts.length > 0 ? parts.join('・') : '絞り込みなし'}`;
}

/** 〈利用者さん〉の行の欄の要約（例「利用者さん 2人／20人・地区1・チップ1」）。地区は選んだ市区と町名の数 */
export function clientFilterSummary(
  state: Pick<ClientFilterState, 'query' | 'cities' | 'towns' | 'chips' | 'types' | 'extra'>,
  shown: number,
  total: number,
  clientTerm: string,
): string {
  const parts: string[] = [];
  if (state.query.trim() !== '') parts.push(`名前「${state.query.trim()}」`);
  const area = state.cities.length + state.towns.length;
  if (area > 0) parts.push(`地区${area}`);
  const chips = state.chips.length + (state.types?.length ?? 0) + (state.extra?.length ?? 0);
  if (chips > 0) parts.push(`チップ${chips}`);
  return `${clientTerm} ${countText(shown, total)}・${parts.length > 0 ? parts.join('・') : '絞り込みなし'}`;
}
