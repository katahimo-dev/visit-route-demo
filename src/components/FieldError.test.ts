import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FieldError, invalidAttrs, RequiredMark, toFormErr } from './FieldError';

/** エラー文の id（テストでは決まった値を渡す） */
const props = (id: string) => ({ id });

describe('FieldError（PRD D250）', () => {
  it('文があれば role="alert" と id・.error で出す（既定は p）', () => {
    const html = renderToStaticMarkup(createElement(FieldError, props('e1'), '名前を入れてください'));
    expect(html).toBe('<p id="e1" class="error" role="alert">名前を入れてください</p>');
  });

  it('span・足すクラス・data-testid', () => {
    const html = renderToStaticMarkup(
      createElement(FieldError, { as: 'span', className: 'plan-band', testId: 'x-error' }, 'だめ'),
    );
    expect(html).toBe('<span class="error plan-band" role="alert" data-testid="x-error">だめ</span>');
  });

  it('文が無い（null・false・空）ときは何も出さない', () => {
    for (const c of [null, undefined, false, '']) {
      expect(renderToStaticMarkup(createElement(FieldError, props('e'), c))).toBe('');
    }
  });
});

describe('invalidAttrs', () => {
  it('誤りなら aria-invalid="true" と aria-describedby（エラー文の id）', () => {
    expect(invalidAttrs(true, 'e1')).toEqual({ 'aria-invalid': true, 'aria-describedby': 'e1' });
    const html = renderToStaticMarkup(createElement('input', { ...invalidAttrs(true, 'e1') }));
    expect(html).toBe('<input aria-invalid="true" aria-describedby="e1"/>');
  });

  it('誤りでなければ何も付けない', () => {
    expect(invalidAttrs(false, 'e1')).toEqual({});
  });
});

describe('RequiredMark', () => {
  it('「必須」の札は読み上げない（aria-hidden。必須は入力欄の required で伝える）', () => {
    expect(renderToStaticMarkup(createElement(RequiredMark))).toBe(
      '<span class="req-mark" aria-hidden="true">必須</span>',
    );
  });
});

describe('toFormErr', () => {
  it('契約の検査の誤りは、文と最初の誤りの欄の名前', () => {
    const r = z.object({ durationMinutes: z.number().min(5) }).safeParse({ durationMinutes: 1 });
    expect(r.success).toBe(false);
    const e = toFormErr(r.error);
    expect(e?.field).toBe('durationMinutes');
    expect(e?.text.startsWith('durationMinutes：')).toBe(true);
  });

  it('ふつうの例外は欄なし', () => {
    expect(toFormErr(new Error('こわれた'))).toEqual({ text: 'こわれた', field: undefined });
  });
});
