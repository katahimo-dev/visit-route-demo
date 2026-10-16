# 作業指示書：patterns（定期パターンの展開。ADR-0012）

## 0. 今回の作業（ADR-0012「月単位の予定」の段階1。PRD D36〜D44）
下の「1. 担当範囲」はこのコンポーネントの節をそのまま写したもので、前からある内容も入っている。**今回やるのは次だけ**（前からある機能は壊さない）。

- 新しいコンポーネント `src/patterns/` を作る：`occursOn`・`expandPattern`・`applyPatterns`・`splitPattern`・`removePattern`（契約は design.md §5、規則は §4 patterns。規則は受け入れ基準としてテストで確かめる）
- 純粋関数・決定的（`Math.random`・`Date.now` を使わない。今日は引数）。`DemoData` を書き換えない
- 触ってよいファイル：`src/patterns/`（新規）だけ。domain の `addDays`・`weekday` は使うだけ（変えない）
- 参照：`docs/adr/0012-monthly-plan-patterns-visit-types.md`、`docs/prd.md` D36〜D44、`docs/design.md` §4・§5・§7・§8
- 作業の順（契約だけでやりとりする）：① store（契約 `src/contracts/` を確定）→ ② patterns → ③ seed・matching（並行してよい）→ ④ excel・pages（並行してよい。pages は patterns・matching の型を先に使い、実装ができてから結合）
- 段階3（空き状況の表・問い合わせの試算。D45〜D48）・段階2（週間の時間軸・ドラッグ・スタッフ×曜日の表・D21 の見直し。D49〜D52）は作らない
- 種類の条件は常に必須・月まとめは基準のプリセット（点数の基準のプリセット）・パターンにいつもの担当、は推奨で設計した（利用者の確認待ち。PRD §8）。**設計書のとおり**に作る。それ以外で迷ったら推測せず `QUESTIONS:` で報告する

## 1. 担当範囲
- 責務：定期パターン（`Pattern`）から、決まった期間の訪問を**展開**する。パターンを「いつから」で分けて直し（「以降すべて」）、その日以降のこの回だけの変更が無い訪問を作り直す。パターンを消したときに今日以降の訪問を除く。どれも純粋関数で決定的（乱数・`Date.now` を使わない。今日は引数）。`DemoData` を書き換えない（新しいパターン・訪問の配列を返し、画面が `update` で入れる）
- 展開の規則（受け入れ基準として守る）：
  - その日に訪問がある＝曜日が `weekdays` にあり、`from` ≤ 日 ≤ `to`（null は無限）、`from` を含む週（日曜はじまり）を1週目として (週の番号 − 1) が `everyWeeks` で割り切れる
  - 利用中でない利用者さん（`active` が false）のパターンは展開しない
  - 訪問の ID は `${元の日}_${パターンID}`。中身は パターンの `clientId`・`typeId`・時間の決め方・開始（早）・開始（遅）・所要、`staffId: null`・`cancelled: false`・`note: ''`、`pattern: { id, date: 元の日, edited: false }`
  - すでに同じ ID の訪問があれば作らない（この回だけの変更・取り消し・日付をずらした訪問がそのまま残る）。今日（引数）より前の日には作らない
  - 並びは日付・開始（早）の順に足す（既存の訪問の順は変えない）
- パターンを直す（`splitPattern`）：
  - 「いつから」（`since`）が元のパターンの `from` 以前なら、同じ ID のまま中身を置き換える。そうでなければ元のパターンの `to` を `since` の前日にし、新しい ID（引数）で `from` = `since` のパターンを足す
  - 作り直す期間は max(`since`, 今日) から、元のパターンの訪問の最後の日（展開済みの範囲）まで。その期間の、元のパターンの `edited` でない訪問を除き、直したパターンから展開し直す（`edited` の訪問・取り消した訪問は残す。取り消しは `edited` として扱う）
  - 除いた訪問・足した訪問の ID と、それが入る日（確定した割当がある日の確認に使う）を返す
