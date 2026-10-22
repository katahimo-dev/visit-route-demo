# 月の予定と月の印刷

> この画面のファイル：`src/pages/MonthPage.tsx`（`month.css`）・`MonthPrintPage.tsx`（`monthPrint.css`）・`ClientLeavesSection.tsx`、`src/lib/month.ts`・`monthList.ts`・`monthGuide.ts`・`monthPrint.ts`・`requestedOff.ts`・`useDayStatuses.ts`・`confirmDay.ts`・`monthBatch.ts`（計算の入れ物）、`src/components/batchBand.tsx`（上の帯の進み具合）。関連 ADR：0012（追記を含む）・0013・0014・0015・0025 追記・0031・0032・0042。関連 PRD：D36〜D44・D53〜D55・D65・D69・D70・D151〜D155・D161〜D166・D176・D189〜D192・D201〜D204・D223・D228・D256・D257。
> 3段のバー・混み具合の塗りは [pages-bars.md](pages-bars.md)、進み具合の帯は [pages-home.md](pages-home.md)。

### 月の予定（`#/month`）

#### URL とクエリ

| クエリ | 意味 |
|---|---|
| `?ym=2026-11` | 月。無ければ選んでいる日の月 |
| `?staff=`・`?client=` | 表示の選択（1人）。URL に残す |
| `?layout=calendar|list` | 見せ方。押したら必ず書く。無ければ狭い画面（`(max-width: 600px)`）は一覧、ほかはカレンダー |
| `?do=batch|attention|unconfirmed|stale` | 1回だけ行い URL から消す（replace）。下の「`?do=`」 |

#### 並び

1. 見出し：［月｜週｜日］・`lead`「定期パターンから訪問を作り、一月分の案をまとめて作ります」
2. 進み具合の帯 `ProgressBand`（見出しの下。次の一手は主ボタン、`onOp` で欄を画面の中で開く。「まとめて作る」の入口は帯の1か所）
3. 見せ方の切り替え `month-layout`（`fieldset.segmented`・`aria-label="月の見せ方"`・`aria-pressed`・ボタンの `data-layout`）。印刷では出さない
4. 操作の欄 `month-head`（PRD D278。ADR-0045）：
   - 月の送り（「前の月」「次の月」の `icon-btn`）・見出し `month-title`・「今月」（今月なら押せない）・「その他 ▾」（`MenuButton`・`month-more`）。作っている間は月を送れない
   - 「その他 ▾」の項目：「表示を選ぶ（〈スタッフ〉・〈利用者さん〉・混み具合）」（`month-more-pickers`。開いていれば「表示の選択をたたむ」、選んでいる間・休みの入力中は押せず理由「表示を「全体」・混み具合を「すべて」に戻すと、たためます」）・「印刷」（`month-print`。選んでいる〈スタッフ〉があれば `&staff=`。`monthPrint` が入のとき）・「勤務の見込み」（`month-workload`。`/workload?ym=`。`workload` が入のとき）・「条件が変わった日を作り直す（N日）」（`month-stale`。0日・作っている間は押せず理由）・「マスの見方の説明」（`month-more-help`。開いていれば「…を閉じる」）。印刷・勤務の見込みには1行の説明
   - 要約 `month-summary`：「月全体：入らない N件（・当日キャンセル N件）」（月全体。今日より前の日も数える。帯と同じ言葉の「訪問」「案のある日」は出さない）
   - 表示の選択の段 `month-pickers`（「表示を選ぶ」で開くか、〈スタッフ〉・〈利用者さん〉・混み具合を選んでいる間・休みの入力中に出す。「表示を選ぶ」で開いたら `month-focus` へフォーカス。段の中で選び直したら（全体に戻しても）出したまま。保存しない）：
     - 表示の選択 `month-focus`（「表示」：全体／〈スタッフ〉（optgroup）／〈利用者さん〉（名前・よみで探す））。〈利用者さん〉なら `ClientPicker`（1人。`month-client-picker`。近道：この月・〈スタッフ〉が担当する人・最近選んだ人・仮押さえの人（`tentativeShortcut`））
     - 〈スタッフ〉を選んでいれば「休みを入れる」（`month-off-toggle`。下の「希望休」）
     - 全体なら「混み具合：」と `Term`（`loadCount`）と選ぶ欄 `month-load-type`（数える人：すべて／〈種類〉。名前は aria-labelledby でつなぐ）
   - 訪問の無い月は「定期パターンが無いか、この月の訪問がありません」の1行
   - マスの見方の説明 `month-help`（「マスの見方の説明」で開き、フォーカスを移す。マスを押すと日の予定・マスの色と印・赤い枠と「要対応 N」の札の「要対応」・黄の点線の「注意」・混み具合のバー。「説明を閉じる」）
   - 凡例 `MonthLegend`（今の場所のまま。下の「凡例」）
