// 入口（実装は matching 担当）
import type { DemoData } from '../contracts/data';
import type { Problem, RouteTiming } from '../contracts/problem';
import type { Condition, Item, TraitValue } from '../contracts/rules';

/** その日の問題を作る（キャンセルした訪問・休止中のスタッフ/訪問先は入れない） */
export function compile(_data: DemoData, _date: string): Problem {
  throw new Error('未実装');
}
/** 相手の特性 value が条件を満たすか（項目がなければ false） */
export function matches(_cond: Condition, _item: Item | undefined, _value: TraitValue | undefined): boolean {
  throw new Error('未実装');
}
/** 条件の表示文（例：「資格に看護師を含む」「経験年数 3以上」） */
export function conditionText(_cond: Condition, _item: Item | undefined): string {
  throw new Error('未実装');
}
/** 1人のルートの時刻（contracts/problem.ts の規則。strict で違反があれば null） */
export function scheduleRoute(
  _problem: Problem,
  _staff: number,
  _visits: number[],
  _mode: 'strict' | 'lenient',
): RouteTiming | null {
  throw new Error('未実装');
}
