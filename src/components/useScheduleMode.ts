// 予定のモード（PRD D348。ADR-0061）の今の値。選んだモードはタブの間だけ覚え（sessionStorage）、選んでいなければ既定（lib/scheduleMode の
// defaultMode）。メニュー・ナビの行・操作の行・札の動かし方が同じ値を読む
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { jstDate } from '../domain/time';
import { defaultMode, modeTools, nextYm, parseMode, type ScheduleMode, unassignedDays } from '../lib/scheduleMode';
import { useDemoData } from '../store';

/** 選んだモードを覚える所（タブを閉じれば消える） */
export const MODE_KEY = 'visit-route-demo:schedule-mode';

const listeners = new Set<() => void>();
/** sessionStorage が使えないときの覚え */
let memo: ScheduleMode | null = null;
const read = (): string | null => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(MODE_KEY);
  } catch {
    return null;
  }
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** モードを選ぶ（覚えて、読んでいる部品を描き直す） */
export function chooseMode(mode: ScheduleMode): void {
  try {
    sessionStorage.setItem(MODE_KEY, mode);
  } catch {
    // 覚えられなくても、このあとの描画では選んだモードを使う
    memo = mode;
  }
  for (const fn of listeners) fn();
}

/** 今のモード・選んだか・既定・モードで出す操作・選ぶ関数 */
export function useScheduleMode() {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const chosen = parseMode(raw) ?? memo;
  const { data } = useDemoData();
  const today = jstDate(Date.now());
  // 既定は選んでいないときだけ数える（来月の担当なしの日。compile しないので軽い）
  const fallback = useMemo(
    () => (chosen ? null : defaultMode(today, unassignedDays(data, nextYm(today), today))),
    [chosen, data, today],
  );
  const mode: ScheduleMode = chosen ?? fallback ?? 'check';
  const setMode = useCallback((m: ScheduleMode) => chooseMode(m), []);
  return { mode, chosen: chosen !== null, tools: modeTools(mode), setMode };
}
