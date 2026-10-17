import { CalendarClock, ChevronLeft, ChevronRight, Move, RefreshCw, Sparkles, TriangleAlert, X } from 'lucide-react';
import { type DragEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDay } from '../app/day';
import { PickChips, QualificationBadges } from '../components/PickChips';
import { useToast } from '../components/Toast';
import { Hint, PageHeader, SidePanel, WithIcon } from '../components/ui';
import { ViewSwitch } from '../components/ViewSwitch';
import { TypeDot } from '../components/visitType';
import type { Visit } from '../contracts/documents';
import { timeText } from '../domain/availability';
import { addDays, hhmmToMinutes, jstDate, minutesToHhmm, weekday } from '../domain/time';
import { colorOf } from '../lib/colors';
import { dateText, newId, own, WEEKDAY_LABELS } from '../lib/common';
import { typeOf } from '../lib/patternText';
import { useDayModel } from '../lib/useDayModel';
import {
  allowedStaffOf,
  type Band,
  type ClientWeekItem,
  canMoveVisit,
  changedDates,
  clientWeekTable,
  DAY_END,
  DAY_START,
  fitCountAt,
  inDayRange,
  insertIntoPlan,
  laneLayout,
  moveFollowing,
  moveOnce,
  qualificationBadges,
  qualificationItem,
  SNAP_MINUTES,
  snapMinutes,
  staffWeekTable,
  staffWithQualification,
  typeUnfit,
  type WeekDay,
  weekDates,
  weekDay,
} from '../lib/week';
import './week.css';

/**
 * 週間（ADR-0012 追記の段階2。PRD D49〜D51・D56・D57。design.md §4 pages「週間（段階2）」「月間・週間の改定（2026-10-17）」）。
 * 時間軸（月〜日 × 07:00〜20:00。訪問の帯を種類の色で。ドラッグ・キーボードで日時を動かす）と〈スタッフ〉×曜日・〈利用者さん〉×曜日の表。
 * 時間軸は〈スタッフ〉か〈利用者さん〉で見て、チップで複数選ぶ（?by=client・?staff=s1,s2・?client=。無ければ全員）。
 * データを書くのは「動かす」「空き時間に入れる」だけ（update の中で lib/week の純粋関数を呼ぶ）
 */

/** 1分あたりの高さ（px） */
const PX_PER_MIN = 0.8;
const HOURS = Array.from({ length: (DAY_END - DAY_START) / 60 + 1 }, (_, i) => DAY_START + i * 60);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const hm = (m: number) => timeText(minutesToHhmm(m));
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** URL の ?staff= ?client= の値（無ければ null） */
const paramOf = (params: URLSearchParams, key: string): string | null =>
  params.has(key) ? (params.get(key) ?? '') : null;
/** 選んだ人（null＝全員、空なら []＝だれも選ばない） */
const selectionOf = (raw: string | null): string[] | null => (raw === null ? null : raw.split(',').filter(Boolean));

/** 動かす欄の中身 */
type MoveDraft = { visitId: string; date: string; start: number; mode: 'once' | 'following' };
/** 動かしたあとの知らせ（新しい日に今の案があるとき） */
type Notice = { date: string; visitId: string; label: string; error: string | null };

