import {
  CalendarClock,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Pin,
  Plus,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react';
import { type DragEvent, type PointerEvent, type ReactNode, useMemo, useRef, useState } from 'react';
import type { Visit } from '../contracts/documents';
import { hhmmToMinutes, jstDate, minutesToHhmm } from '../domain/time';
import { dateText } from '../lib/common';
import { ymOf } from '../lib/month';
import { mdText, typeOf } from '../lib/patternText';
import {
  CAL_STATE_TEXT,
  type CalItem,
  type CalView,
  calDates,
  calTitle,
  clientCalItems,
  itemsByDate,
  monthWeeksMon,
  shiftAnchor,
  slotOf,
  staffCalItems,
} from '../lib/personPage';
import { COMPACT_QUERY, useMedia } from '../lib/useMedia';
import {
  canMoveVisit,
  DAY_END,
  DAY_START,
  inDayRange,
  insertIntoPlan,
  laneLayout,
  snapMinutes,
  weekDates,
} from '../lib/week';
import { useDemoData } from '../store';
import { StaffMark } from './StaffMark';
import { useToast } from './Toast';
import { WithIcon } from './ui';
import { useOpenVisit } from './VisitPanel';
import { TypeDot } from './visitType';
import './personCalendar.css';

/**
 * 〈利用者さん〉・〈スタッフ〉の画面の予定のカレンダー（PRD D309・D310。ADR-0052）。
 * 週（時間軸）と月（マス）。回を押すと訪問の詳細の欄（VisitPanel）。〈利用者さん〉では、広い画面で空き枠を押す（縦にドラッグで所要の長さ）と
 * その〈利用者さん〉を入れた新しい訪問の欄、回をドラッグで別の日時へ（落とした日時で欄が開き、繰り返しの回は範囲を選んで保存。週の予定と同じ）。
 * 狭い画面（600px 以下）は日ごとのリスト（追加・移動はしない。見る・取り消す・担当替えは欄で）。データは書かない（書くのは欄）
 */

/** 時間軸の1分の高さ（px。週の予定と同じ） */
const PX_PER_MIN = 0.8;
const hm = (m: number) => minutesToHhmm(m);
const HOURS = Array.from({ length: (DAY_END - DAY_START) / 60 + 1 }, (_, i) => DAY_START + i * 60);

export function PersonCalendar({
  kind,
  personId,
  view,
  anchor,
  onChange,
  highlight = null,
  dayNote,
  aside,
}: {
  kind: 'client' | 'staff';
  personId: string;
  view: CalView;
  /** 見せる期間の基準の日（週はその日を含む週、月はその日の月） */
  anchor: string;
  /** 見せ方・期間を変えた（URL に書く） */
  onChange: (next: { view: CalView; anchor: string }) => void;
  /** 強調する繰り返し（定期パターンの ID） */
  highlight?: string | null;
  /** 日の見出しに添える印（休み・欠勤など） */
  dayNote?: (date: string) => ReactNode;
  /** 道具の行の右に置くもの */
  aside?: ReactNode;
}) {
  const { data, update } = useDemoData();
  const terms = data.org.terms;
  /**
   * ドラッグで日時を動かし、担当を選ばずに保存した回の知らせ（新しい日に今の案があるとき。週の予定と同じ「空き時間に入れる」）
   */
  const [notice, setNotice] = useState<{ date: string; visitId: string; label: string; error: string | null } | null>(
    null,
  );
  const toast = useToast();
  const openVisit = useOpenVisit();
  const narrow = useMedia(COMPACT_QUERY);
  const today = jstDate(Date.now());
  const isClient = kind === 'client';
  /** 足す・動かすのは〈利用者さん〉の広い画面だけ（ADR-0051 の決定5） */
  const editable = isClient && !narrow;
  const dates = useMemo(() => calDates(view, anchor), [view, anchor]);
  const from = dates[0]!;
  const to = dates.at(-1)!;
  const items = useMemo(
    () => (isClient ? clientCalItems(data, personId, from, to) : staffCalItems(data, personId, from, to)),
    [data, isClient, personId, from, to],
  );
  const byDate = useMemo(() => itemsByDate(items), [items]);
  const staffById = useMemo(() => new Map(data.staff.map((s) => [s.id, s])), [data.staff]);
  const clientById = useMemo(() => new Map(data.clients.map((c) => [c.id, c])), [data.clients]);
  const hlCount = highlight ? items.filter((it) => it.visit.pattern?.id === highlight).length : 0;

  // ---- 回の文 ----
  const whoText = (it: CalItem): string => {
    if (!isClient) return clientById.get(it.visit.clientId)?.displayName ?? '（不明）';
    if (it.state !== 'assigned') return CAL_STATE_TEXT[it.state];
    return staffById.get(it.staffId ?? '')?.name ?? '（不明）';
  };
  const shortWho = (it: CalItem): string => {
    const t = whoText(it);
    return isClient && it.state === 'assigned' ? (t.split(/\s+/)[0] ?? t) : t;
  };
  const itemLabel = (it: CalItem) => {
    const type = typeOf(data.visitTypes, it.visit.typeId);
    const extra = [
      isClient ? null : CAL_STATE_TEXT[it.state] || null,
      type?.name ?? null,
      it.edited ? 'この回だけ変更' : null,
      it.pinned ? '固定' : null,
    ].filter(Boolean);
    return `${dateText(it.visit.date)} ${it.visit.earliestStart}〜${hm(it.end)} ${whoText(it)}${
      extra.length > 0 ? `（${extra.join('・')}）` : ''
    }（押すと訪問の詳細）`;
  };
  const hlClass = (it: CalItem) => (highlight ? (it.visit.pattern?.id === highlight ? ' is-hl' : ' is-dim') : '');
  const stateClass = (it: CalItem) => ` is-${it.state}`;

  // ---- 開く ----
  const focusBack = (visitId: string | null) =>
    visitId
      ? document.querySelector<HTMLElement>(`[data-testid="pcal-visit"][data-visit="${CSS.escape(visitId)}"]`)
      : null;
  const open = (v: Visit) => openVisit({ visitId: v.id, returnFocus: focusBack });
  /** 新しい訪問の欄（この〈利用者さん〉を入れて） */
  const openNew = (date: string, start: number, duration: number) =>
    openVisit({
      newVisit: { date, clientId: personId, start: hm(start) },
      draft: { durationMinutes: duration },
      returnFocus: focusBack,
    });
  /** 道具の行の「訪問を足す」（キーボードでも足せる）：期間の中の今日以降の最初の日の 09:00 */
  const addDate = dates.find((d) => d >= today) ?? null;

  // ---- 回を動かす（HTML のドラッグ。週の予定と同じ） ----
  const grab = useRef<{ visitId: string; offset: number } | null>(null);
  const [hover, setHover] = useState<{ date: string; start: number; minutes: number } | null>(null);
  const visitById = useMemo(() => new Map(items.map((it) => [it.visit.id, it.visit])), [items]);
  const movable = (it: CalItem) =>
    editable && canMoveVisit(it.visit.date, today) && !it.visit.cancelled && it.state !== 'leave';
  const onDragStart = (e: DragEvent<HTMLElement>, it: CalItem) => {
    e.dataTransfer.setData('text/plain', it.visit.id);
    e.dataTransfer.effectAllowed = 'move';
    grab.current = { visitId: it.visit.id, offset: e.clientY - e.currentTarget.getBoundingClientRect().top };
  };
  const endDrag = () => {
    grab.current = null;
    setHover(null);
  };
  const dropStart = (e: DragEvent<HTMLElement>): number | null => {
    const g = grab.current;
    if (!g) return null;
    const top = e.currentTarget.getBoundingClientRect().top;
    return snapMinutes(DAY_START + (e.clientY - top - g.offset) / PX_PER_MIN);
  };
  /** 落とした日時で欄を開く（範囲は欄で選ぶ） */
  const moveTo = (visitId: string, date: string, start: number) => {
    const v = visitById.get(visitId);
    if (!v) return;
    if (!canMoveVisit(date, today)) {
      toast('今日より前の日へは動かせません');
      return;
    }
    if (!inDayRange(start, v.durationMinutes)) {
      toast(`${hm(DAY_START)}〜${hm(DAY_END)} の中に置いてください`);
      return;
    }
    if (date === v.date && start === hhmmToMinutes(v.earliestStart)) return;
    const width = hhmmToMinutes(v.latestStart) - hhmmToMinutes(v.earliestStart);
    setNotice(null);
    openVisit({
      visitId,
      draft: { date, earliestStart: hm(start), latestStart: hm(start + width) },
      returnFocus: focusBack,
      onSaved: (r) => {
        if (r.moved && !r.staffSet) setNotice({ date: r.date, visitId: r.visitId, label: r.label, error: null });
      },
    });
  };
  const onColDragOver = (e: DragEvent<HTMLElement>, date: string) => {
    if (!grab.current || !canMoveVisit(date, today)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const s = dropStart(e);
    const v = visitById.get(grab.current.visitId);
    if (s !== null && (hover?.date !== date || hover.start !== s))
      setHover({ date, start: s, minutes: v?.durationMinutes ?? 60 });
  };
  const onColDrop = (e: DragEvent<HTMLElement>, date: string) => {
    e.preventDefault();
    const s = dropStart(e);
    const g = grab.current;
    endDrag();
    if (g && s !== null) moveTo(g.visitId, date, s);
  };
  const onCellDragOver = (e: DragEvent<HTMLElement>, date: string) => {
    if (!grab.current || !canMoveVisit(date, today)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (hover?.date !== date) setHover({ date, start: 0, minutes: 0 });
  };
  const onCellDrop = (e: DragEvent<HTMLElement>, date: string) => {
    e.preventDefault();
    const g = grab.current;
    endDrag();
    const v = g ? visitById.get(g.visitId) : undefined;
    if (g && v) moveTo(g.visitId, date, hhmmToMinutes(v.earliestStart));
  };

  /** 新しい日の担当の空き時間に入れる（入る人がいなければ知らせに理由） */
  const insert = () => {
    if (!notice) return;
    const r = insertIntoPlan(data, notice.date, notice.visitId);
    if (!r.staffId) {
      setNotice({ ...notice, error: '空き時間に入りません。日の予定で手で入れるか、AI で組んでください' });
      return;
    }
    update((d) => insertIntoPlan(d, notice.date, notice.visitId).data);
    toast(`${mdText(notice.date)} の空き時間に入れました（担当：${staffById.get(r.staffId)?.name ?? ''}）`);
    setNotice(null);
  };
  const noticeBand = notice && (
    <output className="stack pcal-notice" data-testid="pcal-notice">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span>
          <WithIcon icon={TriangleAlert} size={16}>
            {notice.label} へ動かしました。担当はそのままです（その日に入らなければ要対応に出ます）
          </WithIcon>
        </span>
        <button type="button" className="icon-btn" aria-label="知らせを閉じる" onClick={() => setNotice(null)}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {notice.error && <p className="warn-text">{notice.error}</p>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-small"
          onClick={insert}
          disabled={!!notice.error}
          data-testid="pcal-insert"
        >
          <WithIcon icon={Sparkles} size={14}>
            {mdText(notice.date)} の空き時間に入る人を当てる
          </WithIcon>
        </button>
      </div>
    </output>
  );

  // ---- 空き枠から足す（押す・縦にドラッグ） ----
  const [ghost, setGhostState] = useState<{ date: string; a: number; b: number } | null>(null);
  /** 押している間の範囲（描き直しを待たずに離したときも読めるよう、state と同じ値を持つ） */
  const ghostRef = useRef<{ date: string; a: number; b: number } | null>(null);
  const setGhost = (g: { date: string; a: number; b: number } | null) => {
    ghostRef.current = g;
    setGhostState(g);
  };
  const minuteAt = (e: PointerEvent<HTMLElement>) => {
    const top = e.currentTarget.getBoundingClientRect().top;
    const m = Math.floor((DAY_START + (e.clientY - top) / PX_PER_MIN) / 15) * 15;
    return Math.min(Math.max(m, DAY_START), DAY_END - 15);
  };
  const onPointerDown = (e: PointerEvent<HTMLElement>, date: string) => {
    if (!editable || e.button !== 0 || date < today) return;
    if ((e.target as Element).closest('.pcal-item')) return;
    const m = minuteAt(e);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setGhost({ date, a: m, b: m });
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const g = ghostRef.current;
    if (!g) return;
    // 押した枠（15分）と今の枠。同じ枠の中で動いただけなら押しただけと同じ
    const m = minuteAt(e);
    if (m !== g.b) setGhost({ ...g, b: m });
  };
  const onPointerUp = () => {
    const g = ghostRef.current;
    if (!g) return;
    const { start, duration } = slotOf(g.a, g.b);
    setGhost(null);
    openNew(g.date, start, Math.min(duration, DAY_END - start));
  };

  // ---- 部品 ----
  const staffMark = (it: CalItem) => (it.staffId ? <StaffMark staff={staffById.get(it.staffId)} size="xs" /> : null);
  const typeDot = (v: Visit) => {
    const t = typeOf(data.visitTypes, v.typeId);
    return t ? <TypeDot type={t} size={8} /> : null;
  };
  const itemButton = (it: CalItem, style?: React.CSSProperties, compact = false) => (
    <button
      key={it.visit.id}
      type="button"
      className={`pcal-item${compact ? ' is-compact' : ''}${stateClass(it)}${hlClass(it)}`}
      style={style}
      draggable={movable(it)}
      onDragStart={(e) => (movable(it) ? onDragStart(e, it) : e.preventDefault())}
      onDragEnd={endDrag}
      onClick={() => open(it.visit)}
      title={itemLabel(it).replace('（押すと訪問の詳細）', '')}
      aria-label={itemLabel(it)}
      aria-pressed={highlight ? it.visit.pattern?.id === highlight : undefined}
      data-testid="pcal-visit"
      data-visit={it.visit.id}
      data-date={it.visit.date}
      data-state={it.state}
      data-pattern={it.visit.pattern?.id ?? ''}
    >
      <span className="pcal-item-time">
        {typeDot(it.visit)}
        {it.visit.earliestStart}
        {it.pinned && <Pin size={10} aria-hidden="true" />}
        {it.edited && <span className="pcal-item-mark">変</span>}
      </span>
      <span className="pcal-item-who">
        {isClient && staffMark(it)}
        {shortWho(it)}
      </span>
    </button>
  );
  const dayHead = (d: string) => (
    <span className="pcal-day-head">
      <span className={`pcal-day-date${d === today ? ' is-today' : ''}`}>{dateText(d)}</span>
      {dayNote?.(d)}
    </span>
  );

  // ---- 道具の行 ----
  const toolbar = (
    <div className="row pcal-tools">
      <div className="row pcal-nav">
        <button
          type="button"
          className="icon-btn"
          onClick={() => onChange({ view, anchor: shiftAnchor(view, anchor, -1) })}
          aria-label={view === 'week' ? '前の週' : '前の月'}
          data-testid="pcal-prev"
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <strong className="pcal-title" aria-live="polite" data-testid="pcal-title">
          {calTitle(view, anchor)}
        </strong>
        <button
          type="button"
          className="icon-btn"
          onClick={() => onChange({ view, anchor: shiftAnchor(view, anchor, 1) })}
          aria-label={view === 'week' ? '次の週' : '次の月'}
          data-testid="pcal-next"
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
        <button type="button" className="btn btn-small" onClick={() => onChange({ view, anchor: today })}>
          今日
        </button>
      </div>
      <fieldset className="segmented pcal-views" aria-label="見せ方">
        {(['week', 'month'] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            className={view === v ? 'is-on' : ''}
            onClick={() => onChange({ view: v, anchor })}
            data-testid="pcal-view"
            data-view={v}
          >
            <WithIcon icon={v === 'week' ? CalendarClock : CalendarRange} size={14}>
              {v === 'week' ? '週' : '月'}
            </WithIcon>
          </button>
        ))}
      </fieldset>
      {editable && (
        <button
          type="button"
          className="btn btn-small"
          disabled={addDate === null}
          title={addDate === null ? '今日より前の期間には足せません' : undefined}
          onClick={() => addDate && openNew(addDate, 9 * 60, 60)}
          data-testid="pcal-add"
        >
          <WithIcon icon={Plus} size={14}>
            訪問を足す
          </WithIcon>
        </button>
      )}
      {aside}
    </div>
  );

  const notes = (
    <>
      {noticeBand}
      {highlight && (
        <p className="sub pcal-hl-note" data-testid="pcal-hl-note">
          選んだ繰り返しの回：この期間に {hlCount}回
        </p>
      )}
      {editable && (
        <p className="sub pcal-howto">
          空いている所を押すと（縦にドラッグすると所要の長さで）訪問を足せます。回をドラッグすると日時を動かせます。
        </p>
      )}
    </>
  );

  // ---- 狭い画面：日ごとのリスト ----
  if (narrow) {
    const shown = view === 'month' ? dates.filter((d) => ymOf(d) === ymOf(anchor)) : dates;
    return (
      <div className="pcal is-list" data-testid="pcal" data-view={view} data-layout="list">
        {toolbar}
        {notes}
        <ul className="pcal-list" data-testid="pcal-list">
          {shown
            .filter((d) => view === 'week' || (byDate.get(d)?.length ?? 0) > 0 || d === today)
            .map((d) => {
              const list = byDate.get(d) ?? [];
              return (
                <li key={d} className="pcal-list-day" data-date={d} data-testid="pcal-day">
                  {dayHead(d)}
                  {list.length === 0 ? (
                    <span className="sub">訪問なし</span>
                  ) : (
                    <div className="pcal-list-items">{list.map((it) => itemButton(it, undefined, true))}</div>
                  )}
                </li>
              );
            })}
        </ul>
        {view === 'month' && items.length === 0 && <p className="sub">この月の訪問はありません。</p>}
      </div>
    );
  }

  // ---- 月 ----
  if (view === 'month') {
    const ym = ymOf(anchor);
    return (
      <div className="pcal" data-testid="pcal" data-view="month" data-layout="month">
        {toolbar}
        {notes}
        <div className="pcal-month">
          {monthWeeksMon(ym).map((week) => (
            <div key={week[0]} className="pcal-month-row">
              {week.map((d) => {
                const list = byDate.get(d) ?? [];
                const out = ymOf(d) !== ym;
                const drop = hover?.date === d;
                return (
                  <section
                    key={d}
                    aria-label={`${dateText(d)}の訪問`}
                    className={`pcal-cell${out ? ' is-out' : ''}${d === today ? ' is-today' : ''}${d < today ? ' is-past' : ''}${drop ? ' is-drop' : ''}`}
                    onDragOver={(e) => onCellDragOver(e, d)}
                    onDragLeave={() => hover?.date === d && setHover(null)}
                    onDrop={(e) => onCellDrop(e, d)}
                    data-testid="pcal-cell"
                    data-date={d}
                  >
                    <span className="pcal-cell-head">
                      <span className="pcal-cell-day">{Number(d.slice(8, 10))}</span>
                      {dayNote?.(d)}
                      {editable && d >= today && (
                        <button
                          type="button"
                          className="pcal-cell-add"
                          onClick={() => openNew(d, 9 * 60, 60)}
                          aria-label={`${dateText(d)}に訪問を足す`}
                          title={`${dateText(d)}に訪問を足す`}
                          data-testid="pcal-cell-add"
                        >
                          <Plus size={12} aria-hidden="true" />
                        </button>
                      )}
                    </span>
                    <span className="pcal-cell-items">{list.map((it) => itemButton(it, undefined, true))}</span>
                  </section>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ---- 週（時間軸） ----
  const height = (DAY_END - DAY_START) * PX_PER_MIN;
  const top = (m: number) => (Math.min(Math.max(m, DAY_START), DAY_END) - DAY_START) * PX_PER_MIN;
  return (
    <div className="pcal" data-testid="pcal" data-view="week" data-layout="week">
      {toolbar}
      {notes}
      <div className="pcal-week">
        <div className="pcal-week-head" aria-hidden="true" />
        {weekDates(anchor).map((d) => (
          <div key={d} className="pcal-week-head" data-date={d}>
            {dayHead(d)}
          </div>
        ))}
        <div className="pcal-gutter" style={{ height }} aria-hidden="true">
          {HOURS.map((h) => (
            <span key={h} className="pcal-hour" style={{ top: top(h) }}>
              {hm(h)}
            </span>
          ))}
        </div>
        {weekDates(anchor).map((d) => {
          const list = byDate.get(d) ?? [];
          const lanes = laneLayout(list.map((it) => ({ id: it.visit.id, start: it.start, end: it.end })));
          return (
            <section
              key={d}
              className={`pcal-col${d < today ? ' is-past' : ''}${editable && d >= today ? ' can-add' : ''}`}
              style={{ height }}
              aria-label={`${dateText(d)}の訪問`}
              onDragOver={(e) => onColDragOver(e, d)}
              onDrop={(e) => onColDrop(e, d)}
              onPointerDown={(e) => onPointerDown(e, d)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => setGhost(null)}
              data-testid="pcal-col"
              data-date={d}
            >
              {hover?.date === d && (
                <div
                  className="pcal-drop"
                  style={{ top: top(hover.start), height: Math.max(24, hover.minutes * PX_PER_MIN) }}
                  aria-hidden="true"
                >
                  {hm(hover.start)}
                </div>
              )}
              {ghost?.date === d && (
                <div
                  className="pcal-ghost"
                  style={{
                    top: top(Math.min(ghost.a, ghost.b)),
                    height: Math.max(12, (Math.abs(ghost.b - ghost.a) + 15) * PX_PER_MIN),
                  }}
                  aria-hidden="true"
                  data-testid="pcal-ghost"
                >
                  {hm(Math.min(ghost.a, ghost.b))}
                </div>
              )}
              {list.map((it) => {
                const l = lanes.get(it.visit.id) ?? { lane: 0, lanes: 1 };
                return itemButton(it, {
                  top: top(it.start),
                  height: Math.max(20, (Math.min(it.end, DAY_END) - Math.max(it.start, DAY_START)) * PX_PER_MIN),
                  left: `calc(${(l.lane / l.lanes) * 100}% + 2px)`,
                  width: `calc(${100 / l.lanes}% - 4px)`,
                });
              })}
            </section>
          );
        })}
      </div>
      <p className="sub pcal-legend">
        {isClient
          ? `印は担当の${terms.staff}（その日の今の担当）。「変」はこの回だけ変えた回です。`
          : `この人が担当する訪問（その日の今の担当）。「変」はこの回だけ変えた回です。`}
      </p>
    </div>
  );
}
