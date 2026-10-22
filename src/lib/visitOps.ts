// 訪問の詳細の欄（pages/VisitPanel。PRD D300〜D303。ADR-0051）がデータを読む・書く薄い層。どれも純粋関数で、DemoData を書き換えない。
// 画面はこの層の越しにだけ訪問・繰り返し・担当に触る（段3でデータの形を変えたとき、画面を書き直さずにここを差し替える）。
// 書いたデータは呼ぶ側が store の update(fn) で当てる。今日・時刻（now）・新しい ID は引数で受ける（乱数・Date.now を使わない）
import type { AiPlan, DemoData } from '../contracts/data';
import { type Pattern, type Visit, type VisitType, visitSchema } from '../contracts/documents';
import type { Problem } from '../contracts/problem';
import { isOnLeave } from '../domain/leaves';
import { NONE } from '../domain/scheduleModel';
import { addDays, hhmmToMinutes, weekday } from '../domain/time';
import { score } from '../evaluate';
import { bestInsertion, compile } from '../matching';
import { prefKey } from '../matching/manualPrefs';
import { timesOn } from '../patterns';
import { candidatesFor } from '../reassign';
import { attempt, formError, formErrorField, own, WEEKDAY_LABELS } from './common';
import { isDate } from './isDate';
import { recordManualPref } from './manualPrefs';
import { mdText, patternWhenText, typeOf } from './patternText';
import { reassignItemText } from './reassignMenu';
import { alignPlan } from './runs';
import { savedVisit } from './visitEdit';
import { canMoveVisit, changedDates, moveFollowing } from './week';

// ---- 範囲（この回だけ／これ以降／すべて）----

/** 繰り返しの回を変えるときの範囲（週のドラッグの「この回だけ／これ以降」と同じ言葉。PRD D301） */
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

/** その日の担当（今の案、無ければ確定した割当）。source は数えた案 */
export type Assignment = { staffId: string | null; source: 'plan' | 'confirmed' | null; pinned: boolean };

const ownerIn = (cols: Record<string, string[]> | undefined, visitId: string): string | null => {
  if (!cols) return null;
  for (const [sid, ids] of Object.entries(cols)) if (sid !== NONE && ids.includes(visitId)) return sid;
  return null;
};

/** 訪問のその日の担当（今の案があれば今の案、無ければ確定した割当） */
export function assignmentOf(d: Pick<DemoData, 'aiPlans' | 'manualPlans'>, visitId: string, date: string): Assignment {
  const plan = own(d.aiPlans, date);
  if (plan) return { staffId: ownerIn(plan.routes, visitId), source: 'plan', pinned: !!own(plan.pins, visitId) };
  const saved = own(d.manualPlans, date);
  if (saved) return { staffId: ownerIn(saved, visitId), source: 'confirmed', pinned: false };
  return { staffId: null, source: null, pinned: false };
}

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
  assignment: Assignment;
  /** いつもの担当（パターン、無ければ〈利用者さん〉） */
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
  d: Pick<DemoData, 'visits' | 'patterns' | 'clients' | 'aiPlans' | 'manualPlans' | 'clientLeaves' | 'visitTypes'>,
  visitId: string,
  today: string,
): VisitInfo | null {
  const v = d.visits.find((x) => x.id === visitId);
  if (!v) return null;
  const pattern = v.pattern ? (d.patterns.find((p) => p.id === v.pattern!.id) ?? null) : null;
  const client = d.clients.find((c) => c.id === v.clientId);
  return {
    visit: v,
    pattern,
    patternText: pattern ? `${patternWhenText(pattern)}（${mdText(pattern.from)}から）` : null,
    assignment: assignmentOf(d, v.id, v.date),
    usualStaffId: pattern?.usualStaffId ?? client?.usualStaffId ?? null,
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
  /** この回だけ変えた・取り消した、そのままにする回の日付（範囲の中。この回は除く） */
  keptDates: string[];
};

/** 同じ繰り返しの同じ曜日の回（元の日の曜日で数える） */
const sameSeries = (v: Visit, x: Visit) =>
  !!x.pattern && x.pattern.id === v.pattern?.id && weekday(x.pattern.date) === weekday(v.pattern.date);

/** 範囲の選択肢の文（繰り返しの回でなければ null）。「これ以降」「すべて」は同じ曜日の回（週のドラッグの「以降すべて」と同じ） */
export function scopeTexts(
  d: Pick<DemoData, 'visits' | 'patterns'>,
  visitId: string,
  today: string,
): ScopeTexts | null {
  const v = d.visits.find((x) => x.id === visitId);
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
    keptDates: kept(v.pattern.date > today ? v.pattern.date : today),
  };
}

