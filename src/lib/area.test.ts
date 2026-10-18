// 住所から地区を取り出す（PRD D110。ADR-0021）
import { describe, expect, it } from 'vitest';
import { CLIENT_SEEDS, STAFF_SEEDS } from '../seed/people';
import { areaOf } from './area';

describe('areaOf：デモの初期データの住所', () => {
  it('〈利用者さん〉の住所はすべて 政令市＋区 と町名に分かれる', () => {
    const expected: Record<string, [string, string]> = {
      '仙台市青葉区春日町（せんだいメディアテーク）': ['仙台市青葉区', '春日町'],
      '仙台市太白区八木山本町（八木山動物公園）': ['仙台市太白区', '八木山本町'],
      '仙台市泉区泉中央（泉図書館）': ['仙台市泉区', '泉中央'],
      '仙台市若林区南小泉（若林図書館）': ['仙台市若林区', '南小泉'],
      '仙台市青葉区川内（仙台市博物館）': ['仙台市青葉区', '川内'],
      '仙台市青葉区台原森林公園（仙台市科学館）': ['仙台市青葉区', '台原森林公園'],
      '仙台市青葉区錦ケ丘（仙台市天文台）': ['仙台市青葉区', '錦ケ丘'],
      '仙台市青葉区北根（仙台文学館）': ['仙台市青葉区', '北根'],
      '仙台市太白区長町南（地底の森ミュージアム）': ['仙台市太白区', '長町南'],
      '仙台市青葉区桜ケ岡公園（仙台市民会館）': ['仙台市青葉区', '桜ケ岡公園'],
      '仙台市若林区卸町（中央卸売市場）': ['仙台市若林区', '卸町'],
      '仙台市若林区荒浜（震災遺構 荒浜小学校）': ['仙台市若林区', '荒浜'],
      '仙台市若林区荒井（せんだい3.11メモリアル交流館）': ['仙台市若林区', '荒井'],
      '仙台市青葉区川内（仙台城跡）': ['仙台市青葉区', '川内'],
      '仙台市泉区七北田（七北田公園）': ['仙台市泉区', '七北田'],
      '仙台市宮城野区宮城野（仙台市陸上競技場）': ['仙台市宮城野区', '宮城野'],
      '仙台市青葉区木町通（仙台市交通局）': ['仙台市青葉区', '木町通'],
      '仙台市青葉区五橋（仙台市福祉プラザ）': ['仙台市青葉区', '五橋'],
      '仙台市宮城野区五輪（宮城野区文化センター）': ['仙台市宮城野区', '五輪'],
      '仙台市太白区中田（中田市民センター）': ['仙台市太白区', '中田'],
    };
    expect(CLIENT_SEEDS).toHaveLength(Object.keys(expected).length);
    for (const c of CLIENT_SEEDS) {
      const e = expected[c.address];
      expect(e, c.address).toBeDefined();
      expect(areaOf(c.address), c.address).toEqual({ city: e![0], town: e![1] });
    }
  });
  it('〈スタッフ〉の自宅の住所も取り出せる（丁目の前で切る・町の付く町名はそのまま）', () => {
    for (const s of STAFF_SEEDS) expect(areaOf(s.address), s.address).not.toBeNull();
    expect(areaOf('仙台市青葉区国分町3丁目（仙台市役所）')).toEqual({ city: '仙台市青葉区', town: '国分町' });
    expect(areaOf('仙台市青葉区堤通雨宮町（仙台市消防局）')).toEqual({ city: '仙台市青葉区', town: '堤通雨宮町' });
    expect(areaOf('仙台市太白区長町（長町小学校）')).toEqual({ city: '仙台市太白区', town: '長町' });
  });
});

