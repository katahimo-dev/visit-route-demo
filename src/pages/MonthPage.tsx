import {
  BedSingle,
  CalendarOff,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Layers,
  LayoutGrid,
  List,
  ListChecks,
  Lock,
  PencilLine,
  Printer,
  RefreshCw,
  Repeat,
  Sparkles,
  Square,
  Timer,
  UserRound,
  UserX,
  X,
} from 'lucide-react';
import {
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDay } from '../app/day';
import { ClientPicker } from '../components/ClientPicker';
import { useConfirm } from '../components/ConfirmDialog';
import { FieldError } from '../components/FieldError';
import { ClientDots } from '../components/glance';
import { LoadBar, LoadLegend, LoadRowsSample, loadSummary, TypeStack } from '../components/loadBar';
import { PersonButton } from '../components/PersonPopover';
import { type BandModel, ProgressBand } from '../components/progressBand';
import { StaffBar, StaffLegend } from '../components/staffBar';
import { Term, TipBubble } from '../components/Term';
import { useToast } from '../components/Toast';
import { Hint, PageHeader, SidePanel, WithIcon } from '../components/ui';
import { ViewSwitch } from '../components/ViewSwitch';
import type { DemoData } from '../contracts/data';
import type { Staff, Visit, VisitType } from '../contracts/documents';
import type { Problem } from '../contracts/problem';
import type { Rule } from '../contracts/rules';
import { slotsText, timeText } from '../domain/availability';
import { isOnLeave } from '../domain/leaves';
import { jstDate, minutesToHhmm, weekday } from '../domain/time';
import {
  BAR_ROWS,
  barEdgeNote,
  barRangeText,
  barRowsText,
  edgeLabel,
  inBar,
  loadEdgeTexts,
  withEdges,
} from '../lib/barRows';
import { colorOf } from '../lib/colors';
import { attempt, byDisplayName, byName, newId, own, WEEKDAY_LABELS } from '../lib/common';
import { bulkConfirmDialog, bulkConfirmLabel, bulkConfirmTargets, bulkConfirmWhy, confirmDay } from '../lib/confirmDay';
import { isOn } from '../lib/features';
import { clientDot } from '../lib/glance';
import { attentionTarget, type LinkTarget } from '../lib/links';
import {
  addMonths,
  applyDayRun,
  attentionList,
  type BatchMode,
  batchTargets,
  type ClientDay,
  calendarWeeks,
  clientDay,
  clientMonth,
  type DayMarks,
  type DayPlan,
  type DayStatus,
  dayMarks,
  dayPlanOf,
  expandMonth,
  firstDayOf,
  isYm,
  monthDates,
  monthProgress,
  planEdited,
  type StaffDay,
  shortName,
  staffDay,
  staffMonth,
  type TypeCount,
  ymOf,
} from '../lib/month';
import { cellGuide, createTipStore, type TipStore } from '../lib/monthGuide';
import {
  DAY_STATE_TEXT,
  MONTH_LAYOUT_PARAM,
  MONTH_LIST_QUERY,
  type MonthLayout,
  type MonthListRow,
  monthLayoutOf,
  monthListFocusDate,
  monthListRow,
} from '../lib/monthList';
import { scrollBehavior } from '../lib/motion';
import { mdText } from '../lib/patternText';
import { type BandOp, urgentCount } from '../lib/progressBand';
import { rebuildWith } from '../lib/rebuildBand';
import {
  type OffDayState,
  offDayState,
  REQUESTED_OFF_NOTE,
  requestedOffDates,
  toggleRequestedOff,
} from '../lib/requestedOff';
import { planOfRun, problemKey, reusableRun } from '../lib/runs';
import { staffClientMap } from '../lib/search';
import { isAllRest, staffEdgeTexts, staffSlotSummary } from '../lib/staffBar';
import { useDayModel } from '../lib/useDayModel';
import { useDayStatuses } from '../lib/useDayStatuses';
import { compile } from '../matching';
import { scorePresetOf, scoreRulesOf } from '../seed';
import { defaultIterations, runSolve } from '../solver';
import { type DayLoadSlot, dayLoad } from '../vacancy';
import './month.css';
import './settings.css';
import { ClientLeavesSection } from './ClientLeavesSection';

/**
 * 月間カレンダーと月まとめ作成（ADR-0012。PRD D39〜D43・D53〜D55。design.md §4 pages「月単位の予定」「月間・週間の改定」）。
 * 日のマスは点数を出さず、状態を背景・枠と印で（凡例あり。読み上げには状態の文字）、種類の積み上げバー・休み欠勤の印・
 * 始まる▶終わる■の印・混み具合バー（vacancy の dayLoad）。「表示」で〈スタッフ〉か〈利用者さん〉を1人選ぶと、日のマスと
 * 右の欄がその人のものになる（?staff= ?client=）。選ばないときの右の欄は要対応。押すとその日の予定の画面へ。
 * 月まとめ作成は、基準のプリセットの重みで1日ずつ Worker で解き、その日の今の案と記録を1回の update で書く
 */

/** 月まとめ作成の進み具合 */
type Batch = {
  mode: BatchMode;
  targets: string[];
  /** いま作っている日の番号（0から） */
  index: number;
  /** 作れた日数 */
  made: number;
  iteration: number;
  total: number;
};

/** 1日あたりの見込み（秒）。design.md：1日 約3〜5秒 */
const SEC_MIN = 3;
const SEC_MAX = 5;

function etaText(days: number): string {
  const lo = days * SEC_MIN;
  const hi = days * SEC_MAX;
  if (hi < 60) return `約${lo}〜${hi}秒`;
  return `約${Math.max(1, Math.round(lo / 60))}〜${Math.ceil(hi / 60)}分`;
}

const longDate = (d: string) =>
  `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日（${WEEKDAY_LABELS[weekday(d)]}）`;
