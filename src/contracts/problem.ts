/**
 * 最適化の問題と結果、Worker のメッセージ（design.md §5）。
 * matching.compile が作り、solver と evaluate が同じものを読む（同じ物差しで採点する）。
 * 時刻はすべて 0時からの分（整数でなくてよい）。点は移動1分＝1点。
 */

export type ProblemStaff = {
  id: string;
  name: string;
  /** points の添字（自宅） */
  point: number;
  /** その日の稼働時間帯（分、開始の順・重なりなし）。空なら休み＝可否ですべて外れる */
  slots: { start: number; end: number }[];
};

export type ProblemVisit = {
  id: string;
  clientId: string;
  /** points の添字（訪問先） */
  point: number;
  earliest: number;
  latest: number;
  duration: number;
};

export type Reason = {
  /** Rule.id。移動・待ちは 'travel' / 'wait'、可否で外れた原因は Rule.id か 'slot' / 'time' / 'noPlace' */
  ruleId: string;
  label: string;
  /** 点（正＝悪い、負＝良い）。可否で外れた原因は Infinity */
  points: number;
  /** 相性の理由にだけ付ける（2=◎ 1=○ -1=△ -2=×）。達成の件数（evaluate.achievements）に使う */
  level?: 2 | 1 | -1 | -2;
};

export type Problem = {
  date: string;
  staff: ProblemStaff[];
  visits: ProblemVisit[];
  /** 地点間の移動（分）。[from][to]。地点＝スタッフの自宅と訪問先 */
  travel: number[][];
  meters: number[][];
  /** [visit][staff] 担当できるか（必須の条件・相性×・稼働時間帯に作業が収まる時間がない、で外れる） */
  allowed: boolean[][];
  /** [visit][staff] 割当費用（点）。allowed=false の組では使わない */
  assignCost: number[][];
  /** [visit][staff] 割当費用・可否の内訳（理由。points の大きい順） */
  reasons: Reason[][][];
  /** 待ち1分の点 */
  waitPerMinute: number;
  /**
   * 負担の均等。lo/hi はスタッフごとの件数の目安の帯。スタッフごとに帯 [lo,hi] から外れた件数 e について
   * perVisit × e² 点。cap は必須のときのスタッフごとの件数の上限（＝hi+1。超える割当はしない）、必須でなければ null。
   * null は無効（重み0 かつ必須でない）
   */
  balance: { perVisit: number; lo: number[]; hi: number[]; cap: number[] | null } | null;
  /** どの担当も可にならない訪問と、その原因 */
  infeasible: { visit: number; reasons: Reason[] }[];
};

/**
 * 1人のルートの時刻の決め方（solver と evaluate で同じ。matching/timing.ts の scheduleRoute が唯一の実装）：
 * - 自宅を出る時刻は自由。最初の訪問に着く時刻＝その訪問の開始（待ちは0）。ただし自宅を出るのは最初の稼働時間帯の開始以降
 * - 各訪問の開始＝max(到着, earliest) から、作業 [開始, 開始+duration] が稼働時間帯の1つに収まる最も早い時刻
 * - 開始が latest を超える、または収まる時間帯がない＝時間の違反（strict ではそのルートは不可）
 * - 待ち＝開始−到着（最初の訪問は0）。最後の訪問のあと自宅へ帰る移動も数える。帰着が最後の時間帯の終了を超えても違反にしない
 * - lenient（手作業案の採点）では違反しても続けて計算し、違反を記録する
 */
export type StopTiming = {
  visitId: string;
  arrival: number;
  start: number;
  end: number;
  wait: number;
  travelIn: number;
};
export type RouteTiming = {
  stops: StopTiming[];
  travelMinutes: number;
  waitMinutes: number;
  meters: number;
  /** 時間の約束・稼働時間帯を破った訪問 */
  violations: { visitId: string; kind: 'time' | 'slot' }[];
};

/** AI案。routes は staffId → 訪問IDの列（回る順） */
export type SolveResult = {
  routes: Record<string, string[]>;
  unassigned: string[];
  /** 合計点（evaluate.score の total と一致する） */
  score: number;
  seed: number;
  iterations: number;
  /** 利用者が止めた・上限の時間で止めた（途中の案） */
  stopped: boolean;
};

export type SolveOptions = { seed: number; iterations: number };

