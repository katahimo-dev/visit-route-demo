# 画面共通の部品

> この部品のファイル：`src/components/ui.tsx`・`FieldError.tsx`・`usePanelFoot.ts`・`floating.ts`・`MapDock.tsx`・`Toast.tsx`・`DetailPopover.tsx`・`PersonPopover.tsx`・`personDetail.tsx`・`Term.tsx`・`EmptyNext.tsx`・`Tour.tsx`・`mailParts.tsx`・`mapsLinks.tsx`、`src/pages/mailPanels.tsx`、`src/lib/panelFit.ts`・`personPopover.ts`・`glossary.ts`・`emptyGuide.ts`・`tour.ts`・`links.ts`・`mailto.ts`・`mail.ts`・`mapsLink.ts`。関連 ADR：0017・0018・0022 追記・0025 追記・0031・0036・0037・0045。関連 PRD：D91〜D101・D122〜D126・D173〜D177・D193〜D197・D201〜D209・D226・D236〜D238・D240〜D242・D250〜D252・D276・D277。
> 画面全体の決まり・メニュー・確認ダイアログ・機能の入り切りは [pages.md](pages.md)。

### 画面の見出しとボタンの3段（ADR-0036。PRD D236〜D238）

#### `components/ui.tsx` の `PageHeader`

- `lead`（`p.page-lead`）は `word-break: auto-phrase`・`text-wrap: pretty` で、390px で折り返しても語の途中で切らず、最後の行に1〜2字だけ残さない
- `PageHeader({ icon, title, lead?, actions?, nav? })`：`header.page-head` の中に1段目 `.page-head-row`（アイコン `.page-icon` 38px・`.page-title`（h1 と `p.page-lead`）・右の `.page-actions`）、`nav` があれば2段目 `.page-tabs`
- `lead` は「この画面でやること」の1行（長い説明は `Hint` に畳む）。`actions` は主ボタン（塗り）を1つまでと、その左の状態の印（日の予定の「未確定」など）。主ボタンの無い画面は渡さない（月の予定は進み具合の帯の次の一手が主。PRD D154）
- 見出しの右のボタンは上下 9px（`.page-actions .btn:not(.btn-small)`）で、見出しの段を低くする
- 狭い画面では右の `.page-actions` が題名の下へ折り返す（`flex-wrap`。題名は `min-width: 200px`）

#### `components/ViewSwitch.tsx`（予定の［月｜週｜日］。PRD D59・D237）

- 月・週・日の予定の `PageHeader` の `nav` に渡し、題名の下のタブにする。`nav.view-switch`（`aria-label`「予定の表示の切り替え」）の中は `Link`（role=tablist・tab にしない。押すと画面が移るリンクのナビ）
- 今の画面は `aria-current="page"`・太字・朱の下線 3px（`.view-switch-item.is-on`。色だけに頼らない）。タブの行の下に1px の線（`.page-tabs`）

#### ボタンの3段（`styles.css`）

| 段 | クラス | 見た目 | 使う所 |
|---|---|---|---|
| 主 | `.btn.btn-primary` | 濃い朱の塗り・白い文字・下の影 | 1画面に1つ（右の欄は帯の先頭に1つ）。日の予定は「この割当で確定」（確定済みの日は `.btn` にする） |
| 副 | `.btn` | 白地に枠 | ほかの操作の多く。「欠勤・キャンセルを登録」（アイコンだけ朱。`.plan-sudden-btn svg`）「訪問を追加」「案を変える ▾」 |
| ついで | `.btn.btn-text` | 枠と地なし・`--sub` の文字（`--bg` で 5.5・`--primary-soft` で 5.2。枠のボタンより目立たせない）。重ねると下線・`--ink` の文字・`--primary-soft` の地（地の色だけに頼らず下線で分かる）。押せないときは `.btn` の薄さ | 戻す・送るなど、無くても流れが進む操作。日の予定の「元に戻す」「メールで送る」 |

- 押せる所の大きさは3段とも同じ（`.btn` の余白のまま）。戻せない操作の `.btn-danger`（赤い枠と文字）は別
- 1画面に塗りが2つ以上出ない（月の予定は帯の次の一手、空き状況は「要約をコピー」、比較は「もう1案作って比べる」、データは「ファイルに書き出す」、一覧の画面は「〜を追加」）

### 右の欄（`SidePanel`）と確定のボタンの帯（PRD D194〜D197）

#### `components/ui.tsx` の `SidePanel`

- 右から出る欄（`narrow` あり）。z-index 1100。広い画面（601px 以上。PRD D284）は高さを内容に合わせる：`.drawer-wrap` に余白 12px（欄の幅は `min(640px, 100%)`・`narrow` は `min(440px, 100%)` で余白の内側に収める。100vw だと 601〜664px ではみ出す）・`align-items: flex-start`、`.drawer` は `height: auto; max-height: 100%`・角丸 12px・全周の影・`overflow: hidden`、`.drawer-body` は `flex: 0 1 auto`。短い欄は内容の高さで上に寄り、長い欄は画面の高さまでで `.drawer-body` が巻き、帯は欄の下に貼り付く。狭い画面（600px 以下）は今のまま画面いっぱい。フォーカス：開いたら最初の入力欄（`focusPanel`）、Tab が中で回る、閉じたら戻す（`returnFocus` で戻り先を差し替えられる）。`useBodyScrollLock`
- 裏の inert（PRD D252）：開いたとき body の直下のほかの子（`#root`・メニューの引き出し）を `inertLock`（要素ごとに数えるロック。確認ダイアログ・パレット・ツアーと同じ）で inert にし、閉じるときは inert を外してから戻り先へフォーカスする。`data-inert-keep` の付いた子（知らせの置き場 `.toast-layer`、用語の説明 `TipBubble`（`Term.tsx`。body の直下に hidden で常駐するので、z-index 1150 で欄（1100）の上に出し、欄の中の用語の説明の上にマウスを移しても消えない。PRD D175））は外す。後から body の直下に出るもの（確認ダイアログ）はロックの外。名前の詳細（`DetailPopover`）は欄の中に出る。欄の上に欄を重ねたら下の欄も inert（数えるので閉じる順にかかわらず戻る）
- `onSubmit`（PRD D251）：渡すと `.drawer-body` を `<form noValidate>` にし（無ければ `div`）、内容と帯を包む。帯の保存は `type="submit"`。送信は `submitHandler`（下の「フォームの共通の決まり」）。`form` ⇄ `div` が入れ替わることがあるので、`usePanelFoot` に要素の種類（`bodyKind`）を渡して見張り直す。使う欄：種類、仮押さえ、欠勤・キャンセルの2段目（「次へ」）、訪問の詳細の欄。中に `<form>` を持つ欄（条件の調整のプリセット）には渡さない
- `focusKey`：開いたまま変わったら、`data-return-focus` の要素、無ければ最初の入力欄、それも無ければ欄へフォーカス
- 中の形：見出し（`.drawer-head`。巻く領域の外）＋ `.drawer-body`（巻く領域。`ref`）＞ `.drawer-content.stack`（内容）・`footer.drawer-foot`（`footer` があるときだけ）・`.drawer-foot-end`（番兵。高さ0・`aria-hidden`）
- 帯のある欄はどれも主ボタン（または赤い確定のボタン）を `footer` の先頭に置く（`SidePanel` を使う画面の欄は13ファイル・16か所）

