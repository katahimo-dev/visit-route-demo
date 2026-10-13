// 最適化ワーカー。step を小分けに進め、合間に setTimeout(0) で stop を受け取る
import type { WorkerRequest, WorkerResponse } from '../contracts/problem';
import { createSolver } from './anneal';

/** 1回の小分けで進める反復 */
const CHUNK = 2000;
/** 小分けを続けて回す時間（ms）。これを超えたらメッセージを受け取りに戻る */
const SLICE_MS = 50;
/** 進捗を送る間隔（ms） */
const PROGRESS_MS = 100;

type Job = { requestId: string; stop: boolean };
let job: Job | null = null;

const post = (m: WorkerResponse) => self.postMessage(m);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'stop') {
    if (job && job.requestId === msg.requestId) job.stop = true;
    return;
  }
  if (msg.type !== 'solve') return;
  const me: Job = { requestId: msg.requestId, stop: false };
  job = me;
  try {
    const solver = createSolver(msg.problem, msg.options);
    const total = msg.options.iterations;
    let lastProgress = -Infinity;
    const run = () => {
      if (job !== me) return; // 新しい依頼に置き換わった
      try {
        const t0 = performance.now();
        let done = false;
        while (!done && !me.stop && performance.now() - t0 < SLICE_MS) done = solver.step(CHUNK);
        if (done || me.stop) {
          job = null;
          post({ type: 'done', requestId: me.requestId, result: solver.best() });
          return;
        }
        const now = performance.now();
        if (now - lastProgress >= PROGRESS_MS) {
          lastProgress = now;
          post({
            type: 'progress',
            requestId: me.requestId,
            iteration: solver.iteration(),
            total,
            bestScore: solver.bestScore(),
            bestRoutes: solver.best().routes,
          });
        }
        setTimeout(run, 0);
      } catch (err) {
        fail(me, err);
      }
    };
    run();
  } catch (err) {
    fail(me, err);
  }
};

function fail(me: Job, err: unknown) {
  if (job === me) job = null;
  console.error(err);
  post({ type: 'error', requestId: me.requestId, message: 'AI案の計算中に問題が起きました' });
}
