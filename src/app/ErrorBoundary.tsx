import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * 画面の例外で真っ白にしない。データが壊れていても戻れるよう「データを初期状態に戻す」を出す
 */
export class ErrorBoundary extends Component<{ children: ReactNode; onReset: () => void }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 外部へは送らない（画面の開発者ツールに出すだけ）
    console.error(error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="card stack" style={{ maxWidth: 640, margin: '24px auto' }}>
        <h2>画面を表示できませんでした</h2>
        <p className="sub">データが壊れているか、まだ用意できていない機能を使っています。</p>
        <pre className="error-detail">{error.message}</pre>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
            もう一度表示する
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              if (!confirm('データをデモの初期状態に戻します。いまのデータは消えます。よろしいですか？')) return;
              this.props.onReset();
              this.setState({ error: null });
            }}
          >
            データを初期状態に戻す
          </button>
        </div>
      </div>
    );
  }
}
