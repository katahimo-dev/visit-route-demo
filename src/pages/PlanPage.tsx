import {
  ArrowRightLeft,
  Ban,
  BedSingle,
  CalendarDays,
  Car,
  ChevronRight,
  CircleCheck,
  CircleOff,
  Clock,
  Copy,
  Crown,
  Gauge,
  GitCompareArrows,
  History,
  Hourglass,
  Info,
  LayoutGrid,
  ListChecks,
  Mail,
  Map as MapIcon,
  MapPin,
  PanelRightOpen,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Timer,
  TriangleAlert,
  Undo2,
  UserRoundX,
} from 'lucide-react';
import { type DragEvent, Fragment, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useDay } from '../app/day';
import { useConfirm } from '../components/ConfirmDialog';
import { DayLines } from '../components/dayLines';
import { MapDock } from '../components/MapDock';
import { MenuButton, type MenuItem } from '../components/MenuButton';
import { useMailLimit } from '../components/mailParts';
import { VisitRouteLinks } from '../components/mapsLinks';
import { PersonButton, PersonInfo } from '../components/PersonPopover';
import { ClientName } from '../components/parts';
import { PrefAskBand, PrefBulkBand, PrefBulkResult } from '../components/prefAsk';
import { ScheduleBand } from '../components/progressBand';
import { RouteMap } from '../components/RouteMap';
import { RouteTimeline, type TimelineBand, type TimelineColumn } from '../components/routeTimeline';
import { LegLine, StaffLegend, VisitCard } from '../components/routeView';
import { StaffMark, StaffMarkById } from '../components/StaffMark';
import { Term } from '../components/Term';
import { useToast } from '../components/Toast';
import { Empty, Hint, IconButton, PageHeader, SectionTitle, SidePanel, Stat, WithIcon } from '../components/ui';
import { ViewSwitch } from '../components/ViewSwitch';
import { useOpenVisit } from '../components/VisitPanel';
import { VisitRules } from '../components/VisitRules';
import { TypeMark } from '../components/visitType';
import type { AiPlan, AiRun, DemoData, ManualPref } from '../contracts/data';
import type { Absence, Client, Visit, VisitType } from '../contracts/documents';
import type { PlanScore, Problem, RuleAchievement, ScoreScale, SolveResult } from '../contracts/problem';
import type { Preset, Rule } from '../contracts/rules';
import { slotsText, timeText } from '../domain/availability';
import { isOnLeave, leaveOn } from '../domain/leaves';
import { NONE, timeOrder, windowText } from '../domain/scheduleModel';
import { addDays, hhmmToMinutes, jstDate } from '../domain/time';
import {
  achievements,
  BALANCE_RULE_KEY,
  diff,
  hundredBreakdown,
  normalize,
  ruleLowerBounds,
  score,
  toHundred,
} from '../evaluate';
import {
  absencesOn,
  absenceText,
  addAnnealRun,
  annealRunOf,
  applyReassign,
  baseOf,
  chooseReassign,
  orderConfirmed,
  removeAbsence,
  revertReassign,
  saveAbsence,
  withoutAbsencesOn,
} from '../lib/absences';
import { colorOf } from '../lib/colors';
import { attempt, dateText, deltaText, formError, newId, own, pointsText, r0 } from '../lib/common';
import { confirmDay } from '../lib/confirmDay';
import { type CancelledContact, type ContactRow, contactCount, contactRows, dateWordOf } from '../lib/contacts';
import { copyDayVisits } from '../lib/copyDay';
import { dayLineRange, dayLines } from '../lib/dayLine';
import { deferredDragStart } from '../lib/dragStart';
import { isDate } from '../lib/isDate';
import { UNASSIGNED_DO, workloadHref } from '../lib/links';
import { contactMailText, mailTo } from '../lib/mail';
import {
  applyFutureAssigned,
  type FutureAssigned,
  futureAssigned,
  patchManualPrefs,
  prefDatesText,
  prefWhenText,
  samePlanEdit,
  undoPrefExtras,
} from '../lib/manualPrefs';
import { HOME_LABEL } from '../lib/mapsLink';
import { currentRuleKeys, planStale, rulesStale } from '../lib/month';
import { scrollBehavior } from '../lib/motion';
import { typeOf } from '../lib/patternText';
import { leavePeople } from '../lib/personLinks';
import {
  adoptWarnings,
  batchDescription,
  compareText,
  createText,
  hasUnpinnedEdits,
  type PlanMenuInput,
  presetDescription,
  resolveText,
  revertText,
} from '../lib/planMenu';
import { planRulesOf } from '../lib/presets';
import { CURRENT_TEXT, NONE_TEXT, reassignItemText } from '../lib/reassignMenu';
import { rebuildWith } from '../lib/rebuildBand';
import { buildRouteMap, homeLegKey, homeTravel, useRouteSelection } from '../lib/routeView';
import { addRun, alignPlan, alignRoutes, findRun, planOfRun, problemKey, reusableRun } from '../lib/runs';
import { reasonFace, scoreReason } from '../lib/scoreReason';
import { SUDDEN_DO, staffChoices, visitChoices } from '../lib/sudden';
import { type LegSpan, legsOf, shadowOf, spansOf, typeUnfitOf } from '../lib/timeline';
import {
  confirmedKey,
  type EditSnapshot,
  type EditState,
  takeSnapshot,
  undoBlockReason,
  undoState,
} from '../lib/undoEdit';
import { ownerMap, useDayModel } from '../lib/useDayModel';
import { useFeature } from '../lib/useFeature';
import { COMPACT_QUERY } from '../lib/useMedia';
import { createValueStore, type ReadableStore, useValueStore } from '../lib/valueStore';
import { hmText, workRoutesOf, workStats } from '../lib/workload';
import { bestInsertion, compile, prefKey, withManualPrefs } from '../matching';
import {
  type ContactList,
  candidatesFor,
  contactsOf,
  leftOf,
  placeVisit,
  prepareAnneal,
  type ReassignCandidate,
  type ReassignResult,
  reassign,
  reassignDiff,
  STAY_WEIGHT_DEFAULT,
  settleAnneal,
  targetsOf,
} from '../reassign';
import { applyPreset, matchesPreset, presetOf, scorePresetOf, scoreRulesOf } from '../seed';
import { defaultIterations, runSolve } from '../solver';
import './plan.css';
import './schedule.css';
import { CandidateBox, leftReasonText, ReassignBar, ReassignMoves, ReassignSummary } from './absenceParts';
import { DayMailPanel } from './mailPanels';
import {
  AchievementList,
  achievementSummary,
  breakdownText,
  explainMap,
  HARD_NOTE,
  HundredHint,
  NextUnconfirmed,
  ReasonBox,
  RefMark,
  rulerText,
  ScoreNextStep,
  ScoreReasonText,
  WeightPanel,
} from './planParts';
import {
  AnnealBox,
  ContactButton,
  ContactPanel,
  type LeftContact,
  ReassignDock,
  type ReassignOption,
} from './reassignParts';
import { type SuddenInit, SuddenPanel } from './SuddenPanel';

/** 連絡の一覧が出せない（差を出せない）ときでも、欠勤の人に残る訪問だけで開くための空の一覧 */
const EMPTY_CONTACTS: ContactList = { staffChanged: [], timeChanged: [], staff: [] };

/**
 * 予定（D4・D13・D18・ADR-0004・ADR-0009）：その日の訪問の一覧（追加・編集・取消・前の同じ曜日からコピー）と、
 * 担当の割り当てを1画面で扱う。AI案を作る → 担当ごとの列で手直し（ドラッグ）→ 動かした訪問は固定 →
 * 「固定した訪問は残して、ほかを作り直す」（固定を残して組み直す）で残りを AI が組み直す →「この割当で確定」（manualPlans と各訪問の担当に写す）。
 * AI案の routes は手直し後の今の案、generated は AI が出したまま、pins は固定（訪問ID → 担当ID）。
 * AI案が無い日は、開いたときに点数の基準のプリセットの案だけを自動で作る（D52。残りは「まだ作っていない考え方をまとめて作る」）。作る・組み直すたびに、条件と結果を
 * その日の記録（aiRuns）に残し、「比較」の画面（#/compare）で任意の2つを比べる（ADR-0005）。
 * プリセットごとの案のカードを並べ、「この案にする」で今の案にする。
 * 点数（100点満点）・必須の違反・条件ごとの達成は、いつも点数の基準のプリセットの物差し（ADR-0010。useDayModel の scoreProblem）。
 * プリセットのカード・重みの欄で変わるのは「どう組むか（solver が最小にする費用）」だけ。訪問ごとの理由・ドラッグの可否はこの日だけ試す重み
 */

/** 予定の画面の地図・選択で使うルートの集まりのキー（今の案は1つだけ） */
const PLAN_SET = 'plan';

/**
 * hundred：いまの最良を点数の基準の物差しで点数（100点満点）にした値（物差しを作れなければ null）。
 * 最良が変わらず Worker が bestRoutes を送らなかった進捗では、前の値のまま
 */
type Progress = { iteration: number; total: number; hundred: number | null };
/** 手直しの記憶を聞く1件（PRD D261）：訪問・変えた先・最初に変える前の担当 */
type PrefAskItem = { visitId: string; staffId: string; from: string | null };
/**
 * 「元に戻す」（1手。PRD D218）の控え：日の手直し（snap。無ければ null）に、同じ1手で書いた手直しの記憶（prefs：キーと前の値）と
 * まとめて変えたほかの日の今の案（others：前と後）を足す（ADR-0043）
 */
type UndoSnap = {
  date: string;
  snap: EditSnapshot | null;
  visitId: string | null;
  from: string | null;
  prefs?: { key: string; before: ManualPref | null }[];
  others?: { date: string; before: AiPlan; after: AiPlan }[];
};

/**
 * 計算の進み具合のバーと回数（PRD D249）。進み具合は外の入れ物から読み、変わってもここだけ描き直す
 */
function PlanProgressText({ store, prefix }: { store: ReadableStore<Progress | null>; prefix: string }) {
  const progress = useValueStore(store);
  return (
    <>
      <progress value={progress?.iteration ?? 0} max={progress?.total ?? 1} />
      <span className="sub">
        {prefix}
        {progress
          ? `${progress.iteration.toLocaleString()} / ${progress.total.toLocaleString()} 回${progress.hundred === null ? '' : `・いまの最良 ${progress.hundred}点`}`
          : '準備中…'}
      </span>
    </>
  );
}

/** 日付の短い表示（2026-10-13 → 10/13） */
function shortDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/**
 * その日のAI案を書き換える（無ければそのまま）。problem を渡すと、書き換える前に今の訪問に合わせる（alignPlan）
 */
function patchPlan(d: DemoData, date: string, problem: Problem | null, fn: (p: AiPlan) => AiPlan): DemoData {
  const p = d.aiPlans[date];
  if (!p) return d;
  return { ...d, aiPlans: { ...d.aiPlans, [date]: fn(problem ? alignPlan(problem, p) : p) } };
}

/** 今の案を routes にした AiPlan（unassigned・score は problem で付け直す） */
function withRoutes(problem: Problem, plan: AiPlan, routes: Record<string, string[]>): AiPlan {
  const placed = new Set(Object.values(routes).flat());
  const sc = score(problem, routes);
  return {
    ...plan,
    routes,
    unassigned: problem.visits.map((v) => v.id).filter((id) => !placed.has(id)),
    score: sc.total,
  };
}