5. 本体：カレンダー（`month-grid`）か日ごとの一覧（`month-list`）
6. 右の欄 `month-aside`：要対応・確定していない日、選んだ人の集計

#### 日の計算（`useDayStatuses`）

- 日ごとの compile と採点は点数の基準の条件で行い、日付・`compileInput`・案で覚える（8人・約17件／日の一月で 500ms 以内）
- 拘束が上限を超える人（`DayView.overSpan`）・欠勤の人に残る訪問（`DayView.absentLeft`。`absentLeftOf` で数えて渡す）・条件が変わった（`rulesStale`・`planStale`）も同じ覚えの中で数える。memo は CompileInput のキーで比べる
- 数える案は その日の今の案、無ければ確定した割当（`dayPlanOf`）

#### カレンダー（日のマス `DayCell`。PRD D53）

- 日曜はじまりの6週×7日の表（`calendarWeeks`）。今日より前の日は薄く。今日は「今日」の印
- マスはボタン（`month-cell-btn`・data-testid `month-day`）。押すとその日を選んで `#/plan` へ（「休みを入れる」のときは `toggleOff`）
- 状態は背景・枠と印で（点数は出さない）：

| 状態 | 見た目 |
|---|---|
| 案なし | 白・点線 |
| 案あり（未確定） | 淡い緑 |
| 確定済み | 濃い緑＋鍵（`month-lock`） |
| 未確定の変更あり | 淡い黄＋鉛筆（`month-diff-mark`） |
| 注意（今日以降で訪問があるのに案なし。`is-caution`） | 黄の細い点線の枠（注意の色。赤にしない。PRD D228）。読み上げ「注意：まだ案が無い」 |
| 要対応（入らない訪問・必須の違反・休みの人に訪問。`dayStatus` の `needsCare`、今日以降。`is-care`） | 赤い太枠＋日付の横の赤い札「要対応 N」（`month-attn`。N は右の欄の行の数＝`lib/monthRest` の `attentionCountByDate(attentionList)`。今日以降。日ごとの一覧にも同じ札。必須の違反も要対応の行（`kind: 'hard'`「必須の違反 N件」、日の予定へ）なので、赤い枠の日にはいつも札が出る。赤い点 `month-dot` は札が無いときの控えで、ふだんは出ない）。色だけに頼らず文字も出す。赤は要対応だけ（PRD D228・D295） |
| 未作成（訪問の無い今日以降の日で、定期パターンからまだ作っていない訪問がある。PRD D282） | 白のまま、右上に点線の枠の「未作成」（`month-unmade`。件数の代わり）。ボタンに `data-unmade`（件数。`data-state` は `empty` のまま）。読み上げ「未作成（定期パターンからまだ作っていない訪問 N件）」。注意の色にしない。訪問があって一部だけ未作成の日は印 `month-marks` に点線の「ほか未作成」（`month-unmade-part`・ボタンに `data-unmade-part`・読み上げ「ほかに…N件」） |

- 読み上げ（`aria-label`）に状態の文字を入れる。ボタンに `title` は付けず、`data-tip="cell"` で読み方の吹き出し（下）
- 中身（全体の表示）：
  - 件数（取り消し・休みの訪問を除く。`month-count`）
  - 種類ごとの件数の積み上げバー（種類の色。`title` に内訳）
  - 印 `month-marks`（`lib/month` の `dayMarks`）：「休 N」（勤務の無い人＋希望休の人。同じ月の同じ曜日の最頻値＝ふだんより多い日だけ出す。希望休のある日は常に出す。過去の日にも同じ決め方を使う。決め方は `lib/monthRest` の `usualRestByWeekday`・`showRestMark`。読み上げ・吹き出しの文には人数を残す。PRD D295。希望休がいれば紫。title「休む〈スタッフ〉 N人（内訳）」）・「欠 名前」（希望休でない欠勤だけ。title に名前。`month-absent`。欠勤の手当てが済んだ日（確定済みで手当ての要らない日）は「（済）」を足し `data-done`、地の色（赤くしない）、title・読み上げに「（対応済み）」。PRD D281）・その日に始まる（▶）・終わる（■）定期パターンのある〈利用者さん〉・〈利用者さん〉の休み（ベッドのアイコンと、1人なら名前の頭・2人以上なら人数。title・読み上げに名前。`dayMarks.leaves`）・「最終 名前」（最終勤務日。title「最終勤務日（翌日から勤務なし）：…」）
  - 旗 `month-flags`：入らない N件・守れない条件 N件・「休みの人に N」（赤。`month-absent-left`）・「条件が変わった」（`month-stale`）・「拘束超 N」（`month-over-span`）
  - 混み具合バー `month-load`（`LoadBar`。案の無い日は出さない）
