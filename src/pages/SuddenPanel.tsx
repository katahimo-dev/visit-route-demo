// 「欠勤・キャンセル」の欄（PRD D167〜D172。ADR-0025 追記・ADR-0011・ADR-0015）：日の画面の入口・列の見出しの「急な欠勤」・
// ホームのカードから開く、段階のある右の欄。1 何が起きたか → 2 人（時間帯）・訪問を選ぶ → 3 影響の確認と振り直し → 4 選んで確定。
// 振り直しの計算は足さない（見込みは previewOf、振り直し・案B・確定・元に戻すは日の画面の今の操作を呼ぶ）
import {
  Ban,
  CalendarX2,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Send,
  Trash2,
  Undo2,
  UserRoundCheck,
  UserRoundX,
  X,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { SidePanel, WithIcon } from '../components/ui';
import type { DemoData } from '../contracts/data';
import type { Absence, Terms } from '../contracts/documents';
import type { Slot } from '../domain/availability';
import { newId } from '../lib/common';
import {
  type AbsenceDraft,
  absenceOfDraft,
  absenceSummary,
  cancelImpact,
  confirmNote,
  draftError,
  draftOf,
  impactText,
  reassignBlocked,
  type StaffChoice,
  type SuddenKind,
  type SuddenStep,
  suddenSteps,
  type VisitChoice,
} from '../lib/sudden';
import { AbsenceFields, AbsenceTargets, previewOf } from './absenceParts';

/** 欄を開くときの初め（列の見出しからは〈スタッフ〉と人を決めて2段目から） */
export type SuddenInit = { kind?: SuddenKind; staffId?: string };

/** 済んだこと（4段目の見出し） */
type Done = { kind: 'staff'; text: string } | { kind: 'client'; text: string; sameDay: boolean };

export function SuddenPanel({
  init,
  date,
  data,
  terms,
  staffList,
  visitList,
  slotsOf,
  staffName,
  visitLabel,
  visitInfo,
  running,
  hasPlan,
  confirmState,
  result,
  onReassign,
  onSaveOnly,
  onRemoveAbsence,
  onCancelVisit,
  onAdopt,
  onRevert,
  onClose,
  fallbackFocus,
  returnFocus,
}: {
  init: SuddenInit;
  date: string;
  data: DemoData;
  terms: Terms;
  /** 休む人の選択肢（その日にもともと働く人） */
  staffList: StaffChoice[];
  /** キャンセルの訪問の選択肢（その日の取り消していない訪問） */
  visitList: VisitChoice[];
  slotsOf: ReadonlyMap<string, { baseSlots: Slot[]; absence: Absence | null }>;
  staffName: (id: string) => string;
  visitLabel: (id: string) => string;
  /** キャンセルの訪問の〈利用者さん〉の名前・時刻・いまの担当の名前 */
  visitInfo: (visitId: string) => { client: string; window: string; owner: string | null };
  /** 計算中（自動作成・案B など） */
  running: boolean;
  /** 今の案がある */
  hasPlan: boolean;
  confirmState: 'none' | 'same' | 'diff' | null;
  /** 4段目の振り直しの結果（まとめ・案A と案B を選ぶ欄）。今の案に振り直しが出るまでは null */
  result: ReactNode;
  /** 登録して振り直す（anneal：続けて案B も作る）。振り直せたら true */
  onReassign: (absence: Absence, anneal: boolean) => Promise<boolean>;
  onSaveOnly: (absence: Absence) => void;
  /** 欠勤を取り消す（確認ダイアログで取り消したら false） */
  onRemoveAbsence: (absence: Absence) => Promise<boolean>;
  onCancelVisit: (visitId: string, sameDay: boolean) => void;
  /** この割当で確定（確認ダイアログで取り消したら false） */
  onAdopt: () => Promise<boolean>;
  /** 元の案に戻す（確認ダイアログで取り消したら false）。振り直していなければ undefined */
  onRevert?: () => Promise<boolean>;
  /** 閉じる（toBar：日の画面の差の欄へ移る） */
  onClose: (toBar: boolean) => void;
  fallbackFocus?: () => HTMLElement | null;
  returnFocus?: () => HTMLElement | null;
}) {
  const [step, setStep] = useState<SuddenStep>(init.staffId ? 2 : init.kind ? 2 : 1);
  const [kind, setKind] = useState<SuddenKind | null>(init.kind ?? (init.staffId ? 'staff' : null));
  const [staffId, setStaffId] = useState<string>(init.staffId ?? '');
  const [draft, setDraft] = useState<AbsenceDraft>(() => draftOf(slotsOf.get(init.staffId ?? '')?.absence ?? null));
  const [visitId, setVisitId] = useState('');
  const [sameDay, setSameDay] = useState(true);
  const [done, setDone] = useState<Done | null>(null);
  const [busy, setBusy] = useState(false);

  const av = staffId ? slotsOf.get(staffId) : undefined;
  const existing = av?.absence ?? null;
  const baseSlots = av?.baseSlots ?? [];
  const error = draftError(draft);
  const absence = staffId ? absenceOfDraft(draft, staffId, date, existing) : null;
  // 見込みは3段目だけで出す（メモは見込みに効かないので key に入れない）
  const key = absence ? JSON.stringify([absence.staffId, absence.from, absence.to]) : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: 入力（key）とデータが変わったときだけ見込みを作り直す
  const preview = useMemo(
    () => (step === 3 && kind === 'staff' && absence && !error ? previewOf(data, date, absence) : null),
    [step, kind, key, data, date, error],
  );
  const blocked = reassignBlocked({
    error,
    running,
    hasPreview: !!preview,
    hasBase: preview?.baseFrom !== null,
  });
  const names = suddenSteps(kind);
  const pickStaff = (id: string) => {
    setStaffId(id);
    setDraft(draftOf(slotsOf.get(id)?.absence ?? null));
  };
  const go = (s: SuddenStep) => setStep(s);
  const withId = (a: Absence): Absence => ({ ...a, id: existing?.id ?? newId('a') });
  const guarded = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const reassignNow = (anneal: boolean) =>
    guarded(async () => {
      if (!absence || blocked) return;
      const a = withId(absence);
      if (!(await onReassign(a, anneal))) return;
      setDone({ kind: 'staff', text: absenceSummary(staffName(a.staffId), a, baseSlots) });
      go(4);
    });
  const cancelNow = () => {
    if (!visitId) return;
    const info = visitInfo(visitId);
    onCancelVisit(visitId, sameDay);
    setDone({ kind: 'client', text: `${info.client} ${info.window}`, sameDay });
    go(4);
  };
  const close = () => onClose(done?.kind === 'staff');

  const stepHeading = (text: string) => (
    <h3 className="sudden-step-title" tabIndex={-1} data-return-focus>
      {text}
    </h3>
  );

  let body: ReactNode = null;
  let footer: ReactNode = null;
  const back = (to: SuddenStep) => (
    <button type="button" className="btn" onClick={() => go(to)} data-testid="sudden-back">
      <WithIcon icon={ChevronLeft}>戻る</WithIcon>
    </button>
  );
  const closeBtn = (
    <button type="button" className="btn" onClick={close} data-testid="sudden-close">
      <WithIcon icon={X}>閉じる</WithIcon>
    </button>
  );

  if (step === 1) {
    const absentNow = staffList.filter((s) => s.absent);
    body = (
      <>
        {stepHeading('何が起きましたか？')}
        <div className="sudden-choices">
          <button
            type="button"
            className="card sudden-choice"
            data-testid="sudden-kind-staff"
            onClick={() => {
              setKind('staff');
              go(2);
            }}
          >
            <UserRoundX size={22} aria-hidden="true" />
            <span className="sudden-choice-text">
              <strong>{terms.staff}が休む</strong>
              <span className="sub">急な欠勤・遅刻・早退。休む人の訪問を、ほかの人へ振り直します</span>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="card sudden-choice"
            data-testid="sudden-kind-client"
            onClick={() => {
              setKind('client');
              go(2);
            }}
          >
            <CalendarX2 size={22} aria-hidden="true" />
            <span className="sudden-choice-text">
              <strong>{terms.client}がキャンセル</strong>
              <span className="sub">当日キャンセル。その訪問を取り消し、今の案から外します</span>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
        {absentNow.length > 0 && (
          <div className="stack sudden-existing" style={{ gap: 4 }} data-testid="sudden-existing">
            <strong>この日の欠勤（直す・取り消す）</strong>
            {absentNow.map((s) => (
              <button
                key={s.id}
                type="button"
                className="link-btn"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => {
                  setKind('staff');
                  pickStaff(s.id);
                  go(2);
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </>
    );
    footer = closeBtn;
  } else if (step === 2 && kind === 'staff') {
    body = (
      <>
        {stepHeading(`休む${terms.staff}と時間帯`)}
        {staffList.length === 0 ? (
          <p className="sub">この日に働く{terms.staff}がいません</p>
        ) : (
          <label className="field">
            <span className="field-label">休む人</span>
            <select value={staffId} onChange={(e) => pickStaff(e.target.value)} data-testid="sudden-staff">
              <option value="">選んでください</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {staffId && (
          <AbsenceFields
            draft={draft}
            onChange={(x) => setDraft((cur) => ({ ...cur, ...x }))}
            baseSlots={baseSlots}
            existing={existing}
            date={date}
            error={error}
          />
        )}
      </>
    );
    footer = (
      <>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!staffId || !!error}
          onClick={() => go(3)}
          data-testid="sudden-next"
        >
          <WithIcon icon={ChevronRight}>次へ：影響を見る</WithIcon>
        </button>
        {back(1)}
      </>
    );
  } else if (step === 2 && kind === 'client') {
    body = (
      <>
        {stepHeading('キャンセルの訪問')}
        {visitList.length === 0 ? (
          <p className="sub">この日に取り消せる訪問がありません</p>
        ) : (
          <label className="field">
            <span className="field-label">訪問</span>
            <select value={visitId} onChange={(e) => setVisitId(e.target.value)} data-testid="sudden-visit">
              <option value="">選んでください</option>
              {visitList.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <fieldset className="stack cancel-kind" style={{ gap: 6 }}>
          <legend>取り消しの種類</legend>
          <label className="check">
            <input
              type="radio"
              name="sudden-cancel-kind"
              checked={sameDay}
              onChange={() => setSameDay(true)}
              style={{ width: 'auto' }}
              data-testid="sudden-same-day"
            />
            当日キャンセル（その日になって{terms.client}の都合で取りやめ）
          </label>
          <label className="check">
            <input
              type="radio"
              name="sudden-cancel-kind"
              checked={!sameDay}
              onChange={() => setSameDay(false)}
              style={{ width: 'auto' }}
            />
            ふつうの取り消し（前もって決まった休み・予定の変更など）
          </label>
        </fieldset>
      </>
    );
    footer = (
      <>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!visitId}
          onClick={() => go(3)}
          data-testid="sudden-next"
        >
          <WithIcon icon={ChevronRight}>次へ：影響を見る</WithIcon>
        </button>
        {back(1)}
      </>
    );
  } else if (step === 3 && kind === 'staff' && absence) {
    const impact = preview ? impactText(preview.targets) : null;
    const hasBase = !!preview && preview.baseFrom !== null;
    body = (
      <>
        {stepHeading('影響と振り直し')}
        <p>
          <strong>{absenceSummary(staffName(absence.staffId), absence, baseSlots)}</strong>
          {absence.note ? `（${absence.note}）` : ''}
        </p>
        <div aria-live="polite" className="stack" style={{ gap: 8 }}>
          {!preview ? (
            <p className="sub">見込みを出せませんでした</p>
          ) : (
            <div className="stack absence-preview" style={{ gap: 4 }} data-testid="absence-preview">
              <strong className="sudden-impact" data-testid="sudden-impact">
                {impact?.title}
              </strong>
              {preview.targets.length > 0 && <span className="sub">{impact?.detail}</span>}
              <AbsenceTargets targets={preview.targets} visitLabel={visitLabel} />
            </div>
          )}
          {preview && !hasBase && (
            <p className="warn-text" data-testid="sudden-no-plan">
              この日はまだ案がありません。欠勤だけ登録できます（案を作るときは欠勤を除いて作ります）
            </p>
          )}
          {hasBase && preview && (
            <div className="stack sudden-options" style={{ gap: 8 }}>
              <div className="sudden-option">
                <strong>空き時間に入れる（案A）</strong>
                <span className="sub">
                  ほかの人の担当・順番・時刻は変えず、空き時間に入れます。
                  {preview.unplacedA > 0
                    ? `${preview.unplacedA}件が入らない見込みです`
                    : preview.targets.length > 0
                      ? 'すべて入る見込みです'
                      : ''}
                  （元の案：{preview.baseFrom === 'confirmed' ? '確定した割当' : '今の案'}）
                </span>
              </div>
              <div className="sudden-option" data-testid="anneal-suggest">
                <strong className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  少し動かしてよい（案B）
                  {preview.unplacedA > 0 && <span className="chip chip-primary">おすすめ</span>}
                </strong>
                <span className="sub">
                  案A を作ったあと、ほかの人の訪問も少し動かして入れる案を AI が作ります（少し時間がかかります）。案A
                  と比べて選べます
                </span>
                <button
                  type="button"
                  className="btn btn-small"
                  style={{ alignSelf: 'flex-start' }}
                  disabled={!!blocked || busy}
                  title={blocked ?? undefined}
                  onClick={() => void reassignNow(true)}
                  data-testid="sudden-anneal"
                >
                  登録して、案B も作る
                </button>
              </div>
            </div>
          )}
          {blocked && hasBase && <p className="sub">押せません：{blocked}</p>}
        </div>
      </>
    );
    footer = (
      <>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!!blocked || busy}
          title={blocked ?? undefined}
          onClick={() => void reassignNow(false)}
          data-testid="sudden-reassign"
        >
          <WithIcon icon={Send}>登録して振り直す（案A）</WithIcon>
        </button>
        <button
          type="button"
          className="btn"
          disabled={!!error || busy}
          onClick={() => onSaveOnly(withId(absence))}
          data-testid="sudden-save-only"
        >
          欠勤だけ登録
        </button>
        {existing && (
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={() =>
              void guarded(async () => {
                await onRemoveAbsence(existing);
              })
            }
            data-testid="sudden-remove"
          >
            <WithIcon icon={Trash2}>欠勤を取り消す</WithIcon>
          </button>
        )}
        {back(2)}
      </>
    );
  } else if (step === 3 && kind === 'client' && visitId) {
    const info = visitInfo(visitId);
    body = (
      <>
        {stepHeading('影響の確認')}
        <p>
          <strong>
            {info.client} {info.window}
          </strong>{' '}
          の訪問を{sameDay ? '当日キャンセルとして' : ''}取り消します。
        </p>
        <ul className="sudden-targets" data-testid="sudden-cancel-impact">
          {cancelImpact({ owner: info.owner, sameDay, clientWord: terms.client, hasPlan }).map((x) => (
            <li key={x} className="sub">
              {x}
            </li>
          ))}
        </ul>
      </>
    );
    footer = (
      <>
        <button type="button" className="btn btn-danger" onClick={cancelNow} data-testid="sudden-cancel-ok">
          <WithIcon icon={Ban}>{sameDay ? '当日キャンセルとして取り消す' : '取り消す'}</WithIcon>
        </button>
        {back(2)}
      </>
    );
  } else if (step === 4 && done) {
    const canAdopt = hasPlan && confirmState !== 'same';
    body = (
      <>
        {stepHeading(done.kind === 'staff' ? '選んで確定' : '確定')}
        <p className="row" style={{ gap: 6 }} data-testid="sudden-done">
          <Check size={16} aria-hidden="true" />
          {done.kind === 'staff'
            ? `${done.text}を登録して振り直しました`
            : `${done.text} を${done.sameDay ? '当日キャンセルとして' : ''}取り消しました`}
        </p>
        {done.kind === 'staff' &&
          (result ?? (
            <p className="sub" aria-live="polite">
              振り直しを出しています…
            </p>
          ))}
        <p className="sub" data-testid="sudden-confirm-note">
          {confirmNote(hasPlan ? confirmState : null)}
        </p>
      </>
    );
    footer = (
      <>
        {canAdopt && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={running || busy}
            title={running ? '計算中は押せません' : undefined}
            onClick={() =>
              void guarded(async () => {
                if (await onAdopt()) onClose(false);
              })
            }
            data-testid="sudden-adopt"
          >
            <WithIcon icon={CircleCheck}>この割当で確定</WithIcon>
          </button>
        )}
        {done.kind === 'staff' && onRevert && (
          <button
            type="button"
            className="btn"
            disabled={running || busy}
            onClick={() =>
              void guarded(async () => {
                if (await onRevert()) onClose(false);
              })
            }
            data-testid="sudden-revert"
          >
            <WithIcon icon={Undo2}>元の案に戻す</WithIcon>
          </button>
        )}
        {done.kind === 'staff' && (
          <button type="button" className="btn" onClick={() => onClose(true)} data-testid="sudden-to-bar">
            <WithIcon icon={UserRoundCheck}>日の画面で差を見る</WithIcon>
          </button>
        )}
        {closeBtn}
      </>
    );
  }

  return (
    <SidePanel
      narrow
      icon={UserRoundX}
      title="欠勤・キャンセル"
      onClose={close}
      focusKey={`${step}-${kind ?? ''}`}
      fallbackFocus={fallbackFocus}
      returnFocus={returnFocus}
      footer={footer}
    >
      <div className="stack sudden-panel" style={{ gap: 12 }} data-testid="sudden-panel" data-step={step}>
        <ol className="sudden-steps" aria-label="段階">
          {names.map((n, i) => {
            const s = (i + 1) as SuddenStep;
            return (
              <li
                key={n}
                className={s === step ? 'is-current' : s < step ? 'is-done' : ''}
                aria-current={s === step ? 'step' : undefined}
              >
                <span className="sudden-step-no" aria-hidden="true">
                  {s < step ? <Check size={12} /> : s}
                </span>
                {n}
              </li>
            );
          })}
        </ol>
        {body}
      </div>
    </SidePanel>
  );
}
