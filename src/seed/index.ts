// 入口（実装は seed 担当）
import type { DemoData } from '../contracts/data';

/** today（YYYY-MM-DD）から14日分。同じ日付なら同じデータ */
export function createDemoData(_today: string): DemoData {
  throw new Error('未実装');
}
