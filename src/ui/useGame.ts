// 対戦の状態管理(engine の GameState を薄く包む)。CPU の手番は Worker で決める。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentSpec } from '../ai';
import { CARD_DB } from '../cards';
import { createGame, legalActions, step } from '../engine/engine';
import { loadRegistry } from '../engine/registry';
import { hashSeed } from '../engine/state';
import { errorMessage, type Action, type Ev, type GameConfig, type GameState, type PlayerId } from '../engine/types';
import { AiCancelled, cancelAi, chooseWithWorker } from './aiClient';
import { RECORD_VERSION, type GameRecord } from './record';
import { clearAutosave, writeAutosave, type SaveStatus } from './autosave';
import { cpuSeed, cpuWaitMs, fxHoldMs, fxScale, MIN_CPU_GAP_MS, type FxMode } from './fx';

export type { GameRecord } from './record';

export interface Seat {
  kind: 'human' | 'cpu';
  agent: AgentSpec;
}

export interface GameSetup {
  decks: [string[], string[]];
  deckNames: [string, string];
  seats: [Seat, Seat];
  first: PlayerId | 'random';
  seed: number;
  /** 同時誘発の順序を自動にする(Q17) */
  autoOrder: boolean;
  /** 1手戻す(練習用。Q18) */
  allowUndo: boolean;
  cpuDelayMs: number;
  strict: boolean;
  /** 自動保存からの再開: 先頭からこの行動列を再生した状態で始める */
  resume?: Action[];
}

export { clearAutosave, loadAutosave, type Autosave, type SaveStatus } from './autosave';

const reg = loadRegistry(CARD_DB);

export { MIN_CPU_GAP_MS };

function configOf(setup: GameSetup): Partial<GameConfig> {
  const human = (p: PlayerId) => setup.seats[p].kind === 'human';
  return {
    autoOrder: [setup.autoOrder && human(0), setup.autoOrder && human(1)],
    ackReveals: [false, false],
  };
}

export interface Session {
  state: GameState;
  log: Ev[];
  /** 直近の1手で発生したイベント(動いたカードの強調に使う) */
  last: Ev[];
  actions: Action[];
  thinking: boolean;
  error: string | null;
}

interface Snapshot {
  state: GameState;
  logLen: number;
  actionsLen: number;
}

export function makeRecord(setup: GameSetup, session: Session): GameRecord {
  return {
    version: RECORD_VERSION,
    seed: setup.seed,
    decks: setup.decks,
    deckNames: setup.deckNames,
    first: session.state.first,
    cfg: configOf(setup),
    actions: session.actions,
    seats: setup.seats,
  };
}

/**
 * @param fxMode 演出の設定(通常・高速・オフ)。CPU の手の「待ち時間」にだけ影響し、手の選択には影響しない(fx.ts)。
 */
