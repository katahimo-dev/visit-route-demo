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

/** 保存したAI案（作ったときの条件の重みも残し、前回との差・再現に使う） */
export const aiPlanSchema = z.object({
  date: dateSchema,
  createdAt: z.number(),
  seed: z.number().int(),
  iterations: z.number().int(),
  routes: z.record(z.string(), z.array(z.string())),
  unassigned: z.array(z.string()),
  score: z.number(),
  stopped: z.boolean(),
  rules: z.array(ruleSchema),
});
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
