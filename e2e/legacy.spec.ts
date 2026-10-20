// 段階2の包み（ADR-0029・ADR-0041）：scripts/e2e-*.cjs を同じプロセスで読み、出している段（steps）を test.step で回す。
// 確かめ（check）の1つずつを expect.soft に写す（名前はそのまま）。ページのエラー（pageerror）も expect.soft。
// Playwright は @playwright/test と同じもの（playwright-core）なので、スクリプトが開いた文脈にも trace が付く。動画は env.cjs の hooks で足す。
// steps を出していないスクリプト（段階1の形）は、今までどおり子のプロセスで走らせ、終了コードと `NG  ` の行で決める
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const require = createRequire(import.meta.url);
// require.cache の鍵は実際の場所（シンボリックリンクを解いた道）なので、消すときに合うよう実際の場所にそろえる
const SCRIPTS_DIR = realpathSync(path.resolve(import.meta.dirname, '../scripts'));
/** 速さの上限を見るスクリプト（perf の project で1本ずつ走らせる） */
const PERF = new Set(['compat', 'nav', 'progress', 'vacancy-steps', 'details']);
/** test の時間切れより先に子のプロセスを止める余裕（止めて記録を添付する時間） */
const MARGIN_MS = 30 * 1000;
/** SIGTERM のあと SIGKILL までの待ち */
const KILL_AFTER_MS = 5 * 1000;
/** 確かめの名前に添える情報の長さの上限（報告が読めなくならないように） */
const INFO_MAX = 400;

const files = readdirSync(SCRIPTS_DIR)
  .filter((f) => /^e2e-.+\.cjs$/.test(f))
  .sort();

type Step = [string, () => Promise<unknown> | unknown];
type Lib = {
  hooks: {
    onCheck: ((ok: boolean, name: string, info: string) => void) | null;
    onNote: ((text: string) => void) | null;
    videoDir: string;
  };
  pageErrors: string[];
  closeBrowsers: () => Promise<void>;
};
type Result = { code: number | null; signal: NodeJS.Signals | null; timedOut: boolean };

