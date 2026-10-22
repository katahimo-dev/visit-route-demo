import { Ban, CalendarDays, Check, ClipboardList, Pin, Plus, Repeat, RotateCcw, Undo2, X } from 'lucide-react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDay } from '../app/day';
import type { DemoData } from '../contracts/data';
import type { Visit } from '../contracts/documents';
import { jstDate } from '../domain/time';
import { dateText, newId, own } from '../lib/common';
import { confirmLeave } from '../lib/leaveGuard';
import { HOME_LABEL } from '../lib/mapsLink';
import { typeOf } from '../lib/patternText';
import { COMPACT_QUERY, useMedia } from '../lib/useMedia';
import {
  applyVisitEdit,
  cancelVisitOp,
  draftOf,
  newDraft,
  restoreOccurrenceOp,
  SCOPE_LABELS,
  scopeTexts,
  staffChoices,
  uncancelVisitOp,
  type VisitDraft,
  type VisitScope,
  visitInfo,
} from '../lib/visitOps';
import { findVisit, visitsOn } from '../patterns';
import { useDemoData } from '../store';
import { useConfirm } from './ConfirmDialog';
import { FieldError, invalidAttrs, RequiredMark } from './FieldError';
import { VisitRouteLinks } from './mapsLinks';
import { PersonButton } from './PersonPopover';
import { StaffMark } from './StaffMark';
import { useToast } from './Toast';
import { SidePanel, WithIcon } from './ui';
import { VisitRules } from './VisitRules';
import { TypeDot, TypeMark } from './visitType';
import './visitPanel.css';

/**
 * 訪問の詳細の欄（PRD D301〜D304。ADR-0051）：どの画面から開いても同じ右の欄（スマホ幅は下から出る今の右の欄の形）。
 * 見る（〈利用者さん〉・日時・所要・種類・担当・繰り返し・この回の変更・決まりごと・道順）、日時と担当を同時に変える、取り消す・取り消しをやめる、
 * 新しい訪問を足す。繰り返しの回は保存のときに範囲（この回だけ／これ以降／すべて）を選ぶ。データは lib/visitOps 越しに読み書きし、
 * 書くのは store の update だけ。狭い画面（600px 以下）は見る・取り消す・担当を替えるだけ（日時の変更・追加は出さない。ADR-0051 の決定5）
 */

/** 保存したことを開いた画面へ知らせる中身 */
export type VisitSaved = {
  visitId: string;
  date: string;
  /** 日時・所要・種類を変えた */
  moved: boolean;
  /** 担当を選んだ */
  staffSet: boolean;
  isNew: boolean;
  /** 「〈利用者さん〉 M/D HH:MM」（開いた画面の知らせに使う） */
  label: string;
};

/** 欄を開く頼み。visitId か newVisit のどちらか */
export type VisitPanelRequest = {
  /** 開く訪問（新しい訪問なら無し） */
  visitId?: string;
  /** 新しい訪問の日付・〈利用者さん〉・開始 */
  newVisit?: { date: string; clientId?: string; start?: string };
  /** はじめの入力を差し替える（週のドラッグで落とした日時） */
  draft?: Partial<VisitDraft>;
  /** 保存・取り消しのあと（開いた画面の知らせ。週の「空き時間に入れる」など） */
  onSaved?: (r: VisitSaved) => void;
  /** 保存・閉じたあとのフォーカス先（開いた帯。無ければ開く前の要素） */
  returnFocus?: (visitId: string | null) => HTMLElement | null | undefined;
};

type OpenFn = (req: VisitPanelRequest) => void;
const Ctx = createContext<OpenFn | null>(null);

/** 欄を開く関数（App の殻の VisitPanelProvider の中。どの画面・コマンドパレットからでも開ける） */
export function useOpenVisit(): OpenFn {
  const v = useContext(Ctx);
  if (!v) throw new Error('VisitPanelProvider の外で useOpenVisit を使っています');
  return v;
}

