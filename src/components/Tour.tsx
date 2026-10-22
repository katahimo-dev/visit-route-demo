import { Compass } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import type { DemoData } from '../contracts/data';
import type { Terms } from '../contracts/documents';
import { jstDate } from '../domain/time';
import { trapTarget } from '../lib/confirmDialog';
import { applyTemplate, matchTemplate } from '../lib/features';
import { confirmLeave } from '../lib/leaveGuard';
import { dayHref } from '../lib/links';
import {
  shouldAutoOpenTour,
  TOUR_START_CHOICES,
  TOUR_START_NOTE,
  TOUR_START_QUESTION,
  TOUR_TODAY_LABEL,
  type TourMove,
  type TourStartChoice,
  tourCountText,
  tourMove,
  tourNextLabel,
  tourSteps,
} from '../lib/tour';
import { useFeatures } from '../lib/useFeature';
import { tourMemory, useDemoData } from '../store';
import { FOCUSABLE } from './ui';
import { inertLock, useBodyScrollLock } from './useBodyScrollLock';
import './tour.css';

/** 案内を開く関数（データの画面の「案内をもう一度見る」） */
const Ctx = createContext<() => void>(() => {});
export const useTour = () => useContext(Ctx);

/**
 * 初回の案内ツアー（PRD D192・D193。ADR-0025 追記）。管理の画面（AdminShell）で1つ。
 * まだ見ていない（とばしていない）ときは起動したときに開く（?id=・?do= のリンクで開いたときは開かない）。
 * 閉じたら（とばす・Esc・はじめる）・最後の枚まで進んだら、見たことを覚える（store/tour）
 */
export function TourProvider({ terms, children }: { terms: Pick<Terms, 'client' | 'staff'>; children: ReactNode }) {
  const { search, pathname } = useLocation();
  const { startedFresh, data, reset, update } = useDemoData();
  // 起動したときの URL で決める（?id=・?do= のリンクで開いたときは出さない。PRD D192）
  const [open, setOpen] = useState(() => shouldAutoOpenTour(tourMemory.seen(), search, pathname));
  // 初めて開いた（保存データが無かった）ときに自動で開いたツアーだけ、1枚目で「どこまで使うか」を聞く（PRD D276）。
  // 「案内をもう一度見る」では聞かない（機能の入り切りは管理者設定で）
  const [ask, setAsk] = useState(() => open && startedFresh);
  const openTour = useCallback(() => {
    setAsk(false);
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    tourMemory.markSeen();
    setOpen(false);
  }, []);
  /**
   * 起動したまま手の入っていないデータ（初期データか、ここで作り直したデータ）。別のタブの変更・画面での変更があれば違う物になる。
   * 「どこまで使うか」は、手が入っていなければ初期データを作り直し（案の記録の入り切りもそろう）、入っていれば入り切りだけ書き換える
   * （作り直して別のタブの変更を消さない。PRD D276）
   */
  const pristine = useRef<DemoData | null>(startedFresh ? data : null);
  const awaitReset = useRef(false);
  useEffect(() => {
    if (!awaitReset.current) return;
    awaitReset.current = false;
    pristine.current = data;
  }, [data]);
  const choose = useCallback(
    (id: TourStartChoice['id']) => {
      const features = applyTemplate(id);
      if (pristine.current !== null && pristine.current === data) {
        awaitReset.current = true;
        reset(features);
      } else {
        update((d) => ({ ...d, org: { ...d.org, features } }), '機能の入り切り');
      }
    },
    [data, reset, update],
  );
  const navigate = useNavigate();
  /** 最後の枚の「今日の予定を開く」：閉じて今日の日の画面へ（PRD D226） */
  const openToday = useCallback(() => {
    close();
    // 下書きのある画面（条件の重み）から移るときは確かめる（断れば留まる。PRD D286）
    void confirmLeave().then((ok) => {
      if (ok) navigate(dayHref(jstDate(Date.now())));
    });
  }, [close, navigate]);
  return (
    <Ctx.Provider value={openTour}>
      {children}
      {open && <TourDialog terms={terms} ask={ask} onChoose={choose} onClose={close} onToday={openToday} />}
    </Ctx.Provider>
  );
}

