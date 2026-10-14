# 作業指示書：pages（画面）

> 注記：「いまの時刻」（now）は 2026-10-14 に廃止した（ADR-0011 追記）。本文の now・いまの時刻の記述は古い（いまの設計の正は docs/design.md）。

## 0. 今回の作業（ADR-0011「当日の急な欠勤の振り直し」の1回目。PRD D26〜D33）
下の「1. 担当範囲」はこのコンポーネントの節をそのまま写したもので、前からある内容も入っている。**今回やるのは次だけ**（前からある機能は壊さない）。

- design.md §4 pages の「`#/plan` の急な欠勤」の項目をすべて作る（欠勤の欄・登録して振り直す・差の欄・代行と +N分・薄い列・地図の強調・受けられる人・比較の「欠勤前」・稼働時間の画面の印・`useDayModel`・`lib/runs`・`lib/absences`）
- データの書き換えは `update(fn)` だけ。振り直しの計算は reassign の関数を呼ぶだけ（画面に規則を書かない）
- 主ボタンはオレンジ1色・1画面1〜2個（欠勤の欄では「登録して振り直す」が主）。呼び方は `org.terms`

- 触ってよいファイル：`src/pages/`・`src/components/`・`src/lib/`（`lib/absences.ts` 新規・`lib/runs.ts`・`lib/routeView.ts`・`lib/useDayModel.ts`）
- 作業の順（契約だけでやりとりする）：① store（契約 `src/contracts/` を確定）→ ② domain → ③ matching → ④ reassign → ⑤ excel・pages（④と⑤は並行してよい。pages は reassign の型だけを先に使い、実装ができてから結合）。
- 2回目の範囲（案B「少し動かしてよい」・連絡の一覧。PRD D34・D35）は作らない
- 参照：`docs/adr/0011-same-day-absence-reassign.md`、`docs/prd.md` D26〜D35、`docs/design.md` §4・§5・§8
- 欠勤の細部（1人1日1件・30分単位（半端は丸める）・午前/午後の境 12:00・始まっている訪問も動かさない・候補で時刻を変えない・件数の上限を守る・未確定の変更は確認してから捨てる）は 2026-10-13 に利用者が決定済み（design.md §8 の「決めたこと」）。**設計書のとおり**に作る。それ以外で迷ったら推測せず `QUESTIONS:` で報告する

