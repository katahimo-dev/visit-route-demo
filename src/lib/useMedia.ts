// メディアクエリが合っているかを追うフック（幅を変えたら追う）。
// 狭い画面の既定（月の日ごとの一覧・週の表・〈利用者さん〉の絞り込みを畳む。PRD D189・D220〜D222）で使う
import { useEffect, useState } from 'react';
import { MONTH_LIST_QUERY } from './monthList';

/**
 * 一覧の表をカードにする・既定の見せ方を変える幅（styles.css の @media (max-width: 600px) と同じ。
 * 月の日ごとの一覧の既定 MONTH_LIST_QUERY と同じ値）
 */
export const COMPACT_QUERY = MONTH_LIST_QUERY;

/** メディアクエリが合っているか（matchMedia の無い所では false） */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const onChange = () => setOn(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return on;
}
