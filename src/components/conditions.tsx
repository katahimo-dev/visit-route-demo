import {
  Award,
  BadgeCheck,
  Cigarette,
  CircleHelp,
  Heart,
  type LucideIcon,
  PawPrint,
  ShieldCheck,
  Star,
  Tag,
  Trash2,
  User,
} from 'lucide-react';
import { useState } from 'react';
import type { Condition, Item, ItemTarget, Op, Traits, TraitValue } from '../contracts/rules';
import { attempt, ITEM_KIND_LABELS } from '../lib/common';
import { conditionText } from '../matching';
import { useDemoData } from '../store/react';
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

/** 特性（traits）の入力と、条件（相手の項目ごとのチェック表）の入力 */

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
        <Segmented
          label={item.name}
          value={value === true ? 'yes' : value === false ? 'no' : ''}
          options={[
            ['', '未確認'],
            ['yes', 'あり'],
            ['no', 'なし'],
          ]}
          onChange={(k) => onChange(k === '' ? null : k === 'yes')}
        />
      );
    case 'choice':
      return (
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          aria-label={item.name}
        >
          <option value="">未確認</option>
          {item.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'multi': {
      const arr = Array.isArray(value) ? value : [];
      return <OptionChecks options={item.options} value={arr} onChange={onChange} />;
    }
    case 'number':
      return (
        <input
          type="number"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange(e.target.value === '' || !Number.isFinite(n) ? null : n);
          }}
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

/** 小さな切り替えボタン（選ばれているものをオレンジの淡い色に） */
function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (k: string) => void;
}) {
  return (
    <fieldset className="segmented seg-sm" aria-label={label}>
      {options.map(([k, text]) => (
        <button
          key={k}
          type="button"
          aria-pressed={value === k}
          className={value === k ? 'is-on' : ''}
          onClick={() => onChange(k)}
        >
          {text}
        </button>
      ))}
    </fieldset>
  );
}

/** 条件の表示文（matching.conditionText。あり/なしは「項目：あり」の形に） */
export function condText(cond: Condition, item: Item | undefined): string {
  if (item?.kind === 'flag' && typeof cond.value === 'boolean' && (cond.op === 'is' || cond.op === 'not')) {
    const yes = cond.op === 'is' ? cond.value : !cond.value;
    return `${item.name}：${yes ? 'あり' : 'なし'}${cond.op === 'not' ? '（未確認も可）' : ''}`;
  }
  const r = attempt(() => conditionText(cond, item));
  if (r.value !== null) return r.value;
  if (!item) return '（項目がありません：無効）';
  return item.name;
}

/** 文字列の配列として読む（is の1つの値も配列に） */
const listOf = (v: TraitValue): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []);

/**
 * 1つの項目にかかる条件を、チェック表で扱える形に読む。読めなければ null（「そのほかの条件」で表示だけ）
 * flag：is 1つ／choice：is・in 1つ／multi：hasAny・hasAll 1つ／number：gte・lte 1つずつ
 */
function readable(item: Item, conds: Condition[]): boolean {
  if (conds.length === 0) return true;
  const c = conds[0];
  if (!c) return true;
  // 選択肢の値が空でなく、すべていまの選択肢にあること（空・消えた選択肢は表に出すと「問わない」に見えてしまう）
  const knownList = (v: TraitValue) =>
    (Array.isArray(v) || typeof v === 'string') &&
    listOf(v).length > 0 &&
    listOf(v).every((o) => item.options.includes(o));
  switch (item.kind) {
    case 'flag':
      return conds.length === 1 && c.op === 'is' && typeof c.value === 'boolean';
    case 'choice':
      return conds.length === 1 && (c.op === 'is' || c.op === 'in') && knownList(c.value);
    case 'multi':
      return (
        conds.length === 1 && (c.op === 'hasAny' || c.op === 'hasAll') && Array.isArray(c.value) && knownList(c.value)
      );
    case 'number':
      return (
        conds.every(
          (x) => (x.op === 'gte' || x.op === 'lte') && typeof x.value === 'number' && Number.isFinite(x.value),
        ) && new Set(conds.map((x) => x.op)).size === conds.length
      );
  }
}

/** 条件の上限（contracts/documents.ts の requirements・preferences の max） */
const MAX_CONDS = 20;