## 1. 担当範囲
- 責務：PoC本体の管理者画面（予定・AI案の比較・稼働時間帯・スタッフ・訪問先）を Firebase なしで動かす。最初に開く画面は `#/plan`。追加の画面：項目、条件（重みのスライダー 0〜5・必須の切り替え。ClassClassify の Setup にならう）、相性の表（訪問先×スタッフ、クリックで ◎→○→空→△→× を回す）、データ（書き出し・読み込み・初期状態に戻す・実データを入れないでの注意書き）。スタッフの今日の順番を見る画面（D16、表示だけ）。
- 特性と条件の入力（`components/conditions.tsx`）：特性のあり/なしは「未確認・あり・なし」。条件は相手の項目ごとの1行のチェック表で、何も選ばない項目は問わない。あり/なしの条件の「なし」は `is false`（未確認の相手は満たさない＝安全側）で、`not` は画面からは作らない（前からある `not` は「そのほかの条件」に出して消せる）。保存の形は `Condition[]` のまま
- 持つデータ（持ち主）：画面の一時状態のみ
- 提供するAPI：なし（ルートは `#/plan`（「予定」。ADR-0009：その日の訪問の一覧（初期は畳む。時間・訪問先・所要・今の案での担当・注意・編集/取消。訪問を追加・前の同じ曜日からコピー（訪問が無い日だけ））と、AI案を作る・手直し（ドラッグ）・固定・組み直す・「この割当で確定」（`manualPlans[date]` と各訪問の `staffId` に写す。計算に入れた訪問の担当が `manualPlans[date]` と一致すれば「確定済み」、違えば「未確定の変更あり」）。開いた日にAI案がなければ、`data.presets` の順に1つずつ Worker で自動で作り、どれも記録に残す（2つ目以降も最新のデータで問題を作る。進み具合「10/13 の案：プリセット 2/3」を出し、「止める」で今の1つを途中の最良で残して残りはやめる。計算中は重み・プリセット・いまの重みを保存を押せない。途中は最初に作れた案を見せ、終わったら一番点の高い（王冠の。同点なら先のプリセット）案を今の案にする。その間に手直し・別の案にしていれば変えない）。その日の条件 `data.rules` は書き換えず、作った案の `rules` にプリセットの重みが残る。上部にプリセットごとの案のカード（下記。押すとそのプリセットに切り替える）。今の案の欄に条件ごとの達成の件数（D25）。右の重みの欄には「いまの重み：〈プリセット名〉」・「いまの重みをプリセットとして保存」・プリセットの編集へのリンク・重みのスライダー・「AI案を作り直す」（プリセットのボタンは置かない。ADR-0010）。作る・組み直すたびに記録へ1件足す。担当ごとの列の最後に「自宅まで N分」（最後の訪問先 → 自宅。帰りの移動は `problem.travel[訪問先の点][自宅の点]`）。古いリンクの `#/schedule` は `#/plan` へ移す） `#/compare`（AI案の記録どうしの比較、D19・D22。下記） `#/rules` `#/items` `#/compat` `#/staff` `#/clients` `#/availability` `#/data` `#/staff-view/:staffId`）
- `#/plan` のプリセットのカード（ADR-0008・ADR-0010）：プリセットごとに、その日の記録のうち計算し直さずに使える記録（`reusableRun`。いまのデータでそのプリセットを当てた問題のキーと一致）を優先し、無ければ固定なしで重み・必須がそのプリセットと一致する最新の記録を1枚のカードにする（名前・一言・点数・移動・入らない訪問・必須の違反・条件の達成の要約）。後者（記録のあとにデータが変わった）のカードには「データが変わったので、押すと作り直します」の小さな注記を出し、押すと計算する（押したあとの点はカードの点と違いうる）。各プリセットの問題のキーは compile が読むデータとプリセットだけに依存して作る（ドラッグ・固定では作り直さない）。カードの読み上げの名前は短く（「標準の案を今の案にする（72点）」・今の案なら「標準の案（今の案・72点）」）、内訳・達成・注記は `aria-describedby`。点数・必須の違反・達成はどれも点数の基準の物差し（見出しに「物差し：標準」）。一番点の高いカードに王冠（0点のカードには付けない）。カードの「今の案」は、今の案の元になった記録の id（`AiPlan.runId`。無い古いデータは経路の一致）で決める。**カード全体が1つのボタン**（中にボタンを入れ子にしない。hover・focus の見た目、今の案のカードはオレンジの枠・`aria-pressed`、計算中は押せない）。押すと（`runPreset`）：その日の条件をプリセットの重みにし、計算し直さずに使える記録（`lib/runs` の `reusableRun`。§5）があれば計算せずにその記録を今の案にする（トースト「保存してある〈プリセット名〉の案を今の案にしました（再計算なし）」）、無ければその条件で計算して今の案にする。今の案（手直しなし）のカードは押しても何もしない。手直し・固定がある今の案を捨てるときは確認する。記録の無いプリセットは「まだ作っていません・押して作る」で、「足りない案を作る」（通常のボタン）で順にも作れる
- `#/rules` のプリセットの節（ADR-0008）：プリセットごとに名前・一言・型ごとの重み（0〜5、0.5刻み）・必須を編集（変えるとすぐ保存）、消す（最後の1つは消せない）、「いまの重みをプリセットとして保存」（名前を入れて足す。6つまで）、「初期値に戻す」（初期の3種に戻す。点数の基準も標準に。確認を出す）。「点数の基準」のラジオでプリセットを1つ選ぶ（ADR-0010。基準のプリセットの見出しに「点数の基準」の印。基準のプリセットを消すと残りの先頭に移り、確認の文に出す）
- 担当ごとの順番と地図の共通部品（予定・比較。ADR-0009）：`lib/routeView.ts` に `buildRouteMap`（ルートの集まり（予定は1つ、比較は A 点線・B 実線）から地図の点・線を作る。線は担当の色。担当の絞り込み・選んだ訪問先・区間（来る移動と「自宅まで」の帰り）の強調）、`homeTravel`（最後の訪問先 → 自宅の分）、`useRouteSelection`（地図で見る担当・強調する区間・選んだ訪問。担当を変える・訪問や区間を押すとその人のものでない選択を外し、担当を移した訪問を選んでいたら絞り込みを新しい担当に合わせ、案が入れ替わったとき・比べる案を変えたとき・日付が変わったら外す）。`components/routeView.tsx` に `LegLine`（自宅から・移動・自宅まで N分と待ち。押すと区間を強調）、`VisitCard`（来る区間・時間・訪問先・押すと理由。ドラッグ・固定・違反・「→ Bでは（担当の名前）」は差し込む）、`StaffLegend`（地図の凡例から担当を選ぶ）。画面の外の地図は `components/MapDock.tsx` で右下に浮かせる
- `#/compare` の中身：その日の記録と「今の案（予定の画面の手直し後）」から任意の2つを A・B に選んで比べる。条件の差（重み・必須が違う条件の一覧）、合計点・移動・待ち・距離・入らなかった訪問・必須の違反、条件ごとの達成/違反（採点は A・B とも、点数の基準のプリセットの同じ物差し。見出しに「物差し：標準」。ADR-0010）、担当ごとの順番の左右比較、地図（A：点線、B：実線。線は担当の色。訪問・区間・担当を押すと予定の画面と同じに強調・絞り込み、画面の外なら MapDock）。記録の一覧から「予定の画面で開く」（その記録を今の案にする）・「この条件にする」（その日の条件の重み・必須を記録と同じにする）・「消す」ができる。A と B に同じ案を選ぶと入れ替える。確定した割当との比較はしない。
- `#/plan` の急な欠勤（ADR-0011。1回目＝PRD D26〜D32）：
  - 欠勤の欄：担当ごとの列の見出しに小さな「急な欠勤」ボタン（その日に欠勤があれば、見出しの下の稼働時間帯の横に「欠勤 9:00〜12:00」「欠勤（終日）」の印、メモは title。ボタンは「欠勤を直す」）。押すと右から欄（`components/ui.tsx` の `SidePanel`）：終日／時間帯のラジオ、時間帯は開始・終了（30分刻みの選択。空＝始業から・終業まで）と早道のボタン（午前だけ＝始業〜12:00、午後だけ＝12:00〜終業、〇時から（早退）＝開始だけ、〇時まで（遅刻）＝終了だけ）、メモ（100字まで）、いまの時刻（当日は現在時刻を5分単位に切り捨てた値が初期値、それ以外の日は空＝考えない）、見込み（入力のたびに `targetsOf` を呼び「振り直す訪問 N件（欠勤と重なる a件・間に合わない b件）」と訪問の一覧、始まっていて動かさない訪問の件数）。下の操作：主ボタン「登録して振り直す」・「欠勤だけ登録」・既存なら「欠勤を取り消す」・閉じる。その日の稼働時間帯がもともと無い人の列には出さない。時間帯が正しくない（終了 ≤ 開始）ときは欄に理由を出して押せない
  - 「登録して振り直す」：欠勤を足したデータで compile した問題、元の案（`lib/absences` の `baseOf`：`manualPlans[date]` があれば、各担当の訪問を今の案の列の順（無い訪問は earliest の順）に並べたもの。無ければ `aiPlans[date].routes`）、`targetsOf` → `reassign` で、結果を今の案にする（`applyReassign`：routes・generated＝結果、pins＝結果の pins、`reassign`＝元の案の情報（§5）、記録に `reassign` 付き・名前「欠勤の振り直し（〈名前〉さん）」で1件。欠勤の保存と合わせて1回の `update` で書く）。元の案が無ければ押せず「先にAI案を作ってください」（欠勤だけは登録できる）。元の案が確定した割当で今の案が「未確定の変更あり」なら、今の案の変更を捨てる確認を出す。計算中（Worker）は押せない
  - 差の欄（今の案に `reassign` があるとき、今の案の欄の上）：まとめ「変わる人 N人・振り直し N件・入らない N件・移動 +N分」、「元の案：確定した割当／今の案」「いまの時刻 10:30」、「元の案に戻す」（確認を出し、routes・generated・pins を元の案（`baseRoutes`・`basePins`）に戻し、`reassign`・`runId` を外す。`revertReassign`）、「比較の画面で見る」（A＝欠勤前、B＝今の案）。差は `reassignDiff`（before＝元の案を、振り直しに使った欠勤を除いたデータで compile した問題で、after＝今の案をいまの問題で）。振り直しに使った欠勤が取り消されていたら「欠勤は取り消されています。元の案に戻せます」と出す。今の案を手直し・組み直ししても差の欄は残る（元の案との差を出し直す）。「AI案を作る」・プリセットのカードで別の案にすると消える
  - 列とカード：差の欄があるとき、変わらない人の列は薄く（押せる）、振り直した訪問のカードに「代行」の印（元の担当の名前を title・読み上げに）、開始が変わった訪問に「+N分」（早まったら「−N分」）。地図は振り直した訪問へ来る区間を太くする（`lib/routeView` の `buildRouteMap` に強調する訪問の集まりを渡せるようにする）
  - 入らなかった訪問（振り直しで入らない訪問）：カードの「受けられる人」で候補（`candidatesFor`。先頭5人＋「すべて見る」）を開く。行ごとに 名前・移動 +N分・「時間の約束を守れる」／「N分ずらせば入る」／「入らない」・条件の違反（理由の文）・「件数の上限を超える」と「この人に入れる」（`placeVisit` で入れて固定。守れないときは今までの必須の違反の赤い枠）
  - 比較の画面：記録に `reassign` があれば、選べる案に「欠勤前（記録の名前）」を足す（記録の `reassign.baseRoutes`。いまの問題で採点するので、欠勤の人の訪問は必須の違反として出る）。記録の一覧に「欠勤の振り直し」の印。「予定の画面で開く」は `planOfRun`（記録の `reassign` も今の案に写す）
  - 稼働時間の画面：欠勤のある日のセルに「欠勤」の印（「欠勤（終日）」「欠勤 9:00〜12:00」。メモは title）。稼働時間の欄に同じ文と「欠勤の登録・取り消しは予定の画面で」を出す（セルの時間帯の文は上書き・基本のまま）
  - `useDayModel`：`compileInput` に `absences`、`slotsOf` は欠勤を差し引いた時間帯と、その日の欠勤（`absence`。無ければ null）を返す（スタッフの画面の時刻も欠勤を差し引く）
  - `lib/runs`：`addRun` に optional の `label`・`reassign` を足す（`reassign` 付きの記録は名前を `label` にする）。`findRun` は `reassign` の有無も比べる。`reusableRun` は `reassign` 付きの記録を使わない。`planOfRun` は記録の `reassign` を今の案に写す
  - `lib/absences.ts`（画面の純粋関数。テストあり）：`absencesOn(data, date)`・`saveAbsence(d, absence)`（同じ人・同じ日の欠勤はその1件を置き換える）・`removeAbsence(d, id)`（今の案は変えない）・`baseOf(data, date, problem)`（元の案と、その種類。無ければ null）・`applyReassign(d, date, x)`・`revertReassign(d, date, problem)`
