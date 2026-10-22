// 全体の「元に戻す・やり直す」（PRD D329。ADR-0054）の画面の部品：Ctrl+Z・Ctrl+Shift+Z のキー、操作の行のボタン、
// トーストに添える「元に戻す」。履歴は lib/history の appHistory（store が積む）
import { Redo2, Undo2 } from 'lucide-react';
import { type ReactNode, useEffect, useMemo } from 'react';
import { hashPathname, isMacPlatform } from '../lib/commandPalette';
import { appHistory, historyKey, historyKeysOn, isTextTarget } from '../lib/history';
import { useValueStore } from '../lib/valueStore';
import { useDemoData } from '../store';
import { type ToastAction, useToast } from './Toast';
import { WithIcon } from './ui';

/** このブラウザが mac か（⌘Z と Ctrl+Z。CommandPalette と同じ決め方。循環を避けてここで決める） */
const IS_MAC = typeof navigator !== 'undefined' && isMacPlatform(navigator.platform || navigator.userAgent);

/** キーの名前（ボタンの title・説明） */
export const UNDO_KEY = IS_MAC ? '⌘Z' : 'Ctrl+Z';
export const REDO_KEY = IS_MAC ? '⌘⇧Z' : 'Ctrl+Shift+Z';

/** 戻す・やり直す（押したら知らせる。知らせにはもう一方のボタン） */
export function useHistoryOps(): { undo(): void; redo(): void } {
  const { undo: undoStore, redo: redoStore } = useDemoData();
  const toast = useToast();
  return useMemo(() => {
    const undo = () => {
      const label = undoStore();
      if (label === null) {
        toast('戻せる操作がありません');
        return;
      }
      toast(`元に戻しました（${label}）`, { action: { label: 'やり直す', onClick: redo, testId: 'toast-redo' } });
    };
    const redo = () => {
      const label = redoStore();
      if (label === null) {
        toast('やり直せる操作がありません');
        return;
      }
      toast(`やり直しました（${label}）`, { action: { label: '元に戻す', onClick: undo, testId: 'toast-undo' } });
    };
    return { undo, redo };
  }, [undoStore, redoStore, toast]);
}

/** トーストに添える「元に戻す」（全体の履歴を1手戻す） */
export function useUndoAction(): ToastAction {
  const { undo } = useHistoryOps();
  return { label: '元に戻す', onClick: undo, testId: 'toast-undo' };
}

/**
 * Ctrl+Z（mac は ⌘Z）で戻す・Ctrl+Shift+Z（Ctrl+Y）でやり直す。App の殻に1つ。
 * 入力欄・テキストエリアの中では奪わない（その欄の文字の取り消し）。確認・引き出し・パレット（aria-modal）が開いている間も動かない
 */
export function HistoryKeys(): ReactNode {
  const { undo, redo } = useHistoryOps();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = historyKey(e, IS_MAC);
      if (!k || e.isComposing || e.defaultPrevented) return;
      if (isTextTarget(e.target)) return;
      // 管理の画面の外（〈スタッフ〉のスマホ画面・月の予定の印刷）では効かせない（戻すボタンも知らせの行き先も無いため）
      if (!historyKeysOn(hashPathname(window.location.hash))) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      if (k === 'undo') undo();
      else redo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);
  return null;
}

/**
 * 操作の行の「元に戻す」「やり直す」（予定の日・週・月で同じ。PRD D327・D329）。戻せないときも押せる所に残し（フォーカスを落とさない）、
 * 理由は title。戻す手の名前を title に出す
 */
export function UndoButtons({ redoShown = true }: { redoShown?: boolean }) {
  const h = useValueStore(appHistory.state);
  const { undo, redo } = useHistoryOps();
  return (
    <>
      <button
        type="button"
        className="btn btn-text"
        aria-disabled={h.undo === null || undefined}
        aria-keyshortcuts={IS_MAC ? 'Meta+Z' : 'Control+Z'}
        title={h.undo === null ? '戻せる操作がありません' : `「${h.undo}」を戻します（${UNDO_KEY}）`}
        onClick={() => h.undo !== null && undo()}
        data-testid="undo-btn"
      >
        <WithIcon icon={Undo2}>元に戻す</WithIcon>
      </button>
      {redoShown && h.redo !== null && (
        <button
          type="button"
          className="btn btn-text"
          aria-keyshortcuts={IS_MAC ? 'Meta+Shift+Z' : 'Control+Shift+Z'}
          title={`「${h.redo}」をやり直します（${REDO_KEY}）`}
          onClick={redo}
          data-testid="redo-btn"
        >
          <WithIcon icon={Redo2}>やり直す</WithIcon>
        </button>
      )}
    </>
  );
}
