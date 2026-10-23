// 訪問の詳細の欄（components/VisitPanel。PRD D301〜D304。ADR-0051）がデータを読む・書く薄い層。どれも純粋関数で、DemoData を書き換えない。
// 画面はこの層の越しにだけ訪問・繰り返し・担当に触る。版2（ADR-0053）：担当・開始・ピンは訪問が持ち、繰り返しの回は見るときに計算する
// （patterns の visitsOn・findVisit）。変えた回だけを保存した回に書く（putVisits）。
// 書いたデータは呼ぶ側が store の update(fn) で反映する。今日・時刻（now）・新しい ID は引数で受ける（乱数・Date.now を使わない）
import type { DemoData } from '../contracts/data';
import { type Pattern, type Visit, type VisitType, visitSchema } from '../contracts/documents';
import { isOnLeave } from '../domain/leaves';
import { addDays, hhmmToMinutes, weekday } from '../domain/time';
import { bestInsertion, compile } from '../matching';
import { findVisit, keepsOccurrence, putVisits, timesOn, visitsIn, visitsOn } from '../patterns';
import { attempt, formError, formErrorField, WEEKDAY_LABELS } from './common';
import { dayProblemOf, pinsOf, routesOf, settleDay, unassignedOf, writeRoutes } from './dayPlan';
import { isDate } from './isDate';
import { mdText, patternWhenText, typeOf } from './patternText';
import { type ReassignChoice, reassignChoices, workingStaff } from './reassignMenu';
import { savedVisit } from './visitEdit';
import { canMoveVisit, moveFollowing } from './week';

// ---- 範囲（この回だけ／これ以降／すべて）----

/** 繰り返しの回を変えるときの範囲（週のドラッグの「この回だけ／これ以降」と同じ言葉。PRD D302） */
export type VisitScope = 'once' | 'following' | 'all';
export const SCOPE_LABELS: Record<VisitScope, string> = { once: 'この回だけ', following: 'これ以降', all: 'すべて' };

// ---- 欄の入力 ----

/** 欄で決める訪問の中身（日時・所要・種類・メモ。新しい訪問は〈利用者さん〉も） */
export type VisitDraft = Pick<
  Visit,
  'clientId' | 'date' | 'windowKind' | 'earliestStart' | 'latestStart' | 'durationMinutes' | 'typeId' | 'note'
>;

/** 今の訪問の中身 */
export function draftOf(v: Visit): VisitDraft {
  return {
    clientId: v.clientId,
    date: v.date,
    windowKind: v.windowKind,
    earliestStart: v.earliestStart,
    latestStart: v.latestStart,
    durationMinutes: v.durationMinutes,
    typeId: v.typeId ?? null,
    note: v.note,
  };
}

/** 新しい訪問の初期値（〈利用者さん〉は渡したもの、無ければ利用中の先頭。開始は 09:00、所要は 60分） */
export function newDraft(d: Pick<DemoData, 'clients'>, date: string, clientId?: string, start = '09:00'): VisitDraft {
  return {
    clientId: clientId ?? d.clients.find((c) => c.active)?.id ?? '',
    date,
    windowKind: 'fixed',
    earliestStart: start,
    latestStart: start,
    durationMinutes: 60,
    typeId: null,
    note: '',
  };
}

/** 日時・所要・種類・時間の約束のどれかが違う（メモ・〈利用者さん〉は数えない） */
export function timeChanged(v: Visit, f: VisitDraft): boolean {
  return (
    f.date !== v.date ||
    f.windowKind !== v.windowKind ||
    f.earliestStart !== v.earliestStart ||
    (f.windowKind === 'window' ? f.latestStart : f.earliestStart) !== v.latestStart ||
    f.durationMinutes !== v.durationMinutes ||
    (f.typeId ?? null) !== (v.typeId ?? null)
  );
}

/** 時間の約束が「決まっている」なら開始（遅）＝開始（早）にそろえる */
const normalized = (f: VisitDraft): VisitDraft =>
  f.windowKind === 'fixed' ? { ...f, latestStart: f.earliestStart } : f;

// ---- 読む ----

