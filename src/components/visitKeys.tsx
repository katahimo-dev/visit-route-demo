// 訪問の帯をキーボードで動かす（PRD D333・D340。ADR-0055・ADR-0056）の画面の部品：帯の keydown を受けるフック useVisitKeys と、
// 動かした先の読み上げ・繰り返しの回の範囲を選び直す小さな帯 KeyMoveBand（日の予定・週の予定・月の予定・人の予定表に置く）。
// どの操作も store の update を1回（手の名前つき）で、全体の「元に戻す」で1手戻る
import { Repeat, X } from 'lucide-react';
import { useCallback, useRef } from 'react';
import type { DemoData } from '../contracts/data';
import { jstDate } from '../domain/time';
import { dateText, newId } from '../lib/common';
import { appHistory } from '../lib/history';
import { createValueStore, useValueStore } from '../lib/valueStore';
import {
  issuesAt,
  type KeyLayout,
  keyMove,
  movedText,
  moveLabel,
  nextStaffFor,
  type VisitMove,
  visitKeyOf,
} from '../lib/visitKeys';
import { cancelVisitOp, SCOPE_LABELS, toldDaysChanged, type VisitScope } from '../lib/visitOps';
import { findVisit } from '../patterns';
import { useDemoData } from '../store';
import { useConfirm } from './ConfirmDialog';
import { useToast } from './Toast';
import { WithIcon } from './ui';
import { useUndoAction } from './undo';

/** 最後にキーで動かした手（範囲を選び直す帯が読む。画面の状態だけ） */
type KeyMoveNote = {
  seq: number;
  before: DemoData;
  after: DemoData;
  visitId: string;
  move: VisitMove;
  label: string;
  repeating: boolean;
  scope: VisitScope;
  clientName: string;
};

/** 最後にキーで動かした手 */
const lastMove = createValueStore<KeyMoveNote | null>(null);
/** 読み上げの文（同じ文でも読み直すよう、番号を付ける） */
const announceStore = createValueStore<{ seq: number; text: string } | null>(null);
let seq = 0;

/** 読み上げる（帯の role="status" に入れる） */
export function announceMove(text: string) {
  seq += 1;
  announceStore.set({ seq, text });
}

/**
 * 帯の keydown を受ける（当たったキーなら true を返し、既定の動きを止める）。
 * staffOrder は隣の担当を選ぶ並び（日の予定は列の順、週の予定は利用中の〈スタッフ〉の順）。onOpen は Enter（訪問の詳細の欄）、
 * onMoved は動かしたあと（日の予定は日付を移ってフォーカスを帯に戻す）、onCancelled は取り消したあと（フォーカスの置き場所）
 */
