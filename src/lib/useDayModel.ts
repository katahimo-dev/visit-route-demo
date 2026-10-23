import { useMemo } from 'react';
import type { DemoData } from '../contracts/data';
import type { Absence, Client, Staff, Visit } from '../contracts/documents';
import type { Problem, ScoreScale } from '../contracts/problem';
import { availabilityOf, type Slot, withoutAbsences } from '../domain/availability';
import { isOnLeave } from '../domain/leaves';
import { normalize } from '../evaluate';
import { type CompileInput, compile } from '../matching';
import { visitsOn } from '../patterns';
import { scorePresetOf } from '../seed';
import { useDemoData } from '../store';
import { attempt, byDisplayName, byName } from './common';
import { staffColorMap } from './staffMark';

/**
 * その日の画面で共通に使う形（予定・スタッフの画面）。
 * 問題（compile）は useMemo。未実装・データの不整合で投げても problemError に文を入れて画面は続ける。
 * 版2（ADR-0053）：条件の重みはいつも点数の基準なので、problem と scoreProblem は同じ。
 * compile の依存は compile が読むフィールドだけ（compileInput）。担当・開始・ピンは訪問にあるので、担当を替えると作り直す
 */
export function useDayModel(date: string) {
  const store = useDemoData();
  const { data } = store;
  const staff = useMemo(() => [...data.staff].sort(byName), [data.staff]);
  const clients = useMemo(() => [...data.clients].sort(byDisplayName), [data.clients]);
  const staffById = useMemo(() => new Map<string, Staff>(staff.map((s) => [s.id, s])), [staff]);
  const clientById = useMemo(() => new Map<string, Client>(clients.map((c) => [c.id, c])), [clients]);
  /** 〈スタッフ〉の色（印 StaffMark・地図の線・時間軸の帯で同じ。lib/staffMark） */
  const colorOfStaff = useMemo(() => staffColorMap(data.staff), [data.staff]);
  /** その日の訪問（保存した回＋繰り返しから計算した回） */
  const allVisits = useMemo(
    () => visitsOn({ visits: data.visits, patterns: data.patterns, clients: data.clients }, date),
    [data.visits, data.patterns, data.clients, date],
  );
  /** 計算に入れる候補の訪問（取り消し・〈利用者さん〉の休み（ADR-0013）の訪問を除く） */
  const visits = useMemo(
    () => allVisits.filter((v) => !v.cancelled && !isOnLeave(data.clientLeaves, v)),
    [allVisits, data.clientLeaves],
  );
  /** 〈利用者さん〉の休みのため無しの訪問（取り消しを除く。ADR-0013。画面で薄く出すだけ） */
  const leaveVisits = useMemo(
    () => allVisits.filter((v) => !v.cancelled && isOnLeave(data.clientLeaves, v)),
    [allVisits, data.clientLeaves],
  );
  const visitById = useMemo(() => new Map<string, Visit>(visits.map((v) => [v.id, v])), [visits]);
  /**
   * その日の稼働時間帯（基本の曜日と時間＋日ごとの上書き）。slots は欠勤を差し引いたもの（ADR-0011）、
   * baseSlots は差し引く前、absence はその日の欠勤（無ければ null）
   */
  const slotsOf = useMemo(() => {
    const overrides = new Map(data.availability.filter((a) => a.date === date).map((a) => [a.staffId, a]));
    const absences = new Map(data.absences.filter((a) => a.date === date).map((a) => [a.staffId, a]));
    return new Map<string, { slots: Slot[]; baseSlots: Slot[]; overridden: boolean; absence: Absence | null }>(
      staff.map((s) => {
        const a = availabilityOf(s, date, overrides.get(s.id));
        const absence = absences.get(s.id) ?? null;
        return [
          s.id,
          {
            slots: absence ? withoutAbsences(a.slots, [absence]) : a.slots,
            baseSlots: a.slots,
            overridden: a.overridden,
            absence,
          },
        ];
      }),
    );
  }, [staff, data.availability, data.absences, date]);
  /** compile が読むデータだけ（案・記録・プリセットの更新では変わらない） */
  const compileInput = useCompileInput(data);
  const compiled = useMemo(() => attempt(() => compile(compileInput, date)), [compileInput, date]);
  /** 点数の基準のプリセット（ADR-0010） */
  const scorePreset = useMemo(
    () => scorePresetOf(data.presets, data.scorePresetId),
    [data.presets, data.scorePresetId],
  );
  /** 100点満点の物差し（下限＝100点、1件あたりの超過で減点。ADR-0007 案A） */
  const scoreScale = useMemo(() => {
    const p = compiled.value;
    return p ? attempt(() => normalize(p)).value : null;
  }, [compiled]);
  return {
    ...store,
    staff,
    clients,
    staffById,
    clientById,
    colorOfStaff,
    allVisits,
    visits,
    leaveVisits,
    visitById,
    slotsOf,
    /** compile に渡すデータ（compile が読むフィールドだけ。プリセットで試すときの元。ADR-0010） */
    compileInput,
    problem: compiled.value as Problem | null,
    problemError: compiled.error,
    /** 点数（100点満点）・必須の違反・条件ごとの達成を付ける問題（点数の基準の条件。版2は problem と同じ） */
    scoreProblem: compiled.value as Problem | null,
    scoreScale: scoreScale as ScoreScale | null,
    /** 点数の基準の条件（名前・重み。点数の理由の文に使う。PRD D173） */
    scoreRules: compileInput.rules,
    /** 点数の基準のプリセットの名前（「物差し：標準」の表示） */
    scoreRulerName: scorePreset?.name ?? '点数の基準',
  };
}

/**
 * compile が読むデータだけを取り出す（伝えた内容・プリセットの更新では変わらない）。
 * その日の問題を compile しないので、日を選ばない画面（ホーム。PRD D141）はこれだけを使う
 */
export function useCompileInput(data: DemoData): CompileInput {
  return useMemo(
    () => ({
      org: data.org,
      items: data.items,
      rules: data.rules,
      staff: data.staff,
      clients: data.clients,
      compat: data.compat,
      visits: data.visits,
      availability: data.availability,
      absences: data.absences,
      visitTypes: data.visitTypes,
      patterns: data.patterns,
      clientLeaves: data.clientLeaves,
    }),
    [
      data.org,
      data.items,
      data.rules,
      data.staff,
      data.clients,
      data.compat,
      data.visits,
      data.availability,
      data.absences,
      data.visitTypes,
      data.patterns,
      data.clientLeaves,
    ],
  );
}

/** 訪問ID → 担当 */
export function ownerMap(routes: Record<string, string[]>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [s, ids] of Object.entries(routes)) if (s !== '__none') for (const id of ids) out.set(id, s);
  return out;
}
