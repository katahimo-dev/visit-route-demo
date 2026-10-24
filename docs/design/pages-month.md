# 月の予定と月の印刷

> この画面のファイル：`src/pages/MonthPage.tsx`（`month.css`）・`MonthPrintPage.tsx`（`monthPrint.css`）、`src/lib/month.ts`・`monthList.ts`・`monthGuide.ts`・`monthPrint.ts`・`requestedOff.ts`・`useDayStatuses.ts`・`confirmDay.ts`、`src/components/visitParts.tsx`（マスの選ぶ・その日の回の一覧の行・ドラッグ）・`scheduleParts.tsx`（選択の帯の「別の日へ」）。関連 ADR：0012（追記を含む）・0013・0014・0015・0025 追記・0031・0032・0042・0056・0057。関連 PRD：D36〜D44・D53〜D55・D65・D69・D70・D151〜D155・D161〜D166・D176・D189〜D192・D201〜D204・D223・D228・D256・D257・D313・D339〜D343。
> 3段のバー・混み具合の塗りは [pages-bars.md](pages-bars.md)、進み具合の帯は [pages-home.md](pages-home.md)、帯の印・選ぶ・キー・1行1訪問の行 `VisitRow`・ドラッグの落とし先の判定の共通の部品は [pages-common.md](pages-common.md) の「訪問の札の共通の部品」。
> 版2（ADR-0053）：担当は訪問に持ち、日の状態は「まだ伝えていない／確定済み／未連絡の変更あり」、要対応は訪問ごとの検査。「案なし・案あり・未作成・条件が変わった・欠勤あり（対応済み）」は無い

### 月の予定（`#/month`）

#### URL とクエリ

| クエリ | 意味 |
|---|---|
| `?ym=2026-11` | 月。無ければ選んでいる日の月 |
| `?staff=`・`?client=` | 表示の選択（1人）。URL に残す |
| `?layout=calendar|list` | 見せ方。押したら必ず書く。無ければ狭い画面（`(max-width: 600px)`）は一覧、ほかはカレンダー |
| `?do=attention|unconfirmed|stale` | 1回だけ行い URL から消す（replace）。下の「`?do=`」。古い `?do=batch` は担当を組むの画面（`/arrange?ym=`）へ移す |

#### 並び

1. 見出し：`lead`「一月の担当を見て、担当なしや要対応を手で直し、確定します」。すぐ下にナビの行（`ScheduleNav`。PRD D347）：「今日」・‹ 月を選ぶ欄（`month-title`）›・［月｜週｜日］
2. 進み具合の帯 `ProgressBand`（見出しの下。予定の3画面で月だけ。PRD D332。次の一手は主ボタン、`onOp` で要対応・確定していない日は画面の中の右の欄を開き、「担当を AI で組む」は担当を組むの画面 `/arrange?ym=` へ移る。ADR-0063）
3. 操作の行（`ScheduleToolbar zoom="month"`。日・週・月で同じ並び。PRD D327。「AI で組む ▾」は無い。ADR-0063。[pages-common.md](pages-common.md) の「予定の共通の部品」）：欠勤・キャンセルを登録（`sudden-open`。選んでいる日（今日より前なら今日）の日の予定で欄を開くリンク）・元に戻す・やり直す・見せ方の切り替え `month-layout`（`fieldset.segmented`・`aria-label="月の見せ方"`・`aria-pressed`・ボタンの `data-layout`。印刷では出さない）・「その他 ▾」（`MenuButton`・`month-more`）
4. 範囲の提案の帯（`RangeProposalBand`。担当を組むの画面で組んだ提案）
5. 操作の欄 `month-head`（PRD D278。ADR-0045）：
   - 操作の行の「その他 ▾」の項目：「表示を選ぶ（〈スタッフ〉・〈利用者さん〉・混み具合）」（`month-more-pickers`。開いていれば「表示の選択をたたむ」、選んでいる間・休みの入力中は押せず理由「表示を「全体」・混み具合を「すべて」に戻すと、たためます」）・「印刷」（`month-print`。選んでいる〈スタッフ〉があれば `&staff=`。`monthPrint` が入のとき）・「勤務の見込み」（`month-workload`。`/workload?ym=`。`workload` が入のとき）・「マスの見方の説明」（`month-more-help`。開いていれば「…を閉じる」）。印刷・勤務の見込みには1行の説明
   - 要約 `month-summary`：「月全体：入らない N件（・当日キャンセル N件）」（月全体。今日より前の日も数える。帯と同じ言葉の「訪問」「案のある日」は出さない）
   - 表示の選択の段 `month-pickers`（「表示を選ぶ」で開くか、〈スタッフ〉・〈利用者さん〉・混み具合を選んでいる間・休みの入力中に出す。「表示を選ぶ」で開いたら `month-focus` へフォーカス。段の中で選び直したら（全体に戻しても）出したまま。保存しない）：
     - 表示の選択 `month-focus`（「表示」：全体／〈スタッフ〉（optgroup）／〈利用者さん〉（名前・よみで探す））。〈利用者さん〉なら `ClientPicker`（1人。`month-client-picker`。近道：この月・〈スタッフ〉が担当する人・最近選んだ人・仮押さえの人（`tentativeShortcut`））
     - 〈スタッフ〉を選んでいれば「休みを入れる」（`month-off-toggle`。下の「希望休」）
     - 全体なら「混み具合：」と `Term`（`loadCount`）と選ぶ欄 `month-load-type`（数える人：すべて／〈種類〉。名前は aria-labelledby でつなぐ）
   - 訪問の無い月は「定期パターンが無いか、この月の訪問がありません」の1行
   - マスの見方の説明 `month-help`（「マスの見方の説明」で開き、フォーカスを移す。マスを押すとその日の訪問を右の欄（スマホは下から出る欄）に出し、もう一度押すと日の予定・右の欄の行の押し方と「別の日へ」・マスの色と印・赤い枠と「要対応 N」の札の「要対応」・黄の点線の「注意」・混み具合のバー。「説明を閉じる」）
   - 凡例 `MonthLegend`（今の場所のまま。下の「凡例」）
