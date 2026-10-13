import {
  BadgeCheck,
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
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CondChips, ConditionsEditor, TraitChips, TraitsEditor } from '../components/conditions';
import { Check, PlaceEditor } from '../components/parts';
import { useToast } from '../components/Toast';
import { Hint, IconButton, PageHeader, SectionTitle, WithIcon } from '../components/ui';
import { TRAVEL_MODES, type TravelMode } from '../contracts/codes';
import { type Staff, staffSchema } from '../contracts/documents';
import { byName, formError, hasLocation, nameTaken, newId, TRAVEL_MODE_LABELS, WEEKDAY_LABELS } from '../lib/common';
import { useDemoData } from '../store';
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
});

export default function StaffPage() {
  const { data, update } = useDemoData();
  const terms = data.org.terms;
  const toast = useToast();
  const [form, setForm] = useState<Staff | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const staff = useMemo(() => [...data.staff].sort(byName), [data.staff]);
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
      update((d) => ({
        ...d,
        staff: d.staff.some((x) => x.id === s.id) ? d.staff.map((x) => (x.id === s.id ? s : x)) : [...d.staff, s],
      }));
      setIsNew(false);
      toast('保存しました');
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
              setForm(blank());
            }}
          >
            <WithIcon icon={Plus}>{terms.staff}を追加</WithIcon>
          </button>
        }
      />

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
                <td>{!s.active && <span className="chip">休止中</span>}</td>
                <td className="nowrap">
                  <div className="actions">
                    <IconButton
                      icon={Pencil}
                      label={`${s.name}を編集`}
                      onClick={() => {
                        setError(null);
                        setIsNew(false);
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
        <div className="card stack">
          <SectionTitle icon={isNew ? Plus : Pencil}>
            {isNew ? `${terms.staff}を追加` : `${terms.staff}を編集`}
          </SectionTitle>
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
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={save}>
              <WithIcon icon={Save}>保存</WithIcon>
            </button>
            <button type="button" className="btn" onClick={() => setForm(null)}>
              <WithIcon icon={X}>閉じる</WithIcon>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
