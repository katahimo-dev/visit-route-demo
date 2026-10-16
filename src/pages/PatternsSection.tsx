import { CalendarClock, Check, Pencil, Plus, Repeat, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useToast } from '../components/Toast';
import { Hint, IconButton, SectionTitle, WithIcon } from '../components/ui';
import { TypeDot } from '../components/visitType';
import type { DemoData } from '../contracts/data';
import { type Client, type Pattern, patternSchema } from '../contracts/documents';
import type { PatternChange } from '../contracts/patterns';
import { jstDate } from '../domain/time';
import { byName, newId, own, WEEKDAY_LABELS } from '../lib/common';
import { EVERY_WEEKS_LABELS, mdText, patternWhenText, periodText, typeOf } from '../lib/patternText';
import { applyPatterns, removePattern, splitPattern } from '../patterns';
import { useDemoData } from '../store';

/**
 * 〈利用者さん〉の欄の中の「定期パターン」の節（ADR-0012。PRD D37・D38）：一覧と 足す・直す・消す。
 * 足すと展開済みの範囲（今日から、いまある訪問の最後の日まで）に展開し、直すときは「いつから」で分けて（splitPattern）、
 * 消すときは今日以降の訪問を除く（removePattern）。どちらも件数と確定した日を確認してから入れる
 */

type Form = {
  /** 直すパターン（null は足す） */
  id: string | null;
  typeId: string;
  weekdays: number[];
  everyWeeks: number;
  windowKind: Pattern['windowKind'];
  earliestStart: string;
  latestStart: string;
  durationMinutes: string;
  /** 開始日（足すとき） */
  from: string;
  /** いつから変えるか（直すとき） */
  since: string;
  to: string;
  usualStaffId: string;
  note: string;
};

const formOf = (p: Pattern | null, today: string, defaultDuration: number): Form =>
  p
    ? {
        id: p.id,
        typeId: p.typeId ?? '',
        weekdays: [...p.weekdays],
        everyWeeks: p.everyWeeks,
        windowKind: p.windowKind,
        earliestStart: p.earliestStart,
        latestStart: p.latestStart,
        durationMinutes: String(p.durationMinutes),
        from: p.from,
        since: today,
        to: p.to ?? '',
        usualStaffId: p.usualStaffId ?? '',
        note: p.note,
      }
    : {
        id: null,
        typeId: '',
        weekdays: [],
        everyWeeks: 1,
        windowKind: 'fixed',
        earliestStart: '10:00',
        latestStart: '10:00',
        durationMinutes: String(defaultDuration),
        from: today,
        since: today,
        to: '',
        usualStaffId: '',
        note: '',
      };

/** 変わる訪問のうち、確定した割当がある日の数 */
function confirmedDays(d: DemoData, c: PatternChange): number {
  const days = new Set([...c.removed, ...c.added].map((x) => x.date));
  return [...days].filter((x) => own(d.manualPlans, x)).length;
}

/** 展開済みの範囲の最後の日（いまある訪問の最後の日。無ければ今日） */
function lastVisitDate(d: DemoData, today: string): string {
  return d.visits.reduce((m, v) => (v.date > m ? v.date : m), today);
}

