import { HeartHandshake } from 'lucide-react';
import { useMemo } from 'react';
import { ClientName } from '../components/parts';
import { Hint, PageHeader } from '../components/ui';
import { COMPAT_LABELS, COMPAT_LEVELS, type CompatLevel } from '../contracts/rules';
import { initialOf } from '../lib/colors';
import { byDisplayName, byName, staffColor } from '../lib/common';
import { useDemoData } from '../store';
import './settings.css';

/** 凡例（◎○△×の意味。色は表のセルと同じ） */
const LEGEND: { mark: string; cls: string; text: string }[] = [
  { mark: '◎', cls: 'lv2', text: '選ばれやすい' },
  { mark: '○', cls: 'lv1', text: 'やや選ばれやすい' },
  { mark: '△', cls: 'lvm1', text: '選ばれにくい' },
  { mark: '×', cls: 'lvm2', text: '担当にしない' },
];

/** 次の相性（◎→○→空→△→×→◎） */
const nextLevel = (l: CompatLevel): CompatLevel =>
  COMPAT_LEVELS[(COMPAT_LEVELS.indexOf(l) + 1) % COMPAT_LEVELS.length] as CompatLevel;

/** 相性：訪問先×スタッフの表。セルを押すと ◎→○→空→△→× を回す（×は担当にしない） */
export default function CompatPage() {
  const { data, update } = useDemoData();
  const terms = data.org.terms;
  const clients = useMemo(() => data.clients.filter((c) => c.active).sort(byDisplayName), [data.clients]);
  const staff = useMemo(() => data.staff.filter((s) => s.active).sort(byName), [data.staff]);
  // 色は休止中も含めた並びで決める（予定・AI案の画面と同じ色にする）
  const colorOf = useMemo(
    () => new Map([...data.staff].sort(byName).map((s, i) => [s.id, staffColor(i)])),
    [data.staff],
  );
  const levelOf = (clientId: string, staffId: string): CompatLevel => data.compat[clientId]?.[staffId] ?? 0;

  const cycle = (clientId: string, staffId: string) =>
    update((d) => {
      const row = { ...(d.compat[clientId] ?? {}) };
      const next = nextLevel(row[staffId] ?? 0);
      if (next === 0) delete row[staffId];
      else row[staffId] = next;
      return { ...d, compat: { ...d.compat, [clientId]: row } };
    });

  return (
    <div className="stack">
      <PageHeader icon={HeartHandshake} title="相性" lead="セルを押すと ◎ → ○ → 空 → △ → × と変わります" />
      <div className="card stack">
        <div className="compat-legend">
          {LEGEND.map((l) => (
            <span key={l.mark} className={`legend-item ${l.cls}`}>
              <b>{l.mark}</b>
              {l.text}
            </span>
          ))}
          <Hint label="点のしくみ">
            ◎○は点が下がり（選ばれやすい）、△は点が上がります。
            <span className="red-text">×</span>
            は「NG」で、重みに関係なく担当にしません。点の大きさは「条件」の画面の「相性」の重みで決まります。
            相性は人が入れるもので、実績から自動では変わりません。
          </Hint>
        </div>
        <div className="table-scroll">
          <table className="compat-table">
            <thead>
              <tr>
                <th className="avail-name">{terms.client}</th>
                {staff.map((s) => (
                  <th key={s.id} className="compat-head" title={s.name}>
                    <div className="compat-head-in">
                      <span className="dot dot-sm" style={{ background: colorOf.get(s.id) ?? staffColor(0) }}>
                        {initialOf(s.name)}
                      </span>
                      <span className="compat-head-name">{s.name}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <th className="avail-name">
                    <ClientName client={c} />
                  </th>
                  {staff.map((s) => {
                    const l = levelOf(c.id, s.id);
                    return (
                      <td key={s.id} className="compat-cell">
                        <button
                          type="button"
                          className={`compat-btn lv${l < 0 ? `m${-l}` : l}`}
                          title={`${c.displayName} × ${s.name}`}
                          aria-label={`${c.displayName}と${s.name}の相性：${COMPAT_LABELS[l] || '未入力'}`}
                          onClick={() => cycle(c.id, s.id)}
                        >
                          {COMPAT_LABELS[l]}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sub">
          休止中の{terms.client}・{terms.staff}は出していません。
        </p>
      </div>
    </div>
  );
}
