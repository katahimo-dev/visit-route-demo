# 作業指示書：機能の入り切り その2「画面の中の出し分け・計算からの除外・切るときの確認」（ADR-0028。PRD D211・D213〜D215）

## 0. 今回の作業
その1（`features-1-base.md`。契約 `src/contracts/features.ts`・`lib/features.ts`・`useFeature`・`<Feature>`・管理者設定の画面・入口の出し分け）は main に入っている前提。**今回は次だけ**。

1. 画面の中の欄・ボタン・リンクを `useFeature`／`<Feature>` で出し分ける（ADR-0028 の「機能の一覧」の「切ると隠れるもの」）
   - `patternMonthly`：定期パターンの欄の「毎月の第N週」の繰り返し方と「曜日ごとの時刻」。切ると選べない（今の値が毎月・曜日ごとの時刻なら、その欄は読むだけで出し「管理者設定で切っています」）
   - `clientLeave`：隠すのは入力の欄（〈利用者さん〉の休みの欄 `ClientLeavesSection`）と絞り込みのチップ「休み」だけ。休みは事実で計算に効き続けるので、閲覧の欄の休み・日の画面の休みの帯・日ごとの点・月の要対応の「休みの人に訪問」は残す
   - `requestedOff`：月の「休みを入れる」・「休みの人に N」の印
   - `monthPrint`：月の印刷のボタン
   - `compare`：日の画面の「案を変える ▾」の「比べる・戻す」のまとまり（「2つの案を比べる」など）、比較の画面へのリンク
   - `sudden`：日の画面の操作の行の「欠勤・キャンセル」、列の見出しの「急な欠勤」「欠勤を直す」、訪問の一覧の当日キャンセル、ホーム（その1で済）。欠勤の印・帯（事実）は残す
   - `vacancyNotice`：空き状況の4段目の案内文の欄
   - `compat`：〈スタッフ〉・〈利用者さん〉の閲覧の欄と詳細の吹き出しの相性、相性の画面へのリンク、条件の重みの画面の「相性」の条件、点数の理由・訪問の理由の相性
   - `allowedStaff`：〈利用者さん〉の「担当できる人」の欄・閲覧の欄・絞り込みのチップ「担当を限る」
   - `clientStage`：〈利用者さん〉の段階の5つの選択と紹介元（メールアドレスも）の欄。切ると「利用中／終了」の2つの選択（ほかの段階の人は今の段階の名前を出し、選び直せば利用中か終了になる）
   - `visitNotes`：入り方・鍵・駐車場・注意の欄と表示（予定の詳細・メールの鍵の選択）
   - `offboard`：〈スタッフ〉の最終勤務日の欄と担当の振り直しの欄（`OffboardPanel`）、データの画面の最終勤務日の知らせ（D209）。最終勤務日の値は事実なので計算に効く
   - `workload`・`fare`：日の画面の拘束が上限を超える帯、稼働の見込みへのリンク。`fare` が切なら稼働の見込みの交通費の列・単価の欄
   - `rules`：日の画面の右の欄「条件を調整する」・点数の横の理由・作り直しの帯（D161）、プリセットのカードは基準のプリセットの1枚だけ
   - `mail`：メールのボタン・欄（日・週・欠勤の連絡・空き枠の案内）と〈スタッフ〉のメールアドレスの欄
   - `mapsLink`：Google マップのリンク
   - `geocode`：郵便番号・住所の検索のボタンと「まとめて地図に置く」（地図のクリックで置くのは残す）
   - `excel`：データの画面の Excel の欄（控え（JSON）は残す）
2. 計算から外す（matching の compile）：`CompileInput` に `org.features`（または `features`）を足す。`compat` が切なら相性（表の値・相性の条件・×の可否）を読まない、`allowedStaff` が切なら `allowedStaffIds` を読まない（理由にも出ない）。切ったときの問題は、そのデータが空のときと同じ（`problemKey` も同じ）。事実（休み・欠勤・希望休・最終勤務日・パターン）は入り切りにかかわらず読む
3. 記録：`aiRunSchema` に `calcFeatures`（`compat`・`allowedStaff` の部分的な表。無ければすべて入）。記録を足す所で今の `calcFeaturesOf(org.features)` を書く。今と違う記録の日は「条件が変わった」（`lib/month` の `rulesStale` と同じ扱い。D43・D161 の作り直しの帯・月の要対応に乗る）
4. 切るときの確認（D215）：`lib/features.ts` に `turnOffImpact(data, id)`（残る・外れるデータの件数と効き方。例：相性 24組は計算から外れます／担当を限る 3人は計算から外れます／〈利用者さん〉の休み 3件は残り、計算に効き続けます／定期パターンの毎月・曜日ごとの時刻 2件は残り、訪問は今どおり作られます）。管理者設定のスイッチで、件数が1以上なら独自の確認ダイアログに出す。ひな形を当てるときの確認にも、切れる機能の件数を添える
5. e2e：`scripts/e2e-features.cjs` に、ひな形ごとの画面の中の入口（日の画面・〈利用者さん〉・〈スタッフ〉の欄・月・空き状況・データ）と、相性×の組が切ったら入ること（日の画面で案を作って担当を見る、またはテストで代える）を足す

## 1. 担当範囲
- 触ってよい：`src/pages/`・`src/components/`・`src/lib/`・`src/matching/compile.ts`（入り切りの読み取りだけ）・`src/contracts/data.ts`（`calcFeatures` だけ）・`src/store/`（既定値だけ）・`scripts/e2e-features.cjs`・`AGENTS.md`（e2e の行だけ）
- 触らない：`src/solver/`・`src/evaluate/`・`src/reassign/`・`src/vacancy/`（compile を通るので自動で変わる）・`src/excel/`・`docs/`

## 2. 守るべき契約
- `docs/design.md` §4 features・matching の「機能の入り切り」・§5「機能の入り切り」、`docs/adr/0028-feature-toggles-by-admin.md`、`docs/prd.md` D211・D213〜D215
- すべて入（`org.features` が `{}`）のとき、画面・問題（`problemKey`）・点数が今と同じ

## 3. ルール
`AGENTS.md`（再現性：matching に `Math.random`・`Date.now` を入れない、データを書き換えるのは store の `update(fn)` だけ、主ボタンは1画面1つ、独自の確認ダイアログ、呼び方は `org.terms`）

## 4. 完了の条件
- [ ] `npm run lint`・`npm run typecheck`・`npm test`・`npm run build` が通る
- [ ] 単体テスト：compile（`compat` 切で×の組が可・理由に相性なし・データが空のときと同じ `problemKey`／`allowedStaff` 切で限らないのと同じ／休みの訪問は切っても入らない／すべて入で今と同じ）、`calcFeatures` の無い記録はすべて入、入り切りが違う記録の日が「条件が変わった」になる、`turnOffImpact` の件数と文
- [ ] 既存の e2e がすべて入のデータで今どおり通る
- [ ] `scripts/e2e-features.cjs` が通る
- [ ] 変更点と、推測した箇所を報告にまとめる
