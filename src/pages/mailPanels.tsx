// 日・週の予定を担当ごとにメールアプリで開く欄（PRD D92・D93。ADR-0017）。
// 担当は確定した割当があればそれ、無ければ今の案（どちらかを欄と本文に書く）。鍵の情報は「鍵の情報も入れる」を選んだときだけ
// （既定はオフ。画面の中だけの状態で保存しない）。データは書き換えない
import { CircleCheck, Mail, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MailNotice, type MailRow, MailRows, useMailLimit } from '../components/mailParts';
import { SidePanel, WithIcon } from '../components/ui';
import type { DemoData } from '../contracts/data';
import { byName } from '../lib/common';
import { isOn } from '../lib/features';
import { dayByStaff, dayMailText, mailTo, mdw, sourceWord, weekByStaff, weekMailText } from '../lib/mail';

/** 日のメールと確定（PRD D346）：state は伝えた状態、onConfirm は確定する（mail＝全員分のメールを作った・manual＝欄のボタン） */
export type DayMailConfirm = {
  state: 'none' | 'told' | 'changed';
  onConfirm: (by: 'mail' | 'manual') => void;
};

/**
 * 日の予定（担当ごと。PRD D92）。confirm があれば、メールを作った人を数え、送れる人（アドレスがあり、長すぎない）全員分を作ったら
 * その日を確定（伝えた）にする（PRD D346。アプリは送信を知れないので「メールを作る」を押したことで数える。元に戻すで戻せる）。
 * アドレスの無い人・電話で伝えたときのため、欄の下に「確定（伝えた）にする」も置く
 */
export function DayMailPanel({
  data,
  date,
  onClose,
  confirm,
}: {
  data: DemoData;
  date: string;
  onClose: () => void;
  confirm?: DayMailConfirm;
}) {
  const terms = data.org.terms;
  /**
   * 機能の入り切り（ADR-0028）：訪問先の決まりごとを切れば入り方・鍵・駐車場・注意と「鍵の情報も入れる」、
   * 道順のリンクを切れば Google マップの道順を本文に入れない
   */
  const notesOn = isOn(data.org.features, 'visitNotes');
  const mapsOn = isOn(data.org.features, 'mapsLink');
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
    const all = byStaff.get(s.id) ?? [];
    const visits = notesOn
      ? all
      : all.map((v) =>
          v.client
            ? { ...v, client: { ...v.client, entryNote: '', keyNote: '', parkingNote: '', cautionNote: '' } }
            : v,
        );
    const off = offOf.get(s.id);
    return {
      key: s.id,
      name: s.name,
      email: s.email,
      summary: [off, `訪問 ${visits.length}件`].filter(Boolean).join('・'),
      mail: mailTo(
        s.email,
        dayMailText(data.org, mapsOn ? s : { name: s.name }, date, day.source, visits, notesOn && includeKeys),
        limit,
      ),
    };
  });
  const noEmail = rows.filter((r) => !r.email).length;
  /** メールを作った人（行の key。画面の中だけ。日付を変えたら数え直す） */
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  // biome-ignore lint/correctness/useExhaustiveDependencies: 日付が変わったときだけ数え直す
  useEffect(() => {
    setSent(new Set());
  }, [date]);
  /** 送れる人（アドレスがあり、長すぎない） */
  const sendable = rows.filter((r) => r.mail && !r.mail.tooLong).map((r) => r.key);
  const sentCount = sendable.filter((k) => sent.has(k)).length;
  const open = confirm && confirm.state !== 'told';
  /** 全員分を作ったら1回だけ確定する（作った・確定したあとに押し直しても二重にしない） */
  const confirmed = useRef(false);
  useEffect(() => {
    if (!confirm || confirm.state === 'told' || confirmed.current) return;
    if (sendable.length > 0 && sentCount === sendable.length) {
      confirmed.current = true;
      confirm.onConfirm('mail');
    }
  }, [confirm, sendable.length, sentCount]);
  return (
    <SidePanel
      icon={Mail}
      title={`${mdw(date)}の予定をメールで送る`}
      onClose={onClose}
      footer={
        <>
          {open && day.source !== null && (
            <button
              type="button"
              className="btn"
              onClick={() => confirm.onConfirm('manual')}
              data-testid="day-mail-confirm"
              title="メールの無い人に電話などで伝えたときも、ここで確定できます"
            >
              <WithIcon icon={CircleCheck}>確定（伝えた）にする</WithIcon>
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            <WithIcon icon={X}>閉じる</WithIcon>
          </button>
        </>
      }
    >
      <div className="stack" data-testid="day-mail-panel">
        {day.source === null ? (
          <p data-testid="day-mail-source">この日は計算できる訪問がありません。</p>
        ) : (
          <>
            <p data-testid="day-mail-source">
              <strong>{sourceWord(day.source)}</strong>
              の担当で、{terms.staff}ごとに 順番・時刻・{terms.client}・住所{notesOn ? '・入り方・駐車場・注意' : ''}
              {mapsOn &&
                ` と、Google マップの道順のリンク（1日の全行程と区間ごと。${terms.staff}の自宅と移動手段から）`}
              を本文に入れます。
            </p>
            {notesOn && (
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
            )}
            <MailNotice>
              {noEmail > 0 &&
                ` メールアドレスの無い${terms.staff}（${noEmail}人）は、${terms.staff}の画面で入れられます。`}
            </MailNotice>
            {confirm && rows.length > 0 && (
              <p className="sub" data-testid="day-mail-progress">
                {confirm.state === 'told'
                  ? 'この日は確定（伝えた）済みです。'
                  : `メールを作った人 ${sentCount}/${sendable.length}人。全員分を作ると、この日を確定（伝えた）にします${
                      confirm.state === 'changed' ? '（伝えたあとの変更も伝えた扱い）' : ''
                    }。`}
              </p>
            )}
            {rows.length === 0 ? (
              <p>この日に訪問のある{terms.staff}はいません。</p>
            ) : (
              <MailRows
                rows={rows}
                testId="day-mail-rows"
                sent={sent}
                onOpen={(key) => setSent((x) => new Set([...x, key]))}
              />
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
          週の見通しとして、今の担当で曜日ごとの訪問（時刻・{terms.client}
          ）を本文に入れます（確定していない日があれば、冒頭に「確定した予定は前日のメールでお知らせします」と書きます）。
          住所・道順・決まりごと・鍵の情報は入れません（日の予定のメールで送り、送るとその日が確定になります）。
          週のメールを送っても確定にはしません。
        </p>
        <MailNotice>
          {noEmail > 0 && ` メールアドレスの無い${terms.staff}（${noEmail}人）は、${terms.staff}の画面で入れられます。`}
        </MailNotice>
        <MailRows rows={rows} testId="week-mail-rows" />
      </div>
    </SidePanel>
  );
}
