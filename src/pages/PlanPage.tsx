import { type DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useDay } from '../app/day';
import { ClientName } from '../components/parts';
import { type MapLine, type MapPoint, RouteMap } from '../components/RouteMap';
import { useToast } from '../components/Toast';
import type { AiPlan, DemoData } from '../contracts/data';
import type { PlanScore, Problem, SolveResult } from '../contracts/problem';
import type { Rule } from '../contracts/rules';
import { NONE } from '../domain/scheduleModel';
import { minutesToHhmm } from '../domain/time';
import { diff, score } from '../evaluate';
import { colorOf, initialOf } from '../lib/colors';
import { attempt, deltaText, formError, hasLocation, own, pointsText, r0, staffColor } from '../lib/common';
import { addRun } from '../lib/runs';
import { ownerMap, useDayModel } from '../lib/useDayModel';
import { bestInsertion, compile } from '../matching';
import { applyPreset, PRESETS, type Preset, presetOf } from '../seed';
import { defaultIterations, runSolve } from '../solver';
import { explainMap, ReasonBox, WeightPanel } from './planParts';

/**
 * AI案（D18・ADR-0004）：AI案を作る → 担当ごとの列で手直し（ドラッグ・担当を選ぶ）→ 動かした訪問は固定 →
 * 「固定を残して組み直す」で残りを AI が組み直す →「予定に採用」。
 * AI案の routes は手直し後の今の案、generated は AI が出したまま、pins は固定（訪問ID → 担当ID）。
 * AI案が無い日は、開いたときにプリセット1（標準）の重みで自動で作る。作る・組み直すたびに、条件と結果を
 * その日の記録（aiRuns）に残し、「比較」の画面（#/compare）で任意の2つを比べる（ADR-0005）
 */

