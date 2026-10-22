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
  Gauge,
  GitCompareArrows,
  Hourglass,
  Info,
  ListChecks,
  Mail,
  Map as MapIcon,
  MapPin,
  MessageSquareText,
  PanelRightOpen,
  Pin,
  PinOff,
  Plus,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Timer,
  TriangleAlert,
  Undo2,
  UserRoundX,
  X,
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
import type { DemoData } from '../contracts/data';
import type { Absence, Client, Visit, VisitType } from '../contracts/documents';
import type { PlanScore, Problem, ScoreScale, SolveResult } from '../contracts/problem';
import type { Preset, Rule } from '../contracts/rules';
import { slotsText, timeText } from '../domain/availability';
import { leaveOn } from '../domain/leaves';
import { NONE, timeOrder, windowText } from '../domain/scheduleModel';
import { hhmmToMinutes } from '../domain/time';
import { achievements, BALANCE_RULE_KEY, hundredBreakdown, ruleLowerBounds, score, toHundred } from '../evaluate';
import {
  absencesOn,
  absenceText,
  applyReassign,
  baseOf,
  chooseReassign,
  removeAbsence,
  revertReassign,
  saveAbsence,
  withoutAbsencesOn,
} from '../lib/absences';
import { colorOf } from '../lib/colors';
import { attempt, deltaText, formError, own, pointsText, r0 } from '../lib/common';
import { confirmDay } from '../lib/confirmDay';
import { type CancelledContact, type ContactRow, clock, contactCount, contactRows, dateWordOf } from '../lib/contacts';
import { dayLineRange, dayLines } from '../lib/dayLine';
import {
  changeCount,
  ownerOf,
  pinsOf,
  routesOf,
  toldChanges,
  toldStateOf,
  type VisitIssue,
  visitIssues,
  writeRoutes,
} from '../lib/dayPlan';
import { dayUndo, undoDay, undoOf } from '../lib/dayUndo';
import { deferredDragStart } from '../lib/dragStart';
import { isDate } from '../lib/isDate';
import { UNASSIGNED_DO, workloadHref } from '../lib/links';
import { contactMailText, mailTo } from '../lib/mail';
import { HOME_LABEL } from '../lib/mapsLink';
import { issueBreakdown } from '../lib/month';
import { scrollBehavior } from '../lib/motion';
import { typeOf } from '../lib/patternText';
import { leavePeople } from '../lib/personLinks';
import { CURRENT_TEXT, NONE_TEXT, reassignChoices } from '../lib/reassignMenu';
import { buildRouteMap, homeLegKey, homeTravel, useRouteSelection } from '../lib/routeView';
import { reasonFace, scoreReason } from '../lib/scoreReason';
import { SUDDEN_DO, staffChoices, visitChoices } from '../lib/sudden';
import { type LegSpan, legsOf, shadowOf, spansOf, typeUnfitOf } from '../lib/timeline';
import { useDayModel } from '../lib/useDayModel';
import { useFeature } from '../lib/useFeature';
import { COMPACT_QUERY, useMedia } from '../lib/useMedia';
import { createValueStore, type ReadableStore, useValueStore } from '../lib/valueStore';
import { cancelVisitOp } from '../lib/visitOps';
import { hmText, workStats } from '../lib/workload';
import { bestInsertion, compile } from '../matching';
import {
  type ContactList,
  contactsOf,
  leftOf,
  placeVisit,
  prepareAnneal,
  type ReassignCandidate,
  type ReassignDiff,
  type ReassignResult,
  reassign,
  reassignDiff,
  STAY_WEIGHT_DEFAULT,
  settleAnneal,
  targetsOf,
} from '../reassign';
import { applyPreset, scorePresetOf } from '../seed';
import { defaultIterations, runSolve } from '../solver';
import './plan.css';
import './schedule.css';
import { CandidateBox, leftReasonText, ReassignBar, ReassignMoves, ReassignSummary } from './absenceParts';
import { DayMailPanel } from './mailPanels';
import {
  AchievementList,
  breakdownText,
  explainMap,
  HARD_NOTE,
  HundredHint,
  NextUnconfirmed,
  ReasonBox,
  RefMark,
  ScoreNextStep,
  ScoreReasonText,
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
 * 日の予定（D4・D13・D18。版2：ADR-0053）：その日の訪問と担当を1画面で扱う。担当・開始・ピンは訪問が持ち、列はその日の訪問の
 * 担当と開始の並び（lib/dayPlan の routesOf）。担当を替える（ドラッグ・「担当を変える ▾」）と最も費用の少ない位置に入れてピンにし、
 * 訪問に書く（writeRoutes）。「AI で組む」は提案（担当・時刻の変更の一覧と点の差）を出し、「当てる」で訪問に書く（ピンの訪問は動かさない）。
 * 提案はその場だけ（保存しない）。プリセットは「当ててみる」で提案を出すだけ。
 * 「確定」は〈スタッフ〉に伝えた内容を残す（DaySnapshot）。そのあとに変えた訪問は「未連絡の変更」になり、連絡の一覧に出る。
 * 要対応は訪問ごとの検査（担当なし・担当が休み・条件に合わない・時間に間に合わない）。点数（100点満点）は点数の基準の物差し（ADR-0010）
 */

/** 予定の画面の地図・選択で使うルートの集まりのキー（今の担当の並びは1つだけ） */
const PLAN_SET = 'plan';

/**
 * hundred：いまの最良を点数の基準の物差しで点数（100点満点）にした値（物差しを作れなければ null）。
 * 最良が変わらず Worker が bestRoutes を送らなかった進捗では、前の値のまま
 */
type Progress = { iteration: number; total: number; hundred: number | null };

/**
 * 「元に戻す」（1手。PRD D218）の控え：書く前の訪問（と振り直しの情報）と、書いたあとの訪問。
 * 書いたあとに別の操作で訪問が変わっていれば戻さない
 */

/** AI の提案（その場だけ。保存しない。ADR-0053） */
type Proposal = {
  date: string;
  /** 「点数の基準」「移動を短く」など */
  label: string;
  /** 提案の担当の並び（ピンの訪問はそのまま） */
  routes: Record<string, string[]>;
  /** 組み始めたときの訪問（変わっていれば当てない） */
  visits: readonly Visit[];
  /** 組み始めたときの欠勤（変わっていれば当てない） */
  absences: DemoData['absences'];
  stopped: boolean;
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

/** 担当の並びを問題の〈スタッフ〉の順・問題の訪問だけにそろえる（比べるため。空の列は除く） */
function routesOfIds(problem: Problem, r: Record<string, string[]>): Record<string, string[]> {
  const ids = new Set(problem.visits.map((v) => v.id));
  const out: Record<string, string[]> = {};
  for (const s of problem.staff) {
    const xs = (own(r, s.id) ?? []).filter((id) => ids.has(id));
    if (xs.length > 0) out[s.id] = xs;
  }
  return out;
}

export default function PlanPage() {
  const { date, setDate } = useDay();
  const m = useDayModel(date);
  /** 切った機能（案を比べる・稼働の見込み）の画面へ移るボタン・リンクは出さない（PRD D213。ADR-0028） */
  const compareOn = useFeature('compare');
  const workloadOn = useFeature('workload');
  /**
   * 画面の中の欄・ボタン（ADR-0028）：欠勤・キャンセル（操作の行・列の見出し・当日キャンセルの選択）、メール（ボタン・欄・連絡の一覧）、
   * 条件の重みとプリセット（プリセットを当ててみる・点数の横の理由）。欠勤の印・帯（事実）は残す
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
  /** 〈利用者さん〉の休み（ADR-0013）のため無しの訪問の〈利用者さん〉（名前から詳細を開く。理由を添える。PRD D208） */
  const leaveNames = useMemo(
    () => leavePeople(m.leaveVisits, data.clientLeaves, date, (id) => clientById.get(id)?.displayName),
    [m.leaveVisits, data.clientLeaves, date, clientById],
  );
  const toast = useToast();
  const confirmDialog = useConfirm();
  /**
   * 計算の進み具合（100msごとに変わる）。画面の state に置くと画面全体を描き直すので、外の入れ物に置き、
   * 読む子の部品（PlanProgressText・AnnealBox の進み具合）だけを描き直す（PRD D249）
   */
  const [progressStore] = useState(() => createValueStore<Progress | null>(null));
  const [running, setRunning] = useState<'create' | 'anneal' | null>(null);
  /** 計算している日と条件の名前（「組んでいます」の表示） */
  const [runningFor, setRunningFor] = useState<{ date: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 地図で見る担当・強調する区間・選んだ訪問（列の見出し・凡例・訪問・区間を押す） */
  const sel = useRouteSelection(date, (_set, id) => owner.get(id));
  const { focusStaff, focusOn } = sel;
  /** 訪問の詳細の欄（PRD D301〜D304。App の殻の欄を開く） */
  const openVisitPanel = useOpenVisit();
  /** スマホの幅（600px 以下）は訪問を足さない（ADR-0051 の決定5） */
  const compact = useMedia(COMPACT_QUERY);
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
   * 欄で取り消した訪問（5段目の連絡の「中止」。PRD D244）と、取り消す前の担当の並び・問題（連絡の差の「前」）。欄を開き直すと消す
   */
  const [suddenCancel, setSuddenCancel] = useState<{
    cancelled: CancelledContact;
    before: { problem: Problem; routes: Record<string, string[]> } | null;
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
  /** 表示（PRD D58・D63）：時間軸／順番／一覧（訪問の一覧の表）。画面の状態（初期値：時間軸） */
  const [colView, setColView] = useState<'timeline' | 'order' | 'list'>('timeline');
  /** 狭い幅（900px 以下）・印刷では時間軸の代わりに順番にする（一覧はそのまま） */
  const narrowOrPrint = useNarrowOrPrint();
  const shownView = narrowOrPrint && colView === 'timeline' ? 'order' : colView;
  /** 右の欄（PRD D63）：'detail'＝詳しく、'mail'＝予定をメールで送る */
  const [panel, setPanel] = useState<'detail' | 'mail' | null>(null);
  /** 地図は本体の下に全幅で大きく置く（PRD D300）。広い画面は地図を高くする */
  const wideMap = useMedia(WIDE_MAP_QUERY);
  /** 「担当なしの訪問」の列（帯の近道の行き先） */
  const noneColId = useId();
  const runRef = useRef<{ stop(): void } | null>(null);
  /** 「登録して、少し動かしてよい（案B）も作る」で、振り直したあとに案B を始める日（日付を変えたら null） */
  const pendingAnneal = useRef<string | null>(null);
  /**
   * 欠勤を登録して振り直したあと、差の欄へ移る（欄が閉じて振り直しが出てから）。立てた日付。
   * 日付を変えたら・少し経っても振り直しが出なければ下ろす（あとの手直しで急に移らない）
   */
  const pendingBarFocus = useRef<string | null>(null);
  /** 計算の世代。画面を離れると進め、前の世代の計算の結果は捨てる（開発時の StrictMode の付け外しでも） */
  const generation = useRef(0);
  /** いちばん新しいデータ（計算が終わったときに、最新の訪問と比べる） */
  const dataRef = useRef(data);
  dataRef.current = data;
  /** いちばん新しい点数の物差し（計算中の「いまの最良 N点」を基準の物差しで付け直す。ADR-0010） */
  const scoreRef = useRef({ problem: scoreProblem, scale: scoreScale });
  scoreRef.current = { problem: scoreProblem, scale: scoreScale };
  /** AI の提案（その場だけ。日付を変えたら捨てる） */
  const [proposal, setProposal] = useState<Proposal | null>(null);

  // 画面を離れたら Worker を止める（止めた結果は保存しない）
  useEffect(() => {
    setRunning(null);
    setRunningFor(null);
    progressStore.set(null);
    return () => {
      generation.current++;
      runRef.current?.stop();
      runRef.current = null;
    };
    // progressStore は作り直さない（一度だけ）
  }, [progressStore]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 日付を変えたら開いた欄を閉じ、前の日のエラー・提案を消す
  useEffect(() => {
    setSudden(null);
    setCancelFor(null);
    setContactsOpen(false);
    setToldOpen(false);
    setPanel(null);
    setError(null);
    setProposal(null);
    // 前の日に「案B も作る」を押して、まだ始まっていなければやめる（別の日で始めない）
    pendingAnneal.current = null;
  }, [date]);
  /** いま見ている日（計算が終わったときに、まだその日を見ているか） */
  const dateRef = useRef(date);
  dateRef.current = date;

  /** 計算に入れる訪問があるか（無い日は担当の列を出さない） */
  const hasVisits = visits.length > 0 && (!problem || problem.visits.length > 0);
  /** 今の担当の並び（版2：訪問の担当と開始の並び） */
  const routes = useMemo(() => (problem ? routesOf(problem, m.allVisits) : {}), [problem, m.allVisits]);
  /** ピン（訪問ID → 担当） */
  const pins = useMemo(() => pinsOf(m.allVisits), [m.allVisits]);
  const pinCount = Object.keys(pins).length;
  /** 今の担当の並びがあるか（計算に入れる訪問がある日） */
  const hasPlan = hasVisits && !!problem;

  // 採点はどれも点数の基準の物差し（ADR-0010）
  const curScore = useMemo(
    () => (scoreProblem && hasPlan ? attempt(() => score(scoreProblem, routes)) : null),
    [scoreProblem, hasPlan, routes],
  );
  const explained = useMemo(() => explainMap(hasPlan ? problem : null, routes), [problem, hasPlan, routes]);
  /** 今の担当の条件ごとの達成の件数（D25。点数の基準の物差し。ADR-0010） */
  const curAch = useMemo(
    () => (scoreProblem && hasPlan ? (attempt(() => achievements(scoreProblem, routes)).value ?? []) : []),
    [scoreProblem, hasPlan, routes],
  );
  /** 訪問ごとの検査（要対応。lib/dayPlan の visitIssues） */
  const issues = useMemo(
    () => (problem && hasPlan ? visitIssues(problem, routes, m.allVisits) : new Map<string, VisitIssue[]>()),
    [problem, hasPlan, routes, m.allVisits],
  );

  const staffName = (id: string) => staffById.get(id)?.name ?? '（不明）';
  const clientOf = (visitId: string) => {
    const v = visitById.get(visitId);
    return v ? clientById.get(v.clientId) : undefined;
  };
  /**
   * 訪問の詳細の経路のリンク（PRD D100。ADR-0018）：担当の今の並びの順番で、前の場所（前の訪問先、1件目は担当の自宅）から・今いる場所から。
   * 担当の決まっていない訪問は出さない。伝えたあとに変わった日（未連絡の変更あり）は「今の順番（未連絡）」と添える
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
        note={toldState === 'changed' ? '今の順番（未連絡の変更あり）' : undefined}
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

  // ---- 計算（AI で組む：提案を出す）----
  /** 計算できるか（rules を渡すと、その条件で問題を作り直す。pins はピンの訪問） */
  const check = (rules?: Rule[], quiet = false): Problem | null => {
    setError(null);
    const fail = (msg: string) => {
      if (!quiet) setError(msg);
      return null;
    };
    const latest = dataRef.current;
    const p = pinsOf(m.allVisits);
    const target = attempt(() =>
      compile(rules ? { ...latest, rules } : latest, date, Object.keys(p).length > 0 ? p : undefined),
    );
    if (!target.value) return fail(target.error ?? m.problemError ?? '問題を作れませんでした');
    if (target.value.visits.length === 0) return fail('この日に計算できる訪問がありません');
    if (target.value.staff.length === 0) return fail(`この日に働ける${terms.staff}がいません`);
    return target.value;
  };
  /** 途中の最良は、解いている条件にかかわらず点数の基準の物差しで点数にする（ADR-0010） */
  const run = (
    kind: 'create' | 'anneal',
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
        if (live()) setError(`担当を組めませんでした（${formError(e)}）`);
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
    runRef.current?.stop();
  };
  /** 案B の計算だけを止める */
  const stopAnneal = () => {
    runRef.current?.stop();
  };

  /**
   * AI で組む（提案を出す。ADR-0053）：ピンの訪問はそのままで、ほかの担当・順番を組む。preset を渡すとそのプリセットの重みで
   * （当ててみる。重みは書き換えない）、無ければ点数の基準の重み。終わったら提案（担当・時刻の変更と点の差）を出す。訪問には書かない
   */
  const propose = (preset?: Preset) => {
    if (running) return;
    const rules = preset ? applyPreset(dataRef.current.rules, preset) : undefined;
    const p = check(rules);
    if (!p) return;
    const forDate = date;
    const label = preset?.name ?? scoreRulerName;
    const startVisits = m.allVisits;
    const startAbsences = data.absences;
    run('create', p, `${label}の`, (result) => {
      setProposal({
        date: forDate,
        label,
        routes: result.routes,
        visits: startVisits,
        absences: startAbsences,
        stopped: result.stopped,
      });
      if (dateRef.current === forDate) toast(result.stopped ? '途中までの最良で提案を出しました' : '提案を出しました');
    });
  };
  /** 提案の差（今の担当 → 提案）と点数 */
  const proposalView = useMemo(() => {
    if (!proposal || proposal.date !== date || !problem) return null;
    // 提案を出したあとに訪問か欠勤が変わったら古い（欠勤は稼働時間を変えるので、出したときの問題と違う）
    const same =
      proposal.absences === data.absences &&
      proposal.visits.length === m.allVisits.length &&
      proposal.visits.every((v, i) => v === m.allVisits[i]);
    const diffv = attempt(() => reassignDiff({ problem, routes }, { problem, routes: proposal.routes }))
      .value as ReassignDiff | null;
    const hundredOf = (r: Record<string, string[]>) =>
      scoreProblem && scoreScale
        ? (attempt(() => toHundred(score(scoreProblem, r).total, scoreScale)).value ?? null)
        : null;
    return { stale: !same, diff: diffv, before: hundredOf(routes), after: hundredOf(proposal.routes) };
  }, [proposal, date, problem, routes, m.allVisits, data.absences, scoreProblem, scoreScale]);
  /** 提案を当てる（訪問に担当・開始を書く。ピンはそのまま。「元に戻す」で戻せる） */
  const applyProposal = () => {
    if (!proposal || !problem || !proposalView || running) return;
    if (proposalView.stale) {
      toast('提案を出したあとに訪問が変わりました。もう一度 AI で組んでください');
      setProposal(null);
      return;
    }
    const p = problem;
    const r = proposal.routes;
    writeWith(null, (d) => writeRoutes(d, date, p, r));
    setProposal(null);
    sel.reset();
    toast('提案を当てました', { action: undoAction });
  };

  // ---- ?do= の入口（欠勤・キャンセル・担当なしの訪問）----
  const [params, setParams] = useSearchParams();
  const doParam = params.get('do');
  /** ?do=absence で開く日（日付を切り替えたあとに開く。日付を変えると欄を閉じる effect より後で開くため）と、`&staff=` の人 */
  const pendingSudden = useRef<string | null>(null);
  const pendingSuddenStaff = useRef<string | null>(null);
  // ホームの「急な欠勤・キャンセルを登録」（?date=今日&do=absence。PRD D172）：その日を選び、「欠勤・キャンセル」の欄を1段目で開き、
  // URL から ?date= と ?do= を消す（1回だけ。戻るで繰り返さない）
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
    // その日に働く人のときだけ2段目。休みの日・最終勤務日の後の人は選択肢に無く2段目が壊れるので1段目（PR #48 のレビュー）
    const works = !!sid && (slotsOf.get(sid)?.baseSlots.length ?? 0) > 0;
    openSudden(works ? { kind: 'staff', staffId: sid } : {});
  });
  // ?date= だけのリンク（空き状況の「その日の予定を見る」。新しいタブでも開ける。PRD D204）：その日を選び、?date= を消す
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
  // 月の要対応の「担当なし」から（?date=…&do=unassigned。PRD D201）：その日を選び、URL から ?date= と ?do= を消し、
  // 担当なしの訪問の列へ巻く（1回だけ。担当なしの訪問が無くなっていれば巻かない）
  const pendingNone = useRef<string | null>(null);
  /** ?do=unassigned を受けた回数（同じ日を開いたままでも、巻く effect を走らせる） */
  const [noneAsked, setNoneAsked] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: ?do= が付いたときだけ
  useEffect(() => {
    if (doParam !== UNASSIGNED_DO) return;
    const raw = params.get('date');
    const target = raw && isDate(raw) ? raw : date;
    if (target !== date) setDate(target);
    pendingNone.current = target;
    setNoneAsked((n) => n + 1);
    setParams(
      (p) => {
        p.delete('do');
        p.delete('date');
        return p;
      },
      { replace: true },
    );
  }, [doParam]);

  // ---- 手直し：訪問を担当へ移す（最も費用の少ない位置に入れてピン）----
  const allowedFor = (visitId: string, staffId: string): boolean => {
    if (!problem) return true;
    const vi = problem.visits.findIndex((v) => v.id === visitId);
    const si = problem.staff.findIndex((s) => s.id === staffId);
    if (vi < 0) return true;
    return si >= 0 && problem.allowed[vi]?.[si] === true;
  };
  const owner = useMemo(() => ownerOf(routes), [routes]);
  /** 週間の帯から開いたときに選ぶ訪問（並びが出たら1回だけ選んで見える所へ） */
  const wantVisit = useRef<string | null>((location.state as { visitId?: string } | null)?.visitId ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 並びが出たときに1回だけ
  useEffect(() => {
    const id = wantVisit.current;
    if (!id || !hasPlan) return;
    wantVisit.current = null;
    if (owner.has(id)) sel.togglePick({ id, set: PLAN_SET });
    requestAnimationFrame(() =>
      document.querySelector(`[data-visit="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' }),
    );
  }, [hasPlan, owner]);
  /**
   * 手直しの1手前（PRD D218。ADR-0030）：書く前の訪問。画面の状態だけ（保存しない）。戻せるのは直前の1手だけ。
   * 書いたあとに訪問がほかの操作で変わったら戻さない
   */
  const undoSnap = useValueStore(dayUndo);
  const setUndoSnap = dayUndo.set;
  /** 戻せない理由（戻せれば null）。操作の行の title とトーストで共通 */
  const undoWhy = useMemo(() => {
    if (running) return '計算中です';
    if (!undoSnap) return '戻せる手直しがありません';
    if (undoSnap.date !== date) return '別の日の手直しです';
    if (data.visits !== undoSnap.after) return 'ほかの操作で予定が変わりました';
    return null;
  }, [undoSnap, date, running, data.visits]);
  const undoable = undoWhy === null;
  /**
   * 書く：書く前の訪問を控え（「元に戻す」）、fn で書いたデータにする。visitId は動かした訪問（戻したあとの選び直し）
   */
  const writeWith = (visitId: string | null, fn: (d: DemoData) => DemoData) => {
    const before = dataRef.current;
    const next = fn(before);
    if (next === before) return false;
    setUndoSnap(undoOf(date, before, next, visitId, visitId ? (owner.get(visitId) ?? null) : null));
    update((d) => (d === before ? next : fn(d)));
    return true;
  };
  /** 担当の並びとピンを訪問に書く（手直し） */
  const writeDay = (
    p: Problem,
    visitId: string,
    nextRoutes: Record<string, string[]>,
    nextPins: Record<string, string>,
  ) => writeWith(visitId, (d) => writeRoutes(d, date, p, nextRoutes, { pins: nextPins }));
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
    if (!problem || !hasPlan || running) return;
    if (owner.get(visitId) === staffId && own(pins, visitId) === staffId) return;
    const p = problem;
    const saved = writeDay(
      p,
      visitId,
      owner.get(visitId) === staffId ? routes : bestInsertion(p, routes, visitId, staffId),
      { ...pins, [visitId]: staffId },
    );
    // 移した訪問を選んでいたら、地図の絞り込みを新しい担当に合わせる
    sel.follow(visitId, staffId);
    const opts = saved ? { action: undoAction } : undefined;
    if (!allowedFor(visitId, staffId)) {
      toast(`${staffName(staffId)}さんへ移しました。必須の条件に合わないので、要対応に出ます`, opts);
    } else {
      toast(`${staffName(staffId)}さんへ移しました`, opts);
    }
  };
  /** 担当なしへ移す（列から外す。ピンは担当のピンなので外す） */
  const unassign = (visitId: string) => {
    if (!problem || !hasPlan || running || !owner.has(visitId)) return;
    const { [visitId]: _had, ...rest } = pins;
    const saved = writeDay(
      problem,
      visitId,
      Object.fromEntries(Object.entries(routes).map(([s, ids]) => [s, ids.filter((x) => x !== visitId)])),
      rest,
    );
    sel.follow(visitId, null);
    toast('担当なしにしました', saved ? { action: undoAction } : undefined);
  };
  const unpin = (visitId: string) => {
    if (!problem) return;
    const { [visitId]: _had, ...rest } = pins;
    writeDay(problem, visitId, routes, rest);
  };
  /** すべてのピンを外す（AI で組み直すと担当が変わりうる） */
  const unpinAll = async () => {
    if (!problem || pinCount === 0 || running) return;
    const ok = await confirmDialog({
      title: `ピン ${pinCount}件をすべて外しますか？`,
      body: '担当はそのままです。AI で組むと、外した訪問も担当が変わることがあります。',
      confirmLabel: 'ピンを外す',
    });
    if (!ok) return;
    const p = problem;
    writeWith(null, (d) => writeRoutes(d, date, p, routes, { pins: {} }));
    toast('ピンを外しました', { action: undoAction });
  };
  /**
   * 直前の手直しを1手だけ戻す（書く前の訪問・振り直しの情報に。控えは消す＝2手前へは戻れない）。
   * 戻せないときは理由をトーストで（トーストの「元に戻す」は押すと閉じるので、黙って消えないように）
   */
  const undoEdit = () => {
    const why = runRef.current ? '計算中です' : undoWhy;
    const u = undoSnap;
    if (why !== null || !u) {
      toast(`戻せません：${why ?? '戻せる手直しがありません'}`);
      return;
    }
    const ae = document.activeElement;
    const fromToast = !ae || ae === document.body || !!ae.closest('.toast');
    update((d) => undoDay(d, u));
    if (u.visitId) sel.follow(u.visitId, u.from);
    setUndoSnap(null);
    toast('元に戻しました');
    // トーストのボタンは押すと消えるので、戻した訪問のカードへ（操作の行から押したときはそのまま）
    if (fromToast && u.visitId) focusAfterMove(u.visitId, u.from);
  };
  useEffect(() => {
    undoRef.current = undoEdit;
  });

  // ---- 確定＝〈スタッフ〉に伝えた内容（ADR-0053）----
  /** 伝えた内容と今の違い（未連絡の変更。伝えていない日は null） */
  const told = useMemo(
    () =>
      attempt(() => toldChanges(data, date, problem && hasPlan ? problem : null, problem && hasPlan ? routes : {}))
        .value ?? null,
    [data, date, problem, hasPlan, routes],
  );
  /** 伝えた状態：none＝まだ伝えていない・told＝伝えた・changed＝伝えたあとに変わった */
  const toldState = toldStateOf(data, date, told);
  const toldCount = changeCount(told);
  /** 訪問ごとの未連絡の変更の文（「担当 A→B」「時刻 9:00→9:30」） */
  const toldMarks = useMemo(() => {
    const out = new Map<string, string>();
    const name = (id: string | null) => (id ? (staffById.get(id)?.name ?? '（不明）') : 'なし');
    for (const c of told?.staffChanged ?? []) out.set(c.visitId, `担当 ${name(c.fromStaffId)}→${name(c.toStaffId)}`);
    for (const c of told?.timeChanged ?? []) out.set(c.visitId, `時刻 ${clock(c.fromStart)}→${clock(c.toStart)}`);
    return out;
  }, [told, staffById]);
  /** 未連絡の変更の連絡の一覧を開いている */
  const [toldOpen, setToldOpen] = useState(false);
  /** 確定する（伝えた内容を残す。確定したら true） */
  const adopt = async (): Promise<boolean> => {
    // 伝えた日の訪問を全部取り消した日も、「外れる」を伝えたら確定し直せる（伝えた訪問は無し）
    if ((!hasPlan || !problem) && toldState !== 'changed') return false;
    const care = hasPlan ? issues.size : 0;
    const ok = await confirmDialog({
      title:
        toldState === 'changed' ? '変更を伝えたので、確定し直しますか？' : 'この担当と時刻を伝えたので、確定しますか？',
      body: `${care > 0 ? `要対応の訪問が ${care}件あります。\n\n` : ''}今の担当と時刻を〈${terms.staff}〉に伝えた内容として残します。このあとに変えた訪問は「未連絡の変更」になり、連絡の一覧に出ます。`,
      confirmLabel: '確定する',
    });
    if (!ok) return false;
    if (runRef.current) return false;
    const p = hasPlan ? problem : null;
    const at = Date.now();
    update((d) =>
      p ? confirmDay(d, date, p, at) : { ...d, snapshots: { ...d.snapshots, [date]: { date, at, visits: [] } } },
    );
    setUndoSnap(null);
    setToldOpen(false);
    toast('確定しました（伝えた内容を残しました）');
    return true;
  };

  // ---- 急な欠勤と振り直し（ADR-0011。PRD D26〜D32）----
  /** その日の振り直しの情報（振り直しの提案を当てた日） */
  const reassignInfo = own(data.reassigns, date) ?? null;
  /** 振り直す前の時刻を出す問題（振り直しに使った欠勤を除いたデータで compile。差・案B・連絡の一覧の before） */
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
      attempt(() => reassignDiff({ problem: reassignBefore, routes: reassignInfo.baseRoutes }, { problem, routes }))
        .value ?? null
    );
  }, [reassignInfo, reassignBefore, problem, routes]);
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

  /**
   * 「登録して振り直す」：欠勤を足したデータで compile し、今の担当の並びから振り直して訪問に書く（1回の update で書く）。
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
    if (runRef.current) return false;
    const used = absencesOn(d1, date);
    const absent = [...new Set(used.map((a) => a.staffId))];
    const result = attempt(() => {
      // 振り直す前の時刻（欠勤と重なるか）は、その日の欠勤を除いた問題で出す
      const before = { problem: compile(withoutAbsencesOn(d1, date), date), routes: base.routes };
      return reassign(p, base.routes, targetsOf(p, before, absent));
    });
    if (!result.value) {
      setError(`振り直せませんでした（${result.error}）`);
      if (stay) toast(`振り直せませんでした（${result.error}）`);
      return false;
    }
    const r = result.value;
    setAnnealResult(null);
    writeWith(null, (d) =>
      applyReassign(saveAbsence(d, absence), date, {
        problem: p,
        result: r,
        base: d === data ? base : baseOf(saveAbsence(d, absence), date, p),
        absenceIds: used.map((a) => a.id),
      }),
    );
    if (!stay) setSudden(null);
    sel.reset();
    toast(`振り直しました（振り直し ${r.placed.length}件・入らない ${r.unplaced.length}件）`);
    // 案B も作る：書き込んだ振り直しと新しい問題が画面に出てから始める（下の effect）
    if (anneal) pendingAnneal.current = date;
    if (stay) return true;
    pendingBarFocus.current = date;
    const token = date;
    window.setTimeout(() => {
      if (pendingBarFocus.current === token) pendingBarFocus.current = null;
    }, 1500);
    return true;
  };

  // ---- 案B「少し動かしてよい」・連絡の一覧（PRD D34・D35。ADR-0011 追記）----
  /** 「変更を減らす」の重み（当てた振り直しが案B ならその重み） */
  const [stayWeight, setStayWeight] = useState<number>(STAY_WEIGHT_DEFAULT);
  useEffect(() => {
    if (reassignInfo?.stayWeight !== undefined) setStayWeight(reassignInfo.stayWeight);
  }, [reassignInfo?.stayWeight]);
  /** 案B を案A のままにした理由（settleAnneal。key が今の振り直しと違えば見せない） */
  const [annealNote, setAnnealNote] = useState<{ key: string; text: string } | null>(null);
  const [contactsOpen, setContactsOpen] = useState(false);
  /** 案A の列（振り直した直後） */
  const planA = useMemo(() => {
    if (!reassignInfo || !problem) return null;
    const r = reassignInfo.insertRoutes ?? (reassignInfo.method === 'insert' ? routes : undefined);
    if (!r) return null;
    const ids = new Set(problem.visits.map((v) => v.id));
    return Object.fromEntries(Object.entries(r).map(([k, xs]) => [k, xs.filter((id) => ids.has(id))]));
  }, [reassignInfo, problem, routes]);
  /** 今の振り直し（元の案・欠勤・案A）のキー。案B の結果がこの振り直しのものか */
  const annealKey = reassignInfo
    ? JSON.stringify([date, reassignInfo.baseRoutes, reassignInfo.absenceIds, reassignInfo.insertRoutes ?? null])
    : null;
  /** 作った案B（その場だけ。保存しない。決定2） */
  const [annealResult, setAnnealResult] = useState<{
    key: string;
    weight: number;
    result: ReassignResult;
    stopped: boolean;
  } | null>(null);
  const anneal = annealResult && annealResult.key === annealKey ? annealResult : null;
  const note = annealNote && annealNote.key === annealKey ? annealNote.text : null;
  /** 振り直しに使った欠勤の人（まだある欠勤） */
  const absentStaff = useMemo(() => {
    const ids = new Set(reassignInfo?.absenceIds ?? []);
    return new Set(data.absences.filter((a) => ids.has(a.id) && a.date === date).map((a) => a.staffId));
  }, [reassignInfo, data.absences, date]);
  /** 欠勤の人に残る、欠勤と重なる訪問（手直しで戻した等。leftOf） */
  const left = useMemo(() => {
    if (!reassignInfo || !problem || !reassignBefore || absentStaff.size === 0) return [];
    return attempt(() => leftOf(problem, { problem: reassignBefore, routes }, [...absentStaff])).value ?? [];
  }, [reassignInfo, problem, reassignBefore, absentStaff, routes]);
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: 振り直しが画面に出たときに1回だけ
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
  /** もう一度振り直す（欠勤の人に残る訪問を、今の並びから振り直す。続けて振り直すのと同じ） */
  const reassignAgain = () => {
    const a = data.absences.find((x) => x.date === date && absentStaff.has(x.staffId));
    if (!a) return;
    void registerAndReassign(a);
  };
  const annealDisabled = !reassignInfo
    ? '振り直しがありません'
    : absenceCancelled
      ? '欠勤が取り消されているので作れません'
      : !planA
        ? '案A がありません'
        : running && running !== 'anneal'
          ? '計算中は押せません'
          : null;
  /** 案B を Worker で作る（進み具合・止める）。初期解は案A。作った案B はその場だけ（選ぶと訪問に書く） */
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
    // 案A の列が使えない人（必須の違反・回れない列）は、その列だけ案A のまま動かさずに作る
    const heldText =
      x.held.length > 0
        ? `${x.held.map(staffName).join('・')}さんの列は案A に守れない条件があるため、案A のまま動かしていません（その列は手で直してください）`
        : null;
    setAnnealNote(heldText ? { key, text: heldText } : null);
    const routesA = planA;
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
        setAnnealResult({ key, weight, result: got.result, stopped: res.stopped });
        const sameAsA = JSON.stringify(got.result.routes) === JSON.stringify(routesA);
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
  // 「登録して、少し動かしてよい（案B）も作る」：振り直しが出たら案B を始める
  // biome-ignore lint/correctness/useExhaustiveDependencies: 振り直しと問題が出そろったときに1回だけ
  useEffect(() => {
    if (pendingAnneal.current !== date || !reassignInfo || !problem || !planA || running) return;
    pendingAnneal.current = null;
    startAnneal();
  }, [reassignInfo, problem, planA, running, date]);
  /** 案A・案B のどちらかを当てる */
  const chooseOption = async (key: 'insert' | 'anneal') => {
    if (!problem || !reassignInfo || running) return;
    // 今の並びが案A・案B のどちらとも違う（手直しした）ときだけ確認する
    if (
      !annealOptions.some((o) => o.current) &&
      !(await confirmDialog({
        title: `手直しを捨てて${key === 'anneal' ? '案B' : '案A'}に切り替えますか？`,
        body: '今の担当の手直しは消えます。',
        confirmLabel: '捨てて切り替える',
        tone: 'danger',
      }))
    )
      return;
    if (runRef.current) return;
    const p = problem;
    if (key === 'anneal') {
      if (!anneal) return;
      const b = anneal;
      writeWith(null, (d) =>
        chooseReassign(d, date, { problem: p, result: b.result, method: 'anneal', stayWeight: b.weight }),
      );
      toast('案B（少し動かした案）を当てました', { action: undoAction });
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
      writeWith(null, (d) => chooseReassign(d, date, { problem: p, result: resultA, method: 'insert' }));
      toast('案A（空き時間に入れた案）を当てました', { action: undoAction });
    }
    sel.reset();
  };
  /** 案A・案B の比べる数（元の案との差・点数の基準の物差しの点数） */
  const annealOptions: ReassignOption[] = useMemo(() => {
    if (!problem || !reassignInfo || !reassignBefore) return [];
    const before = { problem: reassignBefore, routes: reassignInfo.baseRoutes };
    const norm = (r: Record<string, string[]>) => JSON.stringify(routesOfIds(problem, r));
    const cur = norm(routes);
    const option = (key: ReassignOption['key'], title: string, r: Record<string, string[]>): ReassignOption => ({
      key,
      title,
      diff: attempt(() => reassignDiff(before, { problem, routes: r })).value,
      hundred:
        scoreProblem && scoreScale
          ? (attempt(() => toHundred(score(scoreProblem, r).total, scoreScale)).value ?? null)
          : null,
      current: norm(r) === cur,
    });
    const out: ReassignOption[] = [];
    if (planA) out.push(option('insert', '案A（空き時間に入れる）', planA));
    if (anneal) out.push(option('anneal', `案B（変更を減らす ${anneal.weight}）`, anneal.result.routes));
    // 作った案B が無い（再読込・画面を移った）が当てたのが案B なら、今の並びを案B として並べる（案A に戻せる）
    else if (reassignInfo.method === 'anneal')
      out.push(option('anneal', `案B（変更を減らす ${reassignInfo.stayWeight ?? ''}）`, routes));
    return out;
  }, [problem, reassignInfo, reassignBefore, routes, planA, anneal, scoreProblem, scoreScale]);
  /** 連絡の一覧（振り直す前と今の差。確定前でも見られる） */
  const contacts = useMemo(() => {
    if (!reassignInfo || !problem || !reassignBefore) return null;
    return (
      attempt(() => contactsOf({ problem: reassignBefore, routes: reassignInfo.baseRoutes }, { problem, routes }))
        .value ?? null
    );
  }, [reassignInfo, reassignBefore, problem, routes]);
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
  /** 案B を勧める（案A で入らない訪問があり、当てたのが案A で、まだ案B を作っていない） */
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
    visitMinutes: (id: string) => m.allVisits.find((v) => v.id === id)?.durationMinutes ?? null,
    promised: (id: string) => {
      const v = m.allVisits.find((x) => x.id === id);
      if (!v) return null;
      const from = hhmmToMinutes(v.earliestStart);
      return { from, to: v.windowKind === 'window' ? hhmmToMinutes(v.latestStart) : from };
    },
    orgName: data.org.name,
  };
  const saveAbsenceOnly = (absence: Absence) => {
    update((d) => saveAbsence(d, absence));
    setSudden(null);
    toast('欠勤を登録しました（担当はそのままです。休む人の訪問は要対応に出ます）');
  };
  const cancelAbsence = async (absence: Absence): Promise<boolean> => {
    const ok = await confirmDialog({
      title: `${staffName(absence.staffId)}さんの欠勤を取り消しますか？`,
      body: '担当はそのままです。',
      confirmLabel: '欠勤を取り消す',
      cancelLabel: '残しておく',
      tone: 'danger',
    });
    if (!ok) return false;
    update((d) => removeAbsence(d, absence.id));
    setSudden(null);
    toast(
      reassignInfo
        ? '欠勤を取り消しました。担当を戻すには「振り直す前に戻す」を押してください'
        : '欠勤を取り消しました',
    );
    return true;
  };
  const revertToBase = async (): Promise<boolean> => {
    if (!problem || !reassignInfo) return false;
    const ok = await confirmDialog({
      title: '振り直す前の担当に戻しますか？',
      body: '振り直す前の担当とピンに戻します。',
      confirmLabel: '振り直す前に戻す',
    });
    if (!ok) return false;
    if (runRef.current) return false;
    const p = problem;
    writeWith(null, (d) => revertReassign(d, date, p));
    setAnnealResult(null);
    sel.reset();
    toast('振り直す前に戻しました', { action: undoAction });
    return true;
  };
  /**
   * 担当なしの訪問を候補の人に入れる（ピン。時刻は変えない。間に合わなければ要対応の赤い枠）。
   * その人の既存の訪問の開始が遅れるときは確認を出す
   */
  const placeCandidate = async (visitId: string, c: ReassignCandidate) => {
    if (!problem || !hasPlan || running) return;
    const staffId = c.staffId;
    if (
      c.delayedCount > 0 &&
      !(await confirmDialog({
        title: `${staffName(staffId)}さんに入れますか？`,
        body: `${staffName(staffId)}さんの訪問 ${c.delayedCount}件の開始が最大 +${c.maxDelayMinutes}分 遅れます。`,
        confirmLabel: '遅れても入れる',
      }))
    )
      return;
    if (runRef.current) return;
    const p = problem;
    const saved = writeDay(p, visitId, placeVisit(p, routes, visitId, staffId), { ...pins, [visitId]: staffId });
    sel.follow(visitId, staffId);
    toast(`${staffName(staffId)}さんに入れました`, saved ? { action: undoAction } : undefined);
  };

  // ---- 訪問の取消 ----
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
   * （回数を数えるだけ。請求はしない。ADR-0015）。ほかの担当はそのままで、この訪問は計算から外れる
   */
  const applyCancel = (visitId: string, sameDay: boolean) => {
    const v = m.allVisits.find((x) => x.id === visitId && !x.cancelled);
    if (!v) return;
    writeWith(visitId, (d) => cancelVisitOp(d, visitId, sameDay));
    toast(sameDay ? '当日キャンセルとして取り消しました' : '取り消しました', { action: undoAction });
  };
  /** 拘束が上限を超える人（稼働の見込み。PRD D72。ADR-0015）。今の担当の並びで見る */
  const overSpan = useMemo(() => {
    if (!problem || !hasPlan) return [];
    return workStats(problem, routes, data.org).filter((x) => x.over);
  }, [problem, hasPlan, routes, data.org]);

  // ---- 列：その日に働く人（と、訪問の担当になっている人）----
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
  /** 担当なしの訪問（問題の訪問のうち列に無いもの。問題の順） */
  const unassigned = useMemo(() => {
    if (!problem || !hasPlan) return [];
    return problem.visits.map((v) => v.id).filter((id) => !owner.has(id));
  }, [problem, hasPlan, owner]);
  /** 要対応の文（担当なし・担当が休みなど）の訪問ごとの一覧（カード・帯の赤い印） */
  const hardOf = useMemo(() => {
    const h = new Map<string, string[]>();
    for (const [id, list] of issues) {
      const xs = list.filter((x) => x.kind !== 'unassigned').map((x) => x.label);
      if (xs.length > 0) h.set(id, xs);
    }
    return h;
  }, [issues]);
  /** 要対応の件数と内訳 */
  const careCount = issues.size;
  const careParts = useMemo(() => issueBreakdown(issues), [issues]);

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

  // ---- 地図：今の担当の並び（担当ごとの色の実線）----
  const { points, lines } = useMemo(
    () =>
      hasPlan
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
      hasPlan,
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
    const told = toldMarks.get(id);
    if (!(pin || hard || subFrom || shift !== undefined || stay || told)) return null;
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
          <span className="chip chip-pin" title={pinHint ? undefined : 'ピン（AI で組み直しても担当を変えない）'}>
            <Pin size={12} strokeWidth={2.4} aria-hidden="true" />
            <Term k="pinned" plain={!pinHint} />
          </span>
        )}
        {told && (
          <span className="chip chip-warn" title={`未連絡の変更：${told}`} data-testid="told-mark">
            <MessageSquareText size={12} aria-hidden="true" />
            未連絡
            <span className="sr-only">（{told}）</span>
          </span>
        )}
        {hard?.map((h) => (
          <span key={h} className="chip chip-red" title="要対応" data-testid="issue-mark">
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
            data-testid="unpin"
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
    if (!problem || !hasPlan) return null;
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
      mark('hard', 'is-red', `要対応：${hard.join('・')}`, <ShieldAlert size={11} aria-hidden="true" />, 'issue-mark');
    if (subFrom) mark('sub', 'is-move', `代行（元の担当：${staffName(subFrom)}さん）`, '代', 'substitute');
    if (shift !== undefined) {
      const txt = shift > 0 ? `+${shift}分` : `−${-shift}分`;
      mark('shift', 'is-warn', `振り直す前の開始時刻からの変化 ${txt}`, txt, 'shifted');
    }
    if (pin)
      mark(
        'pin',
        'is-pin',
        'ピン（AI で組み直しても担当を変えない）',
        <Pin size={11} strokeWidth={2.4} aria-hidden="true" />,
      );
    const told = toldMarks.get(id);
    if (told)
      mark('told', 'is-warn', `未連絡の変更：${told}`, <MessageSquareText size={11} aria-hidden="true" />, 'told-mark');
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
  /** 「担当なしの訪問」の列（ドラッグの受け口にもなる） */
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
          担当なしの訪問
        </strong>
        <span className="chip chip-warn">{unassigned.length}件</span>
      </div>
      {unassigned.length === 0 && <span className="sub">ここへドラッグすると担当なしにできます</span>}
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
                  担当なしの理由の一覧なので、（担当にできない）は付けない（札の名前が理由そのもの。title に残る） */}
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
  /** 次の一手「「移動を短く」で組む」のプリセット（初期の ID か名前。消していれば出さない。PRD D229） */
  const travelPreset = data.presets.find((p) => p.id === 'travel') ?? data.presets.find((p) => p.name === '移動を短く');
  /** 訪問の一覧（表示の「一覧」。休みのため無しの訪問も薄く出す。ADR-0013） */
  const visitList = (
    <VisitList
      visits={sortedVisits}
      visitById={visitById}
      clientById={clientById}
      ownerName={(id) => {
        const o = owner.get(id);
        return o ? { id: o, name: staffName(o), known: staffById.has(o) } : null;
      }}
      notes={(id) => ({
        outside: !!problem && !problem.visits.some((v) => v.id === id),
        dropped: unassigned.includes(id),
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
  /** 担当ごとの1日（PRD D84）：今の担当の並びから。列と同じ人・同じ順 */
  const staffLines = useMemo(
    () =>
      problem && hasPlan ? dayLines(problem, routes, columns, (sid) => spansOf(slotsOf.get(sid)?.baseSlots ?? [])) : [],
    [problem, hasPlan, routes, columns, slotsOf],
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
  /** 担当なしの訪問の列へ移る（帯の近道。一覧のときは担当ごとの表示に切り替えてから） */
  const goToNone = () => {
    if (shownView === 'list') setColView('timeline');
    requestAnimationFrame(() =>
      document.getElementById(noneColId)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }),
    );
  };
  // ?do=unassigned を受けた日（PRD D201）：並びが出ていれば1回だけ巻く。担当なしの訪問が無いときは巻かずに終える
  // biome-ignore lint/correctness/useExhaustiveDependencies: 日付・並びが変わったときだけ
  useEffect(() => {
    if (pendingNone.current === null || pendingNone.current !== date || !problem) return;
    pendingNone.current = null;
    if (unassigned.length > 0) goToNone();
  }, [date, problem, unassigned.length, noneAsked]);

  const busyWhy = running ? '計算中は選べません' : !problem ? 'この日に計算できる訪問がありません' : false;
  /** 点数の基準のプリセットの ID（当ててみるのは、ほかのプリセット） */
  const basePresetId = scorePresetOf(data.presets, data.scorePresetId)?.id;
  /**
   * 「AI で組む ▾」の項目（ADR-0053）：AI で組む（点数の基準の重みで提案を出す）・プリセットを当ててみる（その重みで提案を出す。
   * 重みは書き換えない）・提案を比べる・ピンをすべて外す。提案は「当てる」まで訪問を変えない
   */
  const menuItems: MenuItem[] = [
    {
      key: 'create',
      group: 'AI で組む（提案を出す）',
      testId: 'plan-menu-create',
      label: `AI で組む（${scoreRulerName}）`,
      description:
        pinCount > 0
          ? `ピンの ${pinCount}件はそのままで、ほかの担当・順番の提案を出します（当てるまで担当は変わりません）`
          : '担当・順番の提案を出します（当てるまで担当は変わりません）',
      icon: Sparkles,
      disabled: busyWhy,
      onSelect: () => propose(),
    },
    ...(rulesOn
      ? data.presets
          .filter((pr) => pr.id !== basePresetId)
          .map(
            (pr, i): MenuItem => ({
              key: `preset-${pr.id}`,
              group: i === 0 ? 'プリセットを当ててみる' : undefined,
              testId: 'plan-menu-preset',
              label: `「${pr.name}」で組む`,
              description: pr.note
                ? `${pr.note}（この重みの提案を出します。重みは変えません）`
                : `「${pr.name}」の重みで提案を出します（重みは変えません）`,
              disabled: busyWhy,
              onSelect: () => propose(pr),
            }),
          )
      : []),
    ...(compareOn
      ? [
          {
            key: 'compare',
            group: '比べる',
            testId: 'plan-menu-compare',
            label: 'プリセットの提案を比べる',
            description: '考え方ごとの提案をその場で作って並べます（保存しません）',
            icon: GitCompareArrows,
            onSelect: () => navigate('/compare'),
          },
        ]
      : []),
    {
      key: 'unpin',
      group: 'そのほか',
      testId: 'plan-menu-unpin',
      label: `ピンをすべて外す${pinCount > 0 ? `（${pinCount}件）` : ''}`,
      description: '担当はそのままです。AI で組むと、外した訪問も担当が変わることがあります',
      icon: PinOff,
      disabled: pinCount === 0 ? 'ピンの付いた訪問はありません' : busyWhy,
      onSelect: () => void unpinAll(),
    },
  ];

  /** 計算中の進み具合（操作の行） */
  const progressView = running && (
    <div className="plan-progress" data-testid="plan-progress">
      <PlanProgressText
        store={progressStore}
        prefix={
          runningFor
            ? `${shortDate(runningFor.date)} の${runningFor.label}${running === 'anneal' ? '案B・' : '提案・'}`
            : ''
        }
      />
      <button type="button" className="btn btn-small" onClick={stop}>
        <WithIcon icon={Square} size={14}>
          止める
        </WithIcon>
      </button>
    </div>
  );

  // ---- 「欠勤・キャンセル」の欄（PRD D167〜D172）：選択肢・訪問の担当・4段目の振り直しの結果 ----
  /** いまの担当（訪問の担当） */
  const suddenOwner = (visitId: string): string | null => {
    const sid = owner.get(visitId);
    return sid ? staffName(sid) : null;
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
    [sudden, visits, clientById, visitById, owner],
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
   * 欄からの取り消し：取り消す前の担当・開始と、取り消す前の担当の並び（取り消す訪問を除く）を覚えてから取り消す
   * （5段目の連絡の「中止」と差の「前」。PRD D244）
   */
  const suddenCancelVisit = (visitId: string, sameDay: boolean) => {
    const v = visitById.get(visitId);
    const sid = owner.get(visitId) ?? null;
    if (v && problem) {
      const start = explained.get(visitId)?.timing?.start ?? hhmmToMinutes(v.earliestStart);
      const before = Object.fromEntries(
        Object.entries(routes).map(([k, ids]) => [k, ids.filter((x) => x !== visitId)]),
      );
      setSuddenCancel({
        cancelled: { visitId, clientId: v.clientId, staffId: sid, start },
        before: { problem, routes: before },
      });
    }
    applyCancel(visitId, sameDay);
  };
  /**
   * 5段目の連絡の差（PRD D244）：欠勤は振り直しの差（振り直す前 → 今）。キャンセルは取り消す前の並び → 今
   * （取り消した訪問は「中止」として別に出す）
   */
  const suddenList = useMemo((): ContactList | null => {
    if (!sudden) return null;
    // 伝えた日は、伝えた内容 → 今の差（欠勤の振り直しのほか、手で変えた訪問も。「連絡したので確定」で伝えたことにするもの）。
    // 取り消した訪問は「中止」として別に出すので、差からは外す
    if (told) return suddenCancel ? withoutVisit(told, suddenCancel.cancelled.visitId) : told;
    if (!suddenCancel) return contacts;
    const b = suddenCancel.before;
    if (!b || !problem) return EMPTY_CONTACTS;
    return attempt(() => contactsOf({ problem, routes: b.routes }, { problem, routes })).value ?? null;
  }, [sudden, suddenCancel, contacts, problem, routes, told]);
  const suddenRows: ContactRow[] | null = suddenList
    ? contactRows(suddenList, suddenCancel ? [suddenCancel.cancelled] : [], contactWords)
    : null;
  /** 4段目：今の案の振り直しのまとめと、案A・案B を選ぶ欄（差の欄と同じ部品・同じ操作） */
  const suddenResult =
    hasPlan && reassignInfo ? (
      <div className="stack" style={{ gap: 8 }} data-testid="sudden-result">
        <strong>
          当てた振り直し：
          {reassignInfo.method === 'anneal' ? '案B（少し動かした案）' : '案A（空き時間に入れた案）'}
        </strong>
        {rDiff && <ReassignSummary diff={rDiff} left={left.length} testId="sudden-summary" />}
        {/* 誰のどの訪問が誰へ移るか（PRD D265）：確定の前に結果を見る */}
        {rDiff && <ReassignMoves diff={rDiff} visitLabel={visitLabel} staffName={staffName} />}
        {rDiff && rDiff.unplaced.length > 0 && (
          <p className="sub">
            入らない訪問は、下の案B を作るか、日の予定の「担当なしの訪問」の「受けられる人」から入れられます
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
        lead="その日の担当を見て直し、〈スタッフ〉に伝えたら確定します"
        actions={
          (hasPlan || toldState === 'changed') && (
            <>
              {toldState === 'told' ? (
                <>
                  <span className="chip chip-ok" data-testid="confirm-state">
                    <CircleCheck size={12} aria-hidden="true" />
                    <Term k="confirmed">確定済み</Term>
                  </span>
                  {/* 確定したら次の確定していない日へ（PRD D224） */}
                  <NextUnconfirmed date={date} onPick={setDate} />
                </>
              ) : toldState === 'changed' ? (
                <button
                  type="button"
                  className="chip chip-warn chip-btn"
                  onClick={() => setToldOpen(true)}
                  data-testid="confirm-state"
                  title="伝えたあとに変わった訪問の連絡の一覧を開く"
                >
                  <TriangleAlert size={12} aria-hidden="true" />
                  <Term k="confirmDiff">未連絡の変更あり</Term> {toldCount}件
                </button>
              ) : (
                <span className="chip chip-warn" data-testid="confirm-state">
                  <TriangleAlert size={12} aria-hidden="true" />
                  <Term k="unconfirmed">まだ伝えていない</Term>
                </span>
              )}
              {/* 担当ごとの予定をメールアプリで開く（PRD D92・D306。ADR-0017）。毎日送るので見出しの主ボタンの隣に枠のボタンで置く */}
              {mailOn && (
                <button type="button" className="btn" onClick={() => setPanel('mail')} data-testid="day-mail">
                  <WithIcon icon={Mail}>予定をメールで送る</WithIcon>
                </button>
              )}
              {/* 主ボタン（塗り）は「確定」だけ。確定済みの日は枠にして主ボタンを置かない（PRD D238） */}
              <button
                type="button"
                className={toldState === 'told' ? 'btn' : 'btn btn-primary'}
                disabled={!!running || toldState === 'told'}
                onClick={adopt}
                data-testid="adopt"
                title="今の担当と時刻を〈スタッフ〉に伝えたら押します"
              >
                <WithIcon icon={CircleCheck}>
                  {toldState === 'changed' ? '確定し直す（伝えた）' : '確定（伝えた）'}
                </WithIcon>
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

      {hasPlan && cs && (
        <div className="plan-oneline" data-testid="plan-summary">
          <span className="plan-oneline-title">今の担当</span>
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
          {/* いちばんの理由の次の一手（PRD D229）：移動が長い → 「移動を短く」で組む（提案）・担当なし → 受けられる人・相性 → 相性の表。
              理由のすぐ後ろに同じ行で（上の段を詰める。PRD D237） */}
          {rulesOn && reasonNow && (
            <ScoreNextStep
              reason={reasonNow}
              date={date}
              compatOn={compatOn}
              onShortTravel={travelPreset && !busyWhy ? () => propose(travelPreset) : undefined}
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
      {/* 担当ごとの1日（PRD D84）。訪問のある日だけ。狭い幅では畳む */}
      {hasPlan && cs && (
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
      {hasPlan && curScore?.error && (
        <p className="error plan-band" role="alert">
          採点できません（{curScore.error}）
        </p>
      )}
      {/* AI の提案（その場だけ。ADR-0053）：担当・時刻の変更と点の差。「当てる」で訪問に書く */}
      {proposal && proposal.date === date && proposalView && (
        <div className="plan-band proposal-band stack" data-testid="proposal-band">
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <WithIcon icon={Sparkles} size={16}>
              <span className="band-text">
                <strong>提案（{proposal.label}）</strong>：担当が変わる{' '}
                <strong data-testid="proposal-moved">{proposalView.diff?.moved.length ?? 0}</strong>件・時刻が変わる{' '}
                <strong data-testid="proposal-shifted">{proposalView.diff?.shifted.length ?? 0}</strong>件
                {proposalView.before !== null && proposalView.after !== null && (
                  <>
                    ・点 {proposalView.before}→<strong data-testid="proposal-score">{proposalView.after}</strong>（
                    {deltaText(proposalView.after - proposalView.before, '点')}）
                  </>
                )}
                {proposal.stopped ? '（途中までの最良）' : ''}
                {pinCount > 0 ? `。ピンの ${pinCount}件はそのまま` : ''}
              </span>
            </WithIcon>
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={!!running || proposalView.stale}
              onClick={applyProposal}
              data-testid="proposal-apply"
            >
              <WithIcon icon={CircleCheck} size={14}>
                当てる
              </WithIcon>
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setProposal(null)}
              data-testid="proposal-discard"
            >
              <WithIcon icon={X} size={14}>
                捨てる
              </WithIcon>
            </button>
          </div>
          {proposalView.stale && (
            <span className="sub warn-text" data-testid="proposal-stale">
              提案を出したあとに訪問が変わりました。もう一度 AI で組んでください
            </span>
          )}
          {proposalView.diff && proposalView.diff.moved.length > 0 && (
            <details className="reassign-moves-box" data-testid="proposal-moves">
              <summary>担当が変わる訪問を見る（{proposalView.diff.moved.length}件）</summary>
              <ReassignMoves diff={proposalView.diff} visitLabel={visitLabel} staffName={staffName} />
            </details>
          )}
        </div>
      )}
      {hasPlan && careCount > 0 && (
        <div className="plan-band is-warn row" data-testid="band-care">
          <WithIcon icon={TriangleAlert} size={16}>
            <span className="band-text">
              <Term k="attention">要対応</Term>の訪問 <strong>{careCount}</strong>件（{careParts.join('・')}）
            </span>
          </WithIcon>
          {unassigned.length > 0 && (
            <button type="button" className="btn btn-small" onClick={goToNone} data-testid="band-unassigned">
              担当なしを見る
            </button>
          )}
        </div>
      )}
      {toldState === 'changed' && (
        <div className="plan-band row" data-testid="band-told">
          <WithIcon icon={MessageSquareText} size={16}>
            伝えたあとに変わった訪問 {toldCount}件（未連絡の変更）
          </WithIcon>
          <button type="button" className="btn btn-small" onClick={() => setToldOpen(true)} data-testid="told-open">
            連絡の一覧
          </button>
        </div>
      )}
      {hasPlan && reassignInfo && (
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
            </span>
          </WithIcon>
          <button type="button" className="btn btn-small" onClick={() => setColView('list')}>
            一覧で見る
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
              （今の担当からの見込み）
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
        <MenuButton label="AI で組む" icon={Sparkles} items={menuItems} testId="plan-menu" />
        {/* 直前の手直しを1手だけ戻す（PRD D218）。戻せないときも押せる所に残し（フォーカスを落とさない）、理由は title */}
        {hasPlan && (
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
              で組み直しても担当を変えません）。
            </li>
            <li>「担当なしの訪問」へ移すと、担当なしに戻ります。</li>
            <li>直前の1回だけ、「元に戻す」で戻せます。</li>
            <li>
              「AI
              で組む」は、ピンの付いた訪問はそのままで、ほかの担当・順番の提案を出します。提案を見て「当てる」と担当が変わります。
            </li>
            <li>
              「予定をメールで送る」などで{terms.staff}
              に伝えたら「確定」を押します。確定のあとに変えた訪問は「未連絡の変更」に出ます。
            </li>
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
            この日の訪問はまだありません。「その他」の「訪問を追加」で足せます。繰り返しは{terms.client}
            の画面で足せます。
          </Empty>
        </div>
      ) : (
        <div className="plan-main">
          <div className="plan-body stack">
            {hasPlan && reassignInfo && (
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
              visitList
            ) : !hasVisits ? null : (
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

          {hasPlan && (
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
      {hasPlan && (
        <MapDock
          target={mapCardRef}
          points={points}
          lines={lines}
          title={`地図${focusStaff ? `：${staffName(focusStaff)}` : ''}`}
          focusKey={sel.focusKey}
        />
      )}
      {hasPlan && reassignInfo && (
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
                ごとの集計に回数が出ます。ほかの担当はそのままで、この訪問だけ外れます。
              </p>
            </>
          )}
        </SidePanel>
      )}

      {panel === 'detail' && (
        <SidePanel icon={Gauge} title="今の担当の詳しく" onClose={() => setPanel(null)}>
          {hasPlan && cs ? (
            <div className="stack" data-testid="plan-detail-panel">
              <PlanSummary
                current={cs}
                problem={scoreProblem}
                scale={scoreScale}
                rulerName={scoreRulerName}
                balanceOut={(() => {
                  const b = curAch.find((x) => x.ruleId === BALANCE_RULE_KEY);
                  return b ? b.total - b.met : null;
                })()}
              />
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
            <Empty icon={Gauge}>この日に計算できる訪問がありません</Empty>
          )}
        </SidePanel>
      )}
      {panel === 'mail' && mailOn && <DayMailPanel data={data} date={date} onClose={() => setPanel(null)} />}

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
      {/* 未連絡の変更の連絡の一覧（伝えた内容 → 今。ADR-0053） */}
      {toldOpen && told && (
        <ContactPanel
          list={told}
          left={[]}
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
          onClose={() => setToldOpen(false)}
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
          hasPlan={hasPlan}
          confirmState={toldState}
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

/** 今の担当の合計点（100点満点）・移動・待ち・要対応 */
function PlanSummary({
  current,
  problem,
  scale,
  rulerName,
  balanceOut,
}: {
  current: PlanScore | null;
  /** 点数の基準の物差しの問題と物差し（ADR-0010） */
  problem: Problem | null;
  scale: ScoreScale | null;
  /** 点数の基準のプリセットの名前 */
  rulerName: string;
  /** 件数の目安から外れた人の数（負担の均等が無効なら null） */
  balanceOut: number | null;
}) {
  if (!current) return null;
  const hard = current.hardViolations.length;
  const hundred = scale ? toHundred(current.total, scale) : null;
  const parts = scale && problem ? hundredBreakdown(current, scale, problem) : [];
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="stat-row">
        <Stat
          icon={Gauge}
          label={hard > 0 ? '合計（参考）' : '合計'}
          tone="primary"
          value={hundred ?? '—'}
          unit="点"
          note={breakdownText(parts) || undefined}
        />
        <Stat icon={Car} label="移動" value={r0(current.travelMinutes)} unit="分" />
        <Stat icon={Hourglass} label={<Term k="wait" />} value={r0(current.waitMinutes)} unit="分" />
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
          <Stat icon={CircleOff} label="担当なし" tone="warn" value={current.dropped} unit="件" />
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
  /** 担当なし */
  dropped: boolean;
  /** ピン */
  pinned: boolean;
  /** 要対応（担当が休み・条件に合わない・時間に間に合わない） */
  hard?: string[];
};

/**
 * その日の訪問の一覧（時間・訪問先・所要・担当・注意・開く/取消）。表示の切り替えの「一覧」で出す（PRD D63）。
 * 担当は訪問の担当を出すだけ（割り当ては時間軸・順番でドラッグする）
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
  /** 担当（担当なしは null）。known：〈スタッフ〉がデータにいる（いなければ名前をボタンにしない） */
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
      <SectionTitle icon={CalendarDays}>
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
                      <span className="sub">担当なし</span>
                    )}
                  </td>
                  <td>
                    <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                      {n.outside && <span className="chip chip-warn">計算に入れない</span>}
                      {n.dropped && <span className="chip chip-warn">担当なし</span>}
                      {n.pinned && (
                        <span className="chip chip-pin">
                          <Pin size={12} strokeWidth={2.4} aria-hidden="true" />
                          <Term k="pinned" plain={id !== firstPinned} />
                        </span>
                      )}
                      {n.hard?.map((h) => (
                        <span key={h} className="chip chip-red" title="要対応">
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
 * 今の担当は印を付けて押せない。担当のいる訪問は最後に「担当なしにする」。選ぶとドラッグと同じ moveTo・unassign
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
  // 判定は訪問の詳細の欄と同じ関数（lib/reassignMenu の reassignChoices。ADR-0051）。出す人は列を出している人
  const sorted = useMemo(() => {
    if (!open) return [];
    const shown = new Set(staffIds);
    return reassignChoices(problem, routes, visitId, ownerId, (sid) => shown.has(sid)).filter((c) => !c.current);
  }, [open, problem, routes, visitId, ownerId, staffIds]);
  if (!problem.visits.some((v) => v.id === visitId)) return null;
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
    ...sorted.map(
      (c, i): MenuItem => ({
        key: `to-${c.staffId}`,
        group: i === 0 ? `ほかの${staffTerm}へ移す` : undefined,
        testId: 'plan-reassign-item',
        label: staffName(c.staffId),
        description: c.description,
        disabled: busy || c.disabled,
        onSelect: () => onMove(c.staffId),
      }),
    ),
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
            label: '担当なしにする',
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

/** 連絡の一覧から1件の訪問を外す（取り消した訪問は「中止」として別に出す） */
function withoutVisit(c: ContactList, visitId: string): ContactList {
  const keep = (x: { visitId: string }) => x.visitId !== visitId;
  return {
    staffChanged: c.staffChanged.filter(keep),
    timeChanged: c.timeChanged.filter(keep),
    staff: c.staff
      .map((x) => ({
        ...x,
        added: x.added.filter(keep),
        removed: x.removed.filter(keep),
        shifted: x.shifted.filter(keep),
      }))
      .filter((x) => x.added.length + x.removed.length + x.shifted.length > 0),
  };
}
