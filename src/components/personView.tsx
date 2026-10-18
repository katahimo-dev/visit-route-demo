// 〈スタッフ〉・〈利用者さん〉の画面の閲覧の欄の中身（PRD D127〜D131。ADR-0023）。読むだけで、入力欄・即時に書き換えるボタンは置かない。
// 行の部品は相性・予定の吹き出し（components/personDetail）と共通。閲覧の欄のほうが詳しい（編集の欄と同じ項目を並べる）
import {
  BadgeCheck,
  BedSingle,
  DoorOpen,
  Handshake,
  House,
  Repeat,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react';
import { useMemo } from 'react';
import type { DemoData } from '../contracts/data';
import type { Client, Staff } from '../contracts/documents';
import { jstDate } from '../domain/time';
import { STAGE_LABELS } from '../lib/clientStage';
import { colorOf } from '../lib/colors';
import { hasLocation } from '../lib/common';
import { traitText } from '../lib/compatView';
import { leavesOf } from '../lib/leaves';
import { mdText, patternWhenText, periodText, typeOf } from '../lib/patternText';
import { formatPostalCode } from '../lib/postalCode';
import { orDash, splitLeaves } from '../lib/viewMode';
import {
  ClientAreaRow,
  ClientStaffRows,
  CondRows,
  DlRow,
  StaffCompatRows,
  StaffHoursRow,
  StaffLastDayRow,
  StaffTraitRows,
  StaffTravelRow,
} from './personDetail';
import { RouteMap } from './RouteMap';
import { SectionTitle } from './ui';
import { VISIT_RULE_FIELDS } from './VisitRules';
import './personView.css';

/** 位置の文字（座標があれば「あり」と座標、無ければ「未登録」） */
const placeText = (p: { lat: number | null; lng: number | null }) =>
  p.lat !== null && p.lng !== null ? `あり（${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}）` : '未登録';

/** 〈スタッフ〉の閲覧の欄：基本（状態・メール・移動手段・稼働時間・最終勤務日）・特性・求めること・自宅・相性 */
export function StaffView({ staff: s, data }: { staff: Staff; data: DemoData }) {
  const terms = data.org.terms;
  return (
    <div className="person-view stack" data-testid="person-view" data-kind="staff" data-id={s.id}>
      <SectionTitle icon={UserRound}>基本</SectionTitle>
      <dl>
        <DlRow term="状態" value={s.active ? '利用中' : '休止中'} />
        <DlRow term="メールアドレス" value={orDash(s.email)} />
        <StaffTravelRow staff={s} />
        <StaffHoursRow staff={s} />
        <StaffLastDayRow staff={s} />
      </dl>
      <SectionTitle icon={BadgeCheck}>特性</SectionTitle>
      <dl>
        <StaffTraitRows staff={s} data={data} />
      </dl>
      <SectionTitle icon={SlidersHorizontal}>{terms.client}に求めること</SectionTitle>
      <dl>
        <CondRows requirements={s.requirements} preferences={s.preferences} data={data} />
      </dl>
      <SectionTitle icon={House}>自宅</SectionTitle>
      <dl>
        <DlRow term="住所" value={orDash(s.home.address)} />
        <DlRow term="地図の位置" value={placeText(s.home)} />
      </dl>
      <SectionTitle icon={Repeat}>相性・担当</SectionTitle>
      <dl>
        <StaffCompatRows staff={s} data={data} />
      </dl>
    </div>
  );
}

/**
 * 〈利用者さん〉の閲覧の欄：基本（段階・よみ・いつもの担当・メモ）・住所と地図・特性・求めること・担当できる人・
 * 訪問先の決まりごと・定期パターン・休み・紹介元
 */
export function ClientView({ client: c, data }: { client: Client; data: DemoData }) {
  const terms = data.org.terms;
  const today = jstDate(Date.now());
  const patterns = data.patterns.filter((p) => p.clientId === c.id);
  const leaves = splitLeaves(leavesOf(data, c.id), today);
  /** 〈スタッフ〉の名前（休止中なら添える。いなければ「（不明）」） */
  const staffName = (id: string | null) => {
    if (!id) return null;
    const s = data.staff.find((x) => x.id === id);
    return s ? `${s.name}${s.active ? '' : '（休止中）'}` : '（不明）';
  };
  // 地図の点は位置か色が変わったときだけ作り直す（点の配列が替わると地図が寄せ直すため）
  const lat = c.place.lat;
  const lng = c.place.lng;
  const points = useMemo(
    () => (lat !== null && lng !== null ? [{ lat, lng, label: '●', color: colorOf(c.color) }] : []),
    [lat, lng, c.color],
  );
  return (
    <div className="person-view stack" data-testid="person-view" data-kind="client" data-id={c.id}>
      <SectionTitle icon={Route}>基本</SectionTitle>
      <dl>
        <DlRow
          term="段階"
          value={`${STAGE_LABELS[c.stage]}${c.tentative ? '（枠を仮押さえ。予定・AI案に入ります）' : ''}`}
        />
        <DlRow term="よみ" value={orDash(c.kana)} />
        <DlRow term="メモ" value={orDash(c.note)} />
      </dl>

      <SectionTitle icon={House}>住所</SectionTitle>
      <dl>
        <DlRow term="郵便番号" value={c.place.postalCode ? `〒${formatPostalCode(c.place.postalCode)}` : '—'} />
        <DlRow term="住所" value={orDash(c.place.address)} />
        <ClientAreaRow client={c} />
        <DlRow term="地図の位置" value={placeText(c.place)} />
      </dl>
      {hasLocation(c.place) && <RouteMap height={180} points={points} />}

      <SectionTitle icon={BadgeCheck}>特性</SectionTitle>
      <dl>
        {data.items
          .filter((it) => it.target === 'client')
          .map((it) => (
            <DlRow key={it.id} term={it.name} value={traitText(c.traits[it.id])} />
          ))}
      </dl>

      <SectionTitle icon={SlidersHorizontal}>{terms.staff}に求めること</SectionTitle>
      <dl>
        <CondRows requirements={c.requirements} preferences={c.preferences} data={data} />
      </dl>

      <SectionTitle icon={ShieldCheck}>担当</SectionTitle>
      <dl>
        <ClientStaffRows client={c} data={data} />
      </dl>

      <SectionTitle icon={DoorOpen}>訪問先の決まりごと</SectionTitle>
      <dl>
        {VISIT_RULE_FIELDS.map((f) => (
          <DlRow key={f.key} term={f.label} value={orDash(c[f.key])} />
        ))}
      </dl>

      <SectionTitle icon={Repeat}>定期パターン</SectionTitle>
      {patterns.length === 0 ? (
        <span className="sub">定期パターンはありません</span>
      ) : (
        <ul className="person-view-list" data-testid="view-patterns">
          {patterns.map((p) => {
            const t = typeOf(data.visitTypes, p.typeId);
            const usual = staffName(p.usualStaffId);
            return (
              <li key={p.id}>
                <strong>{patternWhenText(p)}</strong>
                <span className="sub">
                  {t ? t.name : '種類なし'}・{p.durationMinutes}分・{periodText(p)}
                  {usual ? `・いつもの担当 ${usual}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <SectionTitle icon={BedSingle}>休み</SectionTitle>
      {leaves.ahead.length === 0 ? (
        <span className="sub">これからの休みはありません</span>
      ) : (
        <ul className="person-view-list" data-testid="view-leaves">
          {leaves.ahead.map((l) => (
            <li key={l.id}>
              <strong>
                {mdText(l.from)}〜{mdText(l.to)}
              </strong>
              <span className="sub">{l.note || '理由なし'}</span>
            </li>
          ))}
        </ul>
      )}
      {leaves.past > 0 && <span className="sub">終わった休み {leaves.past}件</span>}

      <SectionTitle icon={Handshake}>紹介元</SectionTitle>
      <dl>
        <DlRow term="紹介元" value={orDash(c.referrer.name)} />
        <DlRow term="連絡先" value={orDash(c.referrer.contact)} />
        <DlRow term="メールアドレス" value={orDash(c.referrer.email)} />
        <DlRow term="メモ" value={orDash(c.referrer.note)} />
      </dl>
    </div>
  );
}
