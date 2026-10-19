# データの画面と管理者設定

> この画面のファイル：`src/pages/DataPage.tsx`・`SettingsPage.tsx`（`settings.css`）、`src/components/FilePick.tsx`（`filePick.css`）・`Tour.tsx`、`src/lib/filePick.ts`・`personLinks.ts`・`features.ts`。関連 ADR：0006・0020・0025 追記・0028。関連 PRD：D191〜D193・D209・D210〜D216。
> Excel の変換は design.md の「excel」、機能の表と判定は design.md の「features」。

### データ（`#/data`）

メニューの「管理者」グループ（土台。切れない）。

#### 注意書き・呼び方

- 「データは**このブラウザの中だけ**に保存し、サーバーには送りません。実在の人の名前・住所などの個人情報は入れないでください。」（〈利用者さん〉の決まりごとの注意書きと同じ文）。保存できなければ「保存できませんでした：…。書き出して保管してください。」
- 画面での呼び方（`Term` `terms`）：訪問する人・訪問先（各10文字まで）と「変える」。同じ呼び方は使えない。呼び方もデータに保存され、書き出しに入る

#### 控え（バックアップ。JSON）

- `Term` `backup`。「ファイルに書き出す」（データ一式（AI案・記録・確定した割当も）を1つの JSON に）
- 読み込みは `FilePick`（`backup-file`・caption「読み込む控え（JSON）」）。選ぶと、置き換える前に確認する

#### Excel（ADR-0006・ADR-0020）

- 欄 `section.data-excel`（data-testid `excel-card`・`aria-labelledby` は見出し・`:focus` で枠）。`excel` を切っていれば欄ごと出さない（控えは残す）
- 対象 `excel-kind`（`fieldset.segmented`・aria-label「Excel の対象」）：全体／〈利用者さん〉の名簿／〈スタッフ〉の名簿
  - 全体：〈スタッフ〉・〈利用者さん〉・項目・条件・相性・稼働時間・訪問のシートごとの一覧。読み込むといまのデータがその内容に置き換わる（AI案・記録・確定した割当は消える）。書き方はブックの「使い方」のシート
  - 名簿：その一覧（シート1枚）だけ。列は全体のブックと同じで、全体のブックも名簿として読める。ID か名前で同じ人を探して直し、いない人は足す（AI案・記録・確定した割当・訪問は消えない）。読み込み方 `roster-mode`：追加・更新（ブックに無い人はそのまま）／総入れ替え（ブックに無い人を〈スタッフ〉は休止、〈利用者さん〉は段階「終了」にする。消しはしない）
- 「Excel に書き出す」と読み込み `FilePick`（`excel-file`。`key={excelKind}` で種類を切り替えたら選んだファイルの文を消す。caption は全体なら「読み込む Excel（全体）」、名簿なら「読み込む〈呼び方〉の名簿（Excel）」）
- 名簿の読み込みは確認の後にデータが変わっていないかを見直す（`pendingRoster`）

#### 最終勤務日の知らせ（PRD D209）

- 〈スタッフ〉の名簿を読み込んだら、読み込む前と後の名簿を `lib/personLinks` の `lastDayChanged(before, after)`（excel の `lastDaySet` と同じ決まり。ID も返す）で比べ、入ったら（`pendingRoster` の後で）トーストに加えて Excel の欄に知らせの帯（`section.data-notice`・aria-label「最終勤務日の知らせ」・data-testid `lastday-notice`）
- 文「最終勤務日の入った〈スタッフ〉がいます。〈スタッフ〉の画面（名前から開く）で担当の振り直しを確かめてください」。名前は `#/staff?id=` へのリンク（`lastday-link`。閲覧の欄）と「（最終勤務日 M/D）」
- 閉じる（`lastday-close`・aria-label「最終勤務日の知らせを閉じる」）でフォーカスは Excel の欄（枠が見える）
- 画面の state で保存しない。次の読み込みの始め・Excel の種類の切り替え・控えや Excel 全体の読み込み・初期状態に戻すでも消す。読み直すと出ない
- `offboard` を切っていれば出さない。印刷では閉じるボタンを出さない

