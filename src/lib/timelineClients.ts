// 週間の時間軸の「〈利用者さん〉で見る」の選択の決まり（PRD D62・D108・D136〜D139。design.md §4 pages「週間の時間軸の〈利用者さん〉の初期値」。ADR-0024）。
// チップに並べる人・初期値（先頭8人）・URL の ?client= に書く値・表から移ったときの引き継ぎを1か所で決める

/** 時間軸の「〈利用者さん〉で見る」で出せる人数（PRD D62。表は絞り込みで全員） */
export const TIMELINE_CLIENT_MAX = 8;

/** 初期値：この週に訪問がある人（表と同じ順）の先頭8人 */
export const defaultTimelineClients = (weekIds: readonly string[]): string[] => weekIds.slice(0, TIMELINE_CLIENT_MAX);

/**
 * 選んでいる人。?client= があればそれ（候補 known にいる人だけ。空なら0人）。無ければ初期値（isDefault）
 * @param param ?client= を「,」で分けたもの（URL に無ければ null）
 * @param weekIds この週に（取り消しでない）訪問がある人（表と同じ順）
 * @param known 時間軸に出せる人（検索欄の候補）
 */
export function timelineSelection(
  param: readonly string[] | null,
  weekIds: readonly string[],
  known: ReadonlySet<string>,
): { ids: string[]; isDefault: boolean } {
  if (param === null) return { ids: defaultTimelineClients(weekIds).filter((id) => known.has(id)), isDefault: true };
  return { ids: param.filter((id) => known.has(id)), isDefault: false };
}

/** 同じ人の集まりか（順は問わない） */
const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((id) => set.has(id));
};

/**
 * 選び直した結果を ?client= に書く値。初期値（先頭8人）と同じ人なら null（書かない。?cf= の既定と同じ考え方）。
 * それ以外は ID を「,」でつなぐ（0人なら ''＝だれも選ばない）
 */
export function clientParamOf(ids: readonly string[], weekIds: readonly string[]): string | null {
  return sameSet(ids, defaultTimelineClients(weekIds)) ? null : ids.join(',');
}

/** チップに並べる人：この週に訪問がある人（表と同じ順）のあとに、選んでいてそこにいない人（「ほかの人を探す」で選んだ人。選んだ順） */
export function timelineChipIds(weekIds: readonly string[], selected: readonly string[]): string[] {
  const inWeek = new Set(weekIds);
  return [...weekIds, ...selected.filter((id) => !inWeek.has(id))];
}

/**
 * 表（〈利用者さん〉×曜日）から時間軸へ移るとき ?client= に書く値（PRD D139）。null なら書かない。
 * ?client= があればそれのまま（null）。無ければ、表で絞り込んでいれば（?cf= が既定でない）その先頭8人（時間軸に出せる人だけ）。
 * 絞り込んでいない・先頭8人が初期値と同じ・当てはまる人が0人なら書かない（初期値＝この週の先頭8人になる）
 */
export function handoffFromTable(input: {
  hasParam: boolean;
  filtered: boolean;
  /** 表で絞り込んだ人のうち時間軸に出せる人（表の順） */
  filteredIds: readonly string[];
  weekIds: readonly string[];
}): string | null {
  if (input.hasParam || !input.filtered) return null;
  const ids = input.filteredIds.slice(0, TIMELINE_CLIENT_MAX);
  if (ids.length === 0) return null;
  return clientParamOf(ids, input.weekIds);
}
