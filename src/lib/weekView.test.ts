import { describe, expect, it } from 'vitest';
import { isTimeline, WEEK_VIEWS, weekViewLabel, weekViewOf, weekViewParams } from './weekView';

const terms = { staff: 'スタッフ', client: '利用者さん' };

describe('weekView', () => {
  it('古い URL の組み合わせ（view × by の6通りと値なし）を今までと同じ表示に読む', () => {
    expect(weekViewOf(null, null)).toBe('timeline-staff');
    expect(weekViewOf(null, 'client')).toBe('timeline-client');
    expect(weekViewOf('timeline', null)).toBe('timeline-staff');
    expect(weekViewOf('timeline', 'staff')).toBe('timeline-staff');
    expect(weekViewOf('timeline', 'client')).toBe('timeline-client');
    // 表では見る人は効かない（今まで by は時間軸のときだけ見ていた）
    expect(weekViewOf('table', null)).toBe('table');
    expect(weekViewOf('table', 'client')).toBe('table');
    expect(weekViewOf('clients', null)).toBe('clients');
    expect(weekViewOf('clients', 'client')).toBe('clients');
    // 知らない値は時間軸（今までと同じ）
    expect(weekViewOf('xyz', 'client')).toBe('timeline-client');
    expect(weekViewOf('xyz', 'other')).toBe('timeline-staff');
  });
  it('書いたクエリを読み直すと同じ表示（4つとも）', () => {
    for (const v of WEEK_VIEWS) {
      const p = weekViewParams(v);
      expect(weekViewOf(p.view, p.by)).toBe(v);
    }
  });
  it('時間軸は ?view= を書かず、表へ移るときは ?by= を消す', () => {
    expect(weekViewParams('timeline-staff')).toEqual({ view: null, by: null });
    expect(weekViewParams('timeline-client')).toEqual({ view: null, by: 'client' });
    expect(weekViewParams('table')).toEqual({ view: 'table', by: null });
    expect(weekViewParams('clients')).toEqual({ view: 'clients', by: null });
  });
  it('名前は呼び方から作り、4つとも違う', () => {
    const labels = WEEK_VIEWS.map((v) => weekViewLabel(v, terms));
    expect(labels).toEqual(['時間軸：スタッフ', '時間軸：利用者さん', 'スタッフ×曜日', '利用者さん×曜日']);
    expect(new Set(labels).size).toBe(4);
    expect(weekViewLabel('timeline-client', { staff: 'シッター', client: 'お客様' })).toBe('時間軸：お客様');
  });
  it('狭い画面で ?view=・?by= が無ければ〈スタッフ〉×曜日の表（PRD D222）。どちらかあれば今までどおり', () => {
    expect(weekViewOf(null, null, true)).toBe('table');
    expect(weekViewOf('timeline', null, true)).toBe('timeline-staff');
    expect(weekViewOf(null, 'client', true)).toBe('timeline-client');
    expect(weekViewOf(null, 'staff', true)).toBe('timeline-staff');
    expect(weekViewOf('clients', null, true)).toBe('clients');
    expect(weekViewOf(null, null, false)).toBe('timeline-staff');
  });
  it('狭い画面で押したときは時間軸：〈スタッフ〉も ?view=timeline を書き、読み直すと同じ表示', () => {
    expect(weekViewParams('timeline-staff', true)).toEqual({ view: 'timeline', by: null });
    expect(weekViewParams('timeline-client', true)).toEqual({ view: null, by: 'client' });
    for (const v of WEEK_VIEWS) {
      const p = weekViewParams(v, true);
      expect(weekViewOf(p.view, p.by, true)).toBe(v);
      // 狭い画面で書いた URL は広い画面でも同じ表示
      expect(weekViewOf(p.view, p.by, false)).toBe(v);
    }
  });
  it('時間軸かどうか', () => {
    expect(WEEK_VIEWS.filter(isTimeline)).toEqual(['timeline-staff', 'timeline-client']);
  });
});
