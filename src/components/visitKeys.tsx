// 訪問の帯をキーボードで動かす（PRD D333。ADR-0055）の画面の部品：帯の keydown を受けるフック useVisitKeys と、
// 動かした先の読み上げ・繰り返しの回の範囲を選び直す小さな帯 KeyMoveBand（日の予定・週の予定に置く）。
// どの操作も store の update を1回（手の名前つき）で、全体の「元に戻す」で1手戻る
import { Repeat, X } from 'lucide-react';
import { useCallback, useRef } from 'react';
import type { DemoData } from '../contracts/data';
import { jstDate } from '../domain/time';
import { dateText, newId } from '../lib/common';
import { appHistory } from '../lib/history';
import { createValueStore, useValueStore } from '../lib/valueStore';
import { keyMove, movedText, moveLabel, neighborStaff, type VisitMove, visitKeyOf } from '../lib/visitKeys';
import { cancelVisitOp, SCOPE_LABELS, type VisitScope } from '../lib/visitOps';
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
      const k = visitKeyOf(e);
      if (!k) return false;
      const o = optsRef.current;
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
      const fail = (why: string) => {
        announceMove(`動かせません：${why}`);
        toast(`動かせません：${why}`);
      };
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
        const next = neighborStaff(o.staffOrder(visitId), v.staffId, k.step);
        if (!next) {
          fail(k.step > 0 ? 'これより右に担当の列はありません' : 'これより左に担当の列はありません');
          return true;
        }
        move = { kind: 'staff', staffId: next };
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
      announceMove(`動かしました：${movedText(r, clientName, staffName)}`);
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
  const note = useValueStore(lastMove);
  const said = useValueStore(announceStore);
  const toast = useToast();
  const shown = !!note && note.repeating && note.scope === 'once' && data === note.after;
  const rescope = (scope: VisitScope) => {
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
    if (appHistory.peek()?.after !== data) {
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
        <section className="key-move-band" aria-label="動かす範囲" data-testid="key-move-band">
          <WithIcon icon={Repeat} size={15}>
            <span>
              繰り返しの回を<strong>この回だけ</strong>動かしました（{note.label}）
            </span>
          </WithIcon>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => rescope('following')}
            data-testid="key-scope-following"
          >
            これ以降も
          </button>
          <button type="button" className="btn btn-small" onClick={() => rescope('all')} data-testid="key-scope-all">
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
