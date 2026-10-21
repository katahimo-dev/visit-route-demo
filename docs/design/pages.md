# pages（画面）：共通事項と索引

> この画面のファイル：`src/app/App.tsx`・`src/app/NavDrawer.tsx`・`src/components/`・`src/lib/`（画面横断の部品）。関連 ADR：0009・0019・0022〜0028・0033。関連 PRD：D59・D102・D122〜D126・D132〜D135・D146〜D150・D161〜D166（帯）・D173〜D183・D189〜D197・D201〜D204・D210〜D216・D220〜D222。
> 画面ごとの詳細は下の「画面別ファイルの索引」から。画面共通の部品（右の欄・名前から開く詳細・用語・ツアー・作り直しの帯・リンク・メール）は [pages-common.md](pages-common.md)。

### 責務・持つデータ・依存

- 責務：PoC本体の管理者画面（予定・AI案の比較・稼働時間帯・〈スタッフ〉・訪問先）を Firebase なしで動かす。加えて ホーム・月・週・空き状況・勤務の見込み・項目・条件（重みのスライダー 0〜5・必須の切り替え。ClassClassify の Setup にならう）・訪問の種類・相性の表・データ・管理者設定・〈スタッフ〉の今日の順番を見る画面（D16。表示だけ）
- 最初に開く画面：`#/home`（ホーム。見出しの下に「今日やること」。`#/`・知らない URL もここへ。ADR-0025）
- 持つデータ（持ち主）：画面の一時状態のみ。`DemoData` を書き換えるのは store だけで、画面は `update(fn)` を通す
- 提供するAPI：なし（ルートは下の表）
- 依存するもの：store・matching・solver（Worker）・evaluate・reassign・patterns・vacancy・features、Leaflet（PoC本体 `RouteMap.tsx` を写す）
- 配置：`src/pages/`、`src/components/`、画面用の純粋関数は `src/lib/`（テストあり）

### ルート一覧

ルーティングは HashRouter。`AdminShell`（メニュー・上の帯・下のタブ）の中に置くルートと、外に置くルートがある。

| ルート | ページのファイル | 役割 | 詳細 |
|---|---|---|---|
| `#/home` | `pages/HomePage.tsx` | ホーム（見出しの下に「今日やること」）。起動・知らない URL の行き先 | [pages-home.md](pages-home.md) |
| `#/plan` | `pages/PlanPage.tsx` | 日の予定（予定と AI案・手直し・確定）。`?date=`・`?do=absence|unassigned|recreate`・`&staff=` | [pages-plan.md](pages-plan.md)・[pages-plan-absence.md](pages-plan-absence.md) |
| `#/schedule` | （`Navigate`） | 古いリンク。`#/plan` へ移す | — |
| `#/month` | `pages/MonthPage.tsx` | 月の予定（カレンダー／日ごとの一覧・まとめて作る・希望休）。`?ym=`・`?staff=`・`?client=`・`?layout=`・`?do=` | [pages-month.md](pages-month.md) |
| `#/month/print` | `pages/MonthPrintPage.tsx` | 月の予定の印刷（A4横）。`AdminShell` の外（`Guarded`） | [pages-month.md](pages-month.md) |
| `#/week` | `pages/WeekPage.tsx` | 週の予定（時間軸・〈スタッフ〉×曜日・〈利用者さん〉×曜日・ドラッグ）。`?d=`・`?view=`・`?by=`・`?staff=`・`?client=`・`?cf=` | [pages-week.md](pages-week.md) |
| `#/compare` | `pages/ComparePage.tsx` | 案を比べる（AI案の記録どうし） | [pages-rules.md](pages-rules.md) |
| `#/vacancy` | `pages/VacancyPage.tsx` | 空き状況と問い合わせの試算・仮押さえ・案内文 | [pages-vacancy.md](pages-vacancy.md) |
| `#/clients` | `pages/ClientsPage.tsx` | 〈利用者さん〉一覧・閲覧・編集。`?id=` | [pages-clients.md](pages-clients.md) |
| `#/compat` | `pages/CompatPage.tsx` | 相性の表（訪問先×〈スタッフ〉）。`?sf=`・`?cf=` | [pages-compat.md](pages-compat.md) |
| `#/staff` | `pages/StaffPage.tsx` | 〈スタッフ〉一覧・閲覧・編集・最終勤務日。`?id=` | [pages-staff.md](pages-staff.md) |
| `#/availability` | `pages/AvailabilityPage.tsx` | 勤務時間（シフト）（〈スタッフ〉×日の稼働時間帯） | [pages-staff.md](pages-staff.md) |
| `#/workload` | `pages/WorkloadPage.tsx` | 勤務の見込み（拘束・移動・待ち・交通費）。`?ym=`・`?staff=` | [pages-staff.md](pages-staff.md) |
| `#/staff-view/:staffId` | `pages/StaffViewPage.tsx` | 〈スタッフ〉のスマホ画面（今日の順番。見本）。`AdminShell` の外（`Guarded`） | [pages-staff.md](pages-staff.md) |
| `#/rules` | `pages/RulesPage.tsx` | 条件の重みとプリセット・点数の基準 | [pages-rules.md](pages-rules.md) |
| `#/types` | `pages/TypesPage.tsx` | 訪問の種類 | [pages-rules.md](pages-rules.md) |
| `#/items` | `pages/ItemsPage.tsx` | 特性の項目 | [pages-rules.md](pages-rules.md) |
| `#/data` | `pages/DataPage.tsx` | データ（控え・Excel・初期状態に戻す・案内をもう一度見る） | [pages-data.md](pages-data.md) |
| `#/settings` | `pages/SettingsPage.tsx` | 管理者設定（機能の入り切り。だれでも開ける） | [pages-data.md](pages-data.md) |
| `*`（`#/` を含む） | （`Navigate`） | `/home` へ（replace） | — |

ルートの URL は変えない（古いリンクを壊さない）。

### 画面別ファイルの索引

