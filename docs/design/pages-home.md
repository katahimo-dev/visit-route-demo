# ホーム（今日やること）と予定に共通の進み具合の帯

> この画面のファイル：`src/pages/HomePage.tsx`（`home.css`）・`src/components/progressBand.tsx`（`progressBand.css`）・`src/lib/home.ts`・`src/lib/progressBand.ts`・`src/lib/useDayStatuses.ts`。関連 ADR：0025（追記を含む）・0038・0044。関連 PRD：D141〜D145・D247・D255・D263（ホーム）・D151〜D155（進み具合の帯）・D161（条件が変わった）。
> 版2（ADR-0053）：日の状態は まだ伝えていない／確定済み／未連絡の変更あり、要対応は訪問ごとの検査。「案を作る」は「担当を AI で組む」

### ホーム（`#/home`。PRD D141〜D145）

起動（`#/`）・知らない URL の行き先。`?id=` などのクエリはそのまま。データは書き換えない。印刷では出さない。

#### `lib/home.ts`（純粋関数。テストあり）

- `HOME_NEXT_MONTH_FROM_DAY`（15。PRD D255。事業所の設定にはしない）
- `homeMonths(today)`：今月。今日が15日以降なら来月も
- `homeDays(today)`：今日から見る月の末日まで
- `homeEntries(today, terms, features)`（いつでもの入口）
- `homeTasks({ today, statuses, months, todayStaff, data })`：カード `HomeTask`＝種類・色（`warn`／`todo`／`info`）・題名・内訳・移る先 `to`・日の予定へ移るときの日付 `date`。`ready` は info だけのとき。切った機能のカードは出さない

並びは作業の順（PRD D263。ADR-0044）：要対応（全部の月）→ 月ごとに「担当を AI で組む → 確定していない日」（今月 → 来月）→ 今日。

| 並び | カード | 移る先 |
|---|---|---|
| 1 | 要対応（月ごと。`attentionList`＝要対応の訪問のある日・未連絡の変更のある日・拘束超。月の要対応・帯と同じ数。内訳「要対応の訪問がある日 N日・未連絡の変更がある日 N日」） | 1日だけなら `/plan`＋その日、2日以上なら `/month?ym=…&do=attention` |
| 2 | N月の担当を AI で組む（月ごと。担当なしの訪問がある・伝えていない日が2日以上。内訳「担当なしの訪問がある日 N日」） | `/month?ym=…&do=batch` |
| 3 | 確定していない日（2 と同じ月のすぐ後。訪問があって確定済みでない日。`monthProgress` の `unconfirmed` と同じ日・同じ並び。内訳「まだ伝えていない N日・未連絡の変更あり N日。見直して伝えたら「確定」」） | 1日だけなら `/plan`＋その日、2日以上なら `/month?ym=…&do=unconfirmed` |
| 4 | 今日の予定（題名に「（まだ伝えていない）」「（確定済み）」「（未連絡の変更あり）」、内訳「訪問 N件・担当 N人・要対応 N件」。要対応があれば warn） | `/plan`（今日） |

#### `pages/HomePage.tsx`（`home.css`）

