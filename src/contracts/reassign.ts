/**
 * 欠勤の振り直し（reassign）の入出力（design.md §5「欠勤と振り直し」。ADR-0011）。
 * 時刻は0時からの分。Routes は staffId → 訪問IDの列（回る順）。
 * 関数（targetsOf・reassign・candidatesFor・placeVisit・reassignDiff）の実装は src/reassign/（下の関数の型で注釈する）。
 */
import type { Problem, Reason } from './problem';

export type Routes = Record<string, string[]>;

/** 元の案（列）と、その時刻を出す問題（欠勤を差し引く前。targetsOf・reassignDiff） */
export type ReassignPlan = { problem: Problem; routes: Routes };

/** 振り直す訪問 */
export type ReassignTarget = {
  visitId: string;
  /** 元の案での担当（欠勤の人） */
  fromStaffId: string;
  /**
   * absence：元の案の時刻が欠勤の時間と重なる、または欠勤のせいでその人に可にならない。
   * unreachable：欠勤のせいで strict に回れなくなる（間に合わない）。
   * notAllowed：欠勤と関係なく、その人に可にならない（元からの必須の違反）
   */
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
  /** その人のいまの列が strict で回れない（元から必須の違反がある）ので、空き時間に入れられない（fits にならない） */
  routeBroken: boolean;
  /** 「この人に入れる」（placeVisit）で開始が遅れる、その人の既存の訪問の件数（lenient の時刻。fits なら 0） */
  delayedCount: number;
  /** そのときの最大の遅れ（分。四捨五入。遅れなければ 0） */
  maxDelayMinutes: number;
  /** 「この人に入れる」で、入れた訪問の開始がいまの時刻より前になる（いまの時刻以降に入る位置が無いとき） */
  startsBeforeNow: boolean;
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
  base: ReassignPlan,
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
export type ReassignDiffFn = (before: ReassignPlan, after: ReassignPlan) => ReassignDiff;

// ---- 2回目：案B「少し動かしてよい」（PRD D34。ADR-0011 追記） ----

/** 「変更を減らす」の重み（0〜5、0.5刻み）。0＝変更を気にしない（始まった訪問は動かさない）。既定 3 */
export const STAY_WEIGHT_MIN = 0;
export const STAY_WEIGHT_MAX = 5;
export const STAY_WEIGHT_STEP = 0.5;
export const STAY_WEIGHT_DEFAULT = 3;
/** 重み1あたりの、担当が変わった訪問1件の点（移動10分ぶん。条件の重みと同じ物差し） */
export const STAY_MOVE_POINTS_PER_WEIGHT = 10;
/** 重み1あたりの、開始のずれ1分の点（ずれ10分＝移動2分ぶん） */
export const STAY_MINUTE_POINTS_PER_WEIGHT = 0.2;

/** 案B のいまの時刻と「変更を減らす」の重み */
export type AnnealOptions = { now: number | null; weight: number };

/**
 * 案B の準備（prepareAnneal）：solver に渡す問題と初期解、解いたあとに戻す訪問。
 * problem は stay（変更の減点）と、始まった訪問の固定（その担当だけを可・時間の約束を案A の開始ちょうど）を入れたもの
 */
export type AnnealPrep = {
  /** solver に渡す問題（Worker に送る。evaluate の採点には使わない） */
  problem: Problem;
  /** 初期解の候補（案A の列から、外した訪問を除いたもの。SolveOptions.initial） */
  initial: Routes;
  /** 元の問題（欠勤を差し引いた、いまの条件の問題） */
  source: Problem;
  /** 案A の列（問題にいない人の列・問題に無い訪問は、解いたあとにそのまま戻す） */
  planA: Routes;
  /** 問題から外し、解いたあとに同じ担当の列へ開始の順で戻す訪問（始まっていて、案A の列で strict に回れない訪問） */
  held: { visitId: string; staffId: string }[];
  /** 振り直す訪問（ReassignResult の placed・unplaced に使う） */
  targets: string[];
};

export type PrepareAnneal = (
  problem: Problem,
  base: ReassignPlan,
  planA: Routes,
  targets: ReassignTarget[],
  options: AnnealOptions,
) => AnnealPrep;
/** solver の結果（SolveResult.routes）を、外した訪問を戻した ReassignResult にする（placed の addedCost・addedTravel は 0） */
export type FinishAnneal = (prep: AnnealPrep, solved: Routes) => ReassignResult;
/**
 * 焼きなましが最小にする値（費用＋変更の減点＋入らない訪問の点。stay を入れた問題で。stay.keep の訪問を落とした点は
 * KEEP_DROP_POINTS）。strict で回れない列があれば Infinity
 */
export type AnnealCost = (problem: Problem, routes: Routes) => number;

/**
 * 案B の結果の確かめ（settleAnneal。保険）。ok＝案B として出せる（result は finishAnneal(prep, solved)）。
 * ok でなければ result は案A（finishAnneal(prep, prep.initial)）で、reason が理由：
 * keepDropped＝案A に入っていた訪問を落とした（visitIds がその訪問）、notBetter＝案A より良くならない
 * （案A が strict で回れず候補にできなかった・費用が案A より高い）
 */
export type AnnealSettled =
  | { ok: true; reason: null; visitIds: string[]; result: ReassignResult }
  | { ok: false; reason: 'keepDropped' | 'notBetter'; visitIds: string[]; result: ReassignResult };
export type SettleAnneal = (prep: AnnealPrep, solved: Routes) => AnnealSettled;

// ---- 2回目：連絡の一覧（PRD D35。ADR-0011 追記） ----

/** 連絡に載せる訪問1件（時刻は0時からの分。lenient） */
export type ContactVisit = {
  visitId: string;
  clientId: string;
  /** 元の案の担当（null＝元は入っていない） */
  fromStaffId: string | null;
  /** 今の案の担当（null＝入らない） */
  toStaffId: string | null;
  fromStart: number | null;
  toStart: number | null;
};

/** スタッフごとの連絡：増える訪問・外れる訪問・開始が変わる訪問（どれも開始の順） */
export type StaffContact = {
  staffId: string;
  added: ContactVisit[];
  removed: ContactVisit[];
  shifted: ContactVisit[];
};

/**
 * 連絡の一覧（contactsOf。reassignDiff と同じ規則：開始の変化は四捨五入で1分以上）。
 * staffChanged：担当が変わる訪問（入らない訪問も。toStaffId＝null）。timeChanged：担当が同じで開始が変わる訪問。
 * staff：訪問の出入りか開始の変化があるスタッフ（問題の staff の順）
 */
export type ContactList = {
  staffChanged: ContactVisit[];
  timeChanged: ContactVisit[];
  staff: StaffContact[];
};
export type ContactsOf = (before: ReassignPlan, after: ReassignPlan) => ContactList;
