// 訪問の帯・行の共通の部品（PRD D339〜D341。ADR-0056）：日・週・月・人の予定表で同じものを使う。
// - VisitMarks：帯の印（要対応・資格✗／限✗・未連絡の変更・ピン・この回だけ変更・仮押さえ。lib/visitLook）
// - useVisitLooks：期間の訪問の見た目（日の状態 useDayStatuses から。画面ごとに判定を持たない）
// - useVisitSelection・useVisitItem：選ぶ（Shift／Ctrl＋クリック・Shift／Ctrl＋Enter・スマホは長押しか「選ぶ」）と、キーで動かす・押して開く
// - VisitRow：1行1訪問の行（スマホの日ごとのリスト・人の予定表の2段目・月のその日の回の一覧）
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
  useMemo,
  useRef,
  useState,
} from 'react';
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
    const staffWhy =
      t.staffId && o.staffWhy && first.staffId !== undefined ? o.staffWhy(visitId, t.date, t.staffId) : null;
    return { verdict: dropVerdict(d, visitId, t, o.today, { fit, staffWhy }), fit };
  };
  return {
    dragId,
    hover,
    /** つかんだ帯の上端からの高さ（px。時間軸で落とした開始を出す） */
    offset: () => grab.current?.offset ?? 0,
    /** つかめる帯・行の props */
    source: (visitId: string, movable: boolean) => ({
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
    }),
    /** 落とし先の props。at は落とした位置から落とし先（日付・開始・担当・行の〈利用者さん〉）を出す */
    target: (key: string, at: (e: DragEvent<HTMLElement>) => DropTarget | null) => ({
      onDragOver: (e: DragEvent<HTMLElement>) => {
        const g = grab.current;
        if (!g) return;
        const t = at(e);
        if (!t) return;
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
