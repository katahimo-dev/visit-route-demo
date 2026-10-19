// 〈スタッフ〉・〈利用者さん〉の詳細の中身（PRD D114・D115・D122・D127。ADR-0022・0023）。相性の画面と、予定（月・週・日）の名前の吹き出しで共通。
// 行（dt・dd）の部品は、〈スタッフ〉・〈利用者さん〉の画面の閲覧の欄（components/personView）でも使う。
// 中身は吹き出しを開いたときだけ作る（データから引いて数えるのは開いた1人ぶん）
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { DemoData } from '../contracts/data';
import type { Client, Staff } from '../contracts/documents';
import type { Condition } from '../contracts/rules';
import { timeText } from '../domain/availability';
import { areaOf } from '../lib/area';
import { STAGE_LABELS } from '../lib/clientStage';
import { dateText, TRAVEL_MODE_LABELS, WEEKDAY_LABELS } from '../lib/common';
import { staffCompatCounts, traitText, weeklyHours } from '../lib/compatView';
import { isOn } from '../lib/features';
import { condText } from './conditions';

/** 〈スタッフ〉の詳細：名前・移動手段・特性・稼働時間・最終勤務日・相性の件数・いつもの担当の人数と「〈スタッフ〉の画面で開く」 */
export function StaffDetail({
  staff: s,
  data,
  linkTestId = 'person-pop-link',
  countsTestId = 'person-pop-counts',
}: {
  staff: Staff;
  data: DemoData;
  linkTestId?: string;
  countsTestId?: string;
}) {
  const terms = data.org.terms;
  return (
    <>
      <dl>
        <DlRow term="名前" value={s.name} />
        <StaffTravelRow staff={s} />
        <StaffTraitRows staff={s} data={data} />
        <StaffHoursRow staff={s} />
        {s.lastDay && <StaffLastDayRow staff={s} />}
        <StaffCompatRows staff={s} data={data} countsTestId={countsTestId} />
      </dl>
      <Link className="detail-popover-link" to={`/staff?id=${encodeURIComponent(s.id)}`} data-testid={linkTestId}>
        {terms.staff}の画面で開く
      </Link>
    </>
  );
}

/** 〈利用者さん〉の詳細：段階・地区・必要条件・希望・担当できる人・いつもの担当と「〈利用者さん〉の画面で開く」 */
export function ClientDetail({
  client: c,
  data,
  linkTestId = 'person-pop-link',
}: {
  client: Client;
  data: DemoData;
  linkTestId?: string;
}) {
  const terms = data.org.terms;
  return (
    <>
      <dl>
        <ClientStageRow client={c} />
        <ClientAreaRow client={c} />
        <CondRows requirements={c.requirements} preferences={c.preferences} data={data} />
        <ClientStaffRows client={c} data={data} />
      </dl>
      <Link className="detail-popover-link" to={`/clients?id=${encodeURIComponent(c.id)}`} data-testid={linkTestId}>
        {terms.client}の画面で開く
      </Link>
    </>
  );
}

// ---- 行の部品（dl の中に置く） ----

/** 説明の並び（dl）の1行 */
export function DlRow({ term, value }: { term: string; value: ReactNode }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{value}</dd>
    </>
  );
}

/** 〈スタッフ〉の移動手段 */
export function StaffTravelRow({ staff: s }: { staff: Staff }) {
  return <DlRow term="移動手段" value={TRAVEL_MODE_LABELS[s.travelMode]} />;
}

/** 〈スタッフ〉の特性（〈スタッフ〉の項目すべて。値が空なら「—」） */
export function StaffTraitRows({ staff: s, data }: { staff: Staff; data: DemoData }) {
  return (
    <>
      {data.items
        .filter((it) => it.target === 'staff')
        .map((it) => (
          <DlRow key={it.id} term={it.name} value={traitText(s.traits[it.id])} />
        ))}
    </>
  );
}

/** 〈スタッフ〉の稼働時間（曜日ごと。月〜日。勤務日でなければ「—」） */
export function StaffHoursRow({ staff: s }: { staff: Staff }) {
  return (
    <DlRow
      term="稼働時間"
      value={
        <ul className="detail-popover-list">
          {weeklyHours(s).map((w) => (
            <li key={w.weekday}>
              {WEEKDAY_LABELS[w.weekday]}：{w.hours ? `${timeText(w.hours.start)}〜${timeText(w.hours.end)}` : '—'}
            </li>
          ))}
        </ul>
      }
    />
  );
}

