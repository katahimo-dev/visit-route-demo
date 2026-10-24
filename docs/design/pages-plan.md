# 日の予定（予定と AI の提案）

> この画面のファイル：`src/pages/PlanPage.tsx`・`planParts.tsx`・`mailPanels.tsx`（`DayMailPanel`）・`plan.css`、`src/components/routeView.tsx`・`routeTimeline.tsx`・`MapDock.tsx`・`MenuButton.tsx`・`dayLines.tsx`・`visitType.tsx`・`VisitRules.tsx`・`mapsLinks.tsx`、`src/lib/useDayModel.ts`・`dayPlan.ts`・`reassignMenu.ts`・`scoreReason.ts`・`routeView.ts`・`timeline.ts`・`dayLine.ts`・`confirmDay.ts`、`src/components/Toast.tsx`。関連 ADR：0004・0007〜0010・0012・0013・0015・0018・0025・0028・0030・0031・0044・0053・0056。関連 PRD：D16〜D18・D20・D21・D23〜D25・D58・D63・D84・D91〜D101・D157・D158・D173〜D174・D201〜D209・D217〜D219・D224・D266・D269・D314〜D319・D323・D339〜D341。
> 版2（ADR-0053）：担当は訪問に持ち（`Visit.staffId`・`start`・`pinned`）、その日の割当は `lib/dayPlan` の `dayRoutes`。この節で「今の案」とあるのはその日の訪問の担当のこと
> 欠勤・キャンセルの欄と振り直しは [pages-plan-absence.md](pages-plan-absence.md)、バーの塗りは [pages-bars.md](pages-bars.md)。

### 日の予定（`#/plan`。ADR-0009）

その日の訪問の担当・AI の提案（出す・反映する・やめる）・手直し（ドラッグ・「担当を変える ▾」）・ピン・「確定（伝えた）」を1画面で扱う。古いリンクの `#/schedule` は `#/plan` へ移す。

#### URL とクエリ

| クエリ | 動き |
|---|---|
| `?date=YYYY-MM-DD`（`?do=` なし） | その日を選び `?date=` を消す（`dateParam` の effect） |
| `?date=…&do=absence`（`SUDDEN_DO`）［`&staff=`］ | その日を選び「欠勤・キャンセル」の欄を開く。`&staff=` の人がその日に働く（`slotsOf` の `baseSlots` がある＝`staffChoices` に出る）ときだけ `openSudden({ kind: 'staff', staffId })`（2段目）、ほかは1段目。`?do=`・`?date=`・`staff` を消す。日付を変えると欄を閉じる effect より後に開くよう、開く日を覚えて日付が変わってから開く |
| `?date=…&do=unassigned`（`UNASSIGNED_DO`） | 下の「`?do=unassigned`」 |
| `?date=…&do=recreate` | 設定の画面の帯（今日の案を試す重みで作り直す）から。その日を選び自動作成を止め、URL から消して、問題ができたら `recreate()`（手直し・固定があれば確認）。受けている間はどの日の自動作成も始めない |

選んでいる日付は `useDay`（`DayProvider`）。ツアーは `?do=` のリンクでは出ない。

#### 並び（PRD D63）

1. 見出し（`PageHeader`。[pages-common.md](pages-common.md) の「画面の見出しとボタンの3段」）：題名・1行の説明。すぐ下にナビの行（`ScheduleNav`。PRD D347。ADR-0060）：「今日」・‹ 日付（`.date-switch select`）›・［月｜週｜日］・右に状態の印・メールで送る・主ボタン「確定（伝えた）」（確定済みの日は枠のボタンにして主ボタンを置かない。PRD D238）
2. 進み具合の帯は出さない（月の予定だけ。PRD D332）。日の状態は見出しの状態の印と下の1行のまとめ
3. 1行のまとめ：訪問 N件・入らない N・守れない条件 N・移動 N分・点数 N点（`plan-oneline-score`・`plan-score`。点数に用語の説明「点数」（`Term k="score"`。PRD D307）。title「「〈名前〉」の重みで付けた点数」。点数の文字は地の色で、入らない・必須の違反があるときだけ `.is-alert` で要対応の赤。PRD D266）・点数の理由（`plan-reason`）・次の一手（`reason-next`。理由のすぐ後ろ、同じ行。PRD D237）・「詳しく」。入らない・守れない条件の数（1件以上）は押すと吹き出しの一覧（`components/PlanIssueCount`・`plan-dropped`・`plan-hard`。行の「見る」`-look`・「開く」`-open`・関連の画面 `-link`（`lib/hardLinks`）。入らないの下に「担当なしの列へ」`plan-dropped-none`。PRD D345）
4. 操作の行（下の 6。日・週・月で同じ位置＝状態の1行のすぐ下。PRD D344。ADR-0058）と、開いていれば使い方の説明（`plan-help`）
5. 担当ごとの1日（`DayLines`。下）。操作の行が間に入るので、1行のまとめとはつなげず別のカード（PRD D237 のつなげ方は D344 でやめた）
5b. あるときだけの帯（ドラッグ中には増減しない）：問題を作れない・採点できない・提案の帯（日のその場の提案 `data-kind="day"` と範囲の提案 `data-kind="range"`。[pages-common.md](pages-common.md) の「予定の共通の部品」）・入らない訪問（`band-unassigned`・「見る」）・欠勤の振り直し（`band-reassign`・「差の欄へ」）・休み（`band-leave`）・条件が変わった（`plan-stale`）・拘束超え（`band-over-span`）
6. 見出しの右：状態・「予定をメールで送る」（`day-mail`。枠。`mail` が入のとき。PRD D306）・主ボタン「この割当で確定」。操作の行（`ScheduleToolbar zoom="day"`・`plan-toolbar`。日・週・月で同じ並び。PRD D327）：「欠勤・キャンセルを登録」（`sudden-open`）・「AI で組む ▾」は枠、「元に戻す」「やり直す」（`undo-btn`・`redo-btn`。全体の履歴。PRD D329）は文字のボタン（`btn-text`。PRD D238）・表示［時間軸｜順番｜一覧］・「訪問を追加」（`plan-visit-add`。〈利用者さん〉がいなければ `aria-disabled` と title に理由）・「使い方」（`plan-help-btn`・`aria-pressed`。開いていれば「使い方を閉じる」）（600px 以下は「その他 ▾」（`MenuButton`・`plan-more`）に訪問を追加・表示・使い方（`plan-more-help`）。PRD D334・D344）・計算中の進み具合と止める（回数とバーは `PlanProgressText` が外の入れ物 `lib/valueStore` から読み、画面全体は描き直さない。PRD D249）。「使い方」は操作の行の下に説明 `plan-help` を開きフォーカスを移す（「使い方を閉じる」）
7. 欠勤の差の欄（本体のすぐ上。[pages-plan-absence.md](pages-plan-absence.md)）
8. 本体（時間軸か順番か一覧。600px 以下は日ごとのリストが既定）と、その下に全幅の地図（`plan-map`。1280px 以上は高さ 600px、狭い画面は 420px。比較の画面と同じ形。PRD D300）。地図が画面の外にあるあいだは `MapDock` で右下に浮かせ、〈スタッフ〉・区間・訪問を選ぶと開く

