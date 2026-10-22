import { graphemeCount, type Staff } from '../contracts/documents';
import { staffColor } from '../lib/common';
import { staffColorMap, staffMarkText } from '../lib/staffMark';
import { useDemoData } from '../store/react';
import './staffMark.css';

export type StaffMarkSize = 'xs' | 'sm' | 'md' | 'lg';

/**
 * 〈スタッフ〉の印（PRD D298。ADR-0050）：その人の色（地図の線・時間軸の帯と同じ）の角の丸い四角に、
 * アイコン（1〜2文字）か苗字の最初の1文字。〈利用者さん〉の印（丸。.dot）と形で見分ける。
 * 飾りなので読み上げない（aria-hidden）。名前は必ず横に文字で出す（色だけに頼らない）。
 * staff が無い（データから消えた人など）ときは灰色の「?」。
 * 文字は CSS（::before の attr(data-text)）で描き、DOM の文字にしない：印を足しても周りの textContent（名前の文字・
 * コピー・e2e の文字の確かめ）が変わらない
 */
export function StaffMark({
  staff,
  size = 'sm',
  className,
  color: colorOverride,
}: {
  staff: Staff | undefined;
  size?: StaffMarkSize;
  className?: string;
  /** 色を外から決める（編集中の見本：保存したあとの並びの色） */
  color?: string;
}) {
  const { data } = useDemoData();
  const color = colorOverride ?? (staff ? (staffColorMap(data.staff).get(staff.id) ?? staffColor(0)) : '#b9aea4');
  const text = staff ? staffMarkText(staff) : '?';
  return (
    <span
      className={`staff-mark staff-mark-${size}${graphemeCount(text) > 1 ? ' is-two' : ''}${className ? ` ${className}` : ''}`}
      style={{ background: color }}
      aria-hidden="true"
      data-staff-mark={staff?.id ?? ''}
      data-text={text}
    />
  );
}

/** id から引く版（staffById を持たない所で使う） */
export function StaffMarkById({ id, size, className }: { id: string; size?: StaffMarkSize; className?: string }) {
  const { data } = useDemoData();
  const staff = data.staff.find((s) => s.id === id);
  return <StaffMark staff={staff} size={size} className={className} />;
}
