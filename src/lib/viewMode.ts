// 〈スタッフ〉・〈利用者さん〉の欄の「閲覧」と「編集」（PRD D127〜D131。ADR-0023）の画面の純粋関数。
// データは書き換えない（保存は各画面の update(fn)）
import type { ClientLeave } from '../contracts/documents';
import type { Traits } from '../contracts/rules';
import type { ConfirmOptions } from './confirmDialog';

/**
 * 特性の未入力を取り除く（null・空の文字・空の配列のキーを消す）。特性の入力は選んでから「未確認」に戻すと null を残すので、
 * 何も入れていないのと同じに扱うため
 */
export function cleanTraits(t: Traits): Traits {
  return Object.fromEntries(
    Object.entries(t).filter(([, v]) => !(v === null || v === '' || (Array.isArray(v) && v.length === 0))),
  );
}

/** 比べるための形：traits（特性）を持てば未入力を取り除く */
function comparable<T>(x: T): T {
  if (x && typeof x === 'object' && 'traits' in x && x.traits && typeof x.traits === 'object')
    return { ...x, traits: cleanTraits(x.traits as Traits) };
  return x;
}

/**
 * 編集の欄に変更があるか：比べる元（既存の人は保存した中身、新しい人は開いたときの空の欄）と JSON で比べる
 * （欄は元の structuredClone から始まるので項目の順は同じ。特性の未入力は取り除いてから比べる）。
 * 元が無ければ（保存した人がデータから消えた）変更ありとする。
 * extra は欄の中身の外に持つ入力が開いたときから変わったか（比べる前の形にそろえられない入力のため）
 */
export function isDirty<T>(form: T | null, base: T | undefined, extra = false): boolean {
  if (form === null) return false;
  if (base === undefined) return true;
  return extra || JSON.stringify(comparable(form)) !== JSON.stringify(comparable(base));
}

/** 変更を捨てる前の確認の場面：閲覧に戻る・欄を閉じる・別の人を開く */
export type DiscardWhen = 'view' | 'close' | 'switch';

/**
 * 変更を捨てる前の確認（独自の確認ダイアログに出す。PRD D130・D147）。term は呼び方（org.terms）、name は編集中の人の名前
 * （空なら「（名前なし）」）、next は別の人を開くときのその人の名前。見出しは問い、本文はだれの変更か、
 * 確定は「捨てて〜」（危険の色）、取り消しは「編集を続ける」
 */
export function discardDialog(when: DiscardWhen, term: string, name: string, next = ''): ConfirmOptions {
  const who = `${name.trim() || '（名前なし）'}（${term}）`;
  const body = `${who}の変更を保存していません。`;
  const base = { body, cancelLabel: '編集を続ける', tone: 'danger' as const };
  if (when === 'view') return { ...base, title: '変更を捨てて、閲覧に戻りますか？', confirmLabel: '捨てて閲覧に戻る' };
  if (when === 'close') return { ...base, title: '変更を捨てて、欄を閉じますか？', confirmLabel: '捨てて閉じる' };
  const to = next.trim() || '（名前なし）';
  return { ...base, title: `変更を捨てて、${to}を開きますか？`, confirmLabel: `捨てて${to}を開く` };
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
