import { describe, expect, it } from 'vitest';
import { own } from './common';

describe('own（自分のキーだけを引く）', () => {
  it('constructor・toString などの組み込みの名前は、記録に無ければ undefined（#/staff-view/constructor で落ちない）', () => {
    const cols: Record<string, string[]> = { s1: ['v1'] };
    expect(own(cols, 's1')).toEqual(['v1']);
    for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(own(cols, k)).toBeUndefined();
    expect(own({ constructor: ['v2'] } as Record<string, string[]>, 'constructor')).toEqual(['v2']);
  });
});
