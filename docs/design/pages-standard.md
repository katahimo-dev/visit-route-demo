# 組み方の標準（標準の週）の画面

> この画面のファイル：`src/pages/StandardPage.tsx`（`settings.css`）、`src/lib/standard.ts`。関連 ADR：0010・0012・0013・0035・0053・0062。関連 PRD：D314・D315・D350〜D354。
> 契約（`Pattern.usualStarts`・`DemoData.standard`）は design.md §5「データの1件ずつ」「データ一式」。標準の担当を AI で組むときにピンと同じに扱う `standardPinsOf`・`aiPinsOf` は `lib/dayPlan`

### 組み方の標準（`#/standard`）

使い始めと見直しのときに、標準の週（繰り返しの担当・曜日ごとの開始）と標準の考え方（点数の基準のプリセット）を決めて登録する画面（PRD D350）。メニューの「設定」の先頭のタブ「組み方の標準」（土台の画面。機能の入り切りで消えない）。`PageHeader` の題名「組み方の標準」・`lead`「誰が・何曜・何時に行くかの標準を決めます。登録すると、先の週・月はこの標準で並び、AI は標準で埋まらない所だけを組みます」。見出しの下に設定のタブ。中身は4段の手順（`ol.standard-steps`・data-testid `standard-steps`。段は `li.card`・`data-step`＝`period|run|edit|register`）。

- 上に今の標準の1行（`standard-now`）：登録していなければ「まだ標準を登録していません」、登録していれば「標準：〈M/D〉から・考え方「〈プリセット名〉」・〈N〉週の周期（〈M/D〉に登録）」（`DemoData.standard`。プリセットが無くなっていれば「消したプリセット」）

#### 1. 期間

- `standardPeriod(data, today, weeks)`：来週の月曜（今日が月曜なら7日後。週の予定と同じ区切り）から `weeks` 週。「〈M/D〉〜〈M/D〉（N週）。〈理由〉」（`standard-period`。理由は `cycleWeeks` の `reason`）
- 週の数（`select`・data-testid `standard-weeks`・1〜4。既定は `cycleWeeks`）。周期より短いと「期間に回の無い繰り返しは今の標準のまま」と注意。作っている間は変えられない。変えると作った提案を捨てる

#### 2. 考え方で作る

- 主ボタン「〈N〉つの考え方で作る」（N はプリセットの数。`standard-run`）で、`data.presets` の順に、期間の今日以降・伝えていない日を1日ずつ、そのプリセットの重み（`applyPreset`）で Worker で解く（`runSolve`・`defaultIterations`）。手で付けたピン（`pinsOf`）だけを効かせ、標準のピンは効かせない。作っている間は「「〈プリセット名〉」で作っています i/n日」（`standard-progress`）と［止める］（`standard-stop`）
- 提案は画面の状態（保存しない）。画面を離れると止めて捨てる
- カード（`standard-card`・`data-preset`＝id）：名前・一言、点（`standard-points`。日ごとの点の平均。点数の基準の物差し：`scoreRulesOf` で作った問題を `score`・`normalize`・`toHundred`）・移動（時間）・担当なし・件数の偏り（`standard-spread`。最も多い人 − 最も少ない人。名前と件数を title）・守れない条件。いちばん点の高いカードに王冠（`standard-crown`。同点は前のカード。`bestIndex`）。作ったあとに訪問が変わった日があれば「作ったあとに予定が変わりました（変わった日は書きません）」
- 作り終えたカードの［この考え方で作る］（`standard-pick`）：独自の確認「「〈プリセット名〉」で〈M/D〉〜〈M/D〉の担当を書きますか？」、本文「期間の担当と時刻を提案のとおりに書きます（ピンの訪問はそのまま）。点数の基準を「〈プリセット名〉」にします。元に戻すで戻せます」、主ボタン「書く」。store の update の1回（手の名前「組み方の標準：〈プリセット名〉で書く」）で、作ったときの訪問のままの日（伝えていない）だけ `writeRoutes` で書き、`setScorePreset` でそのプリセットを点数の基準にする。書いたら提案を捨て、トースト「N日分を書きました」と［元に戻す］

#### 3. 直す

- 説明と、週ごとのリンク［週の予定で直す（〈M/D〉〜）］（`standard-week-link`。`/week?d=〈その週の月曜〉&mode=change`）。今の点数の基準の名前も添える。2段目を飛ばして今の担当のまま登録してもよい（見直し）

#### 4. 標準として登録

- 差分の表（`standard-diff`。`standardDiff(data, period)`）：繰り返しごとに1行（`standard-row`・`data-changed`）。列は〈利用者さん〉・担当（前 → 後。曜日で分けるときは「月：〈名前〉・水：〈名前〉」）・曜日ごとの開始（前 → 後）・注意（`STANDARD_WARNING_TEXT`）。変わらない行は畳み、［変わらない N件を見る］（`standard-show-same`）で出す
  - 注意：`weekdaySplit`（曜日で担当が違うので、曜日ごとに分けます）・`weeksDiffer`（週によって担当が違うので、最初の週の担当にします）・`outsideWindow`（開始が時間の約束の外なので、開始は書きません）・`unassigned`（担当なしの回があります）・`notSeen`（期間に回がありません。今の標準のまま）
