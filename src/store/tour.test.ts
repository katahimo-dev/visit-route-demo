import { describe, expect, it } from 'vitest';
import { STORAGE_KEY } from '../contracts/data';
import { createTourMemory, TOUR_SEEN_KEY } from './tour';

const fake = () => {
  const m = new Map<string, string>();
  return {
    m,
    ls: {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        m.set(k, v);
      },
    },
  };
};

describe('tourMemory', () => {
  it('はじめは見ていない。覚えると見た（DemoData とは別のキー）', () => {
    const { m, ls } = fake();
    const t = createTourMemory(() => ls);
    expect(t.seen()).toBe(false);
    t.markSeen();
    expect(t.seen()).toBe(true);
    expect(m.get(TOUR_SEEN_KEY)).toBe('1');
    expect(TOUR_SEEN_KEY).not.toBe(STORAGE_KEY);
    // 別に作っても（読み直しても）覚えている
    expect(createTourMemory(() => ls).seen()).toBe(true);
  });
  it('localStorage が使えなくても落ちず、開いている間は覚える', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const t = createTourMemory(() => broken);
    expect(t.seen()).toBe(false);
    t.markSeen();
    expect(t.seen()).toBe(true);
    const none = createTourMemory(() => {
      throw new Error('no storage');
    });
    expect(none.seen()).toBe(false);
    none.markSeen();
    expect(none.seen()).toBe(true);
  });
  it('知らない値は見ていない扱い', () => {
    const { m, ls } = fake();
    m.set(TOUR_SEEN_KEY, 'x');
    expect(createTourMemory(() => ls).seen()).toBe(false);
  });
});
