// 最後に書き出した日と、控えの知らせを出した日（PRD D227。ADR-0032）。
// ブラウザごとの記録なので DemoData とは別のキー（データの版・書き出し・読み込み・初期状態に戻すに入れない。tour.ts と同じ扱い）。
// localStorage を触るのは store の中だけ（AGENTS.md）。使えないブラウザでも、開いている間は覚える

/** 最後に書き出した日（`{ date: 'YYYY-MM-DD', kind: 'json' | 'excel' }`） */
export const BACKUP_LAST_KEY = 'vrdemo:backup:last';
/** 控えの知らせを最後に出した日（'YYYY-MM-DD'） */
export const BACKUP_REMINDED_KEY = 'vrdemo:backup:reminded';

/** 書き出したもの：控え（JSON）か Excel の全体（名簿だけの書き出しは数えない） */
export type ExportKind = 'json' | 'excel';
export type LastExport = { date: string; kind: ExportKind };

type KeyStore = Pick<Storage, 'getItem' | 'setItem'>;

const isDate = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);

/** 覚える先を差し替えられる形（テスト用）。getStorage が null や例外なら、開いている間だけ覚える */
export function createBackupMemory(getStorage: () => KeyStore | null) {
  let lastHere: LastExport | null = null;
  let remindedHere: string | null = null;
  const store = (): KeyStore | null => {
    try {
      return getStorage();
    } catch {
      return null;
    }
  };
  const read = (key: string): string | null => {
    try {
      return store()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const write = (key: string, value: string) => {
    try {
      store()?.setItem(key, value);
    } catch {
      // 保存できなくても、開いている間は覚える
    }
  };
  return {
    /** 最後に書き出した日。まだなら null */
    lastExport(): LastExport | null {
      if (lastHere) return lastHere;
      try {
        const raw = JSON.parse(read(BACKUP_LAST_KEY) ?? 'null') as Partial<LastExport> | null;
        if (!raw || !isDate(raw.date) || (raw.kind !== 'json' && raw.kind !== 'excel')) return null;
        return { date: raw.date, kind: raw.kind };
      } catch {
        return null;
      }
    },
    /** 書き出したことを覚える（date は日本時間の YYYY-MM-DD） */
    markExported(kind: ExportKind, date: string): void {
      lastHere = { date, kind };
      write(BACKUP_LAST_KEY, JSON.stringify(lastHere));
    },
    /** 控えの知らせを最後に出した日。まだなら null */
    lastReminded(): string | null {
      if (remindedHere) return remindedHere;
      const v = read(BACKUP_REMINDED_KEY);
      return isDate(v) ? v : null;
    },
    /** 控えの知らせを出したことを覚える */
    markReminded(date: string): void {
      remindedHere = date;
      write(BACKUP_REMINDED_KEY, date);
    },
  };
}

/** 画面全体で1つ（このブラウザの localStorage） */
export const backupMemory = createBackupMemory(() => globalThis.localStorage ?? null);
