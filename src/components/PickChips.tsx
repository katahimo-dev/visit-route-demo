// 人を複数選ぶチップ（週間の時間軸の〈スタッフ〉・〈利用者さん〉。PRD D56・D57・D136）。
// 選んでいる人は aria-pressed と ✓ の印で示す（色だけに頼らない）。強調（ドラッグ中の担当できる人）は太い枠と「可」の文字
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { foldHidden } from '../lib/fold';
import type { PersonKind } from '../lib/personPopover';
import { PersonInfo } from './PersonPopover';
import './pickChips.css';

export type PickPerson = {
  id: string;
  name: string;
  /** 名前の横の色の丸（〈利用者さん〉の色）。mark があればそちらを出す */
  color?: string;
  /** 名前の横の印（〈スタッフ〉は StaffMark。PRD D298） */
  mark?: ReactNode;
  /** 名前の横の短いバッジ（資格。title に正式名） */
  badges?: { short: string; name: string }[];
};

/**
 * 複数選ぶチップ。selected が null なら全員を選んでいる。onChange は全員なら null、それ以外は選んだ ID の配列（people の順）
 */
export function PickChips({
  label,
  people,
  selected,
  onChange,
  highlight,
  highlightLabel = '担当できる',
  bulk = true,
  detailKind,
  actions,
  fold,
  testId,
}: {
  label: string;
  people: readonly PickPerson[];
  selected: readonly string[] | null;
  onChange: (next: string[] | null) => void;
  /** 強調する人（ドラッグ中の担当できる人）。null なら強調しない */
  highlight?: ReadonlySet<string> | null;
  highlightLabel?: string;
  /** 「全員」「全解除」のボタンを出すか（担当できる人の選択（ADR-0014）では出さない） */
  bulk?: boolean;
  /**
   * チップの横に詳細の「i」を置く（PRD D123。チップを押すと選ぶので、名前はボタンにしない）。
   * 渡さなければ置かない（担当できる人の選択など）
   */
  detailKind?: PersonKind;
  /** 見出しの後ろ（「全員」「全解除」の位置）に置く小さなボタン（週間の時間軸の〈利用者さん〉の「全部外す」「先頭8人に戻す」。PRD D138） */
  actions?: ReactNode;
  /**
   * 畳む（週間の時間軸の〈利用者さん〉。PRD D140）：畳んでいるときは、上から rows 行に入る人と選んでいる人だけを出し、
   * 残りは「あと N人」のボタンで開く。開いているかは呼ぶ側が持つ（open・onOpenChange）。渡さなければ畳まない
   */
  fold?: { rows: number; open: boolean; onOpenChange: (open: boolean) => void };
  testId?: string;
}) {
  const on = selected === null ? null : new Set(selected);
  const isOn = (id: string) => on === null || on.has(id);
  const toggle = (id: string) => {
    const next = people.map((p) => p.id).filter((x) => (x === id ? !isOn(x) : isOn(x)));
    onChange(next.length === people.length ? null : next);
  };
  // ---- 畳む（fold）：全員を並べて位置を測り、rows 行に入らない人（選んでいる人を除く）を描く前に外す ----
  const rootRef = useRef<HTMLFieldSetElement>(null);
  const [width, setWidth] = useState(0);
  const folding = !!fold;
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!folding || !el) return;
    setWidth(Math.round(el.clientWidth));
    const ro = new ResizeObserver(() => setWidth(Math.round(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [folding]);
  /** 測り直す鍵：幅・人・選んでいるか・見出しが変われば測り直す（ドラッグ中の強調では変えない） */
  const foldKey = fold ? `${width}|${label}|${people.map((p) => `${p.id}:${isOn(p.id) ? 1 : 0}`).join(',')}` : null;
  /** 畳んだとき隠す人（開いているあいだも測っておき、「畳む」を出すかに使う） */
  const [hiddenFor, setHiddenFor] = useState<{ key: string; ids: Set<string> } | null>(null);
  const measured = foldKey !== null && hiddenFor?.key === foldKey ? hiddenFor.ids : null;
  const hidden = fold && !fold.open ? measured : null;
  useLayoutEffect(() => {
    const root = rootRef.current;
    // 測るのは全員を並べているとき（開いている、または畳んでいてまだ測っていない）
    if (foldKey === null || measured !== null || !root || !fold) return;
    const items = [...root.querySelectorAll<HTMLElement>('[data-fold-item]')].map((el) => ({
      id: el.dataset.foldItem ?? '',
      top: el.getBoundingClientRect().top,
    }));
    const first = root.querySelector('legend')?.getBoundingClientRect().top;
    const keep = new Set(people.filter((p) => isOn(p.id)).map((p) => p.id));
    const ids = foldHidden(items, keep, fold.rows, first);
    setHiddenFor({ key: foldKey, ids });
  });
  const shown = hidden ? people.filter((p) => !hidden.has(p.id)) : people;
  return (
    <fieldset ref={rootRef} className="pick-chips" data-testid={testId}>
      <legend className="pick-chips-legend">{label}</legend>
      {bulk && (
        <>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => onChange(null)}
            disabled={selected === null}
            data-testid={testId ? `${testId}-all` : undefined}
          >
            全員
          </button>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => onChange([])}
            disabled={selected !== null && selected.length === 0}
            data-testid={testId ? `${testId}-none` : undefined}
          >
            全解除
          </button>
        </>
      )}
      {actions}
      {shown.map((p) => {
        const pressed = isOn(p.id);
        const strong = highlight?.has(p.id) ?? false;
        const chip = (
          <button
            key={p.id}
            type="button"
            className={`pick-chip${pressed ? ' is-on' : ''}${strong ? ' is-strong' : ''}${highlight && !strong ? ' is-dim' : ''}`}
            aria-pressed={pressed}
            onClick={() => toggle(p.id)}
            data-testid="pick-chip"
            data-id={p.id}
            data-fold-item={detailKind ? undefined : p.id}
          >
            <span className="pick-chip-check" aria-hidden="true">
              {pressed ? '✓' : ''}
            </span>
            {p.mark ??
              (p.color && <span className="pick-chip-color" style={{ background: p.color }} aria-hidden="true" />)}
            <span className="pick-chip-name">{p.name}</span>
            {p.badges?.map((b) => (
              <abbr key={b.name} className="pick-badge" title={b.name}>
                {b.short}
              </abbr>
            ))}
            {strong && <span className="pick-chip-strong">{highlightLabel}</span>}
          </button>
        );
        if (!detailKind) return chip;
        return (
          <span key={p.id} className="pick-chip-wrap" data-fold-item={p.id}>
            {chip}
            <PersonInfo kind={detailKind} id={p.id} name={p.name} />
          </span>
        );
      })}
      {fold && measured && measured.size > 0 && (
        <button
          type="button"
          className="btn btn-small pick-chips-more"
          aria-expanded={fold.open}
          onClick={() => fold.onOpenChange(!fold.open)}
          data-testid={testId ? `${testId}-more` : undefined}
        >
          {fold.open ? '畳む' : `あと ${measured.size}人`}
        </button>
      )}
    </fieldset>
  );
}

/** 資格の短いバッジ（表の行の見出しなど）。title に正式名 */
export function QualificationBadges({ badges }: { badges: readonly { short: string; name: string }[] }) {
  if (badges.length === 0) return null;
  return (
    <span className="pick-badges">
      {badges.map((b) => (
        <abbr key={b.name} className="pick-badge" title={b.name}>
          {b.short}
        </abbr>
      ))}
    </span>
  );
}
