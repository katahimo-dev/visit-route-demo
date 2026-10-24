# 組み方の標準（標準の週）の画面

> この画面のファイル：`src/pages/StandardPage.tsx`（`standard.css`）、`src/lib/standard.ts`（純粋関数）、`src/lib/standardDraft.ts`（画面の外の入れ物と案を作る計算）。関連 ADR：0012・0013・0035・0053・0063。関連 PRD：D314・D350〜D354。
> 契約（`Pattern.usualStarts`・`DemoData.standard`）は design.md §5「データの1件ずつ」「データ一式」

### 組み方の標準（`#/standard`）

使い始めと見直しのときに、標準の週（繰り返しの担当・曜日ごとの開始）を **表** で決めて登録する画面（PRD D350）。メニューの「予定を組む」の子（タブ「担当を組む」「組み方の標準」。`PageHeader` の nav は `ArrangeTabs`）。題名「組み方の標準」・`lead`「誰が・何曜・何時に行くかの標準を表で決めます。登録すると、先の週・月はこの表のとおりに並びます」。中身は3段（`ol.standard-steps`・`standard-steps`。段は `li.card`・`data-step`＝`proposals|draft|register`）。

- 上に今の標準の1行（`standard-now`）：「まだ標準を登録していません」／「標準：〈M/D〉から・考え方「〈プリセット名〉」・〈N〉週の周期（〈M/D〉に登録）」
- 主ボタン（`btn-primary`）は画面に1つ：下書きが無いときは「案を作る」、下書きがあるときは「この表を標準にする」

#### 標準の表

- 行＝`standardPatterns(data, today)`：利用中の〈利用者さん〉の、今日以降に続く繰り返し。先で終わり、同じ〈利用者さん〉・種類の後に始まる繰り返しがあるもの（「いつから」で分けた前の側）は除き、後の側を行にする。並びは〈利用者さん〉の名前・最初の曜日。行の見出しは名前と `patternWhenText`（曜日・時間の約束の短い文）。左の列は横に巻いても残る
- 列＝曜日（月曜はじまり。どれかの行にある曜日だけ）。その繰り返しに無い曜日のマスは「—」
- マス＝担当の名前と開始（無ければ「時刻なし」）。今の標準と違うマスは色と文字（担当が違う＝「担当変更」、時刻だけ違う＝薄い色で「時刻変更」）。色だけに頼らない（`standard-cell`・`data-pattern`・`data-weekday`・`data-changed`・`data-kind`）
- 表は `.standard-table-scroll` の中で横に巻く（390px で画面をはみ出さない）

#### 1. 案をくらべる

- 「プリセット（考え方）ごとに、〈M/D〉〜〈M/D〉（N週。〈理由〉）の担当を AI で組み、標準の表の案を作ります…」（`standard-period`。期間は `standardPeriod`＝来週の月曜から `cycleWeeks` の週数）
- 「〈N〉つの考え方で案を作る」（`standard-run`）：`runProposals(data, today)`。`data.presets` の順に、期間の日を1日ずつ、そのプリセットの重み（`applyPreset`）で Worker で解く（`runSolve`・`defaultIterations`）。ひな形なので **保存した回・単発の訪問は見ず（訪問を空にして繰り返しから計算した回だけ）、ピン（手のピン・標準のピン）は効かせない**。伝えた日も作る（予定には書かない）。作っている間は「「〈プリセット名〉」で作っています i/n日」（`standard-progress`）と［止める］（`standard-stop`。作り終えた案は残す）
- 各日の割当から `tableFromDays` で表にする。カード（`standard-card`・`data-preset`）：名前・一言・点（`standard-points`。点数の基準の物差しで作った問題で `score`・`normalize`・`toHundred` の日ごとの平均）・移動・担当なし・件数の偏り（`standard-spread`。title に最も多い人・少ない人）・今の標準と違うマス（`standard-card-diff`。「Nマス（担当 a・時刻だけ b）」）。いちばん点の高いカードに王冠（`standard-crown`・`bestIndex`）
- ［表で見る］（`standard-view`。aria-expanded。もう一度で閉じる）：その案の表を読み取り専用で出す（`standard-view-table`）
- ［この案から作る］（`standard-use`）：下書きにその表を入れる（下書きがあれば独自の確認「下書きを「〈名前〉」の案で置き換えますか？」）。入れたら2段目の見出しへ巻いてフォーカス
- 作ったあとに行の繰り返し（ID・曜日）が変わったら「案を作ったあとに繰り返しが変わりました…」（`standard-proposals-stale`）

#### 2. 表で直す（下書き）

- 下書きが無いとき：説明と［今の標準から作る］（`standard-from-current`。`currentTable`）
- 下書きがあるとき：どこから作ったか（`standard-draft-from`）・「今の標準と違う所 N か所（担当 a・時刻だけ b）」（`standard-diff-count`）・下書きの表（`standard-table`）・［下書きを捨てる］（`standard-discard`。直しがあれば確認）。作ったあとに行の繰り返しが変わったら注意（`standard-draft-stale`。無くなった繰り返しは外し、新しい繰り返しは今の標準で出す）
- マスを押すと、その行のすぐ下に小さな欄（`standard-editor`）：担当（`standard-editor-staff`。勤務中の〈スタッフ〉＋担当なし）・開始（`standard-editor-start`。空＝時刻なし。`startError`：その曜日の時間の約束の外は「時間の約束（9:00〜12:00）の外です」を出して受け付けない）・［決める］［やめる］。開くとフォーカスは担当、Esc・やめる・決めるで閉じてフォーカスはマス。担当なしは開始も無し

