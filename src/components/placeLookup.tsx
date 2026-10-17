import { MapPin, Search, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ClientPlace } from '../contracts/documents';
import { hasLocation } from '../lib/common';
import {
  EXTERNAL_NOTICE,
  type GeoHit,
  lookupMessage,
  lookupPostalCode,
  type PostalHit,
  searchAddress,
} from '../lib/geocode';
import { normalizePostalCode } from '../lib/postalCode';
import { PlacePin } from './parts';
import { WithIcon } from './ui';
import './placeLookup.css';

type Status = { kind: 'busy' | 'ok' | 'error'; text: string } | null;

/**
 * 〈利用者さん〉の場所の入力（PRD D86〜D88・D90。ADR-0016）：郵便番号・住所・「住所を探す」「地図に置く」・注記・候補・地図のピン。
 * 外部の検索を呼ぶのはボタンを押したときだけ（lib/geocode）。結果は onChange で欄（保存前の入力）に入れ、保存は欄の「保存」（store の update）
 */
export function ClientPlaceEditor({ value, onChange }: { value: ClientPlace; onChange: (p: ClientPlace) => void }) {
  const [busy, setBusy] = useState<'postal' | 'address' | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [postalHits, setPostalHits] = useState<PostalHit[]>([]);
  const [geoHits, setGeoHits] = useState<GeoHit[]>([]);
  /**
   * 住所を探して最初に置き換える前の住所（「元に戻す」の先）。候補を選び直しても上書きせず、新しく「住所を探す」を押したときだけ消す。
   * '' は空から入れた（戻す先が空なので「元に戻す」は出さない）
   */
  const [undoAddress, setUndoAddress] = useState<string | null>(null);
  // 待っている間に入力が変わっても最新の値に書く
  const latest = useRef(value);
  latest.current = value;
  const ctrl = useRef<AbortController | null>(null);
  // 欄を閉じたら呼び出しを止める
  useEffect(() => () => ctrl.current?.abort(), []);

  const postal = normalizePostalCode(value.postalCode);
  const postalWhy = busy
    ? '探しています'
    : postal === ''
      ? '郵便番号を入れてください'
      : postal === null
        ? '郵便番号は7桁の数字で入れてください'
        : null;
  const addressWhy = busy ? '探しています' : value.address.trim() === '' ? '住所を入れてください' : null;
  const postalError = value.postalCode.trim() !== '' && postal === null;

  const begin = (what: 'postal' | 'address') => {
    ctrl.current?.abort();
    ctrl.current = new AbortController();
    setBusy(what);
    setStatus({ kind: 'busy', text: what === 'postal' ? '住所を探しています…' : '位置を探しています…' });
    return ctrl.current.signal;
  };

  /** 見つけた住所を入れる。いまの住所が見つけた住所で始まるなら（番地まで書いてあれば）そのまま */
  const putAddress = (found: string) => {
    const cur = latest.current.address.trim();
    if (cur.startsWith(found)) {
      setStatus({ kind: 'ok', text: `住所は「${found}」で始まっているので、そのままにしました` });
      return;
    }
    const before = latest.current.address;
    setUndoAddress((prev) => (prev !== null ? prev : before));
    onChange({ ...latest.current, address: found });
    setStatus({ kind: 'ok', text: `住所に「${found}」を入れました。番地を続けて書いてください` });
  };

  const putPin = (hit: GeoHit) => {
    onChange({ ...latest.current, lat: hit.lat, lng: hit.lng });
    setStatus({
      kind: 'ok',
      text: `地図に置きました${hit.title ? `（${hit.title}）` : ''}。ずれていれば「位置を消す」を押してから地図をクリックしてください`,
    });
  };

  const findAddress = async () => {
    if (postalWhy || !postal) return;
    const signal = begin('postal');
    setPostalHits([]);
    setUndoAddress(null);
    const r = await lookupPostalCode(postal, { signal });
    if (signal.aborted) return;
    setBusy(null);
    if (!r.ok) {
      setStatus({ kind: 'error', text: lookupMessage(r.reason, 'postal') });
      return;
    }
    // 郵便番号は7桁に直して残す
    if (latest.current.postalCode !== postal) latest.current = { ...latest.current, postalCode: postal };
    putAddress(r.hits[0].address);
    setPostalHits(r.hits.length > 1 ? r.hits : []);
  };

  const findPin = async () => {
    if (addressWhy) return;
    const signal = begin('address');
    setGeoHits([]);
    const r = await searchAddress(latest.current.address, { signal });
    if (signal.aborted) return;
    setBusy(null);
    if (!r.ok) {
      setStatus({ kind: 'error', text: lookupMessage(r.reason, 'address') });
      return;
    }
    putPin(r.hits[0]);
    setGeoHits(r.hits.length > 1 ? r.hits : []);
  };

  return (
    <div className="stack place-lookup" data-testid="client-place">
      <div className="place-lookup-row">
        <label className="place-postal">
          郵便番号（任意）
          <input
            value={value.postalCode}
            maxLength={10}
            inputMode="numeric"
            placeholder="例：980-0811"
            aria-invalid={postalError || undefined}
            onChange={(e) => onChange({ ...value, postalCode: e.target.value })}
            onBlur={() => {
              // 7桁にできるなら直して見せる（できなければそのまま。保存のときに止める）
              if (postal && postal !== value.postalCode) onChange({ ...value, postalCode: postal });
            }}
            data-testid="client-postal"
          />
        </label>
        <button
          type="button"
          className="btn btn-small"
          aria-disabled={postalWhy ? true : undefined}
          title={postalWhy ?? '郵便番号から住所（都道府県・市区町村・町名）を探して入れます'}
          onClick={() => void findAddress()}
          data-testid="client-postal-search"
        >
          <WithIcon icon={Search} size={14}>
            住所を探す
          </WithIcon>
        </button>
      </div>
      {postalError && (
        <span className="error">郵便番号は7桁の数字で入れてください（ハイフンは有っても無くても構いません）</span>
      )}
      {postalHits.length > 0 && (
        <Candidates
          label="ほかの候補（押すと住所を置き換えます）"
          items={postalHits.map((h) => ({ key: h.address, text: h.address, on: value.address.startsWith(h.address) }))}
          onPick={(i) => putAddress(postalHits[i].address)}
          testId="postal-candidate"
        />
      )}
      <label>
        住所（表示用）
        <input
          value={value.address}
          maxLength={200}
          onChange={(e) => onChange({ ...value, address: e.target.value })}
          data-testid="client-address"
        />
      </label>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          className="btn btn-small"
          aria-disabled={addressWhy ? true : undefined}
          title={addressWhy ?? '住所から位置を探して、地図にピンを置きます'}
          onClick={() => void findPin()}
          data-testid="client-geo-search"
        >
          <WithIcon icon={MapPin} size={14}>
            {hasLocation(value) ? '住所から置き直す' : '地図に置く'}
          </WithIcon>
        </button>
        {undoAddress !== null && undoAddress.trim() !== '' && (
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              onChange({ ...latest.current, address: undoAddress });
              setUndoAddress(null);
              setStatus(null);
            }}
            data-testid="client-address-undo"
          >
            <WithIcon icon={Undo2} size={14}>
              住所を元に戻す
            </WithIcon>
          </button>
        )}
      </div>
      <span className="sub place-notice" data-testid="place-notice">
        {EXTERNAL_NOTICE}（押したときだけ。名前などほかの項目は送りません）
      </span>
      <output
        className={`place-status${status?.kind === 'error' ? ' is-error' : status?.kind === 'ok' ? ' is-ok' : ''}`}
        data-testid="place-lookup-status"
      >
        {status?.text ?? ''}
      </output>
      {geoHits.length > 0 && (
        <Candidates
          label="ほかの候補（押すとピンを置き直します）"
          items={geoHits.map((h, i) => ({
            key: `${i}`,
            text: h.title || `${h.lat.toFixed(4)}, ${h.lng.toFixed(4)}`,
            on: value.lat === h.lat && value.lng === h.lng,
          }))}
          onPick={(i) => putPin(geoHits[i])}
          testId="geo-candidate"
        />
      )}
      <PlacePin value={value} onChange={onChange} />
    </div>
  );
}

/** 候補のボタンの並び（選んでいるものは aria-pressed） */
function Candidates({
  label,
  items,
  onPick,
  testId,
}: {
  label: string;
  items: { key: string; text: string; on: boolean }[];
  onPick: (i: number) => void;
  testId: string;
}) {
  return (
    <div className="place-candidates">
      <span className="sub">{label}</span>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {items.map((it, i) => (
          <button
            key={it.key}
            type="button"
            className={`btn btn-small place-candidate${it.on ? ' is-on' : ''}`}
            aria-pressed={it.on}
            onClick={() => onPick(i)}
            data-testid={testId}
          >
            {it.text}
          </button>
        ))}
      </div>
    </div>
  );
}
