// 訪問の帯・行の共通の部品（PRD D339〜D341。ADR-0056）：日・週・月・人の予定表で同じものを使う。
// - VisitMarks：帯の印（要対応・資格✗／限✗・未連絡の変更・ピン・この回だけ変更・仮押さえ。lib/visitLook）
// - useVisitLooks：期間の訪問の見た目（日の状態 useDayStatuses から。画面ごとに判定を持たない）
// - useVisitSelection・useVisitItem：選ぶ（Shift／Ctrl＋クリック・Shift／Ctrl＋Enter・スマホは長押しか「選ぶ」）と、キーで動かす・押して開く
// - 札の3段の大きさ（PRD D342。ADR-0057）：大＝日の時間軸の帯（data-size="l"）・中＝リストの行 VisitRow（"m"）・小＝表のマスの札 VisitChip（"s"）。
//   印（VisitMarks）・選ぶ・キー・ドラッグは3段とも同じ部品。入れ物は時間軸・表（マスに積む ChipStack）・リスト（行）の3種類
// - VisitRow：1行1訪問の行（スマホの日ごとのリスト・人の予定表の2段目・月のその日の回の一覧・表のマスの「+N」の一覧）
// - useVisitDrag・DropShadow：ドラッグの落とし先の判定（lib/visitDrop）と影
// データを書くのは store の update だけ（キーは components/visitKeys、選んだ訪問の操作は SelectionBar、落としたあとは欄）
import { CheckSquare, MessageSquareText, Pin, Square, TriangleAlert } from 'lucide-react';
import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { Staff } from '../contracts/documents';
import { isOnLeave } from '../domain/leaves';
import { jstDate } from '../domain/time';
import { deferredDragStart } from '../lib/dragStart';
import { useCompileInput } from '../lib/useDayModel';
import { useDayStatuses } from '../lib/useDayStatuses';
import { type DropTarget, type DropVerdict, dropShadowText, dropTone, dropVerdict } from '../lib/visitDrop';
import { dayLooks, type LookMarkKind, type VisitLook } from '../lib/visitLook';
import { isMultiClick, isMultiKey, selectedText, toggleGroup, toggleId } from '../lib/visitSelect';
import { fitCountAt } from '../lib/week';
import { visitsOn } from '../patterns';
import { useDemoData } from '../store';
import { StaffMark } from './StaffMark';
import './visitParts.css';

// ---- 見た目 ----

const ICONS: Partial<Record<LookMarkKind, (size: number) => ReactNode>> = {
  issue: (n) => <TriangleAlert size={n} aria-hidden="true" />,
  told: (n) => <MessageSquareText size={n} aria-hidden="true" />,
  pin: (n) => <Pin size={n} strokeWidth={2.4} aria-hidden="true" />,
};

/**
 * 帯の印（形と文字で分ける。色だけにしない）。読み上げは帯・行の aria-label に look.text を入れるので、印は aria-hidden。
 * testIdPrefix を渡すと印ごとに `${prefix}-${種類}`（日ごとのリストの day-mark-issue など）
 */
export function VisitMarks({
  look,
  size = 12,
  testIdPrefix,
  className = '',
}: {
  look: VisitLook | undefined;
  size?: number;
  testIdPrefix?: string;
  className?: string;
}) {
  if (!look || look.marks.length === 0) return null;
  return (
    <span className={`vmarks ${className}`} aria-hidden="true" data-testid="visit-marks" data-marks={look.kinds}>
      {look.marks.map((m) => (
        <span
          key={`${m.kind}-${m.short}`}
          className={`vmark is-${m.tone}`}
          title={m.title}
          data-kind={m.kind}
          data-testid={testIdPrefix ? `${testIdPrefix}-${m.kind}` : undefined}
        >
          {ICONS[m.kind]?.(size) ?? m.short}
        </span>
      ))}
    </span>
  );
}

