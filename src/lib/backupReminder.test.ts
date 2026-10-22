import { describe, expect, it } from 'vitest';
import {
  BACKUP_REMIND_DAYS,
  BACKUP_REMIND_TEXT,
  confirmedDayCount,
  daysBetween,
  exportAgoText,
  jstStamp,
  previousText,
  shouldRemindBackup,
} from './backupReminder';

describe('最後に書き出した日の文（PRD D227）', () => {
  it('「10/12（7日前）」・同じ日は「今日」・まだなら「まだ書き出していません」', () => {
    expect(exportAgoText('2026-10-12', '2026-10-19')).toBe('10/12（7日前）');
    expect(exportAgoText('2026-10-19', '2026-10-19')).toBe('10/19（今日）');
    expect(exportAgoText('2026-09-30', '2026-10-01')).toBe('9/30（1日前）');
    expect(exportAgoText(null, '2026-10-19')).toBe('まだ書き出していません');
  });
  it('日数は月・年をまたいでも数える', () => {
    expect(daysBetween('2026-12-25', '2027-01-08')).toBe(14);
    expect(daysBetween('2026-10-19', '2026-10-19')).toBe(0);
  });
});

describe('控えの知らせ（PRD D227）', () => {
  const base = { lastExport: '2026-10-01', lastReminded: null, today: '2026-10-19', confirmedDays: 1 };
  it('確定した日があり、2週間以上書き出していなければ知らせる', () => {
    expect(BACKUP_REMIND_DAYS).toBe(14);
    expect(shouldRemindBackup(base)).toBe(true);
    expect(shouldRemindBackup({ ...base, lastExport: '2026-10-05' })).toBe(true);
    expect(shouldRemindBackup({ ...base, lastExport: '2026-10-06' })).toBe(false);
    expect(BACKUP_REMIND_TEXT).toContain('控え（バックアップ）を2週間以上書き出していません');
  });
  it('まだ書き出していなくても、確定した日があれば知らせる', () => {
    expect(shouldRemindBackup({ ...base, lastExport: null })).toBe(true);
  });
  it('確定した日が無ければ知らせない', () => {
    expect(shouldRemindBackup({ ...base, lastExport: null, confirmedDays: 0 })).toBe(false);
  });
  it('1日1回まで（今日もう知らせたら出さない。前の日なら出す）', () => {
    expect(shouldRemindBackup({ ...base, lastReminded: '2026-10-19' })).toBe(false);
    expect(shouldRemindBackup({ ...base, lastReminded: '2026-10-18' })).toBe(true);
  });
  it('確定した日は、担当の決まった訪問がある日だけ数える', () => {
    expect(
      confirmedDayCount({
        baseDate: '2026-10-01',
        snapshots: {
          '2026-10-12': {
            date: '2026-10-12',
            at: 1,
            visits: [{ id: 'v1', clientId: 'c1', staffId: 's1', start: '09:00' }],
          },
          '2026-10-13': {
            date: '2026-10-13',
            at: 1,
            visits: [{ id: 'v2', clientId: 'c1', staffId: null, start: null }],
          },
          '2026-10-14': { date: '2026-10-14', at: 1, visits: [] },
          '2026-10-15': {
            date: '2026-10-15',
            at: 1,
            visits: [{ id: 'v3', clientId: 'c1', staffId: 's2', start: '10:00' }],
          },
        },
      }),
    ).toBe(2);
  });
});

describe('直前の状態の文（PRD D227）', () => {
  it('日本時間の「10/19 14:03 の『初期状態に戻す』の前の状態に戻せます」', () => {
    const at = Date.parse('2026-10-19T14:03:00+09:00');
    expect(jstStamp(at)).toBe('10/19 14:03');
    expect(previousText({ at, reason: '初期状態に戻す' })).toBe('10/19 14:03 の『初期状態に戻す』の前の状態に戻せます');
  });
  it('初期データの過去の伝えた日（基準日より前）は数えない', () => {
    const v = [{ id: 'v1', clientId: 'c1', staffId: 's1', start: '09:00' }];
    expect(
      confirmedDayCount({
        baseDate: '2026-10-20',
        snapshots: {
          '2026-10-19': { date: '2026-10-19', at: 1, visits: v },
          '2026-10-20': { date: '2026-10-20', at: 1, visits: v },
        },
      }),
    ).toBe(1);
  });
});
