import {
  ArchiveRestore,
  CalendarClock,
  CircleHelp,
  Database,
  Download,
  Eraser,
  FileSpreadsheet,
  RotateCcw,
  Save,
  Tags,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useConfirm } from '../components/ConfirmDialog';
import { FieldError, invalidAttrs, submitHandler } from '../components/FieldError';
import { FilePick } from '../components/FilePick';
import { Term } from '../components/Term';
import { useToast } from '../components/Toast';
import { useTour } from '../components/Tour';
import { Hint, PageHeader, SectionTitle, WithIcon } from '../components/ui';
import type { DemoData, RosterKind, RosterMode } from '../contracts/data';
import { jstDate } from '../domain/time';
import { exportAgoText, previousText } from '../lib/backupReminder';
import { attempt, formError, isStaleBuild } from '../lib/common';
import { backupFileName, saveBlob } from '../lib/download';
import { type LastDayPerson, lastDayChanged } from '../lib/personLinks';
import { sizeText, tidyMonthLabel, tidyMonthOptions, tidyOld, tidyPreview } from '../lib/tidy';
import { useFeature } from '../lib/useFeature';
import {
  backupMemory,
  canKeepPrevious,
  type ExportKind,
  exportJson,
  importJson,
  isImportError,
  type PreviousKeep,
  QUOTA_MESSAGE,
  useDemoData,
} from '../store';
import './settings.css';
import { SettingsTabs } from '../components/SettingsTabs';

/** ファイル名の日付（日本時間） */
const today = () => jstDate(Date.now());

/**
 * 置き換える確認の本文に添える、1世代の控えの文（PRD D227。残せなければ理由）。
 * 控えは確認で OK になってから残すので、ここは見込み（canKeepPrevious）
 */
const keepNote = (k: { kept: boolean; why: string | null }): string =>
  k.kept
    ? 'いまのデータは控えとして1つだけ残し、この画面の「直前の状態に戻す」で戻せます。'
    : `${k.why ?? '控えを残せません'}。`;

/** 操作のあとの知らせに添える文：見込みに反して控えを残せなかったら理由（操作は止めない） */
const keptSuffix = (k: PreviousKeep): string => (k.kept ? '' : `（${k.why ?? '控えを残せません'}）`);

/** データ：書き出し・読み込み（控えの JSON・Excel）・初期状態に戻す（D2・D3・D23） */
/** 画面を開いたあとに新しい版が公開されて、Excel の部品を読めなかったとき */
const STALE_TEXT =
  '新しい版が公開されたため、Excel の部品を読み込めませんでした。「画面を読み直す」を押してから、もう一度お試しください（データはそのままです）';

