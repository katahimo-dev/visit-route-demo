// 「欠勤・キャンセル」の欄（PRD D167〜D172。ADR-0025 追記・ADR-0011・ADR-0015）の段階・選択肢・文を決める純粋関数。
// 計算（振り直し）は足さない：見込みは absenceParts の previewOf（targetsOf と案A）、振り直しは日の画面の今の仕組みを呼ぶだけ。データは書き換えない
import type { Absence } from '../contracts/documents';
import type { ReassignDiff, ReassignTarget } from '../contracts/reassign';
import { type Slot, slotsText } from '../domain/availability';
import { absenceError, absenceText } from './absences';

/** 何が起きたか：〈スタッフ〉が休む／〈利用者さん〉がキャンセル */
export type SuddenKind = 'staff' | 'client';
/** 段階（1：何が起きたか 2：人・訪問を選ぶ 3：影響の確認と振り直し 4：選んで確定 5：連絡。PRD D243） */
export type SuddenStep = 1 | 2 | 3 | 4 | 5;

/** URL の `?do=` で欄を開く値（ホームの「急な欠勤・キャンセルを登録」。PRD D172） */
export const SUDDEN_DO = 'absence';

/** 段階の短い名前（欄の上の1行の段階の表示。種類を選ぶ前は〈スタッフ〉の流れの名前で出す） */
export function suddenSteps(kind: SuddenKind | null): [string, string, string, string, string] {
  if (kind === 'client') return ['起きたこと', '訪問', '影響', '確定', '連絡'];
  return ['起きたこと', '休む人', '影響', '確定', '連絡'];
}

/** 段階の見出し（h3。段階の表示の短い名前と重ねず、その段階ですることを書く） */
export function suddenHeading(kind: SuddenKind | null, step: SuddenStep, staffWord: string): string {
  if (step === 1) return '何が起きましたか？';
  if (step === 5) return '変更を伝える';
  if (kind === 'client')
    return step === 2 ? 'キャンセルの訪問を選ぶ' : step === 3 ? '影響を確かめて取り消す' : '確定する';
  return step === 2 ? `休む${staffWord}と時間帯を選ぶ` : step === 3 ? '影響を確かめて振り直す' : '案を選んで確定する';
}

/** 欠勤の欄の入力（終日／時間帯・開始・終了（空＝始業から・終業まで）・メモ） */
export type AbsenceDraft = { allDay: boolean; from: string; to: string; note: string };

/** 入力の初期値（登録済みの欠勤があればその値） */
export function draftOf(existing: Absence | null): AbsenceDraft {
  return {
    allDay: existing ? existing.from === null && existing.to === null : true,
    from: existing?.from ?? '',
    to: existing?.to ?? '',
    note: existing?.note ?? '',
  };
}

/** 入力から欠勤（id は登録済みならその id、無ければ仮の id。登録するときに呼ぶ側で振る） */
export function absenceOfDraft(d: AbsenceDraft, staffId: string, date: string, existing: Absence | null): Absence {
  return {
    id: existing?.id ?? `${staffId}-${date}`,
    staffId,
    date,
    from: d.allDay || d.from === '' ? null : d.from,
    to: d.allDay || d.to === '' ? null : d.to,
    note: d.note,
  };
}

/** 入力の誤り（終日なら無し。時間帯で開始も終了も空なら「開始か終了を選んでください」） */
export function draftError(d: AbsenceDraft): string | null {
  if (d.allDay) return null;
  const a = absenceOfDraft(d, '', '', null);
  return absenceError(a) ?? (a.from === null && a.to === null ? '開始か終了を選んでください' : null);
}

/** 休む人の選択肢 */
export type StaffChoice = { id: string; label: string; absent: boolean };

/**
 * 休む人の選択肢：その日にもともと働く人（欠勤を差し引く前の稼働時間帯がある人）だけを、渡した順に。
 * 文は「名前（9:00〜17:00・訪問 N件）」、欠勤があれば後ろに「・欠勤（終日）」など
 */
export function staffChoices(
  staff: readonly { id: string; name: string }[],
  slotsOf: ReadonlyMap<string, { baseSlots: Slot[]; absence: Absence | null }>,
  visitCount: (id: string) => number,
): StaffChoice[] {
  const out: StaffChoice[] = [];
  for (const s of staff) {
    const av = slotsOf.get(s.id);
    if (!av || av.baseSlots.length === 0) continue;
    const parts = [slotsText(av.baseSlots), `訪問 ${visitCount(s.id)}件`];
    if (av.absence) parts.push(absenceText(av.absence, av.baseSlots));
    out.push({ id: s.id, label: `${s.name}（${parts.join('・')}）`, absent: !!av.absence });
  }
  return out;
}

/** キャンセルの訪問の選択肢 */
export type VisitChoice = { id: string; label: string };

/** キャンセルの訪問の選択肢：時刻の早い順（同じなら名前）。文は「9:00〜10:00 名前（担当：〇〇さん／担当なし）」 */
export function visitChoices(
  visits: readonly { id: string; earliestStart: string; clientId: string }[],
  clientName: (id: string) => string,
  window: (id: string) => string,
  ownerName: (visitId: string) => string | null,
): VisitChoice[] {
  return [...visits]
    .sort(
      (a, b) =>
        a.earliestStart.localeCompare(b.earliestStart) ||
        clientName(a.clientId).localeCompare(clientName(b.clientId), 'ja'),
    )
    .map((v) => {
      const who = ownerName(v.id);
      return {
        id: v.id,
        label: `${window(v.id)} ${clientName(v.clientId)}（${who ? `担当：${who}さん` : '担当なし'}）`,
      };
    });
}