#### 状態の印と確定（PRD D316。ADR-0053）

- 状態の印（`confirm-state`）は `lib/dayPlan` の `toldStateOf`：まだ伝えていない（`'none'`）／確定済み（`'told'`）／未連絡の変更あり N件（`'changed'`。押すと連絡の一覧）
- 主ボタン「確定（伝えた）」（未連絡の変更があれば「確定し直す（伝えた）」、確定済みなら枠で押せない）：独自の確認（見出し「この担当と時刻を伝えたので、確定しますか？」／「変更を伝えたので、確定し直しますか？」。要対応の訪問があれば本文の先頭に「要対応の訪問が N件あります。」）のあと `lib/confirmDay` の `confirmDay(d, date, problem, at)`（＝`tellDay`）で今の担当・開始を `snapshots[date]` に書く
- 連絡の一覧の帯（`band-told`）：未連絡の変更があるとき「伝えたあとに変わった訪問 N件」と［連絡の一覧］（`toldChanges`。担当が外れる・入る・時刻が変わる。〈スタッフ〉ごと）
- 確定済みのとき、印の横に「次の確定していない日へ（10/23）」（`planParts` の `NextUnconfirmed`・`plan-next-unconfirmed`・`data-date`。PRD D224）：その日より後の最初の確定していない日へ
- すべての訪問を取り消すと担当の欄・列は出ず「確定（伝えた）」も出さない

#### 1行のまとめと点数の理由（PRD D173）

- 点数は 100点満点。点数・必須の違反・条件ごとの達成は、いつも点数の基準のプリセットの重みで付ける（ADR-0010。`useDayModel` の `scoreProblem`）。必須の違反がある案の点には「参考」の印（`RefMark`・`score-ref`。`HARD_NOTE`）
- `lib/scoreReason.ts`（純粋関数。テストあり）：`scoreReason(parts, score, { achievements, rules, ruleLower })`
  - 必須の違反があれば「守れない条件 N件」、入らない訪問があれば「入らない訪問 N件」を先に
  - 減点の合計が0.5点未満なら null
  - それ以外は減点の内訳（evaluate の `hundredBreakdown`）のいちばん大きい成分を短い文に：移動が長め（N分）・空き時間（待ち）が長め（N分）・担当の条件（`perRule` の points の下限 `ruleLower`（evaluate の `ruleLowerBounds`）からの超過が最大の条件。必須の条件は外す。相性△が N件・いつもの担当でない訪問 N件・「名前」に合わない訪問 N件、外れが無ければ「相性◎を取り逃した訪問がある」など）・件数の偏り（目安から外れた人 N人）
  - 新しい採点は足さない。`scoreReasonLabel`（読み上げ・title）
  - evaluate の `ruleLowerBounds(problem)`：normalize の割当の下限を条件ごとに分けたもの（各訪問で割当費用が最小の担当の理由の点の和。和は lowerAssign と同じ）
  - 次の一手 `nextStep`（PRD D229。`NEXT_STEP_TEXT`）：移動が長め＝「「移動を短く」で組む」（`shortTravel`）、入らない訪問＝「受けられる人を見る」（`candidates`）、相性△・×・◎の取り逃し＝「相性の表を開く」（`compat`）。ほか（必須の違反・待ち・偏り・ほかの担当の条件）は無し
