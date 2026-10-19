# ADR-0029：e2e を @playwright/test で包んで並列に走らせ、PR・夜間の CI で回す

- 状態：採用（2026-10-19）
- 関連：PRD D15、design.md §4 deploy、AGENTS.md のコマンド、ADR-0024〜0028（e2e で確かめる画面）

## 背景
本物のブラウザで確かめる e2e は `scripts/e2e-*.cjs` の21本（11,458行）と `scripts/lib/{tourSeen,confirmDialog}.cjs`。どれも手書きの Playwright のスクリプトで、`npx vite preview --port 4183` に向けて1本ずつ走らせ、`OK  `／`NG  ` の行と終了コードで結果を出す。Playwright は npm の依存に入れず、手元のものを使ってきた（e2e-drag の頭のコメントだけ。ADR は無い）。

調査（2026-10-19）：
- 1本ずつ順に走らせると合計 557秒。4本ずつ同時に走らせると 2.6倍速い（マシンは4コア）
- ほぼ全部のファイルに同じものが重なっている：Playwright の読み込み（21）・`check`（20）・`nextWednesdayNoonJst`（19）・NOW／TODAY の計算・BASE／OUT_DIR・終わり方
- e2e-address と e2e-compat はページの時計（`page.clock.setFixedTime`）を止めていない。ほかは止めている
- `PERF_MS` はスクリプトごとに既定が違う（compat・nav 100、progress 3000、vacancy-steps 5000）ので、1つの値をまとめて渡せない
- OUT_DIR を共有すると、12本が `fail-<名前>.png` を同じ名前で書く
- e2e-tour の「Space でファイルを選ぶ画面が開く」がまれに落ちる（filechooser の取りこぼし。走らせ直すと通る）
- CI（`deploy.yml`）は main への push で lint → vitest → build → Pages だけ。e2e は人が手元で走らせるだけで、PR では回っていない

制約：スクリプトの確かめの名前（AGENTS.md・ADR・design.md が引く）と確かめる中身は変えない。単独で `node scripts/e2e-*.cjs` も走らせ続けられること。外部送信・アプリの動きは変えない。

## 決定
`@playwright/test` を devDependency（`1.56.1` に固定。手元の playwright 1.56.1・chromium-1194 と同じ版）に入れ、今のスクリプトを包むランナーにする。段階を分けて移す。

- 段階0（共通化）：重なりを `scripts/lib/env.cjs` に寄せる（Playwright の読み込み・`launch`・BASE・OUT_DIR・FAKE_NOW・NOW・TODAY・`check`・`settle`・`hashOf`・`stored`・`failShot`・`run`／`finish`）。各スクリプトに固有の補助はそのまま。あわせて
  - e2e-address・e2e-compat もページの時計を止める
  - 速さの上限はスクリプトごとの名前 `PERF_MS_COMPAT`・`PERF_MS_NAV`・`PERF_MS_PROGRESS`・`PERF_MS_VACANCY`・`PERF_MS_DETAILS`（無ければ今までの `PERF_MS`）
  - 失敗のスクリーンショットは `<名前>-fail-<段階>.png`（OUT_DIR を共有してもぶつからない）
  - e2e-tour は filechooser の受け口をページを開いた直後に付ける（受け口を付けたときのブラウザへの横取りの頼みは待たずに送られるので、押す直前に付けると Space が先に届くことがある）
  - e2e-view・e2e-dialog・e2e-mobile・e2e-panel-foot の開き直しは about:blank を挟む（e2e-home と同じ）。同じ文書で `?id=` へ移してから読み直すと、読み直す前にアプリが `?id=` を URL から消し、欄が開かないことがある（e2e-view が並列でたびたび落ちて分かった）
- 段階1（包む）：`playwright.config.ts` と `e2e/legacy.spec.ts`。スクリプト1本を1つの test にし、子のプロセスで走らせて、終了コード 0 と `NG  ` の行が無いことで合否を決める。記録は test に添付する
  - `fullyParallel`・worker は手元4・CI 3。1本の時間切れは10分。CI は再試行1回・`test.only` を禁止
  - サイトは `BASE` があればそれ、無ければ webServer が `npm run build && npx vite preview --port 4183 --strictPort` で出す（手元は動いているものを使い回す）
  - 「今日」（`FAKE_NOW`）は設定ファイルで1回だけ決め、どの worker も同じ日にする
  - 速さを見る5本は `@perf` を付け、project `perf`（worker 1）で別に走らせる。ほかは project `e2e`
  - コマンド：`npm run e2e`・`npm run e2e:perf`・`npm run e2e:all`
- CI：`.github/workflows/e2e.yml` を PR・手動・夜間（03:00 日本時間）に走らせる。ビルドと `vite preview` はジョブで1回だけ行い、`BASE` を渡して `npm run e2e` のあと `npm run e2e:perf`（webServer は使わない）。夜間は `FAKE_NOW` を次の水曜・`2026-10-28T12:00+09:00`・`2026-10-31T12:00+09:00` の3通りで走らせる（月末）。報告（HTML）はいつも、test-results は失敗のときに残す。公開（`deploy.yml`）はまだ e2e を待たない
- 「Playwright を npm の依存に入れない」は、この決定で置き換える
- 段階2（このあと）：スクリプトの中を `test.step` と `expect.soft` に移し、確かめの1つずつを報告に出す（名前はそのまま）
- 段階3（このあと）：spec として書き直し、fixture（文脈・ツアーを見た扱い・確認ダイアログ・時計）にまとめる。`scripts/e2e-*.cjs` を消すのはここ

