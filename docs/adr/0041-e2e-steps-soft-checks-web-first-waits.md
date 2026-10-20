# ADR-0041：e2e の段階2（段を test.step・確かめを expect.soft・待ちを画面の状態で）と、テストの揺れを止める

- 日付：2026-10-20
- 状態：採用
- 関連：PRD D253・D254、ADR-0029（段階1・この段階2の予定）、AGENTS.md のコマンド、design.md §4 deploy

## 背景
ADR-0029 の段階1は、スクリプト1本を1つの test にして子のプロセスで走らせ、終了コードと `NG  ` の行で合否を決めていた。困っていたこと：

- 報告が1本単位。どの確かめが落ちたかは添付の記録を開かないと分からない。trace・動画も無い（子のプロセスのブラウザは @playwright/test の外）
- 固定の待ち（`waitForTimeout` と `settle`）が約390か所・合わせて約130秒。速いときは無駄で、負荷のあるときは足りずに落ちる
- 相性の画面の速さの関門（300人×60人でセルを1回押して描き終わるまで中央値 100ms 以下）が、負荷のあるときに 101〜124ms で落ちることがあった
- `npm test`（vitest）が負荷のあるときに `Timeout calling "onTaskUpdate"` で、全部通っても終了コード1になった
- main に競合の印（`<<<<<<<`）がコミットされる事故があった

制約：確かめの名前（check の文字）は変えない。`node scripts/e2e-xxx.cjs` の単独の実行も今どおり。並行する PR がスクリプトに段・確かめを足し続けるので、書き換えは機械的で再現しやすい形にする。

## 選択肢
1. 案A：スクリプトを spec に書き直す（段階3を前倒し）
2. 案B：スクリプトは残し、段（`[名前, 関数]` の並び）を出させて、包みが同じプロセスで test.step で回す。確かめは共通の部品の差し込み口から expect.soft に写す
3. 案C：段階1のまま、記録の `NG  ` の行を報告の注記に出すだけ

待ちについて：
1. 案a：1か所ずつ目印（locator の waitFor・expect.poll）に書き換える
2. 案b：共通の `settle` を「画面が落ち着くまで」（描画・DOM の変化・期限の近いタイマー）の待ちに替え、固定の `waitForTimeout` を機械的に `settle` に寄せる。意味が時間そのものの所だけ固定のまま残す

## 決定
案B と案b。

- 段の型（`scripts/lib/steps.cjs`）：スクリプトは `module.exports = { steps }` を出し、末尾に `if (require.main === module) runSteps(steps)`。型は3つ
  - `sharedPage({ open, steps, after, call })`：1つのページを段で使い回す（多くのスクリプト）。準備（`openPage`：文脈・ツアーを見た扱い・時計・ページのエラー）→ 段 → 後始末
  - `pagePerStep({ open, steps, label, after, end })`：段ごとに新しい文脈（段の名前は関数の名前）
  - `guard(fn, { label, info, page, shot })`：段の中で投げたら、今までの try/catch と同じ文の確かめ（NG）とスクリーンショット。続きの段は走る（準備だけは投げたら止める）
- 包み（`e2e/legacy.spec.ts`）：test ごとに `scripts/` の読み込みを消して読み直し（数え・状態を持ち越さない）、段を `test.step` で回す。`check` は `hooks.onCheck` から `expect.soft(ok, 名前  情報)` に写す。ページのエラーも expect.soft。console の出力は記録（`<名前>.log`）に移して添付し、落ちたら `-fail-` のスクリーンショットも添付。`steps` を出していないスクリプト（段階1の形）は今までどおり子のプロセスで走らせる
- trace・動画：`use` に `trace: 'retain-on-failure'`・`video: 'retain-on-failure'`。スクリプトの Playwright は @playwright/test と同じもの（playwright-core）なので、スクリプトが開いた文脈にも trace が付く。動画は `launch` が `newContext`・`newPage` に `recordVideo` を足す（`hooks.videoDir`）。project `perf` は記録の手間で計測が揺れるので両方とも取らない。`actionTimeout`・`navigationTimeout` は単独の実行と同じ 30秒（test の中の既定は「無し」で、固まった段が次へ進まない）。CI は落ちたとき `test-results/`（trace.zip・動画・スクリーンショット・記録）を成果物に残す（前から）
- 待ち（`settle(page, ms)`）：2回の描画のあと、DOM の変化が 50ms 続けて無く、期限が 1秒以内のタイマーが残っていないこと（最長 max(3×ms, 1500ms)）。タイマーはページに入れる包み（`trackTimers`。`page.clock` があとから差し替えても通る getter・setter）で数える。入力の間引き（300ms）・保存（300ms）・吹き出しの出し入れ・作り直しの帯の数え直し（600ms）・空き状況の計算の間引きを待てる。ページが移っている最中なら読み込みを待ってもう1回。裏のタブでは描画が来ないので 100ms で先へ。固定の `waitForTimeout` は全部 `settle` に寄せた（約190か所）。固定のまま残したのは
  - 速さの計測の条件（compat・nav の計測の前の落ち着き、details の計測の合間、compat の回りの合間）
  - 偽の検索サービスの遅れ（Node の側の delay）を待つ所（e2e-address の races）。ページのタイマーにも DOM にも出ない
  - 時間そのものを見る所（e2e-rebuild の「間引きの途中は数え直さない」、e2e-dialog の「開いてすぐのクリックは無視」）
  - 巻く動き（smooth）は DOM を変えないので、目印（`until`：条件が真になるまで待つ）で待つ（e2e-tour の「今日へ」）