- 始まる・終わるの印の決め方：始まるは基準日（`baseDate`＝データの最初の日）より後に始まり、前日にその〈利用者さん〉のどのパターンの期間でもないもの。終わるは翌日にその〈利用者さん〉のどのパターンの期間でもないもの（初期データの全パターンが基準日に始まるのと、「以降すべて」で分けたパターンの継ぎ目を印にしない）

#### 表示の選択（PRD D55）

数えるのはその日の今の案（無ければ確定した割当）。純粋関数 `lib/month` の `staffDay`・`clientDay`・`staffMonth`・`clientMonth`・`attentionList`（テストあり）。

- 〈スタッフ〉を選んだとき：
  - マスは短い文字（休・欠勤・欠勤あり・希望休（紫）・最終勤務日の後のときだけ。`month-shift`）＋3段バー（`StaffDay.bar`。案の無い日は勤務内を「案なし」。`month-staff-noplan`）。勤務の無い日の頭の「休」は `isAllRest` のとき `sr-only`（欠勤・希望休・最終勤務日の後の文字は理由なので残す）
  - 件数・目安・移動・勤務時間は `aria-label`・title に残す
  - 見出しの凡例はその人の状態の凡例（`month-staff-bar-note`）
  - 右の欄の集計 `month-staff-sum`：最終勤務日（`month-staff-lastday`）・「希望休 N日」「欠勤 N日」（`absenceDays` は希望休を除く）など
- 〈利用者さん〉を選んだとき：
  - マスに訪問ごとの時刻・種類の色の点・担当（`month-cvisits`。「代」＝いつもの担当でない・「変」＝この回だけ変更・当日キャンセル）。休みの訪問は薄く「休み」
  - 右の欄の集計 `month-client-sum`：回数・「休みのため無し N回」・「うち当日キャンセル」（`month-client-sameday`）・`ClientDots`（`clientDay`）・「担当した人」（`PersonButton`）・休み（`ClientLeavesSection`）
- 右の欄の見出しの名前は `PersonButton`

#### マスの読み方の吹き出し（PRD D176。カレンダーのときだけ）

- `lib/monthGuide.ts`（純粋関数。テストあり）：`cellGuide(input)`＝そのマスに出ている印だけの読み方の行（背景の色・未作成（`unmade`）・赤い点・赤い枠（要対応）・「要対応 N」の札（`attention`）・黄の点線（注意。`caution`）・件数・種類の帯・休 N（希 N。`restShown` が偽なら書かない）・欠・▶■・ベッド・最終・入らない・違反・休みの人に・条件が変わった・拘束超・3段の棒（`barRowsText()`）・〈スタッフ〉／〈利用者さん〉の表示の棒・代・変）。`createTipStore`
- 描いたあと（`useLayoutEffect`）に日付をキーに文（日付・状態の文・読み方の行）を置き場に置く。吹き出しは `useSyncExternalStore` で日付から引く（描画中に DOM を読まない）
- `MonthCellTip`：表の要素に1回だけ `pointerover`・`pointerout`・`focusin`・`focusout` を付ける。マウスは 300ms 止まったら出し、出ていれば隣のマスへすぐ移す。離れて 120ms で消す。キーボードは `:focus-visible` のときだけで、キーボードで出しているあいだはマウスの出入りを見ない（止まったマウスの上で表が描き直されると、動かしていなくても出入りが起きる）。出しているマスは日付で持ち、描き直しでマスの要素が替わっても閉じない（置く先は日付でいまのマスを引く）。Esc で消す。フォーカスが外れると消える。吹き出しはマウスを受けない（`.is-passive`）。タッチでは出さない

#### 凡例（`MonthLegend`）

- `details`（`month-legend-fold`）。閉じているときは「凡例を見る」（`month-legend-toggle`）と1行の要約（`month-legend-line`。狭い画面は省略記号）、開くと中身（`MonthLegendBody`・`month-legend`）。はじめ畳み、開いたかどうかは保存しない（読み直すと畳む）。印刷では「凡例を見る」を出さない
- 1行の要約：「色＝日の状態・黄の点線＝案なし（注意）・赤い枠と「要対応 N」の札＝要対応・▶■＝始まる／終わる」
- 中身：状態の見本（「確定済み」「未確定の変更あり」は `Term`（PRD D242）。「注意（今日以降で案なし）」「要対応（入らない・違反・休みの人に訪問）」を含む）・混み具合（「空き 0人」は `Term`）・`staffSlots` と `dayLoad` の数え方の一言（今の案と確定が違う日はそろえない）

#### 日ごとの一覧（PRD D189〜D192）

