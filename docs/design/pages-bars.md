# 時間帯のバーと一目で分かる表示（画面共通）

> この部品のファイル：`src/lib/barRows.ts`・`staffBar.ts`・`glance.ts`・`dayLine.ts`、`src/components/loadBar.tsx`（`loadBar.css`）・`staffBar.tsx`・`clientBar.tsx`（`clientBar.css`）・`workBars.tsx`（`workBars.css`）・`glance.tsx`（`glance.css`）・`dayLines.tsx`（`dayLines.css`）・`barMarks.css`。使う画面：月・週・日・空き状況・勤務の見込み。関連 ADR：0012 追記・0015。関連 PRD：D54・D60・D75〜D85・D228。

### 3段の区切り（`lib/barRows.ts`。PRD D82）

純粋関数。3段の区切りの**ただ1か所**。混み具合バー・〈スタッフ〉の3段バー・〈利用者さん〉の帯・凡例の見本（`LoadRowsSample`）・目盛りの文は全部ここを見る。

- `BAR_ROWS`（8〜12・12〜16・16〜20 時）・`BAR_START`・`BAR_END`・`BAR_STEP`（30分）・`DAY_MINUTES`
- `barRowsOf(slots)`：30分のマスを段に分ける
- `barEdges(slots, active)`：8時より前・20時以降で active なマス
- `placeOnRows(items)`：時刻の区間を段ごとの位置（0〜1）に切り分け、段に掛からない区間を early・late に
- `edgeLabel(side)`：「8時より前」「20時以降」
- `barRowsText()`：「上から 8〜12時・12〜16時・16〜20時」
- `rowRuns(slots, from, to)`：同じ level が続く30分を [left, width)（段に対する割合）の1本にまとめる。30分が抜ければ切る

#### 1日の数え方

- vacancy の `dayLoad` と `lib/staffBar` の `staffSlots` は **0:00〜24:00** の30分ごと（48マス）に数え、3段バーは 8〜20時を出す
- 8時より前・20時以降に active なマス（混み具合は working＞0、〈スタッフ〉は 訪問・移動・空き・案なし。休み・勤務外は数えない）があれば、`SlotBar` が1段目の左端の「8」を「◀」、3段目の右端の「20」を「▶」に替え（文字の印）、title と読み上げ（バーの aria-label の後ろ）に「8時より前：7:00〜8:00 訪問」などを足す
- 勤務の無い日の「休み」は 8〜20時だけ（0時〜8時を休みで埋めない。8〜20時の外は欠勤の前の稼働時間帯に重なるときだけ休み）
- seed は勤務が 8:00 から・訪問が 8:30 からなので、ふだん印は出ない（自宅からの移動が 8時より前に掛かる日だけ出うる）

### 〈スタッフ〉の30分の状態（`lib/staffBar.ts`。PRD D75〜D77）

純粋関数。

- `busyParts(stops)`：訪問と来る移動。移動は訪問の直前 [開始 − 来る移動, 開始) に置く（vacancy の `dayLoad` と同じ）
- `staffSlots({ shift, base, busy, planned })`：0:00〜24:00 の30分ごとの状態。決め方は 訪問＞移動＞空き（稼働時間帯に重なる。planned が false＝訪問があるのに案が無い日は「案なし」）＞休み（その日の稼働時間帯が無い、または欠勤の時間）＞勤務外。重なりは30分に少しでも重なれば数える（`dayLoad` と同じ）。訪問の無い日は空の案（planned。`dayLoad` の planOf と同じ）
- 混み具合の「空き N人」とその30分が「空き」の人の数は、今の案と確定した割当が同じ日（未確定の変更が無い日）は1日全体で一致する（テスト）。違う日はそろえない：混み具合は問い合わせへの答えなので確定を先に（`baseOf`）、〈スタッフ〉の表示は手直し中の今の案を先に（`dayPlanOf`）数える。月の凡例に一言出す
- `isAllRest(slots)`：8〜20時のマスが全部休み（訪問・移動が1つでも残れば false）
- `spanParts(stops)`：拘束の内訳（訪問のあいだを 待ち→移動 に分ける）
- `staffSlotText`・`staffSlotSummary`：title・読み上げ

### 混み具合（vacancy の `dayLoad`。PRD D54）

- `dayLoad(data, date, filter)`：0:00〜24:00 の30分ごとに `{ start, working, free }`（working＝その30分に稼働時間帯がある人、free＝そのうち元の案の訪問 [開始 − 来る移動, 終了) と重ならない人）。`filter.typeId` があれば、その種類の必要条件を満たす人だけを数える。案の無い日は null
- 月の予定の全体の表示で日のマスに出す。数える人（すべて／〈種類〉）は月の「混み具合：空きを数える人」の選択

