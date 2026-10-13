# AGENTS.md

このリポジトリで作業するAIコーディングエージェント向けのルール。
要件の正は `docs/prd.md`、設計の正は `docs/design.md`、境界の契約の正は `src/contracts/`（TypeScript の型と Worker のメッセージ）、判断の記録は `docs/adr/`。これらと矛盾する実装をしない。

このリポジトリは `katahimo-dev/visit-route-poc`（PoC本体）の**デモ版**。PoC本体の Firebase・Callable・`orgs/{orgId}` の規約は適用しない（ADR-0001）。

## 作業の原則
- 担当範囲（作業指示書に書かれたコンポーネント）以外のファイルを変更しない
- 契約（`src/contracts/`）にない入出力・エラー・既定値を勝手に足さない。必要なら作業を止めて質問する
- データ（`DemoData`）を書き換えるのは store だけ。画面は `update(fn)` を通す
- PRD §4・design.md §2 の「やらないこと」を実装しない（ログイン・サーバー保存・記録・勤怠・相性の学習など）
- 仕様が不明なときは推測で埋めず、`QUESTIONS:` として最後にまとめて報告する

## ディレクトリ構成
```
src/
  contracts/   … 型と Worker メッセージ（境界の契約）
  store/       … localStorage・JSON入出力・版の移行（データの持ち主）
  seed/        … デモの初期データ（PoC本体 scripts/seedDemo.ts から写す）
  domain/      … PoC本体 packages/shared 等から写した純粋関数（先頭に写した元のコミットを書く）
  matching/    … 項目・条件 → Problem（可否・費用表）と理由
  solver/      … 焼きなまし（solve 純粋関数 ＋ worker.ts）
  evaluate/    … 採点・説明・差分
  excel/       … DemoData と Excel のブックの変換（ADR-0006。データは書き換えない）
  pages/ components/ … 画面
.github/workflows/deploy.yml … test → build → GitHub Pages
docs/ … prd.md / design.md / adr/ / handoff/
```

## コマンド
- インストール：`npm ci`
- 開発サーバー：`npm run dev`
- テスト：`npm test`（vitest）
- フォーマット・リント：`npm run lint`（biome）
- 型チェック：`npm run typecheck`
- ビルド：`npm run build`（`dist/`、`base: './'`）

## 規約
- 言語：TypeScript（strict）、React 19、Vite。コメント・ドキュメント・コミットメッセージは日本語
- ルーティングは HashRouter（Pages のサブパスで再読込しても 404 にしない）
- 再現性：solver・matching・evaluate・seed に `Math.random`・`Date.now` を入れない。乱数は seed 付き、止めるのは反復回数
- 費用は「分」に換算する（design.md §5 の表）。solver と evaluate は同じ `Problem` を使い、合計点を一致させる
- 外部送信は地図タイルの取得だけ。解析・ログ送信を入れない
- 同梱するデータは架空のものだけ。公開リポジトリに実在の人・住所・パスワード・キーを置かない
- 画面：主ボタンは1画面1つ（多くて2つ）、オレンジ1色。呼び方は `org.terms` から引き、「お客様」「シッター」を直書きしない。表記は常用漢字

## 完了の定義
- [ ] テスト・リント・型チェック・ビルドがすべて通る
- [ ] 契約（`src/contracts/`）どおりの入出力・エラーになっている
- [ ] 変更点と、推測した箇所（あれば）を報告した
