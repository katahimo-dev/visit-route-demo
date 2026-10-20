# 空き状況と問い合わせの試算

> この画面のファイル：`src/pages/VacancyPage.tsx`（`vacancy.css`）、`src/lib/vacancyView.ts`・`vacancyInput.ts`・`monthBatch.ts`（`missingDays`）・`glance.ts`・`tentative.ts`・`mail.ts`、`src/components/placeLookup.tsx`（`AddressField`）・`glance.tsx`・`conditions.tsx`。関連 ADR：0012 追記・0013・0015・0016 追記・0017・0025 追記・0042。関連 PRD：D45〜D47・D67・D78〜D81・D118〜D120・D184〜D187・D201〜D204・D221・D228・D258・D259。
> 計算（`vacancyOf`・`verdictOf`・`inquirySummary`・`vacancyNotice`）は design.md の「vacancy」。

### 空き状況（`#/vacancy`）

状態は画面の中（URL に書かない。データには保存しない）。入力はタブの間だけ覚える（下の「入力の保持」）。条件を変えると（300ms 間引き）`vacancyOf` を計算し直す。計算は vacancy の結果を読むだけ（vacancy は変えない）。

#### 段階（PRD D184）

段階の `section.card.vacancy-stage` を4つ並べる。段階の番号は `StepNo`。主ボタンは段階ごとに1つ（「要約をコピー」）。600px 以下は1段目の入力を2列。

| 段階 | 要素（data-testid） | 中身 |
|---|---|---|
| 1 いつ・何を | `vacancy-step-when` | 種類（選ぶと所要の初期値。選ばないときは「指定なし」。PRD D258）・所要・〈スタッフ〉の条件（`components/conditions.tsx` の1行のチェック表。例：性別）・見る週の数（1〜8、初期値4）・開始日（初期値：今日）・希望の曜日（複数）・希望の時間帯（開始〜終了）・週の回数 |
| 2 場所（任意） | `vacancy-step-place` | `details`。はじめ畳み、要約の行 `vacancy-place-line`（`placeLine`）・開く `vacancy-place-toggle`。summary の見出しは h2。中の `AddressField` は閉じても置いたまま |
| 3 受けられる曜日・時間帯 | `vacancy-table-card` | 見出しに「目安（移動を前後15分で見込む）」か「〈場所〉への移動を含む」・`vacancy-when-line`（`whenWhatLine`）・答えのカード `vacancy-answer`（1枚目。PRD D258）・案の無い日・条件が変わった日の注意 `vacancy-noplan`（［足りない案を作る（N日）］。PRD D259）・答える文（`inquiry-summary`）・曜日×週のマス（`InquiryWeeks`）・小見出し「曜日・開始時刻ごとの表」・凡例（1か所 `vacancy-legend`：印 `vacancy-mark-legend`・色 `level-legend`（`VACANCY_LEGEND`。「0人（受けられない）」は薄い灰）・数字の読み方と `Term`（`vacancyCount`、場所が無いときだけ `vacancyEstimate`））・表 |
| 4 次の一手 | `vacancy-step-next` | `inquiry-card`（主ボタン「要約をコピー」`copy-summary`・「仮の〈利用者さん〉として押さえる」`hold-open`・できないときの理由 `hold-why`）と `notice-card`（空き枠の案内文。`details`。見出しは h3） |

「開く ▾」「畳む ▴」は `FoldMark`（`aria-hidden`）。

#### 場所（PRD D118〜D120）

- 画面の状態に郵便番号つきの場所（`ClientPlace` の形に、ピンを置いたときの住所 `pinnedAddress` を足したもの）を持ち、`AddressField`（testId `vacancy`。注記の後ろは「条件などほかの項目は送りません」）
- `pinnedAddress` は位置が変わったときだけ `pinnedAddressAfter` で入れ替える
- `vacancyOf` などに渡すのは位置があるときの `pinnedAddress`・位置だけ（`Place`。位置が変わったときだけ計算し直す。郵便番号・住所を打っても計算し直さない）。見出し「〈住所〉への移動を含む」もこの住所
- 場所をあとから足すと表が移動を含む値に変わり、畳んでも残る
- 場所が無いと「場所を入れると、移動を含めて試算します」

#### 表

