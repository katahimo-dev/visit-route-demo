import { useState } from 'react';
import { type Client, type Visit, visitSchema } from '../contracts/documents';
import { formError, newId } from '../lib/common';
import { useDemoData } from '../store';

/** 訪問を足す・直す（PoC本体 schedule/VisitForm.tsx を写し、保存先を DemoData にした） */

type WindowKind = Visit['windowKind'];

type Form = {
  clientId: string;
  windowKind: WindowKind;
  earliestStart: string;
  latestStart: string;
  durationMinutes: string;
  note: string;
};

const formOf = (v: Visit | null, clients: Client[]): Form =>
  v
    ? {
        clientId: v.clientId,
        windowKind: v.windowKind,
        earliestStart: v.earliestStart,
        latestStart: v.latestStart,
        durationMinutes: String(v.durationMinutes),
        note: v.note,
      }
    : {
        clientId: clients.find((c) => c.active)?.id ?? '',
        windowKind: 'fixed',
        earliestStart: '09:00',
        latestStart: '09:00',
        durationMinutes: '60',
        note: '',
      };

export function VisitForm({
  date,
  visit,
  clients,
  onClose,
  onSaved,
}: {
  date: string;
  /** 直すときの訪問。null なら足す */
  visit: Visit | null;
  clients: Client[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const { data, update } = useDemoData();
  const terms = data.org.terms;
  const [form, setForm] = useState(() => formOf(visit, clients));
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setError(null);
    try {
      const v = visitSchema.parse({
        id: visit?.id ?? newId('v'),
        date,
        clientId: form.clientId,
        windowKind: form.windowKind,
        earliestStart: form.earliestStart,
        latestStart: form.windowKind === 'fixed' ? form.earliestStart : form.latestStart,
        durationMinutes: Number(form.durationMinutes),
        staffId: visit?.staffId ?? null,
        cancelled: false,
        note: form.note,
      });
      if (v.latestStart < v.earliestStart) {
        setError('「最も遅い開始時刻」は「最も早い開始時刻」より後にしてください');
        return;
      }
      update((d) => ({
        ...d,
        visits: visit ? d.visits.map((x) => (x.id === v.id ? v : x)) : [...d.visits, v],
      }));
      onSaved('訪問を保存しました');
      onClose();
    } catch (e) {
      setError(formError(e));
    }
  };

  return (
    <div className="card stack">
      <h3>{visit ? '訪問を編集' : '訪問を追加'}</h3>
      <div className="form-grid">
        <label>
          {terms.client}
          <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
            <option value="">選択してください</option>
            {clients
              .filter((c) => c.active || c.id === form.clientId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
          </select>
        </label>
        <label>
          時間の約束
          <select
            value={form.windowKind}
            onChange={(e) => setForm({ ...form, windowKind: e.target.value as WindowKind })}
          >
            <option value="fixed">開始時刻が決まっている</option>
            <option value="window">開始に幅がある</option>
          </select>
        </label>
        <label>
          {form.windowKind === 'fixed' ? '開始時刻' : '最も早い開始時刻'}
          <input
            type="time"
            value={form.earliestStart}
            onChange={(e) => setForm({ ...form, earliestStart: e.target.value })}
          />
        </label>
        {form.windowKind === 'window' && (
          <label>
            最も遅い開始時刻
            <input
              type="time"
              value={form.latestStart}
              onChange={(e) => setForm({ ...form, latestStart: e.target.value })}
            />
          </label>
        )}
        <label>
          所要時間（分）
          <input
            type="number"
            min={5}
            max={720}
            value={form.durationMinutes}
            onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
          />
        </label>
        <label>
          メモ
          <input value={form.note} maxLength={200} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={save}>
          保存
        </button>
        <button type="button" className="btn" onClick={onClose}>
          キャンセル
        </button>
      </div>
    </div>
  );
}
