import { describe, expect, it } from 'vitest';
import { nameTaken, optionNameError, own } from './common';

describe('own（自分のキーだけを引く）', () => {
  it('constructor・toString などの組み込みの名前は、記録に無ければ undefined（#/staff-view/constructor で落ちない）', () => {
    const cols: Record<string, string[]> = { s1: ['v1'] };
    expect(own(cols, 's1')).toEqual(['v1']);
    for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(own(cols, k)).toBeUndefined();
    expect(own({ constructor: ['v2'] } as Record<string, string[]>, 'constructor')).toEqual(['v2']);
  });
});

describe('optionNameError（Excel の区切り・空の印と区別できない選択肢の名前）', () => {
  it('「、」・改行・「（なし）」は使えない。「・」「,」はよい', () => {
    expect(optionNameError('洗濯、掃除')).not.toBeNull();
    expect(optionNameError('洗濯\n掃除')).not.toBeNull();
    expect(optionNameError('（なし）')).not.toBeNull();
    expect(optionNameError('(なし)')).not.toBeNull();
    expect(optionNameError('洗濯・掃除')).toBeNull();
    expect(optionNameError('A,B')).toBeNull();
    expect(optionNameError('なし')).toBeNull();
  });
});

describe('nameTaken（同じ名前がほかにあるか）', () => {
  it('自分は除き、前後の空白は無視する', () => {
    const xs = [
      { id: 'a', name: '花子' },
      { id: 'b', name: '太郎' },
    ];
    expect(nameTaken(xs, (x) => x.name, ' 花子 ', 'b')).toBe(true);
    expect(nameTaken(xs, (x) => x.name, '花子', 'a')).toBe(false);
    expect(nameTaken(xs, (x) => x.name, '次郎')).toBe(false);
  });
});
