// 条件を変えたら、その場で影響と「作り直す」を出す帯（PRD D161〜D165。ADR-0025 追記。design.md §4 pages「作り直しの帯」）の決まり。
// 数えるのは月の画面の要対応・進み具合の帯の「条件が変わった日」と同じ（lib/useDayStatuses の DayStatus.stale）。データは書き換えない
import { own } from './common';
import { type DayStatus, ymOf } from './month';

/**
 * 帯を出す画面（設定の画面）：条件の重み・相性・稼働時間・訪問の種類・特性の項目・〈スタッフ〉と〈利用者さん〉の一覧と編集（PRD D161）。
 * 予定の画面（月・週・日）は要対応・進み具合の帯に出るので出さない
 */
export const REBUILD_PATHS: readonly string[] = [
  '/rules',
  '/compat',
  '/availability',
  '/types',
  '/items',
  '/staff',
  '/clients',
];

/** その画面に帯を出すか */
export const showsRebuildBand = (pathname: string): boolean => REBUILD_PATHS.includes(pathname);

/** 数える日：今日以降で今の案のある日（日付の順。案の無い日は「条件が変わった」にならない） */
export function rebuildDays(aiPlans: Record<string, unknown>, today: string): string[] {
  return Object.keys(aiPlans)
    .filter((d) => d >= today && own(aiPlans, d) !== undefined)
    .sort();
}

/** 帯に出すもの */
export type RebuildSummary = {
  /** 条件が変わった日（今日以降。日付の順） */
  days: string[];
  /** そのうち確定した割当が無い日（月の画面の「条件が変わった日を作り直す」の対象） */
  unconfirmed: string[];
  /** そのうち確定した割当がある日（確定済み・未確定の変更あり。作り直さない） */
  confirmed: string[];
};

/**
 * 条件が変わった日を数える（PRD D162）。statuses は useDayStatuses の日の状態（月の画面と同じ。DayStatus.stale は
 * 計算に入れる訪問がある日だけ）。今日より前の日は数えない（要対応 attentionList と同じ）。確定した割当がある日は確定済み、
 * 無い日は未確定（月の画面の batchTargets の 'stale' と同じ条件。帯の未確定の日数＝ ?do=stale の対象の日数。PR #40 のレビュー）
 */
export function rebuildSummary(
  statuses: Iterable<DayStatus>,
  today: string,
  manualPlans: Record<string, unknown>,
): RebuildSummary {
  const days: string[] = [];
  const unconfirmed: string[] = [];
  const confirmed: string[] = [];
  for (const s of statuses) {
    if (s.date < today || !s.stale) continue;
    days.push(s.date);
    if (own(manualPlans, s.date) !== undefined) confirmed.push(s.date);
    else unconfirmed.push(s.date);
  }
  const sort = (a: string[]) => a.sort();
  return { days: sort(days), unconfirmed: sort(unconfirmed), confirmed: sort(confirmed) };
}

/** 帯の文（PRD D161）：「条件が変わりました：影響する日 N日（未確定 a日・確定済み b日）」 */
export function rebuildText(s: RebuildSummary): string {
  return `条件が変わりました：影響する日 ${s.days.length}日（未確定 ${s.unconfirmed.length}日・確定済み ${s.confirmed.length}日）`;
}

/** 0日になって帯が消えるときに1度だけ読み上げる文（PRD D164） */
export const REBUILD_CLEARED = '影響する日は無くなりました';

/** 作り直しに使う条件の文（PRD D163）：点数の基準のプリセットで作り直し、この日だけ試す重みで作った案も上書きする */
export function rebuildWith(basis: string): string {
  return `点数の基準のプリセット「${basis}」で作り直します（この日だけ試す重みで作った案も「${basis}」の案になります）`;
}

/** 帯のボタン（PRD D163） */
export type RebuildAction = {
  /** 移る先（月の画面の ?do=） */
  href: string;
  /** ボタンの文 */
  label: string;
  /** ボタンの説明（title・aria-describedby） */
  note: string;
};

/**
 * ［作り直す］の行き先（PRD D163）：未確定の日があれば、その最初の日の月の画面で「条件が変わった日を作り直す」の欄（`?do=stale`）。
 * 未確定の日が無い（確定済みの日だけ）なら作り直す日が無いので、最初の日の月の要対応（`?do=attention`）を「要対応を見る」で開く。
 * 月をまたぐときは月ごとに作り直す（作り直したあと、残った月の日は帯にまた出る）
 */
export function rebuildAction(s: RebuildSummary, basis: string): RebuildAction | null {
  if (s.days.length === 0) return null;
  const first = s.unconfirmed[0];
  if (first) {
    const ym = ymOf(first);
    const months = new Set(s.unconfirmed.map(ymOf));
    const inMonth = s.unconfirmed.filter((d) => ymOf(d) === ym).length;
    return {
      href: `/month?ym=${ym}&do=stale`,
      label: '作り直す',
      note:
        `${Number(ym.slice(5, 7))}月の「月の予定」で、条件が変わった未確定の日（${inMonth}日）を作り直す欄を開きます。${rebuildWith(basis)}` +
        (months.size > 1 ? '。ほかの月は、それぞれの月の予定で作り直します' : '') +
        (s.confirmed.length > 0 ? '。確定済みの日は作り直しません' : ''),
    };
  }
  const ym = ymOf(s.days[0]!);
  return {
    href: `/month?ym=${ym}&do=attention`,
    label: '要対応を見る',
    note: `確定済みの日は作り直しません。${Number(ym.slice(5, 7))}月の「月の予定」の要対応を開きます（日の予定で確かめてください）`,
  };
}

/**
 * 試す重みの案内（PRD D166・D234。ADR-0035）：条件の重みの画面で、この日だけ試す重み（data.rules。日の予定の右の欄で変える）が
 * どのプリセットとも同じでないときに出す文。試す重みは日の画面の「AI にもう一度作らせる」だけが使い、
 * 月のまとめて作る・自動作成・作り直しは、この画面の重み（点数の基準のプリセット）で作る
 */
export function customRulesText(basis: string): string {
  return `この日だけ試す重み（日の予定の右の欄の重み）がどのプリセットとも違います。試す重みは日の予定の「AI にもう一度作らせる」だけで使い、月のまとめて作る・自動作成・作り直しはこの画面の重み（「${basis}」）で作ります`;
}

/** ［今日の案を試す重みで作り直す］の行き先（日の画面の ?do=recreate。PRD D166・D234） */
export const recreateTodayHref = (today: string): string => `/plan?date=${today}&do=recreate`;
