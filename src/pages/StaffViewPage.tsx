import { ArrowLeft, Car, Clock, Info, MapPin, Smartphone, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useDay } from '../app/day';
import { MAPS_SR_TAIL, MapsLink, VisitRouteLinks } from '../components/mapsLinks';
import { type MapPoint, RouteMap } from '../components/RouteMap';
import { StaffMark } from '../components/StaffMark';
import { Empty, WithIcon } from '../components/ui';
import { VisitRules } from '../components/VisitRules';
import { timesOf } from '../domain/scheduleModel';
import { minutesToHhmm } from '../domain/time';
import { colorOf, initialOf } from '../lib/colors';
import { AI_LINE, attempt, dateText, hasLocation, own, r0, TRAVEL_MODE_LABELS } from '../lib/common';
import { BICYCLE_NOTE, dayStops, HOME_LABEL, tripLinks } from '../lib/mapsLink';
import { useDayModel } from '../lib/useDayModel';
import { useFeature } from '../lib/useFeature';
import { scheduleRoute } from '../matching';
import './schedule.css';

/**
 * スタッフのスマホ画面風の「今日の順番」（D16。表示だけで記録はしない）。
 * その日の訪問の担当と開始の並び（版2）。まだ確定していない（伝えていない）日はそう添える
 */
export default function StaffViewPage() {
  const { staffId = '' } = useParams();
  const { date } = useDay();
  const m = useDayModel(date);
  const { data, staffById, clientById, visitById, problem, slotsOf } = m;
  const me = staffById.get(staffId);
  // 道順のリンク（ADR-0028 の mapsLink）を切っていれば、1日の全行程のリンクと注記を出さない
  const mapsOn = useFeature('mapsLink');

  /** 確定した（伝えた）日か */
  const told = !!own(data.snapshots, date);
  // 取り消し・〈利用者さん〉の休み（ADR-0013）の訪問は出さない（visitById はその日の計算に入れる候補の訪問だけ）
  const ids = useMemo(
    () => m.visits.filter((v) => v.staffId === staffId && visitById.has(v.id)).map((v) => v.id),
    [m.visits, staffId, visitById],
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
  // Google マップの全行程（自宅→訪問…→自宅。経由地が多ければ分ける。PRD D99。ADR-0018）
  const stops = me
    ? dayStops(
        me.home,
        ids.map((id) => {
          const c = clientById.get(visitById.get(id)?.clientId ?? '');
          return { label: c?.displayName ?? '（不明）', place: c?.place ?? { address: '', lat: null, lng: null } };
        }),
      )
    : [];
  // 経由地はスマホのブラウザに合わせて3件まで（tripLinks の既定）。公共交通は全行程を出さない（区間ごとのリンクだけ）
  const trip = me ? tripLinks(stops, me.travelMode) : { links: [], skipped: [], homeSkipped: false };
  const trips = trip.links;
  const terms = data.org.terms;
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
              <span className="with-staff-mark">
                <StaffMark staff={me} size="sm" />
                {me.name}さん・{dateText(date)}
              </span>
              {!told && ids.length > 0 && (
                <span className="chip chip-warn">
                  <Sparkles size={13} aria-hidden="true" />
                  まだ確定していません（変わることがあります）
                </span>
              )}
            </div>
            {points.length > 0 && <RouteMap points={points} lines={[line]} height={240} />}
            {mapsOn && trips.length > 0 && (
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }} data-testid="sv-trip">
                {trips.map((t) => {
                  const text = trips.length > 1 ? `${t.label}を開く` : '1日の全行程を開く';
                  const end = (x: string) => (x === HOME_LABEL ? x : `${x}さん`);
                  return (
                    <MapsLink
                      key={t.label}
                      href={t.href}
                      label={`${text}（${end(t.from)}から${end(t.to)}まで。経由地${t.waypoints}件。${MAPS_SR_TAIL}）`}
                      testId="maps-trip"
                    >
                      {text}
                    </MapsLink>
                  );
                })}
                {trip.skipped.length > 0 && (
                  <span className="sub" data-testid="sv-trip-skipped">
                    （場所が未登録の{terms.client}（{trip.skipped.map((x) => `${x}さん`).join('・')}
                    ）は全行程に入っていません）
                  </span>
                )}
                {trip.homeSkipped && (
                  <span className="sub">（自宅の場所が未登録のため、全行程は自宅を通りません）</span>
                )}
                {me.travelMode === 'BICYCLE' && <span className="sub">{BICYCLE_NOTE}</span>}
              </div>
            )}
            {mapsOn && me.travelMode === 'TRANSIT' && ids.length > 0 && (
              <p className="sub" data-testid="sv-transit">
                公共交通のため、1日の全行程のリンクはありません。訪問ごとの「自宅から」「前の場所から」「ここへ道案内」を使ってください。
              </p>
            )}
            <div className="card">
              {ids.length === 0 && <Empty icon={MapPin}>今日の訪問はありません</Empty>}
              {ids.map((id, i) => {
                const v = visitById.get(id);
                const prev = stops[i];
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
                        <VisitRouteLinks
                          to={c?.place}
                          toName={c?.displayName ?? '（不明）'}
                          from={prev?.place}
                          fromName={prev && i > 0 ? prev.label : HOME_LABEL}
                          mode={me.travelMode}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="sub with-icon">
              <Info size={14} aria-hidden="true" />
              移動時間は直線距離からの目安です。道順のリンクは Google マップを開くだけで、時間・距離は Google
              マップで確かめてください。記録はデモにはありません。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
