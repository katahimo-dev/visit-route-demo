# 週の画面

> この画面のファイル：`src/pages/WeekPage.tsx`（`week.css`）・`mailPanels.tsx`（`WeekMailPanel`）、`src/components/PickChips.tsx`・`clientBar.tsx`・`staffBar.tsx`、`src/lib/week.ts`・`weekView.ts`・`timelineClients.ts`・`fold.ts`・`clientFilter.ts`。関連 ADR：0012 追記・0013・0014・0021・0024 追記・0025 追記。関連 PRD：D49〜D51・D56〜D57・D62・D65・D75・D83・D93・D108・D136〜D140・D175・D188・D221・D222。
> 3段のバーと〈利用者さん〉の帯の塗りは [pages-bars.md](pages-bars.md)、絞り込みの欄 `ClientFilter` は [pages-clients.md](pages-clients.md)。

### 週の画面（`#/week`）

#### URL とクエリ

| クエリ | 意味 |
|---|---|
| `?d=YYYY-MM-DD` | その日を含む週（月曜はじまり）。無ければ選んでいる日の週 |
| `?view=`・`?by=` | 表示（`weekViewOf`。下） |
| `?staff=s1,s2` | 時間軸の〈スタッフ〉のチップ（無ければ全員） |
| `?client=` | 時間軸の〈利用者さん〉（無ければこの週の先頭8人。空なら0人） |
| `?cf=` | 〈利用者さん〉×曜日の表の絞り込み（`encodeFilter`。既定のままなら消す） |

URL を書くときは履歴を増やさない `replace`（表示の切り替えは除く）。

#### 見出しと並び

- ［月｜週｜日］・`lead`「日時をドラッグでずらし、〈スタッフ〉の偏りを見ます」・週の前後の送り・「今週」
- 表示の切り替え `week-views`（見出しの行。下）
- 進み具合の帯 `ScheduleBand date={anchor}`（週は選んでいる日付の月。[pages-home.md](pages-home.md)）
- 空の画面（`week-empty`。時間軸の上に横1行の帯 `compact`。主ボタンにしない（帯に主ボタンがある））：`periodEmptyGuide`（案が無い・訪問が無い。［この週の案を作る］で月のまとめて作るの欄が開き `?do=` が消える・日の画面のボタン。案ができたら出さない）

#### 表示の切り替え（PRD D188）

- `lib/weekView.ts`（純粋関数。テストあり）：
  - `WeekView`＝`timeline-staff`・`timeline-client`・`table`・`clients`（`WEEK_VIEWS` の順）
  - `weekViewOf(view, by, narrow)`：view が `table`・`clients` ならその表（by は見ない）、それ以外（無い・`timeline`・知らない値）は時間軸で、`by=client` なら〈利用者さん〉、ほかは〈スタッフ〉。ただし narrow（600px 以下。`lib/useMedia` の `COMPACT_QUERY`）で view も by も無ければ〈スタッフ〉×曜日の表（PRD D222。下の「狭い画面の既定」）
  - `weekViewParams(v, narrow)`：時間軸は `view` を消す、`timeline-client` は `by=client`、表は `by` を消す。narrow の `timeline-staff` だけは既定（表）と分けるため `view=timeline` を書く（押したら必ず書く。月の `?layout=` と同じ。書いた URL は広い画面でも同じ表示）。`?staff=`・`?client=`・`?cf=` は触らない
  - `weekViewLabel(v, terms)`：「時間軸：〈スタッフ〉」「時間軸：〈利用者さん〉」「〈スタッフ〉×曜日」「〈利用者さん〉×曜日」
  - `isTimeline`
- 切り替え `week-views`（`fieldset.segmented`・`aria-label="表示"`。ボタンの data-testid は `by-staff`・`by-client`・`tab-table`・`tab-clients`）。600px 以下は2列×2段
- `goView(v)`：今の表示なら何もしない。〈利用者さん〉×曜日の表から時間軸（どちらでも）へは `handoffFromTable`（下）