/** 焼きなましを少しずつ進める（Worker が stop を受け取れるように）。step は終わったら true */
export type Solver = { step(n: number): boolean; iteration(): number; bestScore(): number; best(): SolveResult };

export type WorkerRequest =
  | { type: 'solve'; requestId: string; problem: Problem; options: SolveOptions }
  | { type: 'stop'; requestId: string };
export type WorkerResponse =
  | {
      type: 'progress';
      requestId: string;
      iteration: number;
      total: number;
      /** いまの最良の費用（解いている problem の物差し） */
      bestScore: number;
      /**
       * いまの最良の案（staffId → 訪問ID）。画面が点数の基準の物差しで付け直すのに使う（ADR-0010）。
       * bestScore が前に送ったときと同じ（最良が変わっていない）ときは送らない。無ければ画面は前の点数を使う
       */
      bestRoutes?: Record<string, string[]>;
    }
  | { type: 'done'; requestId: string; result: SolveResult }
  | { type: 'error'; requestId: string; message: string };

/** 採点（evaluate.score） */
export type PlanScore = {
  total: number;
  travelMinutes: number;
  waitMinutes: number;
  meters: number;
  /** 割当費用の合計（条件の点） */
  assignPoints: number;
  balancePoints: number;
  dropped: number;
  /** Rule.id → 達成（points<0 または条件を満たした件数）・違反（points>0 の件数）・点 */
  perRule: Record<string, { hits: number; misses: number; points: number }>;
  /** 必須の違反（手作業案だけで起きる。AI案では常に空） */
  hardViolations: { visitId: string; staffId: string; kind: 'time' | 'slot' | 'notAllowed'; label: string }[];
};

export type VisitExplain = {
  visitId: string;
  staffId: string | null;
  /** 点の絶対値の大きい順に3つまで（移動 'travel' を含む） */
  reasons: Reason[];
  timing: StopTiming | null;
};

export type PlanDiff = { changedVisits: string[]; travelDelta: number; scoreDelta: number };

/** 点数の上限（理想＝下限の案の点。ADR-0007 案A への変更。2026-10-13） */
export const SCORE_MAX = 100;

/**
 * 点数の物差し（evaluate.normalize。ADR-0007）。表示だけに使い、solver が最小にする費用は変えない。
 * 画面では、点数の基準のプリセット（DemoData.scorePresetId）の条件で作った Problem から作る（ADR-0010）。
 * 点数＝round(100 − (費用 − lowerBound) / visits)、0〜100 に収める。visits が0なら100。
 * 「1件あたり、理想より余計にかかった費用（分に換算）だけ減点」（1件あたり10分余計なら90点）
 */
export type ScoreScale = {
  /**
   * 100点：理論上の下限（どの案の費用もこれ以上）。各訪問を割当費用が最小の担当に＋移動の下限（各訪問に来る・出る移動の最小の和）。
   * 待ち・均等は0。担当の候補がいない訪問は落とした訪問の点
   */
  lowerBound: number;
  /** 訪問の件数（その日の Problem の訪問＝計算に入れた訪問）。超過をこれで割って1件あたりにする */
  visits: number;
  /** 下限のうち割当費用の合計 */
  lowerAssign: number;
  /** 下限のうち移動（分＝点） */
  lowerTravel: number;
  /** 下限のうち落とした訪問の件数（どの担当も可にならない訪問） */
  lowerDropped: number;
};

/** 点数の減点の内訳（費用の成分ごと。points は減点の大きさ＝成分の超過 ÷ 訪問の件数、合計はおおむね 100−点数） */
export type HundredPart = {
  key: 'travel' | 'wait' | 'assign' | 'balance' | 'dropped';
  label: string;
  points: number;
};

/**
 * 条件ごとの達成の件数（evaluate.achievements。ADR-0008）。
 * total＝その条件の判定がある割当済みの訪問（負担の均等は稼働のある人と訪問のある人の数）、
 * met＝その条件の判定をすべて満たした（点が0以下の）訪問（負担の均等は目安の帯に収まった人）。
 * compat は相性の条件だけ：◎・○・△・× の件数
 */
export type RuleAchievement = {
  ruleId: string;
  unit: 'visit' | 'staff';
  total: number;
  met: number;
  compat: { great: number; good: number; poor: number; ng: number } | null;
};
