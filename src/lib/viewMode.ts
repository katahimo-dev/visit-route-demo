// 〈スタッフ〉・〈利用者さん〉の画面の節（読む ⇄ 直す。PRD D308。ADR-0052）の純粋関数。
// データは書き換えない（保存は各画面の update(fn)）
import type { Traits } from '../contracts/rules';

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
 * 節の入力に変更があるか：比べる元（既存の人は保存した中身、新しい人は開いたときの空の欄）と JSON で比べる
 * （欄は元の structuredClone から始まるので項目の順は同じ。特性の未入力は取り除いてから比べる）。
 * 元が無ければ（保存した人がデータから消えた）変更ありとする。
 * extra は欄の中身の外に持つ入力が開いたときから変わったか（比べる前の形にそろえられない入力のため）
 */
export function isDirty<T>(form: T | null, base: T | undefined, extra = false): boolean {
  if (form === null) return false;
  if (base === undefined) return true;
  return extra || JSON.stringify(comparable(form)) !== JSON.stringify(comparable(base));
}

/** 読むときの文字：空（前後の空白だけを含む）・null なら「—」 */
export function orDash(s: string | null | undefined): string {
  const t = (s ?? '').trim();
  return t === '' ? '—' : t;
}