#### 狭い画面の既定（PRD D222）

- 600px 以下で `?view=`・`?by=` が無ければ〈スタッフ〉×曜日の表で開く（URL に書かない。幅で決めるのは月の日ごとの一覧（D189）と同じ）。4つの表示のうち日ごとに1人1行で並び、マスが小さい3段バーで済み、名前の列を止めれば今日の列を名前と並べて見られるのはこの表だけ。時間軸は7列（`min-width: 860px`）を横に巻かないと今日が見えず、時間軸の〈利用者さん〉はチップが何行にもなり、〈利用者さん〉×曜日は行が多い
- 今日を見せる：今日を含む週なら、表示と週ごとに1回だけ、表の箱（時間軸は枠）を今日の列（`th.is-today`・`.week-day-head.is-today`）が止めた列（名前・時刻）のすぐ右に来るまで横に巻く（`lib/scrollEdge` の `scrollLeftToShow`）。開いて最初の1回だけ、今日の列の見出しが下のタブの裏・画面の下にあれば上の帯のすぐ下まで縦にも巻く（月の日ごとの一覧と同じ。表示を切り替えたときは巻かない）
- 600px 以下：表は名前の列、時間軸は時刻の列（`.week-corner`・`.week-gutter`）を止め、今日の列の見出しの地を淡い朱に。表の箱は `EdgeScroll`（右に続きがあるあいだ右の端をぼかす。[pages.md](pages.md) の「狭い画面の表」）
- 押した表示は今までどおり URL に書くので、`#/week?view=timeline` など URL のある開き方は幅によらず同じ表示

#### 時間軸（PRD D49・D56・D57）

- 列＝月〜日、縦＝`DAY_START` 07:00〜`DAY_END` 20:00（1時間ごとの目盛り。`lib/week`）
- 訪問の帯：その日の今の案（無ければ確定した割当、どちらも無ければ訪問の開始（早））の lenient の開始〜終了の位置に、種類の色で（文字：時刻・〈利用者さん〉・担当の名前）。帯の縁は〈スタッフ〉で見るとき担当の色、〈利用者さん〉で見るとき〈利用者さん〉の色
- 全員のとき、同じ時刻に重なる帯は列の中で横に並べる（`laneLayout`）
- 未割当・入らない訪問は破線の枠。担当が `visitType` の理由で可でない帯は赤い枠と「資格✗」
- 休みの訪問は薄い破線の帯で、担当の所に「休みのため無し」（ドラッグしない。押すとその日の日の画面）
- 帯を押すとその日の日の画面へ（その訪問を選ぶ）。日の見出しを押すとその日の日の画面へ
- 〈スタッフ〉で見る：`PickChips`（複数・全員・全解除。`?staff=`）。資格のチップ（項目「資格」の選択肢。押すとその資格を持つ人を選ぶ。`staffWithQualification`）と名前の資格バッジ（`QualificationBadges`。選択肢の頭文字を2字まで。`title` に正式名。`qualificationBadges`）。チップの i（`detailKind="staff"`）
- 〈利用者さん〉で見る：下の「時間軸の〈利用者さん〉」

#### ドラッグ（PRD D50）

- 帯を別の日の列・時刻へドラッグ（15分刻みに丸める（`SNAP_MINUTES`）。範囲外は戻し「07:00〜20:00 の中に置いてください」）。取り消し・休み・今日より前は動かさない（`canMoveVisit`）
- ドラッグの始まりは `deferredDragStart`（つかんでから DOM を変えない）
- ドラッグ中は、その訪問を担当できる人（可否。compile の allowed。`allowedStaffOf`）の名前のチップを強調し（チップの畳みは測り直さない）、落とす先の列に「入れる人 N人」（落とす日・時刻にした問題で reassign の `fitsOf` の人数。15分刻みのマスごとに memo。`fitCountAt`）
- 離すと欄（`SidePanel`）：「〈利用者さん〉 〈元の日 時刻〉 → 〈新しい日 時刻〉」と、パターンの訪問なら「この回だけ」（初期値）／「以降すべて（〈元の日〉以降の〈曜日〉の回を〈新しい曜日 時刻〉に）」、単発なら説明だけ。主ボタン「動かす」
  - この回だけ：訪問の日付・開始（早・遅。幅は保つ）を変え `pattern.edited` を true（`moveOnce`）
  - 以降すべて：`splitPattern`（since＝元の日、曜日は元の曜日を新しい曜日に入れ替え、時刻を新しい時刻に。`moveFollowing`）。確定した日が含まれれば確認
