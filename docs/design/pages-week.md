# 週の予定

> この画面のファイル：`src/pages/WeekPage.tsx`（`week.css`）・`mailPanels.tsx`（`WeekMailPanel`）、`src/components/PickChips.tsx`・`staffBar.tsx`・`visitParts.tsx`（札 `VisitChip`・マスに積む `ChipStack`）、`src/lib/week.ts`・`weekView.ts`・`weekPrep.ts`・`timelineClients.ts`・`fold.ts`・`clientFilter.ts`。関連 ADR：0012 追記・0013・0014・0021・0024 追記・0025 追記・0033・0042・0046・0056・0057。関連 PRD：D49〜D51・D56〜D57・D62・D65・D75・D93・D108・D285・D136〜D140・D175・D188・D221・D222・D228・D280・D282・D339〜D342。
> 3段のバーの塗りは [pages-bars.md](pages-bars.md)、札の3段と入れ物（`VisitChip`・`ChipStack`）・印・選ぶ・キー・ドラッグの落とし先の判定の共通の部品は [pages-common.md](pages-common.md) の「訪問の札の共通の部品」、絞り込みの欄 `ClientFilter` は [pages-clients.md](pages-clients.md)。
> 版2（ADR-0053）：担当は訪問に持つ。週の帯・表の担当は訪問の担当（`weekDay` は `visitsOn` の訪問から）。「未作成」「案なし」は無い

### 週の予定（`#/week`）

#### URL とクエリ

| クエリ | 意味 |
|---|---|
| `?d=YYYY-MM-DD` | その日を含む週（月曜はじまり）。無ければ選んでいる日の週 |
| `?view=`・`?by=` | 表示（`weekViewOf`。下） |
| `?staff=s1,s2` | 時間軸の〈スタッフ〉のチップ（無ければ全員） |
| `?client=` | 時間軸の〈利用者さん〉（無ければこの週の先頭8人。空なら0人） |
| `?cf=` | 〈利用者さん〉×曜日の表の絞り込み（`encodeFilter`。既定のままなら消す） |

URL を書くときは履歴を増やさない `replace`（表示の切り替えは除く）。

#### 見出しと並び（PRD D327・D332。ADR-0054）

- `lead`「この週の担当を見て、日時をドラッグでずらし、〈スタッフ〉に伝えたら確定します」。見出しは題名と1行の説明だけで、［月｜週｜日］・「予定をメールで送る」・週の主ボタンは下のナビの行（PRD D347 で書き直し）。「予定をメールで送る」（`week-mail`。日と同じ枠のボタン。どの表示でも出す。`mail` が入のとき。→ 右の欄 `WeekMailPanel`（最終勤務日が週の初めより前の人は出さない。宛先ごとに `MailButton`）。週のメールは見通しで、送っても確定にしない。PRD D346）。週の主ボタンは下の「この週の準備」
- 1行の状態（`week-status`。今日以降に訪問がある週だけ）：「この週の今日以降：確定済み N日・まだ伝えていない N日・未連絡の変更 N日（あるときだけ）・要対応 N件」。進み具合の帯は出さない（月の予定だけ）
- 操作の行（`ScheduleToolbar zoom="week"`。日・週・月で同じ並び。[pages-common.md](pages-common.md) の「予定の共通の部品」）：欠勤・キャンセルを登録（`sudden-open`。選んでいる日（今日より前なら今日）の日の予定で欄を開くリンク）・「AI で組む ▾」（範囲：この日・この週・この月）・元に戻す・やり直す。「その他 ▾」は出さない（メールで送るは表の上のボタン。PRD D344。ADR-0058）
- 範囲の提案の帯（`RangeProposalBand`）
- 週の前後の送り・「今日」・週を選ぶ欄（`week-title`）は見出しの下のナビの行（`ScheduleNav`。PRD D347。メールで送る・まとめて確定もこの行の右）。表示の切り替え `week-views` は週のカードの1行目（下）
- 空の画面（`week-empty`。時間軸の上に横1行の帯 `compact`。主ボタンにしない（主ボタンは見出しの1つ））：`periodEmptyGuide({ period: 'この週', dates, today, visitDays })`（この週に訪問が1日も無いとき「この週には訪問がありません」。ボタンは日の予定で訪問を足すだけ）
- 複数選択の帯（`SelectionBar`。時間軸の帯・表の札（〈スタッフ〉×曜日・〈利用者さん〉×曜日）・「+N」の一覧の行を Shift・Ctrl＋クリック／Shift・Ctrl＋Enter で選ぶ（スマホは長押し・「選ぶ」）。週を送ると外す）