#### `components/usePanelFoot.ts`

- `usePanelFoot(body, foot, end, hasFoot, bodyKind?)`：`bodyKind` が変わっても見張り直す。IntersectionObserver（root は巻く領域・下を 1px 広げる）で番兵が見えていなければ帯の `data-stuck="true"`、見えていれば `"false"`。ResizeObserver で帯の高さを巻く領域の `--drawer-foot-h` に入れる
- `useVisualViewportFit(wrap)`：visualViewport の resize・scroll で `panelFit` の結果を `.drawer-wrap` の `top`・`height`（`bottom: auto`）と html の `--drawer-top` に当て、null なら外す
- `usePanelToastPlace(drawer, head)`：ResizeObserver・resize で見出しの高さ・欄の幅を html の `--drawer-head-h`・`--drawer-w` に、`toastPlace` の結果を `data-drawer-toast` に書く

#### `lib/panelFit.ts`（純粋関数。テストあり）

- `panelFit({ innerHeight, height, offsetTop, scale })`：見えている所が `KEYBOARD_MIN_PX`（80px）以上縮んだら `{ top, height }`、拡大中（scale ≠ 1）・差が小さい・読めない値は null
- `toastPlace(viewportWidth, drawerWidth)`：欄の外が `TOAST_SIDE_MIN_PX`（360px）以上なら `side`、狭ければ `top`

#### CSS（`styles.css`）

- `.drawer-body`：`flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scroll-padding-bottom: calc(var(--drawer-foot-h) + 8px)`
- `.drawer-content`：余白。帯が続くときは下を 8px
- `.drawer-foot`：`position: sticky; bottom: 0`・折り返す・下は `12px + safe-area-inset-bottom`・左右は safe-area。ふだんは欄と同じ背景・透明の線、`[data-stuck="true"]` で `--soft` の背景・線・上向きの影
- 600px 以下：ボタン（`> .btn`）は同じ幅で横に（高さもそろえる）、3つ以上（`:has(> .btn ~ .btn ~ .btn)`）は先頭を全幅・残りは2つずつ、ボタンでない子は1行。見出し・内容・帯の左右を 16px（safe-area）にそろえる
- `.toast` は `pointer-events: none`。欄が開いている間は html の `data-drawer-toast` で置き場所を変える：`top`＝`--drawer-top`＋`--drawer-head-h`＋8px（見出しのすぐ下）、`side`＝`left: calc((100vw - var(--drawer-w)) / 2)`（欄の外の真ん中）
- 印刷の `body:has(.contact-sheet) .drawer-foot`（出さない）

### 浮いている部品とトースト

- 地図の浮かせた表示：`components/MapDock.tsx`（画面の外の地図を右下に浮かせる）。位置は `--map-dock-left`・`--map-dock-top`
- `components/floating.ts`（`FLOATING_EVENT`・`useFloatingEdge(name)`）：知らせ（トースト）は欠勤の振り直しの帯・地図より上に出す（`--reassign-dock-top`・`--map-dock-top`）
- `components/Toast.tsx`：z-index 1200。body の直下の `div.toast-layer[data-inert-keep]` に出す（右の欄の inert に巻き込まれず、欄が開いていても読み上げ・「元に戻す」を押せる。確認ダイアログ・パレット・ツアーの間は今までどおり inert）。`toast(msg)` は文だけ（`output.toast`・2.5秒・押しても下へ抜ける）。`toast(msg, { action })` はボタン1つ付き（`.toast.has-action`。文は中の `output`・ボタンだけ押せる・`toastMs`＝6秒から文の長さ（1字 120ms）で延ばし10秒まで・フォーカスがある間・マウスを重ねている間は消さず、両方が外れたら2.5秒で消す。ボタン付きの箱（文の幅だけ）はマウスを受ける（`pointer-events: auto`）。PRD D268）。使う所は全体の「元に戻す」（`components/undo` の `useUndoAction`。data-testid `toast-undo`。戻したあとは「やり直す」 `toast-redo`。PRD D329）と、範囲の AI で組むの終わりの［月の予定を見る］／［週の予定を見る］（`components/batchBand` の `MonthBatchHost`。提案を出したときに日・週・月の予定か（空き状況から始めたなら）空き状況にいれば、提案の帯が見えるのでボタンを付けない。提案が無いときは、その月の月の予定・その週の週の予定を見ていれば付けない（`lib/month` の `monthShown(search, date)`。テストあり）。PRD D268・D328）

### フォームの共通の決まり（PRD D250・D251。`components/FieldError.tsx`）

- `FieldError`（`id`・`as`＝`p`（既定）／`span`・`className`・`style`・`testId`・`live`・`token`）：文があれば `.error` で出し、無ければ（null・false・空）何も出さない。見た目は今までの `.error` のまま。入力の誤り・保存や計算の失敗の文はどれもこれで出す（コード分割中の `PlanPage.tsx`・`App.tsx` は `role="alert"` を足しただけ）
  - `live`（既定 true）：`role="alert"` で出たときに読み上げる。保存を押したときの誤り・計算の失敗だけ。打つたびに検査する欄の誤り（郵便番号・呼び方の重なり・項目と選択肢の名前・条件の下限＞上限と件数・働ける時間帯・欠勤の開始と終了・空き状況の所要・開始日・希望の開始）と、ほかで読み上げる誤り（データの保存の失敗は App の帯）は `live={false}`（欄の `aria-describedby` で読む）。条件の重みの乱数の種・プリセットの名前（打つたびの検査）は元の `.error` のまま
  - `token`：保存のたびに作るエラーのオブジェクト。変わったら文の要素を作り直し、同じ文でも読み上げ直す（訪問・〈利用者さん〉・〈スタッフ〉・種類・仮押さえ・定期パターン・休み）
  - `.error` のクラスでも誤りの文でないもの（振り直しの「対応が必要」の見出し・点数の赤字）はそのまま