type Progress = { iteration: number; total: number; bestScore: number };

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
  const { data, update, staff, staffById, clientById, colorOfStaff, visits, visitById, problem } = m;
  const terms = data.org.terms;
  const toast = useToast();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState<'create' | 'resolve' | null>(null);
  /** 計算している日と条件の名前（AI案が無い日の「作っています」の表示） */
  const [runningFor, setRunningFor] = useState<{ date: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTo, setDropTo] = useState<string | null>(null);
  const runRef = useRef<{ stop(): void } | null>(null);
  /** 計算の世代。画面を離れると進め、前の世代の計算の結果は捨てる（開発時の StrictMode の付け外しでも） */
  const generation = useRef(0);
  /** 自動作成を試した日（同じ日に2回は試さない） */
  const autoTried = useRef(new Set<string>());

  // 画面を離れたら Worker を止める（止めた結果は保存しない）
  useEffect(() => {
    setRunning(null);
    setRunningFor(null);
    setProgress(null);
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
  /** AI案を作った条件（重み・必須）と、いまの条件が違うか */
  const stale = !!aiPlan && JSON.stringify(aiPlan.rules) !== JSON.stringify(data.rules);
  /** 自動作成（ADR-0005）：いまの条件を書き換えずに標準のプリセットで作った案（作ったあとに変えたのではない） */
  const autoMade =
    stale && !!aiPlan && presetOf(aiPlan.rules)?.id === PRESETS[0]?.id && Object.keys(aiPlan.pins).length === 0;

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
    const target = rules ? attempt(() => compile({ ...data, rules }, date)) : { value: problem, error: m.problemError };
    if (!target.value) return fail(target.error ?? '問題を作れませんでした');
    if (target.value.visits.length === 0) return fail('この日に計算できる訪問がありません');
    if (target.value.staff.length === 0) return fail(`この日に働ける${terms.staff}がいません`);
    return target.value;
  };
  const run = (kind: 'create' | 'resolve', target: Problem, label: string, onDone: (r: SolveResult) => void) => {
    const gen = generation.current;
    const live = () => gen === generation.current;
    const started = attempt(() =>
      runSolve(target, { seed: data.seed, iterations: defaultIterations(target) }, (p) => {
        if (live()) setProgress(p);
      }),
    );
    if (!started.value) {
      setError(started.error);
      return;
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
      });
  };
  const stop = () => runRef.current?.stop();

  /**
   * AI案を作る（固定なし。作ると generated と routes を同じにし、固定を空に）。作った案は記録に残す。
   * rules を渡すとその条件で作る。mode：'preset' は確認ずみ、'auto' は自動作成（確認・失敗の表示を出さない）
   */
  const create = (rules: Rule[] = data.rules, mode: 'manual' | 'preset' | 'auto' = 'manual') => {
    const auto = mode === 'auto';
    const p = check(rules, auto);
    if (!p) return;
    if (mode === 'manual' && edited && !confirm('手直しと固定を捨てて、AI案を作り直します。よろしいですか？')) return;
    const forDate = date;
    const rulesSnapshot = rules;
    run('create', p, `${presetOf(rules)?.name ?? 'いま'}の`, (result) => {
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
      update((d) =>
        addRun({ ...d, aiPlans: { ...d.aiPlans, [forDate]: plan } }, forDate, {
          rules: rulesSnapshot,
          pins: {},
          result,
          createdAt: plan.createdAt,
        }),
      );
      toast(
        result.stopped
          ? '途中までの最良の案を保存しました'
          : auto
            ? `${PRESETS[0]?.name ?? ''}の条件でAI案を作りました`
            : 'AI案を作りました',
      );
    });
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

  // AI案が無い日は、開いたときにプリセット1（標準）で自動で作る（同じ日に2回は試さない）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 日付・案の有無・問題が変わったときだけ
  useEffect(() => {
    if (aiPlan || running || !problem || autoTried.current.has(date)) return;
    autoTried.current.add(date);
    const preset = PRESETS[0];
    if (preset) create(applyPreset(data.rules, preset), 'auto');
  }, [date, aiPlan, problem, running]);

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
    run('resolve', pinned.value, `${presetOf(data.rules)?.name ?? 'いま'}の`, (result) => {
      update((d) =>
        addRun(
          patchPlan(d, forDate, (plan) => ({
            ...withRoutes(p, plan, result.routes),
            stopped: result.stopped,
            rules: rulesSnapshot,
          })),
          forDate,
          { rules: rulesSnapshot, pins: pinsSnapshot, result, createdAt: Date.now() },
        ),
      );
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
        path.push({ lat: c.place.lat, lng: c.place.lng });
        pts.push({ lat: c.place.lat, lng: c.place.lng, label: initialOf(c.displayName), color: colorOf(c.color) });
      }
      if (home && path.length > 1) path.push(home);
      lns.push({ points: path, color });
    }
    return { points: pts, lines: lns };
  }, [aiPlan, columns, routes, staffById, colorOfStaff, visitById, clientById]);

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
            {own(routes, ownerId ?? '')?.[0] === id ? '自宅から ' : '↓ 移動 '}
            {r0(t.travelIn)}分{t.wait > 0 && `（待ち ${r0(t.wait)}分）`}
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
            onClick={() => setPicked(isPicked ? null : id)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                setPicked(isPicked ? null : id);
              }
            }}
            title="押すと理由を見られます。ドラッグで別の担当へ移せます"
          >
            <span className="sub nowrap">
              {t ? `${minutesToHhmm(t.start)}〜${minutesToHhmm(t.end)}` : (visitById.get(id)?.earliestStart ?? '')}
            </span>
            <ClientName client={clientOf(id)} />
          </div>
          {(pin || hard) && (
            <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
              {pin && (
                <span className="chip chip-pin" title="手直しで固定した訪問（組み直しても担当を変えない）">
                  📌 固定
                </span>
              )}
              {pin && (
                <button type="button" className="btn btn-small" onClick={() => unpin(id)} disabled={!!running}>
                  固定を外す
                </button>
              )}
              {hard?.map((h) => (
                <span key={h} className="chip chip-red" title="必須の条件の違反">
                  ✕ {h}
                </span>
              ))}
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
        <div className="spread" style={{ flexWrap: 'wrap' }}>
          <h2>AI案</h2>
          <NavLink to="/compare" className="sub">
            条件を変えた案どうしの比較（この日の記録 {runCount}件）→
          </NavLink>
        </div>
        <div className="card stack">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" disabled={!!running || !problem} onClick={() => create()}>
              {running === 'create' ? '作っています…' : 'AI案を作る'}
            </button>
            {aiPlan && (
              <button
                type="button"
                className="btn"
                disabled={!!running || !problem}
                onClick={resolve}
                title="固定した訪問の担当は変えずに、残りを AI が組み直します"
              >
                {running === 'resolve'
                  ? '組み直しています…'
                  : `固定を残して組み直す${pinCount > 0 ? `（固定 ${pinCount}件）` : ''}`}
              </button>
            )}
            {aiPlan && (
              <button type="button" className="btn" disabled={!!running || !edited} onClick={revert}>
                AI案に戻す
              </button>
            )}
            {running && (
              <button type="button" className="btn" onClick={stop}>
                止める
              </button>
            )}
          </div>
          {aiPlan && !running && (
            <span className="sub">
              {new Date(aiPlan.createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} に作成（乱数の種{' '}
              {aiPlan.seed}・{aiPlan.iterations.toLocaleString()}回{aiPlan.stopped && '・途中で止めた案'}）。訪問を別の
              {terms.staff}の列へドラッグ（または押して担当を選ぶ）と、その{terms.staff}
              の回る順番の中で最も費用の少ない位置に入り、固定になります。
            </span>
          )}
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
          {stale && autoMade && (
            <p className="sub">
              この案は、開いたときに{PRESETS[0]?.name}
              の条件で自動で作った案です（いまの条件とは違います）。点数はいまの条件で付け直しています。いまの条件で作るには「AI案を作る」を押してください。
            </p>
          )}
          {stale && !autoMade && (
            <p className="warn-text">
              このAI案を作ったあとに条件が変わりました。点数はいまの条件で付け直しています。「AI案を作る」か「固定を残して組み直す」で作り直せます。
            </p>
          )}
        </div>

        {!aiPlan ? (
          <div className="card">
            <p className="sub">
              {runningFor?.date === date
                ? `この日のAI案を${runningFor.label}条件で作っています…`
                : running
                  ? '別の日のAI案を作っています…'
                  : 'この日のAI案はまだありません。「AI案を作る」を押してください。'}
            </p>
          </div>
        ) : (
          <>
            <div className="card stack">
              <div className="spread" style={{ flexWrap: 'wrap' }}>
                <h3>今の案{edited ? '（手直し後）' : ''}</h3>
                <button type="button" className="btn btn-primary" disabled={!!running} onClick={adopt}>
                  予定に採用
                </button>
              </div>
              <PlanSummary current={cs} generated={gs} changed={genDiff?.value?.changedVisits.length ?? 0} />
              {problem && cs && <BalanceChips problem={problem} routes={routes} staffName={staffName} />}
              {(curScore?.error || genScore?.error) && (
                <p className="error">採点できません（{curScore?.error ?? genScore?.error}）</p>
              )}
            </div>

            <div className="card stack">
              <h3>{terms.staff}ごとの順番</h3>
              <p className="sub">
                訪問をドラッグして別の{terms.staff}へ移せます。押すと理由（点の内訳）と担当の選択が出ます。📌
                は固定（組み直しても担当を変えない）。
              </p>
              <div className="route-grid">
                {unassigned.length > 0 && (
                  <div className="route-col route-col-none">
                    <div className="spread">
                      <strong>入らなかった訪問</strong>
                      <span className="sub nowrap">{unassigned.length}件</span>
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
                      className={['route-col', dropTo === sid ? 'is-drop' : '', notAllowed ? 'is-red' : ''].join(' ')}
                      style={{ borderTopColor: colorOfStaff.get(sid) }}
                      data-staff={sid}
                      {...dropProps(sid)}
                    >
                      <div className="spread">
                        <strong className="ellipsis" style={{ color: colorOfStaff.get(sid) }}>
                          {staffName(sid)}
                        </strong>
                        <span className="sub nowrap">{ids.length}件</span>
                      </div>
                      {notAllowed && <div className="drop-warning">ここに移すと：必須の条件に合わない</div>}
                      {ids.length === 0 && <span className="sub">ここへドラッグすると移せます</span>}
                      {ids.map((id) => card(id))}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card stack">
              <h3>地図：今の案（実線、{terms.staff}ごとの色。「家」は自宅）</h3>
              <RouteMap points={points} lines={lines} height={420} />
              <div className="row sub" style={{ flexWrap: 'wrap' }}>
                {columns
                  .filter((sid) => (own(routes, sid)?.length ?? 0) > 0)
                  .map((sid) => (
                    <span key={sid} className="nowrap">
                      <span style={{ color: colorOfStaff.get(sid) }}>━</span> {staffName(sid)}
                    </span>
                  ))}
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

/** 今の案の合計点・移動・待ち・必須の違反と、AIが出したままとの差 */
function PlanSummary({
  current,
  generated,
  changed,
}: {
  current: PlanScore | null;
  generated: PlanScore | null;
  changed: number;
}) {
  if (!current) return null;
  const delta = (a: number, b: number | undefined, unit: string) => {
    if (b === undefined) return null;
    const d = a - b;
    if (Math.round(d * 10) === 0) return null;
    return <span className={`sub ${d < 0 ? 'ok-text' : 'warn-text'}`}>（{deltaText(d, unit)}）</span>;
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <span className="chip" data-testid="plan-total">
          合計 {r0(current.total)}点{delta(current.total, generated?.total, '点')}
        </span>
        <span className="chip">
          移動 {r0(current.travelMinutes)}分{delta(current.travelMinutes, generated?.travelMinutes, '分')}
        </span>
        <span className="chip">
          待ち {r0(current.waitMinutes)}分{delta(current.waitMinutes, generated?.waitMinutes, '分')}
        </span>
        <span className="chip">負担の均等 {pointsText(current.balancePoints)}点</span>
        <span className={`chip ${current.hardViolations.length > 0 ? 'chip-red' : 'chip-ok'}`}>
          必須の違反 {current.hardViolations.length}件
        </span>
        {current.dropped > 0 && <span className="chip chip-warn">入らなかった訪問 {current.dropped}件</span>}
      </div>
      {generated && (
        <span className="sub">
          AIが出したまま：合計 {r0(generated.total)}点・移動 {r0(generated.travelMinutes)}分・待ち{' '}
          {r0(generated.waitMinutes)}分{changed > 0 ? `。担当を変えた訪問 ${changed}件` : '（手直しなし）'}
        </span>
      )}
    </div>
  );
}

/** スタッフごとの件数と目安の帯（帯の外は色、必須の上限を超えたら赤） */
function BalanceChips({
  problem,
  routes,
  staffName,
}: {
  problem: Problem;
  routes: Record<string, string[]>;
  staffName: (id: string) => string;
}) {
  const b = problem.balance;
  const rows = problem.staff
    .map((s, i) => ({ id: s.id, i, n: own(routes, s.id)?.length ?? 0, working: s.slots.length > 0 }))
    .filter((x) => x.working || x.n > 0);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <span className="sub">
        件数の偏り（{b ? '目安の帯は稼働時間に比例' : '負担の均等の条件が無効'}
        {b?.cap ? '・必須：目安の上＋1件まで' : ''}）
      </span>
      <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
        {rows.map(({ id, i, n }) => {
          const lo = b?.lo[i] ?? 0;
          const hi = b?.hi[i] ?? 0;
          const over = b?.cap ? n > b.cap[i]! : false;
          const out = b ? n < lo || n > hi : false;
          const band = lo === hi ? `${lo}` : `${lo}〜${hi}`;
          return (
            <span
              key={id}
              className={`chip ${over ? 'chip-red' : out ? 'chip-warn' : 'chip-ok'}`}
              title={b ? `目安 ${band}件` : ''}
            >
              {staffName(id)} {n}件{b && <span className="sub">（目安 {band}）</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
