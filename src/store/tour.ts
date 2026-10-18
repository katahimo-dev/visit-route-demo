// 初回の案内ツアー（PRD D192・D193。ADR-0025 追記。区切り8b）を見たか（とばしたか）を覚える。
// DemoData とは別のキー（データの版・書き出し・読み込み・初期状態に戻すに入れない）。値は「見た」印だけで、個人の情報は持たない。
// localStorage を触るのは store の中だけ（AGENTS.md）。使えないブラウザでも、開いている間は覚える

/** localStorage のキー（DemoData の STORAGE_KEY とは別） */
export const TOUR_SEEN_KEY = 'vrdemo:tour:seen';
/** 覚える値（「見た」の版。中身を大きく変えてもう一度見せたいときは上げる） */
export const TOUR_SEEN_VALUE = '1';

type KeyStore = Pick<Storage, 'getItem' | 'setItem'>;

/** 覚える先を差し替えられる形（テスト用）。getStorage が null や例外なら、開いている間だけ覚える */
export function createTourMemory(getStorage: () => KeyStore | null) {
  let seenHere = false;
  const store = (): KeyStore | null => {
    try {
      return getStorage();
    } catch {
      return null;
    }
  };
  return {
    /** 見た（とばした）ことがあるか */
    seen(): boolean {
      if (seenHere) return true;
      try {
        return store()?.getItem(TOUR_SEEN_KEY) === TOUR_SEEN_VALUE;
      } catch {
        return false;
      }
    },
    /** 見た（とばした）ことを覚える */
    markSeen(): void {
      seenHere = true;
      try {
        store()?.setItem(TOUR_SEEN_KEY, TOUR_SEEN_VALUE);
      } catch {
        // 保存できなくても、開いている間は覚える
      }
    },
  };
}

/** 画面全体で1つ（このブラウザの localStorage） */
export const tourMemory = createTourMemory(() => globalThis.localStorage ?? null);
