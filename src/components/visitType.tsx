// 訪問の種類の印（色の丸と名前。ADR-0012）。予定の画面のカード・一覧、種類・〈利用者さん〉の画面で共通
import './visitType.css';
import type { VisitType } from '../contracts/documents';
import { colorOf } from '../lib/colors';

/** 種類の色の丸（name は読み上げ・title） */
export function TypeDot({ type, size = 10 }: { type: VisitType; size?: number }) {
  return (
    <span
      className="type-dot"
      style={{ background: colorOf(type.color), width: size, height: size }}
      title={`種類：${type.name}`}
      aria-hidden="true"
    />
  );
}

/** 種類の印（色の丸＋名前）。種類なしなら何も出さない */
export function TypeMark({ type, compact = false }: { type: VisitType | null; compact?: boolean }) {
  if (!type) return null;
  return (
    <span className={`type-mark${compact ? ' is-compact' : ''}`} title={`種類：${type.name}`} data-testid="type-mark">
      <TypeDot type={type} />
      <span className="sr-only">種類：</span>
      <span className="type-mark-name">{type.name}</span>
    </span>
  );
}
