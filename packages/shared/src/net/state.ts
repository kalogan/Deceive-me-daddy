// The authoritative wire-state CONTRACT (PROJECT_BRIEF §3). Plain types only — the
// Colyseus @colyseus/schema classes that PRODUCE this shape live in @deceive/server;
// the client CONSUMES this shape to render. Keeping the contract here (not in server)
// lets the server and client slices stay disjoint while agreeing on the data, and keeps
// Colyseus out of the engine-agnostic core (arch-guard, PROJECT_BRIEF §4.1).
import type { AgentId } from '../schema/agents';
import type { ClearanceTier } from '../clearance';

/** Lifecycle of a player within a match. Canonical home for this type. */
export type AgentPhase = 'blended' | 'suspicious' | 'revealed' | 'downed' | 'out';

/** Lifecycle of the match itself. */
export type MatchPhase = 'lobby' | 'active' | 'ended';

/** One player's authoritative, network-visible state. */
export interface NetPlayerState {
  id: string;
  team: number;
  /** Which playable agent this player picked (drives their Expertise + visual identity). */
  agentId: AgentId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Tier of the player's CURRENT disguise (what other clients render them as). */
  disguiseTier: ClearanceTier;
  /** Entity id whose APPEARANCE this player wears ('' / absent = own look). When set to a
   * taken NPC's id, the client renders this player as that specific NPC (the varied crowd is
   * seeded by entity id), so disguise copies the actual person — not just their tier colour. */
  disguiseId?: string;
  /** 0..SUSPICION_MAX. Only the owning client sees its own true value in HUD. */
  suspicion: number;
  phase: AgentPhase;
  /** Id of the zone the player is currently inside (empty if outside all zones). */
  currentZoneId: string;
  /** Authoritative health, 0..MAX_HEALTH. 0 means downed/out. */
  health: number;
  /** Intel collected by this player (spent to open the vault). */
  intel: number;
  /** True if this player is currently carrying the objective package. */
  carrying: boolean;
  /** Tier of the keycard the player holds ('' if none) — augments zone access. */
  heldKeycard: ClearanceTier | '';
  /** True while this player's signature Expertise is currently active (drives visuals). */
  abilityActive: boolean;
  /** Ms until the Expertise is ready again (0 = ready). Only meaningful to the owner's HUD. */
  abilityCooldownMs: number;
  /** Ms until the deployable gadget (second active slot) is ready again (0 = ready). Only
   * meaningful to the owner's HUD. OPTIONAL so existing fixtures/mappers that predate it keep
   * working (the client mapping defaults it to 0), mirroring how disguiseId was added. */
  gadgetCooldownMs?: number;
}

/** A crowd NPC's network-visible state — the bodies players disguise among. */
export interface NetNpcState {
  id: string;
  tier: ClearanceTier;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** A Holo-Crumb: the tell left at the spot where a player stole a disguise (PROJECT_BRIEF
 * §2b). Visible to all clients for a short window; lets rivals spot recent disguise theft. */
export interface NetCrumbState {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Tier of the disguise that was taken here (colors the tell). */
  tier: ClearanceTier;
  /** Sim time (ms) at which this crumb disappears. */
  expiresMs: number;
}

/** The full authoritative match snapshot the server broadcasts each tick. */
export interface NetMatchState {
  tick: number;
  timeMs: number;
  phase: MatchPhase;
  /** The content-pack id this match is running (chosen by the server at room creation). The
   * client mounts the matching authored map so its render matches the authoritative world. */
  mapId: string;
  /** Keyed by player id. */
  players: Record<string, NetPlayerState>;
  /** Keyed by NPC id. The ambient tiered crowd. */
  npcs: Record<string, NetNpcState>;
  /** Keyed by crumb id. Active Holo-Crumbs (recent disguise-theft tells). */
  crumbs: Record<string, NetCrumbState>;
  /** The objective state (intel → vault → package → extract). */
  objective: NetObjectiveState;
}

/** The heist objective's network-visible state (PROJECT_BRIEF §2). */
export interface NetObjectiveState {
  /** True once enough intel has been gathered to open the vault. */
  vaultOpen: boolean;
  /** Player id currently carrying the package ('' if loose/unclaimed). */
  packageHolderId: string;
  /** Authoritative package world position (follows the holder; last drop point otherwise). */
  packageX: number;
  packageY: number;
  packageZ: number;
  /** Winning team once a carrier extracts (-1 while the match is live). */
  winningTeam: number;
}
