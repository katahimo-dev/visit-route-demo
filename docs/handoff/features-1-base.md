# 作業指示書：機能の入り切り その1「土台・管理者設定・入口の出し分け」（ADR-0028。PRD D210〜D213・D216）

## 0. 今回の作業
機能の入り切りを2つの PR に分ける。**今回（その1）は次だけ**。画面の中の欄・ボタンの出し分けと計算からの除外は「その2」（`features-2-screens-calc.md`）でやる。

1. 契約：`src/contracts/features.ts`（`FEATURE_IDS`（20）・`FeatureId`・`featuresSchema`・`Features`・`CALC_FEATURE_IDS`）。`orgSchema` に `features: featuresSchema.default({})`。知らない ID は捨てる（zod で。repair ではない）。版は1のまま
2. store：無い古いデータ・初期データ（seed）は `{}`＝すべて入。`reset()` も `{}`。書き出し → 読み込みで同じに戻る
3. `src/lib/features.ts`（純粋関数・テストあり）
   - `FEATURES`：機能ごとの `id`・`label`・`description`（1行）・`group`（予定を組む／当日の対応／問い合わせ／人の情報／AI の考え方／連絡／データ）・`requires?`・`paths`（その機能の画面の URL のパス。例 `vacancy` は `/vacancy`、`compare` は `/compare`、`workload` は `/workload`、`compat` は `/compat`、`rules` は `/rules`・`/items`、`monthPrint` は `/month/print`）・`doParams?`（`sudden` は `/plan?do=absence`）・`hides`（切ると隠れるものの短い文。ADR-0028 の表）
   - `isOn(features, id)`：依存（`vacancyNotice`→`vacancy`、`fare`→`workload`）を見る。無い ID は入
   - `featureOfLocation(pathname, search)`：その URL が切れる機能のどれか（土台なら null）
   - `TEMPLATES`：`basic`（基本）・`laborContract`（労務・契約管理）・`monthlyField`（月次予定・現場共有）・`all`（すべて）。名前・1行の説明・入り切りは ADR-0028 の表どおり。`applyTemplate(id): Features`（全20の ID を明示して書く）・`matchTemplate(features): TemplateId | 'custom'`・`templateDiff(features, id): { on: FeatureId[]; off: FeatureId[] }`
   - 土台（切れない）：ホーム・月・週・日・〈利用者さん〉一覧・〈スタッフ〉一覧・稼働時間・訪問の種類・データ・管理者設定
4. `src/lib/useFeature.ts`：`useFeature(id): boolean`・`useFeatures(): Features`（`useDemoData()` の `org.features` を読むだけ）。`src/components/Feature.tsx`：`<Feature id={...}>`（切なら何も出さない。その2で使う）
5. 管理者設定の画面 `src/pages/SettingsPage.tsx`（`#/settings`）
   - 見出し「管理者設定」・説明「使う機能だけを入れると、メニューと画面がすっきりします。切った機能のデータは消えません」
   - ひな形の4つ（カード。今と同じひな形に「いまの設定」の印、どれとも違えば見出しの横に「カスタム」）。「当てる」→ 独自の確認ダイアログ（`useConfirm`。ブラウザの confirm を使わない）に `templateDiff` の「入る機能」「切れる機能」の名前 → 確定で `update(fn)` で書く
   - グループごとのスイッチ（`role="switch"`・`aria-checked`・名前・説明・「切ると隠れるもの」・依存の注記。依存先が切なら押せず「〈空き状況〉を入れると使えます」）。押すとすぐ保存（主ボタンは置かない）。トースト「〈名前〉を切りました」
   - だれでも開ける（鍵なし）。呼び方は `org.terms` から引く