- 依存するもの：store・matching・solver（Worker）・evaluate・reassign、Leaflet（PoC本体 `RouteMap.tsx` を写す）
- 配置：`src/pages/`、`src/components/`
- 完了の条件：
  - [ ] 条件の重みを変えて「AI案を作る」→ 10秒以内に点数と理由が出て、記録に1件増える。比較画面で任意の2つの記録を左右に比べられる
  - [ ] AI案がない日に `#/plan` を開くと、すべてのプリセットで順に自動で作られ、カードが並ぶ。同じ条件・種・固定・結果の記録は増えない
  - [ ] プリセットのカードを押しても、カードの点数は変わらない（点数の基準の物差し）。記録があるカードは進み具合を出さずにすぐ切り替わり、今の案の合計はそのカードの点と一致する。種・データを変えたあとは計算する。条件の画面で基準を替えると点が変わる（ADR-0010）
  - [ ] 予定の画面（`#/plan`）で、訪問の一覧が畳まれて出る。訪問を押すと理由だけが出る（担当の select は無い）。担当の列の最後に「自宅まで N分」があり、押すと地図でその区間が強調される。`#/schedule` は `#/plan` へ移る
  - [ ] 訪問を取り消すと今の案の列・点からその訪問が消え、足すと「入らなかった訪問」に出る。すべて取り消すと今の案の欄・列は出ず「この割当で確定」も押せない（`alignPlan` のテスト）
  - [ ] 担当の列の見出しの下にその日の稼働時間帯と「この日だけ変更」が出る。訪問を「入らなかった訪問」（ドラッグ中は0件でも出る）へドラッグすると未割当になり固定が外れる
  - [ ] 休み・休止中の人の列は出さない（今の案で訪問がある人を除く。ADR-0009 で落とした）。時間の約束・稼働時間帯の違反は、移したあとに必須の違反として赤い枠で出る（ドラッグ中の予告は必須の条件に合わないことだけ）
  - [ ] 「この割当で確定」で `manualPlans[date]` と各訪問の担当が今の案になり、「確定済み」が出る。手直しすると「未確定の変更あり」になる
  - [ ] 手直しで必須の条件に合わない担当にすると赤い枠と違反の印が出る
  - [ ] 比較の画面で、訪問・区間（A は点線、B は実線の側）・「自宅まで」・担当を押すと、予定の画面と同じに地図で強調・絞り込みされる
  - [ ] 呼び方は `org.terms` から引き、「お客様」「シッター」を直書きしない。主ボタンはオレンジ1色・1画面1〜2個
  - [ ] （ADR-0011）列の見出しの「急な欠勤」→ 午前だけ → 「登録して振り直す」で、その人の午前の訪問が他の人へ移り「代行」の印が付き、他の人の訪問の担当・順番・時刻は変わらず、まとめの件数が出る。変わらない人の列は薄い。地図で振り直した訪問へ来る区間が太い
  - [ ] 振り直したあとの今の案は全訪問が固定で、「固定を残して組み直す」をしても担当が変わらない。記録に「欠勤の振り直し」が1件増え、比較の画面で「欠勤前」と比べられる
  - [ ] 入らない訪問の「受けられる人」から「この人に入れる」を押すとその人の列に入り固定になる
  - [ ] 欠勤を取り消すと列の稼働時間帯は戻るが今の案はそのまま。差の欄の「元の案に戻す」で元の担当・固定に戻る
  - [ ] 「いまの時刻」より前に始まる訪問（始まっている訪問・終わった訪問）は動かない。当日以外の日は「いまの時刻」が空
  - [ ] 稼働時間の画面の欠勤のある日のセルに「欠勤」の印が出る
  - [ ] `lib/absences`・`lib/runs` の追加分のテストが通る（同じ人・同じ日の置き換え、元の案の並べ方、戻す）

