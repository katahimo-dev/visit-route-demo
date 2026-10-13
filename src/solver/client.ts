import type { Problem, SolveOptions, SolveResult, WorkerRequest, WorkerResponse } from '../contracts/problem';

/** 上限の時間（ms）。これを過ぎたら stop して途中の案を採る */
const TIME_LIMIT_MS = 30_000;
/** 利用者に見せるエラーの文言（内部の文言は出さない） */
const ERROR_MESSAGE = 'AI案を作れませんでした。もう一度お試しください。';

let counter = 0;

/**
 * Worker で解く。onProgress は間引いて呼ぶ。stop() でそれまでの最良案（stopped=true）で終わる。
 * 30秒たったら自動で stop する
 */
export function runSolve(
  problem: Problem,
  options: SolveOptions,
  onProgress?: (p: {
    iteration: number;
    total: number;
    bestScore: number;
    bestRoutes: Record<string, string[]>;
  }) => void,
): { promise: Promise<SolveResult>; stop(): void } {
  counter += 1;
  const requestId = `solve-${counter}`;
  let worker: Worker | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  const cleanup = () => {
    settled = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    worker?.terminate();
    worker = null;
  };
  const stop = () => {
    if (settled || !worker) return;
    worker.postMessage({ type: 'stop', requestId } satisfies WorkerRequest);
  };

  const promise = new Promise<SolveResult>((resolve, reject) => {
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch {
      cleanup();
      reject(new Error(ERROR_MESSAGE));
      return;
    }
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (settled || m.requestId !== requestId) return;
      if (m.type === 'progress') {
        onProgress?.({ iteration: m.iteration, total: m.total, bestScore: m.bestScore, bestRoutes: m.bestRoutes });
      } else if (m.type === 'done') {
        cleanup();
        resolve(m.result);
      } else {
        cleanup();
        reject(new Error(ERROR_MESSAGE));
      }
    };
    worker.onerror = (e) => {
      e.preventDefault();
      cleanup();
      reject(new Error(ERROR_MESSAGE));
    };
    worker.postMessage({ type: 'solve', requestId, problem, options } satisfies WorkerRequest);
    timer = setTimeout(stop, TIME_LIMIT_MS);
  });
  return { promise, stop };
}
