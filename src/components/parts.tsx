import type { ReactNode } from 'react';
import type { Client, Place } from '../contracts/documents';
import { HALF_HOURS, MAX_SLOTS, type Slot, slotsError } from '../domain/availability';
import { hhmmToMinutes, minutesToHhmm } from '../domain/time';
import { colorOf, initialOf } from '../lib/colors';
import { hasLocation } from '../lib/common';
import { RouteMap } from './RouteMap';

/** 訪問先の色の丸と名前（予定・比較の画面で同じ見た目にする） */
export function ClientName({ client }: { client: Client | undefined }) {
  return (
    <div className="visit-name">
      <span className="dot dot-sm" style={{ background: colorOf(client?.color ?? 0) }}>
        {initialOf(client?.displayName ?? '?')}
      </span>
      <span className="ellipsis">{client?.displayName ?? '（不明）'}</span>
    </div>
  );
}

/**
 * 住所＋位置の入力。デモ版は住所から位置を出す機能が無いので、地図をクリックして位置を直す
 */
export function PlaceEditor({ value, onChange }: { value: Place; onChange: (p: Place) => void }) {
  return (
    <div className="stack">
      <label>
        住所（表示用）
        <input
          value={value.address}
          maxLength={200}
          onChange={(e) => onChange({ ...value, address: e.target.value })}
        />
      </label>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <span className="sub">
          {hasLocation(value) ? `位置：${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}` : '位置は未登録です'}
        </span>
        {hasLocation(value) && (
          <button type="button" className="btn btn-small" onClick={() => onChange({ ...value, lat: null, lng: null })}>
            位置を消す
          </button>
        )}
      </div>
      <span className="sub">
        {hasLocation(value)
          ? '位置を変えるときは「位置を消す」を押してから、地図をクリックしてください（うっかり動かさないため）'
          : '地図をクリックした所にピンを置きます（位置は直線距離の概算に使います）'}
      </span>
      <RouteMap
        height={220}
        points={hasLocation(value) ? [{ lat: value.lat, lng: value.lng, label: '●', color: '#e8735f' }] : []}
        onPick={hasLocation(value) ? undefined : (p) => onChange({ ...value, lat: p.lat, lng: p.lng })}
      />
    </div>
  );
}

/** 重みのスライダー（ClassClassify の Setup と同じ 0〜5・0.5刻み）。disabled は必須のとき */
export function WeightSlider({
  value,
  onChange,
  disabled = false,
  label,
}: {
  value: number;
  onChange: (w: number) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="weight">
      <input
        type="range"
        min={0}
        max={5}
        step={0.5}
        value={value}
        disabled={disabled}
        aria-label={`${label}の重み`}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="weight-value">{disabled ? '必須' : value.toFixed(1)}</span>
    </div>
  );
}

/** 選べるいちばん遅い時刻（23:30） */
const LAST = 23 * 60 + 30;

/** 働ける時間帯の入力（30分単位・最大4つ）。PoC本体 SlotEditor.tsx を写した */
export function SlotEditor({ value, onChange }: { value: Slot[]; onChange: (v: Slot[]) => void }) {
  const set = (i: number, patch: Partial<Slot>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  // 足す時間帯の初期値：前の時間帯の1時間後から3時間（なければ 9:00〜18:00）
  const add = () => {
    const last = value[value.length - 1];
    const cap = (m: number) => minutesToHhmm(Math.min(m, LAST));
    const start = last ? cap(hhmmToMinutes(last.end) + 60) : '09:00';
    const end = last ? cap(hhmmToMinutes(start) + 180) : '18:00';
    onChange([...value, { start, end }]);
  };
  const error = slotsError(value);
  return (
    <div className="stack" style={{ gap: 8 }}>
      {value.length === 0 && <p className="sub">この日は休み（働ける時間帯なし）</p>}
      {value.map((s, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 時間帯に ID は無く、行の位置がそのまま意味を持つ
        <div key={i} className="slot-row">
          <select value={s.start} onChange={(e) => set(i, { start: e.target.value })} aria-label="開始">
            {HALF_HOURS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
          <span>〜</span>
          <select value={s.end} onChange={(e) => set(i, { end: e.target.value })} aria-label="終了">
            {HALF_HOURS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            aria-label="この時間帯を削除"
          >
            削除
          </button>
        </div>
      ))}
      {value.length < MAX_SLOTS && (
        <button type="button" className="btn btn-small" style={{ alignSelf: 'flex-start' }} onClick={add}>
          ＋ 時間帯を追加
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** チェックボックスの横並び（label の縦並びの既定を打ち消す） */
export function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}
