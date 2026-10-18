// ホーム「今日やること」（PRD D141〜D145。ADR-0025。design.md §4 pages「ホーム」）の決まり。
// 今の状態（日の状態・定期パターンから作れる訪問の件数）から次の一手を並べる純粋関数。データは書き換えない
import type { DemoData } from '../contracts/data';
import { addDays } from '../domain/time';
import { dateText } from './common';
import { type AttentionKind, attentionList, type DayStatus, monthDates, ymOf } from './month';

/** 今月の残り（今日を含む）がこの日数以下なら、来月も見る（月末の準備。PRD D142） */
export const HOME_NEXT_MONTH_DAYS = 7;

/** 月の名前（「10月」） */
export const monthLabel = (ym: string): string => `${Number(ym.slice(5, 7))}月`;

/** ホームで見る月：今月。今月の残り（今日を含む）が HOME_NEXT_MONTH_DAYS 日以下なら来月も */
export function homeMonths(today: string): string[] {
  const ym = ymOf(today);
  const left = monthDates(ym).filter((d) => d >= today).length;
  if (left > HOME_NEXT_MONTH_DAYS) return [ym];
  return [ym, ymOf(addDays(`${ym}-01`, 31))];
}

/** ホームで見る日：今日から、見る月の末日まで（今日より前の日は見ない＝月の「今月の準備」と同じ） */
export function homeDays(today: string): string[] {
  return homeMonths(today)
    .flatMap(monthDates)
    .filter((d) => d >= today);
}

/** 見る月ごとの入力 */
export type HomeMonth = {
  ym: string;
  /** 定期パターンから作れる訪問の件数（lib/month の expandMonth の added） */
  canExpand: number;
};

/** カードの種類：要対応・今日の予定・確定していない日・案を作る */
export type HomeTaskKind = 'attention' | 'today' | 'confirm' | 'create';

/**
 * 次の一手のカード。to は移る先（URL。クエリ付き）、date があれば移る前に選んでいる日付をその日にする（日の画面）。
 * tone：warn＝手当てが要る、todo＝やること、info＝知らせだけ（「準備はできています」の判定に数えない）
 */
export type HomeTask = {
  kind: HomeTaskKind;
  tone: 'warn' | 'todo' | 'info';
  title: string;
  detail: string;
  to: string;
  date?: string;
};

export type HomeInput = {
  today: string;
  /** 今日以降の日の状態（homeDays の日。月の画面と同じ数え方。lib/useDayStatuses） */
  statuses: readonly DayStatus[];
  months: readonly HomeMonth[];
  /** 今日の担当の人数（数える案＝今の案、無ければ確定した割当で、訪問がある人） */
  todayStaff: number;
  data: Pick<DemoData, 'absences' | 'staff'>;
};

const ATTENTION_LABEL: Record<AttentionKind, string> = {
  unassigned: '入らない訪問がある日',
  absentLeft: '欠勤の人に訪問が残る日',
  stale: '条件が変わった日',
  overSpan: '拘束が上限を超える日',
  absence: '欠勤がある日',
};
const ATTENTION_ORDER: AttentionKind[] = ['unassigned', 'absentLeft', 'stale', 'overSpan', 'absence'];

/** 1日だけなら日の画面、2日以上なら月の画面（do は月の画面で行う操作。PRD D143） */
function target(dates: readonly string[], ym: string, op: 'attention' | 'unconfirmed'): Pick<HomeTask, 'to' | 'date'> {
  const uniq = [...new Set(dates)];
  if (uniq.length === 1) return { to: '/plan', date: uniq[0]! };
  return { to: `/month?ym=${ym}&do=${op}` };
}

/**
 * 次の一手のカード（PRD D141〜D143）。並びは 要対応（月ごと）→ 今日の予定 → 確定していない日（月ごと）→ 案を作る（月ごと）。
 * - 要対応：lib/month の attentionList（月の画面の要対応と同じ件数）
 * - 今日の予定：訪問の件数・担当の人数・入らない訪問の件数。案が無い・入らない・欠勤の人に残る・必須の違反があれば warn
 * - 確定していない日：訪問があって「確定済み」でない日（案の無い日・未確定の変更ありを含む。lib/month の monthProgress の unconfirmed と同じ）
 * - 案を作る：定期パターンから作れる訪問がある、または訪問があって案の無い日がある月（月の「まとめて作る」へ）
 * ready は手当て・やることが1つも無いとき（今日の予定の知らせだけ）
 */
