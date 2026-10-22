# 〈利用者さん〉の一覧と、〈利用者さん〉・〈スタッフ〉の画面・住所の入力・絞り込み（共通部品）

> この画面のファイル：`src/pages/ClientsPage.tsx`・`ClientPage.tsx`・`PatternsSection.tsx`・`ClientLeavesSection.tsx`・`PlaceAllPanel.tsx`、`src/components/personPage.tsx`（`personPage.css`）・`PersonCalendar.tsx`（`personCalendar.css`）・`personView.tsx`（`personView.css`）・`placeLookup.tsx`（`placeLookup.css`）・`ClientFilter.tsx`・`ClientPicker.tsx`・`VisitRules.tsx`・`PickChips.tsx`、`src/lib/personPage.ts`・`viewMode.ts`・`visitOps.ts`（`staffVisitsIn`・`endPatternOp`）・`clientFilter.ts`・`area.ts`・`search.ts`・`leaves.ts`・`patternText.ts`・`tentative.ts`・`clientStage.ts`・`addressLookup.ts`・`geocode.ts`・`postalCode.ts`・`placeAll.ts`。関連 ADR：0012・0013・0014・0015・0016（追記を含む）・0017・0021・0026・0051・0052。関連 PRD：D36〜D40・D47・D60〜D62・D64〜D66・D68・D86〜D92・D108〜D112・D285・D118〜D121・D220・D308〜D313。
> 〈スタッフ〉の画面の中身は [pages-staff.md](pages-staff.md)（画面の殻・タブ・節・予定のカレンダーはこのファイルと共通）。訪問の詳細の欄は [pages-common.md](pages-common.md)。

### 〈利用者さん〉一覧（`#/clients`）

- 見出し「〈利用者さん〉一覧」。題名の下に人のタブ（`PeopleTabs`。[pages.md](pages.md)。PRD D326）。見出しの右に主ボタン「〈利用者さん〉を追加」（`client-add`。`#/clients/new` へのリンク）
- 一覧の上に `ClientFilter`（`clients-filter`。画面の状態。URL に残さない。既定 `EMPTY_FILTER`）。期間は選んでいる日（`useDay`）を含む週（月〜日）で、`weekDay` を7日分作って `filterFacts` に渡す。終了の人は「終了の人も出す」のときだけ出す
- 狭い画面（600px 以下。PRD D220）：絞り込みの欄の中身（`ClientFilter` と段階の説明）を「絞り込み（N）」のボタン（`narrow-filter-toggle`。`aria-expanded`・`aria-controls`）の下に畳み、横に「N人を表示」（`narrow-filter-count`）。N は `activeFilterCount`（下）。はじめは畳み、開いたかは画面の中だけ。広い画面ではボタンを出さずいつも開いたまま
- 一覧の上に「位置の無い〈利用者さん〉」のカード（下の「まとめて地図に置く」）。置けなかった人の「編集」はその人の画面の住所の節（`#/clients/:id?tab=basic&edit=place`。開いたら URL の `edit` を消し、節の無いタブ（予定）で開いたら節のタブへ移す）
- 一覧の行（`client-row`）：状態に段階（`client-stage`）・「いつもの担当」の列に担当できる人の印「限 山田、佐藤」（`client-limit`。title に全員の名前）・「仮」の印。右端は「〈名前〉を開く」（lucide の `Eye`。`client-open`。その人の画面へのリンク）
- 行のどこを押してもその人の画面へ移る（`lib/rowOpen` の `shouldOpenRow`：行の中のボタン・リンク・入力欄・文字の選択・二度押しの2回目は除く。`.row-open` で指のカーソルと地の色。PRD D308）
- 狭い画面（PRD D220）：一覧の表（`narrow-clients`）は1人を1枚のカードに（[pages.md](pages.md) の「狭い画面の表」）。1行目に名前（よみ・住所）と状態（段階・仮）、続けて「位置」・「特性」・「〈スタッフ〉に求めること」・「いつもの担当」（限の印も）、開くは右下
- `?id=`（古いリンク・ブックマーク）：その人がいればその人の画面へ `replace` で移る。いなければ URL から消すだけ

### 〈利用者さん〉・〈スタッフ〉の画面の殻（PRD D308。ADR-0052）

#### ルートと状態

