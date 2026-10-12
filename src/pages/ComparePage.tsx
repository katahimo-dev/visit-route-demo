import { useEffect, useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useDay } from '../app/day';
import { ClientName } from '../components/parts';
import { type MapLine, type MapPoint, RouteMap } from '../components/RouteMap';
import { useToast } from '../components/Toast';
import type { AiPlan, AiRun } from '../contracts/data';
import type { Reason, VisitExplain } from '../contracts/problem';
import { HARDABLE, type Rule } from '../contracts/rules';
import { minutesToHhmm } from '../domain/time';
import { diff, score } from '../evaluate';
import { colorOf, initialOf } from '../lib/colors';
import { AI_LINE, attempt, deltaText, hasLocation, MANUAL_LINE, own, pointsText, r0 } from '../lib/common';
import { planOfRun } from '../lib/runs';
import { ownerMap, useDayModel } from '../lib/useDayModel';
import { scheduleRoute } from '../matching';
import { CompareTable, explainMap, ReasonBox } from './planParts';

/**
 * 比較（D19・D22・ADR-0005）：その日のAI案の記録（作るたびに条件と結果を残したもの）と「今の案」から、
 * 任意の2つを A・B に選んで比べる。条件の差・合計と条件ごと・担当ごとの順番・地図（A 点線、B 実線）。
 * 採点は A・B とも、いまの条件の同じ物差し（evaluate.score）。AI案を作る・手直しは「AI案」の画面（#/plan）
 */

