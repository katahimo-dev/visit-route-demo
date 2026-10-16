// 初期の訪問の種類と定期パターン（ADR-0012。design.md §4 seed）。
// 利用者さんごとに定期パターン1つ（ID は利用者さんの ID と同じ）＋高齢の利用者さん2人のリハビリ。
// 訪問は patterns の applyPatterns で展開する（ID は `${日付}_${パターンID}`）
import type { Pattern, VisitType } from '../contracts/documents';
import { restWeekdayOf } from './generate';
import { CLIENT_SEEDS, ITEM_ID } from './people';

export const VISIT_TYPE_ID = { care: 'care', rehab: 'rehab' } as const;

/** 初期の種類：介護（介護福祉士・初任者研修・看護師のどれか）とリハビリ（理学療法士・作業療法士・言語聴覚士のどれか） */
export const INITIAL_VISIT_TYPES: VisitType[] = [
  {
    id: VISIT_TYPE_ID.care,
    name: '介護',
    color: 0,
    durationMinutes: 60,
    requirements: [{ itemId: ITEM_ID.qualification, op: 'hasAny', value: ['介護福祉士', '初任者研修', '看護師'] }],
    note: '',
  },
  {
    id: VISIT_TYPE_ID.rehab,
    name: 'リハビリ',
    color: 3,
    durationMinutes: 40,
    requirements: [{ itemId: ITEM_ID.qualification, op: 'hasAny', value: ['理学療法士', '作業療法士', '言語聴覚士'] }],
    note: '',
  },
];

/**
 * 高齢の利用者さん2人の週1回・40分のリハビリ（いつもの訪問と時間が重ならない曜日・時刻。
 * 理学療法士の s4・s7 がどちらも働く曜日・時間帯）
 */
export const REHAB_SEEDS: { clientId: string; weekday: number; start: string }[] = [
  // 天文台 ほしみ：いつもは 10:00〜10:45。水曜の午後
  { clientId: 'c7', weekday: 3, start: '14:00' },
  // 城跡 ほまれ（階段が多い家）：いつもは 9:00〜9:45。金曜の午後
  { clientId: 'c14', weekday: 5, start: '15:00' },
];
const REHAB_MINUTES = 40;

/** リハビリのパターンの ID */
export const rehabPatternId = (clientId: string) => `${clientId}-rehab`;

const WEEKDAYS = [1, 2, 3, 4, 5];

/**
 * 初期の定期パターン（from から、終了日なし、いつもの担当なし）。
 * 利用者さんのパターン（CLIENT_SEEDS の順）のあとにリハビリのパターン
 */
export function seedPatterns(from: string): Pattern[] {
  const base = {
    everyWeeks: 1,
    from,
    to: null,
    usualStaffId: null,
    note: '',
  };
  const clients: Pattern[] = CLIENT_SEEDS.map((c, i) => {
    const [windowKind, earliestStart, latestStart, durationMinutes] = c.slot;
    const rest = restWeekdayOf(i);
    return {
      ...base,
      id: c.id,
      clientId: c.id,
      // 対象が子どもの利用者さんは種類なし（担当できる人を変えない）
      typeId: c.target === '子ども' ? null : VISIT_TYPE_ID.care,
      weekdays: [...(c.weekend ? [0] : []), ...WEEKDAYS.filter((d) => d !== rest), ...(c.weekend ? [6] : [])],
      windowKind,
      earliestStart,
      latestStart,
      durationMinutes,
    };
  });
  const rehab: Pattern[] = REHAB_SEEDS.map((r) => ({
    ...base,
    id: rehabPatternId(r.clientId),
    clientId: r.clientId,
    typeId: VISIT_TYPE_ID.rehab,
    weekdays: [r.weekday],
    windowKind: 'fixed',
    earliestStart: r.start,
    latestStart: r.start,
    durationMinutes: REHAB_MINUTES,
  }));
  return [...clients, ...rehab];
}