### 描く部品

#### `components/loadBar.tsx`

- `SlotBar({ slots: { start, level, title }[] | null, label, emptyText, testId, cover? })`：3段の描画。段は `rowRuns` で `.bar-seg` を置き、その上に透明な30分のマス `.load-slot`（title だけ。`is-〈level〉` の class も残す）を並べる。30分の計算・title・読み上げ・端の印は `SlotBar` の外で決める
- `cover`：3段とも休みなら、3段の上に1枚の灰と「休み」（aria-hidden。読み上げはまとめの文のまま）
- `LoadBar`：`SlotBar` の上に作る混み具合のバー
- `LoadRowsSample`：凡例の見本

#### `components/staffBar.tsx`

- `StaffBar`：level は `st-〈状態〉`。`isAllRest(slots)` のとき `cover` を渡す
- `StaffLegend`：状態の凡例

#### `components/workBars.tsx`（勤務の見込み・日の予定）

- `SpanBar`：日ごとの横棒（拘束の中を訪問・移動・待ちで塗り分け。上限を超える日は太い橙の枠）。3段にはしない（1日の時間軸の上の位置と拘束の長さを見るため）
- `SpanMini`：〈スタッフ〉×日の表の長さと上限の線
- `PartsBar`：`SpanBar` と同じ塗り（`work-part bar-seg is-st-*`）。勤務の時間の背景は空き、勤務外は地の薄い灰。日の予定の担当ごとの1日（`DayLines`）

#### `components/clientBar.tsx`（週の〈利用者さん〉×曜日）

- `ClientDayBar`：3段の帯の上に訪問を種類の色で置く（`placeOnRows`）。帯の地と休み・案なし・入らない。中身の動きは [pages-week.md](pages-week.md)

#### 日の予定の担当ごとの1日（`lib/dayLine.ts`・`components/dayLines.tsx`）

[pages-plan.md](pages-plan.md) の「担当ごとの1日」。

### 見た目（PRD D85）

#### 色・形の言葉（`components/barMarks.css` の1か所）

| CSS 変数 | 色・形 |
|---|---|
| `--bar-visit` | 濃い青 |
| `--bar-travel` | 橙 |
| `--bar-free` | 淡い緑（枠は付けない。1時間ごとに格子に見えないように。不透明な灰の地 `--bar-track` と、月の確定済み・案ありのマスの緑の地より少し濃い緑で見分ける） |
| `--bar-noplan`＋`--bar-noplan-line` | 淡い無地と破線 |
| `--bar-rest` | 淡い灰 |
| `--bar-track` | 段の地（不透明。月のマスの緑の地を透かさない） |
| `--bar-gap` | 1時間の隙間 |
| `--bar-hour-gaps` | 1時間の隙間の背景（段の 1/4・2/4・3/4 の境界の前後 1px。端には描かない） |
| `--load-none` | 濃い赤（空き0人） |
| `--load-one` | 橙（1人） |
| `--load-many` | 緑（2人以上。地と見分けられる濃さ） |

- 連続の塗り `.bar-seg.is-〈level〉`（level は `st-〈状態〉` か混み具合の `none`・`one`・`many`・`off`）
- 1時間ごとの区切り `.bar-hours`（段の上に重ねる 2px の隙間。1段＝4時間を4ブロック）
- 使うのは `SlotBar`（`LoadBar`・`StaffBar`）・凡例の見本 `BarSwatch`・`LoadRowsSample`・`ClientDayBar`・`PartsBar`・`glance`（`lv-*`・日ごとの点・`.prep-bar`）
- `ClientDayBar`：1時間の隙間は帯の下の地（`.cbar-track` の背景）にだけ描き、短い帯を割らない。案なしは種類の色 `--tc` を淡くした地と破線の枠。帯の重なりは `--cz`、フォーカス中は z-index 3
- `PartsBar`：時間軸の1時間の隙間は軸の中の正時ごとの `.work-hour`（境界の前後 1px。両端には描かない）

#### 形でも分ける（色だけにしない）

- 訪問＝段いっぱい、移動＝高さ半分で段の中央、案なし＝破線の枠、休み＝3段とも休みなら `cover`
- 混み具合は下にそろえた高さ：0人＝いっぱい・1人＝2/3・2人以上＝1/3、働く人なし＝描かない（凡例も同じ）

#### 休みの二重を避ける

