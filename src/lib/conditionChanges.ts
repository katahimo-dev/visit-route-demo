// 作り直しの帯の「何が変わったか」と「戻す」（PRD D267〜D269。ADR-0044）。
// 条件の変更の控え（store の conditionsBase：最後に影響する日が0日だった時点の条件）と今の条件を比べ、人が読める一覧にする。
// 控えが無いときは、今の案の記録の重み（AiRun.rules）と点数の基準のプリセットの重みだけ比べられる（madeWeightsChange）。
// ここは純粋関数（データは書き換えない。戻すは新しい DemoData を返し、画面が store の update(fn) で書く）
import type { DemoData } from '../contracts/data';
import type { Terms } from '../contracts/documents';
import { FEATURE_IDS } from '../contracts/features';
import {
  COMPAT_LABELS,
  type CompatLevel,
  HARDABLE,
  MAX_PRESETS,
  type Preset,
  RULE_TYPES,
  type Rule,
  type RuleType,
} from '../contracts/rules';
import { jstDate, jstHhmm } from '../domain/time';
import { matchesPreset, scorePresetOf } from '../seed/presets';
import { repair } from '../store/repair';
import { own, ruleTypeLabel } from './common';
import { featureLabel, isSwitchOn } from './features';
import { planRunOf } from './month';
import { patchPreset, removePreset, setScorePreset } from './presets';

/** 比べる条件の部分（store の Conditions と同じ形。lib から store の型を引かないよう写す） */
export type ConditionParts = Pick<
  DemoData,
  | 'org'
  | 'items'
  | 'rules'
  | 'presets'
  | 'scorePresetId'
  | 'staff'
  | 'clients'
  | 'compat'
  | 'availability'
  | 'visitTypes'
  | 'patterns'
  | 'clientLeaves'
>;

/** 変更の1件 */
export type ConditionChange = {
  /** 一覧の中で一意のキー（例 'preset:standard'・'staff:s-1'） */
  key: string;
  /** 種類（e2e・CSS 用） */
  kind:
    | 'weights'
    | 'preset'
    | 'scorePreset'
    | 'rules'
    | 'trial'
    | 'items'
    | 'compat'
    | 'visitTypes'
    | 'features'
    | 'org'
    | 'staff'
    | 'client'
    | 'availability'
    | 'clientLeaves'
    | 'patterns'
    | 'made';
  /** 何の（例「条件の重み」「スタッフ」） */
  head: string;
  /** どう変わったか（例「待ち 3→2」「山田さんの勤務時間」） */
  text: string;
  /** 戻した新しいデータ（戻せないときは同じデータ） */
  revert: (d: DemoData) => DemoData;
};

/** 一覧の1行の文（「条件の重み：待ち 3→2」） */
export const changeLine = (c: ConditionChange): string => `${c.head}：${c.text}`;

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
/** 多ければ先頭 n 件と「ほか N件」 */
function listText(xs: string[], n = 3, unit = '件'): string {
  return xs.length <= n ? xs.join('・') : `${xs.slice(0, n).join('・')} ほか${xs.length - n}${unit}`;
}
const num = (w: number) => String(w);
/** 重み・必須の変わり方（「待ち 3→2」「相性 必須→必須でない」） */
function weightText(
  label: string,
  a: { weight: number; hard: boolean },
  b: { weight: number; hard: boolean },
  type: RuleType,
): string | null {
  const parts: string[] = [];
  const hardable = HARDABLE.has(type);
  const ah = hardable && a.hard;
  const bh = hardable && b.hard;
  if (ah !== bh) parts.push(ah ? '必須→必須でない' : '必須でない→必須');
  if (a.weight !== b.weight) parts.push(`${num(a.weight)}→${num(b.weight)}`);
  return parts.length > 0 ? `${label} ${parts.join('・')}` : null;
}

/** 型ごとの重みの違い（a → b） */
function presetWeightTexts(a: Preset['weights'], b: Preset['weights'], terms: Terms): string[] {
  return RULE_TYPES.map((t) => weightText(ruleTypeLabel(t, terms), a[t], b[t], t)).filter((x): x is string => !!x);
}