export default function WeekPage() {
  const { date, setDate } = useDay();
  const { data, update, compileInput, staff, staffById, clients, clientById, colorOfStaff } = useDayModel(date);
  const terms = data.org.terms;
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const today = jstDate(Date.now());
  const rawD = params.get('d') ?? '';
  const anchor = DATE_RE.test(rawD) ? rawD : date;
  const dates = useMemo(() => weekDates(anchor), [anchor]);
  const start = dates[0]!;
  const rawView = params.get('view');
  const tab: 'timeline' | 'table' | 'clients' =
    rawView === 'table' ? 'table' : rawView === 'clients' ? 'clients' : 'timeline';
  const by: 'staff' | 'client' = params.get('by') === 'client' ? 'client' : 'staff';
  const staffParam = paramOf(params, 'staff');
  const clientParam = paramOf(params, 'client');
  const staffSel = useMemo(() => selectionOf(staffParam), [staffParam]);
  const clientSel = useMemo(() => selectionOf(clientParam), [clientParam]);
  const [draft, setDraft] = useState<MoveDraft | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [hover, setHover] = useState<{ date: string; start: number } | null>(null);
  /** つかんでいる訪問（チップの強調・「入れる人」に使う） */
  const [dragId, setDragId] = useState<string | null>(null);
  /** つかんだ帯と、帯の上端からつかんだ位置までの高さ（px）。表のマスからつかんだときは offset を使わない */
  const grab = useRef<{ visitId: string; offset: number } | null>(null);

  // ---- 選んでいる日付との同期（PRD D59）----
  // URL の ?d= で開いた日が選んでいる日付と違えば、選んでいる日付をその日にする
  // biome-ignore lint/correctness/useExhaustiveDependencies: URL の日が変わったときだけ
  useEffect(() => {
    if (DATE_RE.test(rawD) && rawD !== date) setDate(rawD);
  }, [rawD]);
  // 上の日付の切り替えで選んでいる日付が変わったら、表示する週もその日を含む週にする
  const lastDate = useRef(date);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 選んでいる日付が変わったときだけ
  useEffect(() => {
    if (lastDate.current === date) return;
    lastDate.current = date;
    if (DATE_RE.test(rawD) && rawD !== date) go({ d: date });
  }, [date]);

  const activeStaff = useMemo(() => staff.filter((s) => s.active), [staff]);
  const visitById = useMemo(() => new Map(data.visits.map((v) => [v.id, v])), [data.visits]);
  const dayInput = useMemo(
    () => ({ ...compileInput, aiPlans: data.aiPlans, manualPlans: data.manualPlans }),
    [compileInput, data.aiPlans, data.manualPlans],
  );
  const days: WeekDay[] = useMemo(() => dates.map((d) => weekDay(dayInput, d)), [dayInput, dates]);
  const dayOf = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const table = useMemo(() => (tab === 'table' ? staffWeekTable(compileInput, days) : null), [tab, compileInput, days]);
  const qualItem = useMemo(() => qualificationItem(data.items), [data.items]);
  const badgesOf = useMemo(
    () => new Map(activeStaff.map((s) => [s.id, qualificationBadges(data.items, s)])),
    [activeStaff, data.items],
  );
  /** チップに出す〈利用者さん〉：利用中の人と、休止中でもこの週に訪問がある人 */
  const weekClients = useMemo(() => {
    const inWeek = new Set(days.flatMap((d) => d.bands.map((b) => visitById.get(b.visitId)?.clientId)));
    return clients.filter((c) => c.active || inWeek.has(c.id));
  }, [clients, days, visitById]);
  const clientRows = useMemo(
    () => (tab === 'clients' ? clientWeekTable(data, days, clientSel) : null),
    [tab, data, days, clientSel],
  );

  // ---- ドラッグ中の予告（D57） ----
  /** つかんでいる訪問を担当できる人（その訪問の日の問題の可否） */
  const allowedNow = useMemo(() => {
    if (!dragId) return null;
    const v = visitById.get(dragId);
    return new Set(v ? allowedStaffOf(dayOf.get(v.date)?.problem ?? null, dragId) : []);
  }, [dragId, visitById, dayOf]);
  /** 「入れる人 N人」の memo（訪問・日・時刻ごと。データが変われば作り直す） */
  const fitCache = useMemo(() => ({ input: dayInput, memo: new Map<string, number | null>() }), [dayInput]);
  const fitCount = (visitId: string, d: string, s: number): number | null => {
    const key = `${visitId}|${d}|${s}`;
    if (!fitCache.memo.has(key)) fitCache.memo.set(key, fitCountAt(fitCache.input, visitId, d, s));
    return fitCache.memo.get(key) ?? null;
  };
  const hoverFit = dragId && hover ? fitCount(dragId, hover.date, hover.start) : null;

  const go = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    setParams(p);
  };
  /** 週を送る：選んでいる日付もその日にする（PRD D59。曜日はそのまま） */
  const goWeek = (d: string) => {
    lastDate.current = d;
    go({ d });
    setDate(d);
  };
  const setSel = (key: 'staff' | 'client', ids: string[] | null) => go({ [key]: ids === null ? null : ids.join(',') });
  const openDay = (d: string, visitId?: string) => {
    // 予定の画面へ移るので、表示する週は合わせない（合わせると ?d= を書く遷移が予定の画面への遷移を打ち消す）
    lastDate.current = d;
    setDate(d);
    navigate('/plan', visitId ? { state: { visitId } } : undefined);
  };
  const staffName = (id: string | null) => (id ? (staffById.get(id)?.name ?? '（不明）') : '未割当');
  const clientName = (v: Visit | undefined) => clientById.get(v?.clientId ?? '')?.displayName ?? '（不明）';

  // ---- 動かす ----
  const openMove = (visitId: string, d: string, s: number) => {
    const v = visitById.get(visitId);
    if (!v) return;
    setNotice(null);
    setDraft({ visitId, date: d, start: s, mode: 'once' });
  };
  const onBandKey = (e: KeyboardEvent, b: Band) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = visitById.get(b.visitId);
    if (!v) return;
    // 今日より前の訪問は動かさない
    if (!canMoveVisit(v.date, today)) {
      toast('今日より前の訪問は動かせません');
      return;
    }
    openMove(b.visitId, v.date, hhmmToMinutes(v.earliestStart));
  };
  const onDragStart = (e: DragEvent<HTMLElement>, visitId: string) => {
    e.dataTransfer.setData('text/plain', visitId);
    e.dataTransfer.effectAllowed = 'move';
    grab.current = { visitId, offset: e.clientY - e.currentTarget.getBoundingClientRect().top };
    setDragId(visitId);
  };
  const dropStart = (e: DragEvent<HTMLElement>): number | null => {
    const g = grab.current;
    if (!g) return null;
    const top = e.currentTarget.getBoundingClientRect().top;
    return snapMinutes(DAY_START + (e.clientY - top - g.offset) / PX_PER_MIN);
  };
  const onDragOver = (e: DragEvent<HTMLElement>, d: string) => {
    // 今日より前の日には落とせない（preventDefault しない）
    if (!grab.current || !canMoveVisit(d, today)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const s = dropStart(e);
    if (s !== null && (hover?.date !== d || hover.start !== s)) setHover({ date: d, start: s });
  };
  const onDrop = (e: DragEvent<HTMLElement>, d: string) => {
    e.preventDefault();
    const s = dropStart(e);
    const g = grab.current;
    grab.current = null;
    setHover(null);
    setDragId(null);
    if (!g || s === null) return;
    const v = visitById.get(g.visitId);
    if (!v || !canMoveVisit(v.date, today)) return;
    if (!canMoveVisit(d, today)) {
      toast('今日より前の日へは動かせません');
      return;
    }
    // 範囲外は戻す（何もしない）
    if (!inDayRange(s, v.durationMinutes)) {
      toast(`${hm(DAY_START)}〜${hm(DAY_END)} の中に置いてください`);
      return;
    }
    if (d === v.date && s === hhmmToMinutes(v.earliestStart)) return;
    openMove(g.visitId, d, s);
  };
  const onDragEnd = () => {
    grab.current = null;
    setHover(null);
    setDragId(null);
  };

  // ---- 〈利用者さん〉×曜日の表のドラッグ（別の日のマスへ。時刻はそのまま） ----
  /** その行（〈利用者さん〉）のその日のマスへ落とせるか */
  const canDropCell = (clientId: string, d: string): boolean => {
    const v = grab.current ? visitById.get(grab.current.visitId) : undefined;
    return !!v && v.clientId === clientId && v.date !== d && canMoveVisit(d, today);
  };
  const onCellDragOver = (e: DragEvent<HTMLElement>, clientId: string, d: string) => {
    if (!canDropCell(clientId, d)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const v = visitById.get(grab.current!.visitId)!;
    const s = hhmmToMinutes(v.earliestStart);
    if (hover?.date !== d || hover.start !== s) setHover({ date: d, start: s });
  };
  const onCellDrop = (e: DragEvent<HTMLElement>, clientId: string, d: string) => {
    e.preventDefault();
    const ok = canDropCell(clientId, d);
    const g = grab.current;
    grab.current = null;
    setHover(null);
    setDragId(null);
    if (!g) return;
    if (!ok) {
      if (!canMoveVisit(d, today)) toast('今日より前の日へは動かせません');
      return;
    }
    const v = visitById.get(g.visitId)!;
    openMove(g.visitId, d, hhmmToMinutes(v.earliestStart));
  };
  const onItemKey = (e: KeyboardEvent, it: ClientWeekItem) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = visitById.get(it.visitId);
    if (!v) return;
    if (!canMoveVisit(v.date, today)) {
      toast('今日より前の訪問は動かせません');
      return;
    }
    openMove(it.visitId, v.date, hhmmToMinutes(v.earliestStart));
  };

  const moving = draft ? visitById.get(draft.visitId) : undefined;
  const movingPattern = moving?.pattern ? data.patterns.find((p) => p.id === moving.pattern!.id) : undefined;
  const origDate = moving?.pattern?.date ?? moving?.date ?? '';
  const timeOptions = useMemo(() => {
    const dur = moving?.durationMinutes ?? 0;
    const out: number[] = [];
    for (let t = DAY_START; t + dur <= DAY_END; t += SNAP_MINUTES) out.push(t);
    return out;
  }, [moving]);

  const submitMove = () => {
    if (!draft || !moving) return;
    if (!DATE_RE.test(draft.date)) return;
    if (!canMoveVisit(moving.date, today) || !canMoveVisit(draft.date, today)) {
      toast('今日より前の日へは動かせません');
      return;
    }
    const label = `${clientName(moving)} ${md(draft.date)} ${hm(draft.start)}`;
    let movedId: string | null = draft.visitId;
    if (draft.mode === 'following' && movingPattern) {
      const ids: [string, string] = [newId('pt'), newId('pt')];
      const preview = moveFollowing(data, draft.visitId, draft.date, draft.start, today, ids);
      if (!preview) return;
      const fixed = changedDates(preview.change).filter((d) => !!own(data.manualPlans, d));
      if (
        fixed.length > 0 &&
        !confirm(
          `確定した日（${fixed.map(md).join('・')}）の訪問も変わります（確定した割当は変えません）。動かしますか？`,
        )
      )
        return;
      update((d) => moveFollowing(d, draft.visitId, draft.date, draft.start, today, ids)?.data ?? d);
      movedId = preview.movedVisitId;
    } else {
      update((d) => moveOnce(d, draft.visitId, draft.date, draft.start, today));
    }
    setDraft(null);
    if (movedId && own(data.aiPlans, draft.date)) {
      setNotice({ date: draft.date, visitId: movedId, label, error: null });
    } else {
      toast(`動かしました（${label}）`);
    }
  };

  /** 新しい日の今の案に空き時間で入れる（入る人がいなければ知らせに理由を出す） */
  const insert = () => {
    if (!notice) return;
    const createdAt = Date.now();
    const r = insertIntoPlan(data, notice.date, notice.visitId, createdAt);
    if (!r.staffId) {
      setNotice({
        ...notice,
        error: '空き時間に入りません。その日を作り直すか、予定の画面で手で入れてください',
      });
      return;
    }
    update((d) => insertIntoPlan(d, notice.date, notice.visitId, createdAt).data);
    toast(`${md(notice.date)} の案に入れました（担当：${staffName(r.staffId)}）`);
    setNotice(null);
  };

  /** 時間軸に出す帯：選んだ〈スタッフ〉（全員なら未割当も）・選んだ〈利用者さん〉の帯だけ */
  const staffSet = staffSel ? new Set(staffSel) : null;
  const clientSet = clientSel ? new Set(clientSel) : null;
  const showBand = (b: Band): boolean => {
    if (by === 'client') return !clientSet || clientSet.has(visitById.get(b.visitId)?.clientId ?? '');
    return !staffSet || (b.staffId !== null && staffSet.has(b.staffId));
  };
  const nothingPicked = by === 'client' ? clientSel?.length === 0 : staffSel?.length === 0;

  return (
    <div className="stack week-page">
      <PageHeader
        nav={<ViewSwitch current="week" />}
        icon={CalendarClock}
        title="週間"
        lead={`日時をドラッグでずらし、${terms.staff}の偏りを見ます`}
      />

      <div className="card stack week-head">
        <div className="row week-nav">
          <button type="button" className="icon-btn" aria-label="前の週" onClick={() => goWeek(addDays(anchor, -7))}>
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <h2 className="week-title" data-testid="week-title">
            {dateText(start)}〜{dateText(dates[6]!)}
          </h2>
          <button type="button" className="icon-btn" aria-label="次の週" onClick={() => goWeek(addDays(anchor, 7))}>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={dates.includes(today)}
            onClick={() => goWeek(today)}
          >
            今週
          </button>
          <fieldset className="segmented week-tabs" aria-label="表示">
            <button
              type="button"
              className={tab === 'timeline' ? 'is-on' : ''}
              aria-pressed={tab === 'timeline'}
              onClick={() => go({ view: 'timeline' })}
            >
              時間軸
            </button>
            <button
              type="button"
              className={tab === 'table' ? 'is-on' : ''}
              aria-pressed={tab === 'table'}
              onClick={() => go({ view: 'table' })}
            >
              {terms.staff}×曜日
            </button>
            <button
              type="button"
              className={tab === 'clients' ? 'is-on' : ''}
              aria-pressed={tab === 'clients'}
              onClick={() => go({ view: 'clients' })}
              data-testid="tab-clients"
            >
              {terms.client}×曜日
            </button>
          </fieldset>
        </div>
        {tab === 'timeline' && (
          <div className="row week-tools">
            <fieldset className="segmented week-by" aria-label="見る人">
              <button
                type="button"
                className={by === 'staff' ? 'is-on' : ''}
                aria-pressed={by === 'staff'}
                onClick={() => go({ by: null })}
                data-testid="by-staff"
              >
                {terms.staff}で見る
              </button>
              <button
                type="button"
                className={by === 'client' ? 'is-on' : ''}
                aria-pressed={by === 'client'}
                onClick={() => go({ by: 'client' })}
                data-testid="by-client"
              >
                {terms.client}で見る
              </button>
            </fieldset>
            <span className="row week-legend">
              {data.visitTypes.map((t) => (
                <span key={t.id} className="row week-legend-item">
                  <TypeDot type={t} />
                  {t.name}
                </span>
              ))}
              <span className="row week-legend-item">
                <span className="week-legend-dash" aria-hidden="true" />
                未割当・入らない
              </span>
              <span className="row week-legend-item">
                <span className="week-legend-unfit" aria-hidden="true">
                  資格✗
                </span>
                担当が種類の必要条件を満たさない
              </span>
            </span>
            <Hint>
              帯の中の色は種類、縁の色は{by === 'staff' ? `担当の${terms.staff}` : terms.client}
              です。帯は、その日の今の案（無ければ確定した割当、どちらも無ければ訪問の開始（早））の時刻です。帯を押すとその日の予定の画面を開きます。
              帯をドラッグして別の日・時刻へ動かせます（{SNAP_MINUTES}
              分刻み）。つかんでいる間は、担当できる人のチップを強調し、落とす先に空き時間に入れられる人の数（入れる人
              N人）を出します。キーボードでは帯で Enter
              を押すと、日付と時刻を選んで動かせます。定期パターンの訪問は「この回だけ」か「以降すべて」を選べます。
            </Hint>
          </div>
        )}
        {tab === 'timeline' && by === 'staff' && (
          <>
            <PickChips
              label={terms.staff}
              people={activeStaff.map((s) => ({
                id: s.id,
                name: s.name,
                color: colorOfStaff.get(s.id),
                badges: badgesOf.get(s.id),
              }))}
              selected={staffSel}
              onChange={(ids) => setSel('staff', ids)}
              highlight={allowedNow}
              testId="staff-chips"
            />
            {qualItem && qualItem.options.length > 0 && (
              <fieldset className="pick-chips week-quals" data-testid="qual-chips">
                <legend className="pick-chips-legend">{qualItem.name}で選ぶ</legend>
                {qualItem.options.map((o) => {
                  const ids = staffWithQualification(data.items, activeStaff, o);
                  return (
                    <button
                      key={o}
                      type="button"
                      className="pick-chip week-qual"
                      onClick={() => setSel('staff', ids)}
                      disabled={ids.length === 0}
                      title={`${o}を持つ${terms.staff}を選ぶ（${ids.length}人）`}
                      data-testid="qual-chip"
                    >
                      {o}
                      <span className="sub">{ids.length}人</span>
                    </button>
                  );
                })}
              </fieldset>
            )}
          </>
        )}
        {((tab === 'timeline' && by === 'client') || tab === 'clients') && (
          <PickChips
            label={terms.client}
            people={weekClients.map((c) => ({ id: c.id, name: c.displayName, color: colorOf(c.color) }))}
            selected={clientSel}
            onChange={(ids) => setSel('client', ids)}
            testId="client-chips"
          />
        )}
        {tab === 'timeline' && by === 'client' && allowedNow && (
          <p className="week-allowed" data-testid="week-allowed">
            担当できる{terms.staff}：
            {allowedNow.size === 0
              ? 'いません'
              : activeStaff
                  .filter((s) => allowedNow.has(s.id))
                  .map((s) => s.name)
                  .join('・')}
          </p>
        )}
      </div>

      {notice && (
        <output className="card stack week-notice" data-testid="week-notice">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>
              <WithIcon icon={TriangleAlert} size={16}>
                {notice.label} へ動かしました。{md(notice.date)} の案は条件が変わりました
              </WithIcon>
            </span>
            <button type="button" className="icon-btn" aria-label="知らせを閉じる" onClick={() => setNotice(null)}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          {notice.error && <p className="warn-text">{notice.error}</p>}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={insert} disabled={!!notice.error}>
              <WithIcon icon={Sparkles}>{md(notice.date)} の案に空き時間で入れる</WithIcon>
            </button>
            <button type="button" className="btn" onClick={() => openDay(notice.date)}>
              <WithIcon icon={RefreshCw}>その日を作り直す</WithIcon>
            </button>
          </div>
        </output>
      )}

      {tab === 'timeline' ? (
        <div className="card week-card">
          {nothingPicked && (
            <p className="sub" data-testid="week-none">
              {by === 'client' ? terms.client : terms.staff}
              をだれも選んでいません。上のチップで選ぶか「全員」を押してください。
            </p>
          )}
          <div className="week-grid" data-testid="week-grid">
            <div className="week-corner" />
            {days.map((day) => {
              const wd = weekday(day.date);
              return (
                <button
                  key={day.date}
                  type="button"
                  className={`week-day-head${day.date === today ? ' is-today' : ''}${wd === 0 ? ' is-sun' : wd === 6 ? ' is-sat' : ''}`}
                  onClick={() => openDay(day.date)}
                  aria-label={`${dateText(day.date)}の予定を開く`}
                  data-testid="week-day-head"
                >
                  <strong>{dateText(day.date)}</strong>
                  <span className="sub">
                    {day.bands.length}件{day.source === null && day.bands.length > 0 ? '・案なし' : ''}
                  </span>
                </button>
              );
            })}
            <div className="week-gutter" style={{ height: (DAY_END - DAY_START) * PX_PER_MIN }}>
              {HOURS.map((h) => (
                <span key={h} className="week-hour" style={{ top: (h - DAY_START) * PX_PER_MIN }}>
                  {hm(h)}
                </span>
              ))}
            </div>
            {days.map((day) => (
              <DayColumn
                key={day.date}
                day={day}
                today={today}
                show={showBand}
                hover={hover?.date === day.date ? hover.start : null}
                hoverFit={hover?.date === day.date ? hoverFit : null}
                hoverMinutes={grab.current ? (visitById.get(grab.current.visitId)?.durationMinutes ?? 60) : 60}
                visitById={visitById}
                bandLabel={(b) => {
                  const v = visitById.get(b.visitId);
                  return { client: clientName(v), staff: staffName(b.staffId) };
                }}
                typeColor={(v) => {
                  const t = typeOf(data.visitTypes, v?.typeId);
                  return t ? colorOf(t.color) : null;
                }}
                edgeColor={(b) => {
                  if (by === 'client') {
                    const c = clientById.get(visitById.get(b.visitId)?.clientId ?? '');
                    return c ? colorOf(c.color) : null;
                  }
                  return b.staffId ? (colorOfStaff.get(b.staffId) ?? null) : null;
                }}
                unfit={(b) => typeUnfit(day.problem, b.visitId, b.staffId)}
                onOpen={(b) => openDay(b.date, b.visitId)}
                onKey={onBandKey}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragOver={(e) => onDragOver(e, day.date)}
                onDrop={(e) => onDrop(e, day.date)}
              />
            ))}
          </div>
        </div>
      ) : tab === 'table' ? (
        table && (
          <div className="card week-card">
            <div className="table-scroll">
              <table className="week-table" data-testid="week-table">
                <thead>
                  <tr>
                    <th scope="col">{terms.staff}</th>
                    {dates.map((d) => (
                      <th key={d} scope="col">
                        {dateText(d)}
                      </th>
                    ))}
                    <th scope="col">週の合計</th>
                    <th scope="col">平均との差</th>
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r) => (
                    <tr key={r.staffId}>
                      <th scope="row">
                        {staffName(r.staffId)}
                        <QualificationBadges badges={badgesOf.get(r.staffId) ?? []} />
                      </th>
                      {r.cells.map((c) => (
                        <td
                          key={c.date}
                          className={c.off ? 'is-off' : c.noPlan ? 'is-noplan' : ''}
                          data-testid="week-cell"
                        >
                          {c.off ? (
                            <span className="sub">休み</span>
                          ) : c.noPlan ? (
                            <span className="sub">案なし</span>
                          ) : (
                            <>
                              <strong>{c.count}件</strong>
                              <span className="sub">稼働 {c.hours}時間</span>
                              <span className="sub">移動 {c.travel}分</span>
                              {c.types.length > 0 && (
                                <span className="row week-types">
                                  {c.types.map((t) => {
                                    const type = typeOf(data.visitTypes, t.typeId);
                                    return (
                                      <span key={t.typeId} className="row week-type">
                                        {type && <TypeDot type={type} size={8} />}
                                        <span className="sr-only">{type?.name}</span>
                                        {t.count}
                                      </span>
                                    );
                                  })}
                                </span>
                              )}
                            </>
                          )}
                        </td>
                      ))}
                      <td className="week-total">
                        <strong>{r.total.count}件</strong>
                        <span className="sub">稼働 {r.total.hours}時間</span>
                        <span className="sub">移動 {r.total.travel}分</span>
                      </td>
                      <td className={`week-diff${r.strong ? ' is-strong' : ''}`} data-testid="week-diff">
                        {r.diff > 0 ? `+${r.diff}` : r.diff < 0 ? `−${-r.diff}` : '±0'}件
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">日ごとの合計</th>
                    {table.days.map((d) => (
                      <td key={d.date}>
                        {d.noPlan ? (
                          <span className="sub">案なし</span>
                        ) : (
                          <>
                            <strong>{d.count}件</strong>
                            <span className="sub">移動 {d.travel}分</span>
                          </>
                        )}
                      </td>
                    ))}
                    <td className="week-total">
                      <strong>{table.rows.reduce((m, r) => m + r.total.count, 0)}件</strong>
                    </td>
                    <td className="sub">平均 {table.average}件</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="sub">
              数えるのは、その日の今の案（無ければ確定した割当）です。稼働時間は稼働時間帯の長さ（欠勤を差し引く）、移動は自宅へ帰る移動も含みます。
              平均との差が平均の30%を超える人を強調します。
            </p>
          </div>
        )
      ) : (
        clientRows && (
          <div className="card week-card">
            <div className="table-scroll">
              <table className="week-table week-clients" data-testid="week-client-table">
                <thead>
                  <tr>
                    <th scope="col">{terms.client}</th>
                    {dates.map((d) => (
                      <th key={d} scope="col">
                        {dateText(d)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {clientRows.map((r) => {
                    const c = clientById.get(r.clientId);
                    return (
                      <tr key={r.clientId}>
                        <th scope="row">
                          <span className="row week-client-name">
                            {c && (
                              <span
                                className="week-client-color"
                                style={{ background: colorOf(c.color) }}
                                aria-hidden="true"
                              />
                            )}
                            {c?.displayName ?? '（不明）'}
                          </span>
                        </th>
                        {r.cells.map((cell) => {
                          const hovered =
                            !!dragId && hover?.date === cell.date && visitById.get(dragId)?.clientId === r.clientId;
                          return (
                            <td
                              key={cell.date}
                              className={`week-ccell${cell.date < today ? ' is-past' : ''}${hovered ? ' is-drop' : ''}`}
                              onDragOver={(e) => onCellDragOver(e, r.clientId, cell.date)}
                              onDragLeave={() => hovered && setHover(null)}
                              onDrop={(e) => onCellDrop(e, r.clientId, cell.date)}
                              data-date={cell.date}
                              data-client={r.clientId}
                              data-testid="week-ccell"
                            >
                              {cell.items.map((it) => {
                                const type = typeOf(data.visitTypes, it.typeId);
                                const movable = canMoveVisit(it.date, today);
                                const bad = typeUnfit(dayOf.get(it.date)?.problem ?? null, it.visitId, it.staffId);
                                return (
                                  <button
                                    key={it.visitId}
                                    type="button"
                                    draggable={movable}
                                    className={`week-citem${it.staffId === null ? ' is-unassigned' : ''}${bad ? ' is-unfit' : ''}`}
                                    style={{ borderLeftColor: type ? colorOf(type.color) : undefined }}
                                    onClick={() => openDay(it.date, it.visitId)}
                                    onKeyDown={(e) => onItemKey(e, it)}
                                    onDragStart={(e) => (movable ? onDragStart(e, it.visitId) : e.preventDefault())}
                                    onDragEnd={onDragEnd}
                                    aria-label={`${hm(it.start)} ${type ? `${type.name}・` : ''}${staffName(it.staffId)}${bad ? '・資格✗' : ''}（押すと予定の画面${movable ? '、Enter で日時を動かす' : ''}）`}
                                    data-testid="week-citem"
                                    data-visit={it.visitId}
                                  >
                                    <strong>{hm(it.start)}</strong>
                                    {type && (
                                      <span className="row week-citem-type">
                                        <TypeDot type={type} size={8} />
                                        {type.name}
                                      </span>
                                    )}
                                    <span className="week-citem-staff">
                                      {bad && <span className="week-band-unfit">資格✗</span>}
                                      {staffName(it.staffId)}
                                    </span>
                                  </button>
                                );
                              })}
                              {hovered && dragId && (
                                <span className="week-cdrop" data-testid="week-cdrop">
                                  ここへ（{hm(hover!.start)}）・
                                  {hoverFit === null ? '入れる人 —' : `入れる人 ${hoverFit}人`}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {clientRows.length === 0 && <p className="sub">{terms.client}がいません。</p>}
            <p className="sub">
              選んだ{terms.client}
              （選んでいなければ全員）の訪問です。訪問を同じ行の別の日のマスへドラッグすると、時刻はそのままで日を動かせます（今日より前の日へは動かせません）。
              キーボードでは訪問で Enter を押すと、日付と時刻を選んで動かせます。
            </p>
          </div>
        )
      )}

      {draft && moving && (
        <SidePanel
          icon={Move}
          title="訪問を動かす"
          narrow
          onClose={() => setDraft(null)}
          footer={
            <>
              <button
                type="button"
                className="btn btn-primary"
                onClick={submitMove}
                disabled={!DATE_RE.test(draft.date) || !canMoveVisit(draft.date, today)}
                data-testid="move-submit"
              >
                <WithIcon icon={Move}>動かす</WithIcon>
              </button>
              <button type="button" className="btn" onClick={() => setDraft(null)}>
                やめる
              </button>
            </>
          }
        >
          <p data-testid="move-summary">
            <strong>{clientName(moving)}</strong> {md(moving.date)}（{WEEKDAY_LABELS[weekday(moving.date)]}）{' '}
            {timeText(moving.earliestStart)} →{' '}
            {DATE_RE.test(draft.date) ? `${md(draft.date)}（${WEEKDAY_LABELS[weekday(draft.date)]}）` : '？'}{' '}
            {hm(draft.start)}
          </p>
          <div className="form-grid">
            <label>
              日付
              <input
                type="date"
                value={draft.date}
                min={today}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                data-testid="move-date"
              />
            </label>
            <label>
              開始
              <select
                value={draft.start}
                onChange={(e) => setDraft({ ...draft, start: Number(e.target.value) })}
                data-testid="move-start"
              >
                {timeOptions.map((t) => (
                  <option key={t} value={t}>
                    {hm(t)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {DATE_RE.test(draft.date) && !canMoveVisit(draft.date, today) && (
            <p className="warn-text" data-testid="move-past">
              今日より前の日へは動かせません
            </p>
          )}
          {movingPattern ? (
            <fieldset className="stack" style={{ gap: 6 }}>
              <legend>定期パターンの訪問です</legend>
              <label className="check">
                <input
                  type="radio"
                  name="move-mode"
                  checked={draft.mode === 'once'}
                  onChange={() => setDraft({ ...draft, mode: 'once' })}
                  style={{ width: 'auto' }}
                />
                この回だけ
              </label>
              <label className="check">
                <input
                  type="radio"
                  name="move-mode"
                  checked={draft.mode === 'following'}
                  onChange={() => setDraft({ ...draft, mode: 'following' })}
                  style={{ width: 'auto' }}
                  data-testid="move-following"
                />
                以降すべて（{md(origDate)} 以降の{WEEKDAY_LABELS[weekday(origDate)]}曜の回を
                {DATE_RE.test(draft.date) ? `${WEEKDAY_LABELS[weekday(draft.date)]}曜 ` : ''}
                {hm(draft.start)} に）
              </label>
              {draft.mode === 'following' && movingPattern.weekdays.length > 1 && (
                <p className="sub">ほかの曜日の回は時刻を変えません。</p>
              )}
            </fieldset>
          ) : (
            <p className="sub">単発の訪問です。この訪問だけを動かします。</p>
          )}
          <p className="sub">
            動かした訪問が出入りする日の案は「条件が変わった」になります。新しい日に案があれば、動かしたあとに空き時間に入れるか作り直すかを選べます。
          </p>
        </SidePanel>
      )}
    </div>
  );
}

/** 時間軸の1日の列（帯・ドラッグの受け口） */
function DayColumn({
  day,
  today,
  show,
  hover,
  hoverFit,
  hoverMinutes,
  visitById,
  bandLabel,
  typeColor,
  edgeColor,
  unfit,
  onOpen,
  onKey,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  day: WeekDay;
  /** 今日（今日より前の帯はドラッグできない） */
  today: string;
  /** 出す帯（選んだ人の帯だけ） */
  show: (b: Band) => boolean;
  hover: number | null;
  /** 落とす先に入れる人の数（null＝数えられない） */
  hoverFit: number | null;
  hoverMinutes: number;
  visitById: Map<string, Visit>;
  bandLabel: (b: Band) => { client: string; staff: string };
  typeColor: (v: Visit | undefined) => string | null;
  /** 帯の縁の色（担当・〈利用者さん〉の色） */
  edgeColor: (b: Band) => string | null;
  /** 担当が種類の必要条件で可でない（資格✗） */
  unfit: (b: Band) => boolean;
  onOpen: (b: Band) => void;
  onKey: (e: KeyboardEvent, b: Band) => void;
  onDragStart: (e: DragEvent<HTMLElement>, visitId: string) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
}) {
  const bands = day.bands.filter(show);
  const lanes = laneLayout(bands.map((b) => ({ id: b.visitId, start: b.start, end: b.end })));
  const top = (m: number) => (Math.min(Math.max(m, DAY_START), DAY_END) - DAY_START) * PX_PER_MIN;
  return (
    <section
      className="week-col"
      style={{ height: (DAY_END - DAY_START) * PX_PER_MIN }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      aria-label={`${dateText(day.date)}の訪問`}
      data-date={day.date}
      data-testid="week-col"
    >
      {hover !== null && (
        <div
          className="week-drop"
          style={{ top: top(hover), height: Math.max(32, hoverMinutes * PX_PER_MIN) }}
          aria-hidden="true"
        >
          {hm(hover)}
          <span className="week-drop-fit" data-testid="week-drop-fit">
            {hoverFit === null ? '入れる人 —' : `入れる人 ${hoverFit}人`}
          </span>
        </div>
      )}
      {bands.map((b) => {
        const v = visitById.get(b.visitId);
        const l = lanes.get(b.visitId) ?? { lane: 0, lanes: 1 };
        const edge = edgeColor(b);
        const bad = unfit(b);
        const { client, staff } = bandLabel(b);
        const color = typeColor(v);
        const h = Math.max(18, (Math.min(b.end, DAY_END) - Math.max(b.start, DAY_START)) * PX_PER_MIN);
        // 今日より前の訪問は動かさない（ドラッグ・Enter を止める）
        const movable = canMoveVisit(b.date, today);
        return (
          <button
            key={b.visitId}
            type="button"
            draggable={movable}
            className={`week-band${b.staffId === null ? ' is-unassigned' : ''}${bad ? ' is-unfit' : ''}`}
            style={{
              top: top(b.start),
              height: h,
              left: `calc(${(l.lane / l.lanes) * 100}% + 2px)`,
              width: `calc(${100 / l.lanes}% - 4px)`,
              background: color ?? undefined,
              borderColor: !bad && b.staffId !== null && edge ? edge : undefined,
            }}
            title={`${hm(b.start)}〜${hm(b.end)} ${client}・${staff}${bad ? '（資格✗：担当が種類の必要条件を満たさない）' : ''}`}
            aria-label={`${hm(b.start)} ${client}・${staff}${bad ? '・資格✗' : ''}（押すと予定の画面${movable ? '、Enter で日時を動かす' : ''}）`}
            onClick={() => onOpen(b)}
            onKeyDown={(e) => onKey(e, b)}
            onDragStart={(e) => (movable ? onDragStart(e, b.visitId) : e.preventDefault())}
            onDragEnd={onDragEnd}
            data-testid="week-band"
            data-visit={b.visitId}
          >
            <span className="week-band-time">{hm(b.start)}</span>
            <span className="week-band-client">{client}</span>
            <span className="week-band-staff">
              {bad && <span className="week-band-unfit">資格✗</span>}
              {staff}
            </span>
          </button>
        );
      })}
    </section>
  );
}