#### 使い方の案内・初期状態に戻す

- 「案内をもう一度見る」（`tour-again`。`useTour()`）：初めて開いたときに出る短い案内（5枚）をもう一度。見たかどうかはこのブラウザに覚え、データには入れない（書き出し・初期状態に戻すでは変わらない）
- 「初期状態に戻す」：デモの架空の事業所のデータに戻す（独自の確認。危険の色）。取り消すと知らせなし、確定で知らせ
- 「画面を読み直す」

#### ファイル選択（`components/FilePick.tsx`。PRD D192）

- `lib/filePick.ts`（純粋関数。テストあり）：`fileNameText(name)`（「選んだファイル：〈名前〉」・未選択は「ファイルを選んでいません」）、`FILE_PICK_LABEL`（「ファイルを選ぶ」）
- 見出し（`caption`）・見えない形の `input type="file"`（`opacity: 0`。見た目のボタンと同じ大きさで重ねる `.file-pick-hit`。`display: none` にしない）・見た目のボタンの `label`（`htmlFor`・`aria-hidden`）・選んだファイルの文
- 入力欄の名前は `aria-labelledby`＝見出し＋ボタンの文、説明は `aria-describedby`＝選んだファイルの文。フォーカスの枠は `input:focus-visible + label`。Space で選ぶ画面
- 選んだら `onPick(file)` を呼び、input の値を空に戻す（同じファイルをもう一度選べる）。`testId` で `-input`・`-name` も付ける
- src のファイル選択は控えと Excel の2つだけ

### 管理者設定（`#/settings`。ADR-0028。PRD D210〜D216）

- だれでも開ける。土台で切れない。`lead`「使う機能だけを入れると、メニューと画面がすっきりします。切った機能のデータは消えません」。主ボタンは置かない（スイッチはその場で保存）
- ひな形（`feature-templates`）：4つ（`feature-template`。今のひな形に「いまの設定」`feature-template-now`、どれとも違えば「カスタム」`feature-custom`）。「当てる」（`feature-template-apply`・aria-label「ひな形「〈名前〉」を当てる」）は独自の確認ダイアログで `templateDiff`（入る機能・切れる機能）を出し、取り消すと変わらない。説明「よく使う組み合わせを一度に当てます。当てたあとも、下のスイッチで1つずつ直せます。」
- グループごと（`feature-group`）の行（`feature-row`）：名前・1行の説明・「切ると隠れるもの：…」・依存の注記（依存先が切なら「「〈名前〉」を入れると使えます」で押せない、入なら「「〈名前〉」が入っているときに使えます」）とスイッチ（`feature-switch`。`role="switch"`・`aria-checked`。「入」「切」）
- 押すとすぐ保存（`update`）とトースト「〈機能〉を入れました／切りました」
- 切るときデータがあれば `turnOffImpact` の件数と効き方の確認（相性など）。データの無い機能は確認なし。取り消すと変わらない
- 切った機能の URL を開くとホームへ移り、閉じられる知らせと管理者設定へのリンク
- 390px で横にはみ出さない。印刷で知らせ・「当てる」を出さない

### 完了の条件

- [ ] 控えと Excel が同じファイル選択の部品・日本語の「ファイルを選ぶ」と未選択の文・input は見えない形・名前・Tab と枠・Space・確認・同じファイルをもう一度・Excel の誤り・名簿の見出し（`lib/filePick` のテスト・`scripts/e2e-tour.cjs`）
- [ ] 名簿の読み込みのあとの最終勤務日の知らせ（名前と閲覧の欄へのリンク・閉じるとフォーカスは Excel の欄・種類の切り替え・初期状態に戻す・読み直すと出ない）（`lib/personLinks` のテスト・`scripts/e2e-details2.cjs`）
- [ ] 「案内をもう一度見る」でツアーが出る・初期状態に戻しても見た印は残る（`scripts/e2e-tour.cjs`）
- [ ] 管理者設定：ひな形の4通りごとにメニュー・下のタブ・パレット・ホーム・画面の中の入口・ルートの移し先、相性を切るときの確認（`scripts/e2e-features.cjs`）
