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
  Trash2,
  TriangleAlert,
  UserRound,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useDay } from '../app/day';
import { MapDock } from '../components/MapDock';
import { RouteMap } from '../components/RouteMap';
import { LegLine, StaffLegend, VisitCard } from '../components/routeView';
import { useToast } from '../components/Toast';
import { Empty, Hint, IconButton, PageHeader, SectionTitle, Stat, WithIcon } from '../components/ui';
import type { AiPlan, AiRun } from '../contracts/data';
import type { Reason, VisitExplain } from '../contracts/problem';
import { HARDABLE, type Rule } from '../contracts/rules';
import { diff, score, toHundred } from '../evaluate';
import { attempt, deltaText, own, pointsText, r0 } from '../lib/common';
import { buildRouteMap, homeLegKey, homeTravel, useRouteSelection } from '../lib/routeView';
import { planOfRun } from '../lib/runs';
import { ownerMap, useDayModel } from '../lib/useDayModel';
import { scheduleRoute } from '../matching';
import './plan.css';
import { CompareTable, explainMap, ReasonBox, RefMark, SCORE_TEXT } from './planParts';

/**
 * 比較（D19・D22・ADR-0005）：その日のAI案の記録（作るたびに条件と結果を残したもの）と「今の案」から、
 * 任意の2つを A・B に選んで比べる。条件の差・合計と条件ごと・担当ごとの順番・地図（A 点線、B 実線）。
 * 採点は A・B とも、いまの条件の同じ物差し（evaluate.score）。AI案を作る・手直しは「予定」の画面（#/plan）
 */

type Side = 'a' | 'b';
/** 比べる候補：記録1件か、今の案（予定の画面の手直し後） */
type Choice = { id: string; title: string; rules: Rule[]; routes: Record<string, string[]>; unassigned: string[] };
const CURRENT = 'current';

/** 条件の重みの短い表示（例「重み3」「必須」「無効」） */
function weightText(r: Rule | undefined): string {
  if (!r) return '（なし）';
  if (r.hard && HARDABLE.has(r.type)) return r.type === 'balance' ? `必須・重み${r.weight}` : '必須';
  return r.weight === 0 ? '無効' : `重み${r.weight}`;
}

