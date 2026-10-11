import type { ReactNode } from 'react';
import type { DemoData } from '../contracts/data';

export type DemoStore = {
  data: DemoData;
  /** データを書き換える唯一の方法（不変更新。fn は新しい DemoData を返す） */
  update(fn: (d: DemoData) => DemoData): void;
  /** 読み込んだデータで置き換える */
  replace(d: DemoData): void;
  /** 初期状態に戻す */
  reset(): void;
  /** 保存に失敗したときの利用者向けの文言（容量超過など）。なければ null */
  saveError: string | null;
};

export function DemoDataProvider(_props: { children: ReactNode }): ReactNode {
  throw new Error('未実装');
}
export function useDemoData(): DemoStore {
  throw new Error('未実装');
}