- `invalidAttrs(invalid, errorId)`：誤りなら `aria-invalid="true"`・`aria-describedby`（誤りの文の id）を返す。文の id は `useId`
- `FormErr`（`{ text, field? }`）・`toFormErr(e)`：契約の検査（zod）の誤りは最初の `path` を `field` に（`lib/common.ts` の `formErrorField`）。画面は `error?.field === 'name'` などで欄に印を付ける
- `RequiredMark`：見出しの横の小さな「必須」の札（`.req-mark`。`aria-hidden`）。入力欄には `required` を付け（フォームは `noValidate` なのでブラウザの吹き出しは出ない）、読み上げに必須と伝える。付けた欄：訪問（日付・〈利用者さん〉・開始時刻・最も遅い開始時刻・所要）、〈利用者さん〉の画面の基本の節の表示名、〈スタッフ〉の画面の基本の節の名前、種類の名前・標準の所要、仮押さえの表示名
- `submitHandler(save)`：`<form onSubmit>` 用。既定の送信を止めて `save` を呼び（Promise も待つ）、次の描画で form の中の誤った欄へフォーカス（`focusFirstInvalid`：保存を止めた誤り（中の `role="alert"` の文）を `aria-describedby` で指す欄を先に、無ければ最初の `[aria-invalid="true"]`。保存できて閉じた form は何もしない）。Enter の暗黙の送信で保存し、`textarea` は改行のまま
- `enterToSave(save)`：小さな入力のまとまり（〈利用者さん〉の画面の繰り返し・終わらせる・休みの `fieldset`）の `onKeyDown`。入力欄の Enter（変換中は除く）を外の form に渡さず、まとまりの保存を呼ぶ
- form にした所：右の欄の `onSubmit`（訪問の詳細の欄も）、人の画面の節（`EditSection`）、呼び方（データの画面）。もともと form：項目の選択肢、プリセットの名前

### 予定の共通の部品（`components/scheduleParts.tsx`・`scheduleParts.css`・`components/undo.tsx`。PRD D327〜D332。ADR-0054）

日・週・月の予定は「拡大率」として、同じ見出しの型（`PageHeader`＋［月｜週｜日］）と次の部品を並べる。本体（日の時間軸・順番・一覧、週の時間軸・表、月のカレンダー・日ごとの一覧）は各画面に残す。

- `ScheduleToolbar`（`div.row.schedule-toolbar`・data-testid `schedule-toolbar`・`data-zoom`＝`day|week|month`。印刷では出さない。600px 以下は文字を小さく詰める）：並びは ①欠勤・キャンセルを登録（`sudden-open`。日は欄を開くボタン、週・月は `absenceHref(その日。今日より前なら今日)` へのリンク。`sudden` を切れば出さない）②「AI で組む ▾」（`MenuButton`・`plan-menu`）③「元に戻す」「やり直す」（`UndoButtons`）④表示の切り替え（日：時間軸・順番・一覧、月：カレンダー・日ごとの一覧（`month-layout`）。children）⑤「その他 ▾」（`plan-more`・`week-more`・`month-more`。項目が無ければ出さない）⑥計算の進み具合（日。after）
- `useScopeItems({ zoom, date, onDay?, dayBusy?, onMonth? })`：「AI で組む ▾」の先頭のまとまり「AI で組む（範囲）」（`group`）の3項目。この日（M/D）を組む `ai-scope-day`（今日より前・伝えた日・組める訪問が無い日は押せず理由。日の予定は `onDay`＝その場の提案、週・月は範囲の計算を1日で）・この週（M/D〜M/D）を組む `ai-scope-week`（`weekBatchDays`：今日以降の伝えていない、訪問のある日。0日なら押せず理由）・この月（N月）を組む `ai-scope-month`（月の予定は `onMonth`＝欄「N月の担当を AI で組む」を開く、ほかは `/month?ym=…&do=batch`）。範囲の計算中は押せず「ほかの担当を組んでいます。終わってから押せます」。説明は「ピンの訪問はそのままで、担当・順番の提案を出します（当てるまで担当は変わりません）」
- `ProposalBand`（`section.plan-band.schedule-band.proposal-band`・`aria-label="AI の提案"`・data-testid `proposal-band`・`data-kind`＝`day`（日の予定のその場の提案）／`range`（範囲の提案））：「提案（名前）：担当が変わる N件（`proposal-moved`）・時刻が変わる M件（`proposal-shifted`）・点 a→b（`proposal-score`。日だけ）」と［当てる］（主ボタン・`proposal-apply`）［捨てる］（`proposal-discard`）、古いときの文（`proposal-stale`）、差の一覧（`details.reassign-moves-box`・`proposal-moves`）
- `RangeProposalBand`：`lib/monthBatch` の `proposal`（範囲の提案。1つだけ）を日・週・月の予定と空き状況に出す。題は「提案（11月・22日分）」、日ごとの差の一覧（`proposal-days`。日付 `proposal-day` を押すとその日の日の予定）。当てると `monthBatch.apply()`（組み始めたときのままの日だけ1回の update。変わった日は当てず、件数を知らせる）
- 複数選択（PRD D330）：`useVisitSelection(key)`（日付・週の始まりが変わったら外す。Esc で外す（入力欄の中・右の欄・モーダルの間は除く））。日の時間軸の帯（`RouteTimeline` の `multi`・`onMulti`）・順番のカード（`VisitCard` の `multi`・`onMulti`）・週の時間軸の帯（`DayColumn` の `isMulti`・`onMulti`。今日より前・休みの帯は選ばない）で、Shift・Ctrl（mac は ⌘）＋クリック、帯にフォーカスして Shift／Ctrl＋Enter で選ぶ・外す。選んだ帯は `.is-multi`（太い縁）と読み上げの「（選択中）」
- `SelectionBar`（`section.selection-bar`・`aria-label="選んだ訪問"`・data-testid `selection-bar`。画面の下に貼り付く `position: sticky`（スマホは下のタブの上）。印刷では出さない）：「N件を選択」（`selection-count`）・［担当を替える ▾］（`selection-assign`。利用中の〈スタッフ〉。項目 `selection-staff`）・時刻をずらす −30・−15・+15・+30（`selection-shift`・`data-minutes`）・［取り消す］（`selection-cancel`。独自の確認）・［選択を外す］（`selection-clear`）。どれも「この回だけ」で `lib/multiEdit`（`assignMany`・`shiftMany`・`cancelMany`）を1回の update（手の名前は「担当を替えました」など）。結果は `multiResultText`（「3件の担当を替えました（1件はできませんでした：その日は働かない）」）
- `UndoButtons`（`components/undo`）：「元に戻す」（`undo-btn`。戻せる手が無ければ `aria-disabled`。title は「「手の名前」を戻します（Ctrl+Z）」）・「やり直す」（`redo-btn`。やり直せる手があるときだけ）。読むのは `lib/history` の `appHistory.state`。押すと store の `undo()`・`redo()` とトースト
- 進み具合の帯（`components/progressBand` の `ProgressBand`）は月の予定だけ。週は1行の状態（`week-status`）、日は見出しの状態の印（`confirm-state`）と「今の担当」の1行（`plan-summary`）

