// The authoritative wire-state CONTRACT (PROJECT_BRIEF §3). Plain types only — the
// Colyseus @colyseus/schema classes that PRODUCE this shape live in @deceive/server;
// the client CONSUMES this shape to render. Keeping the contract here (not in server)
// lets the server and client slices stay disjoint while agreeing on the data, and keeps
// Colyseus out of the engine-agnostic core (arch-guard, PROJECT_BRIEF §4.1).
import type { ClearanceTier } from '../clearance';

/** Lifecycle of a player within a match. Canonical home for this type. */
export type AgentPhase = 'blended' | 'suspicious' | 'revealed' | 'downed' | 'out';

/** Lifecycle of the match itself. */
export type MatchPhase = 'lobby' | 'active' | 'ended';

/** One player's authoritative, network-visible state. */
export interface NetPlayerState {
  id: string;
  team: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Tier of the player's CURRENT disguise (what other clients render them as). */
  disguiseTier: ClearanceTier;
  /** 0..SUSPICION_MAX. Only the owning client sees its own true value in HUD. */
  suspicion: number;
  phase: AgentPhase;
  /** Id of the zone the player is currently inside (empty if outside all zones). */
  currentZoneId: string;
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
  /** Keyed by player id. */
  players: Record<string, NetPlayerState>;
  /** Keyed by NPC id. The ambient tiered crowd. */
  npcs: Record<string, NetNpcState>;
  /** Keyed by crumb id. Active Holo-Crumbs (recent disguise-theft tells). */
  crumbs: Record<string, NetCrumbState>;
}