export function homeTasks(input: HomeInput): { tasks: HomeTask[]; ready: boolean } {
  const { today, statuses, months, todayStaff, data } = input;
  const future = statuses.filter((s) => s.date >= today);
  const inMonth = (ym: string) => future.filter((s) => ymOf(s.date) === ym);
  const attention: HomeTask[] = [];
  const confirm: HomeTask[] = [];
  const create: HomeTask[] = [];
  for (const { ym, canExpand } of months) {
    const days = inMonth(ym);
    const m = monthLabel(ym);
    // 要対応
    const items = attentionList(data, days, today);
    if (items.length > 0) {
      const parts = ATTENTION_ORDER.flatMap((k) => {
        const n = items.filter((x) => x.kind === k).length;
        return n > 0 ? [`${ATTENTION_LABEL[k]} ${n}日`] : [];
      });
      attention.push({
        kind: 'attention',
        tone: 'warn',
        title: `${m}の要対応 ${items.length}件`,
        detail: parts.join('・'),
        ...target(
          items.map((x) => x.date),
          ym,
          'attention',
        ),
      });
    }
    // 確定していない日（訪問があって「確定済み」でない日。案の無い日も含む＝月の「今月の準備」の③・右の欄と同じ日・同じ並び）
    const withVisits = days.filter((s) => s.count > 0);
    const unconfirmed = withVisits.filter((s) => s.state !== 'confirmed');
    if (unconfirmed.length > 0) {
      const n = (state: DayStatus['state']) => unconfirmed.filter((s) => s.state === state).length;
      const parts = [
        n('plan') > 0 ? `未確定 ${n('plan')}日` : '',
        n('diff') > 0 ? `未確定の変更あり ${n('diff')}日` : '',
        n('none') > 0 ? `案の無い日 ${n('none')}日` : '',
      ].filter(Boolean);
      confirm.push({
        kind: 'confirm',
        tone: 'todo',
        title: `${m}の確定していない日 ${unconfirmed.length}日を確認`,
        detail: `${parts.join('・')}。見直して「この割当で確定」`,
        ...target(
          unconfirmed.map((s) => s.date),
          ym,
          'unconfirmed',
        ),
      });
    }
    // 案を作る（訪問を作る・案の無い日）
    const noPlan = withVisits.filter((s) => s.state === 'none').length;
    if (canExpand > 0 || noPlan > 0) {
      const what = [
        canExpand > 0 ? `定期パターンからまだ作っていない訪問 ${canExpand}件` : '',
        noPlan > 0 ? `案の無い日 ${noPlan}日` : '',
      ].filter(Boolean);
      create.push({
        kind: 'create',
        tone: 'todo',
        title: `${m}の案をまとめて作る`,
        detail: what.join('・'),
        to: `/month?ym=${ym}&do=batch`,
      });
    }
  }
  const tasks = [
    ...attention,
    todayTask(
      today,
      future.find((s) => s.date === today),
      todayStaff,
    ),
    ...confirm,
    ...create,
  ];
  return { tasks, ready: tasks.every((t) => t.tone === 'info') };
}

/** 今日の予定のカード（日の画面へ） */
function todayTask(today: string, s: DayStatus | undefined, staff: number): HomeTask {
  const base = { kind: 'today' as const, to: '/plan', date: today };
  const when = `今日 ${dateText(today)}`;
  if (!s || s.count === 0)
    return { ...base, tone: 'info', title: `${when}の訪問はありません`, detail: '日の画面で訪問を足せます' };
  if (s.state === 'none')
    return {
      ...base,
      tone: 'warn',
      title: `${when}の案がまだありません`,
      detail: `訪問 ${s.count}件。日の画面を開くと案を作ります`,
    };
  const issues = [
    s.absentLeft > 0 ? `欠勤の人に残る ${s.absentLeft}件` : '',
    s.hard > 0 ? `必須の違反 ${s.hard}件` : '',
  ].filter(Boolean);
  const warn = s.unassigned > 0 || s.absentLeft > 0 || s.hard > 0;
  const state = s.state === 'confirmed' ? '確定済み' : s.state === 'diff' ? '未確定の変更あり' : '未確定';
  return {
    ...base,
    tone: warn ? 'warn' : 'info',
    title: `${when}の予定（${state}）`,
    detail: [`訪問 ${s.count}件`, `担当 ${staff}人`, `入らない ${s.unassigned}件`, ...issues].join('・'),
  };
}