#### `lib/history.ts`・`lib/multiEdit.ts`（純粋関数。テストあり）

- `createHistory(max=50)`：`record(before, after, label?, token?, group?)`（同じなら積まない。同じ token の手は置き換えて2つ積まない。同じ group の続きは直前の手に足す。積むとやり直しは消える）・`peek()`（直前の手）・`undo(current)`・`redo(current)`（戻した先のデータと手の名前）・`clear()`・`state`（`{ undo, redo, undoCount, redoCount }`。知らせは microtask で後へ回す）。`appHistory` はアプリで1つ。`historyKey(e, isMac)`・`isTextTarget(target)`・`historyKeysOn(pathname)`（`/staff-view/:id`・`/month/print` では効かせない）
- `assignMany(data, ids, staffId, today)`・`shiftMany(data, ids, minutes, today)`・`cancelMany(data, ids, today)`：消えた・取り消した・今日より前の訪問は理由つきで外す。担当は `assignOnDays`（その日に担当できない人は当てない）、時刻は `applyVisitEdit` の「この回だけ」（時間の約束の幅はそのまま）。`selectionText(n)`・`multiResultText(what, r)`

### 訪問の詳細の欄（`components/VisitPanel.tsx`・`visitPanel.css`。PRD D301〜D305。ADR-0051）

- `VisitPanelProvider` を App の殻（`DayProvider`・`PersonPopoverProvider` の中、ルートの外）に1つ置き、`useOpenVisit()(req)` でどの画面・コマンドパレットからでも開く（画面を移っても欄は残る）。`req`：`visitId`（見る・直す）か `newVisit: { date, clientId?, start? }`（新規）、`draft?`（はじめの入力の差し替え。週・人の画面のカレンダーのドラッグの落とした日時、空き枠の所要）、`onSaved?`（`{ visitId, date, moved, staffSet, isNew, label }`）、`returnFocus?(visitId)`（閉じたあとのフォーカス。保存で作り直した回は新しい ID）
- `SidePanel`（`narrow`・`onSubmit`）。中身 `visit-panel`（`data-visit`・`data-new`）：内容 `vp-summary`（〈利用者さん〉 `vp-client-name`・種類・取り消し `vp-cancelled`・休み、日時 `vp-when`・所要・種類・担当 `vp-staff-now`（`StaffMark`・ピン・いつもの担当・確定した割当）・繰り返し `vp-pattern`・この回の変更 `vp-changes` と「繰り返しのとおりに戻す」 `vp-restore`・メモ、日の予定以外から開いたら「日の予定で見る」 `vp-open-day`）、日時 `vp-time`（新規は〈利用者さん〉 `vp-client` も。種類 `vp-type`・日付 `vp-date`・時間の約束 `vp-window`・開始 `vp-start`（幅を保ってずらす）・遅い開始 `vp-latest`・所要 `vp-duration`・メモ `vp-note`）、担当 `vp-staff`（「変えない」`vp-staff-keep`・候補 `vp-staff-choice`（`data-staff`。選べない人は `is-off` と理由）・「担当なし」`vp-staff-none`。候補は `useDeferredValue` の入力で `staffChoices`）、範囲 `vp-scope`（繰り返しの回だけ。`vp-scope-once|following|all`。範囲の文とそのままにする回 `vp-scope-note`）、誤り `FieldError`、取り消し `vp-cancel-area`（`vp-cancel`・`vp-cancel-sameday`・`vp-uncancel`。欄は開いたまま）、決まりごと・道順（`vp-route`）
- 帯：保存 `vp-save`（主ボタン。新規は「追加」）・閉じる `vp-close`。見るだけ（今日より前・取り消し済み・スマホ幅の新規）は閉じるだけ
- 日時を変えて候補が変わり、選んでいた人（担当なしも）が選べなくなったら「変えない」に戻す
- 開いたときの訪問を控え、保存・取り消しの前にデータの訪問と違えば（別のタブ・別の操作）「この訪問は別の操作で変わりました」で止める。書く前のデータが今のデータでなければ書かない（確認を待つ間に変わったとき）
- 保存：`applyVisitEdit` → これ以降・すべてで確定した日も変わるなら独自の確認 → `update(fn, '訪問を保存')`（新規は「訪問を追加」、取り消しは「訪問を取り消す」「当日キャンセル」など） → トースト（範囲・当てられなかった回の件数）と全体の「元に戻す」（`toast-undo`。PRD D329）
- スマホ幅（`COMPACT_QUERY`。600px 以下）：日時 `vp-time`・範囲 `vp-scope`・「繰り返しのとおりに戻す」を出さず、新規は文 `vp-narrow-new` だけ
- 閉じたときに戻り先が消えていれば画面の見出し（`.app-main h1`）へ
- 印刷：`.drawer-wrap:has(.visit-panel)` を出さない

#### `lib/visitOps.ts`（純粋関数。テストあり）

