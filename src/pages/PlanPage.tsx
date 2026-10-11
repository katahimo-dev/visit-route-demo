import { useEffect, useMemo, useRef, useState } from 'react';
import { useDay } from '../app/day';
import { ClientName, WeightSlider } from '../components/parts';
import { type MapLine, type MapPoint, RouteMap } from '../components/RouteMap';
import { useToast } from '../components/Toast';
import type { AiPlan } from '../contracts/data';
import type { PlanScore, Problem, Reason, VisitExplain } from '../contracts/problem';
import { HARDABLE } from '../contracts/rules';
import { NONE } from '../domain/scheduleModel';
import { minutesToHhmm } from '../domain/time';
import { diff, explain, score } from '../evaluate';
import { colorOf, initialOf } from '../lib/colors';
import { AI_LINE, attempt, deltaText, formError, hasLocation, MANUAL_LINE, pointsText, r0, r1 } from '../lib/common';
import { ownerMap, routesOf, useDayModel } from '../lib/useDayModel';
import { scheduleRoute } from '../matching';
import { defaultIterations, runSolve } from '../solver';
import { useDemoData } from '../store';

/**
 * AI案：作る・手作業案と並べて比べる・理由を見る・採用する（PoC本体 PlanPage.tsx を写した）。
 * 担当ごとに1行で、左に手作業案、右に AI案。採点は手作業案もAI案も、いまの条件の同じ物差し（evaluate.score）
 */

type Progress = { iteration: number; total: number; bestScore: number };
type Side = 'manual' | 'ai';

