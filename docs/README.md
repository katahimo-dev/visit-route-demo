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
| [pages.md](design/pages.md) | 共通事項・ルート一覧・メニュー・コマンドパレット・確認ダイアログ・機能の入り切り（画面側） |
| [pages-common.md](design/pages-common.md) | 右の欄・名前の詳細の吹き出し・用語・ツアー・作り直しの帯・リンク・メール・道順 |
| [pages-bars.md](design/pages-bars.md) | 3段の時間帯のバー・ひと目で分かる表示（月・週・日・空き状況・稼働で共通） |
| [pages-home.md](design/pages-home.md) | ホーム「今日やること」 |
| [pages-plan.md](design/pages-plan.md) | 日の画面（予定と AI案・手直し・確定） |
| [pages-plan-absence.md](design/pages-plan-absence.md) | 欠勤・キャンセル・振り直し（案A・案B）・連絡の一覧 |
| [pages-month.md](design/pages-month.md) | 月の予定・まとめて作る・希望休・印刷 |
| [pages-week.md](design/pages-week.md) | 週の予定 |
| [pages-vacancy.md](design/pages-vacancy.md) | 空き状況・問い合わせの試算・案内文 |
| [pages-clients.md](design/pages-clients.md) | 〈利用者さん〉の一覧・閲覧・編集・住所の入力・絞り込み |
| [pages-compat.md](design/pages-compat.md) | 相性の表 |
| [pages-staff.md](design/pages-staff.md) | 〈スタッフ〉・稼働時間・稼働の見込み・スマホ画面 |
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
| [0023](adr/0023-view-mode-before-edit.md) | 編集の前に閲覧の欄で開く |
| [0024](adr/0024-mobile-nav-and-week-client-default.md) | スマホのメニュー・週の時間軸の初期値 |
| [0025](adr/0025-task-first-navigation-home.md) | やりたいことから入る導線・ホーム |
| [0026](adr/0026-custom-confirm-dialog.md) | 独自の確認ダイアログ |
| [0027](adr/0027-task-ordered-menu-command-palette.md) | 用途順のメニュー・コマンドパレット |
| [0028](adr/0028-feature-toggles-by-admin.md) | 管理者設定で機能を入り切り |
| [0029](adr/0029-e2e-playwright-test-runner-ci.md) | e2e を @playwright/test で包み、PR・夜間の CI で回す |
| [0030](adr/0030-reassign-and-undo-without-drag.md) | 担当替え・戻すをドラッグ以外でも（キーボード・タッチ） |
| [0032](adr/0032-protect-data.md) | データを守る（1世代の控え・書き出しの知らせ・古い案の片づけ・壊れたデータと別のタブの知らせ） |

## 文書の保ち方

`.claude/skills/solo-architecture-design/` の「設計書を育てる」に従う。追記を重ねず該当の節を書き直す・大きくなったら `design/` に分ける・実装が終わった作業指示書は残さない。
検査：`python3 .claude/skills/solo-architecture-design/scripts/check_design.py docs/design.md`