- `#/clients/:id`（`pages/ClientPage`）・`#/staff/:staffId`（`pages/StaffPersonPage`）。`new` は新しい人。メニューの印・上の帯の名前・作り直しの帯は一覧と同じ（`lib/nav` の `activeNavPath` が `/clients/:id` を `/clients` に当てる。`tabClick` は一覧の項目を押すと一覧へ移る）。初回の案内ツアーはこの URL で開いたときは出さない（`lib/tour` の `shouldAutoOpenTour`）
- 外側の部品が「URL の人」と「開いている人」を分けて持つ。URL の人が替わったら（パレット・吹き出し・hash の書き換え）、変更があれば確かめ（確認は画面の移動で待っている確認を取り消す処理のあとに出す）、断れば元の人の URL（クエリも）へ `replace` で戻す。中身は開いている人の ID を key にして作り直す。App の `Guarded` の ErrorBoundary の key は `/clients/:id` にそろえる（人が替わっても画面を作り直さない）
- いない人の URL は一覧へ `replace`（`state.missing`）し、一覧で「その〈利用者さん〉は見つかりません（消されたか、URL が違います）」と知らせる
- 外枠 `person-view`（`data-kind`＝client／staff・`data-id`。新しい人は空）。`.person-view` の dl の並び（`personView.css`）を使う

#### 見出しとタブ

- `PageHeader`：題名は名前（〈利用者さん〉は色の丸、〈スタッフ〉は `StaffMark`）。1行の説明の所に状態（`person-state`：〈利用者さん〉は段階・仮押さえ・休み中・いつもの担当、〈スタッフ〉は利用中／休止中・最終勤務日・ふだんの勤務）。右に一覧へ戻る文字のボタン（`person-back`）、〈スタッフ〉は本人のスマホ画面へのリンク（`to-staff-view`）
- タブ（`components/personPage` の `PersonTabs`。`person-tabs`。設定のタブと同じリンクのナビ `.view-switch`。今のタブは `aria-current`。`data-tab`）：〈利用者さん〉は［予定（`schedule`）｜基本情報（`basic`）｜担当・相性（`staffing`。相性を切れば「担当」）｜休み（`leaves`。休みの機能を切れば出さない）］、〈スタッフ〉は［予定｜基本情報｜勤務時間（`hours`）｜相性（`compat`。相性を切れば「担当」）］。URL の `?tab=`（先頭の予定は書かない。`lib/personPage` の `tabOf`・`tabSearch`。替えるときは `replace`・節の `edit` を消す）。変更があるまま押すと確かめる。替えると決めたら直している節・繰り返し・休みの入力を捨てる。新しい人は予定・担当などのタブを押せない（`aria-disabled` と title「保存してから見られます」）。狭い画面では横に巻き、今のタブを見える所へ
- 印刷ではタブ・節の「直す」・一覧へ戻る・繰り返しと休みの操作・予定のタブの左のリンクを出さない

#### 節（`EditSection`。PRD D311）

- `card person-sec`（`person-sec`・`data-section`）：見出し h2（アイコン＋名前）。読むときは中身（dl・地図など）と右上に「直す」（`sec-edit`。枠のボタン。aria-label「〈節の名前〉を直す」）、直すときは `<form noValidate>`（`sec-form`）に入力欄と「保存」（`sec-save`。主ボタン。直せる節は同時に1つなので画面に1つ）・「取り消し」（`sec-cancel`）・誤りの文（`FieldError`）。Enter で保存（`submitHandler`）、Esc で取り消し
- 直すと最初の入力欄へ、保存・取り消しのあとは「直す」へフォーカス
- 誤りの文の id は画面が持ち（`useId`）、`EditSection` の `errorId` と入力欄の `aria-describedby` を同じにする
- 画面は `edit = { key, form, opened }`（〈利用者さん〉は担当できる人を限るかも）を1つ持つ。`SECTIONS`（節 → 保存する項目）で、変更があるかは `pickFields` の項目だけを `lib/viewMode` の `isDirty` で比べ、保存は保存した中身に `mergeFields` でその項目だけ重ねる（ほかの節の項目・まとめて置いた位置を古い入力で上書きしない）。検査（郵便番号・メール・同じ名前・アイコン）も直している節の項目だけ（ほかの節の古い値で保存を止めない）。新しい人は `key: 'new'` で全部の項目
- 変更の確認（`components/personPage` の `useAskDiscard`・`discardChanges`）：取り消し・Esc は「変更を捨てますか？」（確定「捨てる」）、別の節は「変更を捨てて、ほかの節を直しますか？」、タブは「変更を捨てて、タブを替えますか？」、別の人は「変更を捨てて、〈名前〉を開きますか？」、メニュー・リンク・パレットで移るときは `useLeaveGuard`（「変更を捨てて移りますか？」「捨てて移る」。確定すると `onLeave` で入力を捨ててから移る。行き先は止めた時点で持ち、確認の間にリンクが外れた（名前の吹き出しが閉じた）ら行き先へ `navigate`）。訪問の詳細の欄の「日の予定で見る」・休みの注意の「…の予定を開く」も移る前に `confirmLeave`。取り消し側はどれも「編集を続ける」・危険の色。再読込・タブを閉じるは `beforeunload`（変更があるときだけ）。繰り返し・休みの入力の変更も数える（`onDirty`）。別のタブの変更の知らせ（D227）にも変更ありを知らせる
- 〈利用者さん〉の担当できる人は、比べる前に保存のときと同じ値（限らなければ空・限るなら利用中の人だけ）にそろえる。特性は `cleanTraits` で未入力を取り除いて比べる

