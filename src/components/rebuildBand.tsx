// 条件を変えたら、その場で影響と「作り直す」を出す帯（PRD D161〜D166。ADR-0025 追記）。
// 設定の画面（条件の重み・相性・稼働時間・訪問の種類・特性の項目・〈スタッフ〉・〈利用者さん〉）の上に出す。
// 数え方は月の画面の要対応・進み具合の帯の「条件が変わった日」と同じ（lib/useDayStatuses）。データは書き換えない
import { RefreshCw, SlidersHorizontal } from 'lucide-react';
import { type RefObject, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DemoData } from '../contracts/data';
import { jstDate } from '../domain/time';
import { isHrefOn } from '../lib/features';
import {
  customRulesText,
  REBUILD_CLEARED,
  rebuildAction,
  rebuildDays,
  rebuildSummary,
  rebuildText,
  rebuildWith,
  recreateTodayHref,
} from '../lib/rebuildBand';
import { useCompileInput } from '../lib/useDayModel';
import { useDayStatuses } from '../lib/useDayStatuses';
import { useFeatures } from '../lib/useFeature';
import { SavePresetForm } from '../pages/planParts';
import { presetOf, scorePresetOf } from '../seed';
import { useDemoData } from '../store';
import { BandLive } from './progressBand';
import './rebuildBand.css';

/** 入力が止まってから数え直すまで（ミリ秒。スライダーを動かす・相性のセルを続けて押す間は数えない。PRD D165） */
export const SETTLE_MS = 600;

/** 値が SETTLE_MS のあいだ変わらなくなったら、その値を返す（最初は渡した値そのもの） */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(value, settled)) return;
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, settled, ms]);
  return settled;
}

/**
 * 作り直しの帯（PRD D161）。［後で］はこの画面を出ている間だけ隠す（データには保存しない。画面を移ると key で作り直されて戻る。PRD D164）。
 * 数えるのは入力が止まってから（useSettled）、さらに画面を描いた後（useDeferredValue）。最初に数え終わるまでは影響する日を出さない。
 * 条件の重みの画面（rules）では、いまの条件がどのプリセットとも同じでなければ、いまの条件の使われ方の案内を同じ帯の2行目に出す（PRD D166）
 */
export function RebuildBand({ rules = false }: { rules?: boolean }) {
  const { data } = useDemoData();
  const settled = useSettled(data, SETTLE_MS);
  const deferred = useDeferredValue<DemoData | null>(settled, null);
  const [later, setLater] = useState(false);
  const basis = scorePresetOf(data.presets, data.scorePresetId)?.name ?? 'いまの条件';
  // 案内は入力のたびに数えても軽い（重み・必須の比べだけ）
  const custom = rules && presetOf(data.rules, data.presets) === null;
  return (
    <RebuildBandBody
      data={deferred}
      basis={basis}
      custom={custom}
      later={later}
      onLater={() => {
        setLater(true);
        // 押したボタンが消えるので、フォーカスは画面の見出しへ（無ければ本文）
        const to =
          document.querySelector<HTMLElement>('.app-main h1') ?? document.querySelector<HTMLElement>('.app-main');
        if (to) {
          if (!to.hasAttribute('tabindex')) to.setAttribute('tabindex', '-1');
          to.focus({ preventScroll: true });
        }
      }}
    />
  );
}

/** 数える中身（data が null の間はまだ数えていない） */
function useSummary(data: DemoData | null, today: string) {
  const empty = data ?? EMPTY;
  const compileInput = useCompileInput(empty);
  const days = useMemo(() => (data ? rebuildDays(data.aiPlans, today) : []), [data, today]);
  const perDay = useDayStatuses(empty, compileInput, days);
  return useMemo(
    () =>
      data
        ? rebuildSummary(
            [...perDay.values()].map((x) => x.status),
            today,
            data.manualPlans,
          )
        : null,
    [data, perDay, today],
  );
}
/** まだ数えていない間に渡す空のデータ（数える日が無いので compile しない） */
const EMPTY = {
  org: {},
  items: [],
  rules: [],
  presets: [],
  staff: [],
  clients: [],
  compat: {},
  visits: [],
  availability: [],
  absences: [],
  visitTypes: [],
  patterns: [],
  clientLeaves: [],
  aiPlans: {},
  aiRuns: {},
  manualPlans: {},
} as unknown as DemoData;

