import {
  BookmarkPlus,
  CalendarSearch,
  ClipboardList,
  Copy,
  MapPin,
  MessageSquareText,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useConfirm } from '../components/ConfirmDialog';
import { ConditionsEditor } from '../components/conditions';
import { EdgeScroll } from '../components/EdgeScroll';
import { FieldError, invalidAttrs, RequiredMark } from '../components/FieldError';
import { LevelLegend } from '../components/glance';
import { MailButton, MailLengthNote, MailNotice, useMailLimit } from '../components/mailParts';
import { AddressField } from '../components/placeLookup';
import { confirmDropProposal, RangeProposalBand } from '../components/scheduleParts';
import { Term } from '../components/Term';
import { useToast } from '../components/Toast';
import { Hint, PageHeader, SidePanel, WithIcon } from '../components/ui';
import type { Client, ClientPlace, Pattern } from '../contracts/documents';
import { EMPTY_REFERRER, patternSchema } from '../contracts/documents';
import type { Condition } from '../contracts/rules';
import {
  VACANCY_DAY_END_DEFAULT,
  VACANCY_DAY_START_DEFAULT,
  VACANCY_DURATION_MAX,
  VACANCY_DURATION_MIN,
  VACANCY_MARGIN_DEFAULT,
  VACANCY_STEP_DEFAULT,
  VACANCY_WEEKS_MAX,
  VACANCY_WEEKS_MIN,
  type VacancyCell,
  type VacancyQuery,
  type VacancyRange,
  type VacancyResult,
} from '../contracts/vacancy';
import { HALF_HOURS, timeText } from '../domain/availability';
import { addDays, hhmmToMinutes, jstDate, jstHhmm, minutesToHhmm, weekday } from '../domain/time';
import { pinnedAddressAfter, toPlace } from '../lib/addressLookup';
import { copyText } from '../lib/clipboard';
import { CLIENT_COLORS } from '../lib/colors';
import { attempt, dateText, nameTaken, newId, WEEKDAY_LABELS } from '../lib/common';
import { type InquiryDayMark, type InquiryRow, inquiryDayLevel, inquiryRows, vacancyLevel } from '../lib/glance';
import { dayHref } from '../lib/links';
import { referrerRecipients, vacancySubject } from '../lib/mail';
import { buildBccMails } from '../lib/mailto';
import { ymOf } from '../lib/month';
import { missingDays, monthBatch, monthsLabel } from '../lib/monthBatch';
import { mdText, typeOf } from '../lib/patternText';
import { normalizePostalCode } from '../lib/postalCode';
import { scrollLeftToShow } from '../lib/scrollEdge';
import { useFeature } from '../lib/useFeature';
import { COMPACT_QUERY, useMedia } from '../lib/useMedia';
import { loadVacancyInput, saveVacancyInput } from '../lib/vacancyInput';
import {
  answerCard,
  cellFace,
  markLegend,
  NARROW_FIRST_START,
  NO_TYPE_TEXT,
  noticeLine,
  placeLine,
  VACANCY_MARK,
  VACANCY_MARK_TEXT,
  whenWhatLine,
} from '../lib/vacancyView';
import { useValueStore } from '../lib/valueStore';
import { insertAllIntoPlans, weekStart } from '../lib/week';
import { visitsIn } from '../patterns';
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

const MARK = VACANCY_MARK;
const VERDICT_TEXT = VACANCY_MARK_TEXT;

/** 畳む欄の「開く ▾」「畳む ▴」（見た目だけ。読み上げの名前に入れない。開いているかは details が伝える） */
function FoldMark() {
  return (
    <span className="vacancy-fold-mark" aria-hidden="true">
      <span className="when-closed">開く ▾</span>
      <span className="when-open">畳む ▴</span>
    </span>
  );
}

/** 段階の番号の丸（PRD D184。読み上げは見出しの文に「1.」を入れる） */
function StepNo({ n }: { n: number }) {
  return (
    <span className="vacancy-step-no">
      {n}
      <span className="sr-only">.</span>
    </span>
  );
}

const hm = (t: number) => timeText(minutesToHhmm(t));

/** 空き状況の表の凡例（PRD D78。どの週でも受けられる人数の段階） */
const VACANCY_LEGEND: [string, string][] = [
  ['none', '0人（受けられない）'],
  ['partial', '0人の週がある'],
  ['one', '1人'],
  ['two', '2人'],
  ['three', '3人'],
  ['many', '4人以上'],
  ['unknown', '数えられない'],
];

/** 案の無い日の注意に並べる日付の数（それより多ければ「ほか N日」） */
const NOPLAN_SHOWN = 6;

const DAY_MARK: Record<InquiryDayMark, string> = { ok: '○', ng: '×', unknown: '？' };
const DAY_TEXT: Record<InquiryDayMark, string> = {
  ok: '受けられる',
  ng: '受けられない',
  unknown: '数えられない日',
};

