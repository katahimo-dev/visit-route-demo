import { Layers, Pencil, Plus, Save, ShieldCheck, Timer, Trash2, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useConfirm } from '../components/ConfirmDialog';
import { CondChips, ConditionsEditor } from '../components/conditions';
import { FieldError, type FormErr, invalidAttrs, RequiredMark } from '../components/FieldError';
import { useToast } from '../components/Toast';
import { Empty, Hint, IconButton, PageHeader, SectionTitle, SidePanel, WithIcon } from '../components/ui';
import { TypeDot } from '../components/visitType';
import { MAX_VISIT_TYPES, type VisitType, visitTypeSchema } from '../contracts/documents';
import { CLIENT_COLORS } from '../lib/colors';
import { formError, nameTaken, newId } from '../lib/common';
import { useDemoData } from '../store';
import './settings.css';

/**
 * 訪問の種類（ADR-0012。PRD D36）：一覧・足す・直す・消す。
 * 担当に必要な条件は〈スタッフ〉の項目ごとの1行のチェック表（components/conditions.tsx をそのまま使う）。常に必須
 */

const blank = (color: number): VisitType => ({
  id: newId('t'),
  name: '',
  color: color % CLIENT_COLORS.length,
  durationMinutes: 60,
  requirements: [],
  note: '',
});

/** 入力中の形（所要は文字のまま持つ） */
type Form = Omit<VisitType, 'durationMinutes'> & { durationMinutes: string };

