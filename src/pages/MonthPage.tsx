import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Layers,
  RefreshCw,
  Repeat,
  Sparkles,
  Square,
  UserX,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDay } from '../app/day';
import { useToast } from '../components/Toast';
import { Hint, PageHeader, SidePanel, WithIcon } from '../components/ui';
import type { AiPlan, AiRun, DemoData } from '../contracts/data';
import type { Visit } from '../contracts/documents';
import type { Problem } from '../contracts/problem';
import type { Rule } from '../contracts/rules';
import { jstDate, weekday } from '../domain/time';
import { normalize, score, toHundred } from '../evaluate';
import { attempt, own, WEEKDAY_LABELS } from '../lib/common';
import {
  addMonths,
  applyDayRun,
  type BatchMode,
  batchTargets,
  calendarWeeks,
  type DayStatus,
  type DayView,
  dayStatus,
  expandMonth,
  isYm,
  monthDates,
  planEdited,
  planStale,
  ymOf,
} from '../lib/month';
import { mdText } from '../lib/patternText';
import { alignPlan, planOfRun, problemKey, reusableRun } from '../lib/runs';
import { useDayModel } from '../lib/useDayModel';
import { type CompileInput, compile } from '../matching';
import { applyPreset, scorePresetOf, scoreRulesOf } from '../seed';
import { defaultIterations, runSolve } from '../solver';
import './month.css';

