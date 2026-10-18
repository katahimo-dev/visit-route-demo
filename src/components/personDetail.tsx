// 〈スタッフ〉・〈利用者さん〉の詳細の中身（PRD D114・D115・D122。ADR-0022）。相性の画面と、予定（月・週・日）の名前の吹き出しで共通。
// 中身は吹き出しを開いたときだけ作る（データから引いて数えるのは開いた1人ぶん）
import { Link } from 'react-router-dom';
import type { DemoData } from '../contracts/data';
import type { Client, Staff } from '../contracts/documents';
import { timeText } from '../domain/availability';
import { areaOf } from '../lib/area';
import { STAGE_LABELS } from '../lib/clientStage';
import { dateText, TRAVEL_MODE_LABELS, WEEKDAY_LABELS } from '../lib/common';
import { staffCompatCounts, traitText, weeklyHours } from '../lib/compatView';
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
  // 数えるのは利用中（休止中でない）の〈利用者さん〉（相性の画面の行と同じ）
  const clients = data.clients.filter((c) => c.active);
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
        {data.items
          .filter((it) => it.target === 'staff')
          .map((it) => (
            <DlRow key={it.id} term={it.name} value={traitText(s.traits[it.id])} />
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
        <dd data-testid={countsTestId}>
          ◎ {cc.great}・○ {cc.good}・△ {cc.poor}・× {cc.ng}
        </dd>
        <dt>いつもの担当の{terms.client}</dt>
        <dd>{usual}人</dd>
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
  const area = areaOf(c.place.address);
  const itemOf = (id: string) => data.items.find((i) => i.id === id);
  const staffOf = (id: string) => data.staff.find((s) => s.id === id);
  const conds = (xs: Client['requirements']) =>
    xs.length === 0 ? (
      '—'
    ) : (
      <ul className="detail-popover-list">
        {xs.map((x, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 同じ文の条件が並ぶこともある
          <li key={i}>{condText(x, itemOf(x.itemId))}</li>
        ))}
      </ul>
    );
  const nameOf = (id: string) => {
    const s = staffOf(id);
    return s ? `${s.name}${s.active ? '' : '（休止中）'}` : '（不明）';
  };
  const allowed = c.allowedStaffIds.filter((id) => staffOf(id)?.active);
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
      <Link className="detail-popover-link" to={`/clients?id=${encodeURIComponent(c.id)}`} data-testid={linkTestId}>
        {terms.client}の画面で開く
      </Link>
    </>
  );
}

/** 説明の並び（dl）の1行 */
function DlRow({ term, value }: { term: string; value: string }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{value}</dd>
    </>
  );
}