#### 3. 標準にする（下書きがあるとき・登録した直後）

- 「いつから」（`standard-since`。`min`＝`earliestSince`、既定＝`defaultSince`＝来週の月曜か選べる最初の日の遅い方）
- いつから以降・伝えていない日の、書き換える繰り返しの保存した回で、ピンでもこの回だけ変えた回でもなく新しい標準と違うもの（`temporaryChanges`）が1件以上なら選び（`standard-temp-choice`・件数 `standard-temp-count`）：「標準どおりに入れ替える（おすすめ）」（既定。`standard-temp-drop`）＝「その予定を消して、新しい標準の担当・時刻にします」／「今のまま残す」（`standard-temp-pin`）＝「その予定は今の担当のまま固定（ピン）します」。［どの予定か見る］で20件まで
- ［この表を標準にする］（`standard-register`）：違う所0なら押せず「今の標準と同じです」（`standard-same`）。独自の確認「この表を 〈M/D〉 から標準にしますか？」（違う所と繰り返しの数・いつから・選びの結果・案から作った下書きなら「標準の考え方（点数の基準）を「〈名前〉」にします」・伝えた日とピンは変えない）→ store の update の1回（「組み方の標準を登録」）で `registerStandard`。下書きを捨て、段の中に完了の表示（`standard-done`）「〈M/D〉 から毎週この表のとおりに並びます」と［週の予定で見る］（`standard-week-link`・`/week?d=〈いつからの週の月曜〉`）。トースト「標準にしました」と［元に戻す］

#### 画面の外の入れ物（`lib/standardDraft.ts`）

- `standardWork`（`createValueStore`）：案（プリセットごとの表・数字・作り終えたか）・案を作った期間と繰り返しの印（`patternsKey`）・作っている途中の進み具合・誤り・下書き（表と、作った元のプリセット ID か null）と印・登録した直後の完了の表示。ほかの画面へ移っても残り、読み直す・タブを閉じると消える（データには入れない）
- `runProposals` は始めたときのデータで作り、画面を離れても続ける（1つだけ）。`stopProposals` で止める

#### `lib/standard.ts`（純粋関数。テストあり）

- 型：`StandardCell = { staffId: string | null; start: string | null }`・`StandardTable = Record<繰り返しID, Record<曜日, StandardCell>>`・`CellRef = { patternId, weekday }`・`CellDiff = CellRef & { kind: 'staff' | 'time' }`
- `standardPatterns`・`cycleWeeks`・`nextMonday`・`mondayOf`・`standardPeriod`・`periodDates`
- `currentTable(data, today)`（担当＝`usualStaffId`、開始＝`usualStartOn`。時間の約束の外は null）・`cellOf(table, current, patternId, wd)`（表に無ければ今の標準）・`setCell`・`tableDiff(table, current)`（今の標準にあるマスだけ見る）・`diffCounts`
- `tableFromDays(data, days, today)`：問題の訪問のうち行の繰り返しの計算した回から、曜日ごとに最初の回の担当（列に無ければ担当なし）と lenient の開始（`startsOf`。担当なし・時間の約束の外は null）。回の無いマスは今の標準
- `startError(pattern, wd, start)`・`earliestSince`（今日と、最後に伝えた日（動かした回は元の日も）の翌日の遅い方）・`defaultSince(data, today)`
- `temporaryChanges(data, table, since, today)`
- `registerStandard(data, table, since, today, { newId, temp, at, presetId? })`：違うマスのある、`since` 以降に続く繰り返しごとに、`since` ≤ `from` ならその場で書き換え（分けるときは最初のまとまりが元の ID）、後なら元の `to` を `since` の前日にして新しい ID の繰り返しを足す（隔週・3週・4週ごとは `since` 以降で最初に回のある日を開始日にして周期をずらさない。終わった繰り返しの `to` は延ばさない）。曜日で担当が違えば担当ごとのまとまり（`weekdays`・`dayTimes`・`usualStarts`）に分ける。`since` 以降・伝えていない日のその繰り返しの保存した回は：この回だけ変えた回は残して新しい ID に付け直す、標準と同じ回（ピンでない）は消す、ピンの回は残す、違う回は `temp`＝`'drop'` で消し `'pin'` でピンを立てて残す。`since` は `earliestSince` より前なら `earliestSince`。`standard`＝`{ at, presetId, from: since, weeks: cycleWeeks }`。`presetId` を渡すとそのプリセットを点数の基準にする（`setScorePreset`）。違うマスが無ければ同じデータ
- `proposalStats(days, toPoints)`・`bestIndex(stats)`・`hasStandard(data)`

#### 確かめ

- 単体：`src/lib/standard.test.ts`（周期・期間・いつから・今の標準の表・行にしない繰り返し・違うマス・案から表・開始の誤り・登録（分ける・標準と同じ回を消す・入れ替える／残す・ピンとこの回だけ変えた回を残す・いつからより前・伝えた日・違う所0で同じデータ・点数の基準・隔週・終わった繰り返し・登録し直し）・標準のピン・王冠）
- e2e：`scripts/e2e-standard.cjs`（予定を組むのタブ・案を作る・カード・表で見る・この案から作る・画面を移っても残る・マスを直す・違う所の数・390px・標準にする（入れ替えるが既定）・完了の表示・登録後は今の標準と同じ）

#### 完了の条件

- [ ] 上の3段が PRD D350〜D354 のとおりに動く
- [ ] 単体・e2e が通る。登録は1手で、全体の「元に戻す」で前に戻る
