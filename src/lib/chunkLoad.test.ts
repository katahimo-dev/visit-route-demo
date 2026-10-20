import { describe, expect, it } from 'vitest';
import { chunkUrlOf, createChunkLoader, isChunkLoadError, retryUrl } from './chunkLoad';

describe('isChunkLoadError（PRD D248）', () => {
  it('動的 import・CSS の読み込み失敗を見分ける', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/a.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: https://x/a.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/a.css'))).toBe(true);
  });
  it('ほかの例外・値は違う', () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('createChunkLoader（PRD D248）', () => {
  it('何度呼んでも1回だけ読み、読めた値を覚える', async () => {
    let calls = 0;
    const c = createChunkLoader(async () => {
      calls++;
      return 'm';
    });
    expect(c.loaded()).toBeNull();
    const [a, b] = await Promise.all([c.preload(), c.preload()]);
    expect([a, b, calls, c.loaded(), c.failures()]).toEqual(['m', 'm', 1, 'm', 0]);
  });

  it('失敗の文にチャンクの URL があれば、2回目は問い合わせを付けたその URL を読む', async () => {
    const urls: string[] = [];
    const c = createChunkLoader(
      async () => {
        throw new TypeError('Failed to fetch dynamically imported module: https://x/assets/PlanPage-a1.js');
      },
      async (url) => {
        urls.push(url);
        if (urls.length === 1) throw new TypeError('Failed to fetch dynamically imported module: '.concat(url));
        return 'm';
      },
    );
    await expect(c.preload()).rejects.toThrow();
    await expect(c.preload()).rejects.toThrow();
    await expect(c.preload()).resolves.toBe('m');
    expect(urls).toEqual(['https://x/assets/PlanPage-a1.js?retry=1', 'https://x/assets/PlanPage-a1.js?retry=2']);
    expect(c.failures()).toBe(2);
  });

  it('失敗したら数え、次に呼ぶと読み直す', async () => {
    let calls = 0;
    const c = createChunkLoader(async () => {
      calls++;
      if (calls === 1) throw new TypeError('Failed to fetch dynamically imported module');
      return 'm';
    });
    await expect(c.preload()).rejects.toThrow('dynamically imported');
    expect(c.failures()).toBe(1);
    expect(c.loaded()).toBeNull();
    await expect(c.preload()).resolves.toBe('m');
    expect([calls, c.loaded(), c.failures()]).toEqual([2, 'm', 1]);
  });
});

describe('chunkUrlOf・retryUrl', () => {
  it('Chrome・Firefox の文から URL を取る。無ければ null', () => {
    expect(chunkUrlOf(new TypeError('Failed to fetch dynamically imported module: http://h:4190/assets/A-1.js'))).toBe(
      'http://h:4190/assets/A-1.js',
    );
    expect(chunkUrlOf(new TypeError('error loading dynamically imported module: https://h/r/assets/B.js'))).toBe(
      'https://h/r/assets/B.js',
    );
    expect(chunkUrlOf(new TypeError('Importing a module script failed.'))).toBeNull();
  });
  it('問い合わせを付ける', () => {
    expect(retryUrl('https://h/a.js', 1)).toBe('https://h/a.js?retry=1');
    expect(retryUrl('https://h/a.js?retry=1', 2)).toBe('https://h/a.js?retry=1&retry=2');
  });
});
