// 予定の画面の時間軸（PRD D58。design.md §4 pages「予定の画面の時間軸」）。
// 担当ごとの列を時刻の位置で描く（縦＝07:00〜20:00。はみ出せば広げる）。列の見出し・ドラッグの受け口・印は予定の画面から受け取る
import './routeTimeline.css';
import { Car, House } from 'lucide-react';
import type { CSSProperties, DragEvent, KeyboardEvent, ReactNode } from 'react';
import { minutesToHhmm } from '../domain/time';
import { r0 } from '../lib/common';
import { backgroundOf, boxOf, hourMarks, type LegSpan, type Span, TL_PX_PER_MIN, timeRange } from '../lib/timeline';
import { EdgeScroll } from './EdgeScroll';

/**
 * 列の最小の幅（px。PRD D269）：1366px の画面で多くの列が入るよう詰める（前は 150px）。名前は折り返して切らない
 * （routeTimeline.css の .tl-head）
 */
export const TL_COL_MIN_PX = 128;

/** 時間軸の帯1つ（訪問） */
export type TimelineBand = {
  visitId: string;
  start: number;
  end: number;
  /** 利用者さんの名前 */
  name: string;
  /** 種類の色（無ければ既定の色） */
  color: string | null;
  /** 枠：赤（必須の違反）・固定 */
  tone: 'red' | 'pinned' | null;
  picked: boolean;
  dragging: boolean;
  onPick: () => void;
  /** 複数選択で選んでいる（PRD D330） */
  multi?: boolean;
  /** Shift・Ctrl（⌘）＋クリック・Shift／Ctrl＋Enter で選ぶ・外す（無ければ複数選択はしない） */
  onMulti?: () => void;
  /** キーボードで動かす（↑↓・←→・Shift+←→・Enter・Delete。PRD D333）。受けたら true（帯の既定の動きをしない） */
  onKey?: (ev: KeyboardEvent<HTMLElement>) => boolean;
  drag?: { draggable: boolean; onDragStart: (e: DragEvent) => void; onDragEnd: () => void };
  /** 帯の中の小さな印（アイコン。それぞれ title と読み上げの文を持つ） */
  marks?: ReactNode;
  /** 共通の印の種類（data-marks。週・月・人の予定表の帯と同じ判定か確かめる） */
  kinds?: string;
  /** 押したときに帯の下に出す中身（印の説明・理由） */
  detail?: ReactNode;
  /** 読み上げ・title に足す文（印の説明） */
  note?: string;
};