触ってよい範囲：`src/pages/`・`src/components/`・`src/lib/`（`lib/absences.ts` 新規・`lib/runs.ts`・`lib/routeView.ts`・`lib/useDayModel.ts`）（§0）。
触ってはいけない範囲：他コンポーネントの内部、共通設定（変更が必要なら質問する）。

## 2. 守るべき契約
### 欠勤と振り直しの契約（design.md §5 から写した。型の正は `src/contracts/`）
```ts
// documents.ts：欠勤（稼働時間の上書きとは別の記録）
const absenceSchema = z.object({
  id: idSchema,
  staffId: idSchema,
  date: dateSchema,
  from: hhmm30Schema.nullable(),   // 欠勤の始まり（30分単位）。null＝始業から
  to: hhmm30Schema.nullable(),     // 欠勤の終わり（30分単位）。null＝終業まで。両方 null＝終日
  note: z.string().max(100),       // メモ（例：病院の付き添い）
}) // superRefine：from・to が両方あれば from < to（「終了は開始より後にしてください」）
type Absence = z.infer<typeof absenceSchema>
// DemoData.absences: Absence[]（.max(2000).default([])。無い古いデータは []。DATA_VERSION は1のまま）
// 同じ人・同じ日は1件（画面は置き換え、store の repair は最後の1件、Excel は止める）

// data.ts：振り直しの情報（AiPlan・AiRun に optional で足す。無い＝ふつうの AI案）
const reassignInfoSchema = z.object({
  method: z.literal('insert'),          // 1回目は案A「空き時間に入れるだけ」だけ。2回目に 'anneal'（案B）を足す
  from: z.enum(['confirmed', 'plan']),  // 元の案：確定した割当（manualPlans[date]）か今の案（aiPlans[date].routes）
  baseRoutes: routesSchema,             // 元の案（staffId → 訪問IDの列）。差の基準・「元の案に戻す」・比較の「欠勤前」
  basePins: z.record(z.string(), z.string()), // 元の案の固定（元が確定した割当なら {}）
  absenceIds: z.array(idSchema),        // 振り直しに使った欠勤（取り消されても残す）
  now: hhmmSchema.nullable(),           // いまの時刻（考えないなら null）
})
// AiPlan.reassign?: ReassignInfo   … 今の案が振り直しの結果なら付く（差の欄を出す）
// AiRun.reassign?: ReassignInfo    … 記録が振り直しなら付く（比較の「欠勤前」、reusableRun の対象外）

// reassign.ts：reassign の入出力（時刻は0時からの分。Routes＝Record<staffId, visitId[]>）
type ReassignTarget = {
  visitId: string
  fromStaffId: string                                   // 元の案での担当（欠勤の人）
  reason: 'absence' | 'unreachable' | 'notAllowed'      // 欠勤と重なる・間に合わない・ほかの必須の条件で外れる
}
type ReassignOptions = { now: number | null }           // いまの時刻。null は考えない
type ReassignResult = {
  routes: Routes                                        // 振り直したあとの案
  placed: { visitId: string; staffId: string; addedCost: number; addedTravel: number }[] // 入れた順
  unplaced: string[]                                    // 入らなかった振り直す訪問
  unassigned: string[]                                  // 問題の訪問のうちどの列にも無いもの（unplaced と元から入らない訪問）
  pins: Record<string, string>                          // 担当のいるすべての訪問（訪問ID → 担当ID）
}
type ReassignCandidate = {
  staffId: string
  fits: boolean                    // 可で、他の訪問の開始時刻を変えずに strict で入り、件数の上限を超えない
  addedTravel: number | null       // fits のときの増える移動（分）
  addedCost: number | null         // fits のときの増える費用
  shiftMinutes: number | null      // fits でないとき、時間の約束を何分ずらせば strict で入るか（正＝遅く。5分刻み・前後120分まで。無ければ null）
  overCap: boolean                 // 件数の上限（必須の負担の均等）を超える
  violations: Reason[]             // 必須で外れる理由（points=Infinity）と重みの違反（points>0）
}
type ReassignDiff = {
  moved: { visitId: string; from: string | null; to: string | null }[] // 担当が変わった訪問（null＝未割当）
  shifted: { visitId: string; minutes: number }[]   // 担当が同じで開始が1分以上変わった訪問（正＝遅く。四捨五入）
  unplaced: string[]                                // 元は担当がいて、いまは入らない訪問
  changedStaff: string[]                            // 訪問の出入りか開始の変化がある人
  travelDelta: number                               // 全体の移動の増減（分）
}

function targetsOf(problem: Problem, baseRoutes: Routes, absentStaffIds: string[], now: number | null): ReassignTarget[]
function reassign(problem: Problem, baseRoutes: Routes, targets: ReassignTarget[], options: ReassignOptions): ReassignResult
function candidatesFor(problem: Problem, routes: Routes, visitId: string, options: ReassignOptions): ReassignCandidate[]
function placeVisit(problem: Problem, routes: Routes, visitId: string, staffId: string, options: ReassignOptions): Routes
function reassignDiff(before: { problem: Problem; routes: Routes }, after: { problem: Problem; routes: Routes }): ReassignDiff
```