| ファイル | 中身 |
|---|---|
| [pages-common.md](pages-common.md) | 画面共通の部品：右の欄 `SidePanel` と確定のボタンの帯・浮いている部品とトースト・名前から開く詳細（`PersonPopover`）・用語の説明（`Term`）・空の画面（`EmptyNext`）・初回の案内ツアー・作り直しの帯（`RebuildBand`）・行き先のリンク（`lib/links`）・メールと道順のリンク・画面横断の e2e |
| [pages-home.md](pages-home.md) | ホーム（今日やること）・予定に共通の進み具合の帯（`ProgressBand`・`ScheduleBand`）・`useDayStatuses` |
| [pages-plan.md](pages-plan.md) | 日の予定：並び・1行のまとめ・「案を変える ▾」・右の欄（詳しく・条件を調整する・プリセットのカード）・自動作成・時間軸／順番／一覧・担当ごとの1日・地図・入らなかった訪問・訪問の欄・取り消し・条件が変わった・点数の理由・日の予定のメール・道順のリンク |
| [pages-plan-absence.md](pages-plan-absence.md) | 日の予定の「欠勤・キャンセル」の欄（4段階）・振り直し（案A・案B）・差の欄・左下の帯・連絡の一覧・比較の画面の「欠勤前」 |
| [pages-month.md](pages-month.md) | 月：カレンダーと日ごとの一覧・日のマスと読み方の吹き出し・凡例・表示の選択・まとめて作る・希望休・要対応・月の印刷 |
| [pages-week.md](pages-week.md) | 週：表示の切り替え・時間軸・ドラッグ・〈スタッフ〉×曜日・〈利用者さん〉×曜日・時間軸の〈利用者さん〉の初期値・週の予定のメール |
| [pages-bars.md](pages-bars.md) | 時間帯のバー（3段・30分）と一目で分かる表示：`barRows`・`staffBar`・`loadBar`・`barMarks.css`・`glance`・`dayLine`・`workBars`・`clientBar` |
| [pages-vacancy.md](pages-vacancy.md) | 空き状況：4つの段階・表・試算・仮押さえ・案内文・紹介元へのメール |
| [pages-clients.md](pages-clients.md) | 〈利用者さん〉：一覧と絞り込み（`ClientFilter`・`area`）・閲覧と編集（`viewMode` 共通）・定期パターン・休み・決まりごと・担当できる人・段階と仮押さえ・住所の入力（`AddressField`）・まとめて地図に置く・`ClientPicker`・訪問の欄 |
| [pages-staff.md](pages-staff.md) | 〈スタッフ〉：一覧・閲覧と編集・最終勤務日と担当の振り直し・自宅・勤務時間（シフト）・勤務の見込み・スマホ画面（見本） |
| [pages-compat.md](pages-compat.md) | 相性の画面：表・絞り込み（`StaffFilter`・相性のチップ）・吹き出し |
| [pages-rules.md](pages-rules.md) | 条件の重みとプリセット・点数の基準・特性と条件の入力・訪問の種類・特性の項目・比較の画面 |
| [pages-data.md](pages-data.md) | データの画面（控え・Excel・名簿・最終勤務日の知らせ・ファイル選択）・管理者設定 |

### 画面に共通の決まり

- 主ボタン（塗り）は1画面1つ、濃い朱1色（下の「色・フォーカス・動き・タッチ」）。ボタンは塗り＝主／枠＝副／文字＝ついでの3段（[pages-common.md](pages-common.md) の「画面の見出しとボタンの3段」。PRD D238。ADR-0036）。メール・リンク・地図のボタンは主ボタンにしない
- 呼び方は `org.terms` から引き、「お客様」「シッター」を直書きしない。表記は常用漢字
- データを書くのは `update(fn)` だけ（1つの操作は1回の `update` にまとめる）
- 外部送信は地図タイルと、ボタンを押したときの郵便番号・住所の検索（`lib/geocode.ts` の1か所）だけ。Google マップのリンク・mailto は人が押すので外部送信に当たらない
- 印刷では、メニュー・下のタブ・引き出し・トースト・浮いている帯・確認ダイアログ・ツアー・用語の説明・名前の i・作り直しの帯・進み具合の帯を出さない
- 用語の説明（`Term`）の目印は用語の後ろの小さな ⓘ（下線は付けない）。同じ画面の同じ語は最初の1か所だけ説明を付ける（PRD D240・D241。ADR-0037。詳細は [pages-common.md](pages-common.md)）
- 確認はブラウザの `confirm`・`alert`・`prompt` を使わず、独自の確認ダイアログ（下）。src の画面に `confirm(`・`alert(`・`prompt(` は0。例外は `beforeunload`（〈スタッフ〉・〈利用者さん〉の変更があるとき）だけ
- 画面の見出しは `PageHeader`（左に題名と `lead`＝「この画面でやること」の1行、右に主ボタン1つ。予定の3画面は題名の下に［月｜週｜日］のタブ。PRD D236）、節は `SectionTitle`（`SectionLevelProvider` で h2／h3）
- 狭い画面の境目：860px 以下でスマホのメニュー（左のメニューを隠す・下のタブ）。600px 以下で帯・欄のボタンを詰める

### 狭い画面の表（PRD D220〜D222。ADR-0033。`styles.css` の末尾）

- 境目は今までの 600px（`lib/useMedia` の `COMPACT_QUERY`＝`lib/monthList` の `MONTH_LIST_QUERY`＝CSS の `@media (max-width: 600px)`）。新しい境目は作らない。広い画面の見た目は変えない
- **一覧の表をカードに**（D220）：`table.narrow-cards` を付けた表は、600px 以下で行（`tr`）を1枚のカードにする。表の印（`table`・`tr`・`td`・data-testid）は変えず CSS で組み替える。`thead` は読み上げにだけ残す（見えない形）。列は隠さない
  - role：`table` を block、`tbody`・`tr` を flex にすると WebKit は表の role を落とすので、`table`・`thead`／`tbody`・`tr`・`td`・`th` に `table`・`rowgroup`・`row`・`cell`・`columnheader` を明示する（`lib/narrowRoles` の `narrowRole` を展開。`role="cell"` と直に書くとリントの noRedundantRoles に止められる）
  - `td::before` の見出し（data-label）は読み上げでも読まれ、見出しの行（`thead`）の列の名前と二重になる。見出しの行は表として読むために残し、`::before` の二重は許す（CSS の生成内容は aria-hidden にできない。見た目の見出しを消すと目で読めなくなる）
  - `td.narrow-title`：1行目の名前（残りの幅・太字）。`td.narrow-head`：1行目の右に置く大事な値（必須・状態・A／B）。どちらも見出しを出さない
  - ほかの `td[data-label]`：左に見出し（`::before { content: attr(data-label) }`。6rem）・右に値。`td.narrow-block` は見出しを上に置く（選択肢の一覧など広い中身）
  - `td.narrow-act`：操作（開く・消す）を右下
  - 付けた表：条件の重み（`narrow-rules`）・プリセットの重み・特性の項目・〈スタッフ〉一覧（`narrow-staff`）・〈利用者さん〉一覧（`narrow-clients`）・比較の記録（`narrow-runs`）。中身は各画面のファイル
  - `.narrow-stack`：ボタンの行を縦に幅いっぱいで並べ、文字を折り返さない