- `lib/monthList.ts`（純粋関数。テストあり）：`MonthLayout`（`calendar`・`list`）・`MONTH_LIST_QUERY`（`(max-width: 600px)`）・`monthLayoutOf(param, narrow)`・`monthListFocusDate(ym, date, today, hasTarget)`（今月で行き先が無いとき最初に巻く日。選んでいる日が今月ならその日、無ければ今日）・`DAY_STATE_TEXT`・`monthListRow(status, today, extra, { unmade, absenceDone })`（`dayText`・`weekday`・`state`（訪問が無ければ `empty`）・`stateText`（訪問の無い今日以降の未作成の日は「未作成」。PRD D282）・`unmade`・`care`（今日以降の要対応）・`caution`（今日以降で訪問があり案なし。注意）・`flags`（入らない・必須の違反・休みの人に訪問・条件が変わった・拘束超。赤／注意。欠勤の手当てが済んだ日は「欠勤あり（対応済み）」、訪問があって一部だけ未作成の日は「ほか未作成 N件」を情報 `info`（地の色）。PRD D281・D282）・`label`（読み上げ））
- 今月の一覧の上に「今日へ」（`month-list-today`）
- 一覧 `month-list`（`ul`）。開いたとき `monthListFocusDate` の行へ巻く。行は `scroll-margin` で上の帯・下のタブを避ける
- 行は `button.month-list-btn`（data-testid `month-list-day`・`data-date`・`data-state`・`data-off`）。押すとマスと同じ（`openDay`、「休みを入れる」のときは `toggleOff`・押せない日は `aria-disabled`）
- 表示の選択が〈スタッフ〉なら勤務の状態と担当の件数、〈利用者さん〉なら訪問の時刻と担当、休みを入れるときはその日の扱いを行の下に出す
- 390px で土曜も見え、はみ出さない

#### 右の欄（要対応・確定していない日）

- 確定していない日（`progress.unconfirmed`＝今日以降の訪問があって確定済みでない日）：
  - 上に「問題の無い日をまとめて確定（N日）」（`month-confirm-bulk`・`data-count`。PRD D223。主ボタンにしない（月の主ボタンは帯の次の一手））。確定していない日が0日なら出さない
  - 対象は `lib/confirmDay` の `bulkConfirmTargets(unconfirmed, statusOf, attention)`（日の状態は `useDayStatuses` のもの）：一度も確定していない日（状態が「案あり」）で、必須の違反が0、かつ要対応（第3引数の `attentionList` の日付。入らない訪問・休みの人に残る訪問・条件が変わった・拘束超・欠勤）に出ない日。入らない訪問・休みの人に残る訪問・条件が変わったは状態からも見る。希望休だけの日（要対応に出ない）は対象に入れる。残すのは問題のある日（`problem`）・未確定の変更ありの日（`changed`。前に確定した割当を置き換えない。日の予定で確定し直す）・案の無い日（`noPlan`）
  - 0日なら押せず、下に理由 `month-confirm-why`（aria-describedby。`bulkConfirmWhy`：問題のある日がある／未確定の変更ありの日がある／案の無い日だけ）。あれば下に対象の決まりの1行（`month-confirm-note`）。作っている間（まとめて作る）は押せない。印刷では出さない
  - 押すと独自の確認（`bulkConfirmDialog`）：見出し「問題の無い N日を確定しますか？」、本文に日付（`datesText`：「10/22（水）・10/23（木）… 計 N日」。7日を超えたら先頭6日と「…」）・担当が書き換わる旨・「問題のある M日は残します（要対応で確認）：日付」・「前に確定した割当と違う M日も残します（日の予定で確定し直します）。」・「案の無い M日も残します。」、ボタン「N日を確定する」
  - 確定すると1回の `update` で、日ごとに `confirmDay(d, date, problem)`（日の予定の「この割当で確定」と同じ書き方。問題は日の状態を数えたときのもの）。確認のあいだに案が消えた日は飛ばす。知らせ「N日を確定しました」。フォーカスは右の欄へ（ボタンは0日になって押せなくなる）
