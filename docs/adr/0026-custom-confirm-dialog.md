# ADR-0026：ブラウザ標準の確認を、独自の確認ダイアログに置き換える（UI/UX 改善の区切り1b）

- 日付：2026-10-18
- 状態：採用（利用者の追加要望（2026-10-18）「ブラウザの機能で出ているメッセージがデザインもいまいちで、一番上に出るので操作性も微妙。独自のダイアログや簡単なインフォ的なものに差し替えてほしい」。PRD D146〜D150。ADR-0025 の区切りの1b）

## 背景
- 画面の確認（消す・捨てる・置き換える・確定する前の「よろしいですか？」）は `window.confirm` だった（13ファイル・35か所：PlanPage 11・DataPage 4・ItemsPage 3・ComparePage 3・RulesPage 3・ClientsPage 2・StaffPage 2・PatternsSection 2・MonthPage・OffboardPanel・TypesPage・WeekPage・ErrorBoundary 各1）。ブラウザの確認は画面の一番上に出て、アプリの見た目（丸い枠・オレンジ・赤）と合わない。ボタンは「OK／キャンセル」で、何が起きるかがボタンから分からない
- `alert`・`prompt` は使っていない（知らせはトースト `components/Toast`、読み込みの失敗などは画面の中の文 `.error`）
- `window.confirm` は同期（押すまで JS が止まる）。独自のダイアログは待つ（Promise）ので、呼ぶ側を async にしても順序が壊れないようにする必要がある。日の画面の `create` は戻り値（計算を始めたか）を順に作る（runBatch）が同期で使っている
- 変更があるまま再読込・タブを閉じるときの確認（`beforeunload`。PRD D130・ADR-0023）は、ブラウザの仕様でページが自分の画面を出せない
- 例外の画面（`app/ErrorBoundary`）は画面の部品が壊れた後に出る。main.tsx では Provider（データ・ルーター・トースト）より外にもある
- 制約：新しい依存を足さない。データ・契約（`src/contracts/`）・store は変えない。既存の e2e を通す

## 選択肢
1. 案A：Promise を返す `confirm` 風の API（`const ok = await confirmDialog({ title, body, confirmLabel, tone })`）と、画面全体で1つの Provider。部品は Provider が無くても単独で出せる形（ErrorBoundary は部品を直に出す）
2. 案B：画面ごとに「確認中」の状態を持ち、その場に確認の欄を出す（今の日の画面の訪問の取り消しの欄と同じ作り）
3. 案C：HTML の `<dialog>` 要素（`showModal()`）を使う
4. 案D：ライブラリ（Radix など）を入れる

## 決定
案A。
- 純粋な部分は `lib/confirmDialog.ts`（テストあり）：頼み方 `ConfirmOptions`（見出し・本文・確定の文言・取り消しの文言（既定「取り消す」）・色 `danger|primary`）、`toRequest`（既定を埋める）、待っている確認の並び `enqueue`・`settle`（先頭の1つだけを出す。2回押しても1回だけ答える）、Tab を回す行き先 `trapTarget`
- 部品は `components/ConfirmDialog.tsx`：`ConfirmDialog`（body の直下に出す。`role="alertdialog"`・`aria-modal`・`aria-labelledby`・`aria-describedby`、最初のフォーカスは取り消し、Tab は中で回す、Esc・背景を押すは取り消し、閉じたら開く前の要素へ戻す、`useBodyScrollLock`、body のほかの子を inert）・`ConfirmProvider`（main.tsx でトーストの内側に1つ）・`useConfirm()`。キーは window の捕捉の段で受け、右の欄（SidePanel）・メニューの引き出しの Esc に渡さない
- 同期を前提にしていた箇所：日の画面の `create` は同期のまま（自動作成・順に作るが戻り値を使う）にし、手で押したときの「手直しと固定を捨てて作り直す」確認を `recreate`（async）に出した。確認のあいだに計算が始まっていたら（`runRef`）何もしない。月のまとめて作る・欠勤の振り直し・案A／案B の切り替えも確認の後に計算中でないかを見直す。名簿の読み込みは今までどおり確認の後にデータが変わっていないかを見直す。〈スタッフ〉・〈利用者さん〉の `okToDiscard` は Promise を返し、呼ぶ側を async にした（`?id=` で開くときは確認を待たずに URL から id を消す。結果は同じ）
- 変更を捨てる確認の文は `lib/viewMode` の `discardMessage`（文）を `discardDialog`（見出し・本文・「捨てて閉じる」など・「編集を続ける」・危険の色）に替えた
- ErrorBoundary は `ConfirmDialog` を自分の状態で直に出す（Provider に頼らない）
- `beforeunload` はブラウザの確認のまま残す（置き換えられない）
- 35か所の分け方：すべて確認（confirm）。知らせ（トースト）・エラーのダイアログ（ボタン1つ）に替えたものは無い（もともと alert・prompt が無い）。危険の色（赤）は消す・捨てる・すべて置き換える・初期状態に戻す・取り消す（仮押さえ・欠勤）、オレンジは確定・コピー・動かす・条件を合わせる・名簿の追加・更新など戻せるか、データを消さない操作

## 理由とトレードオフ
- 得るもの：画面の中央にアプリの見た目で出て、問いと何が起きるかとボタンの動詞で判断できる。消す操作は赤で区別できる。呼ぶ側の変更は「`confirm(文)` → `await confirmDialog({...})` と関数を async に」で小さい。キーボード・読み上げの扱いは1か所にまとまる。純粋な部分は単体テストで確かめられる
- 失うもの：確認が非同期になるので、確認のあいだに別のタブでデータが変わると、確認の前に読んだ中身で進む箇所がある（多くは `update(fn)` で最新のデータに当てる。名簿の読み込みは見直す）。ネイティブの確認より重い（部品と CSS が増える）。e2e は `page.on('dialog')` で受けられないので、共通の `scripts/lib/confirmDialog.cjs`（出たダイアログの文を記録して押す。ネイティブのダイアログが出たら失敗に数える）に替えた
- 案B は35か所に状態と欄を足すことになり、見た目と操作がばらつく。案C の `<dialog>` は Esc の扱い（cancel イベント）・背景のクリック・フォーカスの戻りをどのみち自分で書き、右の欄（独自のモーダル）との重なりの順もそろえにくい。案D は依存が増え、ほかの欄（SidePanel・NavDrawer）と作りがそろわない

## 影響
- 画面：`components/ConfirmDialog.tsx`・`confirmDialog.css`（z-index 1300：右の欄・引き出し（1100）・トースト（1200）より前。印刷では出さない。480px 以下はボタンを縦に幅いっぱい・確定が上）、`main.tsx`（`ConfirmProvider`）、`app/ErrorBoundary.tsx`、上の13ファイルの確認、`lib/viewMode`（`discardDialog`）。データ・契約・store は変えない
- 確かめ：`src/lib/confirmDialog.test.ts`・`src/lib/viewMode.test.ts`、`scripts/e2e-dialog.cjs`（条件を消す・データを初期状態に戻す・この割当で確定・〈スタッフ〉の変更を捨てる・390px と印刷。ネイティブのダイアログが出たら失敗）。既存の e2e（e2e-view・e2e-home・e2e-address・e2e-compat）は `page.on('dialog')` で受けていたところを共通の `scripts/lib/confirmDialog.cjs` に替えた
- 見直す条件：読ませる必要があるエラーや入力を求める場面ができたら、同じ部品にボタン1つの形・入力欄の形を足す（今は使う所が無いので作らない）。ErrorBoundary の確認の e2e（わざと壊す道具が無い）は、壊す手段を用意したときに足す
