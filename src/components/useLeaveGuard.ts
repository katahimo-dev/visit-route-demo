// 確定していない下書きがある画面を離れる前の確認（PRD D286。ADR-0048）。移る先の判定と確かめ方の置き場は lib/leaveGuard
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import type { ConfirmOptions } from '../lib/confirmDialog';
import { useDirtyMark } from '../lib/dirtyForms';
import { type LeaveGuard, leaveTarget, setLeaveGuard } from '../lib/leaveGuard';
import { useConfirm } from './ConfirmDialog';

/**
 * 下書きがある間（on）、画面を離れる前に確認を出す（dialog は確認の中身。確定で移る（onLeave を呼ぶ）、取り消しで留まる）。
 * 別のタブの変更の知らせ（PRD D227）にも「変更がある」と知らせる（useDirtyMark）
 */
export function useLeaveGuard(on: boolean, dialog: ConfirmOptions, onLeave?: () => void): void {
  const confirmDialog = useConfirm();
  const { pathname } = useLocation();
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  /** 確定して離れるときに呼ぶ（下書きを捨てる。同じ画面の別の人へ移るとき、画面がもう一度確かめないように） */
  const leaveRef = useRef(onLeave);
  leaveRef.current = onLeave;
  useDirtyMark(on);
  useEffect(() => {
    if (!on) return;
    let asking: Promise<boolean> | null = null;
    const ask: LeaveGuard = () => {
      asking ??= confirmDialog(dialogRef.current)
        .then((ok) => {
          if (ok) leaveRef.current?.();
          return ok;
        })
        .finally(() => {
          asking = null;
        });
      return asking;
    };
    const unset = setLeaveGuard(ask);
    /** 確定したあと、押したリンクをもう一度押す間は止めない（リンクの onClick（引き出しを閉じる・日付を選ぶ等）もそのまま動く） */
    let pass = false;
    const onClick = (e: MouseEvent) => {
      if (pass || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      if (leaveTarget(a.getAttribute('href'), pathname) === null) return;
      e.preventDefault();
      e.stopPropagation();
      void ask().then((ok) => {
        if (!ok || !a.isConnected) return;
        pass = true;
        try {
          a.click();
        } finally {
          pass = false;
        }
      });
    };
    // 再読込・タブを閉じる（ブラウザの確認。独自の確認は出せない）
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      unset();
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [on, pathname, confirmDialog]);
}