/** ID で並びを比べる */
function byId<T extends { id: string }>(base: readonly T[], now: readonly T[]) {
  const b = new Map(base.map((x) => [x.id, x]));
  const n = new Map(now.map((x) => [x.id, x]));
  return {
    added: now.filter((x) => !b.has(x.id)),
    removed: base.filter((x) => !n.has(x.id)),
    changed: now.flatMap((x) => {
      const y = b.get(x.id);
      return y && !same(x, y) ? [[y, x] as [T, T]] : [];
    }),
  };
}

/**
 * 並びの1件を控えに戻す：控えにあって今あれば控えの中身に、控えにあって今無ければ控えの位置に足し、控えに無ければ消す
 */
export function revertById<T extends { id: string }>(now: readonly T[], base: readonly T[], id: string): T[] {
  const b = base.find((x) => x.id === id);
  const i = now.findIndex((x) => x.id === id);
  if (!b) return now.filter((x) => x.id !== id);
  if (i >= 0) return now.map((x) => (x.id === id ? b : x));
  const at = Math.min(
    base.findIndex((x) => x.id === id),
    now.length,
  );
  return [...now.slice(0, at), b, ...now.slice(at)];
}

/** 名前の「さん」付け */
const san = (name: string) => `${name}さん`;

const STAFF_FIELDS: [keyof DemoData['staff'][number] | (keyof DemoData['staff'][number])[], string][] = [
  ['name', '名前'],
  [['workDays', 'shiftStart', 'shiftEnd'], '勤務時間'],
  ['active', '休止'],
  ['lastDay', '最終勤務日'],
  ['home', '自宅'],
  ['travelMode', '移動手段'],
  ['traits', '特性'],
  ['requirements', '必要条件'],
  ['preferences', '希望'],
  ['email', 'メールアドレス'],
];
const CLIENT_FIELDS: [keyof DemoData['clients'][number] | (keyof DemoData['clients'][number])[], string][] = [
  ['displayName', '名前'],
  ['kana', 'よみ'],
  [['stage', 'active', 'tentative'], '段階'],
  ['place', '場所'],
  ['traits', '特性'],
  ['requirements', '必要条件'],
  ['preferences', '希望'],
  ['usualStaffId', 'いつもの担当'],
  ['allowedStaffIds', '担当できる人'],
  [['entryNote', 'keyNote', 'parkingNote', 'cautionNote'], '決まりごと'],
  ['note', 'メモ'],
  ['color', '色'],
  ['referrer', '紹介元'],
];
/** 変わった項目の名前 */
function fieldNames<T>(a: T, b: T, fields: [keyof T | (keyof T)[], string][]): string[] {
  return fields.filter(([k]) => (Array.isArray(k) ? k : [k]).some((x) => !same(a[x], b[x]))).map(([, label]) => label);
}

/** M/D */
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** 控えを取った時刻の文（「10/21 9:05」。日本時間） */
export function baseAtText(at: number): string {
  return `${md(jstDate(at))} ${jstHhmm(at).replace(/^0/, '')}`;
}

/**
 * 控え（base）と今（now）の条件の違い（PRD D267）。並び：重み・プリセット → 条件 → 機能・事業所 → 項目・種類・相性 → 人 → 勤務時間・休み・定期パターン。
 * 名前は今の名前（消した人は控えの名前）、呼び方は今の org.terms
 */
