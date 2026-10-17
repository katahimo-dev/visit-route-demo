import { z } from 'zod';
import { MAX_SLOTS, slotsError } from '../domain/availability';
import { INDUSTRIES, TRAVEL_MODES, WINDOW_KINDS } from './codes';
import { conditionSchema, traitsSchema } from './rules';

/**
 * データ一式（DemoData）の中の1件ごとの形。PoC本体 packages/shared/src/contracts/documents.ts を元に、
 * ログイン・事業所の分離に関わるもの（email・uid・orgId）を除き、特性（traits）と条件を足した（ADR-0002）。
 * PoC本体の requiredGender は「性別」項目＋必要条件、ngStaffIds は相性 ×（-2）に移した。
 */

export const hhmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '時刻は HH:mm で入力してください');
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付は YYYY-MM-DD です');
export const idSchema = z.string().min(1).max(100);

export const latLngSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
export type LatLng = z.infer<typeof latLngSchema>;

export const placeSchema = z.object({
  address: z.string().max(200),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
});
export type Place = z.infer<typeof placeSchema>;

export const termsSchema = z.object({ client: z.string().max(10), staff: z.string().max(10) });
export type Terms = z.infer<typeof termsSchema>;

export const orgSchema = z.object({
  name: z.string().min(1).max(100),
  industry: z.enum(INDUSTRIES),
  terms: termsSchema,
  fareYenPerKm: z.number().min(0).max(1000),
});
export type Org = z.infer<typeof orgSchema>;

export const staffSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(50),
  home: placeSchema,
  travelMode: z.enum(TRAVEL_MODES),
  /** 0=日〜6=土 */
  workDays: z.array(z.number().int().min(0).max(6)).max(7),
  shiftStart: hhmmSchema,
  shiftEnd: hhmmSchema,
  active: z.boolean(),
  /** スタッフの特性（target='staff' の項目の値） */
  traits: traitsSchema,
  /** スタッフ側の必要条件（訪問先の特性に対して。例：ペットなし）。満たさない訪問先は rule 'staffRequirement' */
  requirements: z.array(conditionSchema).max(20),
  /** スタッフ側の希望（訪問先の特性に対して）。rule 'staffPreference' */
  preferences: z.array(conditionSchema).max(20),
});
export type Staff = z.infer<typeof staffSchema>;

export const clientSchema = z.object({
  id: idSchema,
  displayName: z.string().min(1).max(50),
  /** よみ（ひらがな・任意。PRD D61）。検索に使う。無い古いデータは '' */
  kana: z.string().max(50).default(''),
  place: placeSchema,
  note: z.string().max(500),
  /** 色の丸の番号（0〜7） */
  color: z.number().int().min(0).max(7),
  active: z.boolean(),
  /** 訪問先の特性（target='client' の項目の値。例：ペットあり・対象=子ども） */
  traits: traitsSchema,
  /** 訪問先の必要条件（スタッフの特性に対して。例：性別=女性、資格に看護師）。rule 'clientRequirement' */
  requirements: z.array(conditionSchema).max(20),
  /** 訪問先の希望（スタッフの特性に対して。例：経験3年以上）。rule 'clientPreference' */
  preferences: z.array(conditionSchema).max(20),
  /** いつもの担当。rule 'continuity' */
  usualStaffId: idSchema.nullable(),
  /** 仮押さえ（D47。問い合わせの試算から仮に押さえた〈利用者さん〉。ADR-0012 追記）。無い古いデータは false */
  tentative: z.boolean().default(false),
  /** 訪問先の決まりごと（PRD D66。ADR-0013）：入り方（インターホン等）。無い古いデータは '' */
  entryNote: z.string().max(200).default(''),
  /** 訪問先の決まりごと：鍵 */
  keyNote: z.string().max(200).default(''),
  /** 訪問先の決まりごと：駐車場 */
  parkingNote: z.string().max(200).default(''),
  /** 訪問先の決まりごと：注意 */
  cautionNote: z.string().max(200).default(''),
  /**
   * 担当できる人（PRD D68。ADR-0014）：〈スタッフ〉の ID の並び。空＝限らない（だれでも）。社内の決まり（「この方は2人だけ」）を表し、
   * 限った人以外との組は matching が可否で外す（理由 ruleId 'allowedStaff'。常に必須）。休止中・いない人は数えず
   * （store の repair が除く）、限った人が全員いなくなったら限らない。無い古いデータは []
   */
  allowedStaffIds: z.array(idSchema).max(50).default([]),
});
export type Client = z.infer<typeof clientSchema>;

