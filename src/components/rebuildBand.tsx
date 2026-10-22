// 条件を変えたら、その場で影響と「作り直す」を出す帯（PRD D161〜D166。ADR-0025 追記）。
// 設定の画面（条件の重み・相性・稼働時間・訪問の種類・特性の項目・〈スタッフ〉・〈利用者さん〉）の上に出す。
// 数え方は月の画面の要対応・進み具合の帯の「条件が変わった日」と同じ（lib/useDayStatuses）。
// 何が変わったか（条件の変更の控えと今の違い）と「戻す」も出す（PRD D290〜D292。ADR-0049）。データは store の update(fn) でだけ書く
import { RefreshCw, SlidersHorizontal, Undo2 } from 'lucide-react';
import { type RefObject, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DemoData } from '../contracts/data';
import { jstDate } from '../domain/time';
import {
  type ConditionChange,
  canRevert,
  changeLine,
  changesToggleText,
  conditionChanges,
  madeWeightsChange,
  NO_MORE_TEXT,
  NO_RECORD_TEXT,
  NO_REVERT_TEXT,
  revertAll,
  revertBody,
  sinceText,
} from '../lib/conditionChanges';
import { isHrefOn } from '../lib/features';
import { currentRuleKeys, rulesStale } from '../lib/month';
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
import { useFeature, useFeatures } from '../lib/useFeature';
import { SavePresetForm } from '../pages/planParts';
import { presetOf, scorePresetOf } from '../seed';
import { useDemoData } from '../store';
import { useConfirm } from './ConfirmDialog';
import { BandLive } from './progressBand';
import { Term } from './Term';
import { useToast } from './Toast';
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
 * 条件の重みの画面（rules）では、この日だけ試す重みがどのプリセットとも同じでなければ、試す重みの使われ方の案内を同じ帯の2行目に出す（PRD D166・D234）
 */
export function RebuildBand({ rules = false }: { rules?: boolean }) {
  // 条件の重みとプリセット（ADR-0028 の rules）を切っていれば帯を出さない（数えもしない）。「条件が変わった」は月の要対応に残る
  return useFeature('rules') ? <RebuildBandOn rules={rules} /> : null;
}

/**
 * 条件の変更の控えを、影響する日が0日になったら消す（PRD D290）。App の殻にいつも置く（帯の無い画面・条件の重みとプリセットを
 * 切っているときも、月の予定で作り直して0日になったら消す）。控えが無い間は何も数えない。数えるのは入力が止まってから
 * （useSettled）、画面を描いた後（useDeferredValue）で、日ごとの計算は月の予定・帯と同じ覚え（lib/useDayStatuses）を使う
 */
export function ConditionsBaseSweep() {
  const { conditionsBase } = useDemoData();
  return conditionsBase ? <SweepOn at={conditionsBase.at} /> : null;
}

function SweepOn({ at }: { at: number }) {
  const { data, clearConditionsBase } = useDemoData();
  const settled = useSettled(data, SETTLE_MS);
  const deferred = useDeferredValue<DemoData | null>(settled, null);
  /** 入力が止まった時刻（控えより後に止まったデータを数えたときだけ控えを消す） */
  // biome-ignore lint/correctness/useExhaustiveDependencies: settled が替わった時刻を覚える
  const settledAt = useMemo(() => Date.now(), [settled]);
  /**
   * 0日を数えて控えを消してよいか：数えたデータが今のデータで、控えを取った後に止まったデータであること。
   * 別のタブが控えとデータを書くと控えが先に届くので、届く前のデータの0日で消さない
   */
  const current = deferred === data && settledAt >= at;
  const summary = useSummary(current ? deferred : null, jstDate(Date.now()));
  const zero = current && summary !== null && summary.days.length === 0;
  useEffect(() => {
    if (zero) clearConditionsBase();
  }, [zero, clearConditionsBase]);
  return null;
}