/** 影響の見出しと内訳（振り直す訪問＝欠勤で入らなくなる訪問） */
export function impactText(targets: readonly Pick<ReassignTarget, 'reason'>[]): { title: string; detail: string } {
  const n = (r: ReassignTarget['reason']) => targets.filter((x) => x.reason === r).length;
  if (targets.length === 0)
    return { title: '入らなくなる訪問はありません', detail: '欠勤の時間と重なる訪問はありません' };
  const parts = [`欠勤と重なる ${n('absence')}件`, `間に合わない ${n('unreachable')}件`];
  if (n('notAllowed') > 0) parts.push(`ほかの必須の条件 ${n('notAllowed')}件`);
  return { title: `入らなくなる訪問 ${targets.length}件`, detail: parts.join('・') };
}

/**
 * 「登録して振り直す」を押せない理由（押せれば null）。入力の誤り → 計算中 → 見込みを出せない → 案が無い の順。
 * 案が無い日は欠勤だけ登録できる（PRD D26・D169）
 */
export function reassignBlocked(i: {
  error: string | null;
  running: boolean;
  hasPreview: boolean;
  hasBase: boolean;
}): string | null {
  if (i.error) return i.error;
  if (i.running) return '計算中は押せません（終わるまで待ってください）';
  if (!i.hasPreview) return '見込みを出せませんでした';
  if (!i.hasBase) return 'この日はまだ案がありません。欠勤だけ登録できます（案を作るときは欠勤を除いて作ります）';
  return null;
}

/**
 * 案の無い日の3段目の文。計算中（自動作成で案を作っている）なら、終わると振り直せると書く
 * （そのあいだは「欠勤だけ登録」も押せない。登録すると、作り終えた案で休む人に訪問が残るため）
 */
export function noPlanText(running: boolean): string {
  return running
    ? '案を作っています。終わると振り直せます'
    : 'この日はまだ案がありません。欠勤だけ登録できます（案を作るときは欠勤を除いて作ります）';
}

/** 案B を勧めるか（案のある日で、案A では入らない見込みがある）。勧めるときは主ボタン「登録して振り直す（おすすめ）」で案B も作る（PRD D264） */
export function recommendAnneal(i: { hasBase: boolean; unplacedA: number }): boolean {
  return i.hasBase && i.unplacedA > 0;
}

/** 当日キャンセルの影響の文（担当の名前が無ければ担当なし） */
export function cancelImpact(i: {
  owner: string | null;
  sameDay: boolean;
  clientWord: string;
  hasPlan: boolean;
}): string[] {
  const out = [
    i.owner
      ? `担当の${i.owner}さんの予定からこの訪問が外れ、その時間が空きます。ほかの訪問の担当・順番・時刻は変えません`
      : 'この訪問はまだ担当が決まっていません。ほかの訪問は変わりません',
  ];
  if (!i.hasPlan) out.push('この日はまだ案がありません。案を作るときはこの訪問を除いて作ります');
  out.push(
    i.sameDay
      ? `当日キャンセルは、月の予定と${i.clientWord}ごとの月の集計に回数が出ます（請求はしません）`
      : 'ふつうの取り消しは回数に数えません',
  );
  return out;
}

/** 4段目の確定の文（確定の状態：none＝確定した割当なし・same＝確定済みと同じ・diff＝違う・null＝案なし） */
export function confirmNote(state: 'none' | 'same' | 'diff' | null): string {
  if (state === null) return 'この日はまだ案がありません';
  if (state === 'same') return '今の案は確定した割当と同じです（確定済み）';
  if (state === 'diff') return '今の案は確定した割当と違います。「この割当で確定」で確定し直してください';
  return 'まだ確定していません。「この割当で確定」で確定します';
}

/** 欠勤の短い文（段階の見出し・知らせ）：「〇〇さん 欠勤（終日）」 */
export function absenceSummary(name: string, a: Pick<Absence, 'from' | 'to'>, slots: Slot[]): string {
  return `${name}さん ${absenceText(a, slots)}`;
}

/** 担当が移る訪問の1行（ReassignMoves） */
export type ReassignMoveRow = { visitId: string; from: string | null; to: string | null };

/**
 * 担当が移る訪問の一覧の行（純粋関数）：担当が変わった訪問と入らなくなった訪問を、訪問の文（時刻から始まる）の順に。
 * 同じ訪問は1行
 */
export function reassignMoveRows(diff: ReassignDiff, visitLabel: (id: string) => string): ReassignMoveRow[] {
  const rows = new Map<string, ReassignMoveRow>();
  for (const m of diff.moved) rows.set(m.visitId, { visitId: m.visitId, from: m.from, to: m.to });
  for (const id of diff.unplaced) if (!rows.has(id)) rows.set(id, { visitId: id, from: null, to: null });
  return [...rows.values()].sort((a, b) => visitLabel(a.visitId).localeCompare(visitLabel(b.visitId), 'ja'));
}
