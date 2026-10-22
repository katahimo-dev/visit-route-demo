import { describe, expect, it } from 'vitest';
import type { Visit } from '../contracts/documents';
import { savedVisit, type VisitFields } from './visitEdit';

const v: Visit = {
  id: '2026-10-19_p1',
  date: '2026-10-19',
  clientId: 'c1',
  windowKind: 'fixed',
  earliestStart: '09:00',
  latestStart: '09:00',
  durationMinutes: 60,
  staffId: 's1',
  start: null,
  pinned: false,
  cancelled: false,
  note: '',
  typeId: null,
  pattern: { id: 'p1', date: '2026-10-19', edited: false },
  cancelKind: null,
};
const fields = (over: Partial<VisitFields> = {}): VisitFields => ({
  date: v.date,
  clientId: v.clientId,
  windowKind: v.windowKind,
  earliestStart: v.earliestStart,
  latestStart: v.latestStart,
  durationMinutes: v.durationMinutes,
  note: v.note,
  typeId: v.typeId,
  ...over,
});

describe('savedVisit（訪問の欄の保存）', () => {
  it('日付を変えても担当は残し（版2）、組んだ開始は外して、この回だけの変更にする', () => {
    const r = savedVisit({ ...v, start: '09:10' }, fields({ date: '2026-10-20' }), 'new');
    expect(r.staffId).toBe('s1');
    expect(r.start).toBeNull();
    expect(r.id).toBe(v.id);
    expect(r.pattern).toEqual({ id: 'p1', date: '2026-10-19', edited: true });
  });

  it('同じ日のままなら担当は残す。メモもこの回だけの変更（保存した回にする。版2）', () => {
    const r = savedVisit(v, fields({ note: 'メモ' }), 'new');
    expect(r.staffId).toBe('s1');
    expect(r.pattern!.edited).toBe(true);
    expect(savedVisit(v, fields(), 'new').pattern!.edited).toBe(false);
    expect(savedVisit(v, fields({ earliestStart: '10:00', latestStart: '10:00' }), 'new').pattern!.edited).toBe(true);
  });

  it('新しい訪問は新しい ID・担当なし・単発', () => {
    const r = savedVisit(null, fields(), 'new');
    expect(r).toMatchObject({ id: 'new', staffId: null, cancelled: false, pattern: null });
  });
});
