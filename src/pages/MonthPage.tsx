import {
  BedSingle,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Layers,
  ListChecks,
  Lock,
  PencilLine,
  RefreshCw,
  Repeat,
  Sparkles,
  Square,
  UserRound,
  UserX,
  X,
} from 'lucide-react';
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDay } from '../app/day';
import { ClientPicker } from '../components/ClientPicker';
import { LoadBar, LoadLegend, LoadRowsSample, loadSummary, TypeStack } from '../components/loadBar';
import { useToast } from '../components/Toast';
import { Hint, PageHeader, SidePanel, WithIcon } from '../components/ui';
import { ViewSwitch } from '../components/ViewSwitch';
import type { AiPlan, AiRun, DemoData } from '../contracts/data';
import type { Staff, Visit, VisitType } from '../contracts/documents';
import type { Problem } from '../contracts/problem';
import type { Rule } from '../contracts/rules';
import { slotsText, timeText } from '../domain/availability';
import { isOnLeave } from '../domain/leaves';
import { jstDate, minutesToHhmm, weekday } from '../domain/time';
import { score } from '../evaluate';
import { colorOf } from '../lib/colors';
import { attempt, byDisplayName, byName, own, WEEKDAY_LABELS } from '../lib/common';
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
  type DayView,
  dayMarks,
  dayPlanOf,
  dayStatus,
  expandMonth,
  firstDayOf,
  isYm,
  type MonthProgress,
  monthDates,
  monthProgress,
  planEdited,
  planStale,
  type StaffDay,
  shortName,
  staffDay,
  staffMonth,
  type TypeCount,
  ymOf,
} from '../lib/month';
import { mdText } from '../lib/patternText';
import { alignPlan, planOfRun, problemKey, reusableRun } from '../lib/runs';
import { staffClientMap } from '../lib/search';
import { useDayModel } from '../lib/useDayModel';
import { type CompileInput, compile } from '../matching';
import { applyPreset, scorePresetOf, scoreRulesOf } from '../seed';
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

