// スマホ（600px 以下）の日ごとのリスト（PRD D334。ADR-0055）：その日の訪問を時刻の順に1行ずつ
// （時刻・〈利用者さん〉・担当の印と名前・印（要対応・未連絡の変更・ピン））。行を押すと訪問の詳細の欄（下から出る欄）。
// 左右にスワイプすると前・次の日。行を長押しするか「選ぶ」で複数選択（選んでいる間は押すと選ぶ・外す）
import { type PointerEvent as ReactPointerEvent, useRef } from 'react';
import { LONG_PRESS_MS, SelectToggle, VisitRow, type VisitRowData } from './visitParts';
import './dayList.css';

/** リストの1行（行の作りは共通の VisitRow。選べるか：今日より前・取り消し・休みは選ばない） */
export type DayListRow = VisitRowData & { selectable: boolean };

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
    /** マウスか（スワイプはタッチ・ペンだけ。マウスで文字をなぞったときに日を送らない） */
    mouse: boolean;
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
      mouse: e.pointerType === 'mouse',
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
    if (!p.mouse && Math.abs(dx) >= SWIPE_X && Math.abs(dy) <= SWIPE_Y) {
      p.moved = true;
      if (dx < 0) onNext?.();
      else onPrev?.();
    }
    // 続く click（同じ行）は印を読むので、そのあとで消す（行の外で離したときに古い印を残さない）
    setTimeout(() => {
      if (press.current === p) press.current = null;
    }, 0);
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
  const count = rows.filter((r) => !r.state).length;
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
        <SelectToggle
          selecting={selecting}
          onChange={onSelecting}
          testId="day-list-select"
          disabled={!rows.some((r) => r.selectable)}
        />
      </div>
      {rows.length === 0 ? (
        <p className="sub day-list-empty">この日の訪問はありません。</p>
      ) : (
        <ul className="vrow-list day-rows">
          {rows.map((r) => {
            const on = selecting && isSelected(r.visitId);
            return (
              <li key={r.visitId}>
                <VisitRow
                  row={r}
                  selecting={selecting}
                  selected={on}
                  testId="day-row"
                  markPrefix="day-mark"
                  extraClass="day-row"
                  props={{
                    'aria-pressed': selecting ? on : undefined,
                    'data-selected': on || undefined,
                    'data-visit-item': '',
                    onPointerDown: (e: ReactPointerEvent) => onDown(e, r),
                    onClick: () => onRowClick(r),
                    onContextMenu: (e: { preventDefault(): void }) => {
                      // 長押しで出るブラウザのメニューを出さない（長押しは複数選択）
                      if (r.selectable) e.preventDefault();
                    },
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
