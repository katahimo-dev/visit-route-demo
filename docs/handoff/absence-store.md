# 作業指示書：store（データ一式の保存）

> 注記：「いまの時刻」（now）は 2026-10-14 に廃止した（ADR-0011 追記）。本文の now・いまの時刻の記述は古い（いまの設計の正は docs/design.md）。

## 0. 今回の作業（ADR-0011「当日の急な欠勤の振り直し」の1回目。PRD D26〜D33）
下の「1. 担当範囲」はこのコンポーネントの節をそのまま写したもので、前からある内容も入っている。**今回やるのは次だけ**（前からある機能は壊さない）。

- 契約を design.md §5「欠勤と振り直し」のとおり `src/contracts/` に書く（`absenceSchema`・`DemoData.absences`（`.default([])`）・`reassignInfoSchema` と `AiPlan.reassign`・`AiRun.reassign`（optional）・`reassign.ts` の型。関数の実装は書かない）
- `repair` に欠勤と `reassign` の直し方を足す（design.md §4 store の「欠勤」）
- seed の初期データに `absences: []`
- DATA_VERSION は1のまま

- 触ってよいファイル：`src/contracts/documents.ts`・`src/contracts/data.ts`・`src/contracts/reassign.ts`（新規）・`src/store/`・`src/seed/`（初期データの `absences: []` だけ）
- 作業の順（契約だけでやりとりする）：① store（契約 `src/contracts/` を確定）→ ② domain → ③ matching → ④ reassign → ⑤ excel・pages（④と⑤は並行してよい。pages は reassign の型だけを先に使い、実装ができてから結合）。
- 2回目の範囲（案B「少し動かしてよい」・連絡の一覧。PRD D34・D35）は作らない
- 参照：`docs/adr/0011-same-day-absence-reassign.md`、`docs/prd.md` D26〜D35、`docs/design.md` §4・§5・§8
- 欠勤の細部（1人1日1件・30分単位（半端は丸める）・午前/午後の境 12:00・始まっている訪問も動かさない・候補で時刻を変えない・件数の上限を守る・未確定の変更は確認してから捨てる）は 2026-10-13 に利用者が決定済み（design.md §8 の「決めたこと」）。**設計書のとおり**に作る。それ以外で迷ったら推測せず `QUESTIONS:` で報告する

## 1. 担当範囲
- 責務：データ一式（`DemoData`）の読み込み・保存・検査・版の移行、JSON の書き出し・読み込み、初期状態に戻す。画面へは React のフック（`useDemoData()`・`update(fn)`）で渡す。
- 持つデータ（持ち主）：`DemoData`＝`{ version, org, staff[], clients[], visits[], availability[], absences[]（欠勤。ADR-0011）, manualPlans{date→routes}, items[], rules[], compat{clientId→{staffId→-2..2}}, aiPlans{date→AiPlan（routes＝手直し後、generated＝AIが出したまま、pins＝固定、runId＝元の記録）}, aiRuns{date→AiRun[]（記録。§5）}, presets[]（条件のプリセット。最大6つ。§5。ADR-0008）, scorePresetId?（点数の基準のプリセットの id。ADR-0010）, seed }`。`prevAiPlans`（前回のAI案）は廃止し、記録に置き換えた。localStorage のキー `vrdemo:data:v1` に1つの JSON で置く。
- 提供するAPI：`repair(data)`（契約は通るが中身が食い違うデータを直す：いない人・訪問を指す割当・相性・上書き・固定を除く、ID の重複は最初の1件。記録 `aiRuns` も同じに直し、いない人・訪問を指す記録の割当を除き、1日20件を超える分は古いものから捨てる。プリセット `presets` は id の重複を最初の1件に、6つを超える分は後ろを捨て、0件なら初期の3種、重みは 0〜5 に収めて 0.5 刻みに丸め、必須にできない型の必須は外す。点数の基準 `scorePresetId` は、無い・どのプリセットでもない id なら先頭のプリセットにする（ADR-0010）。`migrate` のあとに必ず通す）、`load(): DemoData`、`save(data)`（300ms 間引き）、`reset(): DemoData`、`exportJson(data): Blob`、`importJson(text): DemoData | ImportError`、`migrate(raw): DemoData`。版は1のまま。読み込み時、`prevAiPlans` は捨て、`aiRuns` が無い古いデータは `{}` で、`presets` が無い古いデータは初期の3種（seed の `INITIAL_PRESETS`）で補う（`migrate` の既定値。版は1のまま）。
- 欠勤（ADR-0011）：`DemoData.absences`（欠勤の記録。§5「欠勤と振り直し」）も持つ。無い古いデータは zod の既定値で `[]`（`aiRuns` と同じく版は1のまま）。`repair` は、いない人の欠勤を除き、ID の重複は最初の1件、同じ人・同じ日の欠勤は最後の1件にする（稼働時間の上書きと同じ）。今の案・記録の `reassign`（振り直しの元の案）の `baseRoutes`・`basePins` は `routes`・`pins` と同じ規則で直す（`absenceIds` は消された欠勤を指していてもそのまま。取り消しの表示に使う）
- 依存するもの：seed（初期データ）、zod（検査）。
- 配置：`src/store/`
- 完了の条件：
  - [ ] 壊れた・古い版の JSON を読むと、移行するか、元のデータを残したまま利用者向けの日本語のエラーを返す（画面が真っ白にならない）
  - [ ] 書き出し → 読み込み で同じデータに戻る（テスト）
  - [ ] localStorage の容量超過で保存に失敗したら、書き出しを促す表示を出す
  - [ ] （ADR-0011）`absences` の無い古いデータは `[]` で読める。いない人の欠勤は消え、同じ人・同じ日の欠勤は最後の1件になる。欠勤・`AiPlan.reassign`・`AiRun.reassign` を含むデータが 書き出し → 読み込み で同じに戻る（テスト）

触ってよい範囲：`src/contracts/documents.ts`・`src/contracts/data.ts`・`src/contracts/reassign.ts`（新規）・`src/store/`・`src/seed/`（初期データの `absences: []` だけ）（§0）。
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
| コンポーネント | メソッド | エンドポイント | 概要 |
|---|---|---|---|
| store | 関数 | `load / save / reset / exportJson / importJson` | データ一式の保存・入出力 |

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
