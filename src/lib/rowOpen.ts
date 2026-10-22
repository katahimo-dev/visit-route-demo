// 一覧の行を押して閲覧の欄を開く（PRD D297）。行の中のボタン・リンク・入力欄を押したとき、文字を選んだときは開かない
// （その部品の動きを優先する。キーボード・読み上げは今までどおり行の右端の「開く」ボタンで開く）

/** それ自体の動きを持つ要素 */
export const INTERACTIVE =
  'a, button, input, select, textarea, label, summary, [role="button"], [contenteditable="true"]';

/** 行を押したとき開いてよいか（target は押した要素、row は行の要素、selection は今選んでいる文字） */
export function shouldOpenRow(
  target: Pick<Element, 'closest'> | null,
  row: Pick<Element, 'contains'>,
  selection: string,
): boolean {
  if (selection.trim() !== '') return false;
  const hit = target?.closest(INTERACTIVE);
  return !hit || !row.contains(hit);
}
