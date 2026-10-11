import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * 画面の例外で真っ白にしない。データが壊れていても戻れるよう「データを初期状態に戻す」を出す
 */
type State = { error: Error | null; componentStack: string };

export class ErrorBoundary extends Component<{ children: ReactNode; onReset: () => void }, State> {
  state: State = { error: null, componentStack: '' };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 外部へは送らない（画面と開発者ツールに出すだけ。不具合の報告に貼ってもらう）
    console.error(error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? '' });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
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
          <button type="button" className="btn" onClick={() => this.setState({ error: null, componentStack: '' })}>
            もう一度表示する
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              if (!confirm('データをデモの初期状態に戻します。いまのデータは消えます。よろしいですか？')) return;
              this.props.onReset();
              this.setState({ error: null, componentStack: '' });
            }}
          >
            データを初期状態に戻す
          </button>
        </div>
      </div>
    );
  }
}
