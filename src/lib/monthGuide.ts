// 月のマスの読み方（PRD D177。ADR-0025 追記）：マスにマウスを重ねる・キーボードでフォーカスしたときに出す「このマスの読み方」の文を、
// そのマスに出ている印だけから決める純粋関数。凡例を開かなくても、その場で「休 2」や棒の意味が分かるようにする。データは書き換えない
import { barRowsText } from './barRows';

export type CellGuideInput = {
  /** 表示：全体／〈スタッフ〉1人／〈利用者さん〉1人 */
  focus: 'all' | 'staff' | 'client';
  /** 訪問の件数（取り消しを除く） */
  count: number;
  /** 日の状態の文（まだ伝えていない・確定済み・未連絡の変更あり）。訪問が無ければ null */
  stateText: string | null;
  /** 要対応（赤い枠。「要対応 N」の札が無い日は赤い点も） */
  care: boolean;
  /** 要対応の札の N（要対応の一覧の行の数。PRD D295。0・省略＝札なし） */
  attention?: number;
  /** 「休 N」をマスに出しているか（PRD D295。ふだんより多い日だけ。省略＝出している） */
  restShown?: boolean;
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
  /** 混み具合の棒：あり（load）・数えられない（noPlan）・出さない（null） */
  loadBar: 'load' | 'noPlan' | null;
  /** 担当なしの訪問がある */
  unassigned: boolean;
  /** 担当なしのほかの要対応（担当が休み・条件に合わない・時間に間に合わない）がある */
  issues: boolean;
  /** 未連絡の変更がある */
  changed: boolean;
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
  if (x.care)
    out.push(
      `${x.attention ? '赤い枠' : '赤い点・赤い枠'}＝要対応（担当なし・担当が休み・条件に合わない・時間に間に合わない）`,
    );
  if (x.attention)
    out.push('赤い「要対応 N」の札＝要対応の件数（右の「要対応」の欄の行の数。要対応の訪問・未連絡の変更・拘束超）');
  if (x.focus === 'all') {
    if (x.count > 0) out.push('右上の「N件」＝この日の訪問の件数');
    if (x.types) out.push('色の帯＝訪問の種類ごとの件数');
    if (x.resting > 0 && x.restShown !== false)
      out.push(`「休 N」＝休む${x.staffTerm}の人数${x.requested > 0 ? '・「（希 N）」＝そのうち希望休の人数' : ''}`);
    if (x.absent) out.push(`「欠」＝欠勤の${x.staffTerm}`);
    if (x.starts || x.ends) out.push(`▶＝この日から始まる${x.staffTerm}・■＝この日で終わる${x.staffTerm}`);
    if (x.leaves) out.push(`ベッドの印＝${x.clientTerm}の休み（訪問は無し）`);
    if (x.lastDays) out.push(`「最終」＝最終勤務日の${x.staffTerm}`);
  }
  if (x.unassigned) out.push('「担当なし N」＝担当の決まっていない訪問の件数');
  if (x.issues) out.push('「担当が休み N」など＝担当を確かめる訪問の件数（日の予定で直す）');
  if (x.changed) out.push('「未連絡 N」＝確定（伝えた）あとに担当・時刻が変わった訪問の件数（連絡の一覧で確かめる）');
  if (x.overSpan) out.push('「拘束超 N」＝出勤〜退勤（拘束）が上限を超える人数');
  if (x.loadBar === 'load') out.push(`下の3段の棒＝30分ごとの空きの人数（高いほど空きが少ない。${barRowsText()}）`);
  else if (x.loadBar === 'noPlan') out.push('棒が無い＝この日は空きを数えられない');
  if (x.focus === 'staff')
    out.push(`棒＝この人の時間帯ごとの状態（訪問・移動・空き・休み。30分ごと。${barRowsText()}）`);
  if (x.focus === 'client') {
    out.push(`時刻と名前＝この${x.clientTerm}の訪問の時刻と担当`);
    if (x.substitute) out.push('「代」＝いつもの担当でない');
    if (x.edited) out.push('「変」＝この回だけ変更した訪問');
  }
  return out;
}

/** 吹き出しに出すマスの文（日付・状態の文・読み方の行） */
export type CellTip = { head: string; text: string; lines: readonly string[] };

/**
 * マスの文の置き場（日付 → 文。PR #42 のレビュー）。マスが描いたあとに自分の文を置き（set）、吹き出しは日付で引く（get）。
 * 描画中に DOM の data-* を読まないので、休みを切り替えたあとも古い文が残らない。中身が同じなら同じものを返す
 * （useSyncExternalStore の getSnapshot に使える）
 */
export function createTipStore() {
  const map = new Map<string, CellTip>();
  const subs = new Set<() => void>();
  const same = (a: CellTip, b: CellTip) =>
    a.head === b.head &&
    a.text === b.text &&
    a.lines.length === b.lines.length &&
    a.lines.every((l, i) => l === b.lines[i]);
  return {
    set(date: string, tip: CellTip) {
      const old = map.get(date);
      if (old && same(old, tip)) return;
      map.set(date, tip);
      for (const f of subs) f();
    },
    get: (date: string): CellTip | null => map.get(date) ?? null,
    subscribe(f: () => void) {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
  };
}
export type TipStore = ReturnType<typeof createTipStore>;
