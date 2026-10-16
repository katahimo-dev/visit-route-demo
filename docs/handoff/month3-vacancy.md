# 作業指示書：vacancy（空き状況・問い合わせの試算。ADR-0012 追記。段階3）

## 0. 今回の作業（ADR-0012 追記「月単位の予定」の段階3。PRD D45〜D48）
下の「1. 担当範囲」はこのコンポーネントの節をそのまま写したもので、前からある内容も入っている。**今回やるのは次だけ**（前からある機能は壊さない）。

- 契約 `src/contracts/vacancy.ts`（design.md §5 のとおり。関数の型 VacancyOf・VerdictOf・InquirySummary・DayFreenessFn も）と、〈利用者さん〉の `tentative: z.boolean().default(false)` を足す（store の repair・テストに影響があれば直す）
- reassign に `fitsOf` を足す（`candidatesFor` の fits の人だけ・同じ並び・ずらす探索なし。テスト：`candidatesFor` の fits と一致）
- excel の〈利用者さん〉シートに「仮押さえ」（○）の列（列が無いブックは false。書き出し→読み込みで戻るテスト）
- `src/vacancy/` に `vacancyOf`・`verdictOf`・`inquirySummary`・`dayFreeness` を実装し、§4 vacancy の完了の条件をテストにする
- 触ってよいファイル：`src/contracts/`・`src/store/`（tentative の読み込みだけ）・`src/reassign/`（`fitsOf` の追加だけ）・`src/excel/`（仮押さえの列だけ）・`src/vacancy/`（新規）
- 参照：`docs/adr/0012-monthly-plan-patterns-visit-types.md`、`docs/prd.md` D45〜D48、`docs/design.md` §4 vacancy・pages・§5「空き状況と問い合わせの試算」
- 作業の順：① 契約と小さな変更（`src/contracts/vacancy.ts`・〈利用者さん〉の `tentative`・reassign の `fitsOf`・excel の「仮押さえ」列）→ ② vacancy → ③ pages
- 迷ったら推測せず `QUESTIONS:` で報告する

## 1. 担当範囲
- 責務：先の数週（初期値4週）の各日の**元の案**（確定した割当があればそれ、無ければ今の案。欠勤の `baseOf` と同じ選び方）に、仮の訪問を「他の人の担当・順番・開始時刻を変えずに」入れられるかを、曜日×開始時刻（30分刻み）ごとに数える。①空き状況の表（場所なし＝目安）②問い合わせの試算（場所あり＝移動も含めて正確）③日の午前・午後の空きの割合（月間カレンダーの帯）。どれも純粋関数で決定的。`DemoData` は読むだけ（書かない）
- 数え方（受け入れ基準として守る）：
  - 対象の日：`range.from` から `range.weeks`×7日。元の案が無い日（訪問があって案も確定も無い）は数えず `noPlanDates` に入れる。訪問が1件も無い日は空の案として数える
  - 開始時刻：`query.dayStart`〜`query.dayEnd`（初期値 07:00〜20:00）を `stepMinutes`（30）刻み。終わり（開始＋所要）が `dayEnd` を超える時刻は出さない
  - 担当できる人：その日に稼働時間帯がある（欠勤を差し引く）、種類の必要条件（`query.typeId` の種類）と `query.requirements`（スタッフの特性に対して）をすべて満たす、件数の上限（必須の負担の均等）を超えない
  - 正確（`query.place` あり）：仮の〈利用者さん〉（`INQUIRY_CLIENT_ID`、場所＝`query.place`、必要条件＝`query.requirements`）と仮の訪問（`INQUIRY_VISIT_ID`、種類＝`query.typeId`、所要＝`query.durationMinutes`、時間の決め方は幅で `dayStart`〜`dayEnd`）を足したデータで日ごとに1回 compile し、開始時刻ごとに仮の訪問の earliest・latest をその時刻にした問題で、reassign の `fitsOf` が返す人を数える（担当できる人の判定も compile の可否に入る）
  - 目安（`query.place` が null）：元の案の各列を lenient で時刻にし、[開始 − `marginMinutes`, 開始＋所要＋`marginMinutes`)（初期値 前後15分＝移動の見込み）が、その人の稼働時間帯に収まり、どの訪問の [開始, 終了) とも重ならない人を数える
  - 曜日×開始時刻のマス：その曜日の対象の日ごとの人（`byDate`）、`min`（数えた日のうち最も少ない人数＝どの週でも受けられる人数）、`weeksOk`（1人以上いた日の数）・`weeksTotal`（数えた日の数）。判定（`verdictOf`）は `weeksTotal` が0なら `'unknown'`、`weeksOk === weeksTotal` なら `'ok'`（○）、`weeksOk > 0` なら `'partial'`（△）、それ以外 `'ng'`（×）
  - 試算の要約（`inquirySummary`）：希望の曜日（無ければ全曜日）・時間帯の中で ○ の開始時刻を曜日ごとに連続した範囲にまとめ（「火 10:00〜11:30」）、○ の時刻のある曜日が週の回数以上あれば「火・木の 10:00〜11:30 なら、〈開始日〉から週2回で対応できます」、足りなければ ○ の曜日と △ の曜日（入らない日付）を並べ、どちらも無ければ「ご希望の曜日・時間帯では、いまは空きがありません」。呼び方は `org.terms`
  - 日の空きの割合（`dayFreeness`）：その日の元の案で、稼働中の人ごとの稼働時間帯のうち、訪問の [開始 − 移動, 終了) に使っていない分の合計 ÷ 稼働時間帯の合計 を、午前（12:00 まで）・午後で返す（0〜1。稼働時間帯が無ければ null）。案が無い日は null
