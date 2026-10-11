# 訪問ルートAI デモ版

訪問型サービスの「だれを・どの順で」行かせるかを、ブラウザだけで試せるデモ。
相性・スタッフの特性・顧客の希望を、項目と重み（0〜5）・必須で組み立て、AI案（割当と順番）と手作業案を比べられる。

- データは**このブラウザの中だけ**に保存（localStorage）。サーバーへは送らない。実在の個人情報は入れない
- 同梱のデータは架空（仙台市の公共施設を擬人化したスタッフ・訪問先）
- 本体：`katahimo-dev/visit-route-poc`（Firebase 版 PoC）

設計：[docs/prd.md](docs/prd.md)／[docs/design.md](docs/design.md)／[docs/adr/](docs/adr/)。AI エージェント向けのルールは [AGENTS.md](AGENTS.md)。

## 状態

設計の草案（実装前）。