export default function PlanPage() {
  const { date } = useDay();
  const m = useDayModel(date);
  const { data, update, staff, staffById, clientById, colorOfStaff, visits, visitById, problem } = m;
  const terms = data.org.terms;
  const toast = useToast();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ visitId: string; side: Side } | null>(null);
  const [mapStaff, setMapStaff] = useState<string | null>(null);
  const runRef = useRef<{ stop(): void } | null>(null);
  const mounted = useRef(true);

  // 画面を離れたら Worker を止める（止めた結果は保存しない）
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      runRef.current?.stop();
      runRef.current = null;
    };
  }, []);
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
  /** AI案を作ったあとに条件（重み・必須）が変わったか */
  const stale = !!aiPlan && JSON.stringify(aiPlan.rules) !== JSON.stringify(data.rules);

  const staffName = (id: string) => staffById.get(id)?.name ?? '（不明）';
  const clientOf = (visitId: string) => {
    const v = visitById.get(visitId);
    return v ? clientById.get(v.clientId) : undefined;
  };
  const visitLabel = (id: string) =>
    `${visitById.get(id)?.earliestStart ?? ''} ${clientOf(id)?.displayName ?? '（不明）'}`;

  // ---- AI案を作る（compile → runSolve）----
  const create = () => {
    setError(null);
    if (!problem) {
      setError(m.problemError ?? '問題を作れませんでした');
      return;
    }
    if (problem.visits.length === 0) {
      setError('この日に計算できる訪問がありません');
      return;
    }
    if (problem.staff.length === 0) {
      setError(`この日に働ける${terms.staff}がいません`);
      return;
    }
    const forDate = date;
    const rulesSnapshot = data.rules;
    const started = attempt(() =>
      runSolve(problem, { seed: data.seed, iterations: defaultIterations(problem) }, (p) => {
        if (mounted.current) setProgress(p);
      }),
    );
    if (!started.value) {
      setError(started.error);
      return;
    }
    runRef.current = started.value;
    setRunning(true);
    setProgress(null);
    started.value.promise
      .then((result) => {
        if (!mounted.current) return;
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
        };
        update((d) => {
          const prev = d.aiPlans[forDate];
          return {
            ...d,
            aiPlans: { ...d.aiPlans, [forDate]: plan },
            prevAiPlans: prev ? { ...d.prevAiPlans, [forDate]: prev } : d.prevAiPlans,
          };
        });
        toast(result.stopped ? '途中までの最良の案を保存しました' : 'AI案を作りました');
      })
      .catch((e) => {
        if (mounted.current) setError(`AI案を作れませんでした（${formError(e)}）`);
      })
      .finally(() => {
        runRef.current = null;
        if (mounted.current) {
          setRunning(false);
          setProgress(null);
        }
      });
  };
  const stop = () => runRef.current?.stop();

  // ---- この案を採用（D13）：manualPlans と visits.staffId に写す ----
  const adopt = () => {
    if (!aiPlan || !problem) return;
    if (
      !confirm(
        'このAI案を手作業案に写します。予定画面の割当（各訪問の担当）が書き換わります。よろしいですか？\n（計算に入れていない訪問の担当はそのままです）',
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
      cols[o] = [...(cols[o] ?? []), v.id];
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
    toast('AI案を手作業案に写しました');
  };

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
    <div className="plan-layout">
      <div className="stack" style={{ minWidth: 0 }}>
        <h2>AI案</h2>
        <div className="card stack">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" disabled={running || !problem} onClick={create}>
              {running ? '作っています…' : 'AI案を作る'}
            </button>
            {running && (
              <button type="button" className="btn" onClick={stop}>
                止める
              </button>
            )}
            {aiPlan && !running && (
              <span className="sub">
                {new Date(aiPlan.createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} に作成（乱数の種{' '}
                {aiPlan.seed}・{aiPlan.iterations.toLocaleString()}回{aiPlan.stopped && '・途中で止めた案'}）
              </span>
            )}
          </div>
          {running && (
            <div className="stack" style={{ gap: 4 }}>
              <progress value={progress?.iteration ?? 0} max={progress?.total ?? 1} style={{ width: '100%' }} />
              <span className="sub">
                {progress
                  ? `${progress.iteration.toLocaleString()} / ${progress.total.toLocaleString()} 回・いまの最良 ${r0(progress.bestScore)}点`
                  : '準備中…'}
              </span>
            </div>
          )}
          {m.problemError && <p className="error">問題を作れませんでした：{m.problemError}</p>}
          {error && <p className="error">{error}</p>}
          {stale && (
            <p className="warn-text">
              このAI案を作ったあとに条件が変わりました。点数はいまの条件で付け直しています。「再計算」で作り直せます。
            </p>
          )}
        </div>

        {!aiPlan ? (
          <div className="card">
            <p className="sub">この日のAI案はまだありません。「AI案を作る」を押してください。</p>
          </div>
        ) : (
          <>
            <div className="card stack">
              <div className="spread" style={{ flexWrap: 'wrap' }}>
                <h3>手作業案とAI案の比較</h3>
                <button type="button" className="btn btn-primary" disabled={running} onClick={adopt}>
                  この案を採用
                </button>
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
                  <div>AI案</div>
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

      <WeightPanel running={running} onRecalc={create} canRun={!!problem} />
    </div>
  );
}

/** routes の訪問ごとの説明（未実装なら空） */
function explainMap(problem: Problem | null, routes: Record<string, string[]>): Map<string, VisitExplain> {
  if (!problem) return new Map();
  const r = attempt(() => explain(problem, routes));
  return new Map((r.value ?? []).map((e) => [e.visitId, e]));
}

/** 訪問カードを押したときの理由（例「相性◎ −30」「移動12分 +12」） */
function ReasonBox({ explain: e }: { explain: VisitExplain | undefined }) {
  if (!e) return <div className="reason-box sub">理由を出せませんでした</div>;
  return (
    <div className="reason-box">
      {e.reasons.length === 0 && <span className="sub">点の付く条件はありません</span>}
      {e.reasons.map((r) => (
        <div key={`${r.ruleId}:${r.label}`} className="spread">
          <span>{r.label}</span>
          <strong className={r.points < 0 ? 'ok-text' : r.points > 0 ? 'warn-text' : ''}>{pointsText(r.points)}</strong>
        </div>
      ))}
      {e.timing && (
        <span className="sub">
          着 {minutesToHhmm(e.timing.arrival)}・開始 {minutesToHhmm(e.timing.start)}
          {e.timing.wait > 0 && `・待ち ${r0(e.timing.wait)}分`}
        </span>
      )}
    </div>
  );
}

/** 合計点・移動・待ち・距離・条件ごとの達成/違反の比較表 */
function CompareTable({
  manual,
  ai,
  rules,
  error,
}: {
  manual: PlanScore | null;
  ai: PlanScore | null;
  rules: { id: string; label: string }[];
  error?: string | null;
}) {
  if (!manual || !ai) return <p className="sub">採点できません{error ? `（${error}）` : ''}</p>;
  const row = (label: string, a: number, b: number, unit: string, digits = 0) => {
    const f = (n: number) => (digits ? r1(n) : r0(n));
    const d = b - a;
    return (
      <tr key={label}>
        <th>{label}</th>
        <td className="num">
          {f(a)}
          {unit}
        </td>
        <td className="num">
          <strong>
            {f(b)}
            {unit}
          </strong>
        </td>
        <td className={`num ${d < 0 ? 'ok-text' : d > 0 ? 'warn-text' : 'sub'}`}>{deltaText(d, unit)}</td>
      </tr>
    );
  };
  const ruleIds = [...rules.map((r) => r.id), ...Object.keys({ ...manual.perRule, ...ai.perRule })].filter(
    (id, i, a) => a.indexOf(id) === i,
  );
  const labelOf = (id: string) => rules.find((r) => r.id === id)?.label ?? id;
  const cell = (s: PlanScore, id: string) => {
    const p = s.perRule[id];
    if (!p) return <span className="sub">—</span>;
    return (
      <span>
        達成 {p.hits}・違反 <span className={p.misses > 0 ? 'warn-text' : ''}>{p.misses}</span>
        <span className="sub">（{pointsText(p.points)}）</span>
      </span>
    );
  };
  return (
    <div className="table-scroll">
      <table className="compare-table">
        <thead>
          <tr>
            <th />
            <th className="num">手作業案</th>
            <th className="num">AI案</th>
            <th className="num">差</th>
          </tr>
        </thead>
        <tbody>
          {row('合計点（低いほど良い）', manual.total, ai.total, '点')}
          {row('移動時間', manual.travelMinutes, ai.travelMinutes, '分')}
          {row('待ち時間', manual.waitMinutes, ai.waitMinutes, '分')}
          {row('移動距離', manual.meters / 1000, ai.meters / 1000, 'km', 1)}
          {row('入らなかった訪問', manual.dropped, ai.dropped, '件')}
          {row('必須の違反', manual.hardViolations.length, ai.hardViolations.length, '件')}
          {ruleIds.map((id) => (
            <tr key={id}>
              <th>{labelOf(id)}</th>
              <td className="num">{cell(manual, id)}</td>
              <td className="num">{cell(ai, id)}</td>
              <td className="num sub">
                {deltaText((ai.perRule[id]?.points ?? 0) - (manual.perRule[id]?.points ?? 0))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 横の小さな重みの欄（D14）。変えたらすぐ「再計算」できる */
function WeightPanel({ running, onRecalc, canRun }: { running: boolean; onRecalc: () => void; canRun: boolean }) {
  const { data, update } = useDemoData();
  return (
    <aside className="card stack side-panel">
      <h3>条件の重み</h3>
      <span className="sub">重み1＝移動10分ぶん。0で無効。</span>
      {data.rules.map((r) => (
        <div key={r.id} className={`stack side-rule ${r.weight === 0 && !r.hard ? 'is-dim' : ''}`} style={{ gap: 2 }}>
          <span className="side-rule-label">
            {r.label}
            {r.hard && HARDABLE.has(r.type) && <span className="chip chip-primary">必須</span>}
          </span>
          <WeightSlider
            label={r.label}
            value={r.weight}
            disabled={r.hard && HARDABLE.has(r.type)}
            onChange={(w) =>
              update((d) => ({ ...d, rules: d.rules.map((x) => (x.id === r.id ? { ...x, weight: w } : x)) }))
            }
          />
        </div>
      ))}
      <button type="button" className="btn btn-small" disabled={running || !canRun} onClick={onRecalc}>
        再計算
      </button>
    </aside>
  );
}
