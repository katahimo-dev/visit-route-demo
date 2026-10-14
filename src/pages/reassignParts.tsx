// 欠勤の振り直しの2回目（PRD D34・D35。ADR-0011 追記）：案B「少し動かしてよい」の欄と、連絡の一覧
import { ClipboardCopy, MessageSquareText, Play, Printer, Square, X } from 'lucide-react';
import { WeightSlider } from '../components/parts';
import { Hint, SidePanel, WithIcon } from '../components/ui';
import type { Terms } from '../contracts/documents';
import type { ContactList, ContactVisit, ReassignDiff } from '../contracts/reassign';
import { copyText } from '../lib/clipboard';
import { deltaText, r0 } from '../lib/common';
import { allContactsText, type ContactWords, clientMessages, clock, staffMessage } from '../lib/contacts';
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

/**
 * 案B「少し動かしてよい」の欄（差の欄の中）：「変更を減らす」のスライダー・作る・進み具合・止める・案A と案B の比較・選ぶ。
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
  progress: { iteration: number; total: number } | null;
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
          ほかの人の訪問も少し動かして（担当・順番・時刻）、入らない訪問を入れたり移動を減らしたりする案を AI
          が作ります。元の案から変えた訪問ごとに減点し、変更が少ない案を選びます。いまの時刻より前に始まる訪問は動かしません。案A
          より悪い案にはなりません（費用と変更の減点の合計で）。点数は今までどおり点数の基準の物差しで、変更の数は下の表で別に見ます
        </Hint>
      </div>
      <div className="row anneal-weight" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="sub">変更を減らす</span>
        <WeightSlider value={weight} onChange={onWeight} label="変更を減らす" />
        <span className="sub">
          担当が変わる1件＝移動{r0(weight * 10)}分ぶん・時刻のずれ10分＝移動{r0(weight * 2 * 10) / 10}分ぶん
          {weight === STAY_WEIGHT_DEFAULT ? '（既定）' : ''}
        </span>
        <span className="sub">重みが大きいと案A のままになることがあります（変更の減点が、得より大きいとき）</span>
      </div>
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
              <th scope="col">元の案との差</th>
              {options.map((o) => (
                <th key={o.key} scope="col">
                  {o.title}
                  {o.current && <span className="chip chip-ok anneal-current">今の案</span>}
                  {o.key === 'anneal' && stopped && <span className="sub">（途中で止めた案）</span>}
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
                    {o.current ? '今の案です' : `${o.title}を今の案にする`}
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

/**
 * 連絡の一覧（右から出る欄。確定前でも見られる）：担当が変わる訪問先・時刻が変わる訪問・仕事が増える/減るスタッフと、
 * スタッフごと・訪問先ごとの連絡文（コピー）。印刷するとこの欄だけが出る。送信はしない
 */
export function ContactPanel({
  list,
  words,
  terms,
  onCopied,
  onClose,
}: {
  list: ContactList;
  words: ContactWords;
  terms: Terms;
  /** コピーしたあと（ok：できたか） */
  onCopied: (ok: boolean, what: string) => void;
  onClose: () => void;
}) {
  const clients = clientMessages(list, words);
  const empty = list.staff.length === 0 && list.staffChanged.length === 0;
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
          元の案と今の案の差から作っています（確定の前でも見られます）。連絡文はコピーするだけで、送信はしません。
        </p>
        {empty ? (
          <p>連絡が要る変更はありません。</p>
        ) : (
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
                          {x.fromStaffId ? words.staffName(x.fromStaffId) : '（なし）'} →{' '}
                          {x.toStaffId ? words.staffName(x.toStaffId) : <strong>入らない（調整中）</strong>}
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
                        <td>{x.toStaffId ? words.staffName(x.toStaffId) : ''}</td>
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
                    <strong>{words.staffName(c.staffId)}</strong>
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
                return (
                  <ContactMessage
                    key={c.staffId}
                    text={text}
                    label={`${words.staffName(c.staffId)}さんへの連絡文`}
                    onCopy={() => copy(text, `${words.staffName(c.staffId)}さんへの連絡文`)}
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

function ContactMessage({ text, label, onCopy }: { text: string; label: string; onCopy: () => void }) {
  return (
    <div className="contact-msg">
      <pre title={label}>{text}</pre>
      <button type="button" className="btn btn-small no-print" onClick={onCopy} aria-label={`${label}をコピー`}>
        <WithIcon icon={ClipboardCopy} size={14}>
          コピー
        </WithIcon>
      </button>
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
