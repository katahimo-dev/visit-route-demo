import {
  BadgeCheck,
  CalendarX,
  Clock,
  Home,
  MapPin,
  Pencil,
  Plus,
  Save,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  UserRound,
  UserRoundCog,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CondChips, ConditionsEditor, TraitChips, TraitsEditor } from '../components/conditions';
import { Check, PlaceEditor } from '../components/parts';
import { useToast } from '../components/Toast';
import { Hint, IconButton, PageHeader, SectionTitle, SidePanel, WithIcon } from '../components/ui';
import { TRAVEL_MODES, type TravelMode } from '../contracts/codes';
import { type Staff, staffSchema } from '../contracts/documents';
import { addDays, jstDate } from '../domain/time';
import { byName, formError, hasLocation, nameTaken, newId, TRAVEL_MODE_LABELS, WEEKDAY_LABELS } from '../lib/common';
import { offboardScope } from '../lib/offboard';
import { mdText } from '../lib/patternText';
import { useDemoData } from '../store';
import { leavingStaff, OffboardPanel } from './OffboardPanel';
import './settings.css';

/** スタッフの一覧と編集（PoC本体 StaffPage.tsx を写し、招待・メールを外して特性と条件を足した） */

const blank = (): Staff => ({
  id: newId('s'),
  name: '',
  home: { address: '', lat: null, lng: null },
  travelMode: 'DRIVE',
  workDays: [1, 2, 3, 4, 5],
  shiftStart: '09:00',
  shiftEnd: '18:00',
  active: true,
  traits: {},
  requirements: [],
  preferences: [],
  lastDay: null,
});

