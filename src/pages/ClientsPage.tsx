import {
  BadgeCheck,
  BookmarkCheck,
  BookmarkX,
  House,
  MapPin,
  Pencil,
  Plus,
  Repeat,
  Save,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { ClientPicker } from '../components/ClientPicker';
import { CondChips, ConditionsEditor, TraitChips, TraitsEditor } from '../components/conditions';
import { Check, PlaceEditor, TentativeMark } from '../components/parts';
import { useToast } from '../components/Toast';
import { Hint, IconButton, PageHeader, SectionTitle, SidePanel, WithIcon } from '../components/ui';
import { type Client, clientSchema } from '../contracts/documents';
import { jstDate } from '../domain/time';
import { CLIENT_COLORS, colorOf, initialOf } from '../lib/colors';
import { byDisplayName, byName, formError, hasLocation, nameTaken, newId } from '../lib/common';
import { matchClient, staffClientMap } from '../lib/search';
import { cancelTentative as cancelTentativeData, confirmedDatesOf } from '../lib/tentative';
import { useDemoData } from '../store';
import { PatternsSection } from './PatternsSection';
import './settings.css';

/** 訪問先の一覧と編集（PoC本体 ClientsPage.tsx を写し、性別希望・NG を特性・条件・相性に置き換えた） */

const blank = (nextColor: number): Client => ({
  id: newId('c'),
  displayName: '',
  kana: '',
  place: { address: '', lat: null, lng: null },
  note: '',
  color: nextColor % CLIENT_COLORS.length,
  active: true,
  traits: {},
  requirements: [],
  preferences: [],
  usualStaffId: null,
  tentative: false,
});

export default function ClientsPage() {
  const { data, update } = useDemoData();
  const terms = data.org.terms;
  const toast = useToast();
  const [form, setForm] = useState<Client | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clients = useMemo(() => [...data.clients].sort(byDisplayName), [data.clients]);
  const staff = useMemo(() => [...data.staff].sort(byName), [data.staff]);
  // 一覧の絞り込み（PRD D61）：選んだ人がいればその人たち、いなければ検索欄の文字（表示名・よみ）で
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    if (picked.length > 0) return clients.filter((c) => picked.includes(c.id));
    return clients.filter((c) => matchClient(c, query));
  }, [clients, picked, query]);
  /** 近道「〈スタッフ〉が担当する人」：いつもの担当がその人の〈利用者さん〉 */
  const usualOf = useMemo(() => staffClientMap([], data.clients), [data.clients]);
  const staffName = (id: string | null) => (id ? (staff.find((s) => s.id === id)?.name ?? '（不明）') : '');
  const clientItems = data.items.filter((i) => i.target === 'client');
  const itemById = new Map(data.items.map((i) => [i.id, i]));

  const save = () => {
    if (!form) return;
    setError(null);
    // 同じ名前は保存しない（Excel では名前で人を引くため。ADR-0006）
    if (nameTaken(data.clients, (x) => x.displayName, form.displayName, form.id)) {
      setError(`「${form.displayName.trim()}」と同じ名前の${terms.client}がいます。名前を変えてください`);
      return;
    }
    try {
      const c = clientSchema.parse(form);
      update((d) => ({
        ...d,
        clients: d.clients.some((x) => x.id === c.id)
          ? d.clients.map((x) => (x.id === c.id ? c : x))
          : [...d.clients, c],
      }));
      setIsNew(false);
      toast('保存しました');
    } catch (e) {
      setError(formError(e));
    }
  };

  /** 仮押さえを本登録にする（tentative: false。ほかの入力中の項目はそのまま） */
  const confirmTentative = (c: Client) => {
    update((d) => ({ ...d, clients: d.clients.map((x) => (x.id === c.id ? { ...x, tentative: false } : x)) }));
    setForm((f) => (f && f.id === c.id ? { ...f, tentative: false } : f));
    toast(`${c.displayName}を本登録にしました`);
  };

  /**
   * 仮押さえを取り消す（D47）：確認のうえ、lib/tentative の cancelTentative でその人の定期パターン・訪問・〈利用者さん〉を消し、
   * 消した訪問を今の案・記録・確定した割当から、〈利用者さん〉を相性から除く。確定した日を含むなら確認の文にその日数を出す
   */
  const cancelTentative = (c: Client) => {
    const today = jstDate(Date.now());
    const n = data.visits.filter((v) => v.clientId === c.id).length;
    const fixed = confirmedDatesOf(data, c.id).length;
    const msg = `仮押さえの${c.displayName}を取り消します。定期パターンと訪問 ${n}件を消し、${terms.client}も消します。${
      fixed > 0 ? `確定した日（${fixed}日）の割当からも外します。` : ''
    }よろしいですか？`;
    if (!confirm(msg)) return;
    update((d) => cancelTentativeData(d, c.id, today));
    setForm(null);
    toast(`仮押さえを取り消しました（訪問 ${n}件）`);
  };

  const saved = form ? data.clients.find((x) => x.id === form.id) : undefined;

  return (
    <div className="stack">
      <PageHeader
        icon={House}
        title={terms.client}
        lead={`${terms.client}の住所・特性・条件を決めます`}
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setError(null);
              setIsNew(true);
              setForm(blank(clients.length));
            }}
          >
            <WithIcon icon={Plus}>{terms.client}を追加</WithIcon>
          </button>
        }
      />

      <div
        className="card row"
        style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}
        data-testid="clients-filter"
      >
        <ClientPicker
          clients={clients}
          selected={picked}
          onChange={setPicked}
          multiple
          label={`${terms.client}を絞り込む`}
          byStaff={{
            staffLabel: terms.staff,
            staff: staff.filter((s) => s.active),
            clientIdsOf: (id) => usualOf.get(id) ?? new Set(),
          }}
          onQueryChange={setQuery}
          testId="clients-picker"
        />
        <span className="sub" data-testid="clients-count">
          {shown.length === clients.length ? `${clients.length}人` : `${shown.length}人／${clients.length}人`}
        </span>
      </div>

      <div className="card table-scroll">
        <table className="people-table">
          <thead>
            <tr>
              <th>名前</th>
              <th>位置</th>
              <th>特性</th>
              <th>{terms.staff}に求めること</th>
              <th>いつもの担当</th>
              <th>状態</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="sub">
                  当てはまる{terms.client}がいません
                </td>
              </tr>
            )}
            {shown.map((c) => (
              <tr key={c.id} data-testid="client-row">
                <td>
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
                      {c.place.address && <small className="person-sub">{c.place.address}</small>}
                    </span>
                  </span>
                </td>
                <td>
                  {hasLocation(c.place) ? (
                    <span className="chip chip-ok" title="位置あり">
                      <MapPin size={13} strokeWidth={2.2} aria-hidden="true" />
                      <span className="sr-only">あり</span>
                    </span>
                  ) : (
                    <span className="chip chip-warn">未登録</span>
                  )}
                </td>
                <td>
                  <TraitChips traits={c.traits} items={clientItems} />
                </td>
                <td className="cond-cell">
                  <CondChips requirements={c.requirements} preferences={c.preferences} itemById={itemById} />
                </td>
                <td className="nowrap">
                  {c.usualStaffId && (
                    <WithIcon icon={Repeat} size={14}>
                      {staffName(c.usualStaffId)}
                    </WithIcon>
                  )}
                </td>
                <td>
                  {c.tentative && <span className="chip chip-warn">仮押さえ</span>}
                  {!c.active && <span className="chip">休止中</span>}
                </td>
                <td>
                  <IconButton
                    icon={Pencil}
                    label={`${c.displayName}を編集`}
                    onClick={() => {
                      setError(null);
                      setIsNew(false);
                      setForm(structuredClone(c));
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <SidePanel
          icon={isNew ? Plus : Pencil}
          title={
            isNew ? `${terms.client}を追加` : `${terms.client}を編集：${form.displayName.trim() || '（名前なし）'}`
          }
          onClose={() => setForm(null)}
          footer={
            <>
              <button type="button" className="btn btn-primary" onClick={save}>
                <WithIcon icon={Save}>保存</WithIcon>
              </button>
              <button type="button" className="btn" onClick={() => setForm(null)}>
                <WithIcon icon={X}>閉じる</WithIcon>
              </button>
              {error && <span className="error">{error}</span>}
            </>
          }
        >
          {saved?.tentative && !isNew && (
            <div className="tentative-box stack" data-testid="tentative-box">
              <span className="row" style={{ gap: 6 }}>
                <TentativeMark />
                <strong>仮押さえの{terms.client}です</strong>
              </span>
              <span className="sub">
                問い合わせの試算から仮に押さえています。決まったら本登録に、断られたら取り消してください。
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
              表示名
              <input
                value={form.displayName}
                maxLength={50}
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
            <span style={{ marginLeft: 16 }} />
            <Check checked={form.active} onChange={(c) => setForm({ ...form, active: c })}>
              利用中（外すと休止）
            </Check>
          </div>

          {isNew || !data.clients.some((x) => x.id === form.id) ? (
            <Hint label="定期パターン">定期パターン（決まった曜日・時刻の訪問）は、保存してから足せます。</Hint>
          ) : (
            <PatternsSection client={form} />
          )}

          <SectionTitle icon={BadgeCheck}>特性</SectionTitle>
          <TraitsEditor items={clientItems} value={form.traits} onChange={(traits) => setForm({ ...form, traits })} />

          <SectionTitle icon={SlidersHorizontal}>{terms.staff}に求めること：必要条件</SectionTitle>
          <Hint>
            例：性別が女性、資格に看護師を含む。「条件」の画面の「{terms.client}の必要条件」で、必須か重みかを決めます。
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
          <Hint label="相性について">相性（◎○△×）は「相性」の画面で入れます。×の{terms.staff}は担当になりません。</Hint>

          <SectionTitle icon={House}>住所</SectionTitle>
          <PlaceEditor value={form.place} onChange={(place) => setForm({ ...form, place })} />
        </SidePanel>
      )}
    </div>
  );
}