/** パターンのその回の元の形（日付は元の日） */
function occurrenceOf(p: Pattern, date: string): VisitDraft & { date: string } {
  const t = timesOn(p, weekday(date));
  return {
    clientId: p.clientId,
    date,
    windowKind: p.windowKind,
    earliestStart: t.earliestStart,
    latestStart: t.latestStart,
    durationMinutes: p.durationMinutes,
    typeId: p.typeId,
    note: '',
  };
}

/**
 * この回の変更（繰り返しの元の形との違い）の文。例「日付 10/28→10/29」「時刻 14:30→15:00」「所要 60分→90分」「種類 介護→なし」。
 * パターンの回でない・パターンが無ければ空
 */
export function occurrenceChanges(v: Visit, p: Pattern | null | undefined, types: readonly VisitType[]): string[] {
  if (!v.pattern || !p) return [];
  const o = occurrenceOf(p, v.pattern.date);
  const out: string[] = [];
  if (v.date !== o.date) out.push(`日付 ${mdText(o.date)}→${mdText(v.date)}`);
  const t = (x: Pick<Visit, 'windowKind' | 'earliestStart' | 'latestStart'>) =>
    x.windowKind === 'window' ? `${x.earliestStart}〜${x.latestStart}` : x.earliestStart;
  if (t(v) !== t(o)) out.push(`時刻 ${t(o)}→${t(v)}`);
  if (v.durationMinutes !== o.durationMinutes) out.push(`所要 ${o.durationMinutes}分→${v.durationMinutes}分`);
  if ((v.typeId ?? null) !== (o.typeId ?? null)) {
    const name = (id: string | null) => typeOf(types, id)?.name ?? 'なし';
    out.push(`種類 ${name(o.typeId)}→${name(v.typeId ?? null)}`);
  }
  return out;
}

/** 欄の上に出す訪問の情報 */
export type VisitInfo = {
  visit: Visit;
  /** 元の繰り返し（定期パターン。単発・消えたパターンは null） */
  pattern: Pattern | null;
  /** 「月〜金 14:30（10/22から）」（繰り返しの回だけ） */
  patternText: string | null;
  /** 担当とピン（取り消した訪問は担当なし） */
  assignment: { staffId: string | null; pinned: boolean };
  /** 繰り返しの担当（いつもの担当。単発の訪問は null） */
  usualStaffId: string | null;
  /** この回の変更（occurrenceChanges） */
  changes: string[];
  /** 〈利用者さん〉の休みのため無しの回 */
  onLeave: boolean;
  /** 変えられる（今日以降の日。今日より前の訪問は見るだけ） */
  editable: boolean;
};

/** 訪問の情報（無ければ null） */
export function visitInfo(
  d: Pick<DemoData, 'visits' | 'patterns' | 'clients' | 'clientLeaves' | 'visitTypes'>,
  visitId: string,
  today: string,
): VisitInfo | null {
  const v = findVisit(d, visitId);
  if (!v) return null;
  const pattern = v.pattern ? (d.patterns.find((p) => p.id === v.pattern!.id) ?? null) : null;
  return {
    visit: v,
    pattern,
    patternText: pattern ? `${patternWhenText(pattern)}（${mdText(pattern.from)}から）` : null,
    assignment: { staffId: v.cancelled ? null : v.staffId, pinned: v.pinned },
    usualStaffId: pattern?.usualStaffId ?? null,
    changes: occurrenceChanges(v, pattern, d.visitTypes),
    onLeave: isOnLeave(d.clientLeaves, v),
    editable: canMoveVisit(v.date, today),
  };
}

// ---- 範囲の文 ----

/** 範囲の選択肢の文と、そのままにする回 */
export type ScopeTexts = {
  following: string;
  all: string;
  /** 曜日が2つ以上の繰り返し（ほかの曜日の回は変えない） */
  otherDays: boolean;
  /** この回だけ変えた・取り消した、そのままにする回の日付（範囲ごと。この回は除く） */
  keptDates: { following: string[]; all: string[] };
};

/** 同じ繰り返しの同じ曜日の回（元の日の曜日で数える） */
const sameSeries = (v: Visit, x: Visit) =>
  !!x.pattern && x.pattern.id === v.pattern?.id && weekday(x.pattern.date) === weekday(v.pattern.date);

