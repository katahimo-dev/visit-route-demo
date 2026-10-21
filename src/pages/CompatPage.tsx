import { HeartHandshake, RefreshCw, SearchX } from 'lucide-react';
import { memo, useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDay } from '../app/day';
import { ClientFilter } from '../components/ClientFilter';
import { DetailPopover } from '../components/DetailPopover';
import { EdgeScroll } from '../components/EdgeScroll';
import { TentativeMark } from '../components/parts';
import { ClientDetail, StaffDetail } from '../components/personDetail';
import { StaffFilter } from '../components/StaffFilter';
import { Empty, Hint, PageHeader } from '../components/ui';
import type { Client, Staff } from '../contracts/documents';
import { COMPAT_LABELS, COMPAT_LEVELS, type Compat, type CompatLevel } from '../contracts/rules';
import { weekday } from '../domain/time';
import {
  type ClientFilterState,
  decodeFilter,
  EMPTY_FILTER,
  encodeFilter,
  filterClients,
  filterFacts,
  resolveStaffId,
  sameFilter,
} from '../lib/clientFilter';
import { colorOf, initialOf } from '../lib/colors';
import { byDisplayName, byName, staffColor, WEEKDAY_LABELS } from '../lib/common';
import {
  COMPAT_CHIPS,
  clientFilterSummary,
  compatChipSets,
  compatChipTests,
  compatChipText,
  decodeStaffFilter,
  EMPTY_STAFF_FILTER,
  encodeStaffFilter,
  filterStaff,
  nameLines,
  type StaffFilterState,
  sameStaffFilter,
  staffChipDefs,
  staffFilterSummary,
} from '../lib/compatView';
import { weekDates, weekDay } from '../lib/week';
import { useDemoData } from '../store';
import './settings.css';
import { SettingsTabs } from '../components/SettingsTabs';

/** 凡例（◎○△×の意味。色は表のセルと同じ） */
const LEGEND: { mark: string; cls: string; text: string }[] = [
  { mark: '◎', cls: 'lv2', text: '選ばれやすい' },
  { mark: '○', cls: 'lv1', text: 'やや選ばれやすい' },
  { mark: '△', cls: 'lvm1', text: '選ばれにくい' },
  { mark: '×', cls: 'lvm2', text: '担当にしない' },
];

/** 相性の記号の意味（セルの title・読み上げ。PRD D177。凡例を見なくても分かるように） */
const COMPAT_MEANING: Record<CompatLevel, string> = {
  2: '◎ 選ばれやすい',
  1: '○ やや選ばれやすい',
  0: '未入力（ふつう）',
  [-1]: '△ 選ばれにくい',
  [-2]: '× 担当にしない',
};

/** 次の相性（◎→○→空→△→×→◎） */
const nextLevel = (l: CompatLevel): CompatLevel =>
  COMPAT_LEVELS[(COMPAT_LEVELS.indexOf(l) + 1) % COMPAT_LEVELS.length] as CompatLevel;

/** URL の値（無ければ null） */
const paramOf = (params: URLSearchParams, key: string): string | null =>
  params.has(key) ? (params.get(key) ?? '') : null;

/** 開いている吹き出し（見出しのボタンは ID で持ち、そのたびに引く） */
type Opened = { kind: 'staff' | 'client'; id: string };
type OpenKind = Opened['kind'];

