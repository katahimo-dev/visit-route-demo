// ホーム（見出しの下に「今日やること」。PRD D141〜D145・D230・D263。ADR-0025・0034・0044。design.md §4 pages「ホーム」）の決まり。
// 今の状態（日の状態）から次の一手を並べる純粋関数。データは書き換えない
import type { DemoData } from '../contracts/data';
import type { Terms } from '../contracts/documents';
import type { Features } from '../contracts/features';
import { addDays } from '../domain/time';
import { dateText } from './common';
import { isHrefOn } from './features';
import { type AttentionKind, attentionList, type DayStatus, monthDates, ymOf } from './month';
import { SUDDEN_DO } from './sudden';

/**
 * この日（日付の日）以降なら、来月も見る（来月の準備。PRD D142・D255）。月末7日では来月のまとめて作るが遅い（シフトの希望・
 * 確定の連絡は月の後半に始まる）ので、月の半ばから出す。事業所ごとに変えない（契約に足すほどの差が無い。D255）
 */
export const HOME_NEXT_MONTH_FROM_DAY = 15;

/** 月の名前（「10月」） */
export const monthLabel = (ym: string): string => `${Number(ym.slice(5, 7))}月`;

/** ホームで見る月：今月。今日が HOME_NEXT_MONTH_FROM_DAY 日以降なら来月も */
export function homeMonths(today: string): string[] {
  const ym = ymOf(today);
  if (Number(today.slice(8, 10)) < HOME_NEXT_MONTH_FROM_DAY) return [ym];
  return [ym, ymOf(addDays(`${ym}-01`, 31))];
}

/** ホームで見る日：今日から、見る月の末日まで（今日より前の日は見ない＝月の「今月の準備」と同じ） */
export function homeDays(today: string): string[] {
  return homeMonths(today)
    .flatMap(monthDates)
    .filter((d) => d >= today);
}

/** 見る月ごとの入力 */
export type HomeMonth = { ym: string };

/** カードの種類：要対応・今日の予定・確定していない日・担当を AI で組む */
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
  /** 今日の担当の人数（訪問がある人） */
  todayStaff: number;
  data: Pick<DemoData, 'absences' | 'staff'>;
  /** 機能の入り切り（切った機能へ向かうカードは出さない。PRD D213。{} ならすべて入） */
  features: Features;
};

const ATTENTION_LABEL: Record<AttentionKind, string> = {
  care: '要対応の訪問がある日',
  changed: '未連絡の変更がある日',
  overSpan: '出勤〜退勤（拘束）が上限を超える日',
};
const ATTENTION_ORDER: AttentionKind[] = ['care', 'changed', 'overSpan'];

/** 1日だけなら日の画面、2日以上なら月の画面（do は月の画面で行う操作。PRD D143） */
function target(dates: readonly string[], ym: string, op: 'attention' | 'unconfirmed'): Pick<HomeTask, 'to' | 'date'> {
  const uniq = [...new Set(dates)];
  if (uniq.length === 1) return { to: '/plan', date: uniq[0]! };
  return { to: `/month?ym=${ym}&do=${op}` };
}

/**
 * 次の一手のカード（PRD D141〜D143・D263）。並びは作業の順：要対応（月ごと）→ 月ごとに「担当を AI で組む → 確定していない日を確認」
 * （今月 → 来月）→ 今日の予定。先頭の1枚を画面で「まずこれ」と大きく見せる（HomePage）。
 * - 要対応：lib/month の attentionList（月の画面の要対応と同じ件数）
 * - 担当を AI で組む：担当なしの訪問がある日が2日以上ある月（月の「担当を AI で組む」へ）
 * - 確定していない日：訪問があって伝えていない・未連絡の変更のある日（lib/month の monthProgress の unconfirmed と同じ日数）
 * - 今日の予定：訪問の件数・担当の人数・要対応の件数。要対応があれば warn
 * ready は手当て・やることが1つも無いとき（今日の予定の知らせだけ）
 */