/** 範囲の選択肢の文（繰り返しの回でなければ null）。「これ以降」「すべて」は同じ曜日の回（週のドラッグの「以降すべて」と同じ） */
export function scopeTexts(
  d: Pick<DemoData, 'visits' | 'patterns' | 'clients'>,
  visitId: string,
  today: string,
): ScopeTexts | null {
  const v = findVisit(d, visitId);
  const p = v?.pattern ? d.patterns.find((x) => x.id === v.pattern!.id) : undefined;
  if (!v?.pattern || !p) return null;
  const wd = WEEKDAY_LABELS[weekday(v.pattern.date)];
  const kept = (since: string) =>
    d.visits
      .filter(
        (x) => x.id !== v.id && sameSeries(v, x) && (x.cancelled || x.pattern!.edited) && x.pattern!.date >= since,
      )
      .map((x) => x.date)
      .sort();
  return {
    following: `${mdText(v.date)} 以降の${wd}曜の回`,
    all: `今日以降の${wd}曜の回すべて`,
    otherDays: p.weekdays.length > 1,
    keptDates: { following: kept(v.pattern.date > today ? v.pattern.date : today), all: kept(today) },
  };
}

// ---- 担当の候補 ----

/** 担当の候補の1人（「担当を変える ▾」と同じ判定。lib/reassignMenu の reassignChoices） */
export type StaffChoice = ReassignChoice;

export type StaffChoices = {
  date: string;
  /** その日の今の担当（日付を変えたら別の日なので null） */
  currentStaffId: string | null;
  choices: StaffChoice[];
  /** 候補を出せない理由（null＝出せた） */
  why: string | null;
};

/** 新しい訪問を問題に入れるときの仮の ID */
export const NEW_VISIT_ID = '__new_visit';

/** 欄の入力のまま、問題に入る訪問を作る（新しい訪問は仮の ID・担当なし） */
function draftVisit(base: Visit | null, f: VisitDraft): Visit {
  const n = normalized(f);
  return {
    ...(base ?? { staffId: null, start: null, pinned: false, cancelled: false, cancelKind: null, pattern: null }),
    ...n,
    start: null,
    id: base?.id ?? NEW_VISIT_ID,
  } as Visit;
}

/**
 * 欄の日時（変えていればその日時）で、担当の候補を出す（「担当を変える ▾」と同じ関数 reassignChoices。PRD D303）。
 * 問題は日の予定と同じ作り方（データの条件・ピンなし）。列はその日の担当の並びからこの訪問を除いたもの。
 * 出す人はその日に働く人（稼働時間帯がある・列に訪問がある。workingStaff）と今の担当。選べる人を先に、選べない人は理由つきで後ろ
 */
export function staffChoices(d: DemoData, visitId: string | null, draft: VisitDraft): StaffChoices {
  const empty = (why: string): StaffChoices => ({ date: draft.date, currentStaffId: null, choices: [], why });
  if (!isDate(draft.date) || !/^\d{2}:\d{2}$/.test(draft.earliestStart) || !(draft.durationMinutes >= 5))
    return empty('日付・時刻・所要を入れると候補が出ます');
  if (!draft.clientId) return empty('〈利用者さん〉を選ぶと候補が出ます');
  const base = visitId ? findVisit(d, visitId) : null;
  const moved = draftVisit(base, draft);
  const input = { ...d, visits: putVisits(d.visits, [moved]) };
  const problem = attempt(() => compile(input, draft.date)).value;
  if (!problem) return empty('その日の計算ができません');
  if (!problem.visits.some((x) => x.id === moved.id)) return empty('計算に入らない訪問です（休み・利用中でない など）');
  const all = routesOf(
    problem,
    visitsOn(input, draft.date).filter((x) => x.id !== moved.id),
  );
  const current = base && base.date === draft.date && !base.cancelled ? base.staffId : null;
  const working = workingStaff(problem, all);
  const choices = reassignChoices(problem, all, moved.id, current, (sid) => working.has(sid));
  return { date: draft.date, currentStaffId: current, choices, why: null };
}

/**
 * 選んだ担当がその入力の日時で選べるか（保存の前に計算し直す。日付を変えたあとに前の日の候補が残っていても割り当てない）。
 * staff：undefined＝変えない（いつも可）、null＝担当なし（今の担当があるときだけ）、ID＝候補にあって選べる人。誤りの文か null
 */
