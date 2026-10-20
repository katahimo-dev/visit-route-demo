// 写した元：katahimo-dev/visit-route-poc @ a46e7db web/src/components/RouteMap.tsx
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef } from 'react';
import type { MapLine, RouteMapProps } from './RouteMap';

/**
 * 地図の本体（Leaflet）。別のチャンクに分けて、地図を出すときだけ読む（PRD D248。ADR-0039）。
 * 画面からは RouteMap（読み込み中の表示つき）を使う
 */
export default function LeafletMap({ points, lines = [], height = 260, onPick }: RouteMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, zoomSnap: 0.25 }).setView(
      [38.2682, 140.8694],
      12,
    );
    L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>',
      maxZoom: 18,
    }).addTo(m);
    m.on('click', (e) => pickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const hasHighlight = lines.some((l) => l.highlight);
    // 強調する区間は最後に描いて前に出す（下に白い縁を敷いて目立たせる）
    const rank = (l: MapLine) => (l.highlight ? 2 : l.bold ? 1 : 0);
    for (const line of [...lines].sort((a, b) => rank(a) - rank(b))) {
      if (line.points.length < 2) continue;
      const latlngs = line.points.map((p) => [p.lat, p.lng] as [number, number]);
      if (line.highlight) {
        L.polyline(latlngs, { color: '#fff', weight: 12, opacity: 0.95 }).addTo(g);
        // 点線の区間（比較の A）は強調しても点線のまま
        L.polyline(latlngs, {
          color: line.color,
          weight: 7,
          opacity: 1,
          dashArray: line.dashed ? '12 10' : undefined,
        }).addTo(g);
        continue;
      }
      if (line.bold) L.polyline(latlngs, { color: '#fff', weight: 10, opacity: hasHighlight ? 0.3 : 0.9 }).addTo(g);
      L.polyline(latlngs, {
        color: line.color,
        weight: line.bold ? 7 : 4,
        dashArray: line.dashed ? '8 8' : undefined,
        opacity: hasHighlight ? 0.3 : line.bold ? 1 : 0.9,
      }).addTo(g);
    }
    for (const p of points) {
      const size = p.highlight ? 40 : 28;
      L.marker([p.lat, p.lng], {
        zIndexOffset: p.highlight ? 1000 : 0,
        icon: L.divIcon({
          className: '',
          html: `<div class="dot ${p.highlight ? 'map-pin-hl' : 'dot-sm'}" style="background:${p.color};border:2px solid #fff;box-shadow:0 1px 3px #0003">${escapeHtml(p.label)}</div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        }),
      }).addTo(g);
    }
    const all = [...points, ...lines.flatMap((l) => l.points)];
    if (all.length > 0)
      m.fitBounds(L.latLngBounds(all.map((p) => [p.lat, p.lng] as [number, number])).pad(0.1), {
        maxZoom: 15,
        animate: false,
      });
  }, [points, lines]);

  return <div ref={el} className="map" style={{ height }} />;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
