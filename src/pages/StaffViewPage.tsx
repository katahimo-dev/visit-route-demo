import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useDay } from '../app/day';
import { type MapPoint, RouteMap } from '../components/RouteMap';
import { timesOf } from '../domain/scheduleModel';
import { minutesToHhmm } from '../domain/time';
import { colorOf, initialOf } from '../lib/colors';
import { AI_LINE, attempt, dateText, hasLocation, own, r0, TRAVEL_MODE_LABELS } from '../lib/common';
import { useDayModel } from '../lib/useDayModel';
import { scheduleRoute } from '../matching';

/**
 * スタッフのスマホ画面風の「今日の順番」（D16。表示だけで記録はしない）。
 * 手作業案（予定画面の割当）が決まっていればそれを、無ければ AI案を出す
 */
export default function StaffViewPage() {
  const { staffId = '' } = useParams();
  const { date } = useDay();
  const m = useDayModel(date);
  const { data, staffById, clientById, visitById, problem, slotsOf } = m;
  const me = staffById.get(staffId);

  const manualIds = own(m.savedView.cols, staffId) ?? [];
  const hasManual = Object.values(m.savedView.cols).some((ids) => ids.length > 0);
  const ai = data.aiPlans[date];
  const source: 'manual' | 'ai' | null = hasManual ? 'manual' : ai ? 'ai' : null;
  const ids = source === 'manual' ? manualIds : source === 'ai' ? ((ai && own(ai.routes, staffId)) ?? []) : [];

  // 時刻：問題があれば移動を入れた時刻（scheduleRoute）、無ければ移動を入れない目安
  const timing = useMemo(() => {
    if (problem) {
      const si = problem.staff.findIndex((s) => s.id === staffId);
      const idx = ids.map((id) => problem.visits.findIndex((v) => v.id === id)).filter((i) => i >= 0);
      if (si >= 0) {
        const r = attempt(() => scheduleRoute(problem, si, idx, 'lenient')).value;
        if (r) return new Map(r.stops.map((s) => [s.visitId, { start: s.start, end: s.end, travel: s.travelIn }]));
      }
    }
    const t = timesOf(ids, visitById, slotsOf.get(staffId)?.slots);
    return new Map([...t].map(([id, x]) => [id, { start: x.start, end: x.end, travel: null as number | null }]));
  }, [problem, staffId, ids, visitById, slotsOf]);

  const points: MapPoint[] = [];
  if (me && hasLocation(me.home)) points.push({ lat: me.home.lat, lng: me.home.lng, label: '家', color: '#f0a050' });
  for (const id of ids) {
    const c = clientById.get(visitById.get(id)?.clientId ?? '');
    if (c && hasLocation(c.place))
      points.push({ lat: c.place.lat, lng: c.place.lng, label: initialOf(c.displayName), color: colorOf(c.color) });
  }
  const line = { points: points.map(({ lat, lng }) => ({ lat, lng })), color: AI_LINE };
  const total = [...timing.values()].reduce((s, t) => s + (t.travel ?? 0), 0);

  return (
    <div className="phone-wrap">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <Link to="/staff" className="btn btn-small">
          ← 管理者の画面に戻る
        </Link>
        <span className="sub">{data.org.terms.staff}のスマホ画面（見本）</span>
      </div>
      <div className="phone staff-shell stack">
        {!me ? (
          <p>この{data.org.terms.staff}は見つかりません。</p>
        ) : (
          <>
            <div className="spread">
              <h2>今日の訪問順</h2>
              <span className="chip">
                {TRAVEL_MODE_LABELS[me.travelMode]}
                {timing.size > 0 && [...timing.values()].some((t) => t.travel !== null) && ` 移動 約${r0(total)}分`}
              </span>
            </div>
            <span className="sub">
              {me.name}さん・{dateText(date)}
              {source === 'ai' && '（AI案。まだ決まっていません）'}
            </span>
            {points.length > 0 && <RouteMap points={points} lines={[line]} height={240} />}
            <div className="card">
              {ids.length === 0 && <p>今日の訪問はありません</p>}
              {ids.map((id) => {
                const v = visitById.get(id);
                const c = v ? clientById.get(v.clientId) : undefined;
                const t = timing.get(id);
                return (
                  <div key={id}>
                    {t?.travel != null && <div className="leg">約{r0(t.travel)}分</div>}
                    <div className="stop">
                      <span className="dot" style={{ background: colorOf(c?.color ?? 0) }}>
                        {initialOf(c?.displayName ?? '?')}
                      </span>
                      <div className="grow">
                        <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{c?.displayName ?? '（不明）'}さん</div>
                        <div className="sub">
                          {t ? `${minutesToHhmm(t.start)}〜${minutesToHhmm(t.end)}` : v?.earliestStart}
                        </div>
                        {v?.note && <div className="sub">{v.note}</div>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="sub">移動時間は直線距離からの目安です。記録（はじめる・おわる）はデモにはありません。</p>
          </>
        )}
      </div>
    </div>
  );
}
