// 日・週の予定を担当ごとにメールアプリで開く欄（PRD D92・D93。ADR-0017）。
// 担当は確定した割当があればそれ、無ければ今の案（どちらかを欄と本文に書く）。鍵の情報は「鍵の情報も入れる」を選んだときだけ
// （既定はオフ。画面の中だけの状態で保存しない）。データは書き換えない
import { Mail, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { MailNotice, type MailRow, MailRows, useMailLimit } from '../components/mailParts';
import { SidePanel, WithIcon } from '../components/ui';
import type { DemoData } from '../contracts/data';
import { byName } from '../lib/common';
import { dayByStaff, dayMailText, mailTo, mdw, sourceWord, weekByStaff, weekMailText } from '../lib/mail';

/** 日の予定（担当ごと。PRD D92） */
export function DayMailPanel({ data, date, onClose }: { data: DemoData; date: string; onClose: () => void }) {
  const terms = data.org.terms;
  /** 鍵の情報も入れる（既定はオフ。保存しない） */
  const [includeKeys, setIncludeKeys] = useState(false);
  const { day, byStaff } = useMemo(() => dayByStaff(data, date), [data, date]);
  const staff = useMemo(() => [...data.staff].filter((s) => s.active).sort(byName), [data.staff]);
  const limit = useMailLimit();
  /** 欠勤・希望休の人（PRD D92。行に出す。訪問が残っていなくても出す） */
  const offOf = new Map(
    day.off.filter((o) => o.kind !== 'noShift').map((o) => [o.staffId, o.kind === 'requested' ? '希望休' : '欠勤']),
  );
  const listed = staff.filter((s) => (byStaff.get(s.id)?.length ?? 0) > 0 || offOf.has(s.id));
  const rows: MailRow[] = listed.map((s) => {
    const visits = byStaff.get(s.id) ?? [];
    const off = offOf.get(s.id);
    return {
      key: s.id,
      name: s.name,
      email: s.email,
      summary: [off, `訪問 ${visits.length}件`].filter(Boolean).join('・'),
      mail: mailTo(s.email, dayMailText(data.org, s, date, day.source, visits, includeKeys), limit),
    };
  });
  const noEmail = rows.filter((r) => !r.email).length;
  return (
    <SidePanel
      icon={Mail}
      title={`${mdw(date)}の予定をメールで送る`}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          <WithIcon icon={X}>閉じる</WithIcon>
        </button>
      }
    >
      <div className="stack" data-testid="day-mail-panel">
        {day.source === null ? (
          <p data-testid="day-mail-source">この日は確定した割当も今の案もありません。案を作ってから送ってください。</p>
        ) : (
          <>
            <p data-testid="day-mail-source">
              <strong>{sourceWord(day.source)}</strong>
              の担当で、{terms.staff}ごとに 順番・時刻・{terms.client}・住所・入り方・駐車場・注意 と、Google
              マップの道順のリンク（1日の全行程と区間ごと。{terms.staff}の自宅と移動手段から）を本文に入れます。
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={includeKeys}
                onChange={(e) => setIncludeKeys(e.target.checked)}
                style={{ width: 'auto' }}
                data-testid="mail-include-keys"
              />
              鍵の情報も入れる（既定は入れません。メールは転送・誤送信で人の目に触れることがあります）
            </label>
            <MailNotice>
              {noEmail > 0 &&
                ` メールアドレスの無い${terms.staff}（${noEmail}人）は、${terms.staff}の画面で入れられます。`}
            </MailNotice>
            {rows.length === 0 ? (
              <p>この日に訪問のある{terms.staff}はいません。</p>
            ) : (
              <MailRows rows={rows} testId="day-mail-rows" />
            )}
          </>
        )}
      </div>
    </SidePanel>
  );
}

/** 週の予定（担当ごと。PRD D93）。dates は月〜日 */
export function WeekMailPanel({
  data,
  dates,
  onClose,
}: {
  data: DemoData;
  dates: readonly string[];
  onClose: () => void;
}) {
  const terms = data.org.terms;
  const byStaff = useMemo(() => weekByStaff(data, dates), [data, dates]);
  const limit = useMailLimit();
  const first = dates[0] ?? '';
  const last = dates[dates.length - 1] ?? '';
  // 最終勤務日（ADR-0015）が週の初めより前の人は出さない
  const staff = useMemo(
    () => [...data.staff].filter((s) => s.active && (s.lastDay === null || s.lastDay >= first)).sort(byName),
    [data.staff, first],
  );
  const rows: MailRow[] = staff.map((s) => {
    const days = byStaff.get(s.id) ?? [];
    const count = days.reduce((n, d) => n + d.visits.length, 0);
    return {
      key: s.id,
      name: s.name,
      email: s.email,
      summary: `訪問 ${count}件`,
      mail: mailTo(s.email, weekMailText(data.org, s, days), limit),
    };
  });
  const noEmail = rows.filter((r) => !r.email).length;
  return (
    <SidePanel
      icon={Mail}
      title={`${mdw(first)}〜${mdw(last)}の予定をメールで送る`}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          <WithIcon icon={X}>閉じる</WithIcon>
        </button>
      }
    >
      <div className="stack" data-testid="week-mail-panel">
        <p>
          日ごとに、確定した割当があればそれ、無ければ今の案（本文に「案」と書きます）の担当で、曜日ごとの訪問（時刻・
          {terms.client}）を本文に入れます。住所・決まりごと・鍵の情報は入れません（日の予定のメールで送れます）。
        </p>
        <MailNotice>
          {noEmail > 0 && ` メールアドレスの無い${terms.staff}（${noEmail}人）は、${terms.staff}の画面で入れられます。`}
        </MailNotice>
        <MailRows rows={rows} testId="week-mail-rows" />
      </div>
    </SidePanel>
  );
}