export default function PlanPage() {
  const { date, setDate } = useDay();
  const m = useDayModel(date);
  /** 切った機能（案を比べる・稼働の見込み）の画面へ移るボタン・リンクは出さない（PRD D213。ADR-0028） */
  const compareOn = useFeature('compare');
  const workloadOn = useFeature('workload');
  /**
   * 画面の中の欄・ボタン（ADR-0028）：欠勤・キャンセル（操作の行・列の見出し・当日キャンセルの選択）、メール（ボタン・欄・連絡の一覧）、
   * 条件の重みとプリセット（「条件を調整する」・点数の横の理由・プリセットは基準の1枚だけ）。欠勤の印・帯（事実）は残す
   */
  const suddenOn = useFeature('sudden');
  const mailOn = useFeature('mail');
  const rulesOn = useFeature('rules');
  const compatOn = useFeature('compat');
  const {
    data,
    update,
    staff,
    staffById,
    clientById,
    colorOfStaff,
    visits,
    visitById,
    compileInput,
    problem,
    scoreProblem,
    scoreScale,
    scoreRulerName,
    scoreRules,
    slotsOf,
  } = m;
  const terms = data.org.terms;
  /** AI案を作る条件（rules が切なら点数の基準のプリセットの重みを当てたもの。ADR-0028。lib/presets の planRulesOf） */
  const planRules = useMemo(
    () => planRulesOf({ rules: data.rules, presets: data.presets, scorePresetId: data.scorePresetId }, rulesOn),
    [data.rules, data.presets, data.scorePresetId, rulesOn],
  );
  /** 〈利用者さん〉の休み（ADR-0013）のため無しの訪問の〈利用者さん〉（名前から詳細を開く。理由を添える。PRD D208） */
  const leaveNames = useMemo(
    () => leavePeople(m.leaveVisits, data.clientLeaves, date, (id) => clientById.get(id)?.displayName),
    [m.leaveVisits, data.clientLeaves, date, clientById],
  );
  /** 休みの訪問が確定した割当に入っている（作り直しを促す） */
  const leaveInConfirmed = useMemo(() => {
    const saved = own(data.manualPlans, date);
    if (!saved || m.leaveVisits.length === 0) return false;
    const ids = new Set(m.leaveVisits.map((v) => v.id));
    return Object.entries(saved).some(([k, list]) => k !== NONE && list.some((id) => ids.has(id)));
  }, [data.manualPlans, date, m.leaveVisits]);
  const toast = useToast();
  const confirmDialog = useConfirm();
  /**
   * 計算の進み具合（100msごとに変わる）。画面の state に置くと画面全体を描き直すので、外の入れ物に置き、
   * 読む子の部品（PlanProgressText・AnnealBox の進み具合）だけを描き直す（PRD D249）
   */
  const [progressStore] = useState(() => createValueStore<Progress | null>(null));
  /** プリセットのカードの詳細の id の頭（aria-describedby） */
  const cardIdBase = useId();
  const [running, setRunning] = useState<'create' | 'resolve' | 'anneal' | null>(null);
  /** 計算している日と条件の名前（AI案が無い日の「作っています」の表示） */
  const [runningFor, setRunningFor] = useState<{ date: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 地図で見る担当・強調する区間・選んだ訪問（列の見出し・凡例・訪問・区間を押す。予定と比較で共通） */
  const sel = useRouteSelection(date, (_set, id) => owner.get(id));
  const { focusStaff, focusOn } = sel;
  /** 訪問の詳細の欄（PRD D301〜D304。App の殻の欄を開く） */
  const openVisitPanel = useOpenVisit();
  /** スマホの幅（600px 以下）は訪問を足さない（ADR-0051 の決定5） */
  const compact = useMediaLocal(COMPACT_QUERY);
  /** 「その他 ▾」の「使い方」で開いた説明（PRD D279。保存しない） */
  const [helpOpen, setHelpOpen] = useState(false);
  const helpRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (helpOpen) helpRef.current?.focus();
  }, [helpOpen]);
  /**
   * 「欠勤・キャンセル」の欄（PRD D167〜D172。null：閉じている）。日の画面の入口・ホーム（`?do=absence`）からは1段目、
   * 列の見出しの「この人の欠勤を登録」「欠勤を直す」からはその人を選んだ2段目で開く
   */
  const [sudden, setSudden] = useState<SuddenInit | null>(null);
  /** 「欠勤・キャンセル」の欄を閉じたあと、差の欄へ移るか（振り直したあと） */
  const suddenToBar = useRef(false);
  /** 日の予定の「欠勤・キャンセルを登録」のボタン（欄を閉じたときの戻り先が消えていたら） */
  const suddenBtnRef = useRef<HTMLButtonElement>(null);
  /** 欄を開く（前に振り直して閉じたときの「差の欄へ移る」を戻す。開き直して欠勤だけ登録したときに差の欄へ飛ばない） */
  const openSudden = (init: SuddenInit) => {
    suddenToBar.current = false;
    setSuddenCancel(null);
    setSudden(init);
  };
  /**
   * 欄で取り消した訪問（5段目の連絡の「中止」。PRD D244）と、取り消したときの確定した割当（無ければ null。
   * 確定し直した差の「前」）。欄を開き直すと消す
   */
  const [suddenCancel, setSuddenCancel] = useState<{
    cancelled: CancelledContact;
    prev: Record<string, string[]> | null;
  } | null>(null);
  /** 取り消しの欄を開いている訪問（PRD D74。null：閉じている）と、当日キャンセルか */
  const [cancelFor, setCancelFor] = useState<Visit | null>(null);
  const [cancelSameDay, setCancelSameDay] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  /** ページの中の地図のカード（画面の外なら右下に浮かせる） */
  const mapCardRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  /** ドラッグの始まりの更新を dragstart の外へ出す（未割当の列が足されて Chrome がドラッグをやめるため） */
  const dragStart = useRef(deferredDragStart()).current;
  const [dropTo, setDropTo] = useState<string | null>(null);
  /**
   * 表示（PRD D58・D63）：時間軸／順番／一覧（訪問の一覧の表）。localStorage でなく画面の状態（初期値：時間軸）
   */
  const [colView, setColView] = useState<'timeline' | 'order' | 'list'>('timeline');
  /** 狭い幅（900px 以下）・印刷では時間軸の代わりに順番にする（一覧はそのまま） */
  const narrowOrPrint = useNarrowOrPrint();
  const shownView = narrowOrPrint && colView === 'timeline' ? 'order' : colView;
  /** 右の欄（PRD D63）：'detail'＝詳しく、'tune'＝条件を調整する */
  const [panel, setPanel] = useState<'detail' | 'tune' | 'mail' | null>(null);
  /**
   * 地図は本体（時間軸・順番・一覧）の下に全幅で大きく置く（比較の画面と同じ。PRD D300）。画面の外にあるあいだは MapDock で
   * 右下に浮かせ、〈スタッフ〉・区間・訪問を選ぶと浮かせた地図が開く。広い画面は地図を高くする
   */
  const wideMap = useMediaLocal(WIDE_MAP_QUERY);
  /** 「入らなかった訪問」の列（帯の近道の行き先） */
  const noneColId = useId();
  const runRef = useRef<{ stop(): void } | null>(null);
  /** 「登録して、少し動かしてよい（案B）も作る」で、振り直したあとに案B を始める日（日付を変えたら null） */
  const pendingAnneal = useRef<string | null>(null);
  /**
   * 欠勤を登録して振り直したあと、差の欄へ移る（欄が閉じて今の案が出てから）。立てた日付。
   * 日付を変えたら・少し経っても今の案が出なければ下ろす（あとの手直しで急に移らない）
   */
  const pendingBarFocus = useRef<string | null>(null);
  /** 計算の世代。画面を離れると進め、前の世代の計算の結果は捨てる（開発時の StrictMode の付け外しでも） */
  const generation = useRef(0);
  /** 自動作成を試した日（同じ日に2回は試さない） */
  const autoTried = useRef(new Set<string>());
  /** プリセットを順に作っている途中（何番目か・名前）。null は順に作っていない */
  const [batch, setBatch] = useState<{
    date: string;
    index: number;
    total: number;
    name: string;
    presetId: string;
  } | null>(null);
  /** 順に作るのを「止める」で止めた */
  const batchStopped = useRef(false);
  /** いちばん新しいデータ（順に作るときの2つ目以降・終わりに、最新の条件・データで問題を作る） */
  const dataRef = useRef(data);
  dataRef.current = data;
  /** いちばん新しい点数の物差し（計算中の「いまの最良 N点」を基準の物差しで付け直す。ADR-0010） */
  const scoreRef = useRef({ problem: scoreProblem, scale: scoreScale });
  scoreRef.current = { problem: scoreProblem, scale: scoreScale };

  // 画面を離れたら Worker を止める（止めた結果は保存しない）
  useEffect(() => {
    setRunning(null);
    setRunningFor(null);
    progressStore.set(null);
    setBatch(null);
    return () => {
      generation.current++;
      runRef.current?.stop();
      runRef.current = null;
      autoTried.current.clear();
    };
    // progressStore は作り直さない（一度だけ）
  }, [progressStore]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 日付を変えたら開いた欄を閉じ、前の日のエラーを消す（訪問の入力欄は入力を捨てずに引き継ぐ。PRD D251）
  useEffect(() => {
    setSudden(null);
    setCancelFor(null);
    setContactsOpen(false);
    setPanel(null);
    setError(null);
    // 前の日に「案B も作る」を押して、まだ始まっていなければやめる（別の日で始めない）
    pendingAnneal.current = null;
  }, [date]);
  /** いま見ている日（計算が終わったときに、まだその日を見ているか） */
  const dateRef = useRef(date);
  dateRef.current = date;

  /** 計算に入れる訪問があるか（無い日は今の案の欄・列を出さない） */
  const hasVisits = visits.length > 0 && (!problem || problem.visits.length > 0);
  /** 今の案。保存してある案を、いまの訪問（取消・追加・編集・コピーのあと）に合わせて見せる */
  const aiPlan: AiPlan | undefined = useMemo(() => {
    const stored = own(data.aiPlans, date);
    if (!stored || !hasVisits) return undefined;
    return problem ? (attempt(() => alignPlan(problem, stored)).value ?? stored) : stored;
  }, [data.aiPlans, date, problem, hasVisits]);
  /** その日の記録（古い順） */
  const runs: AiRun[] = useMemo(() => own(data.aiRuns, date) ?? [], [data.aiRuns, date]);
  const runCount = runs.length;
  const routes = useMemo(() => aiPlan?.routes ?? {}, [aiPlan]);
  const pins = useMemo(() => aiPlan?.pins ?? {}, [aiPlan]);
  const pinCount = Object.keys(pins).length;
  /** 手直しの記憶（ADR-0043）を引く訪問と記憶（記憶が変わったときだけ作り直す。案のドラッグでは変わらない） */
  const prefInput = useMemo(
    () => ({ visits: data.visits, manualPrefs: data.manualPrefs }),
    [data.visits, data.manualPrefs],
  );
  const edited =
    !!aiPlan && (pinCount > 0 || JSON.stringify(aiPlan.routes) !== JSON.stringify(aiPlan.generated.routes));
  /** 固定していない手直しがある（固定を残して組み直すと消える。PR #39 のレビュー） */
  const unpinned = !!aiPlan && hasUnpinnedEdits(aiPlan.generated.routes, aiPlan.routes, aiPlan.pins);
  /**
   * 記録が今の案の元か（カードの「今の案」・カードを押したときの判定に共通）。今の案の元になった記録の id で
   * （無い古いデータは経路の一致で）。手直し中は今の案としない
   */
  const isCurrentRun = (run: AiRun | undefined): boolean =>
    !!run &&
    !!aiPlan &&
    !edited &&
    (aiPlan.runId ? aiPlan.runId === run.id : JSON.stringify(aiPlan.routes) === JSON.stringify(run.routes));

  // 採点はどれも点数の基準の物差し（ADR-0010）
  const curScore = useMemo(
    () => (scoreProblem && aiPlan ? attempt(() => score(scoreProblem, routes)) : null),
    [scoreProblem, aiPlan, routes],
  );
  const genScore = useMemo(
    () => (scoreProblem && aiPlan ? attempt(() => score(scoreProblem, aiPlan.generated.routes)) : null),
    [scoreProblem, aiPlan],
  );
  const genDiff = useMemo(
    () => (scoreProblem && aiPlan ? attempt(() => diff(scoreProblem, aiPlan.generated.routes, routes)) : null),
    [scoreProblem, aiPlan, routes],
  );
  const explained = useMemo(() => explainMap(aiPlan ? problem : null, routes), [problem, aiPlan, routes]);
  /** 今の案の条件ごとの達成の件数（D25。点数の基準の物差し。ADR-0010） */
  const curAch = useMemo(
    () => (scoreProblem && aiPlan ? (attempt(() => achievements(scoreProblem, routes)).value ?? []) : []),
    [scoreProblem, aiPlan, routes],
  );
  /** AI案を作った条件（重み・必須）と、この日だけ試す重みが違うか */
  const stale = !!aiPlan && JSON.stringify(aiPlan.rules) !== JSON.stringify(data.rules);
  /** この日だけ試す重みを書き換えずにプリセットで作った案（自動作成・カードから選んだ。作ったあとに変えたのではない） */
  const madeBy = stale && !!aiPlan && pinCount === 0 ? presetOf(aiPlan.rules, data.presets) : null;
  const autoMade = !!madeBy;

  const staffName = (id: string) => staffById.get(id)?.name ?? '（不明）';
  const clientOf = (visitId: string) => {
    const v = visitById.get(visitId);
    return v ? clientById.get(v.clientId) : undefined;
  };
  /**
   * 訪問の詳細の経路のリンク（PRD D100。ADR-0018）：担当の今の案の順番で、前の場所（前の訪問先、1件目は担当の自宅）から・今いる場所から。
   * 担当の決まっていない訪問は出さない。今の案が確定した割当と違う（confirmState='diff'）ときは「今の案（未確定）の順番」と添える
   */
  const routeLinksOf = (id: string, sid: string | null) => {
    const s = sid ? staffById.get(sid) : undefined;
    if (!s || !sid) return null;
    const order = own(routes, sid) ?? [];
    const i = order.indexOf(id);
    if (i < 0) return null;
    const prevClient = i > 0 ? clientOf(order[i - 1] ?? '') : undefined;
    return (
      <VisitRouteLinks
        to={clientOf(id)?.place}
        toName={clientOf(id)?.displayName ?? '（不明）'}
        from={i > 0 ? prevClient?.place : s.home}
        fromName={i > 0 ? (prevClient?.displayName ?? '（不明）') : HOME_LABEL}
        mode={s.travelMode}
        note={confirmState === 'diff' ? '今の案（未確定）の順番' : undefined}
      />
    );
  };
  const visitLabel = (id: string) =>
    `${visitById.get(id)?.earliestStart ?? ''} ${clientOf(id)?.displayName ?? '（不明）'}`;
  /** visitLabel と同じ見た目で、〈利用者さん〉の名前から詳細を開く（欠勤の人に残る訪問。PRD D206） */
  const visitNode = (id: string) => {
    const c = clientOf(id);
    return (
      <>
        {visitById.get(id)?.earliestStart ?? ''}{' '}
        {c ? <PersonButton kind="client" id={c.id} name={c.displayName} testId="left-client" /> : '（不明）'}
      </>
    );
  };

  // ---- 計算（AI案を作る・固定を残して組み直す）----
  /** 計算できるか（rules を渡すと、その条件で問題を作り直す） */
  const check = (rules?: Rule[], quiet = false): Problem | null => {
    setError(null);
    const fail = (msg: string) => {
      if (!quiet) setError(msg);
      return null;
    };
    const target = rules
      ? attempt(() => compile({ ...dataRef.current, rules }, date))
      : { value: problem, error: m.problemError };
    if (!target.value) return fail(target.error ?? '問題を作れませんでした');
    if (target.value.visits.length === 0) return fail('この日に計算できる訪問がありません');
    if (target.value.staff.length === 0) return fail(`この日に働ける${terms.staff}がいません`);
    return target.value;
  };
  /** 途中の最良は、解いている条件にかかわらず点数の基準の物差しで点数にする（ADR-0010） */
  const run = (
    kind: 'create' | 'resolve' | 'anneal',
    target: Problem,
    label: string,
    onDone: (r: SolveResult) => void,
    after?: () => void,
    initial?: Record<string, string[]>,
  ): boolean => {
    const gen = generation.current;
    const live = () => gen === generation.current;
    const started = attempt(() =>
      runSolve(
        target,
        { seed: dataRef.current.seed, iterations: defaultIterations(target), ...(initial ? { initial } : {}) },
        (p) => {
          if (!live()) return;
          const { problem: sp, scale: ss } = scoreRef.current;
          const best = p.bestRoutes;
          if (!best) {
            // 最良は前の進捗から変わっていない：点数は前のまま
            progressStore.set((prev) => ({ iteration: p.iteration, total: p.total, hundred: prev?.hundred ?? null }));
            return;
          }
          const hundred = sp && ss ? (attempt(() => toHundred(score(sp, best).total, ss)).value ?? null) : null;
          progressStore.set({ iteration: p.iteration, total: p.total, hundred });
        },
      ),
    );
    if (!started.value) {
      setError(started.error);
      return false;
    }
    runRef.current = started.value;
    setRunning(kind);
    setRunningFor({ date, label });
    progressStore.set(null);
    started.value.promise
      .then((result) => {
        if (live()) onDone(result);
      })
      .catch((e) => {
        if (live()) setError(`AI案を作れませんでした（${formError(e)}）`);
      })
      .finally(() => {
        if (!live()) return;
        runRef.current = null;
        setRunning(null);
        setRunningFor(null);
        progressStore.set(null);
        after?.();
      });
    return true;
  };
  const stop = () => {
    batchStopped.current = true;
    runRef.current?.stop();
  };
  /** 案B の計算だけを止める（順に作るのを止めた印 batchStopped は立てない） */
  const stopAnneal = () => {
    runRef.current?.stop();
  };

  /**
   * AI案を作る（固定なし。作ると generated と routes を同じにし、固定を空に）。作った案は記録に残す。
   * rules を渡すとその条件で作る。mode：'preset' は確認ずみ、'auto' は自動作成（失敗・終わりの表示を出さない）。
   * 手直し・固定を捨てる確認は呼ぶ側（recreate）でする（確認は待つので、ここは同期のままにして戻り値を自動作成が使う）。
   * 'auto' は今の案がまだ無いときだけ今の案にし、あれば記録に足すだけ。onMade は作れたとき（作った案）、
   * after は計算が終わったあと（成功・失敗とも。順に作る次へ）。計算を始めたら true
   */
  const create = (
    rules: Rule[] = planRules,
    mode: 'preset' | 'auto' = 'preset',
    opts: { after?: () => void; onMade?: (plan: AiPlan) => void } = {},
  ): boolean => {
    const auto = mode === 'auto';
    const base = check(rules, auto);
    if (!base) return false;
    // 手直しの記憶（ADR-0043）：記憶の担当がその日に可なら固定して解く（当てたものは記録の prefPins）
    const { problem: p, applied: prefPins } = withManualPrefs(base, dataRef.current);
    const forDate = date;
    const rulesSnapshot = rules;
    // 計算に使う問題のキー（記録に残し、同じ問題なら再計算を省く。ADR-0010）
    const inputKey = problemKey(p);
    const label = `${presetOf(rules, dataRef.current.presets)?.name ?? 'いま'}の`;
    return run(
      'create',
      p,
      label,
      (result) => {
        const plan: AiPlan = {
          date: forDate,
          createdAt: Date.now(),
          seed: result.seed,
          iterations: result.iterations,
          routes: result.routes,
          unassigned: result.unassigned,
          score: result.score,
          stopped: result.stopped,
          rules: rulesSnapshot,
          generated: { routes: result.routes, unassigned: result.unassigned, score: result.score },
          pins: {},
        };
        const x = { rules: rulesSnapshot, pins: {}, result, createdAt: plan.createdAt, inputKey, prefPins };
        // 今の案が替わるなら、手直しの記憶の確認・記憶だけの控えは終える（自動作成で今の案があれば替わらない）
        if (!auto || !own(dataRef.current.aiPlans, forDate)) endPrefAsk(forDate);
        update((d) => {
          const added = addRun(d, forDate, x);
          if (auto && own(d.aiPlans, forDate)) return added;
          // 今の案の元になった記録を覚える（カードの「今の案」の判定）
          const linked: AiPlan = { ...plan, runId: findRun(added, forDate, x)?.id };
          return { ...added, aiPlans: { ...added.aiPlans, [forDate]: linked } };
        });
        opts.onMade?.(plan);
        if (!auto && dateRef.current === forDate) sel.reset();
        if (!auto) toast(result.stopped ? '途中までの最良の案を保存しました' : 'AI案を作りました');
      },
      opts.after,
    );
  };

  /** 手直し・固定を捨てて AI案を作り直すときの確認（PRD D147） */
  const DISCARD_RECREATE = {
    title: '手直しとピンを捨てて、AI案を作り直しますか？',
    body: 'この日の手直しとピンは消えます。',
    confirmLabel: '捨てて作り直す',
    tone: 'danger',
  } as const;
  /** 「AI案を作る」（手で押したとき）：作れるか確かめ、手直し・固定があれば確認してから作る */
  const recreate = async (rules: Rule[] = planRules) => {
    if (!check(rules)) return;
    if (edited && !(await confirmDialog(DISCARD_RECREATE))) return;
    // 確認のあいだに計算が始まっていたら何もしない
    if (runRef.current) return;
    create(rules);
  };

  /**
   * プリセットを順に1つずつ作る（ADR-0008）。どれも記録に残す。2つ目以降も最新のデータ・条件で問題を作る。
   * 今の案が無い日に始めたときは、途中は最初に作れた案を見せ、終わったら一番点の高い（点数の基準の物差し。ADR-0010。
   * 同点なら先のプリセット）案を今の案にする（その間に手直し・別の案にしていなければ）。
   * 「止める」で今の1つを途中の最良で残し、残りはやめる。その日の条件は書き換えない
   */
  const runBatch = (list: readonly Preset[]) => {
    const forDate = date;
    const ids = list.map((pr) => pr.id);
    const choose = !own(dataRef.current.aiPlans, forDate);
    batchStopped.current = false;
    const made: { order: number; plan: AiPlan }[] = [];
    const finish = () => {
      setBatch(null);
      if (made.length > 0)
        toast(
          batchStopped.current
            ? `途中で止めました（${made.length}つ作りました）`
            : `プリセット${made.length}つの案を作りました`,
        );
      if (!choose || made.length === 0) return;
      // 一番点の高い案を今の案にする（点数の基準の物差し。カードの王冠と同じ。ADR-0010）
      const latest = dataRef.current;
      const prob = attempt(() => compile({ ...latest, rules: scoreRulesOf(latest) }, forDate)).value;
      const sc = prob ? attempt(() => normalize(prob)).value : null;
      if (!prob || !sc) return;
      let best = made[0]!;
      let bestPoint = -1;
      for (const x of made) {
        const pt = toHundred(score(prob, x.plan.routes).total, sc);
        if (pt > bestPoint) {
          bestPoint = pt;
          best = x;
        }
      }
      const first = made[0]!.plan;
      update((d) => {
        const cur = own(d.aiPlans, forDate);
        // 途中で見せていた案のまま（手直し・別の案にしていない）ときだけ入れ替える
        if (!cur || cur.createdAt !== first.createdAt || Object.keys(cur.pins).length > 0) return d;
        if (JSON.stringify(cur.routes) !== JSON.stringify(cur.generated.routes)) return d;
        const run = findRun(d, forDate, {
          rules: best.plan.rules,
          pins: {},
          result: { ...best.plan, routes: best.plan.generated.routes },
        });
        return { ...d, aiPlans: { ...d.aiPlans, [forDate]: { ...best.plan, runId: run?.id } } };
      });
      if (dateRef.current === forDate) sel.reset();
    };
    const step = (i: number) => {
      if (i >= ids.length || batchStopped.current) {
        finish();
        return;
      }
      // 最新のプリセット・条件で（途中で編集・消したプリセットは、その時点の中身・飛ばす）
      const pr = dataRef.current.presets.find((x) => x.id === ids[i]);
      if (!pr) {
        step(i + 1);
        return;
      }
      setBatch({ date: forDate, index: i, total: ids.length, name: pr.name, presetId: pr.id });
      const started = create(applyPreset(dataRef.current.rules, pr), 'auto', {
        onMade: (plan) => made.push({ order: i, plan }),
        after: () => step(i + 1),
      });
      if (!started) step(i + 1);
    };
    step(0);
  };

  /**
   * プリセットごとの案のカードを押した（ADR-0010）：その日の条件をプリセットの重みにして、その案を今の案にする。
   * 同じ条件・同じデータで作った記録がその日にあれば計算せずにその記録を今の案にし（lib/runs の reusableRun）、
   * 無ければその条件で計算して作る。作り直したいときは「AI案を作る」
   */
  const runPreset = async (preset: Preset) => {
    const rules = applyPreset(data.rules, preset);
    // 作れない日（訪問が無いなど）は条件も変えない
    const checked = check(rules);
    if (!checked) return;
    // 記憶（ADR-0043）を当てた問題で探す（記憶が変われば使い回さない）
    const target = withManualPrefs(checked, data).problem;
    const saved = attempt(() => reusableRun(runs, target, rules, data.seed)).value;
    if (saved) {
      if (isCurrentRun(saved)) {
        // すでにその案が今の案：条件だけ合わせる
        update((d) => ({ ...d, rules: applyPreset(d.rules, preset) }));
        return;
      }
      if (
        edited &&
        !(await confirmDialog({
          title: `手直しとピンを捨てて、${preset.name}の案を今の案にしますか？`,
          body: '作ってある案に切り替えます。この日の手直しとピンは消えます。',
          confirmLabel: '捨てて今の案にする',
          tone: 'danger',
        }))
      )
        return;
      update((d) => ({
        ...d,
        rules: applyPreset(d.rules, preset),
        aiPlans: { ...d.aiPlans, [date]: planOfRun(saved) },
      }));
      endPrefAsk(date);
      sel.reset();
      toast(`${preset.name}の案を今の案にしました`);
      return;
    }
    if (edited && !(await confirmDialog(DISCARD_RECREATE))) return;
    if (runRef.current) return;
    update((d) => ({ ...d, rules: applyPreset(d.rules, preset) }));
    create(rules, 'preset');
  };

  // ---- 設定の画面の帯の［今日の案を日の予定の重みで作り直す］（?date=…&do=recreate。PRD D166・D234）----
  // その日を選び、URL から ?date= と ?do= を消し、問題ができたら「AI にもう一度作らせる」（recreate。手直しがあれば今どおり確認）。
  // その日の自動作成（基準のプリセット）はしない（この日だけ試す重みで作るため）
  const [params, setParams] = useSearchParams();
  const pendingRecreate = useRef<string | null>(null);
  const doParam = params.get('do');
  /** ?do=absence で開く日（日付を切り替えたあとに開く。日付を変えると欄を閉じる effect より後で開くため）と、`&staff=` の人 */
  const pendingSudden = useRef<string | null>(null);
  const pendingSuddenStaff = useRef<string | null>(null);
  // ホームの「急な欠勤・キャンセルを登録」（?date=今日&do=absence。PRD D172）：その日を選び、「欠勤・キャンセル」の欄を1段目で開き、
  // URL から ?date= と ?do= を消す（1回だけ。戻るで繰り返さない）。自動作成は今どおり（案ができるまで振り直しは押せない）
  // biome-ignore lint/correctness/useExhaustiveDependencies: ?do= が付いたときだけ
  useEffect(() => {
    if (doParam !== SUDDEN_DO) return;
    const raw = params.get('date');
    const target = raw && isDate(raw) ? raw : date;
    if (target !== date) setDate(target);
    pendingSudden.current = target;
    // 稼働時間の右の欄から（PRD D203）：`&staff=` の人の欠勤（2段目）で開く。知らない人・その日に働かない人なら1段目
    const sid = params.get('staff');
    pendingSuddenStaff.current = sid && data.staff.some((s) => s.id === sid) ? sid : null;
    setParams(
      (p) => {
        p.delete('do');
        p.delete('date');
        p.delete('staff');
        return p;
      },
      { replace: true },
    );
  }, [doParam]);
  useEffect(() => {
    if (pendingSudden.current === null || pendingSudden.current !== date) return;
    pendingSudden.current = null;
    const sid = pendingSuddenStaff.current;
    pendingSuddenStaff.current = null;
    // その日に働く人（稼働時間帯がある＝「休む人」の選択肢 staffChoices に出る人）のときだけ2段目。
    // 休みの日・最終勤務日の後の人は選択肢に無く2段目が壊れるので1段目（PR #48 のレビュー）
    const works = !!sid && (slotsOf.get(sid)?.baseSlots.length ?? 0) > 0;
    openSudden(works ? { kind: 'staff', staffId: sid } : {});
  });
  // ?date= だけのリンク（空き状況の「その日の案を見る」。新しいタブでも開ける。PRD D204）：その日を選び、?date= を消す。
  // ?do= があるときはそれぞれの effect が読む
  const dateParam = params.get('date');
  // biome-ignore lint/correctness/useExhaustiveDependencies: ?date= が付いたときだけ
  useEffect(() => {
    if (dateParam === null || doParam !== null) return;
    if (isDate(dateParam) && dateParam !== date) setDate(dateParam);
    setParams(
      (p) => {
        p.delete('date');
        return p;
      },
      { replace: true },
    );
  }, [dateParam]);
  // 月の要対応の「入らない訪問」から（?date=…&do=unassigned。PRD D201）：その日を選び、URL から ?date= と ?do= を消し、
  // 案ができたら「入らなかった訪問」の列へ巻く（帯の「見る」と同じ。1回だけ。入らない訪問が無くなっていれば巻かない）
  /**
   * ?do=unassigned を受けた日。arrived：その日に着いた、auto：着いてから自動作成を始めた、busy：作っている途中を見た
   * （自動作成を始めた直後は running・batch がまだ立っていないので、立つまで待つ）
   */
  const pendingNone = useRef<{ date: string; arrived: boolean; auto: boolean; busy: boolean } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: ?do= が付いたときだけ
  useEffect(() => {
    if (doParam !== UNASSIGNED_DO) return;
    const raw = params.get('date');
    const target = raw && isDate(raw) ? raw : date;
    if (target !== date) setDate(target);
    pendingNone.current = { date: target, arrived: false, auto: false, busy: false };
    setParams(
      (p) => {
        p.delete('do');
        p.delete('date');
        return p;
      },
      { replace: true },
    );
  }, [doParam]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: ?do= が付いたときだけ
  useEffect(() => {
    if (doParam !== 'recreate') return;
    const raw = params.get('date');
    const target = raw && isDate(raw) ? raw : date;
    pendingRecreate.current = target;
    autoTried.current.add(target);
    if (target !== date) setDate(target);
    setParams(
      (p) => {
        p.delete('do');
        p.delete('date');
        return p;
      },
      { replace: true },
    );
  }, [doParam]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 選んだ日の問題ができたときだけ
  useEffect(() => {
    if (pendingRecreate.current === null || pendingRecreate.current !== date || !problem || running) return;
    pendingRecreate.current = null;
    void recreate();
  }, [date, problem, running]);

  // AI案が無い日は、開いたときに点数の基準のプリセット（scorePresetId）の案だけを自動で作る（同じ日に2回は試さない。
  // D52。ADR-0012 追記）。他のプリセットはカードか「まだ作っていない考え方をまとめて作る」で作る
  // biome-ignore lint/correctness/useExhaustiveDependencies: 日付・案の有無・問題が変わったときだけ
  useEffect(() => {
    // 訪問が無い日は試したことにしない（あとで訪問を足す・コピーしたら作る）
    // ?do=recreate を受けている間は、どの日の自動作成も始めない（日付を切り替えてから作り直す。PR #40 の再レビュー）
    if (pendingRecreate.current !== null) return;
    if (aiPlan || running || batch || !problem || problem.visits.length === 0 || autoTried.current.has(date)) return;
    autoTried.current.add(date);
    // ?do=unassigned を待っている日なら、自動作成が終わるまで待つ印（PR #48 のレビュー）
    // （ほかの日の作成が終わるのを待っていた間の busy は数えない）
    if (pendingNone.current?.date === date) {
      pendingNone.current.auto = true;
      pendingNone.current.busy = false;
    }
    const base = scorePresetOf(data.presets, data.scorePresetId);
    runBatch(base ? [base] : []);
  }, [date, aiPlan, problem, running]);

  // ---- プリセットごとの案のカード（ADR-0008）。点数はどれも点数の基準の物差し（ADR-0010） ----
  /**
   * プリセットごとの、いまのデータで作る問題のキー（カードを押したときに再計算せずに使える記録を探す。ADR-0010）。
   * compile が読むデータ（compileInput）とプリセットだけに依存し、案のドラッグ・固定では作り直さない
   */
  const presetKeys = useMemo(
    () =>
      data.presets.map((pr) => {
        const rules = applyPreset(compileInput.rules, pr);
        const p =
          problem && JSON.stringify(rules) === JSON.stringify(compileInput.rules)
            ? problem
            : attempt(() => compile({ ...compileInput, rules }, date)).value;
        // 再計算を省く記録は、手直しの記憶（ADR-0043）を当てた問題で探す。problem（記憶なし）は「条件が変わった」に使う
        const solve = p ? withManualPrefs(p, prefInput).problem : null;
        return { rules, problem: p ?? null, solve, key: solve ? problemKey(solve) : null };
      }),
    [data.presets, compileInput, problem, date, prefInput],
  );
  const presetCards = useMemo(
    () =>
      data.presets.map((pr, i) => {
        const k = presetKeys[i];
        // いまのデータでそのまま使える記録（押しても再計算しない）を優先する
        const kp = k?.solve;
        const kk = k?.key;
        const reusable = k && kp && kk ? attempt(() => reusableRun(runs, kp, k.rules, data.seed, kk)).value : undefined;
        // 無ければ、固定なしで重み・必須がこのプリセットと一致する最新の記録（押すと作り直す＝点が変わりうる）
        const run =
          reusable ?? [...runs].reverse().find((r) => Object.keys(r.pins).length === 0 && matchesPreset(r.rules, pr));
        const sc = run && scoreProblem ? (attempt(() => score(scoreProblem, run.routes)).value ?? null) : null;
        const ach: RuleAchievement[] =
          run && scoreProblem ? (attempt(() => achievements(scoreProblem, run.routes)).value ?? []) : [];
        return {
          preset: pr,
          run,
          /** 記録はあるが、いまのデータでは使えない（押すと作り直す） */
          remake: !!run && !reusable,
          score: sc,
          hundred: sc && scoreScale ? toHundred(sc.total, scoreScale) : null,
          ach,
        };
      }),
    [data.presets, data.seed, presetKeys, runs, scoreProblem, scoreScale],
  );
  const bestCard = presetCards.reduce<number>(
    // 0点のカードには王冠を付けない
    (best, c, i) =>
      c.hundred !== null && c.hundred > 0 && (best < 0 || c.hundred > presetCards[best]!.hundred!) ? i : best,
    -1,
  );
  const missing = presetCards.filter((c) => !c.run).map((c) => c.preset);
  /** 点数の基準のプリセットの ID（条件の重みとプリセットを切っているとき、メニューに出すのはこの1枚だけ） */
  const basePresetId = scorePresetOf(data.presets, data.scorePresetId)?.id;
  /**
   * （D43）今の案の元の記録を作ったあとに、訪問・〈スタッフ〉・稼働時間・条件が変わったか：記録の inputKey と、
   * いまのデータに記録の条件（と固定）を当てた問題のキーが違う。作った問題はプリセットのカードのものを使い回す
   */
  const planIsStale = useMemo(() => {
    if (!aiPlan) return false;
    // 作った条件（重み・必須）がこの日だけ試す重みにもどのプリセットにも無い（PRD D161。月・ホーム・帯と同じ lib/month の rulesStale）
    if (rulesStale(data, date, currentRuleKeys(data.rules, data.presets))) return true;
    return planStale(compileInput, data, date, (rules, pins) => {
      if (Object.keys(pins).length > 0) return undefined;
      const key = JSON.stringify(rules);
      if (problem && key === JSON.stringify(compileInput.rules)) return problem;
      return presetKeys.find((k) => JSON.stringify(k.rules) === key)?.problem ?? undefined;
    });
  }, [aiPlan, compileInput, data, date, problem, presetKeys]);
  /**
   * （D43）作り直す：月の「条件が変わった日を作り直す」と同じく点数の基準のプリセットの重みで作る（手直し・固定があれば確認）。古い記録の条件では作らない（作った条件がもう無いときに「条件が変わった」が消えないため。PR #40 のレビュー）。
   * プリセットが無い（ありえない）ときはこの日だけ試す重みで作る
   */
  const remakeStale = () => {
    // 月の作り直しと同じく、この日だけ試す重み（data.rules）は書き換えず、基準のプリセットの重みで解くだけ（runPreset はこの日だけ試す重みを
    // プリセットの重みに書き換え、この日だけ試す重みで作ったほかの日が「条件が変わった」になるため使わない。PR #40 の再レビュー）
    // 点数の基準（条件の重みの画面の重み。ADR-0035）で作る
    void recreate(scoreRulesOf(data));
  };
  /**
   * 固定を残して組み直す（generated は変えない。固定は残す）。固定していない手直し（「入らなかった訪問」へ移した・
   * 固定を外した）は消えるので、あれば確かめる（PR #39 のレビュー）
   */
  const resolve = async () => {
    if (!check(rulesOn ? undefined : planRules) || !aiPlan) return;
    if (
      unpinned &&
      !(await confirmDialog({
        title: 'ピンの無い手直しを捨てて、作り直しますか？',
        body: 'ピンの付いた訪問の担当は残し、ほかを組み直します。「入らなかった訪問」へ移した訪問と、ピンを外した訪問の手直しは消えます。',
        confirmLabel: '捨てて作り直す',
        tone: 'danger',
      }))
    )
      return;
    // 確認のあいだに計算が始まっていたら何もしない
    if (runRef.current) return;
    const p = check(rulesOn ? undefined : planRules);
    if (!p || !aiPlan) return;
    const forDate = date;
    const compiled = attempt(() => compile({ ...data, rules: planRules }, forDate, aiPlan.pins));
    if (!compiled.value) {
      setError(compiled.error);
      return;
    }
    // 手直しの記憶（ADR-0043）：固定の無い訪問だけに当てる（固定が先）
    const { problem: pinned, applied: prefPins } = withManualPrefs(compiled.value, data, aiPlan.pins);
    const rulesSnapshot = planRules;
    const pinsSnapshot = aiPlan.pins;
    const inputKey = problemKey(pinned);
    run('resolve', pinned, `${presetOf(planRules, data.presets)?.name ?? 'いま'}の`, (result) => {
      const x = { rules: rulesSnapshot, pins: pinsSnapshot, result, createdAt: Date.now(), inputKey, prefPins };
      update((d) => {
        const added = addRun(
          patchPlan(d, forDate, p, (plan) => ({
            ...withRoutes(p, plan, result.routes),
            stopped: result.stopped,
            rules: rulesSnapshot,
          })),
          forDate,
          x,
        );
        const runId = findRun(added, forDate, x)?.id;
        return patchPlan(added, forDate, null, (plan) => ({ ...plan, runId }));
      });
      endPrefAsk(forDate);
      if (dateRef.current === forDate) sel.reset();
      toast(result.stopped ? '途中までの最良の案で組み直しました' : 'ピンを残して組み直しました');
    });
  };

  // ---- 手直し：訪問を担当へ移す（最も費用の少ない位置に入れて固定）----
  const allowedFor = (visitId: string, staffId: string): boolean => {
    if (!problem) return true;
    const vi = problem.visits.findIndex((v) => v.id === visitId);
    const si = problem.staff.findIndex((s) => s.id === staffId);
    if (vi < 0) return true;
    return si >= 0 && problem.allowed[vi]?.[si] === true;
  };
  const owner = useMemo(() => ownerMap(routes), [routes]);
  /** 週間の帯から開いたときに選ぶ訪問（ADR-0012 追記の段階2。今の案が出たら1回だけ選んで見える所へ） */
  const wantVisit = useRef<string | null>((location.state as { visitId?: string } | null)?.visitId ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 今の案が出たときに1回だけ
  useEffect(() => {
    const id = wantVisit.current;
    if (!id || !aiPlan) return;
    wantVisit.current = null;
    if (owner.has(id)) sel.togglePick({ id, set: PLAN_SET });
    requestAnimationFrame(() =>
      document.querySelector(`[data-visit="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' }),
    );
  }, [aiPlan, owner]);
  /**
   * 手直しの1手前（PRD D218。ADR-0030）：手直し（担当を移す・入らなかった訪問へ・候補の人に入れる・固定を外す）の前の routes・pins。
   * 画面の状態だけ（保存しない）。戻せるのは直前の1手だけ。今の案がほかの操作で変わった・確定したら戻さない（lib/undoEdit）
   */
  const [undoSnap, setUndoSnap] = useState<UndoSnap | null>(null);
  /** 今の案の routes・pins（手直しの前の形） */
  const editState: EditState | null = useMemo(
    () => (aiPlan ? { routes: aiPlan.routes, pins: aiPlan.pins } : null),
    [aiPlan],
  );
  /** 確定した割当のキー（手直しのあとに確定したら戻さない） */
  const savedKey = useMemo(() => confirmedKey(own(data.manualPlans, date)), [data.manualPlans, date]);
  /** 戻せない理由（戻せれば null）。操作の行の title とトーストで共通 */
  const undoWhy = useMemo(() => {
    // 記憶だけ・ほかの日をまとめて変えただけの控え（ADR-0043）は、日の手直しの控えが無くても戻せる
    const extra = !!undoSnap && ((undoSnap.prefs?.length ?? 0) > 0 || (undoSnap.others?.length ?? 0) > 0);
    const why =
      undoSnap?.snap || !extra
        ? undoBlockReason(undoSnap?.snap ?? null, date, editState, savedKey, !!running)
        : running
          ? '計算中です'
          : undoSnap?.date !== date
            ? '別の日の手直しです'
            : null;
    if (why !== null) return why;
    // まとめて変えたほかの日の今の案が、そのあとに変わっていたら戻さない
    if (undoSnap?.others?.some((o) => !samePlanEdit(own(data.aiPlans, o.date), o.after))) {
      return 'ほかの日の案が変わりました';
    }
    return null;
  }, [undoSnap, date, editState, savedKey, running, data.aiPlans]);
  const undoable = undoWhy === null;

  // ---- 手直しの記憶（PRD D260〜D262。ADR-0043）：手で担当を変えたら、次からもこの人にするかを帯で聞く ----
  /** 聞いている訪問（この日の手で変えたもの。from は最初に変える前の担当。答えなければ記憶しない＝今回だけ） */
  const [prefAsk, setPrefAsk] = useState<{ date: string; items: PrefAskItem[] } | null>(null);
  /** 「次からも」を選んだあとの、来週以降のすでに割り当てた同じキーの訪問 */
  const [prefBulk, setPrefBulk] = useState<{ date: string; list: FutureAssigned[] } | null>(null);
  /** まとめて変えられなかった日の知らせ */
  const [prefBulkNote, setPrefBulkNote] = useState<{ date: string; text: string } | null>(null);
  // 日を移ったら聞くのをやめる（戻っても前の帯を出さない。最初の担当の判定も持ち越さない）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 日付が変わったときだけ
  useEffect(() => {
    setPrefAsk(null);
    setPrefBulk(null);
    setPrefBulkNote(null);
  }, [date]);
  /**
   * 作る・組み直すの計算が終わったら（forDate の日）：聞いている手直しはもう今の案に無いので聞くのをやめ、
   * 記憶だけの「元に戻す」の控え（日の手直しの控えが無いもの）も捨てる（作り直した案と別に戻すと食い違うため）
   */
  const endPrefAsk = (forDate: string) => {
    setPrefAsk((cur) => (cur?.date === forDate ? null : cur));
    setPrefBulk((cur) => (cur?.date === forDate ? null : cur));
    setUndoSnap((u) => (u && !u.snap && u.date === forDate ? null : u));
  };
  /**
   * 記憶・まとめて変えた分を足す先の控え：今の控えが戻せる（undoWhy が null）ならそれに足し、戻せないなら日の手直しの控えを捨てて
   * 記憶・まとめて変えた分だけの新しい控えにする（「元に戻す」で記憶・来週分が確実に戻る）
   */
  const extendUndo = (extra: Pick<UndoSnap, 'prefs' | 'others'>) => {
    const base: UndoSnap =
      undoSnap && undoSnap.date === date && undoWhy === null
        ? undoSnap
        : { date, snap: null, visitId: null, from: null };
    setUndoSnap({
      ...base,
      ...(extra.prefs ? { prefs: [...(base.prefs ?? []), ...extra.prefs] } : {}),
      ...(extra.others ? { others: [...(base.others ?? []), ...extra.others] } : {}),
    });
  };
  /**
   * 手で担当を変えた（staffId）・外した（null）ことを覚える。最初の担当に戻した・記憶と同じ担当にしたなら聞かない
   */
  const noteManual = (visitId: string, staffId: string | null) => {
    const v = visitById.get(visitId);
    const mem = v ? own(data.manualPrefs, prefKey(v)) : undefined;
    const before = owner.get(visitId) ?? null;
    setPrefAsk((cur) => {
      const items = cur && cur.date === date ? cur.items : [];
      const prev = items.find((x) => x.visitId === visitId);
      const from = prev ? prev.from : before;
      const rest = items.filter((x) => x.visitId !== visitId);
      const keep = rest.length > 0 ? { date, items: rest } : null;
      if (staffId === null || staffId === from || mem?.staffId === staffId) return keep;
      return { date, items: [...rest, { visitId, staffId, from }] };
    });
  };
  /** 帯に出す訪問（いまもその担当に固定しているものだけ。作り直す・固定を外すなどで変わったものは聞かない） */
  const askItems = useMemo(
    () => (prefAsk && prefAsk.date === date ? prefAsk.items.filter((x) => own(pins, x.visitId) === x.staffId) : []),
    [prefAsk, date, pins],
  );
  const askRows = askItems.map((x) => {
    const v = visitById.get(x.visitId);
    return {
      visitId: x.visitId,
      when: v ? prefWhenText(v) : '',
      client: clientOf(x.visitId)?.displayName ?? '（不明）',
      staff: staffName(x.staffId),
    };
  });
  /** ［次からもこの人にする］：記憶に書き（「元に戻す」で戻せるよう控えに足す）、来週以降の割当済みがあれば続けて聞く */
  const rememberAsked = () => {
    if (askItems.length === 0) return;
    const set = Object.fromEntries(askItems.map((x) => [x.visitId, x.staffId]));
    const entries = askItems.flatMap((x) => {
      const v = visitById.get(x.visitId);
      if (!v) return [];
      const key = prefKey(v);
      return [{ key, before: own(data.manualPrefs, key) ?? null }];
    });
    update((d) => patchManualPrefs(d, { set }, Date.now()));
    extendUndo({ prefs: entries });
    setPrefAsk(null);
    setPrefBulkNote(null);
    const list = futureAssigned(dataRef.current, set, jstDate(Date.now()));
    if (list.length > 0) {
      setPrefBulk({ date, list });
    } else {
      setPrefBulk(null);
      toast('次からも同じ担当にします', { action: undoAction });
    }
  };
  /** ［まとめて変える］：来週以降の今の案で担当を差し替えて固定（変えられない日は知らせる）。「元に戻す」で全部戻る */
  const changeFuture = () => {
    if (!prefBulk || running) return;
    const base = dataRef.current;
    const r = applyFutureAssigned(base, prefBulk.list);
    update((d) => (d === base ? r.data : applyFutureAssigned(d, prefBulk.list).data));
    const others = Object.entries(r.before).map(([d, before]) => ({ date: d, before, after: r.data.aiPlans[d]! }));
    if (others.length > 0) extendUndo({ others });
    setPrefBulk(null);
    const failText = r.failed.map((x) => `${dateText(x.date)} ${clientOf(x.visitId)?.displayName ?? ''}様（${x.why}）`);
    setPrefBulkNote(
      r.failed.length > 0
        ? { date, text: `変えられなかった日が ${r.failed.length}件あります：${failText.join('、')}` }
        : null,
    );
    toast(
      r.changed.length > 0 ? `来週以降の ${r.changed.length}件を変えました` : '変えられる日がありませんでした',
      others.length > 0 ? { action: undoAction } : undefined,
    );
  };
  /** 来週以降の帯の文：変える先（1人ならその人、何人かなら「それぞれの担当」） */
  const bulkTo = [...new Set((prefBulk?.list ?? []).map((x) => x.to))];
  const bulkStaff = bulkTo.length === 1 ? `${staffName(bulkTo[0]!)}さん` : 'それぞれの担当';
  /**
   * 今の案で手直しの記憶で固定した訪問（ADR-0043）：今の案の元の記録の prefPins のうち、いまもその担当で、手直しの固定でないもの。
   * 訪問ID → 担当ID
   */
  const remembered = useMemo(() => {
    const run = aiPlan?.runId ? runs.find((r) => r.id === aiPlan.runId) : undefined;
    const out = new Map<string, string>();
    for (const [vid, sid] of Object.entries(run?.prefPins ?? {})) {
      if (owner.get(vid) === sid && !own(pins, vid)) out.set(vid, sid);
    }
    return out;
  }, [aiPlan, runs, owner, pins]);
  /**
   * 手直しを書く：手直しの前の形を控え（after と同じなら控えない）、after を今の案に書く（after は呼ぶ側で1回だけ計算する）。
   * 控えたら true
   */
  const applyEdit = (p: Problem, visitId: string, after: EditState, forget?: string): boolean => {
    const snap = editState ? takeSnapshot(date, editState, after, savedKey) : null;
    // 手で固定を外した（forget＝外した担当）：その訪問のキーの記憶がその担当なら消す（ADR-0043。「元に戻す」で戻す）
    const v = visitById.get(visitId);
    const key = v ? prefKey(v) : null;
    const memBefore = key ? (own(data.manualPrefs, key) ?? null) : null;
    const forgets = forget !== undefined && key !== null && memBefore?.staffId === forget;
    setUndoSnap(
      snap
        ? {
            date,
            snap,
            visitId,
            from: owner.get(visitId) ?? null,
            ...(forgets && key ? { prefs: [{ key, before: memBefore }] } : {}),
          }
        : null,
    );
    update((d) => {
      const x = patchPlan(d, date, p, (plan) => ({ ...withRoutes(p, plan, after.routes), pins: after.pins }));
      return forgets && forget ? patchManualPrefs(x, { clear: { [visitId]: forget } }, 0) : x;
    });
    return !!snap;
  };
  /**
   * 「担当を変える ▾」で移したあとのフォーカス（PRD D217）：選んだ項目・ボタンは移した訪問の詳細ごと消える（列が替わる・
   * 選択が外れる）ので、移した先のカード、無ければ「元に戻す」、それも無ければ移した先の列の見出しへ
   */
  const focusAfterMove = (visitId: string, staffId: string | null) => {
    requestAnimationFrame(() => {
      const v = CSS.escape(visitId);
      const target =
        document.querySelector<HTMLElement>(
          `.route-item[data-visit="${v}"] .route-btn, .tl-band[data-visit="${v}"] .tl-band-btn`,
        ) ??
        document.querySelector<HTMLElement>('[data-testid="plan-reassign-undo"]') ??
        (staffId ? colHeadOf(staffId) : null);
      target?.focus();
    });
  };
  /**
   * 訪問の詳細の欄を開く（PRD D301。null は新しい訪問をこの日に）。閉じたあとのフォーカスは開いた帯・カード（保存で作り直した回は
   * 新しい ID の帯）、無ければ一覧の行の「開く」、それも無ければ開く前の要素
   */
  const openVisit = (id: string | null) =>
    openVisitPanel({
      ...(id ? { visitId: id } : { newVisit: { date } }),
      returnFocus: (vid) => {
        const v = vid ? CSS.escape(vid) : null;
        const el = v
          ? document.querySelector<HTMLElement>(
              `.tl-band[data-visit="${v}"] .tl-band-btn, .route-item[data-visit="${v}"] .route-btn, [data-testid="visit-row-open"][data-visit="${v}"]`,
            )
          : null;
        // 「その他 ▾」から足したときは、閉じた一覧の項目の代わりに「その他」のボタンへ
        return el ?? (id ? null : document.querySelector<HTMLElement>('[data-testid="plan-more"]'));
      },
    });
  /** 帯・カードの詳細の「詳細・変更」（訪問の詳細の欄を開く） */
  const openOf = (id: string) => (
    <button
      type="button"
      className="btn btn-small"
      onClick={() => openVisit(id)}
      title="日時・担当・取り消しを変える欄を開く"
      data-testid="visit-open"
    >
      <WithIcon icon={PanelRightOpen} size={14}>
        詳細・変更
      </WithIcon>
    </button>
  );
  /** トーストの「元に戻す」（PRD D218）。トーストは前の描画の関数を持つので、押したときの最新の undoEdit を呼ぶ */
  const undoRef = useRef<() => void>(() => {});
  const undoAction = { label: '元に戻す', onClick: () => undoRef.current(), testId: 'plan-reassign-toast-undo' };
  const moveTo = (visitId: string, staffId: string) => {
    if (!problem || !aiPlan || running) return;
    if (owner.get(visitId) === staffId && own(pins, visitId) === staffId) return;
    const p = problem;
    const saved = applyEdit(p, visitId, {
      routes: owner.get(visitId) === staffId ? aiPlan.routes : bestInsertion(p, aiPlan.routes, visitId, staffId),
      pins: { ...aiPlan.pins, [visitId]: staffId },
    });
    // 次からもこの人にするかを帯で聞く（PRD D261。答えなければ記憶しない）。必須の条件に合わない人へ移したときは聞かない
    // （記憶しても次の案では当てられない）。聞いていた分は外す
    noteManual(visitId, allowedFor(visitId, staffId) ? staffId : null);
    // 移した訪問を選んでいたら、地図の絞り込みを新しい担当に合わせる
    sel.follow(visitId, staffId);
    const opts = saved ? { action: undoAction } : undefined;
    if (!allowedFor(visitId, staffId)) {
      toast(`${staffName(staffId)}さんへ移しました。必須の条件に合わないので、作り直すとこの訪問は入りません`, opts);
    } else {
      toast(`${staffName(staffId)}さんへ移しました`, opts);
    }
  };
  /** 未割当へ移す（列から外して「入らなかった訪問」へ。固定は担当の固定なので外す） */
  const unassign = (visitId: string) => {
    if (!problem || !aiPlan || running || !owner.has(visitId)) return;
    const { [visitId]: had, ...rest } = aiPlan.pins;
    const saved = applyEdit(
      problem,
      visitId,
      {
        routes: Object.fromEntries(
          Object.entries(aiPlan.routes).map(([s, ids]) => [s, ids.filter((x) => x !== visitId)]),
        ),
        pins: rest,
      },
      had,
    );
    sel.follow(visitId, null);
    toast('入らなかった訪問へ移しました', saved ? { action: undoAction } : undefined);
  };
  const unpin = (visitId: string) => {
    if (problem && aiPlan) {
      const { [visitId]: had, ...rest } = aiPlan.pins;
      applyEdit(problem, visitId, { routes: aiPlan.routes, pins: rest }, had);
      return;
    }
    update((d) =>
      patchPlan(d, date, problem, (plan) => {
        const { [visitId]: _, ...rest } = plan.pins;
        return { ...plan, pins: rest };
      }),
    );
  };
  /**
   * 直前の手直しを1手だけ戻す（routes と固定を控えのとおりに。控えは消す＝2手前へは戻れない）。
   * 戻せないときは理由をトーストで（トーストの「元に戻す」は押すと閉じるので、黙って消えないように）
   */
  const undoEdit = () => {
    const why = runRef.current ? '計算中です' : undoWhy;
    const u = undoSnap;
    if (why !== null || !problem || !u) {
      toast(`戻せません：${why ?? '戻せる手直しがありません'}`);
      return;
    }
    const back = u.snap ? undoState(u.snap) : null;
    const p = problem;
    const ae = document.activeElement;
    const fromToast = !ae || ae === document.body || !!ae.closest('.toast');
    // 日の手直し・手直しの記憶・まとめて変えたほかの日（ADR-0043）を1手として戻す
    update((d) => {
      const x = back ? patchPlan(d, date, p, (plan) => ({ ...withRoutes(p, plan, back.routes), pins: back.pins })) : d;
      return undoPrefExtras(x, u);
    });
    if (u.visitId) {
      sel.follow(u.visitId, u.from);
      // 戻した手直しは聞かない（戻した先を手で選んだのではない）
      const vid = u.visitId;
      setPrefAsk((cur) => {
        const rest = cur?.items.filter((x) => x.visitId !== vid) ?? [];
        return cur && rest.length > 0 ? { ...cur, items: rest } : null;
      });
    }
    setUndoSnap(null);
    setPrefBulk(null);
    toast('元に戻しました');
    // トーストのボタンは押すと消えるので、戻した訪問のカードへ（操作の行から押したときはそのまま）
    if (fromToast && u.visitId) focusAfterMove(u.visitId, u.from);
  };
  useEffect(() => {
    undoRef.current = undoEdit;
  });

  /** AI案に戻す（手直しと固定を捨てる） */
  const revert = async () => {
    if (!aiPlan) return;
    // 固定と同じ担当の手直しの記憶（AI案に戻すと消える。ADR-0043）
    const remain = Object.keys(patchManualPrefs(data, { clear: aiPlan.pins }, 0).manualPrefs).length;
    const forgetN = Object.keys(data.manualPrefs).length - remain;
    const ok = await confirmDialog({
      title: 'AIが出したままの案に戻しますか？',
      body: `手直しとピンを捨てて、AIが出したままの案に戻します。${forgetN > 0 ? `「次からも同じ担当」の覚え ${forgetN}件も消します。` : ''}`,
      confirmLabel: '捨てて元に戻す',
      tone: 'danger',
    });
    if (!ok) return;
    if (runRef.current) return;
    const dropped = aiPlan.pins;
    update((d) =>
      // 固定を捨てるので、固定と同じ担当の手直しの記憶も消す（ADR-0043）
      patchManualPrefs(
        patchPlan(d, date, problem, (plan) => ({
          ...plan,
          routes: plan.generated.routes,
          unassigned: plan.generated.unassigned,
          score: plan.generated.score,
          pins: {},
        })),
        { clear: dropped },
        0,
      ),
    );
    setPrefAsk(null);
    setPrefBulk(null);
    sel.reset();
    toast('AI案に戻しました');
  };

  // ---- この割当で確定（D13）：今の案を manualPlans と visits.staffId に写す ----
  /** この割当で確定（確定したら true） */
  const adopt = async (): Promise<boolean> => {
    if (!aiPlan || !problem) return false;
    // 入らない訪問・必須の違反があれば、本文の先頭に件数（PRD D219。数は1行のまとめと同じ今の案の採点から）
    const warns = adoptWarnings(curScore?.value?.dropped ?? 0, curScore?.value?.hardViolations.length ?? 0);
    const ok = await confirmDialog({
      title: 'この割当で確定しますか？',
      body: `${warns.length > 0 ? `${warns.join('\n')}\n\n` : ''}この割当で確定します。担当が決まり、${terms.staff}の画面にも出ます。`,
      confirmLabel: '確定する',
    });
    if (!ok) return false;
    if (runRef.current) return false;
    // 書き方は lib/confirmDay（月のまとめて確定と共通。PRD D223）
    update((d) => confirmDay(d, date, problem));
    // 確定したら手直しの控えは捨てる（戻すと今の案だけが戻り、確定した担当と食い違うため。PRD D218）
    setUndoSnap(null);
    toast('この割当で確定しました');
    return true;
  };
  /**
   * 確定の状態：'none' は確定した割当（manualPlans[date]）が無い、'same' は今の案と一致、'diff' は違う。
   * 比べるのは計算に入れた訪問の担当だけ（計算に入れない訪問は確定しても担当を変えないため）
   */
  const confirmState = useMemo((): 'none' | 'same' | 'diff' | null => {
    if (!aiPlan || !problem) return null;
    const saved = own(data.manualPlans, date);
    if (!saved) return 'none';
    const savedOwner = ownerMap(saved);
    const aiOwner = ownerMap(aiPlan.routes);
    return problem.visits.every((v) => (aiOwner.get(v.id) ?? null) === (savedOwner.get(v.id) ?? null))
      ? 'same'
      : 'diff';
  }, [aiPlan, problem, data.manualPlans, date]);

  // ---- 急な欠勤と振り直し（ADR-0011。PRD D26〜D32）----
  /** 今の案が振り直しの結果なら、その元の案の情報 */
  const reassignInfo = aiPlan?.reassign ?? null;
  /**
   * 元の案との差：before＝元の案を、振り直しに使った欠勤を除いたデータで compile した問題で、after＝今の案をいまの問題で。
   * 今の案を手直し・組み直ししても出し直す
   */
  /** 元の案の時刻を出す問題（振り直しに使った欠勤を除いたデータで compile。差・案B・連絡の一覧の before） */
  const reassignBefore = useMemo(() => {
    if (!reassignInfo) return null;
    const used = new Set(reassignInfo.absenceIds);
    return (
      attempt(() => compile({ ...compileInput, absences: compileInput.absences.filter((a) => !used.has(a.id)) }, date))
        .value ?? null
    );
  }, [reassignInfo, compileInput, date]);
  const rDiff = useMemo(() => {
    if (!reassignInfo || !problem || !reassignBefore) return null;
    return (
      attempt(() =>
        reassignDiff(
          { problem: reassignBefore, routes: reassignInfo.baseRoutes },
          { problem, routes: aiPlan?.routes ?? {} },
        ),
      ).value ?? null
    );
  }, [reassignInfo, reassignBefore, problem, aiPlan]);
  /** 代行（訪問ID → 元の担当）・開始の変化（訪問ID → 分）・変わる人・地図で太くする訪問 */
  const reassignMarks = useMemo(() => {
    const substitute = new Map<string, string>();
    for (const x of rDiff?.moved ?? []) if (x.from !== null && x.to !== null) substitute.set(x.visitId, x.from);
    return {
      substitute,
      shifted: new Map((rDiff?.shifted ?? []).map((x) => [x.visitId, x.minutes])),
      changed: new Set(rDiff?.changedStaff ?? []),
      emphasize: new Set(substitute.keys()),
      unplaced: new Set(rDiff?.unplaced ?? []),
    };
  }, [rDiff]);
  /** 振り直しに使った欠勤が取り消されている */
  const absenceCancelled = !!reassignInfo?.absenceIds.some((id) => !data.absences.some((a) => a.id === id));
  /** 列の見出し（欠勤の欄を閉じたとき、フォーカスの戻り先が消えていたらここへ） */
  const colHeadOf = (sid: string) =>
    document.querySelector<HTMLElement>(`.route-col[data-staff="${CSS.escape(sid)}"] .col-focus`);
  /** 名前を記録の名前に入れる長さ（記録の名前は60字まで） */
  const shortName = (id: string) => staffName(id).slice(0, 40);

  /**
   * 「登録して振り直す」：欠勤を足したデータで compile し、元の案から振り直して今の案にする（1回の update で書く）。
   * stay：「欠勤・キャンセル」の欄から押した（欄は閉じず4段目へ進むので、差の欄へは移らない）。振り直せたら true
   */
  const registerAndReassign = async (absence: Absence, anneal = false, stay = false): Promise<boolean> => {
    if (running) return false;
    setError(null);
    const d1 = saveAbsence(data, absence);
    const built = attempt(() => compile(d1, date));
    const p = built.value;
    if (!p) {
      setError(`振り直せませんでした（${built.error}）`);
      if (stay) toast(`振り直せませんでした（${built.error}）`);
      return false;
    }
    const base = baseOf(d1, date, p);
    if (!base) {
      setError('先にAI案を作ってください（欠勤だけは登録できます）');
      return false;
    }
    if (
      base.from === 'confirmed' &&
      confirmState === 'diff' &&
      !(await confirmDialog({
        title: '未確定の変更を捨てて振り直しますか？',
        body: '今の案の未確定の変更を捨てて、確定した割当を元に振り直します。',
        confirmLabel: '捨てて振り直す',
        tone: 'danger',
      }))
    )
      return false;
    if (runRef.current) return false;
    const used = absencesOn(d1, date);
    const absent = [...new Set(used.map((a) => a.staffId))];
    const result = attempt(() => {
      // 元の案の時刻（欠勤と重なるか）は、その日の欠勤を除いた問題で出す
      const before = { problem: compile(withoutAbsencesOn(d1, date), date), routes: base.routes };
      return reassign(p, base.routes, targetsOf(p, before, absent));
    });
    if (!result.value) {
      setError(`振り直せませんでした（${result.error}）`);
      if (stay) toast(`振り直せませんでした（${result.error}）`);
      return false;
    }
    const r = result.value;
    const createdAt = Date.now();
    update((d) =>
      applyReassign(saveAbsence(d, absence), date, {
        problem: p,
        result: r,
        base,
        absenceIds: used.map((a) => a.id),
        label: `欠勤の振り直し（${shortName(absence.staffId)}さん）`,
        createdAt,
      }),
    );
    if (!stay) setSudden(null);
    sel.reset();
    toast(`振り直しました（振り直し ${r.placed.length}件・入らない ${r.unplaced.length}件）`);
    // 案B も作る：書き込んだ今の案（reassign）と新しい問題が画面に出てから始める（下の effect）
    if (anneal) pendingAnneal.current = date;
    if (stay) return true;
    pendingBarFocus.current = date;
    const token = date;
    window.setTimeout(() => {
      if (pendingBarFocus.current === token) pendingBarFocus.current = null;
    }, 1500);
    return true;
  };

  // ---- 2回目：案B「少し動かしてよい」・連絡の一覧（PRD D34・D35。ADR-0011 追記）----
  /** 「変更を減らす」の重み（今の案が案B ならその重み） */
  const [stayWeight, setStayWeight] = useState<number>(STAY_WEIGHT_DEFAULT);
  // 今の案が案B なら、その重みに合わせる
  useEffect(() => {
    if (reassignInfo?.stayWeight !== undefined) setStayWeight(reassignInfo.stayWeight);
  }, [reassignInfo?.stayWeight]);
  /** 案B を案A のままにした理由（settleAnneal。key が今の振り直しと違えば見せない） */
  const [annealNote, setAnnealNote] = useState<{ key: string; text: string } | null>(null);
  const [contactsOpen, setContactsOpen] = useState(false);
  /** 案A の列（振り直した直後。無い古いデータで今の案が案A なら今の案） */
  const planA = useMemo(() => {
    if (!reassignInfo || !problem) return null;
    const r = reassignInfo.insertRoutes ?? (reassignInfo.method === 'insert' ? aiPlan?.routes : undefined);
    return r ? alignRoutes(problem, r) : null;
  }, [reassignInfo, problem, aiPlan]);
  /** 今の振り直し（元の案・欠勤・案A）のキー。案B の結果がこの振り直しのものか */
  const annealKey = reassignInfo
    ? JSON.stringify([date, reassignInfo.baseRoutes, reassignInfo.absenceIds, planA])
    : null;
  /** 作った案B（記録にある、今の振り直しのいちばん新しい案B。作り終えたときに記録へ足す） */
  const anneal = useMemo(() => {
    if (!reassignInfo || !problem) return null;
    const run = annealRunOf(data, date, reassignInfo);
    if (!run) return null;
    const routes = alignRoutes(problem, run.routes);
    const ids = new Set(problem.visits.map((v) => v.id));
    const result: ReassignResult = {
      routes,
      placed: [],
      unplaced: [],
      unassigned: run.unassigned.filter((id) => ids.has(id)),
      pins: Object.fromEntries(Object.entries(run.pins).filter(([id]) => ids.has(id))),
    };
    return {
      weight: run.reassign?.stayWeight ?? STAY_WEIGHT_DEFAULT,
      result,
      seed: run.seed,
      iterations: run.iterations,
      stopped: run.stopped,
    };
  }, [data, date, reassignInfo, problem]);
  const note = annealNote && annealNote.key === annealKey ? annealNote.text : null;
  /** 振り直しに使った欠勤の人（まだある欠勤） */
  const absentStaff = useMemo(() => {
    const ids = new Set(reassignInfo?.absenceIds ?? []);
    return new Set(data.absences.filter((a) => ids.has(a.id) && a.date === date).map((a) => a.staffId));
  }, [reassignInfo, data.absences, date]);
  /** 欠勤の人に残る、欠勤と重なる訪問（手直しで戻した等。今の案で。leftOf） */
  const left = useMemo(() => {
    if (!reassignInfo || !problem || !reassignBefore || absentStaff.size === 0) return [];
    return (
      attempt(() => leftOf(problem, { problem: reassignBefore, routes: aiPlan?.routes ?? {} }, [...absentStaff]))
        .value ?? []
    );
  }, [reassignInfo, problem, reassignBefore, absentStaff, aiPlan]);
  const leftById = useMemo(() => new Map(left.map((x) => [x.visitId, x])), [left]);
  const barId = useId();
  /** 差の欄へ移り、見出しにフォーカスする（欠勤の登録のあと・列の見出しの近道・下の帯） */
  const goToBar = () => {
    const el = document.getElementById(barId);
    if (!el) return;
    el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    el.focus({ preventScroll: true });
  };
  // 欠勤を登録して振り直したら、差の欄（案A の結果・案B・連絡の一覧）へ移る
  // biome-ignore lint/correctness/useExhaustiveDependencies: 振り直しの案が画面に出たときに1回だけ
  useEffect(() => {
    if (pendingBarFocus.current !== date || !reassignInfo) return;
    pendingBarFocus.current = null;
    const raf = requestAnimationFrame(goToBar);
    return () => cancelAnimationFrame(raf);
  }, [reassignInfo, date]);
  // 日付を変えたら、差の欄へ移る予約を消す
  useEffect(() => {
    if (pendingBarFocus.current !== date) pendingBarFocus.current = null;
  }, [date]);
  /** もう一度振り直す（欠勤の人に残る訪問を、今の案から振り直す。続けて振り直すのと同じ） */
  const reassignAgain = () => {
    const a = data.absences.find((x) => x.date === date && absentStaff.has(x.staffId));
    if (!a) return;
    void registerAndReassign(a);
  };
  const annealDisabled = !reassignInfo
    ? '振り直しの案がありません'
    : absenceCancelled
      ? '欠勤が取り消されているので作れません'
      : !planA
        ? '案A がありません'
        : running && running !== 'anneal'
          ? '計算中は押せません'
          : null;
  /** 案B を Worker で作る（進み具合・止める）。初期解は案A */
  const startAnneal = () => {
    if (!problem || !reassignInfo || !reassignBefore || !planA || running || annealDisabled) return;
    setError(null);
    const before = { problem: reassignBefore, routes: reassignInfo.baseRoutes };
    const weight = stayWeight;
    const key = annealKey ?? '';
    const prep = attempt(() =>
      prepareAnneal(problem, before, planA, targetsOf(problem, before, [...absentStaff]), { weight }),
    );
    if (!prep.value) {
      setError(`案B を作れませんでした（${prep.error}）`);
      return;
    }
    const x = prep.value;
    const forDate = date;
    const p = problem;
    const basis = reassignInfo;
    // 案A の列が使えない人（必須の違反・回れない列）は、その列だけ案A のまま動かさずに作る
    const heldText =
      x.held.length > 0
        ? `${x.held.map(staffName).join('・')}さんの列は案A に守れない条件があるため、案A のまま動かしていません（その列は手で直してください）`
        : null;
    setAnnealNote(heldText ? { key, text: heldText } : null);
    run(
      'anneal',
      x.problem,
      '少し動かす',
      (res) => {
        // 保険：案A に入っていた訪問を落とした・案A より良くならないときは案B として出さない（案A のまま）
        const settled = attempt(() => settleAnneal(x, res.routes));
        if (!settled.value) {
          setError(`案B を作れませんでした（${settled.error}）`);
          return;
        }
        const got = settled.value;
        if (!got.ok) {
          const text =
            got.reason === 'keepDropped'
              ? `案B が、案A に入っていた訪問（${got.visitIds.length}件）を外してしまったため、案A のままにしました`
              : '案A を超えられませんでした（案A のままにしました）';
          setAnnealNote({ key, text: heldText ? `${text}。${heldText}` : text });
          toast(text);
          return;
        }
        // 作り終えたら記録に足す（選ばなくても再読込で消えない。同じ結果なら足さない）
        const createdAt = Date.now();
        update((d) =>
          addAnnealRun(d, forDate, {
            basis,
            problem: p,
            result: got.result,
            stayWeight: weight,
            seed: res.seed,
            iterations: res.iterations,
            stopped: res.stopped,
            label: reassignLabel('anneal'),
            createdAt,
          }),
        );
        const sameAsA = JSON.stringify(alignRoutes(p, got.result.routes)) === JSON.stringify(alignRoutes(p, planA));
        toast(
          sameAsA
            ? '案B は案A と同じになりました。動かしても良くなりませんでした'
            : res.stopped
              ? '途中までの案B を出しました。案A と比べて選んでください'
              : '案B を作りました。案A と比べて選んでください',
        );
      },
      undefined,
      x.initial,
    );
  };
  // 「登録して、少し動かしてよい（案B）も作る」：振り直しが今の案に出たら案B を始める
  // biome-ignore lint/correctness/useExhaustiveDependencies: 振り直しの案と問題が出そろったときに1回だけ
  useEffect(() => {
    if (pendingAnneal.current !== date || !reassignInfo || !problem || !planA || running) return;
    pendingAnneal.current = null;
    startAnneal();
  }, [reassignInfo, problem, planA, running, date]);
  /** 案B の記録の名前（記録の名前は60字まで） */
  const reassignLabel = (method: 'insert' | 'anneal') => {
    const names = [...absentStaff].map(shortName).join('・').slice(0, 36);
    return method === 'anneal' ? `欠勤の振り直し・案B（${names}さん）` : `欠勤の振り直し（${names}さん）`;
  };
  /** 案A・案B のどちらかを今の案にする（記録にも残す） */
  const chooseOption = async (key: 'insert' | 'anneal') => {
    if (!problem || !reassignInfo || running) return;
    // 今の案が案A・案B のどちらとも違う（手直しした）ときだけ確認する
    if (
      !annealOptions.some((o) => o.current) &&
      !(await confirmDialog({
        title: `手直しを捨てて${key === 'anneal' ? '案B' : '案A'}に切り替えますか？`,
        body: '今の案の手直しは消えます。',
        confirmLabel: '捨てて切り替える',
        tone: 'danger',
      }))
    )
      return;
    if (runRef.current) return;
    const p = problem;
    const createdAt = Date.now();
    if (key === 'anneal') {
      if (!anneal) return;
      const b = anneal;
      update((d) =>
        chooseReassign(d, date, {
          problem: p,
          result: b.result,
          method: 'anneal',
          stayWeight: b.weight,
          seed: b.seed,
          iterations: b.iterations,
          stopped: b.stopped,
          label: reassignLabel('anneal'),
          createdAt,
        }),
      );
      toast('案B（少し動かした案）を今の案にしました');
    } else {
      if (!planA) return;
      const routesA = planA;
      const placed = new Set(Object.values(routesA).flat());
      const pinsA: Record<string, string> = {};
      for (const [sid, ids] of Object.entries(routesA)) for (const id of ids) pinsA[id] = sid;
      const resultA: ReassignResult = {
        routes: routesA,
        placed: [],
        unplaced: [],
        unassigned: p.visits.map((v) => v.id).filter((id) => !placed.has(id)),
        pins: pinsA,
      };
      update((d) =>
        chooseReassign(d, date, {
          problem: p,
          result: resultA,
          method: 'insert',
          seed: d.seed,
          iterations: 0,
          stopped: false,
          label: reassignLabel('insert'),
          createdAt,
        }),
      );
      toast('案A（空き時間に入れた案）を今の案にしました');
    }
    sel.reset();
  };
  /** 案A・案B の比べる数（元の案との差・点数の基準の物差しの点数） */
  const annealOptions: ReassignOption[] = useMemo(() => {
    if (!problem || !reassignInfo || !reassignBefore) return [];
    const before = { problem: reassignBefore, routes: reassignInfo.baseRoutes };
    const cur = JSON.stringify(alignRoutes(problem, aiPlan?.routes ?? {}));
    const option = (key: ReassignOption['key'], title: string, routes: Record<string, string[]>): ReassignOption => ({
      key,
      title,
      diff: attempt(() => reassignDiff(before, { problem, routes })).value,
      hundred:
        scoreProblem && scoreScale
          ? (attempt(() => toHundred(score(scoreProblem, routes).total, scoreScale)).value ?? null)
          : null,
      current: JSON.stringify(alignRoutes(problem, routes)) === cur,
    });
    const out: ReassignOption[] = [];
    if (planA) out.push(option('insert', '案A（空き時間に入れる）', planA));
    if (anneal) out.push(option('anneal', `案B（変更を減らす ${anneal.weight}）`, anneal.result.routes));
    // 作った案B が無い（再読込・画面を移った）が今の案が案B なら、今の案を案B として並べる（案A に戻せる）
    else if (reassignInfo.method === 'anneal' && aiPlan)
      out.push(option('anneal', `案B（変更を減らす ${reassignInfo.stayWeight ?? ''}）`, aiPlan.routes));
    return out;
  }, [problem, reassignInfo, reassignBefore, aiPlan, planA, anneal, scoreProblem, scoreScale]);
  /** 連絡の一覧（元の案と今の案の差。確定前でも見られる） */
  const contacts = useMemo(() => {
    if (!reassignInfo || !problem || !reassignBefore) return null;
    return (
      attempt(() =>
        contactsOf(
          { problem: reassignBefore, routes: reassignInfo.baseRoutes },
          { problem, routes: aiPlan?.routes ?? {} },
        ),
      ).value ?? null
    );
  }, [reassignInfo, reassignBefore, problem, aiPlan]);
  /** 連絡の一覧のいちばん上に出す、欠勤の人に残る訪問 */
  const leftContacts: LeftContact[] = left.map((x) => {
    const v = visitById.get(x.visitId);
    return {
      visitId: x.visitId,
      clientId: v?.clientId ?? '',
      staffId: x.staffId,
      at: v ? timeText(v.earliestStart) : '',
      reason: leftReasonText(x),
    };
  });
  /** 案B を勧める（案A で入らない訪問があり、今の案が案A で、まだ案B を作っていない） */
  const annealRecommended =
    !!reassignInfo && (rDiff?.unplaced.length ?? 0) > 0 && reassignInfo.method === 'insert' && !anneal;
  const contactsTotal = contactCount(contacts) + left.length;
  /** この端末の mailto の長さの目安（ADR-0017） */
  const mailLimit = useMailLimit();
  const contactWords = {
    // 連絡文の日付は「本日」にせず「10月15日（木）」（あとから読まれても分かる。PRD D245）
    day: dateWordOf(date),
    staffWord: terms.staff,
    staffName,
    clientName: (id: string) => clientById.get(id)?.displayName ?? '（不明）',
    clientAddress: (id: string) => clientById.get(id)?.place.address ?? '',
    visitMinutes: (id: string) => visitById.get(id)?.durationMinutes ?? null,
    promised: (id: string) => {
      const v = visitById.get(id);
      if (!v) return null;
      const from = hhmmToMinutes(v.earliestStart);
      return { from, to: v.windowKind === 'window' ? hhmmToMinutes(v.latestStart) : from };
    },
    orgName: data.org.name,
  };
  const saveAbsenceOnly = (absence: Absence) => {
    update((d) => saveAbsence(d, absence));
    setSudden(null);
    toast(
      aiPlan
        ? '欠勤を登録しました（今の案はそのままです）'
        : '欠勤を登録しました（案を作るときは欠勤の時間を除いて作ります）',
    );
  };
  const cancelAbsence = async (absence: Absence): Promise<boolean> => {
    const ok = await confirmDialog({
      title: `${staffName(absence.staffId)}さんの欠勤を取り消しますか？`,
      body: '今の案はそのままです。',
      confirmLabel: '欠勤を取り消す',
      cancelLabel: '残しておく',
      tone: 'danger',
    });
    if (!ok) return false;
    update((d) => removeAbsence(d, absence.id));
    setSudden(null);
    toast(reassignInfo ? '欠勤を取り消しました。案を戻すには「元の案に戻す」を押してください' : '欠勤を取り消しました');
    return true;
  };
  const revertToBase = async (): Promise<boolean> => {
    if (!problem || !reassignInfo) return false;
    const ok = await confirmDialog({
      title: '振り直す前の案に戻しますか？',
      body: '振り直す前の担当に戻します。',
      confirmLabel: '元の案に戻す',
    });
    if (!ok) return false;
    if (runRef.current) return false;
    const p = problem;
    update((d) => revertReassign(d, date, p));
    sel.reset();
    toast('元の案に戻しました');
    return true;
  };
  /**
   * 入らない訪問を候補の人に入れる（固定。時刻は変えない。間に合わなければ必須の違反の赤い枠）。
   * その人の既存の訪問の開始が遅れるときは確認を出す
   */
  const placeCandidate = async (visitId: string, c: ReassignCandidate) => {
    if (!problem || !aiPlan || running) return;
    const staffId = c.staffId;
    const notes: string[] = [];
    if (c.delayedCount > 0) {
      notes.push(`${staffName(staffId)}さんの訪問 ${c.delayedCount}件の開始が最大 +${c.maxDelayMinutes}分 遅れます。`);
    }
    if (
      notes.length > 0 &&
      !(await confirmDialog({
        title: `${staffName(staffId)}さんに入れますか？`,
        body: notes.join(''),
        confirmLabel: '遅れても入れる',
      }))
    )
      return;
    if (runRef.current) return;
    const p = problem;
    const saved = applyEdit(p, visitId, {
      routes: placeVisit(p, aiPlan.routes, visitId, staffId),
      pins: { ...aiPlan.pins, [visitId]: staffId },
    });
    noteManual(visitId, staffId);
    sel.follow(visitId, staffId);
    toast(`${staffName(staffId)}さんに入れました`, saved ? { action: undoAction } : undefined);
  };

  // ---- 訪問の取消・前の同じ曜日からコピー ----
  /** 取り消しの欄を開く（取り消しの種類を選ぶ。PRD D74） */
  const cancelVisit = (v: Visit) => {
    setCancelFor(v);
    setCancelSameDay(false);
  };
  /** 取り消しの欄の「取り消す」 */
  const doCancel = () => {
    if (!cancelFor) return;
    applyCancel(cancelFor.id, cancelSameDay);
    setCancelFor(null);
  };
  /**
   * 訪問を取り消す（取り消しの欄・「欠勤・キャンセル」の欄で共通）。当日キャンセルなら取り消しの種類 'sameDay'
   * （回数を数えるだけ。請求はしない。ADR-0015）。今の案はそのままで、この訪問は計算から外れる
   */
  const applyCancel = (visitId: string, sameDay: boolean) => {
    const v = m.allVisits.find((x) => x.id === visitId && !x.cancelled);
    if (!v) return;
    const kind = sameDay ? ('sameDay' as const) : null;
    // 定期パターンの訪問を取り消したら「この回だけの変更」（ADR-0012）
    update((d) => ({
      ...d,
      visits: d.visits.map((x) =>
        x.id === v.id
          ? { ...x, cancelled: true, cancelKind: kind, pattern: x.pattern ? { ...x.pattern, edited: true } : null }
          : x,
      ),
    }));
    toast(kind ? '当日キャンセルとして取り消しました' : '取り消しました');
  };
  /**
   * 拘束が上限を超える人（稼働の見込み。PRD D72。ADR-0015）。日の画面は今の案（無ければ確定した割当）で見る
   * （手直し中の案で注意を出す。月間・稼働の見込みの画面は確定した割当を先に数える）
   */
  const overSpan = useMemo(() => {
    if (!problem) return [];
    const src = aiPlan
      ? { routes: aiPlan.routes, sort: false }
      : (() => {
          const w = workRoutesOf({ manualPlans: data.manualPlans, aiPlans: {} }, date, problem);
          return w ? { routes: w.routes, sort: true } : null;
        })();
    if (!src) return [];
    return workStats(problem, src.routes, data.org, src.sort).filter((x) => x.over);
  }, [problem, aiPlan, data.manualPlans, data.org, date]);
  /** 1週前の訪問（と確定した割当）をこの日に写す。訪問が無い日だけ */
  const copyFromLastWeek = async () => {
    setError(null);
    const from = addDays(date, -7);
    const src = data.visits.filter((v) => v.date === from && !v.cancelled && !isOnLeave(data.clientLeaves, v));
    if (src.length === 0) {
      setError(`${from} にコピーできる訪問がありません`);
      return;
    }
    const ok = await confirmDialog({
      title: '1週前の訪問をこの日にコピーしますか？',
      body: `${from} の訪問（と確定した割当）を ${date} にコピーします。`,
      confirmLabel: 'コピーする',
    });
    if (!ok) return;
    // コピー先がパターンの回なら、その回の ID で写す（あとの展開で二重にしない。ADR-0012）。それ以外は単発
    const copy = copyDayVisits(data, from, date, () => newId('v'));
    update((d) => ({
      ...d,
      visits: [...d.visits, ...copy.visits],
      manualPlans: { ...d.manualPlans, [date]: copy.cols },
    }));
    toast(`${copy.visits.length}件コピーしました`);
  };

  // ---- 列：その日に働く人（と、今の案で訪問がある人）----
  const columns = useMemo(() => {
    // 欠勤で稼働時間帯が無くなった人（もともと働く日）も列を出す（欠勤の印・「欠勤を直す」。ADR-0011）
    const absentToday = (id: string) => {
      const a = slotsOf.get(id);
      return !!a?.absence && a.baseSlots.length > 0;
    };
    const working = new Set(
      problem?.staff.filter((s) => s.slots.length > 0 || absentToday(s.id)).map((s) => s.id) ?? [],
    );
    const withVisits = new Set(
      Object.entries(routes)
        .filter(([, ids]) => ids.length > 0)
        .map(([k]) => k),
    );
    const order = staff.map((s) => s.id).filter((id) => working.has(id) || withVisits.has(id));
    return [...order, ...[...withVisits].filter((id) => !order.includes(id) && id !== NONE)];
  }, [problem, routes, staff, slotsOf]);
  const unassigned = aiPlan?.unassigned ?? [];
  const hardOf = useMemo(() => {
    const h = new Map<string, string[]>();
    for (const v of curScore?.value?.hardViolations ?? []) h.set(v.visitId, [...(h.get(v.visitId) ?? []), v.label]);
    return h;
  }, [curScore]);

  const dropProps = (to: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dropTo !== to) setDropTo(to);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTo(null);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain') || dragging;
      dragStart.end();
      setDragging(null);
      setDropTo(null);
      if (!id) return;
      if (to === NONE) unassign(id);
      else if (owner.get(id) !== to) moveTo(id, to);
    },
  });
  const dragProps = (id: string) => ({
    draggable: !running,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData('text/plain', id);
      e.dataTransfer.effectAllowed = 'move';
      // ここで setDragging すると、未割当の列が先頭に足されて列がずれ、Chrome がドラッグをすぐ終わらせる
      dragStart.start(() => setDragging(id));
    },
    onDragEnd: () => {
      dragStart.end();
      setDragging(null);
      setDropTo(null);
    },
  });

  // ---- 地図：今の案（担当ごとの色の実線）----
  const { points, lines } = useMemo(
    () =>
      aiPlan
        ? buildRouteMap({
            sets: [{ key: PLAN_SET, routes }],
            staffOrder: columns,
            staffById,
            visitById,
            clientById,
            colorOfStaff,
            focusStaff,
            picked: sel.picked,
            focusLeg: sel.focusLeg,
            emphasize: reassignMarks.emphasize,
          })
        : { points: [], lines: [] },
    [
      aiPlan,
      columns,
      routes,
      staffById,
      colorOfStaff,
      visitById,
      clientById,
      focusStaff,
      sel.picked,
      sel.focusLeg,
      reassignMarks,
    ],
  );

  /** 列の最後の「自宅まで N分」（押すと地図でその区間を強調。もう一度押すと外す。自宅の位置が無い人は出さない） */
  const homeLeg = (sid: string) => {
    const t = homeTravel(problem, staffById.get(sid), routes);
    if (t === null) return null;
    const x = { id: homeLegKey(sid), set: PLAN_SET };
    return <LegLine kind="toHome" minutes={t} on={sel.isLeg(x)} onToggle={() => sel.toggleLeg(x)} />;
  };

  const sortedVisits = useMemo(() => timeOrder([...visitById.keys()], visitById), [visitById]);
  const notInProblem = problem ? visits.filter((v) => !problem.visits.some((p) => p.id === v.id)) : [];
  const cs = curScore?.value ?? null;
  const gs = genScore?.value ?? null;

  /**
   * 訪問の詳細の〈利用者さん〉・担当の名前（押すと詳細の吹き出し。PRD D124）。順番のカードの詳細・時間軸の帯の詳細で共通。
   * withClient が false のときは担当だけ（時間軸は見出しの行に〈利用者さん〉の名前がある）
   */
  const whoOf = (id: string, sid: string | null, withClient = true) => {
    const client = clientOf(id);
    const s = sid ? staffById.get(sid) : undefined;
    if (!(withClient && client) && !s) return null;
    return (
      <div className="row visit-who" data-testid="visit-who">
        {withClient && client && (
          <span>
            {terms.client}：<PersonButton kind="client" id={client.id} name={client.displayName} />
          </span>
        )}
        {s && (
          <span className="with-staff-mark">
            担当：
            <StaffMark staff={s} size="xs" />
            <PersonButton kind="staff" id={s.id} name={s.name} />
          </span>
        )}
      </div>
    );
  };

  /** 手直しの記憶で固定した訪問の説明（ADR-0043） */
  const prefNoteText = (sid: string) =>
    `前に手で${staffName(sid)}さんにしました。同じ曜日・時間の訪問は、作り直してもこの担当です`;
  /** 詳細の「なぜこの担当か」の1行（記憶で固定した訪問だけ） */
  const prefNoteOf = (id: string) => {
    const memo = remembered.get(id);
    return memo ? (
      <p className="sub pref-note" data-testid="pref-note">
        {prefNoteText(memo)}
      </p>
    ) : null;
  };

  /**
   * 訪問の印（欠勤の人のまま・代行・+N分・固定・必須の違反）と「固定を外す」。順番のカードの中・時間軸の帯の説明で共通。
   * pinHint：「固定」に用語の説明を付ける（順番の表示では並びで最初の固定の訪問だけ。押して開く説明は別に数える。PRD D241）
   */
  const tagsOf = (id: string, pinHint = true) => {
    const pin = own(pins, id);
    const hard = hardOf.get(id);
    const subFrom = reassignMarks.substitute.get(id);
    const shift = reassignMarks.shifted.get(id);
    const stay = leftById.get(id);
    const memo = remembered.get(id);
    if (!(pin || hard || subFrom || shift !== undefined || stay || memo)) return null;
    return (
      <div className="row visit-tags">
        {stay && (
          <span
            className="chip chip-red"
            data-testid="left-mark"
            title="欠勤と重なっています。別の人へドラッグするか、「もう一度振り直す」を押してください"
          >
            <TriangleAlert size={12} aria-hidden="true" />
            {leftReasonText(stay)}（対応が必要）
          </span>
        )}
        {subFrom && (
          <span className="chip chip-move" title={`元の担当：${staffName(subFrom)}`} data-testid="substitute">
            代行
            <span className="sr-only">（元の担当：{staffName(subFrom)}さん）</span>
          </span>
        )}
        {shift !== undefined && (
          <span className="chip chip-warn" title="振り直す前の開始時刻からの変化" data-testid="shifted">
            {shift > 0 ? `+${shift}分` : `−${-shift}分`}
          </span>
        )}
        {pin && (
          <span className="chip chip-pin" title={pinHint ? undefined : 'ピン（作り直しても担当を変えない）'}>
            <Pin size={12} strokeWidth={2.4} aria-hidden="true" />
            <Term k="pinned" plain={!pinHint} />
          </span>
        )}
        {memo && (
          <span className="chip chip-memo" title={prefNoteText(memo)} data-testid="pref-mark">
            <History size={12} aria-hidden="true" />
            記憶
            <span className="sr-only">（{prefNoteText(memo)}）</span>
          </span>
        )}
        {hard?.map((h) => (
          <span key={h} className="chip chip-red" title="守れない条件">
            <ShieldAlert size={12} aria-hidden="true" />
            {h}
          </span>
        ))}
        {pin && (
          <IconButton
            icon={PinOff}
            label="ピンを外す"
            className="icon-btn-sm"
            onClick={() => unpin(id)}
            disabled={!!running}
          />
        )}
      </div>
    );
  };

  /**
   * 訪問の詳細の「担当を変える ▾」（PRD D217）。順番のカード・時間軸の帯の詳細で共通。
   * 入らない訪問で「受けられる人」（振り直しの候補）を出しているものは重ねない
   */
  const reassignOf = (id: string, ownerId: string | null) => {
    if (!problem || !aiPlan) return null;
    if (!ownerId && reassignMarks.unplaced.has(id)) return null;
    return (
      <ReassignMenu
        problem={problem}
        routes={routes}
        visitId={id}
        ownerId={ownerId}
        pinned={!!own(pins, id)}
        staffIds={columns}
        staffName={staffName}
        staffTerm={terms.staff}
        busy={running ? '計算中は選べません' : false}
        onMove={(sid) => {
          moveTo(id, sid);
          focusAfterMove(id, sid);
        }}
        onNone={() => {
          unassign(id);
          focusAfterMove(id, null);
        }}
      />
    );
  };

  /** 順番の表示で最初（入らなかった訪問 → 列の順）の固定の訪問。「固定」の説明はこのカードだけ（PRD D241） */
  const firstPinnedCard = [...unassigned, ...columns.flatMap((sid) => own(routes, sid) ?? [])].find((id) =>
    own(pins, id),
  );
  /** 訪問カード（ドラッグで担当を移す。押すと理由） */
  const card = (id: string) => {
    const pin = own(pins, id);
    const hard = hardOf.get(id);
    const ownerId = owner.get(id) ?? null;
    const x = { id, set: PLAN_SET };
    return (
      <VisitCard
        key={id}
        visitId={id}
        timing={explained.get(id)?.timing ?? null}
        fallbackTime={visitById.get(id)?.earliestStart ?? ''}
        client={clientOf(id)}
        first={own(routes, ownerId ?? '')?.[0] === id}
        legOn={sel.isLeg(x)}
        onLeg={() => sel.toggleLeg(x)}
        picked={sel.isPicked(x)}
        onPick={() => sel.togglePick(x)}
        tone={hard ? 'red' : pin ? 'pinned' : null}
        drag={dragProps(id)}
        dragging={dragging === id}
        detail={
          <>
            {openOf(id)}
            {whoOf(id, ownerId)}
            {prefNoteOf(id)}
            {reassignOf(id, ownerId)}
            <VisitRules client={clientOf(id)} />
            {routeLinksOf(id, ownerId)}
            <ReasonBox explain={explained.get(id)} />
          </>
        }
        mark={<TypeMark type={typeOf(data.visitTypes, visitById.get(id)?.typeId)} compact />}
      >
        {tagsOf(id, id === firstPinnedCard)}
      </VisitCard>
    );
  };

  /**
   * 時間軸の帯（PRD D58）：時刻は今の案の lenient（explain の timing。無ければ訪問の開始（早）と所要）、色は種類。
   * 印は小さなアイコンと title、押すと帯の下に印の説明と理由
   */
  const bandOf = (id: string, sid: string): TimelineBand => {
    const v = visitById.get(id);
    const t = explained.get(id)?.timing ?? null;
    const start = t?.start ?? hhmmToMinutes(v?.earliestStart ?? '00:00');
    const end = t?.end ?? start + (v?.durationMinutes ?? 0);
    const type = typeOf(data.visitTypes, v?.typeId);
    const client = clientOf(id);
    const pin = own(pins, id);
    const hard = hardOf.get(id);
    const subFrom = reassignMarks.substitute.get(id);
    const shift = reassignMarks.shifted.get(id);
    const stay = leftById.get(id);
    const unfit = typeUnfitOf(problem, id, sid);
    const notes: string[] = [];
    const icons: ReactNode[] = [];
    const mark = (key: string, cls: string, title: string, body: ReactNode, testId?: string) => {
      notes.push(title);
      icons.push(
        <span key={key} className={`tl-mark ${cls}`} title={title} data-testid={testId}>
          {body}
        </span>,
      );
    };
    if (type) notes.push(`種類：${type.name}`);
    if (stay)
      mark(
        'left',
        'is-red',
        `${leftReasonText(stay)}（対応が必要）`,
        <TriangleAlert size={11} aria-hidden="true" />,
        'left-mark',
      );
    if (unfit) mark('unfit', 'is-red', '資格✗（種類の担当に必要な条件に合わない）', '資格✗');
    if (hard && !unfit)
      mark('hard', 'is-red', `守れない条件：${hard.join('・')}`, <ShieldAlert size={11} aria-hidden="true" />);
    if (subFrom) mark('sub', 'is-move', `代行（元の担当：${staffName(subFrom)}さん）`, '代', 'substitute');
    if (shift !== undefined) {
      const txt = shift > 0 ? `+${shift}分` : `−${-shift}分`;
      mark('shift', 'is-warn', `振り直す前の開始時刻からの変化 ${txt}`, txt, 'shifted');
    }
    if (pin)
      mark(
        'pin',
        'is-pin',
        'ピン（作り直しても担当を変えない）',
        <Pin size={11} strokeWidth={2.4} aria-hidden="true" />,
      );
    const memo = remembered.get(id);
    if (memo) mark('memo', 'is-memo', prefNoteText(memo), <History size={11} aria-hidden="true" />, 'pref-mark');
    if (client?.tentative) mark('tentative', 'is-tentative', '仮押さえ（本登録の前）', '仮');
    const x = { id, set: PLAN_SET };
    return {
      visitId: id,
      start,
      end,
      name: client?.displayName ?? '（不明）',
      color: type ? colorOf(type.color) : null,
      tone: hard ? 'red' : pin ? 'pinned' : null,
      picked: sel.isPicked(x),
      dragging: dragging === id,
      onPick: () => sel.togglePick(x),
      drag: dragProps(id),
      marks: icons.length > 0 ? icons : undefined,
      note: notes.join('・') || undefined,
      detail: (
        <>
          {openOf(id)}
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <strong>
              {client ? <PersonButton kind="client" id={client.id} name={client.displayName} /> : '（不明）'}
            </strong>
            <TypeMark type={type} compact />
          </div>
          {whoOf(id, sid, false)}
          {prefNoteOf(id)}
          {reassignOf(id, sid)}
          {tagsOf(id)}
          <VisitRules client={client} />
          {routeLinksOf(id, sid)}
          <ReasonBox explain={explained.get(id)} />
        </>
      ),
    };
  };

  /** 列の要素の class（落とす先・必須に合わない予告・薄い列・地図の絞り込み）。順番・時間軸で共通 */
  const colClass = (sid: string) =>
    [
      dropTo === sid ? 'is-drop' : '',
      dropTo === sid && dragging !== null && !allowedFor(dragging, sid) ? 'is-red' : '',
      rDiff && !reassignMarks.changed.has(sid) ? 'is-unchanged' : '',
      focusStaff === sid ? 'is-focus' : '',
      focusStaff && focusStaff !== sid ? 'is-dim-col' : '',
    ].join(' ');
  /** 列の見出し（名前・件数・稼働時間帯・欠勤・欠勤の人の近道・必須に合わない予告）。順番・時間軸で共通 */
  const colHeader = (sid: string) => {
    const ids = own(routes, sid) ?? [];
    const notAllowed = dropTo === sid && dragging !== null && !allowedFor(dragging, sid);
    const avail = slotsOf.get(sid);
    const s = staffById.get(sid);
    return (
      <>
        <div className="spread">
          <button
            type="button"
            className="col-head col-focus ellipsis"
            aria-pressed={focusStaff === sid}
            title={focusStaff === sid ? '地図を全員に戻す' : '地図でこの人のルートだけを見る'}
            onClick={() => {
              focusOn(focusStaff === sid ? null : sid);
            }}
          >
            <StaffMark staff={s} size="sm" />
            <span className="col-head-name">{staffName(sid)}</span>
            <MapPin size={13} className="col-focus-icon" aria-hidden="true" />
          </button>
          <span className="chip">{ids.length}件</span>
        </div>
        <div className="col-hours">
          {(avail?.slots.length ?? 0) > 0 ? (
            <span className="sub item-time">
              <Clock size={13} aria-hidden="true" />
              {slotsText(avail?.slots ?? [])}
            </span>
          ) : avail?.absence ? null : (
            <span className="chip chip-off">{s && !s.active ? '休止中' : '休み'}</span>
          )}
          {avail?.absence && (
            <span className="chip chip-red" title={avail.absence.note || undefined} data-testid="absence-mark">
              <UserRoundX size={12} aria-hidden="true" />
              {absenceText(avail.absence, avail.baseSlots)}
            </span>
          )}
          {avail?.overridden && <span className="chip chip-warn">この日だけ変更</span>}
          {suddenOn && (avail?.baseSlots.length ?? 0) > 0 && (
            <button
              type="button"
              className="link-btn absence-btn"
              onClick={() => openSudden({ kind: 'staff', staffId: sid })}
              aria-label={
                avail?.absence ? `${staffName(sid)}さんの欠勤を直す` : `この人の欠勤を登録（${staffName(sid)}さん）`
              }
            >
              {/* 入口の呼び方（PRD D231）：欠勤が無ければ「この人の欠勤を登録」、あれば「欠勤を直す」 */}
              {/* 狭い列では「この人の／欠勤を登録」の区切りで折り返す（plan.css の keep-all と wbr） */}
              {avail?.absence ? (
                '欠勤を直す'
              ) : (
                <>
                  この人の
                  <wbr />
                  欠勤を登録
                </>
              )}
            </button>
          )}
          {/*
            詳細の「i」（PRD D124）。見出しのボタン（地図の絞り込み）と入れ子にせず、名前の幅も食わないよう2行目の右端に置く
          */}
          {s && <PersonInfo kind="staff" id={sid} name={s.name} className="col-info" testId="col-info" />}
        </div>
        {reassignInfo && absentStaff.has(sid) && (
          <div className="row col-reassign" data-testid="col-reassign">
            <button type="button" className="link-btn" onClick={goToBar}>
              振り直し済み・入らない（全体） {rDiff?.unplaced.length ?? 0}件
            </button>
            {left.some((x) => x.staffId === sid) && (
              <button type="button" className="chip chip-red chip-btn" onClick={goToBar}>
                欠勤の人のまま {left.filter((x) => x.staffId === sid).length}件
              </button>
            )}
            {annealRecommended && !annealDisabled && (
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  startAnneal();
                  goToBar();
                }}
              >
                案B を作る
              </button>
            )}
          </div>
        )}
        {notAllowed && <div className="drop-warning">ここに移すと：必須の条件に合わない</div>}
      </>
    );
  };
  /** 「入らなかった訪問（未割当）」の列（ドラッグの受け口にもなる） */
  const noneCol = (
    <div
      className={[
        'route-col route-col-none',
        // ドラッグの間だけ出す空の列は最後に置き、ほかの列をずらさない（掴んだカードが指の下から逃げない）
        unassigned.length === 0 ? 'is-drag-only' : '',
        dropTo === NONE ? 'is-drop' : '',
      ].join(' ')}
      id={noneColId}
      data-staff={NONE}
      {...dropProps(NONE)}
    >
      <div className="spread">
        <strong className="col-head">
          <CircleOff size={16} aria-hidden="true" />
          入らなかった訪問（未割当）
        </strong>
        <span className="chip chip-warn">{unassigned.length}件</span>
      </div>
      {unassigned.length === 0 && <span className="sub">ここへドラッグすると未割当に戻せます</span>}
      {unassigned.map((id) => {
        // どの担当も可にならない訪問は infeasible、候補がいるのに入らない訪問は explain が理由を持つ
        const inf = problem?.infeasible.find((f) => problem.visits[f.visit]?.id === id);
        const reasons = inf?.reasons ?? explained.get(id)?.reasons ?? [];
        const client = clientOf(id);
        return (
          <div key={id} className="stack" style={{ gap: 2 }}>
            {card(id)}
            {/* 〈利用者さん〉の名前はカード（押すと選ぶ・ドラッグ）の中なので、詳細は外の i から開く（PRD D205） */}
            <div className="row unplaced-reasons" style={{ flexWrap: 'wrap', gap: 4 }}>
              {client && <PersonInfo kind="client" id={client.id} name={client.displayName} testId="unplaced-info" />}
              {/* 理由の札は符号の無い言葉（PRD D229。内部の値は title にだけ）。
                  入らなかった理由の一覧なので、（担当にできない）は付けない（札の名前が理由そのもの。title に残る） */}
              {reasons.map((r) => {
                const f = reasonFace(r);
                return (
                  <span
                    key={`${r.ruleId}:${r.label}`}
                    className="chip chip-warn"
                    title={f.title}
                    data-testid="unplaced-reason"
                  >
                    {f.text}
                    {f.note && f.note !== '担当にできない' && `（${f.note}）`}
                  </span>
                );
              })}
            </div>
            {problem && reassignMarks.unplaced.has(id) && (
              <CandidateBox
                problem={problem}
                routes={routes}
                visitId={id}
                staffName={staffName}
                visit={visitById.get(id)}
                running={!!running}
                onPlace={(c) => placeCandidate(id, c)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
  /** 時間軸の列（PRD D58） */
  const timelineCol = (sid: string): TimelineColumn => {
    const ids = own(routes, sid) ?? [];
    const avail = slotsOf.get(sid);
    const stops = ids.flatMap((id) => {
      const t = explained.get(id)?.timing;
      return t ? [t] : [];
    });
    const shadow =
      dropTo === sid && dragging !== null && problem && owner.get(dragging) !== sid
        ? shadowOf(problem, routes, dragging, sid)
        : null;
    return {
      staffId: sid,
      className: colClass(sid),
      style: { borderTopColor: colorOfStaff.get(sid) },
      drop: dropProps(sid),
      header: colHeader(sid),
      baseSlots: spansOf(avail?.baseSlots ?? []),
      slots: spansOf(avail?.slots ?? []),
      bands: ids.map((id) => bandOf(id, sid)),
      legs: stops.length === ids.length ? legsOf(stops, homeTravel(problem, staffById.get(sid), routes)) : [],
      shadow,
      emptyText: 'ここへドラッグすると移せます',
    };
  };
  /** 時間軸の区間 → 地図で強調する区間（自宅までは `home:<担当>`、来る区間は行き先の訪問） */
  const legSel = (leg: LegSpan) => ({
    id: leg.kind === 'toHome' ? homeLegKey(owner.get(leg.visitId) ?? '') : leg.visitId,
    set: PLAN_SET,
  });

  // ---- 日の画面の整理（PRD D63）：1行のまとめ・案を変えるメニュー・右の欄・表示の切り替え・地図の横置き ----
  const hardCount = cs?.hardViolations.length ?? 0;
  const hundredNow = cs && scoreScale ? toHundred(cs.total, scoreScale) : null;
  /** 物差しの下限の条件ごとの内訳（点数の理由で条件ごとの超過を比べる） */
  const scoreLower = useMemo(
    () => (scoreProblem ? (attempt(() => ruleLowerBounds(scoreProblem)).value ?? {}) : {}),
    [scoreProblem],
  );
  /** 点を下げているいちばん大きい理由（PRD D173。減点の内訳と条件ごとの達成から） */
  const reasonNow =
    cs && scoreScale && scoreProblem
      ? scoreReason(hundredBreakdown(cs, scoreScale, scoreProblem), cs, {
          achievements: curAch,
          rules: scoreRules,
          ruleLower: scoreLower,
        })
      : null;
  /** 次の一手「「移動を短く」で作る」のプリセット（初期の ID か名前。消していれば出さない。PRD D229） */
  const travelPreset = data.presets.find((p) => p.id === 'travel') ?? data.presets.find((p) => p.name === '移動を短く');
  /** 訪問の一覧（表示の「一覧」。休みのため無しの訪問も薄く出す。ADR-0013） */
  const visitList = (
    <VisitList
      visits={sortedVisits}
      visitById={visitById}
      clientById={clientById}
      ownerName={(id) => {
        if (!aiPlan) return null;
        const o = owner.get(id);
        return o ? { id: o, name: staffName(o), known: staffById.has(o) } : null;
      }}
      notes={(id) => ({
        outside: !!problem && !problem.visits.some((v) => v.id === id),
        dropped: !!aiPlan && unassigned.includes(id),
        pinned: !!own(pins, id),
        hard: hardOf.get(id),
      })}
      clientLabel={terms.client}
      typeOfVisit={(v) => typeOf(data.visitTypes, v.typeId)}
      leaveVisits={[...m.leaveVisits].sort((a, b) => a.earliestStart.localeCompare(b.earliestStart))}
      leaveNoteOf={(v) => leaveOn(data.clientLeaves, v.clientId, v.date)?.note ?? ''}
      onEdit={(id) => openVisit(id)}
      onCancel={cancelVisit}
    />
  );
  /** 担当ごとの1日（PRD D84）：今の案の列から。列と同じ人・同じ順 */
  const staffLines = useMemo(
    () =>
      problem && aiPlan
        ? dayLines(problem, aiPlan.routes, columns, (sid) => spansOf(slotsOf.get(sid)?.baseSlots ?? []))
        : [],
    [problem, aiPlan, columns, slotsOf],
  );
  const lineRange = useMemo(() => dayLineRange(staffLines), [staffLines]);
  /**
   * 担当ごとの1日から（PRD D84。一覧のときは担当ごとの表示に切り替えてから）：その人を選んで（列の見出しを押したときと同じ。
   * 地図もその人に絞る）列へ移り、列の見出しにフォーカス。visitId があればその訪問を選んで（カードを押したときと同じ。
   * 選んだままなら外さず、地図をその人に絞り直す）列の中のカードへ移る
   */
  const goToStaff = (sid: string, visitId?: string) => {
    if (shownView === 'list') setColView('timeline');
    if (visitId) {
      const x = { id: visitId, set: PLAN_SET };
      if (sel.isPicked(x)) focusOn(sid);
      else sel.togglePick(x);
    } else focusOn(sid);
    requestAnimationFrame(() => {
      const col = document.querySelector<HTMLElement>(`.route-col[data-staff="${CSS.escape(sid)}"]`);
      const card = visitId ? col?.querySelector<HTMLElement>(`[data-visit="${CSS.escape(visitId)}"]`) : null;
      if (card) {
        card.scrollIntoView({ behavior: scrollBehavior(), block: 'center', inline: 'nearest' });
        return;
      }
      col?.scrollIntoView({ behavior: scrollBehavior(), block: 'start', inline: 'nearest' });
      colHeadOf(sid)?.focus({ preventScroll: true });
    });
  };
  /** 入らなかった訪問の列へ移る（帯の近道。一覧のときは担当ごとの表示に切り替えてから） */
  const goToNone = () => {
    if (shownView === 'list') setColView('timeline');
    requestAnimationFrame(() =>
      document.getElementById(noneColId)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }),
    );
  };
  // ?do=unassigned を受けた日（PRD D201）：案ができて作っている途中でなければ1回だけ巻く。
  // 訪問が無い・入らない訪問が無いときは巻かずに終える。別の日へ移ったら忘れる
  // biome-ignore lint/correctness/useExhaustiveDependencies: 日付・案・作っている途中かが変わったときだけ
  useEffect(() => {
    const want = pendingNone.current;
    if (want === null) return;
    if (want.date !== date) {
      // 日付を切り替えている途中（setDate の直後）は待つ。その日に着いたあとでほかの日を選んだら忘れる
      if (want.arrived) pendingNone.current = null;
      return;
    }
    want.arrived = true;
    if (running || batch) {
      want.busy = true;
      return;
    }
    if (aiPlan) {
      pendingNone.current = null;
      if (unassigned.length > 0) goToNone();
      return;
    }
    // 自動作成を始めた直後（まだ作っている途中を見ていない）は待つ。それ以外で案が無い（自動作成が走らない・
    // 作れなかった・訪問が無い）なら忘れる（あとで「AI案を作る」を押したときに急に巻かない。PR #48 のレビュー）
    if (want.auto && !want.busy) return;
    pendingNone.current = null;
  }, [date, aiPlan, running, batch, problem, doParam]);
  /** この日にAI案が無いときの案内と「AI案を作る」（担当ごと・一覧のどちらの表示でも出す） */
  const noPlanCard = (
    <div className="card">
      <Empty icon={Sparkles}>
        {runningFor?.date === date ? (
          `${shortDate(date)} のAI案を${runningFor.label}条件で作っています…`
        ) : running && runningFor ? (
          `${shortDate(runningFor.date)} のAI案を作っています…（終わってから、この日の案を作れます）`
        ) : (
          <>
            この日の
            <Term k="aiPlan" />
            はまだありません。
          </>
        )}
      </Empty>
      {!running && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn btn-primary" disabled={!problem} onClick={() => recreate()}>
            <WithIcon icon={Sparkles}>AI案を作る</WithIcon>
          </button>
        </div>
      )}
    </div>
  );
  const busyWhy = running ? '計算中は選べません' : !problem ? 'この日に計算できる訪問がありません' : false;
  /** 「案を変える ▾」の項目の文（PRD D156〜D158。lib/planMenu） */
  const menuInput: PlanMenuInput = {
    hasPlan: !!aiPlan,
    edited,
    pinCount,
    unpinned,
    busy: busyWhy,
    running: !!running,
    ruleName: presetOf(planRules, data.presets)?.name ?? 'プリセットから変えた重み',
    runCount,
  };
  const createT = createText(menuInput);
  const resolveT = resolveText(menuInput);
  const revertT = revertText(menuInput);
  const compareT = compareText(menuInput);
  /**
   * 「案を変える ▾」の項目（PRD D63・D156）。利用者の目的の言葉で4つのまとまりに並べ、各項目に1行の説明（押せないときは理由）。
   * プリセットごとの案は押すと今の runPreset（カードを押したのと同じ）。手直しを捨てる操作は確認ダイアログで確かめる（今どおり）
   */
  const menuItems: MenuItem[] = [
    {
      key: 'create',
      group: 'AI に作らせる',
      testId: 'plan-menu-create',
      label: createT.label,
      description: createT.description,
      icon: Sparkles,
      disabled: createT.disabled,
      onSelect: () => recreate(),
    },
    {
      key: 'resolve',
      testId: 'plan-menu-resolve',
      label: resolveT.label,
      description: resolveT.description,
      icon: RefreshCw,
      disabled: resolveT.disabled,
      onSelect: resolve,
    },
    // 条件の重みとプリセットを切っていれば、プリセットは点数の基準の1枚だけ（王冠・まとめて作るは出さない。ADR-0028 の rules）
    ...presetCards.flatMap((c, i): MenuItem[] => {
      if (!rulesOn && c.preset.id !== basePresetId) return [];
      const first = rulesOn ? i === 0 : true;
      const isCurrent = isCurrentRun(c.run);
      const making = batch?.date === date && batch.presetId === c.preset.id;
      const pt = c.hundred !== null ? `${c.hundred}点` : '—点';
      const item: MenuItem = {
        key: `preset-${c.preset.id}`,
        group: first ? '別の考え方（プリセット）に切り替える' : undefined,
        testId: 'plan-menu-preset',
        label: c.preset.name,
        description: presetDescription({ isCurrent, making, hasRun: !!c.run, remake: c.remake, edited }),
        icon: rulesOn && i === bestCard ? Crown : undefined,
        note: making
          ? '作っています…'
          : !c.run
            ? '作る'
            : isCurrent
              ? `${pt}・今の案`
              : c.remake
                ? `${pt}・作り直す`
                : pt,
        current: isCurrent,
        // 今の案の項目は押せない理由でなく、説明の「今の案です」のまま（押しても何もしない）
        disabled: busyWhy || isCurrent,
        onSelect: () => runPreset(c.preset),
      };
      return [item];
    }),
    ...(rulesOn
      ? [
          {
            key: 'batch',
            testId: 'plan-menu-batch',
            label: `まだ作っていない考え方をまとめて作る${missing.length > 0 ? `（${missing.length}つ）` : ''}`,
            description: batchDescription(!!aiPlan),
            icon: LayoutGrid,
            disabled: batch ? '作っています' : missing.length === 0 ? 'どの考え方の案もあります' : busyWhy,
            onSelect: () => runBatch(missing),
          },
        ]
      : []),
    // 案を比べるを切っていれば比べるの項目は出さず、見出し「比べる・戻す」は戻すの項目から始める
    ...(compareOn
      ? [
          {
            key: 'compare',
            group: '比べる・戻す',
            testId: 'plan-menu-compare',
            label: compareT.label,
            description: compareT.description,
            note: `${runCount}件`,
            icon: GitCompareArrows,
            onSelect: () => navigate('/compare'),
          },
        ]
      : []),
    {
      key: 'revert',
      group: compareOn ? undefined : '比べる・戻す',
      testId: 'plan-menu-revert',
      label: revertT.label,
      description: revertT.description,
      icon: Undo2,
      disabled: revertT.disabled,
      onSelect: revert,
    },
    {
      key: 'copy',
      group: 'そのほか',
      testId: 'plan-menu-copy',
      label: '前の同じ曜日からコピー',
      description: '1週前の同じ曜日の訪問（と確定した割当）をこの日に写します',
      icon: Copy,
      disabled: visits.length > 0 ? 'この日に訪問があるときはコピーできません' : running ? '計算中は選べません' : false,
      onSelect: copyFromLastWeek,
    },
    // 条件の重みとプリセットを切っていれば「条件を調整する」は出さない（ADR-0028 の rules）
    ...(rulesOn
      ? [
          {
            key: 'tune',
            label: '条件を調整する…',
            description: '右の欄で、考え方ごとの案のカードと条件の重みを見比べて変えます',
            icon: SlidersHorizontal,
            testId: 'plan-menu-tune',
            onSelect: () => setPanel('tune'),
          },
        ]
      : []),
  ];

  /** プリセットごとの案のカード（ADR-0008・ADR-0010。右の欄「条件を調整する」の中） */
  const presetCardsView = (
    <div className="preset-cards" data-testid="preset-cards">
      {presetCards.map((c, i) => {
        const isCurrent = isCurrentRun(c.run);
        const making = batch?.date === date && batch.presetId === c.preset.id;
        const sc = c.score;
        const summary = achievementSummary(c.ach, data.rules);
        const remake = c.remake && !isCurrent;
        const pt = c.hundred !== null ? `${c.hundred}点` : '';
        // 読み上げの名前は短く（詳細は aria-describedby の中身）
        const ariaLabel = isCurrent
          ? `${c.preset.name}の案（今の案${pt ? `・${pt}` : ''}）`
          : !c.run
            ? `${c.preset.name}の案を作る`
            : remake
              ? `${c.preset.name}の案を作り直して今の案にする${pt ? `（前は${pt}）` : ''}`
              : `${c.preset.name}の案を今の案にする${pt ? `（${pt}）` : ''}`;
        // 詳細（説明・移動などの内訳・達成・作り直しの注記）は aria-describedby で読む
        const idOf = (part: string) => `${cardIdBase}-${i}-${part}`;
        const describedBy = [
          c.preset.note && idOf('note'),
          c.run && sc && idOf('stats'),
          c.run && sc && summary && idOf('ach'),
          c.run && sc && remake && idOf('remake'),
        ]
          .filter(Boolean)
          .join(' ');
        // カード全体が1つのボタン（中にボタンを入れ子にしない。中身は phrasing の span だけ）
        return (
          <button
            key={c.preset.id}
            type="button"
            className={`preset-card ${i === bestCard ? 'is-best' : ''} ${isCurrent ? 'is-current' : ''}`}
            data-testid="preset-card"
            aria-pressed={isCurrent}
            aria-disabled={isCurrent || undefined}
            aria-label={ariaLabel}
            aria-describedby={describedBy || undefined}
            disabled={!!running || !problem}
            title={
              isCurrent
                ? '今の案です'
                : !c.run
                  ? `押すと「${c.preset.name}」の重みで案を作ります`
                  : remake
                    ? `データが変わったので、押すと「${c.preset.name}」の重みで作り直します`
                    : `押すと「${c.preset.name}」の案を今の案にします（計算しません）`
            }
            onClick={() => {
              if (!isCurrent) runPreset(c.preset);
            }}
          >
            <span className="spread">
              <strong className="preset-card-name ellipsis">{c.preset.name}</strong>
              {i === bestCard && (
                <span className="preset-crown" title="一番点の高い案">
                  <Crown size={16} aria-label="一番点の高い案" />
                </span>
              )}
            </span>
            {c.preset.note && (
              <span id={idOf('note')} className="sub preset-card-note ellipsis">
                {c.preset.note}
              </span>
            )}
            {c.run && sc ? (
              <>
                <span className="preset-card-score">
                  <span data-testid="preset-card-score">{c.hundred ?? '—'}</span>
                  <small>点</small>
                </span>
                <span id={idOf('stats')} className="preset-card-stats sub">
                  <span>
                    <Car size={12} aria-hidden="true" /> 移動 {r0(sc.travelMinutes)}分
                  </span>
                  <span className={sc.dropped > 0 ? 'warn-text' : ''}>
                    <CircleOff size={12} aria-hidden="true" /> 入らない {sc.dropped}件
                  </span>
                  <span className={sc.hardViolations.length > 0 ? 'error' : ''}>
                    <ShieldAlert size={12} aria-hidden="true" /> 守れない条件 {sc.hardViolations.length}件
                  </span>
                </span>
                {summary && (
                  <span id={idOf('ach')} className="sub preset-card-ach">
                    <ListChecks size={12} aria-hidden="true" /> {summary}
                  </span>
                )}
                {remake && (
                  <span
                    id={idOf('remake')}
                    className="sub warn-text preset-card-remake"
                    data-testid="preset-card-remake"
                  >
                    <RefreshCw size={12} aria-hidden="true" /> データが変わったので、押すと作り直します
                  </span>
                )}
                {isCurrent ? (
                  <span className="chip chip-primary preset-card-now">今の案</span>
                ) : (
                  <span className="preset-card-action">{remake ? '作り直す' : 'この案にする'}</span>
                )}
              </>
            ) : (
              <span className="sub preset-card-empty">
                {making ? '作っています…' : 'まだ作っていません'}
                {!making && <span className="preset-card-action">押して作る</span>}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  /** 計算中の進み具合（操作の行・右の欄で共通） */
  const progressView = running && (
    <div className="plan-progress" data-testid="plan-progress">
      <PlanProgressText store={progressStore} prefix={runningFor ? `${shortDate(runningFor.date)} の案・` : ''} />
      {batch && (
        <span className="sub" data-testid="batch-progress">
          <WithIcon icon={LayoutGrid} size={13}>
            {shortDate(batch.date)} の案：プリセット {batch.index + 1}/{batch.total}「{batch.name}」を作っています
            {batch.date !== date ? '（別の日）' : ''}（止めると残りは作りません）
          </WithIcon>
        </span>
      )}
      <button type="button" className="btn btn-small" onClick={stop}>
        <WithIcon icon={Square} size={14}>
          止める
        </WithIcon>
      </button>
    </div>
  );

  // ---- 「欠勤・キャンセル」の欄（PRD D167〜D172）：選択肢・訪問の担当・4段目の振り直しの結果 ----
  /** いまの担当（今の案。無ければ確定した割当） */
  const suddenOwner = (visitId: string): string | null => {
    const sid = aiPlan ? owner.get(visitId) : ownerMap(m.savedView.cols).get(visitId);
    return sid && sid !== NONE ? staffName(sid) : null;
  };
  const suddenStaff = useMemo(
    () => staffChoices(staff, slotsOf, (sid) => (own(routes, sid) ?? []).length),
    [staff, slotsOf, routes],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: 訪問・〈利用者さん〉・担当が変わったときだけ
  const suddenVisits = useMemo(
    () =>
      sudden
        ? visitChoices(
            visits,
            (id) => clientById.get(id)?.displayName ?? '（不明）',
            (id) => {
              const v = visitById.get(id);
              return v ? windowText(v) : '';
            },
            suddenOwner,
          )
        : [],
    [sudden, visits, clientById, visitById, owner, m.savedView],
  );
  const suddenVisitInfo = (visitId: string) => {
    const v = visitById.get(visitId);
    return {
      client: v ? (clientById.get(v.clientId)?.displayName ?? '（不明）') : '（不明）',
      window: v ? windowText(v) : '',
      owner: suddenOwner(visitId),
    };
  };
  /**
   * 欄からの取り消し：取り消す前の担当（確定した割当があればその担当だけ（無ければ担当なし）、確定が無ければ今の案）・開始と、
   * そのときの確定した割当を覚えてから取り消す（5段目の連絡の「中止」と、確定し直した差の「前」。PRD D244）
   */
  const suddenCancelVisit = (visitId: string, sameDay: boolean) => {
    const v = visitById.get(visitId);
    const prev = own(data.manualPlans, date) ?? null;
    // 確定がある日は、未確定の案から担当を補わない（伝えてあるのは確定した担当）
    const sid = prev
      ? (ownerMap(prev).get(visitId) ?? null)
      : ((aiPlan ? owner : ownerMap(m.savedView.cols)).get(visitId) ?? null);
    if (v) {
      const start = explained.get(visitId)?.timing?.start ?? hhmmToMinutes(v.earliestStart);
      setSuddenCancel({ cancelled: { visitId, clientId: v.clientId, staffId: sid ?? null, start }, prev });
    }
    applyCancel(visitId, sameDay);
  };
  /**
   * 5段目の連絡の差（PRD D244）：欠勤は振り直しの差（元の案＝確定した割当、無ければ振り直す前の案 → 今の案＝確定した割当）。
   * キャンセルは、取り消したときの確定した割当 → 今の案（取り消した訪問は問題に無いので差に出ない）。確定が無かったら中止だけ
   */
  const suddenList = useMemo((): ContactList | null => {
    if (!sudden) return null;
    if (!suddenCancel) return contacts;
    const prev = suddenCancel.prev;
    if (!prev || !problem || !aiPlan) return EMPTY_CONTACTS;
    // 確定した割当の列は訪問データの並びなので、振り直しの元の案（baseOf）と同じに並べてから時刻を出す（偽の「時刻が変わる」を出さない）
    const before = orderConfirmed(prev, aiPlan.routes, problem);
    return attempt(() => contactsOf({ problem, routes: before }, { problem, routes: aiPlan.routes })).value ?? null;
  }, [sudden, suddenCancel, contacts, problem, aiPlan]);
  const suddenRows: ContactRow[] | null = suddenList
    ? contactRows(suddenList, suddenCancel ? [suddenCancel.cancelled] : [], contactWords)
    : null;
  /** 4段目：今の案の振り直しのまとめと、案A・案B を選ぶ欄（差の欄と同じ部品・同じ操作） */
  const suddenResult =
    aiPlan && reassignInfo ? (
      <div className="stack" style={{ gap: 8 }} data-testid="sudden-result">
        <strong>
          今の案：
          {reassignInfo.method === 'anneal' ? '案B（少し動かした案）' : '案A（空き時間に入れた案）'}
        </strong>
        {rDiff && <ReassignSummary diff={rDiff} left={left.length} testId="sudden-summary" />}
        {/* 誰のどの訪問が誰へ移るか（PRD D265）：確定の前に結果を見る */}
        {rDiff && <ReassignMoves diff={rDiff} visitLabel={visitLabel} staffName={staffName} />}
        {rDiff && rDiff.unplaced.length > 0 && (
          <p className="sub">
            入らない訪問は、下の案B を作るか、日の予定の「入らなかった訪問」の「受けられる人」から入れられます
          </p>
        )}
        <AnnealBox
          weight={stayWeight}
          onWeight={setStayWeight}
          recommended={(rDiff?.unplaced.length ?? 0) > 0 && reassignInfo.method === 'insert'}
          disabledWhy={annealDisabled}
          running={running === 'anneal'}
          progress={progressStore}
          onStart={startAnneal}
          onStop={stopAnneal}
          options={annealOptions}
          absentStaff={absentStaff}
          onChoose={chooseOption}
          stopped={!!anneal?.stopped}
          note={note}
        />
      </div>
    ) : null;
  /** 欄を閉じる（toBar：振り直したあとなので差の欄へ） */
  const closeSudden = (toBar: boolean) => {
    suddenToBar.current = toBar && !!reassignInfo;
    setSudden(null);
    if (suddenToBar.current) requestAnimationFrame(goToBar);
  };

  /** 操作の行の「その他 ▾」（PRD D279）：訪問を追加・使い方（ときどき使う操作）。メールで送るは見出しへ出した（PRD D306） */
  const moreItems: MenuItem[] = [
    {
      key: 'add',
      label: '訪問を追加',
      icon: Plus,
      disabled:
        m.clients.length === 0
          ? `${terms.client}がいません`
          : compact
            ? 'スマホの幅では訪問を足しません（パソコン・タブレットで）'
            : false,
      onSelect: () => openVisit(null),
      testId: 'plan-visit-add',
    },
    {
      key: 'help',
      label: helpOpen ? '使い方を閉じる' : '使い方',
      icon: Info,
      onSelect: () => setHelpOpen(!helpOpen),
      testId: 'plan-more-help',
    },
  ];

  return (
    <div className="plan-page stack">
      <PageHeader
        nav={<ViewSwitch current="day" />}
        icon={CalendarDays}
        title="日の予定"
        lead="その日の欠勤・手直しをして、割当を確定します"
        actions={
          aiPlan && (
            <>
              {confirmState === 'same' ? (
                <>
                  <span className="chip chip-ok" data-testid="confirm-state">
                    <CircleCheck size={12} aria-hidden="true" />
                    <Term k="confirmed">確定済み</Term>
                  </span>
                  {/* 確定したら次の確定していない日へ（PRD D224） */}
                  <NextUnconfirmed date={date} onPick={setDate} />
                </>
              ) : (
                <span className="chip chip-warn" data-testid="confirm-state">
                  <TriangleAlert size={12} aria-hidden="true" />
                  {confirmState === 'diff' ? <Term k="confirmDiff" /> : <Term k="unconfirmed" />}
                </span>
              )}
              {/* 担当ごとの予定をメールアプリで開く（PRD D92・D306。ADR-0017）。毎日送るので見出しの主ボタンの隣に枠のボタンで置く */}
              {mailOn && (
                <button type="button" className="btn" onClick={() => setPanel('mail')} data-testid="day-mail">
                  <WithIcon icon={Mail}>予定をメールで送る</WithIcon>
                </button>
              )}
              {/* 主ボタン（塗り）は「この割当で確定」だけ。確定済みの日は枠にして主ボタンを置かない（PRD D238） */}
              <button
                type="button"
                className={confirmState === 'same' ? 'btn' : 'btn btn-primary'}
                disabled={!!running || confirmState === 'same'}
                onClick={adopt}
                data-testid="adopt"
              >
                <WithIcon icon={CircleCheck}>この割当で確定</WithIcon>
              </button>
            </>
          )
        }
      />
      {/* 進み具合の帯（PRD D151・D155。この日の確定の状態も出す） */}
      <ScheduleBand date={date} withDay />
      {m.clients.length === 0 && (
        <div className="card">
          <p className="sub">先に{terms.client}を登録してください。</p>
        </div>
      )}

      {aiPlan && cs && (
        <div className="plan-oneline" data-testid="plan-summary">
          <span className="plan-oneline-title">今の案{edited ? '（手直し後）' : ''}</span>
          <span>
            訪問 <strong>{visits.length}</strong>件
          </span>
          <span className={cs.dropped > 0 ? 'warn-text' : ''}>
            <Term k="dropped" /> <strong>{cs.dropped}</strong>
          </span>
          <span className={hardCount > 0 ? 'error' : ''}>
            <Term k="hard" /> <strong>{hardCount}</strong>
          </span>
          <span>
            <Term k="travel" /> <strong>{r0(cs.travelMinutes)}</strong>分
          </span>
          {/* 点数の色（PRD D266）：入らない・必須の違反があるときだけ要対応の色。無ければ点が低くても赤にしない（D228） */}
          <span
            className={`plan-oneline-score${cs.dropped > 0 || hardCount > 0 ? ' is-alert' : ''}`}
            title={`「${scoreRulerName}」の重みで付けた点数`}
            data-testid="plan-score"
          >
            <Term k="score" /> <strong data-testid="plan-total">{hundredNow ?? '—'}</strong>点
            {hardCount > 0 && (
              <span className="chip chip-warn" title={HARD_NOTE}>
                参考
              </span>
            )}
          </span>
          {/* 点を下げているいちばん大きい理由（PRD D173） */}
          {rulesOn && reasonNow && <ScoreReasonText reason={reasonNow} testId="plan-reason" />}
          {/* いちばんの理由の次の一手（PRD D229）：移動が長い → 「移動を短く」で作る（「案を変える ▾」の項目と同じ）・入らない → 受けられる人・相性 → 相性の表。
              理由のすぐ後ろに同じ行で（上の段を詰める。PRD D237） */}
          {rulesOn && reasonNow && (
            <ScoreNextStep
              reason={reasonNow}
              date={date}
              compatOn={compatOn}
              onShortTravel={
                travelPreset && !busyWhy && presetOf(planRules, data.presets)?.id !== travelPreset.id
                  ? () => void runPreset(travelPreset)
                  : undefined
              }
            />
          )}
          <button
            type="button"
            className="link-btn plan-oneline-more"
            onClick={() => setPanel('detail')}
            data-testid="plan-detail"
          >
            <WithIcon icon={ChevronRight} size={14}>
              詳しく
            </WithIcon>
          </button>
        </div>
      )}
      {/* 担当ごとの1日（PRD D84）。今の案のある日だけ。狭い幅では畳む */}
      {aiPlan && cs && (
        <DayLines
          lines={staffLines}
          range={lineRange}
          nameOf={staffName}
          onPick={goToStaff}
          staffTerm={terms.staff}
          collapsed={narrowOrPrint}
          detailName={(sid) => staffById.get(sid)?.name ?? ''}
        />
      )}

      {/* あるときだけの帯（PRD D63）。ドラッグ中には増減しない（移したあとに変わる） */}
      {m.problemError && (
        <p className="error plan-band" role="alert">
          問題を作れませんでした：{m.problemError}
        </p>
      )}
      {error && (
        <p className="error plan-band" role="alert">
          {error}
        </p>
      )}
      {/* 手直しの記憶の確認（PRD D261・D262。ADR-0043）。モーダルにせず、答えなければ記憶しない */}
      {aiPlan && (
        <PrefAskBand rows={askRows} disabled={!!running} onYes={rememberAsked} onNo={() => setPrefAsk(null)} />
      )}
      {prefBulk && prefBulk.date === date && (
        <PrefBulkBand
          count={prefBulk.list.length}
          confirmedDays={
            new Set(
              prefBulk.list.filter((x) => x.source === 'plan' && !!own(data.manualPlans, x.date)).map((x) => x.date),
            ).size
          }
          dates={prefDatesText(prefBulk.list.map((x) => x.date))}
          staff={bulkStaff}
          disabled={!!running}
          onYes={changeFuture}
          onNo={() => setPrefBulk(null)}
        />
      )}
      {prefBulkNote && prefBulkNote.date === date && (
        <PrefBulkResult text={prefBulkNote.text} onClose={() => setPrefBulkNote(null)} />
      )}
      {aiPlan && (curScore?.error || genScore?.error) && (
        <p className="error plan-band" role="alert">
          採点できません（{curScore?.error ?? genScore?.error}）
        </p>
      )}
      {aiPlan && unassigned.length > 0 && (
        <div className="plan-band is-warn row" data-testid="band-unassigned">
          <WithIcon icon={CircleOff} size={16}>
            入らない訪問が {unassigned.length}件 あります
          </WithIcon>
          <button type="button" className="btn btn-small" onClick={goToNone}>
            見る
          </button>
        </div>
      )}
      {aiPlan && reassignInfo && (
        <div className="plan-band row" data-testid="band-reassign">
          <WithIcon icon={UserRoundX} size={16}>
            欠勤の振り直し：入らない {rDiff?.unplaced.length ?? 0}件
            {left.length > 0 ? `・欠勤の人のまま ${left.length}件` : ''}
          </WithIcon>
          <button type="button" className="btn btn-small" onClick={goToBar}>
            差の欄へ
          </button>
        </div>
      )}
      {m.leaveVisits.length > 0 && (
        <div className="plan-band row" data-testid="band-leave">
          <WithIcon icon={BedSingle} size={16}>
            {/* 名前のボタンを並べても折り返すよう、文は1つの要素に入れる（with-icon は横並び） */}
            <span className="band-text">
              {terms.client}の休みのため無し {m.leaveVisits.length}件：
              {leaveNames.map((x, i) => (
                <Fragment key={x.clientId}>
                  {i > 0 && '・'}
                  <PersonButton kind="client" id={x.clientId} name={x.name} testId="leave-name">
                    {x.name || '（不明）'}
                  </PersonButton>
                  {x.note && `（${x.note}）`}
                </Fragment>
              ))}
              {leaveInConfirmed && '。確定した日なので、必要なら作り直して確定し直してください'}
            </span>
          </WithIcon>
          <button type="button" className="btn btn-small" onClick={() => setColView('list')}>
            一覧で見る
          </button>
        </div>
      )}
      {aiPlan && planIsStale && !running && (
        <div className="plan-band stale-note row" data-testid="plan-stale">
          <WithIcon icon={TriangleAlert} size={16}>
            {/* flex の中で文が切れないよう1つの span に包む */}
            <span>
              作ったあとに、重み・訪問・{terms.staff}の情報などの<Term k="stale">条件が変わりました</Term>。
            </span>
          </WithIcon>
          <span className="sub" data-testid="plan-stale-with">
            {rebuildWith(scoreRulerName)}
          </span>
          <button type="button" className="btn btn-small" disabled={!!running || !problem} onClick={remakeStale}>
            <WithIcon icon={RefreshCw} size={14}>
              作り直す
            </WithIcon>
          </button>
        </div>
      )}
      {workloadOn && overSpan.length > 0 && (
        <div className="plan-band is-warn row" data-testid="band-over-span">
          <WithIcon icon={Timer} size={16}>
            <span className="band-text">
              出勤〜退勤（拘束）が上限の{data.org.spanLimitHours}時間を超える
              {terms.staff}：
              {overSpan.map((x, i) => {
                const name = staffById.get(x.staffId)?.name ?? '';
                return (
                  <Fragment key={x.staffId}>
                    {i > 0 && '・'}
                    {/* 1人ぶん（名前・拘束・リンク）は途中で折り返さない */}
                    <span className="over-span-item">
                      <PersonButton kind="staff" id={x.staffId} name={name} testId="over-span-name">
                        {staffName(x.staffId)}
                      </PersonButton>{' '}
                      {hmText(x.span)}
                      {/* 2人以上なら人ごとに稼働の見込みへ（主ボタンは増やさない。PRD D207） */}
                      {overSpan.length > 1 && workloadOn && (
                        <Link
                          to={workloadHref(date.slice(0, 7), x.staffId)}
                          className="over-span-link"
                          aria-label={`${staffName(x.staffId)}さんの勤務の見込み`}
                          data-testid="over-span-link"
                        >
                          勤務の見込み
                        </Link>
                      )}
                    </span>
                  </Fragment>
                );
              })}
              （{aiPlan ? '今の案' : '確定した割当'}からの見込み）
            </span>
          </WithIcon>
          {overSpan.length === 1 && workloadOn && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => navigate(workloadHref(date.slice(0, 7), overSpan[0]!.staffId))}
            >
              勤務の見込み
            </button>
          )}
        </div>
      )}
      {aiPlan && stale && !autoMade && !planIsStale && (
        <div className="plan-band is-warn row" data-testid="plan-stale-day">
          <WithIcon icon={TriangleAlert} size={16}>
            <span>
              作ったあとに、
              <Term k="dayWeights" />
              を変えました。
            </span>
          </WithIcon>
          <span className="sub">作り直すと、今の重みで組み直します。</span>
          <button type="button" className="btn btn-small" disabled={!!createT.disabled} onClick={() => recreate()}>
            <WithIcon icon={RefreshCw} size={14}>
              作り直す
            </WithIcon>
          </button>
        </div>
      )}

      <div className="plan-toolbar row" data-testid="plan-toolbar">
        {/* 急な欠勤・当日キャンセルの入口（PRD D167）。スマホでも見つけやすいよう操作の行の先頭。主ボタンにはせず枠のボタン（PRD D238） */}
        {suddenOn && (
          <button
            ref={suddenBtnRef}
            type="button"
            className="btn plan-sudden-btn"
            onClick={() => openSudden({})}
            disabled={visits.length === 0 && suddenStaff.length === 0}
            data-testid="sudden-open"
          >
            <WithIcon icon={UserRoundX}>欠勤・キャンセルを登録</WithIcon>
          </button>
        )}
        <MenuButton label="案を変える" icon={Sparkles} items={menuItems} testId="plan-menu" />
        {/* 直前の手直しを1手だけ戻す（PRD D218）。戻せないときも押せる所に残し（フォーカスを落とさない）、理由は title */}
        {aiPlan && (
          <button
            type="button"
            className="btn btn-text"
            aria-disabled={undoable ? undefined : true}
            title={undoable ? '直前の手直しを1つだけ戻します' : `戻せません：${undoWhy}`}
            onClick={() => undoable && undoEdit()}
            data-testid="plan-reassign-undo"
          >
            <WithIcon icon={Undo2}>元に戻す</WithIcon>
          </button>
        )}
        {(visits.length > 0 || m.leaveVisits.length > 0) && (
          <fieldset className="segmented seg-sm plan-view-toggle" aria-label="表示">
            {(
              [
                ['timeline', '時間軸'],
                ['order', '順番'],
                ['list', '一覧'],
              ] as const
            ).map(([k, text]) => (
              <button
                key={k}
                type="button"
                aria-pressed={shownView === k}
                className={`${shownView === k ? 'is-on' : ''} plan-view-${k}`}
                onClick={() => setColView(k)}
              >
                {text}
              </button>
            ))}
          </fieldset>
        )}
        {progressView}
        {/* 訪問を追加・使い方は「その他 ▾」にたたむ（PRD D279） */}
        <MenuButton label="その他" items={moreItems} testId="plan-more" className="plan-more" />
      </div>
      {helpOpen && (
        <div ref={helpRef} className="hint-body plan-help" tabIndex={-1} data-testid="plan-help">
          <ul className="plan-help-list">
            <li>
              担当を変えるには、訪問を別の{terms.staff}
              の列へドラッグします。訪問を押して「担当を変える」から選んでも同じです。
              移した訪問は、その人の回る順番のいちばん無駄の少ない所に入り、ピンが付きます（ピンの付いた訪問は、AI
              が作り直しても担当を変えません）。
            </li>
            <li>「入らなかった訪問」へ移すと、担当なしに戻ります。</li>
            <li>直前の1回だけ、「元に戻す」で戻せます。</li>
            <li>
              ピンの付いた訪問はそのままで、ほかを AI
              に組み直させるには「案を変える」の「固定した訪問は残して、ほかを作り直す」を使います。
            </li>
            <li>直し終わったら「この割当で確定」を押し、「予定をメールで送る」で{terms.staff}に知らせます。</li>
            <li>
              名前の下の時間は、その日に働ける時間です。約束の時間に間に合わない訪問や、働ける時間からはみ出す訪問は赤い枠になります。訪問を押すと理由が出ます。
            </li>
            <li>「自宅から」「自宅まで」や移動の時間を押すと、地図でその道のりが太くなります。</li>
            <li>
              時間軸の灰色は働かない時間・休憩、斜線は欠勤、点線の枠は待ち時間です。ドラッグしている間は、落とす列に入れられるか（緑）入れられないか（赤）が出ます。
            </li>
          </ul>
          <div>
            <button type="button" className="btn btn-small btn-text" onClick={() => setHelpOpen(false)}>
              使い方を閉じる
            </button>
          </div>
        </div>
      )}

      {visits.length === 0 && m.leaveVisits.length > 0 ? (
        visitList
      ) : visits.length === 0 ? (
        <div className="card">
          <Empty icon={CalendarDays}>
            この日の訪問はまだありません。「その他」の「訪問を追加」か、「案を変える」の「前の同じ曜日からコピー」で足せます。
          </Empty>
        </div>
      ) : (
        <div className="plan-main">
          <div className="plan-body stack">
            {aiPlan && reassignInfo && (
              <ReassignBar
                id={barId}
                info={reassignInfo}
                diff={rDiff}
                left={left}
                visitLabel={visitLabel}
                visitNode={visitNode}
                staffName={staffName}
                onReassignAgain={reassignAgain}
                cancelled={absenceCancelled}
                running={!!running}
                onRevert={revertToBase}
                onCompare={compareOn ? () => navigate('/compare', { state: { a: 'before', b: 'current' } }) : undefined}
                extraActions={<ContactButton count={contactsTotal} onOpen={() => setContactsOpen(true)} />}
              >
                <AnnealBox
                  weight={stayWeight}
                  onWeight={setStayWeight}
                  recommended={(rDiff?.unplaced.length ?? 0) > 0 && reassignInfo.method === 'insert'}
                  disabledWhy={annealDisabled}
                  running={running === 'anneal'}
                  progress={progressStore}
                  onStart={startAnneal}
                  onStop={stopAnneal}
                  options={annealOptions}
                  absentStaff={absentStaff}
                  onChoose={chooseOption}
                  stopped={!!anneal?.stopped}
                  note={note}
                />
              </ReassignBar>
            )}
            {shownView === 'list' ? (
              // 一覧でも、案が無い日は「まだありません」と作るボタンを出す（主ボタンは1画面に1〜2個）
              hasVisits && !aiPlan ? (
                <>
                  {noPlanCard}
                  {visitList}
                </>
              ) : (
                visitList
              )
            ) : !hasVisits ? null : !aiPlan ? (
              noPlanCard
            ) : (
              <div className="card stack plan-view" data-testid="plan-view">
                {shownView === 'timeline' ? (
                  <>
                    {unassigned.length > 0 && noneCol}
                    <RouteTimeline
                      columns={columns.map(timelineCol)}
                      legOn={(leg) => sel.isLeg(legSel(leg))}
                      onLeg={(leg) => sel.toggleLeg(legSel(leg))}
                    />
                    {/* 未割当が0件のときのドラッグの受け口は時間軸の下に出す（時間軸の位置を変えない） */}
                    {unassigned.length === 0 && dragging !== null && owner.has(dragging) && noneCol}
                  </>
                ) : (
                  <div className="route-grid">
                    {(unassigned.length > 0 || (dragging !== null && owner.has(dragging))) && noneCol}
                    {columns.map((sid) => {
                      const ids = own(routes, sid) ?? [];
                      return (
                        <div
                          key={sid}
                          className={`route-col ${colClass(sid)}`}
                          style={{ borderTopColor: colorOfStaff.get(sid) }}
                          data-staff={sid}
                          {...dropProps(sid)}
                        >
                          {colHeader(sid)}
                          {ids.length === 0 && <span className="sub">ここへドラッグすると移せます</span>}
                          {ids.map((id) => card(id))}
                          {homeLeg(sid)}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {aiPlan && (
            <aside ref={mapCardRef} className="card stack plan-map" aria-label="地図" data-testid="plan-map">
              <SectionTitle
                icon={MapIcon}
                aside={
                  focusStaff && (
                    <button type="button" className="btn btn-small" onClick={sel.clear}>
                      全員のルートを見る
                    </button>
                  )
                }
              >
                地図{focusStaff ? `：${staffName(focusStaff)}` : ''}
              </SectionTitle>
              <RouteMap points={points} lines={lines} height={wideMap ? 600 : 420} />
              <StaffLegend
                staffIds={columns.filter((sid) => (own(routes, sid)?.length ?? 0) > 0)}
                staffName={staffName}
                focusStaff={focusStaff}
                onFocus={focusOn}
                extra={<span className="nowrap legend-item">「家」＝自宅</span>}
              />
            </aside>
          )}
        </div>
      )}
      {aiPlan && (
        <MapDock
          target={mapCardRef}
          points={points}
          lines={lines}
          title={`地図${focusStaff ? `：${staffName(focusStaff)}` : ''}`}
          focusKey={sel.focusKey}
        />
      )}
      {aiPlan && reassignInfo && (
        <ReassignDock
          targetId={barId}
          unplaced={rDiff?.unplaced.length ?? 0}
          left={left.length}
          method={reassignInfo.method}
          annealRecommended={annealRecommended && !annealDisabled}
          annealRunning={running === 'anneal'}
          contactCount={contactsTotal}
          onGo={goToBar}
          onAnneal={() => {
            startAnneal();
            goToBar();
          }}
          onContacts={() => setContactsOpen(true)}
        />
      )}

      {problem && problem.infeasible.length > 0 && !aiPlan && (
        <div className="card stack">
          <SectionTitle icon={CircleOff}>どの{terms.staff}も担当できない訪問</SectionTitle>
          {problem.infeasible.map((f) => {
            const v = problem.visits[f.visit];
            if (!v) return null;
            return (
              <div key={v.id} className="row" style={{ flexWrap: 'wrap' }}>
                <span>{visitLabel(v.id)}</span>
                {f.reasons.map((r) => (
                  <span key={`${r.ruleId}:${r.label}`} className="chip chip-warn">
                    {r.label}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {notInProblem.length > 0 && (
        <div className="card stack">
          <SectionTitle
            icon={TriangleAlert}
            aside={
              <Hint>
                {terms.client}が休止中・位置が未登録などの訪問です（{terms.client}の画面で直せます）。
              </Hint>
            }
          >
            計算に入れなかった訪問
          </SectionTitle>
          {notInProblem.map((v) => (
            <span key={v.id}>{visitLabel(v.id)}</span>
          ))}
        </div>
      )}

      {cancelFor && (
        <SidePanel
          icon={Ban}
          narrow
          title="訪問を取り消す"
          onClose={() => setCancelFor(null)}
          footer={
            <>
              <button type="button" className="btn btn-danger" onClick={doCancel} data-testid="cancel-visit-ok">
                <WithIcon icon={Ban}>取り消す</WithIcon>
              </button>
              <button type="button" className="btn" onClick={() => setCancelFor(null)}>
                やめる
              </button>
            </>
          }
        >
          <p>
            <strong>
              {clientById.get(cancelFor.clientId)?.displayName ?? ''} {windowText(cancelFor)}
            </strong>{' '}
            の訪問を取り消します。
          </p>
          {suddenOn && (
            <>
              <fieldset className="stack cancel-kind" style={{ gap: 6 }} data-testid="cancel-kind">
                <legend>取り消しの種類</legend>
                <label className="check">
                  <input
                    type="radio"
                    name="cancel-kind"
                    checked={!cancelSameDay}
                    onChange={() => setCancelSameDay(false)}
                    style={{ width: 'auto' }}
                  />
                  ふつうの取り消し（前もって決まった休み・予定の変更など）
                </label>
                <label className="check">
                  <input
                    type="radio"
                    name="cancel-kind"
                    checked={cancelSameDay}
                    onChange={() => setCancelSameDay(true)}
                    style={{ width: 'auto' }}
                    data-testid="cancel-same-day"
                  />
                  当日キャンセル（その日になって{terms.client}の都合で取りやめ）
                </label>
              </fieldset>
              <p className="sub">
                当日キャンセルは、月の予定と{terms.client}
                ごとの集計に回数が出ます。今の案はそのままで、この訪問だけ外れます。
              </p>
            </>
          )}
        </SidePanel>
      )}

      {panel === 'detail' && (
        <SidePanel icon={Gauge} title={`今の案の詳しく${edited ? '（手直し後）' : ''}`} onClose={() => setPanel(null)}>
          {aiPlan && cs ? (
            <div className="stack" data-testid="plan-detail-panel">
              <PlanSummary
                current={cs}
                generated={gs}
                changed={genDiff?.value?.changedVisits.length ?? 0}
                problem={scoreProblem}
                scale={scoreScale}
                rulerName={scoreRulerName}
                balanceOut={(() => {
                  const b = curAch.find((x) => x.ruleId === BALANCE_RULE_KEY);
                  return b ? b.total - b.met : null;
                })()}
              />
              <span className="plan-meta">
                <Clock size={12} aria-hidden="true" />
                {new Date(aiPlan.createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} に作成・乱数の種{' '}
                {aiPlan.seed}・{aiPlan.iterations.toLocaleString()}回{aiPlan.stopped && '・途中で止めた案'}
              </span>
              {stale && autoMade && (
                <div className="sub row">
                  <WithIcon icon={TriangleAlert} size={14}>
                    「{madeBy?.name}」の重みで作った案です
                  </WithIcon>
                  <Hint>
                    この日だけの重みとは違う重みです。この日だけの重みで作るには、「案を変える」の「AI
                    にもう一度作らせる」を押します。
                  </Hint>
                </div>
              )}
              {scoreProblem && (
                <div className="stack" style={{ gap: 6 }}>
                  <strong className="balance-title">
                    <ListChecks size={15} aria-hidden="true" />
                    条件ごとの達成
                  </strong>
                  <AchievementList list={curAch} rules={data.rules} terms={terms} />
                </div>
              )}
              {scoreProblem && <BalanceChips problem={scoreProblem} routes={routes} staffName={staffName} />}
            </div>
          ) : (
            <Empty icon={Gauge}>今の案はまだありません</Empty>
          )}
        </SidePanel>
      )}
      {panel === 'mail' && mailOn && <DayMailPanel data={data} date={date} onClose={() => setPanel(null)} />}

      {panel === 'tune' && rulesOn && (
        <SidePanel icon={SlidersHorizontal} title="条件を調整する" onClose={() => setPanel(null)} focusPanel>
          <div className="stack" data-testid="plan-tune-panel">
            <SectionTitle
              icon={LayoutGrid}
              aside={
                <span className="row" style={{ gap: 6 }}>
                  <span className="sub" data-testid="preset-score-ruler">
                    <Term k="scoreBase" />：{scoreRulerName}
                  </span>
                  <Hint>
                    <ul className="hint-list">
                      <li>プリセットごとに、この日に作った案を出します。</li>
                      <li>カードを押すと、その案を今の案にします。データが変わった案は、押すと作り直します。</li>
                      <li>{rulerText(scoreRulerName)}。</li>
                      <li>王冠は、いちばん点の高い案です。</li>
                    </ul>
                  </Hint>
                </span>
              }
            >
              <span>
                <Term k="preset" />
                ごとの案
              </span>
            </SectionTitle>
            {progressView}
            {hasVisits ? presetCardsView : <span className="sub">この日に計算できる訪問がありません</span>}
            {missing.length > 0 && !batch && hasVisits && (
              <button
                type="button"
                className="btn btn-small"
                style={{ alignSelf: 'flex-start' }}
                disabled={!!running || !problem}
                onClick={() => runBatch(missing)}
              >
                <WithIcon icon={Sparkles} size={14}>
                  まだ作っていない考え方をまとめて作る（{missing.length}つ）
                </WithIcon>
              </button>
            )}
            <WeightPanel
              running={!!running}
              onRecalc={() => recreate()}
              showPresets
              canRun={!!problem}
              recalcLabel="この重みで作り直す"
            />
          </div>
        </SidePanel>
      )}
      {contactsOpen && (contacts || leftContacts.length > 0) && (
        <ContactPanel
          list={contacts ?? EMPTY_CONTACTS}
          left={leftContacts}
          words={contactWords}
          terms={terms}
          staffMail={
            mailOn
              ? (staffId, text) =>
                  mailTo(staffById.get(staffId)?.email ?? '', contactMailText(data.org, date, text), mailLimit)
              : undefined
          }
          onCopied={(ok, what) =>
            toast(ok ? `${what}をコピーしました` : 'コピーできませんでした。文を選んでコピーしてください')
          }
          onClose={() => setContactsOpen(false)}
        />
      )}
      {sudden && (
        <SuddenPanel
          key={date}
          init={sudden}
          date={date}
          data={data}
          terms={terms}
          staffList={suddenStaff}
          visitList={suddenVisits}
          slotsOf={slotsOf}
          staffName={staffName}
          visitLabel={visitLabel}
          visitInfo={suddenVisitInfo}
          running={!!running}
          hasPlan={!!aiPlan}
          confirmState={confirmState}
          result={suddenResult}
          onReassign={(a, anneal) => registerAndReassign(a, anneal, true)}
          onSaveOnly={saveAbsenceOnly}
          onRemoveAbsence={cancelAbsence}
          onCancelVisit={suddenCancelVisit}
          onAdopt={adopt}
          onRevert={reassignInfo ? revertToBase : undefined}
          contacts={suddenRows}
          leftCount={left.length}
          contactMail={
            mailOn
              ? (row) =>
                  mailTo(staffById.get(row.id)?.email ?? '', contactMailText(data.org, date, row.text), mailLimit)
              : undefined
          }
          onCopied={(ok, what) =>
            toast(ok ? `${what}をコピーしました` : 'コピーできませんでした。文を選んでコピーしてください')
          }
          onClose={closeSudden}
          fallbackFocus={() => (sudden.staffId ? colHeadOf(sudden.staffId) : suddenBtnRef.current)}
          returnFocus={() => (suddenToBar.current ? document.getElementById(barId) : null)}
        />
      )}
    </div>
  );
}

/** 時間軸をやめて順番にする幅（PRD D58） */
const NARROW_QUERY = '(max-width: 900px)';

/** 地図を時間軸の横に並べる幅（PRD D63） */
const WIDE_MAP_QUERY = '(min-width: 1280px)';

/** メディアクエリが合っているか（幅を変えたら追う） */
function useMediaLocal(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setOn(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return on;
}

/** 狭い幅（900px 以下）か印刷中か。印刷は beforeprint の中ですぐ描き直す（印刷の画像に間に合わせる） */
function useNarrowOrPrint(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(mq.matches);
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    mq.addEventListener('change', onChange);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      mq.removeEventListener('change', onChange);
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
  return narrow || printing;
}

/** 今の案の合計点（100点満点）・移動・待ち・必須の違反と、AIが出したままとの差 */
function PlanSummary({
  current,
  generated,
  changed,
  problem,
  scale,
  rulerName,
  balanceOut,
}: {
  current: PlanScore | null;
  generated: PlanScore | null;
  changed: number;
  /** 点数の基準の物差しの問題と物差し（ADR-0010） */
  problem: Problem | null;
  scale: ScoreScale | null;
  /** 点数の基準のプリセットの名前 */
  rulerName: string;
  /** 件数の目安から外れた人の数（負担の均等が無効なら null） */
  balanceOut: number | null;
}) {
  if (!current) return null;
  /** AIが出したままとの差（費用の側。低いほど良い。無ければ null） */
  const delta = (a: number, b: number | undefined, unit: string) => {
    if (b === undefined) return null;
    const d = a - b;
    if (Math.round(d * 10) === 0) return null;
    return <span className={d < 0 ? 'ok-text' : 'warn-text'}>{deltaText(d, unit)}</span>;
  };
  const note = (a: number, b: number | undefined, unit: string) => {
    const d = delta(a, b, unit);
    return d ? <>AI案から {d}</> : undefined;
  };
  const hard = current.hardViolations.length;
  const hundred = scale ? toHundred(current.total, scale) : null;
  const genHundred = scale && generated ? toHundred(generated.total, scale) : null;
  const parts = scale && problem ? hundredBreakdown(current, scale, problem) : [];
  /** 合計の note：AIが出したままと点が違えば「AI案から −3点」（高いほど良い）、同じなら減点の上位 */
  const totalNote = () => {
    if (hundred === null) return undefined;
    const d = genHundred === null ? 0 : hundred - genHundred;
    if (d !== 0) {
      return (
        <>
          AI案から <span className={d > 0 ? 'ok-text' : 'warn-text'}>{deltaText(d, '点')}</span>
        </>
      );
    }
    return breakdownText(parts) || undefined;
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="stat-row">
        <Stat
          icon={Gauge}
          label={hard > 0 ? '合計（参考）' : '合計'}
          tone="primary"
          value={hundred ?? '—'}
          unit="点"
          note={totalNote()}
        />
        <Stat
          icon={Car}
          label="移動"
          value={r0(current.travelMinutes)}
          unit="分"
          note={note(current.travelMinutes, generated?.travelMinutes, '分')}
        />
        <Stat
          icon={Hourglass}
          label={<Term k="wait" />}
          value={r0(current.waitMinutes)}
          unit="分"
          note={note(current.waitMinutes, generated?.waitMinutes, '分')}
        />
        {balanceOut !== null && (
          <Stat
            icon={Scale}
            label="目安から外れた人"
            tone={balanceOut > 0 ? 'warn' : 'ok'}
            value={balanceOut}
            unit="人"
            note={balanceOut > 0 ? `負担の均等 ${pointsText(current.balancePoints)}点` : undefined}
          />
        )}
        <Stat
          icon={hard > 0 ? ShieldAlert : ShieldCheck}
          label="守れない条件"
          tone={hard > 0 ? 'danger' : 'ok'}
          value={hard}
          unit="件"
        />
        {current.dropped > 0 && (
          <Stat icon={CircleOff} label="入らない訪問" tone="warn" value={current.dropped} unit="件" />
        )}
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        {scale && (
          <span className="sub" data-testid="score-ruler">
            <Term k="scoreBase" />：{rulerName}
          </span>
        )}
        {scale && <HundredHint cost={current.total} parts={parts} scale={scale} rulerName={rulerName} />}
        {scale && <RefMark hard={hard} />}
        {generated && (
          <Hint label="AIが出したまま">
            合計 {genHundred ?? '—'}点・移動 {r0(generated.travelMinutes)}分・空き時間（待ち）{' '}
            {r0(generated.waitMinutes)}分{changed > 0 ? `。担当を変えた訪問 ${changed}件` : '（手直しなし）'}
          </Hint>
        )}
      </div>
    </div>
  );
}

/** スタッフごとの件数と目安の帯（帯の外は色、必須の上限を超えたら赤）。名前の前は〈スタッフ〉の印（StaffMark） */
function BalanceChips({
  problem,
  routes,
  staffName,
}: {
  problem: Problem;
  routes: Record<string, string[]>;
  staffName: (id: string) => string;
}) {
  const b = problem.balance;
  const rows = problem.staff
    .map((s, i) => ({ id: s.id, i, n: own(routes, s.id)?.length ?? 0, working: s.slots.length > 0 }))
    .filter((x) => x.working || x.n > 0);
  // 横棒の目盛りの最大（件数・目安の上・必須の上限のうち最大＋余白）
  const max = Math.max(1, ...rows.map(({ i, n }) => Math.max(n, b?.hi[i] ?? 0, b?.cap?.[i] ?? 0)));
  const pct = (v: number) => `${(Math.min(v, max) / max) * 100}%`;
  return (
    <div className="stack balance" style={{ gap: 6 }}>
      <div className="spread">
        <strong className="balance-title">
          <Scale size={15} aria-hidden="true" />
          件数の偏り
        </strong>
        <Hint>
          {b ? '色のついた帯が目安です。働ける時間が長い人ほど多くなります。' : '負担の均等の条件が無効です。'}
          {b?.cap ? '必須なので、目安より1件多いところまでです。' : ''}
        </Hint>
      </div>
      {rows.map(({ id, i, n }) => {
        const lo = b?.lo[i] ?? 0;
        const hi = b?.hi[i] ?? 0;
        const over = b?.cap ? n > (b.cap[i] ?? Number.POSITIVE_INFINITY) : false;
        const out = b ? n < lo || n > hi : false;
        const tone = over ? 'red' : out ? 'warn' : 'ok';
        const band = lo === hi ? `${lo}` : `${lo}〜${hi}`;
        return (
          <div key={id} className="balance-row" title={b ? `目安 ${band}件` : ''}>
            <span className="balance-name ellipsis">
              <StaffMarkById id={id} size="xs" />
              {staffName(id)}
            </span>
            <div
              className="balance-bar"
              role="img"
              aria-label={`${staffName(id)} ${n}件${b ? `（目安 ${band}件）` : ''}`}
            >
              {b && <span className="balance-band" style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }} />}
              <span className={`balance-fill tone-${tone}`} style={{ width: pct(n) }} />
            </div>
            <span className={`balance-num tone-${tone}`}>
              {n}件{b && <small>目安 {band}</small>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 訪問の一覧の「注意」に出すもの */
type VisitNotes = {
  /** 計算に入れていない（訪問先が休止中・位置が未登録など） */
  outside: boolean;
  /** 今の案に入らなかった */
  dropped: boolean;
  /** 手直しで固定した */
  pinned: boolean;
  /** 必須の条件の違反 */
  hard?: string[];
};

/**
 * その日の訪問の一覧（時間・訪問先・所要・担当・注意・編集/取消）。表示の切り替えの「一覧」で出す（PRD D63。
 * 以前の畳んだ表をやめた）。担当は今の案での担当を出すだけ（割り当ては時間軸・順番でドラッグする）
 */
function VisitList({
  visits,
  visitById,
  clientById,
  ownerName,
  notes,
  clientLabel,
  typeOfVisit,
  leaveVisits,
  leaveNoteOf,
  onEdit,
  onCancel,
}: {
  /** 開始時刻の順の訪問ID */
  visits: string[];
  visitById: Map<string, Visit>;
  clientById: Map<string, Client>;
  /** 今の案での担当（AI案が無い・入らなかったときは null） */
  /** known：〈スタッフ〉がデータにいる（いなければ名前をボタンにしない） */
  ownerName: (id: string) => { id: string; name: string; known: boolean } | null;
  notes: (id: string) => VisitNotes;
  clientLabel: string;
  /** 訪問の種類（ADR-0012。種類なしは null） */
  typeOfVisit: (v: Visit) => VisitType | null;
  /** 〈利用者さん〉の休み（ADR-0013）のため無しの訪問（開始の順）。薄い行で後ろに出す（計算に入らない） */
  leaveVisits: Visit[];
  /** 休みの理由 */
  leaveNoteOf: (v: Visit) => string;
  onEdit: (id: string) => void;
  onCancel: (v: Visit) => void;
}) {
  /** 「固定」の説明は表の中で最初の1行だけ（PRD D241。2行目からは文字だけ） */
  const firstPinned = visits.find((id) => visitById.has(id) && notes(id).pinned);
  return (
    <section className="card stack visit-list" data-testid="visit-list">
      <SectionTitle icon={CalendarDays} aside={<span className="sub">担当は今の案のものです</span>}>
        訪問の一覧（{visits.length}件{leaveVisits.length > 0 ? `・休みのため無し ${leaveVisits.length}件` : ''}）
      </SectionTitle>
      <div className="table-scroll">
        <table className="visit-table">
          <thead>
            <tr>
              <th>
                <WithIcon icon={Clock} size={14}>
                  時間
                </WithIcon>
              </th>
              <th>{clientLabel}</th>
              <th className="num">所要</th>
              <th>担当</th>
              <th>注意</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visits.map((id) => {
              const v = visitById.get(id);
              if (!v) return null;
              const o = ownerName(id);
              const n = notes(id);
              const label = `${clientById.get(v.clientId)?.displayName ?? ''} ${windowText(v)}`;
              return (
                <tr key={id} className={o ? '' : 'row-unassigned'}>
                  <td className="nowrap">
                    <div className="time-cell">
                      <Clock size={14} aria-hidden="true" />
                      <span className="time-main">{windowText(v)}</span>
                      {v.windowKind === 'window' && <span className="time-tag">この間に開始</span>}
                    </div>
                  </td>
                  <td>
                    <ClientName client={clientById.get(v.clientId)} detail />
                    {(typeOfVisit(v) || v.pattern?.edited) && (
                      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                        <TypeMark type={typeOfVisit(v)} compact />
                        {v.pattern?.edited && (
                          <span className="chip chip-warn" title="定期パターンのこの回だけ変えた訪問">
                            この回だけの変更
                          </span>
                        )}
                      </div>
                    )}
                    {v.note && <div className="sub">{v.note}</div>}
                  </td>
                  <td className="num nowrap">{v.durationMinutes}分</td>
                  <td className="nowrap">
                    {o ? (
                      <span className="row" style={{ gap: 6 }}>
                        <StaffMarkById id={o.id} size="xs" />
                        <PersonButton kind="staff" id={o.id} name={o.known ? o.name : ''}>
                          {o.name}
                        </PersonButton>
                      </span>
                    ) : (
                      <span className="sub">未割当</span>
                    )}
                  </td>
                  <td>
                    <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                      {n.outside && <span className="chip chip-warn">計算に入れない</span>}
                      {n.dropped && <span className="chip chip-warn">入らなかった</span>}
                      {n.pinned && (
                        <span className="chip chip-pin">
                          <Pin size={12} strokeWidth={2.4} aria-hidden="true" />
                          <Term k="pinned" plain={id !== firstPinned} />
                        </span>
                      )}
                      {n.hard?.map((h) => (
                        <span key={h} className="chip chip-red" title="守れない条件">
                          <ShieldAlert size={12} aria-hidden="true" />
                          {h}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="nowrap">
                    <div className="actions">
                      <IconButton
                        icon={PanelRightOpen}
                        label={`${label}を開く`}
                        onClick={() => onEdit(id)}
                        data-testid="visit-row-open"
                        data-visit={id}
                      />
                      <IconButton icon={Ban} label={`${label}を取り消す`} tone="danger" onClick={() => onCancel(v)} />
                    </div>
                  </td>
                </tr>
              );
            })}
            {leaveVisits.map((v) => {
              const note = leaveNoteOf(v);
              const label = `${clientById.get(v.clientId)?.displayName ?? ''} ${windowText(v)}`;
              return (
                <tr key={v.id} className="row-leave" data-testid="visit-leave-row">
                  <td className="nowrap">
                    <div className="time-cell">
                      <Clock size={14} aria-hidden="true" />
                      <span className="time-main">{windowText(v)}</span>
                    </div>
                  </td>
                  <td>
                    <ClientName client={clientById.get(v.clientId)} detail />
                    <TypeMark type={typeOfVisit(v)} compact />
                  </td>
                  <td className="num nowrap">{v.durationMinutes}分</td>
                  <td className="nowrap">
                    <span className="sub">—</span>
                  </td>
                  <td>
                    <span className="chip chip-leave" title={note || undefined}>
                      <BedSingle size={12} aria-hidden="true" />
                      休みのため無し{note ? `（${note}）` : ''}
                    </span>
                  </td>
                  <td className="nowrap">
                    <div className="actions">
                      <IconButton
                        icon={PanelRightOpen}
                        label={`${label}を開く`}
                        onClick={() => onEdit(v.id)}
                        data-testid="visit-row-open"
                        data-visit={v.id}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * 訪問の詳細の「担当を変える ▾」（PRD D217。ADR-0030）：ドラッグと同じ手直しを、押す・キーボード・タッチで。
 * 候補は「受けられる人」と同じ candidatesFor（列のある人だけ）。押せる人を先に、必須の条件に合わない人は押せず理由を出す。
 * 今の担当は印を付けて押せない。担当のいる訪問は最後に「入らなかった訪問へ」。選ぶとドラッグと同じ moveTo・unassign
 */
function ReassignMenu({
  problem,
  routes,
  visitId,
  ownerId,
  pinned,
  staffIds,
  staffName,
  staffTerm,
  busy,
  onMove,
  onNone,
}: {
  problem: Problem;
  routes: Record<string, string[]>;
  visitId: string;
  ownerId: string | null;
  pinned: boolean;
  /** 列を出している人（ドラッグで落とせる人と同じ） */
  staffIds: string[];
  staffName: (id: string) => string;
  staffTerm: string;
  /** 押せない理由（計算中）。無ければ false */
  busy: string | false;
  onMove: (staffId: string) => void;
  onNone: () => void;
}) {
  /** 候補は一覧を開いているときだけ計算する（「受けられる人」の CandidateBox と同じ。訪問を選ぶ・ドラッグのたびに計算しない） */
  const [open, setOpen] = useState(false);
  const list = useMemo(
    () => (open ? (attempt(() => candidatesFor(problem, routes, visitId)).value ?? []) : []),
    [open, problem, routes, visitId],
  );
  const vi = problem.visits.findIndex((v) => v.id === visitId);
  if (vi < 0) return null;
  const shown = new Set(staffIds);
  const indexOf = (sid: string) => problem.staff.findIndex((s) => s.id === sid);
  const allowed = (sid: string) => problem.allowed[vi]?.[indexOf(sid)] === true;
  const others = list.filter((c) => c.staffId !== ownerId && shown.has(c.staffId));
  const sorted = [...others.filter((c) => allowed(c.staffId)), ...others.filter((c) => !allowed(c.staffId))];
  const items: MenuItem[] = [
    ...(ownerId
      ? [
          {
            key: `cur-${ownerId}`,
            group: '今の担当',
            testId: 'plan-reassign-current',
            label: staffName(ownerId),
            note: pinned ? 'ピン' : undefined,
            description: CURRENT_TEXT,
            current: true,
            disabled: true,
            onSelect: () => {},
          },
        ]
      : []),
    ...sorted.map((c, i): MenuItem => {
      const t = reassignItemText(c, problem.reasons[vi]?.[indexOf(c.staffId)] ?? [], allowed(c.staffId));
      return {
        key: `to-${c.staffId}`,
        group: i === 0 ? `ほかの${staffTerm}へ移す` : undefined,
        testId: 'plan-reassign-item',
        label: staffName(c.staffId),
        description: t.description,
        disabled: busy || t.disabled,
        onSelect: () => onMove(c.staffId),
      };
    }),
    // 担当の無い訪問で移せる人がいなければ、そう書く（一覧を空にしない）
    ...(!ownerId && open && sorted.length === 0
      ? [
          {
            key: 'empty',
            testId: 'plan-reassign-empty',
            label: `移せる${staffTerm}がいません`,
            disabled: true,
            onSelect: () => {},
          },
        ]
      : []),
    ...(ownerId
      ? [
          {
            key: 'none',
            group: 'そのほか',
            testId: 'plan-reassign-none',
            label: '入らなかった訪問へ',
            description: NONE_TEXT,
            icon: CircleOff,
            disabled: busy,
            onSelect: onNone,
          },
        ]
      : []),
  ];
  return (
    <div className="plan-reassign">
      <MenuButton
        label="担当を変える"
        icon={ArrowRightLeft}
        items={items}
        testId="plan-reassign"
        onOpenChange={setOpen}
      />
    </div>
  );
}
