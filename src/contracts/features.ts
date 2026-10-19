import { z } from 'zod';

/**
 * 機能の入り切り（PRD D210〜D216。ADR-0028。design.md §5「機能の入り切り」）。
 * 管理者設定で入・切する機能の ID（20）。表（名前・グループ・依存・URL・ひな形）は lib/features.ts の1か所
 */
export const FEATURE_IDS = [
  'patternMonthly',
  'clientLeave',
  'requestedOff',
  'monthPrint',
  'compare',
  'sudden',
  'vacancy',
  'vacancyNotice',
  'compat',
  'allowedStaff',
  'clientStage',
  'visitNotes',
  'offboard',
  'workload',
  'fare',
  'rules',
  'mail',
  'mapsLink',
  'geocode',
  'excel',
] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];

const KNOWN: ReadonlySet<string> = new Set(FEATURE_IDS);

/** 機能の ID か */
export const isFeatureId = (s: string): s is FeatureId => KNOWN.has(s);

/** 入り切り：機能の ID → 入（true）・切（false）の部分的な表。無い ID は入 */
export type Features = Partial<Record<FeatureId, boolean>>;

/** 入り切りとして読める値か（null・配列・文字列などのオブジェクトでない値は違う） */
const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 入り切りの形。知らない ID（新しい版で消した機能・手で書いた JSON）と、真偽でない値は捨てる（検査で落とさない。
 * 捨てた ID は入＝今までどおり）。features そのものが null・配列・オブジェクトでない値でも読み込み全体を落とさず {}
 * （すべて入）にする。repair ではなく読むときに zod で捨てる
 */
export const featuresSchema = z.preprocess(
  (raw) => (isPlainRecord(raw) ? raw : {}),
  z.record(z.string(), z.unknown()).transform((raw): Features => {
    const out: Features = {};
    for (const [k, v] of Object.entries(raw)) {
      if (isFeatureId(k) && typeof v === 'boolean') out[k] = v;
    }
    return out;
  }),
);

/** 計算（matching の compile）に効く機能：好み・社内の決まりだけ（相性・担当を限る。ADR-0028 の効き方の案B） */
export const CALC_FEATURE_IDS = ['compat', 'allowedStaff'] as const satisfies readonly FeatureId[];
export type CalcFeatureId = (typeof CALC_FEATURE_IDS)[number];
