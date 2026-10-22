// 〈スタッフ〉の印（StaffMark。PRD D298・D299。ADR-0050）の色と中の文字を決める純粋関数。
// 色は〈スタッフ〉を名前の順（byName）に並べた位置から staffColor で引く（地図の線・時間軸の帯・列の見出しと同じ色）。
// 〈スタッフ〉のデータには色の欄が無い（〈利用者さん〉の color とは別）ので、どの画面も必ずここを通して同じ色にする
import type { Staff } from '../contracts/documents';
import { graphemeCount, graphemeSegmenter, STAFF_ICON_MAX, STAFF_ICON_MAX_UNITS } from '../contracts/documents';
import { byName, staffColor } from './common';

/** 名前の先頭の見た目の1文字（書記素。絵文字・結合文字も1文字） */
function firstGrapheme(s: string): string {
  if (s.length <= 1) return s;
  const seg = graphemeSegmenter();
  if (seg) for (const g of seg.segment(s)) return g.segment;
  return Array.from(s)[0] ?? '';
}

/** 苗字の最初の1文字：名前を空白（全角も）で区切った先頭の語の最初の1文字。空白が無ければ名前の最初の1文字。空なら「?」 */
export function surnameInitial(name: string): string {
  const head = name.trim().split(/[\s　]+/)[0] ?? '';
  return firstGrapheme(head) || '?';
}

/** 印の中の文字：アイコン（1〜2文字）があればそれ、無ければ苗字の最初の1文字 */
export function staffMarkText(s: Pick<Staff, 'name'> & { icon?: string }): string {
  const icon = (s.icon ?? '').trim();
  return icon === '' ? surnameInitial(s.name) : icon;
}

/** アイコンの入力の誤り（無ければ null）。前後の空白は保存の前に落とすので数えない */
export function staffIconError(icon: string): string | null {
  const t = icon.trim();
  return t.length > STAFF_ICON_MAX_UNITS || graphemeCount(t) > STAFF_ICON_MAX
    ? `アイコンは${STAFF_ICON_MAX}文字までにしてください`
    : null;
}

const cache = new WeakMap<readonly Staff[], Map<string, string>>();
/** 〈スタッフ〉ごとの色（id → 色）。全員（休止中も）を名前の順に並べた位置で決める。同じ配列なら作り直さない */
export function staffColorMap(staff: readonly Staff[]): Map<string, string> {
  const hit = cache.get(staff);
  if (hit) return hit;
  const m = new Map([...staff].sort(byName).map((s, i) => [s.id, staffColor(i)] as const));
  cache.set(staff, m);
  return m;
}