- 欄がデータを読む・書く薄い層（段3でデータの形を変えるときはここを差し替える）。書いたデータは呼ぶ側が `update` で当てる。今日・時刻・新しい ID は引数
- 読む：`draftOf`・`newDraft`・`timeChanged`・`assignmentOf`（今の案、無ければ確定した割当）・`visitInfo`（繰り返しの文・この回の変更・いつもの担当・休み・変えられるか）・`occurrenceChanges`・`scopeTexts`（「M/D 以降の〈曜日〉曜の回」・ほかの曜日の有無・そのままにする回）・`staffChoices(data, visitId, draft)`（欄の日時でその日の問題を日の予定と同じ作り方で作り、「担当を変える ▾」と同じ `lib/reassignMenu` の `reassignChoices`。出す人は `workingStaff`（稼働時間帯がある・列に訪問がある）と今の担当）・`staffPickError`（保存の前に今の入力で選んだ担当を見直す）
- 書く：`applyVisitEdit(data, { visitId, draft, staff, scope }, today, ids, now)`（今ある訪問の〈利用者さん〉は変えない。新規・この回だけ＝`savedVisit`・これ以降＝`moveFollowing`（開いた回を欄の日付へ。over で所要・種類・時間の約束・幅・いつもの担当）・すべて＝今日以降で最初の、この回だけ変えていない・取り消していない同じ曜日の回から、元の日から欄の日付までの差で。メモだけならこの回だけ。担当は `assignOnDays`（その日の今の案で `bestInsertion`・固定。担当なしは外す）、これ以降・すべては範囲の回と手直しの記憶にも）・`cancelVisitOp`・`uncancelVisitOp`（ほかに変えた所が無ければ edited も外す）・`restoreOccurrenceOp`
- 一覧：`unassignedVisits(data, from, to)`（今の案で入らない訪問）・`dayVisitRows(data, date, nowHm, limit)`（担当なし → 案なし → これからの近い順）・`clientVisitsIn(data, clientId, from, to)`・`staffVisitsIn(data, staffId, from, to)`（その日の今の案、無ければ確定した割当でその人の列にある訪問。取り消しは出さない。〈スタッフ〉の画面の予定）
- 繰り返し：`endPatternOp(data, patternId, last, today)`（終了日を入れ、last より後で今日以降の、この回だけ変えていない・取り消していない回を消す。消す件数と確定した日の数。〈利用者さん〉の画面の「終わらせる」）

### 名前から開く詳細（ADR-0022 追記。PRD D122〜D126・D205〜D209）

付けた所は各画面のファイル。付けない所：〈スタッフ〉のスマホ画面（見本）・比較・勤務の見込み・空き状況・月の印刷・連絡の一覧・行き先のリンク（D124）。

#### `components/DetailPopover.tsx`

- 押すと出る吹き出し（`role="dialog"`・`aria-labelledby`）。body の直下に `position: fixed` で出し、表の横スクロールで切れない
- 押したボタンは要素ではなく `anchorId` で受け、使うたびに引く
- 位置は `popoverPlace`（純粋関数）：下に入らず上のほうが広ければ上、横は画面の中へずらし、入らない高さは中を巻く。中身の高さは `scrollHeight` で取り、`maxHeight` は外さない（中を巻いた位置を保つ）。スクロール（吹き出しの中は除く）・画面の大きさで出し直す
- 開くと吹き出しへフォーカス。Esc（吹き出しの中で押したときだけ）・外を押す・Tab で外へ出る（端の Tab・フォーカスが外へ移る）・閉じるボタンで閉じ、閉じたらボタンへフォーカスを戻す（ボタンが消えていれば戻さない）。もう一度押すと閉じるのは呼ぶ側（`aria-expanded`・`aria-controls`）

#### `lib/personPopover.ts`（純粋関数。テストあり）

- `createPersonPopoverStore()` → `{ get, subscribe, toggle, close, closeIf }`
- 開いている吹き出し `OpenedPerson`＝`{ kind: 'staff' | 'client', id, anchorId }`（`anchorId`＝押したボタンの id。同じ人の名前が何か所あっても区別する）
- `toggle`：同じボタンなら閉じ、違えば入れ替える（同時に1つ）。`closeIf(anchorId)`：そのボタンで開いているときだけ閉じる。変わったときだけ知らせる

#### `components/PersonPopover.tsx`（`personPopover.css`）

- `PersonPopoverProvider`：`App` の `Routes` を包む。入れ物を1つ作り、中の `PersonPopoverHost` が開いている人の `DetailPopover`（data-testid `person-pop`、id は `${anchorId}-pop`）を1つだけ出す。開いている人がデータから消えたら閉じる
- `PersonButton`：名前そのものをボタンに。`aria-haspopup="dialog"`・`aria-expanded`・`aria-controls`・`aria-label`「〈名前〉の詳細」。data-testid 既定 `person-btn`、`data-kind`・`data-id`
- `PersonInfo`：名前の横の小さな「i」（lucide の `Info`）。data-testid 既定 `person-info`
- どちらも `useSyncExternalStore` で自分が開いているかだけを購読（開け閉めで画面を描き直さない）。消えるとき（後始末）に `closeIf` で閉じ、ボタンが残ったまま渡される人（kind・id）が変わったとき（戻るで月の右の欄の人が替わったなど）も閉じる
- 名前が空（データにいない人）のときと Provider の外では、`PersonButton` は文字だけ・`PersonInfo` は出さない（呼ぶ側は「（不明）」などの見た目を children で渡し、name は空にする）
- 名前のボタンは点線の下線。印刷では i を出さず下線を消す
- i を押しても、チップの選択・地図の絞り込み・列へ移る動き・帯とカードの選択とドラッグは起きない

#### `components/personDetail.tsx`

- 行の部品（dl の中の dt・dd）：`DlRow`・`StaffTravelRow`・`StaffTraitRows`・`StaffHoursRow`・`StaffLastDayRow`（無ければ「—」。吹き出しはあるときだけ出す）・`StaffCompatRows`（相性の件数・いつもの担当の人数）・`CondRows`（必要条件・希望）・`ClientStageRow`・`ClientAreaRow`（住所が無ければ「住所なし」、取り出せなければ「—」）・`ClientStaffRows`（担当できる人・いつもの担当）
- `StaffDetail`・`ClientDetail`：上の行を並べるだけ。`data` から開いた1人ぶんだけ引いて数える。相性の件数・いつもの担当の人数は休止中でない〈利用者さん〉で数える。リンクは `/staff/:id`・`/clients/:id`（その人の画面。PRD D308）。data-testid は既定 `person-pop-link`・`person-pop-counts`（相性の画面は `compat-pop-link`・`compat-pop-counts` を渡す）

#### 部品への付け方

- `PickChips` の `detailKind`：i はチップの右の内側の余白に重ねる（`pick-chip-wrap`。チップの右の余白を広げる）。チップの外の要素なので入れ子にならず、行の数は変わらない
- `ClientPicker` の `details`：選んだ人のチップの名前を `PersonButton` に
- `ClientName` の `detail`：名前を `PersonButton` に（訪問のカードの中では使わない）
- `DayLines` の `detailName`：渡すと行のボタンの外の右に i。返す名前が空の行には置かず、同じ幅を空ける。目盛りの行も同じ幅だけ右を空ける

### 用語の説明（PRD D173〜D177・D240〜D242・D307。ADR-0025 追記・ADR-0037）