export function staffPickError(
  d: DemoData,
  visitId: string | null,
  draft: VisitDraft,
  staff: string | null | undefined,
): string | null {
  if (staff === undefined) return null;
  const c = staffChoices(d, visitId, draft);
  if (staff === null) {
    return c.currentStaffId !== null ? null : '担当なしは、今の担当がいる回の「この回だけ」で選べます';
  }
  if (c.why) return `担当を選べません（${c.why}）`;
  const x = c.choices.find((y) => y.staffId === staff);
  if (!x) return '選んだ担当は、この日時では候補にいません。担当を選び直してください';
  if (x.disabled) return `選んだ担当は、この日時では選べません（${x.disabled}）`;
  return null;
}

// ---- 担当を割り当てる ----

/** 担当を割り当てられなかった回と理由 */
export type AssignFail = { visitId: string; date: string; why: string };

/**
 * 訪問をその日の担当の並びで担当に割り当ててピンにする（日の予定の「担当を変える ▾」と同じく最も費用の少ない位置。staffId が null なら
 * 担当なしにしてピンも外す）。その日に担当できない人（force 以外）は割り当てずに failed へ。
 * force の訪問は可否を見ずに割り当てる（欄で選んだこの回。保存の前に staffPickError で選べることを見る）。問題にいない人はいつも failed
 */
export function assignOnDays(
  d: DemoData,
  items: readonly { visitId: string; date: string }[],
  staffId: string | null,
  force: ReadonlySet<string> = new Set(),
): { data: DemoData; failed: AssignFail[] } {
  const failed: AssignFail[] = [];
  const byDate = new Map<string, string[]>();
  for (const x of items) byDate.set(x.date, [...(byDate.get(x.date) ?? []), x.visitId]);
  let data = d;
  for (const [date, ids] of byDate) {
    const visits = visitsOn(data, date);
    const pins = pinsOf(visits.filter((v) => !ids.includes(v.id)));
    const problem = dayProblemOf(data, date, Object.keys(pins).length > 0 ? pins : undefined);
    if (!problem) {
      for (const id of ids) failed.push({ visitId: id, date, why: 'その日の計算ができません' });
      continue;
    }
    let routes = routesOf(problem, visits);
    const nextPins = { ...pins };
    let any = false;
    for (const id of ids) {
      const j = problem.visits.findIndex((v) => v.id === id);
      if (j < 0) {
        failed.push({ visitId: id, date, why: '計算に入らない訪問' });
        continue;
      }
      if (staffId === null) {
        routes = Object.fromEntries(Object.entries(routes).map(([s, xs]) => [s, xs.filter((x) => x !== id)]));
        delete nextPins[id];
      } else {
        const i = problem.staff.findIndex((s) => s.id === staffId);
        // force（欄で選んだこの回。選べるかは staffPickError で見た）でも、その日に問題にいない人は割り当てない
        if (i < 0 || (!force.has(id) && problem.allowed[j]?.[i] !== true)) {
          failed.push({ visitId: id, date, why: i < 0 ? 'その日は働かない' : 'その日は担当できない' });
          continue;
        }
        routes = bestInsertion(problem, routes, id, staffId);
        nextPins[id] = staffId;
      }
      any = true;
    }
    if (any) data = writeRoutes(data, date, problem, routes, { pins: nextPins });
  }
  return { data, failed };
}

// ---- 書く ----

/** 保存の入力。staff：undefined＝変えない、null＝担当なし（この回だけ）、ID＝その人 */
export type EditInput = {
  visitId: string | null;
  draft: VisitDraft;
  staff?: string | null;
  scope: VisitScope;
};

export type EditResult =
  | {
      ok: true;
      data: DemoData;
      /** 保存した訪問の ID（これ以降・すべてで回を作り直すと変わる） */
      visitId: string;
      /** 訪問が出入り・変わった日（日付の順） */
      dates: string[];
      /** 何も変えていない */
      unchanged: boolean;
      /** 担当を割り当てられなかった回 */
      failed: AssignFail[];
    }
  | { ok: false; error: string; field?: keyof VisitDraft };

const fail = (error: string, field?: keyof VisitDraft): EditResult => ({ ok: false, error, field });

