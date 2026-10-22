# 〈利用者さん〉の画面と、閲覧の欄・住所の入力・絞り込み（共通部品）

> この画面のファイル：`src/pages/ClientsPage.tsx`・`PatternsSection.tsx`・`ClientLeavesSection.tsx`・`PlaceAllPanel.tsx`、`src/components/personView.tsx`（`personView.css`）・`placeLookup.tsx`（`placeLookup.css`）・`ClientFilter.tsx`・`ClientPicker.tsx`・`VisitRules.tsx`・`PickChips.tsx`、`src/lib/viewMode.ts`・`clientFilter.ts`・`area.ts`・`search.ts`・`leaves.ts`・`patternText.ts`・`tentative.ts`・`clientStage.ts`・`addressLookup.ts`・`geocode.ts`・`postalCode.ts`・`placeAll.ts`。関連 ADR：0012・0013・0014・0015・0016（追記を含む）・0017・0021・0023・0026。関連 PRD：D36〜D40・D47・D60〜D62・D64〜D66・D68・D86〜D92・D108〜D112・D285・D118〜D121・D127〜D131・D220。
> 〈スタッフ〉の画面は [pages-staff.md](pages-staff.md)（閲覧の欄の仕組みはこのファイルと共通）。

### 〈利用者さん〉一覧（`#/clients`）

- 見出し「〈利用者さん〉一覧」
- 一覧の上に `ClientFilter`（`clients-filter`。画面の状態。URL に残さない。既定 `EMPTY_FILTER`）。期間は選んでいる日（`useDay`）を含む週（月〜日）で、`weekDay` を7日分作って `filterFacts` に渡す。終了の人は「終了の人も出す」のときだけ出す（終了にして保存すると、そのことを知らせる）
- 狭い画面（600px 以下。PRD D220）：絞り込みの欄の中身（`ClientFilter` と段階の説明）を「絞り込み（N）」のボタン（`narrow-filter-toggle`。`aria-expanded`・`aria-controls`）の下に畳み、横に「N人を表示」（`narrow-filter-count`）。N は `activeFilterCount`（下）。はじめは畳み、開いたかは画面の中だけ（URL・データに書かない）。広い画面ではボタンを出さずいつも開いたまま
- 一覧の上に「位置の無い〈利用者さん〉」のカード（下の「まとめて地図に置く」）
- 一覧の行（`client-row`）：状態に段階（`client-stage`）・「いつもの担当」の列に担当できる人の印「限 山田、佐藤」（`client-limit`。title に全員の名前）・「仮」の印。行の操作は「〈名前〉を開く」（lucide の `Eye`）で閲覧の欄
- 狭い画面（PRD D220）：一覧の表（`narrow-clients`）は1人を1枚のカードに（[pages.md](pages.md) の「狭い画面の表」）。1行目に名前（よみ・住所）と状態（段階・仮）、続けて「位置」・「特性」・「〈スタッフ〉に求めること」・「いつもの担当」（限の印も）、開くは右下。外の枠のカードは消す。列は隠さない
- 「追加」はすぐ編集の欄（何も入れずに取り消すと確認なしで閉じる）
- `?id=` は閲覧の欄（下）

### 閲覧の欄と編集の欄（〈スタッフ〉・〈利用者さん〉共通。ADR-0023。PRD D127〜D131）

#### 画面の状態（`pages/StaffPage`・`pages/ClientsPage`）

- `viewId`（閲覧している人）と `form`（編集の入力）を持つ。欄（`SidePanel`）は1つで、`form` があれば編集、無ければ `viewId` の人の閲覧（データにいなければ出さない）
- 欄の中の `SectionTitle` は `SectionLevelProvider` で h3

#### 開き方

- 一覧の「開く」・`?id=`・名前の吹き出しのリンク・コマンドパレットの人 → 閲覧の欄
- `?id=` で開いたら URL から `id` を消す（`replace`）。いない ID は何もしない。編集中の同じ人なら確認なしで編集を続ける。別の人なら（変更があれば）確認し、断れば編集が続く
- 「まとめて地図に置く」で置けなかった人の「編集」（`PlaceAllPanel` の `onEdit`）は編集で開く

