# 〈スタッフ〉の画面・勤務時間（シフト）・勤務の見込み・スマホ画面

> この画面のファイル：`src/pages/StaffPage.tsx`・`OffboardPanel.tsx`・`AvailabilityPage.tsx`・`WorkloadPage.tsx`（`workload.css`）・`StaffViewPage.tsx`、`src/components/workBars.tsx`・`mapsLinks.tsx`・`personView.tsx`・`placeLookup.tsx`、`src/lib/offboard.ts`・`workload.ts`・`links.ts`・`viewMode.ts`。関連 ADR：0011・0014・0015・0016 追記・0017・0018・0023。関連 PRD：D16・D68・D75〜D77・D91〜D101・D118〜D121・D127〜D131・D201〜D209・D220・D221。
> 閲覧の欄と編集の欄の仕組み（`viewMode`・`personView`）は [pages-clients.md](pages-clients.md)。

### 〈スタッフ〉一覧（`#/staff`）

- 見出し「〈スタッフ〉一覧」。一覧の行の操作は「〈名前〉を開く」（`Eye`）で閲覧の欄。`?id=` も閲覧の欄。「追加」はすぐ編集の欄
- 一覧の上に「最終勤務日のある〈スタッフ〉」のカード（`leaving-card`。振り直しが残っているか。「担当の振り直しを開く」`leaving-open`）
- 一覧の状態に「最終 M/D」（`staff-lastday`）
- 狭い画面（600px 以下。PRD D220）：一覧の表（`narrow-staff`）は1人を1枚のカードに（[pages.md](pages.md) の「狭い画面の表」）。1行目に名前と状態（休止中・最終 M/D）、続けて「勤務」・「特性」・「〈利用者さん〉に求めること」・「自宅の位置」、開く・スマホ画面は右下。外の枠のカードは消してカードを本文の上に並べる。列は隠さない
- 閲覧の欄（`StaffView`）と編集の欄の動きは [pages-clients.md](pages-clients.md) の「閲覧の欄と編集の欄」。閲覧には相性・担当の名前（いつもの担当と記号ごとの〈利用者さん〉・人数・利用中だけ・「あと N人」・名前の吹き出し）

#### 編集の欄の中身

- 名前・特性・条件・稼働時間帯など
- 「メールアドレス（任意）」（`staff-email`）：保存のときに `normalizeEmail` で直し、直せなければ保存しない
- 自宅：`AddressField`（testId `staff-home`）。郵便番号は部品の中だけで持ち保存しない（見出し「郵便番号（任意。住所を探すためだけで、保存しません）」。開き直すと空に戻る）。`key={form.id}`
- 「最終勤務日」（`staff-lastday-input`）
- 休止にして保存するとき、その人を限った〈利用者さん〉（担当できる人）があれば確認（名前と、全員いなくなる人は「だれでも担当できるようになります」）を出し、同じ `update` で外す

### 最終勤務日と担当の振り直し（ADR-0015）

- 保存して振り直すものがあれば欄を閉じて「担当の振り直し」の欄（`pages/OffboardPanel.tsx`・`offboard-panel`）を開く（`lib/offboard` の `offboardScope`・`applyOffboard`）
- 〈利用者さん〉ごと（`offboard-clients`・`offboard-client`）：行の見出しの〈利用者さん〉の名前は `PersonButton`（`offboard-client-name`。select の option には置かない。欄の中の吹き出し・Esc）。代わりの候補（入れる回・受け持ち。`offboard-choice`）。無ければ `offboard-no-clients`
- 翌日以降にその人が担当している訪問（`offboard-visits`。日ごとの件数と日の予定へのボタン）。無ければ `offboard-no-visits`
- 欄の主ボタンは「まとめて適用」（`offboard-apply`。1つ）：いつもの担当・パターンの担当・担当できる人を置き換える。訪問の案は作り直さない
- 月の予定で、最終勤務日に「最終」、後の日のその人の訪問は「休みの人に N」（`absentLeftIds` に「最終勤務日の後」を足した）、〈スタッフ〉を選ぶと後の日は「最終勤務日の後」

### 勤務時間（シフト）（`#/availability`）

- 〈スタッフ〉×日の稼働時間帯。セルの時間帯の文は上書き・基本のまま。保存は `availability-save`
- 欠勤のある日のセルに「欠勤」の印（「欠勤（終日）」「欠勤 9:00〜12:00」。メモは title。`avail-absence`）
- 右の欄（勤務時間（シフト）の欄）：同じ欠勤の文と、`Link`（`availability-absence-link`。`suddenHref(日付, 人)`。`setDate` しない）。その日に働く日（`availabilityOf` の slots があり `retiredWhy` が無い＝`pickedWorks`）だけ出す。欠勤があれば「この日の欠勤を直す・取り消す」、無ければ「この日の欠勤を登録する」＋「（日の予定の「欠勤・キャンセル」で開く）」。休みの日・最終勤務日の後（`availability-retired`）は出さない。知らない人・その日に働かない人の `staff=` は日の予定で1段目
- 欠勤・キャンセルを切ると、凡例に登録の場所を出さない
- 狭い画面（PRD D221）：表は `EdgeScroll`（`avail-scroll`）。箱の高さを画面の中（上の帯と下のタブの間）に収めて中で巻き、見出しの行と名前の列を止める。右に続きがあるあいだ右の端をぼかす

