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
  AgentId,
  AgentPhase,
  ClearanceTier,
  DuelPhase,
  MatchMode,
  MatchPhase,
  NetCrumbState,
  NetDuelState,
  NetMatchState,
  NetNpcState,
  NetObjectiveState,
  NetPlayerState,
  PlayerInput,
} from '@deceive/shared';
import type { StateSource } from './StateSource';

/** The server room name (packages/server/src/main.ts registers `'match'`). */
export const MATCH_ROOM_NAME = 'match';

/** The 1v1 stealth-duel room name (the duel mode matchmakes two humans into one room). */
export const MATCH_DUEL_ROOM_NAME = 'duel';

/** The snapshot rendered before the first `onStateChange` arrives (renderer-safe). */
const EMPTY_STATE: NetMatchState = {
  tick: 0,
  timeMs: 0,
  phase: 'lobby',
  mapId: '',
  players: {},
  npcs: {},
  crumbs: {},
  objective: {
    vaultOpen: false,
    packageHolderId: '',
    packageX: 0,
    packageY: 0,
    packageZ: 0,
    winningTeam: -1,
  },
};

/**
 * A single player as reflected by colyseus.js off the server's PlayerSchema. Every field
 * is optional/loose because we map from an untrusted, partially-populated reflection (a
 * just-joined player may exist before its first authoritative sync). Defaults below keep
 * the renderer fed with a valid NetPlayerState.
 */
export interface RawPlayer {
  id?: string;
  team?: number;
  agentId?: AgentId;
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  disguiseTier?: ClearanceTier;
  disguiseId?: string;
  suspicion?: number;
  phase?: AgentPhase;
  currentZoneId?: string;
  health?: number;
  intel?: number;
  carrying?: boolean;
  heldKeycard?: ClearanceTier | '';
  abilityActive?: boolean;
  abilityCooldownMs?: number;
  gadgetCooldownMs?: number;
  fireSeq?: number;
  hitSeq?: number;
  downSeq?: number;
}

/** The reflected objective sub-state. */
export interface RawObjective {
  vaultOpen?: boolean;
  packageHolderId?: string;
  packageX?: number;
  packageY?: number;
  packageZ?: number;
  winningTeam?: number;
}

const EMPTY_OBJECTIVE: NetObjectiveState = {
  vaultOpen: false,
  packageHolderId: '',
  packageX: 0,
  packageY: 0,
  packageZ: 0,
  winningTeam: -1,
};

/** The reflected 1v1-duel sub-state (every field optional; the heist room never sends it). */
export interface RawDuel {
  phase?: DuelPhase;
  roundsToWin?: number;
  round?: number;
  p1Id?: string;
  p1Score?: number;
  p2Id?: string;
  p2Score?: number;
  roundWinnerId?: string;
  matchWinnerId?: string;
  phaseEndsAtMs?: number;
}

/** Map the reflected duel sub-state into the shared NetDuelState (sparse → safe defaults). */
function toNetDuel(raw: RawDuel): NetDuelState {
  return {
    phase: raw.phase ?? 'waiting',
    roundsToWin: raw.roundsToWin ?? 3,
    round: raw.round ?? 0,
    p1Id: raw.p1Id ?? '',
    p1Score: raw.p1Score ?? 0,
    p2Id: raw.p2Id ?? '',
    p2Score: raw.p2Score ?? 0,
    roundWinnerId: raw.roundWinnerId ?? '',
    matchWinnerId: raw.matchWinnerId ?? '',
    phaseEndsAtMs: raw.phaseEndsAtMs ?? 0,
  };
}

