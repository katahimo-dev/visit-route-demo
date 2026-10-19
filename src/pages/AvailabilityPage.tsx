import { Clock, Coffee, Pencil, RotateCcw, Save } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDay } from '../app/day';
import { EdgeScroll } from '../components/EdgeScroll';
import { SlotEditor } from '../components/parts';
import { useToast } from '../components/Toast';
import { Hint, PageHeader, SidePanel, WithIcon } from '../components/ui';
import type { Availability } from '../contracts/documents';
import {
  afterLastDay,
  availabilityOf,
  type Slot,
  slotsError,
  slotsText,
  timeText,
  toHalfHours,
} from '../domain/availability';
import { weekday } from '../domain/time';
import { absenceText } from '../lib/absences';
import { byName, WEEKDAY_LABELS } from '../lib/common';
import { linkIfOn, suddenHref } from '../lib/links';
import { useFeature } from '../lib/useFeature';
import { useDemoData } from '../store';
import './schedule.css';

/** 「09:00」→「9」、「09:30」→「9:30」 */
const hourText = (hhmm: string) => timeText(hhmm).replace(/:00$/, '');
/** セルの短い表示：「9-18」「9:30-12」。休みは「休」 */
const short = (slots: Slot[]) =>
  slots.length === 0 ? ['休'] : slots.map((s) => `${hourText(s.start)}-${hourText(s.end)}`);

/**
 * 稼働時間帯のカレンダー（スタッフ×日。PoC本体 AvailabilityPage.tsx の簡易版：管理者のみ・データの中の日付だけ）。
 * 基本の曜日と時間が薄い字、日ごとに変えた日は色付き。セルを押すと下で直せる
 */
