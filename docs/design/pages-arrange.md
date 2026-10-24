# 担当を組むの画面

> この画面のファイル：`src/pages/ArrangePage.tsx`（`arrange.css`）、`src/lib/monthBatch.ts`（計算の入れ物）、`src/components/batchBand.tsx`（上の帯の進み具合・`MonthBatchHost`）・`scheduleParts.tsx`（`RangeProposalBand`・`confirmDropProposal`）・`ArrangeTabs.tsx`、`src/lib/month.ts`（`batchTargets`）。関連 ADR：0042・0053・0063。関連 PRD：D256・D257・D328・D355・D356。
> 予定（月・週・日）では AI で組まない（手で直す）。AI で組むのはこの画面と組み方の標準（[pages-standard.md](pages-standard.md)）。

### 担当を組む（`#/arrange`）

範囲（月・週・日）を選び、その範囲の担当を AI で組んで提案を出し、見て反映する画面。メニューの「予定を組む」の子「担当を組む」。見出しの下に予定を組むのタブ（`ArrangeTabs`：担当を組む `#/arrange`・組み方の標準 `#/standard`。比較の画面 `#/compare` でも担当を組むに印）。

#### URL とクエリ

| クエリ | 意味 |
|---|---|
| `?date=YYYY-MM-DD` | 範囲は日（その日） |
| `?d=YYYY-MM-DD` | 範囲は週（その日の週。月曜からの7日。範囲を選ぶと月曜の日付を書く） |
| `?ym=YYYY-MM` | 範囲は月 |
| どれも無い | 範囲は月で、月の後半なら来月・前半なら今月（`lib/scheduleMode` の `planYm`） |

読む順は `?date=` → `?d=` → `?ym=`。範囲を選び直すと URL を書き換える（replace。ほかのクエリは残さない）。進み具合の帯・ホームの次の一手・空き状況の注意からは `?ym=`、上の帯・終わった知らせからは組んだ範囲（`batchHref`）で開く。

#### 並び

1. 見出し（`PageHeader`。nav は `ArrangeTabs`）：題名「担当を組む」・`lead`「範囲を選んで AI で担当を組み、提案を見て反映します。予定（月・週・日）では手で直します」
2. 範囲のカード（`arrange-range`）：
   - ［月｜週｜日］（`fieldset.segmented`・`arrange-scope`・`aria-pressed`・ボタンの `data-scope`）
   - 月なら月を選ぶ欄（`arrange-month`。今月から6か月と見ている月）、週・日なら日付の欄（`arrange-date`）。横に範囲の呼び名（`arrange-range-label`：「2026年11月」「11/2〜11/8の週」「11/3（火）」）
   - 「今日以降：担当なしの訪問 N件（M日）・要対応 N件」（`arrange-counts`。`arrange-unassigned`・`arrange-care` の `data-count`）。数え方は月の予定と同じ `useDayStatuses` の日の状態（範囲の今日以降の日だけ）
3. AI で組むのカード（`arrange-run`）：
   - 組む日（ラジオ）：「要対応のある日だけ（N日）」（`arrange-mode-care`。既定。手で決めた担当を変えうる組み直しを既定にしない）／「伝えていない日をすべて組み直す（N日）」（`arrange-mode-all`）。日は `batchTargets(data, dates, today, mode, statusOf)`（今日以降・伝えていない・計算に入れる訪問がある日。care はそのうち要対応のある日）
   - 考え方（プリセット）の選ぶ欄（`arrange-preset`。条件の重み `rules` を切れば出さない）：既定「点数の基準（〈名前〉）」と、ほかのプリセット。選ぶとその重みで組む（`applyPreset(data.rules, preset)` を `BatchJob.rules` に渡す。点数の基準・条件の重みは書き換えない）
   - 「組む日：N日（見込み 約a〜b秒／分）」（`arrange-count`。1日 約3〜5秒）
   - 主ボタン「AI で組む」（`arrange-start`。組んでいる間・組む日が0日なら `aria-disabled`。組んでいる間の文は「組んでいます…」）と「元に戻す」「やり直す」（`UndoButtons`。反映した提案を1手戻す）
   - 組んでいる間の進み具合（`arrange-progress`。「〈名前〉：M/D・3/22日（組めた日 N日）」とバー）と［止める］（`arrange-stop`）
   - 計算できずに止まった理由（`FieldError`。`monthBatch.done.error`）
   - 注記：ピンの訪問（手で替えた訪問・組み方の標準の担当）はそのまま・今日より前の日と確定した日は組まない・1日ずつ組み終わったら提案・見て「反映する」と担当が変わる・ほかの画面へ移っても組み続ける
4. 範囲の提案の帯（`RangeProposalBand`。[pages-common.md](pages-common.md) の「予定の共通の部品」）：［反映する］［捨てる］。同じ帯は日・週・月の予定にも出る
5. 案を比べるのカード（`arrange-compare`。提案を比べる `compare` を切れば出さない）：日付の欄（`arrange-compare-date`。範囲の中。既定は範囲の今日以降の最初の訪問のある日）・［〈日〉の案を比べる］（`arrange-compare-open`。`/compare?date=`）・［日の予定を見る］（`arrange-day-open`。`/plan?date=`）

