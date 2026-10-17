import { lazy, Suspense, useEffect, useState } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { GameView } from './GameView';
import { SetupScreen } from './SetupScreen';
import { clearAutosave, isRecentOtherTab, loadAutosave } from './autosave';
import type { GameSetup } from './useGame';

// 対戦以外の画面は、開いた時に読み込む(起動時のコードを小さくする)
const BatchView = lazy(() => import('./BatchView').then((m) => ({ default: m.BatchView })));
const DeckEditor = lazy(() => import('./DeckEditor').then((m) => ({ default: m.DeckEditor })));
const ManualView = lazy(() => import('./ManualView').then((m) => ({ default: m.ManualView })));
const ReplayScreen = lazy(() => import('./ReplayScreen').then((m) => ({ default: m.ReplayScreen })));
const SimView = lazy(() => import('./SimView').then((m) => ({ default: m.SimView })));

export type Screen = 'menu' | 'play-setup' | 'watch-setup' | 'game' | 'sim' | 'batch' | 'replay' | 'decks' | 'manual';

const SCREENS: Screen[] = ['menu', 'play-setup', 'watch-setup', 'game', 'sim', 'batch', 'replay', 'decks', 'manual'];

/** URL の # から画面を決める。対戦中の状態は URL にないので、対戦は復元しない */
function screenFromHash(): Screen {
  const h = location.hash.replace(/^#\/?/, '') as Screen;
  return SCREENS.includes(h) && h !== 'game' ? h : 'menu';
}

export function App() {
  const [screen, setScreenState] = useState<Screen>(screenFromHash);
  // 画面の移動を履歴に積み、ブラウザの「戻る」でアプリから離れないようにする
  const setScreen = (s: Screen) => {
    setScreenState(s);
    if (location.hash !== `#/${s}`) history.pushState(null, '', `#/${s}`);
  };
  useEffect(() => {
    const onPop = () => setScreenState((cur) => (cur === 'game' ? 'menu' : screenFromHash()));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [setup, setSetup] = useState<GameSetup | null>(null);
  const [gameKey, setGameKey] = useState(0);
  // 対戦の途中でメニューに戻った(自動保存から再開できることを、メニューで伝える)
  const [leftGame, setLeftGame] = useState(false);

  const home = () => setScreen('menu');
  const start = (s: GameSetup) => {
    setSetup(s);
    setGameKey((k) => k + 1);
    setLeftGame(false);
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
      <ErrorBoundary key={screen + gameKey} onReset={home}>
      <Suspense fallback={<div className="page"><p className="muted" role="status">読み込み中…</p></div>}>
      {screen === 'menu' && <Menu go={setScreen} leftGame={leftGame} onResume={(a) => start({ ...a.setup, resume: a.actions })} />}
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
            onExit={() => {
              setLeftGame(true);
              home();
            }}
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
      {screen === 'manual' && <ManualView />}
      </Suspense>
      </ErrorBoundary>
    </div>
  );
}

function Menu({ go, leftGame, onResume }: { go: (s: Screen) => void; leftGame: boolean; onResume: (a: NonNullable<ReturnType<typeof loadAutosave>>) => void }) {
  const [saved, setSaved] = useState(loadAutosave);
  return (
    <div className="page">
      <div className="menu">
        <h2>メニュー</h2>
        {saved && leftGame && (
          <p className="panel" role="status">
            対戦を中断しました。1手ごとに自動保存されているので、下の「続きから遊ぶ」で、この続きから再開できます。
          </p>
        )}
        <div className="menu-grid">
          {saved && (
            <div className="tile resume">
              <h3>対戦を再開</h3>
              <p className="muted">対戦は1手ごとに自動保存されます(勝敗が出ると消えます)。</p>
              <p>
                {saved.setup.deckNames[0]} vs {saved.setup.deckNames[1]}({saved.actions.length}手目まで・{new Date(saved.at).toLocaleString()})
              </p>
              {isRecentOtherTab(saved) && (
                <p className="muted" role="status">
                  別のタブで進行中の対戦かもしれません。続きから遊ぶと、そのタブの自動保存を上書きします。
                </p>
              )}
              <div className="row">
                <button className="primary" onClick={() => onResume(saved)}>
                  続きから遊ぶ
                </button>
                <button
                  onClick={() => {
                    clearAutosave();
                    setSaved(null);
                  }}
                >
                  破棄
                </button>
              </div>
            </div>
          )}
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
          <button className="tile" onClick={() => go('manual')}>
            <h3>一人回し(手動)</h3>
            <p>カードを自由に動かして回す練習用。効果は自分で処理します。</p>
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
