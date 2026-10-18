import type { TravelMode } from '../contracts/codes';
import type { Place, Terms } from '../contracts/documents';
import { HARDABLE, type ItemKind, type Op, type RuleType } from '../contracts/rules';
import { weekday } from '../domain/time';

/** 画面の共通の表示（呼び方は org.terms から引く。「お客様」「シッター」を直書きしない） */

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;
export const TRAVEL_MODE_LABELS: Record<TravelMode, string> = {
  DRIVE: '車',
  BICYCLE: '自転車',
  WALK: '徒歩',
  TRANSIT: '公共交通',
};

/** スタッフごとの線の色（PoC本体 common.tsx と同じ） */
export const STAFF_COLORS = [
  '#e8735f',
  '#4a7fc1',
  '#5aa57a',
  '#8e63b5',
  '#d99a2b',
  '#2f9ea0',
  '#b5546f',
  '#6b7a3a',
] as const;
export const staffColor = (i: number): string =>
  STAFF_COLORS[((i % STAFF_COLORS.length) + STAFF_COLORS.length) % STAFF_COLORS.length] ?? '#e8735f';

/** 地図：スタッフ本人の画面のルートの線（オレンジの実線） */
export const AI_LINE = '#e8735f';

export const hasLocation = (p: Place): p is { address: string; lat: number; lng: number } =>
  p.lat !== null && p.lng !== null;

export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  flag: 'あり/なし',
  choice: '選択肢から1つ',
  multi: '選択肢から複数',
  number: '数値',
};

export const OP_LABELS: Record<Op, string> = {
  is: 'が次と同じ',
  not: 'が次と違う',
  in: 'が次のどれか',
  hasAny: 'に次のどれかを含む',
  hasAll: 'に次のすべてを含む',
  gte: 'が次の値以上',
  lte: 'が次の値以下',
};
/** 項目の種類ごとに使える演算子（contracts/rules.ts の OPS の説明に合わせる） */
export const OPS_BY_KIND: Record<ItemKind, Op[]> = {
  flag: ['is', 'not'],
  choice: ['is', 'not', 'in'],
  multi: ['hasAny', 'hasAll'],
  number: ['gte', 'lte', 'is', 'not'],
};

/** 重みのスライダーを止めるか（必須の条件は重みを使わない。負担の均等は必須でも重みを使う） */
export function weightLocked(r: { type: RuleType; hard: boolean }): boolean {
  return r.hard && HARDABLE.has(r.type) && r.type !== 'balance';
}

/** 条件の型の名前 */
export function ruleTypeLabel(type: RuleType, t: Terms): string {
  switch (type) {
    case 'clientRequirement':
      return `${t.client}の必要条件`;
    case 'clientPreference':
      return `${t.client}の希望`;
    case 'staffRequirement':
      return `${t.staff}の必要条件`;
    case 'staffPreference':
      return `${t.staff}の希望`;
    case 'compatibility':
      return '相性';
    case 'continuity':
      return 'いつもの担当';
    case 'balance':
      return '負担の均等';
    case 'wait':
      // 画面の名前（PRD D174）。Excel の見出しは excel/text の ruleTypeLabels で今の「待ち時間」のまま
      return '空き時間（待ち）';
  }
}

/** 条件の型の説明（contracts/rules.ts のコメントを平易にしたもの） */
export function ruleTypeHelp(type: RuleType, t: Terms): string {
  switch (type) {
    case 'clientRequirement':
      return `${t.client}が${t.staff}に求める条件（例：性別が女性、資格に看護師）。満たさない条件1つにつき 重み×10点。必須にすると、満たさない${t.staff}は担当にしません。条件そのものは「${t.client}」の画面で入れます。`;
    case 'clientPreference':
      return `${t.client}の希望（例：経験年数3以上）。満たさない希望1つにつき 重み×10点。必須にもできます。希望そのものは「${t.client}」の画面で入れます。`;
    case 'staffRequirement':
      return `${t.staff}の側の必要条件（例：ペットのいない家）。満たさない条件1つにつき 重み×10点。必須にすると、満たさない${t.client}には行かせません。条件そのものは「${t.staff}」の画面で入れます。`;
    case 'staffPreference':
      return `${t.staff}の側の希望。満たさない希望1つにつき 重み×10点。必須にもできます。`;
    case 'compatibility':
      return `「相性」の表を使います。◎は −重み×10点、○は −重み×5点、△は ＋重み×10点。×は重みに関係なく担当にしません。必須にすると △ も担当にしません。`;
    case 'continuity':
      return `いつもの担当が決まっている${t.client}で、別の人が行くと 重み×10点。必須にすると、いつもの担当だけが行きます。`;
    case 'balance':
      return `勤務時間に合わせた件数の目安（例：2〜3件）から外れるほど重くします（外れた件数の2乗×重み×10点。1件で30点、2件で120点＜重み3のとき＞）。${t.staff}の件数をそろえます。必須にすると、目安の上限＋1件を超える割当はしません（重みも使います）。`;
    case 'wait':
      return '訪問のあいだの空き時間（待ち）1分につき 重み×0.1点（必須にはできません）。';
  }
}

