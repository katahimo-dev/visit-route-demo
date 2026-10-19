// 機能の入り切り（PRD D210〜D213・D216。ADR-0028。design.md §4 features）の表と、入り切りの判定・ひな形を決める純粋関数。
// 機能の名前・説明・グループ・依存・その機能の URL・切ると隠れるもの・ひな形の入り切りはここの1か所。
// メニュー（lib/nav）・ルート（app/App）・パレット（lib/commandPalette）・ホーム（lib/home）・ツアー（lib/tour）・
// 行き先（lib/links）はここから引く。データは書き換えない（入り切りを書くのは画面の update(fn)）
import type { Terms } from '../contracts/documents';
import { FEATURE_IDS, type FeatureId, type Features, isFeatureId } from '../contracts/features';

/** 機能のグループ（管理者設定のスイッチの並び。ADR-0028 の表の順） */
export const FEATURE_GROUPS = [
  '予定を組む',
  '当日の対応',
  '問い合わせ',
  '人の情報',
  'AI の考え方',
  '連絡',
  'データ',
] as const;
export type FeatureGroup = (typeof FEATURE_GROUPS)[number];

/** その機能の操作の入口（`?do=` で画面の中の欄を開く URL。例：欠勤・キャンセル＝ `/plan?do=absence`） */
export type FeatureDoParam = { path: string; do: string };

/** 機能の1行。名前・説明・切ると隠れるものの「{client}」「{staff}」は呼び方（fillTerms）に置き換えて出す */
export type FeatureDef = {
  id: FeatureId;
  label: string;
  /** 1行の説明（何ができるか） */
  description: string;
  group: FeatureGroup;
  /** 依存先（これが切なら、この機能も切れた扱い） */
  requires?: FeatureId;
  /** その機能の画面の URL のパス（切るとルートを開けない・メニューに出さない） */
  paths: readonly string[];
  /** その機能の操作の入口（`?do=`） */
  doParams?: readonly FeatureDoParam[];
  /** 切ると隠れるもの（短い文。ADR-0028 の表） */
  hides: string;
};

/**
 * 機能の表（20。ADR-0028 の「機能の一覧」）。土台（ホーム・月・週・日・〈利用者さん〉一覧・〈スタッフ〉一覧・稼働時間・
 * 訪問の種類・データ・管理者設定）は表に入れず、切れない
 */