/** 入力の検査（契約 visitSchema と時刻の前後）。誤りがあれば文と欄 */
function checkDraft(f: VisitDraft, id: string): { error: string; field?: keyof VisitDraft } | null {
  try {
    const v = visitSchema.parse({
      ...normalized(f),
      id,
      staffId: null,
      start: null,
      pinned: false,
      cancelled: false,
      cancelKind: null,
      pattern: null,
    });
    if (!f.clientId) return { error: '〈利用者さん〉を選んでください', field: 'clientId' };
    if (v.latestStart < v.earliestStart)
      return { error: '「最も遅い開始時刻」は「最も早い開始時刻」より後にしてください', field: 'latestStart' };
    return null;
  } catch (e) {
    const k = formErrorField(e);
    return {
      error: k === 'durationMinutes' ? '所要時間は5〜720分の整数で入れてください' : formError(e),
      field: k && k in f ? (k as keyof VisitDraft) : undefined,
    };
  }
}

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** 日を整える（開始を書き直す）。今日より前の日・同じ日は1回だけ */
function settleDates(d: DemoData, dates: Iterable<string>, today: string): DemoData {
  let out = d;
  for (const date of new Set(dates)) if (date >= today) out = settleDay(out, date);
  return out;
}

/**
 * 訪問を保存する（PRD D301〜D303。版2：ADR-0053）。
 * - 新しい訪問：単発の訪問を足す（ids.visit）。担当を選んでいればその日の担当の並びに入れてピンにする
 * - この回だけ（単発の訪問も）：lib/visitEdit の savedVisit（担当はそのまま・繰り返しの回は「この回だけ変えた」）
 * - これ以降：週のドラッグの「これ以降」と同じ lib/week の moveFollowing（同じ曜日の回を新しい曜日・時刻・所要・種類にした
 *   繰り返しに分ける。担当を選んでいれば分けた繰り返しの担当にする。回は見るときに計算するので、範囲の回はその担当になる）。
 *   この回だけ変えた・取り消した回はそのまま
 * - すべて：今日以降で最初の同じ曜日の回から「これ以降」と同じに変える（過去は変えない）
 * 担当（staff）は、この回だけならこの回を、その日の担当の並びに入れてピンにする。時刻を変えた日は開始を書き直す（settleDay）
 */