/**
 * 期間の訪問の見た目（訪問ID → VisitLook）。日の状態（月の予定・週の予定・ホームと同じ useDayStatuses の覚え）から引くので、
 * どの画面でも同じ判定になる。dates は useMemo した配列を渡す
 */
export function useVisitLooks(dates: readonly string[]): (visitId: string) => VisitLook | undefined {
  const { data } = useDemoData();
  const compileInput = useCompileInput(data);
  const statuses = useDayStatuses(data, compileInput, dates);
  const today = jstDate(Date.now());
  return useMemo(() => {
    const staffById = new Map(data.staff.map((s) => [s.id, s.name]));
    const tentative = new Set(data.clients.filter((c) => c.tentative).map((c) => c.id));
    const all = new Map<string, VisitLook>();
    for (const d of dates) {
      const st = statuses.get(d);
      const looks = dayLooks(
        {
          issues: st?.status.issues ?? new Map(),
          told: st?.status.told ?? null,
          problem: st?.problem ?? null,
        },
        visitsOn(data, d),
        {
          staffName: (id) => staffById.get(id) ?? '（不明）',
          leaveOf: (v) => isOnLeave(data.clientLeaves, { clientId: v.clientId, date: d }),
          tentativeOf: (id) => tentative.has(id),
          past: d < today,
        },
      );
      for (const [id, l] of looks) all.set(id, l);
    }
    return (id: string) => all.get(id);
  }, [data, dates, statuses, today]);
}

// ---- 選ぶ ----

/**
 * 選んだ訪問（日・週・月・人の予定表）。key（日付・週・月・人）が変わったら外す。Esc で外す（入力欄の中・欄が開いている間は除く）
 */
