// 月のマスの読み方（PRD D177。ADR-0025 追記）：マスにマウスを重ねる・キーボードでフォーカスしたときに出す「このマスの読み方」の文を、
// そのマスに出ている印だけから決める純粋関数。凡例を開かなくても、その場で「休 2」や棒の意味が分かるようにする。データは書き換えない
import { barRowsText } from './barRows';

export type CellGuideInput = {
  /** 表示：全体／〈スタッフ〉1人／〈利用者さん〉1人 */
  focus: 'all' | 'staff' | 'client';
  /** 訪問の件数（取り消しを除く） */
  count: number;
  /** 日の状態の文（案なし・案あり・確定済み・未確定の変更あり）。訪問が無ければ null */
  stateText: string | null;
  /** 要確認（赤い点・赤い枠） */
  care: boolean;
  /** 種類ごとの積み上げの帯があるか */
  types: boolean;
  /** 休む〈スタッフ〉の人数・そのうち希望休 */
  resting: number;
  requested: number;
  absent: boolean;
  starts: boolean;
  ends: boolean;
  leaves: boolean;
  lastDays: boolean;
  /** 混み具合の棒：あり（load）・案が無いので無い（noPlan）・出さない（null） */
  loadBar: 'load' | 'noPlan' | null;
  unassigned: boolean;
  hard: boolean;
  absentLeft: boolean;
  stale: boolean;
  overSpan: boolean;
  /** 〈利用者さん〉の表示で、いつもの担当でない（代）・この回だけ変更（変）の印があるか */
  substitute?: boolean;
  edited?: boolean;
  staffTerm: string;
  clientTerm: string;
};

/**
 * マスの読み方の行（出ている印の順。出ていない印は書かない）。例「休 2＝休む〈スタッフ〉の人数（希＝希望休の人数）」
 * 「下の3段の棒＝30分ごとの空きの人数（高いほど空きが少ない）」
 */
export function cellGuide(x: CellGuideInput): string[] {
  const out: string[] = [];
  if (x.stateText) out.push(`背景の色＝日の状態（${x.stateText}）`);
  else out.push('白い背景＝訪問の無い日');
  if (x.care) out.push('赤い点・赤い枠＝要確認（案が無い・入らない訪問・必須の違反）');
  if (x.focus === 'all') {
    if (x.count > 0) out.push('右上の「N件」＝この日の訪問の件数');
    if (x.types) out.push('色の帯＝訪問の種類ごとの件数');
    if (x.resting > 0)
      out.push(`「休 N」＝休む${x.staffTerm}の人数${x.requested > 0 ? '（「（希 N）」はそのうち希望休の人数）' : ''}`);
    if (x.absent) out.push(`「欠」＝欠勤の${x.staffTerm}`);
    if (x.starts || x.ends) out.push(`▶＝この日から始まる${x.staffTerm}・■＝この日で終わる${x.staffTerm}`);
    if (x.leaves) out.push(`ベッドの印＝${x.clientTerm}の休み（訪問は無し）`);
    if (x.lastDays) out.push(`「最終」＝最終勤務日の${x.staffTerm}`);
  }
  if (x.unassigned) out.push('「入らない N」＝案に入らない訪問の件数');
  if (x.hard) out.push('「違反 N」＝必須の条件を守れていない割当の件数');
  if (x.absentLeft) out.push('「休みの人に N」＝休みの人に残っている訪問の件数（日の画面で振り直す）');
  if (x.stale) out.push('「条件が変わった」＝案を作ったあとに訪問・稼働時間・条件が変わった');
  if (x.overSpan) out.push('「拘束超 N」＝出勤〜退勤（拘束）が上限を超える人数');
  if (x.loadBar === 'load') out.push(`下の3段の棒＝30分ごとの空きの人数（高いほど空きが少ない。${barRowsText()}）`);
  else if (x.loadBar === 'noPlan') out.push('棒が無い＝案が無いので空きを数えていない');
  if (x.focus === 'staff')
    out.push(`棒＝この人の時間帯ごとの状態（訪問・移動・空き・休み。30分ごと。${barRowsText()}）`);
  if (x.focus === 'client') {
    out.push(`時刻と名前＝この${x.clientTerm}の訪問の時刻と担当`);
    if (x.substitute) out.push('「代」＝いつもの担当でない');
    if (x.edited) out.push('「変」＝この回だけ変更した訪問');
  }
  return out;
}