- 動かしたあと、新しい日に今の案があれば知らせに「〈日〉の案に空き時間で入れる」（`insertIntoPlan`：その日の問題で reassign の `fitsOf` の先頭の人に `placeVisit` で入れ、固定。他の人の訪問の開始は変わらない。入らなければ「空き時間に入りません。その日を作り直すか、日の画面で手で入れてください」）と「その日を作り直す」（日の画面へ）
- キーボード：帯にフォーカスして Enter で同じ欄を開き、日付・時刻を選んで動かせる

#### 〈スタッフ〉×曜日（PRD D51・D75）

- 行＝稼働中の〈スタッフ〉、列＝月〜日。行の名前は `PersonButton`
- マス：3段バー（`WeekCell.bar`。[pages-bars.md](pages-bars.md)）＋件数（小さく）。稼働時間・移動・種類ごとの件数（色の印と数）の内訳は title と読み上げ。表の上に凡例。この表にドラッグは無い
- 休み（稼働時間帯が無い日）はマスの地 `td.is-off` を淡く。訪問の無い終日の休みは、バーに重ねた「休み」と二重にしないよう、マスの下の「休み」を `sr-only` にする（読み上げは同じ）
- 行の端に週の合計（件数・稼働時間・移動）と、件数の全員の平均との差（±N件。差が平均の30%を超えると強調）。下の行に日ごとの合計
- 数えるのは、その日の今の案（無ければ確定した割当）。案の無い日は勤務内を「案なし」
- 「週の予定をメールで送る」（`week-mail`）→ 右の欄 `WeekMailPanel`（最終勤務日が週の初めより前の人は出さない。宛先ごとに `MailButton`）

#### 〈利用者さん〉×曜日（PRD D56・D83・D108）

- 表の上に `ClientFilter`（状態は `?cf=`。既定 `WEEK_TABLE_FILTER`（chips＝period）。既定のままなら消す。`replace`）
- 行は `filterClients` の結果を `clientWeekTable` に渡す（0人なら空で「当てはまる〈利用者さん〉がいません」）。`filterFacts(..., showEndedInPeriod: true)` で、この週に訪問がある人は終了でも出す。行の名前は `PersonButton`
- マス（`components/clientBar` の `ClientDayBar`）：3段の帯の上に訪問を種類の色で置き（`placeOnRows`）、その下に時刻の順の短い文字（担当の名字・休・取消・当日取消・入らない・案なし・代）
- 訪問の帯（段の最初の切れ端）はボタン（`week-citem`。押すと日の画面・Enter で動かす・ドラッグ。取り消し・休み・今日より前は動かさない）。段をまたぐ訪問の続きの切れ端は aria-hidden。段に掛からない訪問は端の「◀」「▶」のボタン
- 訪問を別の日のマスへドラッグすると時間軸と同じ欄（この回だけ／以降すべて。時刻はそのまま）。過去の日には動かせない
- `clientWeekTable`：取り消した訪問も入れ（訪問の開始（早）〜＋所要。`cancelled`・`sameDay`）、`substitute`（担当が定期パターンのいつもの担当、無ければ〈利用者さん〉のいつもの担当と違う）、`unassigned`（案はあるが入らない）、マスに `noPlan`（取り消し・休みでない訪問があるのに案が無い）。休みの訪問は薄い破線の帯と「休み」
- `clientItemMark(item, noPlan)`：印の種類と短い文字・読み上げの文