- パターンを消す（`removePattern`）：パターンを除き、今日以降の `edited` でない訪問を除く。今日より前の訪問・`edited` の訪問は残し、`pattern` を null にする
- 持つデータ（持ち主）：なし
- 提供するAPI：§5「訪問の種類と定期パターン」の `occursOn`・`expandPattern`・`applyPatterns`・`splitPattern`・`removePattern`
- 依存するもの：contracts、domain（`addDays`・`weekday`）。matching・solver・store・画面には依存しない
- 配置：`src/patterns/`
- 完了の条件：
  - [ ] 毎週・隔週（`from` の週が1週目）・4週ごと、`from`・`to` の端、複数の曜日、利用中でない利用者さんで、展開される日が正しい（テスト）
  - [ ] 同じ入力から同じ訪問（ID・順）。2回続けて `applyPatterns` しても訪問は増えない。この回だけ直した訪問・取り消した訪問・日付をずらした訪問は上書きされない（テスト）
  - [ ] 今日より前の日には作らない（テスト）
  - [ ] `splitPattern`：`since` が `from` 以前なら置き換え、後なら元の `to` が前日・新しいパターンが `since` から。`since` より前の訪問と `edited` の訪問は変わらず、それ以外の展開済みの範囲の訪問が新しい中身になる。返す除いた・足した訪問の日が正しい（テスト）
  - [ ] `removePattern`：今日以降の `edited` でない訪問が消え、残した訪問の `pattern` は null（テスト）
  - [ ] seed の20人・14日を展開して1秒以内（中位のノートPC）

触ってよい範囲：上記の「配置」に書かれたディレクトリのみ。
触ってはいけない範囲：他コンポーネントの内部、共通設定（変更が必要なら質問する）。

## 2. 守るべき契約
### 提供するAPI
（API一覧の表にこのコンポーネントの行がありません。docs/api/ を確認するか、契約を追加してください）

### エラー方針
| コード | HTTP | 意味 | 呼び出し側の対応 |
|---|---|---|---|
| INVALID_ARGUMENT | — | 読み込んだ JSON が契約に合わない | 画面に日本語で原因（項目名）を出し、元のデータを残す |
| FAILED_PRECONDITION | — | その日の訪問・稼働中のスタッフがいない、どの担当も可にならない訪問がある | 原因の訪問と条件を出す。解ける訪問だけで解く |
| RESOURCE_EXHAUSTED | — | localStorage の容量超過 | 書き出しを促す |
| ABORTED | — | 利用者が計算を止めた | それまでの最良案を出す |
| INVALID_ARGUMENT | — | 欠勤の時間帯が正しくない（終了 ≤ 開始・30分単位でない）（ADR-0011） | 欠勤の欄に日本語で理由を出し、登録しない |
| FAILED_PRECONDITION | — | 振り直しの元の案が無い（確定した割当も今の案も無い）（ADR-0011） | 「先にAI案を作ってください」を出す。欠勤だけは登録できる |
| FAILED_PRECONDITION | — | 月まとめ作成の対象の日が無い（その月の今日以降に訪問が無い・すべて確定済み）（ADR-0012） | 理由を出してボタンを押せなくする |
| ABORTED | — | 月まとめ作成を止めた・画面を離れた（ADR-0012） | 作れた日は残す。知らせに「N日分で止めました」 |
| INVALID_ARGUMENT | — | 定期パターンの期間・時刻が正しくない（終了日が開始日より前、開始（早）が開始（遅）より後、曜日が0個）（ADR-0012） | 欄に理由を出して保存しない |

Worker 内の例外は `{type:'error', message}` で返し、内部の文言をそのまま画面に出さない。

### 冪等性・タイムアウト
- 同じ `Problem`・`seed`・`iterations` からは同じ結果（反復回数で止め、時刻・`Math.random` を使わない）
- 反復回数の既定は問題の大きさから決める（目安 3秒）。上限 30秒で `stop` を送り、最良案を採る
- 保存は上書きのみ（1キー）。読み込みは「置き換える前に確認」を出す
- 展開（patterns）は同じパターン・訪問・今日から同じ結果。2回続けても訪問は増えない（ID が決定的で、既存の ID は作らない。ADR-0012）
- 月まとめ作成は1日ずつ書くので、途中で止めても作れた日は壊れない。「まだ案の無い日だけ」でもう一度押すと、作れなかった日だけを作る（ADR-0012）
- 振り直し（reassign）は同じ問題・元の案・振り直す訪問から同じ結果。「登録して振り直す」を2回押す（確定した割当が無い）と、2回目は1回目の結果（今の案）から振り直す（振り直す訪問が無ければ案は変わらない。記録は同じ結果なら足さない）。`reassign` の元の案の情報は最初のものを引き継ぎ、`absenceIds` は累積する（§4 reassign の補足）

