import { Award, BadgeCheck, Cigarette, type LucideIcon, PawPrint, Plus, Star, Tag, Trash2, User } from 'lucide-react';
import type { Condition, Item, ItemTarget, Op, Traits, TraitValue } from '../contracts/rules';
import { attempt, ITEM_KIND_LABELS, OP_LABELS, OPS_BY_KIND } from '../lib/common';
import { conditionText } from '../matching';
import { Check } from './parts';
import { IconButton, WithIcon } from './ui';

/** 項目の名前に合わせたアイコン（見つからなければ Tag）。表示だけの対応 */
export function itemIcon(name: string): LucideIcon {
  if (name.includes('性別')) return User;
  if (name.includes('資格')) return BadgeCheck;
  if (name.includes('経験')) return Award;
  if (name.includes('得意')) return Star;
  if (name.includes('喫煙')) return Cigarette;
  if (name.includes('ペット')) return PawPrint;
  return Tag;
}

/** 特性（traits）の入力と、条件（項目→演算子→値）の入力 */

/** 1つの項目の値の入力（項目の種類に合わせる） */
export function TraitInput({
  item,
  value,
  onChange,
}: {
  item: Item;
  value: TraitValue | undefined;
  onChange: (v: TraitValue) => void;
}) {
  switch (item.kind) {
    case 'flag':
      return (
        <select
          value={value === true ? 'yes' : value === false ? 'no' : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'yes')}
          aria-label={item.name}
        >
          <option value="">未入力</option>
          <option value="yes">あり</option>
          <option value="no">なし</option>
        </select>
      );
    case 'choice':
      return (
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          aria-label={item.name}
        >
          <option value="">未入力</option>
          {item.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'multi': {
      const arr = Array.isArray(value) ? value : [];
      return (
        <OptionChecks
          options={item.options}
          value={arr}
          onChange={(next) => onChange(next.length === 0 ? null : next)}
        />
      );
    }
    case 'number':
      return (
        <input
          type="number"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          aria-label={item.name}
        />
      );
  }
}

function OptionChecks({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  if (options.length === 0) return <span className="sub">選択肢がありません（「項目」で足します）</span>;
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
      {options.map((o) => (
        <Check
          key={o}
          checked={value.includes(o)}
          onChange={(c) =>
            onChange(c ? options.filter((x) => x === o || value.includes(x)) : value.filter((x) => x !== o))
          }
        >
          {o}
        </Check>
      ))}
    </div>
  );
}

/** 項目ごとの特性の入力（スタッフ・訪問先の編集フォーム） */
export function TraitsEditor({
  items,
  value,
  onChange,
}: {
  items: Item[];
  value: Traits;
  onChange: (t: Traits) => void;
}) {
  if (items.length === 0) return <p className="sub">項目がありません（「項目」の画面で足します）。</p>;
  return (
    <div className="form-grid">
      {items.map((it) => (
        <div key={it.id} className="field">
          <span className="field-label">
            <WithIcon icon={itemIcon(it.name)} size={14}>
              {it.name}
            </WithIcon>
            <span className="sub">（{ITEM_KIND_LABELS[it.kind]}）</span>
          </span>
          <TraitInput item={it} value={value[it.id]} onChange={(v) => onChange({ ...value, [it.id]: v })} />
        </div>
      ))}
    </div>
  );
}

/** 演算子に合った値の初期値 */
function defaultValue(item: Item | undefined, op: Op): TraitValue {
  if (!item) return null;
  if (op === 'in' || op === 'hasAny' || op === 'hasAll') return item.options[0] ? [item.options[0]] : [];
  switch (item.kind) {
    case 'flag':
      return true;
    case 'choice':
    case 'multi':
      return item.options[0] ?? '';
    case 'number':
      return 0;
  }
}

/** 条件の表示文（matching.conditionText。まだ使えないときは簡単な文） */
export function condText(cond: Condition, item: Item | undefined): string {
  const r = attempt(() => conditionText(cond, item));
  if (r.value !== null) return r.value;
  if (!item) return '（項目がありません：無効）';
  const v = Array.isArray(cond.value)
    ? cond.value.join('・')
    : cond.value === true
      ? 'あり'
      : cond.value === false
        ? 'なし'
        : String(cond.value ?? '');
  return `${item.name}${OP_LABELS[cond.op]} ${v}`;
}

/**
 * 条件の一覧の編集。items は相手の項目（訪問先の条件ならスタッフの項目）。
 * 1行＝項目→演算子→値。文は matching の conditionText
 */
export function ConditionsEditor({
  items,
  target,
  value,
  onChange,
}: {
  items: Item[];
  /** 相手（条件が見る特性を持つ側） */
  target: ItemTarget;
  value: Condition[];
  onChange: (c: Condition[]) => void;
}) {
  const usable = items.filter((i) => i.target === target);
  const set = (i: number, c: Condition) => onChange(value.map((x, j) => (j === i ? c : x)));
  const add = () => {
    const it = usable[0];
    if (!it) return;
    const op = OPS_BY_KIND[it.kind][0] as Op;
    onChange([...value, { itemId: it.id, op, value: defaultValue(it, op) }]);
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      {value.length === 0 && <span className="sub">なし</span>}
      {value.map((c, i) => {
        const item = usable.find((x) => x.id === c.itemId);
        const ops = item ? OPS_BY_KIND[item.kind] : [c.op];
        const multiValue = c.op === 'in' || c.op === 'hasAny' || c.op === 'hasAll';
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: 条件に ID は無く、行の位置で扱う
          <div key={i} className="cond-row">
            <select
              value={c.itemId}
              aria-label="項目"
              onChange={(e) => {
                const it = usable.find((x) => x.id === e.target.value);
                if (!it) return;
                const op = OPS_BY_KIND[it.kind][0] as Op;
                set(i, { itemId: it.id, op, value: defaultValue(it, op) });
              }}
            >
              {!item && <option value={c.itemId}>（消えた項目）</option>}
              {usable.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </select>
            <select
              value={c.op}
              aria-label="比べ方"
              onChange={(e) => {
                const op = e.target.value as Op;
                set(i, { ...c, op, value: defaultValue(item, op) });
              }}
            >
              {ops.map((o) => (
                <option key={o} value={o}>
                  {OP_LABELS[o]}
                </option>
              ))}
            </select>
            <div className="cond-value">
              {!item ? null : multiValue ? (
                <OptionChecks
                  options={item.options}
                  value={Array.isArray(c.value) ? c.value : []}
                  onChange={(v) => set(i, { ...c, value: v })}
                />
              ) : (
                <TraitInput item={item} value={c.value} onChange={(v) => set(i, { ...c, value: v })} />
              )}
            </div>
            <span className="sub cond-text">{condText(c, item)}</span>
            <IconButton
              icon={Trash2}
              label="この条件を消す"
              tone="danger"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            />
          </div>
        );
      })}
      {value.length < 20 && (
        <button
          type="button"
          className="btn btn-small"
          style={{ alignSelf: 'flex-start' }}
          disabled={usable.length === 0}
          onClick={add}
        >
          <WithIcon icon={Plus}>条件を足す</WithIcon>
        </button>
      )}
      {usable.length === 0 && <span className="sub">使える項目がありません（「項目」の画面で足します）。</span>}
    </div>
  );
}

/** 特性の短い表示 */
export function TraitChips({ traits, items }: { traits: Traits; items: { id: string; name: string }[] }) {
  const chips = items.flatMap((it) => {
    const v = traits[it.id];
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) return [];
    const text =
      v === true ? it.name : v === false ? `${it.name}なし` : `${it.name}：${Array.isArray(v) ? v.join('・') : v}`;
    return [{ text, icon: itemIcon(it.name) }];
  });
  if (chips.length === 0) return <span className="sub">—</span>;
  return (
    <div className="trait-chips">
      {chips.map((c) => (
        <span key={c.text} className="chip">
          <WithIcon icon={c.icon} size={13}>
            {c.text}
          </WithIcon>
        </span>
      ))}
    </div>
  );
}