- 行＝曜日（月〜日）、列＝開始時刻（30分刻み。見出しに `data-start`＝`HH:MM`）
- 箱は `EdgeScroll`（`vacancy-scroll`。PRD D221）。狭い画面（600px 以下）では曜日の列を止め（行は7つなので見出しの行は止めない）、右に続きがあるあいだ右の端をぼかす（[pages.md](pages.md) の「狭い画面の表」）
- 狭い画面では、表がはじめに出たとき `NARROW_FIRST_START`（`09:00`。朝の早い列はたいてい × のため）の列が曜日の列のすぐ右に来るまで横に巻く（`scrollLeftToShow`）。1回だけで、条件を変えても人が巻いた位置のまま。その列が無い（希望の時間帯が 9:00 を含まない）ときは巻かない
- マス：段階の色 `lv-*`（`vacancyLevel`）と、`lib/vacancyView` の `cellFace` の印と下の小さい文字（○ は人数（目安は「約」）、△ は `weeksOk/weeksTotal`、×・？ は空。× に「約0」を出さない）。色だけに頼らない。読み上げの文も `cellFace`
- マスを押すと右の欄に日付ごとの人（名前）と入らない日付（灰の文字。赤にしない。PRD D228）。各行に `Link.vacancy-day-open`（`dayHref(日付)`。「その日の案を見る」・`data-date`・aria-label「その日の案を見る（M/D（曜）・日の予定で開く）」。Ctrl+クリック・中クリックで新しいタブ。`?date=` だけで開く）。名前の吹き出しは付けない
- 案の無い日の注意は答えのカードの下の1か所（`vacancy-noplan`：日数と日付（6日まで・ほか N日）・「表は「？」、案内文にも載せません」・条件が変わった日があれば「条件が変わった日が N日あります」・［足りない案を作る（N日）］）。案内文の下・日付ごとの欄は短い一言だけ

#### 答えのカード・凡例（PRD D258）

- 答えのカード `vacancy-answer`（`data-tone`＝`ok`／`partial`／`ng`／`unknown`。`lib/vacancyView` の `answerCard(result, wish)`）：大きい文字で「受けられます：火・木 10:00〜12:00 に 3人」。時刻は開始の時刻（○ の開始時刻を曜日ごとに続いた範囲に。同じ時間の曜日はまとめる）、人数はその ○ のマスのどの週でも受けられる人数の幅（目安は「約」）。○ の曜日が週の回数より少なければ「週N回には足りません」、○ が無く △ があれば「受けられない週があります」、どちらも無ければ「受けられません」、案が無く数えられなければ「案が無く数えられません」。下に短い補い。色は ok＝緑・partial＝黄・それ以外＝灰（赤にしない。PRD D228）。コピーする文は今どおり `inquiry-summary`（答える文）
- 凡例は表の上の1か所（`vacancy-legend`）：印（○△×？の見本と読み方）・色（人数の段階）・「○ の数字は受けられる人数」と、週ごとのマスも同じ印と色・行の頭は一番良い開始時刻・マスを押すと日付ごとの人。`InquiryWeeks` の下の説明は置かない

#### 足りない案を作る（PRD D259。ADR-0042）

- 対象：`missingDays(data, result.dates, today)`（見ている範囲の今日以降の、案の無い日（`empty`）と条件が変わった日（`stale`）。確定した日・手直しのある条件が変わった日は入れない）。0日ならボタンを出さず、案の無い日が今日より前だけなら［〈M〉月の予定を見る］（`vacancy-noplan-month`）
- ［足りない案を作る（N日）］（`vacancy-noplan-make`・`data-count`）で、月の予定へ移らずに `monthBatch.start`（名前は日付の月 `monthsLabel`、知らせの［月の予定を見る］は最初の日の月）。上の帯に進み具合と［止める］、作っている間は「案を作っています…」で押せない。ほかの作成が動いていれば「ほかの案を作っています。終わってから押してください」
- 作り終えるとデータが変わるので、結果は数え直す（今の条件のまま）

#### 入力の保持（PRD D258）

- `lib/vacancyInput.ts`：`loadVacancyInput(today)`・`saveVacancyInput(input)`。sessionStorage のキー `vrdemo:vacancy:input`（DemoData・書き出しの外）。覚えるのは種類・所要（入れかけの文字）・〈スタッフ〉の条件・場所（郵便番号・住所・位置・ピンの住所）・見る週の数・開始日・希望の曜日・時間帯・週の回数・案内文の期間と種類
- 項目ごとに形を確かめ、読めない項目だけ既定にする（壊れた文字は全部既定）。開始日が今日より前なら今日。書けなければ（容量・プライベート）何もしない
- 画面を移って戻る・読み直すと残る。タブ・ブラウザを閉じれば消える（新しいタブは既定）。開いた欄（日付ごとの人・仮押さえ）・紹介元の外した宛先は覚えない

#### 問い合わせの試算と曜日×週のマス

