// 用語の説明の部品（PRD D175。ADR-0025 追記）。用語に、その場で読める短い説明を付ける。
// マウスを重ねる・キーボードでフォーカスする（:focus-visible）と出し、タッチ（押す）で開け閉めする。説明は role="tooltip" で、
// 用語のボタンの aria-describedby から引く（閉じている間も文書の中に置き、読み上げは開け閉めに頼らない）。
// 位置は押して出す吹き出し（DetailPopover）と同じ popoverPlace で、画面の端で切れない。Esc で閉じる（ほかの欄の Esc は奪わない：
// 説明が出ているときだけ取る）。説明の上にマウスを移しても消えない。
// 見た目（PRD D240・D241。ADR-0037）：点線の下線はやめ、用語の後ろの小さな ⓘ（lucide の Info）を目印にする。
// ボタンは用語の文字と ⓘ をまとめた1つ（読み上げの名前＝見える用語の文字）。タッチでは ⓘ のまわり 44px を押せる。
// 1画面で同じ語は最初の1か所だけ説明を付け、2か所目からは plain で文字だけにする
import { Info } from 'lucide-react';
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GLOSSARY, type GlossaryKey, glossaryText } from '../lib/glossary';
import { useDemoData } from '../store';
import { popoverPlace } from './DetailPopover';
import './term.css';

/** マウスが用語から離れてから説明を消すまで（ms。説明の上へ移る間は消さない） */
const LEAVE_MS = 150;
/** 用語の説明を開いたときの知らせ（detail は説明の id。ほかの用語は閉じる） */
const TERM_OPEN_EVENT = 'term-open';

/**
 * 浮かせた説明（role="tooltip"）。anchor の下（入らなければ上）に、画面の端で切れない位置に置く。
 * open でないときは hidden（aria-describedby の先として文書には残す）
 */
export function TipBubble({
  id,
  anchor,
  open,
  children,
  onPointerEnter,
  onPointerLeave,
  testId,
  className = '',
}: {
  id: string;
  anchor: () => HTMLElement | null;
  open: boolean;
  children: ReactNode;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  testId?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: anchor は呼ぶ側の要素を引くだけ。開いたとき・中身が変わったときに置き直す
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !open) return;
    const put = () => {
      const a = anchor();
      if (!a) return;
      // 前に付けた maxHeight で縮んだ高さで置かないよう、中身の高さ（scrollHeight＋枠）で測る
      const frame = el.offsetHeight - el.clientHeight;
      const p = popoverPlace(
        a.getBoundingClientRect(),
        { width: el.offsetWidth, height: el.scrollHeight + frame },
        { width: window.innerWidth, height: window.innerHeight },
      );
      el.style.top = `${Math.round(p.top)}px`;
      el.style.left = `${Math.round(p.left)}px`;
      el.style.maxHeight = `${Math.round(p.maxHeight)}px`;
    };
    put();
    const ro = new ResizeObserver(put);
    ro.observe(el);
    window.addEventListener('resize', put);
    window.addEventListener('scroll', put, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', put);
      window.removeEventListener('scroll', put, true);
    };
  }, [open, children]);
  return createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      className={`term-tip ${className}`}
      hidden={!open}
      data-testid={testId}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * 用語（文字と ⓘ のボタン）と、その説明。k は用語のキー（lib/glossary）。children を渡すとその文字を出す（既定は言い換えた名前）。
 * 開き方：マウスを重ねる・Tab でフォーカス・押す（タッチ。もう一度押す・外を押すと閉じる）。閉じ方：離れる・フォーカスが外れる・Esc。
 * plain なら説明を付けず文字だけ（同じ画面の2か所目から。PRD D241）
 */
export function Term({
  k,
  children,
  testId,
  id,
  plain = false,
}: {
  k: GlossaryKey;
  children?: ReactNode;
  testId?: string;
  /** 用語のボタンの id（入力欄の aria-labelledby から引くとき。PR #42 のレビュー：label の中には置かない） */
  id?: string;
  /** 説明を付けず文字だけ出す（1画面で同じ語の2か所目から） */
  plain?: boolean;
}) {
  if (plain) return <>{children ?? GLOSSARY[k].label}</>;
  return (
    <TermButton k={k} testId={testId} id={id}>
      {children}
    </TermButton>
  );
}