#### 閲覧の欄（`components/personView.tsx`）

- `StaffView`・`ClientView`：節（`SectionTitle`）ごとに dl で並べる（行の部品は `components/personDetail.tsx`。[pages-common.md](pages-common.md)）。入力欄・即時に書くボタンは置かない。data-testid `person-view`（`data-kind`）
- 〈利用者さん〉の位置があれば `RouteMap`（1点・`onPick` なし・高さ 180）
- 定期パターンは読むだけ：`patternWhenText`・種類・所要・`periodText`・いつもの担当の一覧（`view-patterns`。いつもの担当が休止中なら「（休止中）」を添える）
- 休みは読むだけ：`splitLeaves` のこれからの休み（`view-leaves`）と終わった件数
- 地区は住所が無ければ「住所なし」、住所はあるが取り出せなければ「—」（吹き出しも同じ）
- 右上（`headActions`）に「編集する」（`btn btn-edit`。主ボタンにしない。data-testid `view-edit`。`data-return-focus`）。押すと `form` に保存した中身の写しを入れる

#### 編集の欄

- 下の帯（`footer`）に「保存」（主ボタン）と「取り消し」（data-testid `edit-cancel`）
- 保存したら `form` を消して閲覧に戻る（〈スタッフ〉で振り直すものがあれば閉じて `OffboardPanel`）。取り消しは閲覧へ（新しい人なら閉じる）。閲覧に戻ったらフォーカスは「編集する」（`focusKey`）
- ×・Esc は欄を閉じる
- 変更があるまま 取り消し・閉じる・別の人（`?id=`）は `isDirty` と `discardDialog` で独自の確認ダイアログ（`okToDiscard` は Promise を返す）。欄はモーダルなので「追加」などの後ろのボタンは編集中に押せない（コードでは念のため同じ確認を通す）
- 〈利用者さん〉の担当できる人は、比べる前に保存のときと同じ値（限らなければ空・限るなら利用中の人だけ）にそろえる（入れてすぐ外しただけなら変更なし）。特性を未確認に戻しただけも変更なし
- 変更があるときだけ `beforeunload` を付ける（再読込・タブを閉じるとき。ブラウザの確認のまま。戻る・画面の移動では出せない）
- 仮押さえの2つのボタン・`PatternsSection`・`ClientLeavesSection` は編集の中だけ

#### `lib/viewMode.ts`（純粋関数。テストあり）

- `isDirty(form, base, extra)`：編集の入力と比べる元（既存の人は保存した中身、新しい人は開いたときの空の欄）を JSON で比べる。`traits` は `cleanTraits`（null・空の文字・空の配列のキーを消す）で未入力を取り除いてから比べる。元が無ければ変更あり。`extra` は欄の外の入力が変わったか
- `discardDialog(when, term, name, next)`：`view`＝閲覧に戻る・`close`＝欄を閉じる・`switch`＝別の人を開く の確認ダイアログの頼み（見出し・本文・確定「捨てて〜」（危険の色）・取り消し「編集を続ける」）。呼び方は `org.terms`
- `orDash`（空なら「—」）・`splitLeaves(leaves, today)`（これからの休み（今日を含む・開始日の順）と終わった件数）

#### `components/ui.tsx` の `SidePanel` に足したもの

`headActions`・`focusKey`（[pages-common.md](pages-common.md) の「右の欄」）。

#### 確かめ

`scripts/e2e-view.cjs`：一覧の「開く」・`?id=`・相性の吹き出しのリンクで閲覧の欄が開き入力欄が無い・中身の項目・地図・節の見出しが h3・「編集する」で編集の欄（主ボタンにしない）・保存と取り消しで閲覧に戻りフォーカスは「編集する」・変更があるまま取り消す・×・Esc・別の人の `?id=` で確認が出て、断れば編集が続く・変更が無ければ・同じ人の `?id=`・特性を未確認に戻しただけ・担当できる人を限るを入れて外しただけなら確認しない・変更があるときだけ beforeunload・「追加」はすぐ編集・「まとめて地図に置く」の「編集」は編集の欄・定期パターンと休みは閲覧では読むだけ・相性・担当の名前。

