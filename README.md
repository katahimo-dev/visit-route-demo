# 訪問ルートAI デモ版

訪問型サービスの「だれを・どの順で」行かせるかを、ブラウザだけで試せるデモ。
相性・スタッフの特性・顧客の希望を、項目と重み（0〜5）・必須で組み立て、AI案（割当と順番）と手作業案を比べられる。

- データは**このブラウザの中だけ**に保存（localStorage）。サーバーへは送らない。実在の個人情報は入れない
- 同梱のデータは架空（仙台市の公共施設を擬人化したスタッフ・訪問先）
- 本体：`katahimo-dev/visit-route-poc`（Firebase 版 PoC）

設計：[docs/prd.md](docs/prd.md)／[docs/design.md](docs/design.md)／[docs/adr/](docs/adr/)。AI エージェント向けのルールは [AGENTS.md](AGENTS.md)。

公開先：https://katahimo-dev.github.io/visit-route-demo/ （main に push すると GitHub Actions がテスト→ビルド→公開）

## 使い方（デモ）

1. 「予定」で手作業の割当（担当を選ぶ／列のあいだでドラッグ）
2. 「条件」で重み（0〜5、重み1＝移動10分ぶん）と必須を決める。「項目」「相性」「ヘルパー」「利用者さん」で特性・必要条件・希望・相性を入れる
3. 「AI案」で「AI案を作る」→ 手作業案と左右に比べ、訪問を押すと理由（点の内訳）が出る。「この案を採用」で予定に写す
4. 「データ」で書き出し・読み込み・初期状態に戻す

## ローカルで動かす

```bash
npm ci
npm run dev        # http://localhost:5173
npm test && npm run lint && npm run typecheck && npm run build
```
