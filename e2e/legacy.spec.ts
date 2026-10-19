// 段階1の包み（ADR-0029）：scripts/e2e-*.cjs を1本ずつ子のプロセスで走らせ、終了コードと `NG  ` の行で合否を決める。
// スクリプトは単独（node scripts/e2e-xxx.cjs）でも今どおり動く。環境変数（CHROMIUM・FAKE_NOW・PERF_MS_* など）はそのまま渡す
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const SCRIPTS_DIR = path.resolve(import.meta.dirname, '../scripts');
/** 速さの上限を見るスクリプト（perf の project で1本ずつ走らせる） */
const PERF = new Set(['compat', 'nav', 'progress', 'vacancy-steps', 'details']);
/** test の時間切れより先に子のプロセスを止める余裕（止めて記録を添付する時間） */
const MARGIN_MS = 30 * 1000;
/** SIGTERM のあと SIGKILL までの待ち */
const KILL_AFTER_MS = 5 * 1000;

const files = readdirSync(SCRIPTS_DIR)
  .filter((f) => /^e2e-.+\.cjs$/.test(f))
  .sort();

type Result = { code: number | null; signal: NodeJS.Signals | null; timedOut: boolean };

/**
 * 子のプロセスを走らせ、出力を onOutput に渡す。limitMs を過ぎたら子とその Chromium（同じプロセスグループ）を
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

for (const file of files) {
  const name = file.replace(/^e2e-/, '').replace(/\.cjs$/, '');
  test(`${file}${PERF.has(name) ? ' @perf' : ''}`, async () => {
    const testInfo = test.info();
    const base = testInfo.project.use.baseURL;
    if (!base) throw new Error('baseURL がありません（playwright.config.ts の use.baseURL）');
    const limitMs = testInfo.timeout > 0 ? Math.max(testInfo.timeout - MARGIN_MS, MARGIN_MS) : 0;
    let log = '';
    let result: Result;
    try {
      result = await runScript(
        file,
        { ...process.env, BASE: base, OUT_DIR: testInfo.outputPath('shots') },
        limitMs,
        (s) => {
          log += s;
        },
      );
    } finally {
      // 記録はファイルにも残して添付する（止めたとき・失敗したときも。test-results/ を CI の成果物にしたとき読めるように）
      const logPath = testInfo.outputPath(`${name}.log`);
      mkdirSync(path.dirname(logPath), { recursive: true });
      writeFileSync(logPath, log);
      await testInfo.attach(`${name}.log`, { path: logPath, contentType: 'text/plain' });
    }
    const ng = log.split('\n').filter((l) => l.startsWith('NG  '));
    expect(result.timedOut, `時間切れで止めた（記録の末尾）\n${log.split('\n').slice(-20).join('\n')}`).toBe(false);
    expect(ng, '通らなかった確かめ（NG の行）').toEqual([]);
    expect(result.code, `終了コード（記録の末尾）\n${log.split('\n').slice(-20).join('\n')}`).toBe(0);
  });
}
