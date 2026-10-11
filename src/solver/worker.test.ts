import { describe, expect, it } from 'vitest';
import type { WorkerRequest, WorkerResponse } from '../contracts/problem';
import { compile } from '../matching';
import { DATE, randomData, rule } from '../matching/fixtures';

// Worker の外で worker.ts を動かす（self を差し替える）
const posted: WorkerResponse[] = [];
const fakeSelf: { postMessage(m: WorkerResponse): void; onmessage: ((e: { data: WorkerRequest }) => void) | null } = {
  postMessage: (m) => posted.push(m),
  onmessage: null,
};
(globalThis as unknown as { self: typeof fakeSelf }).self = fakeSelf;
await import('./worker');
const send = (data: WorkerRequest) => fakeSelf.onmessage!({ data });

const until = async (f: () => boolean) => {
  for (let i = 0; i < 2000 && !f(); i++) await new Promise((r) => setTimeout(r, 5));
};

describe('worker', () => {
  const problem = compile(randomData(8, 30, 3, [rule('w', 'wait', 3)]), DATE);

  it('最後まで解くと done を返す', async () => {
    posted.length = 0;
    send({ type: 'solve', requestId: 'a', problem, options: { seed: 1, iterations: 20000 } });
    await until(() => posted.some((m) => m.type === 'done'));
    const done = posted.find((m) => m.type === 'done');
    expect(done?.type === 'done' && done.result.stopped).toBe(false);
    expect(done?.type === 'done' && done.result.iterations).toBe(20000);
  });

  it('stop でそれまでの最良案（stopped=true）を返す', async () => {
    posted.length = 0;
    send({ type: 'solve', requestId: 'b', problem, options: { seed: 1, iterations: 1e9 } });
    await until(() => posted.some((m) => m.type === 'progress'));
    send({ type: 'stop', requestId: 'b' });
    await until(() => posted.some((m) => m.type === 'done'));
    const done = posted.find((m) => m.type === 'done');
    expect(done?.requestId).toBe('b');
    expect(done?.type === 'done' && done.result.stopped).toBe(true);
    const progress = posted.find((m) => m.type === 'progress');
    expect(progress).toMatchObject({ requestId: 'b', total: 1e9 });
  });
});