### 呼び出してよい他コンポーネントのAPI（参考）
| コンポーネント | メソッド | エンドポイント | 概要 |
|---|---|---|---|
| store | 関数 | `load / save / reset / exportJson / importJson` | データ一式の保存・入出力 |
| domain | 関数 | `withoutAbsences(slots, absences) → Slot[]` | 稼働時間帯から欠勤を差し引く（デモ独自。ADR-0011） |
| matching | 関数 | `compile(data, date) → Problem` | 項目・条件 → 可否・費用表（`data.absences` の欠勤を稼働時間帯から差し引く。ADR-0011） |
| solver | Worker | `{type:'solve', problem, options: {seed, iterations, initial?}}`（`initial`：初期解の候補。案B。ADR-0011 追記） → `{type:'progress', iteration, total, bestScore, bestRoutes?}` … `{type:'done', result}`（`bestRoutes` は画面が点数の基準の物差しで「いまの最良 N点」を付け直すため。`bestScore` が前の進捗と同じなら送らず、画面は前の点のまま。ADR-0010） | AI案を作る。`{type:'stop'}` で最良案を返して終わる |
| evaluate | 関数 | `score / explain / diff / normalize / toHundred / hundredBreakdown / achievements` | 採点・理由・記録どうしの差・点数（100点満点）・条件ごとの達成の件数 |
| excel | 関数 | `exportWorkbook / importWorkbook` | Excel のブックとの変換（ADR-0006。「欠勤」シート：ADR-0011） |
| reassign | 関数 | `targetsOf / reassign / candidatesFor / placeVisit / reassignDiff` | 欠勤の振り直し：振り直す訪問・案A・入らない訪問の候補・元の案との差（ADR-0011） |
| patterns | 関数 | `occursOn / expandPattern / applyPatterns / splitPattern / removePattern` | 定期パターンから訪問を展開する・パターンを分けて直す・消す（ADR-0012） |
| reassign | 関数 | `prepareAnneal / finishAnneal / settleAnneal / annealCost / stayPointsOf / contactsOf` | 2回目：案B の問題と初期解・結果のまとめ・保険（案A のままにするか）・案B の目的の値・減点・連絡の一覧（ADR-0011 追記） |

詳細な定義：`docs/api/` を参照。

### 訪問の種類と定期パターンの契約（design.md §5 から写した。型の正は `src/contracts/`）（`src/contracts/documents.ts`・`src/contracts/data.ts`・`src/contracts/patterns.ts`。ADR-0012）

