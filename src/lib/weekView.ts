// 週の画面の表示の切り替え（PRD D188。ADR-0025 追記。UI/UX 改善の区切り8a）。
// 今までの「表示（時間軸／〈スタッフ〉×曜日／〈利用者さん〉×曜日）」と「見る人（〈スタッフ〉で見る／〈利用者さん〉で見る）」の
// 2つの切り替えは、見る人が時間軸のときだけ効くので、意味のある組み合わせは4つ。これを1つの切り替えにする。
// URL は今までのクエリ（?view=・?by=）のまま読み書きする（古い URL で開いても同じ表示）。
// 狭い画面（600px 以下）で ?view=・?by= が無ければ〈スタッフ〉×曜日の表（PRD D222。URL には書かない）
import type { Terms } from '../contracts/documents';

export type WeekView = 'timeline-staff' | 'timeline-client' | 'table' | 'clients';

/** 切り替えの並び */
export const WEEK_VIEWS: readonly WeekView[] = ['timeline-staff', 'timeline-client', 'table', 'clients'];

/**
 * URL の ?view= と ?by= から表示を決める（今までと同じ読み方）：view が table・clients ならその表（by は見ない）、
 * それ以外（無い・timeline・知らない値）は時間軸で、by=client なら〈利用者さん〉、ほかは〈スタッフ〉。
 * ただし narrow（狭い画面）で view も by も無ければ〈スタッフ〉×曜日の表（PRD D222。時間軸の7列が入らないため）
 */
export function weekViewOf(view: string | null, by: string | null, narrow = false): WeekView {
  if (narrow && view === null && by === null) return 'table';
  if (view === 'table') return 'table';
  if (view === 'clients') return 'clients';
  return by === 'client' ? 'timeline-client' : 'timeline-staff';
}

/**
 * その表示へ移るときに書く ?view= と ?by=（null＝消す）。時間軸は ?view= を書かない（既定）。ただし narrow（狭い画面）の
 * 時間軸：〈スタッフ〉は既定（表）と分けるため ?view=timeline を書く（押したら必ず書く。月の ?layout= と同じ）。
 * 表へ移るときは ?by= を消す（表では効かないので、残すと URL だけ見て分からなくなる）。?staff=・?client=・?cf= は触らない
 */
export function weekViewParams(v: WeekView, narrow = false): { view: string | null; by: string | null } {
  switch (v) {
    case 'timeline-staff':
      return { view: narrow ? 'timeline' : null, by: null };
    case 'timeline-client':
      return { view: null, by: 'client' };
    case 'table':
      return { view: 'table', by: null };
    case 'clients':
      return { view: 'clients', by: null };
  }
}

/** 切り替えのボタンの名前（呼び方は org.terms から） */
export function weekViewLabel(v: WeekView, terms: Terms): string {
  switch (v) {
    case 'timeline-staff':
      return `時間軸：${terms.staff}`;
    case 'timeline-client':
      return `時間軸：${terms.client}`;
    case 'table':
      return `${terms.staff}×曜日`;
    case 'clients':
      return `${terms.client}×曜日`;
  }
}

/** 時間軸か（見る人の切り替え・凡例・チップを出すか） */
export const isTimeline = (v: WeekView): boolean => v === 'timeline-staff' || v === 'timeline-client';
