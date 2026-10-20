import { describe, expect, it } from 'vitest';
import { createValueStore } from './valueStore';

describe('createValueStore（PRD D249）', () => {
  it('値を変えると知らせ、関数なら前の値から作る', () => {
    const s = createValueStore<{ n: number } | null>(null);
    let calls = 0;
    const off = s.subscribe(() => calls++);
    s.set({ n: 1 });
    s.set((prev) => ({ n: (prev?.n ?? 0) + 1 }));
    expect(s.get()).toEqual({ n: 2 });
    expect(calls).toBe(2);
    off();
    s.set(null);
    expect(calls).toBe(2);
    expect(s.get()).toBeNull();
  });

  it('同じ値なら知らせない', () => {
    const s = createValueStore(0);
    let calls = 0;
    s.subscribe(() => calls++);
    s.set(0);
    s.set((v) => v);
    expect(calls).toBe(0);
  });
});
