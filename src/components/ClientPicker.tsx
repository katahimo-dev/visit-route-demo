// 〈利用者さん〉を選ぶ検索欄（PRD D61・D62・D108。design.md §4 pages「混み具合バーの3段・〈利用者さん〉の検索・週間の上限」）。
// 表示名・よみで絞り込む combobox。候補は listbox で最大10件、上下キーと Enter で選ぶ。選んだ人は上にチップで並べる。
// 近道（検索欄の上。候補の欄で隠れないように）：この期間に訪問がある人／〈スタッフ〉が担当する人／最近選んだ人（画面の状態に最大10人）／
// 仮押さえの人（tentativeShortcut のときだけ。月間）。
// 1人（月間の表示）と複数（週間の時間軸）の両方で使う。週間の表と〈利用者さん〉の画面の一覧は ClientFilter で絞り込む（PRD D108）
import { Search, X } from 'lucide-react';
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Client } from '../contracts/documents';
import { colorOf, initialOf } from '../lib/colors';
import { chooseAllLabel, countAmong, defaultStaffOf, searchClients } from '../lib/search';
import { PersonButton } from './PersonPopover';
import { TentativeMark } from './parts';
import './clientPicker.css';

/** 候補の上限（PRD D61） */
export const PICKER_LIMIT = 10;
/** 「最近選んだ人」の上限（画面の状態） */
export const RECENT_LIMIT = 10;

type Shortcut = 'period' | 'staff' | 'recent' | 'tentative';

export type ClientPickerProps = {
  /** 候補にする〈利用者さん〉。この順で候補を並べる（呼ぶ側で利用中に絞って並べておく） */
  clients: readonly Client[];
  /** 選んでいる〈利用者さん〉の ID（この順でチップを並べる）。clients にいない ID は出さない */
  selected: readonly string[];
  /**
   * 選び直したとき。新しい選択の ID の配列（選んだ順）。
   * 1人のとき（multiple が false）は 0件（チップの × で外した）か 1件
   */
  onChange: (ids: string[]) => void;
  /** 複数選ぶ（週間・〈利用者さん〉の画面）。既定 false＝1人（選ぶと入れ替わり、候補を閉じる） */
  multiple?: boolean;
  /**
   * 選べる人数の上限（multiple のときだけ）。上限を超える選択（1人・近道のまとめて選ぶ）はせず、maxMessage を出す
   * 例：週間の時間軸は 8（PRD D62）
   */
  max?: number;
  /** 上限を超えたときの文。既定「{max}人まで選べます」 */
  maxMessage?: string;
  /** 検索欄のラベル（画面に出す。例「〈利用者さん〉」） */
  label: string;
  /** 検索欄の薄い文字。既定「名前・よみで探す」 */
  placeholder?: string;
  /**
   * 近道「この〈期間〉に訪問がある人」。label は「この週」「この月」、clientIds はその期間に（取り消しでない）訪問がある人。
   * 渡さなければ出さない
   */
  period?: { label: string; clientIds: ReadonlySet<string> };
  /**
   * 近道「〈スタッフ〉が担当する人」。staffLabel は呼び方（org.terms.staff）、staff は選べる〈スタッフ〉、
   * clientIdsOf はその人が担当する〈利用者さん〉の ID（呼ぶ側で決める。例：期間の案の担当・いつもの担当）。渡さなければ出さない
   */
  byStaff?: {
    staffLabel: string;
    staff: readonly { id: string; name: string }[];
    clientIdsOf: (staffId: string) => ReadonlySet<string>;
  };
  /** 近道「仮押さえの人」を出す（月間。週間の時間軸では出さない。PRD D111・D112） */
  tentativeShortcut?: boolean;
  /** 選んだ人のチップの名前を押すと詳細の吹き出しを出す（週間の時間軸。PRD D123） */
  details?: boolean;
  /** 部品の外枠の data-testid（候補は `${testId}-option`、チップは `${testId}-chip`） */
  testId?: string;
};