export function applyVisitEdit(
  d: DemoData,
  input: EditInput,
  today: string,
  ids: { visit: string; patterns: readonly [string, string] },
  _now?: number,
): EditResult {
  const f = normalized(input.draft);
  if (!isDate(f.date)) return fail('日付を入れてください', 'date');
  if (!canMoveVisit(f.date, today)) return fail('今日より前の日にはできません', 'date');
  const err = checkDraft(f, input.visitId ?? ids.visit);
  if (err) return fail(err.error, err.field);
  // 選んだ担当を今の入力の日時で確かめ直す（前の日時の候補で割り当てない）
  const pickErr = staffPickError(d, input.visitId, input.draft, input.staff);
  if (pickErr) return fail(pickErr);

  // 新しい訪問
  if (input.visitId === null) {
    if (input.staff === null) return fail('担当なしは選べません（「変えない」のままにしてください）');
    const nv: Visit = {
      ...f,
      id: ids.visit,
      staffId: null,
      start: null,
      pinned: false,
      cancelled: false,
      cancelKind: null,
      pattern: null,
    };
    let data: DemoData = { ...d, visits: [...d.visits, nv] };
    let failed: AssignFail[] = [];
    if (input.staff) {
      const r = assignOnDays(data, [{ visitId: nv.id, date: nv.date }], input.staff, new Set([nv.id]));
      data = r.data;
      failed = r.failed;
    }
    return { ok: true, data, visitId: nv.id, dates: [nv.date], unchanged: false, failed };
  }

  const v = findVisit(d, input.visitId);
  if (!v) return fail('この訪問は消されています');
  // 今ある訪問の〈利用者さん〉は変えない（変えるなら取り消して足し直す。欄にも出さない）
  const fc = { ...f, clientId: v.clientId };
  if (v.cancelled) return fail('取り消した訪問です。先に「取り消しをやめる」を押してください');
  if (!canMoveVisit(v.date, today)) return fail('今日より前の訪問は変えられません');
  const p = v.pattern ? d.patterns.find((x) => x.id === v.pattern!.id) : undefined;
  const scope: VisitScope = p ? input.scope : 'once';
  const owner = v.staffId;
  const staffChange = input.staff !== undefined && (input.staff !== owner || fc.date !== v.date || scope !== 'once');
  if (input.staff === null && scope !== 'once') return fail('担当なしは「この回だけ」で選んでください');
  const moved = timeChanged(v, fc);
  if (!moved && !staffChange && fc.note === v.note)
    return { ok: true, data: d, visitId: v.id, dates: [], unchanged: true, failed: [] };
  // 時刻も担当も変えない（メモだけ）なら、範囲にかかわらずこの回だけ
  const range: VisitScope = moved || staffChange ? scope : 'once';

  let data = d;
  let id = v.id;
  const dates = new Set([v.date, fc.date]);
  const put = (x: Visit) => {
    data = { ...data, visits: putVisits(data.visits, [x]) };
  };

  if (range === 'once') {
    if (moved || fc.note !== v.note) put(savedVisit(v, fc, v.id));
  } else {
    // すべて：今日以降で最初の、この回だけ変えていない・取り消していない同じ曜日の回から。差は元の日から欄の日付まで
    const firstPlain = range === 'all' ? firstPlainOccurrence(d, v, p!, today) : undefined;
    const anchor = firstPlain ?? v;
    const delta = daysBetween(v.pattern!.date, fc.date);
    const target = (x: Visit) => (x.id === v.id ? fc.date : addDays(x.pattern!.date, delta));
    const start = hhmmToMinutes(fc.earliestStart);
    const r = moveFollowing(d, anchor.id, target(anchor), start, today, ids.patterns, {
      durationMinutes: fc.durationMinutes,
      typeId: fc.typeId,
      windowKind: fc.windowKind,
      width: hhmmToMinutes(fc.latestStart) - start,
      ...(input.staff ? { usualStaffId: input.staff } : {}),
    });
    if (!r)
      return fail(
        `「${SCOPE_LABELS[range]}」ではこの日時にできません（今日より前の日になる・毎月の第N週が合わない など）。「この回だけ」で変えてください`,
      );
    data = r.data;
    for (const x of r.change.removed) dates.add(x.date);
    if (anchor.id === v.id) id = r.movedVisitId ?? v.id;
    else {
      const cur = data.visits.find((x) => x.id === v.id);
      if (cur) {
        // この回だけ変えた回は分けても残るので、この回も同じに変える
        put(savedVisit(cur, fc, cur.id));
      } else {
        const day = target(v);
        const found = [ids.patterns[1], ids.patterns[0], v.pattern!.id]
          .map((pid) => findVisit(data, `${day}_${pid}`))
          .find((x) => !!x && !x.cancelled);
        if (!found) return fail('この回を作り直せませんでした。「この回だけ」で変えてください');
        id = found.id;
      }
    }
    const after = findVisit(data, id);
    if (after && fc.note !== after.note)
      put({ ...after, note: fc.note, pattern: after.pattern ? { ...after.pattern, edited: true } : null });
  }

  const result = findVisit(data, id);
  if (!result) return fail('保存できませんでした');
  let failed: AssignFail[] = [];
  if (staffChange && input.staff !== undefined && range === 'once') {
    const r = assignOnDays(data, [{ visitId: id, date: result.date }], input.staff, new Set([id]));
    data = r.data;
    failed = r.failed;
  }
  data = settleDates(data, dates, today);
  return { ok: true, data, visitId: id, dates: [...dates].sort(), unchanged: false, failed };
}

/** 今日以降で最初の、この回だけ変えていない・取り消していない同じ曜日の回（保存した回と計算した回から） */
function firstPlainOccurrence(d: DemoData, v: Visit, p: Pattern, today: string): Visit | undefined {
  const wd = weekday(v.pattern!.date);
  for (let date = today, i = 0; i < 400; i++, date = addDays(date, 1)) {
    if (weekday(date) !== wd) continue;
    const x = findVisit(d, `${date}_${p.id}`);
    if (x?.pattern && !x.cancelled && !x.pattern.edited) return x;
    if (p.to !== null && date > p.to) return undefined;
  }
  return undefined;
}