6. 入口の出し分け（URL の直書きを `lib/features.ts` から引く）
   - `lib/nav.ts` の `menuSections(terms, today, features)`：切った機能の項目を出さない。空のグループは見出しごと出さない。最後のグループを見出し「管理者」にして「管理者設定」（`/settings`・アイコンは歯車など）と「データ」。下のタブ・上の帯の名前・パレットの画面は今どおりここから引く（呼ぶ側すべてに features を渡す）
   - `app/App.tsx`：`/settings` のルートを足す。切った機能の URL（`featureOfLocation`）を開いたら `#/home` へ移し（`replace`）、トースト「この機能は管理者設定で切っています」と管理者設定へのリンク（トーストにリンクが置けなければホームの上に閉じられる知らせの帯）
   - `lib/commandPalette.ts`：切った機能の操作（欠勤・キャンセルを登録・問い合わせに答える 等）を出さない。「管理者設定」の画面・よみ（かんりしゃせってい・きのう）を足す
   - `lib/home.ts`：切った機能へ向かうカード・いつでもの入口（欠勤・キャンセル・問い合わせ）を出さない
   - `lib/tour.ts`：切った機能の枚を出さない（枚数が変わっても「次へ／戻る／N 枚中 M 枚目」が正しい）
   - `lib/links.ts` などの行き先を作る関数：切った機能なら null（呼ぶ側はリンク・ボタンを出さない）。D201〜D204 の行き先（稼働の見込み・欠勤・キャンセルの欄・日の画面の入らなかった訪問）
7. e2e：`scripts/e2e-features.cjs`（その1の分）。`AGENTS.md` のコマンドに1行足す。ひな形の4通りを、別のタブで localStorage を書き換えるか管理者設定の画面で当てて作り、メニューの項目・下のタブ・パレットの画面・ホームのカード・切った URL を開いたときのホームへの移動と知らせ・管理者設定のスイッチの読み上げ・確認ダイアログ・390px で横にはみ出さない・印刷で出さない、を確かめる。ほかの e2e と同じく `skipTour(ctx)`・`answerConfirms(page)` を使う

## 1. 担当範囲
- 触ってよい：`src/contracts/`（`features.ts` を足し `documents.ts` の `orgSchema`）・`src/store/`（既定値だけ）・`src/seed/`（org の初期値だけ）・`src/lib/`・`src/components/`・`src/pages/SettingsPage.tsx`（新規）・`src/app/`・`scripts/e2e-features.cjs`（新規）・`AGENTS.md`（コマンドの行だけ）
- 触らない：`src/matching/`・`src/solver/`・`src/evaluate/`・`src/reassign/`・`src/vacancy/`・`src/excel/`（Excel には入れない）、画面の中の欄・ボタン（その2）、`docs/`

## 2. 守るべき契約
- `docs/design.md` §4 features・§5「機能の入り切り」、`docs/adr/0028-feature-toggles-by-admin.md`、`docs/prd.md` D210〜D216
- `org.features` が無いデータで、メニュー・ルート・パレット・ホーム・ツアーが今と同じ（「管理者」のグループと管理者設定の項目が足されるだけ）

## 3. ルール
`AGENTS.md`（データを書き換えるのは store の `update(fn)` だけ・主ボタンは1画面1つ・呼び方は `org.terms`・常用漢字・コメントは日本語・独自の確認ダイアログ）

## 4. 完了の条件
- [ ] `npm run lint`・`npm run typecheck`・`npm test`・`npm run build` が通る
- [ ] 単体テスト：`org.features` の無い古いデータが `{}` で読め、知らない ID が捨てられ、往復で同じ／`isOn` の依存／ひな形4つの入り切りが ADR-0028 の表どおりで `matchTemplate` が返す・1つ直すと `custom`／`templateDiff`／`featureOfLocation`／表の整合（`menuSections`・パレットの操作・ホームのカード・ツアー・links の行き先がすべて土台か表のどれかに属する）／`menuSections` に各ひな形を渡したときの項目
- [ ] 既存の e2e（とくに `e2e-nav`・`e2e-mobile`・`e2e-home`・`e2e-tour`・`e2e-links`）がすべて入のデータで今どおり通る（メニューの並びを数える所は「管理者」のグループの分だけ直してよい）
- [ ] `scripts/e2e-features.cjs` が通る
- [ ] 変更点と、推測した箇所を `QUESTIONS:`／報告にまとめる