/** 説明つきの用語のボタン（Term の中身。plain でないとき） */
function TermButton({
  k,
  children,
  testId,
  id,
}: {
  k: GlossaryKey;
  children?: ReactNode;
  testId?: string;
  id?: string;
}) {
  const { data } = useDemoData();
  const text = glossaryText(k, data.org.terms);
  const uid = useId();
  const tipId = `term-${uid.replace(/:/g, '')}`;
  const btn = useRef<HTMLButtonElement>(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  /** Esc で閉じた（離れる・フォーカスが外れるまで出し直さない） */
  const [dismissed, setDismissed] = useState(false);
  const leaveTimer = useRef<number | null>(null);
  const open = !dismissed && (pinned || hover || focus);

  const cancelLeave = () => {
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  };
  const enter = () => {
    cancelLeave();
    setHover(true);
  };
  const leave = () => {
    cancelLeave();
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null;
      setHover(false);
      setDismissed(false);
    }, LEAVE_MS);
  };
  // 消えるときに待っている時計を止める
  useEffect(
    () => () => {
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    },
    [],
  );

  // 同時に出す説明は1つだけ（PR #42 のレビュー）：開いたら知らせ、ほかの用語は閉じる
  useEffect(() => {
    if (open) window.dispatchEvent(new CustomEvent(TERM_OPEN_EVENT, { detail: tipId }));
  }, [open, tipId]);
  useEffect(() => {
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail === tipId) return;
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
      setHover(false);
      setFocus(false);
      setPinned(false);
    };
    window.addEventListener(TERM_OPEN_EVENT, onOther);
    return () => window.removeEventListener(TERM_OPEN_EVENT, onOther);
  }, [tipId]);

  // 出ている間：Esc で閉じる（フォーカスが無く、マウスを重ねて出したときも）・押して開いたときは外を押すと閉じる
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      // 説明を閉じるだけにする（欄・吹き出しの Esc を奪わないよう、出ているときだけ取る）
      e.preventDefault();
      e.stopPropagation();
      setDismissed(true);
      setPinned(false);
    };
    const onDown = (e: PointerEvent) => {
      if (btn.current?.contains(e.target as Node)) return;
      if (document.getElementById(tipId)?.contains(e.target as Node)) return;
      setPinned(false);
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open, tipId]);

  return (
    <>
      <button
        ref={btn}
        id={id}
        type="button"
        className="term"
        aria-describedby={tipId}
        data-testid={testId}
        data-term={k}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') enter();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') leave();
        }}
        onFocus={(e) => {
          // マウスで押したときのフォーカスでは出さない（押した＝開け閉めに任せる）。キーボードで来たときだけ
          if (e.currentTarget.matches(':focus-visible')) setFocus(true);
        }}
        onBlur={() => {
          setFocus(false);
          setPinned(false);
          // 押して閉じたあとマウスが上に残っていれば、離れるまで出し直さない
          if (!hover) setDismissed(false);
        }}
        onClick={(e) => {
          // 表の行・ラベルの中に置いても、押したときに行の操作・入力欄へのフォーカスを起こさない
          e.preventDefault();
          e.stopPropagation();
          // 押して開いたもの（pinned）は、マウスが上にあっても、もう一度押せば閉じる。そうでなければ押して開く（PR #42 のレビュー）
          if (pinned) {
            setPinned(false);
            setDismissed(true);
          } else {
            setDismissed(false);
            setPinned(true);
          }
        }}
      >
        {children ?? GLOSSARY[k].label}
        {/* 説明がある目印（ⓘ）。文字を持たないので innerText・読み上げの名前は用語の文字のまま */}
        <span className="term-i" aria-hidden="true">
          <Info size={13} strokeWidth={2.2} />
        </span>
      </button>
      <TipBubble
        id={tipId}
        anchor={() => btn.current}
        open={open}
        onPointerEnter={enter}
        onPointerLeave={leave}
        testId="term-tip"
      >
        {text}
      </TipBubble>
    </>
  );
}
