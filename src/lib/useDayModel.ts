import { useMemo } from 'react';
import type { Client, Staff, Visit } from '../contracts/documents';
import type { Problem, ScoreScale } from '../contracts/problem';
import { availabilityOf, type Slot } from '../domain/availability';
import { NONE, reconcile, type View } from '../domain/scheduleModel';
import { normalize } from '../evaluate';
import { compile } from '../matching';
import { useDemoData } from '../store';
import { attempt, byDisplayName, byName, staffColor } from './common';

/**
 * その日の画面で共通に使う形（予定・AI案・スタッフの画面）。
 * 問題（compile）は useMemo。未実装・データの不整合で投げても problemError に文を入れて画面は続ける
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
  /** 100点満点の物差し（下限＝100点、1件あたりの超過で減点。ADR-0007 案A） */
  const scale = useMemo(() => {
    const p = compiled.value;
    return p ? attempt(() => normalize(p)).value : null;
  }, [compiled]);
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
    savedView,
  };
}

/** 列（staffId → 訪問ID）から、採点に渡す routes（未割当は入れない） */
export function routesOf(cols: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, ids] of Object.entries(cols)) if (k !== NONE && ids.length > 0) out[k] = ids;
  return out;
}

/** 訪問ID → 担当 */
export function ownerMap(routes: Record<string, string[]>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [s, ids] of Object.entries(routes)) if (s !== NONE) for (const id of ids) out.set(id, s);
  return out;
}