- `lib/useDayModel.ts` は `scoreRules`（点数の基準の条件。名前と重みを理由の文に使う）を返す
- `pages/planParts.tsx` の `ScoreReasonText`：↘ と短い文。読み上げの前置き「点を下げているいちばんの理由：」は sr-only。使う所は日の予定の今の案の帯（`plan-reason`）と比較の画面（`compare-reason`）
- `planParts.tsx` の `ScoreNextStep`：1行のまとめの中、理由のすぐ後ろに「次の一手：［…］」（`span.score-next`。PRD D237・data-testid `reason-next`・`data-kind`、操作は `reason-next-action`）。`shortTravel` は「AI で組む ▾」の「移動を短く」と同じ（プリセット ID `travel` か名前「移動を短く」。無い・今の案がそれ・計算中なら出さない）、`candidates` は `unassignedHref(date)`（「入らなかった訪問」の列へ巻く）、`compat` は `#/compat`（`compat` を切っていれば出さない）。印刷では出さない
- 点数の説明（`HundredHint`）は決め方と減点の内訳だけ。内部の費用（「費用 N（内部の値…）」）は出さない（PRD D229）
- `planParts.tsx` の文（PRD D307）：`SCORE_TEXT`（「理想の割当を100点として、訪問1件あたり余計にかかった分だけ引いた点」）・`rulerText(name)`（「点数はいつも「〈名前〉」の重みで付けます。条件を変えても、点の付け方は変わりません」）・`HARD_NOTE`（「必須を守れていない案の点は、ほかの案と比べられません。参考の点です」）。「点数の決め方」（`HundredHint`）は `hint-list` の箇条書き（下がった点は「下がった点：移動 −N点・…」）

#### 「AI で組む ▾」と提案（PRD D315・D317・D318。ADR-0053）

- 操作の行の `MenuButton`（`plan-menu`）。項目：「AI で組む（範囲）」のまとまり＝この日（M/D）を組む（`ai-scope-day`。その場の提案）・この週を組む（`ai-scope-week`）・この月を組む（`ai-scope-month`。月の予定の欄へ。範囲の項目は日・週・月で同じ `useScopeItems`。PRD D328）／「〈プリセット名〉」で組む（`plan-menu-preset`。点数の基準のほかのプリセット。条件の重みを切ると出さない）／2つの提案を比べる（`plan-menu-compare`。比較の画面へ。提案を比べるを切ると出さない。メニュー・パレットからは開かない。PRD D331）／ピンをすべて外す（N件）（`plan-menu-unpin`。ピンが無ければ押せず理由）。計算中・訪問が無いときはこの日・プリセットを押せず理由
- 提案（`propose(preset?)`）：点数の基準の重み（プリセットなら `applyPreset` を反映した重み）で compile し、ピンを `pins` に渡して `runSolve`。結果は PlanPage の外の入れ物 `dayProposalStore`（`{ date, label, routes, visits, absences, stopped }`。1つだけ・保存しない・読み直すと消える）。画面を移っても・日付を変えても捨てず、帯はその日（`proposal.date`）の日の予定に出す（PRD D335）
- 提案の帯（`ProposalBand kind="day"`。`proposal-band`）：担当が変わる件数（`proposal-moved`）・時刻が変わる件数（`proposal-shifted`）・点（今 → 提案。`proposal-score`）と「反映する」（`proposal-apply`）・「捨てる」（`proposal-discard`）。担当が変わる訪問の一覧（`proposal-moves`）。提案を出したあとに訪問が変われば「古い」（`proposal-stale`）で、反映すると知らせて捨てる
- 反映する：`writeRoutes(d, date, problem, routes)` で訪問に担当と開始を書く（ピンはそのまま。手の名前「AI の提案を反映（名前）」）。トースト「提案を反映しました」と全体の「元に戻す」（`toast-undo`）
- 日の予定を開いても自動では作らない（担当なしの訪問は要対応で見える）

#### 右の欄（`SidePanel`）

- 「詳しく」：今の担当の点数の内訳（「空き時間（待ち）」「点数の基準」は `Term`）・条件ごとの達成の件数（D25）・件数の偏り
- 条件を調整する欄・プリセットのカード・この日だけ試す重みは無い（重みは1組。PRD D318。ADR-0053）。ほかのプリセットは「AI で組む ▾」で試す

#### 表示の切り替え［時間軸｜順番｜一覧］

選択は localStorage でなく画面の状態（初期値：時間軸）。印刷・狭い幅（900px 以下）では順番に切り替える。600px 以下は別の画面の状態（初期値：日ごとのリスト）で、切り替えのボタンを出さず「その他 ▾」の「表示」のまとまり（日ごとのリストで見る `plan-view-day`・順番で見る `plan-view-order`・一覧で見る `plan-view-list`。今の表示に印）で選ぶ（PRD D334）

##### スマホの日ごとのリスト（600px 以下。PRD D334。`components/dayList.tsx`。[pages-common.md](pages-common.md) の「スマホの日ごとのリスト」）

- その日の訪問（取り消し・休みの回も）を今の担当の開始の順に1行ずつ。行は共通の `VisitRow`（印は共通の判定 `dayLooks`。PRD D339・D340）。行を押すと訪問の詳細の欄（下から出る欄）、長押し・「選ぶ」で複数選択（`SelectionBar` は下から出る置き場所）、左右にスワイプで前・次の日（上の帯の日付の切り替えと同じ並び）。日付を変えると選ぶ形を抜ける
- 600px 以下の見出し：説明（`page-lead`）とアイコンを出さず題名を小さく、「予定をメールで送る」はアイコン（名前は読み上げ）。1行のまとめは訪問・入らない・点数・詳しくだけ（守れない条件・移動・理由・次の一手は「詳しく」の欄で）。担当ごとの1日は出さない。「担当なしを見る」（帯）は最初の担当なしの行へ巻く
- 390×844 で操作の行が1段で、最初の画面に訪問が見える

