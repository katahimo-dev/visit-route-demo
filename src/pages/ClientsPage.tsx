import { ChevronDown, Eye, HeartHandshake, House, ListFilter, MapPin, Plus, ShieldCheck } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useDay } from '../app/day';
import { ClientFilter } from '../components/ClientFilter';
import { CondChips, TraitChips } from '../components/conditions';
import { TentativeMark } from '../components/parts';
import { StaffMarkById } from '../components/StaffMark';
import { useToast } from '../components/Toast';
import { PageHeader, WithIcon } from '../components/ui';
import type { Client } from '../contracts/documents';
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
import { STAGE_LABELS } from '../lib/clientStage';
import { colorOf, initialOf } from '../lib/colors';
import { byDisplayName, byName, hasLocation, WEEKDAY_LABELS } from '../lib/common';
import { narrowRole } from '../lib/narrowRoles';
import { formatPostalCode } from '../lib/postalCode';
import { shouldOpenRow } from '../lib/rowOpen';
import { useFeature } from '../lib/useFeature';
import { COMPACT_QUERY, useMedia } from '../lib/useMedia';
import { weekDates, weekDay } from '../lib/week';
import { useDemoData } from '../store';
import { PlaceAllPanel } from './PlaceAllPanel';
import './settings.css';

/**
 * 〈利用者さん〉一覧（PoC本体 ClientsPage.tsx を写し、性別希望・NG を特性・条件・相性に置き換えた）。
 * 行を押すとその人の画面（`#/clients/:id`。ClientPage）へ、「追加」は新しい人の画面（`#/clients/new`）へ（PRD D308）
 */

export default function ClientsPage() {
  const { data } = useDemoData();
  // 機能の入り切り（ADR-0028）：切った機能の入力の欄・表示を出さない（データは消さず、保存しても今の値を残す）
  const stageOn = useFeature('clientStage');
  const allowedOn = useFeature('allowedStaff');
  const compatOn = useFeature('compat');
  const geocodeOn = useFeature('geocode');
  const terms = data.org.terms;
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

  // ?id= で開いたら（古いリンク・ブックマーク）、その人の画面（`#/clients/:id`）へ移る（PRD D308。いない人なら URL から消すだけ）
  const navigate = useNavigate();
  // いない人の画面（`/clients/:id`）から移ってきたときは知らせる（state.missing。1回だけ）
  const toastMissing = useToast();
  const location = useLocation();
  const missing = (location.state as { missing?: string } | null)?.missing;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 移ってきたときだけ
  useEffect(() => {
    if (!missing) return;
    toastMissing(`その${terms.client}は見つかりません（消されたか、URL が違います）`);
    navigate(location.pathname, { replace: true, state: null });
  }, [missing]);
  const [params, setParams] = useSearchParams();
  const openId = params.get('id');
  // biome-ignore lint/correctness/useExhaustiveDependencies: URL の id が変わったときだけ
  useEffect(() => {
    if (openId === null) return;
    if (data.clients.some((x) => x.id === openId)) {
      navigate(`/clients/${encodeURIComponent(openId)}`, { replace: true });
      return;
    }
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete('id');
        return p;
      },
      { replace: true },
    );
  }, [openId]);
  /** その人の画面へ */
  const openPerson = (c: Client) => navigate(`/clients/${encodeURIComponent(c.id)}`);

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
            <Link to="/clients/new" className="btn btn-primary" data-testid="client-add">
              <WithIcon icon={Plus}>{terms.client}を追加</WithIcon>
            </Link>
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

      {/* まとめて置けなかった人の「編集」は、住所を入れるためにその人の画面の住所の節を開く */}
      {/* 郵便番号・住所の検索を切っていれば出さない（ADR-0028 の geocode） */}
      {geocodeOn && (
        <PlaceAllPanel onEdit={(c) => navigate(`/clients/${encodeURIComponent(c.id)}?tab=basic&edit=place`)} />
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
              <tr
                {...narrowRole.row}
                key={c.id}
                data-testid="client-row"
                className="row-open"
                // 行のどこを押してもその人の画面へ（PRD D308。ボタン・リンク・文字の選択は除く。キーボードは右端の「開く」）
                onClick={(e) => {
                  const ok = shouldOpenRow({
                    target: e.target as Element,
                    row: e.currentTarget,
                    selection: window.getSelection()?.toString() ?? '',
                    detail: e.detail,
                  });
                  if (!ok) return;
                  openPerson(c);
                }}
              >
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
                    <span className="with-staff-mark">
                      <StaffMarkById id={c.usualStaffId} size="xs" />
                      {staffName(c.usualStaffId)}
                    </span>
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
                  <Link
                    className="icon-btn tone-plain"
                    to={`/clients/${encodeURIComponent(c.id)}`}
                    title={`${c.displayName}を開く`}
                    aria-label={`${c.displayName}を開く`}
                    data-testid="client-open"
                  >
                    <Eye size={16} strokeWidth={2.2} aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
