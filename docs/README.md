# docs の索引

AI・人が「何を知りたいときに、どのファイルを読むか」を選ぶための地図。全部を読まず、該当するファイル・節だけ読む。

- どの文書も**今の仕様だけ**を書く。変更の経緯は git のコミット、判断の理由は ADR にある
- 食い違ったら：契約は `src/contracts/`、要件は `prd.md`、設計は `design.md`（＋ `design/`）が正

## 目的別

| 知りたいこと | 読むファイル |
|---|---|
| 作業のルール・コマンド・ディレクトリ構成 | [../AGENTS.md](../AGENTS.md) |
| 何を作るか・やらないこと・D番号の要件 | [prd.md](prd.md)（§3 冒頭のテーマ別索引から該当の表だけ） |
| 全体図・コンポーネントの責務・データの持ち主 | [design.md](design.md) §3・§4 |
| 型・データの版・エラー・費用の物差し（契約） | [design.md](design.md) §5 と `src/contracts/` |
| 画面の仕様（ルート・部品・文言・data-testid） | [design/pages.md](design/pages.md) のルート一覧 → 画面別の `design/pages-*.md` |
| なぜその案にしたか・捨てた案 | [adr/](adr/)（下の一覧） |
| まだ決まっていないこと | [design.md](design.md) §8・[prd.md](prd.md) §8 |
| 焼きなまし法と OR-Tools の比較の実測 | [optimization-benchmark.md](optimization-benchmark.md) |

## 画面別の設計（design/）

| ファイル | 中身 |
|---|---|
| [pages.md](design/pages.md) | 共通事項（〈スタッフ〉の印を含む）・ルート一覧・メニュー・下のタブ・設定のタブ・コマンドパレット・確認ダイアログ・機能の入り切り（画面側） |
| [pages-common.md](design/pages-common.md) | 右の欄・訪問の詳細の欄（VisitPanel・visitOps）・名前の詳細の吹き出し・用語・ツアー・作り直しの帯・リンク・メール・道順 |
| [pages-bars.md](design/pages-bars.md) | 3段の時間帯のバー・ひと目で分かる表示（月・週・日・空き状況・稼働で共通） |
| [pages-home.md](design/pages-home.md) | ホーム（今日やること） |
| [pages-plan.md](design/pages-plan.md) | 日の予定（予定と AI案・手直し・確定） |
| [pages-plan-absence.md](design/pages-plan-absence.md) | 欠勤・キャンセル・振り直し（案A・案B）・連絡の一覧 |
| [pages-month.md](design/pages-month.md) | 月の予定・まとめて作る・まとめて確定・希望休・印刷 |
| [pages-week.md](design/pages-week.md) | 週の予定 |
| [pages-vacancy.md](design/pages-vacancy.md) | 空き状況・問い合わせの試算・案内文 |
| [pages-clients.md](design/pages-clients.md) | 〈利用者さん〉の一覧・〈利用者さん〉と〈スタッフ〉の画面（タブ・予定のカレンダー・節）・住所の入力・絞り込み |
| [pages-compat.md](design/pages-compat.md) | 相性の表 |
| [pages-staff.md](design/pages-staff.md) | 〈スタッフ〉の一覧と画面・勤務時間（シフト）・勤務の見込み・スマホ画面 |
| [pages-rules.md](design/pages-rules.md) | 条件・プリセット・訪問の種類・項目・案の比較 |
| [pages-data.md](design/pages-data.md) | データ（控え・直前の状態・Excel・初期化・片づけ・データを守る知らせ）・管理者設定 |

## ADR 一覧

