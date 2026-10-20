// 小さな値の入れ物（外の store）。よく変わる値（AI案の計算の進み具合。100msごと）を画面の state に置かず、
// 読む子の部品だけを描き直す（PRD D249。ADR-0039）。React の useSyncExternalStore で読む
import { useSyncExternalStore } from 'react';

export type ValueStore<T> = {
  get: () => T;
  /** 値を変える（関数なら前の値から）。同じ値（Object.is）なら知らせない */
  set: (next: T | ((prev: T) => T)) => void;
  subscribe: (listener: () => void) => () => void;
};

/** 読むだけの側（子の部品に渡す。書けない） */
export type ReadableStore<T> = Pick<ValueStore<T>, 'get' | 'subscribe'>;

export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      const v = typeof next === 'function' ? (next as (prev: T) => T)(value) : next;
      if (Object.is(v, value)) return;
      value = v;
      for (const l of [...listeners]) l();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** 入れ物の今の値（変わったら、これを呼んだ部品だけ描き直す） */
export function useValueStore<T>(store: ReadableStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
