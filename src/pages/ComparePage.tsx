import {
  CalendarDays,
  Car,
  CircleOff,
  ExternalLink,
  Gauge,
  GitCompareArrows,
  History,
  Map as MapIcon,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  TriangleAlert,
  UserRound,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useDay } from '../app/day';
import { useConfirm } from '../components/ConfirmDialog';
import { EmptyNext } from '../components/EmptyNext';
import { MapDock } from '../components/MapDock';
import { RouteMap } from '../components/RouteMap';
import { LegLine, StaffLegend, VisitCard } from '../components/routeView';
import { Term } from '../components/Term';
import { useToast } from '../components/Toast';
import { Empty, Hint, IconButton, PageHeader, SectionTitle, Stat, WithIcon } from '../components/ui';
import type { AiPlan, AiRun } from '../contracts/data';
import type { Reason, SolveResult, VisitExplain } from '../contracts/problem';
import { HARDABLE, type Rule } from '../contracts/rules';
import { jstDate } from '../domain/time';
import { achievements, diff, hundredBreakdown, ruleLowerBounds, score, toHundred } from '../evaluate';
import { attempt, dateText, deltaText, formError, own, pointsText, r0 } from '../lib/common';
import { compareEmptyGuide } from '../lib/emptyGuide';
import { anotherPlanOptions } from '../lib/planMenu';
import { buildRouteMap, homeLegKey, homeTravel, useRouteSelection } from '../lib/routeView';
import { addRun, alignPlan, findRun, planOfRun, problemKey } from '../lib/runs';
import { type ScoreReason, scoreReason } from '../lib/scoreReason';
import { ownerMap, useDayModel } from '../lib/useDayModel';
import { compile, scheduleRoute } from '../matching';
import { applyPreset } from '../seed';
import { defaultIterations, runSolve } from '../solver';
import './plan.css';
import { narrowRole } from '../lib/narrowRoles';
import { CompareTable, explainMap, ReasonBox, RefMark, rulerText, SCORE_TEXT, ScoreReasonText } from './planParts';

/**
 * 比較（D19・D22・ADR-0005）：その日のAI案の記録（作るたびに条件と結果を残したもの）と「今の案」から、
 * 任意の2つを A・B に選んで比べる。条件の差・合計と条件ごと・担当ごとの順番・地図（A 点線、B 実線）。
 * 採点（点数・必須の違反・条件ごとの達成/違反）は A・B とも、点数の基準のプリセットの同じ物差し（evaluate.score。ADR-0010）。
 * 訪問ごとの理由はいまの条件。AI案を作る・手直しは「予定」の画面（#/plan）
 */

type Side = 'a' | 'b';
/** 比べる候補：記録1件か、今の案（予定の画面の手直し後） */
type Choice = { id: string; title: string; rules: Rule[]; routes: Record<string, string[]>; unassigned: string[] };
const CURRENT = 'current';
/** 欠勤前（振り直しの元の案。ADR-0011）の候補の id の頭。`before:<記録の id>`・`before:current`（今の案の元の案） */
const BEFORE = 'before:';

/** 条件の重みの短い表示（例「重み3」「必須」「無効」） */
function weightText(r: Rule | undefined): string {
  if (!r) return '（なし）';
  if (r.hard && HARDABLE.has(r.type)) return r.type === 'balance' ? `必須・重み${r.weight}` : '必須';
  return r.weight === 0 ? '無効' : `重み${r.weight}`;
}