5. 本体：カレンダー（`month-grid`）か日ごとの一覧（`month-list`）
6. 右の欄 `month-aside`：その日の回の一覧（マスを押した日。先頭）・要対応・確定していない日、選んだ人の集計
7. 選択の帯 `SelectionBar`（`moveDay`。画面の下）と、キーで動かした先の読み上げ・範囲の帯 `KeyMoveBand`

#### 日の計算（`useDayStatuses`）

- 日ごとの compile と採点は点数の基準の条件で行い、日付・`compileInput`・その日の訪問で覚える（8人・約17件／日の一月で 500ms 以内）
- `DayStatus`（`lib/month` の `dayStatus`）＝`{ date, count, state, unassigned, issues, care, changes, absence, overSpan, needsCare }`。`issues` は `lib/dayPlan` の `visitIssues`（訪問 ID → 要対応）、`told` は伝えた内容との違い（`toldChanges` の結果。訪問ごとの未連絡の変更の印 `lib/visitLook` の元。伝えていない日は null）、`state` は `toldStateOf`、`changes` は未連絡の変更の件数、`overSpan` は拘束が上限を超える人
- 数える割当は その日の訪問の担当（`dayPlanOf`＝`dayRoutes`）

#### カレンダー（日のマス `DayCell`。PRD D53）

- 日曜はじまりの6週×7日の表（`calendarWeeks`）。今日より前の日は薄く。今日は「今日」の印
- マスはボタン（`month-cell-btn`・data-testid `month-day`・`data-date`）。押すとその日の回の一覧を右の欄に出し（`pickDay`。右の欄に出している日のマスは `is-listed`）、出している日をもう一度押すとその日を選んで `#/plan` へ（「休みを入れる」のときは `toggleOff`）。キー・まとめて選ぶ・ドラッグの落とし先は下の「マスを押す・キー・その日の回の一覧」
- 状態は背景・枠と印で（点数は出さない）：

| 状態 | 見た目 |
|---|---|
| まだ伝えていない（`is-state-none`） | 白 |
| 確定済み（`is-state-told`） | 濃い緑＋鍵（`month-lock`） |
| 未連絡の変更あり（`is-state-changed`） | 淡い黄＋鉛筆 |
| 要対応（要対応の訪問がある日。`needsCare`、今日以降。`is-care`） | 赤い太枠＋日付の横の赤い札「要対応 N」（`month-attn`。N は右の欄の行の数） |

