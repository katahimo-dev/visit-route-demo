// 予定の画面の急な欠勤（ADR-0011。PRD D26〜D32）：欠勤の入力欄と見込み（「欠勤・キャンセル」の欄で使う。PRD D169）・
// 振り直しの差の欄・入らない訪問の受けられる人
import { CircleOff, GitCompareArrows, ShieldAlert, TriangleAlert, Undo2, UserRoundCheck } from 'lucide-react';
import { type ReactNode, useId, useMemo, useState } from 'react';
import { PersonButton } from '../components/PersonPopover';
import { Hint, WithIcon } from '../components/ui';
import type { DemoData, ReassignInfo } from '../contracts/data';
import type { Absence, Visit } from '../contracts/documents';
import type { Problem } from '../contracts/problem';
import type { ReassignCandidate, ReassignDiff, ReassignLeft, ReassignTarget } from '../contracts/reassign';
import { HALF_HOURS, type Slot, slotsText, timeText as t } from '../domain/availability';
import { hhmmToMinutes, minutesToHhmm } from '../domain/time';
import { absencesOn, absenceText, baseOf, saveAbsence, withoutAbsencesOn } from '../lib/absences';
import { attempt, deltaText, r0 } from '../lib/common';
import type { AbsenceDraft } from '../lib/sudden';
import { compile } from '../matching';
import { candidatesFor, reassign, targetsOf } from '../reassign';

/** 見込み（振り直す訪問）：入力のたびに targetsOf を呼ぶ */
export type AbsencePreview = {
  targets: ReassignTarget[];
  /** 振り直しの元の案（無ければ null＝振り直せない） */
  baseFrom: ReassignInfo['from'] | null;
  /** 案A（空き時間に入れるだけ）で入らない見込みの件数（案B を勧める。2回目） */
  unplacedA: number;
};

/** 欠勤の入力から、その欠勤を入れたデータで振り直す訪問を出す（画面に規則を書かず reassign を呼ぶだけ） */
export function previewOf(data: DemoData, date: string, absence: Absence): AbsencePreview | null {
  return attempt(() => {
    const d = saveAbsence(data, absence);
    const p = compile(d, date);
    const base = baseOf(d, date, p);
    if (!base) return { targets: [], baseFrom: null, unplacedA: 0 };
    const absent = [...new Set(absencesOn(d, date).map((a) => a.staffId))];
    const plan = { problem: compile(withoutAbsencesOn(d, date), date), routes: base.routes };
    const targets = targetsOf(p, plan, absent);
    // 案A の見込み（決定的で速い）。入らない訪問があれば案B を勧める
    const unplacedA = reassign(p, base.routes, targets).unplaced.length;
    return { targets, baseFrom: base.from, unplacedA };
  }).value;
}

/**
 * 欠勤の入力欄（終日／時間帯・開始と終了（30分刻み。空＝始業から・終業まで）・早道・メモ）。値は呼ぶ側が持つ
 * （「欠勤・キャンセル」の欄の2段目。PRD D26・D169。いまの時刻は扱わない。過去の欠勤は登録しない前提）
 */