- `problem` は欠勤を差し引いたデータで、いまの条件（`data.rules`）で compile したもの（solver と同じ。点数は今までどおり点数の基準の物差しで画面が付ける）
- 例外を投げない：問題に無い訪問・担当、元の案に無い振り直す訪問は無視する。`candidatesFor` は問題に無い訪問なら `[]`、問題のすべての人を返す（並び：fits の人が先で addedCost の小さい順、次に shiftMinutes の絶対値の小さい順（同じなら遅らせる方）、最後に入らない人。同じなら staff の順）
- `placeVisit`：候補の「入る」と同じ位置（他の訪問の開始を変えない strict の最良）に入れる。無ければ `bestInsertion` と同じ規則（strict の最良、無ければ開始の順に lenient）。どちらでも訪問を元の列から抜く
- `reassignDiff` の時刻は lenient の `scheduleRoute`（before と after で問題が違ってよい）

### 提供するAPI
（このコンポーネントの公開の関数は増えない。下の契約の型を守る）

### エラー方針
| コード | HTTP | 意味 | 呼び出し側の対応 |
|---|---|---|---|
| INVALID_ARGUMENT | — | 読み込んだ JSON が契約に合わない | 画面に日本語で原因（項目名）を出し、元のデータを残す |
| FAILED_PRECONDITION | — | その日の訪問・稼働中のスタッフがいない、どの担当も可にならない訪問がある | 原因の訪問と条件を出す。解ける訪問だけで解く |
| RESOURCE_EXHAUSTED | — | localStorage の容量超過 | 書き出しを促す |
| ABORTED | — | 利用者が計算を止めた | それまでの最良案を出す |
| INVALID_ARGUMENT | — | 欠勤の時間帯が正しくない（終了 ≤ 開始・30分単位でない）（ADR-0011） | 欠勤の欄に日本語で理由を出し、登録しない |
| FAILED_PRECONDITION | — | 振り直しの元の案が無い（確定した割当も今の案も無い）（ADR-0011） | 「先にAI案を作ってください」を出す。欠勤だけは登録できる |

