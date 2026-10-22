import {
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Lock,
  Mail,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDay } from '../app/day';
import { ClientFilter } from '../components/ClientFilter';
import { ClientPicker } from '../components/ClientPicker';
import { useConfirm } from '../components/ConfirmDialog';
import { ClientBarLegend, ClientDayBar } from '../components/clientBar';
import { EdgeScroll } from '../components/EdgeScroll';
import { EmptyNext } from '../components/EmptyNext';
import { LoadRowsSample } from '../components/loadBar';
import type { MenuItem } from '../components/MenuButton';
import { PersonButton } from '../components/PersonPopover';
import { PickChips, QualificationBadges } from '../components/PickChips';
import { StaffMark } from '../components/StaffMark';
import { RangeProposalBand, ScheduleToolbar, SelectionBar, useScopeItems } from '../components/scheduleParts';
import { StaffBar, StaffLegend } from '../components/staffBar';
import { useToast } from '../components/Toast';
import { Hint, PageHeader, WithIcon } from '../components/ui';
import { ViewSwitch } from '../components/ViewSwitch';
import { useOpenVisit } from '../components/VisitPanel';
import { focusVisitItem, KeyMoveBand, useVisitKeys, visitItemOf } from '../components/visitKeys';
import {
  DropShadow,
  SelectToggle,
  useVisitDrag,
  useVisitItem,
  useVisitLooks,
  useVisitSelection,
  type VisitDrag,
  VisitMarks,
} from '../components/visitParts';
import { TypeDot } from '../components/visitType';
import type { Visit } from '../contracts/documents';
import { timeText } from '../domain/availability';
import { addDays, hhmmToMinutes, jstDate, minutesToHhmm, weekday } from '../domain/time';
import { barEdgeNote, barRowsText, edgeLabel } from '../lib/barRows';
import {
  type ClientFilterState,
  decodeFilter,
  encodeFilter,
  filterClients,
  filterFacts,
  knownTypes,
  resolveStaffId,
  sameFilter,
  WEEK_TABLE_FILTER,
} from '../lib/clientFilter';
import { colorOf } from '../lib/colors';
import { dateText } from '../lib/common';
import { bulkConfirmDialog, bulkConfirmTargets, confirmDay } from '../lib/confirmDay';
import { periodEmptyGuide } from '../lib/emptyGuide';
import { isDate } from '../lib/isDate';
import { attentionList } from '../lib/month';
import { monthBatch } from '../lib/monthBatch';
import { staffLabels } from '../lib/monthPrint';
import { typeOf } from '../lib/patternText';
import { scrollLeftToShow } from '../lib/scrollEdge';
import {
  clientParamOf,
  handoffFromTable,
  TIMELINE_CLIENT_MAX,
  timelineChipIds,
  timelineSelection,
} from '../lib/timelineClients';
import { useDayModel } from '../lib/useDayModel';
import { useDayStatuses } from '../lib/useDayStatuses';
import { useFeature } from '../lib/useFeature';
import { COMPACT_QUERY, useMedia } from '../lib/useMedia';
import { useValueStore } from '../lib/valueStore';
import { staffWhyOf } from '../lib/visitDrop';
import type { VisitLook } from '../lib/visitLook';
import {
  allowedStaffOf,
  type Band,
  canMoveVisit,
  clientItemMark,
  clientWeekTable,
  DAY_END,
  DAY_START,
  insertIntoPlan,
  laneLayout,
  qualificationBadges,
  qualificationItem,
  SNAP_MINUTES,
  snapMinutes,
  staffWeekTable,
  staffWithQualification,
  type WeekDay,
  weekDates,
  weekDay,
} from '../lib/week';
import { weekDayCountText, weekNext } from '../lib/weekPrep';
import { isTimeline, WEEK_VIEWS, type WeekView, weekViewLabel, weekViewOf, weekViewParams } from '../lib/weekView';
import { findVisit, visitsOn } from '../patterns';
import { WeekMailPanel } from './mailPanels';
import './week.css';

/**
 * 週間（ADR-0012 追記の段階2。PRD D49〜D51・D56・D57。design.md §4 pages「週間（段階2）」「月間・週間の改定（2026-10-17）」）。
 * 時間軸（月〜日 × 07:00〜20:00。訪問の帯を種類の色で。ドラッグ・キーボードで日時を動かす）と〈スタッフ〉×曜日・〈利用者さん〉×曜日の表。
 * 表示は1つの切り替え（時間軸：〈スタッフ〉／時間軸：〈利用者さん〉／〈スタッフ〉×曜日／〈利用者さん〉×曜日。PRD D188。lib/weekView）。〈スタッフ〉はチップで複数選ぶ（?staff=s1,s2。無ければ全員）。
 * 時間軸の〈利用者さん〉は、この週に訪問がある人をチップ PickChips で並べて選ぶ（PRD D136〜D139。?by=client・?client=c1,c2。
 * 8人まで。?client= が無ければ先頭8人＝初期値で、初期値のあいだは URL に書かない）。この週に訪問の無い人は「ほかの人を探す」の
 * 検索欄 ClientPicker で選ぶ。〈利用者さん〉×曜日の表は選択と分け、この週に訪問がある人を全員出して
 * 絞り込みの欄 ClientFilter で減らす（PRD D108〜D112。?cf=）。表から時間軸へ移ったとき、?client= が無く表で絞り込んでいれば
 * その先頭8人を引き継ぐ（決まりは lib/timelineClients）。
 * データを書くのは「動かす」「空き時間に入れる」だけ（update の中で lib/week の純粋関数を呼ぶ）
 */

/** 時間軸の上限の文（呼び方は org.terms から作る） */
const timelineClientMaxText = (client: string) =>
  `時間軸は${TIMELINE_CLIENT_MAX}人まで。表（${client}×曜日）なら絞り込んだ全員を見られます`;

/** 表示の切り替えのボタンの data-testid（今までの e2e の名前を引き継ぐ：時間軸の見る人は by-*、表は tab-*） */
const VIEW_TEST_ID: Record<WeekView, string> = {
  'timeline-staff': 'by-staff',
  'timeline-client': 'by-client',
  table: 'tab-table',
  clients: 'tab-clients',
};

/** 1分あたりの高さ（px） */
const PX_PER_MIN = 0.8;
const HOURS = Array.from({ length: (DAY_END - DAY_START) / 60 + 1 }, (_, i) => DAY_START + i * 60);

const hm = (m: number) => timeText(minutesToHhmm(m));
/** 日の見出しの件数：休み（ADR-0013）のため無しの訪問を除く */
const liveCount = (day: WeekDay) => day.bands.filter((b) => !b.leave).length;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** URL の ?staff= ?client= ?cf= の値（無ければ null） */
const paramOf = (params: URLSearchParams, key: string): string | null =>
  params.has(key) ? (params.get(key) ?? '') : null;
/** 選んだ人（null＝全員、空なら []＝だれも選ばない） */
const selectionOf = (raw: string | null): string[] | null => (raw === null ? null : raw.split(',').filter(Boolean));

/** 動かす欄の中身 */
/** 動かしたあとの知らせ（新しい日に今の案があるとき） */
type Notice = { date: string; visitId: string; label: string; error: string | null };

/** 種類なしの帯の色（月の種類の積み上げと同じ） */
const NO_TYPE_COLOR = '#cfc4bb';

