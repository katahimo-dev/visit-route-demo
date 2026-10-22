// 〈スタッフ〉・〈利用者さん〉の画面の閲覧の欄の中身（PRD D127〜D131。ADR-0023）。読むだけで、入力欄・即時に書き換えるボタンは置かない。
// 行の部品は相性・予定の吹き出し（components/personDetail）と共通。閲覧の欄のほうが詳しい（編集の欄と同じ項目を並べる）。
// 相手の名前（〈スタッフ〉の相性・担当の〈利用者さん〉、〈利用者さん〉の担当できる人・いつもの担当）は押すと詳細の吹き出し（PRD D198〜D200）
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
import { useMemo, useState } from 'react';
import type { DemoData } from '../contracts/data';
import type { Client, Staff } from '../contracts/documents';
import { jstDate } from '../domain/time';
import { STAGE_LABELS } from '../lib/clientStage';
import { colorOf } from '../lib/colors';
import { hasLocation } from '../lib/common';
import { staffClientGroups, traitText } from '../lib/compatView';
import { isOn } from '../lib/features';
import { leavesOf } from '../lib/leaves';
import { mdText, patternWhenText, periodText, typeOf } from '../lib/patternText';
import { formatPostalCode } from '../lib/postalCode';
import { orDash, splitLeaves } from '../lib/viewMode';
import { PersonButton } from './PersonPopover';
import {
  ClientAreaRow,
  ClientStaffRows,
  CondRows,
  DlRow,
  StaffHoursRow,
  StaffLastDayRow,
  StaffTraitRows,
  StaffTravelRow,
} from './personDetail';
import { RouteMap } from './RouteMap';
import { StaffMark } from './StaffMark';
import { SectionTitle } from './ui';
import { VISIT_RULE_FIELDS } from './VisitRules';
import './personView.css';

/** 位置の文字（座標があれば「あり」と座標、無ければ「未登録」） */
const placeText = (p: { lat: number | null; lng: number | null }) =>
  p.lat !== null && p.lng !== null ? `あり（${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}）` : '未登録';

/** 〈スタッフ〉の閲覧の欄：基本（状態・メール・移動手段・稼働時間・最終勤務日）・特性・求めること・自宅・相性 */
export function StaffView({ staff: s, data }: { staff: Staff; data: DemoData }) {
  const terms = data.org.terms;
  // 機能の入り切り（ADR-0028）：メールを切ればメールアドレス、相性を切れば相性の行を出さない
  const mailOn = isOn(data.org.features, 'mail');
  const compatOn = isOn(data.org.features, 'compat');
  return (
    <div className="person-view stack" data-testid="person-view" data-kind="staff" data-id={s.id}>
      {/* 〈スタッフ〉の印（PRD D298・D299）。アイコンが無ければ苗字の最初の1文字 */}
      <div className="with-staff-mark" data-testid="view-staff-mark">
        <StaffMark staff={s} size="lg" />
        <span className="sub">{s.icon ? `アイコン「${s.icon}」` : 'アイコンは未設定（苗字の最初の1文字）'}</span>
      </div>
      <SectionTitle icon={UserRound}>基本</SectionTitle>
      <dl>
        <DlRow term="状態" value={s.active ? '利用中' : '休止中'} />
        {mailOn && <DlRow term="メールアドレス" value={orDash(s.email)} />}
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
      <SectionTitle icon={Repeat}>{compatOn ? '相性・担当' : '担当'}</SectionTitle>
      <dl>
        <StaffClientRows staff={s} data={data} compatOn={compatOn} />
      </dl>
    </div>
  );
}

/** 相性の記号の行（並びと意味は相性の画面の凡例と同じ） */
const COMPAT_ROWS = [
  { key: 'great', term: '◎ 選ばれやすい' },
  { key: 'good', term: '○ やや選ばれやすい' },
  { key: 'poor', term: '△ 選ばれにくい' },
  { key: 'ng', term: '× 担当にしない' },
] as const;