export default function AvailabilityPage() {
  const { data, update } = useDemoData();
  const { date: today, dates } = useDay();
  /** 欠勤・キャンセル（ADR-0028 の sudden）：切なら凡例で登録の場所（予定の画面）を案内しない（欠勤の印は事実なので出す） */
  const suddenOn = useFeature('sudden');
  const terms = data.org.terms;
  const toast = useToast();
  const staff = useMemo(() => data.staff.filter((s) => s.active).sort(byName), [data.staff]);
  const overrides = useMemo(
    () => new Map(data.availability.map((a) => [`${a.staffId}_${a.date}`, a])),
    [data.availability],
  );
  /** 欠勤（ADR-0011）：セルに「欠勤」の印。登録・取り消しは予定の画面で */
  const absences = useMemo(() => new Map(data.absences.map((a) => [`${a.staffId}_${a.date}`, a])), [data.absences]);
  const [picked, setPicked] = useState<{ staffId: string; date: string } | null>(null);
  const [draft, setDraft] = useState<Slot[]>([]);
  const pickedStaff = picked ? staff.find((s) => s.id === picked.staffId) : undefined;
  const pickedOverride = picked ? overrides.get(`${picked.staffId}_${picked.date}`) : undefined;
  const pickedAbsence = picked ? absences.get(`${picked.staffId}_${picked.date}`) : undefined;

  /** 最終勤務日の後（ADR-0015）：勤務なしなので上書きを入れても効かない。理由を出して保存させない */
  const retiredWhy =
    picked && pickedStaff && afterLastDay(pickedStaff, picked.date)
      ? `最終勤務日（${pickedStaff.lastDay?.slice(5).replace('-', '/')}）の後は勤務なしです。時間帯を入れても予定に入りません（${terms.staff}の画面で最終勤務日を変えてください）`
      : null;
  /** その日に働くか（保存した時間帯がある・最終勤務日の後でない）。欠勤・キャンセルの欄へのリンクを出すか（PRD D203） */
  const pickedWorks =
    !!picked &&
    !!pickedStaff &&
    !retiredWhy &&
    availabilityOf(pickedStaff, picked.date, pickedOverride).slots.length > 0;
  /** 欠勤・キャンセルの欄を開く URL（欠勤・キャンセルを切っていれば null でリンクを出さない。PRD D213） */
  const absenceHref = picked ? linkIfOn(data.org.features, suddenHref(picked.date, picked.staffId)) : null;
  const pick = (staffId: string, date: string) => {
    const s = staff.find((x) => x.id === staffId);
    if (!s) return;
    setPicked({ staffId, date });
    setDraft(toHalfHours(availabilityOf(s, date, overrides.get(`${staffId}_${date}`)).slots));
  };
  const save = (slots: Slot[]) => {
    if (!picked || slotsError(slots) || retiredWhy) return;
    const a: Availability = { staffId: picked.staffId, date: picked.date, slots };
    update((d) => ({
      ...d,
      availability: [...d.availability.filter((x) => !(x.staffId === a.staffId && x.date === a.date)), a],
    }));
    setDraft(slots);
    toast(slots.length === 0 ? '休みにしました' : '時間帯を保存しました');
  };
  const reset = () => {
    if (!picked || !pickedStaff) return;
    update((d) => ({
      ...d,
      availability: d.availability.filter((x) => !(x.staffId === picked.staffId && x.date === picked.date)),
    }));
    setDraft(toHalfHours(availabilityOf(pickedStaff, picked.date, null).slots));
    toast('基本の時間に戻しました');
  };

  return (
    <div className="stack">
      <PageHeader icon={Clock} title="稼働時間" lead={`${terms.staff}ごとの働ける時間`} />
      <div className="card stack">
        <div className="avail-legend">
          <span>
            <span className="swatch" aria-hidden="true" />
            基本の時間
          </span>
          <span>
            <span className="swatch is-override" aria-hidden="true" />
            その日だけ変更
          </span>
          <span>
            <span className="swatch is-off" aria-hidden="true" />
            休み
          </span>
          <span>
            <span className="avail-absence">欠勤</span>
            {suddenOn ? '急な欠勤（予定の画面で登録）' : '急な欠勤'}
          </span>
          <span>セルを押すと下で変えられます</span>
        </div>
        <Hint>
          薄い字は基本の曜日と時間（{terms.staff}
          の設定）。色の付いた日は、その日だけ変えた時間です。セルを押すと下で変更できます。
        </Hint>
        <EdgeScroll className="table-scroll avail-scroll">
          <table className="avail-table">
            <thead>
              <tr>
                <th className="avail-name">{terms.staff}</th>
                {dates.map((d) => (
                  <th key={d} className={`avail-day dow-${weekday(d)} ${d === today ? 'is-today' : ''}`}>
                    {Number(d.slice(5, 7))}/{Number(d.slice(8))}
                    <br />
                    {WEEKDAY_LABELS[weekday(d)]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id}>
                  <th className="avail-name">{s.name}</th>
                  {dates.map((d) => {
                    const o = overrides.get(`${s.id}_${d}`);
                    const ab = absences.get(`${s.id}_${d}`);
                    const { slots } = availabilityOf(s, d, o);
                    const isPicked = picked?.staffId === s.id && picked.date === d;
                    return (
                      <td key={d} className="avail-cell">
                        <button
                          type="button"
                          className={[
                            'avail-btn',
                            o ? 'is-override' : '',
                            slots.length === 0 ? 'is-off' : '',
                            isPicked ? 'is-picked' : '',
                          ].join(' ')}
                          title={`${s.name} ${d}：${slotsText(slots)}${ab ? `／${absenceText(ab, slots)}${ab.note ? `（${ab.note}）` : ''}` : ''}`}
                          onClick={() => pick(s.id, d)}
                        >
                          {slots.length === 0 ? (
                            <span className="avail-off">
                              <Coffee size={13} aria-hidden="true" />休
                            </span>
                          ) : (
                            short(slots).map((t) => <span key={t}>{t}</span>)
                          )}
                          {o && <Pencil className="avail-mark" size={9} aria-hidden="true" />}
                          {ab && (
                            <span className="avail-absence" data-testid="avail-absence">
                              {ab.from === null && ab.to === null
                                ? '欠勤'
                                : `欠 ${short([{ start: ab.from ?? slots[0]?.start ?? '00:00', end: ab.to ?? slots.at(-1)?.end ?? '24:00' }])[0]}`}
                            </span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </EdgeScroll>
        {staff.length === 0 && <p className="sub">在籍中の{terms.staff}がいません。</p>}
      </div>

      {picked && pickedStaff && (
        <SidePanel
          narrow
          icon={Clock}
          title={`${pickedStaff.name}・${picked.date.slice(5).replace('-', '/')}（${WEEKDAY_LABELS[weekday(picked.date)]}）`}
          onClose={() => setPicked(null)}
          footer={
            <>
              <button
                type="button"
                className="btn btn-primary"
                aria-disabled={!!(retiredWhy ?? slotsError(draft)) || undefined}
                title={retiredWhy ?? slotsError(draft) ?? undefined}
                onClick={() => save(draft)}
                data-testid="availability-save"
              >
                <WithIcon icon={Save}>この時間で保存</WithIcon>
              </button>
              <button
                type="button"
                className="btn"
                aria-disabled={!!retiredWhy || undefined}
                title={retiredWhy ?? undefined}
                onClick={() => save([])}
              >
                <WithIcon icon={Coffee}>休みにする</WithIcon>
              </button>
              {pickedOverride && (
                <button type="button" className="btn" onClick={reset}>
                  <WithIcon icon={RotateCcw}>基本の時間に戻す</WithIcon>
                </button>
              )}
            </>
          }
        >
          <p className="sub">
            基本：{slotsText(availabilityOf(pickedStaff, picked.date, null).slots)}
            {pickedOverride && '／この日は変更あり'}
          </p>
          {pickedAbsence && (
            <p className="warn-text" title={pickedAbsence.note || undefined}>
              {absenceText(
                pickedAbsence,
                availabilityOf(pickedStaff, picked.date, overrides.get(`${picked.staffId}_${picked.date}`)).slots,
              )}
              {pickedAbsence.note && `（${pickedAbsence.note}）`}。欠勤の登録・取り消しは予定の画面で
            </p>
          )}
          {/* その日の「欠勤・キャンセル」の欄をこの人で開く（PRD D203）。その日に働く日（保存した時間帯があり、
              最終勤務日の後でない）だけ。休みの日は欄の「休む人」に出ないので出さない（PR #48 のレビュー）。
              日の画面は ?date= を読むので setDate しない（Ctrl+クリックで元のタブの日付を変えない） */}
          {pickedWorks && absenceHref && (
            <p>
              <Link to={absenceHref} className="avail-absence-link" data-testid="availability-absence-link">
                {pickedAbsence ? 'この日の欠勤を直す・取り消す' : 'この日の欠勤を登録する'}
                （日の画面の「欠勤・キャンセル」で開く）
              </Link>
            </p>
          )}
          {retiredWhy && (
            <p className="warn-text" data-testid="availability-retired">
              {retiredWhy}
            </p>
          )}
          <SlotEditor value={draft} onChange={setDraft} />
        </SidePanel>
      )}
    </div>
  );
}
