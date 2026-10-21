import { Loader2, Square } from 'lucide-react';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useDay } from '../app/day';
import { monthShown } from '../lib/month';
import { batchBandText, batchDoneText, monthBatch } from '../lib/monthBatch';
import { useValueStore } from '../lib/valueStore';
import { useDemoData } from '../store';
import { useToast } from './Toast';
import './batchBand.css';

/**
 * 月まとめ作成の計算（lib/monthBatch。ADR-0042）に store の data と update をつなぎ、終わったら知らせる（PRD D256・D257）。
 * App の直下に1つ。外れる（ページを閉じる）と作っている計算を捨てる。データを丸ごと差し替えたら（読み込み・初期状態に戻す・
 * 直前の状態に戻す・別のタブの変更）作っている計算を捨てる（古いデータから作った結果を新しいデータに書かない）
 */
export function MonthBatchHost(): ReactNode {
  const { data, update, replacedCount } = useDemoData();
  const latest = useRef(data);
  // 描いたデータを計算が読む（作っている間の編集も次の日から入れる）
  useLayoutEffect(() => {
    latest.current = data;
  }, [data]);
  useEffect(() => {
    return monthBatch.connect({ get: () => latest.current, update });
  }, [update]);
  // 差し替えた回数が変わったら捨てる（描く前に。差し替えたデータが描かれてから次の日を読まない）
  const lastReplaced = useRef(replacedCount);
  useLayoutEffect(() => {
    if (replacedCount === lastReplaced.current) return;
    lastReplaced.current = replacedCount;
    monthBatch.abort();
  }, [replacedCount]);
  const toast = useToast();
  const navigate = useNavigate();
  const done = useValueStore(monthBatch.done);
  /** 今いる画面（終わった知らせを出すときに読む。描くたびに書き直す） */
  const { pathname, search } = useLocation();
  const { date } = useDay();
  const viewing = useRef({ pathname, search, date });
  viewing.current = { pathname, search, date };
  /** 知らせた終わり（描き直し・付け直しで同じ知らせを二度出さない。つないだときにあった古い知らせも出さない） */
  const shown = useRef(done);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 終わった知らせが変わったときだけ
  useEffect(() => {
    if (!done || done === shown.current) return;
    shown.current = done;
    // 行き先が今いる画面と同じ（その月の月の予定を見ている）なら［月の予定を見る］を出さない（PRD D268）
    const here = viewing.current;
    const same = here.pathname === '/month' && monthShown(here.search, here.date) === done.ym;
    toast(
      batchDoneText(done),
      same
        ? undefined
        : {
            action: {
              label: '月の予定を見る',
              onClick: () => navigate(`/month?ym=${done.ym}`),
              testId: 'batch-done-open',
            },
          },
    );
  }, [done]);
  return null;
}

/** 帯が消えたあとのフォーカスの行き先（本文の見出し、無ければ本文） */
function focusMain() {
  const h = document.querySelector<HTMLElement>('.app-main h1');
  const target = h ?? document.querySelector<HTMLElement>('.app-main');
  if (!target) return;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}

/**
 * 上の帯の進み具合（PRD D256）：「11月の案を作っています 8/22日」と［止める］。月の予定の画面では画面の中に出すので出さない。
 * 文は月の予定へのリンク（その月を開く）。［止める］は押すと「止めています…」で二度押しを防ぎ、帯が消えたとき
 * フォーカスが帯の中にあれば本文の見出しへ移す（フォーカスを失わない）
 */
export function BatchBand(): ReactNode {
  const run = useValueStore(monthBatch.run);
  const { pathname } = useLocation();
  const [stopping, setStopping] = useState(false);
  /** フォーカスが帯の中にあるか（帯が消えると blur が来ないことがあるので、外へ移ったときだけ下ろす） */
  const focusInside = useRef(false);
  const shown = !!run && pathname !== '/month';
  useEffect(() => {
    if (shown) return;
    setStopping(false);
    if (focusInside.current) {
      focusInside.current = false;
      if (!run) focusMain();
    }
  }, [shown, run]);
  if (!shown) return null;
  return (
    <section
      className="batch-band"
      aria-label="月まとめ作成の進み具合"
      data-testid="batch-band"
      onFocus={() => {
        focusInside.current = true;
      }}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && !e.currentTarget.contains(next)) focusInside.current = false;
      }}
    >
      <Loader2 size={16} className="batch-band-spin" aria-hidden="true" />
      <Link to={`/month?ym=${run.ym}`} className="batch-band-text" data-testid="batch-band-text">
        {batchBandText(run)}
      </Link>
      <button
        type="button"
        className="btn btn-small"
        aria-disabled={stopping || undefined}
        onClick={() => {
          if (stopping) return;
          setStopping(true);
          monthBatch.stop();
        }}
        aria-label={stopping ? `${run.label}の案づくりを止めています` : `${run.label}の案づくりを止める`}
        data-testid="batch-band-stop"
      >
        <Square size={14} aria-hidden="true" />
        {stopping ? '止めています…' : '止める'}
      </button>
    </section>
  );
}
