# ホーム（今日やること）と予定に共通の進み具合の帯

> この画面のファイル：`src/pages/HomePage.tsx`（`home.css`）・`src/components/progressBand.tsx`（`progressBand.css`）・`src/lib/home.ts`・`src/lib/progressBand.ts`・`src/lib/useDayStatuses.ts`。関連 ADR：0025（追記を含む）・0038。関連 PRD：D141〜D145・D247（ホーム）・D151〜D155（進み具合の帯）・D161（条件が変わった）。

### ホーム（`#/home`。PRD D141〜D145）

起動（`#/`）・知らない URL の行き先。`?id=` などのクエリはそのまま。データは書き換えない。印刷では出さない。

#### `lib/home.ts`（純粋関数。テストあり）

- `HOME_NEXT_MONTH_DAYS`（7）
- `homeMonths(today)`：今月。今月の残り（今日を含む）が7日以下なら来月も
- `homeDays(today)`：今日から見る月の末日まで
- `homeEntries(today, terms, features)`（いつでもの入口）
- `homeTasks({ today, statuses, months, todayStaff, data })`：カード `HomeTask`＝種類・色（`warn`／`todo`／`info`）・題名・内訳・移る先 `to`・日の予定へ移るときの日付 `date`。`ready` は info だけのとき。切った機能のカードは出さない

| 並び | カード | 移る先 |
|---|---|---|
| 1 | 要対応（月ごと。`attentionList`） | 1日だけなら `/plan`＋その日、2日以上なら `/month?ym=…&do=attention` |
| 2 | 今日の予定 | `/plan`（今日） |
| 3 | 確定していない日（月ごと。訪問があって確定済みでない日。案の無い日も含み、`monthProgress` の `unconfirmed` と同じ日・同じ並び） | 1日だけなら `/plan`＋その日、2日以上なら `/month?ym=…&do=unconfirmed` |
| 4 | 案を作る（月ごと。`expandMonth` の added か案の無い日） | `/month?ym=…&do=batch` |

#### `pages/HomePage.tsx`（`home.css`）

- 日の状態：`lib/useDayModel` の `useCompileInput(data)`（compile が読むデータだけ。今日の問題は compile しない。`useDayModel` も中で使う）と `useDayStatuses`
- `homeTasks` のカードを並べる。カード全体が `Link`（`date` があれば押したときに `setDate`）
- 何も無ければ「今日の準備はできています」（`ready`）
- 下に「いつでも」の入口：欠勤・キャンセルを登録（`/plan?date=今日&do=absence`）・空き状況・〈利用者さん〉一覧・〈スタッフ〉一覧
- 狭い画面（860px 以下。`lib/useMedia` の `NARROW_QUERY`。App のメニューの切り替えと同じ定数）では欠勤・キャンセルの入口を見出しのすぐ下（「次にすること」の上。`home-quick`）に常に置き、「いつでも」から外す（同じ `home-absence`）。見た目はほかの入口と同じカード（`is-entry`。赤い縁は付けない）で、先頭に置くことで目立たせ、アイコンだけ朱（`.is-first`）。切っていれば出さない（PRD D247・ADR-0038）
- カードは `auto-fill` の格子（390px で1列）

#### 月の予定の `?do=`

ホームのカードの行き先の `?do=` は月の予定が1回だけ行い、URL から消す（replace。戻るで繰り返さない）。中身は [pages-month.md](pages-month.md) の「`?do=`」。

#### 確かめ

`scripts/e2e-home.cjs`：起動・知らない URL・`?id=`、カードの並び、今日のカード → 日の予定（今日）、まとめて作る → 欄が開き `?do=` が消える・戻るで繰り返さない、案ができたら「未確定」・確定したら「確定済み」（案なしから始める所は先に初期データの案を消す）、初期データの案（PRD D225）で初めから今日が「未確定」・確定していない日＝月の未確定の日数、月の「問題の無い日をまとめて確定」で確定していない日が N日減る（PRD D223）、月の予定の `?do=attention|unconfirmed`、いつでもの入口、何も無いデータで「準備はできています」、メニューの先頭、390px で縦1列（先頭は欠勤・キャンセルの入口）・下のタブ5つ、印刷。③の日数は帯の確定していない日数で確かめる。

### 日の状態の共通フック（`lib/useDayStatuses.ts`）

- 月の予定の「日の問題と状態」を切り出したフック。月の予定・ホーム・進み具合の帯・作り直しの帯・要対応で共通（数え方が食い違わない）
- 点数の基準の条件で compile・採点し、必須の違反・条件が変わった・欠勤の人に残る・拘束が上限を超えるを `dayStatus` に渡す
- `view.stale` に `rulesStale` を足す（`withRules`。覚えの外で決める）。「条件が変わった」はこの1か所で決まる
- 日ごとの覚えはモジュールの `MEMO`（日付ごとに最近3件・400日まで。点数の基準の条件は JSON で比べる）で、画面を移っても使う

