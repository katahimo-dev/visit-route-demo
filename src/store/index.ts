// 入口（実装は store 担当）。画面はここだけを import する
import { z } from 'zod';
import { DATA_VERSION, type DemoData, demoDataSchema, type ImportError, STORAGE_KEY } from '../contracts/data';
import { addDays, jstDate } from '../domain/time';
import { applyPatterns } from '../patterns';
import { createDemoData, DEMO_DAYS, daysFrom, initialPresets } from '../seed';
import { repair } from './repair';

/** 壊れた JSON の退避先 */
export const BROKEN_KEY = 'vrdemo:data:broken';
/** 1世代の控え（置き換える前のデータの JSON。PRD D227。ADR-0032） */
export const PREV_KEY = 'vrdemo:data:prev';
/** 1世代の控えの時刻と操作の名前（`{ at, reason }`） */
export const PREV_INFO_KEY = 'vrdemo:data:prev:info';
/** 保存の間引き間隔（ms） */
export const SAVE_INTERVAL_MS = 300;
export const QUOTA_MESSAGE =
  'ブラウザの保存容量を超えました。データを書き出してから、データの画面の「古い案と記録を片づける」で古い月の AI案と記録を消してください';

const today = () => jstDate(Date.now());

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * 今日以降の訪問が1件もなければ、今日から14日分を足す（既存の日は変えない）。
 * パターンがあれば patterns の applyPatterns で今日〜今日+13 を展開し、無い古いデータは今までどおり seed の daysFrom（ADR-0012）
 */
export function extendDays(data: DemoData, todayDate: string): DemoData {
  if (data.visits.some((v) => v.date >= todayDate)) return data;
  if (data.patterns.length > 0) {
    const c = applyPatterns(data, { from: todayDate, to: addDays(todayDate, DEMO_DAYS - 1) }, todayDate);
    return c.added.length > 0 ? { ...data, visits: c.visits } : data;
  }
  return daysFrom(data, todayDate, DEMO_DAYS);
}

/** zod の最初の問題を日本語の1文にする。例「staff の 3件目の name：…」 */
function describeIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path;
  const head = path.length > 0 ? String(path[0]) : 'データ';
  let where = head;
  let i = 1;
  let counted = false;
  if (typeof path[1] === 'number') {
    where += ` の ${path[1] + 1}件目`;
    counted = true;
    i = 2;
  }
  const rest = path.slice(i).map(String).join('.');
  if (rest) where += counted ? `の ${rest}` : ` の ${rest}`;
  return `${where}：${issue.message}`;
}

const fail = (message: string): ImportError => ({ code: 'INVALID_ARGUMENT', message });

/**
 * 読み込んだ値を、今の版（DATA_VERSION）のデータにする。通らなければ ImportError。
 * 形が通ったら、中身の食い違い（いないスタッフ・訪問を指す案など）を repair で直す（画面を落とさない）
 */
export function migrate(raw: unknown): DemoData | ImportError {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('データの形が正しくありません（書き出したファイルではない可能性があります）');
  }
  const version = (raw as { version?: unknown }).version;
  if (version !== DATA_VERSION) {
    // 今は版1だけ。将来ここで古い版を順に移行する
    return fail(`データの版（${String(version ?? '不明')}）に対応していません。このデモの版は ${DATA_VERSION} です`);
  }
  // プリセット（ADR-0008）が無い（null も）古いデータは、初期の3種で補う（版は1のまま）
  // 欠勤（ADR-0011）が無い（null も）古いデータは [] で補う
  // 訪問の種類・定期パターン（ADR-0012）が null の古いデータも [] で補う（無いときは zod の既定値）
  // 〈利用者さん〉の休み（ADR-0013）が null の古いデータも [] で補う（無いときは zod の既定値）
  const o = raw as Record<string, unknown>;
  const filled = {
    ...o,
    ...(o.presets === undefined || o.presets === null ? { presets: initialPresets() } : {}),
    ...(o.absences === undefined || o.absences === null ? { absences: [] } : {}),
    ...(o.visitTypes === undefined || o.visitTypes === null ? { visitTypes: [] } : {}),
    ...(o.patterns === undefined || o.patterns === null ? { patterns: [] } : {}),
    ...(o.clientLeaves === null ? { clientLeaves: [] } : {}),
  };
  const r = demoDataSchema.safeParse(filled, { error: z.locales.ja().localeError });
  if (!r.success) {
    const first = r.error.issues[0];
    return fail(first ? describeIssue(first) : 'データの形が正しくありません');
  }
  return repair(r.data);
}

export function importJson(text: string): DemoData | ImportError {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('JSON として読めませんでした（ファイルが壊れているか、書き出したファイルではありません）');
  }
  return migrate(raw);
}

/** 書き出す JSON の文字（控えのファイルの中身） */
function jsonText(data: DemoData): string {
  return JSON.stringify(data, null, 2);
}

export function exportJson(data: DemoData): Blob {
  return new Blob([jsonText(data)], { type: 'application/json' });
}