describe('areaOf：県から始まる住所・郡・政令市でない市', () => {
  it('都道府県を外す', () => {
    expect(areaOf('宮城県仙台市青葉区国分町3-7-1')).toEqual({ city: '仙台市青葉区', town: '国分町' });
    expect(areaOf('宮城県 名取市増田1丁目')).toEqual({ city: '名取市', town: '増田' });
    expect(areaOf('神奈川県横浜市中区本町6丁目')).toEqual({ city: '横浜市中区', town: '本町' });
    expect(areaOf('東京都千代田区丸の内１丁目')).toEqual({ city: '千代田区', town: '丸の内' });
    expect(areaOf('鹿児島県鹿児島市山下町11-1')).toEqual({ city: '鹿児島市', town: '山下町' });
  });
  it('郡は 郡＋町村 を市区にする', () => {
    expect(areaOf('宮城県宮城郡七ヶ浜町汐見台1-2')).toEqual({ city: '宮城郡七ヶ浜町', town: '汐見台' });
    expect(areaOf('黒川郡大和町吉岡')).toEqual({ city: '黒川郡大和町', town: '吉岡' });
    expect(areaOf('宮城県加美郡色麻村四竈')).toEqual({ city: '加美郡色麻村', town: '四竈' });
  });
  it('名前に「郡」「市」を含む市を切り違えない', () => {
    expect(areaOf('奈良県大和郡山市北郡山町')).toEqual({ city: '大和郡山市', town: '北郡山町' });
    expect(areaOf('三重県四日市市諏訪町1-5')).toEqual({ city: '四日市市', town: '諏訪町' });
    expect(areaOf('千葉県市川市八幡1丁目')).toEqual({ city: '市川市', town: '八幡' });
  });
  it('町村・町名に「市」が入っても取り違えない', () => {
    expect(areaOf('北海道余市郡余市町黒川町1丁目')).toEqual({ city: '余市郡余市町', town: '黒川町' });
    expect(areaOf('富山県中新川郡上市町横法音寺40')).toEqual({ city: '中新川郡上市町', town: '横法音寺' });
    expect(areaOf('奈良県吉野郡下市町下市2770')).toEqual({ city: '吉野郡下市町', town: '下市' });
    expect(areaOf('栃木県芳賀郡市貝町市塙1280')).toEqual({ city: '芳賀郡市貝町', town: '市塙' });
    expect(areaOf('東京都新宿区市谷加賀町1丁目')).toEqual({ city: '新宿区', town: '市谷加賀町' });
    expect(areaOf('福岡県小郡市小郡255-1')).toEqual({ city: '小郡市', town: '小郡' });
  });
  it('市と区・郡と町村のあいだの空白は詰める', () => {
    expect(areaOf('仙台市 青葉区 国分町3丁目')).toEqual({ city: '仙台市青葉区', town: '国分町' });
    expect(areaOf('宮城郡 七ヶ浜町 汐見台')).toEqual({ city: '宮城郡七ヶ浜町', town: '汐見台' });
  });
  it('町名が無く丁目だけなら、その丁目を町名にする', () => {
    expect(areaOf('仙台市若林区六丁目')).toEqual({ city: '仙台市若林区', town: '六丁目' });
    expect(areaOf('仙台市若林区6丁目12-3')).toEqual({ city: '仙台市若林区', town: '6丁目' });
  });
  it('町名は 数字・丁目・番地・括弧・空白 の前まで（漢数字の丁目も）', () => {
    expect(areaOf('仙台市青葉区一番町4丁目')).toEqual({ city: '仙台市青葉区', town: '一番町' });
    expect(areaOf('仙台市青葉区国分町三丁目7-1')).toEqual({ city: '仙台市青葉区', town: '国分町' });
    expect(areaOf('仙台市青葉区国分町 3-7')).toEqual({ city: '仙台市青葉区', town: '国分町' });
    expect(areaOf('仙台市青葉区国分町１２３番地')).toEqual({ city: '仙台市青葉区', town: '国分町' });
    expect(areaOf('仙台市青葉区(仙台市役所)')).toEqual({ city: '仙台市青葉区', town: '' });
    expect(areaOf('名取市')).toEqual({ city: '名取市', town: '' });
  });
  it('頭の郵便番号と前後の空白を外す', () => {
    expect(areaOf('  〒980-8671 仙台市青葉区国分町3丁目  ')).toEqual({ city: '仙台市青葉区', town: '国分町' });
    expect(areaOf('9808671仙台市泉区泉中央1丁目')).toEqual({ city: '仙台市泉区', town: '泉中央' });
    // ハイフンが全角のマイナス・長音でも外す
    expect(areaOf('〒980−8671 仙台市青葉区国分町')).toEqual({ city: '仙台市青葉区', town: '国分町' });
    expect(areaOf('980ー8671 仙台市青葉区国分町')).toEqual({ city: '仙台市青葉区', town: '国分町' });
  });
});

describe('areaOf：空・形の崩れた住所', () => {
  it('空・空白だけ・null は null', () => {
    expect(areaOf('')).toBeNull();
    expect(areaOf('   ')).toBeNull();
    expect(areaOf(null)).toBeNull();
    expect(areaOf(undefined)).toBeNull();
  });
  it('市・区・町・村が見つからなければ null', () => {
    expect(areaOf('3丁目5-1')).toBeNull();
    expect(areaOf('（不明）')).toBeNull();
    expect(areaOf('あいうえお')).toBeNull();
    expect(areaOf('宮城県')).toBeNull();
    expect(areaOf('〒980-8671')).toBeNull();
  });
});
