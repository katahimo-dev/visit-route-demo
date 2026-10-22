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
  | 'stale'
  | 'score'
  | 'dayWeights';

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
    text: '最初の訪問の開始から、最後の訪問の終わりまでの時間です。自宅との行き帰りは入れません。',
  },
  wait: {
    label: '空き時間（待ち）',
    text: '訪問と訪問のあいだの、移動を除いた空き時間です。休憩に使えます。長いほど点が下がります。',
  },
  seed: {
    label: '乱数の種',
    text: 'AI が案を探す順番を決める番号です。同じデータで同じ番号なら、同じ案になります。',
  },
  scoreBase: {
    label: '点数の基準',
    text: 'ふだん使う重みです。月のまとめて作る・自動で作る・作り直すはこの重みで作り、点数もこの重みで付けます。',
  },
  dropped: {
    label: '入らない',
    text: 'どの〈staff〉の予定にも入れられなかった訪問の数です。1件でもあると点が大きく下がります。',
  },
  hard: {
    label: '守れない条件',
    text: '「必須」にした条件・約束の時間・働ける時間を守れていない訪問の数です。1件でもあると、点数は参考です。',
  },
  travel: {
    label: '移動',
    text: 'その日の全員の移動の合計（分）です。直線距離から見積もり、自宅との行き帰りも入れます。',
  },
  loadCount: {
    label: '空きを数える人',
    text: '月のマスの混み具合で、空いている人数を数える〈staff〉です。種類を選ぶと、その種類を担当できる人だけを数えます。',
  },
  freeZero: {
    label: '空き 0人',
    text: 'その30分に、手の空いている〈staff〉がいないことです。',
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
    text: 'その曜日・時刻から新しい訪問を受けられる〈staff〉の人数です。見る週のうち、いちばん少ない週の数です。',
  },
  vacancyEstimate: {
    label: '目安（約）',
    text: '場所が無いので、前後の移動を15分ずつと見込んだ人数です。場所を入れると、移動も含めて数えます。',
  },
  // 予定の組み方の言葉（PRD D242。AI案 → 手直し（ピン）→ 確定。何に効くか・何が変わらないかを書く）
  aiPlan: {
    label: 'AI案',
    text: 'AI が条件に沿って組んだ割当の案です。確定するまでは、決まった予定になりません。',
  },
  pinned: {
    label: 'ピン',
    text: '担当を手で決めた訪問の印です。AI が作り直しても、ピンの付いた訪問の担当は変わりません。',
  },
  confirmed: {
    label: '確定',
    text: 'この割当で決めた予定です。〈staff〉の画面・メール・印刷に使い、AI が案を作り直しても変わりません。',
  },
  unconfirmed: {
    label: '未確定',
    text: 'まだ確定していない日です。〈staff〉の画面・メール・印刷には今の案を出します。',
  },
  confirmDiff: {
    label: '未確定の変更あり',
    text: '確定したあとに案を変えた日です。確定し直すまで、〈staff〉の画面・メール・印刷は前の割当のままです。',
  },
  preset: {
    label: 'プリセット',
    text: '重みと必須の組み合わせに名前を付けたものです。選ぶと、その重みで案を作ります。',
  },
  attention: {
    label: '要対応',
    text: '入らない訪問・休みの人に残る訪問・条件が変わった日など、確かめたい日です。まとめて確定には入れません。',
  },
  // 点数の付け方（帯・説明の文から仕組みの説明をここへ寄せる。PRD D307）
  score: {
    label: '点数',
    text: '案のよさを100点満点で表します。高いほど良い案です。条件を変えても、点数はいつも点数の基準の重みで付けます。',
  },
  dayWeights: {
    label: 'この日だけの重み',
    text: '日の予定の「条件を調整する」で変えた重みです。その日の「AI にもう一度作らせる」だけで使います。',
  },
  stale: {
    label: '条件が変わった',
    text: '案を作ったあとに、訪問・〈staff〉・働ける時間・重みなどが変わった日です。作り直すと今の条件で組み直します。確定した割当は変わりません。',
  },
};

/** 説明の文（〈staff〉〈client〉を呼び方に置き換える） */
export function glossaryText(key: GlossaryKey, terms: Terms): string {
  return GLOSSARY[key].text.replaceAll('〈staff〉', terms.staff).replaceAll('〈client〉', terms.client);
}