/**
 * 問い合わせの試算の週ごとのマス（PRD D79）：希望の曜日×週。マスは ○×？ とその日の一番多い人数、色は空き状況の表と同じ。
 * 行の頭にその曜日の判定（○△×？）
 */
function InquiryWeeks({ rows, exact }: { rows: InquiryRow[]; exact: boolean }) {
  if (rows.every((r) => r.days.length === 0)) return null;
  // 読み方は表の凡例（1か所。PRD D258）
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
    </div>
  );
}

/** 仮押さえで担当を入れる日数（今日から。それより後の回は繰り返しの担当で出る） */
const HOLD_DAYS = 28;

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
  const noticeOn = useFeature('vacancyNotice');
  const mailOn = useFeature('mail');
  /** 段階・紹介元（ADR-0028 の clientStage）：切なら紹介元の名前・メールアドレスの一覧と BCC のメールを出さない（データは残す） */
  const stageOn = useFeature('clientStage');
  const toast = useToast();
  const confirmDialog = useConfirm();
  const today = jstDate(Date.now());

  /** 入力はタブの間だけ覚える（sessionStorage。ほかの画面へ移って戻っても残り、閉じれば消える。PRD D258） */
  const [saved] = useState(() => loadVacancyInput(today, new Set(data.visitTypes.map((t) => t.id))));
  // 条件の欄
  const [typeId, setTypeId] = useState(saved.typeId);
  const [duration, setDuration] = useState(saved.duration);
  const [requirements, setRequirements] = useState<Condition[]>(saved.requirements);
  // 場所（データには保存しない一時の入力。郵便番号は住所を探すためと、仮押さえで〈利用者さん〉に写すため。PRD D118〜D121）
  // pinnedAddress はピンを置いたときの住所（見出し・試算に使う。住所を打っても置き直すまで変えない。PRD D119）
  const [place, setPlace] = useState<ClientPlace & { pinnedAddress: string }>(saved.place);
  const [weeks, setWeeks] = useState(saved.weeks);
  const [from, setFrom] = useState(saved.from);
  // 問い合わせの試算
  const [wishDays, setWishDays] = useState<number[]>(saved.wishDays);
  const [wishFrom, setWishFrom] = useState(saved.wishFrom);
  const [wishTo, setWishTo] = useState(saved.wishTo);
  const [perWeek, setPerWeek] = useState(saved.perWeek);
  // 欄
  const [picked, setPicked] = useState<VacancyCell | null>(null);
  /** 仮押さえの欄（nameBad：誤りが表示名の欄のもの。PRD D250） */
  const [hold, setHold] = useState<{ name: string; error: string | null; nameBad?: boolean } | null>(null);
  /** 入力の誤りの文の id（入力欄の aria-describedby。PRD D250） */
  const durationErrId = useId();
  const fromErrId = useId();
  const wishErrId = useId();
  const holdErrId = useId();

  const durationNum = Number(duration);
  const durationOk =
    Number.isInteger(durationNum) && durationNum >= VACANCY_DURATION_MIN && durationNum <= VACANCY_DURATION_MAX;
  const fromOk = /^\d{4}-\d{2}-\d{2}$/.test(from);
  // 試算に渡すのはピンの位置と、置いたときの住所だけ（契約の Place）。郵便番号・住所を打っても計算し直さない
  const exactPlace = useMemo(
    () =>
      place.lat !== null && place.lng !== null
        ? { address: place.pinnedAddress, lat: place.lat, lng: place.lng }
        : null,
    [place.pinnedAddress, place.lat, place.lng],
  );

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
  /**
   * 狭い画面では、表がはじめに出たとき 9:00 の列が曜日の列のすぐ右に来るまで横に巻く（PRD D221）。
   * 表が出ているあいだは1回だけ（条件を変えても人が巻いた位置のまま）。表が消えたら（入る時刻が無い・計算できない）箱も消えて
   * 7:00 に戻るので、次に表が出たときにまた巻く
   */
  const narrow = useMedia(COMPACT_QUERY);
  const gridRef = useRef<HTMLDivElement>(null);
  const gridScrolled = useRef(false);
  const hasGrid = !!result && result.times.length > 0;
  useLayoutEffect(() => {
    if (!hasGrid) {
      gridScrolled.current = false;
      return;
    }
    const box = gridRef.current;
    if (!narrow || !box || gridScrolled.current) return;
    const target = box.querySelector<HTMLElement>(`thead th[data-start="${NARROW_FIRST_START}"]`);
    if (!target) return;
    gridScrolled.current = true;
    const left = box.getBoundingClientRect().left;
    const corner = box.querySelector<HTMLElement>('thead th.vacancy-corner');
    const stickyRight = corner ? corner.getBoundingClientRect().right - left : 0;
    box.scrollLeft = scrollLeftToShow(box, target.getBoundingClientRect().left - left, stickyRight);
  }, [narrow, hasGrid]);

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

  // 空き枠の案内文（PRD D67。ADR-0013）：期間・種類を選ぶ。所要は種類の標準（種類の指定なしは上の条件の所要）、
  // 〈スタッフ〉の条件・場所は上の条件のまま。条件を変えると 300ms 間引いて計算し直す
  const [noticePeriod, setNoticePeriod] = useState<NoticePeriod>(saved.noticePeriod);
  const [noticeTypeId, setNoticeTypeId] = useState(saved.noticeTypeId);
  // 入力を覚える（PRD D258）
  useEffect(() => {
    saveVacancyInput({
      typeId,
      duration,
      requirements,
      place,
      weeks,
      from,
      wishDays,
      wishFrom,
      wishTo,
      perWeek,
      noticePeriod,
      noticeTypeId,
    });
  }, [
    typeId,
    duration,
    requirements,
    place,
    weeks,
    from,
    wishDays,
    wishFrom,
    wishTo,
    perWeek,
    noticePeriod,
    noticeTypeId,
  ]);
  const noticeType = typeOf(data.visitTypes, noticeTypeId);
  const noticeDuration = noticeType ? noticeType.durationMinutes : durationOk ? durationNum : null;
  const noticeSpan = useMemo(() => noticeRange(noticePeriod, today), [noticePeriod, today]);
  /**
   * 案内文を作る元の条件（変わるたびに新しい物）。作った文にはこれを付けておき、今の条件と違えば古い文として
   * コピー・メールを押せなくする（描いた時点で決まるので、計算し直すまでの間にも古い文で動かない。PR #44 のレビュー）
   */
  const noticeInputs = useMemo(
    () => ({ data, noticeType, noticeDuration, requirements, exactPlace, noticeSpan, noticePeriod, terms }),
    [data, noticeType, noticeDuration, requirements, exactPlace, noticeSpan, noticePeriod, terms],
  );
  const [notice, setNotice] = useState<{ text: string; noPlan: string[]; inputs: typeof noticeInputs } | null>(null);
  /** 案内文の欄を開いているか（畳んでいる間は計算しない。問い合わせの即答の速さを落とさない。PRD D185） */
  const [noticeOpen, setNoticeOpen] = useState(false);
  /** 条件を変えてから案内文を計算し直すまで（古い文でコピー・メールさせない。PR #44 のレビュー） */
  const noticeStale = notice === null || notice.inputs !== noticeInputs;
  // 紹介元へ BCC で一斉に（PRD D95。ADR-0017）：宛先は紹介元のメールを重複なく。外した宛先（小文字）だけを画面の中で持つ
  const referrers = useMemo(() => referrerRecipients(data.clients), [data.clients]);
  const [mailOff, setMailOff] = useState<ReadonlySet<string>>(new Set());
  const mailBcc = referrers.filter((r) => !mailOff.has(r.email.toLowerCase())).map((r) => r.email);
  const mailLimit = useMailLimit();
  // 宛先が多いと mailto が長すぎるので、目安の長さに収まるよう宛先を分けて複数のボタンにする（PRD D95・D96）
  const noticeMails =
    notice && !noticeStale && mailBcc.length > 0
      ? buildBccMails({ bcc: mailBcc, subject: vacancySubject(data.org), full: notice.text }, mailLimit)
      : [];
  const copyRecipients = async () =>
    toast(
      (await copyText(mailBcc.join(', ')))
        ? `宛先（${mailBcc.length}件）をコピーしました。メールの BCC に貼り付けてください`
        : 'コピーできませんでした。文を選んでコピーしてください',
    );
  const noticeMailWhy = noticeStale
    ? '案内文を計算し直しています'
    : referrers.length === 0
      ? `紹介元のメールアドレスが未登録です（${terms.client}の画面の「紹介元のメールアドレス」で入れられます）`
      : '宛先を1つ以上選んでください';
  useEffect(() => {
    const { data, noticeType, noticeDuration, requirements, exactPlace, noticeSpan, noticePeriod, terms } =
      noticeInputs;
    // 畳んだら古い文を捨てる（開き直したときに前の文を出さない）
    if (!noticeOpen) {
      setNotice(null);
      return;
    }
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
      setNotice({ text, noPlan, inputs: noticeInputs });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [noticeOpen, noticeInputs]);
  const copyNotice = async () => {
    if (!notice || noticeStale) return;
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

  /**
   * 仮押さえ：〈利用者さん〉（仮）と繰り返しを1回の update で入れ、今日から4週の回を空き時間に入れて（lib/week の insertAllIntoPlans）、
   * いちばん多く入った人を繰り返しの担当にする（版2。それより後の回はその担当で出る）
   */
  const register = () => {
    if (!hold || !query) return;
    const name = hold.name.trim();
    if (!name) {
      setHold({ ...hold, error: '表示名を入れてください', nameBad: true });
      return;
    }
    if (nameTaken(data.clients, (x) => x.displayName, name)) {
      setHold({
        ...hold,
        error: `「${name}」と同じ名前の${terms.client}がいます。名前を変えてください`,
        nameBad: true,
      });
      return;
    }
    if (slots.length === 0) return;
    const client: Client = {
      id: newId('c'),
      displayName: name,
      kana: '',
      // 郵便番号は7桁にできれば写す（できなければ空）
      place: { ...toPlace(place), postalCode: normalizePostalCode(place.postalCode) ?? '' },
      note: '問い合わせの試算から仮押さえ',
      color: data.clients.length % CLIENT_COLORS.length,
      active: true,
      traits: {},
      requirements,
      preferences: [],
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
        setHold({ ...hold, error: '定期パターンを作れませんでした。条件を確かめてください', nameBad: false });
        return;
      }
      patterns.push(r.data);
    }
    // 今日から4週の回を空き時間に入れてピン（lib/week の insertIntoPlan。入らない日は知らせる）。いちばん多く入った人を繰り返しの担当に
    const build = (d: typeof data) => {
      const clients = [...d.clients, client];
      const next = { ...d, clients, patterns: [...d.patterns, ...patterns] };
      const ids = new Set(patterns.map((p) => p.id));
      const added = visitsIn(next, { from: today, to: addDays(today, HOLD_DAYS - 1) })
        .filter((v) => v.pattern && ids.has(v.pattern.id))
        .map((v) => ({ visitId: v.id, date: v.date }));
      const r = insertAllIntoPlans(next, added);
      const count = new Map<string, Map<string, number>>();
      for (const v of r.data.visits) {
        if (!v.pattern || !ids.has(v.pattern.id) || !v.staffId) continue;
        const m = count.get(v.pattern.id) ?? new Map<string, number>();
        m.set(v.staffId, (m.get(v.staffId) ?? 0) + 1);
        count.set(v.pattern.id, m);
      }
      const best = (pid: string) => {
        const m = count.get(pid);
        if (!m) return null;
        return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
      };
      const out = {
        ...r.data,
        patterns: r.data.patterns.map((p) => (ids.has(p.id) ? { ...p, usualStaffId: best(p.id) } : p)),
      };
      return { added: added.length, ...r, data: out };
    };
    // 知らせの件数はいまのデータで数える（update の中の関数はあとで呼ばれることがある）
    const r = build(data);
    update((d) => build(d).data, '仮押さえ');
    setHold(null);
    const into = r.inserted > 0 ? `・担当を ${r.inserted}件入れました` : '';
    const miss =
      r.failedDates.length > 0
        ? `。${r.failedDates.length}日（${r.failedDates.map(mdText).join('・')}）は空き時間に入りません`
        : '';
    toast(`仮押さえしました（${name}・4週の訪問 ${r.added}件${into}）${miss}`);
  };

  const noPlan = result?.noPlanDates ?? [];
  /** 答えのカード（PRD D258） */
  const answer = result && wishOk ? answerCard(result, wish) : null;
  /** 担当の足りない日（範囲の今日以降の、担当なしの訪問がある・伝えていない日。PRD D259） */
  const rangeKey = result ? result.dates.join(',') : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: 範囲は日付の並び（rangeKey）で見る
  const missing = useMemo(() => (result ? missingDays(data, result.dates, today) : []), [data, rangeKey, today]);
  /** 月まとめ作成の進み具合（作っている間は押せない。PRD D256） */
  const batchRun = useValueStore(monthBatch.run);
  const making = batchRun !== null;
  /** 作っている間のボタンの文（月の予定から始めた作成は「（月の予定）」で分ける） */
  const makingText = batchRun
    ? `${batchRun.label}の担当を組んでいます${batchRun.source === 'month' ? '（月の予定）' : batchRun.source === 'week' || batchRun.source === 'day' ? '（週の予定）' : '…'}`
    : '';
  /** 答えのカード（足りない案を作り終えてボタンが消えたとき、フォーカスをここへ） */
  const answerRef = useRef<HTMLDivElement>(null);
  /** ［足りない案を作る］にフォーカスがあるか */
  const makeFocused = useRef(false);
  useEffect(() => {
    if (missing.length > 0 || !makeFocused.current) return;
    makeFocused.current = false;
    answerRef.current?.focus({ preventScroll: true });
  }, [missing.length]);
  /** 担当の足りない日を、その場で AI で組む（月の「担当を AI で組む」の仕組み。ほかの画面へ移っても続く。ADR-0042） */
  const makeMissing = async () => {
    if (missing.length === 0 || making) return;
    // 当てていない提案があれば、捨ててよいか確かめる（提案は1つだけ）
    if (!(await confirmDropProposal(confirmDialog)) || monthBatch.running()) return;
    const ok = monthBatch.start({
      ym: ymOf(missing[0]!.date),
      label: monthsLabel(missing.map((x) => x.date)),
      mode: 'care',
      days: missing,
      today,
      source: 'vacancy',
    });
    if (!ok) toast('ほかの担当を組んでいます。終わってから押してください');
  };
  // 段階の要約の行（PRD D184・D185）
  const placeSummary = placeLine(
    { address: place.address, pinnedAddress: place.pinnedAddress, hasPin: exactPlace !== null },
    VACANCY_MARGIN_DEFAULT,
  );
  const whenLine = whenWhatLine({
    durationOk,
    wishOk,
    typeName: vType?.name ?? null,
    duration,
    weekdayLabels: ROW_WEEKDAYS.filter((w) => wishDays.includes(w)).map((w) => WEEKDAY_LABELS[w]!),
    from: timeText(wishFrom),
    to: timeText(wishTo),
    perWeek,
    startMd: fromOk ? mdText(from) : '—',
    weeks,
  });

  return (
    <div className="stack vacancy-page">
      <PageHeader
        icon={CalendarSearch}
        title="空き状況"
        lead={`いつ・何をを入れると、受けられる曜日・時間帯と${terms.staff}の人数がすぐに出ます。場所はあとから足せます`}
      />

      {/* 1 いつ・何を（PRD D184）。入れるとすぐ下の結果が変わる（自動で計算し直すので主ボタンは無い） */}
      <section className="card stack vacancy-stage" data-testid="vacancy-step-when">
        <div className="section-title">
          <h2>
            <StepNo n={1} />
            いつ・何を
          </h2>
        </div>
        <div className="form-grid">
          <label>
            種類
            <select
              value={typeId}
              data-testid="vacancy-type"
              onChange={(e) => {
                const t = typeOf(data.visitTypes, e.target.value);
                setTypeId(e.target.value);
                // 種類を選ぶと所要の初期値をその種類の標準の所要にする
                if (t) setDuration(String(t.durationMinutes));
              }}
            >
              <option value="">{NO_TYPE_TEXT}</option>
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
              {...invalidAttrs(!durationOk, durationErrId)}
              data-testid="vacancy-duration"
              onChange={(e) => setDuration(e.target.value)}
            />
          </label>
          <label>
            希望の開始（から）
            <select
              value={wishFrom}
              {...invalidAttrs(!wishOk, wishErrId)}
              onChange={(e) => setWishFrom(e.target.value)}
              data-testid="wish-from"
            >
              {HALF_HOURS.map((h) => (
                <option key={h} value={h}>
                  {timeText(h)}
                </option>
              ))}
            </select>
          </label>
          <label>
            希望の開始（まで）
            <select
              value={wishTo}
              {...invalidAttrs(!wishOk, wishErrId)}
              onChange={(e) => setWishTo(e.target.value)}
              data-testid="wish-to"
            >
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
          <label>
            開始日
            <input
              type="date"
              value={from}
              {...invalidAttrs(!fromOk, fromErrId)}
              onChange={(e) => setFrom(e.target.value)}
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
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <span className="sub">希望の曜日（選ばない＝どの曜日でも）</span>
          <fieldset className="weekday-toggles" aria-label="希望の曜日" data-testid="wish-days">
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
        <FieldError id={durationErrId} live={false}>
          {!durationOk && `所要は${VACANCY_DURATION_MIN}〜${VACANCY_DURATION_MAX}分で入れてください`}
        </FieldError>
        <FieldError id={fromErrId} live={false}>
          {!fromOk && '開始日を入れてください'}
        </FieldError>
        <FieldError id={wishErrId} live={false}>
          {!wishOk && '希望の開始は「から」を「まで」より前にしてください'}
        </FieldError>
        <details className="vacancy-more">
          <summary>
            {terms.staff}の条件
            {requirements.length > 0 ? `（${requirements.length}件）` : '（問わない）'}
          </summary>
          <Hint>例：性別が女性。種類の「担当に必要な条件」は、ここで選ばなくても入ります。</Hint>
          <ConditionsEditor items={data.items} target="staff" value={requirements} onChange={setRequirements} />
        </details>
      </section>

      {/*
        2 場所（任意。PRD D184・D185）：はじめは畳んで要約の行だけ。開くと郵便番号・住所・地図。
        畳んでも中の入力・ピンは残す（details の中に置いたまま。閉じても消さない）
      */}
      <details className="card vacancy-stage vacancy-place-stage" data-testid="vacancy-step-place">
        <summary data-testid="vacancy-place-toggle">
          <h2 className="vacancy-stage-head">
            <StepNo n={2} />
            <WithIcon icon={MapPin} size={16}>
              場所（任意）
            </WithIcon>
          </h2>
          <span className={`vacancy-stage-line${placeSummary.set ? ' is-set' : ''}`} data-testid="vacancy-place-line">
            {placeSummary.text}
          </span>
          <FoldMark />
        </summary>
        <div className="stack vacancy-place">
          <span className="sub">
            郵便番号・住所から探して置くか、地図に点を置くと、その場所への移動を含めて正確に数えます（すぐ下の結果が変わります）。空のときは移動を前後
            {VACANCY_MARGIN_DEFAULT}分で見込んだ目安です。
          </span>
          <AddressField
            value={place}
            onChange={(p) =>
              setPlace((cur) => ({ ...p, postalCode: cur.postalCode, pinnedAddress: pinnedAddressAfter(cur, p) }))
            }
            postalCode={place.postalCode}
            onPostalCodeChange={(postalCode) => setPlace((cur) => ({ ...cur, postalCode }))}
            testId="vacancy"
            noticeNote="（押したときだけ。条件などほかの項目は送りません）"
          />
        </div>
      </details>

      {/* 3 受けられる曜日・時間帯（PRD D184・D187）：要約・週ごとのマス・曜日×開始時刻の表 */}
      <section className="card stack vacancy-stage" data-testid="vacancy-table-card">
        <div className="section-title">
          <h2>
            <StepNo n={3} />
            受けられる曜日・時間帯（
            {result?.exact
              ? `${exactPlace?.address.trim() || '選んだ場所'}への移動を含む`
              : `目安。移動を前後${VACANCY_MARGIN_DEFAULT}分で見込む`}
            ）
          </h2>
          {busy && (
            <div className="section-aside">
              <span className="sub">計算しています…</span>
            </div>
          )}
        </div>
        <p className="sub vacancy-when-line" data-testid="vacancy-when-line">
          {whenLine}
        </p>
        {/* 答え（PRD D258）：結果の1枚目のカード。受けられるか・曜日と開始の時間・人数 */}
        {answer && (
          // 条件を変えると答えが変わるので読み上げる（role="status"）
          // biome-ignore lint/a11y/useSemanticElements: 中に段落があるので output ではなく div
          <div
            ref={answerRef}
            tabIndex={-1}
            role="status"
            className={`vacancy-answer is-${answer.tone}`}
            data-testid="vacancy-answer"
            data-tone={answer.tone}
          >
            <p className="vacancy-answer-main">
              <strong className="vacancy-answer-head">{answer.head}</strong>
              {answer.body && <span className="vacancy-answer-body">：{answer.body}</span>}
            </p>
            <p className="sub vacancy-answer-note">{answer.note}</p>
          </div>
        )}
        {/* 数えなかった日・担当なしの訪問がある日の注意はここ1か所（PRD D176）。その場で担当を組む（PRD D259） */}
        {(noPlan.length > 0 || missing.length > 0) && (
          <div className="vacancy-noplan" data-testid="vacancy-noplan">
            <p>
              {noPlan.length > 0 ? (
                <>
                  計算できなかった日（{noPlan.length}日：{noPlan.slice(0, NOPLAN_SHOWN).map(mdText).join('・')}
                  {noPlan.length > NOPLAN_SHOWN ? ` ほか${noPlan.length - NOPLAN_SHOWN}日` : ''}
                  ）は数えていません（表は「？」、案内文にも載せません）。
                </>
              ) : null}
              {missing.length > 0
                ? `担当なしの訪問がある日が${missing.length}日あります（担当を組むと、空きが減ることがあります）。`
                : ''}
            </p>
            {missing.length > 0 ? (
              <button
                type="button"
                className="btn btn-small"
                onClick={() => void makeMissing()}
                // 作っている間も押せる見た目を変えるだけ（disabled にするとフォーカスを失う）
                aria-disabled={making || undefined}
                onFocus={() => {
                  makeFocused.current = true;
                }}
                onBlur={(e) => {
                  // 消えるときは blur が来ないことがあるので、ほかへ移ったときだけ下ろす
                  if (e.relatedTarget) makeFocused.current = false;
                }}
                data-testid="vacancy-noplan-make"
                data-count={missing.length}
              >
                <WithIcon icon={Sparkles} size={14}>
                  {making ? makingText : `担当なしを AI で組む（${missing.length}日）`}
                </WithIcon>
              </button>
            ) : (
              // 今日より前の日だけ・確定した日だけのときは、月の予定で見る
              <Link
                className="btn btn-small btn-text"
                to={`/month?ym=${ymOf(noPlan[0]!)}`}
                data-testid="vacancy-noplan-month"
              >
                {Number(noPlan[0]!.slice(5, 7))}月の予定を見る
              </Link>
            )}
          </div>
        )}
        {/* 組んだ提案（日・週・月の予定と同じ帯。当てると担当が変わり、空きの数え直しに入る。PRD D328） */}
        <RangeProposalBand />
        {summary && (
          <>
            <h3 className="vacancy-sub-title">答える文（下の「要約をコピー」でコピー）</h3>
            <output className="inquiry-summary" data-testid="inquiry-summary">
              {summary}
            </output>
            {result && <InquiryWeeks rows={inquiryRows(result, wish)} exact={result.exact} />}
          </>
        )}
        <h3 className="vacancy-sub-title">曜日・開始時刻ごとの表</h3>
        {/* 凡例はここ1か所（PRD D258）：印（○△×？）・色（人数の段階）・数字の読み方。週ごとのマスも同じ印と色 */}
        <div className="vacancy-legend-box" data-testid="vacancy-legend">
          <ul className="vacancy-legend" data-testid="vacancy-mark-legend" aria-label="マスの読み方">
            {markLegend(!!result?.exact).map((x) => (
              <li key={x.verdict} className="vacancy-legend-item">
                <span className={`vacancy-legend-face is-${x.verdict}`} aria-hidden="true">
                  <b>{x.mark}</b>
                  {x.sample && <small>{x.sample}</small>}
                </span>
                <span>
                  <span className="sr-only">{x.mark}：</span>
                  {x.text}
                </span>
              </li>
            ))}
          </ul>
          <LevelLegend items={VACANCY_LEGEND} />
          <p className="sub vacancy-legend-note">
            ○ の数字は
            <Term k="vacancyCount" testId="term-vacancy-count" />
            {result?.exact ? (
              ''
            ) : (
              <>
                （場所が無いので
                <Term k="vacancyEstimate" testId="term-vacancy-estimate" />）
              </>
            )}
            。色はどの週でも受けられる人数の段階です。上の週ごとのマスも同じ印と色で、行の頭はその曜日に一番良い開始時刻です。マスを押すと日付ごとの人を見られます。
            {vType && ` 種類「${vType.name}」の担当に必要な条件を満たす人だけを数えます。`}
          </p>
        </div>
        {result && result.times.length === 0 && <p className="sub">所要が長すぎて、入る時刻がありません</p>}
        {result && result.times.length > 0 && (
          <EdgeScroll className="vacancy-scroll" scrollRef={gridRef}>
            <table className="vacancy-grid" data-testid="vacancy-grid">
              <caption className="sr-only">
                曜日と開始時刻ごとの、受けられる{terms.staff}の人数（○ どの週も受けられる・△ 受けられない週がある・×
                受けられない・？ 数えられない日）
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="vacancy-corner">
                    曜日＼開始
                  </th>
                  {result.times.map((t) => (
                    <th key={t} scope="col" className={t % 60 === 0 ? 'is-hour' : ''} data-start={minutesToHhmm(t)}>
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
                      const f = cellFace(c, result.exact, `${WEEKDAY_LABELS[wd]} ${hm(t)}から`);
                      return (
                        <td key={t}>
                          <button
                            type="button"
                            className={`vacancy-cell is-${f.verdict} lv-${vacancyLevel(c)}${picked === c ? ' is-picked' : ''}`}
                            data-testid="vacancy-cell"
                            data-weekday={wd}
                            data-start={minutesToHhmm(t)}
                            data-verdict={f.verdict}
                            aria-label={f.label}
                            title={f.label}
                            onClick={() => setPicked(c)}
                          >
                            <span className="vacancy-mark" aria-hidden="true">
                              {f.mark}
                            </span>
                            <span className="vacancy-count" aria-hidden="true">
                              {f.sub}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </EdgeScroll>
        )}
      </section>

      {/*
        4 次の一手（PRD D184・D186）：この問い合わせに答える（要約をコピー＝この段階の主ボタン・仮押さえ）と、
        空き枠を広く知らせる（案内文・コピー・紹介元へメール。はじめは畳む）
      */}
      <section className="card stack vacancy-stage" data-testid="vacancy-step-next">
        <div className="section-title">
          <h2>
            <StepNo n={4} />
            次の一手
          </h2>
        </div>
        <div className="stack vacancy-next" data-testid="inquiry-card">
          <h3 className="vacancy-sub-title">
            <WithIcon icon={MessageSquareText} size={16}>
              この問い合わせに答える
            </WithIcon>
          </h3>
          {summary ? (
            <>
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
              {slots.length === 0 && (
                <p className="sub" data-testid="hold-why">
                  仮押さえは、希望の曜日・時間帯に、どの週も受けられる（○）開始時刻が週{perWeek}回分あるときにできます。
                </p>
              )}
              {!exactPlace && <p className="sub">場所を入れると、移動を含めて答えられます（上の「2 場所」）。</p>}
            </>
          ) : (
            <p className="sub">上の「1 いつ・何を」を直すと、要約と仮押さえが出ます。</p>
          )}
        </div>

        {/* 空き枠の案内文（ADR-0028 の vacancyNotice）を切っていれば欄ごと出さない。メールを切っていれば紹介元へのメールを出さない */}
        {noticeOn && (
          <details
            className="vacancy-notice"
            data-testid="notice-card"
            onToggle={(e) => setNoticeOpen((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary data-testid="notice-toggle">
              <h3 className="vacancy-sub-title">
                <WithIcon icon={ClipboardList} size={16}>
                  {mailOn ? '空き枠の案内文・紹介元へメール' : '空き枠の案内文'}
                </WithIcon>
              </h3>
              <span className="vacancy-stage-line" data-testid="notice-line">
                {noticeLine(
                  NOTICE_PERIODS.find((p) => p.id === noticePeriod)?.label ?? '',
                  noticeType?.name ?? null,
                  noticeDuration,
                )}
              </span>
              <FoldMark />
            </summary>
            <div className="stack">
              <p className="sub">
                紹介元などへ空いている枠を知らせる文を作ります。{terms.staff}の条件・場所は上の「1 いつ・何を」「2
                場所」のままです。
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
                  <select
                    value={noticeTypeId}
                    onChange={(e) => setNoticeTypeId(e.target.value)}
                    data-testid="notice-type"
                  >
                    <option value="">
                      {NO_TYPE_TEXT}（所要 {durationOk ? `${durationNum}分` : '—'}）
                    </option>
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
              <FieldError live={false}>
                {noticeDuration === null && '種類を選ぶか、上の「1 いつ・何を」の所要を正しく入れてください'}
              </FieldError>
              {notice && (
                <>
                  <output className="inquiry-summary notice-text" data-testid="notice-text">
                    {notice.text}
                  </output>
                  {notice.noPlan.length > 0 && (
                    <p className="sub" data-testid="notice-noplan">
                      計算できなかった日（{notice.noPlan.length}日）は載せていません（上の表の注意）。
                    </p>
                  )}
                  <div className="row">
                    <button
                      type="button"
                      className="btn"
                      onClick={copyNotice}
                      disabled={noticeStale}
                      data-testid="copy-notice"
                    >
                      <WithIcon icon={Copy}>案内文をコピー</WithIcon>
                    </button>
                  </div>
                  {mailOn && stageOn && (
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
                        {noticeMails.length === 0 ? (
                          <MailButton
                            mail={null}
                            label="紹介元へメール（BCC）"
                            why={noticeMailWhy}
                            testId="notice-mail-open"
                          />
                        ) : (
                          noticeMails.map((g, i) => (
                            <span key={g.bcc[0]} className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                              <MailButton
                                mail={g.mail}
                                label={`紹介元へメール（${noticeMails.length > 1 ? `${i + 1}/${noticeMails.length}・` : ''}BCC ${g.bcc.length}件）`}
                                why={noticeMailWhy}
                                testId="notice-mail-open"
                              />
                              <MailLengthNote mail={g.mail} />
                            </span>
                          ))
                        )}
                        {mailBcc.length > 0 && (
                          <button
                            type="button"
                            className="btn btn-small"
                            onClick={() => void copyRecipients()}
                            data-testid="notice-mail-copy-to"
                          >
                            <WithIcon icon={Copy} size={14}>
                              宛先をコピー
                            </WithIcon>
                          </button>
                        )}
                      </div>
                      {noticeMails.length > 1 && (
                        <p className="sub" data-testid="notice-mail-split">
                          宛先が多いので、メールアプリに渡せる長さに収まるよう {noticeMails.length}{' '}
                          通に分けました。順に押してください。
                        </p>
                      )}
                      <MailNotice />
                    </div>
                  )}
                </>
              )}
            </div>
          </details>
        )}
      </section>

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
            <p className="sub">数えられる日がありません</p>
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
                  {/* その日の案を日の画面で（PRD D204。名前の吹き出しは付けない：D124）。Link なので Ctrl+クリック・中クリックで
                      新しいタブにも開ける。ふつうに押すと同じタブで移る（日の予定が ?date= を読む） */}
                  <Link
                    to={dayHref(x.date)}
                    className="vacancy-day-open"
                    aria-label={`その日の予定を見る（${dateText(x.date)}・日の予定で開く）`}
                    data-testid="vacancy-day-open"
                    data-date={x.date}
                  >
                    その日の予定を見る
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {noPlan.some((d) => weekday(d) === picked.weekday) && (
            <p className="sub">計算できなかった日は数えていません（表の上の注意）。</p>
          )}
        </SidePanel>
      )}

      {hold && (
        <SidePanel
          icon={BookmarkPlus}
          narrow
          title={`仮の${terms.client}として押さえる`}
          onClose={() => setHold(null)}
          onSubmit={register}
          footer={
            <>
              <button type="submit" className="btn btn-primary" data-testid="hold-register">
                <WithIcon icon={BookmarkPlus}>押さえる</WithIcon>
              </button>
              <button type="button" className="btn" onClick={() => setHold(null)}>
                <WithIcon icon={X}>閉じる</WithIcon>
              </button>
              <FieldError as="span" id={holdErrId} token={hold.error ? hold : null}>
                {hold.error}
              </FieldError>
            </>
          }
        >
          <label>
            <span>
              表示名
              <RequiredMark />
            </span>
            <input
              value={hold.name}
              maxLength={50}
              required
              {...invalidAttrs(!!hold.error && !!hold.nameBad, holdErrId)}
              data-testid="hold-name"
              onChange={(e) => setHold({ ...hold, name: e.target.value, error: null, nameBad: false })}
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
            として登録し、繰り返しを足します。先4週の回は、ほかの人の予定を変えずに空き時間へ入れます。入らない回は担当なしになるので、日の予定で入れてください。
            あとで{terms.client}の画面で「本登録にする」か「仮押さえを取り消す」を選べます。
            {exactPlace
              ? ''
              : place.address.trim() !== ''
                ? ' 位置はあとで入れてください。'
                : ' 場所が空なので、住所・位置はあとで入れてください。'}
          </Hint>
        </SidePanel>
      )}
    </div>
  );
}