##### 時間軸（PRD D58。`components/routeTimeline.tsx`）

- キーボード（PRD D333。[pages-common.md](pages-common.md) の「訪問の帯をキーで動かす」）：帯にフォーカスして ↑↓ 15分・←→ 1日（その日の日の予定へ移りフォーカスは動かした帯）・Shift+←→ 隣の担当の列（列の順）・Enter で訪問の詳細の欄・Delete で取り消し（確認）。Space は今までどおり帯の詳細、Shift+Enter は複数選択。帯の `aria-keyshortcuts` と title にキーの説明

- 担当ごとの列を時刻の位置で描く。時刻は今の案の lenient の `scheduleRoute`
- 列の最小幅 `TL_COL_MIN_PX`（128px）。見出しの名前（`.col-head-name`）は空白で折り返して切らず、件数の札は入らなければ次の行。箱は `EdgeScroll`（`edgeClass="is-tl"`・`route-timeline`）で、右に続きの列がある間は広い画面でも端に影（印刷では出さない。PRD D269）
- 1分＝一定の高さ（`lib/timeline` の `TL_PX_PER_MIN`＝1.1px）、`TL_START` 07:00〜`TL_END` 20:00（稼働時間帯・訪問がはみ出せば広げる）
- 列の背景は稼働時間帯（`slotsOf`。欠勤を差し引いたもの）の外を灰、欠勤の時間を斜線と「欠勤」
- 帯は押すと理由（`VisitCard` と同じ選択・地図の強調）。印のうち要対応・資格✗／限✗・未連絡の変更・ピン・この回だけ変更・仮押さえは共通の判定（`dayLooks`・`lib/visitLook`。週・月・人の予定表と同じ。PRD D339。[pages-common.md](pages-common.md) の「訪問の札の共通の部品」）で、小さなアイコンと `title`（帯は大の札で `data-size="l"`・`data-marks`。限✗も出る。今日より前の日は要対応・資格✗／限✗を出さない）。代行・+N分・違反の赤い枠はこの画面の印
- 移動は前の帯の終わりから細い線と「移動 N分」（押すと区間を地図で強調）、待ちは点線の枠。「自宅まで N分」は列の最後の帯の下
- ドラッグは順番の表示と同じ担当の移し方（`bestInsertion`・固定）。ドラッグ中は落とす列の、その訪問の earliest〜latest の位置に影（その人に入れたときの strict の可否で緑／赤。可否で外れる人は予告）

##### 順番（担当ごとの列）

- `components/routeView.tsx`：
  - `VisitCard`：来る区間・時間・訪問先・押すと理由。ドラッグ・固定・違反・「→ Bでは（担当の名前）」は差し込む
  - `LegLine`：自宅から・移動・自宅まで N分と待ち。押すと区間を強調
  - `StaffLegend`：地図の凡例から担当を選ぶ
- 担当ごとの列の最後に「自宅まで N分」（最後の訪問先 → 自宅。`problem.travel[訪問先の点][自宅の点]`。`lib/routeView` の `homeTravel`）。押すと地図でその区間を強調
- 訪問を押すと詳細（〈利用者さん〉・担当・「担当を変える ▾」・決まりごと・道順・理由）が出る（担当の select は置かない。ADR-0030）
- 理由の欄（`planParts.tsx` の `ReasonBox`・data-testid `reason-box`。PRD D12・D229）：理由1つを1行（`reason-line`。`is-good`／`is-bad`）で、符号の無い言葉「✓ 相性◎（選ばれやすい）」「! 移動12分（やや遠い）」。`lib/scoreReason.ts` の `reasonFace(reason)`（純粋関数。テストあり）が印（✓・!）・名前・（　）の言葉を決める：相性◎＝選ばれやすい・○＝やや選ばれやすい・△＝選ばれにくい、移動は `TRAVEL_NEAR_MINUTES`（10分）以下＝近い・`TRAVEL_FAR_MINUTES`（20分）超＝遠い・その間＝やや遠い、待ち＝空き時間がある、担当にできない（Infinity）、満たした条件・合わない条件は名前だけ。読み上げは「よい点：」「気になる点：」（sr-only）。内部の値（費用の符号つきの数。100点の点数と向きが逆）は行の `title` にだけ（「内部の値 −30（移動1分＝1。小さいほど選ばれやすい）」）

##### 一覧

- 訪問の一覧の表（時刻・訪問先・所要・担当・注意・編集/取消）。見出し「訪問の一覧（N件・休みのため無し N件）」
- 休みの訪問は表の後ろに薄い行と「休み」の印（「休みのため無し（理由）」。編集はできる・計算には入らない）

#### 列の見出し

- 担当の名前・その日の稼働時間帯と「この日だけ変更」・欠勤の印（「欠勤 9:00〜12:00」「欠勤（終日）」、メモは title）・小さな「この人の欠勤を登録」（aria-label「この人の欠勤を登録（〈名前〉さん）」）／欠勤があれば「欠勤を直す」（aria-label「〈名前〉さんの欠勤を直す」。欄は [pages-plan-absence.md](pages-plan-absence.md)）
- 2行目（稼働時間・「この人の欠勤を登録」）の右端に名前の i（data-testid `col-info`。名前の幅を食わない）。時間軸・順番とも
- 休み・休止中の人の列は出さない（今の案で訪問がある人と、欠勤で稼働時間帯が無くなったもともと働く人は出す）

#### 手直し（ドラッグ・担当を変える）と固定（ADR-0004・ADR-0030）

