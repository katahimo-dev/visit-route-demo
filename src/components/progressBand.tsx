// 月の予定の進み具合の帯（PRD D151〜D155・D332。ADR-0025 追記。週・日は1行の状態にした。ADR-0054）。
// 見ている月の今日以降について「訪問・担当が全部入った日・確定した日・要対応」と次の一手のボタンを1つ。
// 数え方は月の画面の「今月の準備」・ホームと同じ（lib/useDayStatuses と lib/month の monthProgress・attentionList）。データは書き換えない
import { Check, CircleAlert, Lock, type LucideIcon, Repeat, Sparkles } from 'lucide-react';
import { type MouseEvent, memo, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { type PrepPart, prepParts } from '../lib/glance';
import { monthLabel } from '../lib/home';
import type { MonthProgress } from '../lib/month';
import { type BandNextKind, type BandOp, bandHref, bandNext, visitsText } from '../lib/progressBand';
import './glance.css';
import './progressBand.css';

/** 帯に出すもの（見ている月の今日以降） */
export type BandModel = {
  ym: string;
  progress: MonthProgress;
  /** 担当なしの訪問がある日の数（担当を AI で組む日） */
  emptyTargets: number;
  /** 要対応のうち手当てが要る件数 */
  urgent: number;
};

const NEXT_ICON: Record<BandNextKind, LucideIcon> = {
  batch: Sparkles,
  attention: CircleAlert,
  unconfirmed: Lock,
  done: Check,
  empty: Check,
};

const PART_LABEL: Record<PrepPart['kind'], string> = {
  confirmed: '確定済み',
  planned: '担当あり（未確定）',
  none: '要対応あり',
};

/**
 * 進み具合の帯（見た目だけ）。数字とボタンは月の画面の欄（`?do=`）か担当を組むの画面（`#/arrange?ym=`）へのリンク。onOp を渡すと移らずにそれを呼ぶ（月の画面）。
 * model が null の間（数えている間）は同じ高さで「数えています」
 */
export const ProgressBand = memo(function ProgressBand({
  ym,
  model,
  primary = false,
  onOp,
}: {
  ym: string;
  model: BandModel | null;
  /** 次の一手を主ボタンにする（月の画面） */
  primary?: boolean;
  onOp?: (op: BandOp) => void;
}) {
  const month = monthLabel(ym);
  const click = (op: BandOp) => (e: MouseEvent) => {
    // Ctrl・⌘・Shift・Alt・中ボタンのクリックはブラウザに任せる（新しいタブ・窓で月の画面を開く）
    if (!onOp || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onOp(op);
  };
  if (!model) {
    return (
      <section
        className="card progress-band is-loading"
        aria-label={`${month}の進み具合`}
        aria-busy="true"
        data-testid="progress-band"
      >
        <span className="pb-month">{month}</span>
        <span className="sub">数えています…</span>
      </section>
    );
  }
  const { progress: p } = model;
  const next = bandNext(model);
  const NextIcon = NEXT_ICON[next.kind];
  const unconfirmed = p.unconfirmed.length;
  const visitsDone = p.visits > 0 && model.emptyTargets === 0;
  const planDone = p.days > 0 && p.planned === p.days;
  const confirmDone = p.days > 0 && p.confirmed === p.days;
  const parts = prepParts(p);
  const done = (x: boolean) => (x ? '（済）' : '');
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
            title={`今日以降の訪問 ${p.visits}件。押すと「担当を組む」の画面を開きます`}
            aria-label={`訪問 ${visitsText(p.visits)}${done(visitsDone)}。担当を組むの画面を開く`}
            data-testid="band-visits"
          >
            {visitsDone && <DoneMark />}
            訪問 <strong>{visitsText(p.visits)}</strong>
          </Link>
        </li>
        <li>
          <Link
            to={bandHref(ym, 'batch')}
            onClick={click('batch')}
            className={`pb-item${planDone ? ' is-done' : ''}`}
            title={`担当が全部入った日（要対応の無い日） ${p.planned}/${p.days}日（訪問のある日のうち）。押すと「担当を組む」の画面を開きます`}
            data-testid="band-plans"
            data-planned={p.planned}
            data-days={p.days}
            aria-label={`担当が全部入った日 ${p.planned}/${p.days}日${done(planDone)}。担当を組むの画面を開く`}
          >
            {planDone && <DoneMark />}担当
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
            title={`確定した日 ${p.confirmed}/${p.days}日（確定していない日 ${unconfirmed}日）。押すと月の予定の「確定していない日」を開きます`}
            data-testid="band-confirm"
            data-confirmed={p.confirmed}
            data-unconfirmed={unconfirmed}
            aria-label={`確定した日 ${p.confirmed}/${p.days}日${done(confirmDone)}（確定していない日 ${unconfirmed}日）。確定していない日を開く`}
          >
            {confirmDone && <DoneMark />}
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
            title={`要対応 ${p.attention}件（うち手当てが要るもの ${model.urgent}件）。押すと月の予定の「要対応」を開きます`}
            data-testid="band-attention"
            data-count={p.attention}
            aria-label={`要対応 ${p.attention}件${p.attention === 0 ? done(true) : model.urgent > 0 ? `（要手当て ${model.urgent}件）` : ''}。要対応を開く`}
          >
            {p.attention === 0 && <DoneMark />}
            要対応
            <strong>{p.attention}</strong>
            <span className="pb-long">件</span>
            {p.attention > 0 && model.urgent > 0 && <span className="sr-only">（要手当て）</span>}
          </Link>
        </li>
      </ul>
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
      {/* 読み上げ：数え直して変わったときだけ（最初は空の要素を置き、後から中身を入れる） */}
      <BandLive
        text={`${month}：担当 ${p.planned}/${p.days}日・確定 ${p.confirmed}/${p.days}日・要対応 ${p.attention}件。次は${next.label}`}
      />
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

/** 済みの ✓（読み上げは「済」） */
function DoneMark() {
  return (
    <>
      <Check size={13} strokeWidth={3} aria-hidden="true" />
      <span className="sr-only">済</span>
    </>
  );
}

/**
 * 帯の読み上げの領域（aria-live）。最初は空のまま置き、描いた後に数えた結果が変わったとき（確定した・担当を組んだなど）だけ中身を入れる
 * （開いたとき・画面を移ったときには読み上げない）
 */
export function BandLive({
  text,
  testId = 'band-live',
  data,
}: {
  text: string;
  testId?: string;
  /** e2e が読む data-* 属性 */
  data?: Record<`data-${string}`, string | number>;
}) {
  const [said, setSaid] = useState('');
  const first = useRef(text);
  useEffect(() => {
    if (text !== first.current) {
      first.current = text;
      setSaid(text);
    }
  }, [text]);
  return (
    <span className="sr-only" aria-live="polite" data-testid={testId} {...data}>
      {said}
    </span>
  );
}
