// 名簿のブック（〈利用者さん〉か〈スタッフ〉のシート1枚）→ 今のデータに足す・直す（PRD D103〜D107。ADR-0020）。
// データは書き換えない（ADR-0006）：名簿を当てた新しい DemoData と件数を返し、画面が確かめてから store の update で入れる。
// AI案・記録・確定した割当・訪問・パターン・相性などは base のまま（その人を指すものも残す）。最後は store の migrate（repair）を通す
import type { DemoData, ImportError, RosterImportResult, RosterKind, RosterMode } from '../contracts/data';
import { type Client, type ClientStage, type Staff, stageOfLegacy, type Terms } from '../contracts/documents';
import type { Condition, Traits } from '../contracts/rules';
import { STAGE_LABELS, stageFlags, withStage } from '../lib/clientStage';
import { nameKey, newId } from '../lib/common';
import { isImportError, migrate } from '../store';
import {
  Errors,
  loadWorkbook,
  MAX_CONDS,
  type PersonCols,
  personCols,
  RESERVED_IDS,
  type Row,
  readEmail,
  readPerson,
  readPostal,
  Sheet,
  sheetMsg,
  uniqueName,
} from './importBook';
import {
  CLIENT_ALLOWED_COL,
  CLIENT_COLS,
  CLIENT_KANA_COL,
  CLIENT_POSTAL_COL,
  CLIENT_RULE_COLS,
  CLIENT_STAGE_COLS,
  CLIENT_TENTATIVE_COL,
  STAFF_COLS,
  STAFF_EMAIL_COL,
  STAFF_LAST_DAY_COL,
} from './layout';
import { lookup, parseWorkDays, personSheetNames, splitList, travelModeLabels } from './text';

/** 確認に出す名前の数（「ほか」で省く） */
export const ROSTER_NAMES_SHOWN = 3;

/** 形の同じ値か（オブジェクトのキーの順は問わない） */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  return (
    ka.length === kb.length &&
    ka.every(
      (k) =>
        Object.hasOwn(b as object, k) && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  );
}

/** 並びだけが違う条件の列は同じとみなす（読み込むと条件は項目の列の順に並ぶため。同じなら今の並びを残す） */
function sameConds(a: readonly Condition[], b: readonly Condition[]): boolean {
  if (a.length !== b.length) return false;
  const key = (c: Condition) => JSON.stringify([c.itemId, c.op, c.value]);
  const ka = a.map(key).sort();
  const kb = b.map(key).sort();
  return ka.every((x, i) => x === kb[i]);
}

/**
 * 特性・必要条件・希望：ブックにある項目の列だけ読んだ値に替え、無い列の項目は今の値のまま（新しい人は空）。
 * 条件が並びだけ違うなら今の並びを残す
 */
function mergePerson(
  r: Row,
  cols: PersonCols,
  cur: { traits: Traits; requirements: Condition[]; preferences: Condition[] } | undefined,
): { traits: Traits; requirements: Condition[]; preferences: Condition[] } {
  const read = readPerson(r, cols);
  const traits: Traits = { ...(cur?.traits ?? {}) };
  for (const { item } of cols.traits) delete traits[item.id];
  Object.assign(traits, read.traits);
  const conds = (list: PersonCols['reqs'], now: Condition[] | undefined, got: Condition[], label: string) => {
    const readIds = new Set(list.map((c) => c.item.id));
    const kept = (now ?? []).filter((c) => !readIds.has(c.itemId));
    const out = [...kept, ...got];
    // 上限は、ブックに列の無い今の条件と合わせて数える（読んだぶんだけの上限は readPerson が見る）
    if (out.length > MAX_CONDS && kept.length > 0)
      r.err(list[0]?.h ?? label, `${label}は1人${MAX_CONDS}件までです（いま${out.length}件）`);
    return now && sameConds(out, now) ? now : out;
  };
  return {
    traits,
    requirements: conds(cols.reqs, cur?.requirements, read.requirements, '必要条件'),
    preferences: conds(cols.prefs, cur?.preferences, read.preferences, '希望'),
  };
}

/** 1行の読み取りの結果 */
interface Read<P> {
  row: Row;
  person: P;
  /** 今のデータの人（無ければ新しい人） */
  cur: P | undefined;
}