export function PatternsSection({ client }: { client: Client }) {
  const { data, update } = useDemoData();
  const terms = data.org.terms;
  const toast = useToast();
  const today = jstDate(Date.now());
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const patterns = useMemo(() => data.patterns.filter((p) => p.clientId === client.id), [data.patterns, client.id]);
  const staff = useMemo(() => [...data.staff].sort(byName), [data.staff]);
  const staffName = (id: string | null) => (id ? (data.staff.find((s) => s.id === id)?.name ?? '（不明）') : null);
  const usualOfClient = staffName(client.usualStaffId);

  /** 入力を確かめてパターンの中身にする（だめなら理由の文） */
  const parse = (f: Form, from: string): Pattern | string => {
    if (f.weekdays.length === 0) return '曜日を1つ以上選んでください';
    const latest = f.windowKind === 'fixed' ? f.earliestStart : f.latestStart;
    if (f.earliestStart > latest) return '開始（遅）は開始（早）以降にしてください';
    if (f.to && f.to < from)
      return f.id ? '終了日は「いつから」以降にしてください' : '終了日は開始日以降にしてください';
    const r = patternSchema.safeParse({
      id: f.id ?? newId('pt'),
      clientId: client.id,
      typeId: f.typeId && data.visitTypes.some((t) => t.id === f.typeId) ? f.typeId : null,
      weekdays: [...f.weekdays].sort((a, b) => a - b),
      everyWeeks: f.everyWeeks,
      windowKind: f.windowKind,
      earliestStart: f.earliestStart,
      latestStart: latest,
      durationMinutes: Number(f.durationMinutes),
      from,
      to: f.to || null,
      usualStaffId: f.usualStaffId || null,
      note: f.note,
    });
    if (!r.success) {
      const where = r.error.issues[0]?.path[0];
      if (where === 'durationMinutes') return '所要は5〜720分で入れてください';
      if (where === 'from' || where === 'to') return '日付を正しく入れてください';
      if (where === 'earliestStart' || where === 'latestStart') return '時刻を正しく入れてください';
      return r.error.issues[0]?.message ?? '入力を確かめてください';
    }
    return r.data;
  };

  const save = () => {
    if (!form) return;
    setError(null);
    if (!form.id) {
      // 足す：展開済みの範囲（今日から、いまある訪問の最後の日まで）に、このパターンだけを展開する
      const p = parse(form, form.from);
      if (typeof p === 'string') {
        setError(p);
        return;
      }
      const range = { from: today, to: lastVisitDate(data, today) };
      const count = applyPatterns({ patterns: [p], visits: data.visits, clients: data.clients }, range, today).added
        .length;
      update((d) => {
        const c = applyPatterns({ patterns: [p], visits: d.visits, clients: d.clients }, range, today);
        return { ...d, patterns: [...d.patterns, p], visits: c.visits };
      });
      setForm(null);
      toast(`定期パターンを足しました（訪問 ${count}件）`);
      return;
    }
    // 直す：「いつから」で分けて、その日以降の（この回だけの変更でない）訪問を作り直す
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.since)) {
      setError('「いつから変えますか」に日付を入れてください');
      return;
    }
    const original = data.patterns.find((x) => x.id === form.id);
    if (!original) return;
    const p = parse(form, form.since <= original.from ? original.from : form.since);
    if (typeof p === 'string') {
      setError(p);
      return;
    }
    const { id: _, from: __, ...next } = p;
    const nid = newId('pt');
    const c = splitPattern(data, original.id, next, form.since, today, nid);
    const m = confirmedDays(data, c);
    const msg =
      `${mdText(form.since)}から変えます。作り直す訪問は ${c.removed.length}件（新しく ${c.added.length}件を作ります）。` +
      (m > 0 ? `\nそのうち確定した日 ${m}日の訪問があります（その日の確定した割当は見直しが要ります）。` : '') +
      '\nこの回だけ変えた訪問・取り消した訪問はそのままです。よろしいですか？';
    if (!confirm(msg)) return;
    update((d) => {
      const x = splitPattern(d, original.id, next, form.since, today, nid);
      return { ...d, patterns: x.patterns, visits: x.visits };
    });
    setForm(null);
    toast(`定期パターンを直しました（作り直した訪問 ${c.added.length}件）`);
  };

  const remove = (p: Pattern) => {
    const c = removePattern(data, p.id, today);
    const m = confirmedDays(data, c);
    const msg =
      `この定期パターンを消します。今日以降の訪問 ${c.removed.length}件を消します（今日より前の訪問・この回だけ変えた訪問は単発の訪問として残します）。` +
      (m > 0 ? `\nそのうち確定した日 ${m}日の訪問があります。` : '') +
      '\nよろしいですか？';
    if (!confirm(msg)) return;
    update((d) => {
      const x = removePattern(d, p.id, today);
      return { ...d, patterns: x.patterns, visits: x.visits };
    });
    if (form?.id === p.id) setForm(null);
    toast(`定期パターンを消しました（訪問 ${c.removed.length}件）`);
  };

  const toggleDay = (w: number) => {
    if (!form) return;
    setForm({
      ...form,
      weekdays: form.weekdays.includes(w) ? form.weekdays.filter((x) => x !== w) : [...form.weekdays, w],
    });
  };

  return (
    <div className="stack" data-testid="patterns-section">
      <SectionTitle
        icon={Repeat}
        aside={
          !form && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                setError(null);
                setForm(formOf(null, today, 60));
              }}
            >
              <WithIcon icon={Plus} size={14}>
                パターンを追加
              </WithIcon>
            </button>
          )
        }
      >
        定期パターン
      </SectionTitle>
      <Hint>
        決まった曜日・時刻の訪問です。足すと、今日から、いまある訪問の最後の日までの訪問を作ります（その先の月は「月間」の画面で作ります）。
        {!client.active && ` この${terms.client}は休止中なので、訪問は作りません。`}
      </Hint>
      {patterns.length === 0 ? (
        <span className="sub">定期パターンはありません</span>
      ) : (
        <ul className="pattern-list">
          {patterns.map((p) => {
            const t = typeOf(data.visitTypes, p.typeId);
            const usual = staffName(p.usualStaffId);
            return (
              <li key={p.id} className="pattern-row" data-testid="pattern-row">
                <span className="row" style={{ gap: 6, minWidth: 0, flexWrap: 'wrap' }}>
                  {t ? (
                    <span className="type-mark" title={`種類：${t.name}`}>
                      <TypeDot type={t} />
                      {t.name}
                    </span>
                  ) : (
                    <span className="chip">種類なし</span>
                  )}
                  <strong>{patternWhenText(p)}</strong>
                  <span className="sub">
                    {p.durationMinutes}分・{periodText(p)}
                    {usual ? `・いつもの担当 ${usual}` : ''}
                  </span>
                </span>
                <span className="actions">
                  <IconButton
                    icon={Pencil}
                    label={`${patternWhenText(p)}のパターンを直す`}
                    onClick={() => {
                      setError(null);
                      setForm(formOf(p, today, p.durationMinutes));
                    }}
                  />
                  <IconButton
                    icon={Trash2}
                    tone="danger"
                    label={`${patternWhenText(p)}のパターンを消す`}
                    onClick={() => remove(p)}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {form && (
        <fieldset className="pattern-form stack" data-testid="pattern-form">
          <legend>{form.id ? 'パターンを直す' : 'パターンを追加'}</legend>
          <div className="form-grid">
            <label>
              種類
              <select
                value={form.typeId}
                onChange={(e) => {
                  const t = typeOf(data.visitTypes, e.target.value);
                  // 種類を選ぶと所要の初期値をその種類の標準の所要にする
                  setForm({
                    ...form,
                    typeId: e.target.value,
                    ...(t ? { durationMinutes: String(t.durationMinutes) } : {}),
                  });
                }}
              >
                <option value="">種類なし</option>
                {data.visitTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              間隔
              <select
                value={form.everyWeeks}
                onChange={(e) => setForm({ ...form, everyWeeks: Number(e.target.value) })}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {EVERY_WEEKS_LABELS[n]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <span className="sub">曜日（1つ以上）</span>
            <fieldset className="weekday-toggles" aria-label="曜日">
              {WEEKDAY_LABELS.map((w, i) => (
                <button
                  key={w}
                  type="button"
                  className={`weekday-toggle${form.weekdays.includes(i) ? ' is-on' : ''}`}
                  aria-pressed={form.weekdays.includes(i)}
                  onClick={() => toggleDay(i)}
                >
                  {w}
                </button>
              ))}
            </fieldset>
          </div>
          <div className="form-grid">
            <label>
              時間の決め方
              <select
                value={form.windowKind}
                onChange={(e) => setForm({ ...form, windowKind: e.target.value as Pattern['windowKind'] })}
              >
                <option value="fixed">ちょうど</option>
                <option value="window">幅（この間に開始）</option>
              </select>
            </label>
            <label>
              {form.windowKind === 'fixed' ? '開始' : '開始（早）'}
              <input
                type="time"
                value={form.earliestStart}
                onChange={(e) => setForm({ ...form, earliestStart: e.target.value })}
              />
            </label>
            {form.windowKind === 'window' && (
              <label>
                開始（遅）
                <input
                  type="time"
                  value={form.latestStart}
                  onChange={(e) => setForm({ ...form, latestStart: e.target.value })}
                />
              </label>
            )}
            <label>
              所要（分）
              <input
                type="number"
                min={5}
                max={720}
                value={form.durationMinutes}
                onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
              />
            </label>
            {form.id ? (
              <label>
                <WithIcon icon={CalendarClock} size={14}>
                  いつから変えますか
                </WithIcon>
                <input type="date" value={form.since} onChange={(e) => setForm({ ...form, since: e.target.value })} />
              </label>
            ) : (
              <label>
                開始日
                <input
                  type="date"
                  value={form.from}
                  onChange={(e) => setForm({ ...form, from: e.target.value || today })}
                />
              </label>
            )}
            <label>
              終了日（空＝続く）
              <input type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
            </label>
            <label>
              いつもの担当
              <select value={form.usualStaffId} onChange={(e) => setForm({ ...form, usualStaffId: e.target.value })}>
                <option value="">
                  {usualOfClient
                    ? `${terms.client}のいつもの担当（${usualOfClient}）`
                    : `${terms.client}のいつもの担当`}
                </option>
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
              <input value={form.note} maxLength={200} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </label>
          </div>
          {form.id && (
            <span className="sub">
              「いつから」より前の訪問と、この回だけ変えた訪問・取り消した訪問は変えません。それ以外の訪問を新しい中身で作り直します。
            </span>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button type="button" className="btn btn-small" onClick={save}>
              <WithIcon icon={Check} size={14}>
                {form.id ? '直す' : '足す'}
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
        </fieldset>
      )}
    </div>
  );
}
