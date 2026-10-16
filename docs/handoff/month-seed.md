# 作業指示書：seed（デモの初期データ）

## 0. 今回の作業（ADR-0012「月単位の予定」の段階1。PRD D36〜D44）
下の「1. 担当範囲」はこのコンポーネントの節をそのまま写したもので、前からある内容も入っている。**今回やるのは次だけ**（前からある機能は壊さない）。

- 初期の種類（介護・リハビリ）、項目「資格」の選択肢（理学療法士・作業療法士・言語聴覚士）と、スタッフ2人の理学療法士を足す
- 利用者さんごとの定期パターン（ID は利用者さんの ID と同じ）を作り、初期の訪問を patterns の `applyPatterns` で展開する。**いまの seed と同じ訪問**（ID・日付・時刻・所要）になることをテストで確かめる（いまの `visitsOf` の結果と比べる）。稼働時間の上書き（`overridesOf`）と、いつもの担当を決める内部の割当は今までどおり
- 高齢の利用者さん2人に週1回・40分のリハビリのパターンを足す（どの人・曜日・時刻にしたかを報告する）
- `daysFrom` も、パターンから展開するようにする（稼働時間の上書きは今までどおり）
- 既存のテストで、seed の結果の値（点数・件数など）に依存して落ちるものがあれば、リハビリの訪問を足したせいかを確かめてから直し、報告する（性質のテストは直さずに通ること）
- 触ってよいファイル：`src/seed/`
- 参照：`docs/adr/0012-monthly-plan-patterns-visit-types.md`、`docs/prd.md` D36〜D44、`docs/design.md` §4・§5・§7・§8
- 作業の順（契約だけでやりとりする）：① store（契約 `src/contracts/` を確定）→ ② patterns → ③ seed・matching（並行してよい）→ ④ excel・pages（並行してよい。pages は patterns・matching の型を先に使い、実装ができてから結合）
- 段階3（空き状況の表・問い合わせの試算。D45〜D48）・段階2（週間の時間軸・ドラッグ・スタッフ×曜日の表・D21 の見直し。D49〜D52）は作らない
- 種類の条件は常に必須・月まとめは基準のプリセット（点数の基準のプリセット）・パターンにいつもの担当、は 2026-10-16 に利用者が推奨どおりに決定済み。**設計書のとおり**に作る。それ以外で迷ったら推測せず `QUESTIONS:` で報告する

## 1. 担当範囲
- 責務：PoC本体 `scripts/seedDemo.ts` の生成ロジック（仙台・スタッフ8人・訪問先20か所・日ごとの予定・稼働時間帯の上書き）を写し、本デモの項目・条件・相性の初期セットと、条件のプリセットの初期値3種（`src/seed/presets.ts` の `INITIAL_PRESETS`。データの `presets` に入る）を足す。手作業らしい割当は内部でだけ作り、データには入れない（`visits[].staffId` はすべて null、`manualPlans` は空 `{}`）。PoC本体の seed からのデモ独自の差分：スタッフの呼び方は「スタッフ」（業種 care の既定「ヘルパー」は `domain/terms.ts` に写したまま変えない。呼び方はデータの画面で変えられる）、項目「得意」に「料理」を足す。訪問の時間はすべて希望の時刻ちょうど（PoC本体の「幅」の訪問は、幅の始まりの時刻ちょうどに変えた。ただし c4 は日曜に担当が足りなくなるので幅の終わりの 10:30 にした。実際の業務では利用者さんごとの希望の時刻に訪問するため。2026-10-13）。画面・Excel で「幅」の訪問を入れることはできる。ただし訪問先の「いつもの担当」（`usualStaffId`）は、その割当で最も多く担当した人にする（継続の条件を試せるように）。日付だけで同じ結果が決まる。
- 持つデータ（持ち主）：なし
- 提供するAPI：`createDemoData(today: string): DemoData`（今日から14日分）
- 依存するもの：domain、patterns（初期の訪問の展開。ADR-0012）
- 配置：`src/seed/`
- 完了の条件：
  - [ ] PoC本体の性別希望（c6・c18 女性、c11 男性）は「性別」項目＋訪問先の必要条件に、NG（c2→s2、c12→s7）は相性「×」になる
  - [ ] 初期の項目は スタッフ側：性別・資格（介護福祉士/看護師/保育士/初任者研修 の複数）・経験年数（数値）・得意（高齢/子ども/障害/家事/話し相手 の複数）・喫煙者・ペット可。訪問先側：ペットあり・喫煙環境・対象（高齢/子ども/障害）。初期の条件は §5 の表の既定値
  - [ ] 同じ日付を渡すと同じデータになる（テスト）
  - [ ] 手作業の割当が入らない（全訪問の `staffId` が null、`manualPlans` が `{}`）。`usualStaffId` は入る（テスト）
  - [ ] 初期データに欠勤は入らない（`absences` が `[]`。ADR-0011）
  - [ ] （ADR-0012）初期の種類は「介護」（担当に必要な条件：資格に介護福祉士・初任者研修・看護師のどれか）と「リハビリ」（資格に理学療法士・作業療法士・言語聴覚士のどれか）。項目「資格」の選択肢に理学療法士・作業療法士・言語聴覚士を足し、スタッフ2人に理学療法士を持たせる
  - [ ] （ADR-0012）利用者さんごとに定期パターン1つ（ID は利用者さんの ID と同じ。曜日はいまの規則＝平日のうち1つの曜日だけ休み・`weekend` の印があれば土日も。時刻・所要は `slot`。対象が子どもの利用者さんは種類なし、ほかは介護。開始日は基準日、終了日なし、いつもの担当なし）。訪問は patterns の `applyPatterns` で基準日から14日分を展開し、**いまの seed と同じ訪問**（ID `${日付}_${利用者さんID}`・日付・時刻・所要。テスト）に `typeId`・`pattern` が付いたものになる。加えて高齢の利用者さん2人に、週1回・40分のリハビリのパターン（既存の訪問と時間が重ならない曜日・時刻）を足す
  - [ ] プリセットの初期値は3種（標準・移動を短く・人の組み合わせ重視。id は `standard`・`travel`・`people`）。型ごとに重み・必須を決め、条件（rules）の型ごとに上書きする（§5 の表）。`applyPreset(rules, preset)`・`presetOf(rules, presets)`、点数の基準の `scorePresetOf(presets, id)`（無ければ先頭）・`scoreRulesOf(data)`（条件に基準のプリセットの重み・必須を当てたもの。プリセットが0件なら条件そのもの。ADR-0010）を持つ。初期データの `scorePresetId` は `standard`

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
