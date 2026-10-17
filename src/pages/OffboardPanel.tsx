import { CalendarDays, Check, UserRoundCog, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDay } from '../app/day';
import { useToast } from '../components/Toast';
import { Hint, SectionTitle, SidePanel, WithIcon } from '../components/ui';
import { addDays, jstDate, weekday } from '../domain/time';
import { byName, newId, WEEKDAY_LABELS } from '../lib/common';
import { applyOffboard, defaultChoice, OFFBOARD_SAMPLE_DAYS, type OffboardRole, offboardScope } from '../lib/offboard';
import { mdText } from '../lib/patternText';
import { useDemoData } from '../store';

/** 持ち方の文 */
const ROLE_TEXT: Record<OffboardRole, string> = {
  usual: 'いつもの担当',
  pattern: '定期パターンの担当',
  allowed: '担当できる人',
};

/** 選びの値（だれにもしない） */
const NOBODY = '';

/**
 * 退職・担当替えの一括振り直し（PRD D71。ADR-0015）：最終勤務日のある〈スタッフ〉について、〈利用者さん〉ごとに代わりの人を選び、
 * 「まとめて適用」で いつもの担当・定期パターンの担当・担当できる人 を置き換える。訪問の案は作り直さない（一覧と日へのリンクだけ）
 */
