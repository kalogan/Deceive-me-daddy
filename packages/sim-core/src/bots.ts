// AI players ("bots", PROJECT_BRIEF §2). Bots ARE players (own PlayerState, team, can win)
// flagged isBot; they fill empty match slots so a 12-player match is playable solo. The
// server spawns them; this module drives them each tick. Engine-agnostic + deterministic.
//
// SCAFFOLD: `spawnBots` (creates the bots) is implemented; `stepBots` (the AI) drives each
// bot through a goal-driven state machine each tick (fight → carry → grab → collect → idle).
import {
  FIRE_RANGE,
  INTEL_COLLECT_RANGE,
  MATCH_TEAMS,
  PACKAGE_GRAB_RANGE,
  RUN_SPEED,
  WALK_SPEED,
} from '@deceive/shared';
import { resolveFire } from './combat';
import { hardReveal } from './detection';
import { collectIntel, grabPackage } from './objective';
import type { PlayerState, SimDeps, Vec3, WorldState } from './world';
import { spawnPlayer } from './world';

/** Spawn `count` AI players into the world, distributed across teams at pack spawn points. */
export function spawnBots(world: WorldState, deps: SimDeps, count: number): void {
  void deps;
  const spawns = world.pack?.spawnPoints ?? [];
  for (let i = 0; i < count; i += 1) {
    const sp = spawns.length > 0 ? spawns[i % spawns.length] : undefined;
    const pos: Vec3 = sp
      ? { x: sp.position[0], y: sp.position[1], z: sp.position[2] }
      : { x: 0, y: 0, z: 0 };
    spawnPlayer(world, `bot-${i}`, i % MATCH_TEAMS, pos, true);
  }
}

// --- Tuning (bot-local; engine-agnostic) -------------------------------------------------
// How close an UN-revealed enemy must be before a bot will pre-emptively engage. Revealed
// enemies are fair game anywhere in FIRE_RANGE (their cover is blown — a bot pounces).
const ENGAGE_RANGE = 14;
// The forward-cone leniency for "roughly ahead" when deciding to shoot. The actual hit test
// in resolveFire uses FIRE_CONE_DOT (~14°); we face the target first so that always passes,
// but we only OPEN fire when already roughly oriented to keep bots from spinning-and-firing.
const AIM_DOT = 0.5;
// Bots don't fire every tick (that would be a laser). Fire when rng clears this each tick —
// ~1-in-3 ticks → bursty, contestable, not instant.
const FIRE_CHANCE = 0.34;
// Small per-tick heading jitter (radians) so bots converging on one node don't stack into a
// single point. Deterministic: drawn from deps.rng.
const WANDER_RAD = 0.25;

interface Vec2 {
  x: number;
  z: number;
}

function isAlive(p: PlayerState): boolean {
  return p.phase !== 'downed' && p.phase !== 'out';
}

function tuple3(t: readonly [number, number, number]): Vec3 {
  return { x: t[0], y: t[1], z: t[2] };
}

function distXZSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/** Yaw whose forward (sin,cos) points from `from` toward `to`. Stable if they coincide. */
function yawTo(from: Vec3, to: Vec3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/** Pick the nearest entry of `points` to `from`, or null if empty. */
function nearest(from: Vec3, points: readonly Vec3[]): Vec3 | null {
  let best: Vec3 | null = null;
  let bestSq = Infinity;
  for (const pt of points) {
    const d = distXZSq(from, pt);
    if (d < bestSq) {
      bestSq = d;
      best = pt;
    }
  }
  return best;
}

/**
 * Find the most pressing enemy threat for `bot`: an alive player on another team within
 * FIRE_RANGE that is EITHER hard-revealed (cover blown — always a target) OR within the
 * tighter ENGAGE_RANGE (close enough to risk a fight even if blended). Returns the nearest
 * such enemy, or null.
 */
function findThreat(world: WorldState, bot: PlayerState): PlayerState | null {
  const fireSq = FIRE_RANGE * FIRE_RANGE;
  const engageSq = ENGAGE_RANGE * ENGAGE_RANGE;
  let target: PlayerState | null = null;
  let bestSq = Infinity;
  for (const p of world.players.values()) {
    if (p === bot) continue;
    if (p.team === bot.team) continue;
    if (!isAlive(p)) continue;
    const dSq = distXZSq(bot.pos, p.pos);
    if (dSq > fireSq) continue;
    const revealed = p.phase === 'revealed';
    if (!revealed && dSq > engageSq) continue;
    if (dSq < bestSq) {
      bestSq = dSq;
      target = p;
    }
  }
  return target;
}

/** Steer `bot` toward `target`: face it and set planar velocity at `speed`. */
function steerTo(bot: PlayerState, target: Vec3, speed: number, deps: SimDeps): void {
  // Per-bot deterministic jitter so a cluster of bots fans out instead of stacking.
  const jitter = (deps.rng.next() - 0.5) * 2 * WANDER_RAD;
  const yaw = yawTo(bot.pos, target) + jitter;
  bot.yaw = yaw;
  const dir: Vec2 = { x: Math.sin(yaw), z: Math.cos(yaw) };
  bot.vel.x = dir.x * speed;
  bot.vel.z = dir.z * speed;
  // y is integrated too; bots stay on the ground plane.
  bot.vel.y = 0;
}

function idle(bot: PlayerState): void {
  bot.vel.x = 0;
  bot.vel.y = 0;
  bot.vel.z = 0;
}

/**
 * Engage `threat`: face it and (occasionally) fire. Mirrors the server fire handler — a real
 * client's fire goes hardReveal → resolveFire, so a bot does the same to blow its own cover
 * and deal a hit. Stops moving while shooting (planted). Returns true if it fired this tick.
 */
function engage(world: WorldState, bot: PlayerState, threat: PlayerState, deps: SimDeps): void {
  const yaw = yawTo(bot.pos, threat.pos);
  bot.yaw = yaw;
  // Hold position while engaging — a stable firing stance, not a charge.
  idle(bot);

  // Only fire when already roughly oriented (we just snapped yaw, so this passes) AND the
  // per-tick fire die clears — keeps bots from being frame-perfect lasers.
  const fwdX = Math.sin(yaw);
  const fwdZ = Math.cos(yaw);
  const dx = threat.pos.x - bot.pos.x;
  const dz = threat.pos.z - bot.pos.z;
  const dist = Math.hypot(dx, dz);
  const dot = dist > 1e-6 ? (fwdX * dx + fwdZ * dz) / dist : 1;
  if (dot < AIM_DOT) return;
  if (deps.rng.next() >= FIRE_CHANCE) return;

  hardReveal(world, bot.id, deps);
  resolveFire(world, bot.id, deps);
}

/**
 * Advance every bot one tick: a goal-driven state machine.
 *
 *   1. FIGHT      — an enemy threat in range → face + occasionally fire (server-truthful).
 *   2. CARRY      — holding the package → run to the nearest extraction point (auto-wins).
 *   3. GRAB       — vault open + package loose → walk to it; grab when in range.
 *   4. COLLECT    — else → walk to the nearest uncollected intel node; collect in range.
 *   5. IDLE       — no goal / no pack → stand still.
 *
 * All AI state is DERIVED from `world` each tick (no per-bot memory) so the same world+seed
 * reproduces identical behavior. Variation (aim jitter, fire timing) flows through deps.rng.
 * Sets vel + yaw; the world step integrates pos AFTER this runs.
 */
export function stepBots(world: WorldState, deps: SimDeps): void {
  const pack = world.pack;
  const obj = world.objective;

  for (const bot of world.players.values()) {
    if (!bot.isBot) continue;
    if (!isAlive(bot)) {
      // Downed/out bots don't move or act — leave vel untouched (the step skips 'out').
      continue;
    }

    // 1. FIGHT — react to threats first, regardless of objective state.
    const threat = findThreat(world, bot);
    if (threat) {
      engage(world, bot, threat, deps);
      continue;
    }

    // Past here the bot pursues the heist. Without a pack there's nothing to chase.
    if (!pack) {
      idle(bot);
      continue;
    }

    // 2. CARRY — deliver the package to the nearest extraction point.
    if (bot.carrying) {
      const exits = pack.objective.extractionPoints.map(tuple3);
      const exit = nearest(bot.pos, exits);
      if (exit) steerTo(bot, exit, RUN_SPEED, deps);
      else idle(bot);
      continue;
    }

    // 3. GRAB — vault open + package loose → go get it.
    if (obj.vaultOpen && obj.packageHolderId === '') {
      if (distXZSq(bot.pos, obj.packagePos) <= PACKAGE_GRAB_RANGE * PACKAGE_GRAB_RANGE) {
        grabPackage(world, bot.id, deps);
        idle(bot);
      } else {
        steerTo(bot, obj.packagePos, RUN_SPEED, deps);
      }
      continue;
    }

    // 4. COLLECT — head for the nearest uncollected intel node.
    let goalNodeId: string | null = null;
    let goalPos: Vec3 | null = null;
    let bestSq = Infinity;
    for (const node of pack.intelNodes) {
      if (obj.collectedIntel.has(node.id)) continue;
      const pos = tuple3(node.position);
      const dSq = distXZSq(bot.pos, pos);
      if (dSq < bestSq) {
        bestSq = dSq;
        goalNodeId = node.id;
        goalPos = pos;
      }
    }

    if (goalNodeId && goalPos) {
      if (bestSq <= INTEL_COLLECT_RANGE * INTEL_COLLECT_RANGE) {
        collectIntel(world, bot.id, goalNodeId, deps);
        idle(bot);
      } else {
        steerTo(bot, goalPos, WALK_SPEED, deps);
      }
      continue;
    }

    // 5. IDLE — nothing left to pursue.
    idle(bot);
  }
}
