// 〈利用者さん〉の絞り込みの欄（PRD D108〜D112。ADR-0021）。週間の〈利用者さん〉×曜日の表と〈利用者さん〉の画面の一覧で使う。
// 名前・よみの検索、地区（1段目＝市区、選んだ市区の2段目＝町名。どちらも複数・人数つき）、絞り込みのチップ（AND）、
// 「終了の人も出す」。相性の画面では、画面ごとのチップ（extraChips）を足し、「終了の人も出す」を出さない（PRD D116）。中身の判定は lib/clientFilter の純粋関数。状態は呼ぶ側が持つ（週間は URL の ?cf=）。
// 検索の文字だけはこの部品の中にも持つ（日本語の変換を壊さないため。変換中は呼ぶ側へ渡さず、確定後に、
// ふつうの入力は少し遅らせて渡す。呼ぶ側の値が外から変わったら（戻るボタンなど）入力欄を合わせる）
import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Client } from '../contracts/documents';
import {
  type AreaChip,
  type ClientFilterState,
  chipCounts,
  chipHelp,
  chipLabel,
  cityChips,
  endedVisible,
  extraCounts,
  FILTER_CHIPS,
  type FilterChip,
  type FilterFacts,
  filterClients,
  NO_AREA,
  resolveStaffId,
  sameFilter,
  staffCounts,
  toggleChip,
  toggleCity,
  toggleExtra,
  toggleTown,
  townChips,
} from '../lib/clientFilter';
import './clientFilter.css';

export type ClientFilterProps = {
  /** 候補の〈利用者さん〉（終了の人も含めて渡す。「終了の人も出す」で出し分ける） */
  clients: readonly Client[];
  state: ClientFilterState;
  onChange: (next: ClientFilterState) => void;
  /** チップの判定に使う集まり（lib/clientFilter の filterFacts） */
  facts: FilterFacts;
  /** チップ「〈スタッフ〉が担当する人」で選べる〈スタッフ〉 */
  staff: readonly { id: string; name: string }[];
  /** 呼び方（org.terms） */
  terms: { client: string; staff: string };
  /** 期間の呼び方（例「この週」） */
  periodLabel: string;
  /** 「絞り込みを戻す」で戻す状態（この画面の既定） */
  defaults: ClientFilterState;
  /**
   * 画面ごとに足すチップ（PRD D116。相性の画面だけ）。判定は facts.extraTests、押している状態は state.extra。
   * 絞り込みのチップの後ろに並べる
   */
  extraChips?: readonly { key: string; label: string; help: string }[];
  /** 「終了の人も出す」を出さない（終了の人を候補に入れない画面。相性の画面） */
  hideEnded?: boolean;
  /** 外枠の data-testid（チップは `${testId}-chip`、地区は `${testId}-city`・`${testId}-town`） */
  testId?: string;
};

/** 検索の文字を呼ぶ側へ渡すまでの待ち（ミリ秒。打つたびに URL を書かない） */
export const QUERY_DELAY_MS = 300;

/**
 * 絞り込みの欄。チップ・地区は押すと付け外し（aria-pressed）。押しても0人になるものは薄くして押せなくする
 * （aria-disabled。押しているものはいつでも外せる。「〈スタッフ〉が担当する人」は0人でも押せ、select で選び直せる）。
 * 人数は「押したら何人になるか」
 */