- 確定していない日の一覧 `month-unconfirmed`：行は `openDay`（その日の「日の予定」）
- 要対応 `month-attention`（`attentionList`）：入らない訪問・休みの人に訪問 N件（`absentLeft`）・欠勤（希望休でない欠勤だけ。手当てが済んだ日を除く。PRD D281）・条件が変わった・「拘束が N時間を超える 名前」（overSpan）。行は `data-date`・`data-kind`。無ければ「今日以降で、入らない訪問・休みの人に残る訪問・条件が変わった日・出勤〜退勤（拘束）が上限を超える日・欠勤のある日（確定済みで手当ての要らない日を除く）はありません。」
- 欠勤あり（対応済み）`month-handled`（PRD D281。`handledAbsences`）：要対応の下に見出し「欠勤あり（対応済み）」と日付・「欠勤 名前（確定済み）」の行（`data-date`。押すとその日の日の予定）。地の色で縁の色を付けない（要対応・注意にしない）。手当てが済んだ日＝`absenceHandled`（確定済みで、入らない訪問・必須の違反・休みの人に残る訪問が無い）
- 要対応の行は `attentionTarget` の行き先へ（`openTarget`＝選んでいる日付をその日にしてから `navigate(to)`）。行は1つのボタンのまま、2つ目の span の下に `.month-attention-go`（行き先の文「（〜で開く）」）。`data-to` に行き先
- `Attention` の `staffIds?`（overSpan のときだけ。拘束が上限を超える人の id。`names` と同じ順）

#### 〈利用者さん〉を選んだときの回（PRD D304）

- 右の欄の「日ごと」の下に「この月の回」（`month-client-visits`）：`lib/visitOps` の `clientVisitsIn`（取り消しも。日付・開始の順）の行 `month-client-visit`（「10/28（水） 14:30」と担当・「担当なし」・取り消し・当日キャンセル・「変」）。押すと訪問の詳細の欄（閉じるとフォーカスは行）。印刷で出さない

#### `?do=`（1回だけ。行ったら URL から消す）

| `?do=` | 動き |
|---|---|
| `batch` | `openBatch()`（帯と共通）：作っている間は何もしない。この月に訪問が無ければ知らせ。作っていない訪問・`targetsOf('empty')`・`targetsOf('all')` のどれかがあれば、既定をいつも「まだ案の無い日だけ」（0日でも）にして欄を開く（済んだ数字から作り直しへ進まない。作り直しは欄で利用者が選ぶ）。どれも無ければ知らせ |
| `attention`・`unconfirmed` | 全体の表示にして右の欄へ移りフォーカス |
| `stale` | `openStale()`：作っている間は何もしない。`staleTargets` が0日なら知らせて右の欄の要対応、あれば `mode='stale'` で欄を開く |

#### まとめて作る（PRD D41・D153・D154・D163・D256・D257）

欄（`SidePanel`）の中身：

- 使うプリセット（`batch-preset`。基準のプリセットの名前。「（点数の基準も「〈名前〉」）」）
- 対象（ラジオ）：「まだ案の無い日だけ」（初期値）／「確定していない日をすべて作り直す」／「条件が変わった日だけ作り直す（N日）」（`batch-mode-stale`。`staleTargets` があるか選んでいるとき）
- 対象の日数と見込みの時間（1日 約3〜5秒。`batch-count`）
- 注記「先に定期パターンからこの月の訪問を作ります。今日より前の日・確定した日は作りません」。stale のときは `batch-stale-note`（「案を作ったあとに条件が変わった日を、〈`rebuildWith(基準)`〉。手直しのある日は、作る前に確かめます。今日より前の日と確定した日は作りません。」と「条件が変わった確定済みの日 N日は、日の予定で確かめてください。」。PRD D307）
- 「訪問だけ作る（N件。案は作らない）」（`batch-expand-only`・`expandOnly`。作れる訪問があるときだけ。`applyPatterns` で展開するだけ）
- 主ボタン「作り始める」（帯 `footer` の先頭）。その月の訪問が0件なら「定期パターンが無いか、この月の訪問がありません」で押せない

「作り始める」（`start(mode, expand)`）の流れ：画面は対象の日を出し、手直しのある日の確認をしてから `lib/monthBatch` の `monthBatch.start(job)` を呼ぶだけ。計算は画面の外の入れ物で続く（ADR-0042）

1. `lib/month` の `batchTargets` で対象の日を出す（展開したあとのデータで）
2. 入れ物が、その月の今日以降に `applyPatterns` で展開（1回の `update`。`expand`＝その月の1日〜末日。`expandRange`）。stale のときは展開しない（`start('stale', false)`）
3. 1日ずつ、その日のデータに基準のプリセットの重みを当てた条件（`applyPreset`）で compile し、Worker（`runSolve`。種はデータの種、反復は `defaultIterations`）で解き、その日の今の案（routes・generated＝結果、pins＝{}、rules＝使った条件、runId）と記録（`addRun`。名前はプリセットの名前、`inputKey` 付き）を1回の `update` で書く（`applyDayRun`）。作っている間に確定した日・（まだ案の無い日だけで）案ができた日は飛ばし、今の案は変えず記録だけ足す