/**
 * 〈利用者さん〉の検索欄（combobox）。近道は候補を絞る切り替え（押すと候補が開く。もう一度押すと外れる）で、
 * 複数のときは近道で絞った人を「あと N人を選ぶ」（N＝足す人数）でまとめて選べる。
 * 上限を超えるときはボタンを残したまま押せなくし、理由の文を添える。
 * キーボード：↓↑で候補を移る、Enter で選ぶ（複数のときは選んでいる人を外す）、Esc で閉じる（閉じていれば文字を消す）、
 * 文字が空で Backspace は最後のチップを外す（複数のとき）
 */
export function ClientPicker({
  clients,
  selected,
  onChange,
  multiple = false,
  max,
  maxMessage,
  label,
  placeholder = '名前・よみで探す',
  period,
  byStaff,
  tentativeShortcut = false,
  details = false,
  testId = 'client-picker',
}: ClientPickerProps) {
  const uid = useId();
  const inputId = `${uid}-input`;
  const listId = `${uid}-list`;
  const optId = (id: string) => `${uid}-opt-${id}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [shortcut, setShortcut] = useState<Shortcut | null>(null);
  /** 近道で選んだ〈スタッフ〉（null＝まだ選んでいない。担当する人がいる最初の人を使う） */
  const [pickedStaff, setPickedStaff] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const byId = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const chosen = useMemo(() => selected.flatMap((id) => byId.get(id) ?? []), [selected, byId]);
  const isSelected = (id: string) => selected.includes(id);
  const tentativeCount = useMemo(() => clients.filter((c) => c.tentative).length, [clients]);
  /** 〈スタッフ〉ごとの、候補の中で担当する人の数（select に出す） */
  const staffCount = useMemo(
    () => new Map(byStaff ? byStaff.staff.map((s) => [s.id, countAmong(byStaff.clientIdsOf(s.id), clients)]) : []),
    [byStaff, clients],
  );
  const staffId =
    pickedStaff !== null && byStaff?.staff.some((s) => s.id === pickedStaff)
      ? pickedStaff
      : defaultStaffOf(byStaff?.staff ?? [], (id) => staffCount.get(id) ?? 0);
  const staffSet = useMemo(() => (byStaff && staffId ? byStaff.clientIdsOf(staffId) : null), [byStaff, staffId]);
  const periodCount = useMemo(() => (period ? countAmong(period.clientIds, clients) : 0), [period, clients]);

  /** 近道で絞った人（近道なしなら全員） */
  const base = useMemo(() => {
    switch (shortcut) {
      case 'period':
        return period ? clients.filter((c) => period.clientIds.has(c.id)) : clients;
      case 'staff':
        return staffSet ? clients.filter((c) => staffSet.has(c.id)) : [];
      case 'recent':
        return recent.flatMap((id) => byId.get(id) ?? []);
      case 'tentative':
        return clients.filter((c) => c.tentative);
      default:
        return clients;
    }
  }, [shortcut, clients, period, staffSet, recent, byId]);
  const found = useMemo(() => searchClients(base, query, PICKER_LIMIT), [base, query]);
  const options = found.list;

  // 候補が変わったら先頭を指す
  // biome-ignore lint/correctness/useExhaustiveDependencies: 候補の並びが変わったときだけ
  useEffect(() => {
    setActive(0);
  }, [options.map((c) => c.id).join(',')]);

  // 上限が変わったら（週間の時間軸 ⇄ 表）上限の文を消す
  // biome-ignore lint/correctness/useExhaustiveDependencies: 上限が変わったときだけ
  useEffect(() => {
    setMessage(null);
  }, [max]);

  const setQ = setQuery;
  const remember = (id: string) => setRecent((r) => [id, ...r.filter((x) => x !== id)].slice(0, RECENT_LIMIT));
  const overText = maxMessage ?? `${max}人まで選べます`;

  const choose = (c: Client) => {
    setMessage(null);
    if (!multiple) {
      onChange([c.id]);
      remember(c.id);
      setQ('');
      setOpen(false);
      return;
    }
    if (isSelected(c.id)) {
      onChange(selected.filter((x) => x !== c.id));
      return;
    }
    if (max !== undefined && selected.length >= max) {
      setMessage(overText);
      return;
    }
    onChange([...selected, c.id]);
    remember(c.id);
  };
  const unselect = (id: string) => {
    setMessage(null);
    onChange(selected.filter((x) => x !== id));
  };
  /** まとめて選ぶと足される人（選んでいない人） */
  const toAdd = base.filter((c) => !isSelected(c.id)).length;
  /** まとめて選ぶと上限（max）を超えるか（超えるときはボタンを残したまま押せなくして理由を添える） */
  const overAll = max !== undefined && selected.length + toAdd > max;
  const chooseAllNoteId = `${uid}-choose-all-note`;
  /** 近道で絞った人をまとめて選ぶ（複数のとき。上限を超えるなら選ばない） */
  const chooseAll = () => {
    const add = base.map((c) => c.id).filter((id) => !isSelected(id));
    if (overAll) return;
    setMessage(null);
    onChange([...selected, ...add]);
    // まとめて選んだら候補の欄は閉じる（開いたままだと下の表・時間軸を隠す）
    setOpen(false);
    setRecent((r) => [...add, ...r.filter((x) => !add.includes(x))].slice(0, RECENT_LIMIT));
  };
  const toggleShortcut = (s: Shortcut) => {
    setShortcut((cur) => (cur === s ? null : s));
    setOpen(true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // 日本語入力の変換中は、Enter・↑↓を変換の操作に譲る（候補を選ばない）
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (options.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + options.length) % options.length);
    } else if (e.key === 'Enter') {
      if (!open) return;
      const c = options[active];
      if (c) {
        e.preventDefault();
        choose(c);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      } else if (query !== '') {
        e.preventDefault();
        setQ('');
      }
    } else if (e.key === 'Backspace' && query === '' && multiple && selected.length > 0) {
      unselect(selected[selected.length - 1]!);
    }
  };

  // 候補の中の指している人を見えるところへ（開いた・指す人が変わったときだけ。
  // 毎回の再描画で行うと、開いたままページを動かしたときに画面が引き戻される）
  const activeId = open ? options[active]?.id : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 指している人が変わったときだけ
  useEffect(() => {
    if (activeId) document.getElementById(optId(activeId))?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const activeOpt = open ? options[active] : undefined;
  /** 候補が0人のときの文（近道で絞って0人なら、その理由） */
  const emptyText = () => {
    if (query === '' && shortcut === 'recent') return 'まだ選んだ人がいません';
    if (query === '' && shortcut === 'staff' && byStaff) {
      const name = byStaff.staff.find((s) => s.id === staffId)?.name ?? '';
      return `${name}さんが担当する人はいません`;
    }
    if (query === '' && shortcut === 'period' && period) return `${period.label}に訪問がある人はいません`;
    return '見つかりません';
  };
  const shortcutBtn = (s: Shortcut, text: string, count: number | null) => (
    <button
      type="button"
      className={`client-picker-shortcut${shortcut === s ? ' is-on' : ''}`}
      aria-pressed={shortcut === s}
      onClick={() => toggleShortcut(s)}
      data-testid={`${testId}-shortcut-${s}`}
    >
      {text}
      {count !== null && <span className="client-picker-count">{count}</span>}
    </button>
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 部品の外へフォーカスが出たら候補を閉じるだけ（操作は中の要素で）
    <div
      ref={rootRef}
      className="client-picker"
      data-testid={testId}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <label className="client-picker-label" htmlFor={inputId}>
        {label}
      </label>
      {chosen.length > 0 && (
        <ul className="client-picker-chips" aria-label={`選んでいる${label}`}>
          {chosen.map((c) => (
            <li key={c.id} className="client-picker-chip" data-testid={`${testId}-chip`} data-id={c.id}>
              <span className="dot dot-xs" style={{ background: colorOf(c.color) }} aria-hidden="true">
                {initialOf(c.displayName)}
              </span>
              {details ? <PersonButton kind="client" id={c.id} name={c.displayName} /> : <span>{c.displayName}</span>}
              {c.tentative && <TentativeMark />}
              <button
                type="button"
                className="client-picker-remove"
                aria-label={`${c.displayName}を外す`}
                onClick={() => unselect(c.id)}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
          {multiple && chosen.length >= 2 && (
            <li>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  setMessage(null);
                  onChange([]);
                }}
                data-testid={`${testId}-clear`}
              >
                全部外す
              </button>
            </li>
          )}
        </ul>
      )}
      <fieldset className="client-picker-shortcuts">
        <legend className="sr-only">近道</legend>
        {period && shortcutBtn('period', `${period.label}に訪問がある人`, periodCount)}
        {byStaff && byStaff.staff.length > 0 && (
          <span className="client-picker-staff">
            {shortcutBtn('staff', `${byStaff.staffLabel}が担当する人`, null)}
            {shortcut === 'staff' && (
              <select
                aria-label={`担当する${byStaff.staffLabel}`}
                value={staffId}
                onChange={(e) => {
                  setPickedStaff(e.target.value);
                  setOpen(true);
                }}
                data-testid={`${testId}-staff`}
              >
                {byStaff.staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}（{staffCount.get(s.id) ?? 0}人）
                  </option>
                ))}
              </select>
            )}
          </span>
        )}
        {shortcutBtn('recent', '最近選んだ人', recent.length)}
        {tentativeShortcut && tentativeCount > 0 && shortcutBtn('tentative', '仮押さえの人', tentativeCount)}
        {multiple && shortcut !== null && toAdd > 0 && (
          <button
            type="button"
            className="btn btn-small"
            aria-disabled={overAll || undefined}
            aria-describedby={overAll ? chooseAllNoteId : undefined}
            onClick={chooseAll}
            data-testid={`${testId}-choose-all`}
          >
            {chooseAllLabel(toAdd)}
          </button>
        )}
        {multiple && shortcut !== null && toAdd > 0 && overAll && (max === undefined || selected.length <= max) && (
          <small id={chooseAllNoteId} className="client-picker-over" data-testid={`${testId}-choose-all-note`}>
            {overText}
          </small>
        )}
      </fieldset>
      <div className="client-picker-box">
        <Search size={14} className="client-picker-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOpt ? optId(activeOpt.id) : undefined}
          autoComplete="off"
          value={query}
          placeholder={placeholder}
          maxLength={50}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          data-testid={`${testId}-input`}
        />
        <div className="client-picker-pop" hidden={!open}>
          <div
            id={listId}
            role="listbox"
            aria-label={`${label}の候補`}
            aria-multiselectable={multiple || undefined}
            className="client-picker-list"
          >
            {options.map((c, i) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: キーボードは検索欄の↑↓・Enter で選ぶ（combobox。フォーカスは検索欄のまま）
              <div
                key={c.id}
                id={optId(c.id)}
                role="option"
                tabIndex={-1}
                aria-selected={isSelected(c.id)}
                className={`client-picker-option${i === active ? ' is-active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(c)}
                data-testid={`${testId}-option`}
                data-id={c.id}
              >
                <span className="client-picker-check" aria-hidden="true">
                  {isSelected(c.id) ? '✓' : ''}
                </span>
                <span className="dot dot-xs" style={{ background: colorOf(c.color) }} aria-hidden="true">
                  {initialOf(c.displayName)}
                </span>
                <span className="client-picker-name">{c.displayName}</span>
                {c.kana && <small className="client-picker-kana">{c.kana}</small>}
                {c.tentative && <TentativeMark />}
              </div>
            ))}
          </div>
          {options.length === 0 && (
            <p className="client-picker-note" data-testid={`${testId}-empty`}>
              {emptyText()}
            </p>
          )}
          {found.rest > 0 && (
            <p className="client-picker-note">ほか {found.rest}人。名前・よみを入れて絞り込んでください</p>
          )}
        </div>
      </div>
      <output className="client-picker-message" data-testid={`${testId}-message`}>
        {message}
      </output>
    </div>
  );
}
