// 条件の変更の控え（PRD D290。ADR-0049）：作り直しの帯で「何が変わったか」を出し「戻す」ための、最後に影響する日が0日だった時点の条件。
// DemoData とは別のキー（データの版・書き出し・読み込みに入れない。backup.ts・tour.ts と同じ扱い）。localStorage を触るのは store の中だけ（AGENTS.md）。
// 使えないブラウザでも、開いている間は覚える
import type { DemoData } from '../contracts/data';
import { demoDataSchema } from '../contracts/data';

/** 控えのキー（`{ at, data }`。data は CONDITION_KEYS の部分だけ） */
export const CONDITIONS_BASE_KEY = 'vrdemo:conditions:base';

/**
 * 控えに入れる条件（問題・重みに効くもの）。訪問・案・記録・確定した割当・欠勤（日々の操作）・手直しの記憶・乱数の種は入れない
 */
export const CONDITION_KEYS = [
  'org',
  'items',
  'rules',
  'presets',
  'scorePresetId',
  'staff',
  'clients',
  'compat',
  'availability',
  'visitTypes',
  'patterns',
  'clientLeaves',
] as const;
export type ConditionKey = (typeof CONDITION_KEYS)[number];
/** 条件の部分 */
export type Conditions = Pick<DemoData, ConditionKey>;
/** 控え：at は控えを取った時刻（ms）、data はそのときの条件 */
export type ConditionsBase = { at: number; data: Conditions };

const conditionsSchema = demoDataSchema.pick({
  org: true,
  items: true,
  rules: true,
  presets: true,
  scorePresetId: true,
  staff: true,
  clients: true,
  compat: true,
  availability: true,
  visitTypes: true,
  patterns: true,
  clientLeaves: true,
});

/** データの条件の部分 */
export function conditionsOf(d: Conditions): Conditions {
  return Object.fromEntries(CONDITION_KEYS.map((k) => [k, d[k]])) as Conditions;
}

/** 条件の部分が変わったか（参照が同じなら同じ。違えば中身で比べ、同じ中身の作り直しは変わったにしない） */
export function conditionsChanged(a: Conditions, b: Conditions): boolean {
  return CONDITION_KEYS.some((k) => a[k] !== b[k] && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

/**
 * update で prev → next に変わったときに書く控え（書かないなら null）：控えが無く、条件の部分が変わったときだけ、変わる前の条件
 */
export function captureBase(
  prev: Conditions,
  next: Conditions,
  base: ConditionsBase | null,
  at: number,
): ConditionsBase | null {
  if (base !== null || prev === next || !conditionsChanged(prev, next)) return null;
  return { at, data: conditionsOf(prev) };
}

/** 読んだ値を控えにする（形が違えば null） */
export function parseBase(text: string | null): ConditionsBase | null {
  if (text === null) return null;
  try {
    const raw = JSON.parse(text) as { at?: unknown; data?: unknown } | null;
    if (!raw || typeof raw.at !== 'number' || !Number.isFinite(raw.at)) return null;
    const r = conditionsSchema.safeParse(raw.data);
    return r.success ? { at: raw.at, data: r.data } : null;
  } catch {
    return null;
  }
}

type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** 覚える先を差し替えられる形（テスト用）。getStorage が null や例外なら、開いている間だけ覚える */
export function createConditionsMemory(getStorage: () => KeyStore | null) {
  let here: ConditionsBase | null = null;
  /** 最後に書いたときに保存できなかったか（できなければ開いている間に覚えたものを返す） */
  let unsaved = false;
  const store = (): KeyStore | null => {
    try {
      return getStorage();
    } catch {
      return null;
    }
  };
  return {
    /** 控え（無ければ null）。保存してあるものを先に読む（別のタブで取った控えも拾う）。保存が使えなければ開いている間に覚えたもの */
    read(): ConditionsBase | null {
      const s = store();
      if (!s) return here;
      try {
        const text = s.getItem(CONDITIONS_BASE_KEY);
        if (text === null) return unsaved ? here : null;
        return parseBase(text);
      } catch {
        return here;
      }
    },
    /** 控えを書く（書けなくても開いている間は覚える） */
    write(base: ConditionsBase): void {
      here = base;
      try {
        const s = store();
        s?.setItem(CONDITIONS_BASE_KEY, JSON.stringify(base));
        unsaved = !s;
      } catch {
        // 容量超過などでも、開いている間は覚える
        unsaved = true;
      }
    },
    /** 控えを消す */
    clear(): void {
      here = null;
      unsaved = false;
      try {
        store()?.removeItem(CONDITIONS_BASE_KEY);
      } catch {
        // 消せなくても続ける
      }
    },
  };
}

/** 画面全体で1つ（このブラウザの localStorage） */
export const conditionsMemory = createConditionsMemory(() => globalThis.localStorage ?? null);