// ---- 担当の候補 ----

/** 担当の候補の1人（「担当を変える ▾」と同じ判定。lib/reassignMenu） */
export type StaffChoice = {
  staffId: string;
  /** 移動 +N分・時間の約束 ✓✗・相性・いつもの担当など（reassignItemText） */
  description: string;
  /** 選べない理由（必須の条件に合わない） */
  disabled: string | false;
  /** 空き時間に入る */
  fits: boolean;
  /** その日の今の担当 */
  current: boolean;
};

export type StaffChoices = {
  date: string;
  /** その日に今の案がある（担当を替えられるのは今の案がある日だけ） */
  hasPlan: boolean;
  /** その日の今の担当（日付を変えたら別の日なので null） */
  currentStaffId: string | null;
  choices: StaffChoice[];
  /** 候補を出せない理由（null＝出せた） */
  why: string | null;
};

/** 新しい訪問を問題に入れるときの仮の ID */
export const NEW_VISIT_ID = '__new_visit';

/** 欄の入力のまま、問題に入る訪問を作る（新しい訪問は仮の ID） */
function draftVisit(base: Visit | null, f: VisitDraft): Visit {
  const n = normalized(f);
  return {
    ...(base ?? { staffId: null, cancelled: false, cancelKind: null, pattern: null }),
    ...n,
    id: base?.id ?? NEW_VISIT_ID,
  } as Visit;
}

/** その日の問題（今の案があればその条件と、この訪問を除いた固定）と、今の列（今の案、無ければ確定した割当。この訪問は除く） */
function dayProblem(
  d: DemoData,
  visits: Visit[],
  date: string,
  visitId: string,
): { problem: Problem | null; routes: Record<string, string[]>; plan: AiPlan | undefined } {
  const plan = own(d.aiPlans, date);
  const pins = plan ? Object.fromEntries(Object.entries(plan.pins).filter(([id]) => id !== visitId)) : {};
  const input = { ...d, rules: plan ? plan.rules : d.rules, visits };
  const problem = attempt(() => compile(input, date, Object.keys(pins).length > 0 ? pins : undefined)).value;
  const ids = new Set(problem?.visits.map((v) => v.id) ?? []);
  const src = plan ? plan.routes : (own(d.manualPlans, date) ?? {});
  const routes: Record<string, string[]> = {};
  for (const [k, list] of Object.entries(src)) {
    if (k === NONE) continue;
    routes[k] = list.filter((id) => id !== visitId && ids.has(id));
  }
  return { problem, routes, plan };
}

/**
 * 欄の日時（変えていればその日時）で、担当の候補を出す（「担当を変える ▾」と同じ判定：reassign の candidatesFor と
 * matching の理由。PRD D302）。その日に働く人（稼働時間帯のある人）と今の担当だけ。選べる人を先に、選べない人は理由つきで後ろ
 */
