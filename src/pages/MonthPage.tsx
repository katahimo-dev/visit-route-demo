import {
  BedSingle,
  CalendarDays,
  CalendarOff,
  CalendarRange,
  CircleAlert,
  Info,
  LayoutGrid,
  List,
  ListChecks,
  Lock,
  PencilLine,
  Printer,
  SlidersHorizontal,
  Square,
  Timer,
  UserX,
  X,
} from 'lucide-react';
import {
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
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
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useDay } from '../app/day';
import { ClientPicker } from '../components/ClientPicker';
import { useConfirm } from '../components/ConfirmDialog';
import { FieldError } from '../components/FieldError';
import { LoadBar, LoadLegend, LoadRowsSample, loadSummary, TypeStack } from '../components/loadBar';
import type { MenuItem as MoreItem } from '../components/MenuButton';
import { PersonButton } from '../components/PersonPopover';
import { ClientDot } from '../components/parts';
import { type BandModel, ProgressBand } from '../components/progressBand';
import { ScheduleNav } from '../components/ScheduleNav';
import { StaffMark } from '../components/StaffMark';
import { RangeProposalBand, ScheduleToolbar, SelectionBar } from '../components/scheduleParts';
import { StaffBar, StaffLegend } from '../components/staffBar';
import { Term, TipBubble } from '../components/Term';
import { useToast } from '../components/Toast';
import { PageHeader, SidePanel, WithIcon } from '../components/ui';
import { useOpenVisit } from '../components/VisitPanel';
import { focusVisitItem, KeyMoveBand, useVisitKeys, visitItemOf } from '../components/visitKeys';
import {
  type DropHover,
  SelectToggle,
  useVisitDrag,
  useVisitItem,
  useVisitLooks,
  useVisitSelection,
  VisitRow,
  type VisitRowData,
} from '../components/visitParts';
import type { Staff, Visit, VisitType } from '../contracts/documents';
import { slotsText, timeText } from '../domain/availability';
import { isOnLeave } from '../domain/leaves';
import { addDays, hhmmToMinutes, jstDate, minutesToHhmm, weekday } from '../domain/time';
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
import { attempt, byDisplayName, byName, newId, WEEKDAY_LABELS } from '../lib/common';
import { bulkConfirmDialog, bulkConfirmLabel, bulkConfirmTargets, bulkConfirmWhy, confirmDay } from '../lib/confirmDay';
import { isOn } from '../lib/features';
import { attentionTarget, type LinkTarget } from '../lib/links';
import {
  addMonths,
  attentionList,
  batchTargets,
  type ClientDay,
  calendarWeeks,
  clientDay,
  type DayMarks,
  type DayPlan,
  type DayStatus,
  dayMarks,
  dayPlanOf,
  firstDayOf,
  issueBreakdown,
  isYm,
  monthDates,
  monthProgress,
  type StaffDay,
  shortName,
  staffDay,
  staffMonth,
  type TypeCount,
  ymOf,
} from '../lib/month';
import { monthBatch } from '../lib/monthBatch';
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
import { attentionCountByDate, showRestMark, usualRestByWeekday } from '../lib/monthRest';
import { scrollBehavior } from '../lib/motion';
import { mdText } from '../lib/patternText';
import { type BandOp, bandHref, urgentCount } from '../lib/progressBand';
import {
  type OffDayState,
  offDayState,
  REQUESTED_OFF_NOTE,
  requestedOffDates,
  toggleRequestedOff,
} from '../lib/requestedOff';
import { staffClientMap } from '../lib/search';
import { isAllRest, staffEdgeTexts, staffSlotSummary } from '../lib/staffBar';
import { useDayModel } from '../lib/useDayModel';
import { useDayStatuses } from '../lib/useDayStatuses';
import { usualStaffMap } from '../lib/usualStaff';
import { useValueStore } from '../lib/valueStore';
import { dropShadowText, dropTone } from '../lib/visitDrop';
import { cellKeyOf } from '../lib/visitKeys';
import { canSelectVisit, isMultiClick } from '../lib/visitSelect';
import { findVisit, visitsOn } from '../patterns';
import { type DayLoadSlot, dayLoad } from '../vacancy';
import './month.css';
import './settings.css';

/**
 * 月間カレンダーと月まとめ作成（ADR-0012。PRD D39〜D43・D53〜D55。design.md §4 pages「月単位の予定」「月間・週間の改定」）。
 * 日のマスは点数を出さず、状態を背景・枠と印で（凡例あり。読み上げには状態の文字）、種類の積み上げバー・休み欠勤の印・
 * 始まる▶終わる■の印・混み具合バー（vacancy の dayLoad）。「表示」で〈スタッフ〉か〈利用者さん〉を1人選ぶと、日のマスと
 * 右の欄がその人のものになる（?staff= ?client=）。選ばないときの右の欄は要対応。押すとその日の予定の画面へ。
 * 担当を AI で組むのは「担当を組む」の画面（#/arrange。ADR-0063）。この画面は組んでいる間の進み具合と止めるだけを出し
 * （計算は画面の外の lib/monthBatch。ADR-0042）、出た提案は範囲の提案の帯で反映する
 */

const longDate = (d: string) =>
  `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日（${WEEKDAY_LABELS[weekday(d)]}）`;
