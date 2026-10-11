import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * useEffect の本体を式にしない（戻り値が後始末として呼ばれる）。
 * Brave（Android）では window.scrollTo が値を返すため、画面を移るたびに「I is not a function」で落ちた
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

describe('useEffect の本体', () => {
  it('式本体（() => 値）で書いていない', () => {
    const bad = files('src').flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((line, i) => ({ f, i: i + 1, line }))
        .filter(({ line }) => /use(Layout)?Effect\(\s*\(\)\s*=>\s*[^\s{(]/.test(line)),
    );
    expect(bad.map(({ f, i }) => `${f}:${i}`)).toEqual([]);
  });
});
