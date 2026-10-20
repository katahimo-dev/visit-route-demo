# 画面共通の部品

> この部品のファイル：`src/components/ui.tsx`・`FieldError.tsx`・`usePanelFoot.ts`・`floating.ts`・`MapDock.tsx`・`Toast.tsx`・`DetailPopover.tsx`・`PersonPopover.tsx`・`personDetail.tsx`・`Term.tsx`・`EmptyNext.tsx`・`Tour.tsx`・`rebuildBand.tsx`・`mailParts.tsx`・`mapsLinks.tsx`、`src/pages/mailPanels.tsx`、`src/lib/panelFit.ts`・`personPopover.ts`・`glossary.ts`・`emptyGuide.ts`・`tour.ts`・`rebuildBand.ts`・`links.ts`・`mailto.ts`・`mail.ts`・`mapsLink.ts`。関連 ADR：0017・0018・0022 追記・0025 追記・0031・0037。関連 PRD：D91〜D101・D122〜D126・D161〜D166・D173〜D177・D193〜D197・D201〜D209・D226・D240〜D242・D250〜D252。
> 画面全体の決まり・メニュー・確認ダイアログ・機能の入り切りは [pages.md](pages.md)。

### 右の欄（`SidePanel`）と確定のボタンの帯（PRD D194〜D197）

#### `components/ui.tsx` の `SidePanel`

- 右から出る欄（`narrow` あり）。z-index 1100。フォーカス：開いたら最初の入力欄（`focusPanel`）、Tab が中で回る、閉じたら戻す（`returnFocus` で戻り先を差し替えられる）。`useBodyScrollLock`
- 裏の inert（PRD D252）：開いたとき body の直下のほかの子（`#root`・メニューの引き出し）を `inertLock`（要素ごとに数えるロック。確認ダイアログ・パレット・ツアーと同じ）で inert にし、閉じるときは inert を外してから戻り先へフォーカスする。`data-inert-keep` の付いた子（知らせの置き場 `.toast-layer`）は外す。後から body の直下に出るもの（確認ダイアログ・用語の説明）はロックの外。名前の詳細（`DetailPopover`）は欄の中に出る。欄の上に欄を重ねたら下の欄も inert（数えるので閉じる順にかかわらず戻る）
- `onSubmit`（PRD D251）：渡すと `.drawer-body` を `<form noValidate>` にし（無ければ `div`）、内容と帯を包む。帯の保存は `type="submit"`。送信は `submitHandler`（下の「フォームの共通の決まり」）。閲覧 ⇄ 編集で `form` ⇄ `div` が入れ替わるので、`usePanelFoot` に要素の種類（`bodyKind`）を渡して見張り直す。使う欄：〈利用者さん〉・〈スタッフ〉の編集、種類、仮押さえ、欠勤・キャンセルの2段目（「次へ」）。中に `<form>` を持つ欄（条件の調整のプリセット）には渡さない
- `headActions`：見出しの右・× の前（`drawer-head-actions`）
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
- `components/Toast.tsx`：z-index 1200。body の直下の `div.toast-layer[data-inert-keep]` に出す（右の欄の inert に巻き込まれず、欄が開いていても読み上げ・「元に戻す」を押せる。確認ダイアログ・パレット・ツアーの間は今までどおり inert）。`toast(msg)` は文だけ（`output.toast`・2.5秒・押しても下へ抜ける）。`toast(msg, { action })` はボタン1つ付き（`.toast.has-action`。文は中の `output`・ボタンだけ押せる・6秒・フォーカスがある間は消さない）。今は日の予定の手直しの「元に戻す」だけ（[pages-plan.md](pages-plan.md)。PRD D218）

### フォームの共通の決まり（PRD D250・D251。`components/FieldError.tsx`）

