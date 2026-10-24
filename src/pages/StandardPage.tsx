// 組み方の標準（標準の週。PRD D350〜D354。ADR-0063）の画面。3段：案をくらべる → 表で直す（下書き） → 標準にする。
// 案・下書きは画面の外の入れ物（lib/standardDraft）に置き、ほかの画面へ移っても残す。実際の予定（訪問）には登録まで書かない。
// 登録は store の update の1回（全体の「元に戻す」で戻せる）
import { CalendarCheck, Crown } from 'lucide-react';
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrangeTabs } from '../components/ArrangeTabs';
import { useConfirm } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/ui';
import { useUndoAction } from '../components/undo';
import type { Pattern } from '../contracts/documents';
import { jstDate } from '../domain/time';
import { newId, WEEKDAY_LABELS } from '../lib/common';
import { patternWhenText } from '../lib/patternText';
import {
  bestIndex,
  type CellRef,
  cellOf,
  currentTable,
  cycleWeeks,
  defaultSince,
  diffCounts,
  earliestSince,
  mondayOf,
  registerStandard,
  type StandardCell,
  type StandardTable,
  setCell,
  standardPatterns,
  standardPeriod,
  startError,
  type TemporaryChoice,
  tableDiff,
  temporaryChanges,
  WEEKDAY_ORDER,
} from '../lib/standard';
import { patternsKey, runProposals, setDraft, standardWork, stopProposals } from '../lib/standardDraft';
import { useValueStore } from '../lib/valueStore';
import { useDemoData } from '../store';
import './settings.css';
import './standard.css';

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const cellKey = (r: CellRef) => `${r.patternId}|${r.weekday}`;

type TableProps = {
  rows: readonly Pattern[];
  weekdays: readonly number[];
  table: StandardTable | null;
  current: StandardTable;
  clientName: (id: string) => string;
  staffName: (id: string | null) => string;
  testId: string;
  /** 直せる表（下書き）だけ */
  edit?: {
    open: CellRef | null;
    onOpen: (ref: CellRef) => void;
    editor: (p: Pattern, wd: number) => React.ReactNode;
    cellRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>;
  };
};