#### 予定のタブの形

- `person-schedule`：左に `person-schedule-side`（360px まで）、右に `person-schedule-main`（カード）。1100px 以下は縦に並べ、600px 以下は右（日ごとのリスト）を先に

### 予定のカレンダー（`components/PersonCalendar.tsx`。PRD D309・D310・D312）

- 引数：`kind`（client／staff）・`personId`・`view`（week／month）・`anchor`（基準の日）・`onChange`（見せ方・期間を変えた）・`highlight`（強調する繰り返しの ID）・`dayNote`（日の見出しに添える印）。画面は `cal`（month のときだけ）・`d`（今日でないときだけ）を URL に `replace` で書く
- 回：`lib/personPage` の `clientCalItems`（`visitOps.clientVisitsIn`。取り消しも）・`staffCalItems`（`visitOps.staffVisitsIn`：その日の今の案、無ければ確定した割当でその人の列にある訪問。取り消しは出さない）。担当は `assignmentOf`。様子（`CalState`）は 取り消し（`cancelled`・`sameDay`）→ 休みのため無し（`leave`）→ 担当あり（`assigned`）→ 案はあるが入らない（`unassigned`。赤）→ 案なし（`noplan`。黄の点線）。時刻は訪問の開始（早）〜＋所要
- 回のボタン（`pcal-visit`・`data-visit`・`data-date`・`data-state`・`data-pattern`）：時刻・種類の色の点・固定の印・「変」（この回だけ変えた）、〈利用者さん〉の画面は担当の `StaffMark` と苗字（無ければ様子の文）、〈スタッフ〉の画面は〈利用者さん〉の名前。aria-label は「10/28（水） 09:00〜10:00 〈名前〉（種類・この回だけ変更・固定）（押すと訪問の詳細）」。押す・Enter で `useOpenVisit()`（閉じたらフォーカスはその回）
- 強調：`highlight` の繰り返しの回は `is-hl`、ほかは `is-dim`。回のボタンに `aria-pressed`。上に「選んだ繰り返しの回：この期間に N回」（`pcal-hl-note`）
- 道具の行（`pcal-tools`）：前／次（`pcal-prev`・`pcal-next`。週は7日・月は1か月）・見出し（`pcal-title`。「10/26（月）〜11/1（日）」「2026年10月」。aria-live）・今日・［週｜月］（`pcal-view`・`data-view`）・〈利用者さん〉の広い画面は「訪問を足す」（`pcal-add`。期間の今日以降の最初の日の 09:00・60分）
- 週（`data-layout="week"`）：見出しの行（日付・今日の印・`dayNote`・作ってある最後の日より後は「未作成」）と、左の時刻の目盛り（7:00〜20:00）、日ごとの列（`pcal-col`。1分 0.8px・1時間ごとの線。重なる回は `laneLayout` で横に並べる）。今日より前の列は薄い地
- 月（`data-layout="month"`）：月曜はじまりの週（`monthWeeksMon`）のマス（`pcal-cell`。日付・`dayNote`・回のボタン）。〈利用者さん〉の広い画面は今日以降のマスに「＋」（`pcal-cell-add`。その日の 09:00・60分）
- 足す（〈利用者さん〉の広い画面・今日以降の列）：列の空いている所で押すと押した枠（15分刻みに切り捨て）・所要60分。縦にドラッグすると影（`pcal-ghost`）を出し、枠をまたいだら押した枠と離した枠を両方含む長さ（上へ動かしても押した枠を含む。同じ枠の中で動いただけなら押しただけと同じ。`slotOf`）で `useOpenVisit({ newVisit: { date, clientId, start }, draft: { durationMinutes } })`。回の上で押したときは足さない
- 動かす（〈利用者さん〉の広い画面・今日以降の取り消しでない・休みでない回）：HTML のドラッグ（週の予定と同じ。つかんだ位置の差を保つ・15分に丸める・落とす所に影）。週は落とした日時、月は落としたマスの日で同じ時刻を `draft`（日付・開始（早）・開始（遅）は幅を保つ）に入れて欄を開く。範囲（この回だけ／これ以降／すべて）は欄で選ぶ。今日より前の日・7:00〜20:00 の外は動かさず知らせる。同じ日時なら何もしない。保存で日時が変わり担当を選ばず、新しい日に今の案があれば、カレンダーの上に「〈日〉の案に空き時間で入れる」の知らせ（`pcal-notice`・`pcal-insert`。`lib/week` の `insertIntoPlan`。入らなければ理由。週の予定と同じ）
- 下に1行の説明（足し方・動かし方）と、作ってある最後の日より後を見ているときは「M/D より後の訪問はまだ作っていません（「月の予定」で作ります）」（`pcal-unmade`）
- 狭い画面（600px 以下。`data-layout="list"`）：日ごとのリスト（`pcal-list`・`pcal-day`）。週は7日（訪問の無い日は「訪問なし」）、月はその月の訪問のある日と今日。足す・動かすは出さない
- 印刷：道具の行のボタン・説明・マスの「＋」・知らせを出さない（期間の見出しは出す）

