// 日の予定の「今の担当」の1行の「入らない N」「守れない条件 N」を押して出す一覧の吹き出し（PRD D345）。
// N が 0 のときは数だけ（押せない）。一覧の行は訪問ごとに：時刻・〈利用者さん〉・（担当）・理由と、
// 「見る」（その訪問を選んで見える所へ）・「開く」（訪問の詳細の欄）・関連の画面へのリンク。
// 吹き出しの決まり（閉じ方・フォーカス・中を巻く）は DetailPopover のまま。データは書き換えない（操作は呼ぶ側）
import { type ReactNode, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import type { HardLink } from '../lib/hardLinks';
import { DetailPopover } from './DetailPopover';
import './planIssueCount.css';

/** 一覧の1行（訪問1件） */
export type IssueRow = {
  visitId: string;
  /** 時刻（今の案の開始。無ければ約束の開始） */
  time: string;
  clientName: string;
  /** 担当の名前（入らない訪問は無し） */
  staffName?: string;
  /** 理由の言葉（入らない理由・違反の label） */
  reasons: string[];
  /** 関連の画面（切った機能の行き先は呼ぶ側で外す） */
  links: HardLink[];
};

export function PlanIssueCount({
  count,
  title,
  rows,
  onLook,
  onOpen,
  footer,
  testId,
}: {
  count: number;
  /** 吹き出しの見出し */
  title: ReactNode;
  rows: IssueRow[];
  /** 「見る」：その訪問を選んで見える所へ */
  onLook: (visitId: string) => void;
  /** 「開く」：訪問の詳細の欄 */
  onOpen: (visitId: string) => void;
  /** 一覧の下に出すもの（「担当なしの列へ」など）。押したら閉じる */
  footer?: (close: () => void) => ReactNode;
  testId: string;
}) {
  const base = `issue-${useId()}`;
  const [open, setOpen] = useState(false);
  if (count === 0 || rows.length === 0) return <strong>{count}</strong>;
  const anchorId = `${base}-btn`;
  const popId = `${base}-pop`;
  const close = () => setOpen(false);
  /** 吹き出しを閉じてから動く（閉じたときにフォーカスを数のボタンへ戻すので、そのあとで移す） */
  const then = (fn: () => void) => () => {
    close();
    requestAnimationFrame(fn);
  };
  return (
    <>
      <button
        type="button"
        id={anchorId}
        className="link-btn plan-issue-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        title="押すと一覧"
        onClick={() => setOpen((o) => !o)}
        data-testid={testId}
      >
        <strong>{count}</strong>
      </button>
      {open && (
        <DetailPopover
          id={popId}
          anchorId={anchorId}
          title={title}
          titleId={`${popId}-title`}
          onClose={close}
          testId={`${testId}-pop`}
        >
          <ul className="detail-popover-list plan-issue-list">
            {rows.map((r) => (
              <li key={r.visitId} className="plan-issue-row" data-testid={`${testId}-row`} data-visit={r.visitId}>
                <div className="plan-issue-head">
                  <span className="plan-issue-time">{r.time}</span>
                  <strong className="plan-issue-name">{r.clientName}</strong>
                  {r.staffName && <span className="sub">担当 {r.staffName}さん</span>}
                </div>
                {r.reasons.length > 0 && (
                  <div className="row plan-issue-reasons">
                    {r.reasons.map((x) => (
                      <span key={x} className="chip chip-warn">
                        {x}
                      </span>
                    ))}
                  </div>
                )}
                <div className="row plan-issue-actions">
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={then(() => onLook(r.visitId))}
                    data-testid={`${testId}-look`}
                  >
                    見る
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={then(() => onOpen(r.visitId))}
                    data-testid={`${testId}-open`}
                  >
                    開く
                  </button>
                  {r.links.map((l) => (
                    <Link key={l.to} to={l.to} data-testid={`${testId}-link`}>
                      {l.label}
                    </Link>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {footer?.(close)}
        </DetailPopover>
      )}
    </>
  );
}