- 「確定していない日をすべて作り直す」「条件が変わった日だけ」で手直し・固定のある日があれば「手直しのある N日の手直しを捨てます」と確認
- 進み具合「11/14 の案：5/22日」（日付と日数、`progress` 要素）と「止める」（今の日はそれまでの最良で残し `stopped`、残りはやめる）
- 作っている間は、この画面のほかの書き込み（まとめて確定・希望休・条件が変わった日を作り直す）を押せない（`monthBatch.run` が null でない間）。月を送るボタンは押せる（いま作っている日の印は作っている月だけ。ほかの月を見ているときは進み具合の文の頭に「〈M〉月：」）
- 二重には始めない：`monthBatch.start` は作っている間 false を返す。帯の次の一手・`?do=batch`・`?do=stale` も作っている間は欄を開かない
- ほかの画面へ移っても止まらない。上の帯（`AdminShell` の header）に `BatchBand`：くるくるの印・「〈M〉月の案を作っています N/M日」（`batch-band-text`。`/month?ym=` へのリンク）・［止める］（`batch-band-stop`）。月の予定の画面では出さない（画面の中の `month-progress`）。狭い画面では帯の下の段に幅いっぱい。印刷では出さない
- ページを閉じる・読み直すと止まる（作れた日は残る。再開しない。`MonthBatchHost` が外れると `connect` の後始末で計算を捨てる）
- データを丸ごと差し替えたら（読み込み・初期状態に戻す・直前の状態に戻す・別のタブの変更。store の `replacedCount`）`MonthBatchHost` が `monthBatch.abort()`：作っている日の結果は書かず、知らせ「データを差し替えたので、〈M〉月の案づくりを止めました（N日分は作りました）」
- 書く直前にその日の今の案が作り始めから変わっていれば（作っている間に日の予定で手直し・作り直し）、記録だけ足して今の案は変えない（「まだ案の無い日だけ」と同じ扱い）
- 上の帯の［止める］は押すと「止めています…」（`aria-disabled`。二度押ししない）。帯が消えたときフォーカスが帯の中にあれば本文の見出し（無ければ本文）へ
- 終わった知らせは1回だけ（描き直し・付け直しで二度出さない）
- いま作っている日の印は、2か月にまたがる作成でも表示している月の日なら付ける
- 終わったら知らせ（`MonthBatchHost` がどの画面でも出す。`batchDoneText`）「〈M〉月の案をN日分作りました」（入らない訪問がある日があれば「（入らない訪問がある日 M日）」）と［月の予定を見る］（`batch-done-open`。`/month?ym=`。週の予定から始めたら［週の予定を見る］で `/week?d=`。その月の月の予定・その週の週の予定を見ていれば出さない）。止めたら「〈M〉月の案をN日分作ったところで止めました」、計算できなければ「…止まりました（理由）」（この画面を開いていれば理由を `error` にも出す）
- 「まだ案の無い日だけ」でもう一度押しても記録は増えない。まとめて作った日を開くと、基準のプリセットのカードが今の案
- 欄の注記「1日ずつ作り、作れた日はすぐに保存します。「止める」で、作っている日はそれまでの最良の案で残し、残りの日はやめます。ほかの画面へ移っても作り続けます（上の帯に進み具合と［止める］）。ページを閉じる・読み直すと止まります（作れた日は残ります）」

#### `lib/monthBatch.ts`（計算の入れ物。テストあり。ADR-0042）

- `createMonthBatch(solve = runSolve)`：`run`（`BatchRun`＝月・名前・作り方・対象の日・いまの番号・作れた日数・反復。作っていなければ null）・`done`（`BatchDone`＝月・名前・作れた日数・入らない訪問がある日・止めたか・理由。終わるたびに新しい物）・`start(job)`・`stop()`・`abort()`（すぐ捨てて止めた知らせ）・`running()`・`connect(host)`。アプリでは `monthBatch` の1つ。値は `lib/valueStore`（`useValueStore` で読む部品だけ描き直す）
- `BatchJob`＝`{ ym, label, mode, days: { date, mode }[], source: 'month' | 'vacancy' | 'week', weekStart?, expand: { from, to } | null, today }`（`expand` は先に定期パターンから訪問を作る範囲。月の予定はその月、週の予定はその週（PRD D280）。`weekStart` は週の予定から始めたときの週の始まりで、`run`・`done` にも写す）。日ごとの作り方（`empty` は作っている間に案ができた日を飛ばし、書く直前に案があれば今の案を変えない）
- 1日の作り方は画面にあったときのまま（基準のプリセットの重みで compile・手直しの記憶を当てる `withManualPrefs`（ADR-0043。当てたものは `applyDayRun` の `prefPins` で記録に書く）・使い回せる記録・`applyDayRun`）。月の予定のまとめて作る・空き状況の［足りない案を作る］のどちらも同じ。規則・記憶を直すときはここを直す
- `missingDays(data, dates, today)`：空き状況の［足りない案を作る］の日（範囲の今日以降の、案の無い日＝`empty` と、条件が変わった日＝`stale`。確定した日・手直しのある条件が変わった日は入れない。PRD D259）
- `canMakeDay(data, date)`：その日の案を作れるか（1日の作り方と同じ決め方。点数の基準の条件で compile して計算に入る訪問と〈スタッフ〉がいる）。週の予定は作れない日を作る日に数えない
- `weekBatchDays(data, dates, today)`：週の予定の「この週の案を作る」の日（週の今日以降で、訪問を作ったあとのデータで訪問があって案も確定した割当も無い日。`batchTargets` の `empty` を週に絞る。月をまたぐ週は2つの月から。PRD D280）
- `batchBandText`・`batchDoneText`・`monthsLabel`（「10・11月」）・`weekLabel`（「11/2〜11/8の週」）・`batchHref`（上の帯の文と知らせのボタンの行き先：週の予定から始めたら `/week?d=〈週の始まり〉`、ほかは `/month?ym=`）

