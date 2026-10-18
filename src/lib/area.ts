// 住所から地区（市区・町名）を取り出す（PRD D110。ADR-0021）。純粋関数（データは書き換えない・外へ送らない）。
// 地区の手直しの欄は作らない（住所の文字から毎回取り出す）
//
// 規則：
// - 前後の空白・頭の郵便番号（〒980-0000 など）・都道府県を外す
// - 政令市は「市＋区」（例 仙台市青葉区）、それ以外は「市・町・村」（郡は 郡＋町村。例 宮城郡七ヶ浜町）を city にする。
//   東京の特別区（例 千代田区）も区を city にする
// - 続きを、数字・丁目・番地・括弧・空白の前までで切って town にする（「国分町3丁目」→「国分町」）。続きが無ければ ''
// - 市・区・町・村が見つからない住所・空は null（「住所なし」にまとめる）

/** 地区。city は市区（政令市は市＋区）か町村（郡＋町村）、town は町名（無ければ ''） */
export type Area = { city: string; town: string };

/** 都道府県（頭にあれば外す） */
const PREFECTURES = [
  '北海道',
  '青森県',
  '岩手県',
  '宮城県',
  '秋田県',
  '山形県',
  '福島県',
  '茨城県',
  '栃木県',
  '群馬県',
  '埼玉県',
  '千葉県',
  '東京都',
  '神奈川県',
  '新潟県',
  '富山県',
  '石川県',
  '福井県',
  '山梨県',
  '長野県',
  '岐阜県',
  '静岡県',
  '愛知県',
  '三重県',
  '滋賀県',
  '京都府',
  '大阪府',
  '兵庫県',
  '奈良県',
  '和歌山県',
  '鳥取県',
  '島根県',
  '岡山県',
  '広島県',
  '山口県',
  '徳島県',
  '香川県',
  '愛媛県',
  '高知県',
  '福岡県',
  '佐賀県',
  '長崎県',
  '熊本県',
  '大分県',
  '宮崎県',
  '鹿児島県',
  '沖縄県',
] as const;

/** 政令市（区を持つ市。市＋区を city にする） */
const DESIGNATED_CITIES = [
  '札幌市',
  '仙台市',
  'さいたま市',
  '千葉市',
  '横浜市',
  '川崎市',
  '相模原市',
  '新潟市',
  '静岡市',
  '浜松市',
  '名古屋市',
  '京都市',
  '大阪市',
  '堺市',
  '神戸市',
  '岡山市',
  '広島市',
  '北九州市',
  '福岡市',
  '熊本市',
] as const;

/** 名前の中に「市」を含む市（「…市」で短く切らないため） */
const CITIES_WITH_SHI = ['四日市市', '廿日市市', '野々市市'] as const;

/** 町名・市区の名前に使わない文字（数字・括弧・空白・区切り） */
const STOP = '0-9０-９\\s（）()［］\\[\\]「」、,・\\-－‐';
/** 郡＋町村（郡の前と、郡と町村のあいだに「市」を含まない） */
const GUN_RE = new RegExp(`^([^${STOP}市]+?郡)([^${STOP}市]+?[町村])`);
const SHI_RE = new RegExp(`^([^${STOP}]+?市)`);
const KU_RE = new RegExp(`^([^${STOP}]+?区)`);
const CHOSON_RE = new RegExp(`^([^${STOP}]+?[町村])`);
/** 政令市の区（区の名前は1〜5字） */
const WARD_RE = new RegExp(`^([^${STOP}区]{1,5}区)`);
/** 町名の終わり：数字（漢数字の丁目・番地を含む）・丁目・番地・括弧・空白 */
const TOWN_END_RE = /[0-9０-９\s（）()［］[\]「」]|[一二三四五六七八九十〇]+(?:丁目|番地)|丁目|番地/;

/**
 * 住所から地区を取り出す。取り出せなければ null。
 * 例：「仙台市青葉区国分町3丁目（仙台市役所）」→ { city: '仙台市青葉区', town: '国分町' }、
 * 「宮城県宮城郡七ヶ浜町汐見台1-2」→ { city: '宮城郡七ヶ浜町', town: '汐見台' }
 */
export function areaOf(address: string | null | undefined): Area | null {
  let s = (address ?? '').trim();
  if (s === '') return null;
  // 頭の郵便番号（〒・ハイフンの有無を問わない）
  s = s.replace(/^〒?\s*[0-9０-９]{3}[-－‐]?[0-9０-９]{4}\s*/, '');
  const pref = PREFECTURES.find((p) => s.startsWith(p));
  if (pref) s = s.slice(pref.length).trimStart();
  const split = (city: string): Area => ({ city, town: townOf(s.slice(city.length)) });

  const designated = DESIGNATED_CITIES.find((c) => s.startsWith(c));
  if (designated) {
    const ward = WARD_RE.exec(s.slice(designated.length))?.[1];
    return split(designated + (ward ?? ''));
  }
  const withShi = CITIES_WITH_SHI.find((c) => s.startsWith(c));
  if (withShi) return split(withShi);
  const gun = GUN_RE.exec(s);
  if (gun) return split(gun[1]! + gun[2]!);
  const shi = SHI_RE.exec(s)?.[1];
  if (shi) return split(shi);
  const ku = KU_RE.exec(s)?.[1];
  if (ku) return split(ku);
  const choson = CHOSON_RE.exec(s)?.[1];
  if (choson) return split(choson);
  return null;
}

/** 市区のあとの続きから町名を取り出す（頭の空白を外し、数字・丁目・番地・括弧・空白の前まで） */
function townOf(rest: string): string {
  const t = rest.trimStart();
  const m = TOWN_END_RE.exec(t);
  return (m ? t.slice(0, m.index) : t).trim();
}
