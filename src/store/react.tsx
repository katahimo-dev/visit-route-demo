import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { type DemoData, STORAGE_KEY } from '../contracts/data';
import type { Features } from '../contracts/features';
import { CONDITIONS_BASE_KEY, type ConditionsBase, captureBase, conditionsMemory } from './conditions';
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
  rememberCurrent,
  reset as resetStore,
  samePreviousInfo,
  save,
  swapPrevious,
} from './index';

export type DemoStore = {
  data: DemoData;
  /**
   * データを書き換える唯一の方法（不変更新。fn は新しい DemoData を返す）。
   * 条件の変更の控え（conditionsBase）が無く条件の部分が変わったら、変わる前の条件を控える（PRD D290）。
   * keepBase：控えを取らない（作り直しの帯の「戻す」。戻したこと自体を変更として控えない）
   */
  update(fn: (d: DemoData) => DemoData, opts?: { keepBase?: boolean }): void;
  /** 読み込んだデータで置き換える */
  replace(d: DemoData): void;
  /** 初期状態に戻す（機能の入り切りは features、既定は今のまま。PRD D216・D276） */
  reset(features?: Features): void;
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
  /** 読めなかった元の文字を退避できたか（できなければ知らせは「今すぐ書き出してください」） */
  brokenKept: boolean;
  dismissBroken(): void;
  /** 起動したとき保存データが無く、初めて開いたか（初回の案内ツアーで「どこまで使うか」を聞く。PRD D276） */
  startedFresh: boolean;
  /** 別のタブの変更で読み直した回数（画面が知らせを出すきっかけ） */
  externalReloads: number;
  /**
   * データを丸ごと差し替えた回数（読み込み replace・初期状態に戻す reset・直前の状態に戻す restorePrevious・別のタブの変更の読み直し）。
   * 作っている途中の計算（月まとめ作成。ADR-0042）が古いデータから作った結果を書かないよう、変わったら止めるきっかけ
   */
  replacedCount: number;
  /** 保存の容量が足りず1世代の控えを捨てた回数（画面が知らせを出すきっかけ。ADR-0032） */
  previousDrops: number;
  /**
   * 条件の変更の控え（PRD D290。ADR-0049）：最後に影響する日が0日だった時点の条件（DemoData とは別のキー）。無ければ null。
   * update で条件が変わったときに取り、作り直しの帯が0日を数えたら clearConditionsBase で消す。読み込み・初期状態に戻す・直前の状態に戻すで消す
   */
  conditionsBase: ConditionsBase | null;
  clearConditionsBase(): void;
};

const Ctx = createContext<DemoStore | null>(null);