/**
 * 訪問の種類（ADR-0012。利用者が足す。最大20）。担当に必要な条件（requirements。スタッフの特性に対して）は常に必須
 */
export const visitTypeSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(20),
  /** 色の丸の番号（〈利用者さん〉と同じ8色） */
  color: z.number().int().min(0).max(7),
  /** 標準の所要（新しい訪問・パターンの初期値だけ） */
  durationMinutes: z.number().int().min(5).max(720),
  /** 担当に必要な条件（スタッフの特性に対して）。常に必須 */
  requirements: z.array(conditionSchema).max(20),
  note: z.string().max(200),
});
export type VisitType = z.infer<typeof visitTypeSchema>;

/** 種類の上限（ADR-0012） */
export const MAX_VISIT_TYPES = 20;

/** 繰り返し方（ADR-0013）：'weekly'＝everyWeeks 週ごと、'monthly'＝毎月の第N週（monthWeeks） */
export const PATTERN_REPEATS = ['weekly', 'monthly'] as const;
export type PatternRepeat = (typeof PATTERN_REPEATS)[number];

/** 曜日ごとの開始（早）〜（遅）の上書き（ADR-0013） */
export const patternDayTimeSchema = z.object({
  /** 0=日〜6=土 */
  weekday: z.number().int().min(0).max(6),
  earliestStart: hhmmSchema,
  latestStart: hhmmSchema,
});
export type PatternDayTime = z.infer<typeof patternDayTimeSchema>;

/** 定期パターン（ADR-0012。利用者さんごと。複数持てる） */
export const patternSchema = z
  .object({
    id: idSchema,
    clientId: idSchema,
    /** null＝種類を問わない */
    typeId: idSchema.nullable(),
    /** 0=日〜6=土 */
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    /** 1＝毎週、2＝隔週…。from を含む週（日曜はじまり）を1週目。repeat が 'monthly' のときは使わない */
    everyWeeks: z.number().int().min(1).max(4),
    /** 繰り返し方（ADR-0013）。無い古いデータは 'weekly' */
    repeat: z.enum(PATTERN_REPEATS).default('weekly'),
    /** 毎月の第N（1〜5。ADR-0013）。repeat が 'monthly' のとき1つ以上。第5の無い月は作らない。無い古いデータは [] */
    monthWeeks: z.array(z.number().int().min(1).max(5)).max(5).default([]),
    /** 曜日ごとの時刻の上書き（ADR-0013）。無い曜日は共通の時刻。無い古いデータは [] */
    dayTimes: z.array(patternDayTimeSchema).max(7).default([]),
    windowKind: z.enum(WINDOW_KINDS),
    earliestStart: hhmmSchema,
    latestStart: hhmmSchema,
    durationMinutes: z.number().int().min(5).max(720),
    from: dateSchema,
    /** null＝続く */
    to: dateSchema.nullable(),
    /** いつもの担当。null＝利用者さんのいつもの担当 */
    usualStaffId: idSchema.nullable(),
    note: z.string().max(200),
  })
  .superRefine((p, ctx) => {
    if (p.to !== null && p.from > p.to) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: '終了日は開始日以降にしてください' });
    }
    if (p.earliestStart > p.latestStart) {
      ctx.addIssue({ code: 'custom', path: ['latestStart'], message: '開始（遅）は開始（早）以降にしてください' });
    }
    if (p.repeat === 'monthly' && p.monthWeeks.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['monthWeeks'], message: '毎月のときは第何週かを1つ以上選んでください' });
    }
    const seen = new Set<number>();
    for (const [i, t] of p.dayTimes.entries()) {
      if (seen.has(t.weekday)) {
        ctx.addIssue({ code: 'custom', path: ['dayTimes', i], message: '同じ曜日の時刻が2つあります' });
      }
      seen.add(t.weekday);
      if (t.earliestStart > t.latestStart) {
        ctx.addIssue({
          code: 'custom',
          path: ['dayTimes', i, 'latestStart'],
          message: '開始（遅）は開始（早）以降にしてください',
        });
      }
    }
  });