export function homeTasks(input: HomeInput): { tasks: HomeTask[]; ready: boolean } {
  const { today, statuses, months, todayStaff, data, features } = input;
  const future = statuses.filter((s) => s.date >= today);
  const inMonth = (ym: string) => future.filter((s) => ymOf(s.date) === ym);
  const attention: HomeTask[] = [];
  const work: HomeTask[] = [];
  for (const { ym } of months) {
    const days = inMonth(ym);
    const m = monthLabel(ym);
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
    const withVisits = days.filter((s) => s.count > 0);
    const unassignedDays = withVisits.filter((s) => s.unassigned > 0 && s.state === 'none');
    if (unassignedDays.length >= 2) {
      work.push({
        kind: 'create',
        tone: 'todo',
        title: `${m}の担当を AI で組む`,
        detail: `担当なしの訪問がある日 ${unassignedDays.length}日`,
        to: `/month?ym=${ym}&do=batch&mode=plan`,
      });
    }
    // 確定していない日（訪問があって伝えていない・未連絡の変更のある日）
    const unconfirmed = withVisits.filter((s) => s.state !== 'told');
    const n = (state: DayStatus['state']) => unconfirmed.filter((s) => s.state === state).length;
    if (unconfirmed.length > 0) {
      const parts = [
        n('none') > 0 ? `まだ伝えていない ${n('none')}日` : '',
        n('changed') > 0 ? `未連絡の変更あり ${n('changed')}日` : '',
      ].filter(Boolean);
      work.push({
        kind: 'confirm',
        tone: 'todo',
        title: `${m}の確定していない日 ${unconfirmed.length}日を確認`,
        detail: `${parts.join('・')}。見直して伝えたら「確定」`,
        ...target(
          unconfirmed.map((s) => s.date),
          ym,
          'unconfirmed',
        ),
      });
    }
  }
  // 切った機能へ向かうカードは出さない（PRD D213）
  const tasks = [
    ...attention,
    ...work,
    todayTask(
      today,
      future.find((s) => s.date === today),
      todayStaff,
    ),
  ].filter((t) => isHrefOn(features, t.to));
  return { tasks, ready: tasks.every((t) => t.tone === 'info') };
}

/** 今日の予定のカード（日の画面へ） */
function todayTask(today: string, s: DayStatus | undefined, staff: number): HomeTask {
  const base = { kind: 'today' as const, to: '/plan', date: today };
  const when = `今日 ${dateText(today)}`;
  if (!s || s.count === 0)
    return { ...base, tone: 'info', title: `${when}の訪問はありません`, detail: '日の予定で訪問を足せます' };
  const warn = s.care > 0;
  const state = s.state === 'told' ? '確定済み' : s.state === 'changed' ? '未連絡の変更あり' : 'まだ伝えていない';
  return {
    ...base,
    tone: warn ? 'warn' : 'info',
    title: `${when}の予定（${state}）`,
    detail: [`訪問 ${s.count}件`, `担当 ${staff}人`, `要対応 ${s.care}件`].join('・'),
  };
}

/** いつでも使う入口の種類（アイコンは画面で引く） */
export type HomeEntryKey = 'absence' | 'vacancy' | 'clients' | 'staff';

/** いつでも使う入口のカード。date があれば移る前に選んでいる日付をその日にする */
export type HomeEntry = { key: HomeEntryKey; to: string; title: string; detail: string; date?: string };

/**
 * いつでも使う入口（PRD D144）：欠勤・キャンセル・問い合わせ（空き状況）・〈利用者さん〉を探す・〈スタッフ〉を探す。
 * 呼び方は terms。切った機能の入口（欠勤・キャンセル・問い合わせ）は出さない（PRD D213）
 */
export function homeEntries(today: string, terms: Pick<Terms, 'client' | 'staff'>, features: Features): HomeEntry[] {
  const all: HomeEntry[] = [
    {
      key: 'absence',
      to: `/plan?date=${today}&do=${SUDDEN_DO}&mode=change`,
      title: '欠勤・キャンセルを登録',
      detail: '今日の予定で「欠勤・キャンセル」の欄を開きます。休む人・キャンセルの訪問を選び、振り直して確定・連絡',
      date: today,
    },
    {
      key: 'vacancy',
      to: '/vacancy',
      title: '問い合わせに答える（空き状況）',
      detail: '新しい依頼の曜日・時間に、入れる人と空きを見る',
    },
    {
      key: 'clients',
      to: '/clients',
      title: `${terms.client}を探す`,
      detail: '名前・よみ・地区で探して、詳しく見る・直す',
    },
    {
      key: 'staff',
      to: '/staff',
      title: `${terms.staff}を探す`,
      detail: '一覧から開いて、勤務の時間・特性・休みを見る・直す',
    },
  ];
  return all.filter((e) => isHrefOn(features, e.to));
}
