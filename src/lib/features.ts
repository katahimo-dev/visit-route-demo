// 機能の入り切り（PRD D210〜D213・D216。ADR-0028。design.md §4 features）の表と、入り切りの判定・ひな形を決める純粋関数。
// 機能の名前・説明・グループ・依存・その機能の URL・切ると隠れるもの・ひな形の入り切りはここの1か所。
// メニュー（lib/nav）・ルート（app/App）・パレット（lib/commandPalette）・ホーム（lib/home）・ツアー（lib/tour）・
// 行き先（lib/links）はここから引く。データは書き換えない（入り切りを書くのは画面の update(fn)）
import type { CalcFeatures, DemoData } from '../contracts/data';
import type { Pattern, Terms } from '../contracts/documents';
import { CALC_FEATURE_IDS, FEATURE_IDS, type FeatureId, type Features, isFeatureId } from '../contracts/features';
import { isRequestedOff } from './requestedOff';

/** 機能のグループ（管理者設定のスイッチの並び。メニューのグループにそろえる（PRD D232。ADR-0034）。メニューに無い連絡・データは後ろ） */
export const FEATURE_GROUPS = ['予定', '当日・問い合わせ', '人', 'AI の条件', '連絡', 'データ'] as const;
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
 * 機能の表（20。ADR-0028 の「機能の一覧」）。土台（ホーム・月の予定・週の予定・日の予定・〈利用者さん〉一覧・〈スタッフ〉一覧・
 * 勤務時間（シフト）・訪問の種類・データ・管理者設定）は表に入れず、切れない
 */