- 「いつから」（`input[type=date]`・`standard-since`。既定は `defaultSince`＝期間の最初の日。`min`＝`earliestSince`＝今日と最後に伝えた日の翌日の遅い方。それより前の値は既定に戻す）
- 一時の変更（`temporaryChanges(data, rows, since)`）があれば注意の枠（`standard-temp`）：「標準と違う一時の変更が N件あります」・一覧（日付・〈利用者さん〉・今の担当と時刻 → 標準の担当と時刻。10件まで、残りは「ほか N件」）・選び（`standard-temp-choice`。radio「ピンを立てて残す」（既定）／「標準に戻す（消す）」）
- 主ボタン「標準として登録」（`standard-register`。変わる行が0件なら押せず「今の標準と同じです」）：独自の確認「標準を登録しますか？」、本文に 変わる繰り返し N件（うち曜日ごとに分ける N件）・〈M/D〉以降の計算した回は新しい標準になること・一時の変更 N件をどうするか・伝えた日の回とピンの回は変えないこと。主ボタン「登録する」。store の update の1回（手の名前「組み方の標準を登録」）で `registerStandard`。トースト「標準を登録しました」と［元に戻す］。登録したあとは［先の月の予定を見る］（`/month?ym=〈いつからの月〉&mode=change`）

#### `lib/standard.ts`（純粋関数。テストあり）

- `cycleWeeks(data, today)`：利用中の〈利用者さん〉の、today 以降に続く繰り返しの `everyWeeks` の最大（毎月があれば4、無ければ1）と理由の文。`nextMonday(today)`・`standardPeriod(data, today, weeks?)`＝`{ from, to, weeks }`・`periodDates(period)`
- `standardDiff(data, period)`：`StandardRow[]`＝`{ patternId, clientId, staff: { before, after }, starts: { weekday, before, after }[], days: { weekday, staffId, start }[], split, warnings, changed }`。期間の計算に入る（取り消し・休みでない）繰り返しの回から、曜日ごとに最初の週の回の担当・組んだ開始を取る（時間の約束の外の開始は今の標準のまま）。回の無い曜日は今の標準。期間に回の無い繰り返しは行にしない
- `earliestSince(data, today)`（今日と、最後に伝えた日（伝えた日へ動かした回は元の日も数える）の翌日の遅い方）・`defaultSince(data, period, today)`
- `temporaryChanges(data, rows, since)`：`since` 以降・伝えていない日の、変わる繰り返しの保存した回で、この回だけ日時などを変えた回（取り消し・`edited`・日付の移動）でもピンでもなく、新しい標準（担当と、計算した回の開始）と違う回。期間の中の回は標準の元なので、担当が同じなら開始の違いは見ない（違う担当だけ数える）
- `registerStandard(data, period, since, today, { newId, temp, at })`：変わる繰り返しごとに、`since` ≤ `from` ならその場で書き換え（曜日で分けるときは最初のまとまりが元の ID）、後なら元の `to` を `since` の前日にして新しい ID の繰り返しを足す（隔週・3週・4週ごとは `since` 以降で最初に回のある日を開始日にして周期をずらさない）。`since` より前に終わる繰り返しは書き換えない。曜日で担当が違えば担当ごとのまとまり（`weekdays`・`dayTimes`・`usualStarts` をその曜日の分だけ）に分ける。`since` 以降・伝えていない日の、その繰り返しの保存した回は：この回だけ変えた回は残して新しい繰り返しの ID に付け直す、標準と同じ回（ピンでない）は消す、ピンの回と `temp`＝`'pin'` の一時の変更は新しい繰り返しの回にしてピンを立てて残す、`'drop'` の一時の変更は消す。`since` は `earliestSince` より前なら `earliestSince`。`standard`＝`{ at, presetId: scorePresetId, from: since, weeks }`。変わる行が無ければ同じデータ
- `registerCounts`・`proposalStats(days, toPoints)`・`bestIndex(stats)`・`hasStandard(data)`

#### 確かめ

- 単体：`src/lib/standard.test.ts`（周期・期間・いつから・差分（曜日で分ける・週で違う・時間の約束の外）・登録（分ける・標準と同じ回を消す・一時の変更をピンで残す／消す・ピンとこの回だけ変えた回を残す・伝えた日を変えない・差分0で同じデータ）・標準のピン・王冠）
- e2e：`scripts/e2e-standard.cjs`（設定のタブから開く・期間・考え方で作る（カード・王冠）・この考え方で作る（点数の基準が替わる・元に戻す）・登録（差分の表・一時の変更の選び）・登録のあと先の週の担当と時刻が標準・ホームの標準のカード・ナビの行のリンク）

#### 完了の条件

- [ ] 上の4段が PRD D350〜D354 のとおりに動く
- [ ] 単体・e2e が通る。書く・登録はそれぞれ1手で、全体の「元に戻す」で前に戻る
