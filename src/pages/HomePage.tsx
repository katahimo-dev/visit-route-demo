import {
  CalendarDays,
  CalendarSearch,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  House,
  ListTodo,
  Lock,
  type LucideIcon,
  Plus,
  Sparkles,
  UserRound,
  UserX,
} from 'lucide-react';
import { useId, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useDay } from '../app/day';
import { StaffMarkById } from '../components/StaffMark';
import { PageHeader } from '../components/ui';
import { useOpenVisit } from '../components/VisitPanel';
import { addDays, jstDate, jstHhmm } from '../domain/time';
import { dateText } from '../lib/common';
import {
  type HomeEntryKey,
  type HomeTask,
  type HomeTaskKind,
  homeDays,
  homeEntries,
  homeMonths,
  homeTasks,
} from '../lib/home';
import { dayPlanOf, expandMonth } from '../lib/month';
import { useCompileInput } from '../lib/useDayModel';
import { useDayStatuses } from '../lib/useDayStatuses';
import { COMPACT_QUERY, NARROW_QUERY, useMedia } from '../lib/useMedia';
import { dayVisitRows, unassignedVisits, type VisitRow } from '../lib/visitOps';
import { useDemoData } from '../store';
import './home.css';

const KIND_ICON: Record<HomeTaskKind, LucideIcon> = {
  attention: CircleAlert,
  today: CalendarDays,
  confirm: Lock,
  create: Sparkles,
};

const ENTRY_ICON: Record<HomeEntryKey, LucideIcon> = {
  absence: UserX,
  vacancy: CalendarSearch,
  clients: House,
  staff: UserRound,
};

/**
 * ホーム「今日やること」（PRD D141〜D145・D263。ADR-0025・0044）：起動したときの画面。今の状態から次の一手を作業の順に
 * カードで並べ（lib/home の homeTasks）、先頭の1枚を「まずこれ」と大きく見せる。押すとその操作のある画面へ移る。下に、いつでも使う入口（欠勤・問い合わせ・探す）。
 * 狭い画面（スマホ）では欠勤・キャンセルの入口を「いつでも」から外し、ホームの先頭に常に置く（PRD D247）。
 * 日の状態は月の画面と同じ数え方（lib/useDayStatuses）。データは書き換えない
 */