### 〈利用者さん〉の画面の中身

#### 予定のタブ

- 左：繰り返し（`PatternsSection`。下）と休み（`schedule-leaves`。これからの休みを読むだけ。休みの機能を切っても出す。「休みを入れる・直す」は休みのタブへ）。狭い画面では繰り返しは読むだけで「繰り返しを足す・直すのは広い画面でできます」
- 右：`PersonCalendar`（`kind="client"`。`dayNote` はその日に休みなら「休み」）

#### 基本情報のタブ（節）

- 基本（`basic`：表示名・よみ（`client-kana`）・メモ・色）
- 段階と紹介元（`stage`：段階（`client-stage-select`）・枠を仮押さえする・紹介元（`client-referrer-name`）・連絡先・メールアドレス（任意。`client-referrer-email`。`normalizeEmail`）・メモ。`clientStage` を切れば「段階」だけで、段階は「利用中／終了」の2つ（ほかの段階の人はそのまま））。読むときに仮押さえの人は `tentative-box`：「本登録にする」（段階を利用中に）・「仮押さえを取り消す」（確認のうえ `lib/tentative` の `cancelTentative` でその人の繰り返し・訪問・〈利用者さん〉を消し、一覧へ）
- 住所（`place`：`ClientPlaceEditor`。読むときは郵便番号・住所・地区・地図の位置と、位置があれば `RouteMap`（1点・高さ 180））
- 特性（`traits`：`TraitsEditor`）
- 訪問先の決まりごと（`rules`。`visitNotes` が入のとき：入り方・鍵・駐車場・注意の4つ（各200字。`visit-rules-form`）。注意書き「実在の人の名前・住所などの個人情報は入れないでください。」）。表示は `components/VisitRules.tsx`（〈スタッフ〉のスマホ画面・日の予定の帯の詳細・訪問の詳細の欄）
- 新しい人（`#/clients/new`）は「基本」の節（`new`）に基本と段階の入力をまとめて開き、「住所・特性・担当・繰り返し・休みは、保存してから入れられます」。保存するとその人の画面の基本情報へ（`replace`）、取り消すと一覧へ（何も入れていなければ確かめない）
- 保存の検査：郵便番号は `normalizePostalCode`（直せなければ保存しない）・紹介元のメール・同じ名前は保存しない（Excel で名前で引くため）・`clientSchema`。段階に合わせて予定の対象・仮押さえを `withStage` で決める。終了にしたら「一覧の「終了の人も出す」で出ます」と知らせる

#### 担当・相性のタブ

- 担当（`staffing`：いつもの担当（`client-usual`）と、`allowedStaff` が入なら「担当できる人を限る」と利用中の〈スタッフ〉のチップ（`PickChips`・`client-allowed`・`bulk={false}`）。入れたときに誰も選んでいなければいつもの担当を選んでおく。限るのに1人も選ばなければ保存しない。保存のとき休止中の人は外す。読むときは `ClientStaffRows`（名前は `PersonNames`：押すと詳細の吹き出し。`view-allowed-staff`・`view-usual-staff`））
- 〈スタッフ〉に求めること（`conds`：必要条件・希望の `ConditionsEditor`。読むときは `CondRows` と条件のチップ）
- 相性（読むだけ。`compat` が入のとき）：`ClientCompatRows`（記号ごとの利用中の〈スタッフ〉の人数と名前。`view-compat-*`）と「相性の表で直す」（相性の画面をその人の名前で絞って開く `?cf=`）

#### 休みのタブ（`pages/ClientLeavesSection.tsx`。ADR-0013。PRD D65）

