import { CalendarClock, CalendarX2, Check, Pencil, Plus, Repeat, Trash2, X } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { useConfirm } from '../components/ConfirmDialog';
import { enterToSave, FieldError } from '../components/FieldError';
import { useToast } from '../components/Toast';
import { Hint, SectionTitle, WithIcon } from '../components/ui';
import { TypeDot } from '../components/visitType';
import type { DemoData } from '../contracts/data';
import { type Client, type Pattern, patternSchema } from '../contracts/documents';
import type { PatternChange } from '../contracts/patterns';
import { hhmmToMinutes, jstDate, minutesToHhmm } from '../domain/time';
import { byName, newId, WEEKDAY_LABELS } from '../lib/common';
import { EVERY_WEEKS_LABELS, mdText, patternWhenText, periodText, typeOf } from '../lib/patternText';
import { useFeature } from '../lib/useFeature';
import { endPatternOp } from '../lib/visitOps';
import { removePattern, splitPattern, timesOn } from '../patterns';
import { useDemoData } from '../store';

/**
 * 〈利用者さん〉の画面の予定のタブの「繰り返し」（定期パターン。ADR-0012・0052。PRD D37・D38・D308）：一覧と 足す・直す・終わらせる・消す。
 * どれも「直す（足す・終わらせる）→ 保存」の形で、保存を押すまでデータを変えない（取り消しで捨てる）。
 * 回は見るときに計算する（版2。ADR-0053）。直すときは「いつから」で分け（splitPattern。その日からの、担当を組んだ回は繰り返しのとおりに戻る）、
 * 終わらせるときは最後の日より後の回を無くし（visitOps の endPatternOp）、消すときは繰り返しごと消す（removePattern）。
 * 直す・終わらせる・消すは件数と確定した日を確認してから入れる。行を押すとその回をカレンダーで強調する（onSelect）
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
  /** 曜日 → 標準の開始（ADR-0062。空＝なし）。選んだ曜日のうち入れたものだけを使う */
  usualStarts: Record<number, string>;
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
        usualStarts: Object.fromEntries((p.usualStarts ?? []).map((u) => [u.weekday, u.start])),
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
        usualStarts: {},
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

/** 標準の開始の文（「標準の開始：月 10:00・水 11:00」。無ければ空。ADR-0062） */
const usualStartsLabel = (p: Pick<Pattern, 'usualStarts'>): string => {
  const us = [...(p.usualStarts ?? [])].sort((a, b) => a.weekday - b.weekday);
  return us.length === 0 ? '' : `標準の開始：${us.map((u) => `${WEEKDAY_LABELS[u.weekday]} ${u.start}`).join('・')}`;
};

/** 確定した（伝えた）日のうち、since 以降でその繰り返しの回がある日の数（変えると「未連絡の変更」になる） */
function confirmedDays(d: DemoData, patternId: string, since: string, c?: PatternChange): number {
  const removed = new Set(c?.removed.map((x) => x.date) ?? []);
  return Object.values(d.snapshots).filter(
    (s) => s.date >= since && (removed.has(s.date) || s.visits.some((x) => x.id === `${s.date}_${patternId}`)),
  ).length;
}