```ts
// documents.ts：訪問の種類（利用者が足す。最大20）
const visitTypeSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(20),
  color: z.number().int().min(0).max(7),            // 色の丸の番号（〈利用者さん〉と同じ8色）
  durationMinutes: z.number().int().min(5).max(720), // 標準の所要（新しい訪問・パターンの初期値だけ）
  requirements: z.array(conditionSchema).max(20),    // 担当に必要な条件（スタッフの特性に対して）。常に必須
  note: z.string().max(200),
})
type VisitType = z.infer<typeof visitTypeSchema>

// documents.ts：定期パターン（利用者さんごと。複数持てる）
const patternSchema = z.object({
  id: idSchema,
  clientId: idSchema,
  typeId: idSchema.nullable(),                       // null＝種類を問わない
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7), // 0=日〜6=土
  everyWeeks: z.number().int().min(1).max(4),        // 1＝毎週、2＝隔週…。from を含む週（日曜はじまり）を1週目
  windowKind: z.enum(WINDOW_KINDS),
  earliestStart: hhmmSchema,
  latestStart: hhmmSchema,
  durationMinutes: z.number().int().min(5).max(720),
  from: dateSchema,
  to: dateSchema.nullable(),                         // null＝続く
  usualStaffId: idSchema.nullable(),                 // いつもの担当。null＝利用者さんのいつもの担当
  note: z.string().max(200),
}) // superRefine：to があれば from ≤ to（「終了日は開始日以降にしてください」）、earliestStart ≤ latestStart
type Pattern = z.infer<typeof patternSchema>

// documents.ts：訪問に足す（どちらも既定値 null。古いデータはそのまま読める）
//   typeId: idSchema.nullable().default(null)
//   pattern: z.object({ id: idSchema, date: dateSchema /* 元の日 */, edited: z.boolean() /* この回だけ変えた */ }).nullable().default(null)

// data.ts
// DemoData.visitTypes: VisitType[]（.max(20).default([])）
// DemoData.patterns: Pattern[]（.max(2000).default([])）
// DATA_VERSION は1のまま

// patterns.ts：patterns の入出力
type PatternInput = Pick<DemoData, 'patterns' | 'visits' | 'clients'>
type DateRange = { from: string; to: string }      // 両端を含む（YYYY-MM-DD）
type PatternChange = {
  patterns: Pattern[]                               // 新しいパターンの一覧
  visits: Visit[]                                   // 新しい訪問の一覧
  added: { visitId: string; date: string }[]
  removed: { visitId: string; date: string }[]
}

function occursOn(pattern: Pattern, date: string): boolean
function expandPattern(pattern: Pattern, range: DateRange): Visit[]          // 利用中かどうか・既存の訪問は見ない
function applyPatterns(data: PatternInput, range: DateRange, today: string): PatternChange
  // 全パターン（利用中の利用者さんだけ）を range ∩ [today, ∞) に展開し、無い ID だけ足す（removed は空）
function splitPattern(data: PatternInput, patternId: string, next: Omit<Pattern, 'id' | 'from'>, since: string, today: string, newId: string): PatternChange
  // §4 patterns の「パターンを直す」。patternId が無ければ何もしない（同じデータを返す）
function removePattern(data: PatternInput, patternId: string, today: string): PatternChange
// 実装（src/patterns/）は、この関数の型（OccursOn・ExpandPattern・ApplyPatterns・SplitPattern・RemovePattern）で注釈する
```

- 例外を投げない：いない利用者さん・パターンは無視する。`applyPatterns` は同じ入力なら同じ結果（訪問の順も）
- 訪問を直して `edited` を立てるのは画面（`VisitForm`）。patterns は `edited` の訪問・取り消した訪問を消さない
- matching の種類の判定：`Problem` の形は変えない（可否・割当費用・理由に入るだけ）。理由の `ruleId: 'visitType'` は条件（`rules`）の ID ではないので、条件ごとの達成（`achievements`）には数えない
- 月まとめ作成の書き込みは今までの今の案・記録の形（`AiPlan`・`AiRun`）のまま。新しい型は無い

## 3. ルール
`AGENTS.md` に従う。

## 4. 完了の条件
- 上記「完了の条件」のチェック項目をすべて満たす
- テスト・リント・型チェックが通る
- 契約にない仕様を推測して実装した箇所があれば、報告に列挙する

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
- 勤務シフトの自動作成。月まとめ作成（ADR-0012）は、決まった勤務の中で AI案を**1日ずつ**作るだけで、日をまたいだ最適化（月の件数の均等・同じ人が続けて担当する並べ方）はしない
- 定期パターンの「毎月第N曜日」「毎月15日」・祝日の扱い（間隔は1〜4週ごとだけ。ADR-0012）
- 欠勤まわり（ADR-0011）：本人からの欠勤連絡の受付、通知の自動送信（連絡文はコピーだけ。2回目）、複数日の欠勤の一括入力、勤怠・有給の管理、欠勤を入れただけで勝手に振り直すこと、訪問の中止・日時変更の自動提案
- PoC本体へのコードの書き戻し。共通の純粋関数は**写して**使い、同期しない（ADR-0001）