#### この週の準備（PRD D280・D328。ADR-0046・ADR-0054）

- 見出しの主ボタン `week-next`（`data-kind`）を状態で1つ。決まりは `lib/weekPrep.ts` の `weekNext`（純粋関数。テストあり）：
  1. この週を組んでいる（`monthBatch.run` の `source==='week'` かつ `weekStart` がこの週）→「この週の担当を組んでいます…」（`making`。主ボタンの見た目のまま `aria-disabled`）
  2. 今日以降に訪問が無い →「この週の今日以降に訪問はありません」（`none`。ボタンなし）
  3. 問題の無い伝えていない日がある →「この週の問題の無い日をまとめて確定（N日）」（`confirm`）
  4. 問題のある日・未連絡の変更のある日だけ残る →「確定していない N日は日の予定で」（`rest`。ボタンなし。下に理由）
  5. 何も残っていない →「この週は確定済みです」（`done`。✓）
  - ほかの担当を組んでいる間（月の予定・空き状況から）は 3 を押せず（`aria-disabled`）、下に理由「担当を組んでいる間は確定できません。終わってから押せます」（data-testid `week-next-why`。id は `useId` で `aria-describedby`）
  - 600px 以下は短い文（確定は「この週をまとめて確定（N日）」）。印刷では出さない
- 担当を組むのは「AI で組む ▾」の「この週」（`useScopeItems`：`weekBatchDays`＝今日以降の伝えていない、訪問のある日を `monthBatch.start({ …, mode: 'all', source: 'week', weekStart })`）。終わると範囲の提案の帯で「反映する」
- 数え方：週の今日以降の日を `useDayStatuses`（月の予定・ホームと同じ）で数え、確定していない日を `bulkConfirmTargets(unconfirmed, statusOf, attentionList(…))`（月の D223 と同じ決まり）に通す
- 確定（`confirmWeek`）：組んでいる間は何もしない。独自の確認 `bulkConfirmDialog`（月と同じ見出し・日付・残す日）。1回の `update`（手の名前「N日をまとめて確定」）で日ごとに `confirmDay`
- 月をまたぐ週も1度に組む・確定する（2つの月の日）

#### 日の見出しの件数

- 日の見出しの件数 `week-day-count` は `weekDayCountText({ count, unassigned })`：「N件」、担当なしの訪問があれば「N件・担当なしM」、訪問が無ければ「0件」

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
- 今日を見せる：今日を含む週なら、表示と週ごとに1回だけ、表の箱（時間軸は枠）を今日の列（`th.is-today`・`.week-day-head.is-today`）が止めた列（名前・時刻）のすぐ右に来るまで横に巻く（`lib/scrollEdge` の `scrollLeftToShow`）。開いて最初の1回だけ、今日の列の見出しが下のタブの裏・画面の下にあれば上の帯のすぐ下まで縦にも巻く（月の日ごとの一覧と同じ。表示を切り替えたときは巻かない）。空の画面の案内（`week-empty`「この週は案がありません」）が出ているときは縦には巻かない（案内と次の一手を先に見せる。横の巻きはする）
- 600px 以下：表は名前の列（`z-index: 4`。マスの中の重なり（`.load-slot`・`.load-bar-cover` など。1〜3）より上で、右へ巻いても名前が上に見え押せる）、時間軸は時刻の列（`.week-corner`・`.week-gutter`）を止め、今日の列の見出しの地を淡い朱に。表の箱は `EdgeScroll`（右に続きがあるあいだ右の端をぼかす。[pages.md](pages.md) の「狭い画面の表」）
- 押した表示は今までどおり URL に書くので、`#/week?view=timeline` など URL のある開き方は幅によらず同じ表示
- スマホの基本は日の予定の日ごとのリスト（PRD D334・D338）。週の表は数をまとめて見る表示として残す。600px 以下の操作の行は1段（アイコン中心。[pages-common.md](pages-common.md)）。表では長押しか凡例の行の「選ぶ」（`week-select`。`SelectToggle`）で選び（押すと選ぶ・外す）、札をキーで動かすことも、ドラッグすることもしない

#### 時間軸（PRD D49・D56・D57）