/** 表の1行（セルを押しても、ほかの行は描き直さない） */
const CompatRow = memo(function CompatRow({
  client: c,
  cols,
  row,
  open,
  popId,
  onToggle,
  onCycle,
}: {
  client: Client;
  cols: readonly Staff[];
  /** その行の相性（staffId → 相性） */
  row: Compat[string] | undefined;
  open: boolean;
  /** 吹き出しの id（ボタンの id は `${popId}-btn`） */
  popId: string;
  onToggle: (kind: OpenKind, id: string) => void;
  onCycle: (clientId: string, staffId: string) => void;
}) {
  return (
    <tr>
      <th className="avail-name">
        <button
          type="button"
          id={`${popId}-btn`}
          className="compat-client-btn"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popId : undefined}
          aria-label={`${c.displayName}の詳細`}
          onClick={() => onToggle('client', c.id)}
          data-testid="compat-client-btn"
          data-id={c.id}
        >
          <span className="dot dot-sm" style={{ background: colorOf(c.color) }}>
            {initialOf(c.displayName)}
          </span>
          <span className="ellipsis">{c.displayName}</span>
          {c.tentative && <TentativeMark />}
        </button>
      </th>
      {cols.map((s) => {
        const l: CompatLevel = (row && Object.hasOwn(row, s.id) ? row[s.id] : 0) ?? 0;
        return (
          <td key={s.id} className="compat-cell">
            <button
              type="button"
              className={`compat-btn lv${l < 0 ? `m${-l}` : l}`}
              title={`${c.displayName} × ${s.name}：${COMPAT_MEANING[l]}（押すと変わります）`}
              aria-label={`${c.displayName}と${s.name}の相性：${COMPAT_MEANING[l]}`}
              data-testid="compat-cell"
              onClick={() => onCycle(c.id, s.id)}
              data-sid={s.id}
            >
              {COMPAT_LABELS[l]}
            </button>
          </td>
        );
      })}
    </tr>
  );
});

/**
 * 相性：訪問先×スタッフの表。セルを押すと ◎→○→空→△→× を回す（×は担当にしない）。
 * 列の見出し・行の名前を押すと詳細の吹き出し（PRD D114・D115）。表の上で列（?sf=）と行（?cf=）を絞り込む（PRD D116）
 */