#### 組み始める（`start`）

- 組む日が0日なら「組む日がありません（今日より前の日・確定した日は組みません）」
- 反映していない提案があれば `confirmDropProposal`（独自の確認「反映していない提案（〈名前〉）を捨てて、組み始めますか？」）。残せば組み始めない
- `monthBatch.start({ ym, label, mode, days, today, source: 範囲, rangeStart, rules? })`。名前は「11月」「11/2〜11/8の週」「11/3」、考え方を選んだときは「11月（移動を短く）」。組んでいれば始めず知らせ
- 上の帯（`BatchBand`）は担当を組むの画面と月の予定では出さない（画面の中に進み具合）。ほかの画面では「〈名前〉の担当を組んでいます N/M日」（行き先は `batchHref`）と［止める］
- 終わった知らせ（`batchDoneText`）：提案の帯が見える画面（担当を組む・日・週・月の予定）にいれば［担当を組むを開く］を出さない。担当を組むの画面にいれば、提案が無くても出さない（PRD D268）

#### `lib/monthBatch.ts`（計算の入れ物。テストあり。ADR-0042・ADR-0053）

画面は始める・止めるだけを頼み、計算はモジュールの入れ物で続ける（ほかの画面へ移っても止めない。ページを閉じる・読み直すと止まり、提案は消える）。

- `createMonthBatch(solve = runSolve)`：`run`（`BatchRun`＝`{ ym, label, mode, source, rangeStart, targets, index, made, iteration, total }`。組んでいなければ null）・`done`（`BatchDone`＝`{ ym, label, source, rangeStart, made, unassignedDays, stopped, error, aborted, proposal }`。`proposal` は変わる件数 `{ moved, shifted }`）・`proposal`（`BatchProposal`＝`{ id, ym, label, source, rangeStart, days: ProposalDay[], stopped }`。`ProposalDay`＝`{ date, problem, visits, inputs, routes, diff, unassigned }`）・`start`（前の提案は捨てる）・`apply`・`discard`・`stop`・`abort`・`running`・`connect`（`BatchHost`＝`{ get, update(fn, label?) }`）
- `BatchJob`＝`{ ym, label, mode, days: { date, mode }[], source: 'month' | 'week' | 'day', rangeStart?, rules?, today }`。`rules` があれば、その条件で問題を作る（`aiPinsOf`・`dayProblemOf` に条件を差し替えたデータを渡す）。データの条件は書き換えない
- 1日ずつ：組んでいる間に確定した日は飛ばす。手で付けたピンと標準のピン（`aiPinsOf`。ADR-0062）を渡して compile し、Worker で解いて日ごとの提案（組み始めたときの訪問・その日の問題の入力 `dayInputsOf`・担当の並び・差）にする。訪問には書かない
- `proposalCounts(p)`・`proposalDayFresh(data, day)`（組み始めたときの訪問のまま・その日の問題の入力（欠勤・希望休・稼働時間の上書き・〈利用者さん〉の休み、人・条件・種類・相性・繰り返し）が同じ・伝えていない）・`applyProposal(data, p)`（純粋関数：そのままの日だけ `writeRoutes`。反映した日・反映しなかった日）
- 反映する（`apply`）：今のデータで反映する日を決め、1回の update（手の名前「AI の提案を反映（〈名前〉）」）。全体の「元に戻す」で1手戻る
- `batchBandText`・`batchDoneText`・`weekLabel`（「11/2〜11/8の週」）・`dayLabel`（「11/3」）・`batchHref`（月 `/arrange?ym=`・週 `/arrange?d=〈月曜〉`・日 `/arrange?date=`）
- `components/batchBand.tsx` の `MonthBatchHost`（App の直下に1つ）：store の data と update をつなぎ、データを丸ごと差し替えたら止めて提案を捨てる（`abort`）。終わったら知らせを出す

#### 完了の条件

- [ ] 範囲の既定は月（今月か来月）。［月｜週｜日］で URL の `?ym=`・`?d=`（月曜）・`?date=` に書き、URL から開ける。範囲の担当なし・要対応の件数が出る（`scripts/e2e-arrange.cjs`）
- [ ] 「AI で組む」で範囲の提案の帯が出て、反映するまで訪問は変わらない。［反映する］で担当が入り、「元に戻す」で1手戻る。［捨てる］で何も変えない（`scripts/e2e-arrange.cjs`）
- [ ] 考え方を選んで組むと帯にその名前が出る。点数の基準・条件の重みは変わらない（`lib/monthBatch` のテスト・`scripts/e2e-arrange.cjs`）
- [ ] 「案を比べる」で比較の画面（その日）へ移り、比較の画面から担当を組むへ戻れる（`scripts/e2e-arrange.cjs`）
- [ ] 組み始めるとほかの画面へ移っても続き、上の帯に進み具合と［止める］。止めるとそこまでの日の提案。知らせから担当を組むへ（`scripts/e2e-progress.cjs`・`scripts/e2e-week.cjs`）
- [ ] 390px で横にはみ出さない（`scripts/e2e-arrange.cjs`）