- `lib/glossary.ts`（純粋関数。テストあり）：`GLOSSARY`（span＝出勤〜退勤（拘束）・wait＝空き時間（待ち）・seed・scoreBase＝点数の基準・dropped・hard＝守れない条件（D307 で「必須の違反」から言い換え）・travel・loadCount＝空きを数える人・freeZero・backup＝控え（バックアップ）・terms＝画面での呼び方・typeUnfit・limitUnfit・vacancyCount・vacancyEstimate、予定の組み方の言葉（D242）：aiPlan＝AI案・pinned＝ピン（D307 で「固定」から言い換え）・confirmed＝確定・unconfirmed＝未確定・confirmDiff＝未確定の変更あり・preset＝プリセット・attention＝要対応・stale＝条件が変わった、D307：score＝点数（100点満点・高いほど良い・いつも点数の基準の重みで付ける。日の予定の1行のまとめの点数に付ける）・dayWeights＝この日だけの重み（日の予定の「条件を調整する」で変えた重み。日の予定の作り直しの帯に付ける））、`glossaryText(key, terms)`（〈staff〉〈client〉を呼び方に）。表示だけで、契約・データのキー名は変えない（`evaluate` の減点の内訳の `wait` の表示名は「空き時間（待ち）」）
- 説明の文の決まり（D307）：1〜2文・90文字まで・「です・ます」で終わる。内部の言葉（費用・内訳・稼働時間・必須の違反・プリセット「・試す重み・展開・inputKey・固定・記録）を使わず、括弧の中に括弧を重ねない（`glossary.test.ts` で確かめる）。帯・確認から外した仕組みの説明（点数の付け方・この日だけの重みの効き方・条件が変わったとき）はここに寄せる
- `components/Term.tsx`（`term.css`）：
  - `Term`：用語の文字と後ろの小さな ⓘ（lucide の `Info`。`term-i`・`aria-hidden`）を1つにしたボタン。下線は付けない（D240）。読み上げの名前・`innerText` は用語の文字のまま。`aria-describedby` の先は `role="tooltip"` の説明で、閉じている間も `hidden` で文書に置く
  - フォーカスの輪はボタン全体。`pointer: coarse` では ⓘ のまわり 24px 角を押せる（`term-i::after`。WCAG 2.5.8。見た目は変えない。44px は 390px で隣の操作（選ぶ欄・凡例の開け閉め・畳んだ節）に重なった）。ⓘ は 1em。見出しのアイコンの色には引かれない。flex の中（`WithIcon`・`SectionTitle` の見出し）では文と `Term` を1つの `span` に包む（隙間で文が切れない）
  - `plain`：説明を付けず文字だけ（ボタンも ⓘ も出さない）。1画面で同じ語の2か所目から使う（D241。下の「同じ語は1か所」）
  - マウスを重ねる（`pointerType === 'mouse'`）・キーボードのフォーカス（`:focus-visible`）で出す。押すと開き、押して開いたものはもう一度押すと閉じる（マウスが上にあっても）。外を押すと閉じる。同時に1つ（開いたら `term-open` の知らせでほかを閉じる）
  - Esc で閉じる（出ているときだけ window の keydown を capture で取り、欄・吹き出しの Esc を奪わない）。説明の上へマウスを移しても消えない（150ms 待つ）
  - label の中には置かない（入力欄の名前は `id` と `aria-labelledby` でつなぐ）。押しても行・ラベルの動きを起こさない（preventDefault・stopPropagation）
  - `TipBubble`：body の直下の浮かせた説明。位置は `popoverPlace`
  - 印刷では説明も ⓘ も出さない
- 同じ語は1か所（D241）：同じ画面で同じキーの `Term` は最初の1か所だけ説明つき、ほかは `plain`。勤務の見込みは上限の設定の span・月の合計の表の wait に付け、合計の表の span と日ごとの表の span・wait は `plain`。日の予定の一覧の「ピン」は最初のピンの行だけ。開く欄（右の欄・吹き出し）は別に数える
- 用語を使う所：日の予定の確定の状態（まだ伝えていない・確定済み・未連絡の変更あり）・「ピン」の札（`tagsOf(id, pinHint)`。順番のカードは入らなかった訪問 → 列の順で最初のピンの訪問だけ、一覧は最初のピンの行だけ、時間軸の帯を押して開く説明は別に数えて説明つき）・案の無い日の「AI案」・条件が変わった帯（`stale`）・この日だけの重みを変えた帯（`dayWeights`）・条件を調整するの「プリセットごとの案」、月の予定の凡例（確定済み・未確定の変更あり）・右の欄の見出し「要対応」・まとめて作るの「使うプリセット」、条件の重みの「プリセット」の節、作り直しの帯の「条件が変わりました」、日の予定の今の案の帯（入らない・守れない条件・移動・点数）・詳しくの「空き時間（待ち）」と「点数の基準」・条件を調整するの「点数の基準」・比較の画面の「点数の基準」・勤務の見込みの表の見出しと上限の設定・条件の重みの「詳細設定」・月の「混み具合：空きを数える人」と凡例の「空き 0人」・空き状況のマスの読み方・データの「控え（バックアップ）」「画面での呼び方」。点のしくみ・点数の決め方は `Hint`

### 空の画面の次の一手（PRD D175）

- `lib/emptyGuide.ts`（純粋関数。テストあり）：
  - `periodEmptyGuide({ period, dates, today, visitDays, planDays })`（週・勤務の見込み）：案のある日があれば null。訪問があるのに案が無い：今日以降の訪問のある月ごとに［〈M月〉の案をまとめて作る］（`?do=batch`。月をまたぐ週は2つと補足の文）・［〈M/D〉の案を日の予定で作る］、過ぎた期間は日の予定だけ。訪問が無い：［〈M月〉の訪問と案を作る］・［日の予定で訪問を足す］
  - `compareEmptyGuide({ date, today, visits })`、`batchHref(ym)`
- `components/EmptyNext.tsx`：見出し・補足・ボタン（まとめて作るは `Link`、日の予定は呼ぶ側の `onOpenDay`＝選んでいる日付を変えて `/plan`）。`primary={false}` で主ボタンにしない。480px 以下は縦に並べ、印刷ではボタンを出さない。使う所：週（`week-empty`。`compact`）・勤務の見込み（`work-empty`）・比較（`compare-empty`）

### 初回の案内ツアー（PRD D192・D193・D226・D276・D277。ADR-0045）

