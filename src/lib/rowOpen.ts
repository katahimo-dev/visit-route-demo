// 一覧の行を押して閲覧の欄を開く（PRD D297）。行の中のボタン・リンク・入力欄を押したとき、ドラッグで文字を選んだとき、
// 二度押しの2回目以降は開かない（その部品の動きを優先する。キーボード・読み上げは今までどおり行の右端の「開く」ボタンで開く）。
// 二度押しの1回目では開く（待ってから開くと1回押しがいつも遅くなるので割り切る。文字を写すときはドラッグで選ぶ）

/** それ自体の動きを持つ要素 */
export const INTERACTIVE =
  'a, button, input, select, textarea, label, summary, [role="button"], [contenteditable="true"]';

/** 行を押したとき開いてよいか */
export function shouldOpenRow({
  target,
  row,
  selection,
  detail,
}: {
  /** 押した要素 */
  target: (Pick<Element, 'closest'> & Node) | null;
  /** 行の要素 */
  row: Pick<Element, 'contains'>;
  /** 今選んでいる文字 */
  selection: string;
  /** 続けて押した回数（MouseEvent.detail。2以上は文字を選ぶ二度押し・三度押し） */
  detail: number;
}): boolean {
  if (detail > 1 || selection.trim() !== '') return false;
  // 行の子として描いた portal（吹き出しなど）の中の押し下げは React では行へ伝わるので、DOM の上で行の中かを確かめる
  if (!target || !row.contains(target)) return false;
  const hit = target.closest(INTERACTIVE);
  return !hit || !row.contains(hit);
}
