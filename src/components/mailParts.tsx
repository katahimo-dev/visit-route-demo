// メール連携の画面の部品（PRD D91〜D95。ADR-0017）：mailto: のリンク（メールアプリを開く）・押せないときの理由・
// 長い本文の知らせと「本文をコピー」・担当ごとの一覧。送信は人がメールアプリで押す（アプリからは送らない）
import { ClipboardCopy, Mail } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { copyText } from '../lib/clipboard';
import { NO_EMAIL } from '../lib/mail';
import { type BuiltMail, mailLimitFor } from '../lib/mailto';
import { useToast } from './Toast';
import { WithIcon } from './ui';
import './mailParts.css';

/** 宛先・件名だけで目安の長さを超えるときの理由（PRD D96） */
export const TOO_LONG = '宛先が多く、メールアプリに渡せる長さを超えます。「宛先をコピー」で貼り付けてください';

/**
 * この端末の mailto の長さの目安（ADR-0017）：navigator.userAgentData?.platform（あれば）と userAgent から
 * lib/mailto の mailLimitFor で決める（lib は純粋関数のまま、画面で判定する）
 */
export function useMailLimit(): number {
  if (typeof navigator === 'undefined') return mailLimitFor(undefined, '');
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return mailLimitFor(data?.platform, navigator.userAgent);
}

/**
 * メールアプリを開くリンク（ボタンの見た目。主ボタンにはしない）。mail が無い・長すぎる（tooLong）なら aria-disabled のボタンにし、理由（why）を
 * title・読み上げ・小さな文で出す
 */
export function MailButton({
  mail,
  label,
  why,
  testId,
  srLabel,
  onOpen,
}: {
  mail: BuiltMail | null;
  label: ReactNode;
  /** メールアプリを開いたとき（押せないときは呼ばない） */
  onOpen?: () => void;
  /** 押せない理由（mail が null のとき。長すぎるときは TOO_LONG） */
  why: string;
  testId?: string;
  /** 読み上げの名前（だれあてか） */
  srLabel?: string;
}) {
  const toast = useToast();
  const whyId = useId();
  if (!mail || mail.tooLong) {
    const reason = mail ? TOO_LONG : why;
    return (
      <span className="mail-btn-wrap">
        <button
          type="button"
          className="btn btn-small"
          aria-disabled="true"
          aria-describedby={whyId}
          aria-label={srLabel}
          title={reason}
          onClick={() => toast(reason)}
          data-testid={testId}
        >
          <WithIcon icon={Mail} size={14}>
            {label}
          </WithIcon>
        </button>
        <span id={whyId} className="sub mail-why">
          {reason}
        </span>
      </span>
    );
  }
  return (
    <a
      className="btn btn-small"
      href={mail.href}
      onClick={onOpen}
      aria-label={srLabel}
      title="メールアプリが開きます（送信はメールアプリで押します）"
      data-testid={testId}
      data-mail-mode={mail.mode}
    >
      <WithIcon icon={Mail} size={14}>
        {label}
      </WithIcon>
    </a>
  );
}

/** 本文を要点に絞った・入れなかったときの知らせと「本文をコピー」（すべての本文） */
export function MailLengthNote({ mail, testId }: { mail: BuiltMail | null; testId?: string }) {
  const toast = useToast();
  if (!mail || mail.mode === 'full' || mail.tooLong) return null;
  const copy = async () =>
    toast(
      (await copyText(mail.fullBody))
        ? '本文をコピーしました。メールに貼り付けてください'
        : 'コピーできませんでした。文を選んでコピーしてください',
    );
  return (
    <span className="mail-note" data-testid={testId}>
      <span className="sub">
        {mail.mode === 'short'
          ? '長いため、メールには一部（要点など。省いたものは本文の終わりに書きます）だけを入れます。すべての本文は「本文をコピー」で貼り付けてください'
          : '長いため、本文はメールに入れません。「本文をコピー」でメールに貼り付けてください'}
      </span>
      <button type="button" className="btn btn-small" onClick={() => void copy()}>
        <WithIcon icon={ClipboardCopy} size={14}>
          本文をコピー
        </WithIcon>
      </button>
    </span>
  );
}

/** 担当ごとの一覧の1行 */
export type MailRow = {
  key: string;
  name: string;
  email: string;
  /** 件数など（右に小さく） */
  summary: string;
  mail: BuiltMail | null;
};

/**
 * 担当ごとにメールアプリを開く一覧（日・週の予定。PRD D92・D93）。onOpen はメールを作った人（行の key）を知らせる。
 * sent に入っている行には「作成済み」を出す（日の予定の確定に使う。PRD D346）
 */
export function MailRows({
  rows,
  testId,
  onOpen,
  sent,
}: {
  rows: readonly MailRow[];
  testId?: string;
  onOpen?: (key: string) => void;
  sent?: ReadonlySet<string>;
}) {
  return (
    <ul className="mail-rows" data-testid={testId}>
      {rows.map((r) => (
        <li key={r.key} className="mail-row" data-testid="mail-row">
          <span className="mail-row-who">
            <strong>{r.name}</strong>
            {/* アドレスの無い人は、ボタンの横の理由だけを出す（二重に出さない） */}
            {r.email && <span className="sub">{r.email}</span>}
          </span>
          <span className="sub mail-row-summary">
            {r.summary}
            {sent?.has(r.key) && (
              <span className="chip chip-ok mail-row-sent" data-testid="mail-sent">
                作成済み
              </span>
            )}
          </span>
          <span className="mail-row-act">
            <MailButton
              mail={r.mail}
              label="メールを作る"
              why={NO_EMAIL}
              srLabel={`${r.name}さんへのメールを作る`}
              testId="mail-open"
              onOpen={onOpen ? () => onOpen(r.key) : undefined}
            />
            <MailLengthNote mail={r.mail} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** メールの注記（送らない・鍵の扱い） */
export function MailNotice({ children }: { children?: ReactNode }) {
  return (
    <p className="sub mail-notice">
      押すと、この端末のメールアプリが宛先・件名・本文の入った状態で開きます。送信はメールアプリで押してください（このアプリからは送りません）。
      {children}
    </p>
  );
}
