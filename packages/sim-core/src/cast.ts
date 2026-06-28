// Channeled (timed) interactions. Pressing [Q]/[E] no longer fires the action instantly — it
// starts a CAST the player must hold for a per-action duration (the client shows a progress ring).
// Moving away from where you started, or being downed, cancels it. When the timer elapses the real
// underlying action runs (collect intel / take disguise / forge or grab the key / grab package /
// depart). Authoritative + deterministic — driven by the injected clock, no wall-clock.
import { CAST_MS, CAST_MOVE_CANCEL, EXTRACT_RANGE } from '@deceive/shared';
import { collectIntel, createVaultKey, grabPackage, grabVaultKey } from './objective';
import { takeDisguise } from './disguise';
import type { Cast, CastKind, PlayerState, SimDeps, WorldState } from './world';

function isAlive(p: PlayerState): boolean {
  return p.phase !== 'downed' && p.phase !== 'out';
}

function distXZ(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

/**
 * Map an objective interact target id to its cast kind. 'package'/'create_key'/'grab_key'/'depart'
 * are literal; anything else is an intel-node id → 'intel'. (Disguise is started via its own path.)
 */
export function castKindForTarget(targetId: string): CastKind {
  if (targetId === 'package') return 'package';
  if (targetId === 'create_key') return 'create_key';
  if (targetId === 'grab_key') return 'grab_key';
  if (targetId === 'depart') return 'depart';
  return 'intel';
}

/**
 * Begin a channeled interaction for `playerId`. The player must be alive; starting a NEW cast
 * replaces any in-progress one (so re-pressing restarts). Returns true if a cast was armed.
 * The action itself is validated again on COMPLETION, so a soft precheck here is enough.
 */
export function startCast(
  world: WorldState,
  playerId: string,
  kind: CastKind,
  targetId: string,
  deps: SimDeps,
): boolean {
  const player = world.players.get(playerId);
  if (!player || !isAlive(player)) return false;
  player.cast = {
    kind,
    targetId,
    startMs: deps.clock.now(),
    durationMs: CAST_MS[kind],
    anchor: { x: player.pos.x, y: player.pos.y, z: player.pos.z },
  };
  return true;
}

/** Cancel any in-progress channel for `playerId` (e.g. the player pressed cancel). */
export function cancelCast(world: WorldState, playerId: string): void {
  const player = world.players.get(playerId);
  if (player) player.cast = null;
}

/** Channel progress 0..1 for a player's active cast (0 when not casting). PURE display helper. */
export function castProgress(player: PlayerState, now: number): number {
  const c = player.cast;
  if (!c || c.durationMs <= 0) return 0;
  const t = (now - c.startMs) / c.durationMs;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Per-tick channel upkeep for every player. Cancels a cast if the player is downed or has drifted
 * past CAST_MOVE_CANCEL from where it began; completes it (runs the real action) once the duration
 * elapses. Run inside step() before the objective upkeep so a completed grab/forge is visible the
 * same tick.
 */
export function stepCast(world: WorldState, deps: SimDeps): void {
  const now = deps.clock.now();
  for (const player of world.players.values()) {
    const c = player.cast;
    if (!c) continue;
    if (!isAlive(player)) {
      player.cast = null;
      continue;
    }
    if (distXZ(player.pos.x, player.pos.z, c.anchor.x, c.anchor.z) > CAST_MOVE_CANCEL) {
      player.cast = null; // walked off — channel interrupted
      continue;
    }
    if (now - c.startMs >= c.durationMs) {
      player.cast = null;
      completeCast(world, player, c, deps);
    }
  }
}

/** Run the underlying action when a channel completes. Each action re-validates range/state. */
function completeCast(world: WorldState, player: PlayerState, c: Cast, deps: SimDeps): void {
  switch (c.kind) {
    case 'intel':
      collectIntel(world, player.id, c.targetId, deps);
      break;
    case 'disguise':
      takeDisguise(world, player.id, c.targetId, deps);
      break;
    case 'create_key':
      createVaultKey(world, player.id, deps);
      break;
    case 'grab_key':
      grabVaultKey(world, player.id, deps);
      break;
    case 'package':
      grabPackage(world, player.id, deps);
      break;
    case 'depart':
      completeDepart(world, player);
      break;
  }
}

/**
 * Departure: the carrier of the prize (the vault key in key packs, else the package) standing at an
 * extraction point wins for their team. This is the manual "press [E] to depart" extraction that
 * replaces auto-extraction for the vault-key flow; the client plays a vehicle send-off on the win.
 */
function completeDepart(world: WorldState, player: PlayerState): void {
  const obj = world.objective;
  const pack = world.pack;
  if (!pack || obj.winningTeam !== -1) return;
  const carrying = pack.objective.requiresVaultKey
    ? obj.keyHolderId === player.id
    : obj.packageHolderId === player.id;
  if (!carrying) return;
  for (const [ex, , ez] of pack.objective.extractionPoints) {
    if (distXZ(player.pos.x, player.pos.z, ex, ez) <= EXTRACT_RANGE) {
      obj.winningTeam = player.team;
      break;
    }
  }
}
