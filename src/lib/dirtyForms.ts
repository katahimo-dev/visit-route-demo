// 変更があるまま開いている編集の欄の数（PRD D227）。別のタブの変更で読み直したとき、知らせの文を選ぶのに使う。
// 欄（〈スタッフ〉・〈利用者さん〉の編集）は beforeunload と同じ dirty を useDirtyMark で知らせる。データは書き換えない
import { useEffect } from 'react';

const dirty = new Set<symbol>();

/** 変更があるまま開いている編集の欄があるか */
export const hasDirtyForm = (): boolean => dirty.size > 0;

/** 別のタブの変更で読み直したときの知らせ（編集の欄に変更が無いとき） */
export const OTHER_TAB_TEXT = '別のタブで変わったので読み直しました';
/** 同じく、編集の欄に変更があるとき（入力はそのまま残る） */
export const OTHER_TAB_DIRTY_TEXT = '別のタブで変わりました。保存すると上書きします';

/** 別のタブの変更の知らせの文 */
export const otherTabText = (editing: boolean): string => (editing ? OTHER_TAB_DIRTY_TEXT : OTHER_TAB_TEXT);

/** 編集の欄の変更の有無を知らせる（欄が閉じる・変更が無くなると外す） */
export function useDirtyMark(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    const id = Symbol('dirty');
    dirty.add(id);
    return () => {
      dirty.delete(id);
    };
  }, [on]);
}
