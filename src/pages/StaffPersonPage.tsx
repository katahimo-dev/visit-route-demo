import {
  BadgeCheck,
  CalendarDays,
  CalendarX,
  Clock,
  HeartHandshake,
  Home,
  Plus,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Timer,
  UserRound,
  UserRoundCog,
} from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useConfirm } from '../components/ConfirmDialog';
import { ConditionsEditor, TraitsEditor } from '../components/conditions';
import { type FormErr, invalidAttrs, RequiredMark, toFormErr } from '../components/FieldError';
import { PersonCalendar } from '../components/PersonCalendar';
import { Check } from '../components/parts';
import {
  CondRows,
  DlRow,
  StaffHoursRow,
  StaffLastDayRow,
  StaffTraitRows,
  StaffTravelRow,
} from '../components/personDetail';
import { BackToList, EditSection, type PersonTabDef, PersonTabs, useAskDiscard } from '../components/personPage';
import { placeText, StaffClientRows } from '../components/personView';
import { AddressField } from '../components/placeLookup';
import { StaffMark } from '../components/StaffMark';
import { useToast } from '../components/Toast';
import { Hint, PageHeader, WithIcon } from '../components/ui';
import { useLeaveGuard } from '../components/useLeaveGuard';
import { TRAVEL_MODES, type TravelMode } from '../contracts/codes';
import { type Staff, staffSchema } from '../contracts/documents';
import { availabilityOf, slotsText } from '../domain/availability';
import { addDays, jstDate } from '../domain/time';
import { absenceText } from '../lib/absences';
import { dateText, nameTaken, newId, TRAVEL_MODE_LABELS, WEEKDAY_LABELS } from '../lib/common';
import { encodeStaffFilter } from '../lib/compatView';
import { linkIfOn, suddenHref, workloadHref } from '../lib/links';
import { normalizeEmail } from '../lib/mailto';
import { ymOf } from '../lib/month';
import { offboardScope } from '../lib/offboard';
import { mdText } from '../lib/patternText';
import {
  type CalView,
  calDates,
  calViewOf,
  mergeFields,
  NEW_PERSON_ID,
  pickFields,
  STAFF_TABS,
  type StaffTab,
  staffAbsencesIn,
  tabOf,
} from '../lib/personPage';
import { isRequestedOff, REQUESTED_OFF_NOTE } from '../lib/requestedOff';
import { staffColorMap, staffIconError, surnameInitial } from '../lib/staffMark';
import { useFeature, useFeatures } from '../lib/useFeature';
import { isDirty, orDash } from '../lib/viewMode';
import { hmText, workDayOf, workTotals } from '../lib/workload';
import { useDemoData } from '../store';
import { OffboardPanel } from './OffboardPanel';
import './settings.css';

/**
 * 〈スタッフ〉の画面（`#/staff/:id`。PRD D308〜D310・D312。ADR-0052）：〈利用者さん〉の画面と同じ形で、タブ［予定｜基本情報｜勤務時間｜相性］。
 * 予定は担当している訪問のカレンダー（回を押すと訪問の詳細の欄）・欠勤と希望休・その期間の勤務の見込みの要約。
 * 基本情報・勤務時間は節ごとに「直す → 保存・取り消し」。最終勤務日を入れて保存すると担当の振り直しの欄（ADR-0015）。
 * `#/staff/new` は新しい人（基本の節が開いた形）
 */

const SECTIONS = {
  basic: ['name', 'icon', 'email', 'travelMode', 'active'],
  lastDay: ['lastDay'],
  home: ['home'],
  traits: ['traits'],
  conds: ['requirements', 'preferences'],
  hours: ['workDays', 'shiftStart', 'shiftEnd'],
} as const satisfies Record<string, readonly (keyof Staff)[]>;
type SecKey = keyof typeof SECTIONS;

const blank = (): Staff => ({
  id: newId('s'),
  name: '',
  home: { address: '', lat: null, lng: null },
  travelMode: 'DRIVE',
  workDays: [1, 2, 3, 4, 5],
  shiftStart: '09:00',
  shiftEnd: '18:00',
  active: true,
  traits: {},
  requirements: [],
  preferences: [],
  lastDay: null,
  email: '',
  icon: '',
});