- `lib/tour.ts`（純粋関数。テストあり）：`tourSteps(terms, features)`（3枚：home・plan・absence。見出し・本文・場所、plan は `points`（3段の説明：AI案／手直し（ピン。PRD D307）／確定）と［月｜週｜日］の切り替え。場所はメニュー・下のタブの名前（「予定」「欠勤・キャンセルを登録」・下のタブの「欠勤」）。切った機能の枚（absence）は出さない）、`TOUR_START_CHOICES`（基本・すべての名前と1行の説明）・`TOUR_START_QUESTION`（「どこまで使いますか」）・`TOUR_START_NOTE`、`tourMove(index, count, 'next'|'back'|'skip')`（閉じるときは null。最初の「戻る」は動かない）、`tourNextLabel`（最後は「閉じる」）、`TOUR_TODAY_LABEL`（「今日の予定を開く」）、`tourCountText`、`shouldAutoOpenTour(seen, search)`（`?id=`・`?do=` があれば開かない）
- 見たことは DemoData と別のキーに覚える（`tourMemory`。初期状態に戻しても残る）
- `components/Tour.tsx`（`tour.css`）：
  - `TourProvider`：`AdminShell` の外側。はじめに `shouldAutoOpenTour(tourMemory.seen(), location.search)` で開く（月の印刷の画面では出ない）。自動で開いたときに store の `startedFresh`（保存データが無く初めて開いた）なら、1枚目に「どこまで使いますか」（`StartChoice`）を出す（「案内をもう一度見る」では出さない。PRD D276）。閉じたら・最後の枚まで進んだら `tourMemory.markSeen()`。「今日の予定を開く」は閉じて `dayHref(今日)`（`/plan?date=今日`）へ移る（PRD D226）
  - `useTour()`：開く関数（データの画面の「案内をもう一度見る」`tour-again`）
  - `TourDialog`：body の直下の中央のカード `role="dialog"`・`aria-modal`・`aria-labelledby`・`aria-describedby`。`inertLock`・`useBodyScrollLock`・捕捉の段で Esc（とばすと同じ）と Tab（`trapTarget`）。Ctrl+K を開かない。最初のフォーカスは「次へ」、枚が変わってフォーカスが外れたら「次へ」へ、閉じたら開く前の要素へ。見出しと本文は `aria-live="polite"`。z-index 1250（トーストより前・確認ダイアログより後ろ）。印刷では出さない
  - 本文 `tour-body` は文と、`points` があれば番号付きの一覧 `tour-points`（aria-describedby は両方を含む）
  - `StartChoice`（1枚目の場所の下）：`fieldset.tour-choice`（`legend`「どこまで使いますか」・data-testid `tour-start`）にラジオ2つ（`tour-start-basic`・`tour-start-all`。名前と1行の説明。今の入り切りが `matchTemplate` で基本・すべてのどちらかならそれを選んだ状態）と注記「あとから「設定」の「管理者設定」で、機能を1つずつ入り切りできます。」。ネイティブのラジオ（Tab は選んでいる方だけ・矢印で選び直す。カードの Tab の閉じ込めも選んでいないラジオを飛ばす）。選んでもすぐには当てず、1枚目を離れるとき（次へ・とばす・Esc）に `TourProvider` の `choose(id)` で当てる：起動してから（または前に当ててから）データが変わっていなければ store の `reset(applyTemplate(id))`（その入り切りで初期データを作り直す。案の記録の入り切りとそろう）、変わっていれば `update` で `org.features` だけ書き換える（別のタブの変更を消さない）
  - 最後の枚：「次へ」は「閉じる」（主ボタンにしない）、その右に主ボタン「今日の予定を開く」（`tour-today`）。「とばす」は出さない。最後の枚に入るとフォーカスは「今日の予定を開く」
  - data-testid：`tour`（`data-step`）・`tour-count`・`tour-title`・`tour-body`・`tour-points`・`tour-next`・`tour-back`・`tour-skip`・`tour-today`
- e2e は文脈を作ったらすぐ `scripts/lib/tourSeen.cjs` の `skipTour(ctx)` を呼ぶ（e2e-tour は除く）。`skipTour` は既定で `scripts/lib/startFeatures.cjs` の `startAll` も呼び、初めて開いたときの入り切りを「すべて」にする（初回の「基本」を確かめるときは `skipTour(ctx, { start: 'basic' })`）

### 条件を変えたら出す作り直しの帯（廃止。ADR-0053）

- 版2で無くした（`lib/rebuildBand`・`components/rebuildBand.tsx`・`store/conditions.ts`・`scripts/e2e-rebuild.cjs` を消した）。条件を変えても今の担当は変えず、訪問ごとの検査（`lib/dayPlan` の `visitIssues`）で要対応が出る

### 行き先のリンク（`lib/links.ts`。PRD D201〜D204）

純粋関数。テストあり。切った機能なら null を返し（`linkIfOn`）、呼ぶ側はリンクを出さない。

- `UNASSIGNED_DO`（`'unassigned'`）
- `dayHref(date)`：`/plan?date=…`
- `suddenHref(date, staffId?)`：`/plan?date=…&do=absence`。人があれば `&staff=`
- `unassignedHref(date)`：`/plan?date=…&do=unassigned`
- `workloadHref(ym, staffId?)`：`/workload?ym=…&staff=…`
- `attentionTarget(a, features)`：要対応の1行の `{ to, date, note }`。入らない訪問 → `unassignedHref`、休みの人に訪問 → `suddenHref`、拘束の上限超え → `workloadHref(その日の月, staffIds[0])`、そのほか → `/plan`。note は「（〜で開く）」

使う所：月の要対応・日の予定の拘束超えの帯・勤務の見込み・勤務時間（シフト）の右の欄・空き状況の右の欄。名前の吹き出しは足さず、主ボタンも足さない。

### メールと道順のリンク（ADR-0017・ADR-0018。PRD D91〜D101）

`mailto:` で端末のメールアプリを開く（送信は人が押す）。道順は公開の Maps URLs を作るだけ（キー・サーバーなし。アプリからは送らない）。データは書き換えない。どのボタンも主ボタンにしない。

#### `lib/mailto.ts`（純粋関数）

- `normalizeEmail`：全角・空白・「mailto:」を直す。形が合わなければ null
- `mailtoHref`：宛先・件名・BCC・本文を `encodeURIComponent`。改行は %0D%0A
- `buildMail`：URL の長さが目安を超えれば要点（配列なら順に）、それでも超えれば本文なし、本文なしでも超えれば `tooLong`
- `buildBccMails`：BCC の宛先を目安に収まるよう分ける
- `mailLimitFor`：端末ごとの目安（画面の `useMailLimit` が navigator から呼ぶ）
- `uniqueRecipients`：大文字・小文字を同じとみなして重複なく

#### `lib/mail.ts`（純粋関数）