const ymText = (ym: string) => `${ym.slice(0, 4)}年${Number(ym.slice(5, 7))}月`;
const hm = (t: number) => timeText(minutesToHhmm(t));
const hoursText = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10}時間`;

/** 日の状態の言葉（一覧と同じ。lib/monthList） */
const STATE_TEXT = DAY_STATE_TEXT;
const STATE_ORDER: DayStatus['state'][] = ['none', 'plan', 'confirmed', 'diff'];

/** 表示の選択：全体／〈スタッフ〉1人／〈利用者さん〉1人 */
type Focus = { kind: 'all' } | { kind: 'staff'; id: string } | { kind: 'client'; id: string };

const sameList = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export default function MonthPage() {
  const { date, setDate } = useDay();
  const { data, update, compileInput, scoreRulerName } = useDayModel(date);
  const terms = data.org.terms;
  /** 切った機能（月の予定の印刷・稼働の見込み）の画面へ移るボタンは出さない（PRD D213。ADR-0028） */
  const printOn = isOn(data.org.features, 'monthPrint');
  /**
   * 希望休のまとめ入力（ADR-0028 の requestedOff）：切なら「休みを入れる」の入力だけ出さない（希望休そのものは事実で効き、
   * 「休みの人に N」の印も欠勤・最終勤務日の分を含む事実の表示なので出す）
   */
  const requestedOn = isOn(data.org.features, 'requestedOff');
  const workloadOn = isOn(data.org.features, 'workload');
  /** 欠勤・キャンセル（ADR-0028 の sudden）：切なら希望休を入れたときの知らせで「急な欠勤」の入口を案内しない */
  const suddenOn = isOn(data.org.features, 'sudden');
  const toast = useToast();
  const confirmDialog = useConfirm();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const today = jstDate(Date.now());
  const raw = params.get('ym') ?? '';
  const ym = isYm(raw) ? raw : ymOf(date);
  const monthNo = Number(ym.slice(5, 7));
  /** 月の見せ方（PRD D189）：URL の ?layout= か、無ければ幅（600px 以下は日ごとの一覧）。データには保存しない */
  const narrowList = useMedia(MONTH_LIST_QUERY);
  const layout = monthLayoutOf(params.get(MONTH_LAYOUT_PARAM), narrowList);

  const [panel, setPanel] = useState(false);
  /** 選ばないときの右の欄：要対応／確定していない日（進み具合の帯の「確定」から。PRD D153） */
  const [asideView, setAsideView] = useState<'attention' | 'unconfirmed'>('attention');
  const asideRef = useRef<HTMLElement>(null);
  /** 日のマスの表（読み方の吹き出し MonthCellTip が見る。PRD D177） */
  const gridRef = useRef<HTMLTableElement>(null);
  /** 「混み具合：空きを数える人」の選ぶ欄の名前（aria-labelledby） */
  const loadTypeId = useId();
  /** まとめて確定を押せない理由の文（aria-describedby） */
  const bulkWhyId = useId();
  /** マスの読み方の文の置き場（日付 → 文。PRD D177） */
  const tipStore = useMemo(() => createTipStore(), []);
  const [mode, setMode] = useState<BatchMode>('empty');
  const [batch, setBatch] = useState<Batch | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 混み具合で数える人（null＝すべての人。種類の ID） */
  const [loadType, setLoadType] = useState<string | null>(null);
  /** 「休みを入れる」（希望休のまとめ入力。PRD D69）：〈スタッフ〉を選んでいるときだけ。日のマスを押すと希望休を付け外し */
  const [offMode, setOffMode] = useState(false);
  /** 最後に付け外しした結果（読み上げ） */
  const [offNote, setOffNote] = useState<{ date: string; text: string; warn: boolean } | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const runRef = useRef<{ stop(): void } | null>(null);
  const stopped = useRef(false);
  /** 計算の世代。画面を離れると進め、前の世代の結果は捨てる */
  const generation = useRef(0);
  /** 作れた日数（画面を離れたときの知らせ） */
  const madeRef = useRef(0);
  const runningRef = useRef(false);

  // 画面を離れたら止める（作れた日は残る。いま作っている日は捨てる）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 画面を離れたときだけ
  useEffect(() => {
    return () => {
      generation.current++;
      runRef.current?.stop();
      runRef.current = null;
      if (runningRef.current) toast(`${madeRef.current}日分で止めました`);
      runningRef.current = false;
    };
  }, []);

  // ---- 選んでいる日付との同期（PRD D59）----
  // URL の ?ym= で開いた月が選んでいる日付の月と違えば、選んでいる日付をその月に合わせる（その月の1日、今月なら今日）
  // biome-ignore lint/correctness/useExhaustiveDependencies: URL の月が変わったときだけ
  useEffect(() => {
    if (isYm(raw) && ymOf(date) !== raw) setDate(firstDayOf(raw, today));
  }, [raw]);
  // 上の日付の切り替えで選んでいる日付が別の月になったら、表示する月も合わせる
  const lastDate = useRef(date);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 選んでいる日付が変わったときだけ
  useEffect(() => {
    if (lastDate.current === date) return;
    lastDate.current = date;
    if (isYm(raw) && ymOf(date) !== raw) patchParams({ ym: ymOf(date) });
  }, [date]);

  const activeStaff = useMemo(() => data.staff.filter((s) => s.active).sort(byName), [data.staff]);
  const activeClients = useMemo(() => data.clients.filter((c) => c.active).sort(byDisplayName), [data.clients]);
  const typeById = useMemo(() => new Map(data.visitTypes.map((t) => [t.id, t])), [data.visitTypes]);
  const staffById = useMemo(() => new Map(data.staff.map((s) => [s.id, s])), [data.staff]);

  // ---- 表示の選択（?staff= ?client=。いない人は全体）----
  const focus: Focus = useMemo(() => {
    const sid = params.get('staff');
    if (sid && activeStaff.some((s) => s.id === sid)) return { kind: 'staff', id: sid };
    const cid = params.get('client');
    if (cid && activeClients.some((c) => c.id === cid)) return { kind: 'client', id: cid };
    return { kind: 'all' };
  }, [params, activeStaff, activeClients]);
  /**
   * 表示の選択で「〈利用者さん〉」を選んでいる（PRD D61。〈利用者さん〉は検索欄 ClientPicker で1人選ぶ。
   * まだ選んでいない間も検索欄を出しておくための画面の状態）
   */
  const [clientMode, setClientMode] = useState(focus.kind === 'client');
  useEffect(() => {
    if (focus.kind === 'client') setClientMode(true);
    else if (focus.kind === 'staff') setClientMode(false);
  }, [focus.kind]);
  // 「休みを入れる」は〈スタッフ〉を選んでいるときだけ（選びを外したら終わる）
  useEffect(() => {
    if (focus.kind !== 'staff') setOffMode(false);
  }, [focus.kind]);
  // 選ぶ人を変えたら、前の人の操作の結果は消す
  const focusId = focus.kind === 'all' ? '' : focus.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 選ぶ人が変わったときだけ
  useEffect(() => {
    setOffNote(null);
  }, [focusId]);
  const focusValue =
    clientMode || focus.kind === 'client' ? 'client' : focus.kind === 'all' ? 'all' : `${focus.kind}:${focus.id}`;
  /** URL の一部だけ変える（ほかの値は残す） */
  const patchParams = (patch: Record<string, string | null>) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );
  };
  const pickFocus = (value: string) => {
    setClientMode(value === 'client');
    if (value === 'client') {
      // 〈利用者さん〉は検索欄で選ぶ。〈スタッフ〉の選択は外し、全体の表示のまま待つ
      if (focus.kind !== 'client') patchParams({ staff: null, client: null });
      return;
    }
    const [kind, ...rest] = value.split(':');
    const id = rest.join(':');
    patchParams({ staff: kind === 'staff' ? id : null, client: kind === 'client' ? id : null });
  };

  /** カレンダーと一覧を切り替える（押したら幅の既定と同じでも URL に書く。PRD D189） */
  const pickLayout = (next: MonthLayout) => {
    if (next === layout) return;
    patchParams({ [MONTH_LAYOUT_PARAM]: next });
  };

  /** 点数の基準のプリセット（月まとめ作成に使う。ADR-0012） */
  const basePreset = useMemo(() => scorePresetOf(data.presets, data.scorePresetId), [data.presets, data.scorePresetId]);

  const weeks = useMemo(() => calendarWeeks(ym), [ym]);
  const days = useMemo(() => monthDates(ym), [ym]);
  /** 日ごとの訪問（compile にはその日の訪問だけを渡す。compile はその日の訪問しか読まない） */
  const visitsByDate = useMemo(() => {
    const out = new Map<string, Visit[]>();
    for (const v of data.visits) {
      const list = out.get(v.date);
      if (list) list.push(v);
      else out.set(v.date, [v]);
    }
    return out;
  }, [data.visits]);

  // ---- 日の問題と状態（lib/useDayStatuses。月とホームで共通）----
  const perDay = useDayStatuses(data, compileInput, days);
  const statuses = useMemo(() => new Map([...perDay].map(([d, x]) => [d, x.status])), [perDay]);

  /** その日の数える案（今の案、無ければ確定した割当）。問題は上で作ったものを使う */
  const dayPlans = useMemo(() => {
    const out = new Map<string, DayPlan>();
    for (const d of days) out.set(d, dayPlanOf(data, d, perDay.get(d)?.problem ?? null));
    return out;
  }, [days, data, perDay]);

  // ---- 〈利用者さん〉の検索欄の近道（PRD D61）----
  /** この月に（取り消しでも〈利用者さん〉の休み（ADR-0013）でもない）訪問がある〈利用者さん〉 */
  const monthClientIds = useMemo(() => {
    const out = new Set<string>();
    for (const d of days)
      for (const v of visitsByDate.get(d) ?? [])
        if (!v.cancelled && !isOnLeave(data.clientLeaves, v)) out.add(v.clientId);
    return out;
  }, [days, visitsByDate, data.clientLeaves]);
  /** 〈スタッフ〉が担当する〈利用者さん〉：この月の数える案（今の案、無ければ確定した割当）の担当と、いつもの担当 */
  const staffClients = useMemo(() => {
    const clientOf = new Map(data.visits.map((v) => [v.id, v.clientId]));
    const pairs: [string, string | undefined][] = [];
    for (const d of days)
      for (const [sid, ids] of Object.entries(dayPlans.get(d)?.routes ?? {}))
        for (const id of ids) pairs.push([sid, clientOf.get(id)]);
    return staffClientMap(pairs, data.clients);
  }, [days, dayPlans, data.visits, data.clients]);
  const clientsOfStaff = useCallback((sid: string) => staffClients.get(sid) ?? new Set<string>(), [staffClients]);

  // ---- 日のマスの印（D53）----
  const marks = useMemo(() => {
    const out = new Map<string, DayMarks>();
    for (const d of days) out.set(d, dayMarks(data, d));
    return out;
  }, [days, data]);

  // ---- 混み具合（D54。日付・数える人・compile が読むデータ・案で覚える）----
  const loadMemo = useRef(new Map<string, { key: readonly unknown[]; value: DayLoadSlot[] | null }>());
  const loads = useMemo(() => {
    const out = new Map<string, DayLoadSlot[] | null>();
    if (focus.kind !== 'all') return out;
    const base = [
      data.org,
      data.items,
      data.staff,
      data.clients,
      data.compat,
      data.availability,
      data.absences,
      data.visitTypes,
      data.rules,
      loadType,
    ];
    for (const d of days) {
      const visits = visitsByDate.get(d) ?? [];
      const key = [...base, own(data.aiPlans, d), own(data.manualPlans, d), ...visits];
      const hit = loadMemo.current.get(d);
      if (hit && sameList(hit.key, key)) {
        out.set(d, hit.value);
        continue;
      }
      const value = attempt(() => dayLoad({ ...data, visits }, d, { typeId: loadType })).value ?? null;
      loadMemo.current.set(d, { key, value });
      out.set(d, value);
    }
    return out;
  }, [focus.kind, days, data, visitsByDate, loadType]);

  // ---- 選んだ人の日と月の集計（D55）----
  const staffDays = useMemo(() => {
    const out = new Map<string, StaffDay>();
    if (focus.kind !== 'staff') return out;
    for (const d of days) out.set(d, staffDay(compileInput, dayPlans.get(d)!, focus.id));
    return out;
  }, [focus, days, compileInput, dayPlans]);
  const clientDays = useMemo(() => {
    const out = new Map<string, ClientDay>();
    if (focus.kind !== 'client') return out;
    for (const d of days) out.set(d, clientDay(compileInput, dayPlans.get(d)!, focus.id));
    return out;
  }, [focus, days, compileInput, dayPlans]);
  const staffDaysRef = useRef(staffDays);
  staffDaysRef.current = staffDays;
  /** 「休みを入れる」で選んでいる〈スタッフ〉（休みを入れるモードでなければ null） */
  const offStaffId = requestedOn && offMode && focus.kind === 'staff' ? focus.id : null;
  /**
   * 希望休を付け外しする（PRD D69）。案・確定した割当は変えない（振り直しは日の画面で利用者が押す。ADR-0011）。
   * その日のその人に訪問があれば、欄に注意を残す
   */
  const toggleOff = useCallback(
    (d: string) => {
      if (!offStaffId) return;
      // 結果は直前のデータ（描画を待たずに続けて押しても、前の押した分を入れたデータ）から出す。
      // 同じ規則で update でも付け外しするので、文と実際の結果が食い違わない
      const id = newId('a');
      const res = toggleRequestedOff(dataRef.current, offStaffId, d, today, id);
      if (res.result === 'unchanged') return;
      dataRef.current = res.data;
      update((x) => toggleRequestedOff(x, offStaffId, d, today, id).data);
      const name = staffById.get(offStaffId)?.name ?? '';
      const n = staffDaysRef.current.get(d)?.count ?? 0;
      if (res.result === 'added') {
        setOffNote({
          date: d,
          warn: n > 0,
          text:
            n > 0
              ? `${mdText(d)} を${REQUESTED_OFF_NOTE}にしました。${name}さんにこの日の訪問が ${n}件あります。${suddenOn ? '日の予定のその人の列の「欠勤を直す」から振り直してください' : '日の予定で担当を振り直してください'}（自動では振り直しません）`
              : `${mdText(d)} を${REQUESTED_OFF_NOTE}にしました`,
        });
      } else {
        setOffNote({ date: d, warn: false, text: `${mdText(d)} の${REQUESTED_OFF_NOTE}を外しました` });
      }
    },
    [offStaffId, today, update, staffById, suddenOn],
  );
  /** 選んでいる〈スタッフ〉のこの月の希望休の日 */
  const offDates = useMemo(
    () => (focus.kind === 'staff' ? requestedOffDates(data, focus.id, ym) : []),
    [focus, data, ym],
  );
  const monthPlans = useMemo(() => days.map((d) => dayPlans.get(d)!), [days, dayPlans]);
  const staffSum = useMemo(
    () => (focus.kind === 'staff' ? staffMonth(compileInput, monthPlans, focus.id) : null),
    [focus, compileInput, monthPlans],
  );
  const clientSum = useMemo(
    () => (focus.kind === 'client' ? clientMonth(compileInput, monthPlans, focus.id) : null),
    [focus, compileInput, monthPlans],
  );
  const attention = useMemo(
    () => attentionList(data, days.map((d) => statuses.get(d)!).filter(Boolean), today),
    [data, days, statuses, today],
  );

  /** 今月の準備（PRD D59。進み具合の帯に出す。D151）。日の状態は上で compile・採点したものを使う（要対応の欄と同じ数え方） */
  const progress = useMemo(
    () => monthProgress(data, ym, today, undefined, (d) => statuses.get(d)),
    [data, ym, today, statuses],
  );
  /** 右の欄へ移る（要対応・確定していない日） */
  const showAside = (view: 'attention' | 'unconfirmed', extra: Record<string, string | null> = {}) => {
    // 全体の表示にする（pickFocus('all') と同じ。extra は一緒に URL から消すもの）
    setClientMode(false);
    patchParams({ staff: null, client: null, ...extra });
    setAsideView(view);
    requestAnimationFrame(() => {
      asideRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
      asideRef.current?.focus({ preventScroll: true });
    });
  };

  /**
   * 見出しの下の要約（月全体。今日より前の日も数える）：帯に無いものだけ（入らない訪問・当日キャンセル）。
   * 訪問・案のある日は帯（今日以降）に出すので、同じ言葉で違う範囲の数を並べない（PR #38 のレビュー。PRD D154）
   */
  const summary = useMemo(() => {
    let unassigned = 0;
    for (const d of days) unassigned += statuses.get(d)?.unassigned ?? 0;
    // 当日キャンセル（ADR-0015）の回数
    let sameDay = 0;
    for (const d of days)
      for (const v of visitsByDate.get(d) ?? []) if (v.cancelled && v.cancelKind === 'sameDay') sameDay++;
    return { unassigned, sameDay };
  }, [days, statuses, visitsByDate]);

  /** 先に定期パターンから展開したときのデータ（対象の日数の見込み） */
  const preview = useMemo(() => expandMonth(data, ym, today), [data, ym, today]);
  /** その月の今日以降の訪問（展開したあと） */
  const futureVisits = useMemo(
    () => preview.data.visits.filter((v) => !v.cancelled && ymOf(v.date) === ym && v.date >= today).length,
    [preview, ym, today],
  );
  const staleOf = (d: string) => statuses.get(d)?.stale ?? false;
  const targetsOf = (m: BatchMode) => batchTargets(preview.data, ym, today, m, staleOf);
  const staleTargets = batchTargets(data, ym, today, 'stale', staleOf);
  /** 欄の対象の日（条件が変わった日は定期パターンから訪問を作らずに数える。「条件が変わった日を作り直す」と同じ） */
  const panelTargets = panel ? (mode === 'stale' ? staleTargets : targetsOf(mode)) : [];
  /** この月の今日以降で、条件が変わったが確定した割当がある日（作り直さない。作り直しの帯の「確定済み」。PRD D163） */
  const staleConfirmed = days.filter((d) => d >= today && staleOf(d) && !!own(data.manualPlans, d)).length;
  const running = batch !== null;
  const noVisitsWhy = futureVisits === 0 ? '定期パターンが無いか、この月の訪問がありません' : null;

  /**
   * まとめて作るの欄を開く（入口は進み具合の帯の1か所と ?do=batch。PRD D153・D154）。既定の対象はいつも「まだ案の無い日だけ」
   * （0日でも。済んだ数字から開いても、作り直す＝手直しを捨てうる操作を既定にしない。作り直しは欄で利用者が選ぶ）。
   * 開かないとき：作っている間・この月に訪問が無い・作っていない訪問も、まだ案の無い日も、確定していない日も無い（知らせを出す）
   */
  const openBatch = () => {
    if (runningRef.current) return;
    if (noVisitsWhy) {
      toast(noVisitsWhy);
      return;
    }
    if (preview.added === 0 && targetsOf('empty').length === 0 && targetsOf('all').length === 0) {
      toast('作る日がありません（今日より前の日・確定した日は作りません）');
      return;
    }
    setError(null);
    setMode('empty');
    setPanel(true);
  };

  /** 進み具合の帯（PRD D151〜D155）：今月の準備と同じ数え方。週・日の画面の帯と同じもの */
  const band = useMemo(
    (): BandModel => ({
      ym,
      progress,
      canExpand: preview.added,
      emptyTargets: batchTargets(preview.data, ym, today, 'empty', (d) => statuses.get(d)?.stale ?? false).length,
      urgent: urgentCount(attention),
    }),
    [ym, progress, preview, today, statuses, attention],
  );
  /**
   * 条件が変わった日を作り直す欄を開く（設定の画面の作り直しの帯の［作り直す］＝ ?do=stale。PRD D163）。
   * 対象は「条件が変わった日を作り直す」と同じ（確定していない日だけ）。作り始めるのは欄の主ボタン（手直しのある日は今どおり確かめる）。
   * 作っている間は何もしない。対象が0日なら欄を開かず、知らせて要対応を出す
   */
  const openStale = () => {
    if (runningRef.current) return;
    if (staleTargets.length === 0) {
      toast('作り直す日がありません（確定した日・今日より前の日は作り直しません）');
      showAside('attention');
      return;
    }
    setError(null);
    setMode('stale');
    setPanel(true);
  };

  /** 帯の数字・ボタン：この画面の中で欄を開く（URL の ?staff= などは showAside のとおり） */
  const onBandOp = (op: BandOp) => {
    if (op === 'batch') openBatch();
    else showAside(op);
  };

  // ---- ホーム・週・日の帯から来たときの操作（PRD D143・D153。?do=）----
  // batch：まとめて作るの欄を開く（openBatch）。attention・unconfirmed：右の欄の要対応・確定していない日へ。
  // stale：条件が変わった日を作り直す欄を開く（openStale。設定の画面の作り直しの帯から。PRD D163）。
  // 1回だけ行い、URL から ?do= を消す（戻る・再読込で繰り返さない）
  const doParam = params.get('do');
  // biome-ignore lint/correctness/useExhaustiveDependencies: ?do= が付いたときだけ
  useEffect(() => {
    if (doParam === null) return;
    if (doParam === 'attention' || doParam === 'unconfirmed') {
      showAside(doParam, { do: null });
      return;
    }
    patchParams({ do: null });
    if (doParam === 'batch') openBatch();
    else if (doParam === 'stale') openStale();
  }, [doParam]);

  // ---- 定期パターンから訪問だけ作る（案は作らない。まとめて作るの欄の「訪問だけ作る」。D154）----
  const expandOnly = () => {
    setError(null);
    const n = preview.added;
    if (n === 0) {
      toast('作る訪問はありませんでした（もう作ってあります）');
      return;
    }
    update((d) => expandMonth(d, ym, today).data);
    toast(`${monthNo}月の訪問を${n}件作りました`);
  };

  // ---- 問題の無い日をまとめて確定（PRD D223。右の欄の「確定していない日」）----
  /** 確定していない日（今日以降）のうち、一度も確定していない日で、必須の違反が無く要対応に出ない日（ADR-0031） */
  const bulk = useMemo(
    () => bulkConfirmTargets(progress.unconfirmed, (d) => statuses.get(d), attention),
    [progress, statuses, attention],
  );
  /**
   * まとめて確定：独自の確認（日付と残す日）のあと、1回の update で日ごとに日の画面の「この割当で確定」と同じ書き方
   * （lib/confirmDay）。問題は日の状態を数えたときのもの（計算に入れる訪問は条件の重みに依らない）。作っている間は押せない
   */
  const confirmBulk = async () => {
    if (runningRef.current || bulk.targets.length === 0) return;
    const targets = bulk.targets;
    const ok = await confirmDialog({
      ...bulkConfirmDialog(bulk, terms.staff),
      confirmLabel: `${targets.length}日を確定する`,
    });
    if (!ok || runningRef.current) return;
    // 確認のあいだに案が消えた日（別のタブ）は飛ばす
    const ready = targets.flatMap((date) => {
      const p = perDay.get(date)?.problem;
      return p && own(dataRef.current.aiPlans, date) ? [{ date, p }] : [];
    });
    if (ready.length === 0) return;
    update((d) => ready.reduce((out, x) => (own(out.aiPlans, x.date) ? confirmDay(out, x.date, x.p) : out), d));
    toast(`${ready.length}日を確定しました`);
    // 押したボタンは0日になって押せなくなるので、フォーカスは右の欄へ（確定していない日の一覧の先頭から読める）
    requestAnimationFrame(() => asideRef.current?.focus({ preventScroll: true }));
  };

  // ---- 月まとめ作成（③）----
  /** 対象の日を1日ずつ作る。expand は先に定期パターンから訪問を作るか（①） */
  const start = async (m: BatchMode, expand: boolean) => {
    if (runningRef.current) return;
    setError(null);
    const first = expand ? expandMonth(dataRef.current, ym, today).data : dataRef.current;
    const targets = batchTargets(first, ym, today, m, staleOf);
    if (targets.length === 0) {
      setError('対象の日がありません（今日より前の日・確定した日は作りません）');
      return;
    }
    if (m !== 'empty') {
      const edited = targets.filter((d) => {
        const p = own(first.aiPlans, d);
        return !!p && planEdited(p);
      }).length;
      if (
        edited > 0 &&
        !(await confirmDialog({
          title: `手直しのある ${edited}日の手直しを捨てますか？`,
          body: 'その日の手直しと固定を捨てて、AI案を作り直します。',
          confirmLabel: '捨てて作り直す',
          tone: 'danger',
        }))
      )
        return;
      // 確認のあいだに別の作成が始まっていたら何もしない
      if (runningRef.current) return;
    }
    if (expand) update((d) => expandMonth(d, ym, today).data);
    setPanel(false);
    // 作っている間は希望休を入れない（Worker の計算とデータの書き込みを混ぜない）
    setOffMode(false);
    const gen = generation.current;
    const live = () => gen === generation.current;
    stopped.current = false;
    madeRef.current = 0;
    runningRef.current = true;
    let unassignedDays = 0;
    setBatch({ mode: m, targets, index: 0, made: 0, iteration: 0, total: 1 });

    const finish = (why?: string) => {
      runningRef.current = false;
      runRef.current = null;
      setBatch(null);
      const made = madeRef.current;
      if (why) setError(why);
      if (stopped.current) toast(`${made}日分で止めました`);
      else toast(`${made}日分の案を作りました（入らない訪問がある日 ${unassignedDays}日）`);
    };

    const step = (i: number) => {
      if (!live()) return;
      if (i >= targets.length || stopped.current) {
        finish();
        return;
      }
      const day = targets[i]!;
      // いちばん新しいデータで（作っている間の編集も入れる）。展開は同じ結果になるので、まだ描画されていなくても同じ訪問になる
      const latest = expand ? expandMonth(dataRef.current, ym, today).data : dataRef.current;
      setBatch((b) => (b ? { ...b, index: i, iteration: 0, total: 1 } : b));
      // 作っている間に確定した・（まだ案の無い日だけで）案ができた日は飛ばす
      if (own(latest.manualPlans, day) || (m === 'empty' && own(latest.aiPlans, day))) {
        step(i + 1);
        return;
      }
      // 点数の基準（条件の重みの画面の重み。ADR-0035）で作る
      const rules = scoreRulesOf(latest);
      const p = attempt(() => compile({ ...latest, rules }, day)).value;
      if (!p || p.visits.length === 0 || p.staff.length === 0) {
        step(i + 1);
        return;
      }
      const key = problemKey(p);
      // 同じ条件・いまのデータで作った記録があれば計算しない（lib/runs の reusableRun）
      const saved = attempt(() => reusableRun(own(latest.aiRuns, day) ?? [], p, rules, latest.seed, key)).value;
      if (saved) {
        update((d) => {
          if ((m === 'empty' && own(d.aiPlans, day)) || own(d.manualPlans, day)) return d;
          return { ...d, aiPlans: { ...d.aiPlans, [day]: planOfRun(saved) } };
        });
        madeRef.current++;
        if (saved.unassigned.length > 0) unassignedDays++;
        setBatch((b) => (b ? { ...b, made: madeRef.current } : b));
        // 描画を挟んでから次へ
        setTimeout(() => step(i + 1), 0);
        return;
      }
      solveDay(p, latest, rules, key, day, m, i);
    };

    const solveDay = (
      p: Problem,
      latest: DemoData,
      rules: Rule[],
      key: string,
      day: string,
      m2: BatchMode,
      i: number,
    ) => {
      const started = attempt(() =>
        runSolve(p, { seed: latest.seed, iterations: defaultIterations(p) }, (x) => {
          if (!live()) return;
          setBatch((b) => (b ? { ...b, iteration: x.iteration, total: x.total } : b));
        }),
      );
      if (!started.value) {
        finish(started.error ?? 'AI案を作れませんでした');
        return;
      }
      runRef.current = started.value;
      started.value.promise
        .then((result) => {
          if (!live()) return;
          update((d) =>
            applyDayRun(d, day, { rules, result, createdAt: Date.now(), inputKey: key, onlyEmpty: m2 === 'empty' }),
          );
          madeRef.current++;
          if (result.unassigned.length > 0) unassignedDays++;
          setBatch((b) => (b ? { ...b, made: madeRef.current } : b));
          runRef.current = null;
          step(i + 1);
        })
        .catch((e) => {
          if (!live()) return;
          finish(e instanceof Error ? e.message : 'AI案を作れませんでした');
        });
    };

    step(0);
  };

  const stop = () => {
    stopped.current = true;
    runRef.current?.stop();
  };

  /** 月を送る：選んでいる日付もその月の1日（今月なら今日）にする（PRD D59） */
  const goMonth = (next: string) => {
    const d = firstDayOf(next, today);
    lastDate.current = d;
    patchParams({ ym: next });
    setDate(d);
  };
  const openDay = useCallback(
    (d: string) => {
      // 予定の画面へ移るので、表示する月は合わせない（合わせると ?ym= を書く遷移が予定の画面への遷移を打ち消す）
      lastDate.current = d;
      setDate(d);
      navigate('/plan');
    },
    [setDate, navigate],
  );
  /** 要対応の1行の行き先へ移る（PRD D201。行き先は lib/links の attentionTarget。日付も選んでおく） */
  const openTarget = (t: LinkTarget) => {
    lastDate.current = t.date;
    setDate(t.date);
    navigate(t.to);
  };

  const current = batch ? batch.targets[batch.index] : undefined;
  /**
   * 日ごとの一覧の行（PRD D189。一覧のときだけ作る）。表示の選択（〈スタッフ〉・〈利用者さん〉）と「休みを入れる」の補足は行の下に出す
   */
  const listRows = useMemo((): { row: MonthListRow; extra: string[]; off: OffDayState | undefined }[] => {
    if (layout !== 'list') return [];
    const out: { row: MonthListRow; extra: string[]; off: OffDayState | undefined }[] = [];
    for (const d of days) {
      const s = statuses.get(d);
      if (!s) continue;
      const extra: string[] = [];
      const x = staffDays.get(d);
      if (focus.kind === 'staff' && x) {
        if (x.retired) extra.push('最終勤務日の後');
        else if (x.absence) extra.push(x.requested ? REQUESTED_OFF_NOTE : '欠勤');
        else if (x.off) extra.push('休み');
        if (x.count > 0) extra.push(`担当 ${x.count}件`);
      }
      const c = clientDays.get(d);
      if (focus.kind === 'client' && c && c.visits.length > 0) {
        extra.push(
          c.visits
            .map(
              (v) =>
                `${hm(v.start)} ${
                  v.cancelled
                    ? '取り消し'
                    : v.leave
                      ? '休み'
                      : v.staffId
                        ? shortName(staffById.get(v.staffId)?.name ?? '')
                        : v.unassigned
                          ? '入らない'
                          : '担当未定'
                }`,
            )
            .join('、'),
        );
      }
      const off = offStaffId ? offDayState(data, offStaffId, d, today) : undefined;
      if (off) extra.push(OFF_STATE_TEXT[off]);
      out.push({ row: monthListRow(s, today, extra), extra, off });
    }
    return out;
  }, [layout, days, statuses, staffDays, clientDays, focus.kind, staffById, offStaffId, data, today]);
  /** 日ごとの一覧（最初に見せる日へ巻く。PRD D189） */
  const listRef = useRef<HTMLUListElement>(null);
  /** その日の行を見える所へ（上の帯は scroll-margin で避ける）。focus なら行へフォーカス */
  const showListDay = (d: string, focus: boolean) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-date="${d}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: focus ? scrollBehavior() : 'auto' });
    if (focus) el.focus({ preventScroll: true });
  };
  /** 最初に巻いた月と見せ方（同じ月・見せ方では巻き直さない） */
  const listShown = useRef('');
  // biome-ignore lint/correctness/useExhaustiveDependencies: 月・見せ方が変わったとき（と行ができたとき）だけ
  useEffect(() => {
    if (layout !== 'list' || listRows.length === 0) return;
    const key = `${ym}:${layout}`;
    if (listShown.current === key) return;
    listShown.current = key;
    // 今月で行き先（?do=）が無いときだけ、今日（選んでいる日が今月ならその日）の行へ
    const target = monthListFocusDate(ym, date, today, doParam !== null);
    if (target) requestAnimationFrame(() => showListDay(target, false));
  }, [layout, ym, listRows.length]);
  const progressValue = batch ? batch.index + (batch.total > 0 ? Math.min(1, batch.iteration / batch.total) : 0) : 0;
  /** 選んだ〈利用者さん〉（休みの欄。ADR-0013） */
  const focusClient = focus.kind === 'client' ? data.clients.find((c) => c.id === focus.id) : undefined;
  const focusName =
    focus.kind === 'staff'
      ? (staffById.get(focus.id)?.name ?? '')
      : focus.kind === 'client'
        ? (activeClients.find((c) => c.id === focus.id)?.displayName ?? '')
        : '';

  return (
    <div className="stack">
      <PageHeader
        nav={<ViewSwitch current="month" />}
        icon={CalendarRange}
        title="月の予定"
        lead="定期パターンから訪問を作り、一月分の案をまとめて作ります"
      />

      {/* 進み具合の帯（PRD D151〜D155）。「まとめて作る」の入口はここの1か所（D154。見出しのボタン・今月の準備の①〜③をまとめた） */}
      <ProgressBand ym={ym} model={band} primary onOp={onBandOp} />
      {/* カレンダーと日ごとの一覧の切り替え（PRD D189。600px 以下ははじめ一覧。URL の ?layout=。操作の欄より上） */}
      <fieldset className="segmented seg-sm month-layout" aria-label="月の見せ方" data-testid="month-layout">
        {(
          [
            ['calendar', 'カレンダー', LayoutGrid],
            ['list', '日ごとの一覧', List],
          ] as const
        ).map(([k, label, Icon]) => (
          <button
            key={k}
            type="button"
            className={layout === k ? 'is-on' : undefined}
            aria-pressed={layout === k}
            onClick={() => pickLayout(k)}
            data-layout={k}
          >
            <WithIcon icon={Icon} size={14}>
              {label}
            </WithIcon>
          </button>
        ))}
      </fieldset>

      <div className="card stack month-head">
        <div className="row month-nav">
          <button
            type="button"
            className="icon-btn"
            aria-label="前の月"
            disabled={running}
            onClick={() => goMonth(addMonths(ym, -1))}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <h2 className="month-title" data-testid="month-title">
            {ymText(ym)}
          </h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="次の月"
            disabled={running}
            onClick={() => goMonth(addMonths(ym, 1))}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={running || ym === ymOf(today)}
            onClick={() => goMonth(ymOf(today))}
          >
            今月
          </button>
          {printOn && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() =>
                navigate(
                  `/month/print?ym=${ym}${focus.kind === 'staff' ? `&staff=${encodeURIComponent(focus.id)}` : ''}`,
                )
              }
              title="紙のカレンダーの代わりに、この月の予定をA4横で印刷します"
              data-testid="month-print"
            >
              <WithIcon icon={Printer} size={14}>
                印刷
              </WithIcon>
            </button>
          )}
          {workloadOn && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => navigate(`/workload?ym=${ym}`)}
              title="予定から、この月の出勤〜退勤（拘束）・移動・空き時間（待ち）の時間と交通費を見込みます"
              data-testid="month-workload"
            >
              <WithIcon icon={Timer} size={14}>
                勤務の見込み
              </WithIcon>
            </button>
          )}
          <span className="month-summary sub" data-testid="month-summary">
            月全体：入らない {summary.unassigned}件{summary.sameDay > 0 ? `・当日キャンセル ${summary.sameDay}件` : ''}
          </span>
        </div>
        <div className="row month-pickers">
          <label className="month-picker">
            <span>表示</span>
            <select value={focusValue} onChange={(e) => pickFocus(e.target.value)} data-testid="month-focus">
              <option value="all">全体</option>
              <optgroup label={terms.staff}>
                {activeStaff.map((s) => (
                  <option key={s.id} value={`staff:${s.id}`}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
              <option value="client">{terms.client}（名前・よみで探す）</option>
            </select>
          </label>
          {focusValue === 'client' && (
            <ClientPicker
              clients={activeClients}
              selected={focus.kind === 'client' ? [focus.id] : []}
              onChange={(ids) => patchParams({ staff: null, client: ids[0] ?? null })}
              label={`表示する${terms.client}`}
              period={{ label: 'この月', clientIds: monthClientIds }}
              byStaff={{ staffLabel: terms.staff, staff: activeStaff, clientIdsOf: clientsOfStaff }}
              tentativeShortcut
              testId="month-client-picker"
            />
          )}
          {requestedOn && focus.kind === 'staff' && (
            <button
              type="button"
              className={`btn btn-small month-off-toggle${offMode ? ' is-on' : ''}`}
              aria-pressed={offMode}
              disabled={running}
              onClick={() => {
                setOffNote(null);
                setOffMode((x) => !x);
              }}
              data-testid="month-off-toggle"
            >
              <WithIcon icon={CalendarOff} size={14}>
                {offMode ? '休みの入力を終わる' : '休みを入れる'}
              </WithIcon>
            </button>
          )}
          {focus.kind === 'all' && (
            // 用語の説明（ボタン）は label の中に置かない（入力欄の名前が用語のボタンへ移るため。PR #42 のレビュー）。
            // 選ぶ欄の名前は aria-labelledby で「混み具合：」と用語をつなぐ
            <div className="month-picker">
              <span>
                <span id={`${loadTypeId}-label`}>混み具合：</span>
                <Term k="loadCount" testId="term-load-count" id={`${loadTypeId}-term`} />
              </span>
              <select
                aria-labelledby={`${loadTypeId}-label ${loadTypeId}-term`}
                value={loadType ?? ''}
                onChange={(e) => setLoadType(e.target.value === '' ? null : e.target.value)}
                data-testid="month-load-type"
              >
                <option value="">すべて</option>
                {data.visitTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}（担当できる人）
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="row month-tools">
          <button
            type="button"
            className="btn btn-small"
            disabled={running || staleTargets.length === 0}
            onClick={() => start('stale', false)}
            title={staleTargets.length === 0 ? '条件が変わった日（確定していない日）はありません' : ''}
          >
            <WithIcon icon={RefreshCw} size={14}>
              条件が変わった日を作り直す（{staleTargets.length}日）
            </WithIcon>
          </button>
          <Hint>
            日のマスを押すと、その日の「日の予定」を開きます。マスの色と印は日の状態です（下の凡例）。赤い枠と赤い点の日（「要対応」）は、入らない訪問がある・必須の違反がある・休みの人に訪問が残る日です（必須の違反は点数の基準のプリセット「
            {scoreRulerName}
            」の条件で見ます）。黄の点線の枠の日（「注意」）は、今日以降で訪問があるのにまだ案が無い日です（まとめて作るか日の予定で作ります）。「条件が変わった」は、案を作ったあとに訪問・
            {terms.staff}
            ・稼働時間・条件が変わった日です。混み具合のバーは {barRangeText()} を3段（
            {BAR_ROWS.map(([a, b]) => `${a}〜${b}時`).join('・')}）・30分ずつに分け、その30分に空いている
            {terms.staff}
            の人数で色を付けます（数えるのは確定した割当、無ければ今の案）。{edgeLabel('early')}・{edgeLabel('late')}
            に働く人がいる日は、段の端に「◀」「▶」の印を出します（マウスを乗せると時刻）。
          </Hint>
          {noVisitsWhy && <span className="sub">{noVisitsWhy}</span>}
        </div>
        {offStaffId !== null && (
          <div className="month-off-bar" data-testid="month-off-bar">
            <p>
              <strong>
                <WithIcon icon={CalendarOff} size={14}>
                  {focusName}さんの休みを入れる
                </WithIcon>
              </strong>
              ：勤務日のマスを押すと、その日を終日の{REQUESTED_OFF_NOTE}
              にします。もう一度押すと外します。続けて何日でも押せます。
              <span className="sub">
                （この月の{REQUESTED_OFF_NOTE} {offDates.length}
                日。勤務の無い日・今日より前の日・ほかの欠勤のある日は押せません。案は自動では振り直しません）
              </span>
            </p>
            <p className={offNote?.warn ? 'warn-text' : 'sub'} aria-live="polite" data-testid="month-off-note">
              {offNote?.text ?? ''}
              {offNote?.warn && (
                <button type="button" className="btn btn-small" onClick={() => openDay(offNote.date)}>
                  {mdText(offNote.date)} の予定を開く
                </button>
              )}
            </p>
          </div>
        )}
        <MonthLegend bar={focus.kind === 'all' ? 'load' : focus.kind === 'staff' ? 'staff' : null} />
        {batch && (
          <div className="stack month-progress" style={{ gap: 4 }} data-testid="month-progress">
            <progress
              value={progressValue}
              max={Math.max(1, batch.targets.length)}
              aria-label="月まとめ作成の進み具合"
              style={{ width: '100%' }}
            />
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span className="sub" aria-live="polite">
                {current ? `${mdText(current)} の案：` : ''}
                {batch.index + 1}/{batch.targets.length}日（作れた日 {batch.made}日）
              </span>
              <button type="button" className="btn btn-small" onClick={stop}>
                <WithIcon icon={Square} size={14}>
                  止める
                </WithIcon>
              </button>
            </div>
          </div>
        )}
        <FieldError>{error}</FieldError>
      </div>

      <div className="month-body">
        <div className={`card month-card${layout === 'list' ? ' is-list' : ''}`}>
          {layout === 'list' && ym === ymOf(today) && (
            <button
              type="button"
              className="btn btn-small month-list-today"
              onClick={() => showListDay(today, true)}
              data-testid="month-list-today"
            >
              今日へ
            </button>
          )}
          {layout === 'list' ? (
            <ul
              ref={listRef}
              className="month-list"
              aria-label={`${ymText(ym)}の日ごとの一覧`}
              data-testid="month-list"
            >
              {listRows.map(({ row: r, extra, off }) => {
                const offPress = off === 'open' || off === 'requested';
                return (
                  <li key={r.date}>
                    <button
                      type="button"
                      className={[
                        'month-list-btn',
                        `is-state-${r.state}`,
                        r.isPast ? 'is-past' : '',
                        r.care ? 'is-care' : '',
                        r.caution ? 'is-caution' : '',
                        r.isToday ? 'is-today' : '',
                        r.date === date ? 'is-picked' : '',
                        off ? `is-off-${off}` : '',
                      ].join(' ')}
                      aria-label={`${r.label}${current === r.date ? '・作っています' : ''}`}
                      aria-pressed={off ? off === 'requested' : undefined}
                      aria-disabled={off !== undefined && !offPress ? true : undefined}
                      onClick={() => {
                        // カレンダーのマスと同じ動き：ふだんはその日の予定の画面、「休みを入れる」のときは希望休の付け外し
                        if (!off) openDay(r.date);
                        else if (offPress) toggleOff(r.date);
                      }}
                      data-testid="month-list-day"
                      data-date={r.date}
                      data-state={r.state}
                      data-off={off}
                    >
                      <span className={`month-list-date wd-${r.weekday}`}>
                        {r.dayText}
                        {r.isToday && <span className="month-today">今日</span>}
                      </span>
                      <span className="month-list-state">
                        {r.state === 'confirmed' && <Lock size={12} aria-hidden="true" />}
                        {r.state === 'diff' && <PencilLine size={12} aria-hidden="true" />}
                        {r.stateText}
                      </span>
                      <span className="month-list-count">{r.count > 0 ? `${r.count}件` : ''}</span>
                      <span className="month-list-flags">
                        {r.care && <span className="month-dot" aria-hidden="true" />}
                        {r.flags.map((f) => (
                          <span key={f.text} className={`month-flag is-${f.tone}`}>
                            {f.text}
                          </span>
                        ))}
                        {current === r.date && <span className="month-flag is-warn">作っています…</span>}
                      </span>
                      {extra.length > 0 && <span className="month-list-extra sub">{extra.join('・')}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <>
              <table ref={gridRef} className="month-grid" data-testid="month-grid">
                <thead>
                  <tr>
                    {WEEKDAY_LABELS.map((w, i) => (
                      <th key={w} scope="col" className={i === 0 ? 'is-sun' : i === 6 ? 'is-sat' : ''}>
                        {w}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week) => (
                    <tr key={week[0]}>
                      {week.map((d) => {
                        const s = statuses.get(d);
                        if (ymOf(d) !== ym || !s) {
                          return (
                            <td key={d} className="month-cell is-out">
                              <span className="month-day">{mdText(d)}</span>
                            </td>
                          );
                        }
                        return (
                          <DayCell
                            key={d}
                            date={d}
                            tipStore={tipStore}
                            status={s}
                            today={today}
                            picked={d === date}
                            making={current === d}
                            focus={focus.kind}
                            marks={marks.get(d)!}
                            load={focus.kind === 'all' ? (loads.get(d) ?? null) : undefined}
                            staffDay={staffDays.get(d)}
                            clientDay={clientDays.get(d)}
                            typeById={typeById}
                            staffById={staffById}
                            clientTerm={terms.client}
                            staffTerm={terms.staff}
                            offState={offStaffId ? offDayState(data, offStaffId, d, today) : undefined}
                            onOpen={openDay}
                            onToggleOff={toggleOff}
                          />
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <MonthCellTip gridRef={gridRef} tipStore={tipStore} />
            </>
          )}
        </div>

        <aside
          ref={asideRef}
          tabIndex={-1}
          className="card stack month-aside"
          data-testid="month-aside"
          aria-label="右の欄"
        >
          {focus.kind === 'all' && asideView === 'unconfirmed' && (
            <>
              <h2 className="month-aside-title">
                <Lock size={18} aria-hidden="true" />
                確定していない日
              </h2>
              {progress.unconfirmed.length > 0 && (
                <div className="month-confirm-bulk">
                  <button
                    type="button"
                    className="btn"
                    disabled={running || bulk.targets.length === 0}
                    aria-describedby={bulk.targets.length === 0 ? bulkWhyId : undefined}
                    onClick={confirmBulk}
                    data-testid="month-confirm-bulk"
                    data-count={bulk.targets.length}
                  >
                    <WithIcon icon={Lock} size={14}>
                      {bulkConfirmLabel(bulk.targets.length)}
                    </WithIcon>
                  </button>
                  {bulk.targets.length === 0 ? (
                    <p className="sub" id={bulkWhyId} data-testid="month-confirm-why">
                      {bulkConfirmWhy(bulk)}
                    </p>
                  ) : (
                    <p className="sub" data-testid="month-confirm-note">
                      一度も確定していない日のうち、必須の違反が無く、要対応に出ていない日を確定します。
                    </p>
                  )}
                </div>
              )}
              {progress.unconfirmed.length === 0 ? (
                <p className="sub">今日以降で、確定していない日はありません。</p>
              ) : (
                <ul className="month-attention" data-testid="month-unconfirmed">
                  {progress.unconfirmed.map((d) => (
                    <li key={d}>
                      <button
                        type="button"
                        className="month-attention-btn"
                        onClick={() => openDay(d)}
                        title="押すとその日の「日の予定」を開きます"
                      >
                        <span className="month-attention-date">
                          {mdText(d)}（{WEEKDAY_LABELS[weekday(d)]}）
                        </span>
                        <span>{STATE_TEXT[statuses.get(d)?.state ?? 'none']}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" className="btn btn-small" onClick={() => setAsideView('attention')}>
                <WithIcon icon={ListChecks} size={14}>
                  要対応を見る
                </WithIcon>
              </button>
            </>
          )}
          {focus.kind === 'all' && asideView === 'attention' && (
            <>
              <h2 className="month-aside-title">
                <ListChecks size={18} aria-hidden="true" />
                <Term k="attention" />
              </h2>
              {attention.length === 0 ? (
                <p className="sub">
                  今日以降で、入らない訪問・休みの人に残る訪問・条件が変わった日・出勤〜退勤（拘束）が上限を超える日・欠勤のある日はありません。
                </p>
              ) : (
                <ul className="month-attention" data-testid="month-attention">
                  {attention.map((a) => {
                    const t = attentionTarget(a, data.org.features);
                    return (
                      <li key={`${a.date}-${a.kind}`}>
                        <button
                          type="button"
                          className={`month-attention-btn is-${a.kind}`}
                          onClick={() => openTarget(t)}
                          data-to={t.to}
                        >
                          <span className="month-attention-date">
                            {mdText(a.date)}（{WEEKDAY_LABELS[weekday(a.date)]}）
                          </span>
                          <span>
                            {a.kind === 'unassigned' && (
                              <WithIcon icon={CircleAlert} size={14}>
                                入らない訪問 {a.count}件
                              </WithIcon>
                            )}
                            {a.kind === 'absentLeft' && (
                              <WithIcon icon={UserX} size={14}>
                                休みの人に訪問 {a.count}件
                              </WithIcon>
                            )}
                            {a.kind === 'stale' && (
                              <WithIcon icon={RefreshCw} size={14}>
                                条件が変わった
                              </WithIcon>
                            )}
                            {a.kind === 'overSpan' && (
                              <WithIcon icon={Timer} size={14}>
                                出勤〜退勤（拘束）が{data.org.spanLimitHours}時間を超える{' '}
                                {a.names.map(shortName).join('・')}
                              </WithIcon>
                            )}
                            {a.kind === 'absence' && (
                              <WithIcon icon={UserX} size={14}>
                                欠勤 {a.names.map(shortName).join('・') || `${a.count}人`}
                              </WithIcon>
                            )}
                            {/* 行き先を添える（PRD D201） */}
                            <small className="month-attention-go">{t.note}</small>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
          {focus.kind === 'staff' && staffSum && (
            <>
              <h2 className="month-aside-title">
                <UserRound size={18} aria-hidden="true" />
                {/* 名前を押すと詳細の吹き出し（PRD D122・D123） */}
                <span>
                  <PersonButton kind="staff" id={focus.id} name={focusName} testId="month-aside-name" />
                  さん・{monthNo}月
                </span>
              </h2>
              {staffSum.qualifications.length > 0 && (
                <div className="month-quals">
                  <span className="sub">資格</span>
                  {staffSum.qualifications.map((q) => (
                    <span key={q} className="chip">
                      {q}
                    </span>
                  ))}
                </div>
              )}
              <dl className="month-facts" data-testid="month-staff-sum">
                {staffById.get(focus.id)?.lastDay && (
                  <>
                    <dt>最終勤務日</dt>
                    <dd data-testid="month-staff-lastday">
                      {mdText(staffById.get(focus.id)?.lastDay ?? '')}（翌日から勤務なし）
                    </dd>
                  </>
                )}
                <dt>担当</dt>
                <dd>{staffSum.count}件</dd>
                <dt>稼働時間</dt>
                <dd>
                  {hoursText(staffSum.minutes)}（{staffSum.workDays}日）
                </dd>
                <dt>移動</dt>
                <dd>{staffSum.travel}分</dd>
                {staffSum.requestedDays > 0 && (
                  <>
                    <dt>{REQUESTED_OFF_NOTE}</dt>
                    <dd>{staffSum.requestedDays}日</dd>
                  </>
                )}
                {staffSum.absenceDays > 0 && (
                  <>
                    <dt>欠勤</dt>
                    <dd>{staffSum.absenceDays}日</dd>
                  </>
                )}
              </dl>
              <TypeList types={staffSum.types} typeById={typeById} />
              <p className="sub">数えるのはその日の今の案（無ければ確定した割当）です。</p>
            </>
          )}
          {focus.kind === 'client' && clientSum && (
            <>
              <h2 className="month-aside-title">
                <UserRound size={18} aria-hidden="true" />
                <span>
                  <PersonButton kind="client" id={focus.id} name={focusName} testId="month-aside-name" />・{monthNo}月
                </span>
              </h2>
              <dl className="month-facts" data-testid="month-client-sum">
                <dt>予定の回数</dt>
                <dd>{clientSum.planned}回</dd>
                <dt>この回だけ変更</dt>
                <dd>{clientSum.edited}回</dd>
                <dt>取り消し</dt>
                <dd>{clientSum.cancelled}回</dd>
                <dt>うち当日キャンセル</dt>
                <dd data-testid="month-client-sameday">{clientSum.sameDay}回</dd>
                <dt>休みのため無し</dt>
                <dd>{clientSum.leave}回</dd>
                <dt>いつもの担当でない</dt>
                <dd>{clientSum.substitute}回</dd>
              </dl>
              <h3 className="month-aside-sub">日ごと</h3>
              <ClientDots
                weeks={weeks}
                ym={ym}
                dotOf={(d) => {
                  const day = clientDays.get(d);
                  return day ? clientDot(day) : 'none';
                }}
              />
              <h3 className="month-aside-sub">担当した人</h3>
              {clientSum.byStaff.length === 0 ? (
                <p className="sub">この月の訪問はありません。</p>
              ) : (
                <ul className="month-bystaff">
                  {clientSum.byStaff.map((x) => (
                    <li key={x.staffId ?? '__none'}>
                      <span>
                        {x.staffId === null ? (
                          '案なし・入らない'
                        ) : (
                          <PersonButton kind="staff" id={x.staffId} name={staffById.get(x.staffId)?.name ?? ''} />
                        )}
                      </span>
                      <span>{x.count}回</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="sub">
                「代」はいつもの担当でない日、「変」はこの回だけ変えた回、「休み」は休みのため無しの回です。数えるのはその日の今の案（無ければ確定した割当）です。
              </p>
              {focusClient && <ClientLeavesSection client={focusClient} onOpenDay={openDay} compact />}
            </>
          )}
        </aside>
      </div>

      {panel && (
        <SidePanel
          icon={Layers}
          title={`${monthNo}月の案をまとめて作る`}
          onClose={() => setPanel(false)}
          footer={
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={panelTargets.length === 0}
                onClick={() => start(mode, mode !== 'stale')}
              >
                <WithIcon icon={Sparkles}>作り始める</WithIcon>
              </button>
              <button type="button" className="btn" onClick={() => setPanel(false)}>
                <WithIcon icon={X}>閉じる</WithIcon>
              </button>
            </>
          }
        >
          <div className="stack">
            <p>
              使う
              <Term k="preset" />：<strong data-testid="batch-preset">{basePreset?.name ?? '試す重み'}</strong>
              <span className="sub">（点数の基準。重みは「条件の重み」の画面で直します）</span>
            </p>
            <fieldset className="stack batch-mode" style={{ gap: 6 }}>
              <legend>対象</legend>
              <label className="check">
                <input
                  type="radio"
                  name="batch-mode"
                  checked={mode === 'empty'}
                  onChange={() => setMode('empty')}
                  style={{ width: 'auto' }}
                />
                まだ案の無い日だけ
              </label>
              <label className="check">
                <input
                  type="radio"
                  name="batch-mode"
                  checked={mode === 'all'}
                  onChange={() => setMode('all')}
                  style={{ width: 'auto' }}
                />
                確定していない日をすべて作り直す
              </label>
              {(mode === 'stale' || staleTargets.length > 0) && (
                <label className="check">
                  <input
                    type="radio"
                    name="batch-mode"
                    checked={mode === 'stale'}
                    onChange={() => setMode('stale')}
                    style={{ width: 'auto' }}
                    data-testid="batch-mode-stale"
                  />
                  条件が変わった日だけ作り直す（{staleTargets.length}日）
                </label>
              )}
            </fieldset>
            <p data-testid="batch-count">
              対象の日：<strong>{panelTargets.length}日</strong>
              {panelTargets.length > 0 && <span className="sub">（見込み {etaText(panelTargets.length)}）</span>}
            </p>
            {panelTargets.length === 0 && (
              <p className="warn-text">
                {noVisitsWhy ?? '対象の日がありません（今日より前の日・確定した日は作りません）'}
              </p>
            )}
            {mode === 'stale' ? (
              <p className="sub" data-testid="batch-stale-note">
                案を作ったあとに条件が変わった日を、{rebuildWith(basePreset?.name ?? '試す重み')}
                。手直しのある日は、作り始める前に確かめます。今日より前の日・確定した日は作りません
                {staleConfirmed > 0 &&
                  `（条件が変わった確定済みの日 ${staleConfirmed}日は、日の予定で確かめてください）`}
                。
              </p>
            ) : (
              <p className="sub">
                先に定期パターンからこの月の訪問を作ります。今日より前の日・確定した日は作りません。
              </p>
            )}
            {/* 案は作らずに訪問だけ作る（今月の準備の①から移した。PRD D154） */}
            {preview.added > 0 && (
              <p className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-small" onClick={expandOnly} data-testid="batch-expand-only">
                  <WithIcon icon={Repeat} size={14}>
                    訪問だけ作る（{preview.added}件。案は作らない）
                  </WithIcon>
                </button>
              </p>
            )}
            <p className="sub">
              1日ずつ作り、作れた日はすぐに保存します。「止める」で、作っている日はそれまでの最良の案で残し、残りの日はやめます。画面を離れても止まります（作れた日は残ります）。
            </p>
          </div>
        </SidePanel>
      )}
    </div>
  );
}

/** マウスを重ねてから読み方を出すまで（ms。マスの上を通り過ぎるだけでは出さない） */
const TIP_SHOW_MS = 300;
/** マスから離れてから読み方を消すまで（ms。隣のマスへ移るときにちらつかない） */
const TIP_HIDE_MS = 120;

/**
 * 月のマスの読み方の吹き出し（PRD D177）。マスにマウスを重ねる（少し止まったら）・キーボードでフォーカスする（:focus-visible）と、
 * そのマスの日付・状態の文と、出ている印の読み方（lib/monthGuide。マスの data-guide）を、マスの下（入らなければ上）に出す。
 * Esc・離れる・フォーカスが外れると消す。吹き出しはマウスを受けない（下のマスを隠して押せなくしない）。タッチでは出さない（押すと日の画面）
 */
function MonthCellTip({ gridRef, tipStore }: { gridRef: RefObject<HTMLElement | null>; tipStore: TipStore }) {
  const tipId = `month-cell-tip-${useId().replace(/:/g, '')}`;
  /**
   * 出しているマス。日付で持つ（描き直しでマスの要素が替わっても閉じない）。by：出したきっかけ。
   * キーボードで出しているあいだはマウスの出入りを見ない（止まったマウスの上で表が描き直されると、動かしていなくても出入りが起きる）
   */
  const [at, setAt] = useState<{ date: string; by: 'pointer' | 'focus' } | null>(null);
  const timer = useRef<number | null>(null);
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: 表の要素に1回だけ付ける
  useEffect(() => {
    const root = gridRef.current;
    if (!root) return;
    const cellOf = (t: EventTarget | null): HTMLElement | null =>
      t instanceof Element ? (t.closest('[data-tip]') as HTMLElement | null) : null;
    const dateOf = (t: EventTarget | null): string | null => cellOf(t)?.dataset.date ?? null;
    const over = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const d = dateOf(e.target);
      if (!d) return;
      setAt((cur) => {
        if (cur?.by === 'focus') return cur;
        clear();
        // すでに出ていれば隣のマスへすぐ移す
        if (cur) return cur.date === d ? cur : { date: d, by: 'pointer' };
        timer.current = window.setTimeout(() => setAt({ date: d, by: 'pointer' }), TIP_SHOW_MS);
        return cur;
      });
    };
    const out = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const d = dateOf(e.target);
      // 同じ日のマスの中（描き直して替わった要素も）へ移るだけなら消さない
      if (d && dateOf(e.relatedTarget) === d) return;
      setAt((cur) => {
        if (cur?.by === 'focus') return cur;
        clear();
        timer.current = window.setTimeout(() => setAt(null), TIP_HIDE_MS);
        return cur;
      });
    };
    const focusIn = (e: FocusEvent) => {
      const c = cellOf(e.target);
      const d = c?.dataset.date;
      clear();
      setAt(c?.matches(':focus-visible') && d ? { date: d, by: 'focus' } : null);
    };
    const focusOut = () => {
      clear();
      setAt(null);
    };
    root.addEventListener('pointerover', over);
    root.addEventListener('pointerout', out);
    root.addEventListener('focusin', focusIn);
    root.addEventListener('focusout', focusOut);
    return () => {
      clear();
      root.removeEventListener('pointerover', over);
      root.removeEventListener('pointerout', out);
      root.removeEventListener('focusin', focusIn);
      root.removeEventListener('focusout', focusOut);
    };
  }, []);
  // 出ている間の Esc は読み方を消すだけ（ほかの欄の Esc は出ていないときだけ届く）
  useEffect(() => {
    if (!at) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      setAt(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [at]);
  // 文は日付で引く（描画中に DOM の data-* を読まない。休みを切り替えたら新しい文。PR #42 のレビュー）
  const date = at?.date ?? null;
  const tip = useSyncExternalStore(tipStore.subscribe, () => (date ? tipStore.get(date) : null));
  // 置く先は日付でいまのマスを引く（描き直しで要素が替わっても同じ日のマス）
  const cellAt = () =>
    date ? (gridRef.current?.querySelector<HTMLElement>(`[data-tip][data-date="${date}"]`) ?? null) : null;
  return (
    <TipBubble
      id={tipId}
      anchor={cellAt}
      open={!!tip && !!cellAt()}
      className="is-passive month-cell-tip"
      testId="month-cell-tip"
    >
      {tip && (
        <>
          <strong>{tip.head}</strong>
          <span>{tip.text}</span>
          <strong className="month-cell-tip-sub">このマスの読み方</strong>
          <ul>
            {tip.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      )}
    </TipBubble>
  );
}

/**
 * 月の見出しの凡例：日の状態（背景・枠と印）と、3段バーの色と目盛り（見出しに1回）。
 * はじめは1行の要約と「凡例を見る」に畳む（PRD D177。開いたかどうかは保存しない）。
 * bar：全体は混み具合（load）、〈スタッフ〉を選んだときはその人の時間帯の状態（staff。PRD D75）
 */
function MonthLegend({ bar }: { bar: 'load' | 'staff' | null }) {
  return (
    <details className="month-legend-fold" data-testid="month-legend-fold">
      <summary className="month-legend-summary" data-testid="month-legend-toggle">
        <span className="month-legend-open">
          <span className="is-closed">凡例を見る</span>
          <span className="is-opened">凡例を閉じる</span>
        </span>
        <span className="sub month-legend-line">
          色＝日の状態・黄の点線＝案なし（注意）・赤い枠と点＝要対応・▶■＝始まる／終わる
          {bar === 'load' ? '・棒＝30分ごとの空き' : bar === 'staff' ? '・棒＝その人の時間帯' : ''}
          。マスにマウスを乗せるかフォーカスすると、そのマスの読み方が出ます
        </span>
      </summary>
      <MonthLegendBody bar={bar} />
    </details>
  );
}

/** 凡例の中身（開いたとき） */
function MonthLegendBody({ bar }: { bar: 'load' | 'staff' | null }) {
  return (
    <div className="month-legend" data-testid="month-legend">
      <span className="month-legend-group">
        {STATE_ORDER.map((st) => (
          <span key={st} className="month-legend-item">
            <span className={`month-swatch is-state-${st}`} aria-hidden="true">
              {st === 'confirmed' && <Lock size={9} />}
              {st === 'diff' && <PencilLine size={9} />}
            </span>
            {/* 確定済み・未確定の変更ありは説明つき（PRD D242） */}
            {st === 'confirmed' ? (
              <Term k="confirmed">{STATE_TEXT[st]}</Term>
            ) : st === 'diff' ? (
              <Term k="confirmDiff" />
            ) : (
              STATE_TEXT[st]
            )}
          </span>
        ))}
        <span className="month-legend-item">
          <span className="month-swatch is-caution" aria-hidden="true" />
          注意（今日以降で案なし）
        </span>
        <span className="month-legend-item">
          <span className="month-swatch is-care" aria-hidden="true">
            <span className="month-dot" />
          </span>
          要対応（入らない・違反・休みの人に訪問）
        </span>
        <span className="month-legend-item">▶ 始まる・■ 終わる</span>
      </span>
      {bar !== null && (
        <span className="month-legend-group">
          <span className="month-legend-load">
            <span className="sub">{bar === 'load' ? '混み具合' : '時間帯'}</span>
            <LoadRowsSample />
            <span className="sub">
              {barRowsText()}
              {barEdgeNote()}
            </span>
          </span>
          {bar === 'load' ? <LoadLegend /> : <StaffLegend />}
          {bar === 'staff' && (
            <span className="sub" data-testid="month-staff-bar-note">
              時間帯は今の案（無ければ確定）で出します。混み具合は確定を先に数えるので、未確定の変更がある日は空きの人数が合わないことがあります
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/** 種類ごとの件数（色の丸と名前と件数） */
function TypeList({ types, typeById }: { types: readonly TypeCount[]; typeById: ReadonlyMap<string, VisitType> }) {
  if (types.length === 0) return null;
  return (
    <ul className="month-types" aria-label="種類ごとの件数">
      {types.map((x) => {
        const t = x.typeId === null ? undefined : typeById.get(x.typeId);
        return (
          <li key={x.typeId ?? '__none'}>
            <span
              className="month-type-dot"
              style={{ background: t ? colorOf(t.color) : '#cfc4bb' }}
              aria-hidden="true"
            />
            <span>{t?.name ?? '種類なし'}</span>
            <span>{x.count}件</span>
          </li>
        );
      })}
    </ul>
  );
}

/** 名前の並びを短く（「消防」「消防 ほか1人」） */
function namesShort(names: readonly string[]): string {
  if (names.length === 0) return '';
  const first = shortName(names[0]!);
  return names.length === 1 ? first : `${first} ほか${names.length - 1}人`;
}

type CellProps = {
  date: string;
  /** マスの読み方の文の置き場（日付で引く。MonthCellTip） */
  tipStore: TipStore;
  status: DayStatus;
  today: string;
  picked: boolean;
  making: boolean;
  focus: Focus['kind'];
  marks: DayMarks;
  /** 全体のときだけ（null＝案なし） */
  load: DayLoadSlot[] | null | undefined;
  staffDay: StaffDay | undefined;
  clientDay: ClientDay | undefined;
  typeById: ReadonlyMap<string, VisitType>;
  staffById: ReadonlyMap<string, Staff>;
  /** 〈利用者さん〉の呼び方（org.terms.client。休みの印の title） */
  clientTerm: string;
  /** 〈スタッフ〉の呼び方（org.terms.staff。休む人の印の title） */
  staffTerm: string;
  /** 「休みを入れる」のときのその日の扱い（PRD D69。それ以外は undefined＝押すと日の画面へ） */
  offState: OffDayState | undefined;
  onOpen: (date: string) => void;
  onToggleOff: (date: string) => void;
};

/** 「休みを入れる」のときのマスの説明（読み上げ・title） */
const OFF_STATE_TEXT: Record<OffDayState, string> = {
  open: `押すと${REQUESTED_OFF_NOTE}にします`,
  requested: `${REQUESTED_OFF_NOTE}です。押すと外します`,
  noShift: '勤務の無い日です（押せません）',
  past: '今日より前の日です（押せません）',
  absent: 'ほかの欠勤が入っています。日の予定で直してください（押せません）',
};

/** 日のマス（memo。月まとめ作成の進み具合などで、変わらないマスは描き直さない） */
const DayCell = memo(function DayCell(props: CellProps) {
  const {
    date: d,
    status: s,
    today,
    picked,
    making,
    focus,
    marks: mk,
    load,
    typeById,
    staffById,
    clientTerm,
    staffTerm,
    offState,
  } = props;
  /** 「休みの人に N」の印（欠勤・希望休・最終勤務日の後の人に残る訪問の事実なので、希望休のまとめ入力を切っても出す。ADR-0028） */
  const absentLeft = s.absentLeft;
  const past = d < today;
  // 赤は要対応だけ（PRD D228）。今日以降で訪問があるのに案の無い日は注意（黄の点線）
  const care = s.needsCare && !past;
  const caution = !care && !past && s.count > 0 && s.state === 'none';
  const typeName = (id: string | null) => (id === null ? '種類なし' : (typeById.get(id)?.name ?? '種類なし'));
  const parts: string[] = [longDate(d)];
  const body: ReactNode[] = [];

  if (s.count > 0) parts.push(`訪問 ${s.count}件`, STATE_TEXT[s.state]);
  else parts.push('訪問なし');
  if (care) parts.push('要対応');
  if (caution) parts.push('注意：まだ案が無い');
  if (s.unassigned > 0) parts.push(`入らない ${s.unassigned}件`);
  if (s.hard > 0) parts.push(`必須の違反 ${s.hard}件`);
  if (absentLeft > 0) parts.push(`休みの人に訪問 ${absentLeft}件`);
  if (s.stale) parts.push('条件が変わった');
  if (s.overSpan.length > 0) parts.push(`出勤〜退勤（拘束）が上限を超える ${s.overSpan.length}人`);
  if (making) parts.push('作っています');

  const flags = (
    <>
      {s.unassigned > 0 && (
        <span className="month-flag is-red">
          <CircleAlert size={12} aria-hidden="true" />
          入らない {s.unassigned}
        </span>
      )}
      {s.hard > 0 && (
        <span className="month-flag is-red">
          <CircleAlert size={12} aria-hidden="true" />
          違反 {s.hard}
        </span>
      )}
      {absentLeft > 0 && (
        <span
          className="month-flag is-red"
          title="休み（欠勤・希望休）の人に訪問が残っています。日の予定で振り直してください"
          data-testid="month-absent-left"
        >
          <UserX size={12} aria-hidden="true" />
          休みの人に {absentLeft}
        </span>
      )}
      {s.stale && (
        <span className="month-flag is-warn" data-testid="month-stale">
          <RefreshCw size={12} aria-hidden="true" />
          条件が変わった
        </span>
      )}
      {s.overSpan.length > 0 && (
        <span
          className="month-flag is-warn"
          title={`出勤〜退勤（拘束。最初の訪問の開始〜最後の訪問の終わり）が上限を超える${staffTerm}：${s.overSpan
            .map((id) => staffById.get(id)?.name ?? '')
            .join('・')}`}
          data-testid="month-over-span"
        >
          <Timer size={12} aria-hidden="true" />
          拘束超 {s.overSpan.length}
        </span>
      )}
      {making && <span className="month-flag is-warn">作っています…</span>}
    </>
  );

  if (focus === 'all') {
    if (mk.types.length > 0)
      parts.push(`種類：${mk.types.map((x) => `${typeName(x.typeId)} ${x.count}件`).join('・')}`);
    const resting = mk.off.length + mk.requested.length;
    // 読み上げにも内訳（希望休か勤務なしか・名前）を入れる
    const restDetail = [
      mk.requested.length > 0 ? `${REQUESTED_OFF_NOTE}：${mk.requested.join('・')}` : '',
      mk.off.length > 0 ? `勤務なし：${mk.off.join('・')}` : '',
    ]
      .filter(Boolean)
      .join('／');
    if (resting > 0) parts.push(`休む${staffTerm} ${resting}人（${restDetail}）`);
    if (mk.absent.length > 0) parts.push(`欠勤 ${mk.absent.join('・')}`);
    if (mk.starts.length > 0) parts.push(`始まる ${mk.starts.join('・')}`);
    if (mk.ends.length > 0) parts.push(`終わる ${mk.ends.join('・')}`);
    if (mk.leaves.length > 0) parts.push(`${clientTerm}の休み ${mk.leaves.join('・')}`);
    if (mk.lastDays.length > 0) parts.push(`最終勤務日 ${mk.lastDays.join('・')}`);
    // 読み上げ：8〜20時のまとめ＋8時より前・20時以降の端の文（PRD D82。二重に読まない）
    if (load) parts.push(withEdges(loadSummary(inBar(load)), loadEdgeTexts(load)));
    else if (load === null) parts.push('混み具合は案が無いので数えていません');
    body.push(
      <TypeStack key="types" types={mk.types} typeById={typeById} />,
      <span key="marks" className="month-marks">
        {resting > 0 && (
          <span
            className={`month-mark${mk.requested.length > 0 ? ' is-requested' : ''}`}
            title={`休む${staffTerm} ${resting}人（${restDetail}）`}
            data-testid="month-resting"
          >
            休 {resting}
            {/* 希望休は色だけでなく文字でも分ける */}
            {mk.requested.length > 0 && `（希${mk.requested.length}）`}
          </span>
        )}
        {mk.absent.length > 0 && (
          <span className="month-mark is-absent" title={`欠勤：${mk.absent.join('・')}`}>
            欠 {namesShort(mk.absent)}
          </span>
        )}
        {mk.starts.length > 0 && (
          <span className="month-mark" title={`始まる：${mk.starts.join('・')}`}>
            ▶{mk.starts.length === 1 ? ` ${shortName(mk.starts[0]!)}` : ` ${mk.starts.length}人`}
          </span>
        )}
        {mk.ends.length > 0 && (
          <span className="month-mark" title={`終わる：${mk.ends.join('・')}`}>
            ■{mk.ends.length === 1 ? ` ${shortName(mk.ends[0]!)}` : ` ${mk.ends.length}人`}
          </span>
        )}
        {mk.leaves.length > 0 && (
          <span
            className="month-mark is-leave"
            title={`${clientTerm}の休み（訪問は無し）：${mk.leaves.join('・')}`}
            data-testid="month-leave"
          >
            <BedSingle size={11} aria-hidden="true" />
            {mk.leaves.length === 1 ? shortName(mk.leaves[0]!) : `${mk.leaves.length}人`}
          </span>
        )}
        {mk.lastDays.length > 0 && (
          <span
            className="month-mark is-lastday"
            title={`最終勤務日（翌日から勤務なし）：${mk.lastDays.join('・')}`}
            data-testid="month-lastday"
          >
            最終 {namesShort(mk.lastDays)}
          </span>
        )}
      </span>,
      <span key="flags" className="month-flags">
        {flags}
      </span>,
      <span key="load" className="month-load">
        <LoadBar load={load ?? null} />
      </span>,
    );
  } else if (focus === 'staff' && props.staffDay) {
    const x = props.staffDay;
    // 勤務がふつうの日は時刻を出さず（3段バーで見せる。PRD D75）、休み・欠勤・最終勤務日の後だけ短い文字を出す
    const shiftShort = x.retired
      ? '最終勤務日の後'
      : x.absence
        ? x.requested
          ? REQUESTED_OFF_NOTE
          : x.slots.length === 0
            ? '欠勤'
            : '欠勤あり'
        : x.off
          ? '休'
          : null;
    const shift =
      shiftShort === null
        ? slotsText(x.slots)
        : x.absence && x.slots.length > 0 && !x.requested
          ? `${shiftShort} ${slotsText(x.slots)}`
          : shiftShort;
    parts.push(shift);
    // 訪問があるのに案の無い日（今の案も確定も無い）：件数も出す（空いていると誤読させない。PRD D75 の追記）
    const noPlanText = x.noPlan ? `案なし（訪問 ${s.count}件）` : null;
    if (noPlanText) parts.push(noPlanText);
    if (x.count > 0 || x.target !== null) {
      parts.push(`担当 ${x.count}件`);
      if (x.target !== null) parts.push(`目安 ${Math.round(x.target * 10) / 10}件`);
    }
    if (x.travel > 0) parts.push(`移動 ${x.travel}分`);
    parts.push(withEdges(`時間帯：${staffSlotSummary(inBar(x.bar))}`, staffEdgeTexts(x.bar)));
    // 勤務の無い日の「休」は、バーに重ねた「休み」（PRD D85）と二重にしないよう読み上げだけ（週の表と同じ。
    // 欠勤・希望休・最終勤務日の後は理由の文字なので残す）
    const restCovered = shiftShort === '休' && isAllRest(x.bar);
    body.push(
      shiftShort !== null ? (
        <span
          key="shift"
          className={`month-shift${x.retired ? ' is-retired' : x.absence ? (x.requested ? ' is-requested' : ' is-absent') : ' is-off'}${restCovered ? ' sr-only' : ''}`}
          data-testid="month-shift"
        >
          {x.absence &&
            (x.requested ? <CalendarOff size={12} aria-hidden="true" /> : <UserX size={12} aria-hidden="true" />)}
          {shiftShort}
        </span>
      ) : null,
      // 勤務の無い日（バーは全部休み）は「休」などの文字だけにする（案なしは読み上げ・title に残す）
      noPlanText && x.slots.length > 0 ? (
        <span key="noplan" className="sub" data-testid="month-staff-noplan">
          {noPlanText}
        </span>
      ) : null,
      <span key="bar" className="month-load is-staff">
        <StaffBar slots={x.bar} />
      </span>,
    );
  } else if (focus === 'client' && props.clientDay) {
    const x = props.clientDay;
    if (x.noPlan) parts.push('案なし');
    const MAX = 4;
    for (const v of x.visits) {
      const who = v.cancelled
        ? v.sameDay
          ? '当日キャンセル'
          : '取り消し'
        : v.leave
          ? '休みのため無し'
          : v.staffId
            ? `${staffById.get(v.staffId)?.name ?? ''}さん${v.substitute ? '（いつもの担当でない）' : ''}`
            : v.unassigned
              ? '入らない'
              : '担当未定';
      parts.push(`${hm(v.start)} ${typeName(v.typeId)} ${who}${v.edited ? '（この回だけ変更）' : ''}`);
    }
    body.push(
      <span key="visits" className="month-cvisits">
        {x.visits.slice(0, MAX).map((v) => {
          const t = v.typeId === null ? undefined : typeById.get(v.typeId);
          return (
            <span
              key={v.visitId}
              className={`month-cvisit${v.cancelled ? ' is-cancelled' : ''}${v.leave ? ' is-leave' : ''}`}
            >
              <span
                className="month-type-dot"
                style={{ background: t ? colorOf(t.color) : '#cfc4bb' }}
                aria-hidden="true"
              />
              <span className="month-cvisit-time">{hm(v.start)}</span>
              <span className="month-cvisit-who">
                {v.cancelled
                  ? v.sameDay
                    ? '当日取消'
                    : '取消'
                  : v.leave
                    ? '休み'
                    : v.staffId
                      ? shortName(staffById.get(v.staffId)?.name ?? '')
                      : v.unassigned
                        ? '入らない'
                        : '未定'}
              </span>
              {v.substitute && (
                <span className="month-badge is-sub" title="いつもの担当でない">
                  代
                </span>
              )}
              {v.edited && !v.cancelled && (
                <span className="month-badge" title="この回だけ変更">
                  変
                </span>
              )}
            </span>
          );
        })}
        {x.visits.length > MAX && <span className="sub">ほか{x.visits.length - MAX}件</span>}
      </span>,
      x.noPlan ? (
        <span key="noplan" className="sub">
          案なし
        </span>
      ) : null,
    );
  }
  if (focus !== 'all')
    body.push(
      <span key="flags" className="month-flags">
        {flags}
      </span>,
    );

  if (offState) parts.push(OFF_STATE_TEXT[offState]);
  const label = parts.join('・');
  // マスの読み方（PRD D177）：出ている印だけの説明。マウスを重ねる・フォーカスで出す吹き出し（MonthCellTip）が読む
  const restingAll = mk.off.length + mk.requested.length;
  const cv = focus === 'client' ? (props.clientDay?.visits ?? []) : [];
  const guide = cellGuide({
    focus,
    count: s.count,
    stateText: s.count > 0 ? STATE_TEXT[s.state] : null,
    care,
    caution,
    types: focus === 'all' && mk.types.length > 0,
    resting: restingAll,
    requested: mk.requested.length,
    absent: mk.absent.length > 0,
    starts: mk.starts.length > 0,
    ends: mk.ends.length > 0,
    leaves: mk.leaves.length > 0,
    lastDays: mk.lastDays.length > 0,
    loadBar: focus !== 'all' ? null : load ? 'load' : load === null ? 'noPlan' : null,
    unassigned: s.unassigned > 0,
    hard: s.hard > 0,
    absentLeft: absentLeft > 0,
    stale: s.stale,
    overSpan: s.overSpan.length > 0,
    substitute: cv.slice(0, 4).some((v) => v.substitute),
    edited: cv.slice(0, 4).some((v) => v.edited && !v.cancelled),
    staffTerm,
    clientTerm,
  });
  const offPress = offState === 'open' || offState === 'requested';
  const tipText = `${parts.slice(1).join('・')}${offState ? '' : '（押すとこの日の「日の予定」を開きます）'}`;
  const guideKey = guide.join('\n');
  // 描いたあとに、日付をキーに読み方の文を置く（吹き出しは日付で引く。描画中に DOM を読まない。PR #42 のレビュー）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 文（guideKey）が変わったときだけ置き直す
  useLayoutEffect(() => {
    props.tipStore.set(d, { head: longDate(d), text: tipText, lines: guide });
  }, [props.tipStore, d, tipText, guideKey]);
  return (
    <td
      className={[
        'month-cell',
        s.count > 0 ? `is-state-${s.state}` : 'is-novisit',
        past ? 'is-past' : '',
        care ? 'is-care' : '',
        caution ? 'is-caution' : '',
        d === today ? 'is-today' : '',
        picked ? 'is-picked' : '',
        making ? 'is-making' : '',
        focus === 'staff' && props.staffDay && props.staffDay.slots.length === 0 ? 'is-rest' : '',
        offState ? `is-off-${offState}` : '',
      ].join(' ')}
    >
      <button
        type="button"
        className="month-cell-btn"
        data-testid="month-day"
        data-date={d}
        data-state={s.count > 0 ? s.state : 'empty'}
        data-off={offState}
        aria-label={label}
        aria-pressed={offState ? offState === 'requested' : undefined}
        // 押せない日も Tab で届き、理由（aria-label）が読み上がるよう disabled にしない。押しても何もしない
        aria-disabled={offState !== undefined && !offPress ? true : undefined}
        // 見た目の説明は title ではなく読み方の吹き出し（MonthCellTip。title と二重に出さない）
        data-tip="cell"
        onClick={() => {
          if (!offState) props.onOpen(d);
          else if (offPress) props.onToggleOff(d);
        }}
      >
        <span className="month-cell-head">
          <span className="month-day">
            {Number(d.slice(8, 10))}
            {d === today && <span className="month-today">今日</span>}
          </span>
          {s.count > 0 && s.state === 'confirmed' && <Lock size={12} className="month-lock" aria-hidden="true" />}
          {/* 未確定の変更あり（淡い黄）は案あり（淡い緑）と色だけで分けない */}
          {s.count > 0 && s.state === 'diff' && (
            <PencilLine size={12} className="month-diff-icon" aria-hidden="true" data-testid="month-diff-mark" />
          )}
          {care && <span className="month-dot" aria-hidden="true" />}
          {s.count > 0 && focus === 'all' && <span className="month-count">{s.count}件</span>}
        </span>
        {body}
      </button>
    </td>
  );
});

/** メディアクエリが合っているか（幅を変えたら追う。PRD D189 の一覧の既定） */
function useMedia(query: string): boolean {
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
