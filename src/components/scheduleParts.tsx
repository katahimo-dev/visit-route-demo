// 予定（日・週・月）に共通の部品（PRD D327・D328・D330。ADR-0054）：操作の行（欠勤・キャンセルを登録／AI で組む ▾／元に戻す・やり直す
// ／表示の切り替え／その他 ▾）、「AI で組む ▾」の範囲（この日／この週／この月）、提案の帯（変わる件数・点・反映する・捨てる）、
// 複数選択の帯（N件を選択：担当を替える・時刻をずらす・別の日へ（月）・取り消す）。日・週・月は「拡大率」として同じ部品を並べる。
// データを書くのは store の update だけ（複数選択は lib/multiEdit、提案は lib/monthBatch の apply）
import {
  CalendarArrowUp,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  CircleCheck,
  Clock,
  Sparkles,
  UserRoundCog,
  UserRoundX,
  X,
  XCircle,
} from 'lucide-react';
import { type ReactNode, type Ref, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { DemoData } from '../contracts/data';
import { jstDate } from '../domain/time';
import { dateText, deltaText, own } from '../lib/common';
import { activeDayVisits } from '../lib/dayPlan';
import { ymOf } from '../lib/month';
import {
  type BatchSource,
  dayLabel,
  monthBatch,
  proposalCounts,
  proposalDayFresh,
  weekBatchDays,
  weekLabel,
} from '../lib/monthBatch';
import { assignMany, cancelMany, moveManyToDate, multiResultText, selectionText, shiftMany } from '../lib/multiEdit';
import { absenceHref } from '../lib/nav';
import { COMPACT_QUERY, useMedia } from '../lib/useMedia';
import { useValueStore } from '../lib/valueStore';
import { toldDaysChanged } from '../lib/visitOps';
import { weekDates } from '../lib/week';
import { findVisit } from '../patterns';
import { useDemoData } from '../store';
import { useConfirm } from './ConfirmDialog';
import { MenuButton, type MenuItem } from './MenuButton';
import { StaffMark } from './StaffMark';
import { useToast } from './Toast';
import { WithIcon } from './ui';
import { UndoButtons } from './undo';
import { useScheduleMode } from './useScheduleMode';
import './scheduleParts.css';

/** 予定の拡大率（日・週・月） */
export type ScheduleZoom = 'day' | 'week' | 'month';

/** ほかの計算中に押したときの理由 */
export const BATCH_BUSY = 'ほかの担当を組んでいます。終わってから押せます';

/**
 * 新しく組み始める前に、反映していない範囲の提案があれば捨ててよいか確かめる（提案は1つだけ。PR #81 のレビュー）。
 * 提案が無ければ確かめずに true
 */
export async function confirmDropProposal(confirmDialog: ReturnType<typeof useConfirm>): Promise<boolean> {
  const p = monthBatch.proposal.get();
  if (!p) return true;
  return confirmDialog({
    title: `反映していない提案（${p.label}）を捨てて、組み始めますか？`,
    body: '提案は1つだけ持てます。組み始めると、今の提案は消えます（訪問は変わっていません）。',
    confirmLabel: '捨てて組み始める',
    cancelLabel: '提案を残す',
  });
}

/** 範囲の項目に共通の説明 */
const SCOPE_NOTE = 'ピンの訪問はそのままで、担当・順番の提案を出します（反映するまで担当は変わりません）';

// ---- 操作の行 ----

/**
 * 予定の操作の行（日・週・月で同じ並び。PRD D327）：欠勤・キャンセルを登録／AI で組む ▾／元に戻す・やり直す／（表示の切り替えなど）／その他 ▾。
 * 欠勤・キャンセルは日の予定では欄を開き（onAbsence）、週・月ではその日の日の予定で欄を開く（リンク）。absence が null なら出さない
 */
export function ScheduleToolbar({
  zoom,
  absence,
  aiItems,
  moreItems,
  children,
  after,
  className = '',
}: {
  zoom: ScheduleZoom;
  absence: { onClick: () => void; disabled?: boolean; ref?: Ref<HTMLButtonElement> } | { date: string } | null;
  aiItems: MenuItem[];
  moreItems: MenuItem[];
  /** 元に戻すのあとに置くもの（表示の切り替え・計算の進み具合） */
  children?: ReactNode;
  /** その他 ▾ のあとに置くもの */
  after?: ReactNode;
  className?: string;
}) {
  const today = jstDate(Date.now());
  // 予定のモードで出す操作を絞る（PRD D348）：組むは欠勤の登録を、確認は「AI で組む ▾」を出さない
  const { mode, tools } = useScheduleMode();
  return (
    <div
      className={`row schedule-toolbar ${className}`}
      data-testid="schedule-toolbar"
      data-zoom={zoom}
      data-mode={mode}
    >
      {absence &&
        tools.absence &&
        ('onClick' in absence ? (
          <button
            ref={absence.ref}
            type="button"
            className="btn plan-sudden-btn"
            onClick={absence.onClick}
            disabled={absence.disabled}
            data-testid="sudden-open"
          >
            <WithIcon icon={UserRoundX}>
              <span className="tb-label">欠勤・キャンセルを登録</span>
            </WithIcon>
          </button>
        ) : (
          <Link
            to={`${absenceHref(absence.date < today ? today : absence.date)}&mode=change`}
            className="btn plan-sudden-btn"
            data-testid="sudden-open"
          >
            <WithIcon icon={UserRoundX}>
              <span className="tb-label">欠勤・キャンセルを登録</span>
            </WithIcon>
          </Link>
        ))}
      {tools.ai && (
        <MenuButton
          label={<span className="tb-label">AI で組む</span>}
          icon={Sparkles}
          items={aiItems}
          testId="plan-menu"
        />
      )}
      <UndoButtons />
      {children}
      {moreItems.length > 0 && (
        <MenuButton
          label="その他"
          items={moreItems}
          testId={`${zoom === 'day' ? 'plan' : zoom}-more`}
          className="plan-more"
        />
      )}
      {after}
    </div>
  );
}

// ---- AI で組む ▾ の範囲 ----

/**
 * 「AI で組む ▾」の範囲のまとまり（日・週・月で同じ3つ。PRD D328）：この日（M/D）／この週（M/D〜M/D）／この月（N月）。
 * どれもピンの訪問はそのままで提案を出す（反映するまで変わらない）。
 * この日は日の予定なら onDay（その場の提案。点の差も出す）、週・月の予定では範囲の計算（lib/monthBatch）を1日で。
 * この週は範囲の計算（今日以降で伝えていない、訪問のある日）。この月は月の予定の「N月の担当を AI で組む」の欄（対象を選ぶ）を開く
 */
export function useScopeItems({
  zoom: _zoom,
  date,
  onDay,
  dayBusy,
  onMonth,
}: {
  zoom: ScheduleZoom;
  /** 選んでいる日付（この日・この週・この月の基準） */
  date: string;
  onDay?: () => void;
  /** この日を押せない理由（日の予定の計算中など） */
  dayBusy?: string | false | null;
  onMonth?: () => void;
}): MenuItem[] {
  const { data } = useDemoData();
  const navigate = useNavigate();
  const toast = useToast();
  const confirmDialog = useConfirm();
  const run = useValueStore(monthBatch.run);
  const today = jstDate(Date.now());
  const busy = run ? BATCH_BUSY : false;
  const week = useMemo(() => weekDates(date), [date]);
  const weekStart = week[0]!;
  const weekDays = useMemo(() => weekBatchDays(data, week, today), [data, week, today]);
  const ym = ymOf(date);
  const dayWhy =
    date < today
      ? '今日より前の日は組みません'
      : own(data.snapshots, date)
        ? '確定（伝えた）した日は組みません。直すときは訪問を開いて替えます'
        : activeDayVisits(data, date).length === 0
          ? 'この日に組める訪問がありません'
          : null;
  const start = async (days: string[], source: BatchSource, label: string) => {
    if (!(await confirmDropProposal(confirmDialog))) return;
    const ok = monthBatch.start({
      ym: ymOf(days[0]!),
      label,
      mode: 'all',
      days: days.map((d) => ({ date: d, mode: 'all' as const })),
      today,
      source,
      weekStart,
    });
    if (!ok) toast(BATCH_BUSY);
  };
  return [
    {
      key: 'scope-day',
      group: 'AI で組む（範囲）',
      testId: 'ai-scope-day',
      label: `この日（${dayLabel(date)}）を組む`,
      description: SCOPE_NOTE,
      icon: CalendarDays,
      disabled: dayWhy ?? (onDay ? (dayBusy ?? false) : busy),
      // 週・月の予定の「この日」は1日の範囲（source 'day'。週の主ボタンを「この週を組んでいます」にしない）
      onSelect: () => (onDay ? onDay() : void start([date], 'day', dayLabel(date))),
    },
    {
      key: 'scope-week',
      testId: 'ai-scope-week',
      label: `この週（${weekLabel(weekStart).replace(/の週$/, '')}）を組む`,
      description: `${SCOPE_NOTE}。今日以降の伝えていない日（${weekDays.length}日）`,
      icon: CalendarCheck,
      disabled: weekDays.length === 0 ? 'この週に組める日がありません（今日より前の日・確定した日は組みません）' : busy,
      onSelect: () =>
        void start(
          weekDays.map((x) => x.date),
          'week',
          weekLabel(weekStart),
        ),
    },
    {
      key: 'scope-month',
      testId: 'ai-scope-month',
      label: `この月（${Number(ym.slice(5, 7))}月）を組む`,
      description: '要対応のある日だけか、伝えていない日すべてかを選んでから組みます',
      icon: CalendarRange,
      disabled: busy,
      onSelect: () => (onMonth ? onMonth() : navigate(`/month?ym=${ym}&do=batch&mode=plan`)),
    },
  ];
}

// ---- 提案の帯 ----

/**
 * 提案の帯（日・週・月で同じ形。PRD D328）：「提案（名前）：担当が変わる N件・時刻が変わる M件・点 a→b」と［反映する］［捨てる］、
 * 差の一覧（畳む）。反映すると全体の「元に戻す」で1手戻せる
 */
export function ProposalBand({
  kind,
  title,
  moved,
  shifted,
  score,
  note,
  stale,
  applyDisabled,
  onApply,
  onDiscard,
  details,
  detailsLabel,
}: {
  /** 'day'＝日の予定のその場の提案、'range'＝日・週・月の範囲の提案 */
  kind: 'day' | 'range';
  title: ReactNode;
  moved: number;
  shifted: number;
  score?: { before: number; after: number } | null;
  note?: ReactNode;
  stale?: string | null;
  applyDisabled?: boolean;
  onApply: () => void;
  onDiscard: () => void;
  details?: ReactNode;
  detailsLabel?: string;
}) {
  return (
    <section
      className="plan-band schedule-band proposal-band stack"
      aria-label="AI の提案"
      data-testid="proposal-band"
      data-kind={kind}
    >
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <WithIcon icon={Sparkles} size={16}>
          <span className="band-text">
            <strong>{title}</strong>：担当が変わる <strong data-testid="proposal-moved">{moved}</strong>件・時刻が変わる{' '}
            <strong data-testid="proposal-shifted">{shifted}</strong>件
            {score && (
              <>
                ・点 {score.before}→<strong data-testid="proposal-score">{score.after}</strong>（
                {deltaText(score.after - score.before, '点')}）
              </>
            )}
            {note}
          </span>
        </WithIcon>
        <button
          type="button"
          className="btn btn-primary btn-small"
          disabled={applyDisabled}
          onClick={onApply}
          data-testid="proposal-apply"
        >
          <WithIcon icon={CircleCheck} size={14}>
            反映する
          </WithIcon>
        </button>
        <button type="button" className="btn btn-small" onClick={onDiscard} data-testid="proposal-discard">
          <WithIcon icon={X} size={14}>
            捨てる
          </WithIcon>
        </button>
      </div>
      {stale && (
        <span className="sub warn-text" data-testid="proposal-stale">
          {stale}
        </span>
      )}
      {details && (
        <details className="reassign-moves-box" data-testid="proposal-moves">
          <summary>{detailsLabel ?? '変わる訪問を見る'}</summary>
          {details}
        </details>
      )}
    </section>
  );
}

/**
 * 範囲（日・週・月）の提案の帯（lib/monthBatch の提案）。日・週・月の予定と空き状況に置く（提案は1つで、どの画面でも同じもの）。
 * 日ごとの差（担当が変わる・時刻が変わる）を畳んで出し、日付を押すとその日の日の予定へ
 */
export function RangeProposalBand() {
  const { data } = useDemoData();
  const proposal = useValueStore(monthBatch.proposal);
  const run = useValueStore(monthBatch.run);
  const toast = useToast();
  const navigate = useNavigate();
  if (!proposal) return null;
  const counts = proposalCounts(proposal);
  const staleDays = proposal.days.filter((d) => !proposalDayFresh(data, d)).length;
  const apply = () => {
    const r = monthBatch.apply();
    if (!r) return;
    toast(
      r.applied.length === 0
        ? '提案を出したあとに訪問が変わったので、反映しませんでした。もう一度 AI で組んでください'
        : `${proposal.label}の提案を反映しました（${r.applied.length}日${r.skipped.length > 0 ? `・変わった ${r.skipped.length}日は反映しません` : ''}）`,
    );
  };
  const changed = proposal.days.filter((d) => (d.diff?.moved.length ?? 0) + (d.diff?.shifted.length ?? 0) > 0);
  return (
    <ProposalBand
      kind="range"
      title={`提案（${proposal.label}・${counts.days}日分）`}
      moved={counts.moved}
      shifted={counts.shifted}
      note={
        <>
          {proposal.stopped ? '（途中までの最良）' : ''}
          {counts.unassignedDays > 0 ? `。担当なしの残る日 ${counts.unassignedDays}日` : ''}
        </>
      }
      stale={
        staleDays > 0 ? `提案を出したあとに訪問が変わった日が ${staleDays}日あります（その日は反映しません）` : null
      }
      applyDisabled={run !== null || staleDays === proposal.days.length}
      onApply={apply}
      onDiscard={() => monthBatch.discard()}
      detailsLabel={`変わる日を見る（${changed.length}日）`}
      details={
        changed.length === 0 ? (
          <p className="sub">担当・時刻の変わる訪問はありません</p>
        ) : (
          <ul className="range-days" data-testid="proposal-days">
            {changed.map((d) => (
              <li key={d.date}>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => navigate(`/plan?date=${d.date}`)}
                  data-testid="proposal-day"
                >
                  {dateText(d.date)}
                </button>
                ：担当が変わる {d.diff?.moved.length ?? 0}件・時刻が変わる {d.diff?.shifted.length ?? 0}件
                {d.unassigned > 0 ? `・担当なし ${d.unassigned}件` : ''}
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}

// ---- 複数選択 ----

/** ずらす幅（分） */
const SHIFTS = [-30, -15, 15, 30] as const;

/**
 * 複数選択の帯（画面の下に貼り付く。PRD D330）：「N件を選択：［担当を替える ▾］［時刻をずらす −30・−15・+15・+30］［取り消す］［選択を外す］」。
 * どれも「この回だけ」で、1回の update（全体の「元に戻す」で1手戻る）。できなかった訪問は知らせに理由
 */
export function SelectionBar({
  ids,
  onClear,
  dates,
  shift = true,
  moveDay = false,
  inline = false,
}: {
  ids: readonly string[];
  onClear: () => void;
  /** 今見ている日付（日は1日・週は7日）。欄などでこの外へ移した訪問は数えない */
  dates: readonly string[];
  /** 時刻をずらすを出すか（〈スタッフ〉の画面など動かさない所は false） */
  shift?: boolean;
  /** 「別の日へ」（日付を選んでまとめて移す。月の予定。PRD D343）を出すか。スマホでは出さない */
  moveDay?: boolean;
  /** 画面の下に貼り付けず、置いた所に出す（スマホの月の下から出る欄の中） */
  inline?: boolean;
}) {
  const { data, update } = useDemoData();
  const toast = useToast();
  const confirmDialog = useConfirm();
  const today = jstDate(Date.now());
  /** スマホ（600px 以下）は下から出る欄の置き場所に、時刻をずらすは出さない（スマホでは動かさない。ADR-0051 の決定5） */
  const compact = useMedia(COMPACT_QUERY);
  const live = ids.filter((id) => {
    const v = findVisit(data, id);
    return !!v && dates.includes(v.date);
  });
  const staff = useMemo(() => data.staff.filter((s) => s.active), [data.staff]);
  /** 「別の日へ」の日付（null は閉じている） */
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const moveRef = useRef<HTMLButtonElement>(null);
  // 選んだ訪問が無くなったら日付の欄も閉じる（次に選んだとき開いたまま出さない）
  const empty = live.length === 0;
  useEffect(() => {
    if (empty) setMoveTo(null);
  }, [empty]);
  if (empty) return null;
  const run = (what: string, fn: (d: DemoData) => { data: DemoData; done: number; failed: { why: string }[] }) => {
    // 結果の数は今のデータで見るが、書くのは store の最新のデータに反映し直す（確認を待つ間の別のタブの変更を消さない）
    const r = fn(data);
    if (r.done > 0) update((d) => fn(d).data, what);
    toast(multiResultText(what, { done: r.done, failed: r.failed.map((f) => ({ visitId: '', why: f.why })) }));
    return r.done;
  };
  const staffItems: MenuItem[] = staff.map((s) => ({
    key: s.id,
    label: (
      <span className="row" style={{ gap: 6 }}>
        <StaffMark staff={s} size="xs" />
        {s.name}
      </span>
    ),
    onSelect: () => run('担当を替えました', (d) => assignMany(d, live, s.id, today)),
    testId: 'selection-staff',
  }));
  return (
    <section
      className={`selection-bar${inline ? ' is-inline' : compact ? ' is-sheet' : ''}`}
      aria-label="選んだ訪問"
      data-testid="selection-bar"
    >
      <strong data-testid="selection-count">{selectionText(live.length)}</strong>
      <MenuButton label="担当を替える" icon={UserRoundCog} items={staffItems} testId="selection-assign" />
      {!compact && shift && (
        <fieldset className="row selection-shift" aria-label="時刻をずらす">
          <span className="sub">
            <WithIcon icon={Clock} size={14}>
              時刻をずらす
            </WithIcon>
          </span>
          {SHIFTS.map((m) => (
            <button
              key={m}
              type="button"
              className="btn btn-small"
              onClick={() =>
                run(`時刻を${m > 0 ? '+' : '−'}${Math.abs(m)}分ずらしました`, (d) => shiftMany(d, live, m, today))
              }
              data-testid="selection-shift"
              data-minutes={m}
              aria-label={`${m > 0 ? '+' : '−'}${Math.abs(m)}分ずらす`}
            >
              {m > 0 ? '+' : '−'}
              {Math.abs(m)}分
            </button>
          ))}
        </fieldset>
      )}
      {!compact && moveDay && (
        <span className="row selection-move">
          <button
            ref={moveRef}
            type="button"
            className="btn btn-small"
            aria-expanded={moveTo !== null}
            onClick={() => setMoveTo(moveTo === null ? today : null)}
            data-testid="selection-move"
          >
            <WithIcon icon={CalendarArrowUp} size={14}>
              別の日へ
            </WithIcon>
          </button>
          {moveTo !== null && (
            // Esc は日付の欄を閉じるだけ（選んだ訪問は外さない）
            // biome-ignore lint/a11y/noStaticElementInteractions: 中の入力欄・ボタンの Esc を受ける
            <span
              className="row selection-move-form"
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return;
                e.preventDefault();
                e.stopPropagation();
                setMoveTo(null);
                moveRef.current?.focus();
              }}
            >
              <input
                type="date"
                aria-label="移す先の日"
                value={moveTo}
                min={today}
                onChange={(e) => setMoveTo(e.target.value)}
                data-testid="selection-move-date"
              />
              <button
                type="button"
                className="btn btn-small"
                disabled={!moveTo || moveTo < today}
                onClick={async () => {
                  const to = moveTo;
                  if (!to) return;
                  // 確定（伝えた）した日（移す前の日・移す先の日）が変わるなら確かめる（キー・欄と同じ文）
                  const fixed = toldDaysChanged(data, moveManyToDate(data, live, to, today).data, today);
                  if (
                    fixed.length > 0 &&
                    !(await confirmDialog({
                      title: '確定した日の訪問も変えますか？',
                      body: `確定した日（${fixed.map((x) => dateText(x)).join('・')}）の訪問も変わります。その日は「未連絡の変更あり」になり、連絡の一覧に出ます。`,
                      confirmLabel: '変える',
                    }))
                  )
                    return;
                  const done = run(`${dateText(to)}へ移しました`, (d) => moveManyToDate(d, live, to, today));
                  setMoveTo(null);
                  // 1件も移せなければ選んだまま（選び直さなくてよい）。移したら帯が消えるので、フォーカスは「元に戻す」へ
                  if (done === 0) return;
                  onClear();
                  requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="undo-btn"]')?.focus());
                }}
                data-testid="selection-move-go"
              >
                移す
              </button>
            </span>
          )}
        </span>
      )}
      <button
        type="button"
        className="btn btn-small"
        onClick={async () => {
          const ok = await confirmDialog({
            title: `${live.length}件の訪問を取り消しますか？`,
            body: '取り消した訪問は担当の並びから外れます。「元に戻す」で戻せます。',
            confirmLabel: '訪問を取り消す',
            cancelLabel: 'やめる',
            tone: 'danger',
          });
          if (!ok) return;
          run('訪問を取り消しました', (d) => cancelMany(d, live, today));
          onClear();
        }}
        data-testid="selection-cancel"
      >
        <WithIcon icon={XCircle} size={14}>
          取り消す
        </WithIcon>
      </button>
      <button type="button" className="btn btn-text btn-small" onClick={onClear} data-testid="selection-clear">
        <WithIcon icon={X} size={14}>
          選択を外す
        </WithIcon>
      </button>
    </section>
  );
}
