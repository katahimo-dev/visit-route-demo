// データを守る知らせ（PRD D227。ADR-0032）：
// - 壊れたデータの知らせ（起動したとき、保存していたデータが読めず初期データで開いたら、閉じられる帯と「読めなかったデータを書き出す」）
// - 控えの知らせ（起動したとき1回。確定した日があり、2週間以上書き出していなければトースト。1日1回まで）
// - 別のタブの変更（読み直したらトースト。編集の欄に変更があれば「保存すると上書きします」）
// - 容量が足りず、保存のときに直前の状態の控えを捨てた（トースト）
import { Download, FileWarning, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { jstDate } from '../domain/time';
import { BACKUP_REMIND_TEXT, confirmedDayCount, shouldRemindBackup } from '../lib/backupReminder';
import { hasDirtyForm, otherTabText } from '../lib/dirtyForms';
import { saveBlob } from '../lib/download';
import { backupMemory, brokenText, useDemoData } from '../store';
import { useToast } from './Toast';
import { WithIcon } from './ui';
import './dataNotices.css';

/** 容量のために控えを捨てたときの知らせ */
export const PREVIOUS_DROPPED_TEXT = '容量が足りないため、直前の状態の控えを消しました';

/** 起動したときの控えの知らせを、開いている間に2回出さない */
let remindedThisSession = false;

/** 控えの知らせと別のタブの変更の知らせ（トースト）。画面全体で1つ置く */
export function DataWatch() {
  const { data, externalReloads, previousDrops } = useDemoData();
  const toast = useToast();
  // 起動したときに1回だけ（そのときのデータで決める）
  const first = useRef(data);
  useEffect(() => {
    if (remindedThisSession) return;
    remindedThisSession = true;
    const today = jstDate(Date.now());
    const remind = shouldRemindBackup({
      lastExport: backupMemory.lastExport()?.date ?? null,
      lastReminded: backupMemory.lastReminded(),
      today,
      confirmedDays: confirmedDayCount(first.current),
    });
    if (!remind) return;
    backupMemory.markReminded(today);
    toast(BACKUP_REMIND_TEXT);
  }, [toast]);
  // 別のタブの変更で読み直した（データの置き換えは store がする。ここは知らせだけ）
  const seen = useRef(externalReloads);
  useEffect(() => {
    if (externalReloads === seen.current) return;
    seen.current = externalReloads;
    // 編集の欄に変更があるかは、読み直したデータで欄が描き直されたあとに見る（1つ前の描画で決めない）
    const t = setTimeout(() => toast(otherTabText(hasDirtyForm())), 0);
    return () => clearTimeout(t);
  }, [externalReloads, toast]);
  // 容量が足りず、保存のときに控えを捨てた（ADR-0032）
  const drops = useRef(previousDrops);
  useEffect(() => {
    if (previousDrops === drops.current) return;
    drops.current = previousDrops;
    toast(PREVIOUS_DROPPED_TEXT);
  }, [previousDrops, toast]);
  return null;
}

/**
 * 壊れたデータの知らせ（起動したとき、保存していたデータが読めなかったら）。閉じるまで出す（保存しない）。
 * onClose：閉じたあと（フォーカスを画面の見出しへ）
 */
export function BrokenDataNotice({ onClose }: { onClose: () => void }) {
  const { broken, outdated, brokenKept, dismissBroken } = useDemoData();
  const [message, setMessage] = useState('');
  if (!broken) return null;
  const download = () => {
    const text = brokenText();
    if (text === null) {
      setMessage('書き出せる元のデータがありません（このブラウザに残っていません）');
      return;
    }
    try {
      saveBlob(new Blob([text], { type: 'application/json' }), `visit-route-demo-broken-${jstDate(Date.now())}.json`);
      setMessage('書き出しました');
    } catch (e) {
      setMessage(`書き出せませんでした（${e instanceof Error ? e.message : String(e)}）`);
    }
  };
  return (
    <section className="data-broken-notice" aria-label="読めなかったデータの知らせ" data-testid="data-broken-notice">
      <FileWarning size={18} aria-hidden="true" />
      <div className="data-broken-text">
        <p data-testid={outdated ? 'data-outdated-text' : undefined}>
          <strong>
            {outdated
              ? 'データの形が変わったので（版1 → 版2）、初期データで始めます。'
              : '保存していたデータを読めなかったため、初期データで開きました。'}
          </strong>
          {brokenKept
            ? outdated
              ? '前の形のデータはこのブラウザに残しています。控えとして書き出せます（このデモでは読み込めません）。'
              : '元のデータはこのブラウザに残しています。書き出して保管するか、詳しい人に見てもらってください。'
            : '元のデータを退避できませんでした。今すぐ書き出してください。'}
        </p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-small" onClick={download} data-testid="data-broken-download">
            <WithIcon icon={Download}>
              {outdated ? '前の形のデータを書き出す' : '読めなかったデータを書き出す'}
            </WithIcon>
          </button>
          <output className="sub" data-testid="data-broken-message">
            {message}
          </output>
        </div>
      </div>
      <button
        type="button"
        className="icon-btn"
        aria-label="読めなかったデータの知らせを閉じる"
        onClick={() => {
          dismissBroken();
          onClose();
        }}
        data-testid="data-broken-close"
      >
        <X size={18} aria-hidden="true" />
      </button>
    </section>
  );
}