### 〈利用者さん〉の編集の欄の中身

#### 基本

- 表示名・よみ（`client-kana`。`clientSchema` の `kana: z.string().max(50).default('')`。ひらがな。古いデータは ''。Excel の〈利用者さん〉シートに「よみ」（任意の列））・住所（`ClientPlaceEditor`。下）・特性・条件（`components/conditions.tsx`）・いつもの担当・メモ
- 「メールアドレス（任意）」：保存のときに `normalizeEmail` で直し、直せなければ保存しない

#### 段階と紹介元（ADR-0015）

- 節「段階と紹介元」（`client-stage-form`）：段階（`client-stage-select`）・枠を仮押さえする・紹介元（`client-referrer-name`）・紹介元のメールアドレス（任意。`client-referrer-email`。`normalizeEmail`）・連絡先・メモ
- 段階を「終了」にすると予定・AI案に入らない。利用中の前の段階は「枠を仮押さえする」のときだけ予定に入る
- 仮押さえ（`tentative-box`）：「本登録にする」（段階を利用中、`tentative: false`）・「仮押さえを取り消す」（確認のうえ、その人のパターンを `removePattern` で消し〈利用者さん〉を消す）。空き状況の仮押さえは「相談受付」で入る
- `clientStage` が切なら段階は「利用中／終了」の2つで選ばせ、ほかの段階の人はそのまま（今の段階の名前を出す）

#### 担当できる人（ADR-0014。PRD D68）

- 節「担当できる人（社内の決まり）」（`client-allowed`）：「担当できる人を限る」のチェックと、利用中の〈スタッフ〉のチップ（`PickChips`。`bulk={false}` で「全員・全解除」を出さない）
- 入れたときに誰も選んでいなければいつもの担当を選んでおく。限るのに1人も選ばなければ保存しない（理由を出す）。保存のとき休止中の人は外す
- 〈スタッフ〉を休止にして保存するときの確認は [pages-staff.md](pages-staff.md)

#### 訪問先の決まりごと（ADR-0013。PRD D66）

- 節「訪問先の決まりごと」（`visit-rules-form`）：入り方・鍵・駐車場・注意の4つの入力（各200字）。注意書き「実在の人の名前・住所などの個人情報は入れないでください。」（データの画面と同じ文）
- 表示は `components/VisitRules.tsx`（空の項目は出さない。どれも空なら何も出さない）。置く所：〈スタッフ〉のスマホ画面の各訪問の下、日の予定の時間軸の帯・順番のカードを押したときの詳細

#### 定期パターン（`pages/PatternsSection.tsx`。ADR-0012・0013。PRD D37・D64）

- 一覧：種類の色・曜日・間隔・時刻・所要・期間・いつもの担当。一覧の文は `lib/patternText` の `patternWhenText`（「毎月 第3・第4 木 10:00」「月 9:30・木 15:00」）
- 欄：
  - 種類（選ぶと所要の初期値が種類の標準の所要）
  - 曜日（日〜土のトグル。1つ以上）
  - 繰り返し：毎週／隔週／3週ごと／4週ごと／毎月（第N週）。毎月を選ぶと「第1〜第5」のトグル（1つ以上。第5は「第5（ある月だけ）」）
  - 時間の決め方（ちょうど／幅）と開始（早・遅）。「曜日ごとに時刻を変える」を入れると、選んだ曜日ごとに開始（早・遅）の行（空の行は共通の時刻）
  - 所要・開始日（初期値：今日）・終了日（空＝続く）・いつもの担当（空＝〈利用者さん〉のいつもの担当）・メモ