- 日の状態：`lib/useDayModel` の `useCompileInput(data)`（compile が読むデータだけ。今日の問題は compile しない。`useDayModel` も中で使う）と `useDayStatuses`
- `homeTasks` のカードを並べる。カード全体が `Link`（`date` があれば押したときに `setDate`）
- 先頭の1枚（知らせだけ（`info`）でなければ）は「まずこれ」（PRD D263）：`li.is-lead` で格子の幅いっぱい（`grid-column: 1 / -1`）、カードは `.is-lead`（主ボタンの塗り `--primary`・白い文字・下の影。ホームの主ボタンはこの1つ）、題名の上に札「まずこれ」（`home-lead`。読み上げも題名の前）、`data-lead`。先頭が要対応（`is-warn`）なら左の縁を要対応の赤で太くし、札「要対応」（`home-lead-warn`）も添える。ほかのカードは今のまま
- 何も無ければ「今日の準備はできています」（`ready`）
- 「今日の訪問」（`home-visits`。PRD D304）：`lib/visitOps` の `dayVisitRows(data, 今日, 今の時刻, 5)`（取り消し・休みを除き、担当なし → これからの近い順）の行 `home-visit`（時刻・〈利用者さん〉・担当（印）か「担当なし（入らない）」「案なし」。担当なし・案なしは左の縁を赤）。押すと訪問の詳細の欄（閉じるとフォーカスは行）。残りは「あと N件（日の予定で見る）」（`home-visits-rest`）。下に「これからの入らない訪問（要対応）」（`home-unassigned`。`unassignedVisits(data, 明日, 31日後)` の5件、残りは件数だけ）。主ボタンは増やさない。印刷で出さない
- 下に「いつでも」の入口：欠勤・キャンセルを登録（`/plan?date=今日&do=absence`）・空き状況・〈利用者さん〉一覧・〈スタッフ〉一覧・「訪問を追加」（`home-visit-add`。ボタンで訪問の詳細の欄の新規（今日）。600px 以下と〈利用者さん〉が0人なら出さない）
- 狭い画面（860px 以下。`lib/useMedia` の `NARROW_QUERY`。App のメニューの切り替えと同じ定数）では欠勤・キャンセルの入口を見出しのすぐ下（「次にすること」の上。`home-quick`）に常に置き、「いつでも」から外す（同じ `home-absence`）。見た目はほかの入口と同じカード（`is-entry`。赤い縁は付けない）で、先頭に置くことで目立たせ、アイコンだけ朱（`.is-first`）。切っていれば出さない（PRD D247・ADR-0038）
- カードは `auto-fill` の格子（390px で1列）

#### 月の予定の `?do=`

ホームのカードの行き先の `?do=` は月の予定が1回だけ行い、URL から消す（replace。戻るで繰り返さない）。中身は [pages-month.md](pages-month.md) の「`?do=`」。

#### 確かめ

`scripts/e2e-home.cjs`：起動・知らない URL・`?id=`、カードの並び（作業の順）・先頭の「まずこれ」・同じ月の「担当なしの訪問がある日 N日」は組むカードだけ・今日のカード・「N月の担当を AI で組む」で月の欄・確定していない日の数・まとめて確定・次の確定していない日へ・訪問の無い人の欠勤は要対応にしない・いつでもの入口・何も無いデータ・スマホ・印刷（AGENTS.md の e2e の説明）

### 日の状態の共通フック（`lib/useDayStatuses.ts`）

- 月の予定の「日の問題と状態」を切り出したフック。月の予定・ホーム・進み具合の帯・週の準備・要対応で共通（数え方が食い違わない）
- 点数の基準の条件で compile・採点し、訪問ごとの検査（`visitIssues`）・伝えた状態（`toldStateOf`）・拘束が上限を超える人を `dayStatus` に渡す
- 日ごとの覚えはモジュールの `MEMO`（日付ごとに最近3件・400日まで。点数の基準の条件は JSON で比べる）で、画面を移っても使う

### 予定に共通の進み具合の帯（PRD D151〜D155）

月・週・日の見出しの下に置く。同じ月なら同じ数（ホームの確定していない日とも同じ）。印刷では出さない。

#### `lib/progressBand.ts`（純粋関数。テストあり）

- `bandNext({ progress, emptyTargets, urgent })`：次の一手 `BandNext`＝種類 `batch|attention|unconfirmed|done|empty`・文・短い文。順は
  1. 担当なしの訪問がある日が2日以上 → 担当を AI で組む
  2. 手当てが要る要対応（要対応の訪問） → 要対応を見る
  3. 確定していない日 → 確定していない日を見る
  4. 見るだけの要対応（未連絡の変更・拘束超） → 要対応を見る
  5. 無ければ済み。今日以降に訪問が無ければ empty
