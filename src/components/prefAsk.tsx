// 手直しの記憶の確認の帯（PRD D261・D262。ADR-0043）。日の画面の「あるときだけの帯」に並べる。モーダルにせず、答えなくても操作は続けられる
// （答えなければ「今回だけ」＝記憶しない）
import { History } from 'lucide-react';
import { WithIcon } from './ui';

/** 確認する1件（手で担当を変えた訪問） */
export type PrefAskRow = { visitId: string; when: string; client: string; staff: string };

/** 「次からもこの人にしますか？」の帯。rows が空なら出さない */
export function PrefAskBand({
  rows,
  disabled,
  onYes,
  onNo,
}: {
  rows: readonly PrefAskRow[];
  disabled: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  if (rows.length === 0) return null;
  const one = rows.length === 1 ? rows[0]! : null;
  return (
    <section className="plan-band row pref-band" aria-label="手直しの記憶の確認" data-testid="pref-ask">
      <WithIcon icon={History} size={16}>
        <span className="band-text" data-testid="pref-ask-text">
          {one ? (
            `次からも ${one.when} の${one.client}様は${one.staff}さんにしますか？`
          ) : (
            <>
              手で変えた {rows.length}件を、次からもこの担当にしますか？
              <span className="pref-band-list">
                {rows.map((r) => (
                  <span key={r.visitId} className="pref-band-item">
                    {r.when} {r.client}様 → {r.staff}さん
                  </span>
                ))}
              </span>
            </>
          )}
        </span>
      </WithIcon>
      <span className="row pref-band-actions">
        <button
          type="button"
          className="btn btn-small btn-primary"
          onClick={onYes}
          disabled={disabled}
          data-testid="pref-ask-yes"
        >
          次からもこの人にする
        </button>
        <button type="button" className="btn btn-small" onClick={onNo} data-testid="pref-ask-no">
          今回だけ
        </button>
      </span>
    </section>
  );
}

/** 「来週以降の N件も変えますか？」の帯 */
export function PrefBulkBand({
  count,
  dates,
  staff,
  disabled,
  onYes,
  onNo,
}: {
  count: number;
  dates: string;
  /** 変える先（1人なら「〇〇さん」、何人かなら「それぞれの担当」） */
  staff: string;
  disabled: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <section className="plan-band row pref-band" aria-label="来週以降もまとめて変えるか" data-testid="pref-bulk">
      <WithIcon icon={History} size={16}>
        <span className="band-text" data-testid="pref-bulk-text">
          来週以降のすでに割り当てた {count}件（{dates}）も{staff}に変えますか？
        </span>
      </WithIcon>
      <span className="row pref-band-actions">
        <button
          type="button"
          className="btn btn-small btn-primary"
          onClick={onYes}
          disabled={disabled}
          data-testid="pref-bulk-yes"
        >
          まとめて変える
        </button>
        <button type="button" className="btn btn-small" onClick={onNo} data-testid="pref-bulk-no">
          変えない
        </button>
      </span>
    </section>
  );
}

/** まとめて変えた結果（変えられなかった日があるときだけ出す。閉じられる） */
export function PrefBulkResult({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <section className="plan-band is-warn row pref-band" aria-label="まとめて変えた結果" data-testid="pref-bulk-result">
      <span className="band-text" data-testid="pref-bulk-result-text">
        {text}
      </span>
      <button type="button" className="btn btn-small" onClick={onClose} data-testid="pref-bulk-result-close">
        閉じる
      </button>
    </section>
  );
}