export const FEATURES: readonly FeatureDef[] = [
  {
    id: 'patternMonthly',
    label: '毎月の第N曜日・曜日ごとの時刻',
    description: '定期パターンで「毎月の第N週」や、曜日ごとに違う時刻を決められます',
    group: '予定を組む',
    paths: [],
    hides: '定期パターンの欄の「毎月の第N週」「曜日ごとの時刻」（毎週〜4週ごと・同じ時刻は残る）',
  },
  {
    id: 'clientLeave',
    label: '{client}の休み',
    description: '入院などで{client}が休む期間を入れ、その間は訪問を入れません',
    group: '予定を組む',
    paths: [],
    hides: '{client}の欄の休み、休みの帯・点、月の要対応の「休みの人に訪問」',
  },
  {
    id: 'requestedOff',
    label: '希望休のまとめ入力',
    description: '月の画面で{staff}の希望休をまとめて入れられます',
    group: '予定を組む',
    paths: [],
    hides: '月の「休みを入れる」、「休みの人に N」の印',
  },
  {
    id: 'monthPrint',
    label: '月の予定の印刷',
    description: '月の予定を紙のカレンダーの代わりに印刷できます',
    group: '予定を組む',
    paths: ['/month/print'],
    hides: '月の印刷のボタン、月の印刷の画面',
  },
  {
    id: 'compare',
    label: '案を比べる',
    description: '同じ日の2つの案を並べて、点数と違いを比べられます',
    group: '予定を組む',
    paths: ['/compare'],
    hides: 'メニューの「案を比べる」、比較の画面、「案を変える ▾」の比べる・戻す',
  },
  {
    id: 'sudden',
    label: '欠勤・キャンセル',
    description: '急な欠勤・当日キャンセルを登録し、その日の案を振り直します',
    group: '当日の対応',
    paths: [],
    doParams: [{ path: '/plan', do: 'absence' }],
    hides: 'メニュー・ホームのカード・探すの操作・列の見出しの「急な欠勤」・欄、案A・案B、連絡の一覧',
  },
  {
    id: 'vacancy',
    label: '空き状況',
    description: '新しい依頼の曜日・時間に、入れる人と空きを見ます',
    group: '問い合わせ',
    paths: ['/vacancy'],
    hides: 'メニュー・下のタブ・空き状況の画面、仮押さえ',
  },
  {
    id: 'vacancyNotice',
    label: '空き枠の案内文',
    description: '空き状況から、紹介元へ送る空き枠の案内文を作ります',
    group: '問い合わせ',
    requires: 'vacancy',
    paths: [],
    hides: '空き状況の4段目の案内文',
  },
  {
    id: 'compat',
    label: '相性',
    description: '{staff}と{client}の相性（◎〜×）を AI案に効かせます',
    group: '人の情報',
    paths: ['/compat'],
    hides: 'メニュー・相性の画面、閲覧の欄の相性、条件の「相性」',
  },
  {
    id: 'allowedStaff',
    label: '担当を限る',
    description: '{client}ごとに、担当できる{staff}を決められます',
    group: '人の情報',
    paths: [],
    hides: '{client}の「担当できる人」、絞り込みのチップ',
  },
  {
    id: 'clientStage',
    label: '段階・紹介元',
    description: '相談受付 → 契約 → 利用中の段階と、紹介元を記録します',
    group: '人の情報',
    paths: [],
    hides: '段階の5つの選択・紹介元の欄（切ると「利用中／終了」の2つだけ選べる。段階のデータは残す）',
  },
  {
    id: 'visitNotes',
    label: '訪問先の決まりごと',
    description: '入り方・鍵・駐車場・注意を記録して、予定と一緒に見られます',
    group: '人の情報',
    paths: [],
    hides: '入り方・鍵・駐車場・注意の欄と表示',
  },
  {
    id: 'offboard',
    label: '退職・担当替え',
    description: '{staff}の最終勤務日を入れ、担当をまとめて振り直します',
    group: '人の情報',
    paths: [],
    hides: '最終勤務日の欄と一括の振り直し、名簿の読み込みの知らせ',
  },
  {
    id: 'workload',
    label: '稼働の見込み',
    description: '{staff}ごとの月の稼働・拘束の見込みを見ます',
    group: '人の情報',
    paths: ['/workload'],
    hides: 'メニュー・稼働の見込みの画面、拘束の上限の帯、行き止まりから移るリンク',
  },
  {
    id: 'fare',
    label: '交通費',
    description: '稼働の見込みに、移動の距離から交通費の見込みを出します',
    group: '人の情報',
    requires: 'workload',
    paths: [],
    hides: '稼働の見込みの交通費の列と単価の欄',
  },
  {
    id: 'rules',
    label: '条件の重みとプリセット',
    description: 'AI案の条件の重み・特性の項目・プリセットを変えられます',
    group: 'AI の考え方',
    paths: ['/rules', '/items'],
    // 「今日の案をいまの条件で作り直す」（lib/rebuildBand の recreateTodayHref）も作り直しの帯の続きなのでこの機能
    doParams: [{ path: '/plan', do: 'recreate' }],
    hides: 'メニュー・条件の重みと特性の項目の画面、点数の理由、作り直しの帯（切ると基準のプリセットだけで作る）',
  },
  {
    id: 'mail',
    label: 'メール',
    description: '予定・連絡・案内文を、端末のメールアプリで開きます',
    group: '連絡',
    paths: [],
    hides: 'メールのボタン・欄、メールアドレスの欄',
  },
  {
    id: 'mapsLink',
    label: '道順のリンク',
    description: '訪問先への道順を Google マップで開くリンクを出します',
    group: '連絡',
    paths: [],
    hides: 'Google マップのリンク',
  },
  {
    id: 'geocode',
    label: '郵便番号・住所の検索',
    description: '郵便番号・住所から地図の位置を探します',
    group: '連絡',
    paths: [],
    hides: '検索のボタン・まとめて地図に置く（地図のクリックで置くのは残る）',
  },
  {
    id: 'excel',
    label: 'Excel の入出力',
    description: 'データを Excel のブックで書き出し・読み込みします',
    group: 'データ',
    paths: [],
    hides: 'データの画面の Excel の欄（控え（JSON）は残る）',
  },
];

const BY_ID = new Map<FeatureId, FeatureDef>(FEATURES.map((f) => [f.id, f]));

/** 機能の表の1行 */
export const featureDef = (id: FeatureId): FeatureDef => BY_ID.get(id)!;

/** 文の「{client}」「{staff}」を呼び方に置き換える（呼び方は org.terms） */
export const fillTerms = (text: string, terms: Pick<Terms, 'client' | 'staff'>): string =>
  text.replaceAll('{client}', terms.client).replaceAll('{staff}', terms.staff);

/** 機能の名前（呼び方を入れたもの） */
export const featureLabel = (id: FeatureId, terms: Pick<Terms, 'client' | 'staff'>): string =>
  fillTerms(featureDef(id).label, terms);

/** スイッチの状態（依存を見ない。無い ID は入） */
export const isSwitchOn = (features: Features, id: FeatureId): boolean => features[id] !== false;

/** その機能が使えるか：自分のスイッチが入で、依存先も使えるとき（vacancyNotice → vacancy・fare → workload）。無い ID は入 */
export function isOn(features: Features, id: FeatureId): boolean {
  if (!isSwitchOn(features, id)) return false;
  const req = featureDef(id).requires;
  return req ? isOn(features, req) : true;
}

/**
 * その URL（HashRouter の中のパスとクエリ）を開くのに要る機能。土台の画面・操作なら null。
 * パスがその機能の画面か、パスと `?do=` がその機能の入口なら、その機能
 */