- 足すと、展開済みの範囲（今日から、いまある訪問の最後の日まで）に `applyPatterns` で展開する
- 直すときは「いつから変えますか」（初期値：今日）を出し、`splitPattern` の結果（作り直す訪問 N件、そのうち確定した日 M日の訪問）を確認してから入れる
- 消すときも `removePattern` の結果の件数を確認する
- 毎月のパターンは `patternMonthly` を切っても `repeat` と `monthWeeks` を残し、読むだけと注記

#### 休み（`pages/ClientLeavesSection.tsx`。ADR-0013。PRD D65）

- 置く所：〈利用者さん〉の編集の欄の「定期パターン」の下と、月の予定で〈利用者さん〉を選んだときの右の欄
- 休みの一覧（期間・理由・その期間の訪問 N件）と 足す・直す・消す（開始日・終了日（初期値：今日〜今日）・理由（100字まで））
- 足す・直す前に、休みと重なる確定した日（`leaveConfirmedDates`）があれば「確定した日（10/20・10/27）に〈名前〉の訪問があります。その日の「日の予定」で案を作り直してください」とその日へのリンクを欄に出す（確認ではなく注意。保存はできる）
- 消すときは確認しない（元に戻るだけ。訪問は増えない）
- 休みの訪問は AI案・まとめて作る・空き状況から外れる。日・週・月での見せ方は各画面のファイル。〈スタッフ〉のスマホ画面は休みの訪問を今の案・確定した割当にあっても出さない

#### `lib/leaves.ts`（画面の純粋関数。テストあり）

`leavesOf(data, clientId)`（開始の順）・`saveLeave(d, leave)`（同じ ID は置き換え）・`removeLeave(d, id)`・`leaveVisitsOn(data, date)`（その日の休みの訪問と休み）・`leaveConfirmedDates(data, leave)`（休みの期間で、確定した割当にその〈利用者さん〉の訪問がある日）・`leaveVisits(data, leave)`（休みの期間のその〈利用者さん〉の取り消しでない訪問）・`keepLeaveVisits(cols, leaveVisitIds, before)`（確定するとき、休みの訪問を前の確定した担当のまま残す）

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
- `ClientPlaceEditor`：`place.postalCode` を持たせた〈利用者さん〉用（`key={form.id}`）
- 使う所：〈利用者さん〉の編集（`ClientPlaceEditor`）・空き状況の場所（[pages-vacancy.md](pages-vacancy.md)）・〈スタッフ〉の自宅（[pages-staff.md](pages-staff.md)）

#### まとめて地図に置く（`lib/placeAll.ts`・`pages/PlaceAllPanel.tsx`）

- 一覧の上の「位置の無い〈利用者さん〉」のカード：ふつうのボタン「まとめて地図に置く」・注記・進み具合・「止める」・結果。画面を離れたら止める
- `placeAllTargets(clients)`（対象・住所も郵便番号もない人）、`placeAll(targets, opts)`（1人ずつ順に・呼ぶたびに間隔をあける・止める・1人ごとに結果を返す）、`withFoundPlace(data, id, place)`（位置の無いときだけ書く update 用の純粋関数）
- 置けなかった人の「編集」は編集の欄で開く

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
- [ ] （ADR-0023）一覧の「開く」・`?id=` で閲覧の欄が開き、入力欄が無い。「編集する」で編集の欄になり、保存・取り消しで閲覧に戻る。変更があるまま取り消す・閉じる・別の人を開くと確認が出る。「追加」はすぐ編集の欄（`scripts/e2e-view.cjs`）
- [ ] （ADR-0016 追記）`scripts/e2e-address.cjs` が通る：開いた・打っただけでは送らず送るのは zipcode・q だけ、郵便番号の正規化、候補と元に戻す、見つからない・つながらない・時間切れで知らせてデータを変えない、連打で1回・途中で閉じたら書かない・途中の書き換えで古い応答を捨てる、〈利用者さん〉の data-testid と保存
- [ ] `lib/leaves`・`lib/patternText`・`lib/area`・`lib/clientFilter`・`lib/search`・`lib/viewMode`・`lib/addressLookup`・`lib/postalCode`・`lib/geocode`（偽物）・`lib/clientStage` のテストが通る
