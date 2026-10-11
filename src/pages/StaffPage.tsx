import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConditionsEditor, condText, TraitChips, TraitsEditor } from '../components/conditions';
import { Check, PlaceEditor } from '../components/parts';
import { useToast } from '../components/Toast';
import { TRAVEL_MODES, type TravelMode } from '../contracts/codes';
import { type Staff, staffSchema } from '../contracts/documents';
import { byName, formError, hasLocation, newId, TRAVEL_MODE_LABELS, WEEKDAY_LABELS } from '../lib/common';
import { useDemoData } from '../store';

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
      <div className="spread">
        <h2>{terms.staff}</h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setError(null);
            setIsNew(true);
            setForm(blank());
          }}
        >
          {terms.staff}を追加
        </button>
      </div>

      <div className="card table-scroll">
        <table>
          <thead>
            <tr>
              <th>名前</th>
              <th>勤務</th>
              <th>特性</th>
              <th>条件</th>
              <th>自宅の位置</th>
              <th>状態</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className="nowrap">
                  {s.workDays.map((d) => WEEKDAY_LABELS[d]).join('')} {s.shiftStart}〜{s.shiftEnd}
                </td>
                <td>
                  <TraitChips traits={s.traits} items={staffItems} />
                </td>
                <td className="sub">
                  {[...s.requirements, ...s.preferences].map((c) => condText(c, itemById.get(c.itemId))).join('、') ||
                    'なし'}
                </td>
                <td>{hasLocation(s.home) ? 'あり' : <span className="chip chip-warn">未登録</span>}</td>
                <td>{!s.active && <span className="chip">休止中</span>}</td>
                <td className="nowrap">
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => {
                      setError(null);
                      setIsNew(false);
                      setForm(structuredClone(s));
                    }}
                  >
                    編集
                  </button>{' '}
                  <Link className="btn btn-small" to={`/staff-view/${s.id}`}>
                    {s.name}さんの画面で見る
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="card stack">
          <h3>{isNew ? `${terms.staff}を追加` : `${terms.staff}を編集`}</h3>
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

          <h3>特性</h3>
          <TraitsEditor items={staffItems} value={form.traits} onChange={(traits) => setForm({ ...form, traits })} />

          <h3>この{terms.staff}の必要条件</h3>
          <p className="sub">
            {terms.client}の特性に対する条件です（例：ペットがいない）。満たさない{terms.client}は「{terms.staff}
            の必要条件」の条件で点が付くか、必須なら担当にしません。
          </p>
          <ConditionsEditor
            items={data.items}
            target="client"
            value={form.requirements}
            onChange={(requirements) => setForm({ ...form, requirements })}
          />
          <h3>この{terms.staff}の希望</h3>
          <ConditionsEditor
            items={data.items}
            target="client"
            value={form.preferences}
            onChange={(preferences) => setForm({ ...form, preferences })}
          />

          <h3>自宅</h3>
          <PlaceEditor value={form.home} onChange={(home) => setForm({ ...form, home })} />
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={save}>
              保存
            </button>
            <button type="button" className="btn" onClick={() => setForm(null)}>
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
