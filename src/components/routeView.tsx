// 担当ごとの順番の部品（区間のボタン・訪問カード・地図の凡例）。予定 #/plan と比較 #/compare で共通（ADR-0009）
import { Car, Clock, Hourglass, House } from 'lucide-react';
import type { DragEvent, ReactNode } from 'react';
import type { Client } from '../contracts/documents';
import type { StopTiming } from '../contracts/problem';
import { minutesToHhmm } from '../domain/time';
import { r0 } from '../lib/common';
import { ClientName } from './parts';
import { WithIcon } from './ui';

/**
 * 訪問の前（または列の最後）の区間：「自宅から N分」「（車）N分」「自宅まで N分」と待ち。
 * 押すと地図でその区間を強調し、もう一度押すと外す
 */
export function LegLine({
  kind,
  minutes,
  wait = 0,
  on,
  onToggle,
}: {
  kind: 'fromHome' | 'drive' | 'toHome';
  minutes: number;
  wait?: number;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="leg-line">
      <button
        type="button"
        className={`leg-btn ${on ? 'is-on' : ''}`}
        aria-pressed={on}
        title={on ? '地図の区間の強調をやめる' : '地図でこの区間を強調する'}
        data-testid={kind === 'toHome' ? 'home-leg' : undefined}
        onClick={onToggle}
      >
        {kind === 'drive' ? (
          <WithIcon icon={Car} size={13}>
            {r0(minutes)}分
          </WithIcon>
        ) : (
          <WithIcon icon={House} size={13}>
            {kind === 'fromHome' ? '自宅から' : '自宅まで'} {r0(minutes)}分
          </WithIcon>
        )}
      </button>
      {wait > 0 && (
        <WithIcon icon={Hourglass} size={13}>
          待ち {r0(wait)}分
        </WithIcon>
      )}
    </div>
  );
}

/** ドラッグの元にするときの props（予定の画面） */
type DragProps = {
  draggable: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
};

/**
 * 訪問カード：来る区間（timing があれば）・時間・訪問先の名前。押すと detail（理由）を出す。
 * tone は枠の色（必須の違反・固定・B と担当が違う など）、children はカードの中の印（固定・違反・→ Bでは（担当の名前） など）
 */
export function VisitCard({
  visitId,
  timing,
  fallbackTime,
  client,
  first,
  legOn,
  onLeg,
  picked,
  onPick,
  tone,
  drag,
  dragging = false,
  detail,
  mark,
  children,
}: {
  visitId: string;
  timing: StopTiming | null;
  /** timing が無いときの時間の表示（約束の開始） */
  fallbackTime: string;
  client: Client | undefined;
  /** その人の最初の訪問（来る区間を「自宅から」にする） */
  first: boolean;
  legOn: boolean;
  onLeg: () => void;
  picked: boolean;
  onPick: () => void;
  tone?: 'red' | 'pinned' | 'moved' | null;
  drag?: DragProps;
  dragging?: boolean;
  detail: ReactNode;
  /** 名前の横に出す小さな印（訪問の種類。ADR-0012） */
  mark?: ReactNode;
  children?: ReactNode;
}) {
  const t = timing;
  return (
    <div>
      {t && (
        <LegLine kind={first ? 'fromHome' : 'drive'} minutes={t.travelIn} wait={t.wait} on={legOn} onToggle={onLeg} />
      )}
      <div
        className={[
          'route-item',
          tone ? `is-${tone}` : '',
          picked ? 'is-picked' : '',
          dragging ? 'is-dragging' : '',
          drag ? '' : 'is-static',
        ].join(' ')}
        data-visit={visitId}
        {...drag}
      >
        {/* ボタン要素の上からはドラッグが始まらない（Chrome）ので、押す所は div にしてキーボードでも開けるようにする */}
        {/* biome-ignore lint/a11y/useSemanticElements: ドラッグの元にするため button にしない */}
        <div
          role="button"
          tabIndex={0}
          className="route-btn plain-btn"
          aria-pressed={picked}
          onClick={onPick}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              onPick();
            }
          }}
          title={drag ? '押すと理由を見られます。ドラッグで別の担当へ移せます' : '押すと理由を見られます'}
        >
          <span className="visit-time">
            <Clock size={13} strokeWidth={2.2} aria-hidden="true" />
            {t ? `${minutesToHhmm(t.start)}〜${minutesToHhmm(t.end)}` : fallbackTime}
          </span>
          <ClientName client={client} />
          {mark}
        </div>
        {children}
      </div>
      {picked && detail}
    </div>
  );
}

/** 地図の下の凡例：担当を押すとその人だけを地図に出す（もう一度で全員）。extra は「家」や A・B の線の説明 */
export function StaffLegend({
  staffIds,
  staffName,
  colorOfStaff,
  focusStaff,
  onFocus,
  extra,
}: {
  staffIds: string[];
  staffName: (id: string) => string;
  colorOfStaff: Map<string, string>;
  focusStaff: string | null;
  onFocus: (id: string | null) => void;
  extra?: ReactNode;
}) {
  return (
    <div className="row sub" style={{ flexWrap: 'wrap' }}>
      {staffIds.map((sid) => (
        <button
          key={sid}
          type="button"
          className={`nowrap legend-item legend-btn ${focusStaff === sid ? 'is-on' : ''}`}
          aria-pressed={focusStaff === sid}
          onClick={() => onFocus(focusStaff === sid ? null : sid)}
        >
          <span className="legend-line" style={{ background: colorOfStaff.get(sid) }} aria-hidden="true" />
          {staffName(sid)}
        </button>
      ))}
      {extra}
    </div>
  );
}