/** 取り消す（PRD D74。当日キャンセルなら cancelKind 'sameDay'）。繰り返しの回は「この回だけ変えた」。ピンは外す */
export function cancelVisitOp(d: DemoData, visitId: string, sameDay: boolean): DemoData {
  const v = findVisit(d, visitId);
  if (!v || v.cancelled) return d;
  const next: Visit = {
    ...v,
    cancelled: true,
    cancelKind: sameDay ? 'sameDay' : null,
    pinned: false,
    pattern: v.pattern ? { ...v.pattern, edited: true } : null,
  };
  return { ...d, visits: putVisits(d.visits, [next]) };
}

/** 取り消しをやめる。繰り返しの回は、ほかに変えた所が無ければ「この回だけ変えた」も外す。担当はそのまま（その日の並びに戻る） */
export function uncancelVisitOp(d: DemoData, visitId: string): DemoData {
  const v = findVisit(d, visitId);
  if (!v || !v.cancelled) return d;
  const p = v.pattern ? d.patterns.find((x) => x.id === v.pattern!.id) : undefined;
  const edited = v.pattern ? (p ? occurrenceChanges(v, p, d.visitTypes).length > 0 : v.pattern.edited) : false;
  const next: Visit = {
    ...v,
    cancelled: false,
    cancelKind: null,
    pattern: v.pattern ? { ...v.pattern, edited } : null,
  };
  return { ...d, visits: putVisits(d.visits, [next]) };
}

/**
 * この回の変更を戻す：繰り返しの元の日・時刻・所要・種類に戻し、「この回だけ変えた」を外す（取り消しは別の操作）。
 * 担当はそのまま。元の日か今の日が今日より前・パターンの回でなければそのまま。両方の日の開始を書き直す
 */
export function restoreOccurrenceOp(d: DemoData, visitId: string, today: string): DemoData {
  const v = findVisit(d, visitId);
  const p = v?.pattern ? d.patterns.find((x) => x.id === v.pattern!.id) : undefined;
  if (!v?.pattern || !p || v.cancelled) return d;
  if (!canMoveVisit(v.date, today) || !canMoveVisit(v.pattern.date, today)) return d;
  const o = occurrenceOf(p, v.pattern.date);
  const next: Visit = {
    ...v,
    date: o.date,
    windowKind: o.windowKind,
    earliestStart: o.earliestStart,
    latestStart: o.latestStart,
    durationMinutes: o.durationMinutes,
    typeId: o.typeId,
    start: null,
    pattern: { ...v.pattern, edited: false },
  };
  return settleDates({ ...d, visits: putVisits(d.visits, [next]) }, [v.date, o.date], today);
}

// ---- 一覧（欄を開く入口） ----

/** 担当なしの訪問（今日〜until。日付・開始の順）。ホームの要対応から欄を開く（PRD D304） */
export function unassignedVisits(d: DemoData, today: string, until: string): Visit[] {
  const out: Visit[] = [];
  for (let date = today; date <= until; date = addDays(date, 1)) {
    const p = dayProblemOf(d, date);
    if (!p || p.visits.length === 0) continue;
    const visits = visitsOn(d, date);
    const ids = new Set(unassignedOf(p, routesOf(p, visits)));
    for (const v of visits) if (ids.has(v.id)) out.push(v);
  }
  return out;
}

/** 一覧の1行（担当と印） */
export type VisitRow = {
  visit: Visit;
  staffId: string | null;
  /** unassigned＝担当なし */
  mark: 'unassigned' | null;
};

/**
 * その日の訪問の行（ホームの今日の訪問。PRD D304）：取り消し・休みを除き、担当なし → これからの近い順 → 済んだ時刻の順。
 * limit 件まで、残りは rest に数だけ
 */
export function dayVisitRows(
  d: Pick<DemoData, 'visits' | 'patterns' | 'clients' | 'clientLeaves'>,
  date: string,
  nowHm: string,
  limit = 5,
): { rows: VisitRow[]; rest: number } {
  const rows = visitsOn(d, date)
    .filter((v) => !v.cancelled && !isOnLeave(d.clientLeaves, v))
    .map((v): VisitRow => ({ visit: v, staffId: v.staffId, mark: v.staffId === null ? 'unassigned' : null }));
  const rank = (r: VisitRow) => (r.mark === 'unassigned' ? 0 : 1);
  const at = (v: Visit) => v.start ?? v.earliestStart;
  rows.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      Number(at(a.visit) < nowHm) - Number(at(b.visit) < nowHm) ||
      (at(a.visit) < at(b.visit) ? -1 : at(a.visit) > at(b.visit) ? 1 : 0),
  );
  return { rows: rows.slice(0, limit), rest: Math.max(0, rows.length - limit) };
}