export function PatternsSection({
  client,
  selected = null,
  onSelect,
  onDirty,
  readOnly = false,
}: {
  client: Client;
  /** カレンダーで強調している繰り返し */
  selected?: string | null;
  /** 行を押したとき（同じ行をもう一度押すと null） */
  onSelect?: (id: string | null) => void;
  /** 入力中の変更の有無（画面を離れる前の確認に使う） */
  onDirty?: (dirty: boolean) => void;
  /** 読むだけ（狭い画面。足す・直す・終わらせるを出さない） */
  readOnly?: boolean;
}) {
  const { data, update } = useDemoData();
  const terms = data.org.terms;
  const toast = useToast();
  const confirmDialog = useConfirm();
  const today = jstDate(Date.now());
  const [form, setForm] = useState<Form | null>(null);
  /** 開いたときの入力（変更があるかの判定） */
  const [opened, setOpened] = useState<Form | null>(null);
  /** 終わらせる繰り返しと最後の日（null：閉じている） */
  const [ending, setEnding] = useState<{ id: string; last: string; opened: string } | null>(null);
  const open = (f: Form | null) => {
    setError(null);
    setEnding(null);
    setForm(f);
    setOpened(f);
  };
  const dirty =
    (form !== null && JSON.stringify(form) !== JSON.stringify(opened)) ||
    (ending !== null && ending.last !== ending.opened);
  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
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
    // 曜日ごとの標準の開始（ADR-0062）：選んだ曜日のうち入れたものだけ。その曜日の時間の約束（開始（早）〜（遅））の中
    const usualStarts: { weekday: number; start: string }[] = [];
    for (const w of [...f.weekdays].sort((a, b) => a - b)) {
      const start = f.usualStarts[w];
      if (!start) continue;
      const tw = timesOn({ earliestStart: f.earliestStart, latestStart: latest, dayTimes }, w);
      if (start < tw.earliestStart || start > tw.latestStart)
        return `${WEEKDAY_LABELS[w]}曜の標準の開始は、開始（${tw.earliestStart}〜${tw.latestStart}）の間にしてください`;
      usualStarts.push({ weekday: w, start });
    }
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
      ...(usualStarts.length > 0 ? { usualStarts } : {}),
      note: f.note,
    });
    if (!r.success) {
      const where = r.error.issues[0]?.path[0];
      if (where === 'durationMinutes') return '所要は5〜720分で入れてください';
      if (where === 'from' || where === 'to') return '日付を正しく入れてください';
      if (where === 'earliestStart' || where === 'latestStart' || where === 'dayTimes' || where === 'usualStarts')
        return '時刻を正しく入れてください';
      return r.error.issues[0]?.message ?? '入力を確かめてください';
    }
    return r.data;
  };

  const save = async () => {
    if (!form) return;
    setError(null);
    if (!form.id) {
      // 足す：回は見るときに計算するので、繰り返しを足すだけ（版2）
      const p = parse(form, form.from);
      if (typeof p === 'string') {
        setError(p);
        return;
      }
      update((d) => ({ ...d, patterns: [...d.patterns, p] }), '繰り返しを足す');
      open(null);
      toast(
        p.usualStaffId
          ? `繰り返しを足しました（担当：${staffName(p.usualStaffId)}）`
          : '繰り返しを足しました（担当なし。日の予定・月の予定で AI で組めます）',
      );
      return;
    }
    // 直す：「いつから」で分けて、その日以降の（この回だけの変更でない）訪問を作り直す
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.since)) {
      setError('「いつから変えますか」に日付を入れてください');
      return;
    }
    if (form.since < today) {
      setError('「いつから変えますか」は今日以降にしてください（今日より前の回は変えません）');
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
    const m = confirmedDays(data, original.id, form.since > today ? form.since : today, c);
    const ok = await confirmDialog({
      title: `繰り返しを${mdText(form.since)}から変えますか？`,
      body:
        `${mdText(form.since)}からの回は新しい繰り返しのとおりになります（担当は繰り返しの担当）。` +
        (c.removed.length > 0 ? `\n担当を組んだ回 ${c.removed.length}件も繰り返しのとおりに戻ります。` : '') +
        (m > 0 ? `\n確定した日 ${m}日の訪問は「未連絡の変更」になります。` : '') +
        '\nこの回だけ変えた訪問・取り消した訪問はそのままです。',
      confirmLabel: '変える',
    });
    if (!ok) return;
    update((d) => {
      const x = splitPattern(d, original.id, next, form.since, today, nid);
      return { ...d, patterns: x.patterns, visits: x.visits };
    }, '繰り返しを直す');
    open(null);
    toast('繰り返しを直しました');
  };

  const remove = async (p: Pattern) => {
    const c = removePattern(data, p.id, today);
    const m = confirmedDays(data, p.id, today, c);
    const ok = await confirmDialog({
      title: 'この繰り返しを消しますか？',
      body:
        '今日からの回を消します（今日より前の回は残し、昨日で終わらせます。今日より前に始まっていない繰り返しはまるごと消えます。この回だけ変えた回は単発の訪問として残します）。' +
        (m > 0 ? `\n確定した日 ${m}日の訪問は「未連絡の変更」になります。` : '') +
        '\nやめるだけなら「終わらせる」を使います。',
      confirmLabel: '訪問ごと消す',
      tone: 'danger',
    });
    if (!ok) return;
    update((d) => {
      const x = removePattern(d, p.id, today);
      return { ...d, patterns: x.patterns, visits: x.visits };
    }, '繰り返しを消す');
    if (form?.id === p.id) open(null);
    if (selected === p.id) onSelect?.(null);
    toast('繰り返しを消しました');
  };

  /** 終わらせる：最後の日より後の回を消し、終了日を入れる（確認してから） */
  const end = async () => {
    if (!ending) return;
    setError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ending.last)) {
      setError('最後の日を入れてください');
      return;
    }
    const r = endPatternOp(data, ending.id, ending.last, today);
    const ok = await confirmDialog({
      title: `繰り返しを${mdText(ending.last)}で終わらせますか？`,
      body:
        `${mdText(ending.last)}より後の回は無くなります${r.removed > 0 ? `（担当を組んだ回 ${r.removed}件も消します）` : ''}。` +
        (r.confirmedDays > 0 ? `\n確定した日 ${r.confirmedDays}日の訪問は「未連絡の変更」になります。` : '') +
        '\nこの回だけ変えた訪問・取り消した訪問はそのままです。',
      confirmLabel: '終わらせる',
    });
    if (!ok) return;
    update((d) => endPatternOp(d, ending.id, ending.last, today).data, '繰り返しを終わらせる');
    setEnding(null);
    toast(`繰り返しを${mdText(ending.last)}で終わらせました`);
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
          !form &&
          !readOnly && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => open(formOf(null, today, 60))}
              data-testid="pattern-add"
            >
              <WithIcon icon={Plus} size={14}>
                繰り返しを足す
              </WithIcon>
            </button>
          )
        }
      >
        繰り返し
      </SectionTitle>
      <Hint>
        <ul className="hint-list">
          <li>決まった曜日・時刻の訪問です。押すと、その回をカレンダーで目立たせます。</li>
          <li>足すと、今日から作ってある最後の日まで訪問を作ります。その先の月は「月の予定」で作ります。</li>
          {!client.active && <li>この{terms.client}は利用中でないので、訪問は作りません。</li>}
        </ul>
      </Hint>
      {patterns.length === 0 ? (
        <span className="sub">繰り返しはありません</span>
      ) : (
        <ul className="pattern-list">
          {patterns.map((p) => {
            const t = typeOf(data.visitTypes, p.typeId);
            const usual = staffName(p.usualStaffId);
            return (
              <li
                key={p.id}
                className={`pattern-row${selected === p.id ? ' is-selected' : ''}`}
                data-testid="pattern-row"
                data-pattern={p.id}
              >
                <button
                  type="button"
                  className="pattern-pick row"
                  aria-pressed={selected === p.id}
                  onClick={() => onSelect?.(selected === p.id ? null : p.id)}
                  disabled={!onSelect}
                  data-testid="pattern-pick"
                >
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
                  {usualStartsLabel(p) && (
                    <span className="sub" data-testid="pattern-usual-starts">
                      {usualStartsLabel(p)}
                    </span>
                  )}
                </button>
                {!readOnly && (
                  <span className="actions">
                    <button
                      type="button"
                      className="btn btn-small btn-text"
                      aria-label={`${patternWhenText(p)}の繰り返しを直す`}
                      onClick={() => open(formOf(p, today, p.durationMinutes))}
                      data-testid="pattern-edit"
                    >
                      <WithIcon icon={Pencil} size={14}>
                        直す
                      </WithIcon>
                    </button>
                    <button
                      type="button"
                      className="btn btn-small btn-text"
                      aria-label={`${patternWhenText(p)}の繰り返しを終わらせる`}
                      onClick={() => {
                        open(null);
                        // 既定の最後の日：終わっていればその日、まだ始まっていなければ開始日、ほかは今日
                        const last = p.to !== null && p.to < today ? p.to : p.from > today ? p.from : today;
                        setEnding({ id: p.id, last, opened: last });
                      }}
                      data-testid="pattern-end"
                    >
                      <WithIcon icon={CalendarX2} size={14}>
                        終わらせる
                      </WithIcon>
                    </button>
                  </span>
                )}
                {ending?.id === p.id && (
                  <fieldset className="pattern-form stack" data-testid="pattern-end-form" onKeyDown={enterToSave(end)}>
                    <legend>繰り返しを終わらせる</legend>
                    <label>
                      最後の日
                      <input
                        type="date"
                        value={ending.last}
                        min={p.from}
                        onChange={(e) => setEnding({ ...ending, last: e.target.value })}
                        data-testid="pattern-end-last"
                      />
                    </label>
                    <span className="sub">
                      この日より後の回を消します（この回だけ変えた回・取り消した回は残します）。
                    </span>
                    {p.from > today && (
                      <span className="sub" data-testid="pattern-end-before">
                        まだ始まっていない繰り返しです（{mdText(p.from)}
                        から）。開始日の回も要らないときは、「直す」の「この繰り返しを消す」で消します。
                      </span>
                    )}
                    <FieldError token={errorState}>{error}</FieldError>
                    <div className="row">
                      <button
                        type="button"
                        className="btn btn-small btn-primary"
                        onClick={end}
                        data-testid="pattern-end-save"
                      >
                        <WithIcon icon={Check} size={14}>
                          保存
                        </WithIcon>
                      </button>
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => {
                          setEnding(null);
                          setError(null);
                        }}
                      >
                        <WithIcon icon={X} size={14}>
                          取り消し
                        </WithIcon>
                      </button>
                    </div>
                  </fieldset>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {form && (
        <fieldset className="pattern-form stack" data-testid="pattern-form" onKeyDown={enterToSave(save)}>
          <legend>{form.id ? '繰り返しを直す' : '繰り返しを足す'}</legend>
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
                <input
                  type="date"
                  min={today}
                  value={form.since}
                  onChange={(e) => setForm({ ...form, since: e.target.value })}
                />
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
              担当（いつもの担当）
              <select
                value={form.usualStaffId}
                onChange={(e) => setForm({ ...form, usualStaffId: e.target.value })}
                data-testid="pattern-staff"
              >
                <option value="">担当なし（AI で組む）</option>
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
          {form.weekdays.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              <span className="sub">
                曜日ごとの標準の開始（空＝なし。開始（早）〜（遅）の間。組んだ開始の初期値になります）
              </span>
              <div className="pattern-daytimes" data-testid="pattern-usual-starts-form">
                {[...form.weekdays]
                  .sort((a, b) => a - b)
                  .map((w) => (
                    <div key={w} className="row pattern-daytime">
                      <strong className="pattern-daytime-day">{WEEKDAY_LABELS[w]}</strong>
                      <label className="pattern-daytime-col">
                        <span className="sr-only">{WEEKDAY_LABELS[w]}曜の標準の開始</span>
                        <input
                          type="time"
                          value={form.usualStarts[w] ?? ''}
                          onChange={(e) =>
                            setForm({ ...form, usualStarts: { ...form.usualStarts, [w]: e.target.value } })
                          }
                        />
                      </label>
                      {form.usualStarts[w] && (
                        <button
                          type="button"
                          className="btn btn-small btn-text"
                          aria-label={`${WEEKDAY_LABELS[w]}曜の標準の開始を消す`}
                          onClick={() => setForm({ ...form, usualStarts: { ...form.usualStarts, [w]: '' } })}
                        >
                          消す
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}
          {form.id && (
            <span className="sub">
              「いつから」より前の訪問と、この回だけ変えた訪問・取り消した訪問は変えません。それ以外の訪問を新しい中身で作り直します。
            </span>
          )}
          <FieldError token={errorState}>{error}</FieldError>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-small btn-primary" onClick={save} data-testid="pattern-save">
              <WithIcon icon={Check} size={14}>
                保存
              </WithIcon>
            </button>
            <button type="button" className="btn btn-small" onClick={() => open(null)} data-testid="pattern-cancel">
              <WithIcon icon={X} size={14}>
                取り消し
              </WithIcon>
            </button>
            {form.id && (
              <button
                type="button"
                className="btn btn-small btn-danger"
                onClick={() => {
                  const p = data.patterns.find((x) => x.id === form.id);
                  if (p) void remove(p);
                }}
                data-testid="pattern-remove"
              >
                <WithIcon icon={Trash2} size={14}>
                  この繰り返しを消す
                </WithIcon>
              </button>
            )}
          </div>
        </fieldset>
      )}
    </div>
  );
}
