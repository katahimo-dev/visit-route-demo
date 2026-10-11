import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { type DemoData, STORAGE_KEY } from '../contracts/data';
import { flushSave, importJson, isImportError, load, reset as resetStore, save } from './index';

export type DemoStore = {
  data: DemoData;
  /** データを書き換える唯一の方法（不変更新。fn は新しい DemoData を返す） */
  update(fn: (d: DemoData) => DemoData): void;
  /** 読み込んだデータで置き換える */
  replace(d: DemoData): void;
  /** 初期状態に戻す */
  reset(): void;
  /** 保存に失敗したときの利用者向けの文言（容量超過など）。なければ null */
  saveError: string | null;
};

const Ctx = createContext<DemoStore | null>(null);

export function DemoDataProvider({ children }: { children: ReactNode }): ReactNode {
  const [data, setData] = useState<DemoData>(() => load());
  const [saveError, setSaveError] = useState<string | null>(null);
  // 別タブから読み直したデータは、書き戻さない（往復で上書き合戦にしない）
  const skipSave = useRef(true);

  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    save(data, setSaveError);
  }, [data]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || e.newValue === null) return;
      const r = importJson(e.newValue);
      if (isImportError(r)) return;
      skipSave.current = true;
      setData(r);
    };
    const onUnload = () => flushSave();
    window.addEventListener('storage', onStorage);
    window.addEventListener('pagehide', onUnload);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pagehide', onUnload);
    };
  }, []);

  const update = useCallback((fn: (d: DemoData) => DemoData) => setData((d) => fn(d)), []);
  const replace = useCallback((d: DemoData) => setData(d), []);
  const reset = useCallback(() => {
    setSaveError(null);
    setData(resetStore());
  }, []);

  const value = useMemo(() => ({ data, update, replace, reset, saveError }), [data, update, replace, reset, saveError]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDemoData(): DemoStore {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDemoData は DemoDataProvider の中で使ってください');
  return v;
}
