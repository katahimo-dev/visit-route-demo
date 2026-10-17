import { BedSingle, Check, Pencil, Plus, Trash2, TriangleAlert, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDay } from '../app/day';
import { useToast } from '../components/Toast';
import { Hint, IconButton, SectionTitle, WithIcon } from '../components/ui';
import { type Client, type ClientLeave, clientLeaveSchema } from '../contracts/documents';
import { jstDate } from '../domain/time';
import { dateText, newId } from '../lib/common';
import { leaveConfirmedDates, leavesOf, leaveVisits, removeLeave, saveLeave } from '../lib/leaves';
import { mdText } from '../lib/patternText';
import { useDemoData } from '../store';

/**
 * 〈利用者さん〉の休み（入院・ショートステイなど。PRD D65。ADR-0013）：一覧と 足す・直す・消す。
 * 〈利用者さん〉の欄と、月間で〈利用者さん〉を選んだときの右の欄に置く。
 * 休みの期間の訪問は消さず「休みのため無し」と扱う（計算から外れる）。休みと重なる確定した日があれば注意を出す
 * （確認ではなく注意。案は作り直さない）。消すと元に戻るだけなので確認しない
 */

type Form = { id: string | null; from: string; to: string; note: string };

export function ClientLeavesSection({
  client,
  onOpenDay,
  compact = false,
}: {
  client: Client;
  /** 確定した日へのリンクを押したとき（無ければ選んでいる日付を変えて予定の画面へ） */
  onOpenDay?: (date: string) => void;
  /** 月間の右の欄（説明を短く） */
  compact?: boolean;
}) {
  const { data, update } = useDemoData();
  const terms = data.org.terms;
  const toast = useToast();
  const navigate = useNavigate();
  const { setDate } = useDay();
  const today = jstDate(Date.now());
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const leaves = useMemo(() => leavesOf(data, client.id), [data, client.id]);
  const openDay =
    onOpenDay ??
    ((d: string) => {
      setDate(d);
      navigate('/plan');
    });

  /** 入力中の休みと重なる確定した日（形が正しいときだけ） */
  const draftConfirmed = useMemo(() => {
    if (!form || !/^\d{4}-\d{2}-\d{2}$/.test(form.from) || !/^\d{4}-\d{2}-\d{2}$/.test(form.to)) return [];
    if (form.from > form.to) return [];
    return leaveConfirmedDates(data, { clientId: client.id, from: form.from, to: form.to });
  }, [form, data, client.id]);

  const save = () => {
    if (!form) return;
    setError(null);
    const r = clientLeaveSchema.safeParse({
      id: form.id ?? newId('l'),
      clientId: client.id,
      from: form.from,
      to: form.to,
      note: form.note.trim(),
    });
    if (!r.success) {
      const where = r.error.issues[0]?.path[0];
      setError(
        where === 'to' && form.from > form.to ? '終了日は開始日以降にしてください' : '日付を正しく入れてください',
      );
      return;
    }
    const leave: ClientLeave = r.data;
    const n = leaveVisits(data, leave).length;
    update((d) => saveLeave(d, leave));
    setForm(null);
    toast(
      `休みを${form.id ? '直しました' : '入れました'}（${mdText(leave.from)}〜${mdText(leave.to)}・訪問 ${n}件は無しになります）`,
    );
  };

  const remove = (l: ClientLeave) => {
    update((d) => removeLeave(d, l.id));
    if (form?.id === l.id) setForm(null);
    toast(`休みを消しました（${mdText(l.from)}〜${mdText(l.to)}の訪問は元に戻ります）`);
  };

  return (
    <div className="stack" data-testid="leaves-section">
      <SectionTitle
        icon={BedSingle}
        aside={
          !form && (
            <button
              type="button"
              className="btn btn-small"
              data-testid="leave-add"
              onClick={() => {
                setError(null);
                setForm({ id: null, from: today, to: today, note: '' });
              }}
            >
              <WithIcon icon={Plus} size={14}>
                休みを入れる
              </WithIcon>
            </button>
          )
        }
      >
        {compact ? '休み' : '休み（入院・ショートステイなど）'}
      </SectionTitle>
      {!compact && (
        <Hint>
          休みの期間の訪問は消さずに「休みのため無し」とし、AI案・まとめて作る・空き状況から外します。休みを消すと元に戻ります。
        </Hint>
      )}
      {leaves.length === 0 ? (
        <span className="sub">休みはありません</span>
      ) : (
        <ul className="leave-list">
          {leaves.map((l) => {
            const n = leaveVisits(data, l).length;
            const fixed = leaveConfirmedDates(data, l);
            const past = l.to < today;
            return (
              <li key={l.id} className="leave-row" data-testid="leave-row">
                <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <strong>
                    {mdText(l.from)}〜{mdText(l.to)}
                    {past && <span className="sub">（終わった休み）</span>}
                  </strong>
                  <span className="sub">
                    {l.note || '理由なし'}・訪問 {n}件は無し
                    {fixed.length > 0 && `・確定した日 ${fixed.length}日`}
                  </span>
                </span>
                <span className="actions">
                  <IconButton
                    icon={Pencil}
                    label={`${mdText(l.from)}〜${mdText(l.to)}の休みを直す`}
                    onClick={() => {
                      setError(null);
                      setForm({ id: l.id, from: l.from, to: l.to, note: l.note });
                    }}
                  />
                  <IconButton
                    icon={Trash2}
                    tone="danger"
                    label={`${mdText(l.from)}〜${mdText(l.to)}の休みを消す`}
                    onClick={() => remove(l)}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {form && (
        <fieldset className="leave-form stack" data-testid="leave-form">
          <legend>{form.id ? '休みを直す' : '休みを入れる'}</legend>
          <div className="form-grid">
            <label>
              開始日
              <input
                type="date"
                value={form.from}
                data-testid="leave-from"
                onChange={(e) => {
                  const from = e.target.value;
                  // 終了日が開始日より前になったら、終了日を開始日に合わせる
                  setForm({ ...form, from, to: form.to && from > form.to ? from : form.to });
                }}
              />
            </label>
            <label>
              終了日
              <input
                type="date"
                value={form.to}
                min={form.from}
                data-testid="leave-to"
                onChange={(e) => setForm({ ...form, to: e.target.value })}
              />
            </label>
            <label>
              理由（任意）
              <input
                value={form.note}
                maxLength={100}
                placeholder="例：入院、ショートステイ"
                data-testid="leave-note"
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </label>
          </div>
          {draftConfirmed.length > 0 && (
            <div className="leave-warn" data-testid="leave-warn">
              <WithIcon icon={TriangleAlert} size={14}>
                確定した日（{draftConfirmed.map(mdText).join('・')}）に{client.displayName}の訪問があります。
                休みを入れても確定した割当は変わりません。その日の予定の画面で案を作り直してください。
              </WithIcon>
              <ul>
                {draftConfirmed.map((d) => (
                  <li key={d}>
                    <button type="button" className="link-button" onClick={() => openDay(d)}>
                      {dateText(d)}の予定を開く
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button type="button" className="btn btn-small" onClick={save} data-testid="leave-save">
              <WithIcon icon={Check} size={14}>
                {form.id ? '直す' : '入れる'}
              </WithIcon>
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                setForm(null);
                setError(null);
              }}
            >
              <WithIcon icon={X} size={14}>
                やめる
              </WithIcon>
            </button>
          </div>
          {!compact && (
            <span className="sub">
              {terms.client}の休みは、訪問を別の日に振り替えません。振り替えるときは、予定の画面で訪問を足してください。
            </span>
          )}
        </fieldset>
      )}
    </div>
  );
}
