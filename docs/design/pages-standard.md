# 組み方の標準（標準の週）の画面

> この画面のファイル：`src/pages/StandardPage.tsx`（`standard.css`）、`src/lib/standard.ts`。関連 ADR：0010・0012・0013・0035・0053・0062。関連 PRD：D314・D315・D350〜D354。
> 契約（`Pattern.usualStarts`・`DemoData.standard`）は design.md §5「データの1件ずつ」「データ一式」。標準の担当を AI で組むときにピンと同じに扱う `standardPinsOf` は `lib/dayPlan`

### 組み方の標準（`#/standard`）

使い始めと見直しのときに、標準の週（繰り返しの担当・曜日ごとの開始）と標準の考え方（点数の基準のプリセット）を決めて登録する画面（PRD D350）。メニューの「設定」の先頭のタブ「組み方の標準」。`PageHeader` の題名「組み方の標準」・`lead`「誰が・何曜・何時に行くかの標準を決めます。登録すると、先の週・月はこの標準で並び、AI は標準で埋まらない所だけを組みます」。見出しの下に設定のタブ。画面の中身は5段の手順（`ol.standard-steps`・data-testid `standard-steps`）。段ごとに見出し（h2）と1行の説明。今の段は `aria-current="step"`。段は戻れる（押した段の見出しへフォーカス）。

- 上に今の標準の1行（`standard-now`）：登録していなければ「まだ標準を登録していません」、登録していれば「標準：〈M/D〉から・考え方「〈プリセット名〉」・〈N〉週の周期（〈M/D〉に登録）」（`DemoData.standard`。考え方のプリセットが無くなっていれば名前の代わりに「消したプリセット」）

#### 1. 期間

- 期間は `standardPeriod(data, today)`：来週の日曜（今日が日曜なら次の日曜）から `weeks` 週（`cycleWeeks`）。「〈M/D〉〜〈M/D〉（〈N〉週）」と、N の理由「隔週の繰り返しがあるので2週」など（`cycleReason`）
- 週の数は変えられる（`select`・1〜4。既定は `cycleWeeks`。短くすると、見えない回の注意を2段目のカードに出す）

#### 2. 考え方で作る

- `data.presets` の順にプリセットごとのカード（`standard-card`・`data-preset`＝id）。主ボタン「3つの考え方で作る」（プリセットの数。data-testid `standard-run`）で、期間の今日以降・伝えていない日を順に、そのプリセットの重みで提案を作る（範囲の AI で組むと同じ入れ物 `lib/monthBatch` を使う。画面を移っても続く。PRD D256 と同じ上の帯）
- ピン：手で付けたピン（`pinsOf`）だけを効かせ、標準のピン（`standardPinsOf`）は効かせない（`ignoreStandard: true`）。伝えた日は作らない（カードに「伝えた日 N日は除く」）
- カードの中身：プリセットの名前・一言、点（日ごとの点の平均。点数の基準の物差し `scoreRulesOf`）・移動の合計（時間）・担当なしの件数・人ごとの件数の偏り（`spreadOf`：最も多い人 − 最も少ない人。件数と名前を title に）・守れない条件の件数。いちばん点の高いカードに王冠（同点は前のカード）
- 提案は保存しない（画面の外の入れ物。読み直す・データを丸ごと差し替えると消える）。作っている間はカードに進み具合、［止める］
- 期間の訪問・繰り返し・ピンが作ったあとに変わったら、カードに「作ったあとに予定が変わりました」と［作り直す］

#### 3. 選ぶ

- カードの［この考え方で作る］（`standard-pick`）：独自の確認「〈プリセット名〉で〈M/D〉〜〈M/D〉の担当を書きますか？」、本文「期間の担当と時刻を提案のとおりに書きます（ピンの訪問はそのまま）。点数の基準を「〈プリセット名〉」にします。元に戻すで戻せます」。主ボタン「書く」
- 書く：store の update の1回（手の名前「組み方の標準：〈プリセット名〉で書く」）で、日ごとに `writeRoutes` と `scorePresetId` をそのプリセットに（`withBasisRules` で `rules` もそろえる）
- 書いたあと4段目へ進み、トースト「〈N〉日分を書きました」と［元に戻す］

#### 4. 直す

- 説明「週の予定で担当・時刻を直してから、5段目で登録します」と、副ボタン［週の予定で直す］（`#/week?date=〈期間の最初の日〉&mode=change`）。週が2つ以上なら週ごとのリンク
- 3段目を飛ばして、今の担当のまま4段目・5段目へ進んでもよい（見直しのとき）

