// 〈利用者さん〉の絞り込みの欄（PRD D108〜D112。ADR-0021）。週間の〈利用者さん〉×曜日の表と〈利用者さん〉の画面の一覧で使う。
// 名前・よみの検索、地区（1段目＝市区、選んだ市区の2段目＝町名。どちらも複数・人数つき）、絞り込みのチップ（AND）、
// 「終了の人も出す」。中身の判定は lib/clientFilter の純粋関数。状態は呼ぶ側が持つ（週間は URL の ?cf=）
import { Search } from 'lucide-react';
import { useId, useMemo } from 'react';
import type { Client } from '../contracts/documents';
import {
  type AreaChip,
  type ClientFilterState,
  chipCounts,
  chipHelp,
  chipLabel,
  cityChips,
  FILTER_CHIPS,
  type FilterChip,
  type FilterFacts,
  filterClients,
  NO_AREA,
  resolveStaffId,
  sameFilter,
  toggleChip,
  toggleCity,
  toggleTown,
  townChips,
} from '../lib/clientFilter';
import { countAmong } from '../lib/search';
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
  /** 外枠の data-testid（チップは `${testId}-chip`、地区は `${testId}-city`・`${testId}-town`） */
  testId?: string;
};

/**
 * 絞り込みの欄。チップ・地区は押すと付け外し（aria-pressed）。押しても0人になるものは薄くして押せなくする
 * （aria-disabled。押しているものはいつでも外せる）。人数は「押したら何人になるか」
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
  testId = 'client-filter',
}: ClientFilterProps) {
  const uid = useId();
  const staffId = useMemo(() => resolveStaffId(state, staff, facts, clients), [state, staff, facts, clients]);
  const shown = useMemo(() => filterClients(clients, state, facts, staffId), [clients, state, facts, staffId]);
  const total = useMemo(
    () => clients.filter((c) => state.showEnded || c.stage !== 'ended').length,
    [clients, state.showEnded],
  );
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
  const staffCount = useMemo(
    () => new Map(staff.map((s) => [s.id, countAmong(facts.staffClientIds(s.id), clients)])),
    [staff, facts, clients],
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
    return (
      <button
        key={chip}
        type="button"
        className={`pick-chip client-filter-chip${on ? ' is-on' : ''}${empty ? ' is-empty' : ''}`}
        aria-pressed={on}
        aria-disabled={empty || undefined}
        title={`${chipHelp(chip, t)}${empty ? '（当てはまる人はいません。0人）' : ''}`}
        onClick={() => !empty && onChange(toggleChip(state, chip))}
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
              value={state.query}
              placeholder="名前・よみで探す"
              maxLength={50}
              autoComplete="off"
              onChange={(e) => onChange({ ...state, query: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && state.query !== '') {
                  e.preventDefault();
                  onChange({ ...state, query: '' });
                }
              }}
              data-testid={`${testId}-input`}
            />
          </span>
        </label>
        <label className="check client-filter-ended">
          <input
            type="checkbox"
            checked={state.showEnded}
            onChange={(e) => onChange({ ...state, showEnded: e.target.checked })}
            data-testid={`${testId}-ended`}
          />
          終了の人も出す
        </label>
        <output className="sub client-filter-total" data-testid={`${testId}-count`} aria-live="polite">
          {shown.length === total ? `${total}人` : `${shown.length}人／${total}人`}
        </output>
        {!sameFilter(state, defaults) && (
          <button
            type="button"
            className="btn btn-small"
            onClick={() => onChange(defaults)}
            data-testid={`${testId}-reset`}
          >
            絞り込みを戻す
          </button>
        )}
      </div>
      <fieldset className="pick-chips client-filter-row" data-testid={`${testId}-cities`}>
        <legend className="pick-chips-legend">地区</legend>
        {cities.map((a) => areaChip(a, state.cities.includes(a.key), () => onChange(toggleCity(state, a.key)), 'city'))}
      </fieldset>
      {towns.map(({ city, chips }) => (
        <fieldset key={city} className="pick-chips client-filter-row client-filter-towns" data-city={city}>
          <legend className="pick-chips-legend">{city}の町名</legend>
          {chips.map((a) => areaChip(a, state.towns.includes(a.key), () => onChange(toggleTown(state, a.key)), 'town'))}
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
                      onChange={(e) => onChange({ ...state, staffId: e.target.value })}
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
      </fieldset>
    </div>
  );
}