export function conditionChanges(base: ConditionParts, now: ConditionParts): ConditionChange[] {
  const terms = now.org.terms;
  const out: ConditionChange[] = [];
  const nowBasis = scorePresetOf(now.presets, now.scorePresetId);
  const baseBasis = scorePresetOf(base.presets, base.scorePresetId);

  // 点数の基準のプリセット
  if (nowBasis && baseBasis && nowBasis.id !== baseBasis.id) {
    const id = baseBasis.id;
    out.push({
      key: 'scorePreset',
      kind: 'scorePreset',
      head: '点数の基準',
      text: `「${baseBasis.name}」→「${nowBasis.name}」`,
      revert: (d) => setScorePreset(d, id),
    });
  }
  // プリセット（基準のプリセットの重みは「条件の重み」）
  const p = byId(base.presets, now.presets);
  for (const [b, n] of p.changed) {
    const texts = presetWeightTexts(b.weights, n.weights, terms);
    if (b.name !== n.name) texts.unshift(`名前「${b.name}」→「${n.name}」`);
    if (b.note !== n.note) texts.push('一言');
    if (texts.length === 0) continue;
    const isBasis = nowBasis?.id === n.id;
    out.push({
      key: `preset:${n.id}`,
      kind: isBasis ? 'weights' : 'preset',
      head: isBasis ? '条件の重み' : `プリセット「${n.name}」`,
      text: texts.join('・'),
      revert: (d) =>
        d.presets.some((x) => x.id === b.id)
          ? patchPreset(d, b.id, { name: b.name, note: b.note, weights: b.weights })
          : d,
    });
  }
  for (const n of p.added) {
    out.push({
      key: `preset:${n.id}`,
      kind: 'preset',
      head: 'プリセット',
      text: `「${n.name}」を追加`,
      revert: (d) => removePreset(d, n.id),
    });
  }
  for (const b of p.removed) {
    out.push({
      key: `preset:${b.id}`,
      kind: 'preset',
      head: 'プリセット',
      text: `「${b.name}」を消した`,
      revert: (d) =>
        d.presets.length >= MAX_PRESETS || d.presets.some((x) => x.id === b.id)
          ? d
          : { ...d, presets: revertById(d.presets, base.presets, b.id) },
    });
  }

  // 条件（足す・消す・名前）
  const r = byId(base.rules, now.rules);
  const ruleTexts = [
    ...r.added.map((x) => `「${x.label}」を追加`),
    ...r.removed.map((x) => `「${x.label}」を消した`),
    ...r.changed
      .filter(([b, n]) => b.label !== n.label || b.type !== n.type)
      .map(([b, n]) => `「${b.label}」→「${n.label}」`),
  ];
  if (ruleTexts.length > 0) {
    out.push({
      key: 'rules',
      kind: 'rules',
      head: '条件',
      text: listText(ruleTexts),
      // 並び・名前・型は控えに。残っている条件の重み・必須は今のまま（重みは「条件の重み」「この日だけ試す重み」で戻す）
      revert: (d) => {
        const cur = new Map(d.rules.map((x) => [x.id, x]));
        return {
          ...d,
          rules: base.rules.map((x): Rule => {
            const c = cur.get(x.id);
            return c ? { ...x, weight: c.weight, hard: c.hard } : x;
          }),
        };
      },
    });
  }
  // この日だけ試す重み（基準にそろっていれば基準の重みの違いと同じなので出さない。ADR-0035）
  if (!(nowBasis && matchesPreset(now.rules, nowBasis))) {
    const texts = r.changed.map(([b, n]) => weightText(n.label, b, n, n.type)).filter((x): x is string => !!x);
    if (texts.length > 0) {
      out.push({
        key: 'trial',
        kind: 'trial',
        head: 'この日だけ試す重み',
        text: listText(texts),
        revert: (d) => {
          const was = new Map(base.rules.map((x) => [x.id, x]));
          return {
            ...d,
            rules: d.rules.map((x) => {
              const b = was.get(x.id);
              return b ? { ...x, weight: b.weight, hard: b.hard } : x;
            }),
          };
        },
      });
    }
  }

  // 機能の入り切り（管理者設定）
  const feats = FEATURE_IDS.filter((id) => isSwitchOn(base.org.features, id) !== isSwitchOn(now.org.features, id));
  if (feats.length > 0) {
    out.push({
      key: 'features',
      kind: 'features',
      head: '機能',
      text: listText(
        feats.map((id) => `${featureLabel(id, terms)}を${isSwitchOn(now.org.features, id) ? '入' : '切'}`),
      ),
      revert: (d) => ({ ...d, org: { ...d.org, features: base.org.features } }),
    });
  }
  // 事業所の設定（機能の入り切りのほか）
  const orgTexts: string[] = [];
  if (base.org.name !== now.org.name) orgTexts.push('事業所の名前');
  if (base.org.industry !== now.org.industry) orgTexts.push('業種');
  if (!same(base.org.terms, now.org.terms)) orgTexts.push('呼び方');
  if (base.org.fareYenPerKm !== now.org.fareYenPerKm)
    orgTexts.push(`交通費の単価 ${base.org.fareYenPerKm}→${now.org.fareYenPerKm}円/km`);
  if (base.org.spanLimitHours !== now.org.spanLimitHours)
    orgTexts.push(`拘束の上限 ${base.org.spanLimitHours}→${now.org.spanLimitHours}時間`);
  if (orgTexts.length > 0) {
    out.push({
      key: 'org',
      kind: 'org',
      head: '事業所の設定',
      text: listText(orgTexts),
      revert: (d) => ({ ...d, org: { ...base.org, features: d.org.features } }),
    });
  }

  // 特性の項目・訪問の種類（まとめて1件）
  const it = byId(base.items, now.items);
  const itemTexts = [
    ...it.added.map((x) => `「${x.name}」を追加`),
    ...it.removed.map((x) => `「${x.name}」を消した`),
    ...it.changed.map(([, n]) => `「${n.name}」を直した`),
  ];
  if (itemTexts.length > 0 || !same(base.items, now.items)) {
    out.push({
      key: 'items',
      kind: 'items',
      head: '特性の項目',
      text: itemTexts.length > 0 ? listText(itemTexts) : '並び',
      revert: (d) => ({ ...d, items: base.items }),
    });
  }
  const vt = byId(base.visitTypes, now.visitTypes);
  const typeTexts = [
    ...vt.added.map((x) => `${x.name}を追加`),
    ...vt.removed.map((x) => `${x.name}を消した`),
    ...vt.changed.map(([, n]) => `${n.name}を直した`),
  ];
  if (typeTexts.length > 0) {
    out.push({
      key: 'visitTypes',
      kind: 'visitTypes',
      head: '訪問の種類',
      text: listText(typeTexts),
      revert: (d) => ({ ...d, visitTypes: base.visitTypes }),
    });
  }

  // 相性（組の数と先頭の2組）
  const staffName = (id: string) =>
    now.staff.find((s) => s.id === id)?.name ?? base.staff.find((s) => s.id === id)?.name ?? '（いない人）';
  const clientName = (id: string) =>
    now.clients.find((c) => c.id === id)?.displayName ??
    base.clients.find((c) => c.id === id)?.displayName ??
    '（いない人）';
  const pairs: string[] = [];
  for (const cid of [...new Set([...Object.keys(base.compat), ...Object.keys(now.compat)])].sort()) {
    const b = own(base.compat, cid) ?? {};
    const n = own(now.compat, cid) ?? {};
    for (const sid of [...new Set([...Object.keys(b), ...Object.keys(n)])].sort()) {
      const lb = (own(b, sid) ?? 0) as CompatLevel;
      const ln = (own(n, sid) ?? 0) as CompatLevel;
      if (lb === ln) continue;
      const mark = (l: CompatLevel) => COMPAT_LABELS[l] || '空';
      pairs.push(`${san(clientName(cid))}と${san(staffName(sid))} ${mark(lb)}→${mark(ln)}`);
    }
  }
  if (pairs.length > 0) {
    out.push({
      key: 'compat',
      kind: 'compat',
      head: '相性',
      text: `${pairs.length}組（${listText(pairs, 2, '組')}）`,
      revert: (d) => ({ ...d, compat: base.compat }),
    });
  }

  // 人（1人ずつ）
  const st = byId(base.staff, now.staff);
  for (const n of st.added)
    out.push(
      personChange('staff', n.id, terms.staff, `${san(n.name)}を追加`, (d) => revertById(d.staff, base.staff, n.id)),
    );
  for (const b of st.removed)
    out.push(
      personChange('staff', b.id, terms.staff, `${san(b.name)}を消した`, (d) => revertById(d.staff, base.staff, b.id)),
    );
  for (const [b, n] of st.changed) {
    const f = fieldNames(b, n, STAFF_FIELDS);
    out.push(
      personChange('staff', n.id, terms.staff, `${san(n.name)}の${f.join('・') || '設定'}`, (d) =>
        revertById(d.staff, base.staff, n.id),
      ),
    );
  }
  const cl = byId(base.clients, now.clients);
  for (const n of cl.added)
    out.push(
      personChange('client', n.id, terms.client, `${san(n.displayName)}を追加`, (d) =>
        revertById(d.clients, base.clients, n.id),
      ),
    );
  for (const b of cl.removed)
    out.push(
      personChange('client', b.id, terms.client, `${san(b.displayName)}を消した`, (d) =>
        revertById(d.clients, base.clients, b.id),
      ),
    );
  for (const [b, n] of cl.changed) {
    const f = fieldNames(b, n, CLIENT_FIELDS);
    out.push(
      personChange('client', n.id, terms.client, `${san(n.displayName)}の${f.join('・') || '設定'}`, (d) =>
        revertById(d.clients, base.clients, n.id),
      ),
    );
  }

  // 勤務時間（シフト）の日ごとの上書き（人ごと）
  const avKey = (a: { staffId: string; date: string }) => `${a.staffId}|${a.date}`;
  const avBase = new Map(base.availability.map((a) => [avKey(a), a]));
  const avNow = new Map(now.availability.map((a) => [avKey(a), a]));
  const avDates = new Map<string, Set<string>>();
  for (const k of new Set([...avBase.keys(), ...avNow.keys()])) {
    if (same(avBase.get(k), avNow.get(k))) continue;
    const [sid, date] = k.split('|') as [string, string];
    const set = avDates.get(sid) ?? new Set<string>();
    set.add(date);
    avDates.set(sid, set);
  }
  for (const [sid, dates] of avDates) {
    out.push({
      key: `availability:${sid}`,
      kind: 'availability',
      head: '勤務時間（シフト）',
      text: `${san(staffName(sid))}（${listText([...dates].sort().map(md), 3, '日')}）`,
      revert: (d) => ({
        ...d,
        availability: [
          ...d.availability.filter((a) => a.staffId !== sid),
          ...base.availability.filter((a) => a.staffId === sid),
        ],
      }),
    });
  }
  // 〈利用者さん〉の休み・定期パターン（〈利用者さん〉ごと）
  for (const [key, head] of [
    ['clientLeaves', `${terms.client}の休み`],
    ['patterns', '定期パターン'],
  ] as const) {
    const ids = new Set<string>();
    const bl = base[key] as { id: string; clientId: string }[];
    const nl = now[key] as { id: string; clientId: string }[];
    const d0 = byId(bl, nl);
    for (const x of [...d0.added, ...d0.removed]) ids.add(x.clientId);
    for (const [b, n] of d0.changed) {
      ids.add(b.clientId);
      ids.add(n.clientId);
    }
    for (const cid of [...ids].sort()) {
      out.push({
        key: `${key}:${cid}`,
        kind: key,
        head,
        text: san(clientName(cid)),
        revert: (d) => ({
          ...d,
          [key]: [
            ...(d[key] as { clientId: string }[]).filter((x) => x.clientId !== cid),
            ...bl.filter((x) => x.clientId === cid),
          ],
        }),
      });
    }
  }
  return out;
}

