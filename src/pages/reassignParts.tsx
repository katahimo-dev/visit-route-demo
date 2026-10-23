// 欠勤の振り直しの2回目（PRD D34・D35。ADR-0011 追記）：案B「少し動かしてよい」の欄と、連絡の一覧
import {
  ArrowUpToLine,
  ClipboardCopy,
  MessageSquareText,
  Play,
  Printer,
  Square,
  UserRoundCheck,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FLOATING_EVENT, useFloatingEdge } from '../components/floating';
import { MailButton, MailLengthNote } from '../components/mailParts';
import { WeightSlider } from '../components/parts';
import { StaffMarkById } from '../components/StaffMark';
import { Hint, SidePanel, WithIcon } from '../components/ui';
import type { Terms } from '../contracts/documents';
import type { ContactList, ContactVisit, ReassignDiff } from '../contracts/reassign';
import { copyText } from '../lib/clipboard';
import { deltaText, r0 } from '../lib/common';
import { allContactsText, type ContactWords, clientMessages, clock, staffMessage } from '../lib/contacts';
import { NO_EMAIL } from '../lib/mail';
import type { BuiltMail } from '../lib/mailto';
import { type ReadableStore, useValueStore } from '../lib/valueStore';
import { STAY_WEIGHT_DEFAULT } from '../reassign';

/** 案A・案B の比べる数（元の案との差と点数） */
export type ReassignOption = {
  key: 'insert' | 'anneal';
  title: string;
  diff: ReassignDiff | null;
  /** 点数（点数の基準の物差し） */
  hundred: number | null;
  /** 今の案と同じか */
  current: boolean;
};

/** 担当が変わる訪問のうち、欠勤の人以外の訪問（案B が動かした分） */
function othersMoved(d: ReassignDiff, absent: ReadonlySet<string>): number {
  return d.moved.filter((m) => m.from !== null && m.to !== null && !absent.has(m.from)).length;
}

/** 案B の進み具合のバーと回数（外の入れ物から読み、変わってもここだけ描き直す。PRD D249） */
function AnnealProgress({ store }: { store: ReadableStore<{ iteration: number; total: number } | null> }) {
  const progress = useValueStore(store);
  return (
    <>
      <progress
        value={progress?.iteration ?? 0}
        max={progress?.total ?? 1}
        style={{ width: '100%' }}
        aria-label="案B の進み具合"
      />
      <span className="sub" data-testid="anneal-progress">
        案B を作っています：
        {progress ? `${progress.iteration.toLocaleString()} / ${progress.total.toLocaleString()} 回` : '準備中…'}
      </span>
    </>
  );
}

/**
 * 案B「少し動かしてよい」の欄（差の欄の中）：「変更を減らす」のスライダー（「詳しく」に畳む。PRD D265）・作る・進み具合・
 * 止める・案A と案B の比較・選ぶ。
 * 案A で入らない訪問があるときは「おすすめ」を出す
 */
