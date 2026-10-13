import { Database, Download, FileSpreadsheet, RotateCcw, Save, Tags, TriangleAlert, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useToast } from '../components/Toast';
import { Hint, PageHeader, SectionTitle, WithIcon } from '../components/ui';
import { jstDate } from '../domain/time';
import { attempt, formError } from '../lib/common';
import { exportJson, importJson, isImportError, useDemoData } from '../store';
import './settings.css';

/** ファイル名の日付（日本時間） */
const today = () => jstDate(Date.now());

/** Blob をファイルとして保存させる */
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** データ：書き出し・読み込み（控えの JSON・Excel）・初期状態に戻す（D2・D3・D23） */
export default function DataPage() {
  const { data, update, replace, reset, saveError } = useDemoData();
  const [terms, setTerms] = useState(data.org.terms);
  // 読み込み・初期化で呼び方が変わったら入力欄も合わせる
  useEffect(() => {
    setTerms(data.org.terms);
  }, [data.org.terms]);
  // 2つが同じだと、項目の対象・Excel のシートを区別できない
  const termsSame = terms.client.trim() !== '' && terms.client.trim() === terms.staff.trim();
  const termsOk = terms.client.trim() !== '' && terms.staff.trim() !== '' && !termsSame;
  const termsChanged = terms.client.trim() !== data.org.terms.client || terms.staff.trim() !== data.org.terms.staff;
  const saveTerms = () => {
    const next = { client: terms.client.trim(), staff: terms.staff.trim() };
    update((d) => ({ ...d, org: { ...d.org, terms: next } }));
    toast('呼び方を変えました');
  };
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const excelRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [excelError, setExcelError] = useState<string | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);

  const download = () => {
    setError(null);
    const r = attempt(() => exportJson(data));
    if (!r.value) {
      setError(`書き出せませんでした（${r.error}）`);
      return;
    }
    saveBlob(r.value, `visit-route-demo-${today()}.json`);
    toast('書き出しました');
  };

  // Excel（ADR-0006）。ExcelJS は重いので、押したときだけ読み込む
  const downloadExcel = async () => {
    setExcelError(null);
    setExcelBusy(true);
    try {
      const { exportWorkbook } = await import('../excel');
      saveBlob(await exportWorkbook(data), `visit-route-demo-${today()}.xlsx`);
      toast('Excel に書き出しました');
    } catch (e) {
      setExcelError(`書き出せませんでした（${formError(e)}）`);
    } finally {
      setExcelBusy(false);
    }
  };

  const loadExcel = async (file: File) => {
    setExcelError(null);
    try {
      setExcelBusy(true);
      // 先に読んで検査し、通ったら件数を見せて確かめる（取り消しならデータは変えない）
      const { importWorkbook } = await import('../excel');
      const r = await importWorkbook(await file.arrayBuffer(), data);
      if (isImportError(r)) {
        setExcelError(`読み込めませんでした（いまのデータはそのままです）\n${r.message}`);
        return;
      }
      const t = r.org.terms;
      const counts = `${t.staff} ${r.staff.length}人・${t.client} ${r.clients.length}人・訪問 ${r.visits.length}件・項目 ${r.items.length}件・条件 ${r.rules.length}件`;
      if (
        !confirm(
          `「${file.name}」の内容（${counts}）で、いまのデータをすべて置き換えます。AI案・記録・確定した割当は消えます。よろしいですか？`,
        )
      )
        return;
      replace(r);
      toast('Excel を読み込みました');
    } catch (e) {
      setExcelError(`読み込めませんでした：${formError(e)}（いまのデータはそのままです）`);
    } finally {
      setExcelBusy(false);
      if (excelRef.current) excelRef.current.value = '';
    }
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
      if (!confirm(`「${file.name}」の内容で、いまのデータをすべて置き換えます。よろしいですか？`)) return;
      replace(r);
      toast('読み込みました');
    } catch (e) {
      setError(`読み込めませんでした：${formError(e)}（いまのデータはそのままです）`);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const doReset = () => {
    if (!confirm('データをデモの初期状態に戻します。いまの変更はすべて消えます。よろしいですか？')) return;
    reset();
    toast('初期状態に戻しました');
  };

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <PageHeader icon={Database} title="データ" lead="書き出し・読み込み（控え・Excel）・初期状態に戻す" />
      <div className="warn-box">
        <TriangleAlert size={20} strokeWidth={2.2} aria-hidden="true" />
        <p>
          データは<strong>このブラウザの中だけ</strong>に保存し、サーバーには送りません。
          実在の人の名前・住所などの個人情報は入れないでください。
        </p>
      </div>
      {saveError && (
        <div className="card">
          <p className="error">保存できませんでした：{saveError}。書き出して保管してください。</p>
        </div>
      )}

      <div className="card stack">
        <SectionTitle icon={Tags}>呼び方</SectionTitle>
        <Hint>画面に出る呼び方です（各10文字まで）。呼び方もデータに保存され、書き出しに入ります。</Hint>
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label>
            訪問する人
            <input value={terms.staff} maxLength={10} onChange={(e) => setTerms({ ...terms, staff: e.target.value })} />
          </label>
          <label>
            訪問先
            <input
              value={terms.client}
              maxLength={10}
              onChange={(e) => setTerms({ ...terms, client: e.target.value })}
            />
          </label>
          <button type="button" className="btn" disabled={!termsOk || !termsChanged} onClick={saveTerms}>
            変える
          </button>
        </div>
        {termsSame && <p className="error">訪問する人と訪問先に、同じ呼び方は使えません</p>}
      </div>

      <div className="card stack">
        <SectionTitle icon={Save}>控え（JSON）</SectionTitle>
        <Hint>
          データ一式（AI案・記録・確定した割当も）を1つのファイル（JSON）にします。別の端末・人へ渡すときや、控えに使います。
          下の欄で書き出したファイルを選ぶと、いまのデータと置き換えます（置き換える前に確認します）。
        </Hint>
        <button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={download}>
          <WithIcon icon={Download}>ファイルに書き出す</WithIcon>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          aria-label="読み込むファイル"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void load(f);
          }}
        />
        {error && <p className="error">{error}</p>}
      </div>

      <div className="card stack">
        <SectionTitle icon={FileSpreadsheet}>Excel</SectionTitle>
        <Hint>
          {data.org.terms.staff}・{data.org.terms.client}
          ・項目・条件・相性・稼働時間・訪問を、シートごとの一覧（Excel）にします。 Excel
          で行を足す・直す・消すしてから読み込むと、いまのデータがその内容に置き換わります（AI案・記録・確定した割当は消えます）。
          書き方はブックの「使い方」のシートにあります。
        </Hint>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn" disabled={excelBusy} onClick={() => void downloadExcel()}>
            <WithIcon icon={FileSpreadsheet}>Excel に書き出す</WithIcon>
          </button>
          <button type="button" className="btn" disabled={excelBusy} onClick={() => excelRef.current?.click()}>
            <WithIcon icon={Upload}>Excel を読み込む</WithIcon>
          </button>
        </div>
        <input
          ref={excelRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          aria-label="読み込む Excel のファイル"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadExcel(f);
          }}
        />
        {excelError && (
          <p className="error" style={{ whiteSpace: 'pre-line' }}>
            {excelError}
          </p>
        )}
      </div>

      <div className="card stack">
        <SectionTitle icon={RotateCcw}>初期状態に戻す</SectionTitle>
        <Hint>デモの架空の事業所のデータに戻します。いまの変更はすべて消えます。</Hint>
        <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={doReset}>
          <WithIcon icon={RotateCcw}>デモの初期状態に戻す</WithIcon>
        </button>
      </div>
    </div>
  );
}