#### 希望休（PRD D69。ADR-0014）

- 〈スタッフ〉を選ぶと見出しの選択の横に通常のボタン「休みを入れる」（`month-off-toggle`・`aria-pressed`。押すと「休みの入力を終わる」）。`requestedOff` が入のとき
- 入れているあいだ、上に説明の帯 `month-off-bar`（「〈名前〉さんの休みを入れる：勤務日のマスを押すと…」・この月の希望休 N日・最後の操作の結果 `month-off-note`（`aria-live`。訪問のある日に入れたら注意と「〈日〉の予定を開く」））
- 日のマスは押すと日の予定へ移らず `lib/requestedOff` の `toggleRequestedOff`（1回の `update`）
- マスの扱いは `offDayState`：入れられる日は紫の点線の枠、希望休の日は紫の斜線（`aria-pressed`）、今日より前・勤務なし・ほかの欠勤は `disabled`（灰の枠。title と読み上げに理由）
- 〈スタッフ〉の選びを外すと終わる。計算中（まとめて作る）は押せない
- 訪問のある日に入れても案は変わらない（マスに「休みの人に N」、要対応に出る）。希望休のまとめ入力を切っても「休みの人に N」は出る

#### `lib/month.ts`（画面の純粋関数。テストあり）

- `monthDates(ym)`・`calendarWeeks(ym)`（日曜はじまりの6週。前後の月を含む）
- `batchTargets(data, ym, today, mode)`：その月・今日以降・取り消しでない訪問がある・確定した割当が無い、かつ mode が `'empty'` なら今の案が無い日、`'all'` なら全部、`'stale'` なら条件が変わった日
- `activeVisitsOn`：件数（訪問・種類ごと）・状態・まとめて作る対象は休みの訪問を数えない
- `dayStatus(data, date, view)`：件数・状態・入らない・欠勤の有無・`absentLeft`・`needsCare`（要対応＝入らない・必須の違反・`absentLeft`。案なしは入れない。PRD D228）。点数・条件が変わったかは画面が compile して渡す。`stale` は計算に入れる訪問がある日だけ（`batchTargets` と同じ）
- `applyDayRun(d, date, run)`：今の案と記録を書く（`lib/runs` の `addRun`）
- `dayMarks`（`requested`・`leaves`）・`staffDay`（`requested`・`bar`）・`clientDay`・`staffMonth`（`requestedDays`・`absenceDays`）・`clientMonth`・`attentionList`（`AttentionKind` に `'absentLeft'`）
- `monthProgress(data, ym, today, staleOf?, statusOf?)`：その月の今日以降について 訪問の件数・案のある日/訪問のある日・確定した日/訪問のある日・要対応の件数（statusOf は画面が作った日の状態。要対応の数を右の欄とそろえる）。帯が使う
- `expandMonthVisits`
- 条件が変わったの判定：`ruleSetKey(rules)`（ID・型・重み・必須（必須にできない型は false）。名前は入れない）・`currentRuleKeys(rules, presets)`（`presets`＝いまの条件に各プリセットを当てたもののキーの集合、`current`＝いまの条件のキー）・`rulesStale(data, date, keys)`（今の案の元の記録 `planRunOf` の条件のキーが `presets` に無く、記録の `presetId` があれば（プリセットで作った案）true、null なら（いまの条件で作った案）`current` とも違えば true。記録が無い・振り直しの記録は false）

#### `lib/requestedOff.ts`（純粋関数。テストあり）

`REQUESTED_OFF_NOTE`・`isRequestedOff`・`offDayState(data, staffId, date, today)`・`toggleRequestedOff(d, staffId, date, today, newId)`・`requestedOffDates(data, staffId, ym)`・`absentLeftIds(problem, routes, staffId?)`（最終勤務日の後の人に残る訪問も含む）・`absentLeftOf`（件数）