export type Pattern = z.infer<typeof patternSchema>;

/** 訪問の元の定期パターン（ADR-0012）。date は元の日、edited は「この回だけ変えた」 */
export const visitPatternRefSchema = z.object({ id: idSchema, date: dateSchema, edited: z.boolean() });
export type VisitPatternRef = z.infer<typeof visitPatternRefSchema>;

/** 1日の訪問。staffId は手作業の担当 */
export const visitSchema = z.object({
  id: idSchema,
  date: dateSchema,
  clientId: idSchema,
  windowKind: z.enum(WINDOW_KINDS),
  earliestStart: hhmmSchema,
  latestStart: hhmmSchema,
  durationMinutes: z.number().int().min(5).max(720),
  staffId: idSchema.nullable(),
  cancelled: z.boolean(),
  note: z.string().max(200),
  /** 訪問の種類（VisitType.id。ADR-0012）。null＝種類なし。無い古いデータは null */
  typeId: idSchema.nullable().default(null),
  /** 元の定期パターン（ADR-0012）。null＝単発。無い古いデータは null */
  pattern: visitPatternRefSchema.nullable().default(null),
});
export type Visit = z.infer<typeof visitSchema>;

/** 時間帯（30分単位、HH:mm） */
export const slotSchema = z.object({
  start: hhmmSchema.regex(/:[03]0$/, '時間は30分単位で選んでください'),
  end: hhmmSchema.regex(/:[03]0$/, '時間は30分単位で選んでください'),
});

/** その日の稼働時間帯の上書き。無ければ基本の曜日と時間、slots が空なら休み（PoC本体 ADR-0008） */
export const availabilitySchema = z
  .object({ staffId: idSchema, date: dateSchema, slots: z.array(slotSchema).max(MAX_SLOTS) })
  .superRefine((a, ctx) => {
    const e = slotsError(a.slots);
    if (e) ctx.addIssue({ code: 'custom', path: ['slots'], message: e });
  });
export type Availability = z.infer<typeof availabilitySchema>;

/** 30分単位の時刻（欠勤の始まり・終わり。ADR-0011） */
export const hhmm30Schema = hhmmSchema.regex(/:[03]0$/, '時間は30分単位で選んでください');

/**
 * 当日の急な欠勤（ADR-0011）。稼働時間の上書き（availability）とは別の記録で、その日の稼働時間帯から差し引く。
 * from が null＝始業から、to が null＝終業まで、両方 null＝終日。同じ人・同じ日は1件（store の repair は最後の1件）
 */
export const absenceSchema = z
  .object({
    id: idSchema,
    staffId: idSchema,
    date: dateSchema,
    /** 欠勤の始まり（30分単位）。null＝始業から */
    from: hhmm30Schema.nullable(),
    /** 欠勤の終わり（30分単位）。null＝終業まで */
    to: hhmm30Schema.nullable(),
    /** メモ（例：病院の付き添い） */
    note: z.string().max(100),
  })
  .superRefine((a, ctx) => {
    if (a.from !== null && a.to !== null && a.from >= a.to) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: '終了は開始より後にしてください' });
    }
  });
export type Absence = z.infer<typeof absenceSchema>;

/**
 * 〈利用者さん〉の休み（入院・ショートステイなど。PRD D65。ADR-0013）。from〜to（両端を含む）の訪問は消さずに
 * 「休みのため無し」と派生で扱う（domain/leaves の leaveOn。compile が問題に入れない）
 */
export const clientLeaveSchema = z
  .object({
    id: idSchema,
    clientId: idSchema,
    from: dateSchema,
    to: dateSchema,
    /** 理由のメモ（例：入院） */
    note: z.string().max(100),
  })
  .superRefine((l, ctx) => {
    if (l.from > l.to) ctx.addIssue({ code: 'custom', path: ['to'], message: '終了日は開始日以降にしてください' });
  });
export type ClientLeave = z.infer<typeof clientLeaveSchema>;

/** 手作業案。staffId（または未割当 '__none'）→ 訪問IDの列（開始時刻の順） */
export const manualRoutesSchema = z.record(z.string(), z.array(idSchema));
export type ManualRoutes = z.infer<typeof manualRoutesSchema>;
