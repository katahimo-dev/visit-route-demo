import { ArrowLeft, ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useDay } from '../app/day';
import { WithIcon } from '../components/ui';
import { jstDate, minutesToHhmm, weekday } from '../domain/time';
import { colorOf } from '../lib/colors';
import { byName, WEEKDAY_LABELS } from '../lib/common';
import { addMonths, isYm, ymOf } from '../lib/month';
import { monthPrint, type PrintDay } from '../lib/monthPrint';
import { REQUESTED_OFF_NOTE } from '../lib/requestedOff';
import { useDemoData } from '../store';
import './monthPrint.css';

/**
 * 月の予定の印刷（PRD D70。ADR-0014。#/month/print?ym=2026-11&staff=s1）：紙のカレンダーの代わり。
 * 日ごとのマスに 時刻・〈利用者さん〉・担当（確定した割当があればそれ、無ければ今の案）を小さく並べ、休みも出す。
 * 左のメニューの外の画面（印刷にナビを出さない）。上の操作の帯は画面だけで、印刷はA4横（週の途中で改ページしない）
 */
export default function MonthPrintPage() {
  const { data } = useDemoData();
  const { date } = useDay();
  const [params, setParams] = useSearchParams();
  const terms = data.org.terms;
  const raw = params.get('ym') ?? '';
  const ym = isYm(raw) ? raw : ymOf(date);
  const activeStaff = useMemo(() => data.staff.filter((s) => s.active).sort(byName), [data.staff]);
  const sid = params.get('staff');
  const staff = sid ? activeStaff.find((s) => s.id === sid) : undefined;
  const staffId = staff?.id ?? null;
  const weeks = useMemo(() => monthPrint(data, ym, staffId), [data, ym, staffId]);
  const today = jstDate(Date.now());
  const title = `${ym.slice(0, 4)}年${Number(ym.slice(5, 7))}月の予定${staff ? `（${staff.name}さん）` : ''}`;

  const patch = (next: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(next)) {
          if (v === null) p.delete(k);
          else p.set(k, v);
        }
        return p;
      },
      { replace: true },
    );
  const back = `/month?ym=${ym}${staffId ? `&staff=${encodeURIComponent(staffId)}` : ''}`;

  return (
    <div className="mprint">
      <div className="mprint-bar no-print" data-testid="mprint-bar">
        <Link className="btn btn-small" to={back}>
          <WithIcon icon={ArrowLeft} size={14}>
            月の予定に戻る
          </WithIcon>
        </Link>
        <button type="button" className="icon-btn" aria-label="前の月" onClick={() => patch({ ym: addMonths(ym, -1) })}>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <button type="button" className="icon-btn" aria-label="次の月" onClick={() => patch({ ym: addMonths(ym, 1) })}>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
        <label className="mprint-pick">
          <span>{terms.staff}</span>
          <select
            value={staffId ?? ''}
            onChange={(e) => patch({ staff: e.target.value === '' ? null : e.target.value })}
            data-testid="mprint-staff"
          >
            <option value="">全員</option>
            {activeStaff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-primary" onClick={() => window.print()} data-testid="mprint-print">
          <WithIcon icon={Printer}>印刷する</WithIcon>
        </button>
        <span className="sub">A4横で印刷します（ブラウザの印刷の設定で「横」を選んでください）。</span>
      </div>

      <header className="mprint-head">
        <h1>{title}</h1>
        <span className="mprint-org">{data.org.name}</span>
        <span className="mprint-legend">
          担当は「確」＝確定した割当、「案」＝今の案（確定していない）、「案なし」の日は担当を書きません。休：
          {REQUESTED_OFF_NOTE}
          は「希」、欠勤は「欠」、印の無い人は勤務なし。
          {terms.client}の休みは「{terms.client}休」。印刷日 {today}
        </span>
      </header>

      <table className="mprint-grid" data-testid="mprint-grid">
        <thead>
          <tr>
            {WEEKDAY_LABELS.map((w, i) => (
              <th key={w} scope="col" className={i === 0 ? 'mprint-sun' : i === 6 ? 'mprint-sat' : ''}>
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]!.date}>
              {week.map((d) => (
                <PrintCell key={d.date} day={d} clientTerm={terms.client} showStaff={staffId === null} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const OFF_MARK: Record<'requested' | 'absent' | 'noShift', string> = { requested: '希', absent: '欠', noShift: '' };

function PrintCell({ day: d, clientTerm, showStaff }: { day: PrintDay; clientTerm: string; showStaff: boolean }) {
  if (!d.inMonth) return <td className="mprint-cell is-out" />;
  const dow = weekday(d.date);
  return (
    <td className={`mprint-cell${dow === 0 ? ' mprint-sun' : dow === 6 ? ' mprint-sat' : ''}`} data-date={d.date}>
      <div className="mprint-day">
        <span className="mprint-date">{Number(d.date.slice(8, 10))}</span>
        {d.source && <span className="mprint-src">{d.source === 'confirmed' ? '確' : '案'}</span>}
        {!d.source && d.pending > 0 && <span className="mprint-src is-none">案なし</span>}
        {d.entries.length > 0 && <span className="mprint-count">{d.entries.length}件</span>}
      </div>
      <ul className="mprint-list">
        {d.entries.map((e) => (
          <li key={e.visitId}>
            <span
              className="mprint-dot"
              style={{ background: e.typeColor === null ? '#cfc4bb' : colorOf(e.typeColor) }}
              aria-hidden="true"
            />
            <span className="mprint-time">{minutesToHhmm(Math.round(e.start))}</span>
            <span className="mprint-client">{e.clientName}</span>
            {/* 案の無い日は担当を書かない（「案なし」の印だけ）。案のある日に担当が無ければ「未定」 */}
            {showStaff && d.source && <span className="mprint-staff">{e.staffLabel ?? '未定'}</span>}
          </li>
        ))}
      </ul>
      {/* 〈スタッフ〉で絞ったときも、担当の決まっていない訪問があると分かるように */}
      {!showStaff && d.pending > 0 && (
        <div className="mprint-pending" data-testid="mprint-pending">
          {d.source ? `未定 ${d.pending}件（全体）` : `案なし（訪問 ${d.pending}件）`}
        </div>
      )}
      {d.off.length > 0 && (
        <div className="mprint-off">
          休：
          {d.off.map((o, i) => (
            <span key={o.name} className={`is-${o.kind}`}>
              {i > 0 ? '・' : ''}
              {o.label}
              {OFF_MARK[o.kind] ? `(${OFF_MARK[o.kind]})` : ''}
            </span>
          ))}
        </div>
      )}
      {d.leaves.length > 0 && (
        <div className="mprint-leave">
          {clientTerm}休：{d.leaves.join('・')}
        </div>
      )}
    </td>
  );
}