function RebuildBandBody({
  data,
  basis,
  custom,
  later,
  onLater,
}: {
  data: DemoData | null;
  basis: string;
  custom: boolean;
  later: boolean;
  onLater: () => void;
}) {
  const today = jstDate(Date.now());
  const summary = useSummary(data, today);
  /** ［今日の案をいまの条件で作り直す］を出すか（条件の重みとプリセットを切っていれば出さない。PRD D213） */
  const todayOn = isHrefOn(useFeatures(), recreateTodayHref(today));
  const action = summary ? rebuildAction(summary, basis) : null;
  const textId = useId();
  const noteId = useId();
  const customId = useId();
  const n = summary?.days.length ?? 0;
  const shown = !later && (action !== null || custom);
  // 0日になって帯が消えるときは1度だけ「影響する日は無くなりました」（PRD D164）
  const [had, setHad] = useState(false);
  useEffect(() => {
    if (n > 0) setHad(true);
  }, [n]);
  const liveText = later ? '' : n > 0 && summary ? rebuildText(summary) : had ? REBUILD_CLEARED : '';
  const ref = useRef<HTMLElement>(null);
  useStickyPadding(ref, shown);
  return (
    <>
      {shown && (
        <section
          ref={ref}
          className="card rebuild-band"
          aria-labelledby={action ? textId : customId}
          data-testid="rebuild-band"
          data-days={n}
          data-unconfirmed={summary?.unconfirmed.length ?? 0}
          data-confirmed={summary?.confirmed.length ?? 0}
        >
          {action && summary && (
            <div className="rb-row" data-testid="rebuild-days-row">
              <p id={textId} className="rb-text">
                <RefreshCw size={16} strokeWidth={2.2} aria-hidden="true" className="rb-icon" />
                <span>
                  <strong>条件が変わりました</strong>：影響する日 <strong data-testid="rebuild-days">{n}日</strong>
                  <span className="rb-parts">
                    （未確定 {summary.unconfirmed.length}日・確定済み {summary.confirmed.length}日）
                  </span>
                  {summary.unconfirmed.length > 0 && (
                    <span className="rb-with" data-testid="rebuild-with">
                      {rebuildWith(basis)}
                    </span>
                  )}
                </span>
              </p>
              <span className="rb-actions">
                <Link
                  to={action.href}
                  className="btn btn-small"
                  title={action.note}
                  aria-describedby={noteId}
                  data-testid="rebuild-go"
                >
                  <span className="with-icon">
                    <RefreshCw size={14} strokeWidth={2.2} aria-hidden="true" />
                    {action.label}
                  </span>
                </Link>
                <LaterButton onLater={onLater} />
              </span>
              <span id={noteId} className="sr-only">
                {action.note}
              </span>
            </div>
          )}
          {custom && (
            <div className="rb-row rb-custom" data-testid="rebuild-custom">
              <p id={customId} className="rb-text">
                <SlidersHorizontal size={16} strokeWidth={2.2} aria-hidden="true" className="rb-icon" />
                <span>{customRulesText(basis)}</span>
              </p>
              <span className="rb-actions">
                {/* ?do=recreate は条件の重みとプリセット（rules）の入口 */}
                {todayOn && (
                  <Link to={recreateTodayHref(today)} className="btn btn-small" data-testid="rebuild-today">
                    今日の案をいまの条件で作り直す
                  </Link>
                )}
                <SavePresetForm compact />
                {!action && <LaterButton onLater={onLater} />}
              </span>
            </div>
          )}
        </section>
      )}
      {/* 読み上げ：数え直して変わったときだけ（区切り2の帯と同じ。開いたとき・［後で］で隠したあとは読まない） */}
      <BandLive
        text={liveText}
        testId="rebuild-live"
        data={{
          'data-ready': summary ? 1 : 0,
          'data-days': n,
          'data-unconfirmed': summary?.unconfirmed.length ?? 0,
          'data-confirmed': summary?.confirmed.length ?? 0,
        }}
      />
    </>
  );
}

function LaterButton({ onLater }: { onLater: () => void }) {
  return (
    <button
      type="button"
      className="btn btn-small"
      onClick={onLater}
      title="この画面を出ている間は帯を隠します（要対応・進み具合の帯には残ります）"
      data-testid="rebuild-later"
    >
      後で
    </button>
  );
}

/**
 * 帯が上に貼り付いている間（広い画面）は、帯の高さを CSS 変数 --rebuild-band-h に入れ、html の scroll-padding-top を
 * 上の帯と帯の高さぶん取る（Tab で入った入力欄が帯の下に隠れない。PR #40 のレビュー）。帯が消えたら戻す
 */
function useStickyPadding(ref: RefObject<HTMLElement | null>, shown: boolean) {
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!shown || !el) return;
    const set = () => {
      const sticky = getComputedStyle(el).position === 'sticky';
      if (sticky) {
        root.style.setProperty('--rebuild-band-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
        root.style.scrollPaddingTop = 'calc(var(--header-h) + var(--rebuild-band-h) + 8px)';
      } else {
        root.style.removeProperty('--rebuild-band-h');
        root.style.scrollPaddingTop = '';
      }
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--rebuild-band-h');
      root.style.scrollPaddingTop = '';
    };
  }, [ref, shown]);
}
