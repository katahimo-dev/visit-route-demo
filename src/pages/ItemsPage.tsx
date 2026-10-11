import { useState } from 'react';
import type { DemoData } from '../contracts/data';
import {
  type Condition,
  ITEM_KINDS,
  type Item,
  type ItemKind,
  type ItemTarget,
  type Traits,
  type TraitValue,
} from '../contracts/rules';
import { ITEM_KIND_LABELS, newId } from '../lib/common';
import { useDemoData } from '../store';

/**
 * 項目：スタッフの項目・訪問先の項目の2つの表（ClassClassify の列の種類と OptionsEditor にならう）。
 * スタッフの項目は訪問先の条件で、訪問先の項目はスタッフの条件で使う
 */

const hasOptions = (k: ItemKind) => k === 'choice' || k === 'multi';

/** 項目の値を持つ人・場所の traits を書き換える */
function mapTraits(d: DemoData, target: ItemTarget, fn: (t: Traits) => Traits): DemoData {
  return target === 'staff'
    ? { ...d, staff: d.staff.map((s) => ({ ...s, traits: fn(s.traits) })) }
    : { ...d, clients: d.clients.map((c) => ({ ...c, traits: fn(c.traits) })) };
}
/** 項目を使う条件（相手側の requirements・preferences）を書き換える */
function mapConds(d: DemoData, target: ItemTarget, fn: (c: Condition[]) => Condition[]): DemoData {
  return target === 'staff'
    ? {
        ...d,
        clients: d.clients.map((c) => ({ ...c, requirements: fn(c.requirements), preferences: fn(c.preferences) })),
      }
    : { ...d, staff: d.staff.map((s) => ({ ...s, requirements: fn(s.requirements), preferences: fn(s.preferences) })) };
}
/** 項目を参照している条件の持ち主の名前 */
function refsOf(d: DemoData, item: Item): string[] {
  const uses = (cs: Condition[]) => cs.some((c) => c.itemId === item.id);
  return item.target === 'staff'
    ? d.clients.filter((c) => uses(c.requirements) || uses(c.preferences)).map((c) => c.displayName)
    : d.staff.filter((s) => uses(s.requirements) || uses(s.preferences)).map((s) => s.name);
}
/** 値が入っている件数 */
function valueCount(d: DemoData, item: Item): number {
  const owners: { traits: Traits }[] = item.target === 'staff' ? d.staff : d.clients;
  return owners.filter((o) => {
    const v = o.traits[item.id];
    return v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);
  }).length;
}
/** 選択肢を使っている件数 */
function optionCount(d: DemoData, item: Item, opt: string): number {
  const owners: { traits: Traits }[] = item.target === 'staff' ? d.staff : d.clients;
  return owners.filter((o) => {
    const v = o.traits[item.id];
    return v === opt || (Array.isArray(v) && v.includes(opt));
  }).length;
}
const replaceValue = (v: TraitValue | undefined, from: string, to: string | null): TraitValue => {
  if (v === undefined) return null;
  if (v === from) return to;
  if (Array.isArray(v)) {
    const next = v.flatMap((x) => (x === from ? (to === null ? [] : [to]) : [x]));
    return next;
  }
  return v;
};

export default function ItemsPage() {
  const { data } = useDemoData();
  const terms = data.org.terms;
  return (
    <div className="stack">
      <h2>項目</h2>
      <p className="sub">
        {terms.staff}や{terms.client}が持つ特性（資格・経験年数・ペットなど）を決めます。値は「{terms.staff}」「
        {terms.client}」の画面で入れ、条件（必要条件・希望）で使います。
      </p>
      <ItemTable target="staff" title={`${terms.staff}の項目`} note={`${terms.client}の必要条件・希望で使います`} />
      <ItemTable target="client" title={`${terms.client}の項目`} note={`${terms.staff}の必要条件・希望で使います`} />
    </div>
  );
}