export function staffChoices(d: DemoData, visitId: string | null, draft: VisitDraft): StaffChoices {
  const empty = (why: string, hasPlan = false): StaffChoices => ({
    date: draft.date,
    hasPlan,
    currentStaffId: null,
    choices: [],
    why,
  });
  if (!isDate(draft.date) || !/^\d{2}:\d{2}$/.test(draft.earliestStart) || !(draft.durationMinutes >= 5))
    return empty('日付・時刻・所要を入れると候補が出ます');
  if (!draft.clientId) return empty('〈利用者さん〉を選ぶと候補が出ます');
  const base = visitId ? (d.visits.find((x) => x.id === visitId) ?? null) : null;
  const moved = draftVisit(base, draft);
  const visits = base ? d.visits.map((x) => (x.id === base.id ? moved : x)) : [...d.visits, moved];
  const { problem, routes, plan } = dayProblem(d, visits, draft.date, moved.id);
  if (!problem) return empty('その日の計算ができません', !!plan);
  const vi = problem.visits.findIndex((x) => x.id === moved.id);
  if (vi < 0) return empty('計算に入らない訪問です（休み・利用中でない など）', !!plan);
  const current = base && base.date === draft.date ? assignmentOf(d, base.id, draft.date).staffId : null;
  const list = attempt(() => candidatesFor(problem, routes, moved.id)).value ?? [];
  const indexOf = (sid: string) => problem.staff.findIndex((s) => s.id === sid);
  const working = (sid: string) => (problem.staff[indexOf(sid)]?.slots.length ?? 0) > 0 || sid === current;
  const choices = list
    .filter((c) => working(c.staffId))
    .map((c): StaffChoice => {
      const si = indexOf(c.staffId);
      const allowed = problem.allowed[vi]?.[si] === true;
      const t = reassignItemText(c, problem.reasons[vi]?.[si] ?? [], allowed);
      return {
        staffId: c.staffId,
        description: t.description,
        disabled: t.disabled,
        fits: c.fits,
        current: c.staffId === current,
      };
    });
  const sorted = [...choices.filter((c) => !c.disabled), ...choices.filter((c) => c.disabled)];
  return { date: draft.date, hasPlan: !!plan, currentStaffId: current, choices: sorted, why: null };
}

// ---- 担当を当てる ----

/** 担当を当てられなかった回と理由 */
export type AssignFail = { visitId: string; date: string; why: string };

/**
 * 訪問をその日の今の案で担当に当てて固定する（日の予定の「担当を変える ▾」と同じく最も費用の少ない位置。staffId が null なら
 * 列から外して固定も外す）。今の案の無い日・その日に担当できない人（only main 以外）は当てずに failed へ。
 * force の訪問は可否を見ずに当てる（欄で選んだこの回。必須の条件に合わない人は欄で選べない）
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
  let aiPlans = d.aiPlans;
  for (const [date, ids] of byDate) {
    const plan = own(d.aiPlans, date);
    if (!plan) {
      for (const id of ids) failed.push({ visitId: id, date, why: '今の案が無い日' });
      continue;
    }
    const pins = Object.fromEntries(Object.entries(plan.pins).filter(([id]) => !ids.includes(id)));
    const problem = attempt(() =>
      compile({ ...d, rules: plan.rules }, date, Object.keys(pins).length > 0 ? pins : undefined),
    ).value;
    if (!problem) {
      for (const id of ids) failed.push({ visitId: id, date, why: 'その日の計算ができません' });
      continue;
    }
    let cur = alignPlan(problem, plan);
    let any = false;
    for (const id of ids) {
      const j = problem.visits.findIndex((v) => v.id === id);
      if (j < 0) {
        failed.push({ visitId: id, date, why: '計算に入らない訪問' });
        continue;
      }
      if (staffId === null) {
        const { [id]: _, ...rest } = cur.pins;
        const routes = Object.fromEntries(Object.entries(cur.routes).map(([s, xs]) => [s, xs.filter((x) => x !== id)]));
        cur = { ...cur, routes, pins: rest };
      } else {
        const i = problem.staff.findIndex((s) => s.id === staffId);
        if (!force.has(id) && (i < 0 || problem.allowed[j]?.[i] !== true)) {
          failed.push({ visitId: id, date, why: i < 0 ? 'その日は働かない' : 'その日は担当できない' });
          continue;
        }
        cur = { ...cur, routes: bestInsertion(problem, cur.routes, id, staffId), pins: { ...cur.pins, [id]: staffId } };
      }
      any = true;
    }
    if (!any) continue;
    const placed = new Set(Object.values(cur.routes).flat());
    cur = {
      ...cur,
      unassigned: problem.visits.map((v) => v.id).filter((id) => !placed.has(id)),
      score: score(problem, cur.routes).total,
    };
    aiPlans = { ...aiPlans, [date]: cur };
  }
  return { data: aiPlans === d.aiPlans ? d : { ...d, aiPlans }, failed };
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
      /** 担当を当てられなかった回 */
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