export default function ComparePage() {
  const { date, setDate } = useDay();
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
    scoreScale: scale,
    scoreRulerName,
    scoreRules,
  } = m;
  const terms = data.org.terms;
  const toast = useToast();
  const confirmDialog = useConfirm();
  const navigate = useNavigate();
  /** 予定の画面の「比較の画面で見る」（A＝欠勤前、B＝今の案。ADR-0011） */
  const asked = (useLocation().state ?? null) as { a?: string; b?: string } | null;
  const [sel, setSel] = useState<{ a: string | null; b: string | null }>({ a: null, b: null });
  // biome-ignore lint/correctness/useExhaustiveDependencies: 日付を変えたら選んだ案を外す（選んだ訪問・区間は useRouteSelection が外す）
  useEffect(() => {
    setSel({ a: null, b: null });
  }, [date]);
  /** 地図で見る担当・強調する区間・選んだ訪問（予定の画面と共通。集まりのキーは 'a'・'b'） */
  const rs = useRouteSelection(date, (set, id) => (set === 'a' ? ownerA : ownerB).get(id));
  /** ページの中の地図のカード（画面の外なら右下に浮かせる） */
  const mapCardRef = useRef<HTMLDivElement>(null);

  const runs: AiRun[] = useMemo(() => own(data.aiRuns, date) ?? [], [data.aiRuns, date]);
  /** 今の案（予定の画面と同じく、取り消した・足した訪問に合わせて整える） */
  const aiPlan: AiPlan | undefined = useMemo(() => {
    const p = own(data.aiPlans, date);
    return p && problem ? alignPlan(problem, p) : p;
  }, [data.aiPlans, date, problem]);
  const choices: Choice[] = useMemo(() => {
    const ids = new Set(problem?.visits.map((v) => v.id) ?? []);
    /** 欠勤前の案（元の案）。いまの問題で採点するので、欠勤の人の訪問は必須の違反として出る */
    const before = (id: string, title: string, rules: Rule[], routes: Record<string, string[]>): Choice => {
      const placed = new Set(Object.values(routes).flat());
      return { id, title, rules, routes, unassigned: [...ids].filter((v) => !placed.has(v)) };
    };
    const out: Choice[] = [];
    /** 同じ元の案の欠勤前は1つだけ出す（案A・案B の記録は同じ元の案を持つ。ADR-0011 追記） */
    const shownBefore = new Set<string>();
    for (const r of runs) {
      const baseKey = r.reassign ? JSON.stringify(r.reassign.baseRoutes) : null;
      if (r.reassign && baseKey && !shownBefore.has(baseKey)) {
        shownBefore.add(baseKey);
        out.push(before(`${BEFORE}${r.id}`, `欠勤前（#${r.no}の元の案）`, r.rules, r.reassign.baseRoutes));
      }
      out.push({ id: r.id, title: `#${r.no} ${r.label}`, rules: r.rules, routes: r.routes, unassigned: r.unassigned });
    }
    // 今の案が振り直しで、その記録が無い（消した）ときも欠勤前を出す
    if (
      aiPlan?.reassign &&
      !runs.some((r) => r.id === aiPlan.runId && r.reassign) &&
      !shownBefore.has(JSON.stringify(aiPlan.reassign.baseRoutes))
    ) {
      out.push(before(`${BEFORE}${CURRENT}`, '欠勤前（今の案の元の案）', aiPlan.rules, aiPlan.reassign.baseRoutes));
    }
    // 今の案は、どの記録とも違う（手直しした）ときだけ候補に出す
    const key = (r: Record<string, string[]>) => JSON.stringify(r);
    if (aiPlan && !runs.some((r) => key(r.routes) === key(aiPlan.routes))) {
      out.push({
        id: CURRENT,
        title: '今の案（予定の画面）',
        rules: aiPlan.rules,
        routes: aiPlan.routes,
        unassigned: aiPlan.unassigned,
      });
    }
    return out;
  }, [runs, aiPlan, problem]);
  const byId = (id: string | null) => choices.find((c) => c.id === id);
  // 予定の画面から「比較の画面で見る」で来たら、A＝今の案の欠勤前、B＝今の案（記録と同じなら記録）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 来たときに1回だけ合わせる
  useEffect(() => {
    if (asked?.a !== 'before' || !aiPlan?.reassign) return;
    // 今の案の元の案と同じ欠勤前（同じ元の案の欠勤前は1つだけ出す）
    const baseKey = JSON.stringify(aiPlan.reassign.baseRoutes);
    const a =
      choices.find((c) => c.id.startsWith(BEFORE) && JSON.stringify(c.routes) === baseKey)?.id ?? `${BEFORE}${CURRENT}`;
    const key = JSON.stringify(aiPlan.routes);
    const b = choices.some((c) => c.id === CURRENT)
      ? CURRENT
      : (choices.find((c) => !c.id.startsWith(BEFORE) && JSON.stringify(c.routes) === key)?.id ?? null);
    setSel({ a, b });
  }, [asked]);
  // 既定：A＝最初の記録、B＝A 以外の最後の記録（無ければ今の案）
  const A = byId(sel.a) ?? choices[0];
  const others = choices.filter((c) => c.id !== A?.id);
  const B = byId(sel.b) ?? others.filter((c) => c.id !== CURRENT).at(-1) ?? others.at(-1);
  /** A・B を選ぶ。もう一方と同じ案を選んだら入れ替える（同じ案どうしを比べない） */
  const pick = (side: Side, id: string) => {
    const other = side === 'a' ? B : A;
    const mine = side === 'a' ? A : B;
    if (mine?.id === id) return;
    if (other?.id === id) setSel(side === 'a' ? { a: id, b: mine?.id ?? null } : { a: mine?.id ?? null, b: id });
    else setSel((s) => ({ ...s, [side]: id }));
    // 比べる案が変わると選んだ訪問・区間の持ち主も変わるので外す
    rs.reset();
  };
  const aRoutes = useMemo(() => A?.routes ?? {}, [A]);
  const bRoutes = useMemo(() => B?.routes ?? {}, [B]);

  // ---- 採点（点数の基準の物差し。ADR-0010）----
  const scores = useMemo(
    () => new Map(choices.map((c) => [c.id, scoreProblem ? attempt(() => score(scoreProblem, c.routes)) : null])),
    [choices, scoreProblem],
  );
  /** 案ごとの点を下げているいちばん大きい理由（PRD D173。日の画面の今の案の帯と同じ決まり） */
  const reasons = useMemo(() => {
    const out = new Map<string, ScoreReason | null>();
    if (!scoreProblem || !scale) return out;
    const ruleLower = attempt(() => ruleLowerBounds(scoreProblem)).value ?? {};
    for (const c of choices) {
      const sc = scores.get(c.id)?.value;
      if (!sc) continue;
      const ach = attempt(() => achievements(scoreProblem, c.routes)).value ?? [];
      out.set(
        c.id,
        scoreReason(hundredBreakdown(sc, scale, scoreProblem), sc, { achievements: ach, rules: scoreRules, ruleLower }),
      );
    }
    return out;
  }, [choices, scores, scoreProblem, scale, scoreRules]);
  const aScore = A ? (scores.get(A.id) ?? null) : null;
  const bScore = B ? (scores.get(B.id) ?? null) : null;
  const aExplain = useMemo(() => explainMap(A ? problem : null, aRoutes), [problem, A, aRoutes]);
  const bExplain = useMemo(() => explainMap(B ? problem : null, bRoutes), [problem, B, bRoutes]);
  const abDiff = useMemo(
    () => (scoreProblem && A && B ? attempt(() => diff(scoreProblem, aRoutes, bRoutes)) : null),
    [scoreProblem, A, B, aRoutes, bRoutes],
  );
  const stale = (c: Choice | undefined) => !!c && JSON.stringify(c.rules) !== JSON.stringify(data.rules);

  const staffName = (id: string) => staffById.get(id)?.name ?? '（不明）';
  const clientOf = (visitId: string) => {
    const v = visitById.get(visitId);
    return v ? clientById.get(v.clientId) : undefined;
  };
  const visitLabel = (id: string) =>
    `${visitById.get(id)?.earliestStart ?? ''} ${clientOf(id)?.displayName ?? '（不明）'}`;

  // ---- 記録の操作 ----
  const openRun = async (r: AiRun) => {
    if (
      aiPlan &&
      (Object.keys(aiPlan.pins).length > 0 ||
        JSON.stringify(aiPlan.routes) !== JSON.stringify(aiPlan.generated.routes)) &&
      !(await confirmDialog({
        title: `手直しを捨てて、#${r.no} を今の案にしますか？`,
        body: '予定の画面の手直しと固定を捨てて、この記録を今の案にします。',
        confirmLabel: '捨てて今の案にする',
        tone: 'danger',
      }))
    )
      return;
    update((d) => ({ ...d, aiPlans: { ...d.aiPlans, [date]: planOfRun(r) } }));
    toast(`#${r.no} を今の案にしました`);
    navigate('/plan');
  };
  const applyRules = async (r: AiRun) => {
    const ok = await confirmDialog({
      title: `条件を #${r.no} と同じにしますか？`,
      body: `条件の重み・必須を #${r.no} を作ったときと同じにします。`,
      confirmLabel: '条件を同じにする',
    });
    if (!ok) return;
    const saved = new Map(r.rules.map((x) => [x.id, x]));
    update((d) => ({
      ...d,
      rules: d.rules.map((x) => {
        const s = saved.get(x.id);
        return s ? { ...x, weight: s.weight, hard: s.hard } : x;
      }),
    }));
    toast(`条件を #${r.no} と同じにしました`);
  };
  const removeRun = async (r: AiRun) => {
    if (
      !(await confirmDialog({
        title: `記録 #${r.no}「${r.label}」を消しますか？`,
        confirmLabel: '消す',
        tone: 'danger',
      }))
    )
      return;
    update((d) => ({
      ...d,
      aiRuns: { ...d.aiRuns, [date]: (own(d.aiRuns, date) ?? []).filter((x) => x.id !== r.id) },
    }));
    // 消した記録を選んでいたら既定に戻す（既定の A・B も変わりうるので、選んだ訪問・区間も外す）
    setSel((s) => ({ a: s.a === r.id ? null : s.a, b: s.b === r.id ? null : s.b }));
    rs.reset();
  };

  // ---- もう1案作って比べる（PRD D159）：案が1つだけのとき、別のプリセットか今の条件で2つめの案を作り、記録に足して A・B に並べる ----
  /** 今ある1つの案（案が1つだけのとき） */
  const only = choices.length === 1 ? choices[0] : undefined;
  const onlyRun = only ? runs.find((r) => r.id === only.id) : undefined;
  /**
   * 今ある記録が、いまのデータでも同じ問題か（記録の条件でいまのデータから作った問題のキー＝記録の inputKey。
   * 日の画面のカードと同じ作り方）。違えば同じ条件のプリセットでも別の案になるので除かない（PR #39 のレビュー）
   */
  const onlyFresh = useMemo(() => {
    if (!onlyRun?.inputKey || Object.keys(onlyRun.pins).length > 0) return false;
    const p =
      problem && JSON.stringify(onlyRun.rules) === JSON.stringify(m.compileInput.rules)
        ? problem
        : attempt(() => compile({ ...m.compileInput, rules: onlyRun.rules }, date)).value;
    return !!p && problemKey(p) === onlyRun.inputKey;
  }, [onlyRun, problem, m.compileInput, date]);
  const anotherOpts = useMemo(
    () =>
      only
        ? anotherPlanOptions(
            data.presets,
            // AI が出したままの記録で、いまのデータでも同じ問題なら、同じ条件のプリセットは出さない（同じ案になる）
            onlyRun && onlyFresh ? onlyRun.rules : null,
            data.rules,
          )
        : [],
    [only, onlyRun, onlyFresh, data.presets, data.rules],
  );
  const [anotherKey, setAnotherKey] = useState('');
  const another = anotherOpts.find((o) => o.key === anotherKey) ?? anotherOpts[0];
  /** 作っている案（名前・進み具合）。null は作っていない */
  const [making, setMaking] = useState<{ date: string; name: string; iteration: number; total: number } | null>(null);
  const [makeError, setMakeError] = useState<string | null>(null);
  const makeRef = useRef<{ stop(): void } | null>(null);
  /** 計算の世代。画面を離れると進め、前の世代の結果は捨てる（日の画面と同じ） */
  const makeGen = useRef(0);
  /** 作り終えて記録に足した案（記録に出たら A＝今ある案、B＝作った案にする） */
  const madeRef = useRef<{
    date: string;
    x: { rules: Rule[]; pins: Record<string, string>; result: SolveResult };
    before: string | null;
  } | null>(null);
  useEffect(
    () => () => {
      makeGen.current++;
      makeRef.current?.stop();
      makeRef.current = null;
    },
    [],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: 日付を変えたら前の日の知らせを消し、作っている計算は止めて捨てる（進み具合と「止める」が見えなくなるため。PR #39 のレビュー）
  useEffect(() => {
    setMakeError(null);
    setAnotherKey('');
    if (makeRef.current) {
      makeGen.current++;
      makeRef.current.stop();
      makeRef.current = null;
      setMaking(null);
      toast('日付を変えたので、作っていた案をやめました');
    }
  }, [date]);
  // 作った案が記録に出たら A・B に並べる
  // biome-ignore lint/correctness/useExhaustiveDependencies: 記録が変わったときだけ
  useEffect(() => {
    const made = madeRef.current;
    if (!made || made.date !== date) return;
    const found = findRun(data, date, made.x);
    if (!found) return;
    madeRef.current = null;
    if (found.id === made.before) {
      toast('今ある案と同じ案になりました（比べる2つめにはなりません）');
      return;
    }
    const a = made.before && choices.some((c) => c.id === made.before) ? made.before : null;
    setSel({ a, b: found.id });
    rs.reset();
    toast(
      made.x.result.stopped
        ? `途中で止めた #${found.no}「${found.label}」（途中までの最良）を記録に足しました。A と B に並べています`
        : `#${found.no}「${found.label}」を作りました。A と B に並べています`,
    );
  }, [runs]);
  const makeAnother = () => {
    if (!another || makeRef.current) return;
    setMakeError(null);
    const preset = another.kind === 'preset' ? data.presets.find((p) => p.id === another.presetId) : undefined;
    if (another.kind === 'preset' && !preset) return;
    const rules = preset ? applyPreset(data.rules, preset) : data.rules;
    const name = preset ? `「${preset.name}」` : '今の条件';
    const target = attempt(() => compile({ ...data, rules }, date));
    const p = target.value;
    if (!p) {
      setMakeError(target.error ?? '問題を作れませんでした');
      return;
    }
    if (p.visits.length === 0) {
      setMakeError('この日に計算できる訪問がありません');
      return;
    }
    if (p.staff.length === 0) {
      setMakeError(`この日に働ける${terms.staff}がいません`);
      return;
    }
    const forDate = date;
    const before = only?.id ?? null;
    const gen = makeGen.current;
    const live = () => gen === makeGen.current;
    const started = attempt(() =>
      runSolve(p, { seed: data.seed, iterations: defaultIterations(p) }, (x) => {
        if (live()) setMaking((m) => (m ? { ...m, iteration: x.iteration, total: x.total } : m));
      }),
    );
    if (!started.value) {
      setMakeError(started.error ?? 'AI案を作れませんでした');
      return;
    }
    makeRef.current = started.value;
    setMaking({ date: forDate, name, iteration: 0, total: 0 });
    const inputKey = problemKey(p);
    started.value.promise
      .then((result) => {
        if (!live()) return;
        const x = { rules, pins: {}, result, createdAt: Date.now(), inputKey };
        madeRef.current = { date: forDate, x, before };
        // 記録に足すだけ（今の案・条件は変えない。今の案にするには表の「予定の画面で開く」）
        update((d) => addRun(d, forDate, x));
      })
      .catch((e) => {
        if (live()) setMakeError(`AI案を作れませんでした（${formError(e)}）`);
      })
      .finally(() => {
        if (!live()) return;
        makeRef.current = null;
        setMaking(null);
      });
  };
  /** 作れないときの理由（選択肢が無い・訪問が無い） */
  const anotherWhy = !problem
    ? 'この日に計算できる訪問がありません'
    : anotherOpts.length === 0
      ? `どの考え方（プリセット）で作っても、今ある案と同じ条件になります。日の画面の「案を変える」の「条件を調整する」で重みを変えてから作ってください`
      : null;

  // ---- 条件の差 ----
  const ruleRows = useMemo(() => {
    if (!A || !B) return [];
    const ids = [...A.rules.map((r) => r.id), ...B.rules.map((r) => r.id)].filter((id, i, a) => a.indexOf(id) === i);
    return ids.map((id) => {
      const ra = A.rules.find((r) => r.id === id);
      const rb = B.rules.find((r) => r.id === id);
      return { id, label: (rb ?? ra)?.label ?? id, a: weightText(ra), b: weightText(rb) };
    });
  }, [A, B]);

  // ---- 担当ごとの比較 ----
  const staffIds = useMemo(() => {
    const ids = new Set(
      [...Object.entries(aRoutes), ...Object.entries(bRoutes)].filter(([, v]) => v.length > 0).map(([k]) => k),
    );
    const order = staff.map((s) => s.id).filter((id) => ids.has(id));
    return [...order, ...[...ids].filter((id) => !order.includes(id))];
  }, [aRoutes, bRoutes, staff]);
  const ownerA = useMemo(() => ownerMap(aRoutes), [aRoutes]);
  const ownerB = useMemo(() => ownerMap(bRoutes), [bRoutes]);

  /** 1人のルートの移動・待ち（lenient。対象外なら null） */
  const routeTotals = (staffId: string, ids: string[]) => {
    if (!problem) return null;
    const si = problem.staff.findIndex((s) => s.id === staffId);
    if (si < 0) return null;
    const idx = ids.map((id) => problem.visits.findIndex((v) => v.id === id)).filter((i) => i >= 0);
    return attempt(() => scheduleRoute(problem, si, idx, 'lenient')).value;
  };

  /** もう一方の案では誰の担当か（同じなら null） */
  const movedLabel = (visitId: string, staffId: string, side: Side): string | null => {
    const other = side === 'a' ? ownerB.get(visitId) : ownerA.get(visitId);
    if (other === staffId) return null;
    const name = other ? staffName(other) : '未割当';
    return side === 'a' ? `→ Bでは ${name}` : `← Aでは ${name}`;
  };

  const inProblemStaff = new Set(problem?.staff.map((s) => s.id) ?? []);
  const stopCards = (staffId: string, side: Side) => {
    const routes = side === 'a' ? aRoutes : bRoutes;
    const ids = own(routes, staffId) ?? [];
    if (ids.length === 0) return <span className="sub">訪問なし</span>;
    const ex = side === 'a' ? aExplain : bExplain;
    const back = homeTravel(problem, staffById.get(staffId), routes);
    const homeX = { id: homeLegKey(staffId), set: side };
    return (
      <div className="stack" style={{ gap: 0 }}>
        {problem && !inProblemStaff.has(staffId) && (
          <span className="chip chip-red" style={{ alignSelf: 'flex-start' }}>
            <TriangleAlert size={12} aria-hidden="true" />
            この日は計算に入れていません（休み・休止中など）
          </span>
        )}
        {ids.map((id, i) => {
          const e = ex.get(id);
          const moved = movedLabel(id, staffId, side);
          const hard = (side === 'a' ? aScore : bScore)?.value?.hardViolations.some((h) => h.visitId === id);
          const x = { id, set: side };
          return (
            <VisitCard
              key={id}
              visitId={id}
              timing={e?.timing ?? null}
              fallbackTime={visitById.get(id)?.earliestStart ?? ''}
              client={clientOf(id)}
              first={i === 0}
              legOn={rs.isLeg(x)}
              onLeg={() => rs.toggleLeg(x)}
              picked={rs.isPicked(x)}
              onPick={() => rs.togglePick(x)}
              tone={hard ? 'red' : moved ? 'moved' : null}
              detail={<ReasonBox explain={e} />}
            >
              {(moved || hard) && (
                <div className="row visit-tags">
                  {moved && <span className="chip chip-move">{moved}</span>}
                  {hard && (
                    <span className="chip chip-red">
                      <ShieldAlert size={12} aria-hidden="true" />
                      必須の違反
                    </span>
                  )}
                </div>
              )}
            </VisitCard>
          );
        })}
        {back !== null && (
          <LegLine kind="toHome" minutes={back} on={rs.isLeg(homeX)} onToggle={() => rs.toggleLeg(homeX)} />
        )}
      </div>
    );
  };

  // ---- 地図：A（点線）と B（実線）。線の色は担当の色。担当を選ぶとその人だけ ----
  const { points, lines } = useMemo(
    () =>
      buildRouteMap({
        sets: [
          { key: 'a', routes: aRoutes, dashed: true },
          { key: 'b', routes: bRoutes },
        ],
        staffOrder: staffIds,
        staffById,
        visitById,
        clientById,
        colorOfStaff,
        focusStaff: rs.focusStaff,
        picked: rs.picked,
        focusLeg: rs.focusLeg,
      }),
    [aRoutes, bRoutes, staffIds, staffById, visitById, clientById, colorOfStaff, rs.focusStaff, rs.picked, rs.focusLeg],
  );

  const infeasibleOf = useMemo(() => {
    const out = new Map<string, Reason[]>();
    for (const f of problem?.infeasible ?? []) {
      const v = problem?.visits[f.visit];
      if (v) out.set(v.id, f.reasons);
    }
    return out;
  }, [problem]);
  const notInProblem = problem ? visits.filter((v) => !problem.visits.some((p) => p.id === v.id)) : [];

  /** 入らなかった訪問（A・B それぞれ） */
  const unassignedList = (c: Choice, ex: Map<string, VisitExplain>, side: string) =>
    c.unassigned.length === 0 ? null : (
      <div className="stack" style={{ gap: 4 }}>
        <strong className="ab-title">
          <span className={`ab-badge ab-${side.toLowerCase()}`}>{side}</span>
          {c.title}
        </strong>
        {c.unassigned.map((id) => {
          const inf = infeasibleOf.get(id);
          const reasons = inf ?? ex.get(id)?.reasons ?? [];
          return (
            <div key={id} className="row" style={{ flexWrap: 'wrap' }}>
              <span>{visitLabel(id)}</span>
              {inf && <span className="sub">どの{terms.staff}も担当できません：</span>}
              {reasons.map((r) => (
                <span key={`${r.ruleId}:${r.label}`} className="chip chip-warn">
                  {r.label}
                  {Number.isFinite(r.points) && ` ${pointsText(r.points)}`}
                </span>
              ))}
              {reasons.length === 0 && <span className="sub">（原因を出せませんでした）</span>}
            </div>
          );
        })}
      </div>
    );

  const as = aScore?.value ?? null;
  const bs = bScore?.value ?? null;
  /** 点数の A・B と差（B−A。高いほど良い） */
  const hundredDelta =
    as && bs && scale
      ? (() => {
          const a = toHundred(as.total, scale);
          const b = toHundred(bs.total, scale);
          return { a, b, d: b - a };
        })()
      : null;

  return (
    <div className="stack" style={{ minWidth: 0 }}>
      <PageHeader
        icon={GitCompareArrows}
        title="案を比べる"
        lead="選んでいる日の、条件を変えたAI案を2つ選んで比べます（メニューの「案を比べる」か、日の画面の「案を変える」の「2つの案を比べる」から開きます。案が1つならここでもう1案作れます）"
        actions={
          <NavLink to="/plan" className="plan-compare-link">
            <WithIcon icon={CalendarDays}>{dateText(date)}の予定に戻る</WithIcon>
          </NavLink>
        }
      />
      {m.problemError && <p className="error">問題を作れませんでした：{m.problemError}</p>}

      <div className="card stack">
        <SectionTitle
          icon={History}
          aside={
            <span className="row" style={{ gap: 6 }}>
              <span className="sub" data-testid="score-ruler">
                <Term k="scoreBase" />：{scoreRulerName}
              </span>
              <Hint>
                予定の画面でAI案を作る・組み直すたびに、条件と結果が残ります。{rulerText(scoreRulerName)}
                （高いほど良い。
                {SCORE_TEXT}）。理想（届かない下限）は100点です。
              </Hint>
            </span>
          }
        >
          この日の記録（{runs.length}件）
        </SectionTitle>
        {choices.length === 0 ? (
          // 空の画面（PRD D176）：なぜ空かと次の一手（日の画面で作る・月のまとめて作る）
          <EmptyNext
            guide={compareEmptyGuide({
              date,
              today: jstDate(Date.now()),
              visits: problem?.visits.length ?? visits.length,
            })}
            icon={History}
            onOpenDay={(d) => {
              setDate(d);
              navigate('/plan');
            }}
            testId="compare-empty"
          />
        ) : (
          // 狭い画面（600px 以下）では行をカードにする（PRD D220。A・B と案の名前が1行目、ほかは見出し付きの行、操作は右下）
          <div className="table-scroll">
            <table {...narrowRole.table} className="compare-table runs-table narrow-cards" data-testid="narrow-runs">
              <thead {...narrowRole.rowgroup}>
                <tr {...narrowRole.row}>
                  <th {...narrowRole.columnheader} className="ab-col">
                    A
                  </th>
                  <th {...narrowRole.columnheader} className="ab-col">
                    B
                  </th>
                  <th {...narrowRole.columnheader}>案</th>
                  <th {...narrowRole.columnheader}>作った時刻</th>
                  <th {...narrowRole.columnheader} className="num">
                    合計点
                  </th>
                  <th {...narrowRole.columnheader} className="num">
                    移動
                  </th>
                  <th {...narrowRole.columnheader} className="num">
                    入らない
                  </th>
                  <th {...narrowRole.columnheader} />
                </tr>
              </thead>
              <tbody {...narrowRole.rowgroup}>
                {choices.map((c) => {
                  const run = runs.find((r) => r.id === c.id);
                  const sc = scores.get(c.id)?.value ?? null;
                  return (
                    <tr
                      {...narrowRole.row}
                      key={c.id}
                      className={`${A?.id === c.id ? 'is-a' : ''} ${B?.id === c.id ? 'is-b' : ''}`}
                    >
                      <td {...narrowRole.cell} className="ab-col narrow-head">
                        <label className="ab-pick ab-a">
                          <input
                            type="radio"
                            name="pick-a"
                            aria-label={`${c.title} を A にする`}
                            checked={A?.id === c.id}
                            onChange={() => pick('a', c.id)}
                          />
                          <span>A</span>
                        </label>
                      </td>
                      <td {...narrowRole.cell} className="ab-col narrow-head">
                        <label className="ab-pick ab-b">
                          <input
                            type="radio"
                            name="pick-b"
                            aria-label={`${c.title} を B にする`}
                            checked={B?.id === c.id}
                            onChange={() => pick('b', c.id)}
                          />
                          <span>B</span>
                        </label>
                      </td>
                      <td {...narrowRole.cell} className="narrow-title" data-label="案">
                        {c.title}
                        {run?.reassign && (
                          <span className="chip chip-move" style={{ marginLeft: 6 }}>
                            {run.reassign.method === 'anneal' ? '欠勤の振り直し（案B）' : '欠勤の振り直し（案A）'}
                          </span>
                        )}
                        {c.id.startsWith(BEFORE) && (
                          <span className="chip" style={{ marginLeft: 6 }}>
                            欠勤前
                          </span>
                        )}
                        {run?.stopped && <span className="sub">（途中で止めた案）</span>}
                      </td>
                      <td {...narrowRole.cell} className="nowrap sub" data-label="作った時刻">
                        {run
                          ? new Date(run.createdAt).toLocaleString('ja-JP', {
                              timeZone: 'Asia/Tokyo',
                              month: 'numeric',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : c.id.startsWith(BEFORE)
                            ? '振り直す前'
                            : '手直しを含む'}
                      </td>
                      <td
                        className="num"
                        title={sc ? `費用 ${r0(sc.total)}（内部の値）` : undefined}
                        data-label="合計点"
                      >
                        {sc && scale ? `${toHundred(sc.total, scale)}点` : '—'}
                        {sc && scale && <RefMark hard={sc.hardViolations.length} />}
                        {reasons.get(c.id) && (
                          <div>
                            <ScoreReasonText reason={reasons.get(c.id)!} testId="compare-reason" />
                          </div>
                        )}
                      </td>
                      <td {...narrowRole.cell} className="num" data-label="移動">
                        {sc ? `${r0(sc.travelMinutes)}分` : '—'}
                      </td>
                      <td {...narrowRole.cell} className="num" data-label="入らない">
                        {sc ? `${sc.dropped}件` : '—'}
                      </td>
                      <td {...narrowRole.cell} className="nowrap narrow-act">
                        {run && (
                          <div className="actions">
                            <IconButton
                              icon={ExternalLink}
                              label={`${c.title} を予定の画面で開く`}
                              onClick={() => openRun(run)}
                            />
                            <IconButton
                              icon={SlidersHorizontal}
                              label={`${c.title} の条件にする`}
                              onClick={() => applyRules(run)}
                            />
                            <IconButton
                              icon={Trash2}
                              label={`${c.title} を消す`}
                              tone="danger"
                              onClick={() => removeRun(run)}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {/* 乱数の種はふだん見ないので表に出さず「詳細設定」に畳む（PRD D229。条件の画面の詳細設定と同じ扱い） */}
        {runs.length > 0 && (
          <details className="compare-advanced" data-testid="compare-advanced">
            <summary className="sub">詳細設定（記録ごとの乱数の種）</summary>
            <ul className="sub compare-advanced-list">
              {runs.map((r) => (
                <li key={r.id}>
                  {choices.find((c) => c.id === r.id)?.title ?? r.id}：乱数の種 {r.seed}
                </li>
              ))}
            </ul>
          </details>
        )}
        {(choices.length === 1 || (making && making.date === date)) && (
          <div className="compare-another stack" data-testid="compare-another">
            {choices.length === 1 && (
              <Empty icon={GitCompareArrows}>
                比べるには案が2つ要ります。今の案はそのままで、別の考え方でもう1案作って並べられます。
              </Empty>
            )}
            {anotherWhy ? (
              <p className="sub" data-testid="compare-another-why">
                {anotherWhy}
              </p>
            ) : (
              another && (
                <div className="compare-another-row">
                  <label className="compare-another-pick">
                    <span className="sub">考え方</span>
                    <select
                      value={another.key}
                      onChange={(e) => setAnotherKey(e.target.value)}
                      disabled={!!making}
                      data-testid="compare-another-select"
                    >
                      {anotherOpts.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!!making}
                    onClick={makeAnother}
                    data-testid="compare-another-make"
                  >
                    <WithIcon icon={Sparkles}>もう1案作って比べる</WithIcon>
                  </button>
                </div>
              )
            )}
            {/* 読み上げは始まり・終わりだけ（回数は読まない） */}
            <output className="sub compare-another-status">
              {making && making.date === date ? `${making.name}で作っています…` : ''}
            </output>
            {making && making.date === date && (
              <span className="plan-progress" data-testid="compare-another-progress">
                <progress
                  value={making.iteration}
                  max={making.total || 1}
                  aria-label={`${making.name}の案の進み具合`}
                />
                <span className="sub" aria-hidden="true">
                  {making.total > 0
                    ? `${making.iteration.toLocaleString()} / ${making.total.toLocaleString()} 回`
                    : '準備中…'}
                </span>
                <button type="button" className="btn btn-small" onClick={() => makeRef.current?.stop()}>
                  <WithIcon icon={Square} size={14}>
                    止める
                  </WithIcon>
                </button>
              </span>
            )}
            {makeError && <p className="error">{makeError}</p>}
          </div>
        )}
      </div>

      {A && B && (
        <>
          <div className="card stack">
            <SectionTitle icon={SlidersHorizontal}>条件の差</SectionTitle>
            <div className="table-scroll">
              <table className="compare-table">
                <thead>
                  <tr>
                    <th />
                    <th className="num">
                      <span className="ab-badge ab-a">A</span> {A.title}
                    </th>
                    <th className="num">
                      <span className="ab-badge ab-b">B</span> {B.title}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ruleRows.map((r) => (
                    <tr key={r.id} className={r.a === r.b ? 'is-dim' : ''}>
                      <th>{r.label}</th>
                      <td className="num">{r.a}</td>
                      <td className="num">{r.a === r.b ? r.b : <strong className="warn-text">{r.b}</strong>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(stale(A) || stale(B)) && (
              <div className="sub row">
                <WithIcon icon={TriangleAlert} size={14}>
                  いまの条件と違う条件で作った案があります
                </WithIcon>
                <Hint>下の点数は A・B とも点数の基準のプリセット「{scoreRulerName}」の重みで付けています。</Hint>
              </div>
            )}
          </div>

          <div className="card stack">
            <SectionTitle icon={Gauge}>合計と条件ごと（A→B）</SectionTitle>
            {abDiff?.value && (
              <div className="stat-row">
                {hundredDelta && (
                  <Stat
                    icon={Gauge}
                    label="合計点の差（B−A）"
                    tone={hundredDelta.d > 0 ? 'ok' : hundredDelta.d < 0 ? 'warn' : 'plain'}
                    value={hundredDelta.d === 0 ? '差なし' : `B が ${deltaText(hundredDelta.d, '')}`}
                    unit={hundredDelta.d === 0 ? undefined : '点'}
                    note={`${hundredDelta.a}点 → ${hundredDelta.b}点${as && bs && as.hardViolations.length + bs.hardViolations.length > 0 ? '（参考）' : ''}`}
                  />
                )}
                <Stat
                  icon={Car}
                  label="移動の差"
                  tone={abDiff.value.travelDelta < 0 ? 'ok' : abDiff.value.travelDelta > 0 ? 'warn' : 'plain'}
                  value={deltaText(abDiff.value.travelDelta, '')}
                  unit={Math.round(abDiff.value.travelDelta * 10) === 0 ? undefined : '分'}
                  note={as && bs ? `${r0(as.travelMinutes)} → ${r0(bs.travelMinutes)}` : undefined}
                />
                <Stat icon={Users} label="担当が変わった訪問" value={abDiff.value.changedVisits.length} unit="件" />
                {as && bs && (as.dropped > 0 || bs.dropped > 0) && (
                  <Stat
                    icon={CircleOff}
                    label="入らない訪問"
                    tone={bs.dropped > as.dropped ? 'warn' : 'plain'}
                    value={`${as.dropped} → ${bs.dropped}`}
                    unit="件"
                  />
                )}
              </div>
            )}
            <CompareTable
              a={as}
              b={bs}
              labels={[`A：${A.title}`, `B：${B.title}`]}
              rules={data.rules}
              error={aScore?.error ?? bScore?.error}
              scale={scale}
            />
          </div>

          <div className="card stack">
            <SectionTitle
              icon={Users}
              aside={
                <Hint>
                  訪問を押すと、その担当になった理由（点の内訳）が出て、地図でその訪問先を強調します。{terms.staff}
                  の名前を押すと地図がその人だけになります（もう一度で全員）。「自宅から」「自宅まで」や移動の分を押すと、地図でその区間（A
                  は点線、B は実線）を強調します。
                </Hint>
              }
            >
              {terms.staff}ごとの比較
            </SectionTitle>
            <div className="compare">
              <div className="compare-row compare-header">
                <div />
                <div>
                  <span className="ab-badge ab-a">A</span> {A.title}
                </div>
                <div>
                  <span className="ab-badge ab-b">B</span> {B.title}
                </div>
              </div>
              {staffIds.map((id) => {
                const pa = routeTotals(id, own(aRoutes, id) ?? []);
                const pb = routeTotals(id, own(bRoutes, id) ?? []);
                const d = r0((pb?.travelMinutes ?? 0) - (pa?.travelMinutes ?? 0));
                return (
                  <div key={id} className="compare-row" style={{ borderTopColor: colorOfStaff.get(id) }}>
                    <button
                      type="button"
                      className={`compare-staff ${rs.focusStaff === id ? 'is-on' : ''}`}
                      aria-pressed={rs.focusStaff === id}
                      onClick={() => rs.focusOn(rs.focusStaff === id ? null : id)}
                      title={rs.focusStaff === id ? '地図を全員に戻す' : '地図でこの人のルートだけを見る'}
                    >
                      <strong className="col-head">
                        <span className="staff-dot" style={{ background: colorOfStaff.get(id) }} aria-hidden="true" />
                        {staffName(id)}
                      </strong>
                      <span className="sub">
                        <WithIcon icon={UserRound} size={13}>
                          {own(aRoutes, id)?.length ?? 0}件 → {own(bRoutes, id)?.length ?? 0}件
                        </WithIcon>
                      </span>
                      {pa && pb && (
                        <>
                          <span className="sub">
                            <WithIcon icon={Car} size={13}>
                              {r0(pa.travelMinutes)}分 → {r0(pb.travelMinutes)}分
                            </WithIcon>
                          </span>
                          <span className={`chip ${d < 0 ? 'chip-ok' : d > 0 ? 'chip-warn' : ''}`}>
                            {deltaText(d, '分')}
                          </span>
                        </>
                      )}
                    </button>
                    <div className="compare-col" data-side="A">
                      {stopCards(id, 'a')}
                    </div>
                    <div className="compare-col" data-side="B">
                      {stopCards(id, 'b')}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {(A.unassigned.length > 0 || B.unassigned.length > 0) && (
            <div className="card stack">
              <SectionTitle icon={CircleOff}>割り当てられなかった訪問</SectionTitle>
              {unassignedList(A, aExplain, 'A')}
              {unassignedList(B, bExplain, 'B')}
            </div>
          )}

          <div className="card stack" ref={mapCardRef}>
            <SectionTitle
              icon={MapIcon}
              aside={
                rs.focusStaff && (
                  <button type="button" className="btn btn-small" onClick={rs.clear}>
                    全員のルートを見る
                  </button>
                )
              }
            >
              地図{rs.focusStaff ? `：${staffName(rs.focusStaff)}` : ''}
            </SectionTitle>
            <RouteMap points={points} lines={lines} height={400} />
            <StaffLegend
              staffIds={staffIds}
              staffName={staffName}
              colorOfStaff={colorOfStaff}
              focusStaff={rs.focusStaff}
              onFocus={rs.focusOn}
              extra={
                <>
                  <span className="legend-item">
                    <span className="legend-line is-dashed" aria-hidden="true" />
                    A（点線）
                  </span>
                  <span className="legend-item">
                    <span className="legend-line legend-line-ink" aria-hidden="true" />
                    B（実線）
                  </span>
                  <span className="nowrap legend-item">「家」＝自宅</span>
                </>
              }
            />
          </div>
          <MapDock
            target={mapCardRef}
            points={points}
            lines={lines}
            title={`地図${rs.focusStaff ? `：${staffName(rs.focusStaff)}` : ''}（A 点線・B 実線）`}
            focusKey={rs.focusKey}
          />
        </>
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
  );
}