- 読み上げ（`aria-label`）に状態の文字を入れる。ボタンに `title` は付けず、`data-tip="cell"` で読み方の吹き出し（下）
- 中身（全体の表示）：
  - 件数（取り消し・休みの訪問を除く。`month-count`）
  - 種類ごとの件数の積み上げバー（種類の色。`title` に内訳）
  - 印 `month-marks`（`lib/month` の `dayMarks`）：「休 N」（勤務の無い人＋希望休の人。同じ月の同じ曜日の最頻値＝ふだんより多い日だけ出す。希望休のある日は常に出す。過去の日にも同じ決め方を使う。決め方は `lib/monthRest` の `usualRestByWeekday`・`showRestMark`。読み上げ・吹き出しの文には人数を残す。PRD D295。希望休がいれば紫。title「休む〈スタッフ〉 N人（内訳）」）・「欠 名前」（希望休でない欠勤だけ。title に名前。`month-absent`。欠勤の手当てが済んだ日（確定済みで手当ての要らない日）は「（済）」を足し `data-done`、地の色（赤くしない）、title・読み上げに「（対応済み）」。PRD D281）・その日に始まる（▶）・終わる（■）定期パターンのある〈利用者さん〉・〈利用者さん〉の休み（ベッドのアイコンと、1人なら名前の頭・2人以上なら人数。title・読み上げに名前。`dayMarks.leaves`）・「最終 名前」（最終勤務日。title「最終勤務日（翌日から勤務なし）：…」）
  - 旗 `month-flags`：「担当なし N」（赤。`month-unassigned`）・ほかの要対応の内訳（担当が休み N・条件に合わない N・間に合わない N。赤。`month-issue`）・「未連絡 N」（黄。`month-changed`）・「拘束超 N」（`month-over-span`）
  - 混み具合バー `month-load`（`LoadBar`）
- 始まる・終わるの印の決め方：始まるは基準日（`baseDate`＝データの最初の日）より後に始まり、前日にその〈利用者さん〉のどのパターンの期間でもないもの。終わるは翌日にその〈利用者さん〉のどのパターンの期間でもないもの（初期データの全パターンが基準日に始まるのと、「以降すべて」で分けたパターンの継ぎ目を印にしない）

#### マスを押す・キー・その日の回の一覧・まとめて選ぶ・別の日へ（PRD D339〜D343。ADR-0056・ADR-0057）

