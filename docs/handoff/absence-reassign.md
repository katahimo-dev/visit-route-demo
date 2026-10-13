# 作業指示書：reassign（欠勤の振り直し。ADR-0011）

## 0. 今回の作業（ADR-0011「当日の急な欠勤の振り直し」の1回目。PRD D26〜D33）
下の「1. 担当範囲」はこのコンポーネントの節をそのまま写したもので、前からある内容も入っている。**今回やるのは次だけ**（前からある機能は壊さない）。

- design.md §4 reassign の規則と §5 の5つの関数を実装する（`src/contracts/reassign.ts` の型を使う）
- matching は公開の関数（`scheduleRoute`・`routeCost`・`balancePoints`・`bestInsertion` など）だけを使う（matching の中は変えない。足りなければ質問する）
- 乱数・`Date.now`・`Math.random` を使わない

- 触ってよいファイル：`src/reassign/`（新規。入口は `src/reassign/index.ts`）
- 作業の順（契約だけでやりとりする）：① store（契約 `src/contracts/` を確定）→ ② domain → ③ matching → ④ reassign → ⑤ excel・pages（④と⑤は並行してよい。pages は reassign の型だけを先に使い、実装ができてから結合）。
- 2回目の範囲（案B「少し動かしてよい」・連絡の一覧。PRD D34・D35）は作らない
- 参照：`docs/adr/0011-same-day-absence-reassign.md`、`docs/prd.md` D26〜D35、`docs/design.md` §4・§5・§8
- design.md §8 の確認待ちの細部（1人1日1件・30分単位・午前/午後の境 12:00・始まっている訪問・候補で時刻を変えない・件数の上限を守る）は**設計書のとおり**に作る。それ以外で迷ったら推測せず `QUESTIONS:` で報告する

## 1. 担当範囲
- 責務：欠勤を差し引いた問題（`Problem`）と元の案（担当ごとの列）から、①振り直す訪問を決める（`targetsOf`）②他の人の担当・順番・開始時刻を変えずに、振り直す訪問を空き時間へ1件ずつ入れる（案A「空き時間に入れるだけ」。`reassign`）③入らない訪問の受けられる人の候補を出す（`candidatesFor`）・候補の人に入れる（`placeVisit`）④元の案と振り直した案の差を出す（`reassignDiff`）。どれも純粋関数で決定的（乱数・`Date.now` を使わない。いまの時刻は引数）。`DemoData` は読まない・書かない（問題と列だけを受け取り、新しい列を返す）。
- 振り直しの規則（1回目＝案A。受け入れ基準として守る）：
  - 終わった訪問：時間の約束でいちばん遅く始めても、いまの時刻までに終わる訪問（latest＋作業時間 ≤ いまの時刻）。いまの時刻が無ければ無い。終わった訪問は誰のものも動かさない
  - 振り直す訪問：欠勤のある人（引数）の元の案の、終わっていない訪問のうち、(a) その人に可にならない訪問（理由が稼働時間帯＝`absence`、それ以外の必須の条件＝`notAllowed`）、(b) 残りを列の順に足していき、足すと strict で回れなくなる訪問（`unreachable`。欠勤明けに自宅から間に合わない等。この判定の列には終わった訪問を入れない）。それ以外はその人のまま残す
  - 入れられる位置：可・件数の上限（必須の負担の均等）を超えない・その列にすでにある訪問の開始時刻を変えずに strict で回れる・入れた訪問の開始がいまの時刻以降、のすべてを満たす位置。欠勤の人も欠勤でない時間なら入れられる人に含む
  - 入れる順：残りの振り直す訪問ごとに入れられる人（位置のある人）を数え、少ない訪問から。同じ数なら regret（最良と次善の増える費用の差。次善が無ければ最大）の大きい訪問、それも同じなら開始（earliest）の早い順・問題の訪問の順。1件入れるたびに数え直す
  - 位置の選び方：増える費用（その列の 移動＋待ち×係数＋割当費用 の増分 ＋ 負担の均等の点の増分）が最も少ない位置。同じなら問題の staff の順で先の人・前の位置
  - 入れられる人がいない訪問は `unplaced` に残す（欠勤の人の列には残さない）。元の案で入らなかった訪問は振り直さない
  - 問題にいない人の列・問題に無い訪問は触らずにそのまま返す
- 持つデータ（持ち主）：なし
- 提供するAPI：§5「欠勤と振り直し」の `targetsOf`・`reassign`・`candidatesFor`・`placeVisit`・`reassignDiff`
- 依存するもの：contracts、matching（`scheduleRoute`・`routeCost`・`balancePoints` など時刻と費用の計算だけ）。solver・evaluate・store・画面には依存しない
- 配置：`src/reassign/`
- 2回目（案B・連絡の一覧）は §5「欠勤の振り直し：2回目の範囲」。1回目の作業指示書には入れない
- 完了の条件：
  - [ ] 欠勤の時間と重なる訪問がすべて `absence` で、欠勤明けの最初の訪問に自宅から間に合わない訪問が `unreachable` で振り直す訪問になる。終わった訪問・欠勤と重ならず間に合う訪問はならない（テスト）
  - [ ] 他の人の訪問の担当・順番・開始時刻は変わらない：結果の各列から振り直した訪問を除くと元の案の列（欠勤の人は振り直す訪問を除いた列）と同じで、その訪問の開始時刻も同じ（性質テスト：seed の14日・各スタッフの終日・午前・午後の欠勤）
  - [ ] 振り直した訪問は可・strict・件数の上限を守り、開始がいまの時刻以降（`scheduleRoute` の strict が null でない。テスト）
  - [ ] 入れる順：入れられる人の少ない順、同じなら regret の大きい順（小さな問題でテスト）。同じ入力で同じ結果（テスト）
  - [ ] `pins` は結果で担当のいるすべての訪問（元の案のままの訪問と振り直した訪問）。`unplaced` の訪問はどの列にも無い（テスト）
  - [ ] 候補：可で strict に入る人が先で増える費用の小さい順、入らない人は「ずらせば入る」最小の分（5分刻み・前後120分まで）、必須で外れる理由・重みの違反の理由を返す。`placeVisit` は候補の「入る」と同じ位置に入れ、入らない人には `bestInsertion` と同じ規則で入れる（テスト）
  - [ ] 差：担当が変わった訪問・開始が変わった訪問（分）・入らない訪問・変わる人・移動の増減が出る（テスト）
  - [ ] 8人・20件で100ms以内、30人・150件で1秒以内（中位のノートPC）

触ってよい範囲：`src/reassign/`（新規。入口は `src/reassign/index.ts`）（§0）。
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
| reassign | 関数 | `targetsOf / reassign / candidatesFor / placeVisit / reassignDiff` | 欠勤の振り直し：振り直す訪問・案A・入らない訪問の候補・元の案との差（ADR-0011） |

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
