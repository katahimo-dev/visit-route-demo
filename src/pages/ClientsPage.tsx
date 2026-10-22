import {
  BadgeCheck,
  BookmarkCheck,
  BookmarkX,
  ChevronDown,
  DoorOpen,
  Eye,
  HeartHandshake,
  House,
  ListFilter,
  MapPin,
  Pencil,
  Plus,
  Repeat,
  Route,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useDay } from '../app/day';
import { ClientFilter } from '../components/ClientFilter';
import { useConfirm } from '../components/ConfirmDialog';
import { CondChips, ConditionsEditor, TraitChips, TraitsEditor } from '../components/conditions';
import { FieldError, type FormErr, invalidAttrs, RequiredMark, toFormErr } from '../components/FieldError';
import { PickChips } from '../components/PickChips';
import { Check, TentativeMark } from '../components/parts';
import { ClientView } from '../components/personView';
import { ClientPlaceEditor } from '../components/placeLookup';
import { useToast } from '../components/Toast';
import {
  Hint,
  IconButton,
  PageHeader,
  SectionLevelProvider,
  SectionTitle,
  SidePanel,
  WithIcon,
} from '../components/ui';
import { VISIT_RULE_FIELDS } from '../components/VisitRules';
import { type Client, type ClientStage, clientSchema, EMPTY_REFERRER } from '../contracts/documents';
import { leaveOn } from '../domain/leaves';
import { jstDate, weekday } from '../domain/time';
import {
  activeFilterCount,
  EMPTY_FILTER,
  filterClients,
  filterFacts,
  knownTypes,
  resolveStaffId,
} from '../lib/clientFilter';
import { isBeforeActive, STAGE_LABELS, stageChoices, withStage } from '../lib/clientStage';
import { CLIENT_COLORS, colorOf, initialOf } from '../lib/colors';
import { byDisplayName, byName, hasLocation, nameTaken, newId, WEEKDAY_LABELS } from '../lib/common';
import { useDirtyMark } from '../lib/dirtyForms';
import { normalizeEmail } from '../lib/mailto';
import { keepStorePlace } from '../lib/placeAll';
import { formatPostalCode, normalizePostalCode } from '../lib/postalCode';
import { cancelTentative as cancelTentativeData, confirmedDatesOf } from '../lib/tentative';
import { useFeature } from '../lib/useFeature';
import { COMPACT_QUERY, useMedia } from '../lib/useMedia';
import { type DiscardWhen, discardDialog, isDirty } from '../lib/viewMode';
import { weekDates, weekDay } from '../lib/week';
import { useDemoData } from '../store';
import { ClientLeavesSection } from './ClientLeavesSection';
import { PatternsSection } from './PatternsSection';
import { PlaceAllPanel } from './PlaceAllPanel';
import './settings.css';
import { narrowRole } from '../lib/narrowRoles';

/** 訪問先の一覧と編集（PoC本体 ClientsPage.tsx を写し、性別希望・NG を特性・条件・相性に置き換えた） */

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
  usualStaffId: null,
  tentative: false,
  entryNote: '',
  keyNote: '',
  parkingNote: '',
  cautionNote: '',
  allowedStaffIds: [],
  stage: 'active',
  referrer: { ...EMPTY_REFERRER },
});

