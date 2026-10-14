// 対戦の状態管理(engine の GameState を薄く包む)。CPU の手番は Worker で決める。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentSpec } from '../ai';
import { CARD_DB } from '../cards';
import { createGame, legalActions, step } from '../engine/engine';
import { loadRegistry } from '../engine/registry';
import { hashSeed } from '../engine/state';
import type { Action, Ev, GameConfig, GameState, PlayerId } from '../engine/types';
import { AiCancelled, cancelAi, chooseWithWorker } from './aiClient';
import { RECORD_VERSION, type GameRecord } from './record';
import { loadJson, saveJson } from './util';

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

const AUTOSAVE_KEY = 'dmsim.autosave';

export interface Autosave {
  /** 保存した時のエンジンの版(RECORD_VERSION)。合わない保存は、再生しても同じ局面にならない */
  version: number;
  setup: GameSetup;
  actions: Action[];
  at: number;
}

/** 進行中の対戦(保存されていない・版が合わない・形が壊れている時は null。合わないものは消す) */
export function loadAutosave(): Autosave | null {
  const a = loadJson<Autosave | null>(AUTOSAVE_KEY, null);
  if (!a) return null;
  if (a.version !== RECORD_VERSION) {
    clearAutosave();
    return null;
  }
  return Array.isArray(a.actions) && a.actions.length > 0 && a.setup?.decks ? a : null;
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    // 保存できない環境では何もしない
  }
}

const reg = loadRegistry(CARD_DB);

/** 人間と対戦する時の、CPU の手の最低間隔(ms) */
export const MIN_CPU_GAP_MS = 300;

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

export function useGame(setup: GameSetup) {
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
    } catch (e: any) {
      // 再生できなかった手の手前で止める(黙って別の局面にしない。何手目かを知らせる)
      resumeError = `保存した対戦を ${done.length + 1} 手目で再生できませんでした(${done.length} 手目までの局面から再開します): ${String(e?.message ?? e)}`;
    }
    return { state, log, last: [], actions: done, thinking: false, error: resumeError };
  });

  // 画面を離れる・対戦をやり直す(再生成される)時は、実行中の探索を取り消す
  useEffect(() => () => cancelAi(), []);

  // 自動保存: 進行中は毎手保存し、勝敗が出たら消す
  const winner = session.state.winner;
  const nActions = session.actions.length;
  useEffect(() => {
    if (winner !== null) clearAutosave();
    else if (nActions > 0) saveJson(AUTOSAVE_KEY, { version: RECORD_VERSION, setup: { ...setup, resume: undefined }, actions: sessionRef.current.actions, at: Date.now() } satisfies Autosave);
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
      } catch (e: any) {
        setSession({ ...cur, error: String(e?.message ?? e) });
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
      const wait = fast ? 0 : me !== null ? Math.max(speed, MIN_CPU_GAP_MS) : speed;
      await new Promise((r) => setTimeout(r, wait));
      if (cancelled) return;
      try {
        const spec = setup.seats[pend!.player].agent;
        const seed = hashSeed(setup.seed) ^ (sessionRef.current.actions.length * 2654435761);
        const a = await chooseWithWorker({ state: sessionRef.current.state, spec, seed });
        if (cancelled || stamp.current !== my) return;
        perform(a);
      } catch (e: any) {
        if (!cancelled) setSession((s) => ({ ...s, thinking: false, error: String(e?.message ?? e) }));
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
        const spec = setup.seats[cur.state.pending!.player].agent;
        const seed = hashSeed(setup.seed) ^ (cur.actions.length * 2654435761);
        const a = await chooseWithWorker({ state: cur.state, spec, seed });
        // 待っている間に状態が変わった(別の操作・再開)なら、古い状態向けの手は捨てる
        if (sessionRef.current.state === cur.state) perform(a);
      } catch (e: any) {
        if (e instanceof AiCancelled) return; // 画面を離れて取り消された(エラーとして出さない)
        setSession((s) => ({ ...s, error: String(e?.message ?? e) }));
      } finally {
        stepping.current = false;
      }
    })();
  }, [setup, perform]);

  const legal = state.pending && state.winner === null ? legalActions(state, reg) : [];
  /** CPU の手が決まらない時の復帰: 合法手の先頭で進める(棋譜には通常の手として残る) */
  const forceMove = useCallback(() => {
    const cur = sessionRef.current;
    if (!cur.state.pending || cur.state.winner !== null) return;
    const a = legalActions(cur.state, reg)[0];
    if (a) perform(a);
  }, [perform]);

  return { session, me, legal, perform, undo, canUndo: snapshots.current.length > 0, paused, setPaused, speed, setSpeed, fast, setFast, retryCpu, forceMove, stepOnce, cpuTurn };
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
