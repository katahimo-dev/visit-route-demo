// vitest の各 test の前に、イベントループを1回まわす（PRD D254）。
// 同期の重い test が続くと、test の合間が Promise だけでつながり worker が親からの返事（IPC）を読めない。
// そのまま 60秒たつと worker の連絡（onTaskUpdate）が時間切れになり、全部通っても終了コード1になる。
// setImmediate は I/O（返事の読み取り）のあとに回るので、ここで待つと返事を先に読む
import { beforeEach, vi } from 'vitest';

// 読んだ時点の本物の setImmediate を持っておく。偽のタイマー（vi.useFakeTimers）のまま落ちた test のあとでも、
// 偽の setImmediate を待って次の test が止まらないように
const realSetImmediate = globalThis.setImmediate;

beforeEach(() => {
  // 偽のタイマーが入っているなら回さない（その test の中の時計を進めない）
  if (vi.isFakeTimers()) return;
  return new Promise<void>((resolve) => realSetImmediate(resolve));
});