/**
 * 月間カレンダーと月まとめ作成（ADR-0012 段階1。PRD D39〜D43。design.md §4 pages「月単位の予定」）。
 * 日のマスは日付・訪問の件数・状態・入らない・点数（点数の基準の物差し）・欠勤・条件が変わった。押すとその日の予定の画面へ。
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

const STATE_TEXT: Record<DayStatus['state'], string> = {
  none: '案なし',
  plan: '案あり',
  confirmed: '確定済み',
  diff: '未確定の変更あり',
};

/** 日の表示の計算の覚え（日付ごと。同じ入力なら compile・採点し直さない） */
type Memo = {
  base: unknown[];
  visits: Visit[];
  plan: AiPlan;
  runs: AiRun[] | undefined;
  rules: Rule[];
  view: DayView;
};

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
  const [mode, setMode] = useState<'empty' | 'all'>('empty');
  const [batch, setBatch] = useState<Batch | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  /** 点数の基準のプリセット（月まとめ作成に使う。ADR-0012） */
  const basePreset = useMemo(() => scorePresetOf(data.presets, data.scorePresetId), [data.presets, data.scorePresetId]);
  /** 点数の物差しの条件（いまの条件に基準のプリセットを当てたもの） */
  const scoreRules = useMemo(
    () => scoreRulesOf({ rules: data.rules, presets: data.presets, scorePresetId: data.scorePresetId }),
    [data.rules, data.presets, data.scorePresetId],
  );

  // ---- 日のマスの表示（日付・compile が読むデータ・案で覚える。8人・約17件／日の一月で 500ms 以内）----
  const memo = useRef(new Map<string, Memo>());
  const weeks = useMemo(() => calendarWeeks(ym), [ym]);
  const statuses = useMemo(() => {
    const out = new Map<string, DayStatus>();
    const visitsByDate = new Map<string, Visit[]>();
    for (const v of compileInput.visits) {
      const list = visitsByDate.get(v.date);
      if (list) list.push(v);
      else visitsByDate.set(v.date, [v]);
    }
    const c = compileInput;
    const base = [c.org, c.items, c.staff, c.clients, c.compat, c.availability, c.absences, c.visitTypes, c.patterns];
    const sameList = (a: readonly unknown[], b: readonly unknown[]) =>
      a.length === b.length && a.every((x, i) => x === b[i]);
    for (const d of weeks.flat()) {
      const plan = own(data.aiPlans, d);
      if (!plan) {
        out.set(d, dayStatus(data, d));
        continue;
      }
      const visits = visitsByDate.get(d) ?? [];
      const runs = own(data.aiRuns, d);
      const hit = memo.current.get(d);
      if (
        hit &&
        hit.plan === plan &&
        hit.runs === runs &&
        hit.rules === scoreRules &&
        sameList(hit.base, base) &&
        sameList(hit.visits, visits)
      ) {
        out.set(d, dayStatus(data, d, hit.view));
        continue;
      }
      // その日の訪問だけを渡して compile する（compile はその日の訪問しか読まない）
      const input: CompileInput = { ...c, visits };
      const sp = attempt(() => compile({ ...input, rules: scoreRules }, d)).value;
      let view: DayView = {};
      if (sp) {
        const scale = attempt(() => normalize(sp)).value;
        const aligned = attempt(() => alignPlan(sp, plan)).value ?? plan;
        const sc = attempt(() => score(sp, aligned.routes)).value;
        const scoreKey = JSON.stringify(scoreRules);
        view = {
          visitIds: sp.visits.map((v) => v.id),
          hundred: sc && scale ? toHundred(sc.total, scale) : null,
          hard: sc?.hardViolations.length ?? 0,
          stale: planStale(input, data, d, (rules, pins) =>
            Object.keys(pins).length === 0 && JSON.stringify(rules) === scoreKey ? sp : undefined,
          ),
        };
      }
      memo.current.set(d, { base, visits, plan, runs, rules: scoreRules, view });
      out.set(d, dayStatus(data, d, view));
    }
    return out;
  }, [weeks, compileInput, data, scoreRules]);

  const days = useMemo(() => monthDates(ym), [ym]);
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

  const goMonth = (next: string) => {
    setParams({ ym: next });
  };
  const openDay = (d: string) => {
    setDate(d);
    navigate('/plan');
  };

  const current = batch ? batch.targets[batch.index] : undefined;
  const progressValue = batch ? batch.index + (batch.total > 0 ? Math.min(1, batch.iteration / batch.total) : 0) : 0;

  return (
    <div className="stack">
      <PageHeader
        icon={CalendarRange}
        title="月間"
        lead="ひと月の訪問と案の状態。定期パターンから訪問を作り、案をまとめて作ります"
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
        <div className="row month-tools">
          <button
            type="button"
            className="btn btn-small"
            disabled={running || data.patterns.length === 0}
            onClick={expandOnly}
            title={data.patterns.length === 0 ? '定期パターンがありません' : ''}
          >
            <WithIcon icon={Repeat} size={14}>
              定期パターンから訪問だけ作る{preview.added > 0 ? `（${preview.added}件）` : ''}
            </WithIcon>
          </button>
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
            日のマスを押すと、その日の予定の画面を開きます。点数は点数の基準のプリセット「{scoreRulerName}
            」の物差しです。枠の濃い日（「要確認」）は、訪問があるのに案が無い・入らない訪問がある・必須の違反がある日です。
            「条件が変わった」は、案を作ったあとに訪問・{terms.staff}・稼働時間・条件が変わった日です。
          </Hint>
          {noVisitsWhy && <span className="sub">{noVisitsWhy}</span>}
        </div>
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
                  const inMonth = ymOf(d) === ym;
                  if (!inMonth || !s) {
                    return (
                      <td key={d} className="month-cell is-out">
                        <span className="month-day">{mdText(d)}</span>
                      </td>
                    );
                  }
                  const past = d < today;
                  const making = current === d;
                  const parts = [
                    longDate(d),
                    s.count > 0 ? `訪問 ${s.count}件` : '訪問なし',
                    s.count > 0 ? STATE_TEXT[s.state] : '',
                    s.unassigned > 0 ? `入らない ${s.unassigned}件` : '',
                    s.hard > 0 ? `必須の違反 ${s.hard}件` : '',
                    s.hundred !== null ? `${s.hundred}点` : '',
                    s.absence ? '欠勤あり' : '',
                    s.stale ? '条件が変わった' : '',
                    s.needsCare ? '要確認' : '',
                    making ? '作っています' : '',
                  ].filter(Boolean);
                  return (
                    <td
                      key={d}
                      className={[
                        'month-cell',
                        past ? 'is-past' : '',
                        s.needsCare ? 'is-care' : '',
                        d === today ? 'is-today' : '',
                        d === date ? 'is-picked' : '',
                        making ? 'is-making' : '',
                      ].join(' ')}
                    >
                      <button
                        type="button"
                        className="month-cell-btn"
                        data-testid="month-day"
                        data-date={d}
                        aria-label={parts.join('・')}
                        title={`${parts.join('・')}（押すとこの日の予定の画面を開きます）`}
                        onClick={() => openDay(d)}
                      >
                        <span className="month-day">
                          {Number(d.slice(8, 10))}
                          {d === today && <span className="month-today">今日</span>}
                        </span>
                        {s.count > 0 && <span className="month-count">訪問 {s.count}件</span>}
                        {s.count > 0 && (
                          <span className={`month-state is-${s.state}`} data-testid="month-state">
                            {making ? '作っています…' : STATE_TEXT[s.state]}
                          </span>
                        )}
                        {s.hundred !== null && <span className="month-score">{s.hundred}点</span>}
                        {s.unassigned > 0 && (
                          <span className="month-flag is-warn">
                            <CircleAlert size={12} aria-hidden="true" />
                            入らない {s.unassigned}件
                          </span>
                        )}
                        {s.hard > 0 && (
                          <span className="month-flag is-red">
                            <CircleAlert size={12} aria-hidden="true" />
                            必須の違反 {s.hard}件
                          </span>
                        )}
                        {s.absence && (
                          <span className="month-flag">
                            <UserX size={12} aria-hidden="true" />
                            欠勤
                          </span>
                        )}
                        {s.stale && (
                          <span className="month-flag is-warn" data-testid="month-stale">
                            <RefreshCw size={12} aria-hidden="true" />
                            条件が変わった
                          </span>
                        )}
                        {s.needsCare && !past && <span className="month-care">要確認</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
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