/**
 * 条件の入力。特性と同じく、相手の項目ごとに1行のチェック表にする（何も選ばない＝問わない）。
 * items は全項目、target は相手（条件が見る特性を持つ側）。保存する形は Condition[] のまま（契約どおり）
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
  const [full, setFull] = useState(false);
  const terms = useDemoData().data.org.terms;
  /** 相手の呼び方（例：スタッフ・利用者さん） */
  const who = target === 'staff' ? terms.staff : terms.client;
  // その項目の条件を置き換える（ほかの項目の条件と並び順はそのまま。上限を超えるときは受け付けない）
  const replace = (itemId: string, next: Condition[]) => {
    const before = value.filter((c) => c.itemId === itemId).length;
    if (value.length - before + next.length > MAX_CONDS) {
      setFull(true);
      return;
    }
    setFull(false);
    const at = value.findIndex((c) => c.itemId === itemId);
    const rest = value.filter((c) => c.itemId !== itemId);
    const pos = at < 0 ? rest.length : value.slice(0, at).filter((c) => c.itemId !== itemId).length;
    onChange([...rest.slice(0, pos), ...next, ...rest.slice(pos)]);
  };
  const others = value.filter((c) => {
    const it = usable.find((x) => x.id === c.itemId);
    return (
      !it ||
      !readable(
        it,
        value.filter((x) => x.itemId === it.id),
      )
    );
  });
  if (usable.length === 0) return <span className="sub">使える項目がありません（「項目」の画面で足します）。</span>;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="cond-table">
        {usable.map((it) => {
          const conds = value.filter((c) => c.itemId === it.id);
          const ok = readable(it, conds);
          return (
            <div key={it.id} className={`cond-line${conds.length > 0 ? ' is-set' : ''}`}>
              <span className="cond-name">
                <WithIcon icon={itemIcon(it.name)} size={14}>
                  {it.name}
                </WithIcon>
              </span>
              <div className="cond-input">
                {!ok ? (
                  <span className="sub">下の「そのほかの条件」で設定中</span>
                ) : (
                  <ItemCondition item={it} conds={conds} onChange={(next) => replace(it.id, next)} />
                )}
              </div>
            </div>
          );
        })}
      </div>
      {full && <p className="error">条件は{MAX_CONDS}件までです。ほかの条件を外してから入れてください。</p>}
      <span className="sub">
        「問わない」の項目は、どの{who}でもかまいません。{who}
        のその項目が「未確認」（まだ聞き取っていない）なら、条件に合わない扱いにします（念のため避ける）。
      </span>
      {others.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="sub">そのほかの条件（前の形式で入れたもの。消して上の表で入れ直せます）</span>
          {others.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 条件に ID は無く、並びの位置で扱う
            <div key={i} className="row">
              <span className="chip">
                {condText(
                  c,
                  usable.find((x) => x.id === c.itemId),
                )}
              </span>
              <IconButton
                icon={Trash2}
                label="この条件を消す"
                tone="danger"
                onClick={() => onChange(value.filter((x) => x !== c))}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 1つの項目の条件の入力（項目の種類に合わせる） */
function ItemCondition({
  item,
  conds,
  onChange,
}: {
  item: Item;
  conds: Condition[];
  onChange: (next: Condition[]) => void;
}) {
  const first = conds[0];
  switch (item.kind) {
    case 'flag':
      return (
        <Segmented
          label={item.name}
          value={first ? (first.value === true ? 'yes' : 'no') : ''}
          options={[
            ['', '問わない'],
            ['yes', 'あり'],
            ['no', 'なし'],
          ]}
          onChange={(k) => onChange(k === '' ? [] : [{ itemId: item.id, op: 'is', value: k === 'yes' }])}
        />
      );
    case 'choice': {
      const picked = first ? listOf(first.value) : [];
      return (
        <OptionChecks
          options={item.options}
          value={picked}
          onChange={(v) => onChange(v.length === 0 ? [] : [{ itemId: item.id, op: 'in', value: v }])}
        />
      );
    }
    case 'multi': {
      const picked = first ? listOf(first.value) : [];
      const op: Op = first?.op === 'hasAll' ? 'hasAll' : 'hasAny';
      return (
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <OptionChecks
            options={item.options}
            value={picked}
            onChange={(v) => onChange(v.length === 0 ? [] : [{ itemId: item.id, op, value: v }])}
          />
          {picked.length >= 2 && (
            <Segmented
              label={`${item.name}の含み方`}
              value={op}
              options={[
                ['hasAny', 'どれか'],
                ['hasAll', 'すべて'],
              ]}
              onChange={(k) => onChange([{ itemId: item.id, op: k as Op, value: picked }])}
            />
          )}
        </div>
      );
    }
    case 'number': {
      const bound = (op: 'gte' | 'lte') => {
        const c = conds.find((x) => x.op === op);
        return typeof c?.value === 'number' ? c.value : '';
      };
      // 下限（gte）→上限（lte）の順に並べる。数として読めない値は入れない
      const set = (op: 'gte' | 'lte', text: string) => {
        const n = Number(text);
        const next = (['gte', 'lte'] as const).flatMap((o): Condition[] => {
          if (o !== op) return conds.filter((x) => x.op === o);
          return text === '' || !Number.isFinite(n) ? [] : [{ itemId: item.id, op: o, value: n }];
        });
        onChange(next);
      };
      const lo = bound('gte');
      const hi = bound('lte');
      return (
        <div className="row num-range">
          <input
            type="number"
            value={bound('gte')}
            placeholder="下限"
            aria-label={`${item.name}の下限`}
            onChange={(e) => set('gte', e.target.value)}
          />
          <span className="sub">以上</span>
          <input
            type="number"
            value={bound('lte')}
            placeholder="上限"
            aria-label={`${item.name}の上限`}
            onChange={(e) => set('lte', e.target.value)}
          />
          <span className="sub">以下</span>
          {lo !== '' && hi !== '' && lo > hi && (
            <span className="error">下限が上限より大きいので、誰も満たしません</span>
          )}
        </div>
      );
    }
  }
}

/** 求めること（必要条件・希望）の短い表示。必要条件は盾、希望はハート */
export function CondChips({
  requirements,
  preferences,
  itemById,
}: {
  requirements: Condition[];
  preferences: Condition[];
  itemById: Map<string, Item>;
}) {
  const chips = [
    ...requirements.map((c) => ({ text: condText(c, itemById.get(c.itemId)), icon: ShieldCheck, kind: '必要条件' })),
    ...preferences.map((c) => ({ text: condText(c, itemById.get(c.itemId)), icon: Heart, kind: '希望' })),
  ];
  if (chips.length === 0) return <span className="sub">問わない</span>;
  return (
    <div className="trait-chips">
      {chips.map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 同じ文の条件が並ぶこともある
        <span key={i} className={`chip ${c.kind === '必要条件' ? 'chip-primary' : ''}`} title={c.kind}>
          <WithIcon icon={c.icon} size={13}>
            {c.text}
          </WithIcon>
        </span>
      ))}
    </div>
  );
}