/** 時間軸の列1つ（担当） */
export type TimelineColumn = {
  staffId: string;
  /** 列の要素の class（予定の画面の route-col の状態：落とす先・薄い列・地図の絞り込み） */
  className: string;
  style?: CSSProperties;
  /** 落とす先の props（予定の画面の dropProps） */
  drop: {
    onDragOver: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
  /** 見出し（名前・稼働時間帯・欠勤・近道・予告） */
  header: ReactNode;
  /** 欠勤を差し引く前の稼働時間帯と、差し引いたもの（分） */
  baseSlots: Span[];
  slots: Span[];
  bands: TimelineBand[];
  /** 移動・待ち・自宅まで（lib/timeline の legsOf） */
  legs: LegSpan[];
  /** ドラッグ中の影（その人へ入れたときに strict で回れるか） */
  shadow: (Span & { ok: boolean; allowed: boolean }) | null;
  /** 訪問が無いときの文 */
  emptyText?: string;
};

/** 帯の高さの下限（px。短い訪問でも時刻と名前を読めるように） */
const MIN_BAND_PX = 26;

/**
 * 担当ごとの時間軸。列は CSS の subgrid で見出しの行と時間の行をそろえる（見出しの高さが列ごとに違っても目盛りがずれない）。
 * legOn・onLeg は区間のボタン（押すと地図でその区間を強調）
 */
export function RouteTimeline({
  columns,
  legOn,
  onLeg,
  px = TL_PX_PER_MIN,
}: {
  columns: TimelineColumn[];
  legOn: (leg: LegSpan) => boolean;
  onLeg: (leg: LegSpan) => void;
  px?: number;
}) {
  const range = timeRange(columns.flatMap((c) => [...c.baseSlots, ...c.bands, ...c.legs]));
  const height = (range.end - range.start) * px;
  const marks = hourMarks(range);
  return (
    // 横に巻ける間は右の端に影（EdgeScroll。広い画面でも出す。PRD D269）。列は名前が切れない幅まで詰める
    <EdgeScroll className="tl-scroll" edgeClass="is-tl" testId="route-timeline">
      <div
        className="tl-grid"
        style={{ gridTemplateColumns: `44px repeat(${columns.length}, minmax(${TL_COL_MIN_PX}px, 1fr))` }}
      >
        <div className="tl-corner" aria-hidden="true" />
        <div className="tl-gutter" style={{ height }} aria-hidden="true">
          {marks.map((m) => (
            <span key={m} className="tl-hour" style={{ top: (m - range.start) * px }}>
              {minutesToHhmm(m).replace(/^0/, '')}
            </span>
          ))}
        </div>
        {columns.map((c, ci) => (
          <div
            key={c.staffId}
            className={`route-col tl-col ${c.className}`}
            style={c.style}
            data-staff={c.staffId}
            {...c.drop}
          >
            <div className="tl-head">{c.header}</div>
            <div
              className="tl-body"
              style={{
                height,
                backgroundSize: `100% ${60 * px}px`,
                backgroundPositionY: `${-(range.start % 60) * px}px`,
              }}
            >
              {backgroundOf(range, c.baseSlots, c.slots).map((b) => {
                const box = boxOf(b, range, px);
                return (
                  <div
                    key={`${b.kind}-${b.start}`}
                    className={`tl-bg is-${b.kind}`}
                    style={box}
                    title={
                      b.kind === 'absent' ? `欠勤 ${minutesToHhmm(b.start)}〜${minutesToHhmm(b.end)}` : '働ける時間の外'
                    }
                  >
                    {b.kind === 'absent' && box.height >= 16 && <span className="tl-absent-label">欠勤</span>}
                  </div>
                );
              })}
              {c.bands.length === 0 && c.emptyText && <span className="tl-empty sub">{c.emptyText}</span>}
              {c.legs.map((leg) => (
                <Leg key={`${leg.kind}-${leg.visitId}`} leg={leg} range={range} px={px} on={legOn(leg)} onLeg={onLeg} />
              ))}
              {c.bands.map((b) => (
                <Band key={b.visitId} band={b} range={range} px={px} alignRight={ci >= columns.length - 1 && ci > 0} />
              ))}
              {c.shadow && (
                <div
                  className={`tl-shadow ${c.shadow.ok ? 'is-ok' : 'is-ng'}`}
                  style={boxOf(c.shadow, range, px, 12)}
                  data-testid="tl-shadow"
                >
                  {c.shadow.ok ? '入る' : c.shadow.allowed ? '入らない（時間）' : '入らない（必須の条件）'}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </EdgeScroll>
  );
}

/** 帯のあいだの区間：移動・自宅から・自宅まで は細い線とボタン、待ちは点線の枠 */
function Leg({
  leg,
  range,
  px,
  on,
  onLeg,
}: {
  leg: LegSpan;
  range: Span;
  px: number;
  on: boolean;
  onLeg: (leg: LegSpan) => void;
}) {
  const box = boxOf(leg, range, px);
  const m = r0(leg.minutes);
  if (leg.kind === 'wait') {
    return (
      <div className="tl-wait" style={box} title={`待ち ${m}分`}>
        {box.height >= 14 && <span className="tl-wait-label">待ち {m}分</span>}
      </div>
    );
  }
  const text = leg.kind === 'drive' ? `移動 ${m}分` : leg.kind === 'fromHome' ? `自宅から ${m}分` : `自宅まで ${m}分`;
  const Icon = leg.kind === 'drive' ? Car : House;
  return (
    <div className={`tl-leg is-${leg.kind}${on ? ' is-on' : ''}`} style={box}>
      <button
        type="button"
        className={`tl-leg-btn leg-btn ${on ? 'is-on' : ''}`}
        aria-pressed={on}
        title={on ? '地図の区間の強調をやめる' : '地図でこの区間を強調する'}
        data-testid={leg.kind === 'toHome' ? 'home-leg' : undefined}
        onClick={() => onLeg(leg)}
      >
        <Icon size={11} aria-hidden="true" />
        {text}
      </button>
    </div>
  );
}

/** 訪問の帯（種類の色。押すと理由、ドラッグで別の担当へ） */
function Band({
  band: b,
  range,
  px,
  alignRight,
}: {
  band: TimelineBand;
  range: Span;
  px: number;
  alignRight: boolean;
}) {
  const box = boxOf(b, range, px, MIN_BAND_PX);
  const time = `${minutesToHhmm(b.start).replace(/^0/, '')}〜${minutesToHhmm(b.end).replace(/^0/, '')}`;
  return (
    <>
      <div
        className={[
          'tl-band',
          b.tone ? `is-${b.tone}` : '',
          b.picked ? 'is-picked' : '',
          b.dragging ? 'is-dragging' : '',
          b.multi ? 'is-multi' : '',
        ].join(' ')}
        style={{ ...box, background: b.color ?? undefined }}
        data-visit={b.visitId}
        {...b.drag}
      >
        {/* ボタン要素の上からはドラッグが始まらない（Chrome）ので、押す所は div にしてキーボードでも開けるようにする */}
        {/* biome-ignore lint/a11y/useSemanticElements: ドラッグの元にするため button にしない */}
        <div
          role="button"
          tabIndex={0}
          className="tl-band-btn"
          data-size="l"
          data-marks={b.kinds}
          aria-pressed={b.picked}
          aria-label={`${time} ${b.name}${b.note ? `（${b.note}）` : ''}${b.multi ? '（選択中）' : ''}`}
          title={`${time} ${b.name}${b.note ? `\n${b.note}` : ''}\n押すと理由を見られます。ドラッグで別の担当へ移せます${b.onMulti ? '。Shift・Ctrl＋クリックで複数選べます' : ''}${b.onKey ? '。↑↓で15分・←→で1日・Shift+←→で隣の担当・Enterで詳細・Deleteで取り消し' : ''}`}
          onClick={(ev) => {
            if (b.onMulti && (ev.shiftKey || ev.ctrlKey || ev.metaKey)) {
              ev.preventDefault();
              b.onMulti();
              return;
            }
            b.onPick();
          }}
          aria-keyshortcuts={
            b.onKey ? 'ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight Enter Delete' : undefined
          }
          onKeyDown={(ev) => {
            if (b.onKey?.(ev)) return;
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              if (b.onMulti && (ev.shiftKey || ev.ctrlKey || ev.metaKey)) b.onMulti();
              else b.onPick();
            }
          }}
        >
          <span className="tl-band-line">
            <span className="tl-band-time">{time}</span>
            {b.marks && <span className="tl-band-marks">{b.marks}</span>}
          </span>
          <span className="tl-band-name">{b.name}</span>
        </div>
      </div>
      {b.picked && b.detail && (
        <div className={`tl-detail${alignRight ? ' is-right' : ''}`} style={{ top: box.top + box.height + 4 }}>
          {b.detail}
        </div>
      )}
    </>
  );
}