export function AnnealBox({
  weight,
  onWeight,
  recommended,
  disabledWhy,
  running,
  progress,
  onStart,
  onStop,
  options,
  absentStaff,
  onChoose,
  stopped,
  note = null,
}: {
  weight: number;
  onWeight: (w: number) => void;
  recommended: boolean;
  /** 作れないときの理由（欠勤が取り消されている・計算中など）。null なら押せる */
  disabledWhy: string | null;
  /** 案B を計算中 */
  running: boolean;
  /** 計算の進み具合（外の入れ物。変わっても進み具合の部品だけ描き直す。PRD D249） */
  progress: ReadableStore<{ iteration: number; total: number } | null>;
  onStart: () => void;
  onStop: () => void;
  /** 案A・案B（案B を作ったあと） */
  options: ReassignOption[];
  absentStaff: ReadonlySet<string>;
  onChoose: (key: ReassignOption['key']) => void;
  /** 案B を途中で止めた */
  stopped: boolean;
  /** 案B を案A のままにした理由（案A に入っていた訪問を外した・案A を超えられなかった）。無ければ null */
  note?: string | null;
}) {
  const rows: { label: string; value: (o: ReassignOption) => string }[] = [
    { label: '点数', value: (o) => (o.hundred === null ? '—' : `${o.hundred}点`) },
    { label: '入らない', value: (o) => (o.diff ? `${o.diff.unplaced.length}件` : '—') },
    {
      label: '担当が変わる訪問',
      value: (o) =>
        o.diff ? `${o.diff.moved.length}件（うち欠勤の人以外 ${othersMoved(o.diff, absentStaff)}件）` : '—',
    },
    { label: '時刻がずれる訪問', value: (o) => (o.diff ? `${o.diff.shifted.length}件` : '—') },
    { label: '変わる人', value: (o) => (o.diff ? `${o.diff.changedStaff.length}人` : '—') },
    { label: '移動', value: (o) => (o.diff ? deltaText(r0(o.diff.travelDelta), '分') || '±0分' : '—') },
  ];
  const showTable = options.some((o) => o.key === 'anneal');
  return (
    <div className="stack anneal-box" style={{ gap: 6 }} data-testid="anneal-box">
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <strong>少し動かしてよい（案B）</strong>
        {recommended && <span className="chip chip-primary">おすすめ：案A で入らない訪問があります</span>}
        <Hint>
          <ul className="hint-list">
            <li>ほかの人の訪問の担当・順番・時刻も少し動かして、入らない訪問を入れる案を AI が作ります。</li>
            <li>変える訪問が少ない案を選びます。案A より悪い案にはなりません。</li>
            <li>変えた訪問の数は、下の表で見られます。</li>
          </ul>
        </Hint>
      </div>
      {/* 「変更を減らす」はふだん触らないので「詳しく」に畳む（PRD D265。開いたかどうかは保存しない） */}
      <details className="anneal-more" data-testid="anneal-more">
        <summary>
          詳しく：変更を減らす（{weight.toFixed(1)}
          {weight === STAY_WEIGHT_DEFAULT ? '・既定' : ''}）
        </summary>
        <div className="row anneal-weight" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="sub">変更を減らす</span>
          <WeightSlider value={weight} onChange={onWeight} label="変更を減らす" />
          <span className="sub">
            担当が変わる1件＝移動{r0(weight * 10)}分ぶん・時刻のずれ10分＝移動{r0(weight * 2 * 10) / 10}分ぶん
            {weight === STAY_WEIGHT_DEFAULT ? '（既定）' : ''}
          </span>
          <span className="sub">重みが大きいと案A のままになることがあります（変更の減点が、得より大きいとき）</span>
        </div>
      </details>
      <div className="row" style={{ gap: 6 }}>
        {running ? (
          <button type="button" className="btn btn-small" onClick={onStop}>
            <WithIcon icon={Square} size={14}>
              止める
            </WithIcon>
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-small"
            disabled={disabledWhy !== null}
            title={disabledWhy ?? undefined}
            onClick={onStart}
          >
            <WithIcon icon={Play} size={14}>
              {showTable ? '案B を作り直す' : '案B を作る'}
            </WithIcon>
          </button>
        )}
        {disabledWhy && !running && <span className="sub">{disabledWhy}</span>}
      </div>
      {running && (
        <div className="stack" style={{ gap: 2 }} aria-live="polite">
          <AnnealProgress store={progress} />
        </div>
      )}
      {note && !running && (
        <p className="sub" data-testid="anneal-note">
          {note}
        </p>
      )}
      {showTable && (
        <table className="anneal-table" data-testid="anneal-table">
          <thead>
            <tr>
              <th scope="col">振り直す前との差</th>
              {options.map((o) => (
                <th key={o.key} scope="col">
                  {o.title}
                  {o.current && <span className="chip chip-ok anneal-current">反映中</span>}
                  {o.key === 'anneal' && stopped && <span className="sub">（途中で止めた）</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                {options.map((o) => (
                  <td key={o.key}>{r.value(o)}</td>
                ))}
              </tr>
            ))}
            <tr>
              <td />
              {options.map((o) => (
                <td key={o.key}>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={o.current || running}
                    onClick={() => onChoose(o.key)}
                  >
                    {o.current ? '反映済み' : `${o.title}を反映する`}
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

/** 連絡の一覧の1行の時刻（元 → 今） */
function timeChange(x: ContactVisit): string {
  if (x.fromStart === null) return clock(x.toStart);
  if (x.toStart === null || Math.round(x.toStart - x.fromStart) === 0) return clock(x.fromStart);
  return `${clock(x.fromStart)} → ${clock(x.toStart)}`;
}

/** 連絡の一覧に出す、欠勤の人に残る訪問（時刻は「9:00」。対応が必要） */
export type LeftContact = { visitId: string; clientId: string; staffId: string; at: string; reason: string };

/**
 * 連絡の一覧（右から出る欄。確定前でも見られる）：担当が変わる訪問先・時刻が変わる訪問・仕事が増える/減るスタッフと、
 * スタッフごと・訪問先ごとの連絡文（コピー）。印刷するとこの欄だけが出る。送信はしない
 */
export function ContactPanel({
  list,
  left = [],
  words,
  terms,
  staffMail,
  onCopied,
  onClose,
}: {
  list: ContactList;
  /** 欠勤の人に残る、振り直すべき訪問（連絡文には入れず、一覧のいちばん上に出す） */
  left?: LeftContact[];
  words: ContactWords;
  terms: Terms;
  /**
   * 担当が変わった〈スタッフ〉あてのメール（PRD D94。ADR-0017）：スタッフの ID と連絡文から、メールアプリを開く URL を作る。
   * メールアドレスが無ければ null（ボタンは押せず理由を出す）。渡さなければメールのボタンを出さない
   */
  staffMail?: (staffId: string, text: string) => BuiltMail | null;
  /** コピーしたあと（ok：できたか） */
  onCopied: (ok: boolean, what: string) => void;
  onClose: () => void;
}) {
  const clients = clientMessages(list, words);
  const empty = list.staff.length === 0 && list.staffChanged.length === 0;
  const nothing = empty && left.length === 0;
  const copy = (text: string, what: string) => {
    void copyText(text).then((ok) => onCopied(ok, what));
  };
  return (
    <SidePanel
      icon={MessageSquareText}
      title="連絡の一覧"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn btn-primary"
            disabled={empty}
            onClick={() => copy(allContactsText(list, words), 'すべての連絡文')}
          >
            <WithIcon icon={ClipboardCopy}>すべての連絡文をコピー</WithIcon>
          </button>
          <button type="button" className="btn" disabled={empty} onClick={() => window.print()}>
            <WithIcon icon={Printer}>印刷</WithIcon>
          </button>
          <button type="button" className="btn" onClick={onClose}>
            <WithIcon icon={X}>閉じる</WithIcon>
          </button>
        </>
      }
    >
      <div className="stack contact-sheet" data-testid="contact-sheet">
        <p className="sub">
          振り直す前と今の担当の差から作っています（確定の前でも見られます）。連絡文はコピーするだけで、送信はしません。
        </p>
        {left.length > 0 && (
          <section className="stack contact-section left-box" style={{ gap: 4 }} data-testid="contact-left">
            <h3 className="error">欠勤の人に残っている訪問（{left.length}件）：対応が必要</h3>
            <p className="sub">
              欠勤の時間と重なるのに振り直していない訪問です（連絡文には入りません）。別の{terms.staff}
              への振り替えと{terms.client}への連絡を決めてください
            </p>
            <table className="contact-table">
              <thead>
                <tr>
                  <th scope="col">時刻</th>
                  <th scope="col">{terms.client}</th>
                  <th scope="col">担当（欠勤）</th>
                  <th scope="col">理由</th>
                </tr>
              </thead>
              <tbody>
                {left.map((x) => (
                  <tr key={x.visitId}>
                    <td className="nowrap">{x.at}</td>
                    <td>{words.clientName(x.clientId)}様</td>
                    <td>
                      <span className="with-staff-mark">
                        <StaffMarkById id={x.staffId} size="xs" />
                        {words.staffName(x.staffId)}
                      </span>
                    </td>
                    <td>{x.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        {nothing ? (
          <p>連絡が要る変更はありません。</p>
        ) : empty ? null : (
          <>
            <section className="stack contact-section" style={{ gap: 4 }}>
              <h3>
                担当が変わる{terms.client}（{list.staffChanged.length}件）
              </h3>
              {list.staffChanged.length === 0 ? (
                <p className="sub">ありません</p>
              ) : (
                <table className="contact-table">
                  <thead>
                    <tr>
                      <th scope="col">時刻</th>
                      <th scope="col">{terms.client}</th>
                      <th scope="col">前の担当 → 新しい担当</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.staffChanged.map((x) => (
                      <tr key={x.visitId}>
                        <td className="nowrap">{timeChange(x)}</td>
                        <td>{words.clientName(x.clientId)}様</td>
                        <td>
                          {x.fromStaffId ? (
                            <span className="with-staff-mark">
                              <StaffMarkById id={x.fromStaffId} size="xs" />
                              {words.staffName(x.fromStaffId)}
                            </span>
                          ) : (
                            '（なし）'
                          )}{' '}
                          →{' '}
                          {x.toStaffId ? (
                            <span className="with-staff-mark">
                              <StaffMarkById id={x.toStaffId} size="xs" />
                              {words.staffName(x.toStaffId)}
                            </span>
                          ) : (
                            <strong>入らない（調整中）</strong>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section className="stack contact-section" style={{ gap: 4 }}>
              <h3>
                時刻だけ変わる{terms.client}（{list.timeChanged.length}件）
              </h3>
              {list.timeChanged.length === 0 ? (
                <p className="sub">ありません</p>
              ) : (
                <table className="contact-table">
                  <thead>
                    <tr>
                      <th scope="col">時刻</th>
                      <th scope="col">{terms.client}</th>
                      <th scope="col">担当</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.timeChanged.map((x) => (
                      <tr key={x.visitId}>
                        <td className="nowrap">{timeChange(x)}</td>
                        <td>{words.clientName(x.clientId)}様</td>
                        <td>
                          {x.toStaffId && (
                            <span className="with-staff-mark">
                              <StaffMarkById id={x.toStaffId} size="xs" />
                              {words.staffName(x.toStaffId)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section className="stack contact-section" style={{ gap: 4 }}>
              <h3>
                仕事が増える・減る{terms.staff}（{list.staff.length}人）
              </h3>
              <ul className="contact-staff">
                {list.staff.map((c) => (
                  <li key={c.staffId}>
                    <strong className="with-staff-mark">
                      <StaffMarkById id={c.staffId} size="xs" />
                      {words.staffName(c.staffId)}
                    </strong>
                    {c.added.length > 0 && <span className="chip chip-move">増える {c.added.length}件</span>}
                    {c.removed.length > 0 && <span className="chip">外れる {c.removed.length}件</span>}
                    {c.shifted.length > 0 && <span className="chip chip-warn">時刻が変わる {c.shifted.length}件</span>}
                    <ul>
                      {c.added.map((x) => (
                        <li key={`a-${x.visitId}`}>
                          追加：{clock(x.toStart)} {words.clientName(x.clientId)}様
                          {words.clientAddress(x.clientId) ? `（${words.clientAddress(x.clientId)}）` : ''}
                        </li>
                      ))}
                      {c.removed.map((x) => (
                        <li key={`r-${x.visitId}`}>
                          外れる：{clock(x.fromStart)} {words.clientName(x.clientId)}様
                        </li>
                      ))}
                      {c.shifted.map((x) => (
                        <li key={`s-${x.visitId}`}>
                          時刻：{timeChange(x)} {words.clientName(x.clientId)}様
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
            <section className="stack contact-section" style={{ gap: 6 }}>
              <h3>
                連絡文（{terms.staff}あて・{list.staff.length}人）
              </h3>
              {list.staff.map((c) => {
                const text = staffMessage(c, words);
                const mail = staffMail?.(c.staffId, text) ?? null;
                return (
                  <ContactMessage
                    key={c.staffId}
                    text={text}
                    label={`${words.staffName(c.staffId)}さんへの連絡文`}
                    onCopy={() => copy(text, `${words.staffName(c.staffId)}さんへの連絡文`)}
                    extra={
                      staffMail && (
                        <>
                          <MailButton
                            mail={mail}
                            label="メール"
                            why={NO_EMAIL}
                            srLabel={`${words.staffName(c.staffId)}さんへのメールを作る`}
                            testId="contact-mail"
                          />
                          <MailLengthNote mail={mail} />
                        </>
                      )
                    }
                  />
                );
              })}
            </section>
            <section className="stack contact-section" style={{ gap: 6 }}>
              <h3>
                連絡文（{terms.client}あて・{clients.length}件）
              </h3>
              {clients.length === 0 && <p className="sub">ありません</p>}
              {clients.map((c) => (
                <ContactMessage
                  key={c.clientId}
                  text={c.text}
                  label={`${words.clientName(c.clientId)}様への連絡文`}
                  onCopy={() => copy(c.text, `${words.clientName(c.clientId)}様への連絡文`)}
                />
              ))}
            </section>
          </>
        )}
      </div>
    </SidePanel>
  );
}

function ContactMessage({
  text,
  label,
  onCopy,
  extra,
}: {
  text: string;
  label: string;
  onCopy: () => void;
  /** コピーの横に並べるもの（メールのボタン。PRD D94） */
  extra?: ReactNode;
}) {
  return (
    <div className="contact-msg">
      <pre title={label}>{text}</pre>
      <div className="contact-msg-acts no-print">
        <button type="button" className="btn btn-small" onClick={onCopy} aria-label={`${label}をコピー`}>
          <WithIcon icon={ClipboardCopy} size={14}>
            コピー
          </WithIcon>
        </button>
        {extra}
      </div>
    </div>
  );
}

/** 差の欄の「連絡の一覧」ボタン（件数は連絡が要る訪問の数） */
export function ContactButton({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button type="button" className="btn btn-small" onClick={onOpen}>
      <WithIcon icon={MessageSquareText} size={14}>
        連絡の一覧{count > 0 ? `（訪問${count}件）` : ''}
      </WithIcon>
    </button>
  );
}

/**
 * 差の欄が画面の外にあるとき、画面の左下に出す小さな帯（地図の MapDock は右下）：振り直しの状態と、
 * 差の欄へ・案B を作る・連絡の一覧への近道。差の欄が見えているあいだは出さない
 */
export function ReassignDock({
  targetId,
  unplaced,
  left,
  method,
  annealRecommended,
  annealRunning,
  contactCount,
  onGo,
  onAnneal,
  onContacts,
}: {
  /** 差の欄の要素の id */
  targetId: string;
  unplaced: number;
  /** 欠勤の人に残る訪問の件数 */
  left: number;
  method: 'insert' | 'anneal';
  /** 案B を勧める（押せる） */
  annealRecommended: boolean;
  annealRunning: boolean;
  contactCount: number;
  onGo: () => void;
  onAnneal: () => void;
  onContacts: () => void;
}) {
  const [inView, setInView] = useState(true);
  // 差の欄が見えているか。初めは実際の位置で決め（一瞬遅れて出ない）、あとは IntersectionObserver で
  useLayoutEffect(() => {
    const el = document.getElementById(targetId);
    if (!el) return;
    const r = el.getBoundingClientRect();
    setInView(r.bottom > 0 && r.top < window.innerHeight);
    const io = new IntersectionObserver(([e]) => setInView(e?.isIntersecting ?? true), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [targetId]);
  // 知らせ（トースト）が避けられるよう、位置を CSS の変数（--reassign-dock-top）に出す
  const edgeRef = useFloatingEdge('reassign-dock');
  const boxRef = useRef<HTMLElement | null>(null);
  // 1行に収まらなければ、ボタンの文言を隠してアイコンだけにする（中身・画面の幅・地図の位置が変わったら測り直す）
  const [tick, setTick] = useState(0);
  useEffect(() => {
    // 自分の位置の知らせでは測り直さない（測り直しで繰り返さない）
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== 'reassign-dock') setTick((t) => t + 1);
    };
    window.addEventListener('resize', on);
    window.addEventListener(FLOATING_EVENT, on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener(FLOATING_EVENT, on);
    };
  }, []);
  const sig = JSON.stringify([unplaced, left, method, annealRecommended, annealRunning, contactCount, inView, tick]);
  const [compactFor, setCompactFor] = useState<string | null>(null);
  const compact = compactFor === sig;
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || compact) return;
    if (el.scrollWidth > el.clientWidth + 1) setCompactFor(sig);
  }, [sig, compact]);
  if (inView) return null;
  const ref = (el: HTMLElement | null) => {
    boxRef.current = el;
    edgeRef(el);
  };
  const plan = method === 'anneal' ? '案B' : '案A';
  /** 文言（compact のときは隠し、aria-label と title で読める） */
  const label = (text: string) => (compact ? null : <span>{text}</span>);
  return (
    <section
      ref={ref}
      className={`reassign-dock no-print ${compact ? 'is-compact' : ''}`}
      aria-label="欠勤の振り直し（近道）"
      data-testid="reassign-dock"
    >
      <strong className="row reassign-dock-title" style={{ gap: 4 }} title={`欠勤の振り直し（${plan}）`}>
        <UserRoundCheck size={15} aria-hidden="true" />
        <span className="ellipsis">{compact ? `振り直し（${plan}）` : `欠勤の振り直し（${plan}）`}</span>
      </strong>
      <span className={unplaced > 0 ? 'chip chip-warn' : 'chip chip-ok'}>入らない {unplaced}件</span>
      {left > 0 && (
        <span className="chip chip-red" title={`欠勤の人のまま ${left}件`}>
          {compact ? '欠勤のまま' : '欠勤の人のまま'} {left}件
        </span>
      )}
      {annealRunning ? (
        <span className="sub">{compact ? '案B…' : '案B を作っています…'}</span>
      ) : (
        annealRecommended && (
          <button
            type="button"
            className="btn btn-small"
            onClick={onAnneal}
            aria-label="少し動かしてよい案（案B）を作る"
            title="少し動かしてよい案（案B）を作る"
          >
            <Play size={14} aria-hidden="true" />
            {compact ? <span>案B</span> : <span>案B を作る</span>}
          </button>
        )
      )}
      <button
        type="button"
        className="btn btn-small"
        onClick={onContacts}
        aria-label={`連絡の一覧${contactCount > 0 ? `（${contactCount}件）` : ''}`}
        title="連絡の一覧"
      >
        <MessageSquareText size={14} aria-hidden="true" />
        {compact
          ? contactCount > 0 && <span>{contactCount}</span>
          : label(`連絡${contactCount > 0 ? `（${contactCount}件）` : ''}`)}
      </button>
      <button type="button" className="btn btn-small" onClick={onGo} aria-label="差の欄へ" title="差の欄へ">
        <ArrowUpToLine size={14} aria-hidden="true" />
        {label('差の欄へ')}
      </button>
    </section>
  );
}
