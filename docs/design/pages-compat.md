# 相性の画面

> この画面のファイル：`src/pages/CompatPage.tsx`、`src/lib/compatView.ts`・`clientFilter.ts`、`src/components/StaffFilter.tsx`・`ClientFilter.tsx`・`DetailPopover.tsx`・`personDetail.tsx`。関連 ADR：0022・0028。関連 PRD：D113〜D117・D177・D214〜D215・D221。
> 名前から開く詳細の部品は [pages-common.md](pages-common.md)、`ClientFilter` は [pages-clients.md](pages-clients.md)。

### 相性（`#/compat`）

訪問先×〈スタッフ〉の表。メニューの「人」の「相性」（設定のタブには無い。PRD D283。ADR-0047）。〈利用者さん〉一覧・〈スタッフ〉一覧の見出しの右の文字ボタン「相性の表」（`data-testid="to-compat"`。`compat` を切れば出さない）からも開く。`lead`「セルを押すと ◎ → ○ → 空 → △ → × と変わります」。◎○は点が下がり（選ばれやすい）、△は点が上がる。× は担当にしない。休止中の人は出さない。

#### URL とクエリ

| クエリ | 意味 |
|---|---|
| `?sf=` | 〈スタッフ〉の列の絞り込み（`encodeStaffFilter`：`q:…;chip:k1,k2`） |
| `?cf=` | 〈利用者さん〉の行の絞り込み（`encodeFilter`。相性のチップは `x:k1,k2`） |

URL は既定のままなら消し、`replace` で書く。知らないチップ・項目を捨てたら URL も書き直す。

#### 絞り込みの欄

- 表の上に、畳める欄（`details` 要素。要約に今の状態 `staffFilterSummary`・`clientFilterSummary`。URL に絞り込みがあるときだけ開いておく。広い画面（1100px〜）では横に並べる）
- `StaffFilter`（`?sf=`）：〈スタッフ〉の列の名前の検索と特性のチップ（検索の文字の扱い・チップの見た目・「絞り込みを戻す」は `ClientFilter` と同じ）
- `ClientFilter`（`?cf=`。既定は `EMPTY_FILTER`。読んだあと `showEnded` は false にそろえる。`hideEnded`）。期間は選んでいる日を含む週の `weekDay`（相性だけが変わったときは作り直さない）。`extraChips` に相性のチップ、`facts.extraTests` は `compatChipSets`（前もって作る集まり。pending は絞り込んだ列、ng は休止中でない〈スタッフ〉）
- 相性のチップの判定に使う相性は、絞り込み（`?cf=`・`?sf=`）を変えたときの写しに止める（セルを押しても行を消さない。押した行が消えて次の人のセルを押さないため）。写しが古くなり相性のチップを押していれば「表を並べ直す」（小さいボタン。主ボタンにしない）を出す
- 0人なら表の代わりに `Empty` と「絞り込みを戻す」

#### 表

- 枠の中で巻き、見出しの行と1列目を止める（sticky）
- 箱は `EdgeScroll`（`table-scroll compat-scroll`。PRD D221）：狭い画面では右に続きがあるあいだ右の端をぼかし、右の端まで巻くと消す（[pages.md](pages.md) の「狭い画面の表」）
- 600px 以下では行の名前の列（`.avail-name`）を 7em に詰めて折り返し（空白で。行の頭文字の丸は出さない）、〈スタッフ〉の列を多く見せる（`settings.css`。PRD D272）
- 列の見出しの名前は `nameLines`（最初の空白で名字・名の2行、空白が無ければ `NAME_CHUNK`＝4文字ごと）で切れずに出す
- 行は `memo` の部品（その行の相性・列・開いているかを渡す）。300人×60人でセルを1回押して描き終わるまで 100ms 以下
- セル：押すと ◎→○→空→△→×→◎ と回す（`update`）。`title`「〈利用者さん〉 × 〈スタッフ〉：〈意味〉（押すと変わります）」・`aria-label`「〈利用者さん〉と〈スタッフ〉の相性：〈意味〉」。意味は `COMPAT_MEANING`（◎ 選ばれやすい・○ やや選ばれやすい・未入力（ふつう）・△ 選ばれにくい・× 担当にしない）
- 凡例（◎○△×の意味。色は表のセルと同じ）

#### 吹き出し

- 列の見出し・行の名前はボタン（`aria-haspopup="dialog"`・`aria-expanded`・`aria-controls`）で、押すと `DetailPopover`（自分の state で出す。開くのは1つだけ、`{ kind, id }` で持つ。もう一度押すと閉じる）
- 中身は `StaffDetail`・`ClientDetail`（data-testid `compat-pop-link`・`compat-pop-counts`）。リンクでその人の画面（`#/staff/:id`・`#/clients/:id`）
- 絞り込みで見出しが消えたら閉じる

#### `lib/compatView.ts`（純粋関数。テストあり）

- `nameLines(name)`・`NAME_CHUNK`
- 〈スタッフ〉の列の絞り込み：`StaffFilterState`（query・chips）・`EMPTY_STAFF_FILTER`・`staffChipDefs(items)`（〈スタッフ〉の choice・multi は選択肢ごと、flag は あり／なし。number は作らない。キーは `staffChipKey(itemId, value)`＝それぞれ `encodeURIComponent` して「=」でつなぐ）・`staffChipMatches`（未入力はどれにも当てはまらない）・`filterStaff`（名前 AND チップ）・`staffChipCounts`（押したら何人になるか）・`toggleStaffChip`・`encodeStaffFilter`／`decodeStaffFilter`（知らないチップは捨てる）・`sameStaffFilter`
- 相性のチップ：`COMPAT_CHIPS`（`pending`・`ng`）・`compatChipSets(compat, clientIds, visibleStaffIds, activeStaffIds)`・`compatChipTests(sets)`・`compatChipText`
- 畳んだ欄の要約：`staffFilterSummary`・`clientFilterSummary`
- 吹き出しの中身：`staffCompatCounts`・`traitText`・`weeklyHours`

#### 機能の入り切り

- `compat` を切ると相性の画面は開けず（ホームへ移る）、計算は相性（表の値・相性の条件・×の可否）を読まない。切るとき相性のデータがあれば管理者設定が件数と効き方の確認を出す（`turnOffImpact`）

#### 確かめ

`scripts/e2e-compat.cjs`：名前・吹き出しの開閉とフォーカス・中を巻く・絞り込みと URL の復元・`?id=`・回帰・300人×60人の速さ（`PERF_MS_COMPAT` 既定 100ms。ならし3回のあと9回の中央値、超えたら最大3回りまで測り直し一番よい回りで比べる。PRD D253）。`scripts/e2e-words.cjs`：セルの記号の意味。

#### 完了の条件

- [ ] 列の見出しの名前が切れずに出る。見出し・行の名前を押すと詳細の吹き出しが出て、Esc・外を押す・もう一度押すで閉じ、フォーカスがボタンに戻る
- [ ] 列（特性のチップ・名前）と行（共通の欄＋相性のチップ）で絞り込め、再読込で戻る。0人なら「絞り込みを戻す」が出る
- [ ] `lib/compatView` のテストが通る。`scripts/e2e-compat.cjs` が全部通る（300人×60人でセルを1回押して描き終わるまで 100ms 以下）
