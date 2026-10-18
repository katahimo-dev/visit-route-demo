import { describe, expect, it } from 'vitest';
import { createInertLock } from './inertLock';

describe('createInertLock', () => {
  it('重なっても最後の解除で元に戻す（閉じる順が逆でも残らない）', () => {
    const root = { inert: false };
    const panel = { inert: false };
    const lock = createInertLock();
    const drawer = lock.lock([root]);
    const dialog = lock.lock([root, panel]);
    // 引き出しを先に閉じても、確認が開いているあいだは inert のまま
    drawer();
    expect([root.inert, panel.inert, lock.count(root)]).toEqual([true, true, 1]);
    dialog();
    expect([root.inert, panel.inert, lock.count(root)]).toEqual([false, false, 0]);
  });
  it('元から inert の要素は戻しても inert。解除を2回呼んでも1回だけ数える', () => {
    const a = { inert: true };
    const lock = createInertLock();
    const x = lock.lock([a, a]);
    const y = lock.lock([a]);
    x();
    x();
    expect([a.inert, lock.count(a)]).toEqual([true, 1]);
    y();
    expect([a.inert, lock.count(a)]).toEqual([true, 0]);
  });
});
