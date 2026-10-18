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
  patterns/    … 定期パターンから訪問を展開する純粋関数（ADR-0012。データは書き換えない）
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
- ドラッグの確認（本物のマウス操作。6種類）：`npm run build && npx vite preview --port 4183` のあとで `node scripts/e2e-drag.cjs`（Playwright・Chromium は手元のものを使う。場所は環境変数 `PLAYWRIGHT`・`CHROMIUM`、サイトは `BASE`、スクリーンショットの置き場所は `OUT_DIR`。ページの時計は `FAKE_NOW`（既定は次の水曜の日本時間 12:00）に止め、テストの「今日」もアプリと同じく日本時間で決める。日曜に実行しても今週に動かし先の日が残る）
- 住所の入力の確認（〈利用者さん〉・空き状況の場所・〈スタッフ〉の自宅。送るもの・郵便番号の正規化・候補と元に戻す・失敗と時間切れ・連打・閉じる・途中の書き換え・空き状況の計算と仮押さえ・自宅の郵便番号を保存しない）：同じく preview のあとで `node scripts/e2e-address.cjs`（環境変数は e2e-drag と同じ。外部の検索は page.route の偽の応答に差し替え、外へは出さない。時間切れを待つので1分ほどかかる）
- 相性の画面の確認（名前・吹き出しの開閉とフォーカス・中を巻く・絞り込みと URL の復元・`?id=`・回帰・300人×60人の速さ）：同じく preview のあとで `node scripts/e2e-compat.cjs`（環境変数は e2e-drag と同じ。`PERF_MS` でセルを押して描き終わるまでの上限（既定 100ms））
- 予定の名前から開く詳細の確認（月・週・日の名前とチップ・列の見出しの i：吹き出しの開閉とフォーカス・同時に1つ・同じ人が2か所に出るとき・見出しが消えたら閉じる・戻るで見出しの人が替わったら閉じる・開いている人がデータから消えたら閉じる・リンクで各画面の閲覧の欄・i を押してもチップや見出しの動きが起きない・帯とカードの選択とドラッグ・印刷で i を出さない・開くまでの速さ）：同じく preview のあとで `node scripts/e2e-details.cjs`（環境変数は e2e-drag と同じ。`FAKE_NOW` も）
- 閲覧の欄の確認（〈スタッフ〉・〈利用者さん〉：一覧の「開く」・`?id=`・相性の吹き出しのリンクで閲覧の欄が開き入力欄が無い・中身の項目・地図・節の見出しが h3・「編集する」で編集の欄（主ボタンにしない）・保存と取り消しで閲覧に戻りフォーカスは「編集する」・変更があるまま取り消す・×・Esc・別の人の `?id=` で確認が出て、断れば編集が続く・変更が無ければ・同じ人の `?id=`・特性を未確認に戻しただけ・担当できる人を限るを入れて外しただけなら確認しない・変更があるときだけ beforeunload・「追加」はすぐ編集（何も入れずに取り消すと確認なしで閉じる）・「まとめて地図に置く」の「編集」は編集の欄・定期パターンと休みは閲覧では読むだけ（これからの休みと終わった休みの件数）・最終勤務日の振り直しの欄は今どおり）：同じく preview のあとで `node scripts/e2e-view.cjs`（環境変数は e2e-drag と同じ。`FAKE_NOW` も。地図のタイルは取りに行かない）
- スマホのメニューの確認（390×844：上の帯の今の画面の名前（〈利用者さん〉と〈スタッフ〉の「一覧・編集」を見分ける）・横に巻かない・「メニュー」の引き出し（dialog・aria-modal・aria-expanded・aria-controls・見出し付きの縦並び・画面を選ぶ・外を押す・Esc で閉じてフォーカスが「メニュー」へ・Tab が中で回る・裏を巻かない）・下のタブ（月・週・日・空き状況・aria-current・比較では「日」・本文の最後が隠れない）・地図・欠勤の振り直しの帯・トーストがタブに重ならない・印刷で出さない・1400px は今のまま）：同じく preview のあとで `node scripts/e2e-mobile.cjs`（環境変数は e2e-drag と同じ。`FAKE_NOW` も）

## 規約
- 言語：TypeScript（strict）、React 19、Vite。コメント・ドキュメント・コミットメッセージは日本語
- ルーティングは HashRouter（Pages のサブパスで再読込しても 404 にしない）
- 再現性：solver・matching・evaluate・seed に `Math.random`・`Date.now` を入れない。乱数は seed 付き、止めるのは反復回数
- 費用は「分」に換算する（design.md §5 の表）。solver と evaluate は同じ `Problem` を使い、合計点を一致させる
- 外部送信は地図タイルの取得と、利用者がボタンを押したときの郵便番号・住所の検索（`src/lib/geocode.ts` の1か所。ADR-0016）だけ。解析・ログ送信を入れない
- リンク（Google マップの Maps URLs）・mailto は、押すのが人でアプリは送らないので外部送信に当たらない（ADR-0017・0018）
- 同梱するデータは架空のものだけ。公開リポジトリに実在の人・住所・パスワード・キーを置かない
- 画面：主ボタンは1画面1つ（多くて2つ）、オレンジ1色。呼び方は `org.terms` から引き、「お客様」「シッター」を直書きしない。表記は常用漢字

## 完了の定義
- [ ] テスト・リント・型チェック・ビルドがすべて通る
- [ ] 契約（`src/contracts/`）どおりの入出力・エラーになっている
- [ ] 変更点と、推測した箇所（あれば）を報告した
