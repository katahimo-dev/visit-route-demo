// 別のチャンクの部品（PRD D248。ADR-0039）。React.lazy に「先に読む」と「失敗したら読み直す」を足したもの。
// 読み終わったあとは lazy を通さず直に描く（React.lazy は読み終わっていても最初の描画で一度止まり、
// 画面を移るのが遅れる。先読みが済んでいれば止まらない）
import { type ComponentType, type LazyExoticComponent, lazy, useState } from 'react';
import { createChunkLoader } from './chunkLoad';

export type LazyComponent<P extends object> = ComponentType<P> & {
  /** チャンクを読み始める（何度呼んでも1回だけ読む）。読めなければ次に呼んだとき・描くときに読み直す */
  preload: () => Promise<unknown>;
};

let retryEpoch = 0;
/** 読めなかった部品を、次に描くときに読み直す（例外の画面の「もう一度表示する」） */
export function retryFailedChunks(): void {
  retryEpoch++;
}

export function lazyComponent<P extends object>(
  name: string,
  load: () => Promise<{ default: ComponentType<P> }>,
): LazyComponent<P> {
  const loader = createChunkLoader(load);
  // React.lazy は失敗を覚えて同じ例外を投げ続けるので、「もう一度表示する」（retryFailedChunks）のあとは作り直す。
  // 失敗するたびに作り直すと、React の描き直しのたびに読み直して止まらない
  let lazyOf: { epoch: number; Lazy: LazyExoticComponent<ComponentType<P>> } | null = null;
  const currentLazy = () => {
    if (lazyOf?.epoch !== retryEpoch) lazyOf = { epoch: retryEpoch, Lazy: lazy(loader.preload) };
    return lazyOf.Lazy;
  };
  const Component = (props: P) => {
    // 描き始めたときに決めて変えない（途中で lazy から直に替えると、部品が作り直されて状態が消える）
    const [Direct] = useState(() => loader.loaded()?.default ?? null);
    if (Direct) return <Direct {...props} />;
    const Lazy = currentLazy();
    return <Lazy {...props} />;
  };
  Component.displayName = `Lazy(${name})`;
  return Object.assign(Component, { preload: loader.preload });
}
