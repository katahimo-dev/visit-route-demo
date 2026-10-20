import { Suspense } from 'react';
import { lazyComponent } from '../lib/lazyComponent';

/**
 * 地図（国土地理院の淡色地図。APIキー不要）。
 * 線は順番どおりに結ぶ。dashed は点線（比較の A）、実線は今の案・比較の B。
 * 本体（Leaflet）は別のチャンク（LeafletMap）で、地図を出すときに読む（PRD D248。ADR-0039）
 */
/** highlight は選んだ訪問先（大きく・輪で囲み・前に出す） */
export type MapPoint = { lat: number; lng: number; label: string; color: string; highlight?: boolean };
/**
 * highlight は選んだ区間（太く・前に出す。dashed なら点線のまま）。区間があるときは、ほかの線を薄くする。
 * bold は目立たせたい区間（欠勤の振り直しで代行に入れた訪問へ来る区間など。ADR-0011）：太く描くだけで、ほかの線は薄くしない
 */
export type MapLine = {
  points: { lat: number; lng: number }[];
  color: string;
  dashed?: boolean;
  highlight?: boolean;
  bold?: boolean;
};

export type RouteMapProps = {
  points: MapPoint[];
  lines?: MapLine[];
  height?: number;
  /** 指定すると地図をクリックした位置を返す（位置の訂正用） */
  onPick?: (p: { lat: number; lng: number }) => void;
};

const LeafletMap = lazyComponent(() => import('./LeafletMap'));

function RouteMapView(props: RouteMapProps) {
  return (
    // 読み込み中も同じ高さの枠を出す（地図が出るときに下が跳ねない）
    <Suspense
      fallback={
        <output className="map map-loading" style={{ height: props.height ?? 260 }} aria-busy="true">
          地図を読み込んでいます…
        </output>
      }
    >
      <LeafletMap {...props} />
    </Suspense>
  );
}

/** 地図（読み込み中は同じ高さの枠）。`RouteMap.preload()` で本体のチャンクを先に読む */
export const RouteMap = Object.assign(RouteMapView, { preload: LeafletMap.preload });
