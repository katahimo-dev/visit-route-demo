// スマホ（600px 以下）の日ごとのリスト（PRD D334。ADR-0055）：その日の訪問を時刻の順に1行ずつ
// （時刻・〈利用者さん〉・担当の印と名前・印（要対応・未連絡の変更・ピン））。行を押すと訪問の詳細の欄（下から出る欄）。
// 左右にスワイプすると前・次の日。行を長押しするか「選ぶ」で複数選択（選んでいる間は押すと選ぶ・外す）
import { CheckSquare, MessageSquareText, Pin, Square, TriangleAlert } from 'lucide-react';
import { type PointerEvent as ReactPointerEvent, useRef } from 'react';
import type { Staff } from '../contracts/documents';
import { StaffMark } from './StaffMark';
import { WithIcon } from './ui';
import './dayList.css';

/** リストの1行 */
export type DayListRow = {
  visitId: string;
  /** 「9:00〜10:00」 */
  time: string;
  clientName: string;
  /** 担当（担当なしは null） */
  staff: Staff | null;
  /** 担当の名前（データから消えた人も文字で） */
  staffName: string;
  /** 要対応の中身（無ければ空） */
  issues: readonly string[];
  /** 未連絡の変更の中身（無ければ null） */
  told: string | null;
  pinned: boolean;
  /** 取り消し（null は取り消していない） */
  cancelled: 'normal' | 'sameDay' | null;
  /** 〈利用者さん〉の休みのため無し（休みの理由。休みでなければ null） */
  leave: string | null;
  /** 種類の色（左の線） */
  color: string | null;
  /** 選べる（今日より前・取り消し・休みは選ばない） */
  selectable: boolean;
};

/** 長押しとみなす時間（ms） */
export const LONG_PRESS_MS = 500;
/** スワイプとみなす横の動き（px）と、縦の動きの上限（px） */
const SWIPE_X = 60;
const SWIPE_Y = 40;
/** 押したあと、これより動けば押したことにしない（px） */
const MOVE_SLOP = 10;