export function AbsenceFields({
  draft: d,
  onChange,
  baseSlots,
  existing,
  date,
  error,
}: {
  draft: AbsenceDraft;
  onChange: (x: Partial<AbsenceDraft>) => void;
  /** 欠勤を差し引く前のその日の稼働時間帯 */
  baseSlots: Slot[];
  existing: Absence | null;
  date: string;
  error: string | null;
}) {
  const shift = baseSlots[0];
  const end = baseSlots.at(-1);
  const set = onChange;
  return (
    <div className="stack" style={{ gap: 10 }}>
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
            <button type="button" className="btn btn-small" onClick={() => set({ from: d.from || '15:00', to: '' })}>
              〇時から（早退）
            </button>
            <button type="button" className="btn btn-small" onClick={() => set({ from: '', to: d.to || '11:00' })}>
              〇時まで（遅刻）
            </button>
          </div>
          <div className="form-grid">
            <label>
              開始
              <select value={d.from} onChange={(e) => set({ from: e.target.value })} data-testid="absence-from">
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
              <select value={d.to} onChange={(e) => set({ to: e.target.value })} data-testid="absence-to">
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
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** 見込みの振り直す訪問の一覧（理由つき。「欠勤・キャンセル」の欄の3段目） */
export function AbsenceTargets({
  targets,
  visitLabel,
}: {
  targets: ReassignTarget[];
  visitLabel: (id: string) => string;
}) {
  if (targets.length === 0) return null;
  return (
    <ul className="sudden-targets">
      {targets.map((x) => (
        <li key={x.visitId} className="sub">
          {visitLabel(x.visitId)}
          {x.reason === 'unreachable' ? '（間に合わない）' : x.reason === 'notAllowed' ? '（必須の条件）' : ''}
        </li>
      ))}
    </ul>
  );
}

/** 振り直しの差の欄（今の案に reassign があるとき）：まとめ・元の案・入らない訪問と欠勤の人に残る訪問の理由・元の案に戻す・比較の画面で見る */
export function ReassignBar({
  id,
  info,
  diff,
  left,
  visitLabel,
  visitNode,
  staffName,
  cancelled,
  running,
  onRevert,
  onCompare,
  onReassignAgain,
  extraActions,
  children,
}: {
  /** 欄の要素の id（差の欄へ移る近道・下の帯が使う） */
  id: string;
  info: ReassignInfo;
  diff: ReassignDiff | null;
  /** 欠勤の人に残る、欠勤と重なる訪問（leftOf。今の案で） */
  left: ReassignLeft[];
  visitLabel: (id: string) => string;
  /** 欠勤の人に残る訪問の見た目（〈利用者さん〉の名前から詳細を開く。PRD D206）。無ければ visitLabel の文字 */
  visitNode?: (id: string) => ReactNode;
  staffName: (id: string) => string;
  /** 振り直しに使った欠勤が取り消されている */
  cancelled: boolean;
  running: boolean;
  onRevert: () => void;
  onCompare: () => void;
  /** もう一度振り直す（欠勤の人に残る訪問があるとき） */
  onReassignAgain: () => void;
  /** 見出しの横に足す操作（連絡の一覧。2回目） */
  extraActions?: ReactNode;
  /** 下に足す欄（案B。2回目） */
  children?: ReactNode;
}) {
  const titleId = useId();
  return (
    <section
      id={id}
      className="card stack reassign-bar"
      data-testid="reassign-bar"
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <div className="spread" style={{ flexWrap: 'wrap', gap: 8 }}>
        <strong className="row" style={{ gap: 6 }} id={titleId}>
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
      {diff && <ReassignSummary diff={diff} left={left.length} />}
      {diff && diff.unplaced.length > 0 && (
        <div className="stack left-box left-box-warn" style={{ gap: 4 }} data-testid="unplaced-why">
          <strong className="row warn-text" style={{ gap: 4 }}>
            <CircleOff size={15} aria-hidden="true" />
            入らない訪問（{diff.unplaced.length}件）：ほかの人の空き時間に入らない
          </strong>
          <span className="sub">
            ほかの人の担当・順番・時刻を変えずに入れられる人がいません（時間の約束・稼働時間帯・必須の条件・件数の上限）。下の「少し動かしてよい（案B）」を作るか、「入らなかった訪問」の列の「受けられる人」から入れてください
          </span>
          {diff.unplaced.map((id) => (
            <span key={id} className="sub">
              ・{visitLabel(id)}
            </span>
          ))}
        </div>
      )}
      {left.length > 0 && (
        <div className="stack left-box" style={{ gap: 4 }} data-testid="left-box">
          <strong className="error row" style={{ gap: 4 }}>
            <TriangleAlert size={15} aria-hidden="true" />
            欠勤の人に残っている訪問（{left.length}件）：対応が必要
          </strong>
          <span className="sub">
            欠勤の時間と重なるのに、欠勤の人の列に残っています（手直しで戻した・振り直したあとに欠勤や条件を変えた、など）。担当の列では赤い印になっています。もう一度振り直すか、ドラッグで別の人へ移してください
          </span>
          {left.map((x) => (
            <span key={x.visitId} className="sub">
              ・{visitNode ? visitNode(x.visitId) : visitLabel(x.visitId)}（{staffName(x.staffId)}さん・
              {leftReasonText(x)}）
            </span>
          ))}
          <button
            type="button"
            className="btn btn-small"
            style={{ alignSelf: 'flex-start' }}
            disabled={running || cancelled}
            onClick={onReassignAgain}
          >
            もう一度振り直す
          </button>
        </div>
      )}
      <span className="sub">
        元の案：{info.from === 'confirmed' ? '確定した割当' : '今の案'}
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
    </section>
  );
}

/** 振り直しのまとめ（変わる人・振り直し・入らない・欠勤の人のまま・移動）。差の欄と「欠勤・キャンセル」の欄の4段目で共通 */
export function ReassignSummary({
  diff,
  left,
  testId = 'reassign-summary',
}: {
  diff: ReassignDiff;
  left: number;
  testId?: string;
}) {
  const reassigned = diff.moved.filter((m) => m.to !== null && m.from !== null).length;
  return (
    <div className="row reassign-summary" style={{ flexWrap: 'wrap', gap: 8 }} data-testid={testId}>
      <span className="chip">変わる人 {diff.changedStaff.length}人</span>
      <span className="chip chip-move">振り直し {reassigned}件</span>
      <span className={`chip ${diff.unplaced.length > 0 ? 'chip-warn' : 'chip-ok'}`}>
        入らない {diff.unplaced.length}件
      </span>
      {left > 0 && <span className="chip chip-red">欠勤の人のまま {left}件</span>}
      <span className="chip">移動 {deltaText(r0(diff.travelDelta), '分') || '±0分'}</span>
    </div>
  );
}

/** 欠勤の人に残る訪問の理由の短い文（列のカード・差の欄） */
export function leftReasonText(x: ReassignLeft): string {
  if (x.reason === 'unreachable') return '欠勤明けに間に合わない：振り直していない';
  return '欠勤と重なる：振り直していない';
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
  staffName,
  visit,
  running,
  onPlace,
}: {
  problem: Problem;
  routes: Record<string, string[]>;
  visitId: string;
  staffName: (id: string) => string;
  visit: Visit | undefined;
  running: boolean;
  /** 押した候補（遅れの確認は呼ぶ側で出す） */
  onPlace: (candidate: ReassignCandidate) => void;
}) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const list: ReassignCandidate[] = useMemo(
    () => (open ? (attempt(() => candidatesFor(problem, routes, visitId)).value ?? []) : []),
    [open, problem, routes, visitId],
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
                {/* 名前から詳細（「この人に入れる」とは別のボタン。PRD D206） */}
                <strong className="ellipsis">
                  <PersonButton kind="staff" id={c.staffId} name={staffName(c.staffId)} testId="candidate-name" />
                </strong>
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
            入れる訪問の時間の約束は変えません。空き時間に入らない人に入れると、その人の後ろの訪問の開始が遅れることがあり（押すと確認します）、間に合わないときは必須の違反として赤い枠になります（時刻は訪問の編集で直せます）
          </li>
        </ul>
      )}
    </div>
  );
}
