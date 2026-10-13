import {
  Ban,
  CalendarDays,
  Car,
  Clock,
  Copy,
  Gauge,
  Map as MapIcon,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  UserX,
} from 'lucide-react';
import { type DragEvent, useEffect, useMemo, useState } from 'react';
import { useDay } from '../app/day';
import { ClientName } from '../components/parts';
import { type MapLine, type MapPoint, RouteMap } from '../components/RouteMap';
import { useToast } from '../components/Toast';
import { Empty, Hint, IconButton, PageHeader, SectionTitle, Stat, WithIcon } from '../components/ui';
import type { Visit } from '../contracts/documents';
import type { PlanScore } from '../contracts/problem';
import { slotsText } from '../domain/availability';
import {
  assign,
  type Cols,
  hhmm,
  isRed,
  NONE,
  reconcile,
  type Slotted,
  timeOrder,
  timesOf,
  type View,
  WARNING_LABELS,
  type Warning,
  warningsOf,
  windowText,
} from '../domain/scheduleModel';
import { addDays } from '../domain/time';
import { score } from '../evaluate';
import { colorOf, initialOf } from '../lib/colors';
import { attempt, hasLocation, newId, r0, staffColor } from '../lib/common';
import { routesOf, useDayModel } from '../lib/useDayModel';
import './schedule.css';
import { VisitForm } from './VisitForm';

/**
 * 予定＝その日の訪問と手作業案（担当の割当）。PoC本体 schedule/SchedulePage.tsx を写した。
 * 上の一覧で担当を選ぶか、下の担当ごとの列のあいだで訪問をドラッグして移す（保存するまでは下書き）。
 * 回る順番は開始時刻の順（PRD D4）。時間の重なり・稼働時間外・必須の条件の違反は赤い枠で知らせ、保存は止めない
 */
