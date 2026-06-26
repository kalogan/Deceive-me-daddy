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
  INTEL_COLLECT_RANGE,
  MAX_HEALTH,
  PACKAGE_GRAB_RANGE,
  REVIVE_RANGE,
  SOCIAL_RANGE,
  SUSPICION_MAX,
  canAccess,
  type AgentPhase,
  type ClearanceTier,
  type ContentPack,
  type IntelNode,
  type NetMatchState,
  type NetNpcState,
  type NetObjectiveState,
  type NetPlayerState,
  type SocialSpot,
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
 * Readable "what you're doing" label for a social-spot action — the in-fiction verb the
 * player performs at that spot. The enum mirrors @deceive/shared's SocialSpot.action.
 */
const SOCIAL_ACTION_LABEL: Record<SocialSpot['action'], string> = {
  water_plants: 'Watering plants',
  patrol_post: 'On patrol',
  sit: 'Sitting',
  drink: 'At the bar',
  inspect: 'Inspecting',
};

/**
 * Is the local player "acting natural" — standing at a social spot whose tier matches their
 * worn disguise, within SOCIAL_RANGE (XZ plane)? Returns the readable action label (e.g.
 * "Watering plants") so the HUD can tell the player WHY their suspicion is bleeding off;
 * null when no matching-tier spot is in reach.
 *
 * PURE + display-only (PROJECT_BRIEF §2b / §4.2): the SERVER owns the actual suspicion bleed.
 * We only mirror its rule — a spot whose `tier === player.disguiseTier` within SOCIAL_RANGE —
 * so the local "Blending in" cue lines up with the server's social sink. The mismatched-tier
 * case is itself suspicious server-side; here it simply reads as "not blending" → null. No
 * pack (or no spots) → null.
 */