- **格子の表の端**（D221）：`components/EdgeScroll`（`className` 既定 `table-scroll`・`scrollRef`）が巻く箱を外の枠 `.scroll-edge` で包み、右に続きがあるあいだ枠に `has-more-right` を付ける（`lib/useScrollEdge`。巻く・幅・中身の大きさが変わるたびに測る。判定は `lib/scrollEdge` の `moreRight`（純粋関数。端の余り 2px））。600px 以下では枠の `::after` で右の端を 28px ぼかし、`has-more-right` が外れると消す（印刷では出さない）。使う所：相性・稼働時間・勤務の見込み・空き状況・週の2つの表
  - 1列目と見出しの行を止める：相性（今まで）・勤務時間（シフト）と勤務の見込み（600px 以下で箱の高さを画面の中に収め、見出しの行と名前の列を止める）・空き状況（曜日の列だけ。行は7つ）・週の表（名前の列）・週の時間軸（時刻の列）
  - はじめの巻き位置は `scrollLeftToShow(box, targetLeft, stickyRight)`（純粋関数。ある列を止めた列のすぐ右に見せる。巻ける範囲に収める）：空き状況の 9:00 の列（[pages-vacancy.md](pages-vacancy.md)）・週の今日の列（[pages-week.md](pages-week.md)）

### 色・フォーカス・動き・タッチ（`styles.css` の `:root`）

色は役割で引く。背景のベージュ（`--bg`）と白いカード、暖かい色合いは変えない。比は WCAG のコントラスト比（文字は 4.5 以上、枠・アイコン・フォーカスの輪は 3 以上）。

| 変数 | 色 | 使う所 | 比 |
|---|---|---|---|
| `--primary` | `#b8503e`（濃い朱） | 主ボタンの地（白い文字）・選んだ印の枠・今の画面の印 | 白い文字 4.9 |
| `--primary-dark` | `#9c4232` | 主ボタンの影・選んだ印の文字（淡い朱の地 `--primary-soft` の上） | 白で 6.5・淡い朱で 5.5 |
| `--primary-hover` | `#a64838` | 主ボタンを重ねたときの地（`.btn-primary:hover`） | 白い文字 5.8 |
| `--accent` | `#e8735f`（明るい朱） | 飾りの帯・線だけ（確認ダイアログとツアーの上の帯、ホームの「やること」と振り直しの帯の左の線）。文字・枠の印には使わない | — |
| `--focus` | `--primary-dark` | フォーカスの輪 | 白で 6.5・`--bg` で 5.8 |
| `--ink` | `#3b2f2a` | 本文 | 白で 12.9 |
| `--sub` | `#6f6058` | 補足の文字・表の見出し・メニューの見出し・パレットの種類の見出し・比較の A の札 | 白で 6.0・`--bg` で 5.4 |
| `--line` | `#eadfd6` | カードの区切り・飾りの線・ボタンの枠 | — |
| `--line-strong` | `#968478` | 入力欄・選ぶ欄の枠（`input`・`select`・`textarea`） | 白で 3.6・`--bg` で 3.2 |

状態の色は 緑＝済み・よい／黄＝注意／赤＝要対応・戻せない操作 の3つ。〈スタッフ〉の色（`lib/common` の `STAFF_COLORS`）とは別に扱う。

| 変数 | 色 | 使う所 | 比 |
|---|---|---|---|
| `--ok` | `#5aa57a` | 枠・帯・塗り（文字を載せない） | — |
| `--ok-ink` | `#37734f` | 緑の文字とアイコン（`.chip-ok`・`.ok-text`・進み具合の帯の済み・ホームの準備ができた文など）・白い文字の札（担当できる） | 白で 5.6・淡い緑 `#e1f1e7` で 4.8 |
| `--warn` | `#d99a2b` | 枠・帯・塗り（文字を載せない） | — |
| `--warn-ink` | `#8a5a00` | 黄の文字とアイコン（`.chip-warn`・`.warn-text`・押せない理由・注意の箱のアイコンなど） | 白で 5.9・淡い黄 `#fbefd6` で 5.2 |
| `--warn-line` | `#b07a12` | 注意の点線（月のマス・一覧の行の案なし `is-caution`・週の案なしの帯 `is-noplan`・凡例の見本。PRD D228） | 地 `#fffaf0` で 3.6・白で 3.7 |
| `--danger` | `#b8393a` | 赤の文字・枠（`.btn-danger`・`.error`）、消す・捨てる確認の確定の塗り | 白で 5.7・`--bg` で 5.1 |

- 主ボタン（`.btn-primary`）は塗り、副（`.btn`）は枠、ついで（`.btn btn-text`）は文字だけ、戻せない操作（`.btn-danger`）は白地に赤い枠と文字で、形でも分ける
- フォーカスの輪は `outline: 3px solid var(--focus)`（`:focus-visible`。リストの候補の `is-active` も）。枠の中に描く所（`.segmented` は `overflow: hidden` で外側が切れる・帯の中のボタン）は `outline-offset: -3px`
- 書体は Mac の丸ゴシック・ヒラギノの次に Windows の BIZ UDPゴシック・游ゴシック（Regular は細いので Medium を先）・メイリオ、その後ろに Noto Sans JP・`system-ui`。本文の行の高さは 1.5
- 高さの決まった1行の帯・バー（進み具合の帯 `.progress-band`。390px で1行・高さ 50px 以内）は `line-height: 1.25` を帯に固定し、中のボタンにも継がせる（`button` は親の行の高さを継がないので `.btn { line-height: inherit }`）。本文の 1.5 や、書体が無い環境の既定の行の高さで帯が太らない。a と button のボタンの高さもそろう
- 動きを減らす設定（`prefers-reduced-motion: reduce`）では、出てくる動き・点滅・なめらかな巻き取りをやめる（CSS は動きと移り変わりを一瞬で終える。`animationend` を待つ所があるので消さない）。`scrollIntoView` の `behavior` は `lib/motion` の `scrollBehavior()`（設定があれば `auto`、ほかは `smooth`。テストあり）
- 浮かせた地図（`.map-dock`）は専用の `map-dock-in`（薄い所から少し下から出る）。トーストの `toast-in` は横の中央寄せを含むので使わない
- タッチの端末（`pointer: coarse`）では、押せる所を見た目と並びを変えずに `::before` で広げる：アイコンだけのボタン（`.icon-btn` 32px・`.icon-btn-sm` 26px・項目の選択肢のチップの中の 24px）は 44px、名前の i（`.person-info`）と〈利用者さん〉の選択の ×（`.client-picker-remove`）は 32px。隣に押せる要素が並ぶ側は間の半分だけ（アイコンのボタンは 2px、i は 1px）広げ、隣の押せる所に掛けない。担当ごとの1日の行の i は上下の行に掛けず右へ（32×24px）、チップの中の i は名前に掛からないよう縦に（25×29px）。選択肢のチップの「名前を変える」と「消す」は、タッチの端末でだけ間を 16px 広げて 44×44px ずつにする（消すの押し間違いを防ぐ）。390px で広げた所がほかの押せる要素に掛からない（上の帯・下のタブなど前に重なる部品は除く）
- 860px 以下では入力欄の文字を 16px 以上にする（iPhone で押したときに画面が拡大されない）。クラスで小さくしている欄（`ClientPicker`・`ClientFilter` の〈スタッフ〉の選択）はそれぞれの CSS で 16px