### 月の印刷（`#/month/print?ym=&staff=`。PRD D70）

- `pages/MonthPrintPage.tsx`：`AdminShell` の外（ルートの例外は `Guarded`）。ツアーは出ない
- 上の操作の帯（`.no-print` で印刷しない）：月の予定に戻る・前後の月・〈スタッフ〉の選択（全員／1人）・主ボタン「印刷する」＝`window.print()`
- 見出し：「2026年11月の予定（〈名前〉さん）」・事業所名・凡例・印刷日
- 日曜はじまりの週の表（その月の日が無い週は出さない）。マスは 日付・「確」／「案」・件数、行ごとに 種類の色の点・時刻・〈利用者さん〉・担当の名字（絞ったときは出さない。担当なしは「未定」）、下に「休：山田(希)・佐藤(欠)・鈴木」と「〈利用者さん〉休：…」
- CSS（`pages/monthPrint.css`）：`@page monthprint { size: A4 landscape; margin: 7mm }`・`.mprint { page: monthprint }`、週の行は `break-inside: avoid`、文字は 7.5pt
- `lib/monthPrint.ts`（純粋関数。テストあり）：`printDay(data, date, staffId, inMonth?)`（確定した割当、無ければ今の案。`PrintDay.pending`＝担当の決まっていない訪問の件数、`PrintDay.off`、`PrintEntry.staffLabel`・`staffId`、`PrintOff.label`・`staffId`。メールも使う）・`monthPrint(data, ym, staffId)`・`staffLabels(staff)`（名字。重なる人はフルネーム）

### 完了の条件

- [ ] （ADR-0012）翌月を開き「まとめて作る」→ 進み具合が出て、終わると日のマスに件数・状態が出る。止めるとそこまでの日は残る。確定した日・今日より前の日は作られない。もう一度作っても「まだ案の無い日だけ」なら記録は増えない
- [ ] まとめて作っている間にほかの画面へ移っても作り続け、上の帯に進み具合と［止める］が出る。月の予定へ戻ると進み具合が見え、終わると知らせ［月の予定を見る］。読み直すと止まる（作れた日は残る）。`lib/monthBatch` のテストが通る
- [ ] 日のマスを押すとその日の「日の予定」が開き、まとめて作った案が今の案（基準のプリセットのカードが今の案）になっている
- [ ] （D43）案を作ったあとにその日の訪問を直すと、月と日の予定に「条件が変わった」が出て、作り直すと消える
- [ ] （ADR-0014）〈スタッフ〉を選び「休みを入れる」で勤務日のマスを続けて押すと希望休が付き、もう一度押すと外れる。勤務の無い日・今日より前の日は押せない。訪問のある日に入れると注意とリンクが出て、日のマスに「休みの人に N」、要対応に出る（案は変わらない）。全体の表示の「休 N」に数が入る
- [ ] （ADR-0014）「印刷」で `#/month/print` が開き、A4横の1か月の表（〈スタッフ〉で絞れる）が出る。印刷（PDF）にナビ・操作の帯は出ず、週の途中で改ページしない
- [ ] （ADR-0015）最終勤務日に「最終」、後の日のその人の訪問は「休みの人に N」、案のある日は「条件が変わった」。上限を超える日に「拘束超」・要対応
- [ ] 要対応の行き先（入らない訪問 → 日の予定の入らなかった訪問・休みの人に訪問 → 欠勤・キャンセルの欄の1段目・拘束の上限超え → 勤務の見込みのその月・その人・そのほか → 日の予定）（`scripts/e2e-links.cjs`）
- [ ] 390px ははじめ日ごとの一覧（今日の行が画面に入る・「今日へ」）・`?layout=`・1400px ははじめカレンダー・月の印刷は変わらない（`scripts/e2e-tour.cjs`）
- [ ] 凡例ははじめ畳む・マスに title を出さない・マウスを重ねる／キーボードでマスの読み方（`scripts/e2e-words.cjs`）
- [ ] （D223）初期データの月で「問題の無い日をまとめて確定（N日）」を押すと確認に日付が並び、確定するとその日が確定済み・ホームの確定していない日が N日減る。欠勤の人に訪問が残る日は対象から外れ、確認に日付が出る。未確定の変更ありの日は外れ、そのまま残る（`scripts/e2e-home.cjs`）
- [ ] `lib/month`（月の日付・6週・対象の日の3つの mode・状態・overSpan の `staffIds`）・`lib/monthList`・`lib/monthGuide`・`lib/requestedOff`・`lib/monthPrint`・`lib/confirmDay` のテストが通る