- 列＝月〜日、縦＝`DAY_START` 07:00〜`DAY_END` 20:00（1時間ごとの目盛り。`lib/week`）
- 訪問の帯：その日の今の案（無ければ確定した割当、どちらも無ければ訪問の開始（早））の lenient の開始〜終了の位置に、種類の色で（文字：時刻・〈利用者さん〉・担当の名前）。帯の縁は〈スタッフ〉で見るとき担当の色、〈利用者さん〉で見るとき〈利用者さん〉の色
- 全員のとき、同じ時刻に重なる帯は列の中で横に並べる（`laneLayout`）
- 担当の無い帯は「担当なし」・要対応の赤い破線（`is-unassigned`。PRD D228）。凡例も「担当なし（要対応）」。帯の印は共通の判定（`useVisitLooks`。要対応・資格✗／限✗・未連絡の変更・ピン・この回だけ変更・仮押さえ。PRD D339）を時刻の横に（`VisitMarks`。帯は大の札で `data-size="l"`・`data-marks`）。担当が種類の必要条件・担当できる人に合わなければ赤い枠と「資格✗」「限✗」。今日より前の日の帯には要対応・資格✗／限✗を出さない
- 休みの訪問は薄い破線の帯で、担当の所に「休みのため無し」（ドラッグしない。押すと訪問の詳細の欄）
- 帯を押すと訪問の詳細の欄（共通の `useVisitItem`。Shift／Ctrl＋クリックは選ぶ）。日の見出しを押すとその日の「日の予定」へ
- 〈スタッフ〉で見る：`PickChips`（複数・全員・全解除。`?staff=`）。資格のチップ（項目「資格」の選択肢。押すとその資格を持つ人を選ぶ。`staffWithQualification`）と名前の資格バッジ（`QualificationBadges`。選択肢の頭文字を2字まで。`title` に正式名。`qualificationBadges`）。チップの i（`detailKind="staff"`）
- 〈利用者さん〉で見る：下の「時間軸の〈利用者さん〉」

#### キーボード（PRD D333・D340・D342。ADR-0055・ADR-0056・ADR-0057）

- 時間軸の帯（`week-band`）と「+N」の一覧の行（`week-list-visit`）は時間軸のキー（`useVisitKeys`）：↑↓ 15分・←→ 1日（週の外へ出たらその週へ `goWeek`）・Shift+←→ 隣の担当（利用中の〈スタッフ〉の順。担当なしから → は先頭）・Enter は欄・Delete で取り消し（確認）
- 表の札（〈スタッフ〉×曜日 `week-tvisit`・〈利用者さん〉×曜日 `week-citem`）は表のキー（`useVisitKeys({ layout: 'table' })`）：←→ 曜日（時刻はそのまま。週の外へ出たらその週へ）・↑↓ 隣の担当（`nextStaffFor(…, 'row')`。並びは〈スタッフ〉×曜日なら表の行の順、〈利用者さん〉×曜日なら利用中の〈スタッフ〉の順。担当できない人は飛ばし、端・いなければ「これより下に担当の行はありません」などの理由）・Shift+←→ は読まない・Enter は欄・Delete で取り消し（確認。取り消したらフォーカスは「元に戻す」）
- どれも Shift・Ctrl＋Enter は選ぶ・外す。今日より前・休み・取り消しの札は動かさない。動かしたあとフォーカスは動かした札（`focusVisitItem`。「+N」の一覧が開いていてその中にあれば一覧の行のまま。欄を閉じたときも同じ）で、その札は「+N」に隠さない（`keepId`）。「+N」の一覧の端の Tab・Shift+Tab は一覧を閉じて「+N」へ戻す。繰り返しの回は小さな帯で範囲（[pages-common.md](pages-common.md) の「訪問の帯をキーで動かす」）。スマホではキーを読まない

#### ドラッグ（PRD D50・D341）