### メニューとナビゲーション（ADR-0024・ADR-0027。PRD D132〜D135・D178〜D183・D239）

- 広い画面の左のメニュー（`.side-nav`）は詰める：項目（`.nav-link`）は `min-height: 34px`（上下 5px・行の高さ 1.4）、グループの間 10px、メニューの上下 14px・16px。1440×900 で最後の項目（データ）まで巻かずに見える（下端 約868px）。タッチできる端末（`any-pointer: coarse`。主の入力がマウスでもタッチ・ペンがあれば当たる）では `.nav-link` を `min-height: 44px`、［月｜週｜日］のタブ（見た目 36px）は `::before` で上下 4px 広げて 44px（PRD D237・D239）
- 高さ 860px 以下の広い画面（1366×768 など）ではさらに詰める：項目 30px（上下 3px・行の高さ 1.3・0.92rem）・グループの間 4px・見出しの下の余白 0・ロゴ 32px。1366×768 で最後の項目（データ）まで見える。それでも入らないときは、`.side-nav` の背景（下の端の影 `scroll` と、中身の終わりで影を隠す `local` の重ね）で下に続きがあると示す（PRD D270）
- 上の帯の日付の選択（`DateSwitcher`）は `lib/nav` の `showsDateSwitch(pathname)` の画面（`DATE_PAGES`：日・週・月の予定・案を比べる・勤務の見込み・勤務時間（シフト））だけに出す。選んでいる日付は覚えたままで、外枠 `.app-shell` の `data-date` で読める（PRD D267）

#### `lib/nav.ts`（純粋関数。テストあり）

- `menuSections(terms, today, features)`：メニューの並びの1か所（PRD D178・D230〜D232。ADR-0034）。項目は `MenuItem`＝`{ to, label, short?, icon }`（アイコンは名前 `NavIcon`。`short` は下のタブの短い名前）。項目名は画面の見出しと同じ。切った機能の項目は出さず、項目の無くなったグループは見出しごと出さない（当日・問い合わせは欠勤・キャンセルと空き状況の両方、AI の条件は条件の重みと相性の両方を切ったとき。設定は消えない）

| グループの見出し | 項目（`to`。下のタブは `short`） |
|---|---|
| （なし） | ホーム（`/home`。short「ホーム」） |
| 予定（`SCHEDULE_GROUP`） | 月の予定（`/month`。short「月」）・週の予定（`/week`。short「週」）・日の予定（`/plan`。short「今日」）・案を比べる（`/compare`） |
| 当日・問い合わせ | 欠勤・キャンセルを登録（`absenceHref(today)`＝`/plan?date=今日&do=absence`）・空き状況（`/vacancy`。short「空き状況」） |
| 人 | `${terms.client}一覧`（`/clients`）・`${terms.staff}一覧`（`/staff`）・勤務時間（シフト）（`/availability`）・勤務の見込み（`/workload`） |
| AI の条件 | 条件の重み（`/rules`）・相性（`/compat`） |
| 設定 | 訪問の種類（`/types`）・特性の項目（`/items`）・管理者設定（`/settings`）・データ（`/data`） |

- `isNavAction(to)`：クエリを持つ＝操作の項目（欠勤・キャンセル）
- `activeNavPath(pathname)`：`#/schedule` は `/plan`。比較は `/compare` のまま
- `isActiveNav(to, pathname)`：操作の項目はいつも false（日の予定で欠勤・キャンセルに印を付けない）
- `activeTabPath`・`isActiveTab`：下のタブ用。比較は `/plan`（「今日」のタブ）
- `tabLabel(item)`：下のタブの名前（`short`、無ければ `label`）。`tabHref(to, today)`：「今日」は `todayPlanHref(today)`＝`/plan?date=今日`、ほかは `to`。`tabClick(to, pathname)`：今の画面のタブは `stay`（何もしない）、ただし「今日」は `replace`（日の予定でも今日を選び直す・履歴を増やさない）、ほかは `go`
- `navTitle(groups, pathname)`：グループの見出し＋「・」＋項目名（例「人・利用者さん一覧」）。見出しの無いグループと予定のグループは項目名だけ（「日の予定」。「予定・日の予定」と重ねない）。メニューに無い画面は null
- `navTitleParts`：見出しと項目名を分けたもの（上の帯は `.m-screen-group`・`.m-screen-item` の inline-block。入りきらなければ項目名を次の行へ）
- `bottomTabs(groups)`：`BOTTOM_TABS`＝`['/home', '/month', '/week', '/plan', '/vacancy']` の順にメニューから引く（メニューに無い URL は出さない。名前は `tabLabel`＝ホーム・月・週・今日・空き状況）
- 左のメニュー・引き出し・下のタブ・上の帯の名前は、どれもこの決まりで今の画面を見る
- 画面の見出し（`PageHeader` の h1）はメニューの項目名と同じ（PRD D179・D230）：ホーム（見出しの下の文は「今日やること：…」）・月の予定・週の予定・日の予定・勤務時間（シフト）・勤務の見込み（`fare` の入り切りで変えない）ほか。本文・行き先の文の画面名もこれにそろえる（人の稼働時間・Excel のシート名・［月｜週｜日］は変えない）

#### `AdminShell`（`src/app/App.tsx`）

