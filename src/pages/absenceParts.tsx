// 予定の画面の急な欠勤（ADR-0011。PRD D26〜D32）：欠勤の欄・振り直しの差の欄・入らない訪問の受けられる人
import {
  CircleOff,
  GitCompareArrows,
  Send,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  Undo2,
  UserRoundCheck,
  UserRoundX,
  X,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { Hint, SidePanel, WithIcon } from '../components/ui';
import type { DemoData, ReassignInfo } from '../contracts/data';
import type { Absence, Staff, Visit } from '../contracts/documents';
import type { Problem } from '../contracts/problem';
import type { ReassignCandidate, ReassignDiff, ReassignTarget } from '../contracts/reassign';
import { HALF_HOURS, type Slot, slotsText, timeText as t } from '../domain/availability';
import { hhmmToMinutes, minutesToHhmm } from '../domain/time';
import {
  absenceError,
  absencesOn,
  absenceText,
  baseOf,
  roundToHalfHour,
  saveAbsence,
  withoutAbsencesOn,
} from '../lib/absences';
import { attempt, deltaText, newId, r0 } from '../lib/common';
import { compile } from '../matching';
import { candidatesFor, reassign, targetsOf } from '../reassign';

/** 欠勤の欄の入力 */
type Draft = { allDay: boolean; from: string; to: string; note: string; now: string };

/** 見込み（振り直す訪問）：入力のたびに targetsOf を呼ぶ */
export type AbsencePreview = {
  targets: ReassignTarget[];
  /** 欠勤の人の、始まっていて動かさない訪問の件数 */
  started: number;
  /** 振り直しの元の案（無ければ null＝振り直せない） */
  baseFrom: ReassignInfo['from'] | null;
  /** 案A（空き時間に入れるだけ）で入らない見込みの件数（案B を勧める。2回目） */
  unplacedA: number;
};

/** 欠勤の入力から、その欠勤を入れたデータで振り直す訪問を出す（画面に規則を書かず reassign を呼ぶだけ） */
export function previewOf(data: DemoData, date: string, absence: Absence, now: number | null): AbsencePreview | null {
  return attempt(() => {
    const d = saveAbsence(data, absence);
    const p = compile(d, date);
    const base = baseOf(d, date, p);
    if (!base) return { targets: [], started: 0, baseFrom: null, unplacedA: 0 };
    const absent = [...new Set(absencesOn(d, date).map((a) => a.staffId))];
    const before = compile(withoutAbsencesOn(d, date), date);
    const targets = targetsOf(p, { problem: before, routes: base.routes }, absent, now);
    const vIndex = new Map(p.visits.map((v, i) => [v.id, i]));
    let started = 0;
    if (now !== null) {
      for (const id of base.routes[absence.staffId] ?? []) {
        const v = vIndex.get(id);
        if (v !== undefined && p.visits[v]!.earliest < now) started++;
      }
    }
    // 案A の見込み（決定的で速い）。入らない訪問があれば案B を勧める
    const unplacedA = reassign(p, base.routes, targets, { now }).unplaced.length;
    return { targets, started, baseFrom: base.from, unplacedA };
  }).value;
}

/**
 * 欠勤の欄（右から出る）。終日／時間帯・開始と終了（30分刻み。空＝始業から・終業まで）・早道・メモ・いまの時刻・見込み。
 * 主ボタン「登録して振り直す」・「欠勤だけ登録」・既存なら「欠勤を取り消す」・閉じる
 */
export function AbsencePanel({
  staff,
  date,
  baseSlots,
  existing,
  initialNow,
  data,
  visitLabel,
  canReassign,
  onReassign,
  onSaveOnly,
  onRemove,
  onClose,
  fallbackFocus,
}: {
  staff: Staff;
  date: string;
  /** 欠勤を差し引く前のその日の稼働時間帯 */
  baseSlots: Slot[];
  existing: Absence | null;
  /** いまの時刻の初期値（当日以外は null） */
  initialNow: string | null;
  data: DemoData;
  visitLabel: (id: string) => string;
  /** 振り直しを押せるか（計算中は押せない）。押せないときの理由 */
  canReassign: { ok: boolean; why?: string };
  /** anneal：登録して案A にしたあと、続けて案B（少し動かしてよい）を作る */
  onReassign: (absence: Absence, now: string | null, anneal?: boolean) => void;
  onSaveOnly: (absence: Absence) => void;
  onRemove: (absence: Absence) => void;
  onClose: () => void;
  /** 閉じたとき、フォーカスの戻り先が消えていたら移す先（列の見出し） */
  fallbackFocus?: () => HTMLElement | null;
}) {
  const [d, setD] = useState<Draft>(() => ({
    allDay: existing ? existing.from === null && existing.to === null : true,
    from: existing?.from ?? '',
    to: existing?.to ?? '',
    note: existing?.note ?? '',
    now: initialNow ?? '',
  }));
  const absence: Absence = {
    id: existing?.id ?? `${staff.id}-${date}`,
    staffId: staff.id,
    date,
    from: d.allDay || d.from === '' ? null : d.from,
    to: d.allDay || d.to === '' ? null : d.to,
    note: d.note,
  };
  const timeError = d.allDay ? null : absenceError(absence);
  const rangeError = !d.allDay && absence.from === null && absence.to === null ? '開始か終了を選んでください' : null;
  const error = timeError ?? rangeError;
  const nowMinutes = d.now === '' ? null : hhmmToMinutes(d.now);
  // メモは見込みに効かないので key に入れない（メモの入力で計算し直さない）
  const key = JSON.stringify([absence.staffId, absence.from, absence.to, nowMinutes]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 入力（key）とデータが変わったときだけ見込みを作り直す
  const preview = useMemo(() => (error ? null : previewOf(data, date, absence, nowMinutes)), [key, data, date, error]);
  const reasonCount = (r: ReassignTarget['reason']) => preview?.targets.filter((x) => x.reason === r).length ?? 0;
  const shift = baseSlots[0];
  const end = baseSlots.at(-1);
  const set = (x: Partial<Draft>) => setD((cur) => ({ ...cur, ...x }));
  const save = (fn: (a: Absence) => void) => () => {
    if (error) return;
    fn({ ...absence, id: existing?.id ?? newId('a') });
  };

  return (
    <SidePanel
      narrow
      icon={UserRoundX}
      title={`${staff.name}さんの急な欠勤`}
      onClose={onClose}
      fallbackFocus={fallbackFocus}
      footer={
        <>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!!error || !canReassign.ok || !preview || preview.baseFrom === null}
            title={
              !canReassign.ok
                ? canReassign.why
                : preview?.baseFrom === null
                  ? '先にAI案を作ってください（欠勤だけは登録できます）'
                  : undefined
            }
            onClick={save((a) => onReassign(a, d.now === '' ? null : d.now))}
          >
            <WithIcon icon={Send}>登録して振り直す</WithIcon>
          </button>
          <button type="button" className="btn" disabled={!!error} onClick={save(onSaveOnly)}>
            欠勤だけ登録
          </button>
          {existing && (
            <button type="button" className="btn btn-danger-text" onClick={() => onRemove(existing)}>
              <WithIcon icon={Trash2}>欠勤を取り消す</WithIcon>
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            <WithIcon icon={X}>閉じる</WithIcon>
          </button>
        </>
      }
    >
      <p className="sub">
        {date.slice(5).replace('-', '/')} の稼働時間帯：{slotsText(baseSlots)}
        {existing && `（いま：${absenceText(existing, baseSlots)}）`}
      </p>
      <fieldset className="segmented seg-sm" aria-label="欠勤の長さ">
        {(
          [
            [true, '終日'],
            [false, '時間帯'],
          ] as const
        ).map(([v, text]) => (
          <button
            key={text}
            type="button"
            aria-pressed={d.allDay === v}
            className={d.allDay === v ? 'is-on' : ''}
            onClick={() => set({ allDay: v })}
          >
            {text}
          </button>
        ))}
      </fieldset>
      {!d.allDay && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row absence-quick" style={{ flexWrap: 'wrap', gap: 6 }}>
            <button type="button" className="btn btn-small" onClick={() => set({ from: '', to: '12:00' })}>
              午前だけ
            </button>
            <button type="button" className="btn btn-small" onClick={() => set({ from: '12:00', to: '' })}>
              午後だけ
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => set({ from: d.from || (d.now ? roundToHalfHour(d.now) : '15:00'), to: '' })}
            >
              〇時から（早退）
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => set({ from: '', to: d.to || (d.now ? roundToHalfHour(d.now) : '11:00') })}
            >
              〇時まで（遅刻）
            </button>
          </div>
          <div className="form-grid">
            <label>
              開始
              <select value={d.from} onChange={(e) => set({ from: e.target.value })}>
                <option value="">始業から{shift ? `（${t(shift.start)}）` : ''}</option>
                {HALF_HOURS.map((h) => (
                  <option key={h} value={h}>
                    {t(h)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              終了
              <select value={d.to} onChange={(e) => set({ to: e.target.value })}>
                <option value="">終業まで{end ? `（${t(end.end)}）` : ''}</option>
                {HALF_HOURS.map((h) => (
                  <option key={h} value={h}>
                    {t(h)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <span className="sub">30分単位です（半端な時刻は近い30分に丸めて選んでください。午前／午後の境は12:00）</span>
        </div>
      )}
      <label className="field">
        <span className="field-label">メモ（例：病院の付き添い）</span>
        <input value={d.note} maxLength={100} onChange={(e) => set({ note: e.target.value })} />
      </label>
      <label className="field">
        <span className="field-label">いまの時刻（これより前に始まる訪問は動かしません。空＝考えない）</span>
        <input type="time" step={300} value={d.now} onChange={(e) => set({ now: e.target.value })} />
      </label>
      {error && <p className="error">{error}</p>}
      <div aria-live="polite">
        {!error && preview && (
          <div className="stack absence-preview" style={{ gap: 4 }} data-testid="absence-preview">
            <strong>
              振り直す訪問 {preview.targets.length}件（欠勤と重なる {reasonCount('absence')}件・間に合わない{' '}
              {reasonCount('unreachable')}件
              {reasonCount('notAllowed') > 0 ? `・ほかの必須の条件 ${reasonCount('notAllowed')}件` : ''}）
            </strong>
            {preview.targets.map((x) => (
              <span key={x.visitId} className="sub">
                ・{visitLabel(x.visitId)}
                {x.reason === 'unreachable' ? '（間に合わない）' : x.reason === 'notAllowed' ? '（必須の条件）' : ''}
              </span>
            ))}
            {preview.started > 0 && <span className="sub">始まっていて動かさない訪問 {preview.started}件</span>}
            {preview.baseFrom !== null && preview.unplacedA > 0 && (
              <div className="stack anneal-suggest" style={{ gap: 4 }} data-testid="anneal-suggest">
                <span className="warn-text">
                  空き時間に入れるだけ（案A）では {preview.unplacedA}件
                  が入らない見込みです。ほかの人の訪問も少し動かしてよい（案B）なら入るかもしれません
                </span>
                <button
                  type="button"
                  className="btn btn-small"
                  style={{ alignSelf: 'flex-start' }}
                  disabled={!!error || !canReassign.ok}
                  title={!canReassign.ok ? canReassign.why : undefined}
                  onClick={save((a) => onReassign(a, d.now === '' ? null : d.now, true))}
                >
                  登録して、少し動かしてよい（案B）も作る
                </button>
              </div>
            )}
            {preview.baseFrom === null ? (
              <span className="warn-text">先にAI案を作ってください（欠勤だけは登録できます）</span>
            ) : (
              <span className="sub">
                元の案：{preview.baseFrom === 'confirmed' ? '確定した割当' : '今の案'}
                。ほかの人の担当・順番・時刻は変えず、空き時間に入れます（{staff.name}
                さんの残りの訪問は、欠勤明けの移動で開始が遅れることがあります）
              </span>
            )}
          </div>
        )}
      </div>
    </SidePanel>
  );
}

/** 振り直しの差の欄（今の案に reassign があるとき）：まとめ・元の案・いまの時刻・元の案に戻す・比較の画面で見る */
export function ReassignBar({
  info,
  diff,
  cancelled,
  running,
  onRevert,
  onCompare,
  extraActions,
  children,
}: {
  info: ReassignInfo;
  diff: ReassignDiff | null;
  /** 振り直しに使った欠勤が取り消されている */
  cancelled: boolean;
  running: boolean;
  onRevert: () => void;
  onCompare: () => void;
  /** 見出しの横に足す操作（連絡の一覧。2回目） */
  extraActions?: ReactNode;
  /** 下に足す欄（案B。2回目） */
  children?: ReactNode;
}) {
  const reassigned = diff?.moved.filter((m) => m.to !== null && m.from !== null).length ?? 0;
  return (
    <div className="card stack reassign-bar" data-testid="reassign-bar">
      <div className="spread" style={{ flexWrap: 'wrap', gap: 8 }}>
        <strong className="row" style={{ gap: 6 }}>
          <UserRoundCheck size={18} aria-hidden="true" />
          欠勤の振り直し{info.method === 'anneal' ? '（案B：少し動かした案）' : '（案A：空き時間に入れた案）'}
        </strong>
        <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {extraActions}
          <button type="button" className="btn btn-small" disabled={running} onClick={onRevert}>
            <WithIcon icon={Undo2} size={14}>
              元の案に戻す
            </WithIcon>
          </button>
          <button type="button" className="btn btn-small" onClick={onCompare}>
            <WithIcon icon={GitCompareArrows} size={14}>
              比較の画面で見る
            </WithIcon>
          </button>
        </span>
      </div>
      {diff && (
        <div className="row reassign-summary" style={{ flexWrap: 'wrap', gap: 8 }} data-testid="reassign-summary">
          <span className="chip">変わる人 {diff.changedStaff.length}人</span>
          <span className="chip chip-move">振り直し {reassigned}件</span>
          <span className={`chip ${diff.unplaced.length > 0 ? 'chip-warn' : 'chip-ok'}`}>
            入らない {diff.unplaced.length}件
          </span>
          <span className="chip">移動 {deltaText(r0(diff.travelDelta), '分') || '±0分'}</span>
        </div>
      )}
      <span className="sub">
        元の案：{info.from === 'confirmed' ? '確定した割当' : '今の案'}
        {info.now ? `・いまの時刻 ${t(info.now)}` : ''}
        {info.method === 'anneal'
          ? `。案B（変更を減らす ${info.stayWeight ?? ''}）では、ほかの人の訪問も少し動かしています（薄い列は変わらない人）`
          : '。振り直しでは、ほかの人の担当・順番・時刻は変えていません（「受けられる人」から入れた分・手直しは除く。薄い列は変わらない人）'}
        <Hint>
          振り直した訪問に「代行」、開始が変わった訪問に「+N分」が付きます。振り直したあとの案は全訪問が固定です。入らない訪問は「受けられる人」から入れられます。
        </Hint>
      </span>
      {cancelled && (
        <span className="warn-text row" style={{ gap: 4 }}>
          <TriangleAlert size={14} aria-hidden="true" />
          欠勤は取り消されています。元の案に戻せます
        </span>
      )}
      {children}
    </div>
  );
}

/** 「〇分ずらせば入る」の文 */
function shiftText(m: number): string {
  return m > 0 ? `${m}分遅らせれば入る` : `${-m}分早めれば入る`;
}

/** 入らない訪問を受けられる人の候補（先頭5人＋「すべて見る」）。押すとその人に入れる（固定） */
export function CandidateBox({
  problem,
  routes,
  visitId,
  now,
  staffName,
  visit,
  running,
  onPlace,
}: {
  problem: Problem;
  routes: Record<string, string[]>;
  visitId: string;
  now: string | null;
  staffName: (id: string) => string;
  visit: Visit | undefined;
  running: boolean;
  /** 押した候補（遅れ・いまの時刻より前の確認は呼ぶ側で出す） */
  onPlace: (candidate: ReassignCandidate) => void;
}) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const list: ReassignCandidate[] = useMemo(
    () =>
      open
        ? (attempt(() => candidatesFor(problem, routes, visitId, { now: now === null ? null : hhmmToMinutes(now) }))
            .value ?? [])
        : [],
    [open, problem, routes, visitId, now],
  );
  const shown = all ? list : list.slice(0, 5);
  return (
    <div className="stack candidate-box" style={{ gap: 4 }}>
      <button
        type="button"
        className="btn btn-small"
        aria-expanded={open}
        onClick={() => setOpen((x) => !x)}
        style={{ alignSelf: 'flex-start' }}
      >
        <WithIcon icon={UserRoundCheck} size={14}>
          受けられる人
        </WithIcon>
      </button>
      {open && (
        <ul className="candidate-list" data-testid="candidate-list">
          {shown.map((c) => (
            <li key={c.staffId} className="candidate-row">
              <div className="spread" style={{ gap: 6 }}>
                <strong className="ellipsis">{staffName(c.staffId)}</strong>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={running}
                  onClick={() => onPlace(c)}
                  aria-label={`${staffName(c.staffId)}さんに入れる`}
                >
                  この人に入れる
                </button>
              </div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                {c.fits ? (
                  <>
                    <span className="chip chip-ok">時間の約束を守れる</span>
                    {c.addedTravel !== null && (
                      <span className="chip">移動 {deltaText(r0(c.addedTravel), '分') || '±0分'}</span>
                    )}
                  </>
                ) : c.shiftMinutes !== null ? (
                  <span className="chip chip-warn" title={visit ? `いまの約束：${t(visit.earliestStart)}` : undefined}>
                    {shiftText(c.shiftMinutes)}
                    {visit ? `（${t(minutesToHhmm(hhmmToMinutes(visit.earliestStart) + c.shiftMinutes))}〜）` : ''}
                  </span>
                ) : (
                  <span className="chip chip-off">
                    <CircleOff size={12} aria-hidden="true" />
                    空き時間に入らない
                  </span>
                )}
                {c.routeBroken && (
                  <span className="chip chip-red">いまの予定に必須の違反があるため、空き時間に入れられません</span>
                )}
                {c.delayedCount > 0 && (
                  <span className="chip chip-warn">
                    入れると後ろの {c.delayedCount}件が最大 +{c.maxDelayMinutes}分 遅れる
                  </span>
                )}
                {c.startsBeforeNow && <span className="chip chip-warn">いまの時刻より前に入る</span>}
                {c.overCap && <span className="chip chip-red">件数の上限を超える</span>}
                {c.violations.slice(0, 3).map((r) => (
                  <span
                    key={`${r.ruleId}:${r.label}`}
                    className={`chip ${r.points === Number.POSITIVE_INFINITY ? 'chip-red' : 'chip-warn'}`}
                  >
                    {r.points === Number.POSITIVE_INFINITY && <ShieldAlert size={12} aria-hidden="true" />}
                    {r.label}
                  </span>
                ))}
              </div>
            </li>
          ))}
          {!all && list.length > 5 && (
            <li>
              <button type="button" className="btn btn-small" onClick={() => setAll(true)}>
                すべて見る（{list.length}人）
              </button>
            </li>
          )}
          <li className="sub">
            入れる訪問の時間の約束は変えません。空き時間に入らない人に入れると、その人の後ろの訪問の開始が遅れることがあり（押すと確認します）、間に合わないときは必須の違反として赤い枠になります（時刻は訪問の編集で直せます）。いまの時刻より前の位置には入れません（ほかに入る位置が無ければ確認します）
          </li>
        </ul>
      )}
    </div>
  );
}
