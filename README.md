# 訪問ルートAI デモ版

訪問型サービスの「だれを・どの順で」行かせるかを、ブラウザだけで試せるデモ。
相性・スタッフの特性・顧客の希望を、項目と重み（0〜5）・必須で組み立て、条件を変えたAI案（割当と順番）どうしを比べられる。

- データは**このブラウザの中だけ**に保存（localStorage）。サーバーへは送らない。実在の個人情報は入れない
- 同梱のデータは架空（仙台市の公共施設を擬人化したスタッフ・訪問先）
- 本体：`katahimo-dev/visit-route-poc`（Firebase 版 PoC）

設計：[docs/prd.md](docs/prd.md)／[docs/design.md](docs/design.md)／[docs/adr/](docs/adr/)。AI エージェント向けのルールは [AGENTS.md](AGENTS.md)。

公開先：https://katahimo-dev.github.io/visit-route-demo/ （main に push すると GitHub Actions がテスト→ビルド→公開）

## 使い方（デモ）

1. 「AI案」を開くと、その日のAI案をプリセット1（標準）の条件で自動で作る。訪問を押すと理由（点の内訳）、ドラッグで手直し
2. 右の「プリセット」（標準・移動を短く・人の組み合わせ重視）を押すか、重みを変えて「AI案を作り直す」。作るたびに条件と結果が記録に残る
3. 「比較」で記録から任意の2つを A・B に選び、条件の差・点数・担当ごとの順番・地図を比べる
4. 「条件」「項目」「相性」「スタッフ」「利用者さん」で特性・必要条件・希望・相性を入れる。「予定」は訪問の編集と手作業の割当（初期データは未割当）
5. 「データ」で書き出し・読み込み・初期状態に戻す

## ローカルで動かす

```bash
npm ci
npm run dev        # http://localhost:5173
npm test && npm run lint && npm run typecheck && npm run build
```
