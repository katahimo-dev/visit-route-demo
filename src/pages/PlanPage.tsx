import {
  Ban,
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
  Hourglass,
  LayoutGrid,
  ListChecks,
  Map as MapIcon,
  MapPin,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  TriangleAlert,
  Undo2,
  Users,
} from 'lucide-react';
import { type DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useDay } from '../app/day';
import { MapDock } from '../components/MapDock';
import { ClientName } from '../components/parts';
import { RouteMap } from '../components/RouteMap';
import { LegLine, StaffLegend, VisitCard } from '../components/routeView';
import { useToast } from '../components/Toast';
import { Empty, Hint, IconButton, PageHeader, SectionTitle, Stat, WithIcon } from '../components/ui';
import type { AiPlan, AiRun, DemoData } from '../contracts/data';
import type { Client, Visit } from '../contracts/documents';
import type { PlanScore, Problem, RuleAchievement, ScoreScale, SolveResult } from '../contracts/problem';
import type { Preset, Rule } from '../contracts/rules';
import { slotsText } from '../domain/availability';
import { type Cols, NONE, timeOrder, windowText } from '../domain/scheduleModel';
import { addDays } from '../domain/time';
import { achievements, BALANCE_RULE_KEY, diff, hundredBreakdown, normalize, score, toHundred } from '../evaluate';
import { attempt, deltaText, formError, newId, own, pointsText, r0 } from '../lib/common';
import { buildRouteMap, homeLegKey, homeTravel, useRouteSelection } from '../lib/routeView';
import { addRun, alignPlan, findRun, planOfRun, reusableRun } from '../lib/runs';
import { ownerMap, useDayModel } from '../lib/useDayModel';
import { bestInsertion, compile } from '../matching';
import { applyPreset, matchesPreset, presetOf, scoreRulesOf } from '../seed';
import { defaultIterations, runSolve } from '../solver';
import './plan.css';
import './schedule.css';
import {
  AchievementList,
  achievementSummary,
  breakdownText,
  explainMap,
  HundredHint,
  ReasonBox,
  RefMark,
  rulerText,
  SCORE_TEXT,
  WeightPanel,
} from './planParts';
import { VisitForm } from './VisitForm';

/**
 * 予定（D4・D13・D18・ADR-0004・ADR-0009）：その日の訪問の一覧（追加・編集・取消・前の同じ曜日からコピー）と、
 * 担当の割り当てを1画面で扱う。AI案を作る → 担当ごとの列で手直し（ドラッグ）→ 動かした訪問は固定 →
 * 「固定を残して組み直す」で残りを AI が組み直す →「この割当で確定」（manualPlans と各訪問の担当に写す）。
 * AI案の routes は手直し後の今の案、generated は AI が出したまま、pins は固定（訪問ID → 担当ID）。
 * AI案が無い日は、開いたときにすべてのプリセットで順に自動で作る（ADR-0008）。作る・組み直すたびに、条件と結果を
 * その日の記録（aiRuns）に残し、「比較」の画面（#/compare）で任意の2つを比べる（ADR-0005）。
 * プリセットごとの案のカードを並べ、「この案にする」で今の案にする。
 * 点数（100点満点）・必須の違反・条件ごとの達成は、いつも点数の基準のプリセットの物差し（ADR-0010。useDayModel の scoreProblem）。
 * プリセットのカード・重みの欄で変わるのは「どう組むか（solver が最小にする費用）」だけ。訪問ごとの理由・ドラッグの可否はいまの条件
 */

/** 予定の画面の地図・選択で使うルートの集まりのキー（今の案は1つだけ） */
const PLAN_SET = 'plan';

