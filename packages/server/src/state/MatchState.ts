// Colyseus @colyseus/schema state classes (slice 1.1). These MIRROR the FROZEN wire
// contract in @deceive/shared (NetPlayerState / NetMatchState) field-for-field so the
// client renders straight off them. The contract lives in `shared` (plain types, no
// Colyseus) to keep the engine-agnostic arch-guard happy; here we re-express it as the
// concrete @colyseus/schema that the server actually broadcasts.
//
// Uses legacy `@type(...)` decorators — colyseus's first-class serialization path (the
// reflection metadata it sends to clients is generated from these). Requires
// experimentalDecorators + useDefineForClassFields:false, set in tsconfig.base.json so
// EVERY tsx/tsc invocation applies them consistently (a per-package-only setting was
// silently dropped by tsx depending on cwd, emitting standard decorators -> dead server).
import { MapSchema, Schema, type } from '@colyseus/schema';
import type {
  AgentId,
  AgentPhase,
  ClearanceTier,
  MatchPhase,
  NetCrumbState,
  NetMatchState,
  NetNpcState,
  NetObjectiveState,
  NetPlayerState,
} from '@deceive/shared';

/** One player's authoritative, network-visible state. Mirrors NetPlayerState. */
export class PlayerSchema extends Schema implements NetPlayerState {
  @type('string') id = '';
  @type('uint8') team = 0;
  /** Which playable agent this player picked. */
  @type('string') agentId: AgentId = 'squire';
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') z = 0;
  @type('number') yaw = 0;
  /** Tier of the player's CURRENT disguise. Stored as its string tier name. */
  @type('string') disguiseTier: ClearanceTier = 'civilian';
  /** Id of the NPC whose appearance this player wears ('' = own look). */
  @type('string') disguiseId = '';
  /** 0..SUSPICION_MAX, authoritative. */
  @type('number') suspicion = 0;
  @type('string') phase: AgentPhase = 'blended';
  @type('string') currentZoneId = '';
  @type('uint8') health = 100;
  @type('uint16') intel = 0;
  @type('boolean') carrying = false;
  @type('string') heldKeycard: ClearanceTier | '' = '';
  /** True while the signature Expertise is active (drives client visuals). */
  @type('boolean') abilityActive = false;
  /** Ms until the Expertise is ready again (0 = ready). */
  @type('uint16') abilityCooldownMs = 0;
}

/** The heist objective state. Mirrors NetObjectiveState. */
export class ObjectiveSchema extends Schema implements NetObjectiveState {
  @type('boolean') vaultOpen = false;
  @type('string') packageHolderId = '';
  @type('number') packageX = 0;
  @type('number') packageY = 0;
  @type('number') packageZ = 0;
  @type('int8') winningTeam = -1;
}

/** A Holo-Crumb (disguise-theft tell). Mirrors NetCrumbState. */
export class CrumbSchema extends Schema implements NetCrumbState {
  @type('string') id = '';
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') z = 0;
  @type('string') tier: ClearanceTier = 'civilian';
  @type('number') expiresMs = 0;
}

/** A crowd NPC's network-visible state. Mirrors NetNpcState. */
export class NpcSchema extends Schema implements NetNpcState {
  @type('string') id = '';
  @type('string') tier: ClearanceTier = 'civilian';
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') z = 0;
  @type('number') yaw = 0;
}

/** The full authoritative match snapshot broadcast each tick. Mirrors NetMatchState. */
export class MatchState
  extends Schema
  implements Omit<NetMatchState, 'players' | 'npcs' | 'crumbs'>
{
  @type('uint32') tick = 0;
  @type('number') timeMs = 0;
  @type('string') phase: MatchPhase = 'lobby';
  /** The content-pack id this match runs; the client mounts the matching authored map. */
  @type('string') mapId = '';
  /** Keyed by player id. */
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  /** Keyed by NPC id. The ambient tiered crowd. */
  @type({ map: NpcSchema }) npcs = new MapSchema<NpcSchema>();
  /** Keyed by crumb id. Active Holo-Crumbs. */
  @type({ map: CrumbSchema }) crumbs = new MapSchema<CrumbSchema>();
  /** The heist objective state. */
  @type(ObjectiveSchema) objective = new ObjectiveSchema();
}
