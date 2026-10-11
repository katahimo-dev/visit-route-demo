import { describe, expect, it } from 'vitest';
import { score } from '../evaluate';
import { solve } from '../solver';
import { client, DATE, makeData, rule, staff, visit } from './fixtures';
import { bestInsertion, compile, PIN_LABEL } from './index';

/** 2人・4件（v1 9:00、v2 11:00、v3 13:00、v4 15:00、幅1時間） */
function data() {
  const cl = Array.from({ length: 4 }, (_, i) => client(`c${i + 1}`, 38.26 + i * 0.01, 140.87 + i * 0.01));
  return makeData({
    staff: [staff('s1', 38.26, 140.87), staff('s2', 38.29, 140.9)],
    clients: cl,
    visits: cl.map((c, i) =>
      visit(`v${i + 1}`, c.id, `${String(9 + i * 2).padStart(2, '0')}:00`, `${String(10 + i * 2).padStart(2, '0')}:00`),
    ),
    rules: [rule('w', 'wait', 3)],
  });
}

describe('compile の pins（手直しの固定）', () => {
  it('固定した訪問は固定した担当だけが可、他は「固定（手直し）」で外れる', () => {
    const p = compile(data(), DATE, { v2: 's2' });
    expect(p.allowed[1]).toEqual([false, true]);
    expect(p.reasons[1]![0]).toContainEqual({ ruleId: 'pin', label: PIN_LABEL, points: Infinity });
    expect(p.allowed[0]).toEqual([true, true]);
    // 問題にいない担当への固定は無視する
    expect(compile(data(), DATE, { v2: 'zz' }).allowed[1]).toEqual([true, true]);
  });
  it('固定を残して解くと、固定した訪問はその担当のまま', () => {
    const pins = { v1: 's2', v3: 's2' };
    const p = compile(data(), DATE, pins);
    const r = solve(p, { seed: 1, iterations: 5000 });
    expect(r.routes.s2).toEqual(expect.arrayContaining(['v1', 'v3']));
  });
});

describe('bestInsertion', () => {
  it('移した先の列の、strict で最も費用の少ない位置（時刻の順）に入れ、元の列から抜く', () => {
    const p = compile(data(), DATE);
    const routes = { s1: ['v1', 'v2'], s2: ['v3', 'v4'] };
    const out = bestInsertion(p, routes, 'v2', 's2');
    expect(out).toEqual({ s1: ['v1'], s2: ['v2', 'v3', 'v4'] });
    // 元の routes は変えない
    expect(routes.s1).toEqual(['v1', 'v2']);
    expect(score(p, out).hardViolations).toEqual([]);
  });
  it('strict でどこにも入らなければ開始時刻の順に入れ、違反として見える', () => {
    const d = data();
    // v5 は v2 と同じ 11:00 固定。s2 が v2 を持っていると入らない
    d.clients.push(client('c5', 38.3, 140.95));
    d.visits.push(visit('v5', 'c5', '11:00', '11:00', { windowKind: 'fixed' }));
    const p = compile(d, DATE);
    const out = bestInsertion(p, { s1: ['v5'], s2: ['v1', 'v2', 'v3'] }, 'v5', 's2');
    expect(out.s2).toEqual(['v1', 'v2', 'v5', 'v3']);
    expect(score(p, out).hardViolations.length).toBeGreaterThan(0);
  });
  it('未割当（どの列にもない）訪問も入れられる。列がない担当には新しく作る', () => {
    const p = compile(data(), DATE);
    expect(bestInsertion(p, { s1: ['v1'] }, 'v3', 's2')).toEqual({ s1: ['v1'], s2: ['v3'] });
  });
});