function RebuildBandOn({ rules }: { rules: boolean }) {
  const { data } = useDemoData();
  const settled = useSettled(data, SETTLE_MS);
  const deferred = useDeferredValue<DemoData | null>(settled, null);
  const [later, setLater] = useState(false);
  const basis = scorePresetOf(data.presets, data.scorePresetId)?.name ?? 'この日だけの重み';
  // 案内は入力のたびに数えても軽い（重み・必須の比べだけ）
  const custom = rules && presetOf(data.rules, data.presets) === null;
  return (
    <RebuildBandBody
      data={deferred}
      live={data}
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
  manualPrefs: {},
  manualPlans: {},
} as unknown as DemoData;

function RebuildBandBody({
  data,
  live,
  basis,
  custom,
  later,
  onLater,
}: {
  data: DemoData | null;
  /** 今のデータ（変更内容はこちらで比べる。戻すとすぐ一覧から消える） */
  live: DemoData;
  basis: string;
  custom: boolean;
  later: boolean;
  onLater: () => void;
}) {
  const today = jstDate(Date.now());
  const summary = useSummary(data, today);
  // 影響する日が0日になったときの条件の変更の控えの片づけは App の殻の ConditionsBaseSweep（帯の無い画面でも消す。PRD D290）
  /** 重みの違いで「条件が変わった」日（控えが無いときの作ったときの重みの違い。PRD D292） */
  const ruleDays = useMemo(() => {
    if (!data || !summary) return [];
    const keys = currentRuleKeys(data.rules, data.presets);
    return summary.days.filter((d) => rulesStale(data, d, keys));
  }, [data, summary]);
  /** ［今日の案を日の予定の重みで作り直す］を出すか（条件の重みとプリセットを切っていれば出さない。PRD D213） */
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
                  <strong>
                    <Term k="stale">条件が変わりました</Term>
                  </strong>
                  ：影響する日 <strong data-testid="rebuild-days">{n}日</strong>
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
          {action && summary && <ConditionChanges data={live} ruleDays={ruleDays} />}
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
                    今日の案を日の予定の重みで作り直す
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

/**
 * 何が変わったか（PRD D290〜D292）：条件の変更の控えと今の違いの一覧（はじめ畳む）と、項目ごとの［戻す］・［すべて戻す］。
 * 控えが無ければ、作ったときの重みと点数の基準の重みの違いだけ。それも無ければ記録が無いと書く
 */
function ConditionChanges({ data, ruleDays }: { data: DemoData; ruleDays: readonly string[] }) {
  const { conditionsBase: base, update } = useDemoData();
  const confirmDialog = useConfirm();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const changes = useMemo(() => (base ? conditionChanges(base.data, data) : []), [base, data]);
  const hasWeights = changes.some((c) => c.kind === 'weights' || c.kind === 'trial' || c.kind === 'scorePreset');
  const made = useMemo(() => (hasWeights ? null : madeWeightsChange(data, ruleDays)), [hasWeights, data, ruleDays]);
  const items = made ? [...changes, made] : changes;
  /** 戻せる変更（足した・消したものは一覧に出すが戻さない。PRD D291） */
  const revertible = items.filter(canRevert);
  /** 戻すときは最新の控えとデータから作り直す（確認の間に別のタブで変わっても、今の違いを戻す） */
  const latest = useRef({ base, ruleDays });
  latest.current = { base, ruleDays };
  /** 戻したあとのフォーカス（一覧のボタンが消えるので、開閉のボタン、無ければ画面の見出しへ） */
  const [refocus, setRefocus] = useState(0);
  useEffect(() => {
    if (refocus === 0) return;
    const to =
      toggleRef.current ??
      document.querySelector<HTMLElement>('.app-main h1') ??
      document.querySelector<HTMLElement>('.app-main');
    if (!to) return;
    if (to.tagName === 'H1' && !to.hasAttribute('tabindex')) to.setAttribute('tabindex', '-1');
    to.focus({ preventScroll: true });
  }, [refocus]);

  const revert = async (cs: readonly ConditionChange[], all: boolean) => {
    const first = cs[0];
    if (!first) return;
    const ok = await confirmDialog({
      title: all ? '戻せる変更をすべて戻しますか？' : `「${first.head}」を戻しますか？`,
      body: revertBody(cs, all ? items.length - cs.length : 0),
      confirmLabel: all ? 'すべて戻す' : '戻す',
    });
    if (!ok) return;
    const keys = new Set(cs.map((c) => c.key));
    // 戻したこと自体は変更として控えない（keepBase）。最新の控えと今のデータの違いから、確認に出した変更（キー）だけ戻す
    update(
      (d) => {
        const { base: b, ruleDays: days } = latest.current;
        const now = b ? conditionChanges(b.data, d) : [];
        const w = now.some((c) => c.kind === 'weights' || c.kind === 'trial' || c.kind === 'scorePreset');
        const m = w ? null : madeWeightsChange(d, days);
        const pick = [...now, ...(m ? [m] : [])].filter((c) => keys.has(c.key));
        return revertAll(d, pick);
      },
      { keepBase: true },
    );
    toast(all ? '変更をすべて戻しました' : `${first.head}を戻しました`);
    setRefocus((n) => n + 1);
  };

  if (items.length === 0) {
    return (
      <p className="rb-changes rb-none" data-testid="rebuild-changes-none">
        {base ? NO_MORE_TEXT : NO_RECORD_TEXT}
      </p>
    );
  }
  return (
    <div className="rb-changes" data-testid="rebuild-changes" data-count={items.length}>
      <button
        ref={toggleRef}
        type="button"
        className="btn btn-text btn-small rb-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((x) => !x)}
        data-testid="rebuild-changes-toggle"
      >
        {open ? '変更内容を閉じる' : changesToggleText(items.length)}
      </button>
      <div id={listId} hidden={!open} className="rb-change-box">
        {open && (
          <>
            {base && changes.length > 0 && <p className="rb-since">{sinceText(base.at)}</p>}
            <ul className="rb-change-list">
              {items.map((c) => (
                <li key={c.key} className="rb-change" data-testid="rebuild-change" data-kind={c.kind}>
                  <span className="rb-change-text">
                    <strong>{c.head}</strong>：{c.text}
                  </span>
                  {canRevert(c) && (
                    <button
                      type="button"
                      className="btn btn-small"
                      aria-label={`${changeLine(c)}を戻す`}
                      onClick={() => void revert([c], false)}
                      data-testid="rebuild-change-revert"
                    >
                      <span className="with-icon">
                        <Undo2 size={14} strokeWidth={2.2} aria-hidden="true" />
                        戻す
                      </span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {/* 足した・消したものは［戻す］を出さない（ほかのデータが指している。PRD D291） */}
            {revertible.length < items.length && (
              <p className="sub rb-no-revert" data-testid="rebuild-no-revert">
                {NO_REVERT_TEXT}
              </p>
            )}
            {revertible.length > 1 && (
              <button
                type="button"
                className="btn btn-small rb-revert-all"
                onClick={() => void revert(revertible, true)}
                data-testid="rebuild-revert-all"
              >
                すべて戻す
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function LaterButton({ onLater }: { onLater: () => void }) {
  return (
    <button
      type="button"
      className="btn btn-small"
      onClick={onLater}
      title="この画面にいる間は帯を隠します。要対応には残ります"
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
