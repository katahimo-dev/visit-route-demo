import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useDay } from '../app/day';
import { ClientName } from '../components/parts';
import { type MapLine, type MapPoint, RouteMap } from '../components/RouteMap';
import type { AiPlan } from '../contracts/data';
import type { Reason, VisitExplain } from '../contracts/problem';
import { minutesToHhmm } from '../domain/time';
import { diff, score } from '../evaluate';
import { colorOf, initialOf } from '../lib/colors';
import { AI_LINE, attempt, deltaText, hasLocation, MANUAL_LINE, pointsText, r0 } from '../lib/common';
import { ownerMap, routesOf, useDayModel } from '../lib/useDayModel';
import { scheduleRoute } from '../matching';
import { CompareTable, explainMap, ReasonBox } from './planParts';

/**
 * 比較（D19）：手作業案とAI案（手直し後の今の案）を並べて比べ、理由を見る（PoC本体 PlanPage.tsx を写した）。
 * 担当ごとに1行で、左に手作業案、右に AI案。採点は手作業案もAI案も、いまの条件の同じ物差し（evaluate.score）。
 * AI案を作る・手直し・採用は「AI案」の画面（#/plan）
 */

type Side = 'manual' | 'ai';

export default function ComparePage() {
  const { date } = useDay();
  const m = useDayModel(date);
  const { data, staff, staffById, clientById, colorOfStaff, visits, visitById, problem } = m;
  const terms = data.org.terms;
  const [picked, setPicked] = useState<{ visitId: string; side: Side } | null>(null);
  const [mapStaff, setMapStaff] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 日付を変えたら選んだ訪問を外す
  useEffect(() => {
    setPicked(null);
  }, [date]);

  const aiPlan: AiPlan | undefined = data.aiPlans[date];
  const prevPlan: AiPlan | undefined = data.prevAiPlans[date];
  const manualRoutes = useMemo(() => routesOf(m.savedView.cols), [m.savedView]);
  const aiRoutes = useMemo(() => aiPlan?.routes ?? {}, [aiPlan]);

  const manualScore = useMemo(
    () => (problem ? attempt(() => score(problem, manualRoutes)) : null),
    [problem, manualRoutes],
  );
  const aiScore = useMemo(
    () => (problem && aiPlan ? attempt(() => score(problem, aiRoutes)) : null),
    [problem, aiPlan, aiRoutes],
  );
  const manualExplain = useMemo(() => explainMap(problem, manualRoutes), [problem, manualRoutes]);
  const aiExplain = useMemo(
    () => (aiPlan ? explainMap(problem, aiRoutes) : new Map<string, VisitExplain>()),
    [problem, aiPlan, aiRoutes],
  );
  const prevDiff = useMemo(
    () => (problem && aiPlan && prevPlan ? attempt(() => diff(problem, prevPlan.routes, aiPlan.routes)) : null),
    [problem, aiPlan, prevPlan],
  );
  const pinCount = Object.keys(aiPlan?.pins ?? {}).length;
  const edited = !!aiPlan && JSON.stringify(aiPlan.routes) !== JSON.stringify(aiPlan.generated.routes);
  /** AI案を作ったあとに条件（重み・必須）が変わったか */
  const stale = !!aiPlan && JSON.stringify(aiPlan.rules) !== JSON.stringify(data.rules);

  const staffName = (id: string) => staffById.get(id)?.name ?? '（不明）';
  const clientOf = (visitId: string) => {
    const v = visitById.get(visitId);
    return v ? clientById.get(v.clientId) : undefined;
  };
  const visitLabel = (id: string) =>
    `${visitById.get(id)?.earliestStart ?? ''} ${clientOf(id)?.displayName ?? '（不明）'}`;

  // ---- 担当ごとの比較 ----
  const staffIds = useMemo(() => {
    const ids = new Set(
      [...Object.entries(manualRoutes), ...Object.entries(aiRoutes)].filter(([, v]) => v.length > 0).map(([k]) => k),
    );
    const order = staff.map((s) => s.id).filter((id) => ids.has(id));
    return [...order, ...[...ids].filter((id) => !order.includes(id))];
  }, [manualRoutes, aiRoutes, staff]);
  const ownerManual = useMemo(() => ownerMap(manualRoutes), [manualRoutes]);
  const ownerAi = useMemo(() => ownerMap(aiRoutes), [aiRoutes]);
  const mapStaffId = mapStaff && staffIds.includes(mapStaff) ? mapStaff : (staffIds[0] ?? null);

  /** 1人のルートの移動・待ち（lenient。未実装・対象外なら null） */
  const routeTotals = (staffId: string, ids: string[]) => {
    if (!problem) return null;
    const si = problem.staff.findIndex((s) => s.id === staffId);
    if (si < 0) return null;
    const idx = ids.map((id) => problem.visits.findIndex((v) => v.id === id)).filter((i) => i >= 0);
    return attempt(() => scheduleRoute(problem, si, idx, 'lenient')).value;
  };

  const movedLabel = (visitId: string, staffId: string, side: Side): string | null => {
    if (!aiPlan) return null;
    if (side === 'ai') {
      const before = ownerManual.get(visitId);
      if (before === staffId) return null;
      return before ? `← ${staffName(before)}から` : '← 未割当から';
    }
    const after = ownerAi.get(visitId);
    if (after === staffId) return null;
    return after ? `→ AIでは ${staffName(after)}` : '→ AIでは未割当';
  };

  const inProblemStaff = new Set(problem?.staff.map((s) => s.id) ?? []);
  const stopCards = (staffId: string, side: Side) => {
    const ids = (side === 'manual' ? manualRoutes : aiRoutes)[staffId] ?? [];
    if (ids.length === 0) return <span className="sub">訪問なし</span>;
    const ex = side === 'manual' ? manualExplain : aiExplain;
    return (
      <div className="stack" style={{ gap: 0 }}>
        {problem && !inProblemStaff.has(staffId) && (
          <span className="chip chip-red" style={{ alignSelf: 'flex-start' }}>
            この日は計算に入れていません（休み・休止中など）
          </span>
        )}
        {ids.map((id, i) => {
          const e = ex.get(id);
          const t = e?.timing ?? null;
          const isPicked = picked?.visitId === id && picked.side === side;
          const moved = movedLabel(id, staffId, side);
          const hard = (side === 'manual' ? manualScore : aiScore)?.value?.hardViolations.some((h) => h.visitId === id);
          return (
            <div key={id}>
              {t && (
                <div className="leg-line">
                  {i === 0 ? '自宅から ' : '↓ 移動 '}
                  {r0(t.travelIn)}分{t.wait > 0 && `（待ち ${r0(t.wait)}分）`}
                </div>
              )}
              <button
                type="button"
                className={`route-item route-btn ${hard ? 'is-red' : moved ? 'is-moved' : ''} ${isPicked ? 'is-picked' : ''}`}
                onClick={() => setPicked(isPicked ? null : { visitId: id, side })}
                title="押すと理由を見られます"
              >
                <span className="sub nowrap">
                  {t ? `${minutesToHhmm(t.start)}〜${minutesToHhmm(t.end)}` : (visitById.get(id)?.earliestStart ?? '')}
                </span>
                <ClientName client={clientOf(id)} />
                {moved && <span className="chip chip-move">{moved}</span>}
                {hard && <span className="chip chip-red">必須の違反</span>}
              </button>
              {isPicked && <ReasonBox explain={e} />}
            </div>
          );
        })}
      </div>
    );
  };

  // ---- 地図：選んだ担当の手作業案（点線）とAI案（実線）----
  const { points, lines } = useMemo(() => {
    const pts: MapPoint[] = [];
    const lns: MapLine[] = [];
    if (!mapStaffId) return { points: pts, lines: lns };
    const s = staffById.get(mapStaffId);
    const home = s && hasLocation(s.home) ? { lat: s.home.lat, lng: s.home.lng } : null;
    if (home) pts.push({ ...home, label: '家', color: '#8a7a70' });
    const pathOf = (ids: string[]) => {
      const path: { lat: number; lng: number }[] = home ? [home] : [];
      for (const id of ids) {
        const c = clientById.get(visitById.get(id)?.clientId ?? '');
        if (!c || !hasLocation(c.place)) continue;
        path.push({ lat: c.place.lat, lng: c.place.lng });
        if (!pts.some((p) => p.lat === c.place.lat && p.lng === c.place.lng)) {
          pts.push({ lat: c.place.lat, lng: c.place.lng, label: initialOf(c.displayName), color: colorOf(c.color) });
        }
      }
      if (home && path.length > 1) path.push(home);
      return path;
    };
    lns.push({ points: pathOf(manualRoutes[mapStaffId] ?? []), color: MANUAL_LINE, dashed: true });
    if (aiPlan) lns.push({ points: pathOf(aiRoutes[mapStaffId] ?? []), color: AI_LINE });
    return { points: pts, lines: lns };
  }, [mapStaffId, staffById, visitById, clientById, manualRoutes, aiRoutes, aiPlan]);

  // ---- 入らなかった訪問・計算に入れなかった訪問 ----
  const infeasibleOf = useMemo(() => {
    const out = new Map<string, Reason[]>();
    for (const f of problem?.infeasible ?? []) {
      const v = problem?.visits[f.visit];
      if (v) out.set(v.id, f.reasons);
    }
    return out;
  }, [problem]);
  const notInProblem = problem ? visits.filter((v) => !problem.visits.some((p) => p.id === v.id)) : [];

  const ms = manualScore?.value ?? null;
  const as = aiScore?.value ?? null;

  return (
    <div className="stack" style={{ minWidth: 0 }}>
      <h2>手作業案とAI案の比較</h2>
      {m.problemError && <p className="error">問題を作れませんでした：{m.problemError}</p>}
      {stale && (
        <p className="warn-text">
          AI案を作ったあとに条件が変わりました。点数はいまの条件で付け直しています。「AI案」の画面で作り直せます。
        </p>
      )}
      {!aiPlan ? (
        <div className="card">
          <p className="sub">
            この日のAI案はまだありません。<NavLink to="/plan">AI案</NavLink>の画面で「AI案を作る」を押してください。
          </p>
        </div>
      ) : (
        <>
          <div className="card stack">
            <div className="spread" style={{ flexWrap: 'wrap' }}>
              <h3>合計と条件ごと</h3>
              <span className="sub">
                AI案は{edited ? '手直し後の今の案' : 'AIが出したまま'}
                {pinCount > 0 && `（固定 ${pinCount}件）`}。採用は<NavLink to="/plan">AI案</NavLink>の画面で
              </span>
            </div>
            {prevDiff?.value && (
              <p className="sub">
                前回のAI案との差：担当が変わった訪問 {prevDiff.value.changedVisits.length}件・移動{' '}
                {deltaText(prevDiff.value.travelDelta, '分')}・合計点 {deltaText(prevDiff.value.scoreDelta, '点')}
              </p>
            )}
            <CompareTable manual={ms} ai={as} rules={data.rules} error={manualScore?.error ?? aiScore?.error} />
          </div>

          <div className="card stack">
            <h3>{terms.staff}ごとの比較（左：手作業案、右：AI案）</h3>
            <p className="sub">訪問を押すと、その担当になった理由（点の内訳）が出ます。</p>
            <div className="compare">
              <div className="compare-row compare-header">
                <div />
                <div>手作業案（予定画面の割当）</div>
                <div>AI案{edited ? '（手直し後）' : ''}</div>
              </div>
              {staffIds.map((id) => {
                const pm = routeTotals(id, manualRoutes[id] ?? []);
                const pa = routeTotals(id, aiRoutes[id] ?? []);
                const d = r0((pa?.travelMinutes ?? 0) - (pm?.travelMinutes ?? 0));
                return (
                  <div key={id} className="compare-row" style={{ borderTopColor: colorOfStaff.get(id) }}>
                    <button
                      type="button"
                      className={`compare-staff ${mapStaffId === id ? 'is-on' : ''}`}
                      onClick={() => setMapStaff(id)}
                      title="地図で見る"
                    >
                      <strong style={{ color: colorOfStaff.get(id) }}>{staffName(id)}</strong>
                      <span className="sub">
                        {manualRoutes[id]?.length ?? 0}件 → {aiRoutes[id]?.length ?? 0}件
                      </span>
                      {pm && pa && (
                        <>
                          <span className="sub">
                            移動 {r0(pm.travelMinutes)}分 → {r0(pa.travelMinutes)}分
                          </span>
                          <span className={`chip ${d < 0 ? 'chip-ok' : d > 0 ? 'chip-warn' : ''}`}>
                            {deltaText(d, '分')}
                          </span>
                        </>
                      )}
                    </button>
                    <div className="compare-col">{stopCards(id, 'manual')}</div>
                    <div className="compare-col">{stopCards(id, 'ai')}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {aiPlan.unassigned.length > 0 && (
            <div className="card stack">
              <h3>AI案で割り当てられなかった訪問</h3>
              {aiPlan.unassigned.map((id) => {
                const inf = infeasibleOf.get(id);
                const ex = aiExplain.get(id);
                const reasons = inf ?? ex?.reasons ?? [];
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
          )}

          <div className="card stack">
            <div className="spread">
              <h3>地図：{mapStaffId ? staffName(mapStaffId) : ''}（点線：手作業、実線：AI）</h3>
              <span className="sub">上の比較で{terms.staff}の名前を押すと切り替わります</span>
            </div>
            <RouteMap points={points} lines={lines} height={400} />
            <div className="row sub">
              <span style={{ color: MANUAL_LINE }}>- - - 手作業</span>
              <span style={{ color: AI_LINE }}>━━ AI</span>
            </div>
          </div>
        </>
      )}

      {problem && problem.infeasible.length > 0 && !aiPlan && (
        <div className="card stack">
          <h3>どの{terms.staff}も担当できない訪問</h3>
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
          <h3>計算に入れなかった訪問</h3>
          <p className="sub">
            {terms.client}が休止中・位置が未登録などの訪問です（{terms.client}の画面で直せます）。
          </p>
          {notInProblem.map((v) => (
            <span key={v.id}>{visitLabel(v.id)}</span>
          ))}
        </div>
      )}
    </div>
  );
}