- マスは「その日のまとめ」のまま（上の中身。訪問の札は描かない）。訪問を描くのは右の欄（スマホは下から出る欄）に出した1日の分だけ
- 押す（`pickDay`。カレンダーのマスと日ごとの一覧の行で同じ）：1回目はその日を右の欄の先頭の「その日の回の一覧」に出す（フォーカスはマスのまま。押したマス・行に `is-listed`）。右の欄に出している日をもう一度押すと `openDay`（その日を選んで日の予定）。マスの吹き出しの文の後ろは「（押すとこの日の訪問を右の欄に出します。もう一度押すと「日の予定」）」、出している日は「（もう一度押すとこの日の「日の予定」を開きます）」。「休みを入れる」の間は今どおり `toggleOff`
- マスは日を選ぶ単位（訪問ではない）。マスにフォーカスして `cellKeyOf`（`lib/visitKeys`。[pages-common.md](pages-common.md)）：←→ 前・次の日、↑↓ 前・次の週（月の外へ出たらその月へ `goMonth` してフォーカスを移す）、Enter でその日の回の一覧（`openList`。一覧の最初の行へフォーカス、行が無ければ見出し）、Shift／Ctrl＋Enter・Shift／Ctrl＋クリックでその日の選べる訪問をまとめて選ぶ・外す（`toggleGroup`。全部選んでいれば外す）。マスのボタンに `aria-keyshortcuts`。「休みを入れる」の間の Enter は一覧を開かない（一覧を開かず `toggleOff`）
- 選ぶのは `useVisitSelection(ym)`（月を送ったら外す）。選べる訪問は `canSelectVisit`（今日より前・取り消し・休みは選ばない）。表示の選択が〈スタッフ〉・〈利用者さん〉ならその人の回だけ（`dayItems`）。選んだ日のマスに「選択 N」（`month-selected`・マスに `data-selected`・`aria-label` に「選択中 N件」）。選んだ訪問は画面の下の `SelectionBar`（担当を替える・時刻をずらす・別の日へ・取り消す・選択を外す。`dates` は月のマスの日。`moveDay`）
- その日の回の一覧（`DayVisits`・`section.month-day-visits`・data-testid `month-day-visits`・`data-date`）：右の欄（`month-aside`）の先頭。見出し「M月D日（曜）の訪問 N件」・閉じる（`month-day-visits-close`。Esc でも閉じ、フォーカスはマスへ戻る。選んでいる訪問があれば Esc は先に選択を外す）・行（共通の `VisitRow`＝中の札。data-testid `month-visit`・`data-size="m"`。開始の順）・説明「行を押すと訪問の詳細。Shift・Ctrl＋クリックで選び、↑↓ で15分・←→ で1日動かせます。行を別の日のマスへドラッグするか、選んで下の「別の日へ」で日付を移せます（時刻はそのまま）」・「この日の日の予定を開く」（`month-day-visits-plan`）。Enter で開いたとき〈利用者さん〉を選んでいてその日の回が1つなら、一覧でなくその回の訪問の詳細の欄（閉じたらフォーカスはマス）。訪問が無い日は「この日の訪問はありません。」。月を送って別の月の日になったら閉じる
- 一覧の行：押す・Enter で訪問の詳細の欄、Shift・Ctrl＋クリック／Shift・Ctrl＋Enter で選ぶ・外す、キーで動かす（日の予定と同じ ↑↓ 15分・←→ 1日・Shift+←→ 隣の担当・Delete 取り消し。[pages-common.md](pages-common.md) の「訪問の帯をキーで動かす」。月の外へ動いたらその月へ移って一覧もその日にし、フォーカスは動かした行）。印は共通の判定（`useVisitLooks`。`data-marks`）
- ドラッグ（広い画面）：一覧の行を別の日のマスへ（時刻はそのまま・日付だけ）。落とし先の判定・影は共通（`useVisitDrag`・`dropVerdict`。今日より前の日・取り消し・休みは灰の斜線と理由、入れる人が0人は赤い点線）。影はマスの中（`month-drop`・マスに `is-drop-ok|warn|ng`）。落とすと落とした日を入れた訪問の詳細の欄（範囲・確定した日の確かめは欄）。マスの訪問そのものはつかめない
- 別の日へ（`SelectionBar` の `moveDay`。広い画面だけ）：［別の日へ］（`selection-move`・`aria-expanded`）を押すと日付の欄（`selection-move-date`。`input type="date"`・既定と最小は今日。Esc で閉じフォーカスは［別の日へ］）と［移す］（`selection-move-go`。日付が無い・今日より前なら押せない）。押すと `lib/multiEdit` の `moveManyToDate` の結果で、確定（伝えた）した日（移す前の日・移す先の日。`toldDaysChanged`）が変わるなら独自の確認「確定した日の訪問も変えますか？」（本文に日付。訪問の詳細の欄・キーと同じ文）。1回の update（手の名前「M/D（曜）へ移しました」）で書き、知らせは「N件のM/D（曜）へ移しました」（できなかった訪問は理由：同じ日・今日より前の日など）。移したら選択を外す
- スマホ（600px 以下。`MONTH_LIST_QUERY`）：マス・日ごとの一覧の行を押す・Enter で下から出る欄（`SidePanel` の `sheet`。見出し「M月D日（曜）の訪問 N件」・中身 `month-day-sheet`（`data-date`））。中は「選ぶ」（`month-select`。`SelectToggle`）と「長押しでも選べます」・その日の訪問の行（`VisitRow`・`month-visit`。押すと欄を閉じて訪問の詳細の欄（閉じるとフォーカスはマス・行）・長押しか「選ぶ」の間は押すと選ぶ・外す。キー・ドラッグは無い）・欄の中の選択の帯（`SelectionBar` の `inline`：担当を替える・取り消す・選択を外す。時刻をずらす・別の日へは出さない）・下に「この日の日の予定を開く」（`month-day-visits-plan`）。欄が開いている間は画面の下の選択の帯を出さない。月を送ると閉じる。見る・取り消す・担当替えまで（ADR-0051 の決定5）

#### 表示の選択（PRD D55）

数えるのはその日の今の案（無ければ確定した割当）。純粋関数 `lib/month` の `staffDay`・`clientDay`・`staffMonth`・`clientMonth`・`attentionList`（テストあり）。