#### 時間軸の〈利用者さん〉（PRD D136〜D140）

- この週の人 `weekChipIds`＝`filterClients(clients, WEEK_TABLE_FILTER, facts, '')`（表の既定と同じ人・同じ順）
- `PickChips`（`bulk={false}`・`detailKind="client"`・`actions` に「全部外す」（`?client=` を空。この週に訪問が0人でも空にする。`clientParamOf` を通さない）「先頭8人に戻す」（`?client=` を消す））
- チップの✓と時間軸は同じ8人（URL に9人以上あっても `timelineClients`＝先頭8人をチップに渡す）
- チップを押して8人を超えるなら選ばず、チップの下の `output`（`week-client-chips-message`）に上限の文「時間軸は8人まで。表（〈利用者さん〉×曜日）なら絞り込んだ全員を見られます」。`output` はいつも描き（空なら高さ0）、出すたびにいったん空にしてから入れ直して読ませる（60ms 後）。`?client=`・週（`anchor`）・見る人（`by`）が変わったら消す（戻るボタンも）
- 畳む（PRD D140）：`PickChips` の `fold`（`rows=2`）。選んでいる人と2行ぶん、外す人がいれば最後に「あと N人」（開くと「畳む」）。開いているかは `WeekPage` の state（週を送っても、表と行き来しても残る。URL には書かない）
- その下に畳んだ details 要素「ほかの人を探す」の中に `ClientPicker`（`showChips={false}`。近道は〈スタッフ〉が担当する人・最近選んだ人。候補は利用中の人と、休止中でもこの週に訪問がある人）。選んだ人はチップの後ろに出る。印刷では「ほかの人を探す」を出さない
- 週を送っても `?client=` が無ければ初期値はその週から作り直す（URL は触らない）
- 表から時間軸へ移るとき（`handoffFromTable`。PRD D139）：`?client=` が無く表で絞り込んでいれば（`?cf=` が既定でない）、表で絞り込んだ人のうち時間軸の候補（`weekClients`）にいる人の先頭8人を `?client=` に書く。絞り込んでいなければ書かない（＝この週の先頭8人）

#### `lib/timelineClients.ts`（純粋関数。テストあり）

- `TIMELINE_CLIENT_MAX`（8）・`defaultTimelineClients(weekIds)`（先頭8人）
- `timelineSelection(param, weekIds, known)`：`?client=` があればそれ（候補にいる人だけ）、無ければ初期値。`isDefault` を返す
- `clientParamOf(ids, weekIds)`：初期値と同じ人（順は問わない）なら null（書かない）、ほかは「,」でつなぐ。0人は ''
- `timelineChipIds(weekIds, selected)`：この週の人のあとに、選んでいてそこにいない人
- `handoffFromTable({ hasParam, filtered, filteredIds, weekIds })`

#### `components/PickChips.tsx`

- 人のチップ（複数選ぶ）。`bulk`（既定 true。「全員・全解除」を出すか）・`detailKind`（名前の i。[pages-common.md](pages-common.md)）・`actions`（見出しの後ろ、「全員」「全解除」の位置に置く小さなボタン）・`fold`
- `fold`（`{ rows, open, onOpenChange }`）：全員を並べて各項目（`data-fold-item`）の上端を測り（`useLayoutEffect`。描く前）、`lib/fold` の `foldHidden(items, keep, rows, firstTop)`（純粋関数。テストあり。上端で行を分け、見出しの行も1行目に数える）で rows 行に入らない人のうち選んでいない人を外す。測り直すのは幅（`ResizeObserver`）・人・選んでいるか・見出しが変わったときだけ（ドラッグ中の強調では変えない）。開いているあいだも測っておく。外す人がいれば最後に「あと N人」（`aria-expanded`）
- `QualificationBadges`
- 〈利用者さん〉の担当できる人でも使う（`bulk={false}`）

#### `lib/week.ts`（画面の純粋関数。テストあり）