/**
 * 〈スタッフ〉の相性・担当（PRD D198）：いつもの担当の〈利用者さん〉と、相性の記号ごとの〈利用者さん〉の名前（人数を添える）。
 * 数えるのは利用中の〈利用者さん〉（相性の画面の行・吹き出しの件数と同じ）。名前は押すと詳細の吹き出し
 */
function StaffClientRows({ staff: s, data, compatOn }: { staff: Staff; data: DemoData; compatOn: boolean }) {
  const g = staffClientGroups(
    data.compat,
    s.id,
    data.clients.filter((c) => c.active),
  );
  return (
    <>
      <DlRow
        term={`いつもの担当の${data.org.terms.client}`}
        value={<PersonNames kind="client" people={g.usual} testId="view-usual-clients" count />}
      />
      {(compatOn ? COMPAT_ROWS : []).map((r) => (
        <DlRow
          key={r.key}
          term={r.term}
          value={<PersonNames kind="client" people={g[r.key]} testId={`view-compat-${r.key}`} count />}
        />
      ))}
    </>
  );
}

/** 名前を並べる上限（超えたぶんは「あと N人」で開く。開いたかは欄の中だけで覚える） */
export const NAMES_SHOWN = 12;

/**
 * 相手の名前を並べる（PRD D198〜D200）。名前は PersonButton（押すと詳細の吹き出し・そこから相手の画面の閲覧の欄）。
 * 休止中の〈スタッフ〉は添える。居なければ「—」。count で先頭に人数
 */
function PersonNames({
  kind,
  people,
  testId,
  count = false,
}: {
  kind: 'staff' | 'client';
  people: (Staff | Client)[];
  testId: string;
  count?: boolean;
}) {
  const [all, setAll] = useState(false);
  if (people.length === 0) return <span data-testid={testId}>—</span>;
  const shown = all ? people : people.slice(0, NAMES_SHOWN);
  const rest = people.length - shown.length;
  return (
    <span className="person-view-names" data-testid={testId}>
      {count && <span className="sub">{people.length}人</span>}
      {shown.map((p) => {
        const name = 'displayName' in p ? p.displayName : p.name;
        return (
          <span key={p.id} className="person-view-name">
            <PersonButton kind={kind} id={p.id} name={name} />
            {p.active ? '' : '（休止中）'}
          </span>
        );
      })}
      {people.length > NAMES_SHOWN && (
        <button
          type="button"
          className="btn btn-small person-view-more"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
          data-testid={`${testId}-more`}
        >
          {all ? '畳む' : `あと ${rest}人`}
        </button>
      )}
    </span>
  );
}

/**
 * 〈利用者さん〉の閲覧の欄：基本（段階・よみ・いつもの担当・メモ）・住所と地図・特性・求めること・担当できる人・
 * 訪問先の決まりごと・定期パターン・休み・紹介元
 */
export function ClientView({ client: c, data }: { client: Client; data: DemoData }) {
  const terms = data.org.terms;
  // 機能の入り切り（ADR-0028）：段階・紹介元を切れば紹介元、決まりごとを切れば決まりごとの節を出さない。休みは事実なので出す
  const stageOn = isOn(data.org.features, 'clientStage');
  const notesOn = isOn(data.org.features, 'visitNotes');
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
        <ClientStaffRows
          client={c}
          data={data}
          names={(staff, testId) => <PersonNames kind="staff" people={staff} testId={testId} />}
        />
      </dl>

      {notesOn && (
        <>
          <SectionTitle icon={DoorOpen}>訪問先の決まりごと</SectionTitle>
          <dl>
            {VISIT_RULE_FIELDS.map((f) => (
              <DlRow key={f.key} term={f.label} value={orDash(c[f.key])} />
            ))}
          </dl>
        </>
      )}

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

      {stageOn && (
        <>
          <SectionTitle icon={Handshake}>紹介元</SectionTitle>
          <dl>
            <DlRow term="紹介元" value={orDash(c.referrer.name)} />
            <DlRow term="連絡先" value={orDash(c.referrer.contact)} />
            <DlRow term="メールアドレス" value={orDash(c.referrer.email)} />
            <DlRow term="メモ" value={orDash(c.referrer.note)} />
          </dl>
        </>
      )}
    </div>
  );
}