- 〈スタッフ〉を選んだとき：
  - マスは短い文字（休・欠勤・欠勤あり・希望休（紫）・最終勤務日の後のときだけ。`month-shift`）＋3段バー（`StaffDay.bar`。案の無い日は勤務内を「案なし」。`month-staff-noplan`）。勤務の無い日の頭の「休」は `isAllRest` のとき `sr-only`（欠勤・希望休・最終勤務日の後の文字は理由なので残す）
  - 件数・目安・移動・勤務時間は `aria-label`・title に残す
  - 見出しの凡例はその人の状態の凡例（`month-staff-bar-note`）
  - 右の欄の集計 `month-staff-sum`：最終勤務日（`month-staff-lastday`）・「希望休 N日」「欠勤 N日」（`absenceDays` は希望休を除く）など
- 〈利用者さん〉を選んだとき：
  - マスに訪問ごとの時刻・種類の色の点・担当（`month-cvisits`。「代」＝いつもの担当でない・「変」＝この回だけ変更・当日キャンセル）。休みの訪問は薄く「休み」
  - 右の欄は見出しの名前と、〈利用者さん〉の画面の予定（その月の月の見せ方）へのリンク「〈名前〉の予定（M月）を開く」（`month-client-open`。`/clients/:id?cal=month&d=YYYY-MM-01`）だけ。回・集計・休みは人の画面で見て直す（PRD D313。ADR-0052）
- 右の欄の見出しの名前は `PersonButton`

#### マスの読み方の吹き出し（PRD D176。カレンダーのときだけ）

- `lib/monthGuide.ts`（純粋関数。テストあり）：`cellGuide(input)`＝そのマスに出ている印だけの読み方の行（背景の色（まだ伝えていない・確定済み・未連絡の変更あり）・赤い点・赤い枠（要対応）・「要対応 N」の札（`attention`）・件数・種類の帯・休 N（希 N。`restShown` が偽なら書かない）・欠・▶■・ベッド・最終・担当なし（`unassigned`）・ほかの要対応（`issues`）・未連絡（`changed`）・拘束超・3段の棒（`barRowsText()`）・〈スタッフ〉／〈利用者さん〉の表示の棒・代・変）。`createTipStore`
- 描いたあと（`useLayoutEffect`）に日付をキーに文（日付・状態の文・読み方の行）を置き場に置く。吹き出しは `useSyncExternalStore` で日付から引く（描画中に DOM を読まない）
- `MonthCellTip`：表の要素に1回だけ `pointerover`・`pointerout`・`focusin`・`focusout` を付ける。マウスは 300ms 止まったら出し、出ていれば隣のマスへすぐ移す。離れて 120ms で消す。キーボードは `:focus-visible` のときだけで、キーボードで出しているあいだはマウスの出入りを見ない（止まったマウスの上で表が描き直されると、動かしていなくても出入りが起きる）。出しているマスは日付で持ち、描き直しでマスの要素が替わっても閉じない（置く先は日付でいまのマスを引く）。Esc で消す。フォーカスが外れると消える。吹き出しはマウスを受けない（`.is-passive`）。タッチでは出さない

#### 凡例（`MonthLegend`）

- `details`（`month-legend-fold`）。閉じているときは「凡例を見る」（`month-legend-toggle`）と1行の要約（`month-legend-line`。狭い画面は省略記号）、開くと中身（`MonthLegendBody`・`month-legend`）。はじめ畳み、開いたかどうかは保存しない（読み直すと畳む）。印刷では「凡例を見る」を出さない
- 1行の要約：「色＝日の状態・赤い枠と「要対応 N」の札＝要対応・▶■＝始まる／終わる」
- 中身：状態の見本（まだ伝えていない・確定済み・未連絡の変更あり。後の2つは `Term`）・「要対応（担当なし・担当が休み・条件に合わない・時間に間に合わない）」・「要対応 N」の札・混み具合（「空き 0人」は `Term`）・`staffSlots` と `dayLoad` の数え方の一言

#### 日ごとの一覧（PRD D189〜D192）

