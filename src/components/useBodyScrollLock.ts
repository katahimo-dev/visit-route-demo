import { useEffect } from 'react';
import { createScrollLock } from '../lib/scrollLock';

/** 画面全体で1つのロック（html と body の overflow） */
const shared = createScrollLock(() =>
  typeof document === 'undefined' ? [] : [document.documentElement.style, document.body.style],
);

/**
 * 開いているあいだ裏の画面を巻かない（右の欄 SidePanel・スマホのメニューの引き出し。PRD D133）。
 * 重なって開いても、最後の1つが閉じるまで戻さない
 */
export function useBodyScrollLock(active = true): void {
  useEffect(() => {
    if (!active) return;
    return shared.lock();
  }, [active]);
}
