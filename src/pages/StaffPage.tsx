import { CalendarX, Clock, Eye, HeartHandshake, MapPin, Plus, Smartphone, UserRound, UserRoundCog } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CondChips, TraitChips } from '../components/conditions';
import { StaffMark } from '../components/StaffMark';
import { PageHeader, WithIcon } from '../components/ui';
import { jstDate } from '../domain/time';
import { byName, hasLocation, WEEKDAY_LABELS } from '../lib/common';
import { narrowRole } from '../lib/narrowRoles';
import { offboardScope } from '../lib/offboard';
import { mdText } from '../lib/patternText';
import { shouldOpenRow } from '../lib/rowOpen';
import { useFeature } from '../lib/useFeature';
import { useDemoData } from '../store';
import { leavingStaff, OffboardPanel } from './OffboardPanel';
import './settings.css';

/**
 * 〈スタッフ〉一覧（PoC本体 StaffPage.tsx を写し、招待・メールを外して特性と条件を足した）。
 * 行を押すとその人の画面（`#/staff/:id`。StaffPersonPage）へ、「追加」は新しい人の画面（`#/staff/new`）へ（PRD D308）。
 * 最終勤務日のある人の担当の振り直しの欄（ADR-0015）はここからも開ける
 */

export default function StaffPage() {
  const { data } = useDemoData();
  const terms = data.org.terms;
  // 機能の入り切り（ADR-0028）：退職・担当替えを切れば振り直しの欄を出さない（最終勤務日の値は事実なので一覧の「最終」の印は残す）
  const offboardOn = useFeature('offboard');
  const compatOn = useFeature('compat');
  /** 担当の振り直しの欄を開いている〈スタッフ〉（PRD D71。null：閉じている） */
  const [offboardFor, setOffboardFor] = useState<string | null>(null);
  const today = jstDate(Date.now());
  const staff = useMemo(() => [...data.staff].sort(byName), [data.staff]);
  /** 最終勤務日のある人と、振り直しが残っているもの（〈利用者さん〉の人数・訪問の件数） */
  const leaving = useMemo(
    () =>
      leavingStaff(data.staff).map((s) => {
        const sc = offboardScope(data, s.id, today, false);
        return { staff: s, clients: sc?.clients.length ?? 0, visits: sc?.visits.length ?? 0 };
      }),
    [data, today],
  );
  const staffItems = data.items.filter((i) => i.target === 'staff');
  const itemById = new Map(data.items.map((i) => [i.id, i]));
  // ?id= で開いたら（古いリンク・ブックマーク）、その人の画面（`#/staff/:id`）へ移る（PRD D308。いない人なら URL から消すだけ）
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const openId = params.get('id');
  // biome-ignore lint/correctness/useExhaustiveDependencies: URL の id が変わったときだけ
  useEffect(() => {
    if (openId === null) return;
    if (data.staff.some((x) => x.id === openId)) {
      navigate(`/staff/${encodeURIComponent(openId)}`, { replace: true });
      return;
    }
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete('id');
        return p;
      },
      { replace: true },
    );
  }, [openId]);

  return (
    <div className="stack">
      <PageHeader
        icon={UserRound}
        title={`${terms.staff}一覧`}
        lead={`${terms.staff}の勤務・特性・条件を決めます`}
        actions={
          <>
            {compatOn && (
              <Link to="/compat" className="btn btn-text" data-testid="to-compat">
                <WithIcon icon={HeartHandshake}>相性の表</WithIcon>
              </Link>
            )}
            <Link to="/staff/new" className="btn btn-primary" data-testid="staff-add">
              <WithIcon icon={Plus}>{terms.staff}を追加</WithIcon>
            </Link>
          </>
        }
      />

      {offboardOn && leaving.length > 0 && (
        <div className="card stack leaving-card" data-testid="leaving-card">
          <strong>
            <WithIcon icon={CalendarX} size={16}>
              最終勤務日のある{terms.staff}
            </WithIcon>
          </strong>
          <ul className="leaving-list">
            {leaving.map((x) => (
              <li key={x.staff.id}>
                <span>
                  {x.staff.name}さん：最終勤務日 {mdText(x.staff.lastDay ?? '')}
                </span>
                <span className="sub">
                  {x.clients > 0 || x.visits > 0
                    ? `振り直しが残っています（${terms.client} ${x.clients}人・担当の訪問 ${x.visits}件）`
                    : '振り直しは済んでいます'}
                </span>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => setOffboardFor(x.staff.id)}
                  data-testid="leaving-open"
                >
                  <WithIcon icon={UserRoundCog} size={14}>
                    担当の振り直しを開く
                  </WithIcon>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 狭い画面（600px 以下）では行をカードにする（PRD D220。名前と状態が1行目、ほかは見出し付きの行、開くは右下） */}
      <div className="card table-scroll">
        <table {...narrowRole.table} className="people-table narrow-cards" data-testid="narrow-staff">
          <thead {...narrowRole.rowgroup}>
            <tr {...narrowRole.row}>
              <th {...narrowRole.columnheader}>名前</th>
              <th {...narrowRole.columnheader}>勤務</th>
              <th {...narrowRole.columnheader}>特性</th>
              <th {...narrowRole.columnheader}>{terms.client}に求めること</th>
              <th {...narrowRole.columnheader}>自宅の位置</th>
              <th {...narrowRole.columnheader}>状態</th>
              <th {...narrowRole.columnheader} aria-label="操作" />
            </tr>
          </thead>
          <tbody {...narrowRole.rowgroup}>
            {staff.map((s) => (
              <tr
                {...narrowRole.row}
                key={s.id}
                data-testid="staff-row"
                className="row-open"
                // 行のどこを押してもその人の画面へ（PRD D308。ボタン・リンク・文字の選択は除く。キーボードは右端の「開く」）
                onClick={(e) => {
                  const ok = shouldOpenRow({
                    target: e.target as Element,
                    row: e.currentTarget,
                    selection: window.getSelection()?.toString() ?? '',
                    detail: e.detail,
                  });
                  if (!ok) return;
                  navigate(`/staff/${encodeURIComponent(s.id)}`);
                }}
              >
                <td {...narrowRole.cell} className="person-name narrow-title" data-label="名前">
                  <span className="with-staff-mark">
                    <StaffMark staff={s} size="md" />
                    {s.name}
                  </span>
                </td>
                <td {...narrowRole.cell} className="nowrap" data-label="勤務">
                  <WithIcon icon={Clock} size={14}>
                    {s.workDays.map((d) => WEEKDAY_LABELS[d]).join('')} {s.shiftStart}〜{s.shiftEnd}
                  </WithIcon>
                </td>
                <td {...narrowRole.cell} data-label="特性">
                  <TraitChips traits={s.traits} items={staffItems} />
                </td>
                <td {...narrowRole.cell} className="cond-cell" data-label={`${terms.client}に求めること`}>
                  <CondChips requirements={s.requirements} preferences={s.preferences} itemById={itemById} />
                </td>
                <td {...narrowRole.cell} data-label="自宅の位置">
                  {hasLocation(s.home) ? (
                    <span className="chip chip-ok">
                      <WithIcon icon={MapPin} size={13}>
                        あり
                      </WithIcon>
                    </span>
                  ) : (
                    <span className="chip chip-warn">未登録</span>
                  )}
                </td>
                <td {...narrowRole.cell} className="narrow-head" data-label="状態">
                  {!s.active && <span className="chip">休止中</span>}
                  {s.lastDay && (
                    <span
                      className="chip chip-lastday"
                      title={`最終勤務日 ${s.lastDay}（翌日から勤務なし）`}
                      data-testid="staff-lastday"
                    >
                      最終 {mdText(s.lastDay)}
                    </span>
                  )}
                </td>
                <td {...narrowRole.cell} className="nowrap narrow-act">
                  <div className="actions">
                    <Link
                      className="icon-btn tone-plain"
                      to={`/staff/${encodeURIComponent(s.id)}`}
                      title={`${s.name}を開く`}
                      aria-label={`${s.name}を開く`}
                      data-testid="staff-open"
                    >
                      <Eye size={16} strokeWidth={2.2} aria-hidden="true" />
                    </Link>
                    <Link
                      className="icon-btn tone-plain"
                      to={`/staff-view/${s.id}`}
                      title={`${s.name}さんの画面で見る`}
                      aria-label={`${s.name}さんの画面で見る`}
                    >
                      <Smartphone size={16} strokeWidth={2.2} aria-hidden="true" />
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {offboardOn && offboardFor && <OffboardPanel staffId={offboardFor} onClose={() => setOffboardFor(null)} />}
    </div>
  );
}