### 前のスクリプトと test の名前の対応
`npx playwright test --grep <名前>` で1本だけ走らせられる。

| スクリプト | test の名前（e2e/legacy.spec.ts） | project |
|---|---|---|
| scripts/e2e-absence.cjs | `e2e-absence.cjs` | e2e |
| scripts/e2e-address.cjs | `e2e-address.cjs` | e2e |
| scripts/e2e-compat.cjs | `e2e-compat.cjs @perf` | perf |
| scripts/e2e-details.cjs | `e2e-details.cjs @perf` | perf |
| scripts/e2e-details2.cjs | `e2e-details2.cjs` | e2e |
| scripts/e2e-dialog.cjs | `e2e-dialog.cjs` | e2e |
| scripts/e2e-drag.cjs | `e2e-drag.cjs` | e2e |
| scripts/e2e-features.cjs | `e2e-features.cjs` | e2e |
| scripts/e2e-home.cjs | `e2e-home.cjs` | e2e |
| scripts/e2e-links.cjs | `e2e-links.cjs` | e2e |
| scripts/e2e-mobile.cjs | `e2e-mobile.cjs` | e2e |
| scripts/e2e-nav.cjs | `e2e-nav.cjs @perf` | perf |
| scripts/e2e-panel-foot.cjs | `e2e-panel-foot.cjs` | e2e |
| scripts/e2e-plan-menu.cjs | `e2e-plan-menu.cjs` | e2e |
| scripts/e2e-progress.cjs | `e2e-progress.cjs @perf` | perf |
| scripts/e2e-rebuild.cjs | `e2e-rebuild.cjs` | e2e |
| scripts/e2e-tour.cjs | `e2e-tour.cjs` | e2e |
| scripts/e2e-vacancy-steps.cjs | `e2e-vacancy-steps.cjs @perf` | perf |
| scripts/e2e-view.cjs | `e2e-view.cjs` | e2e |
| scripts/e2e-week.cjs | `e2e-week.cjs` | e2e |
| scripts/e2e-words.cjs | `e2e-words.cjs` | e2e |

## 検討した案
| 案 | 長所 | 短所 | 採否 |
|---|---|---|---|
| 自前の並列ランナー（node で子のプロセスを4本ずつ） | 依存が増えない | 再試行・報告・時間切れ・CI の注記・webServer を自前で作り保つ | 不採用 |
| vitest の browser mode | テストの道具が1つ | 今のスクリプトは Playwright の API（mouse・clock・route・CDP）を直に使い、書き直しが大きい。複数の文脈・タブの扱いが弱い | 不採用 |
| Cypress | 画面で追いやすい | 1つのタブ・同じ源の制約で、別のタブの書き換え・filechooser・CDP の IME を確かめられない。全部書き直し | 不採用 |
| @playwright/test を依存に入れず、手元の外部パスで使う | npm の依存が増えない | CI で版がそろわない。設定・型が手元の場所に縛られる | 不採用 |
| devDependency にして段階的に移す | 今のスクリプトを1行も捨てずに並列・報告・CI が手に入る。版を lock で固定 | 段階1では1本＝1つの test なので、報告の粒度が粗い（記録の添付で補う） | 採用 |

## 結果・トレードオフ・見直す条件
- 得るもの：手元で `npm run e2e` の1つで、ビルドと配信から16本の並列までが走る。1本ずつ順に 557秒 → `npm run e2e`（ビルド込み）211秒＋`npm run e2e:perf`（ビルド込み）147秒（2026-10-19・4コア）。PR と夜間に CI で回り、月末の「今日」も夜間に確かめる。スクリプトの重なりが減り、`node scripts/e2e-*.cjs` の単独の実行も今どおり
- 失うもの：
  - devDependency が1つ増え、`npm ci` で入る（ブラウザは入れない。CI は `npx playwright install --with-deps chromium`）
  - 手元の playwright と devDependency の版をそろえ続ける（違うとブラウザの版が合わない）
  - CI の時間（PR ごとに数分〜十数分）
  - 速さの上限は CI で緩める（共有ランナーが遅いため。`PERF_MS_COMPAT`・`PERF_MS_NAV`・`PERF_MS_DETAILS` 300ms、`PERF_MS_PROGRESS` 6000ms、`PERF_MS_VACANCY` 10000ms。手元は既定の 100／3000／5000ms）。CI の perf は大きな遅れの検出だけで、細かな速さは手元で見る
  - 段階1の報告は1本単位。どの確かめが落ちたかは添付の記録の `NG  ` の行で見る
- 見直す条件：CI で同じスクリプトがたびたび落ちる（固定の待ちを目印の待ちに替える）。PR の CI が長すぎる（PR は `@perf` を外す・分ける）。e2e が安定したら公開（deploy.yml）の前に e2e を待たせる
- 影響：AGENTS.md のコマンド、design.md §4（pages の完了の条件・deploy）、PRD D15
