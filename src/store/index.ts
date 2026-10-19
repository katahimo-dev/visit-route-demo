// 入口（実装は store 担当）。画面はここだけを import する
import { z } from 'zod';
import { DATA_VERSION, type DemoData, demoDataSchema, type ImportError, STORAGE_KEY } from '../contracts/data';
import { addDays, jstDate } from '../domain/time';
import { applyPatterns } from '../patterns';
import { createDemoData, DEMO_DAYS, daysFrom, initialPresets } from '../seed';
import { repair } from './repair';

/** 壊れた JSON の退避先 */
export const BROKEN_KEY = 'vrdemo:data:broken';
/** 保存の間引き間隔（ms） */
export const SAVE_INTERVAL_MS = 300;
export const QUOTA_MESSAGE = 'ブラウザの保存容量を超えました。データを書き出してから、古い日の予定を消してください';

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

/** 即時に書く。失敗したら利用者向けの文言を返す（成功は null）。結果は lastSaveError にも残す */
function writeNow(data: DemoData): string | null {
  lastSaveError = tryWrite(data);
  return lastSaveError;
}

function tryWrite(data: DemoData): string | null {
  const ls = storage();
  if (!ls) return '保存できませんでした（このブラウザでは保存が使えません）。データを書き出してください';
  try {
    ls.setItem(STORAGE_KEY, JSON.stringify(data));
    return null;
  } catch (e) {
    const quota = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22);
    return quota || (e as { name?: string })?.name === 'QuotaExceededError'
      ? QUOTA_MESSAGE
      : '保存できませんでした。データを書き出してください';
  }
}

export function load(): DemoData {
  const ls = storage();
  const todayDate = today();
  const text = ls?.getItem(STORAGE_KEY) ?? null;
  if (text === null) {
    const d = createDemoData(todayDate);
    writeNow(d);
    current = d;
    return d;
  }
  const r = importJson(text);
  if (isImportError(r)) {
    try {
      ls?.setItem(BROKEN_KEY, text);
    } catch {
      // 退避できなくても続ける
    }
    current = createDemoData(todayDate);
    return current;
  }
  const extended = extendDays(r, todayDate);
  if (extended !== r) writeNow(extended);
  current = extended;
  return extended;
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

export function reset(): DemoData {
  if (timer) clearTimeout(timer);
  timer = null;
  pending = null;
  const d = createDemoData(today());
  writeNow(d);
  current = d;
  return d;
}

export { DemoDataProvider, useDemoData } from './react';
export { repair } from './repair';
export { TOUR_SEEN_KEY, tourMemory } from './tour';