- 落とし先の判定・影の文・色は共通（`lib/visitDrop`・`useVisitDrag`・`DropShadow`。[pages-common.md](pages-common.md) の「ドラッグの落とし先」）。置けない（取り消し・休み・今日より前の訪問・今日より前の日・ほかの人の行・7:00〜20:00 の外）は灰の斜線と理由「置けません：…」で落とせず、入らない（入れる人が0人・担当できない人）は赤い点線で落とせる（落とすと要対応）
- 帯を別の日の列・時刻へドラッグ（15分刻みに丸める（`SNAP_MINUTES`）。範囲外は「置けません：07:00〜20:00 の中に置いてください」の影）。取り消し・休み・今日より前は動かさない（`canMoveVisit`）
- ドラッグの始まりは `deferredDragStart`（つかんでから DOM を変えない）
- ドラッグ中は、その訪問を担当できる人（可否。compile の allowed。`allowedStaffOf`）の名前のチップを強調し（チップの畳みは測り直さない）、落とす先の列に「入れる人 N人」（落とす日・時刻にした問題で reassign の `fitsOf` の人数。15分刻みのマスごとに memo。`fitCountAt`）
- 帯を押す（Enter も）と訪問の詳細の欄（`components/VisitPanel.tsx`。[pages-common.md](pages-common.md)。PRD D301〜D304）。今日より前の訪問は見るだけ
- 離すと同じ欄が落とした日付・開始（幅は保つ）を入れた形で開き、繰り返しの回なら範囲（この回だけ（初期値）／これ以降／すべて）を選んで「保存」（週の移動の欄はこの欄にした）
  - この回だけ：`lib/visitEdit` の `savedVisit`（日付が変われば手作業の担当を外し `pattern.edited` を true）
  - これ以降・すべて：`lib/week` の `moveFollowing`（元の日以降の同じ曜日の回を新しい曜日・時刻に分ける。すべては今日以降で最初の回から）。確定した日が含まれれば確認
- 保存で日時が変わり、担当を選ばず、新しい日に今の案があれば知らせに「〈日〉の案に空き時間で入れる」（`insertIntoPlan`：その日の問題で reassign の `fitsOf` の先頭の人に `placeVisit` で入れ、固定。他の人の訪問の開始は変わらない。入らなければ「空き時間に入りません。その日を作り直すか、日の予定で手で入れてください」）と「その日を作り直す」（日の予定へ）
- キーボード：帯にフォーカスして Enter で訪問の詳細の欄を開き、日付・時刻を変えて保存できる。閉じるとフォーカスは帯

#### 〈スタッフ〉×曜日（PRD D51・D75・D342）

- 行＝稼働中の〈スタッフ〉、列＝月〜日。行の名前は `PersonButton`
- マス（`week-cell`・`data-date`・`data-staff`）：3段バー（`WeekCell.bar`。[pages-bars.md](pages-bars.md)）の下に、その人のその日の訪問の小さな札を時刻の順に積む（`ChipStack`・data-testid `week-tchips`。PRD D342）。そのあとに件数（小さく）。稼働時間・移動・種類ごとの件数（色の印と数）の内訳は title と読み上げ。表の上に凡例。担当なし・休みの訪問は札にしない
- 札（`VisitChip`・data-testid `week-tvisit`・`data-visit`・`data-size="s"`・`data-marks`）：時刻と〈利用者さん〉の頭文字（「9:00 図」。名前の最初の1字）と印（`VisitMarks`）。左の線は種類の色。読み上げ「9:00 〈名前〉さん・印の説明（選択中）（押すと訪問の詳細）」、title「9:00〜10:00 〈名前〉（印の説明）」
- 1マス3件まで（`CHIPS_PER_CELL`）。残りは「+N」（`chip-more`）を押すとそのマスの一覧（`chip-list`。見出し「M/D（曜） 〈名前〉さんの訪問 N件」。行は `VisitRow`・data-testid `week-list-visit`・担当は出さない（`hideStaff`））。一覧の動きは [pages-common.md](pages-common.md) の `ChipStack`
- 札：押す・Enter で訪問の詳細の欄（開いた札は「+N」に隠さない）、Shift・Ctrl＋クリック／Shift・Ctrl＋Enter で選ぶ・外す（今日より前・休みは選ばない）、キーで動かす（上の「キーボード」）。スマホは長押し・「選ぶ」（`week-select`）で選ぶだけ
- ほかの人・日のマスへドラッグ（札と一覧の行。ドラッグできるのは広い画面だけ）：担当（行）と曜日（列）が変わり、時刻はそのままで落とし先を判定（担当できない人のマス（`staffWhyOf`）は赤い影と理由・同じマスは何もしない）。落とすと、その日・その人を担当に選んだ訪問の詳細の欄（`VisitPanelRequest.staff`。担当できなければ「変えない」。確定した日の確かめ・繰り返しの範囲は欄）。影は `week-tdrop`。ドラッグ中は「+N」の一覧を薄くしてマウスを受けない
- 印刷では札と「+N」（文字だけ）を出し、一覧は出さない
- 休み（稼働時間帯が無い日）はマスの地 `td.is-off` を淡く。訪問の無い終日の休みは、バーに重ねた「休み」と二重にしないよう、マスの下の「休み」を `sr-only` にする（読み上げは同じ）
- 行の端に週の合計（件数・稼働時間・移動）と、件数の全員の平均との差（±N件。差が平均の30%を超えると強調）。下の行に日ごとの合計
- 数えるのは、その日の訪問の担当
- 週のメールは見出しの「予定をメールで送る」（`week-mail`。下の「見出しと並び」）から