- `lib/monthList.ts`（純粋関数。テストあり）：`MonthLayout`（`calendar`・`list`）・`MONTH_LIST_QUERY`（`(max-width: 600px)`）・`monthLayoutOf(param, narrow)`・`monthListFocusDate`・`DAY_STATE_TEXT`（まだ伝えていない・確定済み・未連絡の変更あり）・`monthListRow`（日付・件数・状態の文・要対応 `care`・旗）
- 今月の一覧の上に「今日へ」（`month-list-today`）
- 一覧 `month-list`（`ul`）。開いたとき `monthListFocusDate` の行へ巻く。行は `scroll-margin` で上の帯・下のタブを避ける
- 行は `button.month-list-btn`（data-testid `month-list-day`・`data-date`・`data-state`・`data-off`）。押すとマスと同じ（`pickDay`：右の欄（スマホは下から出る欄）にその日の回の一覧・右の欄に出している日はもう一度で日の予定。出している行は `is-listed`。「休みを入れる」のときは `toggleOff`・押せない日は `aria-disabled`）
- 表示の選択が〈スタッフ〉なら勤務の状態と担当の件数、〈利用者さん〉なら訪問の時刻と担当、休みを入れるときはその日の扱いを行の下に出す
- 390px で土曜も見え、はみ出さない
- スマホの基本は日の予定の日ごとのリスト（PRD D334・D338）。月の日ごとの一覧は数をまとめて見る表示で、行を押すとその日の訪問を下から出る欄に出す（上の「マスを押す・キー・…」のスマホ。キーは読まない）。600px 以下の操作の行は1段で、見せ方の切り替え（`month-layout`）はアイコンだけ（名前は読み上げ）

#### 右の欄（要対応・確定していない日）

- 確定していない日（`progress.unconfirmed`＝今日以降の訪問があって確定済みでない日）：
  - 上に「問題の無い日をまとめて確定（N日）」（`month-confirm-bulk`・`data-count`。PRD D223。主ボタンにしない（月の主ボタンは帯の次の一手））。確定していない日が0日なら出さない
  - 対象は `lib/confirmDay` の `bulkConfirmTargets(unconfirmed, statusOf, attention)`（日の状態は `useDayStatuses` のもの）：まだ伝えていない日で、要対応の訪問が無く（`care` が0）、要対応（第3引数の `attentionList`。未連絡の変更は除く）に出ない日。残すのは問題のある日（`problem`）・未連絡の変更のある日（`changed`。日の予定の連絡の一覧で確かめて確定し直す）
  - 0日なら押せず、下に理由 `month-confirm-why`（aria-describedby。`bulkConfirmWhy`：問題のある日がある／未連絡の変更のある日がある／確定していない日は無い）。あれば下に対象の決まりの1行（`month-confirm-note`）。組んでいる間（担当を AI で組む）は押せない。印刷では出さない
  - 押すと独自の確認（`bulkConfirmDialog`）：見出し「問題の無い N日を確定しますか？」、本文に日付（`datesText`：「10/22（水）・10/23（木）… 計 N日」。7日を超えたら先頭6日と「…」）・担当が書き換わる旨・「問題のある M日は残します（要対応で確認）：日付」・「前に確定した割当と違う M日も残します（日の予定で確定し直します）。」・「案の無い M日も残します。」、ボタン「N日を確定する」
  - 確定すると1回の `update` で、日ごとに `confirmDay(d, date, problem)`（日の予定の「この割当で確定」と同じ書き方。問題は日の状態を数えたときのもの）。確認のあいだに案が消えた日は飛ばす。知らせ「N日を確定しました」。フォーカスは右の欄へ（ボタンは0日になって押せなくなる）
- 確定していない日の一覧 `month-unconfirmed`：行は `openDay`（その日の「日の予定」）
- 要対応 `month-attention`（`attentionList`。`AttentionKind`＝`'care' | 'changed' | 'overSpan'`）：要対応の訪問のある日（「要対応 N件（担当なし…）」）・未連絡の変更のある日・出勤〜退勤（拘束）が上限を超える日。今日以降。欠勤があってもその人に訪問が無ければ出さない
- 要対応の行は `attentionTarget` の行き先へ（`openTarget`＝選んでいる日付をその日にしてから `navigate(to)`）。行は1つのボタンのまま、2つ目の span の下に `.month-attention-go`（行き先の文「（〜で開く）」）。`data-to` に行き先
- `Attention` の `staffIds?`（overSpan のときだけ。拘束が上限を超える人の id。`names` と同じ順）

#### `?do=`（1回だけ。行ったら URL から消す）

| `?do=` | 動き |
|---|---|
| `batch`（古いリンク） | 担当を組むの画面のその月（`/arrange?ym=`。replace）へ移す |
| `attention`・`unconfirmed` | 全体の表示にして右の欄へ移りフォーカス |

