import { describe, expect, it } from 'vitest';
import type { DayLoadSlot } from '../contracts/vacancy';
import { hhmmToMinutes } from '../domain/time';
import {
  BAR_END,
  BAR_ROWS,
  BAR_START,
  BAR_STEP,
  barEdgeNote,
  barEdges,
  barRangeText,
  barRowsOf,
  barRowsText,
  DAY_MINUTES,
  edgeLabel,
  inBar,
  loadEdgeTexts,
  placeOnRows,
  withEdges,
} from './barRows';

const m = hhmmToMinutes;

describe('3段の区切り（PRD D82）', () => {
  it('8〜12・12〜16・16〜20時の等間隔（各30分×8マス）。目盛りの文も同じ所から', () => {
    expect(BAR_ROWS).toEqual([
      [8, 12],
      [12, 16],
      [16, 20],
    ]);
    expect(BAR_START).toBe(m('08:00'));
    expect(BAR_END).toBe(m('20:00'));
    for (const [a, b] of BAR_ROWS) expect(((b - a) * 60) / BAR_STEP).toBe(8);
    expect(barRowsText()).toBe('上から 8〜12時・12〜16時・16〜20時');
    expect(edgeLabel('early')).toBe('8時より前');
    expect(edgeLabel('late')).toBe('20時以降');
    expect(barRangeText()).toBe('8:00〜20:00');
    expect(barEdgeNote()).toBe('（8時より前・20時以降は端に ◀・▶）');
  });

  it('inBar・withEdges：まとめは 8〜20時のマスだけ、端の文は後ろに足す（二重に読まない）', () => {
    expect(inBar([m('07:30'), m('08:00'), m('19:30'), m('20:00')].map((start) => ({ start })))).toEqual([
      { start: m('08:00') },
      { start: m('19:30') },
    ]);
    expect(withEdges('時間帯：訪問 9:00〜10:00', { early: '8時より前：訪問 7:00〜7:30', late: null })).toBe(
      '時間帯：訪問 9:00〜10:00。8時より前：訪問 7:00〜7:30',
    );
    expect(withEdges('混み具合：…', undefined)).toBe('混み具合：…');
  });

  it('barRowsOf：0〜24時の30分のマスを段に分け、段の外は捨てる', () => {
    const slots = Array.from({ length: DAY_MINUTES / BAR_STEP }, (_, i) => ({ start: i * BAR_STEP }));
    const rows = barRowsOf(slots);
    expect(rows.map((r) => r.slots.length)).toEqual([8, 8, 8]);
    expect(rows[0]!.slots[0]!.start).toBe(m('08:00'));
    expect(rows[1]!.slots[0]!.start).toBe(m('12:00'));
    expect(rows[2]!.slots.at(-1)!.start).toBe(m('19:30'));
  });

  it('barEdges：8時より前・20時以降の active なマスだけ', () => {
    const slots = [m('07:00'), m('07:30'), m('08:00'), m('19:30'), m('20:00'), m('21:00')].map((start) => ({
      start,
      on: start !== m('07:00'),
    }));
    const e = barEdges(slots, (x) => x.on);
    expect(e.early.map((x) => x.start)).toEqual([m('07:30')]);
    expect(e.late.map((x) => x.start)).toEqual([m('20:00'), m('21:00')]);
  });
});

describe('placeOnRows（〈利用者さん〉の帯。PRD D83）', () => {
  it('段の中の区間は段の幅に対する位置。段をまたげば段ごとに切り、最初の切れ端に first', () => {
    const r = placeOnRows([
      { id: 'a', start: m('09:00'), end: m('10:00') },
      { id: 'b', start: m('11:30'), end: m('12:30') },
    ]);
    expect(r.pieces).toEqual([
      { row: 0, left: 0.25, width: 0.25, first: true, item: expect.objectContaining({ id: 'a' }) },
      { row: 0, left: 0.875, width: 0.125, first: true, item: expect.objectContaining({ id: 'b' }) },
      { row: 1, left: 0, width: 0.125, first: false, item: expect.objectContaining({ id: 'b' }) },
    ]);
    expect(r.early).toEqual([]);
    expect(r.late).toEqual([]);
    expect(r.outside).toEqual([]);
  });

  it('8時より前・20時以降：段に掛からない区間は outside と early・late、はみ出す区間は切れ端と early・late', () => {
    const before = { id: 'x', start: m('07:00'), end: m('08:00') };
    const over = { id: 'y', start: m('07:30'), end: m('08:30') };
    const after = { id: 'z', start: m('20:00'), end: m('20:30') };
    const tail = { id: 'w', start: m('19:30'), end: m('20:30') };
    const r = placeOnRows([before, over, after, tail]);
    expect(r.outside).toEqual([before, after]);
    expect(r.early).toEqual([before, over]);
    expect(r.late).toEqual([after, tail]);
    expect(r.pieces.map((p) => [p.item.id, p.row, p.left, p.width])).toEqual([
      ['y', 0, 0, 0.125],
      ['w', 2, 0.875, 0.125],
    ]);
  });

  it('長さ0の区間はその時刻に幅0の切れ端', () => {
    const r = placeOnRows([{ start: m('12:00'), end: m('12:00') }]);
    expect(r.pieces).toEqual([
      { row: 1, left: 0, width: 0, first: true, item: { start: m('12:00'), end: m('12:00') } },
    ]);
  });
});

describe('loadEdgeTexts（混み具合の端の印）', () => {
  const slot = (hhmm: string, working: number, free: number): DayLoadSlot => ({ start: m(hhmm), working, free });

  it('働く人がいる30分を、時刻と人数が続く分でまとめる。働く人がいなければ null', () => {
    const load = [
      slot('06:00', 0, 0),
      slot('06:30', 1, 1),
      slot('07:00', 2, 1),
      slot('07:30', 2, 1),
      slot('08:00', 3, 3),
      slot('19:30', 3, 3),
      slot('20:00', 0, 0),
    ];
    expect(loadEdgeTexts(load)).toEqual({
      early: '8時より前：6:30〜7:00 空き 1人／働く 1人、7:00〜8:00 空き 1人／働く 2人',
      late: null,
    });
    expect(loadEdgeTexts([slot('20:30', 1, 0)])).toEqual({
      early: null,
      late: '20時以降：20:30〜21:00 空き 0人／働く 1人',
    });
  });
});