/**
 * 訪問を保存する（PRD D300〜D302）。
 * - 新しい訪問：単発の訪問を足す（ids.visit）。担当を選んでいればその日の今の案で当てる
 * - この回だけ（単発の訪問も）：lib/visitEdit の savedVisit（日付を変えたら手作業の担当を外す・繰り返しの回は「この回だけ変えた」）
 * - これ以降：週のドラッグの「以降すべて」と同じ lib/week の moveFollowing（同じ曜日の回を新しい曜日・時刻・所要・種類にした
 *   繰り返しに分ける。担当を選んでいれば分けた繰り返しのいつもの担当にする）。この回だけ変えた・取り消した回はそのまま
 * - すべて：今日以降で最初の同じ曜日の回から「これ以降」と同じに変える（過去は変えない）。この回がこの回だけ変えた回なら、この回も変える
 * 担当（staff）は、この回だけならこの回を、これ以降・すべてなら範囲の回を、それぞれの日の今の案で当てて固定する（今の案の無い日は
 * failed）。これ以降・すべてで担当を選んだら、手直しの記憶（ADR-0043）にも書く（作り直しても同じ人にする）
 */
export function applyVisitEdit(
  d: DemoData,
  input: EditInput,
  today: string,
  ids: { visit: string; patterns: readonly [string, string] },
  now: number,
): EditResult {
  const f = normalized(input.draft);
  if (!isDate(f.date)) return fail('日付を入れてください', 'date');
  if (!canMoveVisit(f.date, today)) return fail('今日より前の日にはできません', 'date');
  const err = checkDraft(f, input.visitId ?? ids.visit);
  if (err) return fail(err.error, err.field);

  // 新しい訪問
  if (input.visitId === null) {
    if (input.staff === null) return fail('担当なしは選べません（「変えない」のままにしてください）');
    const nv: Visit = { ...f, id: ids.visit, staffId: null, cancelled: false, cancelKind: null, pattern: null };
    let data: DemoData = { ...d, visits: [...d.visits, nv] };
    let failed: AssignFail[] = [];
    if (input.staff) {
      const r = assignOnDays(data, [{ visitId: nv.id, date: nv.date }], input.staff, new Set([nv.id]));
      data = r.data;
      failed = r.failed;
    }
    return { ok: true, data, visitId: nv.id, dates: [nv.date], unchanged: false, failed };
  }

  const v = d.visits.find((x) => x.id === input.visitId);
  if (!v) return fail('この訪問は消されています');
  if (v.cancelled) return fail('取り消した訪問です。先に「取り消しをやめる」を押してください');
  if (!canMoveVisit(v.date, today)) return fail('今日より前の訪問は変えられません');
  const p = v.pattern ? d.patterns.find((x) => x.id === v.pattern!.id) : undefined;
  const scope: VisitScope = p ? input.scope : 'once';
  const owner = assignmentOf(d, v.id, v.date).staffId;
  const staffChange = input.staff !== undefined && (input.staff !== owner || f.date !== v.date || scope !== 'once');
  if (input.staff === null && scope !== 'once') return fail('担当なしは「この回だけ」で選んでください');
  const moved = timeChanged(v, f);
  if (!moved && !staffChange && f.note === v.note && f.clientId === v.clientId)
    return { ok: true, data: d, visitId: v.id, dates: [], unchanged: true, failed: [] };

  let data = d;
  let id = v.id;
  const dates = new Set([v.date, f.date]);
  /** 担当を当てる範囲の繰り返し（これ以降・すべてで分けた繰り返しの ID） */
  let seriesId: string | null = null;
  const replace = (x: Visit) => {
    data = { ...data, visits: data.visits.map((y) => (y.id === x.id ? x : y)) };
  };

  if (scope === 'once') {
    if (moved || f.note !== v.note || f.clientId !== v.clientId) replace(savedVisit(v, f, v.id));
  } else if (moved || staffChange) {
    const delta = daysBetween(v.date, f.date);
    const target = (x: Visit) => addDays(x.pattern!.date, delta);
    const anchor =
      scope === 'all'
        ? (d.visits
            .filter((x) => sameSeries(v, x) && x.pattern!.date >= today && !x.cancelled)
            .sort((a, b) => (a.pattern!.date < b.pattern!.date ? -1 : 1))[0] ?? v)
        : v;
    const start = hhmmToMinutes(f.earliestStart);
    const r = moveFollowing(d, anchor.id, target(anchor), start, today, ids.patterns, {
      durationMinutes: f.durationMinutes,
      typeId: f.typeId,
      windowKind: f.windowKind,
      width: hhmmToMinutes(f.latestStart) - start,
      ...(input.staff ? { usualStaffId: input.staff } : {}),
    });
    if (!r)
      return fail(
        `「${SCOPE_LABELS[scope]}」ではこの日時にできません（今日より前の日になる・毎月の第N週が合わない など）。「この回だけ」で変えてください`,
      );
    data = r.data;
    for (const x of changedDates(r.change)) dates.add(x);
    if (anchor.id === v.id) id = r.movedVisitId ?? v.id;
    else if (data.visits.some((x) => x.id === v.id)) {
      // この回だけ変えた回は分けても残るので、この回も同じに変える
      const cur = data.visits.find((x) => x.id === v.id)!;
      replace(savedVisit(cur, f, cur.id));
    } else {
      const day = target(v);
      const found = [ids.patterns[1], ids.patterns[0], v.pattern!.id]
        .map((pid) => `${day}_${pid}`)
        .find((x) => data.visits.some((y) => y.id === x && !y.cancelled));
      if (!found) return fail('この回を作り直せませんでした。「この回だけ」で変えてください');
      id = found;
    }
    const after = data.visits.find((x) => x.id === id);
    seriesId = after?.pattern?.id ?? null;
    if (after && f.note !== after.note) replace({ ...after, note: f.note });
  }

  const result = data.visits.find((x) => x.id === id);
  if (!result) return fail('保存できませんでした');
  let failed: AssignFail[] = [];
  if (staffChange && input.staff !== undefined) {
    const targets =
      scope === 'once' || !seriesId
        ? [{ visitId: id, date: result.date }]
        : data.visits
            .filter(
              (x) => x.pattern?.id === seriesId && !x.cancelled && x.date >= (scope === 'all' ? today : result.date),
            )
            .map((x) => ({ visitId: x.id, date: x.date }));
    const r = assignOnDays(data, targets, input.staff, new Set([id]));
    data = r.data;
    failed = r.failed;
    for (const t of targets) if (!r.failed.some((x) => x.visitId === t.visitId)) dates.add(t.date);
    if (scope !== 'once' && input.staff)
      data = { ...data, manualPrefs: recordManualPref(data.manualPrefs, result, input.staff, now) };
  }
  return { ok: true, data, visitId: id, dates: [...dates].sort(), unchanged: false, failed };
}