- 訪問を別の担当の列へドラッグして移すと固定。「入らなかった訪問」（ドラッグ中は0件でも出る）へ落とすと未割当になり固定が外れる
- ドラッグ中の予告は必須の条件に合わないことだけ。列の下に「ここに移すと：必須の条件に合わない（必要条件：入浴 ✗・相性× など）」と、外れる理由（`problem.reasons` の Infinity の理由の名前。`lib/reassignMenu` の `hardReasonLabels`・`notAllowedText`）を並べる（移したあとのトーストも同じ理由）。時間の約束・稼働時間帯の違反は、移したあとに必須の違反として赤い枠で出る
- 必須の条件に合わない担当にすると赤い枠と違反の印
- ドラッグの始まりは `lib/dragStart` の `deferredDragStart`（つかんでから DOM を変えない）
- 移すとトースト「〈名前〉さんへ移しました」（必須の条件に合わなければ「〈名前〉さんへ移しました。必須の条件に合わないので、作り直すとこの訪問は入りません」。PRD D307）、入らなかった訪問へは「入らなかった訪問へ移しました」。どちらも「元に戻す」付き（下）

##### 担当を変える ▾（PRD D217。`ReassignMenu`）

ドラッグと同じ手直しを、押す・キーボード・タッチで。訪問の詳細（時間軸の帯の `tl-detail`・順番のカードの詳細。900px 以下・390px は順番の表示なのでカードの詳細）の「担当：」の下に置く。

- 部品は `components/MenuButton`（「AI で組む ▾」と同じ作法：role="menu"・role="menuitem"・まとまりは role="group"＋aria-label・説明は aria-describedby・押せない項目もフォーカスは移り理由を出す・キーボード（開くと先頭・↑↓・Home・End・Esc・Tab））。ボタン `plan-reassign`（アイコン ArrowRightLeft・「担当を変える ▾」）・一覧 `plan-reassign-list`
- 項目（data-key・data-testid）：

| まとまり | 項目 | 押すと |
|---|---|---|
| 今の担当 | 今の担当の名前（`cur-〈ID〉`・`plan-reassign-current`。ピンなら補足「ピン」。説明「今の担当です」・押せない・`aria-current`） | 何もしない |
| ほかの〈スタッフ〉へ移す | 列のある人ごと（`to-〈ID〉`・`plan-reassign-item`）。押せる人を先に（`candidatesFor` の並び＝空き時間に入る人を増える費用の小さい順・ずらせば入る人・ほか）、必須の条件に合わない人は後ろで押せない | `moveTo`（ドラッグと同じ `bestInsertion`・固定・トースト） |
| そのほか | 「入らなかった訪問へ」（`none`・`plan-reassign-none`。説明「担当なしにします（ピンも外れます）」。担当のいる訪問だけ） | `unassign` |

- 候補は「受けられる人」と同じ `candidatesFor`（reassign）を、列を出している人（`columns`。ドラッグで落とせる人）に絞ったもの。新しい採点は足さない。計算は一覧を開いているときだけ（`MenuButton` の `onOpenChange`。CandidateBox と同じ）。担当の無い訪問で移せる人がいなければ「移せる〈スタッフ〉がいません」（`plan-reassign-empty`。押せない）
- 説明の1行（`lib/reassignMenu` の `reassignItemText`。純粋関数・テストあり）：いまの予定に必須の違反があれば「いまの予定に守れない条件あり」、件数の上限を超えれば「件数の上限を超える」、空き時間に入れば「移動 +N分・時間の約束 ✓」、入らなければ「時間の約束 ✗（N分遅らせれば入る）」か「時間の約束 ✗」。続けて相性の記号（その人の理由の level 付きのもの：相性◎○△×）・「いつもの担当」・重みの違反の名前（2つまで）。「移動 +N分」「時間の約束」は「受けられる人」と同じ（ほかの人の開始を変えない入れ方）の目安
- 押せない理由（`problem.allowed` が false の人）：「必須の条件に合いません（〈必須で外れる理由の名前〉・…）」。計算中はどの項目も「計算中は選べません」
- 担当の無い訪問（入らなかった訪問のカード）にも出す（今の担当・「入らなかった訪問へ」は無し）。欠勤の振り直しで「受けられる人」（`CandidateBox`）を出している訪問には出さない
- 一覧は浮かせて出す（`menu-list`。画面の右からはみ出せば左へずらす）。390px でも収まる
- 選んだあとのフォーカス（`focusAfterMove`）：詳細ごとボタンが消える（列が替わる・入らなかった訪問へ移る）ので、移した先の訪問の帯・カード（`.tl-band-btn`・`.route-btn`）へ。無ければ操作の行の「元に戻す」（`undo-btn`）、それも無ければ移した先の列の見出し。body に落とさない

##### 戻す（全体の履歴。PRD D329。ADR-0054）

- 手直し（担当を移す・担当なしにする・受けられる人に入れる・ピンを外す）・提案を反映する・振り直し・確定は、どれも store の `update(fn, 手の名前)` の1手（「担当を替える」「担当なしにする」「受けられる人に入れる」「ピンを外す」「AI の提案を反映（…）」「欠勤を登録」「欠勤の振り直し」「案A を反映する」「確定（伝えた）」など）。戻すのは全体の「元に戻す」（操作の行の `undo-btn`・トーストの `toast-undo`・Ctrl+Z）で、50手まで。別の日の手も戻る（日付を問わない）
- 複数選択（Shift・Ctrl＋クリック）は時間軸の帯と順番のカード（`useVisitSelection` は共通の部品。PRD D330・D340）。下に `SelectionBar`（[pages-common.md](pages-common.md)）
- 手で担当を替えた訪問は自動でピン（PRD D319）。「次からもこの人に」の記憶は無い（ADR-0053。繰り返しの担当を直す）