/** 標準の表（行＝繰り返し・列＝曜日）。今の標準と違うマスに色と「変更」の文字 */
function StandardTableView({ rows, weekdays, table, current, clientName, staffName, testId, edit }: TableProps) {
  const changed = useMemo(
    () => new Map((table ? tableDiff(table, current) : []).map((d) => [cellKey(d), d.kind])),
    [table, current],
  );
  return (
    <div className="standard-table-scroll">
      <table className="standard-table" data-testid={testId}>
        <thead>
          <tr>
            <th scope="col">繰り返し</th>
            {weekdays.map((wd) => (
              <th key={wd} scope="col">
                {WEEKDAY_LABELS[wd]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.flatMap((p) => {
            const name = clientName(p.clientId);
            const editing = edit?.open?.patternId === p.id ? edit.open : null;
            const row = (
              <tr key={p.id} data-testid="standard-table-row" data-pattern={p.id}>
                <th scope="row">
                  <span className="standard-row-name">{name}</span>
                  <span className="standard-row-when">{patternWhenText(p)}</span>
                </th>
                {weekdays.map((wd) => {
                  const c = cellOf(table, current, p.id, wd);
                  if (!c || !p.weekdays.includes(wd)) {
                    return (
                      <td key={wd} className="standard-cell-none">
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">なし</span>
                      </td>
                    );
                  }
                  const ref = { patternId: p.id, weekday: wd };
                  const kind = changed.get(cellKey(ref));
                  const isChanged = kind !== undefined;
                  const tag = kind === 'staff' ? '担当変更' : '時刻変更';
                  const body = (
                    <>
                      <span className="standard-cell-staff">{staffName(c.staffId)}</span>
                      <span className="standard-cell-time">{c.start ?? '時刻なし'}</span>
                      {isChanged && <span className="standard-changed-tag">{tag}</span>}
                    </>
                  );
                  return (
                    <td
                      key={wd}
                      className={kind ? `is-changed is-changed-${kind}` : undefined}
                      data-testid="standard-cell"
                      data-pattern={p.id}
                      data-weekday={wd}
                      data-changed={isChanged}
                      data-kind={kind}
                    >
                      {edit ? (
                        <button
                          type="button"
                          className="standard-cell-btn"
                          aria-expanded={editing?.weekday === wd}
                          aria-label={`${name} ${WEEKDAY_LABELS[wd]}曜：${staffName(c.staffId)} ${c.start ?? '時刻なし'}${isChanged ? `（${tag}）` : ''}。押して直す`}
                          ref={(el) => {
                            if (el) edit.cellRefs.current.set(cellKey(ref), el);
                            else edit.cellRefs.current.delete(cellKey(ref));
                          }}
                          onClick={() => edit.onOpen(ref)}
                        >
                          {body}
                        </button>
                      ) : (
                        <span className="standard-cell-read">{body}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
            if (!editing || !edit) return [row];
            return [
              row,
              <tr key={`${p.id}-edit`} className="standard-edit-row">
                <td colSpan={weekdays.length + 1}>{edit.editor(p, editing.weekday)}</td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/** マスを直す小さな欄（担当と時刻。Esc で閉じる） */
function CellEditor({
  pattern,
  wd,
  cell,
  title,
  staff,
  onDone,
  onClose,
}: {
  pattern: Pattern;
  wd: number;
  cell: StandardCell;
  title: string;
  staff: readonly { id: string; name: string }[];
  onDone: (cell: StandardCell) => void;
  onClose: () => void;
}) {
  const [staffId, setStaffId] = useState<string>(cell.staffId ?? '');
  const [start, setStart] = useState<string>(cell.start ?? '');
  const [tried, setTried] = useState(false);
  const first = useRef<HTMLSelectElement>(null);
  const id = useId();
  useEffect(() => {
    first.current?.focus();
  }, []);
  const error = staffId === '' ? null : startError(pattern, wd, start);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (error) return;
    onDone({ staffId: staffId === '' ? null : staffId, start: staffId === '' || start === '' ? null : start });
  };
  return (
    <form
      className="standard-editor"
      data-testid="standard-editor"
      aria-label={title}
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <p className="standard-editor-title">{title}</p>
      <label className="field">
        担当
        <select
          ref={first}
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
          data-testid="standard-editor-staff"
        >
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          <option value="">担当なし</option>
        </select>
      </label>
      <label className="field">
        開始（空＝時刻なし）
        <input
          type="time"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          aria-invalid={tried && !!error}
          aria-describedby={`${id}-hint${tried && error ? ` ${id}-err` : ''}`}
          data-testid="standard-editor-start"
        />
      </label>
      <p className="sub" id={`${id}-hint`}>
        {(() => {
          const t = pattern.dayTimes.find((x) => x.weekday === wd) ?? pattern;
          return `時間の約束：${t.earliestStart === t.latestStart ? `${t.earliestStart}ちょうど` : `${t.earliestStart}〜${t.latestStart}`}`;
        })()}
      </p>
      {tried && error && (
        <p className="error" id={`${id}-err`} role="alert" data-testid="standard-editor-error">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" className="btn btn-small" data-testid="standard-editor-ok">
          決める
        </button>
        <button type="button" className="btn btn-small btn-text" onClick={onClose}>
          やめる
        </button>
      </div>
    </form>
  );
}

export default function StandardPage() {
  const { data, update } = useDemoData();
  const today = jstDate(Date.now());
  const confirmDialog = useConfirm();
  const toast = useToast();
  const undoAction = useUndoAction();
  const work = useValueStore(standardWork);
  const terms = data.org.terms;
  const staffName = (id: string | null) =>
    id === null ? '担当なし' : (data.staff.find((s) => s.id === id)?.name ?? '（いない人）');
  const clientName = (id: string) => data.clients.find((c) => c.id === id)?.displayName ?? id;
  const presetName = (id: string | null) => data.presets.find((p) => p.id === id)?.name ?? '消したプリセット';

  const current = useMemo(() => currentTable(data, today), [data, today]);
  const key = useMemo(() => patternsKey(data, today), [data, today]);
  const rows = useMemo(() => {
    const names = new Map(data.clients.map((c) => [c.id, c.displayName]));
    const firstWd = (p: Pattern) => Math.min(...p.weekdays.map((w) => (w + 6) % 7));
    return [...standardPatterns(data, today)].sort(
      (a, b) =>
        (names.get(a.clientId) ?? '').localeCompare(names.get(b.clientId) ?? '', 'ja') || firstWd(a) - firstWd(b),
    );
  }, [data, today]);
  const weekdays = useMemo(() => WEEKDAY_ORDER.filter((wd) => rows.some((p) => p.weekdays.includes(wd))), [rows]);
  const workingStaff = useMemo(
    () =>
      data.staff
        .filter((s) => s.active)
        .map((s) => ({ id: s.id, name: s.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ja')),
    [data.staff],
  );
  const cycle = cycleWeeks(data, today);
  const period = standardPeriod(data, today);
  const tableProps = { rows, weekdays, current, clientName, staffName };

  // 1. 案をくらべる
  const running = work.running;
  const [viewing, setViewing] = useState<string | null>(null);
  const viewId = useId();
  const run = () => {
    setViewing(null);
    void runProposals(data, today);
  };
  const cards = data.presets.map((preset) => {
    const prop = work.proposals.find((x) => x.presetId === preset.id);
    const diff = prop?.table ? diffCounts(tableDiff(prop.table, current)) : null;
    return { preset, prop, diff };
  });
  const best = bestIndex(cards.map((c) => c.prop?.stats ?? null));
  const proposalsStale = work.proposalsOf !== null && work.proposalsOf.key !== key;
  const viewed = cards.find((c) => c.preset.id === viewing && c.prop?.table);

  const draftHead = useRef<HTMLHeadingElement>(null);
  const focusDraft = () =>
    requestAnimationFrame(() => {
      draftHead.current?.scrollIntoView({ block: 'start' });
      draftHead.current?.focus();
    });
  const pickProposal = async (presetId: string, table: StandardTable) => {
    if (work.draft) {
      const ok = await confirmDialog({
        title: `下書きを「${presetName(presetId)}」の案で置き換えますか？`,
        body: '今の下書きで直した所は消えます',
        confirmLabel: '置き換える',
      });
      if (!ok) return;
    }
    setDraft({ table, from: presetId }, key);
    setEditing(null);
    focusDraft();
  };

  // 2. 表で直す（下書き）
  const draft = work.draft;
  const draftDiff = useMemo(() => (draft ? tableDiff(draft.table, current) : []), [draft, current]);
  const [editing, setEditing] = useState<CellRef | null>(null);
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  const closeEditor = (ref: CellRef | null) => {
    setEditing(null);
    // マスのボタンは残るので、欄を消す前にフォーカスを移す（消えた欄にフォーカスを残さない）
    if (ref) cellRefs.current.get(cellKey(ref))?.focus();
  };
  const fromCurrent = () => {
    setDraft({ table: current, from: null }, key);
    setEditing(null);
    focusDraft();
  };
  const discard = async () => {
    if (!draft) return;
    if (draftDiff.length > 0) {
      const ok = await confirmDialog({
        title: '下書きを捨てますか？',
        body: `今の標準と違う ${draftDiff.length}か所の直しが消えます。標準と予定は変わりません`,
        confirmLabel: '捨てる',
        tone: 'danger',
      });
      if (!ok) return;
    }
    setDraft(null, null);
    setEditing(null);
  };

  // 3. 標準にする
  const minSince = earliestSince(data, today);
  const [sinceIn, setSinceIn] = useState<string | null>(null);
  const since = sinceIn !== null && sinceIn >= minSince ? sinceIn : defaultSince(data, today);
  const temps = useMemo(
    () => (draft && draftDiff.length > 0 ? temporaryChanges(data, draft.table, since, today) : []),
    [data, draft, draftDiff.length, since, today],
  );
  const [temp, setTemp] = useState<TemporaryChoice>('drop');
  const register = async () => {
    if (!draft || draftDiff.length === 0) return;
    const patternsChanged = new Set(draftDiff.map((c) => c.patternId)).size;
    const lines = [
      `今の標準と違う ${draftDiff.length}か所（繰り返し ${patternsChanged}件）を書き換えます。曜日で担当が違う繰り返しは曜日ごとに分けます。`,
      `${md(since)}から先の予定は、この表の担当・時刻で並びます。`,
      temps.length > 0
        ? temp === 'drop'
          ? `すでに入っている予定で新しい標準と違う ${temps.length}件は、消して標準どおりにします。`
          : `すでに入っている予定で新しい標準と違う ${temps.length}件は、今の担当のまま固定（ピン）します。`
        : '',
      draft.from ? `標準の考え方（点数の基準）を「${presetName(draft.from)}」にします。` : '',
      '伝えた日の予定とピンの予定は変えません。元に戻すで戻せます',
    ].filter(Boolean);
    const ok = await confirmDialog({
      title: `この表を ${md(since)} から標準にしますか？`,
      body: lines.join('\n'),
      confirmLabel: '標準にする',
    });
    if (!ok) return;
    const table = draft.table;
    const presetId = draft.from;
    update(
      (d) =>
        registerStandard(d, table, since, today, { newId: () => newId('pattern'), temp, at: Date.now(), presetId }),
      '組み方の標準を登録',
    );
    setDraft(null, null);
    standardWork.set((w) => ({ ...w, registered: { since } }));
    setEditing(null);
    toast('標準にしました', { action: undoAction });
  };

  const std = data.standard;
  const registered = work.registered;

  return (
    <div className="stack standard-page">
      <PageHeader
        nav={<ArrangeTabs />}
        icon={CalendarCheck}
        title="組み方の標準"
        lead="誰が・何曜・何時に行くかの標準を表で決めます。登録すると、先の週・月はこの表のとおりに並びます"
      />
      <p className="sub" data-testid="standard-now">
        {std
          ? `標準：${md(std.from)}から・考え方「${presetName(std.presetId)}」・${std.weeks}週の周期（${md(jstDate(std.at))}に登録）`
          : 'まだ標準を登録していません'}
      </p>
      <ol className="standard-steps stack" data-testid="standard-steps">
        <li className="card stack" data-step="proposals">
          <h2>1. 案をくらべる</h2>
          <p className="sub" data-testid="standard-period">
            プリセット（考え方）ごとに、{md(period.from)}〜{md(period.to)}（{period.weeks}週。{cycle.reason}）の担当を
            AI
            で組み、標準の表の案を作ります。繰り返しだけから作り（ピン・今の予定の手直しは見ません）、今の予定は変わりません
          </p>
          <div className="row">
            <button
              type="button"
              className={draft ? 'btn' : 'btn btn-primary'}
              onClick={run}
              disabled={running !== null}
              data-testid="standard-run"
            >
              {data.presets.length}つの考え方で案を作る
            </button>
            {running && (
              <>
                <output data-testid="standard-progress">
                  「{running.presetName}」で作っています {running.day}/{running.days}日
                </output>
                <button type="button" className="btn btn-small" onClick={stopProposals} data-testid="standard-stop">
                  止める
                </button>
              </>
            )}
          </div>
          {work.error && (
            <p className="error" role="alert">
              {work.error}
            </p>
          )}
          {proposalsStale && (
            <p className="sub warn" data-testid="standard-proposals-stale">
              案を作ったあとに繰り返しが変わりました。作り直すと今の繰り返しで比べられます
            </p>
          )}
          <ul className="standard-cards">
            {cards.map(({ preset, prop, diff }, i) => {
              const s = prop?.stats ?? null;
              const ready = !!prop?.done && !!prop.table;
              return (
                <li key={preset.id} className="card standard-card" data-testid="standard-card" data-preset={preset.id}>
                  <h3>
                    {i === best && <Crown size={16} aria-label="いちばん点が高い" data-testid="standard-crown" />}
                    {preset.name}
                  </h3>
                  {preset.note && <p className="sub">{preset.note}</p>}
                  {ready ? (
                    <dl className="standard-stats">
                      <dt>点</dt>
                      <dd data-testid="standard-points">{s?.points ?? '—'}</dd>
                      <dt>移動</dt>
                      <dd>{s ? `${Math.round(s.travelMinutes / 6) / 10}時間` : '—'}</dd>
                      <dt>担当なし</dt>
                      <dd>{s ? `${s.unassigned}件` : '—'}</dd>
                      <dt>件数の偏り</dt>
                      <dd
                        title={
                          s?.most && s.least
                            ? `いちばん多い：${staffName(s.most.staffId)} ${s.most.count}件・いちばん少ない：${staffName(s.least.staffId)} ${s.least.count}件`
                            : undefined
                        }
                        data-testid="standard-spread"
                      >
                        {s ? `${s.spread}件` : '—'}
                      </dd>
                      <dt>今の標準と違う</dt>
                      <dd data-testid="standard-card-diff" data-count={diff?.all ?? 0}>
                        {diff ? `${diff.all}マス（担当 ${diff.staff}・時刻だけ ${diff.time}）` : '—'}
                      </dd>
                    </dl>
                  ) : (
                    <p className="sub">
                      {running && prop ? '作っています…' : running ? '順番を待っています' : 'まだ作っていません'}
                    </p>
                  )}
                  {ready && prop?.table && (
                    <div className="row">
                      <button
                        type="button"
                        className="btn btn-small"
                        aria-expanded={viewing === preset.id}
                        aria-controls={viewId}
                        onClick={() => setViewing((v) => (v === preset.id ? null : preset.id))}
                        data-testid="standard-view"
                      >
                        {viewing === preset.id ? '表を閉じる' : '表で見る'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => void pickProposal(preset.id, prop.table as StandardTable)}
                        data-testid="standard-use"
                      >
                        この案から作る
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {viewed?.prop?.table && (
            <section id={viewId} className="stack" aria-label={`「${viewed.preset.name}」の案の表`}>
              <h3 className="standard-view-title">
                「{viewed.preset.name}」の案の表（今の標準と違うマス {viewed.diff?.all ?? 0}。担当{' '}
                {viewed.diff?.staff ?? 0}・時刻だけ {viewed.diff?.time ?? 0}）
              </h3>
              <StandardTableView {...tableProps} table={viewed.prop.table} testId="standard-view-table" />
            </section>
          )}
        </li>

        <li className="card stack" data-step="draft">
          <h2 ref={draftHead} tabIndex={-1}>
            2. 表で直す（下書き）
          </h2>
          {!draft ? (
            <>
              <p className="sub">
                下書きの表で、{terms.client}
                の繰り返しごと・曜日ごとに担当と時刻を直します。上の案から作るか、今の標準から作ります。下書きは標準にするまで予定に書きません
              </p>
              <div className="row">
                <button type="button" className="btn" onClick={fromCurrent} data-testid="standard-from-current">
                  今の標準から作る
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="sub" data-testid="standard-draft-from">
                {draft.from ? `「${presetName(draft.from)}」の案から作った下書き` : '今の標準から作った下書き'}
                。マスを押すと担当と時刻を直せます
              </p>
              <p data-testid="standard-diff-count">
                <strong>今の標準と違う所 {draftDiff.length}か所</strong>（担当 {diffCounts(draftDiff).staff}・時刻だけ{' '}
                {diffCounts(draftDiff).time}）
              </p>
              {work.draftKey !== key && (
                <p className="sub warn" data-testid="standard-draft-stale">
                  下書きを作ったあとに繰り返しが変わりました。無くなった繰り返しは外し、新しい繰り返しは今の標準で出しています
                </p>
              )}
              <StandardTableView
                {...tableProps}
                table={draft.table}
                testId="standard-table"
                edit={{
                  open: editing,
                  onOpen: (ref) => setEditing((e) => (e && cellKey(e) === cellKey(ref) ? null : ref)),
                  cellRefs,
                  editor: (p, wd) => {
                    const c = cellOf(draft.table, current, p.id, wd);
                    if (!c) return null;
                    const ref = { patternId: p.id, weekday: wd };
                    return (
                      <CellEditor
                        key={cellKey(ref)}
                        pattern={p}
                        wd={wd}
                        cell={c}
                        title={`${clientName(p.clientId)} ${WEEKDAY_LABELS[wd]}曜の担当と時刻`}
                        staff={workingStaff}
                        onDone={(cell) => {
                          const w = standardWork.get();
                          if (w.draft) setDraft({ ...w.draft, table: setCell(w.draft.table, ref, cell) }, w.draftKey);
                          closeEditor(ref);
                        }}
                        onClose={() => closeEditor(ref)}
                      />
                    );
                  },
                }}
              />
              <div className="row">
                <button
                  type="button"
                  className="btn btn-small btn-text"
                  onClick={() => void discard()}
                  data-testid="standard-discard"
                >
                  下書きを捨てる
                </button>
              </div>
            </>
          )}
        </li>

        {(draft || registered) && (
          <li className="card stack" data-step="register">
            <h2>3. 標準にする</h2>
            {draft ? (
              <>
                <label className="row">
                  いつから
                  <input
                    type="date"
                    value={since}
                    min={minSince}
                    onChange={(e) => setSinceIn(e.target.value || null)}
                    data-testid="standard-since"
                  />
                </label>
                {temps.length > 0 && (
                  <fieldset className="standard-temp stack" data-testid="standard-temp-choice">
                    <legend>
                      {md(since)}から先ですでに担当が入っている予定のうち、新しい標準と違うもの
                      <strong data-testid="standard-temp-count"> {temps.length}件</strong>
                    </legend>
                    <label className="standard-choice">
                      <input
                        type="radio"
                        name="standard-temp"
                        checked={temp === 'drop'}
                        onChange={() => setTemp('drop')}
                        data-testid="standard-temp-drop"
                      />
                      <span>
                        <strong>標準どおりに入れ替える（おすすめ）</strong>
                        <span className="sub">その予定を消して、新しい標準の担当・時刻にします</span>
                      </span>
                    </label>
                    <label className="standard-choice">
                      <input
                        type="radio"
                        name="standard-temp"
                        checked={temp === 'pin'}
                        onChange={() => setTemp('pin')}
                        data-testid="standard-temp-pin"
                      />
                      <span>
                        <strong>今のまま残す</strong>
                        <span className="sub">その予定は今の担当のまま固定（ピン）します</span>
                      </span>
                    </label>
                    <details>
                      <summary>どの予定か見る</summary>
                      <ul className="standard-temp-list">
                        {temps.slice(0, 20).map((t) => (
                          <li key={t.visitId}>
                            {md(t.date)}（{WEEKDAY_LABELS[new Date(`${t.date}T00:00:00Z`).getUTCDay()]}）
                            {clientName(t.clientId)}：今 {staffName(t.now.staffId)} {t.now.start ?? ''} → 標準{' '}
                            {staffName(t.standard.staffId)} {t.standard.start ?? ''}
                          </li>
                        ))}
                        {temps.length > 20 && <li>ほか {temps.length - 20}件</li>}
                      </ul>
                    </details>
                  </fieldset>
                )}
                <div className="row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void register()}
                    disabled={draftDiff.length === 0}
                    data-testid="standard-register"
                  >
                    この表を標準にする
                  </button>
                  {draftDiff.length === 0 && (
                    <span className="sub" data-testid="standard-same">
                      今の標準と同じです
                    </span>
                  )}
                </div>
              </>
            ) : (
              registered && (
                <div className="standard-done stack" data-testid="standard-done">
                  <p>
                    <strong>{md(registered.since)} から毎週この表のとおりに並びます</strong>
                  </p>
                  <div className="row">
                    <Link to={`/week?d=${mondayOf(registered.since)}`} className="btn" data-testid="standard-week-link">
                      週の予定で見る
                    </Link>
                  </div>
                </div>
              )
            )}
          </li>
        )}
      </ol>
    </div>
  );
}