- `groups = menuSections(terms, today, features)`、アイコンは `NAV_ICONS`
- `NavGroups`：左のメニューと引き出しで共通。全部 `Link`（`aria-current` は `isActiveNav` で自分で付ける。data-testid `nav-link`）。中の nav の名前は「画面の一覧」、グループの見出しは h2（見た目は小さいまま）。メニューの先頭は見出しなしの「ホーム」（lucide の `ListTodo`）
- 上の帯 `.app-header`：狭い画面だけ ロゴと今の画面の名前（`.m-head-title`・data-testid `screen-name`。メニューに無い画面は事業所の名前）と「メニュー」ボタン（`.m-menu-btn`・`aria-haspopup="dialog"`・`aria-expanded`・`aria-controls` は開いているときだけ）。広い画面では `display: none`
- 上の帯に「探す・移動」（`cmdk-open`。`aria-haspopup="dialog"`・`aria-expanded`・`aria-keyshortcuts`。狭い画面は「探す」だけでキーの印を隠し、上の帯の1段目に置く）
- 帯の高さ：狭い画面では2段に折り返すことがあるので `ResizeObserver` で測って `--header-h` に出す（広い画面では消して styles.css の 72px のまま）
- 本文の後ろに下のタブ（`nav.bottom-tabs`・`aria-label="よく使う画面"`・今の画面は `aria-current="page"`（`isActiveTab`））
- 画面を移ったら引き出しとコマンドパレットを閉じる（パレットは開いたときの URL の hash の画面のパスを覚え、移った先の画面で開き直していれば閉じない。`keepPaletteOn`）。`matchMedia('(max-width: 860px)')` が外れたら（広い画面へ戻ったら）引き出しを閉じ、フォーカスは左のメニューの今の項目へ
- window の keydown で `isPaletteShortcut` なら `preventDefault` し、`[aria-modal="true"]` が無ければコマンドパレットを開く（右の欄・確認・ツアーの上では開かない）
- main の `Guarded` は `Suspense`（`fallback` は `PageLoading`：`.empty.page-loading`・`output`・data-testid `page-loading`・「画面を読み込んでいます…」）の中。`Outlet` の後ろに `PreloadWhenShown`（画面が出て手が空いたら分けたチャンクを先に読む。PRD D248・ADR-0039。`src/app/lazyPages.tsx`）
- main の `Guarded` の中、`Outlet` の前に、`showsRebuildBand(pathname)` のときだけ `RebuildBand`（[pages-common.md](pages-common.md) の「作り直しの帯」）
- 今の画面の項目（引き出し）は閉じるだけ（`to === pathname` で `preventDefault`）、今の画面の下のタブは何もしない（`tabClick` が `stay`）。URL のクエリ＝画面の状態を消さない。「今日」のタブは `tabHref` の `/plan?date=今日` へ移り、日の予定の上では `replace`（日の予定が `?date=` を読んで消す）。比較のときの「今日」は別の画面なので移る

#### 引き出し（`src/app/NavDrawer.tsx`）

- 左から出す。body の直下（`createPortal`）、`role="dialog"`・`aria-modal`・名前「メニュー」。開いているあいだ `#root` を `inert`
- 開いたら今の画面の項目（`aria-current`）へフォーカス。Esc・外（背景）・× で閉じる。項目を押すと閉じる
- Tab は中で回す（`components/ui.tsx` の `FOCUSABLE`。`SidePanel` と同じやり方）。閉じたら `returnFocus`（「メニュー」ボタン）へ
- 裏のスクロールは `components/useBodyScrollLock`（`lib/scrollLock` の `createScrollLock`。数を数え、html と body の overflow を最後の解除で戻す。テストあり）。`SidePanel` と共通。右の欄と重なっても最後の1つが閉じるまで戻さない
- z-index 1100（`SidePanel` と同じ。地図・下のタブより前、トーストより後ろ）

#### スマホの CSS（`styles.css`）

- `--bottom-tabs-h`：広い画面 0px、860px 以下で `58px + env(safe-area-inset-bottom)`、印刷で 0px
- 860px 以下：左のメニューは `display: none`、上の帯は折り返し可・日付の切り替えは右寄せ、本文の下の余白に `--bottom-tabs-h` を足す、下のタブは `position: fixed`・高さ `--bottom-tabs-h`・5列（下の余白は safe-area）
- 浮いている部品は `--bottom-tabs-h` の上に出す：
  - 地図（`.map-dock`）の bottom に足す。地図のボタン `.map-dock-fab` は `right: max(12px, env(safe-area-inset-right))`・`bottom: calc(12px + var(--bottom-tabs-h))`。`body:has(.map-dock-fab) .app-main` は下の余白をボタンの分（56px）足す
  - 欠勤の振り直しの帯（`plan.css` の `.reassign-dock`）は `max(12px + タブ, --map-dock-top + 8px)`
  - トーストは `max(96px, タブ + 12px, 帯・地図の上)`
- `index.html` の viewport に `viewport-fit=cover`。860px 以下の上の帯・本文・下のタブ・引き出し・地図、〈スタッフ〉のスマホ画面（`.staff-shell`）の上と左右を safe-area で避ける
- 印刷：下のタブ・引き出しは出さない。`print and (max-width: 860px)` では上の帯も出さない

#### 予定の切り替え（`components/ViewSwitch.tsx`）

- 月・週・日の見出しの題名の下に［月｜週｜日］のタブ（リンクのナビ。今の画面を `aria-current`。PRD D237。[pages-common.md](pages-common.md) の「画面の見出しとボタンの3段」）。押すと選んでいる日付（`useDay`）で移る：月は `?ym=` にその日の月、週は `?d=` にその日、日はその日
- 月・週で日付を変えたら（マス・帯・日の見出しを押す、週・月を送る）選んでいる日付も合わせる（月を送ったときはその月の1日、ただし今月なら今日）
- 各画面の `lead`：月「定期パターンから訪問を作り、一月分の案をまとめて作ります」、週「日時をドラッグでずらし、〈スタッフ〉の偏りを見ます」、日「その日の欠勤・手直しをして、割当を確定します」

### コマンドパレット（ADR-0027。PRD D180〜D183）

#### `lib/commandPalette.ts`（純粋関数。テストあり）

- `PaletteItem`：`id`・`kind`（`action|screen|client|staff`）・`label`・`hint`・`to`・`date?`・`keys`（`lib/search` の `normalizeKana` でそろえた名前・よみ・別名）。`paletteItem` で作る
- `paletteActions(today)`：欠勤・キャンセルを登録・今日の予定を見る・今月／来月の案をまとめて作る（`?do=batch`）・要対応（`attention`）・確定していない日（`unconfirmed`）・条件が変わった日を作り直す（`stale`）・問い合わせに答える。`{ customRules }` なら「今日の案を試す重みで作り直す」（`recreateTodayHref`）も。切った機能の操作は出さない
- `paletteScreens(sections, terms)`：操作でない項目。補足はグループの見出し。読み・言い換え `SCREEN_WORDS`、〈利用者さん〉一覧・〈スタッフ〉一覧には呼び方のよみ `TERM_READINGS`（既定の呼び方の漢字だけ）
- `palettePeople(clients, staff, terms)`：`/clients?id=`・`/staff?id=`。段階・休止中を補足に
- `filterPalette(items, query, limit=8)`：語に分けて AND、種類の順・先頭一致を前に、人は種類ごと limit まで（`rest`）。空なら操作と画面だけ
- `paletteTerms`・`moveActive`（端で回る）・`isPaletteShortcut(e, isMac)`（mac は ⌘K、ほかは Ctrl+K。Shift・Alt・変換中は違う）・`isMacPlatform`・`paletteKindLabel`・`hashPathname(hash)`・`keepPaletteOn(openFor, pathname)`