export function ClientFilter({
  clients,
  state,
  onChange,
  facts,
  staff,
  terms,
  periodLabel,
  defaults,
  extraChips = [],
  hideEnded = false,
  testId = 'client-filter',
}: ClientFilterProps) {
  const uid = useId();
  // ---- 検索の文字（変換中は呼ぶ側へ渡さない）----
  const [text, setText] = useState(state.query);
  const textRef = useRef(state.query);
  /** 最後に呼ぶ側へ渡した文字（呼ぶ側の値がこれと違えば、外から変わった） */
  const sent = useRef(state.query);
  const composing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ state, onChange });
  latest.current = { state, onChange };
  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  // 外すときは、待っている書き込みを取り消す
  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);
  // 呼ぶ側の値が外から変わったら入力欄を合わせる（変換中は触らない）
  useEffect(() => {
    if (state.query === sent.current || composing.current) return;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    sent.current = state.query;
    textRef.current = state.query;
    setText(state.query);
  }, [state.query]);
  const setLocalText = (q: string) => {
    textRef.current = q;
    setText(q);
  };
  /** 呼ぶ側へ渡す（待っている文字の書き込みは取り消す） */
  const send = (next: ClientFilterState) => {
    clearTimer();
    sent.current = next.query;
    latest.current.onChange(next);
  };
  /** 入力欄の文字を渡す */
  const flushQuery = () => {
    if (textRef.current !== latest.current.state.query) send({ ...latest.current.state, query: textRef.current });
    else clearTimer();
  };
  /** チップなどの変更：入力欄の文字もいっしょに渡す（変換中なら渡し済みの文字のまま） */
  const change = (next: ClientFilterState) =>
    send({ ...next, query: composing.current ? sent.current : textRef.current });

  const staffId = useMemo(() => resolveStaffId(state, staff, facts, clients), [state, staff, facts, clients]);
  const shown = useMemo(() => filterClients(clients, state, facts, staffId), [clients, state, facts, staffId]);
  const total = useMemo(() => clients.filter((c) => endedVisible(c, state, facts)).length, [clients, state, facts]);
  const counts = useMemo(() => chipCounts(clients, state, facts, staffId), [clients, state, facts, staffId]);
  const cities = useMemo(() => cityChips(clients, state, facts, staffId), [clients, state, facts, staffId]);
  const towns = useMemo(
    () =>
      state.cities
        .filter((c) => c !== NO_AREA)
        .map((city) => ({ city, chips: townChips(clients, state, facts, staffId, city) }))
        .filter((x) => x.chips.length > 0),
    [clients, state, facts, staffId],
  );
  /** select の「（N人）」：その〈スタッフ〉で押したら何人になるか（チップの人数と同じ数え方） */
  const staffCount = useMemo(() => staffCounts(clients, state, facts, staff), [clients, state, facts, staff]);
  const extraKeys = useMemo(() => extraChips.map((x) => x.key), [extraChips]);
  const extraCount = useMemo(
    () => extraCounts(clients, state, facts, staffId, extraKeys),
    [clients, state, facts, staffId, extraKeys],
  );
  const t = { periodLabel, staffTerm: terms.staff };

  const areaChip = (a: AreaChip, on: boolean, toggle: () => void, kind: 'city' | 'town') => {
    const empty = !on && a.count === 0;
    return (
      <button
        key={a.key}
        type="button"
        className={`pick-chip client-filter-chip${on ? ' is-on' : ''}${empty ? ' is-empty' : ''}`}
        aria-pressed={on}
        aria-disabled={empty || undefined}
        title={empty ? `${a.label}：当てはまる人はいません（0人）` : undefined}
        onClick={() => !empty && toggle()}
        data-testid={`${testId}-${kind}`}
        data-key={a.key}
      >
        <span className="pick-chip-check" aria-hidden="true">
          {on ? '✓' : ''}
        </span>
        {a.label}
        <span className="client-filter-count">
          {a.count}
          <span className="sr-only">人</span>
        </span>
      </button>
    );
  };

  const filterChip = (chip: FilterChip) => {
    const on = state.chips.includes(chip);
    const n = counts[chip];
    const empty = !on && n === 0;
    // 「〈スタッフ〉が担当する人」は0人でも押せる（押すと select で〈スタッフ〉を選び直せる）
    const blocked = empty && chip !== 'staff';
    return (
      <button
        key={chip}
        type="button"
        className={`pick-chip client-filter-chip${on ? ' is-on' : ''}${empty ? ' is-empty' : ''}`}
        aria-pressed={on}
        aria-disabled={blocked || undefined}
        title={`${chipHelp(chip, t)}${empty ? '（当てはまる人はいません。0人）' : ''}`}
        onClick={() => !blocked && change(toggleChip(state, chip))}
        data-testid={`${testId}-chip`}
        data-chip={chip}
      >
        <span className="pick-chip-check" aria-hidden="true">
          {on ? '✓' : ''}
        </span>
        {chipLabel(chip, t)}
        <span className="client-filter-count">
          {n}
          <span className="sr-only">人</span>
        </span>
      </button>
    );
  };

  const extraChip = (x: { key: string; label: string; help: string }) => {
    const on = (state.extra ?? []).includes(x.key);
    const n = extraCount.get(x.key) ?? 0;
    const empty = !on && n === 0;
    return (
      <button
        key={x.key}
        type="button"
        className={`pick-chip client-filter-chip${on ? ' is-on' : ''}${empty ? ' is-empty' : ''}`}
        aria-pressed={on}
        aria-disabled={empty || undefined}
        title={`${x.help}${empty ? '（当てはまる人はいません。0人）' : ''}`}
        onClick={() => !empty && change(toggleExtra(state, x.key))}
        data-testid={`${testId}-chip`}
        data-chip={x.key}
      >
        <span className="pick-chip-check" aria-hidden="true">
          {on ? '✓' : ''}
        </span>
        {x.label}
        <span className="client-filter-count">
          {n}
          <span className="sr-only">人</span>
        </span>
      </button>
    );
  };

  return (
    <div className="client-filter stack" data-testid={testId}>
      <div className="row client-filter-top">
        <label className="client-filter-search" htmlFor={`${uid}-q`}>
          <span className="client-filter-label">{terms.client}を名前・よみで探す</span>
          <span className="client-filter-box">
            <Search size={14} className="client-filter-icon" aria-hidden="true" />
            <input
              id={`${uid}-q`}
              type="search"
              value={text}
              placeholder="名前・よみで探す"
              maxLength={50}
              autoComplete="off"
              onChange={(e) => {
                setLocalText(e.target.value);
                // 変換中は渡さない（確定の compositionend で渡す）。ふつうの入力は少し待ってから
                if (composing.current || (e.nativeEvent as InputEvent).isComposing) return;
                clearTimer();
                timer.current = setTimeout(flushQuery, QUERY_DELAY_MS);
              }}
              onCompositionStart={() => {
                composing.current = true;
                clearTimer();
              }}
              onCompositionEnd={(e) => {
                composing.current = false;
                setLocalText(e.currentTarget.value);
                flushQuery();
              }}
              onBlur={() => !composing.current && flushQuery()}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === 'Escape' && text !== '') {
                  e.preventDefault();
                  setLocalText('');
                  flushQuery();
                } else if (e.key === 'Enter') flushQuery();
              }}
              data-testid={`${testId}-input`}
            />
          </span>
        </label>
        {!hideEnded && (
          <label className="check client-filter-ended">
            <input
              type="checkbox"
              checked={state.showEnded}
              onChange={(e) => change({ ...state, showEnded: e.target.checked })}
              data-testid={`${testId}-ended`}
            />
            終了の人も出す
          </label>
        )}
        <output className="sub client-filter-total" data-testid={`${testId}-count`} aria-live="polite">
          {shown.length === total ? `${total}人` : `${shown.length}人／${total}人`}
        </output>
        {!sameFilter({ ...state, query: text }, defaults) && (
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              setLocalText(defaults.query);
              send(defaults);
            }}
            data-testid={`${testId}-reset`}
          >
            絞り込みを戻す
          </button>
        )}
      </div>
      <fieldset className="pick-chips client-filter-row" data-testid={`${testId}-cities`}>
        <legend className="pick-chips-legend">地区</legend>
        {cities.map((a) => areaChip(a, state.cities.includes(a.key), () => change(toggleCity(state, a.key)), 'city'))}
      </fieldset>
      {towns.map(({ city, chips }) => (
        <fieldset key={city} className="pick-chips client-filter-row client-filter-towns" data-city={city}>
          <legend className="pick-chips-legend">{city}の町名</legend>
          {chips.map((a) => areaChip(a, state.towns.includes(a.key), () => change(toggleTown(state, a.key)), 'town'))}
        </fieldset>
      ))}
      <fieldset className="pick-chips client-filter-row" data-testid={`${testId}-chips`}>
        <legend className="pick-chips-legend">絞り込み（すべてに当てはまる人）</legend>
        {FILTER_CHIPS.map((chip) =>
          chip === 'staff'
            ? staff.length > 0 && (
                <span key={chip} className="row client-filter-staff">
                  {filterChip(chip)}
                  {state.chips.includes('staff') && (
                    <select
                      aria-label={`担当する${terms.staff}`}
                      value={staffId}
                      onChange={(e) => change({ ...state, staffId: e.target.value })}
                      data-testid={`${testId}-staff`}
                    >
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}（{staffCount.get(s.id) ?? 0}人）
                        </option>
                      ))}
                    </select>
                  )}
                </span>
              )
            : filterChip(chip),
        )}
        {extraChips.map(extraChip)}
      </fieldset>
    </div>
  );
}