type Side = 'a' | 'b';
/** 比べる候補：記録1件か、今の案（AI案の画面の手直し後） */
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
  const { data, update, staff, staffById, clientById, colorOfStaff, visits, visitById, problem } = m;
  const terms = data.org.terms;
  const toast = useToast();
  const navigate = useNavigate();
  const [picked, setPicked] = useState<{ visitId: string; side: Side } | null>(null);
  const [mapStaff, setMapStaff] = useState<string | null>(null);
  const [sel, setSel] = useState<{ a: string | null; b: string | null }>({ a: null, b: null });
  // biome-ignore lint/correctness/useExhaustiveDependencies: 日付を変えたら選んだ訪問・案を外す
  useEffect(() => {
    setPicked(null);
    setSel({ a: null, b: null });
  }, [date]);

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
        title: '今の案（AI案の画面）',
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
      JSON.stringify(aiPlan.routes) !== JSON.stringify(aiPlan.generated.routes) &&
      !confirm('AI案の画面の手直しを捨てて、この記録を今の案にします。よろしいですか？')
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
  const mapStaffId = mapStaff && staffIds.includes(mapStaff) ? mapStaff : (staffIds[0] ?? null);

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
    const ids = own(side === 'a' ? aRoutes : bRoutes, staffId) ?? [];
    if (ids.length === 0) return <span className="sub">訪問なし</span>;
    const ex = side === 'a' ? aExplain : bExplain;
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
          const hard = (side === 'a' ? aScore : bScore)?.value?.hardViolations.some((h) => h.visitId === id);
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

  // ---- 地図：選んだ担当の A（点線）と B（実線）----
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
    lns.push({ points: pathOf(own(aRoutes, mapStaffId) ?? []), color: MANUAL_LINE, dashed: true });
    lns.push({ points: pathOf(own(bRoutes, mapStaffId) ?? []), color: AI_LINE });
    return { points: pts, lines: lns };
  }, [mapStaffId, staffById, visitById, clientById, aRoutes, bRoutes]);

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
        <strong>
          {side}：{c.title}
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

  return (
    <div className="stack" style={{ minWidth: 0 }}>
      <h2>条件を変えた案の比較</h2>
      {m.problemError && <p className="error">問題を作れませんでした：{m.problemError}</p>}

      <div className="card stack">
        <div className="spread" style={{ flexWrap: 'wrap' }}>
          <h3>この日の記録（{runs.length}件）</h3>
          <span className="sub">
            <NavLink to="/plan">AI案</NavLink>の画面で作る・組み直すたびに、条件と結果が残ります
          </span>
        </div>
        {choices.length === 0 ? (
          <p className="sub">
            この日の記録はまだありません。<NavLink to="/plan">AI案</NavLink>
            の画面を開くと、標準の条件で自動で作ります。プリセットや重みを変えて作ると、ここで比べられます。
          </p>
        ) : (
          <div className="table-scroll">
            <table className="compare-table runs-table">
              <thead>
                <tr>
                  <th>A</th>
                  <th>B</th>
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
                      <td>
                        <input
                          type="radio"
                          name="pick-a"
                          aria-label={`${c.title} を A にする`}
                          checked={A?.id === c.id}
                          onChange={() => setSel((s) => ({ ...s, a: c.id }))}
                        />
                      </td>
                      <td>
                        <input
                          type="radio"
                          name="pick-b"
                          aria-label={`${c.title} を B にする`}
                          checked={B?.id === c.id}
                          onChange={() => setSel((s) => ({ ...s, b: c.id }))}
                        />
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
                      <td className="num">{sc ? `${r0(sc.total)}点` : '—'}</td>
                      <td className="num">{sc ? `${r0(sc.travelMinutes)}分` : '—'}</td>
                      <td className="num">{sc ? `${sc.dropped}件` : '—'}</td>
                      <td className="nowrap">
                        {run && (
                          <div className="row" style={{ gap: 4 }}>
                            <button type="button" className="btn btn-small" onClick={() => openRun(run)}>
                              AI案の画面で開く
                            </button>
                            <button type="button" className="btn btn-small" onClick={() => applyRules(run)}>
                              この条件にする
                            </button>
                            <button type="button" className="btn btn-small" onClick={() => removeRun(run)}>
                              消す
                            </button>
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
        <span className="sub">合計点は、いまの条件の同じ物差しで付け直した点です（低いほど良い）。</span>
      </div>

      {A && B && (
        <>
          <div className="card stack">
            <h3>条件の差</h3>
            <div className="table-scroll">
              <table className="compare-table">
                <thead>
                  <tr>
                    <th />
                    <th className="num">A：{A.title}</th>
                    <th className="num">B：{B.title}</th>
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
              <p className="sub">
                いまの条件と違う条件で作った案があります。下の点数は A・B ともいまの条件で付け直しています。
              </p>
            )}
          </div>

          <div className="card stack">
            <h3>合計と条件ごと</h3>
            {abDiff?.value && (
              <p className="sub">
                A→B：担当が変わった訪問 {abDiff.value.changedVisits.length}件・移動{' '}
                {deltaText(abDiff.value.travelDelta, '分')}・合計点 {deltaText(abDiff.value.scoreDelta, '点')}
              </p>
            )}
            <CompareTable
              a={as}
              b={bs}
              labels={[`A：${A.title}`, `B：${B.title}`]}
              rules={data.rules}
              error={aScore?.error ?? bScore?.error}
            />
          </div>

          <div className="card stack">
            <h3>{terms.staff}ごとの比較（左：A、右：B）</h3>
            <p className="sub">訪問を押すと、その担当になった理由（点の内訳）が出ます。</p>
            <div className="compare">
              <div className="compare-row compare-header">
                <div />
                <div>A：{A.title}</div>
                <div>B：{B.title}</div>
              </div>
              {staffIds.map((id) => {
                const pa = routeTotals(id, own(aRoutes, id) ?? []);
                const pb = routeTotals(id, own(bRoutes, id) ?? []);
                const d = r0((pb?.travelMinutes ?? 0) - (pa?.travelMinutes ?? 0));
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
                        {own(aRoutes, id)?.length ?? 0}件 → {own(bRoutes, id)?.length ?? 0}件
                      </span>
                      {pa && pb && (
                        <>
                          <span className="sub">
                            移動 {r0(pa.travelMinutes)}分 → {r0(pb.travelMinutes)}分
                          </span>
                          <span className={`chip ${d < 0 ? 'chip-ok' : d > 0 ? 'chip-warn' : ''}`}>
                            {deltaText(d, '分')}
                          </span>
                        </>
                      )}
                    </button>
                    <div className="compare-col">{stopCards(id, 'a')}</div>
                    <div className="compare-col">{stopCards(id, 'b')}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {(A.unassigned.length > 0 || B.unassigned.length > 0) && (
            <div className="card stack">
              <h3>割り当てられなかった訪問</h3>
              {unassignedList(A, aExplain, 'A')}
              {unassignedList(B, bExplain, 'B')}
            </div>
          )}

          <div className="card stack">
            <div className="spread">
              <h3>地図：{mapStaffId ? staffName(mapStaffId) : ''}（点線：A、実線：B）</h3>
              <span className="sub">上の比較で{terms.staff}の名前を押すと切り替わります</span>
            </div>
            <RouteMap points={points} lines={lines} height={400} />
            <div className="row sub">
              <span style={{ color: MANUAL_LINE }}>- - - A</span>
              <span style={{ color: AI_LINE }}>━━ B</span>
            </div>
          </div>
        </>
      )}

      {choices.length === 1 && (
        <div className="card">
          <p className="sub">
            比べるには案が2つ以上いります。<NavLink to="/plan">AI案</NavLink>
            の画面でプリセットを押すか、重みを変えて「AI案を作り直す」を押してください。
          </p>
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
