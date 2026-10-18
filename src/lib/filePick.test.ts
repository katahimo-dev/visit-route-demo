import { describe, expect, it } from 'vitest';
import { FILE_PICK_LABEL, fileNameText } from './filePick';

describe('fileNameText', () => {
  it('まだ選んでいなければ未選択の文', () => {
    expect(fileNameText(null)).toBe('ファイルを選んでいません');
    expect(fileNameText(undefined)).toBe('ファイルを選んでいません');
    expect(fileNameText('  ')).toBe('ファイルを選んでいません');
  });
  it('選んだらファイル名', () => {
    expect(fileNameText('visit-route-demo-2026-10-18.json')).toBe('選んだファイル：visit-route-demo-2026-10-18.json');
    expect(fileNameText(' 名簿.xlsx ')).toBe('選んだファイル：名簿.xlsx');
  });
  it('ボタンは日本語', () => {
    expect(FILE_PICK_LABEL).toBe('ファイルを選ぶ');
  });
});