export default function HomePage() {
  const today = jstDate(Date.now());
  const { setDate } = useDay();
  const { data } = useDemoData();
  // compile が読むデータだけ（今日の問題は useDayStatuses が案のある日だけ作るので、ここでは compile しない）
  const compileInput = useCompileInput(data);
  const terms = data.org.terms;
  const days = useMemo(() => homeDays(today), [today]);
  const perDay = useDayStatuses(data, compileInput, days);
  const months = useMemo(
    () => homeMonths(today).map((ym) => ({ ym, canExpand: expandMonth(data, ym, today).added })),
    [data, today],
  );
  const { tasks, ready } = useMemo(() => {
    const statuses = days.flatMap((d) => perDay.get(d)?.status ?? []);
    const todayPlan = dayPlanOf(data, today, perDay.get(today)?.problem ?? null);
    const todayStaff = Object.values(todayPlan.routes).filter((list) => list.length > 0).length;
    return homeTasks({ today, statuses, months, todayStaff, data, features: data.org.features });
  }, [days, perDay, months, data, today]);
  const entries = useMemo(() => homeEntries(today, terms, data.org.features), [today, terms, data.org.features]);
  // スマホでは欠勤・キャンセルを先頭へ（当日の朝に開いてすぐ押せる。切った機能なら出さない）
  const narrow = useMedia(NARROW_QUERY);
  const topEntry = narrow ? entries.find((e) => e.key === 'absence') : undefined;
  const anytime = topEntry ? entries.filter((e) => e !== topEntry) : entries;

  const nextId = useId();
  const anytimeId = useId();
  const visitsId = useId();
  // 訪問の詳細の欄（PRD D304）：今日の訪問・これからの入らない訪問から1件ずつ開く。スマホの幅では「訪問を追加」を出さない
  const openVisit = useOpenVisit();
  const compact = useMedia(COMPACT_QUERY);
  const nowHm = jstHhmm(Date.now());
  const todayRows = useMemo(() => dayVisitRows(data, today, nowHm), [data, today, nowHm]);
  const laterUnassigned = useMemo(() => unassignedVisits(data, addDays(today, 1), addDays(today, 31)), [data, today]);
  const clientName = (id: string) => data.clients.find((c) => c.id === id)?.displayName ?? '（不明）';
  const staffName = (id: string) => data.staff.find((s) => s.id === id)?.name ?? '（不明）';
  const openRow = (e: { currentTarget: HTMLElement }, visitId: string) => {
    const btn = e.currentTarget;
    openVisit({ visitId, returnFocus: () => (btn.isConnected ? btn : null) });
  };
  const rowText = (r: VisitRow) =>
    r.mark === 'unassigned' ? '担当なし（入らない）' : r.mark === 'noplan' ? '案なし' : staffName(r.staffId ?? '');
  /** 日の画面へ移るものは、移る前に選んでいる日付をその日にする */
  const pickDate = (d?: string) => {
    if (d) setDate(d);
  };

  return (
    <div className="stack home-page">
      <PageHeader
        icon={ListTodo}
        title="ホーム"
        lead={`今日やること：${dateText(today)}の状態から、次にすることを並べています`}
      />

      {topEntry && (
        <div className="home-quick" data-testid="home-quick">
          <EntryCard
            to={topEntry.to}
            icon={ENTRY_ICON[topEntry.key]}
            title={topEntry.title}
            detail={topEntry.detail}
            onPick={() => pickDate(topEntry.date)}
            testId={`home-${topEntry.key}`}
            first
          />
        </div>
      )}

      <section className="stack" aria-labelledby={nextId} style={{ gap: 10 }}>
        <h2 id={nextId} className="home-section-title">
          次にすること
        </h2>
        {ready && (
          <p className="card home-ready" data-testid="home-ready">
            <CircleCheck size={22} aria-hidden="true" />
            <strong>今日の準備はできています</strong>
          </p>
        )}
        <ul className="home-tasks" data-testid="home-tasks">
          {tasks.map((t, i) => {
            // 先頭の1枚は「まずこれ」（幅いっぱい・主ボタンの塗り。PRD D263）。知らせだけ（準備ができている）なら強めない
            const lead = i === 0 && t.tone !== 'info';
            return (
              <li key={`${t.kind}-${t.title}`} className={lead ? 'is-lead' : undefined}>
                <TaskCard task={t} lead={lead} onPick={() => pickDate(t.date)} />
              </li>
            );
          })}
        </ul>
      </section>

      <section className="stack" aria-labelledby={visitsId} style={{ gap: 10 }} data-testid="home-visits">
        <h2 id={visitsId} className="home-section-title">
          今日の訪問
        </h2>
        {todayRows.rows.length === 0 ? (
          <p className="sub">今日の訪問はありません。</p>
        ) : (
          <ul className="home-visits">
            {todayRows.rows.map((r) => (
              <li key={r.visit.id}>
                <button
                  type="button"
                  className={`home-visit${r.mark ? ' is-warn' : ''}`}
                  onClick={(e) => openRow(e, r.visit.id)}
                  data-testid="home-visit"
                  data-visit={r.visit.id}
                >
                  <span className="home-visit-time">{r.visit.earliestStart}</span>
                  <span className="home-visit-name">{clientName(r.visit.clientId)}</span>
                  <span className="home-visit-staff sub">
                    {r.staffId && <StaffMarkById id={r.staffId} size="xs" />}
                    {rowText(r)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {todayRows.rest > 0 && (
          <Link to="/plan" onClick={() => pickDate(today)} className="sub" data-testid="home-visits-rest">
            あと {todayRows.rest}件（日の予定で見る）
          </Link>
        )}
        {laterUnassigned.length > 0 && (
          <>
            <h3 className="home-section-sub">これからの入らない訪問（要対応）</h3>
            <ul className="home-visits" data-testid="home-unassigned">
              {laterUnassigned.slice(0, 5).map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    className="home-visit is-warn"
                    onClick={(e) => openRow(e, v.id)}
                    data-testid="home-unassigned-visit"
                    data-visit={v.id}
                  >
                    <span className="home-visit-time">
                      {dateText(v.date)} {v.earliestStart}
                    </span>
                    <span className="home-visit-name">{clientName(v.clientId)}</span>
                    <span className="home-visit-staff sub">担当なし</span>
                  </button>
                </li>
              ))}
            </ul>
            {laterUnassigned.length > 5 && (
              <p className="sub">ほか {laterUnassigned.length - 5}件（月の予定の要対応で）</p>
            )}
          </>
        )}
      </section>

      <section className="stack" aria-labelledby={anytimeId} style={{ gap: 10 }}>
        <h2 id={anytimeId} className="home-section-title">
          いつでも
        </h2>
        {/* 切った機能の入口（欠勤・キャンセル・問い合わせ）は出さない（PRD D213。並びと文は lib/home の homeEntries） */}
        <ul className="home-tasks home-anytime" data-testid="home-anytime">
          {anytime.map((e) => (
            <li key={e.key}>
              <EntryCard
                to={e.to}
                icon={ENTRY_ICON[e.key]}
                title={e.title}
                detail={e.detail}
                onPick={() => pickDate(e.date)}
                testId={`home-${e.key}`}
              />
            </li>
          ))}
          {!compact && data.clients.length > 0 && (
            <li>
              <button
                type="button"
                className="card home-task is-entry"
                onClick={(e) => {
                  const btn = e.currentTarget;
                  openVisit({ newVisit: { date: today }, returnFocus: () => (btn.isConnected ? btn : null) });
                }}
                data-testid="home-visit-add"
              >
                <span className="home-task-icon" aria-hidden="true">
                  <Plus size={20} strokeWidth={2.2} />
                </span>
                <span className="home-task-text">
                  <strong>訪問を追加</strong>
                  <span className="sub">1回だけの訪問を足して、担当の候補から選ぶ</span>
                </span>
                <ChevronRight size={18} className="home-task-go" aria-hidden="true" />
              </button>
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}

/**
 * 次の一手のカード（全体が1つのリンク）。lead は先頭の「まずこれ」（主ボタンの塗りで幅いっぱい。ホームの主ボタンはこの1つ。
 * PRD D263）。「まずこれ」は見える札で、読み上げでも題名の前に読む
 */
function TaskCard({ task: t, lead, onPick }: { task: HomeTask; lead: boolean; onPick: () => void }) {
  const Icon = KIND_ICON[t.kind];
  return (
    <Link
      to={t.to}
      className={`card home-task is-${t.tone}${lead ? ' is-lead' : ''}`}
      onClick={onPick}
      data-testid="home-task"
      data-kind={t.kind}
      data-tone={t.tone}
      data-lead={lead || undefined}
    >
      <span className="home-task-icon" aria-hidden="true">
        <Icon size={lead ? 24 : 20} strokeWidth={2.2} />
      </span>
      <span className="home-task-text">
        {lead && (
          <span className="home-lead-badges">
            <span className="home-lead-badge" data-testid="home-lead">
              まずこれ
            </span>
            {/* 要対応が先頭のときは要対応の印（赤）を残す（塗りの中でも色と文字で分かる） */}
            {t.tone === 'warn' && (
              <span className="home-lead-badge is-warn" data-testid="home-lead-warn">
                要対応
              </span>
            )}
          </span>
        )}
        <strong>{t.title}</strong>
        {t.detail && <span className="sub">{t.detail}</span>}
      </span>
      <ChevronRight size={18} className="home-task-go" aria-hidden="true" />
    </Link>
  );
}

/** いつでも使う入口のカード */
function EntryCard({
  to,
  icon: Icon,
  title,
  detail,
  onPick,
  testId,
  first = false,
}: {
  to: string;
  icon: LucideIcon;
  title: string;
  detail: string;
  onPick?: () => void;
  testId: string;
  /** 先頭に置く当日の入口（欠勤・キャンセル。アイコンだけ朱） */
  first?: boolean;
}) {
  return (
    <Link
      to={to}
      className={`card home-task is-entry${first ? ' is-first' : ''}`}
      onClick={onPick}
      data-testid={testId}
    >
      <span className="home-task-icon" aria-hidden="true">
        <Icon size={20} strokeWidth={2.2} />
      </span>
      <span className="home-task-text">
        <strong>{title}</strong>
        <span className="sub">{detail}</span>
      </span>
      <ChevronRight size={18} className="home-task-go" aria-hidden="true" />
    </Link>
  );
}