- 相性の速さの関門（e2e-compat）：ならし3回（JIT・GC の立ち上がり）のあと9回の中央値。上限を超えたら1秒置いて最大3回りまで測り直し、一番よい回りの中央値で比べる。押す前に1フレーム置き、前の回の描画を持ち込まない。上限は手元 100ms・CI 300ms のまま
- vitest：各 test の前にイベントループを1回まわす（`src/testSetup.ts`・`setImmediate`）。同期の重い test が Promise だけでつながると、worker が親からの返事（IPC）を読まず、60秒で `onTaskUpdate` が時間切れになる。あわせて AI案と素朴な案の比べ（evaluate/naive.test.ts。1つの test で14日×3プリセット・負荷時 60秒超）を日ごとの test に分け、`testTimeout`・`hookTimeout` は 60秒
- 競合の印：`scripts/check-conflict-markers.cjs`（git が管理する文字のファイルの行頭の `<<<<<<< `・`>>>>>>> `）。`npm run lint` の最後と e2e.yml（PR）の先頭で走らせる。`=======` は Markdown の見出しの下線にも使うので見ない

### 調べたこと（2026-10-20・4コア）
- 相性の速さ：負荷の無いとき 1回 60〜85ms。最初の数回は 90〜140ms（JIT・GC）。e2e の16本（worker 2）と同時に測ると、前の測り方（ならし無し・7回の中央値）は3回のうち2回落ちた（中央値 121・110ms）。新しい測り方は3回とも通った（93・100・99ms。どれも回りを足して一番よい回り）。CPU を使い切る負荷（node のスレッド 8本）だけでは落ちない（Chromium の描画のスレッドも取り分がある）ので、落ちる原因は「同時に動く Chromium と、ならしの回の遅さ・7回という少なさ」。CDP の ThreadTime（CPU 時間）は壁時計の時間とほぼ同じで、CPU 時間で測っても負荷の揺れは消えない
- vitest：`evaluate/naive.test.ts` の1つの test が 55秒（負荷のとき 62秒超）。test の合間は Promise だけでつながるので、worker は親からの返事を読めず、ファイル全体が 60秒を超えると時間切れになる。日ごとに分けただけでは消えず（負荷 9 で再現）、各 test の前に `setImmediate` を1回待つと、負荷 13 でも終了コード0
- e2e の時間（16本・worker 2・負荷の無いとき）：段階1 5.1分 → 段階2（trace・動画あり）6.2分、trace だけ切ると 5.1分、両方切ると 5.2分。trace の記録が約2割。`settle` は待った時間の合計が前の固定の待ちとほぼ同じ（e2e-features：前 20.7秒 → 22.0秒。最短は約110ms、保存の間引き 300ms を待つ所が多い）で、速さより「足りずに落ちる」を減らす効き目

## 理由とトレードオフ
- 得るもの：
  - 報告で段ごと・確かめごとに合否と情報が見え、落ちた test に trace・動画・スクリーンショット・記録が付く
  - 書き換えは各スクリプトの末尾（段の並び）と `waitForTimeout` → `settle` だけ。あとから main に入る段・確かめも同じ型（並びに1行・`settle`）でそろえられる
  - 待ちが画面の状態に合い、負荷のあるときに足りずに落ちる所が減る
  - 相性の関門は、負荷の回りを外しつつ、遅くなったコード（どの回りも遅い）は落とす
  - vitest の終了コードが負荷で揺れない
- 失うもの：
  - スクリプトは包みと同じプロセスで動くので、共通の部品（env.cjs）の状態は test ごとに読み直して捨てる前提になる（require の cache を消す）
  - trace を取るぶん e2e が遅くなる（記録のスナップショット）
  - `settle` は Worker の計算（AI案を作る）・ネットワークの遅れ・CSS の動きは待てない。その所は目印で待つ
  - ページの setTimeout を包む（アプリの動きは変えないが、計測の文脈にも入る。手間は小さい）

## 影響
- AGENTS.md の e2e の節、design.md §4 deploy、PRD D253・D254
- 見直す条件：`E2E_SETTLE_LOG=1` で「最長まで待っても落ち着かない」所が増えたら、その所は目印の待ちに替える。trace で e2e が長くなりすぎたら `on-first-retry` に替える。段階3（spec に書き直し・fixture）でスクリプトと段の型を消す
