// 組み方の標準（標準の週。PRD D350〜D354。ADR-0062）の画面。5段の手順：期間 → 考え方で作る → 選ぶ → 直す → 登録。
// 提案はその場だけ（保存しない。画面を離れると止まり、捨てる）。書くのは store の update の1回ずつ（全体の「元に戻す」で戻せる）
import { CalendarCheck, Crown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useConfirm } from '../components/ConfirmDialog';
import { SettingsTabs } from '../components/SettingsTabs';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/ui';
import { useUndoAction } from '../components/undo';
import type { DemoData } from '../contracts/data';
import type { Visit } from '../contracts/documents';
import type { Preset } from '../contracts/rules';
import { jstDate } from '../domain/time';
import { normalize, score, toHundred } from '../evaluate';
import { attempt, newId, own, WEEKDAY_LABELS } from '../lib/common';
import { pinsOf, writeRoutes } from '../lib/dayPlan';
import { type DayInputs, dayInputsOf } from '../lib/monthBatch';
import { setScorePreset } from '../lib/presets';
import {
  bestIndex,
  cycleWeeks,
  defaultSince,
  earliestSince,
  type ProposalStats,
  periodDates,
  proposalStats,
  registerCounts,
  registerStandard,
  STANDARD_WARNING_TEXT,
  type StandardDay,
  type StandardPeriod,
  standardDiff,
  standardPeriod,
  type TemporaryChoice,
  temporaryChanges,
} from '../lib/standard';
import { compile } from '../matching';
import { visitsOn } from '../patterns';
import { applyPreset, scorePresetOf, scoreRulesOf } from '../seed';
import { defaultIterations, runSolve } from '../solver';
import { useDemoData } from '../store';
import './settings.css';

/** 1日の提案（作ったときの訪問を持ち、今と違えば書かない） */
type ProposalDay = StandardDay & { visits: readonly Visit[]; inputs: DayInputs };
/** プリセットごとの提案 */
type Proposal = { presetId: string; days: ProposalDay[]; done: boolean };

/** dayInputsOf の refs のうち条件（d.rules）の位置（書くときに点数の基準を替えるので比べない） */
const RULES_REF = 2;

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 作ったときの訪問のままで、伝えていない日か */
function fresh(d: DemoData, day: ProposalDay): boolean {
  if (own(d.snapshots, day.date)) return false;
  const now = visitsOn(d, day.date);
  if (now.length !== day.visits.length || !now.every((v, k) => v === day.visits[k])) return false;
  // 欠勤・稼働時間・人・条件などの入力が変わっていれば書かない（月の AI で組むと同じ判定。条件は書くときに替えるので見ない）
  const inp = dayInputsOf(d, day.date);
  return inp.day === day.inputs.day && inp.refs.every((r, k) => k === RULES_REF || r === day.inputs.refs[k]);
}

/** 期間の作る日：今日以降・伝えていない、計算に入る訪問のある日 */
const targetDays = (d: DemoData, period: StandardPeriod, today: string): string[] =>
  periodDates(period).filter((x) => x >= today && !own(d.snapshots, x));

