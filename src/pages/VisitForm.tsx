import { Check, Pencil, Plus, Repeat, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { FieldError, invalidAttrs, RequiredMark, submitHandler } from '../components/FieldError';
import { SectionTitle, WithIcon } from '../components/ui';
import { TypeDot } from '../components/visitType';
import { type Client, type Visit, visitSchema } from '../contracts/documents';
import { formError, formErrorField, newId } from '../lib/common';
import { mdText, patternWhenText, typeOf } from '../lib/patternText';
import { savedVisit } from '../lib/visitEdit';
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
  /** エラー文と、誤った欄（Form のキー。欄と結ばない誤りは無し） */
  const [error, setError] = useState<{ text: string; field?: keyof Form } | null>(null);
  const errorId = useId();
  const bad = (k: keyof Form) => invalidAttrs(error?.field === k, errorId);
  const rootRef = useRef<HTMLFormElement>(null);
  /**
   * 開いたときの訪問（PRD D251）。表示中の日を変えると親から渡る訪問が消える（その日の訪問ではない）ので、
   * 開いたときの ID でデータから引き直し、入力を捨てずに引き継ぐ
   */
  const [opened] = useState(() => ({
    id: visit?.id ?? null,
    /** 開いたときの訪問の日（新しい訪問なら開いたときの表示中の日）。「M/D に移しました」はこれと比べる */
    date: visit?.date ?? date,
    /** 開いたときの表示中の日（変わったときだけ「別の日」の知らせを出す） */
    shownDate: date,
    /** 開いたときに取り消し済みだったか（取り消した訪問を直すと取り消しを外す。開いた後に取り消されたら保存しない） */
    cancelled: visit?.cancelled ?? false,
  }));
  const current = visit ?? (opened.id ? (data.visits.find((x) => x.id === opened.id) ?? null) : null);
  /** 開いた後に消された・取り消された（ほかの操作で）。保存すると取り消しが黙って外れるので止める */
  const gone = opened.id !== null && (!current || (current.cancelled && !opened.cancelled));
  /** 定期パターンから展開した訪問なら、そのパターン（ADR-0012） */
  const pattern = current?.pattern ? (data.patterns.find((p) => p.id === current.pattern?.id) ?? null) : null;
  // 開いたら最初の欄へ（PRD D251。見える所へ巻くのは親）。閉じたら（保存・キャンセル）開いたときの要素、
  // 無くなっていれば「訪問を追加」のボタンへ戻す（フォーカスがどこかへ移っていれば動かさない）
  useEffect(() => {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    rootRef.current?.querySelector<HTMLElement>('input, select, textarea')?.focus({ preventScroll: true });
    return () => {
      const at = document.activeElement;
      if (at && at !== document.body && at.isConnected) return;
      const to =
        back?.isConnected && back !== document.body
          ? back
          : // 「訪問を追加」は日の予定の「その他 ▾」の中（PRD D279）。閉じた一覧には無いので「その他」のボタンへ
            document.querySelector<HTMLElement>('[data-testid="plan-more"]');
      to?.focus({ preventScroll: true });
    };
  }, []);

  const save = () => {
    setError(null);
    if (gone) {
      setError({
        text: current
          ? 'この訪問は開いた後に取り消されました。保存すると取り消しが外れるので保存しません。キャンセルで閉じてください'
          : 'この訪問は消されています。キャンセルで閉じてください',
      });
      return;
    }
    const visit = current;
    try {
      const typeId = form.typeId && data.visitTypes.some((t) => t.id === form.typeId) ? form.typeId : null;
      // 日付を変えたら担当を外す・この回だけの変更の判定は lib/visitEdit（ADR-0012）
      const v = visitSchema.parse(
        savedVisit(
          visit,
          {
            date: form.date,
            clientId: form.clientId,
            windowKind: form.windowKind,
            earliestStart: form.earliestStart,
            latestStart: form.windowKind === 'fixed' ? form.earliestStart : form.latestStart,
            durationMinutes: Number(form.durationMinutes),
            note: form.note,
            typeId,
          },
          newId('v'),
        ),
      );
      if (v.latestStart < v.earliestStart) {
        setError({ text: '「最も遅い開始時刻」は「最も早い開始時刻」より後にしてください', field: 'latestStart' });
        return;
      }
      update((d) => ({
        ...d,
        visits: visit ? d.visits.map((x) => (x.id === v.id ? v : x)) : [...d.visits, v],
      }));
      onSaved(
        v.pattern?.edited && !visit?.pattern?.edited
          ? '訪問を保存しました（この回だけの変更）'
          : v.date !== opened.date
            ? `訪問を保存しました（${mdText(v.date)} に移しました）`
            : '訪問を保存しました',
      );
      onClose();
    } catch (e) {
      // 契約の検査の誤りは、その欄に印を付ける（日付・時刻・所要など）
      const f = formErrorField(e);
      setError({
        text: f === 'durationMinutes' ? '所要時間は5〜720分の整数で入れてください' : formError(e),
        field: f && f in form ? (f as keyof Form) : undefined,
      });
    }
  };

  return (
    <form ref={rootRef} className="card stack" onSubmit={submitHandler(save)} noValidate data-testid="visit-form">
      <SectionTitle icon={opened.id ? Pencil : Plus}>{opened.id ? '訪問を編集' : '訪問を追加'}</SectionTitle>
      {current?.pattern && (
        <p className="sub row" style={{ gap: 6, flexWrap: 'wrap' }} data-testid="visit-pattern-ref">
          <WithIcon icon={Repeat} size={14}>
            {pattern ? `定期パターン（${patternWhenText(pattern)}）` : '定期パターン'}の{mdText(current.pattern.date)}
            の回
          </WithIcon>
          {current.pattern.edited ? (
            <span className="chip chip-warn">この回だけの変更</span>
          ) : (
            <span className="sub">
              （日付・時刻・所要・種類を変えると「この回だけの変更」になり、パターンを直しても変わりません）
            </span>
          )}
        </p>
      )}
      {date !== opened.shownDate && form.date !== date && (
        // 表示中の日を変えても入力は引き継ぐ。保存する日が表示中の日と違うことを知らせる（PRD D251）
        <p className="sub row" style={{ gap: 6, flexWrap: 'wrap' }} data-testid="visit-form-other-day">
          <span>
            この入力は{mdText(form.date)}の訪問です（表示中の日は{mdText(date)}）
          </span>
          <button type="button" className="btn btn-small" onClick={() => setForm({ ...form, date })}>
            {mdText(date)}にする
          </button>
        </p>
      )}
      <div className="form-grid">
        <label>
          <span>
            日付
            <RequiredMark />
          </span>
          <input
            type="date"
            value={form.date}
            required
            {...bad('date')}
            onChange={(e) => setForm({ ...form, date: e.target.value || form.date })}
          />
        </label>
        <label>
          <span>
            {terms.client}
            <RequiredMark />
          </span>
          <select
            value={form.clientId}
            required
            {...bad('clientId')}
            onChange={(e) => setForm({ ...form, clientId: e.target.value })}
          >
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
          <span>
            {form.windowKind === 'fixed' ? '開始時刻' : '最も早い開始時刻'}
            <RequiredMark />
          </span>
          <input
            type="time"
            value={form.earliestStart}
            required
            {...bad('earliestStart')}
            onChange={(e) => setForm({ ...form, earliestStart: e.target.value })}
          />
        </label>
        {form.windowKind === 'window' && (
          <label>
            <span>
              最も遅い開始時刻
              <RequiredMark />
            </span>
            <input
              type="time"
              value={form.latestStart}
              required
              {...bad('latestStart')}
              onChange={(e) => setForm({ ...form, latestStart: e.target.value })}
            />
          </label>
        )}
        <label>
          <span>
            所要時間（分）
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
          <input
            value={form.note}
            maxLength={200}
            {...bad('note')}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </label>
      </div>
      <FieldError id={errorId} token={error}>
        {error?.text}
      </FieldError>
      <div className="row">
        <button type="submit" className="btn btn-primary">
          <WithIcon icon={Check}>保存</WithIcon>
        </button>
        <button type="button" className="btn" onClick={onClose}>
          <WithIcon icon={X}>キャンセル</WithIcon>
        </button>
      </div>
    </form>
  );
}