const ymText = (ym: string) => `${ym.slice(0, 4)}年${Number(ym.slice(5, 7))}月`;
const hm = (t: number) => timeText(minutesToHhmm(t));
const hoursText = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10}時間`;

/** 日の状態の言葉（一覧と同じ。lib/monthList） */
const STATE_TEXT = DAY_STATE_TEXT;
const STATE_ORDER: DayStatus['state'][] = ['none', 'told', 'changed'];

/** 表示の選択：全体／〈スタッフ〉1人／〈利用者さん〉1人 */
type Focus = { kind: 'all' } | { kind: 'staff'; id: string } | { kind: 'client'; id: string };

const sameList = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export default function MonthPage() {
  const { date, setDate, dates: dataDates } = useDay();
  /** 予定のモード（PRD D348）：確認では札を動かさない */
  const { data, update, compileInput } = useDayModel(date);
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
  /** 月まとめ作成の進み具合（画面の外の計算。作っていなければ null。PRD D256） */
  const batch = useValueStore(monthBatch.run);
  /** 最後に終わった月まとめ作成（計算できずに止まった理由を出す） */
  const batchDone = useValueStore(monthBatch.done);
  const [error, setError] = useState<string | null>(null);
  /** 混み具合で数える人（null＝すべての人。種類の ID） */
  const [loadType, setLoadType] = useState<string | null>(null);
  /** 「休みを入れる」（希望休のまとめ入力。PRD D69）：〈スタッフ〉を選んでいるときだけ。日のマスを押すと希望休を付け外し */
  const [offMode, setOffMode] = useState(false);
  /** 「その他 ▾」の「表示を選ぶ」で開いた表示の選択の段（PRD D278。保存しない） */
  const [pickersOpen, setPickersOpen] = useState(false);
  /** 「その他 ▾」の「マスの見方」で開いた説明（PRD D278。保存しない） */
  const [helpOpen, setHelpOpen] = useState(false);
  /** 表示の選択の段の最初の欄（開いたらここへフォーカス） */
  const focusSelectRef = useRef<HTMLSelectElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  // 「表示を選ぶ」で開いたら最初の欄へ、「マスの見方の説明」で開いたら説明へフォーカス（メニューのボタンへ戻ったあと）
  /** 「表示を選ぶ」で開いたときだけ欄へフォーカスする（段の中で選び直して出したままにするときは動かさない） */
  const focusPickers = useRef(false);
  useEffect(() => {
    if (pickersOpen && focusPickers.current) focusSelectRef.current?.focus();
    focusPickers.current = false;
  }, [pickersOpen]);
  useEffect(() => {
    if (helpOpen) helpRef.current?.focus();
  }, [helpOpen]);
  /** 最後に付け外しした結果（読み上げ） */
  const [offNote, setOffNote] = useState<{ date: string; text: string; warn: boolean } | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  /** 作っているか（確認のあとなど、描く前にも今の値を見る） */
  const runningNow = () => monthBatch.running();
  // この画面を開いている間に計算できずに止まったら、理由を出す（ほかの画面で止まったときは知らせ（トースト）だけ）
  const seenDone = useRef(batchDone);
  useEffect(() => {
    if (batchDone === seenDone.current) return;
    seenDone.current = batchDone;
    if (batchDone?.error) setError(batchDone.error);
  }, [batchDone]);

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
    // 段の中で選び直しても段は出したまま（全体に戻しても消してフォーカスを落とさない。PRD D278）
    setPickersOpen(true);
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

  const weeks = useMemo(() => calendarWeeks(ym), [ym]);
  const days = useMemo(() => monthDates(ym), [ym]);
  /** 日ごとの訪問（計算した繰り返しの回も。版2。ADR-0053） */
  const visitsByDate = useMemo(() => {
    const out = new Map<string, readonly Visit[]>();
    for (const d of days) out.set(d, visitsOn(data, d));
    return out;
  }, [data, days]);

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
    const clientOf = new Map([...visitsByDate.values()].flat().map((v) => [v.id, v.clientId]));
    const pairs: [string, string | undefined][] = [];
    for (const d of days)
      for (const [sid, ids] of Object.entries(dayPlans.get(d)?.routes ?? {}))
        for (const id of ids) pairs.push([sid, clientOf.get(id)]);
    return staffClientMap(pairs, data.clients, usualStaffMap(data.patterns, today));
  }, [days, dayPlans, visitsByDate, data.clients, data.patterns, today]);
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
      const key = [...base, ...visits];
      const hit = loadMemo.current.get(d);
      if (hit && sameList(hit.key, key)) {
        out.set(d, hit.value);
        continue;
      }
      const value = attempt(() => dayLoad(data, d, { typeId: loadType })).value ?? null;
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
      update((x) => toggleRequestedOff(x, offStaffId, d, today, id).data, '希望休');
      const name = staffById.get(offStaffId)?.name ?? '';
      const n = staffDaysRef.current.get(d)?.count ?? 0;
      if (res.result === 'added') {
        setOffNote({
          date: d,
          warn: n > 0,
          text:
            n > 0
              ? `${mdText(d)} を${REQUESTED_OFF_NOTE}にしました。${name}さんにこの日の訪問が ${n}件あります。${suddenOn ? '日の予定のその人の列の「欠勤を直す」から振り直してください' : '日の予定で担当を振り直してください'}`
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
  const attention = useMemo(
    () => attentionList(data, days.map((d) => statuses.get(d)!).filter(Boolean), today),
    [data, days, statuses, today],
  );
  /** 日ごとの要対応の札「要対応 N」の N（右の欄の行と同じ数え方。PRD D295） */
  const attentionByDate = useMemo(() => attentionCountByDate(attention), [attention]);
  /** 曜日ごとの「ふだん」の休みの人数（同じ月の同じ曜日の最頻値。「休 N」はこれより多い日だけ出す。PRD D295） */
  const usualRest = useMemo(
    () =>
      usualRestByWeekday(
        days
          .filter((d) => ymOf(d) === ym)
          .map((d) => {
            const m = marks.get(d);
            return { date: d, resting: m ? m.off.length + m.requested.length : 0 };
          }),
      ),
    [days, ym, marks],
  );
  /** 今月の準備（PRD D59。進み具合の帯に出す。D151）。日の状態は上で compile・採点したものを使う（要対応の欄と同じ数え方） */
  const progress = useMemo(() => monthProgress(data, ym, today, (d) => statuses.get(d)), [data, ym, today, statuses]);
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

  /** その月の今日以降の訪問 */
  const running = batch !== null;
  const noVisitsWhy = progress.visits === 0 ? '繰り返しが無いか、この月の今日以降の訪問がありません' : null;

  /** 進み具合の帯（PRD D151〜D155）：今月の準備と同じ数え方。週・日の画面の帯と同じもの */
  const band = useMemo(
    (): BandModel => ({
      ym,
      progress,
      emptyTargets: batchTargets(data, days, today, 'care', (d) => {
        const s = statuses.get(d);
        return s && s.unassigned > 0 ? s : undefined;
      }).length,
      urgent: urgentCount(attention),
    }),
    [ym, progress, data, days, today, statuses, attention],
  );

  /** 担当を組むの画面へ（その月。ADR-0063） */
  const openArrange = () => navigate(bandHref(ym, 'batch'));
  /** 帯の数字・ボタン：担当を組むは担当を組むの画面へ、ほかはこの画面の中で欄を開く（URL の ?staff= などは showAside のとおり） */
  const onBandOp = (op: BandOp) => {
    if (op === 'batch') openArrange();
    else showAside(op);
  };

  // ---- ホーム・週・日の帯から来たときの操作（PRD D143・D153。?do=）----
  // batch（古いリンク）：担当を組むの画面へ移す。attention・unconfirmed：右の欄の要対応・確定していない日へ。
  // 1回だけ行い、URL から ?do= を消す（戻る・再読込で繰り返さない）
  const doParam = params.get('do');
  // biome-ignore lint/correctness/useExhaustiveDependencies: ?do= が付いたときだけ
  useEffect(() => {
    if (doParam === null) return;
    if (doParam === 'attention' || doParam === 'unconfirmed') {
      showAside(doParam, { do: null });
      return;
    }
    if (doParam === 'batch') {
      navigate(bandHref(ym, 'batch'), { replace: true });
      return;
    }
    patchParams({ do: null });
  }, [doParam]);

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
    if (runningNow() || bulk.targets.length === 0) return;
    const targets = bulk.targets;
    const ok = await confirmDialog({
      ...bulkConfirmDialog(bulk, terms.staff),
      confirmLabel: `${targets.length}日を確定する`,
    });
    if (!ok || runningNow()) return;
    const ready = targets.flatMap((date) => {
      const p = perDay.get(date)?.problem;
      return p ? [{ date, p }] : [];
    });
    if (ready.length === 0) return;
    const at = Date.now();
    update((d) => ready.reduce((out, x) => confirmDay(out, x.date, x.p, at), d), `${ready.length}日をまとめて確定`);
    toast(`${ready.length}日を確定しました`);
    // 押したボタンは0日になって押せなくなるので、フォーカスは右の欄へ（確定していない日の一覧の先頭から読める）
    requestAnimationFrame(() => asideRef.current?.focus({ preventScroll: true }));
  };

  const stop = () => monthBatch.stop();

  /** 月を選ぶ欄の月（データの日付の月。PRD D347） */
  const monthOptions = useMemo(
    () => [...new Set([...dataDates.map(ymOf), ym])].sort().map((v) => ({ value: v, text: ymText(v) })),
    [dataDates, ym],
  );
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
  // ---- 月のカレンダーで選ぶ・キー・ドラッグ（PRD D340・D341。ADR-0056）----
  /** 選んだ訪問（Shift／Ctrl＋クリック・Shift／Ctrl＋Enter でマスの日の訪問をまとめて、一覧の行は1件ずつ。月を送ったら外す） */
  const multi = useVisitSelection(ym);
  /** その日の回の一覧（マスで Enter。右の欄の先頭。null は閉じている） */
  const [listDay, setListDay] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 月を送ったら、その月でない日の一覧は閉じる
  useEffect(() => {
    if (listDay && ymOf(listDay) !== ym) setListDay(null);
  }, [ym]);
  /** スマホ（600px 以下）の下から出る欄に出している日（PRD D343。null は閉じている） */
  const [sheetDay, setSheetDay] = useState<string | null>(null);
  /** 下から出る欄の選ぶ形（長押しか「選ぶ」。PRD D334・D340） */
  const [selecting, setSelecting] = useState(false);
  useEffect(() => {
    if (!sheetDay) setSelecting(false);
  }, [sheetDay]);
  // 広い画面へ戻したら下から出る欄は閉じる（狭い画面へ戻しても勝手に開き直さない）
  useEffect(() => {
    if (!narrowList) setSheetDay(null);
  }, [narrowList]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 月を送ったら、下から出る欄も閉じる
  useEffect(() => {
    setSheetDay(null);
  }, [ym]);
  const openVisit = useOpenVisit();
  const lookOf = useVisitLooks(days);
  /** マスのボタンへフォーカス（月を送ったときは描き終わるまで待つ） */
  const focusCell = (d: string) => {
    let n = 0;
    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-testid="month-day"][data-date="${d}"]`);
      if (el) el.focus();
      else if (++n < 30) requestAnimationFrame(tick);
    };
    tick();
  };
  /** その日の回（表示の選択が〈スタッフ〉・〈利用者さん〉ならその人の回だけ。開始の順） */
  const dayItems = useCallback(
    (d: string): readonly Visit[] => {
      const list = (visitsByDate.get(d) ?? visitsOn(data, d)).filter((v) =>
        focus.kind === 'staff' ? v.staffId === focus.id : focus.kind === 'client' ? v.clientId === focus.id : true,
      );
      const at = (v: Visit) => hhmmToMinutes(v.start ?? v.earliestStart);
      return [...list].sort((a, b) => at(a) - at(b) || a.id.localeCompare(b.id));
    },
    [visitsByDate, data, focus],
  );
  /** その日の選べる回（今日より前・取り消し・休みは選ばない） */
  const selectableOf = useCallback(
    (d: string) =>
      dayItems(d)
        .filter((v) => canSelectVisit(v, isOnLeave(data.clientLeaves, v), today))
        .map((v) => v.id),
    [dayItems, data.clientLeaves, today],
  );
  const openPanel = (visitId: string) =>
    openVisit({
      visitId,
      returnFocus: (vid) => (vid ? visitItemOf(vid) : null),
    });
  /** その日の回の一覧を開く（〈利用者さん〉を選んでいてその日の回が1つなら、その回の欄。スマホは下から出る欄。PRD D340・D343） */
  const openList = (d: string) => {
    if (narrowList) {
      setSheetDay(d);
      return;
    }
    const items = dayItems(d);
    if (focus.kind === 'client' && items.length === 1) {
      openVisit({ visitId: items[0]!.id, returnFocus: () => focusCellEl(d) });
      return;
    }
    setListDay(d);
    requestAnimationFrame(() =>
      (
        document.querySelector<HTMLElement>('[data-testid="month-day-visits"] [data-visit-item]') ??
        document.querySelector<HTMLElement>('[data-testid="month-day-visits"] h2')
      )?.focus(),
    );
  };
  /** その日のマス（カレンダー）か行（日ごとの一覧） */
  const focusCellEl = (d: string) =>
    document.querySelector<HTMLElement>(
      `[data-testid="month-day"][data-date="${d}"], [data-testid="month-list-day"][data-date="${d}"]`,
    );
  /**
   * マス・日ごとの一覧の行を押す（PRD D343）：1回目はその日の訪問を右の欄（スマホは下から出る欄）に出し、右の欄に出している日を
   * もう一度押すと日の予定。フォーカスはマスのまま（Enter はその日の一覧へフォーカスを移す）
   */
  const pickRef = useRef<(d: string) => void>(() => {});
  pickRef.current = (d) => {
    if (narrowList) setSheetDay(d);
    else if (listDay === d) openDay(d);
    else setListDay(d);
  };
  const pickDay = useCallback((d: string) => pickRef.current(d), []);
  /** マスのキー（←→ 日・↑↓ 週・Enter でその日の回の一覧・Shift／Ctrl＋Enter でその日をまとめて選ぶ）。休みを入れる間は Enter は今どおり */
  const cellKeyRef = useRef<(e: ReactKeyboardEvent, d: string) => void>(() => {});
  cellKeyRef.current = (e, d) => {
    const k = cellKeyOf(e);
    if (!k) return;
    if (k.kind === 'go') {
      e.preventDefault();
      const t = addDays(d, k.days);
      if (ymOf(t) !== ym) goMonth(ymOf(t));
      focusCell(t);
      return;
    }
    if (offMode) return;
    e.preventDefault();
    if (k.kind === 'open') openList(d);
    else multi.toggleMany(selectableOf(d));
  };
  const onCellKey = useCallback((e: ReactKeyboardEvent, d: string) => cellKeyRef.current(e, d), []);
  // マス（DayCell は memo）へ渡す関数は ref を通して変えない（データが変わるたびに全部のマスを描き直さない）
  const cellMultiRef = useRef<(d: string) => void>(() => {});
  cellMultiRef.current = (d) => multi.toggleMany(selectableOf(d));
  const onCellMulti = useCallback((d: string) => cellMultiRef.current(d), []);
  /** マスごとの選んだ件数 */
  const selectedByDate = useMemo(() => {
    const on = new Set(multi.ids);
    const out = new Map<string, number>();
    for (const d of days) {
      const n = (visitsByDate.get(d) ?? []).filter((v) => on.has(v.id)).length;
      if (n > 0) out.set(d, n);
    }
    return out;
  }, [days, visitsByDate, multi.ids]);
  /** 一覧の行のキー（↑↓ 15分・←→ 1日・Shift+←→ 隣の担当・Enter 欄・Delete 取り消し。PRD D333） */
  const visitKeys = useVisitKeys({
    staffOrder: () => activeStaff.map((s) => s.id),
    onOpen: openPanel,
    onMoved: (r) => {
      setListDay(r.date);
      if (ymOf(r.date) !== ym) goMonth(ymOf(r.date));
      focusVisitItem(r.visitId);
    },
    onCancelled: () =>
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="undo-btn"]')?.focus()),
  });
  const itemProps = useVisitItem({ selection: multi, onOpen: openPanel, keys: visitKeys });
  /** 下から出る欄の行（押すと欄を閉じて訪問の詳細の欄・長押しか「選ぶ」で選ぶ。キー・ドラッグは無い。ADR-0051 の決定5） */
  const sheetItemProps = useVisitItem({
    selection: multi,
    onOpen: (id) => {
      const d = sheetDay;
      setSheetDay(null);
      openVisit({ visitId: id, returnFocus: () => (d ? focusCellEl(d) : null) });
    },
    selecting,
    longPress: { onSelecting: setSelecting },
  });
  /** その日の回の一覧の行（右の欄・下から出る欄で同じ） */
  const rowOf = (v: Visit): VisitRowData => {
    const s = v.staffId ? staffById.get(v.staffId) : undefined;
    const t = typeById.get(v.typeId ?? '');
    const leave = isOnLeave(data.clientLeaves, v);
    const at = hhmmToMinutes(v.start ?? v.earliestStart);
    return {
      visitId: v.id,
      time: `${hm(at).replace(/^0/, '')}〜${hm(at + v.durationMinutes).replace(/^0/, '')}`,
      title: data.clients.find((c) => c.id === v.clientId)?.displayName ?? '（不明）',
      staff: v.cancelled ? null : (s ?? null),
      staffName: v.cancelled || !v.staffId ? '' : (s?.name ?? '（不明）'),
      state: v.cancelled
        ? v.cancelKind === 'sameDay'
          ? '当日キャンセル'
          : '取り消し'
        : leave
          ? '休みのため無し'
          : null,
      look: lookOf(v.id),
      color: t ? colorOf(t.color) : null,
    };
  };
  /** 一覧の行をマスへドラッグ（その日へ。時刻はそのまま。落とすと落とした日を入れた訪問の詳細の欄。PRD D341） */
  const drag = useVisitDrag({
    today,
    fit: true,
    onDrop: (visitId, v) => {
      const x = findVisit(dataRef.current, visitId);
      const width = x ? hhmmToMinutes(x.latestStart) - hhmmToMinutes(x.earliestStart) : 0;
      openVisit({
        visitId,
        draft: { date: v.date, earliestStart: minutesToHhmm(v.start), latestStart: minutesToHhmm(v.start + width) },
        returnFocus: (vid) => (vid ? visitItemOf(vid) : null),
      });
    },
  });
  const gridDrop = drag.target('month', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-testid="month-day"]');
    return el?.dataset.date ? { date: el.dataset.date, start: null } : null;
  });
  const dropDate = drag.hover?.key === 'month' ? drag.hover.target.date : null;

  /** 要対応の1行の行き先へ移る（PRD D201。行き先は lib/links の attentionTarget。日付も選んでおく） */
  const openTarget = (t: LinkTarget) => {
    lastDate.current = t.date;
    setDate(t.date);
    navigate(t.to);
  };

  /** いま作っている日（表示している月の日だけ印を付ける。2か月にまたがる作成では2か月目の日も） */
  const making = batch ? batch.targets[batch.index] : undefined;
  const current = making && ymOf(making) === ym ? making : undefined;
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
      out.push({
        row: monthListRow(s, today, extra, { attention: attentionByDate.get(d) ?? 0 }),
        extra,
        off,
      });
    }
    return out;
  }, [layout, days, statuses, staffDays, clientDays, focus.kind, staffById, offStaffId, data, today, attentionByDate]);
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

  // 「その他 ▾」（PRD D278）：月送り・今月と主ボタン（進み具合の帯）のほかの、ときどき使う操作をたたむ
  /** 表示の選択（〈スタッフ〉・〈利用者さん〉・混み具合）を選んでいる間・休みの入力中は、たたまずに出す（何を見ているかを隠さない） */
  const pickersForced = focus.kind !== 'all' || clientMode || loadType !== null || offMode;
  const pickersShown = pickersOpen || pickersForced;
  const moreItems: MoreItem[] = [
    {
      key: 'pickers',
      label: pickersShown ? '表示の選択をたたむ' : `表示を選ぶ（${terms.staff}・${terms.client}・混み具合）`,
      icon: SlidersHorizontal,
      disabled: pickersShown && pickersForced ? '表示を「全体」・混み具合を「すべて」に戻すと、たためます' : false,
      onSelect: () => {
        focusPickers.current = !pickersShown;
        setPickersOpen(!pickersShown);
      },
      testId: 'month-more-pickers',
    },
    ...(printOn
      ? [
          {
            key: 'print',
            label: '印刷',
            icon: Printer,
            description: '紙のカレンダーの代わりに、この月の予定をA4横で印刷します',
            onSelect: () =>
              navigate(
                `/month/print?ym=${ym}${focus.kind === 'staff' ? `&staff=${encodeURIComponent(focus.id)}` : ''}`,
              ),
            testId: 'month-print',
          },
        ]
      : []),
    ...(workloadOn
      ? [
          {
            key: 'workload',
            label: '勤務の見込み',
            icon: Timer,
            description: '予定から、この月の出勤〜退勤（拘束）・移動・空き時間（待ち）と交通費を見込みます',
            onSelect: () => navigate(`/workload?ym=${ym}`),
            testId: 'month-workload',
          },
        ]
      : []),
    {
      key: 'help',
      label: helpOpen ? 'マスの見方の説明を閉じる' : 'マスの見方の説明',
      icon: Info,
      onSelect: () => setHelpOpen(!helpOpen),
      testId: 'month-more-help',
    },
  ];

  return (
    <div className="stack">
      <PageHeader
        icon={CalendarRange}
        title="月の予定"
        lead="一月の担当を見て、担当なしの日を AI でまとめて組み、確定します"
      />
      {/* 上のナビの行（日・週・月で同じ。PRD D347。ADR-0060）。月送り・今日・［月｜週｜日］。主ボタンは進み具合の帯（D154） */}
      <ScheduleNav
        current="month"
        today={{ onClick: () => goMonth(ymOf(today)), disabled: ym === ymOf(today) }}
        prev={{ label: '前の月', onClick: () => goMonth(addMonths(ym, -1)) }}
        next={{ label: '次の月', onClick: () => goMonth(addMonths(ym, 1)) }}
        picker={{ label: '月を選ぶ', value: ym, options: monthOptions, onChange: goMonth, testId: 'month-title' }}
      />

      {/* 進み具合の帯（PRD D151〜D155）。「まとめて作る」の入口はここの1か所（D154。見出しのボタン・今月の準備の①〜③をまとめた） */}
      <ProgressBand ym={ym} model={band} primary onOp={onBandOp} />
      {/* 操作の行（日・週・月で同じ並び。PRD D327）。月送り・今月のほかのときどき使う操作は「その他 ▾」（PRD D278） */}
      <ScheduleToolbar zoom="month" absence={suddenOn ? { date } : null} moreItems={moreItems}>
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
                <span className="tb-label">{label}</span>
              </WithIcon>
            </button>
          ))}
        </fieldset>
      </ScheduleToolbar>
      {/* 担当を組むの画面で組んだ範囲の提案（日・週・月で同じ帯。PRD D328） */}
      <RangeProposalBand />

      <div className="card stack month-head">
        <div className="row month-nav">
          <span className="month-summary sub" data-testid="month-summary">
            月全体：担当なし {summary.unassigned}件{summary.sameDay > 0 ? `・当日キャンセル ${summary.sameDay}件` : ''}
          </span>
        </div>
        {pickersShown && (
          <div className="row month-pickers" data-testid="month-pickers">
            <label className="month-picker">
              <span>表示</span>
              <select
                ref={focusSelectRef}
                value={focusValue}
                onChange={(e) => pickFocus(e.target.value)}
                data-testid="month-focus"
              >
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
                  onChange={(e) => {
                    setPickersOpen(true);
                    setLoadType(e.target.value === '' ? null : e.target.value);
                  }}
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
        )}
        {noVisitsWhy && <p className="sub">{noVisitsWhy}</p>}
        {helpOpen && (
          <div ref={helpRef} className="hint-body month-help" tabIndex={-1} data-testid="month-help">
            <ul className="plan-help-list">
              <li>
                日のマスを押すと、その日の訪問を右の欄（スマホは下から出る欄）に出します。もう一度押すと、その日の「日の予定」を開きます。マスの色と印は日の状態です（下の凡例）。
              </li>
              <li>
                右の欄の訪問の行は、押すと訪問の詳細、Shift・Ctrl＋クリックで選べます。行を別の日のマスへドラッグするか、選んで「別の日へ」を押すと日付を移せます（時刻はそのまま）。
              </li>
              <li>
                赤い枠や「要対応
                N」の札の日は、担当なし・担当が休み・条件に合わない・時間に間に合わない訪問がある日です。N
                は右の「要対応」の欄の行の数です。
              </li>
              <li>
                「未連絡
                N」は、確定（伝えた）あとに担当・時刻が変わった訪問の件数です。日の予定の連絡の一覧で確かめます。
              </li>
              <li>
                混み具合のバーは、{barRangeText()} を3段（
                {BAR_ROWS.map(([a, b]) => `${a}〜${b}時`).join('・')}）に分け、30分ごとに空いている{terms.staff}
                の人数で色を付けます。
              </li>
              <li>
                {edgeLabel('early')}・{edgeLabel('late')}
                に働く人がいる日は、段の端に「◀」「▶」が付きます。マウスを乗せると時刻が出ます。
              </li>
            </ul>
            <div>
              <button type="button" className="btn btn-small btn-text" onClick={() => setHelpOpen(false)}>
                説明を閉じる
              </button>
            </div>
          </div>
        )}
        {offStaffId !== null && (
          <div className="month-off-bar" data-testid="month-off-bar">
            <p>
              <strong>
                <WithIcon icon={CalendarOff} size={14}>
                  {focusName}さんの休みを入れる
                </WithIcon>
              </strong>
              ：勤務日のマスを押すと、その日を終日の{REQUESTED_OFF_NOTE}
              にします。もう一度押すと外します。
              <span className="sub">
                この月の{REQUESTED_OFF_NOTE}：{offDates.length}
                日。勤務の無い日・今日より前の日・ほかの欠勤のある日は押せません。
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
              aria-label="担当を組む進み具合"
              style={{ width: '100%' }}
            />
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span className="sub" aria-live="polite">
                {current ? '' : `${batch.label}：`}
                {current ? `${mdText(current)}：` : ''}
                {batch.index + 1}/{batch.targets.length}日（組めた日 {batch.made}日）
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
                        r.isToday ? 'is-today' : '',
                        r.date === date ? 'is-picked' : '',
                        listDay === r.date || sheetDay === r.date ? 'is-listed' : '',
                        off ? `is-off-${off}` : '',
                      ].join(' ')}
                      aria-label={`${r.label}${current === r.date ? '・作っています' : ''}`}
                      aria-pressed={off ? off === 'requested' : undefined}
                      aria-disabled={off !== undefined && !offPress ? true : undefined}
                      onClick={() => {
                        // カレンダーのマスと同じ動き：ふだんはその日の訪問（右の欄・スマホは下から出る欄。もう一度で日の予定）、
                        // 「休みを入れる」のときは希望休の付け外し
                        if (!off) pickDay(r.date);
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
                        {r.state === 'told' && <Lock size={12} aria-hidden="true" />}
                        {r.state === 'changed' && <PencilLine size={12} aria-hidden="true" />}
                        {r.stateText}
                      </span>
                      <span className="month-list-count">{r.count > 0 ? `${r.count}件` : ''}</span>
                      <span className="month-list-flags">
                        {r.attention > 0 ? (
                          <span className="month-attn" data-testid="month-attn">
                            要対応 {r.attention}
                          </span>
                        ) : (
                          r.care && <span className="month-dot" aria-hidden="true" />
                        )}
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
              <table ref={gridRef} className="month-grid" data-testid="month-grid" {...gridDrop}>
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
                            attention={attentionByDate.get(d) ?? 0}
                            usualRest={usualRest[weekday(d)] ?? 0}
                            onOpen={pickDay}
                            onToggleOff={toggleOff}
                            onKey={onCellKey}
                            onMulti={onCellMulti}
                            selected={selectedByDate.get(d) ?? 0}
                            listed={listDay === d}
                            drop={dropDate === d ? (drag.hover ?? undefined) : undefined}
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
          {listDay && !narrowList && (
            <DayVisits
              date={listDay}
              visits={dayItems(listDay)}
              rowOf={rowOf}
              itemProps={(v) => {
                const leave = isOnLeave(data.clientLeaves, v);
                const movable = canSelectVisit(v, leave, today);
                return {
                  ...itemProps(v.id, { selectable: movable, movable, selected: multi.has(v.id) }),
                  ...drag.source(v.id, movable),
                };
              }}
              isSelected={multi.has}
              selected={multi.ids.length}
              onClearSelection={multi.clear}
              onOpenDay={() => openDay(listDay)}
              onClose={() => {
                const d = listDay;
                setListDay(null);
                focusCellEl(d)?.focus();
              }}
            />
          )}
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
                      一度も確定していない日のうち、守れない条件が無く、要対応に出ていない日を確定します。
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
                  今日以降で、要対応の訪問（担当なし・担当が休み・条件に合わない・時間に間に合わない）・未連絡の変更・出勤〜退勤（拘束）が上限を超える日はありません。
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
                          data-date={a.date}
                          data-kind={a.kind}
                        >
                          <span className="month-attention-date">
                            {mdText(a.date)}（{WEEKDAY_LABELS[weekday(a.date)]}）
                          </span>
                          <span>
                            {a.kind === 'care' && (
                              <WithIcon icon={CircleAlert} size={14}>
                                要対応 {a.count}件{a.names.length > 0 ? `（${a.names.join('・')}）` : ''}
                              </WithIcon>
                            )}
                            {a.kind === 'changed' && (
                              <WithIcon icon={PencilLine} size={14}>
                                未連絡の変更 {a.count}件
                              </WithIcon>
                            )}
                            {a.kind === 'overSpan' && (
                              <WithIcon icon={Timer} size={14}>
                                出勤〜退勤（拘束）が{data.org.spanLimitHours}時間を超える{' '}
                                {a.names.map(shortName).join('・')}
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
                <StaffMark staff={staffById.get(focus.id)} size="md" />
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
              <p className="sub">数えるのはその日の今の担当です。</p>
            </>
          )}
          {focus.kind === 'client' && focusClient && (
            <>
              <h2 className="month-aside-title">
                <ClientDot client={activeClients.find((c) => c.id === focus.id)} hidden />
                <span>
                  <PersonButton kind="client" id={focus.id} name={focusName} testId="month-aside-name" />・{monthNo}月
                </span>
              </h2>
              {/* 回・休み・集計は〈利用者さん〉の画面の予定（月）で見て直す（PRD D311。重ねて持たない） */}
              <p className="sub">マスの印は、この{terms.client}の訪問のある日です。</p>
              <Link
                className="btn btn-small"
                to={`/clients/${encodeURIComponent(focusClient.id)}?cal=month&d=${ym}-01`}
                data-testid="month-client-open"
              >
                <WithIcon icon={CalendarRange} size={14}>
                  {focusClient.displayName}の予定（{monthNo}月）を開く
                </WithIcon>
              </Link>
            </>
          )}
        </aside>
        {/* 選んだ訪問の帯と、キーで動かした先の読み上げ・繰り返しの回の範囲の帯（PRD D330・D333。日・週と同じ） */}
        {!(narrowList && sheetDay) && <SelectionBar ids={multi.ids} onClear={multi.clear} dates={days} moveDay />}
        <KeyMoveBand
          onMoved={(r) => {
            setListDay(r.date);
            if (ymOf(r.date) !== ym) goMonth(ymOf(r.date));
            focusVisitItem(r.visitId);
          }}
        />
      </div>

      {/* スマホの下から出る欄（PRD D343）：その日の訪問をリストの行で。見る・取り消す・担当替えまで（ADR-0051 の決定5） */}
      {narrowList && sheetDay && (
        <SidePanel
          icon={CalendarDays}
          title={`${longDate(sheetDay)}の訪問 ${dayItems(sheetDay).length}件`}
          sheet
          onClose={() => setSheetDay(null)}
          returnFocus={() => focusCellEl(sheetDay)}
          footer={
            <button type="button" className="btn" onClick={() => openDay(sheetDay)} data-testid="month-day-visits-plan">
              この日の日の予定を開く
            </button>
          }
        >
          <div className="stack month-day-sheet" data-testid="month-day-sheet" data-date={sheetDay}>
            {dayItems(sheetDay).length === 0 ? (
              <p className="sub">この日の訪問はありません。</p>
            ) : (
              <>
                <div className="row month-day-sheet-tools">
                  <SelectToggle selecting={selecting} onChange={setSelecting} testId="month-select" />
                  <span className="sub">長押しでも選べます</span>
                </div>
                <ul className="vrow-list month-day-rows">
                  {dayItems(sheetDay).map((v) => {
                    const ok = canSelectVisit(v, isOnLeave(data.clientLeaves, v), today);
                    const on = multi.has(v.id);
                    return (
                      <li key={v.id}>
                        <VisitRow
                          row={rowOf(v)}
                          selecting={selecting}
                          selected={on}
                          props={sheetItemProps(v.id, { selectable: ok, movable: false, selected: on })}
                          testId="month-visit"
                        />
                      </li>
                    );
                  })}
                </ul>
                <SelectionBar ids={multi.ids} onClear={multi.clear} dates={days} inline />
              </>
            )}
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
          色＝日の状態・赤い枠と「要対応 N」の札＝要対応・▶■＝始まる／終わる
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
              {st === 'told' && <Lock size={9} />}
              {st === 'changed' && <PencilLine size={9} />}
            </span>
            {/* 確定済み・未連絡の変更ありは説明つき（PRD D242） */}
            {st === 'told' ? (
              <Term k="confirmed">{STATE_TEXT[st]}</Term>
            ) : st === 'changed' ? (
              <Term k="confirmDiff">{STATE_TEXT[st]}</Term>
            ) : (
              STATE_TEXT[st]
            )}
          </span>
        ))}
        <span className="month-legend-item">
          <span className="month-swatch is-care" aria-hidden="true">
            <span className="month-dot" />
          </span>
          要対応（担当なし・担当が休み・条件に合わない・時間に間に合わない）
        </span>
        <span className="month-legend-item">
          <span className="month-attn" aria-hidden="true">
            要対応 N
          </span>
          要対応の件数（右の欄の行の数）
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
              時間帯は今の担当で出します
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
  /** 要対応の札「要対応 N」の N（0＝札なし。今日より前の日は出さない。PRD D295） */
  attention: number;
  /** 同じ月の同じ曜日の「ふだん」の休みの人数（「休 N」はこれより多い日だけ出す。PRD D295） */
  usualRest: number;
  onOpen: (date: string) => void;
  onToggleOff: (date: string) => void;
  /** マスのキー（←→↑↓・Enter・Shift／Ctrl＋Enter。PRD D340） */
  onKey: (e: ReactKeyboardEvent, date: string) => void;
  /** Shift／Ctrl＋クリックでその日の訪問をまとめて選ぶ・外す */
  onMulti: (date: string) => void;
  /** その日の選んだ訪問の件数（0＝無し） */
  selected: number;
  /** その日の回の一覧を開いている */
  listed: boolean;
  /** ドラッグの落とし先の影（この日の上にあるときだけ） */
  drop: DropHover | undefined;
};

