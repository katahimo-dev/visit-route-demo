import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { type DemoData, STORAGE_KEY } from '../contracts/data';
import {
  flushSave,
  importJson,
  isImportError,
  keepPrevious as keepPreviousStore,
  loadWithStatus,
  PREV_INFO_KEY,
  PREV_KEY,
  type PreviousInfo,
  type PreviousKeep,
  previousInfo,
  readPrevious,
  rememberCurrent,
  reset as resetStore,
  save,
} from './index';

/** 「直前の状態に戻す」でいまのデータを控えるときの操作の名前 */
export const RESTORE_REASON = '直前の状態に戻す';

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
  /**
   * 置き換える前に、いまのデータを1世代だけ控える（PRD D227。ADR-0032）。reason は操作の名前（「初期状態に戻す」など）。
   * 確認の前に呼び、取り消したら cancel()。残せなければ kept=false と理由（操作は止めない）
   */
  keepPrevious(reason: string): PreviousKeep;
  /** 控えに戻す（いまのデータは控えと入れ替える）。失敗は利用者向けの文言、成功は null */
  restorePrevious(): string | null;
  /** 控えの時刻と操作の名前（無ければ null） */
  previous: PreviousInfo | null;
  /** 起動したとき、保存していたデータが読めず初期データで開いたか（知らせを閉じると false） */
  broken: boolean;
  dismissBroken(): void;
  /** 別のタブの変更で読み直した回数（画面が知らせを出すきっかけ） */
  externalReloads: number;
};

const Ctx = createContext<DemoStore | null>(null);

export function DemoDataProvider({ children }: { children: ReactNode }): ReactNode {
  const [initial] = useState(() => loadWithStatus());
  const [data, setData] = useState<DemoData>(initial.data);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [previous, setPrevious] = useState<PreviousInfo | null>(() => previousInfo());
  const [broken, setBroken] = useState(initial.broken);
  const [externalReloads, setExternalReloads] = useState(0);
  // 別タブから読み直したデータは、書き戻さない（往復で上書き合戦にしない）
  const skipSave = useRef(true);
  const latest = useRef(data);
  latest.current = data;

  useEffect(() => {
    // 例外の画面の控えは、画面が使っている最新のデータを書き出す（別のタブから読み直したデータも）
    rememberCurrent(data);
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    save(data, (message) => {
      setSaveError(message);
      // 容量超過で控えを捨てたことがあるので読み直す（ADR-0032）
      setPrevious(previousInfo());
    });
  }, [data]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREV_KEY || e.key === PREV_INFO_KEY) {
        setPrevious(previousInfo());
        return;
      }
      if (e.key !== STORAGE_KEY || e.newValue === null) return;
      const r = importJson(e.newValue);
      if (isImportError(r)) return;
      skipSave.current = true;
      setData(r);
      setExternalReloads((n) => n + 1);
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
  const keepPrevious = useCallback((reason: string): PreviousKeep => {
    const k = keepPreviousStore(latest.current, reason);
    setPrevious(previousInfo());
    return {
      ...k,
      cancel: () => {
        k.cancel();
        setPrevious(previousInfo());
      },
    };
  }, []);
  const restorePrevious = useCallback((): string | null => {
    const r = readPrevious();
    if (r === null) {
      setPrevious(null);
      return '戻せる控えがありません（別のタブで使ったか、容量のために消えました）';
    }
    if (isImportError(r)) return `控えを読めませんでした（${r.message}）`;
    // いまのデータを控えと入れ替える（戻したあとにもう一度戻せる）
    keepPreviousStore(latest.current, RESTORE_REASON);
    setPrevious(previousInfo());
    setSaveError(null);
    setData(r);
    return null;
  }, []);
  const dismissBroken = useCallback(() => setBroken(false), []);

  const value = useMemo(
    () => ({
      data,
      update,
      replace,
      reset,
      saveError,
      keepPrevious,
      restorePrevious,
      previous,
      broken,
      dismissBroken,
      externalReloads,
    }),
    [
      data,
      update,
      replace,
      reset,
      saveError,
      keepPrevious,
      restorePrevious,
      previous,
      broken,
      dismissBroken,
      externalReloads,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDemoData(): DemoStore {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDemoData は DemoDataProvider の中で使ってください');
  return v;
}