#### 〈利用者さん〉×曜日（PRD D56・D108・D342）

- 表の上に `ClientFilter`（状態は `?cf=`。既定 `WEEK_TABLE_FILTER`（chips＝period）。既定のままなら消す。`replace`）。「訪問の種類」のチップ（PRD D285。`visitTypes={data.visitTypes}`、`?cf=` に `type:`）で、この週にその種類の訪問がある人に絞れる。種類で絞ったまま時間軸へ移るときの `?client=` の引き継ぎ（D139）は絞った人にそのまま効く（時間軸の `ClientPicker` に種類の絞り込みは足さない）
- 行は `filterClients` の結果を `clientWeekTable` に渡す（0人なら空で「当てはまる〈利用者さん〉がいません」）。`filterFacts(..., showEndedInPeriod: true)` で、この週に訪問がある人は終了でも出す。行の名前は `PersonButton`
- 表の上の凡例の行に札の読み方（`week-chip-legend`）「札は「時刻・担当の印」です。代＝いつもの担当でない・なし＝担当なし（要対応）・休＝休みのため無し・取消＝取り消し」
- マス（`week-ccell`・`data-date`・`data-client`）：その人のその日の訪問（取り消し・休みの回も）の小さな札を時刻の順に積む（`ChipStack`・data-testid `week-cchips`。PRD D342）。時刻の位置（3段の帯）は描かない（時刻の位置は時間軸で見る）
- 札（`VisitChip`・data-testid `week-citem`・`data-visit`・`data-size="s"`・`data-marks`）：時刻と担当の印（`StaffMark` の xs。いつもの担当でなければ「代」）・担当なしは「なし」（赤。`is-unassigned`）・休・取消・当日取消（薄く。`is-off`）と印（`VisitMarks`）。左の線は種類の色（種類なしは灰）。読み上げと title は「9:00〜10:00 種類・担当の名前さん（いつもの担当でない）・印の説明」（`clientItemMark`）
- 1マス3件まで、残りは「+N」の一覧（行は `VisitRow`・`week-list-visit`。担当・取り消し・休みの札も出す）
- 札：押す・Enter で訪問の詳細の欄、Shift・Ctrl＋クリック／Shift・Ctrl＋Enter で選ぶ・外す、キーで動かす（上の「キーボード」）、ドラッグ。取り消し・休み・今日より前は動かさない・選ばない。スマホは長押し・「選ぶ」
- 札・一覧の行を同じ行の別の日のマスへドラッグすると時間軸と同じ訪問の詳細の欄（この回だけ／これ以降／すべて。時刻はそのまま）。落とし先の判定は共通（今日より前の日・ほかの人の行・取り消し・休みは灰の斜線と理由で落とせない。影は `week-cdrop`）
- `clientWeekTable`：取り消した訪問も入れ（訪問の開始（早）〜＋所要。`cancelled`・`sameDay`）、`substitute`（担当が定期パターンのいつもの担当、無ければ〈利用者さん〉のいつもの担当と違う）、`leave`（休みのため無し）、`unassigned`（担当なし）
- `clientItemMark(item, names)`：印の種類（`visit`・`leave`・`cancelled`・`sameDay`・`unassigned`）と短い文字（担当の名字・休・取消・当日取消・担当なし）・読み上げの文

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
- `clientWeekTable`・`clientItemMark`（表の札の短い文字）

#### 確かめ