export const isImportError = (x: DemoData | ImportError): x is ImportError => 'code' in x && 'message' in x;

/** 画面が使っている最新のデータ（読み込み・保存・初期化・別のタブからの読み直しで覚える。例外の画面の控えに使う） */
let current: DemoData | null = null;
/** 最後に書いたときの失敗の文言（成功したら null） */
let lastSaveError: string | null = null;

/** 画面が使っている最新のデータを覚える（Provider がデータの変わるたびに呼ぶ。null で忘れる） */
export function rememberCurrent(data: DemoData | null): void {
  current = data;
}

/** 覚えている最新のデータ（まだ無ければ null） */
export function currentData(): DemoData | null {
  return current;
}

/** 容量超過の例外か */
function isQuota(e: unknown): boolean {
  if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22)) return true;
  return (e as { name?: string } | null)?.name === 'QuotaExceededError';
}

/** 1世代の控えを消す（容量を空ける） */
function dropPrevious(ls: Storage): void {
  try {
    ls.removeItem(PREV_KEY);
    ls.removeItem(PREV_INFO_KEY);
  } catch {
    // 消せなくても続ける
  }
}

/** 即時に書く。失敗したら利用者向けの文言を返す（成功は null）。結果は lastSaveError にも残す */
function writeNow(data: DemoData): string | null {
  lastSaveError = tryWrite(data);
  return lastSaveError;
}

/**
 * 書いてみる。失敗したら利用者向けの文言（成功は null）。
 * 容量超過なら1世代の控えを捨ててもう1回だけ書く（いまのデータを残すほうが先。ADR-0032）
 */
function tryWrite(data: DemoData): string | null {
  const ls = storage();
  if (!ls) return '保存できませんでした（このブラウザでは保存が使えません）。データを書き出してください';
  const text = JSON.stringify(data);
  try {
    ls.setItem(STORAGE_KEY, text);
    return null;
  } catch (e) {
    if (!isQuota(e)) return '保存できませんでした。データを書き出してください';
    if (ls.getItem(PREV_KEY) === null) return QUOTA_MESSAGE;
    dropPrevious(ls);
    try {
      ls.setItem(STORAGE_KEY, text);
      return null;
    } catch (e2) {
      return isQuota(e2) ? QUOTA_MESSAGE : '保存できませんでした。データを書き出してください';
    }
  }
}

/**
 * 読み込む。broken：保存していたデータが読めず、元の文字を BROKEN_KEY に退避して初期データで開いた（PRD D227。画面が知らせる）
 */
export function loadWithStatus(): { data: DemoData; broken: boolean } {
  const ls = storage();
  const todayDate = today();
  const text = ls?.getItem(STORAGE_KEY) ?? null;
  if (text === null) {
    const d = createDemoData(todayDate);
    writeNow(d);
    current = d;
    return { data: d, broken: false };
  }
  const r = importJson(text);
  if (isImportError(r)) {
    try {
      ls?.setItem(BROKEN_KEY, text);
    } catch {
      // 退避できなくても続ける
    }
    current = createDemoData(todayDate);
    return { data: current, broken: true };
  }
  const extended = extendDays(r, todayDate);
  if (extended !== r) writeNow(extended);
  current = extended;
  return { data: extended, broken: false };
}

export function load(): DemoData {
  return loadWithStatus().data;
}