export function nearbySocialAction(
  player: { x: number; z: number; disguiseTier: ClearanceTier },
  pack: ContentPack | null,
): string | null {
  if (!pack) return null;
  const maxSq = SOCIAL_RANGE * SOCIAL_RANGE;
  let best: SocialSpot | null = null;
  let bestSq = Infinity;
  for (const spot of pack.socialSpots) {
    if (spot.tier !== player.disguiseTier) continue;
    const d = distSqXZ(player.x, player.z, spot.position[0], spot.position[2]);
    if (d <= maxSq && d < bestSq) {
      bestSq = d;
      best = spot;
    }
  }
  return best ? SOCIAL_ACTION_LABEL[best.action] : null;
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

/** The local player's objective progress + the heist's vault/package status, derived PURE. */
export interface ObjectiveStatus {
  /** Intel the local player has collected. */
  intel: number;
  /** Intel required to open the vault (from the pack; 0 if unknown). */
  intelRequired: number;
  /** True once the vault is open (server-owned). */
  vaultOpen: boolean;
  /** True if the local player is carrying the package right now. */
  carrying: boolean;
}

/**
 * Derive the local player's objective row from the authoritative wire state + the loaded
 * pack. PURE + display-only — the server owns intel/vault/carry; this just shapes them for
 * the HUD. `intelRequired` comes from the pack's `objective.intelRequiredToOpenVault` (0
 * when no pack is loaded, so the HUD shows "Intel: N" without a denominator).
 */
export function objectiveStatus(
  player: NetPlayerState,
  objective: NetObjectiveState,
  pack: ContentPack | null,
): ObjectiveStatus {
  return {
    intel: player.intel,
    intelRequired: pack ? pack.objective.intelRequiredToOpenVault : 0,
    vaultOpen: objective.vaultOpen,
    carrying: player.carrying,
  };
}

/** What the local player may interact with this frame (drives the [Q] prompt + the request). */
export interface Interactable {
  /** Kind of interaction: collect a specific intel node, or grab the loose package. */
  kind: 'intel' | 'package';
  /** The id to pass to `source.interact(...)`: an intel-node id, or the literal 'package'. */
  targetId: string;
  /** Human-readable verb for the HUD prompt, e.g. 'Collect intel' / 'Grab package'. */
  label: string;
}

/**
 * The single nearest thing the local player may interact with this frame, or null. PURE.
 *
 * Two candidates, in priority order when both are in reach (package first — it is the rarer,
 * higher-value action gated behind an open vault):
 *  (a) the PACKAGE — only when the vault is open, the package is loose (no holder), and the
 *      player is within PACKAGE_GRAB_RANGE of `objective.packageX/Z`.
 *  (b) the nearest uncollected-looking INTEL node within INTEL_COLLECT_RANGE. We can't know
 *      per-node from the wire whether it was already taken, so we simply offer the nearest
 *      in-range node and let the SERVER validate/ignore a re-collect (authority is the
 *      server's — an in-range prompt lines up with a server accept or a harmless no-op).
 *
 * Ranges are the shared constants the server also validates against, so the prompt and the
 * server's acceptance window agree.
 */
export function nearestInteractable(
  player: { x: number; z: number },
  objective: NetObjectiveState,
  intelNodes: readonly IntelNode[],
): Interactable | null {
  // (a) Package: vault open + loose + in grab range. Highest priority.
  if (objective.vaultOpen && objective.packageHolderId === '') {
    const dPkg = distSqXZ(player.x, player.z, objective.packageX, objective.packageZ);
    if (dPkg <= PACKAGE_GRAB_RANGE * PACKAGE_GRAB_RANGE) {
      return { kind: 'package', targetId: 'package', label: 'Grab package' };
    }
  }

  // (b) Nearest intel node within collect range.
  const maxSq = INTEL_COLLECT_RANGE * INTEL_COLLECT_RANGE;
  let best: IntelNode | null = null;
  let bestSq = Infinity;
  for (const node of intelNodes) {
    const d = distSqXZ(player.x, player.z, node.position[0], node.position[2]);
    if (d <= maxSq && d < bestSq) {
      bestSq = d;
      best = node;
    }
  }
  if (best) return { kind: 'intel', targetId: best.id, label: 'Collect intel' };

  return null;
}

/** The centered victory overlay text, derived PURE from the objective + the local team. */
export interface WinBanner {
  /** True once a team has extracted (`winningTeam !== -1`) — show the overlay. */
  show: boolean;
  /** Centered banner text, e.g. 'TEAM 2 EXTRACTED — VICTORY'. '' while the match is live. */
  text: string;
  /** True when the winning team is the LOCAL player's team (colour the banner triumphant). */
  localWon: boolean;
}

/**
 * Derive the win banner from the authoritative `winningTeam` + the local player's team. PURE
 * + display-only — the server decides the winner (extraction is automatic server-side). While
 * the match is live (`winningTeam === -1`) the banner is hidden.
 */
export function winBanner(objective: NetObjectiveState, localTeam: number): WinBanner {
  if (objective.winningTeam === -1) {
    return { show: false, text: '', localWon: false };
  }
  const localWon = objective.winningTeam === localTeam;
  const suffix = localWon ? ' — VICTORY (YOUR TEAM)' : ' EXTRACTED — VICTORY';
  return {
    show: true,
    text: `TEAM ${objective.winningTeam}${suffix}`,
    localWon,
  };
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
  /**
   * Readable action label when the local player is "acting natural" at a matching-tier social
   * spot (e.g. "Watering plants"), or null. Drives the calm "Blending in" cue so the player
   * understands WHY their suspicion is dropping.
   */
  socialAction: string | null;
  /** Id of the NPC the player may take a disguise from this frame, or null. */
  takeTargetId: string | null;
  /** Tier of that NPC (for the "[E] Take disguise (security)" prompt), or null. */
  takeTargetTier: ClearanceTier | null;
  /** Id of a downed teammate in revive reach this frame (drives the "[R] Revive" prompt), or null. */
  reviveTargetId: string | null;
  /** Objective progress row: intel / required, vault status, carrying. */
  objective: ObjectiveStatus;
  /** Verb for the "[Q] <verb>" interact prompt this frame, or null (nothing in reach). */
  interactLabel: string | null;
  /** Centered win overlay derived from the authoritative winning team. */
  win: WinBanner;
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
  socialAction: null,
  takeTargetId: null,
  takeTargetTier: null,
  reviveTargetId: null,
  objective: { intel: 0, intelRequired: 0, vaultOpen: false, carrying: false },
  interactLabel: null,
  win: { show: false, text: '', localWon: false },
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
  const interactable = nearestInteractable(
    player,
    state.objective,
    pack ? pack.intelNodes : [],
  );
  return {
    present: true,
    tier: player.disguiseTier,
    tierLabel: tierName(player.disguiseTier),
    tierColor: tierColorOf(player.disguiseTier),
    suspicion: suspicionMeter(player),
    health: healthBar(player),
    zoneName: zoneLabel(pack, player.currentZoneId),
    scolded: isScolded(pack, player),
    socialAction: nearbySocialAction(player, pack),
    takeTargetId: target ? target.id : null,
    takeTargetTier: target ? target.tier : null,
    reviveTargetId: reviveTarget ? reviveTarget.id : null,
    objective: objectiveStatus(player, state.objective, pack),
    interactLabel: interactable ? interactable.label : null,
    win: winBanner(state.objective, player.team),
  };
}