- 休みの一覧（期間・理由・その期間の訪問 N件・確定した日の数・終わった休みは「（終わった休み）」）と「休みを入れる」（`leave-add`）・行の「直す」（`leave-edit`）
- 入力（`leave-form`）：開始日（`leave-from`）・終了日（`leave-to`。初期値は今日〜今日）・理由（`leave-note`。100字まで）と「保存」（`leave-save`）・「取り消し」（`leave-cancel`）・直すときは「この休みを消す」（`leave-remove`。確認してから消す。元に戻るだけ）
- 入れる・直す前に、休みと重なる確定した日（`leaveConfirmedDates`）があれば「確定した日（10/20・10/27）に〈名前〉の訪問があります。その日の「日の予定」で案を作り直してください」とその日へのリンクを出す（確認ではなく注意。保存はできる）
- 休みの訪問は AI案・まとめて作る・空き状況から外れる。日・週・月での見せ方は各画面のファイル。〈スタッフ〉のスマホ画面は休みの訪問を出さない

#### 繰り返し（`pages/PatternsSection.tsx`。ADR-0012・0013。PRD D37・D64・D310）

- 見出し「繰り返し」と「繰り返しを足す」（`pattern-add`）。説明は箇条書き（押すとカレンダーで目立たせる・足すと作ってある最後の日まで作る・その先は月の予定）
- 一覧の行（`pattern-row`・`data-pattern`）：押せる文（`pattern-pick`。`aria-pressed`。種類・`patternWhenText`・所要・`periodText`・いつもの担当）と「直す」（`pattern-edit`）・「終わらせる」（`pattern-end`）
- 直す・足すの入力（`pattern-form`）：種類（選ぶと所要の初期値）・繰り返し（毎週／隔週／3週ごと／4週ごと／毎月（第N週）。`pattern-repeat`）・曜日（`pattern-weekdays`）・第何週（`pattern-month-weeks`）・時間の決め方・開始（早・遅）・曜日ごとの時刻（`pattern-per-day`・`pattern-daytimes`）・所要・開始日／いつから変えますか・終了日・いつもの担当・メモ。「保存」（`pattern-save`）・「取り消し」（`pattern-cancel`）・直すときは「この繰り返しを消す」（`pattern-remove`）
- 足す：`applyPatterns` で今日から作ってある最後の日まで作る。直す：`splitPattern`（作り直す N件・確定した日 M日を確かめる）。消す：`removePattern`（今日以降の N件を確かめる）
- 終わらせる（`pattern-end-form`）：最後の日（`pattern-end-last`。初期値は今日。終わっていればその終了日、まだ始まっていなければ開始日で、そのときは「開始日の回も要らないときは「直す」の「この繰り返しを消す」で消します」（`pattern-end-before`））と「保存」（`pattern-end-save`）。`visitOps` の `endPatternOp`（終了日を入れ、最後の日より後で今日以降の、この回だけ変えていない・取り消していない回を消す。確定した日の数）を確かめてから入れる
- 毎月のパターンは `patternMonthly` を切っても `repeat` と `monthWeeks` を残し、読むだけと注記（`pattern-monthly-off`）
- 入力の変更（開いたときとの違い。終わらせるは最後の日を変えたとき）を `onDirty` で画面へ知らせる

#### `lib/personPage.ts`（純粋関数。テストあり）

`personPathKind`・`tabOf`・`tabSearch`・`pickFields`・`mergeFields`・`calViewOf`・`monthWeeksMon`・`calDates`・`shiftAnchor`・`calTitle`・`clientCalItems`・`staffCalItems`・`itemsByDate`・`lastMadeDate`・`staffAbsencesIn`・`slotOf`・`clientStaffGroups`（〈利用者さん〉から見た相性の記号ごとの〈スタッフ〉）

#### `lib/viewMode.ts`（純粋関数。テストあり）

`isDirty(form, base, extra)`（JSON で比べる。`traits` は `cleanTraits` で未入力を取り除く。元が無ければ変更あり）・`orDash`（空なら「—」）

#### `lib/leaves.ts`（画面の純粋関数。テストあり）

`leavesOf(data, clientId)`（開始の順）・`saveLeave(d, leave)`（同じ ID は置き換え）・`removeLeave(d, id)`・`leaveVisitsOn(data, date)`（その日の休みの訪問と休み）・`leaveConfirmedDates(data, leave)`（休みの期間で、確定した割当にその〈利用者さん〉の訪問がある日）・`leaveVisits(data, leave)`（休みの期間のその〈利用者さん〉の取り消しでない訪問）・`keepLeaveVisits(cols, leaveVisitIds, before)`（確定するとき、休みの訪問を前の確定した担当のまま残す）

#### 確かめ

`scripts/e2e-view.cjs`（節の形・変更の確認・`?id=`・追加・吹き出しの名前・行を押す・アイコン）と `scripts/e2e-person-page.cjs`（タブ・予定のカレンダー・欄・空き枠から足す・ドラッグで動かす・繰り返し・休み・〈スタッフ〉の画面・390px・印刷）。

### 住所の入力（ADR-0016。PRD D86〜D90・D118〜D121）