- `FieldError`（`id`・`as`＝`p`（既定）／`span`・`className`・`style`・`testId`）：文があれば `.error` に `role="alert"` で出し、無ければ（null・false・空）何も出さない。見た目は今までの `.error` のまま。入力の誤り・保存や計算の失敗の文はどれもこれで出す（ページ本体・コード分割中のファイル（`PlanPage.tsx`・`RulesPage.tsx`・`planParts.tsx`・`App.tsx`）は `role="alert"` を足しただけ）。`.error` のクラスでも誤りの文でないもの（振り直しの「対応が必要」の見出し・点数の赤字）はそのまま
- `invalidAttrs(invalid, errorId)`：誤りなら `aria-invalid="true"`・`aria-describedby`（誤りの文の id）を返す。文の id は `useId`
- `FormErr`（`{ text, field? }`）・`toFormErr(e)`：契約の検査（zod）の誤りは最初の `path` を `field` に（`lib/common.ts` の `formErrorField`）。画面は `error?.field === 'name'` などで欄に印を付ける
- `RequiredMark`：見出しの横の小さな「必須」の札（`.req-mark`。`aria-hidden`）。入力欄には `required` を付け（フォームは `noValidate` なのでブラウザの吹き出しは出ない）、読み上げに必須と伝える。付けた欄：訪問（日付・〈利用者さん〉・開始時刻・最も遅い開始時刻・所要）、〈利用者さん〉の表示名、〈スタッフ〉の名前、種類の名前・標準の所要、仮押さえの表示名
- `submitHandler(save)`：`<form onSubmit>` 用。既定の送信を止めて `save` を呼び（Promise も待つ）、次の描画で form の中の最初の `[aria-invalid="true"]` へフォーカス（保存できて閉じた form は何もしない）。Enter の暗黙の送信で保存し、`textarea` は改行のまま
- `enterToSave(save)`：大きな form の中の小さなまとまり（〈利用者さん〉の欄の定期パターン・休みの `fieldset`）の `onKeyDown`。入力欄の Enter（変換中は除く）を外の form に渡さず、まとまりの保存を呼ぶ
- form にした所：訪問の入力（`VisitForm`。開いたら最初の欄へ・日を変えても引き継ぐ）、右の欄の `onSubmit`、呼び方（データの画面）。もともと form：項目の選択肢、プリセットの名前

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
- `StaffDetail`・`ClientDetail`：上の行を並べるだけ。`data` から開いた1人ぶんだけ引いて数える。相性の件数・いつもの担当の人数は休止中でない〈利用者さん〉で数える。リンクは `/staff?id=`・`/clients?id=`（閲覧の欄が開く）。data-testid は既定 `person-pop-link`・`person-pop-counts`（相性の画面は `compat-pop-link`・`compat-pop-counts` を渡す）

#### 部品への付け方

- `PickChips` の `detailKind`：i はチップの右の内側の余白に重ねる（`pick-chip-wrap`。チップの右の余白を広げる）。チップの外の要素なので入れ子にならず、行の数は変わらない
- `ClientPicker` の `details`：選んだ人のチップの名前を `PersonButton` に
- `ClientName` の `detail`：名前を `PersonButton` に（訪問のカードの中では使わない）
- `DayLines` の `detailName`：渡すと行のボタンの外の右に i。返す名前が空の行には置かず、同じ幅を空ける。目盛りの行も同じ幅だけ右を空ける

### 用語の説明（PRD D173〜D177・D240〜D242。ADR-0025 追記・ADR-0037）

