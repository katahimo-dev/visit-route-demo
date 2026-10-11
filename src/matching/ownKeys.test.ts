import { describe, expect, it } from 'vitest';
import { score } from '../evaluate';
import { client, DATE, makeData, staff, visit } from './fixtures';
import { bestInsertion, compile } from './index';

/**
 * スタッフID が Object の組み込みの名前（constructor など）でも、routes に列が無いときに
 * 組み込みの関数を列と取り違えて落ちない（読み込んだデータの ID は利用者が書き換えられる）
 */
describe('Object の組み込みの名前の ID', () => {
  const data = () =>
    makeData({
      staff: [staff('constructor', 38.26, 140.87), staff('toString', 38.29, 140.9)],
      clients: [client('c1', 38.27, 140.88)],
      visits: [visit('v1', 'c1', '09:00', '10:00')],
    });
  it('score：列の無いスタッフは訪問なし', () => {
    const p = compile(data(), DATE);
    const s = score(p, {});
    expect(s.dropped).toBe(1);
  });
  it('bestInsertion：列の無いスタッフへ移せる', () => {
    const p = compile(data(), DATE);
    expect(bestInsertion(p, {}, 'v1', 'constructor')).toEqual({ constructor: ['v1'] });
  });
});