export function featureOfLocation(pathname: string, search: string): FeatureId | null {
  const op = new URLSearchParams(search).get('do');
  for (const f of FEATURES) {
    if (f.paths.includes(pathname)) return f.id;
    if (op !== null && f.doParams?.some((d) => d.path === pathname && d.do === op)) return f.id;
  }
  return null;
}

/** リンクの URL（`/plan?date=…&do=absence` の形）に要る機能（featureOfLocation をパスとクエリに分けて呼ぶ） */
export function featureOfHref(href: string): FeatureId | null {
  const i = href.indexOf('?');
  return i < 0 ? featureOfLocation(href, '') : featureOfLocation(href.slice(0, i), href.slice(i));
}

/** その URL へ移れるか（土台か、要る機能が使える） */
export function isHrefOn(features: Features, href: string): boolean {
  const id = featureOfHref(href);
  return id === null || isOn(features, id);
}

/** 切った機能の URL からホームへ移したときに、ルートの state に載せるもの（ホームの上の知らせ。PRD D213） */
export type FeatureOffState = { featureOff: FeatureId };

/** ルートの state が FeatureOffState か（知らない値・古い履歴の state は違う） */
export function isFeatureOffState(state: unknown): state is FeatureOffState {
  if (typeof state !== 'object' || state === null) return false;
  const v = (state as { featureOff?: unknown }).featureOff;
  return typeof v === 'string' && isFeatureId(v);
}

/** ひな形の ID（ADR-0028 の「ひな形」。法人名を出さず機能のまとまりの名前） */
export const TEMPLATE_IDS = ['basic', 'laborContract', 'monthlyField', 'all'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** ひな形：名前・1行の説明・入れる機能（ほかは切） */
export type TemplateDef = { id: TemplateId; label: string; description: string; on: readonly FeatureId[] };

/** 基本のひな形で入れる機能（予定・欠勤・キャンセル・空き状況・相性・道順のリンク・住所の検索） */
const BASIC_ON: readonly FeatureId[] = ['sudden', 'vacancy', 'compat', 'mapsLink', 'geocode'];

/** ひな形の4つ（ADR-0028 の表どおり） */
export const TEMPLATES: readonly TemplateDef[] = [
  {
    id: 'basic',
    label: '基本',
    description:
      '予定（月・週・日）と欠勤・キャンセル・空き状況・相性・道順・住所の検索だけ。まず割当と当日の対応を見たいとき',
    on: BASIC_ON,
  },
  {
    id: 'laborContract',
    label: '労務・契約管理',
    description:
      '基本に、稼働の見込み・交通費・退職・担当替え・段階・紹介元。拘束時間・交通費・人の入れ替わりを見たいとき',
    on: [...BASIC_ON, 'clientStage', 'offboard', 'workload', 'fare'],
  },
  {
    id: 'monthlyField',
    label: '月次予定・現場共有',
    description:
      '基本に、第N曜日・曜日ごとの時刻・休み・希望休・月の印刷・案内文・担当を限る・決まりごと・Excel。月の予定が複雑なとき',
    on: [
      ...BASIC_ON,
      'patternMonthly',
      'clientLeave',
      'requestedOff',
      'monthPrint',
      'vacancyNotice',
      'allowedStaff',
      'visitNotes',
      'excel',
    ],
  },
  {
    id: 'all',
    label: 'すべて',
    description: 'すべての機能を入れます。条件を試す・全機能を見せるとき',
    on: FEATURE_IDS,
  },
];

/** ひな形の1つ */
export const templateDef = (id: TemplateId): TemplateDef => TEMPLATES.find((t) => t.id === id)!;

/** ひな形を当てたときの入り切り（全20の ID を明示して書く。業種とは連動しない） */
export function applyTemplate(id: TemplateId): Features {
  const on = new Set(templateDef(id).on);
  return Object.fromEntries(FEATURE_IDS.map((f) => [f, on.has(f)])) as Features;
}

/** 今の入り切り（スイッチの状態）がどのひな形と同じか。どれとも違えば 'custom'（無い ID は入なので {} は「すべて」） */
export function matchTemplate(features: Features): TemplateId | 'custom' {
  for (const t of TEMPLATES) {
    const on = new Set(t.on);
    if (FEATURE_IDS.every((f) => isSwitchOn(features, f) === on.has(f))) return t.id;
  }
  return 'custom';
}

/** ひな形を当てると入る機能・切れる機能（使えるか（isOn）で比べる。確認ダイアログの文。並びは表の順） */
export function templateDiff(features: Features, id: TemplateId): { on: FeatureId[]; off: FeatureId[] } {
  const next = applyTemplate(id);
  return {
    on: FEATURE_IDS.filter((f) => !isOn(features, f) && isOn(next, f)),
    off: FEATURE_IDS.filter((f) => isOn(features, f) && !isOn(next, f)),
  };
}

/** スイッチを押したあとの入り切り（その機能だけ入・切を明示して書く。ほかは変えない） */
export const withFeature = (features: Features, id: FeatureId, on: boolean): Features => ({ ...features, [id]: on });