- `weekDates(date)`（月曜はじまりの7日）・`DAY_START`・`DAY_END`
- `laneLayout(blocks)`（重なる帯の横の並び）
- `moveOnce(d, visitId, date, start)`・`moveFollowing(d, visitId, date, start, today, newId)`（`splitPattern` を使う。パターンの訪問でなければ `moveOnce`）・`canMoveVisit`・`changedDates`
- `insertIntoPlan(d, date, visitId, problem)`・`fitCountAt`・`allowedStaffOf`
- `staffWeekTable(data, dates, problems)`（行・列・合計・平均との差・`WeekCell.bar`）
- `qualificationBadges(items, staff)`・`staffWithQualification`
- `clientWeekTable`・`clientItemMark`

#### 確かめ

- `scripts/e2e-drag.cjs`：6種類のドラッグと week-clients-ime（日本語の変換）。週の〈利用者さん〉で見るで、`?client=` なしで先頭8人のチップが選ばれ URL に書かない・9人目で上限の文・「全部外す」「先頭8人に戻す」（week-client-default・week-client-max・week-client-none-reset）
- `scripts/e2e-mobile.cjs`：390px で `?view=` なしは〈スタッフ〉×曜日の表で今日の列が見える（week-narrow-default）
- `scripts/e2e-week.cjs`：表示の切り替え（4つ・古い `?view=`・`?by=` の URL 9通りで同じ表示・押したときの URL・今の表示・戻る・390px で2段まで）、表からの引き継ぎ（絞り込みなし・あり）、9人目の上限の文、戻るボタン（選択が戻り上限の文が消える）、畳む・あと N人（1400px・390px。選んでいる人はいつも見え、選んでいない人は2行まで、開いた状態が残る）、週を送るとその週の先頭8人、「ほかの人を探す」で選んだ人がチップの後ろ
- `scripts/e2e-details.cjs`：チップの i・表の名前

#### 完了の条件

- [ ] 時間軸に、その週の訪問が種類の色の帯で出て、〈スタッフ〉で絞れる。帯をドラッグして別の日へ動かし「この回だけ」を選ぶと、その訪問だけが動き、パターンの他の回は変わらない。「以降すべて」を選ぶと、元の日以降の回が新しい曜日・時刻になる
- [ ] 動かしたあと「〈日〉の案に空き時間で入れる」で、その日の今の案に入り、他の人の訪問の開始は変わらない
- [ ] 〈スタッフ〉×曜日の表に件数・稼働時間・移動・種類ごとの件数・週の合計・平均との差が出る
- [ ] （ADR-0014）担当できる人を限った〈利用者さん〉の訪問をドラッグすると「入れる人」はその人たちだけ
- [ ] （ADR-0021）〈利用者さん〉×曜日の表を開くと、この週に訪問がある人が全員出る。地区・チップで減らせ、`?cf=` で開き直しても同じ。この週に訪問がある終了の人は表に出る
- [ ] （ADR-0024 追記）`#/week?by=client` を開くと、この週に訪問がある人がチップで並び（表と同じ順）、先頭8人が選ばれ、URL に `?client=` が無い。押すと付け外しでき、9人目は選ばずに上限の文。「全部外す」で「選んでいません」、「先頭8人に戻す」で URL から消える。週を送るとその週の先頭8人。「ほかの人を探す」でこの週に訪問の無い人を選ぶとチップの後ろに出る。表で絞り込んで時間軸へ移るとその先頭8人、絞り込まずに移ると初期値。チップの欄は選んでいる人と2行ぶんで「あと N人」
- [ ] （PRD D222）390px で `#/week` を開くと〈スタッフ〉×曜日の表で、URL に `?view=` が無く、今日の列が画面に見える。時間軸を押すと `?view=timeline` を書く
- [ ] `lib/week`（週の日付・重なりの並び・この回だけ・以降すべて・空き時間に入れる・表の合計と平均との差・`clientWeekTable`）・`lib/weekView`・`lib/timelineClients`・`lib/fold` のテストが通る
