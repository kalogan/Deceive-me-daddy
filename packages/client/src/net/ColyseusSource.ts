// The LIVE StateSource (slice 1.3, PROJECT_BRIEF §3/§4.2). Connects the client to the
// authoritative Colyseus `MatchRoom` over the wire and renders SERVER-AUTHORITATIVE state.
//
// Authority (PROJECT_BRIEF §4.2): the wire state is TRUTH. This source never simulates —
// it forwards the local player's PlayerInput as a REQUEST (`room.send('input', input)`)
// and renders whatever `room.state` the server broadcasts. Local prediction stays in the
// renderer (cosmetic only). The server keys players by `client.sessionId`; the room we
// joined exposes our own sessionId, so localPlayerId = room.sessionId.
//
// Production-truthful (PROJECT_BRIEF §4.5): the reflected @colyseus/schema state is mapped
// into the REAL shared NetMatchState via `toNetMatchState` — no forked client-side shape.
import { Client, type Room } from 'colyseus.js';
import type {
  AgentPhase,
  ClearanceTier,
  MatchPhase,
  NetMatchState,
  NetNpcState,
  NetPlayerState,
  PlayerInput,
} from '@deceive/shared';
import type { StateSource } from './StateSource';

/** The server room name (packages/server/src/main.ts registers `'match'`). */
export const MATCH_ROOM_NAME = 'match';

/** The snapshot rendered before the first `onStateChange` arrives (renderer-safe). */
const EMPTY_STATE: NetMatchState = { tick: 0, timeMs: 0, phase: 'lobby', players: {}, npcs: {} };

/**
 * A single player as reflected by colyseus.js off the server's PlayerSchema. Every field
 * is optional/loose because we map from an untrusted, partially-populated reflection (a
 * just-joined player may exist before its first authoritative sync). Defaults below keep
 * the renderer fed with a valid NetPlayerState.
 */
export interface RawPlayer {
  id?: string;
  team?: number;
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  disguiseTier?: ClearanceTier;
  suspicion?: number;
  phase?: AgentPhase;
}

/** A crowd NPC as reflected by colyseus.js off the server's NpcSchema. */
export interface RawNpc {
  id?: string;
  tier?: ClearanceTier;
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
}

/**
 * The reflected match state shape. `players`/`npcs` are anything ITERABLE of their raw
 * type — a colyseus.js MapSchema (iterable of its values), a plain array, or any iterable
 * — so the mapping is testable without a socket.
 */
export interface RawMatchState {
  tick?: number;
  timeMs?: number;
  phase?: MatchPhase;
  players?: Iterable<RawPlayer> | null;
  npcs?: Iterable<RawNpc> | null;
}

/**
 * PURE mapping: reflected schema -> the REAL shared NetMatchState. Unit-testable without a
 * socket (see ColyseusSource.test.ts). Tolerates sparse/empty input so a pre-spawn join or
 * a degenerate broadcast still yields a valid, renderable snapshot.
 */
export function toNetMatchState(raw: RawMatchState | null | undefined): NetMatchState {
  if (!raw) return { tick: 0, timeMs: 0, phase: 'lobby', players: {}, npcs: {} };

  const players: Record<string, NetPlayerState> = {};
  if (raw.players) {
    for (const p of raw.players) {
      const id = p.id ?? '';
      if (!id) continue; // skip un-keyed/partial entries; the server always sets id.
      players[id] = {
        id,
        team: p.team ?? 0,
        x: p.x ?? 0,
        y: p.y ?? 0,
        z: p.z ?? 0,
        yaw: p.yaw ?? 0,
        disguiseTier: p.disguiseTier ?? 'civilian',
        suspicion: p.suspicion ?? 0,
        phase: p.phase ?? 'blended',
      };
    }
  }

  const npcs: Record<string, NetNpcState> = {};
  if (raw.npcs) {
    for (const n of raw.npcs) {
      const id = n.id ?? '';
      if (!id) continue;
      npcs[id] = {
        id,
        tier: n.tier ?? 'civilian',
        x: n.x ?? 0,
        y: n.y ?? 0,
        z: n.z ?? 0,
        yaw: n.yaw ?? 0,
      };
    }
  }

  return {
    tick: raw.tick ?? 0,
    timeMs: raw.timeMs ?? 0,
    phase: raw.phase ?? 'lobby',
    players,
    npcs,
  };
}