- 件名・本文。担当は `lib/monthPrint` の `printDay`（確定した割当、無ければ今の案。`PrintEntry.staffId`・`PrintOff.staffId`）
- `dayByStaff`・`dayMailText`（鍵は `includeKeys` のときだけ。〈スタッフ〉の `home`・`travelMode` があれば道順のリンクを入れ、長いときの段階を足す（design.md §5「道順のリンク」））・`dayRouteLinks`（全行程・区間ごと・帰りの道順の行）・`weekByStaff`・`weekMailText`・`contactMailText`・`vacancySubject`・`referrerRecipients`・`mailTo`・`NO_EMAIL`

#### `components/mailParts.tsx`（`mailParts.css`）

- `MailButton`：a 要素（class `btn btn-small`、href＝mailto の URL）。宛先が無ければ `aria-disabled` のボタン＋理由
- `MailLengthNote`（要点・本文なしの知らせと「本文をコピー」）・`MailRows`（担当ごとの一覧）・`MailNotice`（注記）

#### `pages/mailPanels.tsx`

- `DayMailPanel`：日の予定（[pages-plan.md](pages-plan.md)）
- `WeekMailPanel`：週の予定（[pages-week.md](pages-week.md)）

#### `lib/mapsLink.ts`（純粋関数）

- `placeParam`：座標があれば「緯度,経度」、無ければ住所の文字、無ければ null
- `directionsHref`：origin を null にすると出発地を書かない（今いる場所から）
- `dayStops`（自宅→訪問…→自宅）・`legLinks`（区間ごと）・`tripLinks`（全行程。経由地の上限・URL の長さで分ける）
- `MAPS_TRAVEL_MODE`・`MAPS_MOBILE_WAYPOINTS`（3。既定）・`MAPS_MAX_WAYPOINTS`（9）・`MAPS_URL_LIMIT`（2048）・`BICYCLE_NOTE`

#### `components/mapsLinks.tsx`

- `MapsLink`：a 要素。class `btn btn-small`・`target="_blank" rel="noopener noreferrer"`・title に「Google マップが新しいタブで開きます…」。href が無ければ出さない
- `VisitRouteLinks`：「自宅から」／「前の場所から」と「ここへ道案内」。訪問先の場所が無ければ「場所が未登録のため、道順のリンクはありません」

### 確かめ（画面横断の e2e）

コマンドと環境変数は AGENTS.md。

- `scripts/e2e-mobile.cjs`（390×844）：上の帯・引き出しの開閉と Esc・外・画面を選ぶ・フォーカスの戻りと閉じ込め・裏を巻かない・下のタブの active と比較・本文の最後が隠れない・浮いている部品と重ならない（同じクラスの箱を置いて確かめ、本物の地図のボタンが出ればそれも）・印刷・1400px で左のメニューと上の帯 72px。今の画面の項目・タブで URL のクエリが残る、`aria-controls`・`aria-haspopup`・inert・h2、本物の地図のボタンと開いた地図、開いたまま広い画面へ戻す、右の欄と引き出しが重なったときのロック。`fabWithToast`（本物の地図ボタンと本物のトースト・本文の下・safe-area）。下のタブは5つ
- `scripts/e2e-dialog.cjs`：条件を消す（ARIA・中央・最初のフォーカス・Tab が回る・Esc・取り消す・背景で変わらない・閉じたらボタンへフォーカス・inert とロックを戻す・確定（キーボード）で消える）／初期状態に戻す（取り消すと知らせなし・確定で知らせ）／この割当で確定（Esc で未確定のまま・確定で「確定済み」）／確認中に「戻る」（確認が閉じデータが変わらない）／ダブルクリックでも確認が残る／〈スタッフ〉の変更を捨てる（右の欄の上で Esc は確認だけを閉じる・「捨てて閉じる」で保存しない）／選択肢を消す／390px で収まりボタンが縦・印刷で出さない。どれもネイティブのダイアログが出たら失敗
- `scripts/e2e-nav.cjs`：メニューの並び・名前・aria-current・見出し・欠勤・キャンセルの項目、Ctrl+K で開く・ARIA・inert・↑↓ が回る・Enter で移る・見つからない・Ctrl+K で閉じる・操作（欠勤・まとめて作る）・右の欄の上では開かない、よみ（カタカナ）で〈利用者さん〉・名前で〈スタッフ〉の画面、Tab が回る・Esc・背景・×でフォーカスがボタンへ・入力欄の中の Ctrl+K・今の画面は閉じるだけ、390px（「探す」が1段目・パレットが収まる・上の帯の名前（人・利用者さん一覧・予定は項目名だけ）・引き出しの並び・下のタブ5つ・比較は「今日」のタブ・「今日」のタブでほかの日から今日の日の予定へ・日の予定の上でも今日を選び直す（履歴を増やさない））、印刷、300人×60人で1文字の中央値 `PERF_MS_NAV`（既定 100ms）
- `scripts/e2e-panel-foot.cjs`（1400px・390px）：欠勤・キャンセルの1〜4段目・キャンセルの2・3段目・訪問の詳細の欄（〈利用者さん〉の画面の予定の回から）・月の「まとめて作る」・日の差の欄の「連絡の一覧」。短い欄（広い画面は欄の高さが内容に合い、上に寄り、画面の下端まで伸びない）・長い欄・Tab で帯の裏の入力欄が隠れない・Tab が回る・Esc で戻る・裏を巻かない・390px の並び・タブに隠れない・safe-area・visualViewport を差し替えたキーボード・印刷で帯を出さない
- `scripts/e2e-tour.cjs`：ツアー（初めて開くと出る・ARIA・中央・フォーカス・inert とロック・Tab が回る・Ctrl+K を開かない・次へ／戻る・3枚・予定の枚の3段・初めて開くと「基本」で1枚目に「どこまで使いますか」・「すべて」を選ぶとメニューと入り切りが変わり「条件が変わった」にならない・もう一度見るでは聞かない・「閉じる」・「今日の予定を開く」で今日の日の予定・覚える（別のキー）・読み直しても出ない・Esc・とばす・月の印刷では出ない・`?id=`・`?do=` のリンクでは出ない・印があれば自動で出ない・最後の枚で覚える・もう一度見る・フォーカスを戻す・初期状態に戻しても残る・390px・印刷）、ファイル選択、月の一覧
- `scripts/e2e-words.cjs`：点数の理由・用語の説明（マウス・Tab・Esc・タッチ・同時に1つ・入力欄の名前）・言い換え・空の画面・月の凡例・相性のセルの記号・390px・印刷
- `scripts/e2e-links.cjs`：行き先のリンク（月の要対応の4種類・`?do=unassigned`・勤務の見込み・勤務時間（シフト）・空き状況）
- `scripts/e2e-features.cjs`：機能の入り切り（ひな形ごとのメニュー・下のタブ・パレット・ホーム・画面の中の入口・切った URL・390px・印刷）

