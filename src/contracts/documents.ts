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
});
export type Client = z.infer<typeof clientSchema>;

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

/** 手作業案。staffId（または未割当 '__none'）→ 訪問IDの列（開始時刻の順） */
export const manualRoutesSchema = z.record(z.string(), z.array(idSchema));
export type ManualRoutes = z.infer<typeof manualRoutesSchema>;
