import { CalendarClock, Check, Pencil, Plus, Repeat, Trash2, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useConfirm } from '../components/ConfirmDialog';
import { enterToSave, FieldError } from '../components/FieldError';
import { useToast } from '../components/Toast';
import { Hint, IconButton, SectionTitle, WithIcon } from '../components/ui';
import { TypeDot } from '../components/visitType';
import type { DemoData } from '../contracts/data';
import { type Client, type Pattern, patternSchema } from '../contracts/documents';
import type { PatternChange } from '../contracts/patterns';
import { hhmmToMinutes, jstDate, minutesToHhmm } from '../domain/time';
import { byName, newId, own, WEEKDAY_LABELS } from '../lib/common';
import { EVERY_WEEKS_LABELS, mdText, patternWhenText, periodText, typeOf } from '../lib/patternText';
import { useFeature } from '../lib/useFeature';
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
  /** 繰り返し方（ADR-0013） */
  repeat: Pattern['repeat'];
  /** 毎月の第N（1〜5） */
  monthWeeks: number[];
  /** 曜日ごとに時刻を変える */
  perDay: boolean;
  /** 曜日 → 開始（早・遅）。perDay のとき、選んだ曜日のうち入れたものだけを使う */
  dayTimes: Record<number, { earliestStart: string; latestStart: string }>;
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
        repeat: p.repeat,
        monthWeeks: [...p.monthWeeks],
        perDay: p.dayTimes.length > 0,
        dayTimes: Object.fromEntries(
          p.dayTimes.map((t) => [t.weekday, { earliestStart: t.earliestStart, latestStart: t.latestStart }]),
        ),
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
        repeat: 'weekly',
        monthWeeks: [],
        perDay: false,
        dayTimes: {},
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
  const confirmDialog = useConfirm();
  const today = jstDate(Date.now());
  const [form, setForm] = useState<Form | null>(null);
  /**
   * 毎月の第N週・曜日ごとの時刻（ADR-0028 の patternMonthly）。切なら選べない。今の値がそれなら欄は読むだけで出す
   * （パターンは事実なので、訪問は今どおり作られる）
   */
  const monthlyOn = useFeature('patternMonthly');
  const monthlyOffId = useId();
  /** 曜日ごとの時刻のパターンで patternMonthly が切：曜日・曜日ごとの時刻は読むだけ（データを変えない） */
  const daysLocked = !monthlyOn && !!form?.perDay;
  // 誤りはオブジェクトで持つ（同じ文で保存し直しても作り直して読み上げる。PRD D250）
  const [errorState, setErrorState] = useState<{ text: string } | null>(null);
  const error = errorState?.text ?? null;
  const setError = (text: string | null) => setErrorState(text === null ? null : { text });
  const patterns = useMemo(() => data.patterns.filter((p) => p.clientId === client.id), [data.patterns, client.id]);
  const staff = useMemo(() => [...data.staff].sort(byName), [data.staff]);
  const staffName = (id: string | null) => (id ? (data.staff.find((s) => s.id === id)?.name ?? '（不明）') : null);
  const usualOfClient = staffName(client.usualStaffId);

  /** 入力を確かめてパターンの中身にする（だめなら理由の文） */
  const parse = (f: Form, from: string): Pattern | string => {
    if (f.weekdays.length === 0) return '曜日を1つ以上選んでください';
    if (f.repeat === 'monthly' && f.monthWeeks.length === 0) return '第何週かを1つ以上選んでください';
    const latest = f.windowKind === 'fixed' ? f.earliestStart : f.latestStart;
    if (f.earliestStart > latest) return '開始（遅）は開始（早）以降にしてください';
    // 曜日ごとの時刻（ADR-0013）：選んだ曜日のうち時刻を入れたものだけ。ちょうどなら開始（遅）＝開始（早）
    const dayTimes = f.perDay
      ? [...f.weekdays]
          .sort((a, b) => a - b)
          .flatMap((w) => {
            const t = f.dayTimes[w];
            if (!t?.earliestStart) return [];
            // 幅のパターンで開始（遅）が空なら、共通の時刻の幅（開始（遅）− 開始（早））を保った時刻にする
            const width = Math.max(0, hhmmToMinutes(f.latestStart) - hhmmToMinutes(f.earliestStart));
            const l =
              f.windowKind === 'fixed'
                ? t.earliestStart
                : t.latestStart || minutesToHhmm(Math.min(hhmmToMinutes(t.earliestStart) + width, 23 * 60 + 59));
            return [{ weekday: w, earliestStart: t.earliestStart, latestStart: l }];
          })
      : [];
    const badDay = dayTimes.find((t) => t.earliestStart > t.latestStart);
    if (badDay) return `${WEEKDAY_LABELS[badDay.weekday]}曜の開始（遅）は開始（早）以降にしてください`;
    if (f.to && f.to < from)
      return f.id ? '終了日は「いつから」以降にしてください' : '終了日は開始日以降にしてください';
    const r = patternSchema.safeParse({
      id: f.id ?? newId('pt'),
      clientId: client.id,
      typeId: f.typeId && data.visitTypes.some((t) => t.id === f.typeId) ? f.typeId : null,
      weekdays: [...f.weekdays].sort((a, b) => a - b),
      everyWeeks: f.repeat === 'monthly' ? 1 : f.everyWeeks,
      repeat: f.repeat,
      monthWeeks: f.repeat === 'monthly' ? [...f.monthWeeks].sort((a, b) => a - b) : [],
      dayTimes,
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
      if (where === 'earliestStart' || where === 'latestStart' || where === 'dayTimes')
        return '時刻を正しく入れてください';
      return r.error.issues[0]?.message ?? '入力を確かめてください';
    }
    return r.data;
  };

  const save = async () => {
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
    const ok = await confirmDialog({
      title: `定期パターンを${mdText(form.since)}から変えますか？`,
      body:
        `作り直す訪問は ${c.removed.length}件（新しく ${c.added.length}件を作ります）。` +
        (m > 0 ? `\nそのうち確定した日 ${m}日の訪問があります（その日の確定した割当は見直しが要ります）。` : '') +
        '\nこの回だけ変えた訪問・取り消した訪問はそのままです。',
      confirmLabel: '訪問を作り直して変える',
    });
    if (!ok) return;
    update((d) => {
      const x = splitPattern(d, original.id, next, form.since, today, nid);
      return { ...d, patterns: x.patterns, visits: x.visits };
    });
    setForm(null);
    toast(`定期パターンを直しました（作り直した訪問 ${c.added.length}件）`);
  };

  const remove = async (p: Pattern) => {
    const c = removePattern(data, p.id, today);
    const m = confirmedDays(data, c);
    const ok = await confirmDialog({
      title: 'この定期パターンを消しますか？',
      body:
        `今日以降の訪問 ${c.removed.length}件を消します（今日より前の訪問・この回だけ変えた訪問は単発の訪問として残します）。` +
        (m > 0 ? `\nそのうち確定した日 ${m}日の訪問があります。` : ''),
      confirmLabel: '訪問ごと消す',
      tone: 'danger',
    });
    if (!ok) return;
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
        決まった曜日・時刻の訪問です。足すと、今日からいまある訪問の最後の日まで、訪問を作ります。その先の月は「月の予定」で作ります。
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
        <fieldset className="pattern-form stack" data-testid="pattern-form" onKeyDown={enterToSave(save)}>
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
              繰り返し
              <select
                disabled={!monthlyOn && form.repeat === 'monthly'}
                aria-describedby={!monthlyOn && form.repeat === 'monthly' ? monthlyOffId : undefined}
                value={form.repeat === 'monthly' ? 'monthly' : String(form.everyWeeks)}
                onChange={(e) =>
                  setForm(
                    e.target.value === 'monthly'
                      ? { ...form, repeat: 'monthly' }
                      : { ...form, repeat: 'weekly', everyWeeks: Number(e.target.value) },
                  )
                }
                data-testid="pattern-repeat"
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {EVERY_WEEKS_LABELS[n]}
                  </option>
                ))}
                {(monthlyOn || form.repeat === 'monthly') && <option value="monthly">毎月（第N週）</option>}
              </select>
            </label>
          </div>
          {!monthlyOn && (form.repeat === 'monthly' || form.perDay) && (
            <span className="sub" id={monthlyOffId} data-testid="pattern-monthly-off">
              毎月の第N週・曜日ごとの時刻は管理者設定で切っています（読むだけです。訪問は今どおり作られます）
            </span>
          )}
          <div className="stack" style={{ gap: 4 }}>
            <span className="sub">曜日（1つ以上）</span>
            <fieldset className="weekday-toggles" aria-label="曜日" data-testid="pattern-weekdays">
              {WEEKDAY_LABELS.map((w, i) => (
                <button
                  key={w}
                  type="button"
                  className={`weekday-toggle${form.weekdays.includes(i) ? ' is-on' : ''}`}
                  aria-pressed={form.weekdays.includes(i)}
                  // 曜日ごとの時刻を切っているとき、曜日を足すと黙って共通の時刻になるので押せない（読むだけ。ADR-0028）
                  disabled={daysLocked}
                  aria-describedby={daysLocked ? monthlyOffId : undefined}
                  onClick={() => toggleDay(i)}
                >
                  {w}
                </button>
              ))}
            </fieldset>
          </div>
          {form.repeat === 'monthly' && (
            <div className="stack" style={{ gap: 4 }}>
              <span className="sub">第何週（1つ以上。例：第3・第4の木曜）</span>
              <fieldset className="weekday-toggles" aria-label="第何週" data-testid="pattern-month-weeks">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`weekday-toggle month-week-toggle${form.monthWeeks.includes(n) ? ' is-on' : ''}`}
                    aria-pressed={form.monthWeeks.includes(n)}
                    disabled={!monthlyOn}
                    title={n === 5 ? '第5の曜日がある月だけ' : undefined}
                    onClick={() =>
                      setForm({
                        ...form,
                        monthWeeks: form.monthWeeks.includes(n)
                          ? form.monthWeeks.filter((x) => x !== n)
                          : [...form.monthWeeks, n],
                      })
                    }
                  >
                    第{n}
                  </button>
                ))}
              </fieldset>
              <span className="sub">第5は、その曜日が5回ある月だけ訪問を作ります。</span>
            </div>
          )}
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
          <div className="stack" style={{ gap: 4 }} hidden={!monthlyOn && !form.perDay}>
            <label className="check">
              <input
                type="checkbox"
                disabled={!monthlyOn}
                checked={form.perDay}
                onChange={(e) => setForm({ ...form, perDay: e.target.checked })}
                data-testid="pattern-per-day"
              />
              曜日ごとに時刻を変える（例：月曜は 9:30、木曜は 15:00）
            </label>
            {form.perDay &&
              (form.weekdays.length === 0 ? (
                <span className="sub">先に曜日を選んでください</span>
              ) : (
                <div className="pattern-daytimes" data-testid="pattern-daytimes">
                  <div className="row pattern-daytime sub" aria-hidden="true">
                    <span className="pattern-daytime-day">曜日</span>
                    <span className="pattern-daytime-col">{form.windowKind === 'fixed' ? '開始' : '開始（早）'}</span>
                    {form.windowKind === 'window' && <span className="pattern-daytime-col">開始（遅）</span>}
                  </div>
                  {[...form.weekdays]
                    .sort((a, b) => a - b)
                    .map((w) => {
                      const t = form.dayTimes[w] ?? { earliestStart: '', latestStart: '' };
                      const set = (patch: Partial<typeof t>) =>
                        setForm({ ...form, dayTimes: { ...form.dayTimes, [w]: { ...t, ...patch } } });
                      return (
                        <div key={w} className="row pattern-daytime">
                          <strong className="pattern-daytime-day">{WEEKDAY_LABELS[w]}</strong>
                          <label className="pattern-daytime-col">
                            <span className="sr-only">
                              {WEEKDAY_LABELS[w]}曜の{form.windowKind === 'fixed' ? '開始' : '開始（早）'}
                            </span>
                            <input
                              type="time"
                              value={t.earliestStart}
                              disabled={!monthlyOn}
                              onChange={(e) => set({ earliestStart: e.target.value })}
                            />
                          </label>
                          {form.windowKind === 'window' && (
                            <label className="pattern-daytime-col">
                              <span className="sr-only">{WEEKDAY_LABELS[w]}曜の開始（遅）</span>
                              <input
                                type="time"
                                value={t.latestStart}
                                disabled={!monthlyOn}
                                onChange={(e) => set({ latestStart: e.target.value })}
                              />
                            </label>
                          )}
                        </div>
                      );
                    })}
                  <span className="sub">
                    空の曜日は、上の共通の時刻です。
                    {form.windowKind === 'window' && '開始（遅）が空なら、共通の時刻と同じ幅にします。'}
                  </span>
                </div>
              ))}
          </div>
          {form.id && (
            <span className="sub">
              「いつから」より前の訪問と、この回だけ変えた訪問・取り消した訪問は変えません。それ以外の訪問を新しい中身で作り直します。
            </span>
          )}
          <FieldError token={errorState}>{error}</FieldError>
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