### 勤務の見込み（`#/workload?ym=&staff=`。ADR-0015）

- 入口：メニューの「勤務の見込み」・月の予定の見出しの「勤務の見込み」・日の予定の拘束超えの帯・月の要対応（`workloadHref`）
- `lib/workload` の `workMonth`・`workTotals`・`workloadTsv`
- 見出し（`work-title`）・「表をコピー」（`work-copy`。タブ区切りの表）・要約（`work-summary`）。主ボタンは無し
- 事業所の設定（`org`）をこの画面で直す：交通費の単価（`work-fare`。0 にすると交通費の列が消える）・拘束の上限（`work-limit`。`Term` `span`＝出勤〜退勤（拘束））
- 空の画面（`work-empty`。`periodEmptyGuide`。`onOpenDay`）
- 月の合計の表（`work-totals`。見出しの空き時間（待ち）は `Term`、出勤〜退勤（拘束）は上限の設定に説明があるので文字だけ（PRD D241）。日ごとの表の見出しも文字だけ）
- 〈スタッフ〉×日の表（`work-grid`）：拘束の時間と横棒 `SpanMini`（長さと上限の線）。マスの中を `button.work-cell-in.work-cell-btn`（`data-date`・title は内訳・aria-label は見えている数字（`spanNum`。上限超えは「!」）を先頭に内訳＋「（日の予定で開く）」。訪問の無いマスはボタンにしない）。上限を超える日は斜線と「!」。表の下の説明（`work-grid-note`）「マスを押すと…。内訳は下の「日ごと」の表で見られます」
- 狭い画面（PRD D221）：〈スタッフ〉×日の表は `EdgeScroll`（`work-grid-scroll`）。勤務時間（シフト）と同じく箱の中で巻き、見出しの行と名前の列を止め、右の端をぼかす
- 選んだ人（`work-staff`）の日ごとの表（`work-detail`）：時間軸の横棒 `SpanBar`（`WorkStat.parts`＝`spanParts`。拘束の中を訪問・移動・待ちに塗り分け、上限を超える日は太い橙の枠。行の注意の印と文字）。日付は `link-btn`（`work-day-open`・`data-date`・aria-label「M/D（曜）（日の予定で開く）」）。上限を超えるマスもキーボード・読み上げで分かる。名前の吹き出しは付けない
- `openDay(d)`：`setDate` → `/plan`（空の画面の `onOpenDay` も）
- 上限を下げると、超える日に月の「拘束超」・要対応・日の予定の帯が出る

### 〈スタッフ〉のスマホ画面（`#/staff-view/:staffId`。D16。見本・表示だけ）

- `AdminShell` の外（`Guarded`）。`.staff-shell` の上と左右を safe-area で避ける
- その日の順番（時刻は欠勤を差し引いた `slotsOf`）。休みの訪問は今の案・確定した割当にあっても出さない
- 各訪問の下に訪問先の決まりごと（`VisitRules`）
- 道順のリンク（ADR-0018）：地図の下に「1日の全行程を開く」（`sv-trip`・`maps-trip`。分けたときは「全行程 1/2を開く」…）、各訪問に `VisitRouteLinks`（前の場所は表示している順番の前の訪問先、1件目は自宅）。全行程の横に未登録の人・自宅・自転車の一言（`sv-trip-skipped`）。公共交通は全行程を出さず「訪問ごとの…を使ってください」（`sv-transit`）
- 名前の吹き出しは付けない

### 完了の条件

- [ ] （ADR-0015）最終勤務日を入れて保存すると「担当の振り直し」の欄が開き、〈利用者さん〉ごとの代わりの候補（入れる回・受け持ち）と、翌日以降にその人が担当している訪問（日ごと・日の予定へ）が出る。「まとめて適用」でいつもの担当・パターンの担当・担当できる人が置き換わり、案は変わらない
- [ ] （ADR-0014）休止にすると、限った〈利用者さん〉の確認が出て外れる
- [ ] （ADR-0015）`#/workload` で月の合計・〈スタッフ〉×日の拘束の横棒・選んだ人の日ごとの時間軸の横棒が出る。単価を 0 にすると交通費の列が消え、上限を下げると超える日に斜線と「!」・月に「拘束超」・要対応・日の予定の帯が出る。「表をコピー」でタブ区切りの表
- [ ] 勤務時間（シフト）の画面の欠勤のある日のセルに「欠勤」の印が出る。右の欄のリンクで日の予定の欠勤・キャンセルの欄（その人の2段目）が開く（`scripts/e2e-links.cjs`）
- [ ] （ADR-0023）閲覧の欄・編集の欄（`scripts/e2e-view.cjs`）。自宅の郵便番号を保存しない（`scripts/e2e-address.cjs`）
- [ ] `lib/workload`・`lib/offboard` のテストが通る