- `lib/glossary.ts`（純粋関数。テストあり）：`GLOSSARY`（span＝出勤〜退勤（拘束）・wait＝空き時間（待ち）・seed・scoreBase＝点数の基準・dropped・hard・travel・loadCount＝空きを数える人・freeZero・backup＝控え（バックアップ）・terms＝画面での呼び方・typeUnfit・limitUnfit・vacancyCount・vacancyEstimate、予定の組み方の言葉（D242）：aiPlan＝AI案・pinned＝固定・confirmed＝確定・unconfirmed＝未確定・confirmDiff＝未確定の変更あり・preset＝プリセット・attention＝要対応・stale＝条件が変わった）、`glossaryText(key, terms)`（〈staff〉〈client〉を呼び方に）。表示だけで、契約・データのキー名は変えない（`evaluate` の減点の内訳の `wait` の表示名は「空き時間（待ち）」）
- `components/Term.tsx`（`term.css`）：
  - `Term`：用語の文字と後ろの小さな ⓘ（lucide の `Info`。`term-i`・`aria-hidden`）を1つにしたボタン。下線は付けない（D240）。読み上げの名前・`innerText` は用語の文字のまま。`aria-describedby` の先は `role="tooltip"` の説明で、閉じている間も `hidden` で文書に置く
  - フォーカスの輪はボタン全体。`pointer: coarse` では ⓘ のまわり 24px 角を押せる（`term-i::after`。WCAG 2.5.8。見た目は変えない。44px は 390px で隣の操作（選ぶ欄・凡例の開け閉め・畳んだ節）に重なった）。ⓘ は 1em。見出しのアイコンの色には引かれない。flex の中（`WithIcon`・`SectionTitle` の見出し）では文と `Term` を1つの `span` に包む（隙間で文が切れない）
  - `plain`：説明を付けず文字だけ（ボタンも ⓘ も出さない）。1画面で同じ語の2か所目から使う（D241。下の「同じ語は1か所」）
  - マウスを重ねる（`pointerType === 'mouse'`）・キーボードのフォーカス（`:focus-visible`）で出す。押すと開き、押して開いたものはもう一度押すと閉じる（マウスが上にあっても）。外を押すと閉じる。同時に1つ（開いたら `term-open` の知らせでほかを閉じる）
  - Esc で閉じる（出ているときだけ window の keydown を capture で取り、欄・吹き出しの Esc を奪わない）。説明の上へマウスを移しても消えない（150ms 待つ）
  - label の中には置かない（入力欄の名前は `id` と `aria-labelledby` でつなぐ）。押しても行・ラベルの動きを起こさない（preventDefault・stopPropagation）
  - `TipBubble`：body の直下の浮かせた説明。位置は `popoverPlace`
  - 印刷では説明も ⓘ も出さない
- 同じ語は1か所（D241）：同じ画面で同じキーの `Term` は最初の1か所だけ説明つき、ほかは `plain`。勤務の見込みは上限の設定の span・月の合計の表の wait に付け、合計の表の span と日ごとの表の span・wait は `plain`。日の予定の一覧の「固定」は最初の固定の行だけ。開く欄（右の欄・吹き出し）は別に数える
- 用語を使う所：日の予定の確定の状態（確定済み・未確定・未確定の変更あり）・「固定」の札（`tagsOf(id, pinHint)`。順番のカードは入らなかった訪問 → 列の順で最初の固定の訪問だけ、一覧は最初の固定の行だけ、時間軸の帯を押して開く説明は別に数えて説明つき）・案の無い日の「AI案」・条件が変わった帯（2つ）・条件を調整するの「プリセットごとの案」、月の予定の凡例（確定済み・未確定の変更あり）・右の欄の見出し「要対応」・まとめて作るの「使うプリセット」、条件の重みの「プリセット」の節、作り直しの帯の「条件が変わりました」、日の予定の今の案の帯（入らない・必須の違反・移動）・詳しくの「空き時間（待ち）」と「点数の基準」・条件を調整するの「点数の基準」・比較の画面の「点数の基準」・勤務の見込みの表の見出しと上限の設定・条件の重みの「詳細設定」・月の「混み具合：空きを数える人」と凡例の「空き 0人」・空き状況のマスの読み方・データの「控え（バックアップ）」「画面での呼び方」。点のしくみ・点数の決め方は `Hint`

### 空の画面の次の一手（PRD D175）

- `lib/emptyGuide.ts`（純粋関数。テストあり）：
  - `periodEmptyGuide({ period, dates, today, visitDays, planDays })`（週・勤務の見込み）：案のある日があれば null。訪問があるのに案が無い：今日以降の訪問のある月ごとに［〈M月〉の案をまとめて作る］（`?do=batch`。月をまたぐ週は2つと補足の文）・［〈M/D〉の案を日の予定で作る］、過ぎた期間は日の予定だけ。訪問が無い：［〈M月〉の訪問と案を作る］・［日の予定で訪問を足す］
  - `compareEmptyGuide({ date, today, visits })`、`batchHref(ym)`
- `components/EmptyNext.tsx`：見出し・補足・ボタン（まとめて作るは `Link`、日の予定は呼ぶ側の `onOpenDay`＝選んでいる日付を変えて `/plan`）。`primary={false}` で主ボタンにしない。480px 以下は縦に並べ、印刷ではボタンを出さない。使う所：週（`week-empty`。`compact`）・勤務の見込み（`work-empty`）・比較（`compare-empty`）

### 初回の案内ツアー（PRD D192・D193・D226）