/** 〈スタッフ〉の最終勤務日（無ければ「—」） */
export function StaffLastDayRow({ staff: s }: { staff: Staff }) {
  return <DlRow term="最終勤務日" value={s.lastDay ? dateText(s.lastDay) : '—'} />;
}

/**
 * 〈スタッフ〉の相性の件数・いつもの担当の人数（数えるのは利用中の〈利用者さん〉。相性の画面の行と同じ）。
 * 相性を切っていれば相性の件数は出さない（ADR-0028）
 */
export function StaffCompatRows({
  staff: s,
  data,
  countsTestId,
}: {
  staff: Staff;
  data: DemoData;
  countsTestId?: string;
}) {
  const clients = data.clients.filter((c) => c.active);
  const cc = staffCompatCounts(
    data.compat,
    s.id,
    clients.map((c) => c.id),
  );
  const usual = clients.filter((c) => c.usualStaffId === s.id).length;
  // 相性を切っている（ADR-0028）ときは相性の件数を出さない（いつもの担当は残す）
  const compatOn = isOn(data.org.features, 'compat');
  return (
    <>
      {compatOn && (
        <>
          <dt>相性</dt>
          <dd data-testid={countsTestId}>
            ◎ {cc.great}・○ {cc.good}・△ {cc.poor}・× {cc.ng}
          </dd>
        </>
      )}
      <DlRow term={`いつもの担当の${data.org.terms.client}`} value={`${usual}人`} />
    </>
  );
}

/** 必要条件・希望（無ければ「—」） */
export function CondRows({
  requirements,
  preferences,
  data,
}: {
  requirements: Condition[];
  preferences: Condition[];
  data: DemoData;
}) {
  return (
    <>
      <DlRow term="必要条件" value={<CondList conds={requirements} data={data} />} />
      <DlRow term="希望" value={<CondList conds={preferences} data={data} />} />
    </>
  );
}

/** 条件の並び（無ければ「—」） */
function CondList({ conds, data }: { conds: Condition[]; data: DemoData }) {
  if (conds.length === 0) return '—';
  return (
    <ul className="detail-popover-list">
      {conds.map((x, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 同じ文の条件が並ぶこともある
        <li key={i}>
          {condText(
            x,
            data.items.find((it) => it.id === x.itemId),
          )}
        </li>
      ))}
    </ul>
  );
}

/** 〈利用者さん〉の段階（仮押さえなら添える） */
export function ClientStageRow({ client: c }: { client: Client }) {
  return <DlRow term="段階" value={`${STAGE_LABELS[c.stage]}${c.tentative ? '（仮押さえ）' : ''}`} />;
}

/** 〈利用者さん〉の地区（住所から取り出す。住所が無ければ「住所なし」、住所はあるが取り出せなければ「—」） */
export function ClientAreaRow({ client: c }: { client: Client }) {
  const area = areaOf(c.place.address);
  const text = area
    ? `${area.city}${area.town ? ` ${area.town}` : ''}`
    : c.place.address.trim() === ''
      ? '住所なし'
      : '—';
  return <DlRow term="地区" value={text} />;
}

/**
 * 〈利用者さん〉の担当できる人（限らなければ「限らない」）・いつもの担当（休止中なら添える）。
 * names を渡すと、名前を文字でつながずにその部品で並べる（閲覧の欄で名前から詳細を開く。PRD D199）
 */
export function ClientStaffRows({
  client: c,
  data,
  names,
}: {
  client: Client;
  data: DemoData;
  names?: (staff: Staff[], testId: string) => ReactNode;
}) {
  const staffOf = (id: string) => data.staff.find((s) => s.id === id);
  const nameOf = (id: string) => {
    const s = staffOf(id);
    return s ? `${s.name}${s.active ? '' : '（休止中）'}` : '（不明）';
  };
  const allowed = c.allowedStaffIds.filter((id) => staffOf(id)?.active);
  const usual = c.usualStaffId ? staffOf(c.usualStaffId) : undefined;
  return (
    <>
      {/* 担当を限るを切っている（ADR-0028）ときは出さない（計算にも効かない） */}
      {isOn(data.org.features, 'allowedStaff') && (
        <DlRow
          term="担当できる人"
          value={
            allowed.length === 0
              ? '限らない'
              : names
                ? names(
                    allowed.flatMap((id) => staffOf(id) ?? []),
                    'view-allowed-staff',
                  )
                : allowed.map(nameOf).join('・')
          }
        />
      )}
      <DlRow
        term="いつもの担当"
        value={!c.usualStaffId ? '—' : names && usual ? names([usual], 'view-usual-staff') : nameOf(c.usualStaffId)}
      />
    </>
  );
}