- 結果の要約（`inquirySummary`）と「要約をコピー」（`lib/clipboard` の `copyText`）
- 曜日×週のマス（`InquiryWeeks`。`lib/glance` の `inquiryRows`・`inquiryDayLevel`）：○ のあとに人数、行の頭に ○△×？と開始時刻
- 曜日を変えるとすぐ結果

#### 仮押さえ（PRD D47）

- 要約が ○ のとき「仮の〈利用者さん〉として押さえる」：表示名（必須）を入れ、選んだ曜日ごとの最初の ○ の開始時刻で定期パターン（種類・所要・開始日・週1）を作り、〈利用者さん〉（`tentative: true`、段階「相談受付」、場所、必要条件＝条件の欄）と一緒に1回の `update` で入れ、展開済みの範囲に `applyPatterns`
- 場所は今の住所・位置と、郵便番号を `normalizePostalCode` で直せれば写す。押さえる欄の注記は、場所が空なら「住所・位置はあとで」、住所があって位置が無ければ「位置はあとで」
- 〈利用者さん〉の画面と日の予定のカードに「仮」の印。〈利用者さん〉の画面の「本登録にする」「仮押さえを取り消す」は [pages-clients.md](pages-clients.md)

#### 空き枠の案内文（PRD D67）

- `notice-card`（`details`）。開いているとき（`noticeOpen`）だけ案内文を計算し、畳んだら捨てる（はじめ畳み、開くまで計算しない）。要約の行は `noticeLine`
- 期間（今週／来週／先4週。押して切り替えるボタンの組）・種類（選択。所要はその種類の標準、「指定なし」は上の条件の所要）。〈スタッフ〉の条件・場所は上の条件のまま
- 文（`vacancyNotice`）を読みやすく出し、通常のボタン「案内文をコピー」（`copyText`）
- 条件を変えてから計算し直すまで（`noticeStale`）はコピーを `disabled`・メールは理由付きで押せない
- 案内文の下に紹介元のチェック（外した宛先だけを画面の状態に）と「紹介元へメール（BCC N件）」（`MailButton`。`referrerRecipients`・`buildBccMails`・`vacancySubject`）

#### `lib/vacancyView.ts`（純粋関数。テストあり）

- `NARROW_FIRST_START`：狭い画面で表をはじめに見せる開始時刻（`09:00`。PRD D221）
- `cellFace(cell, exact, head)`：マスの印・下の小さい文字・読み上げの文
- `markLegend(exact)`：凡例の4つ。`VACANCY_MARK`・`VACANCY_MARK_TEXT`
- `placeLine`（場所の要約の行）・`noticeLine`（案内文の要約の行）・`whenWhatLine`（いつ・何をの1行。所要・時間帯が正しくなければその部分を「—」）。種類を選ばないときは「種類の指定なし」（`NO_TYPE_TEXT`＝「指定なし」）
- `answerCard(result, wish)`：答えのカードの色・答え・曜日と時間と人数・補い

#### 確かめ

`scripts/e2e-vacancy-steps.cjs`：段階の並び・開いて結果まで `PERF_MS_VACANCY`（既定 5000ms）・場所は畳む・主ボタン・案内文は開くまで計算しない・曜日を変えると結果・マスの読み方と用語・場所をあとから足すと表が変わり畳んでも残る・答えのカードが1枚目・凡例は1か所・「指定なし」・入力は画面を移って戻る・読み直すと残り新しいタブは既定・［足りない案を作る（2日）］で上の帯と知らせ・仮押さえ・390px。`scripts/e2e-words.cjs` の注意は1か所と［足りない案を作る（N日）］。`scripts/e2e-address.cjs` の空き状況（郵便番号・ピンのある住所で計算し直さない・ピンで見出しが切り替わる・仮押さえで郵便番号が入る）。`scripts/e2e-links.cjs` の日ごとの結果。

#### 完了の条件

- [ ] 種類・所要を選ぶと曜日×時刻の表が出て、場所を入れると「移動を含む」になる。マスを押すと日付ごとの人が出る。試算の要約が出てコピーできる
- [ ] 仮押さえで〈利用者さん〉（仮）と定期パターンができ、展開された訪問が日の予定に「仮」の印で出る。取り消すと消える
- [ ] 期間・種類を選ぶと案内文が出てコピーできる
- [ ] 答えのカードが結果の1枚目に出て、凡例は1か所。入力は画面を移って戻っても残る。［足りない案を作る（N日）］でその場で案ができ、結果が数え直される
- [ ] `lib/vacancyView`・`lib/vacancyInput`・`lib/monthBatch`・`lib/glance` のテストが通る
