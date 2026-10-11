import { createContext, useContext } from 'react';

/** 画面で選んでいる日付（データの中の日付から選ぶ。すべての画面で共通） */
export type DayCtx = { date: string; setDate: (d: string) => void; dates: string[] };
const Ctx = createContext<DayCtx | null>(null);
export const DayProvider = Ctx.Provider;
export function useDay(): DayCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('DayProvider がありません');
  return v;
}