export default function WeekPage() {
  const { date, setDate } = useDay();
  const { data, update, compileInput, staff, staffById, clients, clientById, colorOfStaff } = useDayModel(date);
  const terms = data.org.terms;
  const toast = useToast();
  const confirmDialog = useConfirm();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const today = jstDate(Date.now());
  const rawD = params.get('d') ?? '';
  const anchor = isDate(rawD) ? rawD : date;
  const dates = useMemo(() => weekDates(anchor), [anchor]);
  const start = dates[0]!;
  /** 狭い画面（600px 以下）。?view=・?by= が無ければ〈スタッフ〉×曜日の表（PRD D222。URL には書かない） */
  const narrow = useMedia(COMPACT_QUERY);
  /** 表示（PRD D188。1つの切り替え。URL は今までの ?view=・?by= のまま。lib/weekView） */
  const view = weekViewOf(params.get('view'), params.get('by'), narrow);
  const tab: 'timeline' | 'table' | 'clients' = view === 'table' || view === 'clients' ? view : 'timeline';
  const by: 'staff' | 'client' = view === 'timeline-client' ? 'client' : 'staff';
  const staffParam = paramOf(params, 'staff');
  const clientParam = paramOf(params, 'client');
  const staffSel = useMemo(() => selectionOf(staffParam), [staffParam]);
  const clientSel = useMemo(() => selectionOf(clientParam), [clientParam]);
  /** 〈利用者さん〉×曜日の表の絞り込み（PRD D108。?cf=。無ければこの週に訪問がある人） */
  const cfParam = paramOf(params, 'cf');
  // URL に残った消えた種類の id は外す（今ある種類で絞る）
  const tableFilter = useMemo(
    () => knownTypes(decodeFilter(cfParam, WEEK_TABLE_FILTER), data.visitTypes),
    [cfParam, data.visitTypes],
  );
  /** 訪問の詳細の欄（PRD D301。帯を押す・落とすと開く。週の移動の欄はこの欄にした） */
  const openVisitPanel = useOpenVisit();
  const [notice, setNotice] = useState<Notice | null>(null);
  /** 欠勤・キャンセルの入口（ADR-0028 の sudden） */
  const suddenOn = useFeature('sudden');
  /** 複数選択（Shift・Ctrl＋クリック。週を送ったら外す。PRD D330） */
  const multi = useVisitSelection(start);
  /** スマホ（600px 以下）の選ぶ形（長押しか「選ぶ」。押すと選ぶ・外す。週を送ったら抜ける。PRD D340） */
  const [selecting, setSelecting] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 週を送ったら選ぶ形を抜ける
  useEffect(() => {
    setSelecting(false);
  }, [start]);
  /** 週の予定をメールで送る欄（PRD D93。ADR-0017） */
  const [mailOpen, setMailOpen] = useState(false);
  const mailOn = useFeature('mail');

  // ---- 選んでいる日付との同期（PRD D59）----
  // URL の ?d= で開いた日が選んでいる日付と違えば、選んでいる日付をその日にする
  // biome-ignore lint/correctness/useExhaustiveDependencies: URL の日が変わったときだけ
  useEffect(() => {
    if (isDate(rawD) && rawD !== date) setDate(rawD);
  }, [rawD]);
  // 上の日付の切り替えで選んでいる日付が変わったら、表示する週もその日を含む週にする
  const lastDate = useRef(date);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 選んでいる日付が変わったときだけ
  useEffect(() => {
    if (lastDate.current === date) return;
    lastDate.current = date;
    if (isDate(rawD) && rawD !== date) go({ d: date });
  }, [date]);

  /**
   * 狭い画面では、はじめに今日の列を見せる（PRD D222）：時間軸の枠・表の箱を、今日の列が止めた列（時刻・名前）の
   * すぐ右に来るまで横に巻く。表示と週ごとに1回だけ（あとは人が巻いた位置のまま）。今日を含まない週では巻かない
   */
  const timelineRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const clientScrollRef = useRef<HTMLDivElement>(null);
  const todayShown = useRef('');
  /** 縦に巻く今日の列の見出し（はじめの1回。巻いたら true） */
  const todayPaged = useRef<HTMLElement | true | null>(null);
  useLayoutEffect(() => {
    if (!narrow || !dates.includes(today)) {
      // 開いたときに今日の週でない・広い画面なら、あとで今日の週へ送っても縦には巻かない
      if (todayPaged.current === null) todayPaged.current = true;
      return;
    }
    const key = `${view}:${start}`;
    if (todayShown.current === key) return;
    const timeline = tab === 'timeline';
    const box = timeline ? timelineRef.current : tab === 'table' ? tableScrollRef.current : clientScrollRef.current;
    const target = box?.querySelector<HTMLElement>(timeline ? '.week-day-head.is-today' : 'thead th.is-today');
    if (!box || !target) return;
    todayShown.current = key;
    const sticky = box.querySelector<HTMLElement>(timeline ? '.week-gutter' : 'thead th');
    const left = box.getBoundingClientRect().left;
    const stickyRight = sticky ? sticky.getBoundingClientRect().right - left : 0;
    box.scrollLeft = scrollLeftToShow(box, target.getBoundingClientRect().left - left, stickyRight);
    if (!todayPaged.current) todayPaged.current = target;
  });
  /**
   * 開いて最初の1回だけ、今日の列の見出しが下のタブの裏・画面の下にあれば、上の帯のすぐ下まで縦に巻く（月の日ごとの一覧と同じ）。
   * 画面を移ったときの「上へ」（App の useEffect）のあとに巻くので、useEffect から次の描画で。表示を切り替えたときは巻かない。
   * 空の画面の案内（week-empty「この週には訪問がありません」）が出ているときは巻かない（案内と次の一手を先に見せる。ADR-0033）
   */
  useEffect(() => {
    const target = todayPaged.current;
    if (!target || target === true) return;
    todayPaged.current = true;
    if (document.querySelector('[data-testid="week-empty"]')) return;
    requestAnimationFrame(() => {
      const tabsH = document.querySelector('.bottom-tabs')?.getBoundingClientRect().height ?? 0;
      const headBottom = document.querySelector('.app-header')?.getBoundingClientRect().bottom ?? 0;
      const r = target.getBoundingClientRect();
      if (r.bottom > window.innerHeight - tabsH) window.scrollBy(0, r.top - Math.max(0, headBottom) - 8);
    });
  });

  const activeStaff = useMemo(() => staff.filter((s) => s.active), [staff]);
  const days: WeekDay[] = useMemo(() => dates.map((d) => weekDay(compileInput, d)), [compileInput, dates]);
  const dayOf = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  /** この週の訪問（計算した繰り返しの回も。版2。ADR-0053） */
  const visitById = useMemo(
    () => new Map(dates.flatMap((d) => visitsOn(data, d)).map((v) => [v.id, v])),
    [data, dates],
  );

  // ---- この週の準備（PRD D280・D282。ADR-0046・ADR-0053）：担当なしを組む → 確定 → 済み の主ボタン1つ ----
  /** 週の今日以降の日（組む・確定するのはこの日だけ。月をまたぐ週も1度に） */
  const futureDates = useMemo(() => dates.filter((d) => d >= today), [dates, today]);
  /** 日の状態（月の予定・ホームと同じ数え方。lib/useDayStatuses） */
  const weekStatuses = useDayStatuses(data, compileInput, futureDates);
  const weekPrep = useMemo(() => {
    const statusOf = (d: string) => weekStatuses.get(d)?.status;
    const list = futureDates.flatMap((d) => statusOf(d) ?? []);
    const unconfirmed = list.filter((x) => x.count > 0 && x.state !== 'told').map((x) => x.date);
    const bulk = bulkConfirmTargets(unconfirmed, statusOf, attentionList(data, list, today));
    const futureDays = list.filter((x) => x.count > 0).length;
    // 1行の状態（PRD D332）：今日以降の訪問のある日の確定の状態と要対応の数
    const told = list.filter((x) => x.count > 0 && x.state === 'told').length;
    const changed = list.filter((x) => x.count > 0 && x.state === 'changed').length;
    const notYet = list.filter((x) => x.count > 0 && x.state === 'none').length;
    const care = list.reduce((n, x) => n + x.care, 0);
    return { bulk, futureDays, line: { told, changed, notYet, care } };
  }, [weekStatuses, futureDates, data, today]);
  /** 担当を組む計算（月の予定と同じ入れ物。ADR-0042）：この週を組んでいるか、ほかを組んでいるか */
  const batchRun = useValueStore(monthBatch.run);
  const running = batchRun ? (batchRun.source === 'week' && batchRun.weekStart === start ? 'this' : 'other') : null;
  const next = weekNext({
    futureDays: weekPrep.futureDays,
    bulk: weekPrep.bulk,
    running,
  });
  /** 確定の確認のあいだに変わったデータを読む */
  const dataRef = useRef(data);
  dataRef.current = data;
  /** 主ボタンの場所（押したあとボタンが状態の文に替わったら、ここへフォーカスを戻す） */
  const nextRef = useRef<HTMLDivElement>(null);
  /** 押せない理由の文の id（主ボタンの aria-describedby） */
  const whyId = useId();
  /**
   * この週の問題の無い日をまとめて確定（PRD D280）：月の「問題の無い日をまとめて確定」（D223）と同じ決まり・同じ確認の型で、
   * 範囲をこの週の今日以降にする。1回の update で日ごとに「確定（伝えた）」と同じ書き方（lib/confirmDay）
   */
  const confirmWeek = async () => {
    const bulk = weekPrep.bulk;
    if (monthBatch.running() || bulk.targets.length === 0) return;
    const ok = await confirmDialog({
      ...bulkConfirmDialog(bulk, terms.staff),
      confirmLabel: `${bulk.targets.length}日を確定する`,
    });
    if (!ok || monthBatch.running()) return;
    const ready = bulk.targets.flatMap((d) => {
      const p = weekStatuses.get(d)?.problem;
      return p ? [{ date: d, p }] : [];
    });
    if (ready.length === 0) return;
    const at = Date.now();
    update((d) => ready.reduce((out, x) => confirmDay(out, x.date, x.p, at), d), `${ready.length}日をまとめて確定`);
    toast(`${ready.length}日を確定しました`);
    // 押したボタンは状態の文に替わるので、フォーカスは主ボタンの場所へ（body に落とさない）
    requestAnimationFrame(() => nextRef.current?.focus({ preventScroll: true }));
  };
  const table = useMemo(() => (tab === 'table' ? staffWeekTable(compileInput, days) : null), [tab, compileInput, days]);
  /** 〈スタッフ〉×曜日の表のマスの訪問（担当・日ごと。時刻の順。表で選ぶ・キーで動かす・ドラッグする。PRD D340） */
  const bandsOf = useMemo(() => {
    const out = new Map<string, Band[]>();
    if (tab !== 'table') return out;
    for (const d of days)
      for (const b of d.bands) {
        if (b.staffId === null || b.leave) continue;
        const k = `${b.staffId}|${b.date}`;
        const list = out.get(k);
        if (list) list.push(b);
        else out.set(k, [b]);
      }
    for (const list of out.values()) list.sort((a, b) => a.start - b.start);
    return out;
  }, [tab, days]);
  const qualItem = useMemo(() => qualificationItem(data.items), [data.items]);
  const badgesOf = useMemo(
    () => new Map(activeStaff.map((s) => [s.id, qualificationBadges(data.items, s)])),
    [activeStaff, data.items],
  );
  /**
   * 絞り込みの集まり（PRD D112）：この週に訪問がある人・担当が決まっていない訪問がある人・休み・定期パターン・
   * 〈スタッフ〉が担当する人（この週の帯の担当といつもの担当）など。時間軸の検索欄の近道もここから引く
   */
  const facts = useMemo(
    () =>
      filterFacts({
        days,
        clients,
        patterns: data.patterns,
        clientLeaves: data.clientLeaves,
        staff,
        // この週に訪問がある人は終了でも表に出す（その訪問をドラッグできるように。PRD D111）
        showEndedInPeriod: true,
        visitTypes: data.visitTypes,
      }),
    [days, clients, data.patterns, data.clientLeaves, data.visitTypes, staff],
  );
  /** この週に（取り消しでない）訪問がある〈利用者さん〉（検索欄の近道「この週に訪問がある人」） */
  const weekClientIds = facts.periodIds;
  /** 検索欄の候補の〈利用者さん〉：利用中の人と、休止中でもこの週に訪問がある人 */
  const weekClients = useMemo(
    () => clients.filter((c) => c.active || weekClientIds.has(c.id)),
    [clients, weekClientIds],
  );
  /** 〈スタッフ〉が担当する〈利用者さん〉（近道）：この週の帯の担当と、いつもの担当 */
  const clientsOfStaff = useCallback((sid: string) => facts.staffClientIds(sid), [facts]);
  /** 時間軸のチップに並べる人の元：この週に訪問がある人（表の既定の絞り込みと同じ人・同じ順。PRD D136） */
  const weekChipIds = useMemo(
    () => filterClients(clients, WEEK_TABLE_FILTER, facts, '').map((c) => c.id),
    [clients, facts],
  );
  /**
   * 選んでいる〈利用者さん〉（候補にいる人だけ）。?client= が無ければこの週の先頭8人（初期値。PRD D137）、
   * 空なら選んでいない
   */
  const selection = useMemo(
    () => timelineSelection(clientSel, weekChipIds, new Set(weekClients.map((c) => c.id))),
    [clientSel, weekChipIds, weekClients],
  );
  const pickedClients = selection.ids;
  /** 時間軸に出す〈利用者さん〉：選んだ順に8人まで（URL で9人以上渡されたとき。チップの✓もこの8人） */
  const timelineClients = useMemo(() => pickedClients.slice(0, TIMELINE_CLIENT_MAX), [pickedClients]);
  /** 時間軸のチップの人：この週に訪問がある人のあとに、「ほかの人を探す」で選んだ人 */
  const chipPeople = useMemo(
    () =>
      timelineChipIds(weekChipIds, timelineClients).flatMap((id) => {
        const c = clientById.get(id);
        return c ? [{ id: c.id, name: c.displayName, color: colorOf(c.color) }] : [];
      }),
    [weekChipIds, timelineClients, clientById],
  );
  /** チップの欄を開いているか（「あと N人」。この画面の中だけで覚える。PRD D140） */
  const [chipsOpen, setChipsOpen] = useState(false);
  /** チップで8人を超えて選ぼうとしたときの文（PRD D138） */
  const [chipMessage, setChipMessage] = useState<string | null>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 上限の文を出す。同じ文でも読み上げ直すよう、いったん空にしてから入れ直す */
  const announce = (text: string | null) => {
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = null;
    setChipMessage(null);
    if (text !== null) messageTimer.current = setTimeout(() => setChipMessage(text), 60);
  };
  // 選択・週・見る人が変わったら上限の文を消す（戻るボタンで URL が変わったときも）
  // biome-ignore lint/correctness/useExhaustiveDependencies: URL の値が変わったときだけ
  useEffect(() => {
    announce(null);
  }, [clientParam, anchor, by]);
  useEffect(
    () => () => {
      if (messageTimer.current) clearTimeout(messageTimer.current);
    },
    [],
  );
  /** 表の行の〈利用者さん〉：絞り込みに当てはまる人（表示名の順。表のときだけ。時間軸へ移るときの引き継ぎにも使う） */
  const filteredClients = useMemo(() => {
    if (tab !== 'clients') return [];
    const sid = resolveStaffId(tableFilter, activeStaff, facts, clients);
    return filterClients(clients, tableFilter, facts, sid);
  }, [tab, tableFilter, activeStaff, facts, clients]);
  const clientRows = useMemo(
    () =>
      tab === 'clients'
        ? filteredClients.length === 0
          ? []
          : clientWeekTable(
              data,
              days,
              filteredClients.map((c) => c.id),
            )
        : null,
    [tab, data, days, filteredClients],
  );

  const go = (next: Record<string, string | null>, replace = false) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    setParams(p, { replace });
  };
  /** 表の絞り込みを URL に書く（既定なら消す。文字を打つたびに履歴を増やさない） */
  const setTableFilter = (f: ClientFilterState) =>
    go({ cf: sameFilter(f, WEEK_TABLE_FILTER) ? null : encodeFilter(f) }, true);
  /**
   * 表示を切り替える（PRD D188）。表から時間軸へ移るとき、?client= が無く表で絞り込んでいれば、表で絞り込んだ人の
   * うち時間軸に出せる人（検索欄の候補 weekClients にいる人）の先頭8人を引き継ぐ。絞り込んでいなければ書かない＝この週の先頭8人
   * （PRD D139。lib/timelineClients）
   */
  const goView = (v: WeekView) => {
    if (v === view) return;
    const next: Record<string, string | null> = { ...weekViewParams(v, narrow) };
    // 表から時間軸（〈スタッフ〉・〈利用者さん〉どちらでも）へ移るときに書く（main と同じ。〈スタッフ〉の時間軸から
    // 〈利用者さん〉に切り替えたときも引き継がれる。PR #44 のレビュー）
    if (tab === 'clients' && isTimeline(v)) {
      const known = new Set(weekClients.map((c) => c.id));
      const handoff = handoffFromTable({
        hasParam: clientParam !== null,
        filtered: !sameFilter(tableFilter, WEEK_TABLE_FILTER),
        filteredIds: filteredClients.filter((c) => known.has(c.id)).map((c) => c.id),
        weekIds: weekChipIds,
      });
      if (handoff !== null) next.client = handoff;
    }
    go(next);
  };
  /** 時間軸の〈利用者さん〉を選び直す（初期値と同じ人なら ?client= を消す。PRD D137） */
  const setTimelineClients = (ids: string[]) => {
    announce(null);
    go({ client: clientParamOf(ids, weekChipIds) });
  };
  /** チップを押したとき（PickChips は全員を選ぶと null を返す）。8人を超えるなら選ばずに上限の文を出す（PRD D138） */
  const onClientChips = (next: string[] | null) => {
    const ids = next ?? chipPeople.map((p) => p.id);
    if (ids.length > timelineClients.length && ids.length > TIMELINE_CLIENT_MAX) {
      announce(timelineClientMaxText(terms.client));
      return;
    }
    setTimelineClients(ids);
  };
  /** 週を送る：選んでいる日付もその日にする（PRD D59。曜日はそのまま） */
  const goWeek = (d: string) => {
    lastDate.current = d;
    go({ d });
    setDate(d);
  };
  const setSel = (key: 'staff' | 'client', ids: string[] | null) => go({ [key]: ids === null ? null : ids.join(',') });
  const openDay = (d: string, visitId?: string) => {
    // 予定の画面へ移るので、表示する週は合わせない（合わせると ?d= を書く遷移が予定の画面への遷移を打ち消す）
    lastDate.current = d;
    setDate(d);
    navigate('/plan', visitId ? { state: { visitId } } : undefined);
  };
  const staffName = (id: string | null) => (id ? (staffById.get(id)?.name ?? '（不明）') : '担当なし');
  /** 〈利用者さん〉の帯の下の担当の呼び方（名字。重なればフルネーム。印刷と同じ）と、読み上げのフルネーム（PRD D83） */
  const labels = useMemo(() => staffLabels(staff), [staff]);
  const markNames = {
    short: (id: string) => labels.get(id) ?? staffName(id),
    full: (id: string) => staffName(id),
  };
  const clientName = (v: Visit | undefined) => clientById.get(v?.clientId ?? '')?.displayName ?? '（不明）';

  /**
   * 週の時間軸の帯のキーボード（PRD D333）：↑↓ 15分・←→ 1日（週の外へ出たらその週へ）・Shift+←→ 隣の担当（利用中の〈スタッフ〉の順）・
   * Enter で欄（ボタンの既定）・Delete で取り消し（確認）。どれも全体の「元に戻す」の1手
   */
  const visitKeys = useVisitKeys({
    staffOrder: () => activeStaff.map((s) => s.id),
    onMoved: (r) => {
      if (!dates.includes(r.date)) goWeek(r.date);
      focusVisitItem(r.visitId);
    },
    onCancelled: () =>
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="undo-btn"]')?.focus()),
  });

  // ---- 動かす（訪問の詳細の欄。PRD D301）----
  /**
   * 訪問の詳細の欄を開く。d・s が今の日時と違えば（ドラッグで落とした先）、その日時を入れた形で開き、保存のときに範囲
   * （この回だけ／これ以降／すべて）を選ぶ。保存で日時が変わり、担当を選ばず、新しい日に今の案があれば「空き時間に入れる」の知らせ
   */
  const openMove = (visitId: string, d?: string, s?: number, staffId?: string | null) => {
    const v = visitById.get(visitId);
    if (!v) return;
    setNotice(null);
    const changed = d !== undefined && s !== undefined && (d !== v.date || s !== hhmmToMinutes(v.earliestStart));
    const width = hhmmToMinutes(v.latestStart) - hhmmToMinutes(v.earliestStart);
    openVisitPanel({
      visitId,
      ...(staffId ? { staff: staffId } : {}),
      ...(changed
        ? { draft: { date: d, earliestStart: minutesToHhmm(s), latestStart: minutesToHhmm(s + width) } }
        : {}),
      onSaved: (r) => {
        if (r.moved && !r.staffSet && !findVisit(dataRef.current, r.visitId)?.staffId) {
          setNotice({ date: r.date, visitId: r.visitId, label: r.label, error: null });
        }
      },
      returnFocus: (vid) => (vid ? visitItemOf(vid) : null),
    });
  };
  /**
   * ドラッグ（PRD D341。どの画面も同じ判定 lib/visitDrop）：時間軸は別の日・時刻、〈利用者さん〉×曜日の表は同じ行の別の日（時刻はそのまま）、
   * 〈スタッフ〉×曜日の表は別の人・日（時刻はそのまま）。落とすと落とした日時・担当を入れた訪問の詳細の欄（範囲は欄で選ぶ）
   */
  const drag = useVisitDrag({
    today,
    fit: true,
    staffWhy: (visitId, d, sid) => staffWhyOf(dataRef.current, visitId, d, sid),
    onDrop: (visitId, v) => openMove(visitId, v.date, v.start, v.staffId),
  });
  const dragId = drag.dragId;
  // ---- ドラッグ中の予告（D57） ----
  /** つかんでいる訪問を担当できる人（その訪問の日の問題の可否） */
  const allowedNow = useMemo(() => {
    if (!dragId) return null;
    const v = visitById.get(dragId);
    return new Set(v ? allowedStaffOf(dayOf.get(v.date)?.problem ?? null, dragId) : []);
  }, [dragId, visitById, dayOf]);
  /** 訪問の見た目（日・月・人の予定表と同じ判定。lib/visitLook） */
  const lookOf = useVisitLooks(dates);
  /** 帯・マスの訪問の押し方（Shift／Ctrl＋クリック・Enter で選ぶ、押すと欄、キーで動かす。PRD D340） */
  const itemProps = useVisitItem({
    selection: multi,
    onOpen: (id) => openMove(id),
    keys: narrow ? null : visitKeys,
    selecting,
    longPress: narrow ? { onSelecting: setSelecting } : null,
  });
  /** 新しい日の今の案に空き時間で入れる（入る人がいなければ知らせに理由を出す） */
  const insert = () => {
    if (!notice) return;
    const r = insertIntoPlan(data, notice.date, notice.visitId);
    if (!r.staffId) {
      setNotice({
        ...notice,
        error: '空き時間に入りません。日の予定の「AI で組む」か、手で担当を選んでください',
      });
      return;
    }
    update((d) => insertIntoPlan(d, notice.date, notice.visitId).data, '空き時間に入れる');
    toast(`${md(notice.date)} の空き時間に入れました（担当：${staffName(r.staffId)}）`);
    setNotice(null);
  };

  /** 時間軸に出す帯：選んだ〈スタッフ〉（全員なら未割当も）・選んだ〈利用者さん〉の帯だけ */
  const staffSet = staffSel ? new Set(staffSel) : null;
  const clientSet = new Set(timelineClients);
  const showBand = (b: Band): boolean => {
    if (by === 'client') return clientSet.has(visitById.get(b.visitId)?.clientId ?? '');
    return !staffSet || (b.staffId !== null && staffSet.has(b.staffId));
  };
  /** 空の画面の文とボタン（PRD D176。案のある日が1日でもあれば null） */
  const emptyGuide = periodEmptyGuide({
    period: 'この週',
    dates,
    today,
    visitDays: days.filter((d) => d.bands.some((b) => !b.leave)).map((d) => d.date),
  });
  const nothingPicked = by === 'client' ? timelineClients.length === 0 : staffSel?.length === 0;

  // ---- 操作の行（日・週・月で同じ。PRD D327）----
  const scopeItems = useScopeItems({ zoom: 'week', date: anchor });
  /** その他 ▾：週の予定をメールで送る（表の上のボタンと同じ） */
  const moreItems: MenuItem[] = mailOn
    ? [
        {
          key: 'mail',
          label: '週の予定をメールで送る',
          icon: Mail,
          onSelect: () => setMailOpen(true),
          testId: 'week-more-mail',
        },
      ]
    : [];

  return (
    <div className="stack week-page">
      <PageHeader
        nav={<ViewSwitch current="week" />}
        icon={CalendarClock}
        title="週の予定"
        lead={`この週の担当を見て、日時をドラッグでずらし、${terms.staff}に伝えたら確定します`}
        actions={
          next.kind === 'none' ? undefined : (
            <div className="week-next" ref={nextRef} tabIndex={-1} data-testid="week-next" data-kind={next.kind}>
              {next.kind === 'making' || next.kind === 'confirm' ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  aria-disabled={next.kind === 'making' || next.why !== null || undefined}
                  aria-describedby={next.why ? whyId : undefined}
                  onClick={() => {
                    if (next.kind === 'making' || next.why !== null) return;
                    void confirmWeek();
                  }}
                  data-testid="week-next-btn"
                >
                  <WithIcon icon={next.kind === 'confirm' ? Lock : Sparkles}>
                    <span className="week-next-long">{next.label}</span>
                    <span className="week-next-short">{next.short}</span>
                  </WithIcon>
                </button>
              ) : (
                <span
                  className={`week-next-status${next.kind === 'done' ? ' is-done' : ''}`}
                  data-testid="week-next-status"
                >
                  {next.kind === 'done' && <Check size={14} strokeWidth={3} aria-hidden="true" />}
                  {next.label}
                </span>
              )}
              {next.why && (
                <span className="sub week-next-why" id={whyId} data-testid="week-next-why">
                  {next.why}
                </span>
              )}
            </div>
          )
        }
      />
      {/* 1行の状態（PRD D332。進み具合の帯は月の予定だけ） */}
      {weekPrep.futureDays > 0 && (
        <p className="week-status sub" data-testid="week-status">
          この週の今日以降：確定済み {weekPrep.line.told}日・まだ伝えていない {weekPrep.line.notYet}日
          {weekPrep.line.changed > 0 ? `・未連絡の変更 ${weekPrep.line.changed}日` : ''}・要対応 {weekPrep.line.care}件
        </p>
      )}
      {/* 操作の行（日・週・月で同じ並び。PRD D327） */}
      <ScheduleToolbar
        zoom="week"
        absence={suddenOn ? { date: anchor } : null}
        aiItems={scopeItems}
        moreItems={moreItems}
      />
      {/* 範囲の提案（日・週・月で同じ帯。PRD D328） */}
      <RangeProposalBand />

      <div className="card stack week-head">
        <div className="row week-nav">
          <button type="button" className="icon-btn" aria-label="前の週" onClick={() => goWeek(addDays(anchor, -7))}>
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <h2 className="week-title" data-testid="week-title">
            {dateText(start)}〜{dateText(dates[6]!)}
          </h2>
          <button type="button" className="icon-btn" aria-label="次の週" onClick={() => goWeek(addDays(anchor, 7))}>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={dates.includes(today)}
            onClick={() => goWeek(today)}
          >
            今週
          </button>
          <fieldset className="segmented week-views" aria-label="表示" data-testid="week-views">
            {WEEK_VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                className={view === v ? 'is-on' : ''}
                aria-pressed={view === v}
                onClick={() => goView(v)}
                data-testid={VIEW_TEST_ID[v]}
              >
                {weekViewLabel(v, terms)}
              </button>
            ))}
          </fieldset>
        </div>
        {tab === 'timeline' && (
          <div className="row week-tools">
            <span className="row week-legend">
              {data.visitTypes.map((t) => (
                <span key={t.id} className="row week-legend-item">
                  <TypeDot type={t} />
                  {t.name}
                </span>
              ))}
              <span className="row week-legend-item">
                <span className="week-legend-dash is-unassigned" aria-hidden="true" />
                担当なし（要対応）
              </span>
              <span className="row week-legend-item">
                <span className="week-legend-unfit" aria-hidden="true">
                  資格✗
                </span>
                担当が種類の必要条件を満たさない
              </span>
              <span className="row week-legend-item">
                <span className="week-legend-unfit" aria-hidden="true">
                  限✗
                </span>
                担当が担当できる人に入っていない
              </span>
            </span>
            <Hint>
              <ul className="hint-list">
                <li>帯の中の色は種類、縁の色は{by === 'staff' ? `担当の${terms.staff}` : terms.client}です。</li>
                <li>帯を押すと訪問の詳細の欄が開き、日時・担当・取り消しを変えられます。</li>
                <li>
                  帯をドラッグすると、別の日・時刻へ動かせます（{SNAP_MINUTES}
                  分刻み）。落とす先に、空き時間に入れられる人の数が出ます。
                </li>
                <li>定期パターンの訪問は、「この回だけ」「これ以降」「すべて」を選べます。</li>
              </ul>
            </Hint>
          </div>
        )}
        {tab === 'timeline' && by === 'staff' && (
          <>
            <PickChips
              label={terms.staff}
              people={activeStaff.map((s) => ({
                id: s.id,
                name: s.name,
                mark: <StaffMark staff={s} size="xs" />,
                badges: badgesOf.get(s.id),
              }))}
              selected={staffSel}
              onChange={(ids) => setSel('staff', ids)}
              highlight={allowedNow}
              detailKind="staff"
              testId="staff-chips"
            />
            {qualItem && qualItem.options.length > 0 && (
              <fieldset className="pick-chips week-quals" data-testid="qual-chips">
                <legend className="pick-chips-legend">{qualItem.name}で選ぶ</legend>
                {qualItem.options.map((o) => {
                  const ids = staffWithQualification(data.items, activeStaff, o);
                  return (
                    <button
                      key={o}
                      type="button"
                      className="pick-chip week-qual"
                      onClick={() => setSel('staff', ids)}
                      disabled={ids.length === 0}
                      title={`${o}を持つ${terms.staff}を選ぶ（${ids.length}人）`}
                      data-testid="qual-chip"
                    >
                      {o}
                      <span className="sub">{ids.length}人</span>
                    </button>
                  );
                })}
              </fieldset>
            )}
          </>
        )}
        {/*
          時間軸の〈利用者さん〉（PRD D136〜D138）：この週に訪問がある人のチップ（〈スタッフ〉で見るときと同じ見た目・操作・i）。
          ドラッグ中に高さを変えない：チップ・上限の文はドラッグで変わらない（変えるのは押したときだけ）。「ほかの人を探す」の
          検索欄は畳んでおき、候補の欄は浮かせて出す（帯を押すと検索欄からフォーカスが外れて閉じる）
        */}
        {tab === 'timeline' && by === 'client' && (
          <>
            <PickChips
              label={`表示する${terms.client}（${TIMELINE_CLIENT_MAX}人まで）`}
              people={chipPeople}
              selected={timelineClients}
              onChange={onClientChips}
              bulk={false}
              detailKind="client"
              fold={{ rows: 2, open: chipsOpen, onOpenChange: setChipsOpen }}
              actions={
                <>
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => {
                      // この週に訪問が0人でも、外したことを ?client= の空で残す（週を送っても先頭8人に戻さない）
                      announce(null);
                      go({ client: '' });
                    }}
                    disabled={pickedClients.length === 0}
                    data-testid="week-client-chips-none"
                  >
                    全部外す
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => {
                      announce(null);
                      go({ client: null });
                    }}
                    disabled={selection.isDefault || clientParamOf(pickedClients, weekChipIds) === null}
                    data-testid="week-client-chips-reset"
                  >
                    先頭{TIMELINE_CLIENT_MAX}人に戻す
                  </button>
                </>
              }
              testId="week-client-chips"
            />
            <output className="week-client-message" data-testid="week-client-chips-message">
              {chipMessage}
            </output>
            <details className="week-client-search" data-testid="week-client-search">
              <summary>ほかの人を探す</summary>
              <ClientPicker
                clients={weekClients}
                selected={pickedClients}
                onChange={setTimelineClients}
                multiple
                max={TIMELINE_CLIENT_MAX}
                maxMessage={timelineClientMaxText(terms.client)}
                label={`${terms.client}を名前・よみで探す（この週に訪問の無い人も）`}
                byStaff={{ staffLabel: terms.staff, staff: activeStaff, clientIdsOf: clientsOfStaff }}
                showChips={false}
                testId="week-client-picker"
              />
            </details>
          </>
        )}
        {/* 〈利用者さん〉×曜日の表の絞り込み（PRD D108〜D112。変わるのは押したときだけで、ドラッグ中に高さを変えない） */}
        {tab === 'clients' && (
          <ClientFilter
            clients={clients}
            state={tableFilter}
            onChange={setTableFilter}
            facts={facts}
            staff={activeStaff}
            terms={{ client: terms.client, staff: terms.staff }}
            periodLabel="この週"
            defaults={WEEK_TABLE_FILTER}
            visitTypes={data.visitTypes}
            testId="week-client-filter"
          />
        )}
        {tab === 'timeline' && by === 'client' && pickedClients.length > TIMELINE_CLIENT_MAX && (
          <p className="sub" data-testid="week-client-over">
            {timelineClientMaxText(terms.client)}。選んだ{pickedClients.length}人のうち先頭の{TIMELINE_CLIENT_MAX}
            人を出しています
          </p>
        )}
        {/* 行はいつも出しておく（ドラッグの始まりに行を足すと時間軸が下へずれ、つかんだ帯が指の下から動く） */}
        {tab === 'timeline' && by === 'client' && (
          <p className={`week-allowed${allowedNow ? '' : ' is-idle'}`} data-testid="week-allowed">
            {allowedNow
              ? `担当できる${terms.staff}：${
                  allowedNow.size === 0
                    ? 'いません'
                    : activeStaff
                        .filter((s) => allowedNow.has(s.id))
                        .map((s) => s.name)
                        .join('・')
                }`
              : `ドラッグ中は、ここに担当できる${terms.staff}を出します`}
          </p>
        )}
      </div>

      {notice && (
        <output className="card stack week-notice" data-testid="week-notice">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>
              <WithIcon icon={TriangleAlert} size={16}>
                {notice.label} へ動かしました。担当なしです
              </WithIcon>
            </span>
            <button type="button" className="icon-btn" aria-label="知らせを閉じる" onClick={() => setNotice(null)}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          {notice.error && <p className="warn-text">{notice.error}</p>}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={insert} disabled={!!notice.error}>
              <WithIcon icon={Sparkles}>{md(notice.date)} の空き時間に入れる</WithIcon>
            </button>
            <button type="button" className="btn" onClick={() => openDay(notice.date)}>
              <WithIcon icon={RefreshCw}>その日を開く</WithIcon>
            </button>
          </div>
        </output>
      )}

      {/* 空の画面（PRD D176）：この週に訪問が1日も無いとき、なぜ空かと次の一手（主ボタンは進み具合の帯に任せる） */}
      {emptyGuide && (
        <div className="card week-empty-card">
          <EmptyNext
            guide={emptyGuide}
            icon={CalendarClock}
            onOpenDay={openDay}
            primary={false}
            compact
            testId="week-empty"
          />
        </div>
      )}

      {tab === 'timeline' ? (
        <div className="card week-card" ref={timelineRef}>
          {nothingPicked && (
            <p className="sub" data-testid="week-none">
              {by === 'client'
                ? weekChipIds.length === 0 && pickedClients.length === 0
                  ? `この週に訪問がある${terms.client}はいません。「ほかの人を探す」で選んでください（${TIMELINE_CLIENT_MAX}人まで）。`
                  : `${terms.client}を選んでいません。上のチップで選ぶか「先頭${TIMELINE_CLIENT_MAX}人に戻す」を押してください（${TIMELINE_CLIENT_MAX}人まで）。`
                : `${terms.staff}をだれも選んでいません。上のチップで選ぶか「全員」を押してください。`}
            </p>
          )}
          <div className="week-grid" data-testid="week-grid">
            <div className="week-corner" />
            {days.map((day) => {
              const wd = weekday(day.date);
              /** 担当なしの訪問（PRD D282。版2） */
              const unassigned = day.bands.filter((b) => !b.leave && b.staffId === null).length;
              const countText = weekDayCountText({ count: liveCount(day), unassigned });
              return (
                <button
                  key={day.date}
                  type="button"
                  className={`week-day-head${day.date === today ? ' is-today' : ''}${wd === 0 ? ' is-sun' : wd === 6 ? ' is-sat' : ''}`}
                  onClick={() => openDay(day.date)}
                  aria-label={`${dateText(day.date)}の予定を開く（${countText}）`}
                  data-testid="week-day-head"
                >
                  <strong>{dateText(day.date)}</strong>
                  <span
                    className={`sub${unassigned > 0 ? ' week-day-unmade' : ''}`}
                    data-testid="week-day-count"
                    data-unassigned={unassigned}
                  >
                    {countText}
                  </span>
                </button>
              );
            })}
            <div className="week-gutter" style={{ height: (DAY_END - DAY_START) * PX_PER_MIN }}>
              {HOURS.map((h) => (
                <span key={h} className="week-hour" style={{ top: (h - DAY_START) * PX_PER_MIN }}>
                  {hm(h)}
                </span>
              ))}
            </div>
            {days.map((day) => (
              <DayColumn
                key={day.date}
                day={day}
                today={today}
                show={showBand}
                drag={drag}
                visitById={visitById}
                bandLabel={(b) => {
                  const v = visitById.get(b.visitId);
                  // 担当の無い帯は「担当なし」（要対応。PRD D228）
                  return { client: clientName(v), staff: b.staffId === null ? '担当なし' : staffName(b.staffId) };
                }}
                typeColor={(v) => {
                  const t = typeOf(data.visitTypes, v?.typeId);
                  return t ? colorOf(t.color) : null;
                }}
                edgeColor={(b) => {
                  if (by === 'client') {
                    const c = clientById.get(visitById.get(b.visitId)?.clientId ?? '');
                    return c ? colorOf(c.color) : null;
                  }
                  return b.staffId ? (colorOfStaff.get(b.staffId) ?? null) : null;
                }}
                lookOf={lookOf}
                isMulti={multi.has}
                itemProps={itemProps}
              />
            ))}
          </div>
        </div>
      ) : tab === 'table' ? (
        table && (
          <div className="card week-card">
            {/* 担当ごとの週の予定をメールアプリで開く（PRD D93。主ボタンにはしない）。メールを切っていれば出さない（ADR-0028） */}
            {mailOn && (
              <div className="row week-mail-row">
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => setMailOpen(true)}
                  data-testid="week-mail"
                >
                  <WithIcon icon={Mail} size={14}>
                    週の予定をメールで送る
                  </WithIcon>
                </button>
              </div>
            )}
            <div className="week-table-legend" data-testid="week-legend">
              {narrow && <SelectToggle selecting={selecting} onChange={setSelecting} testId="week-select" />}
              <span className="row week-table-legend-rows">
                <LoadRowsSample />
                <span className="sub">
                  {barRowsText()}
                  {barEdgeNote()}
                </span>
              </span>
              <StaffLegend />
            </div>
            <EdgeScroll scrollRef={tableScrollRef}>
              <table className="week-table" data-testid="week-table">
                <thead>
                  <tr>
                    <th scope="col">{terms.staff}</th>
                    {dates.map((d) => (
                      <th key={d} scope="col" className={d === today ? 'is-today' : undefined}>
                        {dateText(d)}
                      </th>
                    ))}
                    <th scope="col">週の合計</th>
                    <th scope="col">平均との差</th>
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r) => (
                    <tr key={r.staffId}>
                      <th scope="row">
                        {/* 名前を押すと詳細の吹き出し（PRD D123） */}
                        <span className="with-staff-mark">
                          <StaffMark staff={staffById.get(r.staffId)} size="sm" />
                          <PersonButton kind="staff" id={r.staffId} name={staffById.get(r.staffId)?.name ?? ''}>
                            {staffName(r.staffId)}
                          </PersonButton>
                        </span>
                        <QualificationBadges badges={badgesOf.get(r.staffId) ?? []} />
                      </th>
                      {r.cells.map((c) => {
                        // 数字は見比べに要る件数だけを小さく残し、稼働・移動・種類の内訳は title と読み上げへ（PRD D76）
                        const typesText = c.types
                          .map((t) => `${typeOf(data.visitTypes, t.typeId)?.name ?? '種類なし'} ${t.count}件`)
                          .join('・');
                        // 終日休みの人に訪問が残った日は件数も出す（休みの人に N の気づき）
                        const offText = c.count > 0 ? `休み（訪問 ${c.count}件）` : '休み';
                        const detail = c.off
                          ? offText
                          : [
                              `訪問 ${c.count}件`,
                              `稼働 ${c.hours}時間`,
                              `移動 ${c.travel}分`,
                              ...(typesText ? [typesText] : []),
                            ].join('・');
                        const key = `s|${r.staffId}|${c.date}`;
                        const hov = drag.hover?.key === key ? drag.hover : null;
                        const chips = bandsOf.get(`${r.staffId}|${c.date}`) ?? [];
                        return (
                          <td
                            key={c.date}
                            className={[
                              'week-cell',
                              c.off ? 'is-off' : '',
                              c.date < today ? 'is-past' : '',
                              hov?.verdict.ok ? 'is-drop' : '',
                            ].join(' ')}
                            {...drag.target(key, () => ({ date: c.date, start: null, staffId: r.staffId }))}
                            data-testid="week-cell"
                            data-date={c.date}
                            data-staff={r.staffId}
                            title={`${staffName(r.staffId)}さん ${dateText(c.date)}：${detail}`}
                          >
                            <StaffBar slots={c.bar} testId="week-bar" />
                            {chips.length > 0 && (
                              <span className="week-tchips">
                                {chips.map((b) => {
                                  const v = visitById.get(b.visitId);
                                  const look = lookOf(b.visitId);
                                  const on = multi.has(b.visitId);
                                  const movable = canMoveVisit(b.date, today) && !b.leave;
                                  const t = typeOf(data.visitTypes, v?.typeId);
                                  const name = clientName(v);
                                  return (
                                    <button
                                      key={b.visitId}
                                      type="button"
                                      className={`week-tchip${look?.tone === 'issue' ? ' is-issue' : ''}${on ? ' is-multi' : ''}`}
                                      style={t ? { borderLeftColor: colorOf(t.color) } : undefined}
                                      {...drag.source(b.visitId, movable && !narrow)}
                                      {...itemProps(b.visitId, { selectable: movable, movable, selected: on })}
                                      aria-label={`${hm(b.start)} ${name}${look?.text ? `・${look.text}` : ''}${on ? '（選択中）' : ''}（押すと訪問の詳細）`}
                                      title={`${hm(b.start)}〜${hm(b.end)} ${name}${look?.text ? `（${look.text}）` : ''}`}
                                      data-testid="week-tvisit"
                                      data-visit={b.visitId}
                                      data-marks={look?.kinds ?? ''}
                                    >
                                      <span className="week-tchip-time">{hm(b.start)}</span>
                                      <span className="week-tchip-name">{name}</span>
                                      <VisitMarks look={look} size={10} />
                                    </button>
                                  );
                                })}
                              </span>
                            )}
                            {hov && <DropShadow hover={hov} className="week-tdrop" time={false} />}
                            <span className="week-cell-foot">
                              {c.off ? (
                                // 訪問の無い休みは、バーに重ねた「休み」（PRD D85）と二重にしないよう文字は読み上げだけ
                                <span className={c.count > 0 ? 'week-cell-count' : 'sr-only'}>{offText}</span>
                              ) : (
                                <span className="week-cell-count">{c.count}件</span>
                              )}
                              <span className="sr-only">（{detail}）</span>
                            </span>
                          </td>
                        );
                      })}
                      <td className="week-total">
                        <strong>{r.total.count}件</strong>
                        <span className="sub">稼働 {r.total.hours}時間</span>
                        <span className="sub">移動 {r.total.travel}分</span>
                      </td>
                      <td className={`week-diff${r.strong ? ' is-strong' : ''}`} data-testid="week-diff">
                        {r.diff > 0 ? `+${r.diff}` : r.diff < 0 ? `−${-r.diff}` : '±0'}件
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">日ごとの合計</th>
                    {table.days.map((d) => (
                      <td key={d.date}>
                        <strong>{d.count}件</strong>
                        <span className="sub">移動 {d.travel}分</span>
                      </td>
                    ))}
                    <td className="week-total">
                      <strong>{table.rows.reduce((m, r) => m + r.total.count, 0)}件</strong>
                    </td>
                    <td className="sub">平均 {table.average}件</td>
                  </tr>
                </tfoot>
              </table>
            </EdgeScroll>
            <p className="sub">
              マスのバーは、その人の30分ごとの状態（訪問・移動・空き・休み・勤務外）です。
              マスにマウスを乗せると、働ける時間・移動・種類ごとの時間が出ます。スマホでは週の合計の列を見てください。
              平均との差が30%を超える人を目立たせます。
            </p>
          </div>
        )
      ) : (
        clientRows && (
          <div className="card week-card">
            <div className="week-table-legend" data-testid="week-client-legend">
              {narrow && <SelectToggle selecting={selecting} onChange={setSelecting} testId="week-select" />}
              <span className="row week-table-legend-rows">
                <LoadRowsSample />
                <span className="sub">
                  {barRowsText()}
                  {barEdgeNote()}
                </span>
              </span>
              <ClientBarLegend clientTerm={terms.client} />
            </div>
            <EdgeScroll scrollRef={clientScrollRef}>
              <table className="week-table week-clients" data-testid="week-client-table">
                <thead>
                  <tr>
                    <th scope="col">{terms.client}</th>
                    {dates.map((d) => (
                      <th key={d} scope="col" className={d === today ? 'is-today' : undefined}>
                        {dateText(d)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {clientRows.map((r) => {
                    const c = clientById.get(r.clientId);
                    return (
                      <tr key={r.clientId}>
                        <th scope="row">
                          <span className="row week-client-name">
                            {c && (
                              <span
                                className="week-client-color"
                                style={{ background: colorOf(c.color) }}
                                aria-hidden="true"
                              />
                            )}
                            {c ? <PersonButton kind="client" id={c.id} name={c.displayName} /> : '（不明）'}
                          </span>
                        </th>
                        {r.cells.map((cell) => {
                          const key = `c|${r.clientId}|${cell.date}`;
                          const hov = drag.hover?.key === key ? drag.hover : null;
                          return (
                            <td
                              key={cell.date}
                              className={`week-ccell${cell.date < today ? ' is-past' : ''}${hov?.verdict.ok ? ' is-drop' : ''}`}
                              {...drag.target(key, () => ({ date: cell.date, start: null, clientId: r.clientId }))}
                              data-date={cell.date}
                              data-client={r.clientId}
                              data-testid="week-ccell"
                            >
                              <ClientDayBar
                                items={cell.items}
                                timeText={(it) => `${hm(it.start)}〜${hm(it.end)}`}
                                markOf={(it) => {
                                  const type = typeOf(data.visitTypes, it.typeId);
                                  return {
                                    ...clientItemMark(it, markNames),
                                    color: type ? colorOf(type.color) : NO_TYPE_COLOR,
                                  };
                                }}
                                // 帯の印（要対応・資格✗／限✗・未連絡の変更・ピンなど）は担当の名前のあとに、どの画面とも同じ形で
                                marksOf={(it) => <VisitMarks look={lookOf(it.visitId)} size={10} />}
                                renderItem={(it, place) => {
                                  const type = typeOf(data.visitTypes, it.typeId);
                                  const mk = clientItemMark(it, markNames);
                                  // 〈利用者さん〉の休み（ADR-0013）・取り消しの訪問は動かさない
                                  const movable = canMoveVisit(it.date, today) && !it.leave && !it.cancelled;
                                  const look = lookOf(it.visitId);
                                  const on = multi.has(it.visitId);
                                  const text = `${hm(it.start)}〜${hm(it.end)} ${type ? `${type.name}・` : ''}${mk.text}${look?.text ? `・${look.text}` : ''}`;
                                  return (
                                    <button
                                      type="button"
                                      className={`${place.className}${look?.tone === 'issue' ? ' is-unfit' : ''}${on ? ' is-multi' : ''}`}
                                      style={place.style}
                                      {...drag.source(it.visitId, movable && !narrow)}
                                      {...itemProps(it.visitId, { selectable: movable, movable, selected: on })}
                                      aria-label={`${place.edge ? `${edgeLabel(place.edge)}の訪問 ` : ''}${text}${on ? '（選択中）' : ''}（押すと訪問の詳細）`}
                                      title={text}
                                      data-testid="week-citem"
                                      data-visit={it.visitId}
                                      data-marks={look?.kinds ?? ''}
                                    >
                                      {place.edge === 'early' ? '◀' : place.edge === 'late' ? '▶' : null}
                                    </button>
                                  );
                                }}
                              />
                              {hov && <DropShadow hover={hov} className="week-cdrop" testId="week-cdrop" />}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </EdgeScroll>
            {clientRows.length === 0 && (
              <p className="sub" data-testid="week-none">
                {`当てはまる${terms.client}がいません。上の絞り込みを外すか「絞り込みを戻す」を押してください。`}
              </p>
            )}
            <p className="sub">
              絞り込んだ{terms.client}
              の訪問です（人数の上限はありません。最初はこの週に訪問がある人を全員出します）。マスの帯は訪問の時刻の位置（3段。帯の長さが訪問の時間）で、下に担当の名字などを時刻の順に出します。時刻・種類・担当は、パソコンでは帯にマウスを乗せると出て、読み上げでは帯ごとに読みます。
              帯を同じ行の別の日のマスへドラッグすると、時刻はそのままで日を動かせます（今日より前の日へは動かせません。取り消し・休みの訪問は動かせません）。
              訪問を押すと訪問の詳細の欄が開き、日時・担当・取り消しを変えられます（キーボードでも Enter で開きます）。
            </p>
          </div>
        )
      )}

      {mailOpen && mailOn && <WeekMailPanel data={data} dates={dates} onClose={() => setMailOpen(false)} />}
      {/* 複数選択の帯（PRD D330。画面の下に貼り付く） */}
      <SelectionBar ids={multi.ids} onClear={multi.clear} dates={dates} />
      {/* キーで動かした先の読み上げと、繰り返しの回の範囲を選び直す小さな帯（PRD D333） */}
      <KeyMoveBand
        onMoved={(r) => {
          if (!dates.includes(r.date)) goWeek(r.date);
          focusVisitItem(r.visitId);
        }}
      />
    </div>
  );
}

/** 時間軸の1日の列（帯・ドラッグの受け口） */
function DayColumn({
  day,
  today,
  show,
  drag,
  visitById,
  bandLabel,
  typeColor,
  edgeColor,
  lookOf,
  isMulti,
  itemProps,
}: {
  day: WeekDay;
  /** 今日（今日より前の帯はドラッグできない） */
  today: string;
  /** 出す帯（選んだ人の帯だけ） */
  show: (b: Band) => boolean;
  /** ドラッグ（共通の判定。lib/visitDrop） */
  drag: VisitDrag;
  visitById: Map<string, Visit>;
  bandLabel: (b: Band) => { client: string; staff: string };
  typeColor: (v: Visit | undefined) => string | null;
  /** 帯の縁の色（担当・〈利用者さん〉の色） */
  edgeColor: (b: Band) => string | null;
  /** 帯の見た目（要対応・資格✗／限✗・未連絡の変更・ピンなど。lib/visitLook） */
  lookOf: (visitId: string) => VisitLook | undefined;
  /** 複数選択で選んでいるか（Shift・Ctrl＋クリック、Shift／Ctrl＋Enter。PRD D330） */
  isMulti: (visitId: string) => boolean;
  /** 押し方（選ぶ・開く・キーで動かす。components/visitParts の useVisitItem） */
  itemProps: ReturnType<typeof useVisitItem>;
}) {
  const bands = day.bands.filter(show);
  const lanes = laneLayout(bands.map((b) => ({ id: b.visitId, start: b.start, end: b.end })));
  const top = (m: number) => (Math.min(Math.max(m, DAY_START), DAY_END) - DAY_START) * PX_PER_MIN;
  const key = `t|${day.date}`;
  const hov = drag.hover?.key === key ? drag.hover : null;
  const minutes = drag.dragId ? (visitById.get(drag.dragId)?.durationMinutes ?? 60) : 60;
  const hovStart = hov ? (hov.verdict.ok ? hov.verdict.start : (hov.target.start ?? DAY_START)) : 0;
  return (
    <section
      className="week-col"
      style={{ height: (DAY_END - DAY_START) * PX_PER_MIN }}
      {...drag.target(key, (e) => ({
        date: day.date,
        start: snapMinutes(
          DAY_START + (e.clientY - e.currentTarget.getBoundingClientRect().top - drag.offset()) / PX_PER_MIN,
        ),
      }))}
      aria-label={`${dateText(day.date)}の訪問`}
      data-date={day.date}
      data-testid="week-col"
    >
      {hov && (
        <DropShadow
          hover={hov}
          className="week-drop"
          testId="week-drop"
          style={{ top: top(hovStart), height: Math.max(32, minutes * PX_PER_MIN) }}
        />
      )}
      {bands.map((b) => {
        const v = visitById.get(b.visitId);
        const l = lanes.get(b.visitId) ?? { lane: 0, lanes: 1 };
        const edge = edgeColor(b);
        const look = lookOf(b.visitId);
        const bad = look?.tone === 'issue' || look?.tone === 'unassigned';
        const { client } = bandLabel(b);
        // 〈利用者さん〉の休み（ADR-0013）の訪問は薄く「休み」と出し、動かさない
        const staff = b.leave ? '休みのため無し' : bandLabel(b).staff;
        const color = b.leave ? null : typeColor(v);
        const h = Math.max(18, (Math.min(b.end, DAY_END) - Math.max(b.start, DAY_START)) * PX_PER_MIN);
        // 今日より前の訪問は動かさない（ドラッグ・キー・選ぶを止める）
        const movable = canMoveVisit(b.date, today) && !b.leave;
        const on = isMulti(b.visitId);
        return (
          <button
            key={b.visitId}
            type="button"
            className={`week-band${b.leave ? ' is-leave' : b.staffId === null ? ' is-unassigned' : ''}${bad && b.staffId !== null ? ' is-unfit' : ''}${on ? ' is-multi' : ''}`}
            style={{
              top: top(b.start),
              height: h,
              left: `calc(${(l.lane / l.lanes) * 100}% + 2px)`,
              width: `calc(${100 / l.lanes}% - 4px)`,
              background: color ?? undefined,
              borderColor: !bad && b.staffId !== null && edge ? edge : undefined,
            }}
            title={`${hm(b.start)}〜${hm(b.end)} ${client}・${staff}${look?.text ? `（${look.text}）` : ''}`}
            aria-label={`${hm(b.start)} ${client}・${staff}${look?.text ? `・${look.text}` : ''}${on ? '（選択中）' : ''}（押すと訪問の詳細）`}
            {...drag.source(b.visitId, movable)}
            {...itemProps(b.visitId, { selectable: movable, movable, selected: on })}
            data-testid="week-band"
            data-visit={b.visitId}
            data-marks={look?.kinds ?? ''}
          >
            <span className="week-band-time">
              {hm(b.start)}
              <VisitMarks look={look} size={10} className="week-band-marks" />
            </span>
            <span className="week-band-client">{client}</span>
            <span className="week-band-staff">{staff}</span>
          </button>
        );
      })}
    </section>
  );
}