export function useVisitKeys(opts: {
  staffOrder: (visitId: string) => readonly string[];
  /** 日時を動かす（↑↓←→）か。〈スタッフ〉の画面など動かさない所は false（Shift+←→・Enter・Delete だけ） */
  move?: boolean;
  /** 札の入れ物（表は ↑↓ で隣の担当の行。PRD D342）。既定は時間軸 */
  layout?: KeyLayout;
  onOpen?: (visitId: string) => void;
  onMoved?: (r: { visitId: string; date: string }) => void;
  onCancelled?: (visitId: string) => void;
}) {
  const { data, update } = useDemoData();
  const latest = useRef(data);
  latest.current = data;
  const confirm = useConfirm();
  const toast = useToast();
  const undoAction = useUndoAction();
  const optsRef = useRef(opts);
  optsRef.current = opts;
  return useCallback(
    (
      e: {
        key: string;
        shiftKey: boolean;
        ctrlKey: boolean;
        metaKey: boolean;
        altKey: boolean;
        preventDefault(): void;
      },
      visitId: string,
    ): boolean => {
      // Alt+↓：繰り返しの回の範囲の帯が出ていれば、その先頭のボタンへ（帯は画面の下に浮いていてフォーカスの順が遠い）
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowDown') {
        const first = document.querySelector<HTMLElement>('[data-testid="key-scope-following"]');
        if (!first) return false;
        e.preventDefault();
        first.focus();
        return true;
      }
      const o = optsRef.current;
      const k = visitKeyOf(e, o.layout);
      if (!k) return false;
      if (o.move === false && (k.kind === 'time' || k.kind === 'day')) return false;
      if (k.kind === 'open') {
        if (!o.onOpen) return false;
        e.preventDefault();
        o.onOpen(visitId);
        return true;
      }
      e.preventDefault();
      const d = latest.current;
      const v = findVisit(d, visitId);
      if (!v) return true;
      const today = jstDate(Date.now());
      const clientName = d.clients.find((c) => c.id === v.clientId)?.displayName ?? '（不明）';
      const staffName = (id: string) => d.staff.find((s) => s.id === id)?.name ?? '（不明）';
      // できない理由は知らせ（トーストは output なので読み上げも1回）
      const fail = (why: string) => toast(`動かせません：${why}`);
      if (k.kind === 'cancel') {
        if (v.cancelled) return true;
        if (v.date < today) {
          fail('今日より前の訪問です');
          return true;
        }
        void (async () => {
          const ok = await confirm({
            title: 'この訪問を取り消しますか？',
            body: `${clientName}さん ${dateText(v.date)} ${v.earliestStart}。「元に戻す」（Ctrl+Z）で戻せます。`,
            confirmLabel: '訪問を取り消す',
            cancelLabel: 'やめる',
            tone: 'danger',
          });
          if (!ok) return;
          update((x) => (findVisit(x, visitId) ? cancelVisitOp(x, visitId, false) : x), '訪問を取り消す');
          announceMove(`${clientName}さん ${dateText(v.date)} ${v.earliestStart} の訪問を取り消しました`);
          toast('取り消しました', { action: undoAction });
          o.onCancelled?.(visitId);
        })();
        return true;
      }
      let move: VisitMove;
      if (k.kind === 'staff') {
        // その向きに順に見て、この訪問を担当できる最初の人（できない人は飛ばす）
        const next = nextStaffFor(d, visitId, o.staffOrder(visitId), k.step, o.layout === 'table' ? 'row' : 'col');
        if ('why' in next) {
          fail(next.why);
          return true;
        }
        move = { kind: 'staff', staffId: next.staffId };
      } else move = k;
      const r = keyMove(d, visitId, move, today);
      if (!r.ok) {
        fail(r.why);
        return true;
      }
      const label = moveLabel(move, staffName);
      let before = d;
      let after = r.data;
      update((x) => {
        before = x;
        const y = x === d ? r : keyMove(x, visitId, move, today);
        after = y.ok ? y.data : x;
        return after;
      }, label);
      lastMove.set({
        seq: ++seq,
        before,
        after,
        visitId: r.visitId,
        move,
        label,
        repeating: r.repeating,
        scope: 'once',
        clientName,
      });
      // 動かした先で要対応（担当が休みの日へ移した・条件に合わないなど）なら、読み上げに添えて知らせる
      const care = issuesAt(after, r.visitId, r.date);
      announceMove(
        `動かしました：${movedText(r, clientName, staffName)}${care.length > 0 ? `。要対応：${care.join('・')}` : ''}${r.repeating ? '。Alt+↓ で範囲（これ以降・すべて）を選べます' : ''}`,
      );
      if (care.length > 0) toast(`動かした先で要対応です：${care.join('・')}`);
      o.onMoved?.({ visitId: r.visitId, date: r.date });
      return true;
    },
    [update, confirm, toast, undoAction],
  );
}

/**
 * 動かした先の読み上げ（role="status"）と、繰り返しの回を「この回だけ」動かした直後の小さな帯
 * 「この回だけ動かしました［これ以降も］［すべての回も］［このまま］」（モーダルにしない。何も選ばなければこの回だけ）。
 * 範囲を選ぶと、この回だけの手を戻してから範囲つきで当て直す（全体の「元に戻す」の1手のまま）。あとから別の変更があれば選び直さない
 */
