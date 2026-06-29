// AI players ("bots", PROJECT_BRIEF §2). Bots ARE players (own PlayerState, team, can win)
// flagged isBot; they fill empty match slots so a 12-player match is playable solo. The
// server spawns them; this module drives them each tick. Engine-agnostic + deterministic.
//
// SCAFFOLD: `spawnBots` (creates the bots) is implemented; `stepBots` (the AI) drives each
// bot through a goal-driven state machine each tick (fight → carry → grab → collect → idle).
import {
  agentForJoinIndex,
  DEFAULT_FLOOR_HEIGHT,
  FIRE_RANGE,
  INTEL_COLLECT_RANGE,
  MATCH_TEAMS,
  PACKAGE_GRAB_RANGE,
  RUN_SPEED,
  WALK_SPEED,
  connectorGroundY,
  floorOfY,
  type Connector,
} from '@deceive/shared';
import { isAbilityReady, triggerAbility } from './ability';
import { segmentHitsWalls } from './collision';
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
    // Round-robin an agent identity so the match shows the whole roster in action.
    spawnPlayer(world, `bot-${i}`, i % MATCH_TEAMS, pos, true, agentForJoinIndex(i));
  }
}

// --- Tuning (bot-local; engine-agnostic) -------------------------------------------------
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
  let target: PlayerState | null = null;
  let bestSq = Infinity;
  for (const p of world.players.values()) {
    if (p === bot) continue;
    if (p.team === bot.team) continue;
    if (!isAlive(p)) continue;
    if (p.floor !== bot.floor) continue; // can't shoot across floors
    // Only engage enemies whose cover is BLOWN. A blended spy is indistinguishable from an
    // NPC, so shooting blended players would be an unfair "wallhack" (and gun fresh spawns
    // down instantly). Cover breaks via firing, suspicion-max, or grabbing the objective.
    if (p.phase !== 'revealed') continue;
    const dSq = distXZSq(bot.pos, p.pos);
    if (dSq > fireSq) continue;
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

/**
 * The XZ centre of a connector's mouth on `floor` — the end of the slope at that floor's height,
 * or null if the connector doesn't touch `floor`. `ascendToward` says which end of `axis` is the
 * HIGH (upper-floor) end, so the lower floor's mouth is the opposite end. Bots steer to a mouth to
 * get onto stairs/ramps/vents.
 */
function connectorMouth(c: Connector, floor: number): Vec2 | null {
  const lower = Math.min(c.fromFloor, c.toFloor);
  const upper = Math.max(c.fromFloor, c.toFloor);
  if (floor !== lower && floor !== upper) return null;
  const [minX, minZ] = c.footprint.min;
  const [maxX, maxZ] = c.footprint.max;
  const atLow = floor === lower;
  const axisMinIsLow = c.ascendToward === 'max'; // high end at axis max ⇒ low end at axis min
  if (c.axis === 'x') {
    return { x: atLow === axisMinIsLow ? minX : maxX, z: (minZ + maxZ) / 2 };
  }
  return { x: (minX + maxX) / 2, z: atLow === axisMinIsLow ? minZ : maxZ };
}

/**
 * Steer `bot` toward `target`, routing across FLOORS and around interior walls.
 *
 * Different floor? Head for the best CONNECTOR (stair/ramp/vent) that leaves the bot's floor toward
 * the target's floor — aim at its far mouth so the bot walks onto the slope and the movement step
 * carries its Y; once it steps off onto the new floor its floor commits and routing re-evaluates.
 *
 * Same floor? If the straight line is clear, head right at the goal; else aim for the best DOORWAY
 * (the one minimising bot→door→target, preferring one reachable in a straight shot). Wall checks
 * are filtered to the bot's floor. Greedy + memoryless (derived from `world` each tick) so it stays
 * deterministic; with wall sliding it gets bots to intel/package/extraction across the building.
 */
function routeToward(
  world: WorldState,
  bot: PlayerState,
  target: Vec3,
  speed: number,
  deps: SimDeps,
): void {
  const walls = world.walls;
  const floorHeight = world.pack?.floorHeight ?? DEFAULT_FLOOR_HEIGHT;
  const targetFloor = floorOfY(target.y, floorHeight);

  // --- Cross-floor: route via a connector that moves toward the target floor. ---
  if (targetFloor !== bot.floor) {
    const connectors = world.pack?.connectors ?? [];
    let bestC: Connector | null = null;
    let bestMouth: Vec2 | null = null;
    let bestFar: Vec2 | null = null;
    let bestCost = Infinity;
    for (const c of connectors) {
      const other = c.fromFloor === bot.floor ? c.toFloor : c.toFloor === bot.floor ? c.fromFloor : null;
      if (other === null) continue; // doesn't touch our floor
      // Only take connectors that get us CLOSER to the target floor (greedy multi-hop).
      if (Math.abs(other - targetFloor) >= Math.abs(bot.floor - targetFloor)) continue;
      const near = connectorMouth(c, bot.floor);
      const far = connectorMouth(c, other);
      if (!near || !far) continue;
      const cost = Math.hypot(near.x - bot.pos.x, near.z - bot.pos.z);
      if (cost < bestCost) {
        bestCost = cost;
        bestC = c;
        bestMouth = near;
        bestFar = far;
      }
    }
    if (bestC && bestMouth && bestFar) {
      // "On the slope" means actually riding the ramp SURFACE (near its height) — not merely inside
      // the footprint XZ. The low mouth can sit across the footprint from the approach, so the bot
      // must be able to walk UNDER the high end to reach the low mouth without prematurely flipping to
      // "climb"; keying off surface proximity lets it board at the low end, then push to the far mouth.
      const rampY = connectorGroundY(bestC, bot.pos.x, bot.pos.z, floorHeight);
      const onStairs = rampY !== null && Math.abs(bot.pos.y - rampY) < 1.2;
      let aim: Vec2 = bestMouth;
      if (onStairs) {
        const dx = bestFar.x - bestMouth.x;
        const dz = bestFar.z - bestMouth.z;
        const len = Math.hypot(dx, dz) || 1;
        aim = { x: bestFar.x + (dx / len) * 2, z: bestFar.z + (dz / len) * 2 };
      }
      steerTo(bot, { x: aim.x, y: 0, z: aim.z }, speed, deps);
      return;
    }
    // No usable connector found — fall through and just head at the target on this floor.
  }

  // --- Same floor: straight line, else best doorway (wall checks scoped to the bot's floor). ---
  if (!walls || walls.length === 0 || !segmentHitsWalls(bot.pos.x, bot.pos.z, target.x, target.z, walls, 0, bot.floor)) {
    steerTo(bot, target, speed, deps);
    return;
  }
  const doors = world.pack?.doors ?? [];
  let via: Vec3 | null = null;
  let bestCost = Infinity;
  for (const d of doors) {
    const dp = tuple3(d.position);
    const reach = Math.hypot(dp.x - bot.pos.x, dp.z - bot.pos.z);
    const onward = Math.hypot(target.x - dp.x, target.z - dp.z);
    // Penalise doors the bot can't walk straight to, so it heads for one it can actually reach
    // first and re-evaluates from there (greedy multi-hop routing).
    const blocked = segmentHitsWalls(bot.pos.x, bot.pos.z, dp.x, dp.z, walls, 0, bot.floor) ? 1000 : 0;
    const cost = reach + onward + blocked;
    if (cost < bestCost) {
      bestCost = cost;
      via = dp;
    }
  }
  steerTo(bot, via ?? target, speed, deps);
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
  const floorHeight = pack?.floorHeight ?? DEFAULT_FLOOR_HEIGHT;

  for (const bot of world.players.values()) {
    if (!bot.isBot) continue;
    if (!isAlive(bot)) {
      // Downed/out bots don't move or act — leave vel untouched (the step skips 'out').
      continue;
    }

    // Fire the signature Expertise opportunistically: when ready AND under pressure (a threat
    // nearby, carrying the prize, or already revealed). Keeps the roster's abilities visible
    // in a solo match without being spammed. Deterministic (no rng here).
    if (isAbilityReady(bot, deps.clock.now())) {
      const pressured = bot.carrying || bot.phase === 'revealed' || findThreat(world, bot) !== null;
      if (pressured) triggerAbility(world, bot.id, deps);
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
      if (exit) routeToward(world, bot, exit, RUN_SPEED, deps);
      else idle(bot);
      continue;
    }

    // 3. GRAB — vault open + package loose → go get it (only grab when on the package's floor).
    if (obj.vaultOpen && obj.packageHolderId === '') {
      const inReach =
        distXZSq(bot.pos, obj.packagePos) <= PACKAGE_GRAB_RANGE * PACKAGE_GRAB_RANGE &&
        floorOfY(obj.packagePos.y, floorHeight) === bot.floor;
      if (inReach) {
        grabPackage(world, bot.id, deps);
        idle(bot);
      } else {
        routeToward(world, bot, obj.packagePos, RUN_SPEED, deps);
      }
      continue;
    }

    // 4. COLLECT — head for the nearest uncollected intel node. Skipped when bots don't contest
    // the objective (solo classic mode), so they never open the vault before the player acts.
    if (!world.botsContestObjective) {
      idle(bot);
      continue;
    }
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
      const inReach =
        bestSq <= INTEL_COLLECT_RANGE * INTEL_COLLECT_RANGE &&
        floorOfY(goalPos.y, floorHeight) === bot.floor;
      if (inReach) {
        collectIntel(world, bot.id, goalNodeId, deps);
        idle(bot);
      } else {
        routeToward(world, bot, goalPos, WALK_SPEED, deps);
      }
      continue;
    }

    // 5. IDLE — nothing left to pursue.
    idle(bot);
  }
}