/** 欄を画面全体で1つ持つ（App の殻に置く。開いている訪問は画面を移っても残す） */
export function VisitPanelProvider({ children }: { children: ReactNode }) {
  // トーストの「元に戻す」は欄を閉じたあとに押すので、今のデータを殻で追う
  const { data } = useDemoData();
  const latest = useRef(data);
  latest.current = data;
  const [req, setReq] = useState<(VisitPanelRequest & { key: number }) | null>(null);
  const seq = useRef(0);
  const open = useCallback((r: VisitPanelRequest) => {
    seq.current += 1;
    setReq({ ...r, key: seq.current });
  }, []);
  return (
    <Ctx.Provider value={open}>
      {children}
      {req && <VisitPanel key={req.key} req={req} latest={latest} onClose={() => setReq(null)} />}
    </Ctx.Provider>
  );
}

/** 一覧の選択肢の「変えない」 */
const KEEP = '__keep';
/** 一覧の選択肢の「担当なし」 */
const NONE_PICK = '__none';

const hhmm = (s: string) => /^\d{2}:\d{2}$/.test(s);

function VisitPanel({
  req,
  latest,
  onClose,
}: {
  req: VisitPanelRequest;
  latest: { readonly current: DemoData };
  onClose: () => void;
}) {
  const { data, update } = useDemoData();
  const terms = data.org.terms;
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { date: shownDate, setDate } = useDay();
  const narrow = useMedia(COMPACT_QUERY);
  const today = jstDate(Date.now());
  const isNew = !req.visitId;
  /** 開いている訪問の ID（欄を開いている間は変えない。保存で作り直した回の ID は savedRef で閉じたあとのフォーカスに使う） */
  const [visitId] = useState<string | null>(req.visitId ?? null);
  /**
   * 開いたときの訪問（欄の中の書き込みのあとは書いた形に差し替える）。保存・取り消しの前にデータの訪問と比べ、別のタブ・別の操作で
   * 変わっていれば古い入力で上書きしない
   */
  const baseRef = useRef<Visit | null>(req.visitId ? findVisit(data, req.visitId) : null);
  const info = useMemo(() => (visitId ? visitInfo(data, visitId, today) : null), [data, visitId, today]);
  const v = info?.visit ?? null;
  const [draft, setDraft] = useState<VisitDraft>(() => {
    const base = req.visitId
      ? (() => {
          const x = req.visitId ? findVisit(data, req.visitId) : null;
          return x ? draftOf(x) : newDraft(data, today);
        })()
      : newDraft(data, req.newVisit?.date ?? today, req.newVisit?.clientId, req.newVisit?.start);
    return { ...base, ...req.draft };
  });
  const [pick, setPick] = useState<string>(KEEP);
  const [scope, setScope] = useState<VisitScope>('once');
  const [error, setError] = useState<{ text: string; field?: keyof VisitDraft } | null>(null);
  const errorId = useId();
  const bad = (k: keyof VisitDraft) => invalidAttrs(error?.field === k, errorId);
  const savedRef = useRef<string | null>(null);

  const client = data.clients.find((c) => c.id === (v?.clientId ?? draft.clientId));
  const staffById = useMemo(() => new Map(data.staff.map((s) => [s.id, s])), [data.staff]);
  const staffName = (id: string | null) => (id ? (staffById.get(id)?.name ?? '（不明）') : '');
  const cancelled = !!v?.cancelled;
  const editable = isNew || (!!info?.editable && !cancelled);
  /** 日時を変えられる（狭い画面は出さない） */
  const timeOn = editable && !narrow;
  /** 新しい訪問は狭い画面では足さない */
  const newBlocked = isNew && narrow;
  const scopes = useMemo(
    () => (visitId && editable && info?.pattern ? scopeTexts(data, visitId, today) : null),
    [data, visitId, editable, info?.pattern, today],
  );

  // 担当の候補（日時を変えたらその日時で計算し直す。打つたびに計算しないよう遅らせる）
  const deferred = useDeferredValue(draft);
  const choices = useMemo(
    () => (editable && !newBlocked ? staffChoices(data, visitId, deferred) : null),
    [data, visitId, deferred, editable, newBlocked],
  );
  const current = choices?.currentStaffId ?? null;
  // 日時を変えて候補が変わり、選んでいた人が候補に無い・選べなくなったら「変えない」に戻す（担当なしも今の担当がいなくなれば戻す）
  useEffect(() => {
    if (!choices || pick === KEEP) return;
    const ok =
      pick === NONE_PICK
        ? choices.currentStaffId !== null
        : choices.choices.some((c) => c.staffId === pick && !c.disabled && !c.current);
    if (!ok) setPick(KEEP);
  }, [choices, pick]);

  const set = (patch: Partial<VisitDraft>) => {
    setDraft((f) => ({ ...f, ...patch }));
    setError(null);
  };

  /** 閉じたあとのフォーカス（開いた帯へ。無ければ開く前の要素） */
  const returnFocus = () => req.returnFocus?.(savedRef.current ?? visitId) ?? null;

  /** 保存の前の形に戻す（トーストの「元に戻す」。あとから別の変更があれば戻さない） */
  const undoTo = (before: DemoData, after: DemoData) => ({
    label: '元に戻す',
    testId: 'vp-toast-undo',
    onClick: () => {
      if (latest.current !== after) {
        toast('戻せません：あとから別の変更がありました');
        return;
      }
      update((d) => (d === after ? before : d));
      toast('元に戻しました');
    },
  });

  /** 別のタブ・別の操作で開いた訪問が変わっていれば、その文（保存・取り消しを止める） */
  const changedElsewhere = (): string | null => {
    if (isNew || !visitId) return null;
    const now = visitId ? findVisit(latest.current, visitId) : null;
    return JSON.stringify(now) !== JSON.stringify(baseRef.current)
      ? 'この訪問は別の操作で変わりました。閉じて開き直してください'
      : null;
  };
  /**
   * 書く（書く前のデータが今のデータのときだけ。確認を待つ間などに別の変更が入っていれば書かずに null を返し、呼ぶ側が誤りを出す）。
   * 書いたら「元に戻す」の操作を返す
   */
  const write = (next: DemoData) => {
    const before = data;
    if (latest.current !== before) return null;
    update((d) => (d === before ? next : d));
    if (visitId) baseRef.current = findVisit(next, visitId);
    return undoTo(before, next);
  };
  const STALE = '開いている間にデータが変わりました。閉じて開き直してください';

  const save = async () => {
    if (!editable || newBlocked) {
      onClose();
      return;
    }
    const elsewhere = changedElsewhere();
    if (elsewhere) {
      setError({ text: elsewhere });
      return;
    }
    const staff = pick === KEEP ? undefined : pick === NONE_PICK ? null : pick;
    const r = applyVisitEdit(
      data,
      { visitId, draft, staff, scope },
      today,
      { visit: newId('v'), patterns: [newId('pt'), newId('pt')] },
      Date.now(),
    );
    if (!r.ok) {
      setError({ text: r.error, field: r.field });
      return;
    }
    if (r.unchanged) {
      toast('変更はありません');
      onClose();
      return;
    }
    // これ以降・すべてで確定した日の訪問も変わるなら確かめる（週のドラッグと同じ）
    if (scope !== 'once' && !isNew) {
      const fixed = r.dates.filter((x) => !!own(data.snapshots, x));
      if (
        fixed.length > 0 &&
        !(await confirm({
          title: '確定した日の訪問も変えますか？',
          body: `確定した日（${fixed.map((x) => dateText(x)).join('・')}）の訪問も変わります。その日は「未連絡の変更あり」になり、連絡の一覧に出ます。`,
          confirmLabel: '変える',
        }))
      )
        return;
    }
    const action = write(r.data);
    if (!action) {
      setError({ text: STALE });
      return;
    }
    const after = findVisit(r.data, r.visitId);
    const label = after ? `${dateText(after.date)} ${after.earliestStart}` : '';
    const range = info?.pattern && !isNew ? `・${SCOPE_LABELS[scope]}` : '';
    const failText =
      r.failed.length > 0
        ? `。担当を当てられなかった回が ${r.failed.length}件あります（${r.failed
            .slice(0, 3)
            .map((x) => `${dateText(x.date)} ${x.why}`)
            .join('、')}）`
        : '';
    toast(`${isNew ? '訪問を追加しました' : '訪問を保存しました'}（${label}${range}）${failText}`, { action });
    savedRef.current = r.visitId;
    req.onSaved?.({
      visitId: r.visitId,
      date: after?.date ?? draft.date,
      moved: isNew || (!!v && (after?.date !== v.date || after?.earliestStart !== v.earliestStart)),
      staffSet: staff !== undefined,
      isNew,
      label: `${client?.displayName ?? ''} ${label}`,
    });
    onClose();
  };

  /** 欄の中の操作の前に、別の操作で変わっていないかを見る（変わっていれば誤りを出して true） */
  const blocked = () => {
    const t = changedElsewhere();
    if (t) setError({ text: t });
    return !!t;
  };
  const doCancel = (sameDay: boolean) => {
    if (!v || blocked()) return;
    const action = write(cancelVisitOp(data, v.id, sameDay));
    if (!action) return setError({ text: STALE });
    toast(sameDay ? '当日キャンセルとして取り消しました' : '取り消しました', { action });
    req.onSaved?.({ visitId: v.id, date: v.date, moved: false, staffSet: false, isNew: false, label: '' });
  };
  const doUncancel = () => {
    if (!v || blocked()) return;
    const action = write(uncancelVisitOp(data, v.id));
    if (!action) return setError({ text: STALE });
    toast('取り消しをやめました', { action });
    req.onSaved?.({ visitId: v.id, date: v.date, moved: false, staffSet: false, isNew: false, label: '' });
  };
  const doRestore = () => {
    if (!v || blocked()) return;
    const next = restoreOccurrenceOp(data, v.id, today);
    if (next === data) return;
    const action = write(next);
    if (!action) return setError({ text: STALE });
    const after = findVisit(next, v.id);
    if (after) setDraft(draftOf(after));
    toast('この回の変更を戻しました（繰り返しのとおり）', { action });
  };

  /** 日の予定でその日を開く（今その日の日の予定にいるなら出さない） */
  const dayDate = v?.date ?? draft.date;
  const showDayLink = !isNew && !(pathname === '/plan' && shownDate === dayDate);
  const openDay = async () => {
    // 下書きのある画面（人の画面の節・条件の重み）から移るときは確かめる（断れば移らない）
    if (!(await confirmLeave())) return;
    onClose();
    setDate(dayDate);
    navigate('/plan', v ? { state: { visitId: v.id } } : undefined);
  };

  // 道順（今の担当の列の前の訪問先、1件目は自宅から）
  const route = useMemo(() => {
    if (!v || !info?.assignment.staffId) return null;
    const s = staffById.get(info.assignment.staffId);
    if (!s) return null;
    // その人のその日の訪問（開始の順）で、この訪問の前の訪問
    const order = visitsOn(data, v.date).filter((x) => !x.cancelled && x.staffId === s.id);
    const i = order.findIndex((x) => x.id === v.id);
    const prev = i > 0 ? order[i - 1] : undefined;
    const prevClient = prev ? data.clients.find((c) => c.id === prev.clientId) : undefined;
    return { staff: s, from: prevClient ? prevClient.place : s.home, fromName: prevClient?.displayName ?? HOME_LABEL };
  }, [v, info, staffById, data]);

  const title = isNew ? '訪問を追加' : '訪問の詳細';
  const type = typeOf(data.visitTypes, v?.typeId ?? draft.typeId);
  const owner = info?.assignment.staffId ?? null;
  const ownerStaff = owner ? staffById.get(owner) : undefined;
  const windowShown = (x: Pick<Visit, 'windowKind' | 'earliestStart' | 'latestStart'>) =>
    x.windowKind === 'window' ? `${x.earliestStart}〜${x.latestStart} の間に開始` : x.earliestStart;

  const footer =
    editable && !newBlocked ? (
      <>
        <button type="submit" className="btn btn-primary" data-testid="vp-save">
          <WithIcon icon={isNew ? Plus : Check}>{isNew ? '追加' : '保存'}</WithIcon>
        </button>
        <button type="button" className="btn" onClick={onClose} data-testid="vp-close">
          <WithIcon icon={X}>閉じる</WithIcon>
        </button>
      </>
    ) : (
      <button type="button" className="btn" onClick={onClose} data-testid="vp-close">
        <WithIcon icon={X}>閉じる</WithIcon>
      </button>
    );

  return (
    <SidePanel
      icon={isNew ? Plus : ClipboardList}
      title={title}
      narrow
      onClose={onClose}
      onSubmit={save}
      returnFocus={returnFocus}
      fallbackFocus={headingOfPage}
      focusPanel={!isNew}
      footer={footer}
    >
      <div
        className="visit-panel stack"
        data-testid="visit-panel"
        data-visit={visitId ?? ''}
        data-new={isNew || undefined}
      >
        {!isNew && !v && (
          <p className="warn-text" data-testid="vp-gone">
            この訪問は見つかりません（消されたか、繰り返しを直して作り直されました）。
          </p>
        )}
        {newBlocked && (
          <p className="sub" data-testid="vp-narrow-new">
            訪問の追加はパソコン・タブレットの幅で行います（スマホでは見る・取り消す・担当を替えるまで）。
          </p>
        )}
        {v && info && (
          <section className="vp-summary" data-testid="vp-summary" aria-label="訪問の内容">
            <div className="vp-head">
              <strong className="vp-client">
                {client ? (
                  <PersonButton kind="client" id={client.id} name={client.displayName} testId="vp-client-name" />
                ) : (
                  '（不明）'
                )}
              </strong>
              <TypeMark type={type} compact />
              {cancelled && (
                <span className="chip chip-red" data-testid="vp-cancelled">
                  {v.cancelKind === 'sameDay' ? '当日キャンセル' : '取り消し済み'}
                </span>
              )}
              {info.onLeave && <span className="chip chip-leave">休みのため無し</span>}
            </div>
            <dl className="vp-facts">
              <dt>日時</dt>
              <dd data-testid="vp-when">
                {dateText(v.date)} {windowShown(v)}
              </dd>
              <dt>所要</dt>
              <dd>{v.durationMinutes}分</dd>
              <dt>種類</dt>
              <dd>{type?.name ?? 'なし'}</dd>
              <dt>担当</dt>
              <dd data-testid="vp-staff-now">
                {ownerStaff ? (
                  <span className="with-staff-mark">
                    <StaffMark staff={ownerStaff} size="xs" />
                    <PersonButton kind="staff" id={ownerStaff.id} name={ownerStaff.name} testId="vp-staff-name" />
                    {info.assignment.pinned && (
                      <span className="chip chip-pin">
                        <Pin size={12} strokeWidth={2.4} aria-hidden="true" />
                        ピン
                      </span>
                    )}
                    {owner === info.usualStaffId && <span className="sub">（いつもの担当）</span>}
                  </span>
                ) : (
                  <span className="sub">担当なし</span>
                )}
              </dd>
              {info.patternText && (
                <>
                  <dt>繰り返し</dt>
                  <dd data-testid="vp-pattern">
                    <WithIcon icon={Repeat} size={14}>
                      {info.patternText}の回
                    </WithIcon>
                  </dd>
                </>
              )}
              {(info.changes.length > 0 || (v.pattern?.edited && !cancelled)) && (
                <>
                  <dt>この回の変更</dt>
                  <dd className="row" style={{ gap: 4, flexWrap: 'wrap' }} data-testid="vp-changes">
                    {info.changes.length === 0 && <span className="chip chip-warn">この回だけの変更</span>}
                    {info.changes.map((c) => (
                      <span key={c} className="chip chip-warn">
                        {c}
                      </span>
                    ))}
                    {timeOn && info.changes.length > 0 && (
                      <button
                        type="button"
                        className="btn btn-small btn-text"
                        onClick={doRestore}
                        data-testid="vp-restore"
                      >
                        <WithIcon icon={RotateCcw} size={14}>
                          繰り返しのとおりに戻す
                        </WithIcon>
                      </button>
                    )}
                  </dd>
                </>
              )}
              {v.note && (
                <>
                  <dt>メモ</dt>
                  <dd>{v.note}</dd>
                </>
              )}
            </dl>
            {!info.editable && <p className="sub">今日より前の訪問なので、見るだけです。</p>}
            {showDayLink && (
              <button type="button" className="btn btn-small" onClick={openDay} data-testid="vp-open-day">
                <WithIcon icon={CalendarDays} size={14}>
                  日の予定で見る（{dateText(v.date)}）
                </WithIcon>
              </button>
            )}
          </section>
        )}

        {timeOn && !newBlocked && (
          <fieldset className="vp-section" data-testid="vp-time">
            <legend>{isNew ? '何を・いつ' : '日時を変える'}</legend>
            <div className="form-grid">
              {isNew && (
                <label>
                  <span>
                    {terms.client}
                    <RequiredMark />
                  </span>
                  <select
                    value={draft.clientId}
                    required
                    {...bad('clientId')}
                    onChange={(e) => set({ clientId: e.target.value })}
                    data-testid="vp-client"
                  >
                    <option value="">選択してください</option>
                    {data.clients
                      .filter((c) => c.active || c.id === draft.clientId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.displayName}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label>
                <span className="row" style={{ gap: 6 }}>
                  種類
                  {typeOf(data.visitTypes, draft.typeId) && <TypeDot type={typeOf(data.visitTypes, draft.typeId)!} />}
                </span>
                <select
                  value={draft.typeId ?? ''}
                  onChange={(e) => {
                    const t = typeOf(data.visitTypes, e.target.value);
                    // 新しい訪問は、種類を選ぶと所要をその種類の標準の所要にする
                    set({
                      typeId: e.target.value || null,
                      ...(isNew && t ? { durationMinutes: t.durationMinutes } : {}),
                    });
                  }}
                  data-testid="vp-type"
                >
                  <option value="">種類なし</option>
                  {data.visitTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                  {draft.typeId && !typeOf(data.visitTypes, draft.typeId) && (
                    <option value={draft.typeId}>（消えた種類）</option>
                  )}
                </select>
              </label>
              <label>
                <span>
                  日付
                  <RequiredMark />
                </span>
                <input
                  type="date"
                  value={draft.date}
                  min={today}
                  required
                  {...bad('date')}
                  onChange={(e) => set({ date: e.target.value || draft.date })}
                  data-testid="vp-date"
                />
              </label>
              <label>
                時間の約束
                <select
                  value={draft.windowKind}
                  onChange={(e) => set({ windowKind: e.target.value as VisitDraft['windowKind'] })}
                  data-testid="vp-window"
                >
                  <option value="fixed">開始時刻が決まっている</option>
                  <option value="window">開始に幅がある（受けられる時間帯）</option>
                </select>
              </label>
              <label>
                <span>
                  {draft.windowKind === 'fixed' ? '開始時刻' : '最も早い開始時刻'}
                  <RequiredMark />
                </span>
                <input
                  type="time"
                  value={draft.earliestStart}
                  required
                  {...bad('earliestStart')}
                  onChange={(e) => {
                    const s = e.target.value;
                    if (!hhmm(s)) return set({ earliestStart: s });
                    // 幅を保ってずらす
                    const w =
                      draft.windowKind === 'window' && hhmm(draft.latestStart)
                        ? toMin(draft.latestStart) - toMin(draft.earliestStart)
                        : 0;
                    set({ earliestStart: s, latestStart: toHm(toMin(s) + Math.max(0, w)) });
                  }}
                  data-testid="vp-start"
                />
              </label>
              {draft.windowKind === 'window' && (
                <label>
                  <span>
                    最も遅い開始時刻
                    <RequiredMark />
                  </span>
                  <input
                    type="time"
                    value={draft.latestStart}
                    required
                    {...bad('latestStart')}
                    onChange={(e) => set({ latestStart: e.target.value })}
                    data-testid="vp-latest"
                  />
                </label>
              )}
              <label>
                <span>
                  所要時間（分）
                  <RequiredMark />
                </span>
                <input
                  type="number"
                  min={5}
                  max={720}
                  value={Number.isFinite(draft.durationMinutes) ? draft.durationMinutes : ''}
                  required
                  {...bad('durationMinutes')}
                  onChange={(e) =>
                    set({ durationMinutes: e.target.value === '' ? Number.NaN : Number(e.target.value) })
                  }
                  data-testid="vp-duration"
                />
              </label>
              <label>
                メモ
                <input
                  value={draft.note}
                  maxLength={200}
                  {...bad('note')}
                  onChange={(e) => set({ note: e.target.value })}
                  data-testid="vp-note"
                />
              </label>
            </div>
          </fieldset>
        )}

        {editable && !newBlocked && choices && (
          <fieldset className="vp-section" data-testid="vp-staff">
            <legend>
              {isNew ? '担当' : '担当を替える'}
              {draft.date !== v?.date && !isNew && <span className="sub">（{dateText(draft.date)}の候補）</span>}
            </legend>
            {choices.why && <p className="sub">{choices.why}</p>}
            <div className="vp-choices" role="radiogroup" aria-label="担当">
              <label className="vp-choice">
                <input
                  type="radio"
                  name="vp-staff"
                  checked={pick === KEEP}
                  onChange={() => setPick(KEEP)}
                  data-testid="vp-staff-keep"
                />
                <span className="vp-choice-text">
                  <span className="vp-choice-name">
                    {isNew ? '選ばない（担当なし。あとで AI で組める）' : '変えない'}
                    {!isNew && current && <span className="sub">（今：{staffName(current)}）</span>}
                  </span>
                </span>
              </label>
              {choices.choices
                .filter((c) => !c.current)
                .map((c) => {
                  const off = !!c.disabled;
                  return (
                    <label
                      key={c.staffId}
                      className={`vp-choice${off ? ' is-off' : ''}`}
                      title={c.disabled || undefined}
                      data-testid="vp-staff-choice"
                      data-staff={c.staffId}
                    >
                      <input
                        type="radio"
                        name="vp-staff"
                        checked={pick === c.staffId}
                        disabled={off}
                        onChange={() => setPick(c.staffId)}
                      />
                      <span className="vp-choice-text">
                        <span className="vp-choice-name with-staff-mark">
                          <StaffMark staff={staffById.get(c.staffId)} size="xs" />
                          {staffName(c.staffId)}
                        </span>
                        <span className="sub vp-choice-desc">{c.disabled || c.description}</span>
                      </span>
                    </label>
                  );
                })}
              {!isNew && current && (
                <label className="vp-choice">
                  <input
                    type="radio"
                    name="vp-staff"
                    checked={pick === NONE_PICK}
                    onChange={() => setPick(NONE_PICK)}
                    data-testid="vp-staff-none"
                  />
                  <span className="vp-choice-text">
                    <span className="vp-choice-name">担当なし（入らなかった訪問へ）</span>
                    <span className="sub vp-choice-desc">ピンも外れます（この回だけ）</span>
                  </span>
                </label>
              )}
            </div>
            <p className="sub">選んだ人にピンが付き、AI で組んでも担当は変わりません。</p>
          </fieldset>
        )}

        {scopes && !narrow && (
          <fieldset className="vp-section" data-testid="vp-scope">
            <legend>変える範囲（繰り返しの回です）</legend>
            {(['once', 'following', 'all'] as const).map((k) => (
              <label key={k} className="check">
                <input
                  type="radio"
                  name="vp-scope"
                  checked={scope === k}
                  onChange={() => setScope(k)}
                  style={{ width: 'auto' }}
                  data-testid={`vp-scope-${k}`}
                />
                {SCOPE_LABELS[k]}
                {k === 'following' && <span className="sub">（{scopes.following}）</span>}
                {k === 'all' && <span className="sub">（{scopes.all}）</span>}
              </label>
            ))}
            {scope !== 'once' && (
              <p className="sub" data-testid="vp-scope-note">
                {scopes.otherDays ? 'ほかの曜日の回は変えません。' : ''}
                {keptText(scope === 'all' ? scopes.keptDates.all : scopes.keptDates.following)}
                担当を選ぶと、範囲の回の担当といつもの担当も替わります。
              </p>
            )}
          </fieldset>
        )}

        <FieldError id={errorId} token={error}>
          {error?.text}
        </FieldError>

        {v && info?.editable && (
          <section className="vp-section vp-cancel" aria-label="取り消し" data-testid="vp-cancel-area">
            {cancelled ? (
              <button type="button" className="btn" onClick={doUncancel} data-testid="vp-uncancel">
                <WithIcon icon={Undo2}>取り消しをやめる</WithIcon>
              </button>
            ) : (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn tone-danger"
                  onClick={() => doCancel(false)}
                  data-testid="vp-cancel"
                >
                  <WithIcon icon={Ban}>取り消す</WithIcon>
                </button>
                <button
                  type="button"
                  className="btn tone-danger"
                  onClick={() => doCancel(true)}
                  data-testid="vp-cancel-sameday"
                >
                  当日キャンセルとして取り消す
                </button>
              </div>
            )}
            {info.pattern && !cancelled && <p className="sub">取り消しはこの回だけです。</p>}
          </section>
        )}

        {v && client && (
          <section className="vp-section" aria-label="決まりごと・道順">
            <VisitRules client={client} />
            {route && (
              <VisitRouteLinks
                to={client.place}
                toName={client.displayName}
                from={route.from}
                fromName={route.fromName}
                mode={route.staff.travelMode}
                testId="vp-route"
              />
            )}
          </section>
        )}
      </div>
    </SidePanel>
  );
}

const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const toHm = (m: number) => {
  const x = Math.min(Math.max(0, m), 23 * 60 + 59);
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};

/** そのままにする回の文（無ければ空） */
function keptText(dates: readonly string[]): string {
  if (dates.length === 0) return '';
  const head = dates
    .slice(0, 4)
    .map((x) => dateText(x))
    .join('・');
  return `この回だけ変えた・取り消した ${dates.length}回（${head}${dates.length > 4 ? ' など' : ''}）はそのままです。`;
}

/** 閉じたときに戻り先が消えていたら、画面の見出しへ（フォーカスを body に落とさない） */
function headingOfPage(): HTMLElement | null {
  const h = document.querySelector<HTMLElement>('.app-main h1');
  if (h && !h.hasAttribute('tabindex')) h.tabIndex = -1;
  return h;
}