#### 担当を組んでいる間（PRD D256。ADR-0042・ADR-0063）

担当を AI で組むのは担当を組むの画面（[pages-arrange.md](pages-arrange.md)）。月の予定には組み始める入口は無く、組んでいる間（`monthBatch.run` が null でない間）だけ次を出す。

- 操作の欄の下に進み具合（`month-progress`。「11/14：5/22日（組めた日 N日）」と［止める］）。上の帯の `BatchBand` は月の予定では出さない
- 組んでいる日のマスに「組んでいます…」（`is-making`。表示している月の日だけ）
- この画面のほかの書き込み（まとめて確定・希望休）は押せない
- 組んで出た範囲の提案は帯（`RangeProposalBand`）で反映・捨てる。計算できずに止まった理由は操作の欄に出す

#### 希望休（PRD D69。ADR-0014）

- 〈スタッフ〉を選ぶと見出しの選択の横に通常のボタン「休みを入れる」（`month-off-toggle`・`aria-pressed`。押すと「休みの入力を終わる」）。`requestedOff` が入のとき
- 入れているあいだ、上に説明の帯 `month-off-bar`（「〈名前〉さんの休みを入れる：勤務日のマスを押すと…」・この月の希望休 N日・最後の操作の結果 `month-off-note`（`aria-live`。訪問のある日に入れたら注意と「〈日〉の予定を開く」））
- 日のマスは押すと日の予定へ移らず `lib/requestedOff` の `toggleRequestedOff`（1回の `update`）
- マスの扱いは `offDayState`：入れられる日は紫の点線の枠、希望休の日は紫の斜線（`aria-pressed`）、今日より前・勤務なし・ほかの欠勤は `disabled`（灰の枠。title と読み上げに理由）
- 〈スタッフ〉の選びを外すと終わる。組んでいる間（担当を AI で組む）は押せない
- 訪問のある日に入れても担当は変わらない（担当が休みの訪問として要対応に出る）。希望休のまとめ入力を切っても要対応の印は出る

#### `lib/month.ts`（画面の純粋関数。テストあり）

- `monthDates(ym)`・`calendarWeeks(ym)`（日曜はじまりの6週。前後の月を含む）・`ymOf`・`addMonths`・`firstDayOf`
- `activeVisitsOn`：件数（訪問・種類ごと）・状態は取り消し・休みの訪問を数えない（訪問は `visitsOn`）
- `dayStatus(data, date, view)`：`DayStatus`（上）。`needsCare`＝要対応の訪問がある
- `batchTargets(data, dates, today, mode, statusOf)`：今日以降・伝えていない（`state` が none）日のうち、`'care'` なら要対応の訪問がある日、`'all'` なら訪問のある日すべて
- `dayPlanOf`・`dayMarks`・`staffDay`・`staffMonth`・`clientDay`・`clientMonth`・`issueBreakdown`・`attentionList`（`care`・`changed`・`overSpan`）
- `monthProgress(data, ym, today, statusOf)`：その月の今日以降について 訪問の件数・担当が全部入った日/訪問のある日・確定した日/訪問のある日・要対応の件数・確定していない日

#### `lib/requestedOff.ts`（純粋関数。テストあり）

`REQUESTED_OFF_NOTE`・`isRequestedOff`・`offDayState(data, staffId, date, today)`・`toggleRequestedOff(d, staffId, date, today, newId)`・`requestedOffDates(data, staffId, ym)`・`absentLeftIds(problem, routes, staffId?)`（最終勤務日の後の人に残る訪問も含む）・`absentLeftOf`（件数）

### 月の印刷（`#/month/print?ym=&staff=`。PRD D70）

- `pages/MonthPrintPage.tsx`：`AdminShell` の外（ルートの例外は `Guarded`）。ツアーは出ない
- 上の操作の帯（`.no-print` で印刷しない）：月の予定に戻る・前後の月・〈スタッフ〉の選択（全員／1人）・主ボタン「印刷する」＝`window.print()`
- 見出し：「2026年11月の予定（〈名前〉さん）」・事業所名・凡例・印刷日
- 日曜はじまりの週の表（その月の日が無い週は出さない）。マスは 日付・「確」／「案」・件数、行ごとに 種類の色の点・時刻・〈利用者さん〉・担当の名字（絞ったときは出さない。担当なしは「未定」）、下に「休：山田(希)・佐藤(欠)・鈴木」と「〈利用者さん〉休：…」
- CSS（`pages/monthPrint.css`）：`@page monthprint { size: A4 landscape; margin: 7mm }`・`.mprint { page: monthprint }`、週の行は `break-inside: avoid`、文字は 7.5pt
- `lib/monthPrint.ts`（純粋関数。テストあり）：`printDay(data, date, staffId, inMonth?)`（その日の訪問の担当。`PrintDay.pending`＝担当の決まっていない訪問の件数、`PrintDay.off`、`PrintEntry.staffLabel`・`staffId`、`PrintOff.label`・`staffId`。メールも使う）・`monthPrint(data, ym, staffId)`・`staffLabels(staff)`（名字。重なる人はフルネーム）

