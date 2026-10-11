/** 業種。呼び方の初期値に使う */
export const INDUSTRIES = ['sitter', 'care', 'nursing', 'other'] as const;
export type Industry = (typeof INDUSTRIES)[number];

/** 移動手段（PoC本体と同じ名前） */
export const TRAVEL_MODES = ['DRIVE', 'BICYCLE', 'WALK', 'TRANSIT'] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];

/** 時間の約束。fixed は開始時刻が決まっている、window は幅の中で開始（必須。2026-10-11） */
export const WINDOW_KINDS = ['fixed', 'window'] as const;
