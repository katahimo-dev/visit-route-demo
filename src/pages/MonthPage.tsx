import {
  BedSingle,
  CalendarOff,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Layers,
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
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDay } from '../app/day';
import { ClientPicker } from '../components/ClientPicker';
import { ClientDots, PrepBar } from '../components/glance';
import { LoadBar, LoadLegend, LoadRowsSample, loadSummary, TypeStack } from '../components/loadBar';
import { PersonButton } from '../components/PersonPopover';
import { StaffBar, StaffLegend } from '../components/staffBar';
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
import { clientDot } from '../lib/glance';
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
  type MonthProgress,
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
import { mdText } from '../lib/patternText';
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
import { applyPreset, scorePresetOf } from '../seed';
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

const STATE_TEXT: Record<DayStatus['state'], string> = {
  none: '案なし',
  plan: '案あり',
  confirmed: '確定済み',
  diff: '未確定の変更あり',
};
const STATE_ORDER: DayStatus['state'][] = ['none', 'plan', 'confirmed', 'diff'];

/** 表示の選択：全体／〈スタッフ〉1人／〈利用者さん〉1人 */
type Focus = { kind: 'all' } | { kind: 'staff'; id: string } | { kind: 'client'; id: string };

const sameList = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export default function MonthPage() {
  const { date, setDate } = useDay();
  const { data, update, compileInput, scoreRulerName } = useDayModel(date);
  const terms = data.org.terms;
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const today = jstDate(Date.now());
  const raw = params.get('ym') ?? '';
  const ym = isYm(raw) ? raw : ymOf(date);
  const monthNo = Number(ym.slice(5, 7));

  const [panel, setPanel] = useState(false);
  /** 選ばないときの右の欄：要対応／確定していない日（「今月の準備」の③から） */
  const [asideView, setAsideView] = useState<'attention' | 'unconfirmed'>('attention');
  const asideRef = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<'empty' | 'all'>('empty');
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
  const offStaffId = offMode && focus.kind === 'staff' ? focus.id : null;
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
              ? `${mdText(d)} を${REQUESTED_OFF_NOTE}にしました。${name}さんにこの日の訪問が ${n}件あります。日の画面の「急な欠勤」から振り直してください（自動では振り直しません）`
              : `${mdText(d)} を${REQUESTED_OFF_NOTE}にしました`,
        });
      } else {
        setOffNote({ date: d, warn: false, text: `${mdText(d)} の${REQUESTED_OFF_NOTE}を外しました` });
      }
    },
    [offStaffId, today, update, staffById],
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

  /** 今月の準備（PRD D59）。日の状態は上で compile・採点したものを使う（要対応の欄と同じ数え方） */
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
      asideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      asideRef.current?.focus({ preventScroll: true });
    });
  };

  const summary = useMemo(() => {
    let visits = 0;
    let withVisits = 0;
    let withPlan = 0;
    let unassigned = 0;
    let stale = 0;
    for (const d of days) {
      const s = statuses.get(d);
      if (!s) continue;
      visits += s.count;
      if (s.count > 0) withVisits++;
      if (s.count > 0 && s.state !== 'none') withPlan++;
      unassigned += s.unassigned;
      if (s.stale) stale++;
    }
    // 当日キャンセル（ADR-0015）の回数
    let sameDay = 0;
    for (const d of days)
      for (const v of visitsByDate.get(d) ?? []) if (v.cancelled && v.cancelKind === 'sameDay') sameDay++;
    return { visits, withVisits, withPlan, unassigned, stale, sameDay };
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
  const panelTargets = panel ? targetsOf(mode) : [];
  const staleTargets = batchTargets(data, ym, today, 'stale', staleOf);
  const running = batch !== null;
  const noVisitsWhy = futureVisits === 0 ? '定期パターンが無いか、この月の訪問がありません' : null;

  // ---- ホームから来たときの操作（PRD D143。?do=）----
  // batch：まとめて作るの欄を開く（見出しのボタンと同じ）。attention・unconfirmed：右の欄の要対応・確定していない日へ。
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
    if (doParam === 'batch' && !noVisitsWhy && !runningRef.current) {
      setError(null);
      setMode('empty');
      setPanel(true);
    }
  }, [doParam]);

  // ---- 定期パターンから訪問だけ作る（①だけ）----
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

  // ---- 月まとめ作成（③）----
  /** 対象の日を1日ずつ作る。expand は先に定期パターンから訪問を作るか（①） */
  const start = (m: BatchMode, expand: boolean) => {
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
      if (edited > 0 && !confirm(`手直しのある ${edited}日の手直しを捨てます。よろしいですか？`)) return;
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
      const preset = scorePresetOf(latest.presets, latest.scorePresetId);
      const rules = preset ? applyPreset(latest.rules, preset) : latest.rules;
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

  const current = batch ? batch.targets[batch.index] : undefined;
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
        title="月間"
        lead="定期パターンから訪問を作り、一月分の案をまとめて作ります"
        actions={
          <button
            type="button"
            className="btn btn-primary"
            disabled={running || !!noVisitsWhy}
            title={noVisitsWhy ?? ''}
            onClick={() => {
              setError(null);
              setMode('empty');
              setPanel(true);
            }}
          >
            <WithIcon icon={Sparkles}>{monthNo}月の案をまとめて作る</WithIcon>
          </button>
        }
      />

      <MonthPrep
        title={ym === ymOf(today) ? '今月の準備' : `${monthNo}月の準備`}
        progress={progress}
        canExpand={preview.added}
        running={running}
        noVisitsWhy={noVisitsWhy}
        noPatterns={data.patterns.length === 0}
        onExpand={expandOnly}
        onBatch={() => {
          setError(null);
          setMode('empty');
          setPanel(true);
        }}
        onUnconfirmed={() => showAside('unconfirmed')}
        onAttention={() => showAside('attention')}
      />

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
          <button
            type="button"
            className="btn btn-small"
            onClick={() =>
              navigate(`/month/print?ym=${ym}${focus.kind === 'staff' ? `&staff=${encodeURIComponent(focus.id)}` : ''}`)
            }
            title="紙のカレンダーの代わりに、この月の予定をA4横で印刷します"
            data-testid="month-print"
          >
            <WithIcon icon={Printer} size={14}>
              印刷
            </WithIcon>
          </button>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => navigate(`/workload?ym=${ym}`)}
            title="予定から、この月の拘束・移動・待ちの時間と交通費を見込みます"
            data-testid="month-workload"
          >
            <WithIcon icon={Timer} size={14}>
              稼働の見込み
            </WithIcon>
          </button>
          <span className="month-summary sub" data-testid="month-summary">
            訪問 {summary.visits}件・案のある日 {summary.withPlan}/{summary.withVisits}日・入らない {summary.unassigned}
            件{summary.sameDay > 0 ? `・当日キャンセル ${summary.sameDay}件` : ''}
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
          {focus.kind === 'staff' && (
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
            <label className="month-picker">
              <span>混み具合で数える人</span>
              <select
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
            </label>
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
            日のマスを押すと、その日の予定の画面を開きます。マスの色と印は日の状態です（下の凡例）。赤い枠と赤い点の日（「要確認」）は、訪問があるのに案が無い・入らない訪問がある・必須の違反がある日です（必須の違反は点数の基準のプリセット「
            {scoreRulerName}」の条件で見ます）。「条件が変わった」は、案を作ったあとに訪問・{terms.staff}
            ・稼働時間・条件が変わった日です。混み具合のバーは {barRangeText()} を3段（
            {BAR_ROWS.map(([a, b]) => `${a}〜${b}時`).join('・')}）・30分ずつに分け、その30分に空いている
            {terms.staff}
            の人数で色を付けます（数えるのは確定した割当、無ければ今の案）。{edgeLabel('early')}・{edgeLabel('late')}
            に働く人がいる日は、段の端に「◀」「▶」の印を出します（マウスを乗せると時刻）。
          </Hint>
          {noVisitsWhy && <span className="sub">{noVisitsWhy}</span>}
        </div>
        {offMode && focus.kind === 'staff' && (
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
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="month-body">
        <div className="card month-card">
          <table className="month-grid" data-testid="month-grid">
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
                        title="押すとその日の予定の画面を開きます"
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
                要対応
              </h2>
              {attention.length === 0 ? (
                <p className="sub">
                  今日以降で、入らない訪問・休みの人に残る訪問・条件が変わった日・拘束が上限を超える日・欠勤のある日はありません。
                </p>
              ) : (
                <ul className="month-attention" data-testid="month-attention">
                  {attention.map((a) => (
                    <li key={`${a.date}-${a.kind}`}>
                      <button
                        type="button"
                        className={`month-attention-btn is-${a.kind}`}
                        onClick={() => openDay(a.date)}
                        title="押すとその日の予定の画面を開きます"
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
                              拘束が{data.org.spanLimitHours}時間を超える {a.names.map(shortName).join('・')}
                            </WithIcon>
                          )}
                          {a.kind === 'absence' && (
                            <WithIcon icon={UserX} size={14}>
                              欠勤 {a.names.map(shortName).join('・') || `${a.count}人`}
                            </WithIcon>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
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
                onClick={() => start(mode, true)}
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
              使うプリセット：<strong data-testid="batch-preset">{basePreset?.name ?? 'いまの条件'}</strong>
              <span className="sub">（点数の基準。物差し：{scoreRulerName}）</span>
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
            <p className="sub">先に定期パターンからこの月の訪問を作ります。今日より前の日・確定した日は作りません。</p>
            <p className="sub">
              1日ずつ作り、作れた日はすぐに保存します。「止める」で、作っている日はそれまでの最良の案で残し、残りの日はやめます。画面を離れても止まります（作れた日は残ります）。
            </p>
          </div>
        </SidePanel>
      )}
    </div>
  );
}

/**
 * 月の見出しの凡例：日の状態（背景・枠と印）と、3段バーの色と目盛り（見出しに1回）。
 * bar：全体は混み具合（load）、〈スタッフ〉を選んだときはその人の時間帯の状態（staff。PRD D75）
 */
function MonthLegend({ bar }: { bar: 'load' | 'staff' | null }) {
  return (
    <div className="month-legend" data-testid="month-legend">
      <span className="month-legend-group">
        {STATE_ORDER.map((st) => (
          <span key={st} className="month-legend-item">
            <span className={`month-swatch is-state-${st}`} aria-hidden="true">
              {st === 'confirmed' && <Lock size={9} />}
              {st === 'diff' && <PencilLine size={9} />}
            </span>
            {STATE_TEXT[st]}
          </span>
        ))}
        <span className="month-legend-item">
          <span className="month-swatch is-care" aria-hidden="true">
            <span className="month-dot" />
          </span>
          手当てが必要
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
  absent: 'ほかの欠勤が入っています。日の画面で直してください（押せません）',
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
  const past = d < today;
  const care = s.needsCare && !past;
  const typeName = (id: string | null) => (id === null ? '種類なし' : (typeById.get(id)?.name ?? '種類なし'));
  const parts: string[] = [longDate(d)];
  const body: ReactNode[] = [];

  if (s.count > 0) parts.push(`訪問 ${s.count}件`, STATE_TEXT[s.state]);
  else parts.push('訪問なし');
  if (care) parts.push('要確認');
  if (s.unassigned > 0) parts.push(`入らない ${s.unassigned}件`);
  if (s.hard > 0) parts.push(`必須の違反 ${s.hard}件`);
  if (s.absentLeft > 0) parts.push(`休みの人に訪問 ${s.absentLeft}件`);
  if (s.stale) parts.push('条件が変わった');
  if (s.overSpan.length > 0) parts.push(`拘束が上限を超える ${s.overSpan.length}人`);
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
      {s.absentLeft > 0 && (
        <span
          className="month-flag is-red"
          title="休み（欠勤・希望休）の人に訪問が残っています。日の画面で振り直してください"
          data-testid="month-absent-left"
        >
          <UserX size={12} aria-hidden="true" />
          休みの人に {s.absentLeft}
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
          title={`拘束（最初の訪問の開始〜最後の訪問の終わり）が上限を超える${staffTerm}：${s.overSpan
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
  const offPress = offState === 'open' || offState === 'requested';
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
        title={offState ? label : `${label}（押すとこの日の予定の画面を開きます）`}
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

/**
 * 今月の準備（PRD D59）：①訪問を作る ②案を作る ③確定 と要対応を横に並べる。済んだものに✓と「済」（色だけに頼らない）。
 * ①は作れる訪問があれば「定期パターンから訪問だけ作る」、②は足りなければまとめて作る欄、③は確定していない日の一覧、
 * 要対応は右の欄へ
 */
function MonthPrep({
  title,
  progress: p,
  canExpand,
  running,
  noVisitsWhy,
  noPatterns,
  onExpand,
  onBatch,
  onUnconfirmed,
  onAttention,
}: {
  title: string;
  progress: MonthProgress;
  /** 定期パターンから作れる訪問の件数 */
  canExpand: number;
  running: boolean;
  noVisitsWhy: string | null;
  noPatterns: boolean;
  onExpand: () => void;
  onBatch: () => void;
  onUnconfirmed: () => void;
  onAttention: () => void;
}) {
  const visitsDone = p.visits > 0 && canExpand === 0;
  const planDone = p.days > 0 && p.planned === p.days;
  const confirmDone = p.days > 0 && p.confirmed === p.days;
  const attentionDone = p.attention === 0;
  return (
    <section className="card month-prep" aria-label={title} data-testid="month-prep">
      <h2 className="month-prep-title">{title}</h2>
      <ol className="month-prep-steps">
        <PrepStep no="①" label="訪問を作る" value={`${p.visits}件`} done={visitsDone} testId="prep-visits">
          {!visitsDone && (
            <button
              type="button"
              className="btn btn-small"
              disabled={running || noPatterns || canExpand === 0}
              title={noPatterns ? '定期パターンがありません' : ''}
              onClick={onExpand}
            >
              <WithIcon icon={Repeat} size={14}>
                定期パターンから訪問だけ作る{canExpand > 0 ? `（${canExpand}件）` : ''}
              </WithIcon>
            </button>
          )}
        </PrepStep>
        <PrepStep no="②" label="案を作る" value={`${p.planned}/${p.days}日`} done={planDone} testId="prep-plans">
          {!planDone && (
            <button
              type="button"
              className="btn btn-small"
              disabled={running || !!noVisitsWhy}
              title={noVisitsWhy ?? ''}
              onClick={onBatch}
            >
              <WithIcon icon={Sparkles} size={14}>
                まとめて作る
              </WithIcon>
            </button>
          )}
        </PrepStep>
        <PrepStep no="③" label="確定" value={`${p.confirmed}/${p.days}日`} done={confirmDone} testId="prep-confirm">
          {!confirmDone && p.unconfirmed.length > 0 && (
            <button type="button" className="btn btn-small" onClick={onUnconfirmed}>
              <WithIcon icon={Lock} size={14}>
                確定していない日（{p.unconfirmed.length}日）
              </WithIcon>
            </button>
          )}
        </PrepStep>
        <PrepStep label="要対応" value={`${p.attention}件`} done={attentionDone} testId="prep-attention">
          {!attentionDone && (
            <button type="button" className="btn btn-small" onClick={onAttention}>
              <WithIcon icon={ListChecks} size={14}>
                要対応を見る
              </WithIcon>
            </button>
          )}
        </PrepStep>
      </ol>
      <PrepBar progress={p} />
    </section>
  );
}

function PrepStep({
  no,
  label,
  value,
  done,
  testId,
  children,
}: {
  no?: string;
  label: string;
  value: string;
  done: boolean;
  testId: string;
  children?: ReactNode;
}) {
  return (
    <li className={`month-prep-step${done ? ' is-done' : ''}`} data-testid={testId} data-done={done}>
      <span className="month-prep-head">
        {done && (
          <span className="month-prep-mark">
            <Check size={16} strokeWidth={3} aria-hidden="true" />
            <span className="sr-only">済</span>
          </span>
        )}
        {no && <span className="month-prep-no">{no}</span>}
        <strong>{label}</strong>
        <span className="month-prep-value">{value}</span>
      </span>
      {children}
    </li>
  );
}
