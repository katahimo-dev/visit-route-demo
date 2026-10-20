// 「欠勤・キャンセル」の欄（PRD D167〜D172。ADR-0025 追記・ADR-0011・ADR-0015）：日の画面の入口・列の見出しの「急な欠勤」・
// ホームのカードから開く、段階のある右の欄。1 何が起きたか → 2 人（時間帯）・訪問を選ぶ → 3 影響の確認と振り直し → 4 選んで確定
// → 5 連絡（PRD D243〜D246。ADR-0038）。振り直しの計算は足さない（見込みは previewOf、振り直し・案B・確定・元に戻すは日の画面の
// 今の操作を呼ぶ。連絡の一覧は日の画面が lib/contacts の contactRows で作って渡す）
import {
  Ban,
  CalendarX2,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  ClipboardCopy,
  Send,
  Trash2,
  Undo2,
  UserRoundCheck,
  UserRoundX,
  X,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { MailButton, MailLengthNote } from '../components/mailParts';
import { SidePanel, WithIcon } from '../components/ui';
import type { DemoData } from '../contracts/data';
import type { Absence, Terms } from '../contracts/documents';
import type { Slot } from '../domain/availability';
import { copyText } from '../lib/clipboard';
import { newId } from '../lib/common';
import { CONTACT_KIND_LABEL, type ContactKind, type ContactRow } from '../lib/contacts';
import { NO_EMAIL } from '../lib/mail';
import type { BuiltMail } from '../lib/mailto';
import {
  type AbsenceDraft,
  absenceOfDraft,
  absenceSummary,
  cancelImpact,
  confirmNote,
  draftError,
  draftOf,
  impactText,
  noPlanText,
  reassignBlocked,
  recommendAnneal,
  type StaffChoice,
  type SuddenKind,
  type SuddenStep,
  suddenHeading,
  suddenSteps,
  type VisitChoice,
} from '../lib/sudden';
import { AbsenceFields, AbsenceTargets, previewOf } from './absenceParts';

/** 欄を開くときの初め（列の見出しからは〈スタッフ〉と人を決めて2段目から） */
export type SuddenInit = { kind?: SuddenKind; staffId?: string };

/** 種類の印の色（担当が外れる・中止は灰、新しく入るは移る色、時刻は注意の色） */
const KIND_CHIP: Record<ContactKind, string> = {
  removed: 'chip',
  added: 'chip chip-move',
  shifted: 'chip chip-warn',
  cancelled: 'chip',
  client: 'chip',
};

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
  contacts,
  contactMail,
  onCopied,
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
  /**
   * 5段目の連絡の一覧（前の確定した割当 → 新しい割当の差と、取り消した訪問から。PRD D244）。差を出せなければ null
   */
  contacts: ContactRow[] | null;
  /** 〈スタッフ〉あてのメール（PRD D94）。メールアドレスが無ければ null。メールを切っていれば渡さない（ボタンを出さない） */
  contactMail?: (row: ContactRow) => BuiltMail | null;
  /** 文をコピーしたあと（ok：できたか・what：何の文か） */
  onCopied: (ok: boolean, what: string) => void;
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
  /** 5段目で［連絡した］に印を付けた行（その場の状態だけ。データに残さない。ADR-0038） */
  const [sent, setSent] = useState<ReadonlySet<string>>(() => new Set());

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
  /** 1段目で何が起きたかを選ぶ。種類を変えたら、前に選んだ人・訪問・欠勤の入力を消す */
  const chooseKind = (k: SuddenKind) => {
    if (k !== kind) {
      setStaffId('');
      setVisitId('');
      setDraft(draftOf(null));
      setSameDay(true);
    }
    setKind(k);
    go(2);
  };
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
  // 5段目（連絡）まで進んだら差の欄へは移らない（確定まで済んでいる）
  const close = () => onClose(done?.kind === 'staff' && step < 5);
  const copyRow = (r: ContactRow) => {
    void copyText(r.text).then((ok) => onCopied(ok, `${r.name}への文`));
  };
  const toggleSent = (key: string, on: boolean) =>
    setSent((cur) => {
      const next = new Set(cur);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

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
        {stepHeading(suddenHeading(kind, 1, terms.staff))}
        <div className="sudden-choices">
          <button
            type="button"
            className="card sudden-choice"
            data-testid="sudden-kind-staff"
            onClick={() => chooseKind('staff')}
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
            onClick={() => chooseKind('client')}
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
                  chooseKind('staff');
                  pickStaff(s.id);
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
        {stepHeading(suddenHeading('staff', 2, terms.staff))}
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
        <button type="submit" className="btn btn-primary" disabled={!staffId || !!error} data-testid="sudden-next">
          <WithIcon icon={ChevronRight}>次へ：影響を見る</WithIcon>
        </button>
        {back(1)}
      </>
    );
  } else if (step === 2 && kind === 'client') {
    body = (
      <>
        {stepHeading(suddenHeading('client', 2, terms.staff))}
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
    /** 案B を勧めるときは、主ボタンを「登録して案B も作る（おすすめ）」にし、案A を2番目にする */
    const recommended = !!preview && recommendAnneal({ hasBase, unplacedA: preview.unplacedA });
    body = (
      <>
        {stepHeading(suddenHeading('staff', 3, terms.staff))}
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
              {noPlanText(running)}
            </p>
          )}
          {hasBase && preview && (
            <div className="stack sudden-options" style={{ gap: 8 }}>
              <div className="sudden-option">
                <strong>空き時間に入れる（案A）</strong>
                <span className="sub">
                  ほかの人の担当・順番・時刻は変えず、空き時間に入れます（{staffName(absence.staffId)}
                  さんの残りの訪問は、欠勤明けの移動で開始が遅れることがあります）。
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
                {!recommended && (
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
                )}
              </div>
            </div>
          )}
          {blocked && hasBase && <p className="sub">押せません：{blocked}</p>}
        </div>
      </>
    );
    const annealPrimary = recommended && (
      <button
        type="button"
        className="btn btn-primary"
        disabled={!!blocked || busy}
        title={blocked ?? undefined}
        onClick={() => void reassignNow(true)}
        data-testid="sudden-anneal"
      >
        <WithIcon icon={Send}>登録して案B も作る（おすすめ）</WithIcon>
      </button>
    );
    footer = (
      <>
        {annealPrimary}
        <button
          type="button"
          className={recommended ? 'btn' : 'btn btn-primary'}
          disabled={!!blocked || busy}
          title={blocked ?? undefined}
          onClick={() => void reassignNow(false)}
          data-testid="sudden-reassign"
        >
          <WithIcon icon={recommended ? UserRoundCheck : Send}>登録して振り直す（案A）</WithIcon>
        </button>
        <button
          type="button"
          className="btn"
          disabled={!!error || busy || running}
          title={
            running
              ? '計算中は押せません（作り終えた案で休む人に訪問が残らないよう、終わってから登録します）'
              : undefined
          }
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
        {stepHeading(suddenHeading('client', 3, terms.staff))}
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
        {stepHeading(suddenHeading(done.kind, 4, terms.staff))}
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
                if (await onAdopt()) go(5);
              })
            }
            data-testid="sudden-adopt"
          >
            <WithIcon icon={CircleCheck}>この割当で確定</WithIcon>
          </button>
        )}
        {!canAdopt && (
          <button type="button" className="btn btn-primary" onClick={() => go(5)} data-testid="sudden-to-contacts">
            <WithIcon icon={ChevronRight}>次へ：連絡</WithIcon>
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
            <WithIcon icon={UserRoundCheck}>日の予定で差を見る</WithIcon>
          </button>
        )}
        {closeBtn}
      </>
    );
  } else if (step === 5 && done) {
    const rows = contacts ?? [];
    const sentCount = rows.filter((r) => sent.has(r.key)).length;
    body = (
      <>
        {stepHeading(suddenHeading(done.kind, 5, terms.staff))}
        <p className="sub">
          確定する前の割当（無ければ振り直す前の案）と、新しい割当の差から作っています。文はコピーするか、メールアプリで開いて送ります（このアプリからは送りません）。
        </p>
        {contacts === null ? (
          <p className="sub" data-testid="sudden-contacts-none">
            差を出せませんでした。日の予定の「連絡の一覧」で確かめてください
          </p>
        ) : rows.length === 0 ? (
          <p data-testid="sudden-contacts-none">連絡が要る変更はありません。</p>
        ) : (
          <>
            <p className="sudden-contacts-count" aria-live="polite" data-testid="sudden-contacts-count">
              連絡した {sentCount}/{rows.length}人
            </p>
            <ul className="sudden-contacts" data-testid="sudden-contacts">
              {rows.map((r) => {
                const mail = r.to === 'staff' && contactMail ? contactMail(r) : null;
                return (
                  <li
                    key={r.key}
                    className={`sudden-contact${sent.has(r.key) ? ' is-sent' : ''}`}
                    data-testid="sudden-contact"
                    data-to={r.to}
                    data-kinds={r.kinds.join(' ')}
                  >
                    <div className="sudden-contact-head">
                      <strong>{r.name}</strong>
                      {r.to === 'client' ? (
                        <span className="chip">{terms.client}あて</span>
                      ) : (
                        r.kinds.map((k) => (
                          <span key={k} className={KIND_CHIP[k]}>
                            {CONTACT_KIND_LABEL[k]}
                          </span>
                        ))
                      )}
                    </div>
                    <pre className="sudden-contact-text" data-testid="sudden-contact-text">
                      {r.text}
                    </pre>
                    <div className="sudden-contact-acts">
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => copyRow(r)}
                        aria-label={`${r.name}への文をコピー`}
                        data-testid="sudden-contact-copy"
                      >
                        <WithIcon icon={ClipboardCopy} size={14}>
                          文をコピー
                        </WithIcon>
                      </button>
                      {r.to === 'staff' && contactMail && (
                        <>
                          <MailButton
                            mail={mail}
                            label="メール"
                            why={NO_EMAIL}
                            srLabel={`${r.name}へのメールを作る`}
                            testId="sudden-contact-mail"
                          />
                          <MailLengthNote mail={mail} />
                        </>
                      )}
                      <label className="check sudden-contact-sent">
                        <input
                          type="checkbox"
                          checked={sent.has(r.key)}
                          onChange={(e) => toggleSent(r.key, e.target.checked)}
                          style={{ width: 'auto' }}
                          aria-label={`${r.name}に連絡した`}
                          data-testid="sudden-contact-sent"
                        />
                        連絡した
                      </label>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </>
    );
    footer = (
      <>
        <button type="button" className="btn btn-primary" onClick={() => onClose(false)} data-testid="sudden-finish">
          <WithIcon icon={Check}>終わる</WithIcon>
        </button>
        {back(4)}
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
      // 2段目（欠勤の入力）は form にして、メモの Enter・「次へ」で進む（PRD D251）
      onSubmit={
        step === 2 && kind === 'staff'
          ? () => {
              if (staffId && !error) go(3);
            }
          : undefined
      }
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
                <span className="sudden-step-name">{n}</span>
              </li>
            );
          })}
        </ol>
        {body}
      </div>
    </SidePanel>
  );
}
