# 作業指示書：欠勤の振り直しの2回目（案B「少し動かしてよい」・連絡の一覧。PRD D34・D35。ADR-0011 追記）

## 0. 今回の作業
2026-10-14 に設計の確定から実装まで同じ作業で行った（記録のための指示書）。前からある機能（案A・候補・差・元の案に戻す）は壊さない。

- 参照：`docs/prd.md` D34・D35、`docs/design.md` §4（matching・solver・evaluate・reassign・pages の「2回目」）・§5「欠勤の振り直し：2回目」・費用の物差し・§7・§8、`docs/adr/0011-same-day-absence-reassign.md` の追記
- 乱数・`Date.now`・`Math.random` を solver・matching・reassign に入れない（画面の `createdAt` だけ）

## 1. 担当範囲
| コンポーネント | ファイル | やること |
|---|---|---|
| contracts | `src/contracts/problem.ts`・`reassign.ts`・`data.ts` | `Problem.stay`・`ProblemStay`、`SolveOptions.initial`、案B と連絡の一覧の型・定数、`ReassignInfo.method: 'insert' \| 'anneal'`・`stayWeight`・`insertRoutes` |
| matching | `src/matching/timing.ts` | `routeCost` に stay の減点（`scheduleRoute` は変えない） |
| solver | `src/solver/anneal.ts` | `initial` を初期解の候補に（可・strict・件数の上限を守るときだけ。高くなければ使う） |
| reassign | `src/reassign/index.ts` | `stayPointsOf`・`prepareAnneal`・`finishAnneal`・`annealCost`・`contactsOf` |
| store | `src/store/repair.ts` | `insertRoutes` を routes と同じ規則で直す |
| pages | `src/lib/absences.ts`（`applyReassign` が `insertRoutes` を残す・`chooseReassign`）・`src/lib/runs.ts`（`findRun` が方法・重みも比べる）・`src/lib/contacts.ts`（連絡文）・`src/pages/reassignParts.tsx`（`AnnealBox`・`ContactPanel`）・`absenceParts.tsx`・`PlanPage.tsx`・`ComparePage.tsx`・`plan.css`（印刷） | design.md §4 pages の「2回目」 |

触ってはいけない範囲：evaluate（採点に減点を入れない）、excel、seed、domain。

## 2. 守るべき契約
design.md §5「欠勤の振り直し：2回目（案B・連絡の一覧）」と、§5「欠勤と振り直し」の `reassignInfoSchema`。型の正は `src/contracts/`。

## 3. ルール
AGENTS.md（主ボタンは1画面1〜2個・オレンジ、呼び方は `org.terms`、外部送信なし、コメント・文言は日本語）。

## 4. 完了の条件
- design.md §4 solver・reassign・pages の「（2回目）」「（ADR-0011 追記）」の完了の条件
- `npm run typecheck`・`npx biome check src`・`npx vitest run`・`python3 .claude/skills/solo-architecture-design/scripts/check_design.py docs/design.md` が通る
- 画面：終日欠勤で案A に入らない訪問が出る日に、案B（進み具合 → 案A と比べて選ぶ）、「変更を減らす」を強めると変更が減る、連絡の一覧と連絡文のコピー、比較の画面で 欠勤前／案A／案B
