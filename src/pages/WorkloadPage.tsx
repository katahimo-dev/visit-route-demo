import { ArrowLeft, ChevronLeft, ChevronRight, ClipboardCopy, Timer, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useDay } from '../app/day';
import { EdgeScroll } from '../components/EdgeScroll';
import { EmptyNext } from '../components/EmptyNext';
import { StaffLegend } from '../components/staffBar';
import { Term } from '../components/Term';
import { useToast } from '../components/Toast';
import { Hint, PageHeader, SectionTitle, WithIcon } from '../components/ui';
import { SpanBar, SpanMini } from '../components/workBars';
import { timeText } from '../domain/availability';
import { jstDate, minutesToHhmm, weekday } from '../domain/time';
import { copyText } from '../lib/clipboard';
import { byName, WEEKDAY_LABELS } from '../lib/common';
import { periodEmptyGuide } from '../lib/emptyGuide';
import { activeVisitsOn, addMonths, isYm, monthDates, ymOf } from '../lib/month';
import { mdText } from '../lib/patternText';
import { useFeature } from '../lib/useFeature';
import { hmText, kmOf, type WorkDay, type WorkStat, workloadTsv, workMonth, workTotals } from '../lib/workload';
import { useDemoData } from '../store';
import './workload.css';

/**
 * 稼働の見込み（PRD D72。ADR-0015。#/workload?ym=2026-11）：予定（確定した割当、無ければ今の案）から、
 * 〈スタッフ〉×日ごとの拘束・訪問・移動・待ちの時間と、移動の距離・交通費を見込む。実績ではない（記録・勤怠はやらない）。
 * 月の合計の表、〈スタッフ〉×日の表（拘束の長さの横棒）、選んだ人の日ごとの時間軸の横棒。交通費の単価と拘束の上限は事業所の設定
 */
