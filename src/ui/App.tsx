import { useState } from 'react';
import { BatchView } from './BatchView';
import { DeckEditor } from './DeckEditor';
import { GameView } from './GameView';
import { ReplayScreen } from './ReplayScreen';
import { SetupScreen } from './SetupScreen';
import { SimView } from './SimView';
import type { GameSetup } from './useGame';

export type Screen = 'menu' | 'play-setup' | 'watch-setup' | 'game' | 'sim' | 'batch' | 'replay' | 'decks';

export function App() {
  const [screen, setScreen] = useState<Screen>('menu');
  const [setup, setSetup] = useState<GameSetup | null>(null);
  const [gameKey, setGameKey] = useState(0);

  const home = () => setScreen('menu');
  const start = (s: GameSetup) => {
    setSetup(s);
    setGameKey((k) => k + 1);
    setScreen('game');
  };

  return (
    <div className="app">
      <div className="topbar">
        <span className="brand">DM_SIM</span>
        <span className="muted">デュエル・マスターズ シミュレータ</span>
        <span className="spacer" />
        {screen !== 'menu' && screen !== 'game' && <button onClick={home}>メニュー</button>}
      </div>
      {screen === 'menu' && <Menu go={setScreen} />}
      {screen === 'play-setup' && (
        <div className="page">
          <SetupScreen mode="play" onBack={home} onStart={start} />
        </div>
      )}
      {screen === 'watch-setup' && (
        <div className="page">
          <SetupScreen mode="watch" onBack={home} onStart={start} />
        </div>
      )}
      {screen === 'game' && setup && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <GameView
            key={gameKey}
            setup={setup}
            onExit={home}
            onRematch={() => {
              setSetup({ ...setup, seed: Math.floor(Math.random() * 1e9) });
              setGameKey((k) => k + 1);
            }}
          />
        </div>
      )}
      {screen === 'sim' && <SimView />}
      {screen === 'batch' && <BatchView />}
      {screen === 'replay' && <ReplayScreen />}
      {screen === 'decks' && <DeckEditor />}
    </div>
  );
}

function Menu({ go }: { go: (s: Screen) => void }) {
  return (
    <div className="page">
      <div className="menu">
        <h2>メニュー</h2>
        <div className="menu-grid">
          <button className="tile" onClick={() => go('play-setup')}>
            <h3>CPUと対戦</h3>
            <p>人間 vs CPU。カードをドラッグ&ドロップ(またはクリック)で遊べます。</p>
          </button>
          <button className="tile" onClick={() => go('watch-setup')}>
            <h3>CPU同士を観戦</h3>
            <p>速度調整・一時停止・1手ずつ進める。</p>
          </button>
          <button className="tile" onClick={() => go('sim')}>
            <h3>確率シミュレータ</h3>
            <p>「4ターン目にコスト7を使う確率」や、そのための使用履歴(パターン)を調べます。</p>
          </button>
          <button className="tile" onClick={() => go('batch')}>
            <h3>バッチ対戦</h3>
            <p>AI同士の数百〜数千試合で、デッキの勝率やカードの強さを測ります。</p>
          </button>
          <button className="tile" onClick={() => go('replay')}>
            <h3>棋譜の再生</h3>
            <p>保存した試合を、シード・行動列から再現して確認します。</p>
          </button>
          <button className="tile" onClick={() => go('decks')}>
            <h3>デッキ編集</h3>
            <p>デッキの作成・保存・JSONの入出力。</p>
          </button>
        </div>
      </div>
    </div>
  );
}