/**
 * 名簿のブック → 今のデータに当てた結果（PRD D103〜D107）。読めなければ、場所付きの日本語の ImportError（何も変えない）。
 * - シートは呼び方のシート名（personSheetNames）。全体のブックでも、その人のシートだけを読む
 * - 同じ人：ID が入っていれば ID で、空なら名前（全角半角・空白を同一視）で今のデータと突き合わせる。一致しなければ新しい人
 * - ブックに無い列は、更新する人では今の値のまま、新しい人では既定値（画面で足すときと同じ）
 * - 総入れ替え（mode 'replace'）：ブックに無い人を消さずに、〈利用者さん〉は段階「終了」、〈スタッフ〉は休止にする
 */
export async function importRoster(
  buf: ArrayBuffer,
  base: DemoData,
  kind: RosterKind,
  mode: RosterMode,
): Promise<RosterImportResult | ImportError> {
  const book = await loadWorkbook(buf);
  if ('code' in book) return book;
  const terms = base.org.terms;
  const term = kind === 'staff' ? terms.staff : terms.client;
  const name = personSheetNames(terms)[kind];
  const ws = book.getWorksheet(name);
  if (!ws)
    return {
      code: 'INVALID_ARGUMENT',
      message: `シート『${name}』がありません（${term}の名簿のブックか、全体のブックを選んでください。シート名は呼び方の「${term}」から決まります）`,
    };
  const errors = new Errors();
  const sheet = new Sheet(name, ws, errors);
  const nameCol = kind === 'staff' ? STAFF_COLS.name : CLIENT_COLS.name;
  if (!sheet.require([nameCol])) return errors.toError();
  const fixed =
    kind === 'staff'
      ? [...Object.values(STAFF_COLS), STAFF_LAST_DAY_COL, STAFF_EMAIL_COL]
      : [
          ...Object.values(CLIENT_COLS),
          CLIENT_TENTATIVE_COL,
          CLIENT_KANA_COL,
          CLIENT_POSTAL_COL,
          CLIENT_ALLOWED_COL,
          ...Object.values(CLIENT_RULE_COLS),
          ...Object.values(CLIENT_STAGE_COLS),
        ];
  // 項目の列は今のデータの項目と照らす（知らない項目の列は止める。無い列は今のまま）
  const cols = personCols(sheet, base.items, kind, fixed, undefined, false);
  if (errors.any) return errors.toError();
  const rows = sheet.rows();
  if (rows.length === 0) return { code: 'INVALID_ARGUMENT', message: sheetMsg(name, `${term}の行がありません`) };

  /** いまある ID（新しい ID と重ならないように。ほかの種類のデータの ID と同じ ID で足さない） */
  const used = new Set<string>([
    ...base.items.map((x) => x.id),
    ...base.rules.map((x) => x.id),
    ...base.staff.map((x) => x.id),
    ...base.clients.map((x) => x.id),
    ...base.visits.map((x) => x.id),
    ...base.absences.map((x) => x.id),
    ...base.visitTypes.map((x) => x.id),
    ...base.patterns.map((x) => x.id),
    ...base.clientLeaves.map((x) => x.id),
  ]);
  const has = (h: string) => sheet.has(h);

  /** 行の ID と、今のデータの人の突き合わせ（ID → 名前の順）。同じ人を2行が指せば止める */
  const people: { id: string; name: string }[] =
    kind === 'staff'
      ? base.staff.map((s) => ({ id: s.id, name: s.name }))
      : base.clients.map((c) => ({ id: c.id, name: c.displayName }));
  const byId = new Map(people.map((p) => [p.id, p]));
  const byKey = new Map(people.map((p) => [nameKey(p.name), p]));
  const ids = new Map<string, number>();
  const names = new Map<string, number>();
  const matched = new Map<string, number>();
  const prefix = kind === 'staff' ? 's' : 'c';
  const match = (r: Row): { id: string; name: string; curId: string | undefined } => {
    const t = r.text(CLIENT_COLS.id);
    const n = r.required(nameCol, 50) ?? '';
    if (n !== '') uniqueName(r, nameCol, n, names);
    let id: string;
    let curId: string | undefined;
    if (t !== '') {
      if (RESERVED_IDS.has(t)) r.err(CLIENT_COLS.id, `「${t}」は ID に使えません`);
      r.limit(CLIENT_COLS.id, t, 100);
      const before = ids.get(t);
      if (before !== undefined) r.err(CLIENT_COLS.id, `ID「${t}」が ${before}行目と重なっています`);
      ids.set(t, r.n);
      curId = byId.get(t)?.id;
      if (curId === undefined && used.has(t))
        r.err(CLIENT_COLS.id, `ID「${t}」はほかのデータで使われています（新しい人なら ID を空にしてください）`);
      id = t;
    } else {
      curId = n === '' ? undefined : byKey.get(nameKey(n))?.id;
      if (curId !== undefined) id = curId;
      else {
        id = newId(prefix);
        while (used.has(id) || ids.has(id)) id = newId(prefix);
        used.add(id);
      }
    }
    if (curId !== undefined) {
      const before = matched.get(curId);
      if (before !== undefined)
        r.err(nameCol, `${before}行目と同じ${term}（ID「${curId}」）を指しています。1人1行にしてください`);
      matched.set(curId, r.n);
    }
    return { id, name: n, curId };
  };

  /** 列があれば読み、無ければ今の値（新しい人は既定値） */
  const pick = <T>(h: string, read: () => T, keep: T): T => (has(h) ? read() : keep);

  let reads: Read<Staff>[] | Read<Client>[];
  if (kind === 'staff') {
    const C = STAFF_COLS;
    const curOf = new Map(base.staff.map((s) => [s.id, s]));
    const out: Read<Staff>[] = [];
    for (const r of rows) {
      const m = match(r);
      const cur = m.curId === undefined ? undefined : curOf.get(m.curId);
      const travelMode = pick(
        C.travelMode,
        () => {
          const t = r.required(C.travelMode);
          const v = t === null ? null : lookup(travelModeLabels, t);
          if (t !== null && v === null)
            r.err(C.travelMode, `「${Object.values(travelModeLabels).join('」「')}」のどれかで書いてください`);
          return v ?? 'DRIVE';
        },
        cur?.travelMode ?? 'DRIVE',
      );
      const workDays = pick(
        C.workDays,
        () => {
          const v = parseWorkDays(r.text(C.workDays));
          if (v === null) r.err(C.workDays, '曜日は「月火水木金」のように書いてください');
          return v ?? [];
        },
        cur?.workDays ?? [1, 2, 3, 4, 5],
      );
      const shiftStart = pick(C.shiftStart, () => r.time(C.shiftStart) ?? '09:00', cur?.shiftStart ?? '09:00');
      const shiftEnd = pick(C.shiftEnd, () => r.time(C.shiftEnd) ?? '18:00', cur?.shiftEnd ?? '18:00');
      // 新しい人の「利用中」が空なら利用中にする（名簿だけ。全体の読み込みは空＝休止のまま）
      const active = pick(
        C.active,
        () => (!cur && r.text(C.active) === '' ? true : r.yes(C.active)),
        cur?.active ?? true,
      );
      const home = {
        address: pick(C.address, () => r.optional(C.address, 200), cur?.home.address ?? ''),
        lat: pick(C.lat, () => r.num(C.lat, { min: -90, max: 90 }) ?? null, cur?.home.lat ?? null),
        lng: pick(C.lng, () => r.num(C.lng, { min: -180, max: 180 }) ?? null, cur?.home.lng ?? null),
      };
      const lastDay = pick(
        STAFF_LAST_DAY_COL,
        () => (r.text(STAFF_LAST_DAY_COL) === '' ? null : r.date(STAFF_LAST_DAY_COL)),
        cur?.lastDay ?? null,
      );
      const email = pick(STAFF_EMAIL_COL, () => readEmail(r, STAFF_EMAIL_COL) ?? '', cur?.email ?? '');
      const p = mergePerson(r, cols, cur);
      const person: Staff = {
        ...(cur ?? {}),
        id: m.id,
        name: m.name,
        home: { ...(cur?.home ?? {}), ...home },
        travelMode,
        workDays,
        shiftStart,
        shiftEnd,
        active,
        ...p,
        lastDay,
        email,
      };
      out.push({ row: r, person, cur });
    }
    reads = out;
  } else {
    const C = CLIENT_COLS;
    const curOf = new Map(base.clients.map((c) => [c.id, c]));
    const staffByKey = new Map(base.staff.map((s) => [nameKey(s.name), s.id]));
    const noStaff = (r: Row, h: string, t: string) =>
      r.err(h, `「${t}」という${terms.staff}は、いまのデータにいません（先に${terms.staff}を足してください）`);
    let added = 0;
    const out: Read<Client>[] = [];
    for (const r of rows) {
      const m = match(r);
      const cur = m.curId === undefined ? undefined : curOf.get(m.curId);
      const color = pick(
        C.color,
        () => {
          const v = r.num(C.color, { int: true, min: 1, max: 8, required: true });
          return typeof v === 'number' ? v - 1 : 0;
        },
        cur?.color ?? (base.clients.length + added) % 8,
      );
      if (!cur) added++;
      const active = pick(C.active, () => r.yes(C.active), cur?.active ?? true);
      const tentative = pick(CLIENT_TENTATIVE_COL, () => r.yes(CLIENT_TENTATIVE_COL), cur?.tentative ?? false);
      // 段階が正（ADR-0015）：段階の列が空・無ければ、「利用中」「仮押さえ」の列があればそこから、無ければ今の段階
      const stageText = r.text(CLIENT_STAGE_COLS.stage);
      let stage: ClientStage;
      if (stageText !== '') {
        const v = lookup(STAGE_LABELS, stageText);
        if (v === null)
          r.err(CLIENT_STAGE_COLS.stage, `「${Object.values(STAGE_LABELS).join('」「')}」のどれかで書いてください`);
        stage = v ?? cur?.stage ?? 'active';
      } else if (!cur && r.text(C.active) === '' && r.text(CLIENT_TENTATIVE_COL) === '') {
        // 新しい人で段階・利用中・仮押さえがすべて空なら利用中（名簿だけ。全体の読み込みは空＝終了のまま）
        stage = 'active';
      } else if (has(C.active) || has(CLIENT_TENTATIVE_COL)) stage = stageOfLegacy({ active, tentative });
      else stage = cur?.stage ?? 'active';
      const place = {
        address: pick(C.address, () => r.optional(C.address, 200), cur?.place.address ?? ''),
        lat: pick(C.lat, () => r.num(C.lat, { min: -90, max: 90 }) ?? null, cur?.place.lat ?? null),
        lng: pick(C.lng, () => r.num(C.lng, { min: -180, max: 180 }) ?? null, cur?.place.lng ?? null),
        postalCode: pick(CLIENT_POSTAL_COL, () => readPostal(r) ?? '', cur?.place.postalCode ?? ''),
      };
      // ほかの人の参照は、今のデータの〈スタッフ〉の名前で探す（全角半角・空白は同一視）
      const usualStaffId = pick(
        C.usualStaff,
        () => {
          const t = r.text(C.usualStaff);
          if (t === '') return null;
          const sid = staffByKey.get(nameKey(t));
          if (sid === undefined) noStaff(r, C.usualStaff, t);
          return sid ?? null;
        },
        cur?.usualStaffId ?? null,
      );
      const allowedStaffIds = pick(
        CLIENT_ALLOWED_COL,
        () => {
          const out: string[] = [];
          for (const t of splitList(r.text(CLIENT_ALLOWED_COL))) {
            const sid = staffByKey.get(nameKey(t));
            if (sid === undefined) noStaff(r, CLIENT_ALLOWED_COL, t);
            else if (!out.includes(sid)) out.push(sid);
          }
          return cur && same(out, cur.allowedStaffIds) ? cur.allowedStaffIds : out;
        },
        cur?.allowedStaffIds ?? [],
      );
      const text = (h: string, max: number, keep: string | undefined) => pick(h, () => r.optional(h, max), keep ?? '');
      const referrerEmail = pick(
        CLIENT_STAGE_COLS.referrerEmail,
        () => readEmail(r, CLIENT_STAGE_COLS.referrerEmail) ?? '',
        cur?.referrer.email ?? '',
      );
      const p = mergePerson(r, cols, cur);
      const person: Client = {
        ...(cur ?? {}),
        id: m.id,
        displayName: m.name,
        kana: text(CLIENT_KANA_COL, 50, cur?.kana),
        place: { ...(cur?.place ?? {}), ...place },
        note: text(C.note, 500, cur?.note),
        color,
        ...p,
        usualStaffId,
        entryNote: text(CLIENT_RULE_COLS.entry, 200, cur?.entryNote),
        keyNote: text(CLIENT_RULE_COLS.key, 200, cur?.keyNote),
        parkingNote: text(CLIENT_RULE_COLS.parking, 200, cur?.parkingNote),
        cautionNote: text(CLIENT_RULE_COLS.caution, 200, cur?.cautionNote),
        allowedStaffIds,
        stage,
        // active・tentative は段階に合わせる（store の repair と同じ。比べるときに食い違いを変更とみなさない）
        ...stageFlags(stage, tentative),
        referrer: {
          ...(cur?.referrer ?? {}),
          name: text(CLIENT_STAGE_COLS.referrer, 50, cur?.referrer.name),
          contact: text(CLIENT_STAGE_COLS.referrerContact, 100, cur?.referrer.contact),
          note: text(CLIENT_STAGE_COLS.referrerNote, 200, cur?.referrer.note),
          email: referrerEmail,
        },
      };
      out.push({ row: r, person, cur });
    }
    reads = out;
  }
  if (errors.any) return errors.toError();

  // 今のデータに当てる（更新は今の位置、新しい人は後ろ。総入れ替えならブックに無い人を終了・休止に）
  const nameOf = (p: Staff | Client) => ('name' in p ? p.name : p.displayName);
  const current: (Staff | Client)[] = kind === 'staff' ? base.staff : base.clients;
  const byRow = new Map<string, Read<Staff | Client>>();
  for (const x of reads as Read<Staff | Client>[]) if (x.cur) byRow.set(x.cur.id, x);
  const retired: string[] = [];
  const list: (Staff | Client)[] = current.map((p) => {
    const x = byRow.get(p.id);
    if (x) return x.person;
    if (mode !== 'replace') return p;
    if (kind === 'staff') {
      const s = p as Staff;
      if (!s.active) return s;
      retired.push(s.name);
      return { ...s, active: false };
    }
    const c = p as Client;
    if (c.stage === 'ended') return c;
    retired.push(c.displayName);
    return withStage(c, 'ended');
  });
  for (const x of reads as Read<Staff | Client>[]) if (!x.cur) list.push(x.person);

  // 当てたあとに名前が他の人と重なるなら止める（全角半角・空白だけの違いも同じ名前）
  const owner = new Map<string, Staff | Client>();
  for (const p of list) {
    const k = nameKey(nameOf(p));
    if (!owner.has(k)) owner.set(k, p);
  }
  for (const x of reads as Read<Staff | Client>[]) {
    const o = owner.get(nameKey(nameOf(x.person)));
    if (o && o.id !== x.person.id)
      x.row.err(
        nameCol,
        `「${nameOf(x.person)}」は、いまの${term}の「${nameOf(o)}」と名前が重なります（ブックに無い人とも重ならないようにしてください）`,
      );
  }
  if (errors.any) return errors.toError();

  const next: DemoData =
    kind === 'staff' ? { ...base, staff: list as Staff[] } : { ...base, clients: list as Client[] };
  const r = migrate(next);
  if (isImportError(r)) return { ...r, message: `読み込んだ内容に問題があります：${r.message}` };

  // 件数は migrate（repair）のあとの結果を ID で引いて、今の人と比べる（repair で元に戻る違いは変更にしない）
  const after = new Map<string, Staff | Client>(
    (kind === 'staff' ? r.staff : r.clients).map((p): [string, Staff | Client] => [p.id, p]),
  );
  const added: string[] = [];
  const updated: string[] = [];
  let unchanged = 0;
  for (const x of reads as Read<Staff | Client>[]) {
    const got = after.get(x.person.id) ?? x.person;
    if (!x.cur) {
      // 利用中でない人だけ、段階（〈スタッフ〉は休止）を添える
      const note =
        'stage' in got
          ? got.stage === 'active'
            ? ''
            : `（${STAGE_LABELS[got.stage]}）`
          : got.active
            ? ''
            : '（休止）';
      added.push(`${nameOf(got)}${note}`);
    } else if (same(got, x.cur)) unchanged++;
    else updated.push(nameOf(got));
  }

  // 休止になった〈スタッフ〉を「担当できる人」から外す（repair）。外れる人・限らないに戻る人を確認に出す（StaffPage と同じ）
  const allowedRemoved: string[] = [];
  const allowedEmptied: string[] = [];
  const clientAfter = new Map(r.clients.map((c) => [c.id, c]));
  for (const c of base.clients) {
    const got = clientAfter.get(c.id);
    // 〈利用者さん〉の名簿では、ブックで書いた担当できる人の違いは「更新」に数える（ここは〈スタッフ〉の休止で外れるものだけ）
    if (kind !== 'staff' || !got || c.allowedStaffIds.length === 0) continue;
    if (c.allowedStaffIds.some((id) => !got.allowedStaffIds.includes(id))) {
      allowedRemoved.push(c.displayName);
      if (got.allowedStaffIds.length === 0) allowedEmptied.push(c.displayName);
    }
  }
  // 最終勤務日が入った・変わった〈スタッフ〉（ADR-0015。担当の振り直しは〈スタッフ〉の画面から）
  const lastDaySet =
    kind === 'staff'
      ? r.staff
          .filter((s) => s.lastDay !== null && base.staff.find((b) => b.id === s.id)?.lastDay !== s.lastDay)
          .map((s) => s.name)
      : [];
  const activeBefore =
    kind === 'staff'
      ? base.staff.filter((s) => s.active).length
      : base.clients.filter((c) => c.stage !== 'ended').length;
  return { data: r, added, updated, unchanged, retired, allowedRemoved, allowedEmptied, lastDaySet, activeBefore };
}