- `urgentCount(attention)`：要対応の訪問のある日（`care`）
- `bandMonth(date)`：選んでいる日付の月（週は週の中の選んでいる日の月）
- `bandHref(ym, op)`：`/month?ym=…&do=…`
- `visitsText`：「N件」

#### `components/progressBand.tsx`（`progressBand.css`）

- `ProgressBand({ ym, model, day?, primary?, hideBatch?, onOp? })`：見た目だけ（`hideBatch` は次の一手が「担当を AI で組む」のときボタンを出さない）
  - `model` は `BandModel`＝`monthProgress`・担当なしの訪問がある日の数・手当てが要る要対応の件数。null の間は同じ高さで「数えています…」
  - 数字は4つの `Link`：訪問・担当 → `do=batch`、確定 → `do=unconfirmed`、要対応 → `do=attention`。`onOp` があれば移らずにそれを呼ぶ（修飾キー（Ctrl・⌘・Shift・Alt）と左以外のボタンでは横取りしない。Ctrl+クリックは新しいタブ）
  - 右に次の一手（`Link` のボタン。`primary` なら主ボタン。済み・訪問なしは文だけ。訪問の無い月はボタンなし）
  - 日の予定は「この日」（`dayStatus` の状態。まだ伝えていない → 確定で確定済み・未連絡の変更あり）
  - 下の縁に `prepParts` の細い積み上げ（`.prep-bar`・`.prep-part` の色）
  - 600px 以下は1行（訪問・この日・「日」「件」を省き、ボタンは短い文）
  - 読み上げ：数字のリンクに aria-label（「担当が全部入った日 x/y日（済）。担当を AI で組むを開く」など）、✓ に sr-only の「済」、手当てが要る要対応に「要手当て」
- `BandLive`：aria-live。最初は空で置き、数え直して文が変わったときだけ中身を入れる
- `ScheduleBand({ date, withDay? })`：週・日の帯。`useDeferredValue(data, null)` で描画の後に数える
  - `useCompileInput`・`useDayStatuses`（その月の今日以降の日と、日の予定で選んでいる日）・`monthProgress`（statusOf）・`attentionList`・担当なしの訪問がある日の数
  - 数字とボタンは月の予定の欄へ移る（`?do=` は月の予定が消す）
  - 速く出す（e2e の上限 `PERF_MS_PROGRESS` 既定 3000ms）

#### 置く所

| 画面 | 置き方 |
|---|---|
| 月（`pages/MonthPage`） | 見出しの下に `ProgressBand`（自分で数えた `progress`・`preview`・`attention` から作る）。次の一手は主ボタン、`onOp` で欄を画面の中で開く（URL は変えない）。「担当を AI で組む」の入口は帯の1か所。詳しくは [pages-month.md](pages-month.md) |
| 週（`pages/WeekPage`） | `ScheduleBand date={anchor} hideBatch`。週は選んでいる日付の月。週の範囲の作る・確定は見出しの主ボタンで、それが「作る」の間は帯の「担当を AI で組む」を出さない（`hideBatch`。[pages-week.md](pages-week.md)。PRD D280） |
| 日（`pages/PlanPage`） | `ScheduleBand date={date} withDay`。「確定（伝えた）」は日の予定の見出し（帯は状態を見せるだけ） |

#### 確かめ

`scripts/e2e-progress.cjs`：月の帯・見出しに組むボタンが無い・入口が1つ・主ボタン・帯から欄（URL は変えない）・右の欄と同じ日数／来月は繰り返しから数え未作成は無い／担当を AI で組むは画面を移っても続く／日の「この日」と確定 +1／月・週・日とホームが同じ数／390px・印刷／週・日の帯が速く出る（AGENTS.md の e2e の説明）