export default function TypesPage() {
  const { data, update } = useDemoData();
  const terms = data.org.terms;
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [form, setForm] = useState<Form | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState<FormErr>(null);
  const errorId = useId();
  /** 誤った欄の印（PRD D250） */
  const bad = (field: string) => invalidAttrs(error?.field === field, errorId);
  const itemById = useMemo(() => new Map(data.items.map((i) => [i.id, i])), [data.items]);
  /** 種類ごとの、使っている訪問・パターンの数 */
  const uses = useMemo(() => {
    const m = new Map<string, { visits: number; patterns: number }>();
    const at = (id: string) => {
      let x = m.get(id);
      if (!x) {
        x = { visits: 0, patterns: 0 };
        m.set(id, x);
      }
      return x;
    };
    for (const v of data.visits) if (v.typeId) at(v.typeId).visits++;
    for (const p of data.patterns) if (p.typeId) at(p.typeId).patterns++;
    return m;
  }, [data.visits, data.patterns]);
  const full = data.visitTypes.length >= MAX_VISIT_TYPES;

  const open = (t: VisitType | null) => {
    setError(null);
    setIsNew(!t);
    const x = t ?? blank(data.visitTypes.length);
    setForm({ ...structuredClone(x), durationMinutes: String(x.durationMinutes) });
  };

  const save = () => {
    if (!form) return;
    setError(null);
    // 同じ名前は保存しない（Excel では種類を名前で引くため。ADR-0006）
    if (nameTaken(data.visitTypes, (x) => x.name, form.name, form.id)) {
      setError({ text: `「${form.name.trim()}」と同じ名前の種類があります。名前を変えてください`, field: 'name' });
      return;
    }
    if (isNew && full) {
      setError({ text: `種類は${MAX_VISIT_TYPES}までです` });
      return;
    }
    const r = visitTypeSchema.safeParse({
      ...form,
      name: form.name.trim(),
      durationMinutes: Number(form.durationMinutes),
    });
    if (!r.success) {
      const issue = r.error.issues[0];
      const where = issue?.path[0];
      setError({
        text:
          where === 'name'
            ? '名前は1〜20字で入れてください'
            : where === 'durationMinutes'
              ? '標準の所要は5〜720分で入れてください'
              : formError(r.error),
        field: typeof where === 'string' ? where : undefined,
      });
      return;
    }
    const t = r.data;
    update((d) => ({
      ...d,
      visitTypes: d.visitTypes.some((x) => x.id === t.id)
        ? d.visitTypes.map((x) => (x.id === t.id ? t : x))
        : [...d.visitTypes, t],
    }));
    setIsNew(false);
    setForm(null);
    toast('保存しました');
  };

  const remove = async (t: VisitType) => {
    const u = uses.get(t.id) ?? { visits: 0, patterns: 0 };
    const ok = await confirmDialog({
      title: `種類「${t.name}」を消しますか？`,
      body: `${t.name}を使っている訪問 ${u.visits}件・定期パターン ${u.patterns}件は種類なしになります。`,
      confirmLabel: '消す',
      tone: 'danger',
    });
    if (!ok) return;
    update((d) => ({
      ...d,
      visitTypes: d.visitTypes.filter((x) => x.id !== t.id),
      visits: d.visits.map((v) => (v.typeId === t.id ? { ...v, typeId: null } : v)),
      patterns: d.patterns.map((p) => (p.typeId === t.id ? { ...p, typeId: null } : p)),
    }));
    setForm(null);
    toast(`種類「${t.name}」を消しました`);
  };

  return (
    <div className="stack">
      <PageHeader
        icon={Layers}
        title="訪問の種類"
        lead={`訪問の種類（介護・リハビリなど）と、担当する${terms.staff}に必要な条件を決めます`}
        actions={
          <button
            type="button"
            className="btn btn-primary"
            disabled={full}
            title={full ? `種類は${MAX_VISIT_TYPES}までです` : ''}
            onClick={() => open(null)}
          >
            <WithIcon icon={Plus}>種類を追加</WithIcon>
          </button>
        }
      />
      <Hint label="種類について">
        種類の「担当に必要な条件」は、条件の重み・必須にかかわらず、いつも必須です。満たさない{terms.staff}
        はその訪問の担当になりません（理由に「種類（名前）：…
        ✗」と出ます）。標準の所要は、新しい訪問・定期パターンの初期値に使います。
        {full && ` 種類は${MAX_VISIT_TYPES}までです。`}
      </Hint>

      <div className="card table-scroll">
        {data.visitTypes.length === 0 ? (
          <Empty icon={Layers}>種類はまだありません。「種類を追加」で足します</Empty>
        ) : (
          <table className="people-table" data-testid="types-table">
            <thead>
              <tr>
                <th>名前</th>
                <th className="num">標準の所要</th>
                <th>担当に必要な条件</th>
                <th className="num">使っている</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {data.visitTypes.map((t) => {
                const u = uses.get(t.id) ?? { visits: 0, patterns: 0 };
                return (
                  <tr key={t.id}>
                    <td>
                      <span className="row person-name">
                        <TypeDot type={t} size={14} />
                        <span className="person-main">
                          {t.name}
                          {t.note && <small className="person-sub">{t.note}</small>}
                        </span>
                      </span>
                    </td>
                    <td className="num nowrap">{t.durationMinutes}分</td>
                    <td className="cond-cell">
                      <CondChips requirements={t.requirements} preferences={[]} itemById={itemById} />
                    </td>
                    <td className="num nowrap">
                      訪問 {u.visits}件・パターン {u.patterns}件
                    </td>
                    <td>
                      <div className="actions">
                        <IconButton icon={Pencil} label={`${t.name}を編集`} onClick={() => open(t)} />
                        <IconButton icon={Trash2} label={`${t.name}を消す`} tone="danger" onClick={() => remove(t)} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {form && (
        <SidePanel
          icon={isNew ? Plus : Pencil}
          title={isNew ? '種類を追加' : `種類を編集：${form.name.trim() || '（名前なし）'}`}
          onClose={() => setForm(null)}
          onSubmit={save}
          footer={
            <>
              <button type="submit" className="btn btn-primary">
                <WithIcon icon={Save}>保存</WithIcon>
              </button>
              <button type="button" className="btn" onClick={() => setForm(null)}>
                <WithIcon icon={X}>閉じる</WithIcon>
              </button>
              <FieldError as="span" id={errorId}>
                {error?.text}
              </FieldError>
            </>
          }
        >
          <div className="form-grid">
            <label>
              <span>
                名前（20字まで）
                <RequiredMark />
              </span>
              <input
                value={form.name}
                maxLength={20}
                required
                {...bad('name')}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              <span>
                <WithIcon icon={Timer} size={14}>
                  標準の所要（分）
                </WithIcon>
                <RequiredMark />
              </span>
              <input
                type="number"
                min={5}
                max={720}
                value={form.durationMinutes}
                required
                {...bad('durationMinutes')}
                onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
              />
            </label>
            <label>
              メモ
              <input value={form.note} maxLength={200} onChange={(e) => setForm({ ...form, note: e.target.value })} />
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
          </div>
          <SectionTitle icon={ShieldCheck}>担当に必要な条件（いつも必須）</SectionTitle>
          <Hint>例：資格に理学療法士・作業療法士・言語聴覚士のどれか。何も選ばない項目は問いません。</Hint>
          <ConditionsEditor
            items={data.items}
            target="staff"
            value={form.requirements}
            onChange={(requirements) => setForm({ ...form, requirements })}
          />
          {!isNew && (
            <div className="row">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const t = data.visitTypes.find((x) => x.id === form.id);
                  if (t) remove(t);
                }}
              >
                <WithIcon icon={Trash2}>この種類を消す</WithIcon>
              </button>
            </div>
          )}
        </SidePanel>
      )}
    </div>
  );
}