- 持つデータ（持ち主）：なし
- 提供するAPI：§5「空き状況と問い合わせの試算」の `vacancyOf`・`verdictOf`・`inquirySummary`・`dayFreeness`
- 依存するもの：contracts、matching（`compile`・`scheduleRoute`・`matches`）、reassign（`fitsOf`）、domain（日付・時刻・`withoutAbsences` は compile 経由）
- 配置：`src/vacancy/`
- 完了の条件：
  - [ ] 空いている人がいる時刻で正確の判定が ○、全員の予定が詰まっている時刻・稼働時間外は ×、ある週だけ詰まっていれば △ と入らない日付（テスト：小さな問題）
  - [ ] 正確の判定で入るとされた人に、reassign の `placeVisit` で仮の訪問を入れると、他の人の担当・順番・開始時刻が変わらず strict で回れる（性質テスト：seed の日）
  - [ ] 種類の必要条件・`query.requirements` を満たさない人は数えない。欠勤の時間は空きにならない（テスト）
  - [ ] 案の無い日は数えず `noPlanDates` に出る（テスト）
  - [ ] 要約の文：○ の連続した範囲のまとめ・週の回数が足りるとき／足りないとき／空きが無いとき（テスト）
  - [ ] 8人・約17件／日・4週・07:00〜20:00 で、正確の試算が 2秒以内、目安の表が 500ms 以内（中位のノートPC）
  - [ ] 同じ入力で同じ結果。今の案・データを書き換えない（テスト）

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
| vacancy | 関数 | `vacancyOf / verdictOf / inquirySummary / dayFreeness` | 空き状況の表・問い合わせの試算・日の空きの割合（ADR-0012 追記。段階3） |
| reassign | 関数 | `fitsOf` | 他の人の担当・順番・開始時刻を変えずに入れられる人（空き状況。ADR-0012 追記） |
| reassign | 関数 | `prepareAnneal / finishAnneal / settleAnneal / annealCost / stayPointsOf / contactsOf` | 2回目：案B の問題と初期解・結果のまとめ・保険（案A のままにするか）・案B の目的の値・減点・連絡の一覧（ADR-0011 追記） |

詳細な定義：`docs/api/` を参照。

### 空き状況と問い合わせの試算（`src/contracts/vacancy.ts`・`src/contracts/documents.ts`。ADR-0012 追記。段階3）

```ts
// documents.ts：〈利用者さん〉に足す
//   tentative: z.boolean().default(false)   // 仮押さえ（D47）。古いデータは false

// vacancy.ts
const INQUIRY_CLIENT_ID = '__inquiry_client'   // 試算の仮の〈利用者さん〉（データには入れない）
const INQUIRY_VISIT_ID = '__inquiry_visit'     // 試算の仮の訪問
type VacancyQuery = {
  typeId: string | null
  durationMinutes: number              // 5〜720
  requirements: Condition[]            // 〈スタッフ〉の特性に対する条件（例：性別）
  place: Place | null                  // null＝目安（移動を前後 marginMinutes で見込む）
  marginMinutes: number                // 既定 15
  dayStart: string                     // 既定 '07:00'
  dayEnd: string                       // 既定 '20:00'
  stepMinutes: number                  // 既定 30
}
type VacancyRange = { from: string; weeks: number } // from から weeks×7日（weeks 1〜8）
type VacancyCell = {
  weekday: number                      // 0=日〜6=土
  start: number                        // 0時からの分
  byDate: { date: string; staffIds: string[] }[] // 数えた日ごと（日付の順）
  min: number                          // byDate の人数の最小（byDate が空なら 0）
  weeksOk: number                      // 人数が1以上の日の数
  weeksTotal: number                   // 数えた日の数
}
type VacancyResult = {
  exact: boolean                       // place あり
  dates: string[]                      // 対象の日
  noPlanDates: string[]                // 案が無く数えなかった日
  times: number[]                      // 開始時刻の列（分）
  cells: VacancyCell[]                 // 曜日（日〜土）× times の順
}
type Verdict = 'ok' | 'partial' | 'ng' | 'unknown'
type InquiryWish = { weekdays: number[]; from: string; to: string; perWeek: number; startDate: string } // from〜to は開始時刻の範囲
type DayFreeness = { am: number | null; pm: number | null } // 0〜1

function vacancyOf(data: DemoData, query: VacancyQuery, range: VacancyRange): VacancyResult
function verdictOf(cell: VacancyCell): Verdict
function inquirySummary(result: VacancyResult, wish: InquiryWish, terms: Terms): string
function dayFreeness(data: DemoData, date: string): DayFreeness
// reassign：function fitsOf(problem: Problem, routes: Routes, visitId: string): { staffId: string; addedCost: number; addedTravel: number }[]
// 実装（src/vacancy/）は型 VacancyOf・VerdictOf・InquirySummary・DayFreenessFn で注釈する
```

- 例外を投げない：いない種類は種類なし、時刻の範囲が空なら `times` が空。データ・今の案は書き換えない
- 正確の判定で使う問題は、仮の〈利用者さん〉・訪問を足したデータで compile したもの（欠勤・稼働時間の上書き・条件はいまのデータのまま。点数の物差しには関係しない）

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