function personChange(
  kind: 'staff' | 'client',
  id: string,
  head: string,
  text: string,
  list: (d: DemoData) => DemoData['staff'] | DemoData['clients'],
): ConditionChange {
  return {
    key: `${kind}:${id}`,
    kind,
    head,
    text,
    revert: (d) =>
      kind === 'staff'
        ? { ...d, staff: list(d) as DemoData['staff'] }
        : { ...d, clients: list(d) as DemoData['clients'] },
  };
}

/** 変更を戻す（戻したあと、いない人・種類を指す所を repair で直す） */
export const applyRevert = (d: DemoData, c: ConditionChange): DemoData => repair(c.revert(d));

/**
 * すべて戻す（PRD D268）：控えの条件そのものに戻す（重みの違いの記録（made）は控えに重みの違いが無いときだけ足して戻す）
 */
export function revertAll(d: DemoData, base: ConditionParts | null, made: ConditionChange | null): DemoData {
  let next: DemoData = base ? { ...d, ...base } : d;
  if (made) next = made.revert(next);
  return repair(next);
}

/**
 * 控えが無いとき（または控えに重みの違いが無いとき）の、作ったときの重みの違い（PRD D269）：
 * 重みの違いで「条件が変わった」日（lib/month の rulesStale）の今の案の記録の重み（AiRun.rules。型ごとに最初の条件）と、
 * 点数の基準のプリセットの重みを比べる。日によって記録の重みが違えば、いちばん多い組を出す。違いが無ければ null。
 * 戻すは、点数の基準のプリセットの重みを作ったときの値にする（試す重みも基準にそろう。ADR-0035）
 */