export function DayList({
  dateLabel,
  rows,
  onOpen,
  selecting,
  onSelecting,
  isSelected,
  onToggle,
  onPrev,
  onNext,
}: {
  /** 「10/23（金）」 */
  dateLabel: string;
  rows: readonly DayListRow[];
  onOpen: (visitId: string) => void;
  /** 選ぶ形か（「選ぶ」を押した・長押しした） */
  selecting: boolean;
  onSelecting: (on: boolean) => void;
  isSelected: (visitId: string) => boolean;
  onToggle: (visitId: string) => void;
  /** 前・次の日（その日が無ければ null。スワイプ） */
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
}) {
  /** 押し始め（長押し・スワイプ・押したことにしないの判定） */
  const press = useRef<{
    x: number;
    y: number;
    id: string | null;
    timer: ReturnType<typeof setTimeout> | null;
    long: boolean;
    moved: boolean;
  } | null>(null);
  const clearTimer = () => {
    const p = press.current;
    if (p?.timer) clearTimeout(p.timer);
    if (p) p.timer = null;
  };
  const onDown = (e: ReactPointerEvent, row: DayListRow | null) => {
    if (e.button !== 0) return;
    clearTimer();
    const p = {
      x: e.clientX,
      y: e.clientY,
      id: row?.visitId ?? null,
      timer: null,
      long: false,
      moved: false,
    } as NonNullable<typeof press.current>;
    if (row?.selectable) {
      p.timer = setTimeout(() => {
        p.timer = null;
        p.long = true;
        onSelecting(true);
        onToggle(row.visitId);
      }, LONG_PRESS_MS);
    }
    press.current = p;
  };
  const onMove = (e: ReactPointerEvent) => {
    const p = press.current;
    if (!p) return;
    if (Math.abs(e.clientX - p.x) > MOVE_SLOP || Math.abs(e.clientY - p.y) > MOVE_SLOP) {
      p.moved = true;
      clearTimer();
    }
  };
  const onUp = (e: ReactPointerEvent) => {
    const p = press.current;
    clearTimer();
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (Math.abs(dx) >= SWIPE_X && Math.abs(dy) <= SWIPE_Y) {
      p.moved = true;
      if (dx < 0) onNext?.();
      else onPrev?.();
    }
  };
  /** 行を押した（長押し・スワイプのあとの click は捨てる） */
  const onRowClick = (row: DayListRow) => {
    const p = press.current;
    press.current = null;
    if (p && p.id === row.visitId && (p.long || p.moved)) return;
    if (selecting) {
      if (row.selectable) onToggle(row.visitId);
      return;
    }
    onOpen(row.visitId);
  };
  const count = rows.filter((r) => !r.cancelled && !r.leave).length;
  return (
    <section
      className={`day-list card${selecting ? ' is-selecting' : ''}`}
      aria-label={`${dateLabel}の訪問`}
      data-testid="day-list"
      onPointerDown={(e) => {
        if (!(e.target as HTMLElement).closest('.day-row')) onDown(e, null);
      }}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={clearTimer}
    >
      <div className="day-list-head">
        <strong>
          訪問 <span data-testid="day-list-count">{count}</span>件
        </strong>
        <span className="sub day-list-swipe">左右にスワイプで日を送る</span>
        <button
          type="button"
          className={`btn btn-small${selecting ? ' is-on' : ''}`}
          aria-pressed={selecting}
          onClick={() => onSelecting(!selecting)}
          data-testid="day-list-select"
          disabled={!rows.some((r) => r.selectable)}
        >
          <WithIcon icon={selecting ? CheckSquare : Square} size={14}>
            {selecting ? '選び終える' : '選ぶ'}
          </WithIcon>
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="sub day-list-empty">この日の訪問はありません。</p>
      ) : (
        <ul className="day-rows">
          {rows.map((r) => {
            const on = selecting && isSelected(r.visitId);
            const issue = r.issues.length > 0;
            const state = r.cancelled
              ? r.cancelled === 'sameDay'
                ? '当日キャンセル'
                : '取り消し'
              : r.leave !== null
                ? '休みのため無し'
                : null;
            const label = [
              r.time,
              `${r.clientName}さん`,
              r.staff || r.staffName ? `担当 ${r.staffName}` : '担当なし',
              state,
              issue ? `要対応：${r.issues.join('・')}` : null,
              r.told ? `未連絡の変更：${r.told}` : null,
              r.pinned ? 'ピン' : null,
              selecting ? (on ? '選択中' : '選んでいない') : null,
            ]
              .filter(Boolean)
              .join('・');
            return (
              <li key={r.visitId}>
                <button
                  type="button"
                  className={[
                    'day-row',
                    issue ? 'is-issue' : '',
                    r.staffName === '' ? 'is-unassigned' : '',
                    state ? 'is-off' : '',
                    on ? 'is-multi' : '',
                  ].join(' ')}
                  style={r.color ? { borderLeftColor: r.color } : undefined}
                  aria-label={label}
                  aria-pressed={selecting ? on : undefined}
                  onPointerDown={(e) => onDown(e, r)}
                  onClick={() => onRowClick(r)}
                  onContextMenu={(e) => {
                    // 長押しで出るブラウザのメニューを出さない（長押しは複数選択）
                    if (r.selectable) e.preventDefault();
                  }}
                  data-testid="day-row"
                  data-visit={r.visitId}
                  data-selected={on || undefined}
                >
                  {selecting && (
                    <span className="day-row-check" aria-hidden="true">
                      {on ? <CheckSquare size={18} /> : <Square size={18} />}
                    </span>
                  )}
                  <span className="day-row-time">{r.time}</span>
                  <span className="day-row-main">
                    <span className="day-row-client">{r.clientName}</span>
                    <span className="day-row-staff">
                      {r.staffName !== '' ? (
                        <>
                          <StaffMark staff={r.staff ?? undefined} size="xs" />
                          {r.staffName}
                        </>
                      ) : (
                        <span className="day-row-none">担当なし</span>
                      )}
                      {state && <span className="chip chip-red">{state}</span>}
                    </span>
                  </span>
                  <span className="day-row-marks" aria-hidden="true">
                    {issue && (
                      <span
                        className="day-mark is-issue"
                        title={`要対応：${r.issues.join('・')}`}
                        data-testid="day-mark-issue"
                      >
                        <TriangleAlert size={14} />
                      </span>
                    )}
                    {r.told && (
                      <span className="day-mark is-told" title={`未連絡の変更：${r.told}`} data-testid="day-mark-told">
                        <MessageSquareText size={14} />
                      </span>
                    )}
                    {r.pinned && (
                      <span className="day-mark is-pin" title="ピン" data-testid="day-mark-pin">
                        <Pin size={14} />
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
