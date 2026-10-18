// 予定（月・週・日）に共通の進み具合の帯（PRD D151〜D155。ADR-0025 追記）。
// 見ている月の今日以降について「訪問・案を作った日・確定した日・要対応」と次の一手のボタンを1つ。
// 数え方は月の画面の「今月の準備」・ホームと同じ（lib/useDayStatuses と lib/month の monthProgress・attentionList）。データは書き換えない
import { Check, CircleAlert, Lock, type LucideIcon, Repeat, Sparkles } from 'lucide-react';
import { type MouseEvent, memo, useDeferredValue, useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { DemoData } from '../contracts/data';
import { jstDate } from '../domain/time';
import { type PrepPart, prepParts } from '../lib/glance';
import { monthLabel } from '../lib/home';
import {
  attentionList,
  batchTargets,
  type DayState,
  type DayStatus,
  expandMonth,
  type MonthProgress,
  monthDates,
  monthProgress,
} from '../lib/month';
import {
  type BandNextKind,
  type BandOp,
  bandHref,
  bandMonth,
  bandNext,
  urgentCount,
  visitsText,
} from '../lib/progressBand';
import { useCompileInput } from '../lib/useDayModel';
import { useDayStatuses } from '../lib/useDayStatuses';
import { useDemoData } from '../store';
import './glance.css';
import './progressBand.css';

/** 帯に出すもの（見ている月の今日以降） */
export type BandModel = {
  ym: string;
  progress: MonthProgress;
  /** 定期パターンからまだ作っていない訪問の件数 */
  canExpand: number;
  /** 訪問を作ったあとの「まだ案の無い日だけ」の対象の日数 */
  emptyTargets: number;
  /** 要対応のうち手当てが要る件数 */
  urgent: number;
};

/** 日の画面で選んでいる日の状態（帯の「この日」） */
export type BandDay = { date: string; status: DayStatus | null };

const NEXT_ICON: Record<BandNextKind, LucideIcon> = {
  batch: Sparkles,
  attention: CircleAlert,
  unconfirmed: Lock,
  done: Check,
  empty: Check,
};

const DAY_STATE: Record<DayState, string> = {
  none: '案なし',
  plan: '未確定',
  diff: '未確定の変更あり',
  confirmed: '確定済み',
};

const PART_LABEL: Record<PrepPart['kind'], string> = {
  confirmed: '確定済み',
  planned: '案あり（未確定）',
  none: '案なし',
};

/**
 * 進み具合の帯（見た目だけ）。数字とボタンは月の画面の欄へのリンク（`?do=`）。onOp を渡すと移らずにそれを呼ぶ（月の画面）。
 * model が null の間（数えている間）は同じ高さで「数えています」
 */
export const ProgressBand = memo(function ProgressBand({
  ym,
  model,
  day,
  primary = false,
  onOp,
}: {
  ym: string;
  model: BandModel | null;
  day?: BandDay;
  /** 次の一手を主ボタンにする（月の画面。週・日は画面の主ボタンと重ねない） */
  primary?: boolean;
  onOp?: (op: BandOp) => void;
}) {
  const month = monthLabel(ym);
  const click = (op: BandOp) => (e: MouseEvent) => {
    if (!onOp) return;
    e.preventDefault();
    onOp(op);
  };
  if (!model) {
    return (
      <section className="card progress-band is-loading" aria-label={`${month}の進み具合`} data-testid="progress-band">
        <span className="pb-month">{month}</span>
        <span className="sub" aria-live="polite">
          数えています…
        </span>
      </section>
    );
  }
  const { progress: p, canExpand } = model;
  const next = bandNext(model);
  const NextIcon = NEXT_ICON[next.kind];
  const unconfirmed = p.unconfirmed.length;
  const visitsDone = p.visits > 0 && canExpand === 0;
  const planDone = p.days > 0 && p.planned === p.days;
  const confirmDone = p.days > 0 && p.confirmed === p.days;
  const parts = prepParts(p);
  const dayState = day?.status ? (day.status.count === 0 ? '訪問なし' : DAY_STATE[day.status.state]) : null;
  /** 案があって確定していない日（日の画面の「この割当で確定」で確定する。PRD D155） */
  const dayOpen = !!day?.status && day.status.count > 0 && (day.status.state === 'plan' || day.status.state === 'diff');
  return (
    <section
      className="card progress-band"
      aria-label={`${month}の進み具合（今日以降）`}
      data-testid="progress-band"
      data-ym={ym}
      data-next={next.kind}
    >
      <span className="pb-month" title="今日以降の日を数えます">
        {month}
      </span>
      <ul className="pb-items">
        <li className="pb-visits">
          <Link
            to={bandHref(ym, 'batch')}
            onClick={click('batch')}
            className={`pb-item${visitsDone ? ' is-done' : ''}`}
            title={`今日以降の訪問 ${p.visits}件${canExpand > 0 ? `。定期パターンからまだ作っていない訪問 ${canExpand}件` : ''}。押すと月の画面の「まとめて作る」の欄を開きます`}
            data-testid="band-visits"
          >
            {visitsDone && <Check size={13} strokeWidth={3} aria-hidden="true" />}
            訪問 <strong>{visitsText(p.visits, canExpand)}</strong>
          </Link>
        </li>
        <li>
          <Link
            to={bandHref(ym, 'batch')}
            onClick={click('batch')}
            className={`pb-item${planDone ? ' is-done' : ''}`}
            title={`案を作った日 ${p.planned}/${p.days}日（訪問のある日のうち）。押すと月の画面の「まとめて作る」の欄を開きます`}
            data-testid="band-plans"
            data-planned={p.planned}
            data-days={p.days}
          >
            {planDone && <Check size={13} strokeWidth={3} aria-hidden="true" />}案
            <strong>
              {p.planned}/{p.days}
            </strong>
            <span className="pb-long">日</span>
          </Link>
        </li>
        <li>
          <Link
            to={bandHref(ym, 'unconfirmed')}
            onClick={click('unconfirmed')}
            className={`pb-item${confirmDone ? ' is-done' : ''}`}
            title={`確定した日 ${p.confirmed}/${p.days}日（確定していない日 ${unconfirmed}日）。押すと月の画面の「確定していない日」を開きます`}
            data-testid="band-confirm"
            data-confirmed={p.confirmed}
            data-unconfirmed={unconfirmed}
          >
            {confirmDone && <Check size={13} strokeWidth={3} aria-hidden="true" />}
            確定
            <strong>
              {p.confirmed}/{p.days}
            </strong>
            <span className="pb-long">日</span>
          </Link>
        </li>
        <li>
          <Link
            to={bandHref(ym, 'attention')}
            onClick={click('attention')}
            className={`pb-item${p.attention === 0 ? ' is-done' : model.urgent > 0 ? ' is-warn' : ''}`}
            title={`要対応 ${p.attention}件（うち手当てが要るもの ${model.urgent}件）。押すと月の画面の「要対応」を開きます`}
            data-testid="band-attention"
            data-count={p.attention}
          >
            要対応
            <strong>{p.attention}</strong>
            <span className="pb-long">件</span>
          </Link>
        </li>
      </ul>
      {day && dayState && (
        <span className={`pb-day${dayOpen ? ' is-open' : ''}`} data-testid="band-day" data-state={day.status?.state}>
          この日 <strong>{dayState}</strong>
          {dayOpen && <span className="sub pb-long">（「この割当で確定」で確定）</span>}
        </span>
      )}
      <span className="pb-next">
        {next.kind === 'done' || next.kind === 'empty' ? (
          <span
            className={`pb-status${next.kind === 'done' ? ' is-done' : ''}`}
            data-testid="band-next"
            data-kind={next.kind}
          >
            <NextIcon size={14} strokeWidth={3} aria-hidden="true" />
            <span className="pb-label-long">{next.label}</span>
            <span className="pb-label-short">{next.short}</span>
          </span>
        ) : (
          <Link
            to={bandHref(ym, next.kind)}
            onClick={click(next.kind)}
            className={`btn btn-small${primary ? ' btn-primary' : ''}`}
            data-testid="band-next"
            data-kind={next.kind}
            aria-label={`${month}：${next.label}`}
          >
            <span className="with-icon">
              {next.kind === 'batch' && p.days === 0 ? (
                <Repeat size={14} strokeWidth={2.2} aria-hidden="true" />
              ) : (
                <NextIcon size={14} strokeWidth={2.2} aria-hidden="true" />
              )}
              <span className="pb-label-long">{next.label}</span>
              <span className="pb-label-short">{next.short}</span>
            </span>
          </Link>
        )}
      </span>
      {p.days > 0 && (
        <span
          className="prep-bar pb-bar"
          aria-hidden="true"
          title={parts.map((x) => `${PART_LABEL[x.kind]} ${x.days}日`).join('・')}
        >
          {parts
            .filter((x) => x.days > 0)
            .map((x) => (
              <span key={x.kind} className={`prep-part is-${x.kind}`} style={{ flexGrow: x.days }} />
            ))}
        </span>
      )}
    </section>
  );
});

/**
 * 帯に出すものを数える（週・日の画面）。月の画面と同じ数え方：その月の今日以降の日を useDayStatuses で compile・採点し、
 * monthProgress・attentionList・定期パターンから作れる訪問・まとめて作るの対象。
 * extraDate（日の画面で選んでいる日）が今日より前でも、その日の状態だけは数える（進み具合には入れない）
 */
function useBandModel(data: DemoData, ym: string, today: string, extraDate?: string) {
  const compileInput = useCompileInput(data);
  const days = useMemo(() => monthDates(ym).filter((d) => d >= today || d === extraDate), [ym, today, extraDate]);
  const perDay = useDayStatuses(data, compileInput, days);
  const preview = useMemo(() => expandMonth(data, ym, today), [data, ym, today]);
  const model = useMemo((): BandModel => {
    const statusOf = (d: string) => perDay.get(d)?.status;
    const progress = monthProgress(data, ym, today, undefined, statusOf);
    const statuses = days.flatMap((d) => (d >= today ? (statusOf(d) ?? []) : []));
    const staleOf = (d: string) => statusOf(d)?.stale ?? false;
    return {
      ym,
      progress,
      canExpand: preview.added,
      emptyTargets: batchTargets(preview.data, ym, today, 'empty', staleOf).length,
      urgent: urgentCount(attentionList(data, statuses, today)),
    };
  }, [data, ym, today, days, perDay, preview]);
  const day = extraDate ? (perDay.get(extraDate)?.status ?? null) : null;
  return { model, day };
}

/** 数える中身（データが来てから描く） */
function ScheduleBandBody({ data, date, withDay }: { data: DemoData; date: string; withDay: boolean }) {
  const today = jstDate(Date.now());
  const ym = bandMonth(date);
  const { model, day } = useBandModel(data, ym, today, withDay ? date : undefined);
  return <ProgressBand ym={ym} model={model} day={withDay ? { date, status: day } : undefined} />;
}

/**
 * 週・日の画面の帯（PRD D151）。選んでいる日付の月を数える。計算は useDeferredValue で描画の後へ回し
 * （開いたとき・手直しのたびに画面の描画を待たせない）、最初の描画の間は「数えています」
 */
export function ScheduleBand({ date, withDay = false }: { date: string; withDay?: boolean }) {
  const { data } = useDemoData();
  const deferred = useDeferredValue<DemoData | null>(data, null);
  const deferredDate = useDeferredValue(date);
  if (!deferred) return <ProgressBand ym={bandMonth(date)} model={null} />;
  return <ScheduleBandBody data={deferred} date={deferredDate} withDay={withDay} />;
}