export function OffboardPanel({ staffId, onClose }: { staffId: string; onClose: () => void }) {
  const { data, update } = useDemoData();
  const { setDate } = useDay();
  const navigate = useNavigate();
  const toast = useToast();
  const terms = data.org.terms;
  const today = jstDate(Date.now());
  const scope = useMemo(() => offboardScope(data, staffId, today), [data, staffId, today]);
  const staffById = useMemo(() => new Map(data.staff.map((s) => [s.id, s])), [data.staff]);
  const clientById = useMemo(() => new Map(data.clients.map((c) => [c.id, c])), [data.clients]);
  const name = staffById.get(staffId)?.name ?? '';
  /** 〈利用者さん〉ID → 選んだ人（'' はだれにもしない） */
  const [choices, setChoices] = useState<Record<string, string>>({});
  // 範囲が変わったら（適用・最終勤務日の変更）、まだ選んでいない〈利用者さん〉に既定の候補を入れる
  useEffect(() => {
    if (!scope) return;
    setChoices((prev) => {
      const next: Record<string, string> = {};
      for (const c of scope.clients) next[c.clientId] = prev[c.clientId] ?? defaultChoice(c) ?? NOBODY;
      return next;
    });
  }, [scope]);

  /** 訪問を日ごとにまとめる */
  const byDate = useMemo(() => {
    const out = new Map<string, { count: number; confirmed: number }>();
    for (const v of scope?.visits ?? []) {
      const x = out.get(v.date) ?? { count: 0, confirmed: 0 };
      x.count++;
      if (v.confirmed) x.confirmed++;
      out.set(v.date, x);
    }
    return [...out];
  }, [scope]);

  const openDay = (d: string) => {
    setDate(d);
    onClose();
    navigate('/plan');
  };

  const canApply = !!scope && scope.clients.length > 0;
  const apply = () => {
    if (!scope || !canApply) return;
    const picked: Record<string, string | null> = {};
    for (const c of scope.clients) picked[c.clientId] = choices[c.clientId] || null;
    const nobody = scope.clients.filter((c) => !picked[c.clientId]).map((c) => clientById.get(c.clientId)?.displayName);
    const msg = `${scope.clients.length}人の${terms.client}の担当を、${mdText(scope.from)}から選んだ${terms.staff}に移します（それより前の日はそのまま）。${
      nobody.length > 0
        ? `${nobody.join('・')}は「だれにもしない」なので、いつもの担当が無くなります（担当できる人を限っていれば外します）。`
        : ''
    }定期パターンは${mdText(scope.from)}で分け、その日からの訪問を作り直します。訪問の案（担当）は作り直しません。よろしいですか？`;
    if (!confirm(msg)) return;
    const from = scope.from;
    update((d) => applyOffboard(d, staffId, picked, from, today, () => newId('pt')));
    toast(
      `${scope.clients.length}人の担当を置き換えました。訪問の案は月間の「条件が変わった日を作り直す」か、日の画面で直してください`,
    );
  };

  return (
    <SidePanel
      icon={UserRoundCog}
      title={`担当の振り直し：${name}`}
      onClose={onClose}
      focusPanel
      footer={
        <>
          <button
            type="button"
            className="btn btn-primary"
            aria-disabled={!canApply || undefined}
            title={canApply ? '' : `置き換える${terms.client}はいません`}
            onClick={apply}
            data-testid="offboard-apply"
          >
            <WithIcon icon={Check}>まとめて適用</WithIcon>
          </button>
          <button type="button" className="btn" onClick={onClose}>
            <WithIcon icon={X}>閉じる</WithIcon>
          </button>
          {!canApply && <span className="sub">置き換える{terms.client}はいません</span>}
        </>
      }
    >
      {!scope ? (
        <p className="sub">最終勤務日が入っていません。{terms.staff}の編集で最終勤務日を入れてください。</p>
      ) : (
        <div className="stack" data-testid="offboard-panel">
          <p>
            最終勤務日：<strong>{mdText(scope.lastDay)}</strong>（{mdText(addDays(scope.lastDay, 1))}
            から勤務なし。予定・AI案に入りません）
          </p>
          <Hint label="振り直しのしかた">
            {terms.client}ごとに代わりの{terms.staff}
            を選び、「まとめて適用」を押すと、{mdText(scope.from)}
            からのいつもの担当・定期パターンの担当を選んだ人に移し、担当できる人に選んだ人を足します（それより前の日の担当はそのまま。定期パターンはその日で分けます）。候補は、
            {mdText(scope.from)}からの{OFFBOARD_SAMPLE_DAYS}日の{terms.client}
            の訪問に、必須の条件・稼働時間・種類の条件を満たし、ほかの人の予定を変えずに入れられる回の多い順（同じなら、いつもの担当の受け持ちが少ない順）です。訪問の案は自動では作り直しません。
          </Hint>

          <SectionTitle icon={Users}>
            {terms.client}ごとの代わり（{scope.clients.length}人）
          </SectionTitle>
          {scope.clients.length === 0 ? (
            <p className="sub" data-testid="offboard-no-clients">
              {name}さんをいつもの担当・定期パターンの担当・担当できる人にしている{terms.client}はいません。
            </p>
          ) : (
            <div className="table-scroll">
              <table className="people-table offboard-table" data-testid="offboard-clients">
                <thead>
                  <tr>
                    <th scope="col">{terms.client}</th>
                    <th scope="col">いまの持ち方</th>
                    <th scope="col">代わりの{terms.staff}</th>
                  </tr>
                </thead>
                <tbody>
                  {scope.clients.map((c) => {
                    const value = choices[c.clientId] ?? NOBODY;
                    return (
                      <tr key={c.clientId} data-testid="offboard-client">
                        <th scope="row" className="person-name">
                          {clientById.get(c.clientId)?.displayName ?? ''}
                        </th>
                        <td className="nowrap">
                          {c.roles
                            .map((r) =>
                              r === 'pattern' && c.patternIds.length > 1
                                ? `${ROLE_TEXT[r]}（${c.patternIds.length}つ）`
                                : ROLE_TEXT[r],
                            )
                            .join('・')}
                        </td>
                        <td>
                          <select
                            value={value}
                            onChange={(e) => setChoices({ ...choices, [c.clientId]: e.target.value })}
                            aria-label={`${clientById.get(c.clientId)?.displayName ?? ''}の代わりの${terms.staff}`}
                            data-testid="offboard-choice"
                          >
                            {c.candidates.map((x) => {
                              const s = staffById.get(x.staffId);
                              const fit =
                                c.sample === 0
                                  ? '見本の訪問なし'
                                  : x.fits === 0
                                    ? '入れる回なし'
                                    : `入れる ${x.fits}/${c.sample}回`;
                              return (
                                <option key={x.staffId} value={x.staffId}>
                                  {s?.name ?? ''}（{fit}・{OFFBOARD_SAMPLE_DAYS / 7}週の受け持ち {x.load}回）
                                </option>
                              );
                            })}
                            <option value={NOBODY}>（だれにもしない）</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <SectionTitle icon={CalendarDays}>
            {mdText(scope.from)}以降に{name}さんが担当している訪問（{scope.visits.length}件）
          </SectionTitle>
          {byDate.length === 0 ? (
            <p className="sub" data-testid="offboard-no-visits">
              確定した割当・今の案に、{name}さんの担当の訪問はありません。
            </p>
          ) : (
            <>
              <p className="sub">
                この訪問は{mdText(addDays(scope.lastDay, 1))}
                から「休みの人に残る訪問」になり、案のある日は「条件が変わった」になります。月間の「条件が変わった日を作り直す」か、日の画面で直してください。
              </p>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  onClose();
                  navigate(`/month?ym=${scope.from.slice(0, 7)}&staff=${encodeURIComponent(staffId)}`);
                }}
              >
                <WithIcon icon={CalendarDays} size={14}>
                  {Number(scope.from.slice(5, 7))}月の月間を開く
                </WithIcon>
              </button>
              <ul className="offboard-days" data-testid="offboard-visits">
                {byDate.map(([d, x]) => (
                  <li key={d}>
                    <button type="button" className="offboard-day-btn" onClick={() => openDay(d)}>
                      <span>
                        {mdText(d)}（{WEEKDAY_LABELS[weekday(d)]}）
                      </span>
                      <span>
                        {x.count}件{x.confirmed > 0 ? `（確定 ${x.confirmed}件）` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </SidePanel>
  );
}

/** 最終勤務日のある利用中の〈スタッフ〉（名前の順） */
export function leavingStaff<T extends { name: string; active: boolean; lastDay: string | null }>(staff: readonly T[]) {
  return staff.filter((s) => s.active && s.lastDay !== null).sort(byName);
}
