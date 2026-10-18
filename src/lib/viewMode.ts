// 〈スタッフ〉・〈利用者さん〉の欄の「閲覧」と「編集」（PRD D127〜D131。ADR-0023）の画面の純粋関数。
// データは書き換えない（保存は各画面の update(fn)）
import type { ClientLeave } from '../contracts/documents';

/**
 * 編集の欄に変更があるか：比べる元（既存の人は保存した中身、新しい人は開いたときの空の欄）と JSON で比べる
 * （欄は元の structuredClone から始まるので項目の順は同じ）。元が無ければ（保存した人がデータから消えた）変更ありとする。
 * extra は欄の中身の外に持つ入力（〈利用者さん〉の「担当できる人を限る」など）が開いたときから変わったか
 */
export function isDirty<T>(form: T | null, base: T | undefined, extra = false): boolean {
  if (form === null) return false;
  if (base === undefined) return true;
  return extra || JSON.stringify(form) !== JSON.stringify(base);
}

/** 変更を捨てる前の確認の場面：閲覧に戻る・欄を閉じる・別の人を開く */
export type DiscardWhen = 'view' | 'close' | 'switch';

/**
 * 変更を捨てる前の確認の文（confirm に出す）。term は呼び方（org.terms）、name は編集中の人の名前（空なら「（名前なし）」）、
 * next は別の人を開くときのその人の名前
 */
export function discardMessage(when: DiscardWhen, term: string, name: string, next = ''): string {
  const who = `${name.trim() || '（名前なし）'}（${term}）`;
  if (when === 'view') return `${who}の変更を保存していません。変更を捨てて、閲覧に戻りますか？`;
  if (when === 'close') return `${who}の変更を保存していません。変更を捨てて、欄を閉じますか？`;
  return `${who}の変更を保存していません。変更を捨てて、${next.trim() || '（名前なし）'}を開きますか？`;
}

/** 閲覧の欄の文字：空（前後の空白だけを含む）・null なら「—」 */
export function orDash(s: string | null | undefined): string {
  const t = (s ?? '').trim();
  return t === '' ? '—' : t;
}

/** 閲覧の欄の休み：これからの休み（今日を含む・開始日の順）と、終わった休みの件数 */
export function splitLeaves(leaves: readonly ClientLeave[], today: string): { ahead: ClientLeave[]; past: number } {
  const ahead = leaves
    .filter((l) => l.to >= today)
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
  return { ahead, past: leaves.length - ahead.length };
}