/** 取り消す（PRD D74。当日キャンセルなら cancelKind 'sameDay'）。繰り返しの回は「この回だけ変えた」。今の案はそのまま（計算から外れる） */
export function cancelVisitOp(d: DemoData, visitId: string, sameDay: boolean): DemoData {
  const v = d.visits.find((x) => x.id === visitId);
  if (!v || v.cancelled) return d;
  const next: Visit = {
    ...v,
    cancelled: true,
    cancelKind: sameDay ? 'sameDay' : null,
    pattern: v.pattern ? { ...v.pattern, edited: true } : null,
  };
  return { ...d, visits: d.visits.map((x) => (x.id === visitId ? next : x)) };
}

/** 取り消しをやめる。繰り返しの回は、ほかに変えた所が無ければ「この回だけ変えた」も外す */
export function uncancelVisitOp(d: DemoData, visitId: string): DemoData {
  const v = d.visits.find((x) => x.id === visitId);
  if (!v || !v.cancelled) return d;
  const p = v.pattern ? d.patterns.find((x) => x.id === v.pattern!.id) : undefined;
  const edited = v.pattern ? (p ? occurrenceChanges(v, p, d.visitTypes).length > 0 : v.pattern.edited) : false;
  const next: Visit = {
    ...v,
    cancelled: false,
    cancelKind: null,
    pattern: v.pattern ? { ...v.pattern, edited } : null,
  };
  return { ...d, visits: d.visits.map((x) => (x.id === visitId ? next : x)) };
}

