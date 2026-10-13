// 対戦の状態管理(engine の GameState を薄く包む)。CPU の手番は Worker で決める。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentSpec } from '../ai';
import { CARD_DB } from '../cards';
import { createGame, legalActions, step } from '../engine/engine';
import { loadRegistry } from '../engine/registry';
import { hashSeed } from '../engine/state';
import type { Action, Ev, GameConfig, GameState, PlayerId } from '../engine/types';
import { chooseWithWorker } from './aiClient';

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
}

/** 試合の記録(再生・保存用。design 10) */
export interface GameRecord {
  version: 1;
  seed: number;
  decks: [string[], string[]];
  deckNames: [string, string];
  first: PlayerId;
  cfg: Partial<GameConfig>;
  actions: Action[];
  seats?: [Seat, Seat];
}

const reg = loadRegistry(CARD_DB);

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
    version: 1,
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
    return { state: g.state, log: g.events, actions: [], thinking: false, error: null };
  });
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(setup.cpuDelayMs);
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
        setSession({ state: r.state, log: cur.log.concat(r.events), actions: cur.actions.concat(a), thinking: false, error: null });
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
    setSession({ state: snap.state, log: cur.log.slice(0, snap.logLen), actions: cur.actions.slice(0, snap.actionsLen), thinking: false, error: null });
  }, []);

  // CPU の手番
  const { state } = session;
  const pend = state.pending;
  const cpuTurn = !!pend && state.winner === null && setup.seats[pend.player].kind === 'cpu';
  const [stepToken, setStepToken] = useState(0);
  useEffect(() => {
    if (!cpuTurn || paused) return;
    const my = ++stamp.current;
    let cancelled = false;
    setSession((s) => (s.thinking ? s : { ...s, thinking: true }));
    const run = async () => {
      await new Promise((r) => setTimeout(r, speed));
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
  }, [cpuTurn, paused, state, stepToken, speed]);

  // 「1手進める」: 一時停止中に CPU を1手だけ動かす
  const stepOnce = useCallback(() => {
    const cur = sessionRef.current;
    if (!cur.state.pending || cur.state.winner !== null) return;
    void (async () => {
      const spec = setup.seats[cur.state.pending!.player].agent;
      if (setup.seats[cur.state.pending!.player].kind !== 'cpu') return;
      const seed = hashSeed(setup.seed) ^ (cur.actions.length * 2654435761);
      const a = await chooseWithWorker({ state: cur.state, spec, seed });
      perform(a);
    })();
    setStepToken((t) => t + 0);
  }, [setup, perform]);

  const legal = state.pending && state.winner === null ? legalActions(state, reg) : [];
  return { session, me, legal, perform, undo, canUndo: snapshots.current.length > 0, paused, setPaused, speed, setSpeed, stepOnce, cpuTurn };
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
