# 訪問ルートAI デモ版

訪問型サービスの「だれを・どの順で」行かせるかを、ブラウザだけで試せるデモ。
相性・スタッフの特性・顧客の希望を、項目と重み（0〜5）・必須で組み立て、条件を変えたAI案（割当と順番）どうしを比べられる。

- データは**このブラウザの中だけ**に保存（localStorage）。サーバーへは送らない。実在の個人情報は入れない
- 同梱のデータは架空（仙台市の公共施設を擬人化したスタッフ・訪問先）
- 本体：`katahimo-dev/visit-route-poc`（Firebase 版 PoC）

設計：[docs/prd.md](docs/prd.md)／[docs/design.md](docs/design.md)／[docs/adr/](docs/adr/)。AI エージェント向けのルールは [AGENTS.md](AGENTS.md)。

公開先：https://katahimo-dev.github.io/visit-route-demo/ （main に push すると GitHub Actions がテスト→ビルド→公開）

## 使い方（デモ）

1. 「予定」を開くと、その日の訪問の一覧（畳んである）と、すべてのプリセットで自動で作ったAI案が出る。訪問を押すと理由（点の内訳）、ドラッグで手直しし、「この割当で確定」で確定する
2. 右の「プリセット」（標準・移動を短く・人の組み合わせ重視）を押すか、重みを変えて「AI案を作り直す」。作るたびに条件と結果が記録に残る
3. 「比較」で記録から任意の2つを A・B に選び、条件の差・点数・担当ごとの順番・地図を比べる
4. 「条件」「項目」「相性」「スタッフ」「利用者さん」で特性・必要条件・希望・相性を入れる。訪問の追加・編集・取消は「予定」の訪問の一覧で（初期データは未割当）
5. 「データ」で書き出し・読み込み・初期状態に戻す
6. 「データ」の「Excel に書き出す」で一覧（スタッフ・利用者さん・項目・条件・相性・稼働時間・訪問）を Excel にし、行を足す・直してから「Excel を読み込む」と内容がすべて置き換わる（AI案・記録・確定した割当は消える。書き方はブックの「使い方」シート）

## ローカルで動かす

```bash
npm ci
npx playwright install chromium   # e2e のブラウザ（PLAYWRIGHT_BROWSERS_PATH に入っていれば不要）
npm run dev        # http://localhost:5173
npm test && npm run lint && npm run typecheck && npm run build
npm run e2e        # 本物のブラウザの e2e（ビルドと配信も。ADR-0029）
```
