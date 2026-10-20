import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FieldError, focusFirstInvalid, invalidAttrs, RequiredMark, toFormErr } from './FieldError';

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

  it('live={false}（打つたびに検査する欄）は role を付けない', () => {
    const html = renderToStaticMarkup(createElement(FieldError, { ...props('e2'), live: false }, '重なっています'));
    expect(html).toBe('<p id="e2" class="error">重なっています</p>');
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

describe('focusFirstInvalid', () => {
  /** querySelectorAll だけを持つ偽の入れ物（DOM なしで並びを決める） */
  const el = (attrs: Record<string, string>) => {
    const focused = { on: false };
    return {
      attrs,
      focused,
      id: attrs.id ?? '',
      getAttribute: (k: string) => attrs[k] ?? null,
      focus: () => {
        focused.on = true;
      },
    };
  };
  const rootOf = (invalid: ReturnType<typeof el>[], alerts: ReturnType<typeof el>[]) =>
    ({
      querySelectorAll: (sel: string) => (sel.includes('aria-invalid') ? invalid : alerts),
    }) as unknown as ParentNode;

  it('保存を止めた誤り（alert の文）を指す欄を、打つたびに検査する欄より先にする', () => {
    const postal = el({ 'aria-describedby': 'p-err' });
    const name = el({ 'aria-describedby': 'save-err' });
    expect(focusFirstInvalid(rootOf([postal, name], [el({ id: 'save-err' })]))).toBe(true);
    expect([postal.focused.on, name.focused.on]).toEqual([false, true]);
  });

  it('alert を指す欄が無ければ最初の誤った欄。誤った欄が無ければ false', () => {
    const a = el({});
    const b = el({});
    expect(focusFirstInvalid(rootOf([a, b], []))).toBe(true);
    expect([a.focused.on, b.focused.on]).toEqual([true, false]);
    expect(focusFirstInvalid(rootOf([], []))).toBe(false);
  });
});
