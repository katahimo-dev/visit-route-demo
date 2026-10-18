// 住所の入力の部品の決まり（PRD D86〜D88・D90・D118〜D121。ADR-0016）。外部は呼ばない
import { describe, expect, it } from 'vitest';
import type { ClientPlace } from '../contracts/documents';
import {
  addressBlockReason,
  applyFoundAddress,
  busyStatus,
  canUndoAddress,
  failStatus,
  geoCandidates,
  nextUndoAddress,
  pinStatus,
  postalBlockReason,
  postalCandidates,
  postalInputError,
  statusClass,
  toPlace,
} from './addressLookup';

describe('押せない理由', () => {
  it('「住所を探す」：探している・空・7桁でない。7桁にできれば押せる', () => {
    expect(postalBlockReason('980-0811', 'address')).toBe('探しています');
    expect(postalBlockReason('', null)).toBe('郵便番号を入れてください');
    expect(postalBlockReason('  ', null)).toBe('郵便番号を入れてください');
    expect(postalBlockReason('980-081', null)).toBe('郵便番号は7桁の数字で入れてください');
    expect(postalBlockReason('〒９８０－０８１１', null)).toBeNull();
  });
  it('「地図に置く」：探している・住所が空', () => {
    expect(addressBlockReason('仙台市', 'postal')).toBe('探しています');
    expect(addressBlockReason(' ', null)).toBe('住所を入れてください');
    expect(addressBlockReason('仙台市', null)).toBeNull();
  });
  it('郵便番号の欄のエラーは、空でなく7桁にできないときだけ', () => {
    expect(postalInputError('')).toBe(false);
    expect(postalInputError('980-0811')).toBe(false);
    expect(postalInputError('980-08')).toBe(true);
  });
});

describe('applyFoundAddress（見つけた住所の当て方）', () => {
  it('いまの住所が見つけた住所で始まるならそのまま（番地を消さない）', () => {
    const r = applyFoundAddress(' 宮城県仙台市青葉区一番町1-2', '宮城県仙台市青葉区一番町');
    expect(r.replace).toBe(false);
    expect(r.status).toEqual({
      kind: 'ok',
      text: '住所は「宮城県仙台市青葉区一番町」で始まっているので、そのままにしました',
    });
  });
  it('違う住所・空なら置き換える', () => {
    const r = applyFoundAddress('東京都', '宮城県仙台市青葉区一番町');
    expect(r).toEqual({
      replace: true,
      address: '宮城県仙台市青葉区一番町',
      status: { kind: 'ok', text: '住所に「宮城県仙台市青葉区一番町」を入れました。番地を続けて書いてください' },
    });
    expect(applyFoundAddress('', '宮城県').replace).toBe(true);
  });
  it('「元に戻す」の先は最初の住所を残し、空なら出さない', () => {
    expect(nextUndoAddress(null, '東京都')).toBe('東京都');
    expect(nextUndoAddress('東京都', '宮城県')).toBe('東京都');
    expect(nextUndoAddress('', '宮城県')).toBe('');
    expect(canUndoAddress(null)).toBe(false);
    expect(canUndoAddress(' ')).toBe(false);
    expect(canUndoAddress('東京都')).toBe(true);
  });
});

describe('状態の知らせ', () => {
  it('探している・失敗・ピン', () => {
    expect(busyStatus('postal')).toEqual({ kind: 'busy', text: '住所を探しています…' });
    expect(busyStatus('address')).toEqual({ kind: 'busy', text: '位置を探しています…' });
    expect(failStatus('notFound', 'postal')).toEqual({
      kind: 'error',
      text: '見つかりませんでした。郵便番号を確かめてください',
    });
    expect(pinStatus({ title: '一番町', lat: 38, lng: 140 })?.text).toBe(
      '地図に置きました（一番町）。ずれていれば「位置を消す」を押してから地図をクリックしてください',
    );
    expect(pinStatus({ title: '', lat: 38, lng: 140 })?.text?.startsWith('地図に置きました。')).toBe(true);
  });
  it('見た目の class', () => {
    expect(statusClass(null)).toBe('place-status');
    expect(statusClass(busyStatus('postal'))).toBe('place-status');
    expect(statusClass(failStatus('timeout', 'address'))).toBe('place-status is-error');
    expect(statusClass(pinStatus({ title: '', lat: 1, lng: 2 }))).toBe('place-status is-ok');
  });
});

describe('候補', () => {
  it('郵便番号：いまの住所がその住所で始まるものを選んでいる扱い', () => {
    const items = postalCandidates([{ address: '県市A町' }, { address: '県市B町' }], '県市B町1-1');
    expect(items).toEqual([
      { key: '県市A町', text: '県市A町', on: false },
      { key: '県市B町', text: '県市B町', on: true },
    ]);
  });
  it('住所：いまの位置と同じものを選んでいる扱い。名前が無ければ緯度・経度', () => {
    const items = geoCandidates(
      [
        { title: '一番町', lat: 38.26, lng: 140.87 },
        { title: '', lat: 38.123456, lng: 140.654321 },
      ],
      { address: '', lat: 38.26, lng: 140.87 },
    );
    expect(items.map((i) => [i.text, i.on])).toEqual([
      ['一番町', true],
      ['38.1235, 140.6543', false],
    ]);
  });
});

describe('toPlace', () => {
  it('郵便番号を落として住所・位置だけにする', () => {
    const p: ClientPlace = { address: 'a', lat: 1, lng: 2, postalCode: '9800811' };
    expect(toPlace(p)).toEqual({ address: 'a', lat: 1, lng: 2 });
  });
});
