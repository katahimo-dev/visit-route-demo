// 別のチャンクの部品（PRD D248。ADR-0039）。React.lazy に「先に読む」を足したもの。
// 読み終わったあとは lazy を通さず直に描く（React.lazy は読み終わっていても最初の描画で一度止まり、
// 画面を移るのが遅れる。先読みが済んでいれば止まらない）
import { type ComponentType, lazy, useState } from 'react';

export type LazyComponent<P extends object> = ComponentType<P> & {
  /** チャンクを読み始める（何度呼んでも1回だけ読む）。読めなければ次に呼んだとき・描くときに読み直す */
  preload: () => Promise<unknown>;
};

export function lazyComponent<P extends object>(load: () => Promise<{ default: ComponentType<P> }>): LazyComponent<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<{ default: ComponentType<P> }> | null = null;
  const preload = () => {
    pending ??= load().then(
      (m) => {
        loaded = m.default;
        return m;
      },
      (e) => {
        pending = null;
        throw e;
      },
    );
    return pending;
  };
  const Lazy = lazy(preload);
  const Component = (props: P) => {
    // 描き始めたときに決めて変えない（途中で lazy から直に替えると、部品が作り直されて状態が消える）
    const [Direct] = useState(() => loaded);
    return Direct ? <Direct {...props} /> : <Lazy {...props} />;
  };
  return Object.assign(Component, { preload });
}
