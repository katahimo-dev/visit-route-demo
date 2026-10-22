// 〈スタッフ〉・〈利用者さん〉の画面（全画面。PRD D308〜D312。ADR-0052）の節の、読むときの中身で共通の部品。入力欄・即時に書き換えるボタンは置かない。
// 行の部品は相性・予定の吹き出し（components/personDetail）と共通。
// 相手の名前（〈スタッフ〉の相性・担当の〈利用者さん〉、〈利用者さん〉の担当できる人・いつもの担当・相性）は押すと詳細の吹き出し（PRD D198〜D200）
import { useState } from 'react';
import type { DemoData } from '../contracts/data';
import type { Client, Staff } from '../contracts/documents';
import { staffClientGroups } from '../lib/compatView';
import { clientStaffGroups } from '../lib/personPage';
import { PersonButton } from './PersonPopover';
import { DlRow } from './personDetail';
import './personView.css';
import { jstDate } from '../domain/time';
import { usualStaffMap } from '../lib/usualStaff';

/** 位置の文字（座標があれば「あり」と座標、無ければ「未登録」） */
export const placeText = (p: { lat: number | null; lng: number | null }) =>
  p.lat !== null && p.lng !== null ? `あり（${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}）` : '未登録';

/** 相性の記号の行（並びと意味は相性の画面の凡例と同じ） */
export const COMPAT_ROWS = [
  { key: 'great', term: '◎ 選ばれやすい' },
  { key: 'good', term: '○ やや選ばれやすい' },
  { key: 'poor', term: '△ 選ばれにくい' },
  { key: 'ng', term: '× 担当にしない' },
] as const;

/**
 * 〈スタッフ〉の相性・担当（PRD D198）：いつもの担当の〈利用者さん〉と、相性の記号ごとの〈利用者さん〉の名前（人数を添える）。
 * 数えるのは利用中の〈利用者さん〉（相性の画面の行・吹き出しの件数と同じ）。名前は押すと詳細の吹き出し
 */
export function StaffClientRows({ staff: s, data, compatOn }: { staff: Staff; data: DemoData; compatOn: boolean }) {
  const g = staffClientGroups(
    data.compat,
    s.id,
    data.clients.filter((c) => c.active),
    usualStaffMap(data.patterns, jstDate(Date.now())),
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
 * 相手の名前を並べる（PRD D198〜D200）。名前は PersonButton（押すと詳細の吹き出し・そこから相手の画面）。
 * 休止中の〈スタッフ〉は添える。居なければ「—」。count で先頭に人数
 */
export function PersonNames({
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
 * 〈利用者さん〉から見た〈スタッフ〉の相性（記号ごとの名前と人数。数えるのは利用中の〈スタッフ〉。相性の画面の列と同じ）。
 * 名前は押すと詳細の吹き出し
 */
export function ClientCompatRows({ client: c, data }: { client: Client; data: DemoData }) {
  const g = clientStaffGroups(
    data.compat,
    c.id,
    data.staff.filter((s) => s.active),
  );
  return (
    <>
      {COMPAT_ROWS.map((r) => (
        <DlRow
          key={r.key}
          term={r.term}
          value={<PersonNames kind="staff" people={g[r.key]} testId={`view-compat-${r.key}`} count />}
        />
      ))}
    </>
  );
}
