// 画面に出る用語の言い換えと短い説明（PRD D174・D175。ADR-0025 追記）。
// 表示だけを変える：契約・データのキー名（span・wait・seed など）は変えない。説明は用語の説明の部品（components/Term）で出す。
// 文の中の〈staff〉〈client〉は事業所の呼び方（org.terms）に置き換える（「お客様」「シッター」を直書きしない）
import type { Terms } from '../contracts/documents';

/** 用語のキー */
export type GlossaryKey =
  | 'span'
  | 'wait'
  | 'seed'
  | 'scoreBase'
  | 'dropped'
  | 'hard'
  | 'travel'
  | 'loadCount'
  | 'freeZero'
  | 'backup'
  | 'terms'
  | 'typeUnfit'
  | 'limitUnfit'
  | 'vacancyCount'
  | 'vacancyEstimate'
  | 'aiPlan'
  | 'pinned'
  | 'confirmed'
  | 'unconfirmed'
  | 'confirmDiff'
  | 'preset'
  | 'attention'
  | 'stale';

export type GlossaryEntry = {
  /** 画面に出す言い換えた名前 */
  label: string;
  /** その場で読める短い説明（1〜2文） */
  text: string;
};

/**
 * 用語の一覧（PRD D174 の表の「言い換える」「説明を付ける」）。長い説明が要るもの（点のしくみ・点数の決め方）は
 * 今の「説明」（Hint）のまま
 */
export const GLOSSARY: Record<GlossaryKey, GlossaryEntry> = {
  span: {
    label: '出勤〜退勤（拘束）',
    text: '最初の訪問の開始から最後の訪問の終わりまでの時間です。自宅との行き帰りは入れません（直行直帰）。',
  },
  wait: {
    label: '空き時間（待ち）',
    text: '訪問と訪問のあいだで、移動を除いて空いている時間です。休憩に使えます。長いほど点が下がります。',
  },
  seed: {
    label: '乱数の種',
    text: 'AI が案を探す順番を決める番号です。同じデータ・同じ番号なら同じ案になります。変えると別の探し方で作ります。',
  },
  scoreBase: {
    label: '点数の基準',
    text: '点数（100点満点）を付けるときに使う考え方（プリセット）です。案を作った考え方が違っても、同じ基準で比べます。',
  },
  dropped: {
    label: '入らない',
    text: 'どの〈staff〉の予定にも入れられなかった訪問の件数です。1件でもあると点が大きく下がります。',
  },
  hard: {
    label: '必須の違反',
    text: '「必須」にした条件・時間の約束・稼働時間を守れていない割当の件数です。0件でないと点は参考になります。',
  },
  travel: {
    label: '移動',
    text: 'その日の全員の移動の合計（分）です。直線距離からの概算で、自宅からの行きと帰りも入れます。',
  },
  loadCount: {
    label: '空きを数える人',
    text: '月のマスの混み具合の棒で、30分ごとに空いている人数を数える〈staff〉です。種類を選ぶと、その種類を担当できる人だけを数えます。',
  },
  freeZero: {
    label: '空き 0人',
    text: 'その30分に手の空いている〈staff〉がいない（働く人はみな訪問か移動中）ことです。',
  },
  backup: {
    label: '控え（バックアップ）',
    text: 'データ一式を1つのファイル（JSON）に書き出したものです。読み込むと、そのときの状態に戻せます。',
  },
  terms: {
    label: '画面での呼び方',
    text: '画面に出す「訪問する人」と「訪問先」の呼び名です（例：〈staff〉・〈client〉）。データの中身は変わりません。',
  },
  typeUnfit: {
    label: '資格✗',
    text: '担当が、訪問の種類に必要な条件（資格など）を満たしていません。',
  },
  limitUnfit: {
    label: '限✗',
    text: '担当できる人を限っている〈client〉で、限った人以外が担当になっています。',
  },
  // 空き状況のマス（PRD D187。区切り8a）
  vacancyCount: {
    label: '受けられる人数',
    text: 'その曜日・開始時刻から新しい訪問を受けられる〈staff〉の人数です。見る週のうち、いちばん少ない週の人数です。',
  },
  vacancyEstimate: {
    label: '目安（約）',
    text: '場所が無いので、訪問の前後の移動を15分ずつと見込んで数えた人数です。場所を入れると移動を含めて数えます。',
  },
  // 予定の組み方の言葉（PRD D242。AI案 → 手直し（固定）→ 確定。何に効くか・何が変わらないかを書く）
  aiPlan: {
    label: 'AI案',
    text: 'AI が条件の重みに沿って組んだ割当の案です。手で直せます。確定するまでは決まった予定になりません。',
  },
  pinned: {
    label: '固定',
    text: '手で担当を決めた訪問です。「固定した訪問は残して、ほかを作り直す」でも担当を変えません。AI に一から作らせると外れます。',
  },
  confirmed: {
    label: '確定',
    text: 'この割当で決めた予定です。〈staff〉の画面・メール・印刷に使い、AI が案を作り直しても変わりません。',
  },
  unconfirmed: {
    label: '未確定',
    text: 'まだ確定していない日です。〈staff〉の画面・メール・印刷には今の案を「案」として出します。',
  },
  confirmDiff: {
    label: '未確定の変更あり',
    text: '確定したあとに今の案を変えた日です。〈staff〉の画面・メール・印刷は、確定し直すまで前の割当のままです。',
  },
  preset: {
    label: 'プリセット',
    text: '条件の重みと必須に名前を付けた組み方です。選ぶとその重みで案を作ります。点数はいつも「点数の基準」で付けます。',
  },
  attention: {
    label: '要対応',
    text: '入らない訪問・休みの人に残る訪問・条件が変わった日など、確かめたい日です。毎回数え直します。まとめて確定には入れません。',
  },
  stale: {
    label: '条件が変わった',
    text: '案を作ったあとに訪問・〈staff〉・勤務時間・条件が変わった日です。作り直すまで今の案は前の条件のままです。確定した割当は変わりません。',
  },
};

/** 説明の文（〈staff〉〈client〉を呼び方に置き換える） */
export function glossaryText(key: GlossaryKey, terms: Terms): string {
  return GLOSSARY[key].text.replaceAll('〈staff〉', terms.staff).replaceAll('〈client〉', terms.client);
}
