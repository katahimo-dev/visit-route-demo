// 競合の印（行頭の `<<<<<<< ` と `>>>>>>> `）がコミットされていないかを確かめる（PRD D253。npm run lint・CI の PR で走る）。
// git が管理しているファイルだけを見る（node_modules・dist は入らない）。`=======` は Markdown の見出しの下線にも使うので見ない。
// 見つかったら場所を出して終了コード 1
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

// 印は7文字＋空白か行末（`<<<<<<<<` のような長い並びは別物）。この行に印そのものを書かないよう、文字を組み立てる
const MARK = new RegExp(`^(${'<'.repeat(7)}|${'>'.repeat(7)})( |$)`);

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\0')
  .filter(Boolean);

const found = [];
for (const f of files) {
  let buf;
  try {
    buf = fs.readFileSync(f);
  } catch {
    continue; // 消したがまだコミットしていないファイル
  }
  // 中に 0 のバイトがあれば中身が文字でない（xlsx・画像など）ので見ない
  if (buf.includes(0)) continue;
  // CRLF のファイルも行頭で見られるよう、改行の前の \r も区切りに含める
  const lines = buf.toString('utf8').split(/\r?\n/);
  lines.forEach((l, i) => {
    if (MARK.test(l)) found.push(`${f}:${i + 1}: ${l.slice(0, 60)}`);
  });
}

if (found.length > 0) {
  console.error(`競合の印が残っています（${found.length} 行）。解いてからコミットしてください：`);
  for (const x of found) console.error(`  ${x}`);
  process.exit(1);
}
console.log(`競合の印なし（${files.length} ファイル）`);