export default function DataPage() {
  const { data, update, replace, reset, saveError, keepPrevious, restorePrevious, previous } = useDemoData();
  const excelOn = useFeature('excel');
  const offboardOn = useFeature('offboard');
  const [terms, setTerms] = useState(data.org.terms);
  // 読み込み・初期化で呼び方が変わったら入力欄も合わせる
  useEffect(() => {
    setTerms(data.org.terms);
  }, [data.org.terms]);
  /** 呼び方の誤りの文の id（入力欄の aria-describedby。PRD D250） */
  const termsErrId = useId();
  // 2つが同じだと、項目の対象・Excel のシートを区別できない
  const termsSame = terms.client.trim() !== '' && terms.client.trim() === terms.staff.trim();
  const termsOk = terms.client.trim() !== '' && terms.staff.trim() !== '' && !termsSame;
  const termsChanged = terms.client.trim() !== data.org.terms.client || terms.staff.trim() !== data.org.terms.staff;
  const saveTerms = () => {
    const next = { client: terms.client.trim(), staff: terms.staff.trim() };
    update((d) => ({ ...d, org: { ...d.org, terms: next } }), '呼び方');
    toast('呼び方を変えました');
  };
  const toast = useToast();
  const confirmDialog = useConfirm();
  const openTour = useTour();
  const [error, setError] = useState<string | null>(null);
  const [excelError, setExcelError] = useState<string | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);
  /** Excel の対象（PRD D103）：全体（すべてのシート。今まで）か、〈利用者さん〉・〈スタッフ〉の名簿 */
  const [excelKind, setExcelKind] = useState<'all' | RosterKind>('all');
  /** 名簿の読み込み方（PRD D104）：追加・更新（既定）か総入れ替え */
  const [rosterMode, setRosterMode] = useState<RosterMode>('merge');
  /** 読み込みの確認のあいだに、データが別のところ（別のタブなど）で変わっていないかを見る */
  const latest = useRef(data);
  latest.current = data;
  /** 名簿を update で入れたところ（入ったかは次の描画で data を見て決める。入らなければ成功と言わない） */
  const pendingRoster = useRef<{
    base: DemoData;
    next: DemoData;
    done: string;
    lastDay: LastDayPerson[];
    keep: PreviousKeep;
  } | null>(null);
  /**
   * 名簿の読み込みで最終勤務日が入った〈スタッフ〉の知らせ（PRD D209）。名前とその人の画面へのリンクを出す。
   * 画面の中の状態で保存しない（閉じる・次の読み込み・画面を移るで消える）
   */
  const [lastDayNotice, setLastDayNotice] = useState<LastDayPerson[] | null>(null);
  /** 知らせを閉じたらフォーカスを戻す先（Excel の欄） */
  const excelCard = useRef<HTMLElement>(null);
  /** Excel の欄の見出し（欄の名前。aria-labelledby） */
  const excelTitleId = useId();
  useEffect(() => {
    const p = pendingRoster.current;
    if (!p) return;
    if (data === p.next) {
      pendingRoster.current = null;
      toast(p.done);
      if (p.lastDay.length > 0) setLastDayNotice(p.lastDay);
    } else if (data !== p.base) {
      pendingRoster.current = null;
      // 入らなかったので、残した控えは前の世代に戻す
      p.keep.cancel();
      setExcelError(
        '読み込みのあいだにデータが変わったので入れませんでした（いまのデータはそのままです）。もう一度読み込んでください',
      );
    }
  }, [data, toast]);
  const t = data.org.terms;
  const rosterTerm = excelKind === 'staff' ? t.staff : t.client;

  /** 最後に書き出した日（PRD D227。このブラウザの記録で、データには入れない） */
  const [lastExport, setLastExport] = useState(() => backupMemory.lastExport());
  const markExported = (kind: ExportKind) => {
    backupMemory.markExported(kind, today());
    setLastExport(backupMemory.lastExport());
  };

  const download = () => {
    setError(null);
    const r = attempt(() => exportJson(data));
    if (!r.value) {
      setError(`書き出せませんでした（${r.error}）`);
      return;
    }
    saveBlob(r.value, backupFileName(today()));
    markExported('json');
    toast('書き出しました');
  };

  // Excel（ADR-0006）。ExcelJS は重いので、押したときだけ読み込む
  const downloadExcel = async () => {
    setExcelError(null);
    setExcelBusy(true);
    try {
      const { exportRosterWorkbook, exportWorkbook } = await import('../excel');
      if (excelKind === 'all') {
        saveBlob(await exportWorkbook(data), `visit-route-demo-${today()}.xlsx`);
        // 全体の Excel も書き出した日に数える（名簿だけは数えない）
        markExported('excel');
        toast('Excel に書き出しました');
      } else {
        // ファイル名は英字（呼び方の文字を入れると、Chromium で保存名が「download」になったため）
        saveBlob(
          await exportRosterWorkbook(data, excelKind),
          `visit-route-demo-${excelKind === 'staff' ? 'staff' : 'clients'}-${today()}.xlsx`,
        );
        toast(`${rosterTerm}の名簿を Excel に書き出しました`);
      }
    } catch (e) {
      setExcelError(isStaleBuild(e) ? STALE_TEXT : `書き出せませんでした（${formError(e)}）`);
    } finally {
      setExcelBusy(false);
    }
  };

  const loadExcel = async (file: File) => {
    setExcelError(null);
    setLastDayNotice(null);
    try {
      setExcelBusy(true);
      // 先に読んで検査し、通ったら件数を見せて確かめる（取り消しならデータは変えない）
      if (excelKind !== 'all') {
        await loadRoster(file, excelKind);
        return;
      }
      const { importWorkbook } = await import('../excel');
      const r = await importWorkbook(await file.arrayBuffer(), data);
      if (isImportError(r)) {
        setExcelError(`読み込めませんでした（いまのデータはそのままです）\n${r.message}`);
        return;
      }
      const rt = r.org.terms;
      const counts = `${rt.staff} ${r.staff.length}人・${rt.client} ${r.clients.length}人・訪問 ${r.visits.length}件・項目 ${r.items.length}件・条件 ${r.rules.length}件`;
      const ok = await confirmDialog({
        title: `「${file.name}」でデータを置き換えますか？`,
        body: `「${file.name}」の内容（${counts}）で、いまのデータをすべて置き換えます。訪問の担当と確定（伝えた内容）も消えます。\n${keepNote(canKeepPrevious())}`,
        confirmLabel: 'すべて置き換える',
        tone: 'danger',
      });
      if (!ok) return;
      // 置き換える前に、いまのデータを1世代だけ控える（確認で OK になってから。PRD D227）
      const keep = keepPrevious('Excel 全体の読み込み');
      setLastDayNotice(null);
      replace(r);
      toast(`Excel を読み込みました${keptSuffix(keep)}`);
    } catch (e) {
      setExcelError(
        isStaleBuild(e) ? STALE_TEXT : `読み込めませんでした：${formError(e)}（いまのデータはそのままです）`,
      );
    } finally {
      setExcelBusy(false);
    }
  };

  /**
   * 名簿の読み込み（PRD D103〜D107。ADR-0020）：読んで検査し、件数（追加・更新・変更なし・終了／休止）を見せて確かめてから、
   * store の update で入れる。AI案・記録・確定した割当・訪問はそのまま
   */
  const loadRoster = async (file: File, kind: RosterKind) => {
    const base = data;
    const { importRoster, rosterSummary, rosterWarning } = await import('../excel');
    const r = await importRoster(await file.arrayBuffer(), base, kind, rosterMode);
    if ('code' in r) {
      setExcelError(`読み込めませんでした（いまのデータはそのままです）\n${r.message}`);
      return;
    }
    const term = kind === 'staff' ? base.org.terms.staff : base.org.terms.client;
    if (r.added.length === 0 && r.updated.length === 0 && r.retired.length === 0) {
      toast(`${term}の名簿に変更はありませんでした（変更なし ${r.unchanged}人）`);
      return;
    }
    const changed = () => {
      setExcelError('読み込みのあいだにデータが変わりました。もう一度読み込んでください（いまのデータはそのままです）');
    };
    // 読んでいるあいだに別のところ（別のタブなど）でデータが変わっていたら、確認を出さずに止める
    if (latest.current !== base) return changed();
    const terms = base.org.terms;
    const how = rosterMode === 'replace' ? '総入れ替え' : '追加・更新';
    const warning = rosterWarning(r, kind, terms);
    const body = [
      ...(warning ? [warning, ''] : []),
      `「${file.name}」の${term}の名簿を読み込みます（${how}）。`,
      rosterSummary(r, kind, terms),
      '訪問の担当・確定（伝えた内容）・訪問はそのままです。',
      keepNote(canKeepPrevious()),
    ].join('\n');
    const ok = await confirmDialog({
      title: `${term}の名簿を読み込みますか？（${how}）`,
      body,
      confirmLabel: '名簿を読み込む',
      // 総入れ替え（名簿にいない人を終了・休止にする）は危険の色
      tone: rosterMode === 'replace' ? 'danger' : 'primary',
    });
    if (!ok) return;
    if (latest.current !== base) return changed();
    // 名簿の読み込みも人をまとめて書き換えるので、いまのデータを1世代だけ控える（確認で OK になってから。PRD D227）
    const keep = keepPrevious(`${term}の名簿の${how}`);
    // 最終勤務日が入った人は ID も要る（知らせのリンク。PRD D209）ので、読み込む前と後を比べて引く
    const lastDay = kind === 'staff' ? lastDayChanged(base.staff, r.data.staff) : [];
    pendingRoster.current = {
      base,
      next: r.data,
      done:
        (lastDay.length > 0
          ? `${term}の名簿を読み込みました。最終勤務日の入った${terms.staff}がいます。Excel の欄に名前を出しました`
          : `${term}の名簿を読み込みました`) + keptSuffix(keep),
      lastDay,
      keep,
    };
    update((d) => (d === base ? r.data : d), '名簿の読み込み');
  };

  const load = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const r = importJson(text);
      if ('code' in r) {
        setError(`読み込めませんでした：${r.message}（いまのデータはそのままです）`);
        return;
      }
      const ok = await confirmDialog({
        title: `「${file.name}」でデータを置き換えますか？`,
        body: `「${file.name}」の内容で、いまのデータをすべて置き換えます。\n${keepNote(canKeepPrevious())}`,
        confirmLabel: 'すべて置き換える',
        tone: 'danger',
      });
      if (!ok) return;
      const keep = keepPrevious('控えの読み込み');
      // データを置き換えたら、前の名簿の知らせは消す（PRD D209）
      setLastDayNotice(null);
      replace(r);
      toast(`読み込みました${keptSuffix(keep)}`);
    } catch (e) {
      setError(`読み込めませんでした：${formError(e)}（いまのデータはそのままです）`);
    }
  };

  const doReset = async () => {
    const ok = await confirmDialog({
      title: 'データを初期状態に戻しますか？',
      body: `データをデモの初期状態に戻します。いまの変更はすべて消えます。管理者設定の機能の入り切りは、そのままです。\n${keepNote(canKeepPrevious())}`,
      confirmLabel: '消して初期状態に戻す',
      tone: 'danger',
    });
    if (!ok) return;
    // 確認で OK になってから控えを残す（確認中に閉じても控えは残らない。PRD D227）
    const keep = keepPrevious('初期状態に戻す');
    setLastDayNotice(null);
    reset();
    toast(`初期状態に戻しました${keptSuffix(keep)}`);
  };

  /** 直前の状態に戻す（PRD D227）：控えと入れ替える。確認つき */
  const doRestore = async () => {
    if (!previous) return;
    const ok = await confirmDialog({
      title: '直前の状態に戻しますか？',
      body: `${previousText(previous)}。いまのデータは控えと入れ替わり、もう一度「直前の状態に戻す」で戻せます。`,
      confirmLabel: '直前の状態に戻す',
      tone: 'danger',
    });
    if (!ok) return;
    const err = restorePrevious();
    if (err) {
      toast(err);
      return;
    }
    setLastDayNotice(null);
    toast('直前の状態に戻しました');
  };

  /** 古い訪問の片づけ（PRD D227。ADR-0032・ADR-0053）。選んだ月より前の日の保存した訪問・伝えた内容だけ消す */
  const tidyChoice = useMemo(() => tidyMonthOptions(today()), []);
  const [tidyYm, setTidyYm] = useState(tidyChoice.initial);
  const tidy = useMemo(() => tidyPreview(data, tidyYm), [data, tidyYm]);
  const tidyCard = useRef<HTMLElement>(null);
  const tidyTitleId = useId();
  const doTidy = async () => {
    if (tidy.visits + tidy.snapshots === 0) return;
    const ok = await confirmDialog({
      title: `${tidyMonthLabel(tidyYm)}の訪問の記録を消しますか？`,
      body: `${tidy.days}日分の、担当を組んだ・変えた訪問 ${tidy.visits}件と確定した内容 ${tidy.snapshots}日分を消します（${sizeText(tidy.chars)}空きます）。繰り返しの回は繰り返しのとおりに戻り（担当・取り消しは消えます）、単発の訪問は消えます。人・繰り返し・条件は消えません。消したものは戻せません（容量を空けるため、直前の状態の控えも残しません）。`,
      confirmLabel: '消す',
      tone: 'danger',
    });
    if (!ok) return;
    const ym = tidyYm;
    // 戻せない操作：全体の「元に戻す」の履歴に積まず、履歴を捨てる（前の手へ戻すと消した記録が戻り、容量が足りなくなるため。PRD D329）
    update((d) => tidyOld(d, ym), '古い記録を消す', { history: false });
    toast(`${tidyMonthLabel(ym)}の訪問の記録を消しました`);
  };

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <PageHeader
        nav={<SettingsTabs />}
        icon={Database}
        title="データ"
        lead={`データの書き出し・読み込み${excelOn ? '（Excel も）' : ''}・初期状態に戻す・使い方の案内`}
      />
      <div className="warn-box">
        <TriangleAlert size={20} strokeWidth={2.2} aria-hidden="true" />
        <p>
          データは<strong>このブラウザの中だけ</strong>に保存し、サーバーには送りません。
          実在の人の名前・住所などの個人情報は入れないでください。
        </p>
      </div>
      {saveError && (
        <div className="card stack">
          {/* 画面の上の帯（App の save-error）が読み上げるので、ここは読み上げない */}
          <FieldError live={false}>保存できませんでした：{saveError}。書き出して保管してください。</FieldError>
          {saveError === QUOTA_MESSAGE && (
            <button
              type="button"
              className="btn"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => {
                tidyCard.current?.scrollIntoView({ block: 'center' });
                tidyCard.current?.focus();
              }}
              data-testid="data-tidy-go"
            >
              <WithIcon icon={Eraser}>古い訪問を片づける</WithIcon>
            </button>
          )}
        </div>
      )}

      {/* 直前の状態に戻す（PRD D227。1世代の控えがあるときだけ） */}
      {previous && (
        <section className="card stack" aria-label="直前の状態に戻す" data-testid="data-prev-card">
          <SectionTitle icon={ArchiveRestore}>直前の状態に戻す</SectionTitle>
          <p className="data-prev-text" data-testid="data-prev-text">
            {previousText(previous)}
          </p>
          <Hint>
            データを置き換える前の状態を、このブラウザに1つだけ残しています。戻すと、いまのデータが代わりに残ります。
          </Hint>
          <button
            type="button"
            className="btn"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => void doRestore()}
            data-testid="data-prev-restore"
          >
            <WithIcon icon={ArchiveRestore}>直前の状態に戻す</WithIcon>
          </button>
        </section>
      )}

      <div className="card stack">
        <SectionTitle icon={Tags}>
          <Term k="terms" testId="term-terms" />
        </SectionTitle>
        <Hint>画面に出る呼び方です（各10文字まで）。呼び方もデータに保存され、書き出しに入ります。</Hint>
        {/* Enter で「変える」（PRD D251。押せないときは何もしない） */}
        <form
          className="row"
          style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}
          onSubmit={submitHandler(() => {
            if (termsOk && termsChanged) saveTerms();
          })}
          noValidate
        >
          <label>
            訪問する人
            <input
              value={terms.staff}
              maxLength={10}
              {...invalidAttrs(termsSame, termsErrId)}
              onChange={(e) => setTerms({ ...terms, staff: e.target.value })}
            />
          </label>
          <label>
            訪問先
            <input
              value={terms.client}
              maxLength={10}
              {...invalidAttrs(termsSame, termsErrId)}
              onChange={(e) => setTerms({ ...terms, client: e.target.value })}
            />
          </label>
          <button type="submit" className="btn" disabled={!termsOk || !termsChanged}>
            変える
          </button>
        </form>
        <FieldError id={termsErrId} live={false}>
          {termsSame && '訪問する人と訪問先に、同じ呼び方は使えません'}
        </FieldError>
      </div>

      <div className="card stack">
        <SectionTitle icon={Save}>
          <Term k="backup" testId="term-backup" />
          （JSON）
        </SectionTitle>
        <Hint>
          <ul className="hint-list">
            <li>訪問の担当や確定（伝えた内容）も含めて、データ一式を1つのファイル（JSON）にします。</li>
            <li>別の端末や人へ渡すときや、控えに使います。</li>
            <li>
              「ファイルを選ぶ」で書き出したファイルを選ぶと、いまのデータと置き換えます。置き換える前に確かめます。
            </li>
          </ul>
        </Hint>
        <button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={download}>
          <WithIcon icon={Download}>ファイルに書き出す</WithIcon>
        </button>
        <p className="sub data-last-export" data-testid="data-last-export">
          最後に書き出した日：{exportAgoText(lastExport?.date ?? null, today())}
          {lastExport?.kind === 'excel' ? '（Excel 全体）' : ''}
        </p>
        <FilePick
          caption="読み込む控え（JSON）"
          accept="application/json,.json"
          onPick={(f) => void load(f)}
          testId="backup-file"
        />
        <FieldError>{error}</FieldError>
      </div>

      {/* Excel の入出力を切っていれば欄ごと出さない（控え（JSON）は残す。ADR-0028 の excel） */}
      {excelOn && (
        <section
          className="card stack data-excel"
          ref={excelCard}
          tabIndex={-1}
          aria-labelledby={excelTitleId}
          data-testid="excel-card"
        >
          <SectionTitle icon={FileSpreadsheet}>
            <span id={excelTitleId}>Excel</span>
          </SectionTitle>
          <Hint>
            {excelKind === 'all' ? (
              <>
                {t.staff}・{t.client}
                ・項目・条件・相性・勤務時間・訪問を、シートごとの一覧（Excel）にします。Excel
                で直して読み込むと、いまのデータがその内容に置き換わります。訪問の担当と確定（伝えた内容）は消えます。
                書き方は、ブックの「使い方」のシートにあります。
              </>
            ) : (
              <>
                {`${rosterTerm}の一覧（シート1枚）だけを書き出し・読み込みます。列は全体のブックの「${rosterTerm}」シートと同じで、全体のブックも名簿として読めます。`}
                {
                  '読み込むと、ID か名前で同じ人を探して直し、いない人は足します。訪問の担当・確定（伝えた内容）・訪問は消えません。'
                }
              </>
            )}
          </Hint>
          <fieldset className="segmented" aria-label="Excel の対象" data-testid="excel-kind">
            {(
              [
                ['all', '全体'],
                ['client', `${t.client}の名簿`],
                ['staff', `${t.staff}の名簿`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={excelKind === k ? 'is-on' : undefined}
                aria-pressed={excelKind === k}
                onClick={() => {
                  // 種類を切り替えたら、前の名簿の知らせは消す（PRD D209）
                  if (k !== excelKind) setLastDayNotice(null);
                  setExcelKind(k);
                }}
              >
                {label}
              </button>
            ))}
          </fieldset>
          {excelKind !== 'all' && (
            <fieldset className="stack" style={{ gap: 6 }} data-testid="roster-mode">
              <legend>名簿の読み込み方</legend>
              <label className="check">
                <input
                  type="radio"
                  name="roster-mode"
                  checked={rosterMode === 'merge'}
                  onChange={() => setRosterMode('merge')}
                  style={{ width: 'auto' }}
                />
                追加・更新（ブックに無い人はそのまま）
              </label>
              <label className="check">
                <input
                  type="radio"
                  name="roster-mode"
                  checked={rosterMode === 'replace'}
                  onChange={() => setRosterMode('replace')}
                  style={{ width: 'auto' }}
                />
                総入れ替え（ブックに無い人を{excelKind === 'staff' ? '休止' : '段階「終了」'}にします。消しはしません）
              </label>
            </fieldset>
          )}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn" disabled={excelBusy} onClick={() => void downloadExcel()}>
              <WithIcon icon={FileSpreadsheet}>Excel に書き出す</WithIcon>
            </button>
          </div>
          <FilePick
            // 種類を切り替えたら、選んだファイルの文を消す（前の種類で選んだ名前を残さない）
            key={excelKind}
            caption={excelKind === 'all' ? '読み込む Excel（全体）' : `読み込む${rosterTerm}の名簿（Excel）`}
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={excelBusy}
            onPick={(f) => void loadExcel(f)}
            testId="excel-file"
          />
          {/* 退職・担当替えを切っていれば最終勤務日の知らせを出さない（ADR-0028 の offboard。PRD D209） */}
          {offboardOn && lastDayNotice && (
            <section className="data-notice" aria-label="最終勤務日の知らせ" data-testid="lastday-notice">
              <p className="data-notice-text">
                <CalendarClock size={16} strokeWidth={2.2} aria-hidden="true" />
                <span>
                  最終勤務日の入った{t.staff}がいます。{t.staff}の画面（名前から開く）で担当の振り直しを確かめてください
                </span>
              </p>
              <ul className="data-notice-list">
                {lastDayNotice.map((x) => (
                  <li key={x.id}>
                    <Link to={`/staff/${encodeURIComponent(x.id)}`} data-testid="lastday-link">
                      {x.name}
                    </Link>
                    （最終勤務日 {x.lastDay}）
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="btn btn-small data-notice-close"
                onClick={() => {
                  setLastDayNotice(null);
                  excelCard.current?.focus();
                }}
                aria-label="最終勤務日の知らせを閉じる"
                data-testid="lastday-close"
              >
                <WithIcon icon={X}>閉じる</WithIcon>
              </button>
            </section>
          )}
          <FieldError style={{ whiteSpace: 'pre-line' }}>{excelError}</FieldError>
          {excelError === STALE_TEXT && (
            <button
              type="button"
              className="btn"
              style={{ alignSelf: 'flex-start' }}
              // 保存は間引いているので、書き終わるのを少し待ってから読み直す
              onClick={() => setTimeout(() => location.reload(), 500)}
            >
              <WithIcon icon={RotateCcw}>画面を読み直す</WithIcon>
            </button>
          )}
        </section>
      )}

      <section
        className="card stack data-tidy"
        ref={tidyCard}
        tabIndex={-1}
        aria-labelledby={tidyTitleId}
        data-testid="data-tidy-card"
      >
        <SectionTitle icon={Eraser}>
          <span id={tidyTitleId}>古い訪問を片づける</span>
        </SectionTitle>
        <Hint>
          保存の容量が足りなくなったときに使います。選んだ月より前の日の、担当を組んだ・変えた訪問と確定した内容を消します。人・繰り返し・条件は消えません。消す前に控えを書き出してください。
        </Hint>
        <label className="data-tidy-month">
          消す範囲
          <select value={tidyYm} onChange={(e) => setTidyYm(e.target.value)} data-testid="data-tidy-month">
            {tidyChoice.options.map((ym) => (
              <option key={ym} value={ym}>
                {tidyMonthLabel(ym)}の訪問
              </option>
            ))}
          </select>
        </label>
        <p className="sub" data-testid="data-tidy-preview">
          {tidy.visits + tidy.snapshots === 0
            ? `${tidyMonthLabel(tidyYm)}に消せる訪問の記録はありません`
            : `${tidy.days}日分の訪問 ${tidy.visits}件・確定した内容 ${tidy.snapshots}日分（${sizeText(tidy.chars)}空きます）`}
        </p>
        <button
          type="button"
          className="btn"
          style={{ alignSelf: 'flex-start' }}
          disabled={tidy.visits + tidy.snapshots === 0}
          onClick={() => void doTidy()}
          data-testid="data-tidy-run"
        >
          <WithIcon icon={Eraser}>古い訪問を消す</WithIcon>
        </button>
      </section>

      <div className="card stack">
        <SectionTitle icon={CircleHelp}>使い方の案内</SectionTitle>
        <Hint>初めて開いたときの短い案内（3枚）を、もう一度見られます。</Hint>
        <button
          type="button"
          className="btn"
          style={{ alignSelf: 'flex-start' }}
          onClick={openTour}
          data-testid="tour-again"
        >
          <WithIcon icon={CircleHelp}>案内をもう一度見る</WithIcon>
        </button>
      </div>

      <div className="card stack">
        <SectionTitle icon={RotateCcw}>初期状態に戻す</SectionTitle>
        <Hint>
          デモの架空の事業所のデータに戻します。いまの変更はすべて消えます。管理者設定の機能の入り切りは、そのままです。
        </Hint>
        <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={doReset}>
          <WithIcon icon={RotateCcw}>デモの初期状態に戻す</WithIcon>
        </button>
      </div>
    </div>
  );
}