### 完了の条件

- [ ] 進み具合の帯の「担当を AI で組む」で担当を組むの画面（その月）へ移る。古い `?do=batch` も同じ。担当を組むで組んでいる間は月の予定に進み具合と［止める］が出て、提案の帯で反映できる（`scripts/e2e-progress.cjs`）
- [ ] 日のマスを押すとその日の訪問が右の欄に出て、もう一度押すとその日の「日の予定」が開き、組んだ担当が出ている
- [ ] （ADR-0014）〈スタッフ〉を選び「休みを入れる」で勤務日のマスを続けて押すと希望休が付き、もう一度押すと外れる。勤務の無い日・今日より前の日は押せない。訪問のある日に入れると注意とリンクが出て、担当が休みの訪問として要対応に出る（担当は変わらない）。全体の表示の「休 N」に数が入る
- [ ] （ADR-0014）「印刷」で `#/month/print` が開き、A4横の1か月の表（〈スタッフ〉で絞れる）が出る。印刷（PDF）にナビ・操作の帯は出ず、週の途中で改ページしない
- [ ] （ADR-0015）最終勤務日に「最終」、後の日のその人の訪問は担当が休みの要対応。上限を超える日に「拘束超」・要対応
- [ ] 要対応の行き先（担当なしの訪問のある日 → 日の予定の担当なしの列・拘束の上限超え → 勤務の見込みのその月・その人・そのほか → 日の予定）（`scripts/e2e-links.cjs`）
- [ ] 390px ははじめ日ごとの一覧（今日の行が画面に入る・「今日へ」）・`?layout=`・1400px ははじめカレンダー・月の印刷は変わらない（`scripts/e2e-tour.cjs`）
- [ ] 凡例ははじめ畳む・マスに title を出さない・マウスを重ねる／キーボードでマスの読み方（`scripts/e2e-words.cjs`）
- [ ] （D223）初期データの月で「問題の無い日をまとめて確定（N日）」を押すと確認に日付が並び、確定するとその日が確定済み・ホームの確定していない日が N日減る。担当が休みの訪問のある日は対象から外れ、確認に日付が出る。未連絡の変更のある日は外れ、そのまま残る（`scripts/e2e-home.cjs`）
- [ ] （ADR-0056）月のカレンダーのマスで ←→ 日・↑↓ 週・Enter でその日の回の一覧（右の欄の先頭。〈利用者さん〉でその日が1回なら欄）・Shift＋Enter でその日をまとめて選ぶ（マスに「選択 N」・下に選んだ訪問の帯）。一覧の行を押すと欄・↓ で15分後へ・ほかの日のマスへドラッグ（今日より前の日は影と理由で落とせない）（`scripts/e2e-shared-parts.cjs`）
- [ ] （ADR-0057）マスを1回押すと右の欄にその日の行・2回で日の予定、マスの Enter で一覧の最初の行へフォーカス、行を別の日のマスへ落とすと落とした日の欄、2件選んで「別の日へ」で日付を選び［移す］と2件の日付が変わり（時刻・担当はそのまま）Ctrl+Z で1手戻る、確定した日なら確認。390px はマス・一覧の行を押すと下から出る欄（選ぶ・担当を替える・取り消す。「別の日へ」と時刻をずらすは無い）（`scripts/e2e-chip-containers.cjs`）
- [ ] `lib/multiEdit`（`moveManyToDate`）のテストが通る
- [ ] `lib/month`（月の日付・6週・対象の日の2つの mode・状態・overSpan の `staffIds`）・`lib/monthList`・`lib/monthGuide`・`lib/requestedOff`・`lib/monthPrint`・`lib/confirmDay` のテストが通る