/** 日の表示の計算の覚え（日付ごと。同じ入力なら compile・採点し直さない） */
type Memo = {
  base: unknown[];
  visits: Visit[];
  plan: AiPlan | undefined;
  saved: unknown;
  runs: AiRun[] | undefined;
  rules: Rule[];
  problem: Problem | null;
  view: DayView;
};

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
  /** 点数の物差しの条件（いまの条件に基準のプリセットを当てたもの。必須の違反と「条件が変わった」の判定に使う） */
  const scoreRules = useMemo(
    () => scoreRulesOf({ rules: data.rules, presets: data.presets, scorePresetId: data.scorePresetId }),
    [data.rules, data.presets, data.scorePresetId],
  );

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

  // ---- 日の問題と状態（日付・compile が読むデータ・案で覚える。8人・約17件／日の一月で 500ms 以内）----
  const memoRef = useRef(new Map<string, Memo>());
  const perDay = useMemo(() => {
    const out = new Map<string, { status: DayStatus; problem: Problem | null }>();
    const c = compileInput;
    // compile が読むデータのうち訪問以外のすべて（CompileInput のキーから作り、足したフィールドを漏らさない。休み clientLeaves など）
    const base = (Object.keys(c) as (keyof CompileInput)[])
      .filter((k) => k !== 'visits')
      .sort()
      .map((k) => c[k]);
    for (const d of days) {
      const plan = own(data.aiPlans, d);
      const saved = own(data.manualPlans, d);
      const visits = visitsByDate.get(d) ?? [];
      if ((!plan && !saved) || !visits.some((v) => !v.cancelled)) {
        out.set(d, { status: dayStatus(data, d), problem: null });
        continue;
      }
      const runs = own(data.aiRuns, d);
      const hit = memoRef.current.get(d);
      if (
        hit &&
        hit.plan === plan &&
        hit.saved === saved &&
        hit.runs === runs &&
        hit.rules === scoreRules &&
        sameList(hit.base, base) &&
        sameList(hit.visits, visits)
      ) {
        out.set(d, { status: dayStatus(data, d, hit.view), problem: hit.problem });
        continue;
      }
      const input: CompileInput = { ...c, visits };
      const sp = attempt(() => compile({ ...input, rules: scoreRules }, d)).value;
      let view: DayView = {};
      if (sp && plan) {
        const aligned = attempt(() => alignPlan(sp, plan)).value ?? plan;
        const sc = attempt(() => score(sp, aligned.routes)).value;
        const scoreKey = JSON.stringify(scoreRules);
        view = {
          visitIds: sp.visits.map((v) => v.id),
          hard: sc?.hardViolations.length ?? 0,
          stale: planStale(input, data, d, (rules, pins) =>
            Object.keys(pins).length === 0 && JSON.stringify(rules) === scoreKey ? sp : undefined,
          ),
        };
      } else if (sp) {
        view = { visitIds: sp.visits.map((v) => v.id) };
      }
      memoRef.current.set(d, { base, visits, plan, saved, runs, rules: scoreRules, problem: sp, view });
      out.set(d, { status: dayStatus(data, d, view), problem: sp });
    }
    return out;
  }, [days, compileInput, data, scoreRules, visitsByDate]);
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
  const showAside = (view: 'attention' | 'unconfirmed') => {
    pickFocus('all');
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
    return { visits, withVisits, withPlan, unassigned, stale };
  }, [days, statuses]);

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
          <span className="month-summary sub" data-testid="month-summary">
            訪問 {summary.visits}件・案のある日 {summary.withPlan}/{summary.withVisits}日・入らない {summary.unassigned}
            件
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
              testId="month-client-picker"
            />
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
            ・稼働時間・条件が変わった日です。混み具合のバーは 7:00〜20:00
            を3段（7〜12時・12〜15時・15〜20時）・30分ずつに分け、その30分に空いている
            {terms.staff}の人数で色を付けます（数えるのは確定した割当、無ければ今の案）。
          </Hint>
          {noVisitsWhy && <span className="sub">{noVisitsWhy}</span>}
        </div>
        <MonthLegend showLoad={focus.kind === 'all'} />
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
                        onOpen={openDay}
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
                <p className="sub">今日以降で、入らない訪問・条件が変わった日・欠勤のある日はありません。</p>
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
                          {a.kind === 'stale' && (
                            <WithIcon icon={RefreshCw} size={14}>
                              条件が変わった
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
                {focusName}さん・{monthNo}月
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
                <dt>担当</dt>
                <dd>{staffSum.count}件</dd>
                <dt>稼働時間</dt>
                <dd>
                  {hoursText(staffSum.minutes)}（{staffSum.workDays}日）
                </dd>
                <dt>移動</dt>
                <dd>{staffSum.travel}分</dd>
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
                {focusName}・{monthNo}月
              </h2>
              <dl className="month-facts" data-testid="month-client-sum">
                <dt>予定の回数</dt>
                <dd>{clientSum.planned}回</dd>
                <dt>この回だけ変更</dt>
                <dd>{clientSum.edited}回</dd>
                <dt>取り消し</dt>
                <dd>{clientSum.cancelled}回</dd>
                <dt>休みのため無し</dt>
                <dd>{clientSum.leave}回</dd>
                <dt>いつもの担当でない</dt>
                <dd>{clientSum.substitute}回</dd>
              </dl>
              <h3 className="month-aside-sub">担当した人</h3>
              {clientSum.byStaff.length === 0 ? (
                <p className="sub">この月の訪問はありません。</p>
              ) : (
                <ul className="month-bystaff">
                  {clientSum.byStaff.map((x) => (
                    <li key={x.staffId ?? '__none'}>
                      <span>{x.staffId === null ? '案なし・入らない' : (staffById.get(x.staffId)?.name ?? '')}</span>
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

/** 月の見出しの凡例：日の状態（背景・枠と印）と、混み具合の色と目盛り（見出しに1回） */
function MonthLegend({ showLoad }: { showLoad: boolean }) {
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
      {showLoad && (
        <span className="month-legend-group">
          <span className="month-legend-load">
            <span className="sub">混み具合</span>
            <LoadRowsSample />
            <span className="sub">上から 7〜12時・12〜15時・15〜20時</span>
          </span>
          <LoadLegend />
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

/** 選んだ〈スタッフ〉の担当の件数と目安に対する負荷のバー（目安の位置に線。目安を超えると橙） */
function LoadMeter({ count, target }: { count: number; target: number | null }) {
  if (target === null) return null;
  const max = Math.max(target * 1.5, count, 1);
  const over = count > Math.ceil(target);
  return (
    <span className="month-meter" aria-hidden="true">
      <span className={`month-meter-fill${over ? ' is-over' : ''}`} style={{ width: `${(count / max) * 100}%` }} />
      <span className="month-meter-target" style={{ left: `${(target / max) * 100}%` }} />
    </span>
  );
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
  onOpen: (date: string) => void;
};

/** 日のマス（memo。月まとめ作成の進み具合などで、変わらないマスは描き直さない） */
const DayCell = memo(function DayCell(props: CellProps) {
  const { date: d, status: s, today, picked, making, focus, marks: mk, load, typeById, staffById, clientTerm } = props;
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
  if (s.stale) parts.push('条件が変わった');
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
      {s.stale && (
        <span className="month-flag is-warn" data-testid="month-stale">
          <RefreshCw size={12} aria-hidden="true" />
          条件が変わった
        </span>
      )}
      {making && <span className="month-flag is-warn">作っています…</span>}
    </>
  );

  if (focus === 'all') {
    if (mk.types.length > 0)
      parts.push(`種類：${mk.types.map((x) => `${typeName(x.typeId)} ${x.count}件`).join('・')}`);
    if (mk.off.length > 0) parts.push(`休み ${mk.off.join('・')}`);
    if (mk.absent.length > 0) parts.push(`欠勤 ${mk.absent.join('・')}`);
    if (mk.starts.length > 0) parts.push(`始まる ${mk.starts.join('・')}`);
    if (mk.ends.length > 0) parts.push(`終わる ${mk.ends.join('・')}`);
    if (mk.leaves.length > 0) parts.push(`${clientTerm}の休み ${mk.leaves.join('・')}`);
    if (load) parts.push(loadSummary(load));
    else if (load === null) parts.push('混み具合は案が無いので数えていません');
    body.push(
      <TypeStack key="types" types={mk.types} typeById={typeById} />,
      <span key="marks" className="month-marks">
        {mk.off.length > 0 && (
          <span className="month-mark" title={`休み：${mk.off.join('・')}`}>
            休 {mk.off.length}
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
    const shift = x.absence
      ? x.slots.length === 0
        ? '欠勤'
        : `欠勤あり ${slotsText(x.slots)}`
      : x.off
        ? '休'
        : slotsText(x.slots);
    parts.push(shift);
    if (x.noPlan) parts.push('案なし');
    if (x.count > 0 || x.target !== null) {
      parts.push(`担当 ${x.count}件`);
      if (x.target !== null) parts.push(`目安 ${Math.round(x.target * 10) / 10}件`);
    }
    if (x.travel > 0) parts.push(`移動 ${x.travel}分`);
    body.push(
      <span key="shift" className={`month-shift${x.absence ? ' is-absent' : x.off ? ' is-off' : ''}`}>
        {x.absence && <UserX size={12} aria-hidden="true" />}
        {shift}
      </span>,
      x.noPlan ? (
        <span key="noplan" className="sub">
          案なし
        </span>
      ) : null,
      x.count > 0 || x.target !== null ? (
        <span
          key="load"
          className="month-staff-load"
          title={x.target !== null ? `目安 ${Math.round(x.target * 10) / 10}件` : ''}
        >
          <span className="month-staff-count">{x.count}件</span>
          <LoadMeter count={x.count} target={x.target} />
        </span>
      ) : null,
      x.travel > 0 ? (
        <span key="travel" className="sub">
          移動 {x.travel}分
        </span>
      ) : null,
    );
  } else if (focus === 'client' && props.clientDay) {
    const x = props.clientDay;
    if (x.noPlan) parts.push('案なし');
    const MAX = 4;
    for (const v of x.visits) {
      const who = v.cancelled
        ? '取り消し'
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
                  ? '取消'
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

  const label = parts.join('・');
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
      ].join(' ')}
    >
      <button
        type="button"
        className="month-cell-btn"
        data-testid="month-day"
        data-date={d}
        data-state={s.count > 0 ? s.state : 'empty'}
        aria-label={label}
        title={`${label}（押すとこの日の予定の画面を開きます）`}
        onClick={() => props.onOpen(d)}
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
