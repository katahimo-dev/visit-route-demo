// 日の画面の1行のまとめの下の「担当ごとの1日」（PRD D84）。1人1行の細い横棒で、勤務の中の 訪問・移動・待ちと空き を
// 稼働の見込み（PRD D77）と同じ色・形で塗り（PRD D85）（components/workBars の PartsBar）、誰が詰まっていて誰が空いているかを見せる。
// 行を押すとその人の列へ移る（onPick）。数字は title と読み上げ（lib/dayLine の dayLineText）。狭い幅では畳む
import './dayLines.css';
import { useState } from 'react';
import { type DayLine, dayLineText } from '../lib/dayLine';
import { PersonInfo } from './PersonPopover';
import { StaffLegend } from './staffBar';
import { PartsBar } from './workBars';

/** 目盛りの時刻（2時間ごと。範囲の端を含む） */
function ticks(range: { start: number; end: number }): number[] {
  const out: number[] = [];
  for (let h = Math.ceil(range.start / 120) * 2; h * 60 <= range.end; h += 2) out.push(h);
  return out;
}

export function DayLines({
  lines,
  range,
  nameOf,
  colorOf,
  onPick,
  staffTerm,
  collapsed,
  detail = false,
}: {
  lines: readonly DayLine[];
  range: { start: number; end: number };
  nameOf: (staffId: string) => string;
  colorOf: (staffId: string) => string | undefined;
  onPick: (staffId: string) => void;
  /** org.terms.staff */
  staffTerm: string;
  /** 狭い幅：畳んで出す（押すと開く） */
  collapsed: boolean;
  /** 行の右に名前の詳細の「i」を置く（行を押すと列へ移るので、名前はボタンにしない。PRD D124） */
  detail?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (lines.length === 0) return null;
  const len = Math.max(1, range.end - range.start);
  const body = (
    <div className={`daylines-body${detail ? ' has-info' : ''}`}>
      <div className="daylines-row daylines-head" aria-hidden="true">
        <span />
        <span className="daylines-axis">
          {ticks(range).map((h) => (
            <span key={h} style={{ left: `${((h * 60 - range.start) / len) * 100}%` }}>
              {h}
            </span>
          ))}
        </span>
        <span />
      </div>
      <ul className="daylines-list">
        {lines.map((x) => {
          const text = `${nameOf(x.staffId)}さん：${dayLineText(x)}`;
          return (
            <li key={x.staffId} className="daylines-item">
              <button
                type="button"
                className="daylines-row daylines-btn"
                onClick={() => onPick(x.staffId)}
                title={`${text}（押すとこの人の列へ）`}
                aria-label={`${text}（押すとこの人の列へ）`}
                data-testid="dayline"
                data-staff={x.staffId}
              >
                <span className="daylines-name ellipsis">
                  <span className="staff-dot" style={{ background: colorOf(x.staffId) }} aria-hidden="true" />
                  {nameOf(x.staffId)}
                </span>
                <PartsBar parts={x.parts} shift={x.shift} rest={x.rest} range={range} className="daylines-bar" />
                <span className="daylines-count">{x.shift.length === 0 && x.count === 0 ? '休' : `${x.count}件`}</span>
              </button>
              {detail && <PersonInfo kind="staff" id={x.staffId} name={nameOf(x.staffId)} />}
            </li>
          );
        })}
      </ul>
      <p className="daylines-legend sub">
        <StaffLegend
          states={['visit', 'travel', 'free', 'rest']}
          labels={{ free: '待ち・空き（勤務内）', rest: '休み（欠勤）' }}
        />
        <span>薄い灰は勤務外。押すとその{staffTerm}の列へ</span>
      </p>
    </div>
  );
  if (!collapsed)
    return (
      <section className="daylines" aria-label={`${staffTerm}ごとの1日`} data-testid="daylines">
        {body}
      </section>
    );
  return (
    <details
      className="daylines is-collapsed"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      data-testid="daylines"
    >
      <summary>
        {staffTerm}ごとの1日（{lines.length}人）
      </summary>
      {body}
    </details>
  );
}