/** 「休みを入れる」のときのマスの説明（読み上げ・title） */
const OFF_STATE_TEXT: Record<OffDayState, string> = {
  open: `押すと${REQUESTED_OFF_NOTE}にします`,
  requested: `${REQUESTED_OFF_NOTE}です。押すと外します`,
  noShift: '勤務の無い日です（押せません）',
  past: '今日より前の日です（押せません）',
  absent: 'ほかの欠勤が入っています。日の予定で直してください（押せません）',
};

/**
 * その日の回の一覧（月のマスで Enter。PRD D340）：右の欄の先頭に、その日の回を1行ずつ（共通の VisitRow）。
 * 行を押すと訪問の詳細の欄、Shift／Ctrl＋クリック・Enter で選ぶ、キーで動かす（日・週と同じ）、ドラッグでほかの日のマスへ。
 * Esc（選んでいれば先に選択を外す）・×でマスへ戻る
 */
function DayVisits({
  date,
  visits,
  rowOf,
  itemProps,
  isSelected,
  selected,
  onClearSelection,
  onOpenDay,
  onClose,
}: {
  date: string;
  visits: readonly Visit[];
  rowOf: (v: Visit) => VisitRowData;
  itemProps: (v: Visit) => Record<string, unknown>;
  isSelected: (id: string) => boolean;
  /** 選んでいる訪問の件数（Esc は先に選択を外す） */
  selected: number;
  onClearSelection: () => void;
  onOpenDay: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  return (
    <section
      className="month-day-visits"
      aria-labelledby={titleId}
      data-testid="month-day-visits"
      data-date={date}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        e.preventDefault();
        // 選んでいれば先に選択を外す（ほかの画面の Esc と同じ）。選んでいなければ一覧を閉じてマスへ
        if (selected > 0) onClearSelection();
        else onClose();
      }}
    >
      <div className="spread">
        <h2 id={titleId} className="month-aside-title" tabIndex={-1}>
          {longDate(date)}の訪問 {visits.length}件
        </h2>
        <button
          type="button"
          className="icon-btn"
          aria-label="その日の訪問の一覧を閉じる"
          onClick={onClose}
          data-testid="month-day-visits-close"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {visits.length === 0 ? (
        <p className="sub">この日の訪問はありません。</p>
      ) : (
        <ul className="vrow-list month-day-rows">
          {visits.map((v) => (
            <li key={v.id}>
              <VisitRow
                row={rowOf(v)}
                selecting={false}
                selected={isSelected(v.id)}
                props={itemProps(v)}
                testId="month-visit"
              />
            </li>
          ))}
        </ul>
      )}
      <p className="sub month-day-visits-help">
        行を押すと訪問の詳細。Shift・Ctrl＋クリックで選び、↑↓ で15分・←→
        で1日動かせます。行を別の日のマスへドラッグするか、選んで下の「別の日へ」で日付を移せます（時刻はそのまま）。
      </p>
      <button type="button" className="btn btn-small" onClick={onOpenDay} data-testid="month-day-visits-plan">
        この日の日の予定を開く
      </button>
    </section>
  );
}

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
  const past = d < today;
  // 赤は要対応だけ（PRD D228）
  const care = s.needsCare && !past;
  /** 要対応の札の N（要対応の一覧の行の数。今日より前の日は出さない） */
  const attn = past ? 0 : props.attention;
  /** 担当なしのほかの要対応の内訳（「担当が休み 1」など） */
  const otherIssues = issueBreakdown(s.issues).filter((x) => !x.startsWith('担当なし'));
  const typeName = (id: string | null) => (id === null ? '種類なし' : (typeById.get(id)?.name ?? '種類なし'));
  const parts: string[] = [longDate(d)];
  const body: ReactNode[] = [];

  if (s.count > 0) parts.push(`訪問 ${s.count}件`, STATE_TEXT[s.state]);
  else parts.push('訪問なし');
  if (attn > 0) parts.push(`要対応 ${attn}`);
  else if (care) parts.push('要対応');
  if (s.unassigned > 0) parts.push(`担当なし ${s.unassigned}件`);
  for (const x of otherIssues) parts.push(`${x}件`);
  if (s.changes > 0) parts.push(`未連絡の変更 ${s.changes}件`);
  if (s.overSpan.length > 0) parts.push(`出勤〜退勤（拘束）が上限を超える ${s.overSpan.length}人`);
  if (making) parts.push('組んでいます');

  const flags = (
    <>
      {s.unassigned > 0 && (
        <span className="month-flag is-red" data-testid="month-unassigned">
          <CircleAlert size={12} aria-hidden="true" />
          担当なし {s.unassigned}
        </span>
      )}
      {otherIssues.map((x) => (
        <span key={x} className="month-flag is-red" data-testid="month-issue">
          <CircleAlert size={12} aria-hidden="true" />
          {x}
        </span>
      ))}
      {s.changes > 0 && (
        <span
          className="month-flag is-warn"
          title="確定（伝えた）あとに担当・時刻が変わった訪問です。日の予定の連絡の一覧で確かめてください"
          data-testid="month-changed"
        >
          <PencilLine size={12} aria-hidden="true" />
          未連絡 {s.changes}
        </span>
      )}
      {s.overSpan.length > 0 && (
        <span
          className="month-flag is-warn"
          title={`出勤〜退勤（拘束）が上限を超える${staffTerm}：${s.overSpan
            .map((id) => staffById.get(id)?.name ?? '')
            .join('・')}`}
          data-testid="month-over-span"
        >
          <Timer size={12} aria-hidden="true" />
          拘束超 {s.overSpan.length}
        </span>
      )}
      {making && <span className="month-flag is-warn">組んでいます…</span>}
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
    // 見た目の「休 N」はふだんより多い日だけ（PRD D295）。読み上げ・吹き出しの文には人数を今までどおり残す
    const restShown = showRestMark({
      resting,
      requested: mk.requested.length,
      usual: props.usualRest,
    });
    if (resting > 0) parts.push(`休む${staffTerm} ${resting}人（${restDetail}）`);
    if (mk.absent.length > 0) parts.push(`欠勤 ${mk.absent.join('・')}`);
    if (mk.starts.length > 0) parts.push(`始まる ${mk.starts.join('・')}`);
    if (mk.ends.length > 0) parts.push(`終わる ${mk.ends.join('・')}`);
    if (mk.leaves.length > 0) parts.push(`${clientTerm}の休み ${mk.leaves.join('・')}`);
    if (mk.lastDays.length > 0) parts.push(`最終勤務日 ${mk.lastDays.join('・')}`);
    // 読み上げ：8〜20時のまとめ＋8時より前・20時以降の端の文（PRD D82。二重に読まない）
    if (load) parts.push(withEdges(loadSummary(inBar(load)), loadEdgeTexts(load)));
    else if (load === null) parts.push('混み具合は数えられません');
    body.push(
      <TypeStack key="types" types={mk.types} typeById={typeById} />,
      <span key="marks" className="month-marks">
        {restShown && (
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
          <span className="month-mark is-absent" title={`欠勤：${mk.absent.join('・')}`} data-testid="month-absent">
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
      <span key="bar" className="month-load is-staff">
        <StaffBar slots={x.bar} />
      </span>,
    );
  } else if (focus === 'client' && props.clientDay) {
    const x = props.clientDay;
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
            : '担当なし';
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
                      : '担当なし'}
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
    attention: attn,
    types: focus === 'all' && mk.types.length > 0,
    resting: restingAll,
    restShown: showRestMark({ resting: restingAll, requested: mk.requested.length, usual: props.usualRest }),
    requested: mk.requested.length,
    absent: mk.absent.length > 0,
    starts: mk.starts.length > 0,
    ends: mk.ends.length > 0,
    leaves: mk.leaves.length > 0,
    lastDays: mk.lastDays.length > 0,
    loadBar: focus !== 'all' ? null : load ? 'load' : load === null ? 'noPlan' : null,
    unassigned: s.unassigned > 0,
    issues: otherIssues.length > 0,
    changed: s.changes > 0,
    overSpan: s.overSpan.length > 0,
    substitute: cv.slice(0, 4).some((v) => v.substitute),
    edited: cv.slice(0, 4).some((v) => v.edited && !v.cancelled),
    staffTerm,
    clientTerm,
  });
  const offPress = offState === 'open' || offState === 'requested';
  const tipText = `${parts.slice(1).join('・')}${
    offState
      ? ''
      : props.listed
        ? '（もう一度押すとこの日の「日の予定」を開きます）'
        : '（押すとこの日の訪問を右の欄に出します。もう一度押すと「日の予定」）'
  }`;
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
        d === today ? 'is-today' : '',
        picked ? 'is-picked' : '',
        making ? 'is-making' : '',
        focus === 'staff' && props.staffDay && props.staffDay.slots.length === 0 ? 'is-rest' : '',
        offState ? `is-off-${offState}` : '',
        props.selected > 0 ? 'is-selected' : '',
        props.listed ? 'is-listed' : '',
        props.drop ? `is-drop-${dropTone(props.drop.verdict)}` : '',
      ].join(' ')}
    >
      <button
        type="button"
        className="month-cell-btn"
        data-testid="month-day"
        data-date={d}
        data-state={s.count > 0 ? s.state : 'empty'}
        data-off={offState}
        aria-label={`${label}${props.selected > 0 ? `・選択中 ${props.selected}件` : ''}`}
        aria-pressed={offState ? offState === 'requested' : undefined}
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Enter Shift+Enter"
        data-selected={props.selected > 0 ? props.selected : undefined}
        // 押せない日も Tab で届き、理由（aria-label）が読み上がるよう disabled にしない。押しても何もしない
        aria-disabled={offState !== undefined && !offPress ? true : undefined}
        // 見た目の説明は title ではなく読み方の吹き出し（MonthCellTip。title と二重に出さない）
        data-tip="cell"
        onClick={(e) => {
          // Shift／Ctrl＋クリックはその日の訪問をまとめて選ぶ（休みを入れる間は今どおり）
          if (!offState && isMultiClick(e)) {
            e.preventDefault();
            props.onMulti(d);
            return;
          }
          if (!offState) props.onOpen(d);
          else if (offPress) props.onToggleOff(d);
        }}
        onKeyDown={(e) => props.onKey(e, d)}
      >
        <span className="month-cell-head">
          <span className="month-day">
            {Number(d.slice(8, 10))}
            {d === today && <span className="month-today">今日</span>}
          </span>
          {s.count > 0 && s.state === 'told' && <Lock size={12} className="month-lock" aria-hidden="true" />}
          {/* 未連絡の変更あり（淡い黄）は色だけで分けない */}
          {s.count > 0 && s.state === 'changed' && (
            <PencilLine size={12} className="month-diff-icon" aria-hidden="true" data-testid="month-diff-mark" />
          )}
          {attn > 0 ? (
            <span className="month-attn" data-testid="month-attn">
              要対応 {attn}
            </span>
          ) : (
            care && <span className="month-dot" aria-hidden="true" />
          )}
          {s.count > 0 && focus === 'all' && <span className="month-count">{s.count}件</span>}
          {props.selected > 0 && (
            <span className="month-selected" data-testid="month-selected">
              選択 {props.selected}
            </span>
          )}
        </span>
        {body}
        {props.drop && (
          <span className={`vdrop is-${dropTone(props.drop.verdict)} month-drop`} data-testid="month-drop">
            <span className="vdrop-text">
              {dropShadowText(props.drop.verdict, { fit: props.drop.fit, time: false })}
            </span>
          </span>
        )}
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
