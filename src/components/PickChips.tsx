// 人を複数選ぶチップ（週間の時間軸の〈スタッフ〉・〈利用者さん〉。PRD D56・D57・D136）。
// 選んでいる人は aria-pressed と ✓ の印で示す（色だけに頼らない）。強調（ドラッグ中の担当できる人）は太い枠と「可」の文字
import type { ReactNode } from 'react';
import type { PersonKind } from '../lib/personPopover';
import { PersonInfo } from './PersonPopover';
import './pickChips.css';

export type PickPerson = {
  id: string;
  name: string;
  /** 名前の横の色の印（〈スタッフ〉の色・〈利用者さん〉の色） */
  color?: string;
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
  testId?: string;
}) {
  const on = selected === null ? null : new Set(selected);
  const isOn = (id: string) => on === null || on.has(id);
  const toggle = (id: string) => {
    const next = people.map((p) => p.id).filter((x) => (x === id ? !isOn(x) : isOn(x)));
    onChange(next.length === people.length ? null : next);
  };
  return (
    <fieldset className="pick-chips" data-testid={testId}>
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
      {people.map((p) => {
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
          >
            <span className="pick-chip-check" aria-hidden="true">
              {pressed ? '✓' : ''}
            </span>
            {p.color && <span className="pick-chip-color" style={{ background: p.color }} aria-hidden="true" />}
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
          <span key={p.id} className="pick-chip-wrap">
            {chip}
            <PersonInfo kind={detailKind} id={p.id} name={p.name} />
          </span>
        );
      })}
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