export default function StandardPage() {
  const { data, update } = useDemoData();
  const today = jstDate(Date.now());
  const confirmDialog = useConfirm();
  const toast = useToast();
  const undoAction = useUndoAction();
  const dataRef = useRef(data);
  dataRef.current = data;
  const terms = data.org.terms;
  const staffName = (id: string | null) =>
    id === null ? '担当なし' : (data.staff.find((s) => s.id === id)?.name ?? '（いない人）');
  const clientName = (id: string) => data.clients.find((c) => c.id === id)?.displayName ?? id;

  // 1. 期間
  const cycle = useMemo(() => cycleWeeks(data, today), [data, today]);
  const [weeks, setWeeks] = useState<number | null>(null);
  const period = useMemo(() => standardPeriod(data, today, weeks ?? cycle.weeks), [data, today, weeks, cycle.weeks]);
  const periodKey = `${period.from}|${period.to}`;

  // 2. 考え方で作る（提案はその場だけ）
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [running, setRunning] = useState<{ preset: string; day: number; days: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const runRef = useRef<{ stopped: boolean; stop: (() => void) | null } | null>(null);
  // 期間を変えたら提案は捨てる。画面を離れたら止める
  // biome-ignore lint/correctness/useExhaustiveDependencies: 期間が変わったときだけ
  useEffect(() => {
    setProposals([]);
  }, [periodKey]);
  useEffect(
    () => () => {
      if (runRef.current) {
        runRef.current.stopped = true;
        runRef.current.stop?.();
      }
    },
    [],
  );

  const run = async () => {
    if (runRef.current) return;
    const ctl: { stopped: boolean; stop: (() => void) | null } = { stopped: false, stop: null };
    runRef.current = ctl;
    setRunError(null);
    setProposals([]);
    const presets = dataRef.current.presets;
    const out: Proposal[] = [];
    try {
      for (const preset of presets) {
        if (ctl.stopped) break;
        const prop: Proposal = { presetId: preset.id, days: [], done: false };
        out.push(prop);
        const d0 = dataRef.current;
        const days = targetDays(d0, period, today);
        for (const [i, date] of days.entries()) {
          if (ctl.stopped) break;
          setRunning({ preset: preset.name, day: i + 1, days: days.length });
          const d = dataRef.current;
          const visits = visitsOn(d, date);
          const manual = pinsOf(visits);
          const input = { ...d, rules: applyPreset(d.rules, preset) };
          const p = attempt(() => compile(input, date, Object.keys(manual).length > 0 ? manual : undefined)).value;
          if (!p || p.visits.length === 0 || p.staff.length === 0) continue;
          const started = runSolve(p, { seed: d.seed, iterations: defaultIterations(p) });
          ctl.stop = started.stop;
          const res = await started.promise;
          ctl.stop = null;
          prop.days.push({ date, problem: p, routes: res.routes, visits, inputs: dayInputsOf(d, date) });
          setProposals(out.map((x) => ({ ...x, days: [...x.days] })));
        }
        prop.done = !ctl.stopped;
        setProposals(out.map((x) => ({ ...x, days: [...x.days] })));
      }
    } catch (e) {
      setRunError(e instanceof Error ? e.message : '提案を作れませんでした');
    } finally {
      runRef.current = null;
      setRunning(null);
    }
  };
  const stop = () => {
    if (!runRef.current) return;
    runRef.current.stopped = true;
    runRef.current.stop?.();
  };

  /** カードの数（点は点数の基準の物差し） */
  const stats = useMemo(() => {
    const basisRules = scoreRulesOf(data);
    const toPoints = (day: StandardDay): number | null => {
      const visits = visitsOn(data, day.date);
      const manual = pinsOf(visits);
      const p = attempt(() =>
        compile({ ...data, rules: basisRules }, day.date, Object.keys(manual).length > 0 ? manual : undefined),
      ).value;
      if (!p) return null;
      const sc = attempt(() => score(p, day.routes)).value;
      const scale = attempt(() => normalize(p)).value;
      return sc && scale ? toHundred(sc.total, scale) : null;
    };
    return data.presets.map((preset): ProposalStats | null => {
      const prop = proposals.find((x) => x.presetId === preset.id);
      return prop && prop.days.length > 0 ? proposalStats(prop.days, toPoints) : null;
    });
  }, [proposals, data]);
  const best = bestIndex(stats);
  const stale = (prop: Proposal | undefined) => !!prop && prop.days.some((day) => !fresh(data, day));

  // 3. 選ぶ
  const pick = async (preset: Preset) => {
    const prop = proposals.find((x) => x.presetId === preset.id);
    if (!prop || prop.days.length === 0) return;
    const ok = await confirmDialog({
      title: `「${preset.name}」で${md(period.from)}〜${md(period.to)}の担当を書きますか？`,
      body: `期間の担当と時刻を提案のとおりに書きます（ピンの訪問はそのまま）。点数の基準を「${preset.name}」にします。元に戻すで戻せます`,
      confirmLabel: '書く',
    });
    if (!ok) return;
    let written = 0;
    update((d) => {
      const okDays = prop.days.filter((day) => fresh(d, day));
      written = okDays.length;
      let out = d;
      for (const day of okDays) out = writeRoutes(out, day.date, day.problem, day.routes);
      return setScorePreset(out, preset.id);
    }, `組み方の標準：${preset.name}で書く`);
    setProposals([]);
    toast(
      written === prop.days.length
        ? `${written}日分を書きました`
        : `${written}日分を書きました（作ったあとに変わった日は書いていません）`,
      { action: undoAction },
    );
  };

  // 5. 登録
  const rows = useMemo(() => standardDiff(data, period), [data, period]);
  const changedRows = rows.filter((r) => r.changed);
  const minSince = earliestSince(data, today);
  const [sinceIn, setSinceIn] = useState<string | null>(null);
  const since = sinceIn !== null && sinceIn >= minSince ? sinceIn : defaultSince(data, period, today);
  const temps = useMemo(() => temporaryChanges(data, rows, since, period), [data, rows, since, period]);
  const [temp, setTemp] = useState<TemporaryChoice>('pin');
  const [showSame, setShowSame] = useState(false);
  const register = async () => {
    if (changedRows.length === 0) return;
    const c = registerCounts(rows, temps);
    const lines = [
      `変わる繰り返し ${c.changed}件${c.split > 0 ? `（うち曜日ごとに分ける ${c.split}件）` : ''}`,
      `${md(since)}以降の計算した回は新しい標準の担当・時刻になります。`,
      c.temporary > 0
        ? `標準と違う一時の変更 ${c.temporary}件は${temp === 'pin' ? 'ピンを立てて残します' : '標準に戻します（消します）'}。`
        : '',
      '伝えた日の回とピンの回は変えません。元に戻すで戻せます',
    ].filter(Boolean);
    const ok = await confirmDialog({ title: '標準を登録しますか？', body: lines.join('\n'), confirmLabel: '登録する' });
    if (!ok) return;
    update(
      (d) => registerStandard(d, period, since, today, { newId: () => newId('pattern'), temp, at: Date.now() }),
      '組み方の標準を登録',
    );
    toast('標準を登録しました', { action: undoAction });
  };

  const basis = scorePresetOf(data.presets, data.scorePresetId);
  const std = data.standard;
  const stdPreset = std ? data.presets.find((p) => p.id === std.presetId) : undefined;
  const weekLinks = Array.from({ length: period.weeks }, (_, i) => periodDates(period)[i * 7]!);

  return (
    <div className="stack standard-page">
      <PageHeader
        nav={<SettingsTabs />}
        icon={CalendarCheck}
        title="組み方の標準"
        lead="誰が・何曜・何時に行くかの標準を決めます。登録すると、先の週・月はこの標準で並び、AI は標準で埋まらない所だけを組みます"
      />
      <p className="sub" data-testid="standard-now">
        {std
          ? `標準：${md(std.from)}から・考え方「${stdPreset?.name ?? '消したプリセット'}」・${std.weeks}週の周期（${md(jstDate(std.at))}に登録）`
          : 'まだ標準を登録していません'}
      </p>
      <ol className="standard-steps stack" data-testid="standard-steps">
        <li className="card stack" data-step="period">
          <h2>1. 期間</h2>
          <p data-testid="standard-period">
            {md(period.from)}〜{md(period.to)}（{period.weeks}週）。{cycle.reason}
          </p>
          <label className="row">
            週の数
            <select
              value={period.weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
              data-testid="standard-weeks"
              disabled={running !== null}
            >
              {[1, 2, 3, 4].map((w) => (
                <option key={w} value={w}>
                  {w}週
                </option>
              ))}
            </select>
          </label>
          {period.weeks < cycle.weeks && (
            <p className="sub warn">周期より短いので、期間に回の無い繰り返しは今の標準のままです</p>
          )}
        </li>

        <li className="card stack" data-step="run">
          <h2>2. 考え方で作る</h2>
          <p className="sub">
            プリセットごとに期間の担当の提案を作って比べます。手で付けたピンだけを守り、今の標準の担当にはこだわりません。伝えた日は作りません
          </p>
          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void run()}
              disabled={running !== null}
              data-testid="standard-run"
            >
              {data.presets.length}つの考え方で作る
            </button>
            {running && (
              <>
                <output data-testid="standard-progress">
                  「{running.preset}」で作っています {running.day}/{running.days}日
                </output>
                <button type="button" className="btn btn-small" onClick={stop} data-testid="standard-stop">
                  止める
                </button>
              </>
            )}
          </div>
          {runError && (
            <p className="error" role="alert">
              {runError}
            </p>
          )}
          <ul className="standard-cards">
            {data.presets.map((preset, i) => {
              const s = stats[i];
              const prop = proposals.find((x) => x.presetId === preset.id);
              return (
                <li key={preset.id} className="card standard-card" data-testid="standard-card" data-preset={preset.id}>
                  <h3>
                    {i === best && <Crown size={16} aria-label="いちばん点が高い" data-testid="standard-crown" />}
                    {preset.name}
                  </h3>
                  {preset.note && <p className="sub">{preset.note}</p>}
                  {s ? (
                    <dl className="standard-stats">
                      <dt>点</dt>
                      <dd data-testid="standard-points">{s.points ?? '—'}</dd>
                      <dt>移動</dt>
                      <dd>{Math.round(s.travelMinutes / 6) / 10}時間</dd>
                      <dt>担当なし</dt>
                      <dd>{s.unassigned}件</dd>
                      <dt>件数の偏り</dt>
                      <dd
                        title={
                          s.most && s.least
                            ? `いちばん多い：${staffName(s.most.staffId)} ${s.most.count}件・いちばん少ない：${staffName(s.least.staffId)} ${s.least.count}件`
                            : undefined
                        }
                        data-testid="standard-spread"
                      >
                        {s.spread}件
                      </dd>
                      <dt>守れない条件</dt>
                      <dd>{s.hard}件</dd>
                    </dl>
                  ) : (
                    <p className="sub">{prop ? '作っています…' : 'まだ作っていません'}</p>
                  )}
                  {stale(prop) && <p className="sub warn">作ったあとに予定が変わりました（変わった日は書きません）</p>}
                  {s && prop?.done && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void pick(preset)}
                      disabled={running !== null}
                      data-testid="standard-pick"
                    >
                      この考え方で作る
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </li>

        <li className="card stack" data-step="edit">
          <h2>3. 直す</h2>
          <p className="sub">
            週の予定で担当・時刻を直してから、下で登録します。今の担当のまま登録してもかまいません（今の点数の基準：「
            {basis?.name ?? '—'}」）
          </p>
          <div className="row">
            {weekLinks.map((d) => (
              <Link key={d} to={`/week?d=${d}&mode=change`} className="btn" data-testid="standard-week-link">
                週の予定で直す（{md(d)}〜）
              </Link>
            ))}
          </div>
        </li>

        <li className="card stack" data-step="register">
          <h2>4. 標準として登録</h2>
          {rows.length === 0 ? (
            <p className="sub">期間に繰り返しの回がありません</p>
          ) : (
            <table className="standard-diff" data-testid="standard-diff">
              <thead>
                <tr>
                  <th scope="col">{terms.client}</th>
                  <th scope="col">担当</th>
                  <th scope="col">曜日ごとの開始</th>
                  <th scope="col">注意</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((r) => r.changed || showSame)
                  .map((r) => (
                    <tr key={r.patternId} data-changed={r.changed} data-testid="standard-row">
                      <th scope="row">{clientName(r.clientId)}</th>
                      <td>
                        {r.split
                          ? r.days.map((d) => `${WEEKDAY_LABELS[d.weekday]}：${staffName(d.staffId)}`).join('・')
                          : r.staff.before === r.staff.after
                            ? staffName(r.staff.after)
                            : `${staffName(r.staff.before)} → ${staffName(r.staff.after)}`}
                      </td>
                      <td>
                        {r.starts.length === 0
                          ? '—'
                          : r.starts
                              .map((s) => `${WEEKDAY_LABELS[s.weekday]} ${s.before ?? '—'} → ${s.after ?? '—'}`)
                              .join('・')}
                      </td>
                      <td>{r.warnings.map((w) => STANDARD_WARNING_TEXT[w]).join('。')}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
          {rows.length > changedRows.length && (
            <button
              type="button"
              className="btn btn-small btn-text"
              onClick={() => setShowSame((x) => !x)}
              data-testid="standard-show-same"
            >
              {showSame ? '変わらない繰り返しを畳む' : `変わらない ${rows.length - changedRows.length}件を見る`}
            </button>
          )}
          <label className="row">
            いつから
            <input
              type="date"
              value={since}
              min={minSince}
              onChange={(e) => setSinceIn(e.target.value || null)}
              data-testid="standard-since"
            />
          </label>
          {temps.length > 0 && (
            <div className="card warn stack" data-testid="standard-temp">
              <p>
                <strong>標準と違う一時の変更が {temps.length}件あります</strong>
              </p>
              <ul>
                {temps.slice(0, 10).map((t) => (
                  <li key={t.visitId}>
                    {md(t.date)} {clientName(t.clientId)}：{staffName(t.now.staffId)} {t.now.start ?? ''} → 標準{' '}
                    {staffName(t.standard.staffId)} {t.standard.start ?? ''}
                  </li>
                ))}
                {temps.length > 10 && <li>ほか {temps.length - 10}件</li>}
              </ul>
              <fieldset data-testid="standard-temp-choice">
                <legend>一時の変更をどうしますか</legend>
                <label>
                  <input type="radio" name="standard-temp" checked={temp === 'pin'} onChange={() => setTemp('pin')} />
                  ピンを立てて残す
                </label>
                <label>
                  <input type="radio" name="standard-temp" checked={temp === 'drop'} onChange={() => setTemp('drop')} />
                  標準に戻す（消す）
                </label>
              </fieldset>
            </div>
          )}
          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void register()}
              disabled={changedRows.length === 0 || running !== null}
              data-testid="standard-register"
            >
              標準として登録
            </button>
            {changedRows.length === 0 && rows.length > 0 && <span className="sub">今の標準と同じです</span>}
            {std && (
              <Link to={`/month?ym=${std.from.slice(0, 7)}&mode=change`} className="btn btn-text">
                先の月の予定を見る
              </Link>
            )}
          </div>
        </li>
      </ol>
    </div>
  );
}