/** 特性の短い表示 */
export function TraitChips({ traits, items }: { traits: Traits; items: { id: string; name: string }[] }) {
  // 未確認の項目（まだ聞き取っていない）。相手の条件を満たさない扱いなので、埋め漏れに気づけるよう印を出す
  const unknown = items.filter((it) => traits[it.id] === undefined || traits[it.id] === null);
  const chips = items.flatMap((it) => {
    const v = traits[it.id];
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) return [];
    const text =
      v === true
        ? `${it.name}：あり`
        : v === false
          ? `${it.name}：なし`
          : `${it.name}：${Array.isArray(v) ? v.join('・') : v}`;
    return [{ text, icon: itemIcon(it.name) }];
  });
  if (chips.length === 0 && unknown.length === 0) return <span className="sub">—</span>;
  return (
    <div className="trait-chips">
      {chips.map((c) => (
        <span key={c.text} className="chip">
          <WithIcon icon={c.icon} size={13}>
            {c.text}
          </WithIcon>
        </span>
      ))}
      {unknown.length > 0 && (
        <span className="chip chip-warn" title={`未確認：${unknown.map((it) => it.name).join('・')}`}>
          <WithIcon icon={CircleHelp} size={13}>
            未確認 {unknown.length}
          </WithIcon>
        </span>
      )}
    </div>
  );
}
