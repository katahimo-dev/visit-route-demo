/** 郵便番号の入力と表示（PRD D86。ADR-0016）。画面・Excel の両方で使う純粋関数（外部は呼ばない） */

/**
 * 郵便番号の入力を7桁の数字に直す。全角の数字・ハイフン（各種）・「〒」・空白を受ける。
 * 空なら ''、7桁にできなければ null
 */
export function normalizePostalCode(text: string): string | null {
  const t = text.normalize('NFKC').replace(/[〒\s\-‐‑‒–—―−ーｰ]/g, '');
  if (t === '') return '';
  return /^\d{7}$/.test(t) ? t : null;
}

/** 郵便番号の表示（123-4567）。7桁でなければそのまま */
export const formatPostalCode = (code: string): string =>
  /^\d{7}$/.test(code) ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
