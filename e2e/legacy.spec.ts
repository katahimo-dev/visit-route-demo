// 段階1の包み（ADR-0029）：scripts/e2e-*.cjs を1本ずつ子のプロセスで走らせ、終了コードと `NG  ` の行で合否を決める。
// スクリプトは単独（node scripts/e2e-xxx.cjs）でも今どおり動く。環境変数（CHROMIUM・FAKE_NOW・PERF_MS_* など）はそのまま渡す
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const SCRIPTS_DIR = path.join(process.cwd(), 'scripts');
/** 速さの上限を見るスクリプト（perf の project で1本ずつ走らせる） */
const PERF = new Set(['compat', 'nav', 'progress', 'vacancy-steps', 'details']);

const files = readdirSync(SCRIPTS_DIR)
  .filter((f) => /^e2e-.+\.cjs$/.test(f))
  .sort();

/** 子のプロセスを走らせ、標準出力と標準エラーを合わせた記録と終了コードを返す */
function runScript(file: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; log: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(SCRIPTS_DIR, file)], { env, cwd: process.cwd() });
    let log = '';
    child.stdout.on('data', (d) => {
      log += d;
    });
    child.stderr.on('data', (d) => {
      log += d;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, log }));
  });
}

for (const file of files) {
  const name = file.replace(/^e2e-/, '').replace(/\.cjs$/, '');
  test(`${file}${PERF.has(name) ? ' @perf' : ''}`, async () => {
    const testInfo = test.info();
    const base = testInfo.project.use.baseURL;
    if (!base) throw new Error('baseURL がありません（playwright.config.ts の use.baseURL）');
    const { code, log } = await runScript(file, {
      ...process.env,
      BASE: base,
      OUT_DIR: testInfo.outputPath('shots'),
    });
    // 記録はファイルにも残す（test-results/ を CI の成果物にしたとき読めるように）
    const logPath = testInfo.outputPath(`${name}.log`);
    mkdirSync(path.dirname(logPath), { recursive: true });
    writeFileSync(logPath, log);
    await testInfo.attach(`${name}.log`, { path: logPath, contentType: 'text/plain' });
    const ng = log.split('\n').filter((l) => l.startsWith('NG  '));
    expect(ng, '通らなかった確かめ（NG の行）').toEqual([]);
    expect(code, `終了コード（記録の末尾）\n${log.split('\n').slice(-20).join('\n')}`).toBe(0);
  });
}
