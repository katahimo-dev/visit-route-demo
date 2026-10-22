import {
  CalendarDays,
  Car,
  Check,
  CircleOff,
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
import { EmptyNext } from '../components/EmptyNext';
import { FieldError } from '../components/FieldError';
import { MapDock } from '../components/MapDock';
import { RouteMap } from '../components/RouteMap';
import { LegLine, StaffLegend, VisitCard } from '../components/routeView';
import { StaffMarkById } from '../components/StaffMark';
import { Term } from '../components/Term';
import { useToast } from '../components/Toast';
import { Hint, IconButton, PageHeader, SectionTitle, Stat, WithIcon } from '../components/ui';
import type { Visit } from '../contracts/documents';
import type { Reason, VisitExplain } from '../contracts/problem';
import { HARDABLE, type Rule } from '../contracts/rules';
import { achievements, diff, hundredBreakdown, ruleLowerBounds, score, toHundred } from '../evaluate';
import { attempt, dateText, deltaText, formError, newId, own, pointsText, r0 } from '../lib/common';
import { pinsOf, routesOf, unassignedOf, writeRoutes } from '../lib/dayPlan';
import { compareEmptyGuide } from '../lib/emptyGuide';
import { narrowRole } from '../lib/narrowRoles';
import { buildRouteMap, homeLegKey, homeTravel, useRouteSelection } from '../lib/routeView';
import { type ScoreReason, scoreReason } from '../lib/scoreReason';
import { ownerMap, useDayModel } from '../lib/useDayModel';
import { compile, scheduleRoute } from '../matching';
import { applyPreset } from '../seed';
import { defaultIterations, runSolve } from '../solver';
import './plan.css';
import { CompareTable, explainMap, ReasonBox, RefMark, rulerText, SCORE_TEXT, ScoreReasonText } from './planParts';

/**
 * 提案を比べる（D19・D22・ADR-0005。版2は ADR-0053）：その日の「今の担当」と、この画面で作った提案（プリセットごと。保存しない）
 * から、任意の2つを A・B に選んで比べる。条件の差・合計と条件ごと・担当ごとの順番・地図（A 点線、B 実線）。
 * 提案は「当てる」で訪問の担当・開始に書く（ピンの訪問はそのまま）。採点は A・B とも点数の基準の物差し（ADR-0010）
 */

type Side = 'a' | 'b';
/** 比べる候補：今の担当・欠勤前（振り直す前の担当）・この画面で作った提案 */
type Choice = {
  id: string;
  title: string;
  kind: 'current' | 'before' | 'proposal';
  rules: Rule[];
  routes: Record<string, string[]>;
  unassigned: string[];
  /** 提案を作ったときのその日の訪問（変わったら当てられない） */
  visits?: readonly Visit[];
  stopped?: boolean;
};
const CURRENT = 'current';
const BEFORE = 'before';

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
  const navigate = useNavigate();
  /** 日の予定の「比較の画面で見る」（A＝欠勤前、B＝今の担当。ADR-0011） */
  const asked = (useLocation().state ?? null) as { a?: string; b?: string } | null;
  const [sel, setSel] = useState<{ a: string | null; b: string | null }>({ a: null, b: null });
  /** この画面で作った提案（保存しない。日付を変えると捨てる） */
  const [proposals, setProposals] = useState<{ date: string; list: Choice[] }>({ date, list: [] });
  const made = proposals.date === date ? proposals.list : [];
  // 日付を変えたら選んだ案・作った提案を外す（選んだ訪問・区間は useRouteSelection が外す）
  useEffect(() => {
    setSel({ a: null, b: null });
    setProposals({ date, list: [] });
  }, [date]);
  /** 地図で見る担当・強調する区間・選んだ訪問（予定の画面と共通。集まりのキーは 'a'・'b'） */
  const rs = useRouteSelection(date, (set, id) => (set === 'a' ? ownerA : ownerB).get(id));
  /** ページの中の地図のカード（画面の外なら右下に浮かせる） */
  const mapCardRef = useRef<HTMLDivElement>(null);

  const reassign = own(data.reassigns, date) ?? null;
  const choices: Choice[] = useMemo(() => {
    if (!problem) return [];
    const out: Choice[] = [];
    const ids = problem.visits.map((v) => v.id);
    if (reassign) {
      const placed = new Set(Object.values(reassign.baseRoutes).flat());
      out.push({
        id: BEFORE,
        title: '欠勤前（振り直す前の担当）',
        kind: 'before',
        rules: data.rules,
        routes: reassign.baseRoutes,
        unassigned: ids.filter((v) => !placed.has(v)),
      });
    }
    const routes = routesOf(problem, m.allVisits);
    out.push({
      id: CURRENT,
      title: '今の担当',
      kind: 'current',
      rules: data.rules,
      routes,
      unassigned: unassignedOf(problem, routes),
    });
    return [...out, ...made];
  }, [problem, m.allVisits, reassign, data.rules, made]);
  const byId = (id: string | null) => choices.find((c) => c.id === id);
  // 日の予定から「比較の画面で見る」で来たら、A＝欠勤前、B＝今の担当
  // biome-ignore lint/correctness/useExhaustiveDependencies: 来たときに1回だけ合わせる
  useEffect(() => {
    if (asked?.a !== 'before' || !reassign) return;
    setSel({ a: BEFORE, b: CURRENT });
  }, [asked]);
  // 既定：A＝今の担当、B＝最後に作った提案（無ければ欠勤前）
  const A = byId(sel.a) ?? byId(CURRENT);
  const others = choices.filter((c) => c.id !== A?.id);
  const B = byId(sel.b) ?? others.at(-1);
  /** A・B を選ぶ。もう一方と同じ案を選んだら入れ替える（同じ案どうしを比べない） */
  const pick = (side: Side, id: string) => {
    const other = side === 'a' ? B : A;
    const mine = side === 'a' ? A : B;
    if (mine?.id === id) return;
    if (other?.id === id) setSel(side === 'a' ? { a: id, b: mine?.id ?? null } : { a: mine?.id ?? null, b: id });
    else setSel((s) => ({ a: s.a ?? A?.id ?? null, b: s.b ?? B?.id ?? null, [side]: id }));
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
  /** 提案を作ったあとに訪問が変わったか（変わったら当てられない） */
  const stale = (c: Choice) =>
    !!c.visits && (c.visits.length !== m.allVisits.length || c.visits.some((v, i) => v !== m.allVisits[i]));

  const staffName = (id: string) => staffById.get(id)?.name ?? '（不明）';
  const clientOf = (visitId: string) => {
    const v = visitById.get(visitId);
    return v ? clientById.get(v.clientId) : undefined;
  };
  const visitLabel = (id: string) =>
    `${visitById.get(id)?.earliestStart ?? ''} ${clientOf(id)?.displayName ?? '（不明）'}`;

  // ---- 提案の操作（保存しない。決定2）----
  /** 提案を当てる：訪問の担当・開始に書く（ピンの訪問はそのまま） */
  const applyChoice = (c: Choice) => {
    if (!problem || c.kind !== 'proposal') return;
    if (stale(c)) {
      toast('提案を作ったあとに訪問が変わりました。もう一度作ってください');
      return;
    }
    const p = problem;
    update((d) => writeRoutes(d, date, p, c.routes));
    setProposals((x) => ({ ...x, list: x.list.filter((y) => y.id !== c.id) }));
    setSel({ a: null, b: null });
    rs.reset();
    toast(`${c.title}を当てました。日の予定の「元に戻す」は使えないので、戻すときは今の担当として比べ直してください`);
  };
  const removeChoice = (c: Choice) => {
    setProposals((x) => ({ ...x, list: x.list.filter((y) => y.id !== c.id) }));
    setSel((s) => ({ a: s.a === c.id ? null : s.a, b: s.b === c.id ? null : s.b }));
    rs.reset();
  };

  // ---- 提案を作る（PRD D159）：プリセット（考え方）を選び、ピンの訪問はそのままで AI で組む ----
  const [presetId, setPresetId] = useState('');
  const preset = data.presets.find((p) => p.id === presetId) ?? data.presets[0];
  /** 作っている提案（名前・進み具合）。null は作っていない */
  const [making, setMaking] = useState<{ date: string; name: string; iteration: number; total: number } | null>(null);
  const [makeError, setMakeError] = useState<string | null>(null);
  const makeRef = useRef<{ stop(): void } | null>(null);
  /** 計算の世代。画面を離れると進め、前の世代の結果は捨てる（日の画面と同じ） */
  const makeGen = useRef(0);
  useEffect(
    () => () => {
      makeGen.current++;
      makeRef.current?.stop();
      makeRef.current = null;
    },
    [],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: 日付を変えたら前の日の知らせを消し、作っている計算は止めて捨てる
  useEffect(() => {
    setMakeError(null);
    if (makeRef.current) {
      makeGen.current++;
      makeRef.current.stop();
      makeRef.current = null;
      setMaking(null);
      toast('日付を変えたので、作っていた提案をやめました');
    }
  }, [date]);
  const makeProposal = () => {
    if (!preset || makeRef.current) return;
    setMakeError(null);
    const rules = applyPreset(data.rules, preset);
    const name = `「${preset.name}」`;
    const pins = pinsOf(m.allVisits);
    const target = attempt(() => compile({ ...data, rules }, date, Object.keys(pins).length > 0 ? pins : undefined));
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
    const startVisits = m.allVisits;
    const gen = makeGen.current;
    const live = () => gen === makeGen.current;
    const started = attempt(() =>
      runSolve(p, { seed: data.seed, iterations: defaultIterations(p) }, (x) => {
        if (live()) setMaking((v) => (v ? { ...v, iteration: x.iteration, total: x.total } : v));
      }),
    );
    if (!started.value) {
      setMakeError(started.error ?? '提案を作れませんでした');
      return;
    }
    makeRef.current = started.value;
    setMaking({ date: forDate, name, iteration: 0, total: 0 });
    started.value.promise
      .then((result) => {
        if (!live()) return;
        const id = newId('pr');
        const c: Choice = {
          id,
          title: `${name}の提案`,
          kind: 'proposal',
          rules,
          routes: result.routes,
          unassigned: result.unassigned,
          visits: startVisits,
          stopped: result.stopped,
        };
        setProposals((x) => ({ date: forDate, list: x.date === forDate ? [...x.list, c] : [c] }));
        setSel({ a: CURRENT, b: id });
        rs.reset();
        toast(
          result.stopped ? `途中までの最良で${c.title}を作りました` : `${c.title}を作りました。A と B に並べています`,
        );
      })
      .catch((e) => {
        if (live()) setMakeError(`提案を作れませんでした（${formError(e)}）`);
      })
      .finally(() => {
        if (!live()) return;
        makeRef.current = null;
        setMaking(null);
      });
  };
  /** 作れないときの理由 */
  const makeWhy = !problem
    ? 'この日に計算できる訪問がありません'
    : data.presets.length === 0
      ? '考え方（プリセット）がありません。条件の画面で作ってください'
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
    const name = other ? staffName(other) : '担当なし';
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
                      守れない条件
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
        title="提案を比べる"
        lead="今の担当と、考え方（プリセット）ごとに作った提案を2つ選んで比べます。提案は保存しません。よければ「当てる」"
        actions={
          <NavLink to="/plan" className="plan-compare-link">
            <WithIcon icon={CalendarDays}>{dateText(date)}の予定に戻る</WithIcon>
          </NavLink>
        }
      />
      <FieldError>{m.problemError && `問題を作れませんでした：${m.problemError}`}</FieldError>

      <div className="card stack">
        <SectionTitle
          icon={History}
          aside={
            <span className="row" style={{ gap: 6 }}>
              <span className="sub" data-testid="score-ruler">
                <Term k="scoreBase" />：{scoreRulerName}
              </span>
              <Hint>
                <ul className="hint-list">
                  <li>提案はこの画面にいるあいだだけ残ります（保存しません。日付を変えると消えます）。</li>
                  <li>{rulerText(scoreRulerName)}。</li>
                  <li>点数は、{SCORE_TEXT}です。高いほど良い組み方です。</li>
                </ul>
              </Hint>
            </span>
          }
        >
          比べる担当（{choices.length}件）
        </SectionTitle>
        {choices.length === 0 ? (
          // 空の画面（PRD D176）：なぜ空かと次の一手（日の画面で作る・月のまとめて作る）
          <EmptyNext
            guide={compareEmptyGuide({ date })}
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
                  <th {...narrowRole.columnheader}>担当</th>
                  <th {...narrowRole.columnheader}>種類</th>
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
                      <td {...narrowRole.cell} className="narrow-title" data-label="担当">
                        {c.title}
                        {c.stopped && <span className="sub">（途中で止めた提案）</span>}
                        {stale(c) && (
                          <span className="chip chip-warn" style={{ marginLeft: 6 }} data-testid="compare-stale">
                            訪問が変わりました
                          </span>
                        )}
                      </td>
                      <td {...narrowRole.cell} className="nowrap sub" data-label="種類">
                        {c.kind === 'current'
                          ? '保存している担当'
                          : c.kind === 'before'
                            ? '振り直す前'
                            : '提案（保存しない）'}
                      </td>
                      <td className="num" data-label="合計点">
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
                        {c.kind === 'proposal' && (
                          <div className="actions">
                            <button
                              type="button"
                              className="btn btn-small btn-primary"
                              aria-disabled={stale(c) || undefined}
                              onClick={() => applyChoice(c)}
                              data-testid="compare-apply"
                            >
                              <WithIcon icon={Check} size={14}>
                                当てる
                              </WithIcon>
                            </button>
                            <IconButton
                              icon={Trash2}
                              label={`${c.title} を消す`}
                              tone="danger"
                              onClick={() => removeChoice(c)}
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
        {problem && (
          <div className="compare-another stack" data-testid="compare-another">
            {choices.length === 1 && (
              <p className="sub">比べるには2つ要ります。考え方を選んで提案を作ると、今の担当と並べられます。</p>
            )}
            {makeWhy ? (
              <p className="sub" data-testid="compare-another-why">
                {makeWhy}
              </p>
            ) : (
              preset && (
                <div className="compare-another-row">
                  <label className="compare-another-pick">
                    <span className="sub">考え方</span>
                    <select
                      value={preset.id}
                      onChange={(e) => setPresetId(e.target.value)}
                      disabled={!!making}
                      data-testid="compare-another-select"
                    >
                      {data.presets.map((o) => (
                        <option key={o.id} value={o.id}>
                          「{o.name}」
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!!making}
                    onClick={makeProposal}
                    data-testid="compare-another-make"
                  >
                    <WithIcon icon={Sparkles}>提案を作って比べる</WithIcon>
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
                  aria-label={`${making.name}の提案の進み具合`}
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
            <FieldError>{makeError}</FieldError>
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
            <p className="sub">下の点数は、A・B とも「{scoreRulerName}」の重みで付けています。</p>
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
                  <ul className="hint-list">
                    <li>訪問を押すと、その担当になった理由が出て、地図でその訪問先が目立ちます。</li>
                    <li>{terms.staff}の名前を押すと、地図がその人だけになります。もう一度押すと全員に戻ります。</li>
                    <li>
                      「自宅から」「自宅まで」や移動の分を押すと、地図でその道のりが目立ちます。A は点線、B は実線です。
                    </li>
                  </ul>
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
                        <StaffMarkById id={id} size="sm" />
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
