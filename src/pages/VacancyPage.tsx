import {
  BookmarkPlus,
  CalendarSearch,
  ClipboardList,
  Copy,
  MapPin,
  MessageSquareText,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConditionsEditor } from '../components/conditions';
import { LevelLegend } from '../components/glance';
import { MailButton, MailLengthNote, MailNotice } from '../components/mailParts';
import { PlaceEditor } from '../components/parts';
import { useToast } from '../components/Toast';
import { Hint, PageHeader, SectionTitle, SidePanel, WithIcon } from '../components/ui';
import type { Client, Pattern, Place } from '../contracts/documents';
import { EMPTY_REFERRER, patternSchema } from '../contracts/documents';
import type { Condition } from '../contracts/rules';
import {
  VACANCY_DAY_END_DEFAULT,
  VACANCY_DAY_START_DEFAULT,
  VACANCY_DURATION_MAX,
  VACANCY_DURATION_MIN,
  VACANCY_MARGIN_DEFAULT,
  VACANCY_STEP_DEFAULT,
  VACANCY_WEEKS_DEFAULT,
  VACANCY_WEEKS_MAX,
  VACANCY_WEEKS_MIN,
  type VacancyCell,
  type VacancyQuery,
  type VacancyRange,
  type VacancyResult,
  type Verdict,
} from '../contracts/vacancy';
import { HALF_HOURS, timeText } from '../domain/availability';
import { addDays, hhmmToMinutes, jstDate, jstHhmm, minutesToHhmm, weekday } from '../domain/time';
import { copyText } from '../lib/clipboard';
import { CLIENT_COLORS } from '../lib/colors';
import { attempt, dateText, hasLocation, nameTaken, newId, WEEKDAY_LABELS } from '../lib/common';
import { type InquiryDayMark, type InquiryRow, inquiryDayLevel, inquiryRows, vacancyLevel } from '../lib/glance';
import { referrerRecipients, vacancySubject } from '../lib/mail';
import { buildMail } from '../lib/mailto';
import { ymOf } from '../lib/month';
import { mdText, typeOf } from '../lib/patternText';
import { insertAllIntoPlans, weekStart } from '../lib/week';
import { applyPatterns } from '../patterns';
import { useDemoData } from '../store';
import { inquirySummary, vacancyNotice, vacancyOf, verdictOf } from '../vacancy';
import './settings.css';
import './vacancy.css';

/**
 * 空き状況と問い合わせの試算（ADR-0012 追記。段階3＝PRD D45〜D48。design.md §4 pages「空き状況と問い合わせの試算」）。
 * 条件の欄 → 曜日×開始時刻の表（人数と ○△×？）→ マスを押すと日付ごとの人 → 問い合わせの試算の要約・コピー → 仮押さえ。
 * データは読むだけ。仮押さえだけが1回の update で〈利用者さん〉（仮）と定期パターンを入れる
 */

/** 表の行の並び（月〜日） */
const ROW_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
/** 条件を変えてから計算し直すまで（ms） */
const DEBOUNCE_MS = 300;

const MARK: Record<Verdict, string> = { ok: '○', partial: '△', ng: '×', unknown: '？' };
const VERDICT_TEXT: Record<Verdict, string> = {
  ok: 'どの週も受けられる',
  partial: '受けられない週がある',
  ng: '受けられない',
  unknown: '案が無く数えていない',
};

const hm = (t: number) => timeText(minutesToHhmm(t));

/** 空き状況の表の凡例（PRD D78。どの週でも受けられる人数の段階） */
const VACANCY_LEGEND: [string, string][] = [
  ['none', '0人（どの週も）'],
  ['partial', '0人の週がある'],
  ['one', '1人'],
  ['two', '2人'],
  ['three', '3人'],
  ['many', '4人以上'],
  ['unknown', '案なし'],
];

const DAY_MARK: Record<InquiryDayMark, string> = { ok: '○', ng: '×', unknown: '？' };
const DAY_TEXT: Record<InquiryDayMark, string> = {
  ok: '受けられる',
  ng: '受けられない',
  unknown: '案が無く数えていない',
};

/**
 * 問い合わせの試算の週ごとのマス（PRD D79）：希望の曜日×週。マスは ○×？ とその日の一番多い人数、色は空き状況の表と同じ。
 * 行の頭にその曜日の判定（○△×？）
 */