Worker 内の例外は `{type:'error', message}` で返し、内部の文言をそのまま画面に出さない。

### 冪等性・タイムアウト
- 同じ `Problem`・`seed`・`iterations` からは同じ結果（反復回数で止め、時刻・`Math.random` を使わない）
- 反復回数の既定は問題の大きさから決める（目安 3秒）。上限 30秒で `stop` を送り、最良案を採る
- 保存は上書きのみ（1キー）。読み込みは「置き換える前に確認」を出す
- 振り直し（reassign）は同じ問題・元の案・振り直す訪問・いまの時刻から同じ結果。「登録して振り直す」を2回押すと、2回目は1回目の結果（今の案）を元の案にして振り直す（振り直す訪問が無ければ案は変わらない。記録は同じ結果なら足さない）

### 呼び出してよい他コンポーネントのAPI（参考）
| コンポーネント | メソッド | エンドポイント | 概要 |
|---|---|---|---|
| store | 関数 | `load / save / reset / exportJson / importJson` | データ一式の保存・入出力 |
| domain | 関数 | `withoutAbsences(slots, absences) → Slot[]` | 稼働時間帯から欠勤を差し引く（デモ独自。ADR-0011） |
| matching | 関数 | `compile(data, date) → Problem` | 項目・条件 → 可否・費用表（`data.absences` の欠勤を稼働時間帯から差し引く。ADR-0011） |
| solver | Worker | `{type:'solve', problem, seed, iterations}` → `{type:'progress', iteration, total, bestScore, bestRoutes?}` … `{type:'done', result}`（`bestRoutes` は画面が点数の基準の物差しで「いまの最良 N点」を付け直すため。`bestScore` が前の進捗と同じなら送らず、画面は前の点のまま。ADR-0010） | AI案を作る。`{type:'stop'}` で最良案を返して終わる |
| evaluate | 関数 | `score / explain / diff / normalize / toHundred / hundredBreakdown / achievements` | 採点・理由・記録どうしの差・点数（100点満点）・条件ごとの達成の件数 |
| excel | 関数 | `exportWorkbook / importWorkbook` | Excel のブックとの変換（ADR-0006。「欠勤」シート：ADR-0011） |
| reassign | 関数 | `targetsOf / reassign / candidatesFor / placeVisit / reassignDiff` | 欠勤の振り直し：振り直す訪問・案A・入らない訪問の候補・元の案との差（ADR-0011） |

