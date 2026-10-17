// 〈スタッフ〉1人の時間帯ごとの状態の3段バーと凡例（PRD D75・D76・D85）。月の混み具合バーと同じ3段・同じ部品（SlotBar）。
// 埋まっている訪問・移動だけ濃い無地、ほかは淡く（色の言葉は components/barMarks.css）。色だけに頼らない：移動は高さ半分、
// 空きは細い枠・案なしは破線の枠、3段とも休みの日は「休み」の文字を重ねる。30分ごとの title と、まとめた読み上げの文（staffSlotSummary）
import './barMarks.css';
import './loadBar.css';
import { inBar } from '../lib/barRows';
import {
  isAllRest,
  STAFF_SLOT_LABEL,
  type StaffSlot,
  type StaffSlotState,
  staffEdgeTexts,
  staffSlotSummary,
  staffSlotText,
} from '../lib/staffBar';
import { BarSwatch, SlotBar } from './loadBar';

/**
 * 〈スタッフ〉の3段バー（案の無い日は勤務内が「案なし」の状態で来る。8時より前・20時以降は端の印。PRD D82）。
 * 3段（8〜20時）が全部休みの日は、3段の上に1枚の「休み」を重ねる（PRD D85）
 */
export function StaffBar({ slots, testId = 'staff-bar' }: { slots: readonly StaffSlot[]; testId?: string }) {
  const shown = inBar(slots);
  return (
    <SlotBar
      slots={slots.map((x) => ({ start: x.start, level: `st-${x.state}`, title: staffSlotText(x) }))}
      label={`時間帯：${staffSlotSummary(shown)}`}
      emptyText=""
      testId={testId}
      edges={staffEdgeTexts(slots)}
      cover={isAllRest(slots) ? STAFF_SLOT_LABEL.rest : undefined}
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

/** 凡例（色と形の意味。見本は段と同じ塗り）。states で出す状態を選ぶ（稼働の見込みは訪問・移動・空き＝待ちだけ） */
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
          <BarSwatch level={`st-${st}`} />
          {labels[st] ?? LEGEND_TEXT[st]}
        </span>
      ))}
    </span>
  );
}