export default function ComparePage() {
  const { date } = useDay();
  const m = useDayModel(date);
  const { data, update, staff, staffById, clientById, colorOfStaff, visits, visitById, problem, scale } = m;
  const terms = data.org.terms;
  const toast = useToast();
  const navigate = useNavigate();
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
  const aiPlan: AiPlan | undefined = own(data.aiPlans, date);
  const choices: Choice[] = useMemo(() => {
    const out: Choice[] = runs.map((r) => ({
      id: r.id,
      title: `#${r.no} ${r.label}`,
      rules: r.rules,
      routes: r.routes,
      unassigned: r.unassigned,
    }));
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
  }, [runs, aiPlan]);
  const byId = (id: string | null) => choices.find((c) => c.id === id);
  // 既定：A＝最初の記録、B＝A 以外の最後の記録（無ければ今の案）
  const A = byId(sel.a) ?? choices[0];
  const others = choices.filter((c) => c.id !== A?.id);
  const B = byId(sel.b) ?? others.filter((c) => c.id !== CURRENT).at(-1) ?? others.at(-1);
  /** A・B を選ぶ。もう一方と同じ案を選んだら入れ替える（同じ案どうしを比べない） */
  const pick = (side: Side, id: string) => {
    const other = side === 'a' ? B : A;
    const mine = side === 'a' ? A : B;
    if (other?.id === id) setSel(side === 'a' ? { a: id, b: mine?.id ?? null } : { a: mine?.id ?? null, b: id });
    else setSel((s) => ({ ...s, [side]: id }));
  };
  const aRoutes = useMemo(() => A?.routes ?? {}, [A]);
  const bRoutes = useMemo(() => B?.routes ?? {}, [B]);

  // ---- 採点（いまの条件の同じ物差し）----
  const scores = useMemo(
    () => new Map(choices.map((c) => [c.id, problem ? attempt(() => score(problem, c.routes)) : null])),
    [choices, problem],
  );
  const aScore = A ? (scores.get(A.id) ?? null) : null;
  const bScore = B ? (scores.get(B.id) ?? null) : null;
  const aExplain = useMemo(() => explainMap(A ? problem : null, aRoutes), [problem, A, aRoutes]);
  const bExplain = useMemo(() => explainMap(B ? problem : null, bRoutes), [problem, B, bRoutes]);
  const abDiff = useMemo(
    () => (problem && A && B ? attempt(() => diff(problem, aRoutes, bRoutes)) : null),
    [problem, A, B, aRoutes, bRoutes],
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
  const openRun = (r: AiRun) => {
    if (
      aiPlan &&
      (Object.keys(aiPlan.pins).length > 0 ||
        JSON.stringify(aiPlan.routes) !== JSON.stringify(aiPlan.generated.routes)) &&
      !confirm('予定の画面の手直しを捨てて、この記録を今の案にします。よろしいですか？')
    )
      return;
    update((d) => ({ ...d, aiPlans: { ...d.aiPlans, [date]: planOfRun(r) } }));
    toast(`#${r.no} を今の案にしました`);
    navigate('/plan');
  };
  const applyRules = (r: AiRun) => {
    if (!confirm(`条件の重み・必須を #${r.no} を作ったときと同じにします。よろしいですか？`)) return;
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
  const removeRun = (r: AiRun) => {
    if (!confirm(`記録 #${r.no}「${r.label}」を消しますか？`)) return;
    update((d) => ({
      ...d,
      aiRuns: { ...d.aiRuns, [date]: (own(d.aiRuns, date) ?? []).filter((x) => x.id !== r.id) },
    }));
    // 消した記録を選んでいたら既定に戻す
    setSel((s) => ({ a: s.a === r.id ? null : s.a, b: s.b === r.id ? null : s.b }));
  };

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
        title="比較"
        lead="条件を変えたAI案を2つ選んで比べます"
        actions={
          <NavLink to="/plan" className="plan-compare-link">
            <WithIcon icon={CalendarDays}>予定へ</WithIcon>
          </NavLink>
        }
      />
      {m.problemError && <p className="error">問題を作れませんでした：{m.problemError}</p>}

      <div className="card stack">
        <SectionTitle
          icon={History}
          aside={
            <Hint>
              予定の画面でAI案を作る・組み直すたびに、条件と結果が残ります。合計点は、いまの条件の同じ物差しで付け直した点です（高いほど良い。
              {SCORE_TEXT}）。理想（届かない下限）は100点です。
            </Hint>
          }
        >
          この日の記録（{runs.length}件）
        </SectionTitle>
        {choices.length === 0 ? (
          <Empty icon={History}>
            この日の記録はまだありません。<NavLink to="/plan">予定</NavLink>
            の画面を開くと、標準の条件で自動で作ります。
          </Empty>
        ) : (
          <div className="table-scroll">
            <table className="compare-table runs-table">
              <thead>
                <tr>
                  <th className="ab-col">A</th>
                  <th className="ab-col">B</th>
                  <th>案</th>
                  <th>作った時刻</th>
                  <th className="num">合計点</th>
                  <th className="num">移動</th>
                  <th className="num">入らない</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {choices.map((c) => {
                  const run = runs.find((r) => r.id === c.id);
                  const sc = scores.get(c.id)?.value ?? null;
                  return (
                    <tr key={c.id} className={`${A?.id === c.id ? 'is-a' : ''} ${B?.id === c.id ? 'is-b' : ''}`}>
                      <td className="ab-col">
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
                      <td className="ab-col">
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
                      <td>
                        {c.title}
                        {run?.stopped && <span className="sub">（途中で止めた案）</span>}
                        {run && <div className="weights-text">乱数の種 {run.seed}</div>}
                      </td>
                      <td className="nowrap sub">
                        {run
                          ? new Date(run.createdAt).toLocaleString('ja-JP', {
                              timeZone: 'Asia/Tokyo',
                              month: 'numeric',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '手直しを含む'}
                      </td>
                      <td className="num" title={sc ? `費用 ${r0(sc.total)}（内部の値）` : undefined}>
                        {sc && scale ? `${toHundred(sc.total, scale)}点` : '—'}
                        {sc && scale && <RefMark hard={sc.hardViolations.length} />}
                      </td>
                      <td className="num">{sc ? `${r0(sc.travelMinutes)}分` : '—'}</td>
                      <td className="num">{sc ? `${sc.dropped}件` : '—'}</td>
                      <td className="nowrap">
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
        {choices.length === 1 && (
          <Empty icon={GitCompareArrows}>
            比べるには案が2つ以上いります。<NavLink to="/plan">予定</NavLink>
            の画面でプリセットを押すか、重みを変えて「AI案を作り直す」を押してください。
          </Empty>
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
                <Hint>下の点数は A・B ともいまの条件で付け直しています。</Hint>
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