/**
 * 画面の中央のカード（PRD D192）。確認ダイアログ（ADR-0026）と同じ流儀：body の直下に出し、body のほかの子を inert（inertLock）、
 * 裏を巻かない、Tab は中で回す、Esc は「とばす」と同じ、閉じたら開く前の要素へフォーカスを戻す。
 * 最初のフォーカスは「次へ」。枚が変わってフォーカスが外れたら（最初の枚で「戻る」が押せなくなったとき）「次へ」へ。
 * 最後の枚は「次へ」が「閉じる」になり、主ボタン「今日の予定を開く」を添える（「とばす」は出さない。PRD D226）。
 * 最後の枚に入ったらフォーカスは「今日の予定を開く」へ
 */
function TourDialog({
  terms,
  ask,
  onChoose,
  onClose,
  onToday,
}: {
  terms: Pick<Terms, 'client' | 'staff'>;
  /** 1枚目で「どこまで使うか」を聞く（初めて開いたときだけ。PRD D276） */
  ask: boolean;
  /** 1枚目の選択を当てる（1枚目を離れるとき＝次へ・とばす・Esc） */
  onChoose: (id: TourStartChoice['id']) => void;
  onClose: () => void;
  onToday: () => void;
}) {
  const features = useFeatures();
  const now = matchTemplate(features);
  /** 1枚目で選んでいるもの（矢印で選び直すたびには当てず、1枚目を離れるときに当てる。PRD D276） */
  const [choice, setChoice] = useState<TourStartChoice['id'] | null>(now === 'basic' || now === 'all' ? now : null);
  const applyChoice = () => {
    if (ask && choice !== null && choice !== matchTemplate(features)) onChoose(choice);
  };
  const applyRef = useRef(applyChoice);
  applyRef.current = applyChoice;
  const indexRef = useRef(0);
  // 切った機能の枚は出さない（PRD D213）
  const steps = tourSteps(terms, features);
  const [rawIndex, setIndex] = useState(0);
  // 開いている間に別のタブで機能を切って枚が減っても、ある枚に収める
  const index = Math.min(rawIndex, steps.length - 1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  /** 最後の枚の主ボタン「今日の予定を開く」（最後の枚に入ったらここへフォーカス。PRD D226） */
  const todayRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = () => {
    // Esc（とばすと同じ）で閉じるときも、1枚目で選んだものを当てる
    if (indexRef.current === 0) applyRef.current();
    onClose();
  };
  const titleId = useId();
  const bodyId = useId();
  useBodyScrollLock();
  useEffect(() => {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseInert = inertLock.lock(
      Array.from(document.body.children).filter(
        (el): el is HTMLElement => el instanceof HTMLElement && el !== wrapRef.current,
      ),
    );
    nextRef.current?.focus();
    // 捕捉の段で受け、右の欄・引き出し・コマンドパレットのキー（document・window で受けている）に渡さない
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !boxRef.current) return;
      e.stopPropagation();
      // ラジオは選んでいる方だけ Tab で止まる（標準の radio group と同じ。切り替えは矢印）
      const box = boxRef.current;
      const list = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) =>
          !(el instanceof HTMLInputElement) ||
          el.type !== 'radio' ||
          el.checked ||
          !box.querySelector(`input[type="radio"][name="${CSS.escape(el.name)}"]:checked`),
      );
      const at = document.activeElement;
      const to = trapTarget(list.length, at instanceof HTMLElement ? list.indexOf(at) : -1, e.shiftKey);
      if (to === null) return;
      e.preventDefault();
      list[to]?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      releaseInert();
      if (back?.isConnected && back !== document.body) back.focus({ preventScroll: true });
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 枚が変わったときだけ
  useEffect(() => {
    // 最後の枚は次の一手の主ボタン「今日の予定を開く」へ
    if (index === steps.length - 1 && todayRef.current) {
      todayRef.current.focus();
      return;
    }
    const at = document.activeElement;
    if (!(at instanceof Node) || !boxRef.current?.contains(at) || (at as HTMLButtonElement).disabled)
      nextRef.current?.focus();
  }, [index]);
  // 最後の枚まで進んだら、閉じる前でも見たことにする（読み直しても最初から出さない）
  useEffect(() => {
    if (index === steps.length - 1) tourMemory.markSeen();
  }, [index, steps.length]);
  indexRef.current = index;
  const go = (move: TourMove) => {
    if (index === 0) applyChoice();
    const to = tourMove(index, steps.length, move);
    if (to === null) onClose();
    else setIndex(to);
  };
  const step = steps[index]!;
  const last = index === steps.length - 1;
  return createPortal(
    <div ref={wrapRef} className="tour-wrap" data-testid="tour-wrap">
      <div className="tour-backdrop" aria-hidden="true" />
      <div
        ref={boxRef}
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-testid="tour"
        data-step={step.key}
      >
        <div className="tour-head">
          <span className="tour-icon" aria-hidden="true">
            <Compass size={20} strokeWidth={2.2} />
          </span>
          <span className="tour-count" data-testid="tour-count">
            使い方の案内 {tourCountText(index, steps.length)}
          </span>
        </div>
        {/* 枚が変わったら読み上げる（見出しと本文） */}
        <div className="tour-main" aria-live="polite">
          <h2 id={titleId} data-testid="tour-title">
            {step.title}
          </h2>
          <div id={bodyId} className="tour-body" data-testid="tour-body">
            <p>{step.body}</p>
            {step.points && (
              <ol className="tour-points" data-testid="tour-points">
                {step.points.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ol>
            )}
          </div>
          <p className="tour-where">
            <strong>場所：</strong>
            {step.where}
          </p>
        </div>
        {ask && index === 0 && <StartChoice current={choice} onPick={setChoice} />}
        <ol className="tour-dots" aria-hidden="true">
          {steps.map((s, i) => (
            <li key={s.key} className={i === index ? 'is-on' : undefined} />
          ))}
        </ol>
        <div className="tour-actions">
          {!last && (
            <button
              type="button"
              className="btn btn-small tour-skip"
              onClick={() => go('skip')}
              data-testid="tour-skip"
            >
              とばす
            </button>
          )}
          <span className="tour-spacer" />
          <button
            type="button"
            className="btn btn-small"
            disabled={index === 0}
            onClick={() => go('back')}
            data-testid="tour-back"
          >
            戻る
          </button>
          <button
            ref={nextRef}
            type="button"
            className={last ? 'btn btn-small' : 'btn btn-small btn-primary'}
            onClick={() => go('next')}
            data-testid="tour-next"
          >
            {tourNextLabel(index, steps.length)}
          </button>
          {last && (
            <button
              ref={todayRef}
              type="button"
              className="btn btn-small btn-primary"
              onClick={onToday}
              data-testid="tour-today"
            >
              {TOUR_TODAY_LABEL}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * 1枚目の「どこまで使いますか」（PRD D276）：基本／すべて の2つ（ネイティブのラジオ。Tab は選んだ方だけ、矢印で選び直す）。
 * 選んでもすぐには当てず、1枚目を離れるとき（次へ・とばす・Esc）に当てる（TourDialog の applyChoice）
 */
function StartChoice({
  current,
  onPick,
}: {
  current: TourStartChoice['id'] | null;
  onPick: (id: TourStartChoice['id']) => void;
}) {
  const name = useId();
  const titleId = useId();
  return (
    <fieldset className="tour-choice" aria-labelledby={titleId} data-testid="tour-start">
      <legend id={titleId} className="tour-choice-title">
        {TOUR_START_QUESTION}
      </legend>
      {TOUR_START_CHOICES.map((c) => (
        <label key={c.id} className={`tour-choice-item${current === c.id ? ' is-on' : ''}`}>
          <input
            type="radio"
            name={name}
            value={c.id}
            checked={current === c.id}
            onChange={() => onPick(c.id)}
            data-testid={`tour-start-${c.id}`}
          />
          <span>
            <strong>{c.label}</strong>
            <span className="tour-choice-desc">{c.description}</span>
          </span>
        </label>
      ))}
      <p className="tour-choice-note">{TOUR_START_NOTE}</p>
    </fieldset>
  );
}
