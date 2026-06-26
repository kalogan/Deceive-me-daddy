// Pure derivation for the player HUD + the take-disguise interaction. Kept Three.js /
// DOM free so the selection + text derivation is unit-testable in the node-env gate
// (PROJECT_BRIEF §4.6); the side-effectful DOM render lives in Hud.ts and the meshes in
// CrumbView.ts.
//
// Authority note (PROJECT_BRIEF §3/§4.2): the disguise/zone/suspicion are the SERVER's
// word. These helpers only READ the latest NetMatchState + the loaded content pack to
// decide what to SHOW and which NPC the player may REQUEST to disguise as. No gameplay
// truth is decided here — taking a disguise is validated + applied server-side.
import {
  DISGUISE_TAKE_RANGE,
  MAX_HEALTH,
  REVIVE_RANGE,
  SUSPICION_MAX,
  canAccess,
  type AgentPhase,
  type ClearanceTier,
  type ContentPack,
  type NetMatchState,
  type NetNpcState,
  type NetPlayerState,
  type Zone,
} from '@deceive/shared';

/**
 * Readable display label for a clearance tier — capitalise the wire string (there is no
 * separate name map in @deceive/shared). 'civilian' → 'Civilian', 'staff' → 'Staff',
 * 'security' → 'Security', 'scientist' → 'Scientist'. Empty → '' (defensive).
 */
