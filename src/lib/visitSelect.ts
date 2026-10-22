// 訪問を選ぶ（複数選択。PRD D330・D340。ADR-0056）の純粋関数：日・週・月・人の予定表で同じ押し方
// （Shift／Ctrl（mac は ⌘）＋クリック、Shift／Ctrl＋Enter、スマホは長押しか「選ぶ」）と、選べる訪問の決まり、まとめて選ぶ・外す
import type { Visit } from '../contracts/documents';
import { canMoveVisit } from './week';

/** 複数選択の押し方か（Shift・Ctrl・⌘ を押しながら） */
export const isMultiClick = (e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean =>
  e.shiftKey || e.ctrlKey || e.metaKey;

/** 複数選択のキーか（Shift／Ctrl／⌘＋Enter） */
export const isMultiKey = (e: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): boolean => e.key === 'Enter' && !e.altKey && isMultiClick(e);

/** 選べる訪問か（今日より前・取り消し・〈利用者さん〉の休みのため無しは選ばない） */
export const canSelectVisit = (v: Pick<Visit, 'date' | 'cancelled'>, leave: boolean, today: string): boolean =>
  !v.cancelled && !leave && canMoveVisit(v.date, today);

/** 1件を選ぶ・外す */
export const toggleId = (ids: readonly string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

/**
 * まとめて選ぶ・外す（月のマス：その日の選べる訪問）。全部選んでいれば全部外し、そうでなければ足りない分を足す。
 * 空なら変えない
 */
export function toggleGroup(ids: readonly string[], group: readonly string[]): readonly string[] {
  if (group.length === 0) return ids;
  const on = new Set(ids);
  if (group.every((x) => on.has(x))) return ids.filter((x) => !group.includes(x));
  return [...ids, ...group.filter((x) => !on.has(x))];
}

/** 選んだ訪問の読み上げの添え（「（選択中）」） */
export const selectedText = (on: boolean): string => (on ? '（選択中）' : '');
