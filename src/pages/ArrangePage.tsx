// 担当を組む（#/arrange。ADR-0063）：AI で担当を組むのはこの画面と組み方の標準だけ。予定（月・週・日）は手で直す。
// 範囲（月・週・日）を選び、選んだ範囲の担当なし・要対応を見て、「AI で組む」で範囲の提案を出す（lib/monthBatch。画面の外で計算し、
// ほかの画面へ移っても続く。ADR-0042）。提案は範囲の提案の帯で見て［反映する］［捨てる］（反映は全体の「元に戻す」で1手戻る）。
// 考え方（プリセット）を選んで組める（データの条件は書き換えない）。日を選んで「案を比べる」（#/compare）へ移れる
import { CalendarDays, GitCompareArrows, Sparkles, Square } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrangeTabs } from '../components/ArrangeTabs';
import { useConfirm } from '../components/ConfirmDialog';
import { FieldError } from '../components/FieldError';
import { confirmDropProposal, RangeProposalBand } from '../components/scheduleParts';
import { useToast } from '../components/Toast';
import { PageHeader, WithIcon } from '../components/ui';
import type { Rule } from '../contracts/rules';
import { jstDate } from '../domain/time';
import { dateText } from '../lib/common';
import { isDate } from '../lib/isDate';
import { addMonths, type BatchMode, batchTargets, monthDates, ymOf } from '../lib/month';
import { type BatchSource, dayLabel, monthBatch, weekLabel } from '../lib/monthBatch';
import { mdText } from '../lib/patternText';
import { planYm } from '../lib/scheduleMode';
import { useCompileInput } from '../lib/useDayModel';
import { useDayStatuses } from '../lib/useDayStatuses';
import { useFeature } from '../lib/useFeature';
import { useValueStore } from '../lib/valueStore';
import { weekDates, weekStart } from '../lib/week';
import { applyPreset, scorePresetOf } from '../seed';
import { useDemoData } from '../store';
import './arrange.css';

/** 範囲の呼び名 */
const SCOPE_LABEL: Record<BatchSource, string> = { month: '月', week: '週', day: '日' };
const SCOPES: readonly BatchSource[] = ['month', 'week', 'day'];

/** 1日あたりの見込み（秒）：1日 約3〜5秒 */
const SEC_MIN = 3;
const SEC_MAX = 5;
function etaText(days: number): string {
  const lo = days * SEC_MIN;
  const hi = days * SEC_MAX;
  if (hi < 60) return `約${lo}〜${hi}秒`;
  return `約${Math.max(1, Math.round(lo / 60))}〜${Math.ceil(hi / 60)}分`;
}

const ymText = (ym: string) => `${ym.slice(0, 4)}年${Number(ym.slice(5, 7))}月`;
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * URL から範囲を読む：?date=（日）・?d=（週。その日の週）・?ym=（月）の順。無ければ月（月の後半なら来月、前半なら今月）
 */
function scopeOf(params: URLSearchParams, today: string): { scope: BatchSource; ym: string; at: string } {
  const day = params.get('date');
  if (day && isDate(day)) return { scope: 'day', ym: ymOf(day), at: day };
  const week = params.get('d');
  if (week && isDate(week)) return { scope: 'week', ym: ymOf(week), at: weekStart(week) };
  const ym = params.get('ym');
  const m = ym && YM_RE.test(ym) ? ym : planYm(today);
  return { scope: 'month', ym: m, at: m === ymOf(today) ? today : `${m}-01` };
}

