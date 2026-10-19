// 控えのファイル名と、例外の画面で書き出したあとの文
import { describe, expect, it } from 'vitest';
import { backupFileName, backupNote } from './download';

describe('backupFileName', () => {
  it('いまのデータはデータの画面と同じ名前、壊れたデータは -broken を付ける', () => {
    expect(backupFileName('2026-10-21')).toBe('visit-route-demo-2026-10-21.json');
    expect(backupFileName('2026-10-21', 'broken')).toBe('visit-route-demo-2026-10-21-broken.json');
  });
});

describe('backupNote', () => {
  it('保存できていれば「書き出しました」', () => {
    expect(backupNote({ source: 'memory', saveError: null, brokenName: null })).toBe('書き出しました');
    expect(backupNote({ source: 'storage', saveError: null, brokenName: null })).toBe('書き出しました');
  });
  it('保存に失敗していたら区別して理由を添える（画面の最新か、最後に保存できた状態か）', () => {
    expect(backupNote({ source: 'memory', saveError: '容量', brokenName: null })).toBe(
      '保存に失敗していましたが、画面で使っていた最新の状態を書き出しました（容量）',
    );
    expect(backupNote({ source: 'storage', saveError: '容量', brokenName: null })).toBe(
      '保存に失敗していたため、最後に保存できた状態を書き出しました（容量）',
    );
  });
  it('壊れて退避したデータも書き出したら、そのファイル名を添える', () => {
    const note = backupNote({ source: 'memory', saveError: null, brokenName: 'x-broken.json' });
    expect(note).toMatch(/^書き出しました。壊れて読めなかったデータも別のファイル（x-broken\.json）/);
    expect(backupNote({ source: null, saveError: null, brokenName: 'x-broken.json' })).toBe(
      '壊れて読めなかったデータを x-broken.json に書き出しました',
    );
  });
  it('何も無ければ書き出せない', () => {
    expect(backupNote({ source: null, saveError: null, brokenName: null })).toMatch(/^書き出せるデータがありません/);
  });
});
