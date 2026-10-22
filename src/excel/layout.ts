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
  /** 拘束の上限（ADR-0015）。古いブックには無いので必須の行にしない（無ければ 10） */
  spanLimit: '拘束の上限（時間）',
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
/** 〈スタッフ〉の「最終勤務日」（PRD D71。ADR-0015）。書き出しは固定の列の最後。古いブックには無いので必須にしない（無ければなし） */
export const STAFF_LAST_DAY_COL = '最終勤務日';
/** 〈スタッフ〉の「メールアドレス」（PRD D91。ADR-0017）。書き出しは「最終勤務日」の次。古いブックには無いので必須にしない（無ければ空） */
export const STAFF_EMAIL_COL = 'メールアドレス';
/** 〈スタッフ〉の「アイコン」（PRD D299。ADR-0050）。書き出しは「メールアドレス」の次。古いブックには無いので必須にしない（無ければ未設定） */
export const STAFF_ICON_COL = 'アイコン';
export const CLIENT_COLS = {
  id: 'ID',
  name: '表示名',
  color: '色（1〜8）',
  active: '利用中',
  address: '住所',
  lat: '緯度',
  lng: '経度',
  note: 'メモ',
} as const;
/**
 * 〈利用者さん〉の「仮押さえ」（○。ADR-0012 追記。段階3）。書き出しは「利用中」の次に置く。
 * 古いブックには無いので必須の列にしない（無ければ false）
 */
export const CLIENT_TENTATIVE_COL = '仮押さえ';
/**
 * 〈利用者さん〉の「よみ」（ひらがな。PRD D61）。書き出しは「表示名」の次に置く。
 * 古いブックには無いので必須の列にしない（無ければ空）
 */
export const CLIENT_KANA_COL = 'よみ';
/**
 * 〈利用者さん〉の訪問先の決まりごと（PRD D66。ADR-0013）。書き出しは「メモ」の次に置く。
 * 古いブックには無いので必須の列にしない（無ければ空）
 */
export const CLIENT_RULE_COLS = { entry: '入り方', key: '鍵', parking: '駐車場', caution: '注意' } as const;
/**
 * 〈利用者さん〉の「担当できる人」（PRD D68。ADR-0014）：〈スタッフ〉の名前を「、」か改行で区切る。空＝限らない。
 * 書き出しは「経度」の次に置く。必須の列にしない（無ければ限らない）
 */
export const CLIENT_ALLOWED_COL = '担当できる人';
/**
 * 〈利用者さん〉の「郵便番号」（PRD D86。ADR-0016）：7桁の数字（ハイフンなし。読むときはハイフン・全角も受ける）。
 * 書き出しは「住所」の前に置き、先頭の0が消えないよう文字列の列にする。古いブックには無いので必須の列にしない（無ければ空）
 */
export const CLIENT_POSTAL_COL = '郵便番号';
/**
 * 〈利用者さん〉の段階と紹介元（PRD D73。ADR-0015）。書き出しは固定の列の最後。古いブックには無いので必須の列にしない
 * （段階が無い・空なら「利用中」「仮押さえ」の列から読み替える。紹介元は空）
 */
export const CLIENT_STAGE_COLS = {
  stage: '段階',
  referrer: '紹介元',
  referrerContact: '紹介元の連絡先',
  referrerNote: '紹介元のメモ',
  /** 紹介元のメールアドレス（PRD D91。ADR-0017）。古いブックには無い（無ければ空） */
  referrerEmail: '紹介元のメールアドレス',
} as const;
/**
 * 書き出す〈利用者さん〉の固定の列（「表示名」の次に「よみ」、「利用中」の次に「仮押さえ」、「住所」の前に「郵便番号」、「経度」の次に
 * 「担当できる人」、「メモ」の次に決まりごと、最後に段階と紹介元）。版2：いつもの担当の列は無い（繰り返しのシートの担当。ADR-0053）
 */
export const clientExportCols = (): string[] => {
  const base: string[] = Object.values(CLIENT_COLS);
  const at = base.indexOf(CLIENT_COLS.active) + 1;
  const withTentative = [...base.slice(0, at), CLIENT_TENTATIVE_COL, ...base.slice(at)];
  const k = withTentative.indexOf(CLIENT_COLS.name) + 1;
  const withKanaOnly = [...withTentative.slice(0, k), CLIENT_KANA_COL, ...withTentative.slice(k)];
  const a = withKanaOnly.indexOf(CLIENT_COLS.address);
  const withKana = [...withKanaOnly.slice(0, a), CLIENT_POSTAL_COL, ...withKanaOnly.slice(a)];
  const u = withKana.indexOf(CLIENT_COLS.lng) + 1;
  const withAllowed = [...withKana.slice(0, u), CLIENT_ALLOWED_COL, ...withKana.slice(u)];
  const n = withAllowed.indexOf(CLIENT_COLS.note) + 1;
  return [
    ...withAllowed.slice(0, n),
    ...Object.values(CLIENT_RULE_COLS),
    ...withAllowed.slice(n),
    ...Object.values(CLIENT_STAGE_COLS),
  ];
};
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
  usualStaff: '担当',
  note: 'メモ',
});
/** 定期パターンの列のうち、ADR-0013 で足した任意の列（無い古いブックは毎週系・曜日ごとの時刻なし） */
export const PATTERN_EXTRA_COLS = { monthWeeks: '第N週', dayTimes: '曜日ごとの時刻' } as const;
/** 〈利用者さん〉の休み（ADR-0013）：開始日〜終了日（両端を含む）・理由 */
export const clientLeaveCols = (t: Terms) => ({
  id: 'ID',
  client: t.client,
  from: '開始日',
  to: '終了日',
  note: '理由',
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
/** 訪問の「当日キャンセル」（○。PRD D74。ADR-0015）。必須にしない（無ければふつうの取り消し） */
export const VISIT_SAME_DAY_COL = '当日キャンセル';
/** 訪問の「組んだ開始」（版2。ADR-0053）。担当の訪問の回る順。必須にしない（無ければ開始（早）で並べる） */
export const VISIT_START_COL = '組んだ開始';
/** 訪問の「ピン」（○。版2。ADR-0053）。AI で組み直しても担当を変えない。必須にしない（無ければピンなし） */
export const VISIT_PIN_COL = 'ピン';
/** 稼働の見込み（PRD D72。ADR-0015）のシート。書き出すだけで、読み込みでは見ない（予定から計算し直せるため） */
export const WORKLOAD_SHEET = '稼働の見込み';
export const WORKLOAD_COLS = [
  '日付',
  '名前',
  '確定',
  '訪問の件数',
  '最初の訪問の開始',
  '最後の訪問の終わり',
  '拘束（分）',
  '訪問（分）',
  '移動（分）',
  '待ち（分）',
  '自宅との行き帰り（分）',
  '距離（km）',
  '交通費（円）',
  '拘束の上限を超える',
] as const;
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