export default function CompatPage() {
  const { data, update } = useDemoData();
  const terms = data.org.terms;
  const uid = useId();
  const [params, setParams] = useSearchParams();
  const [opened, setOpened] = useState<Opened | null>(null);
  const clients = useMemo(() => data.clients.filter((c) => c.active).sort(byDisplayName), [data.clients]);
  const clientIds = useMemo(() => clients.map((c) => c.id), [clients]);
  const staff = useMemo(() => data.staff.filter((s) => s.active).sort(byName), [data.staff]);
  const allStaff = useMemo(() => [...data.staff].sort(byName), [data.staff]);
  // 色は休止中も含めた並びで決める（予定・AI案の画面と同じ色にする）
  const colorOfStaff = useMemo(() => new Map(allStaff.map((s, i) => [s.id, staffColor(i)])), [allStaff]);

  // ---- 列（〈スタッフ〉）の絞り込み（?sf=）----
  const defs = useMemo(() => staffChipDefs(data.items), [data.items]);
  const sfParam = paramOf(params, 'sf');
  const staffFilter = useMemo(() => decodeStaffFilter(sfParam, defs), [sfParam, defs]);
  const shownStaff = useMemo(() => filterStaff(staff, staffFilter, defs), [staff, staffFilter, defs]);
  const shownStaffIds = useMemo(() => shownStaff.map((s) => s.id), [shownStaff]);
  const staffIds = useMemo(() => staff.map((s) => s.id), [staff]);

  // ---- 行（〈利用者さん〉）の絞り込み（?cf=。期間は選んでいる日を含む週）----
  const { date } = useDay();
  const dates = useMemo(() => weekDates(date), [date]);
  // 週の帯は、相性のセルを押すたびに作り直さない（チップの判定に使うのは帯の担当・訪問の有無だけ）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 相性（compat）が変わっただけでは作り直さない
  const days = useMemo(
    () => dates.map((d) => weekDay(data, d)),
    [
      dates,
      data.org,
      data.items,
      data.rules,
      data.staff,
      data.clients,
      data.visits,
      data.availability,
      data.absences,
      data.visitTypes,
      data.patterns,
      data.clientLeaves,
      data.aiPlans,
      data.manualPlans,
    ],
  );
  const cfParam = paramOf(params, 'cf');
  // この画面は休止中の人を出さないので「終了の人も出す」はいつも外す
  const clientFilter = useMemo(
    () => ({ ...decodeFilter(cfParam, EMPTY_FILTER, COMPAT_CHIPS), showEnded: false }),
    [cfParam],
  );
  const baseFacts = useMemo(
    () =>
      filterFacts({
        days,
        visits: data.visits,
        clients,
        patterns: data.patterns,
        clientLeaves: data.clientLeaves,
        staff: data.staff,
        visitTypes: data.visitTypes,
      }),
    [days, data.visits, clients, data.patterns, data.clientLeaves, data.visitTypes, data.staff],
  );
  /**
   * 相性のチップの判定に使う相性の写し（PRD D116）。絞り込みを変えたときの相性に止め、セルを押しても行を消さない
   * （押した行が消えて、次の人のセルを押してしまわないように）。「表を並べ直す」でいまの相性に合わせる
   */
  const filterKey = `${cfParam ?? ''}|${sfParam ?? ''}`;
  const [snap, setSnap] = useState({ key: filterKey, compat: data.compat });
  if (snap.key !== filterKey) setSnap({ key: filterKey, compat: data.compat });
  const snapCompat = snap.key === filterKey ? snap.compat : data.compat;
  const chipSets = useMemo(
    () => compatChipSets(snapCompat, clientIds, shownStaffIds, staffIds),
    [snapCompat, clientIds, shownStaffIds, staffIds],
  );
  const facts = useMemo(() => ({ ...baseFacts, extraTests: compatChipTests(chipSets) }), [baseFacts, chipSets]);
  const shownClients = useMemo(
    () => filterClients(clients, clientFilter, facts, resolveStaffId(clientFilter, staff, facts, clients)),
    [clients, clientFilter, facts, staff],
  );
  const usesCompatChips = (clientFilter.extra?.length ?? 0) > 0;
  /** 写しが古い（相性のチップを押していて、そのあとセルを押した） */
  const stale = usesCompatChips && snapCompat !== data.compat;
  const extraChips = useMemo(
    () => COMPAT_CHIPS.map((k) => ({ key: k, ...compatChipText(k, terms.staff) })),
    [terms.staff],
  );
  const filterTerms = useMemo(() => ({ client: terms.client, staff: terms.staff }), [terms.client, terms.staff]);
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const periodLabel = `${md(dates[0]!)}（${WEEKDAY_LABELS[weekday(dates[0]!)]}）からの週`;

  /** URL に書く（既定なら消す。履歴を増やさない） */
  const go = useCallback(
    (key: 'cf' | 'sf', value: string | null) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (value === null) p.delete(key);
          else p.set(key, value);
          return p;
        },
        { replace: true },
      ),
    [setParams],
  );
  const setClientFilter = useCallback(
    (f: ClientFilterState) => go('cf', sameFilter(f, EMPTY_FILTER) ? null : encodeFilter(f)),
    [go],
  );
  const setStaffFilter = useCallback(
    (f: StaffFilterState) => go('sf', sameStaffFilter(f, EMPTY_STAFF_FILTER) ? null : encodeStaffFilter(f)),
    [go],
  );
  // URL に知らないチップ・項目があって捨てたら、URL も書き直す（replace）
  useEffect(() => {
    if (sfParam !== null) {
      const v = sameStaffFilter(staffFilter, EMPTY_STAFF_FILTER) ? null : encodeStaffFilter(staffFilter);
      if (v !== sfParam) go('sf', v);
    }
  }, [sfParam, staffFilter, go]);
  useEffect(() => {
    if (cfParam !== null) {
      const v = sameFilter(clientFilter, EMPTY_FILTER) ? null : encodeFilter(clientFilter);
      if (v !== cfParam) go('cf', v);
    }
  }, [cfParam, clientFilter, go]);

  // ---- 絞り込みの欄（畳める。URL に絞り込みがあるときだけ開いておく）----
  const [sfOpen, setSfOpen] = useState(() => sfParam !== null);
  const [cfOpen, setCfOpen] = useState(() => cfParam !== null);

  const cycle = useCallback(
    (clientId: string, staffId: string) =>
      update((d) => {
        const row = { ...(d.compat[clientId] ?? {}) };
        const next = nextLevel(row[staffId] ?? 0);
        if (next === 0) delete row[staffId];
        else row[staffId] = next;
        return { ...d, compat: { ...d.compat, [clientId]: row } };
      }),
    [update],
  );

  /** 見出しのボタンを押す（同じボタンをもう一度押すと閉じる） */
  const toggle = useCallback(
    (kind: OpenKind, id: string) => setOpened((o) => (o && o.kind === kind && o.id === id ? null : { kind, id })),
    [],
  );
  const close = useCallback(() => setOpened(null), []);
  const isOpen = (kind: OpenKind, id: string) => opened?.kind === kind && opened.id === id;
  const popId = (kind: OpenKind, id: string) => `${uid}-${kind}-${id}`;

  // 絞り込みで見出しが消えたら吹き出しを閉じる
  const openStaff = opened?.kind === 'staff' ? shownStaff.find((s) => s.id === opened.id) : undefined;
  const openClient = opened?.kind === 'client' ? shownClients.find((c) => c.id === opened.id) : undefined;
  if (opened && !openStaff && !openClient) setOpened(null);
  const noStaff = shownStaff.length === 0;
  const noClients = shownClients.length === 0;

  return (
    <div className="stack">
      <PageHeader
        nav={<SettingsTabs />}
        icon={HeartHandshake}
        title="相性"
        lead="セルを押すと ◎ → ○ → 空 → △ → × と変わります"
      />
      <div className="compat-filters" data-testid="compat-filters">
        <details
          className="card compat-filter"
          open={sfOpen}
          onToggle={(e) => setSfOpen(e.currentTarget.open)}
          data-testid="compat-sf-box"
        >
          <summary className="compat-filter-summary">
            <span className="compat-filter-title">{terms.staff}（列）の絞り込み</span>
            <span className="sub" data-testid="compat-sf-summary">
              {staffFilterSummary(staffFilter, shownStaff.length, staff.length, terms.staff)}
            </span>
          </summary>
          <StaffFilter
            staff={staff}
            state={staffFilter}
            onChange={setStaffFilter}
            defs={defs}
            defaults={EMPTY_STAFF_FILTER}
            staffTerm={terms.staff}
            testId="compat-sf"
          />
        </details>
        <details
          className="card compat-filter"
          open={cfOpen}
          onToggle={(e) => setCfOpen(e.currentTarget.open)}
          data-testid="compat-cf-box"
        >
          <summary className="compat-filter-summary">
            <span className="compat-filter-title">{terms.client}（行）の絞り込み</span>
            <span className="sub" data-testid="compat-cf-summary">
              {clientFilterSummary(clientFilter, shownClients.length, clients.length, terms.client)}
            </span>
          </summary>
          <MemoClientFilter
            clients={clients}
            state={clientFilter}
            onChange={setClientFilter}
            facts={facts}
            staff={staff}
            terms={filterTerms}
            periodLabel={periodLabel}
            defaults={EMPTY_FILTER}
            visitTypes={data.visitTypes}
            extraChips={extraChips}
            hideEnded
            testId="compat-cf"
          />
        </details>
      </div>
      <div className="card stack">
        <div className="compat-legend">
          {LEGEND.map((l) => (
            <span key={l.mark} className={`compat-legend-item ${l.cls}`}>
              <b>{l.mark}</b>
              {l.text}
            </span>
          ))}
          <Hint label="点のしくみ">
            ◎○は点が下がり（選ばれやすい）、△は点が上がります。
            <span className="red-text">×</span>
            は「NG」で、重みに関係なく担当にしません。点の大きさは「条件の重み」の画面の「相性」の重みで決まります。
            相性は人が入れるもので、実績から自動では変わりません。
          </Hint>
          {stale && (
            <button
              type="button"
              className="btn btn-small compat-resort"
              title="相性のチップの絞り込みを、いまの相性で並べ直します（セルを押しても、押した行は消しません）"
              onClick={() => setSnap({ key: filterKey, compat: data.compat })}
              data-testid="compat-resort"
            >
              <RefreshCw size={14} strokeWidth={2.2} aria-hidden="true" />
              表を並べ直す
            </button>
          )}
        </div>
        {noStaff || noClients ? (
          <div className="stack" data-testid="compat-empty">
            {noStaff && (
              <Empty icon={SearchX}>
                当てはまる{terms.staff}がいません
                {!sameStaffFilter(staffFilter, EMPTY_STAFF_FILTER) && (
                  <div>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => setStaffFilter(EMPTY_STAFF_FILTER)}
                      data-testid="compat-empty-sf-reset"
                    >
                      絞り込みを戻す
                    </button>
                  </div>
                )}
              </Empty>
            )}
            {noClients && (
              <Empty icon={SearchX}>
                当てはまる{terms.client}がいません
                {!sameFilter(clientFilter, EMPTY_FILTER) && (
                  <div>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => setClientFilter(EMPTY_FILTER)}
                      data-testid="compat-empty-cf-reset"
                    >
                      絞り込みを戻す
                    </button>
                  </div>
                )}
              </Empty>
            )}
          </div>
        ) : (
          <EdgeScroll className="table-scroll compat-scroll">
            <table className="compat-table" data-testid="compat-table">
              <thead>
                <tr>
                  <th className="avail-name">{terms.client}</th>
                  {shownStaff.map((s) => (
                    <th key={s.id} className="compat-head">
                      <button
                        type="button"
                        id={`${popId('staff', s.id)}-btn`}
                        className="compat-head-btn"
                        aria-haspopup="dialog"
                        aria-expanded={isOpen('staff', s.id)}
                        aria-controls={isOpen('staff', s.id) ? popId('staff', s.id) : undefined}
                        aria-label={`${s.name}の詳細`}
                        onClick={() => toggle('staff', s.id)}
                        data-testid="compat-head-btn"
                        data-id={s.id}
                      >
                        <span className="dot dot-sm" style={{ background: colorOfStaff.get(s.id) ?? staffColor(0) }}>
                          {initialOf(s.name)}
                        </span>
                        <span className="compat-head-name" aria-hidden="true">
                          {nameLines(s.name).map((line, i) => (
                            // biome-ignore lint/suspicious/noArrayIndexKey: 同じ文字の行が並ぶこともある
                            <span key={i} className="compat-head-line">
                              {line}
                            </span>
                          ))}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shownClients.map((c) => (
                  <CompatRow
                    key={c.id}
                    client={c}
                    cols={shownStaff}
                    row={Object.hasOwn(data.compat, c.id) ? data.compat[c.id] : undefined}
                    open={isOpen('client', c.id)}
                    popId={popId('client', c.id)}
                    onToggle={toggle}
                    onCycle={cycle}
                  />
                ))}
              </tbody>
            </table>
          </EdgeScroll>
        )}
        <p className="sub">
          休止中の{terms.client}・{terms.staff}は出していません。
        </p>
      </div>
      {openStaff && (
        <DetailPopover
          key={`staff-${openStaff.id}`}
          id={popId('staff', openStaff.id)}
          anchorId={`${popId('staff', openStaff.id)}-btn`}
          title={openStaff.name}
          titleId={`${popId('staff', openStaff.id)}-title`}
          onClose={close}
          testId="compat-pop"
        >
          <StaffDetail staff={openStaff} data={data} linkTestId="compat-pop-link" countsTestId="compat-pop-counts" />
        </DetailPopover>
      )}
      {openClient && (
        <DetailPopover
          key={`client-${openClient.id}`}
          id={popId('client', openClient.id)}
          anchorId={`${popId('client', openClient.id)}-btn`}
          title={openClient.displayName}
          titleId={`${popId('client', openClient.id)}-title`}
          onClose={close}
          testId="compat-pop"
        >
          <ClientDetail client={openClient} data={data} linkTestId="compat-pop-link" />
        </DetailPopover>
      )}
    </div>
  );
}

/** 絞り込みの欄（相性のセルを押しても、引数が変わらなければ描き直さない） */
const MemoClientFilter = memo(ClientFilter);