#### `components/CommandPalette.tsx`（`commandPalette.css`）

- body の直下の `role="dialog"`・`aria-modal`（名前「探す・移動」）。開いたら body のほかの子を `inertLock`、`useBodyScrollLock`、入力欄へフォーカス
- window の捕捉の段で Esc・Ctrl+K（閉じる）・Tab（`trapTarget` で中で回す）を受け、右の欄・引き出しへ渡さない。入力欄の中の Ctrl+K も閉じる（文字はそのまま、閉じたら入力欄へ）
- 閉じたら開く前の要素へフォーカス（つながっていなければ上の帯の `cmdk-open`）。吹き出しの中から開いて閉じても body に落とさない
- 入力欄は `role="combobox"`（`aria-expanded`・`aria-controls`・`aria-autocomplete="list"`・`aria-activedescendant`）、候補は `role="listbox"` の中の `role="group"`（種類の見出し）と `role="option"`（`aria-selected`。押してもフォーカスは入力欄）。↑↓・Enter。件数は打ってから `aria-live`
- 選んでいる候補は見える位置へ（先頭なら scrollTop=0、種類の先頭なら見出しごと）
- `customRules` は `presetOf(data.rules, data.presets) === null`
- 候補の語は `useMemo`（開いたとき・データが変わったとき）でそろえ、打つたびは `filterPalette` だけ（300人×60人で1文字 100ms 以内）
- 選ぶと閉じて、`date` があれば `setDate`、今の画面なら移らない、ほかは `navigate(to)`
- z-index 1150（引き出し 1100 とトースト 1200 の間）。印刷で出さない。860px 以下は上に寄せ、下の案内（↑↓ Enter Esc）を隠す

### 確認ダイアログ（ADR-0026。PRD D146〜D150）

#### `lib/confirmDialog.ts`（純粋関数。テストあり）

- `ConfirmOptions`：`title`（問い）・`body`（何が起きるか。`\n` は改行）・`confirmLabel`（動詞）・`cancelLabel`（既定 `CANCEL_LABEL`「取り消す」）・`tone`（`danger`＝赤の塗り／`primary`＝濃い朱の塗り。既定 primary。消す・捨てるは danger）
- `toRequest(id, options)`（既定を埋め前後の空白を落とす）・`enqueue`／`settle`（待っている確認の並び。出すのは先頭の1つ。無い ID の settle は同じ並びを返す）
- `trapTarget(count, index, shift)`：Tab で端から出るときだけ反対の端、ほかは null、何も無ければ -1（コマンドパレット・ツアーも使う）

#### `components/ConfirmDialog.tsx`（`confirmDialog.css`）

- `ConfirmDialog`：body の直下。`role="alertdialog"`・`aria-modal`・`aria-labelledby`（見出し）・`aria-describedby`（本文があるとき）。画面の中央
- 開いたら取り消しへフォーカス、閉じたら開く前の要素へ（消えていれば戻さない）
- body のほかの子を inert（`lib/inertLock` の要素ごとに数えるロック。`components/useBodyScrollLock` の `inertLock` を引き出し・パレット・ツアーと共通に使い、閉じる順が逆でも最後の1つが閉じるまで戻さない。テストあり）、`useBodyScrollLock`
- キーは window の捕捉の段で受け、Esc は取り消し・Tab は `trapTarget` で回し、どちらも右の欄・引き出しへ渡さない（右の欄の上の Esc は確認だけを閉じる）
- 背景を押すは取り消し（開いてから300ms のあいだと `e.detail > 1` は無視。ダブルクリックの2回目で閉じない）
- z-index 1300。480px 以下はボタンを縦に幅いっぱい（確定が上）。印刷では出さない
- `ConfirmProvider`：`main.tsx` でトーストの内側（Router の内側）に1つ。並びと答え（Promise の resolve）を持ち、外れるとき・画面（`useLocation().pathname`）が変わったときは残りを取り消しで答えて並びを空にする
- `useConfirm()`：`const ok = await confirmDialog({...})`。Provider の外では例外
- `app/ErrorBoundary`：分けた画面のチャンクを読めない例外（`isChunkLoadError`）は別の表示（data-testid `chunk-error`。「画面を読み込めませんでした」・［再読み込み］（主ボタン。`reloadPage`）・［もう一度表示する］（`retryFailedChunks`）。初期状態に戻すボタンは出さない。PRD D248・ADR-0039）。ほかは、状態 `asking` で `ConfirmDialog` を直に出す（Provider・ルーターに頼らない。main.tsx の外側の ErrorBoundary でも出る）。ボタンは［控え（バックアップ）を書き出す］（主ボタン。store の `backup()` のファイルを `lib/download` の `saveBlob` で書き出す。いまのデータは `backupFileName(date)`＝データの画面と同じ名前、壊れて退避したデータは `-broken.json` の別のファイル。結果は `backupNote` の文を `output` で知らせる（保存に失敗していたら「画面で使っていた最新の状態」か「最後に保存できた状態」かと理由を区別する。トーストは Provider の外で出せない。テストあり））・［もう一度表示する］・［データを初期状態に戻す］（`.btn-danger`。確認の本文で先に控えを書き出せることを添える）

#### 呼ぶ側の決まり

- 確認を出す関数は async。確認の後に計算中なら何もしない（日の予定の `runRef`：`recreate`・`runPreset`・`registerAndReassign`・`chooseOption`・`revert`・`adopt`・`revertToBase`・`placeCandidate`、月の `start` は `runningRef`）
- 日の予定の `create` は同期のまま（自動作成・順に作るが戻り値を使う）。手で押す作る・作り直す・プリセットは `recreate`／`runPreset`（async）が確認してから呼ぶ
- 名簿の読み込みは確認の後にデータが変わっていないかを見直す
- e2e で確認に答えるときは `scripts/lib/confirmDialog.cjs` の `answerConfirms(page)`（出た確認の見出しと本文を記録し `answer` のボタンを押す。ネイティブのダイアログは記録して失敗に、beforeunload だけ受ける）