export default function WorkloadPage() {
  const { data, update } = useDemoData();
  const { date, setDate } = useDay();
  const navigate = useNavigate();
  /** 上限の入力欄の名前（aria-labelledby） */
  const limitId = useId();
  const toast = useToast();
  const terms = data.org.terms;
  const [params, setParams] = useSearchParams();
  const raw = params.get('ym') ?? '';
  const ym = isYm(raw) ? raw : ymOf(date);
  const today = jstDate(Date.now());
  const org = data.org;
  // 交通費（ADR-0028 の fare）を切っていれば、単価の欄と交通費の列を出さない（単価の値は消さない）
  const fareFeature = useFeature('fare');
  const fareOn = fareFeature && org.fareYenPerKm > 0;

  const days: WorkDay[] = useMemo(() => workMonth(data, ym), [data, ym]);
  const totals = useMemo(() => workTotals(days), [days]);
  /** 表に出す人：利用中の人と、この月に見込みのある人（名前の順） */
  const staff = useMemo(
    () => [...data.staff].filter((s) => s.active || totals.has(s.id)).sort(byName),
    [data.staff, totals],
  );
  const rows = staff.filter((s) => totals.has(s.id));
  const sumOf = (pick: (t: NonNullable<ReturnType<typeof totals.get>>) => number) =>
    rows.reduce((m, s) => m + pick(totals.get(s.id)!), 0);
  const overDays = sumOf((t) => t.overDays);
  const planDays = days.filter((d) => d.source !== null).length;
  /** 空の画面の文とボタン（PRD D176。案のある日があれば null） */
  const emptyGuide = useMemo(() => {
    const dates = monthDates(ym);
    return periodEmptyGuide({
      period: 'この月',
      dates,
      today,
      visitDays: dates.filter((d) => activeVisitsOn(data, d).length > 0),
      planDays: days.filter((d) => d.source !== null).map((d) => d.date),
    });
  }, [ym, today, data, days]);

  // ---- 選んだ人の日ごと ----
  const sid = params.get('staff');
  const picked = rows.find((s) => s.id === sid) ?? rows[0];
  const pickedDays = useMemo(
    () =>
      picked
        ? days.flatMap((d) => {
            const x = d.stats.find((y) => y.staffId === picked.id);
            return x ? [{ day: d, stat: x }] : [];
          })
        : [],
    [days, picked],
  );
  /** 時間軸の範囲（7:00〜20:00。はみ出す日があれば広げる） */
  const axis = useMemo(() => {
    let start = 7 * 60;
    let end = 20 * 60;
    for (const { stat } of pickedDays) {
      start = Math.min(start, Math.floor(stat.start / 60) * 60);
      end = Math.max(end, Math.ceil(stat.end / 60) * 60);
    }
    return { start, end };
  }, [pickedDays]);

  /** その日の日の画面を開く（選んでいる日付をその日にしてから移る。PRD D202） */
  const openDay = (d: string) => {
    setDate(d);
    navigate('/plan');
  };

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

  // ---- 設定（事業所の交通費の単価・拘束の上限） ----
  const [fare, setFare] = useState(String(org.fareYenPerKm));
  const [limit, setLimit] = useState(String(org.spanLimitHours));
  useEffect(() => {
    setFare(String(org.fareYenPerKm));
  }, [org.fareYenPerKm]);
  useEffect(() => {
    setLimit(String(org.spanLimitHours));
  }, [org.spanLimitHours]);
  const fareNum = Number(fare);
  const limitNum = Number(limit);
  const fareError =
    fare.trim() === '' || !Number.isFinite(fareNum) || fareNum < 0 || fareNum > 1000
      ? '0〜1000 の数にしてください'
      : null;
  const limitError =
    limit.trim() === '' ||
    !Number.isFinite(limitNum) ||
    limitNum < 0 ||
    limitNum > 24 ||
    !Number.isInteger(limitNum * 2)
      ? '0〜24 の 0.5刻みにしてください'
      : null;
  const saveFare = () => {
    if (fareError || fareNum === org.fareYenPerKm) return;
    update((d) => ({ ...d, org: { ...d.org, fareYenPerKm: fareNum } }));
    toast(fareNum > 0 ? `交通費の単価を ${fareNum}円/km にしました` : '交通費を出さないようにしました');
  };
  const saveLimit = () => {
    if (limitError || limitNum === org.spanLimitHours) return;
    update((d) => ({ ...d, org: { ...d.org, spanLimitHours: limitNum } }));
    toast(
      limitNum > 0
        ? `出勤〜退勤（拘束）の上限を ${limitNum}時間 にしました`
        : '出勤〜退勤（拘束）の注意を出さないようにしました',
    );
  };

  const copy = async () => {
    const ok = await copyText(workloadTsv(days, rows, org));
    toast(ok ? '表をコピーしました（表計算に貼り付けられます）' : 'コピーできませんでした');
  };

  const statTitle = (name: string, d: string, x: WorkStat) =>
    `${name}さん ${mdText(d)}：${clock(x.start)}〜${clock(x.end)}・出勤〜退勤（拘束） ${hmText(x.span)}（訪問 ${hmText(x.visit)}・移動 ${hmText(
      x.travel,
    )}・空き時間（待ち） ${hmText(x.wait)}）・訪問 ${x.count}件${x.over ? '・出勤〜退勤（拘束）が上限を超える' : ''}`;

  return (
    <div className="stack">
      <PageHeader
        icon={Timer}
        title="勤務の見込み"
        lead={`予定から見込んだ、${terms.staff}ごとの出勤〜退勤（拘束）・移動・空き時間（待ち）の時間${fareFeature ? 'と交通費' : ''}です。実績ではありません`}
      />

      <div className="card stack work-head">
        <div className="row work-nav">
          <Link className="btn btn-small" to={`/month?ym=${ym}`}>
            <WithIcon icon={ArrowLeft} size={14}>
              月の予定に戻る
            </WithIcon>
          </Link>
          <button
            type="button"
            className="icon-btn"
            aria-label="前の月"
            onClick={() => patch({ ym: addMonths(ym, -1) })}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <h2 className="work-title" data-testid="work-title">
            {ym.slice(0, 4)}年{Number(ym.slice(5, 7))}月
          </h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="次の月"
            onClick={() => patch({ ym: addMonths(ym, 1) })}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-small"
            aria-disabled={ym === ymOf(today) || undefined}
            title={ym === ymOf(today) ? 'いま今月を見ています' : '今月を見る'}
            onClick={() => {
              if (ym !== ymOf(today)) patch({ ym: ymOf(today) });
            }}
          >
            今月
          </button>
          <button
            type="button"
            className="btn btn-small"
            aria-disabled={rows.length === 0 || undefined}
            title={rows.length === 0 ? 'この月には見込める予定がありません' : '表計算に貼り付けられる形でコピーします'}
            onClick={() => {
              if (rows.length > 0) void copy();
            }}
            data-testid="work-copy"
          >
            <WithIcon icon={ClipboardCopy} size={14}>
              表をコピー
            </WithIcon>
          </button>
          <span className="sub" data-testid="work-summary">
            案のある日 {planDays}日・{terms.staff} {rows.length}人
            {overDays > 0 ? `・出勤〜退勤（拘束）が上限を超える ${overDays}日（のべ）` : ''}
          </span>
        </div>
        <div className="row work-settings">
          {fareFeature && (
            <label className="work-setting">
              <span>交通費の単価</span>
              <input
                type="number"
                min={0}
                max={1000}
                step={1}
                value={fare}
                onChange={(e) => setFare(e.target.value)}
                onBlur={saveFare}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveFare();
                }}
                aria-invalid={!!fareError || undefined}
                data-testid="work-fare"
              />
              <span>円/km（0 なら交通費を出しません）</span>
              {fareError && <span className="error">{fareError}</span>}
            </label>
          )}
          {/* 用語の説明（ボタン）は label の中に置かない（PR #42 のレビュー）。入力欄の名前は aria-labelledby でつなぐ */}
          <div className="work-setting">
            <span>
              <Term k="span" testId="term-span" id={`${limitId}-term`} />
              <span id={`${limitId}-label`}>の上限</span>
            </span>
            <input
              aria-labelledby={`${limitId}-term ${limitId}-label`}
              type="number"
              min={0}
              max={24}
              step={0.5}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              onBlur={saveLimit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveLimit();
              }}
              aria-invalid={!!limitError || undefined}
              data-testid="work-limit"
            />
            <span>時間（超える日に注意。0 なら出しません）</span>
            {limitError && <span className="error">{limitError}</span>}
          </div>
        </div>
        <Hint label="見込みの数え方">
          数えるのはその日の確定した割当（無ければ今の案）です。出勤〜退勤（拘束）は最初の訪問の開始から最後の訪問の終わりまでで、直行直帰として自宅との行き帰りは入れません（距離と交通費には入れます）。空き時間（待ち）は訪問のあいだの空き（休憩に使える時間）です。移動の時間と距離は直線距離からの概算です。出勤〜退勤（拘束）の上限は注意を出すだけで、AI案の条件には入りません。予定からの見込みで、実績（打刻）ではありません。
        </Hint>
      </div>

      {rows.length === 0 ? (
        <div className="card" data-testid="work-empty">
          {/* 空の画面（PRD D176）：なぜ空かと次の一手（月の画面のまとめて作る・日の画面） */}
          {emptyGuide ? (
            <EmptyNext guide={emptyGuide} icon={Timer} onOpenDay={openDay} />
          ) : (
            <p className="sub">この月には、見込める予定（訪問のある案）がありません。</p>
          )}
        </div>
      ) : (
        <>
          <section className="card stack">
            <SectionTitle icon={Timer} aside={<span className="sub">予定からの見込み（実績ではありません）</span>}>
              月の合計
            </SectionTitle>
            <div className="table-scroll">
              <table className="work-table" data-testid="work-totals">
                <thead>
                  <tr>
                    <th scope="col">名前</th>
                    <th scope="col" className="num">
                      日数
                    </th>
                    <th scope="col" className="num">
                      訪問
                    </th>
                    <th scope="col" className="num">
                      {/* 同じ画面の2か所目から説明を付けない（PRD D241。上限の設定に付けている） */}
                      <Term k="span" plain />
                    </th>
                    <th scope="col">一番長い日</th>
                    <th scope="col" className="num">
                      訪問の時間
                    </th>
                    <th scope="col" className="num">
                      移動
                    </th>
                    <th scope="col" className="num">
                      <Term k="wait" />
                    </th>
                    <th scope="col" className="num">
                      自宅との行き帰り
                    </th>
                    <th scope="col" className="num">
                      距離
                    </th>
                    {fareOn && (
                      <th scope="col" className="num">
                        交通費
                      </th>
                    )}
                    <th scope="col" className="num">
                      上限超え
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const t = totals.get(s.id)!;
                    return (
                      <tr key={s.id}>
                        <th scope="row" className="work-name">
                          <button
                            type="button"
                            className="link-btn"
                            aria-pressed={picked?.id === s.id}
                            onClick={() => patch({ staff: s.id })}
                            title="押すと下の日ごとの表に出します"
                          >
                            {s.name}
                          </button>
                        </th>
                        <td className="num">{t.days}日</td>
                        <td className="num">{t.count}件</td>
                        <td className="num">{hmText(t.span)}</td>
                        <td>
                          <span className="work-max">
                            <SpanMini
                              stat={{ ...emptyStat(s.id), span: t.maxSpan, over: t.overDays > 0 }}
                              limitHours={org.spanLimitHours}
                            />
                            <span>{hmText(t.maxSpan)}</span>
                          </span>
                        </td>
                        <td className="num">{hmText(t.visit)}</td>
                        <td className="num">{hmText(t.travel)}</td>
                        <td className="num">{hmText(t.wait)}</td>
                        <td className="num">{hmText(t.home)}</td>
                        <td className="num">{kmOf(t.meters)}km</td>
                        {fareOn && <td className="num">{t.fareYen.toLocaleString()}円</td>}
                        <td className={`num${t.overDays > 0 ? ' warn-text' : ''}`}>
                          {t.overDays > 0 ? (
                            <WithIcon icon={TriangleAlert} size={13}>
                              {t.overDays}日
                            </WithIcon>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">合計</th>
                    <td className="num">{sumOf((t) => t.days)}日</td>
                    <td className="num">{sumOf((t) => t.count)}件</td>
                    <td className="num">{hmText(sumOf((t) => t.span))}</td>
                    <td />
                    <td className="num">{hmText(sumOf((t) => t.visit))}</td>
                    <td className="num">{hmText(sumOf((t) => t.travel))}</td>
                    <td className="num">{hmText(sumOf((t) => t.wait))}</td>
                    <td className="num">{hmText(sumOf((t) => t.home))}</td>
                    <td className="num">{kmOf(sumOf((t) => t.meters))}km</td>
                    {fareOn && <td className="num">{sumOf((t) => t.fareYen).toLocaleString()}円</td>}
                    <td className="num">{overDays > 0 ? `${overDays}日` : '—'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section className="card stack">
            <SectionTitle
              icon={Timer}
              aside={
                <span className="sub">
                  横棒は出勤〜退勤（拘束）の長さ（{12}時間で端まで。縦の線は上限）。上限を超える日は斜線と「!」
                </span>
              }
            >
              {terms.staff}×日の出勤〜退勤（拘束）
            </SectionTitle>
            <EdgeScroll className="table-scroll work-grid-scroll">
              <table className="work-grid" data-testid="work-grid">
                <thead>
                  <tr>
                    <th scope="col" className="work-grid-name">
                      名前
                    </th>
                    {days.map((d) => (
                      <th
                        key={d.date}
                        scope="col"
                        className={`work-grid-day${weekday(d.date) === 0 ? ' is-sun' : weekday(d.date) === 6 ? ' is-sat' : ''}`}
                      >
                        {Number(d.date.slice(8, 10))}
                        <small>{WEEKDAY_LABELS[weekday(d.date)]}</small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <th scope="row" className="work-grid-name">
                        {s.name}
                      </th>
                      {days.map((d) => {
                        const x = d.stats.find((y) => y.staffId === s.id);
                        return (
                          <td key={d.date} className={`work-cell${x?.over ? ' is-over' : ''}`}>
                            {x ? (
                              // 押すとその日の日の画面（PRD D202。名前の吹き出しは付けない：D124）
                              <button
                                type="button"
                                className="work-cell-in work-cell-btn"
                                title={statTitle(s.name, d.date, x)}
                                aria-label={`${spanNum(x)}${x.over ? '!' : ''}：${statTitle(s.name, d.date, x)}（日の予定で開く）`}
                                onClick={() => openDay(d.date)}
                                data-date={d.date}
                              >
                                <span className="work-cell-num">
                                  {spanNum(x)}
                                  {x.over && (
                                    <strong>
                                      !<span className="sr-only">（上限を超える）</span>
                                    </strong>
                                  )}
                                </span>
                                <SpanMini stat={x} limitHours={org.spanLimitHours} />
                              </button>
                            ) : (
                              <span className="sub">
                                <span aria-hidden="true">・</span>
                                <span className="sr-only">訪問なし</span>
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </EdgeScroll>
            <p className="sub" data-testid="work-grid-note">
              数字は出勤〜退勤（拘束）の時間（時間）です。マスを押すとその日の「日の予定」を開きます。内訳は下の「日ごと」の表で見られます。
            </p>
          </section>

          {picked && (
            <section className="card stack" data-testid="work-detail">
              <SectionTitle icon={Timer}>
                <span className="work-detail-title">
                  日ごと：
                  <select
                    value={picked.id}
                    onChange={(e) => patch({ staff: e.target.value })}
                    aria-label={`日ごとに見る${terms.staff}`}
                    data-testid="work-staff"
                  >
                    {rows.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </span>
              </SectionTitle>
              <p className="row work-legend sub">
                <span>横棒は最初の訪問の開始〜最後の訪問の終わり（拘束）。</span>
                <StaffLegend
                  states={['visit', 'travel', 'free']}
                  labels={{ free: '空き時間（待ち。休憩に使える時間）' }}
                />
                <span>上限を超える日は太い枠と注意の印</span>
              </p>
              <div className="table-scroll">
                <table className="work-table work-days">
                  <thead>
                    <tr>
                      <th scope="col">日付</th>
                      <th scope="col" className="work-axis-head">
                        <span className="work-axis" aria-hidden="true">
                          {axisMarks(axis).map((m) => (
                            <span key={m} style={{ left: `${((m - axis.start) / (axis.end - axis.start)) * 100}%` }}>
                              {m / 60}
                            </span>
                          ))}
                        </span>
                        <span className="sr-only">時間帯</span>
                      </th>
                      <th scope="col">始め〜終わり</th>
                      <th scope="col" className="num">
                        {/* 日ごとの表は月の合計の表と同じ語なので文字だけ（PRD D241） */}
                        <Term k="span" plain />
                      </th>
                      <th scope="col" className="num">
                        訪問
                      </th>
                      <th scope="col" className="num">
                        移動
                      </th>
                      <th scope="col" className="num">
                        <Term k="wait" plain />
                      </th>
                      <th scope="col" className="num">
                        距離
                      </th>
                      {fareOn && (
                        <th scope="col" className="num">
                          交通費
                        </th>
                      )}
                      <th scope="col">案の元</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pickedDays.map(({ day, stat }) => (
                      <tr key={day.date} className={stat.over ? 'is-over' : ''}>
                        <th scope="row" className="nowrap">
                          {/* 日付から日の画面（PRD D202） */}
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => openDay(day.date)}
                            aria-label={`${mdText(day.date)}（${WEEKDAY_LABELS[weekday(day.date)]}）（日の予定で開く）`}
                            title="押すとその日の「日の予定」を開きます"
                            data-testid="work-day-open"
                            data-date={day.date}
                          >
                            {mdText(day.date)}（{WEEKDAY_LABELS[weekday(day.date)]}）
                          </button>
                        </th>
                        <td className="work-axis-cell">
                          <SpanBar stat={stat} range={axis} />
                        </td>
                        <td className="nowrap">
                          {clock(stat.start)}〜{clock(stat.end)}
                        </td>
                        <td className={`num${stat.over ? ' warn-text' : ''}`}>
                          {stat.over ? (
                            <WithIcon icon={TriangleAlert} size={13}>
                              {hmText(stat.span)}
                            </WithIcon>
                          ) : (
                            hmText(stat.span)
                          )}
                        </td>
                        <td className="num">
                          {hmText(stat.visit)}（{stat.count}件）
                        </td>
                        <td className="num">{hmText(stat.travel)}</td>
                        <td className="num">{hmText(stat.wait)}</td>
                        <td className="num">{kmOf(stat.meters)}km</td>
                        {fareOn && <td className="num">{stat.fareYen.toLocaleString()}円</td>}
                        <td className="sub">{day.source === 'confirmed' ? '確定' : '今の案'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** マスに出す拘束の時間（時間。小数1桁。読み上げの先頭にも同じ文字を置く） */
const spanNum = (x: WorkStat): string => (Math.round((x.span / 60) * 10) / 10).toFixed(1);

const clock = (m: number) => timeText(minutesToHhmm(Math.round(m)));

/** 時間軸の目盛り（2時間ごと） */
function axisMarks(axis: { start: number; end: number }): number[] {
  const out: number[] = [];
  for (let m = Math.ceil(axis.start / 120) * 120; m <= axis.end; m += 120) out.push(m);
  return out;
}

const emptyStat = (staffId: string): WorkStat => ({
  staffId,
  count: 0,
  start: 0,
  end: 0,
  span: 0,
  visit: 0,
  travel: 0,
  wait: 0,
  home: 0,
  meters: 0,
  fareYen: 0,
  over: false,
  parts: [],
});