export function tierName(tier: ClearanceTier): string {
  if (!tier) return '';
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

/** Severity band of the suspicion bar — drives its colour in the HUD. */
export type SuspicionLevel = 'low' | 'mid' | 'high';

/** The local player's suspicion bar, derived PURE from the authoritative wire state. */
export interface SuspicionMeter {
  /** Fill fraction 0..1 (suspicion / SUSPICION_MAX), clamped. */
  pct: number;
  /** Colour band: low (<40%) → mid (<75%) → high. */
  level: SuspicionLevel;
  /** Short status word reflecting the server-owned phase ('Hidden', 'SUSPICIOUS', …). */
  label: string;
}

/** Map the server-owned phase to a short HUD status word. */
function phaseLabel(phase: AgentPhase): string {
  switch (phase) {
    case 'blended':
      return 'Hidden';
    case 'suspicious':
      return 'SUSPICIOUS';
    case 'revealed':
      return 'REVEALED';
    case 'downed':
      return 'DOWNED';
    case 'out':
      return 'OUT';
    default:
      return 'Hidden';
  }
}

/**
 * Derive the local suspicion bar from a player's authoritative `suspicion` (0..SUSPICION_MAX)
 * and `phase`. PURE + display-only — the server owns the real values; this just shapes them
 * for the HUD. `pct` is clamped to 0..1; level thresholds are 40% / 75%.
 */
export function suspicionMeter(player: NetPlayerState): SuspicionMeter {
  const raw = SUSPICION_MAX > 0 ? player.suspicion / SUSPICION_MAX : 0;
  const pct = Math.max(0, Math.min(1, raw));
  const level: SuspicionLevel = pct >= 0.75 ? 'high' : pct >= 0.4 ? 'mid' : 'low';
  return { pct, level, label: phaseLabel(player.phase) };
}

/** Severity band of the health bar — drives its colour (green→amber→red as it drops). */
export type HealthLevel = 'ok' | 'hurt' | 'critical';

/** The local player's health bar, derived PURE from the authoritative wire state. */
export interface HealthBar {
  /** Fill fraction 0..1 (health / MAX_HEALTH), clamped. */
  pct: number;
  /** Colour band: ok (>=60%) → hurt (>=30%) → critical. */
  level: HealthLevel;
  /**
   * Server-owned phase reflected into a status word: 'DOWNED' (revivable) / 'ELIMINATED'
   * (out for the round) / '' (alive — show the bar normally). Lets the HUD swap from a bar
   * to a clear downed/out callout.
   */
  status: '' | 'DOWNED' | 'ELIMINATED';
}

/**
 * Derive the local health bar from a player's authoritative `health` (0..MAX_HEALTH) and
 * `phase`. PURE + display-only — the server owns the real values; this just shapes them for
 * the HUD. `pct` is clamped to 0..1; level thresholds are 60% / 30%. `status` lifts the
 * 'downed'/'out' phases into a clear callout so the player reads their state at a glance.
 */
export function healthBar(player: NetPlayerState): HealthBar {
  const raw = MAX_HEALTH > 0 ? player.health / MAX_HEALTH : 0;
  const pct = Math.max(0, Math.min(1, raw));
  const level: HealthLevel = pct >= 0.6 ? 'ok' : pct >= 0.3 ? 'hurt' : 'critical';
  const status: HealthBar['status'] =
    player.phase === 'out' ? 'ELIMINATED' : player.phase === 'downed' ? 'DOWNED' : '';
  return { pct, level, status };
}

/**
 * The nearest DOWNED teammate within `range` (XZ plane) the local player may revive, or null
 * if none is in reach. PURE: given the local player (its team + position) + the snapshot's
 * players it returns the id to request a revive against (excluding the local player itself).
 * A teammate is same-team AND phase 'downed' (an 'out' ally is past the window — not
 * revivable). Range is the shared REVIVE_RANGE the SERVER also validates, so an in-reach
 * prompt here lines up with a server accept (the request can still be rejected — authority
 * is the server's).
 */
export function nearestDownedTeammate(
  local: { id: string; team: number; x: number; z: number },
  players: Record<string, NetPlayerState>,
  range: number = REVIVE_RANGE,
): NetPlayerState | null {
  const maxSq = range * range;
  let best: NetPlayerState | null = null;
  let bestSq = Infinity;
  for (const id of Object.keys(players)) {
    const p = players[id];
    if (!p) continue;
    if (p.id === local.id) continue;
    if (p.team !== local.team) continue;
    if (p.phase !== 'downed') continue;
    const d = distSqXZ(local.x, local.z, p.x, p.z);
    if (d <= maxSq && d < bestSq) {
      bestSq = d;
      best = p;
    }
  }
  return best;
}

/** Find a zone by id in a pack (null pack / empty id / no match → undefined). */
export function zoneById(pack: ContentPack | null, zoneId: string): Zone | undefined {
  if (!pack || !zoneId) return undefined;
  return pack.zones.find((z) => z.id === zoneId);
}

/**
 * Human-readable name of the zone the player is in. '' currentZoneId (outside all zones)
 * → "Open area"; an id with no matching zone in the pack → "Unknown zone" (defensive —
 * a wire id the loaded pack doesn't know).
 */
export function zoneLabel(pack: ContentPack | null, zoneId: string): string {
  if (!zoneId) return 'Open area';
  return zoneById(pack, zoneId)?.name ?? 'Unknown zone';
}

/**
 * Is the player "scolded" — standing in a real zone their disguise can't access? Mirrors
 * the server's clearance-mismatch axis (PROJECT_BRIEF §2b): zone exists AND the worn tier
 * cannot access its required clearance. The server owns the actual suspicion drain; this
 * only drives the local WARNING so the player understands WHY they're being spotted.
 */
export function isScolded(pack: ContentPack | null, player: NetPlayerState): boolean {
  const zone = zoneById(pack, player.currentZoneId);
  if (!zone) return false;
  return !canAccess(player.disguiseTier, zone.requiredClearance);
}

/** Squared XZ distance — avoids a sqrt for range comparisons. */
function distSqXZ(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

/**
 * The nearest NPC within DISGUISE_TAKE_RANGE of `player` (XZ plane), or null if none is in
 * reach. PURE: given the local position + the snapshot's npcs it returns the id to request
 * a disguise-take against. Range is the shared constant the SERVER also validates, so an
 * in-range prompt here lines up with a server accept (the request can still be rejected —
 * the server is authoritative).
 */
export function nearestTakeableNpc(
  player: { x: number; z: number },
  npcs: Record<string, NetNpcState>,
  range: number = DISGUISE_TAKE_RANGE,
): NetNpcState | null {
  const maxSq = range * range;
  let best: NetNpcState | null = null;
  let bestSq = Infinity;
  for (const id of Object.keys(npcs)) {
    const n = npcs[id];
    if (!n) continue;
    const d = distSqXZ(player.x, player.z, n.x, n.z);
    if (d <= maxSq && d < bestSq) {
      bestSq = d;
      best = n;
    }
  }
  return best;
}

/** The data the DOM HUD renders for the local player on a given frame. PURE + serialisable. */
export interface HudModel {
  /** True once the local player exists in the snapshot (pre-connect → false → hide HUD). */
  present: boolean;
  tier: ClearanceTier;
  /** Readable tier label for the "Disguise:" row text, e.g. 'Security'. */
  tierLabel: string;
  /** Hex color for the tier swatch (TIER_COLOR), e.g. '#3f72ae'. */
  tierColor: string;
  /** Local suspicion bar (server-owned suspicion + phase, display-only). */
  suspicion: SuspicionMeter;
  /** Local health bar (server-owned health + phase, display-only). */
  health: HealthBar;
  zoneName: string;
  scolded: boolean;
  /** Id of the NPC the player may take a disguise from this frame, or null. */
  takeTargetId: string | null;
  /** Tier of that NPC (for the "[E] Take disguise (security)" prompt), or null. */
  takeTargetTier: ClearanceTier | null;
  /** Id of a downed teammate in revive reach this frame (drives the "[R] Revive" prompt), or null. */
  reviveTargetId: string | null;
}

const ABSENT: HudModel = {
  present: false,
  tier: 'civilian',
  tierLabel: 'Civilian',
  tierColor: '#cfcfcf',
  suspicion: { pct: 0, level: 'low', label: 'Hidden' },
  health: { pct: 1, level: 'ok', status: '' },
  zoneName: '',
  scolded: false,
  takeTargetId: null,
  takeTargetTier: null,
  reviveTargetId: null,
};

/**
 * Derive everything the HUD shows from the latest snapshot + the loaded pack, for the
 * local player. `tierColor` is injected (the caller passes TIER_COLOR[tier]) so this stays
 * a pure mapping with no import-time table coupling. Returns an ABSENT model when the local
 * player isn't in the snapshot yet (the HUD then hides).
 */
export function deriveHudModel(
  state: NetMatchState,
  localPlayerId: string,
  pack: ContentPack | null,
  tierColorOf: (tier: ClearanceTier) => string,
): HudModel {
  const player = state.players[localPlayerId];
  if (!player) return ABSENT;

  const target = nearestTakeableNpc(player, state.npcs);
  const reviveTarget = nearestDownedTeammate(player, state.players);
  return {
    present: true,
    tier: player.disguiseTier,
    tierLabel: tierName(player.disguiseTier),
    tierColor: tierColorOf(player.disguiseTier),
    suspicion: suspicionMeter(player),
    health: healthBar(player),
    zoneName: zoneLabel(pack, player.currentZoneId),
    scolded: isScolded(pack, player),
    takeTargetId: target ? target.id : null,
    takeTargetTier: target ? target.tier : null,
    reviveTargetId: reviveTarget ? reviveTarget.id : null,
  };
}
