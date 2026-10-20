// 別のチャンクの読み込み（PRD D248。ADR-0039）：失敗の見分けと、失敗したら読み直せる読み込み。
// 失敗するのは、新しい版が公開されて古いチャンクが無くなった（古いタブ）か、通信が切れたとき

/** ブラウザ・Vite が動的 import・CSS の読み込みに失敗したときの文（Chrome・Firefox・Safari・Vite の preload） */
const CHUNK_MESSAGES = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
];

/** チャンクを読めなかった例外か（データの壊れ・不具合と分けて、再読み込みを勧める） */
export function isChunkLoadError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return CHUNK_MESSAGES.some((re) => re.test(e.message));
}

export type ChunkLoader<T> = {
  /** 読み始める（読んでいる間・読めたあとは同じ Promise）。失敗したら次に呼んだとき読み直す */
  preload: () => Promise<T>;
  /** 読めた値（まだなら null） */
  loaded: () => T | null;
  /** 失敗した回数 */
  failures: () => number;
};

/** 例外の文の中のチャンクの URL（Chrome・Firefox は文に入れる。Safari は入れない） */
export function chunkUrlOf(e: unknown): string | null {
  if (!(e instanceof Error)) return null;
  return /(https?:\/\/\S+?\.(?:js|css))\b/.exec(e.message)?.[1] ?? null;
}

/** 読み直す URL（ブラウザは読めなかったモジュールを覚えていて同じ URL では読み直さないので、問い合わせを付けて別にする） */
export function retryUrl(url: string, attempt: number): string {
  return `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}`;
}

/**
 * 失敗したら読み直せる読み込み。2回目からは、前の失敗の文にチャンクの URL があれば問い合わせを付けてその URL を直に読む
 * （reimport。既定は動的 import）。URL が分からなければ load をもう一度呼ぶ
 */
export function createChunkLoader<T>(
  load: () => Promise<T>,
  reimport: (url: string) => Promise<T> = (url) => import(/* @vite-ignore */ url),
): ChunkLoader<T> {
  let value: T | null = null;
  let pending: Promise<T> | null = null;
  let failures = 0;
  let lastUrl: string | null = null;
  return {
    preload: () => {
      pending ??= (lastUrl ? reimport(retryUrl(lastUrl, failures)) : load()).then(
        (m) => {
          value = m;
          return m;
        },
        (e) => {
          pending = null;
          failures++;
          lastUrl = chunkUrlOf(e) ?? lastUrl;
          throw e;
        },
      );
      return pending;
    },
    loaded: () => value,
    failures: () => failures,
  };
}
