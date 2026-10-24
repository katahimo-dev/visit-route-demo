import { z } from 'zod';
import {
  absenceSchema,
  availabilitySchema,
  clientLeaveSchema,
  clientSchema,
  dateSchema,
  hhmmSchema,
  idSchema,
  MAX_VISIT_TYPES,
  orgSchema,
  patternSchema,
  staffSchema,
  visitSchema,
  visitTypeSchema,
} from './documents';
import { compatSchema, itemSchema, presetSchema, ruleSchema } from './rules';

/** localStorage のキー（1つの JSON。版2でも同じキーに書く。版1のデータは読み込みで「形が変わった」と知らせて初期データで始める） */
export const STORAGE_KEY = 'vrdemo:data:v1';
/** データの版（版2：担当を訪問に持つ。ADR-0053） */
export const DATA_VERSION = 2;

const routesSchema = z.record(z.string(), z.array(z.string()));

/**
 * 欠勤の振り直しの情報（ADR-0011。版2は ADR-0053）。振り直しの提案を反映した日に1つ（DemoData.reassigns）。
 * baseRoutes は振り直す前の担当の写し（差の基準・「振り直す前に戻す」・連絡の一覧の「前」）
 */
export const reassignInfoSchema = z.object({
  /** 反映した振り直し方：'insert'＝案A「空き時間に入れるだけ」、'anneal'＝案B「少し動かしてよい」（PRD D34） */
  method: z.enum(['insert', 'anneal']),
  /** 案B の「変更を減らす」の重み（0〜5、0.5刻み）。案A には無い */
  stayWeight: z.number().min(0).max(5).optional(),
  /** 案A の結果（振り直した直後の列）。案B の初期解・差の欄の「案A」に使う */
  insertRoutes: routesSchema.optional(),
  /** 振り直す前の担当の並び（staffId → 訪問IDの列。回る順） */
  baseRoutes: routesSchema,
  /** 振り直す前のピン（訪問ID → 担当ID） */
  basePins: z.record(z.string(), z.string()),
  /** 振り直しに使った欠勤（取り消されても残す。続けて振り直したときは最初からの累積） */
  absenceIds: z.array(idSchema),
});
export type ReassignInfo = z.infer<typeof reassignInfoSchema>;

/** 伝えた内容の1件（訪問ID・〈利用者さん〉・担当・開始。開始は移動・待ちを入れた時刻） */
export const toldVisitSchema = z.object({
  id: idSchema,
  clientId: idSchema,
  staffId: idSchema.nullable(),
  start: hhmmSchema.nullable(),
});
export type ToldVisit = z.infer<typeof toldVisitSchema>;

/**
 * 確定＝〈スタッフ〉に伝えた内容（PRD。ADR-0053）。日ごとに1つ。確定したあとに変えた訪問は、今の担当・開始と比べて
 * 「未連絡の変更」になる（lib/dayPlan の toldChanges）。at は確定した時刻（ms）
 */
export const daySnapshotSchema = z.object({
  date: dateSchema,
  at: z.number(),
  /** 伝えた訪問（取り消し・休みの訪問は入れない） */
  visits: z.array(toldVisitSchema).max(500),
});
export type DaySnapshot = z.infer<typeof daySnapshotSchema>;

/** 組み方の標準を登録した記録（ADR-0062） */
export const standardInfoSchema = z.object({
  /** 登録した時刻（ms） */
  at: z.number(),
  /** 登録したときの点数の基準のプリセット */
  presetId: z.string().max(100),
  /** いつから */
  from: dateSchema,
  /** 周期の週数 */
  weeks: z.number().int().min(1).max(4),
});
export type StandardInfo = z.infer<typeof standardInfoSchema>;

/** データ一式（store だけが書く。design.md §4） */
export const demoDataSchema = z.object({
  version: z.literal(DATA_VERSION),
  /** seed で作った日（初期状態の基準日） */
  baseDate: dateSchema,
  /** AI の乱数の種 */
  seed: z.number().int(),
  org: orgSchema,
  items: z.array(itemSchema),
  /**
   * 条件（名前・型・並び）。重み・必須はいつも点数の基準のプリセットにそろえる（store の repair。ADR-0053）。
   * AI で組む・点数・訪問ごとの検査はこの重みで計算する
   */
  rules: z.array(ruleSchema),
  staff: z.array(staffSchema),
  clients: z.array(clientSchema),
  compat: compatSchema,
  /** 保存した訪問：単発の訪問と、繰り返しのうち変えた回（ADR-0053） */
  visits: z.array(visitSchema),
  availability: z.array(availabilitySchema),
  /** 当日の急な欠勤（ADR-0011） */
  absences: z.array(absenceSchema).max(2000),
  /** 訪問の種類（ADR-0012。最大20） */
  visitTypes: z.array(visitTypeSchema).max(MAX_VISIT_TYPES),
  /** 繰り返し（定期パターン。ADR-0012） */
  patterns: z.array(patternSchema).max(2000),
  /** 〈利用者さん〉の休み（ADR-0013） */
  clientLeaves: z.array(clientLeaveSchema).max(2000),
  /** date → 伝えた内容（確定。ADR-0053） */
  snapshots: z.record(z.string(), daySnapshotSchema),
  /** date → 欠勤の振り直しの情報（反映した振り直しの日だけ。ADR-0011・ADR-0053） */
  reassigns: z.record(z.string(), reassignInfoSchema),
  /** 条件のプリセット（ADR-0008。1〜MAX_PRESETS つ）。数・重みの範囲・ID の重複は store の repair で直す */
  presets: z.array(presetSchema).max(100),
  /**
   * 点数の基準のプリセット（Preset.id。ADR-0010）。AI で組む・点数はいつもこのプリセットの重み・必須で計算する。
   * 存在しない id は store の repair が先頭のプリセットにする
   */
  scorePresetId: z.string().max(100).optional(),
  /** 組み方の標準を登録した記録（ADR-0062。無ければ登録していない） */
  standard: standardInfoSchema.optional(),
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