### 機能の入り切り（画面側。ADR-0028。PRD D210〜D216）

機能の表・ひな形・判定（`lib/features.ts` の `FEATURES`・`isOn`・`featureOfLocation`・`featureOfHref`・`TEMPLATES`・`applyTemplate`・`matchTemplate`・`templateDiff`・`turnOffImpact`・`calcFeaturesOf`）は design.md の「features」。画面での出し分け：

- `lib/useFeature.ts` の `useFeature(id): boolean`（`org.features` を読むだけ）、`components/Feature.tsx` の `Feature`（id を渡す。切なら何も出さない）
- URL の直書きをやめ機能の表から引く：`menuSections`（下のタブ・上の帯の名前・パレットの画面もここから）、`app/App.tsx` のルート（切った機能の URL（`?do=` も）は `#/home` へ移し（replace。`state.featureOff`）、知らせ（トースト）と `#/settings` へのリンク。管理者設定と土台の画面は開ける）、`lib/commandPalette.ts` の操作、`lib/home.ts` のカード、`lib/tour.ts` の枚、`lib/links.ts`、画面の中の欄・ボタン（`Feature`）
- `rules` が切なら、日の予定でこの日だけ試す重みで作る所（AI に作らせる・固定を残して作り直す）は `lib/presets` の `planRulesOf(data, false)`（いまの条件に点数の基準のプリセットの重みを当てたもの。月まとめ作成と同じ）で作る。「案を変える ▾」のプリセットは点数の基準の1枚だけ（王冠・まとめて作るなし）、「条件を調整する」は出さない
- 切っても事実の表示（月の「休みの人に N」・すでに振り直した案の差の欄・帯・連絡の一覧）は残し、隠すのは入力・操作の入口だけ
- 切ったまま保存しても、データ（段階・担当できる人・メールアドレス・毎月のパターンの `repeat` と `monthWeeks`）は残す（毎月のパターンは読むだけと注記）。`clientStage` が切なら段階は「利用中／終了」の2つで選ばせる
- 管理者設定の画面は [pages-data.md](pages-data.md)

### 主な共通部品

#### `components/`

| ファイル | 主なもの | 詳細 |
|---|---|---|
| `ui.tsx` | `PageHeader`・`SectionTitle`・`SectionLevelProvider`・`Hint`・`Stat`・`IconButton`・`WithIcon`・`Empty`・`FOCUSABLE`・`SidePanel` | [pages-common.md](pages-common.md) |
| `usePanelFoot.ts`・`useBodyScrollLock.ts`・`floating.ts` | 欄の帯・ロック・浮かせた部品の位置 | [pages-common.md](pages-common.md)（ロックはこのファイル） |
| `ConfirmDialog.tsx`・`CommandPalette.tsx`・`Tour.tsx`・`Term.tsx`・`Toast.tsx` | 画面横断の重なる部品 | 確認ダイアログ・パレットはこのファイル、ほかは [pages-common.md](pages-common.md) |
| `DetailPopover.tsx`・`PersonPopover.tsx`・`personDetail.tsx` | 名前から開く詳細 | [pages-common.md](pages-common.md) |
| `personView.tsx` | 閲覧の欄 `StaffView`・`ClientView` | [pages-clients.md](pages-clients.md) |
| `ViewSwitch.tsx` | ［月｜週｜日］ | このファイル |
| `EdgeScroll.tsx` | 横に巻く格子の表の箱（右に続きがある印 `has-more-right`） | このファイル（狭い画面の表） |
| `progressBand.tsx` | `ProgressBand`・`ScheduleBand`・`BandLive` | [pages-home.md](pages-home.md) |
| `rebuildBand.tsx` | `RebuildBand` | [pages-common.md](pages-common.md) |
| `EmptyNext.tsx` | 空の画面の次の一手 | [pages-common.md](pages-common.md) |
| `Feature.tsx` | 機能の入り切り | このファイル |
| `MenuButton.tsx` | キーボードで操作できる `menu`（「案を変える ▾」） | [pages-plan.md](pages-plan.md) |
| `MapDock.tsx`・`RouteMap.tsx`（読み込み中の枠。本体は別のチャンクの `LeafletMap.tsx`。PRD D248）・`routeView.tsx`・`routeTimeline.tsx` | 地図・担当ごとの順番・時間軸 | [pages-plan.md](pages-plan.md) |
| `dayLines.tsx`・`loadBar.tsx`・`staffBar.tsx`・`clientBar.tsx`・`workBars.tsx`・`glance.tsx`・`barMarks.css` | 時間帯のバー | [pages-bars.md](pages-bars.md) |
| `PickChips.tsx` | 人のチップ（`bulk`・`detailKind`・`fold`・`actions`）・`QualificationBadges` | [pages-week.md](pages-week.md) |
| `ClientPicker.tsx`・`ClientFilter.tsx` | 〈利用者さん〉の検索・絞り込み | [pages-clients.md](pages-clients.md) |
| `StaffFilter.tsx` | 〈スタッフ〉の列の絞り込み | [pages-compat.md](pages-compat.md) |
| `placeLookup.tsx` | `AddressField`・`ClientPlaceEditor`・`PlacePin` | [pages-clients.md](pages-clients.md) |
| `conditions.tsx` | 特性と条件の入力 | [pages-rules.md](pages-rules.md) |
| `visitType.tsx` | 種類の色の印と名前 | [pages-plan.md](pages-plan.md) |
| `VisitRules.tsx` | 訪問先の決まりごとの表示 | [pages-clients.md](pages-clients.md) |
| `mailParts.tsx`・`mapsLinks.tsx` | メール・道順のリンク | [pages-common.md](pages-common.md) |
| `FilePick.tsx` | ファイル選択 | [pages-data.md](pages-data.md) |
| `parts.tsx` | `ClientName` など | — |

#### `lib/`（画面用の純粋関数。テストあり）