/** 読めなかったデータ（BROKEN_KEY に退避した元の文字）。無ければ null */
export function brokenText(): string | null {
  try {
    return storage()?.getItem(BROKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: { data: DemoData; onError?: (message: string | null) => void } | null = null;

/** 待っている保存をすぐ書く（ページを閉じる前・テスト用） */
export function flushSave(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  const p = pending;
  pending = null;
  if (!p) return;
  // onError が無くても書く（p.onError?.(writeNow(...)) だと onError の無いときに書かない）
  const message = writeNow(p.data);
  p.onError?.(message);
}

/**
 * 300ms 間引きで保存（その間の呼び出しは最後の値だけ書く）。
 * 結果は onError に渡す（成功は null、容量超過などは利用者向けの文言）
 */
export function save(data: DemoData, onError?: (message: string | null) => void): void {
  current = data;
  pending = { data, onError };
  if (timer) return;
  timer = setTimeout(flushSave, SAVE_INTERVAL_MS);
}

/** 控え（バックアップ）のファイル。current＝いまのデータ、broken＝壊れて読めず退避したデータ（BROKEN_KEY の文字のまま） */
export type BackupFile = { kind: 'current' | 'broken'; text: string };
export type Backup = {
  files: BackupFile[];
  /** いまのデータをどこから取ったか：memory＝画面が使っている最新のデータ、storage＝ブラウザに保存してある文字。無ければ null */
  source: 'memory' | 'storage' | null;
  /** 保存に失敗していたときの文言（容量超過・保存が使えない）。失敗していなければ null */
  saveError: string | null;
};

/**
 * 例外の画面の控え（バックアップ）。待っている保存を先に書き（失敗は saveError に）、
 * いまのデータは画面が使っている最新のデータ（データの画面の書き出しと同じ形）を、無ければ保存してある文字をそのまま使う。
 * 壊れて退避したデータ（BROKEN_KEY）があれば、それも別のファイルとして返す
 */
export function backup(): Backup {
  flushSave();
  const ls = storage();
  const read = (key: string): string | null => {
    try {
      return ls?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const files: BackupFile[] = [];
  let source: Backup['source'] = null;
  if (current) {
    files.push({ kind: 'current', text: jsonText(current) });
    source = 'memory';
  } else {
    const text = read(STORAGE_KEY);
    if (text !== null) {
      files.push({ kind: 'current', text });
      source = 'storage';
    }
  }
  const broken = read(BROKEN_KEY);
  if (broken !== null) files.push({ kind: 'broken', text: broken });
  return { files, source, saveError: lastSaveError };
}

// ---- 1世代の控え（PRD D227。ADR-0032）----

/** 控えの時刻（ms）と、控えを残した操作の名前（「初期状態に戻す」など） */
export type PreviousInfo = { at: number; reason: string };

/**
 * 控えを残した結果。kept：残せた、why：残せなかった理由（確認の本文に出す）。
 * cancel：操作を取り消したときに呼び、残す前の控え（前の世代）に戻す
 */
export type PreviousKeep = { kept: boolean; why: string | null; cancel(): void };

const KEEP_FULL = '控えを残せません：容量不足';
const KEEP_NO_STORAGE = '控えを残せません：このブラウザでは保存が使えません';

/**
 * 置き換える前のデータを1世代だけ控える（PREV_KEY・PREV_INFO_KEY。次に控えると上書き）。
 * 書けなければ（容量超過）前の世代も消して1回だけ試し直し、それでも書けなければ控えなしで kept=false（操作は止めない）
 */
export function keepPrevious(data: DemoData, reason: string, at: number = Date.now()): PreviousKeep {
  const ls = storage();
  if (!ls) return { kept: false, why: KEEP_NO_STORAGE, cancel: () => {} };
  let oldText: string | null = null;
  let oldInfo: string | null = null;
  try {
    oldText = ls.getItem(PREV_KEY);
    oldInfo = ls.getItem(PREV_INFO_KEY);
  } catch {
    return { kept: false, why: KEEP_NO_STORAGE, cancel: () => {} };
  }
  const text = JSON.stringify(data);
  const info = JSON.stringify({ at, reason } satisfies PreviousInfo);
  const write = () => {
    ls.setItem(PREV_KEY, text);
    ls.setItem(PREV_INFO_KEY, info);
  };
  /** 前の世代に戻す（取り消し） */
  const restoreOld = () => {
    dropPrevious(ls);
    if (oldText === null || oldInfo === null) return;
    try {
      ls.setItem(PREV_KEY, oldText);
      ls.setItem(PREV_INFO_KEY, oldInfo);
    } catch {
      dropPrevious(ls);
    }
  };
  let kept = false;
  let why: string | null = null;
  try {
    write();
    kept = true;
  } catch (e) {
    // 前の世代が場所を取っているので、消してもう1回だけ
    dropPrevious(ls);
    try {
      write();
      kept = true;
    } catch (e2) {
      dropPrevious(ls);
      why = isQuota(e) || isQuota(e2) ? KEEP_FULL : '控えを残せません：保存できませんでした';
    }
  }
  return { kept, why, cancel: restoreOld };
}

/** 控えの時刻と操作の名前。控えが無い・読めなければ null */
export function previousInfo(): PreviousInfo | null {
  const ls = storage();
  if (!ls) return null;
  try {
    if (ls.getItem(PREV_KEY) === null) return null;
    const raw = JSON.parse(ls.getItem(PREV_INFO_KEY) ?? 'null') as Partial<PreviousInfo> | null;
    if (!raw || typeof raw.at !== 'number' || !Number.isFinite(raw.at) || typeof raw.reason !== 'string') return null;
    return { at: raw.at, reason: raw.reason };
  } catch {
    return null;
  }
}

/** 控えのデータ（移行・repair 済み）。無ければ null、読めなければ ImportError */
export function readPrevious(): DemoData | ImportError | null {
  let text: string | null = null;
  try {
    text = storage()?.getItem(PREV_KEY) ?? null;
  } catch {
    return null;
  }
  return text === null ? null : importJson(text);
}

export function reset(): DemoData {
  if (timer) clearTimeout(timer);
  timer = null;
  pending = null;
  const d = createDemoData(today());
  writeNow(d);
  current = d;
  return d;
}

export { BACKUP_LAST_KEY, BACKUP_REMINDED_KEY, backupMemory, type ExportKind, type LastExport } from './backup';
export { DemoDataProvider, useDemoData } from './react';
export { repair } from './repair';
export { TOUR_SEEN_KEY, tourMemory } from './tour';