export function DemoDataProvider({ children }: { children: ReactNode }): ReactNode {
  const [initial] = useState(() => loadWithStatus());
  const [data, setData] = useState<DemoData>(initial.data);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [previous, setPreviousState] = useState<PreviousInfo | null>(() => previousInfo());
  /** 控えの時刻と操作の名前が同じなら state を替えない（全体を描き直さない） */
  const setPrevious = useCallback(
    (next: PreviousInfo | null) => setPreviousState((cur) => (samePreviousInfo(cur, next) ? cur : next)),
    [],
  );
  const [broken, setBroken] = useState(initial.broken);
  const [externalReloads, setExternalReloads] = useState(0);
  const [replacedCount, setReplacedCount] = useState(0);
  const replaced = useCallback(() => setReplacedCount((n) => n + 1), []);
  const [previousDrops, setPreviousDrops] = useState(0);
  // 別タブから読み直したデータは、書き戻さない（往復で上書き合戦にしない）
  const skipSave = useRef(true);
  const latest = useRef(data);
  latest.current = data;
  // 初期データで始めたとき（保存データが無い・読めなかった）は控え無しで始める（loadWithStatus が消している。PRD D290）
  const [conditionsBase, setConditionsBaseState] = useState<ConditionsBase | null>(() =>
    initial.fresh || initial.broken ? null : conditionsMemory.read(),
  );
  const baseRef = useRef(conditionsBase);
  /** 最後に描いたデータ（控えは、この前と今を比べて取る） */
  const committed = useRef(data);
  /**
   * 控えを取らない書き換えで来たデータ（読み込み・初期状態に戻す・直前の状態に戻す・別のタブ・keepBase の update）。
   * そこから続けた update の結果も入れる（同じ描き直しにまとまったとき、差し替える前と比べない）
   */
  const noCapture = useRef(new WeakSet<DemoData>());
  const setBase = useCallback((b: ConditionsBase | null) => {
    baseRef.current = b;
    setConditionsBaseState(b);
  }, []);
  const clearConditionsBase = useCallback(() => {
    if (baseRef.current === null) return;
    conditionsMemory.clear();
    setBase(null);
  }, [setBase]);
  /** 控えを取らないデータにする */
  const mark = useCallback((d: DemoData): DemoData => {
    noCapture.current.add(d);
    return d;
  }, []);

  useEffect(() => {
    const prev = committed.current;
    committed.current = data;
    if (noCapture.current.has(data)) return;
    const next = captureBase(prev, data, baseRef.current, Date.now());
    if (!next) return;
    conditionsMemory.write(next);
    setBase(next);
  }, [data, setBase]);

  useEffect(() => {
    // 例外の画面の控えは、画面が使っている最新のデータを書き出す（別のタブから読み直したデータも）
    rememberCurrent(data);
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    save(data, (message, dropped, droppedBase) => {
      setSaveError(message);
      // 容量が足りず条件の変更の控えを捨てたら、画面の控えも忘れる（本体の保存が先。PRD D290）
      if (droppedBase) setBase(null);
      // 容量が足りず控えを捨てたときだけ、控えの欄を消して知らせる（ADR-0032）
      if (dropped) {
        setPrevious(null);
        setPreviousDrops((n) => n + 1);
      }
    });
  }, [data, setPrevious, setBase]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREV_KEY || e.key === PREV_INFO_KEY) {
        setPrevious(previousInfo());
        return;
      }
      // 別のタブで取った・消した控え（null は clear のすべて消す）
      if (e.key === CONDITIONS_BASE_KEY || e.key === null) setBase(conditionsMemory.read());
      if (e.key !== STORAGE_KEY || e.newValue === null) return;
      const r = importJson(e.newValue);
      if (isImportError(r)) return;
      skipSave.current = true;
      // 別のタブの変更は、控えもそのタブが取る（ここでは読み直すだけ）
      setData(mark(r));
      replaced();
      setExternalReloads((n) => n + 1);
    };
    const onUnload = () => flushSave();
    window.addEventListener('storage', onStorage);
    window.addEventListener('pagehide', onUnload);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pagehide', onUnload);
    };
  }, [setPrevious, replaced, setBase, mark]);

  const update = useCallback(
    (fn: (d: DemoData) => DemoData, opts?: { keepBase?: boolean }) => {
      setData((d) => {
        const n = fn(d);
        if (n === d) return n;
        // まだ描いていない差し替えの続き（同じ描き直しにまとまる）は、差し替えと同じく控えを取らない
        const afterSwap = noCapture.current.has(d) && d !== committed.current;
        return opts?.keepBase || afterSwap ? mark(n) : n;
      });
    },
    [mark],
  );
  /** 丸ごと差し替える：控えを消す（比べる元が違う。PRD D290） */
  const swapIn = useCallback(
    (d: DemoData) => {
      clearConditionsBase();
      setData(mark(d));
    },
    [clearConditionsBase, mark],
  );
  const replace = useCallback(
    (d: DemoData) => {
      swapIn(d);
      replaced();
    },
    [replaced, swapIn],
  );
  const reset = useCallback(
    (features?: Features) => {
      setSaveError(null);
      swapIn(resetStore(features ?? latest.current.org.features));
      replaced();
    },
    [replaced, swapIn],
  );
  const keepPrevious = useCallback(
    (reason: string): PreviousKeep => {
      const k = keepPreviousStore(latest.current, reason);
      setPrevious(previousInfo());
      return {
        ...k,
        cancel: () => {
          k.cancel();
          setPrevious(previousInfo());
        },
      };
    },
    [setPrevious],
  );
  const restorePrevious = useCallback((): string | null => {
    // いまのデータを控えと入れ替える（戻したあとにもう一度戻せる）。いまのデータを控えに残せなければ戻さない
    const r = swapPrevious(latest.current);
    setPrevious(previousInfo());
    if ('error' in r) return r.error;
    setSaveError(null);
    swapIn(r.data);
    replaced();
    return null;
  }, [setPrevious, replaced, swapIn]);
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
      brokenKept: initial.brokenKept,
      dismissBroken,
      startedFresh: initial.fresh,
      externalReloads,
      replacedCount,
      previousDrops,
      conditionsBase,
      clearConditionsBase,
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
      initial.brokenKept,
      dismissBroken,
      initial.fresh,
      externalReloads,
      replacedCount,
      previousDrops,
      conditionsBase,
      clearConditionsBase,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDemoData(): DemoStore {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDemoData は DemoDataProvider の中で使ってください');
  return v;
}