function InquiryWeeks({ rows, exact }: { rows: InquiryRow[]; exact: boolean }) {
  if (rows.every((r) => r.days.length === 0)) return null;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="vacancy-scroll">
        <table className="inquiry-weeks" data-testid="inquiry-weeks">
          <caption className="sr-only">希望の曜日と週ごとの、希望の時間帯に受けられるか</caption>
          <tbody>
            {rows.map((r) => (
              <tr key={r.weekday}>
                <th scope="row">
                  {WEEKDAY_LABELS[r.weekday]} {MARK[r.verdict]}
                  {r.start !== null && <small> {hm(r.start)}〜</small>}
                  <span className="sr-only">（{VERDICT_TEXT[r.verdict]}）</span>
                </th>
                {r.days.map((x) => {
                  const label = `${dateText(x.date)}${r.start !== null ? ` ${hm(r.start)}から` : ''}：${DAY_MARK[x.mark]} ${DAY_TEXT[x.mark]}${
                    x.mark === 'ok' ? `（${exact ? '' : '約'}${x.best}人）` : ''
                  }`;
                  return (
                    <td key={x.date}>
                      <span
                        className={`inquiry-day lv-${inquiryDayLevel(x)}`}
                        title={label}
                        data-testid="inquiry-day"
                        data-mark={x.mark}
                      >
                        <span className="inquiry-day-mark" aria-hidden="true">
                          {DAY_MARK[x.mark]}
                          {x.mark === 'ok' ? (
                            <small>
                              {' '}
                              {exact ? '' : '約'}
                              {x.best}
                            </small>
                          ) : null}
                        </span>
                        <span className="inquiry-day-date" aria-hidden="true">
                          {mdText(x.date)}
                        </span>
                        <span className="sr-only">{label}</span>
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="sub">
        行の頭は、希望の時間帯の中でその曜日に一番良い開始時刻（上の要約と同じ決め方：同じ開始時刻がどの週も受けられれば
        ○）。 マスはその開始時刻にその日受けられる人数（○ のあとの数字{exact ? '' : '。目安なので「約」'}
        ）。×＝その日は受けられない、？＝案が無く数えていない。
      </span>
    </div>
  );
}

/** 展開済みの範囲の最後の日（いまある訪問の最後の日。無ければ今日）。PatternsSection と同じ決め方 */
function lastVisitDate(visits: { date: string }[], today: string): string {
  return visits.reduce((m, v) => (v.date > m ? v.date : m), today);
}

/** 案内文の期間（ADR-0013）：今週＝今日〜その週の日曜（月曜はじまり）、来週＝次の月曜〜日曜、先4週＝今日から4週 */
type NoticePeriod = 'thisWeek' | 'nextWeek' | 'fourWeeks';
const NOTICE_PERIODS: { id: NoticePeriod; label: string }[] = [
  { id: 'thisWeek', label: '今週' },
  { id: 'nextWeek', label: '来週' },
  { id: 'fourWeeks', label: '先4週' },
];
function noticeRange(period: NoticePeriod, today: string): { from: string; to: string; weeks: number } {
  const monday = weekStart(today);
  if (period === 'thisWeek') return { from: today, to: addDays(monday, 6), weeks: 1 };
  if (period === 'nextWeek') return { from: addDays(monday, 7), to: addDays(monday, 13), weeks: 1 };
  return { from: today, to: addDays(today, 27), weeks: 4 };
}

/** 仮押さえで作る定期パターンの曜日と開始時刻（選んだ曜日（無ければ全曜日）のうち ○ のある曜日の最初の ○。月〜日の順に週の回数まで） */
function holdSlots(
  result: VacancyResult,
  weekdays: number[],
  from: string,
  to: string,
  perWeek: number,
): { weekday: number; start: number }[] {
  const days = weekdays.length > 0 ? ROW_WEEKDAYS.filter((w) => weekdays.includes(w)) : ROW_WEEKDAYS;
  const lo = hhmmToMinutes(from);
  const hi = hhmmToMinutes(to);
  const out: { weekday: number; start: number }[] = [];
  for (const wd of days) {
    const first = result.cells
      .filter((c) => c.weekday === wd && c.start >= lo && c.start <= hi && verdictOf(c) === 'ok')
      .sort((a, b) => a.start - b.start)[0];
    if (first) out.push({ weekday: wd, start: first.start });
  }
  return out.length >= perWeek ? out.slice(0, perWeek) : [];
}

export default function VacancyPage() {
  const { data, update } = useDemoData();
  const terms = data.org.terms;
  const toast = useToast();
  const today = jstDate(Date.now());

  // 条件の欄
  const [typeId, setTypeId] = useState('');
  const [duration, setDuration] = useState('60');
  const [requirements, setRequirements] = useState<Condition[]>([]);
  const [place, setPlace] = useState<Place>({ address: '', lat: null, lng: null });
  const [weeks, setWeeks] = useState(VACANCY_WEEKS_DEFAULT);
  const [from, setFrom] = useState(today);
  // 問い合わせの試算
  const [wishDays, setWishDays] = useState<number[]>([]);
  const [wishFrom, setWishFrom] = useState('09:00');
  const [wishTo, setWishTo] = useState('17:00');
  const [perWeek, setPerWeek] = useState(1);
  // 欄
  const [picked, setPicked] = useState<VacancyCell | null>(null);
  const [hold, setHold] = useState<{ name: string; error: string | null } | null>(null);

  const durationNum = Number(duration);
  const durationOk =
    Number.isInteger(durationNum) && durationNum >= VACANCY_DURATION_MIN && durationNum <= VACANCY_DURATION_MAX;
  const fromOk = /^\d{4}-\d{2}-\d{2}$/.test(from);
  const exactPlace = hasLocation(place) ? place : null;

  const query = useMemo<VacancyQuery | null>(
    () =>
      durationOk
        ? {
            typeId: typeId || null,
            durationMinutes: durationNum,
            requirements,
            place: exactPlace,
            marginMinutes: VACANCY_MARGIN_DEFAULT,
            dayStart: VACANCY_DAY_START_DEFAULT,
            dayEnd: VACANCY_DAY_END_DEFAULT,
            stepMinutes: VACANCY_STEP_DEFAULT,
          }
        : null,
    [durationOk, typeId, durationNum, requirements, exactPlace],
  );
  const range = useMemo<VacancyRange | null>(() => (fromOk ? { from, weeks } : null), [from, fromOk, weeks]);

  // 条件を変えると 300ms 間引いて計算し直す（データ・今の案は読むだけ）
  const [result, setResult] = useState<VacancyResult | null>(null);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    if (!query || !range) {
      setBusy(false);
      return;
    }
    setBusy(true);
    const id = window.setTimeout(() => {
      setResult(attempt(() => vacancyOf(data, query, range)).value);
      setBusy(false);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [data, query, range]);

  const cellOf = useMemo(() => {
    const m = new Map<string, VacancyCell>();
    for (const c of result?.cells ?? []) m.set(`${c.weekday}-${c.start}`, c);
    return m;
  }, [result]);
  const staffName = useMemo(() => new Map(data.staff.map((s) => [s.id, s.name])), [data.staff]);

  const wish = { weekdays: wishDays, from: wishFrom, to: wishTo, perWeek, startDate: from };
  const wishOk = hhmmToMinutes(wishFrom) <= hhmmToMinutes(wishTo);
  const summary = result && wishOk ? inquirySummary(result, wish, terms) : null;
  const slots = result && wishOk ? holdSlots(result, wishDays, wishFrom, wishTo, perWeek) : [];
  const vType = typeOf(data.visitTypes, typeId);

  // 空き枠の案内文（PRD D67。ADR-0013）：期間・種類を選ぶ。所要は種類の標準（種類なしは上の条件の所要）、
  // 〈スタッフ〉の条件・場所は上の条件のまま。条件を変えると 300ms 間引いて計算し直す
  const [noticePeriod, setNoticePeriod] = useState<NoticePeriod>('nextWeek');
  const [noticeTypeId, setNoticeTypeId] = useState('');
  const noticeType = typeOf(data.visitTypes, noticeTypeId);
  const noticeDuration = noticeType ? noticeType.durationMinutes : durationOk ? durationNum : null;
  const noticeSpan = useMemo(() => noticeRange(noticePeriod, today), [noticePeriod, today]);
  const [notice, setNotice] = useState<{ text: string; noPlan: string[] } | null>(null);
  // 紹介元へ BCC で一斉に（PRD D95。ADR-0017）：宛先は紹介元のメールを重複なく。外した宛先（小文字）だけを画面の中で持つ
  const referrers = useMemo(() => referrerRecipients(data.clients), [data.clients]);
  const [mailOff, setMailOff] = useState<ReadonlySet<string>>(new Set());
  const mailBcc = referrers.filter((r) => !mailOff.has(r.email.toLowerCase())).map((r) => r.email);
  const noticeMail =
    notice && mailBcc.length > 0
      ? buildMail({ to: [], bcc: mailBcc, subject: vacancySubject(data.org), full: notice.text })
      : null;
  const noticeMailWhy =
    referrers.length === 0
      ? `紹介元のメールアドレスが未登録です（${terms.client}の画面の「紹介元のメールアドレス」で入れられます）`
      : '宛先を1つ以上選んでください';
  useEffect(() => {
    if (noticeDuration === null) {
      setNotice(null);
      return;
    }
    const id = window.setTimeout(() => {
      const q: VacancyQuery = {
        typeId: noticeType?.id ?? null,
        durationMinutes: noticeDuration,
        requirements,
        place: exactPlace,
        marginMinutes: VACANCY_MARGIN_DEFAULT,
        dayStart: VACANCY_DAY_START_DEFAULT,
        dayEnd: VACANCY_DAY_END_DEFAULT,
        stepMinutes: VACANCY_STEP_DEFAULT,
      };
      const r = attempt(() => vacancyOf(data, q, { from: noticeSpan.from, weeks: noticeSpan.weeks })).value;
      if (!r) {
        setNotice(null);
        return;
      }
      const text = vacancyNotice(r, {
        orgName: data.org.name,
        terms,
        typeName: noticeType?.name ?? null,
        durationMinutes: noticeDuration,
        period: { from: noticeSpan.from, to: noticeSpan.to },
        mode: noticePeriod === 'fourWeeks' ? 'weekly' : 'dates',
        exact: r.exact,
        // 今日はもう過ぎた時刻を載せない（今の時刻は画面で決める）
        notBefore: { date: jstDate(Date.now()), minutes: hhmmToMinutes(jstHhmm(Date.now())) },
      });
      const noPlan = r.noPlanDates.filter((d) => d >= noticeSpan.from && d <= noticeSpan.to);
      setNotice({ text, noPlan });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [data, noticeType, noticeDuration, requirements, exactPlace, noticeSpan, noticePeriod, terms]);
  const copyNotice = async () => {
    if (!notice) return;
    toast(
      (await copyText(notice.text)) ? '案内文をコピーしました' : 'コピーできませんでした。文を選んでコピーしてください',
    );
  };

  const toggleDay = (w: number) =>
    setWishDays(wishDays.includes(w) ? wishDays.filter((x) => x !== w) : [...wishDays, w]);

  const copy = async () => {
    if (!summary) return;
    toast((await copyText(summary)) ? '要約をコピーしました' : 'コピーできませんでした。文を選んでコピーしてください');
  };

  /** 仮押さえ：〈利用者さん〉（仮）と定期パターンを1回の update で入れ、展開済みの範囲に applyPatterns */
  const register = () => {
    if (!hold || !query) return;
    const name = hold.name.trim();
    if (!name) {
      setHold({ ...hold, error: '表示名を入れてください' });
      return;
    }
    if (nameTaken(data.clients, (x) => x.displayName, name)) {
      setHold({ ...hold, error: `「${name}」と同じ名前の${terms.client}がいます。名前を変えてください` });
      return;
    }
    if (slots.length === 0) return;
    const client: Client = {
      id: newId('c'),
      displayName: name,
      kana: '',
      place: { ...place, postalCode: '' },
      note: '問い合わせの試算から仮押さえ',
      color: data.clients.length % CLIENT_COLORS.length,
      active: true,
      traits: {},
      requirements,
      preferences: [],
      usualStaffId: null,
      tentative: true,
      entryNote: '',
      keyNote: '',
      parkingNote: '',
      cautionNote: '',
      allowedStaffIds: [],
      // 問い合わせからの仮押さえは「相談受付」の段階（ADR-0015）。仮押さえなので予定・AI案に入る
      stage: 'inquiry',
      referrer: { ...EMPTY_REFERRER },
    };
    const parsed = slots.map((s) =>
      patternSchema.safeParse({
        id: newId('pt'),
        clientId: client.id,
        typeId: vType?.id ?? null,
        weekdays: [s.weekday],
        everyWeeks: 1,
        windowKind: 'fixed',
        earliestStart: minutesToHhmm(s.start),
        latestStart: minutesToHhmm(s.start),
        durationMinutes: query.durationMinutes,
        from,
        to: null,
        usualStaffId: null,
        note: '',
      }),
    );
    const patterns: Pattern[] = [];
    for (const r of parsed) {
      if (!r.success) {
        setHold({ ...hold, error: '定期パターンを作れませんでした。条件を確かめてください' });
        return;
      }
      patterns.push(r.data);
    }
    // 足した訪問は、今の案がある日なら空き時間に入れて固定する（lib/week の insertIntoPlan。入らない日は知らせる）
    const createdAt = Date.now();
    const build = (d: typeof data) => {
      const clients = [...d.clients, client];
      const c = applyPatterns(
        { patterns, visits: d.visits, clients },
        { from: today, to: lastVisitDate(d.visits, today) },
        today,
      );
      const next = { ...d, clients, patterns: [...d.patterns, ...patterns], visits: c.visits };
      return { added: c.added.length, ...insertAllIntoPlans(next, c.added, createdAt) };
    };
    // 知らせの件数はいまのデータで数える（update の中の関数はあとで呼ばれることがある）
    const r = build(data);
    update((d) => build(d).data);
    setHold(null);
    const into = r.inserted > 0 ? `・今の案に ${r.inserted}件入れました` : '';
    const miss =
      r.failedDates.length > 0
        ? `。${r.failedDates.length}日（${r.failedDates.map(mdText).join('・')}）は空き時間に入りません`
        : '';
    toast(`仮押さえしました（${name}・訪問 ${r.added}件${into}）${miss}`);
  };

  const noPlan = result?.noPlanDates ?? [];

  return (
    <div className="stack vacancy-page">
      <PageHeader
        icon={CalendarSearch}
        title="空き状況"
        lead={`曜日・時刻ごとに、新しい訪問を受けられる${terms.staff}の人数を見て、問い合わせに答えます`}
      />

      <div className="card stack">
        <SectionTitle icon={SlidersHorizontal}>条件</SectionTitle>
        <div className="form-grid">
          <label>
            種類
            <select
              value={typeId}
              onChange={(e) => {
                const t = typeOf(data.visitTypes, e.target.value);
                setTypeId(e.target.value);
                // 種類を選ぶと所要の初期値をその種類の標準の所要にする
                if (t) setDuration(String(t.durationMinutes));
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
            所要（分）
            <input
              type="number"
              min={VACANCY_DURATION_MIN}
              max={VACANCY_DURATION_MAX}
              step={5}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </label>
          <label>
            見る週の数
            <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
              {Array.from({ length: VACANCY_WEEKS_MAX - VACANCY_WEEKS_MIN + 1 }, (_, i) => i + VACANCY_WEEKS_MIN).map(
                (n) => (
                  <option key={n} value={n}>
                    {n}週
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            開始日
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
        </div>
        {!durationOk && (
          <p className="error" role="alert">
            所要は{VACANCY_DURATION_MIN}〜{VACANCY_DURATION_MAX}分で入れてください
          </p>
        )}
        {!fromOk && (
          <p className="error" role="alert">
            開始日を入れてください
          </p>
        )}
        <details className="vacancy-more">
          <summary>
            {terms.staff}の条件
            {requirements.length > 0 ? `（${requirements.length}件）` : '（問わない）'}
          </summary>
          <Hint>例：性別が女性。種類の「担当に必要な条件」は、ここで選ばなくても入ります。</Hint>
          <ConditionsEditor items={data.items} target="staff" value={requirements} onChange={setRequirements} />
        </details>
        <div className="stack vacancy-place">
          <span className="vacancy-place-title">
            <WithIcon icon={MapPin} size={14}>
              場所{exactPlace ? '' : '（空＝目安）'}
            </WithIcon>
          </span>
          <span className="sub">
            地図に点を置くと、その場所への移動を含めて正確に数えます。空のときは移動を前後{VACANCY_MARGIN_DEFAULT}
            分で見込んだ目安です。
          </span>
          <PlaceEditor value={place} onChange={setPlace} />
        </div>
      </div>

      <div className="card stack" data-testid="vacancy-table-card">
        <SectionTitle icon={Users} aside={busy && <span className="sub">計算しています…</span>}>
          {result?.exact
            ? `${place.address.trim() || '選んだ場所'}への移動を含む`
            : `目安（移動を前後${VACANCY_MARGIN_DEFAULT}分で見込む）`}
        </SectionTitle>
        <p className="sub vacancy-legend">
          マスの数字はどの週でも受けられる人数{result?.exact ? '' : '（目安なので「約」）'}
          。○＝どの週も受けられる・△＝受けられない週がある・×＝受けられない・？＝案が無く数えていない。マスを押すと日付ごとの人を見られます。
          {vType && ` 種類「${vType.name}」の担当に必要な条件を満たす人だけを数えます。`}
        </p>
        <LevelLegend items={VACANCY_LEGEND} />
        {noPlan.length > 0 && (
          <p className="vacancy-noplan" data-testid="vacancy-noplan">
            案の無い日（{noPlan.length}日）は数えていません。
            <Link to={`/month?ym=${ymOf(noPlan[0]!)}`}>月間カレンダーで案を作ってください</Link>
          </p>
        )}
        {result && result.times.length === 0 && <p className="sub">所要が長すぎて、入る時刻がありません</p>}
        {result && result.times.length > 0 && (
          <div className="vacancy-scroll">
            <table className="vacancy-grid" data-testid="vacancy-grid">
              <thead>
                <tr>
                  <th scope="col" className="vacancy-corner">
                    曜日＼開始
                  </th>
                  {result.times.map((t) => (
                    <th key={t} scope="col" className={t % 60 === 0 ? 'is-hour' : ''}>
                      {hm(t)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROW_WEEKDAYS.map((wd) => (
                  <tr key={wd}>
                    <th scope="row" className={wd === 0 ? 'is-sun' : wd === 6 ? 'is-sat' : ''}>
                      {WEEKDAY_LABELS[wd]}
                    </th>
                    {result.times.map((t) => {
                      const c = cellOf.get(`${wd}-${t}`);
                      if (!c) return <td key={t} />;
                      const v = verdictOf(c);
                      const count = v === 'unknown' ? '' : `${result.exact ? '' : '約'}${c.min}`;
                      const label = `${WEEKDAY_LABELS[wd]} ${hm(t)}から：${MARK[v]} ${VERDICT_TEXT[v]}${
                        v === 'unknown' ? '' : `・どの週でも ${count}人（${c.weeksOk}/${c.weeksTotal}週）`
                      }`;
                      return (
                        <td key={t}>
                          <button
                            type="button"
                            className={`vacancy-cell is-${v} lv-${vacancyLevel(c)}${picked === c ? ' is-picked' : ''}`}
                            data-testid="vacancy-cell"
                            data-weekday={wd}
                            data-start={minutesToHhmm(t)}
                            aria-label={label}
                            title={label}
                            onClick={() => setPicked(c)}
                          >
                            <span className="vacancy-mark" aria-hidden="true">
                              {MARK[v]}
                            </span>
                            <span className="vacancy-count" aria-hidden="true">
                              {count}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card stack" data-testid="inquiry-card">
        <SectionTitle icon={MessageSquareText}>問い合わせの試算</SectionTitle>
        {!exactPlace && <p className="sub">場所を入れると、移動を含めて試算します（上の「場所」）。</p>}
        <div className="stack" style={{ gap: 4 }}>
          <span className="sub">希望の曜日（選ばない＝どの曜日でも）</span>
          <fieldset className="weekday-toggles" aria-label="希望の曜日">
            {ROW_WEEKDAYS.map((w) => (
              <button
                key={w}
                type="button"
                className={`weekday-toggle${wishDays.includes(w) ? ' is-on' : ''}`}
                aria-pressed={wishDays.includes(w)}
                onClick={() => toggleDay(w)}
              >
                {WEEKDAY_LABELS[w]}
              </button>
            ))}
          </fieldset>
        </div>
        <div className="form-grid">
          <label>
            希望の開始（から）
            <select value={wishFrom} onChange={(e) => setWishFrom(e.target.value)}>
              {HALF_HOURS.map((h) => (
                <option key={h} value={h}>
                  {timeText(h)}
                </option>
              ))}
            </select>
          </label>
          <label>
            希望の開始（まで）
            <select value={wishTo} onChange={(e) => setWishTo(e.target.value)}>
              {HALF_HOURS.map((h) => (
                <option key={h} value={h}>
                  {timeText(h)}
                </option>
              ))}
            </select>
          </label>
          <label>
            週の回数
            <select value={perWeek} onChange={(e) => setPerWeek(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  週{n}回
                </option>
              ))}
            </select>
          </label>
        </div>
        {!wishOk && (
          <p className="error" role="alert">
            希望の開始は「から」を「まで」より前にしてください
          </p>
        )}
        {summary && (
          <>
            <output className="inquiry-summary" data-testid="inquiry-summary">
              {summary}
            </output>
            {result && <InquiryWeeks rows={inquiryRows(result, wish)} exact={result.exact} />}
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={copy} data-testid="copy-summary">
                <WithIcon icon={Copy}>要約をコピー</WithIcon>
              </button>
              {slots.length > 0 && (
                <button
                  type="button"
                  className="btn"
                  data-testid="hold-open"
                  onClick={() => setHold({ name: '', error: null })}
                >
                  <WithIcon icon={BookmarkPlus}>仮の{terms.client}として押さえる</WithIcon>
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="card stack" data-testid="notice-card">
        <SectionTitle icon={ClipboardList}>空き枠の案内文</SectionTitle>
        <p className="sub">
          紹介元などへ空いている枠を知らせる文を作ります。{terms.staff}の条件・場所は上の「条件」のままです。
        </p>
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end', gap: 16 }}>
          <fieldset className="segmented seg-sm" aria-label="案内する期間" data-testid="notice-period">
            {NOTICE_PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={noticePeriod === p.id}
                className={noticePeriod === p.id ? 'is-on' : ''}
                onClick={() => setNoticePeriod(p.id)}
              >
                {p.label}
              </button>
            ))}
          </fieldset>
          <label style={{ minWidth: 220 }}>
            種類
            <select value={noticeTypeId} onChange={(e) => setNoticeTypeId(e.target.value)} data-testid="notice-type">
              <option value="">種類なし（所要 {durationOk ? `${durationNum}分` : '—'}）</option>
              {data.visitTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}（{t.durationMinutes}分）
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="sub">
          {mdText(noticeSpan.from)}〜{mdText(noticeSpan.to)}
          {noticePeriod === 'fourWeeks'
            ? '：毎週続けて受けられる曜日・開始の時間を載せます'
            : '：日ごとに、受けられる開始の時間を載せます'}
          {exactPlace ? '（場所への移動を含む）' : `（目安。移動を前後${VACANCY_MARGIN_DEFAULT}分で見込む）`}
        </p>
        {noticeDuration === null && (
          <p className="error" role="alert">
            種類を選ぶか、上の条件の所要を正しく入れてください
          </p>
        )}
        {notice && (
          <>
            <output className="inquiry-summary notice-text" data-testid="notice-text">
              {notice.text}
            </output>
            {notice.noPlan.length > 0 && (
              <p className="vacancy-noplan" data-testid="notice-noplan">
                案の無い日（{notice.noPlan.length}日：{notice.noPlan.map(mdText).join('・')}）は載せていません。
                <Link to={`/month?ym=${ymOf(notice.noPlan[0]!)}`}>月間カレンダーで案を作ってください</Link>
              </p>
            )}
            <div className="row">
              <button type="button" className="btn" onClick={copyNotice} data-testid="copy-notice">
                <WithIcon icon={Copy}>案内文をコピー</WithIcon>
              </button>
            </div>
            <div className="stack notice-mail" style={{ gap: 6 }} data-testid="notice-mail">
              {referrers.length > 0 && (
                <fieldset className="notice-mail-to">
                  <legend>紹介元へメール（BCC で一斉。宛先どうしにアドレスは見えません）</legend>
                  {referrers.map((r) => {
                    const key = r.email.toLowerCase();
                    return (
                      <label key={key} className="check">
                        <input
                          type="checkbox"
                          checked={!mailOff.has(key)}
                          onChange={(e) =>
                            setMailOff((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.delete(key);
                              else next.add(key);
                              return next;
                            })
                          }
                          style={{ width: 'auto' }}
                          data-testid="notice-mail-pick"
                        />
                        {r.names.join('・') || '（名前なし）'} <span className="sub">{r.email}</span>
                      </label>
                    );
                  })}
                </fieldset>
              )}
              <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <MailButton
                  mail={noticeMail}
                  label={`紹介元へメール（BCC ${mailBcc.length}件）`}
                  why={noticeMailWhy}
                  testId="notice-mail-open"
                />
                <MailLengthNote mail={noticeMail} />
              </div>
              <MailNotice />
            </div>
          </>
        )}
      </div>

      {picked && result && (
        <SidePanel
          icon={Users}
          narrow
          title={`${WEEKDAY_LABELS[picked.weekday]} ${hm(picked.start)}〜${hm(picked.start + durationNum)}`}
          onClose={() => setPicked(null)}
          footer={
            <button type="button" className="btn" onClick={() => setPicked(null)}>
              <WithIcon icon={X}>閉じる</WithIcon>
            </button>
          }
        >
          <p>
            <strong>
              {MARK[verdictOf(picked)]} {VERDICT_TEXT[verdictOf(picked)]}
            </strong>
            <span className="sub">
              {' '}
              （{result.exact ? '移動を含む' : '目安'}・{picked.weeksOk}/{picked.weeksTotal}週）
            </span>
          </p>
          {picked.byDate.length === 0 ? (
            <p className="sub">案のある日がありません</p>
          ) : (
            <ul className="vacancy-dates" data-testid="vacancy-dates">
              {picked.byDate.map((x) => (
                <li key={x.date} className={x.staffIds.length === 0 ? 'is-ng' : ''}>
                  <strong>{dateText(x.date)}</strong>
                  {x.staffIds.length === 0 ? (
                    <span>× 入らない</span>
                  ) : (
                    <span>
                      {x.staffIds.length}人：{x.staffIds.map((id) => staffName.get(id) ?? '（不明）').join('、')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {noPlan.filter((d) => weekday(d) === picked.weekday).length > 0 && (
            <p className="sub">
              案の無い日：
              {noPlan
                .filter((d) => weekday(d) === picked.weekday)
                .map(dateText)
                .join('、')}
              （数えていません）
            </p>
          )}
        </SidePanel>
      )}

      {hold && (
        <SidePanel
          icon={BookmarkPlus}
          narrow
          title={`仮の${terms.client}として押さえる`}
          onClose={() => setHold(null)}
          footer={
            <>
              <button type="button" className="btn btn-primary" onClick={register} data-testid="hold-register">
                <WithIcon icon={BookmarkPlus}>押さえる</WithIcon>
              </button>
              <button type="button" className="btn" onClick={() => setHold(null)}>
                <WithIcon icon={X}>閉じる</WithIcon>
              </button>
              {hold.error && <span className="error">{hold.error}</span>}
            </>
          }
        >
          <label>
            表示名（必須）
            <input
              value={hold.name}
              maxLength={50}
              data-testid="hold-name"
              onChange={(e) => setHold({ ...hold, name: e.target.value, error: null })}
            />
          </label>
          <p>次の定期パターン（毎週）で、{dateText(from)}から押さえます。</p>
          <ul className="vacancy-dates">
            {slots.map((s) => (
              <li key={s.weekday}>
                <strong>
                  {WEEKDAY_LABELS[s.weekday]} {hm(s.start)}
                </strong>
                <span>
                  {vType ? `${vType.name}・` : ''}
                  {durationNum}分
                </span>
              </li>
            ))}
          </ul>
          <Hint>
            「仮」の印の{terms.client}
            として登録し、いまある訪問の最後の日までの訪問を作ります。今の案がある日は、他の人の予定を変えずに空き時間へ入れて固定します（入らない日は知らせます。予定の画面で入れてください）。確定した割当は変えません。
            {terms.client}の画面で「本登録にする」か「仮押さえを取り消す」を選べます。
            {exactPlace ? '' : ' 場所が空なので、住所・位置はあとで入れてください。'}
          </Hint>
        </SidePanel>
      )}
    </div>
  );
}
