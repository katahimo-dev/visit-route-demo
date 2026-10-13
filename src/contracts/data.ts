import { z } from 'zod';
import {
  availabilitySchema,
  clientSchema,
  dateSchema,
  manualRoutesSchema,
  orgSchema,
  staffSchema,
  visitSchema,
} from './documents';
import { compatSchema, itemSchema, presetSchema, ruleSchema } from './rules';

/** localStorage のキー（1つの JSON） */
export const STORAGE_KEY = 'vrdemo:data:v1';
export const DATA_VERSION = 1;

const routesSchema = z.record(z.string(), z.array(z.string()));

/**
 * 保存したAI案（作ったときの条件の重みも残し、前回との差・再現に使う）。ADR-0004：
 * routes・unassigned・score は手直し後の今の案（score は保存した時点の費用。画面では点数の基準の物差しで付け直す。ADR-0010）。
 * generated は AI が出したまま（「AI案に戻す」で routes に戻す）。pins は訪問ID → 担当ID（手直しで固定した訪問）。
 * 古い保存データ（generated・pins が無い）は、generated＝routes・unassigned・score の写し、pins＝{} で補う
 */
const aiPlanObject = z.object({
  date: dateSchema,
  createdAt: z.number(),
  seed: z.number().int(),
  iterations: z.number().int(),
  routes: routesSchema,
  unassigned: z.array(z.string()),
  score: z.number(),
  stopped: z.boolean(),
  rules: z.array(ruleSchema),
  generated: z.object({ routes: routesSchema, unassigned: z.array(z.string()), score: z.number() }),
  pins: z.record(z.string(), z.string()),
  /** 今の案の元になった記録（AiRun.id。ADR-0008）。古いデータ・記録に無い案は無し */
  runId: z.string().max(100).optional(),
});
export const aiPlanSchema = z.preprocess((raw) => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const o = raw as Record<string, unknown>;
  if (o.generated !== undefined && o.pins !== undefined) return raw;
  return {
    ...o,
    generated: o.generated ?? { routes: o.routes, unassigned: o.unassigned, score: o.score },
    pins: o.pins ?? {},
  };
}, aiPlanObject);
export type AiPlan = z.infer<typeof aiPlanSchema>;

/** その日の記録の上限（古いものから消す。localStorage の容量） */
export const MAX_RUNS_PER_DAY = 20;

/**
 * AI案の記録（ADR-0005）：AI案を作る・固定を残して組み直すたびに、作ったときの条件と結果を1件残す。
 * 比較の画面で任意の2つを選んで比べる。label はプリセットと一致すればプリセット名、違えば「条件を変えた案」。
 * presetId は一致したプリセット（無ければ null）。pins は組み直しで残した固定（作ったときは {}）
 */
export const aiRunSchema = z.object({
  id: z.string().min(1).max(100),
  /** その日の通し番号（1から） */
  no: z.number().int().min(1),
  date: dateSchema,
  createdAt: z.number(),
  label: z.string().min(1).max(60),
  presetId: z.string().nullable(),
  seed: z.number().int(),
  iterations: z.number().int(),
  rules: z.array(ruleSchema),
  pins: z.record(z.string(), z.string()),
  routes: routesSchema,
  unassigned: z.array(z.string()),
  score: z.number(),
  stopped: z.boolean(),
});
export type AiRun = z.infer<typeof aiRunSchema>;

/** データ一式（store だけが書く。design.md §4） */
export const demoDataSchema = z.object({
  version: z.literal(DATA_VERSION),
  /** seed で作った日（初期状態の基準日） */
  baseDate: dateSchema,
  /** AI案の乱数の種（利用者が変えられる） */
  seed: z.number().int(),
  org: orgSchema,
  items: z.array(itemSchema),
  rules: z.array(ruleSchema),
  staff: z.array(staffSchema),
  clients: z.array(clientSchema),
  compat: compatSchema,
  visits: z.array(visitSchema),
  availability: z.array(availabilitySchema),
  /** date → 手作業案 */
  manualPlans: z.record(z.string(), manualRoutesSchema),
  /** date → 最新のAI案 */
  aiPlans: z.record(z.string(), aiPlanSchema),
  /** date → AI案の記録（古い順。ADR-0005）。古い保存データ（無い）は {}。前の版の prevAiPlans は読み込みで捨てる */
  aiRuns: z.record(z.string(), z.array(aiRunSchema)).default({}),
  /**
   * 条件のプリセット（ADR-0008。1〜MAX_PRESETS つ）。無い古いデータは store の migrate が初期の3種で補う。
   * 数・重みの範囲・ID の重複は store の repair で直す（ここでは止めない）
   */
  presets: z.array(presetSchema).max(100),
  /**
   * 点数の基準のプリセット（Preset.id。ADR-0010）。点数（100点満点）はいつも、このプリセットの重み・必須を
   * その日の条件に当てた条件の物差しで付ける（プリセットのカードで条件を変えても点は変わらない）。
   * 無い古いデータ・存在しない id は store の repair が先頭のプリセットにする（版は1のまま）
   */
  scorePresetId: z.string().max(100).optional(),
});
export type DemoData = z.infer<typeof demoDataSchema>;

export type ImportError = { code: 'INVALID_ARGUMENT'; message: string };
