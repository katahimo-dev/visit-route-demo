// ページを読み直す（チャンクを読めなかったとき。PRD D248）。保存は間引いているので、待っている保存を書いてから少し待って読み直す
import { flushSave } from '../store';

/** 読み直すまでの待ち（main.tsx の「初期状態に戻して読み直す」と同じ） */
export const RELOAD_WAIT_MS = 500;

export function reloadPage(): void {
  try {
    flushSave();
  } catch (e) {
    console.error(e);
  }
  setTimeout(() => location.reload(), RELOAD_WAIT_MS);
}