詳細な定義：`src/contracts/`（型の正）と `docs/design.md` §5。サーバーの API は無い（AGENTS.md）。

## 3. ルール
`AGENTS.md` に従う。

## 4. 完了の条件
- 上記「完了の条件」のチェック項目をすべて満たす
- テスト・リント・型チェックが通る
- 上の「完了の条件」のうち、**（ADR-0011）と付いた項目と今回の作業に関わる項目**をすべて満たす（reassign は全項目）
- `npm test`・`npm run lint`・`npm run typecheck`・`npm run build` がすべて通る
- 契約にない仕様を推測して実装した箇所があれば、報告に `QUESTIONS:` として列挙する
- コメント・コミットメッセージは日本語

## 5. 背景（参考）
PoC本体（`katahimo-dev/visit-route-poc`）の管理者画面（予定・手作業の割当・AI案との比較）を、サーバーなしでブラウザだけで動く静的サイトに移し、GitHub Pages で公開する。
データは localStorage に残し、JSON で書き出し・読み込みする。
最適化は Python（OR-Tools）の代わりに Web Worker 上の焼きなましで解き、ClassClassify のように**項目・条件・重み（0〜5）・必須**で、相性・スタッフの特性・顧客の希望を柔軟に足せるようにする。
目的は、協力法人に触ってもらって割当の考え方を集めるサイクルを速く回すこと（PRD §1）。

## 6. やらないこと
- ログイン・サーバー保存・事業所の分離・同時編集。外部送信は地図タイルの取得だけ
- Firebase・Cloud Functions・Python 最適化・Google Maps Platform。移動時間は直線距離からの概算（PoC本体 `estimateLeg`）だけ
- スタッフの記録・位置・ジオフェンス・勤怠・CSV・通知・PWA のオフライン対応
- 相性の学習。相性・特性・希望は人が入れる
- 月次シフトの一括作成。AI案は1日単位
- 欠勤まわり（ADR-0011）：本人からの欠勤連絡の受付、通知の自動送信（連絡文はコピーだけ。2回目）、複数日の欠勤の一括入力、勤怠・有給の管理、欠勤を入れただけで勝手に振り直すこと、訪問の中止・日時変更の自動提案
- PoC本体へのコードの書き戻し。共通の純粋関数は**写して**使い、同期しない（ADR-0001）
