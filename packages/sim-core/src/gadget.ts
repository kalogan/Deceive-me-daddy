// Deployable GADGETS (PROJECT_BRIEF §2 — the agents' SECOND active slot, alongside the
// signature Expertise). Each playable agent carries one gadget on its own cooldown; firing it
// runs a kind-specific EFFECT and arms the cooldown. All authoritative + deterministic (time
// via deps.clock; no Math.random / Date.now), mirroring the ability.ts framework.
//
// The THREE gadgets REUSE existing systems — they invent no new physics:
//   - scan   (Squire) → hard-reveal every nearby ENEMY (reuses the detection reveal semantics).
//   - frag   (Chavez) → burst-damage every nearby ENEMY, downing at 0 (reuses combat's down).
//   - mirage (Larcin) → drop a Holo-Crumb decoy at your spot + instantly re-blend (an escape;
//                       reuses the disguise crumb system).
import { AGENTS_BY_ID, HOLO_CRUMB_MS, REVIVE_WINDOW_MS } from '@deceive/shared';
import { isCloaked, isInvulnerable } from './ability';
import type { Crumb } from './disguise';
import type { PlayerState, SimDeps, WorldState } from './world';

/** A player can act/trigger a gadget only while up (not downed/eliminated). */
function isActionable(p: PlayerState): boolean {
  return p.phase !== 'downed' && p.phase !== 'out';
}

/** A player is incapacitated (cannot be targeted by a gadget effect) when downed or out. */
function isIncapacitated(p: PlayerState): boolean {
  return p.phase === 'downed' || p.phase === 'out';
}

/** Ms until the gadget is ready again (0 = ready now). Mirrors abilityCooldownRemaining. */
export function gadgetCooldownRemaining(p: PlayerState, now: number): number {
  return Math.max(0, p.gadgetReadyAtMs - now);
}

/** True if the gadget can be triggered right now (actionable + off cooldown). */
export function isGadgetReady(p: PlayerState, now: number): boolean {
  return isActionable(p) && now >= p.gadgetReadyAtMs;
}

/** Squared XZ (ground-plane) distance between two players. */
function xzDistSq(a: PlayerState, b: PlayerState): number {
  const dx = b.pos.x - a.pos.x;
  const dz = b.pos.z - a.pos.z;
  return dx * dx + dz * dz;
}

/** scan: hard-reveal each ENEMY within `radius` (XZ) of `user` for `magnitude` ms. */
function applyScan(world: WorldState, user: PlayerState, now: number, radius: number, magnitude: number): void {
  const rSq = radius * radius;
  for (const p of world.players.values()) {
    if (p === user) continue;
    if (p.team === user.team) continue; // self + teammates untouched
    if (isIncapacitated(p)) continue;
    if (xzDistSq(user, p) > rSq) continue;
    // Hard reveal — match detection.ts's reveal semantics (phase 'revealed' + a window).
    p.phase = 'revealed';
    p.revealedUntilMs = now + magnitude;
  }
}

/** frag: deal `magnitude` damage to each ENEMY within `radius` (XZ); down at 0 health. */
function applyFrag(world: WorldState, user: PlayerState, now: number, radius: number, magnitude: number): void {
  const rSq = radius * radius;
  for (const p of world.players.values()) {
    if (p === user) continue;
    if (p.team === user.team) continue; // no friendly fire
    if (isIncapacitated(p)) continue;
    // Protected by an Expertise (Hard Boiled invuln / Adieu cloak) → unhittable, skip.
    if (isInvulnerable(p, now) || isCloaked(p, now)) continue;
    if (xzDistSq(user, p) > rSq) continue;

    p.health = Math.max(0, p.health - magnitude);
    if (p.health === 0) {
      // Match resolveFire's down logic.
      p.phase = 'downed';
      p.downedUntilMs = now + REVIVE_WINDOW_MS;
    }
  }
}

/**
 * mirage: drop a Holo-Crumb decoy at the user's CURRENT spot (tagged with their current
 * disguise tier — the tell looks like who they are NOW) AND instantly re-blend the user
 * (suspicion 0, phase 'blended', reveal cleared). An escape. Deterministic crumb id like
 * takeDisguise: `gadget:<playerId>:<tick>`.
 */
function applyMirage(world: WorldState, user: PlayerState, now: number): void {
  const crumb: Crumb = {
    id: `gadget:${user.id}:${world.tick}`,
    pos: { ...user.pos },
    tier: user.disguiseTier,
    expiresMs: now + HOLO_CRUMB_MS,
  };
  world.crumbs.set(crumb.id, crumb);

  // Instantly slip back into the crowd.
  user.suspicion = 0;
  user.phase = 'blended';
  user.revealedUntilMs = 0;
}

/**
 * Trigger `playerId`'s deployable gadget. No-op (returns false) if the player is missing,
 * not actionable (down/out), or still on cooldown. On success: applies the kind-specific
 * EFFECT, arms the cooldown (gadgetReadyAtMs = now + agent.gadget.cooldownMs), and returns
 * true. Effects/cooldowns come from the agent's catalog entry (data-driven).
 */
export function triggerGadget(world: WorldState, playerId: string, deps: SimDeps): boolean {
  const player = world.players.get(playerId);
  if (!player) return false;
  const now = deps.clock.now();
  if (!isGadgetReady(player, now)) return false;

  const gadget = AGENTS_BY_ID[player.agentId].gadget;
  switch (gadget.kind) {
    case 'scan':
      applyScan(world, player, now, gadget.radius, gadget.magnitude);
      break;
    case 'frag':
      applyFrag(world, player, now, gadget.radius, gadget.magnitude);
      break;
    case 'mirage':
      applyMirage(world, player, now);
      break;
  }

  player.gadgetReadyAtMs = now + gadget.cooldownMs;
  return true;
}

/**
 * Per-tick gadget upkeep — the parity hook to stepAbility. Gadget effects are instantaneous
 * (the reveal/down windows they set are expired by detection/combat upkeep, not here), and the
 * cooldown (gadgetReadyAtMs) is read lazily by isGadgetReady, so there is nothing to advance.
 * Kept so the step loop steps the gadget system exactly as it steps the ability system.
 */
export function stepGadget(_world: WorldState, _deps: SimDeps): void {
  // no-op: gadgets have no active window to expire (cooldown is read lazily).
}