/**
 * The reflected room.state. colyseus.js gives a MapSchema for `players`, which is iterable
 * over its values — exactly what `toNetMatchState` consumes. We narrow to `RawMatchState`
 * for the mapping; the runtime object is the live MapSchema-backed state.
 */
type Container<T> = { values(): Iterable<T> } | Iterable<T> | null | undefined;

type ReflectedState = Omit<RawMatchState, 'players' | 'npcs'> & {
  players?: Container<RawPlayer>;
  npcs?: Container<RawNpc>;
};

/** Normalise a reflected MapSchema/iterable container into a plain iterable. */
function mapIterable<T>(c: Container<T>): Iterable<T> | null {
  if (!c) return null;
  // MapSchema exposes `.values()`; arrays/iterables are used directly.
  if (typeof (c as { values?: unknown }).values === 'function') {
    return (c as { values(): Iterable<T> }).values();
  }
  return c as Iterable<T>;
}

export class ColyseusSource implements StateSource {
  /** Assigned post-connect from room.sessionId. Empty until connect() resolves. */
  localPlayerId = '';

  private room: Room<ReflectedState> | null = null;
  private latest: NetMatchState = EMPTY_STATE;
  /** True once the connection has dropped/errored, so main.ts can fall back/react. */
  private dead = false;

  constructor(private readonly endpoint: string) {}

  /**
   * Open the websocket, join (or create) the authoritative `match` room, and start
   * tracking the broadcast state. Rejects on any connection/join failure so main.ts can
   * fall back to LocalMockSource.
   */
  async connect(): Promise<void> {
    const client = new Client(this.endpoint);
    const room = await client.joinOrCreate<ReflectedState>(MATCH_ROOM_NAME);
    this.room = room;
    // The server keys players by sessionId; our own id is the joined room's sessionId.
    this.localPlayerId = room.sessionId;

    // Keep a freshly-mapped snapshot on every authoritative broadcast.
    room.onStateChange((state) => {
      this.latest = toNetMatchState({
        tick: state.tick,
        timeMs: state.timeMs,
        phase: state.phase,
        players: mapIterable(state.players),
        npcs: mapIterable(state.npcs),
      });
    });

    // Mark dead on disconnect/error so the host can detect the source went away. We do not
    // auto-reconnect in v1 — the renderer keeps presenting the last snapshot meanwhile.
    room.onLeave(() => {
      this.dead = true;
    });
    room.onError(() => {
      this.dead = true;
    });

    // Map any state already present at join time (before the first onStateChange).
    if (room.state) {
      this.latest = toNetMatchState({
        tick: room.state.tick,
        timeMs: room.state.timeMs,
        phase: room.state.phase,
        players: mapIterable(room.state.players),
        npcs: mapIterable(room.state.npcs),
      });
    }
  }

  /** True once the connection dropped/errored. main.ts may use this to react/fall back. */
  isConnected(): boolean {
    return this.room !== null && !this.dead;
  }

  getState(): NetMatchState {
    return this.latest;
  }

  sendInput(input: PlayerInput): void {
    // A REQUEST only — the server validates + applies authoritatively, ignoring any
    // client-reported position. Send the raw PlayerInput (NOT wrapped) per the seam.
    this.room?.send('input', input);
  }

  /** Server-driven: state arrives via onStateChange, so there is no local clock to tick. */
  update(_dtMs: number): void {
    // no-op
  }

  /** Leave the room (best-effort) so a hot-reload/teardown doesn't leak the socket. */
  dispose(): void {
    this.room?.leave();
    this.room = null;
  }
}