/** hundred：いまの最良を点数の基準の物差しで点数（100点満点）にした値（物差しを作れなければ null） */
type Progress = { iteration: number; total: number; bestScore: number; hundred: number | null };

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
  const { date } = useDay();
  const m = useDayModel(date);
  const {
    data,
    update,
    staff,
    staffById,
    clientById,
    colorOfStaff,
    visits,
    visitById,
    problem,
    scoreProblem,
    scoreScale,
    scoreRulerName,
    slotsOf,
  } = m;
  const terms = data.org.terms;
  const toast = useToast();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState<'create' | 'resolve' | null>(null);
  /** 計算している日と条件の名前（AI案が無い日の「作っています」の表示） */
  const [runningFor, setRunningFor] = useState<{ date: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 地図で見る担当・強調する区間・選んだ訪問（列の見出し・凡例・訪問・区間を押す。予定と比較で共通） */
  const sel = useRouteSelection(date, (_set, id) => owner.get(id));
  const { focusStaff, focusOn } = sel;
  /** 開いている訪問の入力欄（null：閉じている、'new'：足す、それ以外：直す訪問の ID） */
  const [editing, setEditing] = useState<string | null>(null);
  /** ページの中の地図のカード（画面の外なら右下に浮かせる） */
  const mapCardRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTo, setDropTo] = useState<string | null>(null);
  const runRef = useRef<{ stop(): void } | null>(null);
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
    setProgress(null);
    setBatch(null);
    return () => {
      generation.current++;
      runRef.current?.stop();
      runRef.current = null;
      autoTried.current.clear();
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 日付を変えたら開いた入力欄を閉じ、前の日のエラーを消す
  useEffect(() => {
    setEditing(null);
    setError(null);
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
  const edited =
    !!aiPlan && (pinCount > 0 || JSON.stringify(aiPlan.routes) !== JSON.stringify(aiPlan.generated.routes));

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
  /** AI案を作った条件（重み・必須）と、いまの条件が違うか */
  const stale = !!aiPlan && JSON.stringify(aiPlan.rules) !== JSON.stringify(data.rules);
  /** いまの条件を書き換えずにプリセットで作った案（自動作成・カードから選んだ。作ったあとに変えたのではない） */
  const madeBy = stale && !!aiPlan && pinCount === 0 ? presetOf(aiPlan.rules, data.presets) : null;
  const autoMade = !!madeBy;

  const staffName = (id: string) => staffById.get(id)?.name ?? '（不明）';
  const clientOf = (visitId: string) => {
    const v = visitById.get(visitId);
    return v ? clientById.get(v.clientId) : undefined;
  };
  const visitLabel = (id: string) =>
    `${visitById.get(id)?.earliestStart ?? ''} ${clientOf(id)?.displayName ?? '（不明）'}`;

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
    kind: 'create' | 'resolve',
    target: Problem,
    label: string,
    onDone: (r: SolveResult) => void,
    after?: () => void,
  ): boolean => {
    const gen = generation.current;
    const live = () => gen === generation.current;
    const started = attempt(() =>
      runSolve(target, { seed: dataRef.current.seed, iterations: defaultIterations(target) }, (p) => {
        if (!live()) return;
        const { problem: sp, scale: ss } = scoreRef.current;
        const hundred = sp && ss ? (attempt(() => toHundred(score(sp, p.bestRoutes).total, ss)).value ?? null) : null;
        setProgress({ iteration: p.iteration, total: p.total, bestScore: p.bestScore, hundred });
      }),
    );
    if (!started.value) {
      setError(started.error);
      return false;
    }
    runRef.current = started.value;
    setRunning(kind);
    setRunningFor({ date, label });
    setProgress(null);
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
        setProgress(null);
        after?.();
      });
    return true;
  };
  const stop = () => {
    batchStopped.current = true;
    runRef.current?.stop();
  };

  /**
   * AI案を作る（固定なし。作ると generated と routes を同じにし、固定を空に）。作った案は記録に残す。
   * rules を渡すとその条件で作る。mode：'preset' は確認ずみ、'auto' は自動作成（確認・失敗・終わりの表示を出さない）。
   * 'auto' は今の案がまだ無いときだけ今の案にし、あれば記録に足すだけ。onMade は作れたとき（作った案）、
   * after は計算が終わったあと（成功・失敗とも。順に作る次へ）。計算を始めたら true
   */
  const create = (
    rules: Rule[] = data.rules,
    mode: 'manual' | 'preset' | 'auto' = 'manual',
    opts: { after?: () => void; onMade?: (plan: AiPlan) => void } = {},
  ): boolean => {
    const auto = mode === 'auto';
    const p = check(rules, auto);
    if (!p) return false;
    if (mode === 'manual' && edited && !confirm('手直しと固定を捨てて、AI案を作り直します。よろしいですか？'))
      return false;
    const forDate = date;
    const rulesSnapshot = rules;
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
        const x = { rules: rulesSnapshot, pins: {}, result, createdAt: plan.createdAt };
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
  const runPreset = (preset: Preset) => {
    const rules = applyPreset(data.rules, preset);
    // 作れない日（訪問が無いなど）は条件も変えない
    const target = check(rules);
    if (!target) return;
    const saved = attempt(() => reusableRun(runs, target, rules, data.seed)).value;
    if (saved) {
      const already =
        !!aiPlan &&
        !edited &&
        (aiPlan.runId ? aiPlan.runId === saved.id : JSON.stringify(aiPlan.routes) === JSON.stringify(saved.routes));
      if (already) {
        // すでにその案が今の案：条件だけ合わせる
        update((d) => ({ ...d, rules: applyPreset(d.rules, preset) }));
        return;
      }
      if (edited && !confirm('手直しと固定を捨てて、この案を今の案にします。よろしいですか？')) return;
      update((d) => ({
        ...d,
        rules: applyPreset(d.rules, preset),
        aiPlans: { ...d.aiPlans, [date]: planOfRun(saved) },
      }));
      sel.reset();
      toast(`保存してある${preset.name}の案を今の案にしました（再計算なし）`);
      return;
    }
    if (edited && !confirm('手直しと固定を捨てて、AI案を作り直します。よろしいですか？')) return;
    update((d) => ({ ...d, rules: applyPreset(d.rules, preset) }));
    create(rules, 'preset');
  };

  // AI案が無い日は、開いたときにすべてのプリセットで順に自動で作る（同じ日に2回は試さない。ADR-0008）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 日付・案の有無・問題が変わったときだけ
  useEffect(() => {
    // 訪問が無い日は試したことにしない（あとで訪問を足す・コピーしたら作る）
    if (aiPlan || running || batch || !problem || problem.visits.length === 0 || autoTried.current.has(date)) return;
    autoTried.current.add(date);
    runBatch(data.presets);
  }, [date, aiPlan, problem, running]);

  // ---- プリセットごとの案のカード（ADR-0008）。点数はどれも点数の基準の物差し（ADR-0010） ----
  const presetCards = useMemo(
    () =>
      data.presets.map((pr) => {
        // 固定なしで、重み・必須がこのプリセットと一致する最新の記録
        const run = [...runs].reverse().find((r) => Object.keys(r.pins).length === 0 && matchesPreset(r.rules, pr));
        const sc = run && scoreProblem ? (attempt(() => score(scoreProblem, run.routes)).value ?? null) : null;
        const ach: RuleAchievement[] =
          run && scoreProblem ? (attempt(() => achievements(scoreProblem, run.routes)).value ?? []) : [];
        return { preset: pr, run, score: sc, hundred: sc && scoreScale ? toHundred(sc.total, scoreScale) : null, ach };
      }),
    [data.presets, runs, scoreProblem, scoreScale],
  );
  const bestCard = presetCards.reduce<number>(
    // 0点のカードには王冠を付けない
    (best, c, i) =>
      c.hundred !== null && c.hundred > 0 && (best < 0 || c.hundred > presetCards[best]!.hundred!) ? i : best,
    -1,
  );
  const missing = presetCards.filter((c) => !c.run).map((c) => c.preset);
  /** 固定を残して組み直す（generated は変えない。固定は残す） */
  const resolve = () => {
    const p = check();
    if (!p || !aiPlan) return;
    const forDate = date;
    const pinned = attempt(() => compile(data, forDate, aiPlan.pins));
    if (!pinned.value) {
      setError(pinned.error);
      return;
    }
    const rulesSnapshot = data.rules;
    const pinsSnapshot = aiPlan.pins;
    run('resolve', pinned.value, `${presetOf(data.rules, data.presets)?.name ?? 'いま'}の`, (result) => {
      const x = { rules: rulesSnapshot, pins: pinsSnapshot, result, createdAt: Date.now() };
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
      if (dateRef.current === forDate) sel.reset();
      toast(result.stopped ? '途中までの最良の案で組み直しました' : '固定を残して組み直しました');
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
  const moveTo = (visitId: string, staffId: string) => {
    if (!problem || !aiPlan || running) return;
    if (owner.get(visitId) === staffId && own(pins, visitId) === staffId) return;
    const p = problem;
    update((d) =>
      patchPlan(d, date, p, (plan) => ({
        ...withRoutes(
          p,
          plan,
          owner.get(visitId) === staffId ? plan.routes : bestInsertion(p, plan.routes, visitId, staffId),
        ),
        pins: { ...plan.pins, [visitId]: staffId },
      })),
    );
    // 移した訪問を選んでいたら、地図の絞り込みを新しい担当に合わせる
    sel.follow(visitId, staffId);
    if (!allowedFor(visitId, staffId)) {
      toast(`${staffName(staffId)}さんは必須の条件に合いません（組み直すとこの訪問は入りません）`);
    }
  };
  /** 未割当へ移す（列から外して「入らなかった訪問」へ。固定は担当の固定なので外す） */
  const unassign = (visitId: string) => {
    if (!problem || !aiPlan || running || !owner.has(visitId)) return;
    const p = problem;
    update((d) =>
      patchPlan(d, date, p, (plan) => {
        const routes = Object.fromEntries(
          Object.entries(plan.routes).map(([s, ids]) => [s, ids.filter((x) => x !== visitId)]),
        );
        const { [visitId]: _, ...pins } = plan.pins;
        return { ...withRoutes(p, plan, routes), pins };
      }),
    );
    sel.follow(visitId, null);
  };
  const unpin = (visitId: string) => {
    update((d) =>
      patchPlan(d, date, problem, (plan) => {
        const { [visitId]: _, ...rest } = plan.pins;
        return { ...plan, pins: rest };
      }),
    );
  };

  /** AI案に戻す（手直しと固定を捨てる） */
  const revert = () => {
    if (!aiPlan) return;
    if (!confirm('手直しと固定を捨てて、AIが出したままの案に戻します。よろしいですか？')) return;
    update((d) =>
      patchPlan(d, date, problem, (plan) => ({
        ...plan,
        routes: plan.generated.routes,
        unassigned: plan.generated.unassigned,
        score: plan.generated.score,
        pins: {},
      })),
    );
    sel.reset();
    toast('AI案に戻しました');
  };

  // ---- この割当で確定（D13）：今の案を manualPlans と visits.staffId に写す ----
  const adopt = () => {
    if (!aiPlan || !problem) return;
    if (
      !confirm(
        'この割当（手直し後）で確定します。各訪問の担当がこのとおりに書き換わり、スタッフの画面にも出ます。よろしいですか？\n（計算に入れていない訪問の担当はそのままです）',
      )
    )
      return;
    const inProblem = new Set(problem.visits.map((v) => v.id));
    const aiOwner = ownerMap(aiPlan.routes);
    const before = ownerMap(m.savedView.cols);
    const ownerOf = (id: string): string | null =>
      inProblem.has(id) ? (aiOwner.get(id) ?? null) : (before.get(id) ?? null);
    const cols: Record<string, string[]> = {};
    for (const v of visits) {
      const o = ownerOf(v.id) ?? NONE;
      cols[o] = [...(own(cols, o) ?? []), v.id];
    }
    update((d) => ({
      ...d,
      manualPlans: { ...d.manualPlans, [date]: cols },
      visits: d.visits.map((v) => {
        if (v.date !== date || v.cancelled || !visitById.has(v.id)) return v;
        const next = ownerOf(v.id);
        return (v.staffId ?? null) === next ? v : { ...v, staffId: next };
      }),
    }));
    toast('この割当で確定しました');
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

  // ---- 訪問の取消・前の同じ曜日からコピー ----
  const cancelVisit = (v: Visit) => {
    if (!confirm('この訪問を取り消しますか？')) return;
    update((d) => ({ ...d, visits: d.visits.map((x) => (x.id === v.id ? { ...x, cancelled: true } : x)) }));
    toast('取り消しました');
  };
  /** 1週前の訪問（と確定した割当）をこの日に写す。訪問が無い日だけ */
  const copyFromLastWeek = () => {
    setError(null);
    const from = addDays(date, -7);
    const src = data.visits.filter((v) => v.date === from && !v.cancelled);
    if (src.length === 0) {
      setError(`${from} にコピーできる訪問がありません`);
      return;
    }
    if (!confirm(`${from} の訪問（と確定した割当）を ${date} にコピーします。よろしいですか？`)) return;
    const idMap = new Map(src.map((v) => [v.id, newId('v')]));
    const copied = src.map((v) => ({ ...v, id: idMap.get(v.id) as string, date }));
    const cols: Cols = {};
    for (const [s, ids] of Object.entries(own(data.manualPlans, from) ?? {})) {
      const mapped = ids.map((id) => idMap.get(id)).filter((x): x is string => !!x);
      if (mapped.length > 0) cols[s] = mapped;
    }
    update((d) => ({ ...d, visits: [...d.visits, ...copied], manualPlans: { ...d.manualPlans, [date]: cols } }));
    toast(`${src.length}件コピーしました`);
  };

  // ---- 列：その日に働く人（と、今の案で訪問がある人）----
  const columns = useMemo(() => {
    const working = new Set(problem?.staff.filter((s) => s.slots.length > 0).map((s) => s.id) ?? []);
    const withVisits = new Set(
      Object.entries(routes)
        .filter(([, ids]) => ids.length > 0)
        .map(([k]) => k),
    );
    const order = staff.map((s) => s.id).filter((id) => working.has(id) || withVisits.has(id));
    return [...order, ...[...withVisits].filter((id) => !order.includes(id) && id !== NONE)];
  }, [problem, routes, staff]);
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
      setDragging(id);
    },
    onDragEnd: () => {
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
          })
        : { points: [], lines: [] },
    [aiPlan, columns, routes, staffById, colorOfStaff, visitById, clientById, focusStaff, sel.picked, sel.focusLeg],
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
        detail={<ReasonBox explain={explained.get(id)} />}
      >
        {(pin || hard) && (
          <div className="row visit-tags">
            {pin && (
              <span className="chip chip-pin" title="手直しで固定した訪問（組み直しても担当を変えない）">
                <Pin size={12} strokeWidth={2.4} aria-hidden="true" />
                固定
              </span>
            )}
            {hard?.map((h) => (
              <span key={h} className="chip chip-red" title="必須の条件の違反">
                <ShieldAlert size={12} aria-hidden="true" />
                {h}
              </span>
            ))}
            {pin && (
              <IconButton
                icon={PinOff}
                label="固定を外す"
                className="icon-btn-sm"
                onClick={() => unpin(id)}
                disabled={!!running}
              />
            )}
          </div>
        )}
      </VisitCard>
    );
  };

  return (
    <div className="plan-layout">
      <div className="stack" style={{ minWidth: 0 }}>
        <PageHeader
          icon={CalendarDays}
          title="予定"
          lead="その日の訪問と担当の割り当て。AIが組んだ案を手直しして確定します"
          actions={
            <>
              <button type="button" className="btn" onClick={() => setEditing('new')} disabled={m.clients.length === 0}>
                <WithIcon icon={Plus}>訪問を追加</WithIcon>
              </button>
              <button
                type="button"
                className="btn"
                onClick={copyFromLastWeek}
                disabled={visits.length > 0 || !!running}
                title={visits.length > 0 ? 'この日に訪問があるときはコピーできません' : ''}
              >
                <WithIcon icon={Copy}>前の同じ曜日からコピー</WithIcon>
              </button>
              <NavLink to="/compare" className="plan-compare-link">
                <WithIcon icon={GitCompareArrows}>比較（記録 {runCount}件）</WithIcon>
              </NavLink>
            </>
          }
        />
        {m.clients.length === 0 && (
          <div className="card">
            <p className="sub">先に{terms.client}を登録してください。</p>
          </div>
        )}
        {editing && (
          <VisitForm
            key={editing}
            date={date}
            visit={editing !== 'new' ? (visitById.get(editing) ?? null) : null}
            clients={m.clients}
            onClose={() => setEditing(null)}
            onSaved={toast}
          />
        )}
        {visits.length === 0 ? (
          <div className="card">
            <Empty icon={CalendarDays}>この日の訪問はまだありません</Empty>
          </div>
        ) : (
          <VisitList
            visits={sortedVisits}
            visitById={visitById}
            clientById={clientById}
            ownerName={(id) => {
              if (!aiPlan) return null;
              const o = owner.get(id);
              return o ? { name: staffName(o), color: colorOfStaff.get(o) } : null;
            }}
            notes={(id) => ({
              outside: !!problem && !problem.visits.some((v) => v.id === id),
              dropped: !!aiPlan && unassigned.includes(id),
              pinned: !!own(pins, id),
              hard: hardOf.get(id),
            })}
            clientLabel={terms.client}
            onEdit={setEditing}
            onCancel={cancelVisit}
          />
        )}
        <div className="card stack">
          <div className="row plan-toolbar">
            <button type="button" className="btn btn-primary" disabled={!!running || !problem} onClick={() => create()}>
              <WithIcon icon={Sparkles}>{running === 'create' ? '作っています…' : 'AI案を作る'}</WithIcon>
            </button>
            {aiPlan && (
              <button
                type="button"
                className="btn"
                disabled={!!running || !problem}
                onClick={resolve}
                title="固定した訪問の担当は変えずに、残りを AI が組み直します"
              >
                <WithIcon icon={RefreshCw}>
                  {running === 'resolve'
                    ? '組み直しています…'
                    : `固定を残して組み直す${pinCount > 0 ? `（固定 ${pinCount}件）` : ''}`}
                </WithIcon>
              </button>
            )}
            {aiPlan && (
              <button type="button" className="btn" disabled={!!running || !edited} onClick={revert}>
                <WithIcon icon={Undo2}>AI案に戻す</WithIcon>
              </button>
            )}
            {running && (
              <button type="button" className="btn" onClick={stop}>
                <WithIcon icon={Square}>止める</WithIcon>
              </button>
            )}
            <Hint label="使い方">
              訪問を別の{terms.staff}の列へドラッグすると、その{terms.staff}
              の回る順番の中で最も費用の少ない位置に入り、固定になります。「固定を残して組み直す」は、固定した訪問の担当を変えずに残りを組み直します。手直しが済んだら「この割当で確定」を押します。
            </Hint>
          </div>
          {aiPlan && !running && (
            <span className="plan-meta">
              <Clock size={12} aria-hidden="true" />
              {new Date(aiPlan.createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} に作成・乱数の種{' '}
              {aiPlan.seed}・{aiPlan.iterations.toLocaleString()}回{aiPlan.stopped && '・途中で止めた案'}
            </span>
          )}
          {running && (
            <div className="stack" style={{ gap: 4 }}>
              <progress value={progress?.iteration ?? 0} max={progress?.total ?? 1} style={{ width: '100%' }} />
              <span className="sub">
                {runningFor ? `${shortDate(runningFor.date)} の案・` : ''}
                {progress
                  ? `${progress.iteration.toLocaleString()} / ${progress.total.toLocaleString()} 回${progress.hundred === null ? '' : `・いまの最良 ${progress.hundred}点`}`
                  : '準備中…'}
              </span>
              {batch && (
                <span className="sub" data-testid="batch-progress">
                  <WithIcon icon={LayoutGrid} size={13}>
                    {shortDate(batch.date)} の案：プリセット {batch.index + 1}/{batch.total}「{batch.name}
                    」を作っています
                    {batch.date !== date ? '（別の日）' : ''}（止めると残りは作りません）
                  </WithIcon>
                </span>
              )}
            </div>
          )}
          {m.problemError && <p className="error">問題を作れませんでした：{m.problemError}</p>}
          {error && <p className="error">{error}</p>}
          {stale && autoMade && (
            <div className="sub row">
              <WithIcon icon={TriangleAlert} size={14}>
                プリセット「{madeBy?.name}」の条件で作った案です
              </WithIcon>
              <Hint>
                いまの条件とは違います。点数はいつも点数の基準のプリセット「{scoreRulerName}
                」の物差しで付けます。いまの条件で作るには「AI案を作る」を押してください。
              </Hint>
            </div>
          )}
          {stale && !autoMade && (
            <div className="warn-text row">
              <WithIcon icon={TriangleAlert} size={14}>
                作ったあとに条件が変わりました
              </WithIcon>
              <Hint>
                点数はいつも点数の基準のプリセット「{scoreRulerName}
                」の物差しで付けます（条件を変えても点の物差しは変わりません）。「AI案を作る」か「固定を残して組み直す」で作り直せます。
              </Hint>
            </div>
          )}
        </div>

        {hasVisits && (runs.length > 0 || batch) && (
          <div className="card stack">
            <SectionTitle
              icon={LayoutGrid}
              aside={
                <span className="row" style={{ gap: 6 }}>
                  {missing.length > 0 && !batch && (
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={!!running || !problem}
                      onClick={() => runBatch(missing)}
                    >
                      <WithIcon icon={Sparkles} size={14}>
                        足りない案を作る（{missing.length}つ）
                      </WithIcon>
                    </button>
                  )}
                  <span className="sub" data-testid="score-ruler">
                    物差し：{scoreRulerName}
                  </span>
                  <Hint>
                    プリセットごとに、この日の記録のうち重みが一致する最新の案です。カードを押すと、その日の条件をそのプリセットの重みにして、その案を今の案にします（同じ条件・同じデータで作った案があれば計算せずに切り替え、無ければ計算して作ります。作り直すには「AI案を作る」）。
                    {rulerText(scoreRulerName)}（比較の画面と同じ）。
                    {SCORE_TEXT}。王冠は一番点の高い案です。
                  </Hint>
                </span>
              }
            >
              プリセットごとの案
            </SectionTitle>
            <div className="preset-cards" data-testid="preset-cards">
              {presetCards.map((c, i) => {
                // 今の案の元になった記録の id で（無い古いデータは経路の一致で）。手直し中は今の案としない
                const isCurrent =
                  !!c.run &&
                  !!aiPlan &&
                  !edited &&
                  (aiPlan.runId
                    ? aiPlan.runId === c.run.id
                    : JSON.stringify(aiPlan.routes) === JSON.stringify(c.run.routes));
                const making = batch?.date === date && batch.presetId === c.preset.id;
                const sc = c.score;
                const summary = achievementSummary(c.ach, data.rules);
                // カード全体が1つのボタン（中にボタンを入れ子にしない。中身は phrasing の span だけ）
                return (
                  <button
                    key={c.preset.id}
                    type="button"
                    className={`preset-card ${i === bestCard ? 'is-best' : ''} ${isCurrent ? 'is-current' : ''}`}
                    data-testid="preset-card"
                    aria-pressed={isCurrent}
                    aria-disabled={isCurrent || undefined}
                    disabled={!!running || !problem}
                    title={
                      isCurrent
                        ? '今の案です'
                        : c.run
                          ? `押すと「${c.preset.name}」の案を今の案にします（同じ条件・同じデータの記録があれば計算しません）`
                          : `押すと「${c.preset.name}」の重みで案を作ります`
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
                    {c.preset.note && <span className="sub preset-card-note ellipsis">{c.preset.note}</span>}
                    {c.run && sc ? (
                      <>
                        <span className="preset-card-score">
                          <span data-testid="preset-card-score">{c.hundred ?? '—'}</span>
                          <small>点</small>
                        </span>
                        <span className="preset-card-stats sub">
                          <span>
                            <Car size={12} aria-hidden="true" /> 移動 {r0(sc.travelMinutes)}分
                          </span>
                          <span className={sc.dropped > 0 ? 'warn-text' : ''}>
                            <CircleOff size={12} aria-hidden="true" /> 入らない {sc.dropped}件
                          </span>
                          <span className={sc.hardViolations.length > 0 ? 'error' : ''}>
                            <ShieldAlert size={12} aria-hidden="true" /> 必須の違反 {sc.hardViolations.length}件
                          </span>
                        </span>
                        {summary && (
                          <span className="sub preset-card-ach">
                            <ListChecks size={12} aria-hidden="true" /> {summary}
                          </span>
                        )}
                        {isCurrent ? (
                          <span className="chip chip-primary preset-card-now">今の案</span>
                        ) : (
                          <span className="preset-card-action">この案にする</span>
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
          </div>
        )}

        {!hasVisits ? null : !aiPlan ? (
          <div className="card">
            <Empty icon={Sparkles}>
              {runningFor?.date === date
                ? `${shortDate(date)} のAI案を${runningFor.label}条件で作っています…`
                : running && runningFor
                  ? `${shortDate(runningFor.date)} のAI案を作っています…（終わってから、この日の案を作れます）`
                  : 'この日のAI案はまだありません。「AI案を作る」を押してください。'}
            </Empty>
          </div>
        ) : (
          <>
            <div className="card stack">
              <SectionTitle
                icon={Gauge}
                aside={
                  <span className="row" style={{ gap: 6 }}>
                    {confirmState === 'same' ? (
                      <span className="chip chip-ok" data-testid="confirm-state">
                        <CircleCheck size={12} aria-hidden="true" />
                        確定済み
                      </span>
                    ) : (
                      <span className="chip chip-warn" data-testid="confirm-state">
                        <TriangleAlert size={12} aria-hidden="true" />
                        {confirmState === 'diff' ? '未確定の変更あり' : '未確定'}
                      </span>
                    )}
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      disabled={!!running || confirmState === 'same'}
                      onClick={adopt}
                    >
                      この割当で確定
                    </button>
                  </span>
                }
              >
                今の案{edited ? '（手直し後）' : ''}
              </SectionTitle>
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
              {scoreProblem && cs && (
                <div className="stack" style={{ gap: 6 }}>
                  <strong className="balance-title">
                    <ListChecks size={15} aria-hidden="true" />
                    条件ごとの達成
                  </strong>
                  <AchievementList list={curAch} rules={data.rules} terms={terms} />
                </div>
              )}
              {scoreProblem && cs && (
                <BalanceChips
                  problem={scoreProblem}
                  routes={routes}
                  staffName={staffName}
                  colorOfStaff={colorOfStaff}
                />
              )}
              {(curScore?.error || genScore?.error) && (
                <p className="error">採点できません（{curScore?.error ?? genScore?.error}）</p>
              )}
            </div>

            <div className="card stack">
              <SectionTitle
                icon={Users}
                aside={
                  <Hint>
                    訪問をドラッグして別の{terms.staff}
                    へ移せます（「入らなかった訪問」へ移すと未割当になり、固定も外れます）。名前の下はその日の稼働時間帯です。時間の約束に間に合わない・稼働時間帯に収まらないと、必須の違反として赤い枠になります。押すと理由（点の内訳）が出ます。ピンは固定（組み直しても担当を変えない）。「自宅から」「自宅まで」や移動の分を押すと、地図でその区間を強調します。
                  </Hint>
                }
              >
                {terms.staff}ごとの順番
              </SectionTitle>
              <div className="route-grid">
                {(unassigned.length > 0 || (dragging !== null && owner.has(dragging))) && (
                  <div
                    className={`route-col route-col-none ${dropTo === NONE ? 'is-drop' : ''}`}
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
                      return (
                        <div key={id} className="stack" style={{ gap: 2 }}>
                          {card(id)}
                          {reasons.map((r) => (
                            <span key={`${r.ruleId}:${r.label}`} className="chip chip-warn">
                              {r.label}
                              {Number.isFinite(r.points) && ` ${pointsText(r.points)}`}
                            </span>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
                {columns.map((sid) => {
                  const ids = own(routes, sid) ?? [];
                  const notAllowed = dropTo === sid && dragging !== null && !allowedFor(dragging, sid);
                  const avail = slotsOf.get(sid);
                  const s = staffById.get(sid);
                  return (
                    <div
                      key={sid}
                      className={[
                        'route-col',
                        dropTo === sid ? 'is-drop' : '',
                        notAllowed ? 'is-red' : '',
                        focusStaff === sid ? 'is-focus' : '',
                        focusStaff && focusStaff !== sid ? 'is-dim-col' : '',
                      ].join(' ')}
                      style={{ borderTopColor: colorOfStaff.get(sid) }}
                      data-staff={sid}
                      {...dropProps(sid)}
                    >
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
                          <span
                            className="staff-dot"
                            style={{ background: colorOfStaff.get(sid) }}
                            aria-hidden="true"
                          />
                          {staffName(sid)}
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
                        ) : (
                          <span className="chip chip-off">{s && !s.active ? '休止中' : '休み'}</span>
                        )}
                        {avail?.overridden && <span className="chip chip-warn">この日だけ変更</span>}
                      </div>
                      {notAllowed && <div className="drop-warning">ここに移すと：必須の条件に合わない</div>}
                      {ids.length === 0 && <span className="sub">ここへドラッグすると移せます</span>}
                      {ids.map((id) => card(id))}
                      {homeLeg(sid)}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card stack" ref={mapCardRef}>
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
              <RouteMap points={points} lines={lines} height={420} />
              <StaffLegend
                staffIds={columns.filter((sid) => (own(routes, sid)?.length ?? 0) > 0)}
                staffName={staffName}
                colorOfStaff={colorOfStaff}
                focusStaff={focusStaff}
                onFocus={focusOn}
                extra={<span className="nowrap legend-item">「家」＝自宅</span>}
              />
            </div>
            <MapDock
              target={mapCardRef}
              points={points}
              lines={lines}
              title={`地図${focusStaff ? `：${staffName(focusStaff)}` : ''}`}
              focusKey={sel.focusKey}
            />
          </>
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
      </div>

      <WeightPanel
        running={!!running}
        onRecalc={() => create()}
        showPresets
        canRun={!!problem}
        recalcLabel="AI案を作り直す"
      />
    </div>
  );
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
      <div className="stat-row" data-testid="plan-summary">
        <Stat
          icon={Gauge}
          label={hard > 0 ? '合計（参考）' : '合計'}
          tone="primary"
          value={<span data-testid="plan-total">{hundred ?? '—'}</span>}
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
          label="待ち"
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
          label="必須の違反"
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
            物差し：{rulerName}
          </span>
        )}
        {scale && <HundredHint cost={current.total} parts={parts} scale={scale} rulerName={rulerName} />}
        {scale && <RefMark hard={hard} />}
        {generated && (
          <Hint label="AIが出したまま">
            合計 {genHundred ?? '—'}点・移動 {r0(generated.travelMinutes)}分・待ち {r0(generated.waitMinutes)}分
            {changed > 0 ? `。担当を変えた訪問 ${changed}件` : '（手直しなし）'}
          </Hint>
        )}
      </div>
    </div>
  );
}

/** スタッフごとの件数と目安の帯（帯の外は色、必須の上限を超えたら赤）。名前は色の丸 */
function BalanceChips({
  problem,
  routes,
  staffName,
  colorOfStaff,
}: {
  problem: Problem;
  routes: Record<string, string[]>;
  staffName: (id: string) => string;
  colorOfStaff: Map<string, string>;
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
          {b ? '色のついた帯が目安（稼働時間に比例）です。' : '負担の均等の条件が無効です。'}
          {b?.cap ? '必須：目安の上＋1件までです。' : ''}
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
              <span className="staff-dot" style={{ background: colorOfStaff.get(id) }} aria-hidden="true" />
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
 * その日の訪問の一覧（時間・訪問先・所要・担当・注意・編集/取消）。件数が多いので初期は畳む。
 * 担当は今の案での担当を出すだけ（割り当ては下の列でドラッグする）
 */
function VisitList({
  visits,
  visitById,
  clientById,
  ownerName,
  notes,
  clientLabel,
  onEdit,
  onCancel,
}: {
  /** 開始時刻の順の訪問ID */
  visits: string[];
  visitById: Map<string, Visit>;
  clientById: Map<string, Client>;
  /** 今の案での担当（AI案が無い・入らなかったときは null） */
  ownerName: (id: string) => { name: string; color: string | undefined } | null;
  notes: (id: string) => VisitNotes;
  clientLabel: string;
  onEdit: (id: string) => void;
  onCancel: (v: Visit) => void;
}) {
  return (
    <details className="card visit-list" data-testid="visit-list">
      <summary className="visit-list-summary">
        <ChevronRight size={18} className="visit-list-chevron" aria-hidden="true" />
        <CalendarDays size={18} aria-hidden="true" />
        <strong>訪問の一覧（{visits.length}件）</strong>
        <span className="sub">押すと開きます。担当は今の案のものです</span>
      </summary>
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
                    <ClientName client={clientById.get(v.clientId)} />
                    {v.note && <div className="sub">{v.note}</div>}
                  </td>
                  <td className="num nowrap">{v.durationMinutes}分</td>
                  <td className="nowrap">
                    {o ? (
                      <span className="row" style={{ gap: 6 }}>
                        <span className="staff-dot" style={{ background: o.color }} aria-hidden="true" />
                        {o.name}
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
                          固定
                        </span>
                      )}
                      {n.hard?.map((h) => (
                        <span key={h} className="chip chip-red" title="必須の条件の違反">
                          <ShieldAlert size={12} aria-hidden="true" />
                          {h}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="nowrap">
                    <div className="actions">
                      <IconButton icon={Pencil} label={`${label}を編集`} onClick={() => onEdit(id)} />
                      <IconButton icon={Ban} label={`${label}を取り消す`} tone="danger" onClick={() => onCancel(v)} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