export function useVisitSelection(key: string) {
  const [ids, setIds] = useState<readonly string[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 日付・週・月が変わったら外す
  useEffect(() => {
    setIds([]);
  }, [key]);
  const toggle = useCallback((id: string) => setIds((xs) => toggleId(xs, id)), []);
  const toggleMany = useCallback((group: readonly string[]) => setIds((xs) => toggleGroup(xs, group)), []);
  const clear = useCallback(() => setIds([]), []);
  useEffect(() => {
    if (ids.length === 0) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"], .side-panel')) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      setIds([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ids.length]);
  const set = useMemo(() => new Set(ids), [ids]);
  return { ids, has: (id: string) => set.has(id), toggle, toggleMany, clear, set: setIds };
}
export type VisitSelection = ReturnType<typeof useVisitSelection>;

/** 長押しとみなす時間（ms） */
export const LONG_PRESS_MS = 500;
/** 押したあと、これより動けば押したことにしない（px） */
const MOVE_SLOP = 10;

type KeyHandler = (e: KeyboardEvent<HTMLElement>, visitId: string) => boolean;

/**
 * 訪問の帯・行の押し方（どの画面でも同じ）。返す関数に訪問と「選べるか」「動かせるか」を渡すと、button に付ける props を返す：
 * クリック（Shift／Ctrl＋クリックで選ぶ・選ぶ形なら選ぶ・ほかは開く）、キー（Shift／Ctrl＋Enter で選ぶ・動かせればキーで動かす）、
 * longPress なら長押し（500ms）で選ぶ形に入って選ぶ（スマホ）
 */
export function useVisitItem(opts: {
  selection: Pick<VisitSelection, 'toggle'> | null;
  onOpen: (visitId: string) => void;
  keys?: KeyHandler | null;
  selecting?: boolean;
  longPress?: { onSelecting: (on: boolean) => void } | null;
}) {
  const ref = useRef(opts);
  ref.current = opts;
  const press = useRef<{
    id: string;
    x: number;
    y: number;
    long: boolean;
    moved: boolean;
    timer: number | null;
  } | null>(null);
  const stop = () => {
    const p = press.current;
    if (p?.timer) window.clearTimeout(p.timer);
    if (p) p.timer = null;
  };
  return (visitId: string, f: { selectable: boolean; movable: boolean; selected: boolean }) => {
    const o = ref.current;
    const lp = o.longPress;
    return {
      onClick: (e: MouseEvent<HTMLElement>) => {
        const p = press.current;
        press.current = null;
        if (p && p.id === visitId && (p.long || p.moved)) return;
        if (isMultiClick(e) && o.selection) {
          e.preventDefault();
          if (f.selectable) o.selection.toggle(visitId);
          return;
        }
        if (o.selecting && o.selection) {
          if (f.selectable) o.selection.toggle(visitId);
          return;
        }
        o.onOpen(visitId);
      },
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        if (isMultiKey(e) && o.selection) {
          e.preventDefault();
          if (f.selectable) o.selection.toggle(visitId);
          return;
        }
        if (f.movable && o.keys) o.keys(e, visitId);
      },
      ...(lp
        ? {
            onPointerDown: (e: PointerEvent<HTMLElement>) => {
              if (e.button !== 0) return;
              stop();
              const p = {
                id: visitId,
                x: e.clientX,
                y: e.clientY,
                long: false,
                moved: false,
                timer: null as number | null,
              };
              if (f.selectable && o.selection)
                p.timer = window.setTimeout(() => {
                  p.timer = null;
                  p.long = true;
                  lp.onSelecting(true);
                  o.selection?.toggle(visitId);
                }, LONG_PRESS_MS);
              press.current = p;
            },
            onPointerMove: (e: PointerEvent<HTMLElement>) => {
              const p = press.current;
              if (!p) return;
              if (Math.abs(e.clientX - p.x) > MOVE_SLOP || Math.abs(e.clientY - p.y) > MOVE_SLOP) {
                p.moved = true;
                stop();
              }
            },
            onPointerUp: stop,
            onPointerCancel: stop,
            onContextMenu: (e: MouseEvent<HTMLElement>) => {
              // 長押しで出るブラウザのメニューを出さない（長押しは選ぶ）
              if (f.selectable) e.preventDefault();
            },
          }
        : {}),
      'aria-pressed': f.selected || o.selecting ? f.selected : undefined,
      'data-selected': f.selected || undefined,
      'data-visit-item': '',
    };
  };
}

/**
 * スマホの「選ぶ」（選ぶ形に入る・抜ける。PRD D334・D340）。日の予定の日ごとのリスト・週の表・人の予定表で同じボタン
 */
export function SelectToggle({
  selecting,
  onChange,
  disabled,
  testId,
}: {
  selecting: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <button
      type="button"
      className={`btn btn-small select-toggle${selecting ? ' is-on' : ''}`}
      aria-pressed={selecting}
      onClick={() => onChange(!selecting)}
      data-testid={testId}
      disabled={disabled}
    >
      {selecting ? <CheckSquare size={14} aria-hidden="true" /> : <Square size={14} aria-hidden="true" />}
      {selecting ? '選び終える' : '選ぶ'}
    </button>
  );
}

// ---- 1行1訪問の行 ----

/** 行の中身 */
export type VisitRowData = {
  visitId: string;
  /** 「9:00〜10:00」 */
  time: string;
  /** 大きく出す名前（ふつうは〈利用者さん〉。〈スタッフ〉の画面でも〈利用者さん〉） */
  title: string;
  /** 担当（印。担当なし・〈スタッフ〉の画面では null） */
  staff: Staff | null;
  /** 2行目の文字（担当の名前。空なら「担当なし」） */
  staffName: string;
  /** 取り消し・休みの文（無ければ null） */
  state: string | null;
  look: VisitLook | undefined;
  /** 種類の色（左の線） */
  color: string | null;
  /** 2行目に担当を出さない（〈スタッフ〉の画面：その人の回だけなので要らない） */
  hideStaff?: boolean;
};

/** 行の読み上げ（時刻・名前・担当・状態・印・選択） */
export function visitRowLabel(r: VisitRowData, selecting: boolean, selected: boolean): string {
  return [
    r.time,
    `${r.title}さん`,
    r.hideStaff ? null : r.staffName ? `担当 ${r.staffName}` : '担当なし',
    r.state,
    r.look?.text || null,
    selecting ? (selected ? '選択中' : '選んでいない') : null,
  ]
    .filter(Boolean)
    .join('・');
}

/**
 * 1行1訪問の行（PRD D334・D340）：［選ぶの印］時刻｜〈利用者さん〉と担当の印・名前（取り消し・休みの札）｜印。
 * スマホの日ごとのリスト・人の予定表の2段目（日ごとのリスト）・月のその日の回の一覧で同じ形。押し方は呼ぶ側の props（useVisitItem）
 */
export function VisitRow({
  row: r,
  selecting,
  selected,
  props,
  testId,
  markPrefix,
  extraClass = '',
}: {
  row: VisitRowData;
  selecting: boolean;
  selected: boolean;
  props: Record<string, unknown>;
  testId: string;
  /** 印の data-testid の前（日ごとのリストは day-mark） */
  markPrefix?: string;
  extraClass?: string;
}) {
  const tone = r.look?.tone;
  return (
    <button
      type="button"
      className={[
        'vrow',
        tone === 'issue' || tone === 'unassigned' ? 'is-issue' : '',
        !r.hideStaff && r.staffName === '' && !r.state ? 'is-unassigned' : '',
        r.state ? 'is-off' : '',
        selected ? 'is-multi' : '',
        extraClass,
      ].join(' ')}
      style={r.color ? ({ borderLeftColor: r.color } as CSSProperties) : undefined}
      aria-label={visitRowLabel(r, selecting, selected)}
      data-testid={testId}
      data-visit={r.visitId}
      data-size="m"
      data-marks={r.look?.kinds ?? ''}
      {...props}
    >
      {selecting && (
        <span className="vrow-check" aria-hidden="true">
          {selected ? <CheckSquare size={18} /> : <Square size={18} />}
        </span>
      )}
      <span className="vrow-time">{r.time}</span>
      <span className="vrow-main">
        <span className="vrow-title">{r.title}</span>
        {(!r.hideStaff || r.state) && (
          <span className="vrow-staff">
            {r.hideStaff ? null : r.staffName !== '' ? (
              <>
                <StaffMark staff={r.staff ?? undefined} size="xs" />
                {r.staffName}
              </>
            ) : (
              <span className="vrow-none">担当なし</span>
            )}
            {r.state && <span className="chip chip-red">{r.state}</span>}
          </span>
        )}
      </span>
      <VisitMarks look={r.look} size={14} testIdPrefix={markPrefix} className="vrow-marks" />
    </button>
  );
}

// ---- 小さな札（表のマス） ----

/** 札の大きさ（大＝日の時間軸の帯・中＝リストの行・小＝表のマスの札。PRD D342） */
export type ChipSize = 'l' | 'm' | 's';

/**
 * 小さな札（表のマスに積む。PRD D342）：「9:00 図」（時刻と頭文字）と印。印・選ぶ・キー・ドラッグは時間軸の帯・リストの行と同じ部品で、
 * 押し方は呼ぶ側の props（useVisitItem・useVisitDrag の source）。label は読み上げ（時刻・名前・担当・印・選択）
 */
export function VisitChip({
  visitId,
  time,
  short,
  label,
  title,
  look,
  color,
  selected,
  unassigned = false,
  off = false,
  props,
  testId,
}: {
  visitId: string;
  /** 「9:00」 */
  time: string;
  /** 頭文字（〈スタッフ〉×曜日の表は〈利用者さん〉の頭文字、〈利用者さん〉×曜日の表は担当の印） */
  short: ReactNode;
  label: string;
  title?: string;
  look: VisitLook | undefined;
  /** 種類の色（左の線） */
  color: string | null;
  selected: boolean;
  unassigned?: boolean;
  /** 取り消し・休み（薄く・動かさない） */
  off?: boolean;
  props: Record<string, unknown>;
  testId: string;
}) {
  const tone = look?.tone;
  return (
    <button
      type="button"
      className={[
        'vchip',
        tone === 'issue' || tone === 'unassigned' ? 'is-issue' : '',
        unassigned ? 'is-unassigned' : '',
        off ? 'is-off' : '',
        selected ? 'is-multi' : '',
      ].join(' ')}
      style={color ? ({ borderLeftColor: color } as CSSProperties) : undefined}
      aria-label={label}
      title={title ?? label}
      data-testid={testId}
      data-visit={visitId}
      data-size="s"
      data-marks={look?.kinds ?? ''}
      {...props}
    >
      <span className="vchip-time">{time}</span>
      <span className="vchip-short">{short}</span>
      <VisitMarks look={look} size={9} className="vchip-marks" />
    </button>
  );
}

/** 1マスに出す札の数（残りは「+N」） */
export const CHIPS_PER_CELL = 3;

/**
 * 表のマスに札を積む入れ物（PRD D342）：先頭から max 件（keep の訪問は必ず見せる：キーで動かした・欄で直した札）、残りは「+N」。
 * 「+N」を押すとそのマスの札の一覧（リストの行。モーダルにしない吹き出し。Esc・外を押すと閉じて「+N」へ）
 */
export function ChipStack<T extends { visitId: string }>({
  items,
  max = CHIPS_PER_CELL,
  keep,
  chip,
  row,
  listTitle,
  dragging = false,
  testId,
}: {
  items: readonly T[];
  max?: number;
  keep?: string | null;
  chip: (it: T) => ReactNode;
  row: (it: T) => ReactNode;
  /** 一覧の見出し（「10/28（水） 山田さんの訪問 5件」） */
  listTitle: string;
  /** ドラッグ中（一覧を薄くし、マウスを受けない。消すとドラッグが止まるので消さない） */
  dragging?: boolean;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  let shown = items.slice(0, max);
  if (keep && items.length > max && !shown.some((x) => x.visitId === keep)) {
    const k = items.find((x) => x.visitId === keep);
    if (k) shown = [...items.slice(0, max - 1), k];
  }
  const rest = items.length - shown.length;
  // 札が減って「+N」が無くなったら閉じる
  useEffect(() => {
    if (open && rest <= 0) setOpen(false);
  }, [open, rest]);
  /** 一覧の置き場所（「+N」の下。入らなければ上。表の箱は横に巻くので、body の直下に出して位置を合わせる） */
  const [at, setAt] = useState<{ left: number; top: number; up: boolean } | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setAt(null);
      return;
    }
    const place = () => {
      const b = moreRef.current?.getBoundingClientRect();
      if (!b) return;
      const w = Math.min(300, window.innerWidth * 0.8);
      const left = Math.max(8, Math.min(b.left, window.innerWidth - w - 8));
      const up = b.bottom + 330 > window.innerHeight && b.top > window.innerHeight - b.bottom;
      setAt({ left, top: up ? b.top - 4 : b.bottom + 4, up });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>('[data-visit-item]')?.focus());
    const onDown = (e: globalThis.PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (listRef.current?.contains(t) || moreRef.current?.contains(t))) return;
      // 一覧の行から開いた訪問の詳細の欄・確認の中を押しても閉じない
      if (t instanceof Element && t.closest('.drawer-wrap, [role="alertdialog"]')) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  if (items.length === 0) return null;
  return (
    <span className="vchips" data-testid={testId}>
      {shown.map((it) => (
        <span key={it.visitId} className="vchip-slot">
          {chip(it)}
        </span>
      ))}
      {rest > 0 && (
        <button
          ref={moreRef}
          type="button"
          className="vchip-more"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={`ほか${rest}件（押すとこのマスの訪問の一覧）`}
          onClick={() => setOpen(!open)}
          data-testid="chip-more"
          data-rest={rest}
        >
          +{rest}
        </button>
      )}
      {open &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="dialog"
            aria-label={listTitle}
            className={`vchip-list${dragging ? ' is-dragging' : ''}${at?.up ? ' is-up' : ''}`}
            style={at ? { left: at.left, top: at.top } : { visibility: 'hidden' }}
            data-testid="chip-list"
            onKeyDown={(e) => {
              if (e.defaultPrevented) return;
              if (e.key === 'Tab') {
                // body の直下に出しているので、端の Tab は「+N」へ戻して閉じる（フォーカスを関係ない所へ落とさない）
                const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-visit-item]') ?? [])];
                const edge = e.shiftKey ? items[0] : items.at(-1);
                if (items.length > 0 && document.activeElement !== edge) return;
              } else if (e.key !== 'Escape') return;
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              moreRef.current?.focus();
            }}
          >
            <p className="vchip-list-title">{listTitle}</p>
            <ul className="vrow-list">
              {items.map((it) => (
                <li key={it.visitId}>{row(it)}</li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </span>
  );
}

// ---- ドラッグ ----

/** 落とし先の影（どの画面でも同じ文と色） */
export type DropHover = { key: string; target: DropTarget; verdict: DropVerdict; fit: number | null | undefined };

/**
 * ドラッグ（HTML のドラッグ）。どの画面も同じ判定（lib/visitDrop）で、置けるときだけ落とせる。影は入る（ok）・入らない（warn。
 * 落とせる）・置けない（ng）の3つ。fit なら落とし先に入れる人の数を数える（その日・時刻で。覚えておく）。
 * staffWhy は担当の列・行へ落とすときの「担当できない理由」。落としたら onDrop（同じ日時・担当なら呼ばない）
 */
export function useVisitDrag(opts: {
  today: string;
  fit?: boolean;
  staffWhy?: (visitId: string, date: string, staffId: string) => string | null;
  onDrop: (visitId: string, v: Extract<DropVerdict, { ok: true }>) => void;
  /** 動かさない（予定のモード「確認」。PRD D348）：どの札もつかめない */
  readOnly?: boolean;
}) {
  const { data } = useDemoData();
  const compileInput = useCompileInput(data);
  const ref = useRef(opts);
  ref.current = opts;
  const dataRef = useRef(data);
  dataRef.current = data;
  /** つかんだ訪問と、帯の上端からつかんだ位置までの高さ（px） */
  const grab = useRef<{ visitId: string; offset: number } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [hover, setHover] = useState<DropHover | null>(null);
  const hoverRef = useRef<DropHover | null>(null);
  const put = (h: DropHover | null) => {
    hoverRef.current = h;
    setHover(h);
  };
  /**
   * dragId の更新は dragstart の後へ遅らせる（src/lib/dragStart.ts）。dragstart の中で描き直すと帯が指の下からずれ、
   * Chrome がドラッグをすぐ終わらせる
   */
  const later = useRef(deferredDragStart()).current;
  const fits = useMemo(() => ({ input: compileInput, memo: new Map<string, number | null>() }), [compileInput]);
  /** 担当できない理由の覚え（訪問・日・人ごと。データが変われば作り直す。dragover は止めていても何度も来る） */
  const whys = useMemo(() => ({ data, memo: new Map<string, string | null>() }), [data]);
  const fitOf = (visitId: string, date: string, start: number): number | null => {
    const k = `${visitId}|${date}|${start}`;
    if (!fits.memo.has(k)) fits.memo.set(k, fitCountAt(fits.input, visitId, date, start));
    return fits.memo.get(k) ?? null;
  };
  const end = () => {
    grab.current = null;
    later.end();
    put(null);
    setDragId(null);
  };
  const judge = (visitId: string, t: DropTarget): { verdict: DropVerdict; fit: number | null | undefined } => {
    const o = ref.current;
    const d = dataRef.current;
    const first = dropVerdict(d, visitId, t, o.today);
    if (!first.ok || first.same) return { verdict: first, fit: undefined };
    const fit = o.fit && t.staffId === undefined ? fitOf(visitId, t.date, first.start) : undefined;
    // 担当の行・列へ落とすときは、担当が変わらなくても（同じ人の別の日へ）その日にその人が担当できるかを見る
    let staffWhy: string | null = null;
    if (t.staffId && o.staffWhy) {
      const k = `${visitId}|${t.date}|${t.staffId}`;
      if (!whys.memo.has(k)) whys.memo.set(k, o.staffWhy(visitId, t.date, t.staffId));
      staffWhy = whys.memo.get(k) ?? null;
    }
    return { verdict: dropVerdict(d, visitId, t, o.today, { fit, staffWhy }), fit };
  };
  return {
    dragId,
    hover,
    /** つかんだ帯の上端からの高さ（px。時間軸で落とした開始を出す） */
    offset: () => grab.current?.offset ?? 0,
    /** つかめる帯・行の props */
    source: (visitId: string, canMove: boolean) => {
      const movable = canMove && !opts.readOnly;
      return {
        draggable: movable,
        onDragStart: (e: DragEvent<HTMLElement>) => {
          if (!movable) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData('text/plain', visitId);
          e.dataTransfer.effectAllowed = 'move';
          grab.current = { visitId, offset: e.clientY - e.currentTarget.getBoundingClientRect().top };
          later.start(() => setDragId(visitId));
        },
        onDragEnd: end,
      };
    },
    /** 落とし先の props。at は落とした位置から落とし先（日付・開始・担当・行の〈利用者さん〉）を出す */
    target: (key: string, at: (e: DragEvent<HTMLElement>) => DropTarget | null) => ({
      onDragOver: (e: DragEvent<HTMLElement>) => {
        const g = grab.current;
        if (!g) return;
        const t = at(e);
        if (!t) {
          // 落とし先でない所（月の外のマス・見出しなど）の上では、前のマスの影を残さない
          if (hoverRef.current?.key === key) put(null);
          return;
        }
        const { verdict, fit } = judge(g.visitId, t);
        if (verdict.ok) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }
        const h = hoverRef.current;
        if (
          !h ||
          h.key !== key ||
          h.target.date !== t.date ||
          h.target.start !== t.start ||
          h.target.staffId !== t.staffId
        )
          put({ key, target: t, verdict, fit });
      },
      onDragLeave: (e: DragEvent<HTMLElement>) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        if (hoverRef.current?.key === key) put(null);
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        e.preventDefault();
        const g = grab.current;
        const t = at(e);
        end();
        if (!g || !t) return;
        const { verdict } = judge(g.visitId, t);
        if (verdict.ok && !verdict.same) ref.current.onDrop(g.visitId, verdict);
      },
    }),
  };
}
export type VisitDrag = ReturnType<typeof useVisitDrag>;

/**
 * 落とし先の影（入る＝緑・入らない＝赤い点線（落とせる）・置けない＝灰の斜線）と文。time は開始を出すか（時間軸）。
 * 文は lib/visitDrop の dropShadowText（どの画面も同じ）
 */
export function DropShadow({
  hover,
  style,
  className = '',
  testId,
  time = true,
}: {
  hover: DropHover;
  style?: CSSProperties;
  className?: string;
  testId?: string;
  time?: boolean;
}) {
  const tone = dropTone(hover.verdict);
  return (
    <div
      className={`vdrop is-${tone} ${className}`}
      style={style}
      aria-hidden="true"
      data-testid={testId}
      data-tone={tone}
    >
      <span className="vdrop-text" data-testid="drop-text">
        {dropShadowText(hover.verdict, { fit: hover.fit, time })}
      </span>
    </div>
  );
}

/** 選んだ訪問の読み上げの添え（帯の aria-label の後ろ） */
export { selectedText };