export function madeWeightsChange(
  data: Pick<DemoData, 'aiPlans' | 'aiRuns' | 'presets' | 'scorePresetId' | 'org'>,
  staleDays: readonly string[],
): ConditionChange | null {
  const basis = scorePresetOf(data.presets, data.scorePresetId);
  if (!basis) return null;
  const counts = new Map<string, { rules: Rule[]; days: number }>();
  for (const d of staleDays) {
    const run = planRunOf(data, d);
    if (!run) continue;
    const k = JSON.stringify(run.rules.map((r) => [r.type, r.weight, r.hard]));
    const c = counts.get(k);
    if (c) c.days += 1;
    else counts.set(k, { rules: run.rules, days: 1 });
  }
  const top = [...counts.values()].sort((a, b) => b.days - a.days)[0];
  if (!top) return null;
  const made: Partial<Preset['weights']> = {};
  for (const t of RULE_TYPES) {
    const r = top.rules.find((x) => x.type === t);
    if (r) made[t] = { weight: r.weight, hard: HARDABLE.has(t) && r.hard };
  }
  const terms = data.org.terms;
  const parts = RULE_TYPES.flatMap((t) => {
    const m = made[t];
    const w = basis.weights[t];
    if (!m) return [];
    const hardable = HARDABLE.has(t);
    if (m.weight === w.weight && (hardable && m.hard) === (hardable && w.hard)) return [];
    const bothHard = hardable && m.hard && w.hard;
    const v = (x: { weight: number; hard: boolean }) => (hardable && x.hard && !bothHard ? '必須' : num(x.weight));
    return [{ t, text: `${ruleTypeLabel(t, terms)} ${v(m)}、今：${v(w)}` }];
  });
  if (parts.length === 0) return null;
  const id = basis.id;
  return {
    key: 'made',
    kind: 'made',
    head: counts.size > 1 ? `作ったときの重み（${top.days}日分）` : '作ったときの重み',
    text: parts.map((x) => x.text).join('・'),
    revert: (d) => {
      const p = d.presets.find((x) => x.id === id);
      if (!p) return d;
      const weights = { ...p.weights };
      for (const { t } of parts) weights[t] = { ...made[t]! };
      return patchPreset(d, id, { weights });
    },
  };
}

/** 一覧の見出し（はじめ畳む。PRD D267） */
export const changesToggleText = (n: number): string => `変更内容を見る（${n}件）`;
/** 記録が無いときの文（PRD D269） */
export const NO_RECORD_TEXT = '何が変わったかの記録がありません（作り直すか、日の予定で確かめてください）';
/** 控えはあるが一覧が空のとき（戻したあとも影響する日が残る：控えを取る前の変更） */
export const NO_MORE_TEXT =
  '記録した変更はありません。残りは記録より前の変更です（作り直すか、日の予定で確かめてください）';
/** 一覧の上の文 */
export const sinceText = (at: number): string => `${baseAtText(at)} からの変更`;
/** 戻すの確認の本文 */
export function revertBody(cs: readonly ConditionChange[]): string {
  return `${cs.map((c) => `・${changeLine(c)}`).join('\n')}\nを変える前に戻します。足したものは消え、消したものは戻ります。`;
}
