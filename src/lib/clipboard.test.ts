// クリップボードへのコピー（連絡の一覧。PRD D35）：使えないとき・失敗したときの経路
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

/** textarea の代わり（選ぶ・外すを数える） */
function fakeDocument(exec: () => boolean) {
  const area = {
    value: '',
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    select: vi.fn(),
    remove: vi.fn(),
  };
  const doc = {
    createElement: vi.fn(() => area),
    body: { appendChild: vi.fn() },
    execCommand: vi.fn(exec),
  };
  return { area, doc };
}

describe('copyText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('navigator.clipboard で書ければ true（textarea は使わない）', async () => {
    const writeText = vi.fn(async () => {});
    const { doc } = fakeDocument(() => true);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('document', doc);
    expect(await copyText('あ')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('あ');
    expect(doc.createElement).not.toHaveBeenCalled();
  });
  it('clipboard が失敗したら textarea を選んで execCommand。できれば true', async () => {
    const { area, doc } = fakeDocument(() => true);
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) } });
    vi.stubGlobal('document', doc);
    expect(await copyText('連絡文')).toBe(true);
    expect(area.value).toBe('連絡文');
    expect(area.select).toHaveBeenCalled();
    expect(doc.execCommand).toHaveBeenCalledWith('copy');
    expect(area.remove).toHaveBeenCalled();
  });
  it('execCommand も false なら false（textarea は外す）', async () => {
    const { area, doc } = fakeDocument(() => false);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', doc);
    expect(await copyText('x')).toBe(false);
    expect(area.remove).toHaveBeenCalled();
  });
  it('execCommand が例外を投げても false（textarea は外す）', async () => {
    const { area, doc } = fakeDocument(() => {
      throw new Error('not supported');
    });
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', doc);
    expect(await copyText('x')).toBe(false);
    expect(area.remove).toHaveBeenCalled();
  });
});