外部を呼ぶのはボタンを押したときだけ（`lib/geocode.ts` の1か所）。開いた・打っただけでは送らず、送るのは zipcode・q だけ。

#### `lib/postalCode.ts`・`lib/geocode.ts`

- `postalCode.ts`（純粋関数。画面と Excel で使う）：`normalizePostalCode`・`formatPostalCode`
- `geocode.ts`（外部を呼ぶ**ただ1か所**）：`lookupPostalCode`・`searchAddress`・`jsonp`・`lookupMessage`（design.md §5「郵便番号と住所の検索」）。fetch・JSONP・待ち時間は引数で差し替えられ、テストは偽物で行う

#### `lib/addressLookup.ts`（純粋関数。外部は呼ばない）

- 押せない理由（`postalBlockReason`・`addressBlockReason`）、郵便番号の欄のエラー（`postalInputError`）
- 見つけた住所の当て方（`applyFoundAddress(current, found, hasPin)`。いまの住所が見つけた住所で始まるならそのまま）と「元に戻す」の先（`nextUndoAddress`・`canUndoAddress`）
- 状態の知らせ（`busyStatus`・`failStatus`・`pinStatus`・`statusClass`）、候補の並び（`postalCandidates`・`geoCandidates`）
- `toPlace`（郵便番号を落として契約の `Place` に）

#### `components/placeLookup.tsx` の `AddressField`

- 型の引数は場所の型 T。`value`・`onChange`（型はそのまま返す）。郵便番号は `postalCode`・`onPostalCodeChange` で渡す（渡さなければ部品の中だけで持つ）
- 中身：郵便番号・住所・「住所を探す」「地図に置く」・注記・状態・候補・`PlacePin`（地図とピン）。`postalLabel`・`noticeNote`（注記の後ろ）
- 主ボタンではない（欄の主ボタンは「保存」）。押せないときは aria-disabled＋理由（title と文字）
- `testId`（`client`／`vacancy`／`staff-home`）。部品の中の data-testid は `${testId}-notice`・`${testId}-status`・`${testId}-postal-candidate` などの頭付き。〈利用者さん〉だけは `client-postal`・`place-notice`・`place-lookup-status`・`postal-candidate`・`geo-candidate`
- 探している途中に郵便番号・住所の欄を書き換えた・地図でピンを動かしたら、呼び出しを止めて「探しています」を解く。応答のあとも送った値と今の欄の値（ref）を比べ、違えば捨てる（`sameQuery`）。押したことは ref でも持ち、連打しても1回だけ呼ぶ。途中で閉じたら書かない
- ピンがある状態で郵便番号から住所を差し替えたら、ピンは残し、知らせに「位置は前のままです。『住所から置き直す』を押してください」を足す
- 郵便番号のエラーと押せない理由は aria-describedby で結ぶ（読み上げ用の文字は .sr-only）。郵便番号の欄は16文字まで（空白の多い貼り付けも7桁に直す）
- 見つからない・つながらない・時間切れは知らせてデータを変えない
- `ClientPlaceEditor`：`place.postalCode` を持たせた〈利用者さん〉用（住所の節を直すたびに作り直す）
- 使う所：〈利用者さん〉の画面の住所の節（`ClientPlaceEditor`）・空き状況の場所（[pages-vacancy.md](pages-vacancy.md)）・〈スタッフ〉の自宅（[pages-staff.md](pages-staff.md)）

#### まとめて地図に置く（`lib/placeAll.ts`・`pages/PlaceAllPanel.tsx`）

- 一覧の上の「位置の無い〈利用者さん〉」のカード：ふつうのボタン「まとめて地図に置く」・注記・進み具合・「止める」・結果。画面を離れたら止める
- `placeAllTargets(clients)`（対象・住所も郵便番号もない人）、`placeAll(targets, opts)`（1人ずつ順に・呼ぶたびに間隔をあける・止める・1人ごとに結果を返す）、`withFoundPlace(data, id, place)`（位置の無いときだけ書く update 用の純粋関数）
- 置けなかった人の「編集」はその人の画面の住所の節を開く（`?tab=basic&edit=place`）

### 絞り込み（ADR-0021。PRD D108〜D112）

#### `lib/area.ts`（純粋関数。テストあり）

- `areaOf(address)` → `{ city, town } | null`
- 頭の郵便番号・都道府県を外し、政令市（20市の表）は 市＋区、郡は 郡＋町村、ほかは 市／区（東京の特別区）／町村 の順に探す
- 名前に「市」「郡」を含む市（四日市市・廿日市市・野々市市・大和郡山市・小郡市）と東京23区は表で、郡より・市より先に照らす。郡の町村の名前の「市」は許す（余市郡余市町・中新川郡上市町）
- 町名は続きを 数字（漢数字の丁目・番地を含む）・丁目・番地・括弧・空白 の前までで切る（無ければ ''。丁目だけなら「六丁目」のようにその丁目）。見つからなければ null
- 郵便番号のハイフンは各種のダッシュ・長音も、市と区・郡と町村のあいだの空白も詰める