/** 〈利用者さん〉の、その期間の訪問（取り消しも。日付・開始の順）。〈利用者さん〉の画面の予定（PRD D304） */
export function clientVisitsIn(
  d: Pick<DemoData, 'visits' | 'patterns' | 'clients'>,
  clientId: string,
  from: string,
  to: string,
): Visit[] {
  return visitsIn(d, { from, to }).filter((v) => v.clientId === clientId);
}

/**
 * 〈スタッフ〉が担当している、その期間の訪問（訪問の担当がその人。取り消しを除く。日付・開始の順）。
 * 〈スタッフ〉の画面の予定のカレンダー（PRD D309）
 */
export function staffVisitsIn(
  d: Pick<DemoData, 'visits' | 'patterns' | 'clients'>,
  staffId: string,
  from: string,
  to: string,
): Visit[] {
  return visitsIn(d, { from, to }).filter((v) => v.staffId === staffId && !v.cancelled);
}

/** 繰り返しを終わらせた結果（消す保存した回の数と、伝えた日のうち回が無くなる日の数） */
export type EndPatternResult = { data: DemoData; removed: number; confirmedDays: number };

/**
 * 繰り返しを last の日で終わらせる（PRD D308）：終了日を last にし（今の終了日のほうが早ければそのまま）、last より後で今日以降の、
 * この回だけ変えていない・取り消していない保存した回を消す（この回だけ変えた・取り消した回と、今日より前の回は残す）。
 * last が開始日・昨日より前なら、開始日か昨日の遅いほうにそろえる（今日より前の回を消さない）。confirmedDays は伝えた日のうち、この繰り返しの回が無くなる日の数
 */
export function endPatternOp(d: DemoData, patternId: string, last: string, today: string): EndPatternResult {
  const p = d.patterns.find((x) => x.id === patternId);
  if (!p) return { data: d, removed: 0, confirmedDays: 0 };
  // 今日より前の回は消さない（版2は繰り返しの回を計算するので、終了日を昨日より前にしない）
  const yesterday = addDays(today, -1);
  const floor = p.from > yesterday ? p.from : yesterday;
  const end = last < floor ? floor : last;
  const to = p.to !== null && p.to < end ? p.to : end;
  // この回だけ変えた・取り消した回とピンの回は残す（removePattern と同じ）
  const gone = d.visits.filter(
    (v) => v.pattern?.id === patternId && v.date > to && v.date >= today && !keepsOccurrence(v),
  );
  const goneIds = new Set(gone.map((v) => v.id));
  const confirmedDays = Object.values(d.snapshots).filter(
    (s) => s.date > to && s.date >= today && s.visits.some((x) => x.id === `${s.date}_${patternId}`),
  ).length;
  return {
    data: {
      ...d,
      patterns: d.patterns.map((x) => (x.id === patternId ? { ...x, to } : x)),
      visits: goneIds.size > 0 ? d.visits.filter((v) => !goneIds.has(v.id)) : d.visits,
    },
    removed: gone.length,
    confirmedDays,
  };
}

/** 日の訪問の見比べる形（ID・日時・所要・種類・担当・取り消し） */
const dayKey = (vs: readonly Visit[]) =>
  JSON.stringify(
    vs.map((v) => [v.id, v.earliestStart, v.latestStart, v.durationMinutes, v.typeId, v.staffId, v.cancelled]),
  );

/**
 * 変える前と後で訪問が変わる、確定（伝えた）した今日以降の日（日付の順）。繰り返しの回は見るときに計算するので、
 * 「これ以降」「すべて」で繰り返しを分けたときは保存した回だけでなく計算した回でも比べる（訪問の詳細の欄・範囲を選び直す帯の確かめ）
 */
export function toldDaysChanged(before: DemoData, after: DemoData, today: string): string[] {
  return Object.keys(before.snapshots)
    .filter((d) => d >= today)
    .sort()
    .filter((d) => dayKey(visitsOn(before, d)) !== dayKey(visitsOn(after, d)));
}
