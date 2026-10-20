import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { jstDate } from '../domain/time';
import { isChunkLoadError } from '../lib/chunkLoad';
import { backupFileName, backupNote, saveBlob } from '../lib/download';
import { retryFailedChunks } from '../lib/lazyComponent';
import { reloadPage } from '../lib/reloadPage';
import { backup, backupMemory } from '../store';

/**
 * 画面の例外で真っ白にしない。主ボタンは「控え（バックアップ）を書き出す」（いまのデータを JSON で残す）、
 * データが壊れていても戻れるよう「データを初期状態に戻す」を赤いボタンで後ろに出す。
 * 戻す前の確認は、Provider に頼らず ConfirmDialog をここで直に出す（React の木が壊れた後・Provider の外でも出せる。PRD D149）。
 * 分けた画面のチャンクを読めなかったときは別の表示（再読み込み・もう一度表示する。PRD D248）
 */
type State = { error: Error | null; componentStack: string; asking: boolean; backup: string | null };

export class ErrorBoundary extends Component<{ children: ReactNode; onReset: () => void }, State> {
  state: State = { error: null, componentStack: '', asking: false, backup: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 外部へは送らない（画面と開発者ツールに出すだけ。不具合の報告に貼ってもらう）
    console.error(error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? '' });
  }

  /**
   * いまのデータ（画面の最新。無ければ保存してある文字）を JSON のファイルに書き出す。壊れて退避したデータがあれば別のファイルにも。
   * 保存に失敗していたときは文で区別する（トーストは Provider の外では出せないので、結果は画面の文で知らせる）
   */
  backup = () => {
    try {
      const b = backup();
      const date = jstDate(Date.now());
      let brokenName: string | null = null;
      for (const f of b.files) {
        const name = backupFileName(date, f.kind);
        if (f.kind === 'broken') brokenName = name;
        saveBlob(new Blob([f.text], { type: 'application/json' }), name);
      }
      // いまのデータを書き出したら「最後に書き出した日」に数える（データの画面の書き出しと同じ。PRD D227）
      if (b.files.some((f) => f.kind === 'current')) backupMemory.markExported('json', date);
      this.setState({ backup: backupNote({ source: b.source, saveError: b.saveError, brokenName }) });
    } catch (e) {
      this.setState({ backup: `書き出せませんでした（${e instanceof Error ? e.message : String(e)}）` });
    }
  };

  /** もう一度表示する（分けた画面は読み直す。lib/lazyComponent が失敗した lazy を作り直す） */
  retry = () => {
    retryFailedChunks();
    this.setState({ error: null, componentStack: '', backup: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // 分けた画面のチャンクを読めなかった（新しい版の公開・通信の切れ。PRD D248）：データは壊れていないので、
    // 初期状態に戻すボタンは出さず、読み直しを勧める（自動では読み直さない。間引いている保存・入力中の欄を失わない）
    if (isChunkLoadError(error)) {
      return (
        <div className="card stack" style={{ maxWidth: 640, margin: '24px auto' }} data-testid="chunk-error">
          <h2>画面を読み込めませんでした</h2>
          <p className="sub">新しい版が公開されたか、通信が切れています。再読み込みしてください。</p>
          <pre className="error-detail">{error.message}</pre>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={reloadPage}>
              再読み込み
            </button>
            <button type="button" className="btn" onClick={this.retry}>
              もう一度表示する
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="card stack" style={{ maxWidth: 640, margin: '24px auto' }}>
        <h2>画面を表示できませんでした</h2>
        <p className="sub">データが壊れているか、まだ用意できていない機能を使っています。</p>
        <pre className="error-detail">{error.message}</pre>
        <details>
          <summary>詳しい情報（不具合の報告に貼ってください）</summary>
          <pre className="error-detail" style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>
            {[
              `版：${__APP_VERSION__}`,
              `端末：${navigator.userAgent}`,
              `時刻：${new Date().toString()}`,
              '',
              String(error.stack ?? ''),
              '',
              this.state.componentStack.trim().split('\n').slice(0, 8).join('\n'),
            ].join('\n')}
          </pre>
        </details>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={this.backup}>
            控え（バックアップ）を書き出す
          </button>
          <button type="button" className="btn" onClick={this.retry}>
            もう一度表示する
          </button>
          <button type="button" className="btn btn-danger" onClick={() => this.setState({ asking: true })}>
            データを初期状態に戻す
          </button>
        </div>
        <output className="sub">{this.state.backup ?? ''}</output>
        {this.state.asking && (
          <ConfirmDialog
            request={{
              title: 'データを初期状態に戻しますか？',
              body: 'データをデモの初期状態に戻します。いまのデータは消えます（残すときは、先に「控え（バックアップ）を書き出す」）。',
              confirmLabel: '消して初期状態に戻す',
              cancelLabel: '取り消す',
              tone: 'danger',
            }}
            onClose={(ok) => {
              if (!ok) {
                this.setState({ asking: false });
                return;
              }
              this.props.onReset();
              this.setState({ error: null, componentStack: '', asking: false, backup: null });
            }}
          />
        )}
      </div>
    );
  }
}
