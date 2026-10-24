import { describe, expect, it } from 'vitest';
import type { DemoData } from '../contracts/data';
import {
  defaultMode,
  isLateMonth,
  modeLead,
  modeTools,
  nextYm,
  parseMode,
  planLabel,
  planYm,
  unassignedDays,
} from './scheduleMode';

describe('defaultMode（PRD D348）', () => {
  it('月の後半で来月を組んでいなければ組む', () => {
    expect(defaultMode('2026-10-24', 5)).toBe('plan');
    expect(defaultMode('2026-10-15', 2)).toBe('plan');
  });
  it('月の後半でも来月を組んでいれば確認', () => {
    expect(defaultMode('2026-10-24', 0)).toBe('check');
    expect(defaultMode('2026-10-24', 1)).toBe('check');
  });
  it('月の前半は確認', () => {
    expect(defaultMode('2026-10-14', 20)).toBe('check');
    expect(defaultMode('2026-10-01', 20)).toBe('check');
  });
});

describe('月の後半・組む月', () => {
  it('15日から後半', () => {
    expect(isLateMonth('2026-10-14')).toBe(false);
    expect(isLateMonth('2026-10-15')).toBe(true);
  });
  it('来月は年をまたぐ', () => {
    expect(nextYm('2026-12-31')).toBe('2027-01');
    expect(nextYm('2026-01-31')).toBe('2026-02');
  });
  it('組む月は後半なら来月、前半なら今月', () => {
    expect(planYm('2026-10-24')).toBe('2026-11');
    expect(planYm('2026-10-03')).toBe('2026-10');
    expect(planLabel('2026-10-24')).toBe('11月を組む');
  });
});

describe('modeTools', () => {
  it('組む：AI で組む・動かす。欠勤の登録・メールは出さない', () => {
    expect(modeTools('plan')).toEqual({ absence: false, ai: true, mail: false, move: true });
  });
  it('変更：すべて', () => {
    expect(modeTools('change')).toEqual({ absence: true, ai: true, mail: true, move: true });
  });
  it('確認：見て伝えるだけ（AI で組む・動かすは出さない）', () => {
    expect(modeTools('check')).toEqual({ absence: true, ai: false, mail: true, move: false });
  });
});

describe('parseMode', () => {
  it('3つのモードだけ読む', () => {
    expect(parseMode('plan')).toBe('plan');
    expect(parseMode('check')).toBe('check');
    expect(parseMode('')).toBeNull();
    expect(parseMode(null)).toBeNull();
    expect(parseMode('all')).toBeNull();
  });
});

describe('unassignedDays', () => {
  const base = {
    patterns: [],
    clients: [{ id: 'c1', active: true }],
    clientLeaves: [],
    snapshots: {},
  } as unknown as DemoData;
  const visit = (id: string, date: string, staffId: string | null, extra = {}) => ({
    id,
    clientId: 'c1',
    date,
    staffId,
    cancelled: false,
    earliestStart: '09:00',
    latestStart: '09:00',
    duration: 60,
    ...extra,
  });
  it('今日以降で担当なしの訪問がある日を数える（伝えた日・取り消しは数えない）', () => {
    const data = {
      ...base,
      visits: [
        visit('a', '2026-11-02', null),
        visit('b', '2026-11-02', null),
        visit('c', '2026-11-03', 's1'),
        visit('d', '2026-11-04', null, { cancelled: true }),
        visit('e', '2026-11-05', null),
        visit('f', '2026-11-06', null),
      ],
      snapshots: { '2026-11-06': {} },
    } as unknown as DemoData;
    expect(unassignedDays(data, '2026-11', '2026-10-24')).toBe(2);
    expect(unassignedDays(data, '2026-11', '2026-11-03')).toBe(1);
  });
});

describe('modeLead', () => {
  it('呼び方を使う', () => {
    expect(modeLead('check', 'シッター')).toContain('シッターに伝えたら');
  });
});