#### 5. 登録

- 差分の表（`standard-diff`。`standardDiff(data, period)`）：〈利用者さん〉・繰り返し（種類・曜日・間隔）ごとに1行。列は 担当（前 → 後）・曜日ごとの開始（前 → 後）・注意。変わらない行は畳む（「変わらない N件を見る」）
  - 注意（`StandardWarning`）：`weekdaySplit`（曜日で担当が違うので、曜日ごとに分けます）・`weeksDiffer`（週によって担当が違うので、最初の週の担当にします。週ごとの担当を title に）・`outsideWindow`（開始が時間の約束の外なので、開始は書きません）・`unassigned`（担当なしの回があります）・`notSeen`（期間に回がありません。今の標準のまま）
- 「いつから」（`input[type=date]`・data-testid `standard-since`。既定は期間の最初の日。今日より前は選べない（`min`＝今日））
- 主ボタン「標準として登録」（`standard-register`。差分が0件なら押せず「今の標準と同じです」）：独自の確認「標準を登録しますか？」、本文に 変わる繰り返し N件・分かれる繰り返し N件・〈M/D〉以降の伝えていない日で、ピンでなく標準と違う担当・時刻の回は標準に戻ること・伝えた日の回とピンの回は残すこと。主ボタン「登録する」
- 登録：store の update の1回（手の名前「組み方の標準を登録」）で `registerStandard(data, period, since, today, newId)`。トースト「標準を登録しました」と［元に戻す］、［先の月の予定を見る］（`#/month?ym=〈since の月〉&mode=change`）

#### `lib/standard.ts`（純粋関数。テストあり）

- `cycleWeeks(patterns, clients, today)`：利用中の〈利用者さん〉の、today 以降に続く毎週系の繰り返しの `everyWeeks` の最大。毎月（`'monthly'`）があれば4。繰り返しが無ければ1。`cycleReason(...)` は理由の文
- `standardPeriod(data, today, weeks?)`：`{ from, to, weeks }`（from は来週の日曜。to は from + 7×weeks − 1）
- `standardDiff(data, period)`：`StandardRow[]`＝`{ patternId, clientId, staff: { before, after }, starts: { weekday, before, after }[], split: { weekday, staffId }[] | null, warnings: StandardWarning[] }`。読むのは期間の `visitsIn` のうち、繰り返しの回（`pattern` あり）で、取り消し・休みでない回。曜日ごとに最初の週の回の担当・組んだ開始を取る
- `registerStandard(data, period, since, today, newId)`：差分を繰り返しに書く。担当が曜日で同じなら `splitPattern` で `usualStaffId`・`usualStarts` を書き換えた繰り返しにし、違えば曜日の組ごとに `splitPattern` の後半を曜日ごとの繰り返しに分ける（`weekdays` と `dayTimes`・`usualStarts` をその曜日の分だけ）。そのあと `since` 以降・伝えていない日の、この回だけ変えていない（`edited` でない）保存した回を見る：担当・組んだ開始が新しい標準と同じ回は消す（計算した回と同じになる）。ピンの回は残す。それ以外（ピンでなく標準と違う回）は消す（標準に戻る）。伝えた日の回は見ない（残す）。`DemoData.standard` に `{ at, presetId: scorePresetId, from: since, weeks }` を書く。同じ入力で同じ結果
- `hasStandard(data)`：`standard` があるか（ホームのカード・ナビの行の1行の説明）

#### 確かめ

- 単体：`src/lib/standard.test.ts`（周期の週数・期間・差分（曜日で分ける・週で違う・時間の約束の外・担当なし・回が無い）・登録（分ける・標準と同じ回を消す・伝えた日とピンを残す・ピンでない違う回を標準に戻す・同じ入力で同じ結果）・`standardPinsOf`（休み・条件に合わない回を外す））
- e2e：`scripts/e2e-standard.cjs`（設定のタブから開く・期間と週の数・3つの提案のカード（王冠・偏り）・この考え方で作る（点数の基準が替わる・元に戻す）・週の予定で1件直す・差分の注意・登録・登録のあと先の週の担当と時刻が標準・AI で組むで標準の担当が替わらない・標準の担当の欠勤だけ AI が代わりを探す・ホームのカード）

#### 完了の条件

- [ ] 上の5段が、PRD D350〜D354 のとおりに動く
- [ ] 単体・e2e が通る。登録は1手で、全体の「元に戻す」で登録の前に戻る
