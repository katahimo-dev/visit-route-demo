import {
  BadgeCheck,
  BedSingle,
  BookmarkCheck,
  BookmarkX,
  CalendarDays,
  DoorOpen,
  HeartHandshake,
  House,
  Plus,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useConfirm } from '../components/ConfirmDialog';
import { CondChips, ConditionsEditor, TraitsEditor } from '../components/conditions';
import { type FormErr, invalidAttrs, RequiredMark, toFormErr } from '../components/FieldError';
import { PersonCalendar } from '../components/PersonCalendar';
import { PickChips } from '../components/PickChips';
import { Check, TentativeMark } from '../components/parts';
import { ClientAreaRow, ClientStaffRows, CondRows, DlRow } from '../components/personDetail';
import { BackToList, EditSection, type PersonTabDef, PersonTabs, useAskDiscard } from '../components/personPage';
import { ClientCompatRows, PersonNames, placeText } from '../components/personView';
import { ClientPlaceEditor } from '../components/placeLookup';
import { RouteMap } from '../components/RouteMap';
import { StaffMarkById } from '../components/StaffMark';
import { useToast } from '../components/Toast';
import { Hint, PageHeader, WithIcon } from '../components/ui';
import { useLeaveGuard } from '../components/useLeaveGuard';
import { VISIT_RULE_FIELDS } from '../components/VisitRules';
import { type Client, type ClientStage, clientSchema, EMPTY_REFERRER } from '../contracts/documents';
import { leaveOn } from '../domain/leaves';
import { jstDate } from '../domain/time';
import { EMPTY_FILTER, encodeFilter } from '../lib/clientFilter';
import { isBeforeActive, STAGE_LABELS, stageChoices, withStage } from '../lib/clientStage';
import { CLIENT_COLORS, colorOf, initialOf } from '../lib/colors';
import { byName, hasLocation, nameTaken, newId } from '../lib/common';
import { traitText } from '../lib/compatView';
import { leavesOf } from '../lib/leaves';
import { normalizeEmail } from '../lib/mailto';
import { mdText } from '../lib/patternText';
import {
  type CalView,
  CLIENT_TABS,
  type ClientTab,
  calViewOf,
  mergeFields,
  NEW_PERSON_ID,
  pickFields,
  tabOf,
} from '../lib/personPage';
import { keepStorePlace } from '../lib/placeAll';
import { formatPostalCode, normalizePostalCode } from '../lib/postalCode';
import { cancelTentative as cancelTentativeData, confirmedDatesOf } from '../lib/tentative';
import { useFeature } from '../lib/useFeature';
import { COMPACT_QUERY, useMedia } from '../lib/useMedia';
import { usualStaffOf } from '../lib/usualStaff';
import { isDirty, orDash } from '../lib/viewMode';
import { useDemoData } from '../store';
import { ClientLeavesSection } from './ClientLeavesSection';
import { PatternsSection } from './PatternsSection';
import './settings.css';

/**
 * 〈利用者さん〉の画面（`#/clients/:id`。PRD D308〜D311。ADR-0052）：全画面に、上に名前と状態、タブ［予定｜基本情報｜担当・相性｜休み］。
 * 予定は左に繰り返し（定期パターン）と休み、右に週・月のカレンダー（components/PersonCalendar。回を押すと訪問の詳細の欄）。
 * 基本情報・担当・相性は節ごとに「直す → 保存・取り消し」（components/personPage の EditSection）。繰り返し・休みも保存を押すまで変えない。
 * 変更があるまま離れる・タブを替える・別の人へ移るときは確かめる（断れば続ける）。`#/clients/new` は新しい人（基本の節が開いた形）
 */

/** 節と、その節で保存する項目（ほかの節の項目を古い入力で上書きしない） */
const SECTIONS = {
  basic: ['displayName', 'kana', 'note', 'color'],
  stage: ['stage', 'tentative', 'active', 'referrer'],
  place: ['place'],
  traits: ['traits'],
  rules: ['entryNote', 'keyNote', 'parkingNote', 'cautionNote'],
  staffing: ['allowedStaffIds'],
  conds: ['requirements', 'preferences'],
} as const satisfies Record<string, readonly (keyof Client)[]>;
type SecKey = keyof typeof SECTIONS;
/** 節のあるタブ */
const SECTION_TAB: Record<SecKey, ClientTab> = {
  basic: 'basic',
  stage: 'basic',
  place: 'basic',
  traits: 'basic',
  rules: 'basic',
  staffing: 'staffing',
  conds: 'staffing',
};
const ALL_FIELDS = [...new Set(Object.values(SECTIONS).flat())] as (keyof Client)[];