#### 入らなかった訪問

- 入らない訪問の列。理由の札の行 `unplaced-reasons` の先頭に〈利用者さん〉の i（data-testid `unplaced-info`。名前はカードの中なのでカードの外に置く。押してもカードを選ばない）
- 理由の札（data-testid `unplaced-reason`。PRD D12・D229）は訪問の理由の欄と同じ `reasonFace` の名前と（　）の言葉（入らなかった理由の一覧なので「担当にできない」の言葉は付けない。例「さくら：9:00〜9:45 の訪問と時間が合わない」）。符号つきの数・「必須」を付けず、内部の値は札の `title` にだけ
- カードの「受けられる人」で候補（`candidatesFor`。先頭5人＋「すべて見る」）を開く。行ごとに：
  - 名前（`candidate-name`。`PersonButton`。押しても入れない。箱 `.candidate-name` は `min-width:0` で overflow を隠さず、名前はボタンの中の `span.ellipsis` で「…」にする（フォーカスの枠を切らない））
  - 移動 +N分・「時間の約束を守れる」／「N分ずらせば入る」／「空き時間に入らない」・「いまの予定に守れない条件があるため、空き時間に入れられません」・「入れると後ろの N件が最大 +M分 遅れる」・条件の違反（理由の文）・「件数の上限を超える」（札 `.candidate-row .chip` は折り返す）
  - 「この人に入れる」（`placeVisit` で入れて固定。後ろの訪問が遅れるときは確認「〈名前〉さんの訪問 N件の開始が最大 +M分 遅れます。入れますか？」（遅れなければ出さない）。守れないときは必須の違反の赤い枠）
- 欄の注記：「入れる訪問の時間の約束は変えません。空き時間に入らない人に入れると、その人の後ろの訪問の開始が遅れることがあり（押すと確認します）…」
- 390px で候補の一覧がはみ出さない

#### `?do=unassigned`（PRD D201〜D204）

- `?date=` を読んで選び、`?date=`・`?do=` を消す。`pendingNone`＝`{ date, arrived, auto, busy }`
- その日の案があり作っている途中（`running`・`batch`）でなければ1回だけ `goToNone`（「入らなかった訪問」の列へ巻く。入らない訪問が無ければ巻かない・着いたあとでほかの日へ移ったら忘れる）
- 案が無いときは、自動作成の effect が始めたとき `auto` を立て（`busy` は戻す）、作っている途中を見る（`busy`）まで待ち、作り終えてから巻く。それ以外（自動作成が走らない・作れなかった・訪問が無い）は忘れる
- `?do=` 無しでは巻かない。同じ文書の中で hash を変えても（同じ日・別の日）同じ

#### 担当ごとの1日（PRD D84。`components/dayLines.tsx`）

- `DayLines`：1行のまとめの下に1人1行（名前・横棒・件数）。横棒は `components/workBars` の `PartsBar`（塗りは [pages-bars.md](pages-bars.md)）
- 計算は `lib/dayLine.ts`（純粋関数）：`dayLines(problem, routes, staffIds)`（担当ごとの勤務の時間帯（欠勤を差し引く）・件数・時間軸の区間（`spanParts` に自宅からの移動を足す）・訪問・移動・待ち・空きの分）、`dayLineRange(lines)`（8〜20時。はみ出せば1時間単位で広げる）、`dayLineText(line)`（title・読み上げ）
- 行のボタンを押すとその人を選び（列の見出しを押したときと同じ `focusOn`。列を強調・地図をその人に絞る）、その人の列（`.route-col` の data-staff）へスクロールして列の見出しにフォーカス（一覧のときは時間軸に切り替えてから）
- 横棒の訪問の所をマウス・タッチで押すと（`DayLine.parts` の訪問の区間に visitId を付け、`PartsBar` が data-visit-id に書く。押した要素から引く）その訪問を選び（カードを押したときと同じ `togglePick`。選んだままなら外さず `focusOn` で地図を絞り直す）、その人の列の中のカード（data-visit）へスクロール（一覧のときは時間軸に切り替えてから）。キーボードで押したとき・訪問の外を押したときは人を選ぶ
- `detailName` で行のボタンの外の右に名前の i
- 今の案（`aiPlan`）が無い日は出さない。900px 以下・印刷は details 要素で畳む（`collapsed`）。高さの変数 `--header-h` は触らない
- マウスだけの端末（`screen and (pointer: fine) and (not (any-pointer: coarse))`）では行を詰める（行の上下の余白0・行の高さ 1.25・行の i は 18px。PRD D237）。タッチできる端末（タッチ付きのノート・ペンを含む）と印刷は今のまま（行の i の押せる所 32×24px）。1行のまとめにつなげる量は `--plan-gap`（`.plan-page` の段の間）＋1px。1440×900 で本体の列の見出しと最初の訪問が初期表示に入る

#### 地図と強調（`lib/routeView.ts`。比較の画面と共通）

