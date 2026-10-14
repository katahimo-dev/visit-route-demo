/**
 * 欠勤の振り直し（reassign）の入出力（design.md §5「欠勤と振り直し」。ADR-0011）。
 * 時刻は0時からの分。Routes は staffId → 訪問IDの列（回る順）。
 * 関数（targetsOf・reassign・candidatesFor・placeVisit・reassignDiff）の実装は src/reassign/。
 */
import type { Problem, Reason } from './problem';

export type Routes = Record<string, string[]>;

/** 振り直す訪問 */
export type ReassignTarget = {
  visitId: string;
  /** 元の案での担当（欠勤の人） */
  fromStaffId: string;
  /** 欠勤と重なる・間に合わない・ほかの必須の条件で外れる */
  reason: 'absence' | 'unreachable' | 'notAllowed';
};

/** いまの時刻（0時からの分）。null は考えない */
export type ReassignOptions = { now: number | null };

export type ReassignResult = {
  /** 振り直したあとの案 */
  routes: Routes;
  /** 入れた順 */
  placed: { visitId: string; staffId: string; addedCost: number; addedTravel: number }[];
  /** 入らなかった振り直す訪問 */
  unplaced: string[];
  /** 問題の訪問のうちどの列にも無いもの（unplaced と元から入らない訪問） */
  unassigned: string[];
  /** 担当のいるすべての訪問（訪問ID → 担当ID） */
  pins: Record<string, string>;
};

export type ReassignCandidate = {
  staffId: string;
  /** 可で、他の訪問の開始時刻を変えずに strict で入り、件数の上限を超えない */
  fits: boolean;
  /** fits のときの増える移動（分） */
  addedTravel: number | null;
  /** fits のときの増える費用 */
  addedCost: number | null;
  /** fits でないとき、時間の約束を何分ずらせば strict で入るか（正＝遅く。5分刻み・前後120分まで。無ければ null） */
  shiftMinutes: number | null;
  /** 件数の上限（必須の負担の均等）を超える */
  overCap: boolean;
  /** 必須で外れる理由（points=Infinity）と重みの違反（points>0） */
  violations: Reason[];
};

export type ReassignDiff = {
  /** 担当が変わった訪問（null＝未割当） */
  moved: { visitId: string; from: string | null; to: string | null }[];
  /** 担当が同じで開始が1分以上変わった訪問（正＝遅く。四捨五入） */
  shifted: { visitId: string; minutes: number }[];
  /** 元は担当がいて、いまは入らない訪問 */
  unplaced: string[];
  /** 訪問の出入りか開始の変化がある人 */
  changedStaff: string[];
  /** 全体の移動の増減（分） */
  travelDelta: number;
};

export type TargetsOf = (
  problem: Problem,
  baseRoutes: Routes,
  absentStaffIds: string[],
  now: number | null,
) => ReassignTarget[];
export type Reassign = (
  problem: Problem,
  baseRoutes: Routes,
  targets: ReassignTarget[],
  options: ReassignOptions,
) => ReassignResult;
export type CandidatesFor = (
  problem: Problem,
  routes: Routes,
  visitId: string,
  options: ReassignOptions,
) => ReassignCandidate[];
export type PlaceVisit = (
  problem: Problem,
  routes: Routes,
  visitId: string,
  staffId: string,
  options: ReassignOptions,
) => Routes;
export type ReassignDiffFn = (
  before: { problem: Problem; routes: Routes },
  after: { problem: Problem; routes: Routes },
) => ReassignDiff;
