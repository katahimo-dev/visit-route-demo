// ブックの見出し（書き出しと読み込みで同じ名前を使う。design.md §5「Excel のブックの形」）
import type { Terms } from '../contracts/documents';
import type { Item } from '../contracts/rules';

export const ORG_KEYS = {
  name: '事業所名',
  industry: '業種',
  staffTerm: '呼び方（訪問する人）',
  clientTerm: '呼び方（訪問先）',
  fare: '1kmあたりの運賃（円）',
  seed: '乱数の種',
} as const;
export const ORG_HEADERS = ['項目', '値'] as const;

export const ITEM_COLS = { id: 'ID', target: '対象', name: '名前', kind: '種類', options: '選択肢' } as const;
export const RULE_COLS = { id: 'ID', label: '名前', type: '種類', weight: '重み', hard: '必須' } as const;
/**
 * プリセット（ADR-0008）：ID・名前・一言・重み：〈条件の型の名前〉…・必須（必須にする型の名前を「、」区切り）・
 * 点数の基準（○ を1行だけ。ADR-0010。列が無い・無印なら先頭のプリセット）
 */
export const PRESET_COLS = { id: 'ID', name: '名前', note: '一言', hard: '必須', scoreBase: '点数の基準' } as const;
export const WEIGHT_PREFIX = '重み：';
export const presetWeightHeader = (typeLabel: string) => `${WEIGHT_PREFIX}${typeLabel}`;
export const STAFF_COLS = {
  id: 'ID',
  name: '名前',
  travelMode: '移動手段',
  workDays: '勤務する曜日',
  shiftStart: '勤務開始',
  shiftEnd: '勤務終了',
  active: '利用中',
  address: '住所',
  lat: '緯度',
  lng: '経度',
} as const;
export const CLIENT_COLS = {
  id: 'ID',
  name: '表示名',
  color: '色（1〜8）',
  active: '利用中',
  address: '住所',
  lat: '緯度',
  lng: '経度',
  usualStaff: 'いつもの担当',
  note: 'メモ',
} as const;
export const availabilityCols = (t: Terms) => ({ staff: t.staff, date: '日付', slots: '時間帯' });
/** 欠勤（ADR-0011）：開始の空＝始業から、終了の空＝終業まで、両方空＝終日 */
export const absenceCols = (t: Terms) => ({
  id: 'ID',
  staff: t.staff,
  date: '日付',
  from: '開始',
  to: '終了',
  note: 'メモ',
});
/** 訪問の種類（ADR-0012）：ID・名前・色（1〜8）・標準の所要（分）・〈必要条件：項目名〉…・メモ */
export const TYPE_COLS = {
  id: 'ID',
  name: '名前',
  color: '色（1〜8）',
  duration: '標準の所要（分）',
  note: 'メモ',
} as const;
/** 定期パターン（ADR-0012） */
export const patternCols = (t: Terms) => ({
  id: 'ID',
  client: t.client,
  type: '種類',
  weekdays: '曜日',
  every: '間隔',
  windowKind: '時間の決め方',
  earliest: '開始（早）',
  latest: '開始（遅）',
  duration: '所要（分）',
  from: '開始日',
  to: '終了日',
  usualStaff: 'いつもの担当',
  note: 'メモ',
});
/** 訪問の列のうち、種類（ADR-0012）。「種類」シートがあるブックだけで読む */
export const VISIT_TYPE_COL = '種類';
/** 訪問の列のうち、定期パターン（ADR-0012）。「定期パターン」シートがあるブックだけで読む */
export const VISIT_PATTERN_COLS = { pattern: '定期パターン', date: '元の日', edited: 'この回だけ変更' } as const;
export const visitCols = (t: Terms) => ({
  id: 'ID',
  date: '日付',
  client: t.client,
  type: VISIT_TYPE_COL,
  windowKind: '時間の決め方',
  earliest: '開始（早）',
  latest: '開始（遅）',
  duration: '所要（分）',
  staff: '担当',
  cancelled: '取り消し',
  pattern: VISIT_PATTERN_COLS.pattern,
  patternDate: VISIT_PATTERN_COLS.date,
  edited: VISIT_PATTERN_COLS.edited,
  note: 'メモ',
});
/** 訪問の列のうち、古いブック（ADR-0012 より前）にも必ずある列 */
export const visitBaseCols = (t: Terms) => {
  const { type: _t, pattern: _p, patternDate: _d, edited: _e, ...rest } = visitCols(t);
  return rest;
};

export const TRAIT_PREFIX = '特性：';
export const REQ_PREFIX = '必要条件：';
export const PREF_PREFIX = '希望：';

/** 特性・必要条件・希望の列（own＝自分の特性の項目、other＝相手の項目） */
export const traitHeader = (it: Item) => `${TRAIT_PREFIX}${it.name}`;
export const reqHeader = (it: Item) => `${REQ_PREFIX}${it.name}`;
export const prefHeader = (it: Item) => `${PREF_PREFIX}${it.name}`;
