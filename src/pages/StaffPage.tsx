import {
  BadgeCheck,
  CalendarX,
  Clock,
  Eye,
  Home,
  MapPin,
  Pencil,
  Plus,
  Save,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  UserRound,
  UserRoundCog,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useConfirm } from '../components/ConfirmDialog';
import { CondChips, ConditionsEditor, TraitChips, TraitsEditor } from '../components/conditions';
import { Check } from '../components/parts';
import { StaffView } from '../components/personView';
import { AddressField } from '../components/placeLookup';
import { useToast } from '../components/Toast';
import {
  Hint,
  IconButton,
  PageHeader,
  SectionLevelProvider,
  SectionTitle,
  SidePanel,
  WithIcon,
} from '../components/ui';
import { TRAVEL_MODES, type TravelMode } from '../contracts/codes';
import { type Staff, staffSchema } from '../contracts/documents';
import { addDays, jstDate } from '../domain/time';
import { byName, formError, hasLocation, nameTaken, newId, TRAVEL_MODE_LABELS, WEEKDAY_LABELS } from '../lib/common';
import { useDirtyMark } from '../lib/dirtyForms';
import { normalizeEmail } from '../lib/mailto';
import { offboardScope } from '../lib/offboard';
import { mdText } from '../lib/patternText';
import { useFeature } from '../lib/useFeature';
import { type DiscardWhen, discardDialog, isDirty } from '../lib/viewMode';
import { useDemoData } from '../store';
import { leavingStaff, OffboardPanel } from './OffboardPanel';
import './settings.css';

/** スタッフの一覧と編集（PoC本体 StaffPage.tsx を写し、招待・メールを外して特性と条件を足した） */

const blank = (): Staff => ({
  id: newId('s'),
  name: '',
  home: { address: '', lat: null, lng: null },
  travelMode: 'DRIVE',
  workDays: [1, 2, 3, 4, 5],
  shiftStart: '09:00',
  shiftEnd: '18:00',
  active: true,
  traits: {},
  requirements: [],
  preferences: [],
  lastDay: null,
  email: '',
});

