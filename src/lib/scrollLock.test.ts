import { describe, expect, it } from 'vitest';
import { createScrollLock } from './scrollLock';

describe('createScrollLock', () => {
  it('最後の解除で元に戻す（重なっても途中で戻さない）', () => {
    const html = { overflow: '' };
    const body = { overflow: 'auto' };
    const lock = createScrollLock(() => [html, body]);
    const a = lock.lock();
    expect([html.overflow, body.overflow]).toEqual(['hidden', 'hidden']);
    const b = lock.lock();
    a();
    expect([html.overflow, body.overflow, lock.count()]).toEqual(['hidden', 'hidden', 1]);
    b();
    expect([html.overflow, body.overflow, lock.count()]).toEqual(['', 'auto', 0]);
  });
  it('解除を2回呼んでも1回だけ数える。逆の順に閉じても戻る', () => {
    const body = { overflow: '' };
    const lock = createScrollLock(() => [body]);
    const a = lock.lock();
    const b = lock.lock();
    b();
    b();
    expect([body.overflow, lock.count()]).toEqual(['hidden', 1]);
    a();
    expect([body.overflow, lock.count()]).toEqual(['', 0]);
  });
});