export default function SchedulePage() {
  const { date } = useDay();
  const m = useDayModel(date);
  const { data, update, staff, clients, staffById, clientById, colorOfStaff, visits, visitById, slotsOf } = m;
  const terms = data.org.terms;
  const toast = useToast();
  const [draft, setDraft] = useState<Cols | null>(null);
  /** 開いている入力欄（null：閉じている、'new'：足す、それ以外：直す訪問の ID） */
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 日付を変えたら編集中の内容を捨てる
  useEffect(() => {
    setDraft(null);
    setEditing(null);
    setError(null);
  }, [date]);

  const view = useMemo(
    () =>
      draft
        ? reconcile(
            draft,
            visits,
            staff.map((s) => s.id),
          )
        : m.savedView,
    [draft, m.savedView, visits, staff],
  );
  const setView = (v: View) => setDraft({ ...v.cols, [NONE]: v.unassigned });
  const ownerOf = useMemo(() => {
    const o = new Map<string, string>();
    for (const [s, ids] of Object.entries(view.cols)) for (const id of ids) o.set(id, s);
    return o;
  }, [view]);

  const times = useMemo(() => {
    const t = new Map<string, Slotted>();
    for (const [sid, ids] of Object.entries(view.cols))
      for (const [id, x] of timesOf(ids, visitById, slotsOf.get(sid)?.slots)) t.set(id, x);
    return t;
  }, [view, visitById, slotsOf]);

  // 手作業案の採点（AI案と同じ物差し）。必須の条件の違反は訪問カードの印に使う
  const scored = useMemo(
    () => (m.problem ? attempt(() => score(m.problem!, routesOf(view.cols))) : null),
    [m.problem, view],
  );
  const planScore: PlanScore | null = scored?.value ?? null;
  const hardOf = useMemo(() => {
    const h = new Map<string, string[]>();
    for (const v of planScore?.hardViolations ?? []) {
      // 時刻の違反は下の warningsOf でも出るので、条件の違反（notAllowed）だけを足す
      if (v.kind !== 'notAllowed') continue;
      h.set(v.visitId, [...(h.get(v.visitId) ?? []), v.label]);
    }
    return h;
  }, [planScore]);

  const worksToday = (id: string) => (staffById.get(id)?.active ?? false) && (slotsOf.get(id)?.slots.length ?? 0) > 0;
  /** 担当に選べる人：その日に働ける人を先に、休みの人は後ろ */
  const choosable = [...staff.filter((s) => worksToday(s.id)), ...staff.filter((s) => s.active && !worksToday(s.id))];
  /** 列を出す人：在籍中の全員（働ける人が先）と、担当の訪問がある休止中の人 */
  const columns = [...choosable, ...staff.filter((s) => !s.active && (view.cols[s.id]?.length ?? 0) > 0)];
  const sortedVisits = useMemo(() => timeOrder([...visitById.keys()], visitById), [visitById]);
  const warningsFor = (id: string): Warning[] => {
    const owner = ownerOf.get(id) ?? null;
    if (!visitById.has(id) || !owner) return [];
    return warningsOf(staffById.get(owner), owner, slotsOf.get(owner)?.slots ?? [], times.get(id));
  };
  const redOf = (id: string) => isRed(warningsFor(id)) || hardOf.has(id);

  // ドラッグ：訪問を別の担当の列（か未割当）へ移す。移すと時間が重なる・稼働時間外になる列は、ドラッグ中から赤くする
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTo, setDropTo] = useState<string | null>(null);
  const dropWarning = (to: string): Warning[] => {
    if (!dragging || to === NONE || ownerOf.get(dragging) === to) return [];
    const next = assign(view, dragging, to, visitById);
    const t = timesOf(next.cols[to] ?? [], visitById, slotsOf.get(to)?.slots).get(dragging);
    return warningsOf(staffById.get(to), to, slotsOf.get(to)?.slots ?? [], t);
  };
  /** ドラッグ中の訪問をその人に移すと必須の条件を破るか（可否の表で見る） */
  const dropNotAllowed = (to: string): boolean => {
    const p = m.problem;
    if (!dragging || to === NONE || !p) return false;
    const vi = p.visits.findIndex((v) => v.id === dragging);
    const si = p.staff.findIndex((s) => s.id === to);
    if (vi < 0) return false;
    return si < 0 || p.allowed[vi]?.[si] === false;
  };
  const dropProps = (to: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dropTo !== to) setDropTo(to);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTo(null);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain') || dragging;
      setDragging(null);
      setDropTo(null);
      if (id && visitById.has(id) && (ownerOf.get(id) ?? NONE) !== to) setView(assign(view, id, to, visitById));
    },
  });
  const dragProps = (id: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData('text/plain', id);
      e.dataTransfer.effectAllowed = 'move';
      setDragging(id);
    },
    onDragEnd: () => {
      setDragging(null);
      setDropTo(null);
    },
  });

  const dirty = draft !== null;

  /** 保存先：manualPlans[date] と各訪問の staffId */
  const savePlan = () => {
    setError(null);
    const routes: Cols = {};
    for (const [k, ids] of Object.entries(view.cols)) if (ids.length > 0) routes[k] = ids;
    if (view.unassigned.length > 0) routes[NONE] = view.unassigned;
    update((d) => ({
      ...d,
      manualPlans: { ...d.manualPlans, [date]: routes },
      visits: d.visits.map((v) => {
        if (v.date !== date || v.cancelled || !visitById.has(v.id)) return v;
        const next = ownerOf.get(v.id) ?? null;
        return (v.staffId ?? null) === next ? v : { ...v, staffId: next };
      }),
    }));
    setDraft(null);
    toast('手作業案を保存しました');
  };

  const cancelVisit = (v: Visit) => {
    if (!confirm('この訪問を取り消しますか？')) return;
    update((d) => ({ ...d, visits: d.visits.map((x) => (x.id === v.id ? { ...x, cancelled: true } : x)) }));
    toast('取り消しました');
  };

  const copyFromLastWeek = () => {
    const from = addDays(date, -7);
    const src = data.visits.filter((v) => v.date === from && !v.cancelled);
    if (src.length === 0) {
      setError(`${from} にコピーできる訪問がありません`);
      return;
    }
    if (!confirm(`${from} の予定（と手作業案）を ${date} にコピーします。よろしいですか？`)) return;
    const idMap = new Map(src.map((v) => [v.id, newId('v')]));
    const copied = src.map((v) => ({ ...v, id: idMap.get(v.id) as string, date }));
    const routes: Cols = {};
    for (const [s, ids] of Object.entries(data.manualPlans[from] ?? {})) {
      const mapped = ids.map((id) => idMap.get(id)).filter((x): x is string => !!x);
      if (mapped.length > 0) routes[s] = mapped;
    }
    update((d) => ({ ...d, visits: [...d.visits, ...copied], manualPlans: { ...d.manualPlans, [date]: routes } }));
    toast(`${src.length}件コピーしました`);
  };

  // 地図：担当ごとの手作業ルート（点線、列と同じ色）
  const { points, lines } = useMemo(() => {
    const pts: MapPoint[] = [];
    const lns: MapLine[] = [];
    for (const s of staff) {
      const ids = view.cols[s.id] ?? [];
      if (ids.length === 0) continue;
      const color = colorOfStaff.get(s.id) ?? staffColor(0);
      const path: { lat: number; lng: number }[] = [];
      const home = hasLocation(s.home) ? { lat: s.home.lat, lng: s.home.lng } : null;
      if (home) {
        path.push(home);
        pts.push({ ...home, label: '家', color });
      }
      for (const id of ids) {
        const v = visitById.get(id);
        const c = v && clientById.get(v.clientId);
        if (!c || !hasLocation(c.place)) continue;
        path.push({ lat: c.place.lat, lng: c.place.lng });
        pts.push({ lat: c.place.lat, lng: c.place.lng, label: initialOf(c.displayName), color: colorOf(c.color) });
      }
      if (home && path.length > 1) path.push(home);
      lns.push({ points: path, color, dashed: true });
    }
    return { points: pts, lines: lns };
  }, [staff, view, visitById, clientById, colorOfStaff]);

  const clientCell = (v: Visit) => <ClientName client={clientById.get(v.clientId)} />;
  const editingVisit = editing && editing !== 'new' ? (visitById.get(editing) ?? null) : null;

  return (
    <div className="stack">
      <PageHeader
        icon={CalendarDays}
        title="予定"
        lead="その日の訪問と、担当の割り当て"
        actions={
          <>
            <button type="button" className="btn" onClick={() => setEditing('new')} disabled={clients.length === 0}>
              <WithIcon icon={Plus}>訪問を追加</WithIcon>
            </button>
            <button
              type="button"
              className="btn"
              onClick={copyFromLastWeek}
              disabled={visits.length > 0}
              title={visits.length > 0 ? 'この日に訪問があるときはコピーできません' : ''}
            >
              <WithIcon icon={Copy}>前の同じ曜日からコピー</WithIcon>
            </button>
          </>
        }
      />
      <ScoreSummary
        score={planScore}
        error={m.problemError ?? scored?.error ?? null}
        unassigned={view.unassigned.length}
        hasVisits={visits.length > 0}
      />
      {(clients.length === 0 || error) && (
        <div className="card stack">
          {clients.length === 0 && <p className="sub">先に{terms.client}を登録してください。</p>}
          {error && <p className="error">{error}</p>}
        </div>
      )}

      {editing && (
        <VisitForm
          key={editing}
          date={date}
          visit={editingVisit}
          clients={clients}
          onClose={() => setEditing(null)}
          onSaved={toast}
        />
      )}

      {visits.length === 0 ? (
        <div className="card">
          <Empty icon={CalendarDays}>この日の訪問はまだありません</Empty>
        </div>
      ) : (
        <>
          <div className="card stack">
            <SectionTitle
              icon={CalendarDays}
              aside={
                dirty && (
                  <span className="chip chip-warn">
                    <WithIcon icon={TriangleAlert} size={14}>
                      未保存
                    </WithIcon>
                  </span>
                )
              }
            >
              訪問の一覧（{visits.length}件）
            </SectionTitle>
            <Hint>
              訪問ごとに担当の{terms.staff}を選ぶと、下の「{terms.staff}ごとの予定」に入ります。
            </Hint>
            <div className="table-scroll">
              <table className="visit-table">
                <thead>
                  <tr>
                    <th>
                      <WithIcon icon={Clock} size={14}>
                        時間
                      </WithIcon>
                    </th>
                    <th>{terms.client}</th>
                    <th className="num">所要</th>
                    <th>担当</th>
                    <th>注意</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sortedVisits.map((id) => {
                    const v = visitById.get(id);
                    if (!v) return null;
                    const owner = ownerOf.get(id) ?? null;
                    const warnings = warningsFor(id);
                    return (
                      <tr key={id} className={owner ? '' : 'row-unassigned'}>
                        <td className="nowrap">
                          <div className="time-cell">
                            <Clock size={14} aria-hidden="true" />
                            <span className="time-main">{windowText(v)}</span>
                            {v.windowKind === 'window' && <span className="time-tag">この間に開始</span>}
                          </div>
                        </td>
                        <td>
                          {clientCell(v)}
                          {v.note && <div className="sub">{v.note}</div>}
                        </td>
                        <td className="num nowrap">{v.durationMinutes}分</td>
                        <td>
                          <select
                            className={`staff-select ${redOf(id) ? 'is-red' : ''}`}
                            value={owner ?? NONE}
                            style={{ borderLeftColor: owner ? colorOfStaff.get(owner) : 'var(--warn)' }}
                            onChange={(e) => setView(assign(view, id, e.target.value, visitById))}
                            aria-label="担当"
                          >
                            <option value={NONE}>未割当</option>
                            {choosable.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                                {worksToday(s.id) ? '' : '（休み）'}
                              </option>
                            ))}
                            {owner && !choosable.some((s) => s.id === owner) && (
                              <option value={owner}>{staffById.get(owner)?.name ?? '（不明）'}（休止中）</option>
                            )}
                          </select>
                        </td>
                        <td>
                          <WarningChips warnings={warnings} hard={hardOf.get(id)} />
                        </td>
                        <td className="nowrap">
                          <div className="actions">
                            <IconButton
                              icon={Pencil}
                              label={`${clientById.get(v.clientId)?.displayName ?? ''} ${windowText(v)}を編集`}
                              onClick={() => setEditing(id)}
                            />
                            <IconButton
                              icon={Ban}
                              label={`${clientById.get(v.clientId)?.displayName ?? ''} ${windowText(v)}を取り消す`}
                              tone="danger"
                              onClick={() => cancelVisit(v)}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card stack">
            <SectionTitle icon={Car}>{terms.staff}ごとの予定</SectionTitle>
            <Hint>
              訪問をドラッグして別の{terms.staff}へ移せます。順番は開始時刻の順です（時刻は移動時間を入れない目安）。
              時間が重なる・稼働時間外・必須の条件に合わないと赤い枠で知らせます。
            </Hint>
            <div className="route-grid">
              <div className={`route-col route-col-none ${dropTo === NONE ? 'is-drop' : ''}`} {...dropProps(NONE)}>
                <div className="spread">
                  <strong className="col-name">
                    <UserX size={16} aria-hidden="true" />
                    未割当
                  </strong>
                  <span className={`count-badge ${view.unassigned.length > 0 ? 'is-warn' : ''}`}>
                    {view.unassigned.length}件
                  </span>
                </div>
                {view.unassigned.length === 0 && <span className="sub">ここへドラッグすると未割当に戻せます</span>}
                {view.unassigned.map((id) => {
                  const v = visitById.get(id);
                  if (!v) return null;
                  return (
                    <div key={id} className={`route-item ${dragging === id ? 'is-dragging' : ''}`} {...dragProps(id)}>
                      <div className="sub nowrap item-time">
                        <Clock size={13} aria-hidden="true" />
                        {windowText(v)}（{v.durationMinutes}分）
                      </div>
                      {clientCell(v)}
                    </div>
                  );
                })}
              </div>
              {columns.map((s) => {
                const ids = view.cols[s.id] ?? [];
                const avail = slotsOf.get(s.id);
                const preview = dropTo === s.id ? dropWarning(s.id) : [];
                const notAllowed = dropTo === s.id && dropNotAllowed(s.id);
                return (
                  <div
                    key={s.id}
                    className={[
                      'route-col',
                      worksToday(s.id) ? '' : 'is-off',
                      dropTo === s.id ? 'is-drop' : '',
                      isRed(preview) || notAllowed ? 'is-red' : '',
                    ].join(' ')}
                    style={{ borderTopColor: colorOfStaff.get(s.id) }}
                    {...dropProps(s.id)}
                  >
                    <div className="spread">
                      <strong className="ellipsis">{s.name}</strong>
                      <span className="count-badge">{ids.length}件</span>
                    </div>
                    <div className="col-hours">
                      {worksToday(s.id) ? (
                        <span className="sub item-time">
                          <Clock size={13} aria-hidden="true" />
                          {slotsText(avail?.slots ?? [])}
                        </span>
                      ) : (
                        <span className="chip chip-off">{s.active ? '休み' : '休止中'}</span>
                      )}
                      {avail?.overridden && <span className="chip chip-warn">この日だけ変更</span>}
                    </div>
                    {(preview.length > 0 || notAllowed) && (
                      <div className="drop-warning">
                        ここに移すと：
                        <WarningChips warnings={preview} hard={notAllowed ? ['必須の条件に合わない'] : undefined} />
                      </div>
                    )}
                    {ids.map((id) => {
                      const v = visitById.get(id);
                      const t = times.get(id);
                      if (!v) return null;
                      const warnings = warningsFor(id);
                      const red = redOf(id);
                      return (
                        <div
                          key={id}
                          className={`route-item ${red ? 'is-red' : ''} ${dragging === id ? 'is-dragging' : ''}`}
                          {...dragProps(id)}
                        >
                          <div className={`sub nowrap item-time ${isRed(warnings) ? 'red-text' : ''}`}>
                            <Clock size={13} aria-hidden="true" />
                            {t ? `${hhmm(t.start)}〜${hhmm(t.end)}` : v.earliestStart}
                          </div>
                          {clientCell(v)}
                          {red && <WarningChips warnings={warnings} hard={hardOf.get(id)} />}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {lines.length > 0 && (
            <div className="card stack">
              <SectionTitle icon={MapIcon}>手作業案の地図</SectionTitle>
              <Hint>点線は{terms.staff}ごとのルート、「家」は自宅です。</Hint>
              <RouteMap points={points} lines={lines} height={460} />
              <div className="row sub" style={{ flexWrap: 'wrap' }}>
                {columns
                  .filter((s) => (view.cols[s.id]?.length ?? 0) > 0)
                  .map((s) => (
                    <span key={s.id} className="nowrap">
                      <span style={{ color: colorOfStaff.get(s.id) }}>━</span> {s.name}
                    </span>
                  ))}
              </div>
            </div>
          )}

          <div className="savebar">
            <span className={`grow savebar-state ${dirty ? 'is-dirty' : ''}`}>
              {dirty ? (
                <WithIcon icon={TriangleAlert}>未保存の変更があります</WithIcon>
              ) : (
                <WithIcon icon={ShieldCheck}>保存済み</WithIcon>
              )}
              <span className="sub savebar-note">保存すると、各訪問の担当もこのとおりに変わります</span>
            </span>
            {dirty && (
              <button type="button" className="btn" onClick={() => setDraft(null)}>
                <WithIcon icon={RotateCcw}>変更を戻す</WithIcon>
              </button>
            )}
            <button type="button" className="btn btn-primary" disabled={!dirty} onClick={savePlan}>
              <WithIcon icon={Save}>手作業案を保存</WithIcon>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** 採点（合計点・移動・必須の違反・未割当）をタイルで並べる */
function ScoreSummary({
  score: s,
  error,
  unassigned,
  hasVisits,
}: {
  score: PlanScore | null;
  error: string | null;
  unassigned: number;
  hasVisits: boolean;
}) {
  if (!s)
    return (
      <div className="stack" style={{ gap: 8 }}>
        {error && <p className="sub">採点できません（{error}）</p>}
        {hasVisits && (
          <div className="stat-row">
            <Stat icon={UserX} label="未割当" value={unassigned} unit="件" tone={unassigned > 0 ? 'warn' : 'ok'} />
          </div>
        )}
      </div>
    );
  const hard = s.hardViolations.length;
  return (
    <div className="stat-row">
      <Stat icon={Gauge} label="手作業案の合計" value={r0(s.total)} unit="点" tone="primary" />
      <Stat icon={Car} label="移動" value={r0(s.travelMinutes)} unit="分" />
      <Stat
        icon={hard > 0 ? ShieldAlert : ShieldCheck}
        label="必須の違反"
        value={hard}
        unit="件"
        tone={hard > 0 ? 'danger' : 'ok'}
      />
      {hasVisits && (
        <Stat icon={UserX} label="未割当" value={unassigned} unit="件" tone={unassigned > 0 ? 'warn' : 'ok'} />
      )}
    </div>
  );
}

function WarningChips({ warnings, hard }: { warnings: Warning[]; hard?: string[] }) {
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
      {warnings.map((w) => (
        <span key={w} className="chip chip-red">
          {WARNING_LABELS[w]}
        </span>
      ))}
      {hard?.map((h) => (
        <span key={h} className="chip chip-red" title="必須の条件の違反">
          <TriangleAlert size={12} aria-hidden="true" />
          {h}
        </span>
      ))}
    </div>
  );
}