| ファイル | 役割 | 詳細 |
|---|---|---|
| `nav.ts`・`commandPalette.ts`・`confirmDialog.ts`・`inertLock.ts`・`scrollLock.ts`・`panelFit.ts`・`personPopover.ts`・`glossary.ts`・`emptyGuide.ts`・`tour.ts`・`rebuildBand.ts`・`links.ts`・`features.ts`・`useFeature.ts`・`mailto.ts`・`mail.ts`・`mapsLink.ts`・`clipboard.ts` | 画面横断 | このファイル（nav・パレット・確認・ロック・features）・[pages-common.md](pages-common.md)（ほか） |
| `useDayModel.ts`・`useDayStatuses.ts`・`home.ts`・`progressBand.ts` | 日のモデル・日の状態・ホーム・帯 | [pages-home.md](pages-home.md)・[pages-plan.md](pages-plan.md) |
| `absences.ts`・`sudden.ts`・`contacts.ts`・`runs.ts`・`planMenu.ts`・`scoreReason.ts`・`routeView.ts`・`timeline.ts`・`visitEdit.ts`・`copyDay.ts`・`dragStart.ts` | 日の予定 | [pages-plan.md](pages-plan.md)・[pages-plan-absence.md](pages-plan-absence.md) |
| `month.ts`・`monthList.ts`・`monthGuide.ts`・`monthPrint.ts`・`requestedOff.ts` | 月 | [pages-month.md](pages-month.md) |
| `week.ts`・`weekView.ts`・`timelineClients.ts`・`fold.ts` | 週 | [pages-week.md](pages-week.md) |
| `barRows.ts`・`staffBar.ts`・`glance.ts`・`dayLine.ts` | 時間帯のバー | [pages-bars.md](pages-bars.md) |
| `vacancyView.ts` | 空き状況 | [pages-vacancy.md](pages-vacancy.md) |
| `clientFilter.ts`・`area.ts`・`search.ts`・`leaves.ts`・`patternText.ts`・`tentative.ts`・`clientStage.ts`・`addressLookup.ts`・`geocode.ts`・`postalCode.ts`・`placeAll.ts`・`viewMode.ts`・`personLinks.ts` | 〈利用者さん〉・閲覧の欄・住所 | [pages-clients.md](pages-clients.md) |
| `offboard.ts`・`workload.ts` | 〈スタッフ〉 | [pages-staff.md](pages-staff.md) |
| `compatView.ts` | 相性 | [pages-compat.md](pages-compat.md) |
| `presets.ts` | プリセット | [pages-rules.md](pages-rules.md) |
| `filePick.ts` | ファイル選択 | [pages-data.md](pages-data.md) |
| `useMedia.ts`・`scrollEdge.ts`・`useScrollEdge.ts` | 狭い画面の判定（`COMPACT_QUERY`）・横に巻く表の端と巻き位置 | このファイル（狭い画面の表） |
| `isDate.ts`・`common.ts`・`colors.ts`・`motion.ts`・`download.ts` | 小さな共通（動きを減らす設定・ファイルの保存） | — |

### 完了の条件（共通）

- [ ] 呼び方は `org.terms` から引き、「お客様」「シッター」を直書きしない。主ボタンは濃い朱1色・1画面1〜2個
- [ ] 色は役割の変数から引き、文字は 4.5・枠とフォーカスの輪は 3 以上の比。フォーカスの輪は `--focus` の 3px。動きを減らす設定で動きが止まり、タッチの端末でアイコンのボタンの押せる所が 44px（`lib/motion` のテスト）
- [ ] （ADR-0024）390×844 で左のメニューが出ず、上の帯に今の画面の名前（〈利用者さん〉一覧と〈スタッフ〉一覧を見分けられる）・「メニュー」・日付の切り替えが出て横に巻かない。「メニュー」で左から見出し付きの引き出しが開き、画面を選ぶ・外を押す・Esc で閉じてフォーカスが「メニュー」に戻る。開いているあいだ裏は巻かず、Tab は中で回る。下の5つのタブで移れ、今の画面（比較は「今日」）が `aria-current`。地図・欠勤の振り直しの帯・トーストがタブに重ならない。印刷に出ない。1400px の見た目（左のメニュー・上の帯 72px）は変わらない（`lib/nav` のテスト・`scripts/e2e-mobile.cjs`）
- [ ] （ADR-0026）画面のどの確認もブラウザの確認でなく、画面の中央にアプリの見た目のダイアログで出る（見出しの問い・本文・動詞のボタン、消す・捨てるは赤）。最初のフォーカスは取り消し、Tab は中で回り、Esc・背景・取り消すでは何も変わらず、確定で進み、閉じたら押したボタンへ戻る。右の欄の上の Esc は確認だけを閉じる。390px で収まり、印刷では出ない（`scripts/e2e-dialog.cjs`）
- [ ] （ADR-0027）メニューが ホーム／予定／当日・問い合わせ／人／AI の条件／設定 の順で（ADR-0034）、画面の見出しがメニューの名前と同じで、「〈利用者さん〉一覧」「〈スタッフ〉一覧」と見分けられ、比較は「案を比べる」。Ctrl+K（上の帯の「探す・移動」）で開き、打って↑↓・Enter で画面・操作・人の閲覧の欄へ移り、Esc でフォーカスが戻る（`scripts/e2e-nav.cjs`）
- [ ] （ADR-0022 追記）月・週・日の名前から詳細の吹き出しが開き、Esc・外を押す・もう一度押す・Tab で閉じてボタンへ戻る。同時に1つ、見出しが消えたら閉じる。リンクで各画面の閲覧の欄が開く。印刷では i を出さない（`lib/personPopover` のテスト・`scripts/e2e-details.cjs`・`scripts/e2e-details2.cjs`）
- [ ] （PRD D220〜D222）390×844 で条件の重み・特性の項目・〈スタッフ〉一覧・〈利用者さん〉一覧・比較が横に巻かず、行がカードになる。条件の重みのスライダーと必須が画面の中。〈利用者さん〉一覧の絞り込みが「絞り込み（N）」に畳まれる。比較の主ボタンがタブに隠れない。週は今日の列が見え、空き状況の表は 9:00 から（`lib/scrollEdge`・`lib/weekView`・`lib/clientFilter` のテスト・`scripts/e2e-mobile.cjs`）
- [ ] 右の欄の確定のボタンの帯：短い欄は帯が内容のすぐ下・区切りなし、長い欄は欄の下に貼り付き、内容が隠れている間だけ区切り。390px の並び・タブに隠れない・キーボード（`lib/panelFit` のテスト・`scripts/e2e-panel-foot.cjs`）
- [ ] 用語の説明・空の画面・ツアー（`lib/glossary`・`lib/emptyGuide`・`lib/tour`・`src/store/tour.test.ts` のテスト・`scripts/e2e-words.cjs`・`scripts/e2e-tour.cjs`）
- [ ] 作り直しの帯（`lib/rebuildBand` のテスト・`scripts/e2e-rebuild.cjs`）・行き先のリンク（`lib/links` のテスト・`scripts/e2e-links.cjs`）・機能の入り切り（`scripts/e2e-features.cjs`）
