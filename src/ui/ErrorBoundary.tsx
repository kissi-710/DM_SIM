// 描画中の例外で画面全体が真っ白にならないようにする。対戦の進行は自動保存から再開できる。
import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onReset: () => void;
}

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="page">
        <div className="panel col" role="alert">
          <h2>画面の表示中にエラーが起きました</h2>
          <p className="muted">対戦中だった場合は、メニューの「対戦を再開」から続きを遊べます。</p>
          <pre className="json">{String(error.message ?? error)}</pre>
          <div className="row">
            <button
              className="primary"
              onClick={() => {
                this.setState({ error: null });
                this.props.onReset();
              }}
            >
              メニューへ
            </button>
            <button onClick={() => location.reload()}>再読み込み</button>
          </div>
        </div>
      </div>
    );
  }
}