| 番号 | 決めたこと |
|---|---|
| [0001](adr/0001-browser-only-github-pages.md) | ブラウザ完結の静的サイト・GitHub Pages |
| [0002](adr/0002-flexible-matching-rules.md) | 相性・特性・希望を「項目＋条件の型＋重み0〜5＋必須」で表す |
| [0003](adr/0003-js-annealing-solver.md) | 最適化は Web Worker 上の焼きなまし |
| [0004](adr/0004-ai-plan-as-base-with-pins.md) | AI案を土台に手直し・固定 |
| [0005](adr/0005-compare-ai-runs-by-parameters.md) | 条件を変えた AI案の記録どうしで比べる |
| [0006](adr/0006-excel-template-import-export.md) | Excel の書き出し・読み込み |
| [0007](adr/0007-score-out-of-100.md) | 点数を100点満点で見せる |
| [0008](adr/0008-editable-presets-auto-runs.md) | プリセットを編集でき、開いた日に全プリセットで案を作る |
| [0009](adr/0009-merge-schedule-and-plan.md) | 予定と AI案を1画面に統合 |
| [0010](adr/0010-score-ruler-fixed.md) | 点数の物差しを「点数の基準」で固定 |
| [0011](adr/0011-same-day-absence-reassign.md) | 当日の欠勤の振り直し |
| [0012](adr/0012-monthly-plan-patterns-visit-types.md) | 訪問の種類・定期パターン・月まとめ・空き状況 |
| [0013](adr/0013-monthly-nth-weekday-client-leaves-visit-notes-vacancy-notice.md) | 第N曜日・〈利用者さん〉の休み・決まりごと・空き枠の案内文 |
| [0014](adr/0014-allowed-staff-requested-off-month-print.md) | 担当を限る・希望休・月の予定の印刷 |
| [0015](adr/0015-offboarding-workload-client-stage-same-day-cancel.md) | 退職の振り直し・稼働の見込み・段階・当日キャンセル |
| [0016](adr/0016-postal-code-and-address-search.md) | 郵便番号・住所の検索（押したときだけ外部へ） |
| [0017](adr/0017-mail-via-mailto.md) | メールは mailto: で開くだけ |
| [0018](adr/0018-google-maps-route-links.md) | 道順は Google マップのリンク |
| [0019](adr/0019-nav-grouped-by-person.md) | メニューを人ごとにまとめる |
| [0020](adr/0020-roster-excel-import-export.md) | Excel の名簿で足す・直す |
| [0021](adr/0021-client-filter-area.md) | 〈利用者さん〉の絞り込みと地区 |
| [0022](adr/0022-compat-page-details-and-filters.md) | 詳細の吹き出しと列・行の絞り込み |
| [0023](adr/0023-view-mode-before-edit.md) | 編集の前に閲覧の欄で開く（廃止。ADR-0052 で置き換え） |
| [0024](adr/0024-mobile-nav-and-week-client-default.md) | スマホのメニュー・週の時間軸の初期値 |
| [0025](adr/0025-task-first-navigation-home.md) | やりたいことから入る導線・ホーム |
| [0026](adr/0026-custom-confirm-dialog.md) | 独自の確認ダイアログ |
| [0027](adr/0027-task-ordered-menu-command-palette.md) | 用途順のメニュー・コマンドパレット |
| [0028](adr/0028-feature-toggles-by-admin.md) | 管理者設定で機能を入り切り |
| [0029](adr/0029-e2e-playwright-test-runner-ci.md) | e2e を @playwright/test で包み、PR・夜間の CI で回す |
| [0030](adr/0030-reassign-and-undo-without-drag.md) | 担当替え・戻すをドラッグ以外でも（キーボード・タッチ） |
| [0031](adr/0031-month-bulk-confirm-and-seed-plans.md) | 月のまとめて確定と初期データの案 |
| [0032](adr/0032-protect-data.md) | データを守る（1世代の控え・書き出しの知らせ・古い案の片づけ・壊れたデータと別のタブの知らせ） |
| [0033](adr/0033-narrow-tables-as-cards.md) | 狭い画面では一覧の表をカードに（ADR-0024 の見直し） |
| [0034](adr/0034-screen-names-and-five-menu-groups.md) | 画面名をメニューの名前に・欠勤の入口の呼び名・メニューの5つのグループ・下のタブの「今日」 |
| [0035](adr/0035-rules-page-edits-score-basis.md) | 条件の重みの画面＝点数の基準（ふだんの考え方）を直す画面・日の重みは「この日だけ試す重み」 |
| [0036](adr/0036-page-header-and-button-tiers.md) | 画面の見出しの型（題名・1行の説明・主ボタン1つ・予定のタブ）・ボタンの3段（塗り・枠・文字）・日の予定の上の段・左のメニューの間隔 |
| [0037](adr/0037-term-hint-info-icon.md) | 用語の説明の目印を ⓘ に・同じ語の説明は1画面で1か所 |
| [0038](adr/0038-sudden-contact-step.md) | 欠勤・キャンセルの欄に5段目「連絡」・連絡文のひな形と載せる範囲・スマホのホームの先頭に入口 |
| [0039](adr/0039-split-heavy-pages-and-map.md) | 重い画面と地図を別のチャンクに分ける・計算の進み具合は外の入れ物で子だけ描き直す |
| [0041](adr/0041-e2e-steps-soft-checks-web-first-waits.md) | e2e の段階2：段を test.step・確かめを expect.soft・trace と動画・待ちを画面の状態で・相性の速さの測り方・vitest の揺れ・競合の印の検査 |
| [0042](adr/0042-month-batch-outside-page.md) | 月のまとめて作るの計算を画面の外（モジュールの入れ物）で回す・画面を移っても続ける |
| [0043](adr/0043-manual-assignment-memory.md) | 手直しの記憶：手で選んだ担当を、確認して同じ曜日・同じ時間の次の案でも固定する（来週以降もまとめて変える） |
| [0044](adr/0044-next-step-first-and-show-result.md) | 次の一手を1つに絞り結果を見せる（第1弾）：ホームの並びを作業の順・先頭の「まずこれ」、欠勤の主ボタン1つ・担当が移る訪問の一覧、点数の色、日付の選択を出す画面、知らせ・時間軸・左のメニュー・条件の名前・狭い表 |
| [0045](adr/0045-show-less-menu-settings-tour.md) | 見せる量を減らす（第2弾）：初めて開いたときは「基本」と1問、メニューを8項目（予定・設定はタブで切り替え）、下のタブにメニュー、ツアー3枚、月・日の操作の行の「その他 ▾」 |
| [0046](adr/0046-week-make-confirm-attention-unmade.md) | 週の範囲で作る・確定（第3弾）：週の主ボタンを作る → 確定 → 済みの1つに（月まとめの入れ物で範囲を週に）、確定済みで手当ての要らない欠勤を要対応に数えない、まだ作っていない日を「未作成」と出す |
| [0047](adr/0047-compat-to-people-settings-order.md) | 相性を設定から「人」へ移し（メニューは9項目）、設定のタブの先頭を訪問の種類にして条件の重みを奥へ。〈利用者さん〉一覧・〈スタッフ〉一覧から「相性の表」へ文字ボタン（ADR-0045 の設定のタブを見直す） |
| [0048](adr/0048-rules-weight-draft-and-confirm.md) | 条件の重みの表を下書きにし、違う行に色と「変更あり」、「変更を確定」と確認（変わる重み・影響する日）のあとで保存・下書きのまま離れるときは確認 |
| [0049](adr/0049-condition-changes-and-revert.md) | 作り直しの帯に「何が変わったか」と「戻す」：最後に影響する日が0日だった時点の条件を DemoData の外に1つ控えて今と比べる（控えが無ければ作ったときの重みだけ） |
| [0050](adr/0050-staff-mark-and-icon.md) | 〈スタッフ〉の印を1つの部品 StaffMark（その人の色の角の丸い四角に1〜2文字。〈利用者さん〉は丸）にそろえ、任意のアイコン `Staff.icon`（1〜2文字・既定は苗字の最初の1文字）を足す |
| [0051](adr/0051-visit-panel-and-ux-stages.md) | 訪問の確認・編集の見直しを5段で進める（ユーザーの決めた5つ＋ホーム・パレット）。1段目は訪問の詳細の欄 `VisitPanel` を1つにし、日時・担当・取り消し・範囲（この回だけ／これ以降／すべて）を `lib/visitOps` 越しに扱う |
| [0052](adr/0052-person-page-schedule-and-sections.md) | 〈利用者さん〉・〈スタッフ〉の画面を全画面（`#/clients/:id`・`#/staff/:id`）にし、タブ（先頭は予定）・予定のカレンダー（回から訪問の詳細の欄・空き枠から足す・ドラッグで動かす・繰り返しの強調）・節ごとの「直す → 保存」にする（ADR-0023 の閲覧・編集のモードを置き換え） |

## 文書の保ち方

`.claude/skills/solo-architecture-design/` の「設計書を育てる」に従う。追記を重ねず該当の節を書き直す・大きくなったら `design/` に分ける・実装が終わった作業指示書は残さない。
検査：`python3 .claude/skills/solo-architecture-design/scripts/check_design.py docs/design.md`
