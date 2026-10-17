import { ArrowLeft, Car, Clock, Info, MapPin, Smartphone, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useDay } from '../app/day';
import { type MapPoint, RouteMap } from '../components/RouteMap';
import { Empty, WithIcon } from '../components/ui';
import { VisitRules } from '../components/VisitRules';
import { timesOf } from '../domain/scheduleModel';
import { minutesToHhmm } from '../domain/time';
import { colorOf, initialOf } from '../lib/colors';
import { AI_LINE, attempt, dateText, hasLocation, own, r0, TRAVEL_MODE_LABELS } from '../lib/common';
import { useDayModel } from '../lib/useDayModel';
import { scheduleRoute } from '../matching';
import './schedule.css';

/**
 * スタッフのスマホ画面風の「今日の順番」（D16。表示だけで記録はしない）。
 * 確定した割当（予定の画面の「この割当で確定」）があればそれを、無ければ AI案を出す
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
  // 取り消し・〈利用者さん〉の休み（ADR-0013）の訪問は出さない（visitById はその日の計算に入れる候補の訪問だけ）
  const ids = useMemo(
    () =>
      (source === 'manual' ? manualIds : source === 'ai' ? ((ai && own(ai.routes, staffId)) ?? []) : []).filter((id) =>
        visitById.has(id),
      ),
    [source, manualIds, ai, staffId, visitById],
  );

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
          <WithIcon icon={ArrowLeft} size={14}>
            管理者の画面に戻る
          </WithIcon>
        </Link>
        <span className="sub with-icon">
          <Smartphone size={14} aria-hidden="true" />
          {data.org.terms.staff}のスマホ画面（見本）
        </span>
      </div>
      <div className="phone staff-shell stack">
        {!me ? (
          <p>この{data.org.terms.staff}は見つかりません。</p>
        ) : (
          <>
            <div className="spread">
              <h2>今日の訪問順</h2>
              <span className="chip">
                <Car size={14} aria-hidden="true" />
                {TRAVEL_MODE_LABELS[me.travelMode]}
                {timing.size > 0 && [...timing.values()].some((t) => t.travel !== null) && ` 移動 約${r0(total)}分`}
              </span>
            </div>
            <div className="sv-meta sub">
              <span>
                {me.name}さん・{dateText(date)}
              </span>
              {source === 'ai' && (
                <span className="chip chip-warn">
                  <Sparkles size={13} aria-hidden="true" />
                  AI案（まだ決まっていません）
                </span>
              )}
            </div>
            {points.length > 0 && <RouteMap points={points} lines={[line]} height={240} />}
            <div className="card">
              {ids.length === 0 && <Empty icon={MapPin}>今日の訪問はありません</Empty>}
              {ids.map((id) => {
                const v = visitById.get(id);
                const c = v ? clientById.get(v.clientId) : undefined;
                const t = timing.get(id);
                return (
                  <div key={id}>
                    {t?.travel != null && (
                      <div className="leg">
                        <Car size={14} aria-hidden="true" />約{r0(t.travel)}分
                      </div>
                    )}
                    <div className="stop">
                      <span className="dot" style={{ background: colorOf(c?.color ?? 0) }}>
                        {initialOf(c?.displayName ?? '?')}
                      </span>
                      <div className="grow">
                        <div className="sv-name">{c?.displayName ?? '（不明）'}さん</div>
                        <div className="sub sv-time">
                          <Clock size={14} aria-hidden="true" />
                          {t ? `${minutesToHhmm(t.start)}〜${minutesToHhmm(t.end)}` : v?.earliestStart}
                        </div>
                        {v?.note && <div className="sub">{v.note}</div>}
                        <VisitRules client={c} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="sub with-icon">
              <Info size={14} aria-hidden="true" />
              移動時間は直線距離からの目安です。記録はデモにはありません。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
