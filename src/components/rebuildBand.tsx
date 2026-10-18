// 条件を変えたら、その場で影響と「作り直す」を出す帯（PRD D161〜D165。ADR-0025 追記）。
// 設定の画面（条件の重み・相性・稼働時間・訪問の種類・特性の項目・〈スタッフ〉・〈利用者さん〉）の上に出す。
// 数え方は月の画面の要対応・進み具合の帯の「条件が変わった日」と同じ（lib/useDayStatuses）。データは書き換えない
import { RefreshCw } from 'lucide-react';
import { useDeferredValue, useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DemoData } from '../contracts/data';
import { jstDate } from '../domain/time';
import { rebuildAction, rebuildDays, rebuildSummary, rebuildText } from '../lib/rebuildBand';
import { useCompileInput } from '../lib/useDayModel';
import { useDayStatuses } from '../lib/useDayStatuses';
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
 * 数えるのは入力が止まってから（useSettled）、さらに画面を描いた後（useDeferredValue）。最初に数え終わるまでは何も出さない
 */
export function RebuildBand() {
  const { data } = useDemoData();
  const settled = useSettled(data, SETTLE_MS);
  const deferred = useDeferredValue<DemoData | null>(settled, null);
  const [later, setLater] = useState(false);
  if (!deferred) return null;
  return (
    <RebuildBandBody
      data={deferred}
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

function RebuildBandBody({ data, later, onLater }: { data: DemoData; later: boolean; onLater: () => void }) {
  const today = jstDate(Date.now());
  const compileInput = useCompileInput(data);
  const days = useMemo(() => rebuildDays(data.aiPlans, today), [data.aiPlans, today]);
  const perDay = useDayStatuses(data, compileInput, days);
  const summary = useMemo(
    () =>
      rebuildSummary(
        [...perDay.values()].map((x) => x.status),
        today,
      ),
    [perDay, today],
  );
  const action = rebuildAction(summary);
  const textId = useId();
  const noteId = useId();
  const n = summary.days.length;
  const shown = !later && action !== null;
  return (
    <>
      {shown && (
        <section
          className="card rebuild-band"
          aria-labelledby={textId}
          data-testid="rebuild-band"
          data-days={n}
          data-unconfirmed={summary.unconfirmed.length}
          data-confirmed={summary.confirmed.length}
        >
          <p id={textId} className="rb-text">
            <RefreshCw size={16} strokeWidth={2.2} aria-hidden="true" className="rb-icon" />
            <span>
              <strong>条件が変わりました</strong>：影響する日 <strong data-testid="rebuild-days">{n}日</strong>
              <span className="rb-parts">
                （未確定 {summary.unconfirmed.length}日・確定済み {summary.confirmed.length}日）
              </span>
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
            <button
              type="button"
              className="btn btn-small"
              onClick={onLater}
              title="この画面を出ている間は帯を隠します（要対応・進み具合の帯には残ります）"
              data-testid="rebuild-later"
            >
              後で
            </button>
          </span>
          <span id={noteId} className="sr-only">
            {action.note}
          </span>
        </section>
      )}
      {/* 読み上げ：数え直して変わったときだけ（区切り2の帯と同じ。開いたとき・［後で］で隠したあとは読まない） */}
      <BandLive
        text={later || n === 0 ? '' : rebuildText(summary)}
        testId="rebuild-live"
        data={{
          'data-days': n,
          'data-unconfirmed': summary.unconfirmed.length,
          'data-confirmed': summary.confirmed.length,
        }}
      />
    </>
  );
}
