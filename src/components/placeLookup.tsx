import { MapPin, Search, Undo2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ClientPlace, Place } from '../contracts/documents';
import {
  addressBlockReason,
  applyFoundAddress,
  busyStatus,
  type CandidateItem,
  canUndoAddress,
  failStatus,
  geoCandidates,
  type LookupBusy,
  type LookupStatus,
  nextUndoAddress,
  pinStatus,
  postalBlockReason,
  postalCandidates,
  postalInputError,
  sameQuery,
  statusClass,
} from '../lib/addressLookup';
import { hasLocation } from '../lib/common';
import { EXTERNAL_NOTICE, type GeoHit, lookupPostalCode, type PostalHit, searchAddress } from '../lib/geocode';
import { normalizePostalCode } from '../lib/postalCode';
import { useFeature } from '../lib/useFeature';
import { FieldError } from './FieldError';
import { PlacePin } from './parts';
import { WithIcon } from './ui';
import './placeLookup.css';

/** data-testid の頭（〈利用者さん〉は今までどおり client-postal など） */
export type AddressFieldId = 'client' | 'vacancy' | 'staff-home';

type AddressFieldProps<T extends Place> = {
  /** 住所と位置（型はそのまま返す） */
  value: T;
  onChange: (p: T) => void;
  /** 郵便番号の欄の値。渡さなければ部品の中だけで持つ（保存しない） */
  postalCode?: string;
  onPostalCodeChange?: (code: string) => void;
  /** data-testid の頭。既定 client */
  testId?: AddressFieldId;
  /** 郵便番号の欄の見出し。既定「郵便番号（任意）」 */
  postalLabel?: string;
  /** 注記の後ろの説明（何を送らないか）。既定「（押したときだけ。名前などほかの項目は送りません）」 */
  noticeNote?: string;
};

/**
 * 住所の入力（PRD D86〜D88・D90・D118〜D121。ADR-0016）：郵便番号・住所・「住所を探す」「地図に置く」・注記・状態・候補・地図のピン。
 * 〈利用者さん〉の編集の欄・空き状況の場所・〈スタッフ〉の自宅で共通に使う。決まり（押せない理由・住所の当て方・知らせ）は lib/addressLookup。
 * 外部の検索を呼ぶのはボタンを押したときだけ（lib/geocode）。結果は onChange で欄（保存前の入力）に入れ、保存するかは呼ぶ画面が決める
 */
