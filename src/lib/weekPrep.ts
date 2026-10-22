// 週の予定の準備（PRD D280・D282。ADR-0046・ADR-0053）の純粋関数：見出しの主ボタン（この週の担当を AI で組む → この週の問題の無い日を
// まとめて確定 → 済み）を状態から1つ決める決まりと、日の見出しの件数の文。データは書き換えない。画面は pages/WeekPage.tsx
import type { BulkConfirm } from './confirmDay';

/**
 * 週の主ボタンの状態：組む／組んでいる（この週）／確定する／残りは日の予定で（ボタンなし）／済み（ボタンなし）／
 * 今日以降に訪問が無い（ボタンなし）
 */
export type WeekNextKind = 'make' | 'making' | 'confirm' | 'rest' | 'done' | 'none';

export type WeekNext = {
  kind: WeekNextKind;
  /** ボタン（または状態）の文 */
  label: string;
  /** 狭い画面（390px）の短い文 */
  short: string;
  /** 押せないときの理由（見える文。押せるなら null） */
  why: string | null;
};

export type WeekNextInput = {
  /** 週の今日以降で訪問がある日の数 */
  futureDays: number;
  /**
   * 組む日の数（伝えていない、担当なしの訪問がある日。この画面でまだ組んでいない日。組めない日は入れない）
   */
  makeDays: number;
  /** 週の今日以降の確定していない日の振り分け（lib/confirmDay の bulkConfirmTargets。月の予定と同じ決まり） */
  bulk: BulkConfirm;
  /** 担当を組む計算（lib/monthBatch）：この週を組んでいる／ほかを組んでいる／組んでいない */
  running: 'this' | 'other' | null;
};

/** 確定のボタンの文（月の「問題の無い日をまとめて確定（N日）」の範囲を週にしたもの） */
export const weekConfirmLabel = (n: number): string => `この週の問題の無い日をまとめて確定（${n}日）`;

/** 組むボタンの文 */
export const weekMakeLabel = (makeDays: number): string => `この週の担当なしを AI で組む（${makeDays}日）`;

/**
 * 週の主ボタン（PRD D280）。仕事の順（担当を組む → 確定 → 済み）で最初に残っているもの：
 * 1. この週を組んでいる → 「この週の担当を組んでいます…」（押せない。進み具合は上の帯）
 * 2. 今日以降に訪問が無い → ボタンなし
 * 3. 担当なしの訪問がある日（まだ組んでいない）→ この週の担当なしを AI で組む（ほかを組んでいる間は押せず理由）
 * 4. 問題の無い伝えていない日がある → この週の問題の無い日をまとめて確定（組んでいる間は押せず理由）
 * 5. 確定していない日が残る（要対応の日・未連絡の変更のある日）→ ボタンなし（日の予定で確かめて確定）
 * 6. 何も残っていない → 済み
 */
export function weekNext(x: WeekNextInput): WeekNext {
  const busy = x.running === 'other' ? 'ほかの担当を組んでいます。終わってから押せます' : null;
  if (x.running === 'this')
    return { kind: 'making', label: 'この週の担当を組んでいます…', short: '組んでいます…', why: null };
  if (x.futureDays === 0)
    return { kind: 'none', label: 'この週の今日以降に訪問はありません', short: '訪問なし', why: null };
  if (x.makeDays > 0)
    return { kind: 'make', label: weekMakeLabel(x.makeDays), short: weekMakeLabel(x.makeDays), why: busy };
  if (x.bulk.targets.length > 0)
    return {
      kind: 'confirm',
      label: weekConfirmLabel(x.bulk.targets.length),
      short: `この週をまとめて確定（${x.bulk.targets.length}日）`,
      why: busy ? '担当を組んでいる間は確定できません。終わってから押せます' : null,
    };
  const rest = x.bulk.problem.length + x.bulk.changed.length;
  if (rest > 0) {
    const why =
      x.bulk.problem.length > 0
        ? '要対応のある日は確かめてから、日の予定で確定します'
        : '未連絡の変更のある日は、日の予定の連絡の一覧で確かめて確定します';
    return { kind: 'rest', label: `確定していない ${rest}日は日の予定で`, short: `残り ${rest}日`, why };
  }
  return { kind: 'done', label: 'この週は確定済みです', short: '済み', why: null };
}

/** 日の見出しの件数の文（PRD D282）：「N件」、担当なしがあれば「N件・担当なしM」 */
export function weekDayCountText(x: { count: number; unassigned: number }): string {
  return `${x.count}件${x.unassigned > 0 ? `・担当なし${x.unassigned}` : ''}`;
}
