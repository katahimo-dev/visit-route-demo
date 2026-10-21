// 週の予定の準備（PRD D280・D282。ADR-0046）の純粋関数：見出しの主ボタン（この週の案を作る → この週の問題の無い日をまとめて確定 →
// 済み）を状態から1つ決める決まりと、日の見出しの件数の文（訪問が本当に0件の日と、定期パターンからまだ訪問を作っていない「未作成」の日を
// 分ける）。データは書き換えない。画面は pages/WeekPage.tsx
import type { BulkConfirm } from './confirmDay';

/**
 * 週の主ボタンの状態：作る／作っている（この週）／確定する／残りは日の予定で（ボタンなし）／済み（ボタンなし）／
 * 今日以降に訪問も未作成も無い（ボタンなし）
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
  /** 週の今日以降で訪問がある日の数（定期パターンから作ったあと） */
  futureDays: number;
  /** 週の今日以降の、定期パターンからまだ作っていない訪問の件数 */
  canExpand: number;
  /**
   * 作る日の数（訪問を作ったあとの、まだ案も確定した割当も無い日。lib/monthBatch の weekBatchDays）。
   * 計算に入る訪問か〈スタッフ〉がいなくて作れない日（月まとめも飛ばす日）は入れない（作っても残り、主ボタンが進まないため）
   */
  makeDays: number;
  /** 週の今日以降の確定していない日の振り分け（lib/confirmDay の bulkConfirmTargets。月の予定と同じ決まり） */
  bulk: BulkConfirm;
  /** 案づくり（lib/monthBatch）：この週を作っている／ほかを作っている／作っていない */
  running: 'this' | 'other' | null;
};

/** 確定のボタンの文（月の「問題の無い日をまとめて確定（N日）」の範囲を週にしたもの） */
export const weekConfirmLabel = (n: number): string => `この週の問題の無い日をまとめて確定（${n}日）`;

/** 作るボタンの文 */
export function weekMakeLabel(makeDays: number, canExpand: number): string {
  return makeDays > 0 ? `この週の案を作る（${makeDays}日）` : `この週の訪問を作る（${canExpand}件）`;
}

/**
 * 週の主ボタン（PRD D280）。仕事の順（訪問・案を作る → 確定 → 済み）で最初に残っているもの：
 * 1. この週を作っている → 「この週の案を作っています…」（押せない。進み具合は上の帯）
 * 2. 今日以降に訪問も未作成の訪問も無い → ボタンなし
 * 3. 未作成の訪問・まだ案の無い日がある → この週の案を作る（ほかを作っている間は押せず理由）
 * 4. 問題の無い未確定の日がある → この週の問題の無い日をまとめて確定（作っている間は押せず理由）
 * 5. 確定していない日が残る（問題のある日・前に確定した割当と違う日・案を作れない日（担当できる人がいない など。作る日に数えない））
 *    → ボタンなし（日の予定で確かめて確定）
 * 6. 何も残っていない → 済み
 */
export function weekNext(x: WeekNextInput): WeekNext {
  const busy = x.running === 'other' ? 'ほかの案を作っています。終わってから押せます' : null;
  if (x.running === 'this')
    return { kind: 'making', label: 'この週の案を作っています…', short: '作っています…', why: null };
  if (x.futureDays === 0 && x.canExpand === 0)
    return { kind: 'none', label: 'この週の今日以降に訪問はありません', short: '訪問なし', why: null };
  if (x.canExpand > 0 || x.makeDays > 0)
    return {
      kind: 'make',
      label: weekMakeLabel(x.makeDays, x.canExpand),
      short: weekMakeLabel(x.makeDays, x.canExpand),
      why: busy,
    };
  if (x.bulk.targets.length > 0)
    return {
      kind: 'confirm',
      label: weekConfirmLabel(x.bulk.targets.length),
      short: `この週をまとめて確定（${x.bulk.targets.length}日）`,
      why: busy ? '案を作っている間は確定できません。終わってから押せます' : null,
    };
  const rest = x.bulk.problem.length + x.bulk.changed.length + x.bulk.noPlan.length;
  if (rest > 0) {
    const why =
      x.bulk.problem.length > 0
        ? '問題のある日は要対応で確かめてから、日の予定で確定します'
        : x.bulk.changed.length > 0
          ? '前に確定した割当と違う日は、日の予定で確定し直します'
          : '案を作れない日（担当できる人がいない など）は、日の予定で確かめます';
    return { kind: 'rest', label: `確定していない ${rest}日は日の予定で`, short: `残り ${rest}日`, why };
  }
  return { kind: 'done', label: 'この週は確定済みです', short: '済み', why: null };
}

/**
 * 日の見出しの件数の文（PRD D282）：
 * - 訪問が無く、定期パターンからまだ作っていない訪問がある → 「未作成」（0件と出さない）
 * - 訪問があり、まだ作っていない訪問もある → 「N件・ほか未作成」
 * - 訪問があって案が無い → 「N件・案なし」
 * - 訪問が本当に無い → 「0件」
 */
export function weekDayCountText(x: { count: number; unexpanded: number; noPlan: boolean }): string {
  if (x.count === 0) return x.unexpanded > 0 ? '未作成' : '0件';
  if (x.unexpanded > 0) return `${x.count}件・ほか未作成`;
  return `${x.count}件${x.noPlan ? '・案なし' : ''}`;
}

/** 日の見出しの読み上げ・title の補足（未作成の件数と作り方） */
export function weekDayUnmadeNote(unexpanded: number): string {
  return unexpanded > 0
    ? `定期パターンからまだ作っていない訪問 ${unexpanded}件（未作成。「この週の案を作る」で作ります）`
    : '';
}
