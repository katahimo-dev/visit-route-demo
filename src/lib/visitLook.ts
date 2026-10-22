// 訪問の帯の見た目（PRD D339。ADR-0056）の純粋関数：日・週・月・人の予定表のどの帯・行でも同じ印（要対応・資格✗／限✗・未連絡の変更・
// ピン・この回だけ変更・仮押さえ）と色の種類・読み上げの文を返す。印の元は日の状態（lib/month の dayStatus：訪問ごとの検査と
// 伝えた内容との違い）と、その日の問題の可否（unfitMarks）だけ。画面ごとに判定を持たない（「この画面だけ判定が古い」を無くす）
import type { Visit } from '../contracts/documents';
import type { Problem } from '../contracts/problem';
import type { ContactList } from '../contracts/reassign';
import { minutesToHhmm } from '../domain/time';
import { type UnfitMark, unfitMarks } from './week';

/** 印の種類（並びはこの順） */
export type LookMarkKind = 'issue' | 'unfit' | 'told' | 'pin' | 'edited' | 'tentative';

/** 印1つ（short は帯に出す短い文字、title は説明と読み上げ） */
export type LookMark = { kind: LookMarkKind; short: string; title: string; tone: 'red' | 'warn' | 'pin' | 'plain' };

/** 帯の見た目 */
export type VisitLook = {
  marks: LookMark[];
  /** 帯の色の種類：off＝取り消し・休み、unassigned＝担当なし（要対応）、issue＝要対応、null＝ふつう */
  tone: 'issue' | 'unassigned' | 'off' | null;
  /** 読み上げに添える文（印の説明を「・」でつなぐ。無ければ空） */
  text: string;
  /** 印の種類を空白でつないだもの（data-marks。3画面で同じかを確かめる） */
  kinds: string;
};

/** 見た目の元 */
export type LookFacts = {
  visit: Pick<Visit, 'staffId' | 'pinned' | 'cancelled' | 'pattern'>;
  /** 〈利用者さん〉の休みのため無し */
  leave: boolean;
  /** 要対応の中身（訪問ごとの検査の言葉。担当なしも） */
  issues: readonly string[];
  /** 未連絡の変更の中身（「担当 A→B」「時刻 9:00→9:30」。無ければ null） */
  told: string | null;
  /** 担当が種類の必要条件・担当できる人に合わない（資格✗・限✗） */
  unfit: readonly UnfitMark[];
  /** 〈利用者さん〉が仮押さえ */
  tentative: boolean;
};

export const PIN_TITLE = 'ピン（AI で組み直しても担当を変えない）';

/** 見た目を決める。取り消し・休みの回は未連絡の変更（伝えた訪問が外れる）だけを出す */
export function visitLook(f: LookFacts): VisitLook {
  const off = f.visit.cancelled || f.leave;
  const marks: LookMark[] = [];
  if (!off) {
    // 資格✗・限✗があれば、同じことを言う「条件に合わない」の印は重ねない（日の予定の帯と同じ）
    if (f.issues.length > 0 && f.unfit.length === 0)
      marks.push({ kind: 'issue', short: '!', title: `要対応：${f.issues.join('・')}`, tone: 'red' });
    for (const u of f.unfit) marks.push({ kind: 'unfit', short: u.short, title: `${u.short}：${u.why}`, tone: 'red' });
  }
  if (f.told) marks.push({ kind: 'told', short: '未', title: `未連絡の変更：${f.told}`, tone: 'warn' });
  if (!off) {
    if (f.visit.pinned && f.visit.staffId) marks.push({ kind: 'pin', short: 'ピ', title: PIN_TITLE, tone: 'pin' });
    if (f.visit.pattern?.edited) marks.push({ kind: 'edited', short: '変', title: 'この回だけ変更', tone: 'plain' });
    if (f.tentative) marks.push({ kind: 'tentative', short: '仮', title: '仮押さえ（本登録の前）', tone: 'plain' });
  }
  const bad = marks.some((m) => m.tone === 'red');
  const tone = off ? 'off' : bad || f.issues.length > 0 ? (f.visit.staffId ? 'issue' : 'unassigned') : null;
  return {
    marks,
    tone,
    text: marks.map((m) => m.title).join('・'),
    kinds: marks.map((m) => m.kind).join(' '),
  };
}

/** 訪問ごとの未連絡の変更の文（「担当 A→B」「時刻 9:00→9:30」。両方変わればつなぐ「担当 A→B・時刻 9:00→9:30」） */
export function toldTexts(told: ContactList | null, staffName: (id: string) => string): Map<string, string> {
  const out = new Map<string, string>();
  if (!told) return out;
  const name = (id: string | null) => (id ? staffName(id) : 'なし');
  const clock = (m: number | null) => (m === null ? '—' : minutesToHhmm(Math.round(m)).replace(/^0/, ''));
  for (const c of told.staffChanged) out.set(c.visitId, `担当 ${name(c.fromStaffId)}→${name(c.toStaffId)}`);
  for (const c of told.timeChanged) {
    const t = `時刻 ${clock(c.fromStart)}→${clock(c.toStart)}`;
    const had = out.get(c.visitId);
    out.set(c.visitId, had ? `${had}・${t}` : t);
  }
  return out;
}

/** 1日の状態から、その日の訪問の見た目の元を引く形 */
export type DayLookSource = {
  /** 要対応（訪問ID → 検査の言葉） */
  issues: ReadonlyMap<string, readonly { label: string }[]>;
  /** 伝えた内容との違い（伝えていない日は null） */
  told: ContactList | null;
  /** その日の問題（資格✗・限✗を見る。無ければ null） */
  problem: Problem | null;
};

/**
 * その日の訪問の見た目（訪問 → VisitLook）。leaveOf は〈利用者さん〉の休みか、tentativeOf は仮押さえか。
 * past（今日より前の日）は要対応・資格✗／限✗を出さない（月のマス・ホームと同じく、今日より前は要対応に数えない）。
 * 日・週・月・人の予定表で同じ関数を通す
 */
export function dayLooks(
  src: DayLookSource,
  visits: readonly Pick<Visit, 'id' | 'staffId' | 'pinned' | 'cancelled' | 'pattern' | 'clientId'>[],
  opts: {
    staffName: (id: string) => string;
    leaveOf: (v: { id: string; clientId: string }) => boolean;
    tentativeOf: (clientId: string) => boolean;
    past?: boolean;
  },
): Map<string, VisitLook> {
  const told = toldTexts(src.told, opts.staffName);
  const out = new Map<string, VisitLook>();
  for (const v of visits) {
    const off = v.cancelled || opts.leaveOf(v);
    const quiet = off || !!opts.past;
    out.set(
      v.id,
      visitLook({
        visit: v,
        leave: !v.cancelled && opts.leaveOf(v),
        issues: quiet ? [] : (src.issues.get(v.id) ?? []).map((x) => x.label),
        told: told.get(v.id) ?? null,
        unfit: quiet ? [] : unfitMarks(src.problem, v.id, v.staffId),
        tentative: opts.tentativeOf(v.clientId),
      }),
    );
  }
  return out;
}