/** 段（steps）を出しているか（出していなければ読むだけで走り出すので、子のプロセスで走らせる） */
const hasSteps = (file: string) =>
  /^module\.exports = \{ steps\b/m.test(readFileSync(path.join(SCRIPTS_DIR, file), 'utf8'));

/** scripts/ の読み込みを消す（スクリプトと共通の部品は test ごとに読み直し、数え・状態を持ち越さない） */
function forgetScripts() {
  for (const k of Object.keys(require.cache)) if (k.startsWith(SCRIPTS_DIR + path.sep)) delete require.cache[k];
}

/** 今の test の後始末（時間切れでも afterEach で必ず閉じる） */
let current: { lib: Lib | null; log: string[]; restore: () => void; name: string; videoDir: string } | null = null;

/** console.log・console.error を記録に移す（並列の list の報告に何千行も流さない） */
function captureConsole(log: string[]) {
  const orig = { log: console.log, error: console.error };
  const put = (...a: unknown[]) => {
    log.push(
      a.map((x) => (typeof x === 'string' ? x : x instanceof Error ? (x.stack ?? String(x)) : String(x))).join(' '),
    );
  };
  console.log = put;
  console.error = put;
  return () => {
    console.log = orig.log;
    console.error = orig.error;
  };
}

/** 動画を残すか（config の use.video） */
function videoMode(): string {
  const v = test.info().project.use.video as unknown;
  if (!v) return 'off';
  return typeof v === 'string' ? v : ((v as { mode?: string }).mode ?? 'off');
}

async function runInProcess(file: string, name: string, base: string) {
  const testInfo = test.info();
  forgetScripts();
  process.env.BASE = base;
  process.env.OUT_DIR = testInfo.outputPath('shots');
  process.env.E2E_SCRIPT = `e2e-${name}`;
  const log: string[] = [];
  const videoDir = videoMode() === 'off' ? '' : testInfo.outputPath('videos');
  current = { lib: null, log, restore: captureConsole(log), name, videoDir };
  const { steps } = require(path.join(SCRIPTS_DIR, file)) as { steps: Step[] };
  const lib = require(path.join(SCRIPTS_DIR, 'lib/env.cjs')) as Lib;
  current.lib = lib;
  lib.hooks.onNote = (text) => testInfo.annotations.push({ type: '注記', description: text });
  lib.hooks.videoDir = videoDir;
  lib.hooks.onCheck = (ok, checkName, info) => {
    const more = info.length > INFO_MAX ? `${info.slice(0, INFO_MAX)}…` : info;
    expect.soft(ok, more ? `${checkName}  ${more}` : checkName).toBe(true);
  };
  for (const [stepName, fn] of steps) {
    await test.step(stepName, async () => {
      await fn();
    });
  }
  expect.soft(lib.pageErrors, 'ページのエラー（pageerror）が無い').toEqual([]);
}

/** 後始末：ブラウザを閉じ、記録・失敗のスクリーンショット・動画を添付する */
test.afterEach(async () => {
  const c = current;
  current = null;
  if (!c) return;
  const testInfo = test.info();
  try {
    await c.lib?.closeBrowsers();
  } finally {
    c.restore();
    if (c.lib) {
      c.lib.hooks.onCheck = null;
      c.lib.hooks.onNote = null;
    }
  }
  const logPath = testInfo.outputPath(`${c.name}.log`);
  mkdirSync(path.dirname(logPath), { recursive: true });
  writeFileSync(logPath, `${c.log.join('\n')}\n`);
  await testInfo.attach(`${c.name}.log`, { path: logPath, contentType: 'text/plain' });
  const failed = testInfo.status !== testInfo.expectedStatus;
  const shots = testInfo.outputPath('shots');
  if (failed && existsSync(shots)) {
    for (const f of readdirSync(shots).filter((f) => f.includes('-fail-')))
      await testInfo.attach(f, { path: path.join(shots, f), contentType: 'image/png' });
  }
  if (c.videoDir && existsSync(c.videoDir)) {
    const keep = failed || videoMode() === 'on';
    if (keep) {
      for (const f of readdirSync(c.videoDir))
        await testInfo.attach(`video-${f}`, { path: path.join(c.videoDir, f), contentType: 'video/webm' });
    } else rmSync(c.videoDir, { recursive: true, force: true });
  }
});

/**
 * 子のプロセスを走らせ、出力を onOutput に渡す（段階1の形のスクリプト）。limitMs を過ぎたら子とその Chromium（同じプロセスグループ）を
 * SIGTERM → SIGKILL で止める（0 なら止めない）
 */
function runScript(file: string, env: NodeJS.ProcessEnv, limitMs: number, onOutput: (s: string) => void) {
  return new Promise<Result>((resolve, reject) => {
    // detached でプロセスグループを分け、止めるときは Chromium ごと止める
    const child = spawn(process.execPath, [path.join(SCRIPTS_DIR, file)], {
      env,
      cwd: path.dirname(SCRIPTS_DIR),
      detached: process.platform !== 'win32',
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', onOutput);
    child.stderr.on('data', onOutput);
    let timedOut = false;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // もう終わっている
      }
    };
    const timers: NodeJS.Timeout[] = [];
    if (limitMs > 0) {
      timers.push(
        setTimeout(() => {
          timedOut = true;
          onOutput(`\n（${Math.round(limitMs / 1000)}秒で終わらないので止めた）\n`);
          kill('SIGTERM');
          timers.push(setTimeout(() => kill('SIGKILL'), KILL_AFTER_MS));
        }, limitMs),
      );
    }
    child.on('error', (e) => {
      for (const t of timers) clearTimeout(t);
      reject(e);
    });
    child.on('close', (code, signal) => {
      for (const t of timers) clearTimeout(t);
      resolve({ code, signal, timedOut });
    });
  });
}

async function runChild(file: string, name: string, base: string) {
  const testInfo = test.info();
  const limitMs = testInfo.timeout > 0 ? Math.max(testInfo.timeout - MARGIN_MS, MARGIN_MS) : 0;
  let log = '';
  let result: Result;
  try {
    result = await runScript(
      file,
      { ...process.env, BASE: base, OUT_DIR: testInfo.outputPath('shots'), E2E_SCRIPT: '' },
      limitMs,
      (s) => {
        log += s;
      },
    );
  } finally {
    // 記録はファイルにも残して添付する（止めたとき・失敗したときも）
    const logPath = testInfo.outputPath(`${name}.log`);
    mkdirSync(path.dirname(logPath), { recursive: true });
    writeFileSync(logPath, log);
    await testInfo.attach(`${name}.log`, { path: logPath, contentType: 'text/plain' });
  }
  const ng = log.split('\n').filter((l) => l.startsWith('NG  '));
  expect(result.timedOut, `時間切れで止めた（記録の末尾）\n${log.split('\n').slice(-20).join('\n')}`).toBe(false);
  expect(ng, '通らなかった確かめ（NG の行）').toEqual([]);
  expect(result.code, `終了コード（記録の末尾）\n${log.split('\n').slice(-20).join('\n')}`).toBe(0);
}

for (const file of files) {
  const name = file.replace(/^e2e-/, '').replace(/\.cjs$/, '');
  test(`${file}${PERF.has(name) ? ' @perf' : ''}`, async () => {
    const base = test.info().project.use.baseURL;
    if (!base) throw new Error('baseURL がありません（playwright.config.ts の use.baseURL）');
    if (hasSteps(file)) await runInProcess(file, name, base);
    else await runChild(file, name, base);
  });
}
