import { describe, expect, it } from 'vitest';
import { isDate } from './isDate';

describe('isDate', () => {
  it('実在する日付は true（うるう日も）', () => {
    expect(isDate('2026-10-17')).toBe(true);
    expect(isDate('2028-02-29')).toBe(true);
  });
  it('形が違う・実在しない日付は false（例外も出さない）', () => {
    expect(isDate('')).toBe(false);
    expect(isDate('2026-1-5')).toBe(false);
    expect(isDate('2026-02-30')).toBe(false);
    expect(isDate('2026-13-01')).toBe(false);
    expect(isDate('2027-02-29')).toBe(false);
    expect(isDate('0000-00-00')).toBe(false);
  });
});