#### `lib/clientFilter.ts`（純粋関数。テストあり）

- `ClientFilterState`：query・cities・towns（`townKey(city, town)`）・chips・staffId・showEnded・`types?`（押している訪問の種類の id。PRD D285。複数はどれか＝OR）・`extra?`（画面ごとに足すチップのうち押しているもの）
- 既定：`EMPTY_FILTER`（〈利用者さん〉の画面・相性）・`WEEK_TABLE_FILTER`（chips＝period。週の表）
- `filterFacts({ days, visits, clients, patterns, clientLeaves, staff, visitTypes? })`：週の `weekDay` の帯から、期間に訪問がある人・担当が決まっていない訪問（担当 null・休みでない帯）がある人・〈スタッフ〉が担当する人（帯の担当＋いつもの担当。`staffClientMap`）、期間にかかる休み・パターンのある人・働ける〈スタッフ〉（利用中で最終勤務日が無いか期間の終わり以降）・終了でも出す人 `endedShownIds`（`showEndedInPeriod` のとき期間に訪問がある人）。`extraTests?`（キー → 判定。無いキーは絞らない）。`visitTypes`（`data.visitTypes`）を渡すと `typeClientIds`（種類の id → 期間に、その種類の取り消しでない訪問〔帯のある訪問〕がある人）と `typeIds` を作る（渡さなければ作らず、種類で絞らない）
- `chipMatches`・`matchArea`・`filterClients`（AND。終了の人は showEnded のときだけ。渡した順のまま）・`chipCounts`（押したら何人か）・`cityChips`・`townChips`（地区のほかの絞り込みをかけた人数。住所なしは最後）・`toggleChip`・`toggleCity`（外すと町名も外す）・`toggleTown`・`staffCounts`（〈スタッフ〉ごとの「その人で押したら何人か」）・`resolveStaffId`（今の絞り込みで数えた `staffCounts` で `defaultStaffOf`）・`endedVisible`・`extraCounts`・`toggleExtra`・`matchTypes`（押した種類のどれかの訪問が期間にある人。消えた種類の id・`typeIds` の無い facts は無いものとして全員）・`typeChips`（種類ごとの人数＝種類を除いたほかの絞り込みをかけた、その種類の人）・`toggleType`（並びは `visitTypes` の順）・`sameFilter`・`chipLabel`・`chipHelp`
- `activeFilterCount(state)`（PRD D220）：効いている絞り込みの数＝検索の文字（空白だけでなければ1）＋市区＋町名＋チップ＋押している訪問の種類（`types`）＋足すチップ（`extra`）＋「終了の人も出す」（入なら1）。〈利用者さん〉一覧の畳んだ「絞り込み（N）」の N
- `encodeFilter`・`decodeFilter(raw, fallback, extraKeys)`：`?cf=` には `types` を押しているときだけ `type:t1,t2`（古い URL は種類なし）、`extra` を押しているときだけ `x:k1,k2`（並びはそろえる）。`extraKeys` に無い値は捨てる（週・〈利用者さん〉の画面は渡さない）

#### `components/ClientFilter.tsx`

- 検索欄：Esc で文字を消す。文字はこの部品の中にも持ち、変換中（`compositionstart`〜`compositionend`）は呼ぶ側へ渡さず確定で渡す。ふつうの入力は 300ms 待って渡す（週は `replace` で URL へ）。呼ぶ側の値が外から変わったら入力欄を合わせる。チップなどを押したときは入力欄の文字もいっしょに渡す
- 「終了の人も出す」（`hideEnded` で出さない）・件数「N人／M人」・「絞り込みを戻す」（既定と違うときだけ）
- 地区の1段目（市区）と選んだ市区ごとの2段目（町名）
- 訪問の種類（`visitTypes` を渡し1件以上のとき。地区の下・「絞り込み」の上の別の欄「訪問の種類（どれか）」。`testId-type`・`data-key`＝種類の id）：種類ごとのチップ（人数つき・0人は `aria-disabled`）。ADR-0021 追記。訪問の種類の機能の入り切りは無い（`features` に無い）ので、種類が0件のときだけ出さない
- 絞り込みのチップ：「〈スタッフ〉が担当する人」を押すと〈スタッフ〉の select（人数は「その人で押したら何人か」。このチップは0人でも押せる）。`extraChips`（チップ「絞り込み」の後ろに並べる。判定は `facts.extraTests`、人数は `extraCounts`）
- チップ・地区は `aria-pressed` のボタンで人数を読み上げ、0人で押していないものは `aria-disabled`（薄く、押しても何もしない）
- 状態は呼ぶ側が持つ
- 使う所：〈利用者さん〉一覧・週の〈利用者さん〉×曜日・相性