type Edit = { key: SecKey | 'new'; form: Staff; opened: Staff };

export default function StaffPersonPage() {
  const { staffId: rawId = '' } = useParams();
  const [shownId, setShownId] = useState(rawId);
  const { data } = useDemoData();
  const navigate = useNavigate();
  const { search } = useLocation();
  const confirm = useConfirm();
  const leaveOk = useRef(false);
  /** 開いている人の URL のクエリ（断って戻すとき、タブ・カレンダーもそのまま戻す） */
  const searchRef = useRef(search);
  if (rawId === shownId) searchRef.current = search;
  const dirtyRef = useRef(false);
  const who = useRef('');
  // URL の人が替わった：変更があれば確かめ、断れば元の人の URL へ戻す（〈利用者さん〉の画面と同じ）
  // biome-ignore lint/correctness/useExhaustiveDependencies: URL の人が替わったときだけ
  useEffect(() => {
    if (rawId === shownId) return;
    if (!dirtyRef.current || leaveOk.current) {
      leaveOk.current = false;
      setShownId(rawId);
      return;
    }
    const back = shownId;
    const next = data.staff.find((s) => s.id === rawId)?.name ?? '（名前なし）';
    // 画面の移動で待っている確認を取り消す処理（ConfirmDialog）のあとで聞く
    const t = window.setTimeout(() => {
      void confirm({
        title: `変更を捨てて、${next}を開きますか？`,
        body: `${who.current}の変更を保存していません。`,
        confirmLabel: `捨てて${next}を開く`,
        cancelLabel: '編集を続ける',
        tone: 'danger',
      }).then((ok) => {
        if (ok) setShownId(rawId);
        else navigate(`/staff/${encodeURIComponent(back)}${searchRef.current}`, { replace: true });
      });
    });
    return () => window.clearTimeout(t);
  }, [rawId]);
  if (shownId !== NEW_PERSON_ID && !data.staff.some((s) => s.id === shownId)) {
    if (rawId !== shownId) return null;
    return <Navigate to="/staff" replace state={{ missing: shownId }} />;
  }
  return (
    <StaffPageBody
      key={shownId}
      id={shownId}
      onDirty={(d, name) => {
        dirtyRef.current = d;
        who.current = name;
      }}
      onLeave={() => {
        leaveOk.current = true;
      }}
    />
  );
}