function toNetObjective(raw: RawObjective | null | undefined): NetObjectiveState {
  if (!raw) return { ...EMPTY_OBJECTIVE };
  return {
    vaultOpen: raw.vaultOpen ?? false,
    packageHolderId: raw.packageHolderId ?? '',
    packageX: raw.packageX ?? 0,
    packageY: raw.packageY ?? 0,
    packageZ: raw.packageZ ?? 0,
    winningTeam: raw.winningTeam ?? -1,
  };
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

/** A Holo-Crumb as reflected by colyseus.js off the server's CrumbSchema. */
export interface RawCrumb {
  id?: string;
  x?: number;
  y?: number;
  z?: number;
  tier?: ClearanceTier;
  expiresMs?: number;
}

/**
 * The reflected match state shape. `players`/`npcs`/`crumbs` are anything ITERABLE of their
 * raw type — a colyseus.js MapSchema (iterable of its values), a plain array, or any
 * iterable — so the mapping is testable without a socket.
 */
export interface RawMatchState {
  tick?: number;
  timeMs?: number;
  phase?: MatchPhase;
  mapId?: string;
  players?: Iterable<RawPlayer> | null;
  npcs?: Iterable<RawNpc> | null;
  crumbs?: Iterable<RawCrumb> | null;
  objective?: RawObjective | null;
  mode?: MatchMode;
  duel?: RawDuel | null;
}

/**
 * PURE mapping: reflected schema -> the REAL shared NetMatchState. Unit-testable without a
 * socket (see ColyseusSource.test.ts). Tolerates sparse/empty input so a pre-spawn join or
 * a degenerate broadcast still yields a valid, renderable snapshot.
 */
export function toNetMatchState(raw: RawMatchState | null | undefined): NetMatchState {
  if (!raw)
    return {
      tick: 0,
      timeMs: 0,
      phase: 'lobby',
      mapId: '',
      players: {},
      npcs: {},
      crumbs: {},
      objective: { ...EMPTY_OBJECTIVE },
    };

  const players: Record<string, NetPlayerState> = {};
  if (raw.players) {
    for (const p of raw.players) {
      const id = p.id ?? '';
      if (!id) continue; // skip un-keyed/partial entries; the server always sets id.
      players[id] = {
        id,
        team: p.team ?? 0,
        agentId: p.agentId ?? 'squire',
        x: p.x ?? 0,
        y: p.y ?? 0,
        z: p.z ?? 0,
        yaw: p.yaw ?? 0,
        disguiseTier: p.disguiseTier ?? 'civilian',
        disguiseId: p.disguiseId ?? '',
        suspicion: p.suspicion ?? 0,
        phase: p.phase ?? 'blended',
        currentZoneId: p.currentZoneId ?? '',
        health: p.health ?? 100,
        intel: p.intel ?? 0,
        carrying: p.carrying ?? false,
        heldKeycard: p.heldKeycard ?? '',
        abilityActive: p.abilityActive ?? false,
        abilityCooldownMs: p.abilityCooldownMs ?? 0,
        gadgetCooldownMs: p.gadgetCooldownMs ?? 0,
        fireSeq: p.fireSeq ?? 0,
        hitSeq: p.hitSeq ?? 0,
        downSeq: p.downSeq ?? 0,
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

  const crumbs: Record<string, NetCrumbState> = {};
  if (raw.crumbs) {
    for (const c of raw.crumbs) {
      const id = c.id ?? '';
      if (!id) continue;
      crumbs[id] = {
        id,
        x: c.x ?? 0,
        y: c.y ?? 0,
        z: c.z ?? 0,
        tier: c.tier ?? 'civilian',
        expiresMs: c.expiresMs ?? 0,
      };
    }
  }

  const out: NetMatchState = {
    tick: raw.tick ?? 0,
    timeMs: raw.timeMs ?? 0,
    phase: raw.phase ?? 'lobby',
    mapId: raw.mapId ?? '',
    players,
    npcs,
    crumbs,
    objective: toNetObjective(raw.objective),
  };
  // Mode + duel are mapped ONLY when present (the heist room sends mode='heist'; legacy/test
  // inputs omit both → out stays heist-shaped, so existing fixtures don't see new fields).
  if (raw.mode) out.mode = raw.mode;
  if (raw.duel) out.duel = toNetDuel(raw.duel);
  return out;
}

/**
 * The reflected room.state. colyseus.js gives a MapSchema for `players`, which is iterable
 * over its values — exactly what `toNetMatchState` consumes. We narrow to `RawMatchState`
 * for the mapping; the runtime object is the live MapSchema-backed state.
 */
type Container<T> = { values(): Iterable<T> } | Iterable<T> | null | undefined;

type ReflectedState = Omit<RawMatchState, 'players' | 'npcs' | 'crumbs'> & {
  players?: Container<RawPlayer>;
  npcs?: Container<RawNpc>;
  crumbs?: Container<RawCrumb>;
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
   *
   * `opts` come from the start menu (see menu/Menu.ts):
   *  - `mode: 'solo'` → `client.create` a FRESH `match` room so the player is alone with the
   *    room's bots (Quick Play vs bots).
   *  - `mode: 'duel'` → `client.joinOrCreate` the `duel` room so two humans matchmake into the
   *    SAME 1v1 stealth-duel room (round-based single life, first to N round wins).
   *  - any other/absent mode → `client.joinOrCreate` the shared `match` room (Online
   *    Multiplayer — many real players in one match).
   *  - `agent` → passed as a join option so the server honours the requested loadout
   *    (MatchRoom.onJoin validates it against AGENT_IDS, else falls back to round-robin).
   */
  async connect(opts?: {
    mode?: 'solo' | 'multiplayer' | 'duel';
    agent?: AgentId;
    mapId?: string;
  }): Promise<void> {
    const client = new Client(this.endpoint);
    // Pass the requested agent + level as join options; the server honours them when it CREATES
    // the room (solo always creates; joinOrCreate only creates when no open room exists).
    const joinOptions: { agent?: AgentId; mapId?: string } = {};
    if (opts?.agent) joinOptions.agent = opts.agent;
    if (opts?.mapId) joinOptions.mapId = opts.mapId;
    // Pick the room by mode: duel → the dedicated 1v1 'duel' room (two humans matchmake in);
    // solo → a fresh private 'match' room with bots; else → the shared 'match' room.
    let room: Room<ReflectedState>;
    if (opts?.mode === 'duel') {
      room = await client.joinOrCreate<ReflectedState>(MATCH_DUEL_ROOM_NAME, joinOptions);
    } else if (opts?.mode === 'solo') {
      room = await client.create<ReflectedState>(MATCH_ROOM_NAME, joinOptions);
    } else {
      room = await client.joinOrCreate<ReflectedState>(MATCH_ROOM_NAME, joinOptions);
    }
    this.room = room;
    // The server keys players by sessionId; our own id is the joined room's sessionId.
    this.localPlayerId = room.sessionId;

    // Keep a freshly-mapped snapshot on every authoritative broadcast.
    room.onStateChange((state) => {
      this.latest = toNetMatchState({
        tick: state.tick,
        timeMs: state.timeMs,
        phase: state.phase,
        mapId: state.mapId,
        players: mapIterable(state.players),
        npcs: mapIterable(state.npcs),
        crumbs: mapIterable(state.crumbs),
        objective: state.objective,
        mode: state.mode,
        duel: state.duel,
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
        mapId: room.state.mapId,
        players: mapIterable(room.state.players),
        npcs: mapIterable(room.state.npcs),
        crumbs: mapIterable(room.state.crumbs),
        objective: room.state.objective,
        mode: room.state.mode,
        duel: room.state.duel,
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

  takeDisguise(targetNpcId: string): void {
    // A REQUEST only — the server checks range + applies the disguise + drops the crumb.
    this.room?.send('take_disguise', { targetNpcId });
  }

  fire(): void {
    // A REQUEST only — the server applies the hard reveal + resolves the shot.
    this.room?.send('fire');
  }

  revive(targetPlayerId: string): void {
    // A REQUEST only — the server validates team/range/downed before reviving.
    this.room?.send('revive', { targetPlayerId });
  }

  interact(targetId: string): void {
    // A REQUEST only — the server validates proximity/state (intel node or 'package').
    this.room?.send('interact', { targetId });
  }

  useAbility(): void {
    // A REQUEST only — the server triggers the player's Expertise + validates the cooldown.
    this.room?.send('ability');
  }

  useGadget(): void {
    // A REQUEST only — the server triggers the player's gadget + validates the cooldown.
    this.room?.send('use_gadget');
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