export default function ArrangePage() {
  const { data } = useDemoData();
  const compileInput = useCompileInput(data);
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const confirmDialog = useConfirm();
  const rulesOn = useFeature('rules');
  const compareOn = useFeature('compare');
  const ids = useId();
  const today = jstDate(Date.now());
  const { scope, ym, at } = scopeOf(params, today);

  /** 範囲の日付（月はその月、週は月曜からの7日、日はその日） */
  const dates = useMemo(
    () => (scope === 'month' ? monthDates(ym) : scope === 'week' ? weekDates(at) : [at]),
    [scope, ym, at],
  );
  const statuses = useDayStatuses(data, compileInput, dates);
  /** 範囲の今日以降の担当なし・要対応（日の状態の数え方。月の予定と同じ） */
  const counts = useMemo(() => {
    let unassigned = 0;
    let unassignedDays = 0;
    let care = 0;
    for (const d of dates) {
      if (d < today) continue;
      const s = statuses.get(d)?.status;
      if (!s) continue;
      unassigned += s.unassigned;
      if (s.unassigned > 0) unassignedDays++;
      care += s.care;
    }
    return { unassigned, unassignedDays, care };
  }, [dates, statuses, today]);

  /** 作り方：要対応のある日だけ（既定。手で決めた担当を変えうる組み直しを既定にしない）／伝えていない日すべて */
  const [mode, setMode] = useState<BatchMode>('care');
  const targetsOf = (m: BatchMode) => batchTargets(data, dates, today, m, (d) => statuses.get(d)?.status);
  const careTargets = targetsOf('care');
  const allTargets = targetsOf('all');
  const targets = mode === 'care' ? careTargets : allTargets;

  /** 考え方（プリセット）。'' は点数の基準の重み（今の条件） */
  const basePreset = scorePresetOf(data.presets, data.scorePresetId);
  const [presetId, setPresetId] = useState('');
  const preset = rulesOn ? (data.presets.find((p) => p.id === presetId) ?? null) : null;

  const run = useValueStore(monthBatch.run);
  const done = useValueStore(monthBatch.done);
  const [error, setError] = useState<string | null>(null);
  const shownError = error ?? done?.error ?? null;

  /** 範囲の呼び名（「11月」「11/2〜11/8の週」「11/3」） */
  const rangeLabel =
    scope === 'month' ? `${Number(ym.slice(5, 7))}月` : scope === 'week' ? weekLabel(at) : dayLabel(at);

  /** 範囲を変える（URL に書く。ほかのクエリは残さない） */
  const pick = (next: BatchSource, value?: string) => {
    setError(null);
    if (next === 'month') setParams({ ym: value ?? ym }, { replace: true });
    else if (next === 'week') setParams({ d: weekStart(value ?? at) }, { replace: true });
    else setParams({ date: value ?? at }, { replace: true });
  };
  /** 月を選ぶ欄の月：今月から6か月と、見ている月 */
  const monthOptions = useMemo(
    () => [...new Set([...Array.from({ length: 6 }, (_, i) => addMonths(ymOf(today), i)), ym])].sort(),
    [today, ym],
  );

  /** 選んだ範囲を AI で組む（ピンの訪問はそのまま。終わったら提案の帯。反映するまで訪問は変わらない） */
  const start = async () => {
    if (monthBatch.running()) return;
    setError(null);
    if (targets.length === 0) {
      setError('組む日がありません（今日より前の日・確定した日は組みません）');
      return;
    }
    if (!(await confirmDropProposal(confirmDialog)) || monthBatch.running()) return;
    const rules: Rule[] | undefined = preset ? applyPreset(data.rules, preset) : undefined;
    const ok = monthBatch.start({
      ym,
      label: preset ? `${rangeLabel}（${preset.name}）` : rangeLabel,
      mode,
      days: targets.map((date) => ({ date, mode })),
      today,
      source: scope,
      rangeStart: scope === 'month' ? null : at,
      ...(rules ? { rules } : {}),
    });
    if (!ok) toast('ほかの担当を組んでいます。終わってから押してください');
  };

  /** 案を比べる日（範囲の中の今日以降の最初の訪問のある日。選び直せる） */
  const firstDay = allTargets[0] ?? dates.find((d) => d >= today) ?? dates[0]!;
  const [compareDay, setCompareDay] = useState<string | null>(null);
  const compareDate = compareDay && dates.includes(compareDay) ? compareDay : firstDay;

  const progressValue = run ? run.index + (run.total > 0 ? Math.min(1, run.iteration / run.total) : 0) : 0;
  const making = run ? run.targets[run.index] : undefined;

  return (
    <div className="stack arrange-page">
      <PageHeader
        nav={<ArrangeTabs />}
        icon={Sparkles}
        title="担当を組む"
        lead="範囲を選んで AI で担当を組み、提案を見て反映します。予定（月・週・日）では手で直します"
      />

      <section className="card stack" aria-labelledby={`${ids}-range`} data-testid="arrange-range">
        <h2 id={`${ids}-range`} className="arrange-title">
          範囲
        </h2>
        <div className="row arrange-range-row">
          <fieldset className="segmented" aria-label="範囲の大きさ" data-testid="arrange-scope">
            {SCOPES.map((s) => (
              <button
                key={s}
                type="button"
                className={scope === s ? 'is-on' : undefined}
                aria-pressed={scope === s}
                onClick={() => pick(s)}
                data-scope={s}
              >
                {SCOPE_LABEL[s]}
              </button>
            ))}
          </fieldset>
          {scope === 'month' ? (
            <select
              aria-label="月を選ぶ"
              value={ym}
              onChange={(e) => pick('month', e.target.value)}
              data-testid="arrange-month"
            >
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {ymText(m)}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="date"
              aria-label={scope === 'week' ? '週の中の日を選ぶ' : '日を選ぶ'}
              value={at}
              onChange={(e) => isDate(e.target.value) && pick(scope, e.target.value)}
              data-testid="arrange-date"
            />
          )}
          <span className="sub" data-testid="arrange-range-label">
            {scope === 'week' ? rangeLabel : scope === 'day' ? dateText(at) : ymText(ym)}
          </span>
        </div>
        <p className="arrange-counts" data-testid="arrange-counts">
          今日以降：担当なしの訪問{' '}
          <strong data-testid="arrange-unassigned" data-count={counts.unassigned}>
            {counts.unassigned}件
          </strong>
          （{counts.unassignedDays}日）・要対応{' '}
          <strong data-testid="arrange-care" data-count={counts.care}>
            {counts.care}件
          </strong>
        </p>
      </section>

      <section className="card stack" aria-labelledby={`${ids}-run`} data-testid="arrange-run">
        <h2 id={`${ids}-run`} className="arrange-title">
          AI で組む
        </h2>
        <fieldset className="stack batch-mode" style={{ gap: 6 }}>
          <legend>組む日</legend>
          <label className="check">
            <input
              type="radio"
              name="arrange-mode"
              checked={mode === 'care'}
              onChange={() => setMode('care')}
              style={{ width: 'auto' }}
              data-testid="arrange-mode-care"
            />
            要対応のある日だけ（{careTargets.length}日）
          </label>
          <label className="check">
            <input
              type="radio"
              name="arrange-mode"
              checked={mode === 'all'}
              onChange={() => setMode('all')}
              style={{ width: 'auto' }}
              data-testid="arrange-mode-all"
            />
            伝えていない日をすべて組み直す（{allTargets.length}日）
          </label>
        </fieldset>
        {rulesOn && data.presets.length > 0 && (
          <label className="stack arrange-preset" style={{ gap: 4 }}>
            <span>考え方（プリセット）</span>
            <select value={presetId} onChange={(e) => setPresetId(e.target.value)} data-testid="arrange-preset">
              <option value="">点数の基準（{basePreset?.name ?? '今の重み'}）</option>
              {data.presets
                .filter((p) => p.id !== basePreset?.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
            <span className="sub">選んだ考え方の重みで組みます。点数の基準と条件の重みは変わりません</span>
          </label>
        )}
        <p data-testid="arrange-count">
          組む日：<strong>{targets.length}日</strong>
          {targets.length > 0 && <span className="sub">（見込み {etaText(targets.length)}）</span>}
        </p>
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            aria-disabled={run !== null || targets.length === 0 || undefined}
            onClick={() => void start()}
            data-testid="arrange-start"
          >
            <WithIcon icon={Sparkles}>{run ? '組んでいます…' : 'AI で組む'}</WithIcon>
          </button>
        </div>
        {run && (
          <div className="stack month-progress" style={{ gap: 4 }} data-testid="arrange-progress">
            <progress
              value={progressValue}
              max={Math.max(1, run.targets.length)}
              aria-label="担当を組む進み具合"
              style={{ width: '100%' }}
            />
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span className="sub" aria-live="polite">
                {run.label}：{making ? `${mdText(making)}・` : ''}
                {Math.min(run.index + 1, run.targets.length)}/{run.targets.length}日（組めた日 {run.made}日）
              </span>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => monthBatch.stop()}
                data-testid="arrange-stop"
              >
                <WithIcon icon={Square} size={14}>
                  止める
                </WithIcon>
              </button>
            </div>
          </div>
        )}
        <FieldError>{shownError}</FieldError>
        <p className="sub">
          ピンの訪問（手で替えた訪問・組み方の標準の担当）はそのままで、ほかの訪問の担当と時刻を組みます。今日より前の日・確定した日は組みません。
          1日ずつ組み、終わったら提案を出します。見て「反映する」と担当が変わります（「元に戻す」で戻せます）。ほかの画面へ移っても組み続けます。
        </p>
      </section>

      {/* 組んだ提案（日・週・月の予定にも同じ帯が出る。PRD D328） */}
      <RangeProposalBand />

      {compareOn && (
        <section className="card stack" aria-labelledby={`${ids}-compare`} data-testid="arrange-compare">
          <h2 id={`${ids}-compare`} className="arrange-title">
            案を比べる
          </h2>
          <p className="sub">1日を選び、今の担当と考え方ごとの提案を並べて比べます（保存しません）</p>
          <div className="row">
            <input
              type="date"
              aria-label="比べる日"
              value={compareDate}
              min={dates[0]}
              max={dates[dates.length - 1]}
              onChange={(e) => isDate(e.target.value) && setCompareDay(e.target.value)}
              data-testid="arrange-compare-date"
            />
            <Link className="btn" to={`/compare?date=${compareDate}`} data-testid="arrange-compare-open">
              <WithIcon icon={GitCompareArrows}>{dateText(compareDate)}の案を比べる</WithIcon>
            </Link>
            <Link className="btn btn-text" to={`/plan?date=${compareDate}`} data-testid="arrange-day-open">
              <WithIcon icon={CalendarDays}>日の予定を見る</WithIcon>
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