- `buildRouteMap`：ルートの集まり（予定は1つ、比較は A 点線・B 実線）から地図の点・線を作る。線は担当の色。担当の絞り込み・選んだ訪問先・区間（来る移動と「自宅まで」の帰り）の強調・強調する訪問の集まり（振り直した訪問へ来る区間を太く）
- `homeTravel`：最後の訪問先 → 自宅の分
- `useRouteSelection`：地図で見る担当・強調する区間・選んだ訪問。担当を変える・訪問や区間を押すとその人のものでない選択を外し、担当を移した訪問を選んでいたら絞り込みを新しい担当に合わせ、案が入れ替わったとき・比べる案を変えたとき・日付が変わったら外す
- 画面の外の地図は `components/MapDock.tsx` で右下に浮かせる

#### 帯：休み・拘束超え

- 休み（`band-leave`。ADR-0013）：「〈利用者さん〉の休みのため無し N件：」と名前（`leave-name`。`lib/personLinks` の `leavePeople(visits, leaves, date, nameOf)` で並べ、理由を添える）。確定した日なら「（確定した日です。必要なら案を作り直して確定し直してください。休みの訪問の担当は、休みを消したときのために残します）」。「一覧で見る」。文は `band-text` の1つの要素に入れる（`with-icon` の横並びの中で折り返す）
- 拘束超え（`band-over-span`。ADR-0015。`workload` が入のとき）：今の案、無ければ確定した割当で、出勤〜退勤（拘束。最初の訪問の開始〜最後の訪問の終わり）が上限の `org.spanLimitHours` 時間を超える人。名前（`over-span-name`）と拘束の時間。1人ぶんは `over-span-item` で途中で折り返さない。1人なら帯のボタン「勤務の見込み」、2人以上なら帯のボタンをやめ人ごとのリンク `over-span-link`「勤務の見込み」（`workloadHref(年月, ID)`。aria-label「〈名前〉さんの勤務の見込み」）。印刷ではリンクを出さない

#### 訪問の詳細の欄（`components/VisitPanel.tsx`。PRD D301〜D305。ADR-0051）と取り消し

- 欄そのものは [pages-common.md](pages-common.md) の「訪問の詳細の欄」。日の予定からは次の所で開く（`useOpenVisit`）
  - 時間軸の帯・順番のカード・入らなかった訪問のカードを押して出る詳細の先頭の「詳細・変更」（`visit-open`。詳細の理由・「担当を変える ▾」・決まりごと・道順は今のまま）
  - 一覧の行の「開く」（`visit-row-open`。鉛筆の「編集」を置き換え。休みのため無しの行も）。行の「取り消す」（欄の取り消しの種類の選択）は今のまま
  - 操作の行の「訪問を追加」（`plan-visit-add`。600px 以下は「その他 ▾」の中。PRD D344）：その日を入れた新規の形。〈利用者さん〉が0人・スマホ幅（600px 以下）なら押せず理由
- 閉じたあとのフォーカス：開いた訪問の帯（`.tl-band .tl-band-btn`）・カード（`.route-btn`）・一覧の「開く」の順に探し（保存で作り直した回・足した訪問は新しい ID）、無ければ開く前の要素、新規で何も無ければ「訪問を追加」（`plan-visit-add`。600px 以下は「その他」`plan-more`）
- 「担当を変える ▾」の候補は訪問の詳細の欄と同じ `lib/reassignMenu` の `reassignChoices`（出す人は列を出している人）。欄で担当を替えると、その日の担当の並びの `bestInsertion` の位置に入れてピンにする（戻すのは欄のトーストの「元に戻す」）
- 取り消しは欄（ふつう／当日キャンセル）と一覧の行の「取り消す」（`applyCancel(visitId, sameDay)`。欠勤・キャンセルの欄と共通）。取り消すと今の案の列・点からその訪問が消え、足すと「入らなかった訪問」に出る

#### 種類・仮・決まりごとの表示

- 訪問のカード・一覧に種類の色の印と名前（`components/visitType.tsx`。`title`・読み上げにも）。種類の必要条件で外れる理由は理由の欄に出る（matching）
- 仮押さえの〈利用者さん〉の訪問に「仮」の印（共通の判定の印。PRD D339）
- 時間軸の帯・順番のカードを押したときの詳細に訪問先の決まりごと（`components/VisitRules.tsx`）と道順のリンク
- 訪問の詳細の名前は `PersonButton`：時間軸は見出しの〈利用者さん〉の名前と「担当：」、順番は `visit-who` の「〈利用者さん〉：」「担当：」。一覧の〈利用者さん〉と担当の名前も

#### 日の予定のメール（`pages/mailPanels.tsx` の `DayMailPanel`。ADR-0017・0018）

- 見出しの「予定をメールで送る」（`day-mail`）→ 右の欄。訪問のある人と欠勤・希望休の人（`PrintDay.off`）を並べ、行に「欠勤」「希望休」。宛先ごとに `MailButton`
- 確定（PRD D346・ADR-0059）：「メールを作る」を押した人に「作成済み」（`mail-sent`）、欄に「メールを作った人 N/M人」（`day-mail-progress`）。送れる人（アドレスがあり長すぎない）全員分を作ると1回だけ確定（`confirmByMail`。確認なし・知らせに「元に戻す」と要対応の件数）。欄の下に「確定（伝えた）にする」（`day-mail-confirm`。見出しの確定と同じ確認）。数えるのは欄を開いている間だけ（開き直すと0から）。欄から送る本文は「確定した担当」と書く。伝えたあとに訪問が無くなった人（伝えた内容に担当があった人）も行に出し「訪問はありません」を送れる。送れる人がいない日・元に戻したあとは自動で確定せず、欄の文で「確定（伝えた）にする」へ案内する
- 「鍵の情報も入れる」は React の状態だけ
- 本文に道順のリンク（`dayMailText`）を入れる旨を書く。データは書き換えない

