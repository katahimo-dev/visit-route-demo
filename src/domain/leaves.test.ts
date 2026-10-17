import { describe, expect, it } from 'vitest';
import type { ClientLeave } from '../contracts/documents';
import { isOnLeave, leaveOn } from './leaves';

const leaves: ClientLeave[] = [
  { id: 'l1', clientId: 'c1', from: '2026-10-20', to: '2026-10-22', note: '入院' },
  { id: 'l2', clientId: 'c2', from: '2026-10-25', to: '2026-10-25', note: '' },
];

describe('leaveOn・isOnLeave（ADR-0013）', () => {
  it('開始日・終了日の当日は休み、前日・翌日は休みでない', () => {
    expect(leaveOn(leaves, 'c1', '2026-10-20')?.id).toBe('l1');
    expect(leaveOn(leaves, 'c1', '2026-10-22')?.id).toBe('l1');
    expect(leaveOn(leaves, 'c1', '2026-10-19')).toBeNull();
    expect(leaveOn(leaves, 'c1', '2026-10-23')).toBeNull();
  });
  it('別の〈利用者さん〉の休みは見ない。1日だけの休み', () => {
    expect(leaveOn(leaves, 'c2', '2026-10-21')).toBeNull();
    expect(isOnLeave(leaves, { clientId: 'c2', date: '2026-10-25' })).toBe(true);
    expect(isOnLeave(leaves, { clientId: 'c3', date: '2026-10-25' })).toBe(false);
    expect(isOnLeave([], { clientId: 'c1', date: '2026-10-21' })).toBe(false);
  });
});