- `lib/tour.ts`（純粋関数。テストあり）：`tourSteps(terms, isMac)`（6枚：home・plan・absence・rules・search・flow。見出し・本文・場所、flow は `points`（3段の説明：AI案／手直し（固定）／確定）。切った機能の枚は出さない。flow はいつも最後）、`tourMove(index, count, 'next'|'back'|'skip')`（閉じるときは null。最初の「戻る」は動かない）、`tourNextLabel`（最後は「閉じる」）、`TOUR_TODAY_LABEL`（「今日の予定を開く」）、`tourCountText`、`shouldAutoOpenTour(seen, search)`（`?id=`・`?do=` があれば開かない）
- 見たことは DemoData と別のキーに覚える（`tourMemory`。初期状態に戻しても残る）
- `components/Tour.tsx`（`tour.css`）：
  - `TourProvider`：`AdminShell` の外側。はじめに `shouldAutoOpenTour(tourMemory.seen(), location.search)` で開く（月の印刷の画面では出ない）。閉じたら・最後の枚まで進んだら `tourMemory.markSeen()`。「今日の予定を開く」は閉じて `dayHref(今日)`（`/plan?date=今日`）へ移る（PRD D226）
  - `useTour()`：開く関数（データの画面の「案内をもう一度見る」`tour-again`）
  - `TourDialog`：body の直下の中央のカード `role="dialog"`・`aria-modal`・`aria-labelledby`・`aria-describedby`。`inertLock`・`useBodyScrollLock`・捕捉の段で Esc（とばすと同じ）と Tab（`trapTarget`）。Ctrl+K を開かない。最初のフォーカスは「次へ」、枚が変わってフォーカスが外れたら「次へ」へ、閉じたら開く前の要素へ。見出しと本文は `aria-live="polite"`。z-index 1250（トーストより前・確認ダイアログより後ろ）。印刷では出さない
  - 本文 `tour-body` は文と、`points` があれば番号付きの一覧 `tour-points`（aria-describedby は両方を含む）
  - 最後の枚：「次へ」は「閉じる」（主ボタンにしない）、その右に主ボタン「今日の予定を開く」（`tour-today`）。「とばす」は出さない。最後の枚に入るとフォーカスは「今日の予定を開く」
  - data-testid：`tour`（`data-step`）・`tour-count`・`tour-title`・`tour-body`・`tour-points`・`tour-next`・`tour-back`・`tour-skip`・`tour-today`
- e2e は文脈を作ったらすぐ `scripts/lib/tourSeen.cjs` の `skipTour(ctx)` を呼ぶ（e2e-tour は除く）

### 条件を変えたら出す作り直しの帯（ADR-0025 追記。PRD D161〜D166）

「条件が変わった」の判定（`lib/month` の `ruleSetKey`・`currentRuleKeys`・`rulesStale`、`useDayStatuses` の `withRules`）は [pages-home.md](pages-home.md) の `useDayStatuses` と [pages-month.md](pages-month.md)。

- `lib/rebuildBand.ts`（純粋関数。テストあり）：
  - `REBUILD_PATHS`（`/rules`・`/compat`・`/availability`・`/types`・`/items`・`/staff`・`/clients`）・`showsRebuildBand(pathname)`
  - `rebuildDays(aiPlans, today)`・`rebuildSummary(statuses, today, manualPlans)`（`days`・`unconfirmed`（確定した割当なし）・`confirmed`（あり））・`rebuildText`（「影響する日 N日（未確定 a日・確定済み b日）」）・`REBUILD_CLEARED`（「影響する日は無くなりました」）・`rebuildWith(basis)`（「〈基準〉で作り直します」）
  - `rebuildAction(summary, basis)`（`href`・`label`・`note`）：未確定の最初の日の月の `/month?ym=…&do=stale`「作り直す」、未確定が無ければ最初の日の月の `do=attention`「要対応を見る」
  - `customRulesText(basis)`（この日だけ試す重みの案内。PRD D166・D234）・`recreateTodayHref(today)`（`/plan?date=今日&do=recreate`）