### 検索と `ClientPicker`（PRD D61・D62）

#### `lib/search.ts`（テストあり）

- `normalizeKana(text)`：カタカナ→ひらがな、全角半角・大文字小文字・空白の違いと、ハイフン・各種マイナス・ダッシュを長音「ー」にそろえる
- `matchClient(client, query)`：表示名・よみの部分一致
- `staffClientMap`（案の担当といつもの担当から〈スタッフ〉→〈利用者さん〉の表）・`defaultStaffOf`（近道で最初に選んでおく〈スタッフ〉＝担当する人が1人以上いる最初の人）・`countAmong`

#### `components/ClientPicker.tsx`

- 検索欄（`role="combobox"`・候補は `listbox`、上下キーと Enter で選ぶ）。候補は最大10件。変換中（IME）の Enter・↑↓ は何もしない
- 選んだ人のチップ（外すボタン付き。`showChips`（既定 true）。`details` で名前を `PersonButton` に）
- 近道のボタン：この週・月に訪問がある人（`period`）／〈スタッフ〉が担当する人（`byStaff`。〈スタッフ〉を選ぶ）／最近選んだ人（画面の状態に最大10人）／仮押さえの人（`tentativeShortcut` を渡す月だけ）
- `max` を渡すと超えたときに理由を出して選ばない（まとめて選ぶボタン「あと N人を選ぶ」（N＝足す人数）は消さず、上限を超えるときは `aria-disabled` で押せなくして理由の小さい文を近くに出す）
- 使う所：月（1人）・週の時間軸の「ほかの人を探す」（8人まで）

### 完了の条件

- [ ] （ADR-0012）定期パターンを足すと展開済みの範囲に訪問が出る。訪問を1件だけ時刻を変えると「この回だけの変更」になり、パターンを「いつから」で直しても変わらない。それ以外の、いつから以降の訪問は新しい時刻になり、それより前は変わらない
- [ ] （ADR-0013）パターンを「毎月・第3・第4・木」にすると、月・週で第3・第4木曜だけに訪問が出る。曜日ごとに時刻を変えると、その曜日の訪問がその時刻になる
- [ ] （ADR-0013）休みを入れると、その期間の訪問が日・週・月で薄く「休み」になり、AI案・まとめて作る・空き状況から外れる。確定した日と重なれば注意が出る。休みを消すと元に戻り、訪問は増えない
- [ ] （ADR-0013）決まりごとを入れると、〈スタッフ〉のスマホ画面と日の予定の訪問の詳細に出る
- [ ] （ADR-0014）担当できる人を2人に限ると、AI案・振り直しでその2人以外に入らず、理由に「担当を限る：… ✗」が出る
- [ ] （ADR-0015）段階を「終了」にすると予定・AI案に入らず、一覧は「終了の人も出す」のときだけ出す。仮押さえは「相談受付」で入り、「本登録にする」で利用中になる
- [ ] （ADR-0021）一覧を地区・チップ・検索で絞れる
- [ ] （PRD D285）「訪問の種類」のチップ（例「リハビリ」）で、この週にその種類の訪問がある人に絞れる。複数押せばどれか
- [ ] （ADR-0052）一覧の行・「開く」・`?id=` でその人の画面（`#/clients/:id`）が開き、節は読むだけ。「直す」でその節だけ入力欄になり、保存・取り消しで戻る。変更があるまま取り消す・タブを替える・別の人を開く・画面を移ると確認が出る。「追加」は新しい人の画面（`scripts/e2e-view.cjs`）
- [ ] （ADR-0052）予定のタブのカレンダーで回を押すと訪問の詳細の欄、空き枠を縦にドラッグすると所要の長さで新しい訪問、回をドラッグすると範囲を選んで動かせる。繰り返しを足す・直す・終わらせる（`scripts/e2e-person-page.cjs`）
- [ ] （ADR-0016 追記）`scripts/e2e-address.cjs` が通る：開いた・打っただけでは送らず送るのは zipcode・q だけ、郵便番号の正規化、候補と元に戻す、見つからない・つながらない・時間切れで知らせてデータを変えない、連打で1回・途中で閉じたら書かない・途中の書き換えで古い応答を捨てる、〈利用者さん〉の data-testid と保存
- [ ] `lib/leaves`・`lib/patternText`・`lib/area`・`lib/clientFilter`・`lib/search`・`lib/viewMode`・`lib/personPage`・`lib/visitOps`・`lib/addressLookup`・`lib/postalCode`・`lib/geocode`（偽物）・`lib/clientStage` のテストが通る
