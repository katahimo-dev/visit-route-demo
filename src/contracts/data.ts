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
import { compatSchema, itemSchema, ruleSchema } from './rules';

/** localStorage のキー（1つの JSON） */
export const STORAGE_KEY = 'vrdemo:data:v1';
export const DATA_VERSION = 1;

const routesSchema = z.record(z.string(), z.array(z.string()));

/**
 * 保存したAI案（作ったときの条件の重みも残し、前回との差・再現に使う）。ADR-0004：
 * routes・unassigned・score は手直し後の今の案（score は保存した時点の点。画面ではいまの条件で付け直す）。
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
  /** date → 1つ前のAI案（前回との差） */
  prevAiPlans: z.record(z.string(), aiPlanSchema),
});
export type DemoData = z.infer<typeof demoDataSchema>;

export type ImportError = { code: 'INVALID_ARGUMENT'; message: string };