- `components/rebuildBand.tsx`（`rebuildBand.css`）：`RebuildBand({ rules })`
  - データが `SETTLE_MS`＝600ms 変わらなくなってから `useDeferredValue` で描いた後に数える（動かしている間は数えない）。最初に数え終わるまでは影響する日の行を出さない
  - 帯は `section` の中に行 `rb-row` を2つまで：
    1. 影響する日：文・未確定があれば `rebuildWith`・［作り直す］は `Link`（主ボタンにしない。説明は title と aria-describedby）・［後で］
    2. `rules`（`/rules` のとき）でこの日だけ試す重み（`data.rules`）がどのプリセットとも違うときの案内：`customRulesText`・［今日の案を試す重みで作り直す］・`SavePresetForm`（試す重みを保存）。条件の重みの表を動かしても試す重みは基準にそろうので出ない（ADR-0035）
  - ［後で］は状態 `later`（保存しない。その画面の間だけ隠し、ほかの設定の画面では出る。押したらフォーカスを `.app-main h1` へ）
  - 読み上げは `progressBand` の `BandLive`（`data-ready`・`data-days` など付き。0日になったら1度 `REBUILD_CLEARED`、隠している間は空）
  - 861px 以上は `position: sticky; top: var(--header-h)`。その間は ResizeObserver で `--rebuild-band-h` と html の `scroll-padding-top` を入れ、消えたら戻す（Tab で入った入力欄が帯に隠れない）。600px 以下は文の下にボタン。印刷では出さない
- `app/App.tsx`：main の `Guarded` の中、`Outlet` の前に `showsRebuildBand(pathname)` のときだけ（key は pathname）。月の予定には出さず要対応に残る
- 影響する日の数は月の要対応の「条件が変わった」と同じ

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
- `scripts/e2e-nav.cjs`：メニューの並び・名前・aria-current・見出し・欠勤・キャンセルの項目、Ctrl+K で開く・ARIA・inert・↑↓ が回る・Enter で移る・見つからない・Ctrl+K で閉じる・操作（欠勤・まとめて作る）・右の欄の上では開かない、よみ（カタカナ）で〈利用者さん〉・名前で〈スタッフ〉の閲覧の欄、Tab が回る・Esc・背景・×でフォーカスがボタンへ・入力欄の中の Ctrl+K・今の画面は閉じるだけ、390px（「探す」が1段目・パレットが収まる・上の帯の名前（人・利用者さん一覧・予定は項目名だけ）・引き出しの並び・下のタブ5つ・比較は「今日」のタブ・「今日」のタブでほかの日から今日の日の予定へ・日の予定の上でも今日を選び直す（履歴を増やさない））、印刷、300人×60人で1文字の中央値 `PERF_MS_NAV`（既定 100ms）
- `scripts/e2e-panel-foot.cjs`（1400px・390px）：欠勤・キャンセルの1〜4段目・キャンセルの2・3段目・〈スタッフ〉の閲覧と編集・月の「まとめて作る」・日の差の欄の「連絡の一覧」。短い欄・長い欄・Tab で帯の裏の入力欄が隠れない・Tab が回る・Esc で戻る・裏を巻かない・390px の並び・タブに隠れない・safe-area・visualViewport を差し替えたキーボード・印刷で帯を出さない
- `scripts/e2e-tour.cjs`：ツアー（初めて開くと出る・ARIA・中央・フォーカス・inert とロック・Tab が回る・Ctrl+K を開かない・次へ／戻る・6枚・最後の枚の3段・「閉じる」・「今日の予定を開く」で今日の日の予定・覚える（別のキー）・読み直しても出ない・Esc・とばす・月の印刷では出ない・`?id=`・`?do=` のリンクでは出ない・印があれば自動で出ない・最後の枚で覚える・もう一度見る・フォーカスを戻す・初期状態に戻しても残る・390px・印刷）、ファイル選択、月の一覧
- `scripts/e2e-words.cjs`：点数の理由・用語の説明（マウス・Tab・Esc・タッチ・同時に1つ・入力欄の名前）・言い換え・空の画面・月の凡例・相性のセルの記号・390px・印刷
- `scripts/e2e-rebuild.cjs`：作り直しの帯（出さない条件・案内・影響する日・数・読み上げ・［後で］・sticky・Tab・月の要対応と同じ数・［作り直す］で月の欄・［今日の案を試す重みで作り直す］で日の予定）
- `scripts/e2e-links.cjs`：行き先のリンク（月の要対応の4種類・`?do=unassigned`・勤務の見込み・勤務時間（シフト）・空き状況）
- `scripts/e2e-features.cjs`：機能の入り切り（ひな形ごとのメニュー・下のタブ・パレット・ホーム・画面の中の入口・切った URL・390px・印刷）

