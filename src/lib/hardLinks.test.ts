import { describe, expect, it } from 'vitest';
import { ABSENT_ALL_DAY, AFTER_LAST_DAY } from '../matching';
import { clientPageHref, hardLinks, staffPageHref } from './hardLinks';

const T = { client: '利用者さん', staff: 'スタッフ' };
const na = (label: string) => ({ kind: 'notAllowed' as const, label, staffId: 's1' });
const tos = (label: string) => hardLinks(na(label), 'c1', T).map((x) => x.to);

describe('必須の違反 → 関連の画面（PRD D345）', () => {
  it('時間の約束に間に合わない：リンクなし（訪問を開いて直す）', () => {
    expect(hardLinks({ kind: 'time', label: '時間の約束に間に合わない', staffId: 's1' }, 'c1', T)).toEqual([]);
  });
  it('働ける時間に収まらない（slot）：勤務時間（シフト）', () => {
    expect(hardLinks({ kind: 'slot', label: '働ける時間に収まらない', staffId: 's1' }, 'c1', T)).toEqual([
      { to: '/availability', label: '勤務時間（シフト）' },
    ]);
  });
  it('相性：相性の表', () => {
    expect(tos('相性×')).toEqual(['/compat']);
    expect(tos('相性△')).toEqual(['/compat']);
  });
  it('〈利用者さん〉の条件：その〈利用者さん〉の画面', () => {
    expect(tos('必要条件：資格 = 介護福祉士 ✗')).toEqual([clientPageHref('c1')]);
    expect(tos('担当を限る：山田、佐藤 ✗')).toEqual([clientPageHref('c1')]);
    expect(tos('希望✗ 性別 = 女性')).toEqual([clientPageHref('c1')]);
    expect(tos('いつもの担当でない')).toEqual([clientPageHref('c1')]);
    expect(tos('利用者さんの位置が未登録')).toEqual([clientPageHref('c1')]);
    expect(hardLinks(na('必要条件：資格 ✗'), 'c1', T)[0]?.label).toBe('利用者さんの画面');
  });
  it('〈利用者さん〉が分からなければ〈利用者さん〉の画面は出さない', () => {
    expect(hardLinks(na('必要条件：資格 ✗'), undefined, T)).toEqual([]);
  });
  it('〈スタッフ〉の条件：その人の画面（〈利用者さん〉の画面にしない）', () => {
    expect(tos('スタッフの必要条件：ペット = なし ✗')).toEqual([staffPageHref('s1')]);
    expect(tos('スタッフの希望✗ 地域 = 北')).toEqual([staffPageHref('s1')]);
    expect(tos('スタッフの自宅の位置が未登録')).toEqual([staffPageHref('s1')]);
    expect(tos(AFTER_LAST_DAY)).toEqual([staffPageHref('s1')]);
    expect(hardLinks(na('スタッフの必要条件：x ✗'), 'c1', T)[0]?.label).toBe('スタッフの画面');
  });
  it('呼び方（terms）が変わっても〈スタッフ〉の条件を見分ける', () => {
    const t = { client: 'ご利用者', staff: 'ヘルパー' };
    expect(hardLinks(na('ヘルパーの必要条件：x ✗'), 'c1', t).map((x) => x.to)).toEqual([staffPageHref('s1')]);
  });
  it('種類：訪問の種類', () => {
    expect(tos('種類（入浴）：資格 = 介護福祉士 ✗')).toEqual(['/types']);
  });
  it('休み・欠勤：勤務時間（シフト）', () => {
    expect(tos('休み')).toEqual(['/availability']);
    expect(tos(ABSENT_ALL_DAY)).toEqual(['/availability']);
    // 働ける時間に収まらない人へドラッグしたとき（compile の notAllowed の理由）
    expect(tos('働ける時間に収まらない')).toEqual(['/availability']);
  });
  it('件数の上限：条件の重み', () => {
    expect(tos('件数の上限（5件）を超える')).toEqual(['/rules']);
  });
  it('いくつもの理由（「・」でつないだ label）：重ねずに順に', () => {
    expect(tos('休み・相性×・必要条件：資格 ✗・スタッフの必要条件：x ✗・種類（入浴）：y ✗・相性△')).toEqual([
      '/compat',
      clientPageHref('c1'),
      staffPageHref('s1'),
      '/types',
      '/availability',
    ]);
  });
  it('分からない理由：リンクなし', () => {
    expect(tos('固定（手直し）')).toEqual([]);
    expect(tos('担当できない組み合わせ')).toEqual([]);
  });
  it('ID は URL の形に直す', () => {
    expect(clientPageHref('a b')).toBe('/clients/a%20b');
    expect(staffPageHref('s/1')).toBe('/staff/s%2F1');
  });
});