const blank = (nextColor: number): Client => ({
  id: newId('c'),
  displayName: '',
  kana: '',
  place: { address: '', lat: null, lng: null, postalCode: '' },
  note: '',
  color: nextColor % CLIENT_COLORS.length,
  active: true,
  traits: {},
  requirements: [],
  preferences: [],
  tentative: false,
  entryNote: '',
  keyNote: '',
  parkingNote: '',
  cautionNote: '',
  allowedStaffIds: [],
  stage: 'active',
  referrer: { ...EMPTY_REFERRER },
});

/** 直している節（new は新しい人の全部の項目） */
type Edit = { key: SecKey | 'new'; form: Client; limit: boolean; openedLimit: boolean; opened: Client };

export default function ClientPage() {
  const { id: rawId = '' } = useParams();
  // 開いている人（URL の人と違うのは、変更があるまま URL が替わって確かめている間だけ）
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
  // URL の人が替わった（パレット・吹き出しのリンク・hash の書き換え）：変更があれば確かめ、断れば元の人の URL へ戻す
  // biome-ignore lint/correctness/useExhaustiveDependencies: URL の人が替わったときだけ
  useEffect(() => {
    if (rawId === shownId) return;
    if (!dirtyRef.current || leaveOk.current) {
      leaveOk.current = false;
      setShownId(rawId);
      return;
    }
    const back = shownId;
    const next = data.clients.find((c) => c.id === rawId)?.displayName ?? '（名前なし）';
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
        else navigate(`/clients/${encodeURIComponent(back)}${searchRef.current}`, { replace: true });
      });
    });
    return () => window.clearTimeout(t);
  }, [rawId]);
  if (shownId !== NEW_PERSON_ID && !data.clients.some((c) => c.id === shownId)) {
    if (rawId !== shownId) return null;
    return <Navigate to="/clients" replace state={{ missing: shownId }} />;
  }
  return (
    <ClientPageBody
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

function ClientPageBody({
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
  const narrow = useMedia(COMPACT_QUERY);
  const today = jstDate(Date.now());
  // 機能の入り切り（ADR-0028）：切った機能の入力の欄・表示を出さない（データは消さず、保存しても今の値を残す）
  const stageOn = useFeature('clientStage');
  const allowedOn = useFeature('allowedStaff');
  const leavesOn = useFeature('clientLeave');
  const notesOn = useFeature('visitNotes');
  const compatOn = useFeature('compat');
  const isNew = id === NEW_PERSON_ID;
  const saved = data.clients.find((c) => c.id === id);
  const staff = useMemo(() => [...data.staff].sort(byName), [data.staff]);
  const activeStaff = useMemo(() => staff.filter((s) => s.active), [staff]);
  const clientItems = data.items.filter((i) => i.target === 'client');
  const itemById = new Map(data.items.map((i) => [i.id, i]));
  const staffName = (sid: string | null) => (sid ? (staff.find((s) => s.id === sid)?.name ?? '（不明）') : '');
  const tab: ClientTab = isNew ? 'basic' : tabOf(CLIENT_TABS, params.get('tab'));

  // ---- 節の編集 ----
  const limitOf = (c: Client) => c.allowedStaffIds.some((sid) => staff.some((s) => s.id === sid && s.active));
  const [edit, setEdit] = useState<Edit | null>(() => {
    if (!isNew) return null;
    const f = blank(data.clients.length);
    return { key: 'new', form: f, limit: false, openedLimit: false, opened: structuredClone(f) };
  });
  const [error, setError] = useState<FormErr>(null);
  const [resetKey, setResetKey] = useState(0);
  const [childDirty, setChildDirty] = useState({ patterns: false, leaves: false });
  const onPatternsDirty = useCallback(
    (d: boolean) => setChildDirty((x) => (x.patterns === d ? x : { ...x, patterns: d })),
    [],
  );
  const onLeavesDirty = useCallback(
    (d: boolean) => setChildDirty((x) => (x.leaves === d ? x : { ...x, leaves: d })),
    [],
  );
  /** 担当できる人は保存のときと同じ値（限らなければ空、限るなら利用中の人だけ）にそろえて比べる */
  const allowedAsSaved = (c: Client, lim: boolean) =>
    lim ? c.allowedStaffIds.filter((sid) => staff.some((s) => s.id === sid && s.active)) : [];
  const sectionDirty = (() => {
    if (!edit) return false;
    if (edit.key === 'new') return isDirty(edit.form, edit.opened);
    if (!saved) return true;
    const keys = SECTIONS[edit.key];
    if (edit.key === 'staffing')
      return isDirty(
        { ...pickFields(edit.form, keys), allowedStaffIds: allowedAsSaved(edit.form, edit.limit) },
        { ...pickFields(saved, keys), allowedStaffIds: allowedAsSaved(saved, edit.openedLimit) },
      );
    return isDirty(pickFields(edit.form, keys), pickFields(saved, keys));
  })();
  const dirty = sectionDirty || childDirty.patterns || childDirty.leaves;
  const whoText = `${(edit?.form.displayName ?? saved?.displayName ?? '').trim() || '（名前なし）'}（${terms.client}）`;
  useEffect(() => {
    onDirty(dirty, whoText);
  }, [dirty, whoText, onDirty]);
  /** 変更を捨てる（節・繰り返し・休みの入力を閉じる） */
  const discardAll = () => {
    setEdit(null);
    setError(null);
    setResetKey((k) => k + 1);
    setChildDirty({ patterns: false, leaves: false });
  };
  // 変更があるまま画面を離れる（メニュー・リンク・パレット・再読込）ときは確かめる（PRD D311）
  useLeaveGuard(
    dirty,
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
  const ask = useAskDiscard(dirty, whoText);
  const startEdit = async (key: SecKey) => {
    if (!saved || edit?.key === key) return;
    if (!(await ask('section'))) return;
    discardAll();
    const lim = limitOf(saved);
    setEdit({ key, form: structuredClone(saved), limit: lim, openedLimit: lim, opened: structuredClone(saved) });
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
      // 新しい人を取り消したら一覧へ（何も入れていなければ確かめない）
      onLeave();
      setEdit(null);
      navigate('/clients');
      return;
    }
    setEdit(null);
    setError(null);
  };
  const setForm = (f: Client | ((c: Client) => Client)) =>
    setEdit((e) => (e ? { ...e, form: typeof f === 'function' ? f(e.form) : f } : e));
  const setLimit = (on: boolean) => setEdit((e) => (e ? { ...e, limit: on } : e));
  const form = edit?.form ?? null;
  /** 誤りの文の id（節の誤りの文と入力欄の aria-describedby で同じもの） */
  const errorId = useId();
  const bad = (field: string) => invalidAttrs(error?.field === field, errorId);
  // 「まとめて地図に置く」の「編集」などから節を開いて来たとき（`?edit=place`）。開いたら URL から消す
  const editParam = params.get('edit');
  // biome-ignore lint/correctness/useExhaustiveDependencies: URL の edit が替わったときだけ
  useEffect(() => {
    if (!editParam) return;
    if (editParam in SECTIONS && saved) {
      const lim = limitOf(saved);
      setEdit({
        key: editParam as SecKey,
        form: structuredClone(saved),
        limit: lim,
        openedLimit: lim,
        opened: structuredClone(saved),
      });
    }
    // 節のあるタブへ移す（予定のタブなど、節の無いタブで開いたとき）
    const onTab = editParam in SECTIONS ? SECTION_TAB[editParam as SecKey] : null;
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete('edit');
        if (onTab) p.set('tab', onTab);
        return p;
      },
      { replace: true },
    );
  }, [editParam]);

  /** 保存（節の項目だけを保存した中身に重ねる。新しい人は全部） */
  const save = () => {
    if (!edit) return;
    setError(null);
    const key = edit.key;
    const keys: readonly (keyof Client)[] = key === 'new' ? ALL_FIELDS : SECTIONS[key];
    /** 検査するのは直している節の項目だけ（ほかの節の古い値で保存を止めない） */
    const touches = (k: keyof Client) => keys.includes(k);
    const base = key === 'new' || !saved ? edit.form : mergeFields(saved, edit.form, keys);
    // 担当を限るなら利用中の人を1人以上（休止中の人は数えない。保存時に外す。ADR-0014）。切っていれば今の値のまま
    const allowed =
      key !== 'staffing' || !allowedOn
        ? base.allowedStaffIds
        : edit.limit
          ? base.allowedStaffIds.filter((sid) => staff.some((s) => s.id === sid && s.active))
          : [];
    if (key === 'staffing' && allowedOn && edit.limit && allowed.length === 0) {
      setError({ text: `担当できる${terms.staff}を1人以上選ぶか、「担当できる人を限る」を外してください` });
      return;
    }
    // 郵便番号はハイフン・全角を受けて7桁に直す（ADR-0016）。直せなければ保存しない
    const postalCode = touches('place') ? normalizePostalCode(base.place.postalCode) : base.place.postalCode;
    if (postalCode === null) {
      setError({
        text: '郵便番号は7桁の数字で入れてください（ハイフンは有っても無くても構いません。空でも構いません）',
      });
      return;
    }
    // 紹介元のメールアドレス（任意。ADR-0017）
    const referrerEmail = touches('referrer') ? normalizeEmail(base.referrer.email) : base.referrer.email;
    if (referrerEmail === null) {
      setError({
        text: '紹介元のメールアドレスの形ではありません（例 name@example.com）。空でも構いません',
        field: 'referrer',
      });
      return;
    }
    // 同じ名前は保存しない（Excel では名前で人を引くため。ADR-0006）
    if (touches('displayName') && nameTaken(data.clients, (x) => x.displayName, base.displayName, base.id)) {
      setError({
        text: `「${base.displayName.trim()}」と同じ名前の${terms.client}がいます。名前を変えてください`,
        field: 'displayName',
      });
      return;
    }
    try {
      // 段階に合わせて予定の対象（active）・仮押さえを決める（ADR-0015）
      const c = clientSchema.parse(
        withStage(
          {
            ...base,
            allowedStaffIds: allowed,
            referrer: { ...base.referrer, email: referrerEmail },
            // 節を開いた後に「まとめて地図に置く」が書いた位置・住所は、節で触っていなければ残す（ADR-0016）
            place: {
              ...(key === 'place' || key === 'new'
                ? keepStorePlace(edit.form.place, edit.opened.place, saved?.place)
                : base.place),
              postalCode,
            },
          },
          base.stage,
          base.tentative,
        ),
      );
      update((d) => ({
        ...d,
        clients: d.clients.some((x) => x.id === c.id)
          ? d.clients.map((x) => (x.id === c.id ? c : x))
          : [...d.clients, c],
      }));
      setEdit(null);
      toast(
        c.stage === 'ended' && saved?.stage !== 'ended'
          ? `保存しました。${STAGE_LABELS.ended}の人は一覧の「${STAGE_LABELS.ended}の人も出す」で出ます`
          : '保存しました',
      );
      if (key === 'new') {
        onLeave();
        navigate(`/clients/${encodeURIComponent(c.id)}?tab=basic`, { replace: true });
      }
    } catch (e) {
      setError(toFormErr(e));
    }
  };

  /** 仮押さえを本登録にする（段階を「利用中」に。ADR-0015） */
  const confirmTentative = (c: Client) => {
    update((d) => ({ ...d, clients: d.clients.map((x) => (x.id === c.id ? withStage(x, 'active') : x)) }));
    toast(`${c.displayName}を本登録（利用中）にしました`);
  };
  /** 仮押さえを取り消す（D47）：確認のうえ、その人の繰り返し・訪問・〈利用者さん〉を消して一覧へ */
  const cancelTentative = async (c: Client) => {
    const fixed = confirmedDatesOf(data, c.id).length;
    const ok = await confirmDialog({
      title: `仮押さえの${c.displayName}を取り消しますか？`,
      body: `繰り返しとすべての訪問を消し、${terms.client}も消します。${
        fixed > 0 ? `確定した日（${fixed}日）の訪問は「未連絡の変更」（外れる）になります。` : ''
      }`,
      confirmLabel: '仮押さえを取り消す',
      cancelLabel: '残しておく',
      tone: 'danger',
    });
    if (!ok) return;
    onLeave();
    discardAll();
    update((d) => cancelTentativeData(d, c.id, today));
    navigate('/clients');
    toast('仮押さえを取り消しました');
  };

  // ---- 予定のカレンダー（URL の cal・d） ----
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
  const [pattern, setPattern] = useState<string | null>(null);

  // 新しい人を保存・取り消して移る間（節を閉じたあと）は何も出さない
  if (!saved && !edit) return null;
  const c = saved ?? edit?.form;
  if (!c) return null;
  const editing = (k: SecKey) => edit?.key === k;
  const leaves = saved ? leavesOf(data, saved.id) : [];
  const leaveNow = saved ? leaveOn(data.clientLeaves, saved.id, today) : null;

  const tabs: PersonTabDef<ClientTab>[] = [
    { key: 'schedule', label: '予定', icon: CalendarDays, disabled: isNew ? '保存してから見られます' : false },
    { key: 'basic', label: '基本情報', icon: UserRound },
    {
      key: 'staffing',
      label: compatOn ? '担当・相性' : '担当',
      icon: HeartHandshake,
      disabled: isNew ? '保存してから見られます' : false,
    },
    ...(leavesOn
      ? [
          {
            key: 'leaves' as const,
            label: '休み',
            icon: BedSingle,
            disabled: isNew ? '保存してから入れられます' : (false as const),
          },
        ]
      : []),
  ];

  // ---- 節：読むときの中身・直すときの入力欄 ----
  const basicView = (
    <dl>
      <DlRow term="よみ" value={orDash(c.kana)} />
      <DlRow term="メモ" value={orDash(c.note)} />
      <DlRow
        term="色"
        value={
          <span className="row" style={{ gap: 6 }}>
            <span className="dot dot-sm" style={{ background: colorOf(c.color) }} aria-hidden="true">
              {initialOf(c.displayName)}
            </span>
            色{c.color + 1}
          </span>
        }
      />
    </dl>
  );
  const basicFields = form && (
    <>
      <div className="form-grid">
        <label>
          <span>
            表示名
            <RequiredMark />
          </span>
          <input
            value={form.displayName}
            maxLength={50}
            required
            {...bad('displayName')}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            data-testid="client-name"
          />
        </label>
        <label>
          よみ（ひらがな・任意。検索に使います）
          <input
            value={form.kana}
            maxLength={50}
            placeholder="例：としょかん ふみ"
            onChange={(e) => setForm({ ...form, kana: e.target.value })}
            data-testid="client-kana"
          />
        </label>
        <label>
          メモ
          <input value={form.note} maxLength={500} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </label>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <span className="sub">色</span>
        {CLIENT_COLORS.map((col, i) => (
          <button
            key={col}
            type="button"
            className="dot dot-sm"
            aria-label={`色${i + 1}`}
            aria-pressed={form.color === i}
            onClick={() => setForm({ ...form, color: i })}
            style={{
              background: col,
              border: form.color === i ? '3px solid var(--ink)' : '3px solid transparent',
              cursor: 'pointer',
            }}
          >
            {form.color === i ? '✓' : ''}
          </button>
        ))}
      </div>
    </>
  );
  const stageView = (
    <>
      <dl>
        <DlRow
          term="段階"
          value={`${STAGE_LABELS[c.stage]}${c.tentative ? '（枠を仮押さえ。予定・AI の提案に入ります）' : ''}`}
        />
        {stageOn && (
          <>
            <DlRow term="紹介元" value={orDash(c.referrer.name)} />
            <DlRow term="連絡先" value={orDash(c.referrer.contact)} />
            <DlRow term="メールアドレス" value={orDash(c.referrer.email)} />
            <DlRow term="紹介元のメモ" value={orDash(c.referrer.note)} />
          </>
        )}
      </dl>
      {saved?.tentative && (
        <div className="tentative-box stack" data-testid="tentative-box">
          <span className="row" style={{ gap: 6 }}>
            <TentativeMark />
            <strong>仮押さえの{terms.client}です</strong>
          </span>
          <span className="sub">
            問い合わせの試算から仮に押さえています（段階「{STAGE_LABELS[saved.stage]}」。予定・AI の提案に入ります）。
            決まったら本登録（利用中）に、断られたら取り消してください。
          </span>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-small" onClick={() => confirmTentative(saved)}>
              <WithIcon icon={BookmarkCheck} size={14}>
                本登録にする
              </WithIcon>
            </button>
            <button type="button" className="btn btn-small" onClick={() => cancelTentative(saved)}>
              <WithIcon icon={BookmarkX} size={14}>
                仮押さえを取り消す
              </WithIcon>
            </button>
          </div>
        </div>
      )}
    </>
  );
  const stageFields = form && (
    <>
      {stageOn ? (
        <Hint>
          段階は 相談受付 → 顔合わせ → 契約 → 利用中 → 終了 です。予定に入るのは「利用中」と、仮押さえしている
          {terms.client}だけです。
        </Hint>
      ) : (
        <Hint>予定に入るのは「利用中」の{terms.client}です。「終了」にすると予定に入りません。</Hint>
      )}
      <div className="form-grid" data-testid="client-stage-form">
        <label>
          段階
          <select
            value={form.stage}
            onChange={(e) => setForm(withStage(form, e.target.value as ClientStage))}
            data-testid="client-stage-select"
          >
            {stageChoices(form.stage, stageOn).map((st) => (
              <option key={st} value={st}>
                {STAGE_LABELS[st]}
              </option>
            ))}
          </select>
        </label>
        {isBeforeActive(form.stage) && (
          <Check checked={form.tentative} onChange={(on) => setForm(withStage(form, form.stage, on))}>
            枠を仮押さえする（予定・AI の提案に入れる）
          </Check>
        )}
        {stageOn && (
          <>
            <label>
              紹介元
              <input
                value={form.referrer.name}
                maxLength={50}
                placeholder="例：〇〇相談室"
                onChange={(e) => setForm({ ...form, referrer: { ...form.referrer, name: e.target.value } })}
                data-testid="client-referrer-name"
              />
            </label>
            <label>
              紹介元の連絡先
              <input
                value={form.referrer.contact}
                maxLength={100}
                placeholder="電話・メールなど"
                onChange={(e) => setForm({ ...form, referrer: { ...form.referrer, contact: e.target.value } })}
              />
            </label>
            <label>
              紹介元のメールアドレス（任意）
              <input
                type="email"
                value={form.referrer.email}
                maxLength={254}
                autoComplete="off"
                placeholder="name@example.com"
                {...bad('referrer')}
                onChange={(e) => setForm({ ...form, referrer: { ...form.referrer, email: e.target.value } })}
                data-testid="client-referrer-email"
              />
            </label>
            <label>
              紹介元のメモ
              <input
                value={form.referrer.note}
                maxLength={200}
                placeholder="例：返事待ち・顔合わせの日程"
                onChange={(e) => setForm({ ...form, referrer: { ...form.referrer, note: e.target.value } })}
              />
            </label>
          </>
        )}
      </div>
    </>
  );
  const points = hasLocation(c.place)
    ? [{ lat: c.place.lat!, lng: c.place.lng!, label: '●', color: colorOf(c.color) }]
    : [];
  const placeView = (
    <>
      <dl>
        <DlRow term="郵便番号" value={c.place.postalCode ? `〒${formatPostalCode(c.place.postalCode)}` : '—'} />
        <DlRow term="住所" value={orDash(c.place.address)} />
        <ClientAreaRow client={c} />
        <DlRow term="地図の位置" value={placeText(c.place)} />
      </dl>
      {points.length > 0 && <PlaceMap lat={points[0]!.lat} lng={points[0]!.lng} color={points[0]!.color} />}
    </>
  );
  const placeFields = form && (
    <ClientPlaceEditor value={form.place} onChange={(place) => setForm((f) => ({ ...f, place }))} />
  );
  const traitsView = (
    <dl>
      {clientItems.map((it) => (
        <DlRow key={it.id} term={it.name} value={traitText(c.traits[it.id])} />
      ))}
    </dl>
  );
  const traitsFields = form && (
    <TraitsEditor items={clientItems} value={form.traits} onChange={(traits) => setForm({ ...form, traits })} />
  );
  const rulesView = (
    <dl>
      {VISIT_RULE_FIELDS.map((f) => (
        <DlRow key={f.key} term={f.label} value={orDash(c[f.key])} />
      ))}
    </dl>
  );
  const rulesFields = form && (
    <>
      <Hint>
        入り方・鍵・駐車場・注意を書くと、{terms.staff}の画面と日の予定の訪問に出ます（各200文字まで）。
        実在の人の名前・住所などの個人情報は入れないでください。
      </Hint>
      <div className="form-grid" data-testid="visit-rules-form">
        {VISIT_RULE_FIELDS.map((f) => (
          <label key={f.key}>
            <WithIcon icon={f.icon} size={14}>
              {f.label}
            </WithIcon>
            <input
              value={form[f.key]}
              maxLength={200}
              placeholder={f.placeholder}
              data-testid={`client-${f.key}`}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
            />
          </label>
        ))}
      </div>
    </>
  );
  const staffingView = (
    <dl>
      <ClientStaffRows
        client={c}
        data={data}
        names={(list, testId) => <PersonNames kind="staff" people={list} testId={testId} />}
      />
    </dl>
  );
  const staffingFields = form && edit && (
    <>
      <p className="sub" data-testid="client-usual-note">
        いつもの担当は繰り返しの担当です（予定のタブの繰り返しの「直す」で替えます）。
      </p>
      {allowedOn && (
        <>
          <Hint label="担当できる人（社内の決まり）">
            <ul className="hint-list">
              <li>「この方は2人だけで担当する」のような決まりがあれば、担当できる{terms.staff}を選びます。</li>
              <li>選んだ人のほかは、担当になりません。</li>
              <li>休止中の{terms.staff}は選べません。選んだ人が全員いなくなると、だれでも担当できるに戻ります。</li>
            </ul>
          </Hint>
          <Check
            checked={edit.limit}
            onChange={(on) => {
              setLimit(on);
              // 入れたときに誰も選んでいなければ、いつもの担当（繰り返しの担当）を最初に選んでおく
              const usual = usualStaffOf(data.patterns, form.id, jstDate(Date.now()));
              if (on && form.allowedStaffIds.length === 0 && usual && activeStaff.some((s) => s.id === usual))
                setForm({ ...form, allowedStaffIds: [usual] });
            }}
          >
            担当できる人を限る
          </Check>
          {edit.limit && (
            <PickChips
              label={`担当できる${terms.staff}（押して選ぶ・外す）`}
              people={activeStaff.map((s) => ({ id: s.id, name: s.name, mark: <StaffMarkById id={s.id} size="xs" /> }))}
              selected={form.allowedStaffIds}
              // 全員を選ぶと PickChips は null を返す（全員の ID にする）
              onChange={(next) => setForm({ ...form, allowedStaffIds: next ?? activeStaff.map((s) => s.id) })}
              bulk={false}
              testId="client-allowed"
            />
          )}
        </>
      )}
    </>
  );
  const condsView = (
    <>
      <dl>
        <CondRows requirements={c.requirements} preferences={c.preferences} data={data} />
      </dl>
      <CondChips requirements={c.requirements} preferences={c.preferences} itemById={itemById} />
    </>
  );
  const condsFields = form && (
    <>
      <h3 className="person-subhead">
        <WithIcon icon={SlidersHorizontal} size={16}>
          必要条件
        </WithIcon>
      </h3>
      <Hint>
        例：性別が女性、資格に看護師を含む。「条件の重み」の画面の「{terms.client}
        の必要条件」で、必須か重みかを決めます。
      </Hint>
      <ConditionsEditor
        items={data.items}
        target="staff"
        value={form.requirements}
        onChange={(requirements) => setForm({ ...form, requirements })}
      />
      <h3 className="person-subhead">
        <WithIcon icon={Sparkles} size={16}>
          希望
        </WithIcon>
      </h3>
      <Hint>例：経験年数3以上。満たさないと点が付きます。</Hint>
      <ConditionsEditor
        items={data.items}
        target="staff"
        value={form.preferences}
        onChange={(preferences) => setForm({ ...form, preferences })}
      />
    </>
  );

  /** 節の共通の引数 */
  const sec = (key: SecKey) => ({
    name: key,
    editing: editing(key),
    onEdit: () => void startEdit(key),
    onSave: save,
    onCancel: () => void cancelEdit(),
    error: editing(key) ? error : null,
    errorId,
  });

  /** いつもの担当（繰り返しの担当。版2） */
  const usualId = usualStaffOf(data.patterns, c.id, jstDate(Date.now()));
  const stateChips = (
    <span className="person-state" data-testid="person-state">
      <span className={`chip stage-chip is-${c.stage}`} data-testid="client-stage">
        {STAGE_LABELS[c.stage]}
      </span>
      {c.tentative && <span className="chip chip-warn">仮押さえ</span>}
      {leaveNow && (
        <span className="chip chip-warn" title={leaveNow.note || undefined}>
          休み中
        </span>
      )}
      {usualId && (
        <span className="with-staff-mark sub">
          <StaffMarkById id={usualId} size="xs" />
          いつもの担当 {staffName(usualId)}
        </span>
      )}
    </span>
  );

  return (
    <div
      className="stack person-page person-view"
      data-testid="person-view"
      data-kind="client"
      data-id={isNew ? '' : id}
    >
      <PageHeader
        icon={isNew ? Plus : House}
        title={
          isNew ? (
            `${terms.client}を追加`
          ) : (
            <span className="row" style={{ gap: 8 }}>
              {/* 色の丸（文字は入れない。見出しの文字を名前だけにする） */}
              <span className="dot dot-sm" style={{ background: colorOf(c.color) }} aria-hidden="true" />
              {c.displayName}
            </span>
          )
        }
        lead={isNew ? `${terms.client}の名前と段階を入れて保存します` : stateChips}
        actions={<BackToList to="/clients" label={`${terms.client}一覧`} />}
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
            label={`${terms.client}の画面の切り替え`}
          />
        }
      />

      {tab === 'schedule' && saved && (
        <div className="person-schedule" data-testid="person-schedule">
          <div className="person-schedule-side">
            <div className="card stack">
              <PatternsSection
                key={`p${resetKey}`}
                client={saved}
                selected={pattern}
                onSelect={setPattern}
                onDirty={onPatternsDirty}
                readOnly={narrow}
              />
              {narrow && <span className="sub">繰り返しを足す・直すのは広い画面でできます。</span>}
            </div>
            {/* 休みは事実なので、休みの機能を切っても読むだけで出す（入れる・直すは休みのタブ） */}
            <div className="card stack" data-testid="schedule-leaves">
              <h2 className="person-subhead">
                <WithIcon icon={BedSingle} size={16}>
                  休み
                </WithIcon>
              </h2>
              {leaves.filter((l) => l.to >= today).length === 0 ? (
                <span className="sub">これからの休みはありません</span>
              ) : (
                <ul className="person-list">
                  {leaves
                    .filter((l) => l.to >= today)
                    .map((l) => (
                      <li key={l.id}>
                        <strong>
                          {mdText(l.from)}〜{mdText(l.to)}
                        </strong>{' '}
                        <span className="sub">{l.note || '理由なし'}</span>
                      </li>
                    ))}
                </ul>
              )}
              {leavesOn && (
                <Link
                  to={`/clients/${encodeURIComponent(id)}?tab=leaves`}
                  replace
                  className="btn btn-small btn-text"
                  data-testid="to-leaves"
                >
                  休みを入れる・直す
                </Link>
              )}
            </div>
          </div>
          <div className="person-schedule-main card">
            <PersonCalendar
              kind="client"
              personId={id}
              view={calView}
              anchor={anchor}
              onChange={setCal}
              highlight={pattern}
              dayNote={(d) =>
                leaveOn(data.clientLeaves, id, d) ? <span className="chip chip-warn pcal-chip">休み</span> : null
              }
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
              {stageFields}
              <Hint label="ほかの項目">
                住所・特性・担当・繰り返し（決まった曜日の訪問）・休みは、保存してから入れられます。
              </Hint>
            </EditSection>
          ) : (
            <>
              <EditSection {...sec('basic')} icon={UserRound} title="基本" view={basicView}>
                {basicFields}
              </EditSection>
              <EditSection {...sec('stage')} icon={Route} title={stageOn ? '段階と紹介元' : '段階'} view={stageView}>
                {stageFields}
              </EditSection>
              <EditSection {...sec('place')} icon={House} title="住所" view={placeView}>
                {placeFields}
              </EditSection>
              <EditSection {...sec('traits')} icon={BadgeCheck} title="特性" view={traitsView}>
                {traitsFields}
              </EditSection>
              {notesOn && (
                <EditSection {...sec('rules')} icon={DoorOpen} title="訪問先の決まりごと" view={rulesView}>
                  {rulesFields}
                </EditSection>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'staffing' && saved && (
        <div className="person-sections">
          <EditSection {...sec('staffing')} icon={ShieldCheck} title="担当" view={staffingView}>
            {staffingFields}
          </EditSection>
          <EditSection {...sec('conds')} icon={SlidersHorizontal} title={`${terms.staff}に求めること`} view={condsView}>
            {condsFields}
          </EditSection>
          {compatOn && (
            <section className="card stack person-sec" data-testid="person-sec" data-section="compat">
              <div className="section-title">
                <h2>
                  <HeartHandshake size={18} strokeWidth={2.2} aria-hidden="true" />
                  相性
                </h2>
                <div className="section-aside">
                  <Link
                    to={`/compat?cf=${encodeURIComponent(encodeFilter({ ...EMPTY_FILTER, query: saved.displayName }))}`}
                    className="btn btn-small"
                    data-testid="to-compat"
                  >
                    相性の表で直す
                  </Link>
                </div>
              </div>
              <dl>
                <ClientCompatRows client={saved} data={data} />
              </dl>
              <span className="sub">×の{terms.staff}は担当になりません。</span>
            </section>
          )}
        </div>
      )}

      {tab === 'leaves' && saved && leavesOn && (
        <div className="card stack" data-testid="person-leaves">
          <ClientLeavesSection key={`l${resetKey}`} client={saved} onDirty={onLeavesDirty} />
        </div>
      )}
    </div>
  );
}

/** 住所の小さな地図（点は位置か色が変わったときだけ作り直す。点の配列が替わると地図が寄せ直すため） */
function PlaceMap({ lat, lng, color }: { lat: number; lng: number; color: string }) {
  const points = useMemo(() => [{ lat, lng, label: '●', color }], [lat, lng, color]);
  return <RouteMap height={180} points={points} />;
}