function ItemTable({ target, title, note }: { target: ItemTarget; title: string; note: string }) {
  const { data, update } = useDemoData();
  const items = data.items.filter((i) => i.target === target);
  const setItem = (id: string, patch: Partial<Item>) =>
    update((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));

  const add = () => {
    const name = `新しい項目${items.length + 1}`;
    update((d) => ({ ...d, items: [...d.items, { id: newId('i'), name, target, kind: 'flag', options: [] }] }));
  };
  const remove = (item: Item) => {
    const refs = refsOf(data, item);
    const msg =
      refs.length > 0
        ? `項目「${item.name}」は ${refs.length}件の条件で使っています（${refs.slice(0, 5).join('、')}${refs.length > 5 ? ' など' : ''}）。\n消すと、その条件は無効になります（条件そのものは残ります）。消しますか？`
        : `項目「${item.name}」を消しますか？入っている値も消えます。`;
    if (!confirm(msg)) return;
    update((d) => {
      const next = mapTraits(d, target, (t) => {
        const { [item.id]: _drop, ...rest } = t;
        return rest;
      });
      return { ...next, items: next.items.filter((i) => i.id !== item.id) };
    });
  };
  const changeKind = (item: Item, kind: ItemKind) => {
    const n = valueCount(data, item);
    const refs = refsOf(data, item);
    if (
      (n > 0 || refs.length > 0) &&
      !confirm(
        `種類を変えると、この項目の値（${n}件）と、この項目を使う条件（${refs.length}件）を消します。よろしいですか？`,
      )
    )
      return;
    update((d) => {
      let next = mapTraits(d, target, (t) => {
        const { [item.id]: _drop, ...rest } = t;
        return rest;
      });
      next = mapConds(next, target, (cs) => cs.filter((c) => c.itemId !== item.id));
      return {
        ...next,
        items: next.items.map((i) =>
          i.id === item.id ? { ...i, kind, options: hasOptions(kind) ? i.options : [] } : i,
        ),
      };
    });
  };
  const renameOption = (item: Item, from: string, to: string) =>
    update((d) => {
      let next = mapTraits(d, target, (t) =>
        item.id in t ? { ...t, [item.id]: replaceValue(t[item.id], from, to) } : t,
      );
      next = mapConds(next, target, (cs) =>
        cs.map((c) => (c.itemId === item.id ? { ...c, value: replaceValue(c.value, from, to) } : c)),
      );
      return {
        ...next,
        items: next.items.map((i) =>
          i.id === item.id ? { ...i, options: i.options.map((o) => (o === from ? to : o)) } : i,
        ),
      };
    });
  const removeOption = (item: Item, opt: string) => {
    const n = optionCount(data, item, opt);
    if (n > 0 && !confirm(`「${opt}」は ${n}件に入っています。消すと、その値も消えます。よろしいですか？`)) return;
    update((d) => {
      let next = mapTraits(d, target, (t) => {
        if (!(item.id in t)) return t;
        const v = replaceValue(t[item.id], opt, null);
        return { ...t, [item.id]: Array.isArray(v) && v.length === 0 ? null : v };
      });
      next = mapConds(next, target, (cs) =>
        cs.map((c) =>
          c.itemId === item.id && Array.isArray(c.value) ? { ...c, value: c.value.filter((x) => x !== opt) } : c,
        ),
      );
      return {
        ...next,
        items: next.items.map((i) => (i.id === item.id ? { ...i, options: i.options.filter((o) => o !== opt) } : i)),
      };
    });
  };

  return (
    <div className="card stack">
      <div className="spread">
        <h3>{title}</h3>
        <button type="button" className="btn btn-small" onClick={add}>
          ＋ 項目を足す
        </button>
      </div>
      <span className="sub">{note}</span>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>名前</th>
              <th>種類</th>
              <th>選択肢</th>
              <th>使っている条件</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const refs = refsOf(data, it);
              return (
                <tr key={it.id}>
                  <td style={{ minWidth: 140 }}>
                    <NameInput value={it.name} onCommit={(name) => setItem(it.id, { name })} />
                  </td>
                  <td>
                    <select value={it.kind} onChange={(e) => changeKind(it, e.target.value as ItemKind)}>
                      {ITEM_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {ITEM_KIND_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ minWidth: 220 }}>
                    {hasOptions(it.kind) ? (
                      <OptionsEditor
                        options={it.options}
                        countOf={(o) => optionCount(data, it, o)}
                        onAdd={(o) => setItem(it.id, { options: [...it.options, o] })}
                        onRename={(from, to) => renameOption(it, from, to)}
                        onRemove={(o) => removeOption(it, o)}
                      />
                    ) : (
                      <span className="sub">{it.kind === 'flag' ? 'あり／なし' : '数値を入れる'}</span>
                    )}
                  </td>
                  <td className="sub">{refs.length > 0 ? `${refs.length}件` : 'なし'}</td>
                  <td>
                    <button type="button" className="btn btn-small" onClick={() => remove(it)}>
                      消す
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {items.length === 0 && <p className="sub">項目がありません。</p>}
    </div>
  );
}

/** 名前の入力。空のままでは確定しない */
function NameInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const v = draft ?? value;
  const commit = () => {
    const t = v.trim();
    if (t && t !== value) onCommit(t.slice(0, 30));
    setDraft(null);
  };
  return (
    <input
      value={v}
      maxLength={30}
      aria-label="項目の名前"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

/** 選択肢の一覧（使っている件数）・追加・名前の変更・削除（ClassClassify RosterEditor の OptionsEditor にならう） */
function OptionsEditor({
  options,
  countOf,
  onAdd,
  onRename,
  onRemove,
}: {
  options: string[];
  countOf: (o: string) => number;
  onAdd: (o: string) => void;
  onRename: (from: string, to: string) => void;
  onRemove: (o: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [added, setAdded] = useState('');
  const a = added.trim();
  const addDup = options.includes(a);
  const d = draft.trim();
  const renameDup = editing !== null && d !== editing && options.includes(d);
  return (
    <div className="stack" style={{ gap: 4 }}>
      {options.length === 0 && <span className="sub">選択肢がありません</span>}
      {options.map((o) =>
        editing === o ? (
          <form
            key={o}
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (renameDup) return;
              if (d && d !== o) onRename(o, d.slice(0, 30));
              setEditing(null);
            }}
          >
            <input value={draft} maxLength={30} onChange={(e) => setDraft(e.target.value)} aria-label={`${o}の名前`} />
            <button type="submit" className="btn btn-small" disabled={!d || renameDup}>
              決定
            </button>
            <button type="button" className="btn btn-small" onClick={() => setEditing(null)}>
              やめる
            </button>
          </form>
        ) : (
          <div key={o} className="option-row">
            <span className="grow">{o}</span>
            <span className="sub">{countOf(o)}件</span>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                setEditing(o);
                setDraft(o);
              }}
            >
              名前
            </button>
            <button type="button" className="btn btn-small" onClick={() => onRemove(o)}>
              消す
            </button>
          </div>
        ),
      )}
      {options.length < 30 && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!a || addDup) return;
            onAdd(a.slice(0, 30));
            setAdded('');
          }}
        >
          <input value={added} maxLength={30} placeholder="選択肢を足す" onChange={(e) => setAdded(e.target.value)} />
          <button type="submit" className="btn btn-small" disabled={!a || addDup}>
            足す
          </button>
        </form>
      )}
      {addDup && <span className="error">同じ選択肢があります</span>}
    </div>
  );
}