export function KeyMoveBand({ onMoved }: { onMoved?: (r: { visitId: string; date: string }) => void }) {
  const { data, update, undo } = useDemoData();
  const latest = useRef(data);
  latest.current = data;
  const note = useValueStore(lastMove);
  const said = useValueStore(announceStore);
  const toast = useToast();
  const shown = !!note && note.repeating && note.scope === 'once' && data === note.after;
  const confirm = useConfirm();
  const rescope = async (scope: VisitScope) => {
    if (!note) return;
    const today = jstDate(Date.now());
    // この回だけ動かす前のデータ・訪問の ID（この回だけなら ID は変わらない）で、範囲つきに当て直す
    const r2 = keyMove(note.before, note.visitId, note.move, today, scope, {
      visit: newId('v'),
      patterns: [newId('pt'), newId('pt')],
    });
    if (!r2.ok) {
      toast(`「${SCOPE_LABELS[scope]}」にはできません：${r2.why}`);
      return;
    }
    // 確定（伝えた）した日の訪問も変わるなら確かめる（訪問の詳細の欄・週のドラッグと同じ文）
    const fixed = toldDaysChanged(note.before, r2.data, today);
    if (
      fixed.length > 0 &&
      !(await confirm({
        title: '確定した日の訪問も変えますか？',
        body: `確定した日（${fixed.map((x) => dateText(x)).join('・')}）の訪問も変わります。その日は「未連絡の変更あり」になり、連絡の一覧に出ます。`,
        confirmLabel: '変える',
      }))
    )
      return;
    // 確かめている間に別の変更が入ったら選び直さない
    if (appHistory.peek()?.after !== latest.current) {
      toast('あとから別の変更があったので、範囲を選び直せません');
      lastMove.set(null);
      return;
    }
    undo();
    const label = `${note.label}（${SCOPE_LABELS[scope]}）`;
    update((x) => (x === note.before ? r2.data : x), label);
    lastMove.set({ ...note, scope, after: r2.data, visitId: r2.visitId, label });
    const staffName = (id: string) => data.staff.find((s) => s.id === id)?.name ?? '（不明）';
    announceMove(`範囲を変えました：${movedText(r2, note.clientName, staffName, scope)}`);
    toast(`${SCOPE_LABELS[scope]}の回を動かしました`);
    onMoved?.({ visitId: r2.visitId, date: r2.date });
  };
  return (
    <>
      <output className="sr-only" aria-live="polite" data-testid="key-move-status">
        {said?.text ?? ''}
      </output>
      {shown && note && (
        <section
          className="key-move-band"
          aria-label="動かす範囲"
          data-testid="key-move-band"
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            backToBand(note.visitId);
          }}
        >
          <WithIcon icon={Repeat} size={15}>
            <span>
              繰り返しの回を<strong>この回だけ</strong>動かしました（{note.label}）
            </span>
          </WithIcon>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => void rescope('following')}
            data-testid="key-scope-following"
          >
            これ以降も
          </button>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => void rescope('all')}
            data-testid="key-scope-all"
          >
            すべての回も
          </button>
          <button
            type="button"
            className="btn btn-text btn-small"
            onClick={() => lastMove.set(null)}
            data-testid="key-scope-keep"
          >
            <WithIcon icon={X} size={14}>
              このまま
            </WithIcon>
          </button>
        </section>
      )}
    </>
  );
}

/** 訪問の帯・行の要素（日の予定の時間軸は帯の中のボタン、ほかは共通の部品の data-visit-item）。見えているものを先に */
export function visitItemOf(visitId: string): HTMLElement | null {
  const v = CSS.escape(visitId);
  const all = document.querySelectorAll<HTMLElement>(
    `.tl-band[data-visit="${v}"] .tl-band-btn, [data-visit-item][data-visit="${v}"]`,
  );
  for (const el of all) if (el.getClientRects().length > 0) return el;
  return all[0] ?? null;
}

/**
 * 動かした訪問の帯へフォーカスを戻す（日付・週・月を移ったときは描き終わるまで待つ）。担当を替えて今の表示から外れた
 * （〈スタッフ〉の画面・〈スタッフ〉で絞った表示）ときは、取り消しと同じく「元に戻す」へ（body に落とさない）
 */
export function focusVisitItem(visitId: string) {
  let n = 0;
  const tick = () => {
    const el = visitItemOf(visitId);
    if (el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return;
    }
    if (++n < 30) requestAnimationFrame(tick);
    else document.querySelector<HTMLElement>('[data-testid="undo-btn"]')?.focus();
  };
  requestAnimationFrame(tick);
}

/** 動かした訪問の帯へフォーカスを戻す（範囲の帯の Esc） */
function backToBand(visitId: string) {
  visitItemOf(visitId)?.focus();
}
