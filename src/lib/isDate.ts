// 実在する日付（YYYY-MM-DD）か確かめる。URL の ?d= のような外から来る文字に使う。
import { addDays } from '../domain/time';

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** 形が YYYY-MM-DD で、実在する日付か（2026-02-30・2026-13-01 は false） */
export function isDate(value: string): boolean {
  if (!DATE_SHAPE.test(value)) return false;
  try {
    return addDays(value, 0) === value;
  } catch {
    return false;
  }
}
