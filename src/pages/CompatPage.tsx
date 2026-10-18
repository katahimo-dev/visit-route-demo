import { HeartHandshake, SearchX } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useDay } from '../app/day';
import { ClientFilter } from '../components/ClientFilter';
import { condText } from '../components/conditions';
import { DetailPopover } from '../components/DetailPopover';
import { TentativeMark } from '../components/parts';
import { StaffFilter } from '../components/StaffFilter';
import { Empty, Hint, PageHeader } from '../components/ui';
import type { Client, Staff } from '../contracts/documents';
import { COMPAT_LABELS, COMPAT_LEVELS, type CompatLevel } from '../contracts/rules';
import { timeText } from '../domain/availability';
import { weekday } from '../domain/time';
import { areaOf } from '../lib/area';
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
import { STAGE_LABELS } from '../lib/clientStage';
import { colorOf, initialOf } from '../lib/colors';
import { byDisplayName, byName, dateText, staffColor, TRAVEL_MODE_LABELS, WEEKDAY_LABELS } from '../lib/common';
import {
  COMPAT_CHIPS,
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
  staffCompatCounts,
  traitText,
  weeklyHours,
} from '../lib/compatView';
import { weekDates, weekDay } from '../lib/week';
import { useDemoData } from '../store';
import './settings.css';

/** 凡例（◎○△×の意味。色は表のセルと同じ） */
const LEGEND: { mark: string; cls: string; text: string }[] = [
  { mark: '◎', cls: 'lv2', text: '選ばれやすい' },
  { mark: '○', cls: 'lv1', text: 'やや選ばれやすい' },
  { mark: '△', cls: 'lvm1', text: '選ばれにくい' },
  { mark: '×', cls: 'lvm2', text: '担当にしない' },
];

/** 次の相性（◎→○→空→△→×→◎） */
const nextLevel = (l: CompatLevel): CompatLevel =>
  COMPAT_LEVELS[(COMPAT_LEVELS.indexOf(l) + 1) % COMPAT_LEVELS.length] as CompatLevel;

/** URL の値（無ければ null） */
const paramOf = (params: URLSearchParams, key: string): string | null =>
  params.has(key) ? (params.get(key) ?? '') : null;