function StaffPageBody({
  id,
  onDirty,
  onLeave,
}: {
  id: string;
  onDirty: (dirty: boolean, who: string) => void;
  onLeave: () => void;
}) {
  const { data, update } = useDemoData();
  const terms = data.org.terms;
  const toast = useToast();
  const confirmDialog = useConfirm();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const today = jstDate(Date.now());
  // 機能の入り切り（ADR-0028）
  const offboardOn = useFeature('offboard');
  const compatOn = useFeature('compat');
  const mailOn = useFeature('mail');
  const allowedStaffOn = useFeature('allowedStaff');
  const features = useFeatures();
  const isNew = id === NEW_PERSON_ID;
  const saved = data.staff.find((s) => s.id === id);
  const staffItems = data.items.filter((i) => i.target === 'staff');
  const tab: StaffTab = isNew ? 'basic' : tabOf(STAFF_TABS, params.get('tab'));
  /** 担当の振り直しの欄（最終勤務日を入れて保存したとき。PRD D71） */
  const [offboard, setOffboard] = useState(false);

  // ---- 節の編集 ----
  const [edit, setEdit] = useState<Edit | null>(() => {
    if (!isNew) return null;
    const f = blank();
    return { key: 'new', form: f, opened: structuredClone(f) };
  });
  const [error, setError] = useState<FormErr>(null);
  const sectionDirty = (() => {
    if (!edit) return false;
    if (edit.key === 'new') return isDirty(edit.form, edit.opened);
    if (!saved) return true;
    const keys = SECTIONS[edit.key];
    return isDirty(pickFields(edit.form, keys), pickFields(saved, keys));
  })();
  const whoText = `${(edit?.form.name ?? saved?.name ?? '').trim() || '（名前なし）'}（${terms.staff}）`;
  useEffect(() => {
    onDirty(sectionDirty, whoText);
  }, [sectionDirty, whoText, onDirty]);
  const discardAll = useCallback(() => {
    setEdit(null);
    setError(null);
  }, []);
  useLeaveGuard(
    sectionDirty,
    {
      title: '変更を捨てて移りますか？',
      body: `${whoText}の変更を保存していません。`,
      confirmLabel: '捨てて移る',
      cancelLabel: '編集を続ける',
      tone: 'danger',
    },
    () => {
      onLeave();
      discardAll();
    },
  );
  const ask = useAskDiscard(sectionDirty, whoText);
  const startEdit = async (key: SecKey) => {
    if (!saved || edit?.key === key) return;
    if (!(await ask('section'))) return;
    setError(null);
    setEdit({ key, form: structuredClone(saved), opened: structuredClone(saved) });
  };
  const cancelEdit = async () => {
    if (
      sectionDirty &&
      !(await confirmDialog({
        title: '変更を捨てますか？',
        body: `${whoText}の変更を保存していません。`,
        confirmLabel: '捨てる',
        cancelLabel: '編集を続ける',
        tone: 'danger',
      }))
    )
      return;
    if (edit?.key === 'new') {
      onLeave();
      setEdit(null);
      navigate('/staff');
      return;
    }
    setEdit(null);
    setError(null);
  };
  const setForm = (f: Staff | ((s: Staff) => Staff)) =>
    setEdit((e) => (e ? { ...e, form: typeof f === 'function' ? f(e.form) : f } : e));
  const form = edit?.form ?? null;
  /** 誤りの文の id（節の誤りの文と入力欄の aria-describedby で同じもの） */
  const errorId = useId();
  const bad = (field: string) => invalidAttrs(error?.field === field, errorId);
  /** 編集中の印の見本の色（保存したあとの名前の並びで決まる色） */
  const previewColor = useMemo(
    () =>
      form
        ? staffColorMap([
            ...data.staff.filter((x) => x.id !== form.id),
            { ...form, name: form.name.trim() || form.name },
          ]).get(form.id)
        : undefined,
    [form, data.staff],
  );

  const save = async () => {
    if (!edit) return;
    setError(null);
    const key = edit.key;
    const base = key === 'new' || !saved ? edit.form : mergeFields(saved, edit.form, SECTIONS[key]);
    /** 検査するのは直している節の項目だけ（ほかの節の古い値で保存を止めない） */
    const keys: readonly (keyof Staff)[] = key === 'new' ? (Object.keys(base) as (keyof Staff)[]) : SECTIONS[key];
    const touches = (k: keyof Staff) => keys.includes(k);
    if (touches('name') && nameTaken(data.staff, (x) => x.name, base.name, base.id)) {
      setError({
        text: `「${base.name.trim()}」と同じ名前の${terms.staff}がいます。名前を変えてください`,
        field: 'name',
      });
      return;
    }
    const email = touches('email') ? normalizeEmail(base.email) : base.email;
    if (email === null) {
      setError({ text: 'メールアドレスの形ではありません（例 name@example.com）。空でも構いません', field: 'email' });
      return;
    }
    const icon = base.icon.trim();
    const iconErr = touches('icon') ? staffIconError(icon) : null;
    if (iconErr) {
      setError({ text: iconErr, field: 'icon' });
      return;
    }
    try {
      const s = staffSchema.parse({ ...base, email, icon });
      // 休止にするとき、〈利用者さん〉の「担当できる人」から外す（ADR-0014）
      const limited = s.active ? [] : data.clients.filter((c) => c.allowedStaffIds.includes(s.id));
      if (limited.length > 0 && allowedStaffOn) {
        const activeOther = new Set(data.staff.filter((x) => x.active && x.id !== s.id).map((x) => x.id));
        const emptied = limited.filter((c) => !c.allowedStaffIds.some((sid) => activeOther.has(sid)));
        const ok = await confirmDialog({
          title: `${s.name}さんを休止にして保存しますか？`,
          body: `${limited.map((c) => c.displayName).join('・')}の「担当できる人」から外します。${
            emptied.length > 0
              ? `${emptied.map((c) => c.displayName).join('・')}は担当できる人がいなくなり、だれでも担当できるようになります（必要なら${terms.client}の画面で選び直してください）。`
              : ''
          }\nあとで利用中に戻しても、担当できる人には戻りません。`,
          confirmLabel: '休止にして保存する',
        });
        if (!ok) return;
      }
      // 最終勤務日を入れた・変えたら、保存のあとに担当の振り直しの欄を開く（振り直すものがあるときだけ。ADR-0015）
      const lastDayChanged = s.active && s.lastDay !== null && saved?.lastDay !== s.lastDay;
      const nextData = {
        ...data,
        staff: data.staff.some((x) => x.id === s.id)
          ? data.staff.map((x) => (x.id === s.id ? s : x))
          : [...data.staff, s],
      };
      const sc = lastDayChanged && offboardOn ? offboardScope(nextData, s.id, today, false) : null;
      update((d) => ({
        ...d,
        staff: d.staff.some((x) => x.id === s.id) ? d.staff.map((x) => (x.id === s.id ? s : x)) : [...d.staff, s],
        clients: s.active
          ? d.clients
          : d.clients.map((c) =>
              c.allowedStaffIds.includes(s.id)
                ? { ...c, allowedStaffIds: c.allowedStaffIds.filter((x) => x !== s.id) }
                : c,
            ),
      }));
      setEdit(null);
      if (sc && (sc.clients.length > 0 || sc.visits.length > 0)) {
        setOffboard(true);
        toast(`保存しました。${mdText(addDays(s.lastDay ?? '', 1))}からの担当を振り直してください`);
      } else toast('保存しました');
      if (key === 'new') {
        onLeave();
        navigate(`/staff/${encodeURIComponent(s.id)}?tab=basic`, { replace: true });
      }
    } catch (e) {
      setError(toFormErr(e));
    }
  };

  // ---- 予定のカレンダー ----
  const calView = calViewOf(params.get('cal'));
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.get('d') ?? '') ? params.get('d')! : today;
  const setCal = ({ view, anchor: a }: { view: CalView; anchor: string }) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (view === 'week') p.delete('cal');
        else p.set('cal', view);
        if (a === today) p.delete('d');
        else p.set('d', a);
        return p;
      },
      { replace: true },
    );
  const range = useMemo(() => {
    const ds = calDates(calView, anchor);
    return calView === 'month' ? ds.filter((d) => ymOf(d) === ymOf(anchor)) : ds;
  }, [calView, anchor]);
  /** その期間の勤務の見込み（今の案、無ければ確定した割当。予定のタブのときだけ数える） */
  const work = useMemo(() => {
    if (tab !== 'schedule' || !saved) return null;
    const days = range.map((d) => workDayOf(data, d));
    return workTotals(days).get(saved.id) ?? null;
  }, [tab, saved, range, data]);
  const absences = useMemo(
    () => (saved ? staffAbsencesIn(data, saved.id, today, addDays(today, 60)) : []),
    [data, saved, today],
  );
  const overrides = useMemo(
    () =>
      saved
        ? data.availability
            .filter((a) => a.staffId === saved.id && a.date >= today)
            .sort((a, b) => (a.date < b.date ? -1 : 1))
        : [],
    [data.availability, saved, today],
  );

  // 新しい人を保存・取り消して移る間（節を閉じたあと）は何も出さない
  if (!saved && !edit) return null;
  const s = saved ?? edit?.form;
  if (!s) return null;
  const editing = (k: SecKey) => edit?.key === k;
  const sec = (key: SecKey) => ({
    name: key,
    editing: editing(key),
    onEdit: () => void startEdit(key),
    onSave: save,
    onCancel: () => void cancelEdit(),
    error: editing(key) ? error : null,
    errorId,
  });
  const tabs: PersonTabDef<StaffTab>[] = [
    { key: 'schedule', label: '予定', icon: CalendarDays, disabled: isNew ? '保存してから見られます' : false },
    { key: 'basic', label: '基本情報', icon: UserRound },
    { key: 'hours', label: '勤務時間', icon: Clock, disabled: isNew ? '保存してから直せます' : false },
    {
      key: 'compat',
      label: compatOn ? '相性' : '担当',
      icon: HeartHandshake,
      disabled: isNew ? '保存してから見られます' : false,
    },
  ];
  const workloadTo = linkIfOn(features, workloadHref(ymOf(anchor), id));
  const absenceOf = (d: string) => data.absences.find((a) => a.staffId === id && a.date === d);
  const dayNote = (d: string) => {
    const a = absenceOf(d);
    if (a)
      return (
        <span className="chip chip-warn pcal-chip" title={a.note || undefined}>
          {isRequestedOff(a) ? REQUESTED_OFF_NOTE : '欠勤'}
        </span>
      );
    const av = availabilityOf(
      s,
      d,
      data.availability.find((x) => x.staffId === id && x.date === d),
    );
    return av.slots.length === 0 ? <span className="chip pcal-chip">勤務なし</span> : null;
  };

  // ---- 節の中身 ----
  const basicView = (
    <>
      <div className="with-staff-mark" data-testid="view-staff-mark">
        <StaffMark staff={s} size="lg" />
        <span className="sub">{s.icon ? `アイコン「${s.icon}」` : 'アイコンは未設定（苗字の最初の1文字）'}</span>
      </div>
      <dl>
        <DlRow term="状態" value={s.active ? '利用中' : '休止中'} />
        {mailOn && <DlRow term="メールアドレス" value={orDash(s.email)} />}
        <StaffTravelRow staff={s} />
      </dl>
    </>
  );
  const basicFields = form && (
    <>
      <div className="form-grid">
        <label>
          <span>
            名前
            <RequiredMark />
          </span>
          <input
            value={form.name}
            maxLength={50}
            required
            {...bad('name')}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            data-testid="staff-name"
          />
        </label>
        {/* アイコン（任意の1〜2文字。PRD D299。ADR-0050）。空なら苗字の最初の1文字を薄く出す */}
        <label>
          アイコン（1〜2文字・任意）
          <span className="staff-icon-field">
            <StaffMark staff={form} size="lg" color={previewColor} />
            <input
              value={form.icon}
              maxLength={32}
              autoComplete="off"
              placeholder={surnameInitial(form.name)}
              {...bad('icon')}
              onChange={(e) => setForm({ ...form, icon: e.target.value })}
              data-testid="staff-icon"
            />
          </span>
          <span className="sub">印の中に出す文字（絵文字も可）。空なら苗字の最初の1文字</span>
        </label>
        {mailOn && (
          <label>
            メールアドレス（任意）
            <input
              type="email"
              value={form.email}
              maxLength={254}
              autoComplete="off"
              placeholder="name@example.com"
              {...bad('email')}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              data-testid="staff-email"
            />
            <span className="sub">予定をメールアプリで開くときの宛先（送信は人が押します）</span>
          </label>
        )}
        <label>
          移動手段
          <select
            value={form.travelMode}
            onChange={(e) => setForm({ ...form, travelMode: e.target.value as TravelMode })}
          >
            {TRAVEL_MODES.map((t) => (
              <option key={t} value={t}>
                {TRAVEL_MODE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Check checked={form.active} onChange={(c) => setForm({ ...form, active: c })}>
        利用中（外すと休止）
      </Check>
    </>
  );
  const hoursFields = form && (
    <>
      <div className="form-grid">
        <label>
          勤務開始
          <input
            type="time"
            step={1800}
            value={form.shiftStart}
            {...bad('shiftStart')}
            onChange={(e) => setForm({ ...form, shiftStart: e.target.value })}
            data-testid="staff-shift-start"
          />
        </label>
        <label>
          勤務終了
          <input
            type="time"
            step={1800}
            value={form.shiftEnd}
            {...bad('shiftEnd')}
            onChange={(e) => setForm({ ...form, shiftEnd: e.target.value })}
            data-testid="staff-shift-end"
          />
        </label>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <span className="sub">勤務する曜日</span>
        {WEEKDAY_LABELS.map((w, d) => (
          <Check
            key={w}
            checked={form.workDays.includes(d)}
            onChange={(c) =>
              setForm({
                ...form,
                workDays: c ? [...form.workDays, d].sort() : form.workDays.filter((x) => x !== d),
              })
            }
          >
            {w}
          </Check>
        ))}
      </div>
    </>
  );
  const lastDayFields = form && (
    <>
      <Hint>
        <ul className="hint-list">
          <li>退職や担当替えで、この日を最後に勤務しなくなるときに入れます。</li>
          <li>翌日からは予定に入りません。</li>
          <li>
            保存すると、その人が担当している{terms.client}の代わりの{terms.staff}を選ぶ欄が開きます。
          </li>
        </ul>
      </Hint>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <label className="row" style={{ gap: 6 }}>
          最終勤務日
          <input
            type="date"
            value={form.lastDay ?? ''}
            {...bad('lastDay')}
            onChange={(e) => setForm({ ...form, lastDay: e.target.value || null })}
            data-testid="staff-lastday-input"
            style={{ width: 'auto' }}
          />
        </label>
        {form.lastDay && (
          <button type="button" className="btn btn-small" onClick={() => setForm({ ...form, lastDay: null })}>
            最終勤務日を消す
          </button>
        )}
        {form.lastDay && <span className="sub">{mdText(addDays(form.lastDay, 1))}から勤務なし</span>}
      </div>
    </>
  );

  return (
    <div
      className="stack person-page person-view"
      data-testid="person-view"
      data-kind="staff"
      data-id={isNew ? '' : id}
    >
      <PageHeader
        icon={isNew ? Plus : UserRound}
        title={
          isNew ? (
            `${terms.staff}を追加`
          ) : (
            <span className="with-staff-mark">
              <StaffMark staff={s} size="md" />
              {s.name}
            </span>
          )
        }
        lead={
          isNew ? (
            `${terms.staff}の名前を入れて保存します`
          ) : (
            <span className="person-state" data-testid="person-state">
              <span className="chip">{s.active ? '利用中' : '休止中'}</span>
              {s.lastDay && (
                <span className="chip chip-lastday" data-testid="staff-lastday">
                  最終 {mdText(s.lastDay)}
                </span>
              )}
              <span className="sub">
                {s.workDays.map((d) => WEEKDAY_LABELS[d]).join('')} {s.shiftStart}〜{s.shiftEnd}
              </span>
            </span>
          )
        }
        actions={
          <>
            {!isNew && (
              <Link className="btn btn-text" to={`/staff-view/${encodeURIComponent(id)}`} data-testid="to-staff-view">
                <WithIcon icon={Smartphone}>{s.name}さんの画面で見る</WithIcon>
              </Link>
            )}
            <BackToList to="/staff" label={`${terms.staff}一覧`} />
          </>
        }
        nav={
          <PersonTabs
            tabs={tabs}
            current={tab}
            ask={async () => {
              // 替えるなら直している節・繰り返し・休みの入力を捨てる（戻ったときに古い下書きを出さない）
              const ok = await ask('tab');
              if (ok) discardAll();
              return ok;
            }}
            label={`${terms.staff}の画面の切り替え`}
          />
        }
      />

      {tab === 'schedule' && saved && (
        <div className="person-schedule" data-testid="person-schedule">
          <div className="person-schedule-side">
            <section className="card stack" data-testid="staff-work">
              <h2 className="person-subhead">
                <WithIcon icon={Timer} size={16}>
                  この期間の勤務の見込み
                </WithIcon>
              </h2>
              {work ? (
                <dl>
                  <DlRow term="訪問" value={`${work.count}件（${work.days}日）`} />
                  <DlRow term="拘束" value={`${hmText(work.span)}（いちばん長い日 ${hmText(work.maxSpan)}）`} />
                  <DlRow term="移動" value={hmText(work.travel)} />
                  {work.overDays > 0 && <DlRow term="上限を超える日" value={`${work.overDays}日`} />}
                </dl>
              ) : (
                <span className="sub">この期間に担当する訪問はありません（案のある日だけ数えます）。</span>
              )}
              {workloadTo && (
                <Link to={workloadTo} className="btn btn-small btn-text" data-testid="to-workload">
                  勤務の見込みで詳しく見る
                </Link>
              )}
            </section>
            <section className="card stack" data-testid="staff-absences">
              <h2 className="person-subhead">
                <WithIcon icon={CalendarX} size={16}>
                  欠勤・{REQUESTED_OFF_NOTE}（これから60日）
                </WithIcon>
              </h2>
              {absences.length === 0 ? (
                <span className="sub">欠勤・{REQUESTED_OFF_NOTE}はありません</span>
              ) : (
                <ul className="person-list">
                  {absences.map((a) => (
                    <li key={a.id}>
                      <strong>{dateText(a.date)}</strong>{' '}
                      <span className="sub">
                        {isRequestedOff(a) ? REQUESTED_OFF_NOTE : `欠勤 ${absenceText(a)}`}
                        {a.note && !isRequestedOff(a) ? `・${a.note}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <span className="sub">
                急な欠勤は「欠勤・キャンセルを登録」、{REQUESTED_OFF_NOTE}は月の予定の「休みを入れる」で入れます。
              </span>
              {linkIfOn(features, suddenHref(today, id)) && (
                <Link to={suddenHref(today, id)} className="btn btn-small btn-text" data-testid="to-sudden">
                  今日の欠勤を登録する
                </Link>
              )}
            </section>
            {offboardOn && s.lastDay && (
              <section className="card stack">
                <span className="sub">最終勤務日 {mdText(s.lastDay)}</span>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => setOffboard(true)}
                  data-testid="leaving-open"
                >
                  <WithIcon icon={UserRoundCog} size={14}>
                    担当の振り直しを開く
                  </WithIcon>
                </button>
              </section>
            )}
          </div>
          <div className="person-schedule-main card">
            <PersonCalendar
              kind="staff"
              personId={id}
              view={calView}
              anchor={anchor}
              onChange={setCal}
              dayNote={dayNote}
            />
          </div>
        </div>
      )}

      {tab === 'basic' && (
        <div className="person-sections">
          {isNew && edit ? (
            <EditSection
              name="new"
              icon={UserRound}
              title="基本"
              editing
              onEdit={() => {}}
              onSave={save}
              onCancel={() => void cancelEdit()}
              error={error}
              errorId={errorId}
              view={null}
            >
              {basicFields}
              {hoursFields}
              <Hint label="ほかの項目">自宅・特性・求めること・最終勤務日は、保存してから入れられます。</Hint>
            </EditSection>
          ) : (
            <>
              <EditSection {...sec('basic')} icon={UserRound} title="基本" view={basicView}>
                {basicFields}
              </EditSection>
              <EditSection
                {...sec('home')}
                icon={Home}
                title="自宅"
                view={
                  <dl>
                    <DlRow term="住所" value={orDash(s.home.address)} />
                    <DlRow term="地図の位置" value={placeText(s.home)} />
                  </dl>
                }
              >
                {/* 郵便番号は住所を探すためだけで保存しない（自宅は契約の Place のまま。PRD D121） */}
                {form && (
                  <AddressField
                    value={form.home}
                    onChange={(home) => setForm((f) => ({ ...f, home }))}
                    testId="staff-home"
                    postalLabel="郵便番号（任意。住所を探すためだけで、保存しません）"
                  />
                )}
              </EditSection>
              <EditSection
                {...sec('traits')}
                icon={BadgeCheck}
                title="特性"
                view={
                  <dl>
                    <StaffTraitRows staff={s} data={data} />
                  </dl>
                }
              >
                {form && (
                  <TraitsEditor
                    items={staffItems}
                    value={form.traits}
                    onChange={(traits) => setForm({ ...form, traits })}
                  />
                )}
              </EditSection>
              <EditSection
                {...sec('conds')}
                icon={SlidersHorizontal}
                title={`${terms.client}に求めること`}
                view={
                  <dl>
                    <CondRows requirements={s.requirements} preferences={s.preferences} data={data} />
                  </dl>
                }
              >
                {form && (
                  <>
                    <h3 className="person-subhead">
                      <WithIcon icon={SlidersHorizontal} size={16}>
                        必要条件
                      </WithIcon>
                    </h3>
                    <Hint>
                      {terms.client}
                      の特性への条件です。例：ペットのいる家を避けるなら、「ペットあり」を「なし」にします。合わない
                      {terms.client}は、点が下がるか、必須なら担当になりません。
                    </Hint>
                    <ConditionsEditor
                      items={data.items}
                      target="client"
                      value={form.requirements}
                      onChange={(requirements) => setForm({ ...form, requirements })}
                    />
                    <h3 className="person-subhead">
                      <WithIcon icon={Sparkles} size={16}>
                        希望
                      </WithIcon>
                    </h3>
                    <ConditionsEditor
                      items={data.items}
                      target="client"
                      value={form.preferences}
                      onChange={(preferences) => setForm({ ...form, preferences })}
                    />
                  </>
                )}
              </EditSection>
              {offboardOn && (
                <EditSection
                  {...sec('lastDay')}
                  icon={CalendarX}
                  title="最終勤務日（退職・担当替え）"
                  view={
                    <dl>
                      <StaffLastDayRow staff={s} />
                    </dl>
                  }
                >
                  {lastDayFields}
                </EditSection>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'hours' && saved && (
        <div className="person-sections">
          <EditSection
            {...sec('hours')}
            icon={Clock}
            title="ふだんの勤務"
            view={
              <dl>
                <StaffHoursRow staff={s} />
              </dl>
            }
          >
            {hoursFields}
          </EditSection>
          <section className="card stack person-sec" data-testid="person-sec" data-section="overrides">
            <div className="section-title">
              <h2>
                <CalendarDays size={18} strokeWidth={2.2} aria-hidden="true" />
                日ごとに変えた勤務（これから）
              </h2>
              <div className="section-aside">
                <Link to="/availability" className="btn btn-small" data-testid="to-availability">
                  勤務時間（シフト）で直す
                </Link>
              </div>
            </div>
            {overrides.length === 0 ? (
              <span className="sub">日ごとに変えた勤務はありません</span>
            ) : (
              <ul className="person-list">
                {overrides.map((o) => (
                  <li key={o.date}>
                    <strong>{dateText(o.date)}</strong> <span className="sub">{slotsText(o.slots)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {tab === 'compat' && saved && (
        <div className="person-sections">
          <section className="card stack person-sec" data-testid="person-sec" data-section="compat">
            <div className="section-title">
              <h2>
                <HeartHandshake size={18} strokeWidth={2.2} aria-hidden="true" />
                {compatOn ? '相性・担当' : '担当'}
              </h2>
              <div className="section-aside">
                {compatOn && (
                  <Link
                    to={`/compat?sf=${encodeURIComponent(encodeStaffFilter({ query: saved.name, chips: [] }))}`}
                    className="btn btn-small"
                    data-testid="to-compat"
                  >
                    相性の表で直す
                  </Link>
                )}
              </div>
            </div>
            <dl>
              <StaffClientRows staff={saved} data={data} compatOn={compatOn} />
            </dl>
          </section>
        </div>
      )}

      {offboardOn && offboard && saved && <OffboardPanel staffId={saved.id} onClose={() => setOffboard(false)} />}
    </div>
  );
}