export function useGame(setup: GameSetup, fxMode: FxMode = 'off') {
  const [session, setSession] = useState<Session>(() => {
    const g = createGame(reg, {
      decks: setup.decks,
      seed: setup.seed,
      first: setup.first,
      cfg: configOf(setup),
      strict: setup.strict,
    });
    // 再開: 保存した行動列を先頭から再生する(同じシードなので、同じ状態に戻る)
    let state = g.state;
    let log = g.events;
    const done: Action[] = [];
    let resumeError: string | null = null;
    try {
      for (const a of setup.resume ?? []) {
        const r = step(state, a, reg);
        state = r.state;
        log = log.concat(r.events);
        done.push(a);
      }
    } catch (e) {
      // 再生できなかった手の手前で止める(黙って別の局面にしない。何手目かを知らせる)
      resumeError = `保存した対戦を ${done.length + 1} 手目で再生できませんでした(${done.length} 手目までの局面から再開します): ${errorMessage(e)}`;
    }
    return { state, log, last: [], actions: done, thinking: false, error: resumeError };
  });

  // 画面を離れる・対戦をやり直す(再生成される)時は、実行中の探索を取り消す
  // (取り消された探索は、使い回さない: 始めた探索を覚えている searchRef も捨てる)
  useEffect(
    () => () => {
      cancelAi();
      searchRef.current = null;
    },
    [],
  );

  // 自動保存: 進行中は毎手保存し、勝敗が出たら消す
  const winner = session.state.winner;
  const nActions = session.actions.length;
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('ok');
  const lastSaveAt = useRef<number | null>(null);
  useEffect(() => {
    if (winner !== null) {
      clearAutosave();
      setSaveStatus('ok');
    } else if (nActions > 0) {
      const r = writeAutosave(setup, sessionRef.current.actions, lastSaveAt.current);
      lastSaveAt.current = r.at;
      setSaveStatus(r.status);
    } else if (lastSaveAt.current !== null) {
      // 最初の手まで取り消した: 取り消した手を、保存に残さない(再開で、取り消したはずの手が再生されないように)
      clearAutosave();
      lastSaveAt.current = null;
      setSaveStatus('ok');
    }
  }, [winner, nActions]);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(setup.cpuDelayMs);
  // 「一気に進める」: CPU の手の間隔を0にする(対戦中の一時的な切り替え)
  const [fast, setFast] = useState(false);
  // CPU の手が失敗した後の「もう一度考えさせる」
  const [retry, setRetry] = useState(0);
  const snapshots = useRef<Snapshot[]>([]);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // 演出の切り替えで CPU の手番の effect を作り直さない(待ち時間の計算の時点の値を読む)
  const fxRef = useRef(fxMode);
  fxRef.current = fxMode;
  const stamp = useRef(0);

  const humanSeats = ([0, 1] as PlayerId[]).filter((p) => setup.seats[p].kind === 'human');
  const me: PlayerId | null = humanSeats.length === 1 ? humanSeats[0] : null;

  const perform = useCallback(
    (a: Action) => {
      const cur = sessionRef.current;
      try {
        const r = step(cur.state, a, reg);
        // 人間の行動待ちの手前を、Undo 用に覚えておく(練習用の設定)
        if (setup.allowUndo && cur.state.pending && setup.seats[cur.state.pending.player].kind === 'human') {
          snapshots.current.push({ state: cur.state, logLen: cur.log.length, actionsLen: cur.actions.length });
          if (snapshots.current.length > 200) snapshots.current.shift();
        }
        // 情報が公開された場合や、CPU に手番が移る場合は、それ以前には戻せない
        const revealed = r.events.some((e) => ['looked', 'revealed', 'shieldBroken', 'triggerDeclared'].includes(e.type));
        const pendingPlayer = r.state.pending?.player;
        if (revealed || (pendingPlayer !== undefined && setup.seats[pendingPlayer].kind === 'cpu' && me !== null)) {
          snapshots.current = [];
        }
        stamp.current++;
        setSession({ state: r.state, log: cur.log.concat(r.events), last: r.events, actions: cur.actions.concat(a), thinking: false, error: null });
      } catch (e) {
        setSession({ ...cur, error: errorMessage(e) });
      }
    },
    [setup, me],
  );

  const undo = useCallback(() => {
    const snap = snapshots.current.pop();
    if (!snap) return;
    const cur = sessionRef.current;
    stamp.current++;
    setSession({ state: snap.state, log: cur.log.slice(0, snap.logLen), last: [], actions: cur.actions.slice(0, snap.actionsLen), thinking: false, error: null });
  }, []);

  /**
   * CPU の探索を始める(同じ局面なら、始めた探索を使い回す)。
   * 演出・手の間隔の待ち時間の間にも、探索を進めておくために、待つ前に始める(下の CPU の手番)。
   * 何を打つかは、局面とシード(cpuSeed)だけで決まるので、いつ始めても手は変わらない。
   */
  const searchRef = useRef<{ state: GameState; promise: Promise<Action> } | null>(null);
  const startSearch = useCallback(
    (cur: Session): Promise<Action> => {
      const hit = searchRef.current;
      if (hit && hit.state === cur.state) return hit.promise;
      const spec = setup.seats[cur.state.pending!.player].agent;
      const seed = cpuSeed(hashSeed(setup.seed), cur.actions.length);
      const promise = chooseWithWorker({ state: cur.state, spec, seed });
      // 失敗(取り消しを含む)した探索は、使い回さない。待たずに捨てた探索の失敗を、未処理の失敗にもしない
      promise.catch(() => {
        if (searchRef.current?.promise === promise) searchRef.current = null;
      });
      searchRef.current = { state: cur.state, promise };
      return promise;
    },
    [setup],
  );

  // CPU の手番
  const { state } = session;
  const pend = state.pending;
  const cpuTurn = !!pend && state.winner === null && setup.seats[pend.player].kind === 'cpu';
  useEffect(() => {
    if (!cpuTurn || paused) return;
    const my = ++stamp.current;
    let cancelled = false;
    setSession((s) => (s.thinking ? s : { ...s, thinking: true }));
    const run = async () => {
      // 人間と対戦する時は、CPU の連続した手を見失わないよう、最低限の間隔をあける
      // 待ち時間だけが演出の影響を受ける。何を打つかは、状態とシード(cpuSeed)だけで決まる
      const cur = sessionRef.current;
      const wait = cpuWaitMs({
        speedMs: speed,
        fast,
        vsHuman: me !== null,
        fxEnabled: fxRef.current !== 'off',
        fxHoldMs: fxRef.current !== 'off' ? fxHoldMs(cur.state, cur.last, me, fxScale(fxRef.current)) : 0,
      });
      try {
        // 待ち時間(演出・手の間隔)の間も、CPU に考えさせる。探索の時間制限はそのままで、待ちと探索が重なる分だけ早く打てる
        // (待ち → 探索 の順だと、待ち + 探索 かかっていた。重ねれば、長いほうだけ)
        const search = startSearch(cur);
        const [a] = await Promise.all([search, new Promise((r) => setTimeout(r, wait))]);
        if (cancelled || stamp.current !== my) return;
        perform(a);
      } catch (e) {
        searchRef.current = null; // 失敗した探索は使い回さない(「もう一度考えさせる」でやり直せるように)
        if (!cancelled) setSession((s) => ({ ...s, thinking: false, error: errorMessage(e) }));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [cpuTurn, paused, state, speed, fast, retry]);

  /** CPU の手が失敗した時の復帰: もう一度考えさせる */
  const retryCpu = useCallback(() => {
    setSession((s) => ({ ...s, error: null }));
    setRetry((n) => n + 1);
  }, []);

  // 「1手進める」: 一時停止中に CPU を1手だけ動かす
  const stepping = useRef(false);
  const stepOnce = useCallback(() => {
    const cur = sessionRef.current;
    if (stepping.current || !cur.state.pending || cur.state.winner !== null) return;
    if (setup.seats[cur.state.pending.player].kind !== 'cpu') return;
    stepping.current = true; // 連打で、同じ状態に対する手を2回決めない
    void (async () => {
      try {
        const a = await startSearch(cur);
        // 待っている間に状態が変わった(別の操作・再開)なら、古い状態向けの手は捨てる
        if (sessionRef.current.state === cur.state) perform(a);
      } catch (e) {
        searchRef.current = null;
        if (e instanceof AiCancelled) return; // 画面を離れて取り消された(エラーとして出さない)
        setSession((s) => ({ ...s, error: errorMessage(e) }));
      } finally {
        stepping.current = false;
      }
    })();
  }, [setup, perform, startSearch]);

  const legal = state.pending && state.winner === null ? legalActions(state, reg) : [];
  /** CPU の手が決まらない時の復帰: 合法手の先頭で進める(棋譜には通常の手として残る) */
  const forceMove = useCallback(() => {
    const cur = sessionRef.current;
    if (!cur.state.pending || cur.state.winner !== null) return;
    const a = legalActions(cur.state, reg)[0];
    if (a) perform(a);
  }, [perform]);

  return { session, saveStatus, me, legal, perform, undo, canUndo: snapshots.current.length > 0, paused, setPaused, speed, setSpeed, fast, setFast, retryCpu, forceMove, stepOnce, cpuTurn };
}

// ───────────────────────── 記録の再生 ─────────────────────────

export function replayRecord(rec: GameRecord, upTo?: number): { states: GameState[]; events: Ev[][] } {
  const g = createGame(reg, { decks: rec.decks, seed: rec.seed, first: rec.first, cfg: rec.cfg });
  const states: GameState[] = [g.state];
  const events: Ev[][] = [g.events];
  const n = upTo ?? rec.actions.length;
  let s = g.state;
  for (let i = 0; i < n && i < rec.actions.length; i++) {
    const r = step(s, rec.actions[i], reg);
    s = r.state;
    states.push(s);
    events.push(r.events);
  }
  return { states, events };
}
