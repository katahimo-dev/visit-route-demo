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
  Sparkles,
  UserRound,
  UserX,
} from 'lucide-react';
import { useId, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useDay } from '../app/day';
import { PageHeader } from '../components/ui';
import { jstDate } from '../domain/time';
import { dateText } from '../lib/common';
import { type HomeTask, type HomeTaskKind, homeDays, homeMonths, homeTasks } from '../lib/home';
import { dayPlanOf, expandMonth } from '../lib/month';
import { SUDDEN_DO } from '../lib/sudden';
import { useCompileInput } from '../lib/useDayModel';
import { useDayStatuses } from '../lib/useDayStatuses';
import { useDemoData } from '../store';
import './home.css';

const KIND_ICON: Record<HomeTaskKind, LucideIcon> = {
  attention: CircleAlert,
  today: CalendarDays,
  confirm: Lock,
  create: Sparkles,
};

/**
 * ホーム「今日やること」（PRD D141〜D145。ADR-0025）：起動したときの画面。今の状態から次の一手をカードで並べ
 * （lib/home の homeTasks）、押すとその操作のある画面へ移る。下に、いつでも使う入口（欠勤・問い合わせ・探す）。
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
    return homeTasks({ today, statuses, months, todayStaff, data });
  }, [days, perDay, months, data, today]);

  const nextId = useId();
  const anytimeId = useId();
  /** 日の画面へ移るものは、移る前に選んでいる日付をその日にする */
  const pickDate = (d?: string) => {
    if (d) setDate(d);
  };

  return (
    <div className="stack home-page">
      <PageHeader
        icon={ListTodo}
        title="今日やること"
        lead={`${dateText(today)}の状態から、次にすることを並べています`}
      />

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
          {tasks.map((t) => (
            <li key={`${t.kind}-${t.title}`}>
              <TaskCard task={t} onPick={() => pickDate(t.date)} />
            </li>
          ))}
        </ul>
      </section>

      <section className="stack" aria-labelledby={anytimeId} style={{ gap: 10 }}>
        <h2 id={anytimeId} className="home-section-title">
          いつでも
        </h2>
        <ul className="home-tasks home-anytime" data-testid="home-anytime">
          <li>
            <EntryCard
              to={`/plan?date=${today}&do=${SUDDEN_DO}`}
              icon={UserX}
              title="急な欠勤・キャンセルを登録"
              detail="今日の日の画面で「欠勤・キャンセル」の欄を開きます。休む人・キャンセルの訪問を選び、振り直して確定"
              onPick={() => setDate(today)}
              testId="home-absence"
            />
          </li>
          <li>
            <EntryCard
              to="/vacancy"
              icon={CalendarSearch}
              title="問い合わせに答える（空き状況）"
              detail="新しい依頼の曜日・時間に、入れる人と空きを見る"
              testId="home-vacancy"
            />
          </li>
          <li>
            <EntryCard
              to="/clients"
              icon={House}
              title={`${terms.client}を探す`}
              detail="名前・よみ・地区で探して、詳しく見る・直す"
              testId="home-clients"
            />
          </li>
          <li>
            <EntryCard
              to="/staff"
              icon={UserRound}
              title={`${terms.staff}を探す`}
              detail="一覧から開いて、稼働時間・特性・休みを見る・直す"
              testId="home-staff"
            />
          </li>
        </ul>
      </section>
    </div>
  );
}

/** 次の一手のカード（全体が1つのリンク） */
function TaskCard({ task: t, onPick }: { task: HomeTask; onPick: () => void }) {
  const Icon = KIND_ICON[t.kind];
  return (
    <Link
      to={t.to}
      className={`card home-task is-${t.tone}`}
      onClick={onPick}
      data-testid="home-task"
      data-kind={t.kind}
      data-tone={t.tone}
    >
      <span className="home-task-icon" aria-hidden="true">
        <Icon size={20} strokeWidth={2.2} />
      </span>
      <span className="home-task-text">
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
}: {
  to: string;
  icon: LucideIcon;
  title: string;
  detail: string;
  onPick?: () => void;
  testId: string;
}) {
  return (
    <Link to={to} className="card home-task is-entry" onClick={onPick} data-testid={testId}>
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
