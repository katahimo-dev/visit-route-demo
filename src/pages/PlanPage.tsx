import {
  Car,
  CircleOff,
  Clock,
  Crown,
  Gauge,
  GitCompareArrows,
  Hourglass,
  House,
  LayoutGrid,
  ListChecks,
  Map as MapIcon,
  MapPin,
  Pin,
  PinOff,
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
import { type MapLine, type MapPoint, RouteMap } from '../components/RouteMap';
import { useToast } from '../components/Toast';
import { Empty, Hint, IconButton, PageHeader, SectionTitle, Stat, WithIcon } from '../components/ui';
import type { AiPlan, AiRun, DemoData } from '../contracts/data';
import type { PlanScore, Problem, RuleAchievement, ScoreScale, SolveResult } from '../contracts/problem';
import type { Preset, Rule } from '../contracts/rules';
import { NONE } from '../domain/scheduleModel';
import { minutesToHhmm } from '../domain/time';
import { achievements, BALANCE_RULE_KEY, diff, hundredBreakdown, normalize, score, toHundred } from '../evaluate';
import { colorOf, initialOf } from '../lib/colors';
import { attempt, deltaText, formError, hasLocation, own, pointsText, r0, staffColor } from '../lib/common';
import { addRun, findRun, planOfRun } from '../lib/runs';
import { ownerMap, useDayModel } from '../lib/useDayModel';
import { bestInsertion, compile } from '../matching';
import { applyPreset, matchesPreset, presetOf } from '../seed';
import { defaultIterations, runSolve } from '../solver';
import './plan.css';
import {
  AchievementList,
  achievementSummary,
  breakdownText,
  explainMap,
  HundredHint,
  ReasonBox,
  RefMark,
  SCORE_TEXT,
  WeightPanel,
} from './planParts';

/**
 * AI案（D18・ADR-0004）：AI案を作る → 担当ごとの列で手直し（ドラッグ・担当を選ぶ）→ 動かした訪問は固定 →
 * 「固定を残して組み直す」で残りを AI が組み直す →「予定に採用」。
 * AI案の routes は手直し後の今の案、generated は AI が出したまま、pins は固定（訪問ID → 担当ID）。
 * AI案が無い日は、開いたときにすべてのプリセットで順に自動で作る（ADR-0008）。作る・組み直すたびに、条件と結果を
 * その日の記録（aiRuns）に残し、「比較」の画面（#/compare）で任意の2つを比べる（ADR-0005）。
 * 上部にプリセットごとの案のカード（いまの条件の同じ物差しで採点）を並べ、「この案にする」で今の案にする
 */

/** hundred：いまの最良を点数（1.6倍）にした値（物差しを作れなければ null） */
type Progress = { iteration: number; total: number; bestScore: number; hundred: number | null };

/** 日付の短い表示（2026-10-13 → 10/13） */
function shortDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/** その日のAI案を書き換える（無ければそのまま） */
function patchPlan(d: DemoData, date: string, fn: (p: AiPlan) => AiPlan): DemoData {
  const p = d.aiPlans[date];
  return p ? { ...d, aiPlans: { ...d.aiPlans, [date]: fn(p) } } : d;
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
  const { data, update, staff, staffById, clientById, colorOfStaff, visits, visitById, problem, scale } = m;
  const terms = data.org.terms;
  const toast = useToast();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState<'create' | 'resolve' | null>(null);
  /** 計算している日と条件の名前（AI案が無い日の「作っています」の表示） */
  const [runningFor, setRunningFor] = useState<{ date: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  /** 地図で見るスタッフ（列の見出しを押す・訪問を選ぶと、その人のルートだけを地図に出す）。null は全員 */
  const [focusStaff, setFocusStaff] = useState<string | null>(null);
  /** 地図で強調する区間（この訪問へ来る移動）。null は無し */
  const [focusLeg, setFocusLeg] = useState<string | null>(null);
  /**
   * 地図で見るスタッフを変える（null は全員）。選んでいた区間・訪問がその人のものでなければ外す
   * （全員に戻したときも区間の強調は外す）
   */
  const focusOn = (sid: string | null) => {
    setFocusStaff(sid);
    const ownerOf = (id: string) => owner.get(id) ?? null;
    if (focusLeg && (sid === null || ownerOf(focusLeg) !== sid)) setFocusLeg(null);
    if (picked && sid !== null && ownerOf(picked) !== sid) setPicked(null);
  };
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: 日付を変えたら選んだ訪問を外す
  useEffect(() => {
    setPicked(null);
    setFocusStaff(null);
    setFocusLeg(null);
  }, [date]);

  const aiPlan: AiPlan | undefined = own(data.aiPlans, date);
  const runCount = own(data.aiRuns, date)?.length ?? 0;
  const routes = useMemo(() => aiPlan?.routes ?? {}, [aiPlan]);
  const pins = useMemo(() => aiPlan?.pins ?? {}, [aiPlan]);
  const pinCount = Object.keys(pins).length;
  const edited =
    !!aiPlan && (pinCount > 0 || JSON.stringify(aiPlan.routes) !== JSON.stringify(aiPlan.generated.routes));

  const curScore = useMemo(
    () => (problem && aiPlan ? attempt(() => score(problem, routes)) : null),
    [problem, aiPlan, routes],
  );
  const genScore = useMemo(
    () => (problem && aiPlan ? attempt(() => score(problem, aiPlan.generated.routes)) : null),
    [problem, aiPlan],
  );
  const genDiff = useMemo(
    () => (problem && aiPlan ? attempt(() => diff(problem, aiPlan.generated.routes, routes)) : null),
    [problem, aiPlan, routes],
  );
  const explained = useMemo(() => explainMap(aiPlan ? problem : null, routes), [problem, aiPlan, routes]);
  /** 今の案の条件ごとの達成の件数（D25） */
  const curAch = useMemo(
    () => (problem && aiPlan ? (attempt(() => achievements(problem, routes)).value ?? []) : []),
    [problem, aiPlan, routes],
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
  /** targetScale：途中の最良を点数にする物差し（target の費用と同じ物差しのもの） */
  const run = (
    kind: 'create' | 'resolve',
    target: Problem,
    targetScale: ScoreScale | null,
    label: string,
    onDone: (r: SolveResult) => void,
    after?: () => void,
  ): boolean => {
    const gen = generation.current;
    const live = () => gen === generation.current;
    const started = attempt(() =>
      runSolve(target, { seed: dataRef.current.seed, iterations: defaultIterations(target) }, (p) => {
        if (live()) setProgress({ ...p, hundred: targetScale ? toHundred(p.bestScore, targetScale) : null });
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
    // 条件を変えて作るときは、その条件の物差しで途中の点を出す
    const label = `${presetOf(rules, dataRef.current.presets)?.name ?? 'いま'}の`;
    return run(
      'create',
      p,
      attempt(() => normalize(p)).value,
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
        if (!auto) toast(result.stopped ? '途中までの最良の案を保存しました' : 'AI案を作りました');
      },
      opts.after,
    );
  };

  /**
   * プリセットを順に1つずつ作る（ADR-0008）。どれも記録に残す。2つ目以降も最新のデータ・条件で問題を作る。
   * 今の案が無い日に始めたときは、途中は最初に作れた案を見せ、終わったら一番点の高い（いまの条件の物差し。
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
      // 一番点の高い案を今の案にする（いまの条件の同じ物差し。カードの王冠と同じ）
      const prob = attempt(() => compile(dataRef.current, forDate)).value;
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

  /** プリセットの重みをその日の条件に当てて、すぐ作る */
  const runPreset = (preset: Preset) => {
    const rules = applyPreset(data.rules, preset);
    // 作れない日（訪問が無いなど）は条件も変えない
    if (!check(rules)) return;
    if (edited && !confirm('手直しと固定を捨てて、AI案を作り直します。よろしいですか？')) return;
    update((d) => ({ ...d, rules: applyPreset(d.rules, preset) }));
    create(rules, 'preset');
  };

  // AI案が無い日は、開いたときにすべてのプリセットで順に自動で作る（同じ日に2回は試さない。ADR-0008）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 日付・案の有無・問題が変わったときだけ
  useEffect(() => {
    if (aiPlan || running || batch || !problem || autoTried.current.has(date)) return;
    autoTried.current.add(date);
    runBatch(data.presets);
  }, [date, aiPlan, problem, running]);

  // ---- プリセットごとの案のカード（ADR-0008）。点数はどれもいまの条件の同じ物差し ----
  const runs: AiRun[] = useMemo(() => own(data.aiRuns, date) ?? [], [data.aiRuns, date]);
  const presetCards = useMemo(
    () =>
      data.presets.map((pr) => {
        // 固定なしで、重み・必須がこのプリセットと一致する最新の記録
        const run = [...runs].reverse().find((r) => Object.keys(r.pins).length === 0 && matchesPreset(r.rules, pr));
        const sc = run && problem ? (attempt(() => score(problem, run.routes)).value ?? null) : null;
        const ach: RuleAchievement[] =
          run && problem ? (attempt(() => achievements(problem, run.routes)).value ?? []) : [];
        return { preset: pr, run, score: sc, hundred: sc && scale ? toHundred(sc.total, scale) : null, ach };
      }),
    [data.presets, runs, problem, scale],
  );
  const bestCard = presetCards.reduce<number>(
    // 0点（素朴な案と同じ）のカードには王冠を付けない
    (best, c, i) =>
      c.hundred !== null && c.hundred > 0 && (best < 0 || c.hundred > presetCards[best]!.hundred!) ? i : best,
    -1,
  );
  const missing = presetCards.filter((c) => !c.run).map((c) => c.preset);
  /** 記録を今の案にする（比較の画面の「AI案の画面で開く」と同じ） */
  const openRun = (r: AiRun, name: string) => {
    if (edited && !confirm('手直しと固定を捨てて、この案を今の案にします。よろしいですか？')) return;
    update((d) => ({ ...d, aiPlans: { ...d.aiPlans, [date]: planOfRun(r) } }));
    toast(`${name}の案を今の案にしました`);
  };

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
    // 固定は可否だけを変え、費用は同じなので、いまの条件の物差しを使う
    run('resolve', pinned.value, scale, `${presetOf(data.rules, data.presets)?.name ?? 'いま'}の`, (result) => {
      const x = { rules: rulesSnapshot, pins: pinsSnapshot, result, createdAt: Date.now() };
      update((d) => {
        const added = addRun(
          patchPlan(d, forDate, (plan) => ({
            ...withRoutes(p, plan, result.routes),
            stopped: result.stopped,
            rules: rulesSnapshot,
          })),
          forDate,
          x,
        );
        const runId = findRun(added, forDate, x)?.id;
        return patchPlan(added, forDate, (plan) => ({ ...plan, runId }));
      });
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
      patchPlan(d, date, (plan) => ({
        ...withRoutes(
          p,
          plan,
          owner.get(visitId) === staffId ? plan.routes : bestInsertion(p, plan.routes, visitId, staffId),
        ),
        pins: { ...plan.pins, [visitId]: staffId },
      })),
    );
    if (!allowedFor(visitId, staffId)) {
      toast(`${staffName(staffId)}さんは必須の条件に合いません（組み直すとこの訪問は入りません）`);
    }
  };
  const unpin = (visitId: string) => {
    update((d) =>
      patchPlan(d, date, (plan) => {
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
      patchPlan(d, date, (plan) => ({
        ...plan,
        routes: plan.generated.routes,
        unassigned: plan.generated.unassigned,
        score: plan.generated.score,
        pins: {},
      })),
    );
    toast('AI案に戻しました');
  };

  // ---- 予定に採用（D13）：今の案を manualPlans と visits.staffId に写す ----
  const adopt = () => {
    if (!aiPlan || !problem) return;
    if (
      !confirm(
        'この案（手直し後）を手作業案に写します。予定画面の割当（各訪問の担当）が書き換わります。よろしいですか？\n（計算に入れていない訪問の担当はそのままです）',
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
    toast('AI案を予定に採用しました');
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
      if (id && owner.get(id) !== to) moveTo(id, to);
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
  const { points, lines } = useMemo(() => {
    const pts: MapPoint[] = [];
    const lns: MapLine[] = [];
    if (!aiPlan) return { points: pts, lines: lns };
    for (const sid of columns) {
      if (focusStaff && sid !== focusStaff) continue;
      const ids = own(routes, sid) ?? [];
      if (ids.length === 0) continue;
      const s = staffById.get(sid);
      const color = colorOfStaff.get(sid) ?? staffColor(0);
      const home = s && hasLocation(s.home) ? { lat: s.home.lat, lng: s.home.lng } : null;
      const path: { lat: number; lng: number }[] = [];
      if (home) {
        path.push(home);
        pts.push({ ...home, label: '家', color });
      }
      for (const id of ids) {
        const c = clientById.get(visitById.get(id)?.clientId ?? '');
        if (!c || !hasLocation(c.place)) continue;
        const prev = path[path.length - 1];
        if (id === focusLeg && prev)
          lns.push({ points: [prev, { lat: c.place.lat, lng: c.place.lng }], color, highlight: true });
        path.push({ lat: c.place.lat, lng: c.place.lng });
        pts.push({
          lat: c.place.lat,
          lng: c.place.lng,
          label: initialOf(c.displayName),
          color: colorOf(c.color),
          highlight: id === picked || id === focusLeg,
        });
      }
      if (home && path.length > 1) path.push(home);
      lns.push({ points: path, color });
    }
    return { points: pts, lines: lns };
  }, [aiPlan, columns, routes, staffById, colorOfStaff, visitById, clientById, focusStaff, picked, focusLeg]);

  const notInProblem = problem ? visits.filter((v) => !problem.visits.some((p) => p.id === v.id)) : [];
  const cs = curScore?.value ?? null;
  const gs = genScore?.value ?? null;

  /** 訪問カード（ドラッグで担当を移す。押すと理由と担当の選択） */
  const card = (id: string) => {
    const e = explained.get(id);
    const t = e?.timing ?? null;
    const isPicked = picked === id;
    const pin = own(pins, id);
    const hard = hardOf.get(id);
    const ownerId = owner.get(id) ?? null;
    return (
      <div key={id}>
        {t && (
          <div className="leg-line">
            <button
              type="button"
              className={`leg-btn ${focusLeg === id ? 'is-on' : ''}`}
              aria-pressed={focusLeg === id}
              title={focusLeg === id ? '地図の区間の強調をやめる' : '地図でこの区間を強調する'}
              onClick={() => {
                const on = focusLeg !== id;
                setFocusLeg(on ? id : null);
                if (on && ownerId) setFocusStaff(ownerId);
              }}
            >
              {own(routes, ownerId ?? '')?.[0] === id ? (
                <WithIcon icon={House} size={13}>
                  自宅から {r0(t.travelIn)}分
                </WithIcon>
              ) : (
                <WithIcon icon={Car} size={13}>
                  {r0(t.travelIn)}分
                </WithIcon>
              )}
            </button>
            {t.wait > 0 && (
              <WithIcon icon={Hourglass} size={13}>
                待ち {r0(t.wait)}分
              </WithIcon>
            )}
          </div>
        )}
        <div
          className={`route-item ${hard ? 'is-red' : pin ? 'is-pinned' : ''} ${isPicked ? 'is-picked' : ''} ${dragging === id ? 'is-dragging' : ''}`}
          data-visit={id}
          {...dragProps(id)}
        >
          {/* ボタン要素の上からはドラッグが始まらない（Chrome）ので、押す所は div にしてキーボードでも開けるようにする */}
          {/* biome-ignore lint/a11y/useSemanticElements: ドラッグの元にするため button にしない */}
          <div
            role="button"
            tabIndex={0}
            className="route-btn plain-btn"
            onClick={() => {
              setPicked(isPicked ? null : id);
              if (!isPicked && ownerId) setFocusStaff(ownerId);
            }}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                setPicked(isPicked ? null : id);
                if (!isPicked && ownerId) setFocusStaff(ownerId);
              }
            }}
            title="押すと理由を見られます。ドラッグで別の担当へ移せます"
          >
            <span className="visit-time">
              <Clock size={13} strokeWidth={2.2} aria-hidden="true" />
              {t ? `${minutesToHhmm(t.start)}〜${minutesToHhmm(t.end)}` : (visitById.get(id)?.earliestStart ?? '')}
            </span>
            <ClientName client={clientOf(id)} />
          </div>
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
        </div>
        {isPicked && (
          <div className="stack" style={{ gap: 4 }}>
            <ReasonBox explain={e} />
            <label className="row sub" style={{ gap: 6 }}>
              担当を選ぶ
              <select
                value={ownerId ?? ''}
                disabled={!!running}
                onChange={(ev) => {
                  if (ev.target.value) moveTo(id, ev.target.value);
                }}
                aria-label="担当を選ぶ"
              >
                {!ownerId && <option value="">未割当</option>}
                {columns.map((sid) => (
                  <option key={sid} value={sid}>
                    {staffName(sid)}
                    {allowedFor(id, sid) ? '' : '（必須の条件に合わない）'}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="plan-layout">
      <div className="stack" style={{ minWidth: 0 }}>
        <PageHeader
          icon={Sparkles}
          title="AI案"
          lead={`AIが${terms.staff}ごとの回る順番を組みます。手直しして予定に採用できます`}
          actions={
            <NavLink to="/compare" className="plan-compare-link">
              <WithIcon icon={GitCompareArrows}>比較（記録 {runCount}件）</WithIcon>
            </NavLink>
          }
        />
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
              訪問を別の{terms.staff}の列へドラッグ（または押して担当を選ぶ）と、その{terms.staff}
              の回る順番の中で最も費用の少ない位置に入り、固定になります。「固定を残して組み直す」は、固定した訪問の担当を変えずに残りを組み直します。
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
                いまの条件とは違います。点数はいまの条件で付け直しています。いまの条件で作るには「AI案を作る」を押してください。
              </Hint>
            </div>
          )}
          {stale && !autoMade && (
            <div className="warn-text row">
              <WithIcon icon={TriangleAlert} size={14}>
                作ったあとに条件が変わりました
              </WithIcon>
              <Hint>点数はいまの条件で付け直しています。「AI案を作る」か「固定を残して組み直す」で作り直せます。</Hint>
            </div>
          )}
        </div>

        {(runs.length > 0 || batch) && (
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
                  <Hint>
                    プリセットごとに、この日の記録のうち重みが一致する最新の案です。点数はどれも、いまの条件の同じ物差しで付けています（比較の画面と同じ）。
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
                return (
                  <div
                    key={c.preset.id}
                    className={`preset-card ${i === bestCard ? 'is-best' : ''} ${isCurrent ? 'is-current' : ''}`}
                    data-testid="preset-card"
                  >
                    <div className="spread">
                      <strong className="preset-card-name ellipsis" title={c.preset.note}>
                        {c.preset.name}
                      </strong>
                      {i === bestCard && (
                        <span className="preset-crown" title="一番点の高い案">
                          <Crown size={16} aria-label="一番点の高い案" />
                        </span>
                      )}
                    </div>
                    {c.run && sc ? (
                      <>
                        <div className="preset-card-score">
                          <span data-testid="preset-card-score">{c.hundred ?? '—'}</span>
                          <small>点</small>
                        </div>
                        <div className="preset-card-stats sub">
                          <span>
                            <Car size={12} aria-hidden="true" /> 移動 {r0(sc.travelMinutes)}分
                          </span>
                          <span className={sc.dropped > 0 ? 'warn-text' : ''}>
                            <CircleOff size={12} aria-hidden="true" /> 入らない {sc.dropped}件
                          </span>
                          <span className={sc.hardViolations.length > 0 ? 'error' : ''}>
                            <ShieldAlert size={12} aria-hidden="true" /> 必須の違反 {sc.hardViolations.length}件
                          </span>
                        </div>
                        {achievementSummary(c.ach, data.rules) && (
                          <span className="sub preset-card-ach">
                            <ListChecks size={12} aria-hidden="true" /> {achievementSummary(c.ach, data.rules)}
                          </span>
                        )}
                        {isCurrent ? (
                          <span className="chip chip-primary preset-card-now">今の案</span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-small"
                            disabled={!!running}
                            onClick={() => c.run && openRun(c.run, c.preset.name)}
                          >
                            この案にする
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="sub preset-card-empty">{making ? '作っています…' : 'まだ作っていません'}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!aiPlan ? (
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
                  <button type="button" className="btn btn-primary btn-small" disabled={!!running} onClick={adopt}>
                    予定に採用
                  </button>
                }
              >
                今の案{edited ? '（手直し後）' : ''}
              </SectionTitle>
              <PlanSummary
                current={cs}
                generated={gs}
                changed={genDiff?.value?.changedVisits.length ?? 0}
                problem={problem}
                scale={scale}
                balanceOut={(() => {
                  const b = curAch.find((x) => x.ruleId === BALANCE_RULE_KEY);
                  return b ? b.total - b.met : null;
                })()}
              />
              {problem && cs && (
                <div className="stack" style={{ gap: 6 }}>
                  <strong className="balance-title">
                    <ListChecks size={15} aria-hidden="true" />
                    条件ごとの達成
                  </strong>
                  <AchievementList list={curAch} rules={data.rules} terms={terms} />
                </div>
              )}
              {problem && cs && (
                <BalanceChips problem={problem} routes={routes} staffName={staffName} colorOfStaff={colorOfStaff} />
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
                    へ移せます。押すと理由（点の内訳）と担当の選択が出ます。ピンは固定（組み直しても担当を変えない）。
                  </Hint>
                }
              >
                {terms.staff}ごとの順番
              </SectionTitle>
              <div className="route-grid">
                {unassigned.length > 0 && (
                  <div className="route-col route-col-none">
                    <div className="spread">
                      <strong className="col-head">
                        <CircleOff size={16} aria-hidden="true" />
                        入らなかった訪問
                      </strong>
                      <span className="chip chip-warn">{unassigned.length}件</span>
                    </div>
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
                      {notAllowed && <div className="drop-warning">ここに移すと：必須の条件に合わない</div>}
                      {ids.length === 0 && <span className="sub">ここへドラッグすると移せます</span>}
                      {ids.map((id) => card(id))}
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
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => {
                        setFocusStaff(null);
                        setFocusLeg(null);
                      }}
                    >
                      全員のルートを見る
                    </button>
                  )
                }
              >
                地図{focusStaff ? `：${staffName(focusStaff)}` : ''}
              </SectionTitle>
              <RouteMap points={points} lines={lines} height={420} />
              <div className="row sub" style={{ flexWrap: 'wrap' }}>
                {columns
                  .filter((sid) => (own(routes, sid)?.length ?? 0) > 0)
                  .map((sid) => (
                    <button
                      key={sid}
                      type="button"
                      className={`nowrap legend-item legend-btn ${focusStaff === sid ? 'is-on' : ''}`}
                      aria-pressed={focusStaff === sid}
                      onClick={() => focusOn(focusStaff === sid ? null : sid)}
                    >
                      <span className="legend-line" style={{ background: colorOfStaff.get(sid) }} aria-hidden="true" />
                      {staffName(sid)}
                    </button>
                  ))}
                <span className="nowrap legend-item">「家」＝自宅</span>
              </div>
            </div>
            <MapDock
              target={mapCardRef}
              points={points}
              lines={lines}
              title={`地図${focusStaff ? `：${staffName(focusStaff)}` : ''}`}
              focusKey={[focusStaff, focusLeg, picked].filter(Boolean).join('|')}
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
        onPreset={runPreset}
        canRun={!!problem}
        recalcLabel="AI案を作り直す"
      />
    </div>
  );
}

/** 今の案の合計点（1.6倍した点）・移動・待ち・必須の違反と、AIが出したままとの差 */
function PlanSummary({
  current,
  generated,
  changed,
  problem,
  scale,
  balanceOut,
}: {
  current: PlanScore | null;
  generated: PlanScore | null;
  changed: number;
  problem: Problem | null;
  scale: ScoreScale | null;
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
        {scale && <HundredHint cost={current.total} parts={parts} scale={scale} />}
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
