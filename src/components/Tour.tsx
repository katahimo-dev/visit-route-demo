import { Compass } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Terms } from '../contracts/documents';
import { jstDate } from '../domain/time';
import { trapTarget } from '../lib/confirmDialog';
import { dayHref } from '../lib/links';
import {
  shouldAutoOpenTour,
  TOUR_TODAY_LABEL,
  type TourMove,
  tourCountText,
  tourMove,
  tourNextLabel,
  tourSteps,
} from '../lib/tour';
import { useFeatures } from '../lib/useFeature';
import { tourMemory } from '../store';
import { IS_MAC } from './CommandPalette';
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
  const { search } = useLocation();
  // 起動したときの URL で決める（?id=・?do= のリンクで開いたときは出さない。PRD D192）
  const [open, setOpen] = useState(() => shouldAutoOpenTour(tourMemory.seen(), search));
  const openTour = useCallback(() => setOpen(true), []);
  const close = useCallback(() => {
    tourMemory.markSeen();
    setOpen(false);
  }, []);
  const navigate = useNavigate();
  /** 最後の枚の「今日の予定を開く」：閉じて今日の日の画面へ（PRD D226） */
  const openToday = useCallback(() => {
    close();
    navigate(dayHref(jstDate(Date.now())));
  }, [close, navigate]);
  return (
    <Ctx.Provider value={openTour}>
      {children}
      {open && <TourDialog terms={terms} onClose={close} onToday={openToday} />}
    </Ctx.Provider>
  );
}

/**
 * 画面の中央のカード（PRD D192）。確認ダイアログ（ADR-0026）と同じ流儀：body の直下に出し、body のほかの子を inert（inertLock）、
 * 裏を巻かない、Tab は中で回す、Esc は「とばす」と同じ、閉じたら開く前の要素へフォーカスを戻す。
 * 最初のフォーカスは「次へ」。枚が変わってフォーカスが外れたら（最初の枚で「戻る」が押せなくなったとき）「次へ」へ。
 * 最後の枚は「次へ」が「閉じる」になり、主ボタン「今日の予定を開く」を添える（「とばす」は出さない。PRD D226）
 */
function TourDialog({
  terms,
  onClose,
  onToday,
}: {
  terms: Pick<Terms, 'client' | 'staff'>;
  onClose: () => void;
  onToday: () => void;
}) {
  // 切った機能の枚は出さない（PRD D213）
  const steps = tourSteps(terms, IS_MAC, useFeatures());
  const [rawIndex, setIndex] = useState(0);
  // 開いている間に別のタブで機能を切って枚が減っても、ある枚に収める
  const index = Math.min(rawIndex, steps.length - 1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
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
      const list = [...boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
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
    const at = document.activeElement;
    if (!(at instanceof Node) || !boxRef.current?.contains(at) || (at as HTMLButtonElement).disabled)
      nextRef.current?.focus();
  }, [index]);
  // 最後の枚まで進んだら、閉じる前でも見たことにする（読み直しても最初から出さない）
  useEffect(() => {
    if (index === steps.length - 1) tourMemory.markSeen();
  }, [index, steps.length]);
  const go = (move: TourMove) => {
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
            <button type="button" className="btn btn-small btn-primary" onClick={onToday} data-testid="tour-today">
              {TOUR_TODAY_LABEL}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