export function AddressField<T extends Place>({
  value,
  onChange,
  postalCode,
  onPostalCodeChange,
  testId = 'client',
  postalLabel = '郵便番号（任意）',
  noticeNote = '（押したときだけ。名前などほかの項目は送りません）',
}: AddressFieldProps<T>) {
  const [ownPostal, setOwnPostal] = useState('');
  const postalText = postalCode ?? ownPostal;
  const [busy, setBusyState] = useState<LookupBusy>(null);
  // 連打しても1回だけ呼ぶ（描き直しを待たずに止める）
  const busyRef = useRef<LookupBusy>(null);
  const setBusy = (b: LookupBusy) => {
    busyRef.current = b;
    setBusyState(b);
  };
  const [status, setStatus] = useState<LookupStatus>(null);
  const [postalHits, setPostalHits] = useState<PostalHit[]>([]);
  const [geoHits, setGeoHits] = useState<GeoHit[]>([]);
  /**
   * 住所を探して最初に置き換える前の住所（「元に戻す」の先）。候補を選び直しても上書きせず、新しく「住所を探す」を押したときだけ消す。
   * '' は空から入れた（戻す先が空なので「元に戻す」は出さない）
   */
  const [undoAddress, setUndoAddress] = useState<string | null>(null);
  // 待っている間に入力・画面が変わっても最新の値と書き先に書く（描いたときの値に頼らない）
  const latest = useRef(value);
  latest.current = value;
  const latestPostal = useRef(postalText);
  latestPostal.current = postalText;
  const emit = useRef(onChange);
  emit.current = onChange;
  const emitPostal = useRef(onPostalCodeChange);
  emitPostal.current = onPostalCodeChange;
  const put = (p: T) => {
    latest.current = p;
    emit.current(p);
  };
  const setPostal = (code: string) => {
    latestPostal.current = code;
    if (postalCode === undefined) setOwnPostal(code);
    emitPostal.current?.(code);
  };
  const ctrl = useRef<AbortController | null>(null);
  // 欄を閉じたら呼び出しを止める
  useEffect(() => () => ctrl.current?.abort(), []);
  const ids = useId();
  const postalErrorId = `${ids}-postal-error`;
  const postalWhyId = `${ids}-postal-why`;
  const addressWhyId = `${ids}-address-why`;
  // 〈利用者さん〉は今までの data-testid（place-notice など）を残す
  const tid = (name: string, legacy: string) => (testId === 'client' ? legacy : `${testId}-${name}`);

  // 郵便番号・住所の検索（ADR-0028 の geocode）を切っていれば、検索のボタン・注記を出さない（地図のクリックで置くのは残す）
  const geocodeOn = useFeature('geocode');
  const postal = normalizePostalCode(postalText);
  const postalWhy = postalBlockReason(postalText, busy);
  const addressWhy = addressBlockReason(value.address, busy);
  const postalError = postalInputError(postalText);

  /** 欄を書き換えたら、探している途中の呼び出しを止める（古い応答で上書きしない） */
  const cancel = () => {
    if (!busyRef.current) return;
    ctrl.current?.abort();
    ctrl.current = null;
    setBusy(null);
    setStatus(null);
  };

  const begin = (what: 'postal' | 'address') => {
    ctrl.current?.abort();
    ctrl.current = new AbortController();
    setBusy(what);
    setStatus(busyStatus(what));
    return ctrl.current.signal;
  };

  /** 見つけた住所を入れる。いまの住所が見つけた住所で始まるなら（番地まで書いてあれば）そのまま。ピンは消さない */
  const putAddress = (found: string) => {
    const r = applyFoundAddress(latest.current.address, found, hasLocation(latest.current));
    if (r.replace) {
      const before = latest.current.address;
      setUndoAddress((prev) => nextUndoAddress(prev, before));
      put({ ...latest.current, address: r.address });
    }
    setStatus(r.status);
  };

  const putPin = (hit: GeoHit) => {
    put({ ...latest.current, lat: hit.lat, lng: hit.lng });
    setStatus(pinStatus(hit));
  };

  const findAddress = async () => {
    const sent = normalizePostalCode(latestPostal.current);
    if (busyRef.current || !sent) return;
    const signal = begin('postal');
    setPostalHits([]);
    setUndoAddress(null);
    const r = await lookupPostalCode(sent, { signal });
    if (signal.aborted) return;
    setBusy(null);
    // 念のため：待っている間に郵便番号が変わっていたら使わない
    if (!sameQuery('postal', sent, latestPostal.current)) {
      setStatus(null);
      return;
    }
    if (!r.ok) {
      setStatus(failStatus(r.reason, 'postal'));
      return;
    }
    // 郵便番号は7桁に直して残す
    if (latestPostal.current !== sent) setPostal(sent);
    putAddress(r.hits[0].address);
    setPostalHits(r.hits.length > 1 ? r.hits : []);
  };

  const findPin = async () => {
    const sent = latest.current.address.trim();
    if (busyRef.current || sent === '') return;
    const signal = begin('address');
    setGeoHits([]);
    const r = await searchAddress(sent, { signal });
    if (signal.aborted) return;
    setBusy(null);
    // 念のため：待っている間に住所が変わっていたら使わない
    if (!sameQuery('address', sent, latest.current.address)) {
      setStatus(null);
      return;
    }
    if (!r.ok) {
      setStatus(failStatus(r.reason, 'address'));
      return;
    }
    putPin(r.hits[0]);
    setGeoHits(r.hits.length > 1 ? r.hits : []);
  };

  return (
    <div className="stack place-lookup" data-testid={`${testId}-place`}>
      <div className="place-lookup-row">
        <label className="place-postal">
          {postalLabel}
          <input
            value={postalText}
            maxLength={16}
            inputMode="numeric"
            placeholder="例：980-0811"
            aria-invalid={postalError || undefined}
            aria-describedby={postalError ? postalErrorId : undefined}
            onChange={(e) => {
              cancel();
              setPostal(e.target.value);
            }}
            onBlur={() => {
              // 7桁にできるなら直して見せる（できなければそのまま。保存のときに止める）
              if (postal && postal !== postalText) setPostal(postal);
            }}
            data-testid={`${testId}-postal`}
          />
        </label>
        {geocodeOn && (
          <button
            type="button"
            className="btn btn-small"
            aria-disabled={postalWhy ? true : undefined}
            aria-describedby={postalWhy ? postalWhyId : undefined}
            title={postalWhy ?? '郵便番号から住所（都道府県・市区町村・町名）を探して入れます'}
            onClick={() => void findAddress()}
            data-testid={`${testId}-postal-search`}
          >
            <WithIcon icon={Search} size={14}>
              住所を探す
            </WithIcon>
          </button>
        )}
        {geocodeOn && postalWhy && (
          <span id={postalWhyId} className="sr-only">
            {postalWhy}
          </span>
        )}
      </div>
      <FieldError as="span" id={postalErrorId} testId={`${testId}-postal-error`}>
        {postalError && '郵便番号は7桁の数字で入れてください（ハイフンは有っても無くても構いません）'}
      </FieldError>
      {postalHits.length > 0 && (
        <Candidates
          label="ほかの候補（押すと住所を置き換えます）"
          items={postalCandidates(postalHits, value.address)}
          onPick={(i) => putAddress(postalHits[i].address)}
          testId={tid('postal-candidate', 'postal-candidate')}
        />
      )}
      <label>
        住所（表示用）
        <input
          value={value.address}
          maxLength={200}
          onChange={(e) => {
            cancel();
            onChange({ ...value, address: e.target.value });
          }}
          data-testid={`${testId}-address`}
        />
      </label>
      {geocodeOn && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button
            type="button"
            className="btn btn-small"
            aria-disabled={addressWhy ? true : undefined}
            aria-describedby={addressWhy ? addressWhyId : undefined}
            title={addressWhy ?? '住所から位置を探して、地図にピンを置きます'}
            onClick={() => void findPin()}
            data-testid={`${testId}-geo-search`}
          >
            <WithIcon icon={MapPin} size={14}>
              {hasLocation(value) ? '住所から置き直す' : '地図に置く'}
            </WithIcon>
          </button>
          {addressWhy && (
            <span id={addressWhyId} className="sr-only">
              {addressWhy}
            </span>
          )}
          {canUndoAddress(undoAddress) && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                put({ ...latest.current, address: undoAddress });
                setUndoAddress(null);
                setStatus(null);
              }}
              data-testid={`${testId}-address-undo`}
            >
              <WithIcon icon={Undo2} size={14}>
                住所を元に戻す
              </WithIcon>
            </button>
          )}
        </div>
      )}
      {geocodeOn && (
        <span className="sub place-notice" data-testid={tid('notice', 'place-notice')}>
          {EXTERNAL_NOTICE}
          {noticeNote}
        </span>
      )}
      <output className={statusClass(status)} data-testid={tid('status', 'place-lookup-status')}>
        {status?.text ?? ''}
      </output>
      {geoHits.length > 0 && (
        <Candidates
          label="ほかの候補（押すとピンを置き直します）"
          items={geoCandidates(geoHits, value)}
          onPick={(i) => putPin(geoHits[i])}
          testId={tid('geo-candidate', 'geo-candidate')}
        />
      )}
      <PlacePin
        value={value}
        onChange={(p) => {
          // 地図で置いた・消したら、探している途中の呼び出しを止める
          cancel();
          onChange(p);
        }}
      />
    </div>
  );
}

/**
 * 〈利用者さん〉の場所の入力（PRD D86〜D88・D90。ADR-0016）：AddressField に郵便番号（place.postalCode）を持たせたもの。
 * 保存は欄の「保存」（store の update）
 */
export function ClientPlaceEditor({ value, onChange }: { value: ClientPlace; onChange: (p: ClientPlace) => void }) {
  // 郵便番号と住所・位置を続けて書き換えても、最後の値に重ねる
  const latest = useRef(value);
  latest.current = value;
  const put = (p: ClientPlace) => {
    latest.current = p;
    onChange(p);
  };
  return (
    <AddressField
      value={value}
      onChange={(p) => put({ ...p, postalCode: latest.current.postalCode })}
      postalCode={value.postalCode}
      onPostalCodeChange={(postalCode) => put({ ...latest.current, postalCode })}
    />
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
  items: CandidateItem[];
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
