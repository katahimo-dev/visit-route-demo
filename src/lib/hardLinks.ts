// 必須の違反（PlanScore.hardViolations の1件）から、直しに行く関連の画面（PRD D345）を決める純粋関数。
// label は evaluate（scorePlaced）が作る：kind 'notAllowed' は matching/compile の必須の理由の label を「・」でつないだもの
// （と「件数の上限（N件）を超える」）、'slot' は「稼働時間帯に作業が収まらない」、'time' は「時間の約束に間に合わない」。
// データは書き換えない。切った機能の行き先を外すのは呼ぶ側（lib/links の linkIfOn）
import type { PlanScore } from '../contracts/problem';
import { ABSENCE_OVERLAP, ABSENT_ALL_DAY, ABSENT_NO_HOURS, AFTER_LAST_DAY } from '../matching';

/** 関連の画面へのリンク（to は react-router の行き先、label はリンクの文字） */
export type HardLink = { to: string; label: string };

type Violation = Pick<PlanScore['hardViolations'][number], 'kind' | 'label' | 'staffId'>;

/** 呼び方（data.org.terms。compile が label に使うのと同じ） */
type Terms = { client: string; staff: string };

const AVAILABILITY = '/availability';

/** その〈利用者さん〉の画面（personDetail のリンクと同じ形） */
export const clientPageHref = (clientId: string): string => `/clients/${encodeURIComponent(clientId)}`;
/** その〈スタッフ〉の画面 */
export const staffPageHref = (staffId: string): string => `/staff/${encodeURIComponent(staffId)}`;

/**
 * 必須の違反1件 → 関連の画面（重ならない順：相性・〈利用者さん〉・〈スタッフ〉・種類・勤務時間・条件の重み）。
 * - time（時間の約束に間に合わない）：無し（訪問を開いて直す）
 * - slot（稼働時間帯に収まらない）：勤務時間（シフト）
 * - notAllowed：label の中の言葉で決める
 *   - 「相性」→ 相性の表
 *   - 〈利用者さん〉の条件（「必要条件：」「希望✗」「担当を限る」「いつもの担当」「〈利用者さん〉の位置」）→ その〈利用者さん〉の画面
 *   - 〈スタッフ〉の条件（「〈スタッフ〉の必要条件」「〈スタッフ〉の希望」「〈スタッフ〉の自宅の位置」「最終勤務日の後」）→ その人の画面
 *   - 「種類（…）」→ 訪問の種類
 *   - 休み・欠勤・稼働時間帯 → 勤務時間（シフト）
 *   - 「件数の上限」（必須の負担の均等）→ 条件の重み
 * clientId が無い（訪問の〈利用者さん〉が分からない）ときは〈利用者さん〉の画面を出さない
 */
export function hardLinks(v: Violation, clientId: string | undefined, terms: Terms): HardLink[] {
  if (v.kind === 'time') return [];
  const availability: HardLink = { to: AVAILABILITY, label: '勤務時間（シフト）' };
  if (v.kind === 'slot') return [availability];
  const label = v.label;
  const out: HardLink[] = [];
  const add = (x: HardLink) => {
    if (!out.some((o) => o.to === x.to)) out.push(x);
  };
  if (label.includes('相性')) add({ to: '/compat', label: '相性の表' });
  // 〈スタッフ〉側の言葉を除いてから〈利用者さん〉側を見る（「〈スタッフ〉の必要条件」は「必要条件：」を含まない形だが念のため）
  const staffWords = [`${terms.staff}の必要条件`, `${terms.staff}の希望`, `${terms.staff}の自宅の位置`];
  const clientSide = staffWords.reduce((s, w) => s.split(w).join(''), label);
  const clientWords = ['必要条件：', '希望✗', '担当を限る', 'いつもの担当', `${terms.client}の位置`];
  if (clientId && clientWords.some((w) => clientSide.includes(w)))
    add({ to: clientPageHref(clientId), label: `${terms.client}の画面` });
  if (staffWords.some((w) => label.includes(w)) || label.includes(AFTER_LAST_DAY))
    add({ to: staffPageHref(v.staffId), label: `${terms.staff}の画面` });
  if (label.includes('種類（')) add({ to: '/types', label: '訪問の種類' });
  const slotWords = ['休み', ABSENT_ALL_DAY, ABSENT_NO_HOURS, ABSENCE_OVERLAP, '稼働時間帯'];
  if (slotWords.some((w) => label.includes(w))) add(availability);
  if (label.includes('件数の上限')) add({ to: '/rules', label: '条件の重み' });
  return out;
}