export const FEATURES: readonly FeatureDef[] = [
  {
    id: 'patternMonthly',
    label: '毎月の第N曜日・曜日ごとの時刻',
    description: '定期パターンで「毎月の第N週」や、曜日ごとに違う時刻を決められます',
    group: '予定',
    paths: [],
    hides: '定期パターンの欄の「毎月の第N週」「曜日ごとの時刻」（毎週〜4週ごと・同じ時刻は残る）',
  },
  {
    id: 'clientLeave',
    label: '{client}の休み',
    description: '入院などで{client}が休む期間を入れ、その間は訪問を入れません',
    group: '予定',
    paths: [],
    hides: '{client}の欄の休み、休みの帯・点、月の要対応の「休みの人に訪問」',
  },
  {
    id: 'requestedOff',
    label: '希望休のまとめ入力',
    description: '月の予定で{staff}の希望休をまとめて入れられます',
    group: '予定',
    paths: [],
    hides: '月の「休みを入れる」（希望休は残り計算に効く。「休みの人に N」の印も出る）',
  },
  {
    id: 'monthPrint',
    label: '月の予定の印刷',
    description: '月の予定を紙のカレンダーの代わりに印刷できます',
    group: '予定',
    paths: ['/month/print'],
    hides: '月の予定の「その他 ▾」の印刷、月の印刷の画面',
  },
  {
    id: 'compare',
    label: '案を比べる',
    description: '同じ日の2つの案を並べて、点数と違いを比べられます',
    group: '予定',
    paths: ['/compare'],
    hides: '比較の画面（パレット・「案を変える ▾」の比べる・戻す）',
  },
  {
    id: 'sudden',
    label: '欠勤・キャンセル',
    description: '急な欠勤・当日キャンセルを登録し、その日の案を振り直します',
    group: '当日・問い合わせ',
    paths: [],
    doParams: [{ path: '/plan', do: 'absence' }],
    hides: '欠勤・キャンセルの入口と欄（登録・振り直しを始める所）',
  },
  {
    id: 'vacancy',
    label: '空き状況',
    description: '新しい依頼の曜日・時間に、入れる人と空きを見ます',
    group: '当日・問い合わせ',
    paths: ['/vacancy'],
    hides: 'メニュー・下のタブ・空き状況の画面、仮押さえ',
  },
  {
    id: 'vacancyNotice',
    label: '空き枠の案内文',
    description: '空き状況から、紹介元へ送る空き枠の案内文を作ります',
    group: '当日・問い合わせ',
    requires: 'vacancy',
    paths: [],
    hides: '空き状況の4段目の案内文',
  },
  {
    id: 'compat',
    label: '相性',
    description: '{staff}と{client}の相性（◎〜×）を AI案に効かせます',
    group: 'AI の条件',
    paths: ['/compat'],
    hides: '設定の「相性」のタブ・相性の画面、閲覧の欄の相性、条件の「相性」',
  },
  {
    id: 'allowedStaff',
    label: '担当を限る',
    description: '{client}ごとに、担当できる{staff}を決められます',
    group: 'AI の条件',
    paths: [],
    hides: '{client}の「担当できる人」、絞り込みのチップ',
  },
  {
    id: 'clientStage',
    label: '段階・紹介元',
    description: '相談受付 → 契約 → 利用中の段階と、紹介元を記録します',
    group: '人',
    paths: [],
    hides: '段階の5つの選択・紹介元の欄（切ると「利用中／終了」の2つだけ選べる。段階のデータは残す）',
  },
  {
    id: 'visitNotes',
    label: '訪問先の決まりごと',
    description: '入り方・鍵・駐車場・注意を記録して、予定と一緒に見られます',
    group: '人',
    paths: [],
    hides: '入り方・鍵・駐車場・注意の欄と表示',
  },
  {
    id: 'offboard',
    label: '退職・担当替え',
    description: '{staff}の最終勤務日を入れ、担当をまとめて振り直します',
    group: '人',
    paths: [],
    hides: '最終勤務日の欄と一括の振り直し、名簿の読み込みの知らせ',
  },
  {
    id: 'workload',
    label: '勤務の見込み',
    description: '{staff}ごとの月の稼働・拘束の見込みを見ます',
    group: '人',
    paths: ['/workload'],
    hides: '勤務の見込みの画面（勤務時間（シフト）・月の予定から開く入口）、拘束の上限の帯、行き止まりから移るリンク',
  },
  {
    id: 'fare',
    label: '交通費',
    description: '勤務の見込みに、移動の距離から交通費の見込みを出します',
    group: '人',
    requires: 'workload',
    paths: [],
    hides: '勤務の見込みの交通費の列と単価の欄',
  },
  {
    id: 'rules',
    label: '条件の重みとプリセット',
    description: 'AI案の条件の重み・特性の項目・プリセットを変えられます',
    group: 'AI の条件',
    paths: ['/rules', '/items'],
    // 「今日の案を試す重みで作り直す」（lib/rebuildBand の recreateTodayHref）も作り直しの帯の続きなのでこの機能
    doParams: [{ path: '/plan', do: 'recreate' }],
    hides:
      '設定の「条件の重み」「特性の項目」のタブと画面、点数の理由、作り直しの帯（切ると基準のプリセットだけで作る）',
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
 * 比べるためのパス：小文字にし、末尾の `/` を落とす（ルーターは大文字小文字・末尾の `/` を区別せずに同じ画面を開くので、
 * `#/Vacancy`・`#/vacancy/`・`#/month/print/` でガードをすり抜けさせない）。`/` だけならそのまま
 */
const normalizePath = (pathname: string): string => pathname.toLowerCase().replace(/\/+$/, '') || '/';

/**
 * その URL（HashRouter の中のパスとクエリ）を開くのに要る機能。土台の画面・操作なら null。
 * パスがその機能の画面か、パスと `?do=` がその機能の入口なら、その機能（パスは normalizePath で比べる）
 */
export function featureOfLocation(pathname: string, search: string): FeatureId | null {
  const path = normalizePath(pathname);
  const op = new URLSearchParams(search).get('do');
  for (const f of FEATURES) {
    if (f.paths.includes(path)) return f.id;
    if (op !== null && f.doParams?.some((d) => d.path === path && d.do === op)) return f.id;
  }
  return null;
}

/**
 * リンクの URL（`/plan?date=…&do=absence`・`/rules#presets` の形）に要る機能
 * （`#` から後を落とし、featureOfLocation をパスとクエリに分けて呼ぶ）
 */
export function featureOfHref(href: string): FeatureId | null {
  const h = href.indexOf('#');
  const url = h < 0 ? href : href.slice(0, h);
  const i = url.indexOf('?');
  return i < 0 ? featureOfLocation(url, '') : featureOfLocation(url.slice(0, i), url.slice(i));
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
      '基本に、勤務の見込み・交通費・退職・担当替え・段階・紹介元。拘束時間・交通費・人の入れ替わりを見たいとき',
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

/** ひな形を適用したときの入り切り（全20の ID を明示して書く。業種とは連動しない） */
export function applyTemplate(id: TemplateId): Features {
  const on = new Set(templateDef(id).on);
  return Object.fromEntries(FEATURE_IDS.map((f) => [f, on.has(f)])) as Features;
}

/**
 * 今の入り切りがどのひな形と同じか。どれとも違えば 'custom'（無い ID は入なので {} は「すべて」）。
 * 使えるか（isOn。依存を見る）で比べる：依存先を切ったとき、スイッチが入のまま残った依存する機能も切れた扱いにする
 * （見た目が基本と同じなのに「カスタム」にならない。templateDiff と同じ比べ方）
 */
export function matchTemplate(features: Features): TemplateId | 'custom' {
  for (const t of TEMPLATES) {
    const next = applyTemplate(t.id);
    if (FEATURE_IDS.every((f) => isOn(features, f) === isOn(next, f))) return t.id;
  }
  return 'custom';
}

/** ひな形を適用すると入る機能・切れる機能（使えるか（isOn）で比べる。確認ダイアログの文。並びは表の順） */
export function templateDiff(features: Features, id: TemplateId): { on: FeatureId[]; off: FeatureId[] } {
  const next = applyTemplate(id);
  return {
    on: FEATURE_IDS.filter((f) => !isOn(features, f) && isOn(next, f)),
    off: FEATURE_IDS.filter((f) => isOn(features, f) && !isOn(next, f)),
  };
}

/** スイッチを押したあとの入り切り（その機能だけ入・切を明示して書く。ほかは変えない） */
export const withFeature = (features: Features, id: FeatureId, on: boolean): Features => ({ ...features, [id]: on });

/**
 * 計算に効く入り切り（ADR-0028。PRD D214。AiRun.calcFeatures に書く）：相性・担当を限るのうち、切っているものだけを書く
 * （すべて入なら {}。無い ID は入なので、記録が無い古いデータと同じ）
 */
export function calcFeaturesOf(features: Features): CalcFeatures {
  const out: CalcFeatures = {};
  for (const id of CALC_FEATURE_IDS) if (!isOn(features, id)) out[id] = false;
  return out;
}

/** 計算に効く入り切りが同じか（無い ID は入。記録に calcFeatures が無ければすべて入） */
export function sameCalcFeatures(a: CalcFeatures | undefined, b: CalcFeatures | undefined): boolean {
  return CALC_FEATURE_IDS.every((id) => (a?.[id] !== false) === (b?.[id] !== false));
}

/** 切るときに残る・外れるデータ（D215）：件数と、確認ダイアログに出す1行の文 */
export type TurnOffImpact = { count: number; text: string };

/** 定期パターンのうち、毎月の第N週か曜日ごとの時刻を使うもの */
const usesMonthly = (p: Pattern): boolean => p.repeat === 'monthly' || p.dayTimes.length > 0;

/**
 * その機能を切るときに残る・外れるデータの件数と効き方（D215。管理者設定の確認ダイアログの文）。
 * 計算から外れるのは好み・社内の決まり（相性・担当を限る）、事実（休み・希望休・欠勤・最終勤務日・パターン・仮押さえ）は残って効き続ける。
 * 画面から隠れるだけのデータ（段階・紹介元・決まりごと・メールアドレス）は残ると出す。
 * 数えるのは計算に効くものだけ：相性は利用中の〈利用者さん〉×休止でない〈スタッフ〉の組、担当を限るは限った人に休止でない人がいる
 * 利用中の〈利用者さん〉（compile と同じ）、休み・希望休・欠勤は今日（today。YYYY-MM-DD）以降に掛かるもの。
 * 件数の数え方の決まった機能でデータが無い・数えない機能は null（確認を出さない）。Date.now は使わない（今日は引数）
 */
export function turnOffImpact(
  data: Pick<DemoData, 'org' | 'compat' | 'clients' | 'staff' | 'clientLeaves' | 'absences' | 'patterns'>,
  id: FeatureId,
  today: string,
): TurnOffImpact | null {
  const { client, staff } = data.org.terms;
  const one = (count: number, text: string): TurnOffImpact | null => (count > 0 ? { count, text } : null);
  /** 計算に入る（利用中・仮押さえの）〈利用者さん〉と、休止でない〈スタッフ〉（compile と同じ） */
  const activeClients = new Set(data.clients.filter((c) => c.active).map((c) => c.id));
  const activeStaff = new Set(data.staff.filter((x) => x.active).map((x) => x.id));
  switch (id) {
    case 'compat': {
      let n = 0;
      for (const [cid, row] of Object.entries(data.compat)) {
        if (!activeClients.has(cid)) continue;
        for (const [sid, level] of Object.entries(row)) if (level !== 0 && activeStaff.has(sid)) n++;
      }
      return one(n, `相性 ${n}組は計算から外れます`);
    }
    case 'allowedStaff': {
      const n = data.clients.filter(
        (c) => activeClients.has(c.id) && c.allowedStaffIds.some((sid) => activeStaff.has(sid)),
      ).length;
      return one(n, `担当を限る ${n}人（${client}）は計算から外れます`);
    }
    case 'clientLeave': {
      const n = data.clientLeaves.filter((l) => l.to >= today).length;
      return one(n, `${client}の休み ${n}件は残り、計算に効き続けます`);
    }
    case 'patternMonthly': {
      const n = data.patterns.filter(usesMonthly).length;
      return one(n, `定期パターンの毎月・曜日ごとの時刻 ${n}件は残り、訪問は今どおり作られます`);
    }
    case 'requestedOff': {
      const n = data.absences.filter((a) => a.date >= today && isRequestedOff(a)).length;
      return one(n, `希望休 ${n}件は残り、計算に効き続けます`);
    }
    case 'sudden': {
      const n = data.absences.filter((a) => a.date >= today && !isRequestedOff(a)).length;
      return one(n, `欠勤 ${n}件は残り、計算に効き続けます`);
    }
    case 'vacancy': {
      const n = data.clients.filter((c) => c.tentative).length;
      return one(n, `仮押さえ ${n}人（${client}）は残り、AI案に入り続けます`);
    }
    case 'offboard': {
      const n = data.staff.filter((s) => s.lastDay !== null).length;
      return one(n, `最終勤務日 ${n}人（${staff}）は残り、計算に効き続けます`);
    }
    case 'clientStage': {
      const n = data.clients.filter(
        (c) => (c.stage !== 'active' && c.stage !== 'ended') || c.referrer.name.trim() !== '',
      ).length;
      return one(n, `段階・紹介元 ${n}人（${client}）は残ります（段階は今の名前で出ます）`);
    }
    case 'visitNotes': {
      const n = data.clients.filter((c) =>
        [c.entryNote, c.keyNote, c.parkingNote, c.cautionNote].some((x) => x.trim() !== ''),
      ).length;
      return one(n, `訪問先の決まりごと ${n}人（${client}）は残ります`);
    }
    case 'mail': {
      const n = data.staff.filter((s) => s.email.trim() !== '').length;
      return one(n, `メールアドレス ${n}人（${staff}）は残ります`);
    }
    default:
      return null;
  }
}
