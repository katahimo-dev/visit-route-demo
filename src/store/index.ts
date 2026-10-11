// 入口（実装は store 担当）。画面はここだけを import する
import type { DemoData, ImportError } from '../contracts/data';

export function load(): DemoData {
  throw new Error('未実装');
}
/** 300ms 間引きで保存。容量超過は RESOURCE_EXHAUSTED を onError に渡す */
export function save(_data: DemoData): void {
  throw new Error('未実装');
}
export function reset(): DemoData {
  throw new Error('未実装');
}
export function exportJson(_data: DemoData): Blob {
  throw new Error('未実装');
}
export function importJson(_text: string): DemoData | ImportError {
  throw new Error('未実装');
}
export function migrate(_raw: unknown): DemoData | ImportError {
  throw new Error('未実装');
}
export { DemoDataProvider, useDemoData } from './react';