export default function ClientsPage() {
  const { data, update } = useDemoData();
  // 機能の入り切り（ADR-0028）：切った機能の入力の欄・表示を出さない（データは消さず、保存しても今の値を残す）
  const stageOn = useFeature('clientStage');
  const allowedOn = useFeature('allowedStaff');
  const leavesOn = useFeature('clientLeave');
  const notesOn = useFeature('visitNotes');
  const compatOn = useFeature('compat');
  const geocodeOn = useFeature('geocode');
  const terms = data.org.terms;
  const toast = useToast();
  const confirmDialog = useConfirm();
  /** 閲覧の欄で開いている人（PRD D127。編集中はその人の ID のまま。null：閲覧の欄なし） */
  const [viewId, setViewId] = useState<string | null>(null);
  /** 編集の欄の入力（null：編集していない） */
  const [form, setForm] = useState<Client | null>(null);
  /** 欄を開いたときの場所（保存のとき、まとめて置いた位置を欄の古い値で消さないため。ADR-0016） */
  const [openedPlace, setOpenedPlace] = useState<Client['place'] | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState<FormErr>(null);
  const errorId = useId();
  /** 誤った欄の印（PRD D250。郵便番号の欄は住所の入力が自分で印を付ける） */
  const bad = (field: string) => invalidAttrs(error?.field === field, errorId);
  /** 担当できる人を限る（PRD D68。入れたら1人以上選ぶ） */
  const [limit, setLimit] = useState(false);
  /** 欄を開いたときの「担当できる人を限る」と、新しい人の空の欄（変更があるかの判定に使う） */
  const [openedLimit, setOpenedLimit] = useState(false);
  const [openedForm, setOpenedForm] = useState<Client | null>(null);
  const clients = useMemo(() => [...data.clients].sort(byDisplayName), [data.clients]);
  const staff = useMemo(() => [...data.staff].sort(byName), [data.staff]);
  /**
   * 一覧の絞り込み（PRD D108〜D112。ClientFilter。画面の状態）：名前・よみ・地区・チップ（AND）・終了の人も出す。
   * チップの期間は選んでいる日を含む週（月〜日。週間の weekDay で、案・確定の判定も週間と同じ）
   */
  const { date } = useDay();
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const activeStaff = useMemo(() => staff.filter((s) => s.active), [staff]);
  const dates = useMemo(() => weekDates(date), [date]);
  const days = useMemo(() => dates.map((d) => weekDay(data, d)), [data, dates]);
  const facts = useMemo(
    () =>
      filterFacts({
        days,
        visits: data.visits,
        clients,
        patterns: data.patterns,
        clientLeaves: data.clientLeaves,
        staff,
        visitTypes: data.visitTypes,
      }),
    [days, data.visits, clients, data.patterns, data.clientLeaves, data.visitTypes, staff],
  );
  const shown = useMemo(
    () => filterClients(clients, filter, facts, resolveStaffId(filter, activeStaff, facts, clients)),
    [clients, filter, facts, activeStaff],
  );
  /**
   * 狭い画面（600px 以下）では絞り込みの欄を「絞り込み（N）」のボタンの下に畳む（PRD D220。N は効いている絞り込みの数。
   * はじめは畳む。開いたかは画面の中だけ。広い画面ではいつも開いたまま）
   */
  const narrow = useMedia(COMPACT_QUERY);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterBodyId = useId();
  // 消えた種類を押したままでも数えない（今ある種類で絞る）
  const filterCount = activeFilterCount(knownTypes(filter, data.visitTypes));
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const periodLabel = `${md(dates[0]!)}（${WEEKDAY_LABELS[weekday(dates[0]!)]}）からの週`;
  const staffName = (id: string | null) => (id ? (staff.find((s) => s.id === id)?.name ?? '（不明）') : '');
  const clientItems = data.items.filter((i) => i.target === 'client');
  const today = jstDate(Date.now());
  const itemById = new Map(data.items.map((i) => [i.id, i]));

  /** 編集の欄を開く（担当を限るかは、利用中の人が1人以上選ばれているかで決める） */
  const openForm = (c: Client, fresh: boolean) => {
    setError(null);
    setIsNew(fresh);
    const lim = c.allowedStaffIds.some((id) => staff.some((s) => s.id === id && s.active));
    setLimit(lim);
    setOpenedLimit(lim);
    setForm(c);
    setOpenedForm(fresh ? structuredClone(c) : null);
    setOpenedPlace(c.place);
  };

  /**
   * 編集の欄に変更があるか（PRD D130。既存の人は保存した中身、新しい人は開いたときの空の欄と比べる）。
   * 担当できる人は保存のときと同じ値（限らなければ空、限るなら利用中の人だけ）にそろえてから比べる
   * （「担当できる人を限る」を入れてすぐ外しただけなら変更なし）
   */
  const allowedAsSaved = (c: Client, lim: boolean) =>
    lim ? c.allowedStaffIds.filter((id) => staff.some((s) => s.id === id && s.active)) : [];
  const dirtyBase = isNew ? (openedForm ?? undefined) : form ? data.clients.find((x) => x.id === form.id) : undefined;
  const dirty = isDirty(
    form && { ...form, allowedStaffIds: allowedAsSaved(form, limit) },
    dirtyBase && { ...dirtyBase, allowedStaffIds: allowedAsSaved(dirtyBase, openedLimit) },
  );
  /** 変更があれば捨ててよいか確かめる（無ければそのまま進む） */
  const okToDiscard = async (when: DiscardWhen, next = ''): Promise<boolean> =>
    !dirty || !form || confirmDialog(discardDialog(when, terms.client, form.displayName, next));

  /** 閲覧の欄で開く（PRD D127。編集中で変更があれば確かめる） */
  const openView = async (c: Client) => {
    if (form && form.id === c.id && !isNew) return;
    if (!(await okToDiscard('switch', c.displayName))) return;
    setForm(null);
    setError(null);
    setViewId(c.id);
  };
  /** 閲覧から編集へ（PRD D128） */
  const startEdit = (c: Client) => {
    setViewId(c.id);
    openForm(structuredClone(c), false);
  };
  /** 編集を取り消して閲覧に戻る（新しい人なら欄を閉じる。PRD D129） */
  const cancelEdit = async () => {
    if (!(await okToDiscard(isNew ? 'close' : 'view'))) return;
    if (isNew) setViewId(null);
    setForm(null);
    setError(null);
  };
  /** 欄を閉じる（× ・Esc。編集中で変更があれば確かめる） */
  const closePanel = async () => {
    if (!(await okToDiscard('close'))) return;
    setForm(null);
    setViewId(null);
    setError(null);
  };

  // 別のタブの変更で読み直したときの知らせの文を選ぶ（PRD D227。変更があれば「保存すると上書きします」）
  useDirtyMark(dirty);
  // 変更があるまま再読込・タブを閉じるときはブラウザの確認を出す（PRD D130。戻る・画面の移動では出せない。ADR-0023）
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  // ?id= で開いたら、その人の閲覧の欄を開く（相性・予定の吹き出しから。PRD D115・D127）。開いたら URL から消す
  const [params, setParams] = useSearchParams();
  const openId = params.get('id');
  // biome-ignore lint/correctness/useExhaustiveDependencies: URL の id が変わったときだけ
  useEffect(() => {
    if (openId === null) return;
    const c = data.clients.find((x) => x.id === openId);
    if (c) void openView(c);
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete('id');
        return p;
      },
      { replace: true },
    );
  }, [openId]);

  const save = () => {
    if (!form) return;
    setError(null);
    // 担当を限るなら利用中の人を1人以上（休止中の人は数えない。保存時に外す。ADR-0014）
    // 担当を限るを切っている（ADR-0028）ときは欄が無いので、今の値をそのまま残す（データは消さない）
    const allowed = !allowedOn
      ? form.allowedStaffIds
      : limit
        ? form.allowedStaffIds.filter((id) => staff.some((s) => s.id === id && s.active))
        : [];
    if (limit && allowed.length === 0) {
      setError({ text: `担当できる${terms.staff}を1人以上選ぶか、「担当できる人を限る」を外してください` });
      return;
    }
    // 郵便番号はハイフン・全角を受けて7桁に直す（ADR-0016）。直せなければ保存しない
    const postalCode = normalizePostalCode(form.place.postalCode);
    if (postalCode === null) {
      setError({
        text: '郵便番号は7桁の数字で入れてください（ハイフンは有っても無くても構いません。空でも構いません）',
      });
      return;
    }
    // 紹介元のメールアドレス（任意。ADR-0017）：全角・前後の空白を直し、形が合わなければ保存しない
    const referrerEmail = normalizeEmail(form.referrer.email);
    if (referrerEmail === null) {
      setError({
        text: '紹介元のメールアドレスの形ではありません（例 name@example.com）。空でも構いません',
        field: 'referrer',
      });
      return;
    }
    // 同じ名前は保存しない（Excel では名前で人を引くため。ADR-0006）
    if (nameTaken(data.clients, (x) => x.displayName, form.displayName, form.id)) {
      setError({
        text: `「${form.displayName.trim()}」と同じ名前の${terms.client}がいます。名前を変えてください`,
        field: 'displayName',
      });
      return;
    }
    try {
      // 段階に合わせて予定の対象（active）・仮押さえを決める（ADR-0015）
      const c = clientSchema.parse(
        withStage(
          {
            ...form,
            allowedStaffIds: allowed,
            referrer: { ...form.referrer, email: referrerEmail },
            // 欄を開いた後に「まとめて地図に置く」が書いた位置・住所は、欄で触っていなければ残す（ADR-0016）
            place: {
              ...keepStorePlace(
                form.place,
                openedPlace ?? form.place,
                data.clients.find((x) => x.id === form.id)?.place,
              ),
              postalCode,
            },
          },
          form.stage,
          form.tentative,
        ),
      );
      update((d) => ({
        ...d,
        clients: d.clients.some((x) => x.id === c.id)
          ? d.clients.map((x) => (x.id === c.id ? c : x))
          : [...d.clients, c],
      }));
      // 保存したら閲覧の欄に戻る（PRD D129）
      setIsNew(false);
      setForm(null);
      setViewId(c.id);
      // 終了にした人は、一覧からは消える（「終了の人も出す」のときだけ出る。PRD D111）
      toast(
        c.stage === 'ended' && !filter.showEnded
          ? `保存しました。${STAGE_LABELS.ended}の人は「${STAGE_LABELS.ended}の人も出す」で出ます`
          : '保存しました',
      );
    } catch (e) {
      setError(toFormErr(e));
    }
  };

  /** 仮押さえを本登録にする（段階を「利用中」に。仮押さえは外れる。ADR-0015。ほかの入力中の項目はそのまま） */
  const confirmTentative = (c: Client) => {
    update((d) => ({ ...d, clients: d.clients.map((x) => (x.id === c.id ? withStage(x, 'active') : x)) }));
    setForm((f) => (f && f.id === c.id ? withStage(f, 'active') : f));
    toast(`${c.displayName}を本登録（利用中）にしました`);
  };

  /**
   * 仮押さえを取り消す（D47）：確認のうえ、lib/tentative の cancelTentative でその人の定期パターン・訪問・〈利用者さん〉を消し、
   * 消した訪問を今の案・記録・確定した割当から、〈利用者さん〉を相性から除く。確定した日を含むなら確認の文にその日数を出す
   */
  const cancelTentative = async (c: Client) => {
    const today = jstDate(Date.now());
    const n = data.visits.filter((v) => v.clientId === c.id).length;
    const fixed = confirmedDatesOf(data, c.id).length;
    const ok = await confirmDialog({
      title: `仮押さえの${c.displayName}を取り消しますか？`,
      body: `定期パターンと訪問 ${n}件を消し、${terms.client}も消します。${
        fixed > 0 ? `確定した日（${fixed}日）の割当からも外します。` : ''
      }`,
      confirmLabel: '仮押さえを取り消す',
      cancelLabel: '残しておく',
      tone: 'danger',
    });
    if (!ok) return;
    update((d) => cancelTentativeData(d, c.id, today));
    setForm(null);
    setViewId(null);
    toast(`仮押さえを取り消しました（訪問 ${n}件）`);
  };

  const saved = form ? data.clients.find((x) => x.id === form.id) : undefined;
  /** 閲覧の欄の人（編集していないとき。データから消えたら欄を出さない） */
  const viewed = !form && viewId !== null ? data.clients.find((x) => x.id === viewId) : undefined;

  return (
    <div className="stack">
      <PageHeader
        icon={House}
        title={`${terms.client}一覧`}
        lead={`${terms.client}の住所・特性・条件を決めます`}
        actions={
          <>
            {compatOn && (
              <Link to="/compat" className="btn btn-text" data-testid="to-compat">
                <WithIcon icon={HeartHandshake}>相性の表</WithIcon>
              </Link>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                if (!(await okToDiscard('switch', `新しい${terms.client}`))) return;
                setViewId(null);
                openForm(blank(clients.length), true);
              }}
            >
              <WithIcon icon={Plus}>{terms.client}を追加</WithIcon>
            </button>
          </>
        }
      />

      <div className="card stack" data-testid="clients-filter">
        {narrow && (
          <div className="row narrow-filter-head">
            <button
              type="button"
              className="btn btn-small narrow-filter-toggle"
              aria-expanded={filterOpen}
              aria-controls={filterBodyId}
              onClick={() => setFilterOpen((o) => !o)}
              data-testid="narrow-filter-toggle"
            >
              <WithIcon icon={ListFilter} size={14}>
                絞り込み（{filterCount}）
              </WithIcon>
              <ChevronDown size={14} aria-hidden="true" className="narrow-filter-mark" />
            </button>
            <span className="sub" data-testid="narrow-filter-count">
              {shown.length}人を表示
            </span>
          </div>
        )}
        <div id={filterBodyId} className="stack narrow-filter-body" hidden={narrow && !filterOpen}>
          <ClientFilter
            clients={clients}
            state={filter}
            onChange={setFilter}
            facts={facts}
            staff={activeStaff}
            terms={{ client: terms.client, staff: terms.staff }}
            periodLabel={periodLabel}
            defaults={EMPTY_FILTER}
            visitTypes={data.visitTypes}
            testId="clients-cf"
          />
          <span className="sub">
            {STAGE_LABELS.inquiry}〜{STAGE_LABELS.contract}
            の人は、一覧の「状態」の印で見分けられます。新しい相談は「空き状況」の画面で受けられる曜日・時間を試算し、仮押さえすると「
            {STAGE_LABELS.inquiry}」で入ります
          </span>
        </div>
      </div>

      {/* まとめて置けなかった人の「編集」は、住所を入れるために編集の欄で開く */}
      {/* 郵便番号・住所の検索を切っていれば出さない（ADR-0028 の geocode） */}
      {geocodeOn && (
        <PlaceAllPanel
          onEdit={async (c) => {
            if (form?.id === c.id) return;
            if (!(await okToDiscard('switch', c.displayName))) return;
            startEdit(c);
          }}
        />
      )}

      {/* 狭い画面（600px 以下）では行をカードにする（PRD D220。名前と状態が1行目、ほかは見出し付きの行、開くは右下） */}
      <div className="card table-scroll">
        <table {...narrowRole.table} className="people-table narrow-cards" data-testid="narrow-clients">
          <thead {...narrowRole.rowgroup}>
            <tr {...narrowRole.row}>
              <th {...narrowRole.columnheader}>名前</th>
              <th {...narrowRole.columnheader}>位置</th>
              <th {...narrowRole.columnheader}>特性</th>
              <th {...narrowRole.columnheader}>{terms.staff}に求めること</th>
              <th {...narrowRole.columnheader}>いつもの担当</th>
              <th {...narrowRole.columnheader}>状態</th>
              <th {...narrowRole.columnheader} aria-label="操作" />
            </tr>
          </thead>
          <tbody {...narrowRole.rowgroup}>
            {shown.length === 0 && (
              <tr {...narrowRole.row}>
                <td {...narrowRole.cell} colSpan={7} className="sub">
                  当てはまる{terms.client}がいません
                </td>
              </tr>
            )}
            {shown.map((c) => (
              <tr {...narrowRole.row} key={c.id} data-testid="client-row">
                <td {...narrowRole.cell} className="narrow-title" data-label="名前">
                  <span className="row person-name">
                    <span className="dot dot-sm" style={{ background: colorOf(c.color) }}>
                      {initialOf(c.displayName)}
                    </span>
                    <span className="person-main">
                      <span className="row" style={{ gap: 6 }}>
                        {c.displayName}
                        {c.tentative && <TentativeMark />}
                      </span>
                      {c.kana && <small className="person-sub">{c.kana}</small>}
                      {(c.place.address || c.place.postalCode) && (
                        <small className="person-sub">
                          {c.place.postalCode && `〒${formatPostalCode(c.place.postalCode)} `}
                          {c.place.address}
                        </small>
                      )}
                      {stageOn && c.referrer.name && <small className="person-sub">紹介元：{c.referrer.name}</small>}
                    </span>
                  </span>
                </td>
                <td {...narrowRole.cell} data-label="位置">
                  {hasLocation(c.place) ? (
                    <span className="chip chip-ok" title="位置あり">
                      <MapPin size={13} strokeWidth={2.2} aria-hidden="true" />
                      <span className="sr-only">あり</span>
                    </span>
                  ) : (
                    <span className="chip chip-warn">未登録</span>
                  )}
                </td>
                <td {...narrowRole.cell} data-label="特性">
                  <TraitChips traits={c.traits} items={clientItems} />
                </td>
                <td {...narrowRole.cell} className="cond-cell" data-label={`${terms.staff}に求めること`}>
                  <CondChips requirements={c.requirements} preferences={c.preferences} itemById={itemById} />
                </td>
                <td {...narrowRole.cell} className="nowrap" data-label="いつもの担当">
                  {c.usualStaffId && (
                    <WithIcon icon={Repeat} size={14}>
                      {staffName(c.usualStaffId)}
                    </WithIcon>
                  )}
                  {allowedOn && c.allowedStaffIds.length > 0 && (
                    <span
                      className="chip chip-limit"
                      title={`担当できる人を限っています：${c.allowedStaffIds.map(staffName).join('、')}`}
                      data-testid="client-limit"
                    >
                      <ShieldCheck size={13} aria-hidden="true" />限{' '}
                      {c.allowedStaffIds.map((id) => staffName(id).split(/\s+/)[0]).join('、')}
                    </span>
                  )}
                </td>
                <td {...narrowRole.cell} className="narrow-head" data-label="状態">
                  <span className={`chip stage-chip is-${c.stage}`} data-testid="client-stage">
                    {STAGE_LABELS[c.stage]}
                  </span>
                  {c.tentative && <span className="chip chip-warn">仮押さえ</span>}
                  {leaveOn(data.clientLeaves, c.id, today) && (
                    <span className="chip chip-warn" title={leaveOn(data.clientLeaves, c.id, today)?.note || undefined}>
                      休み中
                    </span>
                  )}
                </td>
                <td {...narrowRole.cell} className="narrow-act">
                  <IconButton icon={Eye} label={`${c.displayName}を開く`} onClick={() => openView(c)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(form || viewed) && (
        <SidePanel
          icon={form ? (isNew ? Plus : Pencil) : Eye}
          title={
            form
              ? isNew
                ? `${terms.client}を追加`
                : `${terms.client}を編集：${form.displayName.trim() || '（名前なし）'}`
              : `${terms.client}：${viewed?.displayName.trim() || '（名前なし）'}`
          }
          onClose={closePanel}
          onSubmit={form ? save : undefined}
          focusKey={form ? 'edit' : 'view'}
          headActions={
            !form &&
            viewed && (
              <button
                type="button"
                className="btn btn-edit"
                onClick={() => startEdit(viewed)}
                data-testid="view-edit"
                data-return-focus
              >
                <WithIcon icon={Pencil}>編集する</WithIcon>
              </button>
            )
          }
          footer={
            form && (
              <>
                <button type="submit" className="btn btn-primary">
                  <WithIcon icon={Save}>保存</WithIcon>
                </button>
                <button type="button" className="btn" onClick={cancelEdit} data-testid="edit-cancel">
                  <WithIcon icon={X}>取り消し</WithIcon>
                </button>
                <FieldError as="span" id={errorId} token={error}>
                  {error?.text}
                </FieldError>
              </>
            )
          }
        >
          <SectionLevelProvider value={3}>
            {!form ? (
              viewed && <ClientView client={viewed} data={data} />
            ) : (
              <>
                {saved?.tentative && !isNew && (
                  <div className="tentative-box stack" data-testid="tentative-box">
                    <span className="row" style={{ gap: 6 }}>
                      <TentativeMark />
                      <strong>仮押さえの{terms.client}です</strong>
                    </span>
                    <span className="sub">
                      問い合わせの試算から仮に押さえています（段階「{STAGE_LABELS[saved.stage]}
                      」。予定・AI案に入ります）。 決まったら本登録（利用中）に、断られたら取り消してください。
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
                    いつもの担当
                    <select
                      value={form.usualStaffId ?? ''}
                      onChange={(e) => setForm({ ...form, usualStaffId: e.target.value || null })}
                    >
                      <option value="">なし</option>
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.active ? '' : '（休止中）'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    メモ
                    <input
                      value={form.note}
                      maxLength={500}
                      onChange={(e) => setForm({ ...form, note: e.target.value })}
                    />
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

                <SectionTitle icon={Route}>{stageOn ? '段階と紹介元' : '段階'}</SectionTitle>
                {stageOn ? (
                  <Hint>
                    段階は 相談受付 → 顔合わせ → 契約 → 利用中 → 終了
                    です。予定・AI案に入るのは「利用中」と、利用中の前で枠を仮押さえしている
                    {terms.client}だけです（「終了」にすると予定に入りません）。
                  </Hint>
                ) : (
                  <Hint>予定・AI案に入るのは「利用中」の{terms.client}です（「終了」にすると予定に入りません）。</Hint>
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
                      枠を仮押さえする（予定・AI案に入れる）
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
                          onChange={(e) =>
                            setForm({ ...form, referrer: { ...form.referrer, contact: e.target.value } })
                          }
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

                {allowedOn && (
                  <>
                    <SectionTitle icon={ShieldCheck}>担当できる人（社内の決まり）</SectionTitle>
                    <Hint>
                      「この方は2人だけで担当する」のような決まりがあれば、担当できる{terms.staff}
                      を選びます。選んだ人以外は、条件の重みにかかわらず担当になりません（AI案・振り直し・週のドラッグ・空き状況のどれでも）。休止中の
                      {terms.staff}
                      は選べず、休止にすると外れます。選んだ人が全員いなくなると、限らない（だれでも担当できる）に戻ります。
                    </Hint>
                    <Check
                      checked={limit}
                      onChange={(on) => {
                        setLimit(on);
                        // 入れたときに誰も選んでいなければ、いつもの担当を最初に選んでおく
                        if (
                          on &&
                          form.allowedStaffIds.length === 0 &&
                          staff.some((s) => s.id === form.usualStaffId && s.active)
                        )
                          setForm({ ...form, allowedStaffIds: form.usualStaffId ? [form.usualStaffId] : [] });
                      }}
                    >
                      担当できる人を限る
                    </Check>
                    {limit && (
                      <PickChips
                        label={`担当できる${terms.staff}（押して選ぶ・外す）`}
                        people={staff.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }))}
                        selected={form.allowedStaffIds}
                        // 全員を選ぶと PickChips は null を返す（全員の ID にする）
                        onChange={(next) =>
                          setForm({ ...form, allowedStaffIds: next ?? staff.filter((s) => s.active).map((s) => s.id) })
                        }
                        bulk={false}
                        testId="client-allowed"
                      />
                    )}
                  </>
                )}

                {isNew || !data.clients.some((x) => x.id === form.id) ? (
                  <Hint label="定期パターン">
                    {leavesOn
                      ? '定期パターン（決まった曜日・時刻の訪問）と休み（入院・ショートステイなど）は、保存してから入れられます。'
                      : '定期パターン（決まった曜日・時刻の訪問）は、保存してから入れられます。'}
                  </Hint>
                ) : (
                  <>
                    <PatternsSection client={form} />
                    {leavesOn && <ClientLeavesSection client={form} />}
                  </>
                )}

                {notesOn && (
                  <>
                    <SectionTitle icon={DoorOpen}>訪問先の決まりごと</SectionTitle>
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
                )}

                <SectionTitle icon={BadgeCheck}>特性</SectionTitle>
                <TraitsEditor
                  items={clientItems}
                  value={form.traits}
                  onChange={(traits) => setForm({ ...form, traits })}
                />

                <SectionTitle icon={SlidersHorizontal}>{terms.staff}に求めること：必要条件</SectionTitle>
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
                <SectionTitle icon={Sparkles}>{terms.staff}に求めること：希望</SectionTitle>
                <Hint>例：経験年数3以上。満たさないと点が付きます。</Hint>
                <ConditionsEditor
                  items={data.items}
                  target="staff"
                  value={form.preferences}
                  onChange={(preferences) => setForm({ ...form, preferences })}
                />
                {compatOn && (
                  <Hint label="相性について">
                    相性（◎○△×）は「相性」の画面で入れます。×の{terms.staff}は担当になりません。
                  </Hint>
                )}

                <SectionTitle icon={House}>住所</SectionTitle>
                <ClientPlaceEditor
                  key={form.id}
                  value={form.place}
                  onChange={(place) => setForm((f) => (f ? { ...f, place } : f))}
                />
              </>
            )}
          </SectionLevelProvider>
        </SidePanel>
      )}
    </div>
  );
}