export default function StaffPage() {
  const { data, update } = useDemoData();
  const terms = data.org.terms;
  const toast = useToast();
  const [form, setForm] = useState<Staff | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 担当の振り直しの欄を開いている〈スタッフ〉（PRD D71。null：閉じている） */
  const [offboardFor, setOffboardFor] = useState<string | null>(null);
  const today = jstDate(Date.now());
  const staff = useMemo(() => [...data.staff].sort(byName), [data.staff]);
  /** 最終勤務日のある人と、振り直しが残っているもの（〈利用者さん〉の人数・訪問の件数） */
  const leaving = useMemo(
    () =>
      leavingStaff(data.staff).map((s) => {
        const sc = offboardScope(data, s.id, today, false);
        return { staff: s, clients: sc?.clients.length ?? 0, visits: sc?.visits.length ?? 0 };
      }),
    [data, today],
  );
  const staffItems = data.items.filter((i) => i.target === 'staff');
  const itemById = new Map(data.items.map((i) => [i.id, i]));

  const save = () => {
    if (!form) return;
    setError(null);
    // 同じ名前は保存しない（Excel では名前で人を引くため。ADR-0006）
    if (nameTaken(data.staff, (x) => x.name, form.name, form.id)) {
      setError(`「${form.name.trim()}」と同じ名前の${terms.staff}がいます。名前を変えてください`);
      return;
    }
    try {
      const s = staffSchema.parse(form);
      // 休止にするとき、〈利用者さん〉の「担当できる人」から外す（ADR-0014。repair と同じ扱いを保存の時点で）
      const limited = s.active ? [] : data.clients.filter((c) => c.allowedStaffIds.includes(s.id));
      if (limited.length > 0) {
        // ほかに利用中の人が残らない〈利用者さん〉（休止中の人は数えない）
        const activeOther = new Set(data.staff.filter((x) => x.active && x.id !== s.id).map((x) => x.id));
        const emptied = limited.filter((c) => !c.allowedStaffIds.some((id) => activeOther.has(id)));
        const msg = `${s.name}さんを休止にすると、${limited.map((c) => c.displayName).join('・')}の「担当できる人」から外します。${
          emptied.length > 0
            ? `${emptied.map((c) => c.displayName).join('・')}は担当できる人がいなくなり、だれでも担当できるようになります（必要なら${terms.client}の画面で選び直してください）。`
            : ''
        }あとで利用中に戻しても、担当できる人には戻りません。よろしいですか？`;
        if (!confirm(msg)) return;
      }
      // 最終勤務日を入れた・変えたら、保存のあとに担当の振り直しの欄を開く（振り直すものがあるときだけ。ADR-0015）
      const before = data.staff.find((x) => x.id === s.id);
      const lastDayChanged = s.active && s.lastDay !== null && before?.lastDay !== s.lastDay;
      const nextData = {
        ...data,
        staff: data.staff.some((x) => x.id === s.id)
          ? data.staff.map((x) => (x.id === s.id ? s : x))
          : [...data.staff, s],
      };
      const sc = lastDayChanged ? offboardScope(nextData, s.id, today, false) : null;
      update((d) => ({
        ...d,
        staff: d.staff.some((x) => x.id === s.id) ? d.staff.map((x) => (x.id === s.id ? s : x)) : [...d.staff, s],
        clients: s.active
          ? d.clients
          : d.clients.map((c) =>
              c.allowedStaffIds.includes(s.id)
                ? { ...c, allowedStaffIds: c.allowedStaffIds.filter((id) => id !== s.id) }
                : c,
            ),
      }));
      setIsNew(false);
      if (sc && (sc.clients.length > 0 || sc.visits.length > 0)) {
        setForm(null);
        setOffboardFor(s.id);
        toast(`保存しました。${mdText(addDays(s.lastDay ?? '', 1))}からの担当を振り直してください`);
      } else toast('保存しました');
    } catch (e) {
      setError(formError(e));
    }
  };

  return (
    <div className="stack">
      <PageHeader
        icon={UserRound}
        title={terms.staff}
        lead={`${terms.staff}の勤務・特性・条件を決めます`}
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setError(null);
              setIsNew(true);
              setOffboardFor(null);
              setForm(blank());
            }}
          >
            <WithIcon icon={Plus}>{terms.staff}を追加</WithIcon>
          </button>
        }
      />

      {leaving.length > 0 && (
        <div className="card stack leaving-card" data-testid="leaving-card">
          <strong>
            <WithIcon icon={CalendarX} size={16}>
              最終勤務日のある{terms.staff}
            </WithIcon>
          </strong>
          <ul className="leaving-list">
            {leaving.map((x) => (
              <li key={x.staff.id}>
                <span>
                  {x.staff.name}さん：最終勤務日 {mdText(x.staff.lastDay ?? '')}
                </span>
                <span className="sub">
                  {x.clients > 0 || x.visits > 0
                    ? `振り直しが残っています（${terms.client} ${x.clients}人・担当の訪問 ${x.visits}件）`
                    : '振り直しは済んでいます'}
                </span>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => {
                    setForm(null);
                    setOffboardFor(x.staff.id);
                  }}
                  data-testid="leaving-open"
                >
                  <WithIcon icon={UserRoundCog} size={14}>
                    担当の振り直しを開く
                  </WithIcon>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card table-scroll">
        <table className="people-table">
          <thead>
            <tr>
              <th>名前</th>
              <th>勤務</th>
              <th>特性</th>
              <th>{terms.client}に求めること</th>
              <th>自宅の位置</th>
              <th>状態</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <td className="person-name">
                  <WithIcon icon={UserRound} size={15}>
                    {s.name}
                  </WithIcon>
                </td>
                <td className="nowrap">
                  <WithIcon icon={Clock} size={14}>
                    {s.workDays.map((d) => WEEKDAY_LABELS[d]).join('')} {s.shiftStart}〜{s.shiftEnd}
                  </WithIcon>
                </td>
                <td>
                  <TraitChips traits={s.traits} items={staffItems} />
                </td>
                <td className="cond-cell">
                  <CondChips requirements={s.requirements} preferences={s.preferences} itemById={itemById} />
                </td>
                <td>
                  {hasLocation(s.home) ? (
                    <span className="chip chip-ok">
                      <WithIcon icon={MapPin} size={13}>
                        あり
                      </WithIcon>
                    </span>
                  ) : (
                    <span className="chip chip-warn">未登録</span>
                  )}
                </td>
                <td>
                  {!s.active && <span className="chip">休止中</span>}
                  {s.lastDay && (
                    <span
                      className="chip chip-lastday"
                      title={`最終勤務日 ${s.lastDay}（翌日から勤務なし）`}
                      data-testid="staff-lastday"
                    >
                      最終 {mdText(s.lastDay)}
                    </span>
                  )}
                </td>
                <td className="nowrap">
                  <div className="actions">
                    <IconButton
                      icon={Pencil}
                      label={`${s.name}を編集`}
                      onClick={() => {
                        setError(null);
                        setIsNew(false);
                        setOffboardFor(null);
                        setForm(structuredClone(s));
                      }}
                    />
                    <Link
                      className="icon-btn tone-plain"
                      to={`/staff-view/${s.id}`}
                      title={`${s.name}さんの画面で見る`}
                      aria-label={`${s.name}さんの画面で見る`}
                    >
                      <Smartphone size={16} strokeWidth={2.2} aria-hidden="true" />
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <SidePanel
          icon={isNew ? Plus : Pencil}
          title={isNew ? `${terms.staff}を追加` : `${terms.staff}を編集：${form.name.trim() || '（名前なし）'}`}
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
          <div className="form-grid">
            <label>
              名前
              <input value={form.name} maxLength={50} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label>
              移動手段
              <select
                value={form.travelMode}
                onChange={(e) => setForm({ ...form, travelMode: e.target.value as TravelMode })}
              >
                {TRAVEL_MODES.map((t) => (
                  <option key={t} value={t}>
                    {TRAVEL_MODE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              勤務開始
              <input
                type="time"
                step={1800}
                value={form.shiftStart}
                onChange={(e) => setForm({ ...form, shiftStart: e.target.value })}
              />
            </label>
            <label>
              勤務終了
              <input
                type="time"
                step={1800}
                value={form.shiftEnd}
                onChange={(e) => setForm({ ...form, shiftEnd: e.target.value })}
              />
            </label>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span className="sub">勤務する曜日</span>
            {WEEKDAY_LABELS.map((w, d) => (
              <Check
                key={w}
                checked={form.workDays.includes(d)}
                onChange={(c) =>
                  setForm({
                    ...form,
                    workDays: c ? [...form.workDays, d].sort() : form.workDays.filter((x) => x !== d),
                  })
                }
              >
                {w}
              </Check>
            ))}
            <span style={{ marginLeft: 16 }} />
            <Check checked={form.active} onChange={(c) => setForm({ ...form, active: c })}>
              利用中（外すと休止）
            </Check>
          </div>

          <SectionTitle icon={CalendarX}>最終勤務日（退職・担当替え）</SectionTitle>
          <Hint>
            退職や担当替えで、この日を最後に勤務しなくなるときに入れます。翌日からは勤務なしになり、予定・AI案に入りません。保存すると、その人が担当している
            {terms.client}の代わりの{terms.staff}をまとめて選ぶ欄が開きます（訪問の案は自動では作り直しません）。
          </Hint>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label className="row" style={{ gap: 6 }}>
              最終勤務日
              <input
                type="date"
                value={form.lastDay ?? ''}
                onChange={(e) => setForm({ ...form, lastDay: e.target.value || null })}
                data-testid="staff-lastday-input"
                style={{ width: 'auto' }}
              />
            </label>
            {form.lastDay && (
              <button type="button" className="btn btn-small" onClick={() => setForm({ ...form, lastDay: null })}>
                最終勤務日を消す
              </button>
            )}
            {form.lastDay && <span className="sub">{mdText(addDays(form.lastDay, 1))}から勤務なし</span>}
          </div>

          <SectionTitle icon={BadgeCheck}>特性</SectionTitle>
          <TraitsEditor items={staffItems} value={form.traits} onChange={(traits) => setForm({ ...form, traits })} />

          <SectionTitle icon={SlidersHorizontal}>{terms.client}に求めること：必要条件</SectionTitle>
          <Hint>
            {terms.client}の特性に対する条件です（例：ペットのいる家を避けるなら「ペットあり」を「なし」に）。満たさない
            {terms.client}は「条件」の画面の「
            {terms.staff}の必要条件」で、点が付くか、必須なら担当にしません。
          </Hint>
          <ConditionsEditor
            items={data.items}
            target="client"
            value={form.requirements}
            onChange={(requirements) => setForm({ ...form, requirements })}
          />
          <SectionTitle icon={Sparkles}>{terms.client}に求めること：希望</SectionTitle>
          <ConditionsEditor
            items={data.items}
            target="client"
            value={form.preferences}
            onChange={(preferences) => setForm({ ...form, preferences })}
          />

          <SectionTitle icon={Home}>自宅</SectionTitle>
          <PlaceEditor value={form.home} onChange={(home) => setForm({ ...form, home })} />
        </SidePanel>
      )}
      {offboardFor && !form && <OffboardPanel staffId={offboardFor} onClose={() => setOffboardFor(null)} />}
    </div>
  );
}