/**
 * この回の変更を戻す：繰り返しの元の日・時刻・所要・種類に戻し、「この回だけ変えた」を外す（取り消しは別の操作）。
 * 日付が変わるときは手作業の担当を外す。元の日か今の日が今日より前・パターンの回でなければそのまま
 */
export function restoreOccurrenceOp(d: DemoData, visitId: string, today: string): DemoData {
  const v = d.visits.find((x) => x.id === visitId);
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
    staffId: o.date === v.date ? v.staffId : null,
    pattern: { ...v.pattern, edited: false },
  };
  return { ...d, visits: d.visits.map((x) => (x.id === visitId ? next : x)) };
}

// ---- 一覧（欄を開く入口） ----

/** 今の案で入らない訪問（今日〜until。日付・開始の順）。ホームの要対応から欄を開く（PRD D303） */
export function unassignedVisits(
  d: Pick<DemoData, 'visits' | 'aiPlans' | 'clientLeaves'>,
  today: string,
  until: string,
): Visit[] {
  const byId = new Map(d.visits.map((v) => [v.id, v]));
  const out: Visit[] = [];
  for (const [date, plan] of Object.entries(d.aiPlans)) {
    if (date < today || date > until) continue;
    for (const id of plan.unassigned) {
      const v = byId.get(id);
      if (v && v.date === date && !v.cancelled && !isOnLeave(d.clientLeaves, v)) out.push(v);
    }
  }
  return out.sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.earliestStart < b.earliestStart ? -1 : 1,
  );
}

/** 一覧の1行（担当と印） */
export type VisitRow = {
  visit: Visit;
  staffId: string | null;
  /** unassigned＝今の案で入らない（担当なし）、noplan＝その日に案が無い */
  mark: 'unassigned' | 'noplan' | null;
};

/**
 * その日の訪問の行（ホームの今日の訪問。PRD D303）：取り消し・休みを除き、担当なし → 案なし → これからの近い順 → 済んだ時刻の順。
 * limit 件まで、残りは rest に数だけ
 */
export function dayVisitRows(
  d: Pick<DemoData, 'visits' | 'aiPlans' | 'manualPlans' | 'clientLeaves'>,
  date: string,
  nowHm: string,
  limit = 5,
): { rows: VisitRow[]; rest: number } {
  const rows = d.visits
    .filter((v) => v.date === date && !v.cancelled && !isOnLeave(d.clientLeaves, v))
    .map((v): VisitRow => {
      const a = assignmentOf(d, v.id, date);
      return {
        visit: v,
        staffId: a.staffId,
        mark: a.source === null ? 'noplan' : a.staffId === null ? 'unassigned' : null,
      };
    });
  const rank = (r: VisitRow) => (r.mark === 'unassigned' ? 0 : r.mark === 'noplan' ? 1 : 2);
  rows.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      Number(a.visit.earliestStart < nowHm) - Number(b.visit.earliestStart < nowHm) ||
      (a.visit.earliestStart < b.visit.earliestStart ? -1 : a.visit.earliestStart > b.visit.earliestStart ? 1 : 0),
  );
  return { rows: rows.slice(0, limit), rest: Math.max(0, rows.length - limit) };
}

/** 〈利用者さん〉の、その期間の訪問（取り消しも。日付・開始の順）。月の予定で〈利用者さん〉を選んだときの回（PRD D303） */
export function clientVisitsIn(d: Pick<DemoData, 'visits'>, clientId: string, from: string, to: string): Visit[] {
  return d.visits
    .filter((v) => v.clientId === clientId && v.date >= from && v.date <= to)
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.earliestStart < b.earliestStart ? -1 : 1));
}

/** 手直しの記憶のキー（画面がこの層の越しに使う） */
export const visitKey = prefKey;