/** 入力検査（zod）などの失敗を画面に出す文にする */
/**
 * 画面を開いたあとに新しい版が公開され、あとから読む部品（Excel など）のファイルが無くなったときのエラーか。
 * ブラウザごとに文言が違う（Chrome・Firefox・Safari）
 */
export function isStaleBuild(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /dynamically imported module|Importing a module script failed|Unable to preload/i.test(m);
}

export function formError(e: unknown): string {
  if (e && typeof e === 'object' && 'issues' in e) {
    const issues = (e as { issues: { path: PropertyKey[]; message: string }[] }).issues;
    const i = issues[0];
    return i ? `${i.path.map(String).join('.')}：${i.message}` : '入力内容を確認してください';
  }
  return e instanceof Error ? e.message : String(e);
}

/** 例外を投げる関数を、値かエラー文に変える（未実装・データの不整合でも画面を止めない） */
export function attempt<T>(fn: () => T): { value: T | null; error: string | null } {
  try {
    return { value: fn(), error: null };
  } catch (e) {
    return { value: null, error: formError(e) };
  }
}

/**
 * 記録（staffId → 訪問ID の列など）から自分のキーだけを引く。ID が constructor・toString など
 * Object の組み込みの名前でも、組み込みの関数を値と取り違えない（URL の ID・読み込んだデータ）
 */
export function own<T>(rec: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(rec, key) ? rec[key] : undefined;
}

/** 1つの項目の選択肢の数の上限（contracts/rules.ts の itemSchema） */
export const MAX_OPTIONS = 30;
/** 選択肢から複数の「確認済みで1つもない」を Excel で表す印（選択肢の名前には使えない。ADR-0006） */
export const EMPTY_OPTION_MARK = '（なし）';
/**
 * 選択肢の名前に使えないもの。Excel では「、」と改行で選択肢を区切り、「（なし）」を空の印に使うため（ADR-0006）。
 * 使えれば null
 */
export function optionNameError(name: string): string | null {
  if (/[、\r\n]/.test(name)) return '選択肢の名前に「、」と改行は使えません';
  if (name.normalize('NFKC').trim() === EMPTY_OPTION_MARK.normalize('NFKC'))
    return `「${EMPTY_OPTION_MARK}」は選択肢の名前に使えません`;
  return null;
}

/** 同じ名前がほかにあるか（自分 selfId は除く。前後の空白は無視） */
/**
 * 名前の比べ方：全角半角と空白の違いは同じとみなす（Excel の見出しの比べ方と同じ。
 * 「山田 太郎」と「山田　太郎」「山田太郎」は同じ名前）
 */
export const nameKey = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');

export function nameTaken<T extends { id: string }>(xs: T[], nameOf: (x: T) => string, name: string, selfId?: string) {
  const n = nameKey(name);
  return xs.some((x) => x.id !== selfId && nameKey(nameOf(x)) === n);
}

/** 新しい ID（画面で足すもの用） */
export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

export const r0 = (n: number) => Math.round(n);
export const r1 = (n: number) => Math.round(n * 10) / 10;
/** 点の表示（正＝悪い「+12」、負＝良い「−30」、可否で外れた原因は「必須」） */
export function pointsText(p: number): string {
  if (!Number.isFinite(p)) return '必須';
  const r = Math.round(p);
  return r > 0 ? `+${r}` : r < 0 ? `−${-r}` : '±0';
}
/** 差の表示（+3 / −2.5） */
export function deltaText(n: number, unit = ''): string {
  const r = r1(n);
  return r > 0 ? `+${r}${unit}` : r < 0 ? `−${-r}${unit}` : `差なし`;
}

/** 名前の順 */
export const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ja');
export const byDisplayName = (a: { displayName: string }, b: { displayName: string }) =>
  a.displayName.localeCompare(b.displayName, 'ja');

/** 「10/12（月）」 */
export const dateText = (d: string) =>
  `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}（${WEEKDAY_LABELS[weekday(d)]}）`;
