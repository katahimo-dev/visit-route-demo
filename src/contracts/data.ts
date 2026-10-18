import { z } from 'zod';
import {
  absenceSchema,
  availabilitySchema,
  clientLeaveSchema,
  clientSchema,
  dateSchema,
  idSchema,
  MAX_VISIT_TYPES,
  manualRoutesSchema,
  orgSchema,
  patternSchema,
  staffSchema,
  visitSchema,
  visitTypeSchema,
} from './documents';
import { compatSchema, itemSchema, presetSchema, ruleSchema } from './rules';

/** localStorage のキー（1つの JSON） */
export const STORAGE_KEY = 'vrdemo:data:v1';
export const DATA_VERSION = 1;

const routesSchema = z.record(z.string(), z.array(z.string()));

/**
 * 欠勤の振り直しの情報（ADR-0011）。AiPlan・AiRun に optional で付く（無い＝ふつうの AI案）。
 * baseRoutes は振り直す前の元の案（差の基準・「元の案に戻す」・比較の「欠勤前」）
 */
export const reassignInfoSchema = z.object({
  /** 今の案（記録）の振り直し方：'insert'＝案A「空き時間に入れるだけ」、'anneal'＝案B「少し動かしてよい」（2回目。PRD D34） */
  method: z.enum(['insert', 'anneal']),
  /** 案B の「変更を減らす」の重み（0〜5、0.5刻み）。案A には無い */
  stayWeight: z.number().min(0).max(5).optional(),
  /**
   * 案A の結果（振り直した直後の列）。案B の初期解・差の欄の「案A」・「案A を今の案にする」に使う。
   * 2回目より前の古いデータには無い（案A のときは今の案を案A とみなす）
   */
  insertRoutes: routesSchema.optional(),
  /** 元の案：確定した割当（manualPlans[date]）か今の案（aiPlans[date].routes） */
  from: z.enum(['confirmed', 'plan']),
  /** 元の案（staffId → 訪問IDの列） */
  baseRoutes: routesSchema,
  /** 元の案の固定（元が確定した割当なら {}） */
  basePins: z.record(z.string(), z.string()),
  /**
   * 振り直す前の今の案の generated（AI が出したまま）と runId（元の記録）。「元の案に戻す」で戻す。
   * 振り直す前に今の案が無かった・古いデータには無い（戻すときは元の案を generated にし、runId は外す）
   */
  baseGenerated: z.object({ routes: routesSchema, unassigned: z.array(z.string()), score: z.number() }).optional(),
  baseRunId: z.string().max(100).optional(),
  /** 振り直しに使った欠勤（取り消されても残す。続けて振り直したときは最初からの累積） */
  absenceIds: z.array(idSchema),
  // いまの時刻（now）は持たない（2026-10-14 利用者が決定。過去の欠勤は登録しない前提）。古いデータの now は読み込みで捨てる（z.object が知らないキーを落とす）
});
export type ReassignInfo = z.infer<typeof reassignInfoSchema>;

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
  /** 今の案が欠勤の振り直しの結果なら付く（差の欄を出す。ADR-0011） */
  reassign: reassignInfoSchema.optional(),
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
 * presetId は最後に作ったとき（同じ記録を使い回したときも）に重みが一致した最初のプリセット（どれとも一致しなければ null。lib/runs の addRun。PR #40 の再レビュー）。pins は組み直しで残した固定（作ったときは {}）
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
  /**
   * 計算に使った問題（Problem）の中身から作ったキー（lib/runs の problemKey。ADR-0010）。
   * 訪問・スタッフ（稼働時間帯）・移動・割当費用・可否・均等など、費用と可否に効くものがすべて同じならキーも同じ。
   * プリセットのカードで再計算を省くのは、これがいまの問題のキーと一致する記録だけ。無い古い記録は使わない（計算する）
   */
  inputKey: z.string().max(100).optional(),
  /** 記録が欠勤の振り直しなら付く（比較の「欠勤前」。reusableRun の対象外。ADR-0011） */
  reassign: reassignInfoSchema.optional(),
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
  /** 当日の急な欠勤（ADR-0011）。無い古いデータは []（版は1のまま） */
  absences: z.array(absenceSchema).max(2000).default([]),
  /** 訪問の種類（ADR-0012。最大20）。無い古いデータは []（版は1のまま） */
  visitTypes: z.array(visitTypeSchema).max(MAX_VISIT_TYPES).default([]),
  /** 定期パターン（ADR-0012）。無い古いデータは []（版は1のまま） */
  patterns: z.array(patternSchema).max(2000).default([]),
  /** 〈利用者さん〉の休み（ADR-0013）。無い古いデータは []（版は1のまま） */
  clientLeaves: z.array(clientLeaveSchema).max(2000).default([]),
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

/** Excel の名簿（PRD D103〜D107。ADR-0020）：〈利用者さん〉の名簿か〈スタッフ〉の名簿か */
export type RosterKind = 'client' | 'staff';
/**
 * 名簿の読み込み方（PRD D104）：'merge'＝追加・更新（ブックに無い人はそのまま。既定）、
 * 'replace'＝総入れ替え（ブックに無い人を、〈利用者さん〉は段階「終了」、〈スタッフ〉は休止にする。消さない）
 */
export type RosterMode = 'merge' | 'replace';
/**
 * 名簿の読み込みの結果（PRD D106）。data は名簿を当てた新しいデータ（store の migrate を通したもの。画面が store の update で入れる）。
 * 件数は migrate のあとの結果を ID で引き、今の人と比べて数える（repair で元に戻る違いは変更とみなさない）
 */
export type RosterImportResult = {
  data: DemoData;
  /** 足した人の名前（ブックの行の順。利用中でない人は「名前（終了）」「名前（休止）」のように添える） */
  added: string[];
  /** 直した人の名前（ブックの行の順） */
  updated: string[];
  /** 変更の無い行の数 */
  unchanged: number;
  /** 総入れ替えで終了・休止にした人の名前（今のデータの順） */
  retired: string[];
  /** 休止になった〈スタッフ〉が「担当できる人」から外れる〈利用者さん〉の名前（repair が外す。戻しても戻らない） */
  allowedRemoved: string[];
  /** そのうち担当できる人がいなくなり「限らない」に戻る〈利用者さん〉の名前 */
  allowedEmptied: string[];
  /** 最終勤務日が入った・変わった〈スタッフ〉の名前（担当の振り直しを確かめてもらう） */
  lastDaySet: string[];
  /** 読み込む前の、終了・休止にできる人の数（〈スタッフ〉は利用中、〈利用者さん〉は終了でない人）。取り違えの注意に使う */
  activeBefore: number;
};
