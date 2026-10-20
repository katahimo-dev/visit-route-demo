import { Loader2, Square } from 'lucide-react';
import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { batchBandText, batchDoneText, monthBatch } from '../lib/monthBatch';
import { useValueStore } from '../lib/valueStore';
import { useDemoData } from '../store';
import { useToast } from './Toast';
import './batchBand.css';

/**
 * 月まとめ作成の計算（lib/monthBatch。ADR-0042）に store の data と update をつなぎ、終わったら知らせる（PRD D256・D257）。
 * App の直下に1つ。外れる（ページを閉じる）と作っている計算を捨てる
 */
export function MonthBatchHost(): ReactNode {
  const { data, update } = useDemoData();
  const latest = useRef(data);
  // 描いたデータを計算が読む（作っている間の編集も次の日から入れる）
  useLayoutEffect(() => {
    latest.current = data;
  }, [data]);
  useEffect(() => monthBatch.connect({ get: () => latest.current, update }), [update]);
  const toast = useToast();
  const navigate = useNavigate();
  const done = useValueStore(monthBatch.done);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 終わった知らせが変わったときだけ
  useEffect(() => {
    if (!done) return;
    toast(batchDoneText(done), {
      action: { label: '月の予定を見る', onClick: () => navigate(`/month?ym=${done.ym}`), testId: 'batch-done-open' },
    });
  }, [done]);
  return null;
}

/**
 * 上の帯の進み具合（PRD D256）：「11月の案を作っています 8/22日」と［止める］。月の予定の画面では画面の中に出すので出さない。
 * 文は月の予定へのリンク（その月を開く）
 */
export function BatchBand(): ReactNode {
  const run = useValueStore(monthBatch.run);
  const { pathname } = useLocation();
  if (!run || pathname === '/month') return null;
  return (
    <div className="batch-band" data-testid="batch-band">
      <Loader2 size={16} className="batch-band-spin" aria-hidden="true" />
      <Link to={`/month?ym=${run.ym}`} className="batch-band-text" data-testid="batch-band-text">
        {batchBandText(run)}
      </Link>
      <button
        type="button"
        className="btn btn-small"
        onClick={() => monthBatch.stop()}
        aria-label={`${run.label}の案づくりを止める`}
        data-testid="batch-band-stop"
      >
        <Square size={14} aria-hidden="true" />
        止める
      </button>
    </div>
  );
}