#### 道順のリンク（ADR-0018）

- 順番のカード・時間軸の帯の詳細に `VisitRouteLinks`（担当の今の案の `routes` の順番。担当の無い訪問は出さない）。`confirmState==='diff'` のときは `note`「今の案（未確定）の順番」

#### `lib/useDayModel.ts`

- `useDayModel`：その日の問題・今の案・採点など。`compileInput` に `absences`。`slotsOf` は欠勤を差し引いた時間帯と、その日の欠勤（`absence`。無ければ null）を返す（スタッフの画面の時刻も欠勤を差し引く）。`scoreRules` を返す
- `useCompileInput(data)`：compile が読むデータだけ（ホーム・帯も使う）

#### `lib/dayPlan.ts`（日の割当と確定。純粋関数。テストあり。ADR-0053）

- `dayProblemOf(data, date)`・`activeDayVisits`（計算に入れる訪問：取り消し・休み・利用中でない人を除く）・`routesOf(problem, visits)`・`dayRoutes`・`pinsOf`・`unassignedOf`
- `writeRoutes(data, date, problem, routes, { pins? })`：担当と lenient の開始を訪問に書く（変わる回だけ。計算した回は保存した回に）。pins を渡さなければピンは今のまま（担当なしにした訪問のピンは外す）。`settleDay` は今の並びで開始を書き直す
- `visitIssues(problem, routes, visits)`：訪問 ID → 要対応（`unassigned`・`off`・`notAllowed`・`late`。`off` のときは `late` を重ねない）
- `tellDay`・`toldChanges`・`toldStateOf`・`changeCount`・`changedVisitIds`・`contactsBetween`

#### 完了の条件

- [ ] 「AI で組む」→ 10秒以内に提案の帯（変わる件数・点）が出て、反映するまで訪問は変わらない。「反映する」で訪問に担当が入り「元に戻す」で1手戻る（`scripts/e2e-plan-menu.cjs`）
- [ ] 日・週・月で同じ操作の行・「AI で組む ▾」の範囲と提案の帯・全体の元に戻す（Ctrl+Z／やり直し・入力欄の中では効かない）・複数選択の帯（`scripts/e2e-schedule-v4.cjs`）
- [ ] 訪問の一覧は表示の「一覧」で出る。訪問を押すと理由と「担当を変える ▾」が出る。担当の列の最後に「自宅まで N分」があり、押すと地図でその区間が強調される。`#/schedule` は `#/plan` へ移る
- [ ] 訪問を取り消すと今の案の列・点からその訪問が消え、足すと「入らなかった訪問」に出る。すべて取り消すと今の案の欄・列は出ず「この割当で確定」も押せない（`alignPlan` のテスト）
- [ ] 担当の列の見出しの下にその日の稼働時間帯と「この日だけ変更」が出る。訪問を「入らなかった訪問」（ドラッグ中は0件でも出る）へドラッグすると未割当になり固定が外れる
- [ ] 休み・休止中の人の列は出さない（今の案で訪問がある人を除く）。時間の約束・稼働時間帯の違反は、移したあとに必須の違反として赤い枠で出る
- [ ] 「確定（伝えた）」で `snapshots[date]` に今の担当・開始が入り「確定済み」。あとで担当・時刻を変えると「未連絡の変更あり N件」と連絡の一覧（`lib/dayPlan` のテスト）
- [ ] 確定すると「次の確定していない日へ（M/D）」が出て、押すとその日が開く（`scripts/e2e-home.cjs`）
- [ ] 手直しで必須の条件に合わない担当にすると赤い枠と違反の印が出る
- [ ] 入らない訪問の「受けられる人」から「この人に入れる」を押すとその人の列に入り固定になる。後ろの訪問が遅れるときだけ確認が出る
- [ ] 「AI で組む ▾」の並び・まとまり・説明・押せない理由・キーボード（`scripts/e2e-plan-menu.cjs`）
- [ ] （ADR-0055）390px は日ごとのリスト（日付送り・スワイプ・下から出る欄の4つのボタン・日時の変更が出ない・長押しと「選ぶ」の複数選択）、1400px は帯の ↑↓←→・Shift+←→・Enter・Delete が全体の元に戻すの1手、提案が画面を移っても残る（`lib/visitKeys` のテスト・`scripts/e2e-mobile-v5.cjs`）
- [ ] （D217〜D219）「担当を変える ▾」の項目（role=menuitem・説明・今の担当・担当なしにする）、キーボードで移すと担当が変わりピン、トーストと操作の行の「元に戻す」で担当とピンが戻る、確定の確認に要対応の件数、390px で押せる（`lib/reassignMenu` のテスト・`scripts/e2e-plan-menu.cjs`）
- [ ] 点数の理由・次の一手・訪問ごとの理由の言葉（入らなかった訪問の札も。符号・「費用」を出さない）（`lib/scoreReason` のテスト・`scripts/e2e-words.cjs`）
- [ ] `?do=unassigned` で入らなかった訪問へ巻く（`scripts/e2e-links.cjs`）
- [ ] 名前から開く詳細（列の見出しの i・訪問の詳細・担当ごとの1日・一覧・入らなかった訪問・受けられる人・休みの帯・拘束超えの帯）（`scripts/e2e-details.cjs`・`scripts/e2e-details2.cjs`）
