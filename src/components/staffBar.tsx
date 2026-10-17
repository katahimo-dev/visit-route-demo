// 〈スタッフ〉1人の時間帯ごとの状態の3段バーと凡例（PRD D75・D76）。月の混み具合バーと同じ3段・同じ部品（SlotBar）。
// 色だけに頼らない：訪問は斜線・移動は点々・案なしは縦の線・休みは横の線（模様）、マスごとの title と、まとめた読み上げの文（staffSlotSummary）
import './loadBar.css';
import {
  STAFF_SLOT_LABEL,
  type StaffSlot,
  type StaffSlotState,
  staffSlotSummary,
  staffSlotText,
} from '../lib/staffBar';
import { SlotBar } from './loadBar';

/** 〈スタッフ〉の3段バー。slots が null なら案なし（訪問はあるが数える案が無い） */
export function StaffBar({ slots, testId = 'staff-bar' }: { slots: readonly StaffSlot[] | null; testId?: string }) {
  return (
    <SlotBar
      slots={slots ? slots.map((x) => ({ start: x.start, level: `st-${x.state}`, title: staffSlotText(x) })) : null}
      label={slots ? `時間帯：${staffSlotSummary(slots)}` : ''}
      emptyText={slots ? '' : '案が無いので時間帯の状態を出していません'}
      testId={testId}
    />
  );
}

/** 凡例の説明（休み・空きは何を指すか） */
const LEGEND_TEXT: Record<StaffSlotState, string> = {
  visit: STAFF_SLOT_LABEL.visit,
  travel: STAFF_SLOT_LABEL.travel,
  free: `${STAFF_SLOT_LABEL.free}（勤務内）`,
  noplan: `${STAFF_SLOT_LABEL.noplan}（勤務内。空きか分からない）`,
  rest: `${STAFF_SLOT_LABEL.rest}（欠勤・希望休など）`,
  outside: STAFF_SLOT_LABEL.outside,
};

/** 凡例（色と模様の意味）。states で出す状態を選ぶ（稼働の見込みは訪問・移動・空き＝待ちだけ） */
export function StaffLegend({
  states = ['visit', 'travel', 'free', 'noplan', 'rest', 'outside'],
  labels = LEGEND_TEXT,
}: {
  states?: readonly StaffSlotState[];
  labels?: Partial<Record<StaffSlotState, string>>;
}) {
  return (
    <span className="load-legend" data-testid="staff-legend">
      {states.map((st) => (
        <span key={st} className="load-legend-item">
          <span className={`load-swatch is-st-${st}`} aria-hidden="true" />
          {labels[st] ?? LEGEND_TEXT[st]}
        </span>
      ))}
    </span>
  );
}
