// vitest の各 test の前に、イベントループを1回まわす（PRD D254）。
// 同期の重い test が続くと、test の合間が Promise だけでつながり worker が親からの返事（IPC）を読めない。
// そのまま 60秒たつと worker の連絡（onTaskUpdate）が時間切れになり、全部通っても終了コード1になる。
// setImmediate は I/O（返事の読み取り）のあとに回るので、ここで待つと返事を先に読む
import { beforeEach } from 'vitest';

beforeEach(() => new Promise<void>((resolve) => setImmediate(resolve)));