/** 開いている吹き出し（押したボタンに合わせて出す） */
type Opened = { kind: 'staff' | 'client'; id: string; anchor: HTMLElement };

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
  const staff = useMemo(() => data.staff.filter((s) => s.active).sort(byName), [data.staff]);
  const allStaff = useMemo(() => [...data.staff].sort(byName), [data.staff]);
  // 色は休止中も含めた並びで決める（予定・AI案の画面と同じ色にする）
  const colorOfStaff = useMemo(() => new Map(allStaff.map((s, i) => [s.id, staffColor(i)])), [allStaff]);
  const staffById = useMemo(() => new Map(data.staff.map((s) => [s.id, s])), [data.staff]);
  const itemById = useMemo(() => new Map(data.items.map((i) => [i.id, i])), [data.items]);
  const staffItems = useMemo(() => data.items.filter((i) => i.target === 'staff'), [data.items]);
  const levelOf = (clientId: string, staffId: string): CompatLevel => data.compat[clientId]?.[staffId] ?? 0;

  // ---- 列（〈スタッフ〉）の絞り込み（?sf=）----
  const defs = useMemo(() => staffChipDefs(data.items), [data.items]);
  const sfParam = paramOf(params, 'sf');
  const staffFilter = useMemo(() => decodeStaffFilter(sfParam, defs), [sfParam, defs]);
  const shownStaff = useMemo(() => filterStaff(staff, staffFilter, defs), [staff, staffFilter, defs]);

  // ---- 行（〈利用者さん〉）の絞り込み（?cf=。期間は選んでいる日を含む週）----
  const { date } = useDay();
  const dates = useMemo(() => weekDates(date), [date]);
  const days = useMemo(() => dates.map((d) => weekDay(data, d)), [data, dates]);
  const cfParam = paramOf(params, 'cf');
  const clientFilter = useMemo(() => decodeFilter(cfParam, EMPTY_FILTER, COMPAT_CHIPS), [cfParam]);
  const baseFacts = useMemo(
    () =>
      filterFacts({
        days,
        visits: data.visits,
        clients,
        patterns: data.patterns,
        clientLeaves: data.clientLeaves,
        staff: data.staff,
      }),
    [days, data.visits, clients, data.patterns, data.clientLeaves, data.staff],
  );
  const facts = useMemo(
    () => ({
      ...baseFacts,
      extraTests: compatChipTests(
        data.compat,
        shownStaff.map((s) => s.id),
        staff.map((s) => s.id),
      ),
    }),
    [baseFacts, data.compat, shownStaff, staff],
  );
  const shownClients = useMemo(
    () => filterClients(clients, clientFilter, facts, resolveStaffId(clientFilter, staff, facts, clients)),
    [clients, clientFilter, facts, staff],
  );
  const extraChips = useMemo(
    () => COMPAT_CHIPS.map((k) => ({ key: k, ...compatChipText(k, terms.staff) })),
    [terms.staff],
  );
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const periodLabel = `${md(dates[0]!)}（${WEEKDAY_LABELS[weekday(dates[0]!)]}）からの週`;

  /** URL に書く（既定なら消す。履歴を増やさない） */
  const go = (key: 'cf' | 'sf', value: string | null) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (value === null) p.delete(key);
        else p.set(key, value);
        return p;
      },
      { replace: true },
    );
  const setClientFilter = (f: ClientFilterState) => go('cf', sameFilter(f, EMPTY_FILTER) ? null : encodeFilter(f));
  const setStaffFilter = (f: StaffFilterState) =>
    go('sf', sameStaffFilter(f, EMPTY_STAFF_FILTER) ? null : encodeStaffFilter(f));

  const cycle = (clientId: string, staffId: string) =>
    update((d) => {
      const row = { ...(d.compat[clientId] ?? {}) };
      const next = nextLevel(row[staffId] ?? 0);
      if (next === 0) delete row[staffId];
      else row[staffId] = next;
      return { ...d, compat: { ...d.compat, [clientId]: row } };
    });

  /** 見出しのボタンを押す（同じボタンをもう一度押すと閉じる） */
  const toggle = (kind: Opened['kind'], id: string, anchor: HTMLElement) =>
    setOpened((o) => (o && o.kind === kind && o.id === id ? null : { kind, id, anchor }));
  const isOpen = (kind: Opened['kind'], id: string) => opened?.kind === kind && opened.id === id;
  const popId = (kind: Opened['kind'], id: string) => `${uid}-${kind}-${id}`;

  const staffDetail = (s: Staff) => {
    const cc = staffCompatCounts(
      data.compat,
      s.id,
      clients.map((c) => c.id),
    );
    const usual = clients.filter((c) => c.usualStaffId === s.id).length;
    return (
      <>
        <dl>
          <dt>名前</dt>
          <dd>{s.name}</dd>
          <dt>移動手段</dt>
          <dd>{TRAVEL_MODE_LABELS[s.travelMode]}</dd>
          {staffItems.map((it) => (
            <FragmentRow key={it.id} term={it.name} value={traitText(s.traits[it.id])} />
          ))}
          <dt>稼働時間</dt>
          <dd>
            <ul className="detail-popover-list">
              {weeklyHours(s).map((w) => (
                <li key={w.weekday}>
                  {WEEKDAY_LABELS[w.weekday]}：{w.hours ? `${timeText(w.hours.start)}〜${timeText(w.hours.end)}` : '—'}
                </li>
              ))}
            </ul>
          </dd>
          {s.lastDay && (
            <>
              <dt>最終勤務日</dt>
              <dd>{dateText(s.lastDay)}</dd>
            </>
          )}
          <dt>相性</dt>
          <dd data-testid="compat-pop-counts">
            ◎ {cc.great}・○ {cc.good}・△ {cc.poor}・× {cc.ng}
          </dd>
          <dt>いつもの担当の{terms.client}</dt>
          <dd>{usual}人</dd>
        </dl>
        <Link
          className="detail-popover-link"
          to={`/staff?id=${encodeURIComponent(s.id)}`}
          data-testid="compat-pop-link"
        >
          {terms.staff}の画面で開く
        </Link>
      </>
    );
  };

  const clientDetail = (c: Client) => {
    const area = areaOf(c.place.address);
    const conds = (xs: Client['requirements']) =>
      xs.length === 0 ? (
        '—'
      ) : (
        <ul className="detail-popover-list">
          {xs.map((x, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 同じ文の条件が並ぶこともある
            <li key={i}>{condText(x, itemById.get(x.itemId))}</li>
          ))}
        </ul>
      );
    const nameOf = (id: string) => {
      const s = staffById.get(id);
      return s ? `${s.name}${s.active ? '' : '（休止中）'}` : '（不明）';
    };
    const allowed = c.allowedStaffIds.filter((id) => staffById.get(id)?.active);
    return (
      <>
        <dl>
          <dt>段階</dt>
          <dd>
            {STAGE_LABELS[c.stage]}
            {c.tentative && '（仮押さえ）'}
          </dd>
          <dt>地区</dt>
          <dd>{area ? `${area.city}${area.town ? ` ${area.town}` : ''}` : '住所なし'}</dd>
          <dt>必要条件</dt>
          <dd>{conds(c.requirements)}</dd>
          <dt>希望</dt>
          <dd>{conds(c.preferences)}</dd>
          <dt>担当できる人</dt>
          <dd>{allowed.length === 0 ? '限らない' : allowed.map(nameOf).join('・')}</dd>
          <dt>いつもの担当</dt>
          <dd>{c.usualStaffId ? nameOf(c.usualStaffId) : '—'}</dd>
        </dl>
        <Link
          className="detail-popover-link"
          to={`/clients?id=${encodeURIComponent(c.id)}`}
          data-testid="compat-pop-link"
        >
          {terms.client}の画面で開く
        </Link>
      </>
    );
  };

  // 絞り込みで見出しが消えたら吹き出しも出さない
  const openStaff = opened?.kind === 'staff' ? shownStaff.find((s) => s.id === opened.id) : undefined;
  const openClient = opened?.kind === 'client' ? shownClients.find((c) => c.id === opened.id) : undefined;
  const noStaff = shownStaff.length === 0;
  const noClients = shownClients.length === 0;

  return (
    <div className="stack">
      <PageHeader icon={HeartHandshake} title="相性" lead="セルを押すと ◎ → ○ → 空 → △ → × と変わります" />
      <div className="card stack" data-testid="compat-filters">
        <h2 className="compat-filter-title">{terms.staff}（列）の絞り込み</h2>
        <StaffFilter
          staff={staff}
          state={staffFilter}
          onChange={setStaffFilter}
          defs={defs}
          defaults={EMPTY_STAFF_FILTER}
          staffTerm={terms.staff}
          testId="compat-sf"
        />
        <h2 className="compat-filter-title">{terms.client}（行）の絞り込み</h2>
        <ClientFilter
          clients={clients}
          state={clientFilter}
          onChange={setClientFilter}
          facts={facts}
          staff={staff}
          terms={{ client: terms.client, staff: terms.staff }}
          periodLabel={periodLabel}
          defaults={EMPTY_FILTER}
          extraChips={extraChips}
          hideEnded
          testId="compat-cf"
        />
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
          <div className="table-scroll">
            <table className="compat-table" data-testid="compat-table">
              <thead>
                <tr>
                  <th className="avail-name">{terms.client}</th>
                  {shownStaff.map((s) => (
                    <th key={s.id} className="compat-head">
                      <button
                        type="button"
                        className="compat-head-btn"
                        aria-haspopup="dialog"
                        aria-expanded={isOpen('staff', s.id)}
                        aria-controls={isOpen('staff', s.id) ? popId('staff', s.id) : undefined}
                        aria-label={`${s.name}の詳細`}
                        onClick={(e) => toggle('staff', s.id, e.currentTarget)}
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
                  <tr key={c.id}>
                    <th className="avail-name">
                      <button
                        type="button"
                        className="compat-client-btn"
                        aria-haspopup="dialog"
                        aria-expanded={isOpen('client', c.id)}
                        aria-controls={isOpen('client', c.id) ? popId('client', c.id) : undefined}
                        aria-label={`${c.displayName}の詳細`}
                        onClick={(e) => toggle('client', c.id, e.currentTarget)}
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
                    {shownStaff.map((s) => {
                      const l = levelOf(c.id, s.id);
                      return (
                        <td key={s.id} className="compat-cell">
                          <button
                            type="button"
                            className={`compat-btn lv${l < 0 ? `m${-l}` : l}`}
                            title={`${c.displayName} × ${s.name}`}
                            aria-label={`${c.displayName}と${s.name}の相性：${COMPAT_LABELS[l] || '未入力'}`}
                            onClick={() => cycle(c.id, s.id)}
                          >
                            {COMPAT_LABELS[l]}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="sub">
          休止中の{terms.client}・{terms.staff}は出していません。
        </p>
      </div>
      {opened && openStaff && (
        <DetailPopover
          key={`staff-${openStaff.id}`}
          id={popId('staff', openStaff.id)}
          anchor={opened.anchor}
          title={openStaff.name}
          titleId={`${popId('staff', openStaff.id)}-title`}
          onClose={() => setOpened(null)}
          testId="compat-pop"
        >
          {staffDetail(openStaff)}
        </DetailPopover>
      )}
      {opened && openClient && (
        <DetailPopover
          key={`client-${openClient.id}`}
          id={popId('client', openClient.id)}
          anchor={opened.anchor}
          title={openClient.displayName}
          titleId={`${popId('client', openClient.id)}-title`}
          onClose={() => setOpened(null)}
          testId="compat-pop"
        >
          {clientDetail(openClient)}
        </DetailPopover>
      )}
    </div>
  );
}

/** 説明の並び（dl）の1行 */
function FragmentRow({ term, value }: { term: string; value: string }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{value}</dd>
    </>
  );
}