- `scripts/e2e-drag.cjs`：6種類のドラッグと week-clients-ime（日本語の変換）。週の〈利用者さん〉で見るで、`?client=` なしで先頭8人のチップが選ばれ URL に書かない・9人目で上限の文・「全部外す」「先頭8人に戻す」（week-client-default・week-client-max・week-client-none-reset）
- `scripts/e2e-mobile.cjs`：390px で `?view=` なしは〈スタッフ〉×曜日の表で今日の列が見える。案の無い週は案内が見え、縦に巻かない（week-narrow-default）
- `scripts/e2e-week.cjs`：表示の切り替え（4つ・古い `?view=`・`?by=` の URL 9通りで同じ表示・押したときの URL・今の表示・戻る・390px で2段まで）、表からの引き継ぎ（絞り込みなし・あり）、9人目の上限の文、戻るボタン（選択が戻り上限の文が消える）、畳む・あと N人（1400px・390px。選んでいる人はいつも見え、選んでいない人は2行まで、開いた状態が残る）、週を送るとその週の先頭8人、「ほかの人を探す」で選んだ人がチップの後ろ
- `scripts/e2e-details.cjs`：チップの i・表の名前
- `scripts/e2e-shared-parts.cjs`：表の札の複数選択・帯の見た目（時間軸と同じ `data-marks`）・ドラッグの落とし先の判定（今日より前の日は置けない・入る日へ落とすと落とした日の欄）、390px の長押しの選ぶ（`week-table-1400`・`week-clients-1400`・`week-table-390`）
- `scripts/e2e-chip-containers.cjs`：表の札（「時刻 頭文字」・3件まで・「+N」の一覧と Esc）・選ぶ・表のキー（→ 次の日・↓ 隣の担当・Enter 欄・Ctrl+Z）・ドラッグ（影の文・今日より前は置けない・落とすと欄）・〈利用者さん〉×曜日の札・3段の札の `data-marks`・390px の長押し・印刷で「+N」の一覧と選択の帯を出さない（`week-chips-1400`・`week-more-1400`・`week-drag-1400`・`week-chips-390`）

#### 完了の条件

- [ ] 時間軸に、その週の訪問が種類の色の帯で出て、〈スタッフ〉で絞れる。帯を押すと訪問の詳細の欄が開く。帯をドラッグして別の日へ落とすと同じ欄がその日時で開き、「この回だけ」で保存すると、その訪問だけが動き、パターンの他の回は変わらない。「これ以降」で保存すると、元の日以降の回が新しい曜日・時刻になる
- [ ] 動かしたあと「〈日〉の案に空き時間で入れる」で、その日の今の案に入り、他の人の訪問の開始は変わらない
- [ ] 〈スタッフ〉×曜日の表に件数・稼働時間・移動・種類ごとの件数・週の合計・平均との差が出る
- [ ] （ADR-0014）担当できる人を限った〈利用者さん〉の訪問をドラッグすると「入れる人」はその人たちだけ
- [ ] （ADR-0021）〈利用者さん〉×曜日の表を開くと、この週に訪問がある人が全員出る。地区・チップで減らせ、`?cf=` で開き直しても同じ。この週に訪問がある終了の人は表に出る。「訪問の種類」のチップで種類の訪問がある人に絞れる
- [ ] （ADR-0024 追記）`#/week?by=client` を開くと、この週に訪問がある人がチップで並び（表と同じ順）、先頭8人が選ばれ、URL に `?client=` が無い。押すと付け外しでき、9人目は選ばずに上限の文。「全部外す」で「選んでいません」、「先頭8人に戻す」で URL から消える。週を送るとその週の先頭8人。「ほかの人を探す」でこの週に訪問の無い人を選ぶとチップの後ろに出る。表で絞り込んで時間軸へ移るとその先頭8人、絞り込まずに移ると初期値。チップの欄は選んでいる人と2行ぶんで「あと N人」
- [ ] （PRD D222）390px で `#/week` を開くと〈スタッフ〉×曜日の表で、URL に `?view=` が無く、今日の列が画面に見える（案の無い週は案内が見え、縦に巻かない）。時間軸を押すと `?view=timeline` を書く
- [ ] （ADR-0056・ADR-0057）〈スタッフ〉×曜日の表のマスに、その人のその日の訪問が小さな札（「9:00 図」）で3件まで出て、4件目からは「+N」（押すと一覧・Esc で閉じフォーカスは「+N」）。札を押すと欄・Ctrl＋クリックで選べ、→ で次の日・↓ で下の担当へ動く（時刻はそのまま。Ctrl+Z で戻る）。動かした札は「+N」に隠れない。別の人・日のマスへドラッグすると、その人を担当に選んだ欄が開く（担当できない人・今日より前の日は影と理由）。〈利用者さん〉×曜日のマスも札（時刻と担当の印）で、選ぶ・キーで動かす・同じ行の別の日へドラッグができる。札の印は時間軸・月・人の予定表と同じ。390px は「選ぶ」と長押しで選べる
- [ ] `lib/week`（週の日付・重なりの並び・この回だけ・これ以降（`moveFollowing` の over も）・空き時間に入れる・表の合計と平均との差・`clientWeekTable`）・`lib/weekView`・`lib/timelineClients`・`lib/fold` のテストが通る
