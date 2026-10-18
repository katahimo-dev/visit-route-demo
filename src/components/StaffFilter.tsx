// 〈スタッフ〉の列の絞り込みの欄（相性の画面。PRD D116。ADR-0022）：名前の検索と、特性のチップ（AND・人数つき）。
// 判定は lib/compatView の純粋関数。状態は呼ぶ側が持つ（URL の ?sf=）。検索の文字の扱いは ClientFilter と同じ
// （部品の中にも持ち、日本語の変換中は呼ぶ側へ渡さず確定後に、ふつうの入力は少し遅らせて渡す。外から変わったら入力欄を合わせる）
import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Staff } from '../contracts/documents';
import {
  filterStaff,
  type StaffChipDef,
  type StaffFilterState,
  sameStaffFilter,
  staffChipCounts,
  toggleStaffChip,
} from '../lib/compatView';
import { QUERY_DELAY_MS } from './ClientFilter';
import './clientFilter.css';

export function StaffFilter({
  staff,
  state,
  onChange,
  defs,
  defaults,
  staffTerm,
  testId = 'staff-filter',
}: {
  /** 候補の〈スタッフ〉（休止中の人は入れない） */
  staff: readonly Pick<Staff, 'id' | 'name' | 'traits'>[];
  state: StaffFilterState;
  onChange: (next: StaffFilterState) => void;
  /** 特性のチップ（lib/compatView の staffChipDefs） */
  defs: readonly StaffChipDef[];
  /** 「絞り込みを戻す」で戻す状態 */
  defaults: StaffFilterState;
  /** 呼び方（org.terms.staff） */
  staffTerm: string;
  testId?: string;
}) {
  const uid = useId();
  const [text, setText] = useState(state.query);
  const textRef = useRef(state.query);
  const sent = useRef(state.query);
  const composing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ state, onChange });
  latest.current = { state, onChange };
  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
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
  const send = (next: StaffFilterState) => {
    clearTimer();
    sent.current = next.query;
    latest.current.onChange(next);
  };
  const flushQuery = () => {
    if (textRef.current !== latest.current.state.query) send({ ...latest.current.state, query: textRef.current });
    else clearTimer();
  };
  const change = (next: StaffFilterState) =>
    send({ ...next, query: composing.current ? sent.current : textRef.current });

  const shown = useMemo(() => filterStaff(staff, state, defs), [staff, state, defs]);
  const counts = useMemo(() => staffChipCounts(staff, state, defs), [staff, state, defs]);

  return (
    <div className="client-filter stack" data-testid={testId}>
      <div className="row client-filter-top">
        <label className="client-filter-search" htmlFor={`${uid}-q`}>
          <span className="client-filter-label">{staffTerm}を名前で探す</span>
          <span className="client-filter-box">
            <Search size={14} className="client-filter-icon" aria-hidden="true" />
            <input
              id={`${uid}-q`}
              type="search"
              value={text}
              placeholder="名前で探す"
              maxLength={50}
              autoComplete="off"
              onChange={(e) => {
                setLocalText(e.target.value);
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
        <output className="sub client-filter-total" data-testid={`${testId}-count`} aria-live="polite">
          {shown.length === staff.length ? `${staff.length}人` : `${shown.length}人／${staff.length}人`}
        </output>
        {!sameStaffFilter({ ...state, query: text }, defaults) && (
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
      {defs.length > 0 && (
        <fieldset className="pick-chips client-filter-row" data-testid={`${testId}-chips`}>
          <legend className="pick-chips-legend">特性（すべてに当てはまる人）</legend>
          {defs.map((d) => {
            const on = state.chips.includes(d.key);
            const n = counts.get(d.key) ?? 0;
            const empty = !on && n === 0;
            return (
              <button
                key={d.key}
                type="button"
                className={`pick-chip client-filter-chip${on ? ' is-on' : ''}${empty ? ' is-empty' : ''}`}
                aria-pressed={on}
                aria-disabled={empty || undefined}
                title={empty ? `${d.label}：当てはまる人はいません（0人）` : undefined}
                onClick={() => !empty && change(toggleStaffChip(state, d.key, defs))}
                data-testid={`${testId}-chip`}
                data-key={d.key}
              >
                <span className="pick-chip-check" aria-hidden="true">
                  {on ? '✓' : ''}
                </span>
                {d.label}
                <span className="client-filter-count">
                  {n}
                  <span className="sr-only">人</span>
                </span>
              </button>
            );
          })}
        </fieldset>
      )}
    </div>
  );
}
