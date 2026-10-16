import { Check, Pencil, Plus, Repeat, X } from 'lucide-react';
import { useState } from 'react';
import { SectionTitle, WithIcon } from '../components/ui';
import { TypeDot } from '../components/visitType';
import { type Client, type Visit, visitSchema } from '../contracts/documents';
import { formError, newId } from '../lib/common';
import { mdText, patternWhenText, typeOf } from '../lib/patternText';
import { useDemoData } from '../store';
import './schedule.css';

/** 訪問を足す・直す（PoC本体 schedule/VisitForm.tsx を写し、保存先を DemoData にした） */

type WindowKind = Visit['windowKind'];

type Form = {
  /** 日付（ADR-0012：パターンの訪問も単発の訪問も変えられる） */
  date: string;
  clientId: string;
  /** 種類（'' は種類なし。ADR-0012） */
  typeId: string;
  windowKind: WindowKind;
  earliestStart: string;
  latestStart: string;
  durationMinutes: string;
  note: string;
};

const formOf = (v: Visit | null, clients: Client[], date: string): Form =>
  v
    ? {
        date: v.date,
        clientId: v.clientId,
        typeId: v.typeId ?? '',
        windowKind: v.windowKind,
        earliestStart: v.earliestStart,
        latestStart: v.latestStart,
        durationMinutes: String(v.durationMinutes),
        note: v.note,
      }
    : {
        date,
        clientId: clients.find((c) => c.active)?.id ?? '',
        typeId: '',
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
  const [form, setForm] = useState(() => formOf(visit, clients, date));
  const [error, setError] = useState<string | null>(null);
  /** 定期パターンから展開した訪問なら、そのパターン（ADR-0012） */
  const pattern = visit?.pattern ? (data.patterns.find((p) => p.id === visit.pattern?.id) ?? null) : null;

  const save = () => {
    setError(null);
    try {
      const typeId = form.typeId && data.visitTypes.some((t) => t.id === form.typeId) ? form.typeId : null;
      const base = {
        id: visit?.id ?? newId('v'),
        date: form.date,
        clientId: form.clientId,
        windowKind: form.windowKind,
        earliestStart: form.earliestStart,
        latestStart: form.windowKind === 'fixed' ? form.earliestStart : form.latestStart,
        durationMinutes: Number(form.durationMinutes),
        staffId: visit?.staffId ?? null,
        cancelled: false,
        note: form.note,
        typeId,
      };
      // パターンの訪問で、日付・時刻・所要・種類・取り消しを変えたら「この回だけの変更」（ADR-0012。メモ・〈利用者さん〉は数えない）
      const ref = visit?.pattern ?? null;
      const changed =
        !!visit &&
        (base.date !== visit.date ||
          base.windowKind !== visit.windowKind ||
          base.earliestStart !== visit.earliestStart ||
          base.latestStart !== visit.latestStart ||
          base.durationMinutes !== visit.durationMinutes ||
          base.typeId !== (visit.typeId ?? null) ||
          base.cancelled !== visit.cancelled);
      const v = visitSchema.parse({
        ...base,
        pattern: ref ? { ...ref, edited: ref.edited || changed } : null,
      });
      if (v.latestStart < v.earliestStart) {
        setError('「最も遅い開始時刻」は「最も早い開始時刻」より後にしてください');
        return;
      }
      update((d) => ({
        ...d,
        visits: visit ? d.visits.map((x) => (x.id === v.id ? v : x)) : [...d.visits, v],
      }));
      onSaved(
        v.pattern?.edited && !visit?.pattern?.edited
          ? '訪問を保存しました（この回だけの変更）'
          : v.date !== date
            ? `訪問を保存しました（${mdText(v.date)} に移しました）`
            : '訪問を保存しました',
      );
      onClose();
    } catch (e) {
      setError(formError(e));
    }
  };

  return (
    <div className="card stack">
      <SectionTitle icon={visit ? Pencil : Plus}>{visit ? '訪問を編集' : '訪問を追加'}</SectionTitle>
      {visit?.pattern && (
        <p className="sub row" style={{ gap: 6, flexWrap: 'wrap' }} data-testid="visit-pattern-ref">
          <WithIcon icon={Repeat} size={14}>
            {pattern ? `定期パターン（${patternWhenText(pattern)}）` : '定期パターン'}の{mdText(visit.pattern.date)}の回
          </WithIcon>
          {visit.pattern.edited ? (
            <span className="chip chip-warn">この回だけの変更</span>
          ) : (
            <span className="sub">
              （日付・時刻・所要・種類を変えると「この回だけの変更」になり、パターンを直しても変わりません）
            </span>
          )}
        </p>
      )}
      <div className="form-grid">
        <label>
          日付
          <input
            type="date"
            value={form.date}
            required
            onChange={(e) => setForm({ ...form, date: e.target.value || form.date })}
          />
        </label>
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
          <span className="row" style={{ gap: 6 }}>
            種類
            {typeOf(data.visitTypes, form.typeId) && <TypeDot type={typeOf(data.visitTypes, form.typeId)!} />}
          </span>
          <select
            value={form.typeId}
            onChange={(e) => {
              const t = typeOf(data.visitTypes, e.target.value);
              // 新しい訪問は、種類を選ぶと所要の初期値をその種類の標準の所要にする
              setForm({
                ...form,
                typeId: e.target.value,
                ...(!visit && t ? { durationMinutes: String(t.durationMinutes) } : {}),
              });
            }}
          >
            <option value="">種類なし</option>
            {data.visitTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            {form.typeId && !typeOf(data.visitTypes, form.typeId) && (
              <option value={form.typeId}>（消えた種類）</option>
            )}
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
          <WithIcon icon={Check}>保存</WithIcon>
        </button>
        <button type="button" className="btn" onClick={onClose}>
          <WithIcon icon={X}>キャンセル</WithIcon>
        </button>
      </div>
    </div>
  );
}
