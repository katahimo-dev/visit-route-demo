import { Database, Download, RotateCcw, Tags, TriangleAlert, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useToast } from '../components/Toast';
import { Hint, PageHeader, SectionTitle, WithIcon } from '../components/ui';
import { attempt, formError } from '../lib/common';
import { exportJson, importJson, useDemoData } from '../store';
import './settings.css';

/** データ：書き出し・読み込み・初期状態に戻す（D2・D3） */
export default function DataPage() {
  const { data, update, replace, reset, saveError } = useDemoData();
  const [terms, setTerms] = useState(data.org.terms);
  // 読み込み・初期化で呼び方が変わったら入力欄も合わせる
  useEffect(() => {
    setTerms(data.org.terms);
  }, [data.org.terms]);
  const termsOk = terms.client.trim() !== '' && terms.staff.trim() !== '';
  const termsChanged = terms.client.trim() !== data.org.terms.client || terms.staff.trim() !== data.org.terms.staff;
  const saveTerms = () => {
    const next = { client: terms.client.trim(), staff: terms.staff.trim() };
    update((d) => ({ ...d, org: { ...d.org, terms: next } }));
    toast('呼び方を変えました');
  };
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const download = () => {
    setError(null);
    const r = attempt(() => exportJson(data));
    if (!r.value) {
      setError(`書き出せませんでした（${r.error}）`);
      return;
    }
    const url = URL.createObjectURL(r.value);
    const a = document.createElement('a');
    a.href = url;
    a.download = `visit-route-demo-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('書き出しました');
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
      <PageHeader icon={Database} title="データ" lead="書き出し・読み込み・初期状態に戻す" />
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
      </div>

      <div className="card stack">
        <SectionTitle icon={Download}>書き出す</SectionTitle>
        <Hint>データ一式を1つのファイル（JSON）にします。別の端末・人へ渡すときや、控えに使います。</Hint>
        <button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={download}>
          <WithIcon icon={Download}>ファイルに書き出す</WithIcon>
        </button>
      </div>

      <div className="card stack">
        <SectionTitle icon={Upload}>読み込む</SectionTitle>
        <Hint>書き出したファイルを読み込み、いまのデータと置き換えます（置き換える前に確認します）。</Hint>
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
        <SectionTitle icon={RotateCcw}>初期状態に戻す</SectionTitle>
        <Hint>デモの架空の事業所のデータに戻します。いまの変更はすべて消えます。</Hint>
        <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={doReset}>
          <WithIcon icon={RotateCcw}>デモの初期状態に戻す</WithIcon>
        </button>
      </div>
    </div>
  );
}