- 週の〈スタッフ〉×曜日：訪問の無い終日の休みは、マスの下の「休み」を `sr-only`。マスの地 `td.is-off` は淡く
- 月（〈スタッフ〉選択）：勤務の無い日の頭の「休」を `isAllRest` のとき `sr-only`（欠勤・希望休・最終勤務日の後の文字は残す）

### 各画面での使い方

| 画面 | 中身 |
|---|---|
| 月・全体 | 日のマスに `LoadBar`（`dayLoad`）。見出しに目盛りと凡例 |
| 月・〈スタッフ〉選択 | `StaffDay.bar`（`staffDay` が数える案＝`dayPlanOf`（今の案、無ければ確定した割当）の lenient の時刻から作る。案の無い日は勤務内を「案なし」）。件数・目安・移動・勤務時間は `aria-label`・title |
| 週・〈スタッフ〉×曜日 | `WeekCell.bar`（`staffWeekTable` が作る。今の案、無ければ確定した割当。案の無い日は勤務内を「案なし」）。マスは3段バー＋件数。稼働・移動・種類の内訳は title と読み上げ。表の上に凡例 |
| 週・〈利用者さん〉×曜日 | `ClientDayBar` |
| 日 | `DayLines` の `PartsBar` |
| 勤務の見込み | `WorkStat.parts`（`spanParts`）を `SpanBar` で。〈スタッフ〉×日は `SpanMini` |
| 空き状況 | `lv-*` の段階の色（下） |

### 一目で分かる小さい表示（`lib/glance.ts`・`components/glance.tsx`。PRD D78〜D81）

#### `lib/glance.ts`（純粋関数。テストあり）

- `vacancyLevel(cell)`：空き状況のマスの段階。unknown＝案なし／none＝どの週も0人／partial＝0人の週がある／one／two／three／many（`VacancyCell.min`＝どの週でも受けられる人数で決める）
- `inquiryRows(result, wish)`：希望の曜日（空＝全曜日。月〜日の順）×その曜日の日。行は希望の開始時刻 from〜to（両端を含む）の開始時刻ごとの `verdictOf` のうち一番良いもの（ok＞partial＞ng＞unknown、同じなら受けられる週の多い順・人数の最小の多い順・早い順）を開始時刻 start にし、判定もその時刻の `verdictOf`（要約 `inquirySummary` と同じ決め方。どこかの時刻に1人いるだけでは ○ にしない）。日のマスはその開始時刻のその日の人数 best と ○（best≥1）×？（案が無い日）。行の頭に開始時刻、目安のときは人数に「約」
- `inquiryDayLevel`
- `prepParts(progress)`：訪問のある日を 確定済み・案あり（未確定）・案なし の日数に（今日以降の訪問のある日。案あり（未確定）には未確定の変更ありの日も含む）。進み具合の帯の下の縁
- `clientDot(clientDay)`：訪問が1件でもあれば訪問あり、無ければ 当日キャンセル＞取り消し＞休み、何も無ければ訪問なし

#### `components/glance.tsx`（`glance.css`）

- 段階の色 `lv-*`：0人（受けられない）＝薄い灰の地と灰の文字（×。枠なし）、0人の週がある・1人＝淡い橙、2人以上＝緑で多いほど濃い、案なし＝淡い無地（文字を載せるので淡い色）。受けられない時間帯は手当てが要るものではないので赤にしない（赤は要対応だけ。PRD D228）
- `LevelLegend`
- `ClientDots`：7列のカレンダーの並びの点。形でも分ける（丸・三角・白抜きの丸・灰の四角・小さな点）。月の〈利用者さん〉を選んだときの右の欄（数えるのは `clientDay`＝今の案、無ければ確定した割当）

### 完了の条件

- [ ] `lib/barRows`（段・端の印・区間の切り分け・`rowRuns`）・`lib/staffBar`（30分の状態の決め方・`dayLoad` の空きの人数と一致（8時より前・20時以降でも）・週と月のバーが同じ・拘束の内訳の合計が訪問・移動・待ちと一致・`isAllRest`）・`lib/dayLine`・`lib/glance`（空き状況の段階・曜日×週のマス・準備の内訳・〈利用者さん〉の日の点）のテストが通る
- [ ] 週（〈スタッフ〉×曜日・〈利用者さん〉×曜日）・月（全体・〈スタッフ〉選択）・日（担当ごとの1日）・空き状況・勤務の見込みを 1280px・390px で見て、1段が1時間の4ブロック・訪問が一目で分かる・3段とも休みの日が「休み」の1枚に見える