export default function StaffPage() {
  const { data, update } = useDemoData();
  const terms = data.org.terms;
  // 機能の入り切り（ADR-0028）：退職・担当替えを切れば最終勤務日の欄・振り直しの欄、メールを切ればメールアドレスの欄を出さない
  // （最終勤務日の値は事実なので計算に効き、一覧の「最終」の印も残す）
  const offboardOn = useFeature('offboard');
  const mailOn = useFeature('mail');
  /** 担当を限る（ADR-0028 の allowedStaff）：切なら休止の確認で「担当できる人」に触れない（外すデータの書き換えは今どおり） */
  const allowedStaffOn = useFeature('allowedStaff');
  const toast = useToast();
  const confirmDialog = useConfirm();
  /** 閲覧の欄で開いている人（PRD D127。編集中はその人の ID のまま。null：閲覧の欄なし） */
  const [viewId, setViewId] = useState<string | null>(null);
  /** 編集の欄の入力（null：編集していない） */
  const [form, setForm] = useState<Staff | null>(null);
  const [isNew, setIsNew] = useState(false);
  /** 新しい人の、開いたときの空の欄（変更があるかの判定に使う） */
  const [openedForm, setOpenedForm] = useState<Staff | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 担当の振り直しの欄を開いている〈スタッフ〉（PRD D71。null：閉じている） */
  const [offboardFor, setOffboardFor] = useState<string | null>(null);
  const today = jstDate(Date.now());
  const staff = useMemo(() => [...data.staff].sort(byName), [data.staff]);
  /** 最終勤務日のある人と、振り直しが残っているもの（〈利用者さん〉の人数・訪問の件数） */
  const leaving = useMemo(
    () =>
      leavingStaff(data.staff).map((s) => {
        const sc = offboardScope(data, s.id, today, false);
        return { staff: s, clients: sc?.clients.length ?? 0, visits: sc?.visits.length ?? 0 };
      }),
    [data, today],
  );
  const staffItems = data.items.filter((i) => i.target === 'staff');
  const itemById = new Map(data.items.map((i) => [i.id, i]));
  /** 編集の欄に変更があるか（PRD D130。既存の人は保存した中身、新しい人は開いたときの空の欄と比べる） */
  const dirty = isDirty(
    form,
    isNew ? (openedForm ?? undefined) : form ? data.staff.find((x) => x.id === form.id) : undefined,
  );
  /** 変更があれば捨ててよいか確かめる（無ければそのまま進む） */
  const okToDiscard = async (when: DiscardWhen, next = ''): Promise<boolean> =>
    !dirty || !form || confirmDialog(discardDialog(when, terms.staff, form.name, next));
  /** 編集の欄を開く */
  const openForm = (s: Staff, fresh: boolean) => {
    setError(null);
    setIsNew(fresh);
    setOffboardFor(null);
    setForm(s);
    setOpenedForm(fresh ? structuredClone(s) : null);
  };
  /** 閲覧の欄で開く（PRD D127。編集中で変更があれば確かめる） */
  const openView = async (s: Staff) => {
    if (form && form.id === s.id && !isNew) return;
    if (!(await okToDiscard('switch', s.name))) return;
    setForm(null);
    setError(null);
    setOffboardFor(null);
    setViewId(s.id);
  };
  /** 閲覧から編集へ（PRD D128） */
  const startEdit = (s: Staff) => {
    setViewId(s.id);
    openForm(structuredClone(s), false);
  };
  /** 編集を取り消して閲覧に戻る（新しい人なら欄を閉じる。PRD D129） */
  const cancelEdit = async () => {
    if (!(await okToDiscard(isNew ? 'close' : 'view'))) return;
    if (isNew) setViewId(null);
    setForm(null);
    setError(null);
  };
  /** 欄を閉じる（× ・Esc。編集中で変更があれば確かめる） */
  const closePanel = async () => {
    if (!(await okToDiscard('close'))) return;
    setForm(null);
    setViewId(null);
    setError(null);
  };

  // 別のタブの変更で読み直したときの知らせの文を選ぶ（PRD D227。変更があれば「保存すると上書きします」）
  useDirtyMark(dirty);
  // 変更があるまま再読込・タブを閉じるときはブラウザの確認を出す（PRD D130。戻る・画面の移動では出せない。ADR-0023）
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  // ?id= で開いたら、その人の閲覧の欄を開く（相性・予定の吹き出しから。PRD D114・D127）。開いたら URL から消す
  const [params, setParams] = useSearchParams();
  const openId = params.get('id');
  // biome-ignore lint/correctness/useExhaustiveDependencies: URL の id が変わったときだけ
  useEffect(() => {
    if (openId === null) return;
    const s = data.staff.find((x) => x.id === openId);
    if (s) void openView(s);
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete('id');
        return p;
      },
      { replace: true },
    );
  }, [openId]);

  /** 閲覧の欄の人（編集していないとき。データから消えたら欄を出さない） */
  const viewed = !form && viewId !== null ? data.staff.find((x) => x.id === viewId) : undefined;

  const save = async () => {
    if (!form) return;
    setError(null);
    // 同じ名前は保存しない（Excel では名前で人を引くため。ADR-0006）
    if (nameTaken(data.staff, (x) => x.name, form.name, form.id)) {
      setError(`「${form.name.trim()}」と同じ名前の${terms.staff}がいます。名前を変えてください`);
      return;
    }
    // メールアドレス（任意。ADR-0017）：全角・前後の空白を直し、形が合わなければ保存しない
    const email = normalizeEmail(form.email);
    if (email === null) {
      setError('メールアドレスの形ではありません（例 name@example.com）。空でも構いません');
      return;
    }
    try {
      const s = staffSchema.parse({ ...form, email });
      // 休止にするとき、〈利用者さん〉の「担当できる人」から外す（ADR-0014。repair と同じ扱いを保存の時点で）
      const limited = s.active ? [] : data.clients.filter((c) => c.allowedStaffIds.includes(s.id));
      // 担当を限るを切っていれば、見えない欄の話になるので確認を出さない（外すのは今どおり。入れ直しても戻らない）
      if (limited.length > 0 && allowedStaffOn) {
        // ほかに利用中の人が残らない〈利用者さん〉（休止中の人は数えない）
        const activeOther = new Set(data.staff.filter((x) => x.active && x.id !== s.id).map((x) => x.id));
        const emptied = limited.filter((c) => !c.allowedStaffIds.some((id) => activeOther.has(id)));
        const ok = await confirmDialog({
          title: `${s.name}さんを休止にして保存しますか？`,
          body: `${limited.map((c) => c.displayName).join('・')}の「担当できる人」から外します。${
            emptied.length > 0
              ? `${emptied.map((c) => c.displayName).join('・')}は担当できる人がいなくなり、だれでも担当できるようになります（必要なら${terms.client}の画面で選び直してください）。`
              : ''
          }\nあとで利用中に戻しても、担当できる人には戻りません。`,
          confirmLabel: '休止にして保存する',
        });
        if (!ok) return;
      }
      // 最終勤務日を入れた・変えたら、保存のあとに担当の振り直しの欄を開く（振り直すものがあるときだけ。ADR-0015）
      const before = data.staff.find((x) => x.id === s.id);
      const lastDayChanged = s.active && s.lastDay !== null && before?.lastDay !== s.lastDay;
      const nextData = {
        ...data,
        staff: data.staff.some((x) => x.id === s.id)
          ? data.staff.map((x) => (x.id === s.id ? s : x))
          : [...data.staff, s],
      };
      const sc = lastDayChanged && offboardOn ? offboardScope(nextData, s.id, today, false) : null;
      update((d) => ({
        ...d,
        staff: d.staff.some((x) => x.id === s.id) ? d.staff.map((x) => (x.id === s.id ? s : x)) : [...d.staff, s],
        clients: s.active
          ? d.clients
          : d.clients.map((c) =>
              c.allowedStaffIds.includes(s.id)
                ? { ...c, allowedStaffIds: c.allowedStaffIds.filter((id) => id !== s.id) }
                : c,
            ),
      }));
      setIsNew(false);
      setForm(null);
      if (sc && (sc.clients.length > 0 || sc.visits.length > 0)) {
        // 振り直すものがあれば、今までどおり欄を閉じて担当の振り直しの欄を開く（ADR-0015）
        setViewId(null);
        setOffboardFor(s.id);
        toast(`保存しました。${mdText(addDays(s.lastDay ?? '', 1))}からの担当を振り直してください`);
      } else {
        // 保存したら閲覧の欄に戻る（PRD D129）
        setViewId(s.id);
        toast('保存しました');
      }
    } catch (e) {
      setError(formError(e));
    }
  };

  return (
    <div className="stack">
      <PageHeader
        icon={UserRound}
        title={`${terms.staff}一覧`}
        lead={`${terms.staff}の勤務・特性・条件を決めます`}
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={async () => {
              if (!(await okToDiscard('switch', `新しい${terms.staff}`))) return;
              setViewId(null);
              openForm(blank(), true);
            }}
          >
            <WithIcon icon={Plus}>{terms.staff}を追加</WithIcon>
          </button>
        }
      />

      {offboardOn && leaving.length > 0 && (
        <div className="card stack leaving-card" data-testid="leaving-card">
          <strong>
            <WithIcon icon={CalendarX} size={16}>
              最終勤務日のある{terms.staff}
            </WithIcon>
          </strong>
          <ul className="leaving-list">
            {leaving.map((x) => (
              <li key={x.staff.id}>
                <span>
                  {x.staff.name}さん：最終勤務日 {mdText(x.staff.lastDay ?? '')}
                </span>
                <span className="sub">
                  {x.clients > 0 || x.visits > 0
                    ? `振り直しが残っています（${terms.client} ${x.clients}人・担当の訪問 ${x.visits}件）`
                    : '振り直しは済んでいます'}
                </span>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={async () => {
                    if (!(await okToDiscard('close'))) return;
                    setForm(null);
                    setViewId(null);
                    setOffboardFor(x.staff.id);
                  }}
                  data-testid="leaving-open"
                >
                  <WithIcon icon={UserRoundCog} size={14}>
                    担当の振り直しを開く
                  </WithIcon>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card table-scroll">
        <table className="people-table">
          <thead>
            <tr>
              <th>名前</th>
              <th>勤務</th>
              <th>特性</th>
              <th>{terms.client}に求めること</th>
              <th>自宅の位置</th>
              <th>状態</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <td className="person-name">
                  <WithIcon icon={UserRound} size={15}>
                    {s.name}
                  </WithIcon>
                </td>
                <td className="nowrap">
                  <WithIcon icon={Clock} size={14}>
                    {s.workDays.map((d) => WEEKDAY_LABELS[d]).join('')} {s.shiftStart}〜{s.shiftEnd}
                  </WithIcon>
                </td>
                <td>
                  <TraitChips traits={s.traits} items={staffItems} />
                </td>
                <td className="cond-cell">
                  <CondChips requirements={s.requirements} preferences={s.preferences} itemById={itemById} />
                </td>
                <td>
                  {hasLocation(s.home) ? (
                    <span className="chip chip-ok">
                      <WithIcon icon={MapPin} size={13}>
                        あり
                      </WithIcon>
                    </span>
                  ) : (
                    <span className="chip chip-warn">未登録</span>
                  )}
                </td>
                <td>
                  {!s.active && <span className="chip">休止中</span>}
                  {s.lastDay && (
                    <span
                      className="chip chip-lastday"
                      title={`最終勤務日 ${s.lastDay}（翌日から勤務なし）`}
                      data-testid="staff-lastday"
                    >
                      最終 {mdText(s.lastDay)}
                    </span>
                  )}
                </td>
                <td className="nowrap">
                  <div className="actions">
                    <IconButton icon={Eye} label={`${s.name}を開く`} onClick={() => openView(s)} />
                    <Link
                      className="icon-btn tone-plain"
                      to={`/staff-view/${s.id}`}
                      title={`${s.name}さんの画面で見る`}
                      aria-label={`${s.name}さんの画面で見る`}
                    >
                      <Smartphone size={16} strokeWidth={2.2} aria-hidden="true" />
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(form || viewed) && (
        <SidePanel
          icon={form ? (isNew ? Plus : Pencil) : Eye}
          title={
            form
              ? isNew
                ? `${terms.staff}を追加`
                : `${terms.staff}を編集：${form.name.trim() || '（名前なし）'}`
              : `${terms.staff}：${viewed?.name.trim() || '（名前なし）'}`
          }
          onClose={closePanel}
          focusKey={form ? 'edit' : 'view'}
          headActions={
            !form &&
            viewed && (
              <button
                type="button"
                className="btn btn-edit"
                onClick={() => startEdit(viewed)}
                data-testid="view-edit"
                data-return-focus
              >
                <WithIcon icon={Pencil}>編集する</WithIcon>
              </button>
            )
          }
          footer={
            form && (
              <>
                <button type="button" className="btn btn-primary" onClick={save}>
                  <WithIcon icon={Save}>保存</WithIcon>
                </button>
                <button type="button" className="btn" onClick={cancelEdit} data-testid="edit-cancel">
                  <WithIcon icon={X}>取り消し</WithIcon>
                </button>
                {error && <span className="error">{error}</span>}
              </>
            )
          }
        >
          <SectionLevelProvider value={3}>
            {!form ? (
              viewed && <StaffView staff={viewed} data={data} />
            ) : (
              <>
                <div className="form-grid">
                  <label>
                    名前
                    <input
                      value={form.name}
                      maxLength={50}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </label>
                  {mailOn && (
                    <label>
                      メールアドレス（任意）
                      <input
                        type="email"
                        value={form.email}
                        maxLength={254}
                        autoComplete="off"
                        placeholder="name@example.com"
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        data-testid="staff-email"
                      />
                      <span className="sub">予定をメールアプリで開くときの宛先（送信は人が押します）</span>
                    </label>
                  )}
                  <label>
                    移動手段
                    <select
                      value={form.travelMode}
                      onChange={(e) => setForm({ ...form, travelMode: e.target.value as TravelMode })}
                    >
                      {TRAVEL_MODES.map((t) => (
                        <option key={t} value={t}>
                          {TRAVEL_MODE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    勤務開始
                    <input
                      type="time"
                      step={1800}
                      value={form.shiftStart}
                      onChange={(e) => setForm({ ...form, shiftStart: e.target.value })}
                    />
                  </label>
                  <label>
                    勤務終了
                    <input
                      type="time"
                      step={1800}
                      value={form.shiftEnd}
                      onChange={(e) => setForm({ ...form, shiftEnd: e.target.value })}
                    />
                  </label>
                </div>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <span className="sub">勤務する曜日</span>
                  {WEEKDAY_LABELS.map((w, d) => (
                    <Check
                      key={w}
                      checked={form.workDays.includes(d)}
                      onChange={(c) =>
                        setForm({
                          ...form,
                          workDays: c ? [...form.workDays, d].sort() : form.workDays.filter((x) => x !== d),
                        })
                      }
                    >
                      {w}
                    </Check>
                  ))}
                  <span style={{ marginLeft: 16 }} />
                  <Check checked={form.active} onChange={(c) => setForm({ ...form, active: c })}>
                    利用中（外すと休止）
                  </Check>
                </div>

                {offboardOn && (
                  <>
                    <SectionTitle icon={CalendarX}>最終勤務日（退職・担当替え）</SectionTitle>
                    <Hint>
                      退職や担当替えで、この日を最後に勤務しなくなるときに入れます。翌日からは勤務なしになり、予定・AI案に入りません。保存すると、その人が担当している
                      {terms.client}の代わりの{terms.staff}
                      をまとめて選ぶ欄が開きます（訪問の案は自動では作り直しません）。
                    </Hint>
                    <div className="row" style={{ flexWrap: 'wrap' }}>
                      <label className="row" style={{ gap: 6 }}>
                        最終勤務日
                        <input
                          type="date"
                          value={form.lastDay ?? ''}
                          onChange={(e) => setForm({ ...form, lastDay: e.target.value || null })}
                          data-testid="staff-lastday-input"
                          style={{ width: 'auto' }}
                        />
                      </label>
                      {form.lastDay && (
                        <button
                          type="button"
                          className="btn btn-small"
                          onClick={() => setForm({ ...form, lastDay: null })}
                        >
                          最終勤務日を消す
                        </button>
                      )}
                      {form.lastDay && <span className="sub">{mdText(addDays(form.lastDay, 1))}から勤務なし</span>}
                    </div>
                  </>
                )}

                <SectionTitle icon={BadgeCheck}>特性</SectionTitle>
                <TraitsEditor
                  items={staffItems}
                  value={form.traits}
                  onChange={(traits) => setForm({ ...form, traits })}
                />

                <SectionTitle icon={SlidersHorizontal}>{terms.client}に求めること：必要条件</SectionTitle>
                <Hint>
                  {terms.client}
                  の特性に対する条件です（例：ペットのいる家を避けるなら「ペットあり」を「なし」に）。満たさない
                  {terms.client}は「条件の重み」の画面の「
                  {terms.staff}の必要条件」で、点が付くか、必須なら担当にしません。
                </Hint>
                <ConditionsEditor
                  items={data.items}
                  target="client"
                  value={form.requirements}
                  onChange={(requirements) => setForm({ ...form, requirements })}
                />
                <SectionTitle icon={Sparkles}>{terms.client}に求めること：希望</SectionTitle>
                <ConditionsEditor
                  items={data.items}
                  target="client"
                  value={form.preferences}
                  onChange={(preferences) => setForm({ ...form, preferences })}
                />

                <SectionTitle icon={Home}>自宅</SectionTitle>
                {/* 郵便番号は住所を探すためだけで保存しない（自宅は契約の Place のまま。PRD D121） */}
                <AddressField
                  key={form.id}
                  value={form.home}
                  onChange={(home) => setForm((f) => (f ? { ...f, home } : f))}
                  testId="staff-home"
                  postalLabel="郵便番号（任意。住所を探すためだけで、保存しません）"
                />
              </>
            )}
          </SectionLevelProvider>
        </SidePanel>
      )}
      {offboardOn && offboardFor && !form && !viewed && (
        <OffboardPanel staffId={offboardFor} onClose={() => setOffboardFor(null)} />
      )}
    </div>
  );
}