### 予定に共通の進み具合の帯（PRD D151〜D155）

月・週・日の見出しの下に置く。同じ月なら同じ数（ホームの確定していない日とも同じ）。印刷では出さない。

#### `lib/progressBand.ts`（純粋関数。テストあり）

- `bandNext({ progress, canExpand, emptyTargets, urgent })`：次の一手 `BandNext`＝種類 `batch|attention|unconfirmed|done|empty`・文・短い文。順は
  1. 作っていない訪問か案の無い日 → まとめて作る
  2. 手当てが要る要対応 → 要対応を見る
  3. 確定していない日 → 確定していない日を見る
  4. 見るだけの要対応 → 要対応を見る
  5. 無ければ済み。今日以降に訪問も作れる訪問も無ければ empty
- `urgentCount(attention)`：入らない・欠勤の人に残る・条件が変わった
- `bandMonth(date)`：選んでいる日付の月（週は週の中の選んでいる日の月）
- `bandHref(ym, op)`：`/month?ym=…&do=…`
- `visitsText`

#### `components/progressBand.tsx`（`progressBand.css`）

- `ProgressBand({ ym, model, day?, primary?, onOp? })`：見た目だけ
  - `model` は `BandModel`＝`monthProgress`・作れる訪問の件数・まだ案の無い日だけの対象の日数・手当てが要る要対応の件数。null の間は同じ高さで「数えています…」
  - 数字は4つの `Link`：訪問・案 → `do=batch`、確定 → `do=unconfirmed`、要対応 → `do=attention`。`onOp` があれば移らずにそれを呼ぶ（修飾キー（Ctrl・⌘・Shift・Alt）と左以外のボタンでは横取りしない。Ctrl+クリックは新しいタブ）
  - 右に次の一手（`Link` のボタン。`primary` なら主ボタン。済み・訪問なしは文だけ。訪問の無い月はボタンなし）
  - 日の予定は「この日」（`dayStatus` の状態。未確定 → 確定で確定済み）
  - 下の縁に `prepParts` の細い積み上げ（`.prep-bar`・`.prep-part` の色）
  - 600px 以下は1行（訪問・この日・「日」「件」を省き、ボタンは短い文）
  - 読み上げ：数字のリンクに aria-label（「案を作った日 x/y日（済）。まとめて作るを開く」など）、✓ に sr-only の「済」、手当てが要る要対応に「要手当て」
- `BandLive`：aria-live。最初は空で置き、数え直して文が変わったときだけ中身を入れる（作り直しの帯も使う）
- `ScheduleBand({ date, withDay? })`：週・日の帯。`useDeferredValue(data, null)` で描画の後に数える
  - `useCompileInput`・`useDayStatuses`（その月の今日以降の日と、日の予定で選んでいる日）・`monthProgress`（statusOf）・`attentionList`・`lib/month` の `expandMonthVisits`（定期パターン・訪問・〈利用者さん〉と月・今日で覚え、案の手直し・確定では展開し直さない）・`batchTargets(…, 'empty')`
  - 数字とボタンは月の予定の欄へ移る（`?do=` は月の予定が消す）
  - 案が全部ある月でも速く出す（e2e の上限 `PERF_MS_PROGRESS` 既定 3000ms）

#### 置く所

| 画面 | 置き方 |
|---|---|
| 月（`pages/MonthPage`） | 見出しの下に `ProgressBand`（自分で数えた `progress`・`preview`・`attention` から作る）。次の一手は主ボタン、`onOp` で欄を画面の中で開く（URL は変えない）。「まとめて作る」の入口は帯の1か所。詳しくは [pages-month.md](pages-month.md) |
| 週（`pages/WeekPage`） | `ScheduleBand date={anchor}`。週は選んでいる日付の月 |
| 日（`pages/PlanPage`） | `ScheduleBand date={date} withDay`。「この割当で確定」は日の予定の見出し（帯は状態を見せるだけ） |

#### 確かめ

`scripts/e2e-progress.cjs`：月の帯・見出しにまとめて作るのボタンが無い・入口が1つ・主ボタン・帯から欄（URL は変えない）・右の欄と同じ日数／来月：あと N件・欄の「訪問だけ作る」／日：この日 未確定 → 確定で確定済み・確定 +1・確定の操作が待たされない／月・週・日とホームで同じ数／週・日の帯の数字から月の予定の欄（`?do=` が消える）／週は選んでいる日付の月／390px で1行・はみ出さない・印刷で出さない／案が全部ある月でも `PERF_MS_PROGRESS` 以内／済んだ「案 ✓」から開いても既定は「まだ案の無い日だけ」／数字のリンクの aria-label・空で置く読み上げの領域／Ctrl+クリックは新しいタブ／訪問の無い月はボタンなし／月末（`FAKE_NOW=2026-10-28`・`2026-10-31`）でも通る。
