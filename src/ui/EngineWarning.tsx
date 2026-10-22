// 調査・バッチの Worker が Rust 版(WASM)を読み込めず、TS 版で動いている時の警告。
// 古い dmsim.wasm のまま新しいカードを足すと、黙って TS 版になり、約 10 倍遅く、Worker ごとに約 240MB を使って PC が重くなる。
export interface TsFallback {
  why?: string;
}

export function EngineWarning({ fallback }: { fallback: TsFallback | null }) {
  if (!fallback) return null;
  return (
    <div className="panel" style={{ borderColor: 'var(--bad)' }} role="alert">
      Rust 版エンジン(WASM)を読み込めないため、TS 版で動いています。約 10 倍遅く、CPU とメモリ(Worker ごとに約 240MB)を多く使います。
      {fallback.why ? `(理由: ${fallback.why})` : ''}
      <br />
      一度止めて、<code>npm run build:wasm</code> で Rust 版を作り直し、画面を再読み込みしてください(wasm は git に入らないので、カードやルールを取り込んだ後は作り直しが必要です)。
    </div>
  );
}
