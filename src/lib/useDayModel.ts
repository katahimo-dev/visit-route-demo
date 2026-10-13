import { useMemo } from 'react';
import type { Client, Staff, Visit } from '../contracts/documents';
import type { Problem, ScoreScale } from '../contracts/problem';
import { availabilityOf, type Slot } from '../domain/availability';
import { NONE, reconcile, type View } from '../domain/scheduleModel';
import { normalize } from '../evaluate';
import { compile } from '../matching';
import { scorePresetOf, scoreRulesOf } from '../seed';
import { useDemoData } from '../store';
import { attempt, byDisplayName, byName, staffColor } from './common';

/**
 * その日の画面で共通に使う形（予定・AI案・スタッフの画面）。
 * 問題（compile）は useMemo。未実装・データの不整合で投げても problemError に文を入れて画面は続ける。
 * problem・scale はいまの条件（solver の費用）、scoreProblem・scoreScale は点数の基準のプリセットの物差し（ADR-0010）
 */
export function useDayModel(date: string) {
  const store = useDemoData();
  const { data } = store;
  const staff = useMemo(() => [...data.staff].sort(byName), [data.staff]);
  const clients = useMemo(() => [...data.clients].sort(byDisplayName), [data.clients]);
  const staffById = useMemo(() => new Map<string, Staff>(staff.map((s) => [s.id, s])), [staff]);
  const clientById = useMemo(() => new Map<string, Client>(clients.map((c) => [c.id, c])), [clients]);
  const colorOfStaff = useMemo(() => new Map(staff.map((s, i) => [s.id, staffColor(i)])), [staff]);
  const allVisits = useMemo(() => data.visits.filter((v) => v.date === date), [data.visits, date]);
  const visits = useMemo(() => allVisits.filter((v) => !v.cancelled), [allVisits]);
  const visitById = useMemo(() => new Map<string, Visit>(visits.map((v) => [v.id, v])), [visits]);
  /** その日の稼働時間帯（基本の曜日と時間＋日ごとの上書き） */
  const slotsOf = useMemo(() => {
    const overrides = new Map(data.availability.filter((a) => a.date === date).map((a) => [a.staffId, a]));
    return new Map<string, { slots: Slot[]; overridden: boolean }>(
      staff.map((s) => [s.id, availabilityOf(s, date, overrides.get(s.id))]),
    );
  }, [staff, data.availability, date]);
  const compiled = useMemo(() => attempt(() => compile(data, date)), [data, date]);
  /** いまの条件の物差し（solver が最小にする費用と同じ。途中の計算・ドラッグの可否に使う） */
  const scale = useMemo(() => {
    const p = compiled.value;
    return p ? attempt(() => normalize(p)).value : null;
  }, [compiled]);
  /** 点数の基準のプリセット（ADR-0010。プリセットが0件なら null＝いまの条件そのもの） */
  const scorePreset = useMemo(
    () => scorePresetOf(data.presets, data.scorePresetId),
    [data.presets, data.scorePresetId],
  );
  /**
   * 点数の物差しの問題（ADR-0010）：条件に点数の基準のプリセットの重み・必須を当てて作る。
   * いまの条件と同じなら compile し直さずに同じものを使う（重い compile を二重にしない）
   */
  const scoreCompiled = useMemo(() => {
    const rules = scoreRulesOf(data);
    if (JSON.stringify(rules) === JSON.stringify(data.rules)) return compiled;
    return attempt(() => compile({ ...data, rules }, date));
  }, [data, date, compiled]);
  /** 100点満点の物差し（下限＝100点、1件あたりの超過で減点。ADR-0007 案A）。点数の基準の条件で作る（ADR-0010） */
  const scoreScale = useMemo(() => {
    if (scoreCompiled === compiled) return scale;
    const p = scoreCompiled.value;
    return p ? attempt(() => normalize(p)).value : null;
  }, [scoreCompiled, compiled, scale]);
  /** 保存してある手作業案（訪問の staffId で補う） */
  const savedView: View = useMemo(
    () =>
      reconcile(
        data.manualPlans[date] ?? {},
        visits,
        staff.map((s) => s.id),
      ),
    [data.manualPlans, date, visits, staff],
  );
  return {
    ...store,
    staff,
    clients,
    staffById,
    clientById,
    colorOfStaff,
    allVisits,
    visits,
    visitById,
    slotsOf,
    problem: compiled.value as Problem | null,
    problemError: compiled.error,
    scale: scale as ScoreScale | null,
    /** 点数（100点満点）・必須の違反・条件ごとの達成を付ける問題（点数の基準の条件。ADR-0010） */
    scoreProblem: scoreCompiled.value as Problem | null,
    scoreScale: scoreScale as ScoreScale | null,
    /** 点数の基準のプリセットの名前（「物差し：標準」の表示。プリセットが無ければ「いまの条件」） */
    scoreRulerName: scorePreset?.name ?? 'いまの条件',
    savedView,
  };
}

/** 訪問ID → 担当 */
export function ownerMap(routes: Record<string, string[]>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [s, ids] of Object.entries(routes)) if (s !== NONE) for (const id of ids) out.set(id, s);
  return out;
}
