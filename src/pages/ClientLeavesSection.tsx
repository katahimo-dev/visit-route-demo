import { BedSingle, Check, Pencil, Plus, Trash2, TriangleAlert, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDay } from '../app/day';
import { useConfirm } from '../components/ConfirmDialog';
import { enterToSave, FieldError } from '../components/FieldError';
import { useToast } from '../components/Toast';
import { Hint, SectionTitle, WithIcon } from '../components/ui';
import { type Client, type ClientLeave, clientLeaveSchema } from '../contracts/documents';
import { jstDate } from '../domain/time';
import { dateText, newId } from '../lib/common';
import { leaveConfirmedDates, leavesOf, leaveVisits, removeLeave, saveLeave } from '../lib/leaves';
import { mdText } from '../lib/patternText';
import { useDemoData } from '../store';

/**
 * 〈利用者さん〉の休み（入院・ショートステイなど。PRD D65・D308。ADR-0013・0052）：一覧と 入れる・直す・消す。
 * 〈利用者さん〉の画面の「休み」のタブに置く。どれも「直す（入れる）→ 保存」の形で、保存を押すまでデータを変えない。
 * 休みの期間の訪問は消さず「休みのため無し」と扱う（計算から外れる）。休みと重なる確定した日があれば注意を出す
 * （確認ではなく注意。案は作り直さない）。消すのは直す欄の「この休みを消す」（確認してから。元に戻るだけ）
 */

type Form = { id: string | null; from: string; to: string; note: string };

export function ClientLeavesSection({
  client,
  onOpenDay,
  onDirty,
}: {
  client: Client;
  /** 確定した日へのリンクを押したとき（無ければ選んでいる日付を変えて予定の画面へ） */
  onOpenDay?: (date: string) => void;
  /** 入力中の変更の有無（画面を離れる前の確認に使う） */
  onDirty?: (dirty: boolean) => void;
}) {
  const { data, update } = useDemoData();
  const terms = data.org.terms;
  const toast = useToast();
  const confirmDialog = useConfirm();
  const navigate = useNavigate();
  const { setDate } = useDay();
  const today = jstDate(Date.now());
  const [form, setFormState] = useState<Form | null>(null);
  /** 開いたときの入力（変更があるかの判定） */
  const [opened, setOpened] = useState<Form | null>(null);
  const openForm = (f: Form | null) => {
    setFormState(f);
    setOpened(f);
  };
  const setForm = (f: Form) => setFormState(f);
  const dirty = form !== null && JSON.stringify(form) !== JSON.stringify(opened);
  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  // 誤りはオブジェクトで持つ（同じ文で保存し直しても作り直して読み上げる。PRD D250）
  const [errorState, setErrorState] = useState<{ text: string } | null>(null);
  const error = errorState?.text ?? null;
  const setError = (text: string | null) => setErrorState(text === null ? null : { text });
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
    openForm(null);
    toast(
      `休みを${form.id ? '直しました' : '入れました'}（${mdText(leave.from)}〜${mdText(leave.to)}・訪問 ${n}件は無しになります）`,
    );
  };

  const remove = async (l: ClientLeave) => {
    const ok = await confirmDialog({
      title: `${mdText(l.from)}〜${mdText(l.to)}の休みを消しますか？`,
      body: 'この間の訪問は元に戻ります（案は作り直しません）。',
      confirmLabel: '休みを消す',
      tone: 'danger',
    });
    if (!ok) return;
    update((d) => removeLeave(d, l.id));
    if (form?.id === l.id) openForm(null);
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
                openForm({ id: null, from: today, to: today, note: '' });
              }}
            >
              <WithIcon icon={Plus} size={14}>
                休みを入れる
              </WithIcon>
            </button>
          )
        }
      >
        休み（入院・ショートステイなど）
      </SectionTitle>
      <Hint>
        <ul className="hint-list">
          <li>休みの間の訪問は消さずに「休みのため無し」にし、案に入れません。</li>
          <li>休みを消すと元に戻ります。</li>
        </ul>
      </Hint>
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
                  <button
                    type="button"
                    className="btn btn-small btn-text"
                    aria-label={`${mdText(l.from)}〜${mdText(l.to)}の休みを直す`}
                    onClick={() => {
                      setError(null);
                      openForm({ id: l.id, from: l.from, to: l.to, note: l.note });
                    }}
                    data-testid="leave-edit"
                  >
                    <WithIcon icon={Pencil} size={14}>
                      直す
                    </WithIcon>
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {form && (
        <fieldset className="leave-form stack" data-testid="leave-form" onKeyDown={enterToSave(save)}>
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
                休みを入れても確定した割当は変わりません。その日の「日の予定」で案を作り直してください。
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
          <FieldError token={errorState}>{error}</FieldError>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-small btn-primary" onClick={save} data-testid="leave-save">
              <WithIcon icon={Check} size={14}>
                保存
              </WithIcon>
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                openForm(null);
                setError(null);
              }}
              data-testid="leave-cancel"
            >
              <WithIcon icon={X} size={14}>
                取り消し
              </WithIcon>
            </button>
            {form.id && (
              <button
                type="button"
                className="btn btn-small btn-danger"
                onClick={() => {
                  const l = leaves.find((x) => x.id === form.id);
                  if (l) void remove(l);
                }}
                data-testid="leave-remove"
              >
                <WithIcon icon={Trash2} size={14}>
                  この休みを消す
                </WithIcon>
              </button>
            )}
          </div>
          <span className="sub">
            {terms.client}
            の休みは、訪問を別の日に振り替えません。振り替えるときは、予定のカレンダーで訪問を足してください。
          </span>
        </fieldset>
      )}
    </div>
  );
}