/** 名前を3人まで「・」でつなぐ（多ければ「ほか」） */
const namesText = (xs: string[]) =>
  `${xs.slice(0, ROSTER_NAMES_SHOWN).join('・')}${xs.length > ROSTER_NAMES_SHOWN ? ' ほか' : ''}`;

/** 総入れ替えで、今の人（〈スタッフ〉は利用中、〈利用者さん〉は終了でない人）の半分を超える人を外すか（ファイルの取り違えの注意） */
export const rosterRetiresMost = (r: RosterImportResult): boolean =>
  r.retired.length > 0 && r.retired.length * 2 > r.activeBefore;

/**
 * 総入れ替えで今の人の半分を超える人を外すときの強い注意（確認の文の先頭に出す。PRD D106）。当たらなければ null
 */
export function rosterWarning(r: RosterImportResult, kind: RosterKind, terms: Terms): string | null {
  if (!rosterRetiresMost(r)) return null;
  return kind === 'staff'
    ? `注意：${terms.staff}の半分を超える ${r.retired.length}人を休止にします。ファイルを取り違えていないか確かめてください。`
    : `注意：${terms.client}（終了でない人）の半分を超える ${r.retired.length}人を終了にします。ファイルを取り違えていないか確かめてください。`;
}

/**
 * 確認の文（PRD D106・D107）：件数の行（「追加 2人（A・B）・更新 1人（C）・変更なし 5人・終了にする 1人（D）」）、
 * 〈スタッフ〉を休止にして「担当できる人」から外れる〈利用者さん〉があればその文（StaffPage の休止と同じ言い方。名前は全員）
 */
export function rosterSummary(r: RosterImportResult, kind: RosterKind, terms: Terms): string {
  const shown = (xs: string[]) => (xs.length === 0 ? '' : `（${namesText(xs)}）`);
  const retire = kind === 'staff' ? '休止にする' : '終了にする';
  const lines: string[] = [];
  lines.push(
    [
      `追加 ${r.added.length}人${shown(r.added)}`,
      `更新 ${r.updated.length}人${shown(r.updated)}`,
      `変更なし ${r.unchanged}人`,
      `${retire} ${r.retired.length}人${shown(r.retired)}`,
    ].join('・'),
  );
  if (r.allowedRemoved.length > 0) {
    lines.push(
      `休止にする${terms.staff}を、${r.allowedRemoved.join('・')}の「担当できる人」から外します。${
        r.allowedEmptied.length > 0
          ? `${r.allowedEmptied.join('・')}は担当できる人がいなくなり、だれでも担当できるようになります（必要なら${terms.client}の画面で選び直してください）。`
          : ''
      }あとで利用中に戻しても、担当できる人には戻りません。`,
    );
  }
  return lines.join('\n');
}
